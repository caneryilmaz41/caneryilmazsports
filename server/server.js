// server.js
import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import https from "https";
import { fileURLToPath } from "url";
import { spawn } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Render / proxy arkasında doğru proto/host için
app.set("trust proxy", 1);

// ---------- CORS ----------
app.use(cors({
  origin: [
    "https://caneryilmazsports.vercel.app",
    "http://localhost:5173",
    "http://localhost:3000",
  ],
  methods: ["GET","HEAD","OPTIONS"],
  allowedHeaders: ["Content-Type","Range"],
  credentials: true,
}));
app.options("*", cors());

app.use(express.json());
app.get("/health", (_, res) => res.json({ status: "OK", ts: new Date().toISOString() }));
app.get("/healthz", (_, res) => res.json({ ok: true }));

// ---------- Keep-Alive Agent ----------
const kaAgent = new https.Agent({ keepAlive: true });

// ---------- Yol yardımcıları ----------
const FILE_STREAMS = path.join(__dirname, "streams.json");
const FILE_MATCHES = path.join(__dirname, "matches.json");
const FILE_REFERER = path.join(__dirname, "referer.json");
const FILE_DOMAIN  = path.join(__dirname, "domain.json");

// ---------- Referer/Origin kaynağı ----------
function getReferer() {
  try {
    if (fs.existsSync(FILE_REFERER)) {
      const j = JSON.parse(fs.readFileSync(FILE_REFERER, "utf-8"));
      if (j?.referer) return j.referer;
    }
  } catch {}
  try {
    if (fs.existsSync(FILE_DOMAIN)) {
      const j = JSON.parse(fs.readFileSync(FILE_DOMAIN, "utf-8"));
      // helper.js domain.json { domain: "https://trgoalsXXXX.xyz" } yazıyor
      if (j?.activeDomain) return j.activeDomain;
      if (j?.domain) return j.domain;
    }
  } catch {}
  return null;
}

// ---------- Streams / Matches yükleme ----------
function loadStreams() {
  try {
    if (!fs.existsSync(FILE_STREAMS)) return null;
    const data = JSON.parse(fs.readFileSync(FILE_STREAMS, "utf-8"));

    // yeni şema varsa direkt dön
    if (data && (data.AUTO || data.byId || data.channels)) return data;

    // düz map şeması: { "BeIN Sports 1": "https://...m3u8", ... }
    const channels = {};
    for (const [k, v] of Object.entries(data || {})) {
      if (typeof v === "string" && v.includes(".m3u8")) channels[k] = v;
    }
    const first = Object.values(channels)[0] || null;
    return { _meta:{ migratedFromPlain:true }, AUTO:first, channels, byId:{} };
  } catch { return null; }
}
function loadMatches() {
  try {
    if (!fs.existsSync(FILE_MATCHES)) return [];
    return JSON.parse(fs.readFileSync(FILE_MATCHES, "utf-8"));
  } catch { return []; }
}

// ---------- Origin üret (HTTPS doğru olsun) ----------
function backendOrigin(req) {
  const proto = (req.headers["x-forwarded-proto"] || req.protocol).toString().split(",")[0];
  const host  = req.get("x-forwarded-host") || req.get("host");
  return `${proto}://${host}`;
}

// ---------- m3u8 rewrite ----------
function rewritePlaylist(text, baseUrl, beOrigin) {
  return text.split(/\r?\n/).map(line => {
    if (!line || line.startsWith("#")) return line;
    const abs = new URL(line, baseUrl).href;  // relative/absolute fark etmez
    return `${beOrigin}/api/proxy?url=${encodeURIComponent(abs)}`;
  }).join("\n");
}

