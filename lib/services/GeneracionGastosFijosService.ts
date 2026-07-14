import type {
  IWalletMovimientoRepository,
  CrearMovimientoInput,
  WalletTxClient,
} from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type { IGastoFijoPlantillaRepository } from "@/lib/interfaces/repositories/IGastoFijoPlantillaRepository";
import type {
  GeneracionGastosFijosResult,
  IGeneracionGastosFijosService,
} from "@/lib/interfaces/services/IGeneracionGastosFijosService";
import { periodoMensualCR } from "@/lib/utils/fecha-cr";

/**
 * Feature 45 — logica del cron mensual de GASTOS FIJOS (patron LiberacionReprogramadaService/
 * CorteDiarioService). No conoce HTTP ni Prisma directo: recibe el repo de plantillas, el repo
 * del libro y un cliente de escritura por inyeccion; la fecha `now` se inyecta (testeable).
 * Por cada plantilla ACTIVA emite UN egreso `egreso_gasto_fijo` en la caja principal para el
 * periodo YYYY-MM (hora CR). Idempotente por (plantilla, periodo): la clave derivada
 * `origen_id = "<plantillaId>:<YYYY-MM>"` cae bajo el indice unico parcial existente
 * (origen_tipo, origen_id, categoria) -> un unico createMany con skipDuplicates hace no-op en
 * la reejecucion (R28), sin doble conteo en el balance (R31). Atomico (un solo INSERT masivo).
 */
export class GeneracionGastosFijosService implements IGeneracionGastosFijosService {
  constructor(
    private readonly plantillaRepo: IGastoFijoPlantillaRepository,
    private readonly movimientoRepo: IWalletMovimientoRepository,
    // Cliente de escritura (PrismaClient completo); el repo acepta cualquier WalletTxClient.
    private readonly writeClient: WalletTxClient,
  ) {}

  async ejecutarGeneracion(now: Date): Promise<GeneracionGastosFijosResult> {
    // R30: periodo YYYY-MM en hora CR (UTC-6).
    const periodo = periodoMensualCR(now);

    // R27: solo las plantillas ACTIVAS generan egreso; las inactivas se excluyen en el repo.
    const plantillas = await this.plantillaRepo.listarActivas();

    // R27/R28: un egreso por plantilla, con la clave de idempotencia derivada
    // (`<plantillaId>:<YYYY-MM>`) que cae bajo el indice unico parcial existente. Autor
    // NULL (generacion automatica).
    const movs: CrearMovimientoInput[] = plantillas.map((p) => ({
      tipo: "egreso",
      categoria: "egreso_gasto_fijo",
      monto: p.monto,
      origenTipo: "gasto",
      origenId: `${p.id}:${periodo}`,
      descripcion: `${p.concepto} — ${periodo}`,
      registradoPor: null,
    }));

    // R31: un ÚNICO createMany (atomico) con skipDuplicates (ON CONFLICT DO NOTHING) -> R28
    // idempotente por (plantilla, periodo) sin TOCTOU. En una reejecucion del mismo periodo
    // inserta 0 filas (el balance no cambia).
    const egresosGenerados = await this.movimientoRepo.crearMovimientos(this.writeClient, movs);

    // R29: resumen SIN PII (solo conteos + periodo).
    return { periodo, plantillasActivas: movs.length, egresosGenerados };
  }
}
