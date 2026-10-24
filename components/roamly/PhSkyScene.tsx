"use client";

import { useEffect, useRef } from "react";

/**
 * PhSkyScene — a decorative, fully non-destructive animated shoreline scene
 * for the /ph hero (Junel's request, 2026-10-23): coconut palms swaying in a
 * slow wind while the sky cycles sunrise → midday → sunset → dusk (~60s).
 *
 * Non-destructive by construction:
 * - The root layer is pointer-events:none and aria-hidden, absolutely
 *   positioned BEHIND the hero content (z-0); it can never intercept a click.
 * - Animation is pure CSS (transforms + opacity only) on layered gradients,
 *   a sun/moon disc, stars, and inline-SVG palms. No JS animation loop, no
 *   canvas, no video, no image assets.
 * - An IntersectionObserver pauses every animation while the hero is
 *   off-screen (data-running="false").
 * - prefers-reduced-motion: all animation is removed and the scene rests as
 *   a static golden-sunrise shoreline (the layers' base states).
 */

const SKY_SUNRISE =
  "linear-gradient(180deg,#f6bd93 0%,#fbd9ae 34%,#ffedbe 58%,#ffd9a0 71%,#8fc0ae 74%,#5f9a8d 84%,#3f7f78 100%)";
const SKY_MIDDAY =
  "linear-gradient(180deg,#6fb6ec 0%,#a5dcf7 38%,#dcf6ff 62%,#bfeef2 71%,#63cabd 74%,#35a8b8 86%,#23819b 100%)";
const SKY_SUNSET =
  "linear-gradient(180deg,#4c3d6e 0%,#a04e68 32%,#e2703a 55%,#ffb257 68%,#ffd98a 72%,#c97a5e 76%,#6a648f 88%,#46538a 100%)";
const SKY_DUSK =
  "linear-gradient(180deg,#0d1d38 0%,#21395e 36%,#5d7195 60%,#c98a72 70%,#e8a37c 73%,#33506b 78%,#16293f 100%)";

const STARS: Array<[number, number, number]> = [
  [60, 40, 2.2], [150, 96, 1.6], [238, 30, 2.6], [330, 74, 1.5], [415, 44, 2.1],
  [505, 100, 1.6], [588, 26, 2.4], [672, 82, 1.5], [748, 48, 2.0], [836, 108, 1.6],
  [918, 34, 2.3], [1002, 78, 1.5], [1088, 52, 2.0], [1170, 96, 1.7], [1252, 28, 2.5],
  [1336, 70, 1.6], [1408, 44, 2.1], [196, 150, 1.4], [700, 140, 1.4], [1210, 152, 1.5],
  [452, 168, 1.3], [980, 176, 1.3], [84, 190, 1.4], [1360, 186, 1.4]
];

const FRONDS = [
  "M199,97 Q128,28 26,40 Q118,60 199,108 Z",
  "M199,96 Q146,14 78,4 Q142,44 199,104 Z",
  "M199,95 Q198,22 240,0 Q216,42 207,95 Z",
  "M199,97 Q266,22 344,30 Q266,56 199,107 Z",
  "M199,98 Q288,58 330,74 Q270,86 199,109 Z",
  "M199,100 Q116,92 30,140 Q118,112 199,111 Z",
  "M199,100 Q284,94 336,142 Q264,116 199,111 Z",
  "M199,101 Q150,120 118,168 Q168,128 200,110 Z"
];

function Palm({ sway, lean, duration, delay, leanDuration }: { sway: string; lean: string; duration: string; delay: string; leanDuration: string }) {
  return (
    <svg viewBox="0 0 320 440" width="100%" height="100%" focusable="false" aria-hidden="true">
      <g className={lean} style={{ animationDuration: leanDuration }}>
        <path
          fill="currentColor"
          d="M103,440 C110,352 126,244 158,152 C171,117 182,101 190,93 L209,99 C199,112 188,133 178,164 C149,252 138,354 141,440 Z"
        />
        <path d="M113,382 Q138,374 148,386" fill="none" stroke="#000" strokeOpacity="0.14" strokeWidth="4" strokeLinecap="round" />
        <path d="M120,322 Q146,314 154,326" fill="none" stroke="#000" strokeOpacity="0.14" strokeWidth="4" strokeLinecap="round" />
        <path d="M132,262 Q156,254 162,266" fill="none" stroke="#000" strokeOpacity="0.14" strokeWidth="4" strokeLinecap="round" />
        <g className={sway} style={{ animationDuration: duration, animationDelay: delay }}>
          {FRONDS.map((d) => (
            <path key={d} fill="currentColor" d={d} />
          ))}
          <circle cx="186" cy="113" r="10" fill="currentColor" />
          <circle cx="207" cy="117" r="9" fill="currentColor" />
          <circle cx="196" cy="125" r="8" fill="currentColor" />
        </g>
      </g>
    </svg>
  );
}

