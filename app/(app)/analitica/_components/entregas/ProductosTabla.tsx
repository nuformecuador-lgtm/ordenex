"use client";

// FICHA 345 (T7.2/T8.3) — QUE PRODUCTOS SE MUEVEN, y con que resultado.
// FICHA 346 — el cubo que faltaba en el desglose.
// FICHA 347 — CUANTA PLATA movio cada producto, y DE QUE se compone «Otros resultados».
//
// Es la septima lectura viva de la seccion de entregas y comparte con las otras seis todo lo
// que se puede compartir: el mismo filtro (`FiltroEntregasProvider`), el mismo prefijo de clave
// SWR (asi el boton «Actualizar» la revalida sin conocerla), los mismos textos de error y la
// misma regla de que un problema de permisos NO se degrada a una tabla vacia.
//
// ─── LAS CUATRO COSAS QUE ESTE COMPONENTE NO HACE, Y CADA UNA POR SU MOTIVO ────────────────
//
//  1. **No reordena las filas.** Llegan ya ordenadas del servicio (unidades desc, ordenes desc,
//     producto asc, tienda asc) y ese orden es DETERMINISTA por contrato (R33). Ordenar aqui
//     por segunda vez daria un orden distinto en la pantalla que en el archivo —que proyecta el
//     DTO tal cual— y ademas convertiria la paginacion en una loteria: la pagina 2 dependeria
//     de cual de los dos ordenes gano.
//  2. **No calcula ningun porcentaje.** `calcularEfectividad(fila.porStatus)` fila a fila, que
//     es la MISMA funcion que produce la fila de KPIs de mas arriba (R28). Por construccion el
//     denominador por producto es el universo entero del recorte, incluidas las ordenes que
//     siguen en proceso (R29). Una segunda definicion de «efectividad» a dos secciones de
//     distancia es exactamente lo que la alternativa A6 del diseño descarto.
//  3. **No escribe ningun literal de estado del catalogo** (`entregada`, `rechazada`...). Los
//     buckets los reparte `calcularEfectividad` y la composicion la deriva
//     `composicionOtrosResultados`, las dos leyendo `DESENLACES`. Una lista de estados aqui se
//     quedaria atras el dia que el catalogo gane uno, en silencio.
//  4. **No razona sobre permisos para pintar la columna «Tienda».** Ver `hayVariasTiendas`.
//
// ─── EL AVISO QUE NO PUEDE FALTAR (R36 de la 345, R45 de la 347) ────────────────────────────
//
// Una orden con varios productos cuenta en CADA uno de ellos. El 12 % de las ordenes medidas en
// produccion lleva mas de uno, asi que la suma de la columna «Ordenes» puede superar el total
// del rango sin que nada este roto. Sin el rotulo, quien sume la columna concluye que las
// cifras no cuadran — y tendra razon en lo que ve y no en lo que deduce.
//
// Con el DINERO eso deja de ser una molestia y pasa a ser una trampa: el importe COMPLETO de
// una orden se atribuye a CADA producto que contiene, asi que **la columna «Recaudado» NO SE
// PUEDE SUMAR HACIA ABAJO** — sumarla cuenta la misma plata tantas veces como productos tenga
// la orden. Por eso la advertencia se dice TRES veces y de tres formas distintas, que es lo que
// R45 pide: en el parrafo de arriba, en la marca corta de cada encabezado de dinero
// (`MARCA_NO_SUMABLE`) y en el encabezado del archivo descargable (R49, porque el parrafo de
// pantalla no viaja con el `.xlsx`). Y `ordenesAcompanadas` va en la propia celda: dice en
// cuantas de las ordenes de esa fila el importe se esta atribuyendo tambien a otro producto,
// que es lo que permite calibrar cuanto pesa la advertencia en ESTA fila.
//
// ⚠ NO HAY —NI PUEDE HABER— NINGUN TOTAL AL PIE de una columna de dinero de esta tabla (R46), y
// eso no depende de que alguien se acuerde: lo vigila
// `tests/unit/analytics/dinero-producto-no-sumable.guardia.test.ts`, que ademas del barrido
// estatico RENDERIZA la tabla con tres importes cuya suma es un numero que no aparece en ningun
// otro sitio y afirma que ese numero no esta en el DOM (R47), con su autocomprobacion (R48).
//
// ─── MONEY-SAFE (R22) ───────────────────────────────────────────────────────────────────────
//
// Los importes llegan como STRING escala 2 y se pintan con `money()` de `lib/config/moneda`,
// que formatea SIN convertir a numero. `formatearValor(_, "moneda")` recibe un `number` y NO se
// usa en este camino. Prohibidos en este archivo `Number(`, `parseFloat(`, `parseInt(` y
// `.toFixed(`; prohibidos tambien `truncate`, `line-clamp` y `overflow-hidden` sobre una cifra
// (R63): dinero cortado no se ve roto, se ve como OTRO numero.

import { useMemo, useState, type ReactNode } from "react";
import { PackageSearch } from "lucide-react";
import useSWR from "swr";

import { serializarFiltroEntregas } from "@/app/(app)/_components/entregas-filtro-analitica";
import { useFiltroEntregas } from "@/app/(app)/_components/filtro-entregas";
import { formatearValor } from "@/components/private/analytics/formato";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { filasLocales } from "@/components/shared/descarga-resultado";
import { Pagination } from "@/components/shared/Pagination";
import { useIsMobile } from "@/hooks/use-mobile";
import { money } from "@/lib/config/moneda";
import type { FilaProductoDTO, ResultadoConteoProductos } from "@/lib/types/conteo-productos";

import {
  TEXTO_ERROR_PANEL,
  TEXTO_PROHIBIDO,
  TEXTO_SESION_NO_VALIDA,
  TITULO_FILTRO_INVALIDO,
} from "../operativo/textos";

