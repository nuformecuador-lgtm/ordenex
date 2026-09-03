import { Prisma } from "@prisma/client";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  BeneficiarioBloqueo,
  CierreParaPagoDTO,
  CrearLiquidacionPagoResult,
  ILiquidacionPagoRepository,
  LiquidacionPagoDTO,
} from "@/lib/interfaces/repositories/ILiquidacionPagoRepository";
import type { ILiquidacionRepartoRepository } from "@/lib/interfaces/repositories/ILiquidacionRepartoRepository";
import type { IPagoMensajeroMovimientoRepository } from "@/lib/interfaces/repositories/IPagoMensajeroMovimientoRepository";
import type { IWalletTiendaMovimientoRepository } from "@/lib/interfaces/repositories/IWalletTiendaMovimientoRepository";
import type { ICajaPagoTiendaFeedService } from "@/lib/interfaces/services/ICajaPagoTiendaFeedService";
import type {
  AnularPagoServiceResult,
  AnularRepartoServiceResult,
  ILiquidacionService,
  ListarPagosServiceResult,
  LiquidacionTx,
  LiquidacionTxRunner,
  PrevisualizarRepartoServiceResult,
  RegistrarPagoServiceResult,
  RegistrarRepartoServiceResult,
} from "@/lib/interfaces/services/ILiquidacionService";
import type {
  AnulacionDTO,
  AnularPagoInput,
  AnularRepartoInput,
  MetodoLiquidacion,
  PagoRegistradoDTO,
  RegistrarPagoMensajeroInput,
  RegistrarPagoTiendaInput,
} from "@/lib/types/liquidacion";
import type {
  ImputacionAplicadaDTO,
  PrevisualizarRepartoInput,
  RegistrarRepartoMensajeroInput,
} from "@/lib/types/liquidacion-reparto";
import { esAccesoTotal } from "@/lib/auth/acceso-total";
import { repartoMensajeroConfig } from "@/lib/config/reparto-mensajero";
import { derivarCuentaPorPagar } from "@/lib/utils/cuenta-por-pagar";
import {
  descripcionDeAnulacion,
  descripcionDePago,
  medianocheUtcDelDia,
} from "@/lib/utils/descripcion-pago";
import { fechaCalendarioCR } from "@/lib/utils/fecha-cr";
import { derivarPendienteCierre } from "@/lib/utils/pendiente-cierre";
import {
  ordenarCierresFifo,
  repartirEntreCierres,
  type CierreImputable,
} from "@/lib/utils/reparto-liquidacion-mensajero";
import { derivarSaldoTienda } from "@/lib/utils/saldo-tienda";

/**
 * Señal interna del choque de `clave_idempotencia` (§4.1). NO es un fallo: es el desenlace
 * previsto del doble submit. Se lanza para SALIR de la transaccion —en Postgres, un error de
 * sentencia deja la transaccion abortada y toda sentencia posterior falla— y la relectura del
 * comprobante se hace FUERA, sobre el cliente propio del repositorio.
 *
 * Es privada del modulo a proposito: nadie fuera necesita distinguirla, porque nunca escapa de
 * `registrarPagoTienda`.
 */
class ClaveRepetidaError extends Error {
  constructor() {
    super("liquidacion: clave de idempotencia ya usada");
    this.name = "ClaveRepetidaError";
  }
}

/**
 * T F.2/R75 — la hermana de la anterior para el `UNIQUE(pago_id)` de la anulacion, y existe por
 * la misma razon tecnica: en Postgres un error de sentencia deja la transaccion ABORTADA, asi
 * que no se puede releer el comprobante dentro de ella. Se lanza para salir y la relectura
 * ocurre FUERA. Tampoco escapa nunca de `anularPago`.
 */
class YaAnuladoError extends Error {
  constructor() {
    super("liquidacion: el pago ya estaba anulado");
    this.name = "YaAnuladoError";
  }
}

/**
 * Feature 205 (§5.1/R28/R29) — la tercera hermana, para el `UNIQUE(clave_idempotencia)` de
 * `liquidacion_reparto`, y existe por la MISMA razon tecnica que las dos de arriba: en Postgres
 * un error de sentencia deja la transaccion ABORTADA, asi que el reparto original no se puede
 * releer dentro de ella. Se lanza para salir y la relectura ocurre FUERA.
 *
 * La fila del reparto se inserta LA PRIMERA de la transaccion, antes de mover un centimo: cuando
 * esta señal salta no hay ni un pago escrito que revertir, solo la transaccion vacia. Nunca
 * escapa de `registrarRepartoMensajero`.
 */
class RepartoRepetidoError extends Error {
  constructor() {
    super("liquidacion: clave de idempotencia del reparto ya usada");
    this.name = "RepartoRepetidoError";
  }
}

/**
 * Feature 205 — el caso IMPOSIBLE-EN-TEORIA de la escritura del reparto: la clave derivada de
 * una imputacion (`<clave del reparto>:<cierreId>`) ya existe.
 *
 * No puede ocurrir: esa clave solo la acuña este metodo, y para repetirla haria falta repetir la
 * clave DEL REPARTO — que el `UNIQUE` de `liquidacion_reparto` ya rechazo tres pasos antes, antes
 * de escribir nada. Si aun asi ocurriera, lo correcto es **fallar y revertirlo todo** (R20): un
 * reparto al que le falta una imputacion es dinero comprometido que no se aplico, y devolver `ok`
 * con menos filas de las debidas seria mentir sobre lo que se pago. No se traduce a ningun estado
 * de respuesta a proposito — no hay ninguno que describa esto sin inventarselo.
 */
class ImputacionRepetidaError extends Error {
  constructor(cierreId: string) {
    super(`liquidacion: la imputacion al cierre ${cierreId} choco con una clave ya usada`);
    this.name = "ImputacionRepetidaError";
  }
}

/**
 * Feature 205 (§2.3) — lo que el ESCRITOR UNICO necesita para dejar un pago contra un cierre:
 * el documento y su movimiento en el libro del mensajero.
 *
 * Los nueve campos son los mismos que escribe hoy el pago contra un cierre unico, y el tipo
 * existe para que los dos caminos —el pago simple y cada imputacion de un reparto— no puedan
 * pasar cosas distintas. `repartoId` es el unico que difiere entre ellos, y es obligatorio: cada
 * escritor declara a que acto pertenece lo que escribe, o `null` si no pertenece a ninguno.
 */
interface PagoDeCierreEscrito {
  claveIdempotencia: string;
  mensajeroId: string;
  cierreId: string;
  /** STRING escala 2, YA redondeado por quien llama: documento y libro comparten este mismo. */
  monto: string;
  metodo: MetodoLiquidacion;
  referencia: string | null;
  nota: string | null;
  /** Medianoche UTC del dia de pago (`medianocheUtcDelDia`), no el instante de registro. */
  fechaPago: Date;
  registradoPor: string;
  repartoId: string | null;
}

/**
 * R56 — el comprobante tal y como cruza a la pantalla: el documento MENOS los identificadores
 * internos (`mensajeroId`, `tiendaId`, `cierreId`). El `id` del pago si viaja: es lo que la
 * pantalla necesita para pedir su anulacion, y no se pinta ni se descarga.
 *
 * Se escribe campo a campo, no con un `delete` ni con un spread del resto: asi, el dia que el
 * documento gane una columna interna, esta funcion NO la deja pasar sola.
 */
export function aPagoRegistradoDTO(pago: LiquidacionPagoDTO): PagoRegistradoDTO {
  return {
    id: pago.id,
    monto: pago.monto,
    metodo: pago.metodo,
    referencia: pago.referencia,
    nota: pago.nota,
    fechaPago: pago.fechaPago,
    registradoPorNombre: pago.registradoPorNombre,
    registradoAt: pago.registradoAt,
    anulacion: pago.anulacion,
    // Feature 206: un BOOLEANO, no el uuid del reparto. R56 prohibe identificadores internos en
    // este DTO y tres guardias lo hicieron cumplir; el cliente solo necesita saber SI hay grupo.
    esDeReparto: pago.repartoId !== null,
  };
}

/**
 * T F.2 — el BENEFICIARIO de un pago, derivado de la fila y no de la peticion. La base garantiza
 * el XOR (`liquidacion_pago_beneficiario_check`) y que el cierre acompaña al mensajero y solo a
 * el (`liquidacion_pago_cierre_check`), asi que estas dos formas son las unicas posibles; `null`
 * es el caso que la base ya impide y que aqui se responde sin inventar.
 */
type BeneficiarioDelPago =
  | { tipo: "mensajero"; mensajeroId: string; cierreId: string }
  | { tipo: "tienda"; tiendaId: string };

function beneficiarioDelPago(pago: LiquidacionPagoDTO): BeneficiarioDelPago | null {
  if (pago.mensajeroId !== null && pago.cierreId !== null) {
    return { tipo: "mensajero", mensajeroId: pago.mensajeroId, cierreId: pago.cierreId };
  }
  if (pago.tiendaId !== null) return { tipo: "tienda", tiendaId: pago.tiendaId };
  return null;
}

