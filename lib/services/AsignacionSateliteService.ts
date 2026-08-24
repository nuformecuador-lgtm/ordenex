import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  AsignarSateliteInput,
  AsignarSateliteServiceResult,
  IAsignacionSateliteService,
} from "@/lib/interfaces/services/IAsignacionSateliteService";
import {
  MSG_MENSAJERO_BLOQUEADO_POR_CIERRES,
  MSG_ORDEN_REPROGRAMADA_BLOQUEADA,
} from "@/lib/services/mensajes-bloqueo";
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

// FEATURE 271 (2026-08-23): el motivo del rechazo por mensajero bloqueado VUELVE a tener camino, y
// vive COMPARTIDO en `lib/services/mensajes-bloqueo.ts` — el mismo texto que emiten las otras dos
// escrituras de asignacion, porque son la misma regla. Entre el 2026-08-18 y hoy no habia ninguno:
// la guarda se habia retirado y el motivo con ella.

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
  // ⚠️ FEATURE 271 (2026-08-23): EL PREDICADO **VUELVE** A ESTE `Pick`, Y ESO ES EL CAMBIO DE REGLA.
  //
  // La 241 protegia su asimetria con la AUSENCIA: mientras el metodo no estuviera aqui, este service
  // no podia consultarlo aunque el doble de test lo ofreciera, y la regla dejaba de depender de que
  // nadie escribiera la llamada. Resuelta Q1 —el bloqueo alcanza TODO, reparto y recoleccion—, esa
  // ausencia deja de proteger nada y pasa a ser el agujero.
  //
  // El nombre cambio con el alcance: el viejo (`…ParaGestion`) decia PARA QUE bloqueaba; el nuevo
  // dice POR QUE. Si alguien quiere volver a exceptuar esta
  // superficie, tendra que SACARLO de este `Pick` **y** escribir por que — que es exactamente la
  // friccion que se busca.
  | "findMensajerosBloqueadosPorCierres" // feature 271/R29: recibir trabajo nuevo SI se bloquea
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

    // 3b. FEATURE 271 (T4.2, R29/R30) — LA GUARDA DE «MENSAJERO BLOQUEADO POR CIERRES» VUELVE, Y
    //     ESTA ES LA SUPERFICIE DONDE OCURRIO EL INCIDENTE DEL 18/08. Merece releerse entero:
    //
    //     Aqui se rechazaba al mensajero con un cierre abierto. El 2026-08-18 la guarda se retiro...
    //     y el `NOT EXISTS` que `asignarSateliteLote` llevaba dentro del UPDATE crudo NO, con el
    //     criterio de antes. Resultado en produccion: esta pantalla dejaba elegir al mensajero, el
    //     UPDATE tocaba 0 filas y el adminSatelite recibia «Actualiza la lista y vuelve a
    //     intentarlo» — falso, porque las ordenes estaban bien y reintentar no lo arreglaba nunca.
    //     Lectura y escritura afirmando lo contrario sobre la MISMA accion.
    //
    //     La 241 lo cerro quitando el `NOT EXISTS` del repositorio y dejando la regla en «asignar no
    //     mira cierres». El 2026-08-23 el humano revirtio esa regla: acumular dos cierres —o
    //     arrastrar uno re-solicitable— TAMBIEN bloquea recibir trabajo nuevo (Q1). Lo que SOBREVIVE
    //     de la 241 es que un `solicitado` a secas (N=1, V=0) NO bloquea.
    //
    //     ⚠️ EL `NOT EXISTS` **NO** SE REPONE (design §12/A5). La guarda vive AQUI, en el service,
    //     UNA sola vez, y el repositorio sigue sin mirar cierres. Dos escrituras del mismo criterio
    //     en dos capas es LITERALMENTE lo que produjo el incidente: si alguien quiere defensa en
    //     profundidad en el SQL, tendra que reponer el MISMO criterio —que ahora es un CONTEO, no
    //     una lista de estados— y probarlo contra Postgres. Este spec dice que no lo haga.
    //
    //     Todo-o-nada con `detalle` por orden, igual que las demas guardas de este metodo: ninguna
    //     orden cambia de estado (R30).
    const bloqueados = await this.repo.findMensajerosBloqueadosPorCierres([input.mensajeroId]);
    if (bloqueados.has(input.mensajeroId)) {
      return {
        status: "conflict",
        detalle: input.ordenIds.map((ordenId) => ({
          ordenId,
          motivo: MSG_MENSAJERO_BLOQUEADO_POR_CIERRES,
        })),
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
