"use client";

// FICHA 345 (T7.2/T8.3) — QUE PRODUCTOS SE MUEVEN, y con que resultado.
// FICHA 346 — el cubo que faltaba en el desglose.
// FICHA 347 — CUANTA PLATA movio cada producto, y DE QUE se compone «Otros resultados».
// FICHA 348 — QUE NINGUNA PALABRA SE PARTA: trece minimos medidos y el aviso fuera del rotulo.
// FICHA 354 — un dato por renglon en la celda de «Recaudado».
// FICHA 442 — QUE LA TABLA SE PUEDA LEER: de 14 columnas a 5 mas una fila que se abre.
//
// ─── EL DEFECTO DE LA 442, MEDIDO (1440 px, sesion de maestro, 2026-09-17) ──────────────────
//
// | | |
// |---|---|
// | columnas                          | **14** (13 para tienda)      |
// | visibles sin desplazar            | **7**                        |
// | posicion de «Efectividad»         | **13.ª — fuera de pantalla** |
// | ancho de la tabla                 | 1584 px en una ventana de 1440 |
//
// Y lo primero que se veia eran las TRES columnas de dinero —Recaudado, Cobro Ordenex, Para la
// tienda—, las tres en «—» en las 25 filas, cada una arrastrando una linea secundaria («Con otro
// producto: 0 de 6») que doblaba el alto de cada fila. «Tienda» repetia el mismo nombre 25 veces
// y encima de la tabla habia SEIS lineas de advertencias en gris.
//
// Las fichas 348 y 354 hicieron bien su trabajo —ninguna palabra se parte, ninguna frase se
// pliega— pero respondian a otra pregunta. Trece columnas perfectamente medidas siguen siendo
// trece columnas: el arreglo no era de ancho, era de CUANTO se enseña de golpe.
//
// ─── LO QUE ENSEÑA AHORA (diseño aprobado: `design-analitica/Productos.dc.html`) ────────────
//
//  - **Cinco columnas**: Producto · Órdenes · **En qué terminaron** (una barra y su frase, no
//    cuatro columnas de numeros) · **Efectividad** · Recaudado.
//  - **Una fila que se abre** con el resto: unidades, cobro Ordenex, para la tienda, otros
//    resultados, % de rechazo — y, cuando hay dinero, el detalle orden por orden de la 347.
//  - **«Tienda» deja de ser una columna repetida** cuando es constante: pasa a un chip que la
//    dice UNA vez. Ver `hayVariasTiendas`.
//  - Las seis lineas de advertencias se pliegan en un **«Cómo se cuenta»** que se despliega.
//  - **La advertencia del dinero viaja con el dinero**: vive DENTRO del detalle, pegada a las
//    cifras, que es donde alguien podria sumarlas por error.
//
// ⚠ NO SE ESCONDE NI UN DATO, y esa es la condicion de todo lo anterior. Lo que sale de la
// pantalla entra en la fila desplegable, y **el archivo descargable no pierde ni una columna**
// (`analitica-productos-descarga-columnas.ts`: once columnas base y VEINTIUNA con dinero — la
// vigesimoprimera la anade la ficha 449, y va al FINAL para no correr de sitio a las otras).
// Esconder una columna en pantalla no es quitarla del dato.
//
// ─── LAS CUATRO COSAS QUE ESTE COMPONENTE NO HACE, Y CADA UNA POR SU MOTIVO ────────────────
//
//  1. **No reordena las filas.** Llegan ya ordenadas del servicio (unidades desc, ordenes desc,
//     producto asc, tienda asc) y ese orden es DETERMINISTA por contrato (R33). Ordenar aqui
//     por segunda vez daria un orden distinto en la pantalla que en el archivo —que proyecta el
//     DTO tal cual— y ademas convertiria la paginacion en una loteria: la pagina 2 dependeria
//     de cual de los dos ordenes gano.
//  2. **No calcula ningun porcentaje.** `calcularEfectividad(fila.porStatus)` fila a fila, que
//     es la MISMA funcion que produce la tarjeta heroe de la ficha 441 y la fila de KPIs (R28).
//     Por construccion el denominador por producto es el universo entero del recorte, incluidas
//     las ordenes que siguen en proceso (R29). Una segunda definicion de «efectividad» a dos
//     secciones de distancia es exactamente lo que la alternativa A6 del diseño descarto — y lo
//     que el `ConteoProductosService` dice por escrito que no se haga.
//  3. **No escribe ningun literal de estado del catalogo** (`entregada`, `rechazada`...). Los
//     buckets los reparte `calcularEfectividad`, la composicion la deriva
//     `composicionOtrosResultados` y la frase de desenlaces la arma `desenlaces-de-fila.ts`,
//     todas leyendo `DESENLACES`. Una lista de estados aqui se quedaria atras el dia que el
//     catalogo gane uno, en silencio.
//  4. **No razona sobre permisos para pintar la columna «Tienda».** Ver `hayVariasTiendas`.
//
// ─── EL AVISO QUE NO PUEDE FALTAR (R36 de la 345, R45 de la 347) ────────────────────────────
//
// Una orden con varios productos cuenta en CADA uno de ellos. El 12 % de las ordenes medidas en
// produccion lleva mas de uno, asi que la suma de la columna «Ordenes» puede superar el total
// del rango sin que nada este roto.
//
// Con el DINERO eso deja de ser una molestia y pasa a ser una trampa: el importe COMPLETO de
// una orden se atribuye a CADA producto que contiene, asi que **la columna «Recaudado» NO SE
// PUEDE SUMAR HACIA ABAJO**. Por eso la advertencia se sigue diciendo TRES veces y de tres
// formas distintas, que es lo que R45 pide — lo que la 442 cambia es DONDE:
//
//   1. **dentro del detalle, pegada a las cifras de dinero** (POR QUE). Es la mudanza de esta
//      ficha y la pidio el humano: la advertencia sirve donde alguien podria sumar;
//   2. en «Cómo se cuenta», con la leyenda que NOMBRA la columna afectada derivandola de las
//      columnas realmente pintadas (ver `textoColumnasNoSumables`);
//   3. en el encabezado del archivo descargable (R49), porque un `.xlsx` no lleva leyenda.
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
import { ChevronDown, PackageSearch } from "lucide-react";
import useSWR from "swr";

