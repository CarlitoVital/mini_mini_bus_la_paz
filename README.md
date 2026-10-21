# Mini Minibuses: La Paz Edition

Minimalistisches 2D-Verkehrs-Strategiespiel im Stil von *Mini Motorways*, angesiedelt in der extremen
Topografie von **La Paz & El Alto** (Bolivien). Statt PKWs verbindet der Spieler ein Netz für die
typischen Minibusse (Colectivos / Trufis), vom Talkessel (~3.200 m) bis aufs Altiplano (~4.150 m).

## Entwicklung

```bash
npm install
npm run dev        # Dev-Server (Vite)
npm run build      # Typecheck + Produktions-Build
npm test           # Unit-Tests (Vitest)
```

`?seed=1234` in der URL wählt eine bestimmte Karte; Taste **N** erzeugt eine neue.

## Steuerung

| Eingabe | Aktion |
| --- | --- |
| Linksklick + Ziehen | Straße bauen (Live-Steigungsanzeige grün/gelb/rot; geradeaus über Steilstellen → Viadukt) |
| Rechtsklick + Ziehen | Straße abreißen |
| Strg+Z | Letzten Strich rückgängig |
| Mausrad | Zoom zum Cursor |
| Mittlere Maustaste / Leertaste + Ziehen | Kamera verschieben |
| WASD / Pfeiltasten, `+` / `-` | Kamera bewegen / zoomen |
| `P` / `1` / `2` | Pause / normale / doppelte Geschwindigkeit (auch per HUD oben rechts) |
| Klick auf Kreisverkehr/Ampel im Inventar, dann Kreuzung | Upgrade platzieren (`Esc`/Rechtsklick bricht ab) |
| `M` / `H` | Ton an/aus / Steuerungshilfe ein-/ausblenden |
| Hover | Höhe ü. NN, Geländeneigung, Stadtteil; Straßen-Steigung; Bus-, Markt- und Garagen-Infos |

## Straßenbau & Steigungslimit

Jedes Segment zwischen zwei benachbarten Zellen (8er-Nachbarschaft) wird beim Ziehen geprüft:
`slope = |Höhe(B) − Höhe(A)| / Distanz(A, B)` in realen Metern. Über `MAX_ALLOWED_SLOPE = 0.15` (15 %)
wird nicht gebaut: der Bau stoppt an der letzten gültigen Zelle, eine rote Geister-Straße mit ✕ und
der Hinweis „Zu steil! Serpentine nötig" erscheinen. Ampelpunkte um den Anker zeigen, in welche
Richtungen der nächste Schritt möglich ist. Ein Diagonalschritt hat nur ~71 % der Steigung eines
Schritts in Falllinie – Zickzack-Serpentinen bezwingen so Hänge bis ~21 %.

Die Ceja (Abbruchkante von El Alto) ist mit ~60 % Gefälle eine geschlossene Wand. Nur an drei
seed-abhängigen **Rampas** flacht sie auf ~18 % ab – dort führt der Weg aufs Plateau nur über
Serpentinen. Straßen werden als quadratische Bezier-Kurven durch die Zellmittelpunkte gezeichnet;
Pfeile auf der Fahrbahn zeigen bergauf (doppelt bei steilen Abschnitten).

## Minibusse & Simulation

- **Garajes** (1×1, Linienfarbe) beherbergen je 2 Minibusse; **Mercados** (2×2) erzeugen Nachfrage-Pins.
  Beide haben eine feste Zufahrt (Stummel) – nur von dort aus lassen sie sich anschließen.
- **Disposition:** Hat ein Markt unzugeteilte Pins, fährt der Bus derselben Farbe los, dessen Garage
  laut A* die kürzeste *erwartete Fahrzeit* hat. Er lädt bis zu 4 Fahrgäste und bringt sie heim (+1 Punkt je Fahrgast).
- **A\*:** Kantengewicht = `Distanz / erwartete Geschwindigkeit(Steigung)`, richtungsabhängig – flache Umwege
  schlagen steile Direktwege. Routen werden pro Netzversion gecacht; bei Abriss wird unterwegs neu geplant
  (ohne Alternative blendet der Bus aus und kehrt in die Garage zurück).
