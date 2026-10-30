import http from "node:http"; import fs from "node:fs"; import path from "node:path";
const BUILD = path.resolve("build");
const MIME = {".html":"text/html",".js":"text/javascript",".css":"text/css",".json":"application/json",".png":"image/png",".jpg":"image/jpeg",".webp":"image/webp",".gif":"image/gif",".svg":"image/svg+xml",".pdf":"application/pdf",".xml":"application/xml",".txt":"text/plain",".mp4":"video/mp4",".ico":"image/x-icon",".lottie":"application/octet-stream"};
http.createServer((req,res)=>{
  let p = decodeURIComponent(new URL(req.url,"http://x").pathname);
  let f = path.join(BUILD,p);
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f,"index.html");
  if (!fs.existsSync(f)) { // gh-pages 404 behavior
    f = path.join(BUILD,"404.html"); res.statusCode = 404;
    if (!fs.existsSync(f)) { res.end("404"); return; }
  }
  res.setHeader("content-type", MIME[path.extname(f)]||"application/octet-stream");
  fs.createReadStream(f).pipe(res);
}).listen(3457, ()=>console.log("build server on :3457"));
