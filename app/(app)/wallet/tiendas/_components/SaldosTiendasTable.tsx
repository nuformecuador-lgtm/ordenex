"use client";

import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/shared/DataTable";
import type { SaldoTiendaResumenDTO } from "@/lib/types/wallet-tienda";

import { money } from "../../../mi-wallet/_components/mi-wallet-labels";

// Feature 43 (T16, R20/R21) — tabla de saldos a favor de TODAS las tiendas, para que el
// maestro liquide. Datos por props desde el Server Component padre (que ya valido rol
// maestro y pre-fetch, R21): el cliente NUNCA recibe Prisma.Decimal ni recalcula montos.
// Money-safe: la columna saldo renderiza el STRING tal cual con `money`. El saldo por
// tienda puede ser NEGATIVO (la tienda debe a Ordenex): el badge de signo lo distingue.

const SIGNO_BADGE: Record<
  SaldoTiendaResumenDTO["signo"],
  { variant: "default" | "secondary" | "destructive" | "outline"; label: string }
> = {
  positivo: { variant: "default", label: "A favor" },
  negativo: { variant: "destructive", label: "En contra" },
  cero: { variant: "secondary", label: "En cero" },
};

/** Color del monto del saldo segun su signo (verde a favor / rojo en contra / neutro). */
const SALDO_COLOR: Record<SaldoTiendaResumenDTO["signo"], string> = {
  positivo: "text-emerald-600 dark:text-emerald-400",
  negativo: "text-destructive",
  cero: "text-muted-foreground",
};

const COLUMNS: Column<SaldoTiendaResumenDTO>[] = [
  {
    id: "tiendaNombre",
    value: "Tienda",
    render: (t) => t.tiendaNombre,
  },
  {
    id: "saldo",
    value: "Saldo a favor",
    // Money-safe (R21/R27): STRING tal cual, sin parseFloat/Number.
    render: (t) => (
      <span className={`font-medium ${SALDO_COLOR[t.signo]}`}>{money(t.saldo)}</span>
    ),
  },
  {
    id: "signo",
    value: "Estado",
    render: (t) => {
      const badge = SIGNO_BADGE[t.signo];
      return <Badge variant={badge.variant}>{badge.label}</Badge>;
    },
  },
];

export interface SaldosTiendasTableProps {
  tiendas: SaldoTiendaResumenDTO[];
}

export function SaldosTiendasTable({ tiendas }: SaldosTiendasTableProps) {
  return (
    <div className="overflow-x-auto">
      <DataTable
        columns={COLUMNS}
        data={tiendas}
        rowKey="tiendaId"
        ariaLabel="Saldos de tiendas"
        emptyMessage="No hay tiendas con saldo registrado."
      />
    </div>
  );
}
