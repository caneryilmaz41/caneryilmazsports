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
app.use(cors());

// --- helper.js otomatik çalıştırma (periyodik) ---
let helperRunning = false;
let helperTimer = null;

function runHelperOnce() {
  if (helperRunning) return; // aynı anda birden fazla helper çalışmasın
  helperRunning = true;

  const child = spawn(process.execPath, ["helper.js"], {
    stdio: "inherit",
    cwd: __dirname, // helper.js server ile aynı klasörde
    env: process.env,
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

// Server ayağa kalkınca bir kez helper çalıştır
runHelperOnce();

// 5 dakikada bir tekrar tetikle (ihtiyaca göre 2–10 dk yapabilirsin)
helperTimer = setInterval(runHelperOnce, 5 * 60 * 1000);

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
    return domain || "https://trgoals1383.xyz/"; // fallback
  } catch {
    return "https://trgoals1383.xyz/"; // fallback
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
      response.headers.get("content-type") || "application/vnd.apple.mpegurl"
    );

    const body = Buffer.from(await response.arrayBuffer());
    res.send(body);
  } catch (err) {
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
      headers: { Referer: getReferer(), "User-Agent": "Mozilla/5.0", Accept: "*/*" },
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
