# Castle Rock Conditions Dashboard

<p>
	<img src="public/images/crsp-hands.png" alt="Castle Rock hand image 1" height="300" />
</p>

This is a static React dashboard that checks Castle Rock climbing conditions from the [Ben Lomond station on the NOAA site](https://forecast.weather.gov/MapClick.php?lon=-122.10464186850001&lat=37.23500005365938#.ZGzoAuzMKDX). The site is built to show temperature, humidity, fuel moisture, wind speed, and precipitation history in an interactive plot. This site was created entirely via vibe coding with the GPT-5.3-Codex model.

## Local Development

1. Install dependencies with `npm ci`.
2. Generate a local demo dataset with `npm run sync:sample`.
3. Start the app with `npm run dev`.

## Synoptic Pipeline

Create a local `.env` from `.env.example`. The Node scripts load that file automatically.

- `SYNOPTIC_API_TOKEN`: your Synoptic API token
- `SYNOPTIC_STATION_ID`: optional, defaults to `BNDC1`

Useful commands:

- `npm run discover:station`
- `npm run sync:synoptic -- --recent=10080`
- `npm run sync:synoptic -- --start=202401010000 --end=202412312359`
- `npm run backfill:range -- --start=202001010000 --end=202512312359`
- `npm run build:data`
- `npm run validate:data`

`backfill:range` fetches a larger historical span in monthly request chunks, merges with existing monthly files, and rebuilds the manifest automatically.

The frontend is static and only reads the generated files under `public/data`.

## Deployment

Two GitHub Actions workflows are included:

- `Deploy Site`: builds and publishes the current repo state to GitHub Pages
- `Refresh Synoptic Data`: scheduled refresh using `SYNOPTIC_API_TOKEN` from repository secrets, then rebuilds and redeploys

Because the app is deployed to GitHub Pages, the API token is never sent to the browser.
