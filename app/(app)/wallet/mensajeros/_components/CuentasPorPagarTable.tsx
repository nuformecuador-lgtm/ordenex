"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Pagination } from "@/components/shared/Pagination";
import { DEBOUNCE_MS_DEFAULT } from "@/components/shared/FilterComponent";
import { filasDelConjuntoCompleto } from "@/components/shared/descarga-resultado";
import { walletMensajeroConfig } from "@/lib/config/wallet-mensajero";
import {
  listarCuentasPorPagarAction,
  listarCuentasPorPagarPaginadoAction,
} from "@/lib/actions/wallet-mensajero";
import {
  filtrarPorBusquedaMensajero,
  normalizarBusquedaMensajero,
  ordenarCuentasPorPagar,
} from "@/lib/utils/cuentas-por-pagar-listado";
import { cn } from "@/lib/utils";
import type { CuentaPorPagarResumenDTO } from "@/lib/types/wallet-mensajero";

import { CuentasPorPagarFiltros } from "./CuentasPorPagarFiltros";
import { DesglosePagosMensajero } from "./DesglosePagosMensajero";
import {
  COLUMNAS_DESCARGA_CUENTAS_POR_PAGAR,
  filaDescargaCuentaPorPagar,
} from "./cuentas-por-pagar-descarga-columnas";
import {
  COLUMNAS_MAESTRO,
  CUENTA_COLOR,
  SIGNO_BADGE,
  money,
} from "./wallet-mensajeros-labels";

// Feature 44 (T14, R18/R19/R21/R22) — tabla-resumen de CUENTAS POR PAGAR a mensajeros (una fila
// por mensajero: devengado / pagado / cuenta por pagar, con estado por signo). El maestro ve a
// TODOS los mensajeros (R19, no acotado). Cada fila EXPANDE su DESGLOSE POR CIERRE
// (`DesglosePagosMensajero`, paginado, mas reciente primero, R18) usando el `renderExpanded` del
// `DataTable`. Money-safe: los montos se renderizan TAL CUAL con `money`, sin parseFloat/Number.
//
// Feature 170 — FASE 2 (T L.2, R42/R43/R50/R52): la pantalla deja de recibir el conjunto entero
// por props y pinta UNA PAGINA que resuelve el servidor (T L.1). Lo que eso mueve, y por que:
//
//  - **la busqueda por nombre pasa al SERVIDOR**. Dejarla en el navegador con la tabla paginada
//    seria buscar solo dentro de lo que ya esta a la vista: escribir el nombre de un mensajero
//    de la pagina 3 no lo encontraria, y la pantalla no diria que ha mirado 25 filas de 300. El
//    texto se manda TAL CUAL (`lib/utils/cuentas-por-pagar-listado.ts` lo normaliza, en un solo
//    sitio) y cambiarlo devuelve la tabla a la pagina 1 (R45, ver `useEffect`);
//  - **el dinero NO se toca**: cada celda sigue siendo la agregacion del libro ENTERO de ese
//    mensajero, calculada en el servidor antes de recortar la pagina (T L.1 §5). Aqui no se suma
//    ni se deriva nada;
//  - **la descarga sigue entregando el CONJUNTO filtrado**, releido al pulsar el control (R52);
//  - **expandir una fila funciona igual en cualquier pagina** (R50): la clave de expansion es el
//    `mensajeroId` y el desglose lo pide `DesglosePagosMensajero` por su cuenta.
//
// El control de paginacion y el contador viven en ESTE archivo, que es el que la guardia de
// T H.3 mira: reconoce como pantalla paginada al archivo que monta `<Pagination>` y a los que
// ese archivo importa, nunca hacia arriba.

export interface CuentasPorPagarTableProps {
  /**
   * Feature 170 — FASE 2 (T L.2, R40/R41): PAGINA 1 resuelta server-side + el `total` del
   * conjunto SIN busqueda. Alimenta el `fallbackData` de SWR (para que el primer pintado
   * enseñe ya las filas, no un esqueleto) y el «de Y» del contador (R42).
   */
  initialData: CuentasPorPagarPagina;
}

/** Feature 170 — FASE 2 (T L.2): la pagina tal como la devuelve el servidor. */
export interface CuentasPorPagarPagina {
  items: CuentaPorPagarResumenDTO[];
  total: number;
  pageSize: number;
}

