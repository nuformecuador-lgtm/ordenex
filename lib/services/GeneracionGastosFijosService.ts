import type {
  IWalletMovimientoRepository,
  CrearMovimientoInput,
} from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type { IGastoFijoPlantillaRepository } from "@/lib/interfaces/repositories/IGastoFijoPlantillaRepository";
import type {
  CrearCobroPendienteInput,
  IGastoFijoCobroRepository,
} from "@/lib/interfaces/repositories/IGastoFijoCobroRepository";
import type {
  GeneracionGastosFijosResult,
  GeneracionGastosFijosTx,
  GeneracionGastosFijosTxRunner,
  IGeneracionGastosFijosService,
} from "@/lib/interfaces/services/IGeneracionGastosFijosService";
import {
  notificadorNoOp,
  type GastoFijoCobroPendienteNotificador,
} from "@/lib/notificaciones/notificadores";
import { fechaCalendarioCR } from "@/lib/utils/fecha-cr";
import { aplicaHoy, periodoDe } from "@/lib/utils/periodicidad";

/**
 * Feature 45 — logica del cron de GASTOS FIJOS (patron LiberacionReprogramadaService/
 * CorteDiarioService). No conoce HTTP ni Prisma directo: recibe el repo de plantillas, el repo
 * del libro, el repo de cobros y un ejecutor de transacciones por inyeccion; la fecha `now` se
 * inyecta (testeable).
 *
 * Feature 84 — el cron ahora corre DIARIO (`0 6 * * *`) y es ESTE service el que decide que
 * plantillas disparan hoy: lee las ACTIVAS y las filtra con `aplicaHoy` (logica pura en
 * `lib/utils/periodicidad.ts`, dia calendario CR). Solo las que aplican entran a la corrida.
 *
 * FICHA 333 — LA CORRIDA SE PARTE EN DOS SEGUN EL INTERRUPTOR DE CADA PLANTILLA:
 *   - `requiereAprobacion === false` («cobra sola») -> egreso DIRECTO al libro, EXACTAMENTE como
 *     antes de esta ficha: mismo tipo, misma categoria, mismo `origen_tipo`, misma clave y el
 *     mismo autor `registrado_por = NULL` (R5). Este camino no cambia ni un byte.
 *   - `requiereAprobacion === true` -> un COBRO `pendiente`, y NADA en el libro (R6). El libro se
 *     toca cuando el maestro aprueba (`GastoFijoCobroService.aprobar`), con la MISMA clave.
 * Las dos escrituras van en UNA transaccion (R10) y el aviso de la campana sale FUERA de ella.
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
 *
 * ⚠️ FICHA 333 — LA MISMA CLAVE VIVE AHORA EN DOS TABLAS Y PROTEGE EN DOS MOMENTOS. Se resuelve
 * UNA sola vez, aqui abajo (R8), y se congela: va a `gasto_fijo_cobro.origen_id` bajo
 * `gasto_fijo_cobro_origen_uq` —que es lo que impide un segundo pendiente del mismo periodo, y lo
 * que hace que un RECHAZO dure lo que dura su periodo (R22)— y de ahi, tal cual, a
 * `wallet_movimiento.origen_id` cuando alguien apruebe, donde vuelve a caer bajo
 * `wallet_movimiento_origen_categoria_uq`. Tocar su FORMATO aqui rompe las DOS a la vez.
 */
export class GeneracionGastosFijosService implements IGeneracionGastosFijosService {
  constructor(
    private readonly plantillaRepo: IGastoFijoPlantillaRepository,
    private readonly movimientoRepo: IWalletMovimientoRepository,
    // Ficha 333 (D3): el repo de COBROS, para las plantillas que requieren aprobacion (R6).
    private readonly cobroRepo: IGastoFijoCobroRepository,
    // Ficha 333 (R10): las dos escrituras de la corrida, en UNA transaccion. Inyectado.
    private readonly runTx: GeneracionGastosFijosTxRunner,
    /**
     * ⚠️ FICHA 333 (E2/E3, R33/R34) — notificador de «quedan N cobros por aprobar», INYECTABLE y
     * con DEFAULT NO-OP.
     *
     * El default es el no-op para que ninguna suite escriba avisos en la base —que en este repo
     * es COMPARTIDA— y el real se cablea en el COMPOSITION ROOT
     * (`app/api/cron/generar-gastos-fijos/route.ts`). No al reves. El precedente de por que esto
     * importa esta medido: en `corte-diario` la llamada pasaba cinco argumentos, el notificador
     * se quedo con su default y el aviso NO SE EMITIO NUNCA, con la suite entera en verde.
     * Lo vigila `tests/unit/services/notificacion-notificadores-reales.test.ts` (R34).
     */
    private readonly notificarCobrosPendientes: GastoFijoCobroPendienteNotificador = notificadorNoOp,
  ) {}

