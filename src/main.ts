import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./styles.css";
import type { VisibilityResponse } from "../shared/types";
import { classifyOdeh, classifyYallop, nextCrescentDate, visibilityStateForCode } from "../shared/visibilityMath";
import type { GridCell, GridResultMessage } from "./gridProtocol";
import markerIcon2xUrl from "leaflet/dist/images/marker-icon-2x.png";
import markerIconUrl from "leaflet/dist/images/marker-icon.png";
import markerShadowUrl from "leaflet/dist/images/marker-shadow.png";

type Criterion = "yallop" | "odeh";

interface CellPresentation {
  color: string;
  tooltip: string;
  isModelZone: boolean;
}

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
const selectedCriterion = document.querySelector<HTMLDListElement>("#selected-criterion")!;
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
const criterionInput = document.querySelector<HTMLSelectElement>("#criterion")!;
const controls = document.querySelector<HTMLFormElement>("#controls")!;
const centerButton = document.querySelector<HTMLButtonElement>("#center")!;
const exportButton = document.querySelector<HTMLButtonElement>("#export-png")!;

dateInput.value = nextCrescentDate();

let requestId = 0;
let renderLayer = L.layerGroup().addTo(map);
let marker = L.marker([CENTENNIAL.lat, CENTENNIAL.lng], { icon: markerIcon }).addTo(map);
let gridTimer: number | undefined;
let lastCells: GridCell[] = [];
let currentPoint: VisibilityResponse | null = null;
let pointAbort: AbortController | null = null;

const cellRenderer = L.canvas({ padding: 0.2 });
const gridWorker = new Worker(new URL("./visibilityGrid.worker.ts", import.meta.url), { type: "module" });
gridWorker.addEventListener("message", (event: MessageEvent<GridResultMessage>) => {
  const result = event.data;
  if (result.type !== "grid" || result.id !== requestId) {
    return;
  }
  lastCells = result.cells;
  renderGrid();
  status.value = result.truncated ? "Map updated (partial)" : "Map updated";
  status.title = `${result.cells.length} visibility cells rendered${result.truncated ? "; cell limit reached, zoom in for full coverage" : ""}`;
});

map.on("moveend zoomend", scheduleGrid);
dateInput.addEventListener("change", () => {
  scheduleGrid();
  void samplePoint({ syncMarker: false });
});
criterionInput.addEventListener("change", () => {
  updateLegend();
  renderGrid();
  if (currentPoint) {
    updateReadout(currentPoint);
  }
});
exportButton.addEventListener("click", exportCurrentMap);

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
updateLegend();
void samplePoint();

function scheduleGrid(): void {
  window.clearTimeout(gridTimer);
  gridTimer = window.setTimeout(computeGrid, 180);
}

function computeGrid(): void {
  requestId += 1;
  const bounds = map.getBounds();
  status.value = "Updating map";

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

function renderGrid(): void {
  const criterion = selectedCriterionKey();
  const bounds = map.getBounds();
  const offsets = worldCopyOffsets(bounds);
  const fragment = L.layerGroup();

  for (const cell of lastCells) {
    const presentation = presentCell(cell, criterion);
    for (const offset of offsets) {
      if (cell.east + offset < bounds.getWest() || cell.west + offset > bounds.getEast()) {
        continue;
      }
      L.rectangle(
        [
          [cell.south, cell.west + offset],
          [cell.north, cell.east + offset]
        ],
        {
          renderer: cellRenderer,
          stroke: false,
          fill: true,
          fillColor: presentation.color,
          fillOpacity: presentation.isModelZone ? 0.32 : 0.28,
          interactive: true
        }
      )
        .bindTooltip(presentation.tooltip, {
          sticky: true,
          opacity: 0.95
        })
        .addTo(fragment);
    }
  }

  fragment.addTo(map);
  renderLayer.removeFrom(map);
  renderLayer = fragment;
}

function worldCopyOffsets(bounds: L.LatLngBounds): number[] {
  const offsets: number[] = [];
  const kMin = Math.floor((bounds.getWest() + 180) / 360);
  const kMax = Math.floor((bounds.getEast() + 180) / 360);
  for (let k = kMin; k <= kMax; k += 1) {
    offsets.push(k * 360);
  }
  return offsets;
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

  pointAbort?.abort();
  pointAbort = new AbortController();

  try {
    const response = await fetch(url, { signal: pointAbort.signal });
    const body = await response.json();
    if (!response.ok) {
      throw new Error(body.message ?? body.error ?? "Point API failed");
    }
    hideMessage();
    currentPoint = body as VisibilityResponse;
    updateReadout(currentPoint);
    status.value = "Ready";
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return;
    }
    const message = error instanceof Error ? error.message : "Unable to sample point";
    readout.dataset.zone = "X";
    showMessage(message, "error");
    currentPoint = null;
    selectedCriterion.textContent = "Unavailable";
    yallop.textContent = "Unavailable";
    odeh.textContent = "-";
    bestTime.textContent = "-";
    angles.textContent = "-";
    width.textContent = "-";
    status.value = "Point unavailable";
  }
}

