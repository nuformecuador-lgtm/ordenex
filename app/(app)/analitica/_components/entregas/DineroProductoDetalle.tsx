"use client";

// FICHA 347 (F5) — EL DETALLE ORDEN POR ORDEN del dinero de UNA fila de la tabla de productos.
//
// Se MONTA al abrir su fila: el `renderExpanded` del `DataTable` crea el elemento pero solo lo
// mete en el DOM cuando la fila esta abierta, asi que la tabla con todo cerrado cuesta CERO
// lecturas de detalle (R33), abrir una cuesta exactamente una y dos paneles abiertos llevan su
// propia pagina y su propia entrada de cache (R34). Es el patron medido de las fichas 343 y 344,
// y por eso el `useSWR` vive AQUI dentro y no en la tabla.
//
// ─── MONEY-SAFE (R22), Y NO ES UNA PRECAUCION TEORICA ───────────────────────────────────────
//
// Los nueve importes de este archivo llegan como STRING escala 2 y se pintan con `money()`, que
// formatea SIN convertir a numero. Prohibidos aqui `Number(`, `parseFloat(`, `parseInt(` y
// `.toFixed(`: este repo ya perdio un centimo por una conversion (feature 204) y hay tres
// guardias vivas persiguiendo esas cuatro llamadas.
//
// Y prohibidos tambien `truncate`, `line-clamp` y `overflow-hidden` sobre una cifra (R63): la
// ficha 343 midio en Chromium a 390 px una pantalla que decia «₡1.70» donde el DOM decia
// «₡1.700». Dinero cortado no se ve roto, se ve como OTRO numero.
//
// ─── LOS `null` NO SON CEROS ────────────────────────────────────────────────────────────────
//
// `ordenex`, `tienda` y `retorno` llegan `null` cuando esa orden todavia no esta liquidada, y se
// pintan «—» (R30). `money(null)` ya devuelve la raya larga, asi que no hace falta —ni se debe—
// escribir un `?? "0.00"` en ningun sitio: «todavia no es un hecho» y «fue cero» son dos cosas
// distintas y esta pantalla las distingue.

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";

import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Pagination } from "@/components/shared/Pagination";
import { money } from "@/lib/config/moneda";
import { PARAM_TERMINO_DEFAULT } from "@/lib/utils/filtros-url";
import type { DineroProductoDTO } from "@/lib/types/conteo-productos";
import type { OrdenDineroDTO } from "@/lib/types/dinero-productos";

import { TEXTO_ERROR_PANEL, TEXTO_PROHIBIDO } from "../operativo/textos";

import {
  claveDetalleDineroProducto,
  consultarDetalleDineroProductoSwr,
} from "./dinero-producto-swr";
import { etiquetaDeDesenlace } from "./etiqueta-desenlace";

/* -------------------------------------------------------------------------- */
/* Textos                                                                      */
/* -------------------------------------------------------------------------- */

