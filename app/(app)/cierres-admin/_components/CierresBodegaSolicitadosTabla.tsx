"use client";

import { useState } from "react";
import useSWR from "swr";

import { DataTable, type Column } from "@/components/shared/DataTable";
import { Pagination } from "@/components/shared/Pagination";
import { filasDelConjuntoCompleto } from "@/components/shared/descarga-resultado";
import { cierreBodegaConfig } from "@/lib/config/cierre-bodega";
import {
  listarConsolidacion,
  listarCierresBodegaSolicitadosPaginado,
} from "@/lib/actions/cierre-bodega";
import type { CierreBodegaResumen } from "@/lib/interfaces/services/ICierreBodegaService";

import {
  money,
  ESTADO_LABEL,
  PAGO_MENSAJERO_COL,
  INGRESO_BODEGA_RECHAZOS_COL,
} from "./cierre-detalle-shared";
import {
  COLUMNAS_DESCARGA_BODEGA_SOLICITADOS,
  filaDescargaBodegaSolicitado,
} from "./cierres-bodega-descarga-columnas";

/**
 * Feature 170 — FASE 2 (T I.2, R43/R44/R52): «Cierres de bodega solicitados», el histórico
 * propio de la zona del `adminSatelite` (feature 40, F1.4-h), paginado en el servidor. Molde:
 * `UsuariosModule`.
 *
 * POR QUÉ VIVE EN SU PROPIO ARCHIVO: `ConsolidacionBodegaModule` muestra, junto a esta tabla,
 * el contador de los consolidables —derivado de `consolidables.length`—, correcto hoy y de la
 * tanda J. La guardia de T H.3 prohíbe —con razón— que un contador derivado de un array
 * conviva con un control de paginación en el mismo archivo.
 *
 * El alcance por ZONA lo resuelve el servidor desde la sesión, nunca un parámetro de la
 * petición: no hay forma de pedir la página del histórico de otra bodega (R44).
 */

/** La página que pre-carga el Server Component (R44: es la que el usuario ve al entrar). */
export interface CierresBodegaSolicitadosPagina {
  items: CierreBodegaResumen[];
  total: number;
  pageSize: number;
}

export interface CierresBodegaSolicitadosTablaProps {
  /** Página 1 resuelta server-side; alimenta el `fallbackData` de SWR. */
  initialData: CierresBodegaSolicitadosPagina;
}

/** Nombre visible de la tabla: hoja, base del archivo y nombre del control (R12/R13). */
const TITULO_DESCARGA = "Cierres de bodega solicitados";
/** Nombre accesible del control (R43). Propio: la pantalla monta varias tablas. */
export const PAGINACION_BODEGA_SOLICITADOS_LABEL =
  "Paginación de los cierres de bodega solicitados";
const ERROR_CARGA = "No se pudieron cargar los cierres de bodega solicitados.";

// R40: el tamaño sale de la config del dominio (T H.1), nunca de un literal de pantalla.
const PAGE_SIZE_OPTIONS = [10, 25, 50].filter(
  (s) => s <= cierreBodegaConfig.MAX_PAGE_SIZE,
);

async function leerPagina(
  page: number,
  pageSize: number,
): Promise<CierresBodegaSolicitadosPagina> {
  const res = await listarCierresBodegaSolicitadosPaginado({ page, pageSize });
  if (res.status !== "ok") throw new Error(res.status);
  return { items: res.items, total: res.total, pageSize: res.pageSize };
}

export function CierresBodegaSolicitadosTabla({
  initialData,
}: Readonly<CierresBodegaSolicitadosTablaProps>) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialData.pageSize);

  const { data, error } = useSWR(
    ["cierres-bodega:solicitados", page, pageSize],
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
    <section
      aria-label="Cierres de bodega solicitados"
      className="flex flex-col gap-3"
    >
      <h3 className="text-base font-semibold">Cierres de bodega solicitados</h3>
      <div className="overflow-x-auto">
        <DataTable
          columns={COLUMNAS_PASADOS}
          data={data?.items ?? []}
          rowKey="cierreBodegaId"
          ariaLabel="Cierres de bodega solicitados"
          emptyMessage="Aún no has solicitado ningún cierre de bodega."
          isLoading={cargando}
          error={error ? ERROR_CARGA : null}
          /**
           * Feature 170 (T I.2, R52) — la tabla pinta UNA página; el archivo sigue siendo el
           * CONJUNTO COMPLETO de SU zona. Se relee con el MISMO listado que la pantalla ya
           * llamaba antes de paginar (`listarConsolidacion`), que resuelve la zona desde la
           * sesión: descargar no amplía el alcance ni una fila (R14/R44).
           */
          descarga={{
            titulo: TITULO_DESCARGA,
            columnas: COLUMNAS_DESCARGA_BODEGA_SOLICITADOS,
            obtenerFilas: () =>
              filasDelConjuntoCompleto(
                listarConsolidacion().then((res) =>
                  res.status === "ok"
                    ? ({ status: "ok", items: res.cierresBodegaPasados } as const)
                    : res,
                ),
                filaDescargaBodegaSolicitado,
              ),
          }}
        />
      </div>

      <Pagination
        page={page}
        pageSize={pageSize}
        total={data?.total ?? 0}
        disabled={cargando}
        showFirstLast
        siblingCount={1}
        ariaLabel={PAGINACION_BODEGA_SOLICITADOS_LABEL}
        onPageChange={setPage}
        onPageSizeChange={(s) => {
          setPageSize(s);
          setPage(1);
        }}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
      />
    </section>
  );
}

// --- Columnas del histórico de cierres de bodega (solo lectura, F1.4-h). Promovidas TAL
// CUAL desde `ConsolidacionBodegaModule`: esta tabla enseña la fecha de SOLICITUD (R44). ---
const COLUMNAS_PASADOS: Column<CierreBodegaResumen>[] = [
  { id: "estado", value: "Estado", render: (c) => ESTADO_LABEL[c.estado] },
  {
    id: "solicitadoAt",
    value: "Fecha solicitud",
    render: (c) => c.solicitadoAt.slice(0, 10),
  },
  {
    id: "cantidadCierres",
    value: "Cierres del día",
    render: (c) => String(c.cantidadCierres),
  },
  {
    id: "general",
    value: "Total general",
    render: (c) => money(c.totales.general),
  },
  {
    id: "pagoMensajero",
    value: PAGO_MENSAJERO_COL,
    render: (c) => money(c.totalPagoMensajero),
  },
  {
    id: "ingresoBodegaRechazos",
    value: INGRESO_BODEGA_RECHAZOS_COL,
    render: (c) => money(c.totalIngresoBodegaRechazos),
  },
  {
    id: "motivoRechazo",
    value: "Motivo",
    render: (c) => c.motivoRechazo ?? "—",
  },
];
