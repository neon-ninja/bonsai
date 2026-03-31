/**
 * SunSystem — computes real-time sun position from lat/lon + clock,
 * drives a Three.js DirectionalLight and updates the scene sky colour.
 *
 * Astronomical formulae follow the NOAA Solar Calculator approach
 * (equation of time + solar declination from day-of-year).
 */
import * as THREE from 'three';

// Gradient stops for sky colour at different sun elevations (degrees)
const SKY_GRADIENT = [
  { alt: -18, sky: new THREE.Color(0x000510), ambient: new THREE.Color(0x020508) },
  { alt: -6,  sky: new THREE.Color(0x0a0520), ambient: new THREE.Color(0x080318) },
  { alt: 0,   sky: new THREE.Color(0xe8622a), ambient: new THREE.Color(0x6a2a10) },
  { alt: 5,   sky: new THREE.Color(0xf0a060), ambient: new THREE.Color(0x805030) },
  { alt: 15,  sky: new THREE.Color(0x6699cc), ambient: new THREE.Color(0x203050) },
  { alt: 30,  sky: new THREE.Color(0x4488cc), ambient: new THREE.Color(0x182840) },
  { alt: 60,  sky: new THREE.Color(0x2266aa), ambient: new THREE.Color(0x0f1f34) },
  { alt: 90,  sky: new THREE.Color(0x1155aa), ambient: new THREE.Color(0x0a1828) },
];

function lerpColour(a, b, t, out) {
  out.r = a.r + (b.r - a.r) * t;
  out.g = a.g + (b.g - a.g) * t;
  out.b = a.b + (b.b - a.b) * t;
}

function skyAtAltitude(altDeg) {
  const g = SKY_GRADIENT;
  if (altDeg <= g[0].alt) return { sky: g[0].sky.clone(), ambient: g[0].ambient.clone() };
  if (altDeg >= g[g.length - 1].alt) {
    return { sky: g[g.length - 1].sky.clone(), ambient: g[g.length - 1].ambient.clone() };
  }
  for (let i = 1; i < g.length; i++) {
    if (altDeg <= g[i].alt) {
      const t = (altDeg - g[i - 1].alt) / (g[i].alt - g[i - 1].alt);
      const sky = new THREE.Color();
      const amb = new THREE.Color();
      lerpColour(g[i - 1].sky, g[i].sky, t, sky);
      lerpColour(g[i - 1].ambient, g[i].ambient, t, amb);
      return { sky, ambient: amb };
    }
  }
  return { sky: g[g.length - 1].sky.clone(), ambient: g[g.length - 1].ambient.clone() };
}

// ── Core solar maths ─────────────────────────────────────────────────────────

function degToRad(d) { return d * Math.PI / 180; }
function radToDeg(r) { return r * 180 / Math.PI; }

/**
 * Returns { altitudeDeg, azimuthDeg } for a given Date and lat/lon.
 * azimuth is measured clockwise from North (0° = North, 90° = East).
 */
function solarPosition(date, latDeg, lonDeg) {
  const JD = date.getTime() / 86400000 + 2440587.5;
  const n  = JD - 2451545.0;

  // Mean longitude and mean anomaly (degrees)
  const L = (280.460 + 0.9856474 * n) % 360;
  const g = degToRad((357.528 + 0.9856003 * n) % 360);

  // Ecliptic longitude
  const lambda = degToRad(L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g));

  // Obliquity of ecliptic
  const epsilon = degToRad(23.439 - 0.0000004 * n);

  // Right ascension + declination
  const sinDec = Math.sin(epsilon) * Math.sin(lambda);
  const decRad = Math.asin(sinDec);

  // Equation of time (minutes) — simplified
  const B    = degToRad(360 / 365 * (n - 81));
  const eot  = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);

  // Solar time
  const tzOffsetH  = date.getTimezoneOffset() / -60;
  const solarNoon  = 12 - lonDeg / 15 - tzOffsetH - eot / 60;
  const hours      = date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
  const hourAngle  = degToRad((hours - solarNoon) * 15);

  const latRad = degToRad(latDeg);

  // Altitude
  const sinAlt = (
    Math.sin(latRad) * Math.sin(decRad) +
    Math.cos(latRad) * Math.cos(decRad) * Math.cos(hourAngle)
  );
  const altRad = Math.asin(THREE.MathUtils.clamp(sinAlt, -1, 1));

  // Azimuth (clockwise from North)
  const cosAz = (
    (Math.sin(decRad) - Math.sin(latRad) * sinAlt) /
    (Math.cos(latRad) * Math.cos(altRad) + 1e-10)
  );
  let azimuthDeg = radToDeg(Math.acos(THREE.MathUtils.clamp(cosAz, -1, 1)));
  if (Math.sin(hourAngle) > 0) azimuthDeg = 360 - azimuthDeg;

  return {
    altitudeDeg: radToDeg(altRad),
    azimuthDeg,
    altitudeRad: altRad,
  };
}

