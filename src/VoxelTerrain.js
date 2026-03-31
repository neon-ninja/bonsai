/**
 * VoxelTerrain — generates a voxel land model.
 *
 * Uses two separate InstancedMesh objects:
 *   • solidMesh  — opaque terrain (rock, grass, sand, snow)
 *   • waterMesh  — semi-transparent water layer
 *
 * Colours are updated dynamically based on environmental data
 * (weather, sun position, ML ecosystem state).
 *
 * When loadDEM() is called the terrain is rebuilt from real Auckland elevation
 * data fetched from the Open-Meteo elevation API.
 */
import * as THREE from 'three';
import { Noise2D } from './utils/noise.js';
import { fetchAucklandDEM } from './utils/dem.js';

// ── Biome thresholds (normalised height 0–1) ────────────────────────────────
const WATER_LEVEL  = 0.28;
const SAND_LEVEL   = 0.32;
const GRASS_LEVEL  = 0.60;
const FOREST_LEVEL = 0.78;
const ROCK_LEVEL   = 0.90;

// ── Biome base colours ───────────────────────────────────────────────────────
const COLOURS = {
  deepWater:    new THREE.Color(0x0d2b4e),
  shallowWater: new THREE.Color(0x1a5f8a),
  sand:         new THREE.Color(0xc8b456),
  grassDry:     new THREE.Color(0x8aaa3a),
  grassWet:     new THREE.Color(0x3a7a28),
  forest:       new THREE.Color(0x1e5a1e),
  rock:         new THREE.Color(0x6a6460),
  snowLine:     new THREE.Color(0xd8e8f0),
};

export class VoxelTerrain {
  /**
   * @param {THREE.Scene} scene
   * @param {{ gridW?: number, gridD?: number, maxH?: number }} opts
   */
  constructor(scene, opts = {}) {
    this.scene    = scene;
    this.gridW    = opts.gridW ?? 32;
    this.gridD    = opts.gridD ?? 32;
    this.maxH     = opts.maxH  ?? 12;   // voxel units
    this.voxSize  = 1.0;

    this.noise = new Noise2D(137);

    // heightMap[z][x] = integer height in voxels
    this.heightMap = [];
    // biome[z][x] = normalised height 0–1 for colour lookup
    this.normMap   = [];
    // stateMap[z][x] = { moisture, vegetation, activity } driven by ML
    this.stateMap  = [];

    // Instance bookkeeping
    this.solidInstances = [];  // { x, y, z, biomeH }
    this.waterInstances = [];

    this._generateFromNoise();
    this._buildMeshes();
  }

  // ── Terrain generation ─────────────────────────────────────────────────────

  _generateFromNoise() {
    const scale = 0.08;
    let minH = Infinity, maxH = -Infinity;
    const raw = [];

    for (let z = 0; z < this.gridD; z++) {
      raw[z] = [];
      for (let x = 0; x < this.gridW; x++) {
        const v = this.noise.fbm(x * scale, z * scale, 6, 0.55, 2.0);
        raw[z][x] = v;
        if (v < minH) minH = v;
        if (v > maxH) maxH = v;
      }
    }

    for (let z = 0; z < this.gridD; z++) {
      this.heightMap[z] = [];
      this.normMap[z]   = [];
      this.stateMap[z]  = [];
      for (let x = 0; x < this.gridW; x++) {
        const norm = (raw[z][x] - minH) / (maxH - minH); // 0–1
        this.normMap[z][x] = norm;
        // Map to integer heights: minimum 1 so the grid is always filled
        this.heightMap[z][x] = Math.max(1, Math.round(norm * this.maxH));
        this.stateMap[z][x] = { moisture: 0.5, vegetation: 0.5, activity: 0.3 };
      }
    }
  }

  /**
   * Populate heightMap / normMap / stateMap from a 2-D array of real-world
   * elevations (metres).  Values ≤ 0 are treated as ocean.
   *
   * normMap is mapped so that:
   *   • ocean cells (elev ≤ 0) → norm = 0  (deepWater colour, water overlay)
   *   • land cells  (elev > 0) → norm ∈ [WATER_LEVEL, 1.0] proportional to
   *     elevation, so existing biome thresholds keep working correctly.
   *
   * @param {number[][]} demData  [row][col] elevation in metres
   */
  _generateFromDEM(demData) {
    // Find the maximum land elevation to use as the scaling ceiling.
    // If every cell is ocean (elev ≤ 0) maxLandElev stays at 1; in that case
    // every cell takes the elev ≤ 0 branch below so the value is never used.
    let maxLandElev = 1; // guard against division by zero
    for (let z = 0; z < this.gridD; z++) {
      for (let x = 0; x < this.gridW; x++) {
        if (demData[z][x] > maxLandElev) maxLandElev = demData[z][x];
      }
    }

    for (let z = 0; z < this.gridD; z++) {
      this.heightMap[z] = [];
      this.normMap[z]   = [];
      this.stateMap[z]  = [];
      for (let x = 0; x < this.gridW; x++) {
        const elev = demData[z][x];
        let norm;
        if (elev <= 0) {
          // Ocean / harbour — sits below water level in every biome check.
          norm = 0;
        } else {
          // Map positive elevation linearly onto [SAND_LEVEL, 1.0].
          // Starting from SAND_LEVEL (rather than WATER_LEVEL) ensures every
          // land cell is assigned a biome colour of grassWet or above — never
          // the blue shallowWater colour — and a voxel height strictly above
          // waterH so the water overlay never incorrectly floods genuine land.
          //   near-sea-level land → grass colours
          //   mid-elevation      → grass / forest
          //   high terrain       → rock / snow
          norm = SAND_LEVEL + (elev / maxLandElev) * (1 - SAND_LEVEL);
        }
        this.normMap[z][x] = norm;
        this.heightMap[z][x] = Math.max(1, Math.round(norm * this.maxH));
        this.stateMap[z][x] = { moisture: 0.5, vegetation: 0.5, activity: 0.3 };
      }
    }
  }

