import {
  Body,
  Equator,
  Horizon,
  Illumination,
  KM_PER_AU,
  MoonPhase,
  Observer,
  SearchMoonPhase,
  SearchRiseSet
} from "astronomy-engine";
import type {
  HorizontalBody,
  OdehCriterion,
  OdehZoneCode,
  VisibilityResponse,
  VisibilityState,
  VisibilityStateCode,
  YallopCriterion,
  YallopZoneCode
} from "./types";

const MOON_RADIUS_KM = 1737.4;
const MS_PER_DAY = 86_400_000;

// Single source of truth for map/legend/readout colors, tuned for a dark basemap.
export const YALLOP_ZONE_COLORS: Record<YallopZoneCode, string> = {
  A: "#2dd4a4",
  B: "#a3e635",
  C: "#fbbf24",
  D: "#fb923c",
  E: "#f87171",
  F: "#dc2626"
};

export const ODEH_ZONE_COLORS: Record<OdehZoneCode, string> = {
  A: "#2dd4a4",
  B: "#a3e635",
  C: "#fb923c",
  D: "#dc2626"
};

const VISIBILITY_STATES: Record<VisibilityStateCode, VisibilityState> = {
  VISIBLE_MODEL: {
    code: "VISIBLE_MODEL",
    label: "Criterion applies",
    color: "#64748b",
    detail: "The crescent is inside the Yallop/Odeh first-visibility model domain."
  },
  IMPOSSIBLE: {
    code: "IMPOSSIBLE",
    label: "No evening window",
    color: "#7c3aed",
    detail: "The Moon is below the horizon at sunset or sets before the Sun, so there is no crescent window this evening."
  },
  NOT_POSSIBLE: {
    code: "NOT_POSSIBLE",
    label: "Below visibility limit",
    color: "#881337",
    detail: "The geometry is below a physical first-crescent visibility limit."
  },
  OUT_OF_MODEL: {
    code: "OUT_OF_MODEL",
    label: "Out of model range",
    color: "#475569",
    detail: "The date/location is outside the early waxing crescent range these criteria are intended for."
  },
  UNKNOWN: {
    code: "UNKNOWN",
    label: "Unknown",
    color: "#52525b",
    detail: "A high-latitude or horizon edge case prevented a reliable sunset/moonset calculation."
  }
};

export function classifyYallop(q: number): YallopCriterion {
  if (q > 0.216) {
    return { q, zone: "A", label: "Easily visible unaided", color: YALLOP_ZONE_COLORS.A };
  }
  if (q > -0.014) {
    return { q, zone: "B", label: "Visible under perfect conditions", color: YALLOP_ZONE_COLORS.B };
  }
  if (q > -0.16) {
    return { q, zone: "C", label: "Optical aid may be needed first", color: YALLOP_ZONE_COLORS.C };
  }
  if (q > -0.232) {
    return { q, zone: "D", label: "Optical aid required", color: YALLOP_ZONE_COLORS.D };
  }
  if (q > -0.293) {
    return { q, zone: "E", label: "Below normal telescope detection", color: YALLOP_ZONE_COLORS.E };
  }
  return { q, zone: "F", label: "Not visible, below Danjon limit", color: YALLOP_ZONE_COLORS.F };
}

export function classifyOdeh(v: number): OdehCriterion {
  if (v >= 5.65) {
    return { v, zone: "A", label: "Visible unaided", color: ODEH_ZONE_COLORS.A };
  }
  if (v >= 2) {
    return { v, zone: "B", label: "May be visible unaided, optical aid helps", color: ODEH_ZONE_COLORS.B };
  }
  if (v >= -0.96) {
    return { v, zone: "C", label: "Visible by optical aid only", color: ODEH_ZONE_COLORS.C };
  }
  return { v, zone: "D", label: "Not visible even by optical aid", color: ODEH_ZONE_COLORS.D };
}

export function visibilityStateForCode(code: VisibilityStateCode): VisibilityState {
  return VISIBILITY_STATES[code];
}

export function visibilityStateForErrorCode(code: string): VisibilityState {
  if (code === "MOON_BELOW_HORIZON_AT_SUNSET" || code === "MOONSET_BEFORE_SUNSET") {
    return VISIBILITY_STATES.IMPOSSIBLE;
  }

  if (code === "SUNSET_NOT_FOUND" || code === "MOONSET_NOT_FOUND") {
    return VISIBILITY_STATES.UNKNOWN;
  }

  return VISIBILITY_STATES.OUT_OF_MODEL;
}

export function yallopQ(arcvDeg: number, crescentWidthArcMin: number): number {
  const w = crescentWidthArcMin;
  const threshold = 11.8371 - 6.3226 * w + 0.7319 * w ** 2 - 0.1018 * w ** 3;
  return (arcvDeg - threshold) / 10;
}

