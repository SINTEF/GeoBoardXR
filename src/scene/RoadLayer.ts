import type { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { CreateRibbon } from "@babylonjs/core/Meshes/Builders/ribbonBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { TerrainMesh } from "./TerrainMesh";
import type { OSMRoad, RoadType } from "../data/loaders/osmRoadLoader";

const MATERIAL: Record<RoadType, { r: number; g: number; b: number }> = {
  major:     { r: 0.95, g: 0.88, b: 0.55 },
  secondary: { r: 0.85, g: 0.85, b: 0.85 },
  minor:     { r: 0.60, g: 0.60, b: 0.60 },
};

/** Returns groups of consecutive node indices whose world XZ position falls inside the bounding box. */
function splitInsideBox(
  pts: Vector3[],
  minX: number, maxX: number, minZ: number, maxZ: number,
): number[][] {
  const groups: number[][] = [];
  let cur: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const { x, z } = pts[i];
    if (x >= minX && x <= maxX && z >= minZ && z <= maxZ) {
      cur.push(i);
    } else {
      if (cur.length >= 2) groups.push(cur);
      cur = [];
    }
  }
  if (cur.length >= 2) groups.push(cur);
  return groups;
}

function buildRibbonPaths(
  nodes: { lat: number; lng: number }[],
  positions: Vector3[],
  halfW: number,
  getTerrainY: (lat: number, lng: number) => number,
): [Vector3[], Vector3[]] {
  const p1: Vector3[] = [];
  const p2: Vector3[] = [];

  for (let i = 0; i < nodes.length; i++) {
    const pos  = positions[i];
    const y    = getTerrainY(nodes[i].lat, nodes[i].lng) + 0.0005;
    const next = positions[Math.min(i + 1, nodes.length - 1)];
    const prev = positions[Math.max(i - 1, 0)];
    let dx = next.x - prev.x, dz = next.z - prev.z;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len > 0) { dx /= len; dz /= len; }
    p1.push(new Vector3(pos.x - dz * halfW, y, pos.z + dx * halfW));
    p2.push(new Vector3(pos.x + dz * halfW, y, pos.z - dx * halfW));
  }
  return [p1, p2];
}

export function createRoadLayer(
  roads: OSMRoad[],
  terrainMesh: TerrainMesh,
  scene: Scene,
  meshScale: number,
  getTerrainY: (lat: number, lng: number) => number,
): Mesh[] {
  if (roads.length === 0) return [];

  const { minimumWorld, maximumWorld } = terrainMesh.groundMesh.getBoundingInfo().boundingBox;

  const mats: Record<RoadType, StandardMaterial> = {} as any;
  for (const type of ["major", "secondary", "minor"] as RoadType[]) {
    const m = new StandardMaterial(`road-mat-${type}`, scene);
    const c = MATERIAL[type];
    m.diffuseColor  = new Color3(c.r, c.g, c.b);
    m.specularColor = new Color3(0.05, 0.05, 0.05);
    m.emissiveColor = new Color3(c.r * 0.15, c.g * 0.15, c.b * 0.15);
    mats[type] = m;
  }

  // Collect raw ribbons grouped by type — merge first, assign material after,
  // so MergeMeshes never has to reconcile mismatched materials within a group.
  const groups: Record<RoadType, Mesh[]> = { major: [], secondary: [], minor: [] };
  let count = 0;

  for (const road of roads) {
    const worldPts = road.nodes.map(n =>
      terrainMesh.latLngToScaledWorld({ lat: n.lat, lng: n.lng, altitude: 0 })
    );

    const segGroups = splitInsideBox(worldPts, minimumWorld.x, maximumWorld.x, minimumWorld.z, maximumWorld.z);
    const halfW  = (road.widthMetres / 2) * meshScale;

    for (const indices of segGroups) {
      const subNodes = indices.map(i => road.nodes[i]);
      const subPts   = indices.map(i => worldPts[i]);
      const [p1, p2] = buildRibbonPaths(subNodes, subPts, halfW, getTerrainY);
      if (p1.length < 2) continue;

      const ribbon = CreateRibbon(`road-${count}`, { pathArray: [p1, p2], closeArray: false, closePath: false }, scene);
      ribbon.computeWorldMatrix(true);
      groups[road.roadType].push(ribbon);
      count++;
    }
  }

  // Merge each type group into a single mesh — collapses N draw calls into one per type
  const merged: Mesh[] = [];
  for (const type of ["major", "secondary", "minor"] as RoadType[]) {
    const group = groups[type];
    if (group.length === 0) continue;
    const result = group.length === 1
      ? group[0]
      : (Mesh.MergeMeshes(group, true, true) ?? group[0]);
    result.name             = `roads-${type}`;
    result.material         = mats[type];
    result.renderingGroupId = 1;
    merged.push(result);
  }

  console.log(`[Roads] ${count} segments → ${merged.length} merged meshes`);
  return merged;
}
