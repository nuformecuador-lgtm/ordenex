import { esNoComparable } from "@/lib/analytics/backfill-rango";
import { FALLOS_CONSECUTIVOS_QUE_ABORTAN } from "@/lib/config/analitica-rollup";
import {
  AnaliticaRollupError,
  type IAnaliticaRollupService,
} from "@/lib/interfaces/services/IAnaliticaRollupService";
import type {
  ClasificacionFecha,
  IAnaliticaBackfillService,
  OpcionesBackfill,
  ResumenBackfill,
  SalidaProgreso,
} from "@/lib/interfaces/services/IAnaliticaBackfillService";

// Feature 125 (design §2, T2.3) — EL ITERADOR DE FECHAS.
//
// Todo lo que este servicio sabe hacer es: recorrer un plan ya validado, pedirle CADA fecha al
// agregador de la 124, etiquetar lo que devuelve, contarlo y emitirlo por el puerto de progreso.
// No hay ni una consulta, ni un `console`, ni un `process`, ni Prisma: la corrida completa se
// ejecuta en test con un agregador falso, un reloj falso y una salida falsa (R3).
//
// Lo que este archivo DELIBERADAMENTE no hace:
//   - no reintenta una fecha fallida (design §5: `ReconciliacionError` y
//     `PrimerIntentoIncoherenteError` no son transitorios, y un reintento que acierte a la
//     segunda OCULTA una carrera con la escritura de dominio que merece verse);
//   - no lanza fechas en paralelo (D9 de la 124: una transaccion por fecha, y el timeout de esa
//     transaccion esta dimensionado para UNA);
//   - no guarda el detalle de mas de una fecha (R15): las lineas salen por el puerto segun se
//     producen y aqui solo quedan contadores.

/** Dependencias inyectadas: reloj, pausa y salida. Ninguna toca el mundo por su cuenta. */
export interface DependenciasBackfill {
  /** Reloj INYECTADO (R8 de la 124, misma regla aqui): sin default `new Date()`. */
  readonly now: () => Date;
  /** Pausa entre fechas. Se inyecta para que R16 se mida sin esperar de verdad. */
  readonly dormir: (ms: number) => Promise<void>;
  readonly progreso: SalidaProgreso;
}

/** Nombre y etapa del error, que es lo unico que se puede imprimir por defecto (R30). */
function contextoDelError(error: unknown): { nombreError: string; etapa?: AnaliticaRollupError["etapa"] } {
  if (error instanceof AnaliticaRollupError) {
    return { nombreError: error.name, etapa: error.etapa };
  }
  if (error instanceof Error) return { nombreError: error.name };
  return { nombreError: typeof error };
}

export class AnaliticaBackfillService implements IAnaliticaBackfillService {
  constructor(
    private readonly rollup: IAnaliticaRollupService,
    private readonly deps: DependenciasBackfill,
  ) {}

