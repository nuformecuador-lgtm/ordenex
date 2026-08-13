import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  CambioEstadoEntrada,
  IOrdenHistorialRepository,
  OrigenReversionItem,
  RecoleccionHistorialRow,
} from "@/lib/interfaces/repositories/IOrdenHistorialRepository";
import {
  appendCambioEstado,
  type ChokePointTx,
} from "@/lib/repositories/registrar-cambio-estado";
import { RESULTADOS_QUE_CUENTAN_COMO_INTENTO } from "@/lib/types/gestion-orden";
import {
  ORIGEN_TIPOS_VISITA_REAL,
  type OrdenHistorialEntradaDTO,
} from "@/lib/types/orden-historial";

// Cliente Prisma acotado a lo que este repo necesita para las LECTURAS (patron
// CierresAdminRepository/WalletMovimientoRepository). Las escrituras van por el `tx`.
// Feature 149: `findOrigenesReversion` necesita `$queryRaw` (DISTINCT ON no se expresa con el
// query builder de Prisma). Se ensancha el Pick, no la semantica: el cliente real ya lo tiene.
// Feature 215 (design §3.1): el conteo de intentos deja de derivarse del historial y pasa a
// derivarse de `gestion_orden`. Se ensancha el Pick, no la semantica del repo: el cliente real
// ya lo tiene, y los metodos de conteo se quedan AQUI a proposito (opcion (a) del design §3.1:
// cero churn en los 11 call-sites; moverlos a un modulo propio es deuda NOMBRADA para otro PR,
// porque mezclar el cambio de significado con un refactor de superficie deja al reviewer sin
// diff legible).
type OrdenHistorialPrismaClient = Pick<
  PrismaClient,
  "ordenHistorialEstado" | "gestionOrden" | "$queryRaw"
>;

// Fila cruda de `findOrigenesReversion`. `value` NULL = la fila de historial mas reciente con
// ese destino tiene `estatus_origen_id` NULL (creacion) -> el service rechaza (R13).
interface OrigenReversionRow {
  orden_id: string;
  value: string | null;
}

// Fila del historial con los `value` de estado origen/destino y el `nombre` del actor
// incluidos (para el DTO legible). NO expone UUIDs internos fuera de lo mostrado (R28).
const WITH_LABELS = {
  include: {
    estatusOrigen: { select: { value: true } },
    estatusDestino: { select: { value: true } },
    actor: { select: { nombre: true } },
  },
} as const;

type HistorialRow = Prisma.OrdenHistorialEstadoGetPayload<typeof WITH_LABELS>;

// Feature 167 (design §5.3) — familia de historial que deja la confirmacion de la recoleccion
// en tienda (`RecoleccionTiendaService` la escribe en su append, arista #43). Es la UNICA
// fuente estable de "lo que YO recolecte hoy": el estado actual de la orden ya cambio en cuanto
// la bodega central la recibio (138).
const ORIGEN_TIPO_RECOLECCION_TIENDA = "recoleccion_tienda" as const;

// Feature 167 — proyeccion MINIMA de una recoleccion ya hecha: la fila de historial aporta el
// instante y la orden aporta como nombrarla. Ni monto, ni coordenadas, ni el estado actual: la
// lista es un acuse de trabajo hecho, no una superficie operativa (R38).
const WITH_RECOLECCION = {
  select: {
    ordenId: true,
    createdAt: true,
    orden: {
      select: {
        numGuia: true,
        numRemision: true,
        tienda: { select: { nombre: true } },
      },
    },
  },
} as const;

type RecoleccionRow = Prisma.OrdenHistorialEstadoGetPayload<typeof WITH_RECOLECCION>;

// R26/R28: serializa una fila a DTO legible. `estatusOrigenValue` NULL = creacion (R1/R20);
// `actorNombre` NULL = sistema/cron (R21); `motivo` NULL cuando no viene de una gestion (R22).
function toEntradaDTO(row: HistorialRow): OrdenHistorialEntradaDTO {
  return {
    estatusOrigenValue: row.estatusOrigen?.value ?? null,
    estatusDestinoValue: row.estatusDestino.value,
    origenTipo: row.origenTipo,
    actorNombre: row.actor?.nombre ?? null,
    motivo: row.motivo,
    createdAt: row.createdAt,
  };
}

