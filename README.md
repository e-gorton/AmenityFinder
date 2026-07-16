# Amenity Finder

A UK amenity screening tool for transport planning and development planning work. Select a point by entering latitude and longitude coordinates or clicking the map; retrieve mapped facilities; and export the results as a QGIS-ready GeoJSON point layer.

## Search method

- All standard amenity types are returned within a fixed 2 km straight-line radius.
- Bank and Post Office are nearest-only categories. The closest mapped feature is returned even when it is outside 2 km, using staged searches up to 100 km.
- Features carrying closed, disused, former, abandoned or other lifecycle tags are excluded. Bank points must also have a mapped name, brand or operator plus an operational/contact detail such as opening hours, telephone, website or survey/check date; low-confidence legacy bank points are ignored.
- Post Box is limited to the two closest mapped boxes within 2 km.
- ATM includes standalone OpenStreetMap `amenity=atm` features, ATMs mapped as `atm=yes` on another premises, and a small reviewed supplement for confirmed machines that are absent from OpenStreetMap. A verified supplement is deduplicated when a corresponding OSM point appears within 40 m and expires automatically 18 months after its review date.
- Convenience Store includes both OpenStreetMap `shop=convenience` and `shop=supermarket` features.
- Leisure includes recognisable facilities and explicitly named parks, nature reserves and recreation grounds; private-access features and unnamed broad land polygons are excluded.
- Most data is queried live from OpenStreetMap through the Overpass API. The reviewed ATM supplement records its own verification date in the source code so it can be checked independently.
- `addr:postcode` or `postal_code` is used where it exists in OpenStreetMap. Where it is absent, the nearest postcode is requested from Postcodes.io and marked with a dagger in the interface.
- Points are exported in WGS 84 longitude/latitude coordinates (EPSG:4326).

## GeoJSON fields

The first three properties deliberately match the existing QGIS symbology workflow:

| Field | Purpose |
| --- | --- |
| `Type` | Fixed category value used for categorised symbology |
| `Name` | Mapped name, brand/operator, or a category fallback |
| `Postcode` | Premises postcode where mapped, otherwise the nearest available postcode |
| `Distance_m` | Straight-line distance from the selected point |
| `Outside_2km` | `true` for a nearest-only exception beyond the local radius |

Permitted `Type` values are: ATM, Bank, Chemist, Community Centre, Convenience Store, Health Centre, Leisure, Library, Nursery, Pharmacy, Place of Worship, Post Box, Post Office, Primary School, Public House, Secondary School, College and University.

## Data limitations

This is a proportionate desktop screening tool. OpenStreetMap coverage, names, classifications and opening status vary. The lifecycle and bank-identity filters reduce stale results but cannot prove that a named facility is still trading. An ATM attached to a host premises, or added from the reviewed supplement, may use the host or postcode location rather than the exact machine position. A nearest postcode is not necessarily the premises postcode. Critical facilities should be checked against operator or local authority information before being relied upon in a Transport Statement, Transport Assessment or planning submission. The 2 km radius is straight-line distance rather than a walk-network catchment.

## Development and deployment

```bash
pnpm install
pnpm dev
pnpm build
```

The project targets Cloudflare Workers using vinext and the Cloudflare Vite plugin. For Cloudflare Workers Builds, use `pnpm run build` as the build command and `pnpm exec wrangler deploy` as the deploy command. The Worker name is `amenity-finder`.

Data services: [OpenStreetMap / Overpass API](https://wiki.openstreetmap.org/wiki/Overpass_API) and [Postcodes.io](https://postcodes.io/).

