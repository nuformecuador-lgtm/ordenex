import type { ReactNode } from "react";
import { Sidebar } from "./_components/Sidebar";
import { ToastProvider } from "@/providers/ToastProvider";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";

export default async function AppLayout({ children }: { children: ReactNode }) {
  // El rol se resuelve SOLO server-side (patrón `app/(app)/page.tsx`) para que el
  // Sidebar muestre las entradas por rol (feature 36/R9). La página igual valida
  // el rol como defensa real.
  const actor = await resolveActorFromSession();

  return (
    <ToastProvider>
      <div className="flex flex-1 flex-col md:flex-row">
        <Sidebar rol={actor?.rol} />
        <main className="flex flex-1 flex-col">{children}</main>
      </div>
    </ToastProvider>
  );
}
