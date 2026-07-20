import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

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

test("keeps the QGIS schema and nearest exceptions explicit", async () => {
  const [page, route] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/amenities/route.ts", import.meta.url), "utf8"),
    access(new URL("../public/og.png", import.meta.url)),
  ]);

  assert.match(page, /Type: item\.type/);
  assert.match(page, /Name: item\.name/);
  assert.match(page, /Postcode: item\.postcode/);
  assert.match(route, /\["Bank", "Post Office"\]/);
  assert.match(route, /LOCAL_RADIUS_M = 2_000/);
});

test("keeps medical centres, hospitals and pharmacies distinct", async () => {
  const [page, route] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/amenities/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(page, /\| "Hospital"/);
  assert.match(page, /\| "Medical Centre"/);
  assert.match(route, /const isHospitalTag =/);
  assert.match(route, /nameLooksLikeHospital/);
  assert.match(route, /nameLooksLikeMedicalCentre/);
  assert.match(route, /\["chemist", "pharmacy"\]\.includes\(shop\)/);
  assert.match(route, /healthcare === "pharmacy"/);
  assert.match(route, /primaryType === "Medical Centre"/);
  assert.match(route, /tags\.dispensing/);
  assert.doesNotMatch(page, /\| "Chemist"/);
  assert.doesNotMatch(page, /\| "Health Centre"/);
});

test("includes reviewed Littleborough healthcare omissions", async () => {
  const [page, route] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/amenities/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(route, /littleborough-cohens-hare-hill-road/);
  assert.match(route, /littleborough-your-village-pharmacy/);
  assert.match(route, /littleborough-group-practice/);
  assert.match(route, /littleborough-jhoots-pharmacy/);
  assert.match(route, /toVerifiedAmenities/);
  assert.match(route, /Live OpenStreetMap data is temporarily unavailable/);
  assert.match(route, /osmAvailable \? FALLBACK_RADII_M : \[\]/);
  assert.match(page, /Reviewed supplementary amenity record/);
  assert.match(page, /spreadMarkerCoordinates/);
});
