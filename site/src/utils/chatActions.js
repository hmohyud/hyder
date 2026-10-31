/* Chat actions: the head can open things on the site.
 *
 * A reply may begin with exactly one token, in the same place the trick
 * tokens ([[ghost]], [[spin]], ...) go:
 *   [[act:skills:Python, PyTorch]]   skills map with those skills selected
 *   [[act:project:SPIM]]             projects page, scrolled to that card
 *   [[act:doc:diploma]]              the diploma (or doc:resume)
 *   [[act:page:about]]               a page: home, skills, projects, about, resume
 * The page turns the token into navigation before the words are shown.
 *
 * A guided tour is the one reply allowed more than one token. It opens with
 * [[tour]] and is then a sequence of stops, each an action token followed by
 * the sentence or two said at that stop:
 *   [[tour]][[act:project:SPIM]] First stop... [[act:skills:PyTorch]] Then...
 * The page plays the stops one at a time (splitTourSteps), navigating at each
 * and pausing long enough for the sentence to be read (tourPause). Nothing
 * here is shown or spoken: the tokens are stage directions.
 * Pure functions, tested offline by src/utils/chatActions.test.mjs.
 */

const ACT_RX = /^\[\[act:(page|skills|doc|project):([^\]]{1,240})\]\]\s*/i;

/** The action at the very start of `text`, or null. `length` is how much to strip. */
export function parseActToken(text) {
  const m = String(text || "").match(ACT_RX);
  if (!m) return null;
  return { kind: m[1].toLowerCase(), arg: m[2].trim(), length: m[0].length };
}

/** While a reply's opening is held back: could it still become a token? */
export function couldBeToken(held) {
  return /^\[\[?[a-z]*(:[^\]]*)?\]?\]?$/i.test(held);
}

/** How many characters to hold before deciding the opening is plain text. */
export function tokenCap(held) {
  return /^\[\[act:/i.test(held) ? 280 : 18;
}

/** Drop any further complete tokens at the start of the text: one token per
 *  reply is the rule, and a second one must not reach the visitor. */
export function stripExtraTokens(text) {
  let t = String(text || "");
  for (;;) {
    const m = t.match(/^\[\[[^\]]{1,240}\]\]\s*/);
    if (!m) break;
    t = t.slice(m[0].length);
  }
  return t;
}

/* ---------- the stream's envelope ----------
   The worker wraps a reply: an optional [[think]]...[[/think]] block first
   (the model's summarised reasoning, streamed as it thinks), then the reply,
   then one [[stats:{json}]] record at the very end. Neither is shown or
   spoken as text; both feed the workings drawer. */

const THINK_OPEN_RX = /^\[\[think\]\]/i;
const THINK_CLOSE = "[[/think]]";

/** The reasoning block's opening at the very start of `text`, or null. */
export function parseThinkOpen(text) {
  const m = String(text || "").match(THINK_OPEN_RX);
  return m ? { length: m[0].length } : null;
}

/**
 * Inside the reasoning block: what of `text` is reasoning, whether the block
 * closed, and what follows it. While open, a tail that could be the start of
 * the closing marker is held back rather than shown.
 */
export function splitThink(text) {
  const t = String(text || "");
  const at = t.indexOf(THINK_CLOSE);
  if (at >= 0) return { thought: t.slice(0, at), closed: true, rest: t.slice(at + THINK_CLOSE.length), hold: "" };
  const lb = t.lastIndexOf("[[");
  if (lb >= 0) {
    const tail = t.slice(lb);
    if (THINK_CLOSE.startsWith(tail)) return { thought: t.slice(0, lb), closed: false, rest: "", hold: tail };
  }
  if (t.endsWith("[")) return { thought: t.slice(0, -1), closed: false, rest: "", hold: "[" };
  return { thought: t, closed: false, rest: "", hold: "" };
}

/** Where to stop releasing `text`: a trailing "[[stats:" (or what could become
 *  one) is held back until the stream ends and parseStatsTail strips it. */
export function tailHold(text) {
  const t = String(text || "");
  const lb = t.lastIndexOf("[[");
  if (lb >= 0) {
    const tail = t.slice(lb);
    if (tail.startsWith("[[stats:") || "[[stats:".startsWith(tail)) return lb;
  }
  if (t.endsWith("[")) return t.length - 1;
  return t.length;
}

/** The stats record at the end of a finished reply, stripped off. */
export function parseStatsTail(text) {
  const t = String(text || "");
  const m = t.match(/\s*\[\[stats:([^\]]*)\]\]\s*$/); // anything bracket-free: a broken record is still stripped
  if (!m) return { text: t, stats: null };
  let stats = null;
  try {
    stats = JSON.parse(m[1]);
  } catch (err) {
    stats = null;
  }
  return { text: t.slice(0, m.index), stats };
}

/* ---------- guided tours ---------- */

const TOUR_RX = /^\[\[tour\]\]\s*/i;
/* the same grammar as ACT_RX, anywhere in the text, used to cut a tour into stops */
const STEP_RX = /\[\[act:(page|skills|doc|project):([^\]]{1,240})\]\]/gi;
/* a selection, not a slideshow: a tour that runs past this is cut, so the
   model's "three to five stops" rule has a hard edge behind it */
