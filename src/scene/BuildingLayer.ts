import type { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { PolygonMeshBuilder } from "@babylonjs/core/Meshes/polygonMesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector2 } from "@babylonjs/core/Maths/math.vector";
import type { TerrainMesh } from "./TerrainMesh";
import type { OSMBuilding, BuildingType } from "../data/loaders/osmBuildingLoader";
import earcut from "earcut";

const TYPE_COLOR: Record<BuildingType, string> = {
  residential: "#60a5fa",
  commercial:  "#fb923c",
  office:      "#34d399",
  industrial:  "#f87171",
  garage:      "#94a3b8",
  education:   "#fbbf24",
  hospital:    "#f472b6",
  religious:   "#e879f9",
  hotel:       "#2dd4bf",
  stadium:     "#a78bfa",
  other:       "#cbd5e1",
};

function hexToColor3(hex: string): Color3 {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return new Color3(r, g, b);
}

export function createBuildingLayer(
  buildings: OSMBuilding[],
  terrainMesh: TerrainMesh,
  scene: Scene,
  meshScale: number,
  getTerrainY: (lat: number, lng: number) => number,
): Mesh[] {
  if (buildings.length === 0) return [];

  const { minimumWorld, maximumWorld } = terrainMesh.groundMesh.getBoundingInfo().boundingBox;

  const mats = new Map<BuildingType, StandardMaterial>();
  for (const [type, hex] of Object.entries(TYPE_COLOR) as [BuildingType, string][]) {
    const m = new StandardMaterial(`bld-mat-${type}`, scene);
    m.diffuseColor  = hexToColor3(hex);
    m.specularColor = new Color3(0.05, 0.05, 0.05);
    mats.set(type, m);
  }

  // Collect raw meshes grouped by type so each group can be merged into one draw call
  const groups = new Map<BuildingType, Mesh[]>();
  let visible = 0;

  for (const building of buildings) {
    const { lat, lng } = building.centroid;
    const pos = terrainMesh.latLngToScaledWorld({ lat, lng, altitude: 0 });

    if (pos.x < minimumWorld.x || pos.x > maximumWorld.x ||
        pos.z < minimumWorld.z || pos.z > maximumWorld.z) continue;

    const h = building.heightMetres * meshScale;
    const cosLat = Math.cos(lat * Math.PI / 180);

    // Local XZ offsets from centroid in scene units (Vector2 for PolygonMeshBuilder)
    const shape: Vector2[] = building.footprintNodes.map(n => new Vector2(
      (n.lng - lng) * cosLat * 111_320 * meshScale,
      (n.lat - lat) * 110_540 * meshScale,
    ));

    // Ensure CCW winding (signed area > 0) — required by PolygonMeshBuilder
    let area = 0;
    for (let i = 0, j = shape.length - 1; i < shape.length; j = i++) {
      area += shape[j].x * shape[i].y - shape[i].x * shape[j].y;
    }
    if (area < 0) shape.reverse();

    try {
      const pmb = new PolygonMeshBuilder(`b-${visible}`, shape, scene, earcut);
      const mesh = pmb.build(false, h);

      // Polygon sits at local Y=0 (top); depth extrudes downward.
      // Place at terrainY + h so the base lands on terrain surface.
      mesh.position.set(pos.x, getTerrainY(lat, lng) + h, pos.z);
      mesh.computeWorldMatrix(true);

      const arr = groups.get(building.buildingType) ?? [];
      arr.push(mesh);
      groups.set(building.buildingType, arr);
      visible++;
    } catch {
      // Skip degenerate polygons earcut can't triangulate
    }
  }

  // Merge each type group into a single mesh — collapses N draw calls into one per type
  const merged: Mesh[] = [];
  for (const [type, group] of groups) {
    const result = group.length === 1
      ? group[0]
      : (Mesh.MergeMeshes(group, true, true) ?? group[0]);
    result.name     = `buildings-${type}`;
    result.material = mats.get(type)!;
    merged.push(result);
  }

  console.log(`[Buildings] ${visible} visible → ${merged.length} merged meshes`);
  return merged;
}
