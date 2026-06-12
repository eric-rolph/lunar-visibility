import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./styles.css";
import type { OdehZoneCode, VisibilityResponse, VisibilityStateCode, YallopZoneCode } from "../shared/types";
import {
  classifyOdeh,
  classifyYallop,
  nextCrescentDate,
  ODEH_ZONE_COLORS,
  visibilityStateForCode,
  YALLOP_ZONE_COLORS
} from "../shared/visibilityMath";
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
const MS_PER_DAY = 86_400_000;
const MEAN_PHASE_DEG_PER_DAY = 12.19;
const LEGEND_STATES: VisibilityStateCode[] = ["IMPOSSIBLE", "NOT_POSSIBLE", "OUT_OF_MODEL", "UNKNOWN"];
const YALLOP_LEGEND: Record<YallopZoneCode, string> = {
  A: "Easily visible unaided",
  B: "Visible under perfect conditions",
  C: "May need optical aid to find first",
  D: "Optical aid required",
  E: "Below normal telescope detection",
  F: "Not visible, below Danjon limit"
};
const ODEH_LEGEND: Record<OdehZoneCode, string> = {
  A: "Visible unaided",
  B: "May be visible unaided, aid helps",
  C: "Visible by optical aid only",
  D: "Not visible even with optical aid"
};
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
L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
  maxZoom: 8,
  subdomains: "abcd",
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
}).addTo(map);

const readout = document.querySelector<HTMLElement>("#readout")!;
const zoneBadge = document.querySelector<HTMLSpanElement>("#zone-badge")!;
const verdictLabel = document.querySelector<HTMLElement>("#verdict-label")!;
const verdictMeta = document.querySelector<HTMLSpanElement>("#verdict-meta")!;
const otherCriterion = document.querySelector<HTMLElement>("#other-criterion")!;
const bestTime = document.querySelector<HTMLElement>("#best-time")!;
const moonAge = document.querySelector<HTMLElement>("#moon-age")!;
const lagWindow = document.querySelector<HTMLElement>("#lag")!;
const angles = document.querySelector<HTMLElement>("#angles")!;
const width = document.querySelector<HTMLElement>("#width")!;
const message = document.querySelector<HTMLDivElement>("#message")!;
const status = document.querySelector<HTMLOutputElement>("#status")!;
const dateInput = document.querySelector<HTMLInputElement>("#date")!;
const latInput = document.querySelector<HTMLInputElement>("#lat")!;
const lngInput = document.querySelector<HTMLInputElement>("#lng")!;
const elevationInput = document.querySelector<HTMLInputElement>("#elevation")!;
const criterionInput = document.querySelector<HTMLSelectElement>("#criterion")!;
const controls = document.querySelector<HTMLFormElement>("#controls")!;
const centerButton = document.querySelector<HTMLButtonElement>("#center")!;
const locateButton = document.querySelector<HTMLButtonElement>("#locate")!;
const exportButton = document.querySelector<HTMLButtonElement>("#export-png")!;
const datePrev = document.querySelector<HTMLButtonElement>("#date-prev")!;
const dateNext = document.querySelector<HTMLButtonElement>("#date-next")!;
const nextNewMoon = document.querySelector<HTMLButtonElement>("#next-new-moon")!;
const legendTitle = document.querySelector<HTMLSpanElement>("#legend-title")!;
const legendBar = document.querySelector<HTMLDivElement>("#legend-bar")!;
const legendZones = document.querySelector<HTMLDivElement>("#legend-zones")!;
const legendStates = document.querySelector<HTMLDivElement>("#legend-states")!;

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
  setStatus(result.truncated ? "Map updated (partial)" : "Map updated");
  status.title = `${result.cells.length} visibility cells rendered${result.truncated ? "; cell limit reached, zoom in for full coverage" : ""}`;
});

map.on("moveend zoomend", scheduleGrid);
dateInput.addEventListener("change", onDateChanged);
datePrev.addEventListener("click", () => stepDate(-1));
dateNext.addEventListener("click", () => stepDate(1));
nextNewMoon.addEventListener("click", jumpToNextNewMoon);
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

locateButton.addEventListener("click", () => {
  if (!navigator.geolocation) {
    showMessage("Geolocation is not available in this browser.", "error");
    return;
  }
  setStatus("Locating", true);
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude, altitude } = position.coords;
      latInput.value = latitude.toFixed(4);
      lngInput.value = longitude.toFixed(4);
      elevationInput.value = String(Math.round(altitude ?? 0));
      map.setView([latitude, longitude], 6);
      marker.setLatLng([latitude, longitude]);
      void samplePoint({ syncMarker: false });
    },
    () => {
      setStatus("Ready");
      showMessage("Could not get your location. Check the browser's location permission.", "error");
    },
    { timeout: 10_000 }
  );
});

