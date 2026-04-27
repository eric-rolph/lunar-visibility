import { describe, expect, it } from "vitest";
import {
  calculateVisibility,
  classifyOdeh,
  classifyYallop,
  nextCrescentDate,
  odehV,
  visibilityStateForErrorCode,
  yallopQ
} from "../shared/visibilityMath";

describe("visibility criteria", () => {
  it("classifies Yallop benchmark thresholds", () => {
    expect(classifyYallop(0.217).zone).toBe("A");
    expect(classifyYallop(0).zone).toBe("B");
    expect(classifyYallop(-0.1).zone).toBe("C");
    expect(classifyYallop(-0.2).zone).toBe("D");
    expect(classifyYallop(-0.25).zone).toBe("E");
    expect(classifyYallop(-0.3).zone).toBe("F");
  });

  it("classifies Odeh benchmark thresholds", () => {
    expect(classifyOdeh(5.65).zone).toBe("A");
    expect(classifyOdeh(2).zone).toBe("B");
    expect(classifyOdeh(-0.96).zone).toBe("C");
    expect(classifyOdeh(-0.97).zone).toBe("D");
  });

  it("keeps Yallop and Odeh polynomial constants stable", () => {
    expect(yallopQ(10, 0.5)).toBeCloseTo(0.115395, 6);
    expect(odehV(10, 0.5)).toBeCloseTo(5.82595, 6);
  });
});

describe("point ephemeris", () => {
  it("calculates a Centennial, Colorado sample with expected shape", () => {
    const result = calculateVisibility({
      date: "2026-03-19",
      lat: 39.5807,
      lng: -104.8772,
      elevationMeters: 1777
    });

    expect(result.times.lagMinutes).toBeGreaterThan(0);
    expect(result.ephemeris.arcvDeg).toBeGreaterThan(-20);
    expect(result.ephemeris.arcvDeg).toBeLessThan(40);
    expect(result.ephemeris.crescentWidthArcMin).toBeGreaterThanOrEqual(0);
    expect(result.criteria.yallop.zone).toMatch(/[A-F]/);
    expect(result.criteria.odeh.zone).toMatch(/[A-D]/);
  });

  it("rejects impossible calendar dates instead of normalizing them", () => {
    expect(() =>
      calculateVisibility({
        date: "2026-02-31",
        lat: 39.5807,
        lng: -104.8772,
        elevationMeters: 1777
      })
    ).toThrow(/real UTC calendar date/);
  });

  it("flags non-crescent dates as outside the model domain", () => {
    const result = calculateVisibility({
      date: "2026-04-28",
      lat: 39.5807,
      lng: -104.8772,
      elevationMeters: 1777
    });

    expect(result.ephemeris.diagnostics.modelApplicable).toBe(false);
    expect(result.ephemeris.diagnostics.state.code).toBe("OUT_OF_MODEL");
    expect(result.ephemeris.diagnostics.modelWarning).toContain("phase window");
  });

  it("maps horizon failures to first-class map states", () => {
    expect(visibilityStateForErrorCode("MOONSET_BEFORE_SUNSET").code).toBe("IMPOSSIBLE");
    expect(visibilityStateForErrorCode("SUNSET_NOT_FOUND").code).toBe("UNKNOWN");
  });

  it("defaults to the evening after the next astronomical new moon", () => {
    expect(nextCrescentDate(new Date("2026-04-27T00:00:00Z"))).toBe("2026-05-17");
  });
});
