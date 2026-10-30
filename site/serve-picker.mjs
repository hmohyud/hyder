// Serves point-picker.html next to the real head-points.bin, so the picker
// sees exactly the cloud the site ships. Dev-only; nothing here deploys.
//   node serve-picker.mjs   ->  http://localhost:3458
import http from "node:http";
import fs from "node:fs";

http.createServer((req, res) => {
  const p = new URL(req.url, "http://x").pathname;
  if (p === "/") {
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(fs.readFileSync("point-picker.html"));
    return;
  }
  if (p === "/head-points.bin") {
    res.setHeader("content-type", "application/octet-stream");
    res.end(fs.readFileSync("public/head-points.bin"));
    return;
  }
  res.statusCode = 404;
  res.end("404");
}).listen(3458, () => console.log("point picker on http://localhost:3458"));