export function odehV(arcvDeg: number, crescentWidthArcMin: number): number {
  const w = crescentWidthArcMin;
  return arcvDeg - (-0.1018 * w ** 3 + 0.7319 * w ** 2 - 6.3226 * w + 7.1651);
}

export function calculateVisibility(input: {
  date: string;
  lat: number;
  lng: number;
  elevationMeters?: number;
}): VisibilityResponse {
  const elevationMeters = input.elevationMeters ?? 0;
  const observer = new Observer(input.lat, input.lng, elevationMeters);
  const searchStart = localCivilDaySearchStart(input.date, input.lng);
  const sunset = SearchRiseSet(Body.Sun, observer, -1, searchStart, 1.25, 0);

  if (!sunset) {
    throw new VisibilityError("SUNSET_NOT_FOUND", "Sunset was not found for this date/location.");
  }

  const moonAtSunset = horizontalBody(Body.Moon, sunset.date, observer, false);
  if (moonAtSunset.altitudeDeg <= 0) {
    throw new VisibilityError("MOON_BELOW_HORIZON_AT_SUNSET", "Moon is below the horizon at sunset for this date/location.");
  }

  const moonset = SearchRiseSet(Body.Moon, observer, -1, sunset.date, 0.75, 0);
  if (!moonset) {
    throw new VisibilityError("MOONSET_NOT_FOUND", "Moonset was not found after sunset for this date/location.");
  }

  const lagMinutes = (moonset.date.getTime() - sunset.date.getTime()) / 60_000;
  if (lagMinutes <= 0 || lagMinutes > 12 * 60) {
    throw new VisibilityError("MOONSET_BEFORE_SUNSET", "Moonset occurs before sunset at this date/location.");
  }

  const bestTime = new Date(sunset.date.getTime() + lagMinutes * 60_000 * (4 / 9));
  return calculateVisibilityAtBestTime(input.date, input.lat, input.lng, elevationMeters, sunset.date, moonset.date, bestTime);
}

export function calculateVisibilityAtBestTime(
  date: string,
  lat: number,
  lng: number,
  elevationMeters: number,
  sunset: Date,
  moonset: Date,
  bestTime: Date
): VisibilityResponse {
  const observer = new Observer(lat, lng, elevationMeters);
  const sun = horizontalBody(Body.Sun, bestTime, observer, false);
  const moon = horizontalBody(Body.Moon, bestTime, observer, false);
  const apparentSun = horizontalBody(Body.Sun, bestTime, observer, true);
  const apparentMoon = horizontalBody(Body.Moon, bestTime, observer, true);
  const arcvDeg = moon.altitudeDeg - sun.altitudeDeg;
  const dazDeg = normalizeSignedDegrees(sun.azimuthDeg - moon.azimuthDeg);
  const arclDeg = angularSeparationDeg(sun, moon);
  const crescentWidthArcMin = crescentWidth(bestTime, moon.distanceAu, arclDeg);
  const q = yallopQ(arcvDeg, crescentWidthArcMin);
  const v = odehV(arcvDeg, crescentWidthArcMin);
  const lagMinutes = (moonset.getTime() - sunset.getTime()) / 60_000;
  const phaseDeg = MoonPhase(bestTime);
  const modelWarning = modelApplicabilityWarning(phaseDeg, arclDeg, moon.altitudeDeg, sun.altitudeDeg);
  const state = modelWarning ? visibilityStateForModelWarning(modelWarning) : VISIBILITY_STATES.VISIBLE_MODEL;

  return {
    input: { date, lat, lng, elevationMeters },
    times: {
      sunsetUtc: sunset.toISOString(),
      moonsetUtc: moonset.toISOString(),
      bestTimeUtc: bestTime.toISOString(),
      lagMinutes
    },
    ephemeris: {
      sun,
      moon,
      arcvDeg,
      dazDeg,
      arclDeg,
      crescentWidthArcMin,
      moonPhaseDeg: phaseDeg,
      diagnostics: {
        state,
        moonApparentAltitudeDeg: apparentMoon.altitudeDeg,
        sunApparentAltitudeDeg: apparentSun.altitudeDeg,
        moonAirmass: opticalAirmass(apparentMoon.altitudeDeg),
        waxingEveningCrescent: phaseDeg > 0 && phaseDeg < 90 && moon.altitudeDeg > sun.altitudeDeg,
        danjonLimited: arclDeg < 6.4,
        modelApplicable: modelWarning === null,
        modelWarning
      }
    },
    criteria: {
      yallop: classifyYallop(q),
      odeh: classifyOdeh(v)
    }
  };
}

export class VisibilityError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

