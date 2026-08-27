import type { Scene } from "@babylonjs/core/scene";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { ActionManager } from "@babylonjs/core/Actions/actionManager";
import { ExecuteCodeAction } from "@babylonjs/core/Actions/directActions";

export interface ProjectionWalls {
  show(title: string, body: string): void;
  showWithImage(title: string, body: string, imageUrl: string): void;
  showWithVideo(title: string, body: string, videoUrl: string): void;
  hide(): void;
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineH: number,
): number {
  let curY = y;
  for (const para of text.split('\n')) {
    const words = para.split(' ');
    let line = '';
    for (const word of words) {
      const test = line + word + ' ';
      if (ctx.measureText(test).width > maxWidth && line !== '') {
        ctx.fillText(line.trim(), x, curY);
        line = word + ' ';
        curY += lineH;
      } else {
        line = test;
      }
    }
    if (line.trim()) ctx.fillText(line.trim(), x, curY);
    curY += lineH * 1.5;
  }
  return curY;
}

function drawWall(ctx: CanvasRenderingContext2D, texW: number, texH: number, title: string, body: string): void {
  ctx.clearRect(0, 0, texW, texH);

  // Background
  ctx.fillStyle = '#1565c0';
  ctx.fillRect(0, 0, texW, texH);

  // Top bar
  ctx.fillStyle = '#0d47a1';
  ctx.fillRect(0, 0, texW, texH * 0.12);

  // "SITE INFORMATION" label in top bar
  ctx.fillStyle = '#bbdefb';
  ctx.font = `bold ${Math.round(texH * 0.040)}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('INFORMATION', texW / 2, texH * 0.06);

  // Title
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${Math.round(texH * 0.062)}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(title, texW / 2, texH * 0.22);

  // Divider
  ctx.strokeStyle = '#0d47a1';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(texW * 0.05, texH * 0.27);
  ctx.lineTo(texW * 0.95, texH * 0.27);
  ctx.stroke();

  // Body text
  ctx.fillStyle = '#cfd8dc';
  ctx.font = `${Math.round(texH * 0.046)}px Arial`;
  ctx.textAlign = 'left';
  wrapText(ctx, body, texW * 0.06, texH * 0.34, texW * 0.88, texH * 0.068);

  // Border
  ctx.strokeStyle = '#0d47a1';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, texW - 6, texH - 6);
}

export function createProjectionWalls(
  scene: Scene,
  bounds: { min: Vector3; max: Vector3 },
): ProjectionWalls {
  const { min, max } = bounds;
  const overhang = 0.14;
  const tw = max.x - min.x;
  const td = max.z - min.z;
  const tableMax  = Math.max(tw * (1 + 2 * overhang), td * (1 + 2 * overhang));
  const topThick  = tableMax * 0.018;
  const surfaceY  = min.y - 0.002;

  const tableS = min.z - td * overhang;
  const tableN = max.z + td * overhang;
  const tableW = min.x - tw * overhang;
  const tableE = max.x + tw * overhang;
  const midX   = (min.x + max.x) / 2;
  const midZ   = (min.z + max.z) / 2;

  const gap   = topThick * 4;
  const wallH = tableMax * 0.28;
  const wallY = surfaceY + wallH * 0.5;

  const texW = 1024;
  const texH = 512;

  type WallData = { tex: DynamicTexture; ctx: CanvasRenderingContext2D; plane: Mesh };
  const wallData: WallData[] = [];

  const configs: { pos: Vector3; rotY: number; w: number }[] = [
    { pos: new Vector3(midX, wallY, tableS - gap), rotY: Math.PI,      w: tw * (1 + 2 * overhang) * 0.82 },
    { pos: new Vector3(midX, wallY, tableN + gap), rotY: 0,            w: tw * (1 + 2 * overhang) * 0.82 },
    { pos: new Vector3(tableW - gap, wallY, midZ), rotY: -Math.PI / 2, w: td * (1 + 2 * overhang) * 0.82 },
    { pos: new Vector3(tableE + gap, wallY, midZ), rotY: Math.PI / 2,  w: td * (1 + 2 * overhang) * 0.82 },
  ];

  for (let i = 0; i < configs.length; i++) {
    const { pos, rotY, w } = configs[i];

    const tex = new DynamicTexture(`projwall-tex-${i}`, { width: texW, height: texH }, scene, false);
    const ctx = tex.getContext() as CanvasRenderingContext2D;

    const mat = new StandardMaterial(`projwall-mat-${i}`, scene);
    mat.diffuseTexture  = tex;
    mat.emissiveTexture = tex;
    mat.backFaceCulling = false;
    mat.disableLighting = true;

    const plane = CreatePlane(`projwall-${i}`, { width: w, height: wallH }, scene);
    plane.position.copyFrom(pos);
    plane.rotation.y = rotY;
    plane.material   = mat;
    plane.setEnabled(false);

    wallData.push({ tex, ctx, plane });
  }

  function drawImageWall(ctx: CanvasRenderingContext2D, img: HTMLImageElement): void {
    ctx.clearRect(0, 0, texW, texH);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, texW, texH);
    const aspect = img.naturalWidth / img.naturalHeight;
    let dw = texW, dh = texW / aspect;
    if (dh > texH) { dh = texH; dw = texH * aspect; }
    ctx.drawImage(img, (texW - dw) / 2, (texH - dh) / 2, dw, dh);
  }

  function drawVideoFrame(ctx: CanvasRenderingContext2D, vid: HTMLVideoElement, paused: boolean): void {
    ctx.clearRect(0, 0, texW, texH);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, texW, texH);
    if (vid.readyState >= 2) {
      const aspect = vid.videoWidth / (vid.videoHeight || 1);
      let dw = texW, dh = texW / aspect;
      if (dh > texH) { dh = texH; dw = texH * aspect; }
      ctx.drawImage(vid, (texW - dw) / 2, (texH - dh) / 2, dw, dh);
    }
    if (paused) {
      ctx.fillStyle = "rgba(0,0,0,0.38)";
      ctx.fillRect(0, 0, texW, texH);
      const cx = texW / 2, cy = texH / 2, r = texH * 0.2;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.88)";
      ctx.fill();
      const tr = r * 0.5;
      ctx.beginPath();
      ctx.moveTo(cx + tr, cy);
      ctx.lineTo(cx - tr * 0.6, cy - tr);
      ctx.lineTo(cx - tr * 0.6, cy + tr);
      ctx.closePath();
      ctx.fillStyle = "#1565c0";
      ctx.fill();
    }
  }

  let activeVideo: HTMLVideoElement | null = null;
  let activeObserver: ReturnType<typeof scene.onBeforeRenderObservable.add> | null = null;

  function cleanupVideo(): void {
    if (activeObserver) { scene.onBeforeRenderObservable.remove(activeObserver); activeObserver = null; }
    if (activeVideo) {
      activeVideo.pause();
      activeVideo.currentTime = 0;
      activeVideo.src = "";
      activeVideo.remove();
      activeVideo = null;
    }
    for (let i = 2; i < 4; i++) {
      if (wallData[i].plane.actionManager) {
        wallData[i].plane.actionManager!.dispose();
        wallData[i].plane.actionManager = null;
      }
    }
  }

  return {
    show(title: string, body: string) {
      cleanupVideo();
      for (const { tex, ctx, plane } of wallData) {
        plane.setEnabled(true);
        drawWall(ctx, texW, texH, title, body);
        tex.update();
      }
    },
    showWithImage(title: string, body: string, imageUrl: string) {
      cleanupVideo();
      for (let i = 0; i < wallData.length; i++) {
        wallData[i].plane.setEnabled(true);
        if (i < 2) {
          drawWall(wallData[i].ctx, texW, texH, title, body);
          wallData[i].tex.update();
        }
      }
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        for (let i = 2; i < wallData.length; i++) {
          drawImageWall(wallData[i].ctx, img);
          wallData[i].tex.update();
        }
      };
      img.src = imageUrl;
    },
    showWithVideo(title: string, body: string, videoUrl: string) {
      cleanupVideo();

      for (let i = 0; i < 2; i++) {
        wallData[i].plane.setEnabled(true);
        drawWall(wallData[i].ctx, texW, texH, title, body);
        wallData[i].tex.update();
      }

      const vid = document.createElement("video");
      vid.src = videoUrl;
      vid.playsInline = true;
      vid.preload = "auto";
      vid.style.display = "none";
      document.body.appendChild(vid);
      activeVideo = vid;

      let playing = false;

      const redrawVideoWalls = () => {
        for (let i = 2; i < 4; i++) {
          drawVideoFrame(wallData[i].ctx, vid, !playing);
          wallData[i].tex.update();
        }
      };

      for (let i = 2; i < 4; i++) {
        wallData[i].plane.setEnabled(true);
        drawVideoFrame(wallData[i].ctx, vid, true);
        wallData[i].tex.update();
      }

      vid.onloadeddata = () => redrawVideoWalls();
      vid.onended = () => { playing = false; vid.currentTime = 0; redrawVideoWalls(); };

      activeObserver = scene.onBeforeRenderObservable.add(() => {
        if (playing) redrawVideoWalls();
      });

      const toggle = () => {
        if (playing) {
          vid.pause();
          playing = false;
        } else {
          vid.play();
          playing = true;
        }
        redrawVideoWalls();
      };

      for (let i = 2; i < 4; i++) {
        const am = new ActionManager(scene);
        am.registerAction(new ExecuteCodeAction(ActionManager.OnPickTrigger, toggle));
        wallData[i].plane.actionManager = am;
      }
    },
    hide() {
      cleanupVideo();
      for (const { plane } of wallData) plane.setEnabled(false);
    },
  };
}
