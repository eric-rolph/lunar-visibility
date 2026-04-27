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

const markerIcon = L.icon({
  iconRetinaUrl: markerIcon2xUrl,
  iconUrl: markerIconUrl,
  shadowUrl: markerShadowUrl,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
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
const readout = document.querySelector<HTMLElement>("#readout")!;
const message = document.querySelector<HTMLDivElement>("#message")!;
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
let marker = L.marker([CENTENNIAL.lat, CENTENNIAL.lng], { icon: markerIcon }).addTo(map);
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
  status.value = "Updating map";

  gridWorker?.terminate();
  gridWorker = new Worker(new URL("./visibilityGrid.worker.ts", import.meta.url), { type: "module" });
  gridWorker.addEventListener("message", (event) => {
    const message = event.data;
    if (message.type !== "grid" || message.id !== requestId) {
      return;
    }
    renderGrid(message.cells);
    status.value = "Map updated";
    status.title = `${message.cells.length} visibility cells rendered`;
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

function renderGrid(
  cells: Array<{ south: number; west: number; north: number; east: number; color: string; zone: string; q: number; odehZone: string }>
): void {
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
        fillOpacity: 0.32,
        interactive: true
      }
    )
      .bindTooltip(`Yallop ${cell.zone} | q ${cell.q.toFixed(3)} | Odeh ${cell.odehZone}`, {
        sticky: true,
        opacity: 0.95
      })
      .addTo(fragment);
  }

  renderLayer.removeFrom(map);
  renderLayer = fragment.addTo(map);
}

async function samplePoint(options: { syncMarker: boolean } = { syncMarker: true }): Promise<void> {
  if (!controls.reportValidity()) {
    return;
  }

  const lat = parseRequiredNumber(latInput);
  const lng = parseRequiredNumber(lngInput);
  const elevation = parseRequiredNumber(elevationInput);
  if (lat === null || lng === null || elevation === null) {
    status.value = "Invalid point";
    return;
  }

  if (options.syncMarker) {
    const latLng = L.latLng(lat, lng);
    marker.setLatLng(latLng);
    map.panTo(latLng, { animate: true });
  }

  status.value = "Checking";
  const url = new URL("/api/visibility", API_BASE_URL || window.location.origin);
  url.searchParams.set("date", dateInput.value);
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lng", String(lng));
  url.searchParams.set("elevationMeters", String(elevation));

  try {
    const response = await fetch(url);
    const body = await response.json();
    if (!response.ok) {
      throw new Error(body.message ?? body.error ?? "Point API failed");
    }
    hideMessage();
    updateReadout(body as VisibilityResponse);
    status.value = "Ready";
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to sample point";
    readout.dataset.zone = "X";
    showMessage(message, "error");
    yallop.textContent = "Unavailable";
    odeh.textContent = "-";
    bestTime.textContent = "-";
    angles.textContent = "-";
    width.textContent = "-";
    status.value = "Point unavailable";
  }
}

function updateReadout(result: VisibilityResponse): void {
  if (!result.ephemeris.diagnostics.modelApplicable) {
    readout.dataset.zone = "X";
    showMessage(result.ephemeris.diagnostics.modelWarning ?? "Model not applicable for this date/location.", "warning");
    yallop.textContent = "Outside crescent window";
    yallop.title = result.ephemeris.diagnostics.modelWarning ?? "";
    odeh.textContent = result.ephemeris.diagnostics.modelWarning ?? "Model not applicable";
    odeh.title = odeh.textContent;
  } else {
    readout.dataset.zone = result.criteria.yallop.zone;
    hideMessage();
    yallop.textContent = `${result.criteria.yallop.zone} q ${result.criteria.yallop.q.toFixed(3)} - ${result.criteria.yallop.label}`;
    yallop.title = result.criteria.yallop.label;
    odeh.textContent = `${result.criteria.odeh.zone} V ${result.criteria.odeh.v.toFixed(2)} - ${result.criteria.odeh.label}`;
    odeh.title = result.criteria.odeh.label;
  }
  bestTime.textContent = formatBestTime(result.times.bestTimeUtc);
  angles.textContent = `${result.ephemeris.arcvDeg.toFixed(2)} / ${result.ephemeris.dazDeg.toFixed(2)} deg`;
  width.textContent = `${result.ephemeris.crescentWidthArcMin.toFixed(3)} arcmin`;
}

function parseRequiredNumber(input: HTMLInputElement): number | null {
  if (input.value.trim() === "") {
    input.setCustomValidity(`${input.name || "value"} is required.`);
    input.reportValidity();
    input.setCustomValidity("");
    return null;
  }
  const value = Number(input.value);
  return Number.isFinite(value) ? value : null;
}

function showMessage(text: string, tone: "warning" | "error"): void {
  message.hidden = false;
  message.dataset.tone = tone;
  message.textContent = text;
}

function hideMessage(): void {
  message.hidden = true;
  message.textContent = "";
  delete message.dataset.tone;
}

function formatBestTime(isoUtc: string): string {
  const date = new Date(isoUtc);
  const local = date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short"
  });
  return `${local} (your timezone)`;
}
