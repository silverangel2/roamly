import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const baseUrl = process.env.ROAMLY_PROOF_BASE_URL || "http://127.0.0.1:3001";
const browserVersionUrl = process.env.ROAMLY_CDP_VERSION_URL || "http://127.0.0.1:9223/json/version";
const cookiePath = process.env.ROAMLY_SESSION_COOKIES || "/tmp/roamly-session-cookies.json";
const outputDir = process.env.ROAMLY_PROOF_DIR || "/tmp/roamly-proof";
const tripId = process.env.ROAMLY_PROOF_TRIP_ID || "f5657edb-680c-42cb-87e9-272b3830da83";
const tripUrl = `${baseUrl}/trip/${tripId}`;

const blockedDomains = ["w3.org", "schema.org", "schemas.live.com", "ogp.me", "json-ld.org"];

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    this.socket.addEventListener("message", (event) => this.onMessage(event));
  }

  onMessage(event) {
    const message = JSON.parse(String(event.data));
    if (message.id && this.pending.has(message.id)) {
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(`${message.error.message}: ${message.error.data || ""}`));
      else resolve(message.result || {});
      return;
    }
    this.events.push(message);
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId;
    this.nextId += 1;
    const payload = sessionId ? { id, method, params, sessionId } : { id, method, params };
    this.socket.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 30000).unref();
    });
  }

  close() {
    this.socket.close();
  }
}

async function connect() {
  const version = await fetch(browserVersionUrl).then((response) => response.json());
  const socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  return { browser: version.Browser, client: new CdpClient(socket) };
}

async function evaluate(client, sessionId, expression) {
  const result = await client.send(
    "Runtime.evaluate",
    {
      expression,
      awaitPromise: true,
      returnByValue: true
    },
    sessionId
  );
  if (result.exceptionDetails) {
    throw new Error(`Runtime exception: ${JSON.stringify(result.exceptionDetails)}`);
  }
  return result.result?.value;
}

async function waitFor(client, sessionId, expression, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await evaluate(client, sessionId, expression).catch(() => false);
    if (value) return;
    await sleep(250);
  }
  throw new Error(`Timed out waiting for expression: ${expression}`);
}

async function setViewport(client, sessionId, width, height, mobile = false) {
  await client.send(
    "Emulation.setDeviceMetricsOverride",
    {
      width,
      height,
      deviceScaleFactor: mobile ? 2 : 1,
      mobile
    },
    sessionId
  );
}

async function saveScreenshot(client, sessionId, fileName) {
  const screenshot = await client.send(
    "Page.captureScreenshot",
    {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false
    },
    sessionId
  );
  const filePath = path.join(outputDir, fileName);
  await fs.writeFile(filePath, Buffer.from(screenshot.data, "base64"));
  return filePath;
}

