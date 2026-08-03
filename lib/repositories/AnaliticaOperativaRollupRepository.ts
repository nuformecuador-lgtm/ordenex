import type { GestionCausaDevolucion, Prisma, PrismaClient } from "@prisma/client";
import type { ConsultaAnalitica } from "@/lib/analytics/consulta";
import { whereRollup } from "@/lib/analytics/alcance-columnas";
import { fechaComoDate } from "@/lib/analytics/rollup-dia";
import type { DimensionAnalitica } from "@/lib/analytics/types";
import {
  DIMENSION_AGREGADA,
  type CuboRollup,
  type EtiquetaEstatus,
  type IAnaliticaOperativaRollupRepository,
} from "@/lib/interfaces/repositories/IAnaliticaOperativaRollupRepository";

// Feature 126 (T3.1/T3.2, design §D4/§D11) — EL LECTOR del rollup diario.
//
// R27/D11 — este es el UNICO archivo del arbol autorizado a LEER `analytics_daily`, y solo
// dentro de sus dos metodos declarados (`agregarCubos`, `etiquetasDeEstatus`). Leer el rollup
// desde el servicio, desde la Server Action o desde un componente sigue poniendo rojo
// `tests/integration/db/analytics-daily-guards.test.ts`. La apertura del guardia R42 es POR
// ARCHIVO Y POR NOMBRE DE METODO, no por directorio.
//
// R2 — SOLO LECTURA: aqui no hay ni un `create`, `update`, `upsert` ni `delete`. El escritor
// del rollup es la 124 y sigue siendo el unico.
//
// R4 — TODA firma recibe `ConsultaAnalitica`. El recorte multi-tenant se empuja al `WHERE`
// (`whereRollup`), nunca a un filtro en memoria.
//
// ⚠ POR QUE LAS 10 MEDIDAS VIVEN EN UNA CONSTANTE Y NO EN UN `_sum: { ... }` INLINE.
// El tripwire R43 de la 124 (`analytics-daily-guards.test.ts`) marca como infraccion toda
// aparicion de `ordenes_estado_stock` DENTRO de una expresion de agregacion cuya ventana de
// texto contiene marcas de rango (`gte`/`lte`/`desde`/`hasta`). Su regla, escrita por la 124,
// es que el codigo DIGA sobre que fecha suma. Aqui la respuesta es estructural y mas fuerte
// que un comentario: **`fecha` va SIEMPRE en el `by` del `groupBy`** (ver `columnasDelGrano`),
// asi que cada fila del resultado pertenece a UNA fecha y la columna nunca se suma ENTRE
// fechas, que es lo que R12 y el tripwire prohiben. Extraer las medidas a
// `MEDIDAS_DEL_CUBO` deja esa garantia legible en un solo sitio en vez de repetida en cada
// llamada. Quien de verdad verifica R12 es `operativa-embudo.test.ts`, con su mutacion.

/** Cliente Prisma MINIMO consumido (patron `AnaliticaRollupRepository` de la 124). */
type AnaliticaOperativaPrismaClient = Pick<PrismaClient, "analyticsDaily" | "orderStatus">;

/**
 * Las 10 medidas del rollup (`db/schema.prisma`, modelo `AnalyticsDaily`). Se declaran una
 * sola vez: la proyeccion del servicio consume exactamente estas y ninguna mas.
 *
 * `segCicloAcum` es `BigInt` en la base y sale como `bigint`: la conversion a `number` la
 * hace el SERVICIO y solo DESPUES de dividir (D5/R14). Aqui no se toca.
 */
const MEDIDAS_DEL_CUBO = {
  ordenesCreadas: true,
  ordenesEstadoStock: true,
  entregas: true,
  devoluciones: true,
  rechazos: true,
  reprogramaciones: true,
  incidentes: true,
  primerIntentoOk: true,
  segCicloAcum: true,
  segCicloN: true,
} as const;

/** Traduccion grano del catalogo -> columna del rollup. `metodo_pago` no existe aqui. */
const COLUMNA_DE_GRANO: Partial<Record<DimensionAnalitica, keyof typeof COORDENADAS>> = {
  zona: "zonaId",
  tienda: "tiendaId",
  mensajero: "mensajeroId",
  estatus: "estatusId",
  causa_devolucion: "causaDevolucion",
};

