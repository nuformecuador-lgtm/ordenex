"use client";

import { useMemo, useState } from "react";
import { Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { cn } from "@/lib/utils";
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
// reciente primero, R18) usando el `renderExpanded` del `DataTable` (expand/collapse + a11y ya
// resueltos por la tabla). El filtro por mensajero de ESTA tabla opera client-side sobre la lista
// ya pre-obtenida (string, sin fetch ni aritmetica). Money-safe: los montos se renderizan TAL
// CUAL con `money`.

export interface CuentasPorPagarTableProps {
  mensajeros: CuentaPorPagarResumenDTO[];
}

// Columnas de la tabla-resumen (R18). Money-safe (R21/R27): los montos se pintan TAL CUAL con
// `money`, sin parseFloat/Number. El color/badge sale del signo ya calculado en el servidor.
const COLUMNS: Column<CuentaPorPagarResumenDTO>[] = [
  {
    id: "mensajero",
    value: COLUMNAS_MAESTRO.mensajero,
    render: (m) => <span className="font-medium">{m.mensajeroNombre}</span>,
  },
  {
    id: "devengado",
    value: COLUMNAS_MAESTRO.devengado,
    render: (m) => money(m.devengado),
  },
  {
    id: "pagado",
    value: COLUMNAS_MAESTRO.pagado,
    render: (m) => <span className="text-success-strong">{money(m.pagado)}</span>,
  },
  {
    id: "cuentaPorPagar",
    value: COLUMNAS_MAESTRO.cuentaPorPagar,
    render: (m) => (
      <span className={cn("font-medium", CUENTA_COLOR[m.signo])}>
        {money(m.cuentaPorPagar)}
      </span>
    ),
  },
  {
    id: "estado",
    value: COLUMNAS_MAESTRO.estado,
    render: (m) => {
      const badge = SIGNO_BADGE[m.signo];
      return <Badge variant={badge.variant}>{badge.label}</Badge>;
    },
  },
];

export function CuentasPorPagarTable({ mensajeros }: CuentasPorPagarTableProps) {
  const [busqueda, setBusqueda] = useState("");

  // Filtro client-side por nombre (case-insensitive). Solo comparacion de strings: no toca
  // montos (money-safe) ni hace fetch (los datos ya llegaron por props).
  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (q === "") return mensajeros;
    return mensajeros.filter((m) => m.mensajeroNombre.toLowerCase().includes(q));
  }, [mensajeros, busqueda]);

  return (
    <div className="flex flex-col gap-4">
      <CuentasPorPagarFiltros value={busqueda} onChange={setBusqueda} />

      <DataTable
        columns={COLUMNS}
        data={filtrados}
        rowKey="mensajeroId"
        ariaLabel="Cuentas por pagar a mensajeros"
        emptyState={{
          icon: Users,
          title: "No hay cuentas por pagar",
          description:
            "Cuando un mensajero tenga montos devengados o pagados, aparecerá aquí con su cuenta por pagar.",
        }}
        renderExpanded={(m) => (
          <DesglosePagosMensajero
            resumen={m}
            id={`desglose-${m.mensajeroId}`}
          />
        )}
        expandAriaLabel={(m) => `Ver desglose de ${m.mensajeroNombre}`}
      />
    </div>
  );
}
