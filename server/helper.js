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

// ---- CORS ----
app.use(cors({
  origin: [
    "https://caneryilmazsports.vercel.app",
    "http://localhost:5173",
    "http://localhost:3000"
  ],
  credentials: true,
}));

// ---- JSON / Health ----
app.use(express.json());
app.get("/healthz", (req, res) => res.json({ ok: true }));

// ---- Keep-Alive Agent ----
const kaAgent = new https.Agent({ keepAlive: true });

// =========================
// Yardımcı Fonksiyonlar
// =========================
function streamsPath() {
  return path.join(__dirname, "streams.json");
}
function refererPath() {
  return path.join(__dirname, "referer.json");
}

// referer.json oku (helper yazar)
function getReferer() {
  try {
    const j = JSON.parse(fs.readFileSync(refererPath(), "utf-8"));
    if (j?.referer) return j.referer;
  } catch {}
  return null;
}

// Streams yükle – hem yeni şemayı hem düz şemayı destekle
function loadStreams() {
  try {
    const raw = fs.readFileSync(streamsPath(), "utf-8");
    const data = JSON.parse(raw);

    // Yeni şema: { AUTO, byId:{}, channels:{}, _meta:{...} }
    if (data && (data.AUTO || data.byId || data.channels)) {
      return data;
    }
    // Eski/düz şema (kanalAdı -> url map)
    // Bunu yeni şemaya uyarlayalım
    const channels = {};
    for (const [k, v] of Object.entries(data || {})) {
      if (typeof v === "string" && v.includes(".m3u8")) {
        channels[k] = v;
      }
    }
    const first = Object.values(channels)[0] || null;
    return {
      _meta: { migratedFromPlain: true, capturedAt: new Date().toISOString() },
      AUTO: first,
      channels,
      byId: {}, // boş kalabilir
    };
  } catch {
    return null;
  }
}

// id -> kanal adı eşlemesi (gerekirse genişlet)
function channelNameFromId(id) {
  const idNorm = String(id || "").toLowerCase();
  // klasikler
  if (idNorm === "yayin1" || idNorm === "yayinb1") return "BeIN Sports 1";
  if (idNorm === "yayinb2") return "BeIN Sports 2";
  if (idNorm === "yayinb3") return "BeIN Sports 3";
  if (idNorm === "yayinb4") return "BeIN Sports 4";
  // başka id’ler için isim yoksa null
  return null;
}

// İstekten backend origin üret
function backendOriginFromReq(req) {
  return `${req.protocol}://${req.get("host")}`;
}

// m3u8 içini yeniden yaz – tüm URI’ları /api/proxy?url=... yap
function rewritePlaylist(text, baseUrl, backendOrigin) {
  const lines = text.split(/\r?\n/);
  return lines.map(line => {
    if (!line || line.startsWith("#")) return line;
    // Göreli ya da mutlak fark etmez: hepsini absolutize et
    const abs = new URL(line, baseUrl).href;
    return `${backendOrigin}/api/proxy?url=${encodeURIComponent(abs)}`;
  }).join("\n");
}

// Bir anahtar/isim/ID’den oynatılacak URL’i seç
function pickStreamUrl(key, streams) {
  if (!streams) return null;
  // 1) İsim üzerinden (channels)
  if (key && streams.channels && streams.channels[key]) return streams.channels[key];
  // 2) ID üzerinden (byId)
  if (key && streams.byId && streams.byId[key]) return streams.byId[key];
  // 3) “auto”
  if (!key || key === "auto") {
    if (streams.AUTO) return streams.AUTO;
    // yedek: byId içinden ilkini al
    const firstById = streams.byId && Object.values(streams.byId)[0];
    if (firstById) return firstById;
    // yedek: channels içinden ilkini al
    const firstCh = streams.channels && Object.values(streams.channels)[0];
    if (firstCh) return firstCh;
  }
  return null;
}

// =========================
// API: Kanal listesi
// =========================
app.get("/api/channels", (req, res) => {
  const streams = loadStreams();
  if (!streams) return res.json([]);
  const names = new Set();
  if (streams.channels) for (const k of Object.keys(streams.channels)) names.add(k);
  // beIN 1 yoksa ama byId/yayin1 varsa isim ekleyelim
  if (streams.byId?.yayin1 && !names.has("BeIN Sports 1")) names.add("BeIN Sports 1");
  res.json(Array.from(names));
});

