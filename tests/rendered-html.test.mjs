import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import proj4 from "proj4";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

function declaredAmenityTypes(source) {
  const union = source.match(/type AmenityType\s*=([\s\S]*?);/);
  assert.ok(union, "AmenityType union should be declared");
  return [...union[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]).sort();
}

test("server-renders the finished amenity finder", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Amenity Finder \| Local facilities to GeoJSON<\/title>/i);
  assert.match(html, /Amenity/);
  assert.match(html, /Finder/);
  assert.match(html, /Choose the centre point/);
  assert.match(html, /Find local amenities/);
  assert.match(html, /Nearest regardless of 2 km/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("keeps the QGIS schema in British National Grid", async () => {
  const [page, route] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/amenities/route.ts", import.meta.url), "utf8"),
    access(new URL("../public/og.png", import.meta.url)),
  ]);

  assert.match(page, /Type: item\.type/);
  assert.match(page, /Name: item\.name/);
  assert.match(page, /Postcode: item\.postcode/);
  assert.match(page, /urn:ogc:def:crs:EPSG::27700/);
  assert.match(page, /coordinates: \[easting, northing\]/);
  assert.match(page, /Easting: easting/);
  assert.match(page, /Northing: northing/);
  assert.match(page, /Longitude_WGS84: item\.longitude/);
  assert.match(page, /Latitude_WGS84: item\.latitude/);
  assert.match(page, /-epsg27700\.geojson/);
  assert.doesNotMatch(page, /coordinates: \[item\.longitude, item\.latitude\]/);
  assert.match(route, /\["Bank", "Post Office"\]/);
  assert.match(route, /LOCAL_RADIUS_M = 2_000/);
});

test("projects representative UK coordinates to metre-based BNG values", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const definition = page.match(/proj4\.defs\(\s*BNG_CRS,\s*"([^"]+)"/);
  assert.ok(definition, "EPSG:27700 projection definition should be present");
  proj4.defs("EPSG:27700", definition[1]);

  const longitude = -2.4694089154855368;
  const latitude = 53.270213373695256;
  const [easting, northing] = proj4("EPSG:4326", "EPSG:27700", [
    longitude,
    latitude,
  ]);
  assert.ok(easting > 300_000 && easting < 450_000);
  assert.ok(northing > 300_000 && northing < 450_000);

  const [roundTripLongitude, roundTripLatitude] = proj4(
    "EPSG:27700",
    "EPSG:4326",
    [easting, northing],
  );
  assert.ok(Math.abs(roundTripLongitude - longitude) < 0.000001);
  assert.ok(Math.abs(roundTripLatitude - latitude) < 0.000001);
});

test("keeps health centres, hospitals and pharmacies distinct", async () => {
  const [page, route] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/amenities/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(page, /\| "Hospital"/);
  assert.match(page, /\| "Health Centre"/);
  assert.match(route, /const isHospitalTag =/);
  assert.match(route, /const isGenericClinicTag =/);
  assert.match(route, /isGenericClinicTag && nameLooksLikeMedicalCentre/);
  assert.match(route, /nameLooksLikeHospital/);
  assert.match(route, /nameLooksLikeMedicalCentre/);
  assert.match(route, /\["chemist", "pharmacy"\]\.includes\(shop\)/);
  assert.match(route, /healthcare === "pharmacy"/);
  assert.match(route, /primaryType === "Health Centre"/);
  assert.match(route, /tags\.dispensing/);
  assert.match(route, /const isChildDayCare =/);
  assert.match(route, /tags\["social_facility:for"\]/);
  assert.doesNotMatch(page, /\| "Chemist"/);
  assert.doesNotMatch(page, /\| "Medical Centre"/);
});

test("keeps every amenity category synchronised across API and interface", async () => {
  const [page, route] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/amenities/route.ts", import.meta.url), "utf8"),
  ]);
  const expected = [
    "ATM",
    "Bank",
    "College",
    "Community Centre",
    "Convenience Store",
    "Hospital",
    "Leisure",
    "Library",
    "Health Centre",
    "Nursery",
    "Pharmacy",
    "Place of Worship",
    "Post Box",
    "Post Office",
    "Primary School",
    "Public House",
    "Secondary School",
    "University",
  ].sort();

  assert.deepEqual(declaredAmenityTypes(route), expected);
  assert.deepEqual(declaredAmenityTypes(page), expected);
});

test("keeps walking routing optional and separate from immediate GeoJSON export", async () => {
  const [page, route, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/walking-distances/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /function exportGeoJson\(\)/);
  assert.match(page, /function calculateWalkingRoutes\(\)/);
  assert.match(page, /Calculate walking routes/);
  assert.match(page, /Export walking distances to CSV/);
  assert.match(page, /Walking_Distance_m/);
  assert.match(page, /Walking_Time_min/);
  assert.match(page, /\["\\uFEFF", csv\]/);
  assert.match(route, /sources_to_targets/);
  assert.match(route, /costing: "pedestrian"/);
  assert.match(route, /MATRIX_BATCH_SIZE = 40/);
  assert.doesNotMatch(route, /MAX_DESTINATIONS|maximum of .* walking destinations/i);
  assert.match(route, /WALKING_SPEED_KMH = 4\.8/);
  assert.match(route, /Math\.round\(distanceKm \* 1_000\)/);
  assert.match(route, /Math\.round\(\(distanceKm \/ WALKING_SPEED_KMH\) \* 3_600\)/);
  assert.match(page, /Journey times assume 4\.8 km\/h/);
  assert.match(route, /The GeoJSON export remains available/);
  assert.doesNotMatch(css, /\.centre-marker::before/);
  assert.doesNotMatch(css, /\.centre-marker::after/);
  assert.doesNotMatch(page, /moveMode \? "↗" : "\+"/);
});

test("supplements OSM with the national NHS GP and pharmacy register", async () => {
  const [page, route] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/amenities/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(route, /directory\.spineservices\.nhs\.uk\/ORD\/2-0-0/);
  assert.match(route, /RO177: "Health Centre"/);
  assert.match(route, /RO182: "Pharmacy"/);
  assert.match(route, /RO96: "Health Centre"/);
  assert.match(route, /Roles: "RO76,RO96,RO182"/);
  assert.match(route, /RO177 covers every prescribing cost centre/);
  assert.match(route, /fetchNhsOdsAmenities/);
  assert.match(route, /Status: "Active"/);
  assert.match(route, /postcodeDistrictSamplePoints/);
  assert.match(route, /source: "nhs-ods"/);
  assert.doesNotMatch(route, /littleborough-cohens-hare-hill-road/);
  assert.doesNotMatch(route, /littleborough-group-practice/);
  assert.doesNotMatch(route, /HMP BUCKLEY HALL/);
  assert.match(route, /toVerifiedAmenities/);
  assert.match(route, /Live OpenStreetMap data is temporarily unavailable/);
  assert.match(route, /osmAvailable \? FALLBACK_RADII_M : \[\]/);
  assert.match(route, /OVERPASS_REQUEST_TIMEOUT_MS = 25_000/);
  assert.match(page, /Active NHS ODS organisation/);
  assert.match(page, /Reviewed supplementary amenity record/);
  assert.match(page, /spreadMarkerCoordinates/);
});

