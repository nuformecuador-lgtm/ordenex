import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  CambioEstadoEntrada,
  CriterioIntento,
  IOrdenHistorialRepository,
} from "@/lib/interfaces/repositories/IOrdenHistorialRepository";
import {
  appendCambioEstado,
  type ChokePointTx,
} from "@/lib/repositories/registrar-cambio-estado";
import {
  ORIGEN_TIPOS_CON_GESTION,
  ORIGEN_TIPOS_REPROGRAMADA_INTENTO,
  type OrdenHistorialEntradaDTO,
} from "@/lib/types/orden-historial";

// Cliente Prisma acotado a lo que este repo necesita para las LECTURAS (patron
// CierresAdminRepository/WalletMovimientoRepository). Las escrituras van por el `tx`.
type OrdenHistorialPrismaClient = Pick<PrismaClient, "ordenHistorialEstado">;

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
 * Feature 160 (design §3.2, R1/R2/R4/R5/R6) — PREDICADO UNICO de "intento de entrega vigente",
 * en UNA sola funcion pura que consumen los DOS metodos de conteo (individual y en lote). Que
 * este extraido es lo que impide que el numero de la UI y el que dispara `rechazada` ->
 * `cobroRechazado` (56, dinero real) diverjan por copia-pega.
 *
 * `ordenId` acepta un id suelto (`string`) o un lote (`{ in: [...] }`): es el MISMO where.
 *
 * Se compone de dos condiciones en AND:
 *
 *  1. DESTINO (160/R1) — OR de las dos ramas del criterio:
 *     - rama A: destino `devuelta`, con CUALQUIER `origen_tipo` (comportamiento historico
 *       intacto: incluye `ajuste_estado`, 67/R25). No se endurece: endurecerla reduciria
 *       conteos y retrasaria escalados, y nadie lo pidio.
 *     - rama B: destino `reprogramada` Y `origen_tipo` en la lista de INCLUSION
 *       `ORIGEN_TIPOS_REPROGRAMADA_INTENTO` (= `gestion`, la visita real del mensajero,
 *       arista #13). La reprogramacion de la TIENDA (arista #22, `reprogramacion_tienda`) NO
 *       casa: su intento ya lo aporto la fila `devuelta` vigente de la misma orden (R2).
 *       Se OMITE entera si `criterio.reprogramadaId === null` (catalogo sin `reprogramada`,
 *       R6): sin rama B, no sin conteo.
 *
 *  2. VIGENCIA (67/R24-R26) — EXACTAMENTE el mismo OR de siempre, sin cambios.
 */
export function whereIntentosVigentes(
  ordenId: Prisma.OrdenHistorialEstadoWhereInput["ordenId"],
  criterio: CriterioIntento,
): Prisma.OrdenHistorialEstadoWhereInput {
  // 160/R1: OR de DESTINOS que cuentan. Lista de INCLUSION (design §1.3): lo que no esta
  // declarado aqui NO cuenta, y una familia nueva no empieza a contar sola.
  const destinos: Prisma.OrdenHistorialEstadoWhereInput[] = [
    { estatusDestinoId: criterio.devueltaId }, // rama A
  ];
  if (criterio.reprogramadaId !== null) {
    destinos.push({
      estatusDestinoId: criterio.reprogramadaId, // rama B
      origenTipo: { in: [...ORIGEN_TIPOS_REPROGRAMADA_INTENTO] },
    });
  }
  return {
    ordenId,
    AND: [
      { OR: destinos },
      {
        OR: [
          // 67/R25: la transicion NUNCA vino de una gestion (p. ej. `ajuste_estado` de un
          // admin) -> no es anulable por esta feature -> SIEMPRE cuenta.
          { gestionOrdenId: null, origenTipo: { notIn: [...ORIGEN_TIPOS_CON_GESTION] } },
          // 67/R24: vino de una gestion -> cuenta SOLO si esa gestion sigue VIGENTE (no
          // anulada). 67/R26: una fila de la familia gestion SIN enlace es HUERFANA y no casa
          // ninguna de las dos ramas -> no cuenta.
          { gestion: { anuladaAt: null } },
        ],
      },
    ],
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
   * R24 (49) + feature 67/R23-R26 + feature 160/R1: conteo de INTENTOS DE ENTREGA VIGENTES de
   * UNA orden, segun el criterio compuesto de `whereIntentosVigentes` (usa el indice
   * `(orden_id, estatus_destino_id)`; el join a `gestion_orden` es por PK sobre un punado de
   * filas).
   *
   * El historial es append-only e INMUTABLE (49/R2): la exclusion de los intentos anulados es
   * un filtro de LECTURA, no una escritura (67/R23). El predicado discrimina por `origen_tipo`
   * y NO por la nulidad del enlace, porque `gestion_orden_id IS NULL` es AMBIGUO (design 64
   * §4.1): significa a la vez "nunca vino de una gestion" y "la gestion se borro y la FK vacio
   * el enlace". Ante la duda, la HUERFANA no cuenta: contar de menos = mas intentos que el
   * minimo legal (inofensivo); contar de mas = escalar antes de tiempo a `rechazada` y cobrar
   * `cobroRechazado` (56) mal.
   */
  async contarIntentosVigentes(ordenId: string, criterio: CriterioIntento): Promise<number> {
    return this.prisma.ordenHistorialEstado.count({
      where: whereIntentosVigentes(ordenId, criterio),
    });
  }

  /**
   * Feature 160/R12/R13/R14 — el MISMO conteo para un LOTE de ordenes, en UNA sola consulta
   * (`groupBy` por `orden_id` con el MISMO `whereIntentosVigentes`). El listado de ordenes es
   * paginado en servidor: una consulta por fila seria un N+1 gratuito.
   *
   * Las ordenes sin filas que cumplan el criterio NO aparecen en el Map (Postgres no emite
   * grupos vacios); el llamador aplica `?? 0` (R14). Guarda temprana con `ids` vacio: Map vacio
   * SIN query (R13), patron `OrdenRepository.findMensajerosBloqueados`.
   */
  async contarIntentosVigentesEnLote(
    ordenIds: string[],
    criterio: CriterioIntento,
  ): Promise<Map<string, number>> {
    if (ordenIds.length === 0) return new Map(); // R13: ni una consulta
    const rows = await this.prisma.ordenHistorialEstado.groupBy({
      by: ["ordenId"],
      where: whereIntentosVigentes({ in: ordenIds }, criterio),
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.ordenId, r._count._all]));
  }

  /** R27: `true` si la orden tuvo al menos una transicion actuada por `usuarioId`. */
  async existeActuacionDe(ordenId: string, usuarioId: string): Promise<boolean> {
    const found = await this.prisma.ordenHistorialEstado.findFirst({
      where: { ordenId, actorUsuarioId: usuarioId },
      select: { id: true },
    });
    return found !== null;
  }
}
