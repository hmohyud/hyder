/**
 * Cloudflare Worker backing the site chat.
 *
 * Contract (shared with chat-dev-server.mjs so the UI never changes):
 *   POST /chat  { messages: [{ role: "user" | "assistant", content: string }],
 *                 context?: { path: string, hovered?: string, look?: string,
 *                             performed?: string } }
 *   `context.performed` names a trick the page has ALREADY performed (a
 *   help-sheet button): the reply is one line about it, straight from
 *   Haiku with no sizing, and the page ignores any token it opens with.
 *   -> streams plain UTF-8 text chunks, no SSE framing for the client to parse.
 *   The stream may OPEN with [[think]]...[[/think]] - the model's summarised
 *   reasoning, streamed as it thinks - and always CLOSES with one
 *   [[stats:{json}]] record (provider, model, tokens, cache, timings, the
 *   sizing). The page strips both and shows them in its "workings" drawer;
 *   everything between is the reply as before.
 *   `context` is what the page knows about where the visitor is - the route,
 *   and on the projects page the card they are looking at - so "tell me about
 *   this one" has a referent. It is validated and clipped here (chatContext),
 *   then handed to the model OUTSIDE the cached system prompt: as a
 *   mid-conversation system message on Claude, as a bracketed prefix on the
 *   last user turn for the providers without one. The system block itself
 *   stays byte-identical on every request, which is what keeps it cached.
 *
 * Backends, tried in this order, each only if it is bound:
 *   - env.ANTHROPIC_KEY -> Claude Sonnet on the Anthropic API, under a daily dollar
 *                          meter (env.ANTHROPIC_DAILY_BUDGET_CENTS, default 500 = $5)
 *   - env.GEMINI_KEY    -> Google AI Studio (free tier; catches the overflow)
 *   - env.AI            -> Workers AI (no key needed; runs on Cloudflare's GPUs)
 *
 * Optional env.CHAT_KV enables the per-IP daily cap and the Anthropic spend meter.
 *
 * Deploy:
 *   npx wrangler deploy worker/chat-worker.js --name hyder-chat --compatibility-date 2026-01-01
 *   npx wrangler secret put ANTHROPIC_KEY        # the Claude path
 */

import { PROMPT } from "./knowledge.js";
import { createLeakGuard } from "./guard.js";

const NEWLINE = String.fromCharCode(10);

const WORKERS_AI_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const ANTHROPIC_MODEL = "claude-sonnet-5-5";
const LIGHT_MODEL = "claude-haiku-5-5";
/* Before anyone answers, a Haiku call sizes the question up (1-5). The
   rating decides who answers and how hard they think: Haiku keeps what it
   rated 1-2 (small talk, a trick, one fact) and answers it itself at a
   twentieth of the price; 3-5 are handed to Sonnet with effort rising with
   the rating. The top-level effort stays pinned at "low" so the cached
   prompt never splits by effort; a harder question gets a content-less
   system message that raises effort for that turn (beta
   mid-conversation-output-config), which leaves the cache intact. */
const SIZER_MODEL = LIGHT_MODEL;
// Claude API list prices in USD per million tokens: uncached input, a 1-hour
// cache write (2x input), a cache read (0.1x), output (thinking bills as output).
const PRICES = {
  [ANTHROPIC_MODEL]: { input: 2, cacheWrite1h: 4, cacheRead: 0.2, output: 10 },
  [LIGHT_MODEL]: { input: 0.1, cacheWrite1h: 0.2, cacheRead: 0.01, output: 0.5 },
};
const priceOf = (model) => PRICES[model] || PRICES[ANTHROPIC_MODEL];
const SIZER_PRICE = PRICES[LIGHT_MODEL];
const SIZER_TIMEOUT_MS = 1500;
const SIZER_PROMPT =
  "You size up the question just asked of a portfolio-site chatbot (a 3D head answering as the site's owner). " +
  "Reply with exactly one digit and one word, nothing else. The digit is how much deliberation a good answer needs: " +
  "1 greeting, small talk, a trick, a yes or no; 2 one fact to look up; 3 an explanation or an opinion drawn from a few facts; " +
  "4 a comparison, ranking or recommendation that must weigh several things; 5 a multi-part or subtle question needing care. " +
  "The word is the kind: chat, fact, explain, compare, tour, trick, other.";
const EFFORT_FOR = { 1: "low", 2: "low", 3: "medium", 4: "high", 5: "high" };
/* the performable tricks, as the prompt names them; one is drawn per turn
   for "surprise me", so the picks are a real shuffle rather than the
   model's habit (it favours the ghost) */
const TRICKS = ["ghost", "spin", "fire", "a colour of your choosing", "lattice", "wire", "scatter", "melt", "shatter", "ember", "glitch", "hue"];
/* the first few tricks a visitor asks for come from the showy end of the
   repertoire; the quiet ones (a spin, a colour, the ghost) only join the
   roll once a few have been seen */
const SHOWY_TRICKS = ["fire", "lattice", "wire", "scatter", "melt", "shatter", "ember", "glitch", "hue"];
/* the help sheet's trick buttons: the page performs the trick itself and
   asks for one line about it. What each one does, for the remark. */
const PILL_WORDS = {
  ghost: "fading see-through, a look that stays until undone (it takes the halftone off if that was on: a solid print has no gaps for a ghost)",
  "ghost-off": "coming back solid: the ghost look was on and that press switched it OFF (any lattice or wire stays); it is not going ghost",
  lattice: "re-rendering itself as a halftone print of the cloud, a look that stays (it replaces the wireframe if that was on, and switches a ghost off: the print is a solid frame with no gaps)",
  "lattice-off": "coming back from the halftone print to its plain dots: the lattice look was on and that press switched it OFF (a ghost, if on, stays)",
  wire: "turning into a wireframe, a look that stays (it replaces the halftone if that was on)",
  "wire-off": "coming back from the wireframe to its plain dots: the wire look was on and that press switched it OFF (a ghost, if on, stays)",
  cloud: "going back to the plain point cloud, every look off",
  spin: "whipping round about three times and unwinding",
  fire: "breathing a burst of fire from its mouth",
  tint: "being washed in a blue that pours from the crown and holds ten seconds",
  scatter: "bursting apart, hanging, and gliding back into the face",
  melt: "melting downward and reforming",
  shatter: "shattering and reassembling",
  ember: "turning to sparks",
  glitch: "glitching and settling back",
  hue: "running a rainbow across its face",
};
const PILL_RX = new RegExp("^(" + Object.keys(PILL_WORDS).join("|") + ")$");
/* the hand-off. A tour always goes to Sonnet (the stop protocol wants the
   stronger writer); no verdict in time means Sonnet at low effort, so a
   dead sizer costs quality nothing. */
