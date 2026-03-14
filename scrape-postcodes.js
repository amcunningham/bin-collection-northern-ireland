#!/usr/bin/env node
/**
 * Scrape postcode-to-zone mappings from the NMD council website.
 *
 * Uses Puppeteer to automate the council's postcode lookup page.
 * The page has a two-part postcode form:
 *   1. Dropdown to select the BT prefix (e.g. BT34)
 *   2. Text input for the suffix (e.g. 4HS)
 *   3. SEARCH button
 *
 * The result shows the bin collection day and zone reference
 * (e.g. "WED Z2", "THURS V2") which we extract and save.
 *
 * Usage:
 *   npm install puppeteer    (one-time setup, ~400MB download)
 *   node scrape-postcodes.js                    # scrape all known BT prefixes
 *   node scrape-postcodes.js BT34               # scrape one prefix only
 *   node scrape-postcodes.js BT34 4HS           # test a single postcode
 *
 * Output:
 *   Appends results to data/zones.json
 *   Logs progress to console
 */

const fs = require("fs");
const path = require("path");

const ZONES_PATH = path.join(__dirname, "data", "zones.json");
const LOOKUP_URL =
  "https://www.newrymournedown.org/weekly-bin-collection-and-calendar";

// BT prefixes covered by NMD council
const NMD_PREFIXES = [
  "BT23", "BT24", "BT25", "BT27",
  "BT30", "BT31", "BT33", "BT34", "BT39",
];

// UK postcode suffix format: digit + two letters (e.g. 4HS, 1AB)
// Generate all possible suffixes for a given numeric part
function generateSuffixes(number) {
  const suffixes = [];
  const letters = "ABCDEFGHJKLMNOPQRSTUVWXYZ"; // I excluded per Royal Mail
  for (const l1 of letters) {
    for (const l2 of letters) {
      suffixes.push(`${number}${l1}${l2}`);
    }
  }
  return suffixes;
}

// Load existing zones data
function loadZones() {
  try {
    return JSON.parse(fs.readFileSync(ZONES_PATH, "utf8"));
  } catch {
    return { postcodes: {} };
  }
}

// Save zones data
function saveZones(zonesData) {
  fs.writeFileSync(ZONES_PATH, JSON.stringify(zonesData, null, 2) + "\n");
}

// Parse the day and zone from the result page text
// Expected patterns: "MON Z1", "TUES Z2", "WED Z1", "THURS V2", "FRI V2"
function parseDayZone(text) {
  const match = text.match(
    /\b(MON|TUES?|WED|THURS?|FRI)\s+(Z\d+|V\d+)\b/i
  );
  if (!match) return null;

  const refDay = match[1].toUpperCase();
  const zone = match[2].toUpperCase();

  // Normalise day to short form
  const dayMap = {
    MON: "MON",
    TUE: "TUE",
    TUES: "TUE",
    WED: "WED",
    THU: "THU",
    THUR: "THU",
    THURS: "THU",
    FRI: "FRI",
  };
  const day = dayMap[refDay] || refDay;

  // Reconstruct the ref in council format
  const refPrefix = { MON: "MON", TUE: "TUES", WED: "WED", THU: "THURS", FRI: "FRI" };

  return {
    day,
    zone,
    ref: `${refPrefix[day]} ${zone}`,
  };
}

