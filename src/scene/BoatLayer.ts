import type { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { ActionManager } from "@babylonjs/core/Actions/actionManager";
import { ExecuteCodeAction } from "@babylonjs/core/Actions/directActions";
import type { TerrainMesh } from "./TerrainMesh";
import type { AISVessel, VesselCategory } from "../data/loaders/aisLoader";
import { loadAISVessels, shipTypeToCategory } from "../data/loaders/aisLoader";
import type { ProjectionWalls } from "./ProjectionWalls";
import type { PinState } from "./GeoJSONPointLayer";

const BOAT_BASE_SIZE = 0.10;
const POLL_MS = 60_000;

const CATEGORY_EMISSIVE: Record<VesselCategory, Color3> = {
  cargo:     Color3.FromHexString('#3b82f6'),
  tanker:    Color3.FromHexString('#f97316'),
  passenger: Color3.FromHexString('#10b981'),
  fishing:   Color3.FromHexString('#fbbf24'),
  tug:       Color3.FromHexString('#8b5cf6'),
  highspeed: Color3.FromHexString('#06b6d4'),
  military:  Color3.FromHexString('#ef4444'),
  pleasure:  Color3.FromHexString('#ec4899'),
  other:     Color3.FromHexString('#94a3b8'),
};

const CATEGORY_LABELS: Record<VesselCategory, string> = {
  cargo: 'Cargo', tanker: 'Tanker', passenger: 'Passenger',
  fishing: 'Fishing', tug: 'Tug / Service', highspeed: 'High-speed craft',
  military: 'Military', pleasure: 'Pleasure craft', other: 'Other',
};

const NAV_STATUS: Record<number, string> = {
  0: 'Under way (engine)', 1: 'At anchor', 2: 'Not under command',
  3: 'Restricted manoeuvrability', 4: 'Constrained by draught', 5: 'Moored',
  6: 'Aground', 7: 'Fishing', 8: 'Under way (sailing)', 14: 'AIS-SART active',
  15: 'Undefined',
};

function fmtMsgtime(iso: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  } catch { return iso; }
}

function vesselInfoText(v: AISVessel): string {
  const lines: string[] = [];
  if (v.name)           lines.push(`Name: ${v.name}`);
  lines.push(`MMSI: ${v.mmsi}`);
  lines.push(`Type: ${CATEGORY_LABELS[shipTypeToCategory(v.shipType)]} (${v.shipType})`);
  if (v.speed < 102.3)  lines.push(`Speed: ${v.speed.toFixed(1)} kn`);
  if (v.heading !== 511) lines.push(`Heading: ${v.heading}°`);
  if (v.cog < 360)      lines.push(`Course: ${v.cog.toFixed(1)}°`);
  if (v.rot !== -128 && v.rot !== 0) lines.push(`Rate of turn: ${v.rot > 0 ? '+' : ''}${v.rot}°/min`);
  if (v.navStatus !== 15) lines.push(`Status: ${NAV_STATUS[v.navStatus] ?? String(v.navStatus)}`);
  lines.push(`Position: ${v.lat.toFixed(4)}°N, ${v.lon.toFixed(4)}°E`);
  if (v.msgtime)        lines.push(`Last seen: ${fmtMsgtime(v.msgtime)}`);
  const paired: string[] = [];
  for (let i = 0; i < lines.length; i += 2) {
    paired.push(lines[i + 1] !== undefined ? `${lines[i]} - ${lines[i + 1]}` : lines[i]);
  }
  return paired.join('\n');
}

function buildBoatTemplate(name: string, mat: StandardMaterial, scene: Scene): TransformNode {
  const root = new TransformNode(name, scene);

  const outline: [number, number][] = [
    [ 0.00,  2.0],
    [ 0.45,  0.8],
    [ 0.55,  0.0],
    [ 0.55, -1.4],
    [-0.55, -1.4],
    [-0.55,  0.0],
    [-0.45,  0.8],
  ];
  const N = outline.length;
  const YB = 0.0, YT = 0.28;

  const pos: number[] = [];
  for (const [x, z] of outline) pos.push(x, YB, z);
  for (const [x, z] of outline) pos.push(x, YT, z);

  const idx: number[] = [];
  for (let i = 0; i < N; i++) {
    const j  = (i + 1) % N;
    const b0 = i, b1 = j, t0 = i + N, t1 = j + N;
    idx.push(b0, b1, t0,  b1, t1, t0);
  }
  for (let i = 1; i < N - 1; i++) idx.push(N, N + i, N + i + 1);
  for (let i = 1; i < N - 1; i++) idx.push(0, i + 1, i);

  const normals: number[] = [];
  VertexData.ComputeNormals(pos, idx, normals);

  const vd = new VertexData();
  vd.positions = pos;
  vd.indices   = idx;
  vd.normals   = normals;

  const hull = new Mesh(`${name}-hull`, scene);
  vd.applyToMesh(hull);
  hull.parent = root;
  hull.material = mat;
  hull.renderingGroupId = 1;
  hull.isVisible = false;

  const bridge = CreateBox(`${name}-bridge`, { width: 0.42, height: 0.36, depth: 0.65 }, scene);
  bridge.position.set(0, YT + 0.18, -0.45);
  bridge.parent = root;
  bridge.material = mat;
  bridge.renderingGroupId = 1;
  bridge.isVisible = false;

  return root;
}

