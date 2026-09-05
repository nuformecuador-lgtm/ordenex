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
  verDetalleDeMovimientoAction,
  verDetalleDeMovimientoCompletoAction,
} from "@/lib/actions/wallet";
import { detalleMovimientoConfig } from "@/lib/config/detalle-movimiento";
import type {
  DetalleMovimientoPayload,
  MotivoSinReparto,
  OrdenAporteDTO,
} from "@/lib/types/detalle-movimiento";
import { PARAM_TERMINO_DEFAULT } from "@/lib/utils/filtros-url";

import {
  COLUMNAS_DESCARGA_DETALLE_MOVIMIENTO,
  filaDescargaDetalleMovimiento,
} from "./detalle-movimiento-descarga-columnas";
import {
  DETALLE_MOVIMIENTO_CABECERA,
  DETALLE_MOVIMIENTO_COLUMNAS,
  DETALLE_MOVIMIENTO_ERROR,
  DETALLE_MOVIMIENTO_NOMBRE,
  DETALLE_MOVIMIENTO_SIN_REPARTO,
  DETALLE_MOVIMIENTO_VACIO,
  etiquetaVerOrden,
  resultadosTexto,
} from "./detalle-movimiento-labels";
import { money } from "./wallet-labels";

// Ficha 344 (T6.2/T6.3, design §5) — LAS ÓRDENES QUE COMPONEN EL IMPORTE de una fila del libro
// de movimientos de la caja principal.
//
// Se MONTA solo cuando su fila está abierta (`DataTable` no renderiza el contenido de una fila
// cerrada), y es aquí —dentro— donde vive el `useSWR`. De ahí salen tres requisitos de golpe: el
// libro con sus filas cerradas cuesta CERO lecturas de detalle (R2), abrir una fila cuesta
// exactamente UNA (R3) y cada panel abierto lleva su propia página y su propia caché, así que
// dos filas abiertas no se pisan (R4). Es el mismo patrón —vivo y medido— de
// `DetalleFilaComposicion` (ficha 343) y de `DesgloseMovimientosTienda` (ficha 171).
//
// EL CLIENTE MANDA EL ID DEL MOVIMIENTO Y NADA MÁS (R42, design §3.1). Ni el cierre, ni la
// categoría, ni la tienda: todo eso lo resuelve el SERVIDOR leyendo esa fila. Es lo que hace que
// el alcance de `/mi-wallet` sea imposible de forzar desde fuera, y es la misma lección de la
// ficha 343 —donde el cliente mandaba un token de fila— llevada un piso más abajo.
//
// MONEY-SAFE (R44/R45): el aporte de cada orden y el importe del movimiento llegan como STRING
// escala 2 y se pintan TAL CUAL con `money`. Aquí no se suma, no se resta y no se convierte a
// número. Y NO hay fila de subtotal (R47): la página no es el conjunto, y un subtotal de página
// al lado del importe de la fila es una invitación a restarlos.

/** Prefijo de la clave SWR. Identifica esta lectura entre todas las de la app. */
const CLAVE_DETALLE = "wallet-libro:detalle-movimiento";

/**
 * R4 — clave SWR del detalle de UN movimiento: el movimiento y la página, y nada más.
 *
 * No entra ningún filtro del libro, a diferencia de la ficha 343: el conjunto de este detalle
 * lo define el CIERRE del que sale el movimiento, no lo que el usuario esté filtrando arriba.
 * Meter los filtros en la clave invalidaría la caché por un cambio que no puede alterar la
 * respuesta.
 */
function claveDetalle(movimientoId: string, page: number): readonly [string, string, number] {
  return [CLAVE_DETALLE, movimientoId, page] as const;
}

/**
 * Lo que la pantalla necesita saber tras leer: o el desglose, o POR QUÉ no lo hay.
 *
 * `sin_reparto` NO es un error y por eso no viaja como `throw` (R48): el movimiento existe, es
 * de un cierre, y lo que falta es el reparto por orden. La fila se abre igual y el panel dice de
 * dónde sale ese importe. Tratarlo como error dejaría el panel diciendo «no se pudo cargar»,
 * que es justamente la fila muda que R48 prohíbe.
 */
type VistaDetalle =
  | { modo: "ok"; data: DetalleMovimientoPayload }
  | { modo: "sin_reparto"; motivo: MotivoSinReparto };

