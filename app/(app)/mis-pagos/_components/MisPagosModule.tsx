"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Pagination } from "@/components/shared/Pagination";
import { useToast } from "@/hooks/useToast";
import { listarMisPagosAction } from "@/lib/actions/wallet-mensajero";
import type {
  CuentaPorPagarDTO,
  PagoMensajeroMovimientoDTO,
} from "@/lib/types/wallet-mensajero";

import { CuentaPorPagarCard } from "./CuentaPorPagarCard";
import { DesglosePagos } from "./DesglosePagos";

// Feature 44 (T15, R20/R21/R22) — modulo cliente de la vista propia del MENSAJERO. Recibe
// TODO por props desde el Server Component padre (que ya valido rol `mensajero` y pre-fetch,
// R21): el cliente NUNCA recibe Prisma.Decimal ni recalcula montos (sin fetch propio de datos
// sensibles). Al cambiar filtros o pagina recarga desglose + cuenta por Server Action
// (lectura interna, NO fetch a /api); el backend acota SIEMPRE a su mensajero_id en el WHERE
// (R20). La cuenta mostrada refleja el conjunto filtrado (R22). Errores
// (forbidden/unauthenticated/validation) se muestran con toast. Espejo de `MiWalletModule`.

/** Borrador de los filtros del desglose (cierre + rango de fechas). */
interface FiltrosPagos {
  cierreId: string;
  desde: string;
  hasta: string;
}

const FILTROS_VACIOS: FiltrosPagos = { cierreId: "", desde: "", hasta: "" };

export interface MisPagosModuleProps {
  movimientos: PagoMensajeroMovimientoDTO[];
  total: number;
  page: number;
  pageSize: number;
  cuenta: CuentaPorPagarDTO;
}

/** Construye el input de la action omitiendo los filtros vacios (cierre/fecha). */
function buildInput(
  filtros: FiltrosPagos,
  page: number,
  pageSize: number,
): Record<string, unknown> {
  const input: Record<string, unknown> = { page, pageSize };
  if (filtros.cierreId) input.cierreId = filtros.cierreId;
  if (filtros.desde) input.desde = filtros.desde;
  if (filtros.hasta) input.hasta = filtros.hasta;
  return input;
}

export function MisPagosModule({
  movimientos: initialMovimientos,
  total: initialTotal,
  page: initialPage,
  pageSize,
  cuenta: initialCuenta,
}: MisPagosModuleProps) {
  const toast = useToast();

  const [movimientos, setMovimientos] = useState(initialMovimientos);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(initialPage);
  const [cuenta, setCuenta] = useState(initialCuenta);
  const [filtros, setFiltros] = useState<FiltrosPagos>(FILTROS_VACIOS);
  const [draft, setDraft] = useState<FiltrosPagos>(FILTROS_VACIOS);
  const [loading, setLoading] = useState(false);

  /** Traduce un status de error de dominio a un toast accionable. */
  function manejarError(
    status: "forbidden" | "unauthenticated" | "validation_error",
  ) {
    if (status === "forbidden") {
      toast.error("No tenés permiso para ver tus pagos.");
    } else if (status === "unauthenticated") {
      toast.error("Tu sesión expiró. Iniciá sesión de nuevo.");
    } else {
      toast.error("Los filtros no son válidos. Revisá el rango de fechas.");
    }
  }

  /** Recarga desglose + cuenta (del conjunto filtrado) para los filtros/pagina dados (R22). */
  async function recargar(next: FiltrosPagos, nextPage: number) {
    const input = buildInput(next, nextPage, pageSize);
    setLoading(true);
    try {
      const res = await listarMisPagosAction(input);

      if (res.status !== "ok") {
        manejarError(res.status);
        return;
      }

      setMovimientos(res.data.movimientos);
      setTotal(res.data.total);
      setPage(res.data.page);
      setCuenta(res.data.cuenta);
      setFiltros(next);
    } finally {
      setLoading(false);
    }
  }

  function set<K extends keyof FiltrosPagos>(key: K, value: string) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function aplicarFiltros() {
    void recargar(draft, 1); // nuevos filtros -> vuelve a la primera pagina
  }

  function limpiarFiltros() {
    setDraft(FILTROS_VACIOS);
    void recargar(FILTROS_VACIOS, 1);
  }

  function cambiarPagina(nextPage: number) {
    void recargar(filtros, nextPage);
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="lg:max-w-md">
        <CuentaPorPagarCard cuenta={cuenta} />
      </div>

      <section aria-label="Desglose de pagos" className="flex flex-col gap-4">
        <form
          aria-label="Filtros del desglose"
          className="flex flex-wrap items-end gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            aplicarFiltros();
          }}
        >
          <div className="flex min-w-56 flex-col gap-1.5">
            <Label htmlFor="mis-pagos-filtro-cierre">Cierre</Label>
            <Input
              id="mis-pagos-filtro-cierre"
              type="text"
              value={draft.cierreId}
              onChange={(e) => set("cierreId", e.target.value)}
              disabled={loading}
              placeholder="ID del cierre"
              className="w-56"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mis-pagos-filtro-desde">Desde</Label>
            <Input
              id="mis-pagos-filtro-desde"
              type="date"
              value={draft.desde}
              onChange={(e) => set("desde", e.target.value)}
              disabled={loading}
              className="w-40"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mis-pagos-filtro-hasta">Hasta</Label>
            <Input
              id="mis-pagos-filtro-hasta"
              type="date"
              value={draft.hasta}
              onChange={(e) => set("hasta", e.target.value)}
              disabled={loading}
              className="w-40"
            />
          </div>

          <div className="flex items-center gap-2">
            <Button type="submit" disabled={loading}>
              Aplicar
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={loading}
              onClick={limpiarFiltros}
            >
              Limpiar
            </Button>
          </div>
        </form>

        <DesglosePagos movimientos={movimientos} isLoading={loading} />

        <Pagination
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={cambiarPagina}
          disabled={loading}
          ariaLabel="Paginación del desglose"
        />
      </section>
    </div>
  );
}