  /**
   * Recorre el plan en orden ascendente, UNA fecha a la vez. Devuelve el resumen; no lanza y no
   * sale del proceso: quien decide que hacer con el codigo de salida es el script.
   */
  async ejecutar(opciones: OpcionesBackfill): Promise<ResumenBackfill> {
    const { plan, modo } = opciones;
    const pausaMs = opciones.pausaMs ?? 0;
    const inicio = this.deps.now().getTime();

    let procesadas = 0;
    let fallidas = 0;
    let noComparables = 0;
    let estables = 0;
    let cambiadas = 0;
    let filasEscritas = 0;
    let filasRetiradas = 0;
    let fallosSeguidos = 0;
    let abortada = false;
    let indice = 0;
    const fechasFallidas: string[] = [];

    for (; indice < plan.fechas.length; indice++) {
      const fecha = plan.fechas[indice];
      const t0 = this.deps.now().getTime();

      let resumenFecha;
      try {
        // R4/R21 — la UNICA forma de obtener filas: el agregador de la 124, invocado igual para
        // toda fecha, comparable o no.
        resumenFecha = await this.rollup.agregarFecha(fecha);
      } catch (error) {
        fallidas++;
        fallosSeguidos++;
        fechasFallidas.push(fecha);
        // R31 — el fallo se registra CON su fecha y su modo, nunca en silencio.
        this.deps.progreso.falla({ fecha, modo, ...contextoDelError(error), error });
        this.deps.progreso.linea({
          fecha,
          filasEscritas: 0,
          filasRetiradas: 0,
          ms: this.deps.now().getTime() - t0,
          clasificacion: "fallida",
        });
        if (fallosSeguidos >= FALLOS_CONSECUTIVOS_QUE_ABORTAN) {
          abortada = true;
          indice++;
          break;
        }
        if (pausaMs > 0 && indice < plan.fechas.length - 1) await this.deps.dormir(pausaMs);
        continue;
      }

      fallosSeguidos = 0;
      procesadas++;
      filasEscritas += resumenFecha.filasEscritas;
      filasRetiradas += resumenFecha.filasRetiradas;

      const clasificacion = this.clasificar(fecha, resumenFecha.filasEscritas, resumenFecha.filasRetiradas, opciones);
      if (clasificacion === "no_comparable") noComparables++;
      if (clasificacion === "estable") estables++;
      if (clasificacion === "cambiada") cambiadas++;

      // R17/R21 — el `ResumenCorrida` de la 124 se reporta TAL CUAL; lo unico que anade la 125
      // es la etiqueta.
      this.deps.progreso.linea({
        fecha: resumenFecha.fecha,
        filasEscritas: resumenFecha.filasEscritas,
        filasRetiradas: resumenFecha.filasRetiradas,
        ms: resumenFecha.ms,
        clasificacion,
      });

      if (pausaMs > 0 && indice < plan.fechas.length - 1) await this.deps.dormir(pausaMs);
    }

    const sinProcesar = plan.fechas.length - indice;
    if (abortada) {
      this.deps.progreso.aviso(
        `ABORTA: ${FALLOS_CONSECUTIVOS_QUE_ABORTAN} fallos consecutivos. Quedaron ${sinProcesar} ` +
          `fechas sin procesar del rango ${plan.desde}..${plan.hasta}. Tres fallos seguidos no son ` +
          `un dia raro: revisa la base y la DATABASE_URL antes de volver a correr.`,
      );
    }

    return {
      desde: plan.desde,
      hasta: plan.hasta,
      modo,
      fechasDelRango: plan.fechas.length,
      procesadas,
      fallidas,
      noComparables,
      estables,
      cambiadas,
      filasEscritas,
      filasRetiradas,
      ms: this.deps.now().getTime() - inicio,
      fechasFallidas,
      sinProcesar,
      abortadaPorFallosConsecutivos: abortada,
      // design §7 — `2` si la corrida termino con fechas fallidas o cambiadas.
      codigoSalida: fallidas > 0 || cambiadas > 0 ? 2 : 0,
    };
  }

  /**
   * R20/R22/R25 — la etiqueta de una fecha que el agregador proceso con exito.
   *
   * El horizonte se mira PRIMERO: bajo el, el cero no significa «ese dia no hubo actividad» sino
   * «el historial no llega hasta ahi» (L1), y las dos cosas tienen que poder distinguirse en la
   * salida. En verificacion, `estable` exige las DOS condiciones: nada retirado y el mismo numero
   * de filas que el reporte previo. Una fecha que el reporte previo no cubre no puede ser
   * `estable` —seria un falso verde— y se marca `cambiada`; el script ademas rechaza antes ese
   * reporte incompleto (R24).
   */
  private clasificar(
    fecha: string,
    filasEscritas: number,
    filasRetiradas: number,
    opciones: OpcionesBackfill,
  ): ClasificacionFecha {
    if (esNoComparable(fecha)) return "no_comparable";
    if (opciones.modo === "escritura") return "procesada";
    const previo = opciones.previo?.get(fecha);
    if (previo === undefined) return "cambiada";
    return filasRetiradas === 0 && previo.filasEscritas === filasEscritas ? "estable" : "cambiada";
  }
}
