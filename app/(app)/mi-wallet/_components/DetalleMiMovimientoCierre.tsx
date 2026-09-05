"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";

import {
  DataTable,
  type Column,
  type DescargaFilasResult,
} from "@/components/shared/DataTable";
import { Pagination } from "@/components/shared/Pagination";
import { filasDesdeResultado } from "@/components/shared/descarga-resultado";
import { useAnchoDelScrollHorizontal } from "@/hooks/useAnchoDelScrollHorizontal";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  verDetalleDeMiMovimientoAction,
  verDetalleDeMiMovimientoCompletoAction,
} from "@/lib/actions/wallet-tienda";
import { detalleMovimientoConfig } from "@/lib/config/detalle-movimiento";
import type {
  DetalleMovimientoPayload,
  MotivoSinReparto,
  OrdenAporteDTO,
} from "@/lib/types/detalle-movimiento";
import { PARAM_TERMINO_DEFAULT } from "@/lib/utils/filtros-url";

import {
  COLUMNAS_DESCARGA_DETALLE_MI_MOVIMIENTO,
  filaDescargaDetalleMiMovimiento,
} from "./detalle-mi-movimiento-descarga-columnas";
import {
  DETALLE_MI_MOVIMIENTO_CABECERA,
  DETALLE_MI_MOVIMIENTO_COLUMNAS,
  DETALLE_MI_MOVIMIENTO_ERROR,
  DETALLE_MI_MOVIMIENTO_NOMBRE,
  DETALLE_MI_MOVIMIENTO_SIN_REPARTO,
  DETALLE_MI_MOVIMIENTO_VACIO,
  etiquetaVerMiOrden,
  resultadosTexto,
} from "./detalle-mi-movimiento-labels";
import { money } from "./mi-wallet-labels";

// Ficha 344 (T7.1, design §5) — LAS ÓRDENES QUE COMPONEN EL IMPORTE de una fila del libro de
// movimientos de LA PROPIA TIENDA.
//
// Gemelo del panel de la caja principal, con DOS diferencias que son requisitos:
//
//  1. NO SE NOMBRA AL MENSAJERO (R15). El servidor manda `cierre.mensajeroNombre: null` en este
//     libro y esta pantalla ni siquiera tiene la frase con la que pintarlo: la ficha 335 decidió
//     que a la tienda no se le revela quién movió su dinero, y esta ficha no reabre esa
//     decisión.
//  2. NO HAY COLUMNA «TIENDA» (R14). Todas las órdenes de este detalle son de la misma tienda:
//     el `tienda_id` del ACTOR va en el `WHERE` de las DOS lecturas del servidor —la del
//     movimiento y la de las órdenes—, así que la columna repetiría el mismo nombre en cada
//     fila. El alcance no es forzable desde aquí: el cliente manda el id del MOVIMIENTO y nada
//     más (R42), y un movimiento de otra tienda responde «no encontrado» (R41).
//
// Se MONTA solo cuando su fila está abierta, y el `useSWR` vive aquí dentro: el libro cerrado
// cuesta CERO lecturas (R2), abrir una fila cuesta UNA (R3) y dos filas abiertas no se pisan
// (R4).
//
// MONEY-SAFE (R44/R45): los importes llegan STRING escala 2 y se pintan tal cual con `money`.
// Aquí no se suma, no se resta y no se convierte a número; y no hay subtotal de página (R47).

/** Prefijo de la clave SWR. Identifica esta lectura entre todas las de la app. */
const CLAVE_DETALLE = "mi-wallet-libro:detalle-movimiento";

/** R4 — clave SWR del detalle de UN movimiento: el movimiento y la página, y nada más. */
function claveDetalle(movimientoId: string, page: number): readonly [string, string, number] {
  return [CLAVE_DETALLE, movimientoId, page] as const;
}

/**
 * Lo que la pantalla necesita saber tras leer: o el desglose, o POR QUÉ no lo hay.
 *
 * `sin_reparto` NO es un error (R48): el movimiento existe y lo que falta es el reparto por
 * orden. Tratarlo como error dejaría el panel diciendo «no se pudo cargar», que es la fila muda
 * que R48 prohíbe.
 */
type VistaDetalle =
  | { modo: "ok"; data: DetalleMovimientoPayload }
  | { modo: "sin_reparto"; motivo: MotivoSinReparto };

