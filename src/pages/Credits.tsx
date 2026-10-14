import { Coins, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useMe } from "@/hooks/useMe";
import { api, type CreditPack, type LedgerEntry, type Me } from "@/lib/api";
import { credits } from "@/lib/plural";
import { czk, czkPerCredit } from "@/lib/price";

const dateFmt = new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "numeric", year: "numeric" });

// The payment provider confirms to the server on its own, a moment after it sends the browser back.
const POLL_MS = 2000;
const POLL_TRIES = 6;

/** Balance when the teacher left to pay, so a payment confirmed before the return is still noticed. */
const BEFORE_KEY = "credits.balanceBeforeCheckout";

function balanceBefore(): number | null {
  try {
    const stored = sessionStorage.getItem(BEFORE_KEY);
    return stored === null ? null : Number(stored);
  } catch {
    return null;
  }
}

function forgetBalance() {
  try {
    sessionStorage.removeItem(BEFORE_KEY);
  } catch {
    // Nothing was stored either.
  }
}

function rememberBalance(balance: number) {
  try {
    sessionStorage.setItem(BEFORE_KEY, String(balance));
  } catch {
    // Private windows may refuse; the page then waits for the balance to move.
  }
}

type Notice = "waiting" | "credited" | "late" | "cancelled";

const NOTICE: Record<Notice, string> = {
  waiting: "Platba proběhla. Kredity právě připisujeme, obvykle to trvá jen chvíli.",
  credited: "Platba proběhla a kredity máte připsané.",
  late: "Platba proběhla, ale kredity se zatím nepřipsaly. Načtěte stránku za chvíli znovu. Kdyby se neobjevily, napište správci.",
  cancelled: "Platbu jste zrušili. Nic jsme vám neúčtovali.",
};

function describe(e: LedgerEntry): string {
  if (e.reason === "purchase") return "Nákup kreditů";
  if (e.reason === "generation") return "Vygenerovaný obrázek";
  if (e.reason === "refund") return "Vrácení za obrázek, který se nepovedl";
  if (e.note === "welcome") return "Kredity na uvítanou";
  return e.delta < 0 ? "Odebráno správcem" : "Připsáno správcem";
}

export function Credits() {
  const { me } = useMe();
  return me && <CreditsPage me={me} />;
}