// ---------- seçim yardımcı ----------
function pickStreamUrl(key, streams) {
  if (!streams) return null;
  if (key && streams.channels?.[key]) return streams.channels[key];
  if (key && streams.byId?.[key])     return streams.byId[key];
  if (!key || key === "auto") {
    if (streams.AUTO) return streams.AUTO;
    const byIdFirst = streams.byId && Object.values(streams.byId)[0];
    if (byIdFirst) return byIdFirst;
    const chFirst = streams.channels && Object.values(streams.channels)[0];
    if (chFirst) return chFirst;
  }
  return null;
}
function channelNameFromId(id) {
  const m = String(id||"").toLowerCase();
  const map = {
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
  return map[m] || null;
}

// ---------- Tanılama ----------
app.get("/api/debug", (req, res) => {
  const r = getReferer();
  const s = loadStreams();
  res.json({
    referer: r,
    hasStreams: !!s,
    keys: {
      channels: s?.channels ? Object.keys(s.channels) : [],
      byId: s?.byId ? Object.keys(s.byId) : [],
      AUTO: !!s?.AUTO
    },
    files: {
      streamsExists: fs.existsSync(FILE_STREAMS),
      refererExists: fs.existsSync(FILE_REFERER),
      domainExists : fs.existsSync(FILE_DOMAIN),
      streamsMtime: fs.existsSync(FILE_STREAMS) ? fs.statSync(FILE_STREAMS).mtime : null,
      refererMtime: fs.existsSync(FILE_REFERER) ? fs.statSync(FILE_REFERER).mtime : null,
      domainMtime : fs.existsSync(FILE_DOMAIN)  ? fs.statSync(FILE_DOMAIN).mtime  : null,
    },
    backendOrigin: backendOrigin(req),
  });
});
app.get("/api/raw/streams", (_, res) => {
  try { res.type("json").send(fs.readFileSync(FILE_STREAMS,"utf-8")); }
  catch { res.status(404).send("{}"); }
});

// ---------- Kanallar / Maçlar ----------
app.get("/api/channels", (_, res) => {
  const s = loadStreams();
  if (!s) return res.json([]);
  const names = new Set();
  if (s.channels) for (const k of Object.keys(s.channels)) names.add(k);
  if (s.byId?.yayin1 && !names.has("BeIN Sports 1")) names.add("BeIN Sports 1");
  res.json([...names]);
});
app.get("/api/matches", (_, res) => res.json(loadMatches()));

// ---------- Proxy ----------
app.get("/api/proxy", async (req, res) => {
  try {
    const src = req.query.url;
    if (!src || typeof src !== "string") return res.status(400).send("url param missing");

    const u = new URL(src);
    const ref = getReferer() || `${u.protocol}//${u.host}`;
    console.log("[proxy] upstream:", src, "| ref:", ref);

    const headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36",
      "Accept": "*/*",
      "Accept-Language": "tr-TR,tr;q=0.9",
      "Referer": ref,
      "Origin": ref,
    };
    if (req.headers.range) headers.Range = req.headers.range;

    const r = await fetch(src, { headers, redirect: "follow", agent: kaAgent });

    res.status(r.status);
    const ct = r.headers.get("content-type") || "application/octet-stream";
    res.setHeader("Content-Type", ct);
    res.setHeader("Cache-Control", "no-store");
    const cl = r.headers.get("content-length"); if (cl) res.setHeader("Content-Length", cl);
    const ar = r.headers.get("accept-ranges"); if (ar) res.setHeader("Accept-Ranges", ar);

    if (!r.ok && r.status !== 206) {
      const body = await r.text().catch(()=> "");
      console.error("proxy upstream error:", r.status, src, body.slice(0,200));
      return res.end(body);
    }

    const buf = Buffer.from(await r.arrayBuffer());
    return res.end(buf);
  } catch (err) {
    console.error("proxy error:", err);
    res.status(500).send("proxy failed");
  }
});

// ---------- Stream (isim/auto) ----------
app.get("/api/stream/:key", async (req, res) => {
  try {
    const key = decodeURIComponent(req.params.key || "");
    const streams = loadStreams();
    const src = pickStreamUrl(key, streams);
    if (!src) return res.status(404).send("stream not found");

    const u = new URL(src);
    const ref = getReferer() || `${u.protocol}//${u.host}`;
    console.log("[stream] key:", key, "->", src, "| ref:", ref);

    const r = await fetch(src, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "*/*",
        "Accept-Language": "tr-TR,tr;q=0.9",
        "Referer": ref,
        "Origin": ref
      },
      redirect: "follow",
      agent: kaAgent
    });
    if (!r.ok) {
      const body = await r.text().catch(()=> "");
      console.error("stream upstream error:", r.status, src, body.slice(0,200));
      return res.status(r.status).end(body);
    }

    const text = await r.text();
    const rewritten = rewritePlaylist(text, src, backendOrigin(req));
    res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
    res.setHeader("Cache-Control", "no-store");
    res.send(rewritten);
  } catch (err) {
    console.error("stream error:", err);
    res.status(500).send("stream failed");
  }
});

