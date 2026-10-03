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
import { drawFx } from './render/fx';
import { CATEGORY_NAME, unitType } from './data/units';
import { AHRENSFELDE } from './data/scenario';
import { Battle } from './sim/battle';
import { SectorView } from './render/sectors';
import { PINNED, menLeft } from './sim/combat';
import { DUELS, setupDuel } from './sim/range';

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
  const fx = new Graphics();

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
  const sectorLayer = new Container();
  layers.root.addChild(sectorLayer, fog, paths, unitLayer, fx);
  app.stage.addChild(layers.root);
  const cam = createCamera(app.canvas, layers.root, map.size);

  // ---------- Welt und Einheiten ----------
  const world = new World(buildNav(map), map.size, buildSight(map));
  const views = new Map<number, UnitView>();
  // Ansichten passend zu den Einheiten der Welt halten (Verstärkungen kommen laufend dazu)
  const syncViews = () => {
    const ids = new Set(world.units.map(u => u.id));
    for (const [id, v] of views) if (!ids.has(id)) { v.root.destroy({ children: true }); views.delete(id); }
    for (const u of world.units) {
      if (views.has(u.id)) continue;
      const v = new UnitView(u);
      views.set(u.id, v);
      unitLayer.addChild(v.root);
    }
  };
  const rebuildViews = syncViews;

  // ---------- Gefecht: Sektoren, Punkte, Verstärkung ----------
  let battle: Battle | null = null;
  let sectorView: SectorView | null = null;
  let deployId: string | null = null; // gekaufte Einheit wartet auf ihr Ziel
  const setBattle = (b: Battle | null) => {
    battle = b;
    sectorLayer.removeChildren().forEach(c => c.destroy({ children: true }));
    sectorView = b ? new SectorView(b) : null;
    if (sectorView) sectorLayer.addChild(sectorView.root);
    $('score').hidden = $('btn-reinf').hidden = !b;
    $('map-name').hidden = !!b; // im Gefecht ist oben kein Platz dafür
    $('reinf').hidden = $('end').hidden = true;
    deployId = null;
  };
  // Schwierigkeit: Faktor auf die Kommandopunkte der KI; gemerkt im Browser
  const LEVELS = [{ name: 'Leicht', eco: 0.8 }, { name: 'Normal', eco: 1.3 }, { name: 'Schwer', eco: 1.7 }];
  let level = 1;
  try { const v = Number(localStorage.getItem('fl-level')); if (v >= 0 && v < LEVELS.length) level = v; } catch { /* egal */ }
  const showLevel = () => { for (const id of ['btn-level', 'btn-end-level']) $(id).textContent = `Schwierigkeit: ${LEVELS[level].name}`; };
  const cycleLevel = () => {
    level = (level + 1) % LEVELS.length;
    try { localStorage.setItem('fl-level', String(level)); } catch { /* egal */ }
    showLevel();
    flash(`Schwierigkeit ${LEVELS[level].name} – gilt ab dem nächsten Gefecht`);
  };
  const startBattle = () => {
    world.reset();
    world.wander = false;
    setBattle(new Battle(world, AHRENSFELDE, ['red'], LEVELS[level].eco));
    showLevel();
    syncViews();
    setSpeed(0);
    flash('Pause: Kaufe über „Verstärkung“ deine ersten Einheiten, dann Tempo antippen', 7000);
  };
  // Sandkasten: je Seite 6 Einheiten, die Gegner fahren auf eigene Faust herum und feuern zurück
  const freeBattle = () => {
    world.reset();
    world.wander = true;
    setBattle(null);
    BLUE_UNITS.forEach((id, i) => world.spawn(id, 'blue', BLUE_START.x + (i % 3) * 90, BLUE_START.y + Math.floor(i / 3) * 90, 0));
    RED_UNITS.forEach((id, i) => world.spawn(id, 'red', RED_START.x + (i % 3) * 90, RED_START.y + Math.floor(i / 3) * 90, Math.PI));
    syncViews();
  };

  let selected: Unit[] = [];
  let fast = false;
  let revealAll = false;
  let fogTimer = 0;
  const updateFog = () => {
    computeViewMap(world.sight, map.size, world.units.filter(u => u.side === 'blue' && !u.dead), viewMap);
    for (let i = 0; i < viewMap.length; i++) fogImg.data.set(viewMap[i] ? [0, 0, 0, 0] : [10, 14, 20, 105], i * 4);
    fogCtx.putImageData(fogImg, 0, 0);
    fogTexture.source.update();
  };
  updateFog();
  // Tempo: normal, Zeitlupe, taktische Pause (Befehle gehen auch in der Pause); Zeitraffer nur im Test-Menü
  let speed = 1;
  const setSpeed = (s: number) => {
    speed = s;
    $('btn-speed').textContent = s === 0 ? 'Pause' : s === 0.5 ? 'Zeitlupe' : `Tempo ${s}×`;
    $('btn-speed').setAttribute('aria-pressed', String(s === 0));
    $('btn-fastforward').setAttribute('aria-pressed', String(s === 10));
  };

  function select(units: Unit[]) {
    selected = units.filter(u => !u.dead);
    for (const v of views.values()) v.selected = selected.includes(v.unit);
    $('orders').hidden = selected.length === 0;
    cardUnit = selected.length === 1 ? selected[0] : null;
    showCard(cardUnit, selected.length);
    updateFireButton();
  }
  const updateFireButton = () => {
    const hold = selected.length > 0 && selected.every(u => u.holdFire);
    $('btn-fire').textContent = hold ? 'Feuer halten' : 'Feuer frei';
    $('btn-fire').setAttribute('aria-pressed', String(hold));
  };
  let cardUnit: Unit | null = null;
  let cardTimer = 0;
  let feedShown = '';

  // ---------- Spielschleife ----------
  app.ticker.add(ticker => {
    const dt = Math.min(0.1, ticker.deltaMS / 1000) * speed;
    if (dt > 0) { world.update(dt); battle?.update(dt); }
    if (battle) updateBattleHud(battle);
    if (world.units.length !== views.size) syncViews();
    sectorView?.update(cam.scale);
    fogTimer -= ticker.deltaMS;
    if (fogTimer <= 0) { fogTimer = 400; updateFog(); }
    for (const v of views.values()) v.update(cam.scale, world.time, revealAll);
    drawFx(fx, world, cam.scale, revealAll);
    if (selected.some(u => u.dead)) select(selected);
    // Steckbrief und Gefechtsmeldungen regelmäßig auffrischen
    cardTimer -= ticker.deltaMS;
    if (cardTimer <= 0) {
      cardTimer = 500;
      if (cardUnit) showCard(cardUnit, 1);
      const recent = world.events.filter(e => e.major && world.time - e.time < 10).slice(-3);
      const html = recent.map(e => `<li class="ev-${e.side}">${e.text}</li>`).join('');
      if (html !== feedShown) { $('feed').innerHTML = html; feedShown = html; }
      $('feed').hidden = !recent.length;
    }
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
    if (deployId && battle) {
      const u = battle.buy('blue', deployId, { x: Math.min(map.size - 20, Math.max(20, x)), y: Math.min(map.size - 20, Math.max(20, y)) });
      if (u) { syncViews(); flash(`${u.type.name} rückt an`); }
      deployId = null;
      return;
    }
    const radius = Math.max(16 / cam.scale, 6);
    const own = world.unitAt(x, y, radius, 'blue');
    if (own) { select(selected.length === 1 && selected[0] === own ? [] : [own]); return; }
    const enemy = world.unitAt(x, y, radius, 'red');
    if (enemy && (enemy.spotted || revealAll)) {
      // Mit Auswahl: Ziel vorgeben; ohne Auswahl: Steckbrief des Gegners
      if (selected.length) { world.attack(selected, enemy); flash(`Ziel: ${enemy.type.name}`); }
      else { cardUnit = enemy; showCard(enemy, 1); }
      return;
    }
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
  $('card').addEventListener('pointerdown', e => {
    if (!(e.target as HTMLElement).closest('[data-more]')) return;
    cardDetails = !cardDetails;
    if (cardUnit) showCard(cardUnit, 1);
  });
  $('btn-stop').addEventListener('click', () => { world.stop(selected); for (const u of selected) u.targetId = undefined; });
  $('btn-fire').addEventListener('click', () => {
    const hold = !selected.every(u => u.holdFire);
    for (const u of selected) { u.holdFire = hold; if (hold) u.targetId = undefined; }
    updateFireButton();
    if (cardUnit) showCard(cardUnit, 1);
  });
  $('btn-deselect').addEventListener('click', () => select([]));
  $('btn-speed').addEventListener('click', () => setSpeed(speed === 1 ? 0.5 : speed === 0.5 ? 0 : 1));
  $('btn-fastforward').addEventListener('click', () => setSpeed(speed === 10 ? 1 : 10));

  // ---------- Verstärkung ----------
  const renderReinf = () => {
    if (!battle) return;
    const b = battle;
    const html = AHRENSFELDE.decks.blue.map(c => {
      const t = unitType(c.unit), left = b.left.blue.get(c.unit) ?? 0;
      return `<button class="hud-btn reinf-card" type="button" data-unit="${c.unit}" ${b.canBuy('blue', c.unit) ? '' : 'disabled'}>
        <span class="r-name">${t.name}</span><span class="r-cat">${CATEGORY_NAME[t.category]}</span>
        <span class="r-cost">${t.cost} KP</span><span class="r-left">${left}×</span></button>`;
    }).join('');
    // Nur bei Änderung neu aufbauen, sonst gehen Fingertipps verloren
    if (html !== reinfShown) { $('reinf-list').innerHTML = html; reinfShown = html; }
  };
  let reinfShown = '';
  $('btn-reinf').addEventListener('click', () => {
    const open = $('reinf').hidden;
    $('reinf').hidden = !open;
    if (open) { select([]); renderReinf(); }
  });
  $('reinf-list').addEventListener('click', e => {
    const id = (e.target as HTMLElement).closest<HTMLElement>('[data-unit]')?.dataset.unit;
    if (!id || !battle?.canBuy('blue', id)) return;
    deployId = id;
    $('reinf').hidden = true;
    flash(`Ziel antippen: ${unitType(id).name} kommt vom westlichen Kartenrand`, 6000);
  });
  $('btn-level').addEventListener('click', cycleLevel);
  $('btn-end-level').addEventListener('click', cycleLevel);
  $('btn-end-restart').addEventListener('click', () => { select([]); startBattle(); cam.fit(); });

  let hudTimer = 0;
  function updateBattleHud(b: Battle) {
    hudTimer -= app.ticker.deltaMS;
    if (hudTimer > 0) return;
    hudTimer = 250;
    const win = AHRENSFELDE.winScore;
    $('score-blue').textContent = String(Math.floor(b.score.blue));
    $('score-red').textContent = String(Math.floor(b.score.red));
    $('score-bar-blue').style.width = `${(b.score.blue / win) * 50}%`;
    $('score-bar-red').style.width = `${(b.score.red / win) * 50}%`;
    $('score-sectors').textContent = `Sektoren ${b.held('blue')} : ${b.held('red')} · Ziel ${win}${speed === 0 ? ' · PAUSE' : ''}`;
    $('btn-reinf').textContent = `Verstärkung · ${Math.floor(b.points.blue)} KP`;
    if (!$('reinf').hidden) renderReinf();
    if (b.winner && $('end').hidden) {
      const lost = (side: 'blue' | 'red') => world.units.filter(u => u.side === side && u.dead).length;
      $('end-title').textContent = b.winner === 'blue' ? 'Sieg' : 'Niederlage';
      $('end-text').textContent = `Siegpunkte ${Math.floor(b.score.blue)} : ${Math.floor(b.score.red)} · Verluste ${lost('blue')} eigene, ${lost('red')} gegnerische · Dauer ${Math.round(world.time / 60)} min`;
      $('end').hidden = false;
      setSpeed(0);
    }
  }

  $('btn-test').addEventListener('click', () => {
    const menu = $('test-menu');
    menu.hidden = !menu.hidden || !$('duel-menu').hidden;
    $('duel-menu').hidden = true;
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

  // Schießstand: Duell wählen, die Kamera springt hin
  const duelMenu = $('duel-menu');
  DUELS.forEach(d => {
    const b = document.createElement('button');
    b.className = 'hud-btn';
    b.type = 'button';
    b.textContent = d.name;
    b.addEventListener('click', () => {
      select([]);
      setBattle(null);
      const { center } = setupDuel(world, d);
      rebuildViews();
      setWanderButton();
      const s = app.screen.height / 1400;
      cam.centerOn(center.x + (app.screen.width * 0.2) / s, center.y, s); // Bahn links im Bild
      duelMenu.hidden = true;
      $('test-menu').hidden = true;
      flash(`Schießstand: ${d.name} auf ${d.dist} m`);
    });
    duelMenu.append(b);
  });
  $('btn-range').addEventListener('click', () => { duelMenu.hidden = false; $('test-menu').hidden = true; });
  $('btn-range-back').addEventListener('click', () => { duelMenu.hidden = true; $('test-menu').hidden = false; });
  $('btn-battle').addEventListener('click', () => {
    select([]);
    freeBattle();
    setWanderButton();
    $('test-menu').hidden = true;
    cam.fit();
    flash('Sandkasten: je 6 Einheiten, die Gegner fahren herum und feuern zurück');
  });
  $('btn-newbattle').addEventListener('click', () => {
    select([]);
    $('test-menu').hidden = true;
    startBattle();
    setWanderButton();
    cam.fit();
  });
  const setWanderButton = () => $('btn-wander').setAttribute('aria-pressed', String(world.wander));

  $('btn-raster').addEventListener('click', () => {
    layers.raster.visible = !layers.raster.visible;
    $('btn-raster').setAttribute('aria-pressed', String(layers.raster.visible));
  });
  $('btn-fit').addEventListener('click', () => cam.fit());
  cam.fit();
  startBattle();

  // Nur im Entwicklungsmodus: Zugriff für automatische Tests
  if (import.meta.env.DEV) Object.assign(window, { fl: { world, cam, select, rebuildViews, get battle() { return battle; } } });
}

// ---------- Steckbrief ----------
// Kompakt: Name, Zustand, Feuer, Munition. Alle Werte erst über „Details“.
let cardDetails = false;
let cardShown = '';
function showCard(u: Unit | null, _count: number) {
  const card = $('card');
  if (!u) { card.hidden = true; cardShown = ''; return; } // bei Mehrfachauswahl reicht die Befehlsleiste
  const t = u.type, a = t.armor, foot = t.mobility === 'foot', own = u.side === 'blue';
  const state = u.dead ? (foot ? 'aufgerieben' : 'zerstört')
    : foot ? `${menLeft(u)}/${t.men} Mann` : `${Math.round((u.hp / u.maxHp) * 100)} %`;
  const supp = u.dead ? '' : u.retreating ? ' · zieht sich zurück' : u.supp >= PINNED ? ' · niedergehalten' : u.supp > 3 ? ` · unterdrückt ${Math.round(u.supp)}` : '';
  const fire = own && !u.dead ? ` · Feuer ${u.holdFire ? 'halten' : 'frei'}${u.targetId != null ? ' (Ziel)' : ''}` : '';
  const ammo = own ? t.weapons.map((w, i) => `${shortName(w.name)} ${u.weapons[i].ammo}`).join(' · ') : '';
  const details = cardDetails ? `
    <dl>
      <dt>Tempo</dt><dd>${t.roadSpeed} km/h Straße, ${t.offroadSpeed} km/h Gelände</dd>
      <dt>Besatzung</dt><dd>${t.men}${t.transport ? ` + ${t.transport} Plätze` : ''}</dd>
      <dt>Panzerung</dt><dd>${foot ? 'keine' : `vorn ${a.front} · Seite ${a.side} · Heck ${a.rear} · Dach ${a.top} mm`}</dd>
      <dt>Sichtweite</dt><dd>${(t.optics / 1000).toLocaleString('de-DE')} km</dd>
    </dl>
    <ul>${t.weapons.map((w, i) => `<li>${w.name}: ${(w.range / 1000).toLocaleString('de-DE')} km, Durchschlag ${w.penetration} mm${w.topAttack ? ' (von oben)' : ''}${own ? ` · ${u.weapons[i].ammo}/${w.ammo}` : ''}</li>`).join('')}</ul>` : '';
  const html = `
    <h2><span class="side-${u.side}">■</span> ${t.name} <button class="card-more" type="button" data-more>${cardDetails ? 'weniger' : 'Details'}</button></h2>
    <p class="sub">${CATEGORY_NAME[t.category]} · ${state}${supp}${fire}</p>
    ${ammo ? `<p class="ammo">${ammo}</p>` : ''}${details}`;
  card.hidden = false;
  if (html === cardShown) return; // nur bei Änderung neu aufbauen, sonst gehen Fingertipps verloren
  cardShown = html;
  card.innerHTML = html;
}
function shortName(name: string) {
  return name.replace(/\s*\(.*\)/, '').replace(/^(\d+ mm).*$/, '$1').replace(/ \/.*$/, '');
}

let flashTimer = 0;
function flash(text: string, ms = 3000) {
  const info = $('info');
  info.textContent = text;
  info.hidden = false;
  clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => { info.hidden = true; }, ms);
}

start().catch(err => {
  $('map-name').textContent = `Fehler: ${err.message}`;
  console.error(err);
});