function horizontalBody(body: Body, date: Date, observer: Observer, refraction: boolean): HorizontalBody {
  const equ = Equator(body, date, observer, true, true);
  const hor = Horizon(date, observer, equ.ra, equ.dec, refraction ? "normal" : undefined);
  return {
    altitudeDeg: hor.altitude,
    azimuthDeg: hor.azimuth,
    rightAscensionHours: equ.ra,
    declinationDeg: equ.dec,
    distanceAu: equ.dist
  };
}

function angularSeparationDeg(a: HorizontalBody, b: HorizontalBody): number {
  const ra1 = hoursToRad(a.rightAscensionHours);
  const ra2 = hoursToRad(b.rightAscensionHours);
  const dec1 = degToRad(a.declinationDeg);
  const dec2 = degToRad(b.declinationDeg);
  const cosAngle = Math.sin(dec1) * Math.sin(dec2) + Math.cos(dec1) * Math.cos(dec2) * Math.cos(ra1 - ra2);
  return radToDeg(Math.acos(clamp(cosAngle, -1, 1)));
}

function crescentWidth(date: Date, moonDistanceAu: number, arclDeg: number): number {
  const topocentricDistanceKm = moonDistanceAu * KM_PER_AU;
  const semiDiameterArcMin = radToDeg(Math.asin(MOON_RADIUS_KM / topocentricDistanceKm)) * 60;
  const elongationFactor = 1 - Math.cos(degToRad(arclDeg));
  const illumination = Illumination(Body.Moon, date);
  const phaseGuard = illumination.phase_fraction > 0 && illumination.phase_fraction < 1 ? 1 : 0;
  return semiDiameterArcMin * elongationFactor * phaseGuard;
}

function localCivilDaySearchStart(date: string, lng: number): Date {
  const { year, month, day } = parseIsoDate(date);
  const localNoonUtc = Date.UTC(year, month - 1, day, 12, 0, 0) - (lng / 15) * 3_600_000;
  return new Date(localNoonUtc - 12 * 3_600_000);
}

export function nextCrescentDate(from = new Date()): string {
  const newMoon = SearchMoonPhase(0, from, 40);
  if (!newMoon) {
    return toIsoDate(new Date(from.getTime() + MS_PER_DAY));
  }
  // Pick the evening where first sightings realistically begin: a conjunction
  // early in the UTC day makes that same UTC date the borderline evening, while
  // a late conjunction pushes it to the next day. Always adding a day lands on
  // an evening where the crescent is already easy across most longitudes.
  const offsetDays = newMoon.date.getUTCHours() < 12 ? 0 : 1;
  return toIsoDate(new Date(newMoon.date.getTime() + offsetDays * MS_PER_DAY));
}

function parseIsoDate(date: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) {
    throw new VisibilityError("INVALID_DATE", "date must use YYYY-MM-DD format.");
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const roundTrip = new Date(Date.UTC(year, month - 1, day));
  if (
    year < 1900 ||
    year > 2100 ||
    roundTrip.getUTCFullYear() !== year ||
    roundTrip.getUTCMonth() !== month - 1 ||
    roundTrip.getUTCDate() !== day
  ) {
    throw new VisibilityError("INVALID_DATE", "date must be a real UTC calendar date from 1900 to 2100.");
  }

  return { year, month, day };
}

function modelApplicabilityWarning(phaseDeg: number, arclDeg: number, moonAltitudeDeg: number, sunAltitudeDeg: number): string | null {
  if (phaseDeg <= 0 || phaseDeg > 45) {
    return "Outside the early waxing crescent phase window.";
  }
  if (arclDeg < 6.4) {
    return "Below the Danjon-limit elongation for first-crescent visibility.";
  }
  if (arclDeg > 30) {
    return "Moon-Sun separation is beyond the first-crescent visibility model range.";
  }
  if (moonAltitudeDeg <= sunAltitudeDeg) {
    return "Moon is not above the Sun at the computed best time.";
  }
  return null;
}

function visibilityStateForModelWarning(modelWarning: string): VisibilityState {
  if (modelWarning.includes("Danjon") || modelWarning.includes("not above the Sun")) {
    return VISIBILITY_STATES.NOT_POSSIBLE;
  }

  return VISIBILITY_STATES.OUT_OF_MODEL;
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function opticalAirmass(altitudeDeg: number): number | null {
  if (altitudeDeg <= -5) {
    return null;
  }
  const adjusted = Math.max(altitudeDeg, 0.05);
  return 1 / (Math.sin(degToRad(adjusted)) + 0.50572 * (adjusted + 6.07995) ** -1.6364);
}

function normalizeSignedDegrees(value: number): number {
  return ((((value + 180) % 360) + 360) % 360) - 180;
}

function degToRad(value: number): number {
  return (value * Math.PI) / 180;
}

function radToDeg(value: number): number {
  return (value * 180) / Math.PI;
}

function hoursToRad(value: number): number {
  return (value * Math.PI) / 12;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function daysBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / MS_PER_DAY;
}
