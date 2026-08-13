import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  AnularLiquidacionPagoInput,
  AnularLiquidacionPagoResult,
  BeneficiarioBloqueo,
  CierreImputableDTO,
  CierreParaPagoDTO,
  CierresNoAprobadosPorEstadoDTO,
  CrearLiquidacionPagoInput,
  CrearLiquidacionPagoResult,
  ILiquidacionPagoRepository,
  LiquidacionAnulacionTxClient,
  LiquidacionCierreTxClient,
  LiquidacionPagoDTO,
  LiquidacionPagoTxClient,
} from "@/lib/interfaces/repositories/ILiquidacionPagoRepository";
import { esP2002, textoConstraintP2002 } from "@/lib/repositories/_shared/prisma-unique";

// Cliente Prisma acotado a lo que este repo necesita (patron WalletTiendaMovimientoRepository).
// `cierreDia` entra SOLO para leer (R42): ningun metodo de esta clase lo escribe.
type LiquidacionPrismaClient = Pick<PrismaClient, "liquidacionPago" | "cierreDia">;

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
    // Feature 206: la columna existe desde la 205 y ya se ESCRIBIA (:179); lo que faltaba era
    // leerla. Es lo que identifica al grupo en la anulacion agrupada.
    repartoId: r.repartoId,
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
 *
 * **ESE «solo tiene dos» ES UNA PREMISA VIVA, no una observacion de una vez.** El dia que alguien
 * le anada una tercera restriccion unica a `liquidacion_pago`, su choque llegaria aqui sin pista
 * (bajo el driver adapter el `meta.target` viene VACIO) y se leeria como clave repetida: el
 * servicio releeria por la clave, no la encontraria y responderia `no_encontrado` a un pago
 * legitimo — un error silencioso y carisimo de diagnosticar desde el sintoma. Por eso la feature
 * 205 le puso a `reparto_id` un indice a secas y llevo el `UNIQUE` de su idempotencia a
 * `liquidacion_reparto`, y por eso la premisa esta bajo test: el bloque de Postgres real de
 * `tests/integration/db/liquidacion-reparto-migration.test.ts` compara el conjunto de indices
 * unicos de esta tabla antes y despues de la migracion y exige que sea el MISMO.
 */
function esChoqueDeClave(error: unknown): boolean {
  if (!esP2002(error)) return false;
  const texto = textoConstraintP2002(error);
  return texto === null || texto.includes("clave_idempotencia");
}

/**
 * T F.1/R75 — ¿este P2002 es el del `UNIQUE(pago_id)` de `liquidacion_anulacion`?
 *
 * Mismo tratamiento que el choque de la clave, y por el mismo motivo: se disambigua con
 * `textoConstraintP2002` para cubrir las dos formas del error (nativa y driver adapter). La
 * unica sentencia que puede producir un P2002 aqui es el INSERT de la anulacion, y esa tabla
 * solo tiene dos restricciones unicas —la PK sobre un uuid recien generado, imposible de
 * repetir, y esta—, asi que un P2002 SIN pista tambien se lee como «ya anulado»: el servicio
 * relee el pago y, si no encontrara la anulacion, responde `no_encontrado`. Nunca una segunda
 * anulacion en silencio.
 */
