import type { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { ImportMeshAsync } from "@babylonjs/core/Loading/sceneLoader";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { TerrainMesh } from "./TerrainMesh";
import type { LineFeature, GeoJSONLineProps } from "../data/loaders/geojsonLoader";
import type { PlaybackController } from "./PlaybackController";
import { createBillboardLabel } from "./billboardUtils";
import { dataUrl } from "../utils";

const DEFAULT_MODEL_SIZE = 0.18; // target bounding-box height in scene units
const DEFAULT_SPEED      = 0.1;  // scene units per second

interface PathPoint {
  pos: Vector3;   // world position
  dist: number;   // cumulative arc-length from start
}

function buildPath(
  nodes: { lat: number; lng: number; altitude?: number }[],
  terrainMesh: TerrainMesh,
  meshScale: number,
  getTerrainY: (lat: number, lng: number) => number,
): PathPoint[] {
  const pts: PathPoint[] = [];
  let cum = 0;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const world = terrainMesh.latLngToScaledWorld({ lat: n.lat, lng: n.lng, altitude: 0 });
    const y = n.altitude !== undefined
      ? n.altitude * meshScale          // absolute altitude (e.g. airplane)
      : getTerrainY(n.lat, n.lng);      // draped on terrain (e.g. ship)
    const pos = new Vector3(world.x, y, world.z);
    if (i > 0) cum += Vector3.Distance(pts[i - 1].pos, pos);
    pts.push({ pos, dist: cum });
  }
  return pts;
}

function samplePath(path: PathPoint[], dist: number): { pos: Vector3; fwd: Vector3 } {
  if (path.length === 0) return { pos: Vector3.Zero(), fwd: Vector3.Forward() };
  if (dist <= 0) {
    const fwd = path.length > 1
      ? path[1].pos.subtract(path[0].pos).normalize()
      : Vector3.Forward();
    return { pos: path[0].pos.clone(), fwd };
  }
  const total = path[path.length - 1].dist;
  if (dist >= total) {
    const fwd = path.length > 1
      ? path[path.length - 1].pos.subtract(path[path.length - 2].pos).normalize()
      : Vector3.Forward();
    return { pos: path[path.length - 1].pos.clone(), fwd };
  }
  for (let i = 1; i < path.length; i++) {
    if (path[i].dist >= dist) {
      const seg = path[i].dist - path[i - 1].dist;
      const t   = seg > 0 ? (dist - path[i - 1].dist) / seg : 0;
      const pos = Vector3.Lerp(path[i - 1].pos, path[i].pos, t);
      const fwd = path[i].pos.subtract(path[i - 1].pos).normalize();
      return { pos, fwd };
    }
  }
  return { pos: path[path.length - 1].pos.clone(), fwd: Vector3.Forward() };
}

export async function createGeoJSONMoveLayer(
  features: LineFeature<GeoJSONLineProps>[],
  terrainMesh: TerrainMesh,
  scene: Scene,
  meshScale: number,
  getTerrainY: (lat: number, lng: number) => number,
  controller?: PlaybackController,
): Promise<Mesh[]> {
  const allMeshes: Mesh[] = [];

  for (let idx = 0; idx < features.length; idx++) {
    const { nodes, properties: p } = features[idx];
    if (p.animation !== "move") continue;
    if (!p["3dmodel"] || nodes.length < 2) continue;

    const path  = buildPath(nodes, terrainMesh, meshScale, getTerrainY);
    const total = path[path.length - 1].dist;
    const speed = p.speed ?? DEFAULT_SPEED;

    let result;
    try {
      result = await ImportMeshAsync(dataUrl(p["3dmodel"]), scene);
    } catch (e) {
      console.warn(`[GeoJSON Move] Failed to load model "${p["3dmodel"]}":`, e);
      continue;
    }

    const loaded = result.meshes;
    if (loaded.length === 0) continue;

    // Auto-fit scale
    loaded.forEach(m => m.computeWorldMatrix(true));
    let minY = Infinity, maxY = -Infinity;
    for (const m of loaded) {
      const b = m.getBoundingInfo().boundingBox;
      minY = Math.min(minY, b.minimumWorld.y);
      maxY = Math.max(maxY, b.maximumWorld.y);
    }
    const modelH = maxY - minY || 1;
    const scale  = (DEFAULT_MODEL_SIZE / modelH) * (p.modelscale ?? 1);

    const root = loaded[0];
    root.scaling.scaleInPlace(scale);
    root.rotationQuaternion = null; // must clear before setting rotation.y
    loaded.forEach(m => { (m as Mesh).renderingGroupId = 1; });

    const glbMeshes = loaded.filter((m): m is Mesh => m instanceof Mesh);
    allMeshes.push(...glbMeshes);

    // Optional label that tracks the model
    const modelHScaled = DEFAULT_MODEL_SIZE * (p.modelscale ?? 1);
    const lH = 0.065, lW = lH * 5;
    let labelMesh: Mesh | null = null;
    if (p.title) {
      const color = p.color ? new Color3(parseInt(p.color.slice(1,3),16)/255, parseInt(p.color.slice(3,5),16)/255, parseInt(p.color.slice(5,7),16)/255) : Color3.White();
      const { plane: lp, textBlock: tb } = createBillboardLabel(`gj-move-lbl-${idx}`, lW, lH, 512, 100, scene);
      tb.text = p.title;
      tb.color = `rgb(${Math.round(color.r * 255)},${Math.round(color.g * 255)},${Math.round(color.b * 255)})`;
      tb.fontSize = 48;
      lp.isVisible = false;
      allMeshes.push(lp);
      labelMesh = lp;
    }

    // Position at path start, hidden until startTime
    const startTime = p.startTime ?? 0;
    const endTime   = p.endTime   ?? Infinity;
    loaded.forEach(m => { m.isVisible = false; });

    const rotateOffset = (p.modelrotate ?? 0) * (Math.PI / 180);

    const { pos: startPos, fwd: startFwd } = samplePath(path, 0);
    root.position.copyFrom(startPos);
    root.rotation.y = -Math.atan2(startFwd.x, startFwd.z) + rotateOffset;

    // Without a controller the model autoplays; with a controller it waits for Play.
    const t0 = performance.now() / 1000;

    const obs = scene.onBeforeRenderObservable.add(() => {
      if (controller) {
        if (!controller.hasStarted) {
          loaded.forEach(m => { m.isVisible = false; });
          return;
        }
        if (!controller.isPlaying) return; // paused: keep current position + visibility
      }

      const elapsed = controller ? controller.elapsed : (performance.now() / 1000 - t0);
      const active  = elapsed >= startTime && elapsed <= endTime;
      loaded.forEach(m => { m.isVisible = active; });
      if (labelMesh) labelMesh.isVisible = active;
      if (!active) return;

      const travelled = Math.min((elapsed - startTime) * speed, total);
      const { pos, fwd } = samplePath(path, travelled);
      root.position.copyFrom(pos);
      root.rotation.y = -Math.atan2(fwd.x, fwd.z) + rotateOffset;
      if (labelMesh) labelMesh.position.set(pos.x, pos.y + modelHScaled + lH * 0.6, pos.z);
    });

    // Clean up observer when all meshes are disposed
    root.onDisposeObservable.addOnce(() => {
      scene.onBeforeRenderObservable.remove(obs);
    });
  }

  console.log(`[GeoJSON Move] ${features.filter(f => f.properties.animation === "move").length} move features → ${allMeshes.length} meshes`);
  return allMeshes;
}
