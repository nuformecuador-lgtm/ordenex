import type {
  DocumentoTipo,
  PostulacionArchivo,
  PostularMensajeroResult,
} from "@/lib/types/postulacion-mensajero";

// Feature 21 — contrato del servicio de postulacion de mensajero. Logica pura:
// sin HTTP (Request/Response/cookies) ni Prisma directo.

/**
 * Comando ya validado (zod) que consume el servicio. Los campos van en camelCase
 * (dominio); el mapeo desde los nombres snake_case del formulario lo hace la
 * Server Action. `documentos` trae los 5 binarios normalizados (R3/R16).
 */
export interface PostularMensajeroCommand {
  nombre: string;
  primerApellido: string;
  segundoApellido?: string;
  email: string;
  telefono: string;
  tipoIdentificacionId: string;
  cedula: string;
  vehiculoId: string;
  placa: string;
  password: string;
  documentos: Record<DocumentoTipo, PostulacionArchivo>;
}

export interface IPostulacionMensajeroService {
  /**
   * Crea la cuenta mensajero en estado `pendiente` con sus 5 documentos, de
   * forma atomica (R24). No concede sesion (R22).
   */
  postular(command: PostularMensajeroCommand): Promise<PostularMensajeroResult>;
}
