import { NextResponse } from "next/server";

export const runtime = "edge";

const LOCAL_RADIUS_M = 2_000;
const FALLBACK_RADII_M = [20_000, 100_000];
const VERIFIED_AMENITY_MAX_AGE_MS = 548 * 24 * 60 * 60 * 1_000;
// Public Overpass instances can take more than ten seconds to return this
// multi-category query under normal load. Keep the client window slightly
// beyond the query's own 35-second server limit so the response can arrive
// without treating a slow request as a complete OpenStreetMap outage.
const OVERPASS_REQUEST_TIMEOUT_MS = 40_000;
const OVERPASS_HEDGE_DELAY_MS = 6_000;
const OVERPASS_ENDPOINTS = [
  "https://overpass.atownsend.org.uk/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

type AmenityType =
  | "ATM"
  | "Bank"
  | "Community Centre"
  | "Convenience Store"
  | "Hospital"
  | "Leisure"
  | "Library"
  | "Health Centre"
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
  postcodeSource: "osm" | "nearest" | "ods" | "verified" | "unavailable";
  source: "osm" | "nhs-ods" | "verified";
  geometrySource: "osm" | "postcode-centroid" | "verified";
  latitude: number;
  longitude: number;
  distanceM: number;
  outsideRadius: boolean;
};

type VerifiedAmenity = {
  id: string;
  type: AmenityType;
  name: string;
  postcode: string;
  latitude: number;
  longitude: number;
  verifiedOn: string;
};

type OdsOrganisation = {
  Name?: string;
  OrgId?: string;
  Status?: string;
  PostCode?: string;
  PrimaryRoleId?: string;
  PrimaryRoleDescription?: string;
};

const ODS_API_BASE = "https://directory.spineservices.nhs.uk/ORD/2-0-0";
const ODS_ROLE_TYPES: Record<string, AmenityType> = {
  RO96: "Health Centre",
  RO177: "Health Centre",
  RO182: "Pharmacy",
};

// OpenStreetMap does not currently tag these confirmed facilities correctly.
// The records below are retained separately so their provenance and review date
// are explicit rather than implying that they came from OSM.
const verifiedAmenities: VerifiedAmenity[] = [
  {
    id: "littleborough-coop-station-road",
    type: "ATM",
    name: "Co-op ATM",
    postcode: "OL15 8AF",
    latitude: 53.642541,
    longitude: -2.096086,
    verifiedOn: "2026-07-16",
  },
  {
    id: "littleborough-church-street",
    type: "ATM",
    name: "Church Street ATM",
    postcode: "OL15 8AU",
    latitude: 53.643672,
    longitude: -2.097829,
    verifiedOn: "2026-07-16",
  },
  {
    id: "littleborough-sainsburys-harehill-road",
    type: "ATM",
    name: "Sainsbury's ATM",
    postcode: "OL15 9BA",
    latitude: 53.644572,
    longitude: -2.097044,
    verifiedOn: "2026-07-16",
  },
  {
    id: "littleborough-mfg-church-street",
    type: "ATM",
    name: "MFG Littleborough ATM",
    postcode: "OL15 8JA",
    latitude: 53.642609,
    longitude: -2.100564,
    verifiedOn: "2026-07-16",
  },
  {
    id: "littleborough-featherstall-road",
    type: "ATM",
    name: "Featherstall Road ATM",
    postcode: "OL15 8JZ",
    latitude: 53.641858,
    longitude: -2.106461,
    verifiedOn: "2026-01-31",
  },
];

