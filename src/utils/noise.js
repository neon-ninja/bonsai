/**
 * Perlin Noise implementation for terrain generation.
 * Provides 2D gradient noise and fractional Brownian motion.
 */
export class Noise2D {
  constructor(seed = 42) {
    this.seed = seed;
    this.perm = this._buildPermutation();
  }

  _buildPermutation() {
    const p = Array.from({ length: 256 }, (_, i) => i);
    // Seeded Fisher–Yates shuffle
    let s = this.seed >>> 0;
    for (let i = 255; i > 0; i--) {
      s = Math.imul(s, 1664525) + 1013904223 >>> 0;
      const j = s % (i + 1);
      [p[i], p[j]] = [p[j], p[i]];
    }
    const perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
    return perm;
  }

  _fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
  _lerp(a, b, t) { return a + t * (b - a); }

  _grad(hash, x, y) {
    const h = hash & 3;
    const u = h < 2 ? x : y;
    const v = h < 2 ? y : x;
    return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
  }

  /** Returns a value roughly in [-1, 1] */
  noise(x, y) {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = this._fade(xf);
    const v = this._fade(yf);
    const aa = this.perm[this.perm[X] + Y];
    const ab = this.perm[this.perm[X] + Y + 1];
    const ba = this.perm[this.perm[X + 1] + Y];
    const bb = this.perm[this.perm[X + 1] + Y + 1];
    return this._lerp(
      this._lerp(this._grad(aa, xf, yf), this._grad(ba, xf - 1, yf), u),
      this._lerp(this._grad(ab, xf, yf - 1), this._grad(bb, xf - 1, yf - 1), u),
      v
    );
  }

  /**
   * Fractional Brownian Motion — stacks octaves for richer detail.
   * @returns value in approximately [-1, 1]
   */
  fbm(x, y, octaves = 5, persistence = 0.5, lacunarity = 2.0) {
    let value = 0, amplitude = 1, frequency = 1, maxVal = 0;
    for (let i = 0; i < octaves; i++) {
      value += amplitude * this.noise(x * frequency, y * frequency);
      maxVal += amplitude;
      amplitude *= persistence;
      frequency *= lacunarity;
    }
    return value / maxVal;
  }
}
