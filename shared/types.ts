export type YallopZoneCode = "A" | "B" | "C" | "D" | "E" | "F";
export type OdehZoneCode = "A" | "B" | "C" | "D";

export interface VisibilityInput {
  date: string;
  lat: number;
  lng: number;
  elevationMeters: number;
}

export interface HorizontalBody {
  altitudeDeg: number;
  azimuthDeg: number;
  rightAscensionHours: number;
  declinationDeg: number;
  distanceAu: number;
}

export interface VisibilityTimes {
  sunsetUtc: string;
  moonsetUtc: string;
  bestTimeUtc: string;
  lagMinutes: number;
}

export interface YallopCriterion {
  q: number;
  zone: YallopZoneCode;
  label: string;
  color: string;
}

export interface OdehCriterion {
  v: number;
  zone: OdehZoneCode;
  label: string;
  color: string;
}

export interface VisibilityResponse {
  input: VisibilityInput;
  times: VisibilityTimes;
  ephemeris: {
    sun: HorizontalBody;
    moon: HorizontalBody;
    arcvDeg: number;
    dazDeg: number;
    arclDeg: number;
    crescentWidthArcMin: number;
    moonPhaseDeg: number;
    diagnostics: {
      moonApparentAltitudeDeg: number;
      sunApparentAltitudeDeg: number;
      moonAirmass: number | null;
      waxingEveningCrescent: boolean;
      danjonLimited: boolean;
      modelApplicable: boolean;
      modelWarning: string | null;
    };
  };
  criteria: {
    yallop: YallopCriterion;
    odeh: OdehCriterion;
  };
}
