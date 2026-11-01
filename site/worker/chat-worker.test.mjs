// Offline harness for chat-worker.js - run with `npm run test:chat` (CI runs it
// before every deploy). It fakes the Anthropic SSE stream and an unavailable
// Gemini so the chain order, budget gate, usage accounting, /health and the
// failure paths are checked without a key, a network, or a cent.
import assert from "node:assert/strict";

const calls = [];
const kv = new Map();
const ttls = new Map();
const puts = [];
let failPut = null; // predicate(key) -> throw on put
let failGet = null; // predicate(key) -> throw on get
const CHAT_KV = {
  async get(k) { if (failGet && failGet(k)) throw new Error("kv read down"); return kv.has(k) ? kv.get(k) : null; },
  async put(k, v, opts) { if (failPut && failPut(k)) throw new Error("kv write budget"); puts.push(k); kv.set(k, String(v)); ttls.set(k, opts && opts.expirationTtl); },
  async delete(k) { kv.delete(k); },
  async list({ prefix }) {
    return { keys: [...kv.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) };
  },
};
const todayKey = new Date().toISOString().slice(0, 10);
const SPEND = "spend:anthropic:" + todayKey;
const clearParked = () => { for (const k of [...kv.keys()]) if (k.startsWith("down:")) kv.delete(k); };

const sse = (events) => events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
const START = (usage) => ({ type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "claude-sonnet-5-5", content: [],
  usage: usage || { input_tokens: 420, cache_creation_input_tokens: 0, cache_read_input_tokens: 11000, output_tokens: 3 } } });
const THOUGHT = "Checking the SPIM notes for the hard part.";
const THINK = [
  { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
  { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: THOUGHT.slice(0, 12) } },
  { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: THOUGHT.slice(12) } },
  { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig" } },
  { type: "content_block_stop", index: 0 },
];
/* the stream's envelope: an optional [[think]] block first, the reply, then one [[stats:{...}]] record */
const envelope = (text) => {
  const m = text.match(/^(?:\[\[think\]\]([\s\S]*?)\[\[\/think\]\])?([\s\S]*?)(?:\n\[\[stats:(\{[^\]]*\})\]\])?$/);
  assert.ok(m, "envelope shape: " + JSON.stringify(text.slice(0, 80)));
  return { think: m[1] === undefined ? null : m[1], body: m[2], stats: m[3] ? JSON.parse(m[3]) : null };
};
const TEXT = (text) => [
  { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
  { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: text.slice(0, 10) } },
  { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: text.slice(10) } },
  { type: "content_block_stop", index: 1 },
];
const END = (stop, usage) => [
  { type: "message_delta", delta: { stop_reason: stop, stop_sequence: null }, usage: usage || { output_tokens: 180 } },
  { type: "message_stop" },
];
const ANSWER = "Dry answer, delivered flat and moved on from.";
const LONG = "x".repeat(300) + " and that is the whole of it.";

