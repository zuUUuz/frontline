// Einheiten zeichnen wie bei Broken Arrow: weit weg ein NATO-Taktiksymbol (APP-6, vereinfacht),
// nah dran das Fahrzeug von oben bzw. die einzelnen Soldaten.

import { Container, Graphics, Text } from 'pixi.js';
import type { Unit } from '../sim/world';
import type { Category } from '../data/units';
import { PINNED, menLeft } from '../sim/combat';

const SIDE = {
  blue: { frame: 0x80d4ff, edge: 0x0b2a3a, tint: 0x3d8fd1, hull: 0x5b6644 },
  red: { frame: 0xff8a80, edge: 0x3a0b0b, tint: 0xd9473c, hull: 0x5a5b33 },
};
const SELECT = 0xffe066;
const INK = 0x14140f;

// Ab dieser Größe auf dem Bildschirm wird das echte Fahrzeug statt des Symbols gezeigt
const VEHICLE_MIN_PX = 18;
const INFANTRY_MIN_SCALE = 2.2; // Pixel pro Meter

export class UnitView {
  readonly root = new Container();
  private symbol = new Container();
  private symbolGfx = new Graphics();
  private body = new Container();
  private bodyGfx = new Graphics();
  private ring = new Graphics();
  private label: Text;
  private ghostLabel: Text;
  private status = new Graphics(); // Zustand und Unterdrückung als kleine Balken
  private wasDead = false;
  private drawnMen = 0;
  selected = false;

  constructor(readonly unit: Unit) {
    this.drawSymbol();
    this.drawBody();
    this.label = new Text({ text: unit.type.name, style: { fontFamily: 'system-ui, sans-serif', fontSize: 11, fill: 0xf2f2e6, stroke: { color: 0x101010, width: 3 } } });
    this.label.anchor.set(0.5, 0);
    this.label.position.set(0, 13);
    this.ghostLabel = new Text({ text: '', style: { fontFamily: 'system-ui, sans-serif', fontSize: 10, fill: 0xffd0cc, stroke: { color: 0x101010, width: 3 } } });
    this.ghostLabel.anchor.set(0.5, 1);
    this.ghostLabel.position.set(0, -17);
    this.symbol.addChild(this.symbolGfx, this.label, this.ghostLabel);
    this.body.addChild(this.bodyGfx);
    this.root.addChild(this.ring, this.body, this.symbol, this.status);
  }

  // Jedes Bild: Position, Drehung, Detailstufe je Zoom; Gegner nur, wenn entdeckt (sonst Geist)
  update(scale: number, time: number, revealAll: boolean) {
    const u = this.unit, t = u.type;
    if (u.dead && !this.wasDead) this.markDead();
    if (t.mobility === 'foot' && !u.dead && menLeft(u) !== this.drawnMen) this.drawBody(); // Gefallene verschwinden
    // Wracks bleiben liegen; gegnerische nur, wenn man sie schon einmal gesehen hat
    const seen = u.side === 'blue' || u.spotted || revealAll || (!!u.dead && !!u.lastSeen);
    const ghost = !seen && !!u.lastSeen;
    this.root.visible = seen || ghost;
    if (!this.root.visible) return;
    const pos = ghost ? u.lastSeen! : u;
    this.root.position.set(pos.x, pos.y);
    this.root.alpha = ghost ? 0.45 : u.dead ? 0.75 : u.side === 'red' && !u.spotted ? 0.6 : 1;
    this.ghostLabel.text = ghost ? `vor ${formatAge(time - u.lastSeen!.time)}` : '';
    const isFoot = t.mobility === 'foot';
    const close = !ghost && (isFoot ? scale >= INFANTRY_MIN_SCALE : t.length * scale >= VEHICLE_MIN_PX);
    this.body.visible = close;
    this.symbol.visible = !close;
    this.body.rotation = u.heading;
    this.symbol.scale.set(1 / scale);
    this.drawStatus(scale, close, ghost);
    this.ring.clear();
    if (this.selected && !u.dead) {
      if (close) this.ring.circle(0, 0, Math.max(t.length, t.width) * 0.75).stroke({ width: 2 / scale, color: SELECT });
      else this.ring.roundRect(-20 / scale, -15 / scale, 40 / scale, 30 / scale, 3 / scale).stroke({ width: 2.5 / scale, color: SELECT });
    }
  }

  // Balken über der Einheit: grün/gelb/rot = Zustand, orange = Unterdrückung (nur wenn etwas los ist)
  private drawStatus(scale: number, close: boolean, ghost: boolean) {
    const u = this.unit, g = this.status;
    g.clear();
    this.status.scale.set(1 / scale);
    const hurt = u.hp < u.maxHp, supp = u.supp > 3;
    if (u.dead || ghost || (!hurt && !supp && !this.selected)) return;
    const y = close ? -Math.max(u.type.length, u.type.width) * 0.6 * scale - 10 : -22;
    const f = u.hp / u.maxHp;
    g.rect(-15, y, 30, 4).fill(0x101010);
    g.rect(-15, y, 30 * f, 4).fill(f > 0.6 ? 0x6ccf5a : f > 0.3 ? 0xe8c84a : 0xe0503c);
    if (supp) {
      g.rect(-15, y + 5, 30, 3).fill(0x101010);
      g.rect(-15, y + 5, 30 * u.supp / 100, 3).fill(u.supp >= PINNED ? 0xff5a1f : 0xf0a040);
    }
  }

