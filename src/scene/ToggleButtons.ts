import type { Scene } from "@babylonjs/core/scene";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { PointerEventTypes } from "@babylonjs/core/Events/pointerEvents";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { PlaybackController } from "./PlaybackController";

export interface ToggleLayer {
  label: string;
  meshes: Mesh[];
  playback?: PlaybackController;
}

// ── canvas helpers ────────────────────────────────────────────────────────────

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawButton(
  ctx: CanvasRenderingContext2D,
  texW: number, texH: number,
  on: boolean,
  label: string,
): void {
  ctx.clearRect(0, 0, texW, texH);
  ctx.fillStyle = on ? "#14532d" : "#0f172a";
  roundRect(ctx, 6, 6, texW - 12, texH - 12, 22);
  ctx.fill();
  ctx.strokeStyle = on ? "#22c55e" : "#475569";
  ctx.lineWidth = 8;
  roundRect(ctx, 6, 6, texW - 12, texH - 12, 22);
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.font = `bold ${Math.round(texH * 0.30)}px Arial`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, texW / 2, texH * 0.36);
  ctx.font = `${Math.round(texH * 0.22)}px Arial`;
  ctx.fillStyle = on ? "#86efac" : "#64748b";
  ctx.fillText(on ? "● ON" : "○ OFF", texW / 2, texH * 0.70);
}

function drawCircleBtn(ctx: CanvasRenderingContext2D, sz: number, symbol: string, active: boolean): void {
  ctx.clearRect(0, 0, sz, sz);
  ctx.beginPath();
  ctx.arc(sz / 2, sz / 2, sz / 2 - 4, 0, Math.PI * 2);
  ctx.fillStyle = active ? "#14532d" : "#0f172a";
  ctx.fill();
  ctx.strokeStyle = active ? "#22c55e" : "#475569";
  ctx.lineWidth = 6;
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.font = `bold ${Math.round(sz * 0.45)}px Arial`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(symbol, sz / 2, sz / 2);
}

// ── placement ─────────────────────────────────────────────────────────────────

function buttonPlacement(
  side: number, slotOffset: number, btnCY: number,
  tableS: number, tableN: number, tableW: number, tableE: number,
  midX: number, midZ: number,
): [Vector3, number] {
  switch (side) {
    case 0: return [new Vector3(midX + slotOffset, btnCY, tableS), Math.PI   ]; // south
    case 1: return [new Vector3(midX + slotOffset, btnCY, tableN), 0         ]; // north
    case 2: return [new Vector3(tableW, btnCY, midZ + slotOffset), -Math.PI/2]; // west
    case 3: return [new Vector3(tableE, btnCY, midZ + slotOffset),  Math.PI/2]; // east
    default: return [new Vector3(midX, btnCY, tableS), 0];
  }
}

function pbBtnPlacement(
  side: number, slotOffset: number, lateralExtra: number, y: number,
  tableS: number, tableN: number, tableW: number, tableE: number,
  midX: number, midZ: number,
): [Vector3, number] {
  const off = slotOffset + lateralExtra;
  switch (side) {
    case 0: return [new Vector3(midX + off, y, tableS), Math.PI   ];
    case 1: return [new Vector3(midX + off, y, tableN), 0         ];
    case 2: return [new Vector3(tableW,     y, midZ + off), -Math.PI / 2];
    case 3: return [new Vector3(tableE,     y, midZ + off),  Math.PI / 2];
    default: return [new Vector3(midX + off, y, tableS), Math.PI];
  }
}

// ── public API ────────────────────────────────────────────────────────────────

