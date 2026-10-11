import type { ImageSource } from "./imageSource";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, { credentials: "same-origin", ...init });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string; message?: string };
    throw new ApiError(res.status, body.error ?? body.code ?? "error", body.message ?? "Něco se pokazilo. Zkuste to prosím znovu.");
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const send = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export type Me = {
  user: { id: string; email: string; name: string };
  balance: number;
  isAdmin: boolean;
  costs: { main: number; icon: number };
  /** Only for admins: engines to compare on the same prompt. */
  engines?: EngineOption[];
  /** Only for admins: what generations use when no engine is picked. */
  defaultEngine?: string | null;
};

export type EngineOption = { id: string; label: string; credits: number };
export type EngineSettings = { defaultEngine: string | null; engines: EngineOption[] };

export type LibraryImage = {
  id: string;
  origin: "upload" | "generated";
  mime: string;
  label: string | null;
  createdAt: string;
  url: string;
  /** Which engine drew it; null for uploads. */
  source?: ImageSource | null;
  /** In the free library now. */
  shared: boolean;
  /** Was ever shared, so other users' sheets may use it. */
  everShared: boolean;
};

export type SheetSummary = { id: string; templateId: string; title: string; createdAt: string; updatedAt: string };
export type Sheet<P = unknown> = SheetSummary & { params: P };
export type AdminUser = {
  id: string;
  email: string;
  createdAt: string;
  balance: number;
  generated: number;
  role: string | null;
  banned: boolean;
  emailVerified: boolean;
};

export type LoginMethods = { apple: boolean };

export const api = {
  loginMethods: () => request<LoginMethods>("/login-methods"),
  requestMagicLink: (email: string) =>
    request<{ status: boolean }>("/auth/sign-in/magic-link", send("POST", { email, callbackURL: "/" })),
  /** Returns Apple's sign-in page; Apple sends the browser back to "/", or to "/login?error=…". */
  startAppleSignIn: () =>
    request<{ url: string }>("/auth/sign-in/social", send("POST", { provider: "apple", callbackURL: "/", errorCallbackURL: "/login" })),
  signOut: () => request<unknown>("/auth/sign-out", send("POST", {})),
  acceptInvite: (token: string) => request<{ status: boolean }>("/auth/invite/accept", send("POST", { token })),

  me: () => request<Me>("/me"),

  sheets: () => request<SheetSummary[]>("/sheets"),
  sheet: <P>(id: string) => request<Sheet<P>>(`/sheets/${id}`),
  createSheet: (templateId: string, title: string, params: unknown) =>
    request<{ id: string }>("/sheets", send("POST", { templateId, title, params })),
  updateSheet: (id: string, title: string, params: unknown) => request<unknown>(`/sheets/${id}`, send("PUT", { title, params })),
  deleteSheet: (id: string) => request<void>(`/sheets/${id}`, { method: "DELETE" }),

  images: () => request<LibraryImage[]>("/images"),
  uploadImage: (file: File) =>
    request<LibraryImage>(`/images?label=${encodeURIComponent(file.name)}`, {
      method: "POST",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    }),
  deleteImage: (id: string) => request<void>(`/images/${id}`, { method: "DELETE" }),
  sharedImages: (slot: "main" | "icon") => request<LibraryImage[]>(`/shared-images?slot=${slot}`),
  setShared: (id: string, shared: boolean) =>
    request<{ shared: boolean; everShared: boolean }>(`/admin/images/${id}/shared`, send("PUT", { shared })),

  generate: (slot: "main" | "icon", prompt: string, referenceImageId?: string | null, engine?: string) =>
    request<{ image: LibraryImage; source: ImageSource; balance: number }>(
      "/generations",
      send("POST", { slot, prompt, referenceImageId, ...(engine && { engine }) }),
    ),

  adminUsers: () => request<AdminUser[]>("/admin/users"),
  adminSettings: () => request<EngineSettings>("/admin/settings"),
  saveAdminSettings: (defaultEngine: string | null) => request<EngineSettings>("/admin/settings", send("PUT", { defaultEngine })),
  adminGrant: (email: string, amount: number, note: string) =>
    request<{ balance: number }>("/admin/grant", send("POST", { email, amount, note })),
  adminInvite: (email: string) => request<{ email: string; resent: boolean }>("/admin/invites", send("POST", { email })),
  adminBan: (id: string) => request<void>(`/admin/users/${id}/ban`, { method: "POST" }),
  adminUnban: (id: string) => request<void>(`/admin/users/${id}/unban`, { method: "POST" }),
};
