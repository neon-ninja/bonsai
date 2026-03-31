/**
 * CompassRose — an SVG overlay that always shows which way is north.
 *
 * The entire rose (needle + labels) rotates each frame so that the "N" label
 * continuously points toward the world-space north direction (−Z axis), which
 * matches the orientation of the Auckland DEM data (row 0 = latNorth).
 *
 * Rotation formula (camera azimuth relative to north):
 *   deg = atan2(fx, −fz)
 * where (fx, fz) is the horizontal vector from the camera toward the terrain
 * centre.  This gives 0° when the camera looks north (N at screen-top) and
 * rotates naturally as the user orbits.
 */
export class CompassRose {
  constructor() {
    this._wrap   = null;
    this._rose   = null;
    this._build();
  }

  // ── DOM construction ────────────────────────────────────────────────────────

  _build() {
    const wrap = document.createElement('div');
    wrap.id = 'compass-rose';
    Object.assign(wrap.style, {
      position:      'fixed',
      top:           '16px',
      left:          '16px',
      width:         '76px',
      height:        '76px',
      zIndex:        '100',
      pointerEvents: 'none',
      userSelect:    'none',
    });

    // SVG centred on (0,0) so CSS rotation uses the element's own centre.
    // The "N" arrow points in the −y direction (up) at rotation 0°.
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '-38 -38 76 76');
    svg.setAttribute('width',  '76');
    svg.setAttribute('height', '76');
    svg.style.display = 'block';
    svg.style.overflow = 'visible';
    svg.style.transformOrigin = '50% 50%';

    // Background disc
    const bg = document.createElementNS(NS, 'circle');
    bg.setAttribute('r',    '34');
    bg.setAttribute('fill', 'rgba(6,12,24,0.78)');
    bg.setAttribute('stroke', 'rgba(80,140,220,0.30)');
    bg.setAttribute('stroke-width', '1.5');
    svg.appendChild(bg);

    // Cardinal tick marks (at N/S/E/W)
    const ticks = [
      [0, -34, 0, -28],
      [0,  34, 0,  28],
      [-34, 0, -28, 0],
      [ 34, 0,  28, 0],
    ];
    for (const [x1, y1, x2, y2] of ticks) {
      const line = document.createElementNS(NS, 'line');
      line.setAttribute('x1', x1); line.setAttribute('y1', y1);
      line.setAttribute('x2', x2); line.setAttribute('y2', y2);
      line.setAttribute('stroke', 'rgba(100,160,230,0.45)');
      line.setAttribute('stroke-width', '1.5');
      svg.appendChild(line);
    }

    // North needle (red, points up at rotation 0°)
    const northNeedle = document.createElementNS(NS, 'polygon');
    northNeedle.setAttribute('points', '0,-26 -4.5,0 0,-5 4.5,0');
    northNeedle.setAttribute('fill', '#d95050');
    northNeedle.setAttribute('opacity', '0.92');
    svg.appendChild(northNeedle);

    // South needle (blue-grey)
    const southNeedle = document.createElementNS(NS, 'polygon');
    southNeedle.setAttribute('points', '0,26 4.5,0 0,5 -4.5,0');
    southNeedle.setAttribute('fill', 'rgba(100,140,185,0.65)');
    svg.appendChild(southNeedle);

    // Centre dot
    const dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('r',    '3');
    dot.setAttribute('fill', 'rgba(200,220,255,0.90)');
    svg.appendChild(dot);

    // Cardinal labels
    const labels = [
      { text: 'N', x:  0,   y: -16, fill: '#e07272', weight: 'bold', size: 10 },
      { text: 'S', x:  0,   y:  23, fill: 'rgba(130,165,210,0.70)', weight: 'normal', size: 8 },
      { text: 'E', x:  21,  y:   3, fill: 'rgba(130,165,210,0.70)', weight: 'normal', size: 8 },
      { text: 'W', x: -21,  y:   3, fill: 'rgba(130,165,210,0.70)', weight: 'normal', size: 8 },
    ];
    for (const { text, x, y, fill, weight, size } of labels) {
      const t = document.createElementNS(NS, 'text');
      t.setAttribute('x',           x);
      t.setAttribute('y',           y);
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('font-size',   size);
      t.setAttribute('font-family', 'system-ui,sans-serif');
      t.setAttribute('font-weight', weight);
      t.setAttribute('fill',        fill);
      t.textContent = text;
      svg.appendChild(t);
    }

    wrap.appendChild(svg);
    document.body.appendChild(wrap);

    this._wrap = wrap;
    this._rose = svg;
  }

  // ── Per-frame update ────────────────────────────────────────────────────────

  /**
   * Rotate the compass so that N points toward world-space north (−Z).
   *
   * @param {THREE.Camera}  camera         The scene camera.
   * @param {THREE.Vector3} terrainCentre  The orbit target in world space.
   */
  update(camera, terrainCentre) {
    // Horizontal vector from camera toward the terrain centre.
    const fx =  terrainCentre.x - camera.position.x;
    const fz =  terrainCentre.z - camera.position.z;

    // Angle that rotates the upward (−y) needle to point at world north (−Z).
    // atan2(fx, −fz) gives 0° when camera is south of centre looking north,
    // and increases clockwise as the camera orbits eastward.
    const deg = Math.atan2(fx, -fz) * (180 / Math.PI);

    this._rose.style.transform = `rotate(${deg}deg)`;
  }
}
