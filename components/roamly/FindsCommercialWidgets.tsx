"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import {
  isTrustedTravelpayoutsWidgetUrl,
  type FindsPromoConfig,
  type FindsWidgetConfig,
  stay22Config
} from "@/lib/roamly/findsCommercialConfig";

const WIDGET_RENDER_TIMEOUT_MS = 8_000;

type WidgetState = "loading" | "ready" | "unavailable";

function isVisibleWidgetElement(element: Element) {
  if (!(element instanceof HTMLElement || element instanceof SVGElement)) return false;
  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

export function hasUsableTravelpayoutsContent(host: HTMLElement) {
  return Array.from(host.children).some((element) => {
    if (element.tagName === "SCRIPT" || element.tagName === "STYLE" || element.tagName === "NOSCRIPT") return false;
    if (!isVisibleWidgetElement(element)) return false;
    if (element.matches("iframe, img, video, canvas, svg, object, embed, a, button")) return true;
    return Boolean(element.textContent?.trim());
  });
}

export function TravelpayoutsWidget({ config }: { config: FindsWidgetConfig }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [state, setState] = useState<WidgetState>("loading");
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    if (visible) return;
    const host = hostRef.current;
    if (!host || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: "420px 0px" });
    observer.observe(host);
    return () => observer.disconnect();
  }, [config.placement, visible]);

  useEffect(() => {
    if (!visible || !isTrustedTravelpayoutsWidgetUrl(config.src)) {
      if (visible) setState("unavailable");
      return;
    }
    const host = hostRef.current;
    if (!host) return;

    setState("loading");
    let settled = false;
    const settleUnavailable = () => {
      if (settled) return;
      settled = true;
      setState("unavailable");
    };
    const settleReadyIfUsable = () => {
      if (!settled && hasUsableTravelpayoutsContent(host)) {
        settled = true;
        setState("ready");
      }
    };
    const observer = typeof MutationObserver === "undefined"
      ? null
      : new MutationObserver(settleReadyIfUsable);
    observer?.observe(host, { childList: true, subtree: true, characterData: true });
    const timeout = window.setTimeout(settleUnavailable, WIDGET_RENDER_TIMEOUT_MS);
    const script = document.createElement("script");
    script.async = true;
    script.charset = "utf-8";
    script.src = config.src;
    script.dataset.roamlyWidgetId = config.id;
    script.addEventListener("load", settleReadyIfUsable, { once: true });
    script.addEventListener("error", settleUnavailable, { once: true });
    host.appendChild(script);
    return () => {
      settled = true;
      window.clearTimeout(timeout);
      observer?.disconnect();
      host.replaceChildren();
    };
  }, [config.id, config.src, retryNonce, visible]);

  return <div className="min-w-0 overflow-hidden" aria-busy={state === "loading"}>
    {state === "unavailable" ? <div className="rounded-2xl border border-dashed border-[#c8ddd0] bg-[#f7fbf7] px-4 py-5 text-sm leading-6 text-[#60766d]" role="status" aria-live="polite">
      <p>Live offers aren’t available right now.</p>
      <p className="mt-1">Nothing has been substituted or guessed.</p>
      <button type="button" onClick={() => { setState("loading"); setRetryNonce((value) => value + 1); }} className="mt-4 inline-flex min-h-11 items-center rounded-full bg-[#0f6e66] px-5 font-black text-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#0f6e66]/25">Retry</button>
    </div> : null}
    <div ref={hostRef} aria-label={state === "unavailable" ? undefined : config.heading} aria-hidden={state === "unavailable"} style={{ minHeight: state === "unavailable" ? 0 : `${visible ? config.minHeight : 72}px`, display: state === "unavailable" ? "none" : undefined }} className="min-w-0 overflow-hidden" />
  </div>;
}

export function FindsWidgetSection({ config, heading = true, className = "" }: { config: FindsWidgetConfig; heading?: boolean; className?: string }) {
  return <section className={`min-w-0 ${className}`} aria-labelledby={heading ? `${config.id}-heading` : undefined}>
    {heading ? <div className="mb-4">
      <p className="text-xs font-black uppercase tracking-[0.2em] text-[#0f6e66]">{config.eyebrow}</p>
      <h3 id={`${config.id}-heading`} className="mt-2 text-2xl font-black tracking-tight text-[#203c43]">{config.heading}</h3>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-[#60766d]">{config.description}</p>
    </div> : null}
    <TravelpayoutsWidget config={config} />
  </section>;
}

export function FindsTrackedLink({ href, eyebrow, headline, description, action = "Explore" }: { href: string; eyebrow: string; headline: string; description: string; action?: string }) {
  return <article className="rounded-[1.75rem] bg-[#e8f4ec] p-6 sm:p-8">
    <p className="text-xs font-black uppercase tracking-[0.2em] text-[#0f6e66]">{eyebrow}</p>
    <h3 className="mt-2 text-2xl font-black tracking-tight text-[#203c43]">{headline}</h3>
    <p className="mt-2 max-w-xl text-sm leading-6 text-[#60766d]">{description}</p>
    <a href={href} target="_blank" rel="noopener noreferrer" className="mt-5 inline-flex min-h-11 items-center rounded-full bg-[#0f6e66] px-5 text-sm font-black text-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#0f6e66]/25">{action}<span aria-hidden="true" className="ml-2">↗</span></a>
  </article>;
}

export function FindsPromo({ promo }: { promo: FindsPromoConfig }) {
  if (!promo.enabled) return null;
  return <FindsTrackedLink href={promo.href} eyebrow={promo.eyebrow} headline={promo.headline} description={promo.description} action="Explore the current selection" />;
}

export function Stay22LetMeAllezScript() {
  const script = `(function (s, t, a, y, twenty, two) { s.Stay22 = s.Stay22 || {}; s.Stay22.params = { lmaID: '${stay22Config.lmaId}' }; twenty = t.createElement(a); two = t.getElementsByTagName(a)[0]; twenty.async = 1; twenty.src = y; two.parentNode.insertBefore(twenty, two); })(window, document, 'script', '${stay22Config.scriptSrc}');`;
  return <Script id="roamly-stay22-letmeallez" strategy="afterInteractive">{script}</Script>;
}