map.on("click", (event) => {
  latInput.value = event.latlng.lat.toFixed(4);
  lngInput.value = event.latlng.lng.toFixed(4);
  marker.setLatLng(event.latlng);
  void samplePoint({ syncMarker: false, openPopup: true });
});

scheduleGrid();
updateLegend();
void samplePoint();

function onDateChanged(): void {
  scheduleGrid();
  void samplePoint({ syncMarker: false });
}

function stepDate(deltaDays: number): void {
  const current = Date.parse(`${dateInput.value}T12:00:00Z`);
  if (Number.isNaN(current)) {
    return;
  }
  dateInput.value = new Date(current + deltaDays * MS_PER_DAY).toISOString().slice(0, 10);
  onDateChanged();
}

function jumpToNextNewMoon(): void {
  const current = Date.parse(`${dateInput.value}T12:00:00Z`);
  const from = Number.isNaN(current) ? new Date() : new Date(current + MS_PER_DAY);
  dateInput.value = nextCrescentDate(from);
  onDateChanged();
}

function setStatus(text: string, busy = false): void {
  status.value = text;
  if (busy) {
    status.dataset.busy = "true";
  } else {
    delete status.dataset.busy;
  }
}

function scheduleGrid(): void {
  window.clearTimeout(gridTimer);
  gridTimer = window.setTimeout(computeGrid, 180);
}

function computeGrid(): void {
  requestId += 1;
  const bounds = map.getBounds();
  setStatus("Updating map", true);

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
          fillOpacity: presentation.isModelZone ? 0.45 : 0.38,
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

async function samplePoint(
  options: { syncMarker: boolean; openPopup?: boolean } = { syncMarker: true }
): Promise<void> {
  if (!controls.reportValidity()) {
    return;
  }

  const lat = parseRequiredNumber(latInput);
  const lng = parseRequiredNumber(lngInput);
  const elevation = parseRequiredNumber(elevationInput);
  if (lat === null || lng === null || elevation === null) {
    setStatus("Invalid point");
    return;
  }

  if (options.syncMarker) {
    const latLng = L.latLng(lat, lng);
    marker.setLatLng(latLng);
    map.panTo(latLng, { animate: true });
  }

  setStatus("Checking", true);
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
    updateMarkerPopup(currentPoint, options.openPopup === true);
    setStatus("Ready");
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return;
    }
    const text = error instanceof Error ? error.message : "Unable to sample point";
    showMessage(text, "error");
    currentPoint = null;
    setVerdict("#475569", "!", "Point unavailable", "The point API could not be reached.");
    otherCriterion.textContent = "–";
    bestTime.textContent = "–";
    moonAge.textContent = "–";
    lagWindow.textContent = "–";
    angles.textContent = "–";
    width.textContent = "–";
    setStatus("Point unavailable");
  }
}

function setVerdict(color: string, badge: string, label: string, meta: string): void {
  zoneBadge.textContent = badge;
  zoneBadge.style.background = color;
  zoneBadge.style.color = textColorFor(color);
  verdictLabel.textContent = label;
  verdictMeta.textContent = meta;
  readout.style.setProperty("--accent", color);
}

function updateReadout(result: VisibilityResponse): void {
  const selected = selectedCriterionKey();
  const yallop = result.criteria.yallop;
  const odeh = result.criteria.odeh;

  if (!result.ephemeris.diagnostics.modelApplicable) {
    const state = result.ephemeris.diagnostics.state;
    setVerdict(state.color, "–", state.label, "Yallop and Odeh are not scored here");
    showMessage(result.ephemeris.diagnostics.modelWarning ?? "Model not applicable for this date/location.", "warning");
    otherCriterion.textContent = state.detail;
  } else {
    hideMessage();
    if (selected === "odeh") {
      setVerdict(odeh.color, odeh.zone, odeh.label, `Odeh zone ${odeh.zone} · V ${odeh.v.toFixed(2)}`);
      otherCriterion.textContent = `Yallop ${yallop.zone}: ${yallop.label} (q ${yallop.q.toFixed(3)})`;
    } else {
      setVerdict(yallop.color, yallop.zone, yallop.label, `Yallop zone ${yallop.zone} · q ${yallop.q.toFixed(3)}`);
      otherCriterion.textContent = `Odeh ${odeh.zone}: ${odeh.label} (V ${odeh.v.toFixed(2)})`;
    }
  }

  bestTime.textContent = formatBestTime(result.times.bestTimeUtc);
  moonAge.textContent = `≈ ${(result.ephemeris.moonPhaseDeg / MEAN_PHASE_DEG_PER_DAY).toFixed(1)} days`;
  lagWindow.textContent = `${Math.round(result.times.lagMinutes)} min after sunset`;
  angles.textContent = `${result.ephemeris.arcvDeg.toFixed(2)}° / ${result.ephemeris.dazDeg.toFixed(2)}°`;
  width.textContent = `${result.ephemeris.crescentWidthArcMin.toFixed(3)} arcmin`;
}