- **Bergauf-Physik:** `speed = base · max(0.2, 1 − grade · UPHILL_PENALTY_FACTOR)` mit Faktor 5
  (15 % Steigung → 25 % Tempo); bergab bis +25 %, gedeckelt durch Kurvenradien (Kehren drosseln auf ~55 %).
  Bergauf beschleunigen Busse zusätzlich träger.
- **Abstand & Rückstau:** Busse fahren in der rechten Spur und halten Abstand zum Vordermann – ein
  kriechender Bus am Hang staut alle dahinter. Kreuzungen (≥ 3 Äste) werden reserviert, damit nur ein
  Bus gleichzeitig im Knoten ist (mit Deadlock-Schutz).
- **Spawning:** Linien entstehen nach Pendlerströmen (Miraflores → Centro, El Alto → Prado,
  Laderas → Zona Sur, Zona Sur → Feria El Alto …); neue Farbe alle 3 Tage, Garagen alle ~12 s, Märkte alle 75 s.
- **Überlastung:** Ab 8 wartenden Pins füllt sich der runde Timer am Markt (45 s); läuft er voll,
  ist das Spiel vorbei (Kamera schwenkt zum Markt, Rekord wird lokal gespeichert).

## Ressourcen, Wochen & Upgrades

- **Straßenteile:** Jede Straßenzelle (außer Gebäudezellen) kostet ein Teil. Start mit 45, jede Woche
  (7 Tage à 40 s) +25. Der Verbrauch wird aus dem Netz abgeleitet – Abriss und `Strg+Z` erstatten zurück.
- **Wochenbelohnung:** Zusätzlich eines von zwei zufälligen Extras: Kreisverkehr, Ampel, 2 Viadukte oder +20 Straßenteile.
- **Viadukt (Berg-Brücke):** Zieht man eine Straße geradeaus über eine zu steile Stelle weiter, wird automatisch
  ein Viadukt über 2–4 Zellen gespannt – maßgeblich ist nur die Steigung zwischen den Endpunkten. Ideal für
  Quebradas. Start mit 1 Viadukt.
- **Kreisverkehr:** Auf einer Kreuzung (≥ 3 Äste): keine Reservierung mehr, alle Richtungen fahren gleichzeitig,
  aber mit 55 % Tempo.
- **Ampel:** Auf einer Kreuzung: Ost-West und Nord-Süd haben abwechselnd 3,5 s Grün – ganze Kolonnen
  fahren durch, statt Bus für Bus.
- **Sound:** Alle Effekte werden live mit der Web Audio API synthetisiert (Bauen, Viadukt, Abriss, Sperre,
  Ankunft als aufsteigende Pentatonik, neue Gebäude, Warnung, Wochen-Fanfare, Game Over).

## Projektstruktur

