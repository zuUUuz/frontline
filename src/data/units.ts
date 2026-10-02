// Einheitenkatalog. Werte nach öffentlichen Quellen, gerundet und für die Spielbalance vereinfacht.
// Panzerung und Durchschlag in mm Panzerstahl-Äquivalent (grobe Schätzwerte, KE-Wirkung).
// Neue Einheit = neuer Eintrag hier; Waffen werden ab Schritt 4 (Kampf) genutzt.

export type Faction = 'bw' | 'ru';
export type Category = 'tank' | 'ifv' | 'apc' | 'recon' | 'infantry' | 'at';
export type Mobility = 'tracked' | 'wheeled' | 'foot';

export interface Weapon {
  name: string;
  kind: 'ke' | 'heat' | 'atgm' | 'autocannon' | 'mg' | 'rifle';
  range: number;       // wirksame Reichweite in m
  penetration: number; // mm
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
  weapons: Weapon[];
  transport?: number;  // Plätze für absitzende Infanterie
  gun?: number;        // Rohrlänge über die Wanne hinaus (für die Zeichnung)
}

export const UNIT_TYPES: UnitType[] = [
  // ---------- Bundeswehr ----------
  {
    id: 'leopard2a7', name: 'Leopard 2A7', faction: 'bw', category: 'tank', mobility: 'tracked',
    roadSpeed: 68, offroadSpeed: 45, length: 7.7, width: 3.8, men: 4, gun: 3.2,
    armor: { front: 900, side: 120, rear: 60, top: 40 }, optics: 2600,
    weapons: [
      { name: '120 mm L55 (DM73)', kind: 'ke', range: 4000, penetration: 800 },
      { name: 'MG3', kind: 'mg', range: 800, penetration: 5 },
    ],
  },
  {
    id: 'puma', name: 'Puma', faction: 'bw', category: 'ifv', mobility: 'tracked',
    roadSpeed: 70, offroadSpeed: 45, length: 7.6, width: 3.9, men: 3, gun: 1.2, transport: 6,
    armor: { front: 110, side: 45, rear: 30, top: 25 }, optics: 2400,
    weapons: [
      { name: '30 mm MK30-2/ABM', kind: 'autocannon', range: 3000, penetration: 110 },
      { name: 'MELLS (Spike-LR)', kind: 'atgm', range: 4000, penetration: 700 },
      { name: 'MG4', kind: 'mg', range: 800, penetration: 5 },
    ],
  },
  {
    id: 'boxer', name: 'Boxer GTK', faction: 'bw', category: 'apc', mobility: 'wheeled',
    roadSpeed: 103, offroadSpeed: 60, length: 7.9, width: 3.0, men: 3, transport: 8,
    armor: { front: 40, side: 30, rear: 20, top: 15 }, optics: 1800,
    weapons: [{ name: '12,7 mm FLW 200', kind: 'mg', range: 1500, penetration: 20 }],
  },
  {
    id: 'fennek', name: 'Fennek', faction: 'bw', category: 'recon', mobility: 'wheeled',
    roadSpeed: 115, offroadSpeed: 65, length: 5.6, width: 2.5, men: 3,
    armor: { front: 12, side: 10, rear: 8, top: 5 }, optics: 3600,
    weapons: [{ name: '12,7 mm M3M', kind: 'mg', range: 1500, penetration: 20 }],
  },
  {
    id: 'pzgren', name: 'Panzergrenadiere', faction: 'bw', category: 'infantry', mobility: 'foot',
    roadSpeed: 7, offroadSpeed: 5, length: 12, width: 6, men: 6,
    armor: { front: 0, side: 0, rear: 0, top: 0 }, optics: 1200,
    weapons: [
      { name: 'G95 (HK416)', kind: 'rifle', range: 400, penetration: 2 },
      { name: 'MG5', kind: 'mg', range: 800, penetration: 5 },
      { name: 'Panzerfaust 3', kind: 'heat', range: 400, penetration: 700 },
    ],
  },
  {
    id: 'mells', name: 'MELLS-Trupp', faction: 'bw', category: 'at', mobility: 'foot',
    roadSpeed: 6, offroadSpeed: 4, length: 6, width: 4, men: 3,
    armor: { front: 0, side: 0, rear: 0, top: 0 }, optics: 2200,
    weapons: [{ name: 'MELLS (Spike-LR)', kind: 'atgm', range: 4000, penetration: 700 }],
  },

  // ---------- Russland ----------
  {
    id: 't90m', name: 'T-90M', faction: 'ru', category: 'tank', mobility: 'tracked',
    roadSpeed: 60, offroadSpeed: 45, length: 6.9, width: 3.8, men: 3, gun: 2.6,
    armor: { front: 850, side: 110, rear: 50, top: 35 }, optics: 2400,
    weapons: [
      { name: '125 mm 2A46M-5 (3BM60)', kind: 'ke', range: 3500, penetration: 700 },
      { name: '9M119M Refleks', kind: 'atgm', range: 5000, penetration: 850 },
      { name: 'PKTM', kind: 'mg', range: 800, penetration: 5 },
    ],
  },
  {
    id: 'bmp3', name: 'BMP-3', faction: 'ru', category: 'ifv', mobility: 'tracked',
    roadSpeed: 70, offroadSpeed: 45, length: 7.1, width: 3.3, men: 3, gun: 1.0, transport: 7,
    armor: { front: 35, side: 20, rear: 15, top: 10 }, optics: 2200,
    weapons: [
      { name: '100 mm 2A70 / 9M117M1 Arkan', kind: 'atgm', range: 5500, penetration: 750 },
      { name: '30 mm 2A72', kind: 'autocannon', range: 2500, penetration: 60 },
      { name: 'PKT', kind: 'mg', range: 800, penetration: 5 },
    ],
  },
  {
    id: 'btr82a', name: 'BTR-82A', faction: 'ru', category: 'apc', mobility: 'wheeled',
    roadSpeed: 100, offroadSpeed: 55, length: 7.6, width: 2.9, men: 3, gun: 0.8, transport: 7,
    armor: { front: 15, side: 10, rear: 8, top: 5 }, optics: 1800,
    weapons: [
      { name: '30 mm 2A72', kind: 'autocannon', range: 2500, penetration: 60 },
      { name: 'PKTM', kind: 'mg', range: 800, penetration: 5 },
    ],
  },
  {
    id: 'tigr', name: 'GAZ Tigr', faction: 'ru', category: 'recon', mobility: 'wheeled',
    roadSpeed: 140, offroadSpeed: 70, length: 5.7, width: 2.4, men: 4,
    armor: { front: 10, side: 8, rear: 6, top: 4 }, optics: 3200,
    weapons: [{ name: '12,7 mm Kord', kind: 'mg', range: 1500, penetration: 20 }],
  },
  {
    id: 'motostrelki', name: 'Motschützen', faction: 'ru', category: 'infantry', mobility: 'foot',
    roadSpeed: 7, offroadSpeed: 5, length: 14, width: 6, men: 7,
    armor: { front: 0, side: 0, rear: 0, top: 0 }, optics: 1100,
    weapons: [
      { name: 'AK-12', kind: 'rifle', range: 400, penetration: 2 },
      { name: 'PKM', kind: 'mg', range: 800, penetration: 5 },
      { name: 'RPG-7V2', kind: 'heat', range: 300, penetration: 600 },
    ],
  },
  {
    id: 'kornet', name: 'Kornet-Trupp', faction: 'ru', category: 'at', mobility: 'foot',
    roadSpeed: 6, offroadSpeed: 4, length: 6, width: 4, men: 3,
    armor: { front: 0, side: 0, rear: 0, top: 0 }, optics: 2400,
    weapons: [{ name: '9M133 Kornet', kind: 'atgm', range: 5500, penetration: 1100 }],
  },
];

export const unitType = (id: string) => UNIT_TYPES.find(u => u.id === id)!;

export const CATEGORY_NAME: Record<Category, string> = {
  tank: 'Kampfpanzer', ifv: 'Schützenpanzer', apc: 'Transportpanzer', recon: 'Aufklärung', infantry: 'Infanterie', at: 'Panzerabwehr',
};
