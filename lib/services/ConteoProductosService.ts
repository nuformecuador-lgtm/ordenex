// FICHA 345 — EL SERVICIO del analisis de productos: parseo, fusion, cache y sello.
//
// Gemelo de `ConteoPorStatusService` (repositorio + `IAnaliticaCache` + reloj inyectable) con una
// responsabilidad mas, que es la propia de esta ficha: FUNDIR las filas crudas que agrupo la base
// —`(tienda, texto crudo, desenlace)`— en filas por PRODUCTO, interpretando el texto libre con
// `parsearProducto`.
//
// ⚠ EL VOLUMEN SON ENTEROS. `unidades`, `ordenes` y `ordenesAcompanadas` se acumulan con `+`
// sobre enteros; no hay `Decimal`, no hay `parseFloat` y no hay ningun porcentaje: el porcentaje
// lo calcula la pantalla con `calcularEfectividad` sobre `porStatus`, que es la unica definicion
// de efectividad del tablero. Un segundo calculo aqui seria una segunda definicion.
//
// ─── FICHA 347: EL DINERO ENTRA POR AQUI, Y EN LA MISMA LECTURA ──────────────────────────────
//
// La vertical gana una SEGUNDA consulta a la base dentro del MISMO servicio, la MISMA consulta
// preparada y la MISMA entrada de cache. La pantalla NO funde nada.
//
// ⚠ POR QUE UNA LECTURA Y NO DOS, que es lo que menos habria tocado. Las columnas de volumen y
// las de dinero se leen EN LA MISMA FILA. Con dos lecturas resueltas en instantes distintos
// —basta una gestion registrada entre ellas— una fila puede decir «6 entregadas» y traer el
// recaudo de 5. Es la doctrina ya escrita en este arbol, palabra por palabra, en
// `app/(app)/analitica/_components/entregas/efectividad.ts`. Con una sola lectura: un solo
// `lastSync` (R65/R78), una sola clave, un solo refresco, y la fusion ocurre en el SERVIDOR
// sobre el resultado del MISMO parser, asi que ningun importe puede quedarse sin fila.
//
// ⚠ TODO IMPORTE ES STRING escala 2 de punta a punta (R22). Aqui no se escribe ni una formula de
// dinero: la unica aritmetica monetaria vive en `repartoDeOrden`, que a su vez solo LLAMA a
// `derivarIngresoOrden` y a `pagoTiendaOrdenex`.

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
import type {
  FilaDineroCruda,
  IDineroProductosRepository,
} from "@/lib/interfaces/repositories/IDineroProductosRepository";
import type {
  ConteoProductosDTO,
  DineroProductoDTO,
  EstadoDineroProductos,
  FilaProductoDTO,
} from "@/lib/types/conteo-productos";
import {
  aporteEsCero,
  esLiquidada,
  repartoDeOrden,
  type GestionDeDinero,
  type RepartoDeOrden,
} from "@/lib/utils/dinero-por-producto";

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

/**
 * FICHA 347 — el identificador de grupo `(tienda, clave de producto)`, escrito UNA vez.
 *
 * Lo comparten la fusion del VOLUMEN y la del DINERO, y esa es la razon de que exista y de que
 * se exporte: si cada una compusiera su clave a su manera, un cambio en el separador dejaria el
 * dinero sin fila donde pintarse y NADA se pondria rojo — las cifras simplemente desapareceran.
 */
export function claveDeGrupoProducto(tiendaId: string, claveProducto: string): string {
  return `${tiendaId}${SEP}${claveProducto}`;
}

/** Lo que se acumula por grupo mientras se funden las filas crudas. */
interface Acumulador {
  tiendaId: string;
  tienda: string;
  unidades: number;
  ordenes: number;
  /** R13 — cuantas de esas ordenes llevaban MAS de un producto. Entero y aditivo. */
  ordenesAcompanadas: number;
  /** desenlace -> ordenes */
  porStatus: Map<string, number>;
  /** forma visible cruda -> ordenes en que aparecio (solo decide QUE forma se muestra) */
  variantes: Map<string, number>;
}

/**
 * FICHA 347 — el dinero ya fundido y listo para adosarse a las filas de volumen.
 *
 * `porGrupo` va vacio cuando el estado no es `concedido`: ninguna fila recibe cifras, que es lo
 * que R5 y R76 exigen — ni recortadas, ni agregadas, ni en cero.
 */
