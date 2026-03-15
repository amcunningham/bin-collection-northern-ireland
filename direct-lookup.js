#!/usr/bin/env node
/**
 * Direct HTTP POST lookup for NMD council bin collection data.
 *
 * No Puppeteer needed — just plain HTTP requests to the council's form.
 *
 * The council website has a simple HTML form that POSTs to:
 *   https://www.newrymournedown.org/weekly-bin-collection-and-calendar#search
 *
 * Form fields:
 *   postback=1
 *   PostcodeBT=BT34    (the outcode prefix)
 *   PostcodeEND=4HS    (the incode suffix)
 *   submit_btn=SEARCH
 *
 * The response HTML contains the collection day and zone reference
 * (e.g. "WED Z2", "THURS V2").
 *
 * Usage:
 *   node direct-lookup.js BT34 4HS          # test a single postcode
 *   node direct-lookup.js BT34              # bulk lookup all BT34 postcodes
 *   node direct-lookup.js                   # bulk lookup ALL postcodes
 *   node direct-lookup.js --dry-run         # show what would be done
 *
 * Prerequisites:
 *   node fetch-postcodes.js BT34            # to get the postcode list first
 *
 * No extra dependencies — uses built-in Node.js https module.
 */

const https = require("https");
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "data");
const ZONES_PATH = path.join(DATA_DIR, "zones.json");
const LOOKUP_URL = "https://www.newrymournedown.org/weekly-bin-collection-and-calendar";

// BT prefixes from the council's own dropdown (discovered via intercept-api.js)
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
 * POST to the council form and return the response HTML.
 */
function postLookup(prefix, suffix) {
  return new Promise((resolve, reject) => {
    const formData = `postback=1&PostcodeBT=${encodeURIComponent(prefix)}&PostcodeEND=${encodeURIComponent(suffix)}&submit_btn=SEARCH`;

    const options = {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(formData),
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-GB,en;q=0.9",
        "Referer": LOOKUP_URL,
      },
    };

    const req = https.request(LOOKUP_URL, options, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        resolve({ status: res.statusCode, redirect: res.headers.location, body: "" });
        res.resume();
        return;
      }

      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode, body }));
      res.on("error", reject);
    });

    req.on("error", reject);
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error("Timeout"));
    });

    req.write(formData);
    req.end();
  });
}

/**
 * Normalize a day abbreviation and zone into a standard result object.
 */
