import type { PrismaClient } from "@prisma/client";
import { textoConstraintP2002 } from "@/lib/repositories/_shared/prisma-unique";
import {
  CatalogoInvalidoError,
  UsuarioDuplicadoError,
} from "@/lib/interfaces/repositories/IUserRepository";
import type {
  CreateApiKeyConUsuarioData,
  IApiKeyRepository,
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
  usuarioId: true,
  createdAt: true,
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
