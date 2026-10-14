import { BookOpenCheck, Coins, Files, Images, LogOut, Settings } from "lucide-react";
import type { ReactNode } from "react";
import { Link, NavLink, useMatch } from "react-router";
import { useMe } from "@/hooks/useMe";
import { api } from "@/lib/api";
import { credits } from "@/lib/plural";
import { cn } from "@/lib/utils";

const navClass = ({ isActive }: { isActive: boolean }) =>
  cn("rounded-lg px-3 py-1.5 text-sm font-semibold", isActive ? "bg-brand-soft text-brand" : "text-muted hover:text-ink");

const tabClass = ({ isActive }: { isActive: boolean }) =>
  cn("flex min-h-12 flex-col items-center justify-center gap-0.5 text-xs font-bold", isActive ? "text-brand" : "text-muted");

export function AppShell({ children }: { children: ReactNode }) {
  const { me, refresh } = useMe();
  // The sheet editor brings its own bottom bar on phones.
  const inEditor = useMatch("/sheets/*");

  async function signOut() {
    await api.signOut().catch(() => {});
    await refresh();
  }

  const links = [
    { to: "/", label: "Moje listy", icon: Files, end: true },
    { to: "/library", label: "Obrázky", icon: Images, end: false },
    ...(me?.canBuyCredits ? [{ to: "/credits", label: "Kredity", icon: Coins, end: false }] : []),
    ...(me?.isAdmin ? [{ to: "/admin", label: "Správa", icon: Settings, end: false }] : []),
  ];

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-line bg-surface/90 backdrop-blur print:hidden">
        <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-2">
          <Link to="/" className="mr-3 flex items-center gap-2 text-lg font-extrabold text-brand">
            <BookOpenCheck className="h-6 w-6" /> První čtenáři
          </Link>
          <nav className="hidden gap-1 md:flex">
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.end} className={navClass}>
                {l.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-1">
            {me && (
              <Link to="/credits" className="group flex min-h-11 items-center md:min-h-0" title="Kredity a jejich historie" data-testid="credit-badge">
                <span className="flex items-center gap-1.5 rounded-full bg-brand-soft px-3 py-1 text-sm font-bold text-brand group-hover:underline">
                  <Coins className="h-4 w-4" /> {credits(me.balance)}
                </span>
              </Link>
            )}
            <button type="button" onClick={signOut} className="rounded-lg p-2.5 text-muted hover:bg-canvas" aria-label="Odhlásit se" title="Odhlásit se">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 pt-6 pb-24 md:pb-6">{children}</main>
      {!inEditor && (
        <nav
          aria-label="Hlavní navigace"
          className="pb-safe fixed inset-x-0 bottom-0 z-40 grid border-t border-line bg-surface/95 pt-1 backdrop-blur md:hidden print:hidden"
          style={{ gridTemplateColumns: `repeat(${links.length}, minmax(0, 1fr))` }}
        >
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end} className={tabClass}>
              <l.icon className="h-5 w-5" />
              {l.label}
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  );
}
