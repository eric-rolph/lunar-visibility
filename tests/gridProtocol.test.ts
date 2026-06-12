import { describe, expect, it } from "vitest";
import { longitudeSegments } from "../src/gridProtocol";

describe("longitudeSegments", () => {
  it("passes through a range already inside [-180, 180]", () => {
    expect(longitudeSegments(-104, -30)).toEqual([{ west: -104, east: -30 }]);
  });

  it("covers the full world when the viewport spans 360 degrees or more", () => {
    expect(longitudeSegments(-540, 540)).toEqual([{ west: -180, east: 180 }]);
  });

  it("normalizes a viewport that lives entirely in a wrapped copy", () => {
    expect(longitudeSegments(-400, -250)).toEqual([{ west: -40, east: 110 }]);
  });

  it("splits a viewport that straddles the antimeridian", () => {
    expect(longitudeSegments(150, 210)).toEqual([
      { west: 150, east: 180 },
      { west: -180, east: -150 }
    ]);
  });

  it("splits a wrapped viewport that straddles the antimeridian", () => {
    expect(longitudeSegments(-220, -150)).toEqual([
      { west: 140, east: 180 },
      { west: -180, east: -150 }
    ]);
  });
});
