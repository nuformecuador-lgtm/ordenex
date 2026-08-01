"use client";

import { Badge } from "@/components/ui/badge";
import {
  DataTable,
  type Column,
  type DescargaFilasResult,
} from "@/components/shared/DataTable";
import type { WalletTiendaMovimientoDTO } from "@/lib/types/wallet-tienda";

import { COLUMNAS_DESCARGA_MI_WALLET } from "./mi-wallet-descarga-columnas";
import { CATEGORIA_TIENDA_LABEL, TIPO_TIENDA_LABEL, money, origenLabel } from "./mi-wallet-labels";

// Feature 43 (T15, R18/R21) — DESGLOSE del ledger por cierre/concepto (tabla, mas reciente
// primero: el backend ya lo devuelve ordenado). Datos por props desde el modulo. Money-safe:
// la columna monto renderiza el STRING tal cual con `money`, sin parseFloat/Number. El signo
// del movimiento lo distingue el badge de tipo (credito a favor vs debito de Ordenex).

/** Badge de color por tipo: credito (verde/a favor) vs debito (rojo/descuento). */
function TipoBadge({ tipo }: { tipo: WalletTiendaMovimientoDTO["tipo"] }) {
  return (
    <Badge variant={tipo === "credito" ? "default" : "destructive"}>
      {TIPO_TIENDA_LABEL[tipo]}
    </Badge>
  );
}

/** Origen legible: tipo de origen + descripcion si la hay. */
function origenTexto(m: WalletTiendaMovimientoDTO): string {
  const base = origenLabel(m.origenTipo);
  return m.descripcion ? `${base} · ${m.descripcion}` : base;
}

const COLUMNS: Column<WalletTiendaMovimientoDTO>[] = [
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
    render: (m) => CATEGORIA_TIENDA_LABEL[m.categoria],
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

/** Nombre visible del desglose: hoja, base del archivo y nombre del control (R12/R13). */
const TITULO_DESCARGA = "Desglose de movimientos";

export interface DesgloseTiendaLedgerProps {
  movimientos: WalletTiendaMovimientoDTO[];
  isLoading?: boolean;
  /**
   * Feature 170 (T C.4, design §5) — obtiene las filas del ledger COMPLETO de la tienda.
   *
   * Callback, no filtros: esta tabla recibe la página por props y no conoce los filtros;
   * los conoce `MiWalletModule`, que cierra sobre ellos. Así este componente sigue sin
   * fetchear nada, que es lo que exige `docs/architecture.md` para una superficie con
   * datos de una sola tienda. Ausente ⇒ sin control, comportamiento anterior (R39).
   */
  obtenerFilasDescarga?: () => Promise<DescargaFilasResult>;
}

export function DesgloseTiendaLedger({
  movimientos,
  isLoading = false,
  obtenerFilasDescarga,
}: DesgloseTiendaLedgerProps) {
  return (
    <div className="overflow-x-auto">
      <DataTable
        columns={COLUMNS}
        data={movimientos}
        rowKey="id"
        ariaLabel={TITULO_DESCARGA}
        isLoading={isLoading}
        emptyMessage="No hay movimientos que coincidan con los filtros."
        // Feature 170 (T C.4, R1/R9/R13/R14): el archivo es el ledger de la tienda del
        // actor y de nadie más — quien lo acota es el servicio, con el `tienda_id` del
        // actor escrito al final del where; aquí no se puede ampliar ese alcance.
        descarga={
          obtenerFilasDescarga
            ? {
                titulo: TITULO_DESCARGA,
                columnas: COLUMNAS_DESCARGA_MI_WALLET,
                obtenerFilas: obtenerFilasDescarga,
              }
            : undefined
        }
      />
    </div>
  );
}
