/**
 * DEM (Digital Elevation Model) utility for Auckland, NZ.
 *
 * Fetches real-world elevation data from AWS Terrain Tiles using the Terrarium
 * RGB encoding.  The tiles are served from a public CDN, require no API key,
 * and impose no per-IP rate limits — solving the HTTP 429 errors produced by
 * the previous Open-Meteo elevation API.
 *
 * Reference: https://registry.opendata.aws/terrain-tiles/
 * Tile URL:  https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png
 * Encoding:  elevation_m = R × 256 + G + B / 256 − 32768
 */

// Auckland region bounding box.
// Covers the isthmus, Waitemata & Manukau Harbours, the Waitakere Ranges, and
// the North Shore so the recognisable "narrow isthmus between two harbours"
// shape is visible in the voxel grid.
export const AUCKLAND_BOUNDS = {
  latNorth: -36.65,  // ~Orewa / northern tip of the grid
  latSouth: -37.05,  // ~southern Manukau Harbour
  lonWest:  174.50,  // ~Manukau Harbour entrance / western Waitakere Ranges
  lonEast:  175.00,  // ~eastern suburbs / Howick
};

const TILE_BASE = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';
const TILE_ZOOM = 9;    // zoom 9 fits the entire Auckland region in ≤ 4 tiles
const TILE_SIZE = 256;  // Terrarium tiles are always 256 × 256 px

// ── Tile-coordinate helpers ────────────────────────────────────────────────

function lonToTileX(lon, z) {
  return Math.floor((lon + 180) / 360 * (1 << z));
}

function latToTileY(lat, z) {
  const φ = lat * Math.PI / 180;
  return Math.floor(
    (1 - Math.log(Math.tan(φ) + 1 / Math.cos(φ)) / Math.PI) / 2 * (1 << z),
  );
}

/** Left-edge longitude of tile x at zoom z. */
function tileXToLon(x, z) {
  return x / (1 << z) * 360 - 180;
}

/** Top-edge latitude of tile y at zoom z (Web Mercator). */
function tileYToLat(y, z) {
  return Math.atan(Math.sinh(Math.PI * (1 - 2 * y / (1 << z)))) * 180 / Math.PI;
}

// ── Tile fetching ──────────────────────────────────────────────────────────

/**
 * Fetch a Terrarium terrain tile and return its raw RGBA pixel data.
 *
 * `colorSpaceConversion: 'none'` is critical: it prevents the browser from
 * applying sRGB gamma correction to the PNG values, which would corrupt the
 * RGB-encoded elevation numbers.
 *
 * @returns {Promise<Uint8ClampedArray>}  length = TILE_SIZE × TILE_SIZE × 4
 */
async function fetchTilePixels(z, x, y) {
  const url = `${TILE_BASE}/${z}/${x}/${y}.png`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Terrain tile ${z}/${x}/${y}: ${response.status} ${response.statusText}`);
  }
  const blob   = await response.blob();
  const bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none' });
  const canvas = new OffscreenCanvas(TILE_SIZE, TILE_SIZE);
  const ctx    = canvas.getContext('2d', { colorSpace: 'srgb' });
  ctx.drawImage(bitmap, 0, 0);
  return ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE).data;
}

/** Terrarium decoding: elevation_m = R × 256 + G + B / 256 − 32 768 */
function decodeElevation(r, g, b) {
  return r * 256 + g + b / 256 - 32768;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Fetch a gridW × gridD elevation grid for the Auckland bounding box.
 *
 * Row 0        = northernmost row (latNorth).
 * Row gridD-1  = southernmost row (latSouth).
 * Col 0        = westernmost column (lonWest).
 * Col gridW-1  = easternmost column (lonEast).
 *
 * @param {number} gridW  number of columns
 * @param {number} gridD  number of rows
 * @returns {Promise<number[][]>}  dem[row][col] in metres; ≤ 0 means ocean/harbour
 */
export async function fetchAucklandDEM(gridW, gridD) {
  const { latNorth, latSouth, lonWest, lonEast } = AUCKLAND_BOUNDS;

  // Identify the tile range that covers the bounding box.
  // latToTileY increases southward, so north yields the smaller y index.
  const txMin = lonToTileX(lonWest,  TILE_ZOOM);
  const txMax = lonToTileX(lonEast,  TILE_ZOOM);
  const tyMin = latToTileY(latNorth, TILE_ZOOM);
  const tyMax = latToTileY(latSouth, TILE_ZOOM);

  // Fetch all required tiles (typically 1–4 tiles for Auckland at zoom 9).
  const tiles = {};
  for (let ty = tyMin; ty <= tyMax; ty++) {
    for (let tx = txMin; tx <= txMax; tx++) {
      tiles[`${tx},${ty}`] = await fetchTilePixels(TILE_ZOOM, tx, ty);
    }
  }

  // Sample elevation at each grid point.
  const dem = [];
  for (let row = 0; row < gridD; row++) {
    dem[row] = [];
    const t   = gridD > 1 ? row / (gridD - 1) : 0;
    const lat = latNorth - t * (latNorth - latSouth);

    for (let col = 0; col < gridW; col++) {
      const s   = gridW > 1 ? col / (gridW - 1) : 0;
      const lon = lonWest + s * (lonEast - lonWest);

      const tx = lonToTileX(lon, TILE_ZOOM);
      const ty = latToTileY(lat, TILE_ZOOM);
      const pixels = tiles[`${tx},${ty}`];

      if (!pixels) {
        dem[row][col] = 0;
        continue;
      }

      // Map the geographic coordinate to a pixel position within the tile.
      const lonLeft   = tileXToLon(tx,     TILE_ZOOM);
      const lonRight  = tileXToLon(tx + 1, TILE_ZOOM);
      const latTop    = tileYToLat(ty,     TILE_ZOOM);
      const latBottom = tileYToLat(ty + 1, TILE_ZOOM);

      const px = Math.min(TILE_SIZE - 1, Math.max(0,
        Math.round((lon - lonLeft)  / (lonRight  - lonLeft)  * (TILE_SIZE - 1)),
      ));
      const py = Math.min(TILE_SIZE - 1, Math.max(0,
        Math.round((latTop - lat)   / (latTop    - latBottom) * (TILE_SIZE - 1)),
      ));

      const idx = (py * TILE_SIZE + px) * 4;
      dem[row][col] = decodeElevation(pixels[idx], pixels[idx + 1], pixels[idx + 2]);
    }
  }

  return dem;
}
