// Einheitenkatalog. Werte nach öffentlichen Quellen, gerundet und für die Spielbalance vereinfacht.
// Panzerung und Durchschlag in mm Panzerstahl-Äquivalent (grobe Schätzwerte, KE-Wirkung).
// Neue Einheit = neuer Eintrag hier.

export type Faction = 'bw' | 'ru';
export type Category = 'tank' | 'ifv' | 'apc' | 'recon' | 'infantry' | 'at' | 'artillery' | 'heli' | 'jet' | 'aa';
export type Mobility = 'tracked' | 'wheeled' | 'foot';

export interface Weapon {
  name: string;
  kind: 'ke' | 'heat' | 'atgm' | 'autocannon' | 'mg' | 'rifle' | 'artillery' | 'aa'; // Artillerie nur auf Befehl; „aa“ = Flugabwehrrakete (nur gegen Luftziele)
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
  artillery?: Artillery;
  air?: 'heli' | 'jet'; // fliegt: Hubschrauber (tief, direkt, ohne Wege) oder Jet (Anflug von außerhalb)
  radar?: number;       // Luftraumüberwachung: entdeckt Luftfahrzeuge in diesem Umkreis auch ohne Sicht
  bombs?: { count: number; lethal: number; spread: number }; // Jet: Bomben je Einsatz
}

// Steilfeuer: Feuerauftrag auf einen Punkt, ohne Sichtlinie
export interface Artillery {
  rounds: number;      // Granaten je Feuerauftrag
  interval: number;    // Sekunden zwischen zwei Granaten
  shellSpeed: number;  // mittlere Geschwindigkeit über Grund (m/s), bestimmt die Flugzeit
  spread: number;      // Streuung in m (eine Standardabweichung)
  lethal: number;      // tödlicher Radius gegen ungeschützte Infanterie in m
  topPen: number;      // Durchschlag bei Volltreffer von oben (mm)
  smoke: number;       // Rauchgranaten an Bord
  minRange: number;    // Mindestentfernung in m
}

