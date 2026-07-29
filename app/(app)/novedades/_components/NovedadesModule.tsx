"use client";

import { useState } from "react";

import { ContactoButtons } from "@/components/shared/ContactoButtons";
import { IntentosDato, valorIntentos } from "@/components/shared/intentos-entrega";
import { Pagination } from "@/components/shared/Pagination";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/useToast";
import { listarNovedadesAction } from "@/lib/actions/novedades";
import { CAUSA_DEVOLUCION_LABEL } from "@/app/(app)/mis-asignaciones/_components/causa-devolucion-options";
import type { NovedadDTO } from "@/lib/types/novedad";

import { ReprogramarNovedadModal } from "./ReprogramarNovedadModal";

// Feature 87 (T12, design §3.2) — modulo cliente de `/novedades`. Recibe TODO por props
// desde el Server Component padre (que ya valido rol adminTienda y pre-fetch pagina 1, R18):
// componente PRIVADO (datos sensibles de la tienda por props, arquitectura §private). Por
// cada orden `devuelta` muestra la guia (o placeholder si `null`, R9), el destinatario, la
// causa con etiqueta ES (`CAUSA_DEVOLUCION_LABEL`, R7/R9/R11) y los `ContactoButtons`. Al
// cambiar de pagina re-fetch por Server Action `listarNovedadesAction({ page })` (lectura
// interna, NO fetch a /api; el telefono es PII), patron `MiWalletModule` (R22). Lista vacia
// -> estado vacio legible (R10).

export interface NovedadesModuleProps {
  items: NovedadDTO[];
  total: number;
  page: number;
  pageSize: number;
}

/** Etiqueta ES de la causa; NUNCA el slug crudo del enum (R11). `null` -> "Sin causa registrada" (R7). */
function causaLabel(causa: NovedadDTO["causa"]): string {
  return causa ? CAUSA_DEVOLUCION_LABEL[causa] : "Sin causa registrada";
}

export function NovedadesModule({
  items: initialItems,
  total: initialTotal,
  page: initialPage,
  pageSize,
}: NovedadesModuleProps) {
  const toast = useToast();

  const [items, setItems] = useState(initialItems);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(initialPage);
  const [loading, setLoading] = useState(false);
  // Feature 100 (T3.1): orden con el modal de reprogramación abierto (null = cerrado).
  const [ordenAReprogramar, setOrdenAReprogramar] = useState<NovedadDTO | null>(
    null,
  );

  /** T3.1: tras reprogramar con éxito la orden sale de `devuelta` -> se quita de la lista. */
  function handleReprogramada(ordenId: string) {
    setItems((prev) => prev.filter((n) => n.id !== ordenId));
    setTotal((prev) => Math.max(0, prev - 1));
  }

  /** Re-fetch de la pagina pedida por Server Action (R22). Errores -> toast, sin romper. */
  async function cambiarPagina(nextPage: number) {
    setLoading(true);
    try {
      const res = await listarNovedadesAction({ page: nextPage });
      if (res.status !== "ok") {
        if (res.status === "forbidden") {
          toast.error("No tenés permiso para ver las novedades.");
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
    // R10: estado vacio legible en vez de una lista sin filas.
    return (
      <div
        className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted/20 p-10 text-center"
        role="status"
      >
        <p className="text-base font-medium text-foreground">
          No tenés órdenes en devolución
        </p>
        <p className="text-sm text-muted-foreground">
          Cuando una de tus órdenes vuelva a la tienda, aparecerá acá con su causa y los
          botones de contacto.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ul aria-label="Órdenes en devolución" className="flex flex-col gap-3">
        {items.map((novedad) => (
          <li
            key={novedad.id}
            className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-xs sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium text-foreground">
                Guía{" "}
                {novedad.numGuia !== null ? (
                  novedad.numGuia
                ) : (
                  <span className="text-muted-foreground">sin asignar</span>
                )}
              </p>
              <p className="text-sm text-foreground">{novedad.destinatario}</p>
              <p className="text-sm text-muted-foreground">
                {causaLabel(novedad.causa)}
              </p>
              {/* Feature 160 (R18/R19/R26): esta pestaña es una lista de cards
                  (<ul>/<li>), NO un `DataTable`, así que el conteo va como DATO
                  ETIQUETADO con el mismo markup que sus líneas hermanas. Siempre
                  visible, `0` incluido; sin umbral (R20). */}
              <p className="text-sm text-muted-foreground">
                <IntentosDato intentos={valorIntentos(novedad)} />
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ContactoButtons
                telefono={novedad.telefonoDest}
                nombre={novedad.destinatario}
              />
              {/* T3.1 (R1): acción "Reprogramar" junto a los botones de contacto. */}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setOrdenAReprogramar(novedad)}
                aria-label={`Reprogramar la orden de ${novedad.destinatario}`}
              >
                Reprogramar
              </Button>
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
        ariaLabel="Paginación de novedades"
      />

      {/* T3.1/T3.2: modal de reprogramación (fecha + motivo opcional). Montado SOLO
          con orden activa y con `key`, para arrancar fresco en cada apertura. */}
      {ordenAReprogramar ? (
        <ReprogramarNovedadModal
          key={ordenAReprogramar.id}
          orden={ordenAReprogramar}
          onOpenChange={(open) => {
            if (!open) setOrdenAReprogramar(null);
          }}
          onReprogramada={handleReprogramada}
        />
      ) : null}
    </div>
  );
}
