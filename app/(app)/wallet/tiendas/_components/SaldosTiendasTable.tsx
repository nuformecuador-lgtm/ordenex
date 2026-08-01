"use client";

import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { filasLocales } from "@/components/shared/descarga-resultado";
import type { SaldoTiendaResumenDTO } from "@/lib/types/wallet-tienda";

import { money } from "../../../mi-wallet/_components/mi-wallet-labels";
import {
  COLUMNAS_DESCARGA_SALDOS_TIENDAS,
  filaDescargaSaldoTienda,
} from "./saldos-tiendas-descarga-columnas";
import { SALDO_SIGNO_LABEL } from "./saldo-tienda-signo-label";

// Feature 43 (T16, R20/R21) — tabla de saldos a favor de TODAS las tiendas, para que el
// maestro liquide. Datos por props desde el Server Component padre (que ya valido rol
// maestro y pre-fetch, R21): el cliente NUNCA recibe Prisma.Decimal ni recalcula montos.
// Money-safe: la columna saldo renderiza el STRING tal cual con `money`. El saldo por
// tienda puede ser NEGATIVO (la tienda debe a Ordenex): el badge de signo lo distingue.

// Feature 170 (T D.1): la ETIQUETA sale de `saldo-tienda-signo-label` (módulo puro, sin
// React) para que el archivo de la descarga y esta tabla no puedan divergir (R8). Aquí solo
// queda lo que es de presentación: el color del badge.
const SIGNO_BADGE: Record<
  SaldoTiendaResumenDTO["signo"],
  { variant: "default" | "secondary" | "destructive" | "outline"; label: string }
> = {
  positivo: { variant: "default", label: SALDO_SIGNO_LABEL.positivo },
  negativo: { variant: "destructive", label: SALDO_SIGNO_LABEL.negativo },
  cero: { variant: "secondary", label: SALDO_SIGNO_LABEL.cero },
};

/** Color del monto del saldo segun su signo (verde a favor / rojo en contra / neutro). */
const SALDO_COLOR: Record<SaldoTiendaResumenDTO["signo"], string> = {
  positivo: "text-success-strong",
  negativo: "text-danger-strong",
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

/** Nombre visible del listado: hoja, base del archivo y nombre del control (R12/R13). */
const TITULO_DESCARGA = "Saldos de tiendas";

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
        ariaLabel={TITULO_DESCARGA}
        emptyMessage="No hay tiendas con saldo registrado."
        /**
         * Feature 170 (T D.1, R1/R7/R26/R30/R32) — descarga de FAMILIA B: el array de
         * props ES el dataset completo (el Server Component padre lo pide sin paginar), así
         * que el archivo se proyecta de lo que la tabla ya está pintando y NO se relee
         * nada del servidor.
         *
         * `filasLocales` aplica el MISMO tope de 5000 que la Familia A: por encima devuelve
         * un error accionable y NO produce archivo. Nunca un xlsx al que le faltan filas
         * sin avisar (R26/R28).
         */
        descarga={{
          titulo: TITULO_DESCARGA,
          columnas: COLUMNAS_DESCARGA_SALDOS_TIENDAS,
          obtenerFilas: () => filasLocales(tiendas, filaDescargaSaldoTienda),
        }}
      />
    </div>
  );
}
