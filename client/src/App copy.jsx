import React, { useEffect, useState } from "react";
import Hls from "hls.js";

export default function App() {
  const [hlsInstance, setHlsInstance] = useState(null);
  const [channels, setChannels] = useState([]);
  const [activeChannel, setActiveChannel] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [tab, setTab] = useState("kanallar"); // "maclar" | "kanallar"

  useEffect(() => {
    fetch("http://localhost:5001/api/channels")
      .then((res) => res.json())
      .then((data) => setChannels(Array.isArray(data) ? data : Object.keys(data || {})))
      .catch(() => setChannels(["BeIN Sports 1","BeIN Sports 2","BeIN Sports 3","BeIN Sports 4"]));
  }, []);

  const playChannel = (channelName) => {
    const video = document.getElementById("video");
    const streamUrl = `http://localhost:5001/api/stream/${encodeURIComponent(channelName)}`;

    if (hlsInstance) hlsInstance.destroy();

    if (Hls.isSupported()) {
      const hls = new Hls({
        // not: istersen fetchSetup ile tüm istekleri proxy’ye yönlendirebilirsin
        xhrSetup: (xhr, url) => {
          xhr.open("GET", `http://localhost:5001/api/proxy?url=${encodeURIComponent(url)}`);
        },
      });
      hls.loadSource(streamUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play();
        setIsPlaying(true);
      });
      setHlsInstance(hls);
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = streamUrl;
      video.addEventListener("loadedmetadata", () => {
        video.play();
        setIsPlaying(true);
      });
    }
    setActiveChannel(channelName);
  };

  // === Fullscreen toggle (container üzerinden) ===
  const toggleFullscreen = () => {
    const el = document.getElementById("playerBox");
    const doc = document;

    const inFs = doc.fullscreenElement || doc.webkitFullscreenElement;
    if (!inFs) {
      if (el.requestFullscreen) el.requestFullscreen();
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen(); // Safari
    } else {
      if (doc.exitFullscreen) doc.exitFullscreen();
      else if (doc.webkitExitFullscreen) doc.webkitExitFullscreen();
    }
  };

  // Eğer kullanıcı yanlışlıkla videoyu (konteyner yerine) tam ekrana alırsa, yakalayıp konteynere çevir.
  useEffect(() => {
    const video = document.getElementById("video");
    const box = document.getElementById("playerBox");
    const onFsChange = () => {
      const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
      if (fsEl === video && box) {
        // videodan çıkıp konteyneri tam ekrana al
        if (document.exitFullscreen) document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
        setTimeout(() => {
          if (box.requestFullscreen) box.requestFullscreen();
          else if (box.webkitRequestFullscreen) box.webkitRequestFullscreen();
        }, 0);
      }
    };
    document.addEventListener("fullscreenchange", onFsChange);
    document.addEventListener("webkitfullscreenchange", onFsChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFsChange);
      document.removeEventListener("webkitfullscreenchange", onFsChange);
    };
  }, []);

  return (
    <div className="min-h-screen bg-[#0a0b0e] text-white">
      {/* fullscreen için CSS (logo boyutu ve çentik güvenliği) */}
      <style>{`
        #playerBox:fullscreen .player-logo,
        #playerBox:-webkit-full-screen .player-logo {
          width: clamp(110px, 10vw, 180px);
          top: max(12px, env(safe-area-inset-top));
          right: max(12px, env(safe-area-inset-right));
        }
      `}</style>

      {/* TOP BAR */}
      <header className="fixed inset-x-0 top-0 z-40 border-b border-white/10 bg-black/40 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/logom.png" alt="logo" className="h-8 w-auto" />
            <span className="text-sm md:text-base tracking-wider text-white/80">
              CANLI YAYIN MERKEZİ
            </span>
          </div>
          <button
            className="md:hidden inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm hover:bg-white/10 active:scale-95 transition"
            onClick={() => setSidebarOpen((s) => !s)}
          >
            ☰
          </button>
        </div>
      </header>

      {/* SUB STRIP */}
      <div className="pt-[64px]">
        <div className="bg-gradient-to-r from-white/5 to-white/0">
          <div className="mx-auto max-w-7xl px-4 py-2 text-xs text-white/70">
            Yayınlar HD – En iyi deneyim için Wi-Fi önerilir.
          </div>
        </div>
      </div>

      {/* LAYOUT */}
      <div className="mx-auto max-w-7xl px-4 py-4 grid grid-cols-1 md:grid-cols-12 gap-4 md:gap-6">
        {/* LEFT: PLAYER */}
        <main className="md:col-span-8 lg:col-span-9">
          {!activeChannel && (
            <div className="mb-3 rounded-2xl border border-white/10 bg-[radial-gradient(ellipse_at_top_left,_var(--tw-gradient-stops))] from-[#162031] via-[#0f1521] to-[#0a0b0e] p-6 md:p-10 text-center">
              <div className="space-y-4">
                <h1 className="text-2xl md:text-3xl font-bold tracking-wide">YAYIN BAŞLIYOR</h1>
                <div className="mx-auto h-28 w-28 md:h-32 md:w-32 rounded-full border-4 border-white/10 grid place-items-center">
                  <div className="h-0 w-0 border-t-[18px] border-t-transparent border-l-[28px] border-l-white/80 border-b-[18px] border-b-transparent translate-x-1" />
                </div>
                <p className="text-sm text-white/70">Sağdaki listeden bir kanal seçin.</p>
              </div>
            </div>
          )}

          {/* === PLAYER KONTEYNERİ (overlay logo + custom fullscreen) === */}
          <div
            id="playerBox"
            className="rounded-2xl border border-white/10 bg-black/70 overflow-hidden shadow-2xl relative w-full"
            onDoubleClick={toggleFullscreen}
          >
            {/* 16:9 alan */}
            <div style={{ paddingTop: "56.25%" }} />

            {/* Video */}
            <video
              id="video"
              // native fullscreen tuşunu gizle, bizim buton kullanılsın
              controls
              controlsList="nofullscreen noplaybackrate nodownload"
              className="absolute inset-0 h-full w-full z-10"
              poster="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1920 1080'%3E%3Crect width='1920' height='1080' fill='%23000000'/%3E%3C/svg%3E"
            />

            {/* Overlay Logo (player içinde sabit) */}
            <img
              src="/logom.png"
              alt="Logo"
              className="player-logo absolute top-3 right-3 w-20 md:w-24 lg:w-28 opacity-95 select-none pointer-events-none z-20"
            />

            {/* Custom fullscreen butonu */}
            <button
              onClick={toggleFullscreen}
              className="absolute bottom-3 right-3 z-20 rounded-xl border border-white/10 bg-white/10 px-3 py-1.5 text-xs hover:bg-white/15 active:scale-95"
              title="Tam ekran"
            >
              ⤢ Tam ekran
            </button>
          </div>

          {/* alt bar */}
          <div className="mt-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs">
              <span className="inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
              {activeChannel ? (
                <span className="text-white/80">
                  {activeChannel} • {isPlaying ? "Canlı" : "Bağlanıyor…"}
                </span>
              ) : (
                <span className="text-white/60">Kanal seçilmedi</span>
              )}
            </div>
            <img src="/logom.png" alt="logo" className="hidden md:block h-7 opacity-80" />
          </div>
        </main>

        {/* RIGHT: SIDEBAR W/ TABS */}
        <aside
          className={[
            "md:col-span-4 lg:col-span-3",
            "md:static md:translate-x-0 md:opacity-100",
            "fixed left-0 top-[104px] bottom-0 z-30 w-[86%] max-w-xs",
            "transition",
            sidebarOpen ? "translate-x-0 opacity-100" : "-translate-x-full opacity-0",
          ].join(" ")}
        >
          <div className="h-full overflow-hidden rounded-2xl border border-white/10 bg-white/5 backdrop-blur">
            {/* tabs */}
            <div className="flex gap-1 px-2 py-2 border-b border-white/10">
              <button
                onClick={() => setTab("maclar")}
                className={`flex-1 rounded-lg px-3 py-2 text-sm transition ${
                  tab === "maclar" ? "bg-white/15" : "hover:bg-white/10"
                }`}
              >
                • MAÇLAR
              </button>
              <button
                onClick={() => setTab("kanallar")}
                className={`flex-1 rounded-lg px-3 py-2 text-sm transition ${
                  tab === "kanallar" ? "bg-white/15" : "hover:bg-white/10"
                }`}
              >
                • KANALLAR
              </button>
            </div>

            {/* list */}
            <div className="h-[calc(100%-48px)] overflow-y-auto p-2 md:p-3">
              {tab === "kanallar" && (
                <div className="space-y-2">
                  {channels.map((ch) => {
                    const active = activeChannel === ch;
                    return (
                      <button
                        key={ch}
                        onClick={() => {
                          playChannel(ch);
                          if (window.innerWidth < 768) setSidebarOpen(false);
                        }}
                        className={[
                          "w-full text-left rounded-xl border px-3 py-3 transition",
                          "bg-white/5 hover:bg-white/10 active:scale-[0.99]",
                          active ? "border-emerald-400 ring-2 ring-emerald-400/30" : "border-white/10",
                        ].join(" ")}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3">
                            {/* logo kutusu (kanal mini logo koymak istersen burayı doldururuz) */}
                            <div className="h-7 w-20 rounded-md bg-white/10 grid place-items-center text-[10px] text-white/80">
                              LOGO
                            </div>
                            <div className="font-medium">{ch}</div>
                          </div>
                          <div className="text-xs text-white/60">{active ? "▶︎ Canlı" : "Oynat"}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {tab === "maclar" && (
                <div className="space-y-2">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <div
                      key={i}
                      className="rounded-xl border border-white/10 bg-white/5 p-3 flex items-center justify-between"
                    >
                      <div className="flex items-center gap-3">
                        <div className="h-6 w-6 rounded-md bg-white/10 grid place-items-center">⚽</div>
                        <div className="text-sm">
                          <div className="font-medium">Takım A vs Takım B</div>
                          <div className="text-xs text-white/60">19:45 • HD Yayın</div>
                        </div>
                      </div>
                      <div className="text-xs text-white/60">Canlı yakında</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </aside>
      </div>
              
      {/* FOOTER */}
      <footer className="mx-auto max-w-7xl px-4 pb-6">
        <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-center text-xs text-white/60">
          © {new Date().getFullYear()} — Yayın arayüzü. Bahis / casino içeriği içermez.
        </div>
      </footer>
    </div>
  );
}