```
src/
├── config.ts                 Konstanten: Gitter, Maßstab, Höhenbereich, Höhenlinien
├── main.ts                   Einstieg: liest ?seed= und startet das Spiel
├── game/
│   ├── Game.ts               Ablauf (Intro → Wochen → Game Over), Platzierungsmodus, Tooltips, Sound-Hooks
│   └── Inventory.ts          Straßenteile, Viadukte, Kreisverkehre, Ampeln (Budget aus dem Netz abgeleitet)
├── audio/
│   └── Sound.ts              Web-Audio-Synthesizer mit Drosselung und Kompressor
├── core/
│   ├── GameLoop.ts           rAF-Loop mit festem Simulationsschritt + timeScale (Pause/1x/2x)
│   ├── math.ts               Vec2, clamp, lerp, smoothstep
│   ├── noise.ts              Seed-basiertes Simplex-Noise, fBm, Ridged-Noise
│   └── random.ts             Deterministischer PRNG (mulberry32)
├── terrain/
│   ├── LaPazGenerator.ts     Höhenfunktion: El-Alto-Plateau, Ceja, Laderas, Choqueyapu-Tal, Osthügel
│   ├── Topography.ts         Höhenraster (4 Samples/Zelle), bilineare Höhe, Neigung, Stadtteile
│   └── contours.ts           Marching Squares → verkettete Isolinien + Chaikin-Glättung
├── render/
│   ├── Camera.ts             Pan/Zoom, Welt↔Bildschirm
│   ├── Renderer.ts           HiDPI-Canvas, Ebenen: Gelände, Gitter, Hover-Zelle, Straßen
│   ├── RoadRenderer.ts       Bezier-Straßen, Bergauf-Pfeile, Bau-Vorschau (Ampel, rote Sperre)
│   ├── SimRenderer.ts        Garagen, Märkte mit Pins & Überlastungs-Timer, Minibusse (Dachgepäckträger)
│   ├── TerrainRenderer.ts    Höhenband-Bitmap + Höhenlinien als Vektorpfade + Beschriftung + Fluss
│   └── palette.ts            Hypsometrische Farbskala & UI-Farben
├── roads/
│   ├── RoadNetwork.ts        Ungerichteter Graph über dem Gitter, Diagonal-Kreuzungsregel, Linienrasterung
│   ├── RoadRules.ts          Steigungsberechnung, MAX_ALLOWED_SLOPE-Prüfung, Ampel-Einstufung
│   └── RoadTool.ts           Drag-and-Drop-Bau, Abriss, Undo
├── sim/
│   ├── Simulation.ts         Uhr, Spawning, Nachfrage/Überlastung, Disposition, Neuplanung, Busse-Kontext
│   ├── Minibus.ts            Agent: Zustandsautomat, Steigungs-/Kurventempo, Abstand, Kreuzungsreservierung
│   ├── Pathfinding.ts        A* mit Fahrzeit-Gewichten (Binär-Heap)
│   ├── Route.ts              Fahrgeometrie entlang der Bezier-Kurven, Steigung/Kurvenfaktor je Abschnitt
│   ├── physics.ts            gradeSpeedFactor, curveSpeedFactor, erwartete Geschwindigkeit
│   ├── Buildings.ts          Garagen & Märkte, Zellbelegung, Anschlussregel
│   └── Spawner.ts            Bauplatzsuche (Zufahrt anschließbar, Markt flach, Abstand zum Fluss)
├── input/
│   └── InputController.ts    Maus/Tastatur → Kamera; Links/Rechts → Straßenwerkzeug
└── ui/
    ├── Hud.ts                Passagiere, Wochentag-Uhr, Pause/1x/2x, Ton, Hilfe, Warnungen
    ├── InventoryBar.ts       Inventar unten mittig (Straßenteile & Spezialelemente)
    ├── Modal.ts              Dialoge: Intro, Wochenbelohnung (Auswahlkarten), Game Over
    ├── Legend.ts             Höhenlegende
    └── Tooltip.ts            Höhen-Tooltip („3.640 m ü. NN“)
tests/
├── topography.test.ts        Invarianten der Topografie, Noise-Determinismus, Marching Squares
├── roads.test.ts             Graph, Steigungsregel, Werkzeug, Erreichbarkeit El Altos nur über Rampas
├── sim.test.ts               Physik, A*, Route, komplette Touren, Bergauf vs. bergab, Abstand, Neuplanung, Spawning
└── game.test.ts              Straßenteil-Budget, Viadukte, Kreuzungs-Upgrades, Ampel/Kreisverkehr, Wochen, Game Over
```

## Topografie-Modell

Normierte Höhe `0.0` = Zona Sur (3.200 m), `1.0` = El Alto (4.150 m); eine Zelle entspricht 150 m.
Die Höhenfunktion setzt sich zusammen aus einer Talachse (Río Choqueyapu, von Nord nach Südost
abfallend), Laderas mit ~10 % mittlerem Gefälle, der Ceja-Steilwand (~60 %, an Rampas ~18 %),
Osthügeln mit ~8–13 %, Ridged-Noise-Quebradas an den Hängen und feinem fBm-Relief. Die Hangbreiten
werden aus Ziel-Gefällen berechnet, damit das Steigungslimit planbar greift.

## Roadmap

1. ✅ Setup & Topografie (Höhengenerator, Isohypsen, Höhen-Tooltip)
2. ✅ Straßenbau mit Steigungslimit (`MAX_ALLOWED_SLOPE`), „Zu steil!“-Feedback, Bezier-Serpentinen
3. ✅ Minibusse, A* nach Fahrzeit, Bergauf-Physik (`UPHILL_PENALTY_FACTOR`), Rückstau
4. ✅ Ressourcen & Wochen-Upgrades, HUD, Web-Audio-Sounds, Game Over

Alle Balancing-Werte (Teile, Takt, Strafen, Timer) stehen gesammelt in `src/config.ts`.
