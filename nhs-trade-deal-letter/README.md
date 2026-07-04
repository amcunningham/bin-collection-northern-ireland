# Write to your MP — UK–US pharmaceutical trade deal

A single-page, zero-backend website that helps a constituent find their MP and
send them a letter about the NHS funding impact of the UK–US pharmaceutical
trade deal.

## How it works

Everything runs in the visitor's browser. There is no server and nothing is
stored.

1. The visitor enters their **postcode**.
2. [postcodes.io](https://postcodes.io/) resolves it to a **2024 parliamentary
   constituency**.
3. The [UK Parliament Members API](https://members-api.parliament.uk/) resolves
   the constituency to the **current MP** (name, party, photo) and, where
   published, their **email address**.
4. The letter is pre-filled with the visitor's details and the MP's, and stays
   fully **editable** so people can personalise it.
5. **Copy letter & send via WriteToThem** (the primary path) copies the letter
   and opens [WriteToThem](https://www.writetothem.com/) (by mySociety), which
   reliably delivers to any MP by postcode. The visitor pastes the letter into
   WriteToThem's message box and sends. WriteToThem intentionally does **not**
   accept a pre-filled message body via URL — it asks people to write in their
   own words — so the copy-then-paste step is by design.
6. **Or email your MP directly** (secondary) is offered when Parliament
   publishes an address for that MP: it launches a `mailto:` message,
   pre-addressed and pre-filled, in the visitor's own email client.

A standalone **Copy letter only** button is always available too.

## Running / hosting

It's a static file. Open `index.html` locally, or host the folder anywhere
(GitHub Pages, Netlify, Vercel, an S3 bucket, etc.). No build step, no
dependencies.

```
# quick local preview
python3 -m http.server 8000 --directory nhs-trade-deal-letter
# then open http://localhost:8000
```

Note: the two lookup APIs are CORS-enabled and free, but must be reachable
from the visitor's network.

## The figures

The statistics in the letter (£44.7bn cost, ~229,000 excess deaths by 2036,
~291,000 including adult social care) are the campaign-supplied claims,
reproduced in the template. The page links out to the source APIs and asks
senders to satisfy themselves of the underlying study before sending. Anyone
using this should confirm the citation and update the copy if the source
changes.

## Not affiliated

Independent civic tool. Not affiliated with the NHS, Parliament, or any party.
