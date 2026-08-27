import { tileBoundsLngLat } from "../adapters/mapboxTerrainAdapter";
import { fetchOverpass } from "./overpassFetch";

export type BuildingType =
  | "residential" | "commercial" | "office" | "industrial"
  | "garage" | "education" | "hospital" | "religious"
  | "hotel" | "stadium" | "other";

export interface OSMBuilding {
  centroid: { lat: number; lng: number };
  /** Actual polygon footprint nodes (unclosed, deduplicated). */
  footprintNodes: { lat: number; lng: number }[];
  heightMetres: number;
  buildingType: BuildingType;
}

function classifyBuilding(tags: Record<string, string>): BuildingType {
  const b       = (tags.building ?? "").toLowerCase();
  const amenity = (tags.amenity  ?? "").toLowerCase();
  if (["apartments","residential","house","detached","terrace","dormitory","bungalow","semidetached_house","farm"].includes(b)) return "residential";
  if (["commercial","retail","shop","supermarket","mall","kiosk"].includes(b))                                                  return "commercial";
  if (["office","government","public","civic","administration"].includes(b))                                                    return "office";
  if (["industrial","warehouse","factory","manufacture","storage"].includes(b))                                                 return "industrial";
  if (["garage","garages","parking","carport"].includes(b))                                                                    return "garage";
  if (["school","university","college","kindergarten"].includes(b) || ["school","university","college"].includes(amenity))     return "education";
  if (["hospital","clinic"].includes(b) || amenity === "hospital")                                                             return "hospital";
  if (["church","cathedral","chapel","mosque","synagogue","temple","religious","shrine"].includes(b))                          return "religious";
  if (["hotel","hostel","motel"].includes(b))                                                                                  return "hotel";
  if (["stadium","sports_hall","arena"].includes(b))                                                                          return "stadium";
  return "other";
}

export async function loadOSMBuildings(
  tx: number, ty: number, tz: number
): Promise<OSMBuilding[]> {
  // v2: cache key bumped to invalidate old box-based cache
  const cacheKey = `osm-buildings-v2-${tz}-${tx}-${ty}`;
  const TTL = 7 * 24 * 60 * 60 * 1000;
  const cached = localStorage.getItem(cacheKey);
  if (cached) {
    const { data, ts } = JSON.parse(cached);
    if (Date.now() - ts < TTL) { console.log("[OSM] Buildings from cache"); return data as OSMBuilding[]; }
  }

  const { north, south, east, west } = tileBoundsLngLat(tx, ty, tz);
  const query = `[out:json][timeout:25];way["building"](${south},${west},${north},${east});out geom;`;
  const data = await fetchOverpass(query);

  const buildings: OSMBuilding[] = [];

  for (const el of data.elements) {
    if (el.type !== "way" || !el.geometry || el.geometry.length < 3) continue;

    const nodes: { lat: number; lng: number }[] =
      el.geometry.map((n: { lat: number; lon: number }) => ({ lat: n.lat, lng: n.lon }));

    // Remove closing duplicate node if present
    const last = nodes[nodes.length - 1];
    const first = nodes[0];
    const footprintNodes = (last.lat === first.lat && last.lng === first.lng)
      ? nodes.slice(0, -1)
      : nodes;

    if (footprintNodes.length < 3) continue;

    const centroid = {
      lat: footprintNodes.reduce((s, n) => s + n.lat, 0) / footprintNodes.length,
      lng: footprintNodes.reduce((s, n) => s + n.lng, 0) / footprintNodes.length,
    };

    const tags = el.tags ?? {};
    let heightMetres = 8;
    if (tags.height)                  heightMetres = parseFloat(tags.height)                  || heightMetres;
    else if (tags["building:levels"]) heightMetres = parseFloat(tags["building:levels"]) * 3.5 || heightMetres;

    buildings.push({
      centroid,
      footprintNodes,
      heightMetres,
      buildingType: classifyBuilding(tags),
    });
  }

  console.log(`[OSM] Loaded ${buildings.length} buildings`);
  localStorage.setItem(cacheKey, JSON.stringify({ data: buildings, ts: Date.now() }));
  return buildings;
}
