import { tileBoundsLngLat } from "../adapters/mapboxTerrainAdapter";
import { fetchOverpass } from "./overpassFetch";

export type PlaceType = "city" | "town" | "village" | "hamlet" | "suburb" | "locality";

export interface OSMPlace {
  name: string;
  lat: number;
  lng: number;
  type: PlaceType;
}

const PLACE_TYPES: PlaceType[] = ["city", "town", "village", "hamlet", "suburb", "locality"];

export async function loadOSMPlaces(tx: number, ty: number, tz: number): Promise<OSMPlace[]> {
  const cacheKey = `osm-places-${tz}-${tx}-${ty}`;
  const TTL = 7 * 24 * 60 * 60 * 1000;
  const cached = localStorage.getItem(cacheKey);
  if (cached) {
    const { data, ts } = JSON.parse(cached);
    if (Date.now() - ts < TTL) { console.log("[OSM] Places from cache"); return data as OSMPlace[]; }
  }

  const { north, south, east, west } = tileBoundsLngLat(tx, ty, tz);

  const query = `[out:json][timeout:25];node["place"]["name"](${south},${west},${north},${east});out;`;

  const data = await fetchOverpass(query);

  const places: OSMPlace[] = data.elements
    .filter((el: any) => el.type === "node" && el.tags?.name && PLACE_TYPES.includes(el.tags.place))
    .map((el: any) => ({
      name: el.tags.name as string,
      lat:  el.lat  as number,
      lng:  el.lon  as number,
      type: el.tags.place as PlaceType,
    }));

  console.log(`[OSM Places] Loaded ${places.length} place labels`);
  localStorage.setItem(cacheKey, JSON.stringify({ data: places, ts: Date.now() }));
  return places;
}