let mode = "ok";
let sizer = "2 chat"; // what the fake Haiku sizer answers; "down" = 500
globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), init });
  if (String(url).startsWith("https://api.anthropic.com/")) {
    const asked = (() => { try { return JSON.parse(init.body); } catch (e) { return {}; } })();
    if (asked.stream !== true) { // the sizer is the one call that does not stream
      if (sizer === "down") return new Response("nope", { status: 500 });
      if (sizer === "hang") return new Promise((resolve) => { init.signal.addEventListener("abort", () => resolve(new Response("", { status: 499 }))); });
      return new Response(JSON.stringify({ content: [{ type: "text", text: sizer }], usage: { input_tokens: 150, output_tokens: 4 } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    const err = (status, type, headers) => new Response(JSON.stringify({ type: "error", error: { type, message: type } }), { status, headers });
    if (mode === "400") return err(400, "invalid_request_error: fallbacks: unknown parameter");
    if (mode === "spendlimit") return err(400, "You have reached your specified API usage limits; access resumes on the 1st");
    if (mode === "429") return err(429, "rate_limit_error");
    if (mode === "429ra") return err(429, "rate_limit_error", { "retry-after": "30" });
    let events;
    if (mode === "refusal") events = [START(), ...THINK, ...END("refusal")];
    else if (mode === "partial-refusal") events = [START(), ...THINK, ...TEXT("The SPIM work started as a"), ...END("refusal")];
    else if (mode === "long-refusal") events = [START(), ...THINK, ...TEXT(LONG), ...END("refusal")];
    else if (mode === "max_tokens") events = [START(), ...THINK, ...END("max_tokens", { output_tokens: 4096 })];
    else if (mode === "error-event") events = [START(), { type: "ping" }, { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }];
    else if (mode === "iterations") events = [START(), ...THINK, ...TEXT(ANSWER), ...END("end_turn", {
      output_tokens: 180,
      iterations: [
        { type: "message", usage: { input_tokens: 420, cache_read_input_tokens: 11000, cache_creation_input_tokens: 0, output_tokens: 40 } },
        { type: "fallback_message", usage: { input_tokens: 420, cache_read_input_tokens: 0, cache_creation_input_tokens: 11000, output_tokens: 180 } },
      ],
    })];
    else events = [START(), ...THINK, ...TEXT(ANSWER), ...END("end_turn")];
    return new Response(sse(events), { status: 200, headers: { "content-type": "text/event-stream" } });
  }
  if (mode === "gemini-ok" && /streamGenerateContent/.test(String(url))) {
    const frames = [
      { candidates: [{ content: { parts: [{ text: "Backup here. " }] } }] },
      { candidates: [{ content: { parts: [{ text: "Dry enough." }] } }], usageMetadata: { promptTokenCount: 15000, candidatesTokenCount: 12, thoughtsTokenCount: 0 } },
    ];
    return new Response(frames.map((f) => "data: " + JSON.stringify(f) + "\n\n").join(""), { status: 200, headers: { "content-type": "text/event-stream" } });
  }
  return new Response("nope", { status: 500 }); // gemini discovery + generate: unavailable
};

const { default: worker } = await import("./chat-worker.js");
const env = { ANTHROPIC_KEY: "sk-test", GEMINI_KEY: "g-test", CHAT_KV, DAILY_PER_IP: "100", ANTHROPIC_DAILY_BUDGET_CENTS: "500" };
const waits = [];
const ctx = { waitUntil: (p) => waits.push(p) };
const ask = (q, e = env, extra = {}) => worker.fetch(new Request("https://hyder-chat.test/", {
  method: "POST",
  headers: { "content-type": "application/json", origin: "https://hydermohyuddin.com", "cf-connecting-ip": "1.2.3.4" },
  body: JSON.stringify({ messages: [{ role: "user", content: q }], ...extra }),
}), e, ctx);
const health = async () => (await worker.fetch(new Request("https://hyder-chat.test/health", { headers: { origin: "https://hydermohyuddin.com" } }), env, ctx)).json();
const settle = async () => { await Promise.allSettled(waits.splice(0)); await new Promise((r) => setTimeout(r, 20)); };
const bodyOf = (c) => { try { return JSON.parse(c.init.body); } catch (e) { return {}; } };
// the answer streams, the sizer does not - the model alone no longer tells them apart
const anthropicCalls = () => calls.filter((c) => c.url.startsWith("https://api.anthropic.com/") && bodyOf(c).stream === true);
const sizerCalls = () => calls.filter((c) => c.url.startsWith("https://api.anthropic.com/") && bodyOf(c).stream !== true);
const geminiCalls = () => calls.filter((c) => /generativelanguage/.test(c.url));
const spend = () => JSON.parse(kv.get(SPEND));
let passed = 0;
const ok = (name) => { passed++; console.log("  pass:", name); };

// 1. happy path: Claude answers first, with the right request shape. The
//    fake sizer says "2 chat", so this is the light route: Haiku answers.
{
  calls.length = 0;
  const res = await ask("What was hard about SPIM?");
  const text = await res.text();
  await settle();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("x-chat-provider"), "anthropic");
  assert.equal(res.headers.get("x-chat-model"), "claude-haiku-5-5", "rated 2: Haiku answers");
  assert.match(res.headers.get("access-control-expose-headers") || "", /x-chat-model/, "page can read the model header");
  const env1 = envelope(text);
  assert.equal(env1.think, THOUGHT, "the summarised reasoning opens the stream");
  assert.equal(env1.body, ANSWER);
  assert.equal(env1.stats.provider, "anthropic");
  assert.equal(env1.stats.model, "claude-haiku-5-5");
  assert.equal(env1.stats.cached, 11000);
  assert.equal(env1.stats.out, 180);
  assert.equal(env1.stats.in, 420);
  assert.equal(env1.stats.stop, "end_turn");
  assert.equal(env1.stats.effort, "low");
  assert.equal(env1.stats.think, THOUGHT.length);
  assert.deepEqual({ ...env1.stats.size, ms: 0 }, { complexity: 2, kind: "chat", ms: 0, model: "claude-haiku-5-5", cents: 0.0017 }, "the sizer's own cost rides along");
  assert.equal(env1.stats.cents, 0.0259, "Haiku prices: (420*0.1 + 11000*0.01 + 180*0.5)/1e4 + the sizer's 0.0017");
  assert.ok(typeof env1.stats.ms === "number" && typeof env1.stats.ttfb === "number");
  assert.equal(geminiCalls().length, 0, "gemini must not be called when Claude answers");
  assert.equal(waits.length, 0);
  assert.equal(sizerCalls().length, 1, "one sizer call");
  const sz = JSON.parse(sizerCalls()[0].init.body);
  assert.equal(sz.model, "claude-haiku-5-5");
  assert.deepEqual(sz.thinking, { type: "disabled" });
  assert.equal(sz.max_tokens, 12);
  assert.match(sz.messages[0].content, /Question: What was hard about SPIM\?$/);
  const req = anthropicCalls()[0];
  const body = JSON.parse(req.init.body);
  assert.equal(body.model, "claude-haiku-5-5");
  assert.equal(body.max_tokens, 4096);
  assert.equal(body.stream, true);
  assert.equal(body.fallbacks, undefined, "Haiku has no server-side fallback");
  assert.deepEqual(body.output_config, { effort: "low" }, "top-level effort stays pinned, so the cached prompt never splits");
  assert.deepEqual(body.thinking, { type: "adaptive", display: "summarized" });
  assert.equal(body.temperature, undefined);
  assert.ok(Array.isArray(body.system) && body.system.length === 1);
  assert.deepEqual(body.system[0].cache_control, { type: "ephemeral", ttl: "1h" });
  assert.ok(body.system[0].text.startsWith("You are Hyder Mohyuddin"));
  assert.ok(body.system[0].text.includes("witty by default"), "wit rules present in the prompt");
  assert.ok(body.system[0].text.includes("No humour at all in anything sincere or heavy"), "carve-out present");
  assert.deepEqual(body.messages, [{ role: "user", content: "What was hard about SPIM?" }]);
  assert.equal(req.init.headers["anthropic-version"], "2023-06-01");
  assert.equal(req.init.headers["anthropic-beta"], undefined, "no betas needed on the light route");
  assert.equal(req.init.headers["x-api-key"], "sk-test");
  const rec = spend();
  assert.equal(rec.n, 1);
  // (420*0.1 + 11000*0.01 + 180*0.5) / 1e4 for Haiku, plus the sizer's (150*0.1 + 4*0.5) / 1e4
  assert.ok(Math.abs(rec.cents - (0.0242 + 0.0017)) < 1e-9, "cents " + rec.cents);
  assert.equal(rec.last.cacheRead, 11000);
  assert.equal(rec.last.output, 180);
  assert.equal(rec.last.stop, "end_turn");
  assert.equal(kv.get("used:anthropic:" + todayKey), undefined, "no duplicate tally write for Claude");
  assert.equal(kv.get("c:" + todayKey + ":1.2.3.4"), "1", "per-visitor counter charged");
  assert.equal(puts.filter((k) => k === SPEND || k.startsWith("c:")).length, 2, "two KV writes on the happy path");
  ok("Claude first, request shape, usage priced, two KV writes");
}

// 1b. page context rides OUTSIDE the cached prompt: a system message after the
//     last user turn on Claude, a bracketed prefix on the last user turn elsewhere
{
  const promptText = JSON.parse(anthropicCalls()[0].init.body).system[0].text;
  const spendSnap = kv.get(SPEND); // this block asks several times; the meter checks below expect the one answer so far
  calls.length = 0;
  const res = await ask("tell me about this one", env, { context: { path: "/projects#spim", hovered: "SPIM" } });
  await res.text();
  await settle();
  const body = JSON.parse(anthropicCalls()[0].init.body);
  assert.equal(body.system[0].text, promptText, "the system block is byte-identical with context present");
  assert.deepEqual(body.system[0].cache_control, { type: "ephemeral", ttl: "1h" });
  assert.equal(body.messages.length, 2);
  assert.deepEqual(body.messages[0], { role: "user", content: "tell me about this one" }, "the question itself is untouched");
  assert.equal(body.messages[1].role, "system", "context is a mid-conversation system message, last in the list");
  assert.match(body.messages[1].content, /on the projects page \(\/projects#spim\)/);
  assert.match(body.messages[1].content, /the project card for SPIM\./);
  assert.match(body.messages[1].content, /never mention it/);
  assert.match(body.messages[1].content, /Roll for this turn: [1-6] of 6\. Trick for this turn: [a-z ]+\.$/, "a die for the turn rides with the context");

  calls.length = 0;
  await (await ask("where am I?", env, { context: { path: "/resume#diploma" } })).text();
  await settle();
  const b2 = JSON.parse(anthropicCalls()[0].init.body);
  assert.match(b2.messages[1].content, /the resume page, with the diploma open \(\/resume#diploma\)\./);
  assert.ok(!/looking at/.test(b2.messages[1].content), "no card when none was sent");
  assert.match(b2.messages[1].content, /default look, the plain point cloud; no look is on/, "no look sent: the line says the default is on");

  // the previous reply's cost rides along, in words, so "it was 9 cents" has an answer
  calls.length = 0;
  await (await ask("it was 9 cents", env, { context: { path: "/", last: { cents: 9.04, wrote: true, model: "claude-sonnet-5-5" } } })).text();
  await settle();
  const bl = JSON.parse(anthropicCalls()[0].init.body);
  assert.match(bl.messages[1].content, /cost 9\.0 cents of the owner's API bill \(answered by Sonnet\), plus a one-off charge to write the site's knowledge into the one-hour cache/);
  calls.length = 0;
  await (await ask("and that one?", env, { context: { path: "/", last: { cents: 0.03, wrote: false, model: "claude-haiku-5-5" } } })).text();
  await settle();
  assert.match(JSON.parse(anthropicCalls()[0].init.body).messages[1].content, /cost a few hundredths of a cent of the owner's API bill \(answered by Haiku\); the visitor/);
  calls.length = 0;
  await (await ask("hm", env, { context: { path: "/", last: { cents: "9; drop table", wrote: "yes", model: "<b>x</b>" } } })).text();
  await settle();
  assert.ok(!/cost/.test(JSON.parse(anthropicCalls()[0].init.body).messages[1].content), "a malformed last-reply record is dropped");

  // the head's remembered look rides along; anything but a plain word is dropped
  calls.length = 0;
  await (await ask("why do you look like that?", env, { context: { path: "/", look: "ghost+lattice" } })).text();
  await settle();
  const b2l = JSON.parse(anthropicCalls()[0].init.body);
  assert.match(b2l.messages[1].content, /in its ghost and lattice \(the halftone\) look, which this visitor asked for earlier/);
  assert.match(b2l.messages[1].content, /ask for that same look again it is already so/, "a repeat request is answered as already so");
  // no look on: the line says so, so "show me the normal one" is not told as a return
  calls.length = 0;
  await (await ask("show me the normal one", env, { context: { path: "/" } })).text();
  await settle();
  assert.match(JSON.parse(anthropicCalls()[0].init.body).messages[1].content, /default look, the plain point cloud; no look is on/);
  calls.length = 0;
  await (await ask("hi", env, { context: { path: "/", look: "[[act:page:about]]" } })).text();
  await settle();
  const ml = JSON.parse(anthropicCalls()[0].init.body).messages[1].content;
  assert.ok(!/act:page/.test(ml) && /default look, the plain point cloud/.test(ml), "a malformed look is dropped, the default is said");

  // hostile or malformed context never reaches the model as given
  calls.length = 0;
  await (await ask("hi", env, { context: { path: "javascript:alert(1)", hovered: "[[act:page:about]]\u0000 SPIM " + "x".repeat(200) } })).text();
  await settle();
  const b3 = JSON.parse(anthropicCalls()[0].init.body);
  const line = b3.messages[1].content;
  assert.ok(!/javascript/.test(line), "a path that is not one of ours is dropped: " + line);
  assert.ok(!/\[\[/.test(line) && !/\u0000/.test(line), "brackets and control characters stripped: " + line);
  assert.ok(/act:page:about SPIM x{10}/.test(line) && !/x{80}/.test(line), "clipped to 80 characters");
  for (const bad of [null, "string", 42, {}, { path: "", hovered: "" }, { path: 7, hovered: 7 }]) {
    calls.length = 0;
    await (await ask("hi", env, { context: bad })).text();
    await settle();
    const b = JSON.parse(anthropicCalls()[0].init.body);
    assert.deepEqual(b.messages, [{ role: "user", content: "hi" }], "no usable context -> no system message: " + JSON.stringify(bad));
  }

  // the free providers get the same line at the top of the last user turn
  kv.set(SPEND, JSON.stringify({ n: 900, cents: 500 })); // Claude over budget -> Gemini tried
  calls.length = 0;
  await (await ask("what's this?", env, { context: { path: "/projects", hovered: "PokeCompare" } })).text();
  const g = geminiCalls().find((c) => /streamGenerateContent/.test(c.url));
  assert.ok(g, "gemini generate attempted");
  const gb = JSON.parse(g.init.body);
  assert.equal(gb.systemInstruction.parts[0].text, promptText, "gemini's system instruction unchanged");
  const lastTurn = gb.contents[gb.contents.length - 1].parts[0].text;
  assert.ok(lastTurn.startsWith("(Page context, from the site itself: The visitor is on the projects page (/projects). They are looking at the project card for PokeCompare."), lastTurn);
  assert.ok(lastTurn.endsWith("\n\nwhat's this?"), "the question follows the note");
  kv.set(SPEND, spendSnap);
  clearParked();
  ok("page context: Claude system message after the user turn, prefix elsewhere, hostile input clipped");
}

// 1c. sizing: a hard question raises effort through a per-turn system message
//     placed before the question, with the top-level effort untouched; a dead
//     or slow sizer means low effort and no such message
{
  const spendSnap = kv.get(SPEND);
  sizer = "4 compare";
  calls.length = 0;
  const res = await ask("compare SPIM and PokeCompare for a data role", env, { context: { path: "/projects" } });
  const e = envelope(await res.text());
  await settle();
  const body = JSON.parse(anthropicCalls()[0].init.body);
  assert.equal(body.messages.length, 3);
  assert.deepEqual(body.messages[0], { role: "system", content: [], output_config: { effort: "high" } }, "effort message right before the question");
  assert.equal(body.messages[1].role, "user");
  assert.equal(body.messages[2].role, "system", "the context line stays last");
  assert.deepEqual(body.output_config, { effort: "low" });
  assert.equal(body.model, "claude-sonnet-5-5", "rated 4: handed to Sonnet");
  assert.equal(body.fallbacks, "default");
  assert.equal(anthropicCalls()[0].init.headers["anthropic-beta"], "server-side-fallback-2026-07-01,mid-conversation-output-config-2026-07-01");
  assert.equal(res.headers.get("x-chat-model"), "claude-sonnet-5-5");
  assert.equal(e.stats.model, "claude-sonnet-5-5");
  assert.equal(e.stats.effort, "high");
  assert.deepEqual({ ...e.stats.size, ms: 0 }, { complexity: 4, kind: "compare", ms: 0, model: "claude-haiku-5-5", cents: 0.0017 });
  assert.equal(e.stats.cents, 0.4857, "Sonnet prices: (420*2 + 11000*0.2 + 180*10)/1e4 + the sizer's 0.0017");

  sizer = "3";
  calls.length = 0;
  await (await ask("what do you think of Rust?")).text();
  await settle();
  const b3 = JSON.parse(anthropicCalls()[0].init.body);
  assert.deepEqual(b3.messages[0], { role: "system", content: [], output_config: { effort: "medium" } }, "a bare digit still sizes");
  assert.equal(b3.model, "claude-sonnet-5-5", "rated 3: Sonnet, medium");

  sizer = "2 tour";
  calls.length = 0;
  await (await ask("give me a tour")).text();
  await settle();
  const bt = JSON.parse(anthropicCalls()[0].init.body);
  assert.equal(bt.model, "claude-sonnet-5-5", "a tour always goes to Sonnet, whatever the rating");

  sizer = "1 trick";
  calls.length = 0;
  await (await ask("just choose one")).text();
  await settle();
  assert.equal(JSON.parse(anthropicCalls()[0].init.body).model, "claude-sonnet-5-5", "a trick goes to Sonnet: it is token work");
  assert.deepEqual(bt.messages, [{ role: "user", content: "give me a tour" }], "at low effort, no effort message");

  sizer = "down";
  calls.length = 0;
  const e2 = envelope(await (await ask("hello")).text());
  await settle();
  assert.deepEqual(JSON.parse(anthropicCalls()[0].init.body).messages, [{ role: "user", content: "hello" }], "sizer down: no effort message");
  assert.equal(JSON.parse(anthropicCalls()[0].init.body).model, "claude-sonnet-5-5", "no verdict: Sonnet answers, so a dead sizer costs no quality");
  assert.equal(e2.stats.effort, "low");
  assert.equal(e2.stats.size, null);

  sizer = "hang";
  calls.length = 0;
  const t0 = Date.now();
  const e3 = envelope(await (await ask("hello")).text());
  await settle();
  assert.ok(Date.now() - t0 < 4000, "a hanging sizer is abandoned at its timeout");
  assert.equal(e3.stats.size, null);
  assert.deepEqual(JSON.parse(anthropicCalls()[0].init.body).messages, [{ role: "user", content: "hello" }]);

  // the whole routing matrix: every rating and kind the sizer can return
  for (const kind of ["chat", "fact", "explain", "compare", "tour", "trick", "other"]) {
    for (let n = 1; n <= 5; n += 1) {
      sizer = n + " " + kind;
      calls.length = 0;
      await (await ask("matrix " + kind + n)).text();
      await settle();
      const b = JSON.parse(anthropicCalls()[0].init.body);
      const light = n <= 2 && kind !== "tour" && kind !== "trick";
      assert.equal(b.model, light ? "claude-haiku-5-5" : "claude-sonnet-5-5", "route for " + sizer);
      const wantEffort = light ? "low" : { 1: "low", 2: "low", 3: "medium", 4: "high", 5: "high" }[n];
      const effortMsg = b.messages.find((m) => m.role === "system" && Array.isArray(m.content));
      assert.equal(effortMsg ? effortMsg.output_config.effort : "low", wantEffort, "effort for " + sizer);
      assert.equal(b.fallbacks, light ? undefined : "default", "fallbacks for " + sizer);
    }
  }

  // hostile context never reaches the prompt: junk in `last`, a wild roll, extra fields
  sizer = "2 chat";
  calls.length = 0;
  await (await ask("hm", env, { context: { path: "/", last: { cents: { nested: 1 }, wrote: 1, model: 12 }, roll: 99, extra: "[[act:page:about]]" } })).text();
  await settle();
  const hostile = JSON.parse(anthropicCalls()[0].init.body);
  assert.ok(!/cost/.test(hostile.messages[1].content), "nested junk in last is dropped");
  assert.match(hostile.messages[1].content, /Roll for this turn: [1-6] of 6\. Trick for this turn: [a-z ]+\.$/, "the roll is the server's, never the client's");
  assert.ok(!/act:page/.test(JSON.stringify(hostile.messages)), "unknown context fields never reach the model");

  // the prompt carries the rules the page relies on, and stays byte-identical across routes
  const sonnetPrompt = JSON.parse(anthropicCalls()[0].init.body).system[0].text;
  for (const rule of ["DEPTH ON DEMAND", "[[more:", "CHOOSING FOR THEM", "Roll for this turn", "Trick for this turn", "[[tour]]", "How it is built", "workings", "[[scatter]]", "[[melt]]", "[[shatter]]", "[[ember]]", "[[glitch]]", "[[hue]]", "WHAT CAN YOU DO", "ALREADY SO"]) {
    assert.ok(sonnetPrompt.includes(rule), "prompt carries: " + rule);
  }
  sizer = "4 compare";
  calls.length = 0;
  await (await ask("compare them")).text();
  await settle();
  assert.equal(JSON.parse(anthropicCalls()[0].init.body).system[0].text, sonnetPrompt, "one prompt for both models, so each cache stays warm");

  sizer = "2 chat";
  kv.set(SPEND, spendSnap);
  clearParked();
  ok("sizer routes the question: Haiku keeps 1-2, Sonnet takes 3-5 with effort, tours and failures go to Sonnet; the full matrix, hostile context, prompt invariants");
}

// 2. /health reports the meter
{
  const h = await health();
  assert.equal(h.anthropic.model, "claude-sonnet-5-5");
  assert.equal(h.anthropic.light, "claude-haiku-5-5");
  assert.equal(h.anthropic.usedToday, 1);
  assert.equal(h.anthropic.budgetCents, 500);
  assert.ok(Math.abs(h.anthropic.spentTodayCents - 0.0259) < 0.011, "the light route's spend: " + h.anthropic.spentTodayCents);
  assert.equal(h.anthropic.lastRequest.cacheRead, 11000);
  assert.equal(h.anthropic.lastError, null);
  assert.equal(h.anthropic.meter, undefined);
  assert.match(h.budget.boundedBy, /Claude: 500 cents/);
  ok("/health shows model, count, cents, budget, cache read");
}

// 2b. cache stats: the first question was a hit in this fake (cacheRead 11000)
{
  const h = await health();
  assert.equal(h.anthropic.cache.hits, 1);
  assert.equal(h.anthropic.cache.misses, 0);
  assert.equal(h.anthropic.cache.hitRate, "100%");
  ok("/health shows cache hits, misses and hit rate");
}

// 3. budget spent -> Claude skipped, Gemini tried
{
  kv.set(SPEND, JSON.stringify({ n: 900, cents: 500 }));
  calls.length = 0;
  const res = await ask("hello");
  await res.text();
  assert.equal(anthropicCalls().length, 0, "Claude must be skipped once the budget is spent");
  assert.ok(geminiCalls().length > 0, "Gemini must be attempted");
  assert.equal(res.status, 502, "with Gemini down the chain reports unavailable");
  kv.set(SPEND, JSON.stringify({ n: 1, cents: 0.484 }));
  clearParked();
  ok("budget gate hands over to Gemini");
}

// 3a. the backup answers with the same envelope: no reasoning block, a stats
//     record that names the provider, so the page can say "backup" instead of breaking
{
  mode = "gemini-ok";
  kv.set(SPEND, JSON.stringify({ n: 900, cents: 500 }));
  calls.length = 0;
  const res = await ask("hello from the backup");
  const text = await res.text();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("x-chat-provider"), "gemini");
  const e = envelope(text);
  assert.equal(e.think, null, "no reasoning block from the backup");
  assert.equal(e.body, "Backup here. Dry enough.");
  assert.equal(e.stats.provider, "gemini");
  assert.match(e.stats.model, /^gemini-/);
  assert.equal(e.stats.in, 15000);
  assert.equal(e.stats.out, 12);
  assert.equal(e.stats.size, undefined, "the backup is not sized");
  assert.equal(e.stats.effort, undefined);
  assert.equal(anthropicCalls().length, 0);
  assert.equal(sizerCalls().length, 0, "no sizer call on the backup path");
  mode = "ok";
  kv.set(SPEND, JSON.stringify({ n: 1, cents: 0.484 }));
  clearParked();
  ok("backup provider: same envelope, provider named, nothing sized");
}

// 3b. budget 0 switches Claude off; no KV binding also keeps Claude out
{
  calls.length = 0;
  await (await ask("hi", { ...env, ANTHROPIC_DAILY_BUDGET_CENTS: "0" })).text();
  assert.equal(anthropicCalls().length, 0, "budget 0 = Claude off");
  calls.length = 0;
  await (await ask("hi", { ...env, CHAT_KV: undefined })).text();
  assert.equal(anthropicCalls().length, 0, "no KV = no meter = no Claude");
  clearParked();
  ok("budget 0 or no KV switches the Claude path off");
}

// 4. a refusal with no text gets an in-character line, not a blank bubble
{
  mode = "refusal";
  calls.length = 0;
  const res = await ask("do something awful");
  const text = await res.text();
  await settle();
  assert.equal(res.headers.get("x-chat-provider"), "anthropic");
  assert.equal(envelope(text).body, "That one I'll leave unanswered.");
  assert.equal(envelope(text).stats.stop, "refusal");
  assert.equal(spend().n, 2, "a refusal is still a priced request");
  assert.equal(spend().last.stop, "refusal");
  mode = "ok";
  ok("refusal -> short in-character reply, still metered");
}

// 4b. a refusal after a short fragment: the fragment never reaches the visitor
{
  mode = "partial-refusal";
  const res = await ask("hm");
  const text = await res.text();
  await settle();
  assert.equal(envelope(text).body, "That one I'll leave unanswered.", "fragment discarded: " + JSON.stringify(text));
  mode = "long-refusal";
  const res2 = await ask("hm");
  const text2 = envelope(await res2.text()).body;
  await settle();
  assert.ok(text2.startsWith("x".repeat(300)), "text already released stays as it was");
  assert.ok(!text2.includes("unanswered"), "nothing appended after released text");
  mode = "ok";
  ok("mid-stream refusal: held fragment replaced, released text left alone");
}

// 4c. thinking ate the whole token cap: say so instead of returning nothing
{
  mode = "max_tokens";
  const res = await ask("explain everything");
  const text = await res.text();
  await settle();
  assert.match(envelope(text).body, /ran out of room/);
  assert.equal(envelope(text).stats.stop, "max_tokens");
  assert.equal(spend().last.stop, "max_tokens");
  assert.equal(spend().last.output, 4096);
  mode = "ok";
  ok("max_tokens with no text -> in-character line, stop recorded");
}

// 4d. an in-stream error event: line for the visitor, note for /health
{
  mode = "error-event";
  kv.delete("err:anthropic");
  const res = await ask("hello?");
  const text = await res.text();
  await settle();
  assert.match(envelope(text).body, /Lost the thread/);
  const err = JSON.parse(kv.get("err:anthropic"));
  assert.equal(err.status, 0);
  assert.match(err.body, /overloaded_error/);
  assert.equal(spend().last.stop, "error");
  mode = "ok";
  kv.delete("err:anthropic");
  ok("stream error event -> in-character line, lastError recorded");
}

// 4e. server-side fallback: usage.iterations is summed, not the serving attempt alone
{
  mode = "iterations";
  const before = spend().cents;
  const res = await ask("fallback please");
  await res.text();
  await settle();
  const cents = spend().cents - before;
  // the light route: (840*0.1 + 11000*0.2 + 11000*0.01 + 220*0.5) / 1e4 = 0.2504, plus the sizer's 0.0017
  assert.ok(Math.abs(cents - 0.2521) < 1e-6, "iterations summed: " + cents);
  mode = "ok";
  ok("fallback iterations priced in full");
}

// 5. a 400 from Anthropic is recorded for /health and the chain falls through; repeats cost no write
{
  mode = "400";
  calls.length = 0;
  const res = await ask("hello");
  await res.text();
  assert.equal(res.status, 502);
  assert.ok(geminiCalls().length > 0, "fell through to Gemini");
  const err = JSON.parse(kv.get("err:anthropic"));
  assert.equal(err.status, 400);
  assert.match(err.body, /fallbacks/);
  assert.equal(kv.get("down:anthropic:" + todayKey), "error");
  assert.equal(ttls.get("down:anthropic:" + todayKey), 300);
  const h = await health();
  assert.equal(h.anthropic.lastError.status, 400);
  assert.equal(h.anthropic.parked, "error");
  clearParked();
  const putsBefore = puts.filter((k) => k === "err:anthropic").length;
  await (await ask("hello")).text();
  assert.equal(puts.filter((k) => k === "err:anthropic").length, putsBefore, "identical failure is not rewritten");
  clearParked();
  kv.delete("err:anthropic");
  mode = "ok";
  ok("400 -> lastError in /health, parked 5 min, Gemini tried, no repeat writes");
}

// 5b. the Console's monthly spend limit answers 400 with "usage limits": parked like a quota, not retried every 5 min
{
  mode = "spendlimit";
  await (await ask("hello")).text();
  assert.equal(kv.get("down:anthropic:" + todayKey), "quota");
  assert.equal(ttls.get("down:anthropic:" + todayKey), 5400);
  clearParked();
  kv.delete("err:anthropic");
  mode = "ok";
  ok("Console spend limit -> parked as quota");
}

// 6. a 429 parks Claude as quota: 90 min without a hint, retry-after (clamped to a minute) with one
{
  mode = "429";
  const res = await ask("hello");
  const text = await res.text();
  assert.equal(res.status, 429);
  assert.match(text, /allowance/);
  assert.equal(kv.get("down:anthropic:" + todayKey), "quota");
  assert.equal(ttls.get("down:anthropic:" + todayKey), 5400);
  clearParked();
  mode = "429ra";
  await (await ask("hello")).text();
  assert.equal(kv.get("down:anthropic:" + todayKey), "quota");
  assert.equal(ttls.get("down:anthropic:" + todayKey), 60, "retry-after 30s -> 60s floor");
  clearParked();
  kv.delete("err:anthropic");
  mode = "ok";
  ok("429 -> parked as quota; retry-after respected");
}

// 7. after parking clears, Claude answers again
{
  calls.length = 0;
  const res = await ask("and again?");
  const text = await res.text();
  await settle();
  assert.equal(res.headers.get("x-chat-provider"), "anthropic");
  assert.equal(envelope(text).body, ANSWER);
  ok("recovers once unparked");
}

// 8. meter fails closed: unreadable record, corrupt record
{
  failGet = (k) => k === SPEND;
  calls.length = 0;
  await (await ask("hello")).text();
  assert.equal(anthropicCalls().length, 0, "unreadable meter -> Claude skipped");
  failGet = null;
  clearParked();
  const h = await health();
  kv.set(SPEND, "{not json");
  calls.length = 0;
  await (await ask("hello")).text();
  assert.equal(anthropicCalls().length, 0, "corrupt meter -> Claude skipped");
  const h2 = await health();
  assert.match(h2.anthropic.meter || "", /unreadable/);
  kv.set(SPEND, JSON.stringify({ n: 7, cents: 10 }));
  clearParked();
  ok("unreadable or corrupt meter -> Claude skipped, /health says so");
}

// 9. a failed spend write pauses Claude (must run last: the pause is isolate-local)
{
  failPut = (k) => k === SPEND;
  calls.length = 0;
  const res = await ask("hello");
  const text = await res.text();
  await settle();
  assert.equal(envelope(text).body, ANSWER, "the answer that hit the failed write was still delivered");
  assert.equal(JSON.parse(kv.get(SPEND)).n, 7, "record unchanged");
  failPut = null;
  calls.length = 0;
  await (await ask("hello")).text();
  assert.equal(anthropicCalls().length, 0, "after a failed write Claude is paused");
  assert.ok(geminiCalls().length > 0);
  const h = await health();
  assert.match(h.anthropic.meter || "", /paused/);
  ok("failed spend write -> Claude paused, Gemini answers");
}

console.log(`ALL ${passed} CHECKS PASSED`);
