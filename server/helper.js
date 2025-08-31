/* eslint-disable no-console */
import puppeteer from "puppeteer-core";
import os from "os";
import fs from "fs";
import path from "path";
import process from "process";
import urlMod from "url";

/**
 * helper.js — Render/Docker gibi headless ortamlarda .m3u8 yakalayıp
 * streams.json + referer.json üretir.
 *
 * Öne çıkanlar:
 * - Geniş regex: /yayin[a-z0-9]+\.m3u8/i + ANY .m3u8
 * - Çoklu TARGET desteği (virgülle çok URL verilebilir)
 * - Autoplay tetikleme (mouse/space/video.play + yaygın butonlar)
 * - User-Agent rotasyonu + Referer/Origin ayarı
 * - Ağ yakalama: requestfinished + response + CDP Network.enable
 * - Kaynak engelleme (image/font/stylesheet) opsiyonu
 * - Tekrar deneme mekaniği
 * - Güçlü log + latest_m3u8.txt
 * - JSON şeması: AUTO, byId{yayinX}, channels{<isim>}, _meta
 * - Graceful shutdown
 */

/* ==========================
 * 1) AYARLAR (ENV/Arg)
 * ========================== */

const ENV = {
  TARGETS:
    (process.env.TARGET_URLS || process.env.TARGET_URL || process.argv[2] || "").trim(),
  LISTEN_MS: Number(process.env.LISTEN_MS || 60000), // toplam dinleme süresi
  NAV_TIMEOUT: Number(process.env.NAV_TIMEOUT || 15000),
  OUT_STREAMS: process.env.OUT_STREAMS || "streams.json",
  OUT_REFERER: process.env.OUT_REFERER || "referer.json",
  LATEST_TXT: process.env.LATEST_TXT || "latest_m3u8.txt",
  BLOCK_HEAVY: String(process.env.BLOCK_HEAVY || "true").toLowerCase() === "true",
  MAX_RETRIES: Number(process.env.MAX_RETRIES || 2),
  // özel header/param
  EXTRA_HEADERS: String(process.env.EXTRA_HEADERS || ""), // JSON string {"X-My":"Header"}
  // proxy (gerekirse)
  PROXY: process.env.HTTP_PROXY || process.env.HTTPS_PROXY || "",
  // chromium path (puppeteer-core için gerekli)
  CHROME_PATH: process.env.CHROME_PATH || "",
  // yakalanan "any" kabul edilsin mi (strong yoksa)
  ALLOW_ANY: String(process.env.ALLOW_ANY || "true").toLowerCase() === "true",
};

const TARGETS = ENV.TARGETS
  ? ENV.TARGETS.split(",").map(s => s.trim()).filter(Boolean)
  : [];

if (!TARGETS.length) {
  console.error("❌ TARGET_URL / TARGET_URLS belirtilmedi (argüman veya ENV).");
  console.error('   Ör: node helper.js "https://trgoals1410.xyz/channel.html?id=yayin1"');
  process.exit(2);
}

/* ==========================
 * 2) REGEX ve Yardımcılar
 * ========================== */

// “strong” yakalama: yayın ID’si harf/rakam
const YAYIN_RE = /\/(yayin[a-z0-9]+)\.m3u8(\?|$)/i;
// her türlü .m3u8 (yedek/any)
const ANY_M3U8 = /\.m3u8(\?|$)/i;

const UA_POOL = [
  // Geniş havuz: farklı Chrome/Edge Safari UA’leri (güncel görünsün)
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; Xbox; Xbox One) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 Edge/123.0",
  "Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Mobile Safari/537.36",
];

