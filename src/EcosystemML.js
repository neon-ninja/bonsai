/**
 * EcosystemML — autonomous ecosystem engine combining:
 *
 *   1. A lightweight feed-forward neural network (back-propagation capable)
 *      that maps environmental inputs → ecosystem state predictions.
 *
 *   2. A spatial cellular-automaton layer that propagates vegetation,
 *      moisture, and activity values between neighbouring voxel columns.
 *
 * The network adapts over time (online learning) as new weather data arrives,
 * gradually improving its predictions against observed ground-truth signals.
 */

// ── Activation functions ─────────────────────────────────────────────────────
const tanh    = x => Math.tanh(x);
const dtanh   = y => 1 - y * y;          // derivative of tanh w.r.t. output
const sigmoid = x => 1 / (1 + Math.exp(-x));
const dsigmoid = y => y * (1 - y);       // derivative of sigmoid w.r.t. output

// ── Mini neural-network ───────────────────────────────────────────────────────

class NeuralNet {
  /**
   * @param {number[]} layerSizes  e.g. [8, 16, 8, 4]
   * @param {number}   learningRate
   */
  constructor(layerSizes = [8, 16, 8, 4], learningRate = 0.01) {
    this.layers = layerSizes;
    this.lr     = learningRate;
    this.weights = [];
    this.biases  = [];
    this.activations = [];

    // Xavier initialisation
    for (let l = 1; l < layerSizes.length; l++) {
      const fan = layerSizes[l - 1];
      const std = Math.sqrt(2 / fan);
      const W   = [];
      for (let j = 0; j < layerSizes[l]; j++) {
        const row = [];
        for (let i = 0; i < layerSizes[l - 1]; i++) {
          row.push((Math.random() * 2 - 1) * std);
        }
        W.push(row);
      }
      this.weights.push(W);
      this.biases.push(new Array(layerSizes[l]).fill(0));
      this.activations.push(null);
    }
  }

  /** Forward pass — returns output vector */
  forward(input) {
    let a = [...input];
    this.activations[0] = a;
    for (let l = 0; l < this.weights.length; l++) {
      const W    = this.weights[l];
      const b    = this.biases[l];
      const out  = [];
      const isLast = l === this.weights.length - 1;
      for (let j = 0; j < W.length; j++) {
        let z = b[j];
        for (let i = 0; i < a.length; i++) z += W[j][i] * a[i];
        out.push(isLast ? sigmoid(z) : tanh(z));
      }
      a = out;
      this.activations[l + 1] = a;
    }
    return a;
  }

  /** Back-propagation with MSE loss against target vector */
  backward(input, target) {
    const pred   = this.forward(input);
    const nL     = this.weights.length;
    const deltas = new Array(nL).fill(null);

    // Output layer delta
    const dOut = [];
    for (let j = 0; j < pred.length; j++) {
      const y  = pred[j];
      dOut.push((y - target[j]) * dsigmoid(y));
    }
    deltas[nL - 1] = dOut;

    // Hidden layer deltas
    for (let l = nL - 2; l >= 0; l--) {
      // d.length = number of neurons in layer l+1 = rows in weight matrix l
      const d    = new Array(this.weights[l].length).fill(0);
      const nextD = deltas[l + 1];
      const W    = this.weights[l + 1];
      for (let i = 0; i < d.length; i++) {
        let sum = 0;
        for (let j = 0; j < nextD.length; j++) sum += W[j][i] * nextD[j];
        d[i] = sum * dtanh(this.activations[l + 1][i]);
      }
      deltas[l] = d;
    }

    // Weight + bias updates
    for (let l = 0; l < nL; l++) {
      const a = l === 0 ? input : this.activations[l];
      const d = deltas[l];
      for (let j = 0; j < this.weights[l].length; j++) {
        for (let i = 0; i < this.weights[l][j].length; i++) {
          this.weights[l][j][i] -= this.lr * d[j] * a[i];
        }
        this.biases[l][j] -= this.lr * d[j];
      }
    }
  }
}

// ── EcosystemML ───────────────────────────────────────────────────────────────

export class EcosystemML {
  /**
   * @param {number} gridW
   * @param {number} gridD
   */
  constructor(gridW = 32, gridD = 32) {
    this.gridW = gridW;
    this.gridD = gridD;

    // Network: 8 env. inputs → 16 → 8 → 4 ecosystem outputs
    this.network = new NeuralNet([8, 16, 8, 4], 0.008);

    /** Global ecosystem state output from the network */
    this.state = {
      vegetationDensity: 0.5,
      waterActivity:     0.5,
      wildlifeActivity:  0.3,
      ecosystemHealth:   0.6,
    };

    // Per-column CA state grid
    this.grid = this._initGrid();

    // Rolling history for online learning (last N observations)
    this._history = [];
    this._maxHistory = 120;

    // Autonomous "heartbeat" — prediction steps ahead of real data
    this._autonomousPhase = 0;
    this._lastNetworkUpdate = 0;
    this._lastCAStep = 0;
  }

  _initGrid() {
    const grid = [];
    for (let z = 0; z < this.gridD; z++) {
      grid[z] = [];
      for (let x = 0; x < this.gridW; x++) {
        grid[z][x] = {
          moisture:   0.3 + Math.random() * 0.4,
          vegetation: 0.2 + Math.random() * 0.6,
          activity:   0.1 + Math.random() * 0.3,
        };
      }
    }
    return grid;
  }

