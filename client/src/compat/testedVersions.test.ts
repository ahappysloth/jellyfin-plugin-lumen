import { describe, expect, it } from 'vitest';
import { describeServerVersion, isTestedVersion, majorMinor } from './testedVersions';

describe('tested versions', () => {
  it('matches on major.minor', () => {
    expect(majorMinor('12.2.0')).toBe('12.2');
    expect(majorMinor('unknown')).toBeNull();
    expect(isTestedVersion('12.2.3')).toBe(true);
    expect(isTestedVersion('99.0.0')).toBe(false);
  });

  it('flags untested versions in diagnostics', () => {
    expect(describeServerVersion('12.2.0')).toBe('12.2.0');
    expect(describeServerVersion('99.1.0')).toBe('99.1.0 (untested)');
    expect(describeServerVersion('unknown')).toBe('unknown (untested)');
  });
});
