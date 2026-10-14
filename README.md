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
| Linksklick + Ziehen | Straße bauen (Live-Steigungsanzeige grün/gelb/rot) |
| Rechtsklick + Ziehen | Straße abreißen |
| Strg+Z | Letzten Strich rückgängig |
| Mausrad | Zoom zum Cursor |
| Mittlere Maustaste / Leertaste + Ziehen | Kamera verschieben |
| WASD / Pfeiltasten, `+` / `-` | Kamera bewegen / zoomen |
| Hover | Höhe ü. NN, Geländeneigung, Stadtteil; über Straßen deren Steigung |

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

## Projektstruktur

```
src/
├── config.ts                 Konstanten: Gitter, Maßstab, Höhenbereich, Höhenlinien
├── main.ts                   Bootstrap: verdrahtet Topografie, Kamera, Renderer, Input, UI
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
│   ├── TerrainRenderer.ts    Höhenband-Bitmap + Höhenlinien als Vektorpfade + Beschriftung + Fluss
│   └── palette.ts            Hypsometrische Farbskala & UI-Farben
├── roads/
│   ├── RoadNetwork.ts        Ungerichteter Graph über dem Gitter, Diagonal-Kreuzungsregel, Linienrasterung
│   ├── RoadRules.ts          Steigungsberechnung, MAX_ALLOWED_SLOPE-Prüfung, Ampel-Einstufung
│   └── RoadTool.ts           Drag-and-Drop-Bau, Abriss, Undo
├── input/
│   └── InputController.ts    Maus/Tastatur → Kamera; Links/Rechts → Straßenwerkzeug
└── ui/
    ├── Legend.ts             Höhenlegende
    └── Tooltip.ts            Höhen-Tooltip („3.640 m ü. NN“)
tests/
├── topography.test.ts        Invarianten der Topografie, Noise-Determinismus, Marching Squares
└── roads.test.ts             Graph, Steigungsregel, Werkzeug, Erreichbarkeit El Altos nur über Rampas
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
3. Minibusse, A* nach Fahrzeit, Bergauf-Physik (`UPHILL_PENALTY_FACTOR`), Rückstau
4. Ressourcen & Wochen-Upgrades, HUD, Web-Audio-Sounds, Game Over