async function scrapePostcode(page, prefix, suffix) {
  const postcode = `${prefix} ${suffix}`;

  try {
    await page.goto(LOOKUP_URL, { waitUntil: "networkidle2", timeout: 30000 });

    // Step 1: Select the BT prefix from the dropdown
    // Try common select element patterns
    const prefixSelected = await page.evaluate((pfx) => {
      // Look for select elements
      const selects = document.querySelectorAll("select");
      for (const sel of selects) {
        for (const opt of sel.options) {
          if (opt.value === pfx || opt.text.includes(pfx)) {
            sel.value = opt.value;
            sel.dispatchEvent(new Event("change", { bubbles: true }));
            return true;
          }
        }
      }
      return false;
    }, prefix);

    if (!prefixSelected) {
      // Try clicking a dropdown and finding the option
      const dropdowns = await page.$$('[class*="select"], [class*="dropdown"]');
      for (const dd of dropdowns) {
        await dd.click();
        await page.waitForTimeout(500);
        const option = await page.$(`option[value="${prefix}"]`);
        if (option) {
          await option.click();
          break;
        }
      }
    }

    await page.waitForTimeout(500);

    // Step 2: Enter the suffix in the text input
    // Find text inputs (exclude the prefix dropdown area)
    const inputFilled = await page.evaluate((sfx) => {
      const inputs = document.querySelectorAll(
        'input[type="text"], input:not([type])'
      );
      for (const inp of inputs) {
        const placeholder = (inp.placeholder || "").toLowerCase();
        const name = (inp.name || "").toLowerCase();
        const id = (inp.id || "").toLowerCase();
        // Look for the suffix input
        if (
          placeholder.includes("last") ||
          placeholder.includes("3") ||
          name.includes("postcode") ||
          name.includes("suffix") ||
          id.includes("postcode") ||
          id.includes("suffix") ||
          inp.maxLength === 3
        ) {
          inp.value = sfx;
          inp.dispatchEvent(new Event("input", { bubbles: true }));
          inp.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        }
      }
      // Fallback: fill the last visible text input
      const visible = [...inputs].filter(
        (i) => i.offsetParent !== null && i.type !== "hidden"
      );
      if (visible.length > 0) {
        const last = visible[visible.length - 1];
        last.value = sfx;
        last.dispatchEvent(new Event("input", { bubbles: true }));
        last.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }
      return false;
    }, suffix);

    if (!inputFilled) {
      return { postcode, status: "error", reason: "could not fill suffix" };
    }

    await page.waitForTimeout(300);

    // Step 3: Click the search button
    const searchClicked = await page.evaluate(() => {
      const buttons = document.querySelectorAll(
        'button, input[type="submit"], input[type="button"], a.btn, [class*="search"]'
      );
      for (const btn of buttons) {
        const text = (btn.textContent || btn.value || "").toLowerCase();
        if (text.includes("search") || text.includes("find") || text.includes("look")) {
          btn.click();
          return true;
        }
      }
      return false;
    });

    if (!searchClicked) {
      return { postcode, status: "error", reason: "could not find search button" };
    }

    // Step 4: Wait for results
    await page.waitForTimeout(3000);

    // Step 5: Extract the day/zone from the result
    const pageText = await page.evaluate(() => document.body.innerText);
    const result = parseDayZone(pageText);

    if (result) {
      return { postcode, status: "found", ...result };
    }

    // Check if postcode not found
    if (
      pageText.includes("not found") ||
      pageText.includes("no results") ||
      pageText.includes("not recognised")
    ) {
      return { postcode, status: "not_found" };
    }

    return { postcode, status: "no_match", reason: "could not parse day/zone" };
  } catch (err) {
    return { postcode, status: "error", reason: err.message };
  }
}

