import { describe, expect, it, vi } from 'vitest';
import { DOUBLE_TAP_MS, isTouchLike, outsidePress, surfaceTap, TAP_SLOP_PX, tapSide } from './touch';

const width = 900;
const press = (pointerType: string | undefined, shown: boolean, panelOpen = false) => ({
  pointerType,
  shown,
  panelOpen,
});

describe('a tap on the picture', () => {
  it('counts a finger and a pen as touch, a mouse (and a TV pointer) not', () => {
    expect(isTouchLike('touch')).toBe(true);
    expect(isTouchLike('pen')).toBe(true);
    expect(isTouchLike('mouse')).toBe(false);
    expect(isTouchLike(undefined)).toBe(false);
  });

  it('plays or pauses on a mouse click, controls up or not', () => {
    for (const shown of [true, false])
      expect(surfaceTap(press('mouse', shown), { at: 0, x: 450, width }, null).action).toBe('togglePlay');
  });

  it('shows the controls on a tap while they are hidden, and hides them on a tap while they are up', () => {
    expect(surfaceTap(press('touch', false), { at: 0, x: 450, width }, null).action).toBe('show');
    expect(surfaceTap(press('touch', true), { at: 0, x: 450, width }, null).action).toBe('hide');
    expect(surfaceTap(press('pen', true), { at: 0, x: 450, width }, null).action).toBe('hide');
  });

  it('only closes an open panel, by mouse or by finger', () => {
    for (const type of ['mouse', 'touch'])
      expect(surfaceTap(press(type, true, true), { at: 0, x: 450, width }, null)).toEqual({
        action: 'closePanel',
        last: null,
      });
  });

  it('skips back or forward on a second quick tap on the same side, and again on a third', () => {
    const first = surfaceTap(press('touch', false), { at: 1000, x: 100, width }, null);
    expect(first.action).toBe('show'); // at once: a single tap isn't held up waiting for a second
    const second = surfaceTap(press('touch', true), { at: 1000 + DOUBLE_TAP_MS, x: 120, width }, first.last);
    expect(second.action).toBe('back');
    const third = surfaceTap(press('touch', true), { at: 1500, x: 110, width }, second.last);
    expect(third.action).toBe('back');

    const right = surfaceTap(press('touch', true), { at: 5000, x: 800, width }, null);
    expect(surfaceTap(press('touch', false), { at: 5200, x: 820, width }, right.last).action).toBe('forward');
  });

  it("doesn't skip on taps too far apart in time, on different sides, or in the middle", () => {
    const left = surfaceTap(press('touch', false), { at: 1000, x: 100, width }, null);
    expect(
      surfaceTap(press('touch', true), { at: 1001 + DOUBLE_TAP_MS, x: 100, width }, left.last).action,
    ).toBe('hide');
    expect(surfaceTap(press('touch', true), { at: 1100, x: 800, width }, left.last).action).toBe('hide');
    const middle = surfaceTap(press('touch', false), { at: 1000, x: 450, width }, null);
    expect(surfaceTap(press('touch', true), { at: 1100, x: 450, width }, middle.last).action).toBe('hide');
    // Nor a mouse's double click, which is full screen's.
    expect(surfaceTap(press('mouse', true), { at: 1100, x: 100, width }, left.last).action).toBe(
      'togglePlay',
    );
  });

  it('splits the picture in thirds for skipping', () => {
    expect(tapSide(0, 300)).toBe('back');
    expect(tapSide(99, 300)).toBe('back');
    expect(tapSide(150, 300)).toBeNull();
    expect(tapSide(201, 300)).toBe('forward');
    expect(tapSide(10, 0)).toBeNull();
  });
});

describe('a press outside a panel', () => {
  const inside = document.createElement('div');
  const outside = document.createElement('div');
  const setup = () => {
    const onClose = vi.fn();
    return { onClose, press: outsidePress((t) => t === inside, onClose) };
  };
  const at = (target: EventTarget, pointerType: string, x = 10, y = 10, pointerId = 1) => ({
    target,
    pointerType,
    clientX: x,
    clientY: y,
    pointerId,
  });

  it('closes the panel as a mouse button goes down outside it', () => {
    const { onClose, press } = setup();
    press.down(at(outside, 'mouse'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('leaves it open for a press inside, by mouse or by finger', () => {
    const { onClose, press } = setup();
    press.down(at(inside, 'mouse'));
    press.down(at(inside, 'touch'));
    press.up(at(inside, 'touch'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes it on a tap outside: once the finger lifts where it went down', () => {
    const { onClose, press } = setup();
    press.down(at(outside, 'touch', 100, 100));
    expect(onClose).not.toHaveBeenCalled();
    press.up(at(outside, 'touch', 100 + TAP_SLOP_PX, 100 - TAP_SLOP_PX));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('leaves it open when a finger outside scrolls or drags instead', () => {
    const { onClose, press } = setup();
    // The browser took the touch for a scroll.
    press.down(at(outside, 'touch'));
    press.cancel();
    press.up(at(outside, 'touch'));
    // It moved before lifting.
    press.down(at(outside, 'pen', 100, 100));
    press.up(at(outside, 'pen', 100, 100 + TAP_SLOP_PX + 1));
    // Another finger lifted.
    press.down(at(outside, 'touch', 100, 100, 1));
    press.up(at(outside, 'touch', 100, 100, 2));
    expect(onClose).not.toHaveBeenCalled();
  });
});
