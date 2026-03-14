#!/usr/bin/env node
/**
 * Inspect the NMD council lookup page structure.
 * Run this first to understand the form before bulk scraping.
 *
 * Usage:
 *   npm install puppeteer
 *   node inspect-page.js              # just dump page structure
 *   node inspect-page.js BT34 4HS     # test a single lookup and show what happens
 */

const LOOKUP_URL =
  "https://www.newrymournedown.org/weekly-bin-collection-and-calendar";

async function main() {
  const puppeteer = require("puppeteer");

  const browser = await puppeteer.launch({
    headless: false, // show the browser so you can see what happens
    args: ["--no-sandbox"],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 800 });

  console.log("Loading page...");
  await page.goto(LOOKUP_URL, { waitUntil: "networkidle2", timeout: 30000 });
  console.log("Page loaded:", await page.title());

  // Dump all form elements
  const structure = await page.evaluate(() => {
    const result = { forms: [], selects: [], inputs: [], buttons: [], iframes: [] };

    // Forms
    for (const form of document.querySelectorAll("form")) {
      result.forms.push({
        action: form.action,
        method: form.method,
        id: form.id,
        class: form.className,
      });
    }

    // Select elements (dropdowns)
    for (const sel of document.querySelectorAll("select")) {
      result.selects.push({
        id: sel.id,
        name: sel.name,
        class: sel.className,
        optionCount: sel.options.length,
        firstOptions: [...sel.options]
          .slice(0, 10)
          .map((o) => ({ value: o.value, text: o.text.trim() })),
      });
    }

    // Input elements
    for (const inp of document.querySelectorAll("input")) {
      if (inp.type === "hidden") continue; // skip hidden
      result.inputs.push({
        id: inp.id,
        name: inp.name,
        type: inp.type,
        placeholder: inp.placeholder,
        class: inp.className,
        visible: inp.offsetParent !== null,
      });
    }

    // Buttons
    for (const btn of document.querySelectorAll(
      'button, input[type="submit"], input[type="button"], a.btn, [role="button"]'
    )) {
      result.buttons.push({
        tag: btn.tagName,
        text: (btn.textContent || btn.value || "").trim().slice(0, 50),
        id: btn.id,
        class: btn.className,
      });
    }

    // Iframes (the form might be embedded)
    for (const iframe of document.querySelectorAll("iframe")) {
      result.iframes.push({
        src: iframe.src,
        id: iframe.id,
        class: iframe.className,
      });
    }

    return result;
  });

  console.log("\n=== PAGE STRUCTURE ===\n");
  console.log(JSON.stringify(structure, null, 2));

  // Check for iframes - the lookup might be embedded
  if (structure.iframes.length > 0) {
    console.log("\n=== IFRAME CONTENTS ===\n");
    for (const iframe of structure.iframes) {
      if (iframe.src) {
        console.log(`Iframe src: ${iframe.src}`);
        try {
          const framePage = await browser.newPage();
          await framePage.goto(iframe.src, {
            waitUntil: "networkidle2",
            timeout: 15000,
          });
          const frameStructure = await framePage.evaluate(() => {
            const r = { selects: [], inputs: [], buttons: [] };
            for (const sel of document.querySelectorAll("select")) {
              r.selects.push({
                id: sel.id,
                name: sel.name,
                options: [...sel.options]
                  .slice(0, 10)
                  .map((o) => ({ value: o.value, text: o.text.trim() })),
              });
            }
            for (const inp of document.querySelectorAll("input")) {
              r.inputs.push({
                id: inp.id,
                name: inp.name,
                type: inp.type,
                placeholder: inp.placeholder,
              });
            }
            for (const btn of document.querySelectorAll(
              'button, input[type="submit"]'
            )) {
              r.buttons.push({
                text: (btn.textContent || btn.value || "").trim(),
              });
            }
            return r;
          });
          console.log(JSON.stringify(frameStructure, null, 2));
          await framePage.close();
        } catch (e) {
          console.log("  Could not load iframe:", e.message);
        }
      }
    }
  }

  // If testing a specific postcode
  const prefix = process.argv[2];
  const suffix = process.argv[3];

  if (prefix && suffix) {
    console.log(`\n=== TESTING LOOKUP: ${prefix} ${suffix} ===\n`);
    console.log("Watch the browser window - interact manually if needed.");
    console.log("The browser will stay open for 60 seconds so you can inspect.");

    // Enable request logging
    page.on("request", (req) => {
      if (["xhr", "fetch"].includes(req.resourceType())) {
        console.log(`  XHR/Fetch: ${req.method()} ${req.url()}`);
      }
    });
    page.on("response", (res) => {
      if (["xhr", "fetch"].includes(res.request().resourceType())) {
        console.log(`  Response: ${res.status()} ${res.url()}`);
      }
    });

    // Wait for manual interaction
    await new Promise((resolve) => setTimeout(resolve, 60000));
  } else {
    console.log("\nTip: Run with a postcode to test lookup:");
    console.log("  node inspect-page.js BT34 4HS");
    console.log("\nBrowser will close in 10 seconds...");
    await new Promise((resolve) => setTimeout(resolve, 10000));
  }

  await browser.close();
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
