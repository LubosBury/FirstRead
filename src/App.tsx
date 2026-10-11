import { Loader2 } from "lucide-react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { AppShell } from "@/components/AppShell";
import { MeProvider, useMe } from "@/hooks/useMe";
import { Admin } from "@/pages/Admin";
import { Home } from "@/pages/Home";
import { InviteAccept } from "@/pages/InviteAccept";
import { Library } from "@/pages/Library";
import { Login } from "@/pages/Login";
import { SheetEditor } from "@/pages/SheetEditor";

function Gate() {
  const { me, loading } = useMe();
  if (loading) return <Loader2 className="mx-auto mt-32 h-8 w-8 animate-spin text-brand" />;
  if (!me) {
    return (
      <Routes>
        <Route path="/invite" element={<InviteAccept />} />
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/sheets/new/:templateId" element={<SheetEditor />} />
        <Route path="/sheets/:id" element={<SheetEditor />} />
        <Route path="/library" element={<Library />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <MeProvider>
        <Gate />
      </MeProvider>
    </BrowserRouter>
  );
}
