// Offline checks for the chat action tokens - run by `npm run test:chat`.
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  parseActToken, couldBeToken, tokenCap, resolveAction, stripExtraTokens,
  parseTourToken, splitTourSteps, tourPause, tourCommand, MAX_TOUR_STOPS,
} from "./chatActions.js";

const data = JSON.parse(fs.readFileSync(new URL("../../public/skillsData.json", import.meta.url), "utf8"));
const skillIds = (data.skillNodes || []).map((n) => String(n.id)); // every id, as the page passes them
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
  assert.equal(tokenCap("[[act:project:Compassion"), 280);
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
  assert.equal(resolveAction(parseActToken("[[act:page:constructor]]"), opts), null, "no prototype keys");
  assert.equal(resolveAction(parseActToken("[[act:page:toString]]"), opts), null);
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
  const longest = [...skillIds].sort((a, b) => b.length - a.length).slice(0, 6);
  const six = resolveAction(parseActToken(`[[act:skills:${longest.join(", ")}]] Six of them.`), opts);
  assert.ok(six && six.split(",").length === 6, "the six longest ids still fit the token: " + six);
  const short = skillIds.find((id) => id.length < 3);
  if (short) assert.equal(resolveAction(parseActToken(`[[act:skills:${short}]]`), opts), "/skills#sel=" + encodeURIComponent(short), "short ids like C work for exact matches");
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

// extra tokens after the first never reach the visitor
{
  assert.equal(stripExtraTokens("[[act:page:about]] hi"), "hi");
  assert.equal(stripExtraTokens("[[spin]] [[act:page:about]]  there"), "there");
  assert.equal(stripExtraTokens("plain text [[act:page:about]]"), "plain text [[act:page:about]]", "only at the start");
  assert.equal(stripExtraTokens(""), "");
  ok("extra leading tokens stripped");
}

// guided tours: the token, the stops, the pacing, the controls
{
  assert.deepEqual(parseTourToken("[[tour]][[act:project:SPIM]] First."), { length: 8 });
  assert.deepEqual(parseTourToken("[[TOUR]]  \n[[act:page:about]]"), { length: 11 }, "case-blind, trailing whitespace absorbed");
  assert.equal(parseTourToken("[[act:page:about]]"), null, "a single action is not a tour");
  assert.equal(parseTourToken(" hi [[tour]]"), null, "only at the very start");
  for (const h of ["[[t", "[[tour", "[[tour]"]) assert.ok(couldBeToken(h), "still could be the tour token: " + h);
  ok("tour token");
}
{
  const body = "[[act:project:SPIM]] First stop, the big one. [[act:skills:PyTorch, 3js]] The tools behind it. [[act:doc:dipl";
  const mid = splitTourSteps(body, false);
  assert.equal(mid.length, 2, "the unfinished third token is not a stop yet");
  assert.deepEqual(mid[0], { act: { kind: "project", arg: "SPIM" }, text: "First stop, the big one.", done: true });
  assert.deepEqual(mid[1].act, { kind: "skills", arg: "PyTorch, 3js" });
  assert.equal(mid[1].text, "The tools behind it.", "the partial token never leaks into the text");
  assert.equal(mid[1].done, false, "the last stop is complete only once the next token or the end arrives");
  const fin = splitTourSteps(body + "oma]] Last stop.  ", true);
  assert.equal(fin.length, 3);
  assert.deepEqual(fin[2], { act: { kind: "doc", arg: "diploma" }, text: "Last stop.", done: true });
  assert.ok(fin.every((s) => s.done), "everything is done once the stream has ended");
  const intro = splitTourSteps("Right, the tour.\n[[act:page:projects]] Everything I have built.", true);
  assert.deepEqual(intro[0], { act: null, text: "Right, the tour.", done: true }, "an opening line is a stop with no navigation");
  assert.equal(intro[1].text, "Everything I have built.");
  const waiting = splitTourSteps("Right, the", false);
  assert.deepEqual(waiting, [{ act: null, text: "Right, the", done: false }], "an unfinished opening line waits");
  assert.deepEqual(splitTourSteps("", false), [], "nothing yet");
  assert.deepEqual(splitTourSteps("[[act:page:about]] Done. [[act:pa", true), [{ act: { kind: "page", arg: "about" }, text: "Done.", done: true }], "a dangling token at the end is dropped");
  assert.deepEqual(splitTourSteps("[[act:evil:x]] not a stop", true), [{ act: null, text: "[[act:evil:x]] not a stop", done: true }], "unknown kinds are plain text");
  const many = splitTourSteps(Array.from({ length: 12 }, (_, i) => `[[act:page:about]] Stop ${i}.`).join(" "), true);
  assert.equal(many.length, MAX_TOUR_STOPS, "capped");
  ok("tour stops, streamed and final");
}
{
  assert.equal(tourPause(""), 6000);
  assert.equal(tourPause("x".repeat(64)), 6000, "short sentences still get the floor");
  assert.equal(tourPause("x".repeat(100)), 7000);
  assert.equal(tourPause("x".repeat(400)), 9000, "capped");
  assert.equal(tourCommand("next"), "next");
  assert.equal(tourCommand("  Next! "), "next");
  assert.equal(tourCommand("skip"), "next");
  assert.equal(tourCommand("stop"), "stop");
  assert.equal(tourCommand("Stop the tour."), "stop");
  assert.equal(tourCommand("enough"), "stop");
  assert.equal(tourCommand("what is next?"), null, "a question is a question");
  assert.equal(tourCommand(""), null);
  ok("tour pacing and controls");
}

console.log(`ALL ${passed} ACTION CHECKS PASSED`);
