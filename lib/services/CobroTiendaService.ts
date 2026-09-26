import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";

import { esAccesoTotal } from "@/lib/auth/acceso-total";
import type { ICobroTiendaAnulacionRepository } from "@/lib/interfaces/repositories/ICobroTiendaAnulacionRepository";
import type { IUserRepository } from "@/lib/interfaces/repositories/IUserRepository";
import type { IWalletTiendaMovimientoRepository } from "@/lib/interfaces/repositories/IWalletTiendaMovimientoRepository";
import type { ICajaCobroTiendaFeedService } from "@/lib/interfaces/services/ICajaCobroTiendaFeedService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  AnularCobroTiendaServiceResult,
  CobroTiendaTxRunner,
  ICobroTiendaService,
  RegistrarCobroTiendaServiceResult,
} from "@/lib/interfaces/services/ICobroTiendaService";
import type {
  AnularCobroTiendaInput,
  RegistrarCobroTiendaInput,
  SaldoTiendaDTO,
} from "@/lib/types/wallet-tienda";
import {
  descripcionAnulacionCobro,
  descripcionCobroEnCaja,
} from "@/lib/utils/descripcion-cobro-tienda";
import { instanteDelMovimientoManual } from "@/lib/utils/fecha-movimiento-manual";
import { derivarSaldoTienda } from "@/lib/utils/saldo-tienda";

/** El unico rol que puede ser destinataria de un cobro: una cuenta de tienda de verdad. */
const ROL_TIENDA = "adminTienda";

/** El unico estado de la tienda que admite un cobro nuevo. */
const ESTADO_TIENDA = "activo";

/**
 * Los tres rechazos de la tienda, SEPARADOS a proposito (molde: `ApiKeyService`). Devolver el mismo
 * texto para los tres dejaria a quien registra sin saber cual arreglar. Los textos son los de la 381
 * y no cambian (R6 de la 461).
 */
const MSG_TIENDA = {
  inexistente: "La tienda no existe",
  rol: "La cuenta elegida no es una tienda",
  inactiva: "La tienda no esta activa",
} as const;

function errorDeTienda(mensaje: string): RegistrarCobroTiendaServiceResult {
  return { status: "validation_error", fieldErrors: { tiendaId: [mensaje] } };
}

/** Señal interna: el choque del UNIQUE de la anulacion se responde FUERA de la transaccion (que revierte). */
class YaAnuladoError extends Error {
  constructor() {
    super("cobro a tienda: ya anulado");
    this.name = "YaAnuladoError";
  }
}

/** Ficha 461 (R68): la clave del cliente ya tenia su cobro; sale de la transaccion (que revierte). */
class ClaveRepetidaError extends Error {
  constructor() {
    super("cobro a tienda: clave de idempotencia repetida");
    this.name = "ClaveRepetidaError";
  }
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * FICHA 381 → 461 — ORDENEX LE COBRA A UNA TIENDA (y puede anular ese cobro).
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Un cobro es el debito `cobro_manual` en el libro de ESA tienda, MAS —desde la 461, HD1 firmada por
 * el humano el 2026-09-25— su linea en la caja: un ingreso PROPIO de liquidez «cargo»
 * (`ingreso_cobro_tienda`) por el mismo monto y el mismo instante. Con las palabras del humano de la
 * 381 («es quitar del dinero disponible de esa tienda») y de la 461: ese dinero pasa a ser de
 * Ordenex. La ganancia sube, «De las tiendas» baja lo mismo y «Entro» no cambia (R4): es el mismo
 * patron que el flete (debito espejo + ingreso propio «cargo»).
 *
 * ⚠️ SI TOCA LA CAJA, Y ES OBLIGATORIO (R9). Este servicio recibe el puerto de caja por constructor
 * y NO se construye sin el. Es el contrario exacto de la 381 (D1/R24: «no toca la caja, no lo recibe
 * por constructor»): aquella decision fue un error de diseño que dejo un cobro de 42.000 sin rastro
 * en la caja ni en la ganancia (encargo de la 461), y la P3 de la 459 la mantuvo declarando una
 * excepcion en la invariante R8. Con esta ficha la excepcion desaparece: «De las tiendas» = Σ saldos
 * de las tiendas, sin excepciones (HD2).
 *
 * ⚠️ SIN CANDADO Y SIN COMPROBACION DE DISPONIBLE, Y ES DELIBERADO (R5 de la 461, R27 de la 381,
 * P11). `registrarPagoTienda` toma `bloquearBeneficiario` porque COMPARA el monto contra un
 * disponible, y dos transacciones simultaneas pagarian de mas. Un cobro no compara nada contra nada:
 * no hay tope, el saldo puede quedar negativo por decision firmada, y el saldo se deriva de la suma
 * del ledger, que es correcta con cualquier orden de insercion. La idempotencia de la anulacion la da
 * el UNIQUE sobre el cobro.
 *
 * ⚠️ SERVICIO PROPIO Y NO UN METODO EN `WalletTiendaService`: aquel es de LECTURA —listados, saldos,
 * desglose, cierres—, se construye con un solo repositorio y lo instancian siete acciones.
 * `LiquidacionService` es el precedente explicito: las escrituras de dinero viven en su propio
 * servicio.
 */
export class CobroTiendaService implements ICobroTiendaService {
  constructor(
    private readonly tiendaRepo: IWalletTiendaMovimientoRepository,
    private readonly usuarioRepo: Pick<IUserRepository, "obtenerCuentaTienda">,
    /** R9: OBLIGATORIO. Sin caja no se construye: un cobro sin su linea de caja es el fallo de la ficha. */
    private readonly caja: ICajaCobroTiendaFeedService,
    /** La constancia de la anulacion y su historial (R10/R15/R17). */
    private readonly anulaciones: ICobroTiendaAnulacionRepository,
    private readonly runTransaction: CobroTiendaTxRunner,
    /** R3/R11: el MISMO instante para todas las filas de una operacion. Inyectable para los tests. */
    private readonly ahora: () => Date = () => new Date(),
  ) {}

