/**
 * Cron Page
 * Manage scheduled tasks — unified with Dashboard visual style.
 */
import { useEffect, useState, useCallback } from 'react';
import {
  Plus,
  Clock,
  Play,
  Trash2,
  RefreshCw,
  X,
  Calendar,
  AlertCircle,
  CheckCircle2,
  XCircle,
  MessageSquare,
  Loader2,
  Timer,
  History,
  Pause,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useCronStore } from '@/stores/cron';
import { useGatewayStore } from '@/stores/gateway';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { formatRelativeTime, cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { CronJob, CronJobCreateInput, ScheduleType } from '@/types/cron';
import { CHANNEL_ICONS, type ChannelType } from '@/types/channel';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

// ── Cron Presets ─────────────────────────────────────────────────
const schedulePresets: { key: string; value: string; type: ScheduleType }[] = [
  { key: 'everyMinute', value: '* * * * *', type: 'interval' },
  { key: 'every5Min', value: '*/5 * * * *', type: 'interval' },
  { key: 'every15Min', value: '*/15 * * * *', type: 'interval' },
  { key: 'everyHour', value: '0 * * * *', type: 'interval' },
  { key: 'daily9am', value: '0 9 * * *', type: 'daily' },
  { key: 'daily6pm', value: '0 18 * * *', type: 'daily' },
  { key: 'weeklyMon', value: '0 9 * * 1', type: 'weekly' },
  { key: 'monthly1st', value: '0 9 1 * *', type: 'monthly' },
];

// ── Schedule Parsing ─────────────────────────────────────────────
function parseCronSchedule(schedule: unknown, t: TFunction<'cron'>): string {
  if (schedule && typeof schedule === 'object') {
    const s = schedule as { kind?: string; expr?: string; tz?: string; everyMs?: number; at?: string };
    if (s.kind === 'cron' && typeof s.expr === 'string') return parseCronExpr(s.expr, t);
    if (s.kind === 'every' && typeof s.everyMs === 'number') {
      const ms = s.everyMs;
      if (ms < 60_000) return t('schedule.everySeconds', { count: Math.round(ms / 1000) });
      if (ms < 3_600_000) return t('schedule.everyMinutes', { count: Math.round(ms / 60_000) });
      if (ms < 86_400_000) return t('schedule.everyHours', { count: Math.round(ms / 3_600_000) });
      return t('schedule.everyDays', { count: Math.round(ms / 86_400_000) });
    }
    if (s.kind === 'at' && typeof s.at === 'string') {
      try { return t('schedule.onceAt', { time: new Date(s.at).toLocaleString() }); }
      catch { return t('schedule.onceAt', { time: s.at }); }
    }
    return String(schedule);
  }
  if (typeof schedule === 'string') return parseCronExpr(schedule, t);
  return String(schedule ?? t('schedule.unknown'));
}

function parseCronExpr(cron: string, t: TFunction<'cron'>): string {
  const preset = schedulePresets.find((p) => p.value === cron);
  if (preset) return t(`presets.${preset.key}` as const);
  const parts = cron.split(' ');
  if (parts.length !== 5) return cron;
  const [minute, hour, dayOfMonth, , dayOfWeek] = parts;
  if (minute === '*' && hour === '*') return t('presets.everyMinute');
  if (minute.startsWith('*/')) return t('schedule.everyMinutes', { count: Number(minute.slice(2)) });
  if (hour === '*' && minute === '0') return t('presets.everyHour');
  if (dayOfWeek !== '*' && dayOfMonth === '*')
    return t('schedule.weeklyAt', { day: dayOfWeek, time: `${hour}:${minute.padStart(2, '0')}` });
  if (dayOfMonth !== '*')
    return t('schedule.monthlyAtDay', { day: dayOfMonth, time: `${hour}:${minute.padStart(2, '0')}` });
  if (hour !== '*')
    return t('schedule.dailyAt', { time: `${hour}:${minute.padStart(2, '0')}` });
  return cron;
}

function estimateNextRun(scheduleExpr: string): string | null {
  const now = new Date();
  const next = new Date(now.getTime());

  if (scheduleExpr === '* * * * *') {
    next.setSeconds(0, 0);
    next.setMinutes(next.getMinutes() + 1);
    return next.toLocaleString();
  }
  if (scheduleExpr === '*/5 * * * *') {
    const delta = 5 - (next.getMinutes() % 5 || 5);
    next.setSeconds(0, 0);
    next.setMinutes(next.getMinutes() + delta);
    return next.toLocaleString();
  }
  if (scheduleExpr === '*/15 * * * *') {
    const delta = 15 - (next.getMinutes() % 15 || 15);
    next.setSeconds(0, 0);
    next.setMinutes(next.getMinutes() + delta);
    return next.toLocaleString();
  }
  if (scheduleExpr === '0 * * * *') {
    next.setMinutes(0, 0, 0);
    next.setHours(next.getHours() + 1);
    return next.toLocaleString();
  }
  if (scheduleExpr === '0 9 * * *' || scheduleExpr === '0 18 * * *') {
    const targetHour = scheduleExpr === '0 9 * * *' ? 9 : 18;
    next.setSeconds(0, 0);
    next.setHours(targetHour, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    return next.toLocaleString();
  }
  if (scheduleExpr === '0 9 * * 1') {
    next.setSeconds(0, 0);
    next.setHours(9, 0, 0, 0);
    const day = next.getDay();
    const daysUntilMonday = day === 1 ? 7 : (8 - day) % 7;
    next.setDate(next.getDate() + daysUntilMonday);
    return next.toLocaleString();
  }
  if (scheduleExpr === '0 9 1 * *') {
    next.setSeconds(0, 0);
    next.setDate(1);
    next.setHours(9, 0, 0, 0);
    if (next <= now) next.setMonth(next.getMonth() + 1);
    return next.toLocaleString();
  }
  return null;
}

// ── Stat Card (Dashboard MetricItem style) ───────────────────────
function StatItem({ label, value, icon, color }: { label: string; value: string | number; icon: React.ReactNode; color: string }) {
  return (
    <div className="rounded-lg bg-black/[0.03] dark:bg-white/[0.04] p-4 min-w-0">
      <div className="flex items-center gap-1.5 mb-2">
        <span className={color}>{icon}</span>
        <span className={cn('text-xs uppercase tracking-wider font-medium', color)}>{label}</span>
      </div>
      <div className="text-xl font-bold text-foreground">{value}</div>
    </div>
  );
}

// ── Task Dialog ──────────────────────────────────────────────────
interface TaskDialogProps {
  job?: CronJob;
  onClose: () => void;
  onSave: (input: CronJobCreateInput) => Promise<void>;
}

function TaskDialog({ job, onClose, onSave }: TaskDialogProps) {
  const { t } = useTranslation('cron');
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(job?.name || '');
  const [message, setMessage] = useState(job?.message || '');
  const initialSchedule = (() => {
    const s = job?.schedule;
    if (!s) return '0 9 * * *';
    if (typeof s === 'string') return s;
    if (typeof s === 'object' && 'expr' in s && typeof (s as { expr: string }).expr === 'string')
      return (s as { expr: string }).expr;
    return '0 9 * * *';
  })();
  const [schedule, setSchedule] = useState(initialSchedule);
  const [customSchedule, setCustomSchedule] = useState('');
  const [useCustom, setUseCustom] = useState(false);
  const [enabled, setEnabled] = useState(job?.enabled ?? true);
  const schedulePreview = estimateNextRun(useCustom ? customSchedule : schedule);

  const handleSubmit = async () => {
    if (!name.trim()) { toast.error(t('toast.nameRequired')); return; }
    if (!message.trim()) { toast.error(t('toast.messageRequired')); return; }
    const finalSchedule = useCustom ? customSchedule : schedule;
    if (!finalSchedule.trim()) { toast.error(t('toast.scheduleRequired')); return; }
    setSaving(true);
    try {
      await onSave({ name: name.trim(), message: message.trim(), schedule: finalSchedule, enabled });
      onClose();
      toast.success(job ? t('toast.updated') : t('toast.created'));
    } catch (err) {
      toast.error(String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <Card
        className="w-full max-w-lg max-h-[90vh] flex flex-col rounded-xl border-0 shadow-2xl bg-background overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 pb-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground">{job ? t('dialog.editTitle') : t('dialog.createTitle')}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{t('dialog.description')}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full h-8 w-8 text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 pb-6 space-y-5">
          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="name" className="text-xs font-semibold text-foreground/70">{t('dialog.taskName')}</Label>
            <Input
              id="name"
              placeholder={t('dialog.taskNamePlaceholder')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-9 rounded-lg text-sm bg-black/[0.03] dark:bg-white/[0.04] border-border/40"
            />
          </div>

          {/* Message */}
          <div className="space-y-1.5">
            <Label htmlFor="message" className="text-xs font-semibold text-foreground/70">{t('dialog.message')}</Label>
            <Textarea
              id="message"
              placeholder={t('dialog.messagePlaceholder')}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              className="rounded-lg text-sm bg-black/[0.03] dark:bg-white/[0.04] border-border/40 resize-none"
            />
          </div>

          {/* Schedule */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-foreground/70">{t('dialog.schedule')}</Label>
            {!useCustom ? (
              <div className="grid grid-cols-2 gap-2">
                {schedulePresets.map((preset) => (
                  <Button
                    key={preset.value}
                    type="button"
                    variant={schedule === preset.value ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setSchedule(preset.value)}
                    className={cn(
                      'justify-start h-8 rounded-lg text-xs font-medium',
                      schedule === preset.value
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-black/[0.03] dark:bg-white/[0.04] border-border/40 text-foreground/70 hover:text-foreground',
                    )}
                  >
                    <Timer className="h-3 w-3 mr-1.5 opacity-70" />
                    {t(`presets.${preset.key}` as const)}
                  </Button>
                ))}
              </div>
            ) : (
              <Input
                placeholder={t('dialog.cronPlaceholder')}
                value={customSchedule}
                onChange={(e) => setCustomSchedule(e.target.value)}
                className="h-9 rounded-lg text-sm font-mono bg-black/[0.03] dark:bg-white/[0.04] border-border/40"
              />
            )}
            <div className="flex items-center justify-between mt-1.5">
              <p className="text-[11px] text-muted-foreground">
                {schedulePreview ? `${t('card.next')}: ${schedulePreview}` : t('dialog.cronPlaceholder')}
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setUseCustom(!useCustom)}
                className="text-[11px] h-6 px-2 text-muted-foreground hover:text-foreground rounded-md"
              >
                {useCustom ? t('dialog.usePresets') : t('dialog.useCustomCron')}
              </Button>
            </div>
          </div>

          {/* Enabled toggle */}
          <div className="flex items-center justify-between bg-black/[0.03] dark:bg-white/[0.04] p-3.5 rounded-lg border border-border/40">
            <div>
              <span className="text-xs font-semibold text-foreground/70">{t('dialog.enableImmediately')}</span>
              <p className="text-[11px] text-muted-foreground mt-0.5">{t('dialog.enableImmediatelyDesc')}</p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={onClose} className="h-8 text-xs rounded-full px-4">
              {t('common:actions.cancel', 'Cancel')}
            </Button>
            <Button size="sm" onClick={handleSubmit} disabled={saving} className="h-8 text-xs rounded-full px-4">
              {saving ? (
                <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />{t('common:status.saving', 'Saving...')}</>
              ) : (
                <><CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />{job ? t('dialog.saveChanges') : t('dialog.createTitle')}</>
              )}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

// ── Job Card ─────────────────────────────────────────────────────
interface CronJobCardProps {
  job: CronJob;
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
  onTrigger: () => Promise<void>;
}

function CronJobCard({ job, onToggle, onEdit, onDelete, onTrigger }: CronJobCardProps) {
  const { t } = useTranslation('cron');
  const [triggering, setTriggering] = useState(false);

  const handleTrigger = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setTriggering(true);
    try {
      await onTrigger();
      toast.success(t('toast.triggered'));
    } catch (error) {
      toast.error(t('toast.failedTrigger', { error: error instanceof Error ? error.message : String(error) }));
    } finally {
      setTriggering(false);
    }
  };

  return (
    <div
      className="group flex flex-col p-4 rounded-xl bg-black/[0.03] dark:bg-white/[0.04] hover:bg-black/[0.06] dark:hover:bg-white/[0.07] transition-colors cursor-pointer"
      onClick={onEdit}
    >
      {/* Top row: icon + name + toggle */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className={cn(
            'h-9 w-9 shrink-0 flex items-center justify-center rounded-lg',
            job.enabled ? 'bg-emerald-500/10' : 'bg-zinc-500/10',
          )}>
            <Clock className={cn('h-4 w-4', job.enabled ? 'text-emerald-500' : 'text-muted-foreground')} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground truncate">{job.name}</h3>
              <span className={cn(
                'w-1.5 h-1.5 rounded-full shrink-0',
                job.enabled ? 'bg-emerald-500' : 'bg-zinc-400',
              )} />
            </div>
            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
              <Timer className="h-3 w-3" />
              {parseCronSchedule(job.schedule, t)}
            </p>
          </div>
        </div>
        <div onClick={(e) => e.stopPropagation()}>
          <Switch checked={job.enabled} onCheckedChange={onToggle} />
        </div>
      </div>

      {/* Message preview */}
      <div className="flex items-start gap-2 mb-3 pl-12">
        <MessageSquare className="h-3 w-3 mt-0.5 text-muted-foreground/50 shrink-0" />
        <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">{job.message}</p>
      </div>

      {/* Metadata row */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-muted-foreground/70 font-medium pl-12 mb-2">
        {job.target && (
          <span className="flex items-center gap-1">
            {CHANNEL_ICONS[job.target.channelType as ChannelType]}
            {job.target.channelName}
          </span>
        )}
        {job.lastRun && (
          <span className="flex items-center gap-1">
            <History className="h-3 w-3" />
            {t('card.last')}: {formatRelativeTime(job.lastRun.time)}
            {job.lastRun.success
              ? <CheckCircle2 className="h-3 w-3 text-emerald-500" />
              : <XCircle className="h-3 w-3 text-red-500" />
            }
          </span>
        )}
        {job.nextRun && job.enabled && (
          <span className="flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            {t('card.next')}: {new Date(job.nextRun).toLocaleString()}
          </span>
        )}
      </div>

      {/* Last run error */}
      {job.lastRun && !job.lastRun.success && job.lastRun.error && (
        <div className="flex items-start gap-2 p-2.5 mb-2 ml-12 rounded-lg border border-red-500/20 bg-red-500/5 text-xs text-red-600 dark:text-red-400">
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span className="line-clamp-2">{job.lastRun.error}</span>
        </div>
      )}

      {/* Hover actions */}
      <div className="flex justify-end gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity pl-12">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleTrigger}
          disabled={triggering}
          className="h-7 px-2.5 text-[11px] text-foreground/60 hover:text-foreground rounded-md"
        >
          {triggering
            ? <Loader2 className="h-3 w-3 animate-spin mr-1" />
            : <Play className="h-3 w-3 mr-1" />
          }
          {t('card.runNow')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="h-7 px-2.5 text-[11px] text-red-500/60 hover:text-red-500 hover:bg-red-500/10 rounded-md"
        >
          <Trash2 className="h-3 w-3 mr-1" />
          {t('common:actions.delete', 'Delete')}
        </Button>
      </div>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────
export function Cron() {
  const { t } = useTranslation('cron');
  const { jobs, loading, error, fetchJobs, createJob, updateJob, toggleJob, deleteJob, triggerJob } = useCronStore();
  const gatewayStatus = useGatewayStore((state) => state.status);
  const [showDialog, setShowDialog] = useState(false);
  const [editingJob, setEditingJob] = useState<CronJob | undefined>();
  const [jobToDelete, setJobToDelete] = useState<{ id: string } | null>(null);

  const isGatewayRunning = gatewayStatus.state === 'running';

  useEffect(() => {
    if (isGatewayRunning) fetchJobs();
  }, [fetchJobs, isGatewayRunning]);

  const safeJobs = Array.isArray(jobs) ? jobs : [];
  const activeJobs = safeJobs.filter((j) => j.enabled);
  const pausedJobs = safeJobs.filter((j) => !j.enabled);
  const failedJobs = safeJobs.filter((j) => j.lastRun && !j.lastRun.success);

  const handleSave = useCallback(async (input: CronJobCreateInput) => {
    if (editingJob) await updateJob(editingJob.id, input);
    else await createJob(input);
  }, [editingJob, createJob, updateJob]);

  const handleToggle = useCallback(async (id: string, enabled: boolean) => {
    try {
      await toggleJob(id, enabled);
      toast.success(enabled ? t('toast.enabled') : t('toast.paused'));
    } catch {
      toast.error(t('toast.failedUpdate'));
    }
  }, [toggleJob, t]);

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
              onClick={fetchJobs}
              disabled={!isGatewayRunning}
              className="h-8 text-xs rounded-full px-3"
            >
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              {t('refresh')}
            </Button>
            <Button
              size="sm"
              onClick={() => { setEditingJob(undefined); setShowDialog(true); }}
              disabled={!isGatewayRunning}
              className="h-8 text-xs rounded-full px-3"
            >
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              {t('newTask')}
            </Button>
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto min-h-0 space-y-4 pb-4">
          {/* Warnings */}
          {!isGatewayRunning && (
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

          {/* Statistics Card — Dashboard MetricItem style */}
          <Card className="rounded-xl border-0 shadow-none bg-black/[0.02] dark:bg-white/[0.02]">
            <div className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <Clock className="h-4 w-4 text-sky-500" />
                <h3 className="text-sm font-semibold">{t('title')}</h3>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <StatItem
                  label={t('stats.total')}
                  value={safeJobs.length}
                  icon={<Clock className="h-3.5 w-3.5" />}
                  color="text-sky-500"
                />
                <StatItem
                  label={t('stats.active')}
                  value={activeJobs.length}
                  icon={<Play className="h-3.5 w-3.5" />}
                  color="text-emerald-500"
                />
                <StatItem
                  label={t('stats.paused')}
                  value={pausedJobs.length}
                  icon={<Pause className="h-3.5 w-3.5" />}
                  color="text-amber-500"
                />
                <StatItem
                  label={t('stats.failed')}
                  value={failedJobs.length}
                  icon={<XCircle className="h-3.5 w-3.5" />}
                  color="text-red-500"
                />
              </div>
            </div>
          </Card>

          {/* Jobs List */}
          <Card className="rounded-xl border-0 shadow-none bg-black/[0.02] dark:bg-white/[0.02]">
            <div className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <Timer className="h-4 w-4 text-violet-500" />
                <h3 className="text-sm font-semibold">{t('subtitle')}</h3>
              </div>

              {safeJobs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <Clock className="h-8 w-8 mb-3 opacity-30" />
                  <h3 className="text-sm font-medium mb-1 text-foreground/70">{t('empty.title')}</h3>
                  <p className="text-xs text-center mb-4 max-w-sm">{t('empty.description')}</p>
                  <Button
                    size="sm"
                    onClick={() => { setEditingJob(undefined); setShowDialog(true); }}
                    disabled={!isGatewayRunning}
                    className="h-8 text-xs rounded-full px-4"
                  >
                    <Plus className="h-3.5 w-3.5 mr-1.5" />
                    {t('empty.create')}
                  </Button>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  {safeJobs.map((job) => (
                    <CronJobCard
                      key={job.id}
                      job={job}
                      onToggle={(enabled) => handleToggle(job.id, enabled)}
                      onEdit={() => { setEditingJob(job); setShowDialog(true); }}
                      onDelete={() => setJobToDelete({ id: job.id })}
                      onTrigger={() => triggerJob(job.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>

      {/* Dialog */}
      {showDialog && (
        <TaskDialog
          job={editingJob}
          onClose={() => { setShowDialog(false); setEditingJob(undefined); }}
          onSave={handleSave}
        />
      )}

      <ConfirmDialog
        open={!!jobToDelete}
        title={t('common:actions.confirm', 'Confirm')}
        message={t('card.deleteConfirm')}
        confirmLabel={t('common:actions.delete', 'Delete')}
        cancelLabel={t('common:actions.cancel', 'Cancel')}
        variant="destructive"
        onConfirm={async () => {
          if (jobToDelete) {
            await deleteJob(jobToDelete.id);
            setJobToDelete(null);
            toast.success(t('toast.deleted'));
          }
        }}
        onCancel={() => setJobToDelete(null)}
      />
    </div>
  );
}

export default Cron;
