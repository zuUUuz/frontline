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
import { AHRENSFELDE, cardCost, cardKey, cardName } from './data/scenario';
import { Battle } from './sim/battle';
import { SectorView } from './render/sectors';
import { PINNED, menLeft } from './sim/combat';
import { DUELS, setupDuel } from './sim/range';
import { isArtillery, orderFire } from './sim/artillery';
import { SUPPLY_RANGE } from './sim/supply';
import { isJet, jetGoto, jetReturn, jetStrike, launchJet } from './sim/airstrike';

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
  unitLayer.sortableChildren = true; // Luftfahrzeuge über den Bodentruppen

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
  worldTime = () => world.time;
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
    computeViewMap(world.sight, map.size, world.units.filter(u => u.side === 'blue' && !u.dead && !u.carrier && !u.offmap), viewMap);
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
    selected = units.filter(u => !u.dead && !u.carrier && !u.offmap);
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
    $('btn-dismount').hidden = !selected.some(u => u.cargo.length);
    const jets = selected.filter(u => isJet(u) && u.sortie?.phase === 'flying');
    $('btn-jet-bomb').hidden = !jets.some(j => j.weapons[0].ammo > 0);
    $('btn-jet-home').hidden = !jets.length;
    if (!jets.length) bombAim = false;
    $('btn-jet-bomb').setAttribute('aria-pressed', String(bombAim));
    // Nur Jets ausgewählt: Bewegen/Schnell/Stopp/Feuer passen nicht
    const onlyJets = selected.length > 0 && selected.every(isJet);
    for (const id of ['btn-move', 'btn-fast', 'btn-stop']) $(id).hidden = onlyJets;
    const arty = selected.some(isArtillery);
    $('btn-arty-he').hidden = $('btn-arty-smoke').hidden = !arty;
    $('btn-fire').hidden = selected.length > 0 && selected.every(u => isArtillery(u) || isJet(u)); // schießen nur auf Befehl
    if (!arty) aimMode = null;
    $('btn-arty-he').setAttribute('aria-pressed', String(aimMode === 'he'));
    $('btn-arty-smoke').setAttribute('aria-pressed', String(aimMode === 'smoke'));
  };
  let aimMode: 'he' | 'smoke' | null = null; // Artillerie wartet auf den Zielpunkt
  let strikeJet: Unit | null = null;          // Jet wartet auf sein Ziel (Start)
  let bombAim = false;                        // ausgewählter Jet wartet auf das Bombenziel
  let cardUnit: Unit | null = null;
  let cardTimer = 0;
  let feedShown = '';

  // ---------- Spielschleife ----------
  // Ein Fehler in einem Bild darf das Spiel nicht einfrieren: melden und weiterlaufen
  let lastError = 0;
  app.ticker.add(ticker => {
    try { frame(ticker); } catch (err) {
      console.error(err);
      if (performance.now() - lastError > 5000) { lastError = performance.now(); flash(`Fehler: ${(err as Error).message}`, 4000); }
    }
  });
  function frame(ticker: { deltaMS: number }) {
    const dt = Math.min(0.1, ticker.deltaMS / 1000) * speed;
    if (dt > 0) { world.update(dt); battle?.update(dt); }
    if (battle) updateBattleHud(battle);
    if (world.units.length !== views.size) syncViews();
    sectorView?.update(cam.scale);
    fogTimer -= ticker.deltaMS;
    if (fogTimer <= 0) { fogTimer = 400; updateFog(); }
    for (const v of views.values()) v.update(cam.scale, world.time, revealAll);
    drawFx(fx, world, cam.scale, revealAll);
    if (selected.some(u => u.dead || u.carrier)) select(selected);
    // Steckbrief und Gefechtsmeldungen regelmäßig auffrischen
    cardTimer -= ticker.deltaMS;
    if (cardTimer <= 0) {
      cardTimer = 500;
      if (cardUnit) showCard(cardUnit, 1);
      if (selected.length) updateFireButton();
      const recent = world.events.filter(e => e.major && world.time - e.time < 10).slice(-3);
      const html = recent.map(e => `<li class="ev-${e.side}">${e.text}</li>`).join('');
      if (html !== feedShown) { $('feed').innerHTML = html; feedShown = html; }
      $('feed').hidden = !recent.length;
    }
    // Wege der ausgewählten Einheiten
    paths.clear();
    for (const u of selected) {
      // Versorgungs-LKW: Reichweite als Kreis
      if (u.type.supply) paths.circle(u.x, u.y, SUPPLY_RANGE).stroke({ width: 1.5 / cam.scale, color: 0x9be37a, alpha: 0.7 });
      // Jet: Linie zum Flug- bzw. Bombenziel
      if (u.sortie?.phase === 'flying') {
        const s = u.sortie;
        paths.moveTo(u.x, u.y).lineTo(s.tx, s.ty).stroke({ width: 2 / cam.scale, color: s.strike ? 0xff9a3c : 0x9ad0ff, alpha: 0.8 });
        paths.circle(s.tx, s.ty, (s.strike ? 10 : 220) / (s.strike ? cam.scale : 1)).stroke({ width: 1.5 / cam.scale, color: s.strike ? 0xff9a3c : 0x9ad0ff, alpha: 0.6 });
      }
      // Ziel des Feuerauftrags als Fadenkreuz
      if (u.mission) {
        const r = 14 / cam.scale, m = u.mission;
        paths.circle(m.x, m.y, r).moveTo(m.x - r * 1.5, m.y).lineTo(m.x + r * 1.5, m.y).moveTo(m.x, m.y - r * 1.5).lineTo(m.x, m.y + r * 1.5)
          .stroke({ width: 2 / cam.scale, color: m.smoke ? 0xeeeeee : 0xff9a3c, alpha: 0.9 });
      }
      if (!u.path.length) continue;
      paths.moveTo(u.x, u.y);
      for (const p of u.path) paths.lineTo(p.x, p.y);
      paths.stroke({ width: 2 / cam.scale, color: u.fast ? 0xffb347 : 0xffe066, alpha: 0.9 });
      const end = u.path[u.path.length - 1];
      paths.circle(end.x, end.y, 5 / cam.scale).fill({ color: 0xffe066, alpha: 0.9 });
    }
  }

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
    // Luftangriff: Ziel antippen (gesehene Einheit oder Punkt)
    if (strikeJet) {
      const target = world.unitAt(x, y, Math.max(16 / cam.scale, 6), 'red');
      const t = target && (target.spotted || revealAll) ? target : undefined;
      // Gegner angetippt: Angriff; sonst hinfliegen und kreisen (aufklären). Danach ist der Jet ausgewählt.
      const jet = strikeJet;
      if (launchJet(world, jet, t?.x ?? x, t?.y ?? y, !!t, t)) {
        world.note(`[BW] ${jet.type.id} startet → ${t ? 'Angriff auf ' + t.type.id : `Punkt ${Math.round(x)},${Math.round(y)}`}`);
        syncViews();
        flash(`${jet.type.name} fliegt an – ${t ? `Angriff auf ${t.type.name}` : 'kreist über dem Punkt'}`);
        select([jet]);
      }
      strikeJet = null;
      return;
    }
    // Abwurf-Modus eines ausgewählten Jets: Ziel (Gegner oder Punkt) antippen
    if (bombAim) {
      const target = world.unitAt(x, y, Math.max(16 / cam.scale, 6), 'red');
      const t = target && (target.spotted || revealAll) ? target : undefined;
      const jets = selected.filter(isJet);
      const n = jets.filter(j => jetStrike(j, t?.x ?? x, t?.y ?? y, t)).length;
      if (n) world.note(`[BW] Abwurf befohlen auf ${t ? t.type.id : `${Math.round(x)},${Math.round(y)}`}`);
      flash(n ? `Abwurf auf ${t ? t.type.name : 'den Punkt'}` : 'Keine Bomben mehr an Bord');
      bombAim = false;
      updateFireButton();
      return;
    }
    // Feuerauftrag: Zielpunkt antippen (überall, auch ohne Sicht)
    if (aimMode) {
      const smoke = aimMode === 'smoke';
      const guns = selected.filter(isArtillery);
      const n = orderFire(world, guns, x, y, smoke);
      if (n) world.note(`[BW] ${guns.map(g => g.type.id).join(', ')}: ${smoke ? 'Rauch' : 'Feuer'} auf ${Math.round(x)},${Math.round(y)}`);
      flash(n ? `${n === 1 ? guns.find(u => u.mission)!.type.name : `${n} Geschütze`}: ${smoke ? 'Rauch' : 'Feuer'} auf Planquadrat ${'ABCDEFGH'[Math.floor(x / 250)]}${Math.floor(y / 250) + 1}` : 'Kein Feuer: zu nah dran oder keine Munition');
      aimMode = null;
      updateFireButton();
      return;
    }
    const radius = Math.max(16 / cam.scale, 6);
    const own = world.unitAt(x, y, radius, 'blue');
    // Infanterie ausgewählt und eigenen Transporter angetippt: aufsitzen
    const foot = selected.filter(u => u.type.mobility === 'foot');
    if (own && foot.length && foot.length === selected.length && own.type.transport && !selected.includes(own)) {
      const fits = foot.filter(u => world.freeSeats(own) >= Math.ceil(u.hp));
      if (fits.length) { world.boardOrder(fits.slice(0, 1), own); flash(`${fits[0].type.name} steigt in ${own.type.name} ein`); select([]); return; }
      flash(`Kein Platz im ${own.type.name}`);
      return;
    }
    if (own) { select(selected.length === 1 && selected[0] === own ? [] : [own]); return; }
    const enemy = world.unitAt(x, y, radius, 'red');
    if (enemy && (enemy.spotted || revealAll)) {
      // Mit Auswahl: Ziel vorgeben; ohne Auswahl: Steckbrief des Gegners
      if (selected.length) {
        // Jets bombardieren das angetippte Ziel, alle anderen nehmen es ins Visier
        for (const j of selected.filter(isJet)) jetStrike(j, enemy.x, enemy.y, enemy);
        world.attack(selected.filter(u => !isJet(u)), enemy);
        world.note(`[BW] Ziel ${enemy.type.id} für ${selected.map(u => u.type.id).join(', ')}`);
        flash(`Ziel: ${enemy.type.name}`);
      }
      else { cardUnit = enemy; showCard(enemy, 1); }
      return;
    }
    if (selected.length) {
      for (const j of selected.filter(isJet)) jetGoto(j, x, y);
      world.order(selected.filter(u => !isJet(u)), { x, y }, fast);
      return;
    }
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
    select(world.units.filter(u => u.side === 'blue' && !u.carrier && u.x >= a.x && u.x <= b.x && u.y >= a.y && u.y <= b.y));
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
  const aim = (mode: 'he' | 'smoke') => {
    aimMode = aimMode === mode ? null : mode;
    updateFireButton();
    if (aimMode) flash(`${mode === 'he' ? 'Feuer' : 'Rauch'}: Zielpunkt auf der Karte antippen`, 5000);
  };
  $('btn-arty-he').addEventListener('click', () => aim('he'));
  $('btn-arty-smoke').addEventListener('click', () => aim('smoke'));
  $('btn-jet-bomb').addEventListener('click', () => {
    bombAim = !bombAim;
    updateFireButton();
    if (bombAim) flash('Abwurf: Gegner oder Punkt antippen', 5000);
  });
  $('btn-jet-home').addEventListener('click', () => {
    for (const j of selected.filter(isJet)) jetReturn(j);
    flash('Rückkehr zum Aufmunitionieren');
    select([]);
  });
  $('btn-dismount').addEventListener('click', () => {
    // Steht das Fahrzeug, sofort absitzen (auch in der Pause), sonst sobald es angehalten hat
    for (const u of selected) if (u.cargo.length) { if (u.speed < 0.5) world.dismount(u); else u.dismountPending = true; }
    flash('Absitzen');
  });
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
      const t = unitType(c.unit), key = cardKey(c), left = b.left.blue.get(key) ?? 0;
      return `<button class="hud-btn reinf-card" type="button" data-unit="${key}" ${b.canBuy('blue', key) ? '' : 'disabled'}>
        <span class="r-name">${cardName(c)}</span><span class="r-cat">${CATEGORY_NAME[t.category]}</span>
        <span class="r-cost">${cardCost(c)} KP</span><span class="r-left">${left}×</span></button>`;
    }).join('');
    // Eigene Jets: Einsatz befehlen (bereit / im Einsatz / aufmunitionieren)
    const jets = world.units.filter(u => u.side === 'blue' && isJet(u) && !u.dead);
    const air = jets.map(j => {
      const s = j.sortie!;
      const state = s.phase === 'ready' ? 'bereit – Einsatz befehlen' : s.phase === 'rearm' ? `munitioniert auf (${Math.ceil(s.until - world.time)} s)` : 'im Einsatz';
      return `<button class="hud-btn reinf-card air-card" type="button" data-jet="${j.id}" ${s.phase === 'ready' ? '' : 'disabled'}><span class="r-name">✈ ${j.type.name}</span><span class="r-cat">${state}</span></button>`;
    }).join('');
    // Luftwaffe oben: die braucht man im Gefecht am häufigsten
    const full = (air ? `<div class="air-title">Luftwaffe</div>${air}<div class="air-title">Einheiten</div>` : '') + html;
    // Nur bei Änderung neu aufbauen, sonst gehen Fingertipps verloren
    if (full !== reinfShown) { $('reinf-list').innerHTML = full; reinfShown = full; }
  };
  let reinfShown = '';
  $('btn-reinf').addEventListener('click', () => {
    const open = $('reinf').hidden;
    $('reinf').hidden = !open;
    if (open) { select([]); renderReinf(); }
  });
  $('reinf-list').addEventListener('click', e => {
    const jetId = (e.target as HTMLElement).closest<HTMLElement>('[data-jet]')?.dataset.jet;
    if (jetId) {
      strikeJet = world.units.find(u => u.id === Number(jetId) && u.sortie?.phase === 'ready') ?? null;
      $('reinf').hidden = true;
      if (strikeJet) flash(`${strikeJet.type.name}: Ziel antippen (gesehener Gegner oder Punkt)`, 6000);
      return;
    }
    const id = (e.target as HTMLElement).closest<HTMLElement>('[data-unit]')?.dataset.unit;
    if (!id || !battle?.canBuy('blue', id)) return;
    // Jets: sofort kaufen und gleich das Ziel für den ersten Einsatz wählen
    if (unitType(battle.card('blue', id)!.unit).air === 'jet') {
      const jet = battle.buy('blue', id, { x: 0, y: 0 });
      $('reinf').hidden = true;
      if (jet) { syncViews(); strikeJet = jet; flash(`${jet.type.name} bereit: Ziel antippen (gesehener Gegner oder Punkt)`, 7000); }
      return;
    }
    deployId = id;
    $('reinf').hidden = true;
    flash(`Ziel antippen: ${cardName(battle.card('blue', id)!)} kommt vom westlichen Kartenrand`, 6000);
  });
  $('btn-jet').addEventListener('click', () => {
    const jet = world.units.find(u => u.side === 'blue' && isJet(u) && !u.dead && u.sortie?.phase === 'ready');
    if (!jet) { flash('Jet noch nicht bereit'); return; }
    strikeJet = strikeJet === jet ? null : jet;
    if (strikeJet) flash(`${jet.type.name}: Ziel antippen (gesehener Gegner oder Punkt)`, 6000);
  });
  $('btn-level').addEventListener('click', cycleLevel);
  // ---------- Gefechtsbericht: zum Kopieren und Auswerten ----------
  const showReport = () => {
    const b = battle;
    const head = [
      `Frontline – Gefechtsbericht · ${AHRENSFELDE.name} · Schwierigkeit ${LEVELS[level].name} · ${new Date().toLocaleString('de-DE')}`,
      b ? `Ergebnis: ${b.winner === 'blue' ? 'Sieg' : b.winner === 'red' ? 'Niederlage' : 'läuft noch'} · Punkte BW ${Math.floor(b.score.blue)} : RU ${Math.floor(b.score.red)} · Spielzeit ${Math.round(world.time / 60)} min` : 'kein Gefecht (Sandkasten/Schießstand)',
      `Verluste BW: ${world.units.filter(u => u.side === 'blue' && u.dead).map(u => u.type.id).join(', ') || '-'}`,
      `Verluste RU: ${world.units.filter(u => u.side === 'red' && u.dead).map(u => u.type.id).join(', ') || '-'}`,
      b ? b.snapshot() : '',
      '',
    ];
    ($('report-text') as HTMLTextAreaElement).value = [...head, ...world.journal].join('\n');
    $('report').hidden = false;
  };
  $('btn-report').addEventListener('click', () => { $('test-menu').hidden = true; showReport(); });
  $('btn-end-report').addEventListener('click', showReport);
  $('btn-report-close').addEventListener('click', () => { $('report').hidden = true; });
  $('btn-report-copy').addEventListener('click', async () => {
    const ta = $('report-text') as HTMLTextAreaElement;
    try { await navigator.clipboard.writeText(ta.value); flash('Bericht kopiert – einfach im Chat einfügen'); }
    catch {
      // Ohne Zwischenablage-Recht: markieren, dann „Kopieren“ aus dem Menü des Handys
      ta.focus(); ta.select(); ta.setSelectionRange(0, ta.value.length);
      const ok = document.execCommand?.('copy');
      flash(ok ? 'Bericht kopiert – einfach im Chat einfügen' : 'Text ist markiert – lange drücken und „Kopieren“ wählen', 5000);
    }
  });
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
    // Jet-Knopf oben: Stand des (ersten) eigenen Jets
    const jet = world.units.find(u => u.side === 'blue' && isJet(u) && !u.dead);
    $('btn-jet').hidden = !jet;
    if (jet) {
      const s = jet.sortie!;
      $('btn-jet').textContent = s.phase === 'ready' ? '✈ bereit' : s.phase === 'rearm' ? `✈ ${Math.ceil(s.until - world.time)} s` : '✈ fliegt';
      $('btn-jet').setAttribute('aria-pressed', String(strikeJet === jet));
    }
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
let worldTime = () => 0; // Spielzeit für den Steckbrief (wird beim Start gesetzt)
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
  const fire = own && !u.dead && !t.artillery && t.air !== 'jet' ? ` · Feuer ${u.holdFire ? 'halten' : 'frei'}${u.targetId != null ? ' (Ziel)' : ''}` : '';
  const jetInfo = own && u.sortie ? ` · Bomben ${u.weapons[0].ammo}${u.sortie.phase === 'flying' ? ` · Treibstoff ${Math.max(0, Math.ceil(u.sortie.fuelUntil - worldTime()))} s` : ''}` : '';
  const ammo = own && u.sortie ? jetInfo.slice(3) : own ? t.weapons.map((w, i) => `${shortName(w.name)} ${u.weapons[i].ammo}`).join(' · ') + (t.artillery ? ` · Rauch ${u.smokeAmmo}${u.mission ? ` · ${u.mission.smoke ? 'Rauch' : 'Feuer'}auftrag läuft` : ''}` : '') : '';
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
    ${t.supply ? `<p class="ammo">Vorrat ${Math.floor(u.supplyLeft)} von ${t.supply} · versorgt bis ${SUPPLY_RANGE} m (beide stehen)</p>` : ''}
    ${ammo ? `<p class="ammo">${ammo}</p>` : ''}${t.transport ? `<p class="ammo">${u.cargo.length ? `an Bord: ${u.cargo.map(p => `${p.type.name} (${menLeft(p)})`).join(', ')}` : `leer · ${t.transport} Plätze`}</p>` : ''}${details}`;
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