const COMMON_PLAY_BUTTONS = [
  '.vjs-play-control',
  '.plyr__control--overlaid',
  'button[aria-label*="Play" i]',
  'button[title*="Play" i]',
  '.jw-icon-playback',
  '.big-play-button',
  '.ytp-large-play-button',
  '[class*="play"]',
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function guessChromePath() {
  if (ENV.CHROME_PATH && fs.existsSync(ENV.CHROME_PATH)) return ENV.CHROME_PATH;

  const plat = os.platform();
  const candidates =
    plat === "win32"
      ? [
          `${process.env["PROGRAMFILES"]}\\Google\\Chrome\\Application\\chrome.exe`,
          `${process.env["PROGRAMFILES(X86)"]}\\Google\\Chrome\\Application\\chrome.exe`,
          `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
          "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
          "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
        ]
      : plat === "darwin"
      ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
      : [
          "/usr/bin/google-chrome-stable",
          "/usr/bin/google-chrome",
          "/usr/bin/chromium-browser",
          "/usr/bin/chromium",
          "/snap/bin/chromium",
        ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch {}
  }
  return undefined;
}

function originOf(u) {
  try {
    const { protocol, host } = new urlMod.URL(u);
    return `${protocol}//${host}`;
  } catch {
    return null;
  }
}

function ensureJSONWrite(file, obj) {
  try {
    fs.writeFileSync(file, JSON.stringify(obj, null, 2), "utf-8");
    console.log(`💾 Yazıldı: ${file}`);
  } catch (e) {
    console.error(`❌ Yazılamadı (${file}):`, e.message);
  }
}

function writeText(file, content) {
  try {
    fs.writeFileSync(file, content, "utf-8");
    console.log(`📝 Yazıldı: ${file}`);
  } catch (e) {
    console.error(`❌ Yazılamadı (${file}):`, e.message);
  }
}

function parseExtraHeaders() {
  if (!ENV.EXTRA_HEADERS) return {};
  try {
    const obj = JSON.parse(ENV.EXTRA_HEADERS);
    return obj && typeof obj === "object" ? obj : {};
  } catch {
    console.warn("⚠️ EXTRA_HEADERS JSON pars edilemedi; yok sayılıyor.");
    return {};
  }
}

/* ==========================
 * 3) Çekirdek Yakalama Mantığı
 * ========================== */

/**
 * Bir hedef URL için browser aç, .m3u8 yakala, sonuç döndür.
 */
async function captureForTarget(targetUrl, attempt = 0) {
  const chromePath = guessChromePath();
  if (!chromePath) {
    console.warn("⚠️ CHROME_PATH bulunamadı. puppeteer-core, executablePath olmadan çalışmaz.");
    console.warn("   Çözüm 1: Docker imajına chrome/chromium kur + CHROME_PATH ayarla.");
    console.warn("   Çözüm 2: 'puppeteer-core' yerine 'puppeteer' kullan (bundled Chromium).");
  }

  const args = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--autoplay-policy=no-user-gesture-required",
    "--mute-audio",
    "--disable-dev-shm-usage",
    "--disable-gpu",
  ];
  if (ENV.PROXY) args.push(`--proxy-server=${ENV.PROXY}`);

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args,
    defaultViewport: { width: 1366, height: 768 },
  });

  let cdp = null;
  let page = null;

  // Yakalananlar
  let strongHit = null;   // url
  let strongId = null;    // yayinX
  let lastAny = null;     // url
  let lastAnyStatus = null;

  const teardown = async () => {
    try { await page?.close?.(); } catch {}
    try { await browser?.close?.(); } catch {}
  };

  try {
    page = await browser.newPage();

    // Hafifletme: ağır kaynakları engelle (opsiyonel)
    if (ENV.BLOCK_HEAVY) {
      await page.setRequestInterception(true);
      page.on("request", (req) => {
        const type = req.resourceType();
        if (["image", "font", "stylesheet"].includes(type)) {
          return req.abort();
        }
        req.continue();
      });
    }

    // CDP ile Network.enable — detaylı yakalama
    cdp = await page.target().createCDPSession();
    await cdp.send("Network.enable", {});
    cdp.on("Network.responseReceived", (params) => {
      try {
        const u = params.response?.url || "";
        if (!u) return;
        if (ANY_M3U8.test(u)) {
          lastAny = u;
          lastAnyStatus = params.response.status;
          if (YAYIN_RE.test(u)) {
            strongHit = u;
            const m = u.match(YAYIN_RE);
            strongId = m?.[1] || null;
          }
          console.log(`📥 [CDP] ${params.response.status} ${u}`);
        }
      } catch {}
    });

    // Heuristic UA ve referer
    const ua = UA_POOL[Math.floor(Math.random() * UA_POOL.length)];
    const referer = originOf(targetUrl) || "https://google.com";
    const extra = parseExtraHeaders();

    await page.setUserAgent(ua);
    await page.setExtraHTTPHeaders({
      "Referer": referer,
      "Origin": referer,
      "Accept": "*/*",
      ...extra,
    });

    // Network eventleri (Puppeteer layer)
    const recordUrl = (label, u) => {
      if (!ANY_M3U8.test(u)) return;
      if (YAYIN_RE.test(u)) {
        strongHit = u;
        const m = u.match(YAYIN_RE);
        strongId = m?.[1] || null;
        console.log(`${label} STRONG => ${u}`);
      } else {
        lastAny = u;
        console.log(`${label} ANY    => ${u}`);
      }
    };

    page.on("requestfinished", (req) => {
      const u = req.url();
      if (ANY_M3U8.test(u)) recordUrl("🔎 (requestfinished)", u);
    });

    page.on("response", async (res) => {
      try {
        const u = res.url();
        if (!ANY_M3U8.test(u)) return;
        lastAnyStatus = res.status();
        recordUrl(`✅ (response ${res.status()})`, u);
      } catch {}
    });

    console.log(`🌐 [${attempt + 1}. deneme] Gidiliyor: ${targetUrl}`);
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: ENV.NAV_TIMEOUT }).catch(e => {
      console.warn("⚠️ goto uyarısı:", e.message);
    });

    // Sahte jest + play tetikleme
    await sleep(800);
    try { await page.mouse.click(200, 200); } catch {}
    await sleep(120);
    try { await page.keyboard.press("Space"); } catch {}

    try {
      await page.evaluate((PLAY_BUTTONS) => {
        const v = document.querySelector("video");
        if (v) {
          v.muted = true;
          v.play?.().catch(()=>{});
        }
        for (const sel of PLAY_BUTTONS) {
          const btn = document.querySelector(sel);
          if (btn) { btn.click(); break; }
        }
      }, COMMON_PLAY_BUTTONS);
    } catch {}

    // Dinleme döngüsü
    const until = Date.now() + ENV.LISTEN_MS;
    while (Date.now() < until && !strongHit) {
      await sleep(250);
    }

    // Son durum
    const chosen = strongHit || (ENV.ALLOW_ANY ? lastAny : null);
    if (!chosen) {
      console.log("❌ m3u8 bulunamadı.");
      // retry
      if (attempt + 1 < ENV.MAX_RETRIES) {
        console.log("🔁 Tekrar denenecek...");
        await teardown();
        return await captureForTarget(targetUrl, attempt + 1);
      }
      return {
        ok: false,
        target: targetUrl,
        referer,
        strongHit,
        strongId,
        lastAny,
        lastAnyStatus,
      };
    }

    console.log(`🎯 Seçilen m3u8: ${chosen}${strongId ? ` (id=${strongId})` : ""}`);
    return {
      ok: true,
      target: targetUrl,
      referer,
      strongHit,
      strongId,
      lastAny,
      lastAnyStatus,
      chosen,
    };
  } catch (err) {
    console.error("💥 capture hata:", err?.message || err);
    if (attempt + 1 < ENV.MAX_RETRIES) {
      console.log("🔁 Hata sonrası tekrar denenecek...");
      await teardown();
      return await captureForTarget(targetUrl, attempt + 1);
    }
    return { ok: false, error: String(err?.message || err) };
  } finally {
    await sleep(50);
    try { await page?.close?.(); } catch {}
    try { await browser?.close?.(); } catch {}
  }
}

