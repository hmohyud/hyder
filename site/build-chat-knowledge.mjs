// build-chat-knowledge.mjs
// Regenerates the chatbot's project knowledge straight from the site's own
// project data, so the two can never drift.
//
//   node build-chat-knowledge.mjs
//
// Runs automatically as part of `npm run chat:deploy`. Edit a project card in
// src/pages/Projects.js and the bot knows about it on the next deploy — no
// second copy to maintain, no counts to keep in sync.

import fs from "node:fs";

const SRC = "src/pages/Projects.js";
const OUT = "worker/projects.generated.js";

/* ---------- pull the project data out of the React module ----------
   The array is plain literals plus a few PU-prefixed template strings, so we
   can slice out the prelude, drop the imports, and evaluate it directly rather
   than dragging React and CSS into Node. */

const source = fs.readFileSync(SRC, "utf8");
const start = source.indexOf("const projects = [");
if (start === -1) throw new Error("could not find the projects array");

// find the end of the array by bracket matching from the opening [
const openBracket = source.indexOf("[", start);
let depth = 0;
let end = -1;
let inString = null;
for (let i = openBracket; i < source.length; i++) {
  const ch = source[i];
  const prev = source[i - 1];
  if (inString) {
    if (ch === inString && prev !== "\\") inString = null;
    continue;
  }
  if (ch === '"' || ch === "'" || ch === "`") {
    inString = ch;
    continue;
  }
  if (ch === "[") depth++;
  else if (ch === "]") {
    depth--;
    if (depth === 0) {
      end = i + 1;
      break;
    }
  }
}
if (end === -1) throw new Error("unbalanced brackets in the projects array");

const prelude = source
  .slice(0, start)
  .split("\n")
  .filter((line) => !/^\s*import\s/.test(line))
  .join("\n")
  // The prelude is evaluated as a plain function body, so any ESM export
  // keyword in it is a syntax error: `projects` itself is exported (for the
  // landing count), as are the slug/short-name helpers the chat links with.
  // Drop the keyword and keep the declarations.
  .replace(/^\s*export\s+/gm, "")
  .replace(/export\s*$/, "");

const arrayLiteral = source.slice(openBracket, end);
// eslint-disable-next-line no-new-func
const projects = new Function(
  "process",
  prelude + "\nreturn " + arrayLiteral + ";"
)({ env: { PUBLIC_URL: "" } });

/* ---------- flatten a card's description into prose ---------- */

function flatten(entry, depthLevel = 0) {
  if (typeof entry === "string") return [entry];
  if (!entry || typeof entry !== "object") return [];
  if (entry.quote) return [`"${entry.quote}" - ${entry.by || ""}`.trim()];

  const out = [];
  const summary = entry.summary ? String(entry.summary) : "";
  const details = Array.isArray(entry.details) ? entry.details : [entry.details];
  const body = details.flatMap((d) => flatten(d, depthLevel + 1)).filter(Boolean);

  if (summary && body.length) out.push(summary + " " + body.join(" "));
  else if (summary) out.push(summary);
  else out.push(...body);
  return out;
}

const major = projects.filter((p) => !p.minor);
const minor = projects.filter((p) => p.minor);

const lines = [];
lines.push(
  `The site currently lists ${projects.length} entries: ${major.length} ` +
    `substantial projects and ${minor.length} smaller pieces. The full set, with ` +
    `images and expandable detail, is at hydermohyuddin.com/projects.`
);
lines.push("");

for (const p of projects) {
  const title = String(p.title).replace(/\s+/g, " ").trim();
  lines.push(`### ${title}${p.minor ? " (smaller piece)" : ""}`);
  const paras = (p.description || []).flatMap((d) => flatten(d));
  for (const para of paras) {
    lines.push(String(para).replace(/\s+/g, " ").trim());
  }
  const links = (p.links || [])
    .filter((l) => l && l.href && !l.internal)
    .map((l) => `${l.label}: ${l.href}`);
  if (links.length) lines.push("Links - " + links.join(" | "));
  lines.push("");
}

/* ---------- ranking facts ----------
   One deterministic line per project, hardest first, from each card's
   `facts` field: the raw material for "which was hardest", "rank your three
   most relevant projects for a data role" and "compare X and Y". The prose
   above says what each project IS; this says, in the same words every build,
   how big, how hard, and what kind of work it is evidence for. The effort
   rating and the fit tags are the owner's own calls, kept with the card so
   they can never drift from it. A card without `facts` is simply absent
   from the block - the model still has its write-up. */
const shortName = (title) => String(title).split(/\s+[—–(]/)[0].trim();
const list = (v) => (Array.isArray(v) ? v.filter(Boolean).join(", ") : v ? String(v) : "");
const ranked = projects
  .map((p, i) => ({ p, i }))
  .filter(({ p }) => p.facts && typeof p.facts === "object")
  .sort((a, b) => (Number(b.p.facts.effort) || 0) - (Number(a.p.facts.effort) || 0) || a.i - b.i);
if (ranked.length) {
  lines.push("## Ranking facts");
  lines.push(
    "One line per project, hardest first, for comparisons and rankings. effort is my own 1-5 rating of " +
      "how hard the project was to build (5 = the hardest things I have built); fit lists the kinds of " +
      "work or role each project is evidence for; when and role say how long and in what capacity."
  );
  for (const { p } of ranked) {
    const f = p.facts;
    const parts = [`effort ${Number(f.effort) || 0}/5`];
    if (f.when) parts.push("when: " + f.when);
    if (f.role) parts.push("role: " + f.role);
    if (f.stack) parts.push("stack: " + list(f.stack));
    if (f.scale) parts.push("scale: " + f.scale);
    if (f.fit) parts.push("fit: " + list(f.fit));
    if (f.hardest) parts.push("hardest part: " + f.hardest);
    lines.push(`- ${shortName(p.title)}${p.minor ? " (smaller piece)" : ""} - ` + parts.join(" - "));
  }
  lines.push("");
}

const text = lines.join("\n").replace(/\n{3,}/g, "\n\n");

fs.writeFileSync(
  OUT,
  "// GENERATED by build-chat-knowledge.mjs from src/pages/Projects.js — do not edit.\n" +
    "// Re-run `npm run chat:deploy` after changing a project card.\n\n" +
    "export const PROJECTS = `\n" +
    text.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${") +
    "`;\n"
);

/* The skills map's own node ids, so the prompt can tell the model which names
   an [[act:skills:...]] token may use - anything else resolves to nothing. */
const SKILLS_SRC = "public/skillsData.json";
const SKILLS_OUT = "worker/skills.generated.js";
const skillIds = (JSON.parse(fs.readFileSync(SKILLS_SRC, "utf8")).skillNodes || []).map((n) => String(n.id));
fs.writeFileSync(
  SKILLS_OUT,
  "// GENERATED by build-chat-knowledge.mjs from public/skillsData.json — do not edit.\n\n" +
    "export const SKILL_LIST = " + JSON.stringify(skillIds.join(", ")) + ";\n"
);
console.log(`${SKILLS_OUT}: ${skillIds.length} skill ids`);

const words = text.trim().split(/\s+/).length;
console.log(
  `${OUT}: ${projects.length} projects (${major.length} major, ${minor.length} minor), ` +
    `${words.toLocaleString()} words, ~${Math.round(words * 1.33).toLocaleString()} tokens`
);
