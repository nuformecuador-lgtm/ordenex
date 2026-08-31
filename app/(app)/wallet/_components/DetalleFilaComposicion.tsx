"use client";

import { useState } from "react";
import useSWR from "swr";

import { DataTable, type Column } from "@/components/shared/DataTable";
import { Pagination } from "@/components/shared/Pagination";
import { listarMovimientosDeFilaAction } from "@/lib/actions/wallet";
import { composicionDetalleConfig } from "@/lib/config/composicion-detalle";
import type { ComposicionFilaId, WalletMovimientoDTO } from "@/lib/types/wallet";

import {
  COMPOSICION_DETALLE_COLUMNAS,
  COMPOSICION_DETALLE_ERROR,
  COMPOSICION_DETALLE_VACIO,
  DETALLE_FILA_NOMBRE,
} from "./composicion-detalle-labels";
import { inputDeFiltros, type WalletFiltrosValue } from "./WalletFiltros";
import { CATEGORIA_LABEL, ORIGEN_LABEL, money } from "./wallet-labels";

// Ficha 339 (T5.2, design 5.3/5.5) — LOS MOVIMIENTOS QUE COMPONEN UNA FILA de la tarjeta
// «Como se compone la ganancia de Ordenex».
//
// Se MONTA solo cuando su fila esta abierta (`FilaComposicion` no lo renderiza cerrada), y es
// aqui —dentro— donde vive el `useSWR`. De ahi salen tres requisitos de golpe: la tarjeta con
// sus catorce filas cerradas cuesta CERO lecturas de detalle (R21), abrir una cuesta
// exactamente UNA (R22) y cada fila abierta lleva su propia pagina y su propia cache, asi que
// dos filas abiertas no se pisan (R23). Es el precedente vivo de `DesgloseMovimientosTienda`,
// que se despliega igual desde una fila de `SaldosTiendasTable`.
//
// EL CLIENTE MANDA UN TOKEN DE FILA, NUNCA UNA LISTA DE CATEGORIAS (design 10-A1). El
// complemento de «Otros gastos de Ordenex» lo resuelve el SERVIDOR con la MISMA definicion que
// produce el importe de la fila: si el navegador pudiera declarar que categorias componen esa
// fila, existirian DOS definiciones del mismo conjunto —una para el importe y otra para la
// lista— y podrian divergir sin que nada fallara. Ese es, un piso mas abajo, el mismo fallo de
// dinero que esta ficha viene a cerrar.
//
// Money-safe (R34/R35): el monto de cada movimiento llega como STRING escala 2 y se pinta TAL
// CUAL con `money`. Aqui no se suma, no se resta y no se convierte a numero. Y NO hay fila de
// subtotal (R36): la pagina no es el conjunto, y un subtotal de pagina al lado del importe de
// la fila es una invitacion a restarlos.
//
// Sin `descarga` (design 8/9): este panel es un recorte del MISMO libro que «Libro de
// movimientos de la caja principal», que ya descarga el conjunto completo con sus filtros
// —incluido el de categoria, que es justo lo que este panel muestra—. Una segunda descarga del
// mismo dinero por otra puerta seria un segundo archivo del mismo hecho.

/** Prefijo de la clave SWR. Identifica esta lectura entre todas las de la app. */
const CLAVE_DETALLE = "wallet-composicion:detalle";

/**
 * R23 — clave SWR del detalle de UNA fila: la fila, la pagina y los CUATRO filtros vigentes.
 *
 * Los filtros entran en la clave y no solo en el fetcher a proposito: cambiar un filtro de la
 * wallet tiene que producir una lectura NUEVA, no servir de cache el conjunto anterior. Es lo
 * que sostiene R20 —el detalle y el importe de la fila hablan siempre del mismo conjunto—.
 */
function claveDetalleFila(
  fila: ComposicionFilaId,
  page: number,
  filtros: WalletFiltrosValue,
): readonly [string, string, number, string, string, string, string] {
  return [
    CLAVE_DETALLE,
    fila,
    page,
    filtros.tipo,
    filtros.categoria,
    filtros.desde,
    filtros.hasta,
  ] as const;
}

/**
 * Fetcher SWR: pide la pagina del detalle y traduce un `status` distinto de `ok` a un throw,
 * que SWR marca como error. Ninguna rama de error viaja con movimientos (R26/R38).
 *
 * `pageSize` NO se manda: el tope y el tamano por defecto los pone el SERVIDOR desde
 * `composicionDetalleConfig` (R29). La pantalla no declara ninguno de los dos como literal.
 */
async function detalleFetcher(
  fila: ComposicionFilaId,
  page: number,
  filtros: WalletFiltrosValue,
) {
  const res = await listarMovimientosDeFilaAction({
    ...inputDeFiltros(filtros),
    fila,
    page,
  });
  if (res.status !== "ok") throw new Error(res.status);
  return res.data;
}