function updateReadout(result: VisibilityResponse): void {
  const selected = selectedCriterionKey();
  if (!result.ephemeris.diagnostics.modelApplicable) {
    const state = result.ephemeris.diagnostics.state;
    readout.dataset.zone = state.code;
    showMessage(result.ephemeris.diagnostics.modelWarning ?? "Model not applicable for this date/location.", "warning");
    selectedCriterion.textContent = state.label;
    selectedCriterion.title = state.detail;
    yallop.textContent = "Not scored";
    yallop.title = result.ephemeris.diagnostics.modelWarning ?? "";
    odeh.textContent = "Not scored";
    odeh.title = result.ephemeris.diagnostics.modelWarning ?? "";
  } else {
    const selectedResult = selected === "odeh" ? result.criteria.odeh : result.criteria.yallop;
    readout.dataset.zone = selectedResult.zone;
    hideMessage();
    selectedCriterion.textContent = formatCriterionResult(selected, result);
    selectedCriterion.title = selectedResult.label;
    yallop.textContent = `${result.criteria.yallop.label} (zone ${result.criteria.yallop.zone}, q ${result.criteria.yallop.q.toFixed(3)})`;
    yallop.title = result.criteria.yallop.label;
    odeh.textContent = `${result.criteria.odeh.label} (zone ${result.criteria.odeh.zone}, V ${result.criteria.odeh.v.toFixed(2)})`;
    odeh.title = result.criteria.odeh.label;
  }
  bestTime.textContent = formatBestTime(result.times.bestTimeUtc);
  angles.textContent = `${result.ephemeris.arcvDeg.toFixed(2)} / ${result.ephemeris.dazDeg.toFixed(2)} deg`;
  width.textContent = `${result.ephemeris.crescentWidthArcMin.toFixed(3)} arcmin`;
}

function selectedCriterionKey(): Criterion {
  return criterionInput.value === "odeh" ? "odeh" : "yallop";
}

function formatCriterionResult(criterion: Criterion, result: VisibilityResponse): string {
  if (criterion === "odeh") {
    return `Odeh ${result.criteria.odeh.zone}: ${result.criteria.odeh.label} (V ${result.criteria.odeh.v.toFixed(2)})`;
  }

  return `Yallop ${result.criteria.yallop.zone}: ${result.criteria.yallop.label} (q ${result.criteria.yallop.q.toFixed(3)})`;
}

