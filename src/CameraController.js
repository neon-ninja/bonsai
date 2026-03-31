/**
 * CameraController — wraps Three.js OrbitControls and adds an automated
 * fly-through that smoothly visits several viewpoints around the terrain.
 *
 * Fly-through activates automatically after 20 s of user inactivity,
 * and pauses instantly when the user interacts.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ── Fly-through waypoints (relative to terrain centre) ────────────────────────
// Each waypoint: { position: Vector3, lookAt: Vector3, duration: seconds }
function buildWaypoints(halfSize) {
  const H = halfSize;
  return [
    { position: new THREE.Vector3( H * 1.6,  H * 0.9,  H * 1.6), duration: 8 },
    { position: new THREE.Vector3( 0,        H * 1.2,  H * 2.0), duration: 7 },
    { position: new THREE.Vector3(-H * 1.6,  H * 0.8,  H * 1.2), duration: 8 },
    { position: new THREE.Vector3(-H * 1.2,  H * 1.4, -H * 1.2), duration: 7 },
    { position: new THREE.Vector3( H * 0.4,  H * 0.5, -H * 1.8), duration: 9 },
    { position: new THREE.Vector3( H * 1.8,  H * 0.6, -H * 0.4), duration: 8 },
    { position: new THREE.Vector3( H * 0.6,  H * 0.3,  H * 0.8), duration: 6 }, // low pass
    { position: new THREE.Vector3( 0,        H * 2.2,  0),        duration: 6 }, // overhead
  ];
}

export class CameraController {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {HTMLElement}             domElement
   * @param {THREE.Vector3}           terrainCentre
   * @param {number}                  terrainHalfSize
   */
  constructor(camera, domElement, terrainCentre, terrainHalfSize) {
    this.camera    = camera;
    this.centre    = terrainCentre.clone();
    this.halfSize  = terrainHalfSize;

    // Orbit controls for manual interaction
    this.controls = new OrbitControls(camera, domElement);
    this.controls.target.copy(this.centre);
    this.controls.enableDamping    = true;
    this.controls.dampingFactor    = 0.07;
    this.controls.minDistance      = 4;
    this.controls.maxDistance      = terrainHalfSize * 5;
    this.controls.maxPolarAngle    = Math.PI * 0.48; // don't go below horizon
    this.controls.update();

    // Fly-through state
    this._waypoints    = buildWaypoints(terrainHalfSize);
    this._flyActive    = false;
    this._flyIdx       = 0;
    this._flyProgress  = 0;   // 0–1 within current segment
    this._flyStartPos  = camera.position.clone();
    this._flyStartLook = this.centre.clone();
    this._idleTimer    = 0;
    this._idleThreshold = 20; // seconds before auto fly-through

    // Detect user interaction
    this._onInteract = () => {
      this._idleTimer = 0;
      if (this._flyActive) this.stopFlyThrough();
    };
    domElement.addEventListener('pointerdown', this._onInteract);
    domElement.addEventListener('wheel',       this._onInteract);
    domElement.addEventListener('touchstart',  this._onInteract);

    // Position camera at first waypoint initially
    camera.position.copy(this._waypoints[0].position);
    camera.lookAt(this.centre);
    this.controls.update();
  }

  // ── Fly-through control ───────────────────────────────────────────────────

  startFlyThrough() {
    if (this._flyActive) return;
    this._flyActive    = true;
    this._flyIdx       = 0;
    this._flyProgress  = 0;
    this._flyStartPos  = this.camera.position.clone();
    this.controls.enabled = false;
    console.info('[Camera] Fly-through started');
  }

  stopFlyThrough() {
    this._flyActive = false;
    this.controls.enabled = true;
    console.info('[Camera] Fly-through stopped');
  }

  get isFlying() { return this._flyActive; }

  // ── Per-frame update ──────────────────────────────────────────────────────

  /**
   * @param {number} dt  delta time in seconds
   */
  update(dt) {
    if (this._flyActive) {
      this._updateFly(dt);
    } else {
      this._idleTimer += dt;
      if (this._idleTimer >= this._idleThreshold) {
        this.startFlyThrough();
      }
      this.controls.update();
    }
  }

  _updateFly(dt) {
    const wp   = this._waypoints[this._flyIdx];
    const next = this._waypoints[(this._flyIdx + 1) % this._waypoints.length];

    this._flyProgress += dt / wp.duration;

    if (this._flyProgress >= 1) {
      this._flyProgress = this._flyProgress - 1;
      this._flyStartPos = wp.position.clone();
      this._flyIdx      = (this._flyIdx + 1) % this._waypoints.length;
    }

    // Smooth ease in/out (smoothstep)
    const t = smoothstep(this._flyProgress);

    const from = this._flyStartPos;
    const to   = this._waypoints[this._flyIdx].position;

    this.camera.position.lerpVectors(from, to, t);

    // Always look at the terrain centre
    this.camera.lookAt(this.centre);
  }

  dispose() {
    this.controls.dispose();
  }
}

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}
