import type { RolValue } from "@prisma/client";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  IAprobacionPostulacionService,
  DecisionServiceResult,
  ListarPendientesServiceResult,
} from "@/lib/interfaces/services/IAprobacionPostulacionService";
import type {
  IAprobacionPostulacionRepository,
  PostulacionRow,
} from "@/lib/interfaces/repositories/IAprobacionPostulacionRepository";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type {
  ListarPostulacionesInput,
  PostulacionPendienteDTO,
} from "@/lib/types/aprobacion-postulacion";
import { aprobacionPostulacionesConfig } from "@/lib/config/aprobacion-postulaciones";

// R2: solo `maestro` y `admin` aprueban/rechazan/listan.
const ROLES_APROBADORES = new Set<RolValue>(["maestro", "admin"]);

/**
 * Feature 22 — logica de negocio de la aprobacion de postulaciones. Autoriza por
 * rol (R2/R3/R5) ANTES de tocar el repo o el Storage, lista pendientes con URLs
 * firmadas (R6-R11) y aplica las transiciones de estado con proteccion
 * anti-carrera (R12-R19). No conoce HTTP ni Prisma.
 */
export class AprobacionPostulacionService implements IAprobacionPostulacionService {
  constructor(
    private readonly repo: IAprobacionPostulacionRepository,
    private readonly signedUrls: ISignedUrlProvider,
    private readonly ttlSeconds: number = aprobacionPostulacionesConfig.SIGNED_URL_TTL_SECONDS,
  ) {}

  async listarPendientes(
    input: ListarPostulacionesInput,
    actor: Actor,
  ): Promise<ListarPendientesServiceResult> {
    // R3/R5: guard antes de acceder a datos o Storage.
    if (!ROLES_APROBADORES.has(actor.rol)) return { status: "forbidden" };

    const { page, pageSize } = input;
    const skip = (page - 1) * pageSize;
    const { items, total } = await this.repo.listPendientes({ skip, take: pageSize });

    const dtos: PostulacionPendienteDTO[] = [];
    for (const row of items) {
      dtos.push(await this.toDTO(row));
    }

    return { status: "ok", items: dtos, page, pageSize, total };
  }

  async aprobar(usuarioId: string, actor: Actor): Promise<DecisionServiceResult> {
    return this.decidir(usuarioId, actor, "activo");
  }

  async rechazar(usuarioId: string, actor: Actor): Promise<DecisionServiceResult> {
    return this.decidir(usuarioId, actor, "inactivo");
  }

  /**
   * Transicion comun aprobar/rechazar. R5: autoriza primero. R12/R16: intenta la
   * actualizacion condicional atomica (solo mensajero + pendiente). Si no aplica
   * (count 0), reconsulta para distinguir R13/R17 (not_found) de R14/R18
   * (conflict). Dos decisiones concurrentes: solo una ve count 1 (anti-carrera).
   */
  private async decidir(
    usuarioId: string,
    actor: Actor,
    estadoDestino: "activo" | "inactivo",
  ): Promise<DecisionServiceResult> {
    if (!ROLES_APROBADORES.has(actor.rol)) return { status: "forbidden" };

    const count = await this.repo.actualizarEstadoSiPendiente(usuarioId, estadoDestino);
    if (count > 0) {
      // R15/R19: solo cambio `estado`; el repo no toca otros campos ni documentos.
      return { status: "ok", usuarioId, estado: estadoDestino };
    }

    // count 0: no era mensajero+pendiente. Distinguir 404 de 409.
    const actual = await this.repo.findMensajeroById(usuarioId);
    if (!actual) return { status: "not_found" }; // R13/R17
    return { status: "conflict" }; // R14/R18: existe pero ya no esta pendiente
  }

  /** Proyecta una fila a DTO firmando las URLs de sus documentos (R8/R9). */
  private async toDTO(row: PostulacionRow): Promise<PostulacionPendienteDTO> {
    const paths = row.documentos.map((d) => d.storagePath);
    const urlByPath =
      paths.length > 0 ? await this.signedUrls.createSignedUrls(paths, this.ttlSeconds) : {};

    return {
      usuarioId: row.usuarioId,
      nombre: row.nombre,
      primerApellido: row.primerApellido,
      segundoApellido: row.segundoApellido,
      email: row.email,
      telefono: row.telefono,
      tipoIdentificacion: row.tipoIdentificacion,
      cedula: row.cedula,
      vehiculo: row.vehiculo,
      placa: row.placa,
      documentos: row.documentos.map((d) => ({
        tipo: d.tipo,
        url: urlByPath[d.storagePath] ?? "",
        expiresInSeconds: this.ttlSeconds,
      })),
    };
  }
}
