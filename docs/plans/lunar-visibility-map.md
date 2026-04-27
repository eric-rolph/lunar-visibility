# Lunar Visibility Map Implementation Plan

## Goal

Build a Cloudflare Pages + Workers application that renders a global new-crescent lunar visibility map using Yallop and Odeh criteria.

## API Contract

- `GET /api/visibility?date=YYYY-MM-DD&lat=number&lng=number&elevationMeters=number`
- Returns sunset, moonset, best time, topocentric Sun/Moon ephemeris, ARCV, DAZ, ARCL, crescent width, Yallop q zone, and Odeh V zone.
- `GET /api/schema` returns the JSON schema used by the response.

## Build Steps

- [x] Research benchmark variables and Cloudflare CPU constraint.
- [x] Define OpenAPI/JSON schema before astronomical implementation.
- [x] Implement shared TypeScript astronomy engine.
- [x] Implement Cloudflare Worker point API.
- [x] Implement browser Web Worker grid generator.
- [x] Implement Leaflet frontend with Centennial default.
- [x] Add tests for classification thresholds and local ephemeris shape.
- [x] Add GitHub Actions workflows for Pages and Worker deploy.
