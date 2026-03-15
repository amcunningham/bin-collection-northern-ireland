#!/usr/bin/env node
/**
 * Puppeteer-based bulk postcode lookup for NMD council bin collection data.
 *
 * Uses a real browser to bypass bot protection (Cloudflare/WAF) that now
 * blocks plain HTTP requests to the council form.
 *
 * Usage:
 *   node puppeteer-lookup.js BT34 4HS       # test a single postcode
 *   node puppeteer-lookup.js BT34            # bulk lookup all BT34 postcodes
 *   node puppeteer-lookup.js                 # bulk lookup ALL postcodes
 *   node puppeteer-lookup.js --dry-run       # show what would be done
 *
 * Prerequisites:
 *   npm install puppeteer
 *   node fetch-postcodes.js BT34             # to get the postcode list first
 *
 * The browser session is reused across all lookups, so bot protection
 * only needs to be passed once at startup.
 */

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "data");
const ZONES_PATH = path.join(DATA_DIR, "zones.json");
const LOOKUP_URL =
  "https://www.newrymournedown.org/weekly-bin-collection-and-calendar";

const NMD_PREFIXES = [
  "BT23", "BT24", "BT25", "BT27",
  "BT30", "BT31", "BT32", "BT33",
  "BT34", "BT35", "BT60",
];

function loadZones() {
  try {
    return JSON.parse(fs.readFileSync(ZONES_PATH, "utf8"));
  } catch {
    return { postcodes: {} };
  }
}

function saveZones(data) {
  fs.writeFileSync(ZONES_PATH, JSON.stringify(data, null, 2) + "\n");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Load postcodes for a given prefix from the data files.
 */
function loadPostcodes(prefix) {
  const prefixFile = path.join(
    DATA_DIR,
    `postcodes-${prefix.toLowerCase()}.json`
  );
  if (fs.existsSync(prefixFile)) {
    return JSON.parse(fs.readFileSync(prefixFile, "utf8"));
  }

  const allFile = path.join(DATA_DIR, "all-postcodes.json");
  if (fs.existsSync(allFile)) {
    const all = JSON.parse(fs.readFileSync(allFile, "utf8"));
    return all.filter((pc) => pc.startsWith(prefix));
  }

  return [];
}

/**
 * Parse the day and zone from page text.
 */
function parseDayZone(text) {
  const match = text.match(
    /\b(MON|TUES?|WED|THURS?|FRI)\s+(Z\d+|V\d+)\b/i
  );
  if (!match) return null;

  const refDay = match[1].toUpperCase();
  const zone = match[2].toUpperCase();

  const dayMap = {
    MON: "MON", TUE: "TUE", TUES: "TUE",
    WED: "WED", THU: "THU", THUR: "THU", THURS: "THU",
    FRI: "FRI",
  };
  const day = dayMap[refDay] || refDay;
  const refPrefix = {
    MON: "MON", TUE: "TUES", WED: "WED", THU: "THURS", FRI: "FRI",
  };

  return { day, zone, ref: `${refPrefix[day]} ${zone}` };
}

/**
 * Perform a single lookup using the browser page.
 * Uses Puppeteer's native methods (select, type, click) to simulate
 * real user interaction with the council's bin collection form.
 *
 * Form structure (from inspect-page.js):
 *   form#mainbodyform.form_search_bin (POST to same page with #search)
 *     select#PostcodeBT  - BT prefix dropdown (BT23..BT60)
 *     input#PostcodeEND  - suffix text field (e.g. "4HS")
 *     input#submit_btn   - SEARCH button (type=submit)
 *     hidden: postback=1
 */
async function lookupInBrowser(page, prefix, suffix) {
  try {
    // Check the form exists on the page
    const formExists = await page.$('#PostcodeBT');
    if (!formExists) {
      return { status: "error", reason: "PostcodeBT dropdown not found on page" };
    }

    // Ensure the hidden postback field exists (required by the server)
    await page.evaluate(() => {
      const form = document.querySelector('#mainbodyform');
      if (form && !form.querySelector('input[name="postback"]')) {
        const hidden = document.createElement('input');
        hidden.type = 'hidden';
        hidden.name = 'postback';
        hidden.value = '1';
        form.appendChild(hidden);
      }
    });

    // Step 1: Select the BT prefix from the dropdown
    await page.select('#PostcodeBT', prefix);
    await sleep(300);

    // Step 2: Clear and type the suffix into the postcode input
    await page.click('#PostcodeEND', { clickCount: 3 }); // select all existing text
    await page.type('#PostcodeEND', suffix);
    await sleep(200);

    // Step 3: Click SEARCH and wait for navigation
    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }).catch(() => null),
      page.click('#submit_btn'),
    ]);

    // Wait a moment for any dynamic content
    await sleep(500);

    // Read the page text and parse it
    const pageText = await page.evaluate(() => document.body.innerText);
    const pageUrl = page.url();
    const result = parseDayZone(pageText);

    if (result) {
      return { status: "found", ...result, url: pageUrl };
    }

    // Check for "not found" indicators
    if (/not found|no results|invalid|not recognised|no match/i.test(pageText)) {
      return { status: "not_found" };
    }

    // If the page has no zone data, treat as not found
    if (!pageText.match(/[ZV]\d+/)) {
      // Log a snippet of the page text for debugging
      const snippet = pageText.replace(/\s+/g, ' ').slice(0, 200);
      return { status: "not_found", debug: snippet };
    }

    return { status: "no_match" };
  } catch (err) {
    return { status: "error", reason: err.message };
  }
}

