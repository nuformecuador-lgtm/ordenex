"use client";

import { useState } from "react";
import useSWR from "swr";
import { Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { BuscadorFiltros } from "@/components/shared/BuscadorFiltros";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Pagination } from "@/components/shared/Pagination";
import { filasDesdeResultado } from "@/components/shared/descarga-resultado";
import { walletMensajeroConfig } from "@/lib/config/wallet-mensajero";
import {
  listarCuentasPorPagarCompletoAction,
  listarCuentasPorPagarPaginadoAction,
} from "@/lib/actions/wallet-mensajero";
import { normalizarBusquedaMensajero } from "@/lib/utils/cuentas-por-pagar-listado";
import { cn } from "@/lib/utils";
import type { CuentaPorPagarResumenDTO } from "@/lib/types/wallet-mensajero";

import { DesglosePagosMensajero } from "./DesglosePagosMensajero";
import {
  COLUMNAS_DESCARGA_CUENTAS_POR_PAGAR,
  filaDescargaCuentaPorPagar,
} from "./cuentas-por-pagar-descarga-columnas";
import {
  COLUMNAS_MAESTRO,
  CUENTAS_AVISO_BRUTOS,
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
//    texto se manda SIN normalizar —quien decide que casa es
//    `lib/utils/cuentas-por-pagar-listado.ts`, en un solo sitio— y cambiarlo devuelve la tabla a
//    la pagina 1 (R45, ver `aplicarBusqueda`);
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
//
// Ficha 326 — el buscador pasa a ser el CANONICO (`components/shared/BuscadorFiltros`) y con el
// se van dos piezas escritas a mano aqui: el campo propio (`CuentasPorPagarFiltros.tsx`, ya
// borrado) y el par «tecleado vs aplicado» con su `setTimeout` —que ademas importaba la espera
// del canonico, o sea que ya dependia de el sin usarlo—. Lo que la barra trae dentro es
// EXACTAMENTE eso: estado propio del texto, espera antes de avisar y guarda de «sin cambio».
// Aqui solo queda lo que la barra no puede saber: que el termino aplicado devuelve a la
// pagina 1.

// El buscador va en la cabecera de la TABLA, en la misma linea que el control de descarga
// (`filtros` de `DataTable`), igual que las otras dos pantallas paginadas sobre `DataTable`
// (`/ordenes` y Usuarios). El alto del canonico (`h-8`) esta elegido para esa fila. El contador
// se queda arriba y a la derecha, donde estaba: es del listado entero, no de la tabla, y la
// guardia `tests/unit/descarga/contadores-cabecera.guardia.test.ts` lo busca en este archivo.

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

/** Nombre accesible del buscador. No se pinta: el canónico lo usa como `aria-label` (R43). */
const BUSCADOR_LABEL = "Buscar por mensajero";
/** Qué se puede teclear ahí. Es lo único que documenta el alcance del campo (una columna). */
const BUSCADOR_PLACEHOLDER = "Buscar por nombre";

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
  /**
   * Lo que YA viajó al servidor: de aquí salen la tabla, el contador y el archivo. Lo que el
   * usuario está TECLEANDO ya no se guarda aquí — es del `BuscadorFiltros`, que responde al
   * instante y solo avisa cuando el término cambia de verdad y el usuario deja de escribir.
   */
  const [aplicada, setAplicada] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialData.pageSize);

  /**
   * R45 — la búsqueda se aplica en el SERVIDOR, y volver a la página 1 no es un detalle: sin
   * eso, escribir tres letras estando en la página 3 dejaría la tabla vacía junto a un contador
   * que dice que hay dos resultados.
   *
   * Se llega aquí SOLO con un término distinto del último emitido: el canónico se guarda lo que
   * ya avisó y no repite (añadir un espacio al final de un término vigente no es una búsqueda
   * nueva, así que ni cuesta una consulta ni mueve la página). Por eso `setPage(1)` puede ir
   * incondicional: si estuviera dentro de una comparación propia, esa comparación sería la
   * misma guarda escrita dos veces y ninguna de las dos podría medirse.
   */
  function aplicarBusqueda(termino: string) {
    setAplicada(termino);
    setPage(1);
  }

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
      {/* R42: el contador dice el TOTAL del servidor, nunca cuántas filas trae la página.
          Con una búsqueda puesta informan los dos números —lo encontrado y el conjunto—; sin
          ella, «12 de 12 mensajeros» no diría nada que «12 mensajeros» no diga. El «de Y» es
          el total SIN búsqueda que resolvió el Server Component. */}
      <p role="status" className="self-end text-sm text-muted-foreground">
        {hayBusqueda
          ? `${total} de ${initialData.total} mensajeros`
          : `${total} mensajeros`}
      </p>

      {/*
        Feature 172 (T H.4) — la limitación N1. Esta tabla no lista movimientos: cada fila es
        un AGREGADO por mensajero, y dos de sus columnas («Devengado» y «Pagado») incluyen los
        pagos anulados y su reverso. La tercera —«Cuenta por pagar»— es la resta, y sale exacta.
      */}
      <p role="note" className="text-xs text-muted-foreground">
        {CUENTAS_AVISO_BRUTOS}
      </p>

      <DataTable
        columns={COLUMNS}
        data={data?.items ?? []}
        rowKey="mensajeroId"
        ariaLabel={TITULO_DESCARGA}
        isLoading={cargando}
        error={error ? ERROR_CARGA : null}
        /**
         * Ficha 326 — el buscador CANÓNICO. Se le pasa lo mínimo y nada más:
         *
         *  - **sin `filtros`**: el selector no se monta. Lo que esta pantalla dice que le falta
         *    —acotar por rango de fecha y por cierre— no se puede cablear desde aquí: el borde
         *    del listado (`listarCuentasPorPagarPaginadoSchema`) es `.strict()` y solo admite
         *    `page`/`pageSize`/`busqueda`, y esos dos recortes cambiarían LAS COLUMNAS DE DINERO
         *    de cada fila (hoy son la agregación del libro entero de cada mensajero). Eso es
         *    backend y una decisión de producto, no un cableado de UI;
         *  - **sin `debounceMs`**: se toma el de la casa, que es exactamente el que este archivo
         *    importaba a mano. Aquí pesa más que en ningún otro sitio: cada lectura agrega el
         *    libro entero de cada mensajero (T L.1 §5), así que escribir un nombre de diez
         *    letras sin esperar serían diez agregaciones completas;
         *  - **sin `disabled`**: el campo NO se deshabilita mientras carga. Perder teclas de un
         *    nombre a medio escribir es peor que esperar a que llegue la página;
         *  - **sin `onLimpiarTodo`**: no hay más filtros que limpiar, y el campo ya trae su
         *    propia X. Ofrecer «Limpiar todo» al lado sería el mismo gesto dos veces.
         */
        filtros={
          <BuscadorFiltros
            label={BUSCADOR_LABEL}
            placeholder={BUSCADOR_PLACEHOLDER}
            onChange={aplicarBusqueda}
          />
        }
        /**
         * Feature 170 (T L.2, R52 · T M.1, cierre de Q-L2) — la tabla pinta UNA página; el
         * archivo sigue siendo el CONJUNTO COMPLETO, y desde T M.1 lo pide con la búsqueda YA
         * aplicada en el servidor (`listarCuentasPorPagarCompletoAction`).
         *
         * Qué cambió y por qué importa: T L.2 releía el listado ENTERO sin búsqueda y volvía a
         * filtrarlo aquí con las funciones de `lib/utils/`. Funcionaba —era el mismo criterio—
         * pero dejaba el conjunto completo cruzando al cliente para descartar la mayor parte, y
         * dejaba el filtro escrito dos veces, en dos capas. Ahora el servidor devuelve
         * exactamente las filas del archivo, y el tope de 5000 lo decide él (R29): por encima no
         * viaja ni una fila (R26/R27/R28).
         *
         * Sigue exigiendo el mismo acceso total que la página: descargar no amplía lo que el
         * actor podía ver (R14/R44).
         */
        descarga={{
          titulo: TITULO_DESCARGA,
          columnas: COLUMNAS_DESCARGA_CUENTAS_POR_PAGAR,
          obtenerFilas: () =>
            filasDesdeResultado(
              listarCuentasPorPagarCompletoAction({ busqueda: aplicada }),
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