export interface DineroFundido {
  readonly estado: EstadoDineroProductos;
  readonly porGrupo: ReadonlyMap<string, DineroProductoDTO>;
}

/** El dinero de una lectura a la que NO se le concedio (R5). Sin cifras y sin mapa. */
export const DINERO_DENEGADO: DineroFundido = {
  estado: { estado: "denegado" },
  porGrupo: new Map(),
};

export class ConteoProductosService {
  private readonly now: () => Date;

  constructor(
    private readonly repo: IConteoProductosRepository,
    private readonly cache: IAnaliticaCache,
    /**
     * FICHA 347 — el repositorio del dinero. Se INYECTA (no se construye aqui) igual que el de
     * volumen, y solo se LLAMA si la consulta trae el dinero concedido: con `denegado` no se
     * toca la base ni una vez. Un `SELECT` que se lanza para tirar el resultado ya habria leido
     * el dinero.
     */
    private readonly dineroRepo: IDineroProductosRepository,
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
      // Las DOS consultas dentro del MISMO productor de cache: mismo instante logico, misma
      // entrada, mismo `lastSync` (R78). Y `lastSync` se sella DENTRO, no fuera — el productor
      // es el unico codigo que corre en un fallo de cache, o sea el unico momento en que se
      // toca la base; sellarlo fuera escribiria la hora del render en cada ACIERTO.
      const crudas = await this.repo.contarProductos(consulta);
      const dinero = await this.leerDinero(consulta);
      return { ...fundir(crudas, dinero), lastSync: this.now().toISOString() };
    });
  }

  /**
   * FICHA 347 — la segunda consulta, CONDICIONADA a la concesion.
   *
   * Con el dinero denegado el repositorio NO SE LLAMA: no es una optimizacion, es R5. Se
   * comprueba con un doble que cuenta llamadas.
   */
  private async leerDinero(consulta: ConsultaProductos): Promise<DineroFundido> {
    if (consulta.dinero !== "concedido") return DINERO_DENEGADO;
    const lectura = await this.dineroRepo.leerDineroPorOrden(consulta);
    if (lectura.estado === "limite_excedido") {
      // R76 / A10 — o van todas las ordenes, o no va ninguna. NO se sirve una suma sobre un
      // conjunto truncado: una cifra de dinero incompleta no se ve incompleta.
      return {
        estado: { estado: "limite_excedido", limite: lectura.limite },
        porGrupo: new Map(),
      };
    }
    return { estado: { estado: "concedido" }, porGrupo: fundirDinero(lectura.filas) };
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
  dinero: DineroFundido = DINERO_DENEGADO,
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

    const fundidos = deduplicarPorClave(items);
    // R13 — la orden va ACOMPANADA si tras deduplicar quedan DOS O MAS productos distintos. Es
    // el mismo criterio de identidad que decide las filas (la clave), asi que `2 * Base C. 1 *
    // base c.` NO cuenta como acompanada: es el mismo producto escrito dos veces.
    const acompanada = fundidos.size >= 2 ? fila.n : 0;

    for (const [clave, item] of fundidos) {
      const id = claveDeGrupoProducto(fila.tiendaId, clave);
      let grupo = grupos.get(id);
      if (grupo === undefined) {
        grupo = {
          tiendaId: fila.tiendaId,
          tienda: fila.tiendaNombre,
          unidades: 0,
          ordenes: 0,
          ordenesAcompanadas: 0,
          porStatus: new Map(),
          variantes: new Map(),
        };
        grupos.set(id, grupo);
      }
      // `cantidad x n`: la fila cruda representa `n` ordenes IGUALES, cada una con esa cantidad.
      grupo.unidades += item.cantidad * fila.n;
      grupo.ordenes += fila.n;
      grupo.ordenesAcompanadas += acompanada;
      grupo.porStatus.set(fila.status, (grupo.porStatus.get(fila.status) ?? 0) + fila.n);
      for (const nombre of item.nombres) {
        grupo.variantes.set(nombre, (grupo.variantes.get(nombre) ?? 0) + fila.n);
      }
    }
  }

  // Se itera sobre `entries()` y no sobre `values()` porque el ID DEL GRUPO es lo que casa la
  // fila de volumen con sus cifras de dinero (R78 / ⟨Q7⟩): las dos fusiones lo componen con
  // `claveDeGrupoProducto` sobre el MISMO parser y la MISMA deduplicacion, asi que las claves
  // casan por construccion y ningun importe puede quedarse sin fila donde pintarse.
  const filas: FilaProductoDTO[] = [...grupos.entries()]
    // R31 — ninguna fila con cero ordenes. Por construccion no puede haberla (`fila.n >= 1`); el
    // filtro deja la invariante escrita en vez de dependiente del `GROUP BY` de la base.
    .filter(([, g]) => g.ordenes > 0)
    .map(([id, g]) => ({
      tiendaId: g.tiendaId,
      tienda: g.tienda,
      producto: formaVisible(g.variantes),
      unidades: g.unidades,
      ordenes: g.ordenes,
      ordenesAcompanadas: g.ordenesAcompanadas,
      porStatus: [...g.porStatus.entries()]
        .map(([status, conteo]) => ({ status, conteo }))
        // Mismo criterio que el desglose por estado: conteo desc, y el nombre como desempate
        // para que dos lecturas iguales no devuelvan dos ordenaciones distintas.
        .sort((a, b) => b.conteo - a.conteo || comparar(a.status, b.status)),
      // `?? null` y no `?? cifrasEnCero()`: un grupo sin aporte no tiene dinero, no tiene cero.
      dinero: dinero.porGrupo.get(id) ?? null,
    }))
    .sort(
      (a, b) =>
        b.unidades - a.unidades ||
        b.ordenes - a.ordenes ||
        comparar(a.producto, b.producto) ||
        comparar(a.tienda, b.tienda),
    );

  return { filas, ordenes, ordenesSinProducto, dinero: dinero.estado };
}

