import { calculateVisibility, VisibilityError, visibilityStateForErrorCode } from "../shared/visibilityMath";
import { longitudeSegments } from "./gridProtocol";
import type { GridCell, GridComputeRequest, GridResultMessage } from "./gridProtocol";

const MAX_CELLS = 6000;
const YIELD_INTERVAL_MS = 24;
const MAX_CACHE_ENTRIES = 120_000;

type CellResult = Pick<GridCell, "state" | "q" | "v">;

let activeRequestId = 0;
let cacheDate = "";
const cellCache = new Map<string, CellResult>();

self.addEventListener("message", (event: MessageEvent<GridComputeRequest>) => {
  const request = event.data;
  if (request.type !== "compute") {
    return;
  }
  activeRequestId = request.id;
  void computeGrid(request);
});

async function computeGrid(request: GridComputeRequest): Promise<void> {
  if (cacheDate !== request.date || cellCache.size > MAX_CACHE_ENTRIES) {
    cellCache.clear();
    cacheDate = request.date;
  }

  const step = stepForZoom(request.zoom);
  const south = clamp(Math.floor(request.bounds.south / step) * step, -89, 89);
  const north = clamp(Math.ceil(request.bounds.north / step) * step, -89, 89);
  const segments = longitudeSegments(request.bounds.west, request.bounds.east).map((segment) => ({
    west: Math.max(-180, Math.floor(segment.west / step) * step),
    east: Math.min(180, Math.ceil(segment.east / step) * step)
  }));

  const cells: GridCell[] = [];
  let truncated = false;
  let lastYield = performance.now();

  outer: for (let lat = south; lat < north; lat += step) {
    for (const segment of segments) {
      for (let lng = segment.west; lng < segment.east; lng += step) {
        if (cells.length >= MAX_CELLS) {
          truncated = true;
          break outer;
        }

        cells.push({
          south: lat,
          north: lat + step,
          west: lng,
          east: lng + step,
          ...cellResult(request.date, lat + step / 2, lng + step / 2)
        });

        if (performance.now() - lastYield > YIELD_INTERVAL_MS) {
          await yieldToMessageQueue();
          if (request.id !== activeRequestId) {
            return;
          }
          lastYield = performance.now();
        }
      }
    }
  }

  if (request.id !== activeRequestId) {
    return;
  }

  const result: GridResultMessage = { type: "grid", id: request.id, cells, truncated };
  self.postMessage(result);
}

function cellResult(date: string, lat: number, lng: number): CellResult {
  const key = `${lat}|${lng}`;
  const cached = cellCache.get(key);
  if (cached) {
    return cached;
  }

  let result: CellResult;
  try {
    const visibility = calculateVisibility({ date, lat, lng, elevationMeters: 0 });
    result = {
      state: visibility.ephemeris.diagnostics.state.code,
      q: visibility.criteria.yallop.q,
      v: visibility.criteria.odeh.v
    };
  } catch (error) {
    result = {
      state: error instanceof VisibilityError ? visibilityStateForErrorCode(error.code).code : "UNKNOWN"
    };
  }

  cellCache.set(key, result);
  return result;
}

function yieldToMessageQueue(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

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
