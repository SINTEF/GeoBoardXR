import type { Scene } from "@babylonjs/core/scene";
import type { PointFeature, GeoJSONPointProps } from "../data/loaders/geojsonLoader";
import type { PlaybackController } from "./PlaybackController";
import type { ProjectionWalls } from "./ProjectionWalls";
import { dataUrl } from "../utils";

export function createGeoJSONProjectionLayer(
  features: PointFeature<GeoJSONPointProps>[],
  scene: Scene,
  projWalls: ProjectionWalls,
  controller: PlaybackController,
): void {
  const projFeatures = features.filter(
    f => f.properties.animation === "projection-photo" || f.properties.animation === "projection-video",
  );
  if (projFeatures.length === 0) return;

  for (const { properties: p } of projFeatures) {
    const isVideo   = p.animation === "projection-video";
    const mediaUrl  = isVideo ? dataUrl(p.video ?? "") : dataUrl(p.image ?? "");
    const startTime = p.startTime ?? 0;
    const endTime   = p.endTime;

    if (!p.video && isVideo) continue;
    if (!p.image && !isVideo) continue;

    let shown          = false;
    let prevElapsed    = 0;
    let prevIsPlaying  = false;

    const obs = scene.onBeforeRenderObservable.add(() => {
      const elapsed   = controller.elapsed;
      const isPlaying = controller.isPlaying;

      // Detect restart
      if (elapsed < prevElapsed - 0.1) {
        projWalls.hide();
        shown = false;
      }
      prevElapsed = elapsed;

      // Pause/resume video on controller state transitions
      if (isVideo && shown && isPlaying !== prevIsPlaying) {
        projWalls.setVideoPaused(!isPlaying);
      }
      prevIsPlaying = isPlaying;

      if (!isPlaying) return; // freeze in place when paused

      const inWindow = elapsed >= startTime && (endTime === undefined || elapsed < endTime);

      if (inWindow && !shown) {
        if (isVideo) projWalls.showFullscreenVideo(mediaUrl);
        else         projWalls.showFullscreenImage(mediaUrl);
        shown = true;
      } else if (!inWindow && shown) {
        projWalls.hide();
        shown = false;
      }
    });

    scene.onDisposeObservable.addOnce(() => scene.onBeforeRenderObservable.remove(obs));
  }

  console.log(`[GeoJSON Projection] ${projFeatures.length} projection features wired`);
}
