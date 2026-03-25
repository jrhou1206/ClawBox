/**
 * Settings Page
 * Application configuration — unified with Dashboard visual style.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Sun,
  Moon,
  Monitor,
  RefreshCw,
  ExternalLink,
  Copy,
  FileText,
  Paintbrush,
  Server,
  Code2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { useSettingsStore } from '@/stores/settings';
import { useGatewayStore } from '@/stores/gateway';
import {
  getGatewayWsDiagnosticEnabled,
  invokeIpc,
  setGatewayWsDiagnosticEnabled,
  toUserMessage,
} from '@/lib/api-client';
import {
  clearUiTelemetry,
  getUiTelemetrySnapshot,
  subscribeUiTelemetry,
  trackUiEvent,
  type UiTelemetryEntry,
} from '@/lib/telemetry';
import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES } from '@/i18n';
import { hostApiFetch } from '@/lib/host-api';
import { cn } from '@/lib/utils';

type ControlUiInfo = { url: string; token: string; port: number };

export function Settings() {
  const { t } = useTranslation('settings');
  const {
    theme, setTheme, language, setLanguage,
    launchAtStartup, setLaunchAtStartup,
    gatewayAutoStart, setGatewayAutoStart,
    proxyEnabled, proxyServer, proxyHttpServer, proxyHttpsServer, proxyAllServer, proxyBypassRules,
    setProxyEnabled, setProxyServer, setProxyHttpServer, setProxyHttpsServer, setProxyAllServer, setProxyBypassRules,
    devModeUnlocked, setDevModeUnlocked,
    telemetryEnabled, setTelemetryEnabled,
  } = useSettingsStore();

  const { status: gatewayStatus, restart: restartGateway } = useGatewayStore();
  const [controlUiInfo, setControlUiInfo] = useState<ControlUiInfo | null>(null);
  const [openclawCliCommand, setOpenclawCliCommand] = useState('');
  const [openclawCliError, setOpenclawCliError] = useState<string | null>(null);
  const [proxyServerDraft, setProxyServerDraft] = useState('');
  const [proxyHttpServerDraft, setProxyHttpServerDraft] = useState('');
  const [proxyHttpsServerDraft, setProxyHttpsServerDraft] = useState('');
  const [proxyAllServerDraft, setProxyAllServerDraft] = useState('');
  const [proxyBypassRulesDraft, setProxyBypassRulesDraft] = useState('');
  const [proxyEnabledDraft, setProxyEnabledDraft] = useState(false);
  const [savingProxy, setSavingProxy] = useState(false);
  const [wsDiagnosticEnabled, setWsDiagnosticEnabled] = useState(false);
  const [showTelemetryViewer, setShowTelemetryViewer] = useState(false);
  const [telemetryEntries, setTelemetryEntries] = useState<UiTelemetryEntry[]>([]);

  const isWindows = window.electron.platform === 'win32';
  const showCliTools = true;
  const [showLogs, setShowLogs] = useState(false);
  const [logContent, setLogContent] = useState('');

  // ── Handlers ─────────────────────────────────────────────────
  const handleShowLogs = async () => {
    try {
      const logs = await hostApiFetch<{ content: string }>('/api/logs?tailLines=100');
      setLogContent(logs.content);
      setShowLogs(true);
    } catch { setLogContent('(Failed to load logs)'); setShowLogs(true); }
  };

  const handleOpenLogDir = async () => {
    try {
      const { dir: logDir } = await hostApiFetch<{ dir: string | null }>('/api/logs/dir');
      if (logDir) await invokeIpc('shell:showItemInFolder', logDir);
    } catch { /* ignore */ }
  };

  const refreshControlUiInfo = async () => {
    try {
      const result = await hostApiFetch<{ success: boolean; url?: string; token?: string; port?: number }>('/api/gateway/control-ui');
      if (result.success && result.url && result.token && typeof result.port === 'number')
        setControlUiInfo({ url: result.url, token: result.token, port: result.port });
    } catch { /* ignore */ }
  };

  const handleCopyGatewayToken = async () => {
    if (!controlUiInfo?.token) return;
    try { await navigator.clipboard.writeText(controlUiInfo.token); toast.success(t('developer.tokenCopied')); }
    catch (e) { toast.error(`Failed to copy token: ${String(e)}`); }
  };

  const handleCopyCliCommand = async () => {
    if (!openclawCliCommand) return;
    try { await navigator.clipboard.writeText(openclawCliCommand); toast.success(t('developer.cmdCopied')); }
    catch (e) { toast.error(`Failed to copy command: ${String(e)}`); }
  };

  const handleSaveProxySettings = async () => {
    setSavingProxy(true);
    try {
      const vals = {
        proxyEnabled: proxyEnabledDraft,
        proxyServer: proxyServerDraft.trim(),
        proxyHttpServer: proxyHttpServerDraft.trim(),
        proxyHttpsServer: proxyHttpsServerDraft.trim(),
        proxyAllServer: proxyAllServerDraft.trim(),
        proxyBypassRules: proxyBypassRulesDraft.trim(),
      };
      await invokeIpc('settings:setMany', vals);
      setProxyServer(vals.proxyServer); setProxyHttpServer(vals.proxyHttpServer);
      setProxyHttpsServer(vals.proxyHttpsServer); setProxyAllServer(vals.proxyAllServer);
      setProxyBypassRules(vals.proxyBypassRules); setProxyEnabled(vals.proxyEnabled);
      toast.success(t('gateway.proxySaved'));
      trackUiEvent('settings.proxy_saved', { enabled: proxyEnabledDraft });
    } catch (e) { toast.error(`${t('gateway.proxySaveFailed')}: ${toUserMessage(e)}`); }
    finally { setSavingProxy(false); }
  };

  const handleWsDiagnosticToggle = (enabled: boolean) => {
    setGatewayWsDiagnosticEnabled(enabled);
    setWsDiagnosticEnabled(enabled);
    toast.success(enabled ? t('developer.wsDiagnosticEnabled') : t('developer.wsDiagnosticDisabled'));
  };

  const handleCopyTelemetry = async () => {
    try {
      await navigator.clipboard.writeText(telemetryEntries.map((e) => JSON.stringify(e)).join('\n'));
      toast.success(t('developer.telemetryCopied'));
    } catch (e) { toast.error(`${t('common:status.error')}: ${String(e)}`); }
  };

  const handleClearTelemetry = () => { clearUiTelemetry(); setTelemetryEntries([]); toast.success(t('developer.telemetryCleared')); };

  // ── Effects ──────────────────────────────────────────────────
  useEffect(() => {
    if (!showCliTools) return;
    let cancelled = false;
    (async () => {
      try {
        const result = await invokeIpc<{ success: boolean; command?: string; error?: string }>('openclaw:getCliCommand');
        if (cancelled) return;
        if (result.success && result.command) { setOpenclawCliCommand(result.command); setOpenclawCliError(null); }
        else { setOpenclawCliCommand(''); setOpenclawCliError(result.error || 'OpenClaw CLI unavailable'); }
      } catch (e) { if (!cancelled) { setOpenclawCliCommand(''); setOpenclawCliError(String(e)); } }
    })();
    return () => { cancelled = true; };
  }, [devModeUnlocked, showCliTools]);

  useEffect(() => {
    const unsub = window.electron.ipcRenderer.on('openclaw:cli-installed', (...args: unknown[]) => {
      toast.success(`openclaw CLI installed at ${typeof args[0] === 'string' ? args[0] : ''}`);
    });
    return () => { unsub?.(); };
  }, []);

  useEffect(() => { setWsDiagnosticEnabled(getGatewayWsDiagnosticEnabled()); }, []);

  useEffect(() => {
    if (!devModeUnlocked) return;
    setTelemetryEntries(getUiTelemetrySnapshot(200));
    const unsub = subscribeUiTelemetry((entry) => {
      setTelemetryEntries((prev) => { const next = [...prev, entry]; if (next.length > 200) next.splice(0, next.length - 200); return next; });
    });
    return unsub;
  }, [devModeUnlocked]);

  useEffect(() => { setProxyEnabledDraft(proxyEnabled); }, [proxyEnabled]);
  useEffect(() => { setProxyServerDraft(proxyServer); }, [proxyServer]);
  useEffect(() => { setProxyHttpServerDraft(proxyHttpServer); }, [proxyHttpServer]);
  useEffect(() => { setProxyHttpsServerDraft(proxyHttpsServer); }, [proxyHttpsServer]);
  useEffect(() => { setProxyAllServerDraft(proxyAllServer); }, [proxyAllServer]);
  useEffect(() => { setProxyBypassRulesDraft(proxyBypassRules); }, [proxyBypassRules]);

  // ── Telemetry stats ──────────────────────────────────────────
  const telemetryStats = useMemo(() => {
    let errorCount = 0, slowCount = 0;
    for (const e of telemetryEntries) {
      if (e.event.endsWith('_error') || e.event.includes('request_error')) errorCount++;
      const d = typeof e.payload.durationMs === 'number' ? e.payload.durationMs : NaN;
      if (Number.isFinite(d) && d >= 800) slowCount++;
    }
    return { total: telemetryEntries.length, errorCount, slowCount };
  }, [telemetryEntries]);

  const telemetryByEvent = useMemo(() => {
    const map = new Map<string, { event: string; count: number; errorCount: number; slowCount: number; totalDuration: number; timedCount: number; lastTs: string }>();
    for (const entry of telemetryEntries) {
      const c = map.get(entry.event) ?? { event: entry.event, count: 0, errorCount: 0, slowCount: 0, totalDuration: 0, timedCount: 0, lastTs: entry.ts };
      c.count++; c.lastTs = entry.ts;
      if (entry.event.endsWith('_error') || entry.event.includes('request_error')) c.errorCount++;
      const d = typeof entry.payload.durationMs === 'number' ? entry.payload.durationMs : NaN;
      if (Number.isFinite(d)) { c.totalDuration += d; c.timedCount++; if (d >= 800) c.slowCount++; }
      map.set(entry.event, c);
    }
    return [...map.values()].sort((a, b) => b.count - a.count).slice(0, 12);
  }, [telemetryEntries]);

  // ── Render ───────────────────────────────────────────────────
  return (
    <div className="flex flex-col -m-6 bg-background h-[calc(100vh-2.5rem)] overflow-hidden">
      <div className="w-full max-w-6xl mx-auto flex flex-col h-full p-6 lg:p-8">
        {/* Header */}
        <header className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-4 shrink-0">
          <div>
            <h1 className="text-2xl font-semibold text-foreground tracking-tight">{t('title')}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{t('subtitle')}</p>
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto min-h-0 space-y-4 pb-4">

          {/* ─── Appearance ───────────────────────────────────── */}
          <Card className="rounded-xl border-0 shadow-none bg-black/[0.02] dark:bg-white/[0.02]">
            <div className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <Paintbrush className="h-4 w-4 text-sky-500" />
                <h3 className="text-sm font-semibold">{t('appearance.title')}</h3>
              </div>
              <div className="space-y-5">
                {/* Theme */}
                <div className="space-y-2">
                  <span className="text-xs font-semibold text-foreground/70">{t('appearance.theme')}</span>
                  <div className="flex flex-wrap gap-2">
                    {(['light', 'dark', 'system'] as const).map((th) => {
                      const Icon = th === 'light' ? Sun : th === 'dark' ? Moon : Monitor;
                      return (
                        <Button
                          key={th}
                          variant={theme === th ? 'default' : 'outline'}
                          size="sm"
                          className={cn('h-8 text-xs rounded-full px-3', theme !== th && 'text-muted-foreground')}
                          onClick={() => setTheme(th)}
                        >
                          <Icon className="h-3.5 w-3.5 mr-1.5" />
                          {t(`appearance.${th}`)}
                        </Button>
                      );
                    })}
                  </div>
                </div>

                {/* Language */}
                <div className="space-y-2">
                  <span className="text-xs font-semibold text-foreground/70">{t('appearance.language')}</span>
                  <div className="flex flex-wrap gap-2">
                    {SUPPORTED_LANGUAGES.map((lang) => (
                      <Button
                        key={lang.code}
                        variant={language === lang.code ? 'default' : 'outline'}
                        size="sm"
                        className={cn('h-8 text-xs rounded-full px-3', language !== lang.code && 'text-muted-foreground')}
                        onClick={() => setLanguage(lang.code)}
                      >
                        {lang.label}
                      </Button>
                    ))}
                  </div>
                </div>

                {/* Launch at startup */}
                <div className="flex items-center justify-between gap-3 rounded-lg bg-black/[0.03] dark:bg-white/[0.04] p-3.5">
                  <div>
                    <span className="text-xs font-semibold text-foreground/80">{t('appearance.launchAtStartup')}</span>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{t('appearance.launchAtStartupDesc')}</p>
                  </div>
                  <Switch checked={launchAtStartup} onCheckedChange={setLaunchAtStartup} />
                </div>
              </div>
            </div>
          </Card>

          {/* ─── Gateway ─────────────────────────────────────── */}
          <Card className="rounded-xl border-0 shadow-none bg-black/[0.02] dark:bg-white/[0.02]">
            <div className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <Server className="h-4 w-4 text-emerald-500" />
                <h3 className="text-sm font-semibold">{t('gateway.title')}</h3>
              </div>
              <div className="space-y-4">
                {/* Status row */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg bg-black/[0.03] dark:bg-white/[0.04] p-3.5">
                  <div>
                    <span className="text-xs font-semibold text-foreground/80">{t('gateway.status')}</span>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{t('gateway.port')}: {gatewayStatus.port}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn(
                      'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium',
                      gatewayStatus.state === 'running' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' :
                      gatewayStatus.state === 'error' ? 'bg-red-500/10 text-red-600 dark:text-red-400' :
                      'bg-zinc-500/10 text-muted-foreground',
                    )}>
                      <span className={cn('w-1.5 h-1.5 rounded-full',
                        gatewayStatus.state === 'running' ? 'bg-emerald-500' : gatewayStatus.state === 'error' ? 'bg-red-500' : 'bg-zinc-400',
                      )} />
                      {gatewayStatus.state}
                    </span>
                    <Button variant="outline" size="sm" onClick={restartGateway} className="h-7 text-[11px] rounded-full px-2.5">
                      <RefreshCw className="h-3 w-3 mr-1" />{t('common:actions.restart')}
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleShowLogs} className="h-7 text-[11px] rounded-full px-2.5">
                      <FileText className="h-3 w-3 mr-1" />{t('gateway.logs')}
                    </Button>
                  </div>
                </div>

                {/* Logs panel */}
                {showLogs && (
                  <div className="rounded-lg bg-black/[0.03] dark:bg-white/[0.04] p-3.5">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-foreground/70">{t('gateway.appLogs')}</span>
                      <div className="flex gap-1.5">
                        <Button variant="ghost" size="sm" className="h-6 text-[10px] rounded-md px-2" onClick={handleOpenLogDir}>
                          <ExternalLink className="h-3 w-3 mr-1" />{t('gateway.openFolder')}
                        </Button>
                        <Button variant="ghost" size="sm" className="h-6 text-[10px] rounded-md px-2" onClick={() => setShowLogs(false)}>
                          {t('common:actions.close')}
                        </Button>
                      </div>
                    </div>
                    <pre className="text-[11px] text-muted-foreground bg-black/[0.02] dark:bg-white/[0.02] p-3 rounded-lg max-h-48 overflow-auto whitespace-pre-wrap font-mono border border-border/20">
                      {logContent || t('chat:noLogs')}
                    </pre>
                  </div>
                )}

                {/* Auto start */}
                <div className="flex items-center justify-between gap-3 rounded-lg bg-black/[0.03] dark:bg-white/[0.04] p-3.5">
                  <div>
                    <span className="text-xs font-semibold text-foreground/80">{t('gateway.autoStart')}</span>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{t('gateway.autoStartDesc')}</p>
                  </div>
                  <Switch checked={gatewayAutoStart} onCheckedChange={setGatewayAutoStart} />
                </div>

                {/* Dev mode */}
                <div className="flex items-center justify-between gap-3 rounded-lg bg-black/[0.03] dark:bg-white/[0.04] p-3.5">
                  <div>
                    <span className="text-xs font-semibold text-foreground/80">{t('advanced.devMode')}</span>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{t('advanced.devModeDesc')}</p>
                  </div>
                  <Switch checked={devModeUnlocked} onCheckedChange={setDevModeUnlocked} />
                </div>

                {/* Telemetry */}
                <div className="flex items-center justify-between gap-3 rounded-lg bg-black/[0.03] dark:bg-white/[0.04] p-3.5">
                  <div>
                    <span className="text-xs font-semibold text-foreground/80">{t('advanced.telemetry')}</span>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{t('advanced.telemetryDesc')}</p>
                  </div>
                  <Switch checked={telemetryEnabled} onCheckedChange={setTelemetryEnabled} />
                </div>
              </div>
            </div>
          </Card>

          {/* ─── Developer ───────────────────────────────────── */}
          {devModeUnlocked && (
            <Card className="rounded-xl border-0 shadow-none bg-black/[0.02] dark:bg-white/[0.02]">
              <div className="p-6">
                <div className="flex items-center gap-2 mb-4">
                  <Code2 className="h-4 w-4 text-amber-500" />
                  <h3 className="text-sm font-semibold">{t('developer.title')}</h3>
                </div>
                <div className="space-y-5">

                  {/* Proxy */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <span className="text-xs font-semibold text-foreground/80">Gateway Proxy</span>
                        <p className="text-[11px] text-muted-foreground mt-0.5">{t('gateway.proxyDesc')}</p>
                      </div>
                      <Switch checked={proxyEnabledDraft} onCheckedChange={setProxyEnabledDraft} />
                    </div>

                    {proxyEnabledDraft && (
                      <div className="space-y-3 rounded-lg bg-black/[0.03] dark:bg-white/[0.04] p-3.5">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {[
                            { id: 'proxy-server', label: t('gateway.proxyServer'), value: proxyServerDraft, set: setProxyServerDraft, ph: 'http://127.0.0.1:7890', help: t('gateway.proxyServerHelp') },
                            { id: 'proxy-http', label: t('gateway.proxyHttpServer'), value: proxyHttpServerDraft, set: setProxyHttpServerDraft, ph: proxyServerDraft || 'http://127.0.0.1:7890', help: t('gateway.proxyHttpServerHelp') },
                            { id: 'proxy-https', label: t('gateway.proxyHttpsServer'), value: proxyHttpsServerDraft, set: setProxyHttpsServerDraft, ph: proxyServerDraft || 'http://127.0.0.1:7890', help: t('gateway.proxyHttpsServerHelp') },
                            { id: 'proxy-all', label: t('gateway.proxyAllServer'), value: proxyAllServerDraft, set: setProxyAllServerDraft, ph: proxyServerDraft || 'socks5://127.0.0.1:7891', help: t('gateway.proxyAllServerHelp') },
                          ].map((f) => (
                            <div key={f.id} className="space-y-1">
                              <Label htmlFor={f.id} className="text-[11px] text-foreground/70">{f.label}</Label>
                              <Input id={f.id} value={f.value} onChange={(e) => f.set(e.target.value)} placeholder={f.ph}
                                className="h-8 rounded-lg text-xs font-mono bg-black/[0.03] dark:bg-white/[0.04] border-border/40" />
                              <p className="text-[10px] text-muted-foreground">{f.help}</p>
                            </div>
                          ))}
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor="proxy-bypass" className="text-[11px] text-foreground/70">{t('gateway.proxyBypass')}</Label>
                          <Input id="proxy-bypass" value={proxyBypassRulesDraft} onChange={(e) => setProxyBypassRulesDraft(e.target.value)}
                            placeholder="<local>;localhost;127.0.0.1;::1"
                            className="h-8 rounded-lg text-xs font-mono bg-black/[0.03] dark:bg-white/[0.04] border-border/40" />
                          <p className="text-[10px] text-muted-foreground">{t('gateway.proxyBypassHelp')}</p>
                        </div>
                        <div className="flex items-center gap-3">
                          <Button variant="outline" size="sm" onClick={handleSaveProxySettings} disabled={savingProxy} className="h-8 text-xs rounded-full px-3">
                            <RefreshCw className={cn('h-3.5 w-3.5 mr-1.5', savingProxy && 'animate-spin')} />
                            {savingProxy ? t('common:status.saving') : t('common:actions.save')}
                          </Button>
                          <p className="text-[10px] text-muted-foreground">{t('gateway.proxyRestartNote')}</p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Gateway Token */}
                  <div className="space-y-2">
                    <span className="text-xs font-semibold text-foreground/80">{t('developer.gatewayToken')}</span>
                    <p className="text-[11px] text-muted-foreground">{t('developer.gatewayTokenDesc')}</p>
                    <div className="flex flex-wrap gap-2">
                      <Input readOnly value={controlUiInfo?.token || ''} placeholder={t('developer.tokenUnavailable')}
                        className="h-8 rounded-lg text-xs font-mono bg-black/[0.03] dark:bg-white/[0.04] border-border/40 flex-1 min-w-[180px]" />
                      <Button variant="outline" size="sm" onClick={refreshControlUiInfo} disabled={!devModeUnlocked} className="h-8 text-xs rounded-full px-3">
                        <RefreshCw className="h-3.5 w-3.5 mr-1.5" />{t('common:actions.load')}
                      </Button>
                      <Button variant="outline" size="sm" onClick={handleCopyGatewayToken} disabled={!controlUiInfo?.token} className="h-8 text-xs rounded-full px-3">
                        <Copy className="h-3.5 w-3.5 mr-1.5" />{t('common:actions.copy')}
                      </Button>
                    </div>
                  </div>

                  {/* CLI Tools */}
                  {showCliTools && (
                    <div className="space-y-2">
                      <span className="text-xs font-semibold text-foreground/80">{t('developer.cli')}</span>
                      <p className="text-[11px] text-muted-foreground">{t('developer.cliDesc')}</p>
                      {isWindows && <p className="text-[10px] text-muted-foreground">{t('developer.cliPowershell')}</p>}
                      <div className="flex flex-wrap gap-2">
                        <Input readOnly value={openclawCliCommand} placeholder={openclawCliError || t('developer.cmdUnavailable')}
                          className="h-8 rounded-lg text-xs font-mono bg-black/[0.03] dark:bg-white/[0.04] border-border/40 flex-1 min-w-[180px]" />
                        <Button variant="outline" size="sm" onClick={handleCopyCliCommand} disabled={!openclawCliCommand} className="h-8 text-xs rounded-full px-3">
                          <Copy className="h-3.5 w-3.5 mr-1.5" />{t('common:actions.copy')}
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* WS Diagnostic */}
                  <div className="flex items-center justify-between gap-3 rounded-lg bg-black/[0.03] dark:bg-white/[0.04] p-3.5">
                    <div>
                      <span className="text-xs font-semibold text-foreground/80">{t('developer.wsDiagnostic')}</span>
                      <p className="text-[11px] text-muted-foreground mt-0.5">{t('developer.wsDiagnosticDesc')}</p>
                    </div>
                    <Switch checked={wsDiagnosticEnabled} onCheckedChange={handleWsDiagnosticToggle} />
                  </div>

                  {/* Telemetry viewer */}
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <span className="text-xs font-semibold text-foreground/80">{t('developer.telemetryViewer')}</span>
                      <p className="text-[11px] text-muted-foreground mt-0.5">{t('developer.telemetryViewerDesc')}</p>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => setShowTelemetryViewer((p) => !p)} className="h-8 text-xs rounded-full px-3">
                      {showTelemetryViewer ? t('common:actions.hide') : t('common:actions.show')}
                    </Button>
                  </div>

                  {showTelemetryViewer && (
                    <div className="space-y-3 rounded-lg bg-black/[0.03] dark:bg-white/[0.04] p-3.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="secondary" className="text-[10px] rounded-full px-2 py-0.5">{t('developer.telemetryTotal')}: {telemetryStats.total}</Badge>
                        <Badge variant={telemetryStats.errorCount > 0 ? 'destructive' : 'secondary'} className="text-[10px] rounded-full px-2 py-0.5">
                          {t('developer.telemetryErrors')}: {telemetryStats.errorCount}
                        </Badge>
                        <Badge variant="secondary" className="text-[10px] rounded-full px-2 py-0.5">
                          {t('developer.telemetrySlow')}: {telemetryStats.slowCount}
                        </Badge>
                        <div className="ml-auto flex gap-1.5">
                          <Button variant="outline" size="sm" onClick={handleCopyTelemetry} className="h-7 text-[10px] rounded-full px-2.5">
                            <Copy className="h-3 w-3 mr-1" />{t('common:actions.copy')}
                          </Button>
                          <Button variant="outline" size="sm" onClick={handleClearTelemetry} className="h-7 text-[10px] rounded-full px-2.5">
                            {t('common:actions.clear')}
                          </Button>
                        </div>
                      </div>
                      <div className="max-h-72 overflow-auto rounded-lg border border-border/20 bg-black/[0.02] dark:bg-white/[0.02]">
                        {telemetryByEvent.length > 0 && (
                          <div className="border-b border-border/20 p-3">
                            <p className="mb-2 text-[10px] font-semibold text-muted-foreground">{t('developer.telemetryAggregated')}</p>
                            <div className="space-y-1 text-[10px]">
                              {telemetryByEvent.map((item) => (
                                <div key={item.event} className="grid grid-cols-[minmax(0,1.6fr)_0.7fr_0.9fr_0.8fr_1fr] gap-2 rounded-md bg-black/[0.03] dark:bg-white/[0.04] px-2.5 py-1.5">
                                  <span className="truncate font-medium" title={item.event}>{item.event}</span>
                                  <span className="text-muted-foreground">n={item.count}</span>
                                  <span className="text-muted-foreground">avg={item.timedCount > 0 ? Math.round(item.totalDuration / item.timedCount) : 0}ms</span>
                                  <span className="text-muted-foreground">slow={item.slowCount}</span>
                                  <span className="text-muted-foreground">err={item.errorCount}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        <div className="space-y-1.5 p-3 font-mono text-[10px]">
                          {telemetryEntries.length === 0 ? (
                            <div className="text-muted-foreground text-center py-4">{t('developer.telemetryEmpty')}</div>
                          ) : telemetryEntries.slice().reverse().map((entry) => (
                            <div key={entry.id} className="rounded-md bg-black/[0.03] dark:bg-white/[0.04] p-2.5">
                              <div className="flex items-center justify-between gap-2 mb-1">
                                <span className="font-semibold text-foreground text-[11px]">{entry.event}</span>
                                <span className="text-muted-foreground text-[9px]">{entry.ts}</span>
                              </div>
                              <pre className="whitespace-pre-wrap text-[10px] text-muted-foreground overflow-x-auto">
                                {JSON.stringify({ count: entry.count, ...entry.payload }, null, 2)}
                              </pre>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

export default Settings;