async function main() {
  const puppeteer = require("puppeteer");

  const args = process.argv.slice(2);
  let prefixes = NMD_PREFIXES;
  let singleSuffix = null;

  if (args[0]) {
    const prefix = args[0].toUpperCase();
    if (!NMD_PREFIXES.includes(prefix)) {
      console.error(`Unknown prefix: ${prefix}. Valid: ${NMD_PREFIXES.join(", ")}`);
      process.exit(1);
    }
    prefixes = [prefix];
  }
  if (args[1]) {
    singleSuffix = args[1].toUpperCase();
  }

  const zonesData = loadZones();
  const existingCount = Object.keys(zonesData.postcodes).length;
  console.log(`Loaded ${existingCount} existing postcodes`);

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );

  let found = 0;
  let notFound = 0;
  let errors = 0;
  let skipped = 0;

  try {
    // First, navigate to the page to understand its structure
    console.log("Loading lookup page to inspect form structure...");
    await page.goto(LOOKUP_URL, { waitUntil: "networkidle2", timeout: 30000 });

    // Dump the page structure for debugging on first run
    const pageInfo = await page.evaluate(() => {
      const selects = [...document.querySelectorAll("select")].map((s) => ({
        id: s.id,
        name: s.name,
        options: [...s.options].map((o) => o.value).slice(0, 5),
      }));
      const inputs = [...document.querySelectorAll("input")].map((i) => ({
        id: i.id,
        name: i.name,
        type: i.type,
        placeholder: i.placeholder,
      }));
      const buttons = [
        ...document.querySelectorAll(
          'button, input[type="submit"], input[type="button"]'
        ),
      ].map((b) => ({
        tag: b.tagName,
        text: b.textContent || b.value,
        id: b.id,
      }));
      return { selects, inputs, buttons, title: document.title };
    });

    console.log("\nPage structure:");
    console.log("  Title:", pageInfo.title);
    console.log("  Selects:", JSON.stringify(pageInfo.selects, null, 2));
    console.log("  Inputs:", JSON.stringify(pageInfo.inputs, null, 2));
    console.log("  Buttons:", JSON.stringify(pageInfo.buttons, null, 2));
    console.log("");

    if (singleSuffix) {
      // Single postcode test
      const result = await scrapePostcode(page, prefixes[0], singleSuffix);
      console.log("Result:", JSON.stringify(result, null, 2));

      if (result.status === "found") {
        const pc = result.postcode;
        zonesData.postcodes[pc] = {
          day: result.day,
          zone: result.zone,
          ref: result.ref,
        };
        saveZones(zonesData);
        console.log(`Saved ${pc} -> ${result.ref}`);
      }
    } else {
      // Bulk scrape: iterate through possible postcodes
      for (const prefix of prefixes) {
        console.log(`\nScraping ${prefix}...`);

        // BT postcodes typically have numbers 1-99 in the second part
        // For BT34, the format is "BT34 #XX" where # is 1-9
        for (let num = 1; num <= 9; num++) {
          const suffixes = generateSuffixes(num);
          console.log(
            `  ${prefix} ${num}xx: ${suffixes.length} possible suffixes`
          );

          for (const suffix of suffixes) {
            const postcode = `${prefix} ${suffix}`;

            // Skip if already known
            if (zonesData.postcodes[postcode]) {
              skipped++;
              continue;
            }

            const result = await scrapePostcode(page, prefix, suffix);

            if (result.status === "found") {
              zonesData.postcodes[postcode] = {
                day: result.day,
                zone: result.zone,
                ref: result.ref,
              };
              found++;

              // Save every 10 new postcodes
              if (found % 10 === 0) {
                saveZones(zonesData);
                console.log(
                  `    Saved checkpoint (${found} new, ${notFound} not found, ${errors} errors)`
                );
              }
            } else if (result.status === "not_found") {
              notFound++;
            } else {
              errors++;
              if (errors <= 5) {
                console.log(
                  `    Error on ${postcode}: ${result.reason || result.status}`
                );
              }
            }

            // Rate limit: don't hammer the server
            await page.waitForTimeout(1000);
          }
        }
      }

      // Final save
      saveZones(zonesData);
    }
  } finally {
    await browser.close();
  }

  console.log(`\nDone!`);
  console.log(`  Found: ${found}`);
  console.log(`  Not found: ${notFound}`);
  console.log(`  Errors: ${errors}`);
  console.log(`  Skipped (already known): ${skipped}`);
  console.log(
    `  Total postcodes in database: ${Object.keys(zonesData.postcodes).length}`
  );
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
