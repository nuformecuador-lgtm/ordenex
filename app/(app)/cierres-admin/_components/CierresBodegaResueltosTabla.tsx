"use client";

import { useState } from "react";
import useSWR from "swr";

import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Pagination } from "@/components/shared/Pagination";
import { filasDelConjuntoCompleto } from "@/components/shared/descarga-resultado";
import { cierreBodegaConfig } from "@/lib/config/cierre-bodega";
import {
  listarCierresBodegaAdmin,
  listarHistoricoCierresBodegaPaginado,
} from "@/lib/actions/cierre-bodega";
import type { CierreBodegaResumen } from "@/lib/interfaces/services/ICierreBodegaService";

import {
  money,
  ESTADO_LABEL,
  PAGO_MENSAJERO_COL,
  INGRESO_BODEGA_RECHAZOS_COL,
} from "./cierre-detalle-shared";
import {
  COLUMNAS_DESCARGA_BODEGA_RESUELTOS,
  filaDescargaBodegaResuelto,
} from "./cierres-bodega-descarga-columnas";

/**
 * Feature 170 — FASE 2 (T I.2, R43/R44/R52): el HISTÓRICO de «Cierres de bodega resueltos»
 * (feature 40, R15), paginado en el servidor. Molde: `UsuariosModule`.
 *
 * POR QUÉ VIVE EN SU PROPIO ARCHIVO: `CierresBodegaAdminModule` muestra, junto a esta tabla,
 * el contador de su cola de pendientes —derivado de `pendientes.length`—, correcto hoy y de la
 * tanda J. La guardia de T H.3 prohíbe —con razón— que un contador derivado de un array
 * conviva con un control de paginación en el mismo archivo. Separar el listado que pagina del
 * que no lo hace mantiene ciertas las dos cosas, en vez de silenciar la guardia.
 */

/** La página que pre-carga el Server Component (R44: es la que el usuario ve al entrar). */
export interface CierresBodegaResueltosPagina {
  items: CierreBodegaResumen[];
  total: number;
  pageSize: number;
}

export interface CierresBodegaResueltosTablaProps {
  /** Página 1 resuelta server-side; alimenta el `fallbackData` de SWR. */
  initialData: CierresBodegaResueltosPagina;
  /** Abre el detalle agregado del cierre de bodega (el modal vive en el módulo padre). */
  onAbrir: (cierreBodegaId: string) => void;
}

/** Nombre visible de la tabla: hoja, base del archivo y nombre del control (R12/R13). */
const TITULO_DESCARGA = "Cierres de bodega resueltos";
/** Nombre accesible del control (R43). Propio: la pantalla monta varias tablas paginadas. */
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

export function CierresBodegaResueltosTabla({
  initialData,
  onAbrir,
}: Readonly<CierresBodegaResueltosTablaProps>) {
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
  // antes de enseñar las filas que el usuario veía antes de paginar.
  const cargando = data === undefined;

  return (
    <section
      aria-label="Cierres de bodega resueltos"
      className="flex flex-col gap-3"
    >
      <h3 className="text-base font-semibold">Cierres de bodega resueltos</h3>
      <div className="overflow-x-auto">
        <DataTable
          columns={columnasHistorico(onAbrir)}
          data={data?.items ?? []}
          rowKey="cierreBodegaId"
          ariaLabel="Cierres de bodega resueltos"
          emptyMessage="Aún no hay cierres de bodega resueltos."
          isLoading={cargando}
          error={error ? ERROR_CARGA : null}
          /**
           * Feature 170 (T I.2, R52) — la tabla pinta UNA página; el archivo sigue siendo el
           * CONJUNTO COMPLETO. Se relee con el MISMO listado que la pantalla ya llamaba antes
           * de paginar (`listarCierresBodegaAdmin`), que aplica el mismo acceso total que la
           * página: descargar no amplía lo que el actor podía ver (R44).
           */
          descarga={{
            titulo: TITULO_DESCARGA,
            columnas: COLUMNAS_DESCARGA_BODEGA_RESUELTOS,
            obtenerFilas: () =>
              filasDelConjuntoCompleto(
                listarCierresBodegaAdmin().then((res) =>
                  res.status === "ok"
                    ? ({ status: "ok", items: res.historico } as const)
                    : res,
                ),
                filaDescargaBodegaResuelto,
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

// --- Columnas del histórico (solo lectura, R15). Promovidas TAL CUAL desde
// `CierresBodegaAdminModule`: ni una columna ni el orden cambian (R44). ---
function columnasHistorico(
  abrir: (cierreBodegaId: string) => void,
): Column<CierreBodegaResumen>[] {
  return [
    { id: "estado", value: "Estado", render: (c) => ESTADO_LABEL[c.estado] },
    { id: "zona", value: "Zona", render: (c) => c.zonaNombre },
    {
      id: "solicitadoPor",
      value: "Solicitó",
      render: (c) => c.solicitadoPorNombre,
    },
    {
      id: "resueltoAt",
      value: "Fecha resuelta",
      render: (c) => c.resueltoAt?.slice(0, 10) ?? "—",
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
    {
      id: "acciones",
      value: "Acciones",
      render: (c) => (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => abrir(c.cierreBodegaId)}
        >
          Ver
        </Button>
      ),
    },
  ];
}
