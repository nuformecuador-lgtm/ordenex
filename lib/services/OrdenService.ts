import { NumRemisionDuplicadoError } from "@/lib/interfaces/repositories/IOrdenRepository";
import type {
  IOrdenRepository,
  ListOrdenesWhere,
  UpdateOrdenData,
} from "@/lib/interfaces/repositories/IOrdenRepository";
import type {
  Actor,
  ActualizarOrdenServiceResult,
  BorrarOrdenServiceResult,
  CrearOrdenServiceResult,
  IOrdenService,
  ListarOrdenesServiceResult,
  ObtenerOrdenServiceResult,
} from "@/lib/interfaces/services/IOrdenService";
import type {
  ActualizarOrdenInput,
  CreatedPreset,
  CrearOrdenInput,
  ListarOrdenesInput,
  OrdenFilterInput,
} from "@/lib/types/orden";
import { ordenesConfig } from "@/lib/config/ordenes";
import {
  inicioDelDiaCREnUtc,
  inicioDelDiaSiguienteCREnUtc,
  inicioDeUltimosNDiasCREnUtc,
} from "@/lib/utils/fecha-cr";

// Roles reconocidos por el CRUD (los demas -> forbidden, R24). maestro/admin
// tienen acceso total (R20); adminTienda/mensajero con restriccion (R21/R23).
const KNOWN_ROLES = new Set<string>(["maestro", "admin", "adminTienda", "mensajero"]);

// Feature 63/B2 (R8): mapa EXPLICITO clave-publica-del-filtro -> columna Prisma.
// Es el UNICO punto que conoce el nombre interno de la FK de estado (`estatusId`,
// columna `estatus_id`); la clave publica `status_id` nunca se usa como nombre de
// columna. El schema `.strict()` (lib/types/orden.ts) ya garantiza que solo llegan
// claves de esta whitelist, asi que ninguna columna arbitraria alcanza el `where`.
// Feature 144/B1 (R30/R43): el mapa crece a los cinco catalogos. Las TRES claves
// temporales (`created_preset`/`created_desde`/`created_hasta`) NO estan aqui a
// proposito: no son columnas, se traducen a un rango `createdAt: { gte, lt }`
// calculado server-side (ver `rangoCreacion`).
const FILTER_TO_COLUMN = {
  status_id: "estatusId",
  zona_id: "zonaId",
  tienda_id: "tiendaId",
  provincia_id: "provinciaId",
  canton_id: "cantonId",
  distrito_id: "distritoId",
} as const;

// Dias de cada atajo de antiguedad (R41). El dominio ya lo cierra `CREATED_PRESETS`
// en el schema; este mapa solo traduce el valor a un numero de dias.
const PRESET_DIAS: Record<CreatedPreset, number> = {
  "7d": 7,
  "15d": 15,
  "30d": 30,
  "90d": 90,
};

/**
 * Feature 144 (R41/R42/R43) — bordes temporales del filtro de creacion, calculados
 * SERVER-SIDE en horario de Costa Rica (UTC-6 fijo). Nunca se aceptan instantes del
 * reloj del cliente: solo fechas calendario o un atajo de dominio cerrado.
 *
 *   - atajo "Nd"  -> `gte` = 00:00 CR de hace N-1 dias (N dias calendario incl. hoy).
 *   - `desde: D`  -> `gte` = 00:00 CR de D.
 *   - `hasta: H`  -> `lt`  = 00:00 CR del dia SIGUIENTE a H  => H es INCLUSIVO.
 *   - un solo extremo -> rango abierto por el otro lado.
 *
 * Atajo y rango no pueden coexistir: `ordenFilterSchema` lo rechaza antes (R40).
 * Devuelve `undefined` si no hay ninguna clave temporal (sin filtro, R45).
 */
function rangoCreacion(
  filter: OrdenFilterInput | undefined,
  ahora: Date,
): { gte?: Date; lt?: Date } | undefined {
  if (!filter) return undefined;
  if (filter.created_preset) {
    return { gte: inicioDeUltimosNDiasCREnUtc(PRESET_DIAS[filter.created_preset], ahora) };
  }
  const rango: { gte?: Date; lt?: Date } = {};
  if (filter.created_desde) rango.gte = inicioDelDiaCREnUtc(filter.created_desde);
  if (filter.created_hasta) rango.lt = inicioDelDiaSiguienteCREnUtc(filter.created_hasta);
  return rango.gte || rango.lt ? rango : undefined;
}

