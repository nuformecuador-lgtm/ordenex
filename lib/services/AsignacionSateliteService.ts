import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  AsignarSateliteInput,
  AsignarSateliteServiceResult,
  IAsignacionSateliteService,
} from "@/lib/interfaces/services/IAsignacionSateliteService";

// Estado de ORIGEN de la asignacion satelite (feature 33) y destino tras asignar
// (feature 17). Esta feature NO agrega estados ni `num_guia` (R8): usa exclusivamente
// estos dos valores de catalogo, ya sembrados.
const ORIGEN_ASIGNACION = "en_bodega_satelite";
const ESTADO_ASIGNADA = "en_espera_aceptacion";

// Solo el rol autorizado en el modulo (R1/R13): el adminSatelite, SIEMPRE acotado
// a su propia zona (R2), resuelta server-side por `findUsuarioZonaId`.
const ROL_AUTORIZADO = "adminSatelite";

// Metodos de repo que consume el service (inyeccion por constructor). Se declara
// como Pick para dobles de test sin DB/HTTP (patron RecepcionSateliteService).
type AsignacionSateliteRepo = Pick<
  IOrdenRepository,
  | "findUsuarioZonaId"
  | "findMensajeroIdsValidosByZona"
  | "findByIdsForTransicion"
  | "findEstatusIdByValue"
  | "asignarSateliteLote"
>;

/**
 * Feature 34 — logica de negocio de la asignacion de la bodega satelite. Servicio
 * PARALELO al `GuiaAsignacionService` del maestro (decision F1.4-a): mismo destino
 * (`en_espera_aceptacion`) pero cableado al adminSatelite (origen
 * `en_bodega_satelite`, zona propia por `findUsuarioZonaId`, escritura guardada por
 * estado+zona). No conoce HTTP ni Prisma; testeable con dobles sin red/DB.
 */
export class AsignacionSateliteService implements IAsignacionSateliteService {
  constructor(private readonly repo: AsignacionSateliteRepo) {}

  async asignar(
    input: AsignarSateliteInput,
    actor: Actor,
  ): Promise<AsignarSateliteServiceResult> {
    // 1. R13: revalida el rol antes de tocar datos (defensa en profundidad sobre R1).
    if (actor.rol !== ROL_AUTORIZADO) return { status: "forbidden" };

    // 2. R3: alcance por la zona del adminSatelite (server-side). Sin zona -> sin_zona.
    const zonaId = await this.repo.findUsuarioZonaId(actor.usuarioId);
    if (zonaId === null) return { status: "sin_zona" };

    // 3. R9: el mensajeroId debe ser un usuario rol mensajero de la zona del actor
    // (defensa en profundidad sobre R5), sin efectos si no.
    const mensajerosValidos = await this.repo.findMensajeroIdsValidosByZona(
      [input.mensajeroId],
      zonaId,
    );
    if (!mensajerosValidos.has(input.mensajeroId)) {
      return {
        status: "validation_error",
        fieldErrors: { mensajeroId: ["mensajero_invalido"] },
      };
    }

    const ordenIds = input.ordenIds;

    // 4. R10-R12: precarga (incluye borradas) y valida cada orden. Cualquier motivo
    // -> conflict con detalle por orden, SIN escribir (todo-o-nada).
    const ordenes = await this.repo.findByIdsForTransicion(ordenIds);
    const ordenMap = new Map(ordenes.map((o) => [o.id, o]));
    const detalle: { ordenId: string; motivo: string }[] = [];
    for (const id of ordenIds) {
      const orden = ordenMap.get(id);
      if (!orden || orden.deletedAt !== null) {
        detalle.push({ ordenId: id, motivo: "no_encontrada" }); // R10
        continue;
      }
      if (orden.zonaId !== zonaId) {
        detalle.push({ ordenId: id, motivo: "zona_ajena" }); // R11
        continue;
      }
      if (orden.estatusValue !== ORIGEN_ASIGNACION) {
        detalle.push({ ordenId: id, motivo: `estado_invalido: ${orden.estatusValue}` }); // R12
      }
    }
    if (detalle.length > 0) return { status: "conflict", detalle }; // R10

    // 5. Resuelve estatus origen (guardia) y destino; si falta el seed -> validation_error.
    const [origenId, destinoId] = await Promise.all([
      this.repo.findEstatusIdByValue(ORIGEN_ASIGNACION),
      this.repo.findEstatusIdByValue(ESTADO_ASIGNADA),
    ]);
    if (origenId === null || destinoId === null) {
      return {
        status: "validation_error",
        fieldErrors: { estatus: ["catalogo de estados incompleto (seed pendiente)"] },
      };
    }

    // 6. R7/R14: escritura guardada por estado de origen + zona. NO toca num_guia (R8).
    const count = await this.repo.asignarSateliteLote(
      ordenIds,
      input.mensajeroId,
      zonaId,
      destinoId,
      origenId,
    );

    // R14: si alguna orden cambio de estado/zona entre la lectura y la escritura, el
    // count no cubre el lote -> re-lee y reporta conflict SIN efectos parciales.
    if (count !== ordenIds.length) {
      const actuales = await this.repo.findByIdsForTransicion(ordenIds);
      const actualMap = new Map(actuales.map((o) => [o.id, o]));
      const detalleCarrera: { ordenId: string; motivo: string }[] = [];
      for (const id of ordenIds) {
        const orden = actualMap.get(id);
        if (!orden || orden.deletedAt !== null) {
          detalleCarrera.push({ ordenId: id, motivo: "no_encontrada" });
          continue;
        }
        if (orden.zonaId !== zonaId) {
          detalleCarrera.push({ ordenId: id, motivo: "zona_ajena" });
          continue;
        }
        if (orden.estatusValue !== ORIGEN_ASIGNACION) {
          detalleCarrera.push({ ordenId: id, motivo: "conflict" });
        }
      }
      return { status: "conflict", detalle: detalleCarrera };
    }

    // 7. R7: todas transicionadas a en_espera_aceptacion.
    return {
      status: "ok",
      resultados: ordenIds.map((ordenId) => ({
        ordenId,
        estado: ESTADO_ASIGNADA as "en_espera_aceptacion",
      })),
    };
  }
}
