import { describe, it, expect } from 'vitest';
import { createConfig } from '../src/config.js';
import { stepStoneVelocity, predictPath, launchVelocity } from '../src/core/curling.js';

const cfg = createConfig();
const dt = 1 / cfg.tickRate;

describe('stepStoneVelocity', () => {
  it('감속량이 속도보다 크면 0이 되고 방향이 뒤집히지 않는다', () => {
    const v = stepStoneVelocity(0, cfg.stopSpeed + 0.001, 0, 0, cfg, dt);
    expect(v).toEqual({ x: 0, y: 0 });
  });

  it('곡률은 속력을 바꾸지 않는다', () => {
    const v = stepStoneVelocity(0, 3, 1, 0, cfg, dt);
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(3 - cfg.friction * dt, 10);
  });

  it('시계 방향(+) 회전은 오른쪽(+x), 반시계는 왼쪽으로 휜다', () => {
    const v = launchVelocity(0, 0.8, cfg);
    const cw = predictPath(0, 0, v.x, v.y, 1, cfg).end;
    const ccw = predictPath(0, 0, v.x, v.y, -1, cfg).end;
    const none = predictPath(0, 0, v.x, v.y, 0, cfg).end;
    expect(cw.x).toBeGreaterThan(0.2);
    expect(ccw.x).toBeCloseTo(-cw.x, 6);
    expect(none.x).toBeCloseTo(0, 9);
  });

  it('스위핑하면 더 멀리 가고 덜 휜다', () => {
    let a = { x: 0, y: 3 }, b = { x: 0, y: 3 };
    const pa = { x: 0, y: 0 }, pb = { x: 0, y: 0 };
    for (let i = 0; i < 60 * 30; i++) {
      a = stepStoneVelocity(a.x, a.y, 1, 0, cfg, dt);
      b = stepStoneVelocity(b.x, b.y, 1, 1, cfg, dt);
      pa.x += a.x * dt; pa.y += a.y * dt;
      pb.x += b.x * dt; pb.y += b.y * dt;
    }
    expect(pb.y).toBeGreaterThan(pa.y * 1.1); // 끝까지 쓸면 약 13% 더 감
    expect(Math.abs(pb.x) / pb.y).toBeLessThan(Math.abs(pa.x) / pa.y);
  });

  it('최대 파워는 보드를 넘고 최소 파워는 보드에 못 미친다', () => {
    const end = (p) => predictPath(0, 0, 0, launchVelocity(0, p, cfg).y, 0, cfg).end.y;
    expect(end(1)).toBeGreaterThan(cfg.boardCenterY + cfg.boardSize / 2);
    expect(end(0)).toBeLessThan(cfg.boardCenterY - cfg.boardSize / 2);
  });

  it('파워는 멈출 거리에 고르게 대응한다 (보드 근처에서 1%당 0.15 m 이하)', () => {
    const end = (p) => predictPath(0, 0, 0, launchVelocity(0, p, cfg).y, 0, cfg).end.y;
    expect(end(0)).toBeCloseTo(cfg.minThrowDist, 0);
    expect(end(1)).toBeCloseTo(cfg.maxThrowDist, 0);
    expect(end(0.58) - end(0.57)).toBeLessThan(0.15);
  });
});

describe('회전과 스위핑으로 휘는 길 조절', () => {
  // 처음부터 sweepFrom(m) 지점 이후 계속 쓸 때, 24 m에서 멈추도록 파워를 맞춘 뒤 옆으로 휜 거리
  const lateralAt24 = (sweepFrom) => {
    const sim = (power) => {
      let v = launchVelocity(0, power, cfg);
      let x = 0;
      let y = 0;
      for (let i = 0; i < 7200; i++) {
        v = stepStoneVelocity(v.x, v.y, 1, sweepFrom != null && y > sweepFrom ? 1 : 0, cfg, dt);
        if (!v.x && !v.y) break;
        x += v.x * dt;
        y += v.y * dt;
      }
      return { x, y };
    };
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 30; i++) {
      const m = (lo + hi) / 2;
      if (sim(m).y < 24) lo = m;
      else hi = m;
    }
    return sim(lo).x;
  };

  it('●●로 24 m 가면 1 m 넘게 휜다', () => {
    expect(lateralAt24(null)).toBeGreaterThan(1.2);
  });

  it('같은 자리에 멈춰도 일찍부터 쓸수록 덜 휜다', () => {
    const none = lateralAt24(null);
    const late = lateralAt24(16);
    const early = lateralAt24(0);
    expect(late).toBeLessThan(none);
    expect(early).toBeLessThan(late);
    expect(early).toBeLessThan(none * 0.4);
  });
});
