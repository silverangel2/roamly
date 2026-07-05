"use client";

import { useEffect, useRef } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";

const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "TEXTAREA", "INPUT", "SELECT", "OPTION", "CODE", "PRE"]);

function shouldSkip(node: Text) {
  const parent = node.parentElement;
  if (!parent) return true;
  if (SKIP_TAGS.has(parent.tagName)) return true;
  return Boolean(parent.closest("[data-no-translate]"));
}

function preserveWhitespace(original: string, translated: string) {
  const match = original.match(/^(\s*)([\s\S]*?)(\s*)$/);
  if (!match) return translated;
  return `${match[1]}${translated}${match[3]}`;
}

export function TranslatedTextBoundary({ children }: { children: React.ReactNode }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const originals = useRef(new WeakMap<Text, string>());
  const { locale, translateText } = useI18n();

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;

    function translateNode(node: Text) {
      if (shouldSkip(node)) return;
      const current = node.nodeValue || "";
      const base = originals.current.get(node) || current;
      if (!originals.current.has(node)) originals.current.set(node, base);
      const core = base.trim();
      if (!core) return;
      const translated = translateText(core);
      const nextValue = preserveWhitespace(base, translated);
      if (node.nodeValue !== nextValue) node.nodeValue = nextValue;
    }

    function translateTree(target: Node) {
      const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
      let current = walker.nextNode();
      while (current) {
        translateNode(current as Text);
        current = walker.nextNode();
      }
    }

    translateTree(root);
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => translateTree(node));
        if (mutation.type === "characterData" && mutation.target.nodeType === Node.TEXT_NODE) {
          translateNode(mutation.target as Text);
        }
      }
    });
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [locale, translateText]);

  return <div ref={rootRef}>{children}</div>;
}
