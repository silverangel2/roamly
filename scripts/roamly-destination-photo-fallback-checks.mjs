// roamly-destination-photo-fallback-checks.mjs — PHOTO-FALLBACK chain
// proofs (2026-11-03, LOCAL ONLY). Runtime checks against the tree's
// own lib/roamly/destinationPhoto.ts with globalThis.fetch stubbed by
// URL: no network, no live Wikidata / Commons / OSM / Openverse, and
// (except the cache test) NO Supabase env, so createSupabaseAdminClient
// returns null and the settings cache is skipped. The cache test sets
// stub Supabase env vars and emulates the PostgREST select/upsert for
// roamly_admin_settings inside the same fetch stub.
// Usage:
//   node --experimental-strip-types --import ./scripts/roamly-test-register.mjs scripts/roamly-destination-photo-fallback-checks.mjs

for (const key of [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY"
]) {
  delete process.env[key];
}

const { getDestinationPhoto } = await import("@/lib/roamly/destinationPhoto.ts");
const { createSupabaseAdminClient } = await import("@/lib/supabase/admin.ts");

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

// ---------------------------------------------------------------- stub
const calls = [];
let scenario = () => null;

const jsonResponse = (value, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

const imageInfo = (file, artist = "Stub Artist", license = "CC BY 4.0") => ({
  thumburl: `https://img.test/thumb/${file}`,
  url: `https://img.test/full/${file}`,
  descriptionurl: `https://commons.wikimedia.org/wiki/File:${file}`,
  extmetadata: { Artist: { value: artist }, LicenseShortName: { value: license } }
});

// Commons imageinfo endpoint (non-geosearch): answer from the titles=
// param so any tier that resolves a file name gets a real-shaped info.
function commonsImageInfoResponse(url) {
  const match = url.match(/titles=([^&]+)/);
  const file = match ? decodeURIComponent(match[1]).replace(/^File:/, "") : "Unknown.jpg";
  return jsonResponse({ query: { pages: { "1": { title: `File:${file}`, imageinfo: [imageInfo(file)] } } } });
}

// Default routes: every well is dry (Tier 0 miss, no Openverse hits).
function baseRoute(url) {
  if (url.includes("wikidata.org") && url.includes("wbsearchentities")) return jsonResponse({ search: [] });
  if (url.includes("wikidata.org") && url.includes("wbgetentities")) return jsonResponse({ entities: {} });
  if (url.includes("wikidata.org") && url.includes("list=geosearch")) return jsonResponse({ query: { geosearch: [] } });
  if (url.includes("commons.wikimedia.org") && url.includes("generator=geosearch")) {
    return jsonResponse({ query: { pages: {} } });
  }
  if (url.includes("commons.wikimedia.org")) return commonsImageInfoResponse(url);
  if (url.startsWith("https://api.openverse.org/")) return jsonResponse({ results: [] });
  return null;
}

function route(overrides) {
  return (url, opts, method) => overrides(url, opts, method) ?? baseRoute(url);
}

// ------------------------------------------------------- Supabase stub
const SUPABASE_HOST = "https://stub.supabase.test";
const settingsStore = new Map();
function supabaseStub(url, opts, method) {
  const parsed = new URL(url);
  if (method === "GET") {
    const keyParam = parsed.searchParams.get("key") || "";
    if (keyParam.startsWith("like.")) return jsonResponse([]);
    if (keyParam.startsWith("eq.")) {
      const row = settingsStore.get(keyParam.slice(3));
      return jsonResponse(row ? [{ value: row.value }] : []);
    }
    return jsonResponse([]);
  }
  if (method === "POST") {
    let body = null;
    try {
      body = JSON.parse(opts.body || "null");
    } catch {
      body = null;
    }
    for (const row of Array.isArray(body) ? body : [body]) {
      if (row && typeof row.key === "string") settingsStore.set(row.key, { key: row.key, value: row.value });
    }
    return new Response(null, { status: 201 });
  }
  return new Response("unstubbed supabase call", { status: 404 });
}

globalThis.fetch = async (url, opts = {}) => {
  const text = String(url);
  const method = String(opts.method || "GET").toUpperCase();
  calls.push({ url: text, method });
  if (text.startsWith(SUPABASE_HOST)) return supabaseStub(text, opts, method);
  const routed = await scenario(text, opts, method);
  if (routed) return routed;
  return new Response("unstubbed", { status: 404 });
};

const callsTo = (needle) => calls.filter((call) => call.url.includes(needle));
const PLACE = { lat: 45.5, lon: -73.5 };
const NORTH_80M = { lat: 45.50072, lon: -73.5 };
const NORTH_900M = { lat: 45.5081, lon: -73.5 };

check("no supabase env -> admin client null (cache skipped)", createSupabaseAdminClient() === null);

// ------------------------------------------------------- Tier 0 short-circuit
{
  calls.length = 0;
  scenario = route((url) => {
    if (url.includes("wikidata.org") && url.includes("wbsearchentities")) {
      return jsonResponse({ search: [{ id: "Q1" }] });
    }
    if (url.includes("wikidata.org") && url.includes("wbgetentities")) {
      return jsonResponse({
        entities: {
          Q1: {
            labels: { en: { value: "Harbour Test Museum" }, fr: { value: "Harbour Test Museum" } },
            descriptions: { en: { value: "museum in Canada" } },
            claims: {
              P18: [{ mainsnak: { datavalue: { value: "Harbour Test Museum.jpg" } } }],
              P625: [{ mainsnak: { datavalue: { value: { latitude: PLACE.lat, longitude: PLACE.lon } } } }]
            }
          }
        }
      });
    }
    return null;
  });
  const photo = await getDestinationPhoto({
    label: "Harbour Test Museum",
    country: "Canada",
    latitude: PLACE.lat,
    longitude: PLACE.lon,
    osmId: "node/4242",
    contextLabel: "Montreal"
  });
  check("tier0 hit resolves as wikimedia-commons", photo?.source === "wikimedia-commons", JSON.stringify(photo));
  check(
    "tier0 hit performs no geosearch/OSM/Openverse fetch",
    callsTo("geosearch").length === 0 &&
      callsTo("openstreetmap.org/api").length === 0 &&
      callsTo("api.openverse.org").length === 0,
    calls.map((c) => c.url).join(" | ")
  );
}

// ------------------------------------------------------- Tier 1: ~80 m file accepted
{
  calls.length = 0;
  scenario = route((url) => {
    if (url.includes("commons.wikimedia.org") && url.includes("generator=geosearch")) {
      const radius = new URL(url).searchParams.get("ggsradius");
      if (radius === "250") {
        return jsonResponse({
          query: {
            pages: {
              "11": {
                title: "File:Harbour Test Museum front.jpg",
                coordinates: [{ lat: NORTH_80M.lat, lon: NORTH_80M.lon }],
                categories: [],
                imageinfo: [imageInfo("Harbour Test Museum front.jpg", "Geo Artist", "CC BY 4.0")]
              }
            }
          }
        });
      }
      return jsonResponse({ query: { pages: {} } });
    }
    return null;
  });
  const photo = await getDestinationPhoto({
    label: "Harbour Test Museum",
    country: "Canada",
    latitude: PLACE.lat,
    longitude: PLACE.lon,
    contextLabel: "Montreal"
  });
  check(
    "tier1 file at ~80m accepted as wikimedia-commons-geosearch",
    photo?.source === "wikimedia-commons-geosearch" && photo?.credit === "Geo Artist · CC BY 4.0",
    JSON.stringify(photo)
  );
  check("tier1 pass-1 hit never widens to the 1000m pass", callsTo("ggsradius=1000").length === 0);
}

// ------------------------------------------------------- Tier 1: pass-2 name gate
{
  const geoAt900 = (title) => (url) => {
    if (url.includes("commons.wikimedia.org") && url.includes("generator=geosearch")) {
      const radius = new URL(url).searchParams.get("ggsradius");
      if (radius === "1000") {
        return jsonResponse({
          query: {
            pages: {
              "12": {
                title,
                coordinates: [{ lat: NORTH_900M.lat, lon: NORTH_900M.lon }],
                categories: [],
                imageinfo: [imageInfo(title.replace(/^File:/, ""))]
              }
            }
          }
        });
      }
      return jsonResponse({ query: { pages: {} } });
    }
    return null;
  };
  calls.length = 0;
  scenario = route(geoAt900("File:Random waterfront.jpg"));
  const rejected = await getDestinationPhoto({
    label: "Harbour Test Museum",
    country: "Canada",
    latitude: PLACE.lat,
    longitude: PLACE.lon,
    contextLabel: "Montreal"
  });
  check(
    "tier1 pass-2 file at ~900m without a name token rejected",
    rejected === null && callsTo("ggsradius=1000").length > 0 && callsTo("api.openverse.org").length > 0,
    JSON.stringify(rejected)
  );

  calls.length = 0;
  scenario = route(geoAt900("File:Harbour Test Museum pier.jpg"));
  const accepted = await getDestinationPhoto({
    label: "Harbour Test Museum",
    country: "Canada",
    latitude: PLACE.lat,
    longitude: PLACE.lon,
    contextLabel: "Montreal"
  });
  check(
    "tier1 pass-2 file at ~900m with a name token accepted",
    accepted?.source === "wikimedia-commons-geosearch",
    JSON.stringify(accepted)
  );
}

// ------------------------------------------------------- Tier 1: pass-2 generic-token gate (X04, 2026-11-03)
{
  // Beaconsfield Historic House, Charlottetown (coverage-log §3, X04).
  const BEACONSFIELD = { lat: 46.2318813, lon: -63.133517 };
  // The wrong house's own coordinates from the coverage log:
  // ~500 m away (inside 1000 m, outside 250 m), a different house.
  const WRONG_HOUSE = { lat: 46.23001, lon: -63.127655 };
  // ~600 m north of the place: inside pass 2, outside pass 1.
  const RIGHT_HOUSE = { lat: 46.2372813, lon: -63.133517 };

  const beaconsfieldRoute = (pass2Title, pass2Coords) =>
    route((url) => {
      if (url.includes("commons.wikimedia.org") && url.includes("generator=geosearch")) {
        const radius = new URL(url).searchParams.get("ggsradius");
        if (radius === "1000") {
          return jsonResponse({
            query: {
              pages: {
                "21": {
                  title: pass2Title,
                  coordinates: [{ lat: pass2Coords.lat, lon: pass2Coords.lon }],
                  categories: [],
                  imageinfo: [imageInfo(pass2Title.replace(/^File:/, ""))]
                }
              }
            }
          });
        }
        return jsonResponse({ query: { pages: {} } });
      }
      if (url.startsWith("https://api.openverse.org/")) {
        return new Response("blocked", { status: 403 });
      }
      return null;
    });

  calls.length = 0;
  scenario = beaconsfieldRoute("File:Charlottetown historic house 01.jpg", WRONG_HOUSE);
  const wrong = await getDestinationPhoto({
    label: "Beaconsfield Historic House",
    country: "Canada",
    latitude: BEACONSFIELD.lat,
    longitude: BEACONSFIELD.lon,
    contextLabel: "Charlottetown"
  });
  check(
    "tier1 pass-2 wrong-house file sharing only generic tokens (historic/house) rejected -> null",
    wrong === null && callsTo("ggsradius=1000").length > 0 && callsTo("api.openverse.org").length > 0,
    JSON.stringify(wrong)
  );

  calls.length = 0;
  scenario = beaconsfieldRoute("File:Beaconsfield House, Charlottetown.jpg", RIGHT_HOUSE);
  const right = await getDestinationPhoto({
    label: "Beaconsfield Historic House",
    country: "Canada",
    latitude: BEACONSFIELD.lat,
    longitude: BEACONSFIELD.lon,
    contextLabel: "Charlottetown"
  });
  check(
    "tier1 pass-2 right-house file sharing distinctive token (beaconsfield) at ~600m accepted",
    right?.source === "wikimedia-commons-geosearch",
    JSON.stringify(right)
  );
}

// ------------------------------------------------------- Tier 1: pass-2 empty-distinctive full containment
{
  const nationalParkRoute = (pass2Title) =>
    route((url) => {
      if (url.includes("commons.wikimedia.org") && url.includes("generator=geosearch")) {
        const radius = new URL(url).searchParams.get("ggsradius");
        if (radius === "1000") {
          return jsonResponse({
            query: {
              pages: {
                "22": {
                  title: pass2Title,
                  coordinates: [{ lat: NORTH_900M.lat, lon: NORTH_900M.lon }],
                  categories: [],
                  imageinfo: [imageInfo(pass2Title.replace(/^File:/, ""))]
                }
              }
            }
          });
        }
        return jsonResponse({ query: { pages: {} } });
      }
      return null;
    });

  calls.length = 0;
  scenario = nationalParkRoute("File:National Park entrance.jpg");
  const full = await getDestinationPhoto({
    label: "National Park",
    country: "Canada",
    latitude: PLACE.lat,
    longitude: PLACE.lon,
    contextLabel: "Montreal"
  });
  check(
    "tier1 pass-2 all-generic name (National Park) with full title containment accepted",
    full?.source === "wikimedia-commons-geosearch",
    JSON.stringify(full)
  );

  calls.length = 0;
  scenario = nationalParkRoute("File:National entrance.jpg");
  const partial = await getDestinationPhoto({
    label: "National Park",
    country: "Canada",
    latitude: PLACE.lat,
    longitude: PLACE.lon,
    contextLabel: "Montreal"
  });
  check(
    "tier1 pass-2 all-generic name (National Park) with only one token rejected",
    partial === null,
    JSON.stringify(partial)
  );
}

// ------------------------------------------------------- Tier 1: coord-less files
{
  const coordLessPage = (url) => {
    if (url.includes("commons.wikimedia.org") && url.includes("generator=geosearch")) {
      return jsonResponse({
        query: {
          pages: {
            "13": {
              title: "File:Marché Sainte-Anne.jpg",
              categories: [{ title: "Category:Marché Sainte-Anne" }, { title: "Category:Montreal" }],
              imageinfo: [imageInfo("Marché Sainte-Anne.jpg", "Geo Artist", "CC BY-SA 4.0")]
            }
          }
        }
      });
    }
    return null;
  };
  calls.length = 0;
  scenario = route(coordLessPage);
  const accepted = await getDestinationPhoto({
    label: "Marché Sainte-Anne",
    country: "Canada",
    latitude: PLACE.lat,
    longitude: PLACE.lon,
    contextLabel: "Montreal"
  });
  check(
    "tier1 coord-less exact title + category context accepted",
    accepted?.source === "wikimedia-commons-geosearch",
    JSON.stringify(accepted)
  );

  calls.length = 0;
  scenario = route(coordLessPage);
  const rejected = await getDestinationPhoto({
    label: "Marché Sainte-Anne",
    country: null,
    latitude: PLACE.lat,
    longitude: PLACE.lon,
    contextLabel: null
  });
  check("tier1 coord-less exact title without any context rejected", rejected === null, JSON.stringify(rejected));
}

// ------------------------------------------------------- Tier 2: OSM element tags
const osmRoute = (tags, extra) =>
  route((url, opts, method) => {
    if (url.startsWith("https://www.openstreetmap.org/api/0.6/")) {
      return jsonResponse({ elements: [{ type: "node", id: 4242, tags }] });
    }
    return extra ? extra(url, opts, method) : null;
  });

{
  calls.length = 0;
  scenario = osmRoute({ wikimedia_commons: "File:Osm Tagged.jpg" });
  const photo = await getDestinationPhoto({ label: "Harbour Test Museum", country: "Canada", osmId: "node/4242" });
  check(
    "tier2 wikimedia_commons=File: resolves via imageinfo as openstreetmap-image with credit",
    photo?.source === "openstreetmap-image" && photo?.credit === "Stub Artist · CC BY 4.0",
    JSON.stringify(photo)
  );
  check("tier2 hit performs no Openverse fetch", callsTo("api.openverse.org").length === 0);
}

{
  calls.length = 0;
  scenario = osmRoute({ image: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Osm_Upload.jpg" });
  const photo = await getDestinationPhoto({ label: "Harbour Test Museum", country: "Canada", osmId: "node/4242" });
  check(
    "tier2 image= upload.wikimedia.org URL resolves via imageinfo as openstreetmap-image",
    photo?.source === "openstreetmap-image" && photo?.imageUrl === "https://img.test/thumb/Osm_Upload.jpg",
    JSON.stringify(photo)
  );

  calls.length = 0;
  scenario = osmRoute({
    image: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Osm_Thumb.jpg/320px-Osm_Thumb.jpg"
  });
  const thumbPhoto = await getDestinationPhoto({ label: "Harbour Test Museum", country: "Canada", osmId: "way/777" });
  check(
    "tier2 image= upload.wikimedia.org thumb URL resolves the real file",
    thumbPhoto?.source === "openstreetmap-image" && thumbPhoto?.imageUrl === "https://img.test/thumb/Osm_Thumb.jpg",
    JSON.stringify(thumbPhoto)
  );
}

{
  calls.length = 0;
  scenario = osmRoute({ image: "https://images.test/place.jpg" }, (url, opts, method) => {
    if (url === "https://images.test/place.jpg" && method === "HEAD") {
      return new Response(null, { status: 200, headers: { "content-type": "image/jpeg" } });
    }
    return null;
  });
  const photo = await getDestinationPhoto({ label: "Harbour Test Museum", country: "Canada", osmId: "node/4242" });
  check(
    "tier2 arbitrary image URL + image/jpeg HEAD accepted with credit null",
    photo?.source === "openstreetmap-image" &&
      photo?.imageUrl === "https://images.test/place.jpg" &&
      photo?.pageUrl === "https://www.openstreetmap.org/node/4242" &&
      photo?.credit === null,
    JSON.stringify(photo)
  );
}

{
  calls.length = 0;
  scenario = osmRoute({ image: "https://images.test/page.html" }, (url, opts, method) => {
    if (url === "https://images.test/page.html") {
      return new Response("<html></html>", {
        status: 200,
        headers: { "content-type": "text/html" }
      });
    }
    return null;
  });
  const photo = await getDestinationPhoto({ label: "Harbour Test Museum", country: "Canada", osmId: "node/4242" });
  check(
    "tier2 arbitrary URL returning text/html rejected, chain falls through",
    photo === null && callsTo("api.openverse.org").length > 0,
    JSON.stringify(photo)
  );
}

{
  calls.length = 0;
  scenario = osmRoute({ name: "Harbour Test Museum" }, (url) => {
    if (url.startsWith("https://api.openverse.org/")) {
      return jsonResponse({
        results: [
          {
            title: "Harbour Test Museum",
            license: "cc0",
            url: "https://img.test/ov.jpg",
            thumbnail: "https://img.test/ov-thumb.jpg",
            foreign_landing_url: "https://src.test/harbour",
            tags: []
          }
        ]
      });
    }
    return null;
  });
  const photo = await getDestinationPhoto({ label: "Harbour Test Museum", country: "Canada", osmId: "node/4242" });
  check(
    "tier2 element with no image tags -> null and chain proceeds to tier 3",
    photo?.source === "openverse" && callsTo("openstreetmap.org/api").length > 0,
    JSON.stringify(photo)
  );
}

// ------------------------------------------------------- Tier 3: Openverse gates
const openverseRoute = (items) =>
  route((url) => {
    if (url.startsWith("https://api.openverse.org/")) return jsonResponse({ results: items });
    return null;
  });

{
  scenario = openverseRoute([
    {
      title: "Harbour Test Museum",
      license: "by-nc",
      license_version: "4.0",
      creator: "NC Creator",
      url: "https://img.test/nc.jpg",
      thumbnail: "https://img.test/nc-thumb.jpg",
      foreign_landing_url: "https://src.test/nc",
      tags: [{ name: "Montreal" }]
    }
  ]);
  const photo = await getDestinationPhoto({ label: "Harbour Test Museum", country: "Canada", contextLabel: "Montreal" });
  check("tier3 item with license by-nc rejected (licence re-verified)", photo === null, JSON.stringify(photo));
}

{
  scenario = openverseRoute([
    {
      title: "A lovely harbour scene",
      license: "by",
      license_version: "4.0",
      creator: "Tag Matcher",
      url: "https://img.test/scene.jpg",
      thumbnail: "https://img.test/scene-thumb.jpg",
      foreign_landing_url: "https://src.test/scene",
      tags: [{ name: "test" }, { name: "museum" }, { name: "Montreal" }]
    }
  ]);
  const photo = await getDestinationPhoto({ label: "Harbour Test Museum", country: "Canada" });
  check("tier3 name match via tags only + no contextLabel rejected", photo === null, JSON.stringify(photo));
}

{
  scenario = openverseRoute([
    {
      title: "Harbour Test Museum in the old port",
      license: "by",
      license_version: "4.0",
      creator: "Test Creator",
      url: "https://img.test/h.jpg",
      thumbnail: "https://img.test/h-thumb.jpg",
      foreign_landing_url: "https://src.test/harbour",
      tags: [{ name: "Montreal" }]
    }
  ]);
  const photo = await getDestinationPhoto({ label: "Harbour Test Museum", country: "Canada", contextLabel: "Montreal" });
  check(
    "tier3 name in title + context token in tags accepted, credit shaped 'Creator · CC BY 4.0'",
    photo?.source === "openverse" &&
      photo?.credit === "Test Creator · CC BY 4.0" &&
      photo?.imageUrl === "https://img.test/h-thumb.jpg" &&
      photo?.pageUrl === "https://src.test/harbour",
    JSON.stringify(photo)
  );
}

{
  scenario = openverseRoute([
    {
      title: "Harbour Test Museum",
      license: "cc0",
      url: "https://img.test/cc0.jpg",
      thumbnail: "https://img.test/cc0-thumb.jpg",
      foreign_landing_url: "https://src.test/montreal/harbour",
      tags: []
    }
  ]);
  const photo = await getDestinationPhoto({ label: "Harbour Test Museum", country: "Canada", contextLabel: "Montreal" });
  check(
    "tier3 cc0 item accepted with credit CC0 (context via landing URL)",
    photo?.source === "openverse" && photo?.credit === "CC0",
    JSON.stringify(photo)
  );
}

// ------------------------------------------------------- Cache non-promotion
{
  process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_HOST;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-stub";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-stub";
  check("stub supabase env -> admin client present", createSupabaseAdminClient() !== null);
  settingsStore.clear();
  scenario = openverseRoute([
    {
      title: "Cache Test Falls",
      license: "cc0",
      url: "https://img.test/falls.jpg",
      thumbnail: "https://img.test/falls-thumb.jpg",
      foreign_landing_url: "https://src.test/falls",
      tags: [{ name: "Montreal" }]
    }
  ]);
  calls.length = 0;
  const first = await getDestinationPhoto({ label: "Cache Test Falls", country: "Canada", contextLabel: "Montreal" });
  check("cache: first call resolves via tier 3 as openverse", first?.source === "openverse", JSON.stringify(first));
  const stored = [...settingsStore.values()].find((row) => row.value && typeof row.value === "object" && "imageUrl" in row.value);
  check(
    "cache: stored record keeps source openverse",
    stored?.value?.source === "openverse",
    JSON.stringify(stored?.value ?? null)
  );
  const openverseCallsBefore = callsTo("api.openverse.org").length;
  const second = await getDestinationPhoto({ label: "Cache Test Falls", country: "Canada", contextLabel: "Montreal" });
  check(
    "cache: second call returns cached photo still labelled openverse (no re-fetch)",
    second?.source === "openverse" &&
      second?.imageUrl === first?.imageUrl &&
      callsTo("api.openverse.org").length === openverseCallsBefore,
    JSON.stringify(second)
  );
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log(`FAILED: ${failed.map((r) => r.name).join(", ")}`);
  process.exit(1);
}
