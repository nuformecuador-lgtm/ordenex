import { Prisma } from "@prisma/client";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  IRechazoTiendaCobroRepository,
  RechazoTiendaCobroRegistro,
  RechazoTiendaCobroTxClient,
} from "@/lib/interfaces/repositories/IRechazoTiendaCobroRepository";
import type {
  CrearMovimientoInput,
  IWalletMovimientoRepository,
} from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type {
  CrearMovimientoTiendaInput,
  IWalletTiendaMovimientoRepository,
} from "@/lib/interfaces/repositories/IWalletTiendaMovimientoRepository";
import type {
  IRechazoTiendaCobroService,
  RechazoTiendaCobroTx,
  RechazoTiendaCobroTxRunner,
} from "@/lib/interfaces/services/IRechazoTiendaCobroService";
import type {
  AprobarCobroRechazoTiendaServiceResult,
  DecidirCobroRechazoTiendaInput,
  ListarCobrosRechazoTiendaServiceResult,
  RechazarCobroRechazoTiendaServiceResult,
} from "@/lib/types/rechazo-tienda-cobro";
import type {
  AnularCobroRechazoTiendaServiceResult,
} from "@/lib/interfaces/services/IRechazoTiendaCobroService";
import type { IRechazoTiendaCobroAnulacionRepository } from "@/lib/interfaces/repositories/IRechazoTiendaCobroAnulacionRepository";
import type { ICajaRechazoTiendaCobroFeedService } from "@/lib/interfaces/services/ICajaRechazoTiendaCobroFeedService";
import type { AnularCobroRechazoTiendaInput } from "@/lib/types/wallet-anulacion";
import { rechazoTiendaCobroConfig } from "@/lib/config/rechazo-tienda-cobro";
import { walletTiendaConfig, type WalletTiendaConfig } from "@/lib/config/wallet-tienda";
import { conceptoIngresoADebitoTienda } from "@/lib/utils/mapeo-concepto-tienda";
import { esAccesoTotal } from "@/lib/auth/acceso-total";

/**
 * ⚠️ LOS DOS CONCEPTOS, ESCRITOS UNA SOLA VEZ, y con el ORIGEN de cada nombre delante.
 *
 * Son EXACTAMENTE los dos que `derivarIngresoOrden` produce para `resultado = "rechazada"` y
 * EXACTAMENTE los dos que `WalletFeedService` mete hoy en la caja al aprobar el cierre. Aqui no
 * se elige un catalogo nuevo: se reusa el que ya existe. `conceptoIngresoADebitoTienda`
 * (feature 43/R8) traduce cada uno a su debito espejo en el libro de la tienda, asi que el
 * nombre de las cuatro filas sale de UNA sola declaracion y no de cuatro literales sueltos.
 */
const CONCEPTO_FLETE = "ingreso_flete_devolucion" as const;
const CONCEPTO_IVA = "ingreso_iva_flete_devolucion" as const;

/**
 * ⚠️ EL ORIGEN de los cuatro apuntes: la GESTION del rechazo.
 *
 * `gestion_orden` es un valor del enum `wallet_origen_tipo` que existia desde la feature 42 y
 * que hasta esta ficha NADIE escribia (verificado por grep sobre `lib/` y `app/`). Estrenarlo
 * aqui es lo que hace que la idempotencia salga gratis: los dos indices unicos parciales que
 * ya protegen los libros —`wallet_movimiento_origen_categoria_uq` y su hermano por tienda—
 * cubren estas filas sin que haya que crear nada, y no pueden colisionar con la clave de ningun
 * otro escritor porque ninguno usa este `origen_tipo`.
 */
const ORIGEN_TIPO = "gestion_orden" as const;

/**
 * `true` si el importe aporta algo. Money-safe: la comparacion va por `Prisma.Decimal`, no por
 * `parseFloat` ni por igualdad de cadena.
 *
 * Existe por UNA razon concreta y es una regla que ya estaba escrita: `agregarIngresosPorConcepto`
 * (R10 de la feature 42) NO emite movimiento para un concepto cuyo total sea `0.00`. Si aqui se
 * emitiera igual, una tarifa con `iva_flete = 0` dejaria en los dos libros una fila de 0,00 que
 * el camino del cierre nunca escribe — o sea, los apuntes dejarian de ser «los mismos».
 *
 * El flete NO pasa por aqui: la base ya garantiza `monto_flete > 0` (CHECK
 * `rechazo_tienda_cobro_montos_validos`) porque un cobro de cero no se da de alta.
 */
