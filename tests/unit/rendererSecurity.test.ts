import path from 'path';
import { pathToFileURL } from 'url';
import { describe, expect, it } from 'vitest';
import {
  DEVELOPMENT_RENDERER_URL,
  isTrustedRendererIpcSender,
  isTrustedRendererUrl,
  shouldLoadDevelopmentRenderer
} from '../../src/electron/rendererSecurity';

describe('renderer security helpers', () => {
  const rendererFilePath = path.resolve('dist/renderer/index.html');
  const rendererFileUrl = pathToFileURL(rendererFilePath).href;

  it('only enables the Vite renderer in explicit unpackaged development mode', () => {
    expect(shouldLoadDevelopmentRenderer(false, 'development')).toBe(true);
    expect(shouldLoadDevelopmentRenderer(true, 'development')).toBe(false);
    expect(shouldLoadDevelopmentRenderer(false, 'production')).toBe(false);
    expect(shouldLoadDevelopmentRenderer(false, undefined)).toBe(false);
  });

  it('trusts only the bundled file or the development server root', () => {
    expect(isTrustedRendererUrl(rendererFileUrl, false, rendererFilePath)).toBe(true);
    expect(isTrustedRendererUrl(DEVELOPMENT_RENDERER_URL, true, rendererFilePath)).toBe(true);
    expect(isTrustedRendererUrl(`${DEVELOPMENT_RENDERER_URL}/untrusted`, true, rendererFilePath)).toBe(false);
    expect(isTrustedRendererUrl(`${DEVELOPMENT_RENDERER_URL}?redirect=elsewhere`, true, rendererFilePath)).toBe(false);
    expect(isTrustedRendererUrl(DEVELOPMENT_RENDERER_URL, false, rendererFilePath)).toBe(false);
    expect(isTrustedRendererUrl('https://example.com/', false, rendererFilePath)).toBe(false);
  });

  it('accepts IPC only from the trusted top-level application renderer', () => {
    const sender = {};
    const otherSender = {};
    const mainFrame = { url: rendererFileUrl };

    expect(isTrustedRendererIpcSender(
      sender, mainFrame, sender, mainFrame, false, rendererFilePath
    )).toBe(true);
    expect(isTrustedRendererIpcSender(
      sender,
      { url: DEVELOPMENT_RENDERER_URL },
      sender,
      mainFrame,
      true,
      rendererFilePath
    )).toBe(false);
    const developmentMainFrame = { url: DEVELOPMENT_RENDERER_URL };
    expect(isTrustedRendererIpcSender(
      sender,
      developmentMainFrame,
      sender,
      developmentMainFrame,
      true,
      rendererFilePath
    )).toBe(true);
    expect(isTrustedRendererIpcSender(
      otherSender, mainFrame, sender, mainFrame, false, rendererFilePath
    )).toBe(false);
    expect(isTrustedRendererIpcSender(
      sender, { url: rendererFileUrl }, sender, mainFrame, false, rendererFilePath
    )).toBe(false);
    expect(isTrustedRendererIpcSender(
      sender, { url: DEVELOPMENT_RENDERER_URL }, sender, mainFrame, false, rendererFilePath
    )).toBe(false);
  });
});
