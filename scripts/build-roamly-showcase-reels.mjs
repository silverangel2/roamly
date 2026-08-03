import { spawn } from "node:child_process";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import sharp from "sharp";

const root = process.cwd();
const width = 1080;
const height = 1920;
const fps = 30;

const dirs = {
  sources: path.join(root, "content/social/showcase-reels/generated-sources"),
  overlays: path.join(root, "content/social/showcase-reels/overlays"),
  previews: path.join(root, "content/social/showcase-reels/previews"),
  thumbs: path.join(root, "content/social/showcase-reels/thumbnails")
};

const reels = [
  {
    slug: "paris-luxury",
    output: "roamly-showcase-001-paris-luxury.mp4",
    thumb: "roamly-showcase-001-paris-luxury.jpg",
    duration: 20,
    destination: "Paris",
    theme: "Luxury Travel",
    hook: "Luxury is not more. It is easier.",
    caption:
      "Paris feels premium when the hotel, transfers, dinner windows, and slow mornings work in sync. Roamly turns the trip into something calm, polished, and ready.",
    cta: "Upgrade the plan with Roamly",
    overlays: [
      { start: 0, end: 6.6, title: "Luxury is not more.", subtitle: "It is easier." },
      { start: 6.6, end: 13.2, title: "Hotels. Transfers. Dinner windows.", subtitle: "One plan that actually flows." },
      { start: 13.2, end: 20, title: "Upgrade the plan.", subtitle: "Roamly makes travel feel effortless." }
    ],
    shots: [
      {
        source: "paris-luxury-source.png",
        duration: 6.6,
        zoom: "1.022+0.00014*on",
        x: "(iw-iw/zoom)/2+22*sin(on/95)",
        y: "(ih-ih/zoom)/2-18*cos(on/130)"
      },
      {
        source: "paris-luxury-suite-planning-source.png",
        duration: 6.6,
        zoom: "1.028+0.00012*on",
        x: "(iw-iw/zoom)/2-12*cos(on/100)",
        y: "(ih-ih/zoom)/2+18*sin(on/135)"
      },
      {
        source: "paris-luxury-rooftop-source.png",
        duration: 6.8,
        zoom: "1.018+0.00013*on",
        x: "(iw-iw/zoom)/2+16*cos(on/125)",
        y: "(ih-ih/zoom)/2-10*sin(on/110)"
      }
    ],
    audio: "warm cinematic lounge bed",
    hashtags: ["Roamly", "ParisTravel", "LuxuryTravel", "PremiumTravel", "TravelPlanning"],
    grade: "eq=contrast=1.075:saturation=1.08:brightness=-0.012,vignette=PI/5"
  },
  {
    slug: "patagonia-adventure",
    output: "roamly-showcase-002-patagonia-adventure.mp4",
    thumb: "roamly-showcase-002-patagonia-adventure.jpg",
    duration: 22,
    destination: "Patagonia",
    theme: "Adventure Travel",
    hook: "Plan hard. Travel wild.",
    caption:
      "Patagonia is wild enough. Your transfers, layers, weather windows, and recovery time should not be. Roamly helps make the adventure practical before the trail begins.",
    cta: "Prepare the adventure with Roamly",
    overlays: [
      { start: 0, end: 7.2, title: "Plan hard.", subtitle: "Travel wild." },
      { start: 7.2, end: 14.6, title: "Weather windows matter.", subtitle: "So do transfers, layers, and recovery time." },
      { start: 14.6, end: 22, title: "Make the wild part easier.", subtitle: "Prepare the adventure with Roamly." }
    ],
    shots: [
      {
        source: "patagonia-adventure-source.png",
        duration: 7.2,
        zoom: "1.015+0.00015*on",
        x: "(iw-iw/zoom)/2-18*sin(on/115)",
        y: "(ih-ih/zoom)/2+20*cos(on/150)"
      },
      {
        source: "patagonia-lodge-planning-source.png",
        duration: 7.4,
        zoom: "1.032+0.00011*on",
        x: "(iw-iw/zoom)/2+14*cos(on/110)",
        y: "(ih-ih/zoom)/2-14*sin(on/120)"
      },
      {
        source: "patagonia-bridge-crossing-source.png",
        duration: 7.4,
        zoom: "1.012+0.00016*on",
        x: "(iw-iw/zoom)/2+10*sin(on/140)",
        y: "(ih-ih/zoom)/2+16*cos(on/115)"
      }
    ],
    audio: "expansive cinematic outdoor pulse",
    hashtags: ["Roamly", "Patagonia", "AdventureTravel", "HikingTrip", "TravelPrep"],
    grade: "eq=contrast=1.09:saturation=1.06:brightness=-0.018,vignette=PI/4.7"
  },
  {
    slug: "copenhagen-city-break",
    output: "roamly-showcase-003-copenhagen-city-break.mp4",
    thumb: "roamly-showcase-003-copenhagen-city-break.jpg",
    duration: 19,
    destination: "Copenhagen",
    theme: "City Break",
    hook: "Pick a city. Then pick a pace.",
    caption:
      "Copenhagen rewards travelers who balance design shops, bakeries, bikes, transit, and one slow waterfront hour. Roamly shapes the city break so it feels curated, not crowded.",
    cta: "Shape your city break with Roamly",
    overlays: [
      { start: 0, end: 6.2, title: "Pick a city.", subtitle: "Then pick a pace." },
      { start: 6.2, end: 12.5, title: "Bakeries. Bikes. Canals.", subtitle: "A city break should breathe." },
      { start: 12.5, end: 19, title: "Curated, not crowded.", subtitle: "Shape it with Roamly." }
    ],
    shots: [
      {
        source: "copenhagen-city-break-source.png",
        duration: 6.2,
        zoom: "1.018+0.00013*on",
        x: "(iw-iw/zoom)/2+16*cos(on/120)",
        y: "(ih-ih/zoom)/2+12*sin(on/105)"
      },
      {
        source: "copenhagen-bike-transit-source.png",
        duration: 6.3,
        zoom: "1.024+0.00012*on",
        x: "(iw-iw/zoom)/2-12*sin(on/118)",
        y: "(ih-ih/zoom)/2+10*cos(on/132)"
      },
      {
        source: "copenhagen-waterfront-source.png",
        duration: 6.5,
        zoom: "1.016+0.00013*on",
        x: "(iw-iw/zoom)/2+12*cos(on/130)",
        y: "(ih-ih/zoom)/2-12*sin(on/112)"
      }
    ],
    audio: "clean Nordic city-pop texture",
    hashtags: ["Roamly", "Copenhagen", "CityBreak", "ScandinavianTravel", "TravelPlanning"],
    grade: "eq=contrast=1.07:saturation=1.035:brightness=-0.006,vignette=PI/5.2"
  }
];