/* -------------------------------------------------------------------------- */
/* FICHA 347 — la fusion del DINERO                                            */
/* -------------------------------------------------------------------------- */

/**
 * UNA orden que aporta dinero, con todo lo que la fila y el detalle necesitan saber de ella.
 *
 * ⚠ ESTE TIPO Y LA FUNCION DE ABAJO SON LA UNICA DEFINICION DE «que ordenes aportan y cuanto
 * aporta cada una». La fila (`fundirDinero`) y el panel del detalle
 * (`DetalleDineroProductoService`) salen de AQUI, no de dos recorridos parecidos. Es lo que hace
 * que la suma del detalle sea EXACTAMENTE la cifra de la fila (R38) por construccion, y no por
 * una comprobacion que alguien tenga que acordarse de hacer.
 */
export interface OrdenQueAporta {
  readonly ordenId: string;
  /** La primera fila cruda de esa orden: de ahi sale todo lo descriptivo (guia, tienda, texto). */
  readonly fila: FilaDineroCruda;
  /** TODAS sus gestiones aportantes, en el orden en que las devolvio la base (`g.id` asc). */
  readonly gestiones: readonly GestionDeDinero[];
  /** Las claves de producto de su texto, ya deduplicadas. Una orden puede estar en varias filas. */
  readonly claves: readonly string[];
  readonly reparto: RepartoDeOrden;
  /** `true` si tiene AL MENOS UNA gestion liquidada. Decide el rotulo de la fila del detalle. */
  readonly liquidada: boolean;
}

/**
 * Las filas crudas del dinero, agrupadas por ORDEN y ya filtradas.
 *
 * Funcion PURA y exportada: es donde vive la atribucion de la ficha y se comprueba sin cache,
 * sin repositorio y sin base.
 *
 * LOS CUATRO PASOS:
 *
 *  1. agrupar las filas crudas por `orden_id` (el grano crudo es `(orden, gestion)`);
 *  2. por cada orden, `repartoDeOrden(sus gestiones)` — R18 sale de aqui sin caso especial:
 *     cada gestion trae el snapshot congelado de SU cierre y las dos derivaciones se suman;
 *  3. DESCARTAR la orden si su aporte es cero en las CUATRO cifras (R39). Es la MISMA regla que
 *     aplica el detalle —de hecho es esta misma linea— y por eso el cardinal de la fila y el
 *     del detalle coinciden: una orden de mas subiria el cardinal aunque su aporte fuese cero,
 *     que es justo lo que hace que aflojar el `WHERE` duela en el test de cuadre;
 *  4. `parsearProducto(orden.producto)` —memoizado por texto— y deduplicar por clave, con EL
 *     MISMO parser y LA MISMA deduplicacion que el volumen, asi que las claves casan.
 */
