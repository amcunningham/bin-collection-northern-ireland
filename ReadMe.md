Bin Collection - Northern Ireland
=========

Tell me when to put my bins out, and which ones.

Enter your address (or postcode + street), pick your council, and get your upcoming bin collection dates with colour/type reminders.

#### Why?

Every council in Northern Ireland has its own website, its own lookup tool, and its own way of presenting the information. Some have apps, some have downloadable PDFs, some just have web forms. None of them talk to each other.

Northern Ireland is uniquely suited to a unified bin app because there are **only 11 councils** (since the 2015 local government reform). That's a manageable number to build and maintain integrations for, unlike England's 300+ councils.

People just want a simple answer: _what bin do I put out this week, and when?_

#### Why Northern Ireland first (and maybe only)?

- Only 11 councils to integrate vs 300+ in England, 32 in Scotland, 22 in Wales
- Most councils already have online lookup tools to work with
- Several councils share service providers (e.g. Bryson Recycling), reducing unique integrations
- Small enough to build, test, and maintain as a side project

### Minimum viable implementation feature list
_(don't add nice-to-haves to this list!)_

1. User enters postcode and selects their street/address
2. App determines which council area they're in
3. App shows their next bin collection date(s)
4. App shows which bin type(s) to put out (with colour coding)
5. Works on mobile browsers (responsive web app)

### Data sources - the 11 councils

| Council | Current lookup | Notes |
|---|---|---|
| Antrim & Newtownabbey | antrimandnewtownabbey.gov.uk/binchecker | Street-based lookup |
| Ards & North Down | ardsandnorthdown.gov.uk | Online lookup |
| Armagh City, Banbridge & Craigavon | armaghbanbridgecraigavon.gov.uk | Online lookup |
| Belfast | belfastcity.gov.uk/bins/collections | Also has Bin-Ovation app |
| Causeway Coast & Glens | causewaycoastandglens.gov.uk | Online lookup |
| Derry City & Strabane | recycling.derrystrabane.com | Calendar download + online |
| Fermanagh & Omagh | fermanaghomagh.com | Online lookup |
| Lisburn & Castlereagh | lisburncastlereagh.gov.uk | Online lookup |
| Mid & East Antrim | midandeastantrim.gov.uk | Online lookup |
| Mid Ulster | midulstercouncil.org | Online lookup |
| Newry, Mourne & Down | newrymournedown.org | Postcode-based checker - **proof-of-concept built** |

### Tech spec basics
_(platforms, programming languages, infrastructure)_

- **Approach**: Responsive web app (mobile-first, works everywhere)
- **Frontend**: Simple HTML/CSS/JS or lightweight framework (e.g. Svelte, plain React)
- **Backend**: Node.js or Python - needed for scraping/proxying council data
- **Data strategy**: Scrape or reverse-engineer council lookup endpoints; cache results; update schedules periodically
- **Hosting**: Low cost - Vercel, Fly.io, or similar
- **No app store needed** for MVP - just a fast mobile website

### Risks and challenges

- Council websites may change without notice, breaking scrapers
- Some councils may use CAPTCHAs or anti-scraping measures
- Data accuracy - need to handle bank holiday schedule changes
- Potential concerns from councils about scraping (though it's public data)
- Maintenance burden: 11 integrations to keep working

### Active contributors
#### Users

#### Build team

### Current top naming suggestions
_useful as a sanity check for your minimum viable implementation_

- Bin Night NI
- BinDay
- Which Bin NI

### Proof of concept - Newry, Mourne & Down

A working proof-of-concept app is in `scrapers/newry_mourne_down/`. It includes:

- Express.js server with a `/api/lookup?postcode=` endpoint
- Mobile-first HTML frontend with colour-coded bin cards
- JSON data model for postcode-to-zone mapping and schedules
- Guide for capturing data from the council website using browser devtools

**Key findings from investigating this council:**
- **3-week rotation**: Blue (recycling) -> Brown (food/garden) -> Black (general). NOT weekly/fortnightly as initially assumed.
- Zone naming varies by day: "Z" prefix for Wednesday zones, "V" prefix for Thursday zones (e.g. WED Z2, THURS V2)
- PDFs at predictable URLs: `newrymournedown.org/bin-collections/{DAY}-{ZONE}.pdf`
- Postcode lookup returns a list of individual addresses with "View Schedule" links to PDFs
- Postcode areas: BT23, BT24, BT25, BT27, BT30, BT31, BT33, BT34, BT39
- Bins must be out by 6:00am
- Site blocks automated requests (403) but PDFs and the lookup page work fine in a browser
- Existing open source project [UKBinCollectionData](https://github.com/robbrad/UKBinCollectionData) does not yet support this council

**Currently working with real data for 7 postcodes** and a manual day-selector fallback that works for all NMD residents.

To run: `cd scrapers/newry_mourne_down && npm install && npm start`

**To add more postcodes:** look up the postcode on the council website, note the REF code from the PDF (e.g. "WED Z2"), and add it to `data/zones.json`. If the schedule for that ref doesn't exist yet in `data/schedules.json`, extract the dates from the PDF.

### TODO list of next-steps
- technical
  - ~~build a proof-of-concept for one council~~ done - Newry, Mourne & Down
  - capture postcode-to-zone data for NMD using browser devtools (needs someone in the area)
  - extract schedule dates from NMD PDF calendars
  - survey remaining 10 council websites and document their lookup mechanisms
  - identify which councils share backend providers (reduces integration work)
  - check for existing open data on opendatani.gov.uk
- user research
  - talk to people in NI about how they currently find out their bin day
  - find out what information matters most (just the date? bin colour? what goes in each bin?)
  - understand if reminders/notifications are a must-have or nice-to-have
- user testing
- visual design
  - keep it dead simple - ideally one screen with the answer
  - use bin colours that match what councils actually use
- text
