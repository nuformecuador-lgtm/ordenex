"use client"

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"

import { cn } from "@/lib/utils"

/**
 * Primitiva de Tabs (feature 63/C1, R12/R18). Este repo usa `@base-ui/react`
 * como capa de primitivas (style `base-nova` en components.json), igual que
 * `select.tsx`, `collapsible.tsx`, `sheet.tsx`, etc. — NO `@radix-ui`. Se
 * exponen los nombres canónicos de shadcn (`Tabs/TabsList/TabsTrigger/
 * TabsContent`) mapeados a las partes de base-ui (`Root/List/Tab/Panel`) para
 * mantener la API estable para los consumidores.
 */
function Tabs({ ...props }: Readonly<TabsPrimitive.Root.Props>) {
  return <TabsPrimitive.Root data-slot="tabs" {...props} />
}

/**
 * Contenedor de disparadores. R18: con muchas tabs (~13 tras excluir
 * `pendiente`) el contenedor permanece usable vía `overflow-x-auto` (scroll
 * horizontal), sin romper el layout ni ocultar tabs de forma inaccesible.
 */
function TabsList({
  className,
  ...props
}: Readonly<TabsPrimitive.List.Props>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        // Contenedor con fondo TRANSPARENTE (sin bg-muted/borde): el color vive en
        // los tabs, no en el contenedor.
        "scrollbar-on-hover flex w-full items-center gap-2 overflow-x-auto rounded-lg bg-transparent p-1",
        className,
      )}
      {...props}
    />
  )
}

function TabsTrigger({
  className,
  ...props
}: Readonly<TabsPrimitive.Tab.Props>) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-all outline-none select-none",
        "focus-visible:ring-3 focus-visible:ring-ring/50",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        // Tabs = botones de CONTORNO con la tinta del tema y relleno suave.
        // Inactiva: fondo transparente; el hover rellena suave (foreground/10).
        // Activa: MISMO fondo del hover (incluso al pasar el mouse), distinguida
        // por peso y sombra en vez de un relleno sólido.
        //
        // Feature 208: iban con `navy` fijo (borde, tinta y relleno). En claro
        // `--foreground` (#12233f) es prácticamente el mismo azul que `navy`
        // (#0b2545), así que el aspecto no cambia; en oscuro la tab pasa de 1.06:1
        // —invisible— a leerse, porque ahora la tinta gira con el tema.
        "border border-foreground bg-transparent text-foreground hover:bg-foreground/10",
        "aria-selected:bg-foreground/10 aria-selected:font-semibold aria-selected:shadow-sm aria-selected:hover:bg-foreground/10",
        className,
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: Readonly<TabsPrimitive.Panel.Props>) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn("mt-4 outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
