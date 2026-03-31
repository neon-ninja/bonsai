/**
 * AudioManager — procedural ambient soundscape using the Web Audio API.
 *
 * Synthesises:
 *   • Wind   — filtered pink noise, intensity tracks windspeed
 *   • Rain   — layered noise with downward sweep, intensity tracks precipitation
 *   • Birds  — random chirp sequences (FM synthesis), rate tracks wildlife activity
 *   • River  — low rumble noise for water areas, intensity tracks water activity
 *
 * Audio does not start until the user first interacts with the page
 * (required by browser autoplay policy).
 */

export class AudioManager {
  constructor() {
    this.ctx       = null;
    this.masterGain = null;
    this.started   = false;

    // Wind
    this._windGain  = null;
    this._windNode  = null;
    this._windFilter = null;

    // Rain
    this._rainGain   = null;
    this._rainNodes  = [];

    // Birds
    this._birdInterval = null;
    this._birdGain     = null;
    this._birdActivity = 0.3;

    // River
    this._riverGain  = null;
    this._riverNode  = null;
  }

  // ── Initialisation (called on first user gesture) ────────────────────────

  start() {
    if (this.started) return;
    this.started = true;

    this.ctx        = new (window.AudioContext || window.webkitAudioContext)();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.6;
    this.masterGain.connect(this.ctx.destination);

    this._initWind();
    this._initRain();
    this._initRiver();
    this._initBirds();

    console.info('[Audio] Started');
  }

  // ── Wind (band-passed pink noise) ────────────────────────────────────────

  _initWind() {
    const buf  = this._pinkNoise(2);
    this._windNode = this.ctx.createBufferSource();
    this._windNode.buffer = buf;
    this._windNode.loop   = true;

    // Band-pass: keep mid-range "whoosh"
    const filter = this.ctx.createBiquadFilter();
    filter.type            = 'bandpass';
    filter.frequency.value = 400;
    filter.Q.value         = 0.8;
    this._windFilter = filter;

    // LFO for gentle wavering
    const lfo    = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    lfo.frequency.value  = 0.3;
    lfoGain.gain.value   = 80;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    lfo.start();

    this._windGain = this.ctx.createGain();
    this._windGain.gain.value = 0;

    this._windNode.connect(filter);
    filter.connect(this._windGain);
    this._windGain.connect(this.masterGain);
    this._windNode.start();
  }

  // ── Rain (multiple de-tuned noise sources with high-pass) ─────────────────

  _initRain() {
    this._rainGain = this.ctx.createGain();
    this._rainGain.gain.value = 0;
    this._rainGain.connect(this.masterGain);

    for (let i = 0; i < 3; i++) {
      const src    = this.ctx.createBufferSource();
      src.buffer   = this._whiteNoise(1.5 + i * 0.5);
      src.loop     = true;
      src.playbackRate.value = 0.8 + i * 0.15;

      const hp = this.ctx.createBiquadFilter();
      hp.type            = 'highpass';
      hp.frequency.value = 1200 + i * 600;
      hp.Q.value         = 0.5;

      const g = this.ctx.createGain();
      g.gain.value = 0.4 - i * 0.08;

      src.connect(hp);
      hp.connect(g);
      g.connect(this._rainGain);
      src.start(this.ctx.currentTime + i * 0.07);
      this._rainNodes.push(src);
    }
  }

  // ── River (low rumble) ────────────────────────────────────────────────────

  _initRiver() {
    const buf = this._pinkNoise(3);
    this._riverNode = this.ctx.createBufferSource();
    this._riverNode.buffer = buf;
    this._riverNode.loop   = true;

    const lp = this.ctx.createBiquadFilter();
    lp.type            = 'lowpass';
    lp.frequency.value = 300;
    lp.Q.value         = 1.2;

    this._riverGain = this.ctx.createGain();
    this._riverGain.gain.value = 0;

    this._riverNode.connect(lp);
    lp.connect(this._riverGain);
    this._riverGain.connect(this.masterGain);
    this._riverNode.start();
  }

  // ── Birds (chirp synthesis using FM) ──────────────────────────────────────

  _initBirds() {
    this._birdGain = this.ctx.createGain();
    this._birdGain.gain.value = 0.6;
    this._birdGain.connect(this.masterGain);

    this._scheduleBirdsong();
  }