function routeFor(size) {
  if (!size) return { model: ANTHROPIC_MODEL, effort: "low" };
  /* tours and tricks are protocol work (the right token, in the right place)
     and short, so Sonnet does them whatever the rating: Haiku has been seen
     answering "just choose one" with a tour token and a description */
  if (size.complexity <= 2 && size.kind !== "tour" && size.kind !== "trick") return { model: LIGHT_MODEL, effort: "low" };
  return { model: ANTHROPIC_MODEL, effort: EFFORT_FOR[size.complexity] || "low" };
}
const round4 = (n) => Math.round(n * 10000) / 10000;
// Daily ceiling for Claude in US cents; 0 switches the Claude path off entirely.
const anthropicBudgetCents = (env) => {
  const n = parseInt(env.ANTHROPIC_DAILY_BUDGET_CENTS, 10);
  return Number.isFinite(n) ? n : 500;
};
// Free-tier reality, per this project's AI Studio rate-limit page: the
// Flash *Lite* ids carry by far the largest daily request allowance, so the
// worker chooses only from that family - and chooses the newest of it by
// itself. Google's models endpoint is listed once a day (geminiCandidates),
// the id that last answered is remembered and tried first, and an id that
// 404s (retired), 403s (no access) or 429s before ever working (most likely
// not on this project's free tier) is benched. This list is only the seed
// used when discovery is unreachable.
const GEMINI_MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-2.5-flash-lite",
];
const GEMINI_FAMILY = /flash-lite/;
// variants that are not plain chat models, or experiments that vanish
const GEMINI_EXCLUDE = /tts|image|audio|live|thinking|embedding|exp\b/i;
const GEMINI_MAX_CANDIDATES = 6;

const MAX_TURNS = 12;
const MAX_CHARS = 1500;

/* ---- page context ----
   Where the visitor is, as the page reports it. Untrusted input like any
   other: the path must look like one of the site's own, the hovered name is
   clipped and stripped of brackets (so it can never spell a token) and
   control characters, and anything else is dropped rather than repaired. */
