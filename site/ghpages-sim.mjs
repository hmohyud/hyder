// Mimics GitHub Pages: 301 for extension-less dirs without trailing slash,
// 404.html with 404 status for missing paths.
import http from "node:http"; import fs from "node:fs"; import path from "node:path";
const BUILD = path.resolve("build");
const MIME = {".html":"text/html",".js":"text/javascript",".css":"text/css",".json":"application/json",".png":"image/png",".jpg":"image/jpeg",".webp":"image/webp",".gif":"image/gif",".svg":"image/svg+xml",".pdf":"application/pdf",".xml":"application/xml",".txt":"text/plain",".mp4":"video/mp4",".ico":"image/x-icon",".lottie":"application/octet-stream"};
http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  let f = path.join(BUILD, p);
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) {
    if (!p.endsWith("/")) { res.statusCode = 301; res.setHeader("location", p + "/"); res.end(); return; }
    f = path.join(f, "index.html");
  }
  if (!fs.existsSync(f)) {
    res.statusCode = 404; f = path.join(BUILD, "404.html");
    if (!fs.existsSync(f)) { res.end("404"); return; }
  }
  res.setHeader("content-type", MIME[path.extname(f)] || "application/octet-stream");
  fs.createReadStream(f).pipe(res);
}).listen(3457, () => console.log("gh-pages sim on :3457"));
