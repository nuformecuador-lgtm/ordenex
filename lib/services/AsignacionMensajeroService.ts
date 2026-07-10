// Feature 16 — Orquesta el listado de mensajeros, el resumen del lote recien
// cargado y la asignacion de mensajero_sugerido_id. Logica de negocio pura (sin
// HTTP, sin Prisma directo), inyecta IUserRepository + IOrdenRepository.
import type { IUserRepository } from "@/lib/interfaces/repositories/IUserRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  AsignarMensajeroSugeridoServiceResult,
  IAsignacionMensajeroService,
  ListarMensajerosServiceResult,
  ResumenCargaMasivaServiceResult,
} from "@/lib/interfaces/services/IAsignacionMensajeroService";

function distinct(values: string[]): string[] {
  return [...new Set(values)];
}

export class AsignacionMensajeroService implements IAsignacionMensajeroService {
  constructor(
    private readonly userRepo: IUserRepository,
    private readonly ordenRepo: IOrdenRepository,
  ) {}

  /** R1/R5: adminTienda, maestro, admin -> ok; el resto -> forbidden. */
  async listarMensajeros(actor: Actor): Promise<ListarMensajerosServiceResult> {
    if (actor.rol !== "adminTienda" && actor.rol !== "maestro" && actor.rol !== "admin") {
      return { status: "forbidden" };
    }
    const mensajeros = await this.userRepo.listMensajeros();
    return { status: "ok", mensajeros };
  }

  /** R6/R11: SOLO adminTienda, sobre su propia tienda (tiendaId = actor.usuarioId). */
  async resumenCargaMasiva(
    input: { numRemisiones: string[] },
    actor: Actor,
  ): Promise<ResumenCargaMasivaServiceResult> {
    if (actor.rol !== "adminTienda") return { status: "forbidden" };
    const ordenes = await this.ordenRepo.findResumenByNumRemisiones(
      input.numRemisiones,
      actor.usuarioId,
    );
    return { status: "ok", ordenes };
  }

  /**
   * R12-R18: adminTienda; no-op valido si vacio (R18); valida mensajeros (R13);
   * todo-o-nada por tienda (R14); persiste agrupando por mensajeroId distinto (R15).
   */
  async asignarMensajeroSugerido(
    input: { asignaciones: { ordenId: string; mensajeroId: string }[] },
    actor: Actor,
  ): Promise<AsignarMensajeroSugeridoServiceResult> {
    if (actor.rol !== "adminTienda") return { status: "forbidden" };

    const { asignaciones } = input;
    if (asignaciones.length === 0) return { status: "ok", asignadas: 0 }; // R18

    // R13: todo mensajeroId debe corresponder a un usuario con rol mensajero.
    const mensajeroIds = distinct(asignaciones.map((a) => a.mensajeroId));
    const mensajerosValidos = await this.ordenRepo.findMensajerosByIds(mensajeroIds);
    const invalido = mensajeroIds.find((id) => !mensajerosValidos.has(id));
    if (invalido !== undefined) {
      return {
        status: "validation_error",
        fieldErrors: { mensajeroId: ["mensajeroId no valido"] },
      };
    }

    // R14: todo-o-nada por tienda. Ids ajenos/inexistentes/borrados bajan el
    // count por debajo del total de ordenIds distintos -> forbidden, sin persistir.
    const ordenIds = distinct(asignaciones.map((a) => a.ordenId));
    const count = await this.ordenRepo.countOrdenesDeTienda(ordenIds, actor.usuarioId);
    if (count !== ordenIds.length) return { status: "forbidden" };

    // R15: una actualizacion por cada mensajeroId distinto (updateMany), no una
    // consulta por orden.
    const ordenIdsByMensajero = new Map<string, string[]>();
    for (const a of asignaciones) {
      const bucket = ordenIdsByMensajero.get(a.mensajeroId);
      if (bucket) bucket.push(a.ordenId);
      else ordenIdsByMensajero.set(a.mensajeroId, [a.ordenId]);
    }

    let asignadas = 0;
    for (const [mensajeroId, ids] of ordenIdsByMensajero) {
      asignadas += await this.ordenRepo.asignarMensajeroSugerido(
        distinct(ids),
        mensajeroId,
        actor.usuarioId,
      );
    }

    return { status: "ok", asignadas };
  }
}
