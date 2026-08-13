import type { GestionCausaDevolucion } from "@prisma/client";
import type {
  EntregaVigente,
  FilaRollup,
  IAnaliticaRollupRepository,
  MedidasReconciliables,
} from "@/lib/interfaces/repositories/IAnaliticaRollupRepository";
import { MEDIDAS_RECONCILIABLES } from "@/lib/interfaces/repositories/IAnaliticaRollupRepository";
import type {
  EtapaCorrida,
  IAnaliticaRollupService,
  ResumenCorrida,
} from "@/lib/interfaces/services/IAnaliticaRollupService";
import {
  AnaliticaRollupError,
  PrimerIntentoIncoherenteError,
  ReconciliacionError,
} from "@/lib/interfaces/services/IAnaliticaRollupService";
import type { IOrdenHistorialService } from "@/lib/interfaces/services/IOrdenHistorialService";
import { ventanaDelDia, type VentanaDia } from "@/lib/analytics/rollup-dia";
import { UMBRAL_AVISO_FILAS_CORRIDA } from "@/lib/config/analitica-rollup";

// Feature 124 (design §2/§4/§7) — composicion del rollup diario. Este servicio NO habla
// Prisma y NO conoce Next.js: recibe el repositorio por constructor y funde en memoria los
// cubos que devuelven las seis consultas. El bug caro de esta feature no es una consulta
// lenta, es un cubo mal fundido o una coordenada tomada del sitio equivocado, y eso se
// testea con tablas en memoria (design §2).

/**
 * Puerto MINIMO hacia el punto unico de "intentos" del repo (feature 160). Se toma con
 * `Pick` del contrato existente a proposito: aqui NO se reimplementa el criterio (R17,
 * alternativa 11 descartada en design §11).
 */
export type ContadorIntentos = Pick<IOrdenHistorialService, "contarIntentosEnLote">;

/** Log de aviso inyectable (patron `LiberacionLogger`). NUNCA registra PII (R37). */
export interface RollupLogger {
  warn(mensaje: string): void;
}

const defaultLogger: RollupLogger = { warn: (m) => console.warn(m) };

export interface AnaliticaRollupDeps {
  /** R8: reloj INYECTADO, sin default. Solo mide la duracion; no deriva ninguna fecha. */
  readonly now: () => Date;
  readonly logger?: RollupLogger;
}

/** Separador de la clave del cubo: no puede aparecer en un uuid ni en un value de enum. */
const SEP = "\u001f";
/** Marca del NULL en la clave: distingue "sin asignar" / "sin causa" de la cadena vacia. */
const NULO = "\u0000";

interface ClaveCubo {
  readonly zonaId: string;
  readonly tiendaId: string;
  readonly mensajeroId: string | null;
  readonly estatusId: string;
  readonly causaDevolucion: GestionCausaDevolucion | null;
}

function clave(c: ClaveCubo): string {
  return [
    c.zonaId,
    c.tiendaId,
    c.mensajeroId ?? NULO,
    c.estatusId,
    c.causaDevolucion ?? NULO,
  ].join(SEP);
}

type CuboMutable = {
  -readonly [K in keyof FilaRollup]: FilaRollup[K];
};

function cuboVacio(c: ClaveCubo): CuboMutable {
  return {
    zonaId: c.zonaId,
    tiendaId: c.tiendaId,
    mensajeroId: c.mensajeroId,
    estatusId: c.estatusId,
    causaDevolucion: c.causaDevolucion,
    ordenesCreadas: 0,
    ordenesEstadoStock: 0,
    entregas: 0,
    devoluciones: 0,
    rechazos: 0,
    reprogramaciones: 0,
    incidentes: 0,
    primerIntentoOk: 0,
    // `BigInt(0)` y no `0n`: el `target` del repo es ES2017 y los literales BigInt no
    // compilan por debajo de ES2020.
    segCicloAcum: BigInt(0),
    segCicloN: 0,
  };
}

