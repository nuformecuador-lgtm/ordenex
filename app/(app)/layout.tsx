import type { ReactNode } from "react";
import { Sidebar } from "./_components/Sidebar";
import { ToastProvider } from "@/providers/ToastProvider";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { itemsVisibles, SIDEBAR_ITEMS } from "@/lib/auth/menu-visibility";

export default async function AppLayout({ children }: { children: ReactNode }) {
  // Se resuelve una sola vez por carga (los layouts no re-renderizan en la
  // navegacion soft del App Router) y se filtran los items del menu por rol.
  const actor = await resolveActorFromSession();
  const items = itemsVisibles(SIDEBAR_ITEMS, actor);

  return (
    <ToastProvider>
      <div className="flex flex-1 flex-col md:flex-row">
        <Sidebar items={items} />
        <main className="flex flex-1 flex-col">{children}</main>
      </div>
    </ToastProvider>
  );
}
