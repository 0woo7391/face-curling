import { describe, it, expect } from 'vitest';
import { createConfig } from '../src/config.js';
import { BurnMonitor, updateAssist } from '../src/core/burn.js';
import { broomJudgeRadius } from '../src/core/sweep.js';

const cfg = createConfig();
const far = { x: 10, y: 10 };
const stone = { id: 'nose', x: 0, y: 0 };
const contact = cfg.stoneRadius + broomJudgeRadius(cfg);

describe('BurnMonitor', () => {
  it('몸 접촉은 즉시 번드', () => {
    const m = new BurnMonitor(cfg);
    expect(m.update({ x: 0.1, y: 0 }, far, [stone]).burn).toEqual({ cause: 'body', stoneId: 'nose' });
  });

  it('빗자루는 graceTicks 연속 겹침에서만 번드', () => {
    const m = new BurnMonitor(cfg);
    const broom = { x: 0, y: contact - 0.01 };
    for (let i = 1; i < cfg.graceTicks; i++) expect(m.update(far, broom, [stone]).burn).toBeNull();
    expect(m.update(far, broom, [stone]).burn).toEqual({ cause: 'broom', stoneId: 'nose' });
  });

  it('겹침이 끊기면 카운터가 리셋된다 (짧은 스침 반복은 번드 아님)', () => {
    const m = new BurnMonitor(cfg);
    const inB = { x: 0, y: contact - 0.01 };
    const outB = { x: 0, y: contact + 0.05 };
    for (let k = 0; k < 10; k++) {
      for (let i = 1; i < cfg.graceTicks; i++) expect(m.update(far, inB, [stone]).burn).toBeNull();
      const r = m.update(far, outB, [stone]);
      expect(r.burn).toBeNull();
      expect(r.cushion).toBe(true);
    }
  });

  it('쿠션 구간은 경고만, 판정하지 않는 정지 스톤은 무시', () => {
    const m = new BurnMonitor(cfg);
    const r = m.update(far, { x: 0, y: contact + cfg.cushionWidth / 2 }, [stone]);
    expect(r).toMatchObject({ burn: null, cushion: true });
    expect(m.update({ x: 0, y: 0 }, { x: 0, y: 0 }, []).burn).toBeNull();
  });
});

describe('updateAssist', () => {
  const dt = 1 / cfg.tickRate;
  it('쿠션 안에서 빗자루를 스톤 바깥으로 밀되 assistMax를 넘지 않는다', () => {
    let a = { x: 0, y: 0 };
    const raw = { x: 0, y: contact + 0.02 };
    for (let i = 0; i < 200; i++) a = updateAssist(a, raw, stone, cfg, dt);
    expect(a.y).toBeGreaterThan(0);
    expect(Math.hypot(a.x, a.y)).toBeLessThanOrEqual(cfg.assistMax + 1e-9);
  });
  it('쿠션을 벗어나면 0으로 복귀', () => {
    let a = { x: 0, y: 0.1 };
    for (let i = 0; i < 200; i++) a = updateAssist(a, { x: 0, y: 2 }, stone, cfg, dt);
    expect(a).toEqual({ x: 0, y: 0 });
  });
});
