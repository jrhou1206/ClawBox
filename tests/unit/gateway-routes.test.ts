import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';

const sendJsonMock = vi.fn();
const execFileMock = vi.fn();
const getSettingMock = vi.fn();
const buildOpenClawControlUiUrlMock = vi.fn();
const parseJsonBodyMock = vi.fn();
const originalPlatform = process.platform;

vi.mock('node:child_process', () => ({
  default: {
    execFile: execFileMock,
  },
  execFile: execFileMock,
}));

vi.mock('@electron/utils/store', () => ({
  getSetting: (...args: unknown[]) => getSettingMock(...args),
}));

vi.mock('@electron/utils/openclaw-control-ui', () => ({
  buildOpenClawControlUiUrl: (...args: unknown[]) => buildOpenClawControlUiUrlMock(...args),
}));

vi.mock('@electron/api/route-utils', () => ({
  parseJsonBody: (...args: unknown[]) => parseJsonBodyMock(...args),
  sendJson: (...args: unknown[]) => sendJsonMock(...args),
}));

function setPlatform(platform: string): void {
  Object.defineProperty(process, 'platform', { value: platform, writable: true });
}

describe('handleGatewayRoutes', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    parseJsonBodyMock.mockResolvedValue({});
    getSettingMock.mockResolvedValue('token');
    buildOpenClawControlUiUrlMock.mockReturnValue('http://127.0.0.1:18789/#token=test');
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, writable: true });
  });

  it('returns null rss when the gateway pid is unavailable', async () => {
    const { handleGatewayRoutes } = await import('@electron/api/routes/gateway');

    const handled = await handleGatewayRoutes(
      { method: 'GET' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:3210/api/gateway/process-stats'),
      {
        gatewayManager: {
          getStatus: () => ({ state: 'running', port: 18789 }),
        },
      } as never,
    );

    expect(handled).toBe(true);
    expect(execFileMock).not.toHaveBeenCalled();
    expect(sendJsonMock).toHaveBeenCalledWith(expect.anything(), 200, {
      pid: null,
      rssBytes: null,
    });
  });

  it('reads process rss through PowerShell on Windows', async () => {
    setPlatform('win32');
    execFileMock.mockImplementation((file, args, options, callback) => {
      callback(null, { stdout: '12345\r\n', stderr: '' });
    });

    const { handleGatewayRoutes } = await import('@electron/api/routes/gateway');

    await handleGatewayRoutes(
      { method: 'GET' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:3210/api/gateway/process-stats'),
      {
        gatewayManager: {
          getStatus: () => ({ state: 'running', port: 18789, pid: 42 }),
        },
      } as never,
    );

    expect(execFileMock).toHaveBeenCalledWith(
      'powershell.exe',
      ['-NoProfile', '-Command', '(Get-Process -Id 42).WorkingSet64'],
      { timeout: 5000 },
      expect.any(Function),
    );
    expect(sendJsonMock).toHaveBeenCalledWith(expect.anything(), 200, {
      pid: 42,
      rssBytes: 12345,
    });
  });
});



