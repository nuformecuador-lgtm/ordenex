"use client";

import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { CuentaPorPagarResumenDTO } from "@/lib/types/wallet-mensajero";

import { CuentasPorPagarFiltros } from "./CuentasPorPagarFiltros";
import { DesglosePagosMensajero } from "./DesglosePagosMensajero";
import {
  COLUMNAS_MAESTRO,
  CUENTA_COLOR,
  SIGNO_BADGE,
  money,
} from "./wallet-mensajeros-labels";

// Feature 44 (T14, R18/R19/R21/R22) — tabla-resumen de CUENTAS POR PAGAR a mensajeros (una fila
// por mensajero: devengado / pagado / cuenta por pagar, con estado por signo). Datos por props
// desde el Server Component padre (que ya valido rol `maestro` y pre-fetch, R21): el cliente
// NUNCA recibe Prisma.Decimal ni recalcula montos. El maestro ve a TODOS los mensajeros (R19,
// no acotado). Cada fila EXPANDE su DESGLOSE POR CIERRE (`DesglosePagosMensajero`, paginado, mas
// reciente primero, R18) que se carga client-side y ofrece filtros server-side por fecha/cierre
// con el saldo del conjunto filtrado (R22). El filtro por mensajero de ESTA tabla opera
// client-side sobre la lista ya pre-obtenida (string, sin fetch ni aritmetica). Money-safe: los
// montos se renderizan TAL CUAL con `money`.

export interface CuentasPorPagarTableProps {
  mensajeros: CuentaPorPagarResumenDTO[];
}

export function CuentasPorPagarTable({ mensajeros }: CuentasPorPagarTableProps) {
  const [busqueda, setBusqueda] = useState("");
  const [expandido, setExpandido] = useState<string | null>(null);

  // Filtro client-side por nombre (case-insensitive). Solo comparacion de strings: no toca
  // montos (money-safe) ni hace fetch (los datos ya llegaron por props).
  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (q === "") return mensajeros;
    return mensajeros.filter((m) => m.mensajeroNombre.toLowerCase().includes(q));
  }, [mensajeros, busqueda]);

  function toggle(mensajeroId: string) {
    setExpandido((prev) => (prev === mensajeroId ? null : mensajeroId));
  }

  return (
    <div className="flex flex-col gap-4">
      <CuentasPorPagarFiltros value={busqueda} onChange={setBusqueda} />

      <div className="overflow-x-auto">
        <table
          aria-label="Cuentas por pagar a mensajeros"
          className="w-full border-collapse text-left text-sm"
        >
          <thead>
            <tr className="border-b">
              <th scope="col" className="w-8 px-3 py-2" aria-label="Expandir" />
              <th scope="col" className="px-3 py-2 font-medium text-muted-foreground">
                {COLUMNAS_MAESTRO.mensajero}
              </th>
              <th scope="col" className="px-3 py-2 font-medium text-muted-foreground">
                {COLUMNAS_MAESTRO.devengado}
              </th>
              <th scope="col" className="px-3 py-2 font-medium text-muted-foreground">
                {COLUMNAS_MAESTRO.pagado}
              </th>
              <th scope="col" className="px-3 py-2 font-medium text-muted-foreground">
                {COLUMNAS_MAESTRO.cuentaPorPagar}
              </th>
              <th scope="col" className="px-3 py-2 font-medium text-muted-foreground">
                {COLUMNAS_MAESTRO.estado}
              </th>
            </tr>
          </thead>
          <tbody>
            {filtrados.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-3 py-6 text-center text-sm text-muted-foreground"
                >
                  No hay mensajeros con cuentas por pagar registradas.
                </td>
              </tr>
            ) : (
              filtrados.map((m) => {
                const abierto = expandido === m.mensajeroId;
                const badge = SIGNO_BADGE[m.signo];
                const detalleId = `desglose-${m.mensajeroId}`;
                const Chevron = abierto ? ChevronDown : ChevronRight;
                return (
                  <Fragment key={m.mensajeroId}>
                    <tr className="border-b">
                      <td className="px-3 py-2 align-middle">
                        <button
                          type="button"
                          onClick={() => toggle(m.mensajeroId)}
                          aria-expanded={abierto}
                          aria-controls={detalleId}
                          aria-label={
                            abierto
                              ? `Ocultar desglose de ${m.mensajeroNombre}`
                              : `Ver desglose de ${m.mensajeroNombre}`
                          }
                          className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted"
                        >
                          <Chevron className="size-4" aria-hidden="true" />
                        </button>
                      </td>
                      <td className="px-3 py-2 align-middle font-medium">
                        {m.mensajeroNombre}
                      </td>
                      {/* Money-safe (R21/R27): STRING tal cual, sin parseFloat/Number. */}
                      <td className="px-3 py-2 align-middle">{money(m.devengado)}</td>
                      <td className="px-3 py-2 align-middle text-success-strong">
                        {money(m.pagado)}
                      </td>
                      <td
                        className={`px-3 py-2 align-middle font-medium ${CUENTA_COLOR[m.signo]}`}
                      >
                        {money(m.cuentaPorPagar)}
                      </td>
                      <td className="px-3 py-2 align-middle">
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                      </td>
                    </tr>
                    {abierto ? (
                      <tr className="border-b bg-muted/20">
                        <td colSpan={6} className="px-3 py-3">
                          <DesglosePagosMensajero resumen={m} id={detalleId} />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
