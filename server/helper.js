/* eslint-disable no-console */
import puppeteer from "puppeteer-core";
import os from "os";
import fs from "fs";
import fetch from "node-fetch";
import path from "path";
import https from "https";

const LISTEN_MS = 120000;        // m3u8 dinleme süresi
const NAV_TIMEOUT = 15000;       // sayfa timeout
const YAYIN_RE = /\/yayin\d+\.m3u8(\?|$)/i;
const ANY_M3U8 = /\.m3u8(\?|$)/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

async function quickProbe(url) {
  const agent = new https.Agent({ rejectUnauthorized: false });
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
  } catch {}
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

async function findActiveDomain(start = 1380, end = 1410) {
  const base = "https://trgoals";
  const tld = ".xyz";
  for (let i = end; i >= start; i--) {
    const url = `${base}${i}${tld}`;
    try {
      console.log("🔍 Deneniyor:", url);
      const ok = await quickProbe(url);
      if (ok) {
        console.log("✅ Aktif domain:", url);
        fs.writeFileSync("domain.json", JSON.stringify({ domain: url }, null, 2));
        return url;
      }
    } catch (err) {
      console.log(`⚠️ ${url} -> ${err?.message || "probe hata"}`);
    }
  }
  throw new Error("❌ Aktif domain bulunamadı");
}