async function main() {
  const puppeteer = require("puppeteer");

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const prefixArg = args.find((a) => /^BT\d+$/i.test(a))?.toUpperCase();
  const suffixArg = args.find((a) => /^\d[A-Z]{2}$/i.test(a))?.toUpperCase();

  // Launch browser
  console.log("Launching browser...");
  const headless = args.includes("--headless");
  const browser = await puppeteer.launch({
    headless: headless ? "new" : false,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
  );

  // Navigate to the lookup page (this handles any bot challenge)
  console.log("Loading council lookup page...");
  try {
    await page.goto(LOOKUP_URL, { waitUntil: "networkidle2", timeout: 60000 });
  } catch (navErr) {
    // Cloudflare may cause an abort; wait and retry once
    console.log("Initial load interrupted, waiting for challenge page...");
    await new Promise((r) => setTimeout(r, 10000));
    try {
      await page.goto(LOOKUP_URL, { waitUntil: "networkidle2", timeout: 60000 });
    } catch {
      // Page may have loaded despite the error - check the title
    }
  }
  console.log(`Page loaded: ${await page.title()}`);

  // Dismiss cookie consent banner if present
  try {
    await page.evaluate(() => {
      const buttons = [...document.querySelectorAll("button, a")];
      for (const btn of buttons) {
        const text = (btn.textContent || "").toLowerCase().trim();
        if (text === "accept" || text === "accept all" || text === "accept cookies") {
          btn.click();
          return true;
        }
      }
      return false;
    });
    await sleep(500);
  } catch {}

  // Single postcode test mode
  if (prefixArg && suffixArg) {
    console.log(`\nLooking up ${prefixArg} ${suffixArg}...`);
    const result = await lookupInBrowser(page, prefixArg, suffixArg);
    console.log("Result:", JSON.stringify(result, null, 2));

    if (result.status === "found") {
      const zonesData = loadZones();
      const pc = `${prefixArg} ${suffixArg}`;
      zonesData.postcodes[pc] = {
        day: result.day,
        zone: result.zone,
        ref: result.ref,
      };
      saveZones(zonesData);
      console.log(`Saved: ${pc} -> ${result.ref}`);
    }

    // Take a screenshot for debugging
    await page.screenshot({
      path: path.join(DATA_DIR, "puppeteer-result.png"),
    });
    console.log("Screenshot saved to data/puppeteer-result.png");

    await browser.close();
    return;
  }

  // Bulk lookup mode
  const prefixes = prefixArg ? [prefixArg] : NMD_PREFIXES;
  const zonesData = loadZones();
  const existingCount = Object.keys(zonesData.postcodes).length;
  console.log(`\nExisting postcodes in zones.json: ${existingCount}`);

  let allPostcodes = [];
  for (const prefix of prefixes) {
    const pcs = loadPostcodes(prefix);
    if (pcs.length === 0) {
      console.log(
        `No postcode list found for ${prefix}. Run: node fetch-postcodes.js ${prefix}`
      );
      continue;
    }
    allPostcodes.push(...pcs);
  }

  const toProcess = allPostcodes.filter((pc) => !zonesData.postcodes[pc]);
  console.log(
    `Total postcodes to look up: ${toProcess.length} (skipping ${allPostcodes.length - toProcess.length} already known)`
  );

  if (dryRun) {
    console.log("\n[DRY RUN] First 20 postcodes that would be looked up:");
    for (const pc of toProcess.slice(0, 20)) console.log(`  ${pc}`);
    if (toProcess.length > 20)
      console.log(`  ... and ${toProcess.length - 20} more`);
    await browser.close();
    return;
  }

  if (toProcess.length === 0) {
    console.log("Nothing to do - all postcodes already looked up!");
    await browser.close();
    return;
  }

  let found = 0,
    notFound = 0,
    errors = 0;
  const startTime = Date.now();

  for (let i = 0; i < toProcess.length; i++) {
    const pc = toProcess[i];
    const [prefix, suffix] = pc.split(" ");
    if (!prefix || !suffix) continue;

    const result = await lookupInBrowser(page, prefix, suffix);

    if (result.status === "found") {
      zonesData.postcodes[pc] = {
        day: result.day,
        zone: result.zone,
        ref: result.ref,
      };
      found++;
      process.stdout.write(`  + ${pc} -> ${result.ref}\n`);
    } else if (result.status === "not_found" || result.status === "no_match") {
      notFound++;
    } else {
      errors++;
      if (errors <= 5) {
        process.stdout.write(
          `  ! ${pc}: ${result.status} ${result.reason || ""}\n`
        );
      }
    }

    // Reload the form page for the next lookup (form POST navigates away)
    try {
      await page.goto(LOOKUP_URL, {
        waitUntil: "networkidle2",
        timeout: 30000,
      });
    } catch {
      // Retry once on navigation error
      await sleep(2000);
      await page.goto(LOOKUP_URL, {
        waitUntil: "networkidle2",
        timeout: 30000,
      });
    }

    // Save checkpoint every 25 finds
    if (found > 0 && found % 25 === 0) {
      saveZones(zonesData);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      console.log(
        `  [checkpoint] ${found} found, ${notFound} not found, ${errors} errors (${elapsed}s)`
      );
    }

    // Progress update every 100 lookups
    if ((i + 1) % 100 === 0) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      console.log(`  Progress: ${i + 1}/${toProcess.length} (${elapsed}s)`);
    }

    // Rate limit: 1.5 seconds between requests (slightly slower for browser)
    await sleep(1500);
  }

  // Final save
  saveZones(zonesData);
  await browser.close();

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  console.log(`\n=== DONE (${elapsed}s) ===`);
  console.log(`  Found: ${found}`);
  console.log(`  Not found: ${notFound}`);
  console.log(`  Errors: ${errors}`);
  console.log(`  Total in zones.json: ${Object.keys(zonesData.postcodes).length}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