export const MAX_TOUR_STOPS = 7;

/** The tour token at the very start of `text`, or null. `length` is how much to strip. */
export function parseTourToken(text) {
  const m = String(text || "").match(TOUR_RX);
  return m ? { length: m[0].length } : null;
}

/**
 * Cut the body of a tour reply (everything after [[tour]]) into stops.
 * Each stop is { act, text, done }: `act` is the parsed action token that
 * opens it (null for an opening line before the first token, which is
 * spoken without navigating), `text` what the head says there, and `done`
 * whether that text is complete - true once the next token has arrived,
 * or once the stream has ended (`final`). Called on every chunk while the
 * reply streams, so a stop can start playing before the next has arrived.
 * A dangling, unfinished token at the end of a finished reply is dropped
 * rather than shown. Blank stops are dropped; the list is capped.
 */
export function splitTourSteps(body, final = false) {
  const text = String(body || "");
  const cuts = [];
  STEP_RX.lastIndex = 0;
  let m;
  while ((m = STEP_RX.exec(text))) {
    cuts.push({ at: m.index, end: m.index + m[0].length, act: { kind: m[1].toLowerCase(), arg: m[2].trim() } });
  }
  const steps = [];
  const clean = (s, last) => {
    let t = s;
    // an incomplete token still arriving, or left over at the end: never shown
    if (last) t = t.replace(/\[\[[^\]]*$/, "");
    return t.replace(/\s+/g, " ").trim();
  };
  const intro = clean(text.slice(0, cuts.length ? cuts[0].at : text.length), !cuts.length);
  if (intro) steps.push({ act: null, text: intro, done: cuts.length > 0 || final });
  cuts.forEach((c, i) => {
    const last = i === cuts.length - 1;
    const t = clean(text.slice(c.end, last ? text.length : cuts[i + 1].at), last);
    steps.push({ act: c.act, text: t, done: !last || final });
  });
  return steps.filter((s) => s.text || !s.done).slice(0, MAX_TOUR_STOPS);
}

/** How long a stop stays on screen, in ms: long enough to read the sentence
 *  and watch the page behind it settle, never a slideshow nobody asked for. */
export function tourPause(text) {
  const n = String(text || "").length;
  return Math.max(6000, Math.min(9000, 4200 + 28 * n));
}

/** A word typed during a tour that is a tour control rather than a question:
 *  "next" | "stop" | null. */
export function tourCommand(text) {
  const t = String(text || "").trim().toLowerCase().replace(/[.!]+$/, "");
  if (/^(next|skip|continue|go on|onwards?|carry on|more|ok|okay)$/.test(t)) return "next";
  if (/^(stop|end|enough|quit|exit|cancel|done|that's enough|stop the tour|end the tour)$/.test(t)) return "stop";
  return null;
}

// a Map, not an object: "[[act:page:constructor]]" must find nothing
const PAGES = new Map([
  ["home", "/"],
  ["skills", "/skills"],
  ["projects", "/projects"],
  ["about", "/about"],
  ["resume", "/resume"],
]);

/* accent-free, lower-case, one space between words; keeps + and # for C++ / C# */
const norm = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9+#]+/g, " ")
    .trim();

/**
 * Where an action leads. `skillIds` are the ids the skills map renders
 * (skillsData.json); `projectRefs` are {name, to} pairs for every project
 * name and alias. Unknown targets fall back to the plain page, so an
 * imperfect name still opens something sensible; an unknown page is null.
 */
export function resolveAction(act, { skillIds = [], projectRefs = [] } = {}) {
  if (!act) return null;
  const arg = act.arg || "";
  if (act.kind === "page") return PAGES.get(norm(arg)) || null;
  if (act.kind === "doc") {
    const k = norm(arg);
    if (k.includes("diploma")) return "/resume#diploma";
    if (k.includes("resume") || k === "cv") return "/resume";
    return null;
  }
  if (act.kind === "skills") {
    const byNorm = new Map(skillIds.map((id) => [norm(id), id]));
    const ids = [];
    for (const w of arg.split(",").map(norm).filter(Boolean)) {
      const id = byNorm.get(w);
      if (id && !ids.includes(id)) ids.push(id);
      if (ids.length >= 6) break; // a selection, not an inventory
    }
    return ids.length ? "/skills#sel=" + ids.map(encodeURIComponent).join(",") : "/skills";
  }
  if (act.kind === "project") {
    const want = norm(arg);
    if (!want) return "/projects";
    const exact = projectRefs.find((p) => norm(p.name) === want);
    // whole words only, so "Simone" never becomes Simon and "SPIM" still
    // matches "the SPIM write-up"
    const within = (a, b) => (" " + a + " ").includes(" " + b + " ");
    const loose =
      exact ||
      projectRefs.find((p) => {
        const n = norm(p.name);
        return n.length >= 4 && (within(n, want) || within(want, n));
      });
    return loose ? loose.to : "/projects";
  }
  return null;
}
