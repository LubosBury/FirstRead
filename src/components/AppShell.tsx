import { BookOpenCheck, Coins, LogOut } from "lucide-react";
import type { ReactNode } from "react";
import { Link, NavLink } from "react-router";
import { useMe } from "@/hooks/useMe";
import { api } from "@/lib/api";
import { credits } from "@/lib/plural";
import { cn } from "@/lib/utils";

const navClass = ({ isActive }: { isActive: boolean }) =>
  cn("rounded-lg px-3 py-1.5 text-sm font-semibold", isActive ? "bg-brand-soft text-brand" : "text-muted hover:text-ink");

export function AppShell({ children }: { children: ReactNode }) {
  const { me, refresh } = useMe();

  async function signOut() {
    await api.signOut().catch(() => {});
    await refresh();
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-line bg-surface/90 backdrop-blur print:hidden">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-4 py-2.5">
          <Link to="/" className="mr-3 flex items-center gap-2 text-lg font-extrabold text-brand">
            <BookOpenCheck className="h-6 w-6" /> FirstRead
          </Link>
          <nav className="flex gap-1">
            <NavLink to="/" end className={navClass}>
              Moje listy
            </NavLink>
            <NavLink to="/library" className={navClass}>
              Obrázky
            </NavLink>
            {me?.isAdmin && (
              <NavLink to="/admin" className={navClass}>
                Správa
              </NavLink>
            )}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            {me && (
              <span
                className="flex items-center gap-1.5 rounded-full bg-brand-soft px-3 py-1 text-sm font-bold text-brand"
                title="Kredity na generování obrázků"
                data-testid="credit-badge"
              >
                <Coins className="h-4 w-4" /> {credits(me.balance)}
              </span>
            )}
            <button type="button" onClick={signOut} className="rounded-lg p-2 text-muted hover:bg-canvas" aria-label="Odhlásit se" title="Odhlásit se">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
