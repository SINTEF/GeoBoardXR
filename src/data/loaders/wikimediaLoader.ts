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

const API = 'https://commons.wikimedia.org/w/api.php';

export async function loadWikimediaPhotos(
  bounds: { north: number; south: number; east: number; west: number },
): Promise<WikimediaPhoto[]> {
  const { lat, lon, radius } = tileCenterAndRadius(bounds);

  // Step 1 — geosearch: find photo pages near tile centre
  const gsParams = new URLSearchParams({
    action:      'query',
    list:        'geosearch',
    gscoord:     `${lat}|${lon}`,
    gsradius:    String(radius),
    gslimit:     '50',
    gsnamespace: '6',   // File: namespace
    format:      'json',
    origin:      '*',
  });
  const gsRes  = await fetch(`${API}?${gsParams}`);
  if (!gsRes.ok) throw new Error(`[Wikimedia] geosearch failed: ${gsRes.status}`);
  const gsData = await gsRes.json() as {
    query: { geosearch: Array<{ pageid: number; title: string; lat: number; lon: number }> }
  };

  const hits = gsData.query?.geosearch ?? [];
  if (hits.length === 0) return [];

  // Filter to actual tile bounds
  const inBounds = hits.filter(h =>
    h.lat >= bounds.south && h.lat <= bounds.north &&
    h.lon >= bounds.west  && h.lon <= bounds.east,
  );
  if (inBounds.length === 0) return [];

  // Step 2 — imageinfo + extmetadata for each page
  const ids = inBounds.map(h => h.pageid).join('|');
  const iiParams = new URLSearchParams({
    action:   'query',
    pageids:  ids,
    prop:     'imageinfo|coordinates',
    iiprop:   'url|extmetadata',
    iiurlwidth:'800',
    format:   'json',
    origin:   '*',
  });
  const iiRes  = await fetch(`${API}?${iiParams}`);
  if (!iiRes.ok) throw new Error(`[Wikimedia] imageinfo failed: ${iiRes.status}`);
  const iiData = await iiRes.json() as {
    query: { pages: Record<string, {
      pageid: number;
      title:  string;
      coordinates?: Array<{ lat: number; lon: number }>;
      imageinfo?: Array<{
        url: string;
        thumburl?: string;
        extmetadata?: {
          ImageDescription?: { value: string };
          Artist?:           { value: string };
        };
      }>;
    }> }
  };

  const photos: WikimediaPhoto[] = [];

  for (const hit of inBounds) {
    const page = iiData.query?.pages?.[String(hit.pageid)];
    if (!page) continue;
    const info = page.imageinfo?.[0];
    if (!info?.url) continue;

    const meta  = info.extmetadata ?? {};
    const desc  = meta.ImageDescription?.value ? stripHtml(meta.ImageDescription.value) : '';
    const artist = meta.Artist?.value          ? stripHtml(meta.Artist.value)           : '';
    const title  = page.title.replace(/^File:/, '').replace(/\.[^.]+$/, ''); // strip "File:" and extension

    photos.push({
      pageId:      hit.pageid,
      title,
      lat:         hit.lat,
      lon:         hit.lon,
      imageUrl:    info.thumburl ?? info.url,
      description: desc,
      artist,
    });
  }

  console.log(`[Wikimedia] ${photos.length} photos in tile`);
  return photos;
}