function xml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function wrap(value, maxChars, maxLines) {
  const words = String(value).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
    if (lines.length === maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines;
}

function tspans(lines, x, y, size, gap, color, weight = 850) {
  return lines
    .map(
      (line, index) =>
        `<tspan x="${x}" y="${y + index * gap}" font-size="${size}" font-weight="${weight}" fill="${color}">${xml(line)}</tspan>`
    )
    .join("");
}

function overlaySvg(reel, card) {
  const titleLines = wrap(card.title, 18, 3);
  const subtitleLines = wrap(card.subtitle, 28, 2);
  const destination = `${reel.destination.toUpperCase()} / ${reel.theme.toUpperCase()}`;
  return Buffer.from(`
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#000000" stop-opacity="0.16"/>
          <stop offset="0.47" stop-color="#000000" stop-opacity="0"/>
          <stop offset="1" stop-color="#000000" stop-opacity="0.60"/>
        </linearGradient>
        <filter id="softShadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="16" stdDeviation="22" flood-color="#000000" flood-opacity="0.32"/>
        </filter>
      </defs>
      <rect width="${width}" height="${height}" fill="url(#shade)"/>
      <rect x="68" y="72" width="210" height="58" rx="29" fill="#ffffff" fill-opacity="0.92"/>
      <text x="96" y="110" font-family="Arial, Helvetica, sans-serif" font-size="21" font-weight="900" letter-spacing="4" fill="#102027">ROAMLY</text>
      <text x="72" y="158" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="800" letter-spacing="3" fill="#ffffff" fill-opacity="0.86">${xml(destination)}</text>
      <g filter="url(#softShadow)">
        <text font-family="Arial, Helvetica, sans-serif">${tspans(titleLines, 72, 1390, 70, 78, "#ffffff", 900)}</text>
        <text font-family="Arial, Helvetica, sans-serif">${tspans(subtitleLines, 76, 1628, 31, 45, "#f3f7f5", 760)}</text>
      </g>
      <rect x="72" y="1774" width="936" height="5" rx="2.5" fill="#ffffff" fill-opacity="0.36"/>
      <rect x="72" y="1774" width="${Math.max(120, Math.round(936 * (card.end / reel.duration)))}" height="5" rx="2.5" fill="#ffffff"/>
    </svg>
  `);
}

async function makeOverlay(reel, card, index) {
  const file = path.join(dirs.overlays, `${reel.slug}-${index + 1}.png`);
  await sharp(overlaySvg(reel, card)).png().toFile(file);
  return file;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => {
      if (code === 0) resolve({ stderr });
      else reject(new Error(stderr || `${command} exited with ${code}`));
    });
  });
}