  _scheduleBirdsong() {
    const minGap = 1500;
    const maxGap = 8000;
    const activity = this._birdActivity;

    const gap = maxGap - activity * (maxGap - minGap);
    this._birdTimeout = setTimeout(() => {
      if (this.started && this.ctx.state === 'running') {
        this._chirp();
      }
      this._scheduleBirdsong();
    }, gap + Math.random() * gap);
  }

  _chirp() {
    const now  = this.ctx.currentTime;
    const baseFreq = 1800 + Math.random() * 2400;
    const dur  = 0.08 + Math.random() * 0.18;
    const numNotes = 1 + Math.floor(Math.random() * 4);

    for (let n = 0; n < numNotes; n++) {
      const t0   = now + n * (dur + 0.04);
      const freq = baseFreq * (1 + n * 0.12);

      // Carrier
      const osc = this.ctx.createOscillator();
      osc.type  = 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      osc.frequency.exponentialRampToValueAtTime(freq * 1.15, t0 + dur * 0.4);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.9,  t0 + dur);

      // Modulator for FM texture
      const mod  = this.ctx.createOscillator();
      const modG = this.ctx.createGain();
      mod.frequency.value = freq * 1.5;
      modG.gain.value     = freq * 0.4;
      mod.connect(modG);
      modG.connect(osc.frequency);

      // Amplitude envelope
      const env = this.ctx.createGain();
      env.gain.setValueAtTime(0, t0);
      env.gain.linearRampToValueAtTime(0.18, t0 + dur * 0.1);
      env.gain.exponentialRampToValueAtTime(0.001, t0 + dur);

      osc.connect(env);
      env.connect(this._birdGain);

      mod.start(t0);
      osc.start(t0);
      mod.stop(t0 + dur + 0.05);
      osc.stop(t0 + dur + 0.05);
    }
  }

  // ── Noise buffers ─────────────────────────────────────────────────────────

  _whiteNoise(durationSec) {
    const sr     = this.ctx.sampleRate;
    const frames = Math.ceil(sr * durationSec);
    const buf    = this.ctx.createBuffer(1, frames, sr);
    const data   = buf.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  _pinkNoise(durationSec) {
    const sr     = this.ctx.sampleRate;
    const frames = Math.ceil(sr * durationSec);
    const buf    = this.ctx.createBuffer(1, frames, sr);
    const data   = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0;
    for (let i = 0; i < frames; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.96900 * b2 + w * 0.1538520;
      b3 = 0.86650 * b3 + w * 0.3104856;
      b4 = 0.55000 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.0168980;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + w * 0.5362) * 0.11;
    }
    return buf;
  }

  // ── Per-frame update ──────────────────────────────────────────────────────

  /**
   * @param {object} weather      from WeatherSystem.data
   * @param {object} mlState      from EcosystemML.state
   * @param {number} sunAltDeg    sun altitude in degrees
   */
  update(weather, mlState, sunAltDeg) {
    if (!this.started || !this.ctx) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();

    const windStrength   = Math.min(1, weather.windspeed / 60);
    const rainIntensity  = Math.min(1, weather.precipitation / 8);
    const waterActivity  = mlState.waterActivity;
    const birdActivity   = mlState.wildlifeActivity;
    const isDaytime      = sunAltDeg > 0;

    const t = this.ctx.currentTime;

    // Smooth transitions (time constant in seconds)
    const TC = 2.0;
    this._windGain.gain.setTargetAtTime(windStrength * 0.55, t, TC);
    this._rainGain.gain.setTargetAtTime(rainIntensity * 0.65, t, TC);
    this._riverGain.gain.setTargetAtTime(waterActivity * 0.40, t, TC);

    // Wind filter frequency tracks speed (lower = deeper rumble when calm)
    this._windFilter.frequency.setTargetAtTime(
      200 + windStrength * 600, t, TC
    );

    // Birds louder during day, activity-driven volume
    const birdVol = isDaytime ? birdActivity * 0.8 : birdActivity * 0.15;
    this._birdGain.gain.setTargetAtTime(birdVol, t, TC);
    this._birdActivity = birdActivity;
  }

  setMasterVolume(v) {
    if (this.masterGain) this.masterGain.gain.value = Math.max(0, Math.min(1, v));
  }

  dispose() {
    if (this._birdTimeout) clearTimeout(this._birdTimeout);
    if (this.ctx) this.ctx.close();
  }
}
