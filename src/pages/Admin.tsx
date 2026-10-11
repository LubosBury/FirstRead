import { Loader2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Navigate } from "react-router";
import { Button } from "@/components/ui/button";
import { EngineSettings } from "@/components/EngineSettings";
import { InviteCard } from "@/components/InviteCard";
import { Card } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { useMe } from "@/hooks/useMe";
import { ACCESS_LABEL, accessStatus, type AccessStatus } from "@/lib/access";
import { api, ApiError, type AdminUser } from "@/lib/api";
import { cn } from "@/lib/utils";

const dateFmt = new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "numeric", year: "numeric" });

const statusClass: Record<AccessStatus, string> = { active: "text-brand", pending: "text-muted", revoked: "text-danger" };

type AccessAction = "resend" | "ban" | "unban";

const done: Record<AccessAction, (email: string) => string> = {
  resend: (email) => `Pozvánka znovu odeslána na ${email}.`,
  ban: (email) => `${email} už nemá přístup.`,
  unban: (email) => `${email} má znovu přístup.`,
};

export function Admin() {
  const { me, refresh } = useMe();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [email, setEmail] = useState("");
  const [amount, setAmount] = useState(20);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [accessMessage, setAccessMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = () => api.adminUsers().then(setUsers, () => setUsers([]));
  useEffect(() => {
    if (me?.isAdmin) void load();
  }, [me?.isAdmin]);

  if (me && !me.isAdmin) return <Navigate to="/" replace />;

  async function grant(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    try {
      const { balance } = await api.adminGrant(email.trim(), amount, note);
      setMessage(`Hotovo, ${email} má teď ${balance}.`);
      setNote("");
      await load();
      if (email.trim().toLowerCase() === me?.user.email.toLowerCase()) await refresh();
    } catch (err) {
      setMessage(err instanceof ApiError ? (err.status === 404 ? "Tento e-mail nikdo nepoužívá. Nejdřív ho pozvěte." : err.message) : "Nepovedlo se.");
    }
  }

  async function changeAccess(u: AdminUser, action: AccessAction) {
    if (action === "ban" && !confirm(`Odebrat přístup pro ${u.email}? Přihlášení na všech zařízeních skončí.`)) return;
    setBusyId(u.id);
    setAccessMessage(null);
    try {
      if (action === "resend") await api.adminInvite(u.email);
      else if (action === "ban") await api.adminBan(u.id);
      else await api.adminUnban(u.id);
      // Reload first, so the confirmation never sits next to a stale row.
      await load();
      setAccessMessage(done[action](u.email));
    } catch (err) {
      setAccessMessage(err instanceof ApiError ? err.message : "Nepovedlo se.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <section>
        <h1 className="mb-3 text-2xl font-extrabold">Uživatelé</h1>
        {accessMessage && <p className="mb-3 rounded-lg bg-brand-soft px-3 py-2 text-sm text-brand">{accessMessage}</p>}
        {users === null ? (
          <Loader2 className="h-6 w-6 animate-spin text-brand" />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full text-sm">
              <thead className="text-left text-muted">
                <tr>
                  <th className="px-4 py-2">E-mail</th>
                  <th className="px-4 py-2">Stav</th>
                  <th className="px-4 py-2 text-right">Kredity</th>
                  <th className="px-4 py-2 text-right">Obrázků</th>
                  <th className="px-4 py-2">Od</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {users.map((u) => {
                  const status = accessStatus(u);
                  const busy = busyId === u.id;
                  return (
                    <tr key={u.id}>
                      <td className="px-4 py-2">
                        <button type="button" className="hover:text-brand" onClick={() => setEmail(u.email)}>
                          {u.email}
                        </button>
                      </td>
                      <td className={cn("whitespace-nowrap px-4 py-2", statusClass[status])}>{ACCESS_LABEL[status]}</td>
                      <td className="px-4 py-2 text-right font-bold">{u.balance}</td>
                      <td className="px-4 py-2 text-right">{u.generated}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-muted">{dateFmt.format(new Date(u.createdAt))}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-right">
                        {u.id !== me?.user.id &&
                          (status === "revoked" ? (
                            <Button size="sm" variant="secondary" disabled={busy} onClick={() => changeAccess(u, "unban")}>
                              Vrátit přístup
                            </Button>
                          ) : (
                            <>
                              {status === "pending" && (
                                <Button size="sm" variant="ghost" disabled={busy} onClick={() => changeAccess(u, "resend")}>
                                  Poslat znovu
                                </Button>
                              )}
                              <Button size="sm" variant="ghost" className="text-danger" disabled={busy} onClick={() => changeAccess(u, "ban")}>
                                Odebrat přístup
                              </Button>
                            </>
                          ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-muted">Přístup mají jen pozvaní. Přihlašují se odkazem z e-mailu, bez hesla.</p>
      </section>
      <div className="space-y-6">
        <InviteCard onInvited={() => void load()} />
        <Card>
          <h2 className="mb-3 text-lg font-extrabold">Přidat kredity</h2>
          <form onSubmit={grant} className="space-y-3">
            <div>
              <Label htmlFor="g-email">E-mail</Label>
              <Input id="g-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="g-amount">Počet (záporný odebere)</Label>
              <Input id="g-amount" type="number" min={-1000} max={1000} required value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
            </div>
            <div>
              <Label htmlFor="g-note">Poznámka</Label>
              <Input id="g-note" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <Button type="submit" className="w-full" disabled={!email || !amount}>
              Připsat
            </Button>
            {message && <p className="text-sm text-muted">{message}</p>}
          </form>
        </Card>
        <EngineSettings />
      </div>
    </div>
  );
}