import { textoSello, textoSelloCompleto } from "./ActualizarAnalitica";
import { DineroProductoDetalle } from "./DineroProductoDetalle";
import { calcularEfectividad } from "./efectividad";
import { textoComposicionOtrosResultados } from "./otros-resultados";
import {
  columnasDescargaAnaliticaProductos,
  filaDescargaAnaliticaProductos,
} from "./analitica-productos-descarga-columnas";
import { claveConteoProductos, consultarConteoProductosSwr } from "./productos-swr";

/* -------------------------------------------------------------------------- */
/* Textos                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * TODOS los textos de esta pantalla, en un solo objeto y fuera del JSX: es lo que deja la
 * seccion lista para i18n sin volver a tocar el arbol de componentes.
 */
export const PRODUCTOS_TEXTOS = {
  titulo: "Productos",
  tabla: "Productos del rango, por unidades movidas",
  descarga: "Productos",
  /** R36 — el aviso que impide leer la columna «Ordenes» como si fuera sumable. */
  aviso:
    "Una orden con varios productos cuenta en cada uno: la suma de la columna Órdenes puede superar el total del rango.",
  /**
   * FICHA 346 — la regla de lectura del desglose, dicha en la pantalla.
   *
   * Va aqui porque el defecto que esta ficha repara era INVISIBLE: quien sumaba las columnas y
   * le faltaban seis ordenes no tenia forma de saber si el error estaba en la tabla o en su
   * cuenta. Con la frase, la igualdad es una promesa comprobable a simple vista.
   */
  avisoDesglose:
    "Cada orden cuenta en un solo grupo: entregadas, rechazadas, otros resultados y en proceso suman la columna Órdenes.",
  /**
   * FICHA 347 (R45) — EL AVISO DEL DINERO, y es el mas importante de los tres.
   *
   * Dice las dos cosas que hacen ilegibles las columnas de dinero si no se saben: que el
   * importe es el de la ORDEN entera (no el del producto, que NO EXISTE en ninguna parte del
   * sistema — `orden.producto` solo trae `cantidad * nombre`) y que por eso la columna no se
   * puede sumar hacia abajo.
   */
  avisoDinero:
    "Las cifras de dinero son de la ORDEN completa, no del producto: una orden con varios productos cuenta entera en cada uno. Estas columnas no se pueden sumar hacia abajo.",
  /**
   * FICHA 347 (R29) — de que habla el reparto. Va junto al aviso de arriba porque las dos
   * columnas del reparto solo tienen sentido leidas con esta frase delante: lo que Ordenex
   * cobro y lo que es de la tienda se saben SOLO de las ordenes ya liquidadas; de las demas no
   * se proyecta nada (R31) y por eso su celda dice «—» y no «0,00» (R30).
   */
  avisoLiquidado:
    "«Cobró Ordenex» y «Para la tienda» son solo de las órdenes ya liquidadas (cierre aprobado). Lo cobrado y aún sin liquidar se muestra aparte, en la celda de Recaudado.",
  vacioTitulo: "Sin productos en el rango",
  vacioDescripcion:
    "Ninguna orden del filtro seleccionado dejó un producto que se pueda interpretar.",
  /** FICHA 347 (R76) — el tope de la lectura de dinero, superado. El volumen sigue en pie. */
  dineroLimiteExcedido: (limite: number) =>
    `El filtro seleccionado supera las ${limite} órdenes que la lectura de dinero puede recorrer, así que no se muestra ninguna cifra: una suma sobre un conjunto truncado parecería firme y estaría incompleta. Acote el rango o las facetas.`,
  /** FICHA 347 (R32) — el nombre accesible del control que abre el detalle de UNA fila. */
  abrirDetalle: (producto: string, tienda: string) =>
    `Ver las órdenes con dinero de ${producto} en ${tienda}`,
} as const;

/**
 * FICHA 347 (R45) — LA MARCA CORTA que llevan los tres encabezados de dinero.
 *
 * Se declara UNA vez y la comparten la vista de escritorio, la de telefono y —con su propia
 * redaccion larga— el archivo descargable. Un literal repetido en tres sitios acabaria diciendo
 * tres cosas distintas.
 */
export const MARCA_NO_SUMABLE = "(no sumable)";

/** Los encabezados de columna, aparte para que la vista de teléfono use LOS MISMOS. */
export const PRODUCTOS_COLUMNAS = {
  tienda: "Tienda",
  producto: "Producto",
  unidades: "Unidades",
  ordenes: "Órdenes",
  entregadas: "Entregadas",
  rechazadas: "Rechazadas",
  /**
   * FICHA 346 — el cubo que faltaba: los desenlaces que no son entrega ni rechazo.
   *
   * SE LLAMA «Otros resultados» y no «Otros», que es como se llama el cubo del anillo de al
   * lado, porque son cosas OPUESTAS: alli «Otros» son las ordenes SIN desenlace y aqui esas
   * mismas ordenes se llaman «En proceso». Dos rotulos iguales con significados contrarios en
   * la misma pantalla se leen uno por el otro.
   *
   * ⚠ FICHA 347 — Y SIGUE SIN ENUMERAR («Devueltas y reprogramadas»): la etiqueta mentiria el
   * dia que el catalogo gane un desenlace mas, que es el defecto que la 346 acaba de reparar.
   * Lo que esta ficha añade no es un rotulo mas largo, es la COMPOSICION REAL de cada fila
   * —dato derivado de `porStatus`— como segunda linea de la celda. Crece sola con el catalogo.
   */
  otrosResultados: "Otros resultados",
  enProceso: "En proceso",
  efectividad: "Efectividad de entrega",
  rechazo: "% de rechazo",
  /**
   * FICHA 347 — las TRES columnas de dinero, cada una con su marca de no sumable.
   *
   * Son tres y no siete (⟨Q6⟩ pedia los cuatro nombres de la wallet: flete, comision, IVA y
   * pago a la tienda) porque esta tabla ya lleva diez columnas y a 390 px tiene DOS arreglos de
   * ancho medidos. El desglose fino vive en el panel que se abre bajo la fila.
   */
  recaudado: `Recaudado ${MARCA_NO_SUMABLE}`,
  ordenex: `Cobró Ordenex ${MARCA_NO_SUMABLE}`,
  paraTienda: `Para la tienda ${MARCA_NO_SUMABLE}`,
  /** Solo en la vista de teléfono: la celda que apila las cifras de arriba. */
  cifras: "Resultado",
} as const;