import { serializarFiltroEntregas } from "@/app/(app)/_components/entregas-filtro-analitica";
import { useFiltroEntregas } from "@/app/(app)/_components/filtro-entregas";
import { formatearValor } from "@/components/private/analytics/formato";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { filasLocales } from "@/components/shared/descarga-resultado";
import { Pagination } from "@/components/shared/Pagination";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
import { DineroProductoDetalle, hayMonto } from "./DineroProductoDetalle";
import { calcularEfectividad } from "./efectividad";
import {
  ETIQUETA_EN_PROCESO,
  textoDesenlacesDeFila,
  tramosDeFila,
  type IdTramoDesenlace,
} from "./desenlaces-de-fila";
import { NOMBRE_ESTADO } from "@/lib/types/order-status";
import { textoComposicionOtrosResultados } from "./otros-resultados";
import {
  descargaAnaliticaProductos,
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
  /**
   * FICHA 442 — el control que despliega las reglas de lectura.
   *
   * ⚠ LAS SEIS LINEAS EN GRIS ERAN EL PRIMER DEFECTO DE LA PANTALLA, y no por su contenido: cada
   * una de ellas dice algo cierto y necesario. El problema es que se leen ANTES que la tabla, en
   * un bloque que empuja las filas fuera de la primera pantalla, y quien viene a mirar productos
   * las salta — con lo que el aviso no protege a nadie y ademas estorba.
   *
   * Plegadas bajo un disclosure siguen ahi, se abren cuando hacen falta y no cuestan un renglon
   * cuando no. La unica que NO se pliega es la del dinero, que se muda a donde de verdad muerde:
   * dentro del detalle, junto a las cifras.
   */
  comoSeCuenta: "Cómo se cuenta",
  /** R36 — el aviso que impide leer la columna «Ordenes» como si fuera sumable. */
  aviso:
    "Una orden con varios productos cuenta en cada uno: la suma de la columna Órdenes puede superar el total del rango.",
  /**
   * FICHA 346 — la regla de lectura del desglose, dicha en la pantalla.
   *
   * FICHA 442 — y sigue siendo cierta con la forma nueva: la frase de «En qué terminaron»
   * enumera los MISMOS cuatro cubos que antes eran cuatro columnas, asi que sigue sumando la
   * columna «Órdenes». Lo que cambio es que ahora se leen en una linea en vez de en cuatro
   * celdas separadas por 400 px de tabla.
   */
  avisoDesglose:
    // FICHA 455 (2026-09-24): los grupos por el MISMO nombre que la frase de «En qué terminaron»
    // (antes «entregadas, rechazadas … en proceso», nombres retirados).
    `Cada orden cuenta en un solo grupo: ${NOMBRE_ESTADO.entregado}, ` +
    `${NOMBRE_ESTADO.devolucion_a_origen_por_rechazo}, los demás resultados y ` +
    `${ETIQUETA_EN_PROCESO} suman la columna Órdenes.`,
  /**
   * FICHA 347 (R45) — EL AVISO DEL DINERO, y es el mas importante de los tres.
   *
   * Dice las dos cosas que hacen ilegibles las cifras de dinero si no se saben: que el importe
   * es el de la ORDEN entera (no el del producto, que NO EXISTE en ninguna parte del sistema —
   * `orden.producto` solo trae `cantidad * nombre`) y que por eso no se pueden sumar hacia
   * abajo.
   *
   * ⚠ FICHA 442 — VIVE DENTRO DEL DETALLE, pegado a las cifras. Arriba, en el bloque de seis
   * lineas grises, lo leia quien no iba a sumar nada; aqui lo lee quien tiene los tres importes
   * delante. Sigue tambien en «Cómo se cuenta» y en el archivo descargable (R45 pide tres).
   */
  avisoDinero:
    "El dinero es de la ORDEN completa, no del producto: una orden con varios productos cuenta entera en cada uno, así que estas cifras no se pueden sumar hacia abajo.",
  /**
   * FICHA 347 (R29) — de que habla el reparto. Va junto al aviso de arriba porque las dos
   * cifras del reparto solo tienen sentido leidas con esta frase delante: lo que Ordenex cobro
   * y lo que es de la tienda se saben SOLO de las ordenes ya liquidadas; de las demas no se
   * proyecta nada (R31) y por eso su celda dice «—» y no «0,00» (R30).
   */
  avisoLiquidado:
    "«Cobró Ordenex» y «Para la tienda» son solo de las órdenes ya liquidadas (cierre aprobado). Lo cobrado y aún sin liquidar se muestra aparte, en la celda de Recaudado.",
  vacioTitulo: "Sin productos en el rango",
  vacioDescripcion:
    "Ninguna orden del filtro seleccionado dejó un producto que se pueda interpretar.",
  /** FICHA 347 (R76) — el tope de la lectura de dinero, superado. El volumen sigue en pie. */
  dineroLimiteExcedido: (limite: number) =>
    `El filtro seleccionado supera las ${limite} órdenes que la lectura de dinero puede recorrer, así que no se muestra ninguna cifra: una suma sobre un conjunto truncado parecería firme y estaría incompleta. Acote el rango o las facetas.`,
  /**
   * FICHA 347 (R32) — el nombre accesible del control que abre UNA fila.
   *
   * FICHA 442 — y ya no habla solo de dinero: la fila se abre SIEMPRE porque ahi vive tambien el
   * volumen que salio de las columnas (unidades, otros resultados, % de rechazo). Identifica SU
   * fila —producto y tienda— y no un «Ver detalle» repetido veinticinco veces.
   */
  abrirDetalle: (producto: string, tienda: string) =>
    `Ver el detalle de ${producto} en ${tienda}`,
} as const;

