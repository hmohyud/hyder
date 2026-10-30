/**
 * Cloudflare Worker backing the site chat.
 *
 * Contract (shared with chat-dev-server.mjs so the UI never changes):
 *   POST /chat  { messages: [{ role: "user" | "assistant", content: string }] }
 *   -> streams plain UTF-8 text chunks, no SSE framing for the client to parse.
 *
 * Two backends, picked by what is bound:
 *   - env.GEMINI_KEY    -> Google AI Studio (largest free request allowance)
 *   - env.ANTHROPIC_KEY -> proxied to the Anthropic API
 *   - env.AI            -> Workers AI (no key needed; runs on Cloudflare's GPUs)
 *
 * Optional env.CHAT_KV enables a crude per-IP daily cap.
 *
 * Deploy:
 *   npx wrangler deploy worker/chat-worker.js --name hyder-chat --compatibility-date 2026-01-01
 *   npx wrangler secret put ANTHROPIC_KEY        # only for the proxy path
 */

import { PROMPT } from "./knowledge.js";
import { createLeakGuard } from "./guard.js";

const NEWLINE = String.fromCharCode(10);

const WORKERS_AI_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
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

/* There is no site-wide daily budget. An invented ceiling only ever turned
   people away while free quota sat unused; the providers already stop when they
   are out, and the chain now says so in as many words.
   What is left is a per-visitor guard, and it is an abuse guard rather than a
   budget. The day's entire free allowance is roughly 530 questions, so with no
   cap at all a single loop drains it in minutes and leaves real visitors with
   nothing until the reset. 100 is many times what an engaged visitor asks -
   only the owner testing hard has ever met it - while holding any one machine
   to under a fifth of the day. DAILY_PER_IP 0 means genuinely unlimited.
   None of this is about money: every provider in the chain fails closed. */
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
  const quota = /\b429\b|quota|rate.?limit|exhaust/i.test(String(err && err.message));
  await env.CHAT_KV.put("down:" + name + ":" + today(), quota ? "quota" : "error", {
    /* Quota errors used to bench a provider until UTC midnight. Two things
       were wrong with that. A 429 can mean "too many this minute" as easily as
       "too many today", so a brief burst threw away the rest of the day's
       capacity. And Gemini's daily quota resets at Pacific midnight, which is
       late afternoon UTC, so benching until UTC midnight could overshoot by
       most of a day. Retrying every 90 minutes costs one failed request per
       attempt and recovers on its own whenever the provider's window actually
       rolls over, whatever timezone it keeps. */
    expirationTtl: quota ? 5400 : 300,
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
    "access-control-max-age": "86400",
  };
}

function textStream() {
  const { readable, writable } = new TransformStream();
  return { readable, writer: writable.getWriter() };
}

export default {
  async fetch(request, env) {
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
      out.budget = {
        rateLimiting: perIpCap(env) > 0 ? `${perIpCap(env)} per visitor per day` : "off",
        boundedBy: "the providers' free tiers only",
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

    // Try each configured backend in turn. Google's free tier is counted in
    // requests rather than tokens, so it absorbs a large knowledge prompt far
    // better; Workers AI then catches the overflow once that quota is spent.
    const chain = [];
    if (env.GEMINI_KEY) chain.push({ name: "gemini", run: () => geminiStream(env, messages) });
    if (env.ANTHROPIC_KEY) chain.push({ name: "anthropic", run: () => anthropicStream(env, messages) });
    if (env.AI) chain.push({ name: "workers-ai", run: () => workersAiStream(env, messages) });

    try {
      let lastError = null;
      let outOfQuota = false;
      for (const provider of chain) {
        const parked = await isParked(env, provider.name);
        if (parked) {
          if (parked === "quota") outOfQuota = true;
          continue;
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
            await tally(env, provider.name);
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

/* ---- Workers AI: SSE in, plain text out ---- */
async function workersAiStream(env, messages) {
  const sse = await env.AI.run(WORKERS_AI_MODEL, {
    messages: [{ role: "system", content: PROMPT }, ...messages],
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
          } catch (err) {
            /* skip malformed frame */
          }
        }
      }
      await guard.end();
    } finally {
      await writer.close();
    }
  })();

  return { stream: readable, model: WORKERS_AI_MODEL };
}

/* ---- Anthropic: SSE in, plain text out ---- */
async function anthropicStream(env, messages) {
  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 600,
      system: PROMPT,
      messages,
      stream: true,
    }),
  });

  if (!upstream.ok || !upstream.body) throw new Error("anthropic " + upstream.status);

  const { readable, writer } = textStream();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  (async () => {
    const guard = createLeakGuard((text) => writer.write(encoder.encode(text)));
    const reader = upstream.body.getReader();
    let buffer = "";
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
          if (!payload) continue;
          try {
            const json = JSON.parse(payload);
            if (
              json.type === "content_block_delta" &&
              json.delta &&
              json.delta.type === "text_delta"
            ) {
              await guard.push(json.delta.text);
            }
          } catch (err) {
            /* skip malformed frame */
          }
        }
      }
      await guard.end();
    } finally {
      await writer.close();
    }
  })();

  return { stream: readable, model: ANTHROPIC_MODEL };
}

/* ---- Google AI Studio: SSE in, plain text out ---- */
async function geminiStream(env, messages) {
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: PROMPT }] },
    contents: messages.map((m) => ({
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
          } catch (err) {
            /* skip malformed frame */
          }
        }
      }
      await guard.end();
    } finally {
      await writer.close();
    }
  })();

  return { stream: readable, model: used };
}
