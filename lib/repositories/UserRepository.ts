import { Prisma, type EstadoUsuario, type PrismaClient, type RolValue } from "@prisma/client";
import type { UsuarioPorRolDTO } from "@/lib/types/usuario-por-rol";
import { textoConstraintP2002 } from "@/lib/repositories/_shared/prisma-unique";
import { escaparComodinesLike } from "@/lib/utils/escapar-like";
import { NOMBRE_USUARIO_SELECT, nombreCompletoUsuario } from "@/lib/utils/nombre-usuario";
import {
  CatalogoInvalidoError,
  UsuarioDuplicadoError,
  type CreateUsuarioInput,
  type IUserRepository,
  type ListUsuariosParams,
  type ListUsuariosResult,
  type RolItem,
  type TipoIdentificacionItem,
  type UpdateUsuarioData,
  type UsuarioConHash,
  type UsuarioListItem,
  type UsuarioPublico,
} from "@/lib/interfaces/repositories/IUserRepository";
import type { MensajeroDTO } from "@/lib/types/mensajero";
import type { CuentaTiendaDTO, MensajeroFiltroDTO } from "@/lib/types/filtros-ordenes";

type UserPrismaClient = Pick<PrismaClient, "usuario" | "tipoIdentificacion" | "rol">;

const PUBLIC_SELECT = {
  id: true,
  ...NOMBRE_USUARIO_SELECT,
  email: true,
  telefono: true,
  estado: true,
  cedula: true,
  tipoIdentificacionId: true,
  rolId: true,
  fulfillment: true, // feature 27/R14: expuesto en la forma publica (nunca el hash)
  zonaId: true, // feature 24/R27: zona asignada (mensajero/adminSatelite)
  vehiculoId: true, // feature 21: vehiculo asociado (mensajero)
  createdAt: true,
  updatedAt: true,
} as const;

// R14: seleccion del listado; incluye el `value` legible del rol y NUNCA el hash.
const LIST_SELECT = {
  id: true,
  ...NOMBRE_USUARIO_SELECT,
  email: true,
  estado: true,
  createdAt: true,
  rol: { select: { value: true } },
  // Pedido humano (2026-08-26): la zona en el listado. Se pide el NOMBRE por la relacion, no el
  // `zonaId`: es lo que la tabla pinta, y resolverlo aqui evita una segunda lectura en la UI.
  zona: { select: { nombre: true } },
} as const;

// R15: columna de negocio -> columna Prisma (lista blanca). Default `createdAt`.
const SORT_COLUMN: Record<string, "createdAt" | "nombre" | "email" | "estado"> = {
  createdAt: "createdAt",
  nombre: "nombre",
  email: "email",
  estado: "estado",
};

export class UserRepository implements IUserRepository {
  constructor(private readonly prisma: UserPrismaClient) {}

  async findByEmailWithHash(email: string): Promise<UsuarioConHash | null> {
    return this.prisma.usuario.findUnique({ where: { email } });
  }

  async findById(id: string): Promise<UsuarioPublico | null> {
    return this.prisma.usuario.findUnique({ where: { id }, select: PUBLIC_SELECT });
  }

  async findByEmail(email: string): Promise<UsuarioPublico | null> {
    return this.prisma.usuario.findUnique({ where: { email }, select: PUBLIC_SELECT });
  }

  async create(input: CreateUsuarioInput): Promise<UsuarioPublico> {
    // R10: se valida la FK de catalogo explicitamente en vez de depender del
    // codigo de error de Postgres, para dar un error de dominio claro (T017).
    const [tipoIdentificacion, rol] = await Promise.all([
      this.prisma.tipoIdentificacion.findUnique({ where: { id: input.tipoIdentificacionId } }),
      this.prisma.rol.findUnique({ where: { id: input.rolId } }),
    ]);
    if (!tipoIdentificacion) {
      throw new CatalogoInvalidoError("tipoIdentificacionId", input.tipoIdentificacionId);
    }
    if (!rol) {
      throw new CatalogoInvalidoError("rolId", input.rolId);
    }

    try {
      return await this.prisma.usuario.create({
        // Feature 27/R3: `fulfillment` ausente se persiste como `false` (no null).
        data: { ...input, fulfillment: input.fulfillment ?? false },
        select: PUBLIC_SELECT,
      });
    } catch (error) {
      throw mapDuplicadoError(error);
    }
  }

