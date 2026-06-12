import type { VisibilityStateCode } from "../shared/types";

export interface GridComputeRequest {
  type: "compute";
  id: number;
  date: string;
  zoom: number;
  bounds: {
    south: number;
    north: number;
    west: number;
    east: number;
  };
}

/**
 * One map cell. `q` and `v` are present when the ephemeris computation
 * succeeded; cells that failed a horizon/search step carry only the state.
 */
export interface GridCell {
  south: number;
  west: number;
  north: number;
  east: number;
  state: VisibilityStateCode;
  q?: number;
  v?: number;
}

export interface GridResultMessage {
  type: "grid";
  id: number;
  cells: GridCell[];
  truncated: boolean;
}

/**
 * Normalize a raw Leaflet longitude range (which may extend beyond ±180 when
 * the viewport shows wrapped world copies) into one or two segments inside
 * [-180, 180] that cover the same real-world longitudes.
 */
export function longitudeSegments(west: number, east: number): Array<{ west: number; east: number }> {
  if (east - west >= 360) {
    return [{ west: -180, east: 180 }];
  }
  const wrappedWest = ((((west + 180) % 360) + 360) % 360) - 180;
  const wrappedEast = wrappedWest + (east - west);
  if (wrappedEast <= 180) {
    return [{ west: wrappedWest, east: wrappedEast }];
  }
  return [
    { west: wrappedWest, east: 180 },
    { west: -180, east: wrappedEast - 360 }
  ];
}
