declare module "virtual:geojson-manifest" {
  /** Filenames (with .geojson extension) found in public/data/ at build time. */
  const files: string[];
  export default files;
}