/**
 * Feature 215 (T20) — el filtro de orden del predicado de intentos: un id suelto (lectura
 * individual) o un lote (`{ in: [...] }`). Es la interseccion EXACTA de lo que aceptan
 * `Prisma.GestionOrdenWhereInput["ordenId"]` y `Prisma.OrdenHistorialEstadoWhereInput["ordenId"]`
 * entre las formas que este repo usa, y existe porque el MISMO valor viaja a los DOS modelos: al
 * `where` de `gestion_orden` y, repetido, al `some` de `orden_historial_estado`.
 */
export type FiltroOrdenIntentos = string | { in: string[] };

/**
 * Feature 215 (design §3.1, R1/R3/R5/R29-R32) — PREDICADO UNICO de "intento de entrega", en UNA
 * sola funcion pura que consumen los DOS metodos de conteo (individual y en lote). Que este
 * extraido es lo que impide que el numero de la UI y el que dispara `rechazada` ->
 * `cobroRechazado` (56, dinero real) diverjan por copia-pega.
 *
 * `ordenId` acepta un id suelto (`string`) o un lote (`{ in: [...] }`): es el MISMO where. El
 * tipo es `FiltroOrdenIntentos` y no `Prisma.GestionOrdenWhereInput["ordenId"]` porque el MISMO
 * filtro se reusa dentro del `some` de `historialEstados`, donde el modelo es otro
 * (`OrdenHistorialEstadoWhereInput`): declarar la union exacta que los dos call-sites usan
 * satisface a los dos sin `any` ni doble aserto.
 *
 * El intento ya NO se deriva de destinos de transicion del historial. Se deriva de la GESTION,
 * de su cierre y de su ORIGEN:
 *
 *     conteo(orden) = nº de `cierre_id` DISTINTOS entre las `gestion_orden` tales que
 *         orden_id  = <orden>
 *   AND resultado IN {rechazada, devuelta, reprogramada}   (lista de INCLUSION, R1/R2)
 *   AND anulada_at IS NULL                                 (vigencia, filtro de LECTURA, R5)
 *   AND cierre_id IS NOT NULL
 *   AND cierre.estado = 'aprobado'                         (el instante que suma, D8/R3)
 *   AND EXISTS fila de historial de familia de VISITA REAL (D13/R12/R18-b/R34)
 *
 * Cuatro propiedades de esa expresion, y las cuatro son REQUISITOS, no detalles de query:
 *
 *  - **`DISTINCT cierre_id` ES el grano por ORDEN (R29).** El conteo NO es de gestiones: es de
 *    cierres. Dos gestiones vigentes contables de la misma orden dentro del MISMO cierre
 *    aprobado colapsan a 1. Un `count()` a secas contaria gestiones y violaria R29 — por eso
 *    los dos metodos de abajo usan `groupBy`, no `count`.
 *  - **La suma sobre cierres DISTINTOS ES la acumulacion (R30).** Una orden con resultado
 *    contable en N cierres aprobados distintos cuenta N: acumula sobre todos, no solo sobre el
 *    ultimo. Sin acumulacion ninguna orden alcanzaria el umbral y el escalado quedaria muerto.
 *  - **No se mira `orden.estatus_id` en NINGUN sitio (R31).** El conteo mide el hecho ya
 *    ocurrido, no donde esta la orden ahora: si entre la gestion y la aprobacion del cierre la
 *    orden se reprogramo por la tienda (#22), se libero por SLA (#19/#20) o se recupero a mano
 *    (#23/#24), el resultado sigue contando igual.
 *  - **`estado='aprobado'` + `anulada_at IS NULL` ⇒ MONOTONIA (R32).** El numero nunca baja: un
 *    cierre aprobado no puede salir de `aprobado` (`ESTADOS_RESOLUBLES = ["solicitado"]`,
 *    `CierresAdminRepository.ts:39`; `ESTADOS_REABRIBLES = ["vencido","rechazado"]`, `:44`), y
 *    una gestion con `cierre_id` poblado ya no se puede anular (guarda `cierreId: null` en
 *    `CierreDiaRepository.ts:728`). Ninguna de las dos condiciones puede volverse falsa una vez
 *    verdadera, asi que lo que la anulacion impide es que el conteo LLEGUE A SUBIR, no que baje.
 *
 * SEXTA CONDICION — solo cuentan las gestiones de una VISITA REAL (D13/R34-a). El sistema crea
 * gestiones SINTETICAS que no son visitas de nadie (el escalado del cron SLA y la reprogramacion
 * de escritorio de la tienda) y que entran al cierre del mensajero por la puerta de atras: nacen
 * con `cierre_id: null` y con el `mensajero_id` de la ultima `devuelta` vigente, asi que
 * `CierreDiaRepository.crearCierre` las vincula al siguiente cierre de ese mensajero. Sin esta
 * condicion, al aprobarse ese cierre sumaban +1 cada una: la del escalado incumplia R18-b y la de
 * la tienda incumplia R12 (y, sumada a la `devuelta` real de la misma orden, reproducia el DOBLE
 * CONTEO que `160/R2` evitaba). El discriminador es ESTRUCTURAL, no heuristico —nada de
 * `motivo LIKE 'escalado SLA%'`—: toda gestion se crea en la MISMA transaccion que su fila de
 * `orden_historial_estado`, y esa fila lleva el `origen_tipo` de la familia que la produjo
 * (`gestion` la visita real; `escalado_devuelta_sla` y `reprogramacion_tienda` las sinteticas).
 * La lista es de INCLUSION (`ORIGEN_TIPOS_VISITA_REAL`, R34-c): una familia sintetica futura NO
 * empieza a contar sola.
 *
 * EL `ordenId` REPETIDO DENTRO DEL `some` NO ES DECORATIVO — es RENDIMIENTO, y sin el la ruta
 * caliente del conteo degrada a seq scan. `orden_historial_estado` NO tiene indice por
 * `gestion_orden_id`: los tres que existen son `[ordenId, createdAt]`, `[ordenId,
 * estatusDestinoId]` y `[actorUsuarioId, origenTipo, createdAt]` (`db/schema.prisma:1546-1557`),
 * y la FK **no** crea indice en Postgres. Repitiendo el filtro por `orden_id` dentro del `EXISTS`
 * el planner entra por `@@index([ordenId, createdAt])` y `gestion_orden_id` queda como filtro
 * residual sobre el punado de filas de esa orden. Sin ese truco el `EXISTS` recorre entera una
 * tabla append-only que crece con CADA transicion del sistema. (D7/R27 prohiben la migracion, asi
 * que un indice nuevo sobre `gestion_orden_id` no es una salida disponible aqui: si algun dia el
 * plan lo pidiera, se para y se lleva al humano.)
 *
 * Direccion del error, declarada: con el ancla en `aprobado` el conteo de casi toda orden BAJA
 * respecto del criterio anterior ⇒ el escalado se RETRASA. El riesgo de esta feature no es
 * cobrar de mas, es NO COBRAR (⛔ Q5, abierta, sin mitigacion implementada). La sexta condicion
 * empuja en la MISMA direccion segura, y eso decide el caso limite de R34-d: una gestion LEGADA
 * anterior al historial (feature 49) no tiene fila que la respalde y, por tanto, NO cuenta. Es
 * deliberado: contar de menos retrasa el escalado (inofensivo para la tienda), contar de mas
 * cobra un `cobroRechazado` (56, dinero real) antes de tiempo. Ante ausencia de dato, no se
 * cuenta.
 */
