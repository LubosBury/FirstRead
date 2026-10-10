import { Loader2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Navigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { useMe } from "@/hooks/useMe";
import { api, ApiError, type AdminUser } from "@/lib/api";

const dateFmt = new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "numeric", year: "numeric" });

export function Admin() {
  const { me, refresh } = useMe();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [email, setEmail] = useState("");
  const [amount, setAmount] = useState(20);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);

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
      setMessage(err instanceof ApiError ? (err.status === 404 ? "Uživatel s tímto e-mailem se ještě nepřihlásil." : err.message) : "Nepovedlo se.");
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <section>
        <h1 className="mb-3 text-2xl font-extrabold">Uživatelé</h1>
        {users === null ? (
          <Loader2 className="h-6 w-6 animate-spin text-brand" />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full text-sm">
              <thead className="text-left text-muted">
                <tr>
                  <th className="px-4 py-2">E-mail</th>
                  <th className="px-4 py-2 text-right">Kredity</th>
                  <th className="px-4 py-2 text-right">Obrázků</th>
                  <th className="px-4 py-2">Od</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {users.map((u) => (
                  <tr key={u.id}>
                    <td className="px-4 py-2">
                      <button type="button" className="hover:text-brand" onClick={() => setEmail(u.email)}>
                        {u.email}
                      </button>
                    </td>
                    <td className="px-4 py-2 text-right font-bold">{u.balance}</td>
                    <td className="px-4 py-2 text-right">{u.generated}</td>
                    <td className="px-4 py-2 text-muted">{dateFmt.format(new Date(u.createdAt))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-muted">
          Přístup mají jen adresy v ALLOWED_EMAILS. Uživatel se v seznamu objeví po prvním přihlášení.
        </p>
      </section>
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
    </div>
  );
}
