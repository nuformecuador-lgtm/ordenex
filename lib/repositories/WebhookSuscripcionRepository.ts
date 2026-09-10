import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  IWebhookSuscripcionRepository,
  WebhookSuscripcionActiva,
  WebhookSuscripcionEstadoCircuito,
  WebhookSuscripcionUpsertData,
  WebhookSuscripcionVista,
} from "@/lib/interfaces/repositories/IWebhookSuscripcionRepository";
import { resolverOwnerApiKey } from "@/lib/utils/api-key-owner";
// FICHA 403 (design §2): la MISMA funcion pura que usa el drenador para decidir el espaciado.
// Que la lectura y la escritura compartan predicado es lo que impide que "lo que hace la cola" y
// "lo que ve el dueño" digan cosas distintas.
import { estaPausada, type WebhookPausaConfig } from "@/lib/utils/webhook-suscripcion-pausa";
import { loadWebhookConfig, pausaConfigDe } from "@/lib/config/webhook";

// Feature 99 (design §5) — repositorio de suscripciones de webhook (patron
// `ApiKeyRepository`, `Pick<PrismaClient>`). Solo queries: sin logica de negocio.

type WebhookSuscripcionPrismaClient = Pick<PrismaClient, "webhookSuscripcion" | "usuario">;

/** [D3] rol de la cuenta dedicada de API key; se resuelve por lookup, nunca por id. */
const ROL_API_KEY = "apiKey";

export class WebhookSuscripcionRepository implements IWebhookSuscripcionRepository {
  /** FICHA 403: umbral vigente; inyectable para que los tests fijen ventana y piso. */
  private readonly pausa: WebhookPausaConfig;
  /** FICHA 403: reloj inyectable — `pausada` es un valor DERIVADO y necesita un "ahora". */
  private readonly now: () => Date;

  constructor(
    private readonly prisma: WebhookSuscripcionPrismaClient,
    pausa?: WebhookPausaConfig,
    now: () => Date = () => new Date(),
  ) {
    this.pausa = pausa ?? pausaConfigDe(loadWebhookConfig());
    this.now = now;
  }

  /**
   * R6: upsert por `ownerUsuarioId`. Un re-registro actualiza url/secret y REACTIVA.
   *
   * FICHA 403 (R7): reinicia ademas el circuito en el UPDATE. En el CREATE no hace falta
   * escribirlo: las dos columnas nacen con su default (0 y `now()`), que es exactamente el estado
   * "sana, recien nacida" que R1 pide para un alta.
   */
  async upsertByOwner(data: WebhookSuscripcionUpsertData): Promise<void> {
    await this.prisma.webhookSuscripcion.upsert({
      where: { ownerUsuarioId: data.ownerUsuarioId },
      create: {
        ownerUsuarioId: data.ownerUsuarioId,
        url: data.url,
        secret: data.secret, // ciphertext (design §1.3)
        activa: true,
      },
      update: {
        url: data.url,
        secret: data.secret,
        activa: true, // re-registrar reactiva una suscripcion dada de baja
        // R7: la palanca manual de "reintentar ya". Se aplica SIEMPRE, tambien cuando el destino
        // no estaba roto: reiniciar un contador ya en cero es un no-op inofensivo, y condicionarlo
        // seria una rama que puede equivocarse.
        fallosConsecutivos: 0,
        sinExitoDesde: this.now(),
      },
    });
  }

  /**
   * R33 (gate P4): actualiza SOLO la url del owner y REACTIVA, conservando el secreto.
   * `updateMany` no lanza si no hay fila (no-op). No toca `secret`: editar no rota.
   *
   * FICHA 403 (R7/R19): reinicia tambien el circuito. Este es el camino que recorre el boton
   * "Guardar URL" de Configuracion > API, asi que es LA salida manual de la pausa: tras guardar,
   * la siguiente lectura ya devuelve `pausada: false` sin recargar y sin esperar a una entrega.
   */
  async actualizarUrlByOwner(ownerUsuarioId: string, url: string): Promise<void> {
    await this.prisma.webhookSuscripcion.updateMany({
      where: { ownerUsuarioId },
      data: { url, activa: true, fallosConsecutivos: 0, sinExitoDesde: this.now() },
    });
  }