/** R35 — el universo del recorte y las ordenes cuyo texto no produjo ningun producto. */
export function textoUniverso(ordenes: number, sinProducto: number): string {
  const total = formatearValor(ordenes, UNIDAD_CONTEO);
  const sin = formatearValor(sinProducto, UNIDAD_CONTEO);
  return `${total} órdenes en el rango · ${sin} sin producto interpretable.`;
}

/**
 * FICHA 347 (R13) — cuantas de las ordenes de esta fila iban ACOMPAÑADAS de otro producto.
 *
 * Es la cifra que permite calibrar el aviso de no-sumable EN ESTA FILA: con 0 acompañadas el
 * recaudado de la fila no se solapa con ninguna otra; con 8 de 8, ese importe entero esta
 * tambien en otra fila de la tabla.
 */
export function textoAcompanadas(acompanadas: number, ordenes: number): string {
  const n = formatearValor(acompanadas, UNIDAD_CONTEO);
  const total = formatearValor(ordenes, UNIDAD_CONTEO);
  // «Con otro producto: 3 de 10» y no «3 de 10 órdenes llevan otro producto»: con una sola
  // orden la segunda redaccion obliga a un singular, y una linea de contexto que cambia de
  // forma segun el numero es mas dificil de leer en vertical que una etiqueta fija.
  return `Con otro producto: ${n} de ${total}`;
}

/**
 * FICHA 347 (R28/R29) — lo cobrado que TODAVIA no esta liquidado, con cuantas ordenes lo
 * componen. Es un HECHO (el recaudo existe desde que se registro la gestion), no una
 * proyeccion: lo que no se emite de estas ordenes es su reparto (R31).
 */
export function textoPendiente(recaudado: string, ordenes: number): string {
  const n = formatearValor(ordenes, UNIDAD_CONTEO);
  const sustantivo = ordenes === 1 ? "orden" : "órdenes";
  return `Pendiente de cierre: ${money(recaudado)} (${n} ${sustantivo})`;
}

/* -------------------------------------------------------------------------- */
/* Formato                                                                     */
/* -------------------------------------------------------------------------- */

/** Son ordenes y unidades CONTADAS: ni dinero, ni porcentaje. */
const UNIDAD_CONTEO = "conteo";

/**
 * Los dos porcentajes de la fila llegan como FRACCION (0,375) y `formatearValor` los multiplica
 * por cien. `null` sale como el marcador de dato ausente del repo, nunca como «0 %».
 */
const UNIDAD_PORCENTAJE = "porcentaje";

/** Cuantas filas por pagina de partida. Con 84 productos medidos, tres pantallas. */
const PAGE_SIZE_INICIAL = 25;

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

/* -------------------------------------------------------------------------- */
/* Estados que NO son «no hubo productos»                                      */
/* -------------------------------------------------------------------------- */

/**
 * El mensaje que corresponde a cada estado que no es `ok`. `null` = no hay error.
 *
 * R44 — «prohibido», «sesion no valida», «filtro invalido» y «se rompio» son CUATRO textos
 * distintos y ninguno se degrada al estado vacio de la tabla: un problema de permisos pintado
 * como «no hubo productos» afirma un hecho del negocio que nadie ha comprobado.
 */
export function mensajeDe(
  resultado: ResultadoConteoProductos | undefined,
  fallo: boolean,
): string | null {
  if (fallo) return TEXTO_ERROR_PANEL;
  if (!resultado) return null;
  switch (resultado.status) {
    case "unauthenticated":
      return TEXTO_SESION_NO_VALIDA;
    case "forbidden":
      return TEXTO_PROHIBIDO;
    case "validation_error":
      return TITULO_FILTRO_INVALIDO;
    default:
      return null;
  }
}

/**
 * R37/R46 — ¿se pinta la columna «Tienda»?
 *
 * SE DECIDE POR EL CONTENIDO DE LA RESPUESTA Y NUNCA POR EL ROL, y esa es la mitad del punto:
 * para un `adminTienda` siempre hay una sola tienda, asi que la columna desaparece sola sin que
 * el cliente razone sobre permisos; y un maestro que filtre una sola tienda tampoco la necesita.
 * Con un `if (rol === …)` aqui habria una segunda regla de alcance en el navegador, que es donde
 * menos vale.
 *
 * Se cuenta por `tiendaId` y no por nombre: dos tiendas homonimas son dos tiendas.
 */
export function hayVariasTiendas(filas: readonly FilaProductoDTO[]): boolean {
  return new Set(filas.map((fila) => fila.tiendaId)).size > 1;
}

/** Clave de fila: la tienda Y el producto. Un producto solo no es unico entre tiendas (R37). */
function claveDeFila(fila: FilaProductoDTO): string {
  return `${fila.tiendaId}::${fila.producto}`;
}

