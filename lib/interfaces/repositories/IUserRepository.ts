import type { EstadoUsuario } from "@prisma/client";
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
  // Feature 21 (postulacion de mensajero): identidad + vehiculo, todos opcionales
  // porque solo aplican a mensajeros (nullable en DB).
  primerApellido?: string | null;
  segundoApellido?: string | null;
  vehiculoId?: string | null;
  placa?: string | null;
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
}
