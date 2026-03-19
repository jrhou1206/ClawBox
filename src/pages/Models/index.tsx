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
        <div className="flex flex-col md:flex-row md:items-start justify-between mb-6 shrink-0 gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-foreground tracking-tight">
              {t('dashboard:models.title')}
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {t('dashboard:models.subtitle')}
            </p>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto pr-2 pb-10 min-h-0 -mr-2">
          <ProvidersSettings />
        </div>
      </div>
    </div>
  );
}

export default Models;
