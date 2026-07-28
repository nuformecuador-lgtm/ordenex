import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  CambioEstadoEntrada,
  IOrdenHistorialRepository,
  OrdenHistorialTxClient,
  OrigenReversionItem,
} from "@/lib/interfaces/repositories/IOrdenHistorialRepository";
import type { JobTxClient } from "@/lib/interfaces/repositories/IJobRepository";
import { appendCambioEstado } from "@/lib/repositories/registrar-cambio-estado";
import {
  ORIGEN_TIPOS_CON_GESTION,
  type OrdenHistorialEntradaDTO,
} from "@/lib/types/orden-historial";

// Cliente Prisma acotado a lo que este repo necesita para las LECTURAS (patron
// CierresAdminRepository/WalletMovimientoRepository). Las escrituras van por el `tx`.
// Feature 149: `findOrigenesReversion` necesita `$queryRaw` (DISTINCT ON no se expresa con el
// query builder de Prisma). Se ensancha el Pick, no la semantica: el cliente real ya lo tiene.
type OrdenHistorialPrismaClient = Pick<PrismaClient, "ordenHistorialEstado" | "$queryRaw">;

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
    tx: OrdenHistorialTxClient & JobTxClient,
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
   * R24 (49) + feature 67/R23-R26: conteo de transiciones VIGENTES de la orden hacia un
   * destino dado (usa el indice `(orden_id, estatus_destino_id)`; el join a `gestion_orden` es
   * por PK sobre un punado de filas).
   *
   * El historial es append-only e INMUTABLE (49/R2): la exclusion de los intentos anulados es
   * un filtro de LECTURA, no una escritura (67/R23). El predicado discrimina por `origen_tipo`
   * y NO por la nulidad del enlace, porque `gestion_orden_id IS NULL` es AMBIGUO (design 64
   * §4.1): significa a la vez "nunca vino de una gestion" y "la gestion se borro y la FK vacio
   * el enlace". Ante la duda, la HUERFANA no cuenta: contar de menos = mas intentos que el
   * minimo legal (inofensivo); contar de mas = escalar antes de tiempo a `rechazada` y cobrar
   * `cobroRechazado` (56) mal.
   */
  async contarPorDestinoVigentes(ordenId: string, estatusDestinoId: string): Promise<number> {
    return this.prisma.ordenHistorialEstado.count({
      where: {
        ordenId,
        estatusDestinoId,
        OR: [
          // R25: la transicion NUNCA vino de una gestion (p. ej. `ajuste_estado` de un admin)
          // -> no es anulable por esta feature -> SIEMPRE cuenta.
          { gestionOrdenId: null, origenTipo: { notIn: [...ORIGEN_TIPOS_CON_GESTION] } },
          // R24: vino de una gestion -> cuenta SOLO si esa gestion sigue VIGENTE (no anulada).
          // R26: una fila de la familia gestion SIN enlace es HUERFANA y no casa ninguna de las
          // dos ramas -> no cuenta.
          { gestion: { anuladaAt: null } },
        ],
      },
    });
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
}