export function whereIntentosVigentes(
  ordenId: FiltroOrdenIntentos,
): Prisma.GestionOrdenWhereInput {
  return {
    ordenId,
    // Lista de INCLUSION (`in`, jamas `notIn`): un `resultado` futuro del enum NO empieza a
    // contar solo. Ver `RESULTADOS_QUE_CUENTAN_COMO_INTENTO` para el porque completo.
    resultado: { in: [...RESULTADOS_QUE_CUENTAN_COMO_INTENTO] },
    // R5: la gestion ANULADA (deshecha) no cuenta. Es un filtro de LECTURA: no se modifica
    // ningun registro para excluirla, y el historial sigue siendo append-only e inmutable.
    anuladaAt: null,
    // La gestion tiene que pertenecer a un cierre... (`cierre_id` se puebla en `crearCierre`,
    // que es a la vez el corte del cron y la solicitud del mensajero)
    cierreId: { not: null },
    // ...y ese cierre tiene que estar APROBADO (D8/R3). `solicitado`, `vencido` y `rechazado`
    // NO cuentan: el corte automatico deja de ser un instante que suma, y lo que suma es la
    // aprobacion posterior del cierre que el corte creo.
    cierre: { estado: "aprobado" },
    // D13/R12/R18-b/R34: la gestion tiene que nacer de una VISITA REAL. El `ordenId` de dentro
    // es el MISMO filtro de fuera, repetido a proposito para que el `EXISTS` entre por
    // `@@index([ordenId, createdAt])` (ver el bloque de rendimiento del JSDoc). `in`, jamas
    // `none`/`notIn`: lista de INCLUSION (R34-c).
    historialEstados: {
      some: { ordenId, origenTipo: { in: [...ORIGEN_TIPOS_VISITA_REAL] } },
    },
  };
}

