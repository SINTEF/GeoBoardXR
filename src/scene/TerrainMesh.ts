import type { Scene } from "@babylonjs/core/scene";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Effect } from "@babylonjs/core/Materials/effect";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color"; // used by specularColor
import { latLngToOffset, worldOffsetToLatLng } from "../data/geo";
import type { LatLngAltLike, LatLngZoomLike, TerrainGeometry } from "../data/types";

// ---------------------------------------------------------------------------
// Normal-colour shader: visualises mesh normals as RGB (world-space).
// Normal components are remapped from [-1,1] to [0,1] so:
//   R = right/left (X),  G = up (Y),  B = forward/back (Z).
// ---------------------------------------------------------------------------
Effect.ShadersStore["normalColorVertexShader"] = `
  precision highp float;
  attribute vec3 position;
  attribute vec3 normal;
  uniform mat4 worldViewProjection;
  uniform mat4 world;
  varying vec3 vNormal;
  void main() {
    gl_Position = worldViewProjection * vec4(position, 1.0);
    vNormal = normalize((world * vec4(normal, 0.0)).xyz);
  }
`;
Effect.ShadersStore["normalColorFragmentShader"] = `
  precision highp float;
  varying vec3 vNormal;
  void main() {
    vec3 color = vNormal * 0.5 + 0.5;
    gl_FragColor = vec4(color, 1.0);
  }
`;

// ---------------------------------------------------------------------------

export interface CreateMeshOptions {
  /** Uniform scale applied to the mesh -- use e.g. 0.00005 for table-top size. */
  meshScale?: number;
}

export class TerrainMesh {
  private readonly _scene: Scene;
  private _groundMesh!: Mesh;
  /** Geographic centre of the tile — corresponds to world-space origin (0,0,0). */
  private _meshCenter!: { lat: number; lng: number };
  private _meshScale = 1;

  constructor(scene: Scene) {
    this._scene = scene;
  }

  /**
   * Creates a BabylonJS mesh + satellite texture from pre-computed terrain geometry.
   * The mesh bottom sits at Y=0 because the geometry was normalised in TerrainBuilder.
   */
  createMesh(geometry: TerrainGeometry, options: CreateMeshOptions = {}): Mesh {
    const { meshScale = 1 } = options;

    this._meshCenter = geometry.meshCenter;
    this._meshScale = meshScale;

    const normals = new Float32Array(geometry.positions.length);
    VertexData.ComputeNormals(geometry.positions, geometry.indices, normals);

    const vertexData = new VertexData();
    vertexData.positions = geometry.positions;
    vertexData.indices = geometry.indices;
    vertexData.uvs = geometry.uvs;
    vertexData.normals = normals;

    this._groundMesh = new Mesh("terrain", this._scene);
    vertexData.applyToMesh(this._groundMesh);
    this._groundMesh.scaling = new Vector3(meshScale, meshScale, meshScale);

    // PBRMaterial with metallic=0, roughness=1 gives a fully matte surface —
    // no specular highlight, which is appropriate for satellite imagery of terrain.
    const tex = new Texture(geometry.satelliteUrl, this._scene);
    tex.anisotropicFilteringLevel = 16;

    const mat = new StandardMaterial("terrain-mat", this._scene);
    mat.diffuseTexture = tex;
    mat.specularColor = new Color3(0, 0, 0);
    mat.backFaceCulling = false;
    this._groundMesh.material = mat;

    return this._groundMesh;
  }

  /**
   * The ground plane or terrain mesh.
   * Pass this to WebXRDefaultExperience as a floor mesh.
   */
  get groundMesh(): Mesh {
    return this._groundMesh;
  }

  /** Geographic centre of the tile — world-space origin (0,0,0). */
  get meshCenter(): { lat: number; lng: number } {
    return this._meshCenter;
  }

  /**
   * Converts a geographic coordinate to a BabylonJS world-space Vector3.
   * geo.ts outputs Z-up GIS (x=east, y=north, z=alt); BabylonJS is Y-up (x=east, y=alt, z=north).
   * The origin (0,0,0) is the tile centre (meshCenter), not the user-supplied ANCHOR.
   */
  latLngToWorld(pos: LatLngAltLike | LatLngZoomLike): Vector3 {
    const offset = latLngToOffset(pos, this._meshCenter);
    // Z-up GIS to BabylonJS Y-up: swap y (north) and z (altitude)
    return new Vector3(offset.x, offset.z, offset.y);
  }

  /**
   * Like latLngToWorld() but multiplies by the meshScale set in createMesh().
   * Use this when placing objects that should sit on the terrain surface (e.g. GeoJSON markers).
   * latLngToWorld() returns raw metric offsets; this returns scene-space positions.
   */
  latLngToScaledWorld(pos: LatLngAltLike | LatLngZoomLike): Vector3 {
    return this.latLngToWorld(pos).scaleInPlace(this._meshScale);
  }

  /**
   * Converts a BabylonJS world-space X/Z coordinate back to a geographic coordinate.
   * Useful for translating XR controller ray-pick hit points into lat/lng.
   *
   * @param x  Scene X (divide by meshScale internally to get metres)
   * @param z  Scene Z (divide by meshScale internally to get metres)
   */
  worldToLatLng(x: number, z: number): { lat: number; lng: number } {
    // Scene space is meshScale × metric space; undo that before inverting.
    return worldOffsetToLatLng(x / this._meshScale, z / this._meshScale, this._meshCenter);
  }

  /**
   * Creates a normal-colour shader material for debugging mesh geometry.
   * Flat (Y-up) faces appear green; east-west slopes red; north-south slopes blue.
   */
  createNormalColorMaterial(name = "normal-color-mat"): ShaderMaterial {
    const mat = new ShaderMaterial(
      name,
      this._scene,
      { vertex: "normalColor", fragment: "normalColor" },
      { attributes: ["position", "normal"], uniforms: ["worldViewProjection", "world"] }
    );
    mat.backFaceCulling = false;
    return mat;
  }

  dispose(): void {
    this._groundMesh.dispose();
  }
}
