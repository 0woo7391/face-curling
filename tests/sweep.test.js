import { describe, it, expect } from 'vitest';
import { createConfig } from '../src/config.js';
import { SweepController, sweepPositionEfficiency, broomJudgeRadius } from '../src/core/sweep.js';

const cfg = createConfig();

describe('SweepController', () => {
  it('첫 스트로크는 어느 쪽이든, 그 뒤로는 번갈아만 인정하고 같은 쪽 반복·진행 중 입력은 거부한다', () => {
    const c = new SweepController(cfg);
    expect(c.press(0, 0)).toBe('started');
    expect(c.press(0, 1)).toBe('rejected-busy'); // 같은 버튼 반복
    for (let t = 1; t <= 10; t++) c.update(t, 1, 1);
    expect(c.press(0, 11)).toBe('rejected-order');
    expect(c.press(2, 11)).toBe('started');
  });

  it('끝나기 직전의 다음 순서 입력은 1개 예약되고, 이른 입력·같은 버튼은 거부된다', () => {
    const c = new SweepController(cfg); // 스트로크 7틱, 버퍼 6틱
    expect(c.press(0, 0)).toBe('started');
    expect(c.press(2, 0)).toBe('rejected-busy'); // 끝나기 7틱 전: 너무 이름
    expect(c.press(0, 3)).toBe('rejected-busy'); // 같은 버튼
    expect(c.press(2, 3)).toBe('buffered');
    expect(c.press(0, 4)).toBe('rejected-busy'); // 예약은 1개까지
    for (let t = 1; t <= 7; t++) c.update(t, 1, 1);
    expect(c.anim.kind).toBe('pull'); // 7틱에 밀기가 끝나자마자 당기기 시작
    expect(c.anim.start).toBe(7);
    for (let t = 8; t <= 14; t++) c.update(t, 1, 1);
    expect(c.history.map((h) => h.kind)).toEqual(['push', 'pull']);
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