const PATH_RX = /^\/[A-Za-z0-9\-_.~/#?=&,%+]{0,159}$/;
const PAGE_NAMES = [
  [/^\/$/, "the landing page"],
  [/^\/projects/, "the projects page"],
  [/^\/skills/, "the skills map"],
  [/^\/about/, "the about page"],
  [/^\/resume/, "the resume page"],
  [/^\/art/, "the art gallery"],
];

function chatContext(raw) {
  if (!raw || typeof raw !== "object") return null;
  let path = typeof raw.path === "string" ? raw.path.trim() : "";
  if (!PATH_RX.test(path)) path = "";
  const hovered =
    typeof raw.hovered === "string"
      ? raw.hovered
          .replace(/[\u0000-\u001f\u007f[\]]+/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 80)
      : "";
  /* the head's current look (ghost, lattice, ghost+lattice): a remembered
     trick, so "why do you look like that" and "go back to normal" make sense */
  const look = typeof raw.look === "string" && /^[a-z+]{1,24}$/.test(raw.look) ? raw.look : "";
  /* what the previous reply cost, as the page shows it: numbers and a model
     id only, so "it was 9 cents" can be answered from the facts */
  let last = null;
  if (raw.last && typeof raw.last === "object") {
    const cents = Number(raw.last.cents);
    const wroteCents = Number(raw.last.wroteCents);
    const model = typeof raw.last.model === "string" && /^[a-z0-9.-]{1,40}$/.test(raw.last.model) ? raw.last.model : "";
    if (Number.isFinite(cents) && cents >= 0 && cents < 1000) {
      last = {
        cents,
        wrote: raw.last.wrote === true,
        wroteCents: Number.isFinite(wroteCents) && wroteCents > 0 && wroteCents < 1000 ? wroteCents : 0,
        model,
      };
    }
  }
  const tricks = Number(raw.tricks);
  const tricksSeen = Number.isFinite(tricks) && tricks >= 0 ? Math.min(99, Math.floor(tricks)) : 0;
  /* a trick the visitor started from the help sheet's buttons: the page has
     already performed it; the model only remarks on it (see contextLine) */
  const performed = typeof raw.performed === "string" && PILL_RX.test(raw.performed) ? raw.performed : "";
  /* a look that the press switched off on the side (a ghost under the new
     halftone, the halftone under a new ghost, wire under halftone or back) */
  const undid = performed && typeof raw.undid === "string" && /^(ghost|lattice|wire)$/.test(raw.undid) ? raw.undid : "";
  if (!path && !hovered && !look && !last && !tricksSeen && !performed) return null;
  return { path, hovered, look, last, tricks: tricksSeen, performed, undid };
}

/* "9.0 cents", "0.03 cents", "a few hundredths of a cent" */
function centsWords(cents) {
  if (cents >= 1) return cents.toFixed(1) + " cents";
  if (cents >= 0.1) return cents.toFixed(2) + " cents";
  return "a few hundredths of a cent";
}

/* One sentence of fact, then the rule for using it. The rule rides along
   with every context line rather than living only in the cached prompt, so
   even the providers that see it as user text know it is not conversation. */
function contextLine(context) {
  const page = PAGE_NAMES.find(([rx]) => rx.test(context.path || ""));
  let where = page ? page[1] : context.path ? "the page " + context.path : "the site";
  if (/^\/resume[^#]*#diploma/.test(context.path || "")) where += ", with the diploma open";
  let line = "The visitor is on " + where + (context.path ? " (" + context.path + ")" : "") + ".";
  if (context.hovered) {
    const card = /^\/projects/.test(context.path || "") ? "the project card for " : "the card for ";
    line += " They are looking at " + card + context.hovered + ".";
  }
  /* the look, named so a request for the look already on can be answered as
     "already so" rather than as a change; the default is said too, so "show
     me the normal one" on a normal head is not described as a return */
  if (context.look) {
    const words = context.look
      .split("+")
      .map((k) => (k === "lattice" ? "lattice (the halftone)" : k === "wire" ? "wire (the wireframe)" : k))
      .join(" and ");
    line +=
      " The head is currently in its " + words +
      " look, which this visitor asked for earlier; it stays until they ask for the default (cloud) back." +
      " If they ask for that same look again it is already so: say so, and do not describe a change.";
    /* the ghost fades the dots, and under the wire the dots are not drawn
       at all: a ghost under the wire is on but shows nothing */
    if (/ghost/.test(context.look) && /wire/.test(context.look)) {
      line +=
        " The ghost is on underneath, but it shows nothing while the wireframe is on - the dots it fades are not drawn;" +
        " it will show again when the wire comes off. Never describe the head as see-through right now.";
    }
    /* the halftone is a solid print with no gaps: it and the ghost replace
       each other, so a request for one while the other is on is a swap */
    if (/ghost/.test(context.look) && !/lattice/.test(context.look)) {
      line += " If they ask for the halftone (lattice), the ghost goes off with it: the print is a solid frame with no gaps, nothing shows through it.";
    }
    if (/lattice/.test(context.look)) {
      line += " If they ask for the ghost, the halftone comes off to make room for it: a solid print has no gaps for a ghost.";
    }
  } else {
    line +=
      " The head is in its default look, the plain point cloud; no look is on, nothing to undo." +
      " If they ask for the plain, normal or default head it is already so: say so, and do not describe a change.";
  }
  if (context.last) {
    const who = /haiku/.test(context.last.model) ? "Haiku" : /sonnet/.test(context.last.model) ? "Sonnet" : context.last.model ? "a backup model" : "";
    line +=
      " The reply before this one cost " + centsWords(context.last.cents) + " of the owner's API bill" +
      (who ? " (answered by " + who + ")" : "") +
      (context.last.wrote
        ? ", plus " + (context.last.wroteCents > 0 ? centsWords(context.last.wroteCents) : "a one-off charge") + " to write the site's knowledge into the one-hour cache after an idle hour"
        : "") +
      "; the visitor can see this in the workings drawer.";
  }
  if (context.performed) {
    line +=
      " The visitor just pressed the '" + context.performed.replace(/-off$/, "") + "' button in the help sheet, and the head is already " +
      (PILL_WORDS[context.performed] || "doing it") + ": the page performed it, not you.";
    /* what the press switched off on the side, so the line can say so */
    if (context.undid === "ghost") {
      line += " That press also switched the ghost off: the halftone is a solid print with no gaps, so a ghost cannot show through it.";
    } else if (context.undid === "lattice") {
      line += " The halftone came off to make room: it is a solid print with no gaps, so the ghost could not show through it.";
    } else if (context.undid === "wire") {
      line += " The wireframe came off to make room: the halftone and the wire are one at a time.";
    }
    /* a ghost switched on or off under the wire changes nothing on screen
       (the dots are not drawn); a wire put over a ghost hides it */
    if (/^ghost(-off)?$/.test(context.performed) && /wire/.test(context.look || "")) {
      line +=
        " But under the wireframe that makes no visible difference - the dots the ghost fades are not drawn -" +
        " so say that, dryly, rather than describing a fade; the ghost will show once the wire comes off.";
    } else if (context.performed === "wire" && /ghost/.test(context.look || "")) {
      line += " The ghost that was on stays on underneath, invisible until the wire comes off.";
    }
    line +=
      " Reply with one short line about it in your voice - a remark, not a description, fifteen words or fewer -" +
      " and never open with a [[token]]: the trick has happened.";
  }
  /* a die for the turn, and a trick for it: when the visitor says "you
     choose", the model takes these instead of always reaching for the first
     option (or the ghost) */
  const roll = 1 + Math.floor(Math.random() * 6);
  const pool = (context.tricks || 0) < 3 ? SHOWY_TRICKS : TRICKS;
  const trick = pool[Math.floor(Math.random() * pool.length)];
  return (
    "Page context, from the site itself: " +
    line +
    ' Use it silently to resolve "this", "this one", "here" and "where am I"; ' +
    "never mention it, the page or the card unless they ask." +
    " Roll for this turn: " + roll + " of 6. Trick for this turn: " + trick + "."
  );
}

/* for the providers without a system role mid-conversation: the context
   rides at the top of the last user turn, bracketed so it reads as a note */
function withContextPrefix(messages, context) {
  if (!context) return messages;
  const out = messages.slice();
  const i = out.length - 1;
  out[i] = { role: out[i].role, content: "(" + contextLine(context) + ")\n\n" + out[i].content };
  return out;
}

/* The free providers have no site-wide daily budget. An invented ceiling only
   ever turned people away while free quota sat unused; the providers already
   stop when they are out, and the chain says so in as many words. The one paid
   provider, Claude, is different: it is metered in dollars (anthropicWithinBudget
   below) and simply drops out of the chain for the rest of the UTC day once
   today's ceiling is spent, so the free tiers take over rather than the bill.
   What is left is a per-visitor guard, and it is an abuse guard rather than a
   budget. The day's entire free allowance is roughly 530 questions, so with no
   cap at all a single loop drains it in minutes and leaves real visitors with
   nothing until the reset. 100 is many times what an engaged visitor asks -
   only the owner testing hard has ever met it - while holding any one machine
   to under a fifth of the day. DAILY_PER_IP 0 means genuinely unlimited.
   None of this is about money for the free providers, which fail closed. The
   paid one is metered in cents (below), and that meter fails closed too: if it
   cannot be read or written, Claude drops out and the free tiers answer. */
const num = (v, fallback) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const perIpCap = (env) => num(env.DAILY_PER_IP, 0);

/* ---- provider health ----
   When a backend reports a quota error we park it for the rest of the UTC day
   and fall through to the next one; any other failure parks it for 5 minutes
   so a blip doesn't take the chat down. Requires a CHAT_KV binding — without
   it the chain still falls through on error, it just doesn't remember. */

const today = () => new Date().toISOString().slice(0, 10);

/* Returns the reason a provider is benched ("quota" | "error") or null. Both
   are truthy, so callers can still treat it as a boolean, but knowing which is
   what lets the chain tell "we are out for today" from "something is broken". */
async function isParked(env, name) {
  if (!env.CHAT_KV) return null;
  return await env.CHAT_KV.get("down:" + name + ":" + today());
}

async function park(env, name, err) {
  if (!env.CHAT_KV) return;
  // "usage limits" is the wording of Anthropic's Console spend limit, which
  // answers 400 rather than 429 and lifts at the start of the month
  const quota = /\b429\b|quota|rate.?limit|exhaust|usage limits?/i.test(String(err && err.message));
  /* A provider that says how long to wait (Anthropic's retry-after, usually a
     per-minute limit) is believed, within a minute-to-an-hour clamp; the
     durations below are the fallback for providers that do not say. */
  const hinted =
    err && Number.isFinite(err.retryAfter)
      ? Math.min(3600, Math.max(60, Math.round(err.retryAfter)))
      : null;
  await env.CHAT_KV.put("down:" + name + ":" + today(), quota ? "quota" : "error", {
    /* Quota errors used to bench a provider until UTC midnight. Two things
       were wrong with that. A 429 can mean "too many this minute" as easily as
       "too many today", so a brief burst threw away the rest of the day's
       capacity. And Gemini's daily quota resets at Pacific midnight, which is
       late afternoon UTC, so benching until UTC midnight could overshoot by
       most of a day. Retrying every 90 minutes costs one failed request per
       attempt and recovers on its own whenever the provider's window actually
       rolls over, whatever timezone it keeps. */
    expirationTtl: hinted || (quota ? 5400 : 300),
  });
}

async function tally(env, name) {
  if (!env.CHAT_KV) return;
  const key = "used:" + name + ":" + today();
  const n = parseInt((await env.CHAT_KV.get(key)) || "0", 10) + 1;
  await env.CHAT_KV.put(key, String(n), { expirationTtl: 172800 });
}

/* ---- model memory ----
   Three small KV records keep the Gemini choice self-steering without adding
   a write per request (KV's free tier is write-bound, and tally() already
   spends one):
     models:gemini  the discovered, ranked candidate list, refreshed daily
     good:gemini    the id that last answered - tried first, rewritten only
                    when it changes
     bad:gemini     { id: expiresAtMs } for ids that 404'd (retired) or
                    429'd before ever working (not on this key's free tier) */

const parseVersion = (id) => {
  const m = id.match(/gemini-(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : 0;
};
const isStableId = (id) => /^gemini-\d+(?:\.\d+)?-flash-lite$/.test(id);

async function discoverGemini(env) {
  const ids = [];
  let pageToken = "";
  try {
    for (let page = 0; page < 5; page++) {
      const res = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200" +
          (pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : "") +
          "&key=" +
          env.GEMINI_KEY
      );
      if (!res.ok) return null;
      const data = await res.json();
      for (const m of data.models || []) {
        const id = String(m.name || "").replace(/^models\//, "");
        const methods = m.supportedGenerationMethods || [];
        if (!GEMINI_FAMILY.test(id) || GEMINI_EXCLUDE.test(id)) continue;
        if (!methods.includes("generateContent") && !methods.includes("streamGenerateContent")) continue;
        ids.push(id);
      }
      pageToken = data.nextPageToken || "";
      if (!pageToken) break;
    }
  } catch (err) {
    return null;
  }
  if (!ids.length) return null;
  /* newest version first; within a version the plain stable id beats dated
     or preview variants, which stay in the list only as deeper fallbacks */
  ids.sort(
    (a, b) =>
      parseVersion(b) - parseVersion(a) ||
      Number(isStableId(b)) - Number(isStableId(a)) ||
      a.length - b.length
  );
  return Array.from(new Set(ids)).slice(0, GEMINI_MAX_CANDIDATES);
}

async function readJson(env, key, fallback) {
  if (!env.CHAT_KV) return fallback;
  try {
    const raw = await env.CHAT_KV.get(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (err) {
    return fallback;
  }
}

/* Without a KV binding (dev, or a misconfigured deploy) the same memory
   lives in the isolate instead - a warm worker serves many requests, which
   is enough to stop every request re-listing models and re-walking the
   candidates. With KV bound these are not consulted. */
let memList = { list: null, at: 0 };
let memGood = null;
const memBad = new Map(); // id -> expiresAtMs

const badKey = (id) => "bad:gemini:" + id;

async function isBenched(env, id) {
  if (!env.CHAT_KV) return (memBad.get(id) || 0) > Date.now();
  try {
    return !!(await env.CHAT_KV.get(badKey(id)));
  } catch (err) {
    return false;
  }
}

async function geminiCandidates(env) {
  let list = null;
  if (!env.CHAT_KV && memList.list && Date.now() - memList.at < 3600 * 1000) {
    list = memList.list;
  } else {
    list = await readJson(env, "models:gemini", null);
    if (!list) {
      list = await discoverGemini(env);
      if (env.CHAT_KV) {
        try {
          /* a failed discovery is cached as well - as the seed, for an hour -
             or every request would pay for a models.list round trip */
          await env.CHAT_KV.put("models:gemini", JSON.stringify(list || GEMINI_MODELS), {
            expirationTtl: list ? 86400 : 3600,
          });
        } catch (err) {
          /* over KV budget: carry on uncached this once */
        }
      }
    }
    if (!list || !list.length) list = GEMINI_MODELS;
    memList = { list, at: Date.now() };
  }
  let good = memGood;
  if (env.CHAT_KV) {
    try {
      good = await env.CHAT_KV.get("good:gemini");
    } catch (err) {
      good = null;
    }
  }
  const pool = Array.from(new Set((good ? [good] : []).concat(list)));
  const benched = await Promise.all(pool.map((id) => isBenched(env, id)));
  const ordered = pool.filter((id, i) => !benched[i]);
  if (ordered.length) return { candidates: ordered, good, benchable: true };
  /* everything is benched: try the seed anyway rather than give up - a wrong
     bench must never take the provider down for good - but bench nothing on
     this pass, or every request in this state would re-write the same keys */
  const seedBenched = await Promise.all(GEMINI_MODELS.map((id) => isBenched(env, id)));
  const seed = GEMINI_MODELS.filter((id, i) => !seedBenched[i]);
  return { candidates: seed.length ? seed : GEMINI_MODELS, good, benchable: false };
}

async function remember(env, id) {
  if (!id) return;
  memGood = id;
  if (!env.CHAT_KV) return;
  try {
    await env.CHAT_KV.put("good:gemini", id, { expirationTtl: 30 * 86400 });
  } catch (err) {
    /* fine - the next success tries again */
  }
}

async function bench(env, id, ms) {
  if (!env.CHAT_KV) {
    memBad.set(id, Date.now() + ms);
    return;
  }
  try {
    /* one key per id with KV's own expiry - no read-modify-write, so
       concurrent invocations cannot lose each other's benches */
    await env.CHAT_KV.put(badKey(id), String(Date.now() + ms), {
      expirationTtl: Math.max(60, Math.ceil(ms / 1000)),
    });
  } catch (err) {
    /* fine - the id is simply retried next time */
  }
}

const ALLOWED_ORIGINS = [
  "https://hydermohyuddin.com",
  "https://www.hydermohyuddin.com",
  "http://localhost:3000",
  "http://localhost:3457",
];

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "access-control-allow-origin": allow,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    // the page shows which model answered; without this a browser cannot read them
    "access-control-expose-headers": "x-chat-model, x-chat-provider",
    "access-control-max-age": "86400",
  };
}

function textStream() {
  const { readable, writable } = new TransformStream();
  return { readable, writer: writable.getWriter() };
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("origin") || "";
    const cors = corsHeaders(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method === "GET" && new URL(request.url).pathname === "/health") {
      const names = ["gemini", "anthropic", "workers-ai"];
      const out = {};
      for (const n of names) {
        const configured =
          (n === "gemini" && !!env.GEMINI_KEY) ||
          (n === "anthropic" && !!env.ANTHROPIC_KEY) ||
          (n === "workers-ai" && !!env.AI);
        if (!configured) continue;
        out[n] = {
          parked: env.CHAT_KV ? await env.CHAT_KV.get("down:" + n + ":" + today()) : null,
          usedToday: env.CHAT_KV
            ? parseInt((await env.CHAT_KV.get("used:" + n + ":" + today())) || "0", 10)
            : null,
        };
      }
      if (out.gemini && env.CHAT_KV) {
        out.gemini.model = (await env.CHAT_KV.get("good:gemini")) || null;
        out.gemini.candidates = await readJson(env, "models:gemini", null);
        try {
          const keys = await env.CHAT_KV.list({ prefix: "bad:gemini:" });
          out.gemini.benched = (keys.keys || []).map((k) => k.name.slice("bad:gemini:".length));
        } catch (err) {
          out.gemini.benched = null;
        }
      }
      if (out["workers-ai"]) out["workers-ai"].model = WORKERS_AI_MODEL;
      if (out.anthropic) {
        const rec = await anthropicRecord(env);
        out.anthropic.model = ANTHROPIC_MODEL;
        out.anthropic.light = LIGHT_MODEL;
        out.anthropic.usedToday = rec.n;
        out.anthropic.spentTodayCents = Math.round(rec.cents * 100) / 100;
        if (rec.unreadable) out.anthropic.meter = "unreadable - Claude is skipped until it reads again";
        if (Date.now() < meterDownUntil) out.anthropic.meter = "a spend write failed - Claude paused for a few minutes";
        out.anthropic.budgetCents = anthropicBudgetCents(env);
        // the last request's token split: cacheRead > 0 proves the prompt cache is working
        out.anthropic.lastRequest = rec.last || null;
        out.anthropic.cache = {
          hits: rec.hits || 0,
          misses: rec.misses || 0,
          hitRate:
            (rec.hits || 0) + (rec.misses || 0) > 0
              ? Math.round((100 * (rec.hits || 0)) / ((rec.hits || 0) + (rec.misses || 0))) + "%"
              : null,
        };
        out.anthropic.lastError = env.CHAT_KV ? await readJsonKey(env, "err:anthropic") : null;
      }
      out.budget = {
        rateLimiting: perIpCap(env) > 0 ? `${perIpCap(env)} per visitor per day` : "off",
        boundedBy: env.ANTHROPIC_KEY
          ? `Claude: ${anthropicBudgetCents(env)} cents per UTC day, then the free tiers`
          : "the providers' free tiers only",
      };
      return new Response(JSON.stringify(out, null, 2), {
        headers: { ...cors, "content-type": "application/json" },
      });
    }
    if (request.method !== "POST") {
      return new Response("POST only", { status: 405, headers: cors });
    }

    // CORS headers only restrain browsers — a script can ignore them entirely.
    // Enforce the allowlist server-side so the quota can't be drained by curl.
    if (!ALLOWED_ORIGINS.includes(origin)) {
      return new Response("This endpoint only serves hydermohyuddin.com.", {
        status: 403,
        headers: { ...cors, "content-type": "text/plain; charset=utf-8" },
      });
    }

    let body;
    try {
      body = await request.json();
    } catch (err) {
      return new Response("bad json", { status: 400, headers: cors });
    }

    const incoming = Array.isArray(body.messages) ? body.messages : [];
    const messages = incoming
      .filter((m) => m && (m.role === "user" || m.role === "assistant"))
      .slice(-MAX_TURNS)
      .map((m) => ({ role: m.role, content: String(m.content || "").slice(0, MAX_CHARS) }));

    if (!messages.length || messages[messages.length - 1].role !== "user") {
      return new Response("no question", { status: 400, headers: cors });
    }
    const context = chatContext(body.context);

    /* Crude per-visitor daily cap, and only when a KV namespace is bound and
       a cap is configured - with no cap there is no KV read and no KV write
       per request at all, which is what kept KV's daily write budget from
       ever being the binding constraint. The counter is charged after a
       model actually answers, further down: a request that every backend
       refused should not cost the visitor one of their questions. */
    let charge = null;
    if (env.CHAT_KV && perIpCap(env) > 0) {
      const ip = request.headers.get("cf-connecting-ip") || "anon";
      const ipKey = `c:${today()}:${ip}`;
      const usedIp = parseInt((await env.CHAT_KV.get(ipKey)) || "0", 10);
      if (usedIp >= perIpCap(env)) {
        /* Say the number, say that it is per visitor, and say when it lifts.
           Without all three a visitor cannot tell whether they are throttled,
           banned, or looking at a broken site - and the honest answer is the
           least alarming of the three. */
        return new Response(
          `That's ${perIpCap(env)} questions from here today, which is the limit for one visitor — ` +
            `it resets overnight, so come back tomorrow. If it's urgent, ` +
            `hyder.mohyuddin@gmail.com reaches me directly.`,
          { status: 429, headers: { ...cors, "content-type": "text/plain; charset=utf-8" } }
        );
      }
      charge = () => env.CHAT_KV.put(ipKey, String(usedIp + 1), { expirationTtl: 172800 });
    }

    const headers = {
      ...cors,
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    };

    // Try each configured backend in turn. Claude first while today's dollar
    // meter has room (its prompt cache makes the large knowledge prompt cheap);
    // Gemini's free tier catches the overflow, and Workers AI the overflow of that.
    const chain = [];
    if (env.ANTHROPIC_KEY) {
      chain.push({
        name: "anthropic",
        run: () => anthropicStream(env, messages, ctx, context),
        gate: () => anthropicWithinBudget(env),
        counts: false, // anthropicStream records its own count, with the cost
      });
    }
    if (env.GEMINI_KEY) chain.push({ name: "gemini", run: () => geminiStream(env, messages, context) });
    if (env.AI) chain.push({ name: "workers-ai", run: () => workersAiStream(env, messages, context) });

    try {
      let lastError = null;
      let outOfQuota = false;
      for (const provider of chain) {
        const parked = await isParked(env, provider.name);
        if (parked) {
          if (parked === "quota") outOfQuota = true;
          continue;
        }
        if (provider.gate) {
          /* Over today's budget, or the meter cannot be read: the next provider
             is free, so when in doubt it is the one that answers. */
          let open = false;
          try {
            open = await provider.gate();
          } catch (kv) {
            open = false;
          }
          if (!open) continue;
        }
        try {
          const out = await provider.run();
          const stream = out.stream || out;
          /* Bookkeeping is deliberately outside the provider's failure path.
             KV allows a limited number of writes per day; when that runs out
             the put throws, and if that throw were caught below it would look
             like a provider failure and bench a perfectly healthy model - then
             the next one, and the next, until every provider was parked and
             the bot returned 502 to everyone until midnight. Counting is worth
             less than answering, so a failed count is swallowed. */
          try {
            if (provider.counts !== false) await tally(env, provider.name);
            if (charge) await charge();
          } catch (bookkeeping) {
            // over KV budget, or a write blip: answer anyway, uncounted
          }
          return new Response(stream, {
            headers: {
              ...headers,
              "x-chat-provider": provider.name,
              ...(out.model ? { "x-chat-model": out.model } : {}),
            },
          });
        } catch (err) {
          lastError = err;
          if (/\b429\b|quota|rate.?limit|exhaust/i.test(String(err && err.message))) {
            outOfQuota = true;
          }
          try {
            await park(env, provider.name, err);
          } catch (kv) {
            // over KV budget: remembering the outage is a nicety, falling
            // through to the next provider is the point
          }
        }
      }
      /* Every backend is unavailable. If that is because the free tiers are
         spent, say so plainly - "come back tomorrow" is a completely different
         message from "this is broken", and a visitor who gets the wrong one
         either gives up on a working site or waits for a fix that isn't
         coming. Quota is by far the likelier of the two. */
      if (outOfQuota) {
        return new Response(
          "I've used up today's free AI allowance — it resets overnight, so try me again tomorrow. If you'd rather not wait, hyder.mohyuddin@gmail.com reaches the actual human.",
          { status: 429, headers }
        );
      }
      if (lastError) throw lastError;
      return new Response("No model backend is configured.", { status: 500, headers });
    } catch (err) {
      return new Response("The chat backend is unavailable right now.", {
        status: 502,
        headers,
      });
    }
  },
};

/* ---- the question sizer ----
   One short Haiku call: a digit for complexity and a word for kind. Any
   failure, or anything slower than the timeout, means "no sizing" and the
   answer runs at the pinned low effort - never a blocked reply. */
async function sizeUp(env, messages) {
  const t0 = Date.now();
  const last = messages[messages.length - 1];
  const prior = messages
    .slice(-3, -1)
    .map((m) => (m.role === "user" ? "visitor" : "head") + ": " + m.content.slice(0, 200))
    .join(NEWLINE);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SIZER_TIMEOUT_MS);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: ctrl.signal,
      headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: SIZER_MODEL,
        max_tokens: 12,
        thinking: { type: "disabled" },
        output_config: { effort: "low" },
        system: SIZER_PROMPT,
        messages: [{ role: "user", content: (prior ? "Earlier:" + NEWLINE + prior + NEWLINE + NEWLINE : "") + "Question: " + last.content }],
      }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const text = ((json.content || []).find((b) => b.type === "text") || {}).text || "";
    const m = text.trim().match(/^([1-5])\s*[-:.,]?\s*([a-z]+)?/i);
    if (!m) return null;
    const u = json.usage || {};
    return {
      complexity: parseInt(m[1], 10),
      kind: (m[2] || "other").toLowerCase().slice(0, 12),
      ms: Date.now() - t0,
      cents: (tokens(u.input_tokens) * SIZER_PRICE.input + tokens(u.output_tokens) * SIZER_PRICE.output) / 10000,
    };
  } catch (err) {
    return null; // timed out or unreachable: unsized
  } finally {
    clearTimeout(timer);
  }
}

/* the closing record every reply carries. Flat on purpose, and without
   arrays, so "]]" can never occur inside it and the page can find its end. */
const statsToken = (fields) => NEWLINE + "[[stats:" + JSON.stringify(fields) + "]]";
/* the model's reasoning is for the visitor's eyes, but never the prompt:
   the same leak markers the guard uses, on the summary */
const LEAK_RX = /you are hyder mohyuddin|everything you know about yourself|knowledge:|# hyder mohyuddin|voice: dry/i;

/* ---- Workers AI: SSE in, plain text out ---- */
async function workersAiStream(env, messages, context) {
  const t0 = Date.now();
  const sse = await env.AI.run(WORKERS_AI_MODEL, {
    messages: [{ role: "system", content: PROMPT }, ...withContextPrefix(messages, context)],
    stream: true,
    max_tokens: 600,
  });

  const { readable, writer } = textStream();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  (async () => {
    const guard = createLeakGuard((text) => writer.write(encoder.encode(text)));
    const reader = sse.getReader();
    let buffer = "";
    let usage = null;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          try {
            const json = JSON.parse(payload);
            if (json.response) await guard.push(json.response);
            if (json.usage) usage = json.usage;
          } catch (err) {
            /* skip malformed frame */
          }
        }
      }
      await guard.end();
      await writer.write(
        encoder.encode(
          statsToken({
            provider: "workers-ai",
            model: WORKERS_AI_MODEL,
            ms: Date.now() - t0,
            in: tokens(usage && usage.prompt_tokens),
            out: tokens(usage && usage.completion_tokens),
          })
        )
      );
    } finally {
      await writer.close();
    }
  })();

  return { stream: readable, model: WORKERS_AI_MODEL };
}

