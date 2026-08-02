#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const baseUrl = process.env.ROAMLY_QA_BASE_URL || "http://127.0.0.1:3000";
const browserCandidates = [
  process.env.ROAMLY_QA_BROWSER_PATH,
  "/Users/junel/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  "/Users/junel/Library/Caches/ms-playwright/chromium-1200/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
].filter(Boolean);

const widths = [320, 375, 390, 430];
const screens = [
  {
    name: "Plan Trip",
    path: "/plan",
    requiredText: ["Plan trip", "Tell Roamly", "Continue"]
  },
  {
    name: "Live Companion QA",
    path: "/admin/roamly/live-companion-test",
    requiredText: ["Live Companion QA", "Mobile preview", "notification"]
  },
  {
    name: "Live Companion QA itinerary preview",
    path: "/admin/roamly/live-companion-test",
    setupExpression: `(() => {
      const button = Array.from(document.querySelectorAll("button")).find((item) => item.textContent?.trim() === "Itinerary");
      button?.click();
      return Boolean(button);
    })()`,
    requiredText: ["Day", "Itinerary"]
  },
  {
    name: "Live Companion QA generation preview",
    path: "/admin/roamly/live-companion-test",
    setupExpression: `(() => {
      const button = Array.from(document.querySelectorAll("button")).find((item) => item.textContent?.trim() === "Generation");
      button?.click();
      return Boolean(button);
    })()`,
    requiredText: ["Generation", "Outline", "Finalizing"]
  },
  {
    name: "Live Companion QA bookings preview",
    path: "/admin/roamly/live-companion-test",
    setupExpression: `(() => {
      const button = Array.from(document.querySelectorAll("button")).find((item) => item.textContent?.trim() === "Bookings");
      button?.click();
      return Boolean(button);
    })()`,
    requiredText: ["Bookings"]
  },
  {
    name: "Notifications",
    path: "/notifications",
    requiredText: ["Notifications"]
  },
  {
    name: "Account",
    path: "/account",
    requiredText: ["Account"]
  }
];

function absoluteUrl(path) {
  return new URL(path, baseUrl).toString();
}

function trimText(value, max = 180) {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function findBrowserPath() {
  const found = browserCandidates.find((candidate) => candidate && existsSync(candidate));
  if (!found) {
    throw new Error(
      `No Chromium-family browser found. Set ROAMLY_QA_BROWSER_PATH or install Playwright Chromium with "npx playwright install chromium".`
    );
  }
  return found;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, timeoutMs, label) {
  let timeout;
  return Promise.race([
    promise.finally(() => clearTimeout(timeout)),
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    })
  ]);
}

async function launchBrowser() {
  const executable = findBrowserPath();
  const userDataDir = await mkdtemp(join(tmpdir(), "roamly-mobile-ui-qa-"));
  const args = [
    "--headless=new",
    "--remote-debugging-port=0",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--no-first-run",
    "--no-default-browser-check",
    "--hide-scrollbars",
    "--mute-audio",
    `--user-data-dir=${userDataDir}`,
    "about:blank"
  ];
  const child = spawn(executable, args, { stdio: ["ignore", "pipe", "pipe"] });
  const wsUrl = await withTimeout(
    new Promise((resolve, reject) => {
      let settled = false;
      const onData = (chunk) => {
        const match = String(chunk).match(/DevTools listening on (ws:\/\/\S+)/);
        if (match && !settled) {
          settled = true;
          resolve(match[1]);
        }
      };
      child.stdout.on("data", onData);
      child.stderr.on("data", onData);
      child.once("exit", (code, signal) => {
        if (!settled) reject(new Error(`Browser exited before DevTools was ready: code=${code} signal=${signal}`));
      });
      child.once("error", reject);
    }),
    15_000,
    "Browser startup"
  );

  return { child, userDataDir, wsUrl };
}

async function stopBrowser(browserProcess, userDataDir) {
  if (!browserProcess.killed) browserProcess.kill("SIGTERM");
  await delay(350);
  if (!browserProcess.killed) browserProcess.kill("SIGKILL");
  await rm(userDataDir, { recursive: true, force: true });
}

async function connectCdp(wsUrl) {
  const socket = new WebSocket(wsUrl);
  const pending = new Map();
  const waiters = [];
  let nextId = 1;

  await withTimeout(
    new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    }),
    10_000,
    "CDP websocket connection"
  );

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id && pending.has(message.id)) {
      const request = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message || "CDP command failed"));
      else request.resolve(message.result || {});
      return;
    }

    for (let index = 0; index < waiters.length; index += 1) {
      const waiter = waiters[index];
      if (waiter.method === message.method && (!waiter.sessionId || waiter.sessionId === message.sessionId)) {
        clearTimeout(waiter.timeout);
        waiters.splice(index, 1);
        waiter.resolve(message.params || {});
        return;
      }
    }
  });

  function send(method, params = {}, sessionId = undefined) {
    const id = nextId;
    nextId += 1;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    const result = new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`${method} timed out`));
        }
      }, 20_000);
    });
    socket.send(JSON.stringify(payload));
    return result;
  }

  function waitForEvent(method, sessionId, timeoutMs = 15_000) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const index = waiters.findIndex((waiter) => waiter.resolve === resolve);
        if (index >= 0) waiters.splice(index, 1);
        reject(new Error(`${method} timed out`));
      }, timeoutMs);
      waiters.push({ method, sessionId, timeout, resolve, reject });
    });
  }

  return {
    send,
    waitForEvent,
    close() {
      socket.close();
    }
  };
}

