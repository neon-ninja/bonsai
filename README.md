# Bonsai — Living Land Model

An interactive 3D voxel land model driven by real-time environmental data and a self-organising machine-learning ecosystem engine.

## Features

| Feature | Implementation |
|---|---|
| **3D voxel terrain** | 32 × 32 column grid rendered with Three.js `InstancedMesh` |
| **Rotate & zoom** | Three.js `OrbitControls` (mouse / touch / trackpad) |
| **Automated fly-through** | Smooth camera tour of 8 viewpoints; auto-starts after 20 s idle |
| **Real-time sun position** | Astronomical formulae (NOAA Solar Calculator) for any lat/lon |
| **Live weather data** | [Open-Meteo](https://open-meteo.com/) — temperature, wind, precipitation, cloud cover, soil temperature |
| **Rain particles** | 1 200 point particles, intensity / speed tracks precipitation |
| **Wind particles** | 400 point particles, direction / strength tracks wind data |
| **Atmospheric fog** | Fog density tracks cloud cover + rain |
| **ML ecosystem engine** | 3-layer feedforward neural network (8 → 16 → 8 → 4) with online back-propagation |
| **Cellular automaton** | Moisture, vegetation and wildlife activity diffuse spatially between voxels |
| **Voxel colour dynamics** | Temperature tint, rain darkening, vegetation health, ecosystem vibrancy — all data-driven |
| **Procedural audio** | Web Audio API: wind (pink noise), rain (layered white noise), birdsong (FM synthesis), river (low-pass rumble) |
| **Data panel** | Live overlay: time, sun altitude, temperature, wind, precipitation, ML state |
| **Time-warp slider** | Speed up the simulation 1× – 200× to observe seasonal / diurnal cycles |
| **Geolocation** | Automatically uses your device location if permission is granted |

## Running locally

Install dependencies once, then start the development server:

```bash
npm install
npm start        # Vite dev server on http://localhost:8080
```

Or with other tools:

```bash
# Python 3 (no install)
python -m http.server 8080
# Note: plain file server won't resolve bare 'three' imports.
# Use npm start / Vite for the best experience.
```

Then open **http://localhost:8080** in a modern browser (Chrome, Firefox, Edge, Safari 16+).

## Controls

| Input | Action |
|---|---|
| Left-drag / one-finger drag | Rotate camera |
| Right-drag / two-finger drag | Pan camera |
| Scroll / pinch | Zoom in / out |
| **✈ Auto Tour** button | Toggle automated fly-through |
| **📊 Data** button | Toggle data panel |
| 🔊 slider | Master volume |
| ⏩ Time slider | Time-warp multiplier (1× – 200×) |
| Click overlay | Start audio (required by browser autoplay policy) |

## Architecture

```
src/
├── main.js             — scene setup, render loop, system coordination
├── VoxelTerrain.js     — terrain generation (Perlin FBM) + InstancedMesh rendering
├── SunSystem.js        — real-time solar position, sky colour, directional light
├── WeatherSystem.js    — Open-Meteo API client, rain/wind particles, fog
├── EcosystemML.js      — neural network + cellular automaton ecosystem engine
├── AudioManager.js     — Web Audio API: wind, rain, birdsong, river synthesis
├── CameraController.js — OrbitControls + automated fly-through
├── DataPanel.js        — live data overlay UI
└── utils/
    └── noise.js        — 2D Perlin noise + fractional Brownian motion
```

## Data sources

- **Weather** — [Open-Meteo](https://open-meteo.com/) (free, no API key, globally available)
- **Sun position** — computed client-side using standard astronomical formulae
- **Soil temperature** — Open-Meteo hourly `soil_temperature_0cm`
- **Audio** — fully synthesised using the Web Audio API (no external sound files)

## Extending the model

To add new real-world data streams (e.g. river flow, bird survey, soil carbon):

1. Add a fetch call in `WeatherSystem.js` (or create a new module)
2. Pass the data into `EcosystemML.update()` — extend the input vector in `_encodeInputs()`
3. Map outputs to visual / audio changes in `VoxelTerrain.updateColours()` or `AudioManager.update()`