/**
 * Fetcher SWR. `pageSize` NO se manda: el tamaño y el tope los pone el SERVIDOR desde
 * `detalleMovimientoConfig` (R26). Las ramas de fallo —incluida `not_found`, que es lo que
 * responde un movimiento de otra tienda— se cuentan DENTRO de esta fila (R7).
 */
async function detalleFetcher(movimientoId: string, page: number): Promise<VistaDetalle> {
  const res = await verDetalleDeMiMovimientoAction({ movimientoId, page });
  if (res.status === "sin_reparto") return { modo: "sin_reparto", motivo: res.motivo };
  if (res.status !== "ok") throw new Error(res.status);
  return { modo: "ok", data: res.data };
}

/**
 * R32/R33/R34 — las filas del archivo salen de la LECTURA DEDICADA del servidor, con su tope
 * aplicado allí y con el mismo acotamiento por tienda. El navegador no selecciona, no ordena y
 * no recorta.
 *
 * `sin_reparto` se descarta en UNA línea antes del adaptador común, que sólo conoce las tres
 * formas de `ListarCompletoResult`.
 */
async function obtenerFilasDescarga(movimientoId: string): Promise<DescargaFilasResult> {
  const res = await verDetalleDeMiMovimientoCompletoAction({ movimientoId });
  if (res.status === "sin_reparto") {
    return { status: "error", mensaje: DETALLE_MI_MOVIMIENTO_SIN_REPARTO[res.motivo] };
  }
  return filasDesdeResultado(res, filaDescargaDetalleMiMovimiento);
}

/**
 * R11 — la guía de la orden, llevada al buscador de `/ordenes` con un `<Link>` (navegación, no
 * acción). La clave del parámetro se IMPORTA del defecto que lee el buscador; escribir `"q"` a
 * mano dejaría un enlace muerto el día que ese defecto cambie (lección de la ficha 341).
 *
 * Sin guía no hay enlace: `/ordenes?q=` no acotaría nada.
 */
function EnlaceOrden({ guia }: { guia: string }) {
  const termino = guia.trim();
  if (termino === "") return <span>{guia}</span>;

  const etiqueta = etiquetaVerMiOrden(termino);
  return (
    <Link
      href={`/ordenes?${PARAM_TERMINO_DEFAULT}=${encodeURIComponent(termino)}`}
      aria-label={etiqueta}
      title={etiqueta}
      className="font-medium underline underline-offset-2 outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {termino}
    </Link>
  );
}

/**
 * Ficha 344 (R50/R51) — EL APORTE DE UNA ORDEN, ENTERO.
 *
 * PROHIBIDO AQUÍ: `truncate`, `line-clamp`, `overflow-hidden` y cualquier abreviatura de miles.
 * A 390 px la ficha 343 midió en Chromium «₡1.70» donde el DOM decía «₡1.700»: dinero cortado no
 * se ve roto, se ve como OTRO número.
 */
function AporteCelda({ aporte }: { aporte: string }) {
  return <span className="tabular-nums whitespace-nowrap">{money(aporte)}</span>;
}

/** R10/R13 — las CUATRO columnas del detalle en escritorio: guía, destinatario, resultado, aporte. */
const COLUMNS: Column<OrdenAporteDTO>[] = [
  {
    id: "guia",
    value: DETALLE_MI_MOVIMIENTO_COLUMNAS.guia,
    render: (o) => <EnlaceOrden guia={o.guia} />,
  },
  {
    id: "destinatario",
    value: DETALLE_MI_MOVIMIENTO_COLUMNAS.destinatario,
    render: (o) => o.destinatario,
  },
  {
    id: "resultado",
    value: DETALLE_MI_MOVIMIENTO_COLUMNAS.resultado,
    // R13: la etiqueta legible del catálogo, nunca el valor del enum.
    render: (o) => resultadosTexto(o.resultados),
  },
  {
    id: "aporte",
    value: DETALLE_MI_MOVIMIENTO_COLUMNAS.aporte,
    align: "right",
    render: (o) => <AporteCelda aporte={o.aporte} />,
  },
];