  /** Feature 20/R9: actualiza solo `password_hash`; no expone el hash de vuelta. */
  async updatePasswordHash(usuarioId: string, passwordHash: string): Promise<void> {
    await this.prisma.usuario.update({
      where: { id: usuarioId },
      data: { passwordHash },
    });
  }

  /**
   * Estrategia generica: usuarios `activo` del rol pasado, proyectados a id/nombre
   * (sin PII/hash), ordenados por nombre. Fuente unica de la query; los helpers por
   * rol solo fijan el `rolValue`.
   */
  async listByRol(rolValue: RolValue): Promise<UsuarioPorRolDTO[]> {
    const rows = await this.prisma.usuario.findMany({
      where: { rol: { value: rolValue }, estado: "activo" },
      select: { id: true, ...NOMBRE_USUARIO_SELECT },
      orderBy: { nombre: "asc" },
    });
    // Los apellidos viajan solo para componer el texto: el DTO sigue siendo id/nombre.
    return rows.map((r) => ({ id: r.id, nombre: nombreCompletoUsuario(r) }));
  }

  /**
   * Feature 144/B2 (R50/R54): cuentas dueñas posibles de una orden — roles
   * `adminTienda` y `apiKey` — SIN filtrar por `estado` (las inactivas se incluyen,
   * marcadas por la bandera `activa`). Proyeccion minima: id, nombre y dos booleanos.
   * Nada de email/telefono/cedula/hash.
   */
  async listCuentasTienda(): Promise<CuentaTiendaDTO[]> {
    const rows = await this.prisma.usuario.findMany({
      where: { rol: { value: { in: ["adminTienda", "apiKey"] } } },
      select: { id: true, nombre: true, estado: true, rol: { select: { value: true } } },
      orderBy: { nombre: "asc" }, // R49: orden determinista
    });
    return rows.map((r) => ({
      id: r.id,
      nombre: r.nombre,
      esApiKey: r.rol.value === "apiKey",
      activa: r.estado === "activo",
    }));
  }

  /**
   * Feature 16/R1/R2/R3: solo mensajeros activos, proyectados a id/nombre (sin
   * PII) mas su zona (feature 24/R6, nullable) para que el select del resumen de
   * carga masiva pueda filtrar por la zona de la orden.
   */
  async listMensajeros(): Promise<MensajeroDTO[]> {
    const rows = await this.prisma.usuario.findMany({
      where: { rol: { value: "mensajero" }, estado: "activo" },
      select: {
        id: true,
        ...NOMBRE_USUARIO_SELECT,
        zonaId: true,
        zona: { select: { nombre: true } },
      },
      orderBy: { nombre: "asc" },
    });
    return rows.map((row) => ({
      id: row.id,
      nombre: nombreCompletoUsuario(row),
      zonaId: row.zonaId,
      zonaNombre: row.zona?.nombre ?? null,
    }));
  }

  /**
   * Pedido humano (2026-08-25): mensajeros del FILTRO de `/ordenes` — TODOS (tambien los
   * inactivos, que siguen siendo el asignado de ordenes historicas), con su zona y sin PII.
   * `zonaId` acota la lista a esa zona; sin el, devuelve el pais entero.
   */
  async listMensajerosParaFiltro(zonaId?: string): Promise<MensajeroFiltroDTO[]> {
    const rows = await this.prisma.usuario.findMany({
      where: {
        rol: { value: "mensajero" },
        ...(zonaId !== undefined ? { zonaId } : {}),
      },
      // `estado` viaja para que cada superficie decida a quien ofrece: el historico de
      // conversaciones se queda solo con los `activo`, mientras que `/ordenes` los ofrece a
      // todos —esconder a un mensajero dado de baja volveria inalcanzables las ordenes que
      // todavia tiene en la mano—.
      select: { id: true, ...NOMBRE_USUARIO_SELECT, zonaId: true, estado: true },
      orderBy: { nombre: "asc" }, // R49: orden determinista
    });
    return rows.map((r) => ({
      id: r.id,
      nombre: nombreCompletoUsuario(r),
      zonaId: r.zonaId,
      estado: r.estado,
    }));
  }

