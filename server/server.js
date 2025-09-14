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

  // Production'da direkt URL kullan
  console.log('[STREAM] Returning direct URL:', url);
  res.json({ channel, url: url });
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
  
  // Eğer ID zaten bir URL ise direkt kullan
  if (id.startsWith('http')) {
    const proxied = `/api/hls?u=${encodeURIComponent(id)}`;
    return res.json({ id, name: 'Direct Stream', url: proxied });
  }
  
  const name = channelNameFromId(id);
  if (!name) return res.status(404).send("Unknown id");
  const streams = loadStreams();
  const url = streams[name];
  if (!url) return res.status(404).send("Channel stream not found");

  // Production'da direkt URL kullan
  res.json({ id, name, url: url });
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

// ---------- API: Refresh streams ----------
app.post("/api/refresh-streams", async (req, res) => {
  try {
    console.log('[REFRESH] Starting helper.js to get new streams...');
    runHelperOnce();
    res.json({ message: "Stream refresh started", status: "ok" });
  } catch (error) {
    console.error('[REFRESH] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ---------- API: HLS Proxy ----------
app.get("/api/hls", async (req, res) => {
  try {
    const target = req.query.u;
    console.log('[HLS] Request for:', target);
    if (!target) {
      console.log('[HLS] No target URL');
      return res.status(400).send("Missing URL");
    }

    console.log('[HLS] Fetching:', target);
    const referer = getReferer();
    const r = await fetch(target, {
      headers: {
        Referer: referer,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    console.log('[HLS] Response status:', r.status);
    if (!r.ok) {
      console.error('[HLS] Fetch failed:', r.status, r.statusText);
      return res.status(r.status).send("Fetch failed");
    }

    const text = await r.text();
    console.log('[HLS] Response length:', text.length);
    console.log('[HLS] First 200 chars:', text.substring(0, 200));

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
    res.setHeader("Cache-Control", "no-cache");
    
    console.log('[HLS] Sending response');
    res.send(text);
  } catch (err) {
    console.error('[HLS] Error:', err.message);
    res.status(500).send("Proxy error");
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
