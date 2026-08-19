"use client";

import { useState } from "react";
import type { FiltrosCierresBodega } from "@/lib/types/filtros-cierres";
import type { DataTableDescarga } from "@/components/shared/DataTable";
import useSWR from "swr";

import { Pagination } from "@/components/shared/Pagination";
import { filasDesdeResultado } from "@/components/shared/descarga-resultado";
import { cierreBodegaConfig } from "@/lib/config/cierre-bodega";
import {
  listarCierresBodegaSolicitadosCompleto,
  listarCierresBodegaSolicitadosPaginado,
} from "@/lib/actions/cierre-bodega";
import type { CierreBodegaResumen } from "@/lib/interfaces/services/ICierreBodegaService";

import { CierreBodegaFacturaResumen } from "./cierre-factura";
import { ListaComprobantes } from "./ListaComprobantes";
import {
  COLUMNAS_DESCARGA_BODEGA_SOLICITADOS,
  filaDescargaBodegaSolicitado,
} from "./cierres-bodega-descarga-columnas";

/**
 * Feature 170 — FASE 2 (T I.2, R43/R44/R52): «Cierres de bodega solicitados», el histórico
 * propio de la zona del `adminSatelite` (feature 40, F1.4-h), paginado en el servidor.
 *
 * Pedido humano del 2026-08-16 — DEJA DE SER UNA TABLA: cada cierre de bodega se lee como el
 * comprobante compacto de `cierre-factura`, el mismo que ve el maestro en su cola. Es la
 * MISMA hoja para la misma cosa: el adminSatelite y quien decide su cierre miran ahora el
 * mismo documento, en vez de dos tablas con columnas distintas.
 *
 * Este listado NO lleva acción: es solo lectura (F1.4-h). El decidir vive un nivel arriba.
 *
 * POR QUÉ SIGUE VIVIENDO EN SU PROPIO ARCHIVO: `ConsolidacionBodegaModule` muestra, junto a
 * este listado, el contador de los consolidables. La guardia de T H.3 prohíbe —con razón— que
 * un contador derivado de un array conviva con un control de paginación en el mismo archivo.
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

export interface CierresBodegaSolicitadosListaProps {
  /** Página 1 resuelta server-side; alimenta el `fallbackData` de SWR. */
  initialData: CierresBodegaSolicitadosPagina;
}

/** Nombre visible del listado: hoja, base del archivo y nombre del control (R12/R13). */
const TITULO_DESCARGA = "Cierres de bodega solicitados";
/** Nombre accesible del control (R43). Propio: la pantalla monta varios listados. */
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

/**
 * La configuración de descarga de «Cierres de bodega solicitados», para que la monte quien
 * pinta la fila de las pestañas (pedido humano del 2026-08-16: el botón va alineado con las pestañas, no en una
 * fila propia encima de la lista). Vive aquí, con el listado del que habla: el título, las
 * columnas y la lectura de la que sale el archivo son suyos.
 *
 * Feature 170 (T I.2, R52) — el listado pinta UNA página; el archivo es el CONJUNTO, cortado en
 * la BASE con el mismo criterio y el mismo orden que la página, y con el tope de filas evaluado
 * en el servidor (R6). El alcance lo aplica el servicio desde la sesión: descargar no amplía lo
 * que el actor podía ver (R44). Pedido humano del 2026-08-16: «el CONJUNTO» pasa a significar
 * «el conjunto FILTRADO» — los `filtros` viajan porque el usuario los puso; el alcance, nunca.
 */
export function descargaBodegaSolicitados(filtros: FiltrosCierresBodega): DataTableDescarga {
  return {
    titulo: TITULO_DESCARGA,
    columnas: COLUMNAS_DESCARGA_BODEGA_SOLICITADOS,
    obtenerFilas: () =>
      filasDesdeResultado(
        listarCierresBodegaSolicitadosCompleto({ filtros }),
        filaDescargaBodegaSolicitado,
      ),
  };
}

export function CierresBodegaSolicitadosLista({
  initialData,
}: Readonly<CierresBodegaSolicitadosListaProps>) {
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

  // R44: el esqueleto de carga se muestra sólo cuando NO hay nada que pintar (`isLoading` de
  // SWR sigue en `true` mientras revalida aunque haya `fallbackData`).
  const cargando = data === undefined;

  return (
    <section
      aria-label="Cierres de bodega solicitados"
      className="flex flex-col gap-3"
    >
      {/* Sin encabezado visible: la pestaña ya lo dice. El `aria-label` de la sección se
          queda —es el nombre para quien no ve la pantalla, y por el que lo localizan los tests—. */}
      <ListaComprobantes
        ariaLabel="Cierres de bodega solicitados"
        items={data?.items ?? []}
        clave={(c) => c.cierreBodegaId}
        isLoading={cargando}
        error={error ? ERROR_CARGA : null}
        emptyMessage="Aún no has solicitado ningún cierre de bodega."
        render={(c) => <CierreBodegaFacturaResumen cierre={c} />}
      />

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
