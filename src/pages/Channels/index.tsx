import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { RefreshCw, Trash2, AlertCircle, Plus, Edit } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useGatewayStore } from '@/stores/gateway';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { hostApiFetch } from '@/lib/host-api';
import { subscribeHostEvent } from '@/lib/host-events';
import { ChannelConfigModal } from '@/components/channels/ChannelConfigModal';
import { cn } from '@/lib/utils';
import {
  CHANNEL_ICONS,
  CHANNEL_NAMES,
  CHANNEL_META,
  getPrimaryChannels,
  type ChannelType,
} from '@/types/channel';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import telegramIcon from '@/assets/channels/telegram.svg';
import discordIcon from '@/assets/channels/discord.svg';
import whatsappIcon from '@/assets/channels/whatsapp.svg';
import dingtalkIcon from '@/assets/channels/dingtalk.svg';
import feishuIcon from '@/assets/channels/feishu.svg';
import wecomIcon from '@/assets/channels/wecom.svg';
import qqIcon from '@/assets/channels/qq.svg';

// ── Types ────────────────────────────────────────────────────────
interface ChannelAccountItem {
  accountId: string;
  name: string;
  configured: boolean;
  status: 'connected' | 'connecting' | 'disconnected' | 'error';
  lastError?: string;
  isDefault: boolean;
  agentId?: string;
}

interface ChannelGroupItem {
  channelType: string;
  defaultAccountId: string;
  status: 'connected' | 'connecting' | 'disconnected' | 'error';
  accounts: ChannelAccountItem[];
}

interface AgentItem { id: string; name: string; }
interface DeleteTarget { channelType: string; accountId?: string; }

function removeDeletedTarget(groups: ChannelGroupItem[], target: DeleteTarget): ChannelGroupItem[] {
  if (target.accountId) {
    return groups
      .map((g) => g.channelType !== target.channelType ? g : { ...g, accounts: g.accounts.filter((a) => a.accountId !== target.accountId) })
      .filter((g) => g.accounts.length > 0);
  }
  return groups.filter((g) => g.channelType !== target.channelType);
}

// ── Channel Logo ─────────────────────────────────────────────────
function ChannelLogo({ type, size = 'md' }: { type: ChannelType; size?: 'sm' | 'md' }) {
  const cls = size === 'sm' ? 'w-[18px] h-[18px]' : 'w-[22px] h-[22px]';
  const icons: Record<string, string> = { telegram: telegramIcon, discord: discordIcon, whatsapp: whatsappIcon, dingtalk: dingtalkIcon, feishu: feishuIcon, wecom: wecomIcon, qqbot: qqIcon };
  const src = icons[type];
  if (src) return <img src={src} alt={type} className={cn(cls, 'dark:invert')} />;
  return <span className={size === 'sm' ? 'text-[18px]' : 'text-[22px]'}>{CHANNEL_ICONS[type] || '💬'}</span>;
}

// ── Status Dot ───────────────────────────────────────────────────
function statusDotClass(status: string) {
  if (status === 'connected') return 'bg-emerald-500';
  if (status === 'connecting') return 'bg-amber-500 animate-pulse';
  if (status === 'error') return 'bg-red-500';
  return 'bg-zinc-400';
}

