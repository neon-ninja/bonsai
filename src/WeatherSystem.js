/**
 * WeatherSystem — fetches live weather from Open-Meteo (free, no API key)
 * and drives:
 *   • rain particle system
 *   • wind streak particles
 *   • scene fog density
 *
 * Data is cached for 10 minutes to avoid excessive API calls.
 */
import * as THREE from 'three';

const OPEN_METEO_URL =
  'https://api.open-meteo.com/v1/forecast?' +
  'latitude={LAT}&longitude={LON}' +
  '&current_weather=true' +
  '&hourly=precipitation,cloudcover,soil_temperature_0cm' +
  '&timezone=auto';

const CACHE_MS    = 10 * 60 * 1000; // 10 minutes
const RAIN_COUNT  = 1200;
const WIND_COUNT  = 400;

export class WeatherSystem {
  /**
   * @param {THREE.Scene} scene
   * @param {number} lat
   * @param {number} lon
   */
  constructor(scene, lat = 54.45, lon = -2.99) {
    this.scene = scene;
    this.lat   = lat;
    this.lon   = lon;

    /** @type {{ temperature: number, precipitation: number, windspeed: number, winddirection: number, cloudcover: number, soilTemp: number }} */
    this.data = {
      temperature:  12,
      precipitation: 0,
      windspeed:    10,
      winddirection: 220,
      cloudcover:    50,
      soilTemp:      10,
    };

    this._lastFetch  = 0;
    this._fetchInFlight = false;

    this._buildRainSystem();
    this._buildWindSystem();

    // Start first fetch immediately
    this._fetchWeather();
  }

  // ── Particle systems ────────────────────────────────────────────────────────

  _buildRainSystem() {
    const positions = new Float32Array(RAIN_COUNT * 3);
    const spread = 40, height = 30;
    for (let i = 0; i < RAIN_COUNT; i++) {
      positions[i * 3]     = (Math.random() - 0.5) * spread;
      positions[i * 3 + 1] = Math.random() * height;
      positions[i * 3 + 2] = (Math.random() - 0.5) * spread;
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0x88bbee,
      size: 0.08,
      transparent: true,
      opacity: 0,
      sizeAttenuation: true,
    });
    this.rainParticles = new THREE.Points(geom, mat);
    this.scene.add(this.rainParticles);
  }

  _buildWindSystem() {
    const positions = new Float32Array(WIND_COUNT * 3);
    const spread = 50, height = 20;
    for (let i = 0; i < WIND_COUNT; i++) {
      positions[i * 3]     = (Math.random() - 0.5) * spread;
      positions[i * 3 + 1] = 1 + Math.random() * height;
      positions[i * 3 + 2] = (Math.random() - 0.5) * spread;
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.12,
      transparent: true,
      opacity: 0,
      sizeAttenuation: true,
    });
    this.windParticles = new THREE.Points(geom, mat);
    this.scene.add(this.windParticles);
  }

  // ── API fetch ────────────────────────────────────────────────────────────────

  async _fetchWeather() {
    if (this._fetchInFlight) return;
    this._fetchInFlight = true;
    try {
      const url = OPEN_METEO_URL
        .replace('{LAT}', this.lat.toFixed(4))
        .replace('{LON}', this.lon.toFixed(4));
      const res  = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();

      const cw = json.current_weather || {};
      // Get current hour index for hourly data
      const idx = new Date().getHours();
      const hourly = json.hourly || {};

      this.data.temperature    = cw.temperature     ?? this.data.temperature;
      this.data.windspeed      = cw.windspeed        ?? this.data.windspeed;
      this.data.winddirection  = cw.winddirection    ?? this.data.winddirection;
      this.data.precipitation  = (hourly.precipitation  || [])[idx] ?? this.data.precipitation;
      this.data.cloudcover     = (hourly.cloudcover     || [])[idx] ?? this.data.cloudcover;
      this.data.soilTemp       = (hourly.soil_temperature_0cm || [])[idx] ?? this.data.soilTemp;

      this._lastFetch = Date.now();
      console.info('[Weather] Fetched:', this.data);
    } catch (err) {
      console.warn('[Weather] Fetch failed, using defaults:', err.message);
      // Exponential back-off: wait at least 2 minutes before retrying
      this._lastFetch = Date.now() + 2 * 60 * 1000;
    } finally {
      this._fetchInFlight = false;
    }
  }

  // ── Per-frame update ─────────────────────────────────────────────────────────

  /**
   * @param {number} t   elapsed time (seconds)
   * @param {number} dt  delta time (seconds)
   * @param {THREE.Scene} scene
   */
  update(t, dt, scene) {
    // Re-fetch if cache expired
    if (Date.now() - this._lastFetch > CACHE_MS) {
      this._fetchWeather();
    }

    const rainIntensity = Math.min(1, this.data.precipitation / 8);  // 8mm/h = heavy rain
    const windStrength  = Math.min(1, this.data.windspeed / 60);     // 60 km/h = very windy

    this._updateRain(t, dt, rainIntensity);
    this._updateWind(t, dt, windStrength);
    this._updateFog(scene, windStrength, rainIntensity);
  }

  _updateRain(t, dt, intensity) {
    const positions = this.rainParticles.geometry.attributes.position.array;
    const spread = 40, height = 30;
    const speed  = 12 * intensity + 2;

    for (let i = 0; i < RAIN_COUNT; i++) {
      positions[i * 3 + 1] -= speed * dt;
      if (positions[i * 3 + 1] < 0) {
        positions[i * 3]     = (Math.random() - 0.5) * spread;
        positions[i * 3 + 1] = height + Math.random() * 5;
        positions[i * 3 + 2] = (Math.random() - 0.5) * spread;
      }
    }
    this.rainParticles.geometry.attributes.position.needsUpdate = true;
    this.rainParticles.material.opacity = intensity * 0.55;
    this.rainParticles.material.size    = 0.04 + intensity * 0.08;
  }

  _updateWind(t, dt, strength) {
    const positions  = this.windParticles.geometry.attributes.position.array;
    const dirRad = (this.data.winddirection + 180) * Math.PI / 180; // from direction → towards
    const speed  = strength * 20 + 2;
    const dx     = Math.sin(dirRad) * speed * dt;
    const dz     = Math.cos(dirRad) * speed * dt;

    for (let i = 0; i < WIND_COUNT; i++) {
      positions[i * 3]     += dx;
      positions[i * 3 + 2] += dz;
      // Wrap at boundaries
      if (Math.abs(positions[i * 3])     > 25) positions[i * 3]     = -Math.sign(positions[i * 3]) * 25;
      if (Math.abs(positions[i * 3 + 2]) > 25) positions[i * 3 + 2] = -Math.sign(positions[i * 3 + 2]) * 25;
    }
    this.windParticles.geometry.attributes.position.needsUpdate = true;
    this.windParticles.material.opacity = strength * 0.35;
  }

  _updateFog(scene, windStrength, rainIntensity) {
    const cloudCover  = (this.data.cloudcover ?? 50) / 100;
    const targetDensity = 0.004 + cloudCover * 0.018 + rainIntensity * 0.012;
    if (scene.fog) {
      scene.fog.density += (targetDensity - scene.fog.density) * 0.02;
    }
  }

  dispose() {
    this.scene.remove(this.rainParticles, this.windParticles);
    this.rainParticles.geometry.dispose();
    this.windParticles.geometry.dispose();
    this.rainParticles.material.dispose();
    this.windParticles.material.dispose();
  }
}
