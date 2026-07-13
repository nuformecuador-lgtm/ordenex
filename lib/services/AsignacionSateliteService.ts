import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  AsignarSateliteInput,
  AsignarSateliteServiceResult,
  IAsignacionSateliteService,
} from "@/lib/interfaces/services/IAsignacionSateliteService";
import { MSG_ORDEN_REPROGRAMADA_BLOQUEADA } from "@/lib/services/mensajes-bloqueo";

// Estado de ORIGEN de la asignacion satelite (feature 33) y destino tras asignar
// (feature 17). Esta feature NO agrega estados ni `num_guia` (R8): usa exclusivamente
// estos dos valores de catalogo, ya sembrados.
const ORIGEN_ASIGNACION = "en_bodega_satelite";
const ESTADO_ASIGNADA = "en_espera_aceptacion";

// Feature 46/R3: estatus bloqueado por reprogramacion (guardia explicito y tipado).
const ESTATUS_REPROGRAMADA = "reprogramada";

// Solo el rol autorizado en el modulo (R1/R13): el adminSatelite, SIEMPRE acotado
// a su propia zona (R2), resuelta server-side por `findUsuarioZonaId`.
const ROL_AUTORIZADO = "adminSatelite";

// Feature 41/R14: motivo accionable cuando el mensajero destino esta bloqueado por un
// cierre pendiente (solicitado/vencido).
const MSG_MENSAJERO_BLOQUEADO = "mensajero_bloqueado_por_cierre";

// Metodos de repo que consume el service (inyeccion por constructor). Se declara
// como Pick para dobles de test sin DB/HTTP (patron RecepcionSateliteService).
type AsignacionSateliteRepo = Pick<
  IOrdenRepository,
  | "findUsuarioZonaId"
  | "findMensajeroIdsValidosByZona"
  | "findByIdsForTransicion"
  | "findEstatusIdByValue"
  | "asignarSateliteLote"
  | "existeBodegaSateliteBloqueada" // feature 41/R18
  | "findMensajerosBloqueados" // feature 41/R14
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

    // 2b. Feature 41/R18 (regla estricta R17): ANTES de cualquier escritura, si la bodega
    // esta bloqueada por CUALQUIERA de las dos causas (cierres de sus mensajeros O su
    // propio CierreBodega pendiente), aborta el lote completo (todo-o-nada). La causa
    // viaja al borde para el mensaje accionable de R22.
    const bloqueo = await this.repo.existeBodegaSateliteBloqueada(zonaId);
    if (bloqueo.bloqueada) {
      return {
        status: "bodega_bloqueada",
        causa: {
          porMensajeros: bloqueo.porMensajeros,
          porCierreBodega: bloqueo.porCierreBodega,
        },
      };
    }

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

    // 3b. Feature 41/R14: mensajero bloqueado por un cierre pendiente (solicitado/vencido)
    // -> sin efectos. Antes de cualquier escritura del lote.
    const mensajerosBloqueados = await this.repo.findMensajerosBloqueados([input.mensajeroId]);
    if (mensajerosBloqueados.has(input.mensajeroId)) {
      return {
        status: "validation_error",
        fieldErrors: { mensajeroId: [MSG_MENSAJERO_BLOQUEADO] },
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
      // Feature 46/R3: orden reprogramada -> bloqueada; motivo tipado (antes del origen).
      if (orden.estatusValue === ESTATUS_REPROGRAMADA) {
        detalle.push({ ordenId: id, motivo: MSG_ORDEN_REPROGRAMADA_BLOQUEADA });
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
