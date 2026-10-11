import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api";

/** Creates the account and emails a link to the app. Inviting a pending user again resends. */
export function InviteCard({ onInvited }: { onInvited: () => void }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const { email: invited, resent } = await api.adminInvite(email.trim());
      setMessage(resent ? `Pozvánka znovu odeslána na ${invited}.` : `Pozvánka odeslána na ${invited}.`);
      setEmail("");
      onInvited();
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Nepovedlo se.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 className="mb-3 text-lg font-extrabold">Pozvat</h2>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <Label htmlFor="i-email">E-mail</Label>
          <Input id="i-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <Button type="submit" className="w-full" disabled={busy || !email}>
          Poslat pozvánku
        </Button>
        {message && <p className="text-sm text-muted">{message}</p>}
      </form>
    </Card>
  );
}
