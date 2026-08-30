import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  GastoFijoCobroTxClient,
  IGastoFijoCobroRepository,
} from "@/lib/interfaces/repositories/IGastoFijoCobroRepository";
import type { IWalletMovimientoRepository } from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type {
  GastoFijoCobroTx,
  GastoFijoCobroTxRunner,
  IGastoFijoCobroService,
} from "@/lib/interfaces/services/IGastoFijoCobroService";
import type {
  AprobarCobroGastoFijoServiceResult,
  ContarCobrosPendientesDePlantillaInput,
  ContarCobrosPendientesDePlantillaServiceResult,
  DecidirCobroGastoFijoInput,
  ListarCobrosPendientesServiceResult,
  RechazarCobroGastoFijoServiceResult,
} from "@/lib/types/gasto-fijo-cobro";
import { gastoFijoConfig } from "@/lib/config/gasto-fijo";
import { esAccesoTotal, puedeDecidirCobroGastoFijo } from "@/lib/auth/acceso-total";

/**
 * FICHA 333 (D2, design §3/§6.3) — lógica de negocio de los COBROS de gasto fijo: ver la cola,
 * APROBAR, RECHAZAR, cancelar los de una plantilla que se borra y contar los de una plantilla
 * para la confirmación del borrado.
 *
 * No conoce HTTP ni Prisma: recibe los dos repositorios, el cliente de escritura y el ejecutor
 * de transacciones por constructor, y el reloj por parámetro.
 *
 * ⚠️ QUIÉN AUTORIZA QUÉ — LA EXCEPCIÓN DELIBERADA A LA PARIDAD DE LA FICHA 94 (design §3):
 *
 *   · `listarPendientes` y `contarPendientesDePlantilla` → `esAccesoTotal` (`maestro` + `admin`).
 *     El `admin` VE la cola (R25) y cuenta lo que un borrado cancelaría (R55).
 *   · `aprobar` y `rechazar` → `puedeDecidirCobroGastoFijo` (`maestro` y NADIE MÁS, R24).
 *
 * El camino de DECISIÓN no autoriza con `esAccesoTotal` y eso lo vigila una guardia estática
 * (`tests/unit/guards/gasto-fijo-decision-rol.guardia.test.ts`, R27): esconder el botón en la UI
 * sería autorización de mentira —la Server Action seguiría abierta al `admin`—, así que la UI
 * esconde ADEMÁS (R40), no en vez de.
 *
 * ⚠️ MONEY-SAFE: el monto es STRING de punta a punta y este archivo no lo convierte, no lo
 * redondea y no opera con él. Lo único que hace con dinero es COPIAR el que el cobro guardó.
 */
export class GastoFijoCobroService implements IGastoFijoCobroService {
  constructor(
    private readonly cobroRepo: IGastoFijoCobroRepository,
    private readonly movimientoRepo: IWalletMovimientoRepository,
    /**
     * Cliente de escritura para las operaciones que NO abren transacción (rechazar): el repo
     * acepta cualquier `GastoFijoCobroTxClient`, y aquí se inyecta el `PrismaClient` completo.
     */
    private readonly writeClient: GastoFijoCobroTxClient,
    /** Ejecutor de la transacción de APROBAR (R15). Inyectado: el servicio no importa Prisma. */
    private readonly runTx: GastoFijoCobroTxRunner,
  ) {}

  /**
   * R25/R39/R41 — la COLA: los pendientes del más antiguo al más reciente, recortados al tope
   * del servidor, y el `total` REAL aparte.
   *
   * `total` NO es `items.length` y esa diferencia es el requisito: `items` viene recortado, así
   * que si algún día hubiera más cobros que el tope, el número lo diría y la pantalla no
   * mentiría. El tope sale de `lib/config/gasto-fijo.ts` —la configuración que este dominio ya
   * tenía—, no de un literal escrito aquí.
   */
  async listarPendientes(actor: Actor): Promise<ListarCobrosPendientesServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R25: el admin SÍ ve

