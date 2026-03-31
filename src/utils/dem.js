/**
 * DEM (Digital Elevation Model) utility for Auckland, NZ.
 *
 * Fetches real-world elevation data from the Open-Meteo elevation API for a
 * configurable grid covering the Auckland region.  The API is free and
 * requires no authentication key.
 *
 * Reference: https://open-meteo.com/en/docs/elevation-api
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

const ELEV_API  = 'https://api.open-meteo.com/v1/elevation';
const BATCH     = 100;  // conservative per-request coordinate limit

/**
 * Fetch a gridW × gridD elevation grid for the Auckland bounding box.
 *
 * Row 0   = northernmost row (latNorth).
 * Row gridD-1 = southernmost row (latSouth).
 * Col 0   = westernmost column (lonWest).
 * Col gridW-1 = easternmost column (lonEast).
 *
 * @param {number} gridW  number of columns
 * @param {number} gridD  number of rows
 * @returns {Promise<number[][]>}  dem[row][col] in metres; ≤ 0 means ocean/harbour
 */
export async function fetchAucklandDEM(gridW, gridD) {
  const lats = [];
  const lons = [];

  for (let row = 0; row < gridD; row++) {
    const t   = gridD > 1 ? row / (gridD - 1) : 0;
    const lat = AUCKLAND_BOUNDS.latNorth
              - t * (AUCKLAND_BOUNDS.latNorth - AUCKLAND_BOUNDS.latSouth);

    for (let col = 0; col < gridW; col++) {
      const s   = gridW > 1 ? col / (gridW - 1) : 0;
      const lon = AUCKLAND_BOUNDS.lonWest
                + s * (AUCKLAND_BOUNDS.lonEast - AUCKLAND_BOUNDS.lonWest);
      lats.push(lat.toFixed(6));
      lons.push(lon.toFixed(6));
    }
  }

  // Split coordinate list into BATCH-sized chunks and fetch them sequentially.
  const batches = [];
  for (let i = 0; i < lats.length; i += BATCH) {
    batches.push({
      lats: lats.slice(i, i + BATCH),
      lons: lons.slice(i, i + BATCH),
    });
  }

  // Fetch batches sequentially to avoid rate-limiting (HTTP 429).
  const parts = [];
  for (let idx = 0; idx < batches.length; idx++) {
    const b = batches[idx];
    const params = new URLSearchParams({
      latitude:  b.lats.join(','),
      longitude: b.lons.join(','),
    });
    const r = await fetch(`${ELEV_API}?${params}`);
    if (!r.ok) throw new Error(`Elevation API batch ${idx}: ${r.status} ${r.statusText}`);
    const d = await r.json();
    parts.push(d.elevation);
    // Brief pause between requests so we stay well within the free-tier
    // rate limit (~600 req/min sustained; parallel bursts trigger 429s).
    if (idx < batches.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 150));
    }
  }

  const flat = parts.flat();

  // Reshape flat result back into a [row][col] 2-D array.
  const dem = [];
  for (let row = 0; row < gridD; row++) {
    dem[row] = flat.slice(row * gridW, (row + 1) * gridW);
  }
  return dem;
}
