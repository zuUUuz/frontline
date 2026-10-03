// Nachschub: Versorgungs-LKW munitionieren auf und reparieren Fahrzeuge in ihrer Nähe (beide müssen stehen);
// das kostet Nachschubpunkte. An den eigenen Anmarschpunkten am Kartenrand geht das kostenlos, aber langsamer.

import type { Weapon } from '../data/units';
import type { Unit, World } from './world';
import type { WeaponState } from './combat';

export const SUPPLY_RANGE = 80;  // m um den LKW
const DEPOT_RANGE = 150;         // m um einen Anmarschpunkt
const REFILL_TIME = 30;          // so viele Sekunden dauert volles Aufmunitionieren am LKW
const REPAIR_RATE = 0.08;        // Lebenspunkte pro Sekunde am LKW
const DEPOT_FACTOR = 0.5;        // am Kartenrand halb so schnell
// Kosten in Nachschubpunkten je Schuss bzw. Feuerstoß / je Lebenspunkt
const COST: Record<Weapon['kind'], number> = { ke: 6, atgm: 25, heat: 8, autocannon: 1.5, mg: 0.5, rifle: 0.2, aa: 25, artillery: 5 };
const SMOKE_COST = 5, REPAIR_COST = 30;
const TRUCK_REFILL = 25;          // Nachschubpunkte pro Sekunde, die ein LKW am Kartenrand nachlädt

const partial = new WeakMap<WeaponState | Unit, number>(); // angefangene Schüsse bzw. Rauchgranaten

export const needsSupply = (u: Unit) =>
  (u.type.mobility !== 'foot' && u.hp < u.maxHp) || u.type.weapons.some((w, i) => u.weapons[i].ammo < w.ammo)
  || (!!u.type.artillery && u.smokeAmmo < u.type.artillery.smoke);

// depots: Anmarschpunkte je Seite (nur im Gefecht)
export function updateSupply(w: World, dt: number, depots?: Record<'blue' | 'red', { x: number; y: number }[]>) {
  // LKW füllen ihren Vorrat an den Anmarschpunkten wieder auf
  for (const t of w.units) {
    if (!t.type.supply || t.dead || t.supplyLeft >= t.type.supply) continue;
    if (depots?.[t.side].some(d => Math.hypot(d.x - t.x, d.y - t.y) <= DEPOT_RANGE)) t.supplyLeft = Math.min(t.type.supply, t.supplyLeft + TRUCK_REFILL * dt);
  }
  const trucks = w.units.filter(u => u.type.supply && !u.dead && u.speed < 0.5 && u.supplyLeft > 0);
  for (const u of w.units) {
    if (u.dead || u.carrier || u.offmap || u.type.supply || u.speed > 0.5 || !needsSupply(u)) continue;
    const truck = trucks.find(t => t.side === u.side && Math.hypot(t.x - u.x, t.y - u.y) <= SUPPLY_RANGE && t.supplyLeft > 0);
    const depot = depots?.[u.side].some(d => Math.hypot(d.x - u.x, d.y - u.y) <= DEPOT_RANGE);
    if (!truck && !depot) continue;
    const rate = truck ? 1 : DEPOT_FACTOR;
    let spent = 0;
    // Munition: alle Waffen gleichzeitig, voll in REFILL_TIME
    u.type.weapons.forEach((wp, i) => {
      const st = u.weapons[i];
      if (st.ammo >= wp.ammo) return;
      const acc = (partial.get(st) ?? 0) + (wp.ammo / REFILL_TIME) * rate * dt;
      const whole = Math.min(Math.floor(acc), wp.ammo - st.ammo);
      partial.set(st, acc - whole);
      st.ammo += whole;
      spent += whole * COST[wp.kind];
    });
    if (u.type.artillery && u.smokeAmmo < u.type.artillery.smoke) {
      const acc = (partial.get(u) ?? 0) + (u.type.artillery.smoke / REFILL_TIME) * rate * dt;
      const whole = Math.min(Math.floor(acc), u.type.artillery.smoke - u.smokeAmmo);
      partial.set(u, acc - whole);
      u.smokeAmmo += whole;
      spent += whole * SMOKE_COST;
    }
    // Reparatur (nur Fahrzeuge; Infanterie bekommt keine Soldaten zurück)
    if (u.type.mobility !== 'foot' && u.hp < u.maxHp) {
      const fix = Math.min(u.maxHp - u.hp, REPAIR_RATE * rate * dt);
      u.hp += fix;
      spent += fix * REPAIR_COST;
    }
    if (truck) truck.supplyLeft = Math.max(0, truck.supplyLeft - spent); // am Kartenrand kostenlos
  }
}
