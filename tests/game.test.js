import { describe, it, expect } from 'vitest';
import { newGame, throwPart, sweepBot, runUntil, settledOrDone } from './helpers.js';
import { FixedStepper } from '../src/core/stepper.js';

describe('Game 흐름', () => {
  it('같은 입력이면 같은 결과 (재현성)', async () => {
    const play = async () => {
      const g = await newGame();
      throwPart(g, 'nose', { power: 0.8, spin: 0.4 });
      runUntil(g, settledOrDone(g), sweepBot(g));
      throwPart(g, 'mouth', { power: 0.78, spin: -0.3 });
      runUntil(g, settledOrDone(g), sweepBot(g, { strokeEvery: 9 }));
      return [...g.sim.stones.values()].map((s) => [s.id, s.x, s.y]);
    };
    expect(await play()).toEqual(await play());
  });

  it('스위핑하면 정지 거리가 늘어난다 (충돌 없음, 번드 없음)', async () => {
    const g1 = await newGame();
    throwPart(g1, 'nose', { power: 0.6 });
    runUntil(g1, settledOrDone(g1));
    const g2 = await newGame();
    throwPart(g2, 'nose', { power: 0.6 });
    runUntil(g2, settledOrDone(g2), sweepBot(g2));
    expect(g2.stats.burnsBody + g2.stats.burnsBroom).toBe(0);
    expect(g2.stats.lastThrow.avgSweep).toBeGreaterThan(0.3);
    expect(g2.sim.stones.get('nose').y).toBeGreaterThan(g1.sim.stones.get('nose').y + 0.5);
  });

  it('효율 영역 밖에서 연타만 하면 거리 변화 없음', async () => {
    const g1 = await newGame();
    throwPart(g1, 'nose', { power: 0.6 });
    runUntil(g1, settledOrDone(g1));
    const g2 = await newGame();
    throwPart(g2, 'nose', { power: 0.6 });
    let n = 0;
    runUntil(g2, settledOrDone(g2), () => {
      if (++n % 8 === 0) g2.enqueue({ type: 'press', button: (n / 8) % 2 ? 0 : 2 });
    });
    expect(g2.sim.stones.get('nose').y).toBeCloseTo(g1.sim.stones.get('nose').y, 9);
  });

  it('충돌하면 기존 스톤이 밀리고, 전부 정지할 때까지 다음 투구가 잠긴다', async () => {
    const g = await newGame();
    throwPart(g, 'nose', { power: 0.55 });
    runUntil(g, settledOrDone(g));
    const before = { ...g.sim.stones.get('nose') };
    throwPart(g, 'mouth', { power: 0.8 });
    let lockedWhileMoving = true;
    runUntil(g, settledOrDone(g), () => {
      if (!g.sim.isSettled() && g.selectPart('left_eye')) lockedWhileMoving = false;
    });
    expect(lockedWhileMoving).toBe(true);
    expect(g.sim.collisions).toBeGreaterThan(0);
    expect(g.sim.stones.get('nose').y).toBeGreaterThan(before.y + 0.1);
  });

  it('기록 모드 번드: 다른 스톤은 체크포인트로 복원, 던진 부위는 제거·0점', async () => {
    const g = await newGame('record');
    throwPart(g, 'nose', { power: 0.6 });
    runUntil(g, settledOrDone(g));
    const nosePos = { x: g.sim.stones.get('nose').x, y: g.sim.stones.get('nose').y };
    throwPart(g, 'mouth', { power: 0.8 });
    // 빗자루를 스톤 경로 정면 5m 앞에 세워 둔다
    g.enqueue({ type: 'moveAbs', x: -g.cfg.broomReach, y: 5 });
    runUntil(g, () => g.state === 'BURN_RESOLVE');
    expect(g.burn.cause).toBe('broom');
    runUntil(g, settledOrDone(g));
    expect(g.parts.find((p) => p.id === 'mouth').status).toBe('burned');
    expect(g.sim.stones.has('mouth')).toBe(false);
    expect(g.sim.stones.get('nose')).toMatchObject(nosePos);
    expect(g.selectPart('mouth')).toBe(false);
  });

  it('연습 모드 번드: 같은 부위 재투구', async () => {
    const g = await newGame('practice');
    throwPart(g, 'mouth', { power: 0.8 });
    g.enqueue({ type: 'moveAbs', x: 0, y: 5 }); // 몸이 경로 위
    runUntil(g, () => g.state === 'AIM');
    expect(g.stats.burnsBody).toBe(1);
    expect(g.currentPartId).toBe('mouth');
    expect(g.parts.find((p) => p.id === 'mouth').status).toBe('pending');
  });

  it('6개 투구 후 RESULT, 점수는 0..100', async () => {
    const g = await newGame();
    for (const p of g.parts.map((p) => p.id)) {
      throwPart(g, p, { power: 0.8 });
      runUntil(g, settledOrDone(g), sweepBot(g));
    }
    expect(g.state).toBe('RESULT');
    expect(g.result.rows).toHaveLength(6);
    for (const r of g.result.rows) expect(r.score).toBeGreaterThanOrEqual(0);
    expect(g.result.mean).toBeLessThanOrEqual(100);
  });

  it('기본 레이아웃은 정답 동시 배치가 가능하다', async () => {
    const g = await newGame();
    expect(g.layoutReport().conflicts).toEqual([]);
  });
});