async function extractBookingProof(client, sessionId) {
  return evaluate(
    client,
    sessionId,
    `(() => {
      const blocked = ${JSON.stringify(blockedDomains)};
      const section = document.querySelector("#bookings");
      const sectionText = section ? section.innerText : "";
      const sectionLower = sectionText.toLowerCase();
      function outboundHref(href) {
        try {
          const url = new URL(href, location.origin);
          return url.searchParams.get("destinationUrl") || url.searchParams.get("affiliateUrl") || url.href;
        } catch {
          return href;
        }
      }
      function linkProof(link) {
        const targetHref = outboundHref(link.href);
        let host = "";
        let hrefHost = "";
        let hrefPath = "";
        let affiliateHost = "";
        let affiliatePath = "";
        let affiliateAddress = "";
        let hasAffiliateUrl = false;
        let hasDestinationUrl = false;
        let hasCheckin = false;
        let hasCheckout = false;
        let hasGuests = false;
        let directBookingHost = false;
        try { host = new URL(targetHref).hostname.replace(/^www\\./, "").toLowerCase(); } catch {}
        try {
          const hrefUrl = new URL(link.href, location.origin);
          hrefHost = hrefUrl.hostname.replace(/^www\\./, "").toLowerCase();
          hrefPath = hrefUrl.pathname;
          const affiliateUrl = hrefUrl.searchParams.get("affiliateUrl") || "";
          const destinationUrl = hrefUrl.searchParams.get("destinationUrl") || "";
          hasAffiliateUrl = Boolean(affiliateUrl);
          hasDestinationUrl = Boolean(destinationUrl);
          directBookingHost = hrefUrl.hostname.replace(/^www\\./, "").toLowerCase() === "booking.com";
          if (affiliateUrl) {
            const parsedAffiliate = new URL(affiliateUrl);
            affiliateHost = parsedAffiliate.hostname.replace(/^www\\./, "").toLowerCase();
            affiliatePath = parsedAffiliate.pathname;
            affiliateAddress = parsedAffiliate.searchParams.get("address") || "";
            hasCheckin = parsedAffiliate.searchParams.has("checkin");
            hasCheckout = parsedAffiliate.searchParams.has("checkout");
            hasGuests = parsedAffiliate.searchParams.has("guests");
          }
        } catch {}
        return { text: link.innerText.trim(), href: link.href, targetHref, host, hrefHost, hrefPath, affiliateHost, affiliatePath, affiliateAddress, hasAffiliateUrl, hasDestinationUrl, hasCheckin, hasCheckout, hasGuests, directBookingHost };
      }
      const links = Array.from(section ? section.querySelectorAll("a[href]") : []).map((link) => {
        return linkProof(link);
      });
      const cards = Array.from(section ? section.querySelectorAll("article") : []).map((card) => {
        const group = card.closest("section")?.querySelector(":scope > h3")?.textContent?.trim() || "";
        const title = card.querySelector("h3, h4")?.textContent?.trim() || "";
        const text = card.innerText.trim();
        const cardLinks = Array.from(card.querySelectorAll("a[href]")).map((link) => {
          return linkProof(link);
        });
        return { group, title, text, links: cardLinks };
      });
      return {
        url: location.href,
        title: document.title,
        bodySample: document.body.innerText.slice(0, 1000),
        sectionText,
        invalidDomains: blocked.filter((domain) =>
          sectionLower.includes(domain) || links.some((link) => link.href.toLowerCase().includes(domain))
        ),
        disabledUnavailableButtonPresent: /search link unavailable/i.test(sectionText),
        cards,
        links,
        hotelTitles: cards.filter((card) => card.group === "Hotels").map((card) => card.title),
        hotelLinkHosts: links.filter((link) => /hotel|stay/i.test(link.text)).map((link) => link.host),
        hotelCardLinks: cards
          .filter((card) => card.group === "Hotels")
          .map((card) => ({
            title: card.title,
            links: card.links
          })),
        stay22HotelLinks: cards
          .filter((card) => card.group === "Hotels")
          .flatMap((card) => card.links)
          .filter((link) => link.host.includes("stay22.com")),
        flightLinks: cards
          .filter((card) => card.group === "Flights" || /flight/i.test(card.title))
          .flatMap((card) => card.links),
        activityLinks: cards
          .filter((card) => /activit|tour|attraction/i.test(card.group))
          .flatMap((card) => card.links),
        stay22AsHotelIdentity: cards.some((card) => card.group === "Hotels" && /^stay22$/i.test(card.title)),
        pageLooksAuthenticated: !/log in|sign in/i.test(document.body.innerText)
      };
    })()`
  );
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true });
  const { browser, client } = await connect();
  const target = await client.send("Target.createTarget", { url: "about:blank" });
  const attached = await client.send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
  const sessionId = attached.sessionId;
  const cookiePayload = JSON.parse(await fs.readFile(cookiePath, "utf8"));
  const cookies = (cookiePayload.cookies || []).map((cookie) => ({
    name: cookie.name,
    value: cookie.value,
    url: baseUrl
  }));

  await client.send("Runtime.enable", {}, sessionId);
  await client.send("Page.enable", {}, sessionId);
  await client.send("Network.enable", {}, sessionId);
  await client.send("Network.setCookies", { cookies }, sessionId);
  await setViewport(client, sessionId, 1440, 1200);
  await client.send("Page.navigate", { url: tripUrl }, sessionId);
  await waitFor(client, sessionId, "document.readyState === 'complete'");
  await waitFor(client, sessionId, "document.body && /Vancouver|Bookings|Recommended bookings/.test(document.body.innerText)");
  await evaluate(
    client,
    sessionId,
    `(() => {
      document.querySelector('label[for="roamly-tab-bookings"]')?.click();
      document.querySelector("#bookings")?.scrollIntoView({ block: "start" });
      return true;
    })()`
  );
  await sleep(750);
  const desktopScreenshot = await saveScreenshot(client, sessionId, "desktop-bookings.png");
  const bookingProof = await extractBookingProof(client, sessionId);

  await setViewport(client, sessionId, 390, 900, true);
  await evaluate(
    client,
    sessionId,
    `(() => {
      document.querySelector('label[for="roamly-tab-bookings"]')?.click();
      document.querySelector("#bookings")?.scrollIntoView({ block: "start" });
      return true;
    })()`
  );
  await sleep(750);
  const mobileScreenshot = await saveScreenshot(client, sessionId, "mobile-bookings.png");

  const pdf = await client.send(
    "Page.printToPDF",
    {
      printBackground: true,
      preferCSSPageSize: true,
      paperWidth: 8.5,
      paperHeight: 11,
      marginTop: 0,
      marginBottom: 0,
      marginLeft: 0,
      marginRight: 0
    },
    sessionId
  );
  const pdfPath = path.join(outputDir, "vancouver-4day-itinerary.pdf");
  await fs.writeFile(pdfPath, Buffer.from(pdf.data, "base64"));

  assert.equal(bookingProof.pageLooksAuthenticated, true, "fixture page should render authenticated trip content");
  assert.deepEqual(bookingProof.invalidDomains, [], "bookings section must not render blocked metadata domains");
  assert.equal(bookingProof.disabledUnavailableButtonPresent, false, "bookings section must not render disabled unavailable search buttons");
  assert.equal(bookingProof.stay22AsHotelIdentity, false, "Stay22 must not be rendered as a hotel title");
  assert.equal(new Set(bookingProof.hotelTitles).size, 3, "bookings section must render three distinct real hotel suggestions");
  assert.ok(bookingProof.hotelTitles.some((title) => /YWCA Hotel Vancouver/i.test(title)), "YWCA Hotel Vancouver should render as a real hotel suggestion");
  assert.ok(bookingProof.hotelTitles.some((title) => /The Burrard/i.test(title)), "The Burrard should render as a real hotel suggestion");
  assert.ok(bookingProof.hotelTitles.some((title) => /Victorian Hotel Vancouver/i.test(title)), "Victorian Hotel Vancouver should render as a real hotel suggestion");
  bookingProof.hotelCardLinks.forEach((card) => {
    const bookingLinks = card.links.filter((link) => link.text && /hotel|option|view/i.test(link.text));
    assert.ok(bookingLinks.length, `${card.title} should render a booking action`);
    const tracked = bookingLinks.find((link) => link.hrefPath === "/api/roamly/affiliate/click");
    assert.ok(tracked, `${card.title} booking CTA must go through the Roamly affiliate click route`);
    assert.equal(tracked.hasAffiliateUrl, true, `${card.title} tracked CTA must preserve affiliateUrl`);
    assert.equal(tracked.hasDestinationUrl, true, `${card.title} tracked CTA must preserve destinationUrl`);
    assert.ok(/stay22\.com$/.test(tracked.affiliateHost) || tracked.affiliateHost.endsWith(".stay22.com"), `${card.title} affiliateUrl must remain a Stay22 URL`);
    assert.equal(tracked.directBookingHost, false, `${card.title} CTA must not be an untracked direct Booking.com replacement`);
    assert.ok(tracked.affiliateAddress.toLowerCase().includes(card.title.toLowerCase()), `${card.title} Stay22 URL must include the exact hotel context`);
    assert.ok(/vancouver/i.test(tracked.affiliateAddress), `${card.title} Stay22 URL must include destination context`);
    assert.equal(tracked.hasCheckin, true, `${card.title} Stay22 URL must preserve check-in date`);
    assert.equal(tracked.hasCheckout, true, `${card.title} Stay22 URL must preserve check-out date`);
    assert.equal(tracked.hasGuests, true, `${card.title} Stay22 URL must preserve guest count`);
  });

  const proof = {
    browser,
    baseUrl,
    tripId,
    generatedAt: new Date().toISOString(),
    desktopScreenshot,
    mobileScreenshot,
    pdfPath,
    bookingProof: {
      url: bookingProof.url,
      invalidDomains: bookingProof.invalidDomains,
      disabledUnavailableButtonPresent: bookingProof.disabledUnavailableButtonPresent,
      hotelTitles: bookingProof.hotelTitles,
      hotelLinkHosts: bookingProof.hotelLinkHosts,
      stay22HotelLinkCount: bookingProof.stay22HotelLinks.length,
      hotelCardLinks: bookingProof.hotelCardLinks.map((card) => ({
        title: card.title,
        trackedStay22LinkCount: card.links.filter((link) => link.hrefPath === "/api/roamly/affiliate/click" && (link.affiliateHost === "stay22.com" || link.affiliateHost.endsWith(".stay22.com"))).length,
        stay22AddressIncludesHotel: card.links.some((link) => link.affiliateAddress.toLowerCase().includes(card.title.toLowerCase())),
        stay22AddressIncludesDestination: card.links.some((link) => /vancouver/i.test(link.affiliateAddress)),
        preservesDatesAndGuests: card.links.some((link) => link.hasCheckin && link.hasCheckout && link.hasGuests),
        hasDirectBookingReplacement: card.links.some((link) => link.directBookingHost)
      })),
      flightLinkHosts: bookingProof.flightLinks.map((link) => link.host),
      activityLinkHosts: bookingProof.activityLinks.map((link) => link.host),
      stay22AsHotelIdentity: bookingProof.stay22AsHotelIdentity,
      cards: bookingProof.cards.map((card) => ({
        group: card.group,
        title: card.title,
        linkHosts: card.links.map((link) => link.host)
      }))
    }
  };
  const proofPath = path.join(outputDir, "proof.json");
  await fs.writeFile(proofPath, JSON.stringify(proof, null, 2));
  await client.send("Target.closeTarget", { targetId: target.targetId }).catch(() => {});
  client.close();
  console.info(JSON.stringify({ ok: true, proofPath, desktopScreenshot, mobileScreenshot, pdfPath }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