  // ── Mesh lifecycle ─────────────────────────────────────────────────────────

  /** Remove current meshes from the scene and free GPU resources. */
  _disposeMeshes() {
    if (this.solidMesh) {
      this.scene.remove(this.solidMesh);
      this.solidMesh.geometry.dispose();
      this.solidMesh.material.dispose();
      this.solidMesh = null;
    }
    if (this.waterMesh) {
      this.scene.remove(this.waterMesh);
      this.waterMesh.geometry.dispose();
      this.waterMesh.material.dispose();
      this.waterMesh = null;
    }
  }

  /**
   * Fetch real-world elevation data for Auckland and rebuild the terrain.
   * Falls back to the existing procedural terrain if the API is unreachable.
   *
   * This method is intentionally fire-and-forget from main.js so the app
   * renders immediately with noise terrain while the DEM loads in the
   * background.
   */
  async loadDEM() {
    try {
      console.info('[DEM] Fetching Auckland elevation data…');
      const demData = await fetchAucklandDEM(this.gridW, this.gridD);

      // Swap out all instance arrays and rebuild meshes in-place.
      this.solidInstances = [];
      this.waterInstances = [];
      this._generateFromDEM(demData);
      this._disposeMeshes();
      this._buildMeshes();

      console.info('[DEM] Auckland terrain rebuilt from real elevation data.');
    } catch (err) {
      console.warn('[DEM] Elevation fetch failed — keeping procedural terrain.', err.message);
    }
  }

  // ── Mesh construction ──────────────────────────────────────────────────────

  _buildMeshes() {
    const geom = new THREE.BoxGeometry(
      this.voxSize, this.voxSize, this.voxSize
    );

    // Collect solid and water voxel world positions
    const waterH = Math.round(WATER_LEVEL * this.maxH);

    for (let z = 0; z < this.gridD; z++) {
      for (let x = 0; x < this.gridW; x++) {
        const h = this.heightMap[z][x];
        const nh = this.normMap[z][x];
        const wx = x - this.gridW / 2 + 0.5;
        const wz = z - this.gridD / 2 + 0.5;

        for (let y = 0; y < h; y++) {
          this.solidInstances.push({ wx, y, wz, nh, column: { z, x } });
        }
        if (h <= waterH) {
          this.waterInstances.push({ wx, y: waterH, wz });
        }
      }
    }

    // ── Solid mesh ──
    const solidMat = new THREE.MeshLambertMaterial({ vertexColors: false });
    this.solidMesh = new THREE.InstancedMesh(geom, solidMat, this.solidInstances.length);
    this.solidMesh.castShadow    = true;
    this.solidMesh.receiveShadow = true;

    const mat4 = new THREE.Matrix4();
    for (let i = 0; i < this.solidInstances.length; i++) {
      const { wx, y, wz } = this.solidInstances[i];
      mat4.makeTranslation(wx, y + 0.5, wz);
      this.solidMesh.setMatrixAt(i, mat4);
    }
    this.solidMesh.instanceMatrix.needsUpdate = true;
    this._initSolidColours();
    this.scene.add(this.solidMesh);

    // ── Water mesh ──
    if (this.waterInstances.length > 0) {
      const waterMat = new THREE.MeshLambertMaterial({
        color: 0x1a6ea0,
        transparent: true,
        opacity: 0.72,
      });
      this.waterMesh = new THREE.InstancedMesh(geom, waterMat, this.waterInstances.length);
      this.waterMesh.receiveShadow = true;

      for (let i = 0; i < this.waterInstances.length; i++) {
        const { wx, y, wz } = this.waterInstances[i];
        mat4.makeTranslation(wx, y + 0.5, wz);
        this.waterMesh.setMatrixAt(i, mat4);
      }
      this.waterMesh.instanceMatrix.needsUpdate = true;
      this.scene.add(this.waterMesh);
    }
  }

  // ── Colour helpers ─────────────────────────────────────────────────────────

