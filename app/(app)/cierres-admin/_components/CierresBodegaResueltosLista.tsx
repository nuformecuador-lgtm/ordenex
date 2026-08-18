"use client";

import { useState } from "react";
import type { FiltrosCierresBodega } from "@/lib/types/filtros-cierres";
import type { DataTableDescarga } from "@/components/shared/DataTable";
import useSWR from "swr";

import { Button } from "@/components/ui/button";
import { Pagination } from "@/components/shared/Pagination";
import { filasDesdeResultado } from "@/components/shared/descarga-resultado";
import { cierreBodegaConfig } from "@/lib/config/cierre-bodega";
import {
  listarHistoricoCierresBodegaCompleto,
  listarHistoricoCierresBodegaPaginado,
} from "@/lib/actions/cierre-bodega";
import type { CierreBodegaResumen } from "@/lib/interfaces/services/ICierreBodegaService";

import { CierreBodegaFacturaResumen } from "./cierre-factura";
import { ListaComprobantes } from "./ListaComprobantes";
import {
  COLUMNAS_DESCARGA_BODEGA_RESUELTOS,
  filaDescargaBodegaResuelto,
} from "./cierres-bodega-descarga-columnas";

/**
 * Feature 170 — FASE 2 (T I.2, R43/R44/R52): el HISTÓRICO de «Cierres de bodega resueltos»
 * (feature 40, R15), paginado en el servidor.
 *
 * Pedido humano del 2026-08-16 — DEJA DE SER UNA TABLA: cada cierre de bodega resuelto se lee
 * como el comprobante compacto de `cierre-factura`. Las nueve columnas siguen estando, cada
 * una en su sitio de la hoja: estado (badge), zona y quién solicitó (las partes), fecha
 * resuelta (columna «Fechas» del desglose), total general (cabecera), pago a mensajeros e
 * ingreso de bodega («Ajustes»), motivo de rechazo (línea propia) y la acción «Ver».
 *
 * POR QUÉ SIGUE VIVIENDO EN SU PROPIO ARCHIVO: `CierresBodegaAdminModule` enseña, junto a este
 * listado, el contador de su cola. La guardia de T H.3 prohíbe —con razón— que un contador
 * derivado de un array conviva con un control de paginación en el mismo archivo.
 */

/** La página que pre-carga el Server Component (R44: es la que el usuario ve al entrar). */
export interface CierresBodegaResueltosPagina {
  items: CierreBodegaResumen[];
  total: number;
  pageSize: number;
}

export interface CierresBodegaResueltosListaProps {
  /** Página 1 resuelta server-side; alimenta el `fallbackData` de SWR. */
  initialData: CierresBodegaResueltosPagina;
  /** Abre el detalle agregado del cierre de bodega (el modal vive en el módulo padre). */
  onAbrir: (cierreBodegaId: string) => void;
}

/** Nombre visible del listado: hoja, base del archivo y nombre del control (R12/R13). */
const TITULO_DESCARGA = "Cierres de bodega resueltos";
/** Nombre accesible del control (R43). Propio: la pantalla monta varios listados paginados. */
export const PAGINACION_BODEGA_RESUELTOS_LABEL =
  "Paginación de los cierres de bodega resueltos";
const ERROR_CARGA = "No se pudieron cargar los cierres de bodega resueltos.";

// R40: el tamaño sale de la config del dominio (T H.1), nunca de un literal de pantalla.
const PAGE_SIZE_OPTIONS = [10, 25, 50].filter(
  (s) => s <= cierreBodegaConfig.MAX_PAGE_SIZE,
);

async function leerPagina(
  page: number,
  pageSize: number,
): Promise<CierresBodegaResueltosPagina> {
  const res = await listarHistoricoCierresBodegaPaginado({ page, pageSize });
  if (res.status !== "ok") throw new Error(res.status);
  return { items: res.items, total: res.total, pageSize: res.pageSize };
}

/**
 * La configuración de descarga de «Cierres de bodega resueltos», para que la monte quien pinta
 * la fila de las pestañas (pedido humano del 2026-08-16: el botón va alineado con las pestañas, no en una
 * fila propia encima de la lista). Vive aquí, con el listado del que habla: el título, las
 * columnas y la lectura de la que sale el archivo son suyos.
 *
 * Feature 170 (T I.2, R52) — el listado pinta UNA página; el archivo es el CONJUNTO, cortado en
 * la BASE con el mismo criterio y el mismo orden que la página, y con el tope de filas evaluado
 * en el servidor (R6). El alcance lo aplica el servicio desde la sesión: descargar no amplía lo
 * que el actor podía ver (R44). Pedido humano del 2026-08-16: «el CONJUNTO» pasa a significar
 * «el conjunto FILTRADO» — los `filtros` viajan porque el usuario los puso; el alcance, nunca.
 */
export function descargaBodegaResueltos(filtros: FiltrosCierresBodega): DataTableDescarga {
  return {
    titulo: TITULO_DESCARGA,
    columnas: COLUMNAS_DESCARGA_BODEGA_RESUELTOS,
    obtenerFilas: () =>
      filasDesdeResultado(
        listarHistoricoCierresBodegaCompleto({ filtros }),
        filaDescargaBodegaResuelto,
      ),
  };
}

export function CierresBodegaResueltosLista({
  initialData,
  onAbrir,
}: Readonly<CierresBodegaResueltosListaProps>) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialData.pageSize);

  const { data, error } = useSWR(
    ["cierres-bodega:resueltos", page, pageSize],
    () => leerPagina(page, pageSize),
    {
      fallbackData:
        page === 1 && pageSize === initialData.pageSize ? initialData : undefined,
    },
  );

  // R44: el esqueleto de carga se muestra sólo cuando NO hay nada que pintar. `isLoading` de
  // SWR sigue siendo `true` mientras revalida aunque haya `fallbackData`, y usarlo tal cual
  // haría que la página 1 —la que el Server Component ya resolvió— apareciera como esqueleto
  // antes de enseñar los comprobantes que el usuario veía antes de paginar.
  const cargando = data === undefined;

  return (
    <section
      aria-label="Cierres de bodega resueltos"
      className="flex flex-col gap-3"
    >
      {/* Sin encabezado visible: la pestaña ya lo dice. El `aria-label` de la sección se
          queda —es el nombre para quien no ve la pantalla, y por el que lo localizan los tests—. */}
      <ListaComprobantes
        ariaLabel="Cierres de bodega resueltos"
        items={data?.items ?? []}
        clave={(c) => c.cierreBodegaId}
        isLoading={cargando}
        error={error ? ERROR_CARGA : null}
        emptyMessage="Aún no hay cierres de bodega resueltos."
        render={(c) => (
          <CierreBodegaFacturaResumen
            cierre={c}
            acciones={
              <Button
                type="button"
                size="sm"
                variant="outline"
                aria-label={`Ver el cierre de bodega resuelto de ${c.zonaNombre}`}
                onClick={() => onAbrir(c.cierreBodegaId)}
              >
                Ver
              </Button>
            }
          />
        )}
      />

      <Pagination
        page={page}
        pageSize={pageSize}
        total={data?.total ?? 0}
        disabled={cargando}
        showFirstLast
        siblingCount={1}
        ariaLabel={PAGINACION_BODEGA_RESUELTOS_LABEL}
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