function makeDayZone(rawDay, zone) {
  const refDay = rawDay.toUpperCase();
  zone = zone.toUpperCase();

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
 * Parse the day and zone from the council response HTML.
 *
 * The site now returns a list of addresses with "View Schedule" PDF links.
 * PDF URLs encode the zone: e.g. /bin-collections/WED-Z2.pdf?v=5
 *
 * Falls back to matching "WED Z2" style text in the page body.
 */
function parseDayZone(html) {
  // First: look for PDF links like /bin-collections/WED-Z2.pdf
  const pdfMatch = html.match(
    /href=["'][^"']*\/(MON|TUES?|WED|THURS?|FRI)-(Z\d+|V\d+)\.pdf[^"']*/i
  );
  if (pdfMatch) {
    return makeDayZone(pdfMatch[1], pdfMatch[2]);
  }

  // Fallback: look for DAY + ZONE in page text
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const match = text.match(
    /\b(MON|TUES?|WED|THURS?|FRI)\s+(Z\d+|V\d+)\b/i
  );
  if (!match) return null;

  return makeDayZone(match[1], match[2]);
}

/**
 * Look up a single postcode and return the result.
 */
async function lookupPostcode(prefix, suffix) {
  try {
    const res = await postLookup(prefix, suffix);

    if (res.status === 403) {
      return { status: "blocked", reason: "403 Forbidden" };
    }

    if (res.status !== 200) {
      return { status: "http_error", code: res.status };
    }

    const result = parseDayZone(res.body);
    if (result) {
      return { status: "found", ...result };
    }

    // Check for "not found" indicators
    if (/not found|no results|invalid|not recognised|no match/i.test(res.body)) {
      return { status: "not_found" };
    }

    // Check if the page returned but without bin data (postcode might not be in NMD area)
    if (res.body.includes("PostcodeBT") && !res.body.match(/[ZV]\d+/)) {
      return { status: "not_found" };
    }

    return { status: "no_match" };
  } catch (err) {
    return { status: "error", reason: err.message };
  }
}

/**
 * Load postcodes for a given prefix from the data files.
 */
function loadPostcodes(prefix) {
  // Try per-prefix file first
  const prefixFile = path.join(DATA_DIR, `postcodes-${prefix.toLowerCase()}.json`);
  if (fs.existsSync(prefixFile)) {
    return JSON.parse(fs.readFileSync(prefixFile, "utf8"));
  }

  // Try combined file
  const allFile = path.join(DATA_DIR, "all-postcodes.json");
  if (fs.existsSync(allFile)) {
    const all = JSON.parse(fs.readFileSync(allFile, "utf8"));
    return all.filter((pc) => pc.startsWith(prefix));
  }

  return [];
}

async function main() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const prefixArg = args.find((a) => /^BT\d+$/i.test(a))?.toUpperCase();
  const suffixArg = args.find((a) => /^\d[A-Z]{2}$/i.test(a))?.toUpperCase();

  // Single postcode test mode
  if (prefixArg && suffixArg) {
    console.log(`Looking up ${prefixArg} ${suffixArg}...`);
    const result = await lookupPostcode(prefixArg, suffixArg);
    console.log("Result:", JSON.stringify(result, null, 2));

    if (result.status === "found") {
      const zonesData = loadZones();
      const pc = `${prefixArg} ${suffixArg}`;
      zonesData.postcodes[pc] = { day: result.day, zone: result.zone, ref: result.ref };
      saveZones(zonesData);
      console.log(`Saved: ${pc} -> ${result.ref}`);
    }
    return;
  }

  // Bulk lookup mode
  const prefixes = prefixArg ? [prefixArg] : NMD_PREFIXES;
  const zonesData = loadZones();
  const existingCount = Object.keys(zonesData.postcodes).length;
  console.log(`Existing postcodes in zones.json: ${existingCount}`);

  let allPostcodes = [];
  for (const prefix of prefixes) {
    const pcs = loadPostcodes(prefix);
    if (pcs.length === 0) {
      console.log(`No postcode list found for ${prefix}. Run: node fetch-postcodes.js ${prefix}`);
      continue;
    }
    allPostcodes.push(...pcs);
  }

  // Filter out already-known postcodes
  const toProcess = allPostcodes.filter((pc) => !zonesData.postcodes[pc]);
  console.log(`Total postcodes to look up: ${toProcess.length} (skipping ${allPostcodes.length - toProcess.length} already known)`);

  if (dryRun) {
    console.log("\n[DRY RUN] First 20 postcodes that would be looked up:");
    for (const pc of toProcess.slice(0, 20)) console.log(`  ${pc}`);
    if (toProcess.length > 20) console.log(`  ... and ${toProcess.length - 20} more`);
    return;
  }

  if (toProcess.length === 0) {
    console.log("Nothing to do — all postcodes already looked up!");
    return;
  }

  let found = 0, notFound = 0, errors = 0, blocked = 0;
  const startTime = Date.now();

  for (let i = 0; i < toProcess.length; i++) {
    const pc = toProcess[i];
    const [prefix, suffix] = pc.split(" ");
    if (!prefix || !suffix) continue;

    const result = await lookupPostcode(prefix, suffix);

    if (result.status === "found") {
      zonesData.postcodes[pc] = { day: result.day, zone: result.zone, ref: result.ref };
      found++;
      process.stdout.write(`  + ${pc} -> ${result.ref}\n`);
    } else if (result.status === "not_found" || result.status === "no_match") {
      notFound++;
    } else if (result.status === "blocked") {
      blocked++;
      if (blocked <= 3) {
        console.log(`  BLOCKED: ${pc} (${result.reason})`);
      }
      if (blocked >= 5) {
        console.log("\nToo many blocks — the council site may be rate-limiting. Stopping.");
        console.log("Try again later, or increase the delay between requests.");
        break;
      }
    } else {
      errors++;
      if (errors <= 5) {
        process.stdout.write(`  ! ${pc}: ${result.status} ${result.reason || ""}\n`);
      }
    }

    // Save checkpoint every 25 finds
    if (found > 0 && found % 25 === 0) {
      saveZones(zonesData);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      console.log(`  [checkpoint] ${found} found, ${notFound} not found, ${errors} errors (${elapsed}s)`);
    }

    // Progress update every 100 lookups
    if ((i + 1) % 100 === 0) {
      console.log(`  Progress: ${i + 1}/${toProcess.length}`);
    }

    // Rate limit: 1 second between requests to be polite
    await sleep(1000);
  }

  // Final save
  saveZones(zonesData);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  console.log(`\n=== DONE (${elapsed}s) ===`);
  console.log(`  Found: ${found}`);
  console.log(`  Not found: ${notFound}`);
  console.log(`  Errors: ${errors}`);
  console.log(`  Blocked: ${blocked}`);
  console.log(`  Total in zones.json: ${Object.keys(zonesData.postcodes).length}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
