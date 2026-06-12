# Lunar Crescent Visibility Map

Cloudflare Pages + Workers app for global first-crescent visibility using Yallop q and Odeh V criteria.

## Local Development

```bash
npm install
npm run dev:worker   # point ephemeris API on http://127.0.0.1:8787
npm run dev          # Vite frontend on http://127.0.0.1:5173 (proxies /api)
```

Open `http://127.0.0.1:5173`. The map defaults to Centennial, Colorado, and the date defaults to the evening after the next astronomical new moon.

## Tests and Checks

```bash
npm run typecheck
npm test
```

## API

```bash
curl "http://127.0.0.1:8787/api/visibility?date=2026-03-19&lat=39.5807&lng=-104.8772&elevationMeters=1777"
```

The Worker is intentionally point-based so Cloudflare Free CPU limits are respected. The browser Web Worker generates map grids and applies Yallop/Odeh classification client-side; grid cells are cached per date so panning back over an area is instant.

Other routes: `/api/openapi.json` (full OpenAPI document) and `/api/schema` (the `VisibilityResponse` schema).

## Deployment

GitHub Actions deploy on pushes to `main` and expect two repository secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

`worker.yml` deploys the Worker when `worker/**`, `shared/**`, or `openapi.json` change. `pages.yml` builds `dist/` and deploys it as the `lunar-visibility` Pages project when `src/**` or `shared/**` change.
