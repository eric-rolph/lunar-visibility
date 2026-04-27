# Lunar Visibility Map Research Context

## Benchmarks

- B. D. Yallop, "A Method for Predicting the First Sighting of the New Crescent Moon", HM Nautical Almanac Office Technical Note No. 69.
- Mohammad Sh. Odeh, "New Criterion for Lunar Crescent Visibility", Experimental Astronomy 18, 39-64.

## Key Variables

- ARCV: airless topocentric difference in altitude between Moon and Sun, in degrees.
- DAZ: airless topocentric azimuth difference, Sun azimuth minus Moon azimuth, in degrees.
- ARCL: topocentric angular separation between Moon and Sun, in degrees.
- W: topocentric crescent width, in arc minutes.
- Best time: `sunset + (4 / 9) * lag`, where lag is the interval from sunset to moonset.

## Architecture Finding

Cloudflare Workers Free has a very small per-request CPU budget. A dense global grid would be a poor fit for one Worker request. The Worker should expose a point ephemeris API for one coordinate/date, while the browser generates the active map grid in a Web Worker and uses the same shared TypeScript math locally.

## Implementation Notes

- `astronomy-engine` supplies rise/set searches and topocentric Sun/Moon coordinates.
- Refraction is intentionally disabled for Yallop/Odeh variables because both criteria use airless topocentric ARCV.
- A diagnostic refraction/airmass field is still emitted for UX and local sanity checks.
- Default local test position is Centennial, Colorado: `39.5807, -104.8772`.