function CreditsPage({ me }: { me: Me }) {
  const { setBalance } = useMe();
  const [params, setParams] = useSearchParams();
  // Where the payment page sent the browser back, read once: the address is tidied right after.
  const [returned] = useState(() => {
    const status = params.get("status");
    if (status !== "success" && status !== "cancelled") return null;
    return { status, before: balanceBefore() ?? me.balance, at: me.balance };
  });
  const [notice, setNotice] = useState<Notice | null>(() => {
    if (!returned) return null;
    if (returned.status === "cancelled") return "cancelled";
    return returned.at === returned.before ? "waiting" : "credited";
  });
  const [packs, setPacks] = useState<CreditPack[] | "failed" | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[] | "failed" | null>(null);
  const [buying, setBuying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canBuy = me.canBuyCredits;

  useEffect(() => {
    if (!params.has("status")) return;
    forgetBalance();
    setParams({}, { replace: true });
  }, [params, setParams]);

  // Coming back from the payment page with the browser's back button restores this page as it was left.
  useEffect(() => {
    const restore = (e: PageTransitionEvent) => e.persisted && setBuying(null);
    window.addEventListener("pageshow", restore);
    return () => window.removeEventListener("pageshow", restore);
  }, []);

  useEffect(() => {
    if (canBuy) api.creditPacks().then(setPacks, () => setPacks("failed"));
  }, [canBuy]);

  useEffect(() => {
    api.creditLedger().then(setLedger, () => setLedger("failed"));
  }, []);

  useEffect(() => {
    if (returned?.status !== "success" || returned.at !== returned.before) return;
    let stopped = false;
    let tries = 0;
    let timer = setTimeout(check, POLL_MS);
    async function check() {
      tries++;
      const fresh = await api.me().catch(() => null);
      if (stopped) return;
      if (fresh && fresh.balance !== returned!.before) {
        setBalance(fresh.balance);
        setNotice("credited");
        api.creditLedger().then(setLedger, () => {});
      } else if (tries >= POLL_TRIES) {
        setNotice("late");
      } else {
        timer = setTimeout(check, POLL_MS);
      }
    }
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [returned, setBalance]);

  async function buy(pack: CreditPack) {
    setBuying(pack.id);
    setError(null);
    try {
      const { url } = await api.startCheckout(pack.id);
      rememberBalance(me.balance);
      window.location.assign(url);
    } catch {
      setError("Platbu se nepodařilo zahájit, nic jsme vám neúčtovali. Zkuste to prosím znovu.");
      setBuying(null);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="mr-auto text-2xl font-extrabold">Kredity</h1>
          <p className="flex items-center gap-1.5 rounded-full bg-brand-soft px-3 py-1 text-sm font-bold text-brand" data-testid="balance">
            <Coins className="h-4 w-4" /> Zůstatek: {credits(me.balance)}
          </p>
        </div>
        <p className="text-sm text-muted">
          Za kredity vytváříte nové obrázky. Každý vygenerovaný obrázek vám zůstává v knihovně a můžete ho použít znovu
          zdarma. Zdarma jsou i obrázky ze sdílené knihovny a vlastní nahrané.
        </p>
      </div>

      {notice && (
        <p role="status" className="flex items-center gap-2 rounded-lg bg-brand-soft px-3 py-2 text-sm text-brand">
          {notice === "waiting" && <Loader2 className="h-4 w-4 shrink-0 animate-spin" />}
          {NOTICE[notice]}
        </p>
      )}

      {canBuy ? (
        <section className="space-y-3">
          <h2 className="text-lg font-extrabold">Dobít kredity</h2>
          {error && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
          {packs === null ? (
            <Loader2 className="h-6 w-6 animate-spin text-brand" />
          ) : packs === "failed" ? (
            <p className="text-muted">Nabídku se nepodařilo načíst. Načtěte prosím stránku znovu.</p>
          ) : packs.length === 0 ? (
            <p className="text-muted">Kredity teď koupit nejdou. Zkuste to prosím později.</p>
          ) : (
            <>
              <ul className="grid gap-3 sm:grid-cols-3">
                {packs.map((pack) => (
                  <li key={pack.id}>
                    <Card className="flex h-full flex-col gap-1">
                      <div className="sm:min-h-6">
                        {pack.label && (
                          <span className="rounded-full bg-brand-soft px-2.5 py-0.5 text-xs font-bold text-brand">{pack.label}</span>
                        )}
                      </div>
                      <h3 className="text-lg font-extrabold">{credits(pack.credits)}</h3>
                      <p className="text-sm font-semibold">{czk(pack.priceCzk)}</p>
                      <p className="text-xs text-muted">{czkPerCredit(pack.priceCzk, pack.credits)} za kredit</p>
                      <Button className="mt-3 h-11 w-full md:h-10" disabled={buying !== null} onClick={() => buy(pack)}>
                        {buying === pack.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Coins className="h-4 w-4" />}
                        Koupit · {czk(pack.priceCzk)}
                      </Button>
                    </Card>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted">
                Platíte kartou na zabezpečené stránce Stripe. Kredity se připíšou hned po zaplacení.
              </p>
            </>
          )}
        </section>
      ) : (
        <p className="text-sm text-muted">Když vám kredity dojdou, požádejte správce o doplnění.</p>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-extrabold">Historie</h2>
        {ledger === null ? (
          <Loader2 className="h-6 w-6 animate-spin text-brand" />
        ) : ledger === "failed" ? (
          <p className="text-muted">Historii se nepodařilo načíst. Načtěte prosím stránku znovu.</p>
        ) : ledger.length === 0 ? (
          <p className="text-muted">Zatím tu nic není.</p>
        ) : (
          <ul className="divide-y divide-line rounded-xl border border-line bg-surface text-sm" data-testid="ledger">
            {ledger.map((e, i) => (
              <li key={i} className="flex items-baseline gap-3 px-4 py-3">
                <span className="w-20 shrink-0 text-xs text-muted">{dateFmt.format(new Date(e.createdAt))}</span>
                <span className="min-w-0 flex-1">
                  {describe(e)}
                  {e.reason === "grant" && e.note && e.note !== "welcome" && (
                    <span className="block text-xs text-muted">{e.note}</span>
                  )}
                </span>
                <span className="shrink-0 font-bold whitespace-nowrap">
                  {e.delta > 0 ? "+" : "−"}
                  {Math.abs(e.delta)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
