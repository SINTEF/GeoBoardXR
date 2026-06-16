import type { Scene } from "@babylonjs/core/scene";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3 } from "@babylonjs/core/Maths/math.color";

interface XYZ { x: number; y: number; z: number }

// Swap /concrete.jpg for any other texture in public/ to change the floor look.
const FLOOR_TEXTURE = `${import.meta.env.BASE_URL}floor.jpg`;

export function createRoom(scene: Scene, terrainMin: XYZ, terrainMax: XYZ): void {
  const overhang  = 0.14;
  const tw        = terrainMax.x - terrainMin.x;
  const td        = terrainMax.z - terrainMin.z;
  const tableMax  = Math.max(tw * (1 + 2 * overhang), td * (1 + 2 * overhang));
  const topThick  = tableMax * 0.018;
  const legH      = tableMax * 0.25;
  const surfaceY  = terrainMin.y - 0.002;
  const floorY    = surfaceY - topThick - legH - 0.02;

  const floorSize = tableMax * 5;

  const mat = new StandardMaterial("room-floor-mat", scene);
  const tex = new Texture(FLOOR_TEXTURE, scene);
  tex.uScale = 24;
  tex.vScale = 24;
  mat.diffuseTexture  = tex;
  mat.specularColor   = new Color3(0.04, 0.04, 0.04);
  mat.emissiveColor   = new Color3(0.03, 0.03, 0.03);

  const floor = CreateGround("room-floor", { width: floorSize, height: floorSize }, scene);
  floor.position.y = floorY;
  floor.material   = mat;
}
