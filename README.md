# GeoBoardXR — VR Terrain & Data Viewer

An interactive tabletop-scale VR terrain viewer built with BabylonJS and Mapbox terrain data, with full WebXR support for VR headsets. Drop GeoJSON files into `public/data/` to visualise points, polygons, and lines on the terrain with animations, labels, and interactive info panels.

**VR and AR are supported** via the WebXR API. VR has been tested and is fully functional. AR works via WebXR passthrough but has not been tested or fine-tuned — proper surface anchoring, scaling, and occlusion are planned future work.

Tested on: Brave desktop, Meta Quest 2.

---

## Screenshots & Video

▶ [Watch demo video](https://hcilab.no/geoboardxr/promo/geoboardxr-demo.mp4) - recorded on Meta Quest 2 via local IP (Wi-Fi) connection to a dev server

| | |
|---|---|
| ![Tabletop view 1](https://hcilab.no/geoboardxr/promo/tabletop1.png) | ![Tabletop view 2](https://hcilab.no/geoboardxr/promo/tabletop2.png) |
| ![Overview 1](https://hcilab.no/geoboardxr/promo/overview1.png?v=2) | ![Overview 2](https://hcilab.no/geoboardxr/promo/overview2.png) |
| ![Navigation](https://hcilab.no/geoboardxr/promo/navigation.png) | ![Animation](https://hcilab.no/geoboardxr/promo/animation.png) |
| ![3D model icon](https://hcilab.no/geoboardxr/promo/3dmodelicon.png) | |

---

## Features

- **Terrain** — real elevation from Mapbox Terrain-RGB DEM tiles, refined by Kartverket 50cm DTM where available. Adaptive mesh simplification via Martini RTIN.
- **Satellite texture** — Mapbox satellite imagery draped over the terrain.
- **OSM layers** — buildings (colour-coded by type), roads, and place labels fetched from OpenStreetMap via Overpass API, cached in `localStorage` for 7 days.
- **GeoJSON data layers** — drop any `.geojson` file into `public/data/` and it is automatically loaded and assigned a toggle button. Supports:
  - **Points** — stick + bubble pins, optional 3D GLB model, click-to-show info on projection walls
  - **Polygons** — coloured fill, fire particle animation, or wave animation
  - **Lines** — flat ribbons or vertical walls with labels
- **Toggle buttons** — physical 3D buttons placed around the table edge, one per layer per side. Button width auto-fits the label text.
- **WebXR** — VR and AR modes, teleportation locomotion, pointer selection, compatible with any OpenXR headset (Quest, Vive, Index, etc.).
- **Caching & performance** — OSM data is cached in `localStorage` to avoid redundant API calls. The terrain mesh uses adaptive simplification (Martini RTIN) to keep polygon count low, making it viable on mobile GPUs such as the one in Meta Quest 2.

**Datasets, APIs, and related visualizations have been previously tested on the open-source [GeoBed3D](https://github.com/SINTEF/GeoBed3D) testbed, developed by the [HCI group](https://www.sintef.no/en/digital/departments/sustainable-communication-technologies/human-computer-interaction/) - SINTEF Digital.**

---

## Getting Started

### Prerequisites

- Node.js 18+
- A [Mapbox access token](https://docs.mapbox.com/help/dive-deeper/access-tokens/)

### Setup

```sh
npm install
cp .env.example .env
# Edit .env and replace pk.your_token_here with your actual token
npm run dev
```

Open the URL shown in the terminal (default `https://localhost:5173`). HTTPS is required for WebXR — the dev server uses a self-signed certificate via `@vitejs/plugin-basic-ssl`.

### Build

```sh
npm run build
# Production output is in dist/
```

Deploy the contents of `dist/` to any static web host. Update the `base` path in `vite.config.ts` to match your server subdirectory before building.

---

## Testing on a VR/AR Headset from a Local Dev Server

WebXR requires HTTPS. The dev server already serves over HTTPS on your local machine, but your headset needs to reach it over your local network.

### Using your local IP (Wi-Fi)

Find your machine's local IP address:

```sh
# macOS / Linux
ipconfig getifaddr en0

# Windows
ipconfig   # look for IPv4 Address under your Wi-Fi adapter
```

Then open `https://192.168.x.x:5173` in the Quest browser (or any headset browser). You will get a certificate warning — tap **Advanced → Proceed** to continue. This is expected with a self-signed cert on a local server.

### Meta Quest — USB link (most reliable)

Connecting via USB avoids Wi-Fi latency and certificate issues on Quest:

```sh
# Requires Android SDK Platform Tools (adb)
adb devices                        # confirm Quest is connected and authorised
adb reverse tcp:5173 tcp:5173      # forward the port to the headset
# Then open https://localhost:5173 in the Quest browser
```

With `adb reverse`, the Quest resolves `localhost:5173` directly to your machine — no IP needed, cert warning may not appear.

---

## WebXR / VR + AR Headsets

When a compatible headset is detected, an **Enter VR** (or **Enter AR**) button appears in the bottom-right corner.

### Meta Quest (standalone)

1. Open the app URL in the Quest browser.
2. Press **Enter VR** or **Enter AR**.
3. Use the left thumbstick to aim the teleportation arc; release to teleport.
4. Point at 3D buttons or info pins and press the trigger to interact.

### PC-tethered headsets (HTC Vive, Valve Index, Pimax, HP Reverb, …)

GeoBoardXR works with any headset that exposes an OpenXR runtime on Windows:

1. Start **SteamVR** (Vive, Index) or your headset's OpenXR runtime.
2. Open **Chrome** or **Edge** on the PC and navigate to the app URL.
3. Press **Enter VR** — the scene loads directly into the headset.
4. Controls map automatically via WebXR Input Profiles:
   - Vive wands: touch trackpad to aim, press to teleport.
   - Thumbstick controllers: push forward to aim, release to teleport.

### Browser emulation (no headset)

Install the [Immersive Web Emulator](https://chrome.google.com/webstore/detail/immersive-web-emulator/cgffilbpcibhmcfbgggfhfolhkfbhmik) extension, open DevTools → **WebXR** tab.

---

## GeoJSON Data Layers

Place any `.geojson` FeatureCollection in `public/data/`. It is picked up automatically on next server start. See [`public/data/geojson-guide.html`](public/data/geojson-guide.html) for full property documentation.

### Quick reference

**FeatureCollection**
```json
{
  "type": "FeatureCollection",
  "name": "My Layer",
  "features": [ ... ]
}
```
The `name` field becomes the toggle button label.

**Point**
```json
{
  "type": "Feature",
  "geometry": { "type": "Point", "coordinates": [lng, lat] },
  "properties": {
    "title": "Label text",
    "color": "#ff0000",
    "information": "Text shown on walls when clicked.\nNewlines supported.",
    "image": "photo.jpg",
    "3dmodel": "model.glb"
  }
}
```
- Infopoints (with `information`) default to green `#23d110` and turn grayish-white when selected.
- GLB files go in `public/data/` alongside the GeoJSON.

**Polygon**
```json
{
  "type": "Feature",
  "geometry": { "type": "Polygon", "coordinates": [[ [lng,lat], ... ]] },
  "properties": {
    "title": "Zone name",
    "color": "#0044ff",
    "opacity": 70,
    "animation": "fire"
  }
}
```
`animation` accepts `"fire"` or `"wave"`. When an animation is active the polygon fill is hidden and replaced by the animation.

**LineString**
```json
{
  "type": "Feature",
  "geometry": { "type": "LineString", "coordinates": [[ [lng,lat], ... ]] },
  "properties": {
    "title": "Route name",
    "color": "#ff6600",
    "linewidth": 4,
    "lineheight": 12
  }
}
```
A tall `lineheight` relative to `linewidth` renders as a vertical wall; otherwise the line is a flat ribbon on the terrain.

---

## Buildings Colour Legend

See [`public/data/buildings-legend.html`](public/data/buildings-legend.html) for the full colour legend. Summary:

| Colour | Type |
|---|---|
| 🔵 Blue `#60a5fa` | Residential |
| 🟠 Orange `#fb923c` | Commercial |
| 🟢 Green `#34d399` | Office |
| 🔴 Red `#f87171` | Industrial |
| ⚫ Slate `#94a3b8` | Garage |
| 🟡 Amber `#fbbf24` | Education |
| 🩷 Pink `#f472b6` | Hospital |
| 🟣 Purple `#e879f9` | Religious |
| 🩵 Teal `#2dd4bf` | Hotel |
| 💜 Violet `#a78bfa` | Stadium |
| ⬜ Light `#cbd5e1` | Other |

---

## Caching & Performance

OSM buildings, roads, and place labels are fetched once from the [Overpass API](https://overpass-api.de/) and cached in `localStorage` for **7 days**, saving API calls and reducing load time on repeat visits. The terrain mesh is built with Martini RTIN adaptive simplification — triangle count scales with the `MAX_ERROR` constant in `main.ts`, keeping the scene lightweight enough for standalone mobile GPUs (tested on Meta Quest 2).

To force a full data refresh:

```js
localStorage.clear()  // run in the browser console
```

The cache key includes tile coordinates, so changing the map area (`ANCHOR` in `main.ts`) automatically fetches fresh data for the new location.

---

## Architecture

```
src/
├── main.ts                          # composition root — wires all layers together
├── data/
│   ├── types.ts                     # shared types (LatLngAltLike, TerrainData, …)
│   ├── geo.ts                       # pure coordinate math, no BabylonJS dependency
│   ├── TerrainBuilder.ts            # Martini RTIN mesh builder
│   ├── adapters/
│   │   ├── mapboxTerrainAdapter.ts  # Mapbox DEM tile fetch + decode
│   │   └── kartverketElevationAdapter.ts  # Kartverket DTM (Norwegian hi-res DEM)
│   └── loaders/
│       ├── geojsonLoader.ts         # GeoJSON FeatureCollection parser
│       ├── osmBuildingLoader.ts     # Overpass API — buildings (localStorage cache)
│       ├── osmRoadLoader.ts         # Overpass API — roads   (localStorage cache)
│       └── osmPlaceLoader.ts        # Overpass API — places  (localStorage cache)
├── scene/
│   ├── SceneManager.ts              # BabylonJS engine + scene factory
│   ├── TerrainMesh.ts               # terrain mesh + lat/lng ↔ world coord API
│   ├── BuildingLayer.ts             # OSM building extrusions, merged by type
│   ├── RoadLayer.ts                 # OSM road ribbons
│   ├── PlaceLabels.ts               # OSM place name billboards
│   ├── GeoJSONPointLayer.ts         # pins, GLB models, click-to-info
│   ├── GeoJSONPolygonLayer.ts       # filled polygons, fire, wave
│   ├── GeoJSONLineLayer.ts          # road/wall ribbons with labels
│   ├── ToggleButtons.ts             # 3D toggle buttons around table edge
│   ├── ProjectionWalls.ts           # info display panels (text + image)
│   ├── Table.ts                     # physical table mesh
│   ├── Room.ts                      # room environment
│   └── billboardUtils.ts            # camera-facing label plane helper
└── xr/
    └── XRManager.ts                 # WebXRDefaultExperience setup
```

**Layer rule:** `src/data/` never imports BabylonJS. All BabylonJS usage is confined to `src/scene/` and `src/xr/`. Adapters are wired together only in `main.ts`.

---

## Tech Stack

| Library | Version | Role |
|---|---|---|
| [Vite](https://vite.dev/) | 7 | Build tool + dev server |
| [TypeScript](https://www.typescriptlang.org/) | 5.9 | Language |
| [BabylonJS](https://www.babylonjs.com/) | 8 | 3D engine + WebXR |
| [Mapbox](https://docs.mapbox.com/) | — | DEM + satellite tiles |
| [@mapbox/martini](https://github.com/mapbox/martini) | 0.2 | Adaptive mesh simplification |
| [earcut](https://github.com/mapbox/earcut) | 3 | Polygon triangulation |
| [geotiff](https://github.com/geotiffjs/geotiff) | 3 | GeoTIFF parsing |

---

## Future Work

Contributions are welcome. Open an issue to discuss before starting:

- **Region switching robustness** — thorough testing of geographic region switching to surface and resolve edge cases, race conditions, and loading bugs across terrain, OSM, and data layers
- **Overpass API resilience** — OSM data (buildings, roads, place labels) is fetched from the public `overpass-api.de` endpoint, which has no availability guarantees. Adding fallback rotation across community mirrors (`overpass.kumi.systems`, `overpass.openstreetmap.ru`) would make the first-load experience significantly more reliable
- **AR tuning** — AR mode works via WebXR passthrough but needs calibration for table-scale placement and occlusion on different devices
- **Bathymetry & ocean terrain** — integrate seafloor elevation data and ocean current / water column datasets as dedicated layers
- **Fuzzy cognitive maps** — visualise FCM nodes and weighted edges as an interactive 3D graph layer on the terrain
- **Avatars & multi-user** — shared presence in the same geographic space, with avatar representation and synchronised layer toggles
- **Video projection** — play video content on the projection walls in the scene, alongside images and text
- **Live data integration** — connect to external APIs to stream real-time data (sensor feeds, live ocean data, traffic, etc.)
- **CMS / API layer** — a backend content and data management layer for GeoBed3D, enabling organisations to publish, version, and serve geospatial datasets directly to the platform (Sanity.io? Pocketbase?)

---

## License

[GNU Affero General Public License v3.0](LICENSE) — © 2026 SINTEF

You may use, modify, and distribute this software under the terms of AGPL-3.0. If you run a modified version as a networked service, you must make the source available to users of that service.

---

## Acknowledgements
 
This application was developed in the [RESIST EU project](https://cordis.europa.eu/project/id/101093968) (grant agreement no. 101093968). GeoBoardXR is a development stage on the path toward the [OceanModel](https://github.com/SINTEF/oceanwebxrmodel) application - an interactive VR ocean and terrain model of the Vesterålen archipelago in northern Norway, developed under WP3 (Vesterålen regional partners: Vesterålen Regionråd, Lofotr Næringsdrift AS, and Andfjord Salmon AS). The architecture, XR interaction patterns, and data layer system built here are part of the OceanModel application. Developed by [Maria Emine Nylund](mailto:maria.nylund@sintef.no), [Ophelia Prillard](mailto:ophelia.prillard@sintef.no), and [Costas Boletsis](mailto:konstantinos.boletsis@sintef.no) at [SINTEF](https://www.sintef.no) (HCI group) and [XR Lab Norway](https://www.xrlab.no).