function updateMarkerPopup(result: VisibilityResponse, open: boolean): void {
  const selected = selectedCriterionKey();
  const criterion = selected === "odeh" ? result.criteria.odeh : result.criteria.yallop;
  const applicable = result.ephemeris.diagnostics.modelApplicable;
  const state = result.ephemeris.diagnostics.state;
  const title = applicable ? criterion.label : state.label;
  const color = applicable ? criterion.color : state.color;
  const meta = applicable
    ? `${selected === "odeh" ? `Odeh ${criterion.zone} · V ${result.criteria.odeh.v.toFixed(2)}` : `Yallop ${criterion.zone} · q ${result.criteria.yallop.q.toFixed(3)}`}`
    : (result.ephemeris.diagnostics.modelWarning ?? state.detail);

  const content = document.createElement("div");
  content.className = "marker-popup";
  const strong = document.createElement("strong");
  strong.textContent = title;
  strong.style.color = color;
  const small = document.createElement("small");
  small.textContent = meta;
  content.append(strong, small);

  marker.bindPopup(content, { closeButton: false, offset: [0, -6] });
  if (open) {
    marker.openPopup();
  }
}

function textColorFor(hex: string): string {
  const value = hex.replace("#", "");
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  return luminance > 140 ? "#0b1310" : "#f7f1e6";
}

function selectedCriterionKey(): Criterion {
  return criterionInput.value === "odeh" ? "odeh" : "yallop";
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
  const criterion = selectedCriterionKey();
  const zoneColors: Record<string, string> = criterion === "odeh" ? ODEH_ZONE_COLORS : YALLOP_ZONE_COLORS;
  const zoneLabels: Record<string, string> = criterion === "odeh" ? ODEH_LEGEND : YALLOP_LEGEND;
  legendTitle.textContent = criterion === "odeh" ? "Odeh V zones" : "Yallop q zones";

  legendBar.replaceChildren(
    ...Object.entries(zoneColors).map(([zone, color]) => {
      const segment = document.createElement("span");
      segment.className = "legend-segment";
      segment.style.background = color;
      segment.style.color = textColorFor(color);
      segment.textContent = zone;
      segment.title = zoneLabels[zone];
      return segment;
    })
  );

  legendZones.replaceChildren(
    ...Object.entries(zoneLabels).map(([zone, label]) => {
      const row = document.createElement("div");
      const letter = document.createElement("b");
      letter.textContent = zone;
      letter.style.color = zoneColors[zone];
      row.append(letter, ` ${label}`);
      return row;
    })
  );

  legendStates.replaceChildren(
    ...LEGEND_STATES.map((code) => {
      const state = visibilityStateForCode(code);
      const chip = document.createElement("span");
      chip.className = "state-chip";
      chip.title = state.detail;
      const swatch = document.createElement("i");
      swatch.style.background = state.color;
      chip.append(swatch, state.label);
      return chip;
    })
  );
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
  context.fillText(`${dateInput.value} | ${criterion.toUpperCase()} criterion | generated from current viewport`, 30, 66);

  canvas.toBlob((blob) => {
    if (!blob) {
      showMessage("Unable to export this browser view.", "error");
      return;
    }
    const link = document.createElement("a");
    const objectUrl = URL.createObjectURL(blob);
    link.download = `lunar-visibility-${dateInput.value}-${criterion}.png`;
    link.href = objectUrl;
    link.style.display = "none";
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    setStatus("PNG exported");
  }, "image/png");
}

function drawGraticule(context: CanvasRenderingContext2D, canvasWidth: number, canvasHeight: number): void {
  context.strokeStyle = "rgba(255, 255, 255, 0.12)";
  context.lineWidth = 1;
  for (let x = 0; x <= canvasWidth; x += Math.max(80, canvasWidth / 8)) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, canvasHeight);
    context.stroke();
  }
  for (let y = 0; y <= canvasHeight; y += Math.max(70, canvasHeight / 6)) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(canvasWidth, y);
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
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  });
  const utc = `${date.toISOString().slice(11, 16)} UTC`;
  return `${local} · ${utc}`;
}