/** Los encabezados de columna, aparte para que la vista de teléfono use LOS MISMOS. */
export const PRODUCTOS_COLUMNAS = {
  tienda: "Tienda",
  producto: "Producto",
  ordenes: "Órdenes",
  /**
   * FICHA 442 — LA COLUMNA QUE SUSTITUYE A CUATRO.
   *
   * Antes eran `Entregadas`, `Rechazadas`, `Otros resultados` y `En proceso`: cuatro columnas de
   * numeros, 200 px cada una, para responder una sola pregunta. Ahora es una barra con los tres
   * tramos del heroe de la 441 y, debajo, la frase que los enumera con sus cifras.
   *
   * SE LLAMA «En qué terminaron» y no «Desglose» ni «Estado»: dice la pregunta que contesta, que
   * es lo que el rotulo tiene que hacer cuando la celda no es un numero.
   */
  desenlaces: "En qué terminaron",
  efectividad: "Efectividad de entrega",
  /**
   * FICHA 347 — de las TRES cifras de dinero, esta es la unica que queda como COLUMNA.
   *
   * FICHA 442 — las otras dos bajan al detalle, y el numero que lo decide esta medido: en las 25
   * filas de la captura del humano las tres columnas de dinero estaban en «—», ocupaban el sitio
   * de honor (justo detras del producto) y empujaban «Efectividad» a la 13.ª posicion, fuera de
   * pantalla. `Recaudado` se queda porque es la cifra que se pidio; el reparto se lee cuando se
   * abre la fila, que es cuando interesa.
   */
  recaudado: "Recaudado",
  ordenex: "Cobró Ordenex",
  paraTienda: "Para la tienda",
  /**
   * FICHA 449 — EL SERVICIO DE BODEGA, con el nombre que YA tiene en el resto de la app.
   *
   * Es `FULFILLMENT_COL` (`cierres-admin/_components/cierre-labels.ts`), el rótulo con el que
   * esta misma cifra se lee en el detalle del cierre y en las cinco descargas de gestiones. La
   * ficha existe porque la MISMA orden enseñaba la cifra allí y la escondía aquí; bautizarla de
   * nuevo en esta pantalla dejaría el defecto en pie con otra cara — dos nombres para una cifra
   * se leen como dos cifras. Lo fija un caso que compara este texto contra esa constante.
   *
   * ⚠ NO ES COLUMNA y no puede serlo: vive en el detalle de la fila, con las otras dos cifras
   * que la 442 bajó de la cabecera. Ver `DINERO`.
   */
  fulfillment: "Fulfillment",
  /** Las cifras que bajan al detalle de la fila. */
  unidades: "Unidades",
  otrosResultados: "Otros resultados",
  rechazo: "% de rechazo",
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
 * FICHA 442 — LA TIENDA, DICHA UNA VEZ.
 *
 * Cuando la respuesta trae una sola tienda, su nombre no es un dato de la fila: es una propiedad
 * del recorte entero. Repetirlo veinticinco veces en una columna cuesta 128 px de tabla para
 * decir lo mismo veinticinco veces.
 */
export function textoTiendaUnica(tienda: string): string {
  return `Tienda: ${tienda}`;
}

/**
 * FICHA 347 (R13) — cuantas de las ordenes de esta fila iban ACOMPAÑADAS de otro producto.
 *
 * Es la cifra que permite calibrar el aviso de no-sumable EN ESTA FILA: con 0 acompañadas el
 * recaudado de la fila no se solapa con ninguna otra; con 8 de 8, ese importe entero esta
 * tambien en otra fila de la tabla.
 *
 * ⚠ FICHA 442 — SE LEE EN EL DETALLE, no bajo la cifra de la columna. En la captura del humano
 * esta linea aparecia en las 25 filas diciendo «Con otro producto: 0 de 6» —o sea, no aportaba
 * nada en ninguna— y doblaba el alto de CADA fila. Junto al aviso del dinero, que es lo que
 * calibra, dice lo mismo y cuesta cero renglones mientras la fila esta cerrada.
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
 * R37/R46 — ¿se pinta la columna «Tienda», o se dice una vez en un chip?
 *
 * SE DECIDE POR EL CONTENIDO DE LA RESPUESTA Y NUNCA POR EL ROL, y esa es la mitad del punto:
 * para un `adminTienda` siempre hay una sola tienda, asi que la columna desaparece sola sin que
 * el cliente razone sobre permisos; y un maestro que filtre una sola tienda tampoco la necesita.
 * Con un `if (rol === …)` aqui habria una segunda regla de alcance en el navegador, que es donde
 * menos vale.
 *
 * ⚠ POR QUE PARA UN `adminTienda` ES SIEMPRE FALSO, comprobado y no supuesto: su alcance se
 * resuelve en `lib/analytics/alcance.ts` como `{ tipo: "tienda", tiendaId: actor.usuarioId }` y
 * `whereOrden` lo traduce a `{ tiendaId }` (`lib/analytics/alcance-columnas.ts`). El servidor no
 * puede devolverle filas de dos tiendas, asi que el `Set` de `tiendaId` tiene siempre tamaño 1.
 * No hace falta ninguna regla de rol en el cliente para conseguirlo: ya es imposible.
 *
 * ⚠ Y UN MAESTRO MIRANDO TODAS LAS TIENDAS SI LA NECESITA. La columna no «sobra» siempre: sobra
 * cuando es CONSTANTE. Por eso la decision no es «quitarla», es «decirla una vez cuando no
 * distingue nada y pintarla cuando distingue».
 *
 * Se cuenta por `tiendaId` y no por nombre: dos tiendas homonimas son dos tiendas.
 */
export function hayVariasTiendas(filas: readonly FilaProductoDTO[]): boolean {
  return new Set(filas.map((fila) => fila.tiendaId)).size > 1;
}

/**
 * FICHA 442 — el nombre de la tienda cuando es UNA sola, o `null`.
 *
 * `null` con cero filas (no hay tienda que decir) y `null` con varias (entonces la columna la
 * dice fila a fila). Es la otra mitad de `hayVariasTiendas` y se declara junto a ella para que
 * las dos decisiones se lean de una vez: no puede haber chip Y columna, ni ninguna de las dos.
 */
export function tiendaUnicaDe(filas: readonly FilaProductoDTO[]): string | null {
  if (filas.length === 0 || hayVariasTiendas(filas)) return null;
  return filas[0].tienda;
}

/** Clave de fila: la tienda Y el producto. Un producto solo no es unico entre tiendas (R37). */
function claveDeFila(fila: FilaProductoDTO): string {
  return `${fila.tiendaId}::${fila.producto}`;
}

/* -------------------------------------------------------------------------- */
/* Las cifras                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Las CIFRAS de conteo de una fila. Se declaran una vez y cada una dice DONDE se lee: las dos
 * que contestan «cuanto se movio y cuanto llego» son columna, y las tres de apoyo viven en la
 * fila que se abre.
 *
 * `efectividadGestion` existe en `EfectividadEntrega` y NO se pinta, a proposito: en la lectura
 * por producto lo que interesa es el rechazo COMERCIAL, y dos porcentajes que suman distinto en
 * la misma fila invitan a leer uno por el otro.
 */
type IdCifra = "unidades" | "ordenes" | "otrosResultados" | "efectividad" | "rechazo";

interface DeclaracionCifra {
  readonly id: IdCifra;
  readonly etiqueta: string;
  /** `true` = columna de la tabla; `false` = dato de la fila desplegable. */
  readonly enColumna: boolean;
}

/**
 * LAS CINCO CIFRAS Y SU SITIO, declarados UNA vez.
 *
 * ⚠ ESTA LISTA ES LA DECISION DE LA 442 y se lee entera de un vistazo a proposito: quien quiera
 * devolver «% de rechazo» a la cabecera cambia un `false` por un `true` aqui y en ningun otro
 * sitio — no hay una segunda lista de columnas que pueda discrepar de esta.
 *
 * `unidades` baja al detalle y no es un descuido: el orden de las filas lo fija el servicio POR
 * unidades (contrato R33), asi que la columna ya esta ordenada por una cifra que no se ve. Lo
 * que se pregunta mirando la tabla es cuantas ORDENES movio un producto y como acabaron; las
 * unidades son el desempate, y se leen al abrir.
 */
const CIFRAS: readonly DeclaracionCifra[] = [
  { id: "ordenes", etiqueta: PRODUCTOS_COLUMNAS.ordenes, enColumna: true },
  { id: "efectividad", etiqueta: PRODUCTOS_COLUMNAS.efectividad, enColumna: true },
  { id: "unidades", etiqueta: PRODUCTOS_COLUMNAS.unidades, enColumna: false },
  { id: "otrosResultados", etiqueta: PRODUCTOS_COLUMNAS.otrosResultados, enColumna: false },
  { id: "rechazo", etiqueta: PRODUCTOS_COLUMNAS.rechazo, enColumna: false },
];

/** Las dos que son columna, en su orden. Derivadas, nunca reescritas. */
const CIFRAS_EN_COLUMNA = CIFRAS.filter((cifra) => cifra.enColumna);

/** Las tres que viven en la fila desplegable, en su orden. */
const CIFRAS_EN_DETALLE = CIFRAS.filter((cifra) => !cifra.enColumna);

function cifrasDeFila(fila: FilaProductoDTO): Readonly<Record<IdCifra, string>> {
  const e = calcularEfectividad(fila.porStatus);
  return {
    unidades: formatearValor(fila.unidades, UNIDAD_CONTEO),
    ordenes: formatearValor(fila.ordenes, UNIDAD_CONTEO),
    otrosResultados: formatearValor(e.otrosDesenlaces, UNIDAD_CONTEO),
    efectividad: formatearValor(e.efectividad, UNIDAD_PORCENTAJE),
    rechazo: formatearValor(e.tasaRechazo, UNIDAD_PORCENTAJE),
  };
}

/**
 * FICHA 347 — LAS CIFRAS DE DINERO de una fila, declaradas igual que sus hermanas de
 * conteo y con el mismo campo `enColumna`: las consumen las DOS vistas y las dos las reparten
 * igual, asi que el telefono no puede quedarse con menos dinero que el escritorio (R64).
 *
 * FICHA 449 — son CUATRO: entra el servicio de bodega, en el detalle y solo cuando hay monto.
 */
type IdDinero = "recaudado" | "ordenex" | "paraTienda" | "fulfillment";

interface DeclaracionDinero {
  readonly id: IdDinero;
  readonly etiqueta: string;
  readonly enColumna: boolean;
  /**
   * FICHA 449 — `true` cuando la cifra SOLO se pinta si su monto es mayor que cero.
   *
   * ⚠ ES LA EXCEPCION Y NO LA REGLA, por eso es opcional y no una bandera que cada cifra tenga
   * que contestar. Las tres primeras se pintan SIEMPRE, con «—» cuando no las hay: su ausencia
   * contesta la pregunta que el usuario vino a hacer. El fulfillment no lo tienen contratado la
   * mayoria de las tiendas, asi que para ellas la cifra es un `"0.00"` cierto que se leeria como
   * un concepto que les aplica y les salio en cero. Ver `hayMonto`.
   */
  readonly soloSiHayMonto?: boolean;
}

const DINERO: readonly DeclaracionDinero[] = [
  { id: "recaudado", etiqueta: PRODUCTOS_COLUMNAS.recaudado, enColumna: true },
  { id: "ordenex", etiqueta: PRODUCTOS_COLUMNAS.ordenex, enColumna: false },
  { id: "paraTienda", etiqueta: PRODUCTOS_COLUMNAS.paraTienda, enColumna: false },
  // FICHA 449 — DETRAS del reparto y nunca dentro de el. `ordenex + paraTienda` es exactamente
  // lo recaudado liquidado (R20) y esa igualdad es cierta POR CONSTRUCCION; una cuarta cifra
  // entre las dos se leeria como un tercer trozo del mismo reparto, que es justo lo que NO es.
  {
    id: "fulfillment",
    etiqueta: PRODUCTOS_COLUMNAS.fulfillment,
    enColumna: false,
    soloSiHayMonto: true,
  },
];

/** La unica cifra de dinero que es COLUMNA. Derivada de la lista de arriba. */
const DINERO_EN_COLUMNA = DINERO.filter((cifra) => cifra.enColumna);

/** El reparto, que se lee al abrir la fila. */
const DINERO_EN_DETALLE = DINERO.filter((cifra) => !cifra.enColumna);

/**
 * FICHA 348 (R45, en su forma nueva) — QUE COLUMNAS no se pueden sumar, dichas por su nombre.
 *
 * Es lo unico que la marca `(no sumable)` del encabezado aportaba y el aviso largo no decia:
 * CUALES son. Se DERIVA de la lista de arriba —la misma que construye las columnas— y no de
 * literales escritos aparte, asi que no puede quedarse atras: el dia que una segunda cifra de
 * dinero vuelva a ser columna, aparece aqui sola y en su orden.
 *
 * ⚠ FICHA 442 — HOY DICE «La columna … que no se puede», EN SINGULAR, y es correcto: de las tres
 * cifras de dinero solo `Recaudado` es columna. Las otras dos viven dentro del detalle de UNA
 * fila, donde no hay nada debajo que sumar; alli la advertencia que corresponde es la de
 * `avisoDinero` —«el importe es de la orden completa»—, y es la que se pinta a su lado.
 *
 * La conjuncion es «y» sin coma antes (norma del español, no del inglés) y con la coma de
 * separacion en el resto: con dos columnas sale «A y B» y con una, «A», sin sobras.
 */
export function textoColumnasNoSumables(etiquetas: readonly string[]): string {
  const lista =
    etiquetas.length <= 1
      ? (etiquetas[0] ?? "")
      : `${etiquetas.slice(0, -1).join(", ")} y ${etiquetas[etiquetas.length - 1]}`;
  // El sujeto Y el verbo concuerdan: con una sola columna, «La columna … que no se puede».
  const sujeto = etiquetas.length === 1 ? "La columna" : "Las columnas";
  const verbo = etiquetas.length === 1 ? "no se puede" : "no se pueden";
  return `${sujeto} de dinero que ${verbo} sumar hacia abajo: ${lista}.`;
}

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
  // FICHA 449 — SALE DE LA RAIZ DEL DTO, no de `liquidado`, y el sitio del que se lee es la
  // afirmacion: `liquidado` es el reparto de lo recaudado y el fulfillment no forma parte de el.
  if (id === "fulfillment") return dinero.fulfillment;
  return dinero.liquidado.tienda;
}