// ── Main ─────────────────────────────────────────────────────────
export function Channels() {
  const { t } = useTranslation('channels');
  const gatewayStatus = useGatewayStore((state) => state.status);
  const lastGatewayStateRef = useRef(gatewayStatus.state);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [channelGroups, setChannelGroups] = useState<ChannelGroupItem[]>([]);
  const [agents, setAgents] = useState<AgentItem[]>([]);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [selectedChannelType, setSelectedChannelType] = useState<ChannelType | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<string | undefined>(undefined);
  const [allowExistingConfigInModal, setAllowExistingConfigInModal] = useState(true);
  const [allowEditAccountIdInModal, setAllowEditAccountIdInModal] = useState(false);
  const [existingAccountIdsForModal, setExistingAccountIdsForModal] = useState<string[]>([]);
  const [initialConfigValuesForModal, setInitialConfigValuesForModal] = useState<Record<string, string> | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);

  const displayedChannelTypes = getPrimaryChannels();

  // ── Data fetching ────────────────────────────────────────────
  const fetchPageData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [channelsRes, agentsRes] = await Promise.all([
        hostApiFetch<{ success: boolean; channels?: ChannelGroupItem[]; error?: string }>('/api/channels/accounts'),
        hostApiFetch<{ success: boolean; agents?: AgentItem[]; error?: string }>('/api/agents'),
      ]);
      if (!channelsRes.success) throw new Error(channelsRes.error || 'Failed to load channels');
      if (!agentsRes.success) throw new Error(agentsRes.error || 'Failed to load agents');
      setChannelGroups(channelsRes.channels || []);
      setAgents(agentsRes.agents || []);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchPageData(); }, [fetchPageData]);

  useEffect(() => {
    const unsub = subscribeHostEvent('gateway:channel-status', () => { void fetchPageData(); });
    return () => { if (typeof unsub === 'function') unsub(); };
  }, [fetchPageData]);

  useEffect(() => {
    const prev = lastGatewayStateRef.current;
    lastGatewayStateRef.current = gatewayStatus.state;
    if (prev !== 'running' && gatewayStatus.state === 'running') void fetchPageData();
  }, [fetchPageData, gatewayStatus.state]);

  // ── Derived state ────────────────────────────────────────────
  const configuredTypes = useMemo(() => channelGroups.map((g) => g.channelType), [channelGroups]);
  const groupedByType = useMemo(() => Object.fromEntries(channelGroups.map((g) => [g.channelType, g])), [channelGroups]);
  const channelCatalog = useMemo(() => {
    const extras = channelGroups.map((g) => g.channelType as ChannelType).filter((t) => !displayedChannelTypes.includes(t));
    return [...displayedChannelTypes, ...extras];
  }, [channelGroups, displayedChannelTypes]);

  const [activeChannelType, setActiveChannelType] = useState<ChannelType | null>(null);
  const activeChannelGroup = activeChannelType ? groupedByType[activeChannelType] as ChannelGroupItem | undefined : undefined;
  const activeChannelMeta = activeChannelType ? CHANNEL_META[activeChannelType] : undefined;

  useEffect(() => {
    if (activeChannelType && channelCatalog.includes(activeChannelType)) return;
    const next = (channelGroups[0]?.channelType as ChannelType | undefined) || channelCatalog[0] || null;
    if (next) setActiveChannelType(next);
  }, [activeChannelType, channelCatalog, channelGroups]);

  // ── Handlers ─────────────────────────────────────────────────
  const handleRefresh = () => { void fetchPageData(); };

  const handleChannelSelect = (channelType: ChannelType) => {
    setActiveChannelType(channelType);
    if (!groupedByType[channelType]) openNewChannelConfig(channelType);
  };

  const resetModal = () => {
    setShowConfigModal(false);
    setSelectedChannelType(null);
    setSelectedAccountId(undefined);
    setAllowExistingConfigInModal(true);
    setAllowEditAccountIdInModal(false);
    setExistingAccountIdsForModal([]);
    setInitialConfigValuesForModal(undefined);
  };

  const openNewChannelConfig = (channelType: ChannelType) => {
    setActiveChannelType(channelType);
    setSelectedChannelType(channelType);
    setSelectedAccountId(undefined);
    setAllowExistingConfigInModal(true);
    setAllowEditAccountIdInModal(false);
    setExistingAccountIdsForModal([]);
    setInitialConfigValuesForModal(undefined);
    setShowConfigModal(true);
  };

  const openNewChannelAccount = (group: ChannelGroupItem) => {
    const ids = group.accounts.map((a) => a.accountId);
    let nextId = `${group.channelType}-${crypto.randomUUID().slice(0, 8)}`;
    while (ids.includes(nextId)) nextId = `${group.channelType}-${crypto.randomUUID().slice(0, 8)}`;
    setActiveChannelType(group.channelType as ChannelType);
    setSelectedChannelType(group.channelType as ChannelType);
    setSelectedAccountId(nextId);
    setAllowExistingConfigInModal(false);
    setAllowEditAccountIdInModal(true);
    setExistingAccountIdsForModal(ids);
    setInitialConfigValuesForModal(undefined);
    setShowConfigModal(true);
  };

  const openEditChannelAccount = async (channelType: string, accountId: string) => {
    try {
      const res = await hostApiFetch<{ success: boolean; values?: Record<string, string> }>(
        `/api/channels/config/${encodeURIComponent(channelType)}?accountId=${encodeURIComponent(accountId)}`
      );
      setInitialConfigValuesForModal(res.success ? (res.values || {}) : undefined);
    } catch { setInitialConfigValuesForModal(undefined); }
    setActiveChannelType(channelType as ChannelType);
    setSelectedChannelType(channelType as ChannelType);
    setSelectedAccountId(accountId);
    setAllowExistingConfigInModal(true);
    setAllowEditAccountIdInModal(false);
    setExistingAccountIdsForModal([]);
    setShowConfigModal(true);
  };

  const handleSetDefaultAccount = async (channelType: string, accountId: string) => {
    try {
      await hostApiFetch<{ success: boolean }>('/api/channels/default-account', { method: 'PUT', body: JSON.stringify({ channelType, accountId }) });
      await fetchPageData();
      toast.success(t('toast.defaultUpdated'));
    } catch (e) { toast.error(t('toast.configFailed', { error: String(e) })); }
  };

  const handleBindAgent = async (channelType: string, accountId: string, agentId: string) => {
    try {
      if (!agentId) {
        await hostApiFetch<{ success: boolean }>('/api/channels/binding', { method: 'DELETE', body: JSON.stringify({ channelType, accountId }) });
      } else {
        await hostApiFetch<{ success: boolean }>('/api/channels/binding', { method: 'PUT', body: JSON.stringify({ channelType, accountId, agentId }) });
      }
      await fetchPageData();
      toast.success(t('toast.bindingUpdated'));
    } catch (e) { toast.error(t('toast.configFailed', { error: String(e) })); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      const suffix = deleteTarget.accountId ? `?accountId=${encodeURIComponent(deleteTarget.accountId)}` : '';
      await hostApiFetch(`/api/channels/config/${encodeURIComponent(deleteTarget.channelType)}${suffix}`, { method: 'DELETE' });
      setChannelGroups((prev) => removeDeletedTarget(prev, deleteTarget));
      toast.success(deleteTarget.accountId ? t('toast.accountDeleted') : t('toast.channelDeleted'));
      window.setTimeout(() => { void fetchPageData(); }, 1200);
    } catch (e) { toast.error(t('toast.configFailed', { error: String(e) })); }
    finally { setDeleteTarget(null); }
  };

  // ── Render ───────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex flex-col -m-6 bg-background min-h-[calc(100vh-2.5rem)] items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="flex flex-col -m-6 bg-background h-[calc(100vh-2.5rem)] overflow-hidden">
      <div className="w-full max-w-6xl mx-auto flex flex-col h-full p-6 lg:p-8">
        {/* Header */}
        <header className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-4 shrink-0">
          <div>
            <h1 className="text-2xl font-semibold text-foreground tracking-tight">{t('title')}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{t('subtitle')}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={gatewayStatus.state !== 'running'}
              className="h-8 text-xs rounded-full px-3"
            >
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              {t('refresh')}
            </Button>
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-hidden min-h-0 space-y-4">
          {/* Warnings */}
          {gatewayStatus.state !== 'running' && (
            <div className="p-3 rounded-lg border border-amber-500/20 bg-amber-500/5 text-xs text-amber-600 dark:text-amber-400 flex items-start gap-2">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>{t('gatewayWarning')}</span>
            </div>
          )}
          {error && (
            <div className="p-3 rounded-lg border border-red-500/20 bg-red-500/5 text-xs text-red-600 dark:text-red-400 flex items-start gap-2">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Two-column layout */}
          <div className="grid h-full min-h-0 gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
            {/* Left sidebar */}
            <Card className="rounded-xl border-0 shadow-none bg-black/[0.02] dark:bg-white/[0.02] flex flex-col min-h-0 overflow-hidden">
              <div className="px-5 py-4 border-b border-border/30">
                <h3 className="text-sm font-semibold">{t('layout.channels', { defaultValue: '频道列表' })}</h3>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {t('layout.channelsDesc', { defaultValue: '选择频道查看详情' })}
                </p>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {channelCatalog.map((type) => {
                  const group = groupedByType[type] as ChannelGroupItem | undefined;
                  const meta = CHANNEL_META[type as ChannelType];
                  const isSelected = activeChannelType === type;
                  const accountCount = group?.accounts.length ?? 0;
                  const status = group?.status ?? 'disconnected';

                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => handleChannelSelect(type)}
                      className={cn(
                        'w-full rounded-lg px-3 py-2.5 text-left transition-colors',
                        isSelected
                          ? 'bg-black/[0.05] dark:bg-white/[0.06]'
                          : 'hover:bg-black/[0.03] dark:hover:bg-white/[0.04]',
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-black/[0.04] dark:bg-white/[0.06]">
                          <ChannelLogo type={type as ChannelType} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <p className="truncate text-xs font-semibold text-foreground">
                              {CHANNEL_NAMES[type as ChannelType] || type}
                            </p>
                            {meta?.isPlugin && (
                              <Badge variant="secondary" className="text-[9px] font-medium px-1.5 py-0 rounded-full bg-black/[0.04] dark:bg-white/[0.08] border-0 shadow-none text-foreground/60">
                                {t('pluginBadge')}
                              </Badge>
                            )}
                          </div>
                          <p className="mt-0.5 text-[10px] text-muted-foreground">
                            {group
                              ? `${t('layout.accountsCount', { count: accountCount, defaultValue: `${accountCount} 个账号` })} · ${t(`account.connectionStatus.${status}`)}`
                              : t('layout.notConfigured', { defaultValue: '未接入' })}
                          </p>
                        </div>
                        <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', statusDotClass(status))} />
                      </div>
                    </button>
                  );
                })}
              </div>
            </Card>

            {/* Right detail panel */}
            <Card className="rounded-xl border-0 shadow-none bg-black/[0.02] dark:bg-white/[0.02] flex flex-col min-h-0 overflow-hidden">
              {activeChannelType ? (
                <>
                  {/* Detail header */}
                  <div className="px-5 py-4 border-b border-border/30">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-black/[0.04] dark:bg-white/[0.06]">
                          <ChannelLogo type={activeChannelType} />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="text-base font-semibold text-foreground truncate">
                              {CHANNEL_NAMES[activeChannelType] || activeChannelType}
                            </h3>
                            {activeChannelMeta?.isPlugin && (
                              <Badge variant="secondary" className="text-[9px] font-medium px-1.5 py-0 rounded-full bg-black/[0.04] dark:bg-white/[0.08] border-0 shadow-none text-foreground/60">
                                {t('pluginBadge')}
                              </Badge>
                            )}
                          </div>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {activeChannelGroup
                              ? t('layout.detailSummary', {
                                count: activeChannelGroup.accounts.length,
                                status: t(`account.connectionStatus.${activeChannelGroup.status}`),
                                defaultValue: `${activeChannelGroup.accounts.length} 个账号 · ${t(`account.connectionStatus.${activeChannelGroup.status}`)}`,
                              })
                              : t('layout.detailEmptySummary', {
                                defaultValue: activeChannelMeta ? t(activeChannelMeta.description.replace('channels:', '')) : '',
                              })}
                          </p>
                        </div>
                      </div>
                      {activeChannelGroup ? (
                        <Button
                          size="sm"
                          onClick={() => openNewChannelAccount(activeChannelGroup)}
                          className="h-8 text-xs rounded-full px-3"
                        >
                          <Plus className="h-3.5 w-3.5 mr-1.5" />
                          {t('account.add')}
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          onClick={() => openNewChannelConfig(activeChannelType)}
                          className="h-8 text-xs rounded-full px-3"
                        >
                          <Plus className="h-3.5 w-3.5 mr-1.5" />
                          {t('addChannel')}
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Detail content */}
                  <div className="flex-1 overflow-y-auto p-4 min-h-0">
                    {!activeChannelGroup ? (
                      /* Empty state */
                      <div className="flex flex-col items-center justify-center h-full py-12 text-center">
                        <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-black/[0.04] dark:bg-white/[0.06] mb-4">
                          <ChannelLogo type={activeChannelType} />
                        </div>
                        <h4 className="text-sm font-semibold text-foreground/70">
                          {t('layout.emptyChannelTitle', {
                            name: CHANNEL_NAMES[activeChannelType] || activeChannelType,
                            defaultValue: `${CHANNEL_NAMES[activeChannelType] || activeChannelType} 尚未接入`,
                          })}
                        </h4>
                        <p className="mt-1.5 max-w-sm text-xs text-muted-foreground">
                          {activeChannelMeta ? t(activeChannelMeta.description.replace('channels:', '')) : ''}
                        </p>
                        <Button
                          size="sm"
                          onClick={() => openNewChannelConfig(activeChannelType)}
                          className="mt-4 h-8 text-xs rounded-full px-4"
                        >
                          <Plus className="h-3.5 w-3.5 mr-1.5" />
                          {t('addChannel')}
                        </Button>
                      </div>
                    ) : (
                      /* Account list */
                      <div className="space-y-3">
                        {activeChannelGroup.accounts.map((account) => {
                          const displayName = account.accountId === 'default' && account.name === account.accountId
                            ? t('account.mainAccount')
                            : account.name;

                          return (
                            <div
                              key={`${activeChannelGroup.channelType}-${account.accountId}`}
                              className={cn(
                                'group rounded-xl bg-black/[0.03] dark:bg-white/[0.04] transition-colors hover:bg-black/[0.05] dark:hover:bg-white/[0.06]',
                                account.isDefault && 'ring-1 ring-border/60',
                              )}
                            >
                              {/* Account header */}
                              <div className="px-4 py-3.5 border-b border-border/20">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="text-sm font-semibold text-foreground truncate">{displayName}</span>
                                      {account.isDefault && (
                                        <span className="rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 text-[10px] font-medium">
                                          {t('account.default')}
                                        </span>
                                      )}
                                      <span className={cn(
                                        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium',
                                        account.status === 'connected' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' :
                                        account.status === 'connecting' ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400' :
                                        account.status === 'error' ? 'bg-red-500/10 text-red-600 dark:text-red-400' :
                                        'bg-zinc-500/10 text-zinc-600 dark:text-zinc-400',
                                      )}>
                                        <span className={cn('w-1.5 h-1.5 rounded-full', statusDotClass(account.status))} />
                                        {t(`account.connectionStatus.${account.status}`)}
                                      </span>
                                    </div>
                                    <p className="mt-1 text-[11px] text-muted-foreground">
                                      {t('account.idLabel', { id: account.accountId })}
                                    </p>
                                  </div>

                                  {/* Hover actions */}
                                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                    {!account.isDefault && (
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-7 rounded-full px-2.5 text-[11px] font-medium"
                                        onClick={() => void handleSetDefaultAccount(activeChannelGroup.channelType, account.accountId)}
                                      >
                                        {t('account.setDefault')}
                                      </Button>
                                    )}
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7 rounded-md text-muted-foreground hover:text-foreground"
                                      onClick={() => { void openEditChannelAccount(activeChannelGroup.channelType, account.accountId); }}
                                      title={t('account.edit')}
                                    >
                                      <Edit className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7 rounded-md text-muted-foreground hover:text-red-500"
                                      onClick={() => setDeleteTarget({ channelType: activeChannelGroup.channelType, accountId: account.accountId })}
                                      title={t('account.delete')}
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  </div>
                                </div>
                              </div>

                              {/* Account body */}
                              <div className="px-4 py-3 space-y-2.5">
                                {account.lastError && (
                                  <div className="flex items-start gap-2 p-2.5 rounded-lg border border-red-500/20 bg-red-500/5 text-xs text-red-600 dark:text-red-400">
                                    <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                                    <span className="line-clamp-2">{account.lastError}</span>
                                  </div>
                                )}

                                {/* Agent binding */}
                                <div className="flex items-center justify-between gap-3 rounded-lg bg-black/[0.03] dark:bg-white/[0.04] p-3">
                                  <div>
                                    <p className="text-xs font-medium text-foreground/80">{t('account.bindAgentLabel')}</p>
                                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                                      {account.agentId
                                        ? t('account.boundTo', { agent: agents.find((a) => a.id === account.agentId)?.name || account.agentId })
                                        : t('account.unassigned')}
                                    </p>
                                  </div>
                                  <select
                                    className="h-7 rounded-md border border-border/40 bg-background px-2 text-[11px]"
                                    value={account.agentId || ''}
                                    onChange={(e) => { void handleBindAgent(activeChannelGroup.channelType, account.accountId, e.target.value); }}
                                  >
                                    <option value="">{t('account.unassigned')}</option>
                                    {agents.map((agent) => (
                                      <option key={agent.id} value={agent.id}>{agent.name}</option>
                                    ))}
                                  </select>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                /* No channel selected */
                <div className="flex flex-col items-center justify-center h-full py-12 text-center">
                  <ChannelLogo type={displayedChannelTypes[0]} />
                  <h3 className="mt-4 text-sm font-semibold text-foreground/70">
                    {t('layout.emptySelectionTitle', { defaultValue: '从左侧选择一个频道开始查看详情' })}
                  </h3>
                  <p className="mt-1.5 max-w-sm text-xs text-muted-foreground">
                    {t('layout.emptySelectionDesc', { defaultValue: '选择频道后，可以在右侧查看账号、连接状态和与 Agent 的绑定情况。' })}
                  </p>
                </div>
              )}
            </Card>
          </div>
        </div>
      </div>

      {/* Config Modal */}
      {showConfigModal && (
        <ChannelConfigModal
          initialSelectedType={selectedChannelType}
          accountId={selectedAccountId}
          configuredTypes={configuredTypes}
          allowExistingConfig={allowExistingConfigInModal}
          allowEditAccountId={allowEditAccountIdInModal}
          existingAccountIds={existingAccountIdsForModal}
          initialConfigValues={initialConfigValuesForModal}
          showChannelName={false}
          onClose={resetModal}
          onChannelSaved={async () => { await fetchPageData(); resetModal(); }}
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title={t('common.confirm', 'Confirm')}
        message={deleteTarget?.accountId ? t('account.deleteConfirm') : t('deleteConfirm')}
        confirmLabel={t('common.delete', 'Delete')}
        cancelLabel={t('common.cancel', 'Cancel')}
        variant="destructive"
        onConfirm={() => { void handleDelete(); }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

export default Channels;
