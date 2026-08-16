export type AppNavIconName =
  | "leads"
  | "analytics"
  | "inbox"
  | "campaigns"
  | "contacts"
  | "mailboxes"
  | "integrations"
  | "settings"
  | "admin"
  | "logout";

const paths: Record<AppNavIconName, React.ReactNode> = {
  leads: <path d="M12 3.75 14.43 8.7l5.46.79-3.95 3.85.93 5.43L12 16.2l-4.87 2.57.93-5.43L4.1 9.49l5.47-.79L12 3.75Z" />,
  analytics: <><path d="M4 19V9M10 19V5M16 19v-7M22 19H2" /><path d="m3 6 6-3 6 5 6-5" /></>,
  inbox: <><path d="M4 5.5h16v13H4z" /><path d="m4 7 8 6 8-6" /></>,
  campaigns: <path d="m4.5 5.5 15 6.5-15 6.5 2-6.5-2-6.5Zm2 6.5h8" />,
  contacts: <><path d="M8.25 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3.5 19a4.75 4.75 0 0 1 9.5 0" /><path d="M15.5 7.25h5M18 4.75v5M15.5 14.5h5M15.5 18h5" /></>,
  mailboxes: <><rect x="3.5" y="5" width="17" height="14" rx="2.5" /><path d="m5 7 7 5 7-5" /></>,
  integrations: <><path d="M9 7.5 7.25 5.75a3.18 3.18 0 0 0-4.5 4.5L6 13.5a3.18 3.18 0 0 0 4.5 0l1-1" /><path d="m15 16.5 1.75 1.75a3.18 3.18 0 0 0 4.5-4.5L18 10.5a3.18 3.18 0 0 0-4.5 0l-1 1" /><path d="m8.5 15.5 7-7" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.04 1.56V21h-4v-.08A1.7 1.7 0 0 0 8.96 19.36a1.7 1.7 0 0 0-1.87.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.04H3v-4h.04A1.7 1.7 0 0 0 4.6 8.92a1.7 1.7 0 0 0-.34-1.87L4.2 7l2.83-2.83.06.06a1.7 1.7 0 0 0 1.87.34A1.7 1.7 0 0 0 10 3.01V3h4v.01a1.7 1.7 0 0 0 1.04 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06L19.8 7l-.06.05a1.7 1.7 0 0 0-.34 1.87 1.7 1.7 0 0 0 1.56 1.04H21v4h-.04A1.7 1.7 0 0 0 19.4 15Z" /></>,
  admin: <><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></>,
  logout: <><path d="M9 5H5.5A1.5 1.5 0 0 0 4 6.5v11A1.5 1.5 0 0 0 5.5 19H9M14 8l4 4-4 4M18 12H8" /></>,
};

export function AppNavIcon({ name, className = "h-4 w-4" }: { name: AppNavIconName; className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  );
}
