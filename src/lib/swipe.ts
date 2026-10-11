/**
 * Where a finger swipe moves through a gallery: a swipe to the left goes to the
 * next item. Taps, short drags and mostly vertical scrolls give 0.
 */
export function swipeStep(dx: number, dy: number, threshold = 50): -1 | 0 | 1 {
  if (Math.abs(dx) < threshold || Math.abs(dx) <= Math.abs(dy)) return 0;
  return dx < 0 ? 1 : -1;
}
