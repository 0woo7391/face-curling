// 스위핑 판정 (명세 3.8.3, 3.8 효율 계산 구조).
// 스위핑 강도 s = 입력 효율 × 위치 효율 × 속도 계수, 짧은 접촉 직후에는 0.
import { msToTicks } from '../config.js';

export const broomJudgeRadius = (cfg) => cfg.broomVisualRadius * cfg.broomJudgeScale;

/**
 * 빗자루 접촉점이 스톤 진행 방향 앞쪽 유효 영역 안에 있는 정도 (0..1).
 * 거리(중심 간, 진행 방향 성분) 구간:
 *   [0, contact)            겹침 = 번드 판정 영역 → 0
 *   [contact, best)         쿠션 구간 → cushionEfficiency
 *   best                    효율 최고점 (쿠션 바깥 가장자리)
 *   (best, best+zoneLength] 멀어질수록 감소
 */
export function sweepPositionEfficiency(broom, stone, cfg) {
  const speed = Math.hypot(stone.vx, stone.vy);
  if (speed < 1e-6) return 0;
  const dx = stone.vx / speed;
  const dy = stone.vy / speed;
  const rx = broom.x - stone.x;
  const ry = broom.y - stone.y;
  const along = rx * dx + ry * dy;
  const lat = Math.abs(rx * dy - ry * dx);
  if (lat > cfg.sweepZoneHalfWidth) return 0;

  const contact = cfg.stoneRadius + broomJudgeRadius(cfg);
  const best = contact + cfg.cushionWidth;
  const end = best + cfg.sweepZoneLength;
  const latFactor = 1 - (0.5 * lat) / cfg.sweepZoneHalfWidth;
  if (along < contact || along > end) return 0;
  if (along < best) return cfg.cushionEfficiency * latFactor;
  return (1 - (0.7 * (along - best)) / cfg.sweepZoneLength) * latFactor;
}

/**
 * 밀기(좌클릭) → 당기기(우클릭) 교대 스트로크 상태 기계.
 * - 기대 순서와 다른 버튼, 스트로크 애니메이션 진행 중 입력은 인정하지 않는다.
 * - 효력은 버튼을 누른 순간이 아니라 스트로크 애니메이션이 끝나는 틱에 부여한다.
 */
export class SweepController {
  constructor(cfg) {
    this.cfg = cfg;
    this.reset();
  }

  reset() {
    this.expect = 'push';
    this.anim = null;
    this.validTicks = [];
    this.history = []; // 최근 스트로크 [{kind, valid}]
    this.intensity = 0;
    this.inputEfficiency = 0;
    this.restOffset = -0.5;
    this.penaltyUntil = -1;
    this.lastResult = null;
  }

  /** @returns {'started'|'rejected-busy'|'rejected-order'|'ignored'} */
  press(button, tick) {
    const kind = button === 0 ? 'push' : button === 2 ? 'pull' : null;
    let result;
    if (!kind) result = 'ignored';
    else if (this.anim) result = 'rejected-busy';
    else if (kind !== this.expect) result = 'rejected-order';
    else {
      this.anim = { kind, start: tick, end: tick + msToTicks(this.cfg.strokeDurationMs, this.cfg) };
      result = 'started';
    }
    this.lastResult = result;
    return result;
  }

  penalize(tick) {
    this.penaltyUntil = tick + msToTicks(this.cfg.shortContactPenaltyMs, this.cfg);
  }

  /** 빗자루 진행 방향 오프셋 (strokeAmp 배수, -0.5..0.5) */
  strokeOffset(tick) {
    if (!this.anim) return this.restOffset;
    const p = Math.min(1, Math.max(0, (tick - this.anim.start) / (this.anim.end - this.anim.start)));
    return this.anim.kind === 'push' ? -0.5 + p : 0.5 - p;
  }

  update(tick, posEff, speedFactor) {
    const { cfg } = this;
    if (this.anim && tick >= this.anim.end) {
      const valid = posEff > 0;
      if (valid) this.validTicks.push(tick);
      this.history.push({ kind: this.anim.kind, valid });
      if (this.history.length > 8) this.history.shift();
      this.restOffset = this.anim.kind === 'push' ? 0.5 : -0.5;
      this.expect = this.anim.kind === 'push' ? 'pull' : 'push';
      this.anim = null;
    }
    const windowTicks = msToTicks(cfg.strokeWindowMs, cfg);
    while (this.validTicks.length && this.validTicks[0] <= tick - windowTicks) this.validTicks.shift();

    this.inputEfficiency = Math.min(1, this.validTicks.length / cfg.strokesForFullInput);
    if (tick < this.penaltyUntil) {
      this.intensity = 0; // 짧은 접촉: 즉시 0 (명세 3.8.2)
      return 0;
    }
    const raw = this.inputEfficiency * posEff * speedFactor;
    const alpha = Math.min(1, 1000 / cfg.tickRate / cfg.sweepSmoothingMs);
    this.intensity += (raw - this.intensity) * alpha;
    if (this.intensity < 1e-4) this.intensity = 0;
    return this.intensity;
  }

  /** 초당 유효 왕복 수 (밀기+당기기 = 1회) */
  roundTripsPerSecond() {
    return this.validTicks.length / 2 / (this.cfg.strokeWindowMs / 1000);
  }
}
