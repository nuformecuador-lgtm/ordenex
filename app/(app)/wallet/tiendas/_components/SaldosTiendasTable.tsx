"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";

import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Pagination } from "@/components/shared/Pagination";
import { filasDesdeResultado } from "@/components/shared/descarga-resultado";
import { walletTiendaConfig } from "@/lib/config/wallet-tienda";
import {
  listarSaldosTiendasCompletoAction,
  listarSaldosTiendasPaginadoAction,
} from "@/lib/actions/wallet-tienda";
import type { SaldoTiendaResumenDTO } from "@/lib/types/wallet-tienda";

import { money } from "../../../mi-wallet/_components/mi-wallet-labels";
import { ENLACE_ESTADO_CUENTA_TIENDA } from "./estado-cuenta-tienda-labels";
import { claveSaldosTiendas } from "./saldos-tiendas-clave";
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
  {
    // FICHA 458-D (T D.2, R17, D14) — la fila ENLAZA al estado de cuenta de su tienda y deja de
    // desplegar el desglose: una sola lectura del dinero de cada tienda. El identificador va SOLO en
    // el `href` (D1); el nombre accesible empieza por el texto visible y dice de qué tienda es.
    id: "estadoCuenta",
    value: ENLACE_ESTADO_CUENTA_TIENDA.columna,
    render: (t) => (
      <Link
        href={`/wallet/tiendas/${t.tiendaId}`}
        aria-label={ENLACE_ESTADO_CUENTA_TIENDA.nombre(t.tiendaNombre)}
        className="rounded-sm text-primary underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none"
      >
        {ENLACE_ESTADO_CUENTA_TIENDA.visible}
      </Link>
    ),
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

  // Ficha 461 (auditoría P1): la clave sale del módulo compartido para que el bloque de pago del
  // desglose pueda refrescar ESTA tabla tras pagar o anular, sin importar este archivo.
  const { data, error } = useSWR(
    claveSaldosTiendas(page, pageSize),
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
         * CONJUNTO COMPLETO, y exige el mismo acceso total que la tabla: la descarga no
         * amplía lo que el actor podía ver (R7/R44). Por encima del tope de filas NO se
         * produce archivo, nunca un xlsx al que le faltan filas sin avisar (R26/R28).
         *
         * Feature 184 (T G.2, R1/R2/R5/R6) — ese conjunto sale ahora de la lectura DEDICADA
         * y no de releer `listarSaldosTiendasAction`. Consultas: las mismas dos, medido
         * (`progress/impl_184_tandaG_backend.md §1`). Lo que cambia son dos cosas que sí
         * importan: el tope pasa a decidirse en el SERVIDOR —el conjunto ya no cruza al
         * navegador para descartarlo allí— y el archivo sale ORDENADO como la tabla. La
         * relectura salía de `listarSaldosTodasTiendas`, que devuelve las filas en el orden
         * del planificador mientras la tabla ordena por nombre: la fila 26 del archivo no
         * era la primera de la página 2 y dos descargas seguidas podían diferir (R5).
         */
        descarga={{
          titulo: TITULO_DESCARGA,
          columnas: COLUMNAS_DESCARGA_SALDOS_TIENDAS,
          obtenerFilas: () =>
            filasDesdeResultado(
              listarSaldosTiendasCompletoAction(),
              filaDescargaSaldoTienda,
            ),
        }}
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
