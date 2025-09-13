// server.js
import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.get("/health", (req, res) => res.status(200).send("ok"));

app.use(cors({
  origin: ['https://caneryilmazsports.vercel.app', 'http://localhost:5173', 'http://localhost:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// --- helper.js otomatik çalıştırma (periyodik) ---
let helperRunning = false;
let helperTimer = null;

function runHelperOnce() {
  if (helperRunning) return; // aynı anda birden fazla helper çalışmasın
  helperRunning = true;

  console.log('[helper] Başlatılıyor...');
  const child = spawn(process.execPath, ["helper.js"], {
    stdio: "inherit",
    cwd: __dirname, // helper.js server ile aynı klasörde
    env: { ...process.env, CHROME_PATH: process.env.CHROME_PATH || '/usr/bin/google-chrome-stable' },
  });

  child.on("close", (code) => {
    helperRunning = false;
    console.log(`[helper] bitti. exit code: ${code}`);
    if (code !== 0) {
      console.error(`[helper] Hata ile kapandı: ${code}`);
    }
  });

  child.on("error", (err) => {
    helperRunning = false;
    console.error("[helper] spawn error:", err.message);
  });
}

// Server ayağa kalkınca bir kez helper çalıştır
runHelperOnce();

// 5 dakikada bir tekrar tetikle (ihtiyaca göre 2–10 dk yapabilirsin)
helperTimer = setInterval(runHelperOnce, 12 * 60 * 1000);

// İsteğe bağlı: manuel tetikleme
app.post("/api/refresh", (req, res) => {
  runHelperOnce();
  res.json({ ok: true });
});

// --- yardımcı okuyucular ---
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
    const p = path.join(__dirname, "domain.json");
    const { domain } = JSON.parse(fs.readFileSync(p, "utf-8"));
    console.log(`[referer] Domain.json'dan okunan: ${domain}`);
    return domain || "https://trgoals1391.xyz/"; // güncel fallback
  } catch {
    console.log('[referer] Domain.json okunamadı, fallback kullanılıyor');
    return "https://trgoals1391.xyz/"; // güncel fallback
  }
}

// --- API: kanal listesi ---
app.get("/api/channels", (req, res) => {
  const streams = loadStreams();
  res.json(Object.keys(streams)); // Frontend basit dizi bekliyorsa
  // tüm map istenirse: res.json(streams);
});

// --- API: maç listesi ---
app.get("/api/matches", (req, res) => {
  const matches = loadMatches();
  res.json(matches);
});

// --- API: master m3u8 proxy (/api/stream/:channel) ---
app.get("/api/stream/:channel", async (req, res) => {
  try {
    const channel = decodeURIComponent(req.params.channel || "");
    const streams = loadStreams();
    const url = streams[channel];

    if (!url) {
      return res.status(404).send("Channel not found");
    }

    console.log(`[stream] ${channel} -> ${url}`);
    const referer = getReferer();
    console.log(`[stream] Referer: ${referer}`);
    
    const response = await fetch(url, {
      headers: {
        Referer: referer,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "*/*",
        "Accept-Encoding": "identity",
        "Cache-Control": "no-cache",
      },
      timeout: 15000,
    });

    if (!response.ok) {
      console.error(`[stream] Upstream error: ${response.status} for ${url}`);
      return res.status(502).send("Upstream error: " + response.status);
    }

    res.setHeader(
      "Content-Type",
      response.headers.get("content-type") || "application/vnd.apple.mpegurl"
    );
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "no-cache");

    const body = Buffer.from(await response.arrayBuffer());
    res.send(body);
  } catch (err) {
    console.error(`[stream] Error: ${err.message}`);
    res.status(500).send("Stream error: " + err.message);
  }
});

// --- API: segment/alt manifest proxy (/api/proxy?url=...) ---
app.get("/api/proxy", async (req, res) => {
  try {
    const url = req.query.url;
    if (!url || typeof url !== "string") {
      return res.status(400).send("Missing url param");
    }

    const response = await fetch(url, {
      headers: {
        Referer: getReferer(),
        "User-Agent": "Mozilla/5.0",
        Accept: "*/*",
      },
    });

    if (!response.ok) {
      return res.status(502).send("Upstream error: " + response.status);
    }

    res.setHeader(
      "Content-Type",
      response.headers.get("content-type") || "application/octet-stream"
    );

    const body = Buffer.from(await response.arrayBuffer());
    res.send(body);
  } catch (err) {
    res.status(500).send("Proxy error: " + err.message);
  }
});

// --- id → kanal adı eşlemesi + id ile stream endpoint ---
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

app.get("/api/stream-id/:id", async (req, res) => {
  try {
    const id = decodeURIComponent(req.params.id || "");
    const name = channelNameFromId(id);
    if (!name) return res.status(404).send("Unknown id");
    const streams = loadStreams();
    const url = streams[name];
    if (!url) return res.status(404).send("Channel stream not found");

    const response = await fetch(url, {
      headers: {
        Referer: getReferer(),
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "*/*",
        "Accept-Encoding": "identity",
        "Cache-Control": "no-cache",
      },
      timeout: 15000,
    });
    if (!response.ok) return res.status(502).send("Upstream error: " + response.status);

    res.setHeader(
      "Content-Type",
      response.headers.get("content-type") || "application/vnd.apple.mpegurl"
    );
    const body = Buffer.from(await response.arrayBuffer());
    res.send(body);
  } catch (err) {
    res.status(500).send("Stream error: " + err.message);
  }
});

// Graceful shutdown (opsiyonel)
process.on("SIGINT", () => {
  if (helperTimer) clearInterval(helperTimer);
  console.log("\nKapanıyor...");
  process.exit(0);
});

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => console.log(`Backend ${PORT} portunda çalışıyor`));
