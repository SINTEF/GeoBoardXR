<?php
/**
 * BarentsWatch AIS proxy — runs server-side to avoid CORS.
 * Fetches the latest vessel positions snapshot from the Live AIS API.
 * Upload this file alongside the Vite dist/ output to your web server.
 * Requires PHP with cURL (standard on most shared hosts).
 */

// ── credentials — read from project root .env (gitignored) ───────────────────
(function () {
    $envFile = __DIR__ . '/../../.env';
    if (!file_exists($envFile)) return;
    foreach (file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        if (str_starts_with(trim($line), '#')) continue;
        if (!str_contains($line, '=')) continue;
        [$k, $v] = explode('=', $line, 2);
        putenv(trim($k) . '=' . trim($v));
    }
})();
define('BW_CLIENT_ID',     getenv('VITE_BW_CLIENT_ID')     ?: '');
define('BW_CLIENT_SECRET', getenv('VITE_BW_CLIENT_SECRET') ?: '');
define('TOKEN_URL', 'https://id.barentswatch.no/connect/token');
// Latest AIS snapshot: one position per MMSI, up to 24 h old
define('AIS_URL',   'https://live.ais.barentswatch.no/live/v1/latest/combined');

// ── response headers ──────────────────────────────────────────────────────────
header('Access-Control-Allow-Origin: *');
header('Content-Type: application/json; charset=utf-8');

// ── token fetch (APCu-cached when available) ──────────────────────────────────
function getBWToken(): string {
    $cacheKey = 'bw_ais_token';
    if (function_exists('apcu_fetch')) {
        $hit = false;
        $tok = apcu_fetch($cacheKey, $hit);
        if ($hit && $tok) return (string) $tok;
    }

    $ch = curl_init(TOKEN_URL);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => http_build_query([
            'grant_type'    => 'client_credentials',
            'client_id'     => BW_CLIENT_ID,
            'client_secret' => BW_CLIENT_SECRET,
            'scope'         => 'ais',
        ]),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER     => ['Content-Type: application/x-www-form-urlencoded'],
        CURLOPT_TIMEOUT        => 10,
    ]);
    $body = curl_exec($ch);
    curl_close($ch);

    $j   = json_decode((string) $body, true);
    $tok = $j['access_token'] ?? null;
    if (!$tok) {
        http_response_code(502);
        echo json_encode(['error' => 'token_failed']);
        exit;
    }

    if (function_exists('apcu_store')) {
        apcu_store($cacheKey, $tok, max(0, (int)($j['expires_in'] ?? 3600) - 30));
    }
    return (string) $tok;
}

// ── main ──────────────────────────────────────────────────────────────────────
$token = getBWToken();

$ch = curl_init(AIS_URL);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER     => ["Authorization: Bearer $token"],
    CURLOPT_TIMEOUT        => 20,
]);
$body = curl_exec($ch);
$code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

http_response_code($code ?: 502);
echo $body;
