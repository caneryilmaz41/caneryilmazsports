/* eslint-disable no-console */
import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const noCache = (req, res, next) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  next();
};

const app = express();
app.set("etag", false);
// ---------- CORS ----------
app.use(cors({
  origin: ['https://caneryilmazsports.vercel.app', 'http://localhost:5173', 'http://localhost:3000', 'https://caneryilmazsports-backend.onrender.com'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// ---------- Health ----------
app.get("/health", (req, res) => res.status(200).send("ok"));

// ---------- helper.js otomatik çalıştırma ----------
let helperRunning = false;
let helperTimer = null;

function runHelperOnce() {
  if (helperRunning) return;
  helperRunning = true;

  console.log('[helper] Başlatılıyor...');
  const child = spawn(process.execPath, ["helper.js"], {
    stdio: "inherit",
    cwd: __dirname,
    env: { ...process.env, CHROME_PATH: process.env.CHROME_PATH || '/usr/bin/google-chrome-stable' },
  });

  child.on("close", (code) => {
    helperRunning = false;
    console.log(`[helper] bitti. exit code: ${code}`);
  });

  child.on("error", (err) => {
    helperRunning = false;
    console.error("[helper] spawn error:", err.message);
  });
}

runHelperOnce();
helperTimer = setInterval(runHelperOnce, 12 * 60 * 1000);

app.post("/api/refresh", (req, res) => {
  runHelperOnce();
  res.json({ ok: true });
});

// ---------- JSON Yükleyiciler ----------
function loadStreams() {
  try {
    const p = path.join(__dirname, "streams.json");
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return {};
  }
}

function loadMatches() {
  try {
    const p = path.join(__dirname, "matches.json");
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return [];
  }
}

function getReferer() {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "domain.json"), "utf8"));
    return raw.domain || raw.active || "https://trgoals1394.xyz/";
  } catch {
    return "https://trgoals1394.xyz/";
  }
}


// ---------- API: Kanal listesi ----------
app.get("/api/channels", (req, res) => {
  const streams = loadStreams();
  res.json(streams);
});

// ---------- API: Maç listesi ----------
app.get("/api/matches", (req, res) => {
  const matches = loadMatches();
  res.json(matches);
});

// ---------- API: Kanal ismine göre stream ----------
app.get("/api/stream/:channel", noCache, (req, res) => {
  const channel = decodeURIComponent(req.params.channel || "");
  console.log('[STREAM] Request for channel:', channel);
  const streams = loadStreams();
  console.log('[STREAM] Available streams:', Object.keys(streams));
  const url = streams[channel];
  if (!url) {
    console.log('[STREAM] Channel not found:', channel);
    return res.status(404).send("Channel not found");
  }

  const proxied = `/api/hls?u=${encodeURIComponent(url)}`;
  console.log('[STREAM] Returning proxied URL:', proxied);
  res.json({ channel, url: proxied });
});

// ---------- API: id → stream ----------
function channelNameFromId(id) {
  if (!id) return null;
  const m = String(id).toLowerCase();
  const mapExact = {
    "yayin1": "BeIN Sports 1",
    "yayinb2": "BeIN Sports 2",
    "yayinb3": "BeIN Sports 3",
    "yayinb4": "BeIN Sports 4",
    "yayinbm1": "BeIN Max 1",
    "yayinbm2": "BeIN Max 2",
    "yayinss": "S Sport",
    "yayinss2": "S Sport 2",
    "yayint1": "Tivibu 1",
    "yayint2": "Tivibu 2",
    "yayint3": "Tivibu 3",
    "yayint4": "Tivibu 4",
    "yayintrtspor": "TRT Spor",
    "yayintrtspor2": "TRT Spor 2",
    "yayintrt1": "TRT 1",
    "yayinas": "A Spor",
    "yayinatv": "ATV",
    "yayintv8": "TV 8",
    "yayintv85": "TV 8,5",
    "yayinnbatv": "NBA TV",
    "yayineu1": "Euro Sport 1",
    "yayineu2": "Euro Sport 2",
  };
  return mapExact[m] || null;
}

