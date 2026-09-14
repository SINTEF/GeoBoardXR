export interface WikimediaPhoto {
  pageId:      number;
  title:       string;
  lat:         number;
  lon:         number;
  imageUrl:    string;
  description: string;
  artist:      string;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim();
}

function degToRad(deg: number): number {
  return deg * Math.PI / 180;
}

function tileCenterAndRadius(
  bounds: { north: number; south: number; east: number; west: number },
): { lat: number; lon: number; radius: number } {
  const lat = (bounds.north + bounds.south) / 2;
  const lon = (bounds.east  + bounds.west)  / 2;
  const heightM = (bounds.north - bounds.south) * 111_000;
  const widthM  = (bounds.east  - bounds.west)  * 111_000 * Math.cos(degToRad(lat));
  const radius  = Math.min(10_000, Math.round(Math.max(heightM, widthM) / 2));
  return { lat, lon, radius };
}

const API        = 'https://commons.wikimedia.org/w/api.php';
const CACHE_KEY  = (lat: number, lon: number, radius: number) => `wikimedia_${lat.toFixed(4)}_${lon.toFixed(4)}_${radius}`;
const CACHE_TTL  = 7 * 24 * 60 * 60 * 1000; // 7 days

type GeoHit = { pageid: number; title: string; lat: number; lon: number };

async function geosearchAll(lat: number, lon: number, radius: number): Promise<GeoHit[]> {
  const all: GeoHit[] = [];
  let cont: Record<string, string> = {};

  do {
    const params = new URLSearchParams({
      action:      'query',
      list:        'geosearch',
      gscoord:     `${lat}|${lon}`,
      gsradius:    String(radius),
      gslimit:     '500',
      gsnamespace: '6',
      format:      'json',
      origin:      '*',
      ...cont,
    });

    const res  = await fetch(`${API}?${params}`);
    if (!res.ok) throw new Error(`[Wikimedia] geosearch failed: ${res.status}`);
    const data = await res.json() as {
      query:    { geosearch: GeoHit[] };
      continue?: Record<string, string>;
    };

    all.push(...(data.query?.geosearch ?? []));
    cont = data.continue ?? {};
  } while (Object.keys(cont).length > 0);

  return all;
}

export async function loadWikimediaPhotos(
  bounds: { north: number; south: number; east: number; west: number },
): Promise<WikimediaPhoto[]> {
  const { lat, lon, radius } = tileCenterAndRadius(bounds);
  const cacheKey = CACHE_KEY(lat, lon, radius);

  // Check localStorage cache
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      const { ts, data } = JSON.parse(cached) as { ts: number; data: WikimediaPhoto[] };
      if (Date.now() - ts < CACHE_TTL) {
        console.log(`[Wikimedia] ${data.length} photos from cache`);
        return data;
      }
    }
  } catch { /* ignore */ }

  // Step 1 — paginated geosearch
  const hits = await geosearchAll(lat, lon, radius);
  if (hits.length === 0) return [];

  // Filter to actual tile bounds
  const inBounds = hits.filter(h =>
    h.lat >= bounds.south && h.lat <= bounds.north &&
    h.lon >= bounds.west  && h.lon <= bounds.east,
  );
  if (inBounds.length === 0) return [];

  // Step 2 — imageinfo in batches of 50 (API pageids limit)
  const photos: WikimediaPhoto[] = [];
  for (let i = 0; i < inBounds.length; i += 50) {
    const batch = inBounds.slice(i, i + 50);
    const ids   = batch.map(h => h.pageid).join('|');
    const iiParams = new URLSearchParams({
      action:    'query',
      pageids:   ids,
      prop:      'imageinfo|coordinates',
      iiprop:    'url|extmetadata',
      iiurlwidth:'800',
      format:    'json',
      origin:    '*',
    });
    const iiRes  = await fetch(`${API}?${iiParams}`);
    if (!iiRes.ok) throw new Error(`[Wikimedia] imageinfo failed: ${iiRes.status}`);
    const iiData = await iiRes.json() as {
      query: { pages: Record<string, {
        pageid: number; title: string;
        imageinfo?: Array<{ url: string; thumburl?: string; extmetadata?: { ImageDescription?: { value: string }; Artist?: { value: string } } }>;
      }> }
    };

    for (const hit of batch) {
      const page = iiData.query?.pages?.[String(hit.pageid)];
      if (!page) continue;
      const info = page.imageinfo?.[0];
      if (!info?.url) continue;
      const meta   = info.extmetadata ?? {};
      const desc   = meta.ImageDescription?.value ? stripHtml(meta.ImageDescription.value) : '';
      const artist = meta.Artist?.value           ? stripHtml(meta.Artist.value)            : '';
      const title  = page.title.replace(/^File:/, '').replace(/\.[^.]+$/, '');
      photos.push({ pageId: hit.pageid, title, lat: hit.lat, lon: hit.lon, imageUrl: info.thumburl ?? info.url, description: desc, artist });
    }
  }

  // Cache result
  try {
    localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data: photos }));
  } catch { /* storage full — skip */ }

  console.log(`[Wikimedia] ${photos.length} photos fetched and cached`);
  return photos;
}
