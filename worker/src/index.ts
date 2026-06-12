import schema from "../../openapi.json";
import { calculateVisibility, VisibilityError } from "../../shared/visibilityMath";

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type"
};

export default {
  fetch(request: Request): Response {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: jsonHeaders });
    }

    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "/api" || url.pathname === "/api/") {
      return Response.json(
        {
          service: "lunar-visibility-api",
          description: "Point ephemeris API for first lunar crescent visibility using the Yallop q and Odeh V criteria.",
          map: "https://lunar-visibility.pages.dev",
          endpoints: {
            visibility: "/api/visibility?date=2026-06-16&lat=39.5807&lng=-104.8772&elevationMeters=1777",
            openapi: "/api/openapi.json",
            schema: "/api/schema"
          }
        },
        { headers: jsonHeaders }
      );
    }

    if (url.pathname === "/api/openapi.json") {
      return Response.json(schema, { headers: jsonHeaders });
    }

    if (url.pathname === "/api/schema") {
      return Response.json(schema.components.schemas.VisibilityResponse, { headers: jsonHeaders });
    }

    if (url.pathname === "/api/visibility") {
      return handleVisibility(url);
    }

    return Response.json({ error: "not_found" }, { status: 404, headers: jsonHeaders });
  }
};

function handleVisibility(url: URL): Response {
  try {
    const date = requireParam(url, "date");
    const lat = parseBoundedNumber(requireParam(url, "lat"), "lat", -89.9, 89.9);
    const lng = parseBoundedNumber(requireParam(url, "lng"), "lng", -180, 180);
    const elevationMeters = parseBoundedNumber(url.searchParams.get("elevationMeters") ?? "0", "elevationMeters", -500, 9000);
    const visibility = calculateVisibility({ date, lat, lng, elevationMeters });

    return Response.json(visibility, {
      headers: {
        ...jsonHeaders,
        "cache-control": "public, max-age=3600"
      }
    });
  } catch (error) {
    if (error instanceof VisibilityError) {
      const status = error.code.startsWith("INVALID") ? 400 : 422;
      return Response.json({ error: error.code, message: error.message }, { status, headers: jsonHeaders });
    }

    if (error instanceof Error) {
      return Response.json({ error: "BAD_REQUEST", message: error.message }, { status: 400, headers: jsonHeaders });
    }

    return Response.json({ error: "UNKNOWN_ERROR" }, { status: 500, headers: jsonHeaders });
  }
}

function requireParam(url: URL, name: string): string {
  const value = url.searchParams.get(name);
  if (!value) {
    throw new VisibilityError(`INVALID_${name.toUpperCase()}`, `${name} is required.`);
  }
  return value;
}

function parseBoundedNumber(value: string, name: string, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new VisibilityError(`INVALID_${name.toUpperCase()}`, `${name} must be a number from ${min} to ${max}.`);
  }
  return parsed;
}