function tieneAlgunaMedida(f: FilaRollup): boolean {
  return (
    f.ordenesCreadas > 0 ||
    f.ordenesEstadoStock > 0 ||
    f.entregas > 0 ||
    f.devoluciones > 0 ||
    f.rechazos > 0 ||
    f.reprogramaciones > 0 ||
    f.incidentes > 0 ||
    f.primerIntentoOk > 0 ||
    f.segCicloN > 0 ||
    f.segCicloAcum > BigInt(0)
  );
}

// NO existe aqui ninguna suma de las medidas escritas: la de R34 la hace el repositorio
// DENTRO de la transaccion (`sumarMedidasEscritasDeFecha`), leyendo la tabla, que es lo unico
// que convierte la reconciliacion en una comprobacion de lo PERSISTIDO y no de lo calculado.
// Una suma en memoria aqui compararia el resultado del merge consigo mismo.

export class AnaliticaRollupService implements IAnaliticaRollupService {
  private readonly logger: RollupLogger;

  constructor(
    private readonly repo: IAnaliticaRollupRepository,
    private readonly historial: ContadorIntentos,
    private readonly deps: AnaliticaRollupDeps,
  ) {
    this.logger = deps.logger ?? defaultLogger;
  }

  async agregarFecha(fecha: string): Promise<ResumenCorrida> {
    const inicio = this.deps.now().getTime();
    const ventana = ventanaDelDia(fecha);

    const filas = await this.componerFilas(fecha, ventana);
    const totales = await this.enEtapa(fecha, "totales_de_control", () =>
      this.repo.totalesDeControl(ventana),
    );

    // R34/D5: la comparacion la hace el servicio, pero se EJECUTA dentro de la transaccion,
    // con las sumas reales de lo escrito. Lanzar aqui aborta la transaccion.
    const verificarReconciliacion = (sumasEscritas: MedidasReconciliables): void => {
      for (const medida of MEDIDAS_RECONCILIABLES) {
        if (sumasEscritas[medida] !== totales[medida]) {
          throw new ReconciliacionError(fecha, medida, sumasEscritas[medida], totales[medida]);
        }
      }
    };

    const resultado = await this.enEtapa(fecha, "escritura", () =>
      this.repo.escribirFecha({ fecha, filas, verificarReconciliacion }),
    );

    const resumen: ResumenCorrida = {
      fecha,
      filasEscritas: resultado.filasEscritas,
      filasRetiradas: resultado.filasRetiradas,
      ms: this.deps.now().getTime() - inicio,
    };
    this.avisarVolumen(resumen);
    return resumen;
  }

  /** Funde las seis fuentes en cubos por las seis coordenadas del grano (T3.1). */
  private async componerFilas(fecha: string, ventana: VentanaDia): Promise<FilaRollup[]> {
    const cubos = new Map<string, CuboMutable>();
    const obtener = (c: ClaveCubo): CuboMutable => {
      const k = clave(c);
      const existente = cubos.get(k);
      if (existente !== undefined) return existente;
      const nuevo = cuboVacio(c);
      cubos.set(k, nuevo);
      return nuevo;
    };

    // Q1 — `ordenes_creadas`. Coordenadas de la ORDEN; sin causa de devolucion (R15).
    for (const g of await this.enEtapa(fecha, "ordenes_creadas", () =>
      this.repo.contarOrdenesCreadas(ventana),
    )) {
      obtener({ ...g, causaDevolucion: null }).ordenesCreadas += g.ordenesCreadas;
    }

    // Q2 — `ordenes_estado_stock` (universo B2, D2).
    for (const g of await this.enEtapa(fecha, "ordenes_estado_stock", () =>
      this.repo.contarOrdenesEnEstadoAlCorte(ventana),
    )) {
      obtener({ ...g, causaDevolucion: null }).ordenesEstadoStock += g.ordenesEstadoStock;
    }

    // Q3 — las cinco de gestion. `causa_devolucion` viene informada SOLO donde hay
    // devoluciones (R15), asi que un mensajero que entrega y devuelve el mismo dia produce
    // DOS filas: la de la causa y la de causa nula (design §4.4).
    for (const g of await this.enEtapa(fecha, "gestiones", () =>
      this.repo.contarGestionesVigentes(ventana),
    )) {
      const cubo = obtener(g);
      cubo.entregas += g.entregas;
      cubo.devoluciones += g.devoluciones;
      cubo.rechazos += g.rechazos;
      cubo.reprogramaciones += g.reprogramaciones;
      cubo.incidentes += g.incidentes;
    }

    // Q4 — `primer_intento_ok`, con las MISMAS coordenadas que su entrega (R17).
    for (const e of await this.contarPrimerIntento(fecha, ventana)) {
      obtener({ ...e, causaDevolucion: null }).primerIntentoOk += 1;
    }

    // Q5 — tiempo de ciclo: numerador y denominador, nunca el promedio (R21).
    for (const g of await this.enEtapa(fecha, "ciclos_cerrados", () =>
      this.repo.acumularCiclosCerrados(ventana),
    )) {
      const cubo = obtener({ ...g, causaDevolucion: null });
      cubo.segCicloAcum += g.segCicloAcum;
      cubo.segCicloN += g.segCicloN;
    }

    // R46: un cubo sin ninguna medida no se escribe. Con el dia vacio esto deja CERO filas
    // y la corrida termina con exito, sin una fila "todo a cero".
    const filas = [...cubos.values()].filter(tieneAlgunaMedida);
    this.asegurarPrimerIntentoCoherente(fecha, filas);
    return filas;
  }

