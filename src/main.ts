import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./styles.css";
import type { VisibilityResponse } from "../shared/types";
import { nextCrescentDate } from "../shared/visibilityMath";
import markerIcon2xUrl from "leaflet/dist/images/marker-icon-2x.png";
import markerIconUrl from "leaflet/dist/images/marker-icon.png";
import markerShadowUrl from "leaflet/dist/images/marker-shadow.png";

const CENTENNIAL = { lat: 39.5807, lng: -104.8772, elevationMeters: 1777 };
const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ??
  (import.meta.env.PROD ? "https://lunar-visibility-api.ericrolph.workers.dev" : "");

L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2xUrl,
  iconUrl: markerIconUrl,
  shadowUrl: markerShadowUrl
});

const map = L.map("map", {
  preferCanvas: true,
  worldCopyJump: true,
  zoomControl: false
}).setView([CENTENNIAL.lat, CENTENNIAL.lng], 4);

L.control.zoom({ position: "bottomright" }).addTo(map);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 8,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(map);

const yallop = document.querySelector<HTMLDListElement>("#yallop")!;
const odeh = document.querySelector<HTMLDListElement>("#odeh")!;
const bestTime = document.querySelector<HTMLDListElement>("#best-time")!;
const angles = document.querySelector<HTMLDListElement>("#angles")!;
const width = document.querySelector<HTMLDListElement>("#width")!;
const status = document.querySelector<HTMLOutputElement>("#status")!;
const dateInput = document.querySelector<HTMLInputElement>("#date")!;
const latInput = document.querySelector<HTMLInputElement>("#lat")!;
const lngInput = document.querySelector<HTMLInputElement>("#lng")!;
const elevationInput = document.querySelector<HTMLInputElement>("#elevation")!;
const controls = document.querySelector<HTMLFormElement>("#controls")!;
const centerButton = document.querySelector<HTMLButtonElement>("#center")!;

dateInput.value = nextCrescentDate();

let requestId = 0;
let renderLayer = L.layerGroup().addTo(map);
let marker = L.marker([CENTENNIAL.lat, CENTENNIAL.lng]).addTo(map);
let gridWorker: Worker | null = null;
let gridTimer: number | undefined;

map.on("moveend zoomend", scheduleGrid);
dateInput.addEventListener("change", () => {
  scheduleGrid();
  void samplePoint({ syncMarker: false });
});

controls.addEventListener("submit", async (event) => {
  event.preventDefault();
  await samplePoint({ syncMarker: true });
});

centerButton.addEventListener("click", () => {
  latInput.value = String(CENTENNIAL.lat);
  lngInput.value = String(CENTENNIAL.lng);
  elevationInput.value = String(CENTENNIAL.elevationMeters);
  map.setView([CENTENNIAL.lat, CENTENNIAL.lng], 6);
  marker.setLatLng([CENTENNIAL.lat, CENTENNIAL.lng]);
  void samplePoint({ syncMarker: false });
});

map.on("click", (event) => {
  latInput.value = event.latlng.lat.toFixed(4);
  lngInput.value = event.latlng.lng.toFixed(4);
  marker.setLatLng(event.latlng);
  void samplePoint({ syncMarker: false });
});

scheduleGrid();
void samplePoint();

function scheduleGrid(): void {
  window.clearTimeout(gridTimer);
  gridTimer = window.setTimeout(computeGrid, 180);
}

function computeGrid(): void {
  requestId += 1;
  const bounds = map.getBounds();
  status.value = "Computing";

  gridWorker?.terminate();
  gridWorker = new Worker(new URL("./visibilityGrid.worker.ts", import.meta.url), { type: "module" });
  gridWorker.addEventListener("message", (event) => {
    const message = event.data;
    if (message.type !== "grid" || message.id !== requestId) {
      return;
    }
    renderGrid(message.cells);
    status.value = `${message.cells.length} cells`;
  });

  gridWorker.postMessage({
    type: "compute",
    id: requestId,
    date: dateInput.value,
    zoom: map.getZoom(),
    bounds: {
      south: bounds.getSouth(),
      north: bounds.getNorth(),
      west: bounds.getWest(),
      east: bounds.getEast()
    }
  });
}

function renderGrid(cells: Array<{ south: number; west: number; north: number; east: number; color: string; zone: string }>): void {
  renderLayer.clearLayers();
  const canvasRenderer = L.canvas({ padding: 0.2 });
  const fragment = L.layerGroup();

  for (const cell of cells) {
    L.rectangle(
      [
        [cell.south, cell.west],
        [cell.north, cell.east]
      ],
      {
        renderer: canvasRenderer,
        stroke: false,
        fill: true,
        fillColor: cell.color,
        fillOpacity: 0.46,
        interactive: false
      }
    ).addTo(fragment);
  }

  renderLayer.removeFrom(map);
  renderLayer = fragment.addTo(map);
}

async function samplePoint(options: { syncMarker: boolean } = { syncMarker: true }): Promise<void> {
  if (!controls.reportValidity()) {
    return;
  }

  const lat = Number(latInput.value);
  const lng = Number(lngInput.value);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    status.value = "Invalid point";
    return;
  }

  if (options.syncMarker) {
    const latLng = L.latLng(lat, lng);
    marker.setLatLng(latLng);
    map.panTo(latLng, { animate: true });
  }

  status.value = "Sampling";
  const url = new URL("/api/visibility", API_BASE_URL || window.location.origin);
  url.searchParams.set("date", dateInput.value);
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lng", String(lng));
  url.searchParams.set("elevationMeters", elevationInput.value);

  try {
    const response = await fetch(url);
    const body = await response.json();
    if (!response.ok) {
      throw new Error(body.message ?? body.error ?? "Point API failed");
    }
    updateReadout(body as VisibilityResponse);
    status.value = "Ready";
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to sample point";
    yallop.textContent = message;
    odeh.textContent = "-";
    bestTime.textContent = "-";
    angles.textContent = "-";
    width.textContent = "-";
    status.value = "Point unavailable";
  }
}

function updateReadout(result: VisibilityResponse): void {
  if (!result.ephemeris.diagnostics.modelApplicable) {
    yallop.textContent = "Outside crescent window";
    yallop.title = result.ephemeris.diagnostics.modelWarning ?? "";
    odeh.textContent = result.ephemeris.diagnostics.modelWarning ?? "Model not applicable";
    odeh.title = odeh.textContent;
  } else {
    yallop.textContent = `${result.criteria.yallop.zone} q ${result.criteria.yallop.q.toFixed(3)} - ${result.criteria.yallop.label}`;
    yallop.title = result.criteria.yallop.label;
    odeh.textContent = `${result.criteria.odeh.zone} V ${result.criteria.odeh.v.toFixed(2)} - ${result.criteria.odeh.label}`;
    odeh.title = result.criteria.odeh.label;
  }
  bestTime.textContent = new Date(result.times.bestTimeUtc).toLocaleString();
  angles.textContent = `${result.ephemeris.arcvDeg.toFixed(2)} / ${result.ephemeris.dazDeg.toFixed(2)} deg`;
  width.textContent = `${result.ephemeris.crescentWidthArcMin.toFixed(3)} arcmin`;
}
