import { describe, expect, it } from "vitest";
import worker from "../worker/src/index";

function get(path: string): Response {
  return worker.fetch(new Request(`https://example.com${path}`));
}

describe("worker API", () => {
  it("returns a full visibility response for a valid query", async () => {
    const response = get("/api/visibility?date=2026-03-19&lat=39.5807&lng=-104.8772&elevationMeters=1777");
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("cache-control")).toContain("max-age");

    const body = await response.json();
    expect(body.input).toEqual({ date: "2026-03-19", lat: 39.5807, lng: -104.8772, elevationMeters: 1777 });
    expect(body.times.lagMinutes).toBeGreaterThan(0);
    expect(body.criteria.yallop.zone).toMatch(/^[A-F]$/);
    expect(body.criteria.odeh.zone).toMatch(/^[A-D]$/);
  });

  it("rejects malformed dates with 400", async () => {
    const response = get("/api/visibility?date=2026-13-99&lat=10&lng=10");
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("INVALID_DATE");
  });

  it("rejects missing parameters with 400", async () => {
    const response = get("/api/visibility?date=2026-03-19&lat=10");
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("INVALID_LNG");
  });

  it("rejects out-of-range latitude with 400", async () => {
    const response = get("/api/visibility?date=2026-03-19&lat=95&lng=10");
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("INVALID_LAT");
  });

  it("maps geometric impossibilities to 422", async () => {
    const response = get("/api/visibility?date=2026-04-14&lat=39.5807&lng=-104.8772");
    expect(response.status).toBe(422);
    expect((await response.json()).error).toBe("MOON_BELOW_HORIZON_AT_SUNSET");
  });

  it("serves the OpenAPI document", async () => {
    const response = get("/api/openapi.json");
    expect(response.status).toBe(200);
    expect((await response.json()).components.schemas.VisibilityResponse).toBeDefined();
  });

  it("answers CORS preflight requests", () => {
    const response = worker.fetch(new Request("https://example.com/api/visibility", { method: "OPTIONS" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-methods")).toContain("GET");
  });

  it("serves a discovery index at the root", async () => {
    const response = get("/");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.service).toBe("lunar-visibility-api");
    expect(body.endpoints.visibility).toContain("/api/visibility");
  });

  it("returns 404 for unknown routes", async () => {
    const response = get("/api/nope");
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("not_found");
  });
});