  /**
   * R17 — las entregas del dia cuyo conteo de intentos previos VIGENTES es 0, resueltas con
   * UNA sola llamada al punto unico de la feature 160 para todo el lote (nada de N+1 y nada
   * de un `COUNT` propio sobre `orden_historial_estado`).
   *
   * -------------------------------------------------------------------------------------
   * DERIVA DECLARADA DE `primer_intento_ok` (feature 215 / R24, R35). Este metodo es el que
   * PERSISTE las filas que tienen el escalon, asi que el aviso vive aqui completo (tambien,
   * autosuficiente, en `lib/analytics/metrics.ts` —la definicion— y en
   * `AnaliticaOperativaService.completarPrimerIntentoEnCubos` —la version VIVA—).
   *
   * (1) CAMBIO DE CRITERIO, SIN RE-BACKFILL. Con la 215 el «intento previo» ya NO se deriva de
   *     los destinos de transicion del historial: sale de las gestiones que viven dentro de un
   *     cierre APROBADO. El historico ya escrito en `analytics_daily` NO se re-backfillea y la
   *     metrica NO se redefine para dejar de depender del contador: el escalon de la serie se
   *     ASUME, deliberadamente (D15). Por que no se re-backfillea: reescribiria meses de KPI ya
   *     reportados, y ademas seria FALSO —los cierres de entonces no estaban aprobados EN EL
   *     MOMENTO de aquel calculo—.
   *
   * (2) EL CORTE ES POR `updated_at`, NO POR `fecha`. Toda fila de `analytics_daily` cuyo
   *     `updated_at` sea ANTERIOR al despliegue de la 215 esta calculada con el criterio VIEJO;
   *     toda fila con `updated_at` posterior, con el NUEVO, SEA CUAL SEA SU `fecha`. Y, con
   *     estas palabras: una fila de una fecha ANTERIOR al corte que se RECALCULA despues del
   *     corte pasa a estar calculada con el criterio NUEVO. Motivo, visible desde este mismo
   *     servicio: el job recalcula dias pasados (backfill) y el upsert refresca `updated_at` en
   *     cada recalculo (`AnaliticaRollupRepository.ts:434,453`), asi que el corte es por CUANDO
   *     SE CALCULO, no por QUE DIA MIDE. `updated_at` es una columna que YA existe
   *     (`db/migrations/20260731120000_analytics_daily/migration.sql:83`): por eso no hace falta
   *     columna, tabla ni migracion nuevas (R35/R27), ni una constante `FECHA_CORTE_*` en codigo
   *     que habria que adivinar antes de desplegar o mantener despues.
   *
   * (3) EFECTO INTRADIA: PROPIEDAD NUEVA Y PERMANENTE, NO UN TRANSITORIO. Una entrega cuya orden
   *     tiene cierres SIN aprobar reporta 0 intentos previos, asi que cuenta como primer intento:
   *     el KPI SUBE durante el dia y BAJA al aprobarse los cierres. NO es un artefacto de la
   *     migracion de criterio y NO desaparece con la deriva declarada: es una propiedad nueva y
   *     permanente de la metrica bajo el criterio nuevo. Corolario que este servicio materializa:
   *     el mismo dia puede dar DOS valores distintos segun cuando se recalcule.
   *
   * LO QUE NO CAMBIA (R23 / R24-e): se sigue REMITIENDO al punto unico de conteo
   * (`contarIntentosEnLote`), sin `COUNT` propio, sin umbral propio y sin columna materializada;
   * y `primer_intento_ok <= entregas` se mantiene (`asegurarPrimerIntentoCoherente` + CHECK).
   * -------------------------------------------------------------------------------------
   */
  private async contarPrimerIntento(
    fecha: string,
    ventana: VentanaDia,
  ): Promise<EntregaVigente[]> {
    const entregas = await this.enEtapa(fecha, "entregas_vigentes", () =>
      this.repo.listarEntregasVigentes(ventana),
    );
    if (entregas.length === 0) return [];
    const ordenIds = [...new Set(entregas.map((e) => e.ordenId))];
    const intentos = await this.enEtapa(fecha, "intentos_previos", () =>
      this.historial.contarIntentosEnLote(ordenIds),
    );
    // R14 de la 160: las ordenes sin intentos NO vienen en el Map; el `?? 0` es del llamador.
    return entregas.filter((e) => (intentos.get(e.ordenId) ?? 0) === 0);
  }