  _biomeColour(nh) {
    if (nh < WATER_LEVEL)  return COLOURS.deepWater.clone();
    if (nh < SAND_LEVEL)   return COLOURS.shallowWater.clone();
    if (nh < GRASS_LEVEL)  return COLOURS.grassWet.clone();
    if (nh < FOREST_LEVEL) return COLOURS.forest.clone();
    if (nh < ROCK_LEVEL)   return COLOURS.rock.clone();
    return COLOURS.snowLine.clone();
  }

  _initSolidColours() {
    const c = new THREE.Color();
    for (let i = 0; i < this.solidInstances.length; i++) {
      c.copy(this._biomeColour(this.solidInstances[i].nh));
      this.solidMesh.setColorAt(i, c);
    }
    this.solidMesh.instanceColor.needsUpdate = true;
  }

  // ── Public update API ──────────────────────────────────────────────────────

  /**
   * Called each frame by main.js to refresh voxel colours.
   *
   * @param {object} weather   { temperature, precipitation, windspeed }
   * @param {object} mlState   { vegetationDensity, waterActivity, wildlifeActivity, ecosystemHealth }
   * @param {number} sunAlt    sun altitude in radians
   * @param {number} timeOfDay 0–1 (midnight=0, noon=0.5)
   */
  updateColours(weather, mlState, sunAlt, timeOfDay) {
    const tempNorm   = THREE.MathUtils.clamp((weather.temperature - (-10)) / 50, 0, 1); // −10°C..40°C → 0..1
    const rainNorm   = THREE.MathUtils.clamp(weather.precipitation / 20, 0, 1);
    const healthMod  = mlState.ecosystemHealth;
    const vegMod     = mlState.vegetationDensity;

    const c = new THREE.Color();

    for (let i = 0; i < this.solidInstances.length; i++) {
      const inst = this.solidInstances[i];
      const { nh, column } = inst;
      const state = this.stateMap[column.z][column.x];

      const base = this._biomeColour(nh);

      // Temperature tint: warm = shift towards orange, cold = shift towards blue
      const tempShift = (tempNorm - 0.5) * 0.15;
      base.r = THREE.MathUtils.clamp(base.r + tempShift, 0, 1);
      base.b = THREE.MathUtils.clamp(base.b - tempShift * 0.5, 0, 1);

      // Rain darkens terrain slightly
      base.multiplyScalar(1.0 - rainNorm * 0.18);

      // Vegetation density affects green channel on grass/forest voxels
      if (nh >= SAND_LEVEL && nh < ROCK_LEVEL) {
        const vegBoost = (vegMod - 0.5) * 0.2;
        base.g = THREE.MathUtils.clamp(base.g + vegBoost, 0, 1);
        base.r = THREE.MathUtils.clamp(base.r - vegBoost * 0.5, 0, 1);
      }

      // Ecosystem health — vibrancy
      const vibrancy = 0.8 + healthMod * 0.4;
      const grey = (base.r + base.g + base.b) / 3;
      base.r = THREE.MathUtils.clamp(grey + (base.r - grey) * vibrancy, 0, 1);
      base.g = THREE.MathUtils.clamp(grey + (base.g - grey) * vibrancy, 0, 1);
      base.b = THREE.MathUtils.clamp(grey + (base.b - grey) * vibrancy, 0, 1);

      // Local moisture from ML state
      const moist = state.moisture;
      base.b = THREE.MathUtils.clamp(base.b + moist * 0.06, 0, 1);

      c.setRGB(base.r, base.g, base.b);
      this.solidMesh.setColorAt(i, c);
    }
    this.solidMesh.instanceColor.needsUpdate = true;

    // Water colour modulated by activity
    if (this.waterMesh) {
      const wa = mlState.waterActivity;
      const waterHue = 0.55 + wa * 0.05;  // 0.55 ≈ blue, 0.60 ≈ teal
      this.waterMesh.material.color.setHSL(waterHue, 0.7, 0.3 + wa * 0.15);
      this.waterMesh.material.opacity = 0.55 + wa * 0.25;
    }
  }

  /**
   * Animate water voxels up/down with a sine wave.
   * @param {number} t elapsed time in seconds
   * @param {number} activity waterActivity 0–1
   */
  animateWater(t, activity) {
    if (!this.waterMesh) return;
    const mat4 = new THREE.Matrix4();
    const amp  = 0.06 + activity * 0.12;
    const speed = 0.8 + activity * 1.2;

    for (let i = 0; i < this.waterInstances.length; i++) {
      const { wx, y, wz } = this.waterInstances[i];
      const wave = Math.sin(t * speed + wx * 0.5 + wz * 0.5) * amp;
      mat4.makeTranslation(wx, y + 0.5 + wave, wz);
      this.waterMesh.setMatrixAt(i, mat4);
    }
    this.waterMesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Update a column's ML state (called from EcosystemML).
   */
  setColumnState(x, z, state) {
    if (this.stateMap[z] && this.stateMap[z][x] !== undefined) {
      this.stateMap[z][x] = state;
    }
  }

  /** Centre of the terrain in world space */
  get centre() {
    return new THREE.Vector3(0, this.maxH * 0.4, 0);
  }

  /** Approx bounding box half-size */
  get halfSize() {
    return Math.max(this.gridW, this.gridD) * 0.5;
  }
}
