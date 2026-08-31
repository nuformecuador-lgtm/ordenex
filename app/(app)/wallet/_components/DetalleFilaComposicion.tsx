"use client";

import { useState } from "react";
import useSWR from "swr";

import { DataTable, type Column } from "@/components/shared/DataTable";
import { Pagination } from "@/components/shared/Pagination";
import { useIsMobile } from "@/hooks/use-mobile";
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
 * Ficha 339 (arreglo movil, 2026-08-31) — EL IMPORTE DE UNA FILA EN UN TELEFONO.
 *
 * `whitespace-nowrap` para que la cifra no se parta nunca por la mitad y `tabular-nums` para
 * que las cifras de dos filas seguidas queden en rejilla, que es lo que ya hace el «Libro de
 * movimientos de la caja principal» (`WalletLedger`) con su columna de monto.
 *
 * Money-safe (R34/R35): el monto entra STRING y sale STRING por `money`. Aqui no se convierte,
 * no se suma y —sobre todo— no se ABREVIA: nada de `truncate`, `line-clamp` ni «₡1,7 mil». Es
 * la misma prohibicion que ya esta escrita en `cierre-factura.tsx` («PROHIBIDO aqui: truncate,
 * overflow-hidden, break-words, break-all… un numero a medias es un numero FALSO, peor que uno
 * que se sale»), y es literalmente el defecto que este bloque viene a cerrar.
 */
function ImporteCelda({ monto }: { monto: string }) {
  return <span className="tabular-nums whitespace-nowrap">{money(monto)}</span>;
}

