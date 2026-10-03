// Einheitenkatalog. Werte nach öffentlichen Quellen, gerundet und für die Spielbalance vereinfacht.
// Panzerung und Durchschlag in mm Panzerstahl-Äquivalent (grobe Schätzwerte, KE-Wirkung).
// Neue Einheit = neuer Eintrag hier.

export type Faction = 'bw' | 'ru';
export type Category = 'tank' | 'ifv' | 'apc' | 'recon' | 'infantry' | 'at';
export type Mobility = 'tracked' | 'wheeled' | 'foot';

export interface Weapon {
  name: string;
  kind: 'ke' | 'heat' | 'atgm' | 'autocannon' | 'mg' | 'rifle';
  range: number;       // wirksame Reichweite in m
  penetration: number; // mm
  reload: number;      // Sekunden zwischen zwei Schüssen bzw. Feuerstößen
  ammo: number;        // Schuss bzw. Feuerstöße an Bord
  speed: number;       // Fluggeschwindigkeit in m/s (Lenkraketen sichtbar langsam)
  guided?: 'saclos' | 'fnf'; // Lenkrakete: muss bis zum Einschlag gelenkt werden bzw. „Fire and Forget“
  topAttack?: boolean; // Lenkrakete greift von oben an (trifft die dünne Dachpanzerung)
  mount?: string;      // Waffen mit gleicher Lafette teilen sich das Nachladen (Rohr und Rohrrakete)
}

export interface UnitType {
  id: string;
  name: string;
  faction: Faction;
  category: Category;
  mobility: Mobility;
  roadSpeed: number;   // km/h auf Straße
  offroadSpeed: number; // km/h im Gelände
  length: number;      // m (Fahrzeugwanne); bei Infantrie Breite der Gruppe
  width: number;       // m
  men: number;         // Besatzung bzw. Gruppenstärke
  armor: { front: number; side: number; rear: number; top: number };
  optics: number;      // Sichtweite in m
  cost: number;        // Kommandopunkte
  weapons: Weapon[];
  transport?: number;  // Plätze für absitzende Infanterie
  gun?: number;        // Rohrlänge über die Wanne hinaus (für die Zeichnung)
}

