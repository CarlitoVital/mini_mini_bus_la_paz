const DAY_NAMES = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const numberFormat = new Intl.NumberFormat('de-DE');

export type SpeedSetting = 0 | 1 | 2;

/**
 * Minimalistisches HUD oben rechts: beförderte Passagiere, Wochentag-Uhr
 * und Geschwindigkeitssteuerung (Pause / 1x / 2x).
 */
export class Hud {
  private readonly scoreEl: HTMLSpanElement;
  private readonly dayEl: HTMLSpanElement;
  private readonly weekEl: HTMLSpanElement;
  private readonly ringEl: SVGCircleElement;
  private readonly buttons: HTMLButtonElement[];
  private readonly toastEl: HTMLDivElement;
  private toastTimer = 0;
  private last = { score: -1, day: -1, frac: -1 };

  speed: SpeedSetting = 1;
  /** Wird bei Klick auf Ton/Hilfe aufgerufen. */
  onMute: () => void = () => {};
  onHelp: () => void = () => {};
  private readonly muteBtn: HTMLButtonElement;

  constructor(
    parent: HTMLElement,
    private readonly onSpeed: (s: SpeedSetting) => void,
  ) {
    const el = document.createElement('div');
    el.className = 'hud';
    el.innerHTML = `
      <div class="hud-score" title="Beförderte Passagiere">
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="11" rx="3"/><circle cx="8" cy="18.5" r="1.8"/><circle cx="16" cy="18.5" r="1.8"/></svg>
        <span class="hud-score-value">0</span>
      </div>
      <div class="hud-clock" title="Wochentag">
        <svg viewBox="0 0 36 36" aria-hidden="true">
          <circle class="hud-ring-bg" cx="18" cy="18" r="15"/>
          <circle class="hud-ring" cx="18" cy="18" r="15" pathLength="100"/>
        </svg>
        <span class="hud-day">Mo</span>
      </div>
      <span class="hud-week">Woche 1</span>
      <div class="hud-speed" role="group" aria-label="Geschwindigkeit">
        <button data-speed="0" title="Pause (P)">❚❚</button>
        <button data-speed="1" title="Normal (1)">▶</button>
        <button data-speed="2" title="Schnell (2)">▶▶</button>
      </div>
      <div class="hud-extra">
        <button class="hud-mute" title="Ton an/aus (M)" aria-label="Ton an/aus"></button>
        <button class="hud-help" title="Steuerung anzeigen (H)" aria-label="Hilfe">?</button>
      </div>`;
    parent.appendChild(el);
    this.scoreEl = el.querySelector('.hud-score-value')!;
    this.dayEl = el.querySelector('.hud-day')!;
    this.weekEl = el.querySelector('.hud-week')!;
    this.ringEl = el.querySelector('.hud-ring')!;
    this.buttons = [...el.querySelectorAll<HTMLButtonElement>('.hud-speed button')];
    this.muteBtn = el.querySelector('.hud-mute')!;
    this.muteBtn.addEventListener('click', () => this.onMute());
    el.querySelector('.hud-help')!.addEventListener('click', () => this.onHelp());
    this.setMuted(false);
    for (const b of this.buttons) {
      b.addEventListener('click', () => {
        b.blur();
        this.setSpeed(Number(b.dataset.speed) as SpeedSetting);
      });
    }

    this.toastEl = document.createElement('div');
    this.toastEl.className = 'toast';
    parent.appendChild(this.toastEl);

    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.code === 'KeyP') this.setSpeed(this.speed === 0 ? 1 : 0);
      if (e.code === 'Digit1') this.setSpeed(1);
      if (e.code === 'Digit2') this.setSpeed(2);
    });
    this.setSpeed(1);
  }

  setMuted(m: boolean): void {
    this.muteBtn.innerHTML = m
      ? '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9l5 6M21 9l-5 6" class="stroke"/></svg>'
      : '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" class="stroke"/></svg>';
    this.muteBtn.classList.toggle('muted', m);
  }

  setSpeed(s: SpeedSetting): void {
    this.speed = s;
    for (const b of this.buttons) b.classList.toggle('active', Number(b.dataset.speed) === s);
    this.onSpeed(s);
  }

  update(score: number, day: number, dayFraction: number, frameDt: number): void {
    if (score !== this.last.score) {
      this.scoreEl.textContent = numberFormat.format(score);
      if (this.last.score >= 0) {
        this.scoreEl.classList.remove('bump');
        void this.scoreEl.offsetWidth; // Animation neu starten
        this.scoreEl.classList.add('bump');
      }
      this.last.score = score;
    }
    if (day !== this.last.day) {
      this.dayEl.textContent = DAY_NAMES[day % 7];
      this.weekEl.textContent = `Woche ${Math.floor(day / 7) + 1}`;
      this.last.day = day;
    }
    const frac = Math.round(dayFraction * 200) / 2;
    if (frac !== this.last.frac) {
      this.ringEl.style.strokeDasharray = `${frac} 100`;
      this.last.frac = frac;
    }
    if (this.toastTimer > 0) {
      this.toastTimer -= frameDt;
      if (this.toastTimer <= 0) this.toastEl.classList.remove('visible');
    }
  }

  toast(text: string, seconds = 3.5): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('visible');
    this.toastTimer = seconds;
  }
}
