import { describe, it, expect } from 'vitest';
import { radialOutline, polygonArea, separation, support, fitShapeScales, tiltOf, convexHull } from '../src/core/shape.js';
import { newGame, throwPart, runUntil, settledOrDone } from './helpers.js';

const square = (cx, cy, h) => [
  { x: cx - h, y: cy - h },
  { x: cx + h, y: cy - h },
  { x: cx + h, y: cy + h },
  { x: cx - h, y: cy + h },
];

describe('모양 유틸', () => {
  it('광선 윤곽: 타원 마스크 넓이 오차 5% 미만', () => {
    const a = 40;
    const b = 15;
    const inside = (x, y) => ((x - 50) / a) ** 2 + ((y - 50) / b) ** 2 <= 1;
    const poly = radialOutline(inside, 50, 50, 100);
    const err = Math.abs(polygonArea(poly) - Math.PI * a * b) / (Math.PI * a * b);
    expect(err).toBeLessThan(0.05);
  });

  it('분리 거리: 떨어지면 양수, 겹치면 음수', () => {
    expect(separation(square(0, 0, 1), square(3, 0, 1))).toBeCloseTo(1);
    expect(separation(square(0, 0, 1), square(1.5, 0, 1))).toBeCloseTo(-0.5);
  });

  it('지지 함수는 회전을 따른다', () => {
    const bar = [{ x: -1, y: -0.1 }, { x: 1, y: -0.1 }, { x: 1, y: 0.1 }, { x: -1, y: 0.1 }];
    expect(support(bar, 0, 1, 0)).toBeCloseTo(1);
    expect(support(bar, Math.PI / 2, 1, 0)).toBeCloseTo(0.1);
  });

  it('겹치는 쌍만 여유값만큼 떨어질 때까지 줄이고, 떨어진 부위는 그대로 둔다', () => {
    const hull = convexHull(square(0, 0, 1));
    const k = fitShapeScales([{ hull, at: { x: 0, y: 0 } }, { hull, at: { x: 1.5, y: 0 } }, { hull, at: { x: 0, y: 5 } }], 0.1);
    expect(k[0]).toBeLessThan(1);
    expect(1.5 - k[0] - k[1]).toBeGreaterThanOrEqual(0.1);
    expect(1.5 - k[0] - k[1]).toBeLessThan(0.15);
    expect(k[2]).toBe(1);
  });

  it('기울기는 0..π로 접는다', () => {
    expect(tiltOf(0)).toBe(0);
    expect(tiltOf(-Math.PI / 2)).toBeCloseTo(Math.PI / 2);
    expect(tiltOf(3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(tiltOf(2 * Math.PI + 0.1)).toBeCloseTo(0.1);
  });
});

describe('모양 스톤 물리', () => {
  it('회전 없이 던지면 똑바로 멈추고, 회전을 주면 돈다 (시계 = 각도 −)', async () => {
    const g1 = await newGame();
    throwPart(g1, 'nose', { power: 0.6 });
    runUntil(g1, settledOrDone(g1));
    expect(g1.sim.stones.get('nose').angle).toBeCloseTo(0, 6);

    const g2 = await newGame();
    throwPart(g2, 'nose', { power: 0.6, spin: 0.5 });
    const y0 = g2.sim.stones.get('nose').y;
    for (let i = 0; i < 30; i++) g2.tick();
    expect(g2.sim.stones.get('nose').angle).toBeLessThan(0); // 시계 방향
    runUntil(g2, settledOrDone(g2));
    const s = g2.sim.stones.get('nose');
    // 진행 거리 × spin × spinTurnRate 만큼. 각도는 (−π, π]로 감기므로 차이를 감아서 비교
    const expected = -0.5 * g2.cfg.spinTurnRate * (s.y - y0);
    const diff = Math.atan2(Math.sin(s.angle - expected), Math.cos(s.angle - expected));
    expect(Math.abs(diff)).toBeLessThan(0.2);
  });

  it('기울기만큼 감점: 90°면 30%', async () => {
    const g = await newGame();
    for (const p of g.parts) g.sim.placeStone(p.id, g.board.qToWorld(p.q).x, g.board.qToWorld(p.q).y, 0, 0, 0, p.id === 'mouth' ? Math.PI / 2 : 0);
    for (const p of g.parts) p.status = 'stopped';
    const rows = g.computeScores().rows;
    expect(rows.find((r) => r.id === 'nose').score).toBeCloseTo(100);
    expect(rows.find((r) => r.id === 'mouth').score).toBeCloseTo(70);
  });

  it('큰 스톤일수록 충돌 이벤트의 질량이 크다', async () => {
    const hit = async (a, b) => {
      const g = await newGame();
      g.sim.placeStone(a, 0, 3);
      g.sim.placeStone(b, 0, 0, 0, 3);
      for (let i = 0; i < 120; i++) {
        const { hits } = g.sim.step(null);
        if (hits.length) return hits[0].mass;
      }
      throw new Error('no hit');
    };
    expect(await hit('mouth', 'nose')).toBeGreaterThan(await hit('left_brow', 'right_brow'));
  });
});
