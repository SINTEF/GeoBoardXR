// Side-effect: registers glTF loader
import "@babylonjs/loaders/glTF/2.0";
// Side-effect: patches Scene.prototype.beginAnimation/stopAnimation etc. (required by WebXRDefaultExperience)
import "@babylonjs/core/Animations/animatable";
// Side-effect: registers all Node Material block classes so WebXRDefaultExperience can deserialize
// hand/controller shader snippets downloaded from the Babylon.js snippet server at runtime.
import "@babylonjs/core/Materials/Node/Blocks";

import { WebXRState } from "@babylonjs/core/XR/webXRTypes";
import { AdvancedDynamicTexture } from "@babylonjs/gui/2D/advancedDynamicTexture";

import { createScene } from "./scene/SceneManager";
import { TerrainMesh } from "./scene/TerrainMesh";
import { MapboxTerrainAdapter, lngLatToTile, tileBoundsLngLat } from "./data/adapters/mapboxTerrainAdapter";
import { KartverketElevationAdapter } from "./data/adapters/kartverketElevationAdapter";
import { loadOSMBuildings } from "./data/loaders/osmBuildingLoader";
import { loadOSMRoads } from "./data/loaders/osmRoadLoader";
import { createRoadLayer } from "./scene/RoadLayer";
import { createBuildingLayer } from "./scene/BuildingLayer";
import { loadOSMPlaces } from "./data/loaders/osmPlaceLoader";
import { createPlaceLabels } from "./scene/PlaceLabels";
import { createToggleButtons } from "./scene/ToggleButtons";
import { buildGeometry } from "./data/TerrainBuilder";
import { initXR } from "./xr/XRManager";
import geojsonFiles from "virtual:geojson-manifest";
import { loadGeoJSONFeatures } from "./data/loaders/geojsonLoader";
import { createGeoJSONPointLayer, type PinState } from "./scene/GeoJSONPointLayer";
import { createGeoJSONPolygonLayer } from "./scene/GeoJSONPolygonLayer";
import { createGeoJSONLineLayer } from "./scene/GeoJSONLineLayer";
import { createDebugOverlay } from "./scene/DebugHelpers";
import { createTable } from "./scene/Table";
import { createRoom } from "./scene/Room";
import { createProjectionWalls } from "./scene/ProjectionWalls";
import { loadAISVessels } from "./data/loaders/aisLoader";
import { createBoatLayer } from "./scene/BoatLayer";
import { loadWikimediaPhotos } from "./data/loaders/wikimediaLoader";
import { createWikimediaLayer } from "./scene/WikimediaLayer";
import { dataUrl } from "./utils";

import "./style.css";

const DEBUG = import.meta.env.DEV;

const ANCHOR            = { lat: 68.69373915809578, lng: 15.402189541432762, zoom: 10 };
const COUNTRY           = "norway"; // country-specific APIs are gated on this value
const ELEV_EXAGGERATION = 1;
const MESH_SCALE        = 0.0008;
const MAX_ERROR         = 5;

// ---------------------------------------------------------------------------
// 1. BabylonJS — canvas, WebGL context, render loop
// ---------------------------------------------------------------------------

const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
const { scene } = createScene(canvas);
(window as any).__scene = scene;


const gui2D = DEBUG ? AdvancedDynamicTexture.CreateFullscreenUI("ui", true, scene) : null;

// ---------------------------------------------------------------------------
// 2. Data pipeline
// ---------------------------------------------------------------------------

const adapter = new MapboxTerrainAdapter(
  (import.meta as { env: Record<string, string> }).env.VITE_MAPBOX_TOKEN,
  { debug: DEBUG, kartverketAdapter: new KartverketElevationAdapter() }
);

const terrainData = await adapter.fetchTerrain(ANCHOR);
const geometry    = buildGeometry(terrainData, { maxError: MAX_ERROR, elevExaggeration: ELEV_EXAGGERATION });

// ---------------------------------------------------------------------------
// 3. Terrain
// ---------------------------------------------------------------------------

const terrainMesh = new TerrainMesh(scene);
const groundMesh  = terrainMesh.createMesh(geometry, { meshScale: MESH_SCALE });

groundMesh.computeWorldMatrix(true);
const { minimumWorld, maximumWorld } = groundMesh.getBoundingInfo().boundingBox;

createTable(scene, minimumWorld, maximumWorld);
createRoom(scene, minimumWorld, maximumWorld);

// ---------------------------------------------------------------------------
// 4. Debug helpers
// ---------------------------------------------------------------------------

if (DEBUG && gui2D) {
  createDebugOverlay(gui2D, groundMesh, scene);
}

// ---------------------------------------------------------------------------
// 5. WebXR
// ---------------------------------------------------------------------------

const xrHelper = await initXR(scene, [groundMesh]);
if (xrHelper) {
  xrHelper.baseExperience.onStateChangedObservable.add((state) => {
    if (state === WebXRState.IN_XR) {
      xrHelper.baseExperience.camera.position.y = 1;
    }
  });
}

// ---------------------------------------------------------------------------
// 6. OSM Buildings
// ---------------------------------------------------------------------------

let _toastCount = 0;
const showApiToast = (msg: string) => {
  const el = document.createElement("div");
  el.className = "api-toast";
  el.textContent = `⚠ ${msg}`;
  el.style.bottom = `${24 + _toastCount * 56}px`;
  _toastCount++;
  document.body.appendChild(el);
  setTimeout(() => { el.remove(); _toastCount = Math.max(0, _toastCount - 1); }, 8000);
};

