import type { Scene } from "@babylonjs/core/scene";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";

interface XYZ { x: number; y: number; z: number }

function woodMat(name: string, r: number, g: number, b: number, scene: Scene): StandardMaterial {
  const mat = new StandardMaterial(name, scene);
  mat.diffuseColor  = new Color3(r, g, b);
  mat.specularColor = new Color3(0.06, 0.04, 0.02);
  mat.emissiveColor = new Color3(r * 0.06, g * 0.06, b * 0.06);
  return mat;
}

/**
 * Builds a wooden table whose top surface sits just below the terrain mesh.
 * Call after groundMesh.computeWorldMatrix(true) so world bounds are valid.
 */
export function createTable(
  scene: Scene,
  terrainMin: XYZ,
  terrainMax: XYZ,
): void {
  const overhang   = 0.14;                      // fraction of terrain size added as overhang
  const tw         = terrainMax.x - terrainMin.x;
  const td         = terrainMax.z - terrainMin.z;
  const width      = tw * (1 + 2 * overhang);
  const depth      = td * (1 + 2 * overhang);
  const surfaceY   = terrainMin.y - 0.002;       // top of tabletop, just below terrain base

  const topThick   = Math.max(width, depth) * 0.018;
  const legH       = Math.max(width, depth) * 0.25;
  const legW       = Math.max(width, depth) * 0.030;
  const legInset   = legW * 2.2;

  const topMat = woodMat("tbl-top-mat", 1, 1, 1, scene);
  const woodTex = new Texture(`${import.meta.env.BASE_URL}wood.jpg`, scene);
  woodTex.uScale = 6;
  woodTex.vScale = 6;
  topMat.diffuseTexture = woodTex;
  const legMat = woodMat("tbl-leg-mat", 0.42, 0.24, 0.09, scene);

  // ── Tabletop ────────────────────────────────────────────────────────────────
  const top = CreateBox("table-top", { width, height: topThick, depth }, scene);
  top.position.set(0, surfaceY - topThick / 2, 0);
  top.material = topMat;

  // ── 4 square legs ────────────────────────────────────────────────────────────
  const legY = surfaceY - topThick - legH / 2;
  const cx   = width / 2 - legInset;
  const cz   = depth / 2 - legInset;

  ([ [-cx, -cz], [cx, -cz], [-cx, cz], [cx, cz] ] as [number, number][]).forEach(([x, z], i) => {
    const leg = CreateBox(`table-leg-${i}`, { width: legW, height: legH, depth: legW }, scene);
    leg.position.set(x, legY, z);
    leg.material = legMat;
  });

  // ── Crossbars — one on each long side, halfway down ─────────────────────────
  const barH   = legW * 0.7;
  const barD   = legW * 0.55;
  const barY   = surfaceY - topThick - legH * 0.72;
  const barLen = width - legInset * 2;

  [-cz, cz].forEach((z, i) => {
    const bar = CreateBox(`table-bar-${i}`, { width: barLen, height: barH, depth: barD }, scene);
    bar.position.set(0, barY, z);
    bar.material = legMat;
  });
}
