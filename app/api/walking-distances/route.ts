import { NextResponse } from "next/server";

export const runtime = "edge";

const VALHALLA_MATRIX_URL =
  "https://valhalla1.openstreetmap.de/sources_to_targets";
const MAX_DESTINATIONS = 100;
const MATRIX_BATCH_SIZE = 40;
const REQUEST_TIMEOUT_MS = 30_000;

type RoutePoint = {
  id: string;
  latitude: number;
  longitude: number;
};

type MatrixEntry = {
  distance?: number | null;
  time?: number | null;
  to_index?: number;
};

type MatrixResponse = {
  sources_to_targets?: MatrixEntry[][];
  error?: string;
};

type WalkingResult = {
  id: string;
  distanceM: number | null;
  durationSeconds: number | null;
  status: "routed" | "unreachable";
};

function isUkCoordinate(latitude: number, longitude: number) {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= 49.5 &&
    latitude <= 61.2 &&
    longitude >= -8.8 &&
    longitude <= 2.1
  );
}

function parsePoint(value: unknown, requireId: boolean): RoutePoint | null {
  if (!value || typeof value !== "object") return null;
  const point = value as Record<string, unknown>;
  const id = requireId ? String(point.id ?? "").trim() : "site-centre";
  const latitude = Number(point.latitude);
  const longitude = Number(point.longitude);

  if ((requireId && !id) || !isUkCoordinate(latitude, longitude)) return null;
  return { id, latitude, longitude };
}

async function requestMatrix(
  origin: RoutePoint,
  destinations: RoutePoint[],
): Promise<WalkingResult[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(VALHALLA_MATRIX_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        sources: [{ lat: origin.latitude, lon: origin.longitude }],
        targets: destinations.map((point) => ({
          lat: point.latitude,
          lon: point.longitude,
        })),
        costing: "pedestrian",
        units: "kilometers",
        verbose: true,
      }),
      signal: controller.signal,
    });

    const data = (await response.json()) as MatrixResponse;
    if (!response.ok || !data.sources_to_targets?.[0]) {
      throw new Error(data.error || `Routing service returned ${response.status}.`);
    }

    const row = data.sources_to_targets[0];
    return destinations.map((destination, index) => {
      const entry = row.find((candidate) => candidate.to_index === index) ?? row[index];
      const distanceKm = entry?.distance;
      const durationSeconds = entry?.time;
      const routed =
        typeof distanceKm === "number" &&
        Number.isFinite(distanceKm) &&
        typeof durationSeconds === "number" &&
        Number.isFinite(durationSeconds);

      return {
        id: destination.id,
        distanceM: routed ? Math.round(distanceKm * 1_000) : null,
        durationSeconds: routed ? Math.round(durationSeconds) : null,
        status: routed ? "routed" : "unreachable",
      };
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "The routing request is not valid JSON." }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "The routing request is invalid." }, { status: 400 });
  }

  const payload = body as Record<string, unknown>;
  const origin = parsePoint(payload.origin, false);
  const destinationValues = Array.isArray(payload.destinations)
    ? payload.destinations
    : [];
  const destinations = destinationValues
    .map((value) => parsePoint(value, true))
    .filter((value): value is RoutePoint => value !== null);

  if (!origin) {
    return NextResponse.json({ error: "Choose a valid UK site centre." }, { status: 400 });
  }
  if (!destinationValues.length || destinations.length !== destinationValues.length) {
    return NextResponse.json(
      { error: "Every destination must have an ID and valid UK coordinates." },
      { status: 400 },
    );
  }
  if (destinations.length > MAX_DESTINATIONS) {
    return NextResponse.json(
      { error: `A maximum of ${MAX_DESTINATIONS} walking destinations can be calculated at once.` },
      { status: 400 },
    );
  }
  if (new Set(destinations.map((destination) => destination.id)).size !== destinations.length) {
    return NextResponse.json({ error: "Destination IDs must be unique." }, { status: 400 });
  }

  try {
    const results: WalkingResult[] = [];
    for (let offset = 0; offset < destinations.length; offset += MATRIX_BATCH_SIZE) {
      const batch = destinations.slice(offset, offset + MATRIX_BATCH_SIZE);
      results.push(...(await requestMatrix(origin, batch)));
    }

    const unreachableCount = results.filter((result) => result.status === "unreachable").length;
    return NextResponse.json({
      results,
      source: "Valhalla pedestrian routing using OpenStreetMap",
      warnings: unreachableCount
        ? [`No mapped pedestrian route was found for ${unreachableCount} destination${unreachableCount === 1 ? "" : "s"}.`]
        : [],
    });
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? "The walking route service timed out. The GeoJSON export remains available."
        : "Walking routes could not be calculated. The GeoJSON export remains available.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
