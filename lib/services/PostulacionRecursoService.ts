import type { RolValue } from "@prisma/client";
import { defaultLogger, type ErrorLogger } from "@/lib/errors";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  IPostulacionRecursoRepository,
  PostulacionRecursoRow,
} from "@/lib/interfaces/repositories/IPostulacionRecursoRepository";
import type {
  AtenderPostulacionRecursoServiceResult,
  IPostulacionRecursoService,
  ListarPostulacionesRecursoServiceResult,
  RegistrarPostulacionRecursoResult,
} from "@/lib/interfaces/services/IPostulacionRecursoService";
import {
  notificadorNoOp,
  type PostulacionRecursoNotificador,
} from "@/lib/notificaciones/notificadores";
import type {
  ListarPostulacionesRecursoInput,
  PostulacionRecursoDTO,
  PostulacionRecursoInput,
} from "@/lib/types/postulacion-recurso";

/**
 * R27/R28 — quien ve y quien atiende. MISMO conjunto que autoriza hoy
 * `AprobacionPostulacionService` (`ROLES_APROBADORES`), y no por simetria estetica: es la respuesta
 * a P3 —quien atiende estas postulaciones— y la pantalla donde vive el panel (`/dashboard`) ya es
 * la de aterrizaje de esos dos roles.
 */
const ROLES_ATENCION = new Set<RolValue>(["maestro", "admin"]);

/**
 * Feature 253 (T3.4, design §5) — logica de negocio de la postulacion de vehiculo o bodega.
 *
 * NO conoce HTTP ni Prisma: repositorio, notificador, logger y reloj entran por constructor, asi
 * que se prueba entero con dobles.
 *
 * ⛔ `registrar` NO recibe actor Y ESO ES DELIBERADO: la escritura es PUBLICA y sin sesion (R4).
 * R24 —no se crea cuenta, ni sesion, ni fila en `usuario`— no se cumple con una comprobacion sino
 * por CONSTRUCCION: este service no tiene ninguna referencia a ningun repositorio de usuarios, y
 * su unica dependencia de datos es `IPostulacionRecursoRepository`.
 */
export class PostulacionRecursoService implements IPostulacionRecursoService {
  constructor(
    private readonly repo: IPostulacionRecursoRepository,
    /**
     * D6 — el aviso de la campana. El DEFAULT es el NO-OP: un service construido sin cablear
     * (tipicamente un doble de test) no escribe en `notificacion`. El notificador real lo inyecta
     * el composition root de la Server Action. Mismo criterio que la feature 146.
     */
    private readonly notificar: PostulacionRecursoNotificador = notificadorNoOp,
    private readonly logger: ErrorLogger = defaultLogger,
    private readonly ahora: () => Date = () => new Date(),
  ) {}

  /**
   * R1/R20: persiste la postulacion. La entrada llega YA validada y normalizada por el schema zod
   * del borde (`.trim()` y `.toLowerCase()` son parte de la cadena, no un paso aparte), asi que
   * aqui no se vuelve a recortar: normalizar dos veces en dos sitios es como se consigue que un
   * dia dejen de coincidir. Lo que si hace este metodo es la normalizacion DEFENSIVA del correo,
   * porque es el unico campo cuyo valor guardado tiene una forma exigida por un requisito (R12) y
   * que ademas alimenta la clave del limitador.
   *
   * R2: cualquier fallo del repositorio sale como `{ status: "error" }` —nunca como excepcion— y
   * queda registrado. R19: lo que se registra NO lleva el mensaje, el correo ni el telefono.
   */
  async registrar(input: PostulacionRecursoInput): Promise<RegistrarPostulacionRecursoResult> {
    let postulacionId: string;
    try {
      const fila = await this.repo.crear({
        tipo: input.tipo,
        nombre: input.nombre.trim(),
        telefono: input.telefono.trim(),
        correo: input.correo.trim().toLowerCase(),
        mensaje: input.mensaje.trim(),
      });
      postulacionId = fila.id;
    } catch (error) {
      // No es un `catch` vacio (docs/conventions.md): se registra con el nombre de la operacion y
      // la causa. El texto NO interpola ni un campo de la postulacion (R19).
      this.logger.logError(
        new Error("registro de postulacion de recurso fallo", { cause: error }),
      );
      return { status: "error" };
    }

    // D6 — el aviso va DESPUES de que la fila este escrita y es BEST-EFFORT: el notificador ya
    // absorbe su propio fallo. Si la campana pudiera tumbar esta operacion, un fallo de la
    // campana se leeria en la landing como "no pudimos registrar tu postulacion", que es
    // exactamente la mentira que esta ficha viene a cerrar.
    await this.notificar({ postulacionId, tipo: input.tipo });

    return { status: "ok" };
  }

  /** R27/R28/R30/R33: guard de rol ANTES de tocar datos; ni siquiera se cuenta cuantas hay. */
  async listar(
    input: ListarPostulacionesRecursoInput,
    actor: Actor,
  ): Promise<ListarPostulacionesRecursoServiceResult> {
    if (!ROLES_ATENCION.has(actor.rol)) return { status: "forbidden" };

    const { atendidas, page, pageSize } = input;
    const { items, total } = await this.repo.listar({
      atendidas,
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    return { status: "ok", items: items.map(toDTO), page, pageSize, total };
  }

  /**
   * R27/R28/R31/R32: guard de rol, actualizacion condicional atomica y, si no aplico, reconsulta
   * para distinguir `not_found` de `conflict`. Molde: `AprobacionPostulacionService.decidir`.
   *
   * Dos administradores simultaneos: solo uno ve `count === 1`; el otro NO sobrescribe quien ni
   * cuando, y recibe `conflict`.
   */
  async atender(id: string, actor: Actor): Promise<AtenderPostulacionRecursoServiceResult> {
    if (!ROLES_ATENCION.has(actor.rol)) return { status: "forbidden" };

    const ahora = this.ahora();
    const count = await this.repo.marcarAtendida(id, actor.usuarioId, ahora);
    if (count > 0) return { status: "ok", id, atendidaAt: ahora.toISOString() };

    const actual = await this.repo.findById(id);
    if (actual === null) return { status: "not_found" };
    return { status: "conflict" }; // existe, pero ya estaba atendida
  }
}

/** Proyeccion a DTO: instantes en ISO y el NOMBRE de quien atendio, nunca su id. */
function toDTO(row: PostulacionRecursoRow): PostulacionRecursoDTO {
  return {
    id: row.id,
    tipo: row.tipo,
    nombre: row.nombre,
    telefono: row.telefono,
    correo: row.correo,
    mensaje: row.mensaje,
    createdAt: row.createdAt.toISOString(),
    atendidaAt: row.atendidaAt === null ? null : row.atendidaAt.toISOString(),
    atendidaPor: row.atendidaPorNombre,
  };
}