const SCENE_CSS = `
.phs-root{position:absolute;inset:0;z-index:0;overflow:hidden;border-radius:1.75rem;pointer-events:none;box-shadow:inset 0 0 0 1px rgba(15,110,102,0.14)}
.phs-layer{position:absolute;inset:0;opacity:0}
.phs-layer--sunrise{opacity:1;animation:phsSunrise 60s linear infinite}
.phs-layer--midday{animation:phsMidday 60s linear infinite}
.phs-layer--sunset{animation:phsSunset 60s linear infinite}
.phs-layer--dusk{animation:phsDusk 60s linear infinite}
@keyframes phsSunrise{0%{opacity:1}25%{opacity:0}75%{opacity:0}100%{opacity:1}}
@keyframes phsMidday{0%{opacity:0}25%{opacity:1}50%{opacity:0}100%{opacity:0}}
@keyframes phsSunset{0%{opacity:0}25%{opacity:0}50%{opacity:1}75%{opacity:0}100%{opacity:0}}
@keyframes phsDusk{0%{opacity:0}50%{opacity:0}75%{opacity:1}100%{opacity:0}}
.phs-sun{position:absolute;inset:0;transform:translate(2%,57%);animation:phsSun 60s linear infinite}
.phs-sun::before{content:"";position:absolute;left:0;top:0;width:84px;height:84px;border-radius:9999px;background:radial-gradient(circle at 50% 50%,#fff8dc 0%,#ffd76e 55%,#ffb84d 100%);box-shadow:0 0 90px 44px rgba(255,190,80,0.45)}
@keyframes phsSun{0%{transform:translate(2%,57%);opacity:1}25%{transform:translate(43%,4%);opacity:1}50%{transform:translate(85%,57%);opacity:1}60%{transform:translate(90%,88%);opacity:0}86%{transform:translate(-4%,88%);opacity:0}100%{transform:translate(2%,57%);opacity:1}}
.phs-moon{position:absolute;inset:0;opacity:0;animation:phsMoon 60s linear infinite}
.phs-moon::before{content:"";position:absolute;left:0;top:0;width:46px;height:46px;border-radius:9999px;background:radial-gradient(circle at 38% 38%,#fdfdf5 0%,#cfd8e6 70%,#aebdd2 100%);box-shadow:0 0 34px 8px rgba(210,225,255,0.35)}
@keyframes phsMoon{0%{transform:translate(70%,10%);opacity:0}55%{transform:translate(68%,8%);opacity:0}75%{transform:translate(66%,6%);opacity:0.95}92%{transform:translate(64%,5%);opacity:0}100%{transform:translate(70%,10%);opacity:0}}
.phs-stars{position:absolute;left:0;top:0;width:100%;height:62%;opacity:0;animation:phsStars 60s linear infinite}
@keyframes phsStars{0%{opacity:0}52%{opacity:0}75%{opacity:0.85}90%{opacity:0}100%{opacity:0}}
.phs-scrim{position:absolute;inset:0;background:linear-gradient(180deg,rgba(247,247,238,0.74) 0%,rgba(247,247,238,0.56) 38%,rgba(247,247,238,0.3) 58%,rgba(247,247,238,0.08) 72%,rgba(247,247,238,0) 82%),linear-gradient(0deg,rgba(247,247,238,0.66) 0%,rgba(247,247,238,0.42) 10%,rgba(247,247,238,0.16) 22%,rgba(247,247,238,0) 34%)}
.phs-palm{position:absolute;color:#07332e;-webkit-mask-image:linear-gradient(180deg,transparent 0,#000 30%);mask-image:linear-gradient(180deg,transparent 0,#000 30%)}
.phs-palm--distant{color:#2e7d6f;opacity:0.45}
.phs-crown{transform-box:view-box;transform-origin:199px 99px;animation-name:phsSway;animation-timing-function:ease-in-out;animation-iteration-count:infinite;animation-direction:alternate}
.phs-lean{transform-box:view-box;transform-origin:122px 440px;animation-name:phsLean;animation-timing-function:ease-in-out;animation-iteration-count:infinite;animation-direction:alternate}
@keyframes phsSway{from{transform:rotate(-2.4deg)}to{transform:rotate(2.6deg)}}
@keyframes phsLean{from{transform:rotate(-0.35deg)}to{transform:rotate(0.4deg)}}
.phs-root[data-running="false"] *{animation-play-state:paused !important}
@media (prefers-reduced-motion: reduce){.phs-root *{animation:none !important}}
`;

export default function PhSkyScene() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          el.dataset.running = entry.isIntersecting ? "true" : "false";
        }
      },
      { threshold: 0.02 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={rootRef} className="phs-root" aria-hidden="true" data-running="true">
      <div className="phs-layer phs-layer--sunrise" style={{ background: SKY_SUNRISE }} />
      <div className="phs-layer phs-layer--midday" style={{ background: SKY_MIDDAY }} />
      <div className="phs-layer phs-layer--sunset" style={{ background: SKY_SUNSET }} />
      <div className="phs-layer phs-layer--dusk" style={{ background: SKY_DUSK }} />
      <svg className="phs-stars" viewBox="0 0 1440 340" preserveAspectRatio="xMidYMin slice" focusable="false" aria-hidden="true">
        {STARS.map(([cx, cy, r]) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} fill="#eef4ff" />
        ))}
      </svg>
      <div className="phs-sun" />
      <div className="phs-moon" />
      <div className="phs-palm phs-palm--distant" style={{ right: "23%", bottom: 0, height: "44%", aspectRatio: "320 / 440" }}>
        <Palm sway="phs-crown" lean="phs-lean" duration="5.7s" delay="-2.1s" leanDuration="8.4s" />
      </div>
      <div className="phs-palm" style={{ left: "-18px", bottom: "-6px", height: "82%", aspectRatio: "320 / 440" }}>
        <Palm sway="phs-crown" lean="phs-lean" duration="6.3s" delay="-1.2s" leanDuration="9.5s" />
      </div>
      <div className="phs-palm" style={{ right: "-14px", bottom: "-4px", height: "74%", aspectRatio: "320 / 440", transform: "scaleX(-1)" }}>
        <Palm sway="phs-crown" lean="phs-lean" duration="7.1s" delay="-3.4s" leanDuration="11s" />
      </div>
      <div className="phs-scrim" />
      <style>{SCENE_CSS}</style>
    </div>
  );
}