async function buildReel(reel) {
  const shots = reel.shots || [{ source: reel.source, duration: reel.duration, zoom: reel.zoom, x: reel.x, y: reel.y }];
  for (const shot of shots) await stat(path.join(dirs.sources, shot.source));
  const output = path.join(dirs.previews, reel.output);
  const thumb = path.join(dirs.thumbs, reel.thumb);
  const overlays = [];
  for (let i = 0; i < reel.overlays.length; i += 1) overlays.push(await makeOverlay(reel, reel.overlays[i], i));

  const shotFilters = shots.map((shot, index) => {
    const frames = Math.round(shot.duration * fps);
    const overlayInput = shots.length + index;
    return `[${index}:v]scale=2160:3840:force_original_aspect_ratio=increase,crop=2160:3840,zoompan=z='${shot.zoom}':x='${shot.x}':y='${shot.y}':d=${frames}:s=${width}x${height}:fps=${fps},${reel.grade},format=rgba[base${index}];[base${index}][${overlayInput}:v]overlay=0:0,trim=duration=${shot.duration},setpts=PTS-STARTPTS[shot${index}]`;
  });
  const filter = [
    ...shotFilters,
    `${shots.map((_, index) => `[shot${index}]`).join("")}concat=n=${shots.length}:v=1:a=0[vout]`
  ].join(";");

  const audio = `aevalsrc='0.020*sin(2*PI*146.83*t)+0.014*sin(2*PI*220*t)+0.010*sin(2*PI*293.66*t)':s=44100:d=${reel.duration}`;
  const args = [
    "-y",
    ...shots.flatMap((shot) => ["-loop", "1", "-i", path.join(dirs.sources, shot.source)]),
    ...overlays.flatMap((file) => ["-i", file]),
    "-f",
    "lavfi",
    "-i",
    audio,
    "-filter_complex",
    filter,
    "-map",
    "[vout]",
    "-map",
    `${shots.length + overlays.length}:a`,
    "-t",
    String(reel.duration),
    "-c:v",
    "libx264",
    "-profile:v",
    "high",
    "-level",
    "4.1",
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(fps),
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-af",
    `volume=0.46,afade=t=in:st=0:d=1.1,afade=t=out:st=${Math.max(0, reel.duration - 1.4)}:d=1.4`,
    "-movflags",
    "+faststart",
    output
  ];
  await run(ffmpegInstaller.path, args);
  await run(ffmpegInstaller.path, ["-y", "-ss", "00:00:04.000", "-i", output, "-vframes", "1", "-q:v", "2", thumb]);
  return { output, thumb };
}

async function main() {
  await Promise.all(Object.values(dirs).map((dir) => mkdir(dir, { recursive: true })));
  await rm(dirs.overlays, { recursive: true, force: true });
  await mkdir(dirs.overlays, { recursive: true });

  const built = [];
  for (const reel of reels) {
    built.push({ ...reel, ...(await buildReel(reel)) });
  }
  console.log(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        count: built.length,
        reels: built.map((reel) => ({
          slug: reel.slug,
          destination: reel.destination,
          theme: reel.theme,
          duration: reel.duration,
          output: path.relative(root, reel.output),
          thumbnail: path.relative(root, reel.thumb),
          sources: (reel.shots || []).map((shot) => path.relative(root, path.join(dirs.sources, shot.source))),
          hook: reel.hook,
          caption: reel.caption,
          cta: reel.cta,
          storyboard: reel.overlays,
          musicDirection: reel.audio,
          hashtags: reel.hashtags
        }))
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
