import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { testHome, testUserData } = vi.hoisted(() => {
  const suffix = Math.random().toString(36).slice(2);
  return {
    testHome: `/tmp/clawx-openclaw-auth-${suffix}`,
    testUserData: `/tmp/clawx-openclaw-auth-user-data-${suffix}`,
  };
});

vi.mock('os', () => {
  const mocked = {
    homedir: () => testHome,
  };
  return {
    ...mocked,
    default: mocked,
  };
});

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => testUserData,
    getVersion: () => '0.0.0-test',
  },
}));

async function writeOpenClawJson(config: unknown): Promise<void> {
  const openclawDir = join(testHome, '.openclaw');
  await mkdir(openclawDir, { recursive: true });
  await writeFile(join(openclawDir, 'openclaw.json'), JSON.stringify(config, null, 2), 'utf8');
}

async function readOpenClawJsonRaw(): Promise<string> {
  return readFile(join(testHome, '.openclaw', 'openclaw.json'), 'utf8');
}

async function readAuthProfiles(agentId: string): Promise<Record<string, unknown>> {
  const content = await readFile(join(testHome, '.openclaw', 'agents', agentId, 'agent', 'auth-profiles.json'), 'utf8');
  return JSON.parse(content) as Record<string, unknown>;
}

describe('saveProviderKeyToOpenClaw', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();
    await rm(testHome, { recursive: true, force: true });
    await rm(testUserData, { recursive: true, force: true });
  });

  it('only syncs auth profiles for configured agents', async () => {
    await writeOpenClawJson({
      agents: {
        list: [
          {
            id: 'main',
            name: 'Main',
            default: true,
            workspace: '~/.openclaw/workspace',
            agentDir: '~/.openclaw/agents/main/agent',
          },
          {
            id: 'test3',
            name: 'test3',
            workspace: '~/.openclaw/workspace-test3',
            agentDir: '~/.openclaw/agents/test3/agent',
          },
        ],
      },
    });

    await mkdir(join(testHome, '.openclaw', 'agents', 'test2', 'agent'), { recursive: true });
    await writeFile(
      join(testHome, '.openclaw', 'agents', 'test2', 'agent', 'auth-profiles.json'),
      JSON.stringify({
        version: 1,
        profiles: {
          'legacy:default': {
            type: 'api_key',
            provider: 'legacy',
            key: 'legacy-key',
          },
        },
      }, null, 2),
      'utf8',
    );

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { saveProviderKeyToOpenClaw } = await import('@electron/utils/openclaw-auth');

    await saveProviderKeyToOpenClaw('openrouter', 'sk-test');

    const mainProfiles = await readAuthProfiles('main');
    const test3Profiles = await readAuthProfiles('test3');
    const staleProfiles = await readAuthProfiles('test2');

    expect((mainProfiles.profiles as Record<string, { key: string }>)['openrouter:default'].key).toBe('sk-test');
    expect((test3Profiles.profiles as Record<string, { key: string }>)['openrouter:default'].key).toBe('sk-test');
    expect(staleProfiles.profiles).toEqual({
      'legacy:default': {
        type: 'api_key',
        provider: 'legacy',
        key: 'legacy-key',
      },
    });
    expect(logSpy).toHaveBeenCalledWith(
      'Saved API key for provider "openrouter" to OpenClaw auth-profiles (agents: main, test3)',
    );

    logSpy.mockRestore();
  });
});

describe('syncGatewayTokenToConfig', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();
    await rm(testHome, { recursive: true, force: true });
    await rm(testUserData, { recursive: true, force: true });
  });

  it('bootstraps openclaw.json when the file does not exist yet', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { syncGatewayTokenToConfig } = await import('@electron/utils/openclaw-auth');

    await syncGatewayTokenToConfig('token-123');

    const raw = await readOpenClawJsonRaw();
    const config = JSON.parse(raw) as Record<string, unknown>;
    const gateway = config.gateway as Record<string, unknown>;
    const auth = gateway.auth as Record<string, unknown>;
    const controlUi = gateway.controlUi as Record<string, unknown>;

    expect(auth).toEqual({
      mode: 'token',
      token: 'token-123',
    });
    expect(controlUi.allowedOrigins).toEqual(['file://']);
    expect(config.commands).toEqual({ restart: true });

    logSpy.mockRestore();
  });

  it('refuses to overwrite an unreadable existing openclaw.json', async () => {
    const openclawDir = join(testHome, '.openclaw');
    const invalidRaw = '{\n  "agents": ';
    await mkdir(openclawDir, { recursive: true });
    await writeFile(join(openclawDir, 'openclaw.json'), invalidRaw, 'utf8');

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { syncGatewayTokenToConfig } = await import('@electron/utils/openclaw-auth');

    await expect(syncGatewayTokenToConfig('token-123')).rejects.toThrow(
      /refusing to treat it as empty because that can overwrite user config/i,
    );
    expect(await readOpenClawJsonRaw()).toBe(invalidRaw);

    warnSpy.mockRestore();
  });
});
