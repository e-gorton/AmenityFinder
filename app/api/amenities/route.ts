import { NextResponse } from "next/server";

export const runtime = "edge";

const LOCAL_RADIUS_M = 2_000;
const FALLBACK_RADII_M = [20_000, 100_000];
const OVERPASS_ENDPOINTS = [
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

type AmenityType =
  | "ATM"
  | "Bank"
  | "Chemist"
  | "Community Centre"
  | "Convenience Store"
  | "Health Centre"
  | "Leisure"
  | "Library"
  | "Nursery"
  | "Pharmacy"
  | "Place of Worship"
  | "Post Box"
  | "Post Office"
  | "Primary School"
  | "Public House"
  | "Secondary School"
  | "College"
  | "University";

type OsmElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

type Amenity = {
  id: string;
  type: AmenityType;
  name: string;
  postcode: string;
  postcodeSource: "osm" | "nearest" | "unavailable";
  latitude: number;
  longitude: number;
  distanceM: number;
  outsideRadius: boolean;
};

const nearestOnlyTypes = new Set<AmenityType>(["Bank", "Post Office"]);

function isUkCoordinate(latitude: number, longitude: number) {
  return latitude >= 49.5 && latitude <= 61.2 && longitude >= -8.8 && longitude <= 2.1;
}

function haversineMetres(
  latitude1: number,
  longitude1: number,
  latitude2: number,
  longitude2: number,
) {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const earthRadius = 6_371_000;
  const latitudeDelta = toRadians(latitude2 - latitude1);
  const longitudeDelta = toRadians(longitude2 - longitude1);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(toRadians(latitude1)) *
      Math.cos(toRadians(latitude2)) *
      Math.sin(longitudeDelta / 2) ** 2;

  return 2 * earthRadius * Math.asin(Math.sqrt(a));
}

function formatPostcode(value?: string) {
  if (!value) return "";
  const compact = value.toUpperCase().replace(/\s+/g, "");
  const match = compact.match(/^([A-Z]{1,2}\d[A-Z\d]?)(\d[A-Z]{2})$/);
  return match ? `${match[1]} ${match[2]}` : value.trim().toUpperCase();
}

function classify(tags: Record<string, string>): AmenityType | null {
  const amenity = tags.amenity;
  const shop = tags.shop;

  if (amenity === "atm") return "ATM";
  if (amenity === "bank") return "Bank";
  if (shop === "chemist") return "Chemist";
  if (amenity === "community_centre") return "Community Centre";
  if (shop === "convenience") return "Convenience Store";
  if (
    ["clinic", "doctors", "health_post"].includes(amenity) ||
    ["clinic", "doctor", "centre"].includes(tags.healthcare)
  ) {
    return "Health Centre";
  }
  if (tags.leisure) return "Leisure";
  if (amenity === "library") return "Library";
  if (
    ["kindergarten", "childcare", "nursery"].includes(amenity) ||
    tags.social_facility === "day_care"
  ) {
    return "Nursery";
  }
  if (amenity === "pharmacy") return "Pharmacy";
  if (amenity === "place_of_worship") return "Place of Worship";
  if (amenity === "post_box") return "Post Box";
  if (amenity === "post_office") return "Post Office";
  if (amenity === "pub") return "Public House";
  if (amenity === "college") return "College";
  if (amenity === "university") return "University";
  if (amenity === "school") {
    const schoolDescription = [
      tags.name,
      tags["school:level"],
      tags["isced:level"],
      tags.description,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    if (/primary|infant|junior|first school|isced.?1/.test(schoolDescription)) {
      return "Primary School";
    }
    if (/secondary|high school|grammar|sixth form|academy|isced.?[23]/.test(schoolDescription)) {
      return "Secondary School";
    }
    return "Primary School";
  }

  return null;
}

function defaultName(type: AmenityType) {
  if (type === "Public House") return "Public House";
  if (type === "Place of Worship") return "Place of Worship";
  return type;
}

function toAmenity(
  element: OsmElement,
  originLatitude: number,
  originLongitude: number,
): Amenity | null {
  const tags = element.tags ?? {};
  const type = classify(tags);
  const latitude = element.lat ?? element.center?.lat;
  const longitude = element.lon ?? element.center?.lon;

  if (!type || latitude === undefined || longitude === undefined) return null;

  const distanceM = Math.round(
    haversineMetres(originLatitude, originLongitude, latitude, longitude),
  );
  const postcode = formatPostcode(tags["addr:postcode"] ?? tags.postal_code);

  return {
    id: `${element.type}/${element.id}`,
    type,
    name:
      tags.name ??
      tags["name:en"] ??
      tags.brand ??
      tags.operator ??
      defaultName(type),
    postcode,
    postcodeSource: postcode ? "osm" : "unavailable",
    latitude,
    longitude,
    distanceM,
    outsideRadius: distanceM > LOCAL_RADIUS_M,
  };
}

function buildLocalQuery(latitude: number, longitude: number) {
  return `[out:json][timeout:35];
(
  nwr(around:${LOCAL_RADIUS_M},${latitude},${longitude})["amenity"~"^(atm|bank|community_centre|clinic|doctors|health_post|library|kindergarten|childcare|nursery|pharmacy|place_of_worship|post_box|post_office|school|pub|college|university)$"];
  nwr(around:${LOCAL_RADIUS_M},${latitude},${longitude})["shop"~"^(chemist|convenience)$"];
  nwr(around:${LOCAL_RADIUS_M},${latitude},${longitude})["leisure"~"^(park|playground|sports_centre|sports_club|fitness_centre|stadium|swimming_pool|garden|nature_reserve|recreation_ground)$"];
  nwr(around:${LOCAL_RADIUS_M},${latitude},${longitude})["healthcare"~"^(clinic|doctor|centre)$"];
  nwr(around:${LOCAL_RADIUS_M},${latitude},${longitude})["social_facility"="day_care"];
);
out center;`;
}

function buildNearestQuery(
  latitude: number,
  longitude: number,
  radius: number,
  types: AmenityType[],
) {
  const clauses = types
    .map((type) => {
      const value = type === "Bank" ? "bank" : "post_office";
      return `nwr(around:${radius},${latitude},${longitude})["amenity"="${value}"];`;
    })
    .join("\n  ");

  return `[out:json][timeout:35];
(
  ${clauses}
);
out center;`;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 28_000,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function queryOverpass(query: string): Promise<OsmElement[]> {
  let lastError: unknown;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const response = await fetchWithTimeout(endpoint, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          "User-Agent":
            "AmenityFinder/1.0 (https://amenity-finder.e-gorton.workers.dev)",
        },
        body: new URLSearchParams({ data: query }).toString(),
      });

      if (!response.ok) {
        throw new Error(`Overpass returned ${response.status}`);
      }

      const data = (await response.json()) as { elements?: OsmElement[] };
      return data.elements ?? [];
    } catch (error) {
      console.warn(`Overpass request failed for ${endpoint}`, error);
      lastError = error;
    }
  }

  throw lastError ?? new Error("No Overpass endpoint was available");
}

