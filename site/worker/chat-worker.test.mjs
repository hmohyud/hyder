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
const THINK = [
  { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
  { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "" } },
  { type: "content_block_stop", index: 0 },
];
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
globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), init });
  if (String(url).startsWith("https://api.anthropic.com/")) {
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
  return new Response("nope", { status: 500 }); // gemini discovery + generate: unavailable
};

const { default: worker } = await import("./chat-worker.js");
const env = { ANTHROPIC_KEY: "sk-test", GEMINI_KEY: "g-test", CHAT_KV, DAILY_PER_IP: "100", ANTHROPIC_DAILY_BUDGET_CENTS: "500" };
const waits = [];
const ctx = { waitUntil: (p) => waits.push(p) };
const ask = (q, e = env) => worker.fetch(new Request("https://hyder-chat.test/", {
  method: "POST",
  headers: { "content-type": "application/json", origin: "https://hydermohyuddin.com", "cf-connecting-ip": "1.2.3.4" },
  body: JSON.stringify({ messages: [{ role: "user", content: q }] }),
}), e, ctx);
const health = async () => (await worker.fetch(new Request("https://hyder-chat.test/health", { headers: { origin: "https://hydermohyuddin.com" } }), env, ctx)).json();
const settle = async () => { await Promise.allSettled(waits.splice(0)); await new Promise((r) => setTimeout(r, 20)); };
const anthropicCalls = () => calls.filter((c) => c.url.startsWith("https://api.anthropic.com/"));
const geminiCalls = () => calls.filter((c) => /generativelanguage/.test(c.url));
const spend = () => JSON.parse(kv.get(SPEND));
let passed = 0;
const ok = (name) => { passed++; console.log("  pass:", name); };

// 1. happy path: Claude answers first, with the right request shape
{
  calls.length = 0;
  const res = await ask("What was hard about SPIM?");
  const text = await res.text();
  await settle();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("x-chat-provider"), "anthropic");
  assert.equal(res.headers.get("x-chat-model"), "claude-sonnet-5-5");
  assert.equal(text, ANSWER);
  assert.equal(geminiCalls().length, 0, "gemini must not be called when Claude answers");
  assert.equal(waits.length, 0);
  const req = anthropicCalls()[0];
  const body = JSON.parse(req.init.body);
  assert.equal(body.model, "claude-sonnet-5-5");
  assert.equal(body.max_tokens, 4096);
  assert.equal(body.stream, true);
  assert.equal(body.fallbacks, "default");
  assert.deepEqual(body.output_config, { effort: "low" });
  assert.equal(body.thinking, undefined, "thinking is left at the model default (adaptive)");
  assert.equal(body.temperature, undefined);
  assert.ok(Array.isArray(body.system) && body.system.length === 1);
  assert.deepEqual(body.system[0].cache_control, { type: "ephemeral", ttl: "1h" });
  assert.ok(body.system[0].text.startsWith("You are Hyder Mohyuddin"));
  assert.ok(body.system[0].text.includes("witty by default"), "wit rules present in the prompt");
  assert.ok(body.system[0].text.includes("No humour at all in anything sincere or heavy"), "carve-out present");
  assert.deepEqual(body.messages, [{ role: "user", content: "What was hard about SPIM?" }]);
  assert.equal(req.init.headers["anthropic-version"], "2023-06-01");
  assert.equal(req.init.headers["anthropic-beta"], "server-side-fallback-2026-07-01");
  assert.equal(req.init.headers["x-api-key"], "sk-test");
  const rec = spend();
  assert.equal(rec.n, 1);
  assert.ok(Math.abs(rec.cents - 0.484) < 1e-9, "cents " + rec.cents); // (420*2 + 11000*0.2 + 180*10) / 1e4
  assert.equal(rec.last.cacheRead, 11000);
  assert.equal(rec.last.output, 180);
  assert.equal(rec.last.stop, "end_turn");
  assert.equal(kv.get("used:anthropic:" + todayKey), undefined, "no duplicate tally write for Claude");
  assert.equal(kv.get("c:" + todayKey + ":1.2.3.4"), "1", "per-visitor counter charged");
  assert.equal(puts.filter((k) => k === SPEND || k.startsWith("c:")).length, 2, "two KV writes on the happy path");
  ok("Claude first, request shape, usage priced, two KV writes");
}

// 2. /health reports the meter
{
  const h = await health();
  assert.equal(h.anthropic.model, "claude-sonnet-5-5");
  assert.equal(h.anthropic.usedToday, 1);
  assert.equal(h.anthropic.budgetCents, 500);
  assert.ok(Math.abs(h.anthropic.spentTodayCents - 0.48) < 0.011);
  assert.equal(h.anthropic.lastRequest.cacheRead, 11000);
  assert.equal(h.anthropic.lastError, null);
  assert.equal(h.anthropic.meter, undefined);
  assert.match(h.budget.boundedBy, /Claude: 500 cents/);
  ok("/health shows model, count, cents, budget, cache read");
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
  assert.equal(text, "That one I'll leave unanswered.");
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
  assert.equal(text, "That one I'll leave unanswered.", "fragment discarded: " + JSON.stringify(text));
  mode = "long-refusal";
  const res2 = await ask("hm");
  const text2 = await res2.text();
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
  assert.match(text, /ran out of room/);
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
  assert.match(text, /Lost the thread/);
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
  // (840*2 + 11000*4 + 11000*0.2 + 220*10) / 1e4 = 5.008
  assert.ok(Math.abs(cents - 5.008) < 1e-6, "iterations summed: " + cents);
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
  assert.equal(text, ANSWER);
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
  assert.equal(text, ANSWER, "the answer that hit the failed write was still delivered");
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
