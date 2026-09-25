import type { Scene } from "@babylonjs/core/scene";
import type { PointFeature, GeoJSONPointProps } from "../data/loaders/geojsonLoader";
import type { PlaybackController } from "./PlaybackController";
import { dataUrl } from "../utils";

export function createGeoJSONAudioLayer(
  features: PointFeature<GeoJSONPointProps>[],
  scene: Scene,
  controller?: PlaybackController,
): void {
  const audioFeatures = features.filter(f => f.properties.animation === "justaudio" && f.properties.audio);
  if (audioFeatures.length === 0) return;

  for (const { properties: p } of audioFeatures) {
    const audio = new Audio(dataUrl(p.audio!));
    audio.volume   = Math.max(0, Math.min(1, p.audioVolume ?? 1.0));
    audio.preload  = "auto";

    if (!controller) continue; // justaudio requires playback: true

    const ctrl = controller; // narrowed: guaranteed non-undefined past the guard above
    const startTime  = p.startTime ?? 0;
    const endTime    = p.endTime;
    let audioStarted  = false;
    let audioFinished = false; // true once the element fires "ended" naturally
    let prevElapsed   = 0;

    audio.addEventListener("ended", () => { audioFinished = true; });

    const obs = scene.onBeforeRenderObservable.add(() => {
      const elapsed   = ctrl.elapsed;
      const isPlaying = ctrl.isPlaying;

      // Detect restart: elapsed moved backwards
      if (elapsed < prevElapsed - 0.1) {
        audio.pause();
        audio.currentTime = 0;
        audioStarted  = false;
        audioFinished = false;
      }
      prevElapsed = elapsed;

      if (!isPlaying) {
        if (audioStarted) audio.pause();
        return;
      }

      // Past endTime — stop permanently for this run
      if (endTime !== undefined && elapsed >= endTime) {
        if (audioStarted) { audio.pause(); audioStarted = false; }
        return;
      }

      // Before startTime — not yet
      if (elapsed < startTime) return;

      // Within window and playing
      if (audioFinished) return; // ended naturally — don't replay
      if (!audioStarted) {
        audio.play().catch(() => {});
        audioStarted = true;
      } else if (audio.paused) {
        audio.play().catch(() => {}); // resume after controller unpause
      }
    });

    // Clean up when scene is disposed
    scene.onDisposeObservable.addOnce(() => {
      scene.onBeforeRenderObservable.remove(obs);
      audio.pause();
    });
  }

  console.log(`[GeoJSON Audio] ${audioFeatures.length} justaudio features wired`);
}
