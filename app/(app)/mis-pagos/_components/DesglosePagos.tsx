"use client";

import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/shared/DataTable";
import type { PagoMensajeroMovimientoDTO } from "@/lib/types/wallet-mensajero";

import {
  CATEGORIA_PAGO_LABEL,
  TIPO_PAGO_LABEL,
  money,
  origenLabel,
} from "./mis-pagos-labels";

// Feature 44 (T15, R20/R21) — DESGLOSE del libro de pagos del mensajero por cierre/concepto
// (tabla, mas reciente primero: el backend ya lo devuelve ordenado y acotado a su
// mensajero_id, R20). Datos por props desde el modulo. Money-safe: la columna monto renderiza
// el STRING tal cual con `money`, sin parseFloat/Number. El signo del movimiento lo distingue
// el badge de tipo (devengo = lo devengado vs pago = lo ya entregado).

/** Badge de color por tipo: devengo (lo devengado) vs pago (lo ya entregado). */
function TipoBadge({ tipo }: { tipo: PagoMensajeroMovimientoDTO["tipo"] }) {
  return (
    <Badge variant={tipo === "pago" ? "default" : "secondary"}>
      {TIPO_PAGO_LABEL[tipo]}
    </Badge>
  );
}

/** Origen legible: tipo de origen + descripcion si la hay. */
function origenTexto(m: PagoMensajeroMovimientoDTO): string {
  const base = origenLabel(m.origenTipo);
  return m.descripcion ? `${base} · ${m.descripcion}` : base;
}

const COLUMNS: Column<PagoMensajeroMovimientoDTO>[] = [
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
    id: "concepto",
    value: "Concepto",
    render: (m) => CATEGORIA_PAGO_LABEL[m.categoria],
  },
  {
    id: "monto",
    value: "Monto",
    // Money-safe (R21/R27): STRING tal cual, sin parseFloat/Number.
    render: (m) => money(m.monto),
  },
  {
    id: "origen",
    value: "Origen",
    render: (m) => origenTexto(m),
  },
];

export interface DesglosePagosProps {
  movimientos: PagoMensajeroMovimientoDTO[];
  isLoading?: boolean;
}

export function DesglosePagos({ movimientos, isLoading = false }: DesglosePagosProps) {
  return (
    <div className="overflow-x-auto">
      <DataTable
        columns={COLUMNS}
        data={movimientos}
        rowKey="id"
        ariaLabel="Desglose de pagos"
        isLoading={isLoading}
        emptyMessage="No hay pagos que coincidan con los filtros."
      />
    </div>
  );
}
