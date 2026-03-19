export function getLocalStorageItemWithLegacy(primaryKey: string, legacyKey?: string): string | null {
  try {
    const primaryValue = window.localStorage.getItem(primaryKey);
    if (primaryValue != null || !legacyKey || legacyKey === primaryKey) {
      return primaryValue;
    }
    return window.localStorage.getItem(legacyKey);
  } catch {
    return null;
  }
}

export function setLocalStorageItemWithLegacy(primaryKey: string, legacyKey: string | undefined, value: string): void {
  try {
    window.localStorage.setItem(primaryKey, value);
    if (legacyKey && legacyKey !== primaryKey) {
      window.localStorage.removeItem(legacyKey);
    }
  } catch {
    // ignore localStorage errors
  }
}

export function removeLocalStorageItemWithLegacy(primaryKey: string, legacyKey?: string): void {
  try {
    window.localStorage.removeItem(primaryKey);
    if (legacyKey && legacyKey !== primaryKey) {
      window.localStorage.removeItem(legacyKey);
    }
  } catch {
    // ignore localStorage errors
  }
}