describe('FixedStepper', () => {
  it('60Hz/144Hz/불규칙 프레임 모두 같은 틱 수', () => {
    const count = (frames) => {
      const s = new FixedStepper(60);
      return frames.reduce((n, f) => n + s.advance(f), 0);
    };
    const secs = 10;
    expect(count(Array(60 * secs).fill(1 / 60))).toBe(600);
    expect(count(Array(144 * secs).fill(1 / 144))).toBe(600);
    const irregular = [];
    let t = 0;
    for (let i = 0; t < secs - 1e-9; i++) {
      const f = Math.min([0.004, 0.02, 0.011, 0.033][i % 4], secs - t);
      irregular.push(f);
      t += f;
    }
    expect(count(irregular)).toBe(600);
  });
});

describe('이벤트 스트림', () => {
  it('발사·스트로크·정지·턴 종료 이벤트를 순서대로 내보낸다', async () => {
    const g = await newGame();
    throwPart(g, 'nose', { power: 0.6 });
    runUntil(g, settledOrDone(g), sweepBot(g));
    const types = g.drainEvents().map((e) => e.type);
    expect(types[0]).toBe('select');
    expect(types[1]).toBe('launch');
    expect(types.filter((t) => t === 'stroke').length).toBeGreaterThan(5);
    expect(types).toContain('stop');
    expect(types.at(-1)).toBe('turnEnd');
    expect(g.drainEvents()).toEqual([]);
  });

  it('충돌 이벤트는 위치와 세기를 가진다', async () => {
    const g = await newGame();
    throwPart(g, 'nose', { power: 0.55 });
    runUntil(g, settledOrDone(g));
    g.drainEvents();
    throwPart(g, 'mouth', { power: 0.8 });
    runUntil(g, settledOrDone(g));
    const hit = g.drainEvents().find((e) => e.type === 'collision');
    expect(hit).toMatchObject({ a: expect.any(String), b: expect.any(String) });
    expect(hit.impulse).toBeGreaterThan(0.5);
    expect(hit.y).toBeGreaterThan(15);
  });

  it('번드 이벤트', async () => {
    const g = await newGame();
    throwPart(g, 'mouth', { power: 0.8 });
    g.enqueue({ type: 'moveAbs', x: 0, y: 5 });
    runUntil(g, () => g.state === 'BURN_RESOLVE');
    expect(g.drainEvents().find((e) => e.type === 'burn')).toMatchObject({ cause: 'body' });
  });

  it('이벤트를 읽든 안 읽든 결과는 같다 (표현 전용)', async () => {
    const play = async (drain) => {
      const g = await newGame();
      throwPart(g, 'nose', { power: 0.7, spin: 0.3 });
      runUntil(g, settledOrDone(g), () => { sweepBot(g)(); if (drain) g.drainEvents(); });
      return [...g.sim.stones.values()].map((s) => [s.x, s.y]);
    };
    expect(await play(true)).toEqual(await play(false));
  });
});
