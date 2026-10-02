# Frontline

Echtzeit-Taktikspiel fürs Handy im Geist von Broken Arrow: verbundene Waffen, Deckbau, echte Einheiten,
Gefechte auf echten Karten. Wird Schritt für Schritt aufgebaut.

- [VISION.md](VISION.md): worum es geht
- [ROADMAP.md](ROADMAP.md): was als Nächstes kommt

## Starten

```bash
npm install
npm run dev                          # Entwicklungsserver, auch im WLAN fürs Handy erreichbar
npm run map:fetch -- ahrensfelde     # OSM-Rohdaten laden (nur nötig, um die Karte neu zu bauen)
npm run map:build -- ahrensfelde     # Spielkarte nach public/maps/ bauen
```

Kartenausschnitte stehen in `maps/<id>.config.json` (Mittelpunkt, Größe, Rastergröße).

Kartendaten: © OpenStreetMap-Mitwirkende, verfügbar unter der Open Database License (ODbL).
