import type { Scene } from "@babylonjs/core/scene";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { PointerEventTypes } from "@babylonjs/core/Events/pointerEvents";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";

export interface ToggleLayer {
  label: string;
  meshes: Mesh[];
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

  // One pointer handler for all buttons — reliable across desktop + WebXR
  scene.onPointerObservable.add((info) => {
    if (info.type !== PointerEventTypes.POINTERDOWN) return;
    const hit = info.pickInfo?.pickedMesh;
    if (!hit) return;

    const li = btnToLayer.get(hit.name);
    if (li === undefined) return;

    states[li] = !states[li];
    const on = states[li];
    for (const m of layers[li].meshes) m.setEnabled(on);
    for (const { tex: t, ctx: c, texW: tw } of layerBtns[li]) {
      drawButton(c, tw, texH, on, layers[li].label);
      t.update();
    }
    console.log(`[Toggle] "${layers[li].label}" → ${on ? "ON" : "OFF"}`);
  });

  console.log(`[Toggle] ${layers.length} layers × 4 sides ready`);
}
