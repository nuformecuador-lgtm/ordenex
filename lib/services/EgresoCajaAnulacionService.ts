import { esAccesoTotal } from "@/lib/auth/acceso-total";
import type { IAjusteCajaAnulacionRepository } from "@/lib/interfaces/repositories/IAjusteCajaAnulacionRepository";
import type { IWalletMovimientoRepository } from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type { AjusteCajaTxRunner } from "@/lib/interfaces/services/IAjusteCajaService";
import type {
  AnularEgresoCajaServiceResult,
  IEgresoCajaAnulacionService,
} from "@/lib/interfaces/services/IEgresoCajaAnulacionService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { WalletMovimientoCategoria, WalletMovimientoDTO } from "@/lib/types/wallet";
import type { AnularEgresoCajaInput } from "@/lib/types/wallet-anulacion";
import { nombreDelEgresoAnulable } from "@/lib/utils/egreso-anulable";

class YaAnuladoError extends Error {
  constructor() {
    super("egreso de caja: ya anulado");
    this.name = "YaAnuladoError";
  }
}

/**
 * R63/R65 — ¿es este movimiento un egreso ORIGINAL que se anula por esta via?
 *
 *  · origen `gasto`, tipo egreso: sueldo, gasto de Ordenex, gasto fijo cobrado (y el reservado
 *    `egreso_gasto`). Es EXACTAMENTE el conjunto que `reversarEgreso` ya reversaba (feature 45).
 *  · `egreso_indemnizacion` con origen `orden_incidente` y su `origen_id` (el incidente, D8). La del
 *    cierre (origen `cierre_dia`) NO: lo que produce la aprobacion de un cierre no se anula (R65).
 *
 * El reverso de un egreso es un `ingreso`: nunca cae aqui.
 */
function esEgresoAnulable(m: WalletMovimientoDTO): boolean {
  if (m.tipo !== "egreso") return false;
  if (m.origenTipo === "gasto") return true;
  return m.origenTipo === "orden_incidente" && m.categoria === "egreso_indemnizacion" && m.origenId !== null;
}

/**
 * D8 — el ORIGEN del contra-asiento. El del gasto apunta al egreso (como el reverso de siempre, de
 * modo que un reverso previo SIN constancia y esta anulacion chocan en el mismo indice unico); el de
 * la indemnizacion apunta al INCIDENTE, que es su clave de idempotencia desde la 158.
 */
function origenDelContraAsiento(m: WalletMovimientoDTO): { origenTipo: "gasto" | "orden_incidente"; origenId: string } {
  if (m.origenTipo === "orden_incidente" && m.origenId !== null) {
    return { origenTipo: "orden_incidente", origenId: m.origenId };
  }
  return { origenTipo: "gasto", origenId: m.id };
}

/**
 * FICHA 458-B (D13, R63–R67) — ANULA con motivo un egreso de caja sin documento propio. Molde:
 * `AjusteCajaService.anular` (461).
 *
 * EL ORDEN ES PARTE DEL REQUISITO:
 *  1. ROL PRIMERO (R82), antes de leer nada.
 *  2. El EGRESO, por su id y SOLO si es un original anulable. Se lee FUERA de la transaccion: la fila
 *     es inmutable; lo que puede cambiar —la anulacion— se decide dentro.
 *  3. UN instante (`ahora()`), el de la anulacion (R64, leccion de la 461 §5.1).
 *  4. LA TRANSACCION: constancia + historial (su `skipDuplicates` es el candado: dos a la vez → una)
 *     → contra-asiento `ingreso_ajuste` por el monto DEL EGRESO (nunca uno de la peticion). Si el
 *     contra-asiento ya existia (reverso de antes de esta ficha, sin constancia), se revierte todo y
 *     se responde `ya_anulado`: no hay dos reversos del mismo egreso.
 *
 * Efecto (design §4.3): cifra principal +M, ganancia +M; «De las tiendas» y capital no cambian.
 */
export class EgresoCajaAnulacionService implements IEgresoCajaAnulacionService {
  constructor(
    private readonly walletRepo: Pick<IWalletMovimientoRepository, "obtenerPorId" | "crearMovimientos">,
    private readonly anulaciones: Pick<IAjusteCajaAnulacionRepository, "anularEgreso">,
    private readonly runTransaction: AjusteCajaTxRunner,
    /** R64: el instante del contra-asiento. Inyectable para los tests. */
    private readonly ahora: () => Date = () => new Date(),
  ) {}

  async anular(input: AnularEgresoCajaInput, actor: Actor): Promise<AnularEgresoCajaServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R82: antes de leer

    const egreso = await this.walletRepo.obtenerPorId(input.movimientoId);
    if (egreso === null || !esEgresoAnulable(egreso)) return { status: "no_encontrado" };

    const instante = this.ahora(); // R64
    const origen = origenDelContraAsiento(egreso);

    try {
      await this.runTransaction(async (tx) => {
        const constancia = await this.anulaciones.anularEgreso(tx, {
          movimientoId: egreso.id,
          motivo: input.motivo,
          anuladoPor: actor.usuarioId,
        });
        if (constancia.status === "ya_anulado") throw new YaAnuladoError(); // R66/R67

        // R64: el contra-asiento, por el monto DEL EGRESO. R4: la descripcion nunca cae al uuid.
        const escritas = await this.walletRepo.crearMovimientos(tx, [
          {
            tipo: "ingreso",
            categoria: "ingreso_ajuste",
            monto: egreso.monto,
            origenTipo: origen.origenTipo,
            origenId: origen.origenId,
            descripcion: `Anulación de: ${egreso.descripcion ?? nombreDelEgresoAnulable(egreso.categoria as WalletMovimientoCategoria)}`,
            registradoPor: actor.usuarioId,
            fechaMovimiento: instante,
          },
        ]);
        // 0 = ya habia un reverso de este egreso (la via vieja, sin motivo): la constancia de arriba
        // se revierte con la transaccion y el egreso sigue «anulado, motivo no registrado» (R72).
        if (escritas === 0) throw new YaAnuladoError();
      });
    } catch (error) {
      if (error instanceof YaAnuladoError) return { status: "ya_anulado" };
      throw error;
    }
    return { status: "ok" };
  }
}