/* ==========================
 * 4) Toplu Çalıştırma & Çıktı
 * ========================== */

function buildInitialStreamsSchema() {
  return {
    _meta: {
      capturedAt: new Date().toISOString(),
      note: "Auto-generated by helper.js",
    },
    AUTO: null,       // en iyi tek link
    byId: {},         // yayinX => url
    channels: {},     // "BeIN Sports 1" gibi isimlere istersek map
  };
}

function mergeCaptureIntoStreams(streams, cap) {
  streams._meta.lastTarget = cap.target;
  streams._meta.referer = cap.referer;
  streams._meta.lastAnyStatus = cap.lastAnyStatus ?? null;

  if (cap.chosen && !streams.AUTO) {
    streams.AUTO = cap.chosen; // ilk bulunanı AUTO yap
  }
  if (cap.strongId && cap.strongHit) {
    streams.byId[cap.strongId] = cap.strongHit;
    // küçük bir konfor: yayin1 -> BeIN Sports 1
    if (/^yayin1$/i.test(cap.strongId)) {
      streams.channels["BeIN Sports 1"] = cap.strongHit;
    }
  } else if (cap.chosen && !cap.strongId) {
    // id çıkarılamadıysa generic key ile dursun
    streams.byId["captured"] = cap.chosen;
  }

  return streams;
}