/* ---- Anthropic: SSE in, plain text out ----
   Claude Sonnet 5.5 with adaptive thinking at low effort (thinking cannot be
   switched off on this model; low keeps it to a few tokens and skips it on
   simple questions). The knowledge prompt is byte-identical on every request,
   so it sits in a 1-hour prompt cache: its tokens are read back at a tenth of
   the input price instead of being paid in full each time. Visitors arrive
   minutes apart, which is exactly the gap the 5-minute default cache would miss.
   Every response's token usage is priced and added to today's spend record,
   which is what anthropicWithinBudget reads.
   Page context, when the page sent any, goes in as a mid-conversation
   system message AFTER the last user turn (the operator channel Claude
   Sonnet 5.5 accepts inside `messages`, no beta needed): it sits behind the
   cached prefix instead of changing it. */
async function anthropicStream(env, messages, ctx, context) {
  const t0 = Date.now();
  /* a help-sheet trick button wants one quick line and nothing to size up:
     straight to Haiku at low effort, the sizer's round trip saved */
  const pill = !!(context && context.performed);
  const size = pill ? null : await sizeUp(env, messages);
  const { model, effort } = pill ? { model: LIGHT_MODEL, effort: "low" } : routeFor(size);
  const light = model === LIGHT_MODEL;
  /* the effort message sits right before the question it applies to; the
     context line, when there is one, stays last */
  const turns = messages.slice();
  if (effort !== "low") turns.splice(turns.length - 1, 0, { role: "system", content: [], output_config: { effort } });
  if (context) turns.push({ role: "system", content: contextLine(context) });
  const headers = {
    "content-type": "application/json",
    "x-api-key": env.ANTHROPIC_KEY,
    "anthropic-version": "2023-06-01",
  };
  /* Sonnet: a safety-classifier decline is re-run server-side on the model
     Anthropic recommends for that category, instead of coming back as a
     blank reply; the second beta is the per-turn effort message. Haiku has
     no server-side fallback and never gets an effort message. */
  if (!light) headers["anthropic-beta"] = "server-side-fallback-2026-07-01,mid-conversation-output-config-2026-07-01";
  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      // thinking counts toward this even though its text is not returned; the
      // daily meter is the spend cap, so headroom here is cheap insurance
      max_tokens: 4096,
      // each model keeps its own copy of the prompt in cache (caches are per model)
      system: [{ type: "text", text: PROMPT, cache_control: { type: "ephemeral", ttl: "1h" } }],
      messages: turns,
      // summarised reasoning comes back as thinking text, for the workings drawer
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: "low" },
      ...(light ? {} : { fallbacks: "default" }),
      stream: true,
    }),
  });

  if (!upstream.ok || !upstream.body) {
    /* Keep the body: a 400 here means the request shape is wrong and the chain
       would otherwise fall through to Gemini forever with nothing to read but
       "error" in a parked key. /health shows this as anthropic.lastError. */
    let detail = "";
    try {
      detail = (await upstream.text()).slice(0, 300);
    } catch (e) {
      // no body
    }
    await noteAnthropicError(env, upstream.status, detail);
    const err = new Error("anthropic " + upstream.status + " " + detail);
    if (upstream.status === 429) {
      const wait = parseInt(upstream.headers.get("retry-after") || "", 10);
      if (Number.isFinite(wait) && wait > 0) err.retryAfter = wait;
    }
    throw err;
  }

  const { readable, writer } = textStream();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const pump = (async () => {
    const guard = createLeakGuard((text) => writer.write(encoder.encode(text)));
    const reader = upstream.body.getReader();
    const usage = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 };
    let stopReason = null;
    let streamError = null;
    let emitted = 0;
    let buffer = "";
    /* the reasoning goes straight to the page as it arrives, outside the
       guard (which holds the opening of the ANSWER); its own leak check
       swaps the rest of a summary that starts quoting the prompt */
    let thinking = "";
    let thinkOpen = false;
    let thinkMuted = false;
    let firstText = 0;
    const raw = (text) => writer.write(encoder.encode(text));
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(NEWLINE);
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;
          let json;
          try {
            json = JSON.parse(payload);
          } catch (err) {
            continue; // malformed frame
          }
          if (json.type === "content_block_start" && json.content_block && json.content_block.type === "thinking") {
            if (!thinkOpen) {
              thinkOpen = true;
              await raw("[[think]]");
            }
          } else if (json.type === "content_block_delta" && json.delta && json.delta.type === "thinking_delta") {
            const piece = String(json.delta.thinking || "").replace(/\[\[/g, "[ [");
            if (piece && thinkOpen && !thinkMuted) {
              thinking += piece;
              if (LEAK_RX.test(thinking)) {
                thinkMuted = true;
                await raw(" (the rest of this I keep to myself)");
              } else {
                await raw(piece);
              }
            }
          } else if (json.type === "content_block_stop" && thinkOpen && !firstText) {
            thinkOpen = false;
            await raw("[[/think]]");
          } else if (json.type === "content_block_delta" && json.delta && json.delta.type === "text_delta") {
            // fallback blocks are skipped: only visible text reaches the page
            if (thinkOpen) {
              thinkOpen = false;
              await raw("[[/think]]");
            }
            if (!firstText) firstText = Date.now() - t0;
            emitted += json.delta.text.length;
            await guard.push(json.delta.text);
          } else if (json.type === "message_start" && json.message && json.message.usage) {
            readUsage(usage, json.message.usage);
          } else if (json.type === "message_delta") {
            if (json.usage) readUsage(usage, json.usage);
            if (json.delta && json.delta.stop_reason) stopReason = json.delta.stop_reason;
          } else if (json.type === "error") {
            streamError = json.error || json;
          }
        }
      }
    } catch (err) {
      streamError = streamError || { type: "transport", message: String((err && err.message) || err) };
    }
    try {
      /* A blank bubble reads as a broken site, so every way a reply can end
         with nothing said gets a line in character instead. */
      if (stopReason === "refusal" && guard.pending()) {
        // nothing has reached the visitor yet - the guard still holds the
        // opening - so a declined answer, blank or fragment, is replaced whole
        await guard.discard("That one I'll leave unanswered.");
      } else if (!emitted && stopReason === "max_tokens") {
        await guard.push("I thought about that one for so long I ran out of room. Ask it again, shorter.");
      } else if (!emitted && !stopReason) {
        await guard.push("Lost the thread there - ask me that again.");
      }
      if (thinkOpen) await raw("[[/think]]");
      await guard.end();
      /* the reply's own cost: the tokens it read and wrote. Writing the
         prompt cache (the site's knowledge, after an idle hour) is a one-off
         the page shows on its own line, not as part of the step; the day's
         spend meter (recordAnthropicSpend) still counts everything */
      const writeCents = (usage.cacheWrite * priceOf(model).cacheWrite1h) / 10000;
      const cents = anthropicCents(usage, model) - writeCents + ((size && size.cents) || 0);
      await raw(
        statsToken({
          provider: "anthropic",
          model,
          ms: Date.now() - t0,
          ttfb: firstText,
          in: usage.input,
          cached: usage.cacheRead,
          cacheWrite: usage.cacheWrite,
          out: usage.output,
          think: thinking.length,
          stop: stopReason || (streamError ? "error" : "unknown"),
          effort,
          size: size ? { complexity: size.complexity, kind: size.kind, ms: size.ms, model: SIZER_MODEL, cents: round4(size.cents) } : null,
          cents: round4(cents),
          cacheWriteCents: round4(writeCents),
        })
      );
    } catch (gone) {
      // the visitor has left; nothing to say it to
    }
    try {
      await writer.close();
    } catch (closed) {
      // the reader went away first
    }
    if (streamError) await noteAnthropicError(env, 0, JSON.stringify(streamError));
    try {
      await recordAnthropicSpend(env, usage, stopReason || (streamError ? "error" : "unknown"), (size && size.cents) || 0, model);
    } catch (bookkeeping) {
      // the meter has already shut the Claude gate for a few minutes
    }
  })();
  // the response can finish before the bookkeeping does; keep the request alive for it
  if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(pump);

  return { stream: readable, model };
}

