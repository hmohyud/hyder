// Offline checks for the chat action tokens - run by `npm run test:chat`.
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseActToken, couldBeToken, tokenCap, resolveAction } from "./chatActions.js";

const data = JSON.parse(fs.readFileSync(new URL("../../public/skillsData.json", import.meta.url), "utf8"));
const skillIds = (data.skillNodes || []).map((n) => String(n.id)).filter((id) => id.length >= 3);
assert.ok(skillIds.length > 10, "skills data loaded");
const [idA, idB] = skillIds;
const projectRefs = [
  { name: "SPIM", to: "/projects#spim" },
  { name: "Compassion Course Online", to: "/projects#compassion-course-online" },
  { name: "Compassion Course", to: "/projects#compassion-course-online" },
  { name: "Simon", to: "/projects#simon" },
];
let passed = 0;
const ok = (n) => { passed++; console.log("  pass:", n); };

// parsing
{
  const t = parseActToken("[[act:skills:Python, PyTorch]] Lit up the AI corner.");
  assert.deepEqual(t, { kind: "skills", arg: "Python, PyTorch", length: "[[act:skills:Python, PyTorch]] ".length });
  assert.equal("[[act:skills:Python, PyTorch]] Lit up the AI corner.".slice(t.length), "Lit up the AI corner.");
  assert.deepEqual(parseActToken("[[ACT:Doc:diploma]]"), { kind: "doc", arg: "diploma", length: 19 });
  assert.equal(parseActToken("[[spin]] Spinning."), null, "trick tokens are not actions");
  assert.equal(parseActToken("[[act:evil:rm -rf]] x"), null, "unknown kinds do not parse");
  assert.equal(parseActToken("Hello [[act:page:about]]"), null, "only at the very start");
  assert.equal(parseActToken(""), null);
  ok("token parsing");
}

// holding back the opening
{
  for (const h of ["[", "[[", "[[a", "[[act", "[[act:", "[[act:skills:Py", "[[act:project:Compassion Course Onl", "[[gho", "[[tint:#ab"]) {
    assert.ok(couldBeToken(h), "could still be a token: " + JSON.stringify(h));
  }
  for (const h of ["Hello", "[[ghost]] hi there", "[[act:page:about]] Opening", "I [[", "[[act:page:about]]x"]) {
    assert.ok(!couldBeToken(h), "provably not a token: " + JSON.stringify(h));
  }
  assert.equal(tokenCap("[[act:project:Compassion"), 160);
  assert.equal(tokenCap("[[gho"), 18);
  assert.equal(tokenCap("Hel"), 18);
  ok("hold-back guard");
}

// resolving
{
  const opts = { skillIds, projectRefs };
  assert.equal(resolveAction(parseActToken("[[act:page:about]]"), opts), "/about");
  assert.equal(resolveAction(parseActToken("[[act:page:Skills ]]"), opts), "/skills");
  assert.equal(resolveAction(parseActToken("[[act:page:home]]"), opts), "/");
  assert.equal(resolveAction(parseActToken("[[act:page:admin]]"), opts), null, "unknown page: nothing happens");
  assert.equal(resolveAction(parseActToken("[[act:doc:diploma]]"), opts), "/resume#diploma");
  assert.equal(resolveAction(parseActToken("[[act:doc:the diploma]]"), opts), "/resume#diploma");
  assert.equal(resolveAction(parseActToken("[[act:doc:my resume]]"), opts), "/resume");
  assert.equal(resolveAction(parseActToken("[[act:doc:passport]]"), opts), null);
  ok("pages and documents");
}
{
  const opts = { skillIds, projectRefs };
  const sel = resolveAction(parseActToken(`[[act:skills:${idA.toLowerCase()}, ${idB.toUpperCase()}, Nonexistent Skill]]`), opts);
  assert.equal(sel, "/skills#sel=" + [idA, idB].map(encodeURIComponent).join(","), "case-insensitive exact ids: " + sel);
  assert.equal(resolveAction(parseActToken("[[act:skills:Underwater Basket Weaving]]"), opts), "/skills", "no match: plain map");
  const many = resolveAction(parseActToken("[[act:skills:" + skillIds.slice(0, 10).join(", ") + "]]"), opts);
  assert.equal(many.split(",").length, 6, "capped at six");
  const dup = resolveAction(parseActToken(`[[act:skills:${idA}, ${idA}]]`), opts);
  assert.equal(dup, "/skills#sel=" + encodeURIComponent(idA), "deduplicated");
  ok("skills selection");
}
{
  const opts = { skillIds, projectRefs };
  assert.equal(resolveAction(parseActToken("[[act:project:SPIM]]"), opts), "/projects#spim");
  assert.equal(resolveAction(parseActToken("[[act:project:the SPIM write-up]]"), opts), "/projects#spim", "loose match");
  assert.equal(resolveAction(parseActToken("[[act:project:Compassion Course]]"), opts), "/projects#compassion-course-online", "alias");
  assert.equal(resolveAction(parseActToken("[[act:project:compassion course online]]"), opts), "/projects#compassion-course-online");
  assert.equal(resolveAction(parseActToken("[[act:project:Something Else Entirely]]"), opts), "/projects", "unknown: the page");
  assert.equal(resolveAction(parseActToken("[[act:project:Simone]]"), opts), "/projects", "'Simone' does not become Simon");
  ok("project targets");
}

console.log(`ALL ${passed} ACTION CHECKS PASSED`);
