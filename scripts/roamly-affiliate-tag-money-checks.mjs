import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { defineMoneyFinding, runMoneyChecks } from "./specialist-money-check-utils.mjs";

/**
 * PROVIDER_TRAVEL_INTELLIGENCE specialist money checks — protect and grow
 * affiliate and booking revenue. Affiliate tags must be present and valid
 * (a dropped tag means commission lost), and partner links must never be
 * misrepresented as exact products (broken trust kills bookings).
 */

const amazon = await readFile(new URL("../lib/roamly/amazonAffiliate.ts", import.meta.url), "utf8");
const klook = await readFile(new URL("../lib/roamly/klookAffiliateLink.ts", import.meta.url), "utf8");

await runMoneyChecks(
  "PROVIDER_TRAVEL_INTELLIGENCE",
  "Protect and grow affiliate and booking revenue: valid tags, honest labels, real provider URLs.",
  [
    defineMoneyFinding(
      "affiliate-amazon-tag-gated",
      "high",
      "An affiliate tag sent while disabled leaks partner terms; a malformed tag loses the commission.",
      () => {
        assert.match(amazon, /if \(enabled && tag\) url\.searchParams\.set\("tag", tag\)/, "Amazon tag must only be attached when the program is enabled and the tag is non-empty");
        assert.match(amazon, /\/\^\[A-Za-z0-9_-\]\+\$\/\.test\(tag\)/, "Amazon tag must pass a strict format check before use");
      }
    ),
    defineMoneyFinding(
      "affiliate-klook-host-allowlist",
      "high",
      "Affiliate credit on a lookalike domain is commission sent to nobody and a phishing risk.",
      () => {
        assert.match(klook, /host === "klook\.com" \|\| host\.endsWith\("\.klook\.com"\)/, "Klook URLs must be restricted to genuine klook.com hosts");
        assert.match(klook, /https:.*affiliate\.klook\.com/, "Klook referral links must stay on HTTPS klook-controlled hosts");
      }
    ),
    defineMoneyFinding(
      "affiliate-no-invented-products",
      "medium",
      "Linking to a product the partner never listed breaks trust and the sale.",
      () => {
        assert.match(amazon, /buildAmazonSearchUrl/, "Amazon finds must be built as searches, never invented product pages");
        assert.match(klook, /aid/i, "Klook affiliate credit must travel on the aid parameter");
      }
    ),
    defineMoneyFinding(
      "affiliate-amazon-env-contract",
      "low",
      "A renamed env var silently drops every tag — the check locks the contract.",
      () => {
        assert.match(amazon, /ROAMLY_AMAZON_ASSOCIATE_TAG/, "the associate tag env contract must keep its documented name");
        assert.match(amazon, /ROAMLY_AMAZON_ENABLED/, "the affiliate kill-switch env contract must keep its documented name");
      }
    )
  ]
);
