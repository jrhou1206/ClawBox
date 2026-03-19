import { beforeEach, describe, expect, it, vi } from 'vitest';

const exposeInMainWorldMock = vi.hoisted(() => vi.fn());
const ipcInvokeMock = vi.hoisted(() => vi.fn());
const ipcOnMock = vi.hoisted(() => vi.fn());
const ipcOnceMock = vi.hoisted(() => vi.fn());
const ipcOffMock = vi.hoisted(() => vi.fn());
const ipcRemoveListenerMock = vi.hoisted(() => vi.fn());
const ipcRemoveAllListenersMock = vi.hoisted(() => vi.fn());

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: exposeInMainWorldMock,
  },
  ipcRenderer: {
    invoke: ipcInvokeMock,
    on: ipcOnMock,
    once: ipcOnceMock,
    off: ipcOffMock,
    removeListener: ipcRemoveListenerMock,
    removeAllListeners: ipcRemoveAllListenersMock,
  },
}));

describe('preload IPC allowlist', () => {
  beforeEach(() => {
    vi.resetModules();
    exposeInMainWorldMock.mockReset();
    ipcInvokeMock.mockReset();
    ipcOnMock.mockReset();
    ipcOnceMock.mockReset();
    ipcOffMock.mockReset();
    ipcRemoveListenerMock.mockReset();
    ipcRemoveAllListenersMock.mockReset();
  });

  it('allows app:systemInfo through the preload invoke allowlist', async () => {
    await import('@electron/preload/index');
    const api = exposeInMainWorldMock.mock.calls[0]?.[1];

    expect(api).toBeTruthy();
    ipcInvokeMock.mockResolvedValueOnce({ ok: true });

    await api.ipcRenderer.invoke('app:systemInfo');

    expect(ipcInvokeMock).toHaveBeenCalledWith('app:systemInfo');
  });

  it('rejects unknown invoke channels', async () => {
    await import('@electron/preload/index');
    const api = exposeInMainWorldMock.mock.calls[0]?.[1];

    expect(() => api.ipcRenderer.invoke('app:not-real')).toThrow('Invalid IPC channel');
  });
});
