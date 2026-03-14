#!/usr/bin/env node
/**
 * Phase 1: Download all valid postcodes in the NMD council area
 * using the free postcodes.io API.
 *
 * postcodes.io doesn't have a "list all in district" endpoint,
 * so we use the /outcodes/:outcode/nearest + random sampling
 * combined with autocomplete to build up a comprehensive list.
 *
 * Usage:
 *   node fetch-postcodes.js              # fetch all NMD prefixes
 *   node fetch-postcodes.js BT34         # fetch one prefix only
 *
 * Output:
 *   data/postcodes-bt34.json (etc) - one file per prefix
 *   data/all-postcodes.json        - combined list
 *
 * No dependencies needed - uses built-in https module.
 */

const https = require("https");
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "data");

// BT prefixes and sectors covered by NMD council
// Sourced from findthatpostcode.uk/doogal.co.uk for district N09000010
// Only sectors that fall within NMD are listed for partial-overlap areas
const NMD_PREFIXES_AND_SECTORS = {
  "BT24": [7, 8],
  "BT25": [2],
  "BT30": [6, 7, 8, 9],
  "BT31": [9],
  "BT32": [5],
  "BT33": [0],
  "BT34": [1, 2, 3, 4, 5],
  "BT35": [0, 6, 7, 8, 9],
};
const NMD_PREFIXES = Object.keys(NMD_PREFIXES_AND_SECTORS);

function get(urlStr) {
  return new Promise((resolve, reject) => {
    https.get(urlStr, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error(`Invalid JSON from ${urlStr}: ${data.slice(0, 200)}`));
        }
      });
      res.on("error", reject);
    }).on("error", reject);
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchPostcodesForPrefix(prefix) {
  const postcodes = new Set();
  const lowerPrefix = prefix.toLowerCase();

  console.log(`\n=== Fetching postcodes for ${prefix} ===`);

  // Strategy 1: Autocomplete with every possible start
  // Only search sectors that fall within NMD
  const sectors = NMD_PREFIXES_AND_SECTORS[prefix];
  console.log(`  Strategy 1: Autocomplete (sectors ${sectors.join(", ")})...`);
  for (const digit of sectors) {
    const partial = `${prefix} ${digit}`;
    try {
      const res = await get(
        `https://api.postcodes.io/postcodes/${encodeURIComponent(partial)}/autocomplete?limit=100`
      );
      if (res.result) {
        for (const pc of res.result) {
          postcodes.add(pc.toUpperCase());
        }
      }
    } catch (e) {
      // Some partials won't have results
    }
    await sleep(100);

    // Also try with letters after the digit
    const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
    for (const letter of letters) {
      const partial2 = `${prefix} ${digit}${letter}`;
      try {
        const res = await get(
          `https://api.postcodes.io/postcodes/${encodeURIComponent(partial2)}/autocomplete?limit=100`
        );
        if (res.result) {
          for (const pc of res.result) {
            postcodes.add(pc.toUpperCase());
          }
        }
      } catch {}
      await sleep(50);
    }
  }

  console.log(`  After autocomplete: ${postcodes.size} postcodes`);

  // Strategy 2: Random postcodes in the outcode area
  console.log("  Strategy 2: Random sampling...");
  for (let i = 0; i < 20; i++) {
    try {
      const res = await get(
        `https://api.postcodes.io/random/postcodes?outcode=${prefix}`
      );
      if (res.result) {
        postcodes.add(res.result.postcode.toUpperCase());
      }
    } catch {}
    await sleep(100);
  }

  console.log(`  After random: ${postcodes.size} postcodes`);

  // Strategy 3: Nearest postcodes to each found postcode (expand coverage)
  console.log("  Strategy 3: Nearest-neighbour expansion...");
  const known = [...postcodes];
  for (const pc of known.slice(0, 50)) {
    try {
      const res = await get(
        `https://api.postcodes.io/postcodes/${encodeURIComponent(pc)}/nearest?limit=10&radius=2000`
      );
      if (res.result) {
        for (const item of res.result) {
          if (item.postcode.startsWith(prefix)) {
            postcodes.add(item.postcode.toUpperCase());
          }
        }
      }
    } catch {}
    await sleep(50);
  }

  console.log(`  After expansion: ${postcodes.size} postcodes`);

  // Sort and save
  const sorted = [...postcodes].sort();

  const outPath = path.join(DATA_DIR, `postcodes-${prefix.toLowerCase()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(sorted, null, 2) + "\n");
  console.log(`  Saved ${sorted.length} postcodes to ${outPath}`);

  return sorted;
}

async function main() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  const args = process.argv.slice(2);
  let prefixes = NMD_PREFIXES;

  if (args[0]) {
    const prefix = args[0].toUpperCase();
    if (!NMD_PREFIXES.includes(prefix)) {
      console.error(`Unknown prefix: ${prefix}. Valid: ${NMD_PREFIXES.join(", ")}`);
      process.exit(1);
    }
    prefixes = [prefix];
  }

  const allPostcodes = [];

  for (const prefix of prefixes) {
    const postcodes = await fetchPostcodesForPrefix(prefix);
    allPostcodes.push(...postcodes);
  }

  // Save combined list
  const combinedPath = path.join(DATA_DIR, "all-postcodes.json");
  const combined = allPostcodes.sort();
  fs.writeFileSync(combinedPath, JSON.stringify(combined, null, 2) + "\n");

  console.log(`\n=== DONE ===`);
  console.log(`Total postcodes found: ${combined.length}`);
  console.log(`Saved to: ${combinedPath}`);
  console.log(`\nNext step: run 'node intercept-api.js BT34 4HS' to find the council API`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