  /**
   * Feature 25/R13/R14/R15: listado paginado con `rolValue`, sin hash.
   *
   * Feature 285 (design §3.3): ademas FILTRA por rol y por termino de busqueda. Cuatro
   * decisiones que conviene poder senalar en el codigo:
   *
   * 1. **El `count` recibe EL MISMO objeto `where` que el `findMany`** (R17). Hasta esta
   *    feature era un `count()` a secas, y era correcto porque no habia filtro. En cuanto entra
   *    uno, dejarlo asi pintaria "1-25 de 48" bajo una tabla de 3 filas y —peor— haria que el
   *    tope de la descarga se midiera contra el total SIN filtrar. Es un fallo MUDO: no rompe
   *    ningun test que mire filas, solo miente en el numero.
   * 2. **El `OR` de dos columnas aqui es seguro, y hay que decir por que.** En `/ordenes` esta
   *    prohibido meter el termino en un `OR` porque alli convive con el acotamiento por rol del
   *    actor, y un `OR` mal puesto lo desactivaria. En usuarios NO existe tal acotamiento: el
   *    modulo entero es de `maestro` y no recorta filas por actor. El `OR` es HERMANO del filtro
   *    de rol —`AND (rol …) AND (nombre … OR email …)`—, asi que el rol sigue mandando (R16).
   * 3. **Escapado de comodines** (R5): Prisma interpola el valor de `contains` dentro de
   *    `%valor%` sin escaparlo; sin esto, `"%"` devuelve el listado entero.
   * 4. **`mode: "insensitive"`** (ILIKE) para R4. NO pliega acentos: `jose` no encuentra a
   *    `José` (`jos` si, porque se busca por fragmento). Limitacion aceptada a conciencia en
   *    design §8: plegarlos exigiria columna generada + `pg_trgm` + migracion sobre una tabla
   *    de decenas de filas.
   */
  async list(params: ListUsuariosParams): Promise<ListUsuariosResult> {
    const column = SORT_COLUMN[params.sortBy ?? "createdAt"] ?? "createdAt"; // R15
    const orderBy = { [column]: params.sortDir ?? "desc" } as const;

    // Un solo `where`, construido una vez, usado por la pagina Y por el conteo.
    const termino = params.busqueda ? escaparComodinesLike(params.busqueda) : undefined;
    const where: Prisma.UsuarioWhereInput = {
      ...(params.roles?.length ? { rol: { value: { in: params.roles } } } : {}), // R13/R14
      ...(termino !== undefined
        ? {
            OR: [
              { nombre: { contains: termino, mode: "insensitive" } }, // R2/R4
              { email: { contains: termino, mode: "insensitive" } }, // R2/R4
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.usuario.findMany({
        select: LIST_SELECT,
        orderBy, // R19: el criterio de orden no depende de que haya filtro
        skip: params.skip,
        take: params.take,
        where,
      }),
      this.prisma.usuario.count({ where }), // ⚠️ R17: EL MISMO `where`, no `count()` a secas
    ]);

    const items: UsuarioListItem[] = rows.map((row) => ({
      id: row.id,
      // La tabla de usuarios pinta la identidad completa, no solo el nombre de pila.
      nombre: nombreCompletoUsuario(row),
      email: row.email,
      rolValue: row.rol.value,
      estado: row.estado,
      zonaNombre: row.zona?.nombre ?? null, // sin zona -> null (la tabla pinta «-»)
      createdAt: row.createdAt,
    }));
    return { items, total };
  }

  /** Feature 25/R13: total de usuarios. */
  async count(): Promise<number> {
    return this.prisma.usuario.count();
  }

  /**
   * Feature 25/R16/R18/R19: aplica solo campos editables; valida FK de catalogo
   * (mismo patron que `create`). `null` si el usuario no existe (R17).
   */
  async update(id: string, data: UpdateUsuarioData): Promise<UsuarioPublico | null> {
    // R18: valida las FK de catalogo provistas antes de tocar la fila.
    if (data.tipoIdentificacionId !== undefined) {
      const tipo = await this.prisma.tipoIdentificacion.findUnique({
        where: { id: data.tipoIdentificacionId },
      });
      if (!tipo) throw new CatalogoInvalidoError("tipoIdentificacionId", data.tipoIdentificacionId);
    }
    if (data.rolId !== undefined) {
      const rol = await this.prisma.rol.findUnique({ where: { id: data.rolId } });
      if (!rol) throw new CatalogoInvalidoError("rolId", data.rolId);
    }

    const result = await this.prisma.usuario.updateMany({
      where: { id },
      data: this.toUpdateData(data), // R16: solo campos editables
    });
    if (result.count === 0) return null; // R17

    return this.prisma.usuario.findUnique({ where: { id }, select: PUBLIC_SELECT });
  }

  /** Feature 25/R20/R21/R22: cambia solo el estado; `null` si no existe. */
  async setEstado(id: string, estado: EstadoUsuario): Promise<UsuarioPublico | null> {
    const result = await this.prisma.usuario.updateMany({
      where: { id },
      data: { estado }, // baja logica (R20) / alta (R21): nunca borra la fila
    });
    if (result.count === 0) return null; // R22
    return this.prisma.usuario.findUnique({ where: { id }, select: PUBLIC_SELECT });
  }

  /** Feature 25/R29: catalogo `tipo_identificacion` proyectado a id/value. */
  async listTiposIdentificacion(): Promise<TipoIdentificacionItem[]> {
    return this.prisma.tipoIdentificacion.findMany({
      select: { id: true, value: true },
      orderBy: { value: "asc" },
    });
  }

  /** Feature 25: catalogo `rol` proyectado a id/value, ordenado por `value`. */
  async listRoles(): Promise<RolItem[]> {
    return this.prisma.rol.findMany({
      select: { id: true, value: true },
      orderBy: { value: "asc" },
    });
  }

  private toUpdateData(data: UpdateUsuarioData): Prisma.UsuarioUncheckedUpdateManyInput {
    const out: Prisma.UsuarioUncheckedUpdateManyInput = {};
    if (data.nombre !== undefined) out.nombre = data.nombre;
    if (data.telefono !== undefined) out.telefono = data.telefono;
    if (data.rolId !== undefined) out.rolId = data.rolId;
    if (data.tipoIdentificacionId !== undefined) {
      out.tipoIdentificacionId = data.tipoIdentificacionId;
    }
    if (data.fulfillment !== undefined) out.fulfillment = data.fulfillment; // feature 27/R12
    if (data.zonaId !== undefined) out.zonaId = data.zonaId; // feature 24/R27
    if (data.vehiculoId !== undefined) out.vehiculoId = data.vehiculoId; // feature 21
    return out;
  }
}

/**
 * R4/R5: traduce la violacion de unicidad de Postgres a un error de dominio.
 * Usa `textoConstraintP2002` para disambiguar el campo violado de forma robusta
 * tanto en el motor nativo (`meta.target`) como bajo el driver adapter
 * (`meta.driverAdapterError.cause.originalMessage`). Las constraints reales
 * `usuario_email_key` / `usuario_cedula_key` contienen los substrings buscados.
 */
function mapDuplicadoError(error: unknown): unknown {
  const texto = textoConstraintP2002(error);
  if (texto) {
    if (texto.includes("email")) return new UsuarioDuplicadoError("email");
    if (texto.includes("cedula")) return new UsuarioDuplicadoError("cedula");
  }
  return error;
}
