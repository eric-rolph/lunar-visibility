import { calculateVisibility } from "../shared/visibilityMath";

interface ComputeMessage {
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

interface GridCell {
  south: number;
  north: number;
  west: number;
  east: number;
  color: string;
  zone: string;
  q: number;
  odehZone: string;
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

        cells.push({
          south: lat,
          north: lat + step,
          west: lng,
          east: lng + step,
          color: result.ephemeris.diagnostics.modelApplicable ? result.criteria.yallop.color : "#475569",
          zone: result.ephemeris.diagnostics.modelApplicable ? result.criteria.yallop.zone : "X",
          q: result.criteria.yallop.q,
          odehZone: result.criteria.odeh.zone
        });
      } catch {
        continue;
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
