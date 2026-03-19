/**
 * Usage Stats Page
 * Session, message and token consumption statistics
 */
import { useEffect, useRef, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  MessageSquare,
  MessagesSquare,
  Coins,
  SearchCheck,
  AlertTriangle,
  CheckCircle2,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useGatewayStore } from '@/stores/gateway';
import { hostApiFetch } from '@/lib/host-api';
import { trackUiEvent } from '@/lib/telemetry';
import { FeedbackState } from '@/components/common/FeedbackState';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type UsageHistoryEntry = {
  timestamp: string;
  sessionId: string;
  agentId: string;
  model?: string;
  provider?: string;
  content?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  costUsd?: number;
};

type HighConsumptionItem = {
  model: string;
  tokens: number;
  time: string;
};

const FETCH_MAX_ATTEMPTS = 6;
const FETCH_RETRY_DELAY_MS = 1500;
const HIGH_CONSUMPTION_THRESHOLD = 10000;
const EMPTY_USAGE_HISTORY: UsageHistoryEntry[] = [];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function Token() {
  const { t } = useTranslation(['dashboard', 'settings']);

  const gatewayStatus = useGatewayStore((state) => state.status);
  const isGatewayRunning = gatewayStatus.state === 'running';

  /* ---------- Usage data state ---------- */
  const [usageHistory, setUsageHistory] = useState<UsageHistoryEntry[]>([]);
  const [usageFetchDoneKey, setUsageFetchDoneKey] = useState<string | null>(null);
  const fetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchGenRef = useRef(0);

  /* ---------- High consumption check state ---------- */
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<HighConsumptionItem[] | null>(null);

  useEffect(() => {
    trackUiEvent('usage.page_viewed');
  }, []);

  const usageFetchKey = isGatewayRunning
    ? `${gatewayStatus.pid ?? 'na'}:${gatewayStatus.connectedAt ?? 'na'}:${FETCH_MAX_ATTEMPTS}`
    : null;

  /* Fetch usage history with retry */
  useEffect(() => {
    if (fetchTimerRef.current) {
      clearTimeout(fetchTimerRef.current);
      fetchTimerRef.current = null;
    }

    if (!isGatewayRunning) {
      return;
    }

    const fetchKey = `${gatewayStatus.pid ?? 'na'}:${gatewayStatus.connectedAt ?? 'na'}:${FETCH_MAX_ATTEMPTS}`;
    const generation = fetchGenRef.current + 1;
    fetchGenRef.current = generation;

    const fetchWithRetry = async (attempt: number) => {
      try {
        const entries = await hostApiFetch<UsageHistoryEntry[]>('/api/usage/recent-token-history');
        if (fetchGenRef.current !== generation) return;

        const normalized = Array.isArray(entries) ? entries : [];
        setUsageHistory(normalized);

        if (normalized.length === 0 && attempt < FETCH_MAX_ATTEMPTS) {
          fetchTimerRef.current = setTimeout(() => {
            void fetchWithRetry(attempt + 1);
          }, FETCH_RETRY_DELAY_MS);
        } else {
          setUsageFetchDoneKey(fetchKey);
        }
      } catch {
        if (fetchGenRef.current !== generation) return;
        if (attempt < FETCH_MAX_ATTEMPTS) {
          fetchTimerRef.current = setTimeout(() => {
            void fetchWithRetry(attempt + 1);
          }, FETCH_RETRY_DELAY_MS);
          return;
        }
        setUsageHistory([]);
        setUsageFetchDoneKey(fetchKey);
      }
    };

    void fetchWithRetry(1);

    return () => {
      if (fetchTimerRef.current) {
        clearTimeout(fetchTimerRef.current);
        fetchTimerRef.current = null;
      }
    };
  }, [isGatewayRunning, gatewayStatus.connectedAt, gatewayStatus.pid]);

  /* ---------- Derived data ---------- */
  const data = useMemo(
    () => (isGatewayRunning ? usageHistory : EMPTY_USAGE_HISTORY),
    [isGatewayRunning, usageHistory],
  );
  const effectiveLoading = isGatewayRunning && usageFetchDoneKey !== usageFetchKey;

  const sessionCount = useMemo(() => {
    const set = new Set(data.map((e) => e.sessionId));
    return set.size;
  }, [data]);

  const messageCount = data.length;

  const totalTokens = useMemo(
    () => data.reduce((sum, e) => sum + e.totalTokens, 0),
    [data],
  );

  /* Trend data: group by day */
  const trendGroups = useMemo(() => groupByDay(data), [data]);

  /* Model breakdown */
  const modelBreakdown = useMemo(() => groupByModel(data), [data]);

  /* High consumption check */
  const handleHighConsumptionCheck = () => {
    setChecking(true);
    setCheckResult(null);

    // Simulate async check with a small delay for UX
    setTimeout(() => {
      const highItems = data
        .filter((e) => e.totalTokens >= HIGH_CONSUMPTION_THRESHOLD)
        .sort((a, b) => b.totalTokens - a.totalTokens)
        .slice(0, 20)
        .map((e) => ({
          model: e.model || 'Unknown',
          tokens: e.totalTokens,
          time: formatTimestamp(e.timestamp),
        }));
      setCheckResult(highItems);
      setChecking(false);
    }, 800);
  };

  return (
    <div className="flex flex-col -m-6 bg-background h-[calc(100vh-2.5rem)] overflow-hidden">
      <div className="w-full max-w-6xl mx-auto flex flex-col h-full p-6 lg:p-8">

        {/* Header */}
        <div className="mb-6 shrink-0">
          <h1 className="text-2xl font-semibold text-foreground tracking-tight">
            {t('dashboard:usage.title')}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {t('dashboard:usage.subtitle')}
          </p>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto min-h-0 space-y-6 pb-8 pr-2 -mr-2">

          {effectiveLoading ? (
            <div className="flex items-center justify-center py-20 text-muted-foreground">
              <FeedbackState state="loading" title={t('dashboard:recentTokenHistory.loading')} />
            </div>
          ) : !isGatewayRunning ? (
            <div className="flex items-center justify-center py-20 text-muted-foreground">
              <FeedbackState state="empty" title={t('dashboard:recentTokenHistory.empty')} />
            </div>
          ) : (
            <>
              {/* ============ Summary Cards ============ */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <SummaryCard
                  icon={<MessagesSquare className="h-5 w-5 text-sky-500" />}
                  label={t('dashboard:usage.sessions')}
                  value={formatNumber(sessionCount)}
                />
                <SummaryCard
                  icon={<MessageSquare className="h-5 w-5 text-violet-500" />}
                  label={t('dashboard:usage.messages')}
                  value={formatNumber(messageCount)}
                />
                <SummaryCard
                  icon={<Coins className="h-5 w-5 text-amber-500" />}
                  label={t('dashboard:usage.totalTokens')}
                  value={formatNumber(totalTokens)}
                />
              </div>

              {/* ============ Token Trend ============ */}
              <Card className="border-0 shadow-none bg-black/[0.02] dark:bg-white/[0.02] rounded-xl">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold">
                    {t('dashboard:usage.trendTitle')}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {trendGroups.length === 0 ? (
                    <div className="rounded-lg border border-dashed p-8 text-center text-sm font-medium text-muted-foreground">
                      {t('dashboard:recentTokenHistory.empty')}
                    </div>
                  ) : (
                    <TrendBarChart groups={trendGroups} />
                  )}
                </CardContent>
              </Card>

              {/* ============ Model Breakdown Table ============ */}
              <Card className="border-0 shadow-none bg-black/[0.02] dark:bg-white/[0.02] rounded-xl">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold">
                    {t('dashboard:usage.modelDetailTitle')}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {modelBreakdown.length === 0 ? (
                    <div className="rounded-lg border border-dashed p-8 text-center text-sm font-medium text-muted-foreground">
                      {t('dashboard:recentTokenHistory.empty')}
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b text-muted-foreground">
                            <th className="text-left py-2.5 px-3 font-medium">{t('dashboard:usage.modelName')}</th>
                            <th className="text-right py-2.5 px-3 font-medium">{t('dashboard:usage.inputTokens')}</th>
                            <th className="text-right py-2.5 px-3 font-medium">{t('dashboard:usage.outputTokens')}</th>
                            <th className="text-right py-2.5 px-3 font-medium">{t('dashboard:usage.totalTokensCol')}</th>
                            <th className="text-right py-2.5 px-3 font-medium">{t('dashboard:usage.messageCount')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {modelBreakdown.map((row) => (
                            <tr key={row.model} className="border-b last:border-0 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors">
                              <td className="py-2.5 px-3 font-medium text-foreground">{row.model}</td>
                              <td className="py-2.5 px-3 text-right text-sky-600 dark:text-sky-400 font-medium">{formatNumber(row.inputTokens)}</td>
                              <td className="py-2.5 px-3 text-right text-violet-600 dark:text-violet-400 font-medium">{formatNumber(row.outputTokens)}</td>
                              <td className="py-2.5 px-3 text-right font-semibold text-foreground">{formatNumber(row.totalTokens)}</td>
                              <td className="py-2.5 px-3 text-right text-muted-foreground">{row.messageCount}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* ============ High Consumption Check ============ */}
              <Card className="border-0 shadow-none bg-black/[0.02] dark:bg-white/[0.02] rounded-xl">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-base font-semibold flex items-center gap-2">
                        <SearchCheck className="h-4.5 w-4.5 text-orange-500" />
                        {t('dashboard:usage.highConsumptionTitle')}
                      </CardTitle>
                      <p className="text-xs text-muted-foreground mt-1">
                        {t('dashboard:usage.highConsumptionDesc')}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleHighConsumptionCheck}
                      disabled={checking || data.length === 0}
                      className="rounded-lg h-8 px-4 border-orange-200 dark:border-orange-800 text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-950"
                    >
                      {checking ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                          {t('dashboard:usage.checking')}
                        </>
                      ) : (
                        t('dashboard:usage.startCheck')
                      )}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {checkResult === null ? (
                    <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                      {t('dashboard:usage.threshold', { value: formatNumber(HIGH_CONSUMPTION_THRESHOLD) })}
                    </div>
                  ) : checkResult.length === 0 ? (
                    <div className="rounded-lg border border-dashed p-6 text-center">
                      <CheckCircle2 className="h-8 w-8 text-emerald-500 mx-auto mb-2" />
                      <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                        {t('dashboard:usage.noHighConsumption')}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-orange-600 dark:text-orange-400 mb-3">
                        {t('dashboard:usage.highConsumptionFound', { count: checkResult.length })}
                      </p>
                      {checkResult.map((item, idx) => (
                        <div
                          key={idx}
                          className="flex items-center gap-3 rounded-lg border border-orange-200 dark:border-orange-800/50 bg-orange-50/50 dark:bg-orange-950/20 p-3"
                        >
                          <AlertTriangle className="h-4 w-4 text-orange-500 shrink-0" />
                          <span className="text-sm text-foreground">
                            {t('dashboard:usage.highConsumptionItem', {
                              model: item.model,
                              tokens: formatNumber(item.tokens),
                              time: item.time,
                            })}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}

        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function SummaryCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <Card className="border-0 shadow-none bg-black/[0.02] dark:bg-white/[0.02] rounded-xl">
      <CardContent className="p-5">
        <div className="flex items-center gap-2 mb-2">
          {icon}
          <p className="text-sm text-muted-foreground font-medium">{label}</p>
        </div>
        <p className="text-2xl font-bold text-foreground">{value}</p>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Trend Bar Chart                                                    */
/* ------------------------------------------------------------------ */

function TrendBarChart({
  groups,
}: {
  groups: Array<{
    label: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  }>;
}) {
  const maxTokens = Math.max(...groups.map((g) => g.totalTokens), 1);

  return (
    <div className="space-y-3">
      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-xs font-medium text-muted-foreground mb-1">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-sky-500" />
          Input
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-violet-500" />
          Output
        </span>
      </div>
      {groups.map((group) => (
        <div key={group.label} className="space-y-1">
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="truncate font-semibold text-foreground">{group.label}</span>
            <span className="text-muted-foreground font-medium shrink-0">
              {formatNumber(group.totalTokens)}
            </span>
          </div>
          <div className="h-3.5 overflow-hidden rounded-full bg-muted/50">
            <div
              className="flex h-full overflow-hidden rounded-full"
              style={{
                width: group.totalTokens > 0
                  ? `${Math.max((group.totalTokens / maxTokens) * 100, 6)}%`
                  : '0%',
              }}
            >
              {group.inputTokens > 0 && (
                <div
                  className="h-full bg-sky-500"
                  style={{ width: `${(group.inputTokens / group.totalTokens) * 100}%` }}
                />
              )}
              {group.outputTokens > 0 && (
                <div
                  className="h-full bg-violet-500"
                  style={{ width: `${(group.outputTokens / group.totalTokens) * 100}%` }}
                />
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatNumber(value: number): string {
  return Intl.NumberFormat().format(value);
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatDay(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(date);
}

function getDaySortKey(timestamp: string): number {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return 0;
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function groupByDay(
  entries: UsageHistoryEntry[],
): Array<{
  label: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}> {
  const grouped = new Map<string, {
    label: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    sortKey: number;
  }>();

  for (const entry of entries) {
    const label = formatDay(entry.timestamp);
    const current = grouped.get(label) ?? {
      label,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      sortKey: getDaySortKey(entry.timestamp),
    };
    current.inputTokens += entry.inputTokens;
    current.outputTokens += entry.outputTokens;
    current.totalTokens += entry.totalTokens;
    grouped.set(label, current);
  }

  return Array.from(grouped.values())
    .sort((a, b) => a.sortKey - b.sortKey)
    .slice(-14);
}

function groupByModel(
  entries: UsageHistoryEntry[],
): Array<{
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  messageCount: number;
}> {
  const grouped = new Map<string, {
    model: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    messageCount: number;
  }>();

  for (const entry of entries) {
    const model = entry.model || 'Unknown';
    const current = grouped.get(model) ?? {
      model,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      messageCount: 0,
    };
    current.inputTokens += entry.inputTokens;
    current.outputTokens += entry.outputTokens;
    current.totalTokens += entry.totalTokens;
    current.messageCount += 1;
    grouped.set(model, current);
  }

  return Array.from(grouped.values()).sort((a, b) => b.totalTokens - a.totalTokens);
}

export default Token;









