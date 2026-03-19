/**
 * About Page
 * Application information, version, and update settings
 */
import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
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
        <div className="mb-8 shrink-0">
          <h1 className="text-2xl font-semibold text-foreground tracking-tight">
            {t('settings:about.title')}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t('settings:about.appName')} - {t('settings:about.tagline')}
          </p>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto min-h-0 space-y-6 pb-8">

          {/* App Info */}
          <Card className="rounded-xl border shadow-sm">
            <div className="p-6 space-y-4">
              <h2 className="text-lg font-semibold text-foreground">
                {t('settings:about.appName')}
              </h2>
              <div className="space-y-3 text-sm text-muted-foreground">
                <p>{t('settings:about.tagline')}</p>
                <p>{t('settings:about.basedOn')}</p>
                <p>{t('settings:about.version', { version: currentVersion })}</p>
              </div>
              <Separator />
              <div className="flex flex-wrap gap-3 pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-lg"
                  onClick={() => window.electron.openExternal('https://claw-x.com')}
                >
                  <ExternalLink className="h-4 w-4 mr-2" />
                  {t('settings:about.docs')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-lg"
                  onClick={() => window.electron.openExternal('https://github.com/ValueCell-ai/ClawBox')}
                >
                  <ExternalLink className="h-4 w-4 mr-2" />
                  {t('settings:about.github')}
                </Button>
              </div>
            </div>
          </Card>

          {/* Update Status */}
          <Card className="rounded-xl border shadow-sm">
            <div className="p-6 space-y-6">
              <h2 className="text-lg font-semibold text-foreground">
                {t('settings:updates.title')}
              </h2>

              <UpdateSettings />

              <Separator />

              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm font-medium text-foreground">
                    {t('settings:updates.autoCheck')}
                  </Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t('settings:updates.autoCheckDesc')}
                  </p>
                </div>
                <Switch
                  checked={autoCheckUpdate}
                  onCheckedChange={setAutoCheckUpdate}
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm font-medium text-foreground">
                    {t('settings:updates.autoDownload')}
                  </Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t('settings:updates.autoDownloadDesc')}
                  </p>
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
          </Card>

        </div>
      </div>
    </div>
  );
}

export default About;