const { x: btx, y: bty, z: btz } = lngLatToTile(ANCHOR.lng, ANCHOR.lat, ANCHOR.zoom);
const [buildingRes, placeRes, roadRes] = await Promise.allSettled([
  loadOSMBuildings(btx, bty, btz),
  loadOSMPlaces(btx, bty, btz),
  loadOSMRoads(btx, bty, btz),
]);

const buildings = buildingRes.status === "fulfilled" ? buildingRes.value : (showApiToast("API for Buildings (OSM) is unreachable — try again later"), []);
const places    = placeRes.status    === "fulfilled" ? placeRes.value    : (showApiToast("API for Places (OSM) is unreachable — try again later"),    []);
const roads     = roadRes.status     === "fulfilled" ? roadRes.value     : (showApiToast("API for Roads (OSM) is unreachable — try again later"),     []);
const tileBounds = tileBoundsLngLat(btx, bty, btz);
const getTerrainY = (lat: number, lng: number): number => {
  const u   = (lng - tileBounds.west)  / (tileBounds.east  - tileBounds.west);
  const v   = (tileBounds.north - lat) / (tileBounds.north - tileBounds.south);
  const col = Math.min(256, Math.max(0, Math.round(u * 256)));
  const row = Math.min(256, Math.max(0, Math.round(v * 256)));
  return terrainData.elevation[row * 257 + col] * MESH_SCALE;
};
const buildingMeshes = createBuildingLayer(buildings, terrainMesh, scene, MESH_SCALE, getTerrainY);
const roadMeshes     = createRoadLayer(roads, terrainMesh, scene, MESH_SCALE, getTerrainY);
const labelMeshes    = createPlaceLabels(places, terrainMesh, scene, getTerrainY);

// ---------------------------------------------------------------------------
// 7. GeoJSON data layers — one toggle button per .geojson file in public/data/
// ---------------------------------------------------------------------------

const projWalls = createProjectionWalls(scene, { min: minimumWorld, max: maximumWorld });
const pinState: PinState = { clearSelection: () => {} };

type ToggleLayer = { label: string; meshes: import("@babylonjs/core/Meshes/mesh").Mesh[] };
const toggleLayers: ToggleLayer[] = [
  { label: "Buildings", meshes: buildingMeshes },
  { label: "Roads",     meshes: roadMeshes     },
  { label: "Labels",    meshes: labelMeshes    },
];

// ---------------------------------------------------------------------------
// 8. Wikimedia Commons — geotagged photos (global, no country gate)
// ---------------------------------------------------------------------------

let wikimediaMeshes: import("@babylonjs/core/Meshes/mesh").Mesh[] = [];
try {
  const photos = await loadWikimediaPhotos(tileBounds);
  wikimediaMeshes = await createWikimediaLayer(photos, terrainMesh, scene, getTerrainY, projWalls, pinState);
} catch (e) {
  showApiToast("Wikimedia Commons photos are unreachable — try again later");
  console.warn("[Wikimedia] Failed:", e);
}
if (wikimediaMeshes.length > 0) toggleLayers.push({ label: "Photos", meshes: wikimediaMeshes });

// ---------------------------------------------------------------------------
// 9. Country-specific API layers
//    Each block is gated on COUNTRY. Add new countries here following the
//    same pattern. Boats LIVE is placed before GeoJSON so it sits second to
//    last in the toggle row; GeoJSON layers occupy the final slot(s).
// ---------------------------------------------------------------------------

if (COUNTRY === "norway") {
  // BarentsWatch AIS — live vessel positions (Norway only)
  let boatMeshes: import("@babylonjs/core/Meshes/mesh").Mesh[] = [];
  try {
    const aisVessels = await loadAISVessels(tileBounds);
    boatMeshes = await createBoatLayer(aisVessels, terrainMesh, scene, getTerrainY, tileBounds, projWalls, pinState);
  } catch (e) {
    showApiToast("Live vessel data (BarentsWatch AIS) is unreachable — try again later");
    console.warn("[AIS] Failed:", e);
  }
  toggleLayers.push({ label: "Boats LIVE", meshes: boatMeshes });
}

for (const filename of geojsonFiles) {
  try {
    const data = await loadGeoJSONFeatures(dataUrl(filename));
    const pointMeshes   = await createGeoJSONPointLayer(data.points,   terrainMesh, scene, getTerrainY, projWalls, pinState);
    const polygonMeshes = createGeoJSONPolygonLayer(data.polygons, terrainMesh, scene, MESH_SCALE, getTerrainY);
    const lineMeshes    = createGeoJSONLineLayer(data.lines,    terrainMesh, scene, MESH_SCALE, getTerrainY);
    const allMeshes     = [...pointMeshes, ...polygonMeshes, ...lineMeshes];
    // Use the GeoJSON collection's "name" property; fall back to the filename without extension
    const fallback = filename.replace(/\.geojson$/i, "");
    const displayLabel = data.name ?? (fallback.charAt(0).toUpperCase() + fallback.slice(1));
    if (allMeshes.length > 0) toggleLayers.push({ label: displayLabel, meshes: allMeshes });
    console.log(`[GeoJSON] "${filename}" (${displayLabel}) → ${allMeshes.length} meshes`);
  } catch (e) {
    console.warn(`[GeoJSON] Failed to load "${filename}":`, e);
  }
}

createToggleButtons(scene, { min: minimumWorld, max: maximumWorld }, toggleLayers);
