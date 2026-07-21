"use client";

import type { ComponentType } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Home,
  Megaphone,
  Package,
  QrCode,
  Settings,
  Trophy,
  Truck,
  User,
  Wallet,
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

type SidebarIcon = ComponentType<LucideProps>;

/** Datos mínimos del usuario para el footer del sidebar. */
export interface SidebarUsuario {
  nombre: string;
  /** Etiqueta legible del rol (p. ej. "Maestro"). */
  rolLabel: string;
}

/**
 * Iniciales del nombre para el avatar: máx 2 letras. Con ≥2 palabras toma la
 * inicial de las dos primeras; con una sola, sus dos primeras letras. Mayúsculas.
 */
function iniciales(nombre: string): string {
  const palabras = nombre.trim().split(/\s+/).filter(Boolean);
  if (palabras.length === 0) return "?";
  if (palabras.length === 1) return palabras[0].slice(0, 2).toUpperCase();
  return (palabras[0][0] + palabras[1][0]).toUpperCase();
}

/**
 * Footer del sidebar (esquina inferior izquierda): avatar con iniciales + nombre y
 * rol debajo. Al colapsar (`collapsible=icon`) el texto se oculta y queda solo el
 * avatar, centrado.
 */
function SidebarUsuarioFooter({ usuario }: { usuario: SidebarUsuario }) {
  return (
    <SidebarFooter className="border-t border-sidebar-border p-2">
      <div className="flex items-center gap-2 rounded-md p-1 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0">
        <div
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sidebar-primary text-xs font-semibold text-sidebar-primary-foreground"
        >
          {iniciales(usuario.nombre)}
        </div>
        <div className="flex min-w-0 flex-col group-data-[collapsible=icon]:hidden">
          <span className="truncate text-sm font-medium text-sidebar-foreground">
            {usuario.nombre}
          </span>
          <span className="truncate text-xs text-sidebar-foreground/70">
            {usuario.rolLabel}
          </span>
        </div>
      </div>
    </SidebarFooter>
  );
}

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
        "focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
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
  home: Home,
  settings: Settings,
  user: User,
  package: Package,
  clipboardCheck: ClipboardCheck,
  truck: Truck,
  qrCode: QrCode,
  megaphone: Megaphone,
  trophy: Trophy,
  wallet: Wallet,
};

// El Sidebar reexporta los tipos de dominio del menu para consumidores/tests.
export type SidebarItem = MenuItem;
export type { MenuChild as SidebarChild } from "@/lib/auth/menu-visibility";
export { SIDEBAR_ITEMS } from "@/lib/auth/menu-visibility";

export function Sidebar({
  items = SIDEBAR_ITEMS,
  usuario = null,
}: {
  items?: readonly MenuItem[];
  /** Usuario autenticado para el footer (nombre + rol). `null` = sin sesión. */
  usuario?: SidebarUsuario | null;
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
      {usuario ? <SidebarUsuarioFooter usuario={usuario} /> : null}
    </SidebarRoot>
  );
}
