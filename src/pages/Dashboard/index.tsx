/**
 * Dashboard Page
 * Gateway status overview with quick operations, env checks, and system info.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Globe,
  HardDrive,
  Loader2,
  Monitor,
  Play,
  RefreshCw,
  RotateCw,
  Server,
  Square,
  Stethoscope,
  Timer,
  Wifi,
  XCircle,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn, formatDuration } from '@/lib/utils';
import { hostApiFetch } from '@/lib/host-api';
import { invokeIpc } from '@/lib/api-client';
import { useGatewayStore } from '@/stores/gateway';
import { useTranslation } from 'react-i18next';

type CheckStatus = 'checking' | 'success' | 'error';
type EnvCheck = { status: CheckStatus; message: string };

type OpenClawStatus = {
  packageExists: boolean;
  isBuilt: boolean;
  entryPath: string;
  dir: string;
  version?: string;
};

type GatewayProcessStats = {
  pid: number | null;
  rssBytes: number | null;
};

type SystemInfo = {
  osName: string;
  arch: string;
  cpuModel: string;
  cpuCores: number;
  totalMemory: number;
  freeMemory: number;
  hostname: string;
  nodeVersion: string;
};

function formatBytes(bytes: number | null | undefined): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return '--';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const rounded = unitIndex <= 1 ? Math.round(value) : Number(value.toFixed(1));
  return `${rounded} ${units[unitIndex]}`;
}

function formatUptimeSeconds(seconds: number | undefined): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return '--';
  return formatDuration(Math.round(seconds));
}

function getStatusStyles(state: string) {
  const styles = {
    running: {
      bg: 'bg-emerald-500/10',
      text: 'text-emerald-600 dark:text-emerald-400',
      dot: 'bg-emerald-500',
      border: 'border-emerald-500/20',
      icon: 'text-emerald-500',
    },
    error: {
      bg: 'bg-red-500/10',
      text: 'text-red-600 dark:text-red-400',
      dot: 'bg-red-500',
      border: 'border-red-500/20',
      icon: 'text-red-500',
    },
    starting: {
      bg: 'bg-amber-500/10',
      text: 'text-amber-600 dark:text-amber-400',
      dot: 'bg-amber-500',
      border: 'border-amber-500/20',
      icon: 'text-amber-500',
    },
    reconnecting: {
      bg: 'bg-amber-500/10',
      text: 'text-amber-600 dark:text-amber-400',
      dot: 'bg-amber-500',
      border: 'border-amber-500/20',
      icon: 'text-amber-500',
    },
    default: {
      bg: 'bg-zinc-500/10',
      text: 'text-zinc-600 dark:text-zinc-400',
      dot: 'bg-zinc-400',
      border: 'border-zinc-500/20',
      icon: 'text-zinc-400',
    },
  };
  return styles[state as keyof typeof styles] || styles.default;
}

function MetricItem({ label, value, icon, color }: { label: string; value: string; icon?: React.ReactNode; color?: string }) {
  return (
    <div className="rounded-lg bg-black/[0.03] dark:bg-white/[0.04] p-4 min-w-0">
      <div className="flex items-center gap-1.5 mb-2">
        {icon && <span className={color || 'text-muted-foreground/50'}>{icon}</span>}
        <span className={cn('text-xs uppercase tracking-wider font-medium', color || 'text-muted-foreground/60')}>
          {label}
        </span>
      </div>
      <div className="text-xl font-bold text-foreground truncate">{value}</div>
    </div>
  );
}

function EnvCheckItem({ label, check }: { label: string; check: EnvCheck }) {
  const icon =
    check.status === 'checking' ? (
      <Loader2 className="h-4 w-4 animate-spin text-amber-500" />
    ) : check.status === 'success' ? (
      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
    ) : (
      <XCircle className="h-4 w-4 text-red-500" />
    );

  return (
    <div className="flex items-center justify-between gap-2 py-2">
      <div className="flex items-center gap-2.5 min-w-0">
        {icon}
        <span className="text-sm font-medium text-foreground/80">{label}</span>
      </div>
      <span className="text-xs text-muted-foreground truncate max-w-[160px]">
        {check.message}
      </span>
    </div>
  );
}

export function Dashboard() {
  const { t } = useTranslation(['dashboard', 'common']);

  const gatewayStatus = useGatewayStore((s) => s.status);
  const gatewayHealth = useGatewayStore((s) => s.health);
  const lastError = useGatewayStore((s) => s.lastError);
  const startGateway = useGatewayStore((s) => s.start);
  const stopGateway = useGatewayStore((s) => s.stop);
  const restartGateway = useGatewayStore((s) => s.restart);
  const checkHealth = useGatewayStore((s) => s.checkHealth);

  const [envChecks, setEnvChecks] = useState<Record<'node' | 'openclaw' | 'gateway', EnvCheck>>({
    node: { status: 'checking', message: '' },
    openclaw: { status: 'checking', message: '' },
    gateway: { status: 'checking', message: '' },
  });
  const [processStats, setProcessStats] = useState<GatewayProcessStats>({ pid: null, rssBytes: null });
  const [diagnosing, setDiagnosing] = useState(false);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);

  const effectiveError = gatewayStatus.error || lastError || null;
  const isBusy = gatewayStatus.state === 'starting' || gatewayStatus.state === 'reconnecting';

  const refreshProcessStats = useCallback(async () => {
    try {
      const result = await hostApiFetch<GatewayProcessStats>('/api/gateway/process-stats');
      setProcessStats({
        pid: typeof result.pid === 'number' && Number.isFinite(result.pid) ? result.pid : null,
        rssBytes: typeof result.rssBytes === 'number' && Number.isFinite(result.rssBytes) ? result.rssBytes : null,
      });
    } catch {
      setProcessStats({ pid: null, rssBytes: null });
    }
  }, []);

  const refreshEnvChecks = useCallback(async () => {
    setEnvChecks({
      node: { status: 'checking', message: t('dashboard:env.checking') },
      openclaw: { status: 'checking', message: t('dashboard:env.checking') },
      gateway: { status: 'checking', message: t('dashboard:env.checking') },
    });

    // Node.js version
    try {
      const info = await invokeIpc<SystemInfo>('app:systemInfo');
      const nv = info?.nodeVersion || '';
      setEnvChecks((prev) => ({
        ...prev,
        node: { status: 'success', message: nv ? `v${nv}` : t('dashboard:env.ok') },
      }));
    } catch {
      setEnvChecks((prev) => ({
        ...prev,
        node: { status: 'success', message: t('dashboard:env.ok') },
      }));
    }

    // OpenClaw status
    try {
      const status = await invokeIpc<OpenClawStatus>('openclaw:status');
      if (!status.packageExists) {
        setEnvChecks((prev) => ({
          ...prev,
          openclaw: { status: 'error', message: `${t('dashboard:env.error')}: ${status.dir}` },
        }));
      } else if (!status.isBuilt) {
        setEnvChecks((prev) => ({
          ...prev,
          openclaw: { status: 'error', message: `${t('dashboard:env.error')}: dist missing` },
        }));
      } else {
        const versionLabel = status.version ? `v${status.version}` : null;
        setEnvChecks((prev) => ({
          ...prev,
          openclaw: {
            status: 'success',
            message: versionLabel ? `${t('dashboard:env.ok')} (${versionLabel})` : t('dashboard:env.ok'),
          },
        }));
      }
    } catch (error) {
      setEnvChecks((prev) => ({
        ...prev,
        openclaw: { status: 'error', message: String(error) },
      }));
    }

    // Gateway
    const gwStatus = useGatewayStore.getState().status;
    if (gwStatus.state === 'running') {
      setEnvChecks((prev) => ({
        ...prev,
        gateway: { status: 'success', message: `${t('dashboard:env.ok')} (port ${gwStatus.port})` },
      }));
    } else if (gwStatus.state === 'error') {
      setEnvChecks((prev) => ({
        ...prev,
        gateway: { status: 'error', message: gwStatus.error || t('dashboard:env.error') },
      }));
    } else {
      setEnvChecks((prev) => ({
        ...prev,
        gateway: { status: 'checking', message: gwStatus.state === 'starting' ? 'Starting...' : 'Waiting...' },
      }));
    }
  }, [t]);

  const diagnose = useCallback(async () => {
    setDiagnosing(true);
    try {
      await Promise.all([refreshEnvChecks(), checkHealth(), refreshProcessStats()]);
      toast.success(t('dashboard:ops.done'));
    } catch (error) {
      toast.error(String(error));
    } finally {
      setDiagnosing(false);
    }
  }, [checkHealth, refreshEnvChecks, refreshProcessStats, t]);

  const openControlUi = useCallback(async () => {
    try {
      const result = await hostApiFetch<{ success: boolean; url?: string; error?: string }>(
        '/api/gateway/control-ui',
      );
      if (result.success && result.url) {
        await invokeIpc('shell:openExternal', result.url);
        return;
      }
      toast.error(result.error || 'Failed to open dashboard');
    } catch (error) {
      toast.error(String(error));
    }
  }, []);

  // Initial loads
  useEffect(() => {
    void refreshEnvChecks();
    void refreshProcessStats();
  }, [refreshEnvChecks, refreshProcessStats]);

  // Load system info
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const info = await invokeIpc<SystemInfo>('app:systemInfo');
        if (!cancelled && info) setSystemInfo(info);
      } catch {
        // ignore
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Poll health + process stats when running
  useEffect(() => {
    if (gatewayStatus.state !== 'running') return;
    void checkHealth();
    void refreshProcessStats();
    const timer = window.setInterval(() => {
      void checkHealth();
      void refreshProcessStats();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [checkHealth, gatewayStatus.state, refreshProcessStats]);

  // Sync gateway env check with status changes
  useEffect(() => {
    if (gatewayStatus.state === 'running') {
      setEnvChecks((prev) => ({
        ...prev,
        gateway: { status: 'success', message: `${t('dashboard:env.ok')} (port ${gatewayStatus.port})` },
      }));
    } else if (gatewayStatus.state === 'error') {
      setEnvChecks((prev) => ({
        ...prev,
        gateway: { status: 'error', message: gatewayStatus.error || t('dashboard:env.error') },
      }));
    } else {
      setEnvChecks((prev) => ({
        ...prev,
        gateway: { status: 'checking', message: gatewayStatus.state === 'starting' ? 'Starting...' : 'Waiting...' },
      }));
    }
  }, [gatewayStatus.error, gatewayStatus.port, gatewayStatus.state, t]);

  const uptimeSeconds = useMemo(() => {
    if (gatewayHealth?.ok && typeof gatewayHealth.uptime === 'number') return gatewayHealth.uptime;
    if (gatewayStatus.connectedAt) return Math.max(0, (Date.now() - gatewayStatus.connectedAt) / 1000);
    if (typeof gatewayStatus.uptime === 'number') {
      return gatewayStatus.uptime > 10_000 ? gatewayStatus.uptime / 1000 : gatewayStatus.uptime;
    }
    return undefined;
  }, [gatewayHealth?.ok, gatewayHealth?.uptime, gatewayStatus.connectedAt, gatewayStatus.uptime]);

  const stateLabel = useMemo(() => {
    switch (gatewayStatus.state) {
      case 'running': return t('common:status.running');
      case 'stopped': return t('common:status.stopped');
      case 'error': return t('common:status.error');
      case 'starting': return 'Starting';
      case 'reconnecting': return 'Reconnecting';
      default: return gatewayStatus.state;
    }
  }, [gatewayStatus.state, t]);

  const statusStyles = getStatusStyles(gatewayStatus.state);

  return (
    <div className="flex flex-col -m-6 bg-background h-[calc(100vh-2.5rem)] overflow-hidden">
      <div className="w-full max-w-6xl mx-auto flex flex-col h-full p-6 lg:p-8">
        {/* Header */}
        <header className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-4 shrink-0">
          <div>
            <h1 className="text-2xl font-semibold text-foreground tracking-tight">
              {t('common:sidebar.dashboard')}
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {t('dashboard:statusCard.title')} / {t('dashboard:env.title')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void refreshEnvChecks()}
              className="h-8 text-xs rounded-full px-3"
            >
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              {t('common:actions.refresh')}
            </Button>
            <Button
              size="sm"
              onClick={() => void openControlUi()}
              className="h-8 text-xs rounded-full px-3"
            >
              <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
              OpenClaw UI
            </Button>
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto min-h-0 space-y-4 pb-4">
          {/* Row 1: Running Status - Full Width */}
          <Card className="rounded-xl border-0 shadow-none bg-black/[0.02] dark:bg-white/[0.02] overflow-hidden">
            <div className="p-6">
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div className={cn('p-2.5 rounded-xl', statusStyles.bg)}>
                    <Activity className={cn('h-6 w-6', statusStyles.icon)} />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold">{t('dashboard:statusCard.title')}</h2>
                    <p className="text-sm text-muted-foreground">OpenClaw Gateway</p>
                  </div>
                </div>
                <div
                  className={cn(
                    'inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold border',
                    statusStyles.bg, statusStyles.text, statusStyles.border,
                  )}
                >
                  <span
                    className={cn(
                      'w-2 h-2 rounded-full',
                      statusStyles.dot,
                      gatewayStatus.state === 'running' && 'animate-pulse',
                    )}
                  />
                  {stateLabel}
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <MetricItem
                  label={t('dashboard:statusCard.port')}
                  value={String(gatewayStatus.port ?? '--')}
                  icon={<Globe className="h-3.5 w-3.5" />}
                  color="text-sky-500"
                />
                <MetricItem
                  label={t('dashboard:statusCard.pid')}
                  value={processStats.pid ? String(processStats.pid) : '--'}
                  icon={<Server className="h-3.5 w-3.5" />}
                  color="text-violet-500"
                />
                <MetricItem
                  label={t('dashboard:statusCard.memory')}
                  value={formatBytes(processStats.rssBytes)}
                  icon={<HardDrive className="h-3.5 w-3.5" />}
                  color="text-amber-500"
                />
                <MetricItem
                  label={t('dashboard:statusCard.uptime')}
                  value={formatUptimeSeconds(uptimeSeconds)}
                  icon={<Timer className="h-3.5 w-3.5" />}
                  color="text-emerald-500"
                />
              </div>

              {effectiveError && (
                <div className="mt-4 p-3 rounded-lg border border-red-500/20 bg-red-500/5 text-xs text-red-600 dark:text-red-400 flex items-start gap-2">
                  <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span className="break-all">{effectiveError}</span>
                </div>
              )}
            </div>
          </Card>

          {/* Row 2: Three Columns */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Col 1: Quick Operations */}
            <Card className="rounded-xl border-0 shadow-none bg-black/[0.02] dark:bg-white/[0.02]">
              <div className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Zap className="h-4 w-4 text-amber-500" />
                  <h3 className="text-sm font-semibold">{t('dashboard:ops.title')}</h3>
                </div>
                <div className="space-y-2">
                  <div className="grid grid-cols-3 gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isBusy || gatewayStatus.state === 'running'}
                      onClick={() => void startGateway()}
                      className="h-9 text-xs rounded-lg border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300"
                    >
                      <Play className="h-3.5 w-3.5 mr-1" />
                      {t('dashboard:ops.start')}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isBusy || gatewayStatus.state !== 'running'}
                      onClick={() => void stopGateway()}
                      className="h-9 text-xs rounded-lg border-red-500/30 text-red-600 hover:bg-red-500/10 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                    >
                      <Square className="h-3.5 w-3.5 mr-1" />
                      {t('dashboard:ops.stop')}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isBusy}
                      onClick={() => void restartGateway()}
                      className="h-9 text-xs rounded-lg border-sky-500/30 text-sky-600 hover:bg-sky-500/10 hover:text-sky-700 dark:text-sky-400 dark:hover:text-sky-300"
                    >
                      <RotateCw className="h-3.5 w-3.5 mr-1" />
                      {t('dashboard:ops.restart')}
                    </Button>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={diagnosing}
                    onClick={() => void diagnose()}
                    className="w-full h-9 text-xs rounded-lg border-amber-500/30 text-amber-600 hover:bg-amber-500/10 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300"
                  >
                    {diagnosing ? (
                      <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                    ) : (
                      <Stethoscope className="h-3.5 w-3.5 mr-1.5" />
                    )}
                    {diagnosing ? t('dashboard:ops.diagnosing') : t('dashboard:ops.diagnose')}
                  </Button>
                </div>
              </div>
            </Card>

            {/* Col 2: Environment Checks */}
            <Card className="rounded-xl border-0 shadow-none bg-black/[0.02] dark:bg-white/[0.02]">
              <div className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Wifi className="h-4 w-4 text-sky-500" />
                  <h3 className="text-sm font-semibold">{t('dashboard:env.title')}</h3>
                </div>
                <div className="divide-y divide-border/50">
                  <EnvCheckItem label={t('dashboard:env.node')} check={envChecks.node} />
                  <EnvCheckItem label={t('dashboard:env.openclaw')} check={envChecks.openclaw} />
                  <EnvCheckItem label={t('dashboard:env.gateway')} check={envChecks.gateway} />
                </div>
              </div>
            </Card>

            {/* Col 3: System Info (Local Machine) */}
            <Card className="rounded-xl border-0 shadow-none bg-black/[0.02] dark:bg-white/[0.02]">
              <div className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Monitor className="h-4 w-4 text-violet-500" />
                  <h3 className="text-sm font-semibold">{t('dashboard:system.title')}</h3>
                </div>
                {systemInfo ? (
                  <div className="space-y-2 text-xs">
                    <div className="flex items-center justify-between py-1">
                      <span className="text-muted-foreground">{t('dashboard:system.os')}</span>
                      <span className="font-medium text-foreground truncate max-w-[160px]">{systemInfo.osName}</span>
                    </div>
                    <div className="flex items-center justify-between py-1">
                      <span className="text-muted-foreground">{t('dashboard:system.cpu')}</span>
                      <span className="font-medium text-foreground truncate max-w-[160px]">{systemInfo.cpuModel.split(' ').slice(0, 3).join(' ')}</span>
                    </div>
                    <div className="flex items-center justify-between py-1">
                      <span className="text-muted-foreground">{t('dashboard:system.totalMemory')}</span>
                      <span className="font-medium text-foreground">{formatBytes(systemInfo.totalMemory)}</span>
                    </div>
                    <div className="flex items-center justify-between py-1">
                      <span className="text-muted-foreground">{t('dashboard:system.arch')}</span>
                      <span className="font-medium text-foreground">{systemInfo.arch}</span>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-center text-muted-foreground text-xs py-4">
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />
                    Loading...
                  </div>
                )}
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
