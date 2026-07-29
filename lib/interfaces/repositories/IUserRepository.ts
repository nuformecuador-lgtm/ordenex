import type { EstadoUsuario, RolValue } from "@prisma/client";
import type { MensajeroDTO } from "@/lib/types/mensajero";
import type { UsuarioPorRolDTO } from "@/lib/types/usuario-por-rol";
import type { CuentaTiendaDTO } from "@/lib/types/filtros-ordenes";

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
  // Feature 27/R14: flag de fulfillment de la tienda (solo `true` para adminTienda,
  // invariante R4a). Se expone en la forma publica para el prefill de la UI.
  fulfillment: boolean;
  // Feature 24/R27: zona asignada (solo mensajero/adminSatelite; null en el resto).
  zonaId?: string | null;
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
  // Feature 27/R8/R9: flag de fulfillment; el repo mapea `?? false` al persistir.
  fulfillment?: boolean;
  // Feature 24/R27: zona (valor efectivo ya resuelto por el service).
  zonaId?: string | null;
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
  // Feature 27/R12: valor efectivo ya resuelto por el service (invariante R4a).
  fulfillment?: boolean;
  // Feature 24/R27: zona (valor efectivo ya resuelto por el service).
  zonaId?: string | null;
}

// Feature 25/R29: catalogo de tipos de identificacion para poblar el select.
export interface TipoIdentificacionItem {
  id: string;
  value: string;
}

// Feature 25: catalogo de roles para poblar el select (par id/value que la UI
// necesita porque `rolId` es el UUID del rol, no su `value`).
export interface RolItem {
  id: string;
  value: RolValue;
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
   * Estrategia generica: usuarios `activo` del rol pasado, proyectados a
   * `{ id, nombre }` (nunca PII/hash), ordenados por `nombre`.
   */
  listByRol(rolValue: RolValue): Promise<UsuarioPorRolDTO[]>;
  /**
   * Feature 144/B2 (R50/R54): TODAS las cuentas que pueden ser DUEÑAS de una orden
   * (`orden.tienda_id` -> `usuario`): rol `adminTienda` (por sesion) o `apiKey` (por
   * integracion, feature 88).
   *
   * NO filtra por `estado` a proposito (decision (e) del spec): una cuenta inactiva
   * sigue siendo dueña de ordenes historicas, y excluirla las haria imposibles de
   * filtrar. La bandera `activa` viaja en la fila para que la UI la marque; `esApiKey`
   * para que las agrupe aparte (R51). Proyeccion `{id, nombre}` + 2 booleanos: NUNCA
   * email, telefono, cedula ni hash (R54). Orden determinista por nombre (R49).
   */
  listCuentasTienda(): Promise<CuentaTiendaDTO[]>;
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
  /** Feature 25: catalogo `rol` proyectado a id/value, ordenado por `value`. */
  listRoles(): Promise<RolItem[]>;
}