function esChoqueDeAnulacion(error: unknown): boolean {
  if (!esP2002(error)) return false;
  const texto = textoConstraintP2002(error);
  return texto === null || texto.includes("pago_id") || texto.includes("liquidacion_anulacion");
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
   * R7/R9 — escribe las 11 columnas del documento en `tx` (10 de la 172 + `reparto_id` de la
   * 205). El instante de registro lo pone la base (`created_at DEFAULT now()`), asi que fecha
   * real e instante conviven y pueden diferir.
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
          // Feature 205 (R28): el ACTO del que nace, o `null` si no nace de ninguno. Se emite
          // SIEMPRE (no `...(x ? {} : {})`): la columna es nullable y `null` significa «pago
          // suelto contra un cierre», que es un dato, no una ausencia.
          repartoId: input.repartoId,
        },
        include: INCLUDE_DOCUMENTO,
      });
      return { status: "creado", pago: toDTO(row) };
    } catch (error) {
      if (esChoqueDeClave(error)) return { status: "clave_repetida" };
      throw error;
    }
  }

  /**
   * R20/R21/R22 — el cierre contra el que se paga, leido en `tx` cuando lo hay (la guardia del
   * registro) y en el cliente propio cuando no (la relectura idempotente).
   *
   * `select` explicito y minimo: de una tabla que esta feature NO gobierna se leen cuatro
   * columnas y ni una mas. Los dos montos se emiten como STRING de escala 2 aqui mismo, para
   * que ningun `Decimal` de Prisma escape del repositorio.
   */
  async obtenerCierreParaPago(
    cierreId: string,
    tx?: LiquidacionCierreTxClient,
  ): Promise<CierreParaPagoDTO | null> {
    const cliente = tx ?? this.prisma;
    const row = await cliente.cierreDia.findUnique({
      where: { id: cierreId },
      select: {
        id: true,
        mensajeroId: true,
        estado: true,
        totalPagoMensajero: true,
        totalEfectivo: true,
      },
    });
    if (row === null) return null;
    return {
      id: row.id,
      mensajeroId: row.mensajeroId,
      estado: row.estado,
      totalPagoMensajero: row.totalPagoMensajero.toFixed(2),
      totalEfectivo: row.totalEfectivo.toFixed(2),
    };
  }

  /**
   * Feature 205 (T2.2, R5/R6/R8) — los cierres `aprobado` de UN mensajero, con sus dos snapshots
   * y su ANTIGUEDAD, ordenados `solicitado_at ASC, id ASC`.
   *
   * Tres cosas que solo se ven aqui y que ningun doble de servicio veria:
   *
   *  - el WHERE lleva `estado: "aprobado"` (mitad de R5) **y** `mensajeroId` (R24: nunca se
   *    imputa a un cierre de otra persona). Quitar cualquiera de los dos es lo que una mutacion
   *    del `where` haria, y los tests de servicio pasarian igual;
   *  - **no hay `take`** (design §2.5.6): el tope de R53 acota la escritura, no la lectura;
   *  - el `select` es explicito y minimo: de una tabla que esta feature NO gobierna se leen seis
   *    columnas y ni una mas. `resuelto_at` NO esta, a proposito (design §2.4).
   */
  async listarCierresImputables(
    mensajeroId: string,
    tx?: LiquidacionCierreTxClient,
  ): Promise<CierreImputableDTO[]> {
    const cliente = tx ?? this.prisma;
    const rows = await cliente.cierreDia.findMany({
      where: { mensajeroId, estado: "aprobado" },
      select: {
        id: true,
        mensajeroId: true,
        estado: true,
        totalPagoMensajero: true,
        totalEfectivo: true,
        solicitadoAt: true,
      },
      // Eficiencia, no la verdad del orden: quien fija R8 es `ordenarCierresFifo`, que reordena
      // lo que reciba. El desempate por `id` esta igualmente aqui para que dos cierres del mismo
      // instante salgan siempre igual del motor.
      orderBy: [{ solicitadoAt: "asc" }, { id: "asc" }],
    });
    return rows.map((row) => ({
      id: row.id,
      mensajeroId: row.mensajeroId,
      estado: row.estado,
      totalPagoMensajero: row.totalPagoMensajero.toFixed(2),
      totalEfectivo: row.totalEfectivo.toFixed(2),
      solicitadoAt: row.solicitadoAt.toISOString(),
    }));
  }

  /**
   * Feature 205 (T3.1, R36 — enmienda de negocio) — CUANTOS cierres del mensajero NO estan
   * `aprobado`, por estado. Es el complemento exacto del metodo de arriba, contado.
   *
   * Lo que solo se ve aqui, y por eso se prueba aqui:
   *
   *  - **es un `groupBy`, no un `findMany` que se cuenta despues.** El agregado lo hace la base:
   *    de la base salen tantas filas como estados no aprobados tenga el mensajero (un puñado),
   *    no tantas como cierres. Contar en memoria daria el mismo numero devolviendo la lista
   *    entera por la red, que es exactamente lo que esta lectura existe para no hacer;
   *  - el WHERE lleva `estado: { not: "aprobado" }` **y** `mensajeroId`. Sin el `not` se contarian
   *    tambien los cierres pagables y la pantalla los daria por excluidos; sin el `mensajeroId`
   *    contaria los de otra persona;
   *  - se agrupa por `estado` y por nada mas (R36 pide decir POR QUE quedan fuera). Agrupar por
   *    otra columna —`solicitadoAt`, por ejemplo— devolveria otra vez una fila por cierre con
   *    otro nombre, y el tope volveria a desaparecer;
   *  - el `_count` no trae **ningun** `_sum` (R36/design §7.2): un cierre no aprobado no ha
   *    devengado nada, asi que de aqui no puede salir una cifra que inventar. Un conteo no es un
   *    monto;
   *  - el orden es por `estado`, que es total y estable: dos llamadas iguales pintan igual.
   */
  async contarCierresNoAprobadosPorEstado(
    mensajeroId: string,
  ): Promise<CierresNoAprobadosPorEstadoDTO[]> {
    const grupos = await this.prisma.cierreDia.groupBy({
      by: ["estado"],
      where: { mensajeroId, estado: { not: "aprobado" } },
      _count: { _all: true },
      orderBy: { estado: "asc" },
    });
    return grupos.map((grupo) => ({ estado: grupo.estado, cantidad: grupo._count._all }));
  }

  /**
   * T F.1 (R69/R73/R75) — inserta la ANULACION. Tres columnas y ni una mas: el `id` y el
   * instante los pone la base (`created_at DEFAULT now()`, R73), igual que en el pago.
   *
   * **No hay ningun `update` sobre `liquidacion_pago` en este metodo, ni en toda la clase.** Es
   * el corazon del modelo (design §2.2, alternativa H descartada): el pago es una fila INMUTABLE
   * y «anulado» se DERIVA de que exista esta fila. Con una marca en el pago habria dos sitios
   * —la marca y el contraasiento del libro— que podrian desincronizarse; asi no hay nada que
   * sincronizar.
   *
   * El choque del `UNIQUE(pago_id)` sale como RESULTADO (`ya_anulado`), nunca como excepcion que
   * suba: es el desenlace previsto del doble clic. Cualquier otro error se propaga.
   */
  async anular(
    tx: LiquidacionAnulacionTxClient,
    input: AnularLiquidacionPagoInput,
  ): Promise<AnularLiquidacionPagoResult> {
    try {
      const row = await tx.liquidacionAnulacion.create({
        data: {
          pagoId: input.pagoId,
          motivo: input.motivo,
          anuladoPor: input.anuladoPor, // R73: QUIEN anulo
        },
        include: { anulador: { select: { nombre: true } } }, // R56: NOMBRE, no id
      });
      return {
        status: "anulado",
        anulacion: {
          motivo: row.motivo,
          anuladoPorNombre: row.anulador.nombre,
          anuladoAt: row.createdAt.toISOString(), // R73: CUANDO se anulo
        },
      };
    } catch (error) {
      if (esChoqueDeAnulacion(error)) return { status: "ya_anulado" };
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

  /**
   * Feature 205 (T2.2, R28) — los pagos de UN reparto. Es lo que permite reconstruir el
   * resultado original de un reparto repetido con una consulta directa (`WHERE reparto_id = ...`)
   * en vez de inferirlo del importe, de la fecha o de la referencia.
   *
   * Mismo criterio que `listarPorCierre`: trae los ANULADOS marcados (R74) y ordena por la fecha
   * real con el instante de registro como desempate.
   */
  async listarPorReparto(repartoId: string): Promise<LiquidacionPagoDTO[]> {
    const rows = await this.prisma.liquidacionPago.findMany({
      where: { repartoId },
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