/** Nombre visible del listado: hoja, base del archivo y nombre del control (R12/R13). */
const TITULO_DESCARGA = "Cuentas por pagar a mensajeros";
/** Nombre accesible del control de paginación (R43). */
export const PAGINACION_CUENTAS_LABEL = "Paginación de las cuentas por pagar";
/** Mensaje de fallo de la lectura de la página, ya redactado para la tabla. */
const ERROR_CARGA = "No se pudieron cargar las cuentas por pagar.";

// R40: el tamaño sale de la config del dominio (T H.1), nunca de un literal de pantalla.
const PAGE_SIZE_OPTIONS = [10, 25, 50].filter(
  (s) => s <= walletMensajeroConfig.MAX_PAGE_SIZE,
);

/**
 * Espera entre la última tecla y la consulta. Es la MISMA que el resto de la app aplica a un
 * cambio de filtro (`FilterComponent`), y aquí pesa más que en ningún otro sitio: cada lectura
 * de este listado agrega el libro entero de cada mensajero (T L.1 §5), así que escribir un
 * nombre de diez letras sin esperar serían diez agregaciones completas.
 */
const ESPERA_BUSQUEDA_MS = DEBOUNCE_MS_DEFAULT;

// Columnas de la tabla-resumen (R18). Money-safe (R21/R27): los montos se pintan TAL CUAL con
// `money`, sin parseFloat/Number. El color/badge sale del signo ya calculado en el servidor.
const COLUMNS: Column<CuentaPorPagarResumenDTO>[] = [
  {
    id: "mensajero",
    value: COLUMNAS_MAESTRO.mensajero,
    render: (m) => <span className="font-medium">{m.mensajeroNombre}</span>,
  },
  {
    id: "devengado",
    value: COLUMNAS_MAESTRO.devengado,
    render: (m) => money(m.devengado),
  },
  {
    id: "pagado",
    value: COLUMNAS_MAESTRO.pagado,
    render: (m) => <span className="text-success-strong">{money(m.pagado)}</span>,
  },
  {
    id: "cuentaPorPagar",
    value: COLUMNAS_MAESTRO.cuentaPorPagar,
    render: (m) => (
      <span className={cn("font-medium", CUENTA_COLOR[m.signo])}>
        {money(m.cuentaPorPagar)}
      </span>
    ),
  },
  {
    id: "estado",
    value: COLUMNAS_MAESTRO.estado,
    render: (m) => {
      const badge = SIGNO_BADGE[m.signo];
      return <Badge variant={badge.variant}>{badge.label}</Badge>;
    },
  },
];

/** Lee una página del servidor; un resultado que no sea `ok` se lanza (SWR lo marca `error`). */
async function leerPagina(
  page: number,
  pageSize: number,
  busqueda: string,
): Promise<CuentasPorPagarPagina> {
  const res = await listarCuentasPorPagarPaginadoAction({ page, pageSize, busqueda });
  if (res.status !== "ok") throw new Error(res.status);
  return { items: res.items, total: res.total, pageSize: res.pageSize };
}