/**
 * Fetcher SWR: pide la página del detalle. `ok` y `sin_reparto` son respuestas; el resto
 * (`not_found`, `forbidden`, `unauthenticated`, `validation_error`) se traduce a un throw, que
 * SWR marca como error y el panel cuenta DENTRO de su fila (R7).
 *
 * `pageSize` NO se manda: el tamaño y el tope los pone el SERVIDOR desde
 * `detalleMovimientoConfig` (R26). La pantalla no declara ninguno de los dos como literal.
 */
async function detalleFetcher(movimientoId: string, page: number): Promise<VistaDetalle> {
  const res = await verDetalleDeMovimientoAction({ movimientoId, page });
  if (res.status === "sin_reparto") return { modo: "sin_reparto", motivo: res.motivo };
  if (res.status !== "ok") throw new Error(res.status);
  return { modo: "ok", data: res.data };
}

/**
 * R32/R33/R34 — las filas del archivo salen de la LECTURA DEDICADA del servidor, sin paginar y
 * con su tope aplicado allí. El navegador no selecciona, no ordena y no recorta.
 *
 * LA LÍNEA DE `sin_reparto`. `filasDesdeResultado` es el adaptador COMÚN de todas las descargas
 * del repo y conoce las tres formas de `ListarCompletoResult`; este detalle añade una cuarta que
 * no es de esa familia. Se descarta ANTES de llamarlo, en una línea: un concepto sin reparto no
 * tiene filas que descargar. En la práctica no se llega aquí —el panel de un `sin_reparto` ni
 * siquiera monta el control—, pero el borde puede cambiar de opinión entre la lectura y la
 * pulsación, y el usuario merece leer el motivo en vez de un error genérico.
 */
async function obtenerFilasDescarga(movimientoId: string): Promise<DescargaFilasResult> {
  const res = await verDetalleDeMovimientoCompletoAction({ movimientoId });
  if (res.status === "sin_reparto") {
    return { status: "error", mensaje: DETALLE_MOVIMIENTO_SIN_REPARTO[res.motivo] };
  }
  return filasDesdeResultado(res, filaDescargaDetalleMovimiento);
}

/**
 * R11 — la guía de la orden, llevada al buscador de `/ordenes`.
 *
 * Es un `<Link>`, no un `router.push`: es una NAVEGACIÓN, así que se abre en pestaña nueva con
 * ctrl+clic, se copia con el botón derecho y funciona sin JS.
 *
 * La clave del parámetro NO se escribe a mano: se importa `PARAM_TERMINO_DEFAULT`, el mismo
 * defecto que `BuscadorFiltros` lee de la URL en `/ordenes`. Escribir `"q"` aquí dejaría un
 * enlace muerto el día que ese defecto cambie — es la lección de la ficha 341, y sigue vigente.
 *
 * Caso borde HEREDADO y declarado (`requirements.md § Q4`): el buscador exige un mínimo de
 * caracteres, así que una guía de uno o dos dígitos llega a `/ordenes` sin filtrar y la propia
 * pantalla lo dice por escrito. No falla en silencio, y por eso el enlace se pinta igual.
 *
 * Sin guía no hay enlace: `/ordenes?q=` no acotaría NADA, y un enlace que promete filtrar y no
 * filtra miente.
 */
