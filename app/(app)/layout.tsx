import type { ReactNode } from "react";
import { Sidebar } from "./_components/Sidebar";
import { ToastProvider } from "@/providers/ToastProvider";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { itemsVisibles, SIDEBAR_ITEMS } from "@/lib/auth/menu-visibility";
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

  return (
    <ToastProvider>
      <SidebarProvider>
        <Sidebar items={items} />
        <SidebarInset>
          <SidebarTrigger className={"relative md:hidden"} />
          {children}
        </SidebarInset>
      </SidebarProvider>
    </ToastProvider>
  );
}