// ── SunSystem class ───────────────────────────────────────────────────────────

export class SunSystem {
  /**
   * @param {THREE.Scene}    scene
   * @param {THREE.WebGLRenderer} renderer
   * @param {number} lat  latitude  (default: Lake District, UK)
   * @param {number} lon  longitude
   */
  constructor(scene, renderer, lat = 54.45, lon = -2.99) {
    this.scene    = scene;
    this.renderer = renderer;
    this.lat = lat;
    this.lon = lon;

    this._altitudeDeg = 30;
    this._azimuthDeg  = 180;

    // Directional light (sun)
    this.sunLight = new THREE.DirectionalLight(0xfff8e8, 2.5);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.width  = 1024;
    this.sunLight.shadow.mapSize.height = 1024;
    this.sunLight.shadow.camera.near = 0.5;
    this.sunLight.shadow.camera.far  = 200;
    this.sunLight.shadow.camera.left   = -40;
    this.sunLight.shadow.camera.right  =  40;
    this.sunLight.shadow.camera.top    =  40;
    this.sunLight.shadow.camera.bottom = -40;
    scene.add(this.sunLight);
    scene.add(this.sunLight.target);

    // Hemisphere (sky / ground fill)
    this.hemiLight = new THREE.HemisphereLight(0x88aacc, 0x554433, 0.6);
    scene.add(this.hemiLight);

    // Visual sun disc
    const discGeom = new THREE.SphereGeometry(1.2, 16, 8);
    const discMat  = new THREE.MeshBasicMaterial({ color: 0xfffcd0 });
    this.sunDisc   = new THREE.Mesh(discGeom, discMat);
    scene.add(this.sunDisc);

    this._skyColour    = new THREE.Color();
    this._ambientColour = new THREE.Color();
  }

  /** @returns {{ altitudeDeg, azimuthDeg }} */
  get position() {
    return { altitudeDeg: this._altitudeDeg, azimuthDeg: this._azimuthDeg };
  }

  /** 0=midnight, 0.5=noon, 1=midnight */
  get timeOfDay() {
    const d = this._lastDate || new Date();
    return (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) / 86400;
  }

  /**
   * Recalculate sun position and update scene lighting.
   * Should be called once per frame (or at reduced rate for performance).
   * @param {Date} [date] Optional date override (for time-warp). Defaults to now.
   */
  update(date) {
    this.updateWithDate(date || new Date());
  }

  updateWithDate(date) {
    this._lastDate = date;
    const now  = date || new Date();
    const pos  = solarPosition(now, this.lat, this.lon);
    this._altitudeDeg = pos.altitudeDeg;
    this._azimuthDeg  = pos.azimuthDeg;

    const altRad = pos.altitudeRad;
    const azRad  = (pos.azimuthDeg - 180) * Math.PI / 180; // south=0
    const dist   = 80;

    // Sun world position (large sphere projection)
    const sunX = dist * Math.cos(altRad) * Math.sin(azRad);
    const sunY = dist * Math.sin(altRad);
    const sunZ = dist * Math.cos(altRad) * Math.cos(azRad);

    this.sunLight.position.set(sunX, sunY, sunZ);
    this.sunLight.target.position.set(0, 0, 0);
    this.sunDisc.position.set(sunX * 0.98, sunY * 0.98, sunZ * 0.98);

    // Light intensity follows altitude
    const intensity = Math.max(0, Math.sin(altRad));
    this.sunLight.intensity = intensity * 2.5;

    // Sun colour — warm at horizon, white at zenith
    const horizonBlend = 1 - Math.min(1, pos.altitudeDeg / 20);
    this.sunLight.color.setRGB(
      1.0,
      1.0 - horizonBlend * 0.25,
      1.0 - horizonBlend * 0.5
    );

    // Sky + ambient colours
    const { sky, ambient } = skyAtAltitude(pos.altitudeDeg);
    this.scene.background = sky;
    this.scene.fog.color.copy(sky);
    this.hemiLight.color.copy(sky);
    this.hemiLight.groundColor.copy(ambient);
    this.hemiLight.intensity = 0.3 + intensity * 0.5;

    // Sun disc visibility
    this.sunDisc.visible = pos.altitudeDeg > -2;
    if (pos.altitudeDeg < 10) {
      const t = (pos.altitudeDeg + 2) / 12;
      this.sunDisc.material.color.setRGB(1.0, 0.5 + t * 0.45, t * 0.7);
    } else {
      this.sunDisc.material.color.setRGB(1.0, 0.97, 0.85);
    }
  }

  /** Dispose resources */
  dispose() {
    this.scene.remove(this.sunLight, this.hemiLight, this.sunDisc);
  }
}
