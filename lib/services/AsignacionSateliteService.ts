import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  AsignarSateliteInput,
  AsignarSateliteServiceResult,
  IAsignacionSateliteService,
} from "@/lib/interfaces/services/IAsignacionSateliteService";
import { MSG_ORDEN_REPROGRAMADA_BLOQUEADA } from "@/lib/services/mensajes-bloqueo";
import type { IAsignabilidadCoordenadasService } from "@/lib/interfaces/services/IAsignabilidadCoordenadasService";
import { esAsignable, motivoAsignabilidad } from "@/lib/services/AsignabilidadCoordenadasService";
import { resolverFechaReparto } from "@/lib/utils/dia-reparto";

// Estado de ORIGEN de la asignacion satelite (feature 33) y destino tras asignar
// (feature 17). Esta feature NO agrega estados ni `num_guia` (R8): usa exclusivamente
// estos dos valores de catalogo, ya sembrados.
const ORIGEN_ASIGNACION = "en_bodega_satelite";
const ESTADO_ASIGNADA = "por_recoger";

// Feature 46/R3: estatus bloqueado por reprogramacion (guardia explicito y tipado).
const ESTATUS_REPROGRAMADA = "reprogramada";

// Solo el rol autorizado en el modulo (R1/R13): el adminSatelite, SIEMPRE acotado
// a su propia zona (R2), resuelta server-side por `findUsuarioZonaId`.
const ROL_AUTORIZADO = "adminSatelite";

// Feature 41/R14 RETIRADA (pedido humano 2026-08-18): aqui vivia `mensajero_bloqueado_por_cierre`,
// el motivo con que se rechazaba al mensajero con un cierre abierto o vencido. La guarda se fue y
// el motivo con ella: ya no hay camino por el que este servicio pueda emitirlo.

// Metodos de repo que consume el service (inyeccion por constructor). Se declara
// como Pick para dobles de test sin DB/HTTP (patron RecepcionSateliteService).
type AsignacionSateliteRepo = Pick<
  IOrdenRepository,
  | "findUsuarioZonaId"
  | "findMensajeroIdsValidosByZona"
  | "findByIdsForTransicion"
  | "findEstatusIdByValue"
  | "asignarSateliteLote"
  | "existeBodegaSateliteBloqueada" // feature 41/R18 (hoy: solo la causa (ii), el cierre de la bodega)
  // ⚠️ FEATURE 241: `findMensajerosBloqueadosParaGestion` YA NO FIGURA AQUI, y su ausencia es el
  // mecanismo. Asignar es RECIBIR TRABAJO y eso no se bloquea nunca (regla 2, firmada el
  // 2026-08-20). Mientras el metodo no este en este `Pick`, este service no puede consultarlo
  // aunque el doble de test lo ofrezca: la regla deja de depender de que nadie escriba la llamada.
  | "findParaAsignabilidad" // feature 92/R8: gate de coordenadas
>;

/**
 * Feature 34 — logica de negocio de la asignacion de la bodega satelite. Servicio
 * PARALELO al `GuiaAsignacionService` del maestro (decision F1.4-a): mismo destino
 * (`por_recoger`) pero cableado al adminSatelite (origen
 * `en_bodega_satelite`, zona propia por `findUsuarioZonaId`, escritura guardada por
 * estado+zona). No conoce HTTP ni Prisma; testeable con dobles sin red/DB.
 */
export class AsignacionSateliteService implements IAsignacionSateliteService {
  constructor(
    private readonly repo: AsignacionSateliteRepo,
    // Feature 92 (R8): gate de asignabilidad por coordenadas. REQUERIDA a proposito (mismo
    // motivo que en `GuiaAsignacionService`): opcional se desactivaria en silencio.
    private readonly asignabilidad: IAsignabilidadCoordenadasService,
  ) {}

  /**
   * Feature 246 (T3.2, R2/R3/R5/R7): `now` es el reloj INYECTABLE desde el que se resuelve el dia
   * de reparto, espejo exacto de `GuiaAsignacionService.asignarDesdeBodega` (D4).
   */
  async asignar(
    input: AsignarSateliteInput,
    actor: Actor,
    now: Date = new Date(),
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

    // 3b. Feature 41/R14 RETIRADA (2026-08-18) y FEATURE 241 (2026-08-20): AQUI ESTABA EL FALLO
    //     VIVO, no solo una guarda ausente.
    //
    //     Aqui se rechazaba al mensajero con un cierre abierto. La guarda se retiro... y el
    //     `NOT EXISTS` que `asignarSateliteLote` llevaba dentro del UPDATE crudo NO, con el
    //     criterio de antes. Resultado en produccion: esta pantalla dejaba elegir al mensajero,
    //     el UPDATE tocaba 0 filas y el adminSatelite recibia «Actualiza la lista y vuelve a
    //     intentarlo» — falso, porque las ordenes estaban bien y reintentar no lo arreglaba nunca.
    //     Lectura y escritura afirmando lo contrario sobre la misma accion.
    //
    //     La 241 lo cierra por el lado de la regla: se quito el `NOT EXISTS` del repositorio. Las
    //     DOS comprobaciones dicen ahora lo mismo —asignar no mira cierres— y ese motivo ya no
    //     tiene camino por el que emitirse. El predicado sigue vivo en el repo, pero renombrado a
    //     `findMensajerosBloqueadosParaGestion` y fuera de este `Pick`: es de gestionar y cobrar,
    //     no de asignar.

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

    // 4b. Feature 92/R8: gate de asignabilidad por coordenadas, ANTES de cualquier
    // escritura. Este writer SI asigna mensajero a todo el lote, asi que se evalua entero.
    // Todo-o-nada, con el mismo `detalle` por orden que las demas guardas de este metodo.
    const filas = await this.repo.findParaAsignabilidad(ordenIds);
    const estados = await this.asignabilidad.evaluar(filas);
    const detalleCoords: { ordenId: string; motivo: string }[] = [];
    for (const id of ordenIds) {
      const estado = estados.get(id);
      if (esAsignable(estado)) continue;
      detalleCoords.push({
        ordenId: id,
        // `undefined` = el gate no vio la orden. Nunca se deja pasar por omision.
        motivo: estado === undefined ? "no_encontrada" : motivoAsignabilidad(estado),
      });
    }
    if (detalleCoords.length > 0) return { status: "conflict", detalle: detalleCoords };

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
    // Feature 49/#7 (R15): actor = el adminSatelite; el append cubre solo las ordenes que
    // ganaron la guarda anti-TOCTOU (RETURNING id en la misma tx).
    // Feature 246 (T3.2, R2/R3/R5/R7): la eleccion se resuelve AQUI, una vez, para el lote entero
    // —y con el MISMO helper que la bodega central, que es lo que hace que la regla no dependa de
    // desde que bodega te asignaron (D4)—. `?? "hoy"` = el comportamiento anterior (R4).
    const fechaReparto = resolverFechaReparto(input.dia ?? "hoy", now);

    const count = await this.repo.asignarSateliteLote(
      ordenIds,
      input.mensajeroId,
      zonaId,
      destinoId,
      origenId,
      { actorUsuarioId: actor.usuarioId, origenTipo: "asignacion_satelite" },
      fechaReparto, // R7: en el MISMO `SET` que `asignado_at`
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

    // 7. R7: todas transicionadas a por_recoger.
    return {
      status: "ok",
      resultados: ordenIds.map((ordenId) => ({
        ordenId,
        estado: ESTADO_ASIGNADA as "por_recoger",
      })),
    };
  }
}
