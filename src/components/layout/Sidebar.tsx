/**
 * Sidebar Component
 * Settings navigation sidebar with grouped sections.
 */
import { NavLink, useNavigate } from 'react-router-dom';
import {
  Home as HomeIcon,
  LayoutDashboard,
  Cpu,
  Bot,
  Network,
  Puzzle,
  Clock,
  Settings as SettingsIcon,
  Key,
  Stethoscope,
  Info,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settings';
import { Button } from '@/components/ui/button';
import { useTranslation } from 'react-i18next';

interface NavItemProps {
  to: string;
  icon: React.ReactNode;
  label: string;
  collapsed?: boolean;
}

function NavItem({ to, icon, label, collapsed }: NavItemProps) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors',
          'hover:bg-black/5 dark:hover:bg-white/5 text-foreground/70',
          isActive ? 'bg-black/[0.06] dark:bg-white/[0.08] text-foreground' : '',
          collapsed && 'justify-center px-0',
        )
      }
    >
      {({ isActive }) => (
        <>
          <div className={cn('flex shrink-0 items-center justify-center', isActive ? 'text-foreground' : 'text-muted-foreground')}>
            {icon}
          </div>
          {!collapsed && (
            <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{label}</span>
          )}
        </>
      )}
    </NavLink>
  );
}

function SectionLabel({ label, collapsed }: { label: string; collapsed?: boolean }) {
  if (collapsed) return <div className="my-1.5 mx-2 border-t border-black/5 dark:border-white/5" />;
  return (
    <div className="px-2.5 pt-4 pb-1">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-semibold">
        {label}
      </span>
    </div>
  );
}

export function Sidebar() {
  const { t } = useTranslation(['common']);
  const sidebarCollapsed = useSettingsStore((state) => state.sidebarCollapsed);
  const navigate = useNavigate();

  const iconSize = 'h-[16px] w-[16px]';

  return (
    <aside
      className={cn(
        'flex shrink-0 flex-col border-r bg-black/[0.02] dark:bg-white/[0.01] transition-all duration-300',
        sidebarCollapsed ? 'w-14' : 'w-56',
      )}
    >
      {/* Header */}
      <div
        className={cn(
          'flex items-center h-11 shrink-0',
          sidebarCollapsed ? 'px-1 justify-center' : 'px-2',
        )}
      >
        <Button
          variant="ghost"
          size={sidebarCollapsed ? 'icon' : 'sm'}
          className={cn(
            'shrink-0 text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10',
            sidebarCollapsed ? 'h-7 w-7' : 'h-7 gap-1.5 px-2 text-xs font-medium',
          )}
          onClick={() => navigate('/')}
          title={t('sidebar.backHome')}
        >
          <HomeIcon className={iconSize} strokeWidth={2} />
          {!sidebarCollapsed && <span>{t('sidebar.backHome')}</span>}
        </Button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-1.5 pb-2">
        {/* Overview */}
        <NavItem
          to="/settings/dashboard"
          icon={<LayoutDashboard className={iconSize} strokeWidth={2} />}
          label={t('sidebar.dashboard')}
          collapsed={sidebarCollapsed}
        />

        {/* Business */}
        <SectionLabel label="Business" collapsed={sidebarCollapsed} />
        <NavItem to="/settings/agents" icon={<Bot className={iconSize} strokeWidth={2} />} label={t('sidebar.agents')} collapsed={sidebarCollapsed} />
        <NavItem to="/settings/channels" icon={<Network className={iconSize} strokeWidth={2} />} label={t('sidebar.channels')} collapsed={sidebarCollapsed} />
        <NavItem to="/settings/cron" icon={<Clock className={iconSize} strokeWidth={2} />} label={t('sidebar.cronTasks')} collapsed={sidebarCollapsed} />

        {/* Configuration */}
        <SectionLabel label="Config" collapsed={sidebarCollapsed} />
        <NavItem to="/settings/models" icon={<Cpu className={iconSize} strokeWidth={2} />} label={t('sidebar.models')} collapsed={sidebarCollapsed} />
        <NavItem to="/settings/skills" icon={<Puzzle className={iconSize} strokeWidth={2} />} label={t('sidebar.skills')} collapsed={sidebarCollapsed} />
        <NavItem to="/settings/token" icon={<Key className={iconSize} strokeWidth={2} />} label={t('sidebar.token')} collapsed={sidebarCollapsed} />

        {/* System */}
        <SectionLabel label="System" collapsed={sidebarCollapsed} />
        <NavItem to="/settings/diagnostics" icon={<Stethoscope className={iconSize} strokeWidth={2} />} label={t('sidebar.diagnostics')} collapsed={sidebarCollapsed} />
        <NavItem to="/settings/app" icon={<SettingsIcon className={iconSize} strokeWidth={2} />} label={t('sidebar.settings')} collapsed={sidebarCollapsed} />
        <NavItem to="/settings/about" icon={<Info className={iconSize} strokeWidth={2} />} label={t('sidebar.about')} collapsed={sidebarCollapsed} />
      </nav>
    </aside>
  );
}
