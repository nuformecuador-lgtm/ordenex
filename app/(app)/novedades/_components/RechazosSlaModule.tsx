"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Pagination } from "@/components/shared/Pagination";
import { useToast } from "@/hooks/useToast";
import { listarRechazosSlaTiendaAction } from "@/lib/actions/rechazos-sla-tienda";
import type { RechazoSlaTiendaDTO } from "@/lib/types/rechazo-sla-tienda";

// Feature 102 (T12, design §6.2) — sección/pestaña de solo-lectura "Rechazadas por SLA" DENTRO
// de `/novedades` (Q3 default: pantalla que la tienda YA visita, sin ítem de menú nuevo). Es la
// continuación natural de la orden que "se graduó" de novedad a rechazo por vencimiento de SLA.
// Componente PRIVADO (datos sensibles de la tienda por props, arquitectura §private): el Server
// Component padre YA validó rol `adminTienda` y pre-fetch de la página 1 (R12/R13). Por cada orden
// muestra la guía (o placeholder si `null`, R14), la remisión, el destinatario y su MONTO de
// rechazo (56); `monto === null` → "pendiente de cierre" (Q2 default). Money-safe: el monto llega
// como STRING y se renderiza tal cual, NUNCA se parsea a número. Al cambiar de página re-fetch por
// Server Action `listarRechazosSlaTiendaAction({ page })` (lectura interna, NO fetch a /api),
// patrón `NovedadesModule` (R14). Lista vacía → estado vacío legible.

// --- Etiquetas i18n-ready (texto separado de la lógica) ---
const GUIA_LABEL = "Guía";
const GUIA_SIN_ASIGNAR_LABEL = "sin asignar";
const REMISION_LABEL = "Remisión";
/** Q2 default: la gestión sintética SLA aún no se snapshotea en un cierre → monto no disponible. */
const MONTO_PENDIENTE_LABEL = "Pendiente de cierre";
const LISTA_ARIA_LABEL = "Órdenes rechazadas por plazo vencido";
const VACIO_TITULO = "No tenés órdenes rechazadas por plazo vencido";
const VACIO_DETALLE =
  "Cuando una de tus órdenes en devolución llegue a rechazo por vencerse el plazo, aparecerá acá con su monto.";
const PAGINACION_ARIA_LABEL = "Paginación de rechazos por plazo vencido";

export interface RechazosSlaModuleProps {
  items: RechazoSlaTiendaDTO[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Monto del rechazo (STRING money-safe, escala 2): se le antepone el símbolo de colón SIN
 * parsear a número. `null` = la gestión SLA aún no está snapshoteada → "pendiente de cierre" (Q2).
 */
function montoLabel(monto: string | null): string {
  return monto === null ? MONTO_PENDIENTE_LABEL : `₡${monto}`;
}

export function RechazosSlaModule({
  items: initialItems,
  total: initialTotal,
  page: initialPage,
  pageSize,
}: RechazosSlaModuleProps) {
  const toast = useToast();

  const [items, setItems] = useState(initialItems);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(initialPage);
  const [loading, setLoading] = useState(false);

  /** Re-fetch de la página pedida por Server Action. Errores → toast, sin romper la vista. */
  async function cambiarPagina(nextPage: number) {
    setLoading(true);
    try {
      const res = await listarRechazosSlaTiendaAction({ page: nextPage });
      if (res.status !== "ok") {
        if (res.status === "forbidden") {
          toast.error("No tenés permiso para ver los rechazos por plazo vencido.");
        } else if (res.status === "unauthenticated") {
          toast.error("Tu sesión expiró. Iniciá sesión de nuevo.");
        } else {
          toast.error("No se pudo cargar la página. Intentá de nuevo.");
        }
        return;
      }
      setItems(res.items);
      setTotal(res.total);
      setPage(res.page);
    } finally {
      setLoading(false);
    }
  }

  if (items.length === 0) {
    // Estado vacío legible en vez de una lista sin filas.
    return (
      <div
        className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted/20 p-10 text-center"
        role="status"
      >
        <p className="text-base font-medium text-foreground">{VACIO_TITULO}</p>
        <p className="text-sm text-muted-foreground">{VACIO_DETALLE}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ul aria-label={LISTA_ARIA_LABEL} className="flex flex-col gap-3">
        {items.map((rechazo) => (
          <li
            key={rechazo.id}
            className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-xs sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium text-foreground">
                {GUIA_LABEL}{" "}
                {rechazo.numGuia !== null ? (
                  rechazo.numGuia
                ) : (
                  <span className="text-muted-foreground">
                    {GUIA_SIN_ASIGNAR_LABEL}
                  </span>
                )}
              </p>
              <p className="text-sm text-muted-foreground">
                {REMISION_LABEL} {rechazo.numRemision}
              </p>
              <p className="text-sm text-foreground">{rechazo.destinatario}</p>
            </div>
            <div className="flex items-center">
              {rechazo.monto === null ? (
                <Badge variant="outline">{MONTO_PENDIENTE_LABEL}</Badge>
              ) : (
                <span className="text-base font-semibold text-foreground">
                  {montoLabel(rechazo.monto)}
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>

      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={cambiarPagina}
        disabled={loading}
        ariaLabel={PAGINACION_ARIA_LABEL}
      />
    </div>
  );
}
