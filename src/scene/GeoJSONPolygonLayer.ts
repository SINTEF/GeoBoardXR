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

// ── Layer builder ─────────────────────────────────────────────────────────────

export function createGeoJSONPolygonLayer(
  features: PolygonFeature<GeoJSONPolygonProps>[],
  terrainMesh: TerrainMesh,
  scene: Scene,
  meshScale: number,
  getTerrainY: (lat: number, lng: number) => number,
): Mesh[] {
  const meshes: Mesh[] = [];

  for (let idx = 0; idx < features.length; idx++) {
    const { nodes, centroid, properties: p } = features[idx];

    const color   = p.color ? hexToColor3(p.color) : new Color3(0.53, 0.81, 0.98);
    const opacity = p.opacity !== undefined ? p.opacity / 100 : 0.7;

    const cosLat = Math.cos(centroid.lat * Math.PI / 180);
    const shape: Vector2[] = nodes.map(n => new Vector2(
      (n.lng - centroid.lng) * cosLat * 111_320 * meshScale,
      (n.lat - centroid.lat) * 110_540 * meshScale,
    ));

    // CCW winding check
    let area = 0;
    for (let i = 0, j = shape.length - 1; i < shape.length; j = i++) {
      area += shape[j].x * shape[i].y - shape[i].x * shape[j].y;
    }
    if (area < 0) shape.reverse();

    let polyMesh: Mesh;
    try {
      const pmb = new PolygonMeshBuilder(`gj-poly-${idx}`, shape, scene, earcut);
      polyMesh = pmb.build(false, 0);
    } catch {
      continue;
    }

    const maxTerrainY = Math.max(
      ...nodes.map(n => getTerrainY(n.lat, n.lng)),
      getTerrainY(centroid.lat, centroid.lng),
    );
    const centroidWorld = terrainMesh.latLngToScaledWorld({ lat: centroid.lat, lng: centroid.lng, altitude: 0 });
    polyMesh.position.set(centroidWorld.x, maxTerrainY + 0.001, centroidWorld.z);
    polyMesh.renderingGroupId = 1;

    if (p.animation === "fire") {
      // Polygon hidden — fire clusters are the only visual
      polyMesh.isVisible = false;

      // Place one fire cluster at each earcut triangle centroid.
      // This gives discrete fires with breathing space between them.
      const rawVerts = polyMesh.getVerticesData(VertexBuffer.PositionKind)!;
      const rawIdx   = polyMesh.getIndices()!;
      const clusters: Vector3[] = [];
      for (let t = 0; t < rawIdx.length; t += 3) {
        const ai = rawIdx[t] * 3, bi = rawIdx[t + 1] * 3, ci = rawIdx[t + 2] * 3;
        clusters.push(new Vector3(
          polyMesh.position.x + (rawVerts[ai]     + rawVerts[bi]     + rawVerts[ci])     / 3,
          polyMesh.position.y,
          polyMesh.position.z + (rawVerts[ai + 2] + rawVerts[bi + 2] + rawVerts[ci + 2]) / 3,
        ));
      }

      const allPs: ParticleSystem[] = [];

      for (let ci = 0; ci < clusters.length; ci++) {
        const ps = new ParticleSystem(`gj-fire-ps-${idx}-${ci}`, 80, scene);
        ps.particleTexture = getFireParticleTex(scene);
        ps.blendMode       = ParticleSystem.BLENDMODE_ADD;
        ps.emitter         = clusters[ci];

        // Tiny spawn box so each cluster stays a tight pocket of flame
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

      // Sync all cluster systems with the layer toggle
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
      // polyMesh provides the exact polygon shape; hide it and use a subdivided
      // copy for the animation so corners are respected and waves look smooth.
      polyMesh.isVisible = false;

      const rawVerts = polyMesh.getVerticesData(VertexBuffer.PositionKind)!;
      const rawIdx   = polyMesh.getIndices()!;
      const { positions: subPos, indices: subIdx } = subdivide(rawVerts, rawIdx, 3);

      const normals = new Float32Array(subPos.length);
      VertexData.ComputeNormals(subPos, subIdx, normals);

      const waveMesh = new Mesh(`gj-wave-${idx}`, scene);
      waveMesh.position.set(centroidWorld.x, maxTerrainY + 0.003, centroidWorld.z);
      waveMesh.renderingGroupId = 1;

      const vd = new VertexData();
      vd.positions = subPos;
      vd.indices   = subIdx;
      vd.normals   = normals;
      vd.applyToMesh(waveMesh, true);

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
      const amp  = 0.004; // smaller per-crest height so many waves stay tight
      let wt = 0;

      scene.onBeforeRenderObservable.add(() => {
        if (!waveMesh.isEnabled()) return;
        wt += scene.getEngine().getDeltaTime() * 0.001;
        for (let i = 0; i < base.length; i += 3) {
          const x = base[i], z = base[i + 2];
          pos[i]     = x;
          pos[i + 2] = z;
          // High spatial frequencies → many small crests visible across polygon
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
      const mat = new StandardMaterial(`gj-poly-mat-${idx}`, scene);
      mat.backFaceCulling = false;
      mat.alpha           = opacity;
      mat.diffuseColor    = color;
      mat.emissiveColor   = color.scale(0.2);
      mat.specularColor   = Color3.Black();
      polyMesh.material   = mat;
      meshes.push(polyMesh);
    }

    // ---- Centroid label ----
    if (p.title) {
      const lH = 0.075, lW = lH * 5;
      const { plane: lp, textBlock: tb } = createBillboardLabel(`gj-poly-lbl-${idx}`, lW, lH, 512, 100, scene);
      lp.position.set(centroidWorld.x, maxTerrainY + 0.05, centroidWorld.z);
      tb.text = p.title;
      tb.color = "white";
      tb.fontSize = 48;
      meshes.push(lp);
    }
  }

  console.log(`[GeoJSON Polygons] ${meshes.length} meshes created`);
  return meshes;
}
