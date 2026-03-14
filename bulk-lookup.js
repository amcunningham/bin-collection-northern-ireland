#!/usr/bin/env node
/**
 * Phase 3: Bulk postcode-to-zone lookup using the discovered API.
 *
 * This script reads:
 *   - data/api-recipe.json   (from intercept-api.js - the API endpoint details)
 *   - data/all-postcodes.json (from fetch-postcodes.js - valid postcodes to look up)
 *
 * And writes:
 *   - data/zones.json         (postcode -> day/zone mapping)
 *
 * No Puppeteer needed - uses plain HTTP requests.
 *
 * Usage:
 *   # First run the prerequisites:
 *   node fetch-postcodes.js       # get list of valid postcodes
 *   node intercept-api.js BT34 4HS  # discover the API
 *
 *   # Then bulk lookup:
 *   node bulk-lookup.js              # look up all postcodes
 *   node bulk-lookup.js BT34         # look up one prefix only
 *   node bulk-lookup.js --dry-run    # show what would be done
 *
 * If api-recipe.json doesn't exist yet, the script will explain how to create it.
 */

const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

const DATA_DIR = path.join(__dirname, "data");
const ZONES_PATH = path.join(DATA_DIR, "zones.json");
const RECIPE_PATH = path.join(DATA_DIR, "api-recipe.json");
const POSTCODES_PATH = path.join(DATA_DIR, "all-postcodes.json");