  /**
   * R34 (gate P4): actualiza SOLO el ciphertext del secreto del owner (rotación),
   * conservando url/activa. `updateMany` no lanza si no hay fila (no-op).
   */
  async actualizarSecretoByOwner(ownerUsuarioId: string, secret: string): Promise<void> {
    await this.prisma.webhookSuscripcion.updateMany({
      where: { ownerUsuarioId },
      data: { secret },
    });
  }

  /** R10/R17/R21/R24: suscripcion ACTIVA con el ciphertext del secreto. `null` si inactiva. */
  async findActivaByOwner(ownerUsuarioId: string): Promise<WebhookSuscripcionActiva | null> {
    const row = await this.prisma.webhookSuscripcion.findUnique({
      where: { ownerUsuarioId },
      select: { url: true, secret: true, activa: true },
    });
    if (!row || !row.activa) return null;
    return { url: row.url, secret: row.secret };
  }

  /**
   * R7: vista de consulta SIN secreto (`secret` no figura en el select ni en el DTO).
   *
   * FICHA 403 (R18): añade `pausada` y `sinExitoDesde`. `pausada` NO es una columna: se DERIVA
   * aqui con `estaPausada()` —la misma funcion y el mismo umbral que usa el drenador— en el
   * momento de la consulta. Por eso no puede quedar congelado ni divergir de lo que hace la cola.
   */
  async findByOwner(ownerUsuarioId: string): Promise<WebhookSuscripcionVista | null> {
    const row = await this.prisma.webhookSuscripcion.findUnique({
      where: { ownerUsuarioId },
      select: { url: true, activa: true, fallosConsecutivos: true, sinExitoDesde: true },
    });
    if (!row) return null;
    return {
      url: row.url,
      activa: row.activa,
      pausada: estaPausada(row.fallosConsecutivos, row.sinExitoDesde, this.now(), this.pausa),
      sinExitoDesde: row.sinExitoDesde.toISOString(),
    };
  }

  /** R8: baja logica. `updateMany` no lanza si no existe fila (no-op). */
  async desactivarByOwner(ownerUsuarioId: string): Promise<void> {
    await this.prisma.webhookSuscripcion.updateMany({
      where: { ownerUsuarioId },
      data: { activa: false },
    });
  }

  /**
   * FICHA 403 (R2) — el 2xx llego: contador a cero y ancla a `ahora`. UNA sentencia, sin leer
   * antes: lo unico que importa es el estado final, no el que habia.
   *
   * Con esto la suscripcion SALE DE LA PAUSA sola, porque `estaPausada()` se evalua sobre estos
   * dos datos y ninguno de los dos sigue cumpliendo el umbral. No hay ningun estado del que solo
   * un humano pueda sacarla — que es precisamente la propiedad que un `activa = false` no tenia.
   *
   * NO toca `activa` (R5). `updateMany` es no-op si el owner no tiene fila.
   */
  async registrarEntregaOk(ownerUsuarioId: string, ahora: Date): Promise<void> {
    await this.prisma.webhookSuscripcion.updateMany({
      where: { ownerUsuarioId },
      data: { fallosConsecutivos: 0, sinExitoDesde: ahora },
    });
  }