/**
 * FICHA 449 — ¿SE DECLARA esta cifra en el detalle de ESTA fila?
 *
 * Todas menos una: siempre. La excepcion tiene su motivo escrito en `DeclaracionDinero
 * .soloSiHayMonto`, y el predicado que decide es `hayMonto`, compartido con el panel de la 347
 * para que las dos mitades del detalle no puedan discrepar sobre cuando la cifra existe.
 */
function seDeclara(cifra: DeclaracionDinero, fila: FilaProductoDTO): boolean {
  if (cifra.soloSiHayMonto !== true) return true;
  return hayMonto(importeDeFila(fila, cifra.id));
}

/* -------------------------------------------------------------------------- */
/* Piezas de presentación                                                      */
/* -------------------------------------------------------------------------- */

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
 * Una LINEA DE CONTEXTO bajo una cifra: mas pequeña y apagada.
 *
 * ⚠ FICHA 442 — YA NO TIENE LA VARIANTE `unaLinea` de la 354, y no es un descuido: aquella
 * subia el `min-content` de la columna «Recaudado» a 272 px para que sus dos frases de apoyo
 * cupieran en un renglon. Esas dos frases se mudaron al detalle, donde el ancho disponible es el
 * de la fila entera y no el de una columna, asi que no hay ninguna que forzar. Mantener la
 * variante sin consumidor seria dejar viva la regla que engordaba la columna.
 *
 * ⚠ SIGUE SIN `wrap-anywhere` (ficha 348): aquel bajaba el `min-content` a un caracter y
 * autorizaba a partir palabras por dentro.
 */
function Contexto({ children }: { readonly children: ReactNode }) {
  return <span className="text-xs text-muted-foreground">{children}</span>;
}