export const UNIT_TYPES: UnitType[] = [
  // ---------- Luft ----------
  {
    id: 'tiger', name: 'Tiger UHT', faction: 'bw', category: 'heli', mobility: 'tracked', air: 'heli',
    roadSpeed: 230, offroadSpeed: 230, length: 14, width: 4.5, men: 2,
    armor: { front: 15, side: 10, rear: 8, top: 8 }, cost: 170, optics: 3500,
    weapons: [
      { name: 'PARS 3 LR', kind: 'atgm', range: 6000, penetration: 1000, reload: 6, ammo: 8, speed: 250, guided: 'fnf', topAttack: true },
      { name: '12,7 mm HMP 400', kind: 'mg', range: 1500, penetration: 20, reload: 2.5, ammo: 40, speed: 900 },
    ],
  },
  {
    id: 'nh90', name: 'NH90', faction: 'bw', category: 'heli', mobility: 'tracked', air: 'heli',
    roadSpeed: 260, offroadSpeed: 260, length: 16, width: 4, men: 3, transport: 12,
    armor: { front: 8, side: 6, rear: 5, top: 5 }, cost: 90, optics: 2000,
    weapons: [{ name: '7,62 mm MG (Tür)', kind: 'mg', range: 800, penetration: 5, reload: 2, ammo: 80, speed: 850 }],
  },
  {
    id: 'skyranger', name: 'Skyranger 30 (Boxer)', faction: 'bw', category: 'aa', mobility: 'wheeled', radar: 5000,
    roadSpeed: 103, offroadSpeed: 60, length: 7.9, width: 3.0, men: 3, gun: 1.3,
    armor: { front: 40, side: 30, rear: 20, top: 15 }, cost: 90, optics: 2500,
    weapons: [
      { name: '30 mm KCE (AHEAD)', kind: 'autocannon', range: 3000, penetration: 40, reload: 1.2, ammo: 60, speed: 1100 },
      { name: 'Stinger', kind: 'aa', range: 5000, penetration: 0, reload: 6, ammo: 4, speed: 650, guided: 'fnf' },
    ],
  },
  {
    id: 'stinger', name: 'Fliegerfaust-Trupp (Stinger)', faction: 'bw', category: 'aa', mobility: 'foot',
    roadSpeed: 6, offroadSpeed: 4, length: 5, width: 4, men: 2,
    armor: { front: 0, side: 0, rear: 0, top: 0 }, cost: 45, optics: 2500,
    weapons: [{ name: 'Fliegerfaust 2 (Stinger)', kind: 'aa', range: 4500, penetration: 0, reload: 10, ammo: 4, speed: 650, guided: 'fnf' }],
  },
  {
    id: 'eurofighter', name: 'Eurofighter', faction: 'bw', category: 'jet', mobility: 'tracked', air: 'jet',
    roadSpeed: 600, offroadSpeed: 600, length: 16, width: 11, men: 1,
    armor: { front: 5, side: 5, rear: 5, top: 5 }, cost: 220, optics: 1500,
    weapons: [{ name: 'GBU-48 (Lenkbomben)', kind: 'artillery', range: 0, penetration: 300, reload: 0, ammo: 2, speed: 0 }],
    bombs: { count: 2, lethal: 30, spread: 4 },
  },
  {
    id: 'ka52', name: 'Ka-52', faction: 'ru', category: 'heli', mobility: 'tracked', air: 'heli',
    roadSpeed: 250, offroadSpeed: 250, length: 14, width: 4.8, men: 2,
    armor: { front: 20, side: 12, rear: 10, top: 10 }, cost: 160, optics: 3200,
    weapons: [
      { name: '9K121 Vikhr', kind: 'atgm', range: 8000, penetration: 900, reload: 6, ammo: 12, speed: 500, guided: 'saclos' },
      { name: '30 mm 2A42', kind: 'autocannon', range: 2000, penetration: 60, reload: 1.5, ammo: 30, speed: 970 },
    ],
  },
  {
    id: 'mi8', name: 'Mi-8AMTSch', faction: 'ru', category: 'heli', mobility: 'tracked', air: 'heli',
    roadSpeed: 230, offroadSpeed: 230, length: 18, width: 4, men: 3, transport: 14,
    armor: { front: 8, side: 6, rear: 5, top: 5 }, cost: 80, optics: 2000,
    weapons: [{ name: 'PKT (Tür)', kind: 'mg', range: 800, penetration: 5, reload: 2, ammo: 80, speed: 850 }],
  },
  {
    id: 'tunguska', name: '2K22 Tunguska', faction: 'ru', category: 'aa', mobility: 'tracked', radar: 6000,
    roadSpeed: 65, offroadSpeed: 45, length: 7.9, width: 3.2, men: 4, gun: 1.5,
    armor: { front: 25, side: 15, rear: 10, top: 10 }, cost: 100, optics: 2500,
    weapons: [
      { name: '2 × 30 mm 2A38', kind: 'autocannon', range: 3000, penetration: 40, reload: 1, ammo: 60, speed: 1000 },
      { name: '9M311', kind: 'aa', range: 8000, penetration: 0, reload: 6, ammo: 8, speed: 600, guided: 'saclos' },
    ],
  },
  {
    id: 'igla', name: 'Igla-Trupp', faction: 'ru', category: 'aa', mobility: 'foot',
    roadSpeed: 6, offroadSpeed: 4, length: 5, width: 4, men: 2,
    armor: { front: 0, side: 0, rear: 0, top: 0 }, cost: 40, optics: 2500,
    weapons: [{ name: '9K38 Igla', kind: 'aa', range: 5000, penetration: 0, reload: 10, ammo: 4, speed: 600, guided: 'fnf' }],
  },
  {
    id: 'su34', name: 'Su-34', faction: 'ru', category: 'jet', mobility: 'tracked', air: 'jet',
    roadSpeed: 600, offroadSpeed: 600, length: 23, width: 15, men: 2,
    armor: { front: 6, side: 6, rear: 6, top: 6 }, cost: 210, optics: 1500,
    weapons: [{ name: 'KAB-500L (Lenkbomben)', kind: 'artillery', range: 0, penetration: 300, reload: 0, ammo: 2, speed: 0 }],
    bombs: { count: 2, lethal: 32, spread: 6 },
  },

  // ---------- Artillerie ----------
  {
    id: 'pzh2000', name: 'Panzerhaubitze 2000', faction: 'bw', category: 'artillery', mobility: 'tracked',
    roadSpeed: 60, offroadSpeed: 45, length: 7.9, width: 3.6, men: 5, gun: 4.5,
    armor: { front: 30, side: 15, rear: 10, top: 10 }, cost: 150, optics: 1500,
    weapons: [{ name: '155 mm L52 (Spreng)', kind: 'artillery', range: 30000, penetration: 120, reload: 0, ammo: 48, speed: 300 }],
    artillery: { rounds: 6, interval: 2.5, shellSpeed: 300, spread: 22, lethal: 22, topPen: 120, smoke: 12, minRange: 400 },
  },
  {
    id: 'wiesel_mrs', name: 'Wiesel 2 Mörser 120 mm', faction: 'bw', category: 'artillery', mobility: 'tracked',
    roadSpeed: 70, offroadSpeed: 50, length: 4.8, width: 1.9, men: 3, gun: 1.6,
    armor: { front: 10, side: 8, rear: 6, top: 5 }, cost: 75, optics: 1200,
    weapons: [{ name: '120 mm Mörser (Spreng)', kind: 'artillery', range: 8000, penetration: 60, reload: 0, ammo: 40, speed: 200 }],
    artillery: { rounds: 8, interval: 2, shellSpeed: 200, spread: 30, lethal: 16, topPen: 60, smoke: 16, minRange: 200 },
  },
  {
    id: 'msta', name: '2S19 Msta-S', faction: 'ru', category: 'artillery', mobility: 'tracked',
    roadSpeed: 60, offroadSpeed: 40, length: 7.2, width: 3.6, men: 5, gun: 4.2,
    armor: { front: 25, side: 15, rear: 10, top: 10 }, cost: 140, optics: 1500,
    weapons: [{ name: '152 mm 2A64 (Spreng)', kind: 'artillery', range: 25000, penetration: 115, reload: 0, ammo: 48, speed: 300 }],
    artillery: { rounds: 6, interval: 3, shellSpeed: 300, spread: 28, lethal: 21, topPen: 115, smoke: 12, minRange: 400 },
  },
  {
    id: 'sani', name: '2S12 Sani 120 mm', faction: 'ru', category: 'artillery', mobility: 'wheeled',
    roadSpeed: 80, offroadSpeed: 40, length: 6.5, width: 2.4, men: 5, gun: 1.5,
    armor: { front: 6, side: 5, rear: 4, top: 3 }, cost: 65, optics: 1200,
    weapons: [{ name: '120 mm 2B11 (Spreng)', kind: 'artillery', range: 7000, penetration: 60, reload: 0, ammo: 40, speed: 200 }],
    artillery: { rounds: 8, interval: 2.2, shellSpeed: 200, spread: 32, lethal: 16, topPen: 60, smoke: 16, minRange: 200 },
  },

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
export const isAirType = (t: UnitType) => !!t.air;

export const CATEGORY_NAME: Record<Category, string> = {
  tank: 'Kampfpanzer', ifv: 'Schützenpanzer', apc: 'Transportpanzer', recon: 'Aufklärung', infantry: 'Infanterie', at: 'Panzerabwehr',
  artillery: 'Artillerie',
  heli: 'Hubschrauber', jet: 'Kampfflugzeug', aa: 'Luftabwehr',
};