  /**
   * EL ORDEN DE LOS PASOS ES PARTE DEL REQUISITO:
   *
   *  1. ROL PRIMERO (R8), ANTES de tocar la base. Un `forbidden` evaluado despues del `SELECT` ya
   *     habria leido el dinero para tirarlo.
   *  2. ESCALA 2 FIJADA UNA VEZ. El MISMO string va al debito, a la linea de caja y al historial,
   *     asi que los tres libros no pueden discrepar por un redondeo (R3). Ni un `Number()`.
   *  3. LA TIENDA, VALIDADA EN EL SERVIDOR (R6), con los tres textos de la 381. FUERA de la
   *     transaccion: es una lectura de catalogo y NINGUNO de los tres rechazos escribe nada.
   *  4. EL INSTANTE, fijado UNA vez por el servicio (R3): con «hoy», `this.ahora()` —y NO el DEFAULT
   *     de cada columna: Prisma rellena `@default(now())` fila a fila en el cliente y el debito y la
   *     linea de caja quedarian con instantes distintos (medido en la 459: 4 ms)—; con un dia anterior,
   *     el inicio de ese dia en Costa Rica. Es la misma correccion que la 459 hizo en el pago por
   *     cuenta; respecto de la 381, el debito con «hoy» deja de caer en el DEFAULT (mismo dia CR).
   *  5. LAS TRES ESCRITURAS EN UNA TRANSACCION (R1): el debito, su historial y la linea de caja, o
   *     ninguna. El `id` se genera AQUI: `createMany` no devuelve ids y la linea de caja y el
   *     historial lo necesitan.
   *  6. El saldo DESPUES, derivado del ledger. Puede ser negativo y se devuelve entero (R5).
   */
  async registrarCobro(
    input: RegistrarCobroTiendaInput,
    actor: Actor,
  ): Promise<RegistrarCobroTiendaServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R8: antes de tocar la base

    // Escala 2 fijada UNA vez, desde el STRING. `montoStr` es lo unico que viaja de aqui en adelante.
    const montoStr = new Prisma.Decimal(input.monto)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
      .toFixed(2);

    // R6: existe / es cuenta de tienda / esta activa. Tres mensajes distintos, todos bajo `tiendaId`,
    // y NINGUNO escribe nada.
    const cuenta = await this.usuarioRepo.obtenerCuentaTienda(input.tiendaId);
    if (cuenta === null) return errorDeTienda(MSG_TIENDA.inexistente);
    if (cuenta.rol !== ROL_TIENDA) return errorDeTienda(MSG_TIENDA.rol);
    if (cuenta.estado !== ESTADO_TIENDA) return errorDeTienda(MSG_TIENDA.inactiva);

