import { Prisma, type EstadoApiKey, type PrismaClient } from "@prisma/client";
import { textoConstraintP2002 } from "@/lib/repositories/_shared/prisma-unique";
import {
  CatalogoInvalidoError,
  UsuarioDuplicadoError,
} from "@/lib/interfaces/repositories/IUserRepository";
import type {
  ApiKeyAutenticada,
  ApiKeyListItem,
  CreateApiKeyConUsuarioData,
  IApiKeyRepository,
  ListApiKeysParams,
  ListApiKeysResult,
} from "@/lib/interfaces/repositories/IApiKeyRepository";
import type { ApiKeyPublico } from "@/lib/types/api-key";

type ApiKeyPrismaClient = Pick<
  PrismaClient,
  "apiKey" | "usuario" | "rol" | "tipoIdentificacion" | "$transaction"
>;

/**
 * Forma publica de la key (R19): NUNCA proyecta `key_hash`. Patron `PUBLIC_SELECT` de
 * `UserRepository`, que tampoco proyecta nunca el hash de contrasena.
 */
const PUBLIC_SELECT = {
  id: true,
  identificador: true,
  keyPrefix: true,
  estado: true,
  usuarioId: true,
  createdAt: true,
} as const;

/**
 * Feature 82/R6: seleccion del listado. Hermano de `PUBLIC_SELECT` y con la misma
 * garantia, mas fuerte que una disciplina: `keyHash` NO figura aqui, asi que Prisma ni
 * siquiera lo pide a Postgres. El secreto no se filtra de la respuesta porque nunca
 * llega a salir de la base. `usuario.email` entra por include [D1].
 */
const LIST_SELECT = {
  id: true,
  identificador: true,
  keyPrefix: true,
  estado: true,
  usuarioId: true,
  createdAt: true,
  usuario: { select: { email: true } },
} as const;

/** [D1] Rol de la cuenta dedicada. Se resuelve por lookup, nunca por id hardcodeado. */
const ROL_API_KEY = "apiKey" as const;

/** [D4] Tipo de identificacion del catalogo existente; sin valor nuevo. */
const TIPO_IDENTIFICACION_CEDULA = "cedula";

export class ApiKeyRepository implements IApiKeyRepository {
  constructor(private readonly prisma: ApiKeyPrismaClient) {}