function classifyAccess(text, url) {
  if (url.includes("/login")) return "auth_redirect";
  if (text.includes("Roamly admin is protected")) return "admin_protected";
  if (text.includes("Connect Supabase")) return "setup_required";
  return "rendered";
}

async function evaluate(cdp, sessionId, expression) {
  const result = await cdp.send(
    "Runtime.evaluate",
    {
      expression,
      returnByValue: true,
      awaitPromise: true
    },
    sessionId
  );
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || "Runtime.evaluate failed");
  }
  return result.result?.value;
}

async function createPageSession(cdp) {
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Runtime.enable", {}, sessionId);
  return sessionId;
}

async function inspectScreen(cdp, sessionId, screen, width, colorScheme) {
  await cdp.send(
    "Emulation.setDeviceMetricsOverride",
    {
      width,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true
    },
    sessionId
  );
  await cdp.send(
    "Emulation.setEmulatedMedia",
    {
      media: "screen",
      features: [{ name: "prefers-color-scheme", value: colorScheme }]
    },
    sessionId
  );

  const load = cdp.waitForEvent("Page.loadEventFired", sessionId, 20_000).catch(() => null);
  await cdp.send("Page.navigate", { url: absoluteUrl(screen.path) }, sessionId);
  await load;
  await delay(1_000);
  if (screen.setupExpression) {
    await evaluate(cdp, sessionId, screen.setupExpression).catch(() => false);
    await delay(350);
  }

  const text = (await evaluate(cdp, sessionId, "document.body ? document.body.innerText : ''")) || "";
  const metrics = await evaluate(cdp, sessionId, `(() => {
    const interactive = Array.from(
      document.querySelectorAll("button, a, input, select, textarea, summary, [role='button'], [tabindex]")
    )
      .filter((element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      })
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const label =
          element.getAttribute("aria-label") ||
          element.textContent?.replace(/\s+/g, " ").trim() ||
          element.getAttribute("href") ||
          element.tagName;
        return {
          label: label?.slice(0, 80) || element.tagName,
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        };
      });
    const smallTargets = interactive.filter((target) => target.height < 40 || target.width < 40).slice(0, 8);
    return {
      url: window.location.href,
      title: document.title,
      innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      smallTargets
    };
  })()`);
  const access = classifyAccess(text, metrics.url);
  const missing =
    access === "rendered"
      ? screen.requiredText.filter((fragment) => !text.toLowerCase().includes(fragment.toLowerCase()))
      : [];

  return {
    screen: screen.name,
    path: screen.path,
    colorScheme,
    width,
    status: null,
    url: metrics.url,
    access,
    overflow: metrics.scrollWidth > metrics.innerWidth || metrics.bodyScrollWidth > metrics.innerWidth,
    scrollWidth: metrics.scrollWidth,
    bodyScrollWidth: metrics.bodyScrollWidth,
    innerWidth: metrics.innerWidth,
    smallTargets: metrics.smallTargets,
    missing,
    textStart: trimText(text)
  };
}

function printResult(result) {
  const overflow = result.overflow ? "overflow" : "no-overflow";
  const content =
    result.access === "rendered"
      ? result.missing.length
        ? `missing=${result.missing.join(",")}`
        : "content-ok"
      : result.access;
  const targetWarning = result.smallTargets.length ? ` small-targets=${result.smallTargets.length}` : "";
  console.log(
    `${result.screen} ${result.width}px ${result.colorScheme}: ${overflow}, ${content}, status=${result.status}${targetWarning}`
  );
  if (result.access !== "rendered") {
    console.log(`  ${result.url}`);
    console.log(`  ${result.textStart}`);
  }
  if (result.overflow) {
    console.log(`  scrollWidth=${result.scrollWidth}, bodyScrollWidth=${result.bodyScrollWidth}, innerWidth=${result.innerWidth}`);
  }
  if (result.missing.length) {
    console.log(`  text=${result.textStart}`);
  }
  if (result.smallTargets.length) {
    console.log(`  small targets: ${result.smallTargets.map((target) => `${target.label} (${target.width}x${target.height})`).join("; ")}`);
  }
}

const results = [];
let launched;
let cdp;
try {
  launched = await launchBrowser();
  cdp = await connectCdp(launched.wsUrl);
  const sessionId = await createPageSession(cdp);

  for (const width of widths) {
    for (const colorScheme of ["light", "dark"]) {
      for (const screen of screens) {
        const result = await inspectScreen(cdp, sessionId, screen, width, colorScheme);
        results.push(result);
        printResult(result);
      }
    }
  }
} finally {
  if (cdp) cdp.close();
  if (launched) await stopBrowser(launched.child, launched.userDataDir);
}

const failures = results.filter((result) => {
  if (result.overflow) return true;
  if (result.access === "rendered" && result.missing.length) return true;
  if (result.screen === "Live Companion QA" && result.access !== "rendered") return false;
  return false;
});

if (failures.length) {
  console.error(`Roamly mobile UI QA failed: ${failures.length} issue(s).`);
  process.exit(1);
}

console.log("Roamly mobile UI QA completed.");
