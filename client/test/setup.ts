import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/preact';
import { afterEach } from 'vitest';

// Vitest globals are off, so Testing Library's automatic cleanup is not registered.
afterEach(() => cleanup());

// jsdom does not implement scrolling.
window.scrollTo = () => undefined;
