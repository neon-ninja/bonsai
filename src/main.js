/**
 * main.js — application entry point.
 *
 * Bootstraps the Three.js scene, wires up all subsystems, and runs the
 * main animation loop.
 */
import * as THREE from 'three';
import { VoxelTerrain }      from './VoxelTerrain.js';
import { SunSystem }         from './SunSystem.js';
import { WeatherSystem }     from './WeatherSystem.js';
import { EcosystemML }       from './EcosystemML.js';
import { AudioManager }      from './AudioManager.js';
import { CameraController }  from './CameraController.js';
import { DataPanel }         from './DataPanel.js';

// ── Default location: Auckland, NZ ──────────────────────────────────────────
let LAT = -36.8509;
let LON = 174.7645;

// ── Scene / Renderer ─────────────────────────────────────────────────────────

const canvas   = document.getElementById('canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type    = THREE.PCFShadowMap;
renderer.outputColorSpace  = THREE.SRGBColorSpace;

const scene  = new THREE.Scene();
scene.fog    = new THREE.FogExp2(0x4488cc, 0.008);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.5, 600);

// ── Subsystem initialisation ─────────────────────────────────────────────────

const terrain   = new VoxelTerrain(scene, { gridW: 64, gridD: 64 });
const sunSys    = new SunSystem(scene, renderer, LAT, LON);
const weather   = new WeatherSystem(scene, LAT, LON);
const ecosystem = new EcosystemML(terrain.gridW, terrain.gridD);
const audio     = new AudioManager();
const camCtrl   = new CameraController(camera, canvas, terrain.centre, terrain.halfSize);
const dataPanel = new DataPanel();

// Fetch real Auckland DEM data in the background; terrain rebuilds when ready.
terrain.loadDEM();

// ── Geolocation (optional — update data sources if available) ─────────────

navigator.geolocation?.getCurrentPosition(
  pos => {
    LAT = pos.coords.latitude;
    LON = pos.coords.longitude;
    sunSys.lat   = LAT;
    sunSys.lon   = LON;
    weather.lat  = LAT;
    weather.lon  = LON;
    ecosystem.resetLocation();
    const lonDir = LON >= 0 ? 'E' : 'W';
    const latDir = LAT >= 0 ? 'N' : 'S';
    dataPanel.setLocation(`${Math.abs(LAT).toFixed(2)}°${latDir}, ${Math.abs(LON).toFixed(2)}°${lonDir}`);
    console.info(`[Geo] Using device location: ${LAT.toFixed(4)}, ${LON.toFixed(4)}`);
  },
  () => console.info('[Geo] Using default location (Auckland, NZ)'),
  { timeout: 5000 }
);

// ── UI Controls ──────────────────────────────────────────────────────────────

function buildUI() {
  // Start audio overlay
  const overlay = document.getElementById('start-overlay');
  overlay?.addEventListener('click', () => {
    audio.start();
    overlay.style.opacity = '0';
    overlay.style.pointerEvents = 'none';
    setTimeout(() => { overlay.style.display = 'none'; }, 600);
  });

  // Fly-through button
  document.getElementById('btn-fly')?.addEventListener('click', () => {
    if (camCtrl.isFlying) camCtrl.stopFlyThrough();
    else                  camCtrl.startFlyThrough();
  });

  // Data panel toggle
  document.getElementById('btn-data')?.addEventListener('click', () => {
    dataPanel.toggle();
  });

  // Volume slider
  document.getElementById('volume-slider')?.addEventListener('input', e => {
    audio.setMasterVolume(+e.target.value);
  });

  // Time-warp slider (speed multiplier for time-of-day effects)
  const warpSlider = document.getElementById('warp-slider');
  if (warpSlider) {
    warpSlider.addEventListener('input', e => {
      _timeWarp = +e.target.value;
      document.getElementById('warp-label').textContent = `×${_timeWarp}`;
    });
  }
}
buildUI();

// ── Main loop ─────────────────────────────────────────────────────────────────

const clock = {
  _last: performance.now() / 1000,
  _start: performance.now() / 1000,
  getDelta() {
    const now = performance.now() / 1000;
    const dt = now - this._last;
    this._last = now;
    return dt;
  },
  getElapsedTime() {
    return performance.now() / 1000 - this._start;
  },
};

// Simulation time offset in milliseconds — advances faster when _timeWarp > 1
let _simOffsetMs = 0;
let _timeWarp = 1;
let _frame = 0;

function animate() {
  requestAnimationFrame(animate);

  const dt   = Math.min(clock.getDelta(), 0.1); // cap at 100 ms to avoid spiral
  const t    = clock.getElapsedTime();

  _frame++;

  // Camera — always use real dt so fly-through speed is independent of time-warp
  camCtrl.update(dt);

  // Sun (every 2nd frame is sufficient — sun moves slowly)
  if (_frame % 2 === 0) {
    _simOffsetMs += dt * (_timeWarp - 1) * 1000; // accumulate extra ms
    const simDate = new Date(Date.now() + _simOffsetMs);
    sunSys.updateWithDate(simDate);
  }

  // Weather particles
  weather.update(t, dt, scene);

  // Ecosystem ML
  ecosystem.update(t * _timeWarp, weather.data, sunSys.position, terrain);

  // Terrain colours (every 3rd frame)
  if (_frame % 3 === 0) {
    terrain.updateColours(weather.data, ecosystem.state, sunSys.position.altitudeDeg / 90, sunSys.timeOfDay);
  }

  // Water animation
  terrain.animateWater(t, ecosystem.state.waterActivity);

  // Audio
  audio.update(weather.data, ecosystem.state, sunSys.position.altitudeDeg);

  // Data panel (every 30th frame ~= 0.5 Hz)
  if (_frame % 30 === 0) {
    const simDate = new Date(Date.now() + _simOffsetMs);
    dataPanel.update(weather.data, ecosystem.state, sunSys.position, camCtrl.isFlying, simDate);
  }

  // Update fly-through button label
  if (_frame % 60 === 0) {
    const btn = document.getElementById('btn-fly');
    if (btn) btn.textContent = camCtrl.isFlying ? '⏹ Stop Tour' : '✈ Auto Tour';
  }

  renderer.render(scene, camera);
}

// ── Resize handler ────────────────────────────────────────────────────────────

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ── Start ─────────────────────────────────────────────────────────────────────

animate();