  async ejecutarGeneracion(now: Date): Promise<GeneracionGastosFijosResult> {
    // Fecha CALENDARIO de CR de la corrida. Es el resumen, el `generado_el` de los cobros y —lo
    // importante— LA ENTIDAD del aviso de la campana (design §4.2).
    const fecha = fechaCalendarioCR(now);

    // R12/R27: solo las plantillas ACTIVAS generan algo; las inactivas se excluyen en el repo y
    // no generan NI egreso NI cobro, sea cual sea su interruptor.
    const plantillas = await this.plantillaRepo.listarActivas();

    // Feature 84: de las activas, solo las que disparan HOY segun su periodicidad. Una inactiva
    // nunca llega hasta aca (ni siquiera se evalua).
    const aplican = plantillas.filter((p) => aplicaHoy(p, now));

    // R5/R6/R7/R8/R11: LA PARTICION. La clave y el periodo se derivan UNA vez por plantilla, con
    // `periodoDe`, y el interruptor decide a cual de las dos colecciones va la fila.
    const movs: CrearMovimientoInput[] = [];
    const cobros: CrearCobroPendienteInput[] = [];
    for (const p of aplican) {
      const periodo = periodoDe(p, now);
      const origenId = `${p.id}:${periodo}`; // LA CLAVE, resuelta una sola vez (R8)
      if (p.requiereAprobacion) {
        // R6/R7: nace un cobro PENDIENTE con la COPIA del concepto y del monto que la plantilla
        // tiene AHORA. Lo que el maestro apruebe sera esto, no lo que la plantilla diga entonces
        // (R16). El libro NO se toca por esta plantilla.
        cobros.push({
          plantillaId: p.id,
          origenId,
          periodo,
          concepto: p.concepto,
          monto: p.monto, // money-safe: STRING de punta a punta (nunca number)
          generadoEl: fecha,
        });
      } else {
        // R5: el camino de siempre, intacto. Autor NULL (generacion automatica).
        movs.push({
          tipo: "egreso",
          categoria: "egreso_gasto_fijo",
          monto: p.monto, // money-safe: STRING de punta a punta (nunca number)
          origenTipo: "gasto",
          origenId,
          descripcion: `${p.concepto} — ${periodo}`,
          registradoPor: null,
        });
      }
    }

    // R10: UNA transaccion para las DOS escrituras. Los dos repositorios usan `createMany` con
    // `skipDuplicates` (ON CONFLICT DO NOTHING) contra su propio indice unico, asi que una
    // reejecucion del mismo dia inserta 0 y 0 sin TOCTOU (R9).
    const { egresosGenerados, cobrosPendientesCreados } = await this.runTx(
      async (tx: GeneracionGastosFijosTx) => {
        const egresos = await this.movimientoRepo.crearMovimientos(tx, movs);
        const pendientes = await this.cobroRepo.crearPendientes(tx, cobros);
        return { egresosGenerados: egresos, cobrosPendientesCreados: pendientes };
      },
    );

    // R30: se cuentan TODOS los pendientes, no los de esta corrida. El recordatorio existe
    // precisamente para los dias en que no se genero nada nuevo y sigue habiendo cola.
    const cobrosPendientesTotales = await this.cobroRepo.contarPendientes();

    // R29/R32/R33: el aviso sale FUERA de la transaccion y solo si queda al menos uno. El
    // notificador absorbe su propio fallo (`emitirBestEffort`), asi que la corrida termina en
    // exito aunque la campana este caida: LA CORRIDA MANDA, EL AVISO ES CORTESIA.
    if (cobrosPendientesTotales > 0) {
      await this.notificarCobrosPendientes({
        pendientes: cobrosPendientesTotales,
        diaCR: fecha, // LA ENTIDAD del aviso es el DIA, no el cobro (design §4.2)
      });
    }

    // R13/R29: resumen SIN PII (solo conteos + fecha CR).
    return {
      fecha,
      plantillasActivas: plantillas.length,
      plantillasQueAplicanHoy: aplican.length,
      egresosGenerados,
      cobrosPendientesCreados,
      cobrosPendientesTotales,
    };
  }
}