/**
 * Ficha 344 (T7.1, R50/R52) — LAS MISMAS CUATRO COLUMNAS EN DOS, PARA UN TELÉFONO.
 *
 * Es el arreglo que la ficha 343 midió y dejó funcionando: por debajo de 768 px las tres
 * primeras —que son TEXTO— viajan APILADAS en una sola celda con `wrap-anywhere`, y el aporte se
 * queda con su columna propia a la derecha. No se oculta ni un dato (R52) y no se abrevia ninguno
 * (R51): es la misma información en dos columnas en vez de cuatro.
 *
 * `wrap-anywhere` y no `break-words`: el segundo no reduce el `min-content`, que es la medida que
 * decide si la tabla desborda. Y va en el TEXTO, nunca en el importe.
 */
const COLUMNS_MOVIL: Column<OrdenAporteDTO>[] = [
  {
    id: "orden",
    value: DETALLE_MI_MOVIMIENTO_COLUMNAS.orden,
    render: (o) => (
      <div className="flex flex-col gap-0.5 wrap-anywhere">
        <EnlaceOrden guia={o.guia} />
        <span>{o.destinatario}</span>
        {/* R13: la etiqueta legible del catálogo, nunca el valor del enum. */}
        <span className="text-xs text-muted-foreground">{resultadosTexto(o.resultados)}</span>
      </div>
    ),
  },
  {
    id: "aporte",
    value: DETALLE_MI_MOVIMIENTO_COLUMNAS.aporte,
    align: "right",
    render: (o) => <AporteCelda aporte={o.aporte} />,
  },
];

export interface DetalleMiMovimientoCierreProps {
  /** El id del MOVIMIENTO, y nada más: es lo único que cruza al servidor (R42). */
  movimientoId: string;
  /** El concepto VISIBLE de la fila. Compone los nombres accesibles de este panel (R5). */
  concepto: string;
  /** La fecha VISIBLE de la fila (`YYYY-MM-DD`). Compone los nombres accesibles con el anterior. */
  fecha: string;
}