  /**
   * R13: usuario dedicado + api_key en UNA sola transaccion. Sin logica de negocio ni
   * validacion de permisos (eso vive en `ApiKeyService`): aqui solo queries.
   */
  async createConUsuario(data: CreateApiKeyConUsuarioData): Promise<ApiKeyPublico> {
    // Lookup de los catalogos (docs/architecture.md: sin hardcode de contexto). Fuera
    // de la transaccion: son lecturas de catalogo inmutable y asi la tx es mas corta.
    const [rol, tipoIdentificacion] = await Promise.all([
      this.prisma.rol.findUnique({ where: { value: ROL_API_KEY }, select: { id: true } }),
      this.prisma.tipoIdentificacion.findUnique({
        where: { value: TIPO_IDENTIFICACION_CEDULA },
        select: { id: true },
      }),
    ]);
    // Mismo error de dominio que `UserRepository.create` cuando falta el catalogo: si
    // la migracion del rol no corrio, el fallo es explicito y no un P2003 opaco.
    if (!rol) throw new CatalogoInvalidoError("rolId", ROL_API_KEY);
    if (!tipoIdentificacion) {
      throw new CatalogoInvalidoError("tipoIdentificacionId", TIPO_IDENTIFICACION_CEDULA);
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const usuario = await tx.usuario.create({
          data: {
            nombre: data.identificador, // R7: nombre derivado del identificador recibido
            email: data.email, // R10: namespace reservado
            telefono: "", // [D4]: NOT NULL sin default; la cuenta no tiene telefono real
            passwordHash: data.passwordHash, // R8: solo el hash bcrypt, nunca el claro
            cedula: data.cedula, // R10
            tipoIdentificacionId: tipoIdentificacion.id, // [D4]
            rolId: rol.id, // R12/[D1]
            estado: "activo", // R12/[D5]
            fulfillment: false,
            zonaId: null,
          },
          select: { id: true },
        });

        return await tx.apiKey.create({
          data: {
            identificador: data.identificador,
            slug: data.slug,
            keyPrefix: data.keyPrefix, // R17
            keyHash: data.keyHash, // R16: solo el hash
            usuarioId: usuario.id, // R21/[D6]
            createdById: data.createdById, // R21
          },
          select: PUBLIC_SELECT, // R19: sin keyHash
        });
      });
    } catch (error) {
      throw mapDuplicadoError(error);
    }
  }

  /**
   * Feature 88/R3/R4: resuelve la key presentada por su `key_hash` (UNIQUE -> lookup por
   * indice). Solo query, sin logica de negocio (la decision `activo`/rechazo vive en
   * `ApiKeyAuthService`). El `select` NUNCA incluye `keyHash` ni el secreto (R6/R19): solo
   * lo minimo para autorizar (id, usuario dedicado, su estado y el `value` de su rol).
   */
  async findByKeyHash(keyHash: string): Promise<ApiKeyAutenticada | null> {
    const row = await this.prisma.apiKey.findUnique({
      where: { keyHash },
      select: {
        id: true,
        estado: true, // estado PROPIO de la key (palanca de revocacion, feature 88/R7)
        usuarioId: true,
        usuario: { select: { estado: true, rol: { select: { value: true } } } },
      },
    });
    if (!row) return null;
    return {
      apiKeyId: row.id,
      usuarioId: row.usuarioId,
      estado: row.usuario.estado,
      apiKeyEstado: row.estado,
      rol: row.usuario.rol.value,
    };
  }

  /**
   * Feature 82/R4/R7/R9/R10: listado paginado, `createdAt desc` fijo [D4]. Solo queries:
   * ni permisos ni reglas de negocio. [D2] sin scoping por `createdById`: el total es el
   * de todas las keys, asi una pagina fuera de rango devuelve `items: []` con el `total`
   * real (R9). Molde: `UserRepository.list`.
   */
  async list(params: ListApiKeysParams): Promise<ListApiKeysResult> {
    const [rows, total] = await Promise.all([
      this.prisma.apiKey.findMany({
        select: LIST_SELECT, // R6: sin keyHash
        orderBy: { createdAt: "desc" }, // R7
        skip: params.skip,
        take: params.take,
      }),
      this.prisma.apiKey.count(),
    ]);

    const items: ApiKeyListItem[] = rows.map((row) => ({
      id: row.id,
      identificador: row.identificador,
      keyPrefix: row.keyPrefix,
      estado: row.estado,
      usuarioId: row.usuarioId,
      usuarioEmail: row.usuario.email, // [D1]: se aplana el include
      createdAt: row.createdAt,
    }));
    return { items, total };
  }

  /** Feature 82: total de API keys existentes. */
  async count(): Promise<number> {
    return this.prisma.apiKey.count();
  }

  /**
   * Ciclo de vida/R2: reemplaza `key_prefix`+`key_hash` de la fila `id` en un solo UPDATE
   * (atomico a nivel de fila). El hash viejo deja de resolver de inmediato. Solo query:
   * el secreto ya lo genero el service; aqui no se toca el usuario ni el `estado`. `P2025`
   * (fila inexistente) -> `null` para que el service lo traduzca a `not_found` (R3).
   */
  async rotar(
    id: string,
    data: { keyPrefix: string; keyHash: string },
  ): Promise<ApiKeyPublico | null> {
    try {
      return await this.prisma.apiKey.update({
        where: { id },
        data: { keyPrefix: data.keyPrefix, keyHash: data.keyHash },
        select: PUBLIC_SELECT, // R6/R19: sin keyHash
      });
    } catch (error) {
      if (esRegistroNoEncontrado(error)) return null;
      throw error;
    }
  }

  /**
   * Ciclo de vida/R4: fija el `estado` propio de la key en un solo UPDATE. Idempotente a
   * nivel de fila (fijar el estado actual es un no-op valido en Postgres). `P2025` (fila
   * inexistente) -> `null` -> `not_found` (R3).
   */
  async setEstado(id: string, estado: EstadoApiKey): Promise<ApiKeyPublico | null> {
    try {
      return await this.prisma.apiKey.update({
        where: { id },
        data: { estado },
        select: PUBLIC_SELECT, // R6/R19: sin keyHash
      });
    } catch (error) {
      if (esRegistroNoEncontrado(error)) return null;
      throw error;
    }
  }
}

/**
 * `true` si el error es el P2025 de Prisma ("record to update not found"): la fila que se
 * intento actualizar no existe. Mismo patron que `SessionRepository`. Robusto bajo el
 * driver adapter (el codigo P2025 se preserva). Cualquier otro error se re-lanza.
 */
function esRegistroNoEncontrado(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025";
}

/**
 * R11: traduce la violacion de unicidad de Postgres a un error de dominio. Reusa
 * `textoConstraintP2002` (robusto en motor nativo y bajo el driver adapter), igual que
 * `UserRepository.mapDuplicadoError`. Las constraints reales `usuario_email_key` /
 * `usuario_cedula_key` contienen los substrings buscados.
 */
function mapDuplicadoError(error: unknown): unknown {
  const texto = textoConstraintP2002(error);
  if (texto) {
    if (texto.includes("email")) return new UsuarioDuplicadoError("email");
    if (texto.includes("cedula")) return new UsuarioDuplicadoError("cedula");
  }
  return error;
}
