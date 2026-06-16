import { fromBlob } from "geotiff";
import { tileBoundsLngLat } from "./mapboxTerrainAdapter";

// Kartverket National Height Model (DTM 50 m) via Geonorge WCS.
// Returns absolute elevation in metres ASL; land pixels positive, no-data = 0.
const WCS_BASE = "https://wcs.geonorge.no/skwms1/wcs.hoyde-dtm50";
const COVERAGE  = "nhm_dtm_topo_25833"; // Norwegian Height Model, UTM33N source
const NO_DATA   = -9999;

export class KartverketElevationAdapter {
  async fetchElevationGrid(
    tx: number,
    ty: number,
    tz: number,
  ): Promise<Float32Array | undefined> {
    const { north, south, east, west } = tileBoundsLngLat(tx, ty, tz);

    const params = new URLSearchParams({
      SERVICE:      "WCS",
      VERSION:      "1.0.0",
      REQUEST:      "GetCoverage",
      COVERAGE,
      BBOX:         `${west},${south},${east},${north}`,
      CRS:          "EPSG:4326",
      RESPONSE_CRS: "EPSG:4326",
      FORMAT:       "GeoTIFF",
      WIDTH:        "256",
      HEIGHT:       "256",
    });

    const url = `${WCS_BASE}?${params}`;
    console.log("[Kartverket] Fetching DTM:", url);

    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.warn(`[Kartverket] WCS returned ${res.status} — skipping land elevation merge`);
        return undefined;
      }
      const blob = await res.blob();
      if (blob.size < 1000) {
        console.warn("[Kartverket] Response too small — outside DTM coverage?");
        return undefined;
      }

      const tiff  = await fromBlob(blob);
      const image = await tiff.getImage();
      const [raster] = await image.readRasters({ interleave: true }) as unknown as [Float32Array];

      const grid = new Float32Array(256 * 256);
      for (let i = 0; i < 256 * 256; i++) {
        const v = raster[i];
        // Keep positive land elevations; treat no-data / ocean as 0 sentinel
        grid[i] = (v !== NO_DATA && v > -500) ? v : 0;
      }

      const landPixels = grid.filter(v => v !== 0).length;
      console.log(`[Kartverket] DTM loaded — ${landPixels}/${256 * 256} land pixels`);
      return grid;
    } catch (err) {
      console.warn("[Kartverket] Fetch failed:", err);
      return undefined;
    }
  }
}
