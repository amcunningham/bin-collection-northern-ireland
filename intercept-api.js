#!/usr/bin/env node
/**
 * Discover the hidden API behind the NMD council postcode lookup.
 *
 * This script intercepts ALL network traffic while performing a
 * postcode lookup, then saves a curl-ready API recipe so we can
 * replay lookups without Puppeteer.
 *
 * Usage:
 *   node intercept-api.js BT34 4HS     # intercept a lookup (REQUIRED first run)
 *   node intercept-api.js               # just inspect page structure
 *
 * Output:
 *   data/api-recipe.json  - the discovered API endpoint, method, headers, body template
 *   data/page-debug.json  - full page structure dump
 *   stdout                - everything found (JS analysis, XHR captures, page text)
 *
 * After running this, check api-recipe.json and use bulk-lookup.js to scrape.
 *
 * Requires: npm install puppeteer
 */

const fs = require("fs");
const path = require("path");

const LOOKUP_URL =
  "https://www.newrymournedown.org/weekly-bin-collection-and-calendar";
const DATA_DIR = path.join(__dirname, "data");

async function main() {
  const puppeteer = require("puppeteer");

  const prefix = process.argv[2]?.toUpperCase();
  const suffix = process.argv[3]?.toUpperCase();

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );

  // ── Capture ALL network traffic ──
  const allRequests = [];
  const allResponses = [];
  const scriptContents = {};

  await page.setRequestInterception(true);

  page.on("request", (req) => {
    allRequests.push({
      url: req.url(),
      type: req.resourceType(),
      method: req.method(),
      postData: req.postData() || null,
      headers: req.headers(),
    });
    req.continue();
  });

  page.on("response", async (res) => {
    const url = res.url();
    const type = res.request().resourceType();

    // Save script bodies for analysis
    if (type === "script" || url.endsWith(".js")) {
      try {
        scriptContents[url] = await res.text();
      } catch {}
    }

    // Capture ALL response bodies for XHR/fetch/document
    if (["xhr", "fetch", "document"].includes(type)) {
      try {
        const body = await res.text();
        allResponses.push({
          url,
          status: res.status(),
          type,
          headers: res.headers(),
          body: body.slice(0, 5000),
          method: res.request().method(),
          postData: res.request().postData() || null,
        });
      } catch {}
    }
  });

  // ── Phase 1: Load the page and analyse ──
  console.log("Loading page...");
  await page.goto(LOOKUP_URL, { waitUntil: "networkidle2", timeout: 30000 });
  console.log(`Title: ${await page.title()}\n`);

  // Get page HTML
  const pageHTML = await page.content();

  // Search page source for embedded data
  console.log("=== PAGE SOURCE ANALYSIS ===\n");

  // Look for inline scripts with data
  const inlineScripts = pageHTML.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || [];
  console.log(`  Inline scripts: ${inlineScripts.length}`);
  for (let i = 0; i < inlineScripts.length; i++) {
    const script = inlineScripts[i];
    if (
      /BT\d{2}|zone|postcode|collection/i.test(script) &&
      script.length > 50
    ) {
      console.log(`\n  *** Inline script #${i} has relevant content (${script.length} chars) ***`);
      console.log(script.slice(0, 3000));
      console.log("  ...(truncated)");
    }
  }

  // Search for data attributes, hidden fields, JSON-LD
  const dataAttrs = pageHTML.match(/data-[a-z-]+="[^"]*(?:zone|postcode|BT\d{2})[^"]*"/gi);
  if (dataAttrs) {
    console.log(`\n  Data attributes with zone/postcode refs:`, dataAttrs);
  }

  const hiddenFields = pageHTML.match(/<input[^>]*type="hidden"[^>]*>/gi) || [];
  if (hiddenFields.length > 0) {
    console.log(`\n  Hidden form fields (${hiddenFields.length}):`);
    for (const f of hiddenFields) console.log(`    ${f.slice(0, 200)}`);
  }

  // Search JS files
  console.log("\n=== JS FILE ANALYSIS ===\n");
  for (const [url, content] of Object.entries(scriptContents)) {
    const shortUrl = url.split("/").pop().split("?")[0];
    const size = (content.length / 1024).toFixed(0);

    const hasZones = content.match(/[ZV][1-9]/g);
    const hasBT = content.match(/BT\d{2}/g);
    const hasAPI = content.match(
      /\/api\/|\.asmx|\/search|\/lookup|\/find|\/postcode|ajax|XMLHttpRequest|fetch\s*\(/gi
    );
    const hasJSON = content.match(/JSON\.parse|JSON\.stringify|application\/json/gi);

    if (hasZones || hasBT || hasAPI) {
      console.log(`  ${shortUrl} (${size}KB):`);
      if (hasZones) console.log(`    Zones: ${[...new Set(hasZones)].join(", ")}`);
      if (hasBT) console.log(`    BT refs: ${[...new Set(hasBT)].join(", ")}`);
      if (hasAPI) console.log(`    API patterns: ${[...new Set(hasAPI)].join(", ")}`);
      if (hasJSON) console.log(`    JSON handling: ${[...new Set(hasJSON)].join(", ")}`);

      // If it has lots of BT refs, it might contain the entire mapping
      if (hasBT && hasBT.length > 10) {
        console.log(`\n    *** LIKELY MAPPING DATA (${hasBT.length} BT refs) ***`);
        // Find all sections with BT data and dump them
        let searchFrom = 0;
        let dumps = 0;
        while (dumps < 5) {
          const idx = content.indexOf("BT", searchFrom);
          if (idx < 0 || idx > content.length - 4) break;
          // Check it's actually a postcode ref
          if (/BT\d{2}/.test(content.slice(idx, idx + 4))) {
            const start = Math.max(0, idx - 100);
            const end = Math.min(content.length, idx + 500);
            console.log(`\n    --- Excerpt at offset ${idx} ---`);
            console.log(content.slice(start, end));
            dumps++;
          }
          searchFrom = idx + 4;
        }
      }

      // Also look for fetch/ajax patterns
      if (hasAPI) {
        const fetchCalls = content.match(/fetch\s*\([^)]+\)/g);
        const xhrOpens = content.match(/\.open\s*\([^)]+\)/g);
        const ajaxCalls = content.match(/\$\.(?:ajax|get|post)\s*\([^)]+\)/g);
        if (fetchCalls) console.log(`    fetch() calls:`, fetchCalls.slice(0, 5));
        if (xhrOpens) console.log(`    XHR opens:`, xhrOpens.slice(0, 5));
        if (ajaxCalls) console.log(`    jQuery ajax:`, ajaxCalls.slice(0, 5));
      }
    }
  }

  // Check iframes
  console.log("\n=== IFRAMES ===\n");
  const iframes = await page.evaluate(() =>
    [...document.querySelectorAll("iframe")].map((f) => ({
      src: f.src,
      id: f.id,
      class: f.className,
      width: f.width,
      height: f.height,
    }))
  );

  if (iframes.length > 0) {
    console.log("Found iframes:", JSON.stringify(iframes, null, 2));

    for (const frame of page.frames()) {
      const frameUrl = frame.url();
      if (frameUrl && !["about:blank", page.url()].includes(frameUrl)) {
        console.log(`\n  Iframe: ${frameUrl}`);
        try {
          const frameHTML = await frame.content();

          // Search for data in iframe
          const iframeBT = frameHTML.match(/BT\d{2}/g);
          const iframeZones = frameHTML.match(/[ZV][1-9]/g);
          if (iframeBT) console.log(`    BT refs: ${[...new Set(iframeBT)].join(", ")}`);
          if (iframeZones) console.log(`    Zones: ${[...new Set(iframeZones)].join(", ")}`);

          // Dump form elements inside iframe
          const elements = await frame.evaluate(() => ({
            selects: [...document.querySelectorAll("select")].map((s) => ({
              id: s.id, name: s.name,
              options: [...s.options].slice(0, 20).map((o) => ({
                value: o.value, text: o.text.trim(),
              })),
            })),
            inputs: [...document.querySelectorAll("input")].map((i) => ({
              id: i.id, name: i.name, type: i.type,
              placeholder: i.placeholder, value: i.value,
            })),
            buttons: [...document.querySelectorAll("button, input[type='submit'], a.btn")].map((b) => ({
              text: (b.textContent || b.value || "").trim().slice(0, 80),
              id: b.id, type: b.type, href: b.href || "",
            })),
            forms: [...document.querySelectorAll("form")].map((f) => ({
              action: f.action, method: f.method, id: f.id,
            })),
          }));
          console.log("    Elements:", JSON.stringify(elements, null, 2));

          // Save iframe HTML for offline analysis
          fs.writeFileSync(
            path.join(DATA_DIR, "iframe-source.html"),
            frameHTML
          );
          console.log("    Saved iframe HTML to data/iframe-source.html");
        } catch (e) {
          console.log(`    Cannot access iframe (cross-origin?): ${e.message}`);
        }
      }
    }
  } else {
    console.log("No iframes found");
  }

  // Form structure on main page
  console.log("\n=== MAIN PAGE FORM STRUCTURE ===\n");
  const formInfo = await page.evaluate(() => ({
    forms: [...document.querySelectorAll("form")].map((f) => ({
      action: f.action, method: f.method, id: f.id, class: f.className,
    })),
    selects: [...document.querySelectorAll("select")].map((s) => ({
      id: s.id, name: s.name, class: s.className,
      optionCount: s.options.length,
      options: [...s.options].slice(0, 20).map((o) => ({
        value: o.value, text: o.text.trim(),
      })),
    })),
    visibleInputs: [...document.querySelectorAll("input")]
      .filter((i) => i.type !== "hidden" && i.offsetParent !== null)
      .map((i) => ({
        id: i.id, name: i.name, type: i.type,
        placeholder: i.placeholder, class: i.className,
      })),
    buttons: [...document.querySelectorAll("button, input[type='submit'], a.btn")]
      .filter((b) => b.offsetParent !== null)
      .map((b) => ({
        text: (b.textContent || b.value || "").trim().slice(0, 80),
        id: b.id, type: b.type, class: b.className,
      })),
  }));
  console.log(JSON.stringify(formInfo, null, 2));

  // Network summary
  console.log("\n=== NETWORK SUMMARY (page load) ===\n");
  const byType = {};
  for (const r of allRequests) {
    byType[r.type] = (byType[r.type] || 0) + 1;
  }
  console.log("  Request counts:", JSON.stringify(byType));
  const xhrRequests = allRequests.filter((r) => ["xhr", "fetch"].includes(r.type));
  if (xhrRequests.length > 0) {
    console.log(`  XHR/Fetch requests:`);
    for (const r of xhrRequests) {
      console.log(`    ${r.method} ${r.url}`);
    }
  }

  // ── Phase 2: Perform a lookup if postcode given ──
  if (prefix && suffix) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`=== PERFORMING LOOKUP: ${prefix} ${suffix}`);
    console.log(`${"=".repeat(60)}\n`);

    // Clear request/response logs for this phase
    const preSearchRequests = allRequests.length;

    // Screenshot before
    await page.screenshot({ path: path.join(DATA_DIR, "before-search.png") });

    // Determine which frame to interact with
    let targetFrame = page;
    for (const frame of page.frames()) {
      const fUrl = frame.url();
      if (fUrl && !["about:blank", page.url()].includes(fUrl)) {
        console.log(`Using iframe: ${fUrl}`);
        targetFrame = frame;
        break;
      }
    }

    // Step 1: Select prefix
    console.log("Step 1: Selecting prefix...");
    const selectResult = await targetFrame.evaluate((pfx) => {
      const selects = document.querySelectorAll("select");
      for (const sel of selects) {
        for (const opt of sel.options) {
          if (opt.value === pfx || opt.text.trim() === pfx || opt.text.includes(pfx)) {
            sel.value = opt.value;
            sel.dispatchEvent(new Event("change", { bubbles: true }));
            return { found: true, id: sel.id, name: sel.name, value: opt.value, text: opt.text };
          }
        }
      }
      return { found: false, selectCount: selects.length };
    }, prefix);
    console.log("  Result:", JSON.stringify(selectResult));

    await new Promise((r) => setTimeout(r, 1000));

    // Step 2: Fill suffix
    console.log("Step 2: Filling suffix...");
    const inputResult = await targetFrame.evaluate((sfx) => {
      const inputs = [...document.querySelectorAll("input")]
        .filter((i) => i.type !== "hidden" && i.offsetParent !== null);
      for (const inp of inputs) {
        // Skip if it looks like a search box for the whole site
        if (inp.type === "search") continue;
        inp.focus();
        inp.value = sfx;
        inp.dispatchEvent(new Event("input", { bubbles: true }));
        inp.dispatchEvent(new Event("change", { bubbles: true }));
        return { found: true, id: inp.id, name: inp.name, placeholder: inp.placeholder };
      }
      return { found: false, inputCount: inputs.length };
    }, suffix);
    console.log("  Result:", JSON.stringify(inputResult));

    await new Promise((r) => setTimeout(r, 500));

    // Step 3: Click search
    console.log("Step 3: Clicking search...");
    const searchResult = await targetFrame.evaluate(() => {
      const candidates = [
        ...document.querySelectorAll("button, input[type='submit'], input[type='button'], a"),
      ];
      for (const btn of candidates) {
        const text = (btn.textContent || btn.value || "").toLowerCase().trim();
        if (
          text.includes("search") ||
          text.includes("find") ||
          text.includes("look up") ||
          text.includes("go") ||
          text.includes("submit")
        ) {
          btn.click();
          return { clicked: true, text, tag: btn.tagName, id: btn.id };
        }
      }
      // Fallback: try submitting the form directly
      const form = document.querySelector("form");
      if (form) {
        form.submit();
        return { clicked: true, text: "form.submit()", tag: "FORM" };
      }
      return { clicked: false, candidateCount: candidates.length };
    });
    console.log("  Result:", JSON.stringify(searchResult));

    // Wait for navigation/response
    console.log("Waiting for response...");
    await new Promise((r) => setTimeout(r, 5000));

    // Screenshot after
    await page.screenshot({ path: path.join(DATA_DIR, "after-search.png") });

    // ── Analyse what happened ──
    const newRequests = allRequests.slice(preSearchRequests);
    console.log(`\n--- New network requests (${newRequests.length}) ---`);
    for (const r of newRequests) {
      console.log(`  ${r.method} [${r.type}] ${r.url}`);
      if (r.postData) {
        console.log(`    POST data: ${r.postData.slice(0, 1000)}`);
      }
    }

    // Show new responses
    const searchResponses = allResponses.filter(
      (r) => !r.url.includes(".css") && !r.url.includes(".png") && !r.url.includes(".jpg")
    );
    console.log(`\n--- Responses with content ---`);
    for (const r of searchResponses) {
      console.log(`\n  ${r.method} ${r.status} [${r.type}] ${r.url}`);
      if (r.body && r.body.length > 0) {
        console.log(`  Body (${r.body.length} chars):`);
        console.log(r.body.slice(0, 2000));
      }
    }

    // Get the result text from the page
    const resultText = await page.evaluate(() => document.body.innerText);
    console.log(`\n--- Page text after search ---`);
    console.log(resultText.slice(0, 3000));

    // Also check if result appeared in iframe
    if (targetFrame !== page) {
      const frameText = await targetFrame.evaluate(() => document.body.innerText);
      console.log(`\n--- Iframe text after search ---`);
      console.log(frameText.slice(0, 3000));
    }

    // ── Save API recipe if we found XHR/fetch requests ──
    const apiCandidates = newRequests.filter(
      (r) => ["xhr", "fetch"].includes(r.type) || (r.method === "POST" && r.type === "document")
    );

    if (apiCandidates.length > 0) {
      const recipe = {
        discovered: new Date().toISOString(),
        testPostcode: `${prefix} ${suffix}`,
        endpoints: apiCandidates.map((r) => ({
          url: r.url,
          method: r.method,
          contentType: r.headers["content-type"] || null,
          postData: r.postData,
          headers: r.headers,
        })),
        note: "Use bulk-lookup.js with this recipe to scrape all postcodes via HTTP",
        curlExample: apiCandidates
          .map((r) => {
            let cmd = `curl -X ${r.method} '${r.url}'`;
            if (r.postData) {
              cmd += ` -H 'Content-Type: ${r.headers["content-type"] || "application/x-www-form-urlencoded"}'`;
              cmd += ` -d '${r.postData.replace(/'/g, "'\\''")}'`;
            }
            return cmd;
          })
          .join("\n\n"),
      };

      const recipePath = path.join(DATA_DIR, "api-recipe.json");
      fs.writeFileSync(recipePath, JSON.stringify(recipe, null, 2) + "\n");
      console.log(`\n*** API RECIPE SAVED to ${recipePath} ***`);
      console.log(`\nCurl example:\n${recipe.curlExample}`);
    } else {
      console.log("\n*** No XHR/fetch API calls detected during search ***");
      console.log("The form might use a full page reload (traditional form POST).");
      console.log("Check the 'document' type requests above for the form action URL.");

      // Save what we have
      const docRequests = newRequests.filter((r) => r.type === "document");
      if (docRequests.length > 0) {
        const recipe = {
          discovered: new Date().toISOString(),
          testPostcode: `${prefix} ${suffix}`,
          type: "form-post",
          endpoints: docRequests.map((r) => ({
            url: r.url,
            method: r.method,
            postData: r.postData,
          })),
          note: "This appears to be a traditional form POST, not an AJAX API",
        };
        fs.writeFileSync(
          path.join(DATA_DIR, "api-recipe.json"),
          JSON.stringify(recipe, null, 2) + "\n"
        );
      }
    }
  } else {
    console.log("\n*** Run with a postcode to capture the API call ***");
    console.log("  node intercept-api.js BT34 4HS");
  }

  // Save debug info
  fs.writeFileSync(
    path.join(DATA_DIR, "page-debug.json"),
    JSON.stringify(
      {
        url: LOOKUP_URL,
        timestamp: new Date().toISOString(),
        iframes: iframes,
        formInfo,
        scriptUrls: Object.keys(scriptContents),
        scriptSizes: Object.fromEntries(
          Object.entries(scriptContents).map(([u, c]) => [
            u.split("/").pop().split("?")[0],
            c.length,
          ])
        ),
        hiddenFieldCount: hiddenFields.length,
      },
      null,
      2
    ) + "\n"
  );

  console.log(`\nDebug data saved to data/page-debug.json`);
  console.log("Screenshots saved to data/before-search.png and data/after-search.png");

  await browser.close();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
