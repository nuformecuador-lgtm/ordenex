import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  CrearCobroPendienteInput,
  GastoFijoCobroEstadoDecidido,
  GastoFijoCobroRegistro,
  GastoFijoCobroTxClient,
  IGastoFijoCobroRepository,
} from "@/lib/interfaces/repositories/IGastoFijoCobroRepository";
import type { GastoFijoCobroDTO } from "@/lib/types/gasto-fijo-cobro";

// Cliente Prisma acotado a lo que este repo necesita (patron WalletMovimientoRepository): no
// puede tocar `wallet_movimiento` ni `gasto_fijo_plantilla` aunque quisiera, por el TIPO.
type CobroPrismaClient = Pick<PrismaClient, "gastoFijoCobro">;

type CobroRow = Prisma.GastoFijoCobroGetPayload<Record<string, never>>;

/**
 * `generado_el` es una columna `DATE`: Prisma la entrega como `Date` a medianoche UTC, asi que
 * el `YYYY-MM-DD` sale de recortar el ISO. NO se usa la hora local — la fila YA es medianoche
 * UTC y leerla en local reabre el off-by-one que cerro la 166. Mismo par de helpers que
 * `GastoFijoPlantillaRepository` usa para `fecha_cobro`.
 */
function diaADTO(dia: Date): string {
  return dia.toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` -> `Date` a medianoche UTC, la convencion con que se persiste la columna DATE. */
function diaAColumna(dia: string): Date {
  return new Date(`${dia}T00:00:00.000Z`);
}

/**
 * Money-safe: `Decimal` -> STRING escala 2. `Decimal.toFixed(2)` es del propio Decimal, NO pasa
 * por `number`: ni un `parseFloat`, ni un `Number(`, ni aritmetica sobre el monto en todo el
 * archivo (R43).
 */
function toDTO(r: CobroRow): GastoFijoCobroDTO {
  return {
    id: r.id,
    concepto: r.concepto,
    monto: r.monto.toFixed(2),
    periodo: r.periodo,
    generadoEl: diaADTO(r.generadoEl),
    estado: r.estado,
  };
}

/** La lectura COMPLETA, para uso interno del servidor. Lleva la clave del libro; el DTO no. */
function toRegistro(r: CobroRow): GastoFijoCobroRegistro {
  return {
    id: r.id,
    plantillaId: r.plantillaId,
    origenId: r.origenId,
    periodo: r.periodo,
    concepto: r.concepto,
    monto: r.monto.toFixed(2),
    estado: r.estado,
    generadoEl: diaADTO(r.generadoEl),
    decididoPor: r.decididoPor,
    decididoAt: r.decididoAt === null ? null : r.decididoAt.toISOString(),
    movimientoId: r.movimientoId,
  };
}

/**
 * ⚠️ EL ORDEN DE LA COLA, declarado UNA vez (R39): del MAS ANTIGUO al mas reciente.
 *
 * Es un orden TOTAL y no una sola columna, por la leccion que la 334 dejo escrita en
 * `WalletMovimientoRepository.listar`: `generado_el` es un `DATE`, asi que TODOS los cobros de
 * una misma corrida empatan por construccion —no es un caso raro, es el caso normal— y ordenar
 * solo por el deja el desempate indefinido. `created_at` desempata por creacion real e `id`
 * cierra el orden aunque dos filas compartieran tambien el instante.
 */
const ORDEN_COLA: Prisma.GastoFijoCobroOrderByWithRelationInput[] = [
  { generadoEl: "asc" },
  { createdAt: "asc" },
  { id: "asc" },
];

/**
 * Ficha 333 (C1) — repositorio de COBROS de gasto fijo. SOLO queries Prisma: sin logica de
 * negocio, sin guardias de rol y sin decidir nada.
 *
 * ⚠️ LA CLAVE `origen_id` NO SE CONSTRUYE AQUI. Llega ya resuelta en `CrearCobroPendienteInput`,
 * congelada por quien genera el cobro (R8), y es literalmente la misma cadena que acabara en
 * `wallet_movimiento.origen_id` al aprobar. Este archivo no la compone, no la parsea y no la
 * reescribe: solo la guarda y la devuelve. Cambiar su formato duplica plata (R11), y el aviso
 * largo vive en la cabecera de `GeneracionGastosFijosService`.
 */
export class GastoFijoCobroRepository implements IGastoFijoCobroRepository {
  constructor(private readonly prisma: CobroPrismaClient) {}

  /**
   * R6/R9 — inserta los pendientes de la corrida DENTRO de `tx`, idempotente por
   * `gasto_fijo_cobro_origen_uq`: `skipDuplicates` compila a `ON CONFLICT DO NOTHING`, asi que
   * la segunda corrida del mismo dia inserta 0 filas y la unicidad la decide el MOTOR, no una
   * lectura previa (sin TOCTOU). Devuelve cuantas se insertaron.
   */
  async crearPendientes(
    tx: GastoFijoCobroTxClient,
    inputs: CrearCobroPendienteInput[],
  ): Promise<number> {
    if (inputs.length === 0) return 0;
    const data = inputs.map((c) => ({
      plantillaId: c.plantillaId,
      origenId: c.origenId,
      periodo: c.periodo,
      concepto: c.concepto,
      monto: new Prisma.Decimal(c.monto), // STRING -> Decimal (money-safe)
      generadoEl: diaAColumna(c.generadoEl),
    }));
    const res = await tx.gastoFijoCobro.createMany({ data, skipDuplicates: true });
    return res.count;
  }

  /** Lee un cobro por id; `null` si no existe (R20). Con `tx` lee dentro de esa transaccion. */
  async obtenerPorId(
    id: string,
    tx?: GastoFijoCobroTxClient,
  ): Promise<GastoFijoCobroRegistro | null> {
    const cliente = tx ?? this.prisma;
    const row = await cliente.gastoFijoCobro.findUnique({ where: { id } });
    return row === null ? null : toRegistro(row);
  }

  /** R39/R41 — la cola de pendientes, del mas antiguo al mas reciente, recortada a `tope`. */
  async listarPendientes(tope: number): Promise<GastoFijoCobroDTO[]> {
    const rows = await this.prisma.gastoFijoCobro.findMany({
      where: { estado: "pendiente" },
      orderBy: ORDEN_COLA,
      take: tope,
    });
    return rows.map(toDTO);
  }

  /**
   * R29/R30/R41 — cuantos siguen `pendiente`. TODOS, no solo los de la corrida de hoy: el
   * recordatorio existe precisamente para los dias en que no se genera nada nuevo.
   */
  async contarPendientes(): Promise<number> {
    return this.prisma.gastoFijoCobro.count({ where: { estado: "pendiente" } });
  }

  /**
   * ⚠️ R17/R18 — LA TRANSICION. El `where` lleva `id` **y `estado: "pendiente"`**, y ese segundo
   * termino es lo que serializa a dos humanos: bajo `READ COMMITTED` la segunda transaccion
   * espera el bloqueo de fila, re-evalua el `WHERE` tras el commit de la primera, afecta CERO
   * filas y aborta sin escribir. Devuelve el `count`: 1 = la decision es tuya, 0 = ya_decidido.
   *
   * `updateMany` y no `update`, mismo criterio que `GastoFijoPlantillaRepository.eliminar`: el
   * `count` ES la respuesta, sin traducir un `P2025` de la ORM a un caso de negocio.
   *
   * Quitar `estado: "pendiente"` de este `where` es una de las tres mutaciones de dinero que la
   * ficha obliga a matar con un test.
   */
  async marcarDecidido(
    tx: GastoFijoCobroTxClient,
    id: string,
    estado: GastoFijoCobroEstadoDecidido,
    actorId: string,
    ahora: Date,
  ): Promise<number> {
    const res = await tx.gastoFijoCobro.updateMany({
      where: { id, estado: "pendiente" },
      data: { estado, decididoPor: actorId, decididoAt: ahora },
    });
    return res.count;
  }

  /**
   * R15/R19 — enlaza el cobro ya `aprobado` con el movimiento que lo salda. El CHECK
   * `gasto_fijo_cobro_movimiento_solo_aprobado` impide que un cobro que no sea `aprobado` apunte
   * al libro, asi que este `update` no puede ensuciar un rechazado ni por error.
   */
  async enlazarMovimiento(
    tx: GastoFijoCobroTxClient,
    id: string,
    movimientoId: string,
  ): Promise<void> {
    await tx.gastoFijoCobro.updateMany({ where: { id }, data: { movimientoId } });
  }

  /**
   * R45/R56 — cancela los que sigan `pendiente` de esa plantilla, dentro de `tx`, y devuelve
   * cuantos cancelo REALMENTE (el numero que el borrado reporta, R56).
   *
   * El `where` filtra por `estado: "pendiente"` a proposito: un cobro ya aprobado o rechazado NO
   * se toca, porque su decision es final y es evidencia (R23/R47).
   */
  async cancelarPendientesDePlantilla(
    tx: GastoFijoCobroTxClient,
    plantillaId: string,
    actorId: string,
    ahora: Date,
  ): Promise<number> {
    const res = await tx.gastoFijoCobro.updateMany({
      where: { plantillaId, estado: "pendiente" },
      data: { estado: "cancelado", decididoPor: actorId, decididoAt: ahora },
    });
    return res.count;
  }
}
