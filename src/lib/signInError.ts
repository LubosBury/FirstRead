/**
 * What to tell the teacher when Apple sign-in sends them back with `?error=…`.
 * Only known codes get their own text: the URL's `error_description` is never
 * shown, since anyone can craft a link that puts words on our sign-in page.
 */
export function appleSignInError(code: string | null): string | null {
  switch (code) {
    case null:
    case "user_cancelled_authorize":
      return null;
    case "not_invited":
      return "E-mail vašeho Apple účtu zatím nemá přístup. Požádejte o pozvánku, nebo se přihlaste e-mailem, na který přišla.";
    case "apple_private_email":
      return "Apple před námi skryl váš e-mail, takže nepoznáme vaši pozvánku. Přihlaste se e-mailem, nebo v nastavení Apple účtu u FirstRead ukončete přihlašování přes Apple a příště zvolte „Sdílet můj e-mail“.";
    default:
      return "Přihlášení přes Apple se nepovedlo. Zkuste to prosím znovu.";
  }
}
