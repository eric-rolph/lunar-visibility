import { calculateVisibility, VisibilityError, visibilityStateForErrorCode } from "../shared/visibilityMath";
import type { OdehZoneCode, VisibilityStateCode, YallopZoneCode } from "../shared/types";

type Criterion = "yallop" | "odeh";

interface ComputeMessage {
  type: "compute";
  id: number;
  date: string;
  zoom: number;
  criterion: Criterion;
  bounds: {
    south: number;
    north: number;
    west: number;
    east: number;
  };
}

interface GridCell {
  south: number;
  north: number;
  west: number;
  east: number;
  color: string;
  label: string;
  detail: string;
  state: VisibilityStateCode;
  criterion: Criterion;
  zone?: YallopZoneCode | OdehZoneCode;
  value?: number;
  yallopZone?: YallopZoneCode;
  odehZone?: OdehZoneCode;
}

self.addEventListener("message", (event: MessageEvent<ComputeMessage>) => {
  const message = event.data;
  if (message.type !== "compute") {
    return;
  }

  const step = stepForZoom(message.zoom);
  const cells: GridCell[] = [];
  const south = clamp(Math.floor(message.bounds.south / step) * step, -89, 89);
  const north = clamp(Math.ceil(message.bounds.north / step) * step, -89, 89);
  const west = Math.max(-180, Math.floor(message.bounds.west / step) * step);
  const east = Math.min(180, Math.ceil(message.bounds.east / step) * step);

  for (let lat = south; lat < north; lat += step) {
    for (let lng = west; lng < east; lng += step) {
      if (cells.length >= 6000) {
        break;
      }

      const centerLat = lat + step / 2;
      const centerLng = lng + step / 2;

      try {
        const result = calculateVisibility({
          date: message.date,
          lat: centerLat,
          lng: centerLng,
          elevationMeters: 0
        });

        const state = result.ephemeris.diagnostics.state;
        const criterion = message.criterion === "odeh" ? result.criteria.odeh : result.criteria.yallop;

        cells.push({
          south: lat,
          north: lat + step,
          west: lng,
          east: lng + step,
          color: result.ephemeris.diagnostics.modelApplicable ? criterion.color : state.color,
          label: result.ephemeris.diagnostics.modelApplicable ? criterion.label : state.label,
          detail: result.ephemeris.diagnostics.modelApplicable ? `${message.criterion.toUpperCase()} zone ${criterion.zone}` : state.detail,
          state: state.code,
          criterion: message.criterion,
          zone: result.ephemeris.diagnostics.modelApplicable ? criterion.zone : undefined,
          value: "q" in criterion ? criterion.q : criterion.v,
          yallopZone: result.criteria.yallop.zone,
          odehZone: result.criteria.odeh.zone
        });
      } catch (error) {
        if (error instanceof VisibilityError) {
          const state = visibilityStateForErrorCode(error.code);
          cells.push({
            south: lat,
            north: lat + step,
            west: lng,
            east: lng + step,
            color: state.color,
            label: state.label,
            detail: state.detail,
            state: state.code,
            criterion: message.criterion
          });
        }
      }
    }
  }

  self.postMessage({ type: "grid", id: message.id, cells });
});

function stepForZoom(zoom: number): number {
  if (zoom <= 2) return 6;
  if (zoom <= 3) return 4;
  if (zoom <= 5) return 2;
  if (zoom <= 6) return 1;
  return 0.5;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
