import './ui/style.css';
import { Application } from 'pixi.js';
import { loadMap } from './map/load';
import { drawMap } from './map/render';
import { TERRAIN_INFO } from './map/terrain';
import { createCamera } from './ui/camera';

const $ = (id: string) => document.getElementById(id)!;
const MAP_ID = 'ahrensfelde';

async function start() {
  const app = new Application();
  await app.init({
    resizeTo: $('map'), antialias: true, autoDensity: true,
    resolution: Math.min(window.devicePixelRatio || 1, 3), background: 0x1b1f1a,
  });
  $('map').append(app.canvas);

  const map = await loadMap(MAP_ID);
  $('map-name').textContent = `${map.name} · ${map.size / 1000} × ${map.size / 1000} km`;
  $('attribution').textContent = map.attribution;

  const layers = drawMap(map);
  app.stage.addChild(layers.root);
  const cam = createCamera(app.canvas, layers.root, map.size);

  // Maßstab: ein glatter Wert, der etwa 90 Pixel breit ist
  cam.onChange = () => {
    const target = 90 / cam.scale;
    const nice = [5, 10, 20, 50, 100, 200, 250, 500, 1000].find(v => v >= target) ?? 1000;
    $('scale-bar').style.width = `${nice * cam.scale}px`;
    $('scale-label').textContent = nice >= 1000 ? `${nice / 1000} km` : `${nice} m`;
  };

  // Tipp auf die Karte: Gelände an der Stelle anzeigen
  let infoTimer = 0;
  cam.onTap = (x, y) => {
    if (x < 0 || y < 0 || x > map.size || y > map.size) return;
    const t = TERRAIN_INFO[map.terrainAt(x, y)];
    const info = $('info');
    info.textContent = `${t.name}: ${t.cover} · Planquadrat ${'ABCDEFGH'[Math.floor(x / 250)]}${Math.floor(y / 250) + 1}`;
    info.hidden = false;
    clearTimeout(infoTimer);
    infoTimer = window.setTimeout(() => { info.hidden = true; }, 3000);
  };

  $('btn-raster').addEventListener('click', () => {
    layers.raster.visible = !layers.raster.visible;
    $('btn-raster').setAttribute('aria-pressed', String(layers.raster.visible));
  });
  $('btn-fit').addEventListener('click', () => cam.fit());
  cam.fit();
}

start().catch(err => {
  $('map-name').textContent = `Fehler: ${err.message}`;
});
