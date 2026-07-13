"use client";

import type { ComponentType } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Package,
  Settings,
  User,
  type LucideProps,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SIDEBAR_ITEMS,
  type IconKey,
  type MenuItem,
} from "@/lib/auth/menu-visibility";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Sidebar as SidebarRoot,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { LogoutButton } from "@/app/_components/LogoutButton";

type SidebarIcon = ComponentType<LucideProps>;

/**
 * Botón circular de colapsar/expandir del sidebar en desktop. Va montado sobre
 * el borde derecho (patrón "rail"): mitad dentro, mitad fuera. Vive dentro del
 * <SidebarProvider> (se renderiza desde el layout), por lo que useSidebar()
 * tiene contexto. Se oculta en móvil: allí el off-canvas se controla con el
 * <SidebarTrigger>/Sheet de la cabecera.
 *
 * Color: mismo naranja que el <Button> por defecto ("Carga masiva") vía tokens
 * bg-primary / text-primary-foreground (--primary), sin hex hardcodeado.
 */
function SidebarCollapseToggle() {
  const { toggleSidebar, state } = useSidebar();
  const expanded = state === "expanded";
  // Expandido: el chevron apunta "hacia dentro" (izquierda) = acción colapsar.
  // Colapsado: apunta "hacia fuera" (derecha) = acción expandir.
  const Chevron = expanded ? ChevronLeft : ChevronRight;

  return (
    <button
      type="button"
      onClick={toggleSidebar}
      aria-label={expanded ? "Colapsar menú" : "Expandir menú"}
      // top-full + -translate-y-1/2 → centrado sobre la línea header/content.
      // right-0 (arista de padding del header sin borde = borde del sidebar) +
      // translate-x-1/2 → mitad del botón sobresale fuera. hidden md:flex → solo
      // desktop. z-20 para quedar sobre el sidebar-container (z-10).
      className={cn(
        "absolute top-full right-0 z-20 hidden size-7 -translate-y-1/2 translate-x-1/2",
        "md:flex items-center justify-center rounded-full cursor-pointer",
        "bg-primary text-primary-foreground shadow-sm",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <Chevron className="size-5" aria-hidden="true" />
    </button>
  );
}

// Mapa iconKey -> componente de lucide. Vive en el cliente porque los datos que
// cruzan el borde RSC (menu-visibility) solo traen la clave string serializable;
// aqui la resolvemos al render.
const ICON_BY_KEY: Record<IconKey, SidebarIcon> = {
  settings: Settings,
  user: User,
  package: Package,
  clipboardCheck: ClipboardCheck,
};

// El Sidebar reexporta los tipos de dominio del menu para consumidores/tests.
export type SidebarItem = MenuItem;
export type { MenuChild as SidebarChild } from "@/lib/auth/menu-visibility";
export { SIDEBAR_ITEMS } from "@/lib/auth/menu-visibility";

export function Sidebar({
  items = SIDEBAR_ITEMS,
}: {
  items?: readonly MenuItem[];
}) {
  const pathname = usePathname();

  return (
    <SidebarRoot collapsible="icon">
      {/* min-h-14 conserva el alto del logo al colapsar sin recortar el botón
          (que sobresale del borde); por eso NO se usa overflow-hidden aquí. */}
      <SidebarHeader className="px-3 py-4 relative min-h-14 justify-center">
        <span className="text-base font-semibold text-sidebar-foreground group-data-[collapsible=icon]:hidden">
          Ordenex
        </span>
        <SidebarCollapseToggle />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <nav aria-label="Navegación principal">
              <SidebarMenu>
                {items.map((item) => {
                  const Icon = ICON_BY_KEY[item.iconKey];
                  if (item.children && item.children.length > 0) {
                    const childActive = item.children.some(
                      (child) => pathname === child.href,
                    );

                    return (
                      <Collapsible
                        // El estado activo entra en el key: al cambiar de ruta,
                        // childActive puede pasar de false a true (o viceversa) y
                        // defaultOpen es no-controlado. Sin remontar, Base UI avisa
                        // "changing the default open state after being initialized".
                        // Incluir childActive fuerza una instancia nueva por estado,
                        // manteniendo el submenu no-controlado sin el warning.
                        key={`${item.href}:${childActive}`}
                        defaultOpen={childActive}
                        className="group/collapsible"
                        render={<SidebarMenuItem />}
                      >
                        <CollapsibleTrigger
                          render={
                            <SidebarMenuButton
                              isActive={childActive}
                              tooltip={item.label}
                            />
                          }
                        >
                          <Icon aria-hidden="true" />
                          <span>{item.label}</span>
                          <ChevronRight className="ml-auto transition-transform duration-200 group-data-[open]/collapsible:rotate-90" />
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <SidebarMenuSub>
                            {item.children.map((child) => {
                              const isActive = pathname === child.href;
                              return (
                                <SidebarMenuSubItem key={child.href}>
                                  <SidebarMenuSubButton
                                    isActive={isActive}
                                    render={
                                      <Link
                                        href={child.href}
                                        aria-current={
                                          isActive ? "page" : undefined
                                        }
                                      />
                                    }
                                  >
                                    <span>{child.label}</span>
                                  </SidebarMenuSubButton>
                                </SidebarMenuSubItem>
                              );
                            })}
                          </SidebarMenuSub>
                        </CollapsibleContent>
                      </Collapsible>
                    );
                  }
                  const isActive = pathname === item.href;
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        isActive={isActive}
                        tooltip={item.label}
                        render={
                          <Link
                            href={item.href}
                            aria-current={isActive ? "page" : undefined}
                          />
                        }
                      >
                        <Icon aria-hidden="true" />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </nav>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      {/* Footer con "Cerrar sesión" (feature 57): se reutiliza el LogoutButton
          existente TAL CUAL (logout() + router.push("/login") + estado
          "Cerrando sesión…"). Va fuera de <SidebarContent> y no depende de la
          prop `items`, por lo que aparece para todos los roles en cualquier
          página protegida (R1, R2). El shell solo se monta bajo sesión ⇒ no
          aparece en público (R3). El botón se estira a todo el ancho del footer
          (flex-col => align stretch); `overflow-hidden` evita que su texto se
          desborde fuera del sidebar en estado colapsado (collapsible="icon"). */}
      <SidebarFooter className="overflow-hidden">
        <LogoutButton />
      </SidebarFooter>
    </SidebarRoot>
  );
}