/* ---------- MAÇ LİSTESİ: önce HTTP, boşsa Puppeteer ---------- */
async function fetchMatchesViaHTTP(activeDomain) {
  try {
    const res = await fetch(activeDomain, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        "Accept-Language": "tr-TR,tr;q=0.9",
        Accept: "text/html,*/*",
      },
      timeout: 10000,
    });
    if (!res.ok) throw new Error("status " + res.status);
    const html = await res.text();

    const sectionMatch = html.match(
      /<div id="matches-tab"[^>]*class="[^"]*\btab-content\b[^"]*[^>]*>([\s\S]*?)<\/div>\s*<!--/i
    );
    const section = sectionMatch ? sectionMatch[1] : html;

    const items = [];
    const aRe = /<a\s+[^>]*class="[^"]*\bchannel-item\b[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let a;
    while ((a = aRe.exec(section)) !== null) {
      const href = a[1] || "";
      const inner = a[2] || "";
      const name = (inner.match(/<div[^>]*class="[^"]*\bchannel-name\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1] || "")
        .replace(/<[^>]+>/g, "")
        .replace(/\s+/g, " ")
        .trim();
      const time = (inner.match(/<div[^>]*class="[^"]*\bchannel-status\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1] || "")
        .replace(/<[^>]+>/g, "")
        .replace(/\s+/g, " ")
        .trim();
      const id =
        href.match(/id=([^&"' >]+)/)?.[1] ||
        (() => {
          try {
            const u = new URL(href, activeDomain);
            return u.searchParams.get("id");
          } catch {
            return null;
          }
        })();
      if (name) items.push({ title: name, time: time || null, id: id || null, href });
    }

    const seen = new Set();
    const uniq = items.filter((r) => {
      const k = [r.time, r.title, r.id].filter(Boolean).join("|").toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    return uniq;
  } catch (e) {
    console.log("HTTP match scrape hata:", e.message);
    return null;
  }
}

async function scrapeMatchesViaPuppeteer(page, activeDomain) {
  try {
    await page.goto(activeDomain, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForSelector("#matches-tab a.channel-item", { timeout: 5000 }).catch(() => {});
    const rows = await page.$$eval("#matches-tab a.channel-item", (as) =>
      as.map((a) => {
        const name = a.querySelector(".channel-name")?.textContent?.trim() || "";
        const time = a.querySelector(".channel-status")?.textContent?.trim() || "";
        const href = a.getAttribute("href") || "";
        const id = (() => {
          try {
            const u = new URL(href, location.origin);
            return u.searchParams.get("id");
          } catch {
            const m = href.match(/id=([^&]+)/);
            return m ? m[1] : null;
          }
        })();
        return { title: name, time: time || null, id: id || null, href: href || null };
      })
    );
    const seen = new Set();
    return rows.filter((r) => {
      if (!r.title) return false;
      const k = [r.time, r.title, r.id].filter(Boolean).join("|").toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  } catch (e) {
    console.log("Puppeteer match scrape hata:", e.message);
    return null;
  }
}

async function collectMatches(activeDomain, page) {
  let list = await fetchMatchesViaHTTP(activeDomain);
  if (!list || list.length === 0) list = await scrapeMatchesViaPuppeteer(page, activeDomain);
  const out = Array.isArray(list) ? list : [];
  fs.writeFileSync(path.join(process.cwd(), "matches.json"), JSON.stringify(out, null, 2), "utf-8");
  console.log(`✅ matches.json yazıldı — ${out.length} kayıt`);
}

/* ---------- m3u8 yakala ve streams.json üret ---------- */
(async () => {
  const chromePath = guessChrome();
  if (!chromePath) {
    console.error("❌ Chrome/Chromium bulunamadı. CHROME_PATH ile yol ver.");
    process.exit(2);
  }

  const activeDomain = await findActiveDomain(1380, 1410);
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

      const baseUrl = url.split(/yayin\d+\.m3u8/i)[0];
      const channels = {
        "BeIN Sports 1": "yayin1.m3u8",
        "BeIN Sports 2": "yayinb2.m3u8",
        "BeIN Sports 3": "yayinb3.m3u8",
        "BeIN Sports 4": "yayinb4.m3u8",
        "BeIN Max 1": "yayinbm1.m3u8",
        "BeIN Max 2": "yayinbm2.m3u8",
        "S Sport": "yayinss.m3u8",
        "S Sport 2": "yayinss2.m3u8",
        "Tivibu 1": "yayint1.m3u8",
        "Tivibu 2": "yayint2.m3u8",
        "Tivibu 3": "yayint3.m3u8",
        "Tivibu 4": "yayint4.m3u8",
        "TRT Spor": "yayintrtspor.m3u8",
        "TRT Spor 2": "yayintrtspor2.m3u8",
        "TRT 1": "yayintrt1.m3u8",
        "A Spor": "yayinas.m3u8",
        "ATV": "yayinatv.m3u8",
        "TV 8": "yayintv8.m3u8",
        "TV 8,5": "yayintv85.m3u8",
        "NBA TV": "yayinnbatv.m3u8",
        "Euro Sport 1": "yayineu1.m3u8",
        "Euro Sport 2": "yayineu2.m3u8",
      };

      const streams = {};
      for (const [name, pathUrl] of Object.entries(channels)) {
        const fullUrl = new URL(pathUrl, baseUrl).href;
        streams[name] = fullUrl;
      }
      fs.writeFileSync(path.join(process.cwd(), "streams.json"), JSON.stringify(streams, null, 2));
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
    await page.goto(TARGET, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
  } catch {}
  try { await page.mouse.click(300, 300, { clickCount: 1 }); } catch {}
  try {
    await page.evaluate(() => {
      const tryPlay = () => { const v = document.querySelector("video"); if (v) v.play().catch(() => {}); };
      tryPlay(); setTimeout(tryPlay, 800); setTimeout(tryPlay, 2000);
    });
  } catch {}

  await Promise.race([hitPromise, sleep(LISTEN_MS)]);
  if (!strongHit && lastAny) console.log(lastAny);
  else if (!strongHit) console.error("❌ m3u8 yakalanamadı");

  // --- MAÇ LİSTESİ (HTTP → Puppeteer fallback) ---
  await collectMatches(activeDomain, page);

  try { await cdp.detach(); } catch {}
  await browser.close();
  process.exit(0);
})().catch((e) => {
  console.error(e?.stack || e);
  process.exit(1);
});
