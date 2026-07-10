"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const SIDEBAR_ITEMS = [
  { label: "Configuración", href: "/configuracion" },
  { label: "Perfil", href: "/perfil" },
  { label: "Órdenes", href: "/ordenes" },
] as const;

type SidebarItem = (typeof SIDEBAR_ITEMS)[number];

export function Sidebar() {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);

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
        {SIDEBAR_ITEMS.map((item) => renderItem(item))}
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
          {SIDEBAR_ITEMS.map((item) => renderItem(item, () => setIsOpen(false)))}
        </ul>
      )}
    </nav>
  );
}
