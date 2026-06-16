import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";

export function createScene(canvas: HTMLCanvasElement): {
  engine: Engine;
  scene: Scene;
} {
  const engine = new Engine(canvas, true, { xrCompatible: true });
  const scene = new Scene(engine);

  // ArcRotateCamera: orbit the terrain on desktop
  const camera = new ArcRotateCamera(
    "camera",
    -Math.PI / 2,
    Math.PI / 3,
    2,
    Vector3.Zero(),
    scene
  );
  camera.attachControl(canvas, true);
  camera.minZ = 0.1;

  const hemi = new HemisphericLight("hemi", new Vector3(0, 1, 0), scene);
  hemi.intensity = 0.4;
  hemi.groundColor = new Color3(0.1, 0.08, 0.06);

  const sun = new DirectionalLight("sun", new Vector3(-1, -2, -1).normalize(), scene);
  sun.intensity = 1.4;
  sun.diffuse  = new Color3(1.0, 0.95, 0.85);
  sun.specular = new Color3(0.3, 0.28, 0.22);

  scene.clearColor = new Color4(0.0, 0.04, 0.08, 1.0);

  // Exponential fog simulates light absorption at depth — objects fade into dark water with distance
  scene.fogMode = Scene.FOGMODE_EXP;
  scene.fogColor = new Color3(0.0, 0.06, 0.12);
  scene.fogDensity = 0.005;

  engine.runRenderLoop(() => scene.render());
  window.addEventListener("resize", () => engine.resize());

  return { engine, scene };
}
