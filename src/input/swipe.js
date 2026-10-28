// 터치 스위핑: 위아래 문지르기 → 밀기/당기기 스트로크.
// 방향이 바뀌어 threshold 이상 움직일 때마다 스트로크 1회. 같은 방향으로 계속 밀면 추가 스트로크 없음.
export class SwipeStrokeDetector {
  constructor(thresholdPx) {
    this.threshold = thresholdPx;
    this.start(0);
  }

  start(y) {
    this.anchor = y; // 현재 방향의 극점
    this.dir = null;
  }

  /** @returns {'push'|'pull'|null} 위로 = 밀기, 아래로 = 당기기 */
  move(y) {
    const up = this.anchor - y;
    if (this.dir !== 'up' && up >= this.threshold) {
      this.dir = 'up';
      this.anchor = y;
      return 'push';
    }
    if (this.dir !== 'down' && up <= -this.threshold) {
      this.dir = 'down';
      this.anchor = y;
      return 'pull';
    }
    if ((this.dir === 'up' && y < this.anchor) || (this.dir === 'down' && y > this.anchor)) this.anchor = y;
    return null;
  }
}