export function DetalleMiMovimientoCierre({
  movimientoId,
  concepto,
  fecha,
}: DetalleMiMovimientoCierreProps) {
  const [page, setPage] = useState(1);
  /** UNA sola `<DataTable>` con dos juegos de columnas, no dos tablas (ver `COLUMNS_MOVIL`). */
  const esMovil = useIsMobile();
  const columnas = esMovil ? COLUMNS_MOVIL : COLUMNS;

  /**
   * T6.3 (segunda mitad, MEDIDA en Chromium) — QUE EL IMPORTE SE PUEDA LEER, no solo que este
   * entero.
   *
   * El juego de columnas de arriba deja la tabla del panel sin desborde a 390 px, pero no basta:
   * este panel vive DENTRO de una celda del libro, y el libro declara anchos minimos que suman
   * ~1.104 px. Medido a 390x844 antes de esto: la seccion heredaba **1.080 px** en un hueco
   * visible de **308**, y el aporte aterrizaba en `x=[1064, 1108]` — **674 px fuera del area
   * visible**. El numero estaba entero en el DOM y no habia forma de LEERLO sin arrastrar el
   * libro entero de lado. Eso es peor que los 25 px de la ficha 343.
   *
   * Se acota la seccion al ancho VISIBLE de ese contenedor y se la pega a su borde izquierdo.
   * Medido despues: seccion de 308 px, aporte en `x=[292, 336]` —dentro de la ventana—, desborde
   * del panel 0 y, con el libro arrastrado 600 px, el importe SIGUE dentro (`x=[280, 324]`).
   *
   * SOLO EN MOVIL, y a proposito: de 768 px para arriba el panel cabe holgado (a 1440 la seccion
   * mide 1.080 y el hueco 1.102, asi que el `max-width` no cambiaria nada) y acotarlo a 1024
   * meteria las CINCO columnas de escritorio en 686 px, cambiando un problema por otro. Lo de la
   * franja 768-1279 queda declarado como deuda medida, igual que hizo la 343, no tapado:
   * a 1024 el libro sigue pidiendo 418 px de arrastre.
   */
  const { ref: refSeccion, ancho: anchoVisible } = useAnchoDelScrollHorizontal<HTMLElement>(esMovil);

  /**
   * El estilo que acota: `max-width` (solo puede ENCOGER) y `sticky left-0` para que el panel se
   * quede pegado al borde visible mientras el libro se arrastra de lado. Sin medida fiable no se
   * aplica NADA — una medida ausente nunca puede colapsar el panel a cero.
   */
  const estiloAcotado =
    anchoVisible === null
      ? undefined
      : { maxWidth: `${anchoVisible}px`, position: "sticky" as const, left: 0 };

  const { data, error, isLoading } = useSWR(claveDetalle(movimientoId, page), () =>
    detalleFetcher(movimientoId, page),
  );

  const nombreRegion = DETALLE_MI_MOVIMIENTO_NOMBRE.region(concepto, fecha);

  // R48 — el concepto no se reparte por orden: la fila SE ABRE IGUAL y el panel dice de dónde
  // sale el importe, en vez de callar.
  if (data?.modo === "sin_reparto") {
    return (
      <section
        ref={refSeccion}
        aria-label={nombreRegion}
        className="flex flex-col gap-2 rounded-lg bg-muted/40 p-3 text-sm"
        style={estiloAcotado}
      >
        <p className="text-muted-foreground">
          {DETALLE_MI_MOVIMIENTO_SIN_REPARTO[data.motivo]}
        </p>
      </section>
    );
  }

  const payload = data?.modo === "ok" ? data.data : undefined;
  const ordenes = payload?.ordenes ?? [];
  /** R28 — el total del CONJUNTO, contado por la BASE. Nunca `ordenes.length`. */
  const total = payload?.total ?? 0;
  /** R26 — el tamaño de página lo fija la CONFIGURACIÓN, no un literal de pantalla. */
  const pageSize = payload?.pageSize ?? detalleMovimientoConfig.DEFAULT_PAGE_SIZE;

  return (
    <section
      ref={refSeccion}
      aria-label={nombreRegion}
      className="flex flex-col gap-3 rounded-lg bg-muted/40 p-3"
      style={estiloAcotado}
    >
      {/* R9/R12 — de qué cierre sale el importe y el «N de M», acotado a las órdenes de ESTA
          tienda. R15: NO se pinta el mensajero, y esta pantalla ni siquiera tiene la frase. */}
      {payload ? (
        <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
          <span className="font-medium">
            {DETALLE_MI_MOVIMIENTO_CABECERA.cierre(payload.cierre.fecha.slice(0, 10))}
          </span>
          <span className="text-muted-foreground">
            {DETALLE_MI_MOVIMIENTO_CABECERA.cardinales(payload.total, payload.ordenesDelCierre)}
          </span>
          {/* El importe de la FILA, para poder cotejarlo con lo que suman las órdenes. NO es un
              subtotal de la página (R47): es el mismo dato que la fila de arriba ya muestra. */}
          <span className="tabular-nums whitespace-nowrap">
            {DETALLE_MI_MOVIMIENTO_CABECERA.importe(money(payload.monto))}
          </span>
        </header>
      ) : null}

      <div className="overflow-x-auto">
        <DataTable
          columns={columnas}
          data={ordenes}
          rowKey="ordenId"
          ariaLabel={DETALLE_MI_MOVIMIENTO_NOMBRE.tabla(concepto, fecha)}
          isLoading={isLoading}
          /* R7: el fallo se cuenta DENTRO de esta fila; el libro entero sigue en pie. */
          error={error ? DETALLE_MI_MOVIMIENTO_ERROR : null}
          emptyMessage={DETALLE_MI_MOVIMIENTO_VACIO}
          /* R31/R32/R33 — la descarga es del MOVIMIENTO abierto, no del cierre entero. */
          descarga={{
            titulo: DETALLE_MI_MOVIMIENTO_NOMBRE.descarga(concepto, fecha),
            columnas: COLUMNAS_DESCARGA_DETALLE_MI_MOVIMIENTO,
            obtenerFilas: () => obtenerFilasDescarga(movimientoId),
          }}
        />
      </div>

      {/* R24/R25/R28 — paginación SERVER-SIDE: el total es el del conjunto, no el de la página.
          `compacta` porque este panel vive dentro de una fila de otra tabla: la barra es
          una fila mas, no el pie de un listado. (Aqui decia `sticky={false}`; la barra ya
          no flota nunca, se comia el clic de los botones de debajo.) */}
      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={setPage}
        disabled={isLoading}
        ariaLabel={DETALLE_MI_MOVIMIENTO_NOMBRE.paginacion(concepto, fecha)}
        compacta
        className="w-full justify-between gap-3 py-0"
      />
    </section>
  );
}
