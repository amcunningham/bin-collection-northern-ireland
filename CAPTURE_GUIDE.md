Capturing Bin Collection Data - Newry, Mourne & Down
====================================================

The council website doesn't have a public API, so we need to manually
capture the postcode-to-zone mapping and schedule data. This guide
explains how.

## What we need

Two pieces of data:

1. **Postcode-to-zone mapping** - which day and zone each postcode belongs to
2. **Schedule data** - the actual collection dates for each day-zone combo

## Step 1: Capture the postcode-to-zone mapping

### Using browser devtools

1. Go to https://www.newrymournedown.org/weekly-bin-collection-and-calendar
2. Open browser DevTools (F12 or Cmd+Opt+I)
3. Go to the **Network** tab, filter by **XHR/Fetch**
4. Select a postcode prefix (e.g. BT34) and enter the second part
5. Click **SEARCH**
6. Watch the Network tab for requests - look for:
   - The request URL (this is the internal API endpoint)
   - The response data (should contain day and zone info)
7. Note down the URL pattern and response format

### What to record

For each postcode you test, add an entry to `data/zones.json`:

```json
{
  "postcodes": {
    "BT34 1AB": { "day": "FRI", "zone": "Z1" },
    "BT34 2CD": { "day": "MON", "zone": "Z2" }
  }
}
```

### Postcode areas to cover

The council covers these BT postcode prefixes:
- BT23, BT24, BT25, BT27, BT30, BT31, BT33, BT34, BT39

### Tip: look at the page source

The postcode-to-zone mapping might be embedded directly in the page's
JavaScript rather than fetched via an API call. Check:

- View Page Source (Ctrl+U) and search for "zone" or "Z1"
- Check the Network tab for any .js files loaded that contain mapping data
- Look at the HTML for hidden form fields or data attributes

If the mapping is in a JS file, that's the jackpot - we can parse the
whole thing in one go.

## Step 2: Capture schedule data from PDFs

The council publishes PDF calendars at predictable URLs:

```
https://www.newrymournedown.org/bin-collections/{DAY}-{ZONE}.pdf
```

For example: `FRI-Z1.pdf`, `MON-Z2.pdf`, etc.

### To extract dates from a PDF

1. Download the PDF for each day-zone combination
2. Open it and note down the collection dates for each bin type:
   - **Black bin** dates (fortnightly)
   - **Blue bin** dates (fortnightly, alternating with black)
   - **Brown bin** - collected weekly, so no specific dates needed
3. Add the dates to `data/schedules.json`

### Finding all valid day-zone combinations

Try accessing each combination to see which ones exist:

```
MON-Z1, MON-Z2, MON-Z3, ...
TUE-Z1, TUE-Z2, TUE-Z3, ...
WED-Z1, WED-Z2, WED-Z3, ...
THU-Z1, THU-Z2, THU-Z3, ...
FRI-Z1, FRI-Z2, FRI-Z3, ...
```

Not all combinations will exist. The 404s tell you which ones are invalid.

## Step 3: Verify

Once you have some data populated:

1. Run the app: `npm start`
2. Open http://localhost:3000
3. Enter a postcode you've mapped
4. Check the dates shown match the PDF calendar
5. Cross-check with the council's own lookup tool

## Automating this later

Once we understand the API endpoint structure from Step 1, we could
potentially automate the postcode capture with a script. But start
manually to understand the data first.

The PDF parsing could also be automated with a tool like `pdf-parse` or
`pdfplumber` (Python), but manual entry for a proof-of-concept is fine.
