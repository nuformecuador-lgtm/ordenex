import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  DesgloseEgresosDTO,
  ListarMovimientosInput,
  RegistrarEgresoAdministrativoInput,
  ReversarEgresoInput,
  WalletMovimientoDTO,
} from "@/lib/types/wallet";

// Feature 45 (design §2.2a) — contrato del servicio de EGRESOS administrativos de la caja
// principal (gasto variable / sueldo manual + reversa + desglose). Rol autorizado: maestro
// (R17). Resultados de dominio (sin acoplar a HTTP); el borde (Server Action) los traduce.
// Money-safe: los DTOs exponen montos como STRING. El gasto FIJO NO se registra por aqui:
// lo emite el cron (GeneracionGastosFijosService).

export type RegistrarEgresoServiceResult =
  | { status: "ok"; movimiento: WalletMovimientoDTO }
  | { status: "forbidden" };

export type ReversarEgresoServiceResult =
  | { status: "ok" } // reverso creado (R13/R16)
  | { status: "forbidden" }
  | { status: "not_found" } // el egreso no existe o no es administrativo
  | { status: "already_reversed" }; // R15: ya tenia su reverso (idempotente, no-op)

export type VerDesgloseEgresosServiceResult =
  | { status: "ok"; desglose: DesgloseEgresosDTO }
  | { status: "forbidden" };

export interface IWalletEgresoService {
  /**
   * R1/R2/R3/R7/R17: solo maestro; registra un egreso administrativo MANUAL (gasto variable
   * o sueldo) como fila `tipo=egreso`, `origen_tipo=gasto`, `origen_id=NULL`,
   * `registrado_por=<maestro>`. Categoria mapeada del tipo (R2). Forbidden sin efectos.
   */
  registrarEgreso(
    input: RegistrarEgresoAdministrativoInput,
    actor: Actor,
  ): Promise<RegistrarEgresoServiceResult>;
  /**
   * R13/R15/R16/R17/R32: solo maestro; reversa un egreso administrativo (manual O generado
   * por el cron) con un `ingreso_ajuste` de igual monto (leido server-side) referenciando el
   * original. Idempotente (a lo sumo un reverso por egreso). not_found si el id no es un
   * egreso administrativo.
   */
  reversarEgreso(input: ReversarEgresoInput, actor: Actor): Promise<ReversarEgresoServiceResult>;
  /** R11/R17: solo maestro; desglose de egresos administrativos por tipo del conjunto filtrado. */
  verDesgloseEgresos(
    input: ListarMovimientosInput,
    actor: Actor,
  ): Promise<VerDesgloseEgresosServiceResult>;
}
