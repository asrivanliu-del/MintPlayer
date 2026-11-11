import { pathToFileURL } from 'url';

export const DEVELOPMENT_RENDERER_URL = 'http://127.0.0.1:5173';

export function shouldLoadDevelopmentRenderer(isPackaged: boolean, nodeEnv: string | undefined) {
  return !isPackaged && nodeEnv === 'development';
}

export function isTrustedRendererUrl(
  candidate: string,
  allowDevelopmentRenderer: boolean,
  rendererFilePath: string
): boolean {
  try {
    const url = new URL(candidate);
    if (
      allowDevelopmentRenderer &&
      url.origin === DEVELOPMENT_RENDERER_URL &&
      url.pathname === '/' &&
      !url.search &&
      !url.username &&
      !url.password
    ) {
      return true;
    }

    return url.href === pathToFileURL(rendererFilePath).href;
  } catch {
    return false;
  }
}

export function isTrustedRendererIpcSender(
  sender: object,
  senderFrame: { url: string } | null,
  expectedSender: object | null,
  expectedMainFrame: object | null,
  allowDevelopmentRenderer: boolean,
  rendererFilePath: string
): boolean {
  return Boolean(
    expectedSender &&
    expectedMainFrame &&
    sender === expectedSender &&
    senderFrame &&
    senderFrame === expectedMainFrame &&
    isTrustedRendererUrl(senderFrame.url, allowDevelopmentRenderer, rendererFilePath)
  );
}