/* -------------------------------------------------------------------------- */
/* Las columnas                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Las CIFRAS de una fila, en el orden del diseño. Se declaran una vez y las consumen las dos
 * vistas —la de escritorio como columnas y la de telefono como lineas apiladas—, de modo que
 * un telefono no puede acabar enseñando menos datos que un portatil (R46/R64).
 *
 * `efectividadGestion` existe en `EfectividadEntrega` y NO se pinta, a proposito: en la lectura
 * por producto lo que interesa es el rechazo COMERCIAL, y dos porcentajes que suman distinto en
 * la misma fila invitan a leer uno por el otro.
 */
type IdCifra =
  | "unidades"
  | "ordenes"
  | "entregadas"
  | "rechazadas"
  | "otrosResultados"
  | "enProceso"
  | "efectividad"
  | "rechazo";

/**
 * El ORDEN de las ocho cifras, declarado una vez. Es el de `design.md §7.3` mas el cubo que
 * anadio la ficha 346.
 *
 * LAS CUATRO PRIMERAS DE CONTEO SUMAN LA COLUMNA «Órdenes» —entregadas, rechazadas, otros
 * resultados y en proceso—, y esa igualdad es el arreglo de la 346: antes eran tres y el
 * desglose se quedaba corto. La comprueba `tests/components/ProductosTabla.test.tsx` leyendo
 * las CELDAS pintadas, no la funcion.
 */
const ORDEN_CIFRAS: readonly { readonly id: IdCifra; readonly etiqueta: string }[] = [
  { id: "unidades", etiqueta: PRODUCTOS_COLUMNAS.unidades },
  { id: "ordenes", etiqueta: PRODUCTOS_COLUMNAS.ordenes },
  { id: "entregadas", etiqueta: PRODUCTOS_COLUMNAS.entregadas },
  { id: "rechazadas", etiqueta: PRODUCTOS_COLUMNAS.rechazadas },
  // FICHA 346 — va PEGADA a las dos anteriores y antes de «En proceso»: las tres primeras son
  // ordenes ya resueltas y la cuarta es trabajo vivo. Leidas en ese orden, la suma de las
  // cuatro es la columna «Órdenes» sin tener que saltar de sitio.
  { id: "otrosResultados", etiqueta: PRODUCTOS_COLUMNAS.otrosResultados },
  { id: "enProceso", etiqueta: PRODUCTOS_COLUMNAS.enProceso },
  { id: "efectividad", etiqueta: PRODUCTOS_COLUMNAS.efectividad },
  { id: "rechazo", etiqueta: PRODUCTOS_COLUMNAS.rechazo },
];

function cifrasDeFila(fila: FilaProductoDTO): Readonly<Record<IdCifra, string>> {
  const e = calcularEfectividad(fila.porStatus);
  return {
    unidades: formatearValor(fila.unidades, UNIDAD_CONTEO),
    ordenes: formatearValor(fila.ordenes, UNIDAD_CONTEO),
    entregadas: formatearValor(e.entregadas, UNIDAD_CONTEO),
    rechazadas: formatearValor(e.rechazadas, UNIDAD_CONTEO),
    otrosResultados: formatearValor(e.otrosDesenlaces, UNIDAD_CONTEO),
    enProceso: formatearValor(e.enProceso, UNIDAD_CONTEO),
    efectividad: formatearValor(e.efectividad, UNIDAD_PORCENTAJE),
    rechazo: formatearValor(e.tasaRechazo, UNIDAD_PORCENTAJE),
  };
}

/**
 * FICHA 347 — LAS TRES CIFRAS DE DINERO de una fila, declaradas igual que sus hermanas de
 * conteo y por el mismo motivo: las consumen las DOS vistas, asi que el telefono no puede
 * quedarse con menos dinero que el escritorio (R64).
 */
type IdDinero = "recaudado" | "ordenex" | "paraTienda";

const ORDEN_DINERO: readonly { readonly id: IdDinero; readonly etiqueta: string }[] = [
  { id: "recaudado", etiqueta: PRODUCTOS_COLUMNAS.recaudado },
  { id: "ordenex", etiqueta: PRODUCTOS_COLUMNAS.ordenex },
  { id: "paraTienda", etiqueta: PRODUCTOS_COLUMNAS.paraTienda },
];

/**
 * El importe de una fila para una de las tres cifras, o `null` si NO HAY.
 *
 * ⚠ LOS TRES CAMINOS QUE DEVUELVEN `null` SON DISTINTOS Y SE PINTAN IGUAL, y esta bien que asi
 * sea: la fila no tiene ninguna orden que aporte (`fila.dinero === null`), o la tiene pero
 * ninguna esta liquidada (`ordenex`/`tienda` llegan `null` del servidor, R30). En los dos casos
 * el hecho es el mismo —«todavia no hay reparto»— y `money(null)` lo pinta «—».
 *
 * ⚠ AQUI NO HAY —NI PUEDE HABER— UN `?? "0.00"`. Ese es exactamente el defecto que la mutacion
 * M6 introduce y que R30 prohibe: «no hubo» y «salio cero» son hechos distintos.
 */
function importeDeFila(fila: FilaProductoDTO, id: IdDinero): string | null {
  const dinero = fila.dinero;
  if (dinero === null) return null;
  if (id === "recaudado") return dinero.recaudado;
  if (id === "ordenex") return dinero.liquidado.ordenex;
  return dinero.liquidado.tienda;
}

/**
 * Una cifra de la tabla. `tabular-nums` para que dos filas seguidas queden en rejilla y
 * `whitespace-nowrap` para que un porcentaje o un importe no se parta por la mitad.
 *
 * PROHIBIDO AQUI `truncate`, `line-clamp` y `overflow-hidden`, por la leccion medida de las
 * fichas 343 y 344: un numero a medias no se ve roto, se ve como OTRO numero.
 */
function Cifra({ children }: { readonly children: string }) {
  return <span className="tabular-nums whitespace-nowrap">{children}</span>;
}

