/**
 * Providers Settings Component
 * Manage AI provider configurations and API keys
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Plus,
  Trash2,
  Edit,
  Eye,
  EyeOff,
  Check,
  X,
  Loader2,
  Key,
  ExternalLink,
  Copy,
  XCircle,
  ChevronDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import {
  useProviderStore,
  type ProviderAccount,
  type ProviderConfig,
  type ProviderVendorInfo,
} from '@/stores/providers';
import {
  PROVIDER_TYPE_INFO,
  type ProviderType,
  getProviderIconUrl,
  resolveProviderApiKeyForSave,
  resolveProviderModelForSave,
  shouldShowProviderModelId,
  shouldInvertInDark,
} from '@/lib/providers';
import {
  buildProviderAccountId,
  buildProviderListItems,
  hasConfiguredCredentials,
  type ProviderListItem,
} from '@/lib/provider-accounts';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { invokeIpc } from '@/lib/api-client';
import { useSettingsStore } from '@/stores/settings';
import { hostApiFetch } from '@/lib/host-api';
import { subscribeHostEvent } from '@/lib/host-events';

const inputClasses = 'h-9 rounded-lg text-sm bg-black/[0.03] dark:bg-white/[0.04] border-border/40 focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:border-primary transition-all text-foreground placeholder:text-foreground/40';
const labelClasses = 'text-xs font-semibold text-foreground/70';

function normalizeFallbackProviderIds(ids?: string[]): string[] {
  return Array.from(new Set((ids ?? []).filter(Boolean)));
}

function getProtocolBaseUrlPlaceholder(
  apiProtocol: ProviderAccount['apiProtocol'],
): string {
  if (apiProtocol === 'anthropic-messages') {
    return 'https://api.example.com/anthropic';
  }
  return 'https://api.example.com/v1';
}

function fallbackProviderIdsEqual(a?: string[], b?: string[]): boolean {
  const left = normalizeFallbackProviderIds(a).sort();
  const right = normalizeFallbackProviderIds(b).sort();
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function normalizeFallbackModels(models?: string[]): string[] {
  return Array.from(new Set((models ?? []).map((model) => model.trim()).filter(Boolean)));
}

function getAuthModeLabel(
  authMode: ProviderAccount['authMode'],
  t: (key: string) => string
): string {
  switch (authMode) {
    case 'api_key':
      return t('aiProviders.authModes.apiKey');
    case 'oauth_device':
      return t('aiProviders.authModes.oauthDevice');
    case 'oauth_browser':
      return t('aiProviders.authModes.oauthBrowser');
    case 'local':
      return t('aiProviders.authModes.local');
    default:
      return authMode;
  }
}

function createFallbackVendorInfo(type: ProviderType): ProviderVendorInfo {
  const typeInfo = PROVIDER_TYPE_INFO.find((entry) => entry.id === type);
  if (!typeInfo) {
    throw new Error(`Unknown provider type: ${type}`);
  }

  const supportedAuthModes: ProviderAccount['authMode'][] =
    type === 'ollama'
      ? ['local']
      : typeInfo.isOAuth
        ? [
          ...(typeInfo.supportsApiKey ? ['api_key' as const] : []),
          ...(type === 'google' || type === 'openai' ? ['oauth_browser' as const] : ['oauth_device' as const]),
        ]
        : ['api_key'];

  const defaultAuthMode: ProviderAccount['authMode'] =
    type === 'ollama'
      ? 'local'
      : typeInfo.isOAuth && !typeInfo.supportsApiKey
        ? (type === 'google' || type === 'openai' ? 'oauth_browser' : 'oauth_device')
        : 'api_key';

  return {
    ...typeInfo,
    category: type === 'custom' ? 'custom' : (type === 'ollama' ? 'local' : 'official'),
    supportedAuthModes,
    defaultAuthMode,
    supportsMultipleAccounts: true,
  };
}

function buildVendorCatalog(vendors: ProviderVendorInfo[]): ProviderVendorInfo[] {
  const vendorMap = new Map(vendors.map((vendor) => [vendor.id, vendor]));
  const orderedTypeInfo = [
    ...PROVIDER_TYPE_INFO.filter((typeInfo) => typeInfo.id === 'custom'),
    ...PROVIDER_TYPE_INFO.filter((typeInfo) => typeInfo.id !== 'custom'),
  ];
  const ordered = orderedTypeInfo.map(
    (typeInfo) => vendorMap.get(typeInfo.id) ?? createFallbackVendorInfo(typeInfo.id),
  );

  for (const vendor of vendors) {
    if (!ordered.some((candidate) => candidate.id === vendor.id)) {
      ordered.push(vendor);
    }
  }

  return ordered;
}

function countConfiguredModels(items: ProviderListItem[]): number {
  return items.reduce((count, item) => {
    const primary = item.account.model ? 1 : 0;
    const fallbacks = item.account.fallbackModels?.length ?? 0;
    return count + primary + fallbacks;
  }, 0);
}

export function ProvidersSettings() {
  const { t } = useTranslation('settings');
  const devModeUnlocked = useSettingsStore((state) => state.devModeUnlocked);
  const {
    statuses,
    accounts,
    vendors,
    defaultAccountId,
    loading,
    refreshProviderSnapshot,
    createAccount,
    removeAccount,
    updateAccount,
    setDefaultAccount,
    validateAccountApiKey,
  } = useProviderStore();

  const [showAddDialog, setShowAddDialog] = useState(false);
  const [dialogInitialType, setDialogInitialType] = useState<ProviderType | null>(null);
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [selectedVendorId, setSelectedVendorId] = useState<ProviderType | null>(null);
  const vendorCatalog = useMemo(() => buildVendorCatalog(vendors), [vendors]);
  const vendorMap = useMemo(
    () => new Map(vendorCatalog.map((vendor) => [vendor.id, vendor])),
    [vendorCatalog],
  );
  const existingVendorIds = new Set(accounts.map((account) => account.vendorId));
  const displayProviders = useMemo(
    () => buildProviderListItems(accounts, statuses, vendors, defaultAccountId),
    [accounts, statuses, vendors, defaultAccountId],
  );
  const itemsByVendor = useMemo(() => {
    const next = new Map<ProviderType, ProviderListItem[]>();
    for (const vendor of vendorCatalog) {
      next.set(
        vendor.id,
        displayProviders.filter((item) => item.account.vendorId === vendor.id),
      );
    }
    return next;
  }, [displayProviders, vendorCatalog]);
  const selectedVendor = selectedVendorId ? vendorMap.get(selectedVendorId) : undefined;
  const selectedVendorItems = selectedVendorId
    ? (itemsByVendor.get(selectedVendorId) ?? [])
    : [];
  const editingProviderItem = editingProvider
    ? displayProviders.find((item) => item.account.id === editingProvider) ?? null
    : null;

  // Fetch providers on mount
  useEffect(() => {
    refreshProviderSnapshot();
  }, [refreshProviderSnapshot]);

  useEffect(() => {
    if (selectedVendorId && vendorMap.has(selectedVendorId)) {
      return;
    }

    const defaultVendorId = defaultAccountId
      ? accounts.find((account) => account.id === defaultAccountId)?.vendorId
      : undefined;
    const nextVendorId = defaultVendorId || accounts[0]?.vendorId || null;
    if (nextVendorId) {
      setSelectedVendorId(nextVendorId);
    }
  }, [accounts, defaultAccountId, selectedVendorId, vendorMap]);

  const openAddDialog = (type: ProviderType | null) => {
    if (type) {
      setSelectedVendorId(type);
    }
    setDialogInitialType(type);
    setShowAddDialog(true);
  };

  const handleAddProvider = async (
    type: ProviderType,
    name: string,
    apiKey: string,
    options?: { baseUrl?: string; model?: string; authMode?: ProviderAccount['authMode']; apiProtocol?: ProviderAccount['apiProtocol'] }
  ) => {
    const vendor = vendorMap.get(type);
    const id = buildProviderAccountId(type, null, vendors);
    const effectiveApiKey = resolveProviderApiKeyForSave(type, apiKey);
    try {
      await createAccount({
        id,
        vendorId: type,
        label: name,
        authMode: options?.authMode || vendor?.defaultAuthMode || (type === 'ollama' ? 'local' : 'api_key'),
        baseUrl: options?.baseUrl,
        apiProtocol: options?.apiProtocol,
        model: options?.model,
        enabled: true,
        isDefault: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }, effectiveApiKey);

      // Auto-set as default if no default is currently configured
      if (!defaultAccountId) {
        await setDefaultAccount(id);
      }

      setSelectedVendorId(type);
      setDialogInitialType(null);
      setShowAddDialog(false);
      toast.success(t('aiProviders.toast.added'));
    } catch (error) {
      toast.error(`${t('aiProviders.toast.failedAdd')}: ${error}`);
    }
  };

  const handleDeleteProvider = async (providerId: string) => {
    try {
      await removeAccount(providerId);
      toast.success(t('aiProviders.toast.deleted'));
    } catch (error) {
      toast.error(`${t('aiProviders.toast.failedDelete')}: ${error}`);
    }
  };

  const handleSetDefaultSilently = async (providerId: string) => {
    await setDefaultAccount(providerId);
  };

  const handleVendorClick = (vendorId: ProviderType) => {
    setSelectedVendorId(vendorId);
    if ((itemsByVendor.get(vendorId) ?? []).length === 0) {
      openAddDialog(vendorId);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-6">
      {loading ? (
        <div className="flex h-full min-h-0 items-center justify-center rounded-xl border border-transparent border-dashed bg-black/5 py-12 text-muted-foreground dark:bg-white/5">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (
        <div className="grid h-full min-h-0 flex-1 gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="flex min-h-0 flex-col overflow-hidden rounded-xl border-0 shadow-none bg-black/[0.02] dark:bg-white/[0.02]">
            <div className="px-5 py-4 border-b border-border/30">
              <h3 className="text-sm font-semibold text-foreground">
                {t('aiProviders.layout.vendors')}
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {t('aiProviders.layout.vendorListDesc')}
              </p>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto p-3">
              {vendorCatalog.map((vendor) => {
                const vendorItems = itemsByVendor.get(vendor.id) ?? [];
                const isSelected = selectedVendorId === vendor.id;
                const hasDefault = vendorItems.some((item) => item.account.id === defaultAccountId);
                const modelCount = countConfiguredModels(vendorItems);

                return (
                  <button
                    key={vendor.id}
                    type="button"
                    onClick={() => handleVendorClick(vendor.id)}
                    className={cn(
                      'w-full rounded-lg border px-4 py-3 text-left transition-colors',
                      isSelected
                        ? 'bg-black/[0.05] dark:bg-white/[0.06]'
                        : 'border-transparent bg-transparent hover:bg-black/[0.03] dark:hover:bg-white/[0.04]',
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-black/[0.04] dark:bg-white/[0.06]">
                        {getProviderIconUrl(vendor.id) ? (
                          <img
                            src={getProviderIconUrl(vendor.id)}
                            alt={vendor.name}
                            className={cn('h-7 w-7', shouldInvertInDark(vendor.id) && 'dark:invert')}
                          />
                        ) : (
                          <span className="text-xl">{vendor.icon}</span>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-[14px] font-semibold text-foreground">
                            {vendor.id === 'custom' ? t('aiProviders.custom') : vendor.name}
                          </p>
                          {hasDefault && (
                            <span className="rounded-full bg-black/[0.04] px-2 py-0.5 text-[10px] font-medium text-foreground/70 dark:bg-white/[0.08]">
                              {t('aiProviders.card.default')}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {vendorItems.length > 0
                            ? `${t('aiProviders.layout.aliasesCount', { count: vendorItems.length })} · ${t('aiProviders.layout.modelsCount', { count: modelCount })}`
                            : t('aiProviders.layout.notConnected')}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>

          <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border-0 shadow-none bg-black/[0.02] dark:bg-white/[0.02]">
            {selectedVendor ? (
              <>
                <div className="px-5 py-4 border-b border-border/30">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-black/[0.04] dark:bg-white/[0.06]">
                        {getProviderIconUrl(selectedVendor.id) ? (
                          <img
                            src={getProviderIconUrl(selectedVendor.id)}
                            alt={selectedVendor.name}
                            className={cn('h-6 w-6', shouldInvertInDark(selectedVendor.id) && 'dark:invert')}
                          />
                        ) : (
                          <span className="text-xl">{selectedVendor.icon}</span>
                        )}
                      </div>
                      <div>
                        <h3 className="text-xl font-semibold text-foreground">
                          {selectedVendor.id === 'custom' ? t('aiProviders.custom') : selectedVendor.name}
                        </h3>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {t('aiProviders.layout.vendorSummary', {
                            aliasCount: selectedVendorItems.length,
                            modelCount: countConfiguredModels(selectedVendorItems),
                          })}
                        </p>
                      </div>
                    </div>
                    <Button
                      onClick={() => openAddDialog(selectedVendor.id)}
                      className="rounded-full px-5 h-9 shadow-none font-medium text-[13px]"
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      {t('aiProviders.layout.addConnection', { defaultValue: '新增接入' })}
                    </Button>
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto p-4">
                  {selectedVendorItems.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center rounded-xl border border-dashed border-border/30 bg-black/[0.02] px-6 py-12 text-center dark:bg-white/[0.02]">
                      <Key className="mb-4 h-12 w-12 text-muted-foreground/60" />
                      <h4 className="text-base font-semibold text-foreground">
                        {t('aiProviders.layout.vendorEmptyTitle', {
                          vendor: selectedVendor.id === 'custom' ? t('aiProviders.custom') : selectedVendor.name,
                        })}
                      </h4>
                      <p className="mt-2 max-w-md text-sm text-muted-foreground">
                        {t('aiProviders.layout.vendorEmptyDesc')}
                      </p>
                      <Button
                        onClick={() => openAddDialog(selectedVendor.id)}
                        className="mt-4 rounded-full px-4 h-8 text-xs"
                      >
                        <Plus className="mr-2 h-4 w-4" />
                        {t('aiProviders.layout.connectNow')}
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {selectedVendorItems.map((item) => (
                        <ProviderCard
                          key={item.account.id}
                          item={item}
                          allProviders={displayProviders}
                          isDefault={item.account.id === defaultAccountId}
                          isEditing={false}
                          onEdit={() => setEditingProvider(item.account.id)}
                          onCancelEdit={() => {}}
                          onDelete={() => handleDeleteProvider(item.account.id)}
                          onSetDefaultSilently={() => handleSetDefaultSilently(item.account.id)}
                          onSaveEdits={async (payload) => {
                            const updates: Partial<ProviderAccount> = {};
                            if (payload.updates) {
                              if (payload.updates.baseUrl !== undefined) updates.baseUrl = payload.updates.baseUrl;
                              if (payload.updates.apiProtocol !== undefined) updates.apiProtocol = payload.updates.apiProtocol;
                              if (payload.updates.model !== undefined) updates.model = payload.updates.model;
                              if (payload.updates.fallbackModels !== undefined) updates.fallbackModels = payload.updates.fallbackModels;
                              if (payload.updates.fallbackProviderIds !== undefined) {
                                updates.fallbackAccountIds = payload.updates.fallbackProviderIds;
                              }
                            }
                            await updateAccount(
                              item.account.id,
                              updates,
                              payload.newApiKey,
                            );
                            setEditingProvider(null);
                          }}
                          onValidateKey={(key, options) => validateAccountApiKey(item.account.id, key, options)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex h-full flex-col items-center justify-center px-6 py-12 text-center">
                <Key className="mb-4 h-12 w-12 text-muted-foreground/60" />
                <h3 className="text-base font-semibold text-foreground">
                  {t('aiProviders.layout.emptySelectionTitle')}
                </h3>
                <p className="mt-2 max-w-md text-sm text-muted-foreground">
                  {t('aiProviders.layout.emptySelectionDesc')}
                </p>
              </div>
            )}
          </section>
        </div>
      )}

      {editingProviderItem && (
        <EditProviderDialog
          item={editingProviderItem}
          allProviders={displayProviders}
          isDefault={editingProviderItem.account.id === defaultAccountId}
          onClose={() => setEditingProvider(null)}
          onSaveEdits={async (payload) => {
            const updates: Partial<ProviderAccount> = {};
            if (payload.updates) {
              if (payload.updates.baseUrl !== undefined) updates.baseUrl = payload.updates.baseUrl;
              if (payload.updates.apiProtocol !== undefined) updates.apiProtocol = payload.updates.apiProtocol;
              if (payload.updates.model !== undefined) updates.model = payload.updates.model;
              if (payload.updates.fallbackModels !== undefined) updates.fallbackModels = payload.updates.fallbackModels;
              if (payload.updates.fallbackProviderIds !== undefined) {
                updates.fallbackAccountIds = payload.updates.fallbackProviderIds;
              }
            }
            await updateAccount(
              editingProviderItem.account.id,
              updates,
              payload.newApiKey,
            );
            setEditingProvider(null);
          }}
          onValidateKey={(key, options) => validateAccountApiKey(editingProviderItem.account.id, key, options)}
        />
      )}

      {/* Add Provider Dialog */}
      {showAddDialog && (
        <AddProviderDialog
          initialSelectedType={dialogInitialType}
          existingVendorIds={existingVendorIds}
          vendors={vendors}
          onClose={() => {
            setShowAddDialog(false);
            setDialogInitialType(null);
          }}
          onAdd={handleAddProvider}
          onValidateKey={(type, key, options) => validateAccountApiKey(type, key, options)}
          devModeUnlocked={devModeUnlocked}
        />
      )}
    </div>
  );
}

