import type { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { ActionManager } from "@babylonjs/core/Actions/actionManager";
import { ExecuteCodeAction } from "@babylonjs/core/Actions/directActions";
import { ImportMeshAsync } from "@babylonjs/core/Loading/sceneLoader";
import type { TerrainMesh } from "./TerrainMesh";
import type { PointFeature, GeoJSONPointProps } from "../data/loaders/geojsonLoader";
import { createBillboardLabel } from "./billboardUtils";
import type { ProjectionWalls } from "./ProjectionWalls";
import { dataUrl } from "../utils";

const PIN_HEIGHT = 0.15;
const HEAD_NORMAL = PIN_HEIGHT * 0.25;  // bubblehead diameter for plain points
const HEAD_INFO   = PIN_HEIGHT * 0.52;  // larger bubblehead when information exists

function hexToColor3(hex: string): Color3 {
  const h = hex.replace("#", "");
  return new Color3(
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  );
}

function pinMaterial(color: Color3, scene: Scene): StandardMaterial {
  const mat = new StandardMaterial(`geojson-pin-mat-${color.toHexString()}`, scene);
  mat.diffuseColor  = color;
  mat.emissiveColor = color;
  mat.disableLighting = true;
  return mat;
}

/** Shared across all GeoJSON files — ensures only one pin is selected at a time. */
export interface PinState {
  /** Call this before selecting a new pin to deselect the previous one. */
  clearSelection: () => void;
}

export async function createGeoJSONPointLayer(
  features: PointFeature<GeoJSONPointProps>[],
  terrainMesh: TerrainMesh,
  scene: Scene,
  getTerrainY: (lat: number, lng: number) => number,
  projWalls: ProjectionWalls,
  pinState: PinState,
): Promise<Mesh[]> {
  const { minimumWorld, maximumWorld } = terrainMesh.groundMesh.getBoundingInfo().boundingBox;
  const meshes: Mesh[] = [];
  let selectedIdx: number | null = null;
  let restoreCurrentPin: (() => void) | null = null;
  const SEL_COLOR = new Color3(0.82, 0.82, 0.82);

  for (let idx = 0; idx < features.length; idx++) {
    const { position, properties: p } = features[idx];
    const base = terrainMesh.latLngToScaledWorld({ lat: position.lat, lng: position.lng, altitude: 0 });

    if (base.x < minimumWorld.x || base.x > maximumWorld.x ||
        base.z < minimumWorld.z || base.z > maximumWorld.z) continue;

    const hasInfo = !!p.information;
    // Infopoints default to green (#23d110); plain points default to yellow
    const color = p.color ? hexToColor3(p.color) : (hasInfo ? hexToColor3("#23d110") : new Color3(1, 0.9, 0));
    // image/video are only valid when information is also present — per spec
    // Resolve relative paths to public/data/ — absolute URLs are used as-is
    const rawImage = hasInfo ? p.image : undefined;
    const imageUrl = rawImage
      ? (/^https?:\/\/|^\//.test(rawImage) ? rawImage : dataUrl(rawImage))
      : undefined;
    const rawVideo = hasInfo ? p.video : undefined;
    const videoUrl = rawVideo
      ? (/^https?:\/\/|^\//.test(rawVideo) ? rawVideo : dataUrl(rawVideo))
      : undefined;
    const headDiam = hasInfo ? HEAD_INFO : HEAD_NORMAL;
    const terrainY = getTerrainY(position.lat, position.lng);

    const mat = pinMaterial(color, scene);

    let headMesh: Mesh;
    let glbMeshes: Mesh[] = [];

    if (p["3dmodel"]) {
      // ---- GLB model replaces the default stick+bubble ----
      try {
        const result = await ImportMeshAsync(dataUrl(p["3dmodel"]), scene);
        const allMeshes = result.meshes;
        if (allMeshes.length > 0) {
          // Compute world-space bounding box (GLB root starts at origin)
          allMeshes.forEach(m => m.computeWorldMatrix(true));
          let minX = Infinity, maxX = -Infinity;
          let minY = Infinity, maxY = -Infinity;
          let minZ = Infinity, maxZ = -Infinity;
          for (const m of allMeshes) {
            const b = m.getBoundingInfo().boundingBox;
            minX = Math.min(minX, b.minimumWorld.x); maxX = Math.max(maxX, b.maximumWorld.x);
            minY = Math.min(minY, b.minimumWorld.y); maxY = Math.max(maxY, b.maximumWorld.y);
            minZ = Math.min(minZ, b.minimumWorld.z); maxZ = Math.max(maxZ, b.maximumWorld.z);
          }
          const modelH = maxY - minY || 1;
          const totalPinH = PIN_HEIGHT + headDiam;
          const scale = (totalPinH / modelH) * (p.modelscale ?? 1);
          const cx = (minX + maxX) / 2;
          const cz = (minZ + maxZ) / 2;

          // Move root: bottom sits at terrainY, centred on the pin's lat/lng
          const root = allMeshes[0];
          root.scaling.scaleInPlace(scale);
          root.position.set(
            base.x - cx * scale,
            terrainY - minY * scale,
            base.z - cz * scale,
          );
          glbMeshes = allMeshes.filter((m): m is Mesh => m instanceof Mesh);
          glbMeshes.forEach(m => { m.renderingGroupId = 1; });
          meshes.push(...glbMeshes);
        }
      } catch (e) {
        console.warn(`[GeoJSON] Failed to load 3dmodel: ${p["3dmodel"]}`, e);
      }
      // Invisible hit-target sphere — fallback if GLB has no pickable geometry
      headMesh = CreateSphere(`gj-hittest-${idx}`, { diameter: headDiam, segments: 4 }, scene);
      headMesh.position.set(base.x, terrainY + PIN_HEIGHT, base.z);
      headMesh.isVisible = false;
      meshes.push(headMesh);
    } else {
      // ---- Default: thin stick + sphere bubblehead ----
      const stick = CreateCylinder(`gj-stick-${idx}`, {
        height: PIN_HEIGHT, diameter: PIN_HEIGHT * 0.06, tessellation: 6,
      }, scene);
      stick.position.set(base.x, terrainY + PIN_HEIGHT / 2, base.z);
      stick.material = mat;
      stick.renderingGroupId = 2;
      meshes.push(stick);

      headMesh = CreateSphere(`gj-head-${idx}`, { diameter: headDiam, segments: 6 }, scene);
      headMesh.position.set(base.x, terrainY + PIN_HEIGHT + headDiam / 2, base.z);
      headMesh.material = mat;
      headMesh.renderingGroupId = 2;
      meshes.push(headMesh);
    }

    // ---- Spinning billboard label (always faces camera) ----
    if (p.title) {
      const lH = PIN_HEIGHT * 0.44;
      const lW = lH * 5;
      const { plane: lp, textBlock: tb } = createBillboardLabel(`gj-lbl-${idx}`, lW, lH, 512, 100, scene);
      lp.position.set(base.x, terrainY + PIN_HEIGHT + headDiam + lH * 0.6, base.z);
      tb.text = p.title;
      tb.color = `rgb(${Math.round(color.r * 255)},${Math.round(color.g * 255)},${Math.round(color.b * 255)})`;
      tb.fontSize = 48;
      meshes.push(lp);
    }

    // ---- Interaction: click toggles info on projection walls ----
    if (hasInfo) {
      const onPick = () => {
        if (selectedIdx === idx) {
          if (restoreCurrentPin) { restoreCurrentPin(); restoreCurrentPin = null; }
          selectedIdx = null;
          pinState.clearSelection = () => {};
          projWalls.hide();
        } else {
          pinState.clearSelection();
          if (restoreCurrentPin) { restoreCurrentPin(); }

          selectedIdx = idx;
          restoreCurrentPin = () => {
            mat.diffuseColor  = color;
            mat.emissiveColor = color;
          };
          mat.diffuseColor  = SEL_COLOR;
          mat.emissiveColor = SEL_COLOR;

          pinState.clearSelection = () => {
            if (restoreCurrentPin) { restoreCurrentPin(); restoreCurrentPin = null; }
            selectedIdx = null;
          };

          if (videoUrl) {
            projWalls.showWithVideo(p.title ?? "", p.information!, videoUrl);
          } else if (imageUrl) {
            projWalls.showWithImage(p.title ?? "", p.information!, imageUrl);
          } else {
            projWalls.show(p.title ?? "", p.information!);
          }
        }
      };

      // Register on the invisible sphere (fallback) + all GLB meshes so clicking
      // anywhere on the model triggers the info panel regardless of scale
      const clickTargets = glbMeshes.length > 0 ? glbMeshes : [headMesh];
      clickTargets.push(headMesh);
      for (const m of clickTargets) {
        m.actionManager = new ActionManager(scene);
        m.actionManager.registerAction(new ExecuteCodeAction(ActionManager.OnPickTrigger, onPick));
      }
    }
  }

  console.log(`[GeoJSON Points] ${meshes.length > 0 ? features.length : 0} features processed`);
  return meshes;
}