/**
 * R84/§4.2 — EL MISMO bloqueo que tomaria su pago, derivado del propio beneficiario para que no
 * puedan divergir: la fila del CIERRE si se pago a un mensajero, la del USUARIO si se pago a una
 * tienda. Bloquear otra cosa «porque anular es casi solo leer» dejaria a una anulacion y a un
 * registro simultaneos leyendo el mismo disponible, que es justo lo que R84 existe para impedir.
 */
function bloqueoDelBeneficiario(beneficiario: BeneficiarioDelPago): BeneficiarioBloqueo {
  return beneficiario.tipo === "mensajero"
    ? { tipo: "cierre", cierreId: beneficiario.cierreId }
    : { tipo: "tienda", tiendaId: beneficiario.tiendaId };
}

/**
 * Feature 205 — Σ de los pendientes de una lista de cierres imputables, con `Prisma.Decimal` y
 * sin pasar por ningun `number`. Se usa para lo que queda por imputar tras un reparto (el resto
 * de la ventana MAS los recortados) y para el restante de la respuesta idempotente.
 */
function sumarPendientes(cierres: readonly CierreImputable[]): Prisma.Decimal {
  let total = new Prisma.Decimal(0);
  for (const cierre of cierres) total = total.add(new Prisma.Decimal(cierre.pendiente));
  return total;
}

/** R74 — el comprobante con su bloque de anulacion recien puesto, sin releerlo de la base. */
function conAnulacion(pago: LiquidacionPagoDTO, anulacion: AnulacionDTO): PagoRegistradoDTO {
  return { ...aPagoRegistradoDTO(pago), anulacion };
}

/**
 * Feature 172 — logica de negocio de la LIQUIDACION. No conoce HTTP ni Prisma: recibe los
 * repositorios y el ejecutor de transacciones por constructor.
 *
 * **Feature 173 (design §4) — lo que cambio, con nombre y apellido.** La 172 escribio aqui que
 * NO recibia el repositorio de la caja principal «porque emitir el egreso del pago a tienda
 * restaria de la caja un dinero que nunca entro en ella». Esa premisa **cayo del lado de la
 * TIENDA**: desde la Tanda B de la 173, aprobar un cierre mete el contra-entrega en la caja, asi
 * que ese dinero SI esta ahi y entregarlo tiene que restar. Del lado del MENSAJERO la premisa
 * sigue viva y no se toca ([P2] = (a), respuesta humana del 2026-08-03): la caja carga
 * `egreso_pago_mensajero = P` al aprobar y la liquidacion al mensajero no la roza.
 *
 * Lo que se inyecta **no** es `IWalletMovimientoRepository` —sabe escribir cualquier categoria,
 * incluida la del mensajero— sino un PUERTO ESTRECHO de dos metodos que no admite ni tipo ni
 * categoria (R23): este servicio no puede EXPRESAR una escritura en la caja que no sea el egreso
 * de un pago a tienda o su reverso. No es «no la llama»: es que no existe el metodo.
 */
export class LiquidacionService implements ILiquidacionService {
  /**
   * `ahora` es el RELOJ, y solo lo usa la anulacion: R77 exige fechar el contraasiento con el
   * dia de la ANULACION —no con el del pago—, asi que hay que preguntar por «hoy». Se inyecta
   * para poder fijarlo en los tests sin tocar el reloj global, y trae default porque un reloj
   * que se olvida de cablear no puede degradar en silencio: `new Date()` es la respuesta
   * correcta en produccion (a diferencia de un repositorio ausente, que si dejaria una deuda
   * invisible — ver la Tanda C, hallazgo 1).
   */
  constructor(
    private readonly pagoRepo: ILiquidacionPagoRepository,
    private readonly tiendaRepo: IWalletTiendaMovimientoRepository,
    private readonly mensajeroRepo: IPagoMensajeroMovimientoRepository,
    private readonly runTransaction: LiquidacionTxRunner,
    /**
     * Feature 173 (R23) — el puerto de la caja. Va SIN valor por defecto a proposito: un
     * puerto que se olvida de cablear y degrada en silencio dejaria pagos a tienda sin su
     * egreso, que es exactamente la deuda invisible que el reloj de abajo explica como
     * inaceptable. Si falta, no compila.
     */
    private readonly caja: ICajaPagoTiendaFeedService,
    /**
     * Feature 205 (T3.2, R28/R29) — el repositorio del ACTO de repartir. Va SIN valor por
     * defecto y ANTES del reloj por el mismo criterio que el puerto de la caja: sin el no hay
     * barrera de idempotencia para el reparto, y un reparto sin barrera es un doble pago. Si
     * falta, no compila; y como va antes que `ahora`, no hay forma de cablearlo «casi bien».
     */
    private readonly repartoRepo: ILiquidacionRepartoRepository,
    private readonly ahora: () => Date = () => new Date(),
    /**
     * Feature 205 (T3.1/T3.2, R53/R57) — el TOPE de cierres que UN reparto puede tocar, recibido
     * **una sola vez** en la construccion y compartido por previsualizar y aplicar: no hay dos
     * numeros que puedan divergir, que es literalmente lo que R57 exige.
     *
     * El default sale del unico punto de configuracion (`lib/config/reparto-mensajero.ts`, R53)
     * y NO se escribe aqui ningun numero: un literal en este archivo seria la segunda copia. Es
     * inyectable para que un test ejercite el recorte con `tope: 2` y tres cierres en vez de con
     * cincuenta y uno.
     */
    private readonly maxCierresPorReparto: number = repartoMensajeroConfig.MAX_CIERRES_POR_REPARTO,
  ) {}

  /**
   * R21 — pago a un MENSAJERO, contra el pendiente de UN cierre aprobado. Es el mismo esqueleto
   * de `registrarPagoTienda` —y esta escrito aparte, no factorizado, porque lo que cambia son
   * justo los tres puntos donde una abstraccion prematura se equivocaria: contra que se compara
   * el monto, en que libro se escribe y con que signo.
   *
   *  1. ROL (R1/R6), antes de tocar datos.
   *  2. CANDADO del CIERRE (R83/R85), dentro de la transaccion y antes de leer el pendiente.
   *  3. GUARDIA DEL CIERRE (R20), leida DENTRO de la transaccion y bajo el candado: existe y
   *     esta `aprobado`. Los otros tres estados salen sin escribir nada.
   *  4. Pendiente DERIVADO (§5): `calcularSplitPago(P, E).pendiente − Σ pagos vigentes`.
   *  5. Documento + movimiento `pago`/`liquidacion`, en la MISMA transaccion (R39).
   *
   * El BENEFICIARIO (`mensajeroId`) se toma del CIERRE leido, nunca de la peticion (R5): el
   * cliente elige contra que cierre paga, no a quien se le paga.
   */
  async registrarPagoMensajero(
    input: RegistrarPagoMensajeroInput,
    actor: Actor,
  ): Promise<RegistrarPagoServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R1/R5/R6

    const monto = new Prisma.Decimal(input.monto).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    const montoStr = monto.toFixed(2);

