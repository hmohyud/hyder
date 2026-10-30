// chat-dev-server.mjs
// Local stand-in for the Cloudflare Worker, speaking the identical contract so
// the UI can be verified end to end with no API key and no cost.
//
//   node chat-dev-server.mjs            # uses whatever OLLAMA_MODEL is set, default qwen2.5
//   OLLAMA_MODEL=mistral node chat-dev-server.mjs
//
// Requires Ollama running locally (http://127.0.0.1:11434).

import http from "node:http";
import { PROMPT } from "./worker/knowledge.js";
import { createLeakGuard } from "./worker/guard.js";

const PORT = Number(process.env.CHAT_PORT || 8787);
const OLLAMA = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const MODEL = process.env.OLLAMA_MODEL || "qwen2.5";

const server = http.createServer(async (req, res) => {
  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
  };

  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    res.end();
    return;
  }
  if (req.method !== "POST") {
    res.writeHead(405, cors);
    res.end("POST only");
    return;
  }

  let raw = "";
  for await (const chunk of req) raw += chunk;

  let messages = [];
  try {
    const body = JSON.parse(raw);
    messages = (body.messages || [])
      .filter((m) => m && (m.role === "user" || m.role === "assistant"))
      .slice(-12)
      .map((m) => ({ role: m.role, content: String(m.content || "").slice(0, 1500) }));
  } catch (err) {
    res.writeHead(400, cors);
    res.end("bad json");
    return;
  }

  res.writeHead(200, {
    ...cors,
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
  });

  try {
    const upstream = await fetch(OLLAMA + "/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "system", content: PROMPT }, ...messages],
        stream: true,
        options: { temperature: 0.4, num_predict: 500 },
      }),
    });

    if (!upstream.ok || !upstream.body) {
      res.end("Local model unavailable (" + upstream.status + ").");
      return;
    }

    // Ollama streams NDJSON: {"message":{"content":"..."},"done":false}
    const guard = createLeakGuard((text) => {
      res.write(text);
    });
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const json = JSON.parse(line);
          if (json.message && json.message.content) await guard.push(json.message.content);
        } catch (err) {
          /* skip partial frame */
        }
      }
    }
    await guard.end();
    res.end();
  } catch (err) {
    res.end("Local model unreachable — is Ollama running?");
  }
});

server.listen(PORT, () => {
  console.log(`chat dev server on http://127.0.0.1:${PORT}  (ollama model: ${MODEL})`);
});
