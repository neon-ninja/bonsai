/**
 * DataPanel — renders an HTML overlay that displays live environmental
 * and ML data.  Created programmatically so no external HTML template
 * is needed.
 */
export class DataPanel {
  constructor() {
    this._panel   = null;
    this._rows    = {};
    this._visible = true;
    this._build();
  }

  // ── DOM construction ───────────────────────────────────────────────────────

  _build() {
    const panel = document.createElement('div');
    panel.id    = 'data-panel';
    Object.assign(panel.style, {
      position:       'absolute',
      top:            '16px',
      right:          '16px',
      width:          '230px',
      background:     'rgba(8, 14, 24, 0.82)',
      border:         '1px solid rgba(80,160,255,0.25)',
      borderRadius:   '8px',
      color:          '#c8daf0',
      fontFamily:     '"Courier New", monospace',
      fontSize:       '12px',
      padding:        '12px 14px',
      backdropFilter: 'blur(6px)',
      zIndex:         '100',
      lineHeight:     '1.7',
      pointerEvents:  'none',
      userSelect:     'none',
    });

    // Title
    const title = document.createElement('div');
    Object.assign(title.style, {
      fontSize:    '13px',
      fontWeight:  'bold',
      color:       '#6ec6ff',
      marginBottom:'6px',
      letterSpacing:'0.08em',
      textTransform: 'uppercase',
    });
    title.textContent = '🌿 Bonsai · Living Land Model';
    panel.appendChild(title);

    // Section: Environment
    panel.appendChild(this._section('Environment'));
    this._row(panel, 'time',         '🕐 Local Time',    '—');
    this._row(panel, 'sunAlt',       '☀ Sun altitude',   '—');
    this._row(panel, 'temperature',  '🌡 Temperature',    '—');
    this._row(panel, 'wind',         '💨 Wind',           '—');
    this._row(panel, 'precip',       '🌧 Precipitation',  '—');
    this._row(panel, 'cloudcover',   '☁ Cloud cover',    '—');
    this._row(panel, 'soilTemp',     '🌱 Soil temp',      '—');

    // Section: Ecosystem (ML)
    panel.appendChild(this._section('Ecosystem (ML)'));
    this._row(panel, 'vegDensity',   '🌲 Vegetation',     '—');
    this._row(panel, 'waterAct',     '💧 Water activity', '—');
    this._row(panel, 'wildlife',     '🐦 Wildlife',       '—');
    this._row(panel, 'health',       '❤ Eco health',     '—');

    // Section: Camera
    panel.appendChild(this._section('Camera'));
    this._row(panel, 'cameraMode',   '🎥 Mode',           'orbit');

    // Location
    const locLine = document.createElement('div');
    Object.assign(locLine.style, {
      marginTop:  '8px',
      fontSize:   '10px',
      color:      'rgba(150,190,230,0.55)',
      borderTop:  '1px solid rgba(80,120,180,0.2)',
      paddingTop: '6px',
    });
    locLine.id = 'data-location';
    locLine.textContent = 'Location: Lake District, UK';
    panel.appendChild(locLine);

    document.body.appendChild(panel);
    this._panel = panel;
  }

  _section(label) {
    const s = document.createElement('div');
    Object.assign(s.style, {
      fontSize:    '10px',
      color:       'rgba(100,160,220,0.6)',
      marginTop:   '8px',
      marginBottom:'2px',
      borderTop:   '1px solid rgba(80,120,180,0.2)',
      paddingTop:  '5px',
      letterSpacing: '0.12em',
      textTransform: 'uppercase',
    });
    s.textContent = label;
    return s;
  }

  _row(parent, key, label, initial) {
    const row = document.createElement('div');
    Object.assign(row.style, { display: 'flex', justifyContent: 'space-between' });

    const lbl = document.createElement('span');
    lbl.style.color   = 'rgba(180,210,240,0.7)';
    lbl.textContent   = label;

    const val = document.createElement('span');
    val.style.color   = '#a8d8ff';
    val.textContent   = initial;

    row.appendChild(lbl);
    row.appendChild(val);
    parent.appendChild(row);
    this._rows[key] = val;
  }

  // ── Public update API ──────────────────────────────────────────────────────

  /**
   * @param {object} weather  from WeatherSystem.data
   * @param {object} mlState  from EcosystemML.state
   * @param {object} sun      from SunSystem.position + timeOfDay
   * @param {boolean} isFlying
   * @param {Date}   [simDate] Simulated date (for time-warp display)
   */
  update(weather, mlState, sun, isFlying, simDate) {
    const now = simDate || new Date();
    this._set('time',        now.toLocaleTimeString());
    this._set('sunAlt',      `${sun.altitudeDeg.toFixed(1)}°`);
    this._set('temperature', `${weather.temperature.toFixed(1)} °C`);
    this._set('wind',
      `${weather.windspeed.toFixed(0)} km/h ${bearing(weather.winddirection)}`
    );
    this._set('precip',      `${weather.precipitation.toFixed(1)} mm/h`);
    this._set('cloudcover',  `${(weather.cloudcover ?? 0).toFixed(0)} %`);
    this._set('soilTemp',    `${(weather.soilTemp ?? weather.temperature - 2).toFixed(1)} °C`);

    this._setBar('vegDensity', mlState.vegetationDensity);
    this._setBar('waterAct',   mlState.waterActivity);
    this._setBar('wildlife',   mlState.wildlifeActivity);
    this._setBar('health',     mlState.ecosystemHealth);

    this._set('cameraMode', isFlying ? '✈ fly-through' : '🖱 orbit');
  }

  setLocation(name) {
    const el = document.getElementById('data-location');
    if (el) el.textContent = `Location: ${name}`;
  }

  _set(key, value) {
    if (this._rows[key]) this._rows[key].textContent = value;
  }

  _setBar(key, value) {
    const pct  = Math.round(value * 100);
    const bars = Math.round(value * 10);
    const filled = '█'.repeat(bars) + '░'.repeat(10 - bars);
    if (this._rows[key]) this._rows[key].textContent = `${filled} ${pct}%`;
  }

  toggle() {
    this._visible = !this._visible;
    if (this._panel) this._panel.style.display = this._visible ? '' : 'none';
  }
}

// Compass bearing string from degrees
function bearing(deg) {
  const dirs = ['N','NE','E','SE','S','SW','W','NW'];
  return dirs[Math.round(deg / 45) % 8];
}
