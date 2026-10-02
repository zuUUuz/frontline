import './ui/style.css';
import { Application, Container, Graphics, Sprite, Texture } from 'pixi.js';
import { loadMap } from './map/load';
import { drawMap } from './map/render';
import { TERRAIN_INFO } from './map/terrain';
import { createCamera } from './ui/camera';
import { buildNav } from './sim/nav';
import { World, Unit } from './sim/world';
import { buildSight, computeViewMap, VIEW_CELL } from './sim/vision';
import { UnitView } from './render/units';
import { CATEGORY_NAME } from './data/units';

const $ = (id: string) => document.getElementById(id)!;
const MAP_ID = 'ahrensfelde';

// Startaufstellung für den Test: Bundeswehr im Westen auf den Wiesen, Russland im Nordosten
const BLUE_START = { x: 230, y: 650 };
const RED_START = { x: 1700, y: 520 };
const BLUE_UNITS = ['leopard2a7', 'puma', 'boxer', 'fennek', 'pzgren', 'mells'];
const RED_UNITS = ['t90m', 'bmp3', 'btr82a', 'tigr', 'motostrelki', 'kornet'];

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
  const paths = new Graphics();
  const unitLayer = new Container();

  // Nebel des Krieges wie bei Broken Arrow: was eigene Einheiten sehen, bleibt hell, der Rest wird leicht abgedunkelt
  const fogN = Math.ceil(map.size / VIEW_CELL);
  const fogCanvas = document.createElement('canvas');
  fogCanvas.width = fogCanvas.height = fogN;
  const fogCtx = fogCanvas.getContext('2d')!;
  const fogImg = fogCtx.createImageData(fogN, fogN);
  const fogTexture = Texture.from(fogCanvas);
  const fog = new Sprite(fogTexture);
  fog.width = fog.height = fogN * VIEW_CELL;
  const viewMap = new Uint8Array(fogN * fogN);
  layers.root.addChild(fog, paths, unitLayer);
  app.stage.addChild(layers.root);
  const cam = createCamera(app.canvas, layers.root, map.size);

  // ---------- Welt und Einheiten ----------
  const world = new World(buildNav(map), map.size, buildSight(map));
  BLUE_UNITS.forEach((id, i) => world.spawn(id, 'blue', BLUE_START.x + (i % 3) * 90, BLUE_START.y + Math.floor(i / 3) * 90, 0));
  RED_UNITS.forEach((id, i) => world.spawn(id, 'red', RED_START.x + (i % 3) * 90, RED_START.y + Math.floor(i / 3) * 90, Math.PI));
  const views = new Map<number, UnitView>();
  for (const u of world.units) {
    const v = new UnitView(u);
    views.set(u.id, v);
    unitLayer.addChild(v.root);
  }

  let selected: Unit[] = [];
  let fast = false;
  let revealAll = false;
  let fogTimer = 0;
  const updateFog = () => {
    computeViewMap(world.sight, map.size, world.units.filter(u => u.side === 'blue'), viewMap);
    for (let i = 0; i < viewMap.length; i++) fogImg.data.set(viewMap[i] ? [0, 0, 0, 0] : [10, 14, 20, 105], i * 4);
    fogCtx.putImageData(fogImg, 0, 0);
    fogTexture.source.update();
  };
  updateFog();
  const SPEEDS = [1, 3, 10, 0];
  let speedIndex = 0;

  function select(units: Unit[]) {
    selected = units;
    for (const v of views.values()) v.selected = selected.includes(v.unit);
    $('orders').hidden = selected.length === 0;
    showCard(selected.length === 1 ? selected[0] : null, selected.length);
  }

  // ---------- Spielschleife ----------
  app.ticker.add(ticker => {
    const dt = Math.min(0.1, ticker.deltaMS / 1000) * SPEEDS[speedIndex];
    if (dt > 0) world.update(dt);
    fogTimer -= ticker.deltaMS;
    if (fogTimer <= 0) { fogTimer = 400; updateFog(); }
    for (const v of views.values()) v.update(cam.scale, world.time, revealAll);
    // Wege der ausgewählten Einheiten
    paths.clear();
    for (const u of selected) {
      if (!u.path.length) continue;
      paths.moveTo(u.x, u.y);
      for (const p of u.path) paths.lineTo(p.x, p.y);
      paths.stroke({ width: 2 / cam.scale, color: u.fast ? 0xffb347 : 0xffe066, alpha: 0.9 });
      const end = u.path[u.path.length - 1];
      paths.circle(end.x, end.y, 5 / cam.scale).fill({ color: 0xffe066, alpha: 0.9 });
    }
    if (selected.length === 1) updateCardSpeed(selected[0]);
  });

  // ---------- Maßstab ----------
  cam.onChange = () => {
    const target = 90 / cam.scale;
    const nice = [5, 10, 20, 50, 100, 200, 250, 500, 1000].find(v => v >= target) ?? 1000;
    $('scale-bar').style.width = `${nice * cam.scale}px`;
    $('scale-label').textContent = nice >= 1000 ? `${nice / 1000} km` : `${nice} m`;
  };

  // ---------- Antippen: Einheit wählen, Ziel setzen oder Gelände zeigen ----------
  cam.onTap = (x, y) => {
    const radius = Math.max(16 / cam.scale, 6);
    const own = world.unitAt(x, y, radius, 'blue');
    if (own) { select(selected.length === 1 && selected[0] === own ? [] : [own]); return; }
    const enemy = world.unitAt(x, y, radius, 'red');
    if (enemy && (enemy.spotted || revealAll)) { showCard(enemy, 1); return; }
    if (selected.length) { world.order(selected, { x, y }, fast); return; }
    if (x < 0 || y < 0 || x > map.size || y > map.size) return;
    const t = TERRAIN_INFO[map.terrainAt(x, y)];
    flash(`${t.name}: ${t.cover} · Planquadrat ${'ABCDEFGH'[Math.floor(x / 250)]}${Math.floor(y / 250) + 1}`);
  };

  // ---------- Auswahlrahmen ----------
  const boxLayer = $('box-layer'), box = $('box');
  let boxStart: { x: number; y: number } | null = null;
  const setBoxMode = (on: boolean) => {
    boxLayer.hidden = !on;
    cam.enabled = !on;
    $('btn-box').setAttribute('aria-pressed', String(on));
  };
  $('btn-box').addEventListener('click', () => setBoxMode(boxLayer.hidden !== false));
  boxLayer.addEventListener('pointerdown', e => {
    boxLayer.setPointerCapture(e.pointerId);
    boxStart = { x: e.clientX, y: e.clientY };
    Object.assign(box.style, { left: `${e.clientX}px`, top: `${e.clientY}px`, width: '0px', height: '0px' });
    box.hidden = false;
  });
  boxLayer.addEventListener('pointermove', e => {
    if (!boxStart) return;
    Object.assign(box.style, {
      left: `${Math.min(boxStart.x, e.clientX)}px`, top: `${Math.min(boxStart.y, e.clientY)}px`,
      width: `${Math.abs(e.clientX - boxStart.x)}px`, height: `${Math.abs(e.clientY - boxStart.y)}px`,
    });
  });
  boxLayer.addEventListener('pointerup', e => {
    if (!boxStart) return;
    const r = app.canvas.getBoundingClientRect();
    const a = cam.toWorld(Math.min(boxStart.x, e.clientX) - r.left, Math.min(boxStart.y, e.clientY) - r.top);
    const b = cam.toWorld(Math.max(boxStart.x, e.clientX) - r.left, Math.max(boxStart.y, e.clientY) - r.top);
    select(world.units.filter(u => u.side === 'blue' && u.x >= a.x && u.x <= b.x && u.y >= a.y && u.y <= b.y));
    boxStart = null;
    box.hidden = true;
    setBoxMode(false);
  });

  // ---------- Befehle ----------
  const setFast = (on: boolean) => {
    fast = on;
    $('btn-move').setAttribute('aria-pressed', String(!on));
    $('btn-fast').setAttribute('aria-pressed', String(on));
  };
  $('btn-move').addEventListener('click', () => setFast(false));
  $('btn-fast').addEventListener('click', () => setFast(true));
  $('btn-stop').addEventListener('click', () => world.stop(selected));
  $('btn-deselect').addEventListener('click', () => select([]));
  $('btn-speed').addEventListener('click', () => {
    speedIndex = (speedIndex + 1) % SPEEDS.length;
    $('btn-speed').textContent = SPEEDS[speedIndex] ? `Tempo ${SPEEDS[speedIndex]}×` : 'Pause';
  });

  $('btn-test').addEventListener('click', () => {
    const menu = $('test-menu');
    menu.hidden = !menu.hidden;
    $('btn-test').setAttribute('aria-expanded', String(!menu.hidden));
  });
  $('btn-reveal').addEventListener('click', () => {
    revealAll = !revealAll;
    $('btn-reveal').setAttribute('aria-pressed', String(revealAll));
  });
  $('btn-wander').addEventListener('click', () => {
    world.wander = !world.wander;
    $('btn-wander').setAttribute('aria-pressed', String(world.wander));
  });

  $('btn-raster').addEventListener('click', () => {
    layers.raster.visible = !layers.raster.visible;
    $('btn-raster').setAttribute('aria-pressed', String(layers.raster.visible));
  });
  $('btn-fit').addEventListener('click', () => cam.fit());
  cam.fit();

  // Nur im Entwicklungsmodus: Zugriff für automatische Tests
  if (import.meta.env.DEV) Object.assign(window, { fl: { world, cam, select } });
}

