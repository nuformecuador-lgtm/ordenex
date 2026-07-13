"use client";

import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/shared/DataTable";
import type { WalletMovimientoDTO } from "@/lib/types/wallet";

import { CATEGORIA_LABEL, ORIGEN_LABEL, TIPO_LABEL, money } from "./wallet-labels";

// Feature 42 (T12, R18/R21) — libro de movimientos (tabla, más reciente primero: el
// backend ya lo devuelve ordenado). Datos por props desde el módulo. Money-safe: la
// columna monto renderiza el STRING tal cual con `money`, sin parseFloat/Number.

/** Badge de color por tipo: ingreso (verde/entra) vs egreso (rojo/sale). */
function TipoBadge({ tipo }: { tipo: WalletMovimientoDTO["tipo"] }) {
  return (
    <Badge variant={tipo === "ingreso" ? "default" : "destructive"}>
      {TIPO_LABEL[tipo]}
    </Badge>
  );
}

/** Origen legible: tipo de origen + descripción si la hay. */
function origenTexto(m: WalletMovimientoDTO): string {
  const base = ORIGEN_LABEL[m.origenTipo];
  return m.descripcion ? `${base} · ${m.descripcion}` : base;
}

const COLUMNS: Column<WalletMovimientoDTO>[] = [
  {
    id: "fecha",
    value: "Fecha",
    render: (m) => m.fechaMovimiento.slice(0, 10),
  },
  {
    id: "tipo",
    value: "Tipo",
    render: (m) => <TipoBadge tipo={m.tipo} />,
  },
  {
    id: "categoria",
    value: "Categoría",
    render: (m) => CATEGORIA_LABEL[m.categoria],
  },
  {
    id: "monto",
    value: "Monto",
    // Money-safe (R21/R25): STRING tal cual, sin parseFloat/Number.
    render: (m) => money(m.monto),
  },
  {
    id: "origen",
    value: "Origen",
    render: (m) => origenTexto(m),
  },
];

export interface WalletLedgerProps {
  movimientos: WalletMovimientoDTO[];
  isLoading?: boolean;
}

export function WalletLedger({ movimientos, isLoading = false }: WalletLedgerProps) {
  return (
    <div className="overflow-x-auto">
      <DataTable
        columns={COLUMNS}
        data={movimientos}
        rowKey="id"
        ariaLabel="Libro de movimientos"
        isLoading={isLoading}
        emptyMessage="No hay movimientos que coincidan con los filtros."
      />
    </div>
  );
}