/**
 * Un nombre de TEXTO de la tabla: el del producto y el de la tienda.
 *
 * ⚠ FICHA 348 — AQUI ESTABA `wrap-anywhere` Y ERA LA CAUSA DEL DEFECTO REPORTADO. Reducir el
 * `min-content` a UN CARACTER autoriza al navegador a dejar la columna mas estrecha que su
 * palabra mas larga, y entonces la parte por dentro. Medido en Chromium a 1440 px con la columna
 * «Tienda» montada: la columna quedaba en 66 px cuando su dato mas ancho pedia 114, y el
 * navegador partia `Nuform` en dos lineas (`Nufor` + `m`), `Distribuidora` en tres y `Ecuador`
 * en dos.
 *
 * SIN NINGUNA CLASE DE PARTIDO —ni `wrap-anywhere` ni `break-words`— el `min-content` de la
 * columna vuelve a ser su palabra mas larga, que es la garantia que pidio el humano: **ninguna
 * palabra se parte a ningun ancho**.
 */
function NombreProducto({ children }: { readonly children: string }) {
  return <span>{children}</span>;
}

/**
 * FICHA 442 — LA BARRA DE «En qué terminaron», y sus tres tramos son los del heroe de la 441.
 *
 * ⚠ ES DECORATIVA (`aria-hidden`), y por la misma razon que la del heroe: no aporta ni un dato
 * que la frase de debajo no diga con numeros. Un `role="img"` con su descripcion obligaria a
 * mantener DOS redacciones del mismo hecho, y la que se quedaria atras seria siempre la que no
 * se ve. La frase es texto en el DOM y la lee cualquier tecnologia de apoyo.
 *
 * ⚠ LOS COLORES SON LOS DEL HEROE, literalmente los mismos tokens: `bg-brand` para lo entregado,
 * `bg-foreground/80` para lo que acabo de otra forma y `bg-muted-foreground/30` para lo que
 * sigue en proceso. Dos vocabularios de color en la misma pantalla —naranja significando una
 * cosa arriba y otra abajo— es exactamente lo que la ficha 292 arreglo en el monitoreo.
 *
 * ⚠ NI UN HEXADECIMAL: los tres tokens giran con el modo oscuro. Un `#0d2444` fijo, que es lo
 * que propone el mockup, desapareceria sobre fondo oscuro.
 *
 * Un tramo en CERO no pinta segmento (misma regla que la 258): un `<span>` de ancho 0 % es un
 * nodo invisible que ensucia el DOM sin decir nada.
 */
const TRAMOS_BARRA: readonly { readonly id: IdTramoDesenlace; readonly color: string }[] = [
  { id: "entregadas", color: "bg-brand" },
  { id: "otroDesenlace", color: "bg-foreground/80" },
  { id: "enProceso", color: "bg-muted-foreground/30" },
];

function BarraDesenlaces({ fila }: { readonly fila: FilaProductoDTO }) {
  const tramos = tramosDeFila(fila.porStatus);
  if (tramos.total === 0) return null;
  return (
    <span
      aria-hidden="true"
      className="flex h-2 w-full overflow-hidden rounded-full bg-muted"
    >
      {TRAMOS_BARRA.filter((tramo) => tramos[tramo.id] > 0).map((tramo) => (
        <span
          key={tramo.id}
          className={tramo.color}
          // El ancho es un DATO, no una clase: Tailwind compila estaticamente y no puede
          // generar `w-[66.7%]` en tiempo de ejecucion.
          style={{ width: `${(tramos[tramo.id] / tramos.total) * 100}%` }}
        />
      ))}
    </span>
  );
}

/**
 * La celda de «En qué terminaron»: la barra y, debajo, la frase que la dice con numeros.
 *
 * SEGUNDA LINEA Y NO UN TOOLTIP (decision de la 347, que sigue en pie): un tooltip no existe en
 * tactil, no se copia con el raton y los lectores de pantalla lo tratan de forma desigual. La
 * composicion es DATO en el DOM, legible siempre y sin apuntar a nada.
 */
function CeldaDesenlaces({ fila }: { readonly fila: FilaProductoDTO }) {
  const texto = textoDesenlacesDeFila(fila.porStatus);
  return (
    <span className="flex flex-col gap-1">
      <BarraDesenlaces fila={fila} />
      {texto === "" ? null : <Contexto>{texto}</Contexto>}
    </span>
  );
}

/**
 * Una linea de la vista de TELEFONO: la etiqueta a la izquierda y la cifra a la derecha.
 *
 * ⚠ LA ETIQUETA PUEDE PARTIRSE Y LA CIFRA NO. Medido a 390 px por la ficha 348: con la linea
 * entera en `whitespace-nowrap`, «Efectividad de entrega: 33,3%» fijaba un minimo de 204 px para
 * esta columna y dejaba el nombre del producto en 104, partiendo palabras por la mitad. Dejando
 * respirar a la etiqueta, el minimo cae y el nombre recupera sitio. La CIFRA sigue sin partirse:
 * `whitespace-nowrap` vive dentro de `Cifra`, que es donde importa.
 */
function LineaApilada({ rotulo, valor }: { readonly rotulo: string; readonly valor: string }) {
  return (
    <span className="flex items-baseline justify-between gap-2">
      <span className="text-left text-xs text-muted-foreground">{rotulo}</span>
      <Cifra>{valor}</Cifra>
    </span>
  );
}

/** Un dato del detalle: su rotulo arriba, su cifra debajo y, si lo tiene, su linea de apoyo. */
function DatoDeDetalle({
  rotulo,
  valor,
  apoyo,
}: {
  readonly rotulo: string;
  readonly valor: string;
  readonly apoyo?: ReactNode;
}) {
  return (
    <div className="flex min-w-24 flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{rotulo}</span>
      <span className="text-sm font-medium tabular-nums whitespace-nowrap">{valor}</span>
      {apoyo === undefined || apoyo === null ? null : apoyo}
    </div>
  );
}

/**
 * FICHA 442 — LA FILA QUE SE ABRE: todo lo que salio de las columnas, y nada mas escondido.
 *
 * ⚠ SE PINTA SIEMPRE, con dinero y sin el. Hasta la 442 esta fila solo existia para el detalle
 * de dinero de la 347 y por eso las filas sin concesion no tenian control de abrir; ahora lleva
 * tambien el volumen que bajo de la cabecera (unidades, otros resultados, % de rechazo), asi que
 * una fila sin dinero SIGUE teniendo algo que enseñar. Lo que no tiene es el panel de ordenes.
 *
 * ⚠ EL AVISO DEL DINERO VA AQUI DENTRO, pegado a las cifras, y es el pedido explicito del
 * humano: «la advertencia que sí importa vive dentro del detalle, junto al dinero, que es donde
 * alguien podría sumarlo por error». Arriba lo leia quien no iba a sumar nada.
 *
 * ⚠ `DineroProductoDetalle` SOLO CUANDO HAY DINERO QUE DETALLAR. `DataTable` construye este
 * elemento por fila pero solo lo mete en el DOM cuando la fila esta abierta, y un elemento de
 * React que no se monta no ejecuta ningun efecto: por eso la tabla cerrada sigue costando CERO
 * lecturas de detalle (R33) y abrir una fila SIN dinero no consulta nada.
 */
