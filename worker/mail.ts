type Mail = { to: string; subject: string; html: string; text: string };

/**
 * Sends through Resend. Without an API key (local dev) the mail is printed
 * instead, so signing in locally needs no email account.
 */
export async function sendMail(env: Env, mail: Mail): Promise<void> {
  if (!env.RESEND_API_KEY) {
    console.log(`[mail] to=${mail.to} subject=${mail.subject}\n${mail.text}`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.MAIL_FROM, to: [mail.to], subject: mail.subject, html: mail.html, text: mail.text }),
  });
  if (!res.ok) {
    throw new Error(`Resend responded ${res.status}: ${await res.text()}`);
  }
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function magicLinkMail(to: string, url: string): Mail {
  return {
    to,
    subject: "Přihlášení do FirstRead",
    text: `Dobrý den,\n\npro přihlášení do FirstRead otevřete tento odkaz (platí 15 minut):\n${url}\n\nPokud jste o přihlášení nežádali, e-mail ignorujte.`,
    html: `<div style="font-family:Arial,sans-serif;font-size:16px;color:#1d2422">
<p>Dobrý den,</p>
<p>pro přihlášení do FirstRead klikněte na tlačítko (odkaz platí 15&nbsp;minut):</p>
<p><a href="${esc(url)}" style="display:inline-block;background:#1f6f5c;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">Přihlásit se</a></p>
<p style="color:#66706c;font-size:13px">Pokud jste o přihlášení nežádali, e-mail ignorujte.</p>
</div>`,
  };
}

/** Points to the app with the address prefilled. Not a magic link: those expire in 15 minutes. */
export function inviteMail(to: string, invitedBy: string, appUrl: string): Mail {
  const url = `${appUrl.replace(/\/$/, "")}/?email=${encodeURIComponent(to)}`;
  return {
    to,
    subject: "Pozvánka do FirstRead",
    text: `Dobrý den,\n\n${invitedBy} vás zve do FirstRead, kde si připravíte pracovní listy pro prvňáčky.\n\nOtevřete ${url} a přihlaste se svým e-mailem. Heslo nepotřebujete, pošleme vám přihlašovací odkaz.`,
    html: `<div style="font-family:Arial,sans-serif;font-size:16px;color:#1d2422">
<p>Dobrý den,</p>
<p>${esc(invitedBy)} vás zve do FirstRead, kde si připravíte pracovní listy pro prvňáčky.</p>
<p><a href="${esc(url)}" style="display:inline-block;background:#1f6f5c;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">Otevřít FirstRead</a></p>
<p style="color:#66706c;font-size:13px">Přihlásíte se svým e-mailem, bez hesla. Pošleme vám přihlašovací odkaz.</p>
</div>`,
  };
}