  /**
   * R18 — `primer_intento_ok <= entregas` ANTES de tocar la base. El CHECK de Postgres es la
   * red; este error es el diagnostico, con la fecha y el cubo.
   */
  private asegurarPrimerIntentoCoherente(fecha: string, filas: readonly FilaRollup[]): void {
    for (const f of filas) {
      if (f.primerIntentoOk > f.entregas) {
        throw new PrimerIntentoIncoherenteError(fecha, clave(f), f.primerIntentoOk, f.entregas);
      }
    }
  }

  /** R47/D9: aviso de volumen con la UNICA constante, que es provisional y no esta medida. */
  private avisarVolumen(resumen: ResumenCorrida): void {
    if (resumen.filasEscritas <= UMBRAL_AVISO_FILAS_CORRIDA) return;
    this.logger.warn(
      `rollup analitica ${resumen.fecha}: ${resumen.filasEscritas} filas escritas, ` +
        `${resumen.filasRetiradas} retiradas, ${resumen.ms} ms (umbral provisional ${UMBRAL_AVISO_FILAS_CORRIDA})`,
    );
  }

  /**
   * R38 — el error se propaga SIEMPRE, envuelto con la fecha y la etapa. Nada de `catch`
   * vacio y nada de tragarse el fallo: los errores propios del dominio del rollup
   * (`ReconciliacionError`, `PrimerIntentoIncoherenteError`) viajan tal cual porque ya
   * nombran la medida o el cubo, que es justo el contexto que R34/R18 exigen.
   */
  private async enEtapa<T>(
    fecha: string,
    etapa: EtapaCorrida,
    fn: () => Promise<T>,
  ): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (
        error instanceof ReconciliacionError ||
        error instanceof PrimerIntentoIncoherenteError ||
        error instanceof AnaliticaRollupError
      ) {
        throw error;
      }
      throw new AnaliticaRollupError(fecha, etapa, error);
    }
  }
}

// Reexport util para los consumidores del job: la clave textual de un cubo, que es lo que
// aparece en el mensaje de `PrimerIntentoIncoherenteError` (ids de catalogo, no PII).
export { clave as claveDeCubo };
