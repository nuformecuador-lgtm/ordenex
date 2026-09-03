import type { EstadoUsuario, RolValue } from "@prisma/client";
import type { MensajeroDTO } from "@/lib/types/mensajero";
import type { UsuarioPorRolDTO } from "@/lib/types/usuario-por-rol";
import type { CuentaTiendaDTO, MensajeroFiltroDTO } from "@/lib/types/filtros-ordenes";

/** Usuario sin datos sensibles: nunca incluye el hash de la contrasena (R7). */
export interface UsuarioPublico {
  id: string;
  nombre: string;
  // Feature 21: los apellidos son parte de la identidad de la persona (nullable en DB: las
  // cuentas que no son personas —tiendas, API keys— solo tienen `nombre`). Viajan en la forma
  // publica porque hay superficies que pintan la identidad COMPLETA (el pie del sidebar), y
  // recomponerla con una segunda lectura por id seria la misma consulta dos veces.
  primerApellido?: string | null;
  segundoApellido?: string | null;
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
  // Feature 21: vehiculo asociado (solo mensajero; null en el resto). Se expone en
  // la forma publica para el prefill del formulario.
  vehiculoId?: string | null;
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
  /**
   * Pedido humano (2026-08-26): NOMBRE de la zona asignada, o `null` si no tiene. Viaja el
   * nombre y no el `zonaId` porque el listado lo PINTA: mandar el uuid obligaria a la tabla a
   * resolverlo por su cuenta, con una segunda lectura que nadie mas necesita.
   *
   * `null` es la mayoria de las filas y no es un error: solo `mensajero` y `adminSatelite`
   * conservan zona (feature 24/R27). La tabla lo pinta como «-».
   */
  zonaNombre: string | null;
  createdAt: Date;
}

// Feature 25/R13/R15: parametros del listado paginado. `sortBy` llega como
// string desde el borde y el repositorio lo valida contra su lista blanca (R15).
//
// Feature 285: gana el filtro del listado. Los nombres son DE DOMINIO, no de transporte
// (`busqueda`/`roles`, no `q`/`rol`): la traduccion clave-publica -> concepto interno la hace
// el servicio, que es donde se hace en el resto del repo.
export interface ListUsuariosParams {
  skip: number;
  take: number;
  sortBy?: string;
  sortDir?: "asc" | "desc";
  /**
   * Feature 285/R2/R4/R5/R6: fragmento a buscar en NOMBRE o CORREO. Llega YA RECORTADO por el
   * borde (el schema aplica `.trim()` antes del minimo). El repositorio es quien escapa sus
   * comodines: aqui viaja el texto tal cual lo tecleo la persona.
   */
  busqueda?: string;
  /**
   * Feature 285/R13/R14: roles admitidos, por VALOR del enum. **NUNCA una lista vacia**:
   * ausente = sin filtro. El borde la rechaza con `.nonempty()` para que `[]` no pueda
   * degradar a "todos" y devolver de mas.
   */
  roles?: RolValue[];
}

export interface ListUsuariosResult {
  items: UsuarioListItem[];
  total: number;
}

