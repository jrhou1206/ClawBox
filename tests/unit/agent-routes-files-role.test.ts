import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';

const listAgentsSnapshotMock = vi.fn();
const sendJsonMock = vi.fn();
const parseJsonBodyMock = vi.fn();
let tempDir = '';

vi.mock('@electron/utils/agent-config', () => ({
  assignChannelToAgent: vi.fn(),
  clearChannelBinding: vi.fn(),
  createAgent: vi.fn(),
  deleteAgentConfig: vi.fn(),
  listAgentsSnapshot: (...args: unknown[]) => listAgentsSnapshotMock(...args),
  removeAgentWorkspaceDirectory: vi.fn(),
  resolveAccountIdForAgent: vi.fn(),
  updateAgentName: vi.fn(),
}));

vi.mock('@electron/utils/channel-config', () => ({
  deleteChannelAccountConfig: vi.fn(),
}));

vi.mock('@electron/services/providers/provider-runtime-sync', () => ({
  syncAllProviderAuthToRuntime: vi.fn(),
}));

vi.mock('@electron/utils/paths', () => ({
  expandPath: (value: string) => value,
}));

vi.mock('@electron/api/route-utils', () => ({
  parseJsonBody: (...args: unknown[]) => parseJsonBodyMock(...args),
  sendJson: (...args: unknown[]) => sendJsonMock(...args),
}));

describe('handleAgentRoutes file and role endpoints', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    parseJsonBodyMock.mockResolvedValue({});
    tempDir = await mkdtemp(join(tmpdir(), 'clawx-agent-route-'));
    listAgentsSnapshotMock.mockResolvedValue({
      agents: [
        {
          id: 'main',
          name: 'Main',
          workspace: tempDir,
        },
      ],
      defaultAgentId: 'main',
      configuredChannelTypes: [],
      channelOwners: {},
      channelAccountOwners: {},
    });
  });

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = '';
    }
  });

  it('returns workspace files with previews', async () => {
    const notesPath = join(tempDir, 'notes.md');
    const imagePath = join(tempDir, 'image.png');
    await writeFile(notesPath, '# Hello\nThis is a preview file.\nMore content here.\n', 'utf8');
    await writeFile(imagePath, 'binary', 'utf8');
    const newer = new Date('2026-03-19T15:30:00Z');
    const older = new Date('2026-03-19T15:00:00Z');
    await utimes(notesPath, newer, newer);
    await utimes(imagePath, older, older);

    const { handleAgentRoutes } = await import('@electron/api/routes/agents');

    const handled = await handleAgentRoutes(
      { method: 'GET' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:3210/api/agents/main/files?limit=10'),
      { gatewayManager: { getStatus: () => ({ state: 'stopped' }) } } as never,
    );

    expect(handled).toBe(true);
    expect(sendJsonMock).toHaveBeenCalledWith(
      expect.anything(),
      200,
      expect.objectContaining({
        files: expect.arrayContaining([
          expect.objectContaining({
            name: 'notes.md',
            path: notesPath,
            previewText: expect.stringContaining('# Hello'),
          }),
          expect.objectContaining({
            name: 'image.png',
            path: imagePath,
            previewText: null,
          }),
        ]),
      }),
    );
  });

  it('returns the first available role file content', async () => {
    const rolePath = join(tempDir, 'AGENTS.md');
    await writeFile(rolePath, 'role instructions\nline two', 'utf8');

    const { handleAgentRoutes } = await import('@electron/api/routes/agents');

    const handled = await handleAgentRoutes(
      { method: 'GET' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:3210/api/agents/main/role'),
      { gatewayManager: { getStatus: () => ({ state: 'stopped' }) } } as never,
    );

    expect(handled).toBe(true);
    expect(sendJsonMock).toHaveBeenCalledWith(expect.anything(), 200, {
      content: 'role instructions\nline two',
      fileName: 'AGENTS.md',
      filePath: rolePath,
      truncated: false,
    });
  });
});
