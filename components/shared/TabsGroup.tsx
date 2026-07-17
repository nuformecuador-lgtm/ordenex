"use client";

import { useId, useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export interface TabItem {
  /** Identificador único de la tab; es el valor que viaja en `value`/`onValueChange`. */
  value: string;
  /** Texto visible de la tab. También es el texto sobre el que filtra la versión vertical. */
  label: string;
  /** Contenido del panel. Si se omite, el consumidor renderiza el panel por su cuenta. */
  content?: React.ReactNode;
  /** Deshabilita la tab sin sacarla del listado. */
  disabled?: boolean;
}

export interface TabsGroupProps {
  /** Tabs a renderizar, en orden. */
  items: TabItem[];
  /** Orientación. `vertical` añade el input de filtro sobre el listado. Default `horizontal`. */
  orientation?: "horizontal" | "vertical";
  /** Tab activa (modo controlado). Si se omite, el componente lleva su propio estado. */
  value?: string;
  /** Tab activa inicial en modo no controlado. Default: la primera tab habilitada. */
  defaultValue?: string;
  /** Emite la tab seleccionada. */
  onValueChange?: (value: string) => void;
  /**
   * Muestra el input de filtro. Solo aplica a `vertical` (en horizontal se ignora,
   * porque el listado ya scrollea en el eje X). Default `true` en vertical.
   */
  filterable?: boolean;
  /** Placeholder del input de filtro. Default "Filtrar…". */
  filterPlaceholder?: string;
  /** Texto cuando el filtro no deja ninguna tab. Default "Sin coincidencias". */
  emptyFilterMessage?: string;
  /**
   * Mantiene en el DOM el panel de las tabs ya visitadas al cambiar de tab, en vez
   * de desmontarlo. Úsalo cuando el panel tenga estado propio que deba sobrevivir
   * (p. ej. la paginación de una tabla). Default `false`.
   */
  keepMounted?: boolean;
  /** Nombre accesible del listado de tabs. */
  ariaLabel?: string;
  className?: string;
}

/** Normaliza para comparar sin acentos ni mayúsculas (es-CR: "guía" ≡ "guia"). */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/**
 * Grupo de tabs reutilizable sobre la primitiva `components/ui/tabs`. Dos
 * versiones:
 *
 * - `horizontal`: listado en fila, con scroll en X cuando hay muchas tabs.
 * - `vertical`: listado en columna a la izquierda del panel, precedido por un
 *   input que filtra las tabs por su `label`. El filtro no cambia la selección:
 *   la tab activa se mantiene en el listado aunque no coincida (además de ser
 *   más claro para el usuario, base-ui desmonta el panel si su trigger deja de
 *   renderizarse).
 *
 * Funciona controlado (`value` + `onValueChange`) o no controlado (`defaultValue`).
 */
export function TabsGroup({
  items,
  orientation = "horizontal",
  value,
  defaultValue,
  onValueChange,
  filterable = true,
  filterPlaceholder = "Filtrar…",
  emptyFilterMessage = "Sin coincidencias",
  keepMounted = false,
  ariaLabel,
  className,
}: Readonly<TabsGroupProps>) {
  const isVertical = orientation === "vertical";
  const showFilter = isVertical && filterable;
  const filterId = useId();
  const [query, setQuery] = useState("");

  const firstEnabled = items.find((item) => !item.disabled)?.value;
  const initialValue = defaultValue ?? firstEnabled;
  const [uncontrolled, setUncontrolled] = useState(initialValue);
  const active = value ?? uncontrolled;

  const { visibleItems, matchCount } = useMemo(() => {
    const needle = showFilter ? normalize(query.trim()) : "";
    if (needle === "") return { visibleItems: items, matchCount: items.length };
    const matches = items.filter((item) => normalize(item.label).includes(needle));
    // La activa se queda en el listado aunque no coincida: sacarla desmontaría su panel.
    const withActive = items.filter(
      (item) => item.value === active || matches.includes(item),
    );
    return { visibleItems: withActive, matchCount: matches.length };
  }, [items, query, showFilter, active]);

  return (
    <Tabs
      value={active}
      onValueChange={(next) => {
        setUncontrolled(String(next));
        onValueChange?.(String(next));
      }}
      orientation={orientation}
      className={cn(isVertical && "flex items-start gap-4", className)}
    >
      <div className={cn(isVertical && "flex w-56 shrink-0 flex-col gap-2")}>
        {showFilter ? (
          <>
            <label htmlFor={filterId} className="sr-only">
              {filterPlaceholder}
            </label>
            <Input
              id={filterId}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={filterPlaceholder}
            />
          </>
        ) : null}

        {/* Sin alto fijo: el listado crece con sus tabs y es la página la que scrollea.
            Un `max-h` acá metía un segundo scroll dentro del de la página. */}
        <TabsList
          aria-label={ariaLabel}
          className={cn(isVertical && "flex-col items-stretch overflow-x-hidden")}
        >
          {visibleItems.map((item) => (
            <TabsTrigger
              key={item.value}
              value={item.value}
              disabled={item.disabled}
              // `min-w-0` habilita el truncado: sin esto el hijo flex se niega a
              // encogerse por debajo de su contenido y el label desborda la columna.
              className={cn(isVertical && "w-full min-w-0 justify-start")}
              // El label truncado deja de ser legible completo: el title lo recupera al
              // pasar el mouse (el nombre accesible sigue siendo el texto entero).
              title={isVertical ? item.label : undefined}
            >
              {isVertical ? (
                <span className="truncate">{item.label}</span>
              ) : (
                item.label
              )}
            </TabsTrigger>
          ))}
        </TabsList>

        {showFilter && matchCount === 0 ? (
          <p className="px-1 py-2 text-sm text-muted-foreground">
            {emptyFilterMessage}
          </p>
        ) : null}
      </div>

      <div className={cn(isVertical && "min-w-0 flex-1")}>
        {items
          .filter((item) => item.content !== undefined)
          .map((item) => (
            <TabsContent
              key={item.value}
              value={item.value}
              keepMounted={keepMounted}
              className={cn(isVertical && "mt-0")}
            >
              {item.content}
            </TabsContent>
          ))}
      </div>
    </Tabs>
  );
}
