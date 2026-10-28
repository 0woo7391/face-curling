// POC A 튜닝 값. 모든 수치는 실측 전 시작값이다 (명세 11.2: 임의 확정 금지).
// 단위: 길이 m, 속도 m/s, 가속도 m/s², 시간 ms 또는 tick.
export const DEFAULTS = Object.freeze({
  // ── 물리 (5.2) ──
  tickRate: 60,
  stoneRadius: 0.13,
  friction: 0.35, // μ: 기본 감속
  sweepFrictionReduction: 0.22, // 스위핑 강도 s=1일 때 μ 감소율
  curlK: 0.04, // 곡률 가속 기준값
  curlSpeedRef: 1.2, // 이 속도보다 느려질수록 곡률이 커짐
  sweepCurlReduction: 0.35, // s=1일 때 곡률 감소율
  restitution: 0.88,
  stopSpeed: 0.03,
  stopHoldTicks: 10,
  spinVisualRate: 3, // 손잡이 시각 회전 속도 (rad/s, spin=1 기준)

  // ── 투구 (3.7) ──
  minLaunchSpeed: 2.0,
  maxLaunchSpeed: 4.7,
  minPower: 0.05, // 이보다 약하면 발사하지 않음
  maxAimDeg: 12,
  defaultPreviewPower: 0.75,
  maxPullFraction: 0.32, // 화면 높이의 이 비율만큼 당기면 파워 100%

  // ── 레인·보드 (5.4) — 바꾸면 재시작 ──
  laneWidth: 5.0,
  laneLength: 30, // 레인 끝 y
  backLimitY: -2.5, // 이보다 뒤로 가면 이탈
  boardCenterY: 24,
  boardSize: 4.4, // 1:1 얼굴 이미지가 깔리는 정사각 보드 한 변
  layoutMargin: 0.04, // 정답 간섭 검사 여유값

  // ── 캐릭터·스위핑 (3.8) ──
  sweepAssist: true, // 캐릭터가 스톤 앞에 자동으로 붙음 (플레이어는 문지르기만). 끄면 직접 이동 + 번드
  charSpeed: 6.5,
  charAccel: 40,
  charStartAhead: 2.0, // 투구 시 캐릭터가 스톤보다 앞에서 출발하는 거리
  mouseSensitivity: 0.02, // Pointer Lock 이동량 1px당 월드 이동량 (가로)
  forwardSensitivityScale: 1.5, // 진행 방향 감도 배율 — 레인 전체를 따라가는 마우스 이동량을 줄임
  joyMaxSpeed: 7, // 터치 조이스틱을 끝까지 기울였을 때 목표점 이동 속도
  joyCurve: 1.8, // 조이스틱 반응 곡선 (1 = 선형, 클수록 살짝 기울일 때 더 느림)
  bodyJudgeRadius: 0.22,
  broomReach: 0.75, // 몸 중심 ↔ 빗자루 머리 가로 거리
  broomVisualRadius: 0.16,
  strokeAmp: 0.12, // 직접 이동 모드: 밀기/당기기 왕복 거리 (진행 방향)
  sweepSwing: 0.16, // 흔들기 모드: 손을 끝까지 흔들 때 빗자루가 스톤 앞에서 좌우로 움직이는 폭 (진행 방향에 가로)
  strokeDurationMs: 110,
  strokeBufferMs: 100, // 스트로크가 끝나기 이만큼 전에 들어온 다음 스트로크는 버리지 않고 이어서 시작
  strokeWindowMs: 750,
  strokesForFullInput: 4, // 윈도 안 유효 스트로크가 이만큼이면 입력 효율 100% (초당 약 5회)
  sweepZoneLength: 0.9,
  sweepZoneHalfWidth: 0.25,
  sweepSmoothingMs: 150,
  sweepMinSpeed: 0.3, // 이 속도 아래에서 스위핑 효율이 선형 감소

  // ── 번드 쿠션 (3.8.2, v1.2) ──
  broomJudgeScale: 0.65, // 빗자루 판정 원 = 시각 크기 × 이 비율
  cushionWidth: 0.1,
  cushionEfficiency: 0.85,
  assistSpeed: 0.8, // 자동 회피 보조 속도 (m/s)
  assistMax: 0.12, // 자동 회피 보조 최대 변위
  graceTicks: 4, // 빗자루가 연속 이만큼 겹쳐야 번드
  shortContactPenaltyMs: 300,
  burnFreezeTicks: 30,

  // ── 채점 (6.3) ──
  allowedError: 0.25,
});

// 바꾸면 경기장·충돌체를 다시 만들어야 하는 키
export const STRUCTURAL_KEYS = new Set([
  'stoneRadius', 'restitution', 'laneWidth', 'laneLength', 'backLimitY',
  'boardCenterY', 'boardSize', 'tickRate',
]);

export function createConfig(overrides = {}) {
  return { ...DEFAULTS, ...overrides };
}

export const msToTicks = (ms, cfg) => Math.max(1, Math.round((ms / 1000) * cfg.tickRate));
