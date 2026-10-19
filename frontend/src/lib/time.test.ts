import { describe, expect, it } from 'vitest';
import { formatCountdown, remainingMs } from './time';

describe('countdown helpers', () => {
  it('formats minutes and seconds, rounding partial seconds up', () => {
    expect(formatCountdown(125_000)).toBe('2:05');
    expect(formatCountdown(60_000)).toBe('1:00');
    expect(formatCountdown(59_001)).toBe('1:00');
    expect(formatCountdown(9_000)).toBe('0:09');
    expect(formatCountdown(0)).toBe('0:00');
  });

  it('uses the server clock, not just the browser clock', () => {
    const endsAt = '2026-10-19T10:05:00.000Z';
    const browserNow = Date.parse('2026-10-19T10:00:00.000Z');
    // the browser clock runs 30 seconds slow compared to the server
    expect(remainingMs(endsAt, 30_000, browserNow)).toBe(270_000);
    expect(remainingMs(endsAt, 0, browserNow)).toBe(300_000);
  });

  it('never goes negative and is zero without a timer', () => {
    expect(remainingMs('2026-10-19T10:00:00.000Z', 0, Date.parse('2026-10-19T11:00:00.000Z'))).toBe(0);
    expect(remainingMs(null, 0)).toBe(0);
  });
});