/**
 * Una LINEA DE CONTEXTO bajo una cifra: mas pequeña, apagada y —esto es lo importante— con
 * permiso para partirse en varias lineas. Las cifras nunca se parten; los rotulos si.
 */
function Contexto({ children }: { readonly children: ReactNode }) {
  return <span className="text-xs text-muted-foreground">{children}</span>;
}

/**
 * El nombre del producto. `wrap-anywhere` porque los nombres reales son LARGUISIMOS —el mas
 * largo medido en produccion tiene 62 caracteres y tres barras verticales de marketing— y sin
 * esto una sola fila fija el ancho minimo de la tabla y empuja las cifras fuera de la pantalla.
 * `wrap-anywhere` y no `break-words`: el segundo no reduce el `min-content`, que es la medida
 * que aqui manda.
 */
function NombreProducto({ children }: { readonly children: string }) {
  return <span className="wrap-anywhere">{children}</span>;
}

/**
 * FICHA 347 (entrega B, R50/R54/R57) — la celda de «Otros resultados»: el CONTEO y, debajo, DE
 * QUE se compone.
 *
 * SEGUNDA LINEA Y NO UN TOOLTIP, y la decision esta medida (alternativa A5): un tooltip no
 * existe en tactil —y esta tabla ya lleva dos arreglos de ancho a 390 px—, no se copia con el
 * raton y los lectores de pantalla lo tratan de forma desigual. La composicion es DATO en el
 * DOM, legible siempre y sin apuntar a nada.
 *
 * TAMPOCO una celda expandible: añadiria un SEGUNDO control por fila en una tabla que ya va a
 * tener uno (el del detalle de dinero), y dos disclosures por fila es exactamente el ruido que
 * la 343 quito de la wallet.
 *
 * Con el conteo en cero no se pinta NADA debajo (R54): una composicion vacia es una linea en
 * blanco que hace la tabla mas alta sin decir nada.
 */
function CeldaOtrosResultados({ fila, cifra }: { readonly fila: FilaProductoDTO; readonly cifra: string }) {
  const composicion = textoComposicionOtrosResultados(fila.porStatus);
  return (
    <span className="flex flex-col items-end gap-0.5">
      <Cifra>{cifra}</Cifra>
      {composicion === "" ? null : <Contexto>{composicion}</Contexto>}
    </span>
  );
}

/**
 * FICHA 347 — la celda de «Recaudado»: el importe y DOS lineas de contexto.
 *
 * Son lineas y no columnas nuevas, y el motivo es de ancho medido: la tabla ya tiene diez
 * columnas y a 390 px lleva dos arreglos por desbordes reales. Tres columnas de dinero mas
 * caben; siete no.
 *
 * La linea de pendiente solo aparece cuando hay algo pendiente: un «Pendiente de cierre: ₡0 (0
 * órdenes)» en cada fila seria ruido en la fila donde todo esta liquidado, que es el caso bueno.
 */
function CeldaRecaudado({ fila }: { readonly fila: FilaProductoDTO }) {
  const dinero = fila.dinero;
  const pendiente = dinero !== null && dinero.pendiente.ordenes > 0;
  return (
    <span className="flex flex-col items-end gap-0.5">
      <Cifra>{money(importeDeFila(fila, "recaudado"))}</Cifra>
      <Contexto>{textoAcompanadas(fila.ordenesAcompanadas, fila.ordenes)}</Contexto>
      {pendiente && dinero !== null ? (
        <Contexto>{textoPendiente(dinero.pendiente.recaudado, dinero.pendiente.ordenes)}</Contexto>
      ) : null}
    </span>
  );
}

/** La celda de una cifra de dinero. `recaudado` lleva sus dos lineas; las otras dos, no. */
function celdaDinero(fila: FilaProductoDTO, id: IdDinero): ReactNode {
  if (id === "recaudado") return <CeldaRecaudado fila={fila} />;
  return <Cifra>{money(importeDeFila(fila, id))}</Cifra>;
}

