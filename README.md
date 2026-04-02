# Castle Rock Conditions

<p>
	<img src="public/images/crsp-hands.png" alt="Castle Rock hand image 1" height="180" />
	<img src="public/images/crsp-hands-2.png" alt="Castle Rock hand image 2" height="180" />
	<img src="public/images/crsp-hands-3.png" alt="Castle Rock hand image 3" height="180" />
</p>

Static React dashboard for checking Castle Rock bouldering conditions from the Ben Lomond RAWS station. The site is built to show temperature, humidity, fuel moisture, wind speed, and wind direction history in an interactive plot with target lines at 60 F and 35% humidity.

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
