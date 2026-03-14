#!/usr/bin/env node
/**
 * Generate all possible postcode suffixes for NMD council sectors.
 *
 * UK postcode format: BT34 1AB
 *   - Outcode: BT34 (prefix)
 *   - Incode:  1AB  (sector digit + unit letters)
 *
 * We generate every valid combination: digit + letter + letter
 * where letters exclude C, I, K, M, O, V (not used in UK incode positions).
 *
 * For prefixes with known NMD sectors, we only generate those sectors.
 * For prefixes where we don't know, we generate all 0-9 sectors
 * (the council lookup will filter out non-NMD postcodes).
 *
 * Output: data/postcodes-btXX.json for each prefix
 *         data/all-postcodes.json combined
 */

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "data");

// Sectors verified as NMD from findthatpostcode.uk/doogal.co.uk
// null means "generate all sectors 0-9" (council dropdown includes
// these prefixes but we don't have sector-level data)
const NMD_PREFIXES_AND_SECTORS = {
  BT23: null,
  BT24: [7, 8],
  BT25: [2],
  BT27: null,
  BT30: [6, 7, 8, 9],
  BT31: [9],
  BT32: [5],
  BT33: [0],
  BT34: [1, 2, 3, 4, 5],
  BT35: [0, 6, 7, 8, 9],
  BT60: null,
};

// Valid letters for UK postcode incode positions (excludes C, I, K, M, O, V)
const INCODE_LETTERS = "ABDEFGHJLNPQRSTUWXYZ".split("");

function generateForPrefix(prefix, sectors) {
  const postcodes = [];

  if (!sectors) {
    sectors = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  }

  for (const digit of sectors) {
    for (const letter1 of INCODE_LETTERS) {
      for (const letter2 of INCODE_LETTERS) {
        postcodes.push(`${prefix} ${digit}${letter1}${letter2}`);
      }
    }
  }

  return postcodes;
}

function main() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  const allPostcodes = [];
  let totalGenerated = 0;

  for (const [prefix, sectors] of Object.entries(NMD_PREFIXES_AND_SECTORS)) {
    const postcodes = generateForPrefix(prefix, sectors);
    totalGenerated += postcodes.length;

    const outPath = path.join(DATA_DIR, `postcodes-${prefix.toLowerCase()}.json`);
    fs.writeFileSync(outPath, JSON.stringify(postcodes, null, 2) + "\n");
    const sectorDesc = sectors ? sectors.join(",") : "0-9";
    console.log(`${prefix} (sectors ${sectorDesc}): ${postcodes.length} postcodes -> ${outPath}`);

    allPostcodes.push(...postcodes);
  }

  const combinedPath = path.join(DATA_DIR, "all-postcodes.json");
  fs.writeFileSync(combinedPath, JSON.stringify(allPostcodes, null, 2) + "\n");

  console.log(`\nTotal: ${totalGenerated} postcodes across ${Object.keys(NMD_PREFIXES_AND_SECTORS).length} prefixes`);
  console.log(`Saved to: ${combinedPath}`);
  console.log(`\nNext: run 'node direct-lookup.js' to look these up on the council website`);
}

main();
