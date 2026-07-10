import type { EstadoUsuario, RolValue } from "@prisma/client";
import type { MensajeroDTO } from "@/lib/types/asignacion-mensajero";

/** Usuario sin datos sensibles: nunca incluye el hash de la contrasena (R7). */
export interface UsuarioPublico {
  id: string;
  nombre: string;
  email: string;
  telefono: string;
  estado: EstadoUsuario;
  cedula: string;
  tipoIdentificacionId: string;
  rolId: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Solo para el flujo interno de verificacion de credenciales (AuthService). */
export interface UsuarioConHash extends UsuarioPublico {
  passwordHash: string;
}

export interface CreateUsuarioInput {
  nombre: string;
  email: string;
  telefono: string;
  passwordHash: string;
  cedula: string;
  tipoIdentificacionId: string;
  rolId: string;
  estado?: EstadoUsuario;
}

/** R10: FK de catalogo (tipo_identificacion_id / rol_id) inexistente. */
export class CatalogoInvalidoError extends Error {
  constructor(
    public readonly campo: "tipoIdentificacionId" | "rolId",
    public readonly valor: string,
  ) {
    super(`Referencia de catalogo invalida: ${campo}=${valor} no existe`);
    this.name = "CatalogoInvalidoError";
  }
}

/** R4/R5: violacion de unicidad de email o cedula. */
export class UsuarioDuplicadoError extends Error {
  constructor(public readonly campo: "email" | "cedula") {
    super(`El campo ${campo} ya esta en uso por otro usuario`);
    this.name = "UsuarioDuplicadoError";
  }
}

// Feature 25/R14: fila del listado de usuarios. Incluye el `value` legible del
// rol (via include) y NUNCA el hash de la contrasena (R24).
export interface UsuarioListItem {
  id: string;
  nombre: string;
  email: string;
  rolValue: RolValue;
  estado: EstadoUsuario;
  createdAt: Date;
}

// Feature 25/R13/R15: parametros del listado paginado. `sortBy` llega como
// string desde el borde y el repositorio lo valida contra su lista blanca (R15).
export interface ListUsuariosParams {
  skip: number;
  take: number;
  sortBy?: string;
  sortDir?: "asc" | "desc";
}

export interface ListUsuariosResult {
  items: UsuarioListItem[];
  total: number;
}

// Feature 25/R16: solo los campos editables por el maestro. NUNCA email, cedula
// ni passwordHash (Decision 5).
export interface UpdateUsuarioData {
  nombre?: string;
  telefono?: string;
  rolId?: string;
  tipoIdentificacionId?: string;
}

// Feature 25/R29: catalogo de tipos de identificacion para poblar el select.
export interface TipoIdentificacionItem {
  id: string;
  value: string;
}

export interface IUserRepository {
  /**
   * Unico metodo que expone el hash de contrasena. Solo debe usarse desde
   * AuthService para verificar credenciales (R7).
   */
  findByEmailWithHash(email: string): Promise<UsuarioConHash | null>;
  findById(id: string): Promise<UsuarioPublico | null>;
  findByEmail(email: string): Promise<UsuarioPublico | null>;
  create(input: CreateUsuarioInput): Promise<UsuarioPublico>;
  /**
   * Feature 20/R9: persiste un nuevo hash de contrasena en `Usuario`. No
   * devuelve el hash. Usado por el reset de contrasena tras validar el OTP.
   */
  updatePasswordHash(usuarioId: string, passwordHash: string): Promise<void>;
  /**
   * Feature 16/R1/R2/R3: usuarios con rol `mensajero` y `estado = activo`,
   * proyectados a `{ id, nombre }` (nunca PII/hash), ordenados por `nombre`.
   */
  listMensajeros(): Promise<MensajeroDTO[]>;
  /**
   * Feature 25/R13/R14/R15: listado paginado con `rolValue`, ordenado por una
   * columna de lista blanca. Nunca proyecta `passwordHash` (R24).
   */
  list(params: ListUsuariosParams): Promise<ListUsuariosResult>;
  /** Feature 25/R13: total de usuarios (soporte del `total` del listado). */
  count(): Promise<number>;
  /**
   * Feature 25/R16/R18/R19: aplica solo los campos editables; valida las FK de
   * catalogo (CatalogoInvalidoError). `null` si el usuario no existe (R17).
   */
  update(id: string, data: UpdateUsuarioData): Promise<UsuarioPublico | null>;
  /**
   * Feature 25/R20/R21/R22: cambia solo el `estado`; `null` si no existe.
   */
  setEstado(id: string, estado: EstadoUsuario): Promise<UsuarioPublico | null>;
  /** Feature 25/R29: catalogo `tipo_identificacion` proyectado a id/value. */
  listTiposIdentificacion(): Promise<TipoIdentificacionItem[]>;
}
