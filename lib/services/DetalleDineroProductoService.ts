// FICHA 347 — EL DETALLE ORDEN POR ORDEN del dinero de un producto.
//
// Servicio PURO de negocio: no conoce Next (ni `Request`, ni `Response`, ni `cookies`), no
// resuelve sesion y no escribe ni una operacion aritmetica de dinero propia. Recibe una
// `ConsultaProductos` YA PREPARADA —o sea, ya validada y ya recortada por el alcance— y el
// repositorio por constructor.
//
// ─── DE DONDE SALEN LAS CIFRAS, Y POR QUE CUADRAN CON LA FILA ────────────────────────────────
//
// De `ordenesQueAportan` y `cifrasDelGrupo`, LAS MISMAS funciones que producen la fila de la
// tabla (`ConteoProductosService`). No hay un segundo recorrido «parecido»: el cuadre de R38 es
// una propiedad de la construccion, no una comprobacion que alguien tenga que recordar hacer.
//
// ─── LA CLAVE DEL PRODUCTO SE FILTRA EN MEMORIA, Y SE DICE POR QUE SE PUEDE ──────────────────
//
// Porque NO es una frontera de seguridad. La frontera es la TIENDA, y esa viaja en el `WHERE` de
// SQL por la faceta del filtro que el alcance ya interseca. La clave del producto es un recorte
// de PRESENTACION.
//
// Y ademas no se puede filtrar en SQL sin introducir una SEGUNDA definicion de «este texto
// contiene este producto» (alternativa A4, descartada por medicion): la clave la produce
// `limpiar()`, que COLAPSA LOS ESPACIOS REPETIDOS, asi que `"BASE   C"` genera la clave
// `"base c"` y un `ILIKE '%base c%'` NO CASARIA CON SU PROPIO TEXTO. Un pre-filtro que pierde
// filas sobre un camino de dinero es peor que traer de mas.

import type { ConsultaProductos } from "@/lib/analytics/productos-consulta";
import { claveDeProducto, parsearProducto } from "@/lib/analytics/producto-parse";
import { detalleMovimientoConfig } from "@/lib/config/detalle-movimiento";
import type { IDineroProductosRepository } from "@/lib/interfaces/repositories/IDineroProductosRepository";
import {
  cifrasDelGrupo,
  ordenesQueAportan,
  type OrdenQueAporta,
} from "@/lib/services/ConteoProductosService";
import type {
  DetalleDineroProductoPayload,
  OrdenDineroDTO,
} from "@/lib/types/dinero-productos";

/** Lo que el servicio necesita saber de la peticion, ya validado por el borde. */
export interface DetalleDineroProductoConsulta {
  readonly productoClave: string;
  readonly page: number;
  readonly pageSize: number;
}

/** Lo que devuelve el servicio. El borde lo traduce (y le anade sus dos estados de sesion). */
export type DetalleDineroProductoServiceResult =
  | { readonly status: "ok"; readonly datos: DetalleDineroProductoPayload }
  | { readonly status: "vacio" }
  | { readonly status: "limite_excedido"; readonly limite: number }
  | { readonly status: "forbidden" };

export class DetalleDineroProductoService {
  constructor(private readonly repo: IDineroProductosRepository) {}

  async consultar(
    consulta: ConsultaProductos,
    input: DetalleDineroProductoConsulta,
  ): Promise<DetalleDineroProductoServiceResult> {
    // R5/R43 — el guard ANTES de tocar la base. Un `forbidden` evaluado despues del `SELECT` ya
    // habria leido el dinero para tirarlo. Y el detalle respeta EXACTAMENTE la misma concesion
    // que la fila: si el rol no tiene el dinero, tampoco tiene su detalle.
    if (consulta.dinero !== "concedido") return { status: "forbidden" };

    const lectura = await this.repo.leerDineroPorOrden(consulta);
    if (lectura.estado === "limite_excedido") {
      return { status: "limite_excedido", limite: lectura.limite };
    }

    // La clave se normaliza con la MISMA funcion que la produjo (`claveDeProducto`): si el
    // cliente manda `"BASE   C"` o `"Base C."`, casa igual. Una comparacion contra un
    // `toLowerCase()` escrito aqui seria una segunda definicion de la misma identidad.
    const clave = claveDeProducto(input.productoClave);
    const delProducto = ordenesQueAportan(lectura.filas).filter((o) => o.claves.includes(clave));

    // R42 — estado EXPLICITO, ni tabla en blanco ni error.
    if (delProducto.length === 0) return { status: "vacio" };

    const ordenadas = [...delProducto].sort(ordenTotal);
    // R40 — el total lo cuenta el SERVIDOR sobre el conjunto ENTERO. Jamas `ordenes.length` de
    // la pagina: con `pageSize` 25 y 60 ordenes, eso diria «25».
    const total = ordenadas.length;
    const desde = (input.page - 1) * input.pageSize;
    const pagina = ordenadas.slice(desde, desde + input.pageSize);

    return {
      status: "ok",
      datos: {
        producto: formaVisibleDe(delProducto, clave),
        tiendaNombre: delProducto[0].fila.tiendaNombre,
        // R38 — las MISMAS cifras que la fila, de la MISMA funcion y sobre el MISMO conjunto.
        totales: cifrasDelGrupo(delProducto),
        total,
        page: input.page,
        pageSize: input.pageSize,
        ordenes: pagina.map(comoFila),
      },
    };
  }
}