const MODEL_LENGTH = 3.4;

function vesselWorldPos(
  vessel: AISVessel,
  terrainMesh: TerrainMesh,
  getTerrainY: (lat: number, lng: number) => number,
) {
  const SEA_OFFSET = 0.003;
  const wp = terrainMesh.latLngToScaledWorld({ lat: vessel.lat, lng: vessel.lon, altitude: 0 });
  wp.y = Math.max(SEA_OFFSET, getTerrainY(vessel.lat, vessel.lon) + SEA_OFFSET);
  return wp;
}

function headingToRotY(heading: number): number {
  return (heading === 511 ? 0 : heading) * (Math.PI / 180);
}

interface VesselState {
  root:   TransformNode;
  sphere: Mesh;
  data:   AISVessel;
}

export async function createBoatLayer(
  vessels: Map<VesselCategory, AISVessel[]>,
  terrainMesh: TerrainMesh,
  scene: Scene,
  getTerrainY: (lat: number, lng: number) => number,
  bounds: { north: number; south: number; east: number; west: number },
  projWalls: ProjectionWalls,
  pinState: PinState,
): Promise<Mesh[]> {
  const allMeshes: Mesh[] = [];
  const { minimumWorld, maximumWorld } = terrainMesh.groundMesh.getBoundingInfo().boundingBox;
  const scale    = BOAT_BASE_SIZE / MODEL_LENGTH;
  const BASE_SCALE = scale;
  const SEL_SCALE  = scale * 1.4;

  const stateByMmsi = new Map<number, VesselState>();
  let selectedMmsi: number | null = null;

  for (const [cat, catVessels] of vessels) {
    if (catVessels.length === 0) continue;

    const mat = new StandardMaterial(`boats-mat-${cat}`, scene);
    mat.diffuseColor  = new Color3(0.12, 0.12, 0.12);
    mat.emissiveColor = CATEGORY_EMISSIVE[cat];
    mat.specularColor = new Color3(0.2, 0.2, 0.2);

    const templateRoot = buildBoatTemplate(`boat-tmpl-${cat}`, mat, scene);

    for (const vessel of catVessels) {
      const wp = vesselWorldPos(vessel, terrainMesh, getTerrainY);
      if (wp.x < minimumWorld.x || wp.x > maximumWorld.x ||
          wp.z < minimumWorld.z || wp.z > maximumWorld.z) continue;

      const instanceRoot = templateRoot.instantiateHierarchy(null) as TransformNode | null;
      if (!instanceRoot) continue;

      instanceRoot.scaling.setAll(BASE_SCALE);
      instanceRoot.position.copyFrom(wp);
      instanceRoot.rotation.y = headingToRotY(vessel.heading);

      // Invisible hit-sphere — large enough to click, never rendered
      const sphere = CreateSphere(`boat-hit-${vessel.mmsi}`, { diameter: BOAT_BASE_SIZE * 2, segments: 4 }, scene);
      sphere.position.copyFrom(wp);
      sphere.visibility = 0; // transparent but still in pick system (isVisible=false would exclude it)
      sphere.renderingGroupId = 1;

      const mmsi = vessel.mmsi;
      sphere.actionManager = new ActionManager(scene);
      sphere.actionManager.registerAction(new ExecuteCodeAction(ActionManager.OnPickTrigger, () => {
        const state = stateByMmsi.get(mmsi);
        if (!state) return;

        if (selectedMmsi === mmsi) {
          // Toggle off
          state.root.scaling.setAll(BASE_SCALE);
          selectedMmsi = null;
          pinState.clearSelection = () => {};
          projWalls.hide();
        } else {
          // Deselect whatever was previously selected (another boat or a GeoJSON pin)
          pinState.clearSelection();

          state.root.scaling.setAll(SEL_SCALE);
          selectedMmsi = mmsi;
          pinState.clearSelection = () => {
            state.root.scaling.setAll(BASE_SCALE);
            selectedMmsi = null;
          };
          projWalls.show(
            state.data.name || `MMSI ${state.data.mmsi}`,
            vesselInfoText(state.data),
          );
        }
      }));

      allMeshes.push(...instanceRoot.getChildMeshes(false) as unknown as Mesh[]);
      allMeshes.push(sphere);
      stateByMmsi.set(mmsi, { root: instanceRoot, sphere, data: vessel });
    }

    console.log(`[Boats] ${cat}: ${catVessels.length} vessels`);
  }

  console.log(`[Boats] total: ${stateByMmsi.size} vessels → ${allMeshes.length} meshes`);

  setInterval(async () => {
    try {
      const fresh = await loadAISVessels(bounds);
      let n = 0;
      for (const catVessels of fresh.values()) {
        for (const v of catVessels) {
          const state = stateByMmsi.get(v.mmsi);
          if (!state) continue;
          const wp = vesselWorldPos(v, terrainMesh, getTerrainY);
          state.root.position.copyFrom(wp);
          state.root.rotation.y = headingToRotY(v.heading);
          state.sphere.position.copyFrom(wp);
          state.data = v;
          n++;
        }
      }
      if (n) console.log(`[Boats] poll: ${n} positions updated`);
    } catch (e) {
      console.warn('[Boats] poll failed:', e);
    }
  }, POLL_MS);

  return allMeshes;
}