/** Las cinco coordenadas opcionales del grano, en orden estable. */
const COORDENADAS = {
  zonaId: true,
  tiendaId: true,
  mensajeroId: true,
  estatusId: true,
  causaDevolucion: true,
} as const;

type Coordenada = keyof typeof COORDENADAS;

export class AnaliticaOperativaRollupRepository implements IAnaliticaOperativaRollupRepository {
  constructor(private readonly prisma: AnaliticaOperativaPrismaClient) {}

  /**
   * R26/D4 — UNA sola consulta para TODAS las metricas del grano pedido.
   *
   * El `where` se compone de tres piezas y las tres son obligatorias:
   *   1. `whereRollup(consulta.alcance)` — la frontera multi-tenant, en la BASE (R21/R22/R23);
   *   2. el filtro del cliente, que la 122 ya interseco con el alcance (R4);
   *   3. el rango por FECHAS CALENDARIO (`analytics_daily.fecha` es `@db.Date`, D7).
   *
   * `fecha` entra SIEMPRE en el `by`, la pida el llamador o no: sin ella
   * `ordenes_estado_stock` —que es un STOCK al corte— se sumaria entre fechas (R12) y el
   * resultado seria plausible y falso.
   */
  async agregarCubos(
    consulta: ConsultaAnalitica,
    granos: readonly DimensionAnalitica[],
  ): Promise<readonly CuboRollup[]> {
    const coordenadas = columnasDelGrano(granos);
    const filas = await this.prisma.analyticsDaily.groupBy({
      by: ["fecha", ...coordenadas],
      _sum: MEDIDAS_DEL_CUBO,
      where: whereDeConsulta(consulta),
      orderBy: [{ fecha: "asc" }],
    });

    const pedidas = new Set<Coordenada>(coordenadas);
    return filas.map((fila) => proyectarCubo(fila, pedidas));
  }

  /**
   * D8/R13 — etiquetas resueltas CONTRA LA TABLA `order_status`, jamas contra un
   * `Record<OrderStatusValue, string>` cerrado sobre `ORDER_STATUS_SEED`.
   *
   * El estatus de fulfillment que la 155 retiro del seed ya no esta en `ORDER_STATUS_SEED`,
   * pero su fila sobrevive HUERFANA y el rollup congela el estatus DESDE EL HISTORIAL: ese id
   * sale en un `GROUP BY` real. Un mapa cerrado daria `undefined` o un `throw` en produccion y
   * no en los tests. (El literal no se escribe: censo de la 153.)
   */
  async etiquetasDeEstatus(
    ids: readonly string[],
  ): Promise<ReadonlyMap<string, EtiquetaEstatus>> {
    const reales = ids.filter((id) => id !== DIMENSION_AGREGADA);
    if (reales.length === 0) return new Map();
    const filas = await this.prisma.orderStatus.findMany({
      where: { id: { in: [...new Set(reales)] } },
      select: { id: true, value: true },
    });
    // `order_status` no tiene columna `label` (`db/schema.prisma:377-394`): la etiqueta que
    // la tabla da a un estatus ES su `value`. Ver la desviacion declarada en la interfaz.
    return new Map(filas.map((f) => [f.id, { value: f.value, label: f.value }]));
  }
}

/**
 * Las coordenadas que el grano pide, siempre en el mismo orden. `fecha` NO va aqui: la anade
 * `agregarCubos` por su cuenta y no es negociable.
 */
function columnasDelGrano(granos: readonly DimensionAnalitica[]): readonly Coordenada[] {
  const pedidas = new Set<Coordenada>();
  for (const grano of granos) {
    const columna = COLUMNA_DE_GRANO[grano];
    if (columna) pedidas.add(columna);
  }
  return (Object.keys(COORDENADAS) as Coordenada[]).filter((c) => pedidas.has(c));
}

