// Sektoren auf der Karte: zarte Fläche in der Farbe des Besitzers, kräftige Grenzen, Name in der Mitte.

import { Container, Sprite, Text, Texture } from 'pixi.js';
import { Battle, SECTOR_CELL } from '../sim/battle';

const COLOR = { blue: [70, 150, 230], red: [220, 70, 60], none: [235, 235, 220] };

export class SectorView {
  readonly root = new Container();
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private img: ImageData;
  private texture: Texture;
  private labels: Text[] = [];
  private lastKey = '';

  constructor(readonly battle: Battle) {
    const n = battle.n;
    this.canvas.width = this.canvas.height = n;
    this.ctx = this.canvas.getContext('2d')!;
    this.img = this.ctx.createImageData(n, n);
    this.texture = Texture.from(this.canvas);
    const sprite = new Sprite(this.texture);
    sprite.width = sprite.height = n * SECTOR_CELL;
    this.root.addChild(sprite);
    for (const s of battle.sectors) {
      const t = new Text({ text: s.name, style: { fontFamily: 'system-ui, sans-serif', fontSize: 11, fontWeight: '700', fill: 0xf4f4e8, stroke: { color: 0x101010, width: 4 }, align: 'center' } });
      t.anchor.set(0.5);
      t.position.set(s.x, s.y);
      this.labels.push(t);
      this.root.addChild(t);
    }
  }

  update(scale: number) {
    const b = this.battle;
    b.sectors.forEach((s, i) => {
      const t = this.labels[i];
      t.scale.set(1 / scale);
      const state = s.contested ? 'umkämpft' : s.capturer ? `${s.capturer === 'blue' ? 'wir nehmen' : 'Gegner nimmt'} ${Math.round(s.progress * 100)} %` : s.owner === 'blue' ? 'unser' : s.owner === 'red' ? 'Gegner' : 'neutral';
      // Status nur zeigen, wenn dort etwas passiert
      t.text = s.contested || s.capturer ? `${s.name}\n${state}` : s.name;
      t.alpha = s.contested || s.capturer ? 1 : 0.75;
      t.style.fill = s.owner === 'blue' ? 0xb8e0ff : s.owner === 'red' ? 0xffc0b8 : 0xf4f4e8;
    });
    // Fläche nur neu malen, wenn sich Besitz oder Kampflage ändert
    const key = b.sectors.map(s => `${s.owner}${s.contested}`).join();
    if (key === this.lastKey) return;
    this.lastKey = key;
    const n = b.n, d = this.img.data;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = b.sectorOf[j * n + i], s = b.sectors[k];
      const edge = (i > 0 && b.sectorOf[j * n + i - 1] !== k) || (j > 0 && b.sectorOf[(j - 1) * n + i] !== k)
        || (i < n - 1 && b.sectorOf[j * n + i + 1] !== k) || (j < n - 1 && b.sectorOf[(j + 1) * n + i] !== k);
      const c = COLOR[s.owner ?? 'none'];
      const stripe = s.contested && (i + j) % 6 < 3;
      const a = edge ? 150 : s.owner ? (stripe ? 20 : 38) : 0;
      d.set([c[0], c[1], c[2], a], (j * n + i) * 4);
    }
    this.ctx.putImageData(this.img, 0, 0);
    this.texture.source.update();
  }
}
