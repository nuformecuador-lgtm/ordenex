// FICHA 345 — EL SERVICIO del analisis de productos: parseo, fusion, cache y sello.
//
// Gemelo de `ConteoPorStatusService` (repositorio + `IAnaliticaCache` + reloj inyectable) con una
// responsabilidad mas, que es la propia de esta ficha: FUNDIR las filas crudas que agrupo la base
// —`(tienda, texto crudo, desenlace)`— en filas por PRODUCTO, interpretando el texto libre con
// `parsearProducto`.
//
// ⚠ TODO SON ENTEROS. `unidades` y `ordenes` se acumulan con `+` sobre enteros; no hay `Decimal`,
// no hay `parseFloat`, no hay dinero y no hay ningun porcentaje: el porcentaje lo calcula la
// pantalla con `calcularEfectividad` sobre `porStatus`, que es la unica definicion de efectividad
// del tablero. Un segundo calculo aqui seria una segunda definicion.

import { parsearProducto } from "@/lib/analytics/producto-parse";
import type { ItemProducto } from "@/lib/analytics/producto-parse";
import {
  claveDeConteoProductos,
  TAG_CONTEO_PRODUCTOS,
} from "@/lib/analytics/productos-consulta";
import type { ConsultaProductos } from "@/lib/analytics/productos-consulta";
import type { IAnaliticaCache } from "@/lib/interfaces/external/IAnaliticaCache";
import type {
  FilaProductoCruda,
  IConteoProductosRepository,
} from "@/lib/interfaces/repositories/IConteoProductosRepository";
import type { ConteoProductosDTO, FilaProductoDTO } from "@/lib/types/conteo-productos";

export interface ConteoProductosServiceOpts {
  /** Reloj inyectable: ningun `Date.now()` escondido, ningun test falseando el reloj global. */
  readonly now?: () => Date;
}

/**
 * Separador del identificador de grupo `(tienda, clave de producto)`: `US` (U+001F). No puede
 * aparecer dentro de un uuid ni dentro de un nombre de producto escrito por una tienda, asi que
 * dos grupos distintos no colapsan en uno — que seria fundir dos tiendas en una fila (R39).
 */
const SEP = String.fromCharCode(31);

/** Lo que se acumula por grupo mientras se funden las filas crudas. */
interface Acumulador {
  tiendaId: string;
  tienda: string;
  unidades: number;
  ordenes: number;
  /** desenlace -> ordenes */
  porStatus: Map<string, number>;
  /** forma visible cruda -> ordenes en que aparecio (solo decide QUE forma se muestra) */
  variantes: Map<string, number>;
}

export class ConteoProductosService {
  private readonly now: () => Date;

  constructor(
    private readonly repo: IConteoProductosRepository,
    private readonly cache: IAnaliticaCache,
    opts: ConteoProductosServiceOpts = {},
  ) {
    this.now = opts.now ?? (() => new Date());
  }

  /**
   * El analisis de una consulta ya validada y ya recortada.
   *
   * ⚠ `lastSync` se sella DENTRO del productor, no fuera — el mismo motivo que en sus seis
   * hermanas: el productor es el unico codigo que corre en un fallo de cache, o sea el unico
   * momento en que se toca la base. Sellarlo fuera escribiria la hora del render en cada
   * ACIERTO, que son todas las peticiones menos la primera de cada ventana de 15 min.
   *
   * La clave lleva PREFIJO propio (`claveDeConteoProductos`). No es cosmetico: las siete lecturas
   * de la seccion comparten el filtro a proposito, asi que sin prefijo producirian la MISMA clave
   * con valores de forma distinta (R58).
   */
  async consultar(consulta: ConsultaProductos): Promise<ConteoProductosDTO> {
    const clave = claveDeConteoProductos(consulta);

    return this.cache.envolver<ConteoProductosDTO>(clave, [TAG_CONTEO_PRODUCTOS], async () => {
      const crudas = await this.repo.contarProductos(consulta);
      return { ...fundir(crudas), lastSync: this.now().toISOString() };
    });
  }
}

/**
 * Las filas crudas de la base, fundidas en filas por producto.
 *
 * Funcion PURA y exportada: la fusion es donde vive la aritmetica de la ficha (unidades, ordenes,
 * deduplicacion por orden, forma visible, orden de filas) y se comprueba sin cache y sin
 * repositorio.
 */
