import { Prisma } from "@prisma/client";
import { esAccesoTotal } from "@/lib/auth/acceso-total";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { ICierreDelDiaRepository } from "@/lib/interfaces/repositories/ICierreDelDiaRepository";
import type {
  IPagoMensajeroMovimientoRepository,
  PremioRegistradoRow,
} from "@/lib/interfaces/repositories/IPagoMensajeroMovimientoRepository";
import type {
  IRankingSnapshotRepository,
  PodioFilaConFecha,
  PodioFilaRow,
} from "@/lib/interfaces/repositories/IRankingSnapshotRepository";
import type { ICajaPremioRankingFeedService } from "@/lib/interfaces/services/ICajaPremioRankingFeedService";
import type {
  AnularPremioResult,
  IPremioRankingDevengoService,
  ListarPremiosDelDiaResult,
  PremioTxRunner,
  RegistrarPremioResult,
} from "@/lib/interfaces/services/IPremioRankingDevengoService";
import type {
  AnularPremioInput,
  ListarPremiosDelDiaInput,
  PremioPodioDTO,
  PremioPodioEstado,
  RegistrarPremioInput,
} from "@/lib/types/premio-ranking-devengo";
import { fechaComoDate, ventanaDelDia } from "@/lib/ranking/snapshot-dia";

/**
 * Feature 293 (T4.2, design §7) — EL MAESTRO REGISTRA EL PREMIO DEL PODIO COMO DEVENGO IMPUTADO
 * AL CIERRE DEL DIA.
 *
 * Es el UNICO modulo del arbol que escribe `premio_ranking` (R1/R3, y hay una guardia de censo
 * que lo atornilla): ni un cron, ni la aprobacion de un cierre, ni el congelado diario del
 * ranking pueden producir un movimiento de premio. Siempre hay un acto humano.
 *
 * Lo que este servicio NO hace, y es tan importante como lo que hace:
 *  - **No toca `cierre_dia`** (R13): ni `total_pago_mensajero` ni ningun otro snapshot. Ni
 *    siquiera puede — su `tx` es un `Pick` de los dos libros de dinero.
 *  - **No crea cierres ni cambia estados** (fuera de alcance 6): si no hay cierre, lo dice.
 *  - **No escribe en la caja por su cuenta**: pasa por `ICajaPremioRankingFeedService`, un puerto
 *    de dos metodos que no acepta ni tipo ni categoria (R20).
 *  - **No lee el premio VIGENTE** (R15): el monto sale de la fila CONGELADA del podio, y por eso
 *    aqui no hay ninguna dependencia de `IPremioRankingRepository`.
 *
 * Money-safe (R35): los importes entran y salen como STRING de escala 2. El unico `Prisma.Decimal`
 * de este archivo es la comparacion «el premio es cero», que no puede hacerse con `Number`.
 */
export class PremioRankingDevengoService implements IPremioRankingDevengoService {
  constructor(
    private readonly snapshotRepo: Pick<
      IRankingSnapshotRepository,
      "listarPodioDeFecha" | "obtenerFilaDelPodio"
    >,
    private readonly cierreRepo: ICierreDelDiaRepository,
    /**
     * Del libro del mensajero se usan TRES metodos: dos lecturas y la UNICA escritura
     * (`crearMovimientos`). El `Pick` deja escrito que este servicio no lista cuentas por pagar
     * ni agrega saldos: solo escribe su fila y lee lo justo para saber si ya existe.
     */
    private readonly libroRepo: Pick<
      IPagoMensajeroMovimientoRepository,
      "crearMovimientos" | "listarPremiosPorDias"
    >,
    private readonly caja: ICajaPremioRankingFeedService,
    private readonly runTransaction: PremioTxRunner,
  ) {}

  /** R2 — «solo el maestro», expresado como en el resto de Wallet: `maestro` o `admin`. */
  private sinAcceso(actor: Actor): boolean {
    return !esAccesoTotal(actor.rol);
  }

