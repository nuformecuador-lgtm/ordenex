import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  CrearLiquidacionRepartoInput,
  CrearLiquidacionRepartoResult,
  ILiquidacionRepartoRepository,
  LiquidacionRepartoDTO,
  LiquidacionRepartoTxClient,
} from "@/lib/interfaces/repositories/ILiquidacionRepartoRepository";
import { esP2002, textoConstraintP2002 } from "@/lib/repositories/_shared/prisma-unique";

// Cliente Prisma acotado a lo que este repo necesita (patron LiquidacionPagoRepository). Solo
// `liquidacionReparto`: los pagos del reparto los lee y los escribe SU repositorio.
type LiquidacionRepartoPrismaClient = Pick<PrismaClient, "liquidacionReparto">;

/** La fila tal y como Prisma la devuelve. */
type RepartoRow = Prisma.LiquidacionRepartoGetPayload<Record<string, never>>;

/** Money-safe: `Decimal` -> STRING escala 2. Nunca `number`/`parseFloat` sobre un monto. */
function toDTO(r: RepartoRow): LiquidacionRepartoDTO {
  return {
    id: r.id,
    claveIdempotencia: r.claveIdempotencia,
    mensajeroId: r.mensajeroId,
    montoTotal: r.montoTotal.toFixed(2),
    registradoPor: r.registradoPor,
    registradoAt: r.createdAt.toISOString(),
  };
}

/**
 * §5.1/R29 — ¿este P2002 es el de `clave_idempotencia`?
 *
 * Se disambigua con `textoConstraintP2002`, que unifica la forma NATIVA (`meta.target`) y la del
 * driver adapter de Prisma 7 (`meta.driverAdapterError…originalMessage`, donde `target` viene
 * `undefined`). Leer solo `meta.target` dejaria escalar el P2002 crudo a un 500 bajo el adapter
 * — la cicatriz que documenta `_shared/prisma-unique.ts`.
 *
 * Un P2002 SIN pista tambien se trata como choque de la clave, y aqui el razonamiento se puede
 * comprobar: `liquidacion_reparto` tiene EXACTAMENTE dos restricciones unicas —la PK sobre un
 * uuid recien generado, imposible de repetir, y esta—, y la unica sentencia de esta clase que
 * puede producir un P2002 es el INSERT de abajo. Que sigan siendo dos no se deja a la memoria de
 * nadie: hay un test estructural sobre `db/schema.prisma` que lo afirma y que se pone rojo el dia
 * que alguien le anada un `@unique` o un `@@unique` a este modelo.
 *
 * Y si aun asi se acertara mal, la consecuencia es benigna: el servicio relee por la clave, no la
 * encuentra y responde `no_encontrado`. Nunca un reparto duplicado en silencio.
 */
function esChoqueDeClave(error: unknown): boolean {
  if (!esP2002(error)) return false;
  const texto = textoConstraintP2002(error);
  return texto === null || texto.includes("clave_idempotencia");
}

/**
 * Feature 205 — repositorio del ACTO de repartir (`liquidacion_reparto`). SOLO queries Prisma: ni
 * guardias de rol, ni calculo del reparto (eso es `lib/utils/reparto-liquidacion-mensajero.ts`),
 * ni decision de si el importe cabe. Money-safe: el monto entra y sale como STRING de escala 2.
 *
 * DOS metodos y ninguno mas, y la ausencia es el diseno: no hay `actualizar`, no hay `borrar` y
 * no hay `listar`. Un reparto es una fila INMUTABLE (R52); deshacerlo es anular sus pagos uno a
 * uno. Un metodo de edicion aqui seria la puerta por la que se corrige dinero sin dejar rastro.
 */
export class LiquidacionRepartoRepository implements ILiquidacionRepartoRepository {
  constructor(private readonly prisma: LiquidacionRepartoPrismaClient) {}

  /**
   * §5.1 — escribe las cuatro columnas del acto en `tx`. El instante lo pone la base
   * (`created_at DEFAULT now()`).
   *
   * El choque de `clave_idempotencia` sale como RESULTADO (`clave_repetida`), no como excepcion:
   * es el desenlace previsto del doble envio. Cualquier otro error se propaga.
   */
  async crear(
    tx: LiquidacionRepartoTxClient,
    input: CrearLiquidacionRepartoInput,
  ): Promise<CrearLiquidacionRepartoResult> {
    try {
      const row = await tx.liquidacionReparto.create({
        data: {
          claveIdempotencia: input.claveIdempotencia,
          mensajeroId: input.mensajeroId,
          montoTotal: new Prisma.Decimal(input.montoTotal), // STRING -> Decimal (money-safe)
          registradoPor: input.registradoPor,
        },
      });
      return { status: "creado", reparto: toDTO(row) };
    } catch (error) {
      if (esChoqueDeClave(error)) return { status: "clave_repetida" };
      throw error;
    }
  }

  /** §5.1/R28: relectura idempotente por la clave del cliente, con el cliente PROPIO. */
  async obtenerPorClave(claveIdempotencia: string): Promise<LiquidacionRepartoDTO | null> {
    const row = await this.prisma.liquidacionReparto.findUnique({ where: { claveIdempotencia } });
    return row === null ? null : toDTO(row);
  }
}
