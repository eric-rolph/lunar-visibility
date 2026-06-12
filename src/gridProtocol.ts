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
