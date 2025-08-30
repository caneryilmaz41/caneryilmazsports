// node grab-stream-url.js https://trgoals1378.xyz/   (veya channel.html?id=...)
import  { chromium  }from'playwright';


const TARGET = process.argv[2] || 'https://trgoals1378.xyz/';
const PATTERN = /\.(m3u8|m3u)(\?|$)/i;          // istersen /\.mpd/ ekle
const TIMEOUT_MS = 60000;                       // en fazla 60 sn bekle

(async () => {
  let found = null;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    locale: 'tr-TR'
  });
  const page = await context.newPage();

  const done = async (url, code = 0) => {
    try { if (url) process.stdout.write(url + '\n'); } catch {}
    try { await context.close(); } catch {}
    try { await browser.close(); } catch {}
    process.exit(code);
  };

  // ağ isteklerinde yakala (tüm frame'ler dahil)
  page.on('request', (req) => {
    const url = req.url();
    if (!found && PATTERN.test(url)) {
      found = url;
      done(found, 0);
    }
  });

  // bazen link response gövdesinde olur (JSON/text içinde)
  page.on('response', async (res) => {
    if (found) return;
    const ct = (res.headers()['content-type'] || '').toLowerCase();
    if (!/json|text|javascript|xml/.test(ct)) return;
    try {
      const text = await res.text();
      const m = text.match(/https?:\/\/[^\s"'\\<>]+\.m3u8[^\s"'\\<>]*/i);
      if (m) { found = m[0]; done(found, 0); }
    } catch {}
  });

  // sayfaya git
  await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 45000 });

  // Eğer ana sayfaysa, iframe src’sini çekip doğrudan ona git
  if (!/channel\.html\?id=/i.test(TARGET)) {
    const iframeSrc = await page.$eval('#customIframe', el => el?.src).catch(() => null);
    if (iframeSrc) {
      // mutlaklaştır
      const abs = new URL(iframeSrc, TARGET).href;
      await page.goto(abs, { waitUntil: 'domcontentloaded' });
    }
  }

  // bazı yayınlar kullanıcı etkileşimi bekler; olursa tetikle (sessiz, başarısız olsa da sorun değil)
  const tryPlay = async (scope) => {
    try {
      // butonlar
      for (const sel of ['.vjs-big-play-button','button:has-text("Play")','#play','.play']) {
        await scope.click(sel, { timeout: 800 }).catch(()=>{});
      }
      // video.play()
      await scope.evaluate(() => {
        const v = document.querySelector('video');
        if (v && v.paused) v.play().catch(()=>{});
      }).catch(()=>{});
    } catch {}
  };

  await tryPlay(page);

  // 60 sn içinde bulunmazsa 1 ile çık
  setTimeout(() => {
    if (!found) done('', 1);
  }, TIMEOUT_MS);

  // ağın biraz akmasına izin ver
  await page.waitForTimeout(TIMEOUT_MS - 1000);
})();
