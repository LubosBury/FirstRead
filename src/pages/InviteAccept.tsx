import { BookOpenCheck } from "lucide-react";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useMe } from "@/hooks/useMe";
import { api } from "@/lib/api";

/**
 * Landing page of the invitation email. Nothing happens on load: mail
 * scanners open links before people do, and a one-time token must survive
 * that. The button spends it.
 */
export function InviteAccept() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { refresh } = useMe();
  const [busy, setBusy] = useState(false);

  async function accept() {
    setBusy(true);
    try {
      await api.acceptInvite(params.get("token") ?? "");
      await refresh(); // the app opens
      navigate("/", { replace: true });
    } catch {
      setBusy(false);
      navigate(`/?${new URLSearchParams({ email: params.get("email") ?? "", error: "INVALID_INVITE" })}`, { replace: true });
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm p-7 text-center">
        <div className="mb-6 flex items-center justify-center gap-2 text-2xl font-extrabold text-brand">
          <BookOpenCheck className="h-7 w-7" /> FirstRead
        </div>
        <p className="font-bold">Máte pozvánku do FirstRead</p>
        <p className="mt-2 text-sm text-muted">Pracovní listy pro prvňáčky. Přihlásíte se jedním kliknutím, bez hesla.</p>
        <Button className="mt-6 w-full" onClick={accept} disabled={busy}>
          Přihlásit se
        </Button>
      </Card>
    </div>
  );
}