export function fundir(
  crudas: readonly FilaProductoCruda[],
): Omit<ConteoProductosDTO, "lastSync"> {
  // Memoizacion del PARSEO por texto: una fila por desenlace repite el mismo texto —y en una
  // tienda con 300 ordenes del mismo producto son 5 o 6 filas— y no hay por que volver a
  // parsearlo. El parser es puro, asi que memoizar no cambia ninguna respuesta.
  const parseados = new Map<string, readonly ItemProducto[]>();
  const grupos = new Map<string, Acumulador>();

  let ordenes = 0;
  let ordenesSinProducto = 0;

  for (const fila of crudas) {
    // El universo es la suma de TODAS las filas crudas, incluidas las que no producen ningun
    // item: `ordenes` es cuantas ordenes entraron en el calculo, no cuantas dieron producto.
    ordenes += fila.n;

    let items = parseados.get(fila.producto);
    if (items === undefined) {
      items = parsearProducto(fila.producto);
      parseados.set(fila.producto, items);
    }

    if (items.length === 0) {
      // R20/R35 — texto vacio o sin nombre interpretable. Se cuenta aparte y NO se inventa un
      // producto "(sin nombre)": una fila fantasma en la tabla es peor que un contador al lado.
      ordenesSinProducto += fila.n;
      continue;
    }

    for (const [clave, item] of deduplicarPorClave(items)) {
      const id = `${fila.tiendaId}${SEP}${clave}`;
      let grupo = grupos.get(id);
      if (grupo === undefined) {
        grupo = {
          tiendaId: fila.tiendaId,
          tienda: fila.tiendaNombre,
          unidades: 0,
          ordenes: 0,
          porStatus: new Map(),
          variantes: new Map(),
        };
        grupos.set(id, grupo);
      }
      // `cantidad x n`: la fila cruda representa `n` ordenes IGUALES, cada una con esa cantidad.
      grupo.unidades += item.cantidad * fila.n;
      grupo.ordenes += fila.n;
      grupo.porStatus.set(fila.status, (grupo.porStatus.get(fila.status) ?? 0) + fila.n);
      for (const nombre of item.nombres) {
        grupo.variantes.set(nombre, (grupo.variantes.get(nombre) ?? 0) + fila.n);
      }
    }
  }

  const filas: FilaProductoDTO[] = [...grupos.values()]
    // R31 — ninguna fila con cero ordenes. Por construccion no puede haberla (`fila.n >= 1`); el
    // filtro deja la invariante escrita en vez de dependiente del `GROUP BY` de la base.
    .filter((g) => g.ordenes > 0)
    .map((g) => ({
      tiendaId: g.tiendaId,
      tienda: g.tienda,
      producto: formaVisible(g.variantes),
      unidades: g.unidades,
      ordenes: g.ordenes,
      porStatus: [...g.porStatus.entries()]
        .map(([status, conteo]) => ({ status, conteo }))
        // Mismo criterio que el desglose por estado: conteo desc, y el nombre como desempate
        // para que dos lecturas iguales no devuelvan dos ordenaciones distintas.
        .sort((a, b) => b.conteo - a.conteo || comparar(a.status, b.status)),
    }))
    .sort(
      (a, b) =>
        b.unidades - a.unidades ||
        b.ordenes - a.ordenes ||
        comparar(a.producto, b.producto) ||
        comparar(a.tienda, b.tienda),
    );

  return { filas, ordenes, ordenesSinProducto };
}

/** Un producto ya deduplicado dentro de UNA orden. */
interface ItemFundido {
  readonly cantidad: number;
  /** las formas visibles con que ese producto aparecio en el texto */
  readonly nombres: readonly string[];
}

/**
 * R26 — el mismo producto en dos items de la MISMA orden: las cantidades se SUMAN y la orden
 * cuenta UNA sola vez.
 *
 * Sin esto, `2 * Base C. 1 * base c.` contaria esa orden dos veces en la columna «Órdenes», y la
 * tabla diria que dos ordenes distintas compraron el producto.
 */
function deduplicarPorClave(items: readonly ItemProducto[]): Map<string, ItemFundido> {
  const fundidos = new Map<string, { cantidad: number; nombres: string[] }>();
  for (const item of items) {
    const previo = fundidos.get(item.clave);
    if (previo === undefined) {
      fundidos.set(item.clave, { cantidad: item.cantidad, nombres: [item.nombre] });
      continue;
    }
    previo.cantidad += item.cantidad;
    if (!previo.nombres.includes(item.nombre)) previo.nombres.push(item.nombre);
  }
  return fundidos;
}

/**
 * R18 — QUE forma se muestra cuando varias variantes comparten clave (`BASE C` y `Base C.`).
 *
 * Gana la de MAS ordenes; en empate, la MENOR por comparacion de cadena. Los dos criterios son
 * necesarios: sin el segundo, dos variantes con el mismo peso saldrian en el orden de iteracion
 * del `Map`, que depende del orden en que la base devolvio las filas — y la misma entrada
 * produciria dos pantallas distintas.
 */
function formaVisible(variantes: Map<string, number>): string {
  let elegida = "";
  let peso = -1;
  for (const [nombre, ordenes] of variantes) {
    if (ordenes > peso || (ordenes === peso && comparar(nombre, elegida) < 0)) {
      elegida = nombre;
      peso = ordenes;
    }
  }
  return elegida;
}

/**
 * Comparacion de cadenas por UNIDADES DE CODIGO, y NO `localeCompare`.
 *
 * `localeCompare` depende del ICU del entorno: la misma respuesta ordenada en la maquina de
 * desarrollo y en el servidor puede salir distinta, y con ella la paginacion de la tabla y
 * cualquier `toEqual` de un test. Determinismo antes que correccion tipografica.
 */
function comparar(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}
