import type { LatLngAltLike } from "../types";

/** A single point feature extracted from a GeoJSON FeatureCollection. */
export interface PointFeature<P = Record<string, unknown>> {
  position: LatLngAltLike;
  properties: P;
}

/** A polygon feature (exterior ring only, nodes unclosed). */
export interface PolygonFeature<P = Record<string, unknown>> {
  nodes: { lat: number; lng: number }[];
  centroid: { lat: number; lng: number };
  properties: P;
}

/** A linestring feature. */
export interface LineFeature<P = Record<string, unknown>> {
  nodes: { lat: number; lng: number; altitude?: number }[];
  properties: P;
}

// ---------------------------------------------------------------------------
// Typed properties matching sample.geojson schema
// ---------------------------------------------------------------------------

export interface GeoJSONPointProps {
  title?: string;
  color?: string;
  "3dmodel"?: string;
  modelscale?: number;
  modelrotate?: number;
  information?: string;
  image?: string;
  video?: string;
  animation?: "justaudio" | "projection-photo" | "projection-video";
  audio?: string;
  audioVolume?: number;   // 0.0–1.0; default 1.0
  startTime?: number;
  endTime?: number;
}

export interface GeoJSONPolygonProps {
  title?: string;
  color?: string;
  opacity?: number;           // 0–100; default 70
  animation?: "fire" | "wave";
  startTime?: number;
  endTime?: number;
}

export interface GeoJSONLineProps {
  title?: string;
  color?: string;
  linewidth?: number;         // metres; default 3
  lineheight?: number;        // metres; default 5
  animation?: "move";
  "3dmodel"?: string;         // GLB filename in public/data/
  modelscale?: number;        // multiplier on auto-fit scale; default 1
  modelrotate?: number;       // degrees clockwise around vertical axis; default 0
  speed?: number;             // scene units/sec along path; default 0.1
  startTime?: number;         // seconds from presentation start
  endTime?: number;           // seconds; model hidden after this
}

export interface GeoJSONFeatureCollection {
  name?:     string;
  playback?: boolean;
  points:    PointFeature<GeoJSONPointProps>[];
  polygons:  PolygonFeature<GeoJSONPolygonProps>[];
  lines:     LineFeature<GeoJSONLineProps>[];
}

/**
 * Loads a GeoJSON FeatureCollection and splits features by geometry type.
 * Supports Point, Polygon, and LineString.
 */
export async function loadGeoJSONFeatures(url: string): Promise<GeoJSONFeatureCollection> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch GeoJSON: ${res.statusText}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const col = (await res.json()) as { name?: string; features: any[] };

  const result: GeoJSONFeatureCollection = { name: col.name, playback: (col as any).playback ?? false, points: [], polygons: [], lines: [] };

  for (const f of col.features) {
    const geom = f.geometry;
    const props = f.properties ?? {};
    if (!geom) continue;

    if (geom.type === "Point") {
      const [lng, lat, altitude = 0] = geom.coordinates as number[];
      result.points.push({ position: { lat, lng, altitude }, properties: props });

    } else if (geom.type === "Polygon") {
      // Only use the exterior ring (index 0) — ignore holes for now
      const ring: [number, number][] = geom.coordinates[0];
      const nodes = ring.map(([lng, lat]) => ({ lat, lng }));
      // Remove closing duplicate
      const last = nodes[nodes.length - 1];
      const open = (last.lat === nodes[0].lat && last.lng === nodes[0].lng)
        ? nodes.slice(0, -1) : nodes;
      if (open.length < 3) continue;
      const centroid = {
        lat: open.reduce((s, n) => s + n.lat, 0) / open.length,
        lng: open.reduce((s, n) => s + n.lng, 0) / open.length,
      };
      result.polygons.push({ nodes: open, centroid, properties: props });

    } else if (geom.type === "LineString") {
      const nodes = (geom.coordinates as number[][]).map(([lng, lat, alt]) => ({ lat, lng, altitude: alt }));
      if (nodes.length < 2) continue;
      result.lines.push({ nodes, properties: props });
    }
  }

  return result;
}

/** Properties from the Norwegian Aquaculture Registry (Akvakulturregisteret). */
export interface AquacultureProperties {
  loknr: number;
  navn: string;
  status_lokalitet: string;
  kapasitet_lok: number;
  kapasitet_unittype: string;
  plassering: string;
  vannmiljo: string;
  fylke: string;
  kommune: string;
  til_arter: string;
  til_innehavere: string;
  lokalitet_url_ekstern: string;
  information?: string;
}

/**
 * Fetches a GeoJSON FeatureCollection and extracts Point features.
 * Features with non-Point geometry are silently skipped.
 * Altitude defaults to 0 if not present in the coordinate tuple.
 */
export async function loadPointFeatures<P = Record<string, unknown>>(
  url: string
): Promise<PointFeature<P>[]> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch GeoJSON: ${response.statusText}`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const collection = (await response.json()) as { features: any[] };
  const results: PointFeature<P>[] = [];

  for (const feature of collection.features) {
    if (feature.geometry?.type !== "Point") continue;
    const [lng, lat, altitude = 0] = feature.geometry.coordinates as number[];
    results.push({ position: { lat, lng, altitude }, properties: feature.properties as P });
  }

  return results;
}