    try {
      return await this.runTransaction(async (tx) => {
        // R83/R85: UN solo candado, sobre la fila del CIERRE (el grano exacto de lo que se
        // consume), ANTES de leer el pendiente y ANTES de mirar el estado.
        await this.pagoRepo.bloquearBeneficiario(tx, { tipo: "cierre", cierreId: input.cierreId });

        // R20: la guardia se lee EN LA TRANSACCION. Fuera de ella, el cierre podria cambiar de
        // estado entre la comprobacion y la escritura del pago.
        const cierre = await this.pagoRepo.obtenerCierreParaPago(input.cierreId, tx);
        if (cierre === null) return { status: "no_encontrado" };
        if (cierre.estado !== "aprobado") return { status: "cierre_no_aprobado" };

        // R22/R24/R80: pendiente = min(P, E) del cierre − Σ pagos VIGENTES contra el.
        const pendiente = new Prisma.Decimal(await this.pendienteDelCierre(cierre));

        if (pendiente.lte(0)) return { status: "sin_saldo" }; // R27 [P1]
        if (monto.gt(pendiente)) {
          // R25 [P1]: se rechaza y se informa de cuanto queda, sin escribir nada.
          return { status: "excede", disponible: pendiente.toFixed(2) };
        }

        // Feature 205 (§2.3): el cuerpo que escribe documento + movimiento vive en UN solo
        // metodo, compartido con cada imputacion de un reparto. Lo que se le pasa es lo mismo
        // que se escribia aqui, campo a campo.
        const creado = await this.escribirPagoDeCierre(tx, {
          claveIdempotencia: input.claveIdempotencia,
          mensajeroId: cierre.mensajeroId, // R5: el beneficiario sale del CIERRE
          cierreId: cierre.id, // R21: el pago al mensajero va SIEMPRE atado a un cierre
          monto: montoStr,
          metodo: input.metodo,
          referencia: input.referencia ?? null,
          nota: input.nota ?? null,
          fechaPago: medianocheUtcDelDia(input.fechaPago),
          registradoPor: actor.usuarioId,
          // Feature 205 (T2.2/R51): este camino paga contra UN cierre desde /cierres-admin y NO
          // pertenece a ningun reparto. `null` es el dato, no una ausencia — y el comportamiento
          // observable de este metodo no cambia ni un byte.
          repartoId: null,
        });
        if (creado.status === "clave_repetida") throw new ClaveRepetidaError();

        return {
          status: "ok",
          pago: aPagoRegistradoDTO(creado.pago),
          restante: pendiente.sub(monto).toFixed(2), // R24: el resto sigue pendiente
        };
      });
    } catch (error) {
      if (error instanceof ClaveRepetidaError) {
        return this.responderYaRegistrado(input.claveIdempotencia, {
          tipo: "cierre",
          cierreId: input.cierreId,
        });
      }
      throw error;
    }
  }

  /**
   * Feature 205 (T3.1, R32-R38/R56/R57) — QUE PASARIA si se repartiera este importe entre los
   * cierres pendientes del mensajero. **Solo lectura, y sin efecto alguno** (R35).
   *
   * Lo que NO hace, y es la mitad de su contrato: no abre transaccion, no toma ni un bloqueo y no
   * llama a ningun metodo de escritura. No es una reserva ni un contrato: es una ADVERTENCIA
   * (design §6.1). Al confirmar, el reparto se recalcula BAJO BLOQUEO (R23) y lo que se aplica
   * puede diferir de esto. Congelarlo exigiria mantener bloqueos entre dos peticiones HTTP.
   *
   * Todo lo que devuelve va ya DERIVADO y comparado en el servidor (R34): los importes salen como
   * STRING de escala 2 y los dos avisos —`recorte` y `deudaNoImputable`— llegan como booleanos con
   * sus cifras, para que el cliente no reste ni compare dinero.
   *
   * Usa EXACTAMENTE la misma funcion pura y el MISMO tope que la escritura (R57): los dos caminos
   * llaman a `repartirEntreCierres` con `this.maxCierresPorReparto`, que entro una sola vez por
   * construccion.
   */
  async previsualizarRepartoMensajero(
    input: PrevisualizarRepartoInput,
    actor: Actor,
  ): Promise<PrevisualizarRepartoServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R1/R4 — antes de leer NADA

    // El NOMBRE es lo unico de la persona que cruza (R48) y ademas es la guardia de existencia:
    // `null` = ese mensajero no existe, y se responde sin exponer ninguna cifra.
    const mensajeroNombre = await this.mensajeroRepo.obtenerNombreMensajero(input.mensajeroId);
    if (mensajeroNombre === null) return { status: "no_encontrado" };

    const imputables = await this.imputablesDe(input.mensajeroId);
    // Sin monto, se reparte "0.00": la funcion pura devuelve cero imputaciones y las MISMAS
    // cifras de ventana, total y recorte. Asi no hay dos caminos que puedan calcular la ventana
    // de dos maneras (R57).
    const reparto = repartirEntreCierres(
      input.monto ?? "0.00",
      imputables,
      this.maxCierresPorReparto,
    );

    // R37: la cuenta por pagar de la fila de la pantalla, derivada del LIBRO (Σ devengo − Σ pago),
    // que es un conjunto mas ancho que los cierres: puede incluir ajustes manuales que no cuelgan
    // de ninguno. La comparacion se hace AQUI (design §7.2), no en el cliente.
    const agregado = await this.mensajeroRepo.agregarCuentaPorPagar(input.mensajeroId, {});
    const cuentaPorPagar = derivarCuentaPorPagar(agregado.devengado, agregado.pagado).cuentaPorPagar;
    const noImputable = new Prisma.Decimal(cuentaPorPagar).sub(reparto.imputableTotal);
    const hayNoImputable = noImputable.gt(0);

    // R36: CUANTOS cierres quedan fuera por no estar aprobados, por estado y SIN importe. Es un
    // conteo agregado en la base, no la lista de cierres: el aviso dice «hay dinero que no estas
    // pagando aqui, y por que», no inventaria (el inventario esta en `/cierres-admin`). Asi la
    // respuesta queda acotada por el numero de estados, no por el de cierres. Ver el DTO.
    const excluidos = await this.pagoRepo.contarCierresNoAprobadosPorEstado(input.mensajeroId);

    const antiguedadPorCierre = new Map(imputables.map((c) => [c.cierreId, c.solicitadoAt]));

    return {
      status: "ok",
      previsualizacion: {
        mensajeroNombre,
        imputable: reparto.imputable, // el de la VENTANA: es el `disponible` del dialogo
        imputableTotal: reparto.imputableTotal,
        cuentaPorPagar,
        deudaNoImputable: {
          hay: hayNoImputable,
          // Nunca negativo: si el imputable supera a la cuenta por pagar —posible con un dato
          // historico raro— lo que hay que decir es «no hay deuda fuera de los cierres», no una
          // deuda al reves.
          monto: hayNoImputable ? noImputable.toFixed(2) : "0.00",
        },
        recorte: {
          // R56: `aplicado` es «hay cierres imputables FUERA de la ventana», no «la ventana esta
          // llena». Con exactamente `tope` cierres imputables no hay recorte que avisar.
          aplicado: reparto.recorte.fuera > 0,
          tope: reparto.recorte.tope,
          enVentana: reparto.recorte.enVentana,
          fuera: reparto.recorte.fuera,
          montoFuera: reparto.recorte.montoFuera,
        },
        imputaciones: reparto.imputaciones.map((imputacion) => ({
          cierreId: imputacion.cierreId,
          solicitadoAt: antiguedadPorCierre.get(imputacion.cierreId) ?? "",
          pendienteActual: imputacion.pendienteAntes,
          monto: imputacion.monto,
          pendienteDespues: imputacion.pendienteDespues,
          parcial: imputacion.parcial,
        })),
        sobrante: reparto.sobrante,
        // R38: el aviso de exceso lo resuelve el servidor comparando con `Prisma.Decimal`.
        excede: new Prisma.Decimal(reparto.sobrante).gt(0),
        // Se copia grupo a grupo, sin expandir a filas y sin sumar un total: lo que la pantalla
        // dice es «N rechazados, M solicitados», y ningun cierre concreto (se perdio poder
        // nombrarlo, y es el precio aceptado de que esto no crezca con el historial).
        excluidos: excluidos.map((grupo) => ({
          estado: grupo.estado,
          cantidad: grupo.cantidad,
        })),
      },
    };
  }

  /**
   * Feature 205 (T3.2) — REPARTE un importe entre los cierres pendientes del mensajero, del mas
   * antiguo al mas reciente, en UN solo acto y **todo o nada** (R20).
   *
   * Los pasos, en el orden de `design.md §2.1`, y CADA UNO esta donde esta por un motivo:
   *
   *  1. **ROL** (R1/R4), antes de tocar o leer un solo dato. Igual que los otros dos registros.
   *  2. **UNA transaccion** (R20). Si algo falla en la imputacion N, no queda ni la primera.
   *  3. **La fila del ACTO, LA PRIMERA** (§5.1/R28/R29). El choque de su `UNIQUE` sale por una
   *     señal interna y se responde FUERA (en Postgres la transaccion queda abortada). Derivar la
   *     clave por cierre en vez de tener esta fila esta ROTO y se midio por que: tras un primer
   *     intento con exito el FIFO empieza en otro cierre, la clave derivada no colisiona con nada
   *     y **se pagaria dos veces** (§5.2).
   *  4. **La VENTANA**: los `tope` primeros del orden FIFO (R53/R54). Los recortados no se
   *     bloquean ni se tocan (R55) — no se van a escribir.
   *  5. **LOS BLOQUEOS, uno por cierre de la ventana y EN ESE ORDEN** (R21/R22). El grano no
   *     cambia (la fila del cierre, el mismo que toma el pago simple) y el orden total es lo unico
   *     que impide el interbloqueo: dos repartos concurrentes del mismo mensajero adquieren en el
   *     mismo orden, y el pago simple toma UN solo candado, asi que nunca espera con otro en la
   *     mano (§3.1). **Reordenarlos por conveniencia es fabricar un interbloqueo en produccion.**
   *  6. **RELECTURA bajo bloqueo y RECALCULO** (R23/R24): manda lo que se lee aqui, nunca lo que
   *     dijo una previsualizacion. Si un cierre de la ventana se cayo, la ventana ENCOGE — no se
   *     rellena con el siguiente (§2.5.5), porque rellenar obligaria a bloquear un cierre fuera
   *     del orden acordado, que es como se fabrican los interbloqueos.
   *  7. **ESCRITURA** por imputacion con el escritor unico (§2.3), con el MISMO metodo, la MISMA
   *     referencia y la MISMA fecha en las N (R58): hubo una transferencia y un comprobante.
   *  8. Devuelve el reparto **realmente aplicado** (R25).
   */
  async registrarRepartoMensajero(
    input: RegistrarRepartoMensajeroInput,
    actor: Actor,
  ): Promise<RegistrarRepartoServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R1/R4 — antes de tocar datos

    // Escala 2 fijada UNA vez: el mismo STRING va al acto, a cada documento y a cada linea del
    // libro, asi que ninguna de las tres cosas puede discrepar por un redondeo.
    const monto = new Prisma.Decimal(input.monto).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    const montoStr = monto.toFixed(2);
    // R58: metodo, referencia y fecha se capturan UNA vez, aqui, y se copian literales en las N.
    const referencia = input.referencia ?? null;
    const nota = input.nota ?? null;
    const fechaPago = medianocheUtcDelDia(input.fechaPago);

    try {
      return await this.runTransaction(async (tx) => {
        // (3) El ACTO, antes de mover un centimo.
        const acto = await this.repartoRepo.crear(tx, {
          claveIdempotencia: input.claveIdempotencia,
          mensajeroId: input.mensajeroId,
          montoTotal: montoStr,
          registradoPor: actor.usuarioId, // R7 de la 172: un pago siempre lo registra alguien
        });
        if (acto.status === "clave_repetida") throw new RepartoRepetidoError();

        // (4) La ventana. `ordenarCierresFifo` es la verdad del orden (R8), no el `ORDER BY`.
        const previos = ordenarCierresFifo(await this.imputablesDe(input.mensajeroId, tx));
        const ventana = previos.slice(0, this.maxCierresPorReparto);
        const recortados = previos.slice(this.maxCierresPorReparto);

        // (5) Los candados, EN EL ORDEN DE LA VENTANA. Es un bucle secuencial a proposito: un
        // `Promise.all` los pediria en orden indeterminado y se acabo la defensa anti-interbloqueo.
        for (const cierre of ventana) {
          await this.pagoRepo.bloquearBeneficiario(tx, {
            tipo: "cierre",
            cierreId: cierre.cierreId,
          });
        }

        // (6) Relectura bajo bloqueo y recalculo con el MISMO tope.
        const bajoBloqueo = await this.ventanaBajoBloqueo(tx, input.mensajeroId, ventana);
        const reparto = repartirEntreCierres(montoStr, bajoBloqueo, this.maxCierresPorReparto);

        // R15: nada que imputar. Va ANTES que el exceso: con la ventana vacia el importe siempre
        // «excede», y decirle al operador que el disponible es 0.00 es peor que decirle que no
        // hay nada que pagar.
        if (new Prisma.Decimal(reparto.imputable).lte(0)) return { status: "sin_saldo" };
        // R14: el disponible es el de la VENTANA vigente, y no se escribe nada.
        //
        // Se nombra `imputable` y no `imputableTotal` aunque AQUI valgan lo mismo, y conviene
        // saber por que valen lo mismo: a este recalculo se le pasa `bajoBloqueo`, que ya es la
        // ventana (≤ tope), asi que no queda nada recortado y `imputableTotal = imputable + 0`.
        // Lo que hace que el disponible sea el de la VENTANA no es esta linea: es que el conjunto
        // que se recalcula es la ventana. Los recortados vuelven a aparecer, y solo ahi, en
        // `restanteImputable` — que es informativo y no un limite de lo que se puede pagar hoy.
        if (new Prisma.Decimal(reparto.sobrante).gt(0)) {
          return { status: "excede", disponible: reparto.imputable };
        }

        // (7) Una fila de pago y un movimiento por imputacion, con SU cierre (R18/R19).
        const imputaciones: ImputacionAplicadaDTO[] = [];
        for (const imputacion of reparto.imputaciones) {
          const creado = await this.escribirPagoDeCierre(tx, {
            // §5.1: derivada y AUDITABLE. No es la barrera —esa es la fila del acto— pero deja
            // la columna con un valor que dice de que reparto y de que cierre nacio, en vez de
            // un uuid inventado.
            claveIdempotencia: `${input.claveIdempotencia}:${imputacion.cierreId}`,
            mensajeroId: input.mensajeroId,
            cierreId: imputacion.cierreId,
            monto: imputacion.monto,
            metodo: input.metodo, // R58: los tres, IDENTICOS en las N imputaciones
            referencia,
            nota,
            fechaPago,
            registradoPor: actor.usuarioId,
            repartoId: acto.reparto.id, // R28: lo que hace el grupo reconstruible
          });
          // Imposible en teoria (ver `ImputacionRepetidaError`): revierte el reparto ENTERO en
          // vez de devolver un `ok` al que le falta una imputacion.
          if (creado.status !== "creado") throw new ImputacionRepetidaError(imputacion.cierreId);

          imputaciones.push({
            cierreId: imputacion.cierreId,
            monto: imputacion.monto,
            pendienteDespues: imputacion.pendienteDespues,
          });
        }

        return {
          status: "ok",
          reparto: {
            totalImputado: reparto.totalImputado,
            // Lo que SIGUE debiendose por cierres: lo que queda en la ventana MAS lo que quedo
            // recortado. Tras un reparto con recorte es > 0 a proposito, y es lo que dice que
            // hace falta registrar otro (design §7.2).
            restanteImputable: new Prisma.Decimal(reparto.imputable)
              .sub(reparto.totalImputado)
              .add(sumarPendientes(recortados))
              .toFixed(2),
            imputaciones,
          },
        };
      });
    } catch (error) {
      // R28: la respuesta idempotente se compone FUERA de la transaccion, que ya revirtio.
      if (error instanceof RepartoRepetidoError) return this.responderRepartoYaRegistrado(input);
      throw error;
    }
  }

  /**
   * R29 — pago a una TIENDA, contra su saldo acumulado. Los pasos, en el orden de `design.md
   * §3.3`, y el orden IMPORTA en los dos primeros:
   *
   *  1. ROL (R1/R2/R5/R6). Va antes de leer NADA: si estuviera despues, el saldo de la tienda
   *     ya habria salido de la base aunque la respuesta fuera `forbidden`. Y se evalua antes de
   *     mirar `input.tiendaId`, porque ningun dato de la peticion puede ampliar el alcance del
   *     actor (R5) — `adminTienda` recibe `forbidden` tambien pidiendo SU PROPIA tienda (R2).
   *  2. CANDADO (R83/R85), dentro de la transaccion y ANTES de leer el disponible. Con P1 =
   *     rechazar el exceso, «monto <= disponible» solo vale si nadie puede leer el mismo
   *     disponible a la vez: con `READ COMMITTED` dos transacciones simultaneas leerian el
   *     mismo saldo, las dos pasarian, y entre las dos se pagaria de mas.
   *  3. Disponible DERIVADO del ledger (nunca un saldo almacenado) y las dos ramas de rechazo.
   *  4. Documento + movimiento, en la MISMA transaccion (R39).
   *  5. **Feature 173 (R18/R19/R20):** y el egreso de la CAJA PRINCIPAL, en esa misma
   *     transaccion y por el mismo `montoStr`. Es la tercera escritura, no un efecto aparte:
   *     si falla, no queda el pago.
   */
  async registrarPagoTienda(
    input: RegistrarPagoTiendaInput,
    actor: Actor,
  ): Promise<RegistrarPagoServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R1/R2/R5/R6 — antes de tocar datos

    // Escala 2 fijada UNA vez: el mismo STRING va al documento, al libro y a la resta del
    // restante, asi que documento y libro no pueden discrepar por un redondeo (R39).
    const monto = new Prisma.Decimal(input.monto).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    const montoStr = monto.toFixed(2);

    try {
      return await this.runTransaction(async (tx) => {
        // R83/R85: UN solo candado, sobre la fila de la tienda, ANTES de leer el disponible.
        await this.pagoRepo.bloquearBeneficiario(tx, {
          tipo: "tienda",
          tiendaId: input.tiendaId,
        });

        // R31/R32: el disponible es el saldo a favor DERIVADO del ledger (creditos - debitos),
        // sin filtros: se paga contra el saldo acumulado, no contra un periodo.
        const agregado = await this.tiendaRepo.agregarSaldoPorTienda(input.tiendaId, {});
        const disponible = new Prisma.Decimal(
          derivarSaldoTienda(agregado.creditos, agregado.debitos).saldo,
        );

        if (disponible.lte(0)) return { status: "sin_saldo" }; // R32 [P1]
        if (monto.gt(disponible)) {
          // R31 [P1]: se rechaza y se informa de cuanto queda, sin escribir nada.
          return { status: "excede", disponible: disponible.toFixed(2) };
        }

        const creado = await this.pagoRepo.crear(tx, {
          claveIdempotencia: input.claveIdempotencia,
          mensajeroId: null,
          tiendaId: input.tiendaId, // R29: el pago a una tienda NO lleva cierre (CHECK en la base)
          cierreId: null,
          monto: montoStr,
          metodo: input.metodo,
          referencia: input.referencia ?? null,
          nota: input.nota ?? null,
          fechaPago: medianocheUtcDelDia(input.fechaPago), // R9: fecha REAL, distinta del registro
          registradoPor: actor.usuarioId, // R7: un pago siempre lo registra alguien
          repartoId: null, // feature 205: el pago a una TIENDA nunca nace de un reparto
        });
        // §4.1: sale de la transaccion (que revierte) y la relectura ocurre fuera.
        if (creado.status === "clave_repetida") throw new ClaveRepetidaError();

        // R36/R37/R38/R39: el debito nace del documento y va en la MISMA transaccion.
        await this.tiendaRepo.crearMovimientos(tx, [
          {
            tiendaId: input.tiendaId,
            tipo: "debito",
            categoria: "pago_tienda",
            monto: montoStr,
            origenTipo: "pago_tienda", // R38: enlaza el movimiento con su documento…
            origenId: creado.pago.id, //      …y hereda la idempotencia del indice unico parcial
            descripcion: descripcionDePago(input.metodo, input.referencia ?? null),
            registradoPor: actor.usuarioId,
            fechaMovimiento: medianocheUtcDelDia(input.fechaPago), // R37: la fecha REAL del pago
          },
        ]);

        // Feature 173 (R18/R19/R20) — TERCERA escritura, misma transaccion: el dinero SALE de
        // la caja principal. Va DESPUES del ledger a proposito, para que el libro de la tienda
        // siga siendo el primero en cuadrar; y con el MISMO `montoStr` ya redondeado, de modo
        // que documento, ledger y caja no puedan discrepar por un centimo.
        //
        // Ni el tipo ni la categoria se nombran aqui: los fija el puerto (R23).
        await this.caja.emitirEgresoDePago(tx, {
          pagoId: creado.pago.id,
          monto: montoStr,
          descripcion: descripcionDePago(input.metodo, input.referencia ?? null),
          registradoPor: actor.usuarioId,
          fechaMovimiento: medianocheUtcDelDia(input.fechaPago), // R20: la fecha REAL del pago
        });

        return {
          status: "ok",
          pago: aPagoRegistradoDTO(creado.pago),
          restante: disponible.sub(monto).toFixed(2),
        };
      });
    } catch (error) {
      if (error instanceof ClaveRepetidaError) {
        return this.responderYaRegistrado(input.claveIdempotencia, {
          tipo: "tienda",
          tiendaId: input.tiendaId,
        });
      }
      throw error;
    }
  }

  /**
   * T F.2 (R69-R71, R76, R77, R81, R82, R84) — ANULA un pago añadiendo su CONTRAASIENTO. El pago
   * no se borra ni se edita: sigue en la tabla, en el libro y en la lista de comprobantes, ahora
   * marcado con su motivo, su actor y su instante (R74).
   *
   * Los pasos, y por que estan en este orden:
   *
   *  1. ROL (R81), antes de leer nada. Los mismos que pagan: `maestro` y `admin`.
   *  2. EL PAGO SE LEE SERVER-SIDE (R70). De aqui —y de ningun sitio mas— salen el monto del
   *     reverso, el beneficiario y el libro en el que se escribe. La peticion solo trae el
   *     `pagoId` y el motivo: si el cliente pudiera dictar el monto, anular seria una via para
   *     escribir cualquier cifra en un libro de dinero. Se lee FUERA de la transaccion a
   *     proposito: hace falta saber a quien se le pago para saber QUE fila bloquear, y la fila
   *     del pago es INMUTABLE, asi que no puede quedarse obsoleta entre esta lectura y el
   *     candado. Lo que si puede cambiar —la anulacion y el disponible— se lee y se escribe
   *     dentro.
   *  3. CANDADO (R84/R85): UNO, el mismo que tomaria su pago.
   *  4. Disponible leido BAJO el candado (R83) y proyectado con el contraasiento ya aplicado:
   *     es el valor EXACTO al que vuelve el beneficiario (R71).
   *  5. Anulacion + contraasiento en la MISMA transaccion (R39): o quedan los dos, o ninguno.
   *
   * **Se anula ENTERO (R76)** —el monto es el del pago, no hay por donde pedir una parte— y
   * **no hay forma de anular una anulacion (R82)**: el segundo intento choca con el
   * `UNIQUE(pago_id)` y responde `ya_anulado`, y no existe ningun metodo que borre esa fila.
   *
   * **Feature 173 (R24-R27), y sustituye a lo que aqui decia la 172.** La 172 escribio «la caja
   * principal no recibe ni una llamada (R40): si al pagar no se emitio egreso, al anular no hay
   * nada que revertir». Ahora al pagar a una TIENDA si se emite egreso, asi que al anular si hay
   * que devolverlo: el contraasiento del ledger va acompañado de un `ingreso` de la caja por el
   * mismo monto, fechado el DIA DE LA ANULACION (R25) y de naturaleza TERCEROS, de modo que
   * anular no sube la ganancia de Ordenex ni un centimo (R26). La rama del MENSAJERO sigue sin
   * tocar la caja, exactamente igual que antes (R27, [P2]).
   */
  async anularPago(input: AnularPagoInput, actor: Actor): Promise<AnularPagoServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R81 — antes de leer nada

    const pago = await this.pagoRepo.obtenerPorId(input.pagoId); // R70: SERVER-SIDE
    if (pago === null) return { status: "no_encontrado" };

    const beneficiario = beneficiarioDelPago(pago);
    if (beneficiario === null) return { status: "no_encontrado" };

    // R70/R76: el monto del contraasiento es el del PAGO, entero. Escala fijada una vez, igual
    // que al registrar, para que documento y libro no puedan discrepar por un redondeo.
    const monto = new Prisma.Decimal(pago.monto).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    const montoStr = monto.toFixed(2);
    // R77: el contraasiento se fecha el dia de la ANULACION, no el del pago. El precedente es
    // `reversarEgreso`, que no reabre fechas pasadas: entre el pago y su anulacion, un informe
    // por rango vera el pago aplicado, que es la semantica contable habitual.
    const fechaAnulacion = medianocheUtcDelDia(fechaCalendarioCR(this.ahora()));

    try {
      return await this.runTransaction(async (tx) => {
        // R84/R85: UN solo candado, el mismo que tomaria su pago, ANTES de leer el disponible.
        await this.pagoRepo.bloquearBeneficiario(tx, bloqueoDelBeneficiario(beneficiario));

        const restante = await this.restanteTrasAnular(tx, beneficiario, monto);
        if (restante === null) return { status: "no_encontrado" };

        const anulada = await this.pagoRepo.anular(tx, {
          pagoId: pago.id,
          motivo: input.motivo,
          anuladoPor: actor.usuarioId, // R73
        });
        // R75: sale de la transaccion (que revierte) y la relectura ocurre fuera.
        if (anulada.status === "ya_anulado") throw new YaAnuladoError();

        await this.escribirContraasiento(tx, beneficiario, {
          pago,
          monto: montoStr,
          fechaMovimiento: fechaAnulacion,
          registradoPor: actor.usuarioId,
        });

        return { status: "ok", pago: conAnulacion(pago, anulada.anulacion), restante };
      });
    } catch (error) {
      if (error instanceof YaAnuladoError) return this.responderYaAnulado(pago.id);
      throw error;
    }
  }

  /**
   * Feature 206 — ANULA UN REPARTO COMPLETO: un acto, un motivo, sobre las N imputaciones que
   * nacieron del mismo reparto (`liquidacion_pago.reparto_id`, feature 205/R29).
   *
   * Reusa PIEZA POR PIEZA el camino de `anularPago` —`pagoRepo.anular` y `escribirContraasiento`—
   * en vez de reimplementarlo. Ninguna invariante de dinero se relaja: cada imputación sigue
   * teniendo su contraasiento por su monto exacto (R70/R76), fechado el día de la ANULACIÓN
   * (R77), y sigue siendo imposible anular una anulación (R82, el `UNIQUE(pago_id)`).
   *
   * ── EL ORDEN DE LOS CANDADOS NO ES UN DETALLE, ES LA CORRECCIÓN
   * `bloquearBeneficiario` de un pago a mensajero bloquea la fila de SU `cierre_dia`
   * (`LiquidacionPagoRepository.ts:147`). La interfaz declara «UNO por operación (R85): al no
   * haber dos recursos que ordenar, no existe orden de adquisición capaz de producir un
   * interbloqueo». **Un reparto imputa a N cierres distintos, así que este acto toma N candados
   * y esa premisa deja de valer.** Dos anulaciones agrupadas simultáneas que compartieran cierres
   * y los tomaran en orden distinto se interbloquearían.
   *
   * Por eso los candados se toman TODOS, de una vez y **ordenados por `cierreId`**, antes de
   * escribir nada. Un orden total fijo sobre los recursos es lo que hace el interbloqueo
   * imposible; no basta con que sean pocos.
   *
   * ── EL REPARTO A MEDIAS
   * Decisión humana del 2026-08-13: si alguien ya anuló a mano algunas imputaciones, se anulan
   * LAS QUE QUEDAN y se informa de las dos cifras. Rechazar dejaría a la persona con el trabajo
   * manual que esta feature existe para quitarle, y saltarse las anuladas es seguro **por
   * construcción**, no por disciplina: el `UNIQUE(pago_id)` de `liquidacion_anulacion` hace
   * imposible anular dos veces, así que una carrera devuelve `ya_anulado` y solo suma al conteo.
   *
   * No se devuelve «el restante»: hay uno por cierre. La pantalla vuelve a leer el pendiente.
   */
  async anularReparto(
    input: AnularRepartoInput,
    actor: Actor,
  ): Promise<AnularRepartoServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R81 — antes de leer nada

    // El reparto se DERIVA del pago, server-side (R56/R70): el cliente manda el pago que tiene
    // en pantalla y no puede nombrar un reparto que no sea el suyo.
    const pago = await this.pagoRepo.obtenerPorId(input.pagoId);
    if (pago === null || pago.repartoId === null) return { status: "no_encontrado" };

    const pagos = await this.pagoRepo.listarPorReparto(pago.repartoId);
    if (pagos.length === 0) return { status: "no_encontrado" };

    const vigentes = pagos.filter((p) => p.anulacion === null);
    const yaAnuladas = pagos.length - vigentes.length;
    if (vigentes.length === 0) return { status: "sin_vigentes", yaEstaban: yaAnuladas };

    // R77: una sola fecha para todo el acto. Anular en grupo es UN acto, no N actos seguidos.
    const fechaAnulacion = medianocheUtcDelDia(fechaCalendarioCR(this.ahora()));

    // Los candados, en orden determinista y ANTES de escribir (ver cabecera). `Set` porque dos
    // imputaciones podrian compartir cierre y un candado repetido no aporta nada.
    const beneficiarios = vigentes.map((p) => beneficiarioDelPago(p));
    if (beneficiarios.some((b) => b === null)) return { status: "no_encontrado" };
    // La clave es `<recurso>:<id>` para que el `sort()` produzca un orden TOTAL y estable sobre
    // los recursos, que es lo que descarta el interbloqueo (ver cabecera). `bloquearBeneficiario`
    // habla de `cierre`/`tienda`, no de `mensajero`: lo que se bloquea es la fila del cierre.
    const candados = [
      ...new Set(
        beneficiarios.map((b) =>
          b!.tipo === "mensajero" ? `cierre:${b!.cierreId}` : `tienda:${b!.tiendaId}`,
        ),
      ),
    ].sort();

    return await this.runTransaction(async (tx) => {
      for (const candado of candados) {
        const [tipo, id] = candado.split(":") as ["cierre" | "tienda", string];
        await this.pagoRepo.bloquearBeneficiario(
          tx,
          tipo === "cierre" ? { tipo: "cierre", cierreId: id } : { tipo: "tienda", tiendaId: id },
        );
      }

      let anuladas = 0;
      let yaEstaban = yaAnuladas;
      // FICHA 362 (R12): lo EFECTIVAMENTE anulado, que puede ser menos que el total del reparto
      // si alguna imputacion ya estaba anulada. Es lo que se congela en la fila del registro.
      let montoAnulado = new Prisma.Decimal(0);
      for (const pago of vigentes) {
        const beneficiario = beneficiarioDelPago(pago);
        if (beneficiario === null) continue; // la base lo impide; no se inventa un contraasiento
        const anulada = await this.pagoRepo.anular(tx, {
          pagoId: pago.id,
          motivo: input.motivo,
          anuladoPor: actor.usuarioId, // R73
        });
        if (anulada.status === "ya_anulado") {
          // Carrera: alguien la anuló entre la lectura y el candado. No es un error del acto.
          yaEstaban += 1;
          continue;
        }
        const monto = new Prisma.Decimal(pago.monto).toDecimalPlaces(
          2,
          Prisma.Decimal.ROUND_HALF_UP,
        );
        await this.escribirContraasiento(tx, beneficiario, {
          pago,
          monto: monto.toFixed(2),
          fechaMovimiento: fechaAnulacion,
          registradoPor: actor.usuarioId,
        });
        anuladas += 1;
        montoAnulado = montoAnulado.plus(monto);
      }

      // FICHA 362 (R9/R11/R12) — `reparto_anulado`: UNA fila por acto, DENTRO de esta misma
      // transaccion y SOLO si se anulo algo. Si el bucle no anulo ni una imputacion (todas
      // estaban ya anuladas por una carrera), no hay acto que registrar.
      //
      // Los N `pago_anulado` de los hijos NO se escriben: los corta el propio repositorio del
      // pago al ver que la fila pertenece a un reparto. Deshacer un reparto es UNA decision.
      if (anuladas > 0 && pago.repartoId !== null) {
        await this.repartoRepo.registrarAnulacion(tx, {
          repartoId: pago.repartoId,
          anuladoPor: actor.usuarioId,
          montoAnulado: montoAnulado.toFixed(2),
        });
      }

      return { status: "ok", anuladas, yaEstaban };
    });
  }

  /**
   * R49/R56/R74 (T C.1) — los comprobantes de UN cierre.
   *
   * Tres decisiones, las tres deliberadas:
   *
   *  1. **El gate va primero y es el MISMO de registrar** ([P3]/R1): un rol sin acceso total
   *     recibe `forbidden` ANTES de que la lista salga de la base. Un listado de comprobantes
   *     dice quien cobro, cuanto y como; es la misma superficie de dinero, no «solo lectura».
   *  2. **El DTO se recorta con `aPagoRegistradoDTO`**, que escribe campo a campo: el documento
   *     lleva `mensajeroId`/`tiendaId`/`cierreId` para el servicio, y ninguno de los tres cruza
   *     (R56). El unico uuid que viaja es el `id` del pago, que es lo que la pantalla necesita
   *     para pedir su anulacion.
   *  3. **La lista trae los ANULADOS** (R74). Es el repositorio quien no filtra por vigencia
   *     —a diferencia de las sumas, que si lo hacen (R80)—, y aqui no se vuelve a filtrar: un
   *     pago anulado deja de descontar, pero no deja de verse, entero y marcado.
   */
  async listarPagosDeCierre(cierreId: string, actor: Actor): Promise<ListarPagosServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R1/R6 — antes de leer nada
    const pagos = await this.pagoRepo.listarPorCierre(cierreId);
    return { status: "ok", pagos: pagos.map(aPagoRegistradoDTO) };
  }

  /**
   * R50/R56/R74 (T C.1) — los comprobantes de UNA tienda, con el mismo criterio que los del
   * cierre. Sin cierre de por medio: los pagos a una tienda van contra su saldo acumulado.
   */
  async listarPagosDeTienda(tiendaId: string, actor: Actor): Promise<ListarPagosServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R1/R2/R6
    const pagos = await this.pagoRepo.listarPorTienda(tiendaId);
    return { status: "ok", pagos: pagos.map(aPagoRegistradoDTO) };
  }

  /**
   * Feature 205 (§2.3) — EL ESCRITOR UNICO del pago contra un cierre: el documento y su
   * movimiento en el libro del mensajero, en la transaccion que se le pasa.
   *
   * Lo usan los DOS caminos —el pago simple de `/cierres-admin` y cada imputacion de un reparto—
   * y esa es toda su razon de ser: no puede haber dos copias del camino money-critical que
   * diverjan. El comentario de la 172 sobre «no factorizar» habla del eje mensajero↔tienda (contra
   * que se compara, en que libro se escribe, con que signo); aqui esas tres cosas son la MISMA, asi
   * que aquella razon no aplica.
   *
   * Devuelve el resultado del repositorio TAL CUAL, sin traducirlo: quien llama decide que
   * significa un `clave_repetida` en su camino (respuesta idempotente en el pago simple, fallo
   * imposible-en-teoria en el reparto). El movimiento solo se escribe si el documento se creo:
   * un libro con una linea sin documento seria peor que no escribir nada.
   */
  private async escribirPagoDeCierre(
    tx: LiquidacionTx,
    pago: PagoDeCierreEscrito,
  ): Promise<CrearLiquidacionPagoResult> {
    const creado = await this.pagoRepo.crear(tx, {
      claveIdempotencia: pago.claveIdempotencia,
      mensajeroId: pago.mensajeroId,
      tiendaId: null,
      cierreId: pago.cierreId, // R18/R21: el pago al mensajero va SIEMPRE atado a un cierre
      monto: pago.monto,
      metodo: pago.metodo,
      referencia: pago.referencia,
      nota: pago.nota,
      fechaPago: pago.fechaPago,
      registradoPor: pago.registradoPor,
      repartoId: pago.repartoId,
    });
    if (creado.status !== "creado") return creado;

    // R19/R35/R37/R38/R39: el movimiento del libro del mensajero nace del documento.
    await this.mensajeroRepo.crearMovimientos(tx, [
      {
        mensajeroId: pago.mensajeroId,
        tipo: "pago",
        categoria: "liquidacion",
        monto: pago.monto,
        origenTipo: "pago_mensajero", // R38: enlaza el movimiento con su documento…
        origenId: creado.pago.id, //      …y hereda la idempotencia del indice unico parcial
        descripcion: descripcionDePago(pago.metodo, pago.referencia),
        registradoPor: pago.registradoPor,
        fechaMovimiento: pago.fechaPago, // R37: la fecha REAL del pago
      },
    ]);

    return creado;
  }

  /**
   * Feature 205 (T3.1, R5/R6/R7) — los cierres IMPUTABLES del mensajero con su pendiente ya
   * DERIVADO: `aprobado` (lo pone el WHERE del repositorio) **y** pendiente > 0 (se decide aqui,
   * porque el pendiente no es una columna: se deriva de los pagos VIGENTES, R6/R7).
   *
   * Es el unico sitio donde esta feature deriva un pendiente, y lo usan los TRES caminos
   * —previsualizar, aplicar y la respuesta idempotente—: dos derivaciones del mismo numero es
   * exactamente lo que hace que dos pantallas digan cifras distintas.
   *
   * `tx` presente = lectura DENTRO de la transaccion y bajo los candados (R23); ausente = lectura
   * suelta de la previsualizacion (R35). La Σ de pagos vigentes se lee con el cliente propio del
   * repositorio, igual que en el pago contra un cierre unico y por el mismo motivo: cuando importa
   * (bajo candado) nadie mas puede confirmar un pago contra esos cierres.
   */
  private async imputablesDe(mensajeroId: string, tx?: LiquidacionTx): Promise<CierreImputable[]> {
    const cierres = await this.pagoRepo.listarCierresImputables(mensajeroId, tx);
    if (cierres.length === 0) return [];

    const ids = cierres.map((c) => c.id);
    const pagados = await this.pagoRepo.sumarVigentesPorCierre(ids);
    // Feature 293 (T2.3, §6/3, R24) — los PREMIOS VIVOS de esos mismos cierres. UNA llamada
    // para todo el conjunto, como la de arriba: el numero de consultas no crece con el numero
    // de cierres. Sin esto el premio nunca entraria en la ventana imputable y no se podria
    // cobrar — que es el corazon de la decision humana de imputarlo al cierre.
    const premios = await this.mensajeroRepo.sumarPremiosVivosPorCierre(ids);
    const imputables: CierreImputable[] = [];
    for (const cierre of cierres) {
      // R24, defensa en profundidad: el WHERE del repositorio ya acota por mensajero, pero un
      // cierre de otra persona no puede recibir un centimo aunque una lectura futura se
      // equivocara. Cuesta una comparacion y cierra el agujero en el punto donde duele.
      if (cierre.mensajeroId !== mensajeroId) continue;
      const pendiente = derivarPendienteCierre({
        pagoDebido: cierre.totalPagoMensajero,
        efectivo: cierre.totalEfectivo,
        premiosVivos: premios[cierre.id] ?? "0.00",
        pagadoVigente: pagados[cierre.id] ?? "0.00",
      });
      if (new Prisma.Decimal(pendiente).lte(0)) continue; // R5: imputable = pendiente > 0
      imputables.push({
        cierreId: cierre.id,
        pendiente,
        solicitadoAt: cierre.solicitadoAt, // R8: la antiguedad es el dia TRABAJADO
      });
    }
    return imputables;
  }

  /**
   * Feature 205 (T3.2, R23/R24; design §2.5.5) — la ventana RELEIDA bajo los candados ya tomados.
   *
   * **La ventana SE ENCOGE, NO SE RELLENA, y esa es la linea que no se puede cruzar.** El bucle
   * recorre `ventana` —los cierres que SI se bloquearon— y no la lectura fresca: si uno de ellos
   * dejo de estar `aprobado`, se pago por otra via o cambio de dueño, desaparece del reparto y no
   * se sube el siguiente candidato a ocupar su hueco. Rellenar obligaria a bloquear un cierre que
   * no se bloqueo al principio, es decir, a adquirir candados FUERA del orden acordado (§3.1), que
   * es literalmente como se fabrica un interbloqueo. El precio es un reparto que toca 49 en vez de
   * 50; la ganancia es que el conjunto bloqueado nunca crece a mitad de la operacion.
   *
   * El ORDEN de la ventana se conserva intacto: es el del reparto y el de los candados.
   */
  private async ventanaBajoBloqueo(
    tx: LiquidacionTx,
    mensajeroId: string,
    ventana: readonly CierreImputable[],
  ): Promise<CierreImputable[]> {
    const frescos = await this.imputablesDe(mensajeroId, tx);
    const porCierre = new Map(frescos.map((cierre) => [cierre.cierreId, cierre]));

    const vivos: CierreImputable[] = [];
    for (const cierre of ventana) {
      const fresco = porCierre.get(cierre.cierreId);
      // `undefined` = ya no es imputable (dejo de estar aprobado, quedo saldado o no es suyo).
      // R23: lo que manda es el pendiente FRESCO, nunca el de la lectura previa.
      if (fresco !== undefined) vivos.push(fresco);
    }
    return vivos;
  }

  /**
   * Feature 205 (T3.2, R28) — la respuesta del SEGUNDO envio del mismo reparto: el resultado
   * ORIGINAL y **cero filas nuevas**.
   *
   * Se reconstruye por `reparto_id` (`listarPorReparto`), que es una consulta directa, y no se
   * infiere del importe, de la fecha ni de la referencia. El reparto releido tiene que ser el del
   * mensajero que se pide: reusar una clave ya consumida apuntando a otra persona no puede
   * devolver el reparto de un tercero.
   *
   * Dos cosas que este metodo declara en voz alta, porque el diseño no las fija:
   *
   *  - **`pendienteDespues` se vuelve a DERIVAR** (es lo que el pendiente es, R6: nunca un valor
   *    guardado), asi que refleja el estado de HOY, no una foto del dia del reparto. `"0.00"` es
   *    lo que se dice de un cierre que ya no es imputable (saldado o fuera de `aprobado`).
   *  - **El orden es `(registradoAt, cierreId)`.** Las N filas de un reparto nacen en la MISMA
   *    transaccion y comparten `created_at` (Postgres fecha con el instante de la transaccion),
   *    asi que el desempate real es el `cierreId`: no reconstruye el orden FIFO original, pero es
   *    total y repetible — dos llamadas devuelven siempre lo mismo.
   */
  private async responderRepartoYaRegistrado(
    input: RegistrarRepartoMensajeroInput,
  ): Promise<RegistrarRepartoServiceResult> {
    const reparto = await this.repartoRepo.obtenerPorClave(input.claveIdempotencia);
    if (reparto === null) return { status: "no_encontrado" };
    if (reparto.mensajeroId !== input.mensajeroId) return { status: "no_encontrado" };

    const pagos = await this.pagoRepo.listarPorReparto(reparto.id);
    const imputables = await this.imputablesDe(reparto.mensajeroId);
    const pendientePorCierre = new Map(imputables.map((c) => [c.cierreId, c.pendiente]));

    const ordenados = [...pagos].sort((a, b) => {
      if (a.registradoAt !== b.registradoAt) return a.registradoAt < b.registradoAt ? -1 : 1;
      const ca = a.cierreId ?? "";
      const cb = b.cierreId ?? "";
      if (ca === cb) return 0;
      return ca < cb ? -1 : 1;
    });

    let totalImputado = new Prisma.Decimal(0);
    const imputaciones: ImputacionAplicadaDTO[] = [];
    for (const pago of ordenados) {
      // Imposible por construccion (R21 de la 172: el pago a un mensajero va atado a un cierre);
      // se salta en vez de emitir una imputacion sin cierre, que la pantalla no sabria enlazar.
      if (pago.cierreId === null) continue;
      totalImputado = totalImputado.add(new Prisma.Decimal(pago.monto));
      imputaciones.push({
        cierreId: pago.cierreId,
        monto: pago.monto,
        pendienteDespues: pendientePorCierre.get(pago.cierreId) ?? "0.00",
      });
    }

    return {
      status: "ya_registrado",
      reparto: {
        totalImputado: totalImputado.toFixed(2),
        restanteImputable: sumarPendientes(imputables).toFixed(2),
        imputaciones,
      },
    };
  }

  /**
   * T F.2/R71 — a cuanto vuelve el disponible del beneficiario UNA VEZ aplicado el
   * contraasiento. Se lee bajo el candado (R83) y **no se estima**: se vuelve a pasar por la
   * MISMA derivacion que usa el registro, con el efecto del reverso ya metido en la entrada.
   *
   *  - mensajero: el pago que se esta anulando todavia cuenta como vigente en la agregacion, asi
   *    que se descuenta de ella y el pendiente se deriva con `derivarPendienteCierre`. Resultado:
   *    exactamente el pendiente que habia ANTES de ese pago.
   *  - tienda: el contraasiento es un CREDITO por el mismo monto, asi que el saldo se deriva de
   *    los creditos del ledger MAS ese credito. Igual de exacto, y por la misma via.
   *
   * `null` = el cierre del pago ya no existe (imposible: la FK va `ON DELETE RESTRICT`); se
   * responde `no_encontrado` en vez de inventar una cifra.
   */
  private async restanteTrasAnular(
    tx: LiquidacionTx,
    beneficiario: BeneficiarioDelPago,
    monto: Prisma.Decimal,
  ): Promise<string | null> {
    if (beneficiario.tipo === "mensajero") {
      const cierre = await this.pagoRepo.obtenerCierreParaPago(beneficiario.cierreId, tx);
      if (cierre === null) return null;
      const pagados = await this.pagoRepo.sumarVigentesPorCierre([cierre.id]);
      const vigentes = new Prisma.Decimal(pagados[cierre.id] ?? "0.00").sub(monto);
      // Feature 293 (T2.3, R26) — CONSUMIDOR QUE `design.md §6` NO ENUMERA y que el compilador
      // SI señalo (es el 21.º). Responde «cuanto se le debe por este cierre una vez aplicado el
      // contraasiento», que es literalmente la pregunta que R26 obliga a contestar con el mismo
      // calculo y en un unico sitio. Dejarlo con `premiosVivos: "0.00"` habria devuelto, tras
      // anular un pago, un restante MENOR que el real en cierres con premio: la pantalla diria
      // que queda menos por pagar del que queda.
      const premios = await this.mensajeroRepo.sumarPremiosVivosPorCierre([cierre.id]);
      return derivarPendienteCierre({
        pagoDebido: cierre.totalPagoMensajero,
        efectivo: cierre.totalEfectivo,
        premiosVivos: premios[cierre.id] ?? "0.00",
        pagadoVigente: vigentes.lt(0) ? new Prisma.Decimal(0) : vigentes,
      });
    }

    const agregado = await this.tiendaRepo.agregarSaldoPorTienda(beneficiario.tiendaId, {});
    const creditos = new Prisma.Decimal(agregado.creditos).add(monto);
    return derivarSaldoTienda(creditos, agregado.debitos).saldo;
  }

  /**
   * T F.2/§6.2 (R69/R77) — EL CONTRAASIENTO: mismo monto, signo opuesto, mismo documento.
   *
   * | Pago original | Contraasiento | Efecto |
   * | --- | --- | --- |
   * | mensajero `pago`/`liquidacion` | `devengo`/`ajuste_devengo` | la cuenta por pagar vuelve a subir |
   * | tienda `debito`/`pago_tienda` | `credito`/`ajuste_credito` | el saldo a favor vuelve a subir |
   *
   * Las dos categorias YA existian, reservadas para esto («correccion compensatoria inmutable»),
   * y los dos CHECK de la migracion estan escritos para dejar pasar EXACTAMENTE estos dos pares:
   * `ajuste_devengo` solo casa con `devengo` y `ajuste_credito` solo con `credito`. Elegir otro
   * par no daria un saldo raro — daria un INSERT rechazado por la base, a proposito (R60).
   *
   * `origenTipo`/`origenId` son los DEL PAGO, no de la anulacion, y eso es lo que da idempotencia
   * gratis: el indice unico parcial de cada libro es `(origen_tipo, origen_id, <beneficiario>,
   * categoria)`, y el pago ya ocupo esa clave con OTRA categoria. Los dos caben y ninguno puede
   * duplicarse. Ademas es lo que hace que el filtro por cierre del desglose (R52) traiga el
   * contraasiento junto a su pago.
   */
  private async escribirContraasiento(
    tx: LiquidacionTx,
    beneficiario: BeneficiarioDelPago,
    reverso: {
      pago: LiquidacionPagoDTO;
      monto: string;
      fechaMovimiento: Date;
      registradoPor: string;
    },
  ): Promise<void> {
    const descripcion = descripcionDeAnulacion(reverso.pago.metodo, reverso.pago.referencia);

    if (beneficiario.tipo === "mensajero") {
      await this.mensajeroRepo.crearMovimientos(tx, [
        {
          mensajeroId: beneficiario.mensajeroId,
          tipo: "devengo",
          categoria: "ajuste_devengo",
          monto: reverso.monto,
          origenTipo: "pago_mensajero", // el del PAGO (R38)
          origenId: reverso.pago.id,
          descripcion,
          registradoPor: reverso.registradoPor,
          fechaMovimiento: reverso.fechaMovimiento, // R77: el dia de la ANULACION
        },
      ]);
      return;
    }

    await this.tiendaRepo.crearMovimientos(tx, [
      {
        tiendaId: beneficiario.tiendaId,
        tipo: "credito",
        categoria: "ajuste_credito",
        monto: reverso.monto,
        origenTipo: "pago_tienda", // el del PAGO (R38)
        origenId: reverso.pago.id,
        descripcion,
        registradoPor: reverso.registradoPor,
        fechaMovimiento: reverso.fechaMovimiento, // R77
      },
    ]);

    // Feature 173 (R24/R25/R26/R29) — y el dinero VUELVE a la caja principal, en la misma
    // transaccion y por el mismo monto. Es una fila NUEVA: nada se borra ni se edita.
    //
    // Solo en esta rama: si el `if` de arriba se llevo el caso del mensajero con su `return`,
    // aqui abajo ya no hay forma de llegar con un pago a mensajero. Que la categoria del reverso
    // no sea `ingreso_ajuste` —que subiria la ganancia— lo garantiza el puerto, no este metodo.
    await this.caja.emitirReversoDeAnulacion(tx, {
      pagoId: reverso.pago.id,
      monto: reverso.monto,
      descripcion,
      registradoPor: reverso.registradoPor,
      fechaMovimiento: reverso.fechaMovimiento, // R25: el dia de la ANULACION
    });
  }

  /**
   * R75 — la respuesta del SEGUNDO intento: el comprobante ya anulado y cero filas nuevas.
   *
   * Se relee por id porque el bloque de anulacion que hay que devolver (motivo, actor, instante)
   * lo escribio la otra llamada, no esta. `no_encontrado` cubre el caso imposible-en-teoria (un
   * choque de unicidad sin anulacion que lo explique): mejor un estado explicito que un
   * `ya_anulado` con el bloque vacio, que la pantalla pintaria como un pago vigente.
   */
  private async responderYaAnulado(pagoId: string): Promise<AnularPagoServiceResult> {
    const pago = await this.pagoRepo.obtenerPorId(pagoId);
    if (pago === null || pago.anulacion === null) return { status: "no_encontrado" };
    return { status: "ya_anulado", pago: aPagoRegistradoDTO(pago) };
  }

  /**
   * §5/R22/R24/R80 — lo que de ESE cierre sigue sin entregarse. La suma de pagos vigentes se
   * lee con el cliente propio del repositorio (no con el `tx`), igual que el saldo de la
   * tienda: el candado del cierre ya se tomo, asi que una segunda transaccion no puede leer
   * esta cifra hasta que la primera confirme.
   *
   * `?? "0.00"`: el repositorio devuelve una entrada por cada id pedido, pero un doble podria
   * no hacerlo; ante la duda, cero pagado — que es lo que hace que el tope de [P1] siga siendo
   * el pendiente completo y nunca uno inventado.
   */
  private async pendienteDelCierre(cierre: CierreParaPagoDTO): Promise<string> {
    const pagados = await this.pagoRepo.sumarVigentesPorCierre([cierre.id]);
    // Feature 293 (T2.3, §6/4, R24/R27): sin esta lectura, pagar el premio de un cierre saldado
    // devolveria `sin_saldo` —o `excede` si el cierre tenia otra deuda menor—: el tope de [P1]
    // se compara contra ESTE numero.
    const premios = await this.mensajeroRepo.sumarPremiosVivosPorCierre([cierre.id]);
    return derivarPendienteCierre({
      pagoDebido: cierre.totalPagoMensajero,
      efectivo: cierre.totalEfectivo,
      premiosVivos: premios[cierre.id] ?? "0.00",
      pagadoVigente: pagados[cierre.id] ?? "0.00",
    });
  }

  /**
   * R43/R47 — la respuesta idempotente: el MISMO comprobante y cero filas nuevas.
   *
   * El restante se recalcula sobre el beneficiario DEL PAGO ENCONTRADO, no sobre el de la
   * peticion: si alguien reusara una clave ya consumida apuntando a otro cierre o a otra
   * tienda, la cifra que devolvemos seguiria siendo la de aquello a lo que de verdad se pago.
   * El beneficiario de la peticion solo actua de respaldo.
   *
   * `no_encontrado` es el caso imposible-en-teoria (choque de clave sin fila que lo explique) y
   * se responde sin inventar: mejor un estado explicito que un `ok` que nadie puede auditar.
   */
  private async responderYaRegistrado(
    claveIdempotencia: string,
    deLaPeticion: BeneficiarioBloqueo,
  ): Promise<RegistrarPagoServiceResult> {
    const pago = await this.pagoRepo.obtenerPorClave(claveIdempotencia);
    if (pago === null) return { status: "no_encontrado" };

    const restante = await this.restanteDe(pago, deLaPeticion);
    if (restante === null) return { status: "no_encontrado" };

    return { status: "ya_registrado", pago: aPagoRegistradoDTO(pago), restante };
  }

  /** Lo que queda disponible tras el pago ya registrado, segun contra que dinero fuera. */
  private async restanteDe(
    pago: LiquidacionPagoDTO,
    deLaPeticion: BeneficiarioBloqueo,
  ): Promise<string | null> {
    const cierreId =
      pago.cierreId ?? (deLaPeticion.tipo === "cierre" ? deLaPeticion.cierreId : null);
    if (cierreId !== null) {
      const cierre = await this.pagoRepo.obtenerCierreParaPago(cierreId);
      return cierre === null ? null : this.pendienteDelCierre(cierre);
    }

    const tiendaId =
      pago.tiendaId ?? (deLaPeticion.tipo === "tienda" ? deLaPeticion.tiendaId : null);
    if (tiendaId === null) return null;
    const agregado = await this.tiendaRepo.agregarSaldoPorTienda(tiendaId, {});
    return derivarSaldoTienda(agregado.creditos, agregado.debitos).saldo;
  }
}
