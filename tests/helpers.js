import R from '@dimforge/rapier2d-compat';
import { createConfig } from '../src/config.js';
import { Game } from '../src/core/game.js';
import { broomJudgeRadius } from '../src/core/sweep.js';

let ready = null;
export async function rapier() {
  ready ??= R.init();
  await ready;
  return R;
}

/** 기존 테스트는 v1.2 규칙(직접 이동 + 번드)을 검증하므로 기본은 보조 끔 */
export async function newGame(mode = 'record', overrides = {}) {
  return new Game(await rapier(), createConfig({ sweepAssist: false, ...overrides }), mode);
}

/** 부위 선택 → 조준 → 회전 → 파워 → 발사 */
export function throwPart(game, id, { aimX = 0, spin = 0, power = 0.8 } = {}) {
  if (!game.selectPart(id)) throw new Error(`select failed: ${id} in ${game.state}`);
  game.setSpin(spin);
  game.setThrow(Math.atan2(aimX, 20), power);
  if (!game.release()) throw new Error('release failed');
}

/**
 * 스위핑 봇: 매 틱 빗자루가 스톤 앞 효율 최고점에 오도록 캐릭터 목표를 절대 좌표로 지정하고,
 * strokeEvery 틱마다 밀기/당기기를 교대로 누른다. 몸은 경로에서 broomReach만큼 옆에 있다.
 */
export function sweepBot(game, { strokeEvery = 8, ahead = 0.15 } = {}) {
  let n = 0;
  let next = 0;
  return () => {
    const s = game.currentStone;
    if (game.state !== 'SWEEP' || !s || s.status !== 'moving') return;
    const cfg = game.cfg;
    const sp = Math.hypot(s.vx, s.vy);
    const dx = s.vx / sp;
    const dy = s.vy / sp;
    const best = cfg.stoneRadius + broomJudgeRadius(cfg) + cfg.cushionWidth + ahead;
    const bx = s.x + dx * best;
    const by = s.y + dy * best;
    // 빗자루가 아직 스톤 앞에 있지 않으면 경로 옆으로 비켜서 먼저 앞질러 간다
    const b = game.broom;
    const along = (b.x - s.x) * dx + (b.y - s.y) * dy;
    if (along < best) game.enqueue({ type: 'moveAbs', x: bx - cfg.broomReach - 0.5, y: by + 1 });
    else game.enqueue({ type: 'moveAbs', x: bx - cfg.broomReach, y: by });
    if (++n % strokeEvery === 0) {
      game.enqueue({ type: 'press', button: next });
      next = next === 0 ? 2 : 0;
    }
  };
}

export function runUntil(game, pred, perTick = null, maxTicks = 60 * 120) {
  for (let i = 0; i < maxTicks; i++) {
    if (pred()) return i;
    perTick?.();
    game.tick();
  }
  throw new Error(`timeout in state ${game.state}`);
}

export const settledOrDone = (game) => () => game.state === 'PART_SELECT' || game.state === 'RESULT';