  private markDead() {
    this.wasDead = true;
    this.body.tint = 0x4a4a46;
    this.symbol.tint = 0x777777;
    this.label.text = `${this.unit.type.name} ✕`;
    this.ghostLabel.text = '';
  }

  // ---------- NATO-Symbol ----------
  private drawSymbol() {
    const g = this.symbolGfx, side = this.unit.side, c = SIDE[side];
    if (side === 'blue') {
      g.rect(-15, -10, 30, 20).fill(c.frame).stroke({ width: 2, color: INK });
    } else {
      g.poly([0, -15, 15, 0, 0, 15, -15, 0]).fill(c.frame).stroke({ width: 2, color: INK });
    }
    drawIcon(g, this.unit.type.category, this.unit.type.mobility === 'wheeled', side === 'red' ? 0.7 : 1);
  }

  // ---------- Fahrzeug bzw. Trupp von oben, in Metern, Blick nach rechts ----------
  private drawBody() {
    const g = this.bodyGfx, t = this.unit.type, c = SIDE[this.unit.side];
    const L = t.length, W = t.width;
    g.clear();
    if (t.mobility === 'foot') {
      // Soldaten in lockerer Keilformation
      this.drawnMen = menLeft(this.unit);
      for (let i = 0; i < this.drawnMen; i++) {
        const row = Math.floor((i + 1) / 2), sideSign = i % 2 ? 1 : -1;
        const x = -row * 2.2, y = i === 0 ? 0 : sideSign * (1.2 + row * 0.9);
        g.circle(x, y, 0.6).fill(c.hull).stroke({ width: 0.25, color: c.tint });
      }
      return;
    }
    // Wanne
    if (t.mobility === 'tracked') {
      g.rect(-L / 2, -W / 2, L, W * 0.22).fill(0x2d2d26);
      g.rect(-L / 2, W / 2 - W * 0.22, L, W * 0.22).fill(0x2d2d26);
      g.rect(-L / 2 + 0.2, -W / 2 + W * 0.2, L - 0.4, W * 0.6).fill(c.hull).stroke({ width: 0.12, color: INK });
    } else {
      const axles = L > 7 ? 4 : 2;
      for (let a = 0; a < axles; a++) {
        const x = -L / 2 + 0.9 + (a * (L - 1.8)) / (axles - 1);
        g.rect(x - 0.5, -W / 2 - 0.1, 1, 0.45).fill(0x22221c);
        g.rect(x - 0.5, W / 2 - 0.35, 1, 0.45).fill(0x22221c);
      }
      g.roundRect(-L / 2, -W / 2 + 0.25, L, W - 0.5, 0.5).fill(c.hull).stroke({ width: 0.12, color: INK });
    }
    // Turm und Rohr
    const turret = t.category === 'tank' ? 0.42 : t.category === 'ifv' ? 0.3 : 0;
    if (turret) {
      const tl = L * turret, tw = W * 0.55, tx = t.category === 'tank' ? -L * 0.05 : L * 0.05;
      if (t.gun) g.rect(tx + tl / 2 - 0.2, -0.2, t.gun + 1.2, 0.4).fill(0x1f1f19);
      g.roundRect(tx - tl / 2, -tw / 2, tl, tw, 0.4).fill(shade(c.hull, 1.12)).stroke({ width: 0.12, color: INK });
    } else if (t.category === 'apc' || t.category === 'recon') {
      g.circle(L * 0.05, 0, 0.45).fill(0x2a2a22);
      if (t.gun) g.rect(L * 0.05, -0.08, t.gun + 0.4, 0.16).fill(0x1f1f19);
    }
    // Seitenfarbe als dünner Rand vorn, damit man auch nah dran Freund und Feind unterscheidet
    g.rect(L / 2 - 0.35, -W / 2 + 0.3, 0.35, W - 0.6).fill(c.tint);
  }
}

function formatAge(s: number) {
  return s < 60 ? `${Math.round(s)} s` : `${Math.floor(s / 60)} min`;
}

// Kategoriesymbole nach APP-6 (vereinfacht)
function drawIcon(g: Graphics, cat: Category, wheeled: boolean, k: number) {
  const s = { width: 1.6, color: INK };
  const w = 15 * k, h = 10 * k;
  const X = () => { g.moveTo(-w, -h).lineTo(w, h).moveTo(w, -h).lineTo(-w, h).stroke(s); };
  const track = (sc = 1) => { g.roundRect(-9 * k * sc, -4 * k * sc, 18 * k * sc, 8 * k * sc, 4 * k * sc).stroke(s); };
  const wheels = () => { g.circle(-4 * k, 6 * k, 1.6 * k).circle(4 * k, 6 * k, 1.6 * k).fill(INK); };
  switch (cat) {
    case 'tank': track(); break;
    case 'ifv': X(); track(0.7); break;
    case 'apc': X(); wheels(); break;
    case 'recon': g.moveTo(-w, h).lineTo(w, -h).stroke(s); if (wheeled) wheels(); break;
    case 'infantry': X(); break;
    case 'at': g.moveTo(-w, h).lineTo(0, -h).lineTo(w, h).stroke(s); break;
  }
}

function shade(color: number, f: number) {
  const r = Math.min(255, ((color >> 16) & 255) * f), gg = Math.min(255, ((color >> 8) & 255) * f), b = Math.min(255, (color & 255) * f);
  return (r << 16) | (gg << 8) | b;
}