export const UNIT_TYPES: UnitType[] = [
  // ---------- Bundeswehr ----------
  {
    id: 'leopard2a7', name: 'Leopard 2A7', faction: 'bw', category: 'tank', mobility: 'tracked',
    roadSpeed: 68, offroadSpeed: 45, length: 7.7, width: 3.8, men: 4, gun: 3.2,
    armor: { front: 900, side: 120, rear: 60, top: 40 }, cost: 160, optics: 2600,
    weapons: [
      { name: '120 mm L55 (DM73)', kind: 'ke', range: 4000, penetration: 800, reload: 7, ammo: 42, speed: 1700 },
      { name: 'MG3', kind: 'mg', range: 800, penetration: 5, reload: 2, ammo: 120, speed: 850 },
    ],
  },
  {
    id: 'puma', name: 'Puma', faction: 'bw', category: 'ifv', mobility: 'tracked',
    roadSpeed: 70, offroadSpeed: 45, length: 7.6, width: 3.9, men: 3, gun: 1.2, transport: 6,
    armor: { front: 110, side: 45, rear: 30, top: 25 }, cost: 110, optics: 2400,
    weapons: [
      { name: '30 mm MK30-2/ABM', kind: 'autocannon', range: 3000, penetration: 110, reload: 1.5, ammo: 40, speed: 1100 },
      { name: 'MELLS (Spike-LR)', kind: 'atgm', range: 4000, penetration: 700, reload: 8, ammo: 2, speed: 180, guided: 'fnf', topAttack: true },
      { name: 'MG4', kind: 'mg', range: 800, penetration: 5, reload: 2, ammo: 120, speed: 850 },
    ],
  },
  {
    id: 'boxer', name: 'Boxer GTK', faction: 'bw', category: 'apc', mobility: 'wheeled',
    roadSpeed: 103, offroadSpeed: 60, length: 7.9, width: 3.0, men: 3, transport: 8,
    armor: { front: 40, side: 30, rear: 20, top: 15 }, cost: 60, optics: 1800,
    weapons: [{ name: '12,7 mm FLW 200', kind: 'mg', range: 1500, penetration: 20, reload: 2.5, ammo: 60, speed: 900 }],
  },
  {
    id: 'fennek', name: 'Fennek', faction: 'bw', category: 'recon', mobility: 'wheeled',
    roadSpeed: 115, offroadSpeed: 65, length: 5.6, width: 2.5, men: 3,
    armor: { front: 12, side: 10, rear: 8, top: 5 }, cost: 45, optics: 3600,
    weapons: [{ name: '12,7 mm M3M', kind: 'mg', range: 1500, penetration: 20, reload: 2.5, ammo: 60, speed: 900 }],
  },
  {
    id: 'pzgren', name: 'Panzergrenadiere', faction: 'bw', category: 'infantry', mobility: 'foot',
    roadSpeed: 7, offroadSpeed: 5, length: 12, width: 6, men: 6,
    armor: { front: 0, side: 0, rear: 0, top: 0 }, cost: 35, optics: 1200,
    weapons: [
      { name: 'G95 (HK416)', kind: 'rifle', range: 400, penetration: 2, reload: 1.5, ammo: 150, speed: 900 },
      { name: 'MG5', kind: 'mg', range: 800, penetration: 5, reload: 2, ammo: 80, speed: 850 },
      { name: 'Panzerfaust 3', kind: 'heat', range: 400, penetration: 700, reload: 8, ammo: 3, speed: 220 },
    ],
  },
  {
    id: 'mells', name: 'MELLS-Trupp', faction: 'bw', category: 'at', mobility: 'foot',
    roadSpeed: 6, offroadSpeed: 4, length: 6, width: 4, men: 3,
    armor: { front: 0, side: 0, rear: 0, top: 0 }, cost: 55, optics: 2200,
    weapons: [{ name: 'MELLS (Spike-LR)', kind: 'atgm', range: 4000, penetration: 700, reload: 15, ammo: 6, speed: 180, guided: 'fnf', topAttack: true }],
  },

  // ---------- Russland ----------
  {
    id: 't90m', name: 'T-90M', faction: 'ru', category: 'tank', mobility: 'tracked',
    roadSpeed: 60, offroadSpeed: 45, length: 6.9, width: 3.8, men: 3, gun: 2.6,
    armor: { front: 800, side: 110, rear: 50, top: 35 }, cost: 150, optics: 2400,
    weapons: [
      { name: '125 mm 2A46M-5 (3BM60)', kind: 'ke', range: 3500, penetration: 700, reload: 7, ammo: 40, speed: 1750, mount: 'gun' },
      { name: '9M119M Refleks', kind: 'atgm', range: 5000, penetration: 750, reload: 7, ammo: 6, speed: 350, guided: 'saclos', mount: 'gun' },
      { name: 'PKTM', kind: 'mg', range: 800, penetration: 5, reload: 2, ammo: 120, speed: 850 },
    ],
  },
  {
    id: 'bmp3', name: 'BMP-3', faction: 'ru', category: 'ifv', mobility: 'tracked',
    roadSpeed: 70, offroadSpeed: 45, length: 7.1, width: 3.3, men: 3, gun: 1.0, transport: 7,
    armor: { front: 35, side: 20, rear: 15, top: 10 }, cost: 90, optics: 2200,
    weapons: [
      { name: '100 mm 2A70 / 9M117M1 Arkan', kind: 'atgm', range: 5500, penetration: 750, reload: 9, ammo: 4, speed: 350, guided: 'saclos' },
      { name: '30 mm 2A72', kind: 'autocannon', range: 2500, penetration: 60, reload: 1.5, ammo: 40, speed: 970 },
      { name: 'PKT', kind: 'mg', range: 800, penetration: 5, reload: 2, ammo: 120, speed: 850 },
    ],
  },
  {
    id: 'btr82a', name: 'BTR-82A', faction: 'ru', category: 'apc', mobility: 'wheeled',
    roadSpeed: 100, offroadSpeed: 55, length: 7.6, width: 2.9, men: 3, gun: 0.8, transport: 7,
    armor: { front: 15, side: 10, rear: 8, top: 5 }, cost: 45, optics: 1800,
    weapons: [
      { name: '30 mm 2A72', kind: 'autocannon', range: 2500, penetration: 60, reload: 1.5, ammo: 40, speed: 970 },
      { name: 'PKTM', kind: 'mg', range: 800, penetration: 5, reload: 2, ammo: 120, speed: 850 },
    ],
  },
  {
    id: 'tigr', name: 'GAZ Tigr', faction: 'ru', category: 'recon', mobility: 'wheeled',
    roadSpeed: 140, offroadSpeed: 70, length: 5.7, width: 2.4, men: 4,
    armor: { front: 10, side: 8, rear: 6, top: 4 }, cost: 30, optics: 3200,
    weapons: [{ name: '12,7 mm Kord', kind: 'mg', range: 1500, penetration: 20, reload: 2.5, ammo: 60, speed: 900 }],
  },
  {
    id: 'motostrelki', name: 'Motschützen', faction: 'ru', category: 'infantry', mobility: 'foot',
    roadSpeed: 7, offroadSpeed: 5, length: 14, width: 6, men: 7,
    armor: { front: 0, side: 0, rear: 0, top: 0 }, cost: 30, optics: 1100,
    weapons: [
      { name: 'AK-12', kind: 'rifle', range: 400, penetration: 2, reload: 1.5, ammo: 150, speed: 900 },
      { name: 'PKM', kind: 'mg', range: 800, penetration: 5, reload: 2, ammo: 80, speed: 850 },
      { name: 'RPG-7V2', kind: 'heat', range: 300, penetration: 600, reload: 8, ammo: 3, speed: 200 },
    ],
  },
  {
    id: 'kornet', name: 'Kornet-Trupp', faction: 'ru', category: 'at', mobility: 'foot',
    roadSpeed: 6, offroadSpeed: 4, length: 6, width: 4, men: 3,
    armor: { front: 0, side: 0, rear: 0, top: 0 }, cost: 55, optics: 2400,
    weapons: [{ name: '9M133 Kornet', kind: 'atgm', range: 5500, penetration: 1100, reload: 15, ammo: 6, speed: 300, guided: 'saclos' }],
  },
];

export const unitType = (id: string) => UNIT_TYPES.find(u => u.id === id)!;

export const CATEGORY_NAME: Record<Category, string> = {
  tank: 'Kampfpanzer', ifv: 'Schützenpanzer', apc: 'Transportpanzer', recon: 'Aufklärung', infantry: 'Infanterie', at: 'Panzerabwehr',
};
