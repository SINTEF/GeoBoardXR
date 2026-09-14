const MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.fr/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.openstreetmap.ru/api/interpreter",
];

const TIMEOUT_MS   = 100_000;
const RETRY_DELAY  = 2_000;  // wait before trying next mirror

async function tryMirror(base: string, query: string): Promise<{ elements: any[] }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${base}?data=${encodeURIComponent(query)}`, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchOverpass(query: string): Promise<{ elements: any[] }> {
  let lastErr: unknown;
  for (let i = 0; i < MIRRORS.length; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, RETRY_DELAY));
    try {
      return await tryMirror(MIRRORS[i], query);
    } catch (err) {
      console.warn(`[Overpass] ${MIRRORS[i]} failed, trying next…`, err);
      lastErr = err;
    }
  }
  throw lastErr;
}