function aporta(montoStr: string): boolean {
  return new Prisma.Decimal(montoStr).gt(0);
}

/** Ficha 458-B: sale de la transaccion de ANULAR (que revierte) cuando ya habia constancia. */
class CobroYaAnuladoError extends Error {
  constructor() {
    super("rechazo-tienda-cobro: ya anulado");
    this.name = "CobroYaAnuladoError";
  }
}

/**
 * 💰 FICHA 337 (segunda mitad, 2026-08-31) — logica de negocio de los COBROS POR RECHAZO DESDE
 * NOVEDADES: ver la cola, APROBAR y RECHAZAR.
 *
 * Espejo estructural de `GastoFijoCobroService` (ficha 333). Se copio la FORMA —tabla propia con
 * estado, clave unica de idempotencia, decision atomica con `UPDATE ... WHERE estado='pendiente'`
 * cuyo cero filas es «alguien decidio antes» y no un error— y NO se generalizo aquel servicio:
 * tiene horas de vida en produccion y hacerlo generico con la operacion andando es el riesgo que
 * no toca correr.
 *
 * No conoce HTTP ni Prisma-como-base: recibe los tres repositorios, el cliente de escritura y el
 * ejecutor de transacciones por constructor, y el reloj por parametro. (Importa `Prisma` SOLO
 * por `Prisma.Decimal`, que es la libreria de decimales del repo y no una dependencia de la base
 * — mismo uso que hace `WalletTiendaFeedService`, que tambien es un servicio.)
 *
 * ⚠️ QUIEN AUTORIZA: `esAccesoTotal` (maestro + admin) en los TRES metodos, y es una decision
 * explicita del humano del 2026-08-31. La 333 estrecho el guard a `maestro` porque aquello
 * autoriza dinero que SALE de la caja de Ordenex; esto es cobrar a una tienda por un servicio ya
 * prestado —el retorno del paquete— y es operacion diaria. Estrechar aqui pondria la caja diaria
 * a esperar al maestro.
 *
 * ⚠️ AQUI NO SE CALCULA DINERO. Los dos importes se leen COPIADOS de la fila del cobro, que los
 * congelo en el instante del rechazo con la salida de `derivarIngresoOrden`. Ni una
 * multiplicacion, ni un porcentaje, ni una suma. La unica operacion aritmetica del archivo es la
 * comparacion con cero de `aporta`, que decide si una fila se emite — no cuanto vale.
 */
export class RechazoTiendaCobroService implements IRechazoTiendaCobroService {
  constructor(
    private readonly cobroRepo: IRechazoTiendaCobroRepository,
    private readonly movimientoRepo: Pick<IWalletMovimientoRepository, "crearMovimientos">,
    private readonly movimientoTiendaRepo: Pick<
      IWalletTiendaMovimientoRepository,
      "crearMovimientos"
    >,
    /**
     * Cliente de escritura para las operaciones que NO abren transaccion (rechazar): el repo
     * acepta cualquier `RechazoTiendaCobroTxClient`, y aqui se inyecta el `PrismaClient` entero.
     */
    private readonly writeClient: RechazoTiendaCobroTxClient,
    /** Ejecutor de la transaccion de APROBAR. Inyectado: el servicio no importa el cliente. */
    private readonly runTx: RechazoTiendaCobroTxRunner,
    /**
     * Ficha 458-B (D7) — lo que ANULAR necesita: el repositorio de la constancia (y de las lineas
     * originales) y el puerto estrecho de la caja para los dos reversos. SIN valor por defecto a
     * proposito: un composition root que se olvidara de pasarlo no compila (memoria «el composition
     * root que no inyecta»).
     */
    private readonly anulacion: {
      repo: IRechazoTiendaCobroAnulacionRepository;
      caja: ICajaRechazoTiendaCobroFeedService;
    },
    /**
     * ⚠️ EL INTERRUPTOR Q3 DE LA FEATURE 43, LEIDO EN UN SOLO PUNTO, igual que en
     * `WalletTiendaFeedService`. Si `TIENDA_DEBITA_FLETE_DEVOLUCION` es `false`, el ledger de la
     * tienda NO recibe los dos debitos de devolucion (los absorbe Ordenex) y la caja SI recibe
     * sus dos ingresos.
     *
     * Se respeta aqui porque el encargo es que los apuntes sean LOS MISMOS que emite hoy la
     * aprobacion del cierre, y ese camino lo respeta. Ignorarlo haria que la misma politica de
     * la casa se aplicara por una via y no por la otra — que es exactamente la clase de
     * divergencia silenciosa que la 43 escribio su R28 para impedir.
     *
     * Se inyecta (con default al singleton) para poder verificar los DOS estados en test sin
     * manipular variables de entorno.
     */
    private readonly config: Pick<
      WalletTiendaConfig,
      "TIENDA_DEBITA_FLETE_DEVOLUCION"
    > = walletTiendaConfig,
  ) {}