// ---------- Steckbrief ----------
function showCard(u: Unit | null, count: number) {
  const card = $('card');
  if (!u) {
    card.hidden = count === 0;
    card.innerHTML = count ? `<h2>${count} Einheiten ausgewählt</h2><p class="sub">Ziel antippen zum Bewegen</p>` : '';
    return;
  }
  const t = u.type, a = t.armor;
  card.innerHTML = `
    <h2>${t.name}</h2>
    <p class="sub"><span class="side-${u.side}">${u.side === 'blue' ? 'Bundeswehr' : 'Russland'}</span> · ${CATEGORY_NAME[t.category]}</p>
    <dl>
      <dt>Tempo</dt><dd>${t.roadSpeed} km/h Straße, ${t.offroadSpeed} km/h Gelände</dd>
      <dt>Gerade</dt><dd id="card-speed">steht</dd>
      <dt>Besatzung</dt><dd>${t.men}${t.transport ? ` + ${t.transport} Plätze` : ''}</dd>
      <dt>Panzerung</dt><dd>${t.mobility === 'foot' ? 'keine' : `vorn ${a.front} · Seite ${a.side} · Heck ${a.rear} mm`}</dd>
      <dt>Sichtweite</dt><dd>${(t.optics / 1000).toLocaleString('de-DE')} km</dd>
    </dl>
    <ul>${t.weapons.map(w => `<li>${w.name}: ${(w.range / 1000).toLocaleString('de-DE')} km, Durchschlag ${w.penetration} mm</li>`).join('')}</ul>`;
  card.hidden = false;
}
function updateCardSpeed(u: Unit) {
  const el = document.getElementById('card-speed');
  if (el) el.textContent = u.speed > 0.1 ? `${Math.round(u.speed * 3.6)} km/h${u.fast ? ' (schnell)' : ''}` : 'steht';
}

let flashTimer = 0;
function flash(text: string) {
  const info = $('info');
  info.textContent = text;
  info.hidden = false;
  clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => { info.hidden = true; }, 3000);
}

start().catch(err => {
  $('map-name').textContent = `Fehler: ${err.message}`;
  console.error(err);
});
