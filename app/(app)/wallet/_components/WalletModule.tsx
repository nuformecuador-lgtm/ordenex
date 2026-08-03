"use client";

import { useState } from "react";

import { Pagination } from "@/components/shared/Pagination";
import { filasDesdeResultado } from "@/components/shared/descarga-resultado";
import { useToast } from "@/hooks/useToast";
import {
  listarMovimientosAction,
  listarMovimientosCompletoAction,
  verResumenCajaAction,
} from "@/lib/actions/wallet";
import { verDesgloseEgresosAction } from "@/lib/actions/wallet-egresos";
import type {
  CajaResumenDTO,
  DesgloseEgresosDTO,
  WalletMovimientoDTO,
} from "@/lib/types/wallet";

import { CajaResumenCard } from "./CajaResumenCard";
import { WalletLedger } from "./WalletLedger";
import { filaDescargaMovimientoCaja } from "./wallet-ledger-descarga-columnas";
import { WalletFiltros, FILTROS_VACIOS, type WalletFiltrosValue } from "./WalletFiltros";
import { RegistrarMovimientoManualDialog } from "./RegistrarMovimientoManualDialog";
import { RegistrarEgresoAdministrativoDialog } from "./RegistrarEgresoAdministrativoDialog";
import { DesgloseEgresosCard } from "./DesgloseEgresosCard";
import {
  GastosFijosPlantillasPanel,
  type GastosFijosPlantillasPagina,
} from "./GastosFijosPlantillasPanel";

// Feature 42 (T12, R18/R20/R21) — módulo cliente de la wallet. Recibe TODO por props
// desde el Server Component padre (que ya validó rol y pre-fetch, R21): el cliente NUNCA
// recibe Prisma.Decimal ni recalcula montos. Al cambiar filtros o página recarga libro +
// resumen + desglose por Server Action (lectura interna, NO fetch a /api); las cifras de la
// cabecera y el desglose reflejan el conjunto filtrado (R20/R11). Errores → toast.
//
// Feature 45 (T10, R11/R23) — se añaden: el diálogo de EGRESO administrativo manual, la
// tarjeta de DESGLOSE de egresos por tipo (recargada con los mismos filtros que el libro) y
// el panel CRUD de PLANTILLAS de gasto fijo. Registrar/reversar/editar plantilla refresca la
// vista sin recarga manual (R23). Money-safe: los montos viajan y se renderizan como STRING.
//
// Feature 173 (T G.3, R58/R59) — la cabecera pasa de UNA cifra a las DOS de `verResumenCaja`,
// y el módulo deja de hablar con el borde viejo (que ya no existe: lo retiró esta task). El
// DTO viaja entero hasta la tarjeta —incluida la bandera `periodoFiltrado` del rótulo
// condicional `[P7]`—, así que aquí no se decide ningún rótulo ni se toca ningún importe.

export interface WalletModuleProps {
  movimientos: WalletMovimientoDTO[];
  total: number;
  page: number;
  pageSize: number;
  /** Feature 173 (R58): las DOS cifras de la caja para el conjunto filtrado, ya derivadas. */
  resumen: CajaResumenDTO;
  desglose: DesgloseEgresosDTO;
  /**
   * Feature 170 — FASE 2 (T I.2, R40/R41): PÁGINA 1 de las plantillas de gasto fijo, ya
   * resuelta server-side, más el `total` del conjunto. El panel pide las siguientes.
   */
  plantillas: GastosFijosPlantillasPagina;
}

/** Construye el input de las actions omitiendo los filtros vacíos (enum/fecha). */
function buildInput(filtros: WalletFiltrosValue, page: number, pageSize: number): Record<string, unknown> {
  const input: Record<string, unknown> = { page, pageSize };
  if (filtros.tipo) input.tipo = filtros.tipo;
  if (filtros.categoria) input.categoria = filtros.categoria;
  if (filtros.desde) input.desde = filtros.desde;
  if (filtros.hasta) input.hasta = filtros.hasta;
  return input;
}

/**
 * Feature 170 (T C.4, R10/R18) — input del modo COMPLETO: los MISMOS filtros vigentes que
 * el listado, SIN `page`/`pageSize`. No se reusa `buildInput` con un `delete` después: el
 * schema del modo completo es `.strict()` y una paginación colada devolvería
 * `validation_error` en vez de un archivo. Aquí no hay nada que quitar porque no se pone.
 */
function buildInputCompleto(filtros: WalletFiltrosValue): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  if (filtros.tipo) input.tipo = filtros.tipo;
  if (filtros.categoria) input.categoria = filtros.categoria;
  if (filtros.desde) input.desde = filtros.desde;
  if (filtros.hasta) input.hasta = filtros.hasta;
  return input;
}