export function ordenesQueAportan(
  filas: readonly FilaDineroCruda[],
): readonly OrdenQueAporta[] {
  // 1. Por orden. `Map` conserva el orden de insercion y las filas llegan con `ORDER BY o.id,
  //    g.id`, asi que el recorrido es DETERMINISTA (R25).
  const porOrden = new Map<string, { fila: FilaDineroCruda; gestiones: FilaDineroCruda[] }>();
  for (const f of filas) {
    const previa = porOrden.get(f.ordenId);
    if (previa === undefined) porOrden.set(f.ordenId, { fila: f, gestiones: [f] });
    else previa.gestiones.push(f);
  }

  const parseados = new Map<string, readonly ItemProducto[]>();
  const salida: OrdenQueAporta[] = [];

  for (const [ordenId, { fila, gestiones }] of porOrden) {
    // 2 y 3.
    const reparto = repartoDeOrden(gestiones);
    if (aporteEsCero(reparto)) continue;

    // 4. El MISMO parser y la MISMA deduplicacion que el volumen.
    let items = parseados.get(fila.producto);
    if (items === undefined) {
      items = parsearProducto(fila.producto);
      parseados.set(fila.producto, items);
    }
    // Una orden cuyo texto no produce ningun item no tiene fila de volumen donde pintarse: su
    // dinero se queda fuera, igual que su volumen (que cae en `ordenesSinProducto`). No se
    // inventa un producto «(sin nombre)» para colgarle plata.
    if (items.length === 0) continue;

    salida.push({
      ordenId,
      fila,
      gestiones,
      claves: [...deduplicarPorClave(items).keys()],
      reparto,
      liquidada: gestiones.some(esLiquidada),
    });
  }
  return salida;
}

/**
 * Las cifras de UN grupo de ordenes: la fila de la tabla, o la cabecera del panel del detalle.
 *
 * ⚠ EL REPARTO DEL GRUPO SALE DE `repartoDeOrden` SOBRE LAS GESTIONES CONCATENADAS, y no de una
 * segunda acumulacion escrita aparte. Las dos son lineales sobre importes de escala 2, asi que
 * `Σ detalle[].ordenex === fila.liquidado.ordenex` es EXACTO (R38) y `ordenex + tienda ===
 * liquidado.recaudado` (R20) lo sigue siendo a nivel de grupo, porque `tienda` sigue siendo la
 * misma resta.
 */
export function cifrasDelGrupo(ordenes: readonly OrdenQueAporta[]): DineroProductoDTO {
  const gestiones: GestionDeDinero[] = [];
  const liquidadas = new Set<string>();
  const pendientes = new Set<string>();
  for (const o of ordenes) {
    for (const g of o.gestiones) gestiones.push(g);
    // `Set`: una orden con dos gestiones o en dos cierres cuenta UNA vez (R18). Y los dos
    // conjuntos son DISJUNTOS, que es lo que hace que su suma sea el cardinal del detalle.
    (o.liquidada ? liquidadas : pendientes).add(o.ordenId);
  }
  const r = repartoDeOrden(gestiones);
  return {
    recaudado: r.recaudado,
    liquidado: {
      recaudado: r.liquidadoRecaudado,
      ordenex: r.ordenex,
      tienda: r.tienda,
      ordenes: liquidadas.size,
    },
    pendiente: { recaudado: r.pendienteRecaudado, ordenes: pendientes.size },
    retorno: r.retorno,
  };
}

/**
 * Las filas crudas del dinero, fundidas en cifras por `(tienda, producto)`.
 *
 * ⚠ R12 — EL IMPORTE COMPLETO EN CADA PRODUCTO. La orden se acumula ENTERA en CADA grupo de sus
 * claves; no se reparte nada entre los productos de una orden, y por eso la columna NO ES
 * SUMABLE hacia abajo. Repartir exigiria un precio unitario que NO EXISTE en el sistema
 * (`orden.producto` solo trae `cantidad * nombre`), o sea inventar una cifra con aspecto de
 * dato.
 */
export function fundirDinero(
  filas: readonly FilaDineroCruda[],
): ReadonlyMap<string, DineroProductoDTO> {
  const grupos = new Map<string, OrdenQueAporta[]>();
  for (const orden of ordenesQueAportan(filas)) {
    for (const clave of orden.claves) {
      const id = claveDeGrupoProducto(orden.fila.tiendaId, clave);
      const grupo = grupos.get(id);
      if (grupo === undefined) grupos.set(id, [orden]);
      else grupo.push(orden);
    }
  }

  const salida = new Map<string, DineroProductoDTO>();
  for (const [id, ordenes] of grupos) salida.set(id, cifrasDelGrupo(ordenes));
  return salida;
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
