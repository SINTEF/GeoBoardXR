export class PlaybackController {
  private _elapsed = 0;
  private _ref: number | null = null; // null = paused/stopped

  get isPlaying()   { return this._ref !== null; }
  get hasStarted()  { return this._elapsed > 0 || this.isPlaying; }

  get elapsed(): number {
    return this._ref === null
      ? this._elapsed
      : this._elapsed + (performance.now() / 1000 - this._ref);
  }

  play()    { if (!this.isPlaying) this._ref = performance.now() / 1000; }
  pause()   { if (this.isPlaying) { this._elapsed = this.elapsed; this._ref = null; } }
  restart() { this._elapsed = 0; this._ref = performance.now() / 1000; }
  toggle()  { this.isPlaying ? this.pause() : this.play(); }
}