export function CuentasPorPagarTable({ initialData }: CuentasPorPagarTableProps) {
  /** Lo que el usuario está escribiendo: el campo responde al instante. */
  const [busqueda, setBusqueda] = useState("");
  /** Lo que YA viajó al servidor: de aquí salen la tabla, el contador y el archivo. */
  const [aplicada, setAplicada] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialData.pageSize);

  /**
   * R45 — la búsqueda se aplica en el SERVIDOR, y volver a la página 1 no es un detalle: sin
   * eso, escribir tres letras estando en la página 3 dejaría la tabla vacía junto a un contador
   * que dice que hay dos resultados.
   *
   * Se compara lo NORMALIZADO (la misma función que usa el servidor para decidir qué filas
   * casan): añadir un espacio al final de un término ya aplicado no es una búsqueda nueva y no
   * debe costar una consulta ni mover la página.
   */
  useEffect(() => {
    if (normalizarBusquedaMensajero(busqueda) === normalizarBusquedaMensajero(aplicada)) {
      return;
    }
    const temporizador = setTimeout(() => {
      setAplicada(busqueda);
      setPage(1);
    }, ESPERA_BUSQUEDA_MS);
    return () => clearTimeout(temporizador);
  }, [busqueda, aplicada]);

  const { data, error } = useSWR(
    ["wallet-mensajeros:cuentas", page, pageSize, aplicada],
    () => leerPagina(page, pageSize, aplicada),
    {
      // Lo que el Server Component ya resolvió: página 1, sin búsqueda, tamaño de origen.
      fallbackData:
        page === 1 && pageSize === initialData.pageSize && aplicada === ""
          ? initialData
          : undefined,
    },
  );

  // R44: el esqueleto de carga se muestra sólo cuando NO hay nada que pintar. `isLoading` de
  // SWR sigue siendo `true` mientras revalida aunque haya `fallbackData`, y usarlo tal cual
  // haría que la página 1 —la que el Server Component ya resolvió— apareciera como esqueleto
  // antes de enseñar las filas que el usuario veía antes de paginar.
  const cargando = data === undefined;
  const total = data?.total ?? 0;
  const hayBusqueda = normalizarBusquedaMensajero(aplicada) !== "";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        {/* El campo NO se deshabilita mientras carga: perder teclas de un nombre a medio
            escribir es peor que esperar a que llegue la página. */}
        <CuentasPorPagarFiltros value={busqueda} onChange={setBusqueda} />

        {/* R42: el contador dice el TOTAL del servidor, nunca cuántas filas trae la página.
            Con una búsqueda puesta informan los dos números —lo encontrado y el conjunto—; sin
            ella, «12 de 12 mensajeros» no diría nada que «12 mensajeros» no diga. El «de Y» es
            el total SIN búsqueda que resolvió el Server Component. */}
        <p role="status" className="text-sm text-muted-foreground">
          {hayBusqueda
            ? `${total} de ${initialData.total} mensajeros`
            : `${total} mensajeros`}
        </p>
      </div>

      <DataTable
        columns={COLUMNS}
        data={data?.items ?? []}
        rowKey="mensajeroId"
        ariaLabel={TITULO_DESCARGA}
        isLoading={cargando}
        error={error ? ERROR_CARGA : null}
        /**
         * Feature 170 (T L.2, R52) — la tabla pinta UNA página; el archivo sigue siendo el
         * CONJUNTO COMPLETO. Se relee con el MISMO listado que la pantalla llamaba antes de
         * paginar (`listarCuentasPorPagarAction`), que exige el mismo acceso total: descargar
         * no amplía lo que el actor podía ver (R7/R44).
         *
         * La búsqueda vigente se aplica con las funciones de `lib/utils/`, las MISMAS que usa
         * el servidor para armar la página (T L.1). No se reescribe el filtro aquí a propósito:
         * dos escrituras del mismo criterio en dos capas es exactamente como una fila acaba en
         * la tabla y no en el archivo, o al revés (R11).
         *
         * `filasDelConjuntoCompleto` conserva el tope de 5000 de `filasLocales`: por encima
         * devuelve un error accionable y NO produce archivo (R26/R28).
         */
        descarga={{
          titulo: TITULO_DESCARGA,
          columnas: COLUMNAS_DESCARGA_CUENTAS_POR_PAGAR,
          obtenerFilas: () =>
            filasDelConjuntoCompleto(
              listarCuentasPorPagarAction().then((res) =>
                res.status === "ok"
                  ? ({
                      status: "ok",
                      items: ordenarCuentasPorPagar(
                        filtrarPorBusquedaMensajero(res.mensajeros, aplicada),
                      ),
                    } as const)
                  : res,
              ),
              filaDescargaCuentaPorPagar,
            ),
        }}
        emptyState={{
          icon: Users,
          title: "No hay cuentas por pagar",
          description:
            "Cuando un mensajero tenga montos devengados o pagados, aparecerá aquí con su cuenta por pagar.",
        }}
        /**
         * R50 — el desglose de una fila se abre igual en la página 1 que en la 3: la fila que
         * llega aquí es la de la página visible y `DesglosePagosMensajero` pide SU desglose por
         * `mensajeroId`, sin depender de la página. Los montos del resumen bajan por props
         * desde esta misma fila, o sea del servidor: cambiar de página no los recalcula.
         */
        renderExpanded={(m) => (
          <DesglosePagosMensajero resumen={m} id={`desglose-${m.mensajeroId}`} />
        )}
        expandAriaLabel={(m) => `Ver desglose de ${m.mensajeroNombre}`}
      />

      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        disabled={cargando}
        showFirstLast
        siblingCount={1}
        ariaLabel={PAGINACION_CUENTAS_LABEL}
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
