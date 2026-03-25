import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { trackUiEvent } from '@/lib/telemetry';
import { ProvidersSettings } from '@/components/settings/ProvidersSettings';

export function Models() {
  const { t } = useTranslation(['dashboard', 'settings']);
  useEffect(() => {
    trackUiEvent('models.page_viewed');
  }, []);

  return (
    <div className="flex flex-col -m-6 bg-background h-[calc(100vh-2.5rem)] overflow-hidden">
      <div className="w-full max-w-6xl mx-auto flex flex-col h-full p-6 lg:p-8">
        {/* Header */}
        <header className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 shrink-0 gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-foreground tracking-tight">
              {t('dashboard:models.title')}
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {t('dashboard:models.subtitle')}
            </p>
          </div>
        </header>

        {/* Content Area */}
        <div className="flex-1 min-h-0">
          <ProvidersSettings />
        </div>
      </div>
    </div>
  );
}

export default Models;