const nearestOnlyTypes = new Set<AmenityType>(["Bank", "Post Office"]);
const standaloneLeisureValues = new Set([
  "playground",
  "sports_centre",
  "sports_club",
  "fitness_centre",
  "stadium",
  "swimming_pool",
]);
const namedLeisureAreaValues = new Set([
  "park",
  "nature_reserve",
  "recreation_ground",
]);
const inactiveLifecyclePrefixes = [
  "abandoned:",
  "closed:",
  "demolished:",
  "disused:",
  "former:",
  "razed:",
  "removed:",
  "was:",
];
const classifiedFeatureKeys = [
  "amenity",
  "healthcare",
  "leisure",
  "shop",
  "social_facility",
];
const inactiveStatusValues = new Set([
  "abandoned",
  "closed",
  "demolished",
  "disused",
  "former",
  "razed",
  "removed",
  "vacant",
]);

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

function isInactiveFeature(tags: Record<string, string>) {
  if (
    classifiedFeatureKeys.some((key) =>
      inactiveLifecyclePrefixes.some((prefix) => `${prefix}${key}` in tags),
    )
  ) {
    return true;
  }

  const lifecycleFlags = [
    tags.abandoned,
    tags.closed,
    tags.demolished,
    tags.disused,
    tags.razed,
    tags.removed,
  ];
  if (
    lifecycleFlags.some((value) =>
      ["1", "true", "yes"].includes(value?.trim().toLowerCase() ?? ""),
    )
  ) {
    return true;
  }

  const statusValues = [
    tags.lifecycle,
    tags.operational_status,
    tags.state,
    tags.status,
  ];
  if (
    statusValues.some((value) =>
      inactiveStatusValues.has(value?.trim().toLowerCase() ?? ""),
    )
  ) {
    return true;
  }

  return tags.opening_hours?.trim().toLowerCase() === "closed";
}

function hasMappedIdentity(tags: Record<string, string>) {
  return Boolean(
    tags.name?.trim() ||
      tags["name:en"]?.trim() ||
      tags.brand?.trim() ||
      tags.operator?.trim(),
  );
}

function hasBankOperationalDetails(tags: Record<string, string>) {
  return Boolean(
    tags.opening_hours?.trim() ||
      tags.phone?.trim() ||
      tags["contact:phone"]?.trim() ||
      tags.website?.trim() ||
      tags["contact:website"]?.trim() ||
      tags.branch?.trim() ||
      tags.check_date?.trim() ||
      tags["check_date:amenity"]?.trim() ||
      tags.survey_date?.trim(),
  );
}

