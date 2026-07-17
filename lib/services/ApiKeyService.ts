import { UsuarioDuplicadoError } from "@/lib/interfaces/repositories/IUserRepository";
import type { IApiKeyRepository } from "@/lib/interfaces/repositories/IApiKeyRepository";
import type { Actor, IApiKeyService } from "@/lib/interfaces/services/IApiKeyService";
import type {
  GenerarApiKeyInput,
  GenerarApiKeyResult,
  ListarApiKeysInput,
  ListarApiKeysResult,
} from "@/lib/types/api-key";
import { generateApiKey } from "@/lib/utils/api-key-generator";
import { hashApiKey } from "@/lib/utils/api-key-hash";
import { cedulaSintetica, emailSintetico, slugify } from "@/lib/utils/api-key-identity";
import { hashPassword } from "@/lib/utils/password";
import { generateStrongPassword } from "@/lib/utils/password-generator";

// [D2] Mismo criterio que `UsuarioService.ALLOWED_ROLES`: generar una key ES crear un
// usuario, y crear usuarios ya es exclusivo de `maestro` (feature 25). Abrirlo a
// `admin` seria una escalada de privilegios silenciosa.
const ALLOWED_ROLES = new Set<string>(["maestro"]);

export class ApiKeyService implements IApiKeyService {
  constructor(private readonly repo: IApiKeyRepository) {}

  async generar(input: GenerarApiKeyInput, actor: Actor): Promise<GenerarApiKeyResult> {
    if (!ALLOWED_ROLES.has(actor.rol)) return { status: "forbidden" }; // R2

    const identificador = input.identificador.trim();

    // R5/R6: el slug es la base del email/cedula sinteticos. Si el identificador solo
    // trae simbolos ("!!!"), no queda nada utilizable y se rechaza ANTES de escribir.
    const slug = slugify(identificador);
    if (slug.length === 0) {
      return {
        status: "validation_error",
        fieldErrors: {
          identificador: ["El identificador debe contener al menos una letra o numero"],
        },
      };
    }

    // R8: contrasena aleatoria (cripto) para la cuenta dedicada; solo se persiste su
    // hash bcrypt. R9: `passwordPlain` no se retorna ni se loguea y muere con el scope.
    // Ojo: bcrypt es para la CONTRASENA. La KEY va con SHA-256 (ver abajo, [D7]).
    const passwordPlain = generateStrongPassword();
    const passwordHash = await hashPassword(passwordPlain);

    // R14/R15/R22: secreto de 256 bits con prefijo `ordx_`. No depende del
    // identificador, asi que dos generaciones con el mismo dan secretos distintos.
    const { plain: plainKey, prefix: keyPrefix } = generateApiKey();
    const keyHash = hashApiKey(plainKey); // R16/[D7]: SHA-256, lo unico que se persiste

    try {
      // R13: usuario + key en una sola transaccion (atomica en el repositorio).
      const apiKey = await this.repo.createConUsuario({
        identificador, // R7
        slug,
        email: emailSintetico(slug), // R10
        cedula: cedulaSintetica(slug), // R10
        passwordHash,
        keyPrefix, // R17
        keyHash,
        createdById: actor.usuarioId, // R21
      });

      // R18: el secreto en claro sale exactamente UNA vez, aqui. No existe ninguna
      // operacion de lectura que lo devuelva despues (R19).
      return { status: "ok", apiKey, plainKey };
    } catch (error) {
      // R11: el usuario derivado del slug ya existe.
      if (error instanceof UsuarioDuplicadoError) {
        return { status: "conflict", campo: error.campo };
      }
      throw error;
    }
  }

  /**
   * Feature 82/R4: listado paginado. Reusa el mismo `ALLOWED_ROLES` que `generar`: quien
   * no puede crear keys tampoco puede inventariarlas.
   *
   * R6 no necesita ningun filtrado aqui: los items vienen del repositorio ya sin
   * `keyHash` (`LIST_SELECT` no lo pide) y `ApiKeyListItem` no lo declara. No hay
   * secreto que borrar porque nunca existio en este camino.
   */
  async listar(input: ListarApiKeysInput, actor: Actor): Promise<ListarApiKeysResult> {
    if (!ALLOWED_ROLES.has(actor.rol)) return { status: "forbidden" }; // R2: antes de la DB

    const skip = (input.page - 1) * input.pageSize;
    const { items, total } = await this.repo.list({
      skip,
      take: input.pageSize, // ya acotado a MAX_PAGE_SIZE por el schema (R8)
    });

    // R9: si `skip` supera el final, `items` viene vacio y `total` sigue siendo el real.
    return { status: "ok", items, page: input.page, pageSize: input.pageSize, total };
  }
}