const tokens = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/* usage frames carry cumulative counts; later frames override earlier ones.
   When a server-side fallback ran, the top-level counts cover only the attempt
   that produced the reply and usage.iterations holds every attempt. */
function readUsage(acc, u) {
  if (Array.isArray(u.iterations) && u.iterations.length) {
    const sum = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 };
    for (const it of u.iterations) {
      const src = (it && it.usage) || it || {};
      sum.input += tokens(src.input_tokens);
      sum.cacheWrite += tokens(src.cache_creation_input_tokens);
      sum.cacheRead += tokens(src.cache_read_input_tokens);
      sum.output += tokens(src.output_tokens);
    }
    if (sum.input + sum.cacheWrite + sum.cacheRead + sum.output > 0) {
      Object.assign(acc, sum);
      return;
    }
  }
  if (typeof u.input_tokens === "number") acc.input = u.input_tokens;
  if (typeof u.cache_creation_input_tokens === "number") acc.cacheWrite = u.cache_creation_input_tokens;
  if (typeof u.cache_read_input_tokens === "number") acc.cacheRead = u.cache_read_input_tokens;
  if (typeof u.output_tokens === "number") acc.output = u.output_tokens;
}

/* The last Anthropic failure, for /health. Written only when it differs from
   the one already stored - a repeating failure costs a read, not a write. */
