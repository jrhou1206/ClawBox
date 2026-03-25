/**
 * Diagnostics Page
 * Environment checks, system info, logs, and gateway controls.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FolderOpen,
  Loader2,
  Play,
  RefreshCw,
  RotateCw,
  Square,
  Stethoscope,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
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

function EnvCheckItem({ label, check }: { label: string; check: EnvCheck }) {
  const icon =
    check.status === 'checking' ? (
      <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-500" />
    ) : check.status === 'success' ? (
      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
    ) : (
      <XCircle className="h-3.5 w-3.5 text-red-500" />
    );

  return (
    <div className="flex items-center justify-between gap-3 py-2 px-3 rounded-lg bg-black/[0.03] dark:bg-white/[0.04]">
      <div className="flex items-center gap-2 min-w-0">
        {icon}
        <span className="text-xs font-medium text-foreground/80">{label}</span>
      </div>
      <span className="text-[11px] text-muted-foreground truncate max-w-[200px]">
        {check.message}
      </span>
    </div>
  );
}

function MetricItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-black/[0.03] dark:bg-white/[0.04] p-3 min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium mb-1">
        {label}
      </div>
      <div className="text-sm font-semibold text-foreground truncate">{value}</div>
    </div>
  );
}

export function Diagnostics() {
  const { t } = useTranslation(['dashboard', 'common']);

  const gatewayStatus = useGatewayStore((s) => s.status);
  const lastError = useGatewayStore((s) => s.lastError);
  const startGateway = useGatewayStore((s) => s.start);
  const stopGateway = useGatewayStore((s) => s.stop);
  const restartGateway = useGatewayStore((s) => s.restart);
  const checkHealth = useGatewayStore((s) => s.checkHealth);

  const [openclawStatus, setOpenclawStatus] = useState<OpenClawStatus | null>(null);
  const [openclawConfigDir, setOpenclawConfigDir] = useState('');
  const [logDir, setLogDir] = useState('');
  const [appVersion, setAppVersion] = useState('');
  const [platform, setPlatform] = useState('');

  const [envChecks, setEnvChecks] = useState<Record<'node' | 'openclaw' | 'gateway', EnvCheck>>({
    node: { status: 'checking', message: '' },
    openclaw: { status: 'checking', message: '' },
    gateway: { status: 'checking', message: '' },
  });

  const [diagnosing, setDiagnosing] = useState(false);
  const [showSystemInfo, setShowSystemInfo] = useState(false);

  const [autoRefreshLogs, setAutoRefreshLogs] = useState(true);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsContent, setLogsContent] = useState('');
  const logsContainerRef = useRef<HTMLDivElement>(null);

  const effectiveError = gatewayStatus.error || lastError || null;
  const isBusy = gatewayStatus.state === 'starting' || gatewayStatus.state === 'reconnecting';

  const refreshLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      const result = await hostApiFetch<{ content: string }>('/api/logs?tailLines=200');
      setLogsContent(result.content || '');
    } catch (error) {
      setLogsContent(`(Failed to load logs: ${String(error)})`);
    } finally {
      setLogsLoading(false);
    }
  }, []);

  const refreshEnvChecks = useCallback(async () => {
    setEnvChecks({
      node: { status: 'checking', message: t('dashboard:env.checking') },
      openclaw: { status: 'checking', message: t('dashboard:env.checking') },
      gateway: { status: 'checking', message: t('dashboard:env.checking') },
    });

    setEnvChecks((prev) => ({
      ...prev,
      node: { status: 'success', message: t('dashboard:env.ok') },
    }));

    try {
      const status = await invokeIpc<OpenClawStatus>('openclaw:status');
      setOpenclawStatus(status);

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
      await Promise.all([refreshEnvChecks(), checkHealth(), refreshLogs()]);
      toast.success(t('dashboard:ops.done'));
    } catch (error) {
      toast.error(String(error));
    } finally {
      setDiagnosing(false);
    }
  }, [checkHealth, refreshEnvChecks, refreshLogs, t]);

  const openLogFolder = useCallback(async () => {
    try {
      const result = await hostApiFetch<{ dir: string | null }>('/api/logs/dir');
      if (result.dir) {
        await invokeIpc('shell:showItemInFolder', result.dir);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void refreshEnvChecks();
    void refreshLogs();
  }, [refreshEnvChecks, refreshLogs]);

  useEffect(() => {
    if (!autoRefreshLogs) return;
    const timer = window.setInterval(() => void refreshLogs(), 2500);
    return () => window.clearInterval(timer);
  }, [autoRefreshLogs, refreshLogs]);

  useEffect(() => {
    if (!logsContainerRef.current) return;
    logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
  }, [logsContent]);

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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [version, plat, configDir, logDirResp] = await Promise.all([
          invokeIpc<string>('app:version').catch(() => ''),
          invokeIpc<string>('app:platform').catch(() => ''),
          invokeIpc<string>('openclaw:getConfigDir').catch(() => ''),
          hostApiFetch<{ dir: string | null }>('/api/logs/dir').catch(() => ({ dir: null })),
        ]);
        if (cancelled) return;
        setAppVersion(version || '');
        setPlatform(plat || '');
        setOpenclawConfigDir(configDir || '');
        setLogDir(logDirResp.dir || '');
      } catch {
        // ignore
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="flex flex-col -m-6 bg-background h-[calc(100vh-2.5rem)] overflow-hidden">
      <div className="w-full max-w-6xl mx-auto flex flex-col h-full p-6 lg:p-8">
        {/* Header */}
        <header className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-4 shrink-0">
          <div>
            <h1 className="text-2xl font-semibold text-foreground tracking-tight">
              {t('dashboard:env.title')}
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {t('dashboard:statusCard.title')} / {t('dashboard:logsSection.title')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void diagnose()}
              disabled={diagnosing}
              className="h-8 text-xs rounded-full px-3"
            >
              {diagnosing ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Stethoscope className="h-3.5 w-3.5 mr-1.5" />}
              {diagnosing ? t('dashboard:ops.diagnosing') : t('dashboard:ops.diagnose')}
            </Button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto min-h-0 space-y-4 pb-4">
          {/* Environment Checks + Controls */}
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
            {/* Env Checks */}
            <Card className="rounded-xl border-0 shadow-none bg-black/[0.02] dark:bg-white/[0.02]">
              <div className="p-5">
                <h3 className="text-sm font-semibold mb-3">{t('dashboard:env.title')}</h3>
                {openclawStatus?.dir && (
                  <p className="text-[11px] text-muted-foreground mb-3">OpenClaw: {openclawStatus.dir}</p>
                )}
                <div className="space-y-2">
                  <EnvCheckItem label={t('dashboard:env.node')} check={envChecks.node} />
                  <EnvCheckItem label={t('dashboard:env.openclaw')} check={envChecks.openclaw} />
                  <EnvCheckItem label={t('dashboard:env.gateway')} check={envChecks.gateway} />
                </div>
                {effectiveError && (
                  <div className="mt-3 p-3 rounded-lg border border-red-500/20 bg-red-500/5 text-xs text-red-600 dark:text-red-400 flex items-start gap-2">
                    <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span className="break-all">{effectiveError}</span>
                  </div>
                )}
              </div>
            </Card>

            {/* Controls */}
            <Card className="rounded-xl border-0 shadow-none bg-black/[0.02] dark:bg-white/[0.02]">
              <div className="p-5">
                <h3 className="text-sm font-semibold mb-3">{t('dashboard:ops.title')}</h3>
                <div className="grid grid-cols-3 gap-2 mb-3">
                  <Button variant="outline" size="sm" disabled={isBusy || gatewayStatus.state === 'running'} onClick={() => void startGateway()} className="h-8 text-xs rounded-lg">
                    <Play className="h-3 w-3 mr-1" />{t('dashboard:ops.start')}
                  </Button>
                  <Button variant="outline" size="sm" disabled={isBusy || gatewayStatus.state !== 'running'} onClick={() => void stopGateway()} className="h-8 text-xs rounded-lg">
                    <Square className="h-3 w-3 mr-1" />{t('dashboard:ops.stop')}
                  </Button>
                  <Button variant="outline" size="sm" disabled={isBusy} onClick={() => void restartGateway()} className="h-8 text-xs rounded-lg">
                    <RotateCw className="h-3 w-3 mr-1" />{t('dashboard:ops.restart')}
                  </Button>
                </div>
                <Button variant="secondary" size="sm" disabled={diagnosing} onClick={() => void diagnose()} className="w-full h-8 text-xs rounded-lg">
                  {diagnosing ? <Loader2 className="h-3 w-3 mr-1.5 animate-spin" /> : <Stethoscope className="h-3 w-3 mr-1.5" />}
                  {diagnosing ? t('dashboard:ops.diagnosing') : t('dashboard:ops.diagnose')}
                </Button>
              </div>
            </Card>
          </div>

          {/* Logs */}
          <Card className="rounded-xl border-0 shadow-none bg-black/[0.02] dark:bg-white/[0.02]">
            <div className="p-5">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <div className="flex items-center gap-3">
                  <h3 className="text-sm font-semibold">{t('dashboard:logsSection.title')}</h3>
                  <span className="text-[11px] text-muted-foreground">
                    {logsContent ? `${logsContent.split(/\r?\n/).filter(Boolean).length} lines` : ''}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5">
                    <Label className="text-[11px] text-muted-foreground">{t('dashboard:logsSection.autoRefresh')}</Label>
                    <Switch checked={autoRefreshLogs} onCheckedChange={setAutoRefreshLogs} className="scale-75 origin-left" />
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => void refreshLogs()} className="h-7 w-7 p-0 rounded-md">
                    <RefreshCw className={cn('h-3.5 w-3.5', logsLoading && 'animate-spin')} />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => void openLogFolder()} className="h-7 w-7 p-0 rounded-md">
                    <FolderOpen className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              <div
                ref={logsContainerRef}
                className="h-56 overflow-auto rounded-lg border bg-black/[0.02] dark:bg-white/[0.02] p-3"
                role="log"
                aria-label="Gateway logs"
              >
                {logsLoading && !logsContent ? (
                  <div className="flex items-center justify-center text-muted-foreground text-xs py-8">
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />Loading...
                  </div>
                ) : (
                  <pre className="whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-muted-foreground">
                    {logsContent || t('dashboard:logsSection.empty')}
                  </pre>
                )}
              </div>
            </div>
          </Card>

          {/* System Info - Collapsible */}
          <Card className="rounded-xl border-0 shadow-none bg-black/[0.02] dark:bg-white/[0.02]">
            <button
              onClick={() => setShowSystemInfo(!showSystemInfo)}
              className="w-full p-4 flex items-center justify-between text-left hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors rounded-xl"
            >
              <h3 className="text-sm font-semibold">{t('dashboard:system.title')}</h3>
              {showSystemInfo ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
            </button>
            {showSystemInfo && (
              <div className="px-4 pb-4 pt-0">
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                  <MetricItem label={t('dashboard:system.appVersion')} value={appVersion || '--'} />
                  <MetricItem label={t('dashboard:system.platform')} value={platform || '--'} />
                  <MetricItem label={t('dashboard:system.openclawDir')} value={openclawStatus?.dir || '--'} />
                  <MetricItem label={t('dashboard:system.configDir')} value={openclawConfigDir || '--'} />
                  <MetricItem label={t('dashboard:system.logDir')} value={logDir || '--'} />
                  <MetricItem label={t('dashboard:statusCard.port')} value={String(gatewayStatus.port ?? '--')} />
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

export default Diagnostics;
