/**
 * Manual preview recorder — you control when recording starts/stops.
 *
 * Launches a VISIBLE browser at 2048x1043. For each page:
 *   1. Navigates to the page
 *   2. Waits for you to press ENTER to start recording
 *   3. First 2 seconds are recorded but will be trimmed (to skip any reload glitch)
 *   4. Console prints "RECORDING NOW" when the real portion begins — interact!
 *   5. Press ENTER to stop, trim, and save
 *
 * Output: public/previews/{about,skills,resume,projects}.mp4
 *
 * Usage: node record-previews.mjs
 * Requires: dev server running at localhost:3000
 */

import puppeteer from "puppeteer";
import { PuppeteerScreenRecorder } from "puppeteer-screen-recorder";
import path from "path";
import readline from "readline";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import { createRequire } from "module";
import fs from "fs";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "public", "previews");

const WIDTH = 2048;
const HEIGHT = 1043;
const BASE_URL = "http://localhost:3000/hyder";
const TRIM_SECONDS = 4;

const recorderConfig = {
  fps: 24,
  videoFrame: { width: WIDTH, height: HEIGHT },
  aspectRatio: "2048:1043",
};

// Get the bundled ffmpeg path from @ffmpeg-installer
let FFMPEG;
try {
  FFMPEG = require("@ffmpeg-installer/ffmpeg").path;
} catch {
  FFMPEG = "ffmpeg"; // fallback to system ffmpeg
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function waitForEnter(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, () => {
      rl.close();
      resolve();
    });
  });
}

function trimVideo(inputPath, outputPath, trimStart) {
  // -ss before -i for fast seek, -c copy for no re-encode
  const cmd = `"${FFMPEG}" -y -ss ${trimStart} -i "${inputPath}" -c copy "${outputPath}"`;
  execSync(cmd, { stdio: "pipe" });
}

const PAGES = [
  { name: "about",    hash: "#/about",    tip: "Throw a block, scroll down, nudge a heading, double-click to burst" },
  { name: "skills",   hash: "#/skills",   tip: "Click nodes to select, drag and fling nodes" },
  { name: "resume",   hash: "#/resume",   tip: "Scroll down, scroll back up, click Diploma" },
  { name: "projects", hash: "#/projects", tip: "Smooth scroll through all projects (~5 sec)" },
];

// Pass page names as args to record only those, e.g.: node record-previews.mjs about
const only = process.argv.slice(2).map(s => s.toLowerCase());

async function main() {
  console.log("Launching visible browser...\n");
  const browser = await puppeteer.launch({
    headless: false,
    args: [
      `--window-size=${WIDTH},${HEIGHT + 100}`,
      "--no-sandbox",
      "--disable-setuid-sandbox",
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });

  const toRecord = only.length ? PAGES.filter(p => only.includes(p.name)) : PAGES;
  for (const { name, hash, tip } of toRecord) {
    console.log(`\n─── ${name.toUpperCase()} ───`);
    console.log(`  ${tip}`);

    await page.goto(`${BASE_URL}/${hash}`, { waitUntil: "networkidle0", timeout: 30000 });

    await waitForEnter("  Press ENTER when the page is ready to START recording...");

    const tmpPath = path.join(OUT_DIR, `${name}_raw.mp4`);
    const finalPath = path.join(OUT_DIR, `${name}.mp4`);

    const recorder = new PuppeteerScreenRecorder(page, recorderConfig);
    await recorder.start(tmpPath);

    // Wait for the trim period to pass, then notify
    console.log(`  Recording... (first ${TRIM_SECONDS}s will be trimmed)`);
    await sleep(TRIM_SECONDS * 1000);
    console.log("  >>> RECORDING NOW — interact with the page! <<<");

    await waitForEnter("  Press ENTER to STOP recording...");

    await recorder.stop();

    // Trim the first N seconds
    console.log(`  Trimming first ${TRIM_SECONDS}s...`);
    try {
      trimVideo(tmpPath, finalPath, TRIM_SECONDS);
      fs.unlinkSync(tmpPath);
    } catch (e) {
      console.log(`  Trim failed (${e.message}), keeping raw file as output`);
      fs.renameSync(tmpPath, finalPath);
    }

    console.log(`  Saved ${name}.mp4`);
  }

  await browser.close();
  console.log("\nDone! All MP4 files saved to public/previews/");
}

main().catch(console.error);
