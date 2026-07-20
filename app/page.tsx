"use client";

import type { CSSProperties, FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

type AmenityType =
  | "ATM"
  | "Bank"
  | "Community Centre"
  | "Convenience Store"
  | "Hospital"
  | "Leisure"
  | "Library"
  | "Medical Centre"
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

type Point = {
  latitude: number;
  longitude: number;
};

type Amenity = {
  id: string;
  type: AmenityType;
  name: string;
  postcode: string;
  postcodeSource: "osm" | "nearest" | "verified" | "unavailable";
  latitude: number;
  longitude: number;
  distanceM: number;
  outsideRadius: boolean;
};

type AmenitiesResponse = {
  amenities?: Amenity[];
  warnings?: string[];
  error?: string;
};

const TYPE_COLOURS: Record<AmenityType, string> = {
  ATM: "#f07b3f",
  Bank: "#d4a72c",
  "Community Centre": "#7b61a8",
  "Convenience Store": "#e07a2f",
  Hospital: "#b51f2e",
  Leisure: "#2b8c6f",
  Library: "#3478b8",
  "Medical Centre": "#d84f4f",
  Nursery: "#e8c93f",
  Pharmacy: "#3ca370",
  "Place of Worship": "#6d70c5",
  "Post Box": "#375ab7",
  "Post Office": "#cf4d45",
  "Primary School": "#4c7bd9",
  "Public House": "#b74a84",
  "Secondary School": "#c94444",
  College: "#2781a8",
  University: "#d1248b",
};

const LOCAL_RADIUS_M = 2_000;

function formatDistance(distanceM: number) {
  if (distanceM < 1_000) return `${distanceM.toLocaleString("en-GB")} m`;
  return `${(distanceM / 1_000).toFixed(1)} km`;
}

function coordinateLabel(point: Point) {
  return `${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}`;
}

function spreadMarkerCoordinates(items: Amenity[], itemIndex: number): [number, number] {
  const item = items[itemIndex];
  const colocatedIndices = items
    .map((candidate, index) => ({ candidate, index }))
    .filter(
      ({ candidate }) =>
        Math.abs(candidate.latitude - item.latitude) < 0.00001 &&
        Math.abs(candidate.longitude - item.longitude) < 0.00001,
    )
    .map(({ index }) => index);

  if (colocatedIndices.length < 2) return [item.latitude, item.longitude];

  const position = colocatedIndices.indexOf(itemIndex);
  const angle = (2 * Math.PI * position) / colocatedIndices.length;
  const offsetMetres = 10;
  const latitudeOffset = (offsetMetres / 111_320) * Math.cos(angle);
  const longitudeOffset =
    (offsetMetres / (111_320 * Math.cos((item.latitude * Math.PI) / 180))) *
    Math.sin(angle);

  return [item.latitude + latitudeOffset, item.longitude + longitudeOffset];
}

export default function Home() {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  const centreLayerRef = useRef<import("leaflet").LayerGroup | null>(null);
  const resultsLayerRef = useRef<import("leaflet").LayerGroup | null>(null);
  const pointRef = useRef<Point | null>(null);
  const moveModeRef = useRef(false);

  const [mapReady, setMapReady] = useState(false);
  const [point, setPoint] = useState<Point | null>(null);
  const [pointName, setPointName] = useState("No point selected");
  const [coordinateInput, setCoordinateInput] = useState("");
  const [amenities, setAmenities] = useState<Amenity[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [finding, setFinding] = useState(false);
  const [typeFilter, setTypeFilter] = useState<"All" | AmenityType>("All");
  const [moveMode, setMoveMode] = useState(false);

  useEffect(() => {
    let active = true;

    void import("leaflet").then((L) => {
      if (!active || !mapContainerRef.current || mapRef.current) return;

      leafletRef.current = L;
      const map = L.map(mapContainerRef.current, {
        zoomControl: false,
        attributionControl: true,
        minZoom: 5,
        maxZoom: 19,
      }).setView([54.25, -2.7], 6);

      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map);
      L.control.zoom({ position: "bottomright" }).addTo(map);

      map.on("click", (event: import("leaflet").LeafletMouseEvent) => {
        if (pointRef.current && !moveModeRef.current) return;

        const selectedPoint = {
          latitude: event.latlng.lat,
          longitude: event.latlng.lng,
        };
        pointRef.current = selectedPoint;
        moveModeRef.current = false;
        setPoint(selectedPoint);
        setMoveMode(false);
        setPointName("Dropped pin");
        setCoordinateInput(
          `${selectedPoint.latitude.toFixed(8)}, ${selectedPoint.longitude.toFixed(8)}`,
        );
        setAmenities([]);
        setWarnings([]);
        setError("");
      });

      mapRef.current = map;
      setMapReady(true);
      window.setTimeout(() => map.invalidateSize(), 100);
    });

    return () => {
      active = false;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map || !mapReady) return;

    centreLayerRef.current?.remove();
    if (!point) return;

    const centreIcon = L.divIcon({
      className: "centre-marker-shell",
      html: '<span class="centre-marker"><span></span></span>',
      iconSize: [44, 44],
      iconAnchor: [22, 22],
    });
    const layer = L.layerGroup([
      L.circle([point.latitude, point.longitude], {
        radius: LOCAL_RADIUS_M,
        color: "#d88b00",
        weight: 2,
        opacity: 0.95,
        fillColor: "#f2a900",
        fillOpacity: 0.075,
        dashArray: "8 7",
      }),
      L.marker([point.latitude, point.longitude], {
        icon: centreIcon,
        keyboard: false,
        zIndexOffset: 1000,
      }),
    ]).addTo(map);
    centreLayerRef.current = layer;
  }, [point, mapReady]);

  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map || !mapReady) return;

    resultsLayerRef.current?.remove();
    if (!amenities.length) return;

    const markers = amenities.map((item, index) => {
      const colour = TYPE_COLOURS[item.type];
      const marker = L.marker(spreadMarkerCoordinates(amenities, index), {
        icon: L.divIcon({
          className: "amenity-marker-shell",
          html: `<span class="amenity-marker" style="--marker-colour:${colour}">${index + 1}</span>`,
          iconSize: [32, 36],
          iconAnchor: [16, 18],
        }),
        title: `${item.name} — ${item.type}`,
      });

      const popup = document.createElement("div");
      popup.className = "map-popup";
      const popupType = document.createElement("span");
      popupType.textContent = item.type;
      const popupName = document.createElement("strong");
      popupName.textContent = item.name;
      const popupMeta = document.createElement("small");
      popupMeta.textContent = `${item.postcode} · ${formatDistance(item.distanceM)}`;
      popup.append(popupType, popupName, popupMeta);
      marker.bindPopup(popup, { closeButton: false, offset: [0, -8] });
      return marker;
    });

    resultsLayerRef.current = L.layerGroup(markers).addTo(map);
  }, [amenities, mapReady]);

  const presentTypes = useMemo(
    () => [...new Set(amenities.map((item) => item.type))].sort(),
    [amenities],
  );
  const visibleAmenities = useMemo(
    () =>
      typeFilter === "All"
        ? amenities
        : amenities.filter((item) => item.type === typeFilter),
    [amenities, typeFilter],
  );
  const outsideCount = amenities.filter((item) => item.outsideRadius).length;

  function selectPoint(nextPoint: Point, name: string, zoom = 14) {
    pointRef.current = nextPoint;
    moveModeRef.current = false;
    setPoint(nextPoint);
    setMoveMode(false);
    setPointName(name);
    setCoordinateInput(`${nextPoint.latitude}, ${nextPoint.longitude}`);
    setAmenities([]);
    setWarnings([]);
    setError("");
    mapRef.current?.setView([nextPoint.latitude, nextPoint.longitude], zoom);
  }

  function toggleMoveMode() {
    if (!point) return;
    const nextMoveMode = !moveModeRef.current;
    moveModeRef.current = nextMoveMode;
    setMoveMode(nextMoveMode);
  }

  function locateCoordinates(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parts = coordinateInput.split(",").map((part) => part.trim());
    const latitude = Number(parts[0]);
    const longitude = Number(parts[1]);
    setError("");

    if (
      parts.length !== 2 ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude)
    ) {
      setError("Enter coordinates as latitude, longitude.");
      return;
    }

    if (latitude < 49.5 || latitude > 61.2 || longitude < -8.8 || longitude > 2.1) {
      setError("Choose coordinates within the United Kingdom.");
      return;
    }

    selectPoint({ latitude, longitude }, "Entered coordinates");
  }

  async function findAmenities() {
    if (!point) return;

    setFinding(true);
    setError("");
    setWarnings([]);
    setTypeFilter("All");
    try {
      const response = await fetch(
        `/api/amenities?lat=${point.latitude}&lon=${point.longitude}`,
      );
      const data = (await response.json()) as AmenitiesResponse;
      if (!response.ok || data.error) throw new Error(data.error ?? "Amenity search failed.");

      const nextAmenities = data.amenities ?? [];
      setAmenities(nextAmenities);
      setWarnings(data.warnings ?? []);
      const L = leafletRef.current;
      if (L && mapRef.current) {
        mapRef.current.fitBounds(
          L.latLng(point.latitude, point.longitude).toBounds(4_800),
          { padding: [36, 36] },
        );
      }
      if (!nextAmenities.length) {
        setWarnings((current) => [
          ...current,
          "No mapped amenities were returned for this point.",
        ]);
      }
    } catch (searchError) {
      setAmenities([]);
      setError(
        searchError instanceof Error ? searchError.message : "Amenity search failed.",
      );
    } finally {
      setFinding(false);
    }
  }

  function focusAmenity(item: Amenity) {
    const map = mapRef.current;
    if (!map) return;
    map.flyTo([item.latitude, item.longitude], Math.max(map.getZoom(), 16), {
      duration: 0.65,
    });
  }

  function exportGeoJson() {
    if (!amenities.length) return;

    const geoJson = {
      type: "FeatureCollection",
      name: "Facilities and Services",
      features: amenities.map((item) => ({
        type: "Feature",
        id: item.id,
        geometry: {
          type: "Point",
          coordinates: [item.longitude, item.latitude],
        },
        properties: {
          Type: item.type,
          Name: item.name,
          Postcode: item.postcode,
          Distance_m: item.distanceM,
          Outside_2km: item.outsideRadius,
        },
      })),
    };
    const blob = new Blob([JSON.stringify(geoJson, null, 2)], {
      type: "application/geo+json",
    });
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const pointSlug = (pointName === "Dropped pin" ? coordinateLabel(point!) : pointName)
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase();
    link.href = downloadUrl;
    link.download = `amenities-${pointSlug || "site-centre"}.geojson`;
    link.click();
    URL.revokeObjectURL(downloadUrl);
  }

  return (
    <main className="app-shell">
      <aside className="control-panel">
        <header className="brand-header">
          <div className="brand-kicker">
            <span className="brand-mark" aria-hidden="true">
              +
            </span>
            Local services audit
          </div>
          <h1>
            Amenity
            <span>Finder</span>
          </h1>
          <p>
            Select one UK point. Find mapped facilities within 2 km and export a
            QGIS-ready GeoJSON layer.
          </p>
        </header>

        <section className="locator-card" aria-labelledby="location-heading">
          <div className="section-heading">
            <span>01</span>
            <h2 id="location-heading">Choose the centre point</h2>
          </div>
          <form className="coordinate-form" onSubmit={locateCoordinates}>
            <label htmlFor="coordinates">Coordinates (latitude, longitude)</label>
            <input
              id="coordinates"
              value={coordinateInput}
              onChange={(event) => setCoordinateInput(event.target.value)}
              placeholder="53.181488924139586, -2.6326643584326095"
              autoComplete="off"
              inputMode="decimal"
              spellCheck={false}
              aria-describedby="coordinate-hint"
            />
            <small id="coordinate-hint">Paste coordinates and press Enter</small>
          </form>
          <div className="location-actions">
            <span className="or-label">
              {!point
                ? "Or click anywhere on the map to set the point"
                : moveMode
                  ? "Click the map once to reposition; the point will relock automatically"
                  : "The centre point is locked to protect the current results"}
            </span>
          </div>
        </section>

        <section className={`selected-point ${point ? "is-set" : ""}`}>
          <span className="point-status" aria-hidden="true" />
          <div>
            <small>Selected point</small>
            <strong>{pointName}</strong>
            <span>{point ? coordinateLabel(point) : "Awaiting a map point"}</span>
          </div>
          {point ? (
            <button
              type="button"
              className={`point-lock-toggle ${moveMode ? "is-moving" : ""}`}
              onClick={toggleMoveMode}
              aria-pressed={moveMode}
            >
              <span className="lock-glyph" aria-hidden="true" />
              {moveMode ? "Cancel" : "Move point"}
            </button>
          ) : null}
          <div className="radius-badge">
            <b>2</b>
            <span>km</span>
          </div>
        </section>

        <button
          type="button"
          className="find-button"
          onClick={findAmenities}
          disabled={!point || finding}
        >
          <span>{finding ? "Searching mapped data…" : "Find local amenities"}</span>
          <b aria-hidden="true">→</b>
        </button>

        <div className="search-rule">
          <span className="rule-icon" aria-hidden="true">
            N
          </span>
          <p>
            <strong>Nearest regardless of 2 km:</strong> one bank and one post
            office. All other types are limited to the search radius.
          </p>
        </div>

        {error ? <div className="message error-message">{error}</div> : null}
        {warnings.map((warning) => (
          <div className="message warning-message" key={warning}>
            {warning}
          </div>
        ))}

        {amenities.length ? (
          <section className="results-section" aria-labelledby="results-heading">
            <div className="results-title-row">
              <div>
                <span>02</span>
                <h2 id="results-heading">Facilities and services</h2>
              </div>
              <strong>{amenities.length}</strong>
            </div>

            <div className="results-tools">
              <label htmlFor="type-filter">
                Show
                <select
                  id="type-filter"
                  value={typeFilter}
                  onChange={(event) =>
                    setTypeFilter(event.target.value as "All" | AmenityType)
                  }
                >
                  <option value="All">All types ({amenities.length})</option>
                  {presentTypes.map((type) => (
                    <option key={type} value={type}>
                      {type} ({amenities.filter((item) => item.type === type).length})
                    </option>
                  ))}
                </select>
              </label>
              <span>{outsideCount ? `${outsideCount} nearest outside 2 km` : "All within 2 km"}</span>
            </div>

            <ol className="results-list">
              {visibleAmenities.map((item) => {
                const markerNumber = amenities.findIndex((candidate) => candidate.id === item.id) + 1;
                return (
                  <li key={item.id}>
                    <button type="button" onClick={() => focusAmenity(item)}>
                      <span
                        className="result-number"
                        style={{ "--result-colour": TYPE_COLOURS[item.type] } as CSSProperties}
                      >
                        {markerNumber}
                      </span>
                      <span className="result-copy">
                        <small>{item.type}</small>
                        <strong>{item.name}</strong>
                        <span>
                          {item.postcode}
                          {item.postcodeSource === "nearest" ? <sup title="Nearest postcode to the mapped point">†</sup> : null}
                          {item.postcodeSource === "verified" ? <sup title="Reviewed supplementary amenity record">‡</sup> : null}
                        </span>
                      </span>
                      <span className={`distance ${item.outsideRadius ? "outside" : ""}`}>
                        {item.outsideRadius ? "Nearest" : formatDistance(item.distanceM)}
                        {item.outsideRadius ? <b>{formatDistance(item.distanceM)}</b> : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>

            <button type="button" className="export-button" onClick={exportGeoJson}>
              <span aria-hidden="true">⇩</span>
              Export {amenities.length} features to GeoJSON
            </button>
            <p className="export-note">
              Fields: <code>Type</code>, <code>Name</code>, <code>Postcode</code> ·
              WGS 84 (EPSG:4326). † nearest postcode where OSM has no premises
              postcode; ‡ reviewed supplementary amenity record.
            </p>
          </section>
        ) : null}

        <footer className="panel-footer">
          Amenity data © OpenStreetMap contributors plus reviewed supplementary locations ·
          Postcodes by Postcodes.io
        </footer>
      </aside>

      <section
        className={`map-stage ${moveMode ? "is-moving-point" : point ? "is-point-locked" : ""}`}
        aria-label="Amenity search map"
      >
        <div className="map-topbar">
          <span>
            <i aria-hidden="true" /> UK amenity coverage
          </span>
          <span className={moveMode ? "is-moving" : point ? "is-locked" : ""}>
            {!mapReady
              ? "Loading map…"
              : moveMode
                ? "Click map to move point"
                : point
                  ? "Centre point locked"
                  : "Map ready"}
          </span>
        </div>
        <div ref={mapContainerRef} className="map-canvas" />

        {!point || moveMode ? (
          <div className="map-prompt" aria-hidden="true">
            <span>{moveMode ? "↗" : "+"}</span>
            <strong>{moveMode ? "Choose the new centre" : "Drop the site centre"}</strong>
            <small>
              {moveMode
                ? "Click once to move the point and lock it again"
                : "Click the map to place a 2 km search radius"}
            </small>
          </div>
        ) : null}

        <div className="map-legend">
          <span><i className="legend-centre" /> Site centre</span>
          <span><i className="legend-radius" /> 2 km radius</span>
          <span><i className="legend-nearest" /> Nearest exception</span>
        </div>
        <div className="map-scale-note">Results use mapped OpenStreetMap features plus reviewed supplements; verify critical facilities before reporting.</div>
      </section>
    </main>
  );
}

