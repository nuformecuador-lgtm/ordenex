import type { CreateUsuarioInput } from "@/lib/interfaces/repositories/IUserRepository";
import type { MensajeroDocumentoInput } from "@/lib/interfaces/repositories/IMensajeroDocumentoRepository";

// Feature 21 — contrato de escritura atomica de la postulacion. Consolida las
// consultas de catalogo/unicidad y la creacion transaccional (usuario + 5 docs)
// en la capa de repositorio, donde vive Prisma, para que el servicio quede puro
// (sin $transaction ni Prisma directo). La atomicidad (R24) es el motivo de que
// usuario + documentos se escriban por un unico metodo.

export interface IPostulacionRepository {
  /** R19: true si el email ya pertenece a un usuario. */
  emailExiste(email: string): Promise<boolean>;
  /** R20: true si la cedula ya pertenece a un usuario. */
  cedulaExiste(cedula: string): Promise<boolean>;
  /** R15: resuelve el id del rol por su valor (p. ej. "mensajero"); null si no existe. */
  findRolIdByValue(value: string): Promise<string | null>;
  /** R9: true si el tipo de identificacion existe en el catalogo. */
  tipoIdentificacionExiste(id: string): Promise<boolean>;
  /** R9: true si el vehiculo existe en el catalogo. */
  vehiculoExiste(id: string): Promise<boolean>;
  /**
   * R12/R13/R16/R21/R24: crea el usuario mensajero (estado default `pendiente`)
   * con el `id` provisto (el mismo bajo el que ya se subieron los documentos) y
   * sus 5 documentos, todo en una unica transaccion. Mapea la violacion de
   * unicidad (P2002) a UsuarioDuplicadoError('email'|'cedula').
   */
  crearMensajeroConDocumentos(
    usuario: CreateUsuarioInput & { id: string },
    documentos: MensajeroDocumentoInput[],
  ): Promise<{ id: string }>;
}
