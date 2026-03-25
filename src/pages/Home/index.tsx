/**
 * Home Page
 * New landing page after setup.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronDown,
  Copy,
  ExternalLink,
  Folder,
  MoreHorizontal,
  Pin,
  Plus,
  Power,
  Settings as SettingsIcon,
  Timer,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { Chat } from '@/pages/Chat';
import { ChatToolbar } from '@/pages/Chat/ChatToolbar';
import { TitleBar } from '@/components/layout/TitleBar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { invokeIpc } from '@/lib/api-client';
import { hostApiFetch } from '@/lib/host-api';
import { useAgentsStore } from '@/stores/agents';
import { useChatStore } from '@/stores/chat';
import { useCronStore } from '@/stores/cron';
import { useGatewayStore } from '@/stores/gateway';
import { useSettingsStore } from '@/stores/settings';
import type { AgentSummary } from '@/types/agent';
import type { CronJob, CronSchedule } from '@/types/cron';

type HomeTab = 'agent' | 'schedule';
type DockMode = 'none' | 'files' | 'roles';
type Instance = {
  id: string;
  name: string;
  address: string;
};

type AgentWorkspaceFile = {
  name: string;
  path: string;
  size: number;
  updatedAtMs: number;
  previewText: string | null;
};

type AgentRoleResponse = {
  content: string;
  fileName: string | null;
  filePath: string | null;
  truncated: boolean;
};

const TAB_ITEMS: Array<{ id: HomeTab; label: string; icon: React.ReactNode }> = [
  { id: 'agent', label: 'Agent', icon: <Users className="h-3.5 w-3.5" /> },
  { id: 'schedule', label: '定时', icon: <Timer className="h-3.5 w-3.5" /> },
];

function getAgentIdFromSessionKey(sessionKey: string): string {
  if (!sessionKey.startsWith('agent:')) return 'main';
  const parts = sessionKey.split(':');
  return parts[1] || 'main';
}

function getPlainText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return (content as Array<{ type?: string; text?: string }>)
      .filter((b) => b.type === 'text' && b.text)
      .map((b) => b.text!)
      .join('\n');
  }
  return '';
}

function formatPreviewText(content: unknown): string | null {
  const text = getPlainText(content).trim();
  if (!text) return null;
  return text.length > 60 ? `${text.slice(0, 60)}…` : text;
}

function getLiveConversationPreview(
  messages: Array<{ role?: string; content?: unknown }>,
  streamingMessage: unknown,
): string | null {
  if (streamingMessage && typeof streamingMessage === 'object') {
    const streamPreview = formatPreviewText((streamingMessage as { content?: unknown }).content);
    if (streamPreview) {
      return streamPreview;
    }
  }

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role !== 'assistant' && message.role !== 'user') {
      continue;
    }
    const preview = formatPreviewText(message.content);
    if (preview) {
      return preview;
    }
  }

  return null;
}

function formatDateTime(ms: number): string {
  const d = new Date(ms);
  const M = String(d.getMonth() + 1).padStart(2, '0');
  const D = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${M}/${D} ${h}:${m}`;
}

function formatScheduleLabel(schedule: CronJob['schedule']): string {
  if (typeof schedule === 'string') return schedule;
  if (schedule && typeof schedule === 'object') {
    const s = schedule as CronSchedule;
    if (s.kind === 'cron') return s.expr;
    if (s.kind === 'every') return `every ${Math.round(s.everyMs / 1000)}s`;
    if (s.kind === 'at') return `at ${s.at}`;
  }
  return String(schedule);
}

function formatNextRunLabel(iso: string | undefined): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return Number.isFinite(d.getTime()) ? d.toLocaleString() : iso;
  } catch {
    return iso;
  }
}

function ListItem({
  title,
  subtitle,
  active,
  onClick,
  right,
}: {
  title: string;
  subtitle?: string;
  active: boolean;
  onClick: () => void;
  right?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full text-left rounded-lg px-3 py-2.5 transition-all duration-150',
        active
          ? 'bg-black/[0.06] dark:bg-white/[0.08] text-foreground'
          : 'text-foreground/80 hover:bg-black/[0.03] dark:hover:bg-white/[0.03]',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium">{title}</div>
          {subtitle && (
            <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground/70">
              {subtitle}
            </div>
          )}
        </div>
        {right}
      </div>
    </button>
  );
}

function AgentRenameDialog({
  open,
  agent,
  defaultValue,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  agent: AgentSummary | null;
  defaultValue: string;
  onCancel: () => void;
  onConfirm: (nextName: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(defaultValue);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(defaultValue);
  }, [defaultValue, open]);

  if (!open) return null;

  const handleConfirm = async () => {
    const next = draft.trim();
    if (!agent || !next) return;
    setSaving(true);
    try {
      await onConfirm(next);
      toast.success('已更新 Agent 名称');
      onCancel();
    } catch (error) {
      toast.error(`更新失败：${String(error)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
    >
      <Card
        className="w-full max-w-md rounded-2xl border border-black/[0.08] dark:border-white/[0.08] shadow-2xl bg-background dark:bg-card p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-lg font-semibold">重命名 Agent</div>
        <div className="mt-2 text-sm text-muted-foreground">
          为 {agent?.name ?? '该 Agent'} 设置新的名称。
        </div>
        <div className="mt-4">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="h-[42px] rounded-lg font-mono text-[13px] bg-black/[0.03] dark:bg-white/[0.03] border-black/[0.08] dark:border-white/[0.08]"
            placeholder="新的 Agent 名称"
            autoFocus
          />
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel} disabled={saving}>
            取消
          </Button>
          <Button onClick={() => void handleConfirm()} disabled={saving || !draft.trim()}>
            {saving ? '保存中…' : '确认'}
          </Button>
        </div>
      </Card>
    </div>
  );
}

export function Home() {
  const navigate = useNavigate();

  const gatewayStatus = useGatewayStore((s) => s.status);
  const isGatewayRunning = gatewayStatus.state === 'running';

  const agents = useAgentsStore((s) => s.agents);
  const defaultAgentId = useAgentsStore((s) => s.defaultAgentId);
  const fetchAgents = useAgentsStore((s) => s.fetchAgents);
  const createAgent = useAgentsStore((s) => s.createAgent);
  const updateAgent = useAgentsStore((s) => s.updateAgent);
  const deleteAgent = useAgentsStore((s) => s.deleteAgent);

  const pinnedAgentIds = useSettingsStore((s) => s.pinnedAgentIds);
  const togglePinnedAgent = useSettingsStore((s) => s.togglePinnedAgent);

  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const messages = useChatStore((s) => s.messages);
  const sessionLastActivity = useChatStore((s) => s.sessionLastActivity);
  const sending = useChatStore((s) => s.sending);
  const pendingFinal = useChatStore((s) => s.pendingFinal);
  const streamingMessage = useChatStore((s) => s.streamingMessage);
  const switchSession = useChatStore((s) => s.switchSession);
  const loadSessions = useChatStore((s) => s.loadSessions);

  const cronJobs = useCronStore((s) => s.jobs);
  const fetchCronJobs = useCronStore((s) => s.fetchJobs);
  const toggleCronJob = useCronStore((s) => s.toggleJob);

  const [tab, setTab] = useState<HomeTab>('agent');
  const [dock, setDock] = useState<DockMode>('none');
  const [instances, setInstances] = useState<Instance[]>([
    { id: 'local', name: '本机', address: 'localhost' },
  ]);
  const [activeInstanceId, setActiveInstanceId] = useState('local');
  const [instanceDropdownOpen, setInstanceDropdownOpen] = useState(false);
  const [showAddInstance, setShowAddInstance] = useState(false);
  const [newInstanceName, setNewInstanceName] = useState('');
  const [newInstanceAddress, setNewInstanceAddress] = useState('');

  const [agentMenuOpenId, setAgentMenuOpenId] = useState<string | null>(null);
  const [renameAgentId, setRenameAgentId] = useState<string | null>(null);
  const [agentToDelete, setAgentToDelete] = useState<AgentSummary | null>(null);

  const [filesLoading, setFilesLoading] = useState(false);
  const [files, setFiles] = useState<AgentWorkspaceFile[]>([]);
  const [filesError, setFilesError] = useState<string | null>(null);

  const [roleLoading, setRoleLoading] = useState(false);
  const [role, setRole] = useState<AgentRoleResponse | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);

  /** Last message preview per agent id */
  const [agentPreviews, setAgentPreviews] = useState<Record<string, string>>({});
  const previousRunActiveRef = useRef(false);

  const currentAgentId = useMemo(() => getAgentIdFromSessionKey(currentSessionKey), [currentSessionKey]);
  const currentAgent = useMemo(
    () => agents.find((a) => a.id === currentAgentId) ?? null,
    [agents, currentAgentId],
  );

  const sortedAgents = useMemo(() => {
    const pinnedIndex = new Map(pinnedAgentIds.map((id, idx) => [id, idx]));
    return [...agents].sort((a, b) => {
      const aPinned = pinnedIndex.has(a.id);
      const bPinned = pinnedIndex.has(b.id);
      if (aPinned && bPinned) return (pinnedIndex.get(a.id)! - pinnedIndex.get(b.id)!);
      if (aPinned) return -1;
      if (bPinned) return 1;
      if (a.isDefault && !b.isDefault) return -1;
      if (!a.isDefault && b.isDefault) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [agents, pinnedAgentIds]);

  useEffect(() => {
    void fetchAgents();
  }, [fetchAgents]);

  useEffect(() => {
    if (!isGatewayRunning) return;
    void fetchCronJobs();
  }, [fetchCronJobs, isGatewayRunning]);

  // Fetch last message preview for each agent (reusable)
  const fetchAgentPreviews = useCallback(async () => {
    const currentAgents = useAgentsStore.getState().agents;
    if (!isGatewayRunning || currentAgents.length === 0) return;
    await Promise.all(
      currentAgents.map(async (agent) => {
        try {
          const r = await invokeIpc(
            'gateway:rpc',
            'chat.history',
            { sessionKey: agent.mainSessionKey, limit: 10 },
          ) as { success: boolean; result?: Record<string, unknown> };
          if (!r.success || !r.result) return;
          const msgs = Array.isArray(r.result.messages) ? r.result.messages : [];
          for (let i = msgs.length - 1; i >= 0; i--) {
            const m = msgs[i] as { role?: string; content?: unknown };
            if (m.role === 'assistant' || m.role === 'user') {
              const truncated = formatPreviewText(m.content);
              if (truncated) {
                setAgentPreviews((prev) => ({ ...prev, [agent.id]: truncated }));
                return;
              }
            }
          }
        } catch { /* ignore */ }
      }),
    );
  }, [isGatewayRunning]);

  useEffect(() => {
    void fetchAgentPreviews();
  }, [fetchAgentPreviews, agents]);

  useEffect(() => {
    const nextPreview = getLiveConversationPreview(messages, streamingMessage);
    if (!nextPreview) {
      return;
    }

    setAgentPreviews((prev) => {
      if (prev[currentAgentId] === nextPreview) {
        return prev;
      }
      return { ...prev, [currentAgentId]: nextPreview };
    });
  }, [currentAgentId, messages, streamingMessage]);

  const refreshLeftRailData = useCallback(async () => {
    if (!isGatewayRunning) {
      return;
    }

    await Promise.all([
      fetchAgents(),
      fetchCronJobs(),
      loadSessions(),
    ]);
    await fetchAgentPreviews();
  }, [fetchAgentPreviews, fetchAgents, fetchCronJobs, isGatewayRunning, loadSessions]);

  useEffect(() => {
    const runActive = sending || pendingFinal;
    if (previousRunActiveRef.current && !runActive) {
      void refreshLeftRailData();
    }
    previousRunActiveRef.current = runActive;
  }, [pendingFinal, refreshLeftRailData, sending]);

  // Close agent menu on outside click
  useEffect(() => {
    if (!agentMenuOpenId) return;
    const handleOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('[data-agent-menu="true"], [data-agent-menu-trigger="true"]')) return;
      setAgentMenuOpenId(null);
    };
    document.addEventListener('mousedown', handleOutside, true);
    return () => document.removeEventListener('mousedown', handleOutside, true);
  }, [agentMenuOpenId]);

  // Close instance dropdown on outside click
  useEffect(() => {
    if (!instanceDropdownOpen) return;
    const handleOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('[data-instance-dropdown="true"]')) return;
      setInstanceDropdownOpen(false);
    };
    document.addEventListener('mousedown', handleOutside, true);
    return () => document.removeEventListener('mousedown', handleOutside, true);
  }, [instanceDropdownOpen]);

  // Fetch agent files when dock is open
  useEffect(() => {
    if (dock !== 'files') return;
    if (!currentAgentId) return;

    let cancelled = false;
    setFilesLoading(true);
    setFilesError(null);

    (async () => {
      try {
        const response = await hostApiFetch<{ files: AgentWorkspaceFile[] }>(
          `/api/agents/${encodeURIComponent(currentAgentId)}/files?limit=60`,
        );
        if (cancelled) return;
        setFiles(Array.isArray(response.files) ? response.files : []);
      } catch (error) {
        if (cancelled) return;
        setFiles([]);
        setFilesError(String(error));
      } finally {
        if (!cancelled) setFilesLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [dock, currentAgentId]);

  // Fetch agent role when dock is open
  useEffect(() => {
    if (dock !== 'roles') return;
    if (!currentAgentId) return;

    let cancelled = false;
    setRoleLoading(true);
    setRoleError(null);

    (async () => {
      try {
        const response = await hostApiFetch<AgentRoleResponse>(
          `/api/agents/${encodeURIComponent(currentAgentId)}/role`,
        );
        if (cancelled) return;
        setRole(response);
      } catch (error) {
        if (cancelled) return;
        setRole(null);
        setRoleError(String(error));
      } finally {
        if (!cancelled) setRoleLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [dock, currentAgentId]);

  const activeRenameAgent = useMemo(() => {
    if (!renameAgentId) return null;
    return agents.find((a) => a.id === renameAgentId) ?? null;
  }, [agents, renameAgentId]);

  const renameDefaultValue = activeRenameAgent?.name ?? '';

  const handleSelectAgent = (agent: AgentSummary) => {
    const targetSessionKey = agent.mainSessionKey || `agent:${agent.id}:main`;
    switchSession(targetSessionKey);
  };

  const handleCopyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`已复制${label}`);
    } catch (error) {
      toast.error(`复制失败：${String(error)}`);
    }
  };

  const handleOpenPath = async (path: string) => {
    try {
      const result = await invokeIpc<string>('shell:openPath', path);
      if (typeof result === 'string' && result.trim()) {
        toast.error(`打开失败：${result}`);
      }
    } catch (error) {
      toast.error(`打开失败：${String(error)}`);
    }
  };

  const handleDeleteAgentConfirmed = async () => {
    if (!agentToDelete) return;
    const deletingId = agentToDelete.id;
    try {
      if (pinnedAgentIds.includes(deletingId)) {
        togglePinnedAgent(deletingId);
      }
      await deleteAgent(deletingId);
      toast.success('已删除 Agent');

      const nextDefaultId = useAgentsStore.getState().defaultAgentId || defaultAgentId || 'main';
      const nextDefaultAgent =
        useAgentsStore.getState().agents.find((a) => a.id === nextDefaultId)
        ?? useAgentsStore.getState().agents[0];
      if (currentAgentId === deletingId && nextDefaultAgent) {
        switchSession(nextDefaultAgent.mainSessionKey);
      }
    } catch (error) {
      toast.error(`删除失败：${String(error)}`);
    } finally {
      setAgentToDelete(null);
    }
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <TitleBar />

      <div className="flex flex-1 overflow-hidden">
        {/* Left Rail */}
        <aside className="w-[280px] shrink-0 border-r border-black/[0.06] dark:border-white/[0.06] bg-black/[0.015] dark:bg-white/[0.01] p-3 flex flex-col gap-3 overflow-hidden">
          {/* Tabs */}
          <div className="flex items-center gap-0.5 rounded-lg bg-black/[0.04] dark:bg-white/[0.04] p-0.5">
            {TAB_ITEMS.map((item) => {
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setTab(item.id);
                    if (!isGatewayRunning) return;
                    if (item.id === 'agent') {
                      void fetchAgents();
                      void loadSessions();
                      void fetchAgentPreviews();
                    } else if (item.id === 'schedule') {
                      void fetchCronJobs();
                    }
                  }}
                  className={cn(
                    'flex-1 h-8 rounded-md text-[12px] font-medium transition-all duration-200',
                    'flex items-center justify-center gap-1.5',
                    active
                      ? 'bg-background dark:bg-white/[0.08] text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground/70',
                  )}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>

          {/* Lists */}
          <div className="flex-1 overflow-y-auto pr-1 space-y-2">
            {tab === 'agent' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between px-1 mb-1">
                  <div className="text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-wider">Agents</div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-black/[0.05] dark:hover:bg-white/[0.05]"
                    onClick={async () => {
                      const existingNumbers = agents
                        .map((a) => { const m = a.name.match(/^agent(\d+)$/); return m ? parseInt(m[1], 10) : 0; })
                        .filter((n) => n > 0);
                      const nextNumber = existingNumbers.length > 0 ? Math.max(...existingNumbers) + 1 : 1;
                      const autoName = `agent${nextNumber}`;
                      try {
                        const existingIds = new Set(agents.map((a) => a.id));
                        await createAgent(autoName);
                        await fetchAgents();
                        const nextAgents = useAgentsStore.getState().agents;
                        const created = nextAgents.find((a) => !existingIds.has(a.id));
                        if (created) switchSession(created.mainSessionKey);
                        toast.success('已创建 Agent');
                      } catch (error) {
                        toast.error(`创建失败：${String(error)}`);
                      }
                    }}
                    title="添加 Agent"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>

                {sortedAgents.map((agent) => {
                  const active = agent.id === currentAgentId;
                  const pinned = pinnedAgentIds.includes(agent.id);
                  const canRename = !agent.isDefault;
                  const canDelete = !agent.isDefault;
                  const lastAt = sessionLastActivity[agent.mainSessionKey];
                  const preview = agentPreviews[agent.id];
                  const subtitle = preview || agent.id;
                  const menuOpen = agentMenuOpenId === agent.id;
                  return (
                    <div key={agent.id} className="relative group">
                      <button
                        type="button"
                        onClick={() => handleSelectAgent(agent)}
                        className={cn(
                          'w-full text-left rounded-lg px-3 py-2.5 transition-all duration-150',
                          active
                            ? 'bg-black/[0.06] dark:bg-white/[0.08] text-foreground'
                            : 'text-foreground/80 hover:bg-black/[0.03] dark:hover:bg-white/[0.03]',
                        )}
                      >
                        {/* Row 1: title + pin/time/menu */}
                        <div className="flex items-center justify-between gap-2">
                          <div className="truncate text-[13px] font-medium">{agent.name}</div>
                          <div className="relative flex items-center shrink-0 h-7">
                            {/* Time + pin: visible by default, hidden on hover / menu open */}
                            <span className={cn(
                              'flex items-center gap-1 text-[11px] text-muted-foreground/50 whitespace-nowrap transition-opacity duration-150',
                              (menuOpen) ? 'opacity-0' : 'group-hover:opacity-0',
                            )}>
                              {pinned && <Pin className="h-3 w-3 text-muted-foreground/40" />}
                              {typeof lastAt === 'number' && Number.isFinite(lastAt)
                                ? formatDateTime(lastAt)
                                : ''}
                            </span>
                            {/* More menu button: hidden by default, visible on hover / menu open */}
                            <button
                              type="button"
                              data-agent-menu-trigger="true"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setAgentMenuOpenId((prev) => (prev === agent.id ? null : agent.id));
                              }}
                              className={cn(
                                'absolute right-0 h-7 w-7 rounded-md flex items-center justify-center',
                                'text-muted-foreground/60 hover:text-muted-foreground hover:bg-black/[0.05] dark:hover:bg-white/[0.05]',
                                'transition-opacity duration-150',
                                menuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                              )}
                              title="更多"
                            >
                              <MoreHorizontal className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                        {/* Row 2: subtitle full width */}
                        <div className="mt-0.5 truncate text-[11px] text-muted-foreground/70">
                          {subtitle}
                        </div>
                      </button>

                      {agentMenuOpenId === agent.id && (
                        <div
                          data-agent-menu="true"
                          className="absolute right-1 top-[42px] z-20 w-40 overflow-hidden rounded-lg border border-black/[0.08] dark:border-white/[0.08] bg-background shadow-lg"
                        >
                          <button
                            type="button"
                            disabled={!canRename}
                            onClick={() => {
                              setAgentMenuOpenId(null);
                              if (!canRename) return;
                              setRenameAgentId(agent.id);
                            }}
                            className={cn(
                              'w-full px-3 py-2 text-left text-[13px] hover:bg-black/5 dark:hover:bg-white/5',
                              !canRename && 'opacity-50 cursor-not-allowed',
                            )}
                          >
                            重命名
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setAgentMenuOpenId(null);
                              togglePinnedAgent(agent.id);
                            }}
                            className="w-full px-3 py-2 text-left text-[13px] hover:bg-black/5 dark:hover:bg-white/5"
                          >
                            {pinned ? '取消置顶' : '置顶'}
                          </button>
                          <button
                            type="button"
                            disabled={!canDelete}
                            onClick={() => {
                              setAgentMenuOpenId(null);
                              if (!canDelete) return;
                              setAgentToDelete(agent);
                            }}
                            className={cn(
                              'w-full px-3 py-2 text-left text-[13px] text-red-500 dark:text-red-400 hover:bg-red-500/10 dark:hover:bg-red-500/10',
                              !canDelete && 'opacity-50 cursor-not-allowed',
                            )}
                          >
                            删除
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {tab === 'schedule' && (
              <div className="space-y-1">
                <div className="flex items-center justify-between px-1 mb-1">
                  <div className="text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-wider">定时任务</div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-black/[0.05] dark:hover:bg-white/[0.05]"
                    onClick={() => navigate('/settings/cron')}
                    title="去定时任务设置"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>
                {cronJobs.length === 0 ? (
                  <div className="px-3 py-4 text-[12px] text-muted-foreground/60 text-center">
                    {isGatewayRunning ? '暂无定时任务' : 'Gateway 未连接'}
                  </div>
                ) : (
                  cronJobs.map((job) => (
                    <ListItem
                      key={job.id}
                      title={job.name}
                      subtitle={`${formatScheduleLabel(job.schedule)} · 下次：${formatNextRunLabel(job.nextRun)} · Agent：main`}
                      active={false}
                      onClick={() => {
                        // no-op for now
                      }}
                      right={
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            void toggleCronJob(job.id, !job.enabled).catch((error) => {
                              toast.error(`切换失败：${String(error)}`);
                            });
                          }}
                          className={cn(
                            'h-7 w-7 rounded-md flex items-center justify-center shrink-0 transition-colors',
                            job.enabled
                              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                              : 'bg-rose-500/10 text-rose-500 dark:text-rose-400',
                          )}
                          title={job.enabled ? '点击禁用' : '点击启用'}
                        >
                          <Power className="h-4 w-4" />
                        </button>
                      }
                    />
                  ))
                )}
              </div>
            )}
          </div>

          {/* Footer: instance selector + settings */}
          <div className="mt-auto pt-3 border-t border-black/[0.04] dark:border-white/[0.04] flex items-center gap-2">
            <div className="relative flex-1" data-instance-dropdown="true">
              <button
                type="button"
                onClick={() => setInstanceDropdownOpen((v) => !v)}
                className={cn(
                  'w-full h-9 rounded-lg px-3 border',
                  'flex items-center gap-2 text-[12px] font-medium',
                  isGatewayRunning
                    ? 'border-emerald-500/20 dark:border-emerald-500/15 text-foreground/80'
                    : 'border-black/[0.06] dark:border-white/[0.06] text-foreground/60',
                  'hover:bg-black/[0.03] dark:hover:bg-white/[0.03] transition-colors',
                )}
              >
                <span
                  className={cn(
                    'h-2 w-2 rounded-full shrink-0',
                    isGatewayRunning ? 'bg-emerald-500 text-emerald-500' : 'bg-red-500 text-red-500',
                  )}
                  style={isGatewayRunning ? { animation: 'breathing 2.5s ease-in-out infinite' } : undefined}
                />
                <span className="truncate flex-1 text-left">
                  {activeInstanceId === 'local'
                    ? (isGatewayRunning
                      ? `本机已连接${gatewayStatus.port ? ` (port:${gatewayStatus.port})` : ''}`
                      : '本机未连接')
                    : instances.find((i) => i.id === activeInstanceId)?.name ?? '未知实例'}
                </span>
                <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
              </button>

              {instanceDropdownOpen && (
                <div className="absolute bottom-full left-0 mb-1 w-full rounded-lg border border-black/[0.08] dark:border-white/[0.08] bg-background shadow-lg overflow-hidden z-30">
                  {instances.map((inst) => (
                    <button
                      key={inst.id}
                      type="button"
                      onClick={() => {
                        setActiveInstanceId(inst.id);
                        setInstanceDropdownOpen(false);
                      }}
                      className={cn(
                        'w-full px-3 py-2 text-left text-[12px] hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-colors',
                        activeInstanceId === inst.id && 'bg-black/[0.06] dark:bg-white/[0.06] font-medium',
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            'h-1.5 w-1.5 rounded-full shrink-0',
                            inst.id === 'local' && isGatewayRunning ? 'bg-emerald-500' : 'bg-muted-foreground/40',
                          )}
                        />
                        <span className="truncate">{inst.name}</span>
                        <span className="ml-auto text-[10px] text-muted-foreground/60">{inst.address}</span>
                      </div>
                    </button>
                  ))}
                  <div className="border-t border-black/[0.06] dark:border-white/[0.06]">
                    <button
                      type="button"
                      onClick={() => {
                        setInstanceDropdownOpen(false);
                        setShowAddInstance(true);
                        setNewInstanceName('');
                        setNewInstanceAddress('');
                      }}
                      className="w-full px-3 py-2 text-left text-[12px] text-primary hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-colors flex items-center gap-2"
                    >
                      <Plus className="h-3 w-3" />
                      添加实例
                    </button>
                  </div>
                </div>
              )}
            </div>

            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-lg text-muted-foreground hover:text-foreground hover:bg-black/[0.05] dark:hover:bg-white/[0.05]"
              onClick={() => navigate('/settings')}
              title="设置"
            >
              <SettingsIcon className="h-4 w-4" />
            </Button>
          </div>
        </aside>

        {/* Right workspace */}
        <section className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {/* Top bar */}
          <div className="h-12 shrink-0 border-b border-black/[0.06] dark:border-white/[0.06] px-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <div className="min-w-0">
                <div className="truncate text-[13px] font-medium text-foreground">
                  {currentAgent?.name ?? '未选择 Agent'}
                </div>
              </div>
              <ChatToolbar showCurrentAgent={false} className="shrink-0" />
            </div>

            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  'h-8 rounded-md px-3 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-black/[0.05] dark:hover:bg-white/[0.05]',
                  dock === 'files' && 'bg-black/[0.06] dark:bg-white/[0.08] text-foreground',
                )}
                onClick={() => setDock((prev) => (prev === 'files' ? 'none' : 'files'))}
              >
                <Folder className="h-3.5 w-3.5 mr-1.5" />
                文件
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  'h-8 rounded-md px-3 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-black/[0.05] dark:hover:bg-white/[0.05]',
                  dock === 'roles' && 'bg-black/[0.06] dark:bg-white/[0.08] text-foreground',
                )}
                onClick={() => setDock((prev) => (prev === 'roles' ? 'none' : 'roles'))}
              >
                <Users className="h-3.5 w-3.5 mr-1.5" />
                角色
              </Button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0 flex overflow-hidden">
            {/* Chat */}
            <div className="flex-1 min-w-0 overflow-hidden">
              <Chat embedded hideToolbar className="h-full" />
            </div>

            {/* Dock */}
            {dock !== 'none' && (
              <aside className="w-[300px] shrink-0 border-l border-black/[0.06] dark:border-white/[0.06] p-4 overflow-y-auto bg-black/[0.01] dark:bg-white/[0.005]">
                {dock === 'files' ? (
                  <div>
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <div className="text-[13px] font-medium">文件</div>
                      <div className="font-mono text-[10px] text-muted-foreground/60 truncate">{currentAgentId}</div>
                    </div>

                    {filesLoading ? (
                      <div className="py-8 text-[12px] text-muted-foreground/60 text-center">加载中…</div>
                    ) : filesError ? (
                      <div className="py-4 text-[12px] text-destructive">加载失败：{filesError}</div>
                    ) : files.length === 0 ? (
                      <div className="py-8 text-[12px] text-muted-foreground/60 text-center leading-relaxed">
                        暂无文件
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {files.map((file) => (
                          <div key={file.path} className="rounded-lg bg-black/[0.02] dark:bg-white/[0.02] p-3">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="truncate text-[12px] font-medium">{file.name}</div>
                                <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground/60">{file.path}</div>
                              </div>
                              <div className="flex items-center gap-0.5 shrink-0">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 rounded-md text-muted-foreground/60 hover:text-foreground"
                                  onClick={() => void handleCopyText(file.path, '路径')}
                                  title="复制路径"
                                >
                                  <Copy className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 rounded-md text-muted-foreground/60 hover:text-foreground"
                                  onClick={() => void handleOpenPath(file.path)}
                                  title="用系统打开"
                                >
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </div>

                            {file.previewText && (
                              <pre className="mt-2 whitespace-pre-wrap break-all rounded-md bg-black/[0.03] dark:bg-white/[0.03] p-2.5 text-[11px] leading-relaxed text-foreground/80 max-h-40 overflow-auto">
                                {file.previewText}
                              </pre>
                            )}

                            <div className="mt-1.5 text-[10px] text-muted-foreground/50">
                              {file.updatedAtMs ? new Date(file.updatedAtMs).toLocaleString() : '—'}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div>
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <div className="text-[13px] font-medium">角色</div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 rounded-md text-muted-foreground/60 hover:text-foreground"
                        onClick={() => {
                          if (role?.content) void handleCopyText(role.content, '角色内容');
                        }}
                        title="复制角色内容"
                        disabled={!role?.content}
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                    </div>

                    {roleLoading ? (
                      <div className="py-8 text-[12px] text-muted-foreground/60 text-center">加载中…</div>
                    ) : roleError ? (
                      <div className="py-4 text-[12px] text-destructive">加载失败：{roleError}</div>
                    ) : !role?.content ? (
                      <div className="py-8 text-[12px] text-muted-foreground/60 text-center leading-relaxed">
                        未找到角色内容
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="text-[10px] text-muted-foreground/50 font-mono truncate">
                          {role.fileName ? `来源：${role.fileName}` : '来源：—'}
                        </div>
                        <div className="whitespace-pre-wrap text-[12px] leading-relaxed text-foreground/80 rounded-lg bg-black/[0.02] dark:bg-white/[0.02] p-3">
                          {role.content}
                        </div>
                        {role.truncated && (
                          <div className="text-[10px] text-muted-foreground/50">
                            （内容过长，已截断）
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </aside>
            )}
          </div>
        </section>
      </div>

      {/* Rename dialog */}
      <AgentRenameDialog
        open={!!renameAgentId}
        agent={activeRenameAgent}
        defaultValue={renameDefaultValue}
        onCancel={() => setRenameAgentId(null)}
        onConfirm={async (nextName) => {
          if (!activeRenameAgent) return;
          await updateAgent(activeRenameAgent.id, nextName);
        }}
      />

      {/* Add instance dialog */}
      {showAddInstance && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setShowAddInstance(false)}
        >
          <Card
            className="w-full max-w-md rounded-2xl border border-black/[0.08] dark:border-white/[0.08] shadow-2xl bg-background dark:bg-card p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-lg font-semibold">添加 OpenClaw 实例</div>
            <div className="mt-2 text-sm text-muted-foreground">
              输入远程 OpenClaw 实例的名称和地址。
            </div>
            <div className="mt-4 space-y-3">
              <Input
                value={newInstanceName}
                onChange={(e) => setNewInstanceName(e.target.value)}
                className="h-[42px] rounded-lg text-[13px] bg-black/[0.03] dark:bg-white/[0.03] border-black/[0.08] dark:border-white/[0.08]"
                placeholder="实例名称，例如：办公室服务器"
                autoFocus
              />
              <Input
                value={newInstanceAddress}
                onChange={(e) => setNewInstanceAddress(e.target.value)}
                className="h-[42px] rounded-lg font-mono text-[13px] bg-black/[0.03] dark:bg-white/[0.03] border-black/[0.08] dark:border-white/[0.08]"
                placeholder="地址，例如：192.168.1.100:18789"
              />
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowAddInstance(false)}>
                取消
              </Button>
              <Button
                disabled={!newInstanceName.trim() || !newInstanceAddress.trim()}
                onClick={() => {
                  const id = `remote-${Date.now()}`;
                  setInstances((prev) => [...prev, { id, name: newInstanceName.trim(), address: newInstanceAddress.trim() }]);
                  setActiveInstanceId(id);
                  setShowAddInstance(false);
                  toast.success('已添加实例');
                }}
              >
                添加
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Delete confirm */}
      <ConfirmDialog
        open={!!agentToDelete}
        title="删除 Agent"
        message={agentToDelete ? `将删除 ${agentToDelete.name}，此操作不可撤销。` : ''}
        confirmLabel="删除"
        cancelLabel="取消"
        variant="destructive"
        onConfirm={() => void handleDeleteAgentConfirmed()}
        onCancel={() => setAgentToDelete(null)}
      />
    </div>
  );
}

export default Home;

