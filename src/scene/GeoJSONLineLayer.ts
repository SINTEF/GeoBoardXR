import type { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { CreateRibbon } from "@babylonjs/core/Meshes/Builders/ribbonBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { TerrainMesh } from "./TerrainMesh";
import type { LineFeature, GeoJSONLineProps } from "../data/loaders/geojsonLoader";
import { createBillboardLabel } from "./billboardUtils";

function hexToColor3(hex: string): Color3 {
  const h = hex.replace("#", "");
  return new Color3(
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  );
}

export function createGeoJSONLineLayer(
  features: LineFeature<GeoJSONLineProps>[],
  terrainMesh: TerrainMesh,
  scene: Scene,
  meshScale: number,
  getTerrainY: (lat: number, lng: number) => number,
): Mesh[] {
  const meshes: Mesh[] = [];
  const { minimumWorld, maximumWorld } = terrainMesh.groundMesh.getBoundingInfo().boundingBox;

  for (let idx = 0; idx < features.length; idx++) {
    const { nodes, properties: p } = features[idx];
    if (nodes.length < 2) continue;

    const mid = nodes[Math.floor(nodes.length / 2)];
    const midWorld = terrainMesh.latLngToScaledWorld({ lat: mid.lat, lng: mid.lng, altitude: 0 });
    if (midWorld.x < minimumWorld.x || midWorld.x > maximumWorld.x ||
        midWorld.z < minimumWorld.z || midWorld.z > maximumWorld.z) continue;

    const color      = p.color ? hexToColor3(p.color) : new Color3(1, 0.1, 0.1); // red default
    const halfW      = ((p.linewidth ?? 3) / 2) * meshScale;
    const wallHeight = (p.lineheight ?? 5) * meshScale;

    // Convert to world positions
    const worldPts = nodes.map(n =>
      terrainMesh.latLngToScaledWorld({ lat: n.lat, lng: n.lng, altitude: 0 })
    );

    const isWall = wallHeight > halfW * 3; // tall enough to look like a vertical wall

    const p1: Vector3[] = [];
    const p2: Vector3[] = [];

    for (let i = 0; i < worldPts.length; i++) {
      const pos  = worldPts[i];
      const terrY = getTerrainY(nodes[i].lat, nodes[i].lng) + 0.001;
      const next = worldPts[Math.min(i + 1, worldPts.length - 1)];
      const prev = worldPts[Math.max(i - 1, 0)];
      let dx = next.x - prev.x, dz = next.z - prev.z;
      const len = Math.sqrt(dx * dx + dz * dz);
      if (len > 0) { dx /= len; dz /= len; }

      if (isWall) {
        // Vertical ribbon: centre bottom → centre top — renders as a tall wall
        p1.push(new Vector3(pos.x, terrY, pos.z));
        p2.push(new Vector3(pos.x, terrY + wallHeight, pos.z));
      } else {
        // Flat ribbon like roads: left edge → right edge at terrain level
        p1.push(new Vector3(pos.x - dz * halfW, terrY, pos.z + dx * halfW));
        p2.push(new Vector3(pos.x + dz * halfW, terrY, pos.z - dx * halfW));
      }
    }

    const ribbon = CreateRibbon(`gj-line-${idx}`, {
      pathArray: [p1, p2], closeArray: false, closePath: false,
    }, scene);

    const mat = new StandardMaterial(`gj-line-mat-${idx}`, scene);
    mat.diffuseColor  = color;
    mat.emissiveColor = color.scale(0.2);
    mat.specularColor = Color3.Black();
    mat.backFaceCulling = false; // visible from both sides (wall + flat)
    ribbon.material         = mat;
    ribbon.renderingGroupId = 1;
    meshes.push(ribbon);

    // ---- Label at midpoint node ----
    if (p.title) {
      const mid = worldPts[Math.floor(worldPts.length / 2)];
      const midNode = nodes[Math.floor(nodes.length / 2)];
      const lH = 0.065, lW = lH * 5;
      // Label bottom sits lH/2 above the wall top → centre is wallHeight + lH above terrain
      const midY = getTerrainY(midNode.lat, midNode.lng) + wallHeight + lH;
      const { plane: lp, textBlock: tb } = createBillboardLabel(`gj-line-lbl-${idx}`, lW, lH, 512, 100, scene);
      lp.position.set(mid.x, midY, mid.z);
      tb.text = p.title;
      tb.color = `rgb(${Math.round(color.r * 255)},${Math.round(color.g * 255)},${Math.round(color.b * 255)})`;
      tb.fontSize = 48;
      meshes.push(lp);
    }
  }

  console.log(`[GeoJSON Lines] ${features.length} features → ${meshes.length} meshes`);
  return meshes;
}