export function createToggleButtons(
  scene: Scene,
  bounds: { min: Vector3; max: Vector3 },
  layers: ToggleLayer[],
): void {
  if (layers.length === 0) return;

  // Log mesh counts so we can see if layers are empty
  for (const layer of layers) {
    console.log(`[Toggle] layer "${layer.label}": ${layer.meshes.length} meshes`);
    for (const m of layer.meshes) m.setEnabled(false);
  }

  const { min, max } = bounds;
  const midX = (min.x + max.x) / 2;
  const midZ = (min.z + max.z) / 2;
  const surfaceY = min.y - 0.002;

  const tw = max.x - min.x;
  const td = max.z - min.z;
  const overhang = 0.14;
  const tableS = min.z - td * overhang;
  const tableN = max.z + td * overhang;
  const tableW = min.x - tw * overhang;
  const tableE = max.x + tw * overhang;
  const topThick = Math.max(tw * (1 + 2 * overhang), td * (1 + 2 * overhang)) * 0.018;
  const btnCY = surfaceY - topThick / 2 + topThick * 2;

  const dim  = Math.min(tw, td);
  const btnH = dim * 0.044;          // fixed height (= old dim*0.08*0.55)
  const gap  = dim * 0.08 * 0.18;   // gap between buttons
  const texH = 282;                  // fixed texture height; width varies per label

  // Measure each label to get the minimum texture width that fits its text
  const _mc   = document.createElement("canvas");
  const _mctx = _mc.getContext("2d")!;
  const layerSizes = layers.map(layer => {
    _mctx.font = `bold ${Math.round(texH * 0.30)}px Arial`;
    const labelPx = _mctx.measureText(layer.label).width;
    _mctx.font = `${Math.round(texH * 0.22)}px Arial`;
    const subPx = _mctx.measureText("● ON").width;
    const texW  = Math.round(Math.max(labelPx, subPx) + texH * 0.6);
    const btnW  = texW * btnH / texH;
    return { texW, btnW };
  });

  // Compute per-layer centre offsets so the full row is centred on the table edge
  const totalRowW = layerSizes.reduce((s, ls) => s + ls.btnW, 0) + gap * (layers.length - 1);
  let cumX = 0;
  const layerOffsets = layerSizes.map((ls) => {
    const offset = cumX + ls.btnW / 2 - totalRowW / 2;
    cumX += ls.btnW + gap;
    return offset;
  });

  const states = layers.map(() => false);
  // Per-layer: list of { tex, ctx, texW } for all 4 copies of that button
  const layerBtns: Array<Array<{ tex: DynamicTexture; ctx: CanvasRenderingContext2D; texW: number }>> =
    layers.map(() => []);

  // Map from plane mesh name → layer index for O(1) hit detection
  const btnToLayer = new Map<string, number>();

  for (let side = 0; side < 4; side++) {
    for (let li = 0; li < layers.length; li++) {
      const { texW, btnW } = layerSizes[li];
      const [pos, rotY] = buttonPlacement(
        side, layerOffsets[li], btnCY,
        tableS, tableN, tableW, tableE, midX, midZ,
      );

      const tex = new DynamicTexture(`tbtn-tex-${side}-${li}`, { width: texW, height: texH }, scene, false);
      const ctx = tex.getContext() as CanvasRenderingContext2D;
      drawButton(ctx, texW, texH, false, layers[li].label);
      tex.update();
      layerBtns[li].push({ tex, ctx, texW });

      const mat = new StandardMaterial(`tbtn-mat-${side}-${li}`, scene);
      mat.diffuseTexture  = tex;
      mat.emissiveTexture = tex;
      mat.opacityTexture  = tex;
      mat.backFaceCulling = false;
      mat.disableLighting = true;

      const planeName = `tbtn-${side}-${li}`;
      const plane = CreatePlane(planeName, { width: btnW, height: btnH }, scene);
      plane.position.copyFrom(pos);
      plane.rotation.y = rotY;
      plane.material   = mat;

      btnToLayer.set(planeName, li);
    }
  }

  // ── Playback buttons (for layers with a PlaybackController) ─────────────────

  const circTexSz = 128;
  const circD     = btnH * 0.68;
  const circBtnY  = btnCY + btnH * 0.6 + circD * 0.55;
  const spacing   = circD * 0.62; // lateral offset from slot centre to each button

  // Per layer: one entry per side with the play/pause texture (restart never changes)
  const pbBtnData: Array<Array<{ ppTex: DynamicTexture; ppCtx: CanvasRenderingContext2D }> | null> =
    layers.map(() => null);

  const btnToPlayback = new Map<string, { li: number; action: "toggle" | "restart" }>();

  for (let li = 0; li < layers.length; li++) {
    const ctrl = layers[li].playback;
    if (!ctrl) continue;

    const sideEntries: Array<{ ppTex: DynamicTexture; ppCtx: CanvasRenderingContext2D }> = [];

    for (let side = 0; side < 4; side++) {
      const slotOff = layerOffsets[li];

      // ▶/⏸ button (left of pair)
      const ppTex = new DynamicTexture(`pbtn-pp-${side}-${li}`, { width: circTexSz, height: circTexSz }, scene, false);
      const ppCtx = ppTex.getContext() as CanvasRenderingContext2D;
      drawCircleBtn(ppCtx, circTexSz, "▶︎", false);
      ppTex.update();
      const ppMat = new StandardMaterial(`pbtn-pp-mat-${side}-${li}`, scene);
      ppMat.diffuseTexture = ppMat.emissiveTexture = ppMat.opacityTexture = ppTex;
      ppMat.backFaceCulling = false;
      ppMat.disableLighting = true;
      const ppName  = `pbtn-pp-${side}-${li}`;
      const ppPlane = CreatePlane(ppName, { width: circD, height: circD }, scene);
      const [ppPos, ppRotY] = pbBtnPlacement(side, slotOff, -spacing, circBtnY, tableS, tableN, tableW, tableE, midX, midZ);
      ppPlane.position.copyFrom(ppPos);
      ppPlane.rotation.y = ppRotY;
      ppPlane.material   = ppMat;
      ppPlane.setEnabled(false);
      layers[li].meshes.push(ppPlane);
      btnToPlayback.set(ppName, { li, action: "toggle" });
      sideEntries.push({ ppTex, ppCtx });

      // ↺ restart button (right of pair)
      const rTex = new DynamicTexture(`pbtn-r-${side}-${li}`, { width: circTexSz, height: circTexSz }, scene, false);
      const rCtx = rTex.getContext() as CanvasRenderingContext2D;
      drawCircleBtn(rCtx, circTexSz, "↺︎", false);
      rTex.update();
      const rMat = new StandardMaterial(`pbtn-r-mat-${side}-${li}`, scene);
      rMat.diffuseTexture = rMat.emissiveTexture = rMat.opacityTexture = rTex;
      rMat.backFaceCulling = false;
      rMat.disableLighting = true;
      const rName  = `pbtn-r-${side}-${li}`;
      const rPlane = CreatePlane(rName, { width: circD, height: circD }, scene);
      const [rPos, rRotY] = pbBtnPlacement(side, slotOff, +spacing, circBtnY, tableS, tableN, tableW, tableE, midX, midZ);
      rPlane.position.copyFrom(rPos);
      rPlane.rotation.y = rRotY;
      rPlane.material   = rMat;
      rPlane.setEnabled(false);
      layers[li].meshes.push(rPlane);
      btnToPlayback.set(rName, { li, action: "restart" });
    }

    pbBtnData[li] = sideEntries;
  }

  const updatePbBtns = (li: number) => {
    const ctrl = layers[li].playback;
    const data = pbBtnData[li];
    if (!ctrl || !data) return;
    const symbol = ctrl.isPlaying ? "⏸︎" : "▶︎";
    const active = ctrl.isPlaying;
    for (const { ppTex, ppCtx } of data) {
      drawCircleBtn(ppCtx, circTexSz, symbol, active);
      ppTex.update();
    }
  };

  // One pointer handler for all buttons — reliable across desktop + WebXR
  scene.onPointerObservable.add((info) => {
    if (info.type !== PointerEventTypes.POINTERDOWN) return;
    const hit = info.pickInfo?.pickedMesh;
    if (!hit) return;

    // Playback buttons
    const pb = btnToPlayback.get(hit.name);
    if (pb !== undefined) {
      const ctrl = layers[pb.li].playback!;
      if (pb.action === "toggle") ctrl.toggle();
      else ctrl.restart();
      updatePbBtns(pb.li);
      return;
    }

    const li = btnToLayer.get(hit.name);
    if (li === undefined) return;

    states[li] = !states[li];
    const on = states[li];
    for (const m of layers[li].meshes) m.setEnabled(on);

    // Pause playback when the layer is toggled off so audio and animations stop
    const ctrl = layers[li].playback;
    if (!on && ctrl?.isPlaying) {
      ctrl.pause();
      updatePbBtns(li);
    }

    for (const { tex: t, ctx: c, texW: tw } of layerBtns[li]) {
      drawButton(c, tw, texH, on, layers[li].label);
      t.update();
    }
    console.log(`[Toggle] "${layers[li].label}" → ${on ? "ON" : "OFF"}`);
  });

  console.log(`[Toggle] ${layers.length} layers × 4 sides ready`);
}