app.get("/api/stream-id/:id", noCache, (req, res) => {
  const id = decodeURIComponent(req.params.id || "");
  const name = channelNameFromId(id);
  if (!name) return res.status(404).send("Unknown id");
  const streams = loadStreams();
  const url = streams[name];
  if (!url) return res.status(404).send("Channel stream not found");

  const proxied = `/api/hls?u=${encodeURIComponent(url)}`;
  res.json({ id, name, url: proxied });
});

// ---------- API: Test Stream URL ----------
app.get("/api/test-stream/:channel", noCache, async (req, res) => {
  try {
    const channel = decodeURIComponent(req.params.channel || "");
    console.log('[TEST] Testing stream for channel:', channel);
    const streams = loadStreams();
    const url = streams[channel];
    if (!url) {
      console.log('[TEST] Channel not found:', channel);
      return res.status(404).json({ error: "Channel not found", available: Object.keys(streams) });
    }
    
    console.log('[TEST] Testing URL:', url);
    const referer = getReferer();
    const testRes = await fetch(url, {
      method: 'HEAD',
      headers: {
        Referer: referer,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });
    
    console.log('[TEST] Response status:', testRes.status, testRes.statusText);
    console.log('[TEST] Response headers:', Object.fromEntries(testRes.headers.entries()));
    
    res.json({
      channel,
      url,
      status: testRes.status,
      statusText: testRes.statusText,
      headers: Object.fromEntries(testRes.headers.entries()),
      referer
    });
  } catch (error) {
    console.error('[TEST] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ---------- API: HLS Proxy ----------
app.get("/api/hls", async (req, res) => {
  try {
    const target = req.query.u;
    console.log('[HLS] Request for:', target);
    if (!target || typeof target !== "string") {
      console.log('[HLS] Missing u param');
      return res.status(400).send("Missing u param");
    }

    // Sadece .m3u8 ve .ts dosyalarına izin ver
    if (!target.includes('.m3u8') && !target.includes('.ts')) {
      console.log('[HLS] Blocked non-stream file:', target);
      return res.status(404).send('Not found');
    }

    const referer = getReferer();
    const r = await fetch(target, {
      headers: {
        Referer: referer,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        Accept: "*/*",
        "Accept-Language": "tr-TR,tr;q=0.9",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache"
      },
    });

    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      console.error('[HLS] Upstream error:', r.status, r.statusText, 'URL:', target);
      return res.status(r.status).send(txt || "Upstream error");
    }

    const ct = r.headers.get("content-type") || "";
    const isPlaylist = ct.includes("mpegurl") || target.includes(".m3u8");

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "no-cache");

    if (isPlaylist) {
      const text = await r.text();
      const base = new URL(target);
      const baseUrl = base.origin + base.pathname.substring(0, base.pathname.lastIndexOf("/") + 1);
      const rewritten = text.split("\n").map(line => {
        const l = line.trim();
        if (!l || l.startsWith("#")) return line;
        // .jpeg, .jpg, .png gibi dosyaları tamamen kaldır
        if (l.includes('.jpeg') || l.includes('.jpg') || l.includes('.png')) {
          console.log('[HLS] Removing non-stream segment:', l);
          return ''; // Boş satır döndür
        }
        // Sadece .ts ve .m3u8 dosyalarını proxy'le
        if (!l.includes('.ts') && !l.includes('.m3u8')) {
          console.log('[HLS] Skipping unknown segment:', l);
          return '';
        }
        const abs = new URL(l, baseUrl).href;
        return `/api/hls?u=${encodeURIComponent(abs)}`;
      }).filter(line => line !== '').join("\n");

      res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
      return res.send(rewritten);
    } else {
      if (ct) res.setHeader("Content-Type", ct);
      return r.body.pipe(res);
    }
  } catch (err) {
    console.error("hls proxy error:", err);
    res.status(500).send("hls proxy error");
  }
});

// ---------- Shutdown ----------
process.on("SIGINT", () => {
  if (helperTimer) clearInterval(helperTimer);
  console.log("Kapanıyor...");
  process.exit(0);
});

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => console.log(`Backend ${PORT} portunda çalışıyor`));
