"use client";

import { useState } from "react";

import { Pagination } from "@/components/shared/Pagination";
import { useToast } from "@/hooks/useToast";
import { listarMisMovimientosAction } from "@/lib/actions/wallet-tienda";
import type { SaldoTiendaDTO, WalletTiendaMovimientoDTO } from "@/lib/types/wallet-tienda";

import { SaldoTiendaCard } from "./SaldoTiendaCard";
import { DesgloseTiendaLedger } from "./DesgloseTiendaLedger";
import {
  MiWalletFiltros,
  FILTROS_TIENDA_VACIOS,
  type MiWalletFiltrosValue,
} from "./MiWalletFiltros";

// Feature 43 (T15, R18/R21/R22) — modulo cliente del wallet POR TIENDA. Recibe TODO por
// props desde el Server Component padre (que ya valido rol adminTienda y pre-fetch, R21):
// el cliente NUNCA recibe Prisma.Decimal ni recalcula montos (sin fetch propio de datos
// sensibles). Al cambiar filtros o pagina recarga desglose + saldo por Server Action
// (lectura interna, NO fetch a /api); el saldo mostrado refleja el conjunto filtrado (R22).
// Errores (forbidden/unauthenticated/validation) se muestran con toast. Money-safe: los
// montos viajan y se renderizan como STRING. El saldo puede ser NEGATIVO.

export interface MiWalletModuleProps {
  movimientos: WalletTiendaMovimientoDTO[];
  total: number;
  page: number;
  pageSize: number;
  saldo: SaldoTiendaDTO;
}

/** Construye el input de la action omitiendo los filtros vacios (cierre/concepto/fecha). */
function buildInput(
  filtros: MiWalletFiltrosValue,
  page: number,
  pageSize: number,
): Record<string, unknown> {
  const input: Record<string, unknown> = { page, pageSize };
  if (filtros.cierreId) input.cierreId = filtros.cierreId;
  if (filtros.categoria) input.categoria = filtros.categoria;
  if (filtros.desde) input.desde = filtros.desde;
  if (filtros.hasta) input.hasta = filtros.hasta;
  return input;
}

export function MiWalletModule({
  movimientos: initialMovimientos,
  total: initialTotal,
  page: initialPage,
  pageSize,
  saldo: initialSaldo,
}: MiWalletModuleProps) {
  const toast = useToast();

  const [movimientos, setMovimientos] = useState(initialMovimientos);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(initialPage);
  const [saldo, setSaldo] = useState(initialSaldo);
  const [filtros, setFiltros] = useState<MiWalletFiltrosValue>(FILTROS_TIENDA_VACIOS);
  const [loading, setLoading] = useState(false);

  /** Traduce un status de error de dominio a un toast accionable. */
  function manejarError(status: "forbidden" | "unauthenticated" | "validation_error") {
    if (status === "forbidden") {
      toast.error("No tenés permiso para ver tu wallet.");
    } else if (status === "unauthenticated") {
      toast.error("Tu sesión expiró. Iniciá sesión de nuevo.");
    } else {
      toast.error("Los filtros no son válidos. Revisá el rango de fechas.");
    }
  }

  /** Recarga desglose + saldo (del conjunto filtrado) para los filtros/pagina dados (R22). */
  async function recargar(next: MiWalletFiltrosValue, nextPage: number) {
    const input = buildInput(next, nextPage, pageSize);
    setLoading(true);
    try {
      const res = await listarMisMovimientosAction(input);

      if (res.status !== "ok") {
        manejarError(res.status);
        return;
      }

      setMovimientos(res.data.movimientos);
      setTotal(res.data.total);
      setPage(res.data.page);
      setSaldo(res.data.saldo);
      setFiltros(next);
    } finally {
      setLoading(false);
    }
  }

  function aplicarFiltros(value: MiWalletFiltrosValue) {
    void recargar(value, 1); // nuevos filtros -> vuelve a la primera pagina
  }

  function limpiarFiltros() {
    void recargar(FILTROS_TIENDA_VACIOS, 1);
  }

  function cambiarPagina(nextPage: number) {
    void recargar(filtros, nextPage);
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="lg:max-w-md">
        <SaldoTiendaCard saldo={saldo} />
      </div>

      <section aria-label="Desglose de movimientos" className="flex flex-col gap-4">
        <MiWalletFiltros
          onAplicar={aplicarFiltros}
          onLimpiar={limpiarFiltros}
          disabled={loading}
        />

        <DesgloseTiendaLedger movimientos={movimientos} isLoading={loading} />

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
