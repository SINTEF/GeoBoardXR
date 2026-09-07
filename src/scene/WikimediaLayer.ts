import type { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { ActionManager } from "@babylonjs/core/Actions/actionManager";
import { ExecuteCodeAction } from "@babylonjs/core/Actions/directActions";
import type { TerrainMesh } from "./TerrainMesh";
import type { WikimediaPhoto } from "../data/loaders/wikimediaLoader";
import type { ProjectionWalls } from "./ProjectionWalls";
import type { PinState } from "./GeoJSONPointLayer";

// Camera model local dimensions — bottom is at y=0, top at CAMERA_HEIGHT
const CAMERA_HEIGHT = 0.80;
const ICON_TARGET_HEIGHT = 0.07; // world units
const TERRAIN_OFFSET     = 0.04;
const HIT_DIAMETER       = 0.20;

function buildCameraTemplate(scene: Scene): TransformNode {
  const root = new TransformNode('wiki-cam-tmpl', scene);

  const bodyMat = new StandardMaterial('wiki-cam-body-mat', scene);
  bodyMat.diffuseColor  = new Color3(0.12, 0.12, 0.12);
  bodyMat.emissiveColor = Color3.FromHexString('#f59e0b'); // amber — visible photo theme
  bodyMat.specularColor = new Color3(0.3, 0.3, 0.3);

  const lensMat = new StandardMaterial('wiki-cam-lens-mat', scene);
  lensMat.diffuseColor  = new Color3(0.08, 0.08, 0.15);
  lensMat.emissiveColor = Color3.FromHexString('#93c5fd'); // light-blue lens
  lensMat.specularColor = new Color3(0.8, 0.8, 0.8);

  // Camera body — bottom sits at y=0
  const body = CreateBox('wiki-cam-body', { width: 1.0, height: 0.55, depth: 0.48 }, scene);
  body.position.set(0, 0.275, 0);
  body.parent   = root;
  body.material = bodyMat;
  body.renderingGroupId = 1;
  body.isVisible = false;

  // Top pentaprism hump
  const hump = CreateBox('wiki-cam-hump', { width: 0.38, height: 0.22, depth: 0.44 }, scene);
  hump.position.set(0.06, 0.66, 0);
  hump.parent   = root;
  hump.material = bodyMat;
  hump.renderingGroupId = 1;
  hump.isVisible = false;

  // Lens barrel (cylinder, protruding from front face)
  const lens = CreateCylinder('wiki-cam-lens', { diameter: 0.34, height: 0.22, tessellation: 16 }, scene);
  lens.rotation.x = Math.PI / 2;
  lens.position.set(0, 0.26, 0.35);
  lens.parent   = root;
  lens.material = lensMat;
  lens.renderingGroupId = 1;
  lens.isVisible = false;

  return root;
}

export async function createWikimediaLayer(
  photos: WikimediaPhoto[],
  terrainMesh: TerrainMesh,
  scene: Scene,
  getTerrainY: (lat: number, lng: number) => number,
  projWalls: ProjectionWalls,
  pinState: PinState,
): Promise<Mesh[]> {
  if (photos.length === 0) return [];

  const { minimumWorld, maximumWorld } = terrainMesh.groundMesh.getBoundingInfo().boundingBox;
  const scale = ICON_TARGET_HEIGHT / CAMERA_HEIGHT;
  const templateRoot = buildCameraTemplate(scene);
  const allMeshes: Mesh[] = [];
  const instanceRoots: TransformNode[] = [];
  let selectedId: number | null = null;

  for (const photo of photos) {
    const base = terrainMesh.latLngToScaledWorld({ lat: photo.lat, lng: photo.lon, altitude: 0 });
    if (base.x < minimumWorld.x || base.x > maximumWorld.x ||
        base.z < minimumWorld.z || base.z > maximumWorld.z) continue;

    // Place icon on actual terrain elevation, not sea level
    const terrainY = getTerrainY(photo.lat, photo.lon) + TERRAIN_OFFSET;

    const instanceRoot = templateRoot.instantiateHierarchy(null) as TransformNode | null;
    if (!instanceRoot) continue;

    instanceRoot.scaling.setAll(scale);
    instanceRoot.position.set(base.x, terrainY, base.z);

    // Transparent hit sphere centred on the icon
    const sphere = CreateSphere(`wiki-hit-${photo.pageId}`, { diameter: HIT_DIAMETER, segments: 4 }, scene);
    sphere.position.set(base.x, terrainY + ICON_TARGET_HEIGHT * 0.5, base.z);
    sphere.visibility = 0;
    sphere.renderingGroupId = 1;

    const id = photo.pageId;
    sphere.actionManager = new ActionManager(scene);
    sphere.actionManager.registerAction(new ExecuteCodeAction(ActionManager.OnPickTrigger, () => {
      if (selectedId === id) {
        selectedId = null;
        pinState.clearSelection = () => {};
        projWalls.hide();
      } else {
        pinState.clearSelection();
        selectedId = id;
        pinState.clearSelection = () => { selectedId = null; };

        const body = [
          photo.artist      ? `By: ${photo.artist}`  : '',
          photo.description ? photo.description       : '',
        ].filter(Boolean).join('\n') || 'No description available.';

        projWalls.showWithImage(photo.title, body, photo.imageUrl);
      }
    }));

    allMeshes.push(...instanceRoot.getChildMeshes(false) as unknown as Mesh[]);
    allMeshes.push(sphere);
    instanceRoots.push(instanceRoot);
  }

  // Rotate every icon to face the active camera on Y axis each frame
  scene.registerBeforeRender(() => {
    const cam = scene.activeCamera;
    if (!cam) return;
    for (const root of instanceRoots) {
      const dx = cam.position.x - root.position.x;
      const dz = cam.position.z - root.position.z;
      root.rotation.y = Math.atan2(dx, dz);
    }
  });

  console.log(`[Wikimedia] ${allMeshes.length > 0 ? photos.length : 0} photo icons placed`);
  return allMeshes;
}
