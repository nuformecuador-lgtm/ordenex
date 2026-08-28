// Feature 88 (design §1.2) — Autenticacion por API key: resuelve el secreto presentado
// en una peticion HTTP contra la fila `api_key`, validando ademas el ESTADO del usuario
// dedicado (palanca de revocacion, R5). Logica de borde PURA: sin HTTP, sin Prisma directo
// (recibe `IApiKeyRepository` por inyeccion), inyectable en tests con un repo fake.
//
// Feature 302 — ademas de autenticar, este service RESUELVE EL DUENO de las ordenes del canal:
// la tienda real apuntada por la key, o la cuenta dedicada si no apunta a ninguna. Es el unico
// punto donde esa decision se toma (ver el retorno `ok` mas abajo).
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
import { resolverOwnerApiKey } from "@/lib/utils/api-key-owner";
import type { RolValue } from "@prisma/client";

/** R5: unico estado del USUARIO dedicado que autoriza la carga; el resto -> forbidden. */
const ESTADO_ACTIVO = "activo";

/** R7: unico estado PROPIO de la key que autoriza la carga; `inactiva` -> forbidden. */
const ESTADO_API_KEY_ACTIVA = "activa";

/**
 * Feature 267 (2026-08-23) — DEFENSA EN PROFUNDIDAD SOBRE EL ROL DEL ACTOR.
 *
 * Unico `RolValue` que puede actuar por este canal. Hasta hoy el actor se construia con un
 * `as RolValue` sobre `encontrada.rol`, un CAST de la fila: nada comprobaba lo que
 * `IApiKeyRepository.ApiKeyAutenticada.rol` ya prometia por escrito («el service revalida
 * (defensa en profundidad)»). Esa promesa existia sin codigo detras.
 *
 * Por que aniadirla es seguro, verificado el 2026-08-23: la UNICA alta de una key crea su
 * usuario dedicado en la misma transaccion y le fija el rol por LOOKUP de `"apiKey"`
 * (`ApiKeyRepository.createConUsuario`, `rolId: rol.id`, R12/[D1]); no hay camino de alta
 * que produzca una cuenta de key con otro rol. Cambiarlo despues por
 * `UsuarioService.actualizar` seria una MISCONFIGURACION, no un flujo soportado, y en una
 * frontera multi-tenant una misconfiguracion debe cerrar el canal, no ampliarlo.
 *
 * Que protege: TODAS las superficies del canal por API key —presentes (carga, cotizacion,
 * cancelacion, PDF, analitica) y futuras— quedan cubiertas aqui arriba, no una a una en cada
 * borde. La guarda gemela vive en `resolverAlcance` (`lib/analytics/alcance.ts`), que
 * deniega el canal `api_key` a cualquier rol que no sea de integracion: dos capas
 * independientes para el mismo invariante, que es justo el punto.
 */
const ROL_API_KEY = "apiKey";

/**
 * Feature 302 (2026-08-28) — QUIEN ENTRA Y QUIEN ES EL DUENO YA NO SON EL MISMO SUJETO.
 *
 * Una key puede apuntar a una TIENDA REAL (`api_key.tienda_destino_id`): la credencial la sigue
 * portando la cuenta dedicada —con su rol restringido y las DOS capas de rol de la 267 intactas—
 * pero las ordenes que cree se registran a nombre de esa tienda. Eso es lo que impide que generar
 * una key para una tienda ya registrada acabe creando una segunda cuenta con wallet, saldo y
 * tarifas propias.
 *
 * LO QUE SE EXIGE DE LA TIENDA DESTINO, y por que se exige AQUI y no solo al generarla: `generar`
 * comprueba rol y estado en el momento del alta, pero una cuenta cambia despues (se da de baja,
 * se le cambia el rol). Si esta comprobacion no viviera tambien en la autenticacion, dar de baja
 * una tienda dejaria su canal por API abierto indefinidamente. Es el MISMO argumento —y el mismo
 * desenlace `forbidden`, indistinguible desde fuera— que ya justifica revalidar el estado y el rol
 * de la cuenta dedicada en cada peticion.
 */
const ROL_TIENDA_DESTINO = "adminTienda";

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

    // R7: la key esta desactivada (`api_key.estado !== 'activa'`) -> forbidden. Palanca de
    // revocacion PROPIA de la key, independiente del estado del usuario dedicado.
    if (encontrada.apiKeyEstado !== ESTADO_API_KEY_ACTIVA) return { status: "forbidden" };

    // 267: el usuario dedicado tiene que SER una cuenta de integracion. Mismo desenlace que
    // una key revocada (`forbidden`): desde fuera, una cuenta mal configurada y una key
    // desactivada son indistinguibles, y ninguna de las dos revela por que.
    //
    // ⚠️ 302 NO RELAJA ESTA GUARDA, y era la alternativa que se descarto: apuntar la key
    // directamente a la cuenta de la tienda (rol `adminTienda`) exigiria aflojar esta linea, y
    // entonces una key filtrada actuaria con los permisos COMPLETOS de la tienda, sesion web
    // incluida. La comprobacion sigue siendo sobre la cuenta PORTADORA de la credencial.
    if (encontrada.rol !== ROL_API_KEY) return { status: "forbidden" };

    // 302: si la key apunta a una tienda, esa tienda tiene que seguir siendo una tienda y seguir
    // activa. Fallo CERRADO: una tienda dada de baja, o cuya cuenta cambio de rol, cierra el
    // canal en vez de dejarlo cargando a un dueno que ya no deberia recibir nada. Mismo
    // `forbidden` mudo que todo lo demas.
    if (encontrada.tiendaDestinoId !== null) {
      if (encontrada.tiendaDestinoRol !== ROL_TIENDA_DESTINO) return { status: "forbidden" };
      if (encontrada.tiendaDestinoEstado !== ESTADO_ACTIVO) return { status: "forbidden" };
    }

    // ok. El `rol` del actor es SIEMPRE `apiKey` (el de la credencial): es lo que hace que
    // `BulkOrdenService.cargarViaApi`, `CotizacionOrdenService.cotizar` y `resolverAlcance` sigan
    // tratando esto como el canal de integracion y no como una sesion de tienda.
    //
    // El `usuarioId` del actor es EL DUENO DE LAS ORDENES, no la cuenta dedicada. Aqui se
    // reescribe el [D4] de la 88 («el actor es el usuario dedicado de la key, dueño de las ordenes
    // que cree»), que desde la 302 ya no es cierto cuando hay tienda destino. La resolucion vive
    // en UN solo sitio a proposito: todas las superficies del canal —carga, cotizacion,
    // cancelacion, habilitacion, PDF, lecturas y analitica— derivan el dueno de `actor.usuarioId`,
    // asi que decidirlo aqui las cubre TODAS, presentes y futuras, en vez de una a una en cada
    // borde (mismo argumento con el que la 267 puso la guarda de rol en este punto).
    //
    // La trazabilidad de QUE credencial actuo no se pierde: viaja en `apiKeyId`.
    return {
      status: "ok",
      apiKeyId: encontrada.apiKeyId,
      actor: {
        usuarioId: resolverOwnerApiKey(encontrada.usuarioId, encontrada.tiendaDestinoId),
        rol: encontrada.rol as RolValue,
      },
    };
  }
}