/**
 * R16 — las CUATRO columnas del detalle, en orden: fecha, concepto, detalle e importe.
 *
 * «Concepto» existe porque la fila «Otros gastos de Ordenex» es un CONJUNTO: sin el, la unica
 * fila que de verdad hace falta abrir seria ilegible. En las demas filas es redundante y se
 * mantiene por uniformidad — cuatro tablas con columnas distintas segun la fila serian cuatro
 * tablas que hay que volver a leer cada vez.
 *
 * ── ESTE BLOQUE NO SE TOCA (arreglo movil del 2026-08-31) ──
 * Es, caracter a caracter, el de antes del arreglo. Se intento «ayudar» aqui con
 * `wrap-anywhere` en las dos columnas de texto y `whitespace-nowrap` en la fecha, y MEDIDO EN
 * CHROMIUM salio al reves: el desborde del panel PASO DE 19 a 43 px a 1024 y de 147 a 171 px a
 * 768 — el `nowrap` de la fecha sube su ancho minimo de ~42 px (partida en «2026-» / «08-13») a
 * ~66 px, y `wrap-anywhere` no compensa nada porque no es el min-content lo que decide aqui.
 * Como el importe es la ULTIMA columna, empeorar el desborde es empeorar el recorte del dinero.
 * Si alguien vuelve a intentarlo, que mida antes: `scrollWidth - clientWidth` del contenedor de
 * scroll de la `DataTable`, a 768, 1024 y 1440.
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

/**
 * Ficha 339 (arreglo movil, 2026-08-31) — LAS MISMAS CUATRO COLUMNAS EN DOS, PARA UN TELEFONO.
 *
 * EL DEFECTO, medido en Chromium a 390x844 sobre la fila «Pagos a mensajeros»: el hueco util
 * del panel era de 284 px y la tabla de cuatro columnas pedia 309. Lo que se veia en pantalla:
 *   1. el IMPORTE —la ultima columna— se quedaba 25 px fuera del area visible y se leia
 *      «₡1.70» donde el DOM decia «₡1.700», y «₡10.20» donde decia «₡10.200». DINERO CORTADO:
 *      no se ve roto, se ve como OTRO numero. Este es el punto grave; los otros dos son feos.
 *   2. la fecha se partia en dos renglones («2026-» / «08-13»).
 *   3. al desbordar, la `DataTable` sacaba sus dos flechas de scroll («Desplazar la tabla a la
 *      izquierda/derecha»), que van centradas en el cuerpo y aterrizaban ENCIMA de la segunda
 *      fila, tapandole el importe entero.
 *
 * Los tres salen de la MISMA causa: cuatro columnas no caben en 284 px. Asi que en un telefono
 * las tres primeras —fecha, concepto y detalle, que son TEXTO— viajan APILADAS dentro de una
 * sola celda y el importe se queda con su columna propia a la derecha. No se oculta ni un dato
 * y no se abrevia ninguno: es la misma informacion en dos columnas en vez de cuatro.
 *
 * Por que esto quita el recorte y no solo lo aplaza: la celda de texto lleva `wrap-anywhere`,
 * asi que puede encoger hasta casi nada y el ancho minimo de la tabla pasa a ser practicamente
 * el del importe. Medido despues del cambio: 284 pedidos sobre 284 disponibles, desborde 0 y
 * CERO flechas —con lo que el punto 3 se cae solo—. `wrap-anywhere` y no `break-words` porque
 * el segundo no reduce el min-content, que es la medida que aqui manda; y va en el TEXTO, nunca
 * en el importe (ver `ImporteCelda`).
 *
 * ⚠️ LO QUE ESTO **NO** ARREGLA, y esta medido: entre 768 y 1279 px de viewport se siguen
 * pintando las cuatro columnas y el importe SIGUE RECORTADO (desborde de 147 px a 768, 19 px a
 * 1024; a 1280 y 1440 cabe y no hay recorte). No es una regresion de esta ficha —es el estado
 * de HEAD— y no se arregla aqui porque el corte por VIEWPORT no es el instrumento adecuado: a
 * 1024 el panel mide 290 px, casi lo mismo que los 284 del telefono, porque la tarjeta ocupa
 * una fraccion de la pantalla. Quien lo cierre deberia mirar el ancho del CONTENEDOR y no el de
 * la ventana, como ya razona `ContadoresTablero` con `@container`. Queda declarado, no tapado.
 *
 * ESCRITORIO NO SE TOCA: de 768 px para arriba se usa `COLUMNS`, byte por byte la de antes. El
 * corte lo decide `useIsMobile` (`max-width: 767px`), el mismo hook con el que el Sidebar de la
 * app ya distingue telefono de escritorio; en el servidor devuelve `false`, o sea escritorio.
 */
const COLUMNS_MOVIL: Column<WalletMovimientoDTO>[] = [
  {
    id: "movimiento",
    value: COMPOSICION_DETALLE_COLUMNAS.movimiento,
    render: (m) => (
      <div className="flex flex-col gap-0.5 wrap-anywhere">
        <span className="text-xs whitespace-nowrap tabular-nums text-muted-foreground">
          {m.fechaMovimiento.slice(0, 10)}
        </span>
        {/* R5: la etiqueta legible del catalogo, nunca el valor del enum. */}
        <span className="font-medium">{CATEGORIA_LABEL[m.categoria]}</span>
        {/* R17: el origen legible y, cuando la hay, la descripcion. Ninguna celda muda. */}
        <span className="text-xs text-muted-foreground">{detalleTexto(m)}</span>
      </div>
    ),
  },
  {
    id: "importe",
    value: COMPOSICION_DETALLE_COLUMNAS.importe,
    align: "right",
    render: (m) => <ImporteCelda monto={m.monto} />,
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
  /**
   * Arreglo movil — QUE FORMA TIENE LA TABLA segun el ancho. Es UNA sola `<DataTable>` con dos
   * juegos de columnas, no dos tablas: dos instancias duplicarian el DOM del panel, y la
   * guardia de cobertura de descargas cuenta instancias de `<DataTable>` archivo por archivo.
   */
  const esMovil = useIsMobile();
  const columnas = esMovil ? COLUMNS_MOVIL : COLUMNS;

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
          columns={columnas}
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
