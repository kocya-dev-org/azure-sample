import { describe, expect, it } from 'vitest';
import { originMatcher } from '../../src/lib/cors';

// 実際の SWA のホスト名の形（既定のホストにはリージョンがなく、PR プレビューのホストには入る）
const allowed = originMatcher([
  'https://orange-field-0a2258e00.5.azurestaticapps.net',
  'https://orange-field-0a2258e00-*.*.5.azurestaticapps.net',
]);

describe('originMatcher', () => {
  it('既定のホストと PR プレビューのホストを許可する', () => {
    expect(allowed('https://orange-field-0a2258e00.5.azurestaticapps.net')).toBe(true);
    expect(allowed('https://orange-field-0a2258e00-24.eastasia.5.azurestaticapps.net')).toBe(true);
  });

  it('`*` は `.` をまたがない', () => {
    expect(
      allowed('https://orange-field-0a2258e00-1.evil.com.eastasia.5.azurestaticapps.net'),
    ).toBe(false);
    expect(
      allowed('https://orange-field-0a2258e00-1.eastasia.5.azurestaticapps.net.evil.com'),
    ).toBe(false);
  });

  it('ほかのオリジンは許可しない', () => {
    expect(allowed('https://example.com')).toBe(false);
    expect(allowed('http://orange-field-0a2258e00.5.azurestaticapps.net')).toBe(false);
    expect(allowed('https://other-app-0a2258e00-24.eastasia.5.azurestaticapps.net')).toBe(false);
  });
});
