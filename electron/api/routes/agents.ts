import type { IncomingMessage, ServerResponse } from 'http';
import { constants } from 'node:fs';
import { access, open, readdir, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import {
  assignChannelToAgent,
  clearChannelBinding,
  createAgent,
  deleteAgentConfig,
  listAgentsSnapshot,
  removeAgentWorkspaceDirectory,
  resolveAccountIdForAgent,
  updateAgentName,
} from '../../utils/agent-config';
import { deleteChannelAccountConfig } from '../../utils/channel-config';
import { expandPath } from '../../utils/paths';
import { syncAllProviderAuthToRuntime } from '../../services/providers/provider-runtime-sync';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';

const TEXT_PREVIEW_EXTS = new Set([
  '.md',
  '.txt',
  '.json',
  '.yaml',
  '.yml',
  '.toml',
  '.ini',
  '.log',
]);

const MAX_PREVIEW_BYTES = 4096;
const MAX_ROLE_BYTES = 200000;
const MAX_FILES_LIMIT = 200;

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readFilePrefix(path: string, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  const handle = await open(path, 'r');
  try {
    const safeMaxBytes = Math.max(0, Math.floor(maxBytes));
    const buffer = Buffer.alloc(safeMaxBytes + 1);
    const result = await handle.read(buffer, 0, buffer.length, 0);
    const bytesRead = result.bytesRead ?? 0;
    const truncated = bytesRead > safeMaxBytes;
    const text = buffer.toString('utf8', 0, truncated ? safeMaxBytes : bytesRead);
    return { text, truncated };
  } finally {
    await handle.close();
  }
}

function formatPreview(text: string, truncated: boolean): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const preview = lines.slice(0, 14).join('\n').trimEnd();
  if (!preview) return '';
  const hasMoreLines = lines.length > 14;
  return (hasMoreLines || truncated) ? `${preview}\n…` : preview;
}
function scheduleGatewayReload(ctx: HostApiContext, reason: string): void {
  if (ctx.gatewayManager.getStatus().state !== 'stopped') {
    ctx.gatewayManager.debouncedReload();
    return;
  }
  void reason;
}

import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);

/**
 * Force a full Gateway process restart after agent deletion.
 *
 * A SIGUSR1 in-process reload is NOT sufficient here: channel plugins
 * (e.g. Feishu) maintain long-lived WebSocket connections to external
 * services and do not disconnect accounts that were removed from the
 * config during an in-process reload.  The only reliable way to drop
 * stale bot connections is to kill the Gateway process entirely and
 * spawn a fresh one that reads the updated openclaw.json from scratch.
 */
async function restartGatewayForAgentDeletion(ctx: HostApiContext): Promise<void> {
  try {
    // Capture the PID of the running Gateway BEFORE stop() clears it.
    const status = ctx.gatewayManager.getStatus();
    const pid = status.pid;
    const port = status.port;
    console.log('[agents] Triggering Gateway restart (kill+respawn) after agent deletion', { pid, port });

    // Force-kill the Gateway process by PID.  The manager's stop() only
    // kills "owned" processes; if the manager connected to an already-
    // running Gateway (ownsProcess=false), stop() simply closes the WS
    // and the old process stays alive with its stale channel connections.
    if (pid) {
      try {
        process.kill(pid, 'SIGTERM');
        // Give it a moment to die
        await new Promise((resolve) => setTimeout(resolve, 500));
        try { process.kill(pid, 0); process.kill(pid, 'SIGKILL'); } catch { /* already dead */ }
      } catch {
        // process already gone – that's fine
      }
    } else if (port) {
      // If we don't know the PID (e.g. connected to an orphaned Gateway from
      // a previous pnpm dev run), forcefully kill whatever is on the port.
      try {
        if (process.platform === 'darwin' || process.platform === 'linux') {
          // MUST use -sTCP:LISTEN. Otherwise lsof returns the client process (ClawBox itself) 
          // that has an ESTABLISHED WebSocket connection to the port, causing us to kill ourselves.
          const { stdout } = await execAsync(`lsof -t -i :${port} -sTCP:LISTEN`);
          const pids = stdout.trim().split('\n').filter(Boolean);
          for (const p of pids) {
            try { process.kill(parseInt(p, 10), 'SIGTERM'); } catch { /* ignore */ }
          }
          await new Promise((resolve) => setTimeout(resolve, 500));
          for (const p of pids) {
            try { process.kill(parseInt(p, 10), 'SIGKILL'); } catch { /* ignore */ }
          }
        } else if (process.platform === 'win32') {
          // Find PID listening on the port
          const { stdout } = await execAsync(`netstat -ano | findstr :${port}`);
          const lines = stdout.trim().split('\n');
          const pids = new Set<string>();
          for (const line of lines) {
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 5 && parts[1].endsWith(`:${port}`) && parts[3] === 'LISTENING') {
              pids.add(parts[4]);
            }
          }
          for (const p of pids) {
            try { await execAsync(`taskkill /F /PID ${p}`); } catch { /* ignore */ }
          }
        }
      } catch {
        // Port might not be bound or command failed; ignore
      }
    }

    await ctx.gatewayManager.restart();
    console.log('[agents] Gateway restart completed after agent deletion');
  } catch (err) {
    console.warn('[agents] Gateway restart after agent deletion failed:', err);
  }
}

