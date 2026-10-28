// 고정 시간간격 루프 (명세 5.2). 화면 프레임 간격과 무관하게 같은 틱 수를 만든다.
export class FixedStepper {
  constructor(tickRate, maxFrameSeconds = 0.25) {
    this.dt = 1 / tickRate;
    this.maxFrame = maxFrameSeconds;
    this.acc = 0;
  }

  /** @returns 이번 프레임에 실행할 틱 수 */
  advance(frameSeconds) {
    this.acc += Math.min(this.maxFrame, frameSeconds);
    let n = 0;
    // 부동소수 누적 오차로 틱이 하나 빠지지 않도록 작은 여유를 둔다
    while (this.acc + 1e-9 >= this.dt) {
      this.acc -= this.dt;
      n++;
    }
    return n;
  }

  /** 렌더 보간 계수 0..1 */
  get alpha() {
    return Math.max(0, this.acc / this.dt);
  }
}
