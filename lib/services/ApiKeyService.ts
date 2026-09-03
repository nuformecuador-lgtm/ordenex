import { UsuarioDuplicadoError } from "@/lib/interfaces/repositories/IUserRepository";
import type { IApiKeyRepository } from "@/lib/interfaces/repositories/IApiKeyRepository";
import type {
  Actor,
  IApiKeyService,
  ListarApiKeysCompletoServiceResult,
} from "@/lib/interfaces/services/IApiKeyService";
import type {
  ActivarApiKeyResult,
  ApiKeyIdInput,
  DesactivarApiKeyResult,
  GenerarApiKeyInput,
  GenerarApiKeyResult,
  ListarApiKeysCompletoInput,
  ListarApiKeysInput,
  ListarApiKeysResult,
  RotarApiKeyResult,
} from "@/lib/types/api-key";
import { descargaConfig } from "@/lib/config/descarga";
import { generateApiKey } from "@/lib/utils/api-key-generator";
import { hashApiKey } from "@/lib/utils/api-key-hash";
import { cedulaSintetica, emailSintetico, slugify } from "@/lib/utils/api-key-identity";
import { hashPassword } from "@/lib/utils/password";
import { generateStrongPassword } from "@/lib/utils/password-generator";

// [D2] Mismo criterio que `UsuarioService.ALLOWED_ROLES`: generar una key ES crear un
// usuario, y crear usuarios ya es exclusivo de `maestro` (feature 25). Abrirlo a
// `admin` seria una escalada de privilegios silenciosa.
const ALLOWED_ROLES = new Set<string>(["maestro"]);

/**
 * Feature 302 — ROL EXIGIDO A LA TIENDA DESTINO.
 *
 * Solo una cuenta de tienda de verdad (`adminTienda`) puede ser duena de las ordenes que cree una
 * key. No se admite apuntar una key a otra cuenta `apiKey` (encadenaria credenciales sin que
 * nadie pueda auditar la cadena) ni a un `mensajero`/`adminSatelite`/`maestro` (no son duenos de
 * ordenes: `orden.tienda_id` apunta a la tienda). La comprobacion es del SERVICE, y `generar` es
 * la UNICA via de alta: no hay otro camino que escriba `tienda_destino_id`.
 */
const ROL_TIENDA_DESTINO = "adminTienda";

/** Feature 302: unico estado de la tienda destino que se acepta al generar la key. */
const ESTADO_TIENDA_DESTINO = "activo";

/** Mensajes de rechazo de la tienda destino, bajo la clave del campo que los produce. */
const MSG_TIENDA_DESTINO = {
  inexistente: "La tienda destino no existe",
  rol: "La tienda destino debe ser una cuenta de tienda",
  inactiva: "La tienda destino no esta activa",
} as const;