export class OrdenService implements IOrdenService {
  /**
   * `ahora` inyectable (feature 144): el atajo de antiguedad (`created_preset`) se
   * calcula contra el reloj del SERVIDOR (R43). Se inyecta solo para que los tests
   * puedan fijar el instante; en produccion nadie lo pasa.
   */
  constructor(
    private readonly repo: IOrdenRepository,
    private readonly ahora: () => Date = () => new Date(),
  ) {}

  async crear(input: CrearOrdenInput, actor: Actor): Promise<CrearOrdenServiceResult> {
    // --- Autorizacion (R19-R24), antes de tocar datos ---
    if (!KNOWN_ROLES.has(actor.rol)) return { status: "forbidden" }; // R24
    if (actor.rol === "mensajero") return { status: "forbidden" }; // R23

    let tiendaId: string;
    if (actor.rol === "adminTienda") {
      // R21/R22: adminTienda solo puede crear para si mismo.
      if (input.tiendaId !== undefined && input.tiendaId !== actor.usuarioId) {
        return { status: "forbidden" }; // R22
      }
      tiendaId = actor.usuarioId; // R21: fuerza tienda propia
    } else {
      // maestro/admin: tienda_id debe venir explicito (R11, FK NOT NULL).
      if (input.tiendaId === undefined) {
        return {
          status: "validation_error",
          fieldErrors: { tiendaId: ["tiendaId es obligatorio"] },
        };
      }
      tiendaId = input.tiendaId;
    }

    // --- Validacion de FKs (estatus + geografia), R26/R12/R27 ---
    const fieldErrors: Record<string, string[]> = {};

    let estatusId: string;
    if (input.estatusId !== undefined) {
      const exists = await this.repo.existsEstatus(input.estatusId);
      if (!exists) fieldErrors.estatusId = ["estatusId no existe en el catalogo"];
      estatusId = input.estatusId;
    } else {
      // N1/R27: default en_bodega_central (configurable) resuelto por value.
      const defaultId = await this.repo.findEstatusIdByValue(
        ordenesConfig.DEFAULT_ESTATUS_VALUE,
      );
      if (defaultId === null) {
        fieldErrors.estatusId = ["estatus por defecto no disponible (seed pendiente)"];
        estatusId = "";
      } else {
        estatusId = defaultId;
      }
    }

    // R14b/R12: zona/provincia/canton NOT NULL y geografia creada vacia; deben
    // existir filas referenciables. distrito opcional.
    const geo = await this.repo.existsGeo({
      zonaId: input.zonaId,
      provinciaId: input.provinciaId,
      cantonId: input.cantonId,
      distritoId: input.distritoId,
    });
    if (!geo.zona) fieldErrors.zonaId = ["zonaId no existe"];
    if (!geo.provincia) fieldErrors.provinciaId = ["provinciaId no existe"];
    if (!geo.canton) fieldErrors.cantonId = ["cantonId no existe"];
    if (!geo.distrito) fieldErrors.distritoId = ["distritoId no existe"];

    if (Object.keys(fieldErrors).length > 0) {
      return { status: "validation_error", fieldErrors }; // R26
    }

    // --- Persistencia ---
    try {
      const orden = await this.repo.create(
        {
          numRemision: input.numRemision,
          estatusId,
          destinatario: input.destinatario,
          telefonoDest: input.telefonoDest,
          tiendaId,
          zonaId: input.zonaId,
          provinciaId: input.provinciaId,
          cantonId: input.cantonId,
          distritoId: input.distritoId ?? null,
          producto: input.producto,
          peso: input.peso,
          notas: input.notas ?? null,
        },
        // Feature 49/#2 (R10/R21/R23): la crea el usuario autenticado; origen null.
        { actorUsuarioId: actor.usuarioId, origenTipo: "creacion_manual" },
      );
      return { status: "ok", orden };
    } catch (error) {
      if (error instanceof NumRemisionDuplicadoError) {
        return { status: "conflict" }; // R28
      }
      throw error;
    }
  }

