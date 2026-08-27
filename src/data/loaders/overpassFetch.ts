const MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.ru/api/interpreter",
];

const TIMEOUT_MS = 10_000;

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
  for (const base of MIRRORS) {
    try {
      return await tryMirror(base, query);
    } catch (err) {
      console.warn(`[Overpass] ${base} failed, trying next…`, err);
      lastErr = err;
    }
  }
  throw lastErr;
}