/**
 * R17 — el «Detalle» de un movimiento: su ORIGEN legible y, cuando la hay, su descripcion.
 *
 * No es cosmetica. Los pagos a mensajeros —el concepto que esta ficha existe para sacar a la
 * luz— se escriben con `descripcion: null` (lo pone `WalletMensajeroFeedService`), asi que una
 * columna que solo mostrara la descripcion enseñaria nueve renglones EN BLANCO justo en la fila
 * que mas falta hace abrir. La composicion es la misma que ya usa el desglose de una tienda.
 */
function detalleTexto(m: WalletMovimientoDTO): string {
  const origen = ORIGEN_LABEL[m.origenTipo];
  return m.descripcion ? `${origen} · ${m.descripcion}` : origen;
}

/**
 * R16 — las CUATRO columnas del detalle, en orden: fecha, concepto, detalle e importe.
 *
 * «Concepto» existe porque la fila «Otros gastos de Ordenex» es un CONJUNTO: sin el, la unica
 * fila que de verdad hace falta abrir seria ilegible. En las demas filas es redundante y se
 * mantiene por uniformidad — cuatro tablas con columnas distintas segun la fila serian cuatro
 * tablas que hay que volver a leer cada vez.
 */
const COLUMNS: Column<WalletMovimientoDTO>[] = [
  {
    id: "fecha",
    value: COMPOSICION_DETALLE_COLUMNAS.fecha,
    render: (m) => m.fechaMovimiento.slice(0, 10),
  },
  {
    id: "concepto",
    value: COMPOSICION_DETALLE_COLUMNAS.concepto,
    // R5: la etiqueta legible del catalogo, nunca el valor del enum.
    render: (m) => CATEGORIA_LABEL[m.categoria],
  },
  {
    id: "detalle",
    value: COMPOSICION_DETALLE_COLUMNAS.detalle,
    render: detalleTexto,
  },
  {
    id: "importe",
    value: COMPOSICION_DETALLE_COLUMNAS.importe,
    align: "right",
    render: (m) => money(m.monto),
  },
];

export interface DetalleFilaComposicionProps {
  /** El TOKEN de la fila (una categoria del catalogo, o `"otros_egresos"` para el complemento). */
  fila: ComposicionFilaId;
  /** El rotulo VISIBLE de la fila. Compone los nombres accesibles de este panel (R24). */
  etiqueta: string;
  /** Los filtros vigentes de la wallet, tal cual los tiene el modulo (R20). */
  filtros: WalletFiltrosValue;
  /** id del panel, para enlazarlo con el `aria-controls` del boton que lo abre. */
  id?: string;
}

export function DetalleFilaComposicion({
  fila,
  etiqueta,
  filtros,
  id,
}: DetalleFilaComposicionProps) {
  const [page, setPage] = useState(1);

  const { data, error, isLoading } = useSWR(claveDetalleFila(fila, page, filtros), () =>
    detalleFetcher(fila, page, filtros),
  );

  const movimientos = data?.movimientos ?? [];
  /**
   * R31 — el total del CONJUNTO, contado por la base. **Nunca el largo de `movimientos`**, que
   * es el de la pagina que se esta pintando: con eso, la barra diria «5 de 5» teniendo la base
   * trescientos, y nadie podria llegar nunca a la segunda pagina.
   */
  const total = data?.total ?? 0;
  /** R29 — el tamano de pagina lo fija la CONFIGURACION, no un literal de pantalla. */
  const pageSize = data?.pageSize ?? composicionDetalleConfig.DEFAULT_PAGE_SIZE;

  return (
    <section
      id={id}
      aria-label={DETALLE_FILA_NOMBRE.region(etiqueta)}
      className="flex flex-col gap-3 rounded-lg bg-muted/40 p-3"
    >
      <div className="overflow-x-auto">
        <DataTable
          columns={COLUMNS}
          data={movimientos}
          rowKey="id"
          ariaLabel={DETALLE_FILA_NOMBRE.tabla(etiqueta)}
          isLoading={isLoading}
          /* R26: el fallo se cuenta DENTRO de esta fila; la tarjeta entera sigue en pie. */
          error={error ? COMPOSICION_DETALLE_ERROR : null}
          emptyMessage={COMPOSICION_DETALLE_VACIO}
        />
      </div>

      {/* R27/R28/R31 — paginacion SERVER-SIDE: el total es el del conjunto, no el de la pagina.
          `sticky={false}` porque este panel vive dentro de una tarjeta: en modo pegajoso el
          control devuelve un fragmento de DOS elementos y el `flex` del contenedor los
          colocaria como dos columnas, con el centinela empujando la barra. */}
      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={setPage}
        disabled={isLoading}
        ariaLabel={DETALLE_FILA_NOMBRE.paginacion(etiqueta)}
        sticky={false}
        className="w-full justify-between gap-3 py-0"
      />
    </section>
  );
}