function classify(tags: Record<string, string>): AmenityType | null {
  if (isInactiveFeature(tags)) return null;

  const amenity = tags.amenity;
  const healthcare = tags.healthcare;
  const shop = tags.shop;
  const healthcareName = mappedName(tags)?.trim().toLowerCase() ?? "";
  const nameLooksLikeHospital = /\b(?:hospital|infirmary)\b/.test(healthcareName);
  const nameLooksLikeMedicalCentre =
    /\b(?:gp|general practice|medical centr(?:e|er)|health centr(?:e|er)|medical practi(?:ce|se)|doctors?|surgery)\b/.test(
      healthcareName,
    );

  if (amenity === "atm") return "ATM";
  // Bank-branch mapping becomes stale quickly. Require both an identifiable
  // operator and at least one operational/contact detail rather than accepting a
  // bare amenity=bank point left behind after a closure.
  if (amenity === "bank") {
    return hasMappedIdentity(tags) && hasBankOperationalDetails(tags) ? "Bank" : null;
  }
  if (
    amenity === "pharmacy" ||
    healthcare === "pharmacy" ||
    ["chemist", "pharmacy"].includes(shop)
  ) {
    return "Pharmacy";
  }
  if (amenity === "community_centre") return "Community Centre";
  if (["convenience", "supermarket"].includes(shop)) return "Convenience Store";
  const isHospitalTag = amenity === "hospital" || healthcare === "hospital";
  const isGpMedicalTag =
    ["doctors", "health_post"].includes(amenity) ||
    ["doctor", "centre", "general_practice"].includes(healthcare);
  const isGenericClinicTag = amenity === "clinic" || healthcare === "clinic";
  if (isHospitalTag) {
    if (nameLooksLikeMedicalCentre && !nameLooksLikeHospital) {
      return "Health Centre";
    }
    return "Hospital";
  }
  if (isGpMedicalTag || (isGenericClinicTag && nameLooksLikeMedicalCentre)) {
    return "Health Centre";
  }
  const leisureIsPrivate = ["private", "no"].includes(tags.access);
  if (!leisureIsPrivate && standaloneLeisureValues.has(tags.leisure)) return "Leisure";
  if (
    !leisureIsPrivate &&
    namedLeisureAreaValues.has(tags.leisure) &&
    Boolean(tags.name?.trim() || tags["name:en"]?.trim())
  ) {
    return "Leisure";
  }
  if (amenity === "library") return "Library";
  const dayCareDescription = [
    mappedName(tags),
    tags["social_facility:for"],
    tags.description,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const isChildDayCare =
    tags.social_facility === "day_care" &&
    /\b(?:child|children|childcare|juvenile|nursery|pre[ -]?school)\b/.test(
      dayCareDescription,
    );
  if (
    ["kindergarten", "childcare", "nursery"].includes(amenity) ||
    isChildDayCare
  ) {
    return "Nursery";
  }
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

function defaultName(type: AmenityType, tags: Record<string, string>) {
  if (type === "Public House") return "Public House";
  if (type === "Place of Worship") return "Place of Worship";
  if (type === "Leisure") {
    const leisureNames: Record<string, string> = {
      playground: "Playground",
      sports_centre: "Sports Centre",
      sports_club: "Sports Club",
      fitness_centre: "Fitness Centre",
      stadium: "Stadium",
      swimming_pool: "Swimming Pool",
    };
    return leisureNames[tags.leisure] ?? "Leisure";
  }
  return type;
}

function mappedName(tags: Record<string, string>) {
  return tags.name ?? tags["name:en"] ?? tags.brand ?? tags.operator;
}

function attachedAtmName(tags: Record<string, string>) {
  const hostName = mappedName(tags)?.trim();
  if (!hostName) return "ATM";
  return /\b(?:atm|cash ?machine)\b/i.test(hostName) ? hostName : `${hostName} ATM`;
}

function attachedPharmacyName(
  tags: Record<string, string>,
  isDispensingService: boolean,
) {
  const hostName = mappedName(tags)?.trim();
  if (!hostName) return isDispensingService ? "Dispensing pharmacy" : "Pharmacy";
  return isDispensingService
    ? `${hostName} dispensing pharmacy`
    : `${hostName} pharmacy`;
}

function createAmenity(
  element: OsmElement,
  type: AmenityType,
  originLatitude: number,
  originLongitude: number,
  idSuffix = "",
  nameOverride?: string,
): Amenity | null {
  const tags = element.tags ?? {};
  const latitude = element.lat ?? element.center?.lat;
  const longitude = element.lon ?? element.center?.lon;

  if (latitude === undefined || longitude === undefined) return null;

  const distanceM = Math.round(
    haversineMetres(originLatitude, originLongitude, latitude, longitude),
  );
  const postcode = formatPostcode(tags["addr:postcode"] ?? tags.postal_code);

  return {
    id: `${element.type}/${element.id}${idSuffix}`,
    type,
    name: nameOverride ?? mappedName(tags) ?? defaultName(type, tags),
    postcode,
    postcodeSource: postcode ? "osm" : "unavailable",
    source: "osm",
    geometrySource: "osm",
    latitude,
    longitude,
    distanceM,
    outsideRadius: distanceM > LOCAL_RADIUS_M,
  };
}

function toVerifiedAmenities(originLatitude: number, originLongitude: number) {
  const newestPermittedVerification = Date.now() - VERIFIED_AMENITY_MAX_AGE_MS;

  return verifiedAmenities
    .filter((record) => Date.parse(record.verifiedOn) >= newestPermittedVerification)
    .map<Amenity>((record) => {
      const distanceM = Math.round(
        haversineMetres(
          originLatitude,
          originLongitude,
          record.latitude,
          record.longitude,
        ),
      );

      return {
        id: `verified/${record.id}`,
        type: record.type,
        name: record.name,
        postcode: record.postcode,
        postcodeSource: "verified",
        source: "verified",
        geometrySource: "verified",
        latitude: record.latitude,
        longitude: record.longitude,
        distanceM,
        outsideRadius: distanceM > LOCAL_RADIUS_M,
      };
    });
}

function toAmenities(
  element: OsmElement,
  originLatitude: number,
  originLongitude: number,
): Amenity[] {
  const tags = element.tags ?? {};
  if (isInactiveFeature(tags)) return [];

  const amenities: Amenity[] = [];
  const primaryType = classify(tags);
  if (primaryType) {
    const primary = createAmenity(
      element,
      primaryType,
      originLatitude,
      originLongitude,
    );
    if (primary) amenities.push(primary);
  }

  const atmIsMappedOnCredibleHost =
    tags.atm?.trim().toLowerCase() === "yes" &&
    primaryType !== "ATM" &&
    (tags.amenity !== "bank" || primaryType === "Bank");
  if (atmIsMappedOnCredibleHost) {
    const attachedAtm = createAmenity(
      element,
      "ATM",
      originLatitude,
      originLongitude,
      "#atm",
      attachedAtmName(tags),
    );
    if (attachedAtm) amenities.push(attachedAtm);
  }

  const isDispensingMedicalCentre =
    primaryType === "Health Centre" &&
    ["yes", "only"].includes(tags.dispensing?.trim().toLowerCase() ?? "");
  const hasAttachedPharmacy =
    primaryType !== "Pharmacy" &&
    (isDispensingMedicalCentre ||
      tags.pharmacy?.trim().toLowerCase() === "yes");
  if (hasAttachedPharmacy) {
    const attachedPharmacy = createAmenity(
      element,
      "Pharmacy",
      originLatitude,
      originLongitude,
      "#pharmacy",
      attachedPharmacyName(tags, isDispensingMedicalCentre),
    );
    if (attachedPharmacy) amenities.push(attachedPharmacy);
  }

  return amenities;
}

function buildLocalQuery(latitude: number, longitude: number) {
  return `[out:json][timeout:35];
(
  nwr(around:${LOCAL_RADIUS_M},${latitude},${longitude})["amenity"~"^(atm|bank|community_centre|clinic|doctors|health_post|hospital|library|kindergarten|childcare|nursery|pharmacy|place_of_worship|post_box|post_office|school|pub|college|university)$"];
  nwr(around:${LOCAL_RADIUS_M},${latitude},${longitude})["shop"~"^(chemist|convenience|pharmacy|supermarket)$"];
  nwr(around:${LOCAL_RADIUS_M},${latitude},${longitude})["leisure"~"^(park|playground|sports_centre|sports_club|fitness_centre|stadium|swimming_pool|nature_reserve|recreation_ground)$"];
  nwr(around:${LOCAL_RADIUS_M},${latitude},${longitude})["healthcare"~"^(centre|clinic|doctor|general_practice|hospital|pharmacy)$"];
  nwr(around:${LOCAL_RADIUS_M},${latitude},${longitude})["dispensing"~"^(yes|only)$"];
  nwr(around:${LOCAL_RADIUS_M},${latitude},${longitude})["pharmacy"="yes"];
  nwr(around:${LOCAL_RADIUS_M},${latitude},${longitude})["social_facility"="day_care"];
  nwr(around:${LOCAL_RADIUS_M},${latitude},${longitude})["atm"="yes"];
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

function odsDisplayName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
    .replace(/\bNhs\b/g, "NHS")
    .replace(/\bGp\b/g, "GP");
}

function outwardCode(postcode: string) {
  return formatPostcode(postcode).split(" ")[0] ?? "";
}

function postcodeDistrictSamplePoints(latitude: number, longitude: number) {
  const points = [{ latitude, longitude }];
  const longitudeScale = 111_320 * Math.cos((latitude * Math.PI) / 180);

  for (const radiusM of [1_000, 1_950]) {
    for (let bearing = 0; bearing < 360; bearing += 45) {
      const radians = (bearing * Math.PI) / 180;
      points.push({
        latitude: latitude + (Math.cos(radians) * radiusM) / 111_320,
        longitude: longitude + (Math.sin(radians) * radiusM) / longitudeScale,
      });
    }
  }

  return points;
}

async function fetchNearbyOutwardCodes(latitude: number, longitude: number) {
  const response = await fetchWithTimeout(
    "https://api.postcodes.io/postcodes",
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        geolocations: postcodeDistrictSamplePoints(latitude, longitude).map(
          (point) => ({ ...point, limit: 1, radius: 2_000 }),
        ),
      }),
    },
    12_000,
  );

  if (!response.ok) throw new Error(`Postcodes.io returned ${response.status}`);

  const data = (await response.json()) as {
    result?: Array<{ result?: Array<{ postcode?: string }> | null }>;
  };
  const codes = new Set<string>();
  for (const entry of data.result ?? []) {
    const code = outwardCode(entry.result?.[0]?.postcode ?? "");
    if (code) codes.add(code);
  }

  if (!codes.size) throw new Error("No postcode districts were resolved");
  return [...codes];
}

async function fetchOdsOrganisations(
  outwardCodes: string[],
  warnings: string[],
) {
  const results = await Promise.allSettled(
    outwardCodes.map(async (code) => {
      const params = new URLSearchParams({
        PostCode: code,
        Status: "Active",
        // RO177 covers every prescribing cost centre, including prisons and
        // specialist services. The additional RO76 role identifies actual GP
        // practices; RO96 identifies branch surgeries and RO182 is the
        // specific pharmacy-site role.
        Roles: "RO76,RO96,RO182",
        Limit: "1000",
      });
      const response = await fetchWithTimeout(
        `${ODS_API_BASE}/organisations?${params.toString()}`,
        {
          headers: {
            Accept: "application/json",
            "User-Agent":
              "AmenityFinder/1.0 (https://amenity-finder.e-gorton.workers.dev)",
          },
        },
        12_000,
      );

      if (!response.ok) throw new Error(`NHS ODS returned ${response.status}`);
      const data = (await response.json()) as {
        Organisations?: OdsOrganisation[];
      };
      return data.Organisations ?? [];
    }),
  );

  const successful = results.filter(
    (result): result is PromiseFulfilledResult<OdsOrganisation[]> =>
      result.status === "fulfilled",
  );
  if (!successful.length) throw new Error("No NHS ODS district request succeeded");
  if (successful.length !== results.length) {
    warnings.push(
      "NHS GP and pharmacy coverage may be incomplete because one postcode district did not respond.",
    );
  }

  const organisations = new Map<string, OdsOrganisation>();
  for (const result of successful) {
    for (const organisation of result.value) {
      if (
        organisation.OrgId &&
        organisation.PrimaryRoleId &&
        ODS_ROLE_TYPES[organisation.PrimaryRoleId] &&
        (!organisation.Status || organisation.Status.toLowerCase() === "active")
      ) {
        organisations.set(organisation.OrgId, organisation);
      }
    }
  }

  return [...organisations.values()];
}

async function geocodePostcodes(postcodes: string[]) {
  const coordinates = new Map<
    string,
    { latitude: number; longitude: number }
  >();

  for (let offset = 0; offset < postcodes.length; offset += 100) {
    const batch = postcodes.slice(offset, offset + 100);
    const response = await fetchWithTimeout(
      "https://api.postcodes.io/postcodes",
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ postcodes: batch }),
      },
      12_000,
    );

    if (!response.ok) throw new Error(`Postcodes.io returned ${response.status}`);
    const data = (await response.json()) as {
      result?: Array<{
        query?: string;
        result?: {
          postcode?: string;
          latitude?: number;
          longitude?: number;
        } | null;
      }>;
    };

    for (const entry of data.result ?? []) {
      const postcode = formatPostcode(entry.result?.postcode ?? entry.query);
      const latitude = entry.result?.latitude;
      const longitude = entry.result?.longitude;
      if (
        postcode &&
        typeof latitude === "number" &&
        typeof longitude === "number"
      ) {
        coordinates.set(postcode, { latitude, longitude });
      }
    }
  }

  return coordinates;
}

async function fetchNhsOdsAmenities(
  originLatitude: number,
  originLongitude: number,
  warnings: string[],
) {
  const outwardCodes = await fetchNearbyOutwardCodes(
    originLatitude,
    originLongitude,
  );
  const organisations = await fetchOdsOrganisations(outwardCodes, warnings);
  const postcodes = [
    ...new Set(
      organisations
        .map((organisation) => formatPostcode(organisation.PostCode))
        .filter(Boolean),
    ),
  ];
  const coordinates = await geocodePostcodes(postcodes);

  return organisations.flatMap<Amenity>((organisation) => {
    const type = ODS_ROLE_TYPES[organisation.PrimaryRoleId ?? ""];
    const postcode = formatPostcode(organisation.PostCode);
    const coordinate = coordinates.get(postcode);
    if (!type || !organisation.OrgId || !coordinate) return [];

    const distanceM = Math.round(
      haversineMetres(
        originLatitude,
        originLongitude,
        coordinate.latitude,
        coordinate.longitude,
      ),
    );
    if (distanceM > LOCAL_RADIUS_M) return [];

    return [
      {
        id: `ods/${organisation.OrgId}`,
        type,
        name: organisation.Name
          ? odsDisplayName(organisation.Name)
          : type,
        postcode,
        postcodeSource: "ods",
        source: "nhs-ods",
        geometrySource: "postcode-centroid",
        latitude: coordinate.latitude,
        longitude: coordinate.longitude,
        distanceM,
        outsideRadius: false,
      },
    ];
  });
}

async function queryOverpass(query: string): Promise<OsmElement[]> {
  const controllers = OVERPASS_ENDPOINTS.map(() => new AbortController());
  const attempts = OVERPASS_ENDPOINTS.map(
    async (endpoint, index): Promise<OsmElement[]> => {
      if (index) {
        await new Promise((resolve) =>
          setTimeout(resolve, index * OVERPASS_HEDGE_DELAY_MS),
        );
      }
      const controller = controllers[index];
      if (controller.signal.aborted) throw new Error("Overpass attempt cancelled");
      const timeout = setTimeout(
        () => controller.abort(),
        OVERPASS_REQUEST_TIMEOUT_MS,
      );

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
            "User-Agent":
              "AmenityFinder/1.0 (https://amenity-finder.e-gorton.workers.dev)",
          },
          body: new URLSearchParams({ data: query }).toString(),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Overpass returned ${response.status}`);
        }

        const data = (await response.json()) as { elements?: OsmElement[] };
        return data.elements ?? [];
      } finally {
        clearTimeout(timeout);
      }
    },
  );

  try {
    const elements = await Promise.any(attempts);
    controllers.forEach((controller) => controller.abort());
    return elements;
  } catch (error) {
    controllers.forEach((controller) => controller.abort());
    console.warn("Every Overpass mirror failed", error);
    throw new Error("No Overpass endpoint was available");
  }
}

