/**
 * Kleiner Web-Audio-Synthesizer für alle Spielgeräusche – keine Audiodateien.
 * Der AudioContext wird erst bei der ersten Nutzerinteraktion erzeugt (Autoplay-Regeln).
 */

type Wave = OscillatorType;

/** Pentatonik (D-Dur) für angenehme Ankunfts-Töne. */
const PENTATONIC = [587.33, 659.25, 739.99, 880, 987.77, 1174.66];

export type SoundName =
  | 'build'
  | 'viaduct'
  | 'erase'
  | 'blocked'
  | 'deliver'
  | 'spawnHouse'
  | 'spawnMarket'
  | 'warning'
  | 'week'
  | 'place'
  | 'click'
  | 'gameOver';

/** Mindestabstand (s) zwischen zwei gleichen Sounds – verhindert "Maschinengewehr". */
const THROTTLE: Partial<Record<SoundName, number>> = {
  build: 0.035,
  erase: 0.05,
  blocked: 0.25,
  deliver: 0.07,
  warning: 1.2,
};

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly last = new Map<SoundName, number>();
  private deliverStep = 0;
  muted = false;

  /** Muss aus einem User-Event heraus aufgerufen werden. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.32;
    // sanfter Kompressor, damit viele gleichzeitige Töne nicht übersteuern
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(this.ctx.destination);
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.32, this.ctx.currentTime, 0.05);
  }

  play(name: SoundName): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    const gap = THROTTLE[name];
    const prev = this.last.get(name) ?? -Infinity;
    if (gap !== undefined && now - prev < gap) return;
    this.last.set(name, now);

    switch (name) {
      case 'build':
        this.tone(520 + Math.random() * 160, 0.06, 'triangle', 0.25, now);
        break;
      case 'viaduct':
        this.tone(330, 0.12, 'triangle', 0.3, now);
        this.tone(495, 0.18, 'triangle', 0.25, now + 0.07);
        break;
      case 'erase':
        this.noise(0.07, 2400, 0.18, now);
        break;
      case 'blocked':
        this.tone(150, 0.16, 'sawtooth', 0.12, now, 110, 900);
        break;
      case 'deliver': {
        // aufsteigende Pentatonik, solange viele Fahrgäste kurz hintereinander ankommen
        if (now - prev > 1.5) this.deliverStep = 0;
        const f = PENTATONIC[this.deliverStep++ % PENTATONIC.length];
        this.tone(f, 0.22, 'sine', 0.22, now);
        this.tone(f * 2, 0.12, 'sine', 0.05, now);
        break;
      }
      case 'spawnHouse':
        this.tone(784, 0.12, 'sine', 0.15, now);
        this.tone(1046.5, 0.18, 'sine', 0.13, now + 0.08);
        break;
      case 'spawnMarket':
        [523.25, 659.25, 783.99].forEach((f, i) => this.tone(f, 0.25, 'triangle', 0.16, now + i * 0.08));
        break;
      case 'warning':
        this.tone(880, 0.12, 'square', 0.07, now);
        this.tone(880, 0.12, 'square', 0.07, now + 0.18);
        break;
      case 'week':
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone(f, 0.35, 'triangle', 0.18, now + i * 0.11));
        break;
      case 'place':
        this.tone(392, 0.1, 'triangle', 0.25, now);
        this.tone(587.33, 0.16, 'triangle', 0.2, now + 0.06);
        break;
      case 'click':
        this.tone(1200, 0.03, 'sine', 0.12, now);
        break;
      case 'gameOver':
        [392, 349.23, 311.13, 261.63].forEach((f, i) => this.tone(f, 0.5, 'triangle', 0.22, now + i * 0.22));
        break;
    }
  }

  /** Ton mit schneller Attack und exponentiellem Ausklingen; optionaler Pitch-Glide und Tiefpass. */
  private tone(freq: number, dur: number, wave: Wave, vol: number, at: number, glideTo?: number, lowpass?: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = wave;
    osc.frequency.setValueAtTime(freq, at);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, at + dur);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(vol, at + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    let node: AudioNode = osc.connect(gain);
    if (lowpass) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = lowpass;
      node = node.connect(f);
    }
    node.connect(this.master!);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }

  /** Kurzes, hochpassgefiltertes Rauschen (Abriss-"Kratzen"). */
  private noise(dur: number, highpass: number, vol: number, at: number): void {
    const ctx = this.ctx!;
    const len = Math.ceil(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = highpass;
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(this.master!);
    src.start(at);
  }
}
