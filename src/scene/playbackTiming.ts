import type { Scene } from "@babylonjs/core/scene";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { PlaybackController } from "./PlaybackController";

/**
 * Registers a per-frame observer that shows/hides `meshes` based on the
 * controller's elapsed time and the feature's startTime/endTime window.
 * Uses `isVisible` (not `setEnabled`) so layer-level toggle is unaffected.
 */
export function registerTimedVisibility(
  meshes: Mesh[],
  startTime: number,
  endTime: number | undefined,
  controller: PlaybackController,
  scene: Scene,
): void {
  let prevElapsed = 0;
  let isShown = false;
  meshes.forEach(m => { m.isVisible = false; });

  const obs = scene.onBeforeRenderObservable.add(() => {
    const elapsed = controller.elapsed;

    if (elapsed < prevElapsed - 0.1) {
      meshes.forEach(m => { m.isVisible = false; });
      isShown = false;
    }
    prevElapsed = elapsed;

    if (!controller.hasStarted) {
      if (isShown) { meshes.forEach(m => { m.isVisible = false; }); isShown = false; }
      return;
    }

    const inWindow = elapsed >= startTime && (endTime === undefined || elapsed < endTime);
    if (inWindow && !isShown) {
      meshes.forEach(m => { m.isVisible = true; });
      isShown = true;
    } else if (!inWindow && isShown) {
      meshes.forEach(m => { m.isVisible = false; });
      isShown = false;
    }
  });

  scene.onDisposeObservable.addOnce(() => scene.onBeforeRenderObservable.remove(obs));
}
