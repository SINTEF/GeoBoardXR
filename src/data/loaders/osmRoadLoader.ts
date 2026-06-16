import { tileBoundsLngLat } from "../adapters/mapboxTerrainAdapter";

export type RoadType = "major" | "secondary" | "minor";

export interface OSMRoad {
  nodes: { lat: number; lng: number }[];
  roadType: RoadType;
  widthMetres: number;
}

const TYPE_MAP: Record<string, { roadType: RoadType; widthMetres: number }> = {
  motorway:      { roadType: "major",     widthMetres: 10 },
  trunk:         { roadType: "major",     widthMetres: 9  },
  primary:       { roadType: "major",     widthMetres: 7  },
  secondary:     { roadType: "secondary", widthMetres: 5  },
  tertiary:      { roadType: "secondary", widthMetres: 4  },
  residential:   { roadType: "minor",     widthMetres: 3  },
  unclassified:  { roadType: "minor",     widthMetres: 3  },
};

export async function loadOSMRoads(tx: number, ty: number, tz: number): Promise<OSMRoad[]> {
  const cacheKey = `osm-roads-${tz}-${tx}-${ty}`;
  const TTL = 7 * 24 * 60 * 60 * 1000;
  const cached = localStorage.getItem(cacheKey);
  if (cached) {
    const { data, ts } = JSON.parse(cached);
    if (Date.now() - ts < TTL) { console.log("[OSM] Roads from cache"); return data as OSMRoad[]; }
  }

  const { north, south, east, west } = tileBoundsLngLat(tx, ty, tz);
  const types = Object.keys(TYPE_MAP).join("|");
  const query = `[out:json][timeout:30];way["highway"~"^(${types})$"](${south},${west},${north},${east});out geom;`;

  const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const roads: OSMRoad[] = [];
    for (const el of data.elements) {
      if (el.type !== "way" || !el.geometry || el.geometry.length < 2) continue;
      const hw = el.tags?.highway as string;
      const cfg = TYPE_MAP[hw];
      if (!cfg) continue;
      roads.push({
        nodes: el.geometry.map((n: { lat: number; lon: number }) => ({ lat: n.lat, lng: n.lon })),
        ...cfg,
      });
    }

    console.log(`[OSM Roads] Loaded ${roads.length} roads`);
    localStorage.setItem(cacheKey, JSON.stringify({ data: roads, ts: Date.now() }));
    return roads;
  } catch (err) {
    throw err;
  }
}
