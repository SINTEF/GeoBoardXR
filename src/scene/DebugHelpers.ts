import type { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { AdvancedDynamicTexture } from "@babylonjs/gui/2D/advancedDynamicTexture";
import { AxesViewer } from "@babylonjs/core/Debug/axesViewer";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { TextBlock } from "@babylonjs/gui/2D/controls/textBlock";
import { Rectangle } from "@babylonjs/gui/2D/controls/rectangle";
import { Control } from "@babylonjs/gui/2D/controls/control";
import type { TerrainMesh } from "./TerrainMesh";
import { createBillboardLabel } from "./billboardUtils";

// One material per unique colour — avoids redundant GPU state changes across multiple pins.
const _pinMatCache = new Map<string, StandardMaterial>();

/**
 * Adds a top-left debug label to an existing fullscreen GUI texture.
 * Updates FPS each frame via scene.onAfterRenderObservable.
 */
export function createDebugOverlay(ui: AdvancedDynamicTexture, terrainMesh: Mesh, scene: Scene): void {
  const triangleCount = terrainMesh.getTotalIndices() / 3;

  const bg = new Rectangle("debug-bg");
  bg.width = "200px";
  bg.height = "52px";
  bg.cornerRadius = 4;
  bg.color = "transparent";
  bg.background = "rgba(0,0,0,0.5)";
  bg.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
  bg.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
  bg.left = "12px";
  bg.top = "12px";
  ui.addControl(bg);

  const triLabel = new TextBlock("debug-tri", `Triangles: ${triangleCount.toLocaleString()}\nSize: `);
  triLabel.color = "white";
  triLabel.fontSize = 13;
  triLabel.fontFamily = "monospace";
  triLabel.top = "-9px";
  bg.addControl(triLabel);

  const fpsLabel = new TextBlock("debug-fps", "FPS: --");
  fpsLabel.color = "white";
  fpsLabel.fontSize = 13;
  fpsLabel.fontFamily = "monospace";
  fpsLabel.top = "9px";
  bg.addControl(fpsLabel);

  scene.onAfterRenderObservable.add(() => {
    fpsLabel.text = `FPS: ${scene.getEngine().getFps().toFixed(0)}`;
  });
}

/**
 * Places a visible pin (stick + sphere) at a geographic coordinate on the terrain mesh.
 * Use this to verify that a known lat/lng lands at the correct spot on the mesh.
 *
 * The pin base sits at the Y returned by latLngToScaledWorld (sea level / ground level);
 * the sphere floats `height` scene-units above it. Scene position is logged to the console.
 */
export function pinLatLng(
  lat: number,
  lng: number,
  terrainMesh: TerrainMesh,
  scene: Scene,
  options: { color?: Color3; label?: string; height?: number } = {}
): void {
  const { color = Color3.Magenta(), label = `${lat.toFixed(4)},${lng.toFixed(4)}`, height = 0.15 } = options;

  const base = terrainMesh.latLngToScaledWorld({ lat, lng, altitude: 0 });
  console.log(`[pinLatLng] "${label}" → scene (${base.x.toFixed(5)}, ${base.y.toFixed(5)}, ${base.z.toFixed(5)})`);

  const matKey = color.toHexString();
  if (!_pinMatCache.has(matKey)) {
    const m = new StandardMaterial(`pin-mat-${matKey}`, scene);
    m.diffuseColor = color;
    m.emissiveColor = color;
    m.disableLighting = true;
    _pinMatCache.set(matKey, m);
  }
  const mat = _pinMatCache.get(matKey)!;

  // Thin stick from base to base + height
  const stick = CreateCylinder(`pin-stick-${label}`, { height, diameter: height * 0.06, tessellation: 6 }, scene);
  stick.position = new Vector3(base.x, base.y + height / 2, base.z);
  stick.material = mat;
  stick.renderingGroupId = 1;

  // Sphere on top
  const sphereTop = base.y + height + height * 0.125;
  const sphere = CreateSphere(`pin-head-${label}`, { diameter: height * 0.25, segments: 4 }, scene);
  sphere.position = new Vector3(base.x, sphereTop, base.z);
  sphere.material = mat;
  sphere.renderingGroupId = 1;

  // Billboard label above the sphere — always faces the camera.
  const labelHeight = height * 0.4;
  const labelWidth = labelHeight * 4;
  const { plane: labelPlane, textBlock: text } = createBillboardLabel(`pin-label-${label}`, labelWidth, labelHeight, 512, 128, scene);
  labelPlane.position = new Vector3(base.x, sphereTop + labelHeight * 0.8, base.z);
  text.text = label;
  text.color = `rgb(${Math.round(color.r * 255)},${Math.round(color.g * 255)},${Math.round(color.b * 255)})`;
  text.fontSize = 52;
}

/**
 * Adds all debug helpers: HUD overlay, world-origin axes, and an XZ grid.
 * Only call this when DEBUG is true — these meshes are never disposed.
 */
export function createSceneDebugHelpers(scene: Scene, ui: AdvancedDynamicTexture, terrainMesh: Mesh): void {
  createDebugOverlay(ui, terrainMesh, scene);

  new AxesViewer(scene, 0.25);
}
