import { describe, it, expect } from 'vitest';
import { newGame, throwPart, sweepBot, runUntil, settledOrDone } from './helpers.js';
import { FixedStepper } from '../src/core/stepper.js';
import { separation } from '../src/core/shape.js';

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
    // 실제 크기 코는 앞쪽이 길어 봇이 스톤 앞에 늦게 자리 잡고, 스위핑은 미세 조정 정도 (약 +0.25 m)
    expect(g2.sim.stones.get('nose').y).toBeGreaterThan(g1.sim.stones.get('nose').y + 0.15);
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
    // 입은 폭이 넓어 몸이 먼저 닿으므로 폭이 좁은 눈으로 빗자루 번드를 낸다
    throwPart(g, 'left_eye', { power: 0.8 });
    // 빗자루를 스톤 경로 정면 5m 앞에 세워 둔다
    g.enqueue({ type: 'moveAbs', x: -g.cfg.broomReach, y: 5 });
    runUntil(g, () => g.state === 'BURN_RESOLVE');
    expect(g.burn.cause).toBe('broom');
    runUntil(g, settledOrDone(g));
    expect(g.parts.find((p) => p.id === 'left_eye').status).toBe('burned');
    expect(g.sim.stones.has('left_eye')).toBe(false);
    expect(g.sim.stones.get('nose')).toMatchObject(nosePos);
    expect(g.selectPart('left_eye')).toBe(false);
  });

  it('연습 모드 번드: 같은 부위 재투구', async () => {
    const g = await newGame('practice');
    throwPart(g, 'mouth', { power: 0.8 });
    g.enqueue({ type: 'moveAbs', x: 0, y: 5 }); // 몸이 경로 위
    runUntil(g, () => g.state === 'THROW');
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

describe('사진 얼굴', () => {
  it('정답이 가까우면 스톤 모양을 같은 비율로 줄여 정답 자리끼리 겹치지 않게 한다', async () => {
    const g = await newGame();
    expect(g.shapeScale).toBe(1);
    const anchor = (x, y) => ({ anchor: { x, y } });
    g.setFace({
      faceBox: { x0: 0.25, y0: 0.15, x1: 0.75, y1: 0.85 },
      parts: { left_brow: anchor(0.4, 0.37), right_brow: anchor(0.6, 0.37), left_eye: anchor(0.41, 0.415), right_eye: anchor(0.6, 0.415), nose: anchor(0.5, 0.52), mouth: anchor(0.5, 0.64) },
    });
    expect(g.shapeScale).toBeLessThan(1);
    const placed = g.parts.map((p) => {
      const at = g.board.qToWorld(p.q);
      return p.hull.map((v) => ({ x: at.x + v.x, y: at.y + v.y }));
    });
    for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) expect(separation(placed[i], placed[j])).toBeGreaterThanOrEqual(g.cfg.layoutMargin - 1e-6);
    expect(g.parts.find((p) => p.id === 'left_eye').q).toEqual({ x: 0.41, y: 0.415 });
    expect(g.faceDiagonal).toBeCloseTo(Math.hypot(0.5, 0.7));
    g.setFace(null);
    expect(g.shapeScale).toBe(1);
  });
});

describe('투구 단순화 (THROW)', () => {
  it('한 번에 방향·파워, 방향은 ±maxAimDeg로 제한, 덜 당기면 발사 안 함', async () => {
    const g = await newGame();
    g.selectPart('nose');
    expect(g.state).toBe('THROW');
    g.setThrow(1, 2);
    expect(g.aimAngle).toBeCloseTo((g.cfg.maxAimDeg * Math.PI) / 180);
    expect(g.power).toBe(1);
    g.setThrow(0, g.cfg.minPower / 2);
    expect(g.release()).toBe(false);
    expect(g.state).toBe('THROW');
    g.setSpin(0.5);
    g.setThrow(0.05, 0.7);
    expect(g.release()).toBe(true);
    expect(g.state).toBe('SWEEP');
    expect(g.currentStone.spin).toBe(0.5);
  });
  it('back은 부위 선택으로', async () => {
    const g = await newGame();
    g.selectPart('nose');
    g.back();
    expect(g.state).toBe('PART_SELECT');
    expect(g.selectPart('nose')).toBe(true);
  });
});

describe('스위핑 보조 (sweepAssist)', () => {
  const scrub = (g) => {
    let n = 0;
    return () => {
      if (g.state === 'SWEEP' && ++n % 8 === 0) g.enqueue({ type: 'press', button: g.sweep.expect === 'push' ? 0 : 2 });
    };
  };
  it('문지르기만 해도 효율 높은 스위핑이 되고 더 멀리 간다, 번드 없음', async () => {
    const a = await newGame('record', { sweepAssist: true });
    throwPart(a, 'nose', { power: 0.6 });
    runUntil(a, settledOrDone(a));
    const b = await newGame('record', { sweepAssist: true });
    throwPart(b, 'nose', { power: 0.6 });
    runUntil(b, settledOrDone(b), scrub(b));
    expect(b.stats.lastThrow.avgSweep).toBeGreaterThan(0.5);
    expect(b.sim.stones.get('nose').y).toBeGreaterThan(a.sim.stones.get('nose').y + 1);
    expect(b.stats.burnsBody + b.stats.burnsBroom).toBe(0);
  });
  it('회전을 준 스톤도 따라간다', async () => {
    const g = await newGame('record', { sweepAssist: true });
    throwPart(g, 'left_eye', { power: 0.75, spin: -1, aimX: 2 });
    runUntil(g, settledOrDone(g), scrub(g));
    expect(g.stats.lastThrow.avgSweep).toBeGreaterThan(0.5);
  });
  it('흔드는 자리 쪽으로 스톤이 끌린다 (왼쪽 −, 오른쪽 +, 1 m 안팎)', async () => {
    const endX = async (steer) => {
      const g = await newGame('record', { sweepAssist: true });
      throwPart(g, 'nose', { power: 0.6 });
      const sc = scrub(g);
      runUntil(g, settledOrDone(g), () => {
        g.enqueue({ type: 'steer', x: steer });
        sc();
      });
      return g.sim.stones.get('nose').x;
    };
    const left = await endX(-1);
    const mid = await endX(0);
    const right = await endX(1);
    expect(mid).toBeCloseTo(0, 6);
    expect(left).toBeLessThan(-0.5);
    expect(right).toBeGreaterThan(0.5);
    expect(right).toBeLessThan(1.6);
  });
  it('보조 중에는 캐릭터가 경로에 서 있어도 번드가 없다', async () => {
    const g = await newGame('record', { sweepAssist: true });
    throwPart(g, 'mouth', { power: 0.8 });
    runUntil(g, settledOrDone(g));
    expect(g.stats.burnsBody + g.stats.burnsBroom).toBe(0);
  });
});