function presentCell(cell: GridCell, criterion: Criterion): CellPresentation {
  if (cell.state !== "VISIBLE_MODEL" || cell.q === undefined || cell.v === undefined) {
    const state = visibilityStateForCode(cell.state);
    return {
      color: state.color,
      tooltip: `${state.label}: ${state.detail}`,
      isModelZone: false
    };
  }

  const yallop = classifyYallop(cell.q);
  const odeh = classifyOdeh(cell.v);
  const selected = criterion === "odeh" ? odeh : yallop;
  const value = criterion === "odeh" ? `V ${odeh.v.toFixed(2)}` : `q ${yallop.q.toFixed(3)}`;
  return {
    color: selected.color,
    tooltip: `${selected.label} | ${criterion.toUpperCase()} ${selected.zone} | ${value} | Yallop ${yallop.zone} | Odeh ${odeh.zone}`,
    isModelZone: true
  };
}

function updateLegend(): void {
  const yallopLabels = {
    A: "Easily visible unaided",
    B: "Perfect conditions",
    C: "May need optical aid first",
    D: "Optical aid only",
    E: "Telescope-limit / very unlikely",
    F: "Not visible"
  };
  const odehLabels = {
    A: "Visible unaided",
    B: "May be visible unaided, aid helps",
    C: "Optical aid only",
    D: "Not visible with optical aid"
  };
  const labels = selectedCriterionKey() === "odeh" ? odehLabels : yallopLabels;

  for (const zone of ["A", "B", "C", "D", "E", "F"] as const) {
    const item = document.querySelector<HTMLElement>(`.legend [data-zone="${zone}"]`);
    if (!item) continue;
    const label = labels[zone as keyof typeof labels];
    item.hidden = !label;
    item.innerHTML = `<span></span><b>${zone}</b> ${label ?? ""}`;
  }
}

function exportCurrentMap(): void {
  const size = map.getSize();
  const canvas = document.createElement("canvas");
  canvas.width = size.x;
  canvas.height = size.y;
  const context = canvas.getContext("2d");
  if (!context) {
    showMessage("Unable to export this browser view.", "error");
    return;
  }

  context.fillStyle = "#111821";
  context.fillRect(0, 0, canvas.width, canvas.height);
  drawGraticule(context, canvas.width, canvas.height);

  const criterion = selectedCriterionKey();
  const exportOffsets = worldCopyOffsets(map.getBounds());
  for (const cell of lastCells) {
    const presentation = presentCell(cell, criterion);
    context.fillStyle = withAlpha(presentation.color, presentation.isModelZone ? 0.7 : 0.58);
    for (const offset of exportOffsets) {
      const nw = map.latLngToContainerPoint([cell.north, cell.west + offset]);
      const se = map.latLngToContainerPoint([cell.south, cell.east + offset]);
      context.fillRect(nw.x, nw.y, se.x - nw.x, se.y - nw.y);
    }
  }

  context.fillStyle = "rgba(11, 13, 16, 0.82)";
  context.fillRect(16, 16, Math.min(430, canvas.width - 32), 74);
  context.fillStyle = "#f7f1e6";
  context.font = "700 18px Inter, system-ui, sans-serif";
  context.fillText("Lunar Crescent Visibility", 30, 43);
  context.font = "13px Inter, system-ui, sans-serif";
  context.fillStyle = "#c8d3dc";
  context.fillText(`${dateInput.value} | ${selectedCriterionKey().toUpperCase()} criterion | generated from current viewport`, 30, 66);

  canvas.toBlob((blob) => {
    if (!blob) {
      showMessage("Unable to export this browser view.", "error");
      return;
    }
    const link = document.createElement("a");
    const objectUrl = URL.createObjectURL(blob);
    link.download = `lunar-visibility-${dateInput.value}-${selectedCriterionKey()}.png`;
    link.href = objectUrl;
    link.style.display = "none";
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    status.value = "PNG exported";
  }, "image/png");
}

function drawGraticule(context: CanvasRenderingContext2D, width: number, height: number): void {
  context.strokeStyle = "rgba(255, 255, 255, 0.12)";
  context.lineWidth = 1;
  for (let x = 0; x <= width; x += Math.max(80, width / 8)) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
  }
  for (let y = 0; y <= height; y += Math.max(70, height / 6)) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }
}

function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgb(${red} ${green} ${blue} / ${alpha})`;
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
