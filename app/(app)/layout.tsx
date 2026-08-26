import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { Sidebar } from "./_components/Sidebar";
import { ToastProvider } from "@/providers/ToastProvider";
import { AvisoVersionNueva } from "@/components/shared/AvisoVersionNueva";
import { TemaProvider } from "@/providers/TemaProvider";
import { COOKIE_TEMA, normalizarTema } from "@/lib/tema/tema";
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

  // Feature 211 — el tema se resuelve EN EL SERVIDOR, aquí y no en el layout raíz.
  // Aquí ya se estaba leyendo la sesión, así que este layout ya era dinámico y la cookie
  // no cuesta nada; hacerlo arriba volvería dinámica la landing pública, que hoy es
  // estática y se cachea. Al llegar el HTML con la clase puesta no hay parpadeo: no se
  // corrige nada después del primer pintado porque no hay nada que corregir.
  const tema = normalizarTema((await cookies()).get(COOKIE_TEMA)?.value);

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
    <TemaProvider temaInicial={tema}>
      <ToastProvider>
        <SidebarProvider>
          <Sidebar items={items} usuario={usuario} />
          {/* overflow-x-clip: la columna de contenido nunca empuja el ancho más
              allá del viewport (evita scroll horizontal accidental en responsive).
              El contenido genuinamente ancho (tablas) scrollea dentro de su propio
              contenedor overflow-x-auto, así que este clip no lo recorta. clip (no
              hidden) para no convertir el main en contenedor de scroll vertical. */}
          {/* `pb-12` (48px): aire al final de TODAS las páginas del portal. Sin él, el
              último elemento queda pegado al borde inferior y, en el módulo del mensajero,
              debajo del botón flotante del chat. */}
          {/* `data-rol` + `group/app`: el rol del actor viaja por CSS hasta el `PageHeader`,
              que se tiñe con un color claro distinto por portal (pedido humano). Se pone aquí
              porque es el único sitio que ya resuelve al actor; el header sigue siendo
              presentación pura, usable desde páginas server y client. */}
          <SidebarInset
            data-rol={actor?.rol}
            className="group/app overflow-x-clip pb-12"
          >
            <SidebarTrigger className={"relative md:hidden"} />
            {children}
          </SidebarInset>
        </SidebarProvider>
        {/* Feature 284 — aviso de version nueva del service worker. Va en el portal y no en el
            layout raiz: aqui viven las sesiones de trabajo (y la PWA instalada), y el layout
            raiz cubre ademas la landing publica, que hoy es estatica y no necesita este JS.
            El componente decide solo cuando pintarse; mientras el usuario tenga algo a medias
            no aparece. */}
        <AvisoVersionNueva />
      </ToastProvider>
    </TemaProvider>
  );
}
