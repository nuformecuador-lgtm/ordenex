import { Prisma, type EstadoUsuario, type PrismaClient, type RolValue } from "@prisma/client";
import type { UsuarioPorRolDTO } from "@/lib/types/usuario-por-rol";
import { textoConstraintP2002 } from "@/lib/repositories/_shared/prisma-unique";
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
import type { MensajeroDTO } from "@/lib/types/asignacion-mensajero";

type UserPrismaClient = Pick<PrismaClient, "usuario" | "tipoIdentificacion" | "rol">;

const PUBLIC_SELECT = {
  id: true,
  nombre: true,
  email: true,
  telefono: true,
  estado: true,
  cedula: true,
  tipoIdentificacionId: true,
  rolId: true,
  fulfillment: true, // feature 27/R14: expuesto en la forma publica (nunca el hash)
  zonaId: true, // feature 24/R27: zona asignada (mensajero/adminSatelite)
  createdAt: true,
  updatedAt: true,
} as const;

// R14: seleccion del listado; incluye el `value` legible del rol y NUNCA el hash.
const LIST_SELECT = {
  id: true,
  nombre: true,
  email: true,
  estado: true,
  createdAt: true,
  rol: { select: { value: true } },
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
    return this.prisma.usuario.findMany({
      where: { rol: { value: rolValue }, estado: "activo" },
      select: { id: true, nombre: true },
      orderBy: { nombre: "asc" },
    });
  }

  /**
   * Feature 16/R1/R2/R3: solo mensajeros activos, proyectados a id/nombre (sin
   * PII) mas su zona (feature 24/R6, nullable) para que el select del resumen de
   * carga masiva pueda filtrar por la zona de la orden.
   */
  async listMensajeros(): Promise<MensajeroDTO[]> {
    const rows = await this.prisma.usuario.findMany({
      where: { rol: { value: "mensajero" }, estado: "activo" },
      select: { id: true, nombre: true, zonaId: true, zona: { select: { nombre: true } } },
      orderBy: { nombre: "asc" },
    });
    return rows.map((row) => ({
      id: row.id,
      nombre: row.nombre,
      zonaId: row.zonaId,
      zonaNombre: row.zona?.nombre ?? null,
    }));
  }

  /** Feature 25/R13/R14/R15: listado paginado con `rolValue`, sin hash. */
  async list(params: ListUsuariosParams): Promise<ListUsuariosResult> {
    const column = SORT_COLUMN[params.sortBy ?? "createdAt"] ?? "createdAt"; // R15
    const orderBy = { [column]: params.sortDir ?? "desc" } as const;

    const [rows, total] = await Promise.all([
      this.prisma.usuario.findMany({
        select: LIST_SELECT,
        orderBy,
        skip: params.skip,
        take: params.take,
      }),
      this.prisma.usuario.count(),
    ]);

    const items: UsuarioListItem[] = rows.map((row) => ({
      id: row.id,
      nombre: row.nombre,
      email: row.email,
      rolValue: row.rol.value,
      estado: row.estado,
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
