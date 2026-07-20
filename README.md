# Amenity Finder

A UK amenity screening tool for transport planning and development planning work. Select a point by entering latitude and longitude coordinates or clicking the map; retrieve mapped facilities; and export the results as a QGIS-ready GeoJSON point layer. An optional second step calculates pedestrian-network distances and exports them as an Excel-compatible CSV.

## Search method

- All standard amenity types are returned within a fixed 2 km straight-line radius.
- Bank and Post Office are nearest-only categories. The closest mapped feature is returned even when it is outside 2 km, using staged searches up to 100 km.
- Features carrying closed, disused, former, abandoned or other lifecycle tags are excluded. Bank points must also have a mapped name, brand or operator plus an operational/contact detail such as opening hours, telephone, website or survey/check date; low-confidence legacy bank points are ignored.
- Post Box is limited to the two closest mapped boxes within 2 km.
- ATM includes standalone OpenStreetMap `amenity=atm` features, ATMs mapped as `atm=yes` on another premises, and a small reviewed supplement for confirmed machines that are absent from OpenStreetMap.
- Convenience Store includes both OpenStreetMap `shop=convenience` and `shop=supermarket` features.
- Health Centre is the umbrella category for GP surgeries, doctors, health posts and qualifying mapped clinics. Hospitals are returned separately as Hospital. Where OSM health tags conflict with an explicit facility name such as "Medical Centre" or "Hospital", the name is used to select the category.
- Active GP practices, branch surgeries and pharmacies are also retrieved nationally from the NHS Organisation Data Service (ODS). A main Health Centre must have primary role `RO177` (prescribing cost centre) **and** the non-primary GP Practice role `RO76`; this excludes prisons, care-home services, specialist services, PCN hubs and other non-public prescribing cost centres. Branch surgeries use primary role `RO96`. Primary role `RO182` is classified as Pharmacy, while pharmacy headquarters (`RO181`) are excluded. Postcode districts around the full 2 km search area are checked rather than relying only on the centre postcode.
- Pharmacy is the umbrella category for pharmacies and chemists. It includes OpenStreetMap `amenity=pharmacy`, `healthcare=pharmacy` and `shop=chemist`/`shop=pharmacy`, together with NHS ODS pharmacy sites. A dispensing service mapped on a health centre is returned as a separate Pharmacy point at the same location.
- A generic OpenStreetMap clinic is only classified as Health Centre when its mapped name indicates a GP surgery, health/medical centre or medical practice. This prevents specialist clinics from being relabelled as GP facilities.
- OpenStreetMap day-care facilities are only classified as Nursery where the tags or mapped description identify provision for children; adult day-care is excluded from that category.
- OSM and ODS records are merged by facility identity and proximity. When both sources describe the same organisation, the active ODS name and postcode are retained with the more precise OSM geometry. ODS-only records are positioned at the postcode centroid and marked with a section symbol in the interface.
- Co-located facilities are spread slightly on the interactive map so each marker remains selectable. GeoJSON exports retain the source coordinates.
- Leisure includes recognisable facilities and explicitly named parks, nature reserves and recreation grounds; private-access features and unnamed broad land polygons are excluded.
- Most facility data is queried live from OpenStreetMap through the Overpass API. NHS ODS provides a national second source for active GP and pharmacy organisations. Confirmed facilities in other categories that are missing from OSM can be held in the reviewed supplementary register; these records retain a review date and expire automatically after 18 months.
- OSM and NHS ODS are requested independently. If either service is temporarily unavailable, results from the remaining source and the reviewed register are returned with a warning. Repeat the search before export so the full result can be checked.
- `addr:postcode` or `postal_code` is used where it exists in OpenStreetMap. Where it is absent, the nearest postcode is requested from Postcodes.io and marked with a dagger in the interface.
- Point geometry is exported in OSGB36 / British National Grid metres (EPSG:27700), with an explicit GeoJSON CRS declaration. Easting and northing are also included as attributes. Original WGS 84 longitude and latitude are retained as traceability attributes rather than geometry.
- GeoJSON export is immediate and does not wait for pedestrian routing. The separate **Calculate walking routes** control uses Valhalla pedestrian routing over the OpenStreetMap network, including roads, footways, paths and public rights of way where their mapped access tags permit walking.