function deduplicate(amenities: Amenity[]) {
  const output: Amenity[] = [];

  for (const item of [...amenities].sort((a, b) => a.distanceM - b.distanceM)) {
    const duplicateIndex = output.findIndex(
      (candidate) =>
        candidate.type === item.type &&
        candidate.name.trim().toLowerCase() === item.name.trim().toLowerCase() &&
        haversineMetres(
          candidate.latitude,
          candidate.longitude,
          item.latitude,
          item.longitude,
        ) < 35,
    );

    if (duplicateIndex === -1) {
      output.push(item);
    } else if (!output[duplicateIndex].postcode && item.postcode) {
      output[duplicateIndex] = item;
    }
  }

  return output;
}

async function addNearestPostcodes(amenities: Amenity[], warnings: string[]) {
  const missing = amenities.filter((item) => !item.postcode);
  if (!missing.length) return;

  try {
    for (let offset = 0; offset < missing.length; offset += 100) {
      const batch = missing.slice(offset, offset + 100);
      const response = await fetchWithTimeout(
        "https://api.postcodes.io/postcodes",
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            geolocations: batch.map((item) => ({
              longitude: item.longitude,
              latitude: item.latitude,
              limit: 1,
              radius: 2_000,
            })),
          }),
        },
        15_000,
      );

      if (!response.ok) throw new Error(`Postcodes.io returned ${response.status}`);

      const data = (await response.json()) as {
        result?: Array<{ result?: Array<{ postcode?: string }> | null }>;
      };

      (data.result ?? []).forEach((entry, index) => {
        const postcode = formatPostcode(entry.result?.[0]?.postcode);
        if (postcode && batch[index]) {
          batch[index].postcode = postcode;
          batch[index].postcodeSource = "nearest";
        }
      });
    }
  } catch {
    warnings.push(
      "Some postcodes could not be completed. Blank values are shown as Not available.",
    );
  }

  for (const item of missing) {
    if (!item.postcode) {
      item.postcode = "Not available";
      item.postcodeSource = "unavailable";
    }
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const latitude = Number(url.searchParams.get("lat"));
  const longitude = Number(url.searchParams.get("lon"));

  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    !isUkCoordinate(latitude, longitude)
  ) {
    return NextResponse.json(
      { error: "Choose a point within the United Kingdom." },
      { status: 400 },
    );
  }

  const warnings: string[] = [];

  try {
    const localElements = await queryOverpass(buildLocalQuery(latitude, longitude));
    const localCandidates = localElements
      .map((element) => toAmenity(element, latitude, longitude))
      .filter((item): item is Amenity => Boolean(item))
      .filter((item) => item.distanceM <= LOCAL_RADIUS_M);

    const nearest = new Map<AmenityType, Amenity>();
    for (const type of nearestOnlyTypes) {
      const closest = localCandidates
        .filter((item) => item.type === type)
        .sort((a, b) => a.distanceM - b.distanceM)[0];
      if (closest) nearest.set(type, closest);
    }

    for (const radius of FALLBACK_RADII_M) {
      const missingTypes = [...nearestOnlyTypes].filter((type) => !nearest.has(type));
      if (!missingTypes.length) break;

      const fallbackElements = await queryOverpass(
        buildNearestQuery(latitude, longitude, radius, missingTypes),
      );
      const fallbackCandidates = fallbackElements
        .map((element) => toAmenity(element, latitude, longitude))
        .filter((item): item is Amenity => Boolean(item));

      for (const type of missingTypes) {
        const closest = fallbackCandidates
          .filter((item) => item.type === type)
          .sort((a, b) => a.distanceM - b.distanceM)[0];
        if (closest) nearest.set(type, closest);
      }
    }

    for (const type of nearestOnlyTypes) {
      if (!nearest.has(type)) {
        warnings.push(`No ${type.toLowerCase()} was mapped within 100 km.`);
      }
    }

    const localStandardAmenities = localCandidates.filter(
      (item) => !nearestOnlyTypes.has(item.type),
    );
    const amenities = deduplicate([
      ...localStandardAmenities,
      ...nearest.values(),
    ]).sort((a, b) => a.distanceM - b.distanceM || a.name.localeCompare(b.name));

    await addNearestPostcodes(amenities, warnings);

    return NextResponse.json(
      {
        point: { latitude, longitude },
        radiusM: LOCAL_RADIUS_M,
        amenities,
        warnings,
        sources: ["OpenStreetMap via Overpass API", "Postcodes.io"],
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    console.error("Amenity search failed", error);
    return NextResponse.json(
      {
        error:
          "The mapping service did not respond in time. Please wait a moment and try again.",
      },
      { status: 503 },
    );
  }
}