    const id = randomUUID();
    // R3: UN instante para el debito y la linea de caja.
    const ahora = this.ahora();
    const fechaMovimiento = instanteDelMovimientoManual(input.fecha, ahora) ?? ahora;

    try {
      await this.runTransaction(async (tx) => {
        // El debito, igual que en la 381: categoria propia de los cobros, `origen_tipo: manual` y
        // `origen_id: null` (fuera del indice unico parcial), y la descripcion que tecleo la persona,
        // TAL CUAL (R7). Ficha 461 (R66/R67/R68, auditoria D2): + la CLAVE del cliente, UNIQUE en la
        // fila. Si `createMany` devuelve 0, la clave ya tenia su cobro: se sale de la transaccion
        // ANTES del historial y de la linea de caja, y no queda ni una fila nueva.
        const escritas = await this.tiendaRepo.crearMovimientos(tx, [
          {
            id,
            tiendaId: input.tiendaId,
            tipo: "debito",
            categoria: "cobro_manual",
            monto: montoStr,
            origenTipo: "manual",
            origenId: null,
            descripcion: input.descripcion,
            registradoPor: actor.usuarioId,
            fechaMovimiento,
            claveIdempotencia: input.claveIdempotencia,
          },
        ]);
        if (escritas === 0) throw new ClaveRepetidaError();
        // El rastro, en LA MISMA transaccion y por el MISMO importe.
        await this.tiendaRepo.registrarCobroEnHistorial(tx, {
          cobroId: id,
          tiendaId: input.tiendaId,
          monto: montoStr,
          actorUsuarioId: actor.usuarioId,
        });
        // R1/R2/R4 (HD1): la linea de caja del cobro —el CARGO—, por el MISMO monto y el MISMO
        // instante, vinculada al debito por `(cobro_tienda, id)`, descrita con el nombre de la tienda
        // y la descripcion, sin ningun id (R7). Sin esta linea, la ganancia no sube y R8 se rompe.
        const tiendaNombre = await this.tiendaRepo.nombreDeTienda(tx, input.tiendaId);
        await this.caja.emitirCargoDeCobro(tx, {
          cobroId: id,
          monto: montoStr,
          descripcion: descripcionCobroEnCaja(tiendaNombre, input.descripcion),
          registradoPor: actor.usuarioId,
          fechaMovimiento,
        });
      });
    } catch (error) {
      if (error instanceof ClaveRepetidaError) {
        // R68: el segundo envio responde con el cobro ORIGINAL y el saldo actual, sin escribir nada.
        const original = await this.tiendaRepo.obtenerCobroPorClave(input.claveIdempotencia);
        if (original === null) {
          throw new Error("cobro-tienda: clave de idempotencia repetida sin cobro que releer");
        }
        return { status: "ya_registrado", cobro: original, saldo: await this.saldoDe(original.tiendaId) };
      }
      throw error;
    }

    // Se relee POR ID Y POR TIENDA, no «el mas reciente de esta categoria»: con una fecha del pasado
    // el mas reciente seria OTRO cobro, y el servicio afirmaria «este es el que registraste» sobre
    // una fila ajena. Es la leccion escrita de la ficha 334.
    const cobro = await this.tiendaRepo.obtenerPorIdDeTienda(id, input.tiendaId);
    if (cobro === null) {
      // Imposible por construccion: `createMany` devolvio 1, asi que la fila con ESTE id existe. Se
      // propaga con contexto en vez de devolver una fila inventada: en un libro de dinero, mentir es
      // peor que fallar.
      throw new Error(`cobro-tienda: el cobro ${id} no se pudo releer tras insertarlo`);
    }

    // R5: el saldo DESPUES del cobro, derivado del ledger entero (sin filtros) y con su signo
    // calculado en el SERVIDOR. PUEDE ser negativo, y se devuelve entero.
    return { status: "ok", cobro, saldo: await this.saldoDe(input.tiendaId) };
  }