  /**
   * R4/R5/R6/R9 — el podio congelado de la fecha con el estado de cada fila.
   *
   * El gate va ANTES de la primera lectura (R2): sin acceso total no se consulta la base y no se
   * expone ni un nombre ni un monto.
   *
   * Coste: el podio son 1-3 filas, asi que las lecturas por fila (cierre del dia y premios de ese
   * mensajero) estan acotadas por construccion. No hay N+1 posible porque no hay N.
   */
  async listarPremiosDelDia(
    input: ListarPremiosDelDiaInput,
    actor: Actor,
  ): Promise<ListarPremiosDelDiaResult> {
    if (this.sinAcceso(actor)) return { status: "forbidden" };

    const dia = fechaComoDate(input.fecha);
    const podio = await this.snapshotRepo.listarPodioDeFecha(dia);
    // R6: `null` = esa fecha no tiene ranking congelado. Distinto de un podio vacio.
    if (podio === null) {
      return { status: "ok", fecha: input.fecha, hayPodio: false, filas: [] };
    }

    const filas: PremioPodioDTO[] = [];
    for (const fila of podio) {
      filas.push(await this.aDTO(fila, input.fecha, dia));
    }
    return { status: "ok", fecha: input.fecha, hayPodio: true, filas };
  }

  /**
   * R9 — el estado de UNA fila, derivado de los datos. El orden de las ramas es el contrato
   * (`PremioPodioEstado`): lo YA registrado manda sobre el estado del cierre, porque lo escrito no
   * se re-deriva.
   */
  private async aDTO(
    fila: PodioFilaRow,
    fechaTexto: string,
    dia: Date,
  ): Promise<PremioPodioDTO> {
    const base = {
      filaId: fila.filaId,
      posicion: fila.posicion,
      mensajeroNombre: fila.mensajeroNombre,
      // R5: `entregadas` y `asignadas` viajan SIEMPRE, tambien en cero. Es el aviso del 26/08.
      entregadas: fila.entregadas,
      asignadas: fila.asignadas,
      premioMonto: fila.premioMonto,
      premioDescripcion: fila.premioDescripcion,
    };

    // R7: sin premio congelado no hay nada que registrar, y no se consulta nada mas.
    if (!tienePremio(fila)) {
      return { ...base, estado: "sin_premio", cierreEstado: null };
    }

    const registro = clasificarRegistro(
      await this.libroRepo.listarPremiosPorDias(fila.mensajeroId, [dia]),
    );
    if (registro !== null) {
      return { ...base, estado: registro, cierreEstado: null };
    }

    const cierre = await this.cierreRepo.resolverCierreDelDia(
      fila.mensajeroId,
      ventanaDelDia(fechaTexto),
    );
    if (cierre === null) return { ...base, estado: "sin_cierre", cierreEstado: null };
    if (cierre.estado !== "aprobado") {
      return { ...base, estado: "cierre_no_aprobado", cierreEstado: cierre.estado };
    }
    return { ...base, estado: "no_registrado", cierreEstado: cierre.estado };
  }

