import type { ReactNode } from "react";
import { Sidebar } from "./_components/Sidebar";
import { ToastProvider } from "@/providers/ToastProvider";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { itemsVisibles, SIDEBAR_ITEMS } from "@/lib/auth/menu-visibility";
import { ROL_LABELS } from "@/lib/auth/rol-label";
import { UserRepository } from "@/lib/repositories/UserRepository";
import { getPrismaClient } from "@/lib/db/prisma-client";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";

export default async function AppLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  const actor = await resolveActorFromSession();
  const items = itemsVisibles(SIDEBAR_ITEMS, actor);

  // Datos del usuario para el footer del sidebar (nombre + rol legible). Se resuelve
  // el nombre por id (el actor solo trae usuarioId + rol). Sin sesión -> null.
  const usuarioRow = actor
    ? await new UserRepository(getPrismaClient()).findById(actor.usuarioId)
    : null;
  const usuario =
    actor && usuarioRow
      ? { nombre: usuarioRow.nombre, rolLabel: ROL_LABELS[actor.rol] }
      : null;

  return (
    <ToastProvider>
      <SidebarProvider>
        <Sidebar items={items} usuario={usuario} />
        <SidebarInset>
          <SidebarTrigger className={"relative md:hidden"} />
          {children}
        </SidebarInset>
      </SidebarProvider>
    </ToastProvider>
  );
}
