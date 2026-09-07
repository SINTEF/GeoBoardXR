import { defineConfig } from "vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { readdirSync } from "fs";
import { join } from "path";

// Virtual module that exposes the list of .geojson files in public/data/
// at build/dev time — no code changes needed when files are added or removed.
function geojsonManifestPlugin() {
  const VIRTUAL_ID = "virtual:geojson-manifest";
  const RESOLVED   = "\0" + VIRTUAL_ID;
  return {
    name: "geojson-manifest",
    resolveId(id: string) { if (id === VIRTUAL_ID) return RESOLVED; },
    load(id: string) {
      if (id !== RESOLVED) return;
      let files: string[] = [];
      try {
        files = readdirSync(join(process.cwd(), "public", "data"))
          .filter(f => f.toLowerCase().endsWith(".geojson"));
      } catch { /* public/data doesn't exist yet */ }
      return `export default ${JSON.stringify(files)};`;
    },
  };
}

export default defineConfig(({ command, mode }) => {
  return {
    plugins: [mode === "development" && basicSsl(), geojsonManifestPlugin()].filter(Boolean),
    base: command === "build" ? "/geoboardxr/" : "/",
    server: {
      watch: { usePolling: true },
      host: "0.0.0.0",
      port: 5173,
      // ── BarentsWatch AIS dev proxy ──────────────────────────────────────────
      // BarentsWatch token and AIS endpoints block browser CORS requests, so we
      // route them through Vite's built-in proxy (Node.js → BarentsWatch,
      // same-origin from the browser's perspective → no CORS issue).
      // Credentials are injected server-side via the token request body; they
      // live in .env and are never baked into the production bundle.
      // In production the PHP file public/api/ais.php does the same job.
      proxy: {
        "/bw-token": {
          target:      "https://id.barentswatch.no",
          changeOrigin: true,
          rewrite:     (path) => path.replace(/^\/bw-token/, ""),
        },
        "/bw-ais": {
          target:      "https://live.ais.barentswatch.no",
          changeOrigin: true,
          rewrite:     (path) => path.replace(/^\/bw-ais/, ""),
        },
      },
    },
    // Rollup code-splitting incorrectly pairs GLSL and WGSL shader include chunks across
    // @babylonjs packages (e.g. the GLSL default.vertex chunk gets the WGSL defaultUboDeclaration
    // and vice versa). When the wrong include isn't found in the store, BabylonJS falls back
    // to fetching ShadersInclude/*.fx from the server — which 404s — and isReady() hangs
    // forever, producing a black screen. Keeping all BabylonJS code in one chunk prevents
    // the cross-contamination between GLSL and WGSL variants.
    build: {
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (id.includes("/node_modules/@babylonjs/")) return "babylon";
          },
        },
      },
    },
    // BabylonJS uses conditional dynamic import() calls for shaders (e.g. rgbdDecode).
    // Vite's esbuild pre-bundler flattens node_modules into chunks in .vite/deps/,
    // which breaks those relative paths at runtime — the browser fetches a missing URL
    // and receives the HTML 404 fallback, which then appears as the shader source.
    // Excluding these packages from pre-bundling keeps the original file layout intact
    // so dynamic imports resolve correctly.
    optimizeDeps: {
      exclude: ["@babylonjs/core", "@babylonjs/gui", "@babylonjs/loaders", "@babylonjs/materials"],
    },
  };
});