  /**
   * R10-R23 — el registro. Todo lo que se escribe sale del SERVIDOR (R16): del input solo se usa
   * `filaId`.
   *
   * Las comprobaciones van en este orden y cada una tiene su mensaje propio (nunca un error
   * generico, R11/R12 lo exigen): existe la fila -> tiene premio -> ENTREGO algo (feature 297)
   * -> hay cierre de ese dia -> ese cierre esta aprobado. Solo entonces se abre la transaccion.
   */
  async registrarPremio(
    input: RegistrarPremioInput,
    actor: Actor,
  ): Promise<RegistrarPremioResult> {
    if (this.sinAcceso(actor)) return { status: "forbidden" };

    const fila = await this.snapshotRepo.obtenerFilaDelPodio(input.filaId);
    if (fila === null) return { status: "no_encontrado" };
    // R7: monto ausente o cero -> se rechaza SIN escribir nada, aunque lo pidan.
    if (!tienePremio(fila)) return { status: "sin_premio" };
    // Feature 297: cero entregas ese dia -> no se cobra. Desde la 297 `asignarPodio` ya no da
    // posicion a quien no entrego, asi que ninguna fila NUEVA puede llegar aqui asi; esta guarda
    // existe por los snapshots YA CONGELADOS, que son historia y no se reescriben. Va ANTES de
    // resolver el cierre: el dato esta en la propia fila congelada y no hace falta leer nada mas.
    if (fila.entregadas < 1) return { status: "sin_entregas" };
    const monto = fila.premioMonto as string;

    const fechaTexto = textoDeFecha(fila.fecha);
    const cierre = await this.cierreRepo.resolverCierreDelDia(
      fila.mensajeroId,
      ventanaDelDia(fechaTexto),
    );
    // R11: no hay cierre de ese dia. Causa EXACTA, no un error generico.
    if (cierre === null) return { status: "sin_cierre" };
    // R12: lo hay pero no esta aprobado. Se nombra el estado en que esta.
    if (cierre.estado !== "aprobado") {
      return { status: "cierre_no_aprobado", estado: cierre.estado };
    }

    return this.runTransaction(async (tx) => {
      // R17/R18: la barrera es el INDICE UNICO de la base, no un `SELECT` previo. `createMany`
      // con `skipDuplicates` es `ON CONFLICT DO NOTHING`: sin check-then-insert y sin TOCTOU.
      const escritas = await this.libroRepo.crearMovimientos(tx, [
        {
          mensajeroId: fila.mensajeroId, // R16: del podio, jamas del input
          tipo: "devengo",
          categoria: "premio_ranking", // R14: categoria PROPIA
          monto, // R15: el CONGELADO, no el premio vigente
          origenTipo: "cierre_dia", // R10: el movimiento cuelga de SU cierre
          origenId: cierre.cierreId,
          premioDia: fila.fecha, // R17: la guarda (mensajero, dia) vive en esta columna
          descripcion: descripcionDelPremio(fechaTexto, fila),
          registradoPor: actor.usuarioId, // R22: quien lo registro
          // R23: NO se pasa `fechaMovimiento`. La columna cae en su DEFAULT —el instante del
          // registro—: fechar hoy un egreso en el dia del podio reescribiria el dinero de un dia
          // ya leido, porque la caja se agrega POR DIA.
        },
      ]);

      if (escritas === 0) {
        // El unico parcial lo rechazo: o ya estaba registrado, o esta ANULADO y su cupo esta
        // consumido (R32, Q2). Las dos son la misma señal de la base y solo el libro las
        // distingue; la pantalla tiene que poder decir la verdad.
        //
        // La relectura va POR EL `tx` (revision de la 293, m4). Hoy da lo mismo —esta rama solo
        // corre cuando no se inserto nada, asi que la transaccion no lleva escrito nada que una
        // lectura de fuera pudiera perderse—, pero leer por el cliente propio del repositorio
        // seria OTRA conexion dentro de un bloque transaccional, y el dia que esta rama se mueva
        // detras de una escritura el fallo seria mudo y sobre dinero.
        const registro = clasificarRegistro(
          await this.libroRepo.listarPremiosPorDias(fila.mensajeroId, [fila.fecha], tx),
        );
        return registro === "anulado" ? { status: "anulado" } : { status: "ya_registrado" };
      }

      // R20: el egreso de la caja, en la MISMA transaccion. Origen = la FILA DEL PODIO.
      const enCaja = await this.caja.emitirEgresoPremio(tx, {
        filaId: fila.filaId,
        monto,
        descripcion: descripcionDelPremio(fechaTexto, fila),
        registradoPor: actor.usuarioId,
      });
      if (enCaja === 0) {
        // Imposible en el camino real: el devengo se acaba de escribir, asi que no puede haber un
        // egreso previo con esta clave. Si ocurriera, la fila del libro quedaria sin su egreso —
        // dinero que sale sin registro—, y eso NO se devuelve como `ok`: se revienta y se revierte
        // todo (la familia de fallos mudos sobre dinero es justo lo que esta ficha persigue).
        throw new Error(
          `premio-ranking: el devengo de la fila ${fila.filaId} se escribio pero su egreso de caja no`,
        );
      }
      return { status: "ok", monto, cierreId: cierre.cierreId };
    });
  }