function EnlaceOrden({ guia }: { guia: string }) {
  const termino = guia.trim();
  if (termino === "") return <span>{guia}</span>;

  const etiqueta = etiquetaVerOrden(termino);
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
 * `whitespace-nowrap` para que la cifra no se parta nunca por la mitad y `tabular-nums` para que
 * las cifras de dos filas seguidas queden en rejilla, igual que el libro de la caja con su
 * columna de monto.
 *
 * PROHIBIDO AQUÍ: `truncate`, `line-clamp`, `overflow-hidden`, `break-all` y cualquier
 * abreviatura de miles. Es la misma prohibición que ya está escrita en `cierre-factura.tsx` («un
 * número a medias es un número FALSO, peor que uno que se sale») y en el panel de la ficha 343,
 * y es literalmente el defecto que aquella ficha midió en Chromium: a 390 px la pantalla decía
 * «₡1.70» donde el DOM decía «₡1.700». Dinero cortado no se ve roto: se ve como OTRO número.
 */
function AporteCelda({ aporte }: { aporte: string }) {
  return <span className="tabular-nums whitespace-nowrap">{money(aporte)}</span>;
}

/**
 * R10/R13/R14 — las CINCO columnas del detalle en escritorio, en orden: guía (enlazada),
 * destinatario, tienda, resultado y aporte.
 *
 * «Resultado» es la columna que explica el «14 de 23»: sin ella, quien mire el detalle no
 * entiende por qué faltan nueve órdenes que sí estaban en el cierre. «Tienda» sólo existe en la
 * caja principal (R14); el panel de `/mi-wallet` no la pinta, porque todas sus órdenes son de la
 * misma tienda.
 */
const COLUMNS: Column<OrdenAporteDTO>[] = [
  {
    id: "guia",
    value: DETALLE_MOVIMIENTO_COLUMNAS.guia,
    render: (o) => <EnlaceOrden guia={o.guia} />,
  },
  {
    id: "destinatario",
    value: DETALLE_MOVIMIENTO_COLUMNAS.destinatario,
    render: (o) => o.destinatario,
  },
  {
    id: "tienda",
    value: DETALLE_MOVIMIENTO_COLUMNAS.tienda,
    render: (o) => o.tiendaNombre,
  },
  {
    id: "resultado",
    value: DETALLE_MOVIMIENTO_COLUMNAS.resultado,
    // R13: la etiqueta legible del catálogo, nunca el valor del enum.
    render: (o) => resultadosTexto(o.resultados),
  },
  {
    id: "aporte",
    value: DETALLE_MOVIMIENTO_COLUMNAS.aporte,
    align: "right",
    render: (o) => <AporteCelda aporte={o.aporte} />,
  },
];

/**
 * Ficha 344 (T6.3, R50/R52) — LAS MISMAS CINCO COLUMNAS EN DOS, PARA UN TELÉFONO.
 *
 * EL DEFECTO QUE ESTO EVITA, medido en Chromium por la ficha 343 a 390x844: una tabla de CUATRO
 * columnas pedía 309 px en un hueco de 284, y el IMPORTE —la última columna— se quedaba fuera
 * del área visible; se leía «₡1.70» donde el DOM decía «₡1.700», y «₡10.20» donde decía
 * «₡10.200». Aquí las columnas son CINCO, así que el problema es peor por construcción.
 *
 * Por debajo de 768 px las cuatro primeras —que son TEXTO— viajan APILADAS dentro de una sola
 * celda y el aporte se queda con su columna propia a la derecha. No se oculta ni un dato y no se
 * abrevia ninguno (R52): es la misma información en dos columnas en vez de cinco.
 *
 * Por qué esto quita el recorte y no sólo lo aplaza: la celda de texto lleva `wrap-anywhere`, así
 * que puede encoger hasta casi nada y el ancho mínimo de la tabla pasa a ser prácticamente el del
 * aporte. `wrap-anywhere` y no `break-words`, porque el segundo no reduce el `min-content`, que
 * es la medida que aquí manda; y va en el TEXTO, nunca en el importe (ver `AporteCelda`).
 *
 * ESCRITORIO NO SE TOCA: de 768 px para arriba se usa `COLUMNS`. El corte lo decide
 * `useIsMobile` (`max-width: 767px`), el mismo hook con el que el Sidebar distingue teléfono de
 * escritorio; en el servidor devuelve `false`, o sea escritorio.
 */
const COLUMNS_MOVIL: Column<OrdenAporteDTO>[] = [
  {
    id: "orden",
    value: DETALLE_MOVIMIENTO_COLUMNAS.orden,
    render: (o) => (
      <div className="flex flex-col gap-0.5 wrap-anywhere">
        <EnlaceOrden guia={o.guia} />
        <span>{o.destinatario}</span>
        <span className="text-xs text-muted-foreground">{o.tiendaNombre}</span>
        {/* R13: la etiqueta legible del catálogo, nunca el valor del enum. */}
        <span className="text-xs text-muted-foreground">{resultadosTexto(o.resultados)}</span>
      </div>
    ),
  },
  {
    id: "aporte",
    value: DETALLE_MOVIMIENTO_COLUMNAS.aporte,
    align: "right",
    render: (o) => <AporteCelda aporte={o.aporte} />,
  },
];

export interface DetalleMovimientoCierreProps {
  /** El id del MOVIMIENTO, y nada más: es lo único que cruza al servidor (R42). */
  movimientoId: string;
  /** El concepto VISIBLE de la fila. Compone los nombres accesibles de este panel (R5). */
  concepto: string;
  /** La fecha VISIBLE de la fila (`YYYY-MM-DD`). Compone los nombres accesibles con el anterior. */
  fecha: string;
}

export function DetalleMovimientoCierre({
  movimientoId,
  concepto,
  fecha,
}: DetalleMovimientoCierreProps) {
  const [page, setPage] = useState(1);
  /**
   * T6.3 — QUÉ FORMA TIENE LA TABLA según el ancho. Es UNA sola `<DataTable>` con dos juegos de
   * columnas, no dos tablas: dos instancias duplicarían el DOM del panel, y la guardia de
   * cobertura de descargas cuenta instancias de `<DataTable>` archivo por archivo.
   */
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

  const nombreRegion = DETALLE_MOVIMIENTO_NOMBRE.region(concepto, fecha);

  // R48 — el concepto no se reparte por orden: la fila SE ABRE IGUAL y el panel dice de dónde
  // sale el importe. Ni tabla vacía ni panel en blanco: una fila muda haría pensar que la
  // pantalla está rota, cuando lo que pasa es que ese importe no nace de una acumulación por
  // orden. El hueco de alcance se VE.
  if (data?.modo === "sin_reparto") {
    return (
      <section
        ref={refSeccion}
        aria-label={nombreRegion}
        className="flex flex-col gap-2 rounded-lg bg-muted/40 p-3 text-sm"
        style={estiloAcotado}
      >
        <p className="text-muted-foreground">{DETALLE_MOVIMIENTO_SIN_REPARTO[data.motivo]}</p>
      </section>
    );
  }

  const payload = data?.modo === "ok" ? data.data : undefined;
  const ordenes = payload?.ordenes ?? [];
  /**
   * R28 — el total del CONJUNTO, contado por la BASE. **Nunca `ordenes.length`**, que es el de la
   * página que se está pintando: con eso la barra diría «14 de 14» teniendo el cierre doscientas
   * órdenes que aportan, y nadie podría llegar nunca a la segunda página.
   */
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
      {/* R9/R12/R15 — de qué cierre sale el importe, quién lo movió y el «14 de 23». */}
      {payload ? (
        <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
          <span className="font-medium">
            {DETALLE_MOVIMIENTO_CABECERA.cierre(payload.cierre.fecha.slice(0, 10))}
          </span>
          {/* R15: sólo la caja principal nombra al mensajero. El servidor manda `null` en
              `/mi-wallet`, y ese panel además no pinta esta línea. */}
          {payload.cierre.mensajeroNombre === null ? null : (
            <span className="text-muted-foreground">
              {DETALLE_MOVIMIENTO_CABECERA.mensajero(payload.cierre.mensajeroNombre)}
            </span>
          )}
          <span className="text-muted-foreground">
            {DETALLE_MOVIMIENTO_CABECERA.cardinales(payload.total, payload.ordenesDelCierre)}
          </span>
          {/* El importe de la FILA, para poder cotejarlo con lo que suman las órdenes. NO es un
              subtotal de la página (R47): es el mismo dato que la fila de arriba ya muestra, y
              se pinta tal cual con `money`, sin operar. */}
          <span className="tabular-nums whitespace-nowrap">
            {DETALLE_MOVIMIENTO_CABECERA.importe(money(payload.monto))}
          </span>
        </header>
      ) : null}

      <div className="overflow-x-auto">
        <DataTable
          columns={columnas}
          data={ordenes}
          rowKey="ordenId"
          ariaLabel={DETALLE_MOVIMIENTO_NOMBRE.tabla(concepto, fecha)}
          isLoading={isLoading}
          /* R7: el fallo se cuenta DENTRO de esta fila; el libro entero sigue en pie. */
          error={error ? DETALLE_MOVIMIENTO_ERROR : null}
          emptyMessage={DETALLE_MOVIMIENTO_VACIO}
          /* R31/R32/R33 — la descarga es del MOVIMIENTO abierto, no del cierre entero: un
             archivo = una fila del libro = un concepto. Es lo que el usuario está mirando
             cuando pulsa. */
          descarga={{
            titulo: DETALLE_MOVIMIENTO_NOMBRE.descarga(concepto, fecha),
            columnas: COLUMNAS_DESCARGA_DETALLE_MOVIMIENTO,
            obtenerFilas: () => obtenerFilasDescarga(movimientoId),
          }}
        />
      </div>

      {/* R24/R25/R28 — paginación SERVER-SIDE: el total es el del conjunto, no el de la página.
          `compacta` porque este panel vive dentro de una fila de otra tabla: la barra es una
          fila más. Aquí decía `sticky={false}`, que además evitaba el fragmento de DOS
          elementos del modo pegajoso; ese modo ya no existe (flotaba sobre las filas y se
          comía su clic). */}
      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={setPage}
        disabled={isLoading}
        ariaLabel={DETALLE_MOVIMIENTO_NOMBRE.paginacion(concepto, fecha)}
        compacta
        className="w-full justify-between gap-3 py-0"
      />
    </section>
  );
}
