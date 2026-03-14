/**
 * Date generator for Newry, Mourne & Down bin collection schedules.
 *
 * The council uses a 3-week rotation: Blue -> Brown -> Black.
 * From any known blue date, brown is +7 days and black is +14 days,
 * then each bin repeats every 21 days.
 *
 * We use a known blue date from March 2026 as the anchor for each
 * weekday. The 21-day cycle extends forward and backward indefinitely
 * (until Christmas disruptions, which are handled separately each year).
 */

function addDays(dateStr, days) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
}

// Known blue collection dates (March 2026) for each weekday.
// These are verified from manually captured council PDF data.
const BLUE_ANCHORS = {
  MON: "2026-03-09",
  TUE: "2026-03-03",
  WED: "2026-03-18",
  THU: "2026-03-19",
  FRI: "2026-03-06",
};

// The ref format used by the council varies by day
const REF_DAY_PREFIX = {
  MON: "MON",
  TUE: "TUES",
  WED: "WED",
  THU: "THURS",
  FRI: "FRI",
};

const DAY_NAMES = {
  MON: "Monday",
  TUE: "Tuesday",
  WED: "Wednesday",
  THU: "Thursday",
  FRI: "Friday",
};

/**
 * Generate 21-day interval dates within a range.
 */
function generate21DayCycle(anchor, startDate, endDate) {
  const dates = [];
  // Walk backward from anchor to find the first date >= startDate
  let current = anchor;
  while (current > startDate) {
    current = addDays(current, -21);
  }
  if (current < startDate) {
    current = addDays(current, 21);
  }
  while (current <= endDate) {
    dates.push(current);
    current = addDays(current, 21);
  }
  return dates;
}

/**
 * Generate collection dates for a given weekday.
 *
 * @param {string} day - MON, TUE, WED, THU, FRI
 * @param {string} startDate - Start of range (inclusive)
 * @param {string} endDate - End of range (inclusive)
 * @returns {{ blue: string[], brown: string[], black: string[] }}
 */
function generateDates(day, startDate, endDate) {
  const blueAnchor = BLUE_ANCHORS[day];
  if (!blueAnchor) throw new Error(`Unknown day: ${day}`);

  return {
    blue: generate21DayCycle(blueAnchor, startDate, endDate),
    brown: generate21DayCycle(addDays(blueAnchor, 7), startDate, endDate),
    black: generate21DayCycle(addDays(blueAnchor, 14), startDate, endDate),
  };
}

/**
 * Build a schedule object for any day/zone combination.
 * Zone doesn't affect the dates - all zones on the same day share
 * the same schedule (confirmed by WED Z1 = WED Z2).
 */
function buildSchedule(day, zone, startDate, endDate) {
  const dates = generateDates(day, startDate, endDate);
  return {
    day: DAY_NAMES[day],
    zone,
    ref: `${REF_DAY_PREFIX[day]} ${zone}`,
    blue: { frequency: "every 3 weeks", dates: dates.blue },
    brown: { frequency: "every 3 weeks", dates: dates.brown },
    black: { frequency: "every 3 weeks", dates: dates.black },
  };
}

/**
 * Get the next collection dates from a given date.
 */
function getNextCollectionsForDay(day, fromDate, count) {
  count = count || 3;
  const endDate = addDays(fromDate, 21 * count);
  const dates = generateDates(day, fromDate, endDate);
  return {
    blue: dates.blue[0] || null,
    brown: dates.brown[0] || null,
    black: dates.black[0] || null,
  };
}

// --- Validation against manually captured data ---

function validate() {
  const fs = require("fs");
  const path = require("path");

  const schedulesData = JSON.parse(
    fs.readFileSync(path.join(__dirname, "data", "schedules.json"), "utf8")
  );

  console.log("Validating generated dates against captured data (March 2026+)...\n");

  let allMatch = true;
  let totalDates = 0;
  let matchedDates = 0;

  for (const [key, actual] of Object.entries(schedulesData.schedules)) {
    const [day] = key.split("-");
    const actEndDates = [];
    for (const bin of ["blue", "brown", "black"]) {
      const dates = actual[bin].dates;
      if (dates.length) actEndDates.push(dates[dates.length - 1]);
    }
    // Only generate up to the last date in the actual data
    const lastActual = actEndDates.sort().pop();
    const generated = generateDates(day, "2026-03-01", lastActual);

    for (const bin of ["blue", "brown", "black"]) {
      const genDates = generated[bin];
      const actDates = actual[bin].dates.filter((d) => d >= "2026-03-01");

      const maxLen = Math.max(genDates.length, actDates.length);
      for (let i = 0; i < maxLen; i++) {
        totalDates++;
        if (genDates[i] !== actDates[i]) {
          console.log(
            `MISMATCH ${key} ${bin}[${i}]: generated=${genDates[i]} actual=${actDates[i]}`
          );
          allMatch = false;
        } else {
          matchedDates++;
        }
      }
    }
  }

  console.log(`${matchedDates}/${totalDates} dates match.`);
  if (allMatch) {
    console.log("All generated dates match! Generator is working correctly.\n");

    // Show upcoming dates for each day
    const today = new Date().toISOString().split("T")[0];
    console.log(`Upcoming collections from ${today}:`);
    for (const day of ["MON", "TUE", "WED", "THU", "FRI"]) {
      const next = getNextCollectionsForDay(day, today);
      console.log(`  ${day}: blue=${next.blue} brown=${next.brown} black=${next.black}`);
    }
  }
}

if (require.main === module) {
  validate();
}

module.exports = {
  generateDates,
  buildSchedule,
  getNextCollectionsForDay,
  BLUE_ANCHORS,
  DAY_NAMES,
  REF_DAY_PREFIX,
  addDays,
};
