import type { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { PolygonMeshBuilder } from "@babylonjs/core/Meshes/polygonMesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector2, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import { BoxParticleEmitter } from "@babylonjs/core/Particles/EmitterTypes/boxParticleEmitter";
import earcut from "earcut";
import type { TerrainMesh } from "./TerrainMesh";
import type { PolygonFeature, GeoJSONPolygonProps } from "../data/loaders/geojsonLoader";
import { createBillboardLabel } from "./billboardUtils";

function hexToColor3(hex: string): Color3 {
  const h = hex.replace("#", "");
  return new Color3(
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  );
}

// Orange-tinted glow texture — gives fire particles their warm core colour
let _fireParticleTex: DynamicTexture | null = null;
function getFireParticleTex(scene: Scene): DynamicTexture {
  if (_fireParticleTex) return _fireParticleTex;
  const S = 64;
  const tex = new DynamicTexture("gj-fire-particle-tex", { width: S, height: S }, scene, false);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0,    "rgba(255, 255, 220, 1.0)");
  g.addColorStop(0.30, "rgba(255, 140,  20, 0.85)");
  g.addColorStop(0.65, "rgba(200,  30,   0, 0.40)");
  g.addColorStop(1.0,  "rgba( 80,   0,   0, 0.0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  tex.update();
  tex.hasAlpha = true;
  _fireParticleTex = tex;
  return tex;
}

// ── Mesh subdivision (midpoint insertion) ─────────────────────────────────────

function midpt(a: number, b: number, pos: number[], cache: Map<string, number>): number {
  const key = a < b ? `${a}_${b}` : `${b}_${a}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const mid = pos.length / 3;
  pos.push(
    (pos[a * 3]     + pos[b * 3])     / 2,
    (pos[a * 3 + 1] + pos[b * 3 + 1]) / 2,
    (pos[a * 3 + 2] + pos[b * 3 + 2]) / 2,
  );
  cache.set(key, mid);
  return mid;
}

function subdivide(
  initPos: ArrayLike<number>,
  initIdx: ArrayLike<number>,
  depth: number,
): { positions: Float32Array; indices: number[] } {
  let pos = Array.from(initPos);
  let idx = Array.from(initIdx);
  for (let d = 0; d < depth; d++) {
    const cache = new Map<string, number>();
    const next: number[] = [];
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i], b = idx[i + 1], c = idx[i + 2];
      const ab = midpt(a, b, pos, cache);
      const bc = midpt(b, c, pos, cache);
      const ca = midpt(c, a, pos, cache);
      next.push(a, ab, ca,  ab, b, bc,  ca, bc, c,  ab, bc, ca);
    }
    idx = next;
  }
  return { positions: new Float32Array(pos), indices: idx };
}

// Set to false to restore diffuse+specular lighting on static polygons.
const FLAT_SHADING = true;

// ── Sutherland-Hodgman polygon clip against an axis-aligned rectangle ────────

function clipPolygonToRect(poly: Vector2[], x0: number, x1: number, y0: number, y1: number): Vector2[] {
  function clipEdge(pts: Vector2[], inside: (p: Vector2) => boolean, intersect: (a: Vector2, b: Vector2) => Vector2): Vector2[] {
    if (pts.length === 0) return [];
    const out: Vector2[] = [];
    for (let i = 0; i < pts.length; i++) {
      const cur = pts[i], prv = pts[(i + pts.length - 1) % pts.length];
      const ci = inside(cur), pi = inside(prv);
      if (ci) { if (!pi) out.push(intersect(prv, cur)); out.push(cur); }
      else if (pi) out.push(intersect(prv, cur));
    }
    return out;
  }
  function lerp2(a: Vector2, b: Vector2, t: number) { return new Vector2(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t); }
  let p = poly;
  p = clipEdge(p, v => v.x >= x0, (a, b) => { const d = b.x - a.x; return d === 0 ? new Vector2(x0, a.y) : lerp2(a, b, (x0 - a.x) / d); });
  p = clipEdge(p, v => v.x <= x1, (a, b) => { const d = b.x - a.x; return d === 0 ? new Vector2(x1, a.y) : lerp2(a, b, (x1 - a.x) / d); });
  p = clipEdge(p, v => v.y >= y0, (a, b) => { const d = b.y - a.y; return d === 0 ? new Vector2(a.x, y0) : lerp2(a, b, (y0 - a.y) / d); });
  p = clipEdge(p, v => v.y <= y1, (a, b) => { const d = b.y - a.y; return d === 0 ? new Vector2(a.x, y1) : lerp2(a, b, (y1 - a.y) / d); });
  return p;
}

// ── Layer builder ─────────────────────────────────────────────────────────────

type PolyGroup = {
  positions: number[];
  indices:   number[];
  normals:   number[];
  color:     Color3;
  opacity:   number;
};

export function createGeoJSONPolygonLayer(
  features: PolygonFeature<GeoJSONPolygonProps>[],
  terrainMesh: TerrainMesh,
  scene: Scene,
  meshScale: number,
  getTerrainY: (lat: number, lng: number) => number,
): Mesh[] {
  const meshes: Mesh[] = [];
  const { minimumWorld, maximumWorld } = terrainMesh.groundMesh.getBoundingInfo().boundingBox;
  const minX = minimumWorld.x, maxX = maximumWorld.x;
  const minZ = minimumWorld.z, maxZ = maximumWorld.z;

  // Fewer subdivision levels for large files so the merged vertex count stays manageable.
  // Level 0 = raw earcut only (no subdivision) for very large files like arealtyper.
  const regularSubdivLevels = features.length > 5_000 ? 0 : features.length > 500 ? 2 : 3;

  // Regular (non-animated) polygons are merged per opacity into one mesh each.
  // Vertex colors carry per-polygon colour so a single material suffices.
  // Features are processed in REVERSE index order so that feature 0's triangles
  // end up LAST in the GPU buffer; with LEQUAL depth, the last fragment at a given
  // depth wins — meaning feature 0 always covers any later overlapping polygon.
  const polyGroups = new Map<string, PolyGroup>();

  for (let idx = features.length - 1; idx >= 0; idx--) {
    const { nodes, centroid, properties: p } = features[idx];

    const centroidWorld = terrainMesh.latLngToScaledWorld({ lat: centroid.lat, lng: centroid.lng, altitude: 0 });
    // Reject only if the polygon's full node bounding box is entirely outside the tile.
    const cosLatBbox = Math.cos(centroid.lat * Math.PI / 180);
    let pMinX = Infinity, pMaxX = -Infinity, pMinZ = Infinity, pMaxZ = -Infinity;
    for (const n of nodes) {
      const wx = centroidWorld.x + (n.lng - centroid.lng) * cosLatBbox * 111_320 * meshScale;
      const wz = centroidWorld.z + (n.lat - centroid.lat) * 110_540 * meshScale;
      if (wx < pMinX) pMinX = wx; if (wx > pMaxX) pMaxX = wx;
      if (wz < pMinZ) pMinZ = wz; if (wz > pMaxZ) pMaxZ = wz;
    }
    if (pMaxX < minX || pMinX > maxX || pMaxZ < minZ || pMinZ > maxZ) continue;

    const color   = p.color ? hexToColor3(p.color) : new Color3(0.53, 0.81, 0.98);
    const opacity = p.opacity !== undefined ? p.opacity / 100 : 0.7;

    const cosLat = Math.cos(centroid.lat * Math.PI / 180);
    let shape: Vector2[] = nodes.map(n => new Vector2(
      (n.lng - centroid.lng) * cosLat * 111_320 * meshScale,
      (n.lat - centroid.lat) * 110_540 * meshScale,
    ));

    // Clip shape to tile bounds in local (centroid-relative) space
    shape = clipPolygonToRect(
      shape,
      minX - centroidWorld.x, maxX - centroidWorld.x,
      minZ - centroidWorld.z, maxZ - centroidWorld.z,
    );
    if (shape.length < 3) continue;

    // CCW winding check
    let area = 0;
    for (let i = 0, j = shape.length - 1; i < shape.length; j = i++) {
      area += shape[j].x * shape[i].y - shape[i].x * shape[j].y;
    }
    if (area < 0) shape.reverse();

    // Build earcut polygon — used only to get triangulation topology
    let flatVerts: ArrayLike<number>;
    let flatIdx:   ArrayLike<number>;
    let tmpMesh: Mesh;
    try {
      const pmb = new PolygonMeshBuilder(`gj-poly-tmp-${idx}`, shape, scene, earcut);
      tmpMesh   = pmb.build(false, 0);
      flatVerts = tmpMesh.getVerticesData(VertexBuffer.PositionKind)!;
      flatIdx   = tmpMesh.getIndices()!;
    } catch {
      continue;
    }

    // Subdivide so interior vertices can be draped individually
    const subdivLevels = p.animation === "fire" ? 1 : regularSubdivLevels;
    const { positions: subPos, indices: subIdx } = subdivide(flatVerts, flatIdx, subdivLevels);

    // Drape: recover lat/lng via the inverse of the shape formula (no worldToLatLng roundtrip)
    for (let v = 0; v < subPos.length; v += 3) {
      const vLng = centroid.lng + subPos[v]     / (cosLat * 111_320 * meshScale);
      const vLat = centroid.lat + subPos[v + 2] / (110_540 * meshScale);
      subPos[v + 1] = getTerrainY(vLat, vLng) + 0.001;
    }

    const maxTerrainY = Math.max(...nodes.map(n => getTerrainY(n.lat, n.lng)));

    if (p.animation === "fire") {
      // Reuse tmpMesh as the toggling anchor; apply draped geometry to it
      const polyMesh = tmpMesh;
      const polyNormals = new Float32Array(subPos.length);
      VertexData.ComputeNormals(subPos, subIdx, polyNormals);
      const polyVd = new VertexData();
      polyVd.positions = subPos; polyVd.indices = subIdx; polyVd.normals = polyNormals;
      polyVd.applyToMesh(polyMesh, false);
      polyMesh.isVisible = false;
      polyMesh.position.set(centroidWorld.x, 0, centroidWorld.z);
      polyMesh.renderingGroupId = 1;

      // One fire cluster per triangle centroid
      const clusters: Vector3[] = [];
      for (let t = 0; t < subIdx.length; t += 3) {
        const ai = subIdx[t] * 3, bi = subIdx[t + 1] * 3, ci = subIdx[t + 2] * 3;
        clusters.push(new Vector3(
          centroidWorld.x + (subPos[ai]     + subPos[bi]     + subPos[ci])     / 3,
          (subPos[ai + 1] + subPos[bi + 1] + subPos[ci + 1]) / 3,
          centroidWorld.z + (subPos[ai + 2] + subPos[bi + 2] + subPos[ci + 2]) / 3,
        ));
      }

      const allPs: ParticleSystem[] = [];
      for (let ci = 0; ci < clusters.length; ci++) {
        const ps = new ParticleSystem(`gj-fire-ps-${idx}-${ci}`, 80, scene);
        ps.particleTexture = getFireParticleTex(scene);
        ps.blendMode       = ParticleSystem.BLENDMODE_ADD;
        ps.emitter         = clusters[ci];

        const bpe = new BoxParticleEmitter();
        bpe.minEmitBox = new Vector3(-0.005, 0, -0.005);
        bpe.maxEmitBox = new Vector3( 0.005, 0,  0.005);
        ps.particleEmitterType = bpe;

        ps.direction1 = new Vector3(-0.04, 0.05, -0.04);
        ps.direction2 = new Vector3( 0.04, 0.22,  0.04);

        ps.addColorGradient(0.0, new Color4(1.0, 1.0, 0.6, 0.9));
        ps.addColorGradient(0.2, new Color4(1.0, 0.7, 0.1, 0.85));
        ps.addColorGradient(0.5, new Color4(1.0, 0.3, 0.0, 0.6));
        ps.addColorGradient(0.8, new Color4(0.6, 0.05, 0.0, 0.3));
        ps.addColorGradient(1.0, new Color4(0.2, 0.0,  0.0, 0.0));

        ps.addSizeGradient(0.0, 0.05, 0.10);
        ps.addSizeGradient(0.6, 0.03, 0.07);
        ps.addSizeGradient(1.0, 0.01, 0.02);

        ps.minEmitPower    = 0.01;
        ps.maxEmitPower    = 0.04;
        ps.gravity         = new Vector3(0, 0, 0);
        ps.minLifeTime     = 0.5;
        ps.maxLifeTime     = 1.2;
        ps.emitRate        = 45;
        ps.minAngularSpeed = -2.0;
        ps.maxAngularSpeed =  2.0;

        ps.start();
        allPs.push(ps);
      }

      let psActive = true;
      scene.onBeforeRenderObservable.add(() => {
        const enabled = polyMesh.isEnabled();
        if (enabled !== psActive) {
          if (enabled) allPs.forEach(s => s.start()); else allPs.forEach(s => s.stop());
          psActive = enabled;
        }
      });

      meshes.push(polyMesh);

    } else if (p.animation === "wave") {
      const polyMesh = tmpMesh;
      const polyNormals = new Float32Array(subPos.length);
      VertexData.ComputeNormals(subPos, subIdx, polyNormals);
      const polyVd = new VertexData();
      polyVd.positions = subPos; polyVd.indices = subIdx; polyVd.normals = polyNormals;
      polyVd.applyToMesh(polyMesh, false);
      polyMesh.isVisible = false;
      polyMesh.position.set(centroidWorld.x, 0, centroidWorld.z);
      polyMesh.renderingGroupId = 1;

      const waveNormals = new Float32Array(subPos.length);
      VertexData.ComputeNormals(subPos, subIdx, waveNormals);

      const waveMesh = new Mesh(`gj-wave-${idx}`, scene);
      waveMesh.position.set(centroidWorld.x, 0, centroidWorld.z);
      waveMesh.renderingGroupId = 1;

      const wvd = new VertexData();
      wvd.positions = subPos; wvd.indices = subIdx; wvd.normals = waveNormals;
      wvd.applyToMesh(waveMesh, true);

      const waveMat = new StandardMaterial(`gj-wave-mat-${idx}`, scene);
      waveMat.diffuseColor    = p.color ? color : new Color3(0.04, 0.22, 0.70);
      waveMat.emissiveColor   = new Color3(0.01, 0.06, 0.18);
      waveMat.specularColor   = new Color3(0.6, 0.7, 1.0);
      waveMat.specularPower   = 64;
      waveMat.alpha           = 0.80;
      waveMat.backFaceCulling = false;
      waveMesh.material       = waveMat;

      const base = new Float32Array(subPos);
      const pos  = new Float32Array(base.length);
      const amp  = 0.004;
      let wt = 0;

      scene.onBeforeRenderObservable.add(() => {
        if (!waveMesh.isEnabled()) return;
        wt += scene.getEngine().getDeltaTime() * 0.001;
        for (let i = 0; i < base.length; i += 3) {
          const x = base[i], z = base[i + 2];
          pos[i]     = x;
          pos[i + 2] = z;
          pos[i + 1] = base[i + 1]
            + Math.sin(x * 280 + wt * 3.5) * amp
            + Math.sin(z * 220 - wt * 2.8) * amp * 0.75
            + Math.sin((x * 0.7 + z) * 310 + wt * 4.2) * amp * 0.5;
        }
        waveMesh.updateVerticesData(VertexBuffer.PositionKind, pos, false);
      });

      meshes.push(polyMesh);
      meshes.push(waveMesh);

    } else {
      // Regular polygon — dispose temporary earcut mesh and accumulate into poly group
      tmpMesh.dispose();

      const opKey = `${p.color ?? 'default'}_${Math.round(opacity * 100)}`;
      if (!polyGroups.has(opKey)) {
        polyGroups.set(opKey, { positions: [], indices: [], normals: [], color, opacity });
      }
      const group = polyGroups.get(opKey)!;

      const polyNormals = new Float32Array(subPos.length);
      VertexData.ComputeNormals(subPos, subIdx, polyNormals);

      const localVertexBase = group.positions.length / 3;
      const addedLocal = new Map<number, number>();

      for (let t = 0; t < subIdx.length; t += 3) {
        const ia = subIdx[t], ib = subIdx[t + 1], ic = subIdx[t + 2];

        const addVert = (vi: number): number => {
          if (addedLocal.has(vi)) return addedLocal.get(vi)!;
          const ni = localVertexBase + addedLocal.size;
          addedLocal.set(vi, ni);
          group.positions.push(centroidWorld.x + subPos[vi * 3], subPos[vi * 3 + 1], centroidWorld.z + subPos[vi * 3 + 2]);
          group.normals.push(polyNormals[vi * 3], polyNormals[vi * 3 + 1], polyNormals[vi * 3 + 2]);

          return ni;
        };
        group.indices.push(addVert(ia), addVert(ib), addVert(ic));
      }

    }

    // Centroid label (all animation types)
    if (p.title) {
      const lH = 0.075, lW = lH * 5;
      const { plane: lp, textBlock: tb } = createBillboardLabel(`gj-poly-lbl-${idx}`, lW, lH, 512, 100, scene);
      lp.position.set(centroidWorld.x, maxTerrainY + 0.05, centroidWorld.z);
      tb.text = p.title;
      tb.color = `rgb(${Math.round(color.r * 255)},${Math.round(color.g * 255)},${Math.round(color.b * 255)})`;
      tb.fontSize = 48;
      meshes.push(lp);
    }
  }

  // Build one merged mesh per opacity value (typically just one total).
  // Vertex colours carry per-polygon colour; features were accumulated in reverse index
  // order so feature 0's triangles are last in the buffer and win the LEQUAL depth test
  // over any overlapping later polygon — first in file = always on top.
  for (const [opKey, group] of polyGroups) {
    if (group.indices.length === 0) continue;

    const mergedMesh = new Mesh(`gj-poly-${opKey}`, scene);
    mergedMesh.position.setAll(0);
    mergedMesh.renderingGroupId = 1;

    const vd = new VertexData();
    vd.positions = new Float32Array(group.positions);
    vd.indices   = group.indices;
    vd.normals   = new Float32Array(group.normals);
    vd.applyToMesh(mergedMesh, false);

    const mat = new StandardMaterial(`gj-poly-mat-${opKey}`, scene);
    mat.backFaceCulling = false;
    mat.alpha           = group.opacity;
    mat.diffuseColor    = FLAT_SHADING ? Color3.Black() : group.color;
    mat.emissiveColor   = FLAT_SHADING ? group.color : group.color.scale(0.2);
    mat.specularColor   = Color3.Black();
    mergedMesh.material = mat;

    meshes.push(mergedMesh);
  }

  console.log(`[GeoJSON Polygons] ${meshes.length} meshes (${polyGroups.size} opacity groups merged)`);
  return meshes;
}