// ---------- Stream by ID (örn. yayin1) ----------
app.get("/api/stream-id/:id", async (req, res) => {
  try {
    const id = decodeURIComponent(req.params.id || "");
    const streams = loadStreams();

    // 1) byId doğrudan URL ise
    if (streams?.byId?.[id]) {
      const url = streams.byId[id];
      const u = new URL(url);
      const ref = getReferer() || `${u.protocol}//${u.host}`;
      console.log("[stream-id] id:", id, "->", url, "| ref:", ref);

      const r = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0",
          "Accept": "*/*",
          "Accept-Language": "tr-TR,tr;q=0.9",
          "Referer": ref,
          "Origin": ref
        },
        redirect: "follow",
        agent: kaAgent
      });
      if (!r.ok) {
        const body = await r.text().catch(()=> "");
        console.error("stream-id upstream error:", r.status, url, body.slice(0,200));
        return res.status(r.status).end(body);
      }
      const text = await r.text();
      const rewritten = rewritePlaylist(text, url, backendOrigin(req));
      res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
      res.setHeader("Cache-Control", "no-store");
      return res.send(rewritten);
    }

    // 2) id -> kanal adı
    const name = channelNameFromId(id);
    if (!name) return res.status(404).send("Unknown id");

    const url2 = pickStreamUrl(name, streams);
    if (!url2) return res.status(404).send("Channel stream not found");

    const u2 = new URL(url2);
    const ref2 = getReferer() || `${u2.protocol}//${u2.host}`;
    console.log("[stream-id] id:", id, "name:", name, "->", url2, "| ref:", ref2);

    const r2 = await fetch(url2, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "*/*",
        "Accept-Language": "tr-TR,tr;q=0.9",
        "Referer": ref2,
        "Origin": ref2
      },
      redirect: "follow",
      agent: kaAgent
    });
    if (!r2.ok) {
      const body = await r2.text().catch(()=> "");
      console.error("stream-id upstream error:", r2.status, url2, body.slice(0,200));
      return res.status(r2.status).end(body);
    }
    const text2 = await r2.text();
    const rewritten2 = rewritePlaylist(text2, url2, backendOrigin(req));
    res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
    res.setHeader("Cache-Control", "no-store");
    res.send(rewritten2);
  } catch (err) {
    console.error("stream error:", err);
    res.status(500).send("stream failed");
  }
});

// ---------- helper.js güvenli tetikleme ----------
let helperRunning = false;
let helperTimer = null;

function runHelperOnce() {
  if (helperRunning) return;
  helperRunning = true;

  console.log("[helper] Başlatılıyor...");
  const child = spawn(process.execPath, ["helper.js"], {
    stdio: "inherit",
    cwd: __dirname,
    env: { ...process.env, CHROME_PATH: process.env.CHROME_PATH || "/usr/bin/google-chrome-stable" },
  });

  child.on("close", (code) => {
    helperRunning = false;
    console.log(`[helper] bitti. exit code: ${code}`);
    if (code !== 0) console.error(`[helper] Hata ile kapandı: ${code}`);
  });
  child.on("error", (err) => {
    helperRunning = false;
    console.error("[helper] spawn error:", err.message);
  });
}

// boot’ta bir kere ve 5 dakikada bir
runHelperOnce();
helperTimer = setInterval(runHelperOnce, 5 * 60 * 1000);

process.on("SIGINT", () => {
  if (helperTimer) clearInterval(helperTimer);
  console.log("\nKapanıyor...");
  process.exit(0);
});

// ---------- Listen ----------
const PORT = process.env.PORT || 5001;
app.listen(PORT, () => console.log(`Backend ${PORT} portunda çalışıyor`));
