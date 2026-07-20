# Amenity Finder

A UK amenity screening tool for transport planning and development planning work. Select a point by entering latitude and longitude coordinates or clicking the map; retrieve mapped facilities; and export the results as a QGIS-ready GeoJSON point layer.

## Search method

- All standard amenity types are returned within a fixed 2 km straight-line radius.
- Bank and Post Office are nearest-only categories. The closest mapped feature is returned even when it is outside 2 km, using staged searches up to 100 km.
- Features carrying closed, disused, former, abandoned or other lifecycle tags are excluded. Bank points must also have a mapped name, brand or operator plus an operational/contact detail such as opening hours, telephone, website or survey/check date; low-confidence legacy bank points are ignored.
- Post Box is limited to the two closest mapped boxes within 2 km.
- ATM includes standalone OpenStreetMap `amenity=atm` features, ATMs mapped as `atm=yes` on another premises, and a small reviewed supplement for confirmed machines that are absent from OpenStreetMap.
- Convenience Store includes both OpenStreetMap `shop=convenience` and `shop=supermarket` features.
- Medical Centre includes GP surgeries, doctors, health posts and mapped clinics. Hospitals are returned separately as Hospital. Where OSM health tags conflict with an explicit facility name such as "Medical Centre" or "Hospital", the name is used to select the category.
- Active GP prescribing sites and pharmacies are also retrieved nationally from the NHS Organisation Data Service (ODS). ODS role `RO177` is classified as Medical Centre and role `RO182` as Pharmacy; pharmacy headquarters (`RO181`) are excluded. Postcode districts around the full 2 km search area are checked rather than relying only on the centre postcode.
- Pharmacy also includes OpenStreetMap `amenity=pharmacy`, `healthcare=pharmacy` and `shop=chemist`/`shop=pharmacy`. A dispensing service mapped on a medical centre is returned as a separate pharmacy point at the same location.
- OSM and ODS records are merged by facility identity and proximity. When both sources describe the same organisation, the active ODS name and postcode are retained with the more precise OSM geometry. ODS-only records are positioned at the postcode centroid and marked with a section symbol in the interface.
- Co-located facilities are spread slightly on the interactive map so each marker remains selectable. GeoJSON exports retain the source coordinates.
- Leisure includes recognisable facilities and explicitly named parks, nature reserves and recreation grounds; private-access features and unnamed broad land polygons are excluded.
- Most facility data is queried live from OpenStreetMap through the Overpass API. NHS ODS provides a national second source for active GP and pharmacy organisations. Confirmed facilities in other categories that are missing from OSM can be held in the reviewed supplementary register; these records retain a review date and expire automatically after 18 months.
- OSM and NHS ODS are requested independently. If either service is temporarily unavailable, results from the remaining source and the reviewed register are returned with a warning. Repeat the search before export so the full result can be checked.
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

Permitted `Type` values are: ATM, Bank, Community Centre, Convenience Store, Hospital, Leisure, Library, Medical Centre, Nursery, Pharmacy, Place of Worship, Post Box, Post Office, Primary School, Public House, Secondary School, College and University.

## Data limitations

This is a proportionate desktop screening tool. OpenStreetMap coverage, names, classifications and opening status vary. NHS ODS confirms active organisation records but does not provide building coordinates through this workflow, so ODS-only points use postcode centroids and may not coincide with the entrance. Multiple organisations sharing one postcode are spread visually on the map; GeoJSON retains the source postcode-centroid coordinates. The lifecycle and bank-identity filters reduce stale OSM results but cannot prove that a named facility is still trading. A nearest postcode is not necessarily the premises postcode. Critical facilities should be checked against operator, NHS or local authority information before being relied upon in a Transport Statement, Transport Assessment or planning submission. A dispensing GP practice is listed as a pharmacy service but may not operate as a general-access community pharmacy and should be checked before issue. The 2 km radius is straight-line distance rather than a walk-network catchment.

## Development and deployment

```bash
pnpm install
pnpm dev
pnpm build
```

The project targets Cloudflare Workers using vinext and the Cloudflare Vite plugin. For Cloudflare Workers Builds, use `pnpm run build` as the build command and `pnpm exec wrangler deploy` as the deploy command. The Worker name is `amenity-finder`.

Data services: [OpenStreetMap / Overpass API](https://wiki.openstreetmap.org/wiki/Overpass_API), [NHS Organisation Data Service](https://digital.nhs.uk/services/organisation-data-service) and [Postcodes.io](https://postcodes.io/).

