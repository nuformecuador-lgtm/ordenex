import { esAccesoTotal } from "@/lib/auth/acceso-total";
import type { IAjusteCajaAnulacionRepository } from "@/lib/interfaces/repositories/IAjusteCajaAnulacionRepository";
import type { IWalletMovimientoRepository } from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type {
  AjusteCajaTxRunner,
  AnularAjusteCajaServiceResult,
  IAjusteCajaService,
} from "@/lib/interfaces/services/IAjusteCajaService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  AnularAjusteCajaInput,
  WalletMovimientoCategoria,
  WalletMovimientoDTO,
  WalletMovimientoTipo,
} from "@/lib/types/wallet";

class YaAnuladoError extends Error {
  constructor() {
    super("correccion de caja: ya anulada");
    this.name = "YaAnuladoError";
  }
}

/**
 * R69 — el contra-asiento de una correccion es la correccion OPUESTA: una que sumo dinero se
 * deshace con una que lo resta, y al reves. Las dos son de naturaleza propia y liquidez efectivo,
 * asi que la pareja deja la ganancia y la cifra principal donde estaban y R7 sigue cumpliendose.
 */
const CONTRA_ASIENTO: Record<
  "ingreso_ajuste" | "egreso_ajuste",
  { tipo: WalletMovimientoTipo; categoria: WalletMovimientoCategoria }
> = {
  ingreso_ajuste: { tipo: "egreso", categoria: "egreso_ajuste" },
  egreso_ajuste: { tipo: "ingreso", categoria: "ingreso_ajuste" },
};

/** R70 — solo la correccion ORIGINAL se anula: su contra-asiento (mismo origen, con `origen_id`) no. */
function esCorreccionOriginal(
  m: WalletMovimientoDTO,
): m is WalletMovimientoDTO & { categoria: keyof typeof CONTRA_ASIENTO } {
  return (
    (m.categoria === "ingreso_ajuste" || m.categoria === "egreso_ajuste") &&
    m.origenTipo === "manual" &&
    m.origenId === null
  );
}

/**
 * FICHA 461 (R69–R71, auditoria D3) — ANULA una correccion de caja. Molde: `CobroTiendaService.anular`
 * y `AporteCapitalService.anular`.
 *
 * EL ORDEN ES PARTE DEL REQUISITO:
 *  1. ROL PRIMERO (R70), antes de leer nada.
 *  2. La CORRECCION, por su id y SOLO si es original (R70): otra fila del libro o un id inexistente
 *     responden `no_encontrado`, sin escribir nada. Se lee FUERA de la transaccion: la fila es
 *     inmutable y no puede quedarse obsoleta; lo que si puede cambiar —la anulacion— se decide
 *     dentro, con el UNIQUE.
 *  3. UN instante: el de la anulacion (R69), como el cobro y el aporte.
 *  4. LA TRANSACCION: constancia + historial (el UNIQUE es el candado: si llegan dos a la vez, la
 *     segunda choca y todo lo suyo se revierte) → contra-asiento por el monto DE LA CORRECCION,
 *     origen `manual`/id de la correccion (idempotente ademas por `(origen_tipo, origen_id,
 *     categoria)`). Ni la correccion ni nada se edita o se borra.
 */
export class AjusteCajaService implements IAjusteCajaService {
  constructor(
    private readonly walletRepo: IWalletMovimientoRepository,
    private readonly anulaciones: IAjusteCajaAnulacionRepository,
    private readonly runTransaction: AjusteCajaTxRunner,
    /** R69: el instante del contra-asiento. Inyectable para los tests. */
    private readonly ahora: () => Date = () => new Date(),
  ) {}

  async anular(input: AnularAjusteCajaInput, actor: Actor): Promise<AnularAjusteCajaServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R70: antes de leer

    const correccion = await this.walletRepo.obtenerPorId(input.movimientoId);
    if (correccion === null || !esCorreccionOriginal(correccion)) return { status: "no_encontrado" }; // R70

    const instante = this.ahora(); // R69
    const opuesto = CONTRA_ASIENTO[correccion.categoria];

    try {
      await this.runTransaction(async (tx) => {
        const constancia = await this.anulaciones.anular(tx, {
          movimientoId: correccion.id,
          motivo: input.motivo,
          anuladoPor: actor.usuarioId,
        });
        if (constancia.status === "ya_anulado") throw new YaAnuladoError();

        // R69: el contra-asiento, por el monto DE LA CORRECCION (nunca uno de la peticion).
        await this.walletRepo.crearMovimientos(tx, [
          {
            tipo: opuesto.tipo,
            categoria: opuesto.categoria,
            monto: correccion.monto,
            origenTipo: "manual",
            origenId: correccion.id,
            descripcion:
              correccion.descripcion === null ? "Anulación" : `Anulación · ${correccion.descripcion}`,
            registradoPor: actor.usuarioId,
            fechaMovimiento: instante,
          },
        ]);
      });
    } catch (error) {
      if (error instanceof YaAnuladoError) return { status: "ya_anulado" }; // R70
      throw error;
    }

    return { status: "ok" };
  }
}