async function noteAnthropicError(env, status, body) {
  if (!env.CHAT_KV) return;
  try {
    const text = String(body || "").slice(0, 300);
    const prev = await readJsonKey(env, "err:anthropic");
    if (prev && prev.status === status && prev.body === text) return;
    await env.CHAT_KV.put(
      "err:anthropic",
      JSON.stringify({ at: new Date().toISOString(), status, body: text }),
      { expirationTtl: 7 * 86400 }
    );
  } catch (kv) {
    // remembering the error is a nicety
  }
}

/* ---- Claude spend meter ----
   One KV record per UTC day: { n, cents, last }. Read by the chain's gate, then
   read and rewritten once per answered request (in place of tally, so the KV
   write count per request is unchanged). Concurrent requests can lose an update
   to each other, so the figure is a close estimate; the hard stop is the monthly
   spend limit set in the Anthropic Console. The meter fails closed: a record
   that cannot be read, parsed or written keeps Claude out of the chain. */
const spendKey = () => "spend:anthropic:" + today();
let meterDownUntil = 0; // isolate-local: a failed spend write closes the gate for 5 minutes

async function readJsonKey(env, key) {
  try {
    const raw = await env.CHAT_KV.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}

/* null = could not read or parse (callers fail closed); a missing key is a zero record.
   n counts requests, hits/misses whether the prompt came from cache, cents everything. */
async function readSpend(env) {
  try {
    const raw = await env.CHAT_KV.get(spendKey());
    if (!raw) return { n: 0, cents: 0, hits: 0, misses: 0 };
    const rec = JSON.parse(raw);
    if (!rec || typeof rec !== "object") return null;
    return {
      n: Number(rec.n) || 0,
      cents: Number(rec.cents) || 0,
      hits: Number(rec.hits) || 0,
      misses: Number(rec.misses) || 0,
      last: rec.last,
    };
  } catch (err) {
    return null;
  }
}

async function anthropicRecord(env) {
  const rec = env.CHAT_KV ? await readSpend(env) : null;
  return rec || { n: 0, cents: 0, unreadable: true };
}

const anthropicCents = (u, model) => {
  const price = priceOf(model);
  return (u.input * price.input + u.cacheWrite * price.cacheWrite1h + u.cacheRead * price.cacheRead + u.output * price.output) / 10000; // tokens x (USD per million) -> cents
};

async function recordAnthropicSpend(env, usage, stop, extraCents = 0, model = ANTHROPIC_MODEL) {
  if (!env.CHAT_KV) return;
  try {
    const rec = await readSpend(env);
    if (!rec) throw new Error("spend record unreadable"); // never overwrite a day we cannot see
    const cents = anthropicCents(usage, model) + extraCents; // the sizer's Haiku call rides on the same meter
    const hit = usage.cacheRead > 0;
    const next = {
      n: rec.n + 1,
      cents: rec.cents + cents,
      hits: rec.hits + (hit ? 1 : 0),
      misses: rec.misses + (hit ? 0 : 1),
      last: { ...usage, cents: Math.round(cents * 1000) / 1000, stop, at: new Date().toISOString() },
    };
    await env.CHAT_KV.put(spendKey(), JSON.stringify(next), { expirationTtl: 172800 });
    meterDownUntil = 0;
  } catch (err) {
    meterDownUntil = Date.now() + 5 * 60 * 1000;
    throw err;
  }
}

async function anthropicWithinBudget(env) {
  const budget = anthropicBudgetCents(env);
  if (budget <= 0) return false;
  if (!env.CHAT_KV) return false; // nothing to meter with: the free tiers answer instead
  if (Date.now() < meterDownUntil) return false;
  const rec = await readSpend(env);
  if (!rec) return false;
  return rec.cents < budget;
}

/* ---- Google AI Studio: SSE in, plain text out ---- */
async function geminiStream(env, messages, context) {
  const t0 = Date.now();
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: PROMPT }] },
    contents: withContextPrefix(messages, context).map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    })),
    generationConfig: { maxOutputTokens: 600, temperature: 0.4 },
  });

  const { candidates, good, benchable } = await geminiCandidates(env);
  let upstream = null;
  let used = null;
  let lastStatus = 0;
  /* the remembered id is replaced only when it failed for its own reasons
     (retired, no access, no longer free) - a passing 5xx on it must not
     demote the newest model to whichever older one happened to answer */
  let goodGone = !good;
  for (const model of candidates) {
    const url =
      "https://generativelanguage.googleapis.com/v1beta/models/" +
      model +
      ":streamGenerateContent?alt=sse&key=" +
      env.GEMINI_KEY;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    if (res.ok && res.body) {
      upstream = res;
      used = model;
      break;
    }
    lastStatus = res.status;
    if (res.status === 400) {
      /* a 400 is about the request - empty text, a bad key, an unsupported
         region - not about the model: every id would say the same. Stop and
         let the chain park the provider for its usual five minutes. */
      break;
    }
    if (res.status === 429) {
      let burst = false;
      try {
        burst = /rate_limit|too_many|per minute/i.test(await res.text());
      } catch (err) {
        /* body unreadable: assume the longer bench */
      }
      if (model === good) {
        /* the id that has been answering hit its quota. Bench it past the
           provider's 90-minute park so the next cycle gets to try the rest
           of the list - otherwise an id that quietly left the free tier
           would lock Gemini out for as long as it stayed remembered. */
        goodGone = true;
        if (benchable) await bench(env, model, 2 * 3600 * 1000);
        break;
      }
      /* never answered: a per-minute burst sits out a minute; anything else
         two hours, as it is most likely not on this project's free tier */
      if (benchable) await bench(env, model, burst ? 60 * 1000 : 2 * 3600 * 1000);
      continue;
    }
    if (res.status === 404 || res.status === 403) {
      // retired or renamed, or this project has no access: out for a day;
      // the daily discovery refresh drops a retired id from the list for good
      if (model === good) goodGone = true;
      if (benchable) await bench(env, model, 24 * 3600 * 1000);
      continue;
    }
    // 5xx and the like: a blip, try the next id and bench nothing
  }
  if (!upstream) throw new Error("gemini " + lastStatus);
  if (goodGone && used !== good) await remember(env, used);

  const { readable, writer } = textStream();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  (async () => {
    const guard = createLeakGuard((text) => writer.write(encoder.encode(text)));
    const reader = upstream.body.getReader();
    let buffer = "";
    let meta = null;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(NEWLINE);
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;
          try {
            const json = JSON.parse(payload);
            const parts =
              json.candidates &&
              json.candidates[0] &&
              json.candidates[0].content &&
              json.candidates[0].content.parts;
            if (parts) {
              for (const part of parts) {
                if (part.text) await guard.push(part.text);
              }
            }
            if (json.usageMetadata) meta = json.usageMetadata;
          } catch (err) {
            /* skip malformed frame */
          }
        }
      }
      await guard.end();
      await writer.write(
        encoder.encode(
          statsToken({
            provider: "gemini",
            model: used,
            ms: Date.now() - t0,
            in: tokens(meta && meta.promptTokenCount),
            out: tokens(meta && meta.candidatesTokenCount),
            think: tokens(meta && meta.thoughtsTokenCount),
          })
        )
      );
    } finally {
      await writer.close();
    }
  })();

  return { stream: readable, model: used };
}