interface ProviderCardProps {
  item: ProviderListItem;
  allProviders: ProviderListItem[];
  isDefault: boolean;
  isEditing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onDelete: () => void;
  onSetDefaultSilently: () => Promise<void>;
  onSaveEdits: (payload: { newApiKey?: string; updates?: Partial<ProviderConfig> }) => Promise<void>;
  onValidateKey: (
    key: string,
    options?: { baseUrl?: string; apiProtocol?: ProviderAccount['apiProtocol'] }
  ) => Promise<{ valid: boolean; error?: string }>;
}



function ProviderCard({
  item,
  allProviders,
  isDefault,
  isEditing,
  onEdit,
  onCancelEdit,
  onDelete,
  onSetDefaultSilently,
  onSaveEdits,
  onValidateKey,
}: ProviderCardProps) {
  const { t } = useTranslation('settings');
  const { account, status } = item;
  const [newKey, setNewKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(account.baseUrl || '');
  const [apiProtocol, setApiProtocol] = useState<ProviderAccount['apiProtocol']>(account.apiProtocol || 'openai-completions');
  const [fallbackProviderIds, setFallbackProviderIds] = useState<string[]>(
    normalizeFallbackProviderIds(account.fallbackAccountIds)
  );
  const [addingModel, setAddingModel] = useState(false);
  const [newModelValue, setNewModelValue] = useState('');
  const [editingModelKey, setEditingModelKey] = useState<string | null>(null);
  const [editingModelValue, setEditingModelValue] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [showFallback, setShowFallback] = useState(false);
  const [validating, setValidating] = useState(false);
  const [saving, setSaving] = useState(false);

  const typeInfo = PROVIDER_TYPE_INFO.find((t) => t.id === account.vendorId);
  const canEditConnectionConfig = Boolean(typeInfo?.showBaseUrl || account.vendorId === 'custom');
  const accountModel = account.model?.trim() || '';
  const fallbackModels = normalizeFallbackModels(account.fallbackModels);
  const modelEntries = [
    ...(accountModel ? [{ key: 'primary', value: accountModel, kind: 'primary' as const }] : []),
    ...fallbackModels.map((model, index) => ({
      key: `fallback-${index}`,
      value: model,
      kind: 'fallback' as const,
    })),
  ];
  const resolvedBaseUrl = account.baseUrl?.trim() || typeInfo?.defaultBaseUrl || '--';

  useEffect(() => {
    if (isEditing) {
      setNewKey('');
      setShowKey(false);
      setBaseUrl(account.baseUrl || '');
      setApiProtocol(account.apiProtocol || 'openai-completions');
      setFallbackProviderIds(normalizeFallbackProviderIds(account.fallbackAccountIds));
    }
  }, [isEditing, account.baseUrl, account.fallbackAccountIds, account.apiProtocol]);

  const fallbackOptions = allProviders.filter((candidate) => candidate.account.id !== account.id);

  const toggleFallbackProvider = (providerId: string) => {
    setFallbackProviderIds((current) => (
      current.includes(providerId)
        ? current.filter((id) => id !== providerId)
        : [...current, providerId]
    ));
  };

  const handleSaveEdits = async () => {
    setSaving(true);
    try {
      const payload: { newApiKey?: string; updates?: Partial<ProviderConfig> } = {};

      if (newKey.trim()) {
        setValidating(true);
        const result = await onValidateKey(newKey, {
          baseUrl: baseUrl.trim() || undefined,
          apiProtocol: (account.vendorId === 'custom' || account.vendorId === 'ollama') ? apiProtocol : undefined,
        });
        setValidating(false);
        if (!result.valid) {
          toast.error(result.error || t('aiProviders.toast.invalidKey'));
          setSaving(false);
          return;
        }
        payload.newApiKey = newKey.trim();
      }

      const updates: Partial<ProviderConfig> = {};
      if (typeInfo?.showBaseUrl && (baseUrl.trim() || undefined) !== (account.baseUrl || undefined)) {
        updates.baseUrl = baseUrl.trim() || undefined;
      }
      if ((account.vendorId === 'custom' || account.vendorId === 'ollama') && apiProtocol !== account.apiProtocol) {
        updates.apiProtocol = apiProtocol;
      }
      if (!fallbackProviderIdsEqual(fallbackProviderIds, account.fallbackAccountIds)) {
        updates.fallbackProviderIds = normalizeFallbackProviderIds(fallbackProviderIds);
      }
      if (Object.keys(updates).length > 0) {
        payload.updates = updates;
      }

      // Keep Ollama key optional in UI, but persist a placeholder when
      // editing legacy configs that have no stored key.
      if (account.vendorId === 'ollama' && !status?.hasKey && !payload.newApiKey) {
        payload.newApiKey = resolveProviderApiKeyForSave(account.vendorId, '') as string;
      }

      if (!payload.newApiKey && !payload.updates) {
        onCancelEdit();
        setSaving(false);
        return;
      }

      await onSaveEdits(payload);
      setNewKey('');
      toast.success(t('aiProviders.toast.updated'));
    } catch (error) {
      toast.error(`${t('aiProviders.toast.failedUpdate')}: ${error}`);
    } finally {
      setSaving(false);
      setValidating(false);
    }
  };

  const currentInputClasses = isDefault
    ? "h-9 rounded-lg text-sm bg-black/[0.03] dark:bg-white/[0.04] border-border/40 focus-visible:ring-2 focus-visible:ring-primary/50"
    : inputClasses;

  const currentLabelClasses = isDefault ? "text-[13px] text-muted-foreground" : labelClasses;
  const currentSectionLabelClasses = isDefault ? "text-[14px] font-bold text-foreground/80" : labelClasses;

  const persistModelChanges = async (
    nextPrimaryModel: string | undefined,
    nextFallbackModels: string[],
  ) => {
    await onSaveEdits({
      updates: {
        model: nextPrimaryModel,
        fallbackModels: normalizeFallbackModels(nextFallbackModels),
      },
    });
  };

  const handleAddModel = async () => {
    const nextModel = newModelValue.trim();
    if (!nextModel) return;

    setSaving(true);
    try {
      if (!accountModel) {
        await persistModelChanges(nextModel, fallbackModels);
      } else {
        await persistModelChanges(accountModel, [...fallbackModels, nextModel]);
      }
      setAddingModel(false);
      setNewModelValue('');
      toast.success(t('aiProviders.toast.updated'));
    } catch (error) {
      toast.error(`${t('aiProviders.toast.failedUpdate')}: ${error}`);
    } finally {
      setSaving(false);
    }
  };

  const handleEditModelStart = (modelKey: string, value: string) => {
    setEditingModelKey(modelKey);
    setEditingModelValue(value);
  };

  const handleEditModelCancel = () => {
    setEditingModelKey(null);
    setEditingModelValue('');
  };

  const handleEditModelSave = async (modelKey: string, kind: 'primary' | 'fallback') => {
    const nextValue = editingModelValue.trim();
    if (!nextValue) {
      toast.error(t('aiProviders.toast.modelRequired'));
      return;
    }

    setSaving(true);
    try {
      if (kind === 'primary') {
        await persistModelChanges(nextValue, fallbackModels);
      } else {
        const fallbackIndex = Number(modelKey.replace('fallback-', ''));
        const nextFallbackModels = fallbackModels.map((model, index) => (
          index === fallbackIndex ? nextValue : model
        ));
        await persistModelChanges(accountModel || undefined, nextFallbackModels);
      }
      handleEditModelCancel();
      toast.success(t('aiProviders.toast.updated'));
    } catch (error) {
      toast.error(`${t('aiProviders.toast.failedUpdate')}: ${error}`);
    } finally {
      setSaving(false);
    }
  };

  const handlePromoteModel = async (modelKey: string, kind: 'primary' | 'fallback', value: string) => {
    if (kind === 'primary') {
      try {
        await onSetDefaultSilently();
        toast.success(t('aiProviders.toast.defaultModelUpdated'));
      } catch (error) {
        toast.error(`${t('aiProviders.toast.failedDefault')}: ${error}`);
      }
      return;
    }

    setSaving(true);
    try {
      const fallbackIndex = Number(modelKey.replace('fallback-', ''));
      const nextFallbackModels = fallbackModels.filter((_, index) => index !== fallbackIndex);
      if (accountModel) {
        nextFallbackModels.unshift(accountModel);
      }
      await persistModelChanges(value, nextFallbackModels);
      await onSetDefaultSilently();
      toast.success(t('aiProviders.toast.defaultModelUpdated'));
    } catch (error) {
      toast.error(`${t('aiProviders.toast.failedDefault')}: ${error}`);
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveFallbackModel = async (modelKey: string) => {
    setSaving(true);
    try {
      const fallbackIndex = Number(modelKey.replace('fallback-', ''));
      const nextFallbackModels = fallbackModels.filter((_, index) => index !== fallbackIndex);
      await persistModelChanges(accountModel || undefined, nextFallbackModels);
      toast.success(t('aiProviders.toast.updated'));
    } catch (error) {
      toast.error(`${t('aiProviders.toast.failedUpdate')}: ${error}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className={cn(
        'group flex flex-col rounded-xl bg-black/[0.03] dark:bg-white/[0.04] transition-colors hover:bg-black/[0.05] dark:hover:bg-white/[0.06]',
        isDefault ? 'ring-1 ring-border/60' : '',
      )}
    >
      <div className="px-4 py-3.5 border-b border-border/20">
        <div className="relative flex items-start gap-4">
          <div className="min-w-0 transition-all duration-200 group-hover:pr-36">
            <div className="flex flex-wrap items-center gap-2">
              <span className="block break-all whitespace-normal text-[16px] font-semibold text-foreground transition-all duration-200 group-hover:truncate group-hover:whitespace-nowrap">
                {account.label}
              </span>
              <span className="rounded-full bg-black/[0.04] px-2 py-0.5 text-[10px] font-medium text-muted-foreground dark:bg-white/[0.08]">
                {getAuthModeLabel(account.authMode, t)}
              </span>
              {isDefault && (
                <span className="rounded-full bg-black/[0.04] px-2 py-0.5 text-[10px] font-medium text-foreground/70 dark:bg-white/[0.08]">
                  {t('aiProviders.card.default')}
                </span>
              )}
            </div>
            <p className="mt-1 truncate text-[12px] text-muted-foreground">
              {resolvedBaseUrl}
            </p>
          </div>

          {!isEditing && (
            <div className="absolute right-0 top-0 flex items-center gap-2 opacity-0 pointer-events-none translate-y-1 transition-all duration-200 group-hover:opacity-100 group-hover:pointer-events-auto group-hover:translate-y-0">
              <Button
                variant="outline"
                className="h-7 rounded-full px-3 text-[11px] font-medium"
                onClick={() => setAddingModel((current) => !current)}
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                {t('aiProviders.layout.addModel')}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10"
                onClick={onEdit}
                title={t('aiProviders.card.editKey')}
              >
                <Edit className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-full text-muted-foreground hover:text-destructive hover:bg-black/5 dark:hover:bg-white/10"
                onClick={onDelete}
                title={t('aiProviders.card.delete')}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </div>

      {!isEditing && (
        <div className="space-y-4 p-4">
          {addingModel && (
            <div className="rounded-lg border border-dashed border-border/30 bg-black/[0.02] p-4 dark:bg-white/[0.03]">
              <div className="flex flex-col gap-3 md:flex-row">
                <Input
                  value={newModelValue}
                  onChange={(e) => setNewModelValue(e.target.value)}
                  placeholder={typeInfo?.modelIdPlaceholder || 'provider/model-id'}
                  className="flex-1"
                />
                <div className="flex gap-2">
                  <Button
                    onClick={() => void handleAddModel()}
                    disabled={!newModelValue.trim() || saving}
                    className="h-10 rounded-full px-5"
                  >
                    {t('aiProviders.dialog.add')}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setAddingModel(false);
                      setNewModelValue('');
                    }}
                    className="h-10 rounded-full px-5"
                  >
                    {t('aiProviders.dialog.cancel')}
                  </Button>
                </div>
              </div>
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-2">
            {modelEntries.length > 0 ? modelEntries.map((entry) => {
              const isEditingThisModel = editingModelKey === entry.key;
              const isDefaultModel = isDefault && entry.kind === 'primary';

              return (
                <div
                  key={entry.key}
                  className={cn(
                    'group/model rounded-lg bg-black/[0.03] dark:bg-white/[0.04] p-4 transition-colors hover:bg-black/[0.05] dark:hover:bg-white/[0.06]',
                    isDefaultModel ? 'ring-1 ring-border/60' : '',
                  )}
                >
                  <div className="relative flex items-start gap-3">
                    <div className="flex min-w-0 items-center gap-3 transition-all duration-200 group-hover/model:pr-24">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-black/[0.04] dark:bg-white/[0.06]">
                        {getProviderIconUrl(account.vendorId) ? (
                          <img
                            src={getProviderIconUrl(account.vendorId)}
                            alt={entry.value}
                            className={cn('h-6 w-6', shouldInvertInDark(account.vendorId) && 'dark:invert')}
                          />
                        ) : (
                          <span className="text-xl">{typeInfo?.icon || '⚙️'}</span>
                        )}
                      </div>
                      <div className="min-w-0">
                        {isEditingThisModel ? (
                          <Input
                            value={editingModelValue}
                            onChange={(e) => setEditingModelValue(e.target.value)}
                            className="h-9 text-[13px]"
                          />
                        ) : (
                          <p className="break-all whitespace-normal text-[14px] font-semibold text-foreground transition-all duration-200 group-hover/model:truncate group-hover/model:whitespace-nowrap">
                            {entry.value}
                          </p>
                        )}
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          {entry.kind === 'primary' && (
                            <span className="rounded-full bg-black/[0.04] px-2 py-0.5 text-[10px] font-medium text-muted-foreground dark:bg-white/[0.08]">
                              Primary
                            </span>
                          )}
                          {isDefaultModel && (
                            <span className="rounded-full bg-black/[0.04] px-2 py-0.5 text-[10px] font-medium text-foreground/70 dark:bg-white/[0.08]">
                              {t('aiProviders.card.default')}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className={cn(
                      'absolute right-0 top-0 flex items-center gap-1 translate-y-1 transition-all duration-200',
                      isEditingThisModel
                        ? 'opacity-100 pointer-events-auto translate-y-0'
                        : 'opacity-0 pointer-events-none group-hover/model:opacity-100 group-hover/model:pointer-events-auto group-hover/model:translate-y-0',
                    )}>
                      {isEditingThisModel ? (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 rounded-full"
                            onClick={() => void handleEditModelSave(entry.key, entry.kind)}
                            disabled={!editingModelValue.trim() || saving}
                          >
                            <Check className="h-4 w-4 text-green-500" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 rounded-full"
                            onClick={handleEditModelCancel}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </>
                      ) : (
                        <>
                          {!isDefaultModel && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 rounded-full text-muted-foreground hover:text-blue-600 hover:bg-white dark:hover:bg-card"
                              onClick={() => void handlePromoteModel(entry.key, entry.kind, entry.value)}
                              title={t('aiProviders.card.setDefault')}
                            >
                              <Check className="h-4 w-4" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-white dark:hover:bg-card"
                            onClick={() => handleEditModelStart(entry.key, entry.value)}
                            title={t('aiProviders.card.editKey')}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          {entry.kind === 'fallback' && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 rounded-full text-muted-foreground hover:text-destructive hover:bg-white dark:hover:bg-card"
                              onClick={() => void handleRemoveFallbackModel(entry.key)}
                              title={t('aiProviders.card.delete')}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            }) : (
              <div className="rounded-lg border border-dashed border-border/30 bg-black/[0.02] p-5 text-sm text-muted-foreground dark:bg-white/[0.03]">
                {t('aiProviders.overview.noModelSelected')}
              </div>
            )}
          </div>
        </div>
      )}

      {isEditing && (
        <div className="space-y-6 mt-4 pt-4 border-t border-black/5 dark:border-white/5">
          {canEditConnectionConfig && (
            <div className="space-y-3">
              <p className={currentSectionLabelClasses}>Connection</p>
              {typeInfo?.showBaseUrl && (
                <div className="space-y-1.5">
                  <Label className={currentLabelClasses}>{t('aiProviders.dialog.baseUrl')}</Label>
                  <Input
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder={getProtocolBaseUrlPlaceholder(apiProtocol)}
                    className={currentInputClasses}
                  />
                </div>
              )}
              {account.vendorId === 'custom' && (
                <div className="space-y-1.5 pt-2">
                  <Label className={currentLabelClasses}>{t('aiProviders.dialog.protocol', 'Protocol')}</Label>
                  <div className="flex gap-2 text-[13px]">
                    <button
                      type="button"
                      onClick={() => setApiProtocol('openai-completions')}
                      className={cn("flex-1 py-1.5 px-3 rounded-lg border transition-colors", apiProtocol === 'openai-completions' ? "bg-foreground/10 text-foreground border-foreground/15 font-medium" : "border-transparent bg-black/5 dark:bg-white/5 text-muted-foreground hover:bg-black/10 dark:hover:bg-white/10")}
                    >
                      {t('aiProviders.protocols.openaiCompletions', 'OpenAI Completions')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setApiProtocol('openai-responses')}
                      className={cn("flex-1 py-1.5 px-3 rounded-lg border transition-colors", apiProtocol === 'openai-responses' ? "bg-foreground/10 text-foreground border-foreground/15 font-medium" : "border-transparent bg-black/5 dark:bg-white/5 text-muted-foreground hover:bg-black/10 dark:hover:bg-white/10")}
                    >
                      {t('aiProviders.protocols.openaiResponses', 'OpenAI Responses')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setApiProtocol('anthropic-messages')}
                      className={cn("flex-1 py-1.5 px-3 rounded-lg border transition-colors", apiProtocol === 'anthropic-messages' ? "bg-foreground/10 text-foreground border-foreground/15 font-medium" : "border-transparent bg-black/5 dark:bg-white/5 text-muted-foreground hover:bg-black/10 dark:hover:bg-white/10")}
                    >
                      {t('aiProviders.protocols.anthropic', 'Anthropic')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          <div className="space-y-3">
            <button
              onClick={() => setShowFallback(!showFallback)}
              className="flex items-center justify-between w-full text-[14px] font-bold text-foreground/80 hover:text-foreground transition-colors"
            >
              <span>{t('aiProviders.sections.fallback')}</span>
              <ChevronDown className={cn("h-4 w-4 transition-transform", showFallback && "rotate-180")} />
            </button>
            {showFallback && (
              <div className="space-y-3 pt-2">
                <div className="space-y-2 pt-1">
                  <Label className={currentLabelClasses}>{t('aiProviders.dialog.fallbackProviders')}</Label>
                  {fallbackOptions.length === 0 ? (
                    <p className="text-[13px] text-muted-foreground">{t('aiProviders.dialog.noFallbackOptions')}</p>
                  ) : (
                    <div className={cn("space-y-2 rounded-xl border border-border/30 p-3", isDefault ? "bg-white dark:bg-card" : "bg-black/[0.03] dark:bg-white/[0.04]")}>
                      {fallbackOptions.map((candidate) => (
                        <label key={candidate.account.id} className="flex items-center gap-3 text-[13px] cursor-pointer group/label">
                          <input
                            type="checkbox"
                            checked={fallbackProviderIds.includes(candidate.account.id)}
                            onChange={() => toggleFallbackProvider(candidate.account.id)}
                            className="rounded border-black/20 dark:border-white/20 text-blue-500 focus:ring-blue-500/50"
                          />
                          <span className="font-medium group-hover/label:text-blue-500 transition-colors">{candidate.account.label}</span>
                          <span className="text-[12px] text-muted-foreground">
                            {candidate.account.model || candidate.vendor?.name || candidate.account.vendorId}
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <Label className={currentSectionLabelClasses}>{t('aiProviders.dialog.apiKey')}</Label>
                <p className="text-[12px] text-muted-foreground">
                  {hasConfiguredCredentials(account, status)
                    ? t('aiProviders.dialog.apiKeyConfigured')
                    : t('aiProviders.dialog.apiKeyMissing')}
                </p>
              </div>
              {hasConfiguredCredentials(account, status) ? (
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-green-600 dark:text-green-500 bg-green-500/10 px-2 py-1 rounded-md">
                  <div className="w-1.5 h-1.5 rounded-full bg-current" />
                  {t('aiProviders.card.configured')}
                </div>
              ) : null}
            </div>
            {typeInfo?.apiKeyUrl && (
              <div className="flex justify-start">
                <a
                  href={typeInfo.apiKeyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[13px] text-blue-500 hover:text-blue-600 hover:underline flex items-center gap-1"
                  tabIndex={-1}
                >
                  {t('aiProviders.oauth.getApiKey')} <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )}
            <div className="space-y-1.5 pt-1">
              <Label className={currentLabelClasses}>{t('aiProviders.dialog.replaceApiKey')}</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    type={showKey ? 'text' : 'password'}
                    placeholder={typeInfo?.requiresApiKey ? typeInfo?.placeholder : (typeInfo?.id === 'ollama' ? t('aiProviders.notRequired') : t('aiProviders.card.editKey'))}
                    value={newKey}
                    onChange={(e) => setNewKey(e.target.value)}
                    className={cn(currentInputClasses, 'pr-10')}
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <Button
                  variant="outline"
                  onClick={handleSaveEdits}
                  className={cn(
                    "rounded-lg px-4 border-border/40",
                    isDefault
                      ? "h-[40px] bg-white dark:bg-card hover:bg-black/5 dark:hover:bg-white/10"
                      : "h-9 bg-black/[0.03] dark:bg-white/[0.04] hover:bg-black/[0.05] dark:hover:bg-white/[0.06]"
                  )}
                  disabled={
                    validating
                    || saving
                    || (
                      !newKey.trim()
                      && (baseUrl.trim() || undefined) === (account.baseUrl || undefined)
                      && fallbackProviderIdsEqual(fallbackProviderIds, account.fallbackAccountIds)
                    )
                  }
                >
                  {validating || saving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4 text-green-500" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  onClick={onCancelEdit}
                  className={cn(
                    "p-0 rounded-xl",
                    isDefault
                      ? "h-[40px] w-[40px] hover:bg-black/5 dark:hover:bg-white/10"
                      : "h-9 w-9 bg-black/[0.03] dark:bg-white/[0.04] border border-border/40 hover:bg-black/[0.05] dark:hover:bg-white/[0.06] text-muted-foreground hover:text-foreground"
                  )}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-[12px] text-muted-foreground">
                {t('aiProviders.dialog.replaceApiKeyHelp')}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EditProviderDialog({
  item,
  allProviders,
  isDefault,
  onClose,
  onSaveEdits,
  onValidateKey,
}: {
  item: ProviderListItem;
  allProviders: ProviderListItem[];
  isDefault: boolean;
  onClose: () => void;
  onSaveEdits: (payload: { newApiKey?: string; updates?: Partial<ProviderConfig> }) => Promise<void>;
  onValidateKey: (
    key: string,
    options?: { baseUrl?: string; apiProtocol?: ProviderAccount['apiProtocol'] }
  ) => Promise<{ valid: boolean; error?: string }>;
}) {
  const { t } = useTranslation('settings');
  const { account, status } = item;
  const [newKey, setNewKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(account.baseUrl || '');
  const [apiProtocol, setApiProtocol] = useState<ProviderAccount['apiProtocol']>(account.apiProtocol || 'openai-completions');
  const [fallbackProviderIds, setFallbackProviderIds] = useState<string[]>(
    normalizeFallbackProviderIds(account.fallbackAccountIds)
  );
  const [showKey, setShowKey] = useState(false);
  const [showFallback, setShowFallback] = useState(false);
  const [validating, setValidating] = useState(false);
  const [saving, setSaving] = useState(false);

  const typeInfo = PROVIDER_TYPE_INFO.find((entry) => entry.id === account.vendorId);
  const fallbackOptions = allProviders.filter((candidate) => candidate.account.id !== account.id);

  const toggleFallbackProvider = (providerId: string) => {
    setFallbackProviderIds((current) => (
      current.includes(providerId)
        ? current.filter((id) => id !== providerId)
        : [...current, providerId]
    ));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: { newApiKey?: string; updates?: Partial<ProviderConfig> } = {};

      if (newKey.trim()) {
        setValidating(true);
        const result = await onValidateKey(newKey, {
          baseUrl: baseUrl.trim() || undefined,
          apiProtocol: (account.vendorId === 'custom' || account.vendorId === 'ollama') ? apiProtocol : undefined,
        });
        setValidating(false);
        if (!result.valid) {
          setSaving(false);
          toast.error(result.error || t('aiProviders.toast.invalidKey'));
          return;
        }
        payload.newApiKey = newKey.trim();
      }

      const updates: Partial<ProviderConfig> = {};
      if (typeInfo?.showBaseUrl && (baseUrl.trim() || undefined) !== (account.baseUrl || undefined)) {
        updates.baseUrl = baseUrl.trim() || undefined;
      }
      if ((account.vendorId === 'custom' || account.vendorId === 'ollama') && apiProtocol !== account.apiProtocol) {
        updates.apiProtocol = apiProtocol;
      }
      if (!fallbackProviderIdsEqual(fallbackProviderIds, account.fallbackAccountIds)) {
        updates.fallbackProviderIds = normalizeFallbackProviderIds(fallbackProviderIds);
      }
      if (Object.keys(updates).length > 0) {
        payload.updates = updates;
      }

      if (account.vendorId === 'ollama' && !status?.hasKey && !payload.newApiKey) {
        payload.newApiKey = resolveProviderApiKeyForSave(account.vendorId, '') as string;
      }

      if (!payload.newApiKey && !payload.updates) {
        onClose();
        return;
      }

      await onSaveEdits(payload);
      toast.success(t('aiProviders.toast.updated'));
    } catch (error) {
      toast.error(`${t('aiProviders.toast.failedUpdate')}: ${error}`);
      setSaving(false);
      return;
    } finally {
      setSaving(false);
      setValidating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-xl border-0 shadow-2xl bg-background overflow-hidden">
        <CardHeader className="relative pb-2">
          <CardTitle className="text-2xl font-serif font-normal tracking-tight">
            {t('aiProviders.layout.editConnectionTitle')}
          </CardTitle>
          <CardDescription className="text-[15px] mt-1 text-foreground/70">
            {t('aiProviders.layout.editConnectionDesc', { name: account.label })}
          </CardDescription>
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-4 top-4 rounded-full h-8 w-8 -mr-2 -mt-2 text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="overflow-y-auto flex-1 p-6 space-y-6">
          <div className="rounded-lg bg-black/[0.02] dark:bg-white/[0.03] border border-border/20 p-4">
            <p className="text-[15px] font-semibold text-foreground">{account.label}</p>
            <p className="text-[13px] text-muted-foreground mt-1">{account.baseUrl || typeInfo?.defaultBaseUrl || '--'}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="rounded-full bg-black/[0.04] px-2 py-0.5 text-[10px] font-medium text-muted-foreground dark:bg-white/[0.08]">
                {getAuthModeLabel(account.authMode, t)}
              </span>
              {isDefault && (
                <span className="rounded-full bg-black/[0.04] px-2 py-0.5 text-[10px] font-medium text-foreground/70 dark:bg-white/[0.08]">
                  {t('aiProviders.card.default')}
                </span>
              )}
            </div>
          </div>

          {(typeInfo?.showBaseUrl || account.vendorId === 'custom') && (
            <div className="space-y-3">
              <p className={labelClasses}>Connection</p>
              {typeInfo?.showBaseUrl && (
                <div className="space-y-1.5">
                  <Label className={labelClasses}>{t('aiProviders.dialog.baseUrl')}</Label>
                  <Input
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder={getProtocolBaseUrlPlaceholder(apiProtocol)}
                    className={inputClasses}
                  />
                </div>
              )}
              {account.vendorId === 'custom' && (
                <div className="space-y-1.5 pt-2">
                  <Label className={labelClasses}>{t('aiProviders.dialog.protocol', 'Protocol')}</Label>
                  <div className="flex gap-2 text-[13px]">
                    <button
                      type="button"
                      onClick={() => setApiProtocol('openai-completions')}
                      className={cn("flex-1 py-1.5 px-3 rounded-lg border transition-colors", apiProtocol === 'openai-completions' ? "bg-foreground/10 text-foreground border-foreground/15 font-medium" : "border-transparent bg-black/5 dark:bg-white/5 text-muted-foreground hover:bg-black/10 dark:hover:bg-white/10")}
                    >
                      {t('aiProviders.protocols.openaiCompletions', 'OpenAI Completions')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setApiProtocol('openai-responses')}
                      className={cn("flex-1 py-1.5 px-3 rounded-lg border transition-colors", apiProtocol === 'openai-responses' ? "bg-foreground/10 text-foreground border-foreground/15 font-medium" : "border-transparent bg-black/5 dark:bg-white/5 text-muted-foreground hover:bg-black/10 dark:hover:bg-white/10")}
                    >
                      {t('aiProviders.protocols.openaiResponses', 'OpenAI Responses')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setApiProtocol('anthropic-messages')}
                      className={cn("flex-1 py-1.5 px-3 rounded-lg border transition-colors", apiProtocol === 'anthropic-messages' ? "bg-foreground/10 text-foreground border-foreground/15 font-medium" : "border-transparent bg-black/5 dark:bg-white/5 text-muted-foreground hover:bg-black/10 dark:hover:bg-white/10")}
                    >
                      {t('aiProviders.protocols.anthropic', 'Anthropic')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="space-y-3">
            <button
              onClick={() => setShowFallback(!showFallback)}
              className="flex items-center justify-between w-full text-[14px] font-bold text-foreground/80 hover:text-foreground transition-colors"
            >
              <span>{t('aiProviders.sections.fallback')}</span>
              <ChevronDown className={cn("h-4 w-4 transition-transform", showFallback && "rotate-180")} />
            </button>
            {showFallback && (
              <div className="space-y-3 pt-2">
                <div className="space-y-2 pt-1">
                  <Label className={labelClasses}>{t('aiProviders.dialog.fallbackProviders')}</Label>
                  {fallbackOptions.length === 0 ? (
                    <p className="text-[13px] text-muted-foreground">{t('aiProviders.dialog.noFallbackOptions')}</p>
                  ) : (
                    <div className="space-y-2 rounded-xl border border-border/30 p-3 bg-black/[0.03] dark:bg-white/[0.04]">
                      {fallbackOptions.map((candidate) => (
                        <label key={candidate.account.id} className="flex items-center gap-3 text-[13px] cursor-pointer group/label">
                          <input
                            type="checkbox"
                            checked={fallbackProviderIds.includes(candidate.account.id)}
                            onChange={() => toggleFallbackProvider(candidate.account.id)}
                            className="rounded border-black/20 dark:border-white/20 text-blue-500 focus:ring-blue-500/50"
                          />
                          <span className="font-medium group-hover/label:text-blue-500 transition-colors">{candidate.account.label}</span>
                          <span className="text-[12px] text-muted-foreground">
                            {candidate.account.model || candidate.vendor?.name || candidate.account.vendorId}
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <Label className={labelClasses}>{t('aiProviders.dialog.apiKey')}</Label>
                <p className="text-[12px] text-muted-foreground">
                  {hasConfiguredCredentials(account, status)
                    ? t('aiProviders.dialog.apiKeyConfigured')
                    : t('aiProviders.dialog.apiKeyMissing')}
                </p>
              </div>
              {hasConfiguredCredentials(account, status) ? (
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-green-600 dark:text-green-500 bg-green-500/10 px-2 py-1 rounded-md">
                  <div className="w-1.5 h-1.5 rounded-full bg-current" />
                  {t('aiProviders.card.configured')}
                </div>
              ) : null}
            </div>
            {typeInfo?.apiKeyUrl && (
              <div className="flex justify-start">
                <a
                  href={typeInfo.apiKeyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[13px] text-blue-500 hover:text-blue-600 hover:underline flex items-center gap-1"
                  tabIndex={-1}
                >
                  {t('aiProviders.oauth.getApiKey')} <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )}
            <div className="space-y-1.5 pt-1">
              <Label className={labelClasses}>{t('aiProviders.dialog.replaceApiKey')}</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    type={showKey ? 'text' : 'password'}
                    placeholder={typeInfo?.requiresApiKey ? typeInfo?.placeholder : (typeInfo?.id === 'ollama' ? t('aiProviders.notRequired') : t('aiProviders.card.editKey'))}
                    value={newKey}
                    onChange={(e) => setNewKey(e.target.value)}
                    className={cn(inputClasses, 'pr-10')}
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <p className="text-[12px] text-muted-foreground">
                {t('aiProviders.dialog.replaceApiKeyHelp')}
              </p>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={onClose}
              className="h-8 text-xs font-medium rounded-full px-3"
            >
              {t('common:actions.cancel')}
            </Button>
            <Button
              onClick={() => void handleSave()}
              disabled={saving || validating}
              className="h-9 text-[13px] font-medium rounded-full px-4 shadow-none"
            >
              {saving || validating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {t('aiProviders.dialog.save')}
                </>
              ) : (
                t('aiProviders.dialog.save')
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

interface AddProviderDialogProps {
  initialSelectedType?: ProviderType | null;
  existingVendorIds: Set<string>;
  vendors: ProviderVendorInfo[];
  onClose: () => void;
  onAdd: (
    type: ProviderType,
    name: string,
    apiKey: string,
    options?: { baseUrl?: string; model?: string; authMode?: ProviderAccount['authMode']; apiProtocol?: ProviderAccount['apiProtocol'] }
  ) => Promise<void>;
  onValidateKey: (
    type: string,
    apiKey: string,
    options?: { baseUrl?: string; apiProtocol?: ProviderAccount['apiProtocol'] }
  ) => Promise<{ valid: boolean; error?: string }>;
  devModeUnlocked: boolean;
}

function AddProviderDialog({
  initialSelectedType = null,
  existingVendorIds,
  vendors,
  onClose,
  onAdd,
  onValidateKey,
  devModeUnlocked,
}: AddProviderDialogProps) {
  const { t } = useTranslation('settings');
  const [selectedType, setSelectedType] = useState<ProviderType | null>(initialSelectedType);
  const [name, setName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [modelId, setModelId] = useState('');
  const [apiProtocol, setApiProtocol] = useState<ProviderAccount['apiProtocol']>('openai-completions');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  // OAuth Flow State
  const [oauthFlowing, setOauthFlowing] = useState(false);
  const [oauthData, setOauthData] = useState<{
    mode: 'device';
    verificationUri: string;
    userCode: string;
    expiresIn: number;
  } | {
    mode: 'manual';
    authorizationUrl: string;
    message?: string;
  } | null>(null);
  const [manualCodeInput, setManualCodeInput] = useState('');
  const [oauthError, setOauthError] = useState<string | null>(null);
  // For providers that support both OAuth and API key, let the user choose.
  // Default to the vendor's declared auth mode instead of hard-coding OAuth.
  const [authMode, setAuthMode] = useState<'oauth' | 'apikey'>('apikey');

  const typeInfo = PROVIDER_TYPE_INFO.find((t) => t.id === selectedType);
  const showModelIdField = shouldShowProviderModelId(typeInfo, devModeUnlocked);
  const isOAuth = typeInfo?.isOAuth ?? false;
  const supportsApiKey = typeInfo?.supportsApiKey ?? false;
  const vendorMap = new Map(vendors.map((vendor) => [vendor.id, vendor]));
  const selectedVendor = selectedType ? vendorMap.get(selectedType) : undefined;
  const preferredOAuthMode = selectedVendor?.supportedAuthModes.includes('oauth_browser')
    ? 'oauth_browser'
    : (selectedVendor?.supportedAuthModes.includes('oauth_device')
      ? 'oauth_device'
      : (selectedType === 'google' ? 'oauth_browser' : null));
  // Effective OAuth mode: pure OAuth providers, or dual-mode with oauth selected
  const useOAuthFlow = isOAuth && (!supportsApiKey || authMode === 'oauth');

  useEffect(() => {
    if (!selectedVendor || !isOAuth || !supportsApiKey) {
      return;
    }
    setAuthMode(selectedVendor.defaultAuthMode === 'api_key' ? 'apikey' : 'oauth');
  }, [selectedVendor, isOAuth, supportsApiKey]);

  useEffect(() => {
    setSelectedType(initialSelectedType);
    if (!initialSelectedType) {
      setName('');
      setApiKey('');
      setBaseUrl('');
      setModelId('');
      setApiProtocol('openai-completions');
      setValidationError(null);
      return;
    }

    const initialInfo = PROVIDER_TYPE_INFO.find((entry) => entry.id === initialSelectedType);
    setName(initialInfo?.id === 'custom' ? t('aiProviders.custom') : (initialInfo?.name || ''));
    setApiKey('');
    setBaseUrl(initialInfo?.defaultBaseUrl || '');
    setModelId(initialInfo?.defaultModelId || '');
    setApiProtocol('openai-completions');
    setValidationError(null);
  }, [initialSelectedType, t]);

  // Keep refs to the latest values so event handlers see the current dialog state.
  const latestRef = React.useRef({ selectedType, typeInfo, onAdd, onClose, t });
  const pendingOAuthRef = React.useRef<{ accountId: string; label: string } | null>(null);
  useEffect(() => {
    latestRef.current = { selectedType, typeInfo, onAdd, onClose, t };
  });

  // Manage OAuth events
  useEffect(() => {
    const handleCode = (data: unknown) => {
      const payload = data as Record<string, unknown>;
      if (payload?.mode === 'manual') {
        setOauthData({
          mode: 'manual',
          authorizationUrl: String(payload.authorizationUrl || ''),
          message: typeof payload.message === 'string' ? payload.message : undefined,
        });
      } else {
        setOauthData({
          mode: 'device',
          verificationUri: String(payload.verificationUri || ''),
          userCode: String(payload.userCode || ''),
          expiresIn: Number(payload.expiresIn || 300),
        });
      }
      setOauthError(null);
    };

    const handleSuccess = async (data: unknown) => {
      setOauthFlowing(false);
      setOauthData(null);
      setManualCodeInput('');
      setValidationError(null);

      const { onClose: close, t: translate } = latestRef.current;
      const payload = (data as { accountId?: string } | undefined) || undefined;
      const accountId = payload?.accountId || pendingOAuthRef.current?.accountId;

      // device-oauth.ts already saved the provider config to the backend,
      // including the dynamically resolved baseUrl for the region (e.g. CN vs Global).
      // If we call add() here with undefined baseUrl, it will overwrite and erase it!
      // So we just fetch the latest list from the backend to update the UI.
      try {
        const store = useProviderStore.getState();
        await store.refreshProviderSnapshot();

        // OAuth sign-in should immediately become active default to avoid
        // leaving runtime on an API-key-only provider/model.
        if (accountId) {
          await store.setDefaultAccount(accountId);
        }
      } catch (err) {
        console.error('Failed to refresh providers after OAuth:', err);
      }

      pendingOAuthRef.current = null;
      close();
      toast.success(translate('aiProviders.toast.added'));
    };

    const handleError = (data: unknown) => {
      setOauthError((data as { message: string }).message);
      setOauthData(null);
      pendingOAuthRef.current = null;
    };

    const offCode = subscribeHostEvent('oauth:code', handleCode);
    const offSuccess = subscribeHostEvent('oauth:success', handleSuccess);
    const offError = subscribeHostEvent('oauth:error', handleError);

    return () => {
      offCode();
      offSuccess();
      offError();
    };
  }, []);

  const handleStartOAuth = async () => {
    if (!selectedType) return;

    if (selectedType === 'minimax-portal' && existingVendorIds.has('minimax-portal-cn')) {
      toast.error(t('aiProviders.toast.minimaxConflict'));
      return;
    }
    if (selectedType === 'minimax-portal-cn' && existingVendorIds.has('minimax-portal')) {
      toast.error(t('aiProviders.toast.minimaxConflict'));
      return;
    }

    setOauthFlowing(true);
    setOauthData(null);
    setManualCodeInput('');
    setOauthError(null);

    try {
      const vendor = vendorMap.get(selectedType);
      const supportsMultipleAccounts = vendor?.supportsMultipleAccounts ?? selectedType === 'custom';
      const accountId = supportsMultipleAccounts ? `${selectedType}-${crypto.randomUUID()}` : selectedType;
      const label = name || (typeInfo?.id === 'custom' ? t('aiProviders.custom') : typeInfo?.name) || selectedType;
      pendingOAuthRef.current = { accountId, label };
      await hostApiFetch('/api/providers/oauth/start', {
        method: 'POST',
        body: JSON.stringify({ provider: selectedType, accountId, label }),
      });
    } catch (e) {
      setOauthError(String(e));
      setOauthFlowing(false);
      pendingOAuthRef.current = null;
    }
  };

  const handleCancelOAuth = async () => {
    setOauthFlowing(false);
    setOauthData(null);
    setManualCodeInput('');
    setOauthError(null);
    pendingOAuthRef.current = null;
    await hostApiFetch('/api/providers/oauth/cancel', {
      method: 'POST',
    });
  };

  const handleSubmitManualOAuthCode = async () => {
    const value = manualCodeInput.trim();
    if (!value) return;
    try {
      await hostApiFetch('/api/providers/oauth/submit', {
        method: 'POST',
        body: JSON.stringify({ code: value }),
      });
      setOauthError(null);
    } catch (error) {
      setOauthError(String(error));
    }
  };

  const availableTypes = PROVIDER_TYPE_INFO.filter((type) => {
    const vendor = vendorMap.get(type.id);
    if (!vendor) {
      return !existingVendorIds.has(type.id) || type.id === 'custom';
    }
    return vendor.supportsMultipleAccounts || !existingVendorIds.has(type.id);
  });

  const handleAdd = async () => {
    if (!selectedType) return;

    if (selectedType === 'minimax-portal' && existingVendorIds.has('minimax-portal-cn')) {
      toast.error(t('aiProviders.toast.minimaxConflict'));
      return;
    }
    if (selectedType === 'minimax-portal-cn' && existingVendorIds.has('minimax-portal')) {
      toast.error(t('aiProviders.toast.minimaxConflict'));
      return;
    }

    setSaving(true);
    setValidationError(null);

    try {
      // Validate key first if the provider requires one and a key was entered
      const requiresKey = typeInfo?.requiresApiKey ?? false;
      if (requiresKey && !apiKey.trim()) {
        setValidationError(t('aiProviders.toast.invalidKey')); // reusing invalid key msg or should add 'required' msg? null checks
        setSaving(false);
        return;
      }
      if (requiresKey && apiKey) {
        const result = await onValidateKey(selectedType, apiKey, {
          baseUrl: baseUrl.trim() || undefined,
          apiProtocol: (selectedType === 'custom' || selectedType === 'ollama') ? apiProtocol : undefined,
        });
        if (!result.valid) {
          setValidationError(result.error || t('aiProviders.toast.invalidKey'));
          setSaving(false);
          return;
        }
      }

      const requiresModel = showModelIdField;
      if (requiresModel && !modelId.trim()) {
        setValidationError(t('aiProviders.toast.modelRequired'));
        setSaving(false);
        return;
      }

      await onAdd(
        selectedType,
        name || (typeInfo?.id === 'custom' ? t('aiProviders.custom') : typeInfo?.name) || selectedType,
        apiKey.trim(),
        {
          baseUrl: baseUrl.trim() || undefined,
          apiProtocol: (selectedType === 'custom' || selectedType === 'ollama') ? apiProtocol : undefined,
          model: resolveProviderModelForSave(typeInfo, modelId, devModeUnlocked),
          authMode: useOAuthFlow ? (preferredOAuthMode || 'oauth_device') : selectedType === 'ollama'
            ? 'local'
            : (isOAuth && supportsApiKey && authMode === 'apikey')
              ? 'api_key'
              : vendorMap.get(selectedType)?.defaultAuthMode || 'api_key',
        }
      );
    } catch {
      // error already handled via toast in parent
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-xl border-0 shadow-2xl bg-background overflow-hidden">
        <CardHeader className="relative pb-2 shrink-0">
          <CardTitle className="text-2xl font-serif font-normal">{t('aiProviders.dialog.title')}</CardTitle>
          <CardDescription className="text-[15px] mt-1 text-foreground/70">
            {t('aiProviders.dialog.desc')}
          </CardDescription>
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-4 top-4 rounded-full h-8 w-8 -mr-2 -mt-2 text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="overflow-y-auto flex-1 p-6">
          {!selectedType ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {availableTypes.map((type) => (
                <button
                  key={type.id}
                  onClick={() => {
                    setSelectedType(type.id);
                    setName(type.id === 'custom' ? t('aiProviders.custom') : type.name);
                    setBaseUrl(type.defaultBaseUrl || '');
                    setModelId(type.defaultModelId || '');
                  }}
                  className="p-4 rounded-lg bg-black/[0.03] dark:bg-white/[0.04] hover:bg-black/[0.05] dark:hover:bg-white/[0.06] transition-colors text-center group"
                >
                  <div className="h-10 w-10 mx-auto mb-3 flex items-center justify-center bg-black/[0.04] dark:bg-white/[0.06] rounded-lg">
                    {getProviderIconUrl(type.id) ? (
                      <img src={getProviderIconUrl(type.id)} alt={type.name} className={cn('h-6 w-6', shouldInvertInDark(type.id) && 'dark:invert')} />
                    ) : (
                      <span className="text-2xl">{type.icon}</span>
                    )}
                  </div>
                  <p className="font-medium text-[13px]">{type.id === 'custom' ? t('aiProviders.custom') : type.name}</p>
                </button>
              ))}
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex items-center gap-3 p-4 rounded-lg bg-black/[0.03] dark:bg-white/[0.04]">
                <div className="h-10 w-10 shrink-0 flex items-center justify-center bg-black/5 dark:bg-white/5 rounded-xl">
                  {getProviderIconUrl(selectedType!) ? (
                    <img src={getProviderIconUrl(selectedType!)} alt={typeInfo?.name} className={cn('h-6 w-6', shouldInvertInDark(selectedType!) && 'dark:invert')} />
                  ) : (
                    <span className="text-xl">{typeInfo?.icon}</span>
                  )}
                </div>
                <div>
                  <p className="font-semibold text-[15px]">{typeInfo?.id === 'custom' ? t('aiProviders.custom') : typeInfo?.name}</p>
                </div>
              </div>

              <div className="space-y-6 bg-transparent p-0">
                <div className="space-y-2.5">
                  <Label htmlFor="name" className={labelClasses}>{t('aiProviders.dialog.displayName')}</Label>
                  <Input
                    id="name"
                    placeholder={t('aiProviders.dialog.modelNamePlaceholder', {
                      name: typeInfo?.id === 'custom' ? t('aiProviders.custom') : typeInfo?.name,
                    })}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className={inputClasses}
                  />
                </div>

                {/* Auth mode toggle for providers supporting both */}
                {isOAuth && supportsApiKey && (
                  <div className="flex rounded-lg bg-black/[0.03] dark:bg-white/[0.04] overflow-hidden text-[13px] font-medium p-1 gap-1">
                    <button
                      onClick={() => setAuthMode('oauth')}
                      className={cn(
                        'flex-1 py-2 px-3 rounded-lg transition-colors',
                        authMode === 'oauth' ? 'bg-black/5 dark:bg-white/10 text-foreground' : 'text-muted-foreground hover:bg-black/5 dark:hover:bg-white/5'
                      )}
                    >
                      {t('aiProviders.oauth.loginMode')}
                    </button>
                    <button
                      onClick={() => setAuthMode('apikey')}
                      className={cn(
                        'flex-1 py-2 px-3 rounded-lg transition-colors',
                        authMode === 'apikey' ? 'bg-black/5 dark:bg-white/10 text-foreground' : 'text-muted-foreground hover:bg-black/5 dark:hover:bg-white/5'
                      )}
                    >
                      {t('aiProviders.oauth.apikeyMode')}
                    </button>
                  </div>
                )}

                {/* API Key input — shown for non-OAuth providers or when apikey mode is selected */}
                {(!isOAuth || (supportsApiKey && authMode === 'apikey')) && (
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="apiKey" className={labelClasses}>{t('aiProviders.dialog.apiKey')}</Label>
                      {typeInfo?.apiKeyUrl && (
                        <a
                          href={typeInfo.apiKeyUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[13px] text-blue-500 hover:text-blue-600 font-medium flex items-center gap-1"
                          tabIndex={-1}
                        >
                          {t('aiProviders.oauth.getApiKey')} <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                    <div className="relative">
                      <Input
                        id="apiKey"
                        type={showKey ? 'text' : 'password'}
                        placeholder={typeInfo?.id === 'ollama' ? t('aiProviders.notRequired') : typeInfo?.placeholder}
                        value={apiKey}
                        onChange={(e) => {
                          setApiKey(e.target.value);
                          setValidationError(null);
                        }}
                        className={inputClasses}
                      />
                      <button
                        type="button"
                        onClick={() => setShowKey(!showKey)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    {validationError && (
                      <p className="text-[13px] text-red-500 font-medium">{validationError}</p>
                    )}
                    <p className="text-[12px] text-muted-foreground">
                      {t('aiProviders.dialog.apiKeyStored')}
                    </p>
                  </div>
                )}

                {typeInfo?.showBaseUrl && (
                  <div className="space-y-2.5">
                    <Label htmlFor="baseUrl" className={labelClasses}>{t('aiProviders.dialog.baseUrl')}</Label>
                    <Input
                      id="baseUrl"
                      placeholder={getProtocolBaseUrlPlaceholder(apiProtocol)}
                      value={baseUrl}
                      onChange={(e) => setBaseUrl(e.target.value)}
                      className={inputClasses}
                    />
                  </div>
                )}

                {showModelIdField && (
                  <div className="space-y-2.5">
                    <Label htmlFor="modelId" className={labelClasses}>{t('aiProviders.dialog.modelId')}</Label>
                    <Input
                      id="modelId"
                      placeholder={typeInfo?.modelIdPlaceholder || 'provider/model-id'}
                      value={modelId}
                      onChange={(e) => {
                        setModelId(e.target.value);
                        setValidationError(null);
                      }}
                      className={inputClasses}
                    />
                  </div>
                )}
                {selectedType === 'custom' && (
                <div className="space-y-2.5">
                  <Label className={labelClasses}>{t('aiProviders.dialog.protocol', 'Protocol')}</Label>
                  <div className="flex gap-2 text-[13px]">
                    <button
                      type="button"
                        onClick={() => setApiProtocol('openai-completions')}
                        className={cn("flex-1 py-1.5 px-3 rounded-lg border transition-colors", apiProtocol === 'openai-completions' ? "bg-foreground/10 text-foreground border-foreground/15 font-medium" : "border-transparent bg-black/5 dark:bg-white/5 text-muted-foreground hover:bg-black/10 dark:hover:bg-white/10")}
                    >
                      {t('aiProviders.protocols.openaiCompletions', 'OpenAI Completions')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setApiProtocol('openai-responses')}
                      className={cn("flex-1 py-1.5 px-3 rounded-lg border transition-colors", apiProtocol === 'openai-responses' ? "bg-foreground/10 text-foreground border-foreground/15 font-medium" : "border-transparent bg-black/5 dark:bg-white/5 text-muted-foreground hover:bg-black/10 dark:hover:bg-white/10")}
                    >
                      {t('aiProviders.protocols.openaiResponses', 'OpenAI Responses')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setApiProtocol('anthropic-messages')}
                      className={cn("flex-1 py-1.5 px-3 rounded-lg border transition-colors", apiProtocol === 'anthropic-messages' ? "bg-foreground/10 text-foreground border-foreground/15 font-medium" : "border-transparent bg-black/5 dark:bg-white/5 text-muted-foreground hover:bg-black/10 dark:hover:bg-white/10")}
                      >
                        {t('aiProviders.protocols.anthropic', 'Anthropic')}
                      </button>
                    </div>
                  </div>
                )}
                {/* Device OAuth Trigger — only shown when in OAuth mode */}
                {useOAuthFlow && (
                  <div className="space-y-4 pt-2">
                    <div className="rounded-xl bg-blue-500/10 border border-blue-500/20 p-5 text-center">
                      <p className="text-[13px] font-medium text-blue-600 dark:text-blue-400 mb-4 block">
                        {t('aiProviders.oauth.loginPrompt')}
                      </p>
                      <Button
                        onClick={handleStartOAuth}
                        disabled={oauthFlowing}
                        className="w-full rounded-full h-9 text-xs font-semibold"
                      >
                        {oauthFlowing ? (
                          <><Loader2 className="h-4 w-4 mr-2 animate-spin" />{t('aiProviders.oauth.waiting')}</>
                        ) : (
                          t('aiProviders.oauth.loginButton')
                        )}
                      </Button>
                    </div>

                    {/* OAuth Active State Modal / Inline View */}
                    {oauthFlowing && (
                      <div className="mt-4 p-5 rounded-lg bg-black/[0.03] dark:bg-white/[0.04] relative overflow-hidden">
                        {/* Background pulse effect */}
                        <div className="absolute inset-0 bg-blue-500/5 animate-pulse" />

                        <div className="relative z-10 flex flex-col items-center justify-center text-center space-y-5">
                          {oauthError ? (
                            <div className="text-red-500 space-y-3">
                              <XCircle className="h-10 w-10 mx-auto" />
                              <p className="font-semibold text-[15px]">{t('aiProviders.oauth.authFailed')}</p>
                              <p className="text-[13px] opacity-80">{oauthError}</p>
                              <Button variant="outline" size="sm" onClick={handleCancelOAuth} className="mt-2 rounded-full px-6 h-9">
                                Try Again
                              </Button>
                            </div>
                          ) : !oauthData ? (
                            <div className="space-y-4 py-6">
                              <Loader2 className="h-10 w-10 animate-spin text-blue-500 mx-auto" />
                              <p className="text-[13px] font-medium text-muted-foreground animate-pulse">{t('aiProviders.oauth.requestingCode')}</p>
                            </div>
                          ) : oauthData.mode === 'manual' ? (
                            <div className="space-y-4 w-full">
                              <div className="space-y-2">
                                <h3 className="font-semibold text-[16px] text-foreground">Complete OpenAI Login</h3>
                                <p className="text-[13px] text-muted-foreground text-left bg-black/5 dark:bg-white/5 p-4 rounded-xl">
                                  {oauthData.message || 'Open the authorization page, complete login, then paste the callback URL or code below.'}
                                </p>
                              </div>

                              <Button
                                variant="secondary"
                                className="w-full rounded-full h-[42px] font-semibold"
                                onClick={() => invokeIpc('shell:openExternal', oauthData.authorizationUrl)}
                              >
                                <ExternalLink className="h-4 w-4 mr-2" />
                                Open Authorization Page
                              </Button>

                              <Input
                                placeholder="Paste callback URL or code"
                                value={manualCodeInput}
                                onChange={(e) => setManualCodeInput(e.target.value)}
                                className={inputClasses}
                              />

                              <Button
                                className="w-full rounded-full h-9 text-xs font-semibold"
                                onClick={handleSubmitManualOAuthCode}
                                disabled={!manualCodeInput.trim()}
                              >
                                Submit Code
                              </Button>

                              <Button variant="ghost" className="w-full rounded-full h-[42px] font-semibold text-muted-foreground" onClick={handleCancelOAuth}>
                                Cancel
                              </Button>
                            </div>
                          ) : (
                            <div className="space-y-5 w-full">
                              <div className="space-y-2">
                                <h3 className="font-semibold text-[16px] text-foreground">{t('aiProviders.oauth.approveLogin')}</h3>
                                <div className="text-[13px] text-muted-foreground text-left mt-2 space-y-1.5 bg-black/5 dark:bg-white/5 p-4 rounded-xl">
                                  <p>1. {t('aiProviders.oauth.step1')}</p>
                                  <p>2. {t('aiProviders.oauth.step2')}</p>
                                  <p>3. {t('aiProviders.oauth.step3')}</p>
                                </div>
                              </div>

                              <div className="flex items-center justify-center gap-3 p-4 bg-black/[0.03] dark:bg-white/[0.04] rounded-lg">
                                <code className="text-3xl font-mono tracking-[0.2em] font-bold text-foreground">
                                  {oauthData.userCode}
                                </code>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-10 w-10 rounded-full hover:bg-black/5 dark:hover:bg-white/10"
                                  onClick={() => {
                                    navigator.clipboard.writeText(oauthData.userCode);
                                    toast.success(t('aiProviders.oauth.codeCopied'));
                                  }}
                                >
                                  <Copy className="h-5 w-5" />
                                </Button>
                              </div>

                              <Button
                                variant="secondary"
                                className="w-full rounded-full h-[42px] font-semibold"
                                onClick={() => invokeIpc('shell:openExternal', oauthData.verificationUri)}
                              >
                                <ExternalLink className="h-4 w-4 mr-2" />
                                {t('aiProviders.oauth.openLoginPage')}
                              </Button>

                              <div className="flex items-center justify-center gap-2 text-[13px] font-medium text-muted-foreground pt-2">
                                <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                                <span>{t('aiProviders.oauth.waitingApproval')}</span>
                              </div>

                              <Button variant="ghost" className="w-full rounded-full h-[42px] font-semibold text-muted-foreground" onClick={handleCancelOAuth}>
                                Cancel
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <Separator className="bg-black/10 dark:bg-white/10" />

              <div className="flex justify-end gap-3">
                <Button
                  onClick={handleAdd}
                  className={cn("rounded-full px-8 h-9 text-xs font-semibold", useOAuthFlow && "hidden")}
                  disabled={!selectedType || saving || (showModelIdField && modelId.trim().length === 0)}
                >
                  {saving ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : null}
                  {t('aiProviders.dialog.add')}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
