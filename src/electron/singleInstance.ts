export type SingleInstanceWindow = {
  isDestroyed(): boolean;
  isMinimized(): boolean;
  restore(): void;
  focus(): void;
};

type SingleInstanceApp = {
  requestSingleInstanceLock(): boolean;
  quit(): void;
  on(event: 'second-instance', listener: () => void): unknown;
};

export function acquireSingleInstanceLock(
  app: SingleInstanceApp,
  getWindow: () => SingleInstanceWindow | null,
  createWindow: () => void
) {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return false;
  }

  app.on('second-instance', () => {
    const window = getWindow();
    if (!window || window.isDestroyed()) {
      createWindow();
      return;
    }
    if (window.isMinimized()) window.restore();
    window.focus();
  });
  return true;
}