/**
 * EL ORDEN ES TOTAL, y los tres criterios hacen falta.
 *
 * `numGuia asc` con los `null` AL FINAL (una orden que nunca genero guia se identifica por su
 * remision) — NUMERICO y no lexicografico, mismo criterio que `ORDEN_TOTAL` de la 344; luego la
 * `guia` visible, que desempata entre las que no tienen numero; y por ultimo `ordenId`, que es
 * UNICO. Sin ese ultimo desempate, dos ordenes empatadas quedan en orden indefinido y paginar
 * REPITE U OMITE una orden — que en una tabla de dinero significa contar dos veces o perderse
 * un aporte.
 *
 * NO se ordena por el aporte: el aporte es DERIVADO y no existe como columna.
 */
function ordenTotal(a: OrdenQueAporta, b: OrdenQueAporta): number {
  const ga = a.fila.numGuia;
  const gb = b.fila.numGuia;
  if (ga !== gb) {
    if (ga === null) return 1;
    if (gb === null) return -1;
    return ga - gb;
  }
  return comparar(a.fila.guia, b.fila.guia) || comparar(a.ordenId, b.ordenId);
}

/**
 * Comparacion por UNIDADES DE CODIGO y no `localeCompare`: este ultimo depende del ICU del
 * entorno, y la misma pagina ordenada en desarrollo y en el servidor podria salir distinta.
 * Determinismo antes que correccion tipografica (R25). Misma regla que el resto de la vertical.
 */
function comparar(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * La forma VISIBLE del producto para la cabecera del panel.
 *
 * Se re-deriva de los textos crudos de las ordenes del conjunto —no se recibe del cliente— para
 * que el titulo del panel no lo pueda escribir quien hace la peticion. Gana la variante que
 * aparece en MAS ordenes y, en empate, la MENOR por comparacion de cadena: los dos criterios
 * hacen falta, porque sin el segundo dos variantes con el mismo peso saldrian en el orden de
 * iteracion del `Map` y el mismo panel se titularia distinto entre dos lecturas iguales.
 *
 * Si ninguna variante casara (imposible: el filtro ya exigio que la clave este), cae a la clave.
 */
function formaVisibleDe(ordenes: readonly OrdenQueAporta[], clave: string): string {
  const pesos = new Map<string, number>();
  for (const o of ordenes) {
    for (const nombre of nombresDeClave(o, clave)) {
      pesos.set(nombre, (pesos.get(nombre) ?? 0) + 1);
    }
  }
  let elegida = "";
  let peso = -1;
  for (const [nombre, n] of pesos) {
    if (n > peso || (n === peso && comparar(nombre, elegida) < 0)) {
      elegida = nombre;
      peso = n;
    }
  }
  return elegida === "" ? clave : elegida;
}

/**
 * Las formas visibles con que ESA orden escribio el producto de esa clave.
 *
 * Se vuelve a partir el texto crudo con el MISMO parser que usan la tabla y la fusion —una
 * segunda forma de leer el texto seria una segunda definicion de que es un producto—. Es barato
 * (una orden, un texto) y evita ensanchar `OrdenQueAporta` con un dato que solo usa el titulo de
 * un panel.
 */
function nombresDeClave(orden: OrdenQueAporta, clave: string): readonly string[] {
  return parsearProducto(orden.fila.producto)
    .filter((i) => i.clave === clave)
    .map((i) => i.nombre);
}

/** Una orden del conjunto, con la forma que cruza la frontera. */
function comoFila(o: OrdenQueAporta): OrdenDineroDTO {
  return {
    ordenId: o.ordenId,
    guia: o.fila.guia,
    destinatario: o.fila.destinatario,
    // Los resultados de TODAS sus gestiones aportantes, sin agrupar: una orden con dos gestiones
    // lo dice ensenando dos resultados.
    resultados: o.gestiones.map((g) => g.resultado),
    estado: o.liquidada ? "liquidada" : "pendiente",
    recaudado: o.reparto.recaudado,
    // R27/R30/R31 — de una orden pendiente NO se emite reparto. `null`, nunca `"0.00"`: no se
    // proyecta, no se estima y no se extrapola.
    ordenex: o.reparto.ordenex,
    tienda: o.reparto.tienda,
    retorno: o.reparto.retorno,
  };
}

/** El tope de pagina que el borde admite. Se re-exporta para que el test lo lea de un sitio. */
export const TOPE_PAGINA_DETALLE_DINERO = detalleMovimientoConfig.MAX_PAGE_SIZE;
