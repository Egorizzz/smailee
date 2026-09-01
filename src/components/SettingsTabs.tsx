import Link from "next/link";

type SettingsTab = "main" | "team" | "profile" | "notifications" | "security";

type Props = {
  active: SettingsTab;
  organizationAdmin: boolean;
  membersCount?: number;
};

export function SettingsTabs({ active, organizationAdmin, membersCount }: Props) {
  const tabs = [
    ...(organizationAdmin
      ? [
          { key: "main" as const, href: "/app/settings", label: "Основные" },
          { key: "team" as const, href: "/app/settings?tab=team", label: "Команда", count: membersCount },
          { key: "profile" as const, href: "/app/settings/profile", label: "Профиль организации" },
        ]
      : []),
    { key: "notifications" as const, href: "/app/settings/notifications", label: "Уведомления" },
    { key: "security" as const, href: "/app/settings/security", label: "Вход и безопасность" },
  ];

  return (
    <div className="mt-6 flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-semibold ${
            active === tab.key
              ? "border-mint-500 text-slate-900"
              : "border-transparent text-ink-500 hover:text-slate-900"
          }`}
        >
          {tab.label}
          {tab.count !== undefined && <span className="ml-1 text-xs text-ink-500">{tab.count}</span>}
        </Link>
      ))}
    </div>
  );
}
