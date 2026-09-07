// In dev:  Vite proxies /bw-token → https://id.barentswatch.no
//                       /bw-ais  → https://live.ais.barentswatch.no  (see vite.config.ts)
// In prod: PHP file at public/api/ais.php handles OAuth2 server-side.

export interface AISVessel {
  mmsi:      number;
  lat:       number;
  lon:       number;
  heading:   number;  // trueHeading 0-359; 511 = unavailable
  cog:       number;  // courseOverGround in degrees; 360 = unavailable
  speed:     number;  // speedOverGround in knots
  rot:       number;  // rateOfTurn in deg/min; -128 = no info
  name:      string;
  shipType:  number;
  navStatus: number;  // navigationalStatus 0-15; 15 = undefined
  msgtime:   string;  // ISO timestamp of last AIS message
}

// Visual classification used for emissive colour selection in BoatLayer
export type VesselCategory =
  | 'fishing'    // 30
  | 'tug'        // 31-34, 50-59 (towing, pilot, tug, tender)
  | 'pleasure'   // 36-37 (sailing, pleasure craft)
  | 'highspeed'  // 40-49
  | 'passenger'  // 60-69
  | 'cargo'      // 70-79
  | 'tanker'     // 80-89
  | 'military'   // 35
  | 'other';     // everything else (0-29, 38-39, 90-99, …)

// Ordered most-specific first so the first match wins
const CATEGORY_RULES: Array<[VesselCategory, (n: number) => boolean]> = [
  ['military',   n => n === 35],
  ['fishing',    n => n === 30],
  ['pleasure',   n => n === 36 || n === 37],
  ['tug',        n => (n >= 31 && n <= 34) || (n >= 50 && n <= 59)],
  ['highspeed',  n => n >= 40 && n <= 49],
  ['passenger',  n => n >= 60 && n <= 69],
  ['cargo',      n => n >= 70 && n <= 79],
  ['tanker',     n => n >= 80 && n <= 89],
];

export function shipTypeToCategory(shipType: number): VesselCategory {
  for (const [cat, test] of CATEGORY_RULES) {
    if (test(shipType)) return cat;
  }
  return 'other';
}

// ── dev-only token cache ───────────────────────────────────────────────────────
let _devToken: string | null = null;
let _devTokenExpiry = 0;

async function getDevToken(): Promise<string> {
  if (_devToken && Date.now() < _devTokenExpiry) return _devToken;

  // Credentials come from .env (gitignored) — Rollup DCE removes this block from prod builds
  const id     = import.meta.env.VITE_BW_CLIENT_ID as string;
  const secret = import.meta.env.VITE_BW_CLIENT_SECRET as string;

  // /bw-token is proxied by Vite to https://id.barentswatch.no — bypasses browser CORS
  const res = await fetch("/bw-token/connect/token", {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type:    "client_credentials",
      client_id:     id,
      client_secret: secret,
      scope:         "ais",
    }),
  });
  if (!res.ok) throw new Error(`[AIS] Token failed: ${res.status} ${res.statusText}`);
  const j = await res.json() as { access_token: string; expires_in: number };
  _devToken       = j.access_token;
  _devTokenExpiry = Date.now() + (j.expires_in - 30) * 1_000;
  return _devToken;
}

// ── parsing ────────────────────────────────────────────────────────────────────

function parseVesselArray(
  data: Record<string, unknown>[],
  bounds: { north: number; south: number; east: number; west: number },
): Map<VesselCategory, AISVessel[]> {
  const ALL_CATS: VesselCategory[] = [
    'fishing', 'tug', 'pleasure', 'highspeed',
    'passenger', 'cargo', 'tanker', 'military', 'other',
  ];
  const result = new Map<VesselCategory, AISVessel[]>(ALL_CATS.map(cat => [cat, []]));

  for (const v of data) {
    const lat      = v["latitude"]   ?? v["Latitude"]   ?? v["lat"] ?? v["Lat"];
    const lon      = v["longitude"]  ?? v["Longitude"]  ?? v["lon"] ?? v["Lon"];
    const shipType = v["shipType"]   ?? v["ShipType"]   ?? v["vesselType"] ?? v["VesselType"] ?? 0;
    if (lat == null || lon == null) continue;

    const latN = Number(lat);
    const lonN = Number(lon);

    if (latN < bounds.south || latN > bounds.north ||
        lonN < bounds.west  || lonN > bounds.east) continue;

    // Prefer true heading; fall back to course-over-ground; 511 = unknown
    const heading =
      v["trueHeading"]      ?? v["TrueHeading"]      ??
      v["courseOverGround"] ?? v["CourseOverGround"]  ?? 511;

    const vessel: AISVessel = {
      mmsi:      Number(v["mmsi"]                ?? v["Mmsi"]               ?? 0),
      lat:       latN,
      lon:       lonN,
      heading:   Number(heading),
      cog:       Number(v["courseOverGround"]    ?? v["CourseOverGround"]   ?? 360),
      speed:     Number(v["speedOverGround"]     ?? v["SpeedOverGround"]    ?? 102.3),
      rot:       Number(v["rateOfTurn"]          ?? v["RateOfTurn"]         ?? -128),
      name:      String(v["name"]                ?? v["Name"]               ?? ""),
      shipType:  Number(shipType),
      navStatus: Number(v["navigationalStatus"]  ?? v["navigationStatus"]   ?? v["NavigationalStatus"] ?? 15),
      msgtime:   String(v["msgtime"]             ?? v["Msgtime"]            ?? ""),
    };

    result.get(shipTypeToCategory(vessel.shipType))!.push(vessel);
  }

  return result;
}

// ── main export ────────────────────────────────────────────────────────────────

export async function loadAISVessels(
  bounds: { north: number; south: number; east: number; west: number },
): Promise<Map<VesselCategory, AISVessel[]>> {
  let data: Record<string, unknown>[];

  if (import.meta.env.DEV) {
    const token = await getDevToken();
    const res   = await fetch("/bw-ais/live/v1/latest/combined", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`[AIS] Vessel fetch failed: ${res.status} ${res.statusText}`);
    data = await res.json();
  } else {
    const res = await fetch(`${import.meta.env.BASE_URL}api/ais.php`);
    if (!res.ok) throw new Error(`[AIS] Vessel fetch failed: ${res.status} ${res.statusText}`);
    data = await res.json();
  }

  const result = parseVesselArray(data, bounds);
  let total = 0;
  for (const [cat, vs] of result) { if (vs.length) { console.log(`[AIS] ${cat}: ${vs.length}`); total += vs.length; } }
  console.log(`[AIS] total in tile: ${total}`);
  return result;
}