// Feature 25/R16: solo los campos editables por el maestro. NUNCA email, cedula
// ni passwordHash (Decision 5, firmada el 2026-07-10).
//
// ⚠️ DECISION 5 — ACOTADA Y PARCIALMENTE REVERTIDA EL 2026-08-26 (feature 287,
// specs/287-maestro-restablece-contrasena). Se revierte SOLO su clausula de alcance
// («Reset de contrasena desde edicion: FUERA de alcance»): desde esa fecha el maestro
// SI puede RESTABLECER la contrasena de un usuario.
//
// EL MOTIVO ORIGINAL QUEDA PROTEGIDO, y por eso la reversion es parcial. La Decision 5
// impedia que el maestro pudiera FIJAR una credencial de otra persona —una que el
// conociera de antemano y pudiera reusar en silencio—. Eso sigue INTACTO: el maestro no
// ESCRIBE ninguna contrasena. El sistema la GENERA, se muestra una sola vez y solo se
// persiste su hash. Restablecer no es fijar: ni siquiera el maestro elige que credencial
// queda.
//
// ALCANCE EXACTO DE LO QUE **NO** CAMBIA: este tipo (`UpdateUsuarioData`) sigue SIN
// admitir email, cedula ni passwordHash. El RESTABLECER va por `updatePasswordHash` (ver
// mas abajo), que es un metodo distinto y una operacion propia con su confirmacion; NO
// por `update`. Anadir la contrasena a la via de edicion habria sido revertir la Decision
// 5 entera y convertir un campo hoy imposible de tocar por error en uno mas del
// formulario.
export interface UpdateUsuarioData {
  nombre?: string;
  telefono?: string;
  rolId?: string;
  tipoIdentificacionId?: string;
  // Feature 27/R12: valor efectivo ya resuelto por el service (invariante R4a).
  fulfillment?: boolean;
  // Feature 24/R27: zona (valor efectivo ya resuelto por el service).
  zonaId?: string | null;
  // Feature 21: vehiculo (valor efectivo ya resuelto por el service).
  vehiculoId?: string | null;
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
  /** FICHA 362 (R3/R9): `actorUsuarioId` congela QUIEN dio de alta la cuenta. */
  create(input: CreateUsuarioInput, actorUsuarioId: string | null): Promise<UsuarioPublico>;
  /**
   * Feature 20/R9: persiste un nuevo hash de contrasena en `Usuario`. No
   * devuelve el hash. Usado por el reset de contrasena tras validar el OTP.
   *
   * Feature 287 (2026-08-26): AHORA TAMBIEN LO USA EL MAESTRO. Es la unica via por la que la
   * contrasena de un usuario puede cambiar desde el modulo de usuarios —`update` sigue sin
   * admitirla (ver la nota de la Decision 5 sobre `UpdateUsuarioData`)—, y por eso el
   * restablecimiento del maestro se apoya en este metodo en vez de ensanchar la edicion.
   * Los dos caminos que lo llaman son independientes entre si: el de la feature 20 exige un OTP
   * por correo, el de la 287 exige sesion + rol `maestro` y NO toca el correo en ningun paso.
   */
  updatePasswordHash(usuarioId: string, passwordHash: string): Promise<void>;
  /**
   * FICHA 362 (R5/R9) — el restablecimiento que hace un ADMINISTRADOR sobre la cuenta de otro,
   * con su fila de registro en la misma transaccion. Va aparte de `updatePasswordHash` porque
   * ese metodo lo comparte el auto-servicio (el usuario cambia SU propia clave), que el Anexo A
   * no lista. Ni el hash ni la clave entran en la fila.
   */
  restablecerContrasena(
    usuarioId: string,
    passwordHash: string,
    actorUsuarioId: string | null,
  ): Promise<void>;
  /**
   * Feature 16/R1/R2/R3: usuarios con rol `mensajero` y `estado = activo`,
   * proyectados a `{ id, nombre }` (nunca PII/hash), ordenados por `nombre`.
   */
  listMensajeros(): Promise<MensajeroDTO[]>;
  /**
   * Pedido humano (2026-08-25): los mensajeros del FILTRO de `/ordenes`, proyectados a
   * `{ id, nombre, zonaId }` (nunca PII) y ordenados por `nombre` (orden determinista, R49).
   *
   * Dos diferencias deliberadas con `listMensajeros`, y las dos vienen de que esto es un
   * catalogo de FILTRO y no un selector de asignacion:
   *   - FILTRA por `estado` con `ESTADOS_USUARIO_NO_ASIGNABLES` (ficha 351), no con
   *     `= activo`: deja fuera a `inactivo` y `bloqueado` y sigue ofreciendo a `pendiente`,
   *     que hoy puede ser el asignado de ordenes vivas. `listMensajeros` exige `activo`
   *     porque alimenta otra cosa (ranking y carga masiva);
   *   - acepta `zonaId` para ACOTAR la lista a una zona, que es lo que necesita el rol que
   *     solo opera la suya. Sin argumento, devuelve todos.
   *
   * ⚠️ Esto acota el CATALOGO, nunca los DATOS: las ordenes de un mensajero dado de baja
   * siguen saliendo enteras en el listado (ver `OrdenRepository.list`).
   */
  listMensajerosParaFiltro(zonaId?: string): Promise<MensajeroFiltroDTO[]>;
  /**
   * Estrategia generica: usuarios `activo` del rol pasado, proyectados a
   * `{ id, nombre }` (nunca PII/hash), ordenados por `nombre`.
   */
  listByRol(rolValue: RolValue): Promise<UsuarioPorRolDTO[]>;
  /**
   * Feature 144/B2 (R50/R54): las cuentas que pueden ser DUEÑAS de una orden
   * (`orden.tienda_id` -> `usuario`): rol `adminTienda` (por sesion) o `apiKey` (por
   * integracion, feature 88).
   *
   * FICHA 351: ya NO son «todas». Se excluyen las de `ESTADOS_USUARIO_NO_ASIGNABLES`
   * (`inactivo`/`bloqueado`), que es lo contrario de la decision (e) de la 144 y se hizo a
   * peticion explicita del humano — con la separacion que aquella no tenia: se filtra el
   * CATALOGO, no los DATOS. La bandera `activa` viaja en la fila para que la UI la marque
   * (hoy siempre `true`); `esApiKey` para que las agrupe aparte (R51). Proyeccion
   * `{id, nombre}` + 2 booleanos: NUNCA email, telefono, cedula ni hash (R54). Orden
   * determinista por nombre (R49).
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
  /**
   * FICHA 362 (R7/R9): registra `usuario_rol_cambiado`, `usuario_zona_cambiada` y
   * `usuario_fulfillment_cambiado` SOLO cuando el campo cambia de verdad, y las N filas
   * comparten `lote_id`. Editar el telefono no deja rastro.
   */
  update(
    id: string,
    data: UpdateUsuarioData,
    actorUsuarioId: string | null,
  ): Promise<UsuarioPublico | null>;
  /**
   * Feature 25/R20/R21/R22: cambia solo el `estado`; `null` si no existe.
   */
  setEstado(
    id: string,
    estado: EstadoUsuario,
    actorUsuarioId: string | null,
  ): Promise<UsuarioPublico | null>;
  /** Feature 25/R29: catalogo `tipo_identificacion` proyectado a id/value. */
  listTiposIdentificacion(): Promise<TipoIdentificacionItem[]>;
  /** Feature 25: catalogo `rol` proyectado a id/value, ordenado por `value`. */
  listRoles(): Promise<RolItem[]>;
}
