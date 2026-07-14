"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import type { OrderStatusLiteRow } from "@/lib/interfaces/repositories/IOrdenRepository";
import { listarOrderStatus } from "@/lib/actions/order-status";

import { OrdenesModule } from "./OrdenesModule";
import { OrdenesCargaMasivaButton } from "./OrdenesCargaMasivaButton";
import { ORDER_STATUS_LABELS } from "./EstatusBadge";

// Feature 63/C3 (F1.4-c): `exclude` es por `value` del estado; default
// `["pendiente"]` (borrador transitorio recién sembrado). El backend NO recibe
// `exclude`: `listarOrderStatus()` devuelve el catálogo COMPLETO (R1) y el front
// filtra antes de mapear a tabs (aclaración del humano, R14).
const DEFAULT_EXCLUDE = ["pendiente"];

/** Etiqueta legible del estado; cae al `value` crudo si no hay label conocido. */
function labelDe(value: string): string {
  return (ORDER_STATUS_LABELS as Record<string, string>)[value] ?? value;
}

async function catalogoFetcher(): Promise<OrderStatusLiteRow[]> {
  const res = await listarOrderStatus();
  if (res.status !== "ok") return [];
  return res.estatus;
}

/**
 * Feature 63/C3 (R12-R19): agrupa las órdenes por estado en tabs para roles ≠
 * mensajero. Deriva las tabs del catálogo `order_status` (SWR sobre
 * `listarOrderStatus()`) menos `exclude` (R14). Cada tab monta un `OrdenesModule`
 * (reuso, R19) con `filter={{status_id}}` propio, de modo que la caché y la
 * paginación son independientes por estado (R15/R17).
 *
 * LAZY LOADING DURO (R16): una tab NUNCA visitada NO monta su `OrdenesModule` y,
 * por ende, NO invoca `listarOrdenes`. El contenido de cada tab se monta SOLO la
 * primera vez que esa tab se activa (set `visited`); no basta con ocultarlo por
 * CSS. Al volver a una tab ya visitada, su `OrdenesModule` sigue montado
 * (`keepMounted`), conservando su estado/paginación y sirviendo de la caché SWR.
 */
export function OrdenesTabs({
  exclude = DEFAULT_EXCLUDE,
  puedeCargarMasiva = false,
  mostrarHistorial = false,
}: {
  exclude?: string[];
  puedeCargarMasiva?: boolean;
  mostrarHistorial?: boolean;
}) {
  const { data: catalogo, isLoading } = useSWR(
    "order-status:catalogo",
    catalogoFetcher,
  );

  // R14: tabs = catálogo − exclude (por value), en el orden determinista del
  // catálogo (R5). Se filtra en el front antes de mapear a tabs.
  const tabs = useMemo<OrderStatusLiteRow[]>(
    () => (catalogo ?? []).filter((s) => !exclude.includes(s.value)),
    [catalogo, exclude],
  );

  const [active, setActive] = useState<string | null>(null);
  // R16: solo las tabs efectivamente activadas alguna vez montan su contenido.
  const [visited, setVisited] = useState<Set<string>>(() => new Set());

  // Primera tab disponible = activa por defecto (y por tanto visitada), una vez
  // cargado el catálogo. Las demás quedan sin montar hasta ser visitadas.
  const activeValue = active ?? tabs[0]?.id ?? null;

  // Patrón "ajustar estado durante el render" (React): registra la tab activa
  // como visitada de forma persistente, sin un efecto post-paint. Una vez
  // visitada, la tab permanece en `visited` aunque deje de ser la activa, de
  // modo que su `OrdenesModule` sigue montado y conserva su paginación (R17).
  if (activeValue && !visited.has(activeValue)) {
    setVisited((prev) => {
      if (prev.has(activeValue)) return prev;
      const next = new Set(prev);
      next.add(activeValue);
      return next;
    });
  }

  // La carga masiva vive a nivel del contenedor (no por tab): es una acción de
  // creación de órdenes, independiente del estado activo. Se ofrece solo al
  // adminTienda (feature 26), vía `puedeCargarMasiva`.
  const header = puedeCargarMasiva ? (
    <div className="flex justify-end">
      <OrdenesCargaMasivaButton />
    </div>
  ) : null;

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <Skeleton className="h-40 w-full" data-testid="ordenes-tabs-loading" />
      </div>
    );
  }

  if (tabs.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <p className="text-sm text-muted-foreground">
          No hay estados disponibles.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {header}
      <Tabs
        value={activeValue}
        onValueChange={(value) => setActive(value as string)}
      >
        {/* R18: scroll horizontal usable con ~13 tabs (overflow-x-auto en TabsList). */}
        <TabsList aria-label="Órdenes por estado">
          {tabs.map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id}>
              {labelDe(tab.value)}
            </TabsTrigger>
          ))}
        </TabsList>

        {tabs.map((tab) => (
          // keepMounted: una vez montado (visitado) el panel permanece en el DOM
          // para conservar el estado del OrdenesModule (paginación) al cambiar de
          // tab (R17). Su contenido solo se monta si la tab fue visitada (R16).
          <TabsContent key={tab.id} value={tab.id} keepMounted>
            {visited.has(tab.id) ? (
              <OrdenesModule
                filter={{ status_id: tab.id }}
                mostrarHistorial={mostrarHistorial}
              />
            ) : null}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
