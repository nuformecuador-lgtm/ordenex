import { Prisma } from "@prisma/client";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  IWalletMovimientoRepository,
  WalletTxClient,
} from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type {
  IWalletEgresoService,
  RegistrarEgresoServiceResult,
  ReversarEgresoServiceResult,
  VerDesgloseEgresosServiceResult,
} from "@/lib/interfaces/services/IWalletEgresoService";
import {
  TIPO_EGRESO_MANUAL_A_CATEGORIA,
  type ListarMovimientosInput,
  type RegistrarEgresoAdministrativoInput,
  type ReversarEgresoInput,
} from "@/lib/types/wallet";
import { esAccesoTotal } from "@/lib/auth/acceso-total";
import { invalidarAnaliticaFinanciera } from "@/lib/analytics/invalidacion-financiera";
import { cacheNula } from "@/lib/cache/cache-nula";
import type { IAnaliticaCache } from "@/lib/interfaces/external/IAnaliticaCache";

// Roles autorizados (R17): acceso total (maestro/admin, dueños de la caja central), espejo de
// WalletService.

/**
 * Feature 45 — logica de negocio de los EGRESOS administrativos de la caja principal (gasto
 * variable / sueldo manual + reversa + desglose). No conoce HTTP ni Prisma directamente:
 * recibe el repo del libro por inyeccion (mismo patron que WalletService). Guardia de rol
 * maestro (R17). INMUTABILIDAD (R6): NO expone update/delete; la correccion es un movimiento
 * compensatorio append-only (reversarEgreso). Money-safe: DTOs con montos STRING.
 */
export class WalletEgresoService implements IWalletEgresoService {
  constructor(
    private readonly repo: IWalletMovimientoRepository,
    // Cliente de escritura para el egreso/reverso (fuera de una tx de cierre): el repo
    // acepta cualquier WalletTxClient; aqui inyectamos el PrismaClient completo.
    private readonly writeClient: WalletTxClient,
    /**
     * Feature 179 (T3.1, R9) — el puerto de la cache de analitica. **Un egreso administrativo
     * mueve `egresos`, `dinero_en_caja` y `ganancia_ordenex`**: sin invalidar, el tablero
     * financiero sirve la cifra anterior hasta que expire el TTL (una hora) y nada falla.
     *
     * Default `cacheNula()` —patron de `analitica-rollup-diario-handler.ts:25`— para no romper
     * las suites y los composition roots que no invalidan. Que el default no degrade en
     * silencio en produccion NO lo cubre el tipo: lo cubre el test de cableado del composition
     * root en `cache-financiera-escritor-egreso.test.ts`.
     */
    private readonly cache: IAnaliticaCache = cacheNula(),
  ) {}

  async registrarEgreso(
    input: RegistrarEgresoAdministrativoInput,
    actor: Actor,
  ): Promise<RegistrarEgresoServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R17

    // R2: mapeo tipo de egreso manual -> categoria del libro (gasto_variable /
    // egreso_gasto_variable, sueldo / egreso_sueldo). El gasto FIJO no llega aqui (rechazado
    // en el borde por zod, R19). R1/R3/R7: fila inmutable, origen_tipo=gasto, origen_id=NULL
    // (fuera del indice unico parcial: cada egreso manual es una fila propia),
    // registrado_por=<maestro>. Un unico INSERT atomico via crearMovimientos.
    const categoria = TIPO_EGRESO_MANUAL_A_CATEGORIA[input.tipoEgreso];
    await this.repo.crearMovimientos(this.writeClient, [
      {
        tipo: "egreso",
        categoria,
        monto: input.monto,
        origenTipo: "gasto",
        origenId: null,
        descripcion: input.descripcion,
        registradoPor: actor.usuarioId,
      },
    ]);

    // R9/R8 — el INSERT ya confirmo (`crearMovimientos` es su propia transaccion implicita
    // sobre el cliente de escritura), asi que la invalidacion va AQUI y no antes: invalidar
    // dentro de la escritura abriria una ventana en la que una lectura concurrente repuebla la
    // cache con el estado ANTERIOR, y esa entrada vive el TTL entero.
    await invalidarAnaliticaFinanciera(this.cache, "ledger_egreso_admin");

    // Relee el egreso recien creado (el manual no se deduplica, siempre se inserta). Se
    // relee el mas reciente de esa categoria para exponer id/fecha reales (patron
    // WalletService.registrarMovimientoManual).
    const { movimientos } = await this.repo.listar({
      page: 1,
      pageSize: 1,
      tipo: "egreso",
      categoria,
    });
    return { status: "ok", movimiento: movimientos[0] };
  }

  async reversarEgreso(
    input: ReversarEgresoInput,
    actor: Actor,
  ): Promise<ReversarEgresoServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R17

    // R13: el monto se lee SERVER-SIDE (no lo provee el cliente). Solo se reversa un egreso
    // administrativo (tipo=egreso AND origen_tipo=gasto). Cubre tambien los egresos generados
    // por el cron (mismo tipo/origen, R32).
    const original = await this.repo.obtenerPorId(input.movimientoId);
    if (original === null || original.tipo !== "egreso" || original.origenTipo !== "gasto") {
      return { status: "not_found" };
    }

    // R13/R16: reverso = ingreso_ajuste de igual monto, origen_tipo=gasto, origen_id=<egreso
    // original> -> net cero en el balance. R14: append-only (el original no se toca). R15:
    // idempotencia por el indice unico parcial (gasto, <egresoId>, ingreso_ajuste): un
    // segundo intento es no-op via skipDuplicates -> count===0 -> already_reversed.
    const count = await this.repo.crearMovimientos(this.writeClient, [
      {
        tipo: "ingreso",
        categoria: "ingreso_ajuste",
        monto: original.monto,
        origenTipo: "gasto",
        origenId: original.id,
        descripcion: `Reverso de: ${original.descripcion ?? original.id}`,
        registradoPor: actor.usuarioId,
      },
    ]);
    if (count === 0) return { status: "already_reversed" }; // R15

    // R9 — **el reverso mueve dinero igual que el egreso** y por eso tiene su propia
    // invalidacion, no la del alta. Va DESPUES del `count === 0`: un segundo intento no
    // escribio nada, y vaciar la cache financiera por una operacion que fue no-op es coste sin
    // motivo (mismo criterio que R12 con la corrida de cero egresos).
    await invalidarAnaliticaFinanciera(this.cache, "ledger_egreso_admin");
    return { status: "ok" };
  }

  async verDesgloseEgresos(
    input: ListarMovimientosInput,
    actor: Actor,
  ): Promise<VerDesgloseEgresosServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R17

    // R11: desglose por tipo del conjunto filtrado (mismos filtros de fecha que el libro),
    // derivado por agregacion. Money-safe: todo STRING (nunca number).
    const { gastoFijo, gastoVariable, sueldo, indemnizacion } =
      await this.repo.agregarPorCategoria({
        tipo: input.tipo,
        categoria: input.categoria,
        desde: input.desde,
        hasta: input.hasta,
      });
    // Feature 158/R32: la indemnizacion entra en el total. Suma con Prisma.Decimal (nunca
    // number/parseFloat) y sale como STRING escala 2, igual que los otros tres conceptos.
    const total = new Prisma.Decimal(gastoFijo)
      .add(new Prisma.Decimal(gastoVariable))
      .add(new Prisma.Decimal(sueldo))
      .add(new Prisma.Decimal(indemnizacion))
      .toFixed(2);
    return {
      status: "ok",
      desglose: { gastoFijo, gastoVariable, sueldo, indemnizacion, total },
    };
  }
}
