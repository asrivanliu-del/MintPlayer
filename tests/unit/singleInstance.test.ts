import { describe, expect, it, vi } from 'vitest';
import { acquireSingleInstanceLock, type SingleInstanceWindow } from '../../src/electron/singleInstance';

function createWindow(overrides: Partial<SingleInstanceWindow> = {}): SingleInstanceWindow {
  return {
    isDestroyed: vi.fn(() => false),
    isMinimized: vi.fn(() => false),
    restore: vi.fn(),
    focus: vi.fn(),
    ...overrides
  };
}

describe('Electron single instance handling', () => {
  it('quits when another application instance already holds the lock', () => {
    const app = {
      requestSingleInstanceLock: vi.fn(() => false),
      quit: vi.fn(),
      on: vi.fn()
    };

    expect(acquireSingleInstanceLock(app, () => null, vi.fn())).toBe(false);
    expect(app.quit).toHaveBeenCalledOnce();
    expect(app.on).not.toHaveBeenCalled();
  });

  it('restores and focuses the existing window on a second launch', () => {
    const window = createWindow({ isMinimized: vi.fn(() => true) });
    let handleSecondInstance: (() => void) | undefined;
    const app = {
      requestSingleInstanceLock: vi.fn(() => true),
      quit: vi.fn(),
      on: vi.fn((_event: 'second-instance', listener: () => void) => {
        handleSecondInstance = listener;
      })
    };

    expect(acquireSingleInstanceLock(app, () => window, vi.fn())).toBe(true);
    handleSecondInstance?.();

    expect(window.restore).toHaveBeenCalledOnce();
    expect(window.focus).toHaveBeenCalledOnce();
  });

  it('creates a window if the existing window has already closed', () => {
    const createWindow = vi.fn();
    let handleSecondInstance: (() => void) | undefined;
    const app = {
      requestSingleInstanceLock: vi.fn(() => true),
      quit: vi.fn(),
      on: vi.fn((_event: 'second-instance', listener: () => void) => {
        handleSecondInstance = listener;
      })
    };

    acquireSingleInstanceLock(app, () => null, createWindow);
    handleSecondInstance?.();

    expect(createWindow).toHaveBeenCalledOnce();
  });
});
