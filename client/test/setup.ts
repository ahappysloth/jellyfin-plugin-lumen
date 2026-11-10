import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/preact';
import { afterAll, afterEach } from 'vitest';

// findBy*/waitFor wait up to 1 s by default; under heavy parallel load a render on real timers can take longer.
configure({ asyncUtilTimeout: 3000 });

// Vitest globals are off, so Testing Library's automatic cleanup is not registered.
afterEach(() => cleanup());

// Preact runs effects after the next frame, via a timer of up to 100 ms that reads `window`. A fast, synchronous test
// file can finish before it fires; let it run before the environment (and `window`) is torn down.
afterAll(() => new Promise((resolve) => setTimeout(resolve, 150)));

// jsdom does not implement scrolling.
window.scrollTo = () => undefined;