  async obtener(id: string, actor: Actor): Promise<ObtenerOrdenServiceResult> {
    if (!KNOWN_ROLES.has(actor.rol)) return { status: "forbidden" }; // R24

    const orden = await this.repo.findById(id); // excluye borradas (R34)
    if (!orden) return { status: "not_found" }; // R29

    // R21: adminTienda solo ve las suyas; ajena en lectura -> not_found.
    if (actor.rol === "adminTienda" && orden.tiendaId !== actor.usuarioId) {
      return { status: "not_found" };
    }
    return { status: "ok", orden };
  }

  async listar(
    input: ListarOrdenesInput,
    actor: Actor,
  ): Promise<ListarOrdenesServiceResult> {
    if (!KNOWN_ROLES.has(actor.rol)) return { status: "forbidden" }; // R24

    // Feature 144: ORDEN DE ESCRITURA del `where`, y es lo que garantiza R36/R37:
    //   1) `estatusId` escalar heredado,
    //   2) el `filter` traducido por la whitelist,
    //   3) el ACOTAMIENTO POR ROL, escrito AL FINAL para que PISE lo que el filtro
    //      hubiera puesto. Un filtro nunca amplia el alcance de un rol.
    const where: ListOrdenesWhere = {};
    // R10: el `estatusId` escalar preexistente sigue funcionando (sin regresion).
    if (input.estatusId !== undefined) where.estatusId = input.estatusId;
    // Feature 63/R8/R9: traduce `filter.status_id` a la columna `estatusId` via el
    // mapa explicito. Precedencia (design.md 3.3): si llegan `filter.status_id` y
    // `estatusId` escalar, gana `filter.status_id` (fuente explicita de la feature).
    if (input.filter?.status_id !== undefined) {
      where[FILTER_TO_COLUMN.status_id] = input.filter.status_id;
    }
    // Feature 144/R30/R33/R34: los cinco filtros de catalogo, traducidos por el MISMO
    // mapa explicito. La clave publica nunca se usa como nombre de columna; el schema
    // `.strict()` ya garantiza que solo llegan claves de la whitelist (R31).
    if (input.filter?.zona_id !== undefined) {
      where[FILTER_TO_COLUMN.zona_id] = input.filter.zona_id;
    }
    if (input.filter?.tienda_id !== undefined) {
      where[FILTER_TO_COLUMN.tienda_id] = input.filter.tienda_id;
    }
    if (input.filter?.provincia_id !== undefined) {
      where[FILTER_TO_COLUMN.provincia_id] = input.filter.provincia_id;
    }
    if (input.filter?.canton_id !== undefined) {
      where[FILTER_TO_COLUMN.canton_id] = input.filter.canton_id;
    }
    if (input.filter?.distrito_id !== undefined) {
      where[FILTER_TO_COLUMN.distrito_id] = input.filter.distrito_id;
    }
    // Feature 144/R41/R42/R43: los bordes temporales se calculan AQUI (server-side),
    // no llegan del cliente.
    const createdAt = rangoCreacion(input.filter, this.ahora());
    if (createdAt) where.createdAt = createdAt;
    // REASIGNABLES: predicado compuesto, no columna, asi que no pasa por
    // FILTER_TO_COLUMN; el repositorio lo traduce. Solo acota (nunca amplia), asi que
    // convive sin conflicto con el acotamiento por rol que se escribe debajo.
    if (input.filter?.reasignables) where.reasignables = true;
    // R9/R21 + feature 144/R36: adminTienda sigue acotado a SUS ordenes. Se escribe
    // DESPUES del filtro: si el actor inyecto `filter.tienda_id = [otraTienda]`, este
    // escalar lo SOBRESCRIBE. El filtro de tienda nunca amplia su alcance.
    if (actor.rol === "adminTienda") where.tiendaId = actor.usuarioId;
    // Seguridad: el mensajero solo puede listar SUS asignadas (mensajeroAsignadoId =
    // su usuario). Sin esto, `/ordenes` filtraba el listado COMPLETO al mensajero. Su
    // experiencia normal es /mis-asignaciones; este acotamiento cierra la fuga por si
    // alcanza el listado plano.
    if (actor.rol === "mensajero") where.mensajeroAsignadoId = actor.usuarioId;

    const skip = (input.page - 1) * input.pageSize;
    const { items, total } = await this.repo.list({
      where,
      sortBy: input.sortBy,
      sortDir: input.sortDir,
      skip,
      take: input.pageSize, // ya acotado a MAX_PAGE_SIZE por el schema (R33)
    });

    return {
      status: "ok",
      items,
      page: input.page,
      pageSize: input.pageSize,
      total,
    };
  }

