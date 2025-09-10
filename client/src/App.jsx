import React, { useEffect, useMemo, useRef, useState } from "react";
import Hls from "hls.js";
// API kökü: Vercel'de env'den, localde localhost
const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";

const getServerUrl = () => {
  const url = import.meta.env.VITE_SERVER_URL || "http://localhost:5001";
  console.log('Server URL:', url);
  return url;
};

/* Hafif, bağımsız ikonlar (kütüphane yok, inline SVG) */
const IconBall = (props) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" {...props}>
    <circle cx="12" cy="12" r="10" strokeWidth="1.5" />
    <path d="M12 2a8 8 0 0 1 8 8c0 2.2-1 4.2-2.5 5.6L12 12 6.5 5.6A8 8 0 0 1 12 2Z" strokeWidth="1.2"/>
  </svg>
);
const IconTv = (props) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" {...props}>
    <rect x="3" y="6" width="18" height="12" rx="2" strokeWidth="1.5"/>
    <path d="M8 18v2m8-2v2" strokeWidth="1.5"/>
  </svg>
);
const IconSearch = (props) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" {...props}>
    <circle cx="11" cy="11" r="7" strokeWidth="1.5"/><path d="M20 20l-3.5-3.5" strokeWidth="1.5"/>
  </svg>
);
const IconPlay = (props) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" {...props}>
    <path d="M8 5v14l11-7z" />
  </svg>
);
const IconClock = (props) => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" {...props}>
    <circle cx="12" cy="12" r="9" strokeWidth="1.5"/><path d="M12 7v5l3 2" strokeWidth="1.5"/>
  </svg>
);

export default function App() {
  const [hlsInstance, setHlsInstance] = useState(null);
  const [channels, setChannels] = useState([]);
  const [activeChannel, setActiveChannel] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const [tab, setTab] = useState("maclar"); // "maclar" | "kanallar"
  const [matches, setMatches] = useState([]);
  const [showControls, setShowControls] = useState(false);
  const [controlsTimer, setControlsTimer] = useState(null);
  const [videoPaused, setVideoPaused] = useState(true);
  const [videoMuted, setVideoMuted] = useState(false);

  // Arama kutuları
  const [matchQuery, setMatchQuery] = useState("");
  const [channelQuery, setChannelQuery] = useState("");

  

  useEffect(() => {
    fetch(`${API}/api/channels`)
      .then((res) => res.json())
      .then((data) => setChannels(Array.isArray(data) ? data : Object.keys(data || {})))
      .catch(() => setChannels(["BeIN Sports 1", "BeIN Sports 2", "BeIN Sports 3", "BeIN Sports 4"]));
  }, []);

  useEffect(() => {
     fetch(`${API}/api/matches`)
      .then((r) => r.json())
      .then((d) => setMatches(Array.isArray(d) ? d : []))
      .catch(() => setMatches([]));
  }, []);

  const safeResetVideo = (video) => {
    try { video.pause(); } catch {}
    try { video.removeAttribute("src"); video.load(); } catch {}
  };
const videoRef = useRef(null);
const hlsRef = useRef(null);
const commonPlay = async (playUrl, label = "") => {
  try {
    const video = videoRef.current;
    if (!video) return;

    // önceki hls instance'ını kapat
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    if (Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true });
      hlsRef.current = hls;
      hls.loadSource(playUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {});
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = playUrl;
      await video.play().catch(() => {});
    }

    setActiveChannel(label);+   setIsPlaying(true);
  } catch (e) {
    console.error("play error:", e);
  }
};