/**
 * El `where` completo: alcance + filtro ya recortado + rango por fechas calendario CR.
 *
 * Las tres piezas se combinan con `AND` y NO con un spread de objeto. No es estilo: con un
 * spread, dos piezas que nombren la MISMA columna se pisan —la ultima gana— y el recorte del
 * alcance podria quedar sustituido por el filtro del cliente. Hoy eso seria inocuo porque la
 * 122 ya interseco los dos (`recortarFiltro`), pero apoyarse en esa coincidencia es apoyarse
 * en una feature ajena para sostener la frontera multi-tenant. Con `AND` las dos condiciones
 * se cumplen a la vez y el orden deja de importar.
 */
function whereDeConsulta(consulta: ConsultaAnalitica): Prisma.AnalyticsDailyWhereInput {
  const { filtro, rango } = consulta;
  return {
    AND: [
      whereRollup(consulta.alcance),
      ...(filtro.zona_id ? [{ zonaId: { in: [...filtro.zona_id] } }] : []),
      ...(filtro.tienda_id ? [{ tiendaId: { in: [...filtro.tienda_id] } }] : []),
      ...(filtro.mensajero_id ? [{ mensajeroId: { in: [...filtro.mensajero_id] } }] : []),
      { fecha: { gte: fechaComoDate(rango.desdeFecha), lte: fechaComoDate(rango.hastaFecha) } },
    ],
  };
}

/** Fila cruda del `groupBy`: solo lo que este archivo necesita leer de ella. */
interface FilaAgrupada {
  fecha: Date;
  zonaId?: string;
  tiendaId?: string;
  mensajeroId?: string | null;
  estatusId?: string;
  causaDevolucion?: GestionCausaDevolucion | null;
  _sum: Partial<Record<keyof typeof MEDIDAS_DEL_CUBO, number | bigint | null>>;
}

function proyectarCubo(fila: FilaAgrupada, pedidas: ReadonlySet<Coordenada>): CuboRollup {
  const s = fila._sum;
  return {
    // `analytics_daily.fecha` es `@db.Date` = medianoche UTC de la fecha calendario CR
    // (convencion de la feature 46). El `slice(0, 10)` la devuelve tal cual y NO desplaza:
    // pasarla por `fechaCalendarioCR` restaria seis horas y daria el dia ANTERIOR.
    fecha: fila.fecha.toISOString().slice(0, 10),
    zonaId: pedidas.has("zonaId") ? (fila.zonaId ?? DIMENSION_AGREGADA) : DIMENSION_AGREGADA,
    tiendaId: pedidas.has("tiendaId") ? (fila.tiendaId ?? DIMENSION_AGREGADA) : DIMENSION_AGREGADA,
    // R8 — el `null` del rollup SOBREVIVE: es el cubo sin asignar, no una ausencia de dato.
    mensajeroId: pedidas.has("mensajeroId") ? (fila.mensajeroId ?? null) : DIMENSION_AGREGADA,
    estatusId: pedidas.has("estatusId") ? (fila.estatusId ?? DIMENSION_AGREGADA) : DIMENSION_AGREGADA,
    // R15 — el `null` es «devolucion sin causa tipificada» y tampoco se descarta.
    causaDevolucion: pedidas.has("causaDevolucion")
      ? (fila.causaDevolucion ?? null)
      : DIMENSION_AGREGADA,
    ordenesCreadas: entero(s.ordenesCreadas),
    ordenesEstadoStock: entero(s.ordenesEstadoStock),
    entregas: entero(s.entregas),
    devoluciones: entero(s.devoluciones),
    rechazos: entero(s.rechazos),
    reprogramaciones: entero(s.reprogramaciones),
    incidentes: entero(s.incidentes),
    primerIntentoOk: entero(s.primerIntentoOk),
    segCicloAcum: grande(s.segCicloAcum),
    segCicloN: entero(s.segCicloN),
  };
}

function entero(valor: number | bigint | null | undefined): number {
  return valor === null || valor === undefined ? 0 : Number(valor);
}

function grande(valor: number | bigint | null | undefined): bigint {
  return valor === null || valor === undefined ? BigInt(0) : BigInt(valor);
}
