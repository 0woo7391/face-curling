import { describe, it, expect } from 'vitest';
import { createConfig } from '../src/config.js';
import { SweepController, sweepPositionEfficiency, broomJudgeRadius } from '../src/core/sweep.js';

const cfg = createConfig();

describe('SweepController', () => {
  it('밀기→당기기 순서만 인정하고 같은 버튼 반복·진행 중 입력은 거부한다', () => {
    const c = new SweepController(cfg);
    expect(c.press(2, 0)).toBe('rejected-order');
    expect(c.press(0, 0)).toBe('started');
    expect(c.press(2, 1)).toBe('rejected-busy');
    for (let t = 1; t <= 10; t++) c.update(t, 1, 1);
    expect(c.press(0, 11)).toBe('rejected-order');
    expect(c.press(2, 11)).toBe('started');
  });

  it('유효 영역 밖에서 끝난 스트로크는 효율에 반영되지 않는다', () => {
    const c = new SweepController(cfg);
    let t = 0;
    for (let i = 0; i < 6; i++) {
      c.press(i % 2 ? 2 : 0, t);
      for (let k = 0; k < 8; k++) c.update(++t, 0, 1);
    }
    expect(c.inputEfficiency).toBe(0);
    expect(c.intensity).toBe(0);
  });

  it('유효 교대 스트로크를 이어가면 강도가 오르고, 멈추면 0으로 돌아간다', () => {
    const c = new SweepController(cfg);
    let t = 0;
    for (let i = 0; i < 12; i++) {
      c.press(i % 2 ? 2 : 0, t);
      for (let k = 0; k < 8; k++) c.update(++t, 1, 1);
    }
    expect(c.intensity).toBeGreaterThan(0.8);
    for (let k = 0; k < 120; k++) c.update(++t, 1, 1);
    expect(c.intensity).toBe(0);
  });

  it('짧은 접촉 패널티 동안 강도 0', () => {
    const c = new SweepController(cfg);
    let t = 0;
    for (let i = 0; i < 8; i++) {
      c.press(i % 2 ? 2 : 0, t);
      for (let k = 0; k < 8; k++) c.update(++t, 1, 1);
    }
    c.penalize(t);
    for (let k = 0; k < 15; k++) c.update(++t, 1, 1);
    expect(c.intensity).toBeLessThan(0.05);
  });
});

describe('sweepPositionEfficiency', () => {
  const stone = { x: 0, y: 0, vx: 0, vy: 2 };
  const contact = cfg.stoneRadius + broomJudgeRadius(cfg);
  it('겹침 영역 0, 쿠션 구간 cushionEfficiency, 쿠션 바깥 가장자리 최고', () => {
    expect(sweepPositionEfficiency({ x: 0, y: contact - 0.01 }, stone, cfg)).toBe(0);
    expect(sweepPositionEfficiency({ x: 0, y: contact + 0.01 }, stone, cfg)).toBeCloseTo(cfg.cushionEfficiency);
    expect(sweepPositionEfficiency({ x: 0, y: contact + cfg.cushionWidth }, stone, cfg)).toBeCloseTo(1);
  });
  it('스톤 뒤쪽·옆으로 벗어나면 0', () => {
    expect(sweepPositionEfficiency({ x: 0, y: -0.5 }, stone, cfg)).toBe(0);
    expect(sweepPositionEfficiency({ x: 0.5, y: 0.4 }, stone, cfg)).toBe(0);
  });
});
