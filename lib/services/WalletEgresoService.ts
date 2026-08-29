import { randomUUID } from "node:crypto";
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
import { instanteDelMovimientoManual } from "@/lib/utils/fecha-movimiento-manual";
import { esAccesoTotal } from "@/lib/auth/acceso-total";

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
    // Ficha 334 (R28, design §5): el `id` lo genera EL SERVICIO y viaja en la insercion, para
    // poder releer despues EXACTAMENTE esta fila. Sigue siendo UN SOLO INSERT.
    const id = randomUUID();
    // Ficha 334 (R22/R23): con «hoy» la clave NO viaja y manda el DEFAULT de la columna.
    const fechaMovimiento = instanteDelMovimientoManual(input.fecha);
    await this.repo.crearMovimientos(this.writeClient, [
      {
        id,
        tipo: "egreso",
        categoria,
        monto: input.monto,
        origenTipo: "gasto",
        origenId: null,
        descripcion: input.descripcion,
        registradoPor: actor.usuarioId,
        ...(fechaMovimiento !== undefined ? { fechaMovimiento } : {}),
      },
    ]);

    // Ficha 334 (R28): se relee POR ID, no «el mas reciente de esta categoria». Aquella
    // relectura funcionaba por ACCIDENTE (todo se fechaba con `now()`); registrado un gasto
    // variable con fecha de la semana pasada devolveria OTRO gasto variable.
    const movimiento = await this.repo.obtenerPorId(id);
    if (movimiento === null) {
      // Imposible por construccion: el egreso manual lleva `origen_id NULL`, queda fuera del
      // indice unico parcial y nunca se deduplica. Se propaga con contexto antes que devolver
      // una fila ajena.
      throw new Error(`wallet: el egreso manual ${id} no se pudo releer tras insertarlo`);
    }
    return { status: "ok", movimiento };
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