    const items = await this.cobroRepo.listarPendientes(gastoFijoConfig.MAX_PAGE_SIZE);
    const total = await this.cobroRepo.contarPendientes();
    return { status: "ok", items, total };
  }

  /**
   * ⚠️ EL MÉTODO QUE MUEVE DINERO (R14–R20, R24). Sigue EXACTAMENTE la secuencia de
   * `design.md §6.3`, y cada paso está donde está por una razón que se puede romper:
   *
   *  1. **Guardia de rol ANTES de todo** (R24). El `admin` no llega ni a abrir la transacción.
   *  2. **Todo lo demás dentro de UNA transacción** (R15): o nace la fila del libro y el cobro
   *     queda `aprobado` y enlazado, o no ocurre ninguna de las dos cosas.
   *  3. `marcarDecidido` lleva **`WHERE id AND estado = 'pendiente'`** y su `count` ES la
   *     respuesta (R17/R18). Bajo `READ COMMITTED` —el nivel por defecto de Postgres y de
   *     Prisma— la segunda de dos aprobaciones simultáneas espera el bloqueo de fila, re-evalúa
   *     el `WHERE` tras el commit de la primera, afecta CERO filas y sale sin escribir. **No se
   *     sustituye por un `SELECT` previo**: eso sería un check-then-act con su ventana TOCTOU.
   *  4. El movimiento se escribe con **la clave que el cobro guardó** y con **el monto que el
   *     cobro copió** (R14/R16). El monto NO se lee de la plantilla: si alguien la editó entre
   *     la generación y la aprobación, se cobraría un importe que el maestro no vio (A8).
   *  5. `crearMovimientos` puede devolver **0** porque la clave YA estaba en el libro —pasa si
   *     alguien cambió el interruptor de la plantilla a mitad de período—. Entonces NO se crea un
   *     segundo movimiento: se lee el que hay por su clave, se enlaza, y el resultado viaja con
   *     `yaEstabaEnElLibro: true` para que el mensaje diga la verdad (R19).
   *
   * `ahora` se INYECTA: un test no puede depender de un `new Date()` escondido aquí dentro.
   */
  async aprobar(
    input: DecidirCobroGastoFijoInput,
    actor: Actor,
    ahora: Date,
  ): Promise<AprobarCobroGastoFijoServiceResult> {
    if (!puedeDecidirCobroGastoFijo(actor.rol)) return { status: "forbidden" }; // R24

    return this.runTx(async (tx: GastoFijoCobroTx) => {
      const cobro = await this.cobroRepo.obtenerPorId(input.id, tx);
      if (cobro === null) return { status: "not_found" }; // R20: sin escribir nada

      // R17/R18: la transición ES la serialización. `0` = alguien decidió antes (o a la vez).
      // La transacción termina sin haber escrito una sola fila, que es lo que «rollback» quiere
      // decir aquí: hasta este punto sólo hubo lecturas.
      const decididos = await this.cobroRepo.marcarDecidido(
        tx,
        input.id,
        "aprobado",
        actor.usuarioId,
        ahora,
      );
      if (decididos === 0) return { status: "ya_decidido" };

      // R14/R16: LA CLAVE del cobro y EL MONTO COPIADO. `registrado_por` = quien aprobó, que es
      // lo que distingue este egreso del que escribe el cron solo (`registrado_por = NULL`).
      const insertadas = await this.movimientoRepo.crearMovimientos(tx, [
        {
          tipo: "egreso",
          categoria: "egreso_gasto_fijo",
          monto: cobro.monto, // STRING, la COPIA (R16) — nunca el monto vigente de la plantilla
          origenTipo: "gasto",
          origenId: cobro.origenId, // la MISMA cadena que el cron habría escrito (§2)
          descripcion: `${cobro.concepto} — ${cobro.periodo}`,
          registradoPor: actor.usuarioId, // R14: quién autorizó
        },
      ]);

      // R19: se relee POR LA CLAVE, dentro de esta misma transacción, tanto si acabamos de
      // insertarla como si ya estaba. `createMany` no devuelve ids en Postgres, así que ésta es
      // la única forma de enlazar la fila correcta.
      const movimiento = await this.movimientoRepo.obtenerPorOrigen(
        tx,
        "gasto",
        cobro.origenId,
        "egreso_gasto_fijo",
      );
      if (movimiento === null) {
        // Imposible por construcción: o la acabamos de insertar, o `insertadas === 0` porque la
        // clave ya estaba ocupada. Se PROPAGA con contexto y revierte la transacción antes que
        // dejar un cobro aprobado sin movimiento detrás.
        throw new Error(
          `gasto-fijo-cobro: el movimiento de la clave "${cobro.origenId}" no se pudo releer tras aprobar`,
        );
      }

      await this.cobroRepo.enlazarMovimiento(tx, input.id, movimiento.id);
      return { status: "ok", yaEstabaEnElLibro: insertadas === 0 };
    });
  }

  /**
   * R21/R23/R24 — deja el cobro en `rechazado` con quién y cuándo, y NO escribe absolutamente
   * nada en el libro.
   *
   * NO abre transacción, y no es un descuido: la decisión es UNA sentencia condicional
   * (`UPDATE … WHERE id AND estado = 'pendiente'`), que ya es atómica por sí sola. La lectura
   * previa sólo distingue `not_found` de `ya_decidido`; si la fila cambiara entre las dos, el
   * `count` de la transición seguiría mandando.
   *
   * Efecto lateral BUSCADO (R22): el cobro rechazado CONSERVA su `origen_id`, así que la corrida
   * siguiente del mismo período choca con `gasto_fijo_cobro_origen_uq` y no reaparece. El «no»
   * del maestro vale para su período.
   */
  async rechazar(
    input: DecidirCobroGastoFijoInput,
    actor: Actor,
    ahora: Date,
  ): Promise<RechazarCobroGastoFijoServiceResult> {
    if (!puedeDecidirCobroGastoFijo(actor.rol)) return { status: "forbidden" }; // R24

    const cobro = await this.cobroRepo.obtenerPorId(input.id);
    if (cobro === null) return { status: "not_found" };

    const decididos = await this.cobroRepo.marcarDecidido(
      this.writeClient,
      input.id,
      "rechazado",
      actor.usuarioId,
      ahora,
    );
    return decididos === 0 ? { status: "ya_decidido" } : { status: "ok" }; // R23
  }

  /**
   * R45/R56 — cancela los cobros que sigan `pendiente` de esa plantilla DENTRO de la transacción
   * que la borra, y devuelve cuántos canceló REALMENTE.
   *
   * Recibe el `tx` de quien la abre porque la atomicidad es del CONJUNTO: media cancelación con
   * la plantilla ya borrada dejaría pendientes huérfanos apuntando a una plantilla que no existe.
   *
   * Sin guardia de rol propia (design §9): quien la llama YA autorizó el borrado con
   * `esAccesoTotal`, y una segunda guardia con otro criterio haría que la misma operación se
   * autorizara dos veces con reglas que podrían divergir.
   *
   * Si entre la confirmación y la ejecución el número cambió, el borrado SIGUE y este `count` es
   * el que se reporta (R56): abortarlo porque alguien aprobó un cobro entre medias sería castigar
   * al usuario por una carrera que no puede ver.
   */
  async cancelarPorPlantilla(
    tx: GastoFijoCobroTxClient,
    plantillaId: string,
    actor: Actor,
    ahora: Date,
  ): Promise<number> {
    return this.cobroRepo.cancelarPendientesDePlantilla(tx, plantillaId, actor.usuarioId, ahora);
  }

  /**
   * R55 — cuántos cobros pendientes se cancelarían si se borrara esa plantilla, LEÍDOS AHORA.
   *
   * Guardia `esAccesoTotal` y no el predicado estrecho: esto acompaña al borrado de plantillas,
   * cuya autorización esta ficha NO cambia (R28). Es una lectura, no una decisión sobre dinero.
   */
  async contarPendientesDePlantilla(
    input: ContarCobrosPendientesDePlantillaInput,
    actor: Actor,
  ): Promise<ContarCobrosPendientesDePlantillaServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" };

    const pendientes = await this.cobroRepo.contarPendientesDePlantilla(input.plantillaId);
    return { status: "ok", pendientes };
  }
}
