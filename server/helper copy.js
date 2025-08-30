/* eslint-disable no-console */
import puppeteer from "puppeteer-core";
import os from "os";
import fs from "fs";
import fetch from "node-fetch";
import path from "path";
import https from "https";

const LISTEN_MS = 120000;        // m3u8 dinleme süresi (120 sn)
const NAV_TIMEOUT = 15000;       // Puppeteer sayfa timeout (15 sn) -> eskisine göre daha kısa
const YAYIN_RE = /\/yayin\d+\.m3u8(\?|$)/i;
const ANY_M3U8 = /\.m3u8(\?|$)/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Chrome path bulucu
 */
function guessChrome() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH))
    return process.env.CHROME_PATH;
  const plat = os.platform();
  const candidates =
    plat === "darwin"
      ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
      : plat === "win32"
      ? [
          `${process.env["PROGRAMFILES"]}\\Google\\Chrome\\Application\\chrome.exe`,
          `${process.env["PROGRAMFILES(X86)"]}\\Google\\Chrome\\Application\\chrome.exe`,
          `${process.env["LOCALAPPDATA"]}\\Google\\Chrome\\Application\\chrome.exe`,
        ]
      : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/snap/bin/chromium"];
  return candidates.find((p) => p && fs.existsSync(p));
}

/**
 * Hızlı domain probesi:
 * 1) HEAD (3 sn) — çoğu DNS/erişim hatasını anında verir
 * 2) HEAD bloklanırsa GET (4 sn) ve 200 kabul eder
 */
async function quickProbe(url) {
  const agent = new https.Agent({ rejectUnauthorized: false });

  // 1) HEAD
  try {
    const res = await fetch(url, {
      method: "HEAD",
      timeout: 3000,
      agent,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        Accept: "*/*",
      },
    });
    if (res.ok) return true;
  } catch {
    // sessiz geç → GET'e deneyeceğiz
  }

  // 2) GET (bazı siteler HEAD'i bloklar)
  try {
    const res = await fetch(url, {
      method: "GET",
      timeout: 4000,
      agent,
      redirect: "manual",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "tr-TR,tr;q=0.9",
      },
    });
    return res.status === 200;
  } catch {
    return false;
  }
}

/**
 * Aktif domain bulucu (HIZLI tarama: fetch ile)
 * Bulunca domain.json'a yazar ve döner
 */
async function findActiveDomain(start = 1380, end = 1520) {
  const base = "https://trgoals";
  const tld = ".xyz";

  for (let i = end; i >= start; i--) {
    const url = `${base}${i}${tld}`;
    try {
      console.log("🔍 Deneniyor (hızlı):", url);
      const ok = await quickProbe(url);
      if (ok) {
        console.log("✅ Aktif domain bulundu:", url);
        fs.writeFileSync("domain.json", JSON.stringify({ domain: url }, null, 2));
        return url;
      }
    } catch (err) {
      console.log(`⚠️ ${url} -> ${err?.message || "probe hata"}`);
    }
  }

  throw new Error("❌ Hiçbir domain bulunamadı!");
}

(async () => {
  const chromePath = guessChrome();
  if (!chromePath) {
    console.error("❌ Chrome/Chromium bulunamadı. CHROME_PATH ile yol ver.");
    process.exit(2);
  }

  // 1) Hızlıca güncel domain bul
  const activeDomain = await findActiveDomain(1380, 1410);

  // 2) Sadece bulunan domain için Puppeteer ile kanal sayfasını aç
  const TARGET = `${activeDomain}/channel.html?id=yayin1`;

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: chromePath,
    defaultViewport: { width: 1280, height: 800 },
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--autoplay-policy=no-user-gesture-required",
      "--mute-audio",
    ],
  });

  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
  );
  await page.setExtraHTTPHeaders({ "Accept-Language": "tr-TR,tr;q=0.9" });

  const cdp = await page.target().createCDPSession();
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });

  let strongHit = null;
  let lastAny = null;
  let resolveHit;
  const hitPromise = new Promise((r) => (resolveHit = r));

  const consider = (url) => {
    if (!url) return;
    if (YAYIN_RE.test(url)) {
      strongHit = url;
      console.log("✅ m3u8 bulundu:", url);

      // Base URL
      const baseUrl = url.split(/yayin\d+\.m3u8/i)[0];

      // Kanallar (düzeltildi: yayin2/3/4)
      const channels = {
        "BeIN Sports 1": "yayin1.m3u8",
        "BeIN Sports 2": "yayinb2.m3u8",
        "BeIN Sports 3": "yayinb3.m3u8",
        "BeIN Sports 4": "yayinb4.m3u8",
        "S-Sports 1":"yayinss.m3u8"
      };

      // streams.json yaz
      const streams = {};
      for (const [name, pathUrl] of Object.entries(channels)) {
        const fullUrl = new URL(pathUrl, baseUrl).href;
        streams[name] = fullUrl;
      }

      fs.writeFileSync(
        path.join(process.cwd(), "streams.json"),
        JSON.stringify(streams, null, 2)
      );

      resolveHit();
    } else if (ANY_M3U8.test(url)) {
      lastAny = url;
    }
  };

  cdp.on("Network.requestWillBeSent", (e) => consider(e?.request?.url));
  cdp.on("Network.responseReceived", (e) => consider(e?.response?.url));
  page.on("request", (req) => consider(req.url()));
  page.on("response", (res) => consider(res.url()));

  try {
    await page.goto(TARGET, {
      waitUntil: "domcontentloaded",
      timeout: NAV_TIMEOUT,
    });
  } catch {}

  try {
    await page.mouse.click(300, 300, { clickCount: 1 });
  } catch {}
  try {
    await page.evaluate(() => {
      const tryPlay = () => {
        const v = document.querySelector("video");
        if (v) v.play().catch(() => {});
      };
      tryPlay();
      setTimeout(tryPlay, 800);
      setTimeout(tryPlay, 2000);
    });
  } catch {}

  await Promise.race([hitPromise, sleep(LISTEN_MS)]);

  if (!strongHit && lastAny) {
    console.log(lastAny);
  } else if (!strongHit) {
    console.error("❌ m3u8 yakalanamadı");
  }

  try {
    await cdp.detach();
  } catch {}
  await browser.close();
  process.exit(0);
})().catch((e) => {
  console.error(e?.stack || e);
  process.exit(1);
});