  async actualizar(
    id: string,
    input: ActualizarOrdenInput,
    actor: Actor,
  ): Promise<ActualizarOrdenServiceResult> {
    if (!KNOWN_ROLES.has(actor.rol)) return { status: "forbidden" }; // R24

    // R23/R41: mensajero solo puede tocar estatusId; cualquier otro campo -> forbidden.
    if (actor.rol === "mensajero") {
      const otrosCampos = Object.keys(input).filter((k) => k !== "estatusId");
      if (otrosCampos.length > 0) return { status: "forbidden" };
    }

    const orden = await this.repo.findById(id); // excluye borradas (R34)
    if (!orden) return { status: "not_found" }; // R36

    // R21: adminTienda solo edita las suyas; mutacion de ajena -> forbidden.
    if (actor.rol === "adminTienda" && orden.tiendaId !== actor.usuarioId) {
      return { status: "forbidden" };
    }

    // R38: estatusId nuevo debe existir en el catalogo.
    if (input.estatusId !== undefined) {
      const exists = await this.repo.existsEstatus(input.estatusId);
      if (!exists) {
        return {
          status: "validation_error",
          fieldErrors: { estatusId: ["estatusId no existe en el catalogo"] },
        };
      }
    }

    // R37: aplica solo los campos permitidos por rol; no toca inmutables.
    const data = this.buildUpdateData(input, actor.rol);
    // Feature 49/#11 (R19/R20/R23): si el update cambia `estatus_id`, deja rastro
    // (origenTipo ajuste_estado, actor = usuario autenticado); si no, no registra nada.
    const actualizada = await this.repo.update(id, data, {
      actorUsuarioId: actor.usuarioId,
      origenTipo: "ajuste_estado",
    });
    if (!actualizada) return { status: "not_found" }; // carrera: borrada entre medias
    return { status: "ok", orden: actualizada };
  }

  async borrar(id: string, actor: Actor): Promise<BorrarOrdenServiceResult> {
    if (!KNOWN_ROLES.has(actor.rol)) return { status: "forbidden" }; // R24
    if (actor.rol === "mensajero") return { status: "forbidden" }; // R41

    const orden = await this.repo.findById(id); // excluye ya borradas (R40)
    if (!orden) return { status: "not_found" }; // R40

    // R21: adminTienda solo borra las suyas; ajena -> forbidden.
    if (actor.rol === "adminTienda" && orden.tiendaId !== actor.usuarioId) {
      return { status: "forbidden" };
    }

    const ok = await this.repo.softDelete(id); // R39: soft delete
    if (!ok) return { status: "not_found" };
    return { status: "ok" };
  }

  // R37: para mensajero solo estatusId; para el resto, todos los campos de negocio
  // presentes en el input (id/numGuia/createdAt jamas entran, no estan en el schema).
  private buildUpdateData(
    input: ActualizarOrdenInput,
    rol: Actor["rol"],
  ): UpdateOrdenData {
    if (rol === "mensajero") {
      return input.estatusId !== undefined ? { estatusId: input.estatusId } : {};
    }
    const data: UpdateOrdenData = {};
    if (input.estatusId !== undefined) data.estatusId = input.estatusId;
    if (input.destinatario !== undefined) data.destinatario = input.destinatario;
    if (input.telefonoDest !== undefined) data.telefonoDest = input.telefonoDest;
    if (input.tiendaId !== undefined) data.tiendaId = input.tiendaId;
    if (input.zonaId !== undefined) data.zonaId = input.zonaId;
    if (input.provinciaId !== undefined) data.provinciaId = input.provinciaId;
    if (input.cantonId !== undefined) data.cantonId = input.cantonId;
    if (input.distritoId !== undefined) data.distritoId = input.distritoId;
    if (input.producto !== undefined) data.producto = input.producto;
    if (input.peso !== undefined) data.peso = input.peso;
    if (input.notas !== undefined) data.notas = input.notas;
    return data;
  }
}
