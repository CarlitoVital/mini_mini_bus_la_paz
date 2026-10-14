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

## Steuerung (Phase 1)

| Eingabe | Aktion |
| --- | --- |
| Mausrad | Zoom zum Cursor |
| Mittlere Maustaste / Leertaste + Ziehen | Kamera verschieben |
| WASD / Pfeiltasten, `+` / `-` | Kamera bewegen / zoomen |
| Hover | Höhe ü. NN, Geländeneigung, Stadtteil |

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
│   ├── Renderer.ts           HiDPI-Canvas, Ebenen: Gelände, Gitter, Hover-Zelle
│   ├── TerrainRenderer.ts    Höhenband-Bitmap + Höhenlinien als Vektorpfade + Beschriftung + Fluss
│   └── palette.ts            Hypsometrische Farbskala & UI-Farben
├── input/
│   └── InputController.ts    Maus/Tastatur → Kamera (Links/Rechts reserviert für Bau/Abriss)
└── ui/
    ├── Legend.ts             Höhenlegende
    └── Tooltip.ts            Höhen-Tooltip („3.640 m ü. NN“)
tests/
└── topography.test.ts        Invarianten der Topografie, Noise-Determinismus, Marching Squares
```

## Topografie-Modell

Normierte Höhe `0.0` = Zona Sur (3.200 m), `1.0` = El Alto (4.150 m); eine Zelle entspricht 150 m.
Die Höhenfunktion setzt sich zusammen aus einer Talachse (Río Choqueyapu, von Nord nach Südost
abfallend), einem konkaven Hangprofil mit steiler Abbruchkante zum Plateau („La Ceja“), ansteigenden
Osthügeln, Ridged-Noise-Quebradas an den Hängen und feinem fBm-Relief.

## Roadmap

1. ✅ Setup & Topografie (Höhengenerator, Isohypsen, Höhen-Tooltip)
2. Straßenbau mit Steigungslimit (`MAX_ALLOWED_SLOPE`), „Zu steil!“-Feedback, Bezier-Serpentinen
3. Minibusse, A* nach Fahrzeit, Bergauf-Physik (`UPHILL_PENALTY_FACTOR`), Rückstau
4. Ressourcen & Wochen-Upgrades, HUD, Web-Audio-Sounds, Game Over