/**
 * Feature 49 — repositorio del HISTORIAL de estados. SOLO queries Prisma; sin logica de
 * negocio (la autorizacion por rol vive en `OrdenHistorialService`, R27).
 *
 * CONVENCION DEL CHOKE POINT (design §3.3, R6): toda escritura de `orden.estatus_id` DEBE
 * llamar a `registrarCambioEstado` en la MISMA transaccion que hace el cambio de estado.
 * TypeScript no puede forzarlo (11 call-sites en 3 mecanismos, incl. SQL crudo); el
 * inventario cerrado de design §2 + un test por familia + el test de cobertura son la
 * mitigacion. NO agregar un nuevo call-site de escritura de estado sin su append aqui.
 */
export class OrdenHistorialRepository implements IOrdenHistorialRepository {
  constructor(private readonly prisma: OrdenHistorialPrismaClient) {}

  /**
   * R6/R7: append del LOTE de transiciones en la transaccion `tx` (atomico con el cambio de
   * estado). Delega en la funcion pura `appendCambioEstado` (UN solo choke point de append,
   * reutilizado por los 3 repos de escritura de estado sin instanciar esta clase).
   */
  async registrarCambioEstado(
    tx: ChokePointTx,
    entradas: CambioEstadoEntrada[],
  ): Promise<void> {
    await appendCambioEstado(tx, entradas);
  }

  /** R26/R5: linea de tiempo de la orden, orden cronologico (created_at asc), con labels. */
  async findHistorialByOrden(ordenId: string): Promise<OrdenHistorialEntradaDTO[]> {
    const rows = await this.prisma.ordenHistorialEstado.findMany({
      where: { ordenId },
      orderBy: { createdAt: "asc" },
      ...WITH_LABELS,
    });
    return rows.map(toEntradaDTO);
  }

  /**
   * Feature 215 (R1/R3/R8/R29/R30) — conteo de INTENTOS DE ENTREGA de UNA orden: el numero de
   * CIERRES APROBADOS distintos en los que la orden tuvo un resultado de gestion contable y
   * vigente, segun `whereIntentosVigentes`.
   *
   * `groupBy(["cierreId"])` y NO `count()`: el grano es la ORDEN dentro del cierre (R29), asi
   * que dos gestiones vigentes contables de la misma orden en el MISMO cierre aprobado tienen
   * que sumar 1. Un `count()` devolveria 2, escalaria antes de tiempo a `rechazada` y cobraria
   * `cobroRechazado` (56) mal. `.length` sobre los grupos ES el `COUNT(DISTINCT cierre_id)`.
   *
   * Resuelve sobre `@@index([ordenId])` de `gestion_orden` (`db/schema.prisma:791`); el join a
   * `cierre_dia` es por PK sobre un punado de filas.
   *
   * Orden sin gestiones contables -> 0 explicito, no ausencia ni error (R8). Una orden cortada
   * por el cron (`sin_gestionar`) no tiene fila de `gestion_orden` y por tanto cuenta 0 (R33).
   */
  async contarIntentosVigentes(ordenId: string): Promise<number> {
    const rows = await this.prisma.gestionOrden.groupBy({
      by: ["cierreId"],
      where: whereIntentosVigentes(ordenId),
    });
    return rows.length;
  }

  /**
   * Feature 215 (R7/R8/R29/R30) — el MISMO conteo para un LOTE de ordenes, en UNA sola consulta
   * sea cual sea N (`groupBy` por el par `(orden_id, cierre_id)` con el MISMO
   * `whereIntentosVigentes`). El listado de ordenes es paginado en servidor: una consulta por
   * fila seria un N+1 gratuito.
   *
   * El `by` incluye `cierreId` por la MISMA razon que el individual: cada grupo es un cierre
   * aprobado distinto de esa orden, asi que contar GRUPOS por `ordenId` es contar cierres, no
   * gestiones (R29). Agrupar solo por `ordenId` daria el conteo de gestiones y divergiria del
   * numero individual — el bug que R4 (una sola definicion) existe para impedir.
   *
   * Las ordenes sin filas que cumplan el criterio NO aparecen en el Map (Postgres no emite
   * grupos vacios); el llamador aplica `?? 0` (R8). Guarda temprana con `ids` vacio: Map vacio
   * SIN query (R7), patron `OrdenRepository.findMensajerosBloqueados`.
   */
  async contarIntentosVigentesEnLote(ordenIds: string[]): Promise<Map<string, number>> {
    if (ordenIds.length === 0) return new Map(); // R7: ni una consulta
    const rows = await this.prisma.gestionOrden.groupBy({
      by: ["ordenId", "cierreId"],
      where: whereIntentosVigentes({ in: ordenIds }),
    });
    const porOrden = new Map<string, number>();
    for (const r of rows) porOrden.set(r.ordenId, (porOrden.get(r.ordenId) ?? 0) + 1);
    return porOrden;
  }

