"use client";

import { useState } from "react";
import useSWR from "swr";

import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Pagination } from "@/components/shared/Pagination";
import { filasDelConjuntoCompleto } from "@/components/shared/descarga-resultado";
import { walletTiendaConfig } from "@/lib/config/wallet-tienda";
import {
  listarSaldosTiendasAction,
  listarSaldosTiendasPaginadoAction,
} from "@/lib/actions/wallet-tienda";
import type { SaldoTiendaResumenDTO } from "@/lib/types/wallet-tienda";

import { money } from "../../../mi-wallet/_components/mi-wallet-labels";
import { DesgloseMovimientosTienda } from "./DesgloseMovimientosTienda";
import { DESGLOSE_TIENDA_NOMBRE } from "./desglose-tienda-labels";
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
/** Nombre accesible del control de paginación (R43). */
export const PAGINACION_SALDOS_LABEL = "Paginación de los saldos por tienda";
const ERROR_CARGA = "No se pudieron cargar los saldos por tienda.";

// R40: el tamaño sale de la config del dominio (T H.1), nunca de un literal de pantalla.
const PAGE_SIZE_OPTIONS = [10, 25, 50].filter(
  (s) => s <= walletTiendaConfig.MAX_PAGE_SIZE,
);

/** Feature 170 — FASE 2 (T I.2): la página de saldos tal como la devuelve el servidor. */
export interface SaldosTiendasPagina {
  items: SaldoTiendaResumenDTO[];
  total: number;
  pageSize: number;
}

export interface SaldosTiendasTableProps {
  /**
   * Feature 170 — FASE 2 (T I.2, R40/R41): PÁGINA 1 resuelta server-side + el `total` del
   * conjunto. Alimenta el `fallbackData` de SWR.
   */
  initialData: SaldosTiendasPagina;
}

async function leerPagina(
  page: number,
  pageSize: number,
): Promise<SaldosTiendasPagina> {
  const res = await listarSaldosTiendasPaginadoAction({ page, pageSize });
  if (res.status !== "ok") throw new Error(res.status);
  return { items: res.items, total: res.total, pageSize: res.pageSize };
}

export function SaldosTiendasTable({ initialData }: SaldosTiendasTableProps) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialData.pageSize);

  const { data, error } = useSWR(
    ["wallet-tiendas:saldos", page, pageSize],
    () => leerPagina(page, pageSize),
    {
      fallbackData:
        page === 1 && pageSize === initialData.pageSize ? initialData : undefined,
    },
  );

  // R44: el esqueleto de carga se muestra sólo cuando NO hay nada que pintar. `isLoading` de
  // SWR sigue siendo `true` mientras revalida aunque haya `fallbackData`, y usarlo tal cual
  // haría que la página 1 —la que el Server Component ya resolvió— apareciera como esqueleto
  // antes de enseñar las filas que el usuario veía antes de paginar.
  const cargando = data === undefined;

  return (
    <div className="overflow-x-auto">
      <DataTable
        columns={COLUMNS}
        data={data?.items ?? []}
        rowKey="tiendaId"
        ariaLabel={TITULO_DESCARGA}
        emptyMessage="No hay tiendas con saldo registrado."
        isLoading={cargando}
        error={error ? ERROR_CARGA : null}
        /**
         * Feature 170 (T I.2, R52) — la tabla pinta UNA página; el archivo sigue siendo el
         * CONJUNTO COMPLETO. Se relee con el MISMO listado que la pantalla ya llamaba antes
         * de paginar (`listarSaldosTiendasAction`), que exige el mismo acceso total: la
         * descarga no amplía lo que el actor podía ver (R7/R44).
         *
         * `filasDelConjuntoCompleto` conserva el tope de 5000 de `filasLocales`: por encima
         * devuelve un error accionable y NO produce archivo, nunca un xlsx al que le faltan
         * filas sin avisar (R26/R28).
         */
        descarga={{
          titulo: TITULO_DESCARGA,
          columnas: COLUMNAS_DESCARGA_SALDOS_TIENDAS,
          obtenerFilas: () =>
            filasDelConjuntoCompleto(
              listarSaldosTiendasAction().then((res) =>
                res.status === "ok"
                  ? ({ status: "ok", items: res.tiendas } as const)
                  : res,
              ),
              filaDescargaSaldoTienda,
            ),
        }}
        /**
         * Feature 171 (T2.4, R1/R2/R32/R33) — cada fila despliega el DESGLOSE de SU tienda.
         *
         * `renderExpanded` se INVOCA en cada render, pero el `DataTable` solo MONTA el
         * elemento cuando la fila está abierta; como el `useSWR` vive dentro de
         * `DesgloseMovimientosTienda`, listar N tiendas no dispara ninguna lectura de
         * desglose y abrir una fila dispara exactamente una, solo la de esa tienda.
         *
         * El nombre baja por props dentro de `resumen` (R35): esta fila ya lo tiene, y
         * pedírselo al servidor costaría una consulta por apertura para un dato conocido.
         *
         * Lo demás de la tabla no se toca: mismas columnas, mismos datos, mismo estado
         * vacío y la MISMA descarga sobre las props (R6).
         */
        renderExpanded={(t) => (
          <DesgloseMovimientosTienda resumen={t} id={`desglose-tienda-${t.tiendaId}`} />
        )}
        expandAriaLabel={(t) => DESGLOSE_TIENDA_NOMBRE.expandir(t.tiendaNombre)}
      />

      <Pagination
        page={page}
        pageSize={pageSize}
        total={data?.total ?? 0}
        disabled={cargando}
        showFirstLast
        siblingCount={1}
        ariaLabel={PAGINACION_SALDOS_LABEL}
        onPageChange={setPage}
        onPageSizeChange={(s) => {
          setPageSize(s);
          setPage(1);
        }}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
      />
    </div>
  );
}