export function WalletModule({
  movimientos: initialMovimientos,
  total: initialTotal,
  page: initialPage,
  pageSize,
  resumen: initialResumen,
  desglose: initialDesglose,
  plantillas,
}: WalletModuleProps) {
  const toast = useToast();

  const [movimientos, setMovimientos] = useState(initialMovimientos);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(initialPage);
  const [resumen, setResumen] = useState(initialResumen);
  const [desglose, setDesglose] = useState(initialDesglose);
  const [filtros, setFiltros] = useState<WalletFiltrosValue>(FILTROS_VACIOS);
  const [loading, setLoading] = useState(false);

  /** Traduce un status de error de dominio a un toast accionable. */
  function manejarError(status: "forbidden" | "unauthenticated" | "validation_error") {
    if (status === "forbidden") {
      toast.error("No tenés permiso para ver la wallet.");
    } else if (status === "unauthenticated") {
      toast.error("Tu sesión expiró. Iniciá sesión de nuevo.");
    } else {
      toast.error("Los filtros no son válidos. Revisá el rango de fechas.");
    }
  }

  /** Recarga libro + las dos cifras + desglose para los filtros/página dados (R20/R11). */
  async function recargar(next: WalletFiltrosValue, nextPage: number) {
    const input = buildInput(next, nextPage, pageSize);
    setLoading(true);
    try {
      const [movRes, resRes, desRes] = await Promise.all([
        listarMovimientosAction(input),
        verResumenCajaAction(input),
        verDesgloseEgresosAction(input),
      ]);

      if (movRes.status !== "ok") {
        manejarError(movRes.status);
        return;
      }
      if (resRes.status !== "ok") {
        manejarError(resRes.status);
        return;
      }
      if (desRes.status !== "ok") {
        manejarError(desRes.status);
        return;
      }

      setMovimientos(movRes.data.movimientos);
      setTotal(movRes.data.total);
      setPage(movRes.data.page);
      setResumen(resRes.resumen);
      setDesglose(desRes.desglose);
      setFiltros(next);
    } finally {
      setLoading(false);
    }
  }

  function aplicarFiltros(value: WalletFiltrosValue) {
    void recargar(value, 1); // nuevos filtros → vuelve a la primera página
  }

  function limpiarFiltros() {
    void recargar(FILTROS_VACIOS, 1);
  }

  function cambiarPagina(nextPage: number) {
    void recargar(filtros, nextPage);
  }

  return (
    <div className="flex flex-col gap-8">
      {/* R59: el nombre accesible de la sección también cambia — la palabra que mentía no se
          queda escondida en el árbol de accesibilidad, que para quien usa lector de pantalla
          ES la pantalla. */}
      <section
        aria-label="Resumen de la caja y acciones"
        className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"
      >
        <div className="flex flex-col gap-4 lg:max-w-2xl lg:flex-1">
          <CajaResumenCard resumen={resumen} />
          <DesgloseEgresosCard desglose={desglose} />
        </div>
        <div className="flex flex-col gap-2 sm:flex-row lg:flex-col">
          <RegistrarMovimientoManualDialog
            onRegistrado={() => void recargar(filtros, page)}
          />
          <RegistrarEgresoAdministrativoDialog
            onRegistrado={() => void recargar(filtros, page)}
          />
        </div>
      </section>

      <section aria-label="Gastos fijos">
        {/* Feature 170 — FASE 2 (T I.2): el panel pagina su propio listado y relee su página
            tras cada cambio del CRUD (R23); la wallet ya no guarda la lista en su estado. */}
        <GastosFijosPlantillasPanel initialData={plantillas} />
      </section>

      <section aria-label="Libro de movimientos" className="flex flex-col gap-4">
        <WalletFiltros
          onAplicar={aplicarFiltros}
          onLimpiar={limpiarFiltros}
          disabled={loading}
        />

        {/* Feature 170 (T C.4, R9/R10): la descarga trae el libro ENTERO con los filtros
            VIGENTES, no la página pintada. El callback se construye EN EL RENDER (design
            §5), así que cierra sobre los `filtros` de ESTE render: aplicar un filtro y
            descargar sin más no puede entregar el conjunto anterior. */}
        <WalletLedger
          movimientos={movimientos}
          isLoading={loading}
          onReversado={() => void recargar(filtros, page)}
          obtenerFilasDescarga={() =>
            filasDesdeResultado(
              listarMovimientosCompletoAction(buildInputCompleto(filtros)),
              filaDescargaMovimientoCaja,
            )
          }
        />

        <Pagination
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={cambiarPagina}
          disabled={loading}
          ariaLabel="Paginación del libro"
        />
      </section>
    </div>
  );
}
