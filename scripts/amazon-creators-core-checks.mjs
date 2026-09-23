import assert from "node:assert/strict";
import { amazonFindProductFromApi } from "../lib/roamly/amazonCreatorsCore.ts";

const item = {
  asin: "B012345678",
  detailPageURL: "https://www.amazon.ca/dp/B012345678?tag=wrong-tag",
  images: { primary: { large: { url: "https://m.media-amazon.com/images/I/test.jpg" } } },
  itemInfo: { title: { displayValue: "Travel packing cubes" } },
  offersV2: {
    listings: [
      { availability: { type: "OUT_OF_STOCK" }, price: { money: { displayAmount: "$2.00" } } },
      {
        availability: { type: "IN_STOCK" },
        merchantInfo: { name: "Amazon.ca" },
        price: {
          money: { amount: 19.99, currency: "CAD", displayAmount: "CDN$19.99" },
          savings: { percentage: 20, money: { amount: 5, displayAmount: "CDN$5.00" } }
        }
      }
    ]
  }
};

const product = amazonFindProductFromApi(item, "www.amazon.ca", "roamly-20");
assert.equal(product?.title, "Travel packing cubes");
assert.equal(product?.imageUrl, "https://m.media-amazon.com/images/I/test.jpg");
assert.equal(product?.href, "https://www.amazon.ca/dp/B012345678?tag=roamly-20", "item URL uses the configured partner tag, not a provider-supplied one");
assert.equal(product?.price, "CDN$19.99");
assert.equal(product?.savingPercent, 20);
assert.equal(product?.deal, true);
assert.equal(product?.merchant, "Amazon.ca");

assert.equal(amazonFindProductFromApi({ ...item, detailPageURL: "https://evil.example/dp/B012345678" }, "www.amazon.ca", "roamly-20"), null, "off-marketplace item URLs are rejected");
assert.equal(amazonFindProductFromApi({ ...item, images: { primary: { large: { url: "https://images.evil.example/item.jpg" } } } }, "www.amazon.ca", "roamly-20"), null, "non-Amazon product images are rejected");
assert.equal(amazonFindProductFromApi({ ...item, offersV2: { listings: [{ availability: { type: "OUT_OF_STOCK" } }] } }, "www.amazon.ca", "roamly-20"), null, "out-of-stock listings are not merchandised as buyable finds");
assert.equal(amazonFindProductFromApi({ ...item, asin: "bad-id" }, "www.amazon.ca", "roamly-20"), null, "malformed product IDs are rejected");

console.log("Amazon Creators product-truth checks passed");
