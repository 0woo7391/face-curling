// 커스텀 컬링 물리 (명세 5.2). Rapier는 충돌만 담당하고, 감속·곡률·스위핑은 매 틱 여기서 속도에 반영한다.

const ZERO = Object.freeze({ x: 0, y: 0 });

/**
 * 한 틱 동안의 속도 갱신.
 * - 감속: 속도 반대 방향 일정 크기 μ(s). 감속량이 속도보다 크면 0 (방향 역전 금지).
 * - 곡률: 진행 방향 수직. spin>0(위에서 볼 때 시계 방향) → 진행 방향 오른쪽으로 휨.
 *   곡률은 방향만 바꾸고 속력은 바꾸지 않는다.
 * @param {number} spin  -1..1
 * @param {number} s     스위핑 강도 0..1
 */
export function stepStoneVelocity(vx, vy, spin, s, cfg, dt) {
  const speed = Math.hypot(vx, vy);
  if (speed < cfg.stopSpeed) return ZERO;
  const mu = cfg.friction * (1 - cfg.sweepFrictionReduction * s);
  const newSpeed = speed - mu * dt;
  if (newSpeed < cfg.stopSpeed) return ZERO;

  const dx = vx / speed;
  const dy = vy / speed;
  const curl = (cfg.curlK * spin * (1 - cfg.sweepCurlReduction * s)) / (1 + speed / cfg.curlSpeedRef);
  // 진행 방향 오른쪽 수직 = (dy, -dx)
  const nx = vx + dy * curl * dt;
  const ny = vy - dx * curl * dt;
  const n = Math.hypot(nx, ny);
  return { x: (nx / n) * newSpeed, y: (ny / n) * newSpeed };
}

export function launchVelocity(aimAngle, power, cfg) {
  const speed = cfg.minLaunchSpeed + power * (cfg.maxLaunchSpeed - cfg.minLaunchSpeed);
  return { x: Math.sin(aimAngle) * speed, y: Math.cos(aimAngle) * speed };
}

/**
 * 스위핑·충돌이 없는 가상 경로 (명세 3.7). Rapier와 같은 반암시적 오일러(속도 갱신 → 위치 += v·dt).
 */
export function predictPath(x, y, vx, vy, spin, cfg, sampleEvery = 4, maxTicks = 60 * 60) {
  const dt = 1 / cfg.tickRate;
  const points = [{ x, y }];
  for (let i = 1; i <= maxTicks; i++) {
    const v = stepStoneVelocity(vx, vy, spin, 0, cfg, dt);
    vx = v.x;
    vy = v.y;
    if (vx === 0 && vy === 0) break;
    x += vx * dt;
    y += vy * dt;
    if (i % sampleEvery === 0) points.push({ x, y });
  }
  points.push({ x, y });
  return { points, end: { x, y } };
}