  /** R27: `true` si la orden tuvo al menos una transicion actuada por `usuarioId`. */
  async existeActuacionDe(ordenId: string, usuarioId: string): Promise<boolean> {
    const found = await this.prisma.ordenHistorialEstado.findFirst({
      where: { ordenId, actorUsuarioId: usuarioId },
      select: { id: true },
    });
    return found !== null;
  }

  /**
   * Feature 149 (design §3.3, R11) — origen de la transicion que se esta deshaciendo, para todo
   * el lote en UNA consulta (sin N+1). `DISTINCT ON (h.orden_id)` + `ORDER BY h.orden_id,
   * h.created_at DESC, h.id DESC` se queda con la fila MAS RECIENTE por orden entre las que
   * tienen como destino el estado ACTUAL de esa orden; el `LEFT JOIN` a `order_status` resuelve
   * el `value` del origen (NULL si la fila es de creacion, R13).
   *
   * El par `(orden_id, estatus_destino_id)` entra como `VALUES` parametrizado: usa el indice
   * existente `@@index([ordenId, estatusDestinoId])` y no concatena SQL a mano.
   *
   * Lectura PURA: la normalizacion (D3') y las guardas de coherencia zona/destino (R14/R15)
   * viven en el service, no aqui.
   */
  async findOrigenesReversion(
    items: readonly OrigenReversionItem[],
  ): Promise<Map<string, string | null>> {
    if (items.length === 0) return new Map();
    const pares = Prisma.join(
      items.map((i) => Prisma.sql`(${i.ordenId}, ${i.estatusActualId})`),
    );
    const rows = await this.prisma.$queryRaw<OrigenReversionRow[]>`
      SELECT DISTINCT ON (h."orden_id")
             h."orden_id" AS orden_id,
             os."value"   AS value
      FROM "orden_historial_estado" h
      JOIN (VALUES ${pares}) AS f(orden_id, estatus_destino_id)
        ON f.orden_id = h."orden_id"
       AND f.estatus_destino_id = h."estatus_destino_id"
      LEFT JOIN "order_status" os ON os."id" = h."estatus_origen_id"
      ORDER BY h."orden_id", h."created_at" DESC, h."id" DESC`;
    return new Map(rows.map((r) => [r.orden_id, r.value ?? null]));
  }

  /**
   * Feature 167 (design §5.3, R24/R25/R26/R28/R29/R32) — «Recolectadas hoy» del mensajero.
   * Query PURA: la ventana `[desde, hasta)` viene YA calculada por el service (R27).
   *
   * El aislamiento REAL de esta lectura es el WHERE: `actorUsuarioId` sale del actor de sesion,
   * nunca de un parametro externo, asi que un mensajero no puede pedir las recolecciones de
   * otro. `orden: { deletedAt: null }` excluye las borradas (R29).
   *
   * NO filtra por `estatus_destino_id` a proposito (R26): la familia `recoleccion_tienda` tiene
   * una sola arista y el estado actual de la orden es irrelevante — una orden ya recibida en la
   * central debe seguir figurando.
   */
  async findRecoleccionesDeActor(
    actorUsuarioId: string,
    desde: Date,
    hasta: Date,
    limite: number,
  ): Promise<RecoleccionHistorialRow[]> {
    if (limite <= 0) return []; // ni una consulta: `take: 0` en Prisma es una consulta inutil
    const rows: RecoleccionRow[] = await this.prisma.ordenHistorialEstado.findMany({
      where: {
        actorUsuarioId,
        origenTipo: ORIGEN_TIPO_RECOLECCION_TIENDA,
        createdAt: { gte: desde, lt: hasta },
        orden: { deletedAt: null }, // R29
      },
      orderBy: { createdAt: "desc" }, // R28: de la mas reciente a la mas antigua
      take: limite,
      ...WITH_RECOLECCION,
    });
    return rows.map((r) => ({
      ordenId: r.ordenId,
      numGuia: r.orden.numGuia,
      numRemision: r.orden.numRemision,
      tiendaNombre: r.orden.tienda.nombre,
      recolectadaAt: r.createdAt,
    }));
  }
}
