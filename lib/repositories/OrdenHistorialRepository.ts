import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  CambioEstadoEntrada,
  IOrdenHistorialRepository,
  OrdenHistorialTxClient,
} from "@/lib/interfaces/repositories/IOrdenHistorialRepository";
import { appendCambioEstado } from "@/lib/repositories/registrar-cambio-estado";
import type { OrdenHistorialEntradaDTO } from "@/lib/types/orden-historial";

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
    tx: OrdenHistorialTxClient,
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

  /** R24: conteo de transiciones de la orden hacia un destino dado (usa el indice del destino). */
  async contarPorDestino(ordenId: string, estatusDestinoId: string): Promise<number> {
    return this.prisma.ordenHistorialEstado.count({
      where: { ordenId, estatusDestinoId },
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
}
