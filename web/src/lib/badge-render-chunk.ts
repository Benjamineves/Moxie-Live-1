/**
 * Chunk configuration for the resumable artwork render.
 *
 * Deliberately its own module, free of any sharp import: the client
 * component that drives the render loop needs RENDER_CHUNK_SIZE, and
 * reaching for it through badge-artwork.ts pulled sharp — a native
 * binary — into the browser bundle and failed the build. Keeping the
 * number here means the boundary is structural rather than something to
 * remember.
 *
 * WHY 20.
 *
 * Rendering is not the constraint — a badge rasterizes in roughly 50-200
 * ms depending on CPU. Uploads are: ~66 KB each at a realistic 150-400 ms
 * round trip to Storage. Worst case lands near 600 ms per identity, so a
 * 100-identity batch in one call would be ~60 s — exactly Vercel Hobby's
 * function ceiling, and uncomfortably close to Pro's 300 s once a batch
 * grows.
 *
 * 20 gives ~5 s typical and ~12 s worst case: a 5x margin against the
 * Hobby limit, so a cold start or a retried upload cannot push a chunk
 * over. It also keeps a failed chunk cheap to redo — at most 20 badges
 * are re-rendered, and re-rendering is free of consequence because the
 * work is idempotent (artwork_path IS NULL is the whole queue).
 */
export const RENDER_CHUNK_SIZE = 20;

export type RenderChunkResult = {
  rendered?: number;
  remaining?: number;
  done?: boolean;
  error?: string;
};