/** Las columnas de ESCRITORIO. La de tienda se antepone solo cuando hace falta. */
function columnasEscritorio(conTienda: boolean, conDinero: boolean): Column<FilaProductoDTO>[] {
  const tienda: Column<FilaProductoDTO>[] = conTienda
    ? [
        {
          id: "tienda",
          value: PRODUCTOS_COLUMNAS.tienda,
          render: (fila) => <NombreProducto>{fila.tienda}</NombreProducto>,
        },
      ]
    : [];

  // R6 — sin la concesion NO SE DECLARA ni una columna de dinero. No se pinta vacia, no se
  // pinta en cero y no se pinta deshabilitada: no existe.
  const dinero: Column<FilaProductoDTO>[] = conDinero
    ? ORDEN_DINERO.map<Column<FilaProductoDTO>>((cifra) => ({
        id: cifra.id,
        value: cifra.etiqueta,
        align: "right",
        // ⚠ SIN `minWidth`, Y ES UNA DECISION MEDIDA EN CHROMIUM, no una omision.
        //
        // Nacio con `minWidth: "10rem"` —la intuicion de que un importe largo necesita sitio—
        // y el navegador dijo lo contrario: con `₡12.345.678` inyectado en las tres columnas,
        // la cifra ocupa 81 px y `recorteInterno` es 0, asi que los 160 px del minimo no los
        // pedia el importe sino la CABECERA. Lo que si costaban era ancho de tabla: a 1440 px
        // el scroller desbordaba 341 px y la ultima columna quedaba 300 px fuera de la
        // ventana. Sin el minimo, las columnas caen a 84-95 px, el desborde baja a 124 px y la
        // ultima columna queda a 83 px —y el importe sigue COMPLETO, con recorte interno 0—.
        //
        // Lo que protege la cifra de estrujarse no es el minimo: es el `whitespace-nowrap` de
        // `Cifra`, que fija el ancho minimo de la columna en el ancho del propio numero.
        render: (fila) => celdaDinero(fila, cifra.id),
      }))
    : [];

  // ⚠ EL DINERO VA JUSTO DETRAS DEL PRODUCTO, Y NO AL FINAL. NO ES EL ORDEN «NATURAL» —el que
  // diseñaron la 345 y la 346 es producto → volumen → desenlace, y el dinero llegaria detras—,
  // asi que conviene saber por que se rompe, con el numero delante.
  //
  // MEDIDO EN CHROMIUM a 1440x950 (la anchura de escritorio mas comun aqui): con las trece
  // columnas la tabla pide **1226 px** y su contenedor da **1102**. Faltan 124 px y no hay forma
  // honesta de recuperarlos —se probaron cuatro y las cuatro llegan a cero destrozando algo:
  // `hyphens:auto` en las cabeceras las deja leyendose «Uni-da-des» y «Re-cha-za-das» en
  // vertical; quitarle el suelo a «Producto» lo baja a 100 px y parte los nombres a mitad de
  // palabra («Hemorroid/es», «TURKESTER/ONE»). Las cabeceras YA van plegadas al `min-content` de
  // su palabra mas larga y en `text-xs`, asi que acortar rotulos no mueve un pixel: «Efectividad
  // de entrega» mide 163 px en una linea y su columna 93, o sea que ya esta plegada.
  //
  // Si algo se queda fuera pase lo que pase, **la pregunta es QUE**. Y ahi no hay empate: el
  // dinero es el dato que se PIDIO —«falta saber cuanto dinero se ha podido recaudar»— y
  // «% de rechazo» es una cifra DERIVADA de dos columnas que estan a la vista. Con este orden,
  // «Para la tienda» termina a 809 px y se lee con **cero arrastre**; el precio, dicho para que
  // nadie lo descubra por sorpresa, es que «% de rechazo» pide **124 px** de desplazamiento
  // horizontal — el mismo que antes pagaba el dinero.
  //
  // No esconde ninguna columna, no encoge ninguna cifra y no toca la vista de telefono, que
  // apila y no tiene este problema (desborde 0 a 390 px). El orden lo fija
  // `ProductosTablaDinero.test.tsx` › «el ORDEN de escritorio pone el dinero...»: devolverlo al
  // final pone ese caso rojo.
  return [
    ...tienda,
    {
      id: "producto",
      value: PRODUCTOS_COLUMNAS.producto,
      minWidth: "14rem",
      render: (fila) => <NombreProducto>{fila.producto}</NombreProducto>,
    },
    ...dinero,
    ...ORDEN_CIFRAS.map<Column<FilaProductoDTO>>((cifra) => ({
      id: cifra.id,
      value: cifra.etiqueta,
      align: "right",
      render: (fila) =>
        cifra.id === "otrosResultados" ? (
          <CeldaOtrosResultados fila={fila} cifra={cifrasDeFila(fila)[cifra.id]} />
        ) : (
          <Cifra>{cifrasDeFila(fila)[cifra.id]}</Cifra>
        ),
    })),
  ];
}

/**
 * Las columnas de TELEFONO: dos, y ni un dato menos.
 *
 * EL DEFECTO QUE ESTO EVITA, medido por las fichas 343 y 344 en Chromium a 390x844: una tabla de
 * cuatro columnas pedia 309 px en un hueco de 284 y el ultimo numero acababa fuera del area
 * visible; en la 344, 674 px fuera. Esta tabla tiene DIEZ columnas —TRECE con el dinero— y
 * nombres de producto de 62 caracteres, asi que el problema seria peor por construccion.
 *
 * Se apilan: el producto (con su tienda debajo cuando hay varias) en una celda y las cifras,
 * cada una con su etiqueta, en la otra. No se oculta ni un dato y no se abrevia ninguno (R64).
 */
function columnasTelefono(conTienda: boolean, conDinero: boolean): Column<FilaProductoDTO>[] {
  return [
    {
      id: "producto",
      value: PRODUCTOS_COLUMNAS.producto,
      render: (fila) => (
        <div className="flex flex-col gap-0.5 wrap-anywhere">
          <NombreProducto>{fila.producto}</NombreProducto>
          {conTienda ? (
            <span className="text-xs text-muted-foreground">{fila.tienda}</span>
          ) : null}
        </div>
      ),
    },
    {
      id: "cifras",
      value: PRODUCTOS_COLUMNAS.cifras,
      align: "right",
      render: (fila) => {
        const cifras = cifrasDeFila(fila);
        const composicion = textoComposicionOtrosResultados(fila.porStatus);
        const dinero = fila.dinero;
        const pendiente = dinero !== null && dinero.pendiente.ordenes > 0;
        return (
          <div className="flex flex-col gap-0.5">
            {ORDEN_CIFRAS.map((cifra) => (
              // La etiqueta a la izquierda y la cifra a la derecha, y la ETIQUETA PUEDE PARTIRSE.
              // Medido a 390 px: con la linea entera en `whitespace-nowrap`, «Efectividad de
              // entrega: 33,3%» fijaba un minimo de 204 px para esta columna y dejaba el nombre
              // del producto en 104 px, partiendo palabras por la mitad. Dejando respirar a la
              // etiqueta, el minimo cae y el nombre recupera sitio. La CIFRA nunca se parte:
              // `whitespace-nowrap` sigue vivo dentro de `Cifra`, que es donde importa.
              //
              // FICHA 347 — la composicion de «Otros resultados» cae como SUB-LINEA de su cifra,
              // no dentro de ella: asi la pareja etiqueta+cifra se sigue leyendo igual y el
              // telefono no pierde el dato (R57/R64).
              <span key={cifra.id} className="flex flex-col gap-0.5">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-left text-xs text-muted-foreground">{cifra.etiqueta}</span>
                  <Cifra>{cifras[cifra.id]}</Cifra>
                </span>
                {cifra.id === "otrosResultados" && composicion !== "" ? (
                  <Contexto>{composicion}</Contexto>
                ) : null}
              </span>
            ))}
            {conDinero
              ? ORDEN_DINERO.map((cifra) => (
                  <span key={cifra.id} className="flex flex-col gap-0.5">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="text-left text-xs text-muted-foreground">
                        {cifra.etiqueta}
                      </span>
                      <Cifra>{money(importeDeFila(fila, cifra.id))}</Cifra>
                    </span>
                    {cifra.id === "recaudado" ? (
                      <Contexto>{textoAcompanadas(fila.ordenesAcompanadas, fila.ordenes)}</Contexto>
                    ) : null}
                    {cifra.id === "recaudado" && pendiente && dinero !== null ? (
                      <Contexto>
                        {textoPendiente(dinero.pendiente.recaudado, dinero.pendiente.ordenes)}
                      </Contexto>
                    ) : null}
                  </span>
                ))
              : null}
          </div>
        );
      },
    },
  ];
}

