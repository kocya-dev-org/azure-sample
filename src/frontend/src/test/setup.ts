import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// グローバル API を使わないため、テストごとの後始末を明示する
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