  /**
   * R29-R33 — la anulacion: un movimiento COMPENSATORIO y el reverso de caja, en la misma
   * transaccion, dejando el efecto neto en cero y SIN tocar las filas originales (R21).
   *
   * Feature 297: aqui NO va la guarda de «cero entregas». Anular es el remedio, no el cobro; si
   * un premio de una fila con 0 entregas alcanzo a registrarse antes de la 297, bloquear su
   * anulacion dejaria ese dinero devengado para siempre — exactamente lo contrario de la ficha.
   */
  async anularPremio(input: AnularPremioInput, actor: Actor): Promise<AnularPremioResult> {
    if (this.sinAcceso(actor)) return { status: "forbidden" };

    const fila = await this.snapshotRepo.obtenerFilaDelPodio(input.filaId);
    if (fila === null) return { status: "no_encontrado" };

    const registradas = await this.libroRepo.listarPremiosPorDias(fila.mensajeroId, [fila.fecha]);
    const premio = registradas.find((r) => r.categoria === "premio_ranking");
    // No hay nada que anular: la pantalla lo dice con texto, no con la ausencia del control.
    if (premio === undefined) return { status: "no_registrado" };
    // R31: segunda anulacion -> se responde y no se escribe. Sin error.
    if (registradas.some((r) => r.categoria === "ajuste_pago")) return { status: "ya_anulado" };
    if (premio.cierreId === null) {
      // Imposible: el premio se escribe SIEMPRE con `origen_tipo = cierre_dia` y el cierre en
      // `origen_id`. Sin cierre, la compensacion no entraria en `sumarPremiosVivosPorCierre` y lo
      // pagable no bajaria (R33): un descuadre mudo. Se falla con contexto en vez de escribirla.
      throw new Error(
        `premio-ranking: el premio de la fila ${fila.filaId} no tiene cierre en su origen`,
      );
    }

    const cierreId = premio.cierreId;
    return this.runTransaction(async (tx) => {
      const escritas = await this.libroRepo.crearMovimientos(tx, [
        {
          mensajeroId: fila.mensajeroId,
          tipo: "pago", // baja la cuenta por pagar exactamente lo que el devengo la subio
          categoria: "ajuste_pago",
          monto: premio.monto, // el MISMO importe: efecto neto CERO
          origenTipo: "cierre_dia", // el MISMO cierre: lo pagable de ESE cierre baja (R33)
          origenId: cierreId,
          premioDia: fila.fecha, // lo que la distingue de un `ajuste_pago` cualquiera
          descripcion: descripcionDeLaAnulacion(textoDeFecha(fila.fecha), fila, input.motivo),
          registradoPor: actor.usuarioId,
        },
      ]);
      // R31: el unico parcial del reverso rechazo la fila -> ya estaba anulado. Sin error.
      if (escritas === 0) return { status: "ya_anulado" };

      const enCaja = await this.caja.reversarEgresoPremio(tx, {
        filaId: fila.filaId,
        monto: premio.monto,
        descripcion: descripcionDeLaAnulacion(textoDeFecha(fila.fecha), fila, input.motivo),
        registradoPor: actor.usuarioId,
      });
      if (enCaja === 0) {
        throw new Error(
          `premio-ranking: la compensacion de la fila ${fila.filaId} se escribio pero su reverso de caja no`,
        );
      }
      return { status: "ok" };
    });
  }
}

/**
 * R7 — «tiene premio» es monto presente Y distinto de cero. El cero se compara con
 * `Prisma.Decimal` y no con `Number`: `"0.00"` y `"0"` son el mismo importe y ninguna comparacion
 * de strings lo sabe.
 */
function tienePremio(fila: Pick<PodioFilaRow, "premioMonto">): boolean {
  return fila.premioMonto !== null && !new Prisma.Decimal(fila.premioMonto).isZero();
}

/**
 * R9/R32 — de las filas del libro de ese (mensajero, dia) sale el estado: `anulado` si existe la
 * compensacion, `registrado` si solo esta el premio, `null` si no hay nada escrito.
 */
function clasificarRegistro(
  filas: readonly PremioRegistradoRow[],
): Extract<PremioPodioEstado, "registrado" | "anulado"> | null {
  if (filas.some((f) => f.categoria === "ajuste_pago")) return "anulado";
  if (filas.some((f) => f.categoria === "premio_ranking")) return "registrado";
  return null;
}

/**
 * La fecha `@db.Date` de vuelta a `YYYY-MM-DD`. La columna guarda la MEDIANOCHE UTC del dia
 * calendario CR (convencion del repo), asi que el corte del ISO es exacto y NO tiene el
 * off-by-one de las 18:00 que tendria un instante cualquiera.
 */
function textoDeFecha(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

/**
 * R22 — la descripcion nombra la fecha del podio, la posicion y la descripcion CONGELADA del
 * premio. La ultima parte se omite si ese dia no se congelo ninguna: no se inventa un texto.
 */
function descripcionDelPremio(fecha: string, fila: PodioFilaConFecha | PodioFilaRow): string {
  const base = `Premio del ranking ${fecha} · posición ${fila.posicion}`;
  return fila.premioDescripcion === null ? base : `${base} · ${fila.premioDescripcion}`;
}

/** R30 — el motivo de la anulacion queda REGISTRADO en el movimiento compensatorio. */
function descripcionDeLaAnulacion(
  fecha: string,
  fila: PodioFilaConFecha | PodioFilaRow,
  motivo: string,
): string {
  return `Anulación del premio del ranking ${fecha} · posición ${fila.posicion} · ${motivo}`;
}
