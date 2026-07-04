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
5. **Open email to your MP** launches a `mailto:` message in the visitor's own
   email client, pre-addressed and pre-filled — they read it and press send
   themselves, so it comes genuinely from them as a constituent.

If Parliament publishes no email for an MP, the page falls back to
[WriteToThem](https://www.writetothem.com/), which delivers to any MP by
postcode, plus a **Copy letter** button.

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