/** TODOS los textos del panel, fuera del JSX: es lo que lo deja listo para i18n. */
export const DETALLE_DINERO_TEXTOS = {
  /** El nombre accesible de la region, con la fila a la que pertenece. */
  region: (producto: string, tienda: string) =>
    `Órdenes que componen el dinero de ${producto} en ${tienda}`,
  tabla: (producto: string) => `Órdenes con dinero de ${producto}`,
  paginacion: (producto: string) => `Paginación del detalle de ${producto}`,
  verOrden: (guia: string) => `Ver la orden ${guia} en el listado`,
  vacio: "Ninguna orden de este producto aportó dinero en el filtro seleccionado.",
  /** R76 — el tope se supero: NO se sirve una cifra sobre un conjunto truncado. */
  limiteExcedido: (limite: number) =>
    `El filtro seleccionado supera las ${limite} órdenes que esta lectura puede recorrer. Acote el rango o las facetas para ver el dinero.`,
  /**
   * R45 — el aviso, otra vez y aqui dentro. No es una repeticion decorativa: este panel se lee
   * abierto, con la cabecera de la tabla fuera de la vista, y sus `totales` son las MISMAS
   * cifras de la fila. Sin la frase, la suma de la columna del panel invita a la lectura que
   * R45 prohibe.
   */
  avisoOrden:
    "Cada importe es el de la ORDEN completa, no el del producto: una orden con varios productos cuenta entera en cada uno.",
  totales: {
    recaudado: "Recaudado",
    recaudadoPista: "En órdenes que incluyen este producto",
    ordenex: "Cobró Ordenex",
    ordenexPista: "Solo de lo ya liquidado: flete + IVA y comisión + IVA",
    tienda: "Para la tienda",
    tiendaPista: "Solo de lo ya liquidado: lo recaudado menos lo anterior",
    pendiente: "Pendiente de cierre",
    pendientePista: "Cobrado y todavía sin liquidar: no se reparte",
    /**
     * ⚠ SE LLAMA «Flete por rechazo» Y NO «flete de devolución», y no es una preferencia de
     * estilo: sólo un RECHAZO cobra este flete. Desde la ficha 301 una `devuelta` NO deriva
     * ningún concepto —el paquete sigue vivo en la calle y todavía puede reprogramarse—, así
     * que el nombre viejo decía JUSTO EL CASO QUE NO COBRA. La ficha 338 lo renombró en toda
     * la app después de que el humano leyera «Flete devuelto» en un cierre y creyera que se le
     * estaba cobrando a una tienda por una devolución. Lo vigila
     * `tests/unit/guards/flete-por-rechazo-censo.guardia.test.ts`, y esta pantalla se vio caer
     * en él antes de corregirlo.
     */
    retorno: "Flete por rechazo",
    retornoPista: "Flete por rechazo + IVA de las rechazadas. Fuera del reparto",
  },
  columnas: {
    guia: "Guía",
    destinatario: "Destinatario",
    resultados: "Resultados",
    estado: "Estado",
    recaudado: "Recaudado",
    ordenex: "Cobró Ordenex",
    tienda: "Para la tienda",
    retorno: "Flete por rechazo",
  },
  estado: {
    liquidada: "Liquidada",
    pendiente: "Pendiente",
  },
} as const;

/* -------------------------------------------------------------------------- */
/* Piezas                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Una cifra de dinero de la cabecera. `valor` llega como STRING del servidor, o `null` cuando
 * NO HAY (R30) — y `money` ya pinta la raya larga, que es el marcador de dato ausente del repo.
 */
function ImporteCabecera({
  rotulo,
  valor,
  pista,
}: {
  readonly rotulo: string;
  readonly valor: string | null;
  readonly pista: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-sm text-muted-foreground">{rotulo}</span>
      <span className="text-lg font-medium tabular-nums whitespace-nowrap">{money(valor)}</span>
      <span className="text-xs text-muted-foreground">{pista}</span>
    </div>
  );
}

/** Un importe de una fila del detalle. Ver la cabecera del archivo sobre lo prohibido aqui. */
function Importe({ valor }: { readonly valor: string | null }) {
  return <span className="tabular-nums whitespace-nowrap">{money(valor)}</span>;
}

/**
 * R36 — la guia, llevada al buscador de `/ordenes`.
 *
 * `<Link>` y no `router.push`: es una NAVEGACION, asi que se abre en pestana nueva con
 * ctrl+clic, se copia con el boton derecho y funciona sin JS. La clave del parametro se
 * IMPORTA (`PARAM_TERMINO_DEFAULT`), nunca se escribe `"q"` a mano: es la leccion de la 341.
 *
 * Sin guia no hay enlace: `/ordenes?q=` no acotaria nada, y un enlace que promete filtrar y no
 * filtra miente.
 */
