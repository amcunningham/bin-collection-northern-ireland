const express = require("express");
const path = require("path");
const fs = require("fs");
const { generateDates, DAY_NAMES, REF_DAY_PREFIX, addDays } = require("./generate-dates");

const app = express();
const PORT = process.env.PORT || 3000;

// Load postcode-to-zone mapping
const zonesData = JSON.parse(
  fs.readFileSync(path.join(__dirname, "data", "zones.json"), "utf8")
);

app.use(express.static(path.join(__dirname, "public")));

// Lookup endpoint: given a postcode, return the next collection dates
app.get("/api/lookup", (req, res) => {
  const postcode = (req.query.postcode || "").trim().toUpperCase();

  if (!postcode) {
    return res.status(400).json({ error: "Postcode is required" });
  }

  // Find the zone for this postcode
  const zoneInfo = zonesData.postcodes[postcode];
  if (!zoneInfo) {
    return res.status(404).json({
      error: "Postcode not found",
      message:
        "This postcode is not in our database yet. Newry, Mourne and Down postcodes start with: " +
        zonesData._postcodeAreas.join(", "),
    });
  }

  const today = new Date().toISOString().split("T")[0];
  // Generate dates for the next 12 weeks (4 cycles of each bin)
  const endDate = addDays(today, 84);
  const dates = generateDates(zoneInfo.day, today, endDate);

  const nextCollections = getNextCollections(dates, today);

  res.json({
    postcode,
    day: DAY_NAMES[zoneInfo.day],
    zone: zoneInfo.zone,
    ref: `${REF_DAY_PREFIX[zoneInfo.day]} ${zoneInfo.zone}`,
    nextCollections,
  });
});

// Lookup by collection day (when postcode isn't in the database)
app.get("/api/day", (req, res) => {
  const day = (req.query.day || "").trim().toUpperCase();

  if (!DAY_NAMES[day]) {
    return res.status(400).json({
      error: "Invalid day",
      message: "Must be one of: MON, TUE, WED, THU, FRI",
    });
  }

  const today = new Date().toISOString().split("T")[0];
  const endDate = addDays(today, 84);
  const dates = generateDates(day, today, endDate);
  const nextCollections = getNextCollections(dates, today);

  res.json({
    day: DAY_NAMES[day],
    ref: `${REF_DAY_PREFIX[day]}`,
    nextCollections,
  });
});

// List all known schedule keys (for debugging/admin)
app.get("/api/schedules", (_req, res) => {
  // Derive unique day-zone combos from the postcode mappings
  const seen = new Set();
  for (const info of Object.values(zonesData.postcodes)) {
    seen.add(`${info.day}-${info.zone}`);
  }

  res.json({
    schedules: [...seen].sort(),
    postcodeAreas: zonesData._postcodeAreas,
    totalPostcodes: Object.keys(zonesData.postcodes).length,
  });
});

function getNextCollections(dates, today) {
  const binTypes = [
    {
      key: "blue",
      colour: "#2196F3",
      label: "Blue bin (recycling)",
      description: "Clean, dry recyclables including glass",
    },
    {
      key: "brown",
      colour: "#8B4513",
      label: "Brown bin (food & garden waste)",
      description: "All food waste, small garden waste",
    },
    {
      key: "black",
      colour: "#333333",
      label: "Black bin (general waste)",
      description: "Non-recyclable household waste, no food",
    },
  ];

  const collections = [];

  for (const bin of binTypes) {
    const nextDate = dates[bin.key][0]; // already starts from today
    if (nextDate) {
      collections.push({
        binType: bin.key,
        binColour: bin.colour,
        label: bin.label,
        description: bin.description,
        frequency: "every 3 weeks",
        nextDate,
      });
    }
  }

  // Sort by next date
  collections.sort((a, b) => a.nextDate.localeCompare(b.nextDate));
  return collections;
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Bin collection lookup running at http://localhost:${PORT}`);
  console.log(
    `Postcodes loaded: ${Object.keys(zonesData.postcodes).length}`
  );
});