// Parse response for day/zone info
// Adapt these patterns based on what intercept-api.js reveals
function parseDayZone(text) {
  // Pattern 1: "MON Z1", "TUES Z2", "WED Z1", "THURS V2", "FRI V2"
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

// Parse response for day/zone - try multiple strategies
function extractDayZone(responseBody) {
  // Strategy 1: direct text match
  const direct = parseDayZone(responseBody);
  if (direct) return direct;

  // Strategy 2: try parsing as JSON
  try {
    const json = JSON.parse(responseBody);
    const jsonStr = JSON.stringify(json);
    return parseDayZone(jsonStr);
  } catch {}

  // Strategy 3: HTML - extract text content
  const textOnly = responseBody.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  return parseDayZone(textOnly);
}

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

function httpRequest(url, options, postData) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    const req = mod.request(url, options, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error("Timeout"));
    });
    if (postData) req.write(postData);
    req.end();
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function lookupPostcode(endpoint, postcode) {
  const [prefix, suffix] = postcode.split(" ");
  if (!prefix || !suffix) return null;

  // Build the request based on the recipe
  let url = endpoint.url;
  let postData = endpoint.postData;
  const method = endpoint.method || "GET";

  // Replace template placeholders in URL or POST data
  if (url) {
    url = url.replace(/\{prefix\}/gi, prefix);
    url = url.replace(/\{suffix\}/gi, suffix);
    url = url.replace(/\{postcode\}/gi, encodeURIComponent(postcode));
  }
  if (postData) {
    postData = postData.replace(/\{prefix\}/gi, prefix);
    postData = postData.replace(/\{suffix\}/gi, suffix);
    postData = postData.replace(/\{postcode\}/gi, postcode);
    // Also replace the test postcode values with new ones
    if (endpoint._testPrefix && endpoint._testSuffix) {
      postData = postData.replace(new RegExp(endpoint._testPrefix, "g"), prefix);
      postData = postData.replace(new RegExp(endpoint._testSuffix, "g"), suffix);
    }
  }

  const headers = { ...(endpoint.headers || {}) };
  // Remove puppeteer-specific headers
  delete headers["user-agent"];
  headers["User-Agent"] =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

  const options = {
    method,
    headers,
  };

  try {
    const res = await httpRequest(url, options, postData);

    if (res.status === 200) {
      const result = extractDayZone(res.body);
      if (result) {
        return { status: "found", ...result };
      }
      // Check for "not found" indicators
      if (/not found|no results|invalid|not recognised/i.test(res.body)) {
        return { status: "not_found" };
      }
      return { status: "no_match", body: res.body.slice(0, 200) };
    }

    return { status: "http_error", code: res.status };
  } catch (err) {
    return { status: "error", reason: err.message };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const prefixFilter = args.find((a) => a.startsWith("BT"))?.toUpperCase();

  // Check prerequisites
  if (!fs.existsSync(RECIPE_PATH)) {
    console.error("ERROR: data/api-recipe.json not found!\n");
    console.error("You need to run the API discovery first:");
    console.error("  node intercept-api.js BT34 4HS\n");
    console.error("This will:");
    console.error("  1. Open the council lookup page in a headless browser");
    console.error("  2. Perform a test lookup");
    console.error("  3. Capture the hidden API endpoint");
    console.error("  4. Save the recipe to data/api-recipe.json");
    console.error("\nThen come back and run this script.");
    process.exit(1);
  }

  const recipe = JSON.parse(fs.readFileSync(RECIPE_PATH, "utf8"));
  console.log(`API recipe loaded (discovered: ${recipe.discovered})`);
  console.log(`  Test postcode: ${recipe.testPostcode}`);
  console.log(`  Endpoints: ${recipe.endpoints.length}`);

  // Get postcode list
  let postcodes = [];

  if (fs.existsSync(POSTCODES_PATH)) {
    postcodes = JSON.parse(fs.readFileSync(POSTCODES_PATH, "utf8"));
    console.log(`\nLoaded ${postcodes.length} postcodes from all-postcodes.json`);
  } else {
    // Try individual prefix files
    const prefixFiles = fs.readdirSync(DATA_DIR).filter((f) => f.startsWith("postcodes-bt"));
    if (prefixFiles.length > 0) {
      for (const f of prefixFiles) {
        const pcs = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), "utf8"));
        postcodes.push(...pcs);
      }
      console.log(`\nLoaded ${postcodes.length} postcodes from ${prefixFiles.length} prefix files`);
    } else {
      console.error("\nERROR: No postcode lists found!");
      console.error("Run: node fetch-postcodes.js");
      process.exit(1);
    }
  }

  // Filter by prefix if requested
  if (prefixFilter) {
    postcodes = postcodes.filter((pc) => pc.startsWith(prefixFilter));
    console.log(`Filtered to ${postcodes.length} postcodes for ${prefixFilter}`);
  }

  // Load existing zones to skip already-known postcodes
  const zonesData = loadZones();
  const existing = Object.keys(zonesData.postcodes).length;
  const toProcess = postcodes.filter((pc) => !zonesData.postcodes[pc]);
  console.log(`Already known: ${existing} postcodes`);
  console.log(`To process: ${toProcess.length} postcodes`);

  if (dryRun) {
    console.log("\n[DRY RUN] Would process these postcodes:");
    for (const pc of toProcess.slice(0, 20)) console.log(`  ${pc}`);
    if (toProcess.length > 20) console.log(`  ... and ${toProcess.length - 20} more`);
    return;
  }

  if (toProcess.length === 0) {
    console.log("\nNothing to do - all postcodes already looked up!");
    return;
  }

  // Use the first endpoint from the recipe
  const endpoint = recipe.endpoints[0];

  // Enrich endpoint with test values for replacement
  const [testPrefix, testSuffix] = recipe.testPostcode.split(" ");
  endpoint._testPrefix = testPrefix;
  endpoint._testSuffix = testSuffix;

  console.log(`\nUsing endpoint: ${endpoint.method} ${endpoint.url}`);
  console.log(`Starting bulk lookup of ${toProcess.length} postcodes...\n`);

  let found = 0, notFound = 0, errors = 0;
  const startTime = Date.now();

  for (let i = 0; i < toProcess.length; i++) {
    const pc = toProcess[i];
    const result = await lookupPostcode(endpoint, pc);

    if (result?.status === "found") {
      zonesData.postcodes[pc] = {
        day: result.day,
        zone: result.zone,
        ref: result.ref,
      };
      found++;
      process.stdout.write(`  ✓ ${pc} -> ${result.ref}\n`);
    } else if (result?.status === "not_found") {
      notFound++;
    } else {
      errors++;
      if (errors <= 10) {
        process.stdout.write(`  ✗ ${pc}: ${result?.status} ${result?.reason || result?.body || ""}\n`);
      }
    }

    // Save checkpoint every 25 new finds
    if (found > 0 && found % 25 === 0) {
      saveZones(zonesData);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      const rate = ((i + 1) / (Date.now() - startTime) * 1000).toFixed(1);
      console.log(
        `  [checkpoint] ${found} found, ${notFound} not found, ${errors} errors, ${elapsed}s elapsed, ${rate}/s`
      );
    }

    // Progress every 100
    if ((i + 1) % 100 === 0) {
      console.log(`  Progress: ${i + 1}/${toProcess.length}`);
    }

    // Rate limit: 500ms between requests
    await sleep(500);
  }

  // Final save
  saveZones(zonesData);

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