function EnlaceOrden({ guia }: { readonly guia: string }) {
  const termino = guia.trim();
  if (termino === "") return <span>{guia}</span>;

  const etiqueta = DETALLE_DINERO_TEXTOS.verOrden(termino);
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
 * Los resultados de las gestiones que hicieron aportar a esa orden (R37).
 *
 * Se nombran con `etiquetaDeDesenlace`, el MISMO mecanismo del anillo y de la composicion de
 * «Otros resultados»: aqui no hay ninguna tabla de etiquetas escrita a mano, asi que un
 * renombre del catalogo no deja este panel diciendo el nombre viejo.
 */
function Resultados({ valores }: { readonly valores: readonly string[] }) {
  return <span>{valores.map(etiquetaDeDesenlace).join(", ")}</span>;
}

/** Las OCHO columnas del detalle, en el orden del diseño. */
const COLUMNAS: Column<OrdenDineroDTO>[] = [
  {
    id: "guia",
    value: DETALLE_DINERO_TEXTOS.columnas.guia,
    render: (o) => <EnlaceOrden guia={o.guia} />,
  },
  {
    id: "destinatario",
    value: DETALLE_DINERO_TEXTOS.columnas.destinatario,
    render: (o) => <span className="wrap-anywhere">{o.destinatario}</span>,
  },
  {
    id: "resultados",
    value: DETALLE_DINERO_TEXTOS.columnas.resultados,
    render: (o) => <Resultados valores={o.resultados} />,
  },
  {
    id: "estado",
    value: DETALLE_DINERO_TEXTOS.columnas.estado,
    render: (o) => (
      <Badge variant={o.estado === "liquidada" ? "default" : "secondary"}>
        {DETALLE_DINERO_TEXTOS.estado[o.estado]}
      </Badge>
    ),
  },
  {
    id: "recaudado",
    value: DETALLE_DINERO_TEXTOS.columnas.recaudado,
    align: "right",
    render: (o) => <Importe valor={o.recaudado} />,
  },
  {
    id: "ordenex",
    value: DETALLE_DINERO_TEXTOS.columnas.ordenex,
    align: "right",
    render: (o) => <Importe valor={o.ordenex} />,
  },
  {
    id: "tienda",
    value: DETALLE_DINERO_TEXTOS.columnas.tienda,
    align: "right",
    render: (o) => <Importe valor={o.tienda} />,
  },
  {
    id: "retorno",
    value: DETALLE_DINERO_TEXTOS.columnas.retorno,
    align: "right",
    render: (o) => <Importe valor={o.retorno} />,
  },
];

/* -------------------------------------------------------------------------- */
/* El componente                                                               */
/* -------------------------------------------------------------------------- */

export interface DineroProductoDetalleProps {
  /** El filtro de la seccion, ya serializado: entra en la clave SWR y en la peticion (R59). */
  readonly filtroSerializado: string;
  /** La tienda de la fila. Viaja como FACETA del filtro, no como campo suelto (R43/R44). */
  readonly tiendaId: string;
  /** El nombre de la tienda, para los rotulos. Baja por props: ya esta en la fila. */
  readonly tiendaNombre: string;
  /** La forma VISIBLE del producto. El servidor la normaliza con `claveDeProducto`. */
  readonly producto: string;
  /** id del elemento, para enlazar con el `aria-controls` del boton que lo expande. */
  readonly id?: string;
}

export function DineroProductoDetalle({
  filtroSerializado,
  tiendaId,
  tiendaNombre,
  producto,
  id,
}: DineroProductoDetalleProps) {
  const [page, setPage] = useState(1);

  const { data, error, isLoading } = useSWR(
    claveDetalleDineroProducto(filtroSerializado, tiendaId, producto, page),
    () => consultarDetalleDineroProductoSwr(filtroSerializado, tiendaId, producto, page),
    { keepPreviousData: false, revalidateOnFocus: false },
  );

  const payload = data?.status === "ok" ? data.datos : null;
  const totales: DineroProductoDTO | null = payload?.totales ?? null;

  // R62 — cada estado tiene SU texto y ninguno se degrada a una tabla vacia: «no puedes»,
  // «no cabe» y «se rompio» piden cosas distintas del usuario, y «no hubo» es un hecho.
  const mensaje = mensajeDelPanel(data, error !== undefined);

  return (
    <section
      id={id}
      aria-label={DETALLE_DINERO_TEXTOS.region(producto, tiendaNombre)}
      className="flex flex-col gap-4"
    >
      {/* R38 — los `totales` en la cabecera, para poder COTEJAR la suma sin salir de la
          pantalla. Son las MISMAS cifras de la fila, y lo son por construccion: salen de la
          misma funcion sobre el mismo conjunto. Mientras no hay respuesta van todas «—», no
          en cero: pendiente de cargar NO es lo mismo que cero (R61). */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <ImporteCabecera
          rotulo={DETALLE_DINERO_TEXTOS.totales.recaudado}
          valor={totales?.recaudado ?? null}
          pista={DETALLE_DINERO_TEXTOS.totales.recaudadoPista}
        />
        <ImporteCabecera
          rotulo={DETALLE_DINERO_TEXTOS.totales.ordenex}
          valor={totales?.liquidado.ordenex ?? null}
          pista={DETALLE_DINERO_TEXTOS.totales.ordenexPista}
        />
        <ImporteCabecera
          rotulo={DETALLE_DINERO_TEXTOS.totales.tienda}
          valor={totales?.liquidado.tienda ?? null}
          pista={DETALLE_DINERO_TEXTOS.totales.tiendaPista}
        />
        <ImporteCabecera
          rotulo={DETALLE_DINERO_TEXTOS.totales.pendiente}
          valor={totales?.pendiente.recaudado ?? null}
          pista={DETALLE_DINERO_TEXTOS.totales.pendientePista}
        />
        {/* R19 — el retorno va APARTE y fuera del reparto, y su pista dice por que: un rechazo
            no recauda cobro contra entrega, asi que no hay plata recogida que repartir. */}
        <ImporteCabecera
          rotulo={DETALLE_DINERO_TEXTOS.totales.retorno}
          valor={totales?.retorno ?? null}
          pista={DETALLE_DINERO_TEXTOS.totales.retornoPista}
        />
      </div>

      <p className="text-xs text-muted-foreground">{DETALLE_DINERO_TEXTOS.avisoOrden}</p>

      <DataTable
        columns={COLUMNAS}
        data={payload ? [...payload.ordenes] : []}
        rowKey="ordenId"
        ariaLabel={DETALLE_DINERO_TEXTOS.tabla(producto)}
        isLoading={isLoading}
        error={mensaje}
        emptyMessage={DETALLE_DINERO_TEXTOS.vacio}
      />

      {/* R40 — el total es el del CONJUNTO, contado por el servidor, y NUNCA el numero de filas
          de la pagina que se esta pintando. Sin filas no se pinta la barra: un «Sin resultados»
          debajo de un mensaje de permisos lo contradice. */}
      {payload === null ? null : (
        <Pagination
          page={payload.page}
          pageSize={payload.pageSize}
          total={payload.total}
          onPageChange={setPage}
          disabled={isLoading}
          ariaLabel={DETALLE_DINERO_TEXTOS.paginacion(producto)}
          compacta
        />
      )}
    </section>
  );
}

/**
 * El mensaje que corresponde a cada estado que no es `ok` ni `vacio`. `null` = no hay error.
 *
 * `vacio` NO es un error y por eso devuelve `null`: la tabla pinta su estado vacio, que es lo
 * que R42 pide —un estado explicito, ni una tabla en blanco ni un fallo—.
 *
 * `unauthenticated` cae en el mismo texto que `forbidden` a proposito y solo aqui: este panel
 * se abre DENTRO de una pantalla que ya exigio sesion, asi que llegar aqui sin ella es un
 * caso de carrera y no un flujo. La distincion util —«no puedes» vs «no sabemos quien eres»—
 * la hace la tabla de arriba, que es la que se monta primero.
 */
export function mensajeDelPanel(
  resultado: { readonly status: string; readonly limite?: number } | undefined,
  fallo: boolean,
): string | null {
  if (fallo) return TEXTO_ERROR_PANEL;
  if (!resultado) return null;
  switch (resultado.status) {
    case "limite_excedido":
      return DETALLE_DINERO_TEXTOS.limiteExcedido(resultado.limite ?? 0);
    case "forbidden":
    case "unauthenticated":
      return TEXTO_PROHIBIDO;
    case "validation_error":
      return TEXTO_ERROR_PANEL;
    default:
      return null;
  }
}
