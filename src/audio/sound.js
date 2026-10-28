// 효과음 (Web Audio 합성). 파일이 없어 로딩·용량·라이선스 부담이 없다.
// 게임 이벤트(game.drainEvents)를 받아 소리를 내고, 스톤 굴러가는 소리는 매 프레임 속도로 갱신한다.
// 브라우저 정책상 첫 사용자 입력 뒤에만 소리가 난다 (unlock).

const STORAGE_KEY = 'face-curling-muted';

export class Sound {
  constructor() {
    this.ctx = null;
    try {
      this.muted = localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      this.muted = false;
    }
    this.lastCushion = 0;
    const unlock = () => this.unlock();
    for (const t of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(t, unlock, { capture: true, passive: true });
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    this.master.connect(ctx.destination);

    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // 스톤 굴러가는 저음 루프
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 160;
    this.rumble = ctx.createGain();
    this.rumble.gain.value = 0;
    src.connect(lp).connect(this.rumble).connect(this.master);
    src.start();
  }

  setMuted(m) {
    this.muted = m;
    try {
      localStorage.setItem(STORAGE_KEY, m ? '1' : '0');
    } catch {
      /* 무시 */
    }
    if (this.master) this.master.gain.value = m ? 0 : 0.9;
  }

  // ── 기본 음 ──

  tone({ freq, freqEnd = freq, type = 'sine', gain = 0.1, attack = 0.004, decay = 0.1, delay = 0 }) {
    const { ctx } = this;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t + attack + decay);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + attack + decay + 0.02);
  }

  burst({ freq, freqEnd = freq, filter = 'bandpass', q = 1, gain = 0.15, attack = 0.005, decay = 0.1, delay = 0 }) {
    const { ctx } = this;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t + attack + decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + attack + decay + 0.02);
  }

  // ── 게임 이벤트 → 소리 ──

  handle(events) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    for (const e of events) {
      switch (e.type) {
        case 'select':
          this.tone({ freq: 880, freqEnd: 1320, gain: 0.05, decay: 0.06 });
          break;
        case 'launch':
          this.burst({ freq: 400, freqEnd: 1600, q: 0.8, gain: 0.22, attack: 0.02, decay: 0.35 });
          this.tone({ freq: 140, freqEnd: 60, type: 'triangle', gain: 0.18, decay: 0.18 });
          break;
        case 'stroke':
          if (e.valid) {
            // 강하게 쓸수록 더 높고 크게: 스위핑이 '먹히는' 걸 귀로 느끼게
            this.burst({ freq: 1500 + 2000 * e.intensity, q: 0.9, gain: 0.12 + 0.28 * e.intensity, attack: 0.008, decay: 0.09 });
          } else {
            this.burst({ freq: 500, filter: 'lowpass', gain: 0.06, decay: 0.06 });
          }
          break;
        case 'reject':
          this.tone({ freq: 150, type: 'square', gain: 0.05, decay: 0.07 });
          break;
        case 'cushion':
          if (this.ctx.currentTime - this.lastCushion > 0.25) {
            this.lastCushion = this.ctx.currentTime;
            this.tone({ freq: 1320, gain: 0.05, decay: 0.05 });
          }
          break;
        case 'contact':
          this.tone({ freq: 620, type: 'square', gain: 0.06, decay: 0.06 });
          break;
        case 'collision': {
          // 무거운(큰) 스톤끼리일수록 소리가 낮고 길고 크다. mass = 환산 질량, 0.1 ≈ 작은 부위끼리
          const heavy = Math.min(1, Math.max(0, (e.mass ?? 0.1) - 0.05) / 0.15);
          const k = Math.min(1, (e.impulse / 3) * (0.6 + 0.8 * heavy));
          const low = 1 - 0.45 * heavy;
          this.tone({ freq: 1900 * low, freqEnd: 1100 * low, type: 'triangle', gain: 0.08 + 0.3 * k, decay: 0.06 + 0.06 * heavy });
          this.tone({ freq: 820 * low, freqEnd: 700 * low, gain: 0.06 + 0.22 * k, decay: 0.16 + 0.2 * heavy });
          this.burst({ freq: 4000, filter: 'highpass', gain: 0.05 + 0.15 * k, decay: 0.03 });
          break;
        }
        case 'stop':
          this.tone({ freq: 330, freqEnd: 260, gain: 0.07, decay: 0.12 });
          break;
        case 'out':
          this.tone({ freq: 520, freqEnd: 180, type: 'triangle', gain: 0.12, decay: 0.35 });
          break;
        case 'burn':
          this.tone({ freq: 2100, freqEnd: 2250, gain: 0.12, attack: 0.01, decay: 0.45 });
          this.tone({ freq: 2160, freqEnd: 2050, gain: 0.08, attack: 0.01, decay: 0.45 });
          this.tone({ freq: 110, type: 'sawtooth', gain: 0.08, decay: 0.3 });
          break;
        case 'result':
          [523, 659, 784, 1047].forEach((f, i) => this.tone({ freq: f, type: 'triangle', gain: 0.1, decay: 0.22, delay: i * 0.12 }));
          break;
        default:
          break;
      }
    }
  }

  /** 매 프레임: 가장 빠른 스톤 속도로 굴러가는 소리 크기 */
  update(game) {
    if (!this.rumble) return;
    let v = 0;
    for (const s of game.sim.stones.values()) v = Math.max(v, Math.hypot(s.vx, s.vy));
    this.rumble.gain.setTargetAtTime(Math.min(1, v / 4) * 0.35, this.ctx.currentTime, 0.05);
  }
}
