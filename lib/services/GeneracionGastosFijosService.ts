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
import { fechaCalendarioCR } from "@/lib/utils/fecha-cr";
import { aplicaHoy, periodoDe } from "@/lib/utils/periodicidad";

/**
 * Feature 45 — logica del cron de GASTOS FIJOS (patron LiberacionReprogramadaService/
 * CorteDiarioService). No conoce HTTP ni Prisma directo: recibe el repo de plantillas, el repo
 * del libro y un cliente de escritura por inyeccion; la fecha `now` se inyecta (testeable).
 *
 * Feature 84 — el cron ahora corre DIARIO (`0 6 * * *`) y es ESTE service el que decide que
 * plantillas disparan hoy: lee las ACTIVAS y las filtra con `aplicaHoy` (logica pura en
 * `lib/utils/periodicidad.ts`, dia calendario CR). Solo las que aplican entran al createMany.
 *
 * IDEMPOTENCIA — aca se puede DUPLICAR PLATA, leer antes de tocar:
 * la clave derivada `origen_id = "<plantillaId>:<periodo>"` cae bajo el indice unico parcial
 * (origen_tipo, origen_id, categoria), y el createMany con skipDuplicates es lo que hace al cron
 * idempotente (R28) sin doble conteo en el balance (R31).
 *   - `meses`  -> periodo `YYYY-MM`. El MISMO formato de antes de la 84: si se le cambiara, en el
 *     mes del deploy la clave vieja (`:2026-07`) y la nueva no colisionarian y se cobraria DOS
 *     VECES. Unica porque una mensual dispara como maximo una vez por mes.
 *   - `dias`/`semanas` -> periodo `YYYY-MM-DD` (fecha CR del disparo). Unica porque disparan como
 *     maximo una vez por dia.
 * El formato lo decide `periodoDe`; ver el comentario largo alli.
 */
export class GeneracionGastosFijosService implements IGeneracionGastosFijosService {
  constructor(
    private readonly plantillaRepo: IGastoFijoPlantillaRepository,
    private readonly movimientoRepo: IWalletMovimientoRepository,
    // Cliente de escritura (PrismaClient completo); el repo acepta cualquier WalletTxClient.
    private readonly writeClient: WalletTxClient,
  ) {}

  async ejecutarGeneracion(now: Date): Promise<GeneracionGastosFijosResult> {
    // Fecha CALENDARIO de CR de la corrida (solo para el resumen; la regla de disparo la evalua
    // `aplicaHoy` sobre `now`).
    const fecha = fechaCalendarioCR(now);

    // R27: solo las plantillas ACTIVAS generan egreso; las inactivas se excluyen en el repo.
    const plantillas = await this.plantillaRepo.listarActivas();

    // Feature 84: de las activas, solo las que disparan HOY segun su periodicidad. Una inactiva
    // nunca llega hasta aca (ni siquiera se evalua).
    const aplican = plantillas.filter((p) => aplicaHoy(p, now));

    // R27/R28: un egreso por plantilla que aplica, con la clave de idempotencia derivada
    // (`<plantillaId>:<periodo>`) que cae bajo el indice unico parcial existente. Autor NULL
    // (generacion automatica).
    const movs: CrearMovimientoInput[] = aplican.map((p) => {
      const periodo = periodoDe(p, now);
      return {
        tipo: "egreso",
        categoria: "egreso_gasto_fijo",
        monto: p.monto, // money-safe: STRING de punta a punta (nunca number)
        origenTipo: "gasto",
        origenId: `${p.id}:${periodo}`,
        descripcion: `${p.concepto} — ${periodo}`,
        registradoPor: null,
      };
    });

    // R31: un ÚNICO createMany (atomico) con skipDuplicates (ON CONFLICT DO NOTHING) -> R28
    // idempotente por (plantilla, periodo) sin TOCTOU. En una reejecucion del mismo dia inserta
    // 0 filas (el balance no cambia).
    const egresosGenerados = await this.movimientoRepo.crearMovimientos(this.writeClient, movs);

    // R29: resumen SIN PII (solo conteos + fecha).
    return {
      fecha,
      plantillasActivas: plantillas.length,
      plantillasQueAplicanHoy: movs.length,
      egresosGenerados,
    };
  }
}