## Walking-distance CSV

After amenities have been returned, select **Calculate walking routes**. The calculated network distance and estimated walking time are shown against each facility. Select **Export walking distances to CSV** to download an Excel-compatible UTF-8 CSV containing:

| Field | Purpose |
| --- | --- |
| `Straight_Line_m` | Direct distance used for the 2 km amenity search |
| `Walking_Distance_m` | Valhalla pedestrian-network distance from the selected site centre |
| `Walking_Time_min` | Modelled pedestrian journey time in minutes |
| `Route_Status` | `routed` or `unreachable` |
| `Easting`, `Northing` | Facility position in EPSG:27700 metres |
| `Longitude_WGS84`, `Latitude_WGS84` | Original source coordinates for traceability |

The walking calculation is optional and is deliberately independent of the GeoJSON workflow. If the public routing service is unavailable, the map and GeoJSON export remain usable.

## GeoJSON fields

The first three properties deliberately match the existing QGIS symbology workflow:

| Field | Purpose |
| --- | --- |
| `Type` | Fixed category value used for categorised symbology |
| `Name` | Mapped name, brand/operator, or a category fallback |
| `Postcode` | Premises postcode where mapped, otherwise the nearest available postcode |
| `Easting` | EPSG:27700 easting in metres |
| `Northing` | EPSG:27700 northing in metres |
| `Longitude_WGS84` | Original source longitude for traceability |
| `Latitude_WGS84` | Original source latitude for traceability |
| `Distance_m` | Straight-line distance from the selected point |
| `Outside_2km` | `true` for a nearest-only exception beyond the local radius |

Permitted `Type` values are: ATM, Bank, Community Centre, Convenience Store, Health Centre, Hospital, Leisure, Library, Nursery, Pharmacy, Place of Worship, Post Box, Post Office, Primary School, Public House, Secondary School, College and University.

## Data limitations

This is a proportionate desktop screening tool. OpenStreetMap coverage, names, classifications and opening status vary. NHS ODS confirms active organisation records but does not provide building coordinates through this workflow, so ODS-only points use postcode centroids and may not coincide with the entrance. Multiple organisations sharing one postcode are spread visually on the map; GeoJSON retains the source postcode-centroid coordinates. The WGS 84 to OSGB36 conversion uses the standard seven-parameter Helmert approximation. This is proportionate for amenity screening, but survey-control, access-design and other engineering coordinates should be transformed using OSTN15 in an appropriately configured GIS. The lifecycle and bank-identity filters reduce stale OSM results but cannot prove that a named facility is still trading. A nearest postcode is not necessarily the premises postcode. Critical facilities should be checked against operator, NHS or local authority information before being relied upon in a Transport Statement, Transport Assessment or planning submission. A dispensing GP practice is listed as a pharmacy service but may not operate as a general-access community pharmacy and should be checked before issue. The 2 km radius is straight-line distance rather than a walk-network catchment. Walking outputs follow the pedestrian network mapped in OpenStreetMap; an apparent route is not confirmation of a legally recorded public right of way, current site access, surfacing, lighting or personal-security suitability. These matters should be checked before issue.

## Development and deployment

```bash
pnpm install
pnpm dev
pnpm build
```

The project targets Cloudflare Workers using vinext and the Cloudflare Vite plugin. For Cloudflare Workers Builds, use `pnpm run build` as the build command and `pnpm exec wrangler deploy` as the deploy command. The Worker name is `amenity-finder`.

Data services: [OpenStreetMap / Overpass API](https://wiki.openstreetmap.org/wiki/Overpass_API), [NHS Organisation Data Service](https://digital.nhs.uk/services/organisation-data-service), [Postcodes.io](https://postcodes.io/) and [Valhalla pedestrian routing](https://valhalla.github.io/valhalla/api/matrix/api-reference/).

