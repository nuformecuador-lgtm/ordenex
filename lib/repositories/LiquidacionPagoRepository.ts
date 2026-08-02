import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  BeneficiarioBloqueo,
  CrearLiquidacionPagoInput,
  CrearLiquidacionPagoResult,
  ILiquidacionPagoRepository,
  LiquidacionPagoDTO,
  LiquidacionPagoTxClient,
} from "@/lib/interfaces/repositories/ILiquidacionPagoRepository";
import { esP2002, textoConstraintP2002 } from "@/lib/repositories/_shared/prisma-unique";

// Cliente Prisma acotado a lo que este repo necesita (patron WalletTiendaMovimientoRepository).
type LiquidacionPrismaClient = Pick<PrismaClient, "liquidacionPago">;

/**
 * Lo que hace falta para componer el comprobante en UNA consulta: el NOMBRE de quien registro
 * y, si existe, la anulacion con el NOMBRE de quien anulo (R56: la frontera no emite ids de
 * personas). Sin esto harian falta dos consultas mas por lista de comprobantes.
 */
const INCLUDE_DOCUMENTO = {
  registrador: { select: { nombre: true } },
  anulacion: { include: { anulador: { select: { nombre: true } } } },
} as const;

type DocumentoRow = Prisma.LiquidacionPagoGetPayload<{ include: typeof INCLUDE_DOCUMENTO }>;

/**
 * §5/R80 — «VIGENTE» = SIN fila en `liquidacion_anulacion`. Se declara UNA vez y se reusa en
 * las dos sumas: si el criterio viviera copiado en cada `where`, una de las dos podria quedarse
 * contando pagos anulados y el pendiente saldria bajo. Prisma lo traduce a un filtro sobre la
 * relacion (`NOT EXISTS` sobre la tabla de anulaciones), no a un post-filtro en memoria.
 */
const VIGENTE = { anulacion: { is: null } } as const;

/** Money-safe: `Decimal` -> STRING escala 2. Nunca `number`/`parseFloat` sobre un monto. */
function toDTO(r: DocumentoRow): LiquidacionPagoDTO {
  return {
    id: r.id,
    mensajeroId: r.mensajeroId,
    tiendaId: r.tiendaId,
    cierreId: r.cierreId,
    monto: r.monto.toFixed(2),
    metodo: r.metodo,
    referencia: r.referencia,
    nota: r.nota,
    // La columna es `@db.Date` (medianoche UTC del dia): la fecha CALENDARIO es su prefijo.
    fechaPago: r.fechaPago.toISOString().slice(0, 10),
    registradoPorNombre: r.registrador.nombre,
    registradoAt: r.createdAt.toISOString(),
    anulacion:
      r.anulacion === null
        ? null
        : {
            motivo: r.anulacion.motivo,
            anuladoPorNombre: r.anulacion.anulador.nombre,
            anuladoAt: r.anulacion.createdAt.toISOString(),
          },
  };
}

/**
 * §4.1 — ¿este P2002 es el de `clave_idempotencia`?
 *
 * Se disambigua con `textoConstraintP2002`, que unifica la forma NATIVA (`meta.target`) y la
 * del driver adapter de Prisma 7 (`meta.driverAdapterError…originalMessage`, donde `target`
 * viene `undefined`). Leer solo `meta.target` dejaria escalar el P2002 crudo a un 500 bajo el
 * adapter — la cicatriz que documenta `_shared/prisma-unique.ts`.
 *
 * Un P2002 SIN pista tambien se trata como choque de clave: `liquidacion_pago` solo tiene dos
 * restricciones unicas —la PK sobre un uuid recien generado, imposible de repetir, y esta—, y
 * la consecuencia de acertar mal es benigna: el servicio relee por la clave, no la encuentra y
 * responde `no_encontrado`. Nunca un pago duplicado en silencio.
 */
function esChoqueDeClave(error: unknown): boolean {
  if (!esP2002(error)) return false;
  const texto = textoConstraintP2002(error);
  return texto === null || texto.includes("clave_idempotencia");
}

/**
 * Feature 172 — repositorio del DOCUMENTO del pago (`liquidacion_pago`). SOLO queries Prisma:
 * ni guardias de rol, ni derivacion del disponible, ni decision de si el pago cabe. Money-safe:
 * los montos entran y salen como STRING de escala 2.
 *
 * Dos cosas que solo pueden vivir aqui, y por eso se prueban aqui:
 *  - el `SELECT … FOR UPDATE` de §4.2, que es SQL crudo y ningun doble de servicio ve;
 *  - el filtro de «vigentes» (§5/R80), que es un `where` y tampoco se ve desde el servicio.
 */
export class LiquidacionPagoRepository implements ILiquidacionPagoRepository {
  constructor(private readonly prisma: LiquidacionPrismaClient) {}

