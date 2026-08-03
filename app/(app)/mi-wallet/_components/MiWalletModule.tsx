"use client";

import { useState } from "react";

import { Pagination } from "@/components/shared/Pagination";
import { filasDesdeResultado } from "@/components/shared/descarga-resultado";
import { useToast } from "@/hooks/useToast";
import {
  listarMisMovimientosAction,
  listarMisMovimientosCompletoAction,
} from "@/lib/actions/wallet-tienda";
import type {
  DesgloseTiendaDTO,
  SaldoTiendaDTO,
  WalletTiendaMovimientoDTO,
} from "@/lib/types/wallet-tienda";

import { SaldoTiendaCard } from "./SaldoTiendaCard";
import { DesgloseTiendaLedger } from "./DesgloseTiendaLedger";
import { filaDescargaMiWallet } from "./mi-wallet-descarga-columnas";
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
  /**
   * Feature 172 (T G.2, R55) — los tres importes de la cabecera, ya clasificados y sumados en
   * el servidor sobre el MISMO conjunto filtrado que el listado (R22 de la 43). Se recarga con
   * los movimientos, no se recalcula aqui: en el cliente no se opera con dinero.
   */
  desglose: DesgloseTiendaDTO;
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

/**
 * Feature 170 (T C.4, R10/R18) — input del modo COMPLETO: los MISMOS filtros vigentes, SIN
 * `page`/`pageSize`. El schema del modo completo es `.strict()`: una paginación colada
 * devolvería `validation_error` en vez de un archivo, así que no se pone (y no hay que
 * acordarse de quitarla).
 */
function buildInputCompleto(filtros: MiWalletFiltrosValue): Record<string, unknown> {
  const input: Record<string, unknown> = {};
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
  desglose: initialDesglose,
}: MiWalletModuleProps) {
  const toast = useToast();

  const [movimientos, setMovimientos] = useState(initialMovimientos);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(initialPage);
  const [saldo, setSaldo] = useState(initialSaldo);
  const [desglose, setDesglose] = useState(initialDesglose);
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
      // R55: los tres importes se refrescan CON el listado. Son cifras del mismo conjunto
      // filtrado y se leen juntas; dejar una vieja seria mezclar dos conjuntos en pantalla.
      setDesglose(res.data.desglose);
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
        <SaldoTiendaCard saldo={saldo} desglose={desglose} />
      </div>

      <section aria-label="Desglose de movimientos" className="flex flex-col gap-4">
        <MiWalletFiltros
          onAplicar={aplicarFiltros}
          onLimpiar={limpiarFiltros}
          disabled={loading}
        />

        {/* Feature 170 (T C.4, R9/R10): el archivo trae el ledger ENTERO de la tienda con
            los filtros vigentes, no la página. El callback se construye en el render, así
            que cierra sobre los `filtros` de ESTE render. */}
        <DesgloseTiendaLedger
          movimientos={movimientos}
          isLoading={loading}
          obtenerFilasDescarga={() =>
            filasDesdeResultado(
              listarMisMovimientosCompletoAction(buildInputCompleto(filtros)),
              filaDescargaMiWallet,
            )
          }
        />

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
