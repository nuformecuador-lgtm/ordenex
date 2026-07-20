// Feature 88 (design §1.2) — Autenticacion por API key: resuelve el secreto presentado
// en una peticion HTTP contra la fila `api_key`, validando ademas el ESTADO del usuario
// dedicado (palanca de revocacion, R5). Logica de borde PURA: sin HTTP, sin Prisma directo
// (recibe `IApiKeyRepository` por inyeccion), inyectable en tests con un repo fake.
//
// SEGURIDAD (R6, subrayado): la key viaja en cada request. Ni el secreto ni su hash entran
// JAMAS a un `console.*` ni a un error serializado. El lookup es SIEMPRE por hash SHA-256
// (el MISMO `hashApiKey` de la 81, o el hash nunca coincidiria), nunca por comparacion en
// claro contra la DB.
import type {
  ApiKeyAuthResult,
  IApiKeyAuthService,
} from "@/lib/interfaces/services/IApiKeyAuthService";
import type { IApiKeyRepository } from "@/lib/interfaces/repositories/IApiKeyRepository";
import { hashApiKey } from "@/lib/utils/api-key-hash";
import type { RolValue } from "@prisma/client";

/** R5: unico estado que autoriza la carga; `pendiente`/`inactivo`/`bloqueado` -> forbidden. */
const ESTADO_ACTIVO = "activo";

export class ApiKeyAuthService implements IApiKeyAuthService {
  constructor(private readonly repo: IApiKeyRepository) {}

  async autenticar(rawKey: string | null): Promise<ApiKeyAuthResult> {
    // R2: sin secreto (header ausente/vacio) -> unauthenticated SIN tocar la DB.
    if (rawKey === null || rawKey.trim() === "") return { status: "unauthenticated" };

    // R3: hash SHA-256 hex con el MISMO hasher de la 81; lookup por indice UNIQUE `key_hash`.
    // Nunca se compara el secreto en claro contra la DB.
    const keyHash = hashApiKey(rawKey);
    const encontrada = await this.repo.findByKeyHash(keyHash);

    // R4: ninguna fila coincide -> unauthenticated (indistinguible de "no presento key").
    if (encontrada === null) return { status: "unauthenticated" };

    // R5: la key existe pero su usuario dedicado no esta `activo` -> forbidden (revocacion).
    if (encontrada.estado !== ESTADO_ACTIVO) return { status: "forbidden" };

    // ok: el actor es el usuario dedicado de la key (D4: dueño de las ordenes que cree).
    return {
      status: "ok",
      apiKeyId: encontrada.apiKeyId,
      actor: { usuarioId: encontrada.usuarioId, rol: encontrada.rol as RolValue },
    };
  }
}