async function main() {
  console.log("🎯 TARGETS:", TARGETS.join(", "));
  console.log("⚙️  LISTEN_MS:", ENV.LISTEN_MS, "NAV_TIMEOUT:", ENV.NAV_TIMEOUT, "RETRIES:", ENV.MAX_RETRIES);
  if (ENV.PROXY) console.log("🌐 PROXY:", ENV.PROXY);
  console.log("✂️  BLOCK_HEAVY:", ENV.BLOCK_HEAVY, "ALLOW_ANY:", ENV.ALLOW_ANY);

  const caps = [];
  for (const t of TARGETS) {
    const cap = await captureForTarget(t);
    caps.push(cap);
  }

  // Başarılı ilk sonucu seç
  const firstOk = caps.find(c => c && c.ok);
  const anyOk = firstOk || null;

  // referer.json
  if (anyOk) {
    ensureJSONWrite(ENV.OUT_REFERER, {
      referer: anyOk.referer,
      lastOkTarget: anyOk.target,
      capturedAt: new Date().toISOString(),
    });
  } else {
    // son başarısız da olsa referer yazmaya değer bilgi yoksa pas
    console.warn("⚠️ referer.json yazılmadı (başarılı yakalama yok).");
  }

  // streams.json
  let streams = buildInitialStreamsSchema();
  for (const cap of caps) {
    if (!cap || !cap.ok) continue;
    streams = mergeCaptureIntoStreams(streams, cap);
  }

  if (streams.AUTO) {
    ensureJSONWrite(ENV.OUT_STREAMS, streams);
    writeText(ENV.LATEST_TXT, streams.AUTO);
  } else {
    // yine de son hatayı not düş
    const lastErr = caps.filter(c => !c?.ok).pop();
    ensureJSONWrite(ENV.OUT_STREAMS, streams); // boş şema da dursun
    console.error("❌ Hiçbir hedefte .m3u8 bulunamadı.");
    if (lastErr?.error) console.error("Detay:", lastErr.error);
    process.exit(1);
  }

  // Graceful exit
  process.exit(0);
}

/* ==========================
 * 5) Sinyaller
 * ========================== */

process.on("SIGINT", () => {
  console.log("\n🛑 SIGINT alındı, çıkılıyor...");
  process.exit(130);
});
process.on("SIGTERM", () => {
  console.log("\n🛑 SIGTERM alındı, çıkılıyor...");
  process.exit(143);
});

/* ==========================
 * 6) Çalıştır
 * ========================== */

main().catch(err => {
  console.error("💥 Genel hata:", err?.message || err);
  process.exit(1);
});
