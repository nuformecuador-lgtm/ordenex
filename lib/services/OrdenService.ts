import { NumRemisionDuplicadoError } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IOrdenRepository, UpdateOrdenData } from "@/lib/interfaces/repositories/IOrdenRepository";
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
  CrearOrdenInput,
  ListarOrdenesInput,
} from "@/lib/types/orden";
import { ordenesConfig } from "@/lib/config/ordenes";

// Roles reconocidos por el CRUD (los demas -> forbidden, R24). maestro/admin
// tienen acceso total (R20); adminTienda/mensajero con restriccion (R21/R23).
const KNOWN_ROLES = new Set<string>(["maestro", "admin", "adminTienda", "mensajero"]);

// Feature 63/B2 (R8): mapa EXPLICITO clave-publica-del-filtro -> columna Prisma.
// Es el UNICO punto que conoce el nombre interno de la FK de estado (`estatusId`,
// columna `estatus_id`); la clave publica `status_id` nunca se usa como nombre de
// columna. El schema `.strict()` (lib/types/orden.ts) ya garantiza que solo llegan
// claves de esta whitelist, asi que ninguna columna arbitraria alcanza el `where`.
const FILTER_TO_COLUMN = { status_id: "estatusId" } as const;

export class OrdenService implements IOrdenService {
  constructor(private readonly repo: IOrdenRepository) {}

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

    const where: {
      tiendaId?: string;
      // Un id o una lista de ids (filtro multi-estado); el repositorio traduce
      // la lista a `IN (...)`.
      estatusId?: string | string[];
      mensajeroAsignadoId?: string;
    } = {};
    // R10: el `estatusId` escalar preexistente sigue funcionando (sin regresion).
    if (input.estatusId !== undefined) where.estatusId = input.estatusId;
    // Feature 63/R8/R9: traduce `filter.status_id` a la columna `estatusId` via el
    // mapa explicito. Precedencia (design.md 3.3): si llegan `filter.status_id` y
    // `estatusId` escalar, gana `filter.status_id` (fuente explicita de la feature).
    if (input.filter?.status_id !== undefined) {
      where[FILTER_TO_COLUMN.status_id] = input.filter.status_id;
    }
    // R9/R21: adminTienda sigue acotado a SUS ordenes; el filtro por estado COMPONE
    // con este alcance por rol (ambas condiciones en el mismo `where`), no lo pisa.
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
