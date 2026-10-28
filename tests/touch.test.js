import { describe, it, expect } from 'vitest';
import { SwipeStrokeDetector, HandTracker } from '../src/input/swipe.js';
import { newGame, throwPart, runUntil } from './helpers.js';

describe('SwipeStrokeDetector', () => {
  it('방향이 바뀔 때마다 한 번: 값이 커지는 쪽(오른쪽) = push, 작아지는 쪽 = pull', () => {
    const d = new SwipeStrokeDetector(14);
    d.start(500);
    const out = [];
    for (const y of [505, 515, 530, 550, 540, 520, 510, 530, 560]) {
      const s = d.move(y);
      if (s) out.push(s);
    }
    expect(out).toEqual(['push', 'pull', 'push']);
  });

  it('같은 방향으로 계속 밀거나 threshold 미만 떨림은 무시', () => {
    const d = new SwipeStrokeDetector(14);
    d.start(500);
    const out = [];
    for (const y of [520, 600, 700, 695, 704, 691, 700]) {
      const s = d.move(y);
      if (s) out.push(s);
    }
    expect(out).toEqual(['push']);
  });
});

describe('조이스틱', () => {
  it('기울이는 동안만 목표점이 움직이고, 놓으면 월드에 고정된다', async () => {
    const g = await newGame();
    throwPart(g, 'nose', { power: 0.5 });
    const t0 = { ...g.character.target };
    g.enqueue({ type: 'joy', x: 0, y: 1 });
    for (let i = 0; i < 30; i++) g.tick();
    const t1 = { ...g.character.target };
    expect(t1.y - t0.y).toBeCloseTo(g.cfg.joyMaxSpeed * 0.5, 1);
    g.enqueue({ type: 'joy', x: 0, y: 0 });
    for (let i = 0; i < 30; i++) g.tick();
    expect(g.character.target).toEqual(t1);
  });

  it('살짝 기울이면 비선형으로 더 느리다', async () => {
    const g = await newGame();
    throwPart(g, 'nose', { power: 0.5 });
    const t0 = g.character.target.x;
    g.enqueue({ type: 'joy', x: 0.3, y: 0 });
    for (let i = 0; i < 60; i++) g.tick();
    expect(g.character.target.x - t0).toBeLessThan(g.cfg.joyMaxSpeed * 0.3 * 0.5);
  });

  it('투구마다 조이스틱 상태가 초기화된다', async () => {
    const g = await newGame();
    throwPart(g, 'nose', { power: 0.3 });
    g.enqueue({ type: 'joy', x: 1, y: 0 });
    runUntil(g, () => g.state === 'PART_SELECT');
    throwPart(g, 'mouth', { power: 0.3 });
    expect(g.joy).toEqual({ x: 0, y: 0 });
  });
});

describe('HandTracker', () => {
  it('-1..1로 제한되고, 한쪽으로 흘러가도 기준점이 따라온다', () => {
    const h = new HandTracker(40);
    h.start(100);
    expect(h.move(140)).toBeGreaterThan(0.8);
    expect(h.move(0)).toBe(-1);
    let v = 0;
    for (let i = 0; i < 200; i++) v = h.move(300);
    expect(Math.abs(v)).toBeLessThan(0.05);
  });
});
