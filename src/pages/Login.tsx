import { BookOpenCheck, MailCheck } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api";

// Better Auth sends people back here with ?error=... when a link or Apple
// sign-in fails. Only these codes get their own text: the URL's
// error_description is never shown, since anyone can craft such a link.
const SIGN_IN_ERRORS: Record<string, string | null> = {
  INVALID_TOKEN: "Odkaz už neplatí nebo byl použitý. Pošlete si nový.",
  INVALID_INVITE: "Pozvánka už neplatí nebo byla použitá. Pošlete si přihlašovací odkaz.",
  // Cancelled on Apple's page: nothing went wrong.
  user_cancelled_authorize: null,
  NOT_INVITED: "E-mail vašeho Apple účtu nemá pozvánku. Přihlaste se e-mailem, na který pozvánka přišla.",
  APPLE_PRIVATE_EMAIL:
    "Apple před námi skryl váš e-mail, takže nepoznáme vaši pozvánku. Přihlaste se e-mailem, nebo v nastavení Apple účtu u aplikace První čtenáři ukončete přihlašování přes Apple a příště zvolte „Sdílet můj e-mail“.",
  // An invited account whose mailbox isn't proven yet; Better Auth won't link Apple to it.
  account_not_linked: "Poprvé se přihlaste odkazem z pozvánky nebo z e-mailu. Pak už půjde i Apple.",
  BANNED_USER: "Přístup k aplikaci První čtenáři vám byl odebrán.",
};

function AppleLogo() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 fill-current">
      <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" />
    </svg>
  );
}

export function Login() {
  const [params, setParams] = useSearchParams();
  // The invitation email links here with ?email=...
  const [email, setEmail] = useState(() => params.get("email") ?? "");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(() => {
    const code = params.get("error");
    if (!code) return null;
    return Object.hasOwn(SIGN_IN_ERRORS, code) ? SIGN_IN_ERRORS[code] : "Přihlášení se nepovedlo. Zkuste to prosím znovu.";
  });
  const [apple, setApple] = useState(false);

  useEffect(() => {
    api.loginMethods().then((m) => setApple(m.apple), () => setApple(false));
  }, []);

  // Read once: a reload should not show the error again.
  useEffect(() => {
    if (params.has("email") || params.has("error")) setParams({}, { replace: true });
  }, [params, setParams]);

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

  async function signInWithApple() {
    setBusy(true);
    setError(null);
    try {
      const { url } = await api.startAppleSignIn();
      window.location.assign(url);
    } catch {
      setError("Přihlášení přes Apple se nepovedlo. Zkuste to prosím znovu.");
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm p-7">
        <div className="mb-6 flex items-center gap-2 text-2xl font-extrabold text-brand">
          <BookOpenCheck className="h-7 w-7" /> První čtenáři
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
          <>
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
            {apple && (
              <>
                <div className="my-4 flex items-center gap-3 text-xs text-muted">
                  <span className="h-px flex-1 bg-line" /> nebo <span className="h-px flex-1 bg-line" />
                </div>
                <Button variant="apple" className="w-full" disabled={busy} onClick={signInWithApple}>
                  <AppleLogo /> Přihlásit se přes Apple
                </Button>
              </>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
