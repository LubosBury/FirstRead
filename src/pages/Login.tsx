import { BookOpenCheck, MailCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api";

export function Login() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.requestMagicLink(email.trim());
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Odeslání se nepovedlo. Zkuste to prosím znovu.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm p-7">
        <div className="mb-6 flex items-center gap-2 text-2xl font-extrabold text-brand">
          <BookOpenCheck className="h-7 w-7" /> FirstRead
        </div>
        {sent ? (
          <div className="space-y-3 text-center">
            <MailCheck className="mx-auto h-10 w-10 text-brand" />
            <p className="font-bold">Zkontrolujte e-mail</p>
            <p className="text-sm text-muted">
              Na adresu <strong>{email}</strong> jsme poslali odkaz pro přihlášení. Platí 15 minut.
            </p>
            <Button variant="ghost" onClick={() => setSent(false)}>
              Zadat jiný e-mail
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <p className="text-sm text-muted">Pracovní listy pro prvňáčky. Přihlaste se odkazem z e-mailu, bez hesla.</p>
            <div>
              <Label htmlFor="email">E-mail</Label>
              <Input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            {error && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy}>
              Poslat přihlašovací odkaz
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}