// =========================
// API: Proxy
// =========================
app.get("/api/proxy", async (req, res) => {
  try {
    const src = req.query.url;
    if (!src) return res.status(400).send("url param missing");

    const u = new URL(src);
    const ref = getReferer() || `${u.protocol}//${u.host}`;
    const headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36",
      "Accept": "*/*",
      "Accept-Language": "tr-TR,tr;q=0.9",
      "Referer": ref,
      "Origin": ref,
      // Bazı CDN’ler CORS için bunları rahat bırakır; ek header eklemiyoruz
    };
    // Range forward
    if (req.headers.range) headers.Range = req.headers.range;

    const r = await fetch(src, { headers, redirect: "follow", agent: kaAgent });

    // Upstream status’u aynen geçir
    res.status(r.status);

    // Header’lar
    const ct = r.headers.get("content-type") || "application/octet-stream";
    res.setHeader("Content-Type", ct);
    res.setHeader("Cache-Control", "no-store");

    const cl = r.headers.get("content-length");
    if (cl) res.setHeader("Content-Length", cl);
    const ar = r.headers.get("accept-ranges");
    if (ar) res.setHeader("Accept-Ranges", ar);

    if (!r.ok && r.status !== 206) {
      // Hata metnini geçir – 502’ye çevirmeyelim
      const body = await r.text().catch(() => "");
      console.error("proxy upstream error:", r.status, src, body.slice(0, 200));
      return res.end(body);
    }

    // Basit & stabil: buffer’a alıp gönder
    const bodyBuf = Buffer.from(await r.arrayBuffer());
    return res.end(bodyBuf);
  } catch (err) {
    console.error("proxy error:", err);
    res.status(500).send("proxy failed");
  }
});

// =========================
// API: Stream by channel name OR 'auto'
// =========================
app.get("/api/stream/:key", async (req, res) => {
  try {
    const keyRaw = req.params.key || "";
    const key = decodeURIComponent(keyRaw);
    const streams = loadStreams();
    const src = pickStreamUrl(key === "auto" ? null : key, streams);

    if (!src) return res.status(404).send("stream not found");

    const u = new URL(src);
    const ref = getReferer() || `${u.protocol}//${u.host}`;

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
    const backendOrigin = backendOriginFromReq(req);
    const rewritten = rewritePlaylist(text, src, backendOrigin);

    res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
    res.setHeader("Cache-Control", "no-store");
    res.send(rewritten);
  } catch (err) {
    console.error("Stream error:", err);
    res.status(500).send("Stream error: " + err.message);
  }
});

// =========================
// API: Stream by ID (e.g. yayin1)
// =========================
app.get("/api/stream-id/:id", async (req, res) => {
  try {
    const id = decodeURIComponent(req.params.id || "");
    const streams = loadStreams();
    // Eğer byId’de birebir URL varsa onu kullan
    if (streams?.byId?.[id]) {
      const url = streams.byId[id];
      const u = new URL(url);
      const ref = getReferer() || `${u.protocol}//${u.host}`;
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
      const backendOrigin = backendOriginFromReq(req);
      const rewritten = rewritePlaylist(text, url, backendOrigin);
      res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
      res.setHeader("Cache-Control", "no-store");
      return res.send(rewritten);
    }

    // byId yoksa – id -> kanal adı map’i dene
    const name = channelNameFromId(id);
    if (!name) return res.status(404).send("Unknown id");

    const url2 = pickStreamUrl(name, streams);
    if (!url2) return res.status(404).send("Channel stream not found");

    const u2 = new URL(url2);
    const ref2 = getReferer() || `${u2.protocol}//${u2.host}`;
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
    const backendOrigin = backendOriginFromReq(req);
    const rewritten2 = rewritePlaylist(text2, url2, backendOrigin);
    res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
    res.setHeader("Cache-Control", "no-store");
    res.send(rewritten2);
  } catch (err) {
    console.error("Stream error:", err);
    res.status(500).send("Stream error: " + err.message);
  }
});

// =========================
// helper.js otomatik tetikleme
// =========================
let helperTimer = null;

function runHelperOnce() {
  const helperPath = path.join(__dirname, "helper.js");
  if (!fs.existsSync(helperPath)) {
    console.warn("helper.js yok, atlanıyor.");
    return;
  }
  console.log("[helper] Başlatılıyor...");
  const child = spawn("node", [helperPath], {
    cwd: __dirname,
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", (d) => process.stdout.write(String(d)));
  child.stderr.on("data", (d) => process.stderr.write(String(d)));
  child.on("close", (code) => {
    console.log(`[helper] bitti. exit code: ${code}`);
  });
}

// Servis ayağa kalkınca bir kere çalıştır
runHelperOnce();
// 5 dakikada bir tekrar
helperTimer = setInterval(runHelperOnce, 5 * 60 * 1000);

// Manuel refresh (isteğe bağlı)
app.post("/api/refresh", (req, res) => {
  runHelperOnce();
  res.json({ ok: true });
});

// =========================
// Graceful shutdown & Listen
// =========================
process.on("SIGINT", () => {
  if (helperTimer) clearInterval(helperTimer);
  console.log("\nKapanıyor...");
  process.exit(0);
});

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => console.log(`Backend ${PORT} portunda çalışıyor`));