function DetalleDeFila({
  fila,
  conDinero,
  filtroSerializado,
}: {
  readonly fila: FilaProductoDTO;
  readonly conDinero: boolean;
  readonly filtroSerializado: string;
}) {
  const cifras = cifrasDeFila(fila);
  const composicion = textoComposicionOtrosResultados(fila.porStatus);
  const dinero = fila.dinero;
  /**
   * ⚠ LA CONCESION Y EL DATO SON DOS COSAS DISTINTAS, y por eso hay dos banderas.
   *
   * `conDinero` decide si SE PINTAN las cifras de dinero; `dinero === null` significa que esta
   * fila no tiene ninguna orden que aporte, y eso se pinta «—» (R30) — nunca se calla y nunca se
   * rellena con `0,00`. Lo que si depende del dato es el panel orden por orden: sin ordenes que
   * listar, un panel vacio es peor que no tenerlo.
   */
  const pendiente = dinero !== null && dinero.pendiente.ordenes > 0;

  return (
    <div className="flex flex-col gap-4">
      {/**
       * `data-slot` para que una suite pueda leer ESTE bloque y no el del panel de la 347, que
       * repite los mismos rótulos a propósito: sus totales existen «para cotejar» (R38). Sin el
       * marcador, un `getByText("Cobró Ordenex")` encuentra dos y no se sabe cuál mide.
       */}
      <div data-slot="detalle-producto" className="flex flex-wrap gap-x-8 gap-y-3">
        {CIFRAS_EN_DETALLE.map((cifra) => (
          <DatoDeDetalle
            key={cifra.id}
            rotulo={cifra.etiqueta}
            valor={cifras[cifra.id]}
            apoyo={
              cifra.id === "otrosResultados" && composicion !== "" ? (
                <Contexto>{composicion}</Contexto>
              ) : null
            }
          />
        ))}
        {/* R6 — sin la concesion no se declara ni una cifra de dinero. No se pinta vacia, no se
            pinta en cero y no se pinta deshabilitada: no existe. */}
        {/* FICHA 449 — el `.filter` NO es una optimizacion: es la unica cifra de este bloque
            que se calla cuando vale cero, y el motivo esta en `seDeclara`. Las demas siguen
            pintandose siempre, con «—» cuando no las hay (R30). */}
        {conDinero
          ? DINERO_EN_DETALLE.filter((cifra) => seDeclara(cifra, fila)).map((cifra) => (
              <DatoDeDetalle
                key={cifra.id}
                rotulo={cifra.etiqueta}
                valor={money(importeDeFila(fila, cifra.id))}
              />
            ))
          : null}
      </div>

      {/* Las dos lineas de apoyo que la 354 tuvo que meter en la columna «Recaudado» —y que
          costaban 272 px de columna y hasta ocho renglones por fila— se leen aqui enteras, sin
          abreviar y sin forzar ningun renglon: el ancho disponible es el de la fila entera. */}
      {conDinero ? (
        <div className="flex flex-col gap-1">
          <Contexto>{textoAcompanadas(fila.ordenesAcompanadas, fila.ordenes)}</Contexto>
          {pendiente && dinero !== null ? (
            <Contexto>
              {textoPendiente(dinero.pendiente.recaudado, dinero.pendiente.ordenes)}
            </Contexto>
          ) : null}
          {/* R45 — LA ADVERTENCIA, donde muerde. */}
          <p className="text-xs text-muted-foreground">{PRODUCTOS_TEXTOS.avisoDinero}</p>
        </div>
      ) : null}

      {conDinero && dinero !== null ? (
        <DineroProductoDetalle
          filtroSerializado={filtroSerializado}
          tiendaId={fila.tiendaId}
          tiendaNombre={fila.tienda}
          producto={fila.producto}
        />
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Las columnas                                                                */
/* -------------------------------------------------------------------------- */

/**
 * FICHA 442 — EL ANCHO MINIMO DE CADA COLUMNA, recalculado sobre las que quedan.
 *
 * `DataTable` dice en su prop `minWidth` que «el `min-width` del `<th>` gobierna toda la
 * columna» y que «si la suma de mínimos excede el ancho disponible, la tabla desborda y aparece
 * el scroll horizontal». O sea: los minimos deciden si hay desplazamiento horizontal o no.
 *
 * LOS NUMEROS DE LA 348 SE CONSERVAN donde la columna sobrevive —se midieron en Chromium sobre
 * la palabra mas ancha de cada una, encabezado y celdas, mas el relleno del `<th>` (24 px)— y
 * solo cambian los dos que esta ficha toca:
 *
 * | columna              | palabra mas ancha            | px  | +relleno | declarado |
 * | -------------------- | ---------------------------- | --- | -------- | --------- |
 * | Tienda               | `Distribuidora` (dato)       |  90 |   114    | 8rem      |
 * | Producto             | `PRESENTACION` (dato)        | 102 |   126    | 14rem     |
 * | Órdenes              | `Órdenes` (rotulo)           |  53 |    77    | 5rem      |
 * | En qué terminaron    | `terminaron` (rotulo)        |  78 |   102    | **13rem** |
 * | Efectividad          | `Efectividad` (rotulo)       |  70 |    94    | 6rem      |
 * | Recaudado            | `Recaudado` (rotulo)         |  71 |    95    | **6.5rem**|
 *
 * ⚠ «En qué terminaron» DECLARA MUY POR ENCIMA DE SU PALABRA (13rem = 208 px frente a 102), y es
 * la unica columna de la tabla que lo hace. No es un ensanche por gusto: su celda lleva una
 * BARRA, que es una pieza cuyo ancho no lo fija ningun contenido —una barra de 102 px no se lee—
 * y una FRASE («4 entregadas · 1 rechazadas · 2 devueltas · 1 en proceso») que sin sitio se
 * pliega en cuatro renglones. Es el mismo razonamiento de la 354 sobre «Recaudado», aplicado a
 * la unica celda que hoy lleva una frase.
 *
 * ⚠ «Recaudado» VUELVE DE 17rem A 6,5rem, y el numero de la 354 NO se deroga: aquel salia de la
 * frase mas larga de la celda («Pendiente de cierre: ₡23.798 (2 órdenes)», 244 px + relleno) y
 * esa frase ya no esta en la celda — se lee en el detalle. Sin frases, el suelo vuelve a ser el
 * del rotulo, que es lo que la 348 midio. Si algun dia una linea de apoyo volviera a esta
 * columna, hay que remedir: es exactamente lo que la 354 dejo escrito.
 *
 * SUMA A 1440 px, con las cinco columnas y sin «Tienda»: 14 + 5 + 13 + 6 + 6,5 = **44,5rem =
 * 712 px** mas la columna del control (~44 px) = 756, en un contenedor de 1102. Con «Tienda»
 * montada, 884. Antes eran 1416 en 1102. El desborde pasa de 314 px a CERO.
 */
const MIN_TIENDA = "8rem";
const MIN_PRODUCTO = "14rem";
const MIN_DESENLACES = "13rem";
const MIN_CIFRA: Readonly<Record<IdCifra, string>> = {
  unidades: "5.5rem",
  ordenes: "5rem",
  otrosResultados: "7.5rem",
  efectividad: "6rem",
  rechazo: "5rem",
};
const MIN_DINERO: Readonly<Record<IdDinero, string>> = {
  recaudado: "6.5rem",
  ordenex: "6rem",
  paraTienda: "6rem",
  // FICHA 449 — declarado aunque hoy NO sea columna, igual que `ordenex` y `paraTienda`: el
  // `Record` exige una entrada por cifra. Se le da el MISMO 6rem que a esos dos, y no un numero
  // propio, porque ese numero no esta medido contra la tipografia de la app y aqui no se
  // inventa: hoy nadie lo lee. Lo que SI esta medido (Chromium, tipografia del sistema, mismo
  // `text-xs font-bold` del `<th>` para los cuatro rotulos) es la comparacion RELATIVA, que es
  // la que sobrevive a un cambio de fuente: `Fulfillment` mide 57 px, lo mismo que `Recaudado`
  // y MENOS que `Cobró Ordenex` (80) y `Para la tienda` (72). O sea: el minimo que ya sostiene
  // a esos dos sostiene tambien a este. Si algun dia vuelve a ser columna, hay que remedirlo
  // contra la fuente real, que es lo que la 348 dejo escrito.
  fulfillment: "6rem",
};

/**
 * Las columnas de ESCRITORIO: cinco, o seis cuando hay varias tiendas.
 *
 * ⚠ EL ORDEN ES EL DEL DISEÑO APROBADO y contesta la pregunta de la pantalla en el orden en que
 * se hace: QUE producto, CUANTAS ordenes, COMO acabaron, CUANTO se entrego, CUANTO se recaudo.
 * El dinero vuelve al FINAL —la 347 lo habia puesto el segundo porque con trece columnas algo
 * quedaba fuera pase lo que pase y prefirio que lo que se arrastrara fuera «% de rechazo»—: con
 * cinco columnas no se queda fuera nada, asi que esa disyuntiva ya no existe y el dinero deja de
 * ocupar el sitio de honor que el humano vio lleno de rayas.
 */
function columnasEscritorio(conTienda: boolean, conDinero: boolean): Column<FilaProductoDTO>[] {
  const tienda: Column<FilaProductoDTO>[] = conTienda
    ? [
        {
          id: "tienda",
          value: PRODUCTOS_COLUMNAS.tienda,
          minWidth: MIN_TIENDA,
          render: (fila) => <NombreProducto>{fila.tienda}</NombreProducto>,
        },
      ]
    : [];

  const dinero: Column<FilaProductoDTO>[] = conDinero
    ? DINERO_EN_COLUMNA.map<Column<FilaProductoDTO>>((cifra) => ({
        id: cifra.id,
        value: cifra.etiqueta,
        align: "right",
        minWidth: MIN_DINERO[cifra.id],
        render: (fila) => <Cifra>{money(importeDeFila(fila, cifra.id))}</Cifra>,
      }))
    : [];

  // Las dos cifras que son columna, en el orden en que `CIFRAS` las declara: «Órdenes» primero
  // y «Efectividad» después, con «En qué terminaron» entre las dos — que es el orden en que se
  // hacen las preguntas (cuántas entraron, cómo acabaron, cuántas llegaron).
  const [ordenes, efectividad] = CIFRAS_EN_COLUMNA;

  return [
    ...tienda,
    {
      id: "producto",
      value: PRODUCTOS_COLUMNAS.producto,
      minWidth: MIN_PRODUCTO,
      render: (fila) => <NombreProducto>{fila.producto}</NombreProducto>,
    },
    {
      id: ordenes.id,
      value: ordenes.etiqueta,
      align: "right",
      minWidth: MIN_CIFRA[ordenes.id],
      render: (fila) => <Cifra>{cifrasDeFila(fila)[ordenes.id]}</Cifra>,
    },
    {
      id: "desenlaces",
      value: PRODUCTOS_COLUMNAS.desenlaces,
      minWidth: MIN_DESENLACES,
      render: (fila) => <CeldaDesenlaces fila={fila} />,
    },
    {
      id: efectividad.id,
      value: efectividad.etiqueta,
      align: "right",
      minWidth: MIN_CIFRA[efectividad.id],
      render: (fila) => <Cifra>{cifrasDeFila(fila)[efectividad.id]}</Cifra>,
    },
    ...dinero,
  ];
}

/**
 * Las columnas de TELEFONO: dos, y ni un dato menos que en el portatil.
 *
 * EL DEFECTO QUE ESTO EVITA, medido por las fichas 343 y 344 en Chromium a 390x844: una tabla de
 * cuatro columnas pedia 309 px en un hueco de 284 y el ultimo numero acababa fuera del area
 * visible. Con nombres de producto de 62 caracteres, el problema seria peor por construccion.
 *
 * Se apilan: el producto (con su tienda debajo cuando hay varias) en una celda y, en la otra,
 * las MISMAS cifras que el escritorio pone en columna —ordenes, desenlaces, efectividad y
 * recaudado—, cada una con su etiqueta. El resto vive en la misma fila desplegable que en
 * escritorio, asi que las dos vistas enseñan exactamente lo mismo (R64).
 */
function columnasTelefono(conTienda: boolean, conDinero: boolean): Column<FilaProductoDTO>[] {
  return [
    {
      id: "producto",
      value: PRODUCTOS_COLUMNAS.producto,
      // FICHA 348 — sin `wrap-anywhere`: a 390 px partia SEIS palabras del nombre
      // (`HIDROLIZADO`, `PRESENTACION`, `TURKESTERONE`, `Hemorroides`, `USB-C`,
      // `Blanqueadora`), medidas con `Range.getClientRects()` y no a ojo.
      render: (fila) => (
        <div className="flex flex-col gap-0.5">
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
        const [ordenes, efectividad] = CIFRAS_EN_COLUMNA;
        return (
          <div className="flex flex-col gap-1">
            {/* EL MISMO ORDEN QUE EL ESCRITORIO: cuántas entraron, cómo acabaron, cuántas
                llegaron y cuánto se recaudó. Dos ordenes distintos para las mismas cifras
                obligan a releer la pantalla al cambiar de dispositivo. */}
            <LineaApilada rotulo={ordenes.etiqueta} valor={cifras[ordenes.id]} />
            <span className="flex flex-col gap-1 text-left">
              <span className="text-xs text-muted-foreground">
                {PRODUCTOS_COLUMNAS.desenlaces}
              </span>
              <CeldaDesenlaces fila={fila} />
            </span>
            <LineaApilada rotulo={efectividad.etiqueta} valor={cifras[efectividad.id]} />
            {conDinero
              ? DINERO_EN_COLUMNA.map((cifra) => (
                  <LineaApilada
                    key={cifra.id}
                    rotulo={cifra.etiqueta}
                    valor={money(importeDeFila(fila, cifra.id))}
                  />
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
   * pintar cincuenta filas.
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
  const tiendaUnica = tiendaUnicaDe(filas);

  /**
   * FICHA 347 (R6) — el dinero se pinta cuando SE CONCEDE EN LOS DOS SITIOS: la prop del
   * servidor dice que este actor lo tiene, y la RESPUESTA dice `concedido`.
   *
   * No es una redundancia por prudencia: son dos hechos distintos. La prop es «que se dibuja» y
   * el estado de la respuesta es «que se sirvio». Cuando el estado es `limite_excedido` (R76) la
   * concesion existe pero NO HAY CIFRAS, y pintar las columnas con «—» en todas las filas se
   * leeria como «este producto no movio dinero», que es una afirmacion falsa. En ese caso se
   * dice por escrito y las cifras de VOLUMEN siguen intactas.
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
   * ⚠ FICHA 442 — EL ARCHIVO NO PIERDE NI UNA COLUMNA. La pantalla enseña cinco y el `.xlsx`
   * sigue llevando las once base (o las veintiuna con dinero), porque la proyeccion es la MISMA
   * funcion de siempre (`filaDescargaAnaliticaProductos`) y este componente no la filtra.
   * Esconder una columna en pantalla no es quitarla del dato — y lo vigila
   * `tests/unit/descarga/analitica-productos-descarga-columnas.test.ts` con su asercion de
   * orden, que nombra las columnas una a una.
   *
   * Familia B, y por el ADAPTADOR COMUN (`filasLocales`) y no armando el resultado a mano: ahi
   * es donde vive el tope unico de la app (5.000 filas, `descargaConfig.MAX_FILAS`) y el
   * mensaje accionable cuando se supera.
   */
  const obtenerFilas = () =>
    filasLocales(filas, (f) => filaDescargaAnaliticaProductos(f, conDinero));

  /**
   * FICHA 388 — QUE columnas ofrece el archivo y BAJO QUE ÁMBITO recuerda cuáles se quisieron.
   *
   * Las dos cosas salen del MISMO objeto —el juego de columnas y su ámbito viajan emparejados,
   * elegidos por el mismo `conDinero` que ya decide la proyección de las filas—, así que la
   * preferencia de un juego no puede acabar aplicada al otro.
   *
   * Se DESESTRUCTURA aquí y baja al `descarga` como propiedad abreviada. No es estilo:
   * `ambito-columnas.guardia` lee el árbol como texto y solo resuelve literales e
   * identificadores; escribir `ambitoColumnas: descargaArchivo.ambitoColumnas` —o un ternario—
   * le saldría sin resolver y la pondría roja.
   */
  const { columnas: columnasArchivo, ambitoColumnas } = descargaAnaliticaProductos(conDinero);

  return (
    <div className="flex w-full flex-col gap-3">
      {/**
       * FICHA 442 — UNA LINEA, Y LAS REGLAS BAJO DEMANDA.
       *
       * Antes de esta ficha aqui habia SEIS parrafos en gris —el aviso de multiproducto, el del
       * desglose, el del dinero, la leyenda de no-sumables, el del liquidado y el universo— mas
       * el sello, todos siempre visibles y todos por encima de la tabla. Medido: empujaban la
       * primera fila fuera de la primera pantalla.
       *
       * Ahora la linea dice lo que IDENTIFICA a este recorte (de que tienda es, cuantas ordenes
       * tiene y cuando se leyo) y las REGLAS DE LECTURA se abren con «Cómo se cuenta». Lo que la
       * pantalla ya explicaba en su encabezado de seccion no se repite.
       */}
      <Collapsible className="flex flex-col gap-1 text-xs text-muted-foreground">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {/* La tienda, dicha UNA vez cuando es constante (ver `tiendaUnicaDe`). Es una
              ETIQUETA, no un control: quitar el filtro desde aquí dejaría la barra de arriba
              enseñando una tienda que ya no está aplicada, que es un fallo mudo de los que este
              repo persigue. Quien quiera cambiarla usa la barra, que es donde se puso. */}
          {tiendaUnica === null ? null : (
            <Badge variant="secondary">{textoTiendaUnica(tiendaUnica)}</Badge>
          )}
          {datos === null ? null : <span>{textoUniverso(datos.ordenes, datos.ordenesSinProducto)}</span>}
          {/* R65 — CUANDO se leyeron estas cifras de la base. La respuesta se sirve de una cache
              de 15 minutos, asi que sin el sello la pantalla afirma implicitamente que el numero
              es de este segundo. Sale del MISMO `lastSync` que sella el productor de la cache, o
              sea el mismo instante para el volumen y para el dinero (R78). */}
          {datos === null ? null : (
            <span title={textoSelloCompleto(datos.lastSync)}>{textoSello(datos.lastSync)}</span>
          )}
          <CollapsibleTrigger className="inline-flex items-center gap-1 rounded-sm underline decoration-dotted underline-offset-4 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none">
            {PRODUCTOS_TEXTOS.comoSeCuenta}
            <ChevronDown aria-hidden="true" className="size-3" />
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent>
          <ul className="flex list-disc flex-col gap-1 py-1 pl-4">
            <li>{PRODUCTOS_TEXTOS.aviso}</li>
            {/* FICHA 346 — y cómo se lee el desglose, que desde aquella ficha suma. */}
            <li>{PRODUCTOS_TEXTOS.avisoDesglose}</li>
            {/* FICHA 347 (R45/R29) — las reglas del dinero, solo cuando hay dinero que leer. */}
            {conDinero ? <li>{PRODUCTOS_TEXTOS.avisoDinero}</li> : null}
            {conDinero ? (
              <li>{textoColumnasNoSumables(DINERO_EN_COLUMNA.map((cifra) => cifra.etiqueta))}</li>
            ) : null}
            {conDinero ? <li>{PRODUCTOS_TEXTOS.avisoLiquidado}</li> : null}
          </ul>
        </CollapsibleContent>
      </Collapsible>

      {/* R76 — el tope, dicho. NO se pliega: no es una regla de lectura, es el estado de esta
          consulta, y quien no lo lea creerá que estos productos no movieron dinero. */}
      {limiteExcedido === null ? null : (
        <p className="text-xs text-muted-foreground">
          {PRODUCTOS_TEXTOS.dineroLimiteExcedido(limiteExcedido)}
        </p>
      )}

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
         * FICHA 442 — LA FILA SE ABRE SIEMPRE, y por eso `renderExpanded` ya no es condicional.
         *
         * Hasta la 347 la fila solo se abria para el dinero, asi que sin concesion no habia
         * control. Desde esta ficha el detalle lleva ademas el volumen que bajo de la cabecera
         * (unidades, otros resultados, % de rechazo), que existe en TODAS las filas — incluidas
         * las de un actor sin dinero concedido. Un control que abre un panel vacio seria peor
         * que no tenerlo; aqui nunca esta vacio.
         */
        renderExpanded={(fila) => (
          <DetalleDeFila
            fila={fila}
            conDinero={conDinero}
            filtroSerializado={filtroSerializado}
          />
        )}
        // El nombre accesible identifica SU fila —producto y tienda—, no un «Ver detalle»
        // repetido N veces: con veinticinco filas abiertas, N botones homonimos no dicen nada.
        expandAriaLabel={(fila) => PRODUCTOS_TEXTOS.abrirDetalle(fila.producto, fila.tienda)}
        descarga={
          filas.length === 0
            ? undefined
            : {
                titulo: PRODUCTOS_TEXTOS.descarga,
                columnas: columnasArchivo,
                // FICHA 388 — el parámetro que enciende el selector de columnas del control
                // común. Sin él la clave es `null` y el hook «no lee, no escribe y devuelve las
                // columnas declaradas tal cual» (R33 de la 314).
                ambitoColumnas,
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