function normalisedName(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function organisationNameKey(value: string) {
  const genericWords = new Set([
    "and",
    "chemist",
    "chemists",
    "centre",
    "center",
    "gp",
    "limited",
    "ltd",
    "medical",
    "nhs",
    "pharmacy",
    "practice",
    "surgery",
    "the",
  ]);

  return normalisedName(value)
    .split(" ")
    .filter((word) => word && !genericWords.has(word))
    .join(" ");
}

function mergeDuplicate(candidate: Amenity, item: Amenity): Amenity {
  const ods = [candidate, item].find((record) => record.source === "nhs-ods");
  const osm = [candidate, item].find((record) => record.source === "osm");
  if (ods && osm) {
    // ODS supplies the active organisation identity and premises postcode;
    // retain the more precise OSM geometry when both describe the same place.
    return {
      ...ods,
      latitude: osm.latitude,
      longitude: osm.longitude,
      distanceM: osm.distanceM,
      outsideRadius: osm.outsideRadius,
      geometrySource: "osm",
    };
  }

  const sourcePriority: Record<Amenity["source"], number> = {
    osm: 1,
    "nhs-ods": 2,
    verified: 3,
  };
  const preferred =
    sourcePriority[item.source] > sourcePriority[candidate.source]
      ? item
      : candidate;
  const alternative = preferred === item ? candidate : item;
  return !preferred.postcode && alternative.postcode
    ? {
        ...preferred,
        postcode: alternative.postcode,
        postcodeSource: alternative.postcodeSource,
      }
    : preferred;
}

function deduplicate(amenities: Amenity[]) {
  const output: Amenity[] = [];

  for (const item of [...amenities].sort((a, b) => a.distanceM - b.distanceM)) {
    const duplicateIndex = output.findIndex(
      (candidate) => {
        if (candidate.type !== item.type) return false;

        const separationM = haversineMetres(
          candidate.latitude,
          candidate.longitude,
          item.latitude,
          item.longitude,
        );
        const sameName = normalisedName(candidate.name) === normalisedName(item.name);
        const crossSourceOdsPair =
          candidate.source !== item.source &&
          (candidate.source === "nhs-ods" || item.source === "nhs-ods");
        const candidateKey = organisationNameKey(candidate.name);
        const itemKey = organisationNameKey(item.name);
        const sameOrganisationName =
          Boolean(candidateKey) && candidateKey === itemKey;
        const genericCrossSourceName =
          candidate.name === candidate.type || item.name === item.type;
        const verifiedSupplementDuplicate =
          candidate.source !== item.source &&
          separationM < 40 &&
          (sameName ||
            candidate.name === candidate.type ||
            item.name === item.type);

        return (
          (sameName && separationM < (item.type === "Leisure" ? 250 : 35)) ||
          (crossSourceOdsPair &&
            separationM < 400 &&
            (sameName || sameOrganisationName)) ||
          (crossSourceOdsPair && genericCrossSourceName && separationM < 100) ||
          verifiedSupplementDuplicate
        );
      },
    );

    if (duplicateIndex === -1) {
      output.push(item);
    } else {
      output[duplicateIndex] = mergeDuplicate(output[duplicateIndex], item);
    }
  }

  return output;
}

function alignSharedOdsPremises(
  amenities: Amenity[],
  originLatitude: number,
  originLongitude: number,
) {
  const preciseOdsPremises = new Map<string, Amenity>();
  for (const item of amenities) {
    if (
      item.source === "nhs-ods" &&
      item.geometrySource === "osm" &&
      item.postcode
    ) {
      preciseOdsPremises.set(formatPostcode(item.postcode), item);
    }
  }

  return amenities.map((item) => {
    if (
      item.source !== "nhs-ods" ||
      item.geometrySource !== "postcode-centroid" ||
      !item.postcode
    ) {
      return item;
    }

    const premises = preciseOdsPremises.get(formatPostcode(item.postcode));
    if (
      !premises ||
      premises.id === item.id ||
      haversineMetres(
        premises.latitude,
        premises.longitude,
        item.latitude,
        item.longitude,
      ) > 500
    ) {
      return item;
    }

    const distanceM = Math.round(
      haversineMetres(
        originLatitude,
        originLongitude,
        premises.latitude,
        premises.longitude,
      ),
    );
    return {
      ...item,
      latitude: premises.latitude,
      longitude: premises.longitude,
      distanceM,
      outsideRadius: distanceM > LOCAL_RADIUS_M,
      geometrySource: "osm" as const,
    };
  });
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
    const [osmResult, odsResult] = await Promise.allSettled([
      queryOverpass(buildLocalQuery(latitude, longitude)),
      fetchNhsOdsAmenities(latitude, longitude, warnings),
    ]);
    const osmAvailable = osmResult.status === "fulfilled";
    const odsAvailable = odsResult.status === "fulfilled";
    const localElements =
      osmResult.status === "fulfilled" ? osmResult.value : [];
    const odsAmenities =
      odsResult.status === "fulfilled" ? odsResult.value : [];

    if (!osmAvailable) {
      warnings.push(
        "Live OpenStreetMap data is temporarily unavailable. NHS ODS and reviewed supplementary locations are shown; try again before exporting.",
      );
    }
    if (!odsAvailable) {
      warnings.push(
        "The NHS GP and pharmacy register is temporarily unavailable. OpenStreetMap results are shown; try again before exporting.",
      );
    }

    const localCandidates = [
      ...localElements.flatMap((element) =>
        toAmenities(element, latitude, longitude),
      ),
      ...odsAmenities,
      ...toVerifiedAmenities(latitude, longitude),
    ]
      .filter((item) => item.distanceM <= LOCAL_RADIUS_M);
    const deduplicatedLocalCandidates = alignSharedOdsPremises(
      deduplicate(localCandidates),
      latitude,
      longitude,
    );

    const nearest = new Map<AmenityType, Amenity>();
    for (const type of nearestOnlyTypes) {
      const closest = deduplicatedLocalCandidates
        .filter((item) => item.type === type)
        .sort((a, b) => a.distanceM - b.distanceM)[0];
      if (closest) nearest.set(type, closest);
    }

    for (const radius of osmAvailable ? FALLBACK_RADII_M : []) {
      const missingTypes = [...nearestOnlyTypes].filter((type) => !nearest.has(type));
      if (!missingTypes.length) break;

      let fallbackCandidates: Amenity[];
      try {
        const fallbackElements = await queryOverpass(
          buildNearestQuery(latitude, longitude, radius, missingTypes),
        );
        fallbackCandidates = fallbackElements.flatMap((element) =>
          toAmenities(element, latitude, longitude),
        );
      } catch {
        warnings.push(
          "The wider OpenStreetMap search for a nearest bank or post office did not respond. Local amenity results are still complete; try again before exporting if either nearest-only category is absent.",
        );
        break;
      }

      for (const type of missingTypes) {
        const closest = fallbackCandidates
          .filter((item) => item.type === type)
          .sort((a, b) => a.distanceM - b.distanceM)[0];
        if (closest) nearest.set(type, closest);
      }
    }

    for (const type of nearestOnlyTypes) {
      if (osmAvailable && !nearest.has(type)) {
        warnings.push(`No ${type.toLowerCase()} was mapped within 100 km.`);
      }
    }

    const closestPostBoxes = deduplicatedLocalCandidates
      .filter((item) => item.type === "Post Box")
      .sort((a, b) => a.distanceM - b.distanceM)
      .slice(0, 2);
    const localStandardAmenities = deduplicatedLocalCandidates.filter(
      (item) => !nearestOnlyTypes.has(item.type) && item.type !== "Post Box",
    );
    const amenities = deduplicate([
      ...localStandardAmenities,
      ...closestPostBoxes,
      ...nearest.values(),
    ]).sort((a, b) => a.distanceM - b.distanceM || a.name.localeCompare(b.name));

    await addNearestPostcodes(amenities, warnings);

    return NextResponse.json(
      {
        point: { latitude, longitude },
        radiusM: LOCAL_RADIUS_M,
        amenities,
        warnings,
        sources: [
          ...(osmAvailable ? ["OpenStreetMap via Overpass API"] : []),
          ...(odsAvailable ? ["NHS Organisation Data Service"] : []),
          "Reviewed supplementary amenity register",
          "Postcodes.io",
        ],
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