/* -------------------------------------------------------------------------- */
/* El componente                                                               */
/* -------------------------------------------------------------------------- */

export interface ProductosTablaProps {
  /**
   * FICHA 347 (R6) — ¿este actor tiene concedido el dinero por producto?
   *
   * Llega COMO PROP desde el Server Component (`app/(app)/analitica/page.tsx`), que lo lee de
   * `recorteDePresentacion(actor).productosDinero`. El navegador no razona sobre permisos y no
   * conoce ninguna tabla de alcance: aqui solo se decide QUE SE DIBUJA.
   *
   * Por defecto `false` —se falla CERRADO—: un montaje que no diga nada no pinta dinero.
   *
   * ⚠ Y NO SUSTITUYE A NADA: la Server Action deniega igual (R5) y no emite ni una cifra. Un
   * panel que no se pinta no es un dato que no se sirve. Por eso ademas de la prop se exige que
   * la RESPUESTA diga `concedido`: si el servidor denegara, aqui no se pinta un `—` por fila
   * como si fuera un dato ausente.
   */
  readonly dinero?: boolean;
}

export function ProductosTabla({ dinero = false }: ProductosTablaProps) {
  const { filtro } = useFiltroEntregas();
  const filtroSerializado = serializarFiltroEntregas(filtro);

  const { data, error, isLoading } = useSWR(
    claveConteoProductos(filtroSerializado),
    () => consultarConteoProductosSwr(filtroSerializado),
    // `keepPreviousData: false` — al cambiar el filtro la tabla se vacia y vuelve al estado de
    // carga (R43/R61). Conservar la anterior dejaria en pantalla los productos —y los importes—
    // del filtro previo como si fueran los del nuevo.
    { keepPreviousData: false, revalidateOnFocus: false },
  );

  const mensaje = mensajeDe(data, error !== undefined);
  const datos = data?.status === "ok" ? data.datos : null;
  const filas = useMemo(() => datos?.filas ?? [], [datos]);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZE_INICIAL);

  /**
   * R45 — LA PAGINACION ES DEL NAVEGADOR, y es una decision con fecha: la respuesta trae el
   * recorte entero (84 productos medidos en produccion, acotados por el CATALOGO y no por las
   * ventas), asi que paginar en el servidor costaria una consulta por pagina para ahorrar
   * pintar cincuenta filas. ⟨Q3⟩ del spec pregunta a partir de cuantos productos deja de valer;
   * mientras no haya numero, no se inventa un tope.
   *
   * La pagina se recorta contra el total: si el filtro cambia y ahora hay menos productos, una
   * pagina 4 que ya no existe dejaria la tabla vacia con datos detras.
   */
  const totalPaginas = Math.max(1, Math.ceil(filas.length / pageSize));
  const paginaVigente = Math.min(page, totalPaginas);
  const visibles = useMemo(
    () => filas.slice((paginaVigente - 1) * pageSize, paginaVigente * pageSize),
    [filas, paginaVigente, pageSize],
  );

  // R46 — por CONTENIDO. Se mira la respuesta ENTERA y no la pagina visible: si no, la columna
  // aparecería y desaparecería al pasar de página, que es peor que no tenerla.
  const conTienda = hayVariasTiendas(filas);

  /**
   * FICHA 347 (R6) — el dinero se pinta cuando SE CONCEDE EN LOS DOS SITIOS: la prop del
   * servidor dice que este actor lo tiene, y la RESPUESTA dice `concedido`.
   *
   * No es una redundancia por prudencia: son dos hechos distintos. La prop es «que se dibuja» y
   * el estado de la respuesta es «que se sirvio». Cuando el estado es `limite_excedido` (R76) la
   * concesion existe pero NO HAY CIFRAS, y pintar las columnas con «—» en todas las filas se
   * leeria como «este producto no movio dinero», que es una afirmacion falsa. En ese caso se
   * dice por escrito y las columnas de VOLUMEN siguen intactas.
   */
  const estadoDinero = datos?.dinero ?? null;
  const conDinero = dinero && estadoDinero?.estado === "concedido";
  const limiteExcedido =
    dinero && estadoDinero?.estado === "limite_excedido" ? estadoDinero.limite : null;

  const esTelefono = useIsMobile();
  const columnas = esTelefono
    ? columnasTelefono(conTienda, conDinero)
    : columnasEscritorio(conTienda, conDinero);

  /**
   * R52 — las filas del archivo salen del DTO QUE YA ESTA EN PANTALLA. Sin segunda consulta, asi
   * que el archivo no puede discrepar de la tabla; y son TODAS las filas del recorte, no las de
   * la pagina: la paginacion es un asunto de la pantalla y nadie descarga «la pagina 2».
   *
   * Familia B, y por el ADAPTADOR COMUN (`filasLocales`) y no armando el resultado a mano: ahi
   * es donde vive el tope unico de la app (5.000 filas, `descargaConfig.MAX_FILAS`) y el
   * mensaje accionable cuando se supera. Una tabla que se construyera su `DescargaFilasResult`
   * se saltaria ese tope entera y en silencio — lo vigila
   * `tests/components/descarga/ControlDescargaTransversal.test.tsx`, y esta tabla se vio caer en
   * el antes de cablearlo asi.
   *
   * FICHA 347 (R66/R67) — la proyeccion y las columnas van CONDICIONADAS a la MISMA concesion
   * que la pantalla. Sin ella el archivo no lleva ninguna columna de dinero: ni vacia, ni en
   * cero. Y con `limite_excedido` tampoco, porque no hay cifra que escribir.
   */
  const obtenerFilas = () =>
    filasLocales(filas, (f) => filaDescargaAnaliticaProductos(f, conDinero));

  return (
    <div className="flex w-full flex-col gap-3">
      {/* R36/R35/R45 — los avisos y, debajo, el universo del recorte. Van ARRIBA y no al pie:
          quien lee una columna tiene que haber leido antes por que puede sumar de mas. El
          universo solo se pinta cuando hay respuesta: con un error, un total de cero seria una
          cifra inventada. */}
      <div className="flex flex-col gap-1 text-xs text-muted-foreground">
        <p>{PRODUCTOS_TEXTOS.aviso}</p>
        {/* FICHA 346 — y cómo se leen las columnas del desglose, que desde esta ficha suman. */}
        <p>{PRODUCTOS_TEXTOS.avisoDesglose}</p>
        {/* FICHA 347 (R45/R29) — los dos avisos del dinero, solo cuando hay dinero que leer. */}
        {conDinero ? <p>{PRODUCTOS_TEXTOS.avisoDinero}</p> : null}
        {conDinero ? <p>{PRODUCTOS_TEXTOS.avisoLiquidado}</p> : null}
        {/* R76 — el tope, dicho. No es un error: el volumen de al lado es correcto. */}
        {limiteExcedido === null ? null : (
          <p>{PRODUCTOS_TEXTOS.dineroLimiteExcedido(limiteExcedido)}</p>
        )}
        {datos === null ? null : (
          <p>{textoUniverso(datos.ordenes, datos.ordenesSinProducto)}</p>
        )}
        {/* R65 — CUANDO se leyeron estas cifras de la base. La respuesta se sirve de una cache
            de 15 minutos, asi que sin el sello la pantalla afirma implicitamente que el numero
            es de este segundo. Sale del MISMO `lastSync` que sella el productor de la cache, o
            sea el mismo instante para el volumen y para el dinero (R78). */}
        {datos === null ? null : (
          <p title={textoSelloCompleto(datos.lastSync)}>{textoSello(datos.lastSync)}</p>
        )}
      </div>

      <DataTable
        columns={columnas}
        data={visibles}
        rowKey={claveDeFila}
        ariaLabel={PRODUCTOS_TEXTOS.tabla}
        isLoading={isLoading}
        error={mensaje}
        emptyState={{
          icon: PackageSearch,
          title: PRODUCTOS_TEXTOS.vacioTitulo,
          description: PRODUCTOS_TEXTOS.vacioDescripcion,
        }}
        /**
         * FICHA 347 (R32/R33/R34) — LA FILA QUE SE ABRE.
         *
         * `renderExpanded` se pasa SOLO con el dinero concedido: sin el, la tabla no antepone
         * la columna del control y queda EXACTAMENTE como estaba (R6).
         *
         * `DataTable` construye este elemento por fila pero solo lo mete en el DOM cuando la
         * fila esta abierta, y un elemento de React que no se monta no ejecuta ningun efecto:
         * por eso la tabla cerrada cuesta CERO lecturas de detalle (R33).
         *
         * `null` en las filas sin dinero: sin ordenes que aporten no hay detalle que abrir, y
         * `DataTable` no pinta boton para ellas — un control que abre un panel vacio es peor
         * que no tenerlo.
         */
        renderExpanded={
          conDinero
            ? (fila) =>
                fila.dinero === null ? null : (
                  <DineroProductoDetalle
                    filtroSerializado={filtroSerializado}
                    tiendaId={fila.tiendaId}
                    tiendaNombre={fila.tienda}
                    producto={fila.producto}
                  />
                )
            : undefined
        }
        // El nombre accesible identifica SU fila —producto y tienda—, no un «Ver detalle»
        // repetido N veces: con veinticinco filas abiertas, N botones homonimos no dicen nada.
        expandAriaLabel={(fila) => PRODUCTOS_TEXTOS.abrirDetalle(fila.producto, fila.tienda)}
        descarga={
          filas.length === 0
            ? undefined
            : {
                titulo: PRODUCTOS_TEXTOS.descarga,
                columnas: columnasDescargaAnaliticaProductos(conDinero),
                obtenerFilas,
              }
        }
      />

      {/* La barra solo aparece con filas: con la tabla vacia, en carga o en error no hay nada
          que paginar y un «Sin resultados» debajo de un mensaje de permisos lo contradice. */}
      {filas.length === 0 ? null : (
        <Pagination
          page={paginaVigente}
          pageSize={pageSize}
          total={filas.length}
          showFirstLast
          siblingCount={1}
          onPageChange={setPage}
          onPageSizeChange={(s) => {
            setPageSize(s);
            setPage(1);
          }}
          pageSizeOptions={PAGE_SIZE_OPTIONS}
          sticky={false}
        />
      )}
    </div>
  );
}
