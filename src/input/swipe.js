// 문지르기 → 스트로크. 한 축(좌우 흔들기면 clientX)의 값만 받는다.
// 방향이 바뀌어 threshold 이상 움직일 때마다 스트로크 1회. 같은 방향으로 계속 밀면 추가 스트로크 없음.
//   값이 커지는 쪽(오른쪽) = 'push', 작아지는 쪽(왼쪽) = 'pull'
export class SwipeStrokeDetector {
  constructor(thresholdPx) {
    this.threshold = thresholdPx;
    this.start(0);
  }

  start(v) {
    this.anchor = v; // 현재 방향의 극점
    this.dir = null;
  }

  /** @returns {'push'|'pull'|null} */
  move(v) {
    const d = v - this.anchor;
    if (this.dir !== 'plus' && d >= this.threshold) {
      this.dir = 'plus';
      this.anchor = v;
      return 'push';
    }
    if (this.dir !== 'minus' && d <= -this.threshold) {
      this.dir = 'minus';
      this.anchor = v;
      return 'pull';
    }
    if ((this.dir === 'plus' && v > this.anchor) || (this.dir === 'minus' && v < this.anchor)) this.anchor = v;
    return null;
  }
}

/** 흔드는 손의 좌우 위치 → -1..1. 기준점이 천천히 따라와서 손이 한쪽으로 흘러가도 끝에 붙지 않는다 */
export class HandTracker {
  constructor(rangePx) {
    this.range = rangePx;
    this.center = 0;
  }

  start(v) {
    this.center = v;
  }

  move(v) {
    this.center += (v - this.center) * 0.08;
    return Math.max(-1, Math.min(1, (v - this.center) / this.range));
  }
}
