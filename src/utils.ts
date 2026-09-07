/** Returns the URL for a file in the public /data folder, respecting the Vite base path. */
export function dataUrl(filename: string): string {
  return `${import.meta.env.BASE_URL}data/${filename}`;
}

/** Returns the URL for an internal model asset in public/models/, respecting the Vite base path. */
export function modelsUrl(filename: string): string {
  return `${import.meta.env.BASE_URL}models/${filename}`;
}