const playChannel = async (channelName) => {
  const res = await fetch(`${API}/api/stream/${encodeURIComponent(channelName)}`);
  const data = await res.json();
  if (!data?.url) return console.warn("stream url yok");
  commonPlay(data.url, channelName);
};


  const playByMatchId = async (id, fallbackTitle = null) => {
  const res = await fetch(`${API}/api/stream-id/${encodeURIComponent(id)}`);
  const data = await res.json();
  if (!data?.url) return console.warn("stream url yok");
  commonPlay(data.url, fallbackTitle || id);
};


  // Kontrol gösterme/gizleme
  const showControlsTemporarily = () => {
    setShowControls(true);
    if (controlsTimer) clearTimeout(controlsTimer);
    // Video durduysa kontrolleri gizleme
    if (!videoPaused) {
      const timer = setTimeout(() => setShowControls(false), 3000);
      setControlsTimer(timer);
    }
  };

  const handleMouseMove = () => {
    showControlsTemporarily();
  };

  const handleMouseLeave = () => {
    if (controlsTimer) clearTimeout(controlsTimer);
    setShowControls(false);
  };

  // FULLSCREEN (container)
  const toggleFullscreen = () => {
    const el = document.getElementById("playerBox");
    const doc = document;
    const inFs = doc.fullscreenElement || doc.webkitFullscreenElement;
    if (!inFs) {
      if (el.requestFullscreen) el.requestFullscreen();
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    } else {
      if (doc.exitFullscreen) doc.exitFullscreen();
      else if (doc.webkitExitFullscreen) doc.webkitExitFullscreen();
    }
  };

  useEffect(() => {
    const video = document.getElementById("video");
    const box = document.getElementById("playerBox");
    const onFsChange = () => {
      const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
      if (fsEl === video && box) {
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

  // Filtreli listeler
  const filteredMatches = useMemo(() => {
    const q = matchQuery.trim().toLowerCase();
    if (!q) return matches;
    return matches.filter((m) => {
      const t = (m.title || "").toLowerCase();
      return t.includes(q);
    });
  }, [matches, matchQuery]);

  const filteredChannels = useMemo(() => {
    const q = channelQuery.trim().toLowerCase();
    if (!q) return channels;
    return channels.filter((c) => c.toLowerCase().includes(q));
  }, [channels, channelQuery]);

  return (
    <div className="min-h-screen bg-[#0a0b0e] text-white">
      {/* küçük yardımcı CSS */}
      <style>{`
        #playerBox:fullscreen .player-logo,
        #playerBox:-webkit-full-screen .player-logo {
          width: clamp(120px, 11vw, 200px);
          top: max(16px, env(safe-area-inset-top));
          right: max(16px, env(safe-area-inset-right));
        }
        /* İnce ama görünür scrollbar */
        .thin-scroll::-webkit-scrollbar { width: 8px; }
        .thin-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,.15); border-radius: 8px; }
        .thin-scroll { scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.15) transparent; }
      `}</style>

      {/* HEADER — sade, sadece logo (büyük) */}
      <header className="fixed inset-x-0 top-0 z-40 border-b border-white/10 bg-black/60 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 py-4 md:py-5 flex items-center justify-center">
          <img src="/logom.png" alt="logo" className="h-12 md:h-16 w-auto" />
        </div>
      </header>

      {/* üst boşluk */}
      <div className="pt-[88px] md:pt-[104px]" />

      <div className="mx-auto max-w-7xl px-4 py-4 grid grid-cols-1 md:grid-cols-12 gap-4 md:gap-6">
        {/* PLAYER */}
        <main className="md:col-span-7 lg:col-span-8">
          {!activeChannel && (
            <div className="mb-4 rounded-2xl border border-white/10 bg-[radial-gradient(ellipse_at_top_left,_var(--tw-gradient-stops))] from-[#162031] via-[#0f1521] to-[#0a0b0e] p-6 md:p-10 text-center">
              <div className="space-y-4">
                <h1 className="text-2xl md:text-3xl font-bold tracking-wide">YAYIN BAŞLIYOR</h1>
                <div className="mx-auto h-28 w-28 md:h-32 md:w-32 rounded-full border-4 border-white/10 grid place-items-center">
                  <div className="h-0 w-0 border-t-[18px] border-t-transparent border-l-[28px] border-l-white/80 border-b-[18px] border-b-transparent translate-x-1" />
                </div>
                <p className="text-sm text-white/70">Aşağıdaki listelerden bir maç veya kanal seçin.</p>
              </div>
            </div>
          )}

          {/* PLAYER BOX */}
          <div
            id="playerBox"
            className={`rounded-3xl border-2 border-white/20 bg-gradient-to-br from-black via-gray-900 to-black overflow-hidden shadow-2xl relative w-full ${showControls ? 'cursor-default' : 'cursor-none'}`}
            onDoubleClick={toggleFullscreen}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            onClick={() => showControlsTemporarily()}
          >
            {/* 16:9 alan */}
            <div style={{ paddingTop: "56.25%" }} />

            <video  ref={videoRef}
              id="video"
              className="absolute inset-0 h-full w-full z-10"
              poster="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1920 1080'%3E%3Crect width='1920' height='1080' fill='%23000000'/%3E%3C/svg%3E"
            />

            {/* Permanent Logo at Bottom Center */}
            <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 z-30">
              <img
                src="/logom.png"
                alt="Logo"
                className="h-6 md:h-8 opacity-80"
              />
            </div>

            {/* Custom Controls Overlay */}
            <div className={`absolute inset-0 z-20 transition-opacity duration-500 bg-gradient-to-t from-black/60 via-transparent to-black/30 ${showControls ? 'opacity-100' : 'opacity-0'}`}>
              
              {/* Top Controls */}
              <div className="absolute top-0 left-0 right-0 p-4 flex justify-end items-start">
                {/* Live Badge */}
                <div className="flex items-center gap-2 bg-red-500/90 backdrop-blur-sm px-3 py-1.5 rounded-full">
                  <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
                  <span className="text-white text-sm font-semibold">CANLI</span>
                </div>
              </div>

              {/* Center Play/Pause Button */}
              <div className="absolute inset-0 flex items-center justify-center">
                <button 
                  onClick={() => {
                    const video = document.getElementById('video');
                    if (video.paused) video.play(); else video.pause();
                  }}
                  className="w-20 h-20 bg-white/20 backdrop-blur-sm border-2 border-white/40 rounded-full flex items-center justify-center hover:bg-white/30 hover:scale-110 transition-all duration-300"
                >
                  {videoPaused ? (
                    <div className="w-0 h-0 border-t-[12px] border-t-transparent border-l-[20px] border-l-white border-b-[12px] border-b-transparent ml-1"></div>
                  ) : (
                    <div className="flex gap-1">
                      <div className="w-1.5 h-6 bg-white rounded-sm"></div>
                      <div className="w-1.5 h-6 bg-white rounded-sm"></div>
                    </div>
                  )}
                </button>
              </div>

              {/* Bottom Controls */}
              <div className="absolute bottom-0 left-0 right-0 p-4">
                <div className="flex items-center gap-4">
                  
                  {/* Play/Pause */}
                  <button 
                    onClick={() => {
                      const video = document.getElementById('video');
                      if (video.paused) video.play(); else video.pause();
                    }}
                    className="w-10 h-10 bg-white/20 backdrop-blur-sm border border-white/30 rounded-xl flex items-center justify-center hover:bg-white/30 transition-all"
                  >
                    {videoPaused ? (
                      <div className="w-0 h-0 border-t-[6px] border-t-transparent border-l-[10px] border-l-white border-b-[6px] border-b-transparent ml-0.5"></div>
                    ) : (
                      <div className="flex gap-0.5">
                        <div className="w-1 h-3 bg-white rounded-sm"></div>
                        <div className="w-1 h-3 bg-white rounded-sm"></div>
                      </div>
                    )}
                  </button>

                  {/* Mute Button */}
                  <button 
                    onClick={() => {
                      const video = document.getElementById('video');
                      video.muted = !video.muted;
                    }}
                    className="w-10 h-10 bg-white/20 backdrop-blur-sm border border-white/30 rounded-xl flex items-center justify-center hover:bg-white/30 transition-all"
                  >
                    <span className="text-white text-sm">
                      {videoMuted ? '🔇' : '🔊'}
                    </span>
                  </button>

                  {/* Progress Bar */}
                  <div className="flex-1 h-2 bg-black/60 rounded-full overflow-hidden border border-white/20">
                    <div className="h-full bg-gradient-to-r from-emerald-500 to-green-400 w-1/3 rounded-full"></div>
                  </div>

                  {/* Quality */}
                  <div className="bg-white/20 backdrop-blur-sm border border-white/30 rounded-xl px-3 py-2">
                    <span className="text-white text-sm font-semibold">HD</span>
                  </div>

                  {/* Fullscreen */}
                  <button
                    onClick={toggleFullscreen}
                    className="w-10 h-10 bg-white/20 backdrop-blur-sm border border-white/30 rounded-xl flex items-center justify-center hover:bg-white/30 transition-all"
                    title="Tam ekran"
                  >
                    <span className="text-white text-sm">⛶</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* durum barı */}
          <div className="mt-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
              {activeChannel ? (
                <span className="text-white/80">{activeChannel} • {isPlaying ? "Canlı" : "Bağlanıyor…"}</span>
              ) : (
                <span className="text-white/60">Kanal seçilmedi</span>
              )}
            </div>
            <img src="/logom.png" alt="logo" className="hidden md:block h-8 opacity-80" />
          </div>

          {/* MOBİL SEKME + PANEL */}
          <div className="mt-4 md:hidden">
            <div className="rounded-2xl border border-white/10 bg-white/[0.06] overflow-hidden">
              {/* üst: sekmeler */}
              <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10 sticky top-0 bg-white/[0.06]">
                <button
                  onClick={() => setTab("maclar")}
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${tab === "maclar" ? "bg-white/15" : "hover:bg-white/10"}`}
                >
                  <IconBall /> Maçlar
                  <span className="ml-1 text-[11px] px-1.5 py-0.5 rounded bg-white/10">{filteredMatches.length}</span>
                </button>
                <button
                  onClick={() => setTab("kanallar")}
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${tab === "kanallar" ? "bg-white/15" : "hover:bg-white/10"}`}
                >
                  <IconTv /> Kanallar
                  <span className="ml-1 text-[11px] px-1.5 py-0.5 rounded bg-white/10">{filteredChannels.length}</span>
                </button>
              </div>

              {/* arama */}
              <div className="px-3 py-2 border-b border-white/10 flex items-center gap-2">
                <div className="relative flex-1">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 opacity-70">
                    <IconSearch />
                  </span>
                  {tab === "maclar" ? (
                    <input
                      value={matchQuery}
                      onChange={(e) => setMatchQuery(e.target.value)}
                      placeholder="Maç ara…"
                      className="w-full rounded-lg bg-white/10 px-8 py-2 text-sm outline-none placeholder-white/50"
                    />
                  ) : (
                    <input
                      value={channelQuery}
                      onChange={(e) => setChannelQuery(e.target.value)}
                      placeholder="Kanal ara…"
                      className="w-full rounded-lg bg-white/10 px-8 py-2 text-sm outline-none placeholder-white/50"
                    />
                  )}
                </div>
              </div>

              {/* içerik: 40vh, kendi scroll'u */}
              <div className="thin-scroll max-h-[40vh] overflow-y-auto p-3">
                {tab === "maclar" ? (
                  filteredMatches.length === 0 ? (
                    <div className="rounded-xl border border-white/10 bg-white/[0.06] p-4 text-sm text-white/70">
                      Sonuç yok.
                    </div>
                  ) : (
                    filteredMatches.map((m, i) => (
                      <div key={i} className="rounded-xl border border-white/10 bg-white/[0.06] p-3 mb-2 flex items-center justify-between">
                        <div className="min-w-0">
                          <div className="font-semibold truncate">{m.title}</div>
                          <div className="mt-0.5 text-xs text-white/70 flex items-center gap-1">
                            <IconClock /> {m.time || "—"}
                          </div>
                        </div>
                        {m.id ? (
                          <button
                            onClick={() => playByMatchId(m.id, m.title)}
                            className="shrink-0 inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/10 px-3 py-1.5 text-xs hover:bg-white/15"
                          >
                            <IconPlay /> Oynat
                          </button>
                        ) : (
                          <span className="text-xs text-white/60">—</span>
                        )}
                      </div>
                    ))
                  )
                ) : (
                  filteredChannels.length === 0 ? (
                    <div className="rounded-xl border border-white/10 bg-white/[0.06] p-4 text-sm text-white/70">
                      Sonuç yok.
                    </div>
                  ) : (
                    filteredChannels.map((ch) => {
                      const active = activeChannel === ch;
                      return (
                        <button
                          key={ch}
                          onClick={() => playChannel(ch)}
                          className={[
                            "w-full text-left rounded-xl border px-4 py-3 mb-2",
                            "bg-white/[0.06] hover:bg-white/[0.10]",
                            active ? "border-emerald-400 ring-2 ring-emerald-400/30" : "border-white/10"
                          ].join(" ")}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="h-8 w-8 rounded-md bg-white/10 grid place-items-center"><IconTv /></div>
                              <div className="font-semibold truncate">{ch}</div>
                            </div>
                            <div className="text-xs text-white/60">{active ? "▶ Canlı" : "Oynat"}</div>
                          </div>
                        </button>
                      );
                    })
                  )
                )}
              </div>
            </div>
          </div>
        </main>

        {/* MASAÜSTÜ SAĞ PANEL */}
        <aside className="hidden md:flex md:col-span-5 lg:col-span-4">
          <div className="flex-1 rounded-2xl border border-white/10 bg-white/[0.06] backdrop-blur overflow-hidden flex flex-col">
            {/* sticky sekme çubuğu */}
            <div className="px-3 py-3 border-b border-white/10 bg-white/[0.06] sticky top-0 z-10">
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setTab("maclar")}
                  className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-3 text-base font-semibold whitespace-nowrap ${tab === "maclar" ? "bg-white/15" : "hover:bg-white/10"}`}
                >
                  ⚽ MAÇLAR
                  <span className="text-[11px] px-1.5 py-0.5 rounded bg-white/10">{filteredMatches.length}</span>
                </button>
                <button
                  onClick={() => setTab("kanallar")}
                  className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-3 text-base font-semibold whitespace-nowrap ${tab === "kanallar" ? "bg-white/15" : "hover:bg-white/10"}`}
                >
                  📺 KANALLAR
                  <span className="text-[11px] px-1.5 py-0.5 rounded bg-white/10">{filteredChannels.length}</span>
                </button>
              </div>

              {/* arama satırı */}
              <div className="mt-2">
                <div className="relative">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 opacity-70">
                    <IconSearch />
                  </span>
                  {tab === "maclar" ? (
                    <input
                      value={matchQuery}
                      onChange={(e) => setMatchQuery(e.target.value)}
                      placeholder="Maç ara…"
                      className="w-full rounded-lg bg-white/10 px-8 py-2 text-sm outline-none placeholder-white/50"
                    />
                  ) : (
                    <input
                      value={channelQuery}
                      onChange={(e) => setChannelQuery(e.target.value)}
                      placeholder="Kanal ara…"
                      className="w-full rounded-lg bg-white/10 px-8 py-2 text-sm outline-none placeholder-white/50"
                    />
                  )}
                </div>
              </div>
            </div>

            {/* içerik — kendi scroll alanı */}
            <div className="thin-scroll h-[500px] overflow-y-auto p-3">
              {tab === "kanallar" ? (
                filteredChannels.length === 0 ? (
                  <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-4 text-sm text-white/70">
                    Sonuç yok.
                  </div>
                ) : (
                  <div className="grid gap-3">
                    {filteredChannels.map((ch) => {
                      const active = activeChannel === ch;
                      return (
                        <button
                          key={ch}
                          onClick={() => playChannel(ch)}
                          className={[
                            "w-full text-left rounded-2xl border px-4 py-4 transition",
                            "bg-white/[0.06] hover:bg-white/[0.10] active:scale-[0.99]",
                            active ? "border-emerald-400 ring-2 ring-emerald-400/30" : "border-white/10",
                          ].join(" ")}
                        >
                          <div className="flex items-center justify-between gap-4">
                            <div className="flex items-center gap-4 min-w-0">
                              <div className="h-9 w-9 rounded-md bg-white/10 grid place-items-center"><IconTv /></div>
                              <div className="text-base font-semibold truncate">{ch}</div>
                            </div>
                            <div className="text-xs text-white/60">{active ? "▶︎ Canlı" : "Oynat"}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )
              ) : (
                filteredMatches.length === 0 ? (
                  <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-4 text-sm text-white/70">
                    Maç listesi yok / yüklenemedi.
                  </div>
                ) : (
                  <div className="grid gap-3">
                    {filteredMatches.map((m, i) => (
                      <div key={i} className="rounded-2xl border border-white/10 bg-white/[0.06] p-4 flex items-center justify-between">
                        <div className="min-w-0">
                          <div className="font-semibold truncate">{m.title}</div>
                          <div className="mt-1 text-xs text-white/70 flex items-center gap-1">
                            <IconClock /> {m.time || "—"}
                          </div>
                        </div>
                        {m.id ? (
                          <button
                            onClick={() => playByMatchId(m.id, m.title)}
                            className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/10 px-3 py-1.5 text-xs hover:bg-white/15"
                          >
                            <IconPlay /> Oynat
                          </button>
                        ) : (
                          <div className="text-xs text-white/60">—</div>
                        )}
                      </div>
                    ))}
                  </div>
                )
              )}
            </div>
          </div>
        </aside>
      </div>

      {/* FOOTER */}
      <footer className="mx-auto max-w-7xl px-4 pb-6 pt-2 md:pt-0">
        <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-center text-xs text-white/60">
          © {new Date().getFullYear()} — Yayın arayüzü • hafif ve hızlı.
        </div>
      </footer>
    </div>
  );
}
