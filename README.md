# Lunar Crescent Visibility Map

Cloudflare Pages + Workers app for global first-crescent visibility using Yallop q and Odeh V criteria.

## Local Development

```bash
cd apps/lunar-visibility
npm install
npm run dev:worker
npm run dev
```

Open `http://127.0.0.1:5173`. The map defaults to Centennial, Colorado.

## API

```bash
curl "http://127.0.0.1:8787/api/visibility?date=2026-03-19&lat=39.5807&lng=-104.8772&elevationMeters=1777"
```

The Worker is intentionally point-based so Cloudflare Free CPU limits are respected. The browser Web Worker generates map grids and applies Yallop/Odeh classification client-side.

## Deployment

GitHub Actions expect:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

The Worker deploy workflow runs when `apps/lunar-visibility/worker/**` or shared math changes. The Pages workflow builds `apps/lunar-visibility/dist` and deploys it as the `lunar-visibility` Pages project.
