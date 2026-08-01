"use client";

import { useState } from "react";
import useSWR from "swr";

import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Pagination } from "@/components/shared/Pagination";
import { filasDelConjuntoCompleto } from "@/components/shared/descarga-resultado";
import { incidentesConfig } from "@/lib/config/incidentes";
import {
  listarIncidentes,
  listarHistoricoIncidentesPaginado,
} from "@/lib/actions/incidentes";
import type { IncidenteAdminDTO } from "@/lib/interfaces/services/IIncidenteAdminService";
import { CAUSA_INCIDENTE_LABEL } from "@/app/(app)/mis-asignaciones/_components/causa-incidente-options";
import {
  money,
  EstadoCierreBadge,
} from "@/app/(app)/cierres-admin/_components/cierre-detalle-shared";

import {
  COLUMNAS_DESCARGA_INCIDENTES_HISTORICO,
  filaDescargaIncidenteHistorico,
} from "./incidentes-descarga-columnas";

/**
 * Feature 170 — FASE 2 (T I.2, R43/R44/R52): el HISTÓRICO de incidentes resueltos (feature
 * 158, R49), paginado en el servidor. Molde: `UsuariosModule`.
 *
 * POR QUÉ VIVE EN SU PROPIO ARCHIVO: `IncidentesAdminModule` muestra, junto a esta tabla, el
 * contador de su cola de pendientes —derivado de `pendientes.length`—, correcto hoy y de la
 * tanda J. La guardia de T H.3 prohíbe —con razón— que un contador derivado de un array
 * conviva con un control de paginación en el mismo archivo.
 *
 * R46: las evidencias del histórico NO viajan en el listado; se piden por incidente al abrir
 * el detalle, que es donde se firman. Paginar no cambia eso.
 */

/** La página que pre-carga el Server Component (R44: es la que el usuario ve al entrar). */
export interface IncidentesHistoricoPagina {
  items: IncidenteAdminDTO[];
  total: number;
  pageSize: number;
}

export interface IncidentesHistoricoTablaProps {
  /** Página 1 resuelta server-side; alimenta el `fallbackData` de SWR. */
  initialData: IncidentesHistoricoPagina;
  /** Encabezado de la sección (lo declara el módulo, i18n-ready). */
  titulo: string;
  /** Mensaje del estado vacío (lo declara el módulo, i18n-ready). */
  mensajeVacio: string;
  /** Nombre visible de la descarga: hoja, base del archivo y control (R12/R13). */
  tituloDescarga: string;
  /** Abre el detalle del incidente (el modal vive en el módulo padre). */
  onAbrir: (incidenteId: string) => void;
}

/** Nombre accesible del control (R43). Propio: la pantalla monta dos tablas. */
export const PAGINACION_INCIDENTES_LABEL = "Paginación del histórico de incidentes";
const ERROR_CARGA = "No se pudo cargar el histórico de incidentes.";

// R40: el tamaño sale de la config del dominio (T H.1), nunca de un literal de pantalla.
const PAGE_SIZE_OPTIONS = [10, 25, 50].filter(
  (s) => s <= incidentesConfig.MAX_PAGE_SIZE,
);

async function leerPagina(
  page: number,
  pageSize: number,
): Promise<IncidentesHistoricoPagina> {
  const res = await listarHistoricoIncidentesPaginado({ page, pageSize });
  if (res.status !== "ok") throw new Error(res.status);
  return { items: res.items, total: res.total, pageSize: res.pageSize };
}

export function IncidentesHistoricoTabla({
  initialData,
  titulo,
  mensajeVacio,
  tituloDescarga,
  onAbrir,
}: Readonly<IncidentesHistoricoTablaProps>) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialData.pageSize);

  const { data, error } = useSWR(
    ["incidentes:historico", page, pageSize],
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
    <section aria-label={titulo} className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{titulo}</h2>
      <div className="overflow-x-auto">
        <DataTable
          columns={columnasHistorico(onAbrir)}
          data={data?.items ?? []}
          rowKey="incidenteId"
          ariaLabel={titulo}
          emptyMessage={mensajeVacio}
          isLoading={cargando}
          error={error ? ERROR_CARGA : null}
          /**
           * Feature 170 (T I.2, R52) — la tabla pinta UNA página; el archivo sigue siendo el
           * CONJUNTO COMPLETO del alcance del actor. Se relee con el MISMO listado que la
           * pantalla ya llamaba antes de paginar (`listarIncidentes`), que acota por la zona
           * de la ORDEN para un `adminSatelite`: descargar no amplía el alcance (R44).
           *
           * Las URL firmadas siguen sin viajar al archivo (R22): el módulo de columnas ni
           * siquiera las lee.
           */
          descarga={{
            titulo: tituloDescarga,
            columnas: COLUMNAS_DESCARGA_INCIDENTES_HISTORICO,
            obtenerFilas: () =>
              filasDelConjuntoCompleto(
                listarIncidentes().then((res) =>
                  res.status === "ok"
                    ? ({ status: "ok", items: res.historico } as const)
                    : res,
                ),
                filaDescargaIncidenteHistorico,
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
        ariaLabel={PAGINACION_INCIDENTES_LABEL}
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

// --- Columnas del histórico (solo lectura, R49). Promovidas TAL CUAL desde
// `IncidentesAdminModule`: ni una columna ni el orden cambian (R44). ---
function columnasHistorico(
  abrir: (incidenteId: string) => void,
): Column<IncidenteAdminDTO>[] {
  return [
    {
      id: "estado",
      value: "Estado",
      render: (i) => <EstadoCierreBadge estado={i.estado} />,
    },
    { id: "numRemision", value: "Nº Remisión", render: (i) => i.numRemision },
    { id: "destinatario", value: "Destinatario", render: (i) => i.destinatario },
    { id: "causa", value: "Causa", render: (i) => CAUSA_INCIDENTE_LABEL[i.causa] },
    // R55: el monto se renderiza TAL CUAL (STRING money-safe), sin `parseFloat` ni redondeo.
    {
      id: "indemnizacion",
      value: "Indemnización",
      render: (i) => money(i.indemnizacion),
    },
    { id: "resueltoPor", value: "Resuelto por", render: (i) => i.resueltoPorNombre ?? "—" },
    {
      id: "resueltoAt",
      value: "Fecha resuelta",
      render: (i) => i.resueltoAt?.slice(0, 10) ?? "—",
    },
    { id: "motivoRechazo", value: "Motivo", render: (i) => i.motivoRechazo ?? "—" },
    {
      id: "acciones",
      value: "Acciones",
      render: (i) => (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => abrir(i.incidenteId)}
          aria-label={`Ver el incidente de la orden ${i.numRemision}`}
        >
          Ver
        </Button>
      ),
    },
  ];
}