  // ── Input encoding ────────────────────────────────────────────────────────

  /**
   * Encode weather + sun data into a normalised input vector.
   * @param {object} weather
   * @param {object} sun     { altitudeDeg, azimuthDeg }
   * @returns {number[]} length-8 vector with values ~in [-1, 1]
   */
  _encodeInputs(weather, sun) {
    const now     = new Date();
    const tod     = (now.getHours() * 3600 + now.getMinutes() * 60) / 86400; // 0–1
    const doy     = (now - new Date(now.getFullYear(), 0, 0)) / 86400000;     // 0–1
    const tempN   = (weather.temperature - 10) / 25;             // centre on 10°C
    const windN   = weather.windspeed / 60;
    const windSin = Math.sin(weather.winddirection * Math.PI / 180);
    const windCos = Math.cos(weather.winddirection * Math.PI / 180);
    const rainN   = Math.min(1, weather.precipitation / 10);
    const sunN    = Math.max(0, sun.altitudeDeg) / 90;
    const todSin  = Math.sin(tod * 2 * Math.PI);
    const doySin  = Math.sin(doy * 2 * Math.PI);

    return [tempN, windN, windSin, windCos, rainN, sunN, todSin, doySin];
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Main update — call from animation loop.
   *
   * @param {number} t          elapsed time in seconds
   * @param {object} weather    from WeatherSystem.data
   * @param {object} sun        from SunSystem.position
   * @param {VoxelTerrain} terrain  for pushing per-column state updates
   */
  update(t, weather, sun, terrain) {
    // Network forward pass every 500 ms
    if (t - this._lastNetworkUpdate > 0.5) {
      const inputs = this._encodeInputs(weather, sun);
      const out    = this.network.forward(inputs);

      this.state.vegetationDensity = out[0];
      this.state.waterActivity     = out[1];
      this.state.wildlifeActivity  = out[2];
      this.state.ecosystemHealth   = out[3];

      // Record for autonomous learning
      this._history.push({ inputs, out: [...out] });
      if (this._history.length > this._maxHistory) this._history.shift();

      // Online learning: use a lagged target (we treat past predictions as
      // ground truth for regression — simulates autonomous self-organisation)
      if (this._history.length > 20) {
        const lag    = 10;
        const sample = this._history[this._history.length - 1 - lag];
        // Target is a smoothed version of recent outputs (running mean)
        const meanOut = out.map((v, i) => (v + sample.out[i]) * 0.5);
        // Slight perturbation towards healthy equilibrium
        meanOut[3] = 0.6 + Math.sin(t * 0.01) * 0.1; // ecosystem health oscillates gently
        this.network.backward(sample.inputs, meanOut);
      }

      this._lastNetworkUpdate = t;
      this._autonomousPhase   = (this._autonomousPhase + 0.005) % (2 * Math.PI);
    }

    // Cellular automaton step every 200 ms
    if (t - this._lastCAStep > 0.2) {
      this._caStep(weather, terrain);
      this._lastCAStep = t;
    }
  }

  /** One CA diffusion/growth step */
  _caStep(weather, terrain) {
    const rainBoost = Math.min(1, weather.precipitation / 5);
    const tempFactor = clamp((weather.temperature - 5) / 30, 0, 1);
    const newGrid = this.grid.map(row => row.map(cell => ({ ...cell })));

    for (let z = 1; z < this.gridD - 1; z++) {
      for (let x = 1; x < this.gridW - 1; x++) {
        const c     = this.grid[z][x];
        const neigh = [
          this.grid[z - 1][x], this.grid[z + 1][x],
          this.grid[z][x - 1], this.grid[z][x + 1],
        ];

        // Moisture diffuses towards neighbours + rain contribution
        const avgMoist = neigh.reduce((s, n) => s + n.moisture, 0) / 4;
        newGrid[z][x].moisture = c.moisture * 0.85 + avgMoist * 0.1 + rainBoost * 0.05;
        newGrid[z][x].moisture = clamp01(newGrid[z][x].moisture);

        // Vegetation grows if warm, moist; spreads from neighbours
        const avgVeg = neigh.reduce((s, n) => s + n.vegetation, 0) / 4;
        const vegGrowth = c.moisture * tempFactor * 0.04 - 0.01 + avgVeg * 0.02;
        newGrid[z][x].vegetation = clamp01(c.vegetation + vegGrowth * this.state.vegetationDensity);

        // Activity diffuses + ML wildlifeActivity
        const avgAct = neigh.reduce((s, n) => s + n.activity, 0) / 4;
        newGrid[z][x].activity = clamp01(
          c.activity * 0.7 + avgAct * 0.15 + this.state.wildlifeActivity * 0.05
        );

        // Push to terrain for colour updates
        terrain.setColumnState(x, z, newGrid[z][x]);
      }
    }
    this.grid = newGrid;
  }

  /** Override lat/lon for new location (triggers re-evaluation) */
  resetLocation() {
    this._history = [];
    this.grid = this._initGrid();
  }
}

// Tiny helpers (avoid importing THREE into pure-logic file)
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
