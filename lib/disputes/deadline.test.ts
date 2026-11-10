import { describe, expect, it } from 'vitest';
import { computeDeadline, formatRemaining } from './deadline';

const NOW = new Date('2026-11-10T12:00:00.000Z');
const inHours = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString();

describe('computeDeadline', () => {
  it.each([
    [-1, 'overdue'],
    [0, 'overdue'],
    [0.5, 'critical'],
    [23.9, 'critical'],
    [24, 'urgent'],
    [47.9, 'urgent'],
    [48, 'soon'],
    [167.9, 'soon'],
    [168, 'ok'],
    [20 * 24, 'ok'],
  ] as const)('%s hours left -> %s', (hours, bucket) => {
    expect(computeDeadline(inHours(hours), NOW).bucket).toBe(bucket);
  });

  it('has no clock when PayPal is not waiting on the seller', () => {
    expect(computeDeadline(null, NOW)).toEqual({ dueAt: null, msRemaining: null, bucket: 'none' });
    expect(computeDeadline('not a date', NOW).bucket).toBe('none');
  });

  it('reports remaining time', () => {
    expect(computeDeadline(inHours(30), NOW).msRemaining).toBe(30 * 3_600_000);
  });
});

describe('formatRemaining', () => {
  it('formats days, hours, minutes and overdue', () => {
    expect(formatRemaining(52 * 3_600_000)).toBe('2d 4h');
    expect(formatRemaining(5 * 3_600_000 + 12 * 60_000)).toBe('5h 12m');
    expect(formatRemaining(9 * 60_000)).toBe('9m');
    expect(formatRemaining(-3 * 3_600_000)).toBe('overdue by 3h 0m');
    expect(formatRemaining(null)).toBe('—');
  });
});
