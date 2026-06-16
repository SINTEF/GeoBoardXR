import type { Scene } from "@babylonjs/core/scene";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { TerrainMesh } from "./TerrainMesh";
import type { OSMPlace, PlaceType } from "../data/loaders/osmPlaceLoader";

// Settlement types worth labelling at tabletop scale (locality/suburb tags are
// usually sub-areas of a place already shown, so they're left out to avoid clutter).
const VISIBLE: PlaceType[] = ["city", "town", "village", "hamlet"];

const STYLE: Record<string, { width: number; height: number; font: string }> = {
  city:    { width: 0.5,  height: 0.09,  font: "bold 56px Arial" },
  town:    { width: 0.38, height: 0.07,  font: "bold 46px Arial" },
  village: { width: 0.28, height: 0.055, font: "bold 38px Arial" },
  hamlet:  { width: 0.22, height: 0.045, font: "bold 32px Arial" },
};

export function createPlaceLabels(
  places: OSMPlace[],
  terrainMesh: TerrainMesh,
  scene: Scene,
  getTerrainY: (lat: number, lng: number) => number,
): Mesh[] {
  const { minimumWorld, maximumWorld } = terrainMesh.groundMesh.getBoundingInfo().boundingBox;

  const planes: Mesh[] = [];
  let count = 0;

  for (const place of places) {
    if (!VISIBLE.includes(place.type)) continue;

    const pos = terrainMesh.latLngToScaledWorld({ lat: place.lat, lng: place.lng, altitude: 0 });
    if (pos.x < minimumWorld.x || pos.x > maximumWorld.x ||
        pos.z < minimumWorld.z || pos.z > maximumWorld.z) continue;

    const { width, height, font } = STYLE[place.type];

    // Texture sized to the actual text — small names get small (lightweight) textures
    // instead of every label paying for a full 512px canvas regardless of content.
    const probe = new DynamicTexture(`pt-probe-${count}`, { width: 8, height: 8 }, scene, false);
    const probeCtx = probe.getContext() as CanvasRenderingContext2D;
    probeCtx.font = font;
    const textWidth = probeCtx.measureText(place.name).width;
    probe.dispose();

    const texW = Math.min(512, Math.max(128, Math.ceil(textWidth + 32)));
    const texH = Math.round(texW * height / width);

    const tex = new DynamicTexture(`pt-${count}`, { width: texW, height: texH }, scene, false);
    const ctx = tex.getContext() as CanvasRenderingContext2D;

    ctx.clearRect(0, 0, texW, texH);
    ctx.font         = font;
    ctx.textAlign    = "center";
    ctx.textBaseline = "middle";

    ctx.strokeStyle = "black";
    ctx.lineWidth   = 6;
    ctx.strokeText(place.name, texW / 2, texH / 2);

    ctx.fillStyle = "white";
    ctx.fillText(place.name, texW / 2, texH / 2);

    tex.update();

    const mat = new StandardMaterial(`pm-${count}`, scene);
    mat.diffuseTexture  = tex;
    mat.emissiveTexture = tex;
    mat.opacityTexture  = tex;
    mat.backFaceCulling = false;
    mat.disableLighting = true;

    const plane = CreatePlane(`pp-${count}`, { width, height }, scene);
    plane.rotation.x       = Math.PI / 2;
    plane.billboardMode    = Mesh.BILLBOARDMODE_NONE;
    plane.renderingGroupId = 2; // draw after roads (1) and buildings/terrain (0) — labels stay on top
    plane.material         = mat;

    const terrainY = getTerrainY(place.lat, place.lng);
    plane.position = new Vector3(pos.x, terrainY + 0.001, pos.z);
    planes.push(plane);
    count++;
  }

  console.log(`[Places] ${count} labels`);
  return planes;
}