  /**
   * La COLA: los pendientes del mas antiguo al mas reciente, recortados al tope del servidor, y
   * el `total` REAL aparte.
   *
   * `total` NO es `items.length` y esa diferencia importa: `items` viene recortado, asi que si
   * algun dia hubiera mas cobros que el tope, el numero lo diria y la pantalla no mentiria. El
   * tope sale de `lib/config/rechazo-tienda-cobro.ts`, no de un literal escrito aqui.
   */
  async listarPendientes(actor: Actor): Promise<ListarCobrosRechazoTiendaServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" };

    const items = await this.cobroRepo.listarPendientes(rechazoTiendaCobroConfig.MAX_PAGE_SIZE);
    const total = await this.cobroRepo.contarPendientes();
    return { status: "ok", items, total };
  }

  /**
   * ⚠️ EL METODO QUE MUEVE DINERO. Cada paso esta donde esta por una razon que se puede romper:
   *
   *  1. **Guardia de rol ANTES de todo.** Quien no tiene acceso total no llega ni a abrir la
   *     transaccion.
   *  2. **Todo lo demas dentro de UNA transaccion**: o nacen los CUATRO apuntes y el cobro queda
   *     `aprobado`, o no ocurre ninguna de las dos cosas. Media aprobacion —el cobro marcado y la
   *     caja sin el ingreso— seria plata perdida sin rastro.
   *  3. `marcarDecidido` lleva **`WHERE id AND estado = 'pendiente'`** y su `count` ES la
   *     respuesta. Bajo `READ COMMITTED` la segunda de dos aprobaciones simultaneas espera el
   *     bloqueo de fila, re-evalua el `WHERE` tras el commit de la primera, afecta CERO filas y
   *     sale sin escribir. **No se sustituye por un `SELECT` previo**: eso seria un check-then-act
   *     con su ventana TOCTOU. La lectura de arriba solo distingue `not_found`.
   *  4. Los apuntes se escriben con **la clave que el cobro guardo** (`gestionId`) y con **los
   *     importes que el cobro copio**. Los importes NO se recalculan desde la tarifa: si alguien
   *     la edito entre el rechazo y la aprobacion, se cobraria algo que nadie autorizo.
   *  5. Los dos libros se alimentan en el MISMO orden que la aprobacion del cierre: primero la
   *     caja de Ordenex (42), despues el libro de la tienda (43).
   *
   * ⚠️ NO HAY COLUMNA `movimiento_id` EN ESTA TABLA, y es deliberado (a diferencia de la 333, que
   * si la tiene): alli un cobro salda UN movimiento; aqui son CUATRO —dos por libro—, asi que un
   * FK escalar no podria representarlo y una tabla de enlace seria maquinaria para nada. El
   * vinculo existe y es consultable: los cuatro apuntes llevan `origen_tipo = 'gestion_orden'` y
   * `origen_id = <gestionId>`, que es unico por libro y por categoria.
   */
  async aprobar(
    input: DecidirCobroRechazoTiendaInput,
    actor: Actor,
    ahora: Date,
  ): Promise<AprobarCobroRechazoTiendaServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" };

    return this.runTx(async (tx: RechazoTiendaCobroTx) => {
      const cobro = await this.cobroRepo.obtenerPorId(input.id, tx);
      if (cobro === null) return { status: "not_found" }; // sin escribir nada

      // La transicion ES la serializacion. `0` = alguien decidio antes (o a la vez). La
      // transaccion termina sin haber escrito una sola fila: hasta aqui solo hubo lecturas.
      const decididos = await this.cobroRepo.marcarDecidido(
        tx,
        input.id,
        "aprobado",
        actor.usuarioId,
        ahora,
      );
      if (decididos === 0) return { status: "ya_decidido" };

      // (1) LA CAJA DE ORDENEX (feature 42). Idempotente por
      //     `wallet_movimiento_origen_categoria_uq`: reintentar NO emite un segundo ingreso, y la
      //     barrera es la BASE, no un `if` de aqui.
      const insertadasCaja = await this.movimientoRepo.crearMovimientos(
        tx,
        this.movimientosDeCaja(cobro, actor),
      );

      // (2) EL LIBRO DE LA TIENDA (feature 43), TRAS la caja y en la MISMA tx (todo-o-nada),
      //     exactamente en el orden en que lo hace la aprobacion del cierre.
      await this.movimientoTiendaRepo.crearMovimientos(tx, this.movimientosDeTienda(cobro, actor));

      return { status: "ok", yaEstabaEnElLibro: insertadasCaja === 0 };
    });
  }

  /**
   * Deja el cobro en `rechazado` con quien y cuando, y NO escribe absolutamente nada en ningun
   * libro.
   *
   * NO abre transaccion, y no es un descuido: la decision es UNA sentencia condicional
   * (`UPDATE … WHERE id AND estado = 'pendiente'`), que ya es atomica por si sola. La lectura
   * previa solo distingue `not_found` de `ya_decidido`; si la fila cambiara entre las dos, el
   * `count` de la transicion seguiria mandando.
   *
   * Efecto lateral BUSCADO: el cobro rechazado CONSERVA su `gestion_id`, asi que
   * `rechazo_tienda_cobro_gestion_uq` impide que ese mismo rechazo vuelva a darse de alta. El
   * «no» del administrador es durable — que es justo lo que un indice PARCIAL
   * (`WHERE estado='pendiente'`) habria roto, y por eso el indice es total.
   */
  async rechazar(
    input: DecidirCobroRechazoTiendaInput,
    actor: Actor,
    ahora: Date,
  ): Promise<RechazarCobroRechazoTiendaServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" };

    const cobro = await this.cobroRepo.obtenerPorId(input.id);
    if (cobro === null) return { status: "not_found" };

    const decididos = await this.cobroRepo.marcarDecidido(
      this.writeClient,
      input.id,
      "rechazado",
      actor.usuarioId,
      ahora,
    );
    return decididos === 0 ? { status: "ya_decidido" } : { status: "ok" };
  }

  /**
   * ⚠️ FICHA 458-B (D7, R63–R68, R73) — ANULA un cobro por rechazo YA APROBADO. Mueve dinero.
   *
   * LA DECISION ATOMICA DE `aprobar` NO SE TOCA: esto no des-aprueba. El cobro conserva
   * `estado = 'aprobado'` (R73: la cola no lo vuelve a ofrecer y nadie lo vuelve a decidir) y
   * «anulado» se deriva de que exista la constancia en `rechazo_tienda_cobro_anulacion` —el patron
   * de la 172, la 459, la 461 y la 457—. Ni la gestion ni la orden se tocan.
   *
   * EL ORDEN ES PARTE DEL REQUISITO:
   *  1. ROL PRIMERO (R82), antes de leer nada.
   *  2. El cobro, y SOLO si esta `aprobado` (`pendiente`/`rechazado` no movieron dinero: nada que
   *     anular).
   *  3. Dentro de UNA transaccion: las lineas ORIGINALES del cobro en los dos libros. Sin el
   *     ingreso del flete en la caja no hay cargo que revertir: `no_anulable` sin escribir nada
   *     (un reverso sin su original romperia R8).
   *  4. La constancia: `skipDuplicates` con `count = 0` ⇒ `ya_anulado` y la transaccion se revierte
   *     sin haber escrito nada mas (R66/R67).
   *  5. Los reversos de cargo en la caja, cada uno por el monto de SU linea original (R64/R68).
   *  6. Los creditos espejo en la tienda SOLO por los debitos que existen: si al aprobar el
   *     interruptor `TIENDA_DEBITA_FLETE_DEVOLUCION` estaba apagado, la tienda no fue debitada y no
   *     se le acredita nada (R68: el efecto inverso EXACTO del original).
   *
   * Efecto (design §4.3): saldo de la tienda +M, «De las tiendas» +M, ganancia −M; «Entro»,
   * «Salio» y la cifra principal no cambian. R7 y R8 siguen en 0,00.
   */
  async anular(
    input: AnularCobroRechazoTiendaInput,
    actor: Actor,
    ahora: Date,
  ): Promise<AnularCobroRechazoTiendaServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R82: antes de leer

    const cobro = await this.cobroRepo.obtenerPorId(input.cobroId);
    if (cobro === null) return { status: "no_encontrado" };
    if (cobro.estado !== "aprobado") return { status: "no_anulable", motivo: "no_aprobado" };

    try {
      return await this.runTx(async (tx: RechazoTiendaCobroTx) => {
        const lineas = await this.anulacion.repo.lineasDelCobro(tx, {
          gestionId: cobro.gestionId,
          tiendaId: cobro.tiendaId,
        });
        const flete = lineas.caja.find((l) => l.categoria === CONCEPTO_FLETE) ?? null;
        const iva = lineas.caja.find((l) => l.categoria === CONCEPTO_IVA) ?? null;
        if (flete === null) {
          return { status: "no_anulable" as const, motivo: "sin_linea_de_caja" as const };
        }

        const constancia = await this.anulacion.repo.anular(tx, {
          cobroId: cobro.id,
          motivo: input.motivo,
          anuladoPor: actor.usuarioId,
        });
        if (constancia.status === "ya_anulado") throw new CobroYaAnuladoError(); // R66/R67

        // (1) LA CAJA: los reversos de cargo, por el monto de SU linea (nunca uno de la peticion).
        const esperados = iva === null ? 1 : 2;
        const insertados = await this.anulacion.caja.emitirReversosDeAnulacion(tx, {
          gestionId: cobro.gestionId,
          montoFlete: flete.monto,
          montoIva: iva?.monto ?? null,
          descripcion: null,
          registradoPor: actor.usuarioId,
          fechaMovimiento: ahora, // R64: el MISMO instante en los dos libros
        });
        // Un reverso que ya estaba SIN constancia no deberia existir (solo este metodo lo escribe);
        // si aparece, la base no esta como este codigo cree: se revierte todo, ruidosamente.
        if (insertados !== esperados) {
          throw new Error(
            `rechazo-tienda-cobro: la anulacion del cobro ${cobro.id} esperaba ${esperados} reversos y escribio ${insertados}`,
          );
        }

        // (2) LA TIENDA: un credito espejo por cada debito que EXISTE, por su monto.
        const creditos: CrearMovimientoTiendaInput[] = lineas.tienda.map((debito) => ({
          tiendaId: cobro.tiendaId,
          tipo: "credito" as const,
          categoria:
            debito.categoria === "flete_devolucion"
              ? ("flete_devolucion_anulado" as const)
              : ("iva_flete_devolucion_anulado" as const),
          monto: debito.monto,
          origenTipo: ORIGEN_TIPO,
          origenId: cobro.gestionId,
          descripcion: null,
          registradoPor: actor.usuarioId,
          fechaMovimiento: ahora,
        }));
        // FICHA 458-B (revision m4): por simetria con la caja, se CUENTA lo escrito. Un credito espejo
        // que no se escribe dejaria a la tienda sin su devolucion con la caja ya revertida (R8 roto):
        // se revierte todo, ruidosamente.
        if (creditos.length > 0) {
          const escritos = await this.movimientoTiendaRepo.crearMovimientos(tx, creditos);
          if (escritos !== creditos.length) {
            throw new Error(
              `rechazo-tienda-cobro: la anulacion del cobro ${cobro.id} esperaba ${creditos.length} creditos espejo y escribio ${escritos}`,
            );
          }
        }

        // Sin sumar aqui (este servicio no calcula dinero): los dos importes tal como se anularon.
        return {
          status: "ok" as const,
          montoFlete: flete.monto,
          montoIva: iva?.monto ?? null,
          creditosEnLaTienda: creditos.length > 0,
        };
      });
    } catch (error) {
      if (error instanceof CobroYaAnuladoError) return { status: "ya_anulado" };
      throw error;
    }
  }

  /**
   * Los INGRESOS de la caja de Ordenex: los mismos dos conceptos, con los mismos importes, que
   * `WalletFeedService` mete hoy al aprobar el cierre de una `rechazada`. Lo unico distinto es el
   * ORIGEN —la gestion en vez del cierre—, que es lo que le da su propia clave de idempotencia.
   *
   * `descripcion` va a `null` igual que en el feed del cierre: el origen ya apunta a la gestion, y
   * la gestion a la orden. `registradoPor` SI lleva a quien aprobo (el feed del cierre escribe
   * `null` porque alli no hay un actor por fila): es la evidencia de quien autorizo este cobro, y
   * no es dinero.
   */
  private movimientosDeCaja(
    cobro: RechazoTiendaCobroRegistro,
    actor: Actor,
  ): CrearMovimientoInput[] {
    const base = {
      tipo: "ingreso" as const,
      origenTipo: ORIGEN_TIPO,
      origenId: cobro.gestionId, // LA CLAVE
      descripcion: null,
      registradoPor: actor.usuarioId,
    };
    const movs: CrearMovimientoInput[] = [
      { ...base, categoria: CONCEPTO_FLETE, monto: cobro.montoFlete },
    ];
    // R10 de la 42: un concepto en 0.00 NO se emite. Solo el IVA puede serlo (el flete lleva su
    // CHECK > 0 en la base).
    if (aporta(cobro.montoIva)) {
      movs.push({ ...base, categoria: CONCEPTO_IVA, monto: cobro.montoIva });
    }
    return movs;
  }

  /**
   * Los DEBITOS del libro de la tienda: el espejo 1:1 de los ingresos de arriba, por
   * `conceptoIngresoADebitoTienda` (feature 43/R8) y no por literales — si un dia cambia el mapeo,
   * cambia en un sitio.
   *
   * La tienda es la CONGELADA en la fila del cobro, no la que la orden diga hoy.
   *
   * Devuelve `[]` cuando el interruptor `TIENDA_DEBITA_FLETE_DEVOLUCION` esta apagado: ese es
   * exactamente el comportamiento del feed del cierre, que descarta estos dos debitos sin tocar
   * la caja.
   */
  private movimientosDeTienda(
    cobro: RechazoTiendaCobroRegistro,
    actor: Actor,
  ): CrearMovimientoTiendaInput[] {
    if (!this.config.TIENDA_DEBITA_FLETE_DEVOLUCION) return [];

    const base = {
      tiendaId: cobro.tiendaId, // CONGELADA
      tipo: "debito" as const,
      origenTipo: ORIGEN_TIPO,
      origenId: cobro.gestionId, // LA MISMA CLAVE que en la caja
      descripcion: null,
      registradoPor: actor.usuarioId,
    };
    const movs: CrearMovimientoTiendaInput[] = [
      {
        ...base,
        categoria: conceptoIngresoADebitoTienda(CONCEPTO_FLETE),
        monto: cobro.montoFlete,
      },
    ];
    if (aporta(cobro.montoIva)) {
      movs.push({
        ...base,
        categoria: conceptoIngresoADebitoTienda(CONCEPTO_IVA),
        monto: cobro.montoIva,
      });
    }
    return movs;
  }
}