  /**
   * R10–R18 — la ANULACION. EL ORDEN ES PARTE DEL REQUISITO:
   *
   *  1. ROL PRIMERO (R18), antes de leer el cobro.
   *  2. El COBRO, por su id y SOLO si es un `debito/cobro_manual` (R16): otra fila del libro o un id
   *     inexistente responden `no_encontrado`, sin escribir nada.
   *  3. Su ESTADO, fuera de la transaccion (R15/R17): reclasificado por la 459 → `no_anulable`
   *     (su dinero nunca fue ganancia y su salida ya esta en la caja como pago de un gasto, P12);
   *     sin linea de caja de cobro (ni propia ni completada) → `no_anulable` (no hay cargo que
   *     revertir); ya anulado → `ya_anulado`.
   *  4. UN instante (R11): el de la anulacion, hoy CR, para los dos contra-asientos.
   *  5. LA TRANSACCION (R10): constancia + historial (el UNIQUE del cobro es el candado de R15: si
   *     llegan dos a la vez, la segunda choca y todo lo suyo se revierte) → credito
   *     `cobro_tienda_anulado` a la tienda por el monto DEL COBRO (R13) → reverso del cargo en la caja
   *     por el mismo monto (R12). Ni el cobro, ni su debito, ni su linea original se tocan (R11).
   *  6. El saldo DESPUES, con su signo.
   *
   * Sin candado de tienda (P11): nada se compara contra un disponible.
   */
  async anular(input: AnularCobroTiendaInput, actor: Actor): Promise<AnularCobroTiendaServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R18: antes de leer el cobro

    const cobro = await this.tiendaRepo.obtenerCobroPorId(input.cobroId);
    if (cobro === null) return { status: "no_encontrado" }; // R16

    const estado = await this.anulaciones.estadoDelCobro(cobro.id);
    if (estado.reclasificado) return { status: "no_anulable", motivo: "reclasificado" }; // R17, P12
    if (!estado.tieneCargo) return { status: "no_anulable", motivo: "sin_linea_de_caja" }; // R17
    if (estado.anulado) return { status: "ya_anulado" }; // R15 (el UNIQUE cubre la carrera)

    const instante = this.ahora(); // R11: el MISMO instante para los dos contra-asientos

    try {
      await this.runTransaction(async (tx) => {
        const constancia = await this.anulaciones.anular(tx, {
          cobroId: cobro.id,
          motivo: input.motivo,
          anuladoPor: actor.usuarioId,
        });
        if (constancia.status === "ya_anulado") throw new YaAnuladoError();

        // R10/R13: el credito compensatorio a la tienda por el monto DEL COBRO, nunca uno de la
        // peticion. Origen `(cobro_tienda, cobroId)`: idempotente por `wallet_tienda_movimiento_origen_uq`.
        await this.tiendaRepo.crearMovimientos(tx, [
          {
            tiendaId: cobro.tiendaId,
            tipo: "credito",
            categoria: "cobro_tienda_anulado",
            monto: cobro.monto,
            origenTipo: "cobro_tienda",
            origenId: cobro.id,
            descripcion: descripcionAnulacionCobro(cobro.descripcion),
            registradoPor: actor.usuarioId,
            fechaMovimiento: instante,
          },
        ]);
        // R10/R12: el REVERSO del cargo en la caja, mismo monto, mismo instante, mismo origen.
        await this.caja.emitirReversoDeCobro(tx, {
          cobroId: cobro.id,
          monto: cobro.monto,
          descripcion: descripcionAnulacionCobro(
            descripcionCobroEnCaja(cobro.tiendaNombre, cobro.descripcion),
          ),
          registradoPor: actor.usuarioId,
          fechaMovimiento: instante,
        });
      });
    } catch (error) {
      if (error instanceof YaAnuladoError) return { status: "ya_anulado" }; // R15
      throw error;
    }

    return { status: "ok", saldo: await this.saldoDe(cobro.tiendaId) };
  }

  /**
   * El saldo de la tienda, derivado del ledger ENTERO (sin filtros) con su signo en el servidor.
   * Propiedad de instancia y no metodo de prototipo A PROPOSITO: `ICobroTiendaService` son DOS
   * metodos y ni uno mas (R19), y el test lo mide sobre el prototipo.
   */
  private readonly saldoDe = async (tiendaId: string): Promise<SaldoTiendaDTO> => {
    const agregado = await this.tiendaRepo.agregarSaldoPorTienda(tiendaId, {});
    return derivarSaldoTienda(agregado.creditos, agregado.debitos);
  };
}