  /**
   * §4.2 (R83/R85) — bloqueo de fila, DENTRO de `tx`, sobre la fila exacta del beneficiario.
   *
   * `FOR UPDATE` y no `isolationLevel: "Serializable"` (alternativa K, descartada): Postgres
   * abortaria una de las dos transacciones con un error de serializacion que llegaria como
   * fallo generico y obligaria a reintentar una operacion de DINERO. Tampoco
   * `pg_advisory_xact_lock` (alternativa L): los hashes colisionan y degradan en silencio.
   *
   * El id va como PARAMETRO de la sentencia (`${...}` de la template tag de Prisma), nunca
   * interpolado en el texto: es la regla del repo para todo SQL crudo. Hay un test que lo fija.
   */
  async bloquearBeneficiario(
    tx: LiquidacionPagoTxClient,
    objetivo: BeneficiarioBloqueo,
  ): Promise<void> {
    if (objetivo.tipo === "tienda") {
      await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "usuario" WHERE "id" = ${objetivo.tiendaId} FOR UPDATE`;
      return;
    }
    await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "cierre_dia" WHERE "id" = ${objetivo.cierreId} FOR UPDATE`;
  }

  /**
   * R7/R9 — escribe las 10 columnas del documento en `tx`. El instante de registro lo pone la
   * base (`created_at DEFAULT now()`), asi que fecha real e instante conviven y pueden diferir.
   *
   * El choque de `clave_idempotencia` sale como RESULTADO (`clave_repetida`), no como excepcion:
   * es un desenlace previsto del doble submit, no un fallo. Cualquier otro error se propaga.
   */
  async crear(
    tx: LiquidacionPagoTxClient,
    input: CrearLiquidacionPagoInput,
  ): Promise<CrearLiquidacionPagoResult> {
    try {
      const row = await tx.liquidacionPago.create({
        data: {
          claveIdempotencia: input.claveIdempotencia,
          mensajeroId: input.mensajeroId,
          tiendaId: input.tiendaId,
          cierreId: input.cierreId,
          monto: new Prisma.Decimal(input.monto), // STRING -> Decimal (money-safe)
          metodo: input.metodo,
          referencia: input.referencia,
          nota: input.nota,
          fechaPago: input.fechaPago,
          registradoPor: input.registradoPor,
        },
        include: INCLUDE_DOCUMENTO,
      });
      return { status: "creado", pago: toDTO(row) };
    } catch (error) {
      if (esChoqueDeClave(error)) return { status: "clave_repetida" };
      throw error;
    }
  }

  /** §4.1: relectura idempotente por la clave del cliente. */
  async obtenerPorClave(claveIdempotencia: string): Promise<LiquidacionPagoDTO | null> {
    const row = await this.prisma.liquidacionPago.findUnique({
      where: { claveIdempotencia },
      include: INCLUDE_DOCUMENTO,
    });
    return row === null ? null : toDTO(row);
  }

  /** R70: el pago por su id, con su anulacion si la tiene. */
  async obtenerPorId(id: string): Promise<LiquidacionPagoDTO | null> {
    const row = await this.prisma.liquidacionPago.findUnique({
      where: { id },
      include: INCLUDE_DOCUMENTO,
    });
    return row === null ? null : toDTO(row);
  }

  /**
   * §5/R80 — Σ de los pagos VIGENTES por cierre, UNA consulta para toda la pagina de cierres:
   * el numero de consultas no crece con el tamaño de pagina.
   */
  async sumarVigentesPorCierre(cierreIds: string[]): Promise<Record<string, string>> {
    const total: Record<string, string> = {};
    for (const id of cierreIds) total[id] = "0.00"; // entrada por CADA id pedido
    if (cierreIds.length === 0) return total;

    const grupos = await this.prisma.liquidacionPago.groupBy({
      by: ["cierreId"],
      where: { cierreId: { in: cierreIds }, ...VIGENTE },
      _sum: { monto: true },
    });
    for (const g of grupos) {
      if (g.cierreId === null) continue; // imposible por el WHERE; el tipo lo admite
      total[g.cierreId] = new Prisma.Decimal(g._sum.monto ?? 0).toFixed(2);
    }
    return total;
  }

  /** §5/R80: Σ de los pagos VIGENTES de una tienda. Salida STRING (money-safe). */
  async sumarVigentesPorTienda(tiendaId: string): Promise<string> {
    const agg = await this.prisma.liquidacionPago.aggregate({
      where: { tiendaId, ...VIGENTE },
      _sum: { monto: true },
    });
    return new Prisma.Decimal(agg._sum.monto ?? 0).toFixed(2);
  }

  /**
   * R49/R74 — los comprobantes de un cierre. A diferencia de las sumas, la LISTA trae tambien
   * los anulados: un pago anulado deja de descontar pero NO deja de verse (se muestra entero y
   * marcado). Orden: la fecha real primero y el instante de registro como desempate, para que
   * dos pagos del mismo dia salgan siempre en el mismo orden.
   */
  async listarPorCierre(cierreId: string): Promise<LiquidacionPagoDTO[]> {
    const rows = await this.prisma.liquidacionPago.findMany({
      where: { cierreId },
      include: INCLUDE_DOCUMENTO,
      orderBy: [{ fechaPago: "desc" }, { createdAt: "desc" }],
    });
    return rows.map(toDTO);
  }

  /** R50/R74: idem para una tienda (sin cierre: van contra el saldo acumulado). */
  async listarPorTienda(tiendaId: string): Promise<LiquidacionPagoDTO[]> {
    const rows = await this.prisma.liquidacionPago.findMany({
      where: { tiendaId },
      include: INCLUDE_DOCUMENTO,
      orderBy: [{ fechaPago: "desc" }, { createdAt: "desc" }],
    });
    return rows.map(toDTO);
  }
}