export async function handleAgentRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/agents' && req.method === 'GET') {
    sendJson(res, 200, { success: true, ...(await listAgentsSnapshot()) });
    return true;
  }

  if (url.pathname.startsWith('/api/agents/') && req.method === 'GET') {
    const suffix = url.pathname.slice('/api/agents/'.length);
    const parts = suffix.split('/').filter(Boolean);
    const agentId = parts.length > 0 ? decodeURIComponent(parts[0]) : '';

    if (parts.length === 2 && (parts[1] === 'files' || parts[1] === 'role')) {
      const snapshot = await listAgentsSnapshot();
      const agent = snapshot.agents.find((a) => a.id === agentId)
        ?? snapshot.agents.find((a) => a.id.toLowerCase() === agentId.toLowerCase());
      if (!agent) {
        sendJson(res, 404, { error: `Agent not found: ${agentId}` });
        return true;
      }

      const workspaceDir = expandPath(agent.workspace);
      if (!(await fileExists(workspaceDir))) {
        sendJson(res, 200, parts[1] === 'files'
          ? { files: [] }
          : { content: '', fileName: null, filePath: null, truncated: false });
        return true;
      }

      if (parts[1] === 'files') {
        const rawLimit = Number(url.searchParams.get('limit') || '60');
        const limit = Number.isFinite(rawLimit)
          ? Math.min(Math.max(Math.floor(rawLimit), 1), MAX_FILES_LIMIT)
          : 60;

        try {
          const entries = await readdir(workspaceDir, { withFileTypes: true });
          const candidates = entries
            .filter((entry) => entry.isFile())
            .map((entry) => entry.name);

          const results = await Promise.all(
            candidates.map(async (name) => {
              const path = join(workspaceDir, name);
              try {
                const s = await stat(path);
                const ext = extname(name).toLowerCase();
                let previewText: string | null = null;
                if (TEXT_PREVIEW_EXTS.has(ext) && s.size > 0 && s.size <= 1000000) {
                  const { text, truncated } = await readFilePrefix(path, MAX_PREVIEW_BYTES);
                  const formatted = formatPreview(text, truncated);
                  previewText = formatted || null;
                }
                return {
                  name,
                  path,
                  size: s.size,
                  updatedAtMs: s.mtimeMs,
                  previewText,
                };
              } catch {
                return null;
              }
            }),
          );

          const files = results
            .filter((item): item is NonNullable<typeof item> => item != null)
            .sort((a, b) => (b.updatedAtMs ?? 0) - (a.updatedAtMs ?? 0))
            .slice(0, limit);
          sendJson(res, 200, { files });
        } catch (error) {
          sendJson(res, 500, { error: String(error) });
        }
        return true;
      }

      try {
        const candidates = ['SOUL.md', 'IDENTITY.md', 'USER.md', 'AGENTS.md'];
        for (const fileName of candidates) {
          const filePath = join(workspaceDir, fileName);
          if (!(await fileExists(filePath))) continue;
          const s = await stat(filePath);
          const maxBytes = Math.min(MAX_ROLE_BYTES, Math.max(1, Math.floor(s.size)));
          const { text, truncated } = await readFilePrefix(filePath, maxBytes);
          sendJson(res, 200, {
            content: text,
            fileName,
            filePath,
            truncated: truncated || s.size > MAX_ROLE_BYTES,
          });
          return true;
        }

        sendJson(res, 200, { content: '', fileName: null, filePath: null, truncated: false });
      } catch (error) {
        sendJson(res, 500, { error: String(error) });
      }
      return true;
    }
  }
  if (url.pathname === '/api/agents' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ name: string }>(req);
      const snapshot = await createAgent(body.name);
      // Sync provider API keys to the new agent's auth-profiles.json so the
      // embedded runner can authenticate with LLM providers when messages
      // arrive via channel bots (e.g. Feishu). Without this, the copied
      // auth-profiles.json may contain a stale key → 401 from the LLM.
      syncAllProviderAuthToRuntime().catch((err) => {
        console.warn('[agents] Failed to sync provider auth after agent creation:', err);
      });
      scheduleGatewayReload(ctx, 'create-agent');
      sendJson(res, 200, { success: true, ...snapshot });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/agents/') && req.method === 'PUT') {
    const suffix = url.pathname.slice('/api/agents/'.length);
    const parts = suffix.split('/').filter(Boolean);

    if (parts.length === 1) {
      try {
        const body = await parseJsonBody<{ name: string }>(req);
        const agentId = decodeURIComponent(parts[0]);
        const snapshot = await updateAgentName(agentId, body.name);
        scheduleGatewayReload(ctx, 'update-agent');
        sendJson(res, 200, { success: true, ...snapshot });
      } catch (error) {
        sendJson(res, 500, { success: false, error: String(error) });
      }
      return true;
    }

    if (parts.length === 3 && parts[1] === 'channels') {
      try {
        const agentId = decodeURIComponent(parts[0]);
        const channelType = decodeURIComponent(parts[2]);
        const snapshot = await assignChannelToAgent(agentId, channelType);
        scheduleGatewayReload(ctx, 'assign-channel');
        sendJson(res, 200, { success: true, ...snapshot });
      } catch (error) {
        sendJson(res, 500, { success: false, error: String(error) });
      }
      return true;
    }
  }

  if (url.pathname.startsWith('/api/agents/') && req.method === 'DELETE') {
    const suffix = url.pathname.slice('/api/agents/'.length);
    const parts = suffix.split('/').filter(Boolean);

    if (parts.length === 1) {
      try {
        const agentId = decodeURIComponent(parts[0]);
        const { snapshot, removedEntry } = await deleteAgentConfig(agentId);
        // Await reload synchronously BEFORE responding to the client.
        // This ensures the Feishu plugin has disconnected the deleted bot
        // before the UI shows "delete success" and the user tries chatting.
        await restartGatewayForAgentDeletion(ctx);
        // Delete workspace after reload so the new config is already live.
        await removeAgentWorkspaceDirectory(removedEntry).catch((err) => {
          console.warn('[agents] Failed to remove workspace after agent deletion:', err);
        });
        sendJson(res, 200, { success: true, ...snapshot });
      } catch (error) {
        sendJson(res, 500, { success: false, error: String(error) });
      }
      return true;
    }

    if (parts.length === 3 && parts[1] === 'channels') {
      try {
        const agentId = decodeURIComponent(parts[0]);
        const channelType = decodeURIComponent(parts[2]);
        const ownerId = agentId.trim().toLowerCase();
        const snapshotBefore = await listAgentsSnapshot();
        const ownedAccountIds = Object.entries(snapshotBefore.channelAccountOwners)
          .filter(([channelAccountKey, owner]) => {
            if (owner !== ownerId) return false;
            return channelAccountKey.startsWith(`${channelType}:`);
          })
          .map(([channelAccountKey]) => channelAccountKey.slice(channelAccountKey.indexOf(':') + 1));
        // Backward compatibility for legacy agentId->accountId mapping.
        if (ownedAccountIds.length === 0) {
          const legacyAccountId = resolveAccountIdForAgent(agentId);
          if (snapshotBefore.channelAccountOwners[`${channelType}:${legacyAccountId}`] === ownerId) {
            ownedAccountIds.push(legacyAccountId);
          }
        }

        for (const accountId of ownedAccountIds) {
          await deleteChannelAccountConfig(channelType, accountId);
          await clearChannelBinding(channelType, accountId);
        }
        const snapshot = await listAgentsSnapshot();
        scheduleGatewayReload(ctx, 'remove-agent-channel');
        sendJson(res, 200, { success: true, ...snapshot });
      } catch (error) {
        sendJson(res, 500, { success: false, error: String(error) });
      }
      return true;
    }
  }

  return false;
}

