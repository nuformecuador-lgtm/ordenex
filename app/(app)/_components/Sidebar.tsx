"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface SidebarItem {
  label: string;
  href: string;
}

export const SIDEBAR_ITEMS: readonly SidebarItem[] = [
  { label: "Configuración", href: "/configuracion" },
  { label: "Perfil", href: "/perfil" },
  { label: "Órdenes", href: "/ordenes" },
] as const;

// Feature 36 (T18/R9): entradas visibles solo para ciertos roles. "Mis
// asignaciones" es exclusivo del rol `mensajero`; la página igual valida el rol
// server-side como defensa real (design §6).
const MIS_ASIGNACIONES_ITEM: SidebarItem = {
  label: "Mis asignaciones",
  href: "/mis-asignaciones",
};

/** Deriva los ítems del sidebar según el rol del actor (o base si no hay rol). */
export function sidebarItemsForRol(rol?: string): readonly SidebarItem[] {
  if (rol === "mensajero") return [...SIDEBAR_ITEMS, MIS_ASIGNACIONES_ITEM];
  return SIDEBAR_ITEMS;
}

export interface SidebarProps {
  /**
   * Rol del actor autenticado (resuelto server-side por el layout). Determina
   * las entradas visibles por rol (feature 36/R9). `undefined` → solo las base.
   */
  rol?: string;
}

export function Sidebar({ rol }: SidebarProps = {}) {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const items = sidebarItemsForRol(rol);

  const renderItem = (item: SidebarItem, onNavigate?: () => void) => {
    const isActive = pathname === item.href;
    return (
      <li key={item.href}>
        <Link
          href={item.href}
          aria-current={isActive ? "page" : undefined}
          onClick={onNavigate}
          className={cn(
            "block rounded-md border-l-2 border-transparent px-3 py-2 text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            isActive &&
              "border-sidebar-primary bg-sidebar-primary/15 text-sidebar-accent-foreground",
          )}
        >
          {item.label}
        </Link>
      </li>
    );
  };

  return (
    <nav
      aria-label="Navegación principal"
      className="flex flex-col gap-2 border-b border-sidebar-border bg-sidebar p-4 text-sidebar-foreground md:h-full md:w-60 md:border-r md:border-b-0"
    >
      {/* Control hamburguesa: visible solo en móvil (R7, R11, R16) */}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={isOpen ? "Cerrar menú" : "Abrir menú"}
        aria-expanded={isOpen}
        onClick={() => setIsOpen((prev) => !prev)}
        className="md:hidden"
      >
        {isOpen ? <X /> : <Menu />}
      </Button>

      {/*
        Listado de escritorio: siempre montado en el DOM; oculto en móvil vía
        Tailwind (hidden md:flex). Cubre R6 (visible sin acción en desktop).
      */}
      <ul
        data-testid="sidebar-desktop-list"
        className="hidden flex-col gap-1 md:flex"
      >
        {items.map((item) => renderItem(item))}
      </ul>

      {/*
        Listado móvil: montado únicamente cuando isOpen === true, de modo que su
        aparición/desaparición sea observable en el DOM (R8, R9, R10).
      */}
      {isOpen && (
        <ul
          data-testid="sidebar-mobile-list"
          className="flex flex-col gap-1 md:hidden"
        >
          {items.map((item) => renderItem(item, () => setIsOpen(false)))}
        </ul>
      )}
    </nav>
  );
}
