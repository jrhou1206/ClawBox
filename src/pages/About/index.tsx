/**
 * About Page
 * Application information, version, and update settings.
 * Unified with Dashboard visual style.
 */
import { ExternalLink, Info, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card } from '@/components/ui/card';
import { useSettingsStore } from '@/stores/settings';
import { useUpdateStore } from '@/stores/update';
import { UpdateSettings } from '@/components/settings/UpdateSettings';
import { useTranslation } from 'react-i18next';

export function About() {
  const { t } = useTranslation(['settings', 'common']);

  const {
    autoCheckUpdate,
    setAutoCheckUpdate,
    autoDownloadUpdate,
    setAutoDownloadUpdate,
  } = useSettingsStore();

  const currentVersion = useUpdateStore((state) => state.currentVersion);
  const updateSetAutoDownload = useUpdateStore((state) => state.setAutoDownload);

  return (
    <div className="flex flex-col -m-6 bg-background h-[calc(100vh-2.5rem)] overflow-hidden">
      <div className="w-full max-w-6xl mx-auto flex flex-col h-full p-6 lg:p-8">
        {/* Header */}
        <header className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-4 shrink-0">
          <div>
            <h1 className="text-2xl font-semibold text-foreground tracking-tight">
              {t('settings:about.title')}
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {t('settings:about.appName')} - {t('settings:about.tagline')}
            </p>
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto min-h-0 space-y-4 pb-4">
          {/* App Info */}
          <Card className="rounded-xl border-0 shadow-none bg-black/[0.02] dark:bg-white/[0.02]">
            <div className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <Info className="h-4 w-4 text-sky-500" />
                <h3 className="text-sm font-semibold">{t('settings:about.appName')}</h3>
              </div>
              <div className="space-y-2 text-xs text-muted-foreground mb-4">
                <p>{t('settings:about.tagline')}</p>
                <p>{t('settings:about.basedOn')}</p>
                <p className="text-foreground font-medium">{t('settings:about.version', { version: currentVersion })}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs rounded-full px-3"
                  onClick={() => window.electron.openExternal('https://claw-x.com')}
                >
                  <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                  {t('settings:about.docs')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs rounded-full px-3"
                  onClick={() => window.electron.openExternal('https://github.com/ValueCell-ai/ClawBox')}
                >
                  <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                  {t('settings:about.github')}
                </Button>
              </div>
            </div>
          </Card>

          {/* Update Status */}
          <Card className="rounded-xl border-0 shadow-none bg-black/[0.02] dark:bg-white/[0.02]">
            <div className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <Download className="h-4 w-4 text-violet-500" />
                <h3 className="text-sm font-semibold">{t('settings:updates.title')}</h3>
              </div>

              <div className="mb-5">
                <UpdateSettings />
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3 rounded-lg bg-black/[0.03] dark:bg-white/[0.04] p-3.5">
                  <div>
                    <span className="text-xs font-semibold text-foreground/80">{t('settings:updates.autoCheck')}</span>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{t('settings:updates.autoCheckDesc')}</p>
                  </div>
                  <Switch checked={autoCheckUpdate} onCheckedChange={setAutoCheckUpdate} />
                </div>

                <div className="flex items-center justify-between gap-3 rounded-lg bg-black/[0.03] dark:bg-white/[0.04] p-3.5">
                  <div>
                    <span className="text-xs font-semibold text-foreground/80">{t('settings:updates.autoDownload')}</span>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{t('settings:updates.autoDownloadDesc')}</p>
                  </div>
                  <Switch
                    checked={autoDownloadUpdate}
                    onCheckedChange={(value) => {
                      setAutoDownloadUpdate(value);
                      updateSetAutoDownload(value);
                    }}
                  />
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default About;
