"use client";

import { useState } from "react";

import { Pagination } from "@/components/shared/Pagination";
import { useToast } from "@/hooks/useToast";
import { listarMovimientosAction, verBalanceAction } from "@/lib/actions/wallet";
import type { WalletBalanceDTO, WalletMovimientoDTO } from "@/lib/types/wallet";

import { WalletBalanceCard } from "./WalletBalanceCard";
import { WalletLedger } from "./WalletLedger";
import { WalletFiltros, FILTROS_VACIOS, type WalletFiltrosValue } from "./WalletFiltros";
import { RegistrarMovimientoManualDialog } from "./RegistrarMovimientoManualDialog";

// Feature 42 (T12, R18/R20/R21) — módulo cliente de la wallet. Recibe TODO por props
// desde el Server Component padre (que ya validó rol y pre-fetch, R21): el cliente NUNCA
// recibe Prisma.Decimal ni recalcula montos. Al cambiar filtros o página recarga libro +
// balance por Server Action (lectura interna, NO fetch a /api); el balance mostrado
// refleja el conjunto filtrado (R20). Errores (forbidden/unauthenticated/validation) se
// muestran con toast. Money-safe: los montos viajan y se renderizan como STRING.

export interface WalletModuleProps {
  movimientos: WalletMovimientoDTO[];
  total: number;
  page: number;
  pageSize: number;
  balance: WalletBalanceDTO;
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

export function WalletModule({
  movimientos: initialMovimientos,
  total: initialTotal,
  page: initialPage,
  pageSize,
  balance: initialBalance,
}: WalletModuleProps) {
  const toast = useToast();

  const [movimientos, setMovimientos] = useState(initialMovimientos);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(initialPage);
  const [balance, setBalance] = useState(initialBalance);
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

  /** Recarga libro + balance para los filtros/página dados (R20). */
  async function recargar(next: WalletFiltrosValue, nextPage: number) {
    const input = buildInput(next, nextPage, pageSize);
    setLoading(true);
    try {
      const [movRes, balRes] = await Promise.all([
        listarMovimientosAction(input),
        verBalanceAction(input),
      ]);

      if (movRes.status !== "ok") {
        manejarError(movRes.status);
        return;
      }
      if (balRes.status !== "ok") {
        manejarError(balRes.status);
        return;
      }

      setMovimientos(movRes.data.movimientos);
      setTotal(movRes.data.total);
      setPage(movRes.data.page);
      setBalance(balRes.balance);
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
      <section
        aria-label="Balance y acciones"
        className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"
      >
        <div className="lg:max-w-md lg:flex-1">
          <WalletBalanceCard balance={balance} />
        </div>
        <RegistrarMovimientoManualDialog
          onRegistrado={() => void recargar(filtros, page)}
        />
      </section>

      <section aria-label="Libro de movimientos" className="flex flex-col gap-4">
        <WalletFiltros
          onAplicar={aplicarFiltros}
          onLimpiar={limpiarFiltros}
          disabled={loading}
        />

        <WalletLedger movimientos={movimientos} isLoading={loading} />

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