function errorTiendaDestino(mensaje: string): GenerarApiKeyResult {
  return { status: "validation_error", fieldErrors: { tiendaDestinoId: [mensaje] } };
}

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

    // Feature 302 — LA TIENDA DESTINO SE VALIDA ANTES DE ESCRIBIR NADA. Es opcional: sin ella el
    // camino es el de siempre (la cuenta dedicada es duena de sus ordenes, 88/[D4]). Con ella, la
    // key cargara a nombre de una tienda YA REGISTRADA, que es justo lo que evita la segunda
    // cuenta duplicada. Tres rechazos posibles, todos `validation_error` en el campo del select y
    // ninguno de ellos crea usuario ni key:
    //   - no existe: el uuid no corresponde a ninguna cuenta;
    //   - no es `adminTienda`: apuntar a otra `apiKey` encadenaria credenciales, y los demas roles
    //     no son duenos de ordenes (`orden.tienda_id` es la tienda);
    //   - no esta `activo`: colgar una key de una tienda dada de baja nace roto (la autenticacion
    //     lo rechazaria en cada peticion, ver `ApiKeyAuthService`).
    const tiendaDestinoId = input.tiendaDestinoId ?? null;
    if (tiendaDestinoId !== null) {
      const candidata = await this.repo.findTiendaDestino(tiendaDestinoId);
      if (candidata === null) return errorTiendaDestino(MSG_TIENDA_DESTINO.inexistente);
      if (candidata.rol !== ROL_TIENDA_DESTINO) return errorTiendaDestino(MSG_TIENDA_DESTINO.rol);
      if (candidata.estado !== ESTADO_TIENDA_DESTINO) {
        return errorTiendaDestino(MSG_TIENDA_DESTINO.inactiva);
      }
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
        tiendaDestinoId, // feature 302: ya validada arriba (o null)
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

  /**
   * Feature 170 (T B.1, design §2.1) — el MISMO inventario sin recorte por pagina, para la
   * descarga del dataset completo.
   *
   * Como en usuarios y plantillas, NO hay `construirWhere` que extraer: `listar` no arma
   * predicado alguno ([D2]: el inventario NO se acota por creador). El alcance por rol es
   * el guard, y es el MISMO objeto `ALLOWED_ROLES` que usan `generar` y `listar` — no una
   * copia (R17). Se evalua antes de tocar la base.
   *
   * El secreto sigue sin existir en este camino (82/R6): el repositorio no proyecta
   * `keyHash` y el DTO no lo declara, asi que no hay nada que filtrar aqui.
   */
  async listarCompleto(
    input: ListarApiKeysCompletoInput,
    actor: Actor,
  ): Promise<ListarApiKeysCompletoServiceResult> {
    if (!ALLOWED_ROLES.has(actor.rol)) return { status: "forbidden" }; // R17: antes de la DB
    void input; // el listado no admite filtros: el schema solo tenia `page`/`pageSize`

    const limite = descargaConfig.MAX_FILAS;

    // R29: nunca mas de N+1 filas materializadas. `total` exacto (viene del `count`).
    const { items, total } = await this.repo.list({ skip: 0, take: limite + 1 });

    // R27/R28: o todas las filas, o el error accionable. Nunca un archivo truncado.
    if (total > limite) return { status: "limite_excedido", total, limite };

    return { status: "ok", items, total };
  }

  /**
   * Ciclo de vida/R1/R2/R3: rota el secreto de la key `input.id`. Mismo `ALLOWED_ROLES`
   * que `generar` (rotar es reemitir): solo `maestro` [D2].
   */
  async rotar(input: ApiKeyIdInput, actor: Actor): Promise<RotarApiKeyResult> {
    if (!ALLOWED_ROLES.has(actor.rol)) return { status: "forbidden" }; // R1

    // R2: secreto nuevo de 256 bits (mismo generador/hasher que `generar`). SHA-256 es lo
    // UNICO que se persiste; el claro (`plainKey`) sale una sola vez en el retorno.
    const { plain: plainKey, prefix: keyPrefix } = generateApiKey();
    const keyHash = hashApiKey(plainKey);

    // R2: reemplazo atomico del prefijo+hash. Si el id no existe -> null -> not_found (R3).
    // El secreto generado se descarta sin persistirse ni loguearse.
    // FICHA 362 (R5/R9): QUIEN roto la key. El secreto nuevo NO viaja al registro.
    const apiKey = await this.repo.rotar(input.id, { keyPrefix, keyHash }, actor.usuarioId);
    if (apiKey === null) return { status: "not_found" }; // R3

    // R2: el nuevo secreto en claro viaja exactamente UNA vez, aqui. El hash viejo ya no
    // resuelve (feature 88): el secreto anterior queda invalido.
    return { status: "ok", apiKey, plainKey };
  }

  /**
   * Ciclo de vida/R1/R3/R4: pone la key `input.id` en `activa`. Idempotente (activar una
   * ya activa devuelve `ok` con la fila actual). Solo `maestro`.
   */
  async activar(input: ApiKeyIdInput, actor: Actor): Promise<ActivarApiKeyResult> {
    if (!ALLOWED_ROLES.has(actor.rol)) return { status: "forbidden" }; // R1

    const apiKey = await this.repo.setEstado(input.id, "activa", actor.usuarioId); // R4 + 362
    if (apiKey === null) return { status: "not_found" }; // R3
    return { status: "ok", apiKey };
  }

  /**
   * Ciclo de vida/R1/R3/R4: pone la key `input.id` en `inactiva` (revocacion). Idempotente.
   * Solo `maestro`.
   */
  async desactivar(input: ApiKeyIdInput, actor: Actor): Promise<DesactivarApiKeyResult> {
    if (!ALLOWED_ROLES.has(actor.rol)) return { status: "forbidden" }; // R1

    const apiKey = await this.repo.setEstado(input.id, "inactiva", actor.usuarioId); // R4 + 362
    if (apiKey === null) return { status: "not_found" }; // R3
    return { status: "ok", apiKey };
  }
}
