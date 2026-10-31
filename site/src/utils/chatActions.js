/* Chat actions: the head can open things on the site.
 *
 * A reply may begin with exactly one token, in the same place the trick
 * tokens ([[ghost]], [[spin]], ...) go:
 *   [[act:skills:Python, PyTorch]]   skills map with those skills selected
 *   [[act:project:SPIM]]             projects page, scrolled to that card
 *   [[act:doc:diploma]]              the diploma (or doc:resume)
 *   [[act:page:about]]               a page: home, skills, projects, about, resume
 * The page turns the token into navigation before the words are shown.
 * Pure functions, tested offline by src/utils/chatActions.test.mjs.
 */

const ACT_RX = /^\[\[act:(page|skills|doc|project):([^\]]{1,120})\]\]\s*/i;

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
  return /^\[\[act:/i.test(held) ? 160 : 18;
}

const PAGES = { home: "/", skills: "/skills", projects: "/projects", about: "/about", resume: "/resume" };

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
  if (act.kind === "page") return PAGES[norm(arg)] || null;
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
