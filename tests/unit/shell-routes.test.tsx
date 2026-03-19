import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';

const { settingsState, gatewayState, initSettingsMock, initGatewayMock, applyGatewayTransportPreferenceMock } = vi.hoisted(() => ({
  settingsState: {
    theme: 'system' as const,
    language: 'en',
    setupComplete: true,
  },
  gatewayState: {},
  initSettingsMock: vi.fn(),
  initGatewayMock: vi.fn(),
  applyGatewayTransportPreferenceMock: vi.fn(),
}));

vi.mock('../../src/components/layout/MainLayout', async () => {
  const { Outlet } = await import('react-router-dom');
  return {
    MainLayout: () => (
      <div data-testid="main-layout">
        <Outlet />
      </div>
    ),
  };
});

vi.mock('../../src/pages/Home', () => ({
  Home: () => <div>home-page</div>,
}));
vi.mock('../../src/pages/Chat', () => ({
  Chat: () => <div>chat-page</div>,
}));
vi.mock('../../src/pages/Models', () => ({
  Models: () => <div>models-page</div>,
}));
vi.mock('../../src/pages/Agents', () => ({
  Agents: () => <div>agents-page</div>,
}));
vi.mock('../../src/pages/Channels', () => ({
  Channels: () => <div>channels-page</div>,
}));
vi.mock('../../src/pages/Skills', () => ({
  Skills: () => <div>skills-page</div>,
}));
vi.mock('../../src/pages/Cron', () => ({
  Cron: () => <div>cron-page</div>,
}));
vi.mock('../../src/pages/Settings', () => ({
  Settings: () => <div>settings-page</div>,
}));
vi.mock('../../src/pages/Dashboard', () => ({
  Dashboard: () => <div>dashboard-page</div>,
}));
vi.mock('../../src/pages/Token', () => ({
  Token: () => <div>token-page</div>,
}));
vi.mock('../../src/pages/Diagnostics', () => ({
  Diagnostics: () => <div>diagnostics-page</div>,
}));
vi.mock('../../src/pages/About', () => ({
  About: () => <div>about-page</div>,
}));
vi.mock('../../src/pages/Setup', () => ({
  Setup: () => <div>setup-page</div>,
}));

vi.mock('../../src/stores/settings', () => ({
  useSettingsStore: (selector: (state: {
    init: typeof initSettingsMock;
    theme: typeof settingsState.theme;
    language: typeof settingsState.language;
    setupComplete: typeof settingsState.setupComplete;
  }) => unknown) => selector({
    init: initSettingsMock,
    theme: settingsState.theme,
    language: settingsState.language,
    setupComplete: settingsState.setupComplete,
  }),
}));

vi.mock('../../src/stores/gateway', () => ({
  useGatewayStore: (selector: (state: { init: typeof initGatewayMock }) => unknown) => selector({
    init: initGatewayMock,
  }),
}));

vi.mock('../../src/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/api-client')>('../../src/lib/api-client');
  return {
    ...actual,
    applyGatewayTransportPreference: applyGatewayTransportPreferenceMock,
  };
});

describe('shell routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settingsState.setupComplete = true;
    settingsState.language = 'en';
    settingsState.theme = 'system';
    vi.mocked(window.electron.ipcRenderer.on).mockReturnValue(undefined as never);
  });

  it('renders Home on the root route', async () => {
    const { default: App } = await import('../../src/App');

    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByText('home-page')).toBeInTheDocument();
    expect(screen.queryByTestId('main-layout')).not.toBeInTheDocument();
  });

  it('renders dashboard inside the settings layout', async () => {
    const { default: App } = await import('../../src/App');

    render(
      <MemoryRouter initialEntries={['/settings/dashboard']}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('main-layout')).toBeInTheDocument();
    expect(screen.getByText('dashboard-page')).toBeInTheDocument();
  });

  it('renders settings chat route inside the settings layout', async () => {
    const { default: App } = await import('../../src/App');

    render(
      <MemoryRouter initialEntries={['/settings/chat']}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('main-layout')).toBeInTheDocument();
    expect(screen.getByText('chat-page')).toBeInTheDocument();
  });

  it('redirects /chat to Home', async () => {
    const { default: App } = await import('../../src/App');

    render(
      <MemoryRouter initialEntries={['/chat']}>
        <App />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('home-page')).toBeInTheDocument();
    });
  });
});