  /**
   * FICHA 403 (R3) — un fallo de entrega: `increment` de Prisma, ATOMICO a nivel de fila (el SQL
   * es `SET fallos_consecutivos = fallos_consecutivos + 1`), asi que dos jobs de la misma
   * suscripcion drenados a la vez no se pisan el contador.
   *
   * ⚠️ `sinExitoDesde` NO SE TOCA AQUI, Y ES LA LINEA QUE SOSTIENE R12. El ancla marca el inicio de
   * la racha; si cada fallo la moviera, la ventana no se cumpliria jamas (siempre "recien
   * empezada") y ademas el `entidadId` del aviso cambiaria en cada intento, produciendo un aviso
   * por fallo en vez de uno por racha. Solo la mueven un exito (R2) y el alta/edicion (R7).
   *
   * Devuelve el estado YA INCREMENTADO. `update` lanza `P2025` si no hay fila; se traduce a `null`
   * porque "el owner no tiene suscripcion" no es un error del drenado — es el caso normal cuando
   * la baja ocurre entre el encolado y la entrega.
   *
   * NO toca `activa` (R5).
   */
  async incrementarFalloYLeer(
    ownerUsuarioId: string,
    // `_ahora` NO SE USA, Y ESO ES EL COMPORTAMIENTO: un fallo no mueve el ancla de la racha (ver
    // el docblock). El parametro sigue en el contrato por simetria con `registrarEntregaOk` y
    // porque los dobles de test necesitan recibir el mismo reloj inyectado que el service usa para
    // evaluar `estaPausada()`.
    _ahora: Date,
  ): Promise<WebhookSuscripcionEstadoCircuito | null> {
    try {
      const fila = await this.prisma.webhookSuscripcion.update({
        where: { ownerUsuarioId },
        data: { fallosConsecutivos: { increment: 1 } },
        select: { fallosConsecutivos: true, sinExitoDesde: true },
      });
      return { fallosConsecutivos: fila.fallosConsecutivos, sinExitoDesde: fila.sinExitoDesde };
    } catch (error) {
      // `update` sobre una clave unica lanza `P2025` cuando no hay fila. Aqui NO es un error: la
      // suscripcion pudo darse de baja entre el encolado del job y su entrega. Cualquier otro
      // error se re-lanza (`docs/conventions.md`: nada de `catch` vacios).
      if (esRegistroNoEncontrado(error)) return null;
      throw error;
    }
  }

  /**
   * D3 + feature 302: resuelve el owner EFECTIVO de la suscripcion de webhook a partir de la
   * cuenta que la pantalla senala, o `null` si esa cuenta no participa del canal integrador.
   *
   * POR QUE ESTO DEJO DE SER UN BOOLEANO (`ownerEsApiKey`). El despachador busca la suscripcion
   * por `orden.tienda_id` (`WebhookEstadoService`), y desde la 302 una key puede crear ordenes a
   * nombre de OTRA cuenta. Colgar la suscripcion del `usuario_id` de la key —que es lo que la
   * pantalla tiene en la mano— daria de alta una fila que no recibiria jamas un evento: no
   * fallaria nada, simplemente no llegarian los webhooks. Fallo mudo. Por eso el guard, ademas de
   * autorizar, DEVUELVE a nombre de quien hay que colgarla.
   *
   * Tres desenlaces:
   *   - cuenta de rol `apiKey`  -> su tienda destino si la tiene, y si no ella misma (identico al
   *     comportamiento anterior: sin tienda destino, el owner es la propia cuenta dedicada);
   *   - cuenta que ES la tienda destino de alguna key -> ella misma (por eso existe el indice
   *     `api_key_tienda_destino_id_idx`);
   *   - cualquier otra cuenta -> `null`, y el controller responde `owner_invalido` como antes.
   */
  async resolverOwnerWebhook(ownerUsuarioId: string): Promise<string | null> {
    const row = await this.prisma.usuario.findUnique({
      where: { id: ownerUsuarioId },
      select: {
        rol: { select: { value: true } },
        apiKey: { select: { tiendaDestinoId: true } },
        // `take: 1`: solo interesa SI existe alguna, no cuantas ni cuales.
        apiKeysComoTiendaDestino: { select: { id: true }, take: 1 },
      },
    });
    if (!row) return null;
    if (row.rol.value === ROL_API_KEY) {
      return resolverOwnerApiKey(ownerUsuarioId, row.apiKey?.tiendaDestinoId ?? null);
    }
    return row.apiKeysComoTiendaDestino.length > 0 ? ownerUsuarioId : null;
  }
}

/**
 * `true` si el error es el `P2025` de Prisma ("record to update not found"): la fila que se
 * intento actualizar no existe. Mismo helper, palabra por palabra, que `ApiKeyRepository`. Robusto
 * bajo el driver adapter (el codigo `P2025` se preserva). Cualquier otro error se re-lanza.
 */
function esRegistroNoEncontrado(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025";
}
