import type { ConsultaAnalitica } from "@/lib/analytics/consulta";
import { esNoComparable } from "@/lib/analytics/backfill-rango";
import { seudonimizarMensajeros } from "@/lib/analytics/identidad";
import { MENSAJERO_SIN_ASIGNAR } from "@/lib/analytics/types";
import type { DimensionAnalitica, RangoResuelto } from "@/lib/analytics/types";
import { fechaCalendarioCR, inicioDelDiaCREnUtc, inicioDelDiaSiguienteCREnUtc } from "@/lib/utils/fecha-cr";
import type { VentanaDia } from "@/lib/analytics/rollup-dia";
import { DIMENSION_AGREGADA } from "@/lib/interfaces/repositories/IAnaliticaOperativaRollupRepository";
import type {
  CuboRollup,
  EtiquetaEstatus,
  IAnaliticaOperativaRollupRepository,
} from "@/lib/interfaces/repositories/IAnaliticaOperativaRollupRepository";
import type {
  AgingPorEstadoFila,
  CubosDelDiaEnCurso,
  IAnaliticaOperativaVivaRepository,
} from "@/lib/interfaces/repositories/IAnaliticaOperativaVivaRepository";
import type { IOrdenHistorialService } from "@/lib/interfaces/services/IOrdenHistorialService";
import {
  AnaliticaOperativaError,
  type EtapaOperativa,
  type IAnaliticaOperativaService,
  type OpcionesAgregado,
} from "@/lib/interfaces/services/IAnaliticaOperativaService";
import {
  ERROR_UNIDAD_NO_AGREGABLE,
  NOTA_SIN_GESTIONAR,
  PENUMBRA,
  esUnidadAgregable,
  type AgregadoOperativo,
  type Cobertura,
  type CuboAgregado,
  type GranoAgregado,
  type PuntoSerie,
  type SerieOperativa,
} from "@/lib/types/analitica-operativa";

// Feature 126 (T4/T6/T8, design §D4/§D5/§D6/§D9/§D14) — COMPOSICION de la analitica operativa.
//
// Este servicio NO habla Prisma y NO conoce Next.js: recibe los dos repositorios, el contador
// de intentos (feature 160) y el RELOJ por constructor. R31 — mismo `now` inyectado => misma
// salida; no hay ni un `new Date()` ni un `Date.now()` aqui dentro.
//
// D5 — SUMAR ANTES DE DIVIDIR, SIEMPRE. Las tasas suman numerador y denominador sobre los
// cubos del recorte y dividen AL FINAL; `tiempo_ciclo` suma `seg_ciclo_acum` y `seg_ciclo_n`
// y divide al final. Nunca media de medias, nunca una tasa materializada.
//
// Feature 176 — LA MISMA REGLA, UN NIVEL MAS ARRIBA. El parrafo de encima describe la suma
// de los cubos DENTRO DE UN DIA, porque el grano de salida de `consultar` es el punto
// diario. No dice nada del cruce ENTRE dias, y ahi estaba el hueco: sumar despues esos
// cocientes diarios es media de medias, que pondera igual un dia de 1 gestion y un dia de
// 1.000. `consultarAgregado` EXTIENDE la regla —no la revoca— quitando `cubo.fecha` de la
// clave de agrupacion y poniendo en su lugar el CUBO TEMPORAL (todo el periodo, o la semana
// ISO). La division sigue ocurriendo una sola vez, en `razon()`, y ahora ademas viajan el
// numerador y el denominador para que el consumidor no tenga que recomponerlos.
//
// R30/R14 — NADA de `BigInt` sale de aqui: `JSON.stringify(BigInt)` lanza `TypeError`. El
// `bigint` muere en la division.

/** Puerto MINIMO hacia el punto unico de «intentos» del repo (feature 160), como la 124. */
export type ContadorIntentos = Pick<IOrdenHistorialService, "contarIntentosEnLote">;

export interface AnaliticaOperativaDeps {
  /** R31 — reloj INYECTADO, sin default: un test no debe creer que controla lo que no controla. */
  readonly now: () => Date;
}

/** Las 10 medidas de un cubo, ya fundidas para un recorte. */
interface Medidas {
  ordenesCreadas: number;
  ordenesEstadoStock: number;
  entregas: number;
  devoluciones: number;
  rechazos: number;
  reprogramaciones: number;
  incidentes: number;
  primerIntentoOk: number;
  segCicloAcum: bigint;
  segCicloN: number;
}

type MedidaId = keyof Medidas;

/**
 * D10/R35 de la 135 — el DENOMINADOR de las tres tasas es GESTIONES, no ordenes. Se declara
 * una sola vez y con las MISMAS cuatro medidas que `DENOMINADOR_GESTIONES` del catalogo
 * (`lib/analytics/metrics.ts`, archivo de la 127 que la 126 NO toca, R3).
 *
 * El aviso de la 135 anticipa la «correccion» que alguien intentara: dividir entre
 * `ordenesCreadas`. Es exactamente la mutacion de R10 y `operativa-tasas.test.ts` la mata.
 */
const DENOMINADOR_GESTIONES: readonly MedidaId[] = [
  "entregas",
  "devoluciones",
  "rechazos",
  "incidentes",
];

/** Metrica del catalogo -> medida del rollup que la encarna. */
const MEDIDA_DE_METRICA: Readonly<Record<string, MedidaId>> = {
  ordenes_creadas: "ordenesCreadas",
  ordenes_por_estado: "ordenesEstadoStock",
  sin_gestionar: "ordenesEstadoStock",
  entregas: "entregas",
  devoluciones: "devoluciones",
  rechazos: "rechazos",
  reprogramaciones: "reprogramaciones",
  incidentes: "incidentes",
  motivos_devolucion: "devoluciones",
};

/**
 * Desagregacion POR DEFECTO de cada metrica: la dimension sin la cual la metrica no dice
 * nada. `ordenes_por_estado` sin estatus es un total; `motivos_devolucion` sin causa,
 * tambien. El llamador puede pedir otra (la 131 lo hara) y R24 exige que un `adminTienda`
 * pueda seguir pidiendo `mensajero` aunque no pueda FILTRAR por el.
 */
const DESAGREGACION_POR_DEFECTO: Readonly<Record<string, DimensionAnalitica>> = {
  ordenes_por_estado: "estatus",
  aging_por_estado: "estatus",
  motivos_devolucion: "causa_devolucion",
};

/** Etiqueta del cubo `causa_devolucion IS NULL` (R15). Se escribe UNA vez. */
export const SIN_CAUSA_TIPIFICADA = "sin causa tipificada";

/** El `value` del estatus que la metrica `sin_gestionar` proyecta del embudo (D14/R35). */
const ESTATUS_SIN_GESTIONAR = "sin_gestionar";

function medidasVacias(): Medidas {
  return {
    ordenesCreadas: 0,
    ordenesEstadoStock: 0,
    entregas: 0,
    devoluciones: 0,
    rechazos: 0,
    reprogramaciones: 0,
    incidentes: 0,
    primerIntentoOk: 0,
    // `BigInt(0)` y no `0n`: el `target` del repo es ES2017.
    segCicloAcum: BigInt(0),
    segCicloN: 0,
  };
}

function acumular(destino: Medidas, cubo: CuboRollup): void {
  destino.ordenesCreadas += cubo.ordenesCreadas;
  destino.ordenesEstadoStock += cubo.ordenesEstadoStock;
  destino.entregas += cubo.entregas;
  destino.devoluciones += cubo.devoluciones;
  destino.rechazos += cubo.rechazos;
  destino.reprogramaciones += cubo.reprogramaciones;
  destino.incidentes += cubo.incidentes;
  destino.primerIntentoOk += cubo.primerIntentoOk;
  destino.segCicloAcum += cubo.segCicloAcum;
  destino.segCicloN += cubo.segCicloN;
}

/**
 * D5 — la division, y el UNICO sitio donde ocurre. Denominador 0 => `null`, jamas `0`,
 * jamas `NaN` y jamas una excepcion (R10/R14): «no se sabe» y «cero» no son el mismo dato.
 */
function razon(numerador: number, denominador: number): number | null {
  if (denominador === 0) return null;
  return numerador / denominador;
}

export class AnaliticaOperativaService implements IAnaliticaOperativaService {
  constructor(
    private readonly rollup: IAnaliticaOperativaRollupRepository,
    private readonly viva: IAnaliticaOperativaVivaRepository,
    private readonly intentos: ContadorIntentos,
    private readonly deps: AnaliticaOperativaDeps,
  ) {}

  /**
   * La UNICA entrada. `desagregacion` es opcional: sin ella se usa la del catalogo
   * (`DESAGREGACION_POR_DEFECTO`) o ninguna, y la serie sale por fecha.
   */
  async consultar(
    consulta: ConsultaAnalitica,
    desagregacion?: DimensionAnalitica,
  ): Promise<SerieOperativa> {
    const metrica = consulta.metrica;
    const dimension = desagregacion ?? DESAGREGACION_POR_DEFECTO[metrica.id];
    const cobertura = this.cobertura(consulta);

    const puntos =
      metrica.clase === "live"
        ? await this.serieViva(consulta)
        : await this.serieDeRollup(consulta, dimension);

    return {
      metricaId: metrica.id,
      unidad: metrica.unidad,
      // R9 — la unidad de conteo sale del CATALOGO (`getMetrica(id).unidadDeConteo`), jamas
      // de una tabla propia de este archivo.
      unidadDeConteo: metrica.unidadDeConteo,
      rango: consulta.rango,
      puntos,
      cobertura,
      ...(metrica.id === "sin_gestionar" ? { nota: NOTA_SIN_GESTIONAR } : {}),
    };
  }

  /**
   * Feature 176 (R1) — LA LECTURA AGREGADA. Un cubo por periodo o por semana ISO, con el
   * numerador y el denominador ANTES de dividir.
   *
   * Pide los cubos al MISMO metodo del repositorio (`agregarCubos`) con los MISMOS granos
   * que `consultar` y reusa `cobertura()`, `cubosIntradia()` y `razon()`. No hay una
   * segunda formula ni una segunda entrada a `analytics_daily`: la unica diferencia con la
   * serie es la CLAVE DE AGRUPACION. Eso es lo que hace estructuralmente cierto R8.
   */
  async consultarAgregado(
    consulta: ConsultaAnalitica,
    opciones: OpcionesAgregado = {},
  ): Promise<AgregadoOperativo> {
    const metrica = consulta.metrica;
    // R12 — RECHAZO TEMPRANO, antes de tocar nada. El borde ya responde `validation_error`
    // por este mismo motivo; aqui se falla RUIDOSAMENTE por si algun dia se llama al
    // servicio por otra puerta. Agregar un STOCK entre fechas daria una respuesta con forma
    // correcta y significado inventado, que es peor que un error.
    if (!esUnidadAgregable(metrica.unidad)) {
      throw new Error(`analitica operativa agregada ("${metrica.id}"): ${ERROR_UNIDAD_NO_AGREGABLE}`);
    }

    const grano = opciones.grano ?? "periodo";
    const cobertura = this.cobertura(consulta);
    const cubos =
      metrica.clase === "live"
        ? await this.cubosVivosAgregados(consulta, opciones.desagregacion)
        : await this.cubosDeRollupAgregados(
            consulta,
            grano,
            opciones.desagregacion ?? DESAGREGACION_POR_DEFECTO[metrica.id],
          );

    return {
      metricaId: metrica.id,
      unidad: metrica.unidad,
      unidadDeConteo: metrica.unidadDeConteo,
      grano,
      rango: consulta.rango,
      cubos,
      // R9 — el bloque de cobertura tambien viaja en el agregado: agregar sobre dias sin
      // dato y no decirlo es la misma mentira, solo que sumada.
      cobertura,
    };
  }

  /**
   * R2/R3/R6/R7/R10 — las cinco metricas de rollup, cubeteadas por `grano`.
   *
   * Los cubos del rollup (dias CERRADOS) y los del intradia (el dia EN CURSO, D4) caen en
   * el MISMO grupo y se suman antes de dividir; el grupo que recibio algo del intradia
   * hereda la marca `parcial` y el `corteAt`.
   */
  private async cubosDeRollupAgregados(
    consulta: ConsultaAnalitica,
    grano: GranoAgregado,
    dimension: DimensionAnalitica | undefined,
  ): Promise<readonly CuboAgregado[]> {
    const granos = dimension ? [dimension] : [];
    const cubos = await this.enEtapa(consulta, "cubos_rollup", () =>
      this.rollup.agregarCubos(consulta, granos),
    );
    const intradia = await this.cubosIntradia(consulta, granos);

    const grupos = new Map<string, GrupoAgregado>();
    fundirEnGrupos(grupos, cubos, consulta.rango, grano, dimension, undefined);
    fundirEnGrupos(grupos, intradia.cubos, consulta.rango, grano, dimension, intradia.corteAt);

    const etiquetas = await this.etiquetasSiHaceFalta(consulta, dimension, [...grupos.values()]);
    const salida = [...grupos.values()].map((g) => ({
      fecha: g.fecha,
      desdeFecha: g.desdeFecha,
      hastaFecha: g.hastaFecha,
      ...(dimension ? { dimension: this.etiquetar(dimension, g.clave, etiquetas) } : {}),
      ...componentesYValor(consulta.metrica.id, g.medidas),
      // R10 — el cubo que contiene el dia en curso viaja MARCADO. Uno de solo dias cerrados
      // no lleva la marca: si la llevara, los dos serian indistinguibles.
      ...(g.corteAt ? { parcial: true as const, corteAt: g.corteAt.toISOString() } : {}),
    }));

    // R15 — la seudonimizacion ocurre AQUI, antes de que el agregado exista como objeto de
    // respuesta. El modo agregado no puede ser una puerta trasera a los ids reales.
    return dimension === "mensajero"
      ? seudonimizarCubos(salida, consulta.politicaIdentidad)
      : salida;
  }

  /**
   * R11/D3 — `aging_por_estado`: CUBO UNICO AL CORTE, no serie temporal.
   *
   * Es la unica metrica `clase: "live"` del catalogo y es un STOCK INSTANTANEO: «el aging
   * medio de agosto» no significa nada, asi que no se agrega sobre el TIEMPO sino sobre la
   * DIMENSION, fundiendo los estatus al corte. Lo que le faltaba no era el rango largo —su
   * serie siempre tuvo una sola fecha— sino la cifra total, en TODO rango.
   *
   * `AgingPorEstadoFila` solo lleva tres coordenadas (`estatusId`, `zonaId`, `tiendaId`):
   * pedir un desglose por mensajero o por causa no inventa una coordenada, funde todo en el
   * cubo unico.
   */
  private async cubosVivosAgregados(
    consulta: ConsultaAnalitica,
    desagregacion: DimensionAnalitica | undefined,
  ): Promise<readonly CuboAgregado[]> {
    const corteAt = this.deps.now();
    const filas = await this.enEtapa(consulta, "aging", () =>
      this.viva.agingPorEstado(consulta, corteAt),
    );
    const dimension =
      desagregacion && DIMENSIONES_DE_AGING.has(desagregacion) ? desagregacion : undefined;

    const porClave = new Map<string, { acum: bigint; n: number }>();
    for (const f of filas) {
      const clave = claveDeAging(f, dimension);
      const actual = porClave.get(clave) ?? { acum: BigInt(0), n: 0 };
      // D5 — sumar antes de dividir, tambien aqui: `Σ segEnEstadoAcum / Σ ordenes`.
      porClave.set(clave, { acum: actual.acum + f.segEnEstadoAcum, n: actual.n + f.ordenes });
    }

    const etiquetas =
      dimension === "estatus"
        ? await this.enEtapa(consulta, "etiquetas_estatus", () =>
            this.rollup.etiquetasDeEstatus([...porClave.keys()]),
          )
        : new Map<string, EtiquetaEstatus>();

    // Su unica fecha es la del corte, y el cubo es SIEMPRE parcial: una foto del ahora
    // nunca es un dia cerrado.
    const fecha = fechaCalendarioCR(corteAt);
    return [...porClave.entries()]
      .map(([clave, { acum, n }]) => ({
        fecha,
        desdeFecha: fecha,
        hastaFecha: fecha,
        ...(dimension ? { dimension: this.etiquetar(dimension, clave, etiquetas) } : {}),
        // R5 — el `bigint` muere aqui, una sola vez, al construir el cubo de salida.
        numerador: Number(acum),
        denominador: n,
        valor: razon(Number(acum), n),
        parcial: true as const,
        corteAt: corteAt.toISOString(),
      }))
      .sort(ordenarCubosPorDimension);
  }

  /**
   * D9/R19/R20/R34 — lo que la respuesta sabe sobre su propia cobertura. El horizonte se
   * IMPORTA de la 125 (`esNoComparable`); la 126 no declara una segunda constante ni escribe
   * la fecha literal (censo de R19).
   */
  private cobertura(consulta: ConsultaAnalitica): Cobertura {
    return {
      fechasNoComparables: fechasDelRango(consulta).filter(esNoComparable),
      // R20 — la penumbra se DECLARA, no se estima ni se rellena. Constante unica.
      penumbra: PENUMBRA,
    };
  }

  /**
   * R17 — `aging_por_estado`, la unica metrica `clase: "live"` del catalogo, servida contra
   * `orden` + `orden_historial_estado`. NO lee el rollup, ni siquiera para completar.
   */
  private async serieViva(consulta: ConsultaAnalitica): Promise<readonly PuntoSerie[]> {
    const corteAt = this.deps.now();
    const filas = await this.enEtapa(consulta, "aging", () =>
      this.viva.agingPorEstado(consulta, corteAt),
    );
    const porEstatus = new Map<string, { acum: bigint; n: number }>();
    for (const f of filas) {
      const actual = porEstatus.get(f.estatusId) ?? { acum: BigInt(0), n: 0 };
      porEstatus.set(f.estatusId, {
        acum: actual.acum + f.segEnEstadoAcum,
        n: actual.n + f.ordenes,
      });
    }
    const etiquetas = await this.enEtapa(consulta, "etiquetas_estatus", () =>
      this.rollup.etiquetasDeEstatus([...porEstatus.keys()]),
    );
    // El aging es una foto AL CORTE, no una serie historica: su unica fecha es la del corte.
    const fecha = fechaCalendarioCR(corteAt);
    return [...porEstatus.entries()]
      .map(([estatusId, { acum, n }]) => ({
        fecha,
        dimension: etiquetaDeEstatus(etiquetas, estatusId),
        // D5 — sumar antes de dividir. `Number(acum)` DESPUES de la division no es posible
        // (el cociente ya es number), asi que se convierte el numerador justo aqui, una vez
        // que se sabe que hay denominador: nada de `BigInt` sale del servicio (R14/R30).
        valor: n === 0 ? null : Number(acum) / n,
      }))
      .sort(ordenarPorDimension);
  }

  /**
   * Las 14 metricas `snapshot`, servidas del rollup, MAS el dia en curso calculado en vivo
   * (D6/R18) cuando el rango lo incluye.
   */
  private async serieDeRollup(
    consulta: ConsultaAnalitica,
    dimension: DimensionAnalitica | undefined,
  ): Promise<readonly PuntoSerie[]> {
    const granos = dimension ? [dimension] : [];
    const cubos = await this.enEtapa(consulta, "cubos_rollup", () =>
      this.rollup.agregarCubos(consulta, granos),
    );

    const intradia = await this.cubosIntradia(consulta, granos);
    // `corteAt: undefined` para los cubos del ROLLUP: son dias CERRADOS y marcarlos
    // `parcial` los volveria indistinguibles del dia abierto, que es justo lo que R18
    // existe para impedir (solo que en la direccion contraria).
    const puntos = await this.proyectar(consulta, dimension, [...cubos], undefined);
    if (intradia.cubos.length === 0) return puntos;
    const puntosDelDia = await this.proyectar(
      consulta,
      dimension,
      intradia.cubos,
      intradia.corteAt,
    );
    return [...puntos, ...puntosDelDia];
  }

  /**
   * D6/R18 — el dia en curso NO tiene filas en el rollup POR CONSTRUCCION: el job de la 124
   * corre a las 00:30 CR sobre el dia que CERRO. Si el rango lo incluye, se calcula en vivo
   * con la ventana `[medianoche CR de hoy, ahora)` y el punto viaja marcado.
   *
   * D7 — las cotas salen de `lib/utils/fecha-cr`; aqui no hay ni una hora escrita a mano.
   */
  private async cubosIntradia(
    consulta: ConsultaAnalitica,
    granos: readonly DimensionAnalitica[],
  ): Promise<{ cubos: readonly CuboRollup[]; corteAt: Date | undefined }> {
    const ahora = this.deps.now();
    const hoy = fechaCalendarioCR(ahora);
    const { desdeFecha, hastaFecha } = consulta.rango;
    if (hoy < desdeFecha || hoy > hastaFecha) return { cubos: [], corteAt: undefined };

    const ventana: VentanaDia = { desde: inicioDelDiaCREnUtc(hoy), hasta: ahora };
    const crudos = await this.enEtapa(consulta, "cubos_intradia", () =>
      this.viva.cubosDelDiaEnCurso(consulta, ventana),
    );
    const conPrimerIntento = await this.completarPrimerIntento(consulta, crudos);
    return { cubos: agregarAlGrano(conPrimerIntento, granos), corteAt: ahora };
  }

  /**
   * R17 de la 124 — `primer_intento_ok` con el criterio UNICO de la feature 160, en UNA sola
   * llamada para todo el lote. Aqui NO se reimplementa que es un «intento»: seria la tercera
   * copia de una definicion que D13 se compromete a CONTENER, no a multiplicar.
   */
  private async completarPrimerIntento(
    consulta: ConsultaAnalitica,
    crudos: CubosDelDiaEnCurso,
  ): Promise<readonly CuboRollup[]> {
    if (crudos.entregasVigentes.length === 0) return crudos.cubos;
    const ordenIds = [...new Set(crudos.entregasVigentes.map((e) => e.ordenId))];
    const intentos = await this.enEtapa(consulta, "primer_intento", () =>
      this.intentos.contarIntentosEnLote(ordenIds),
    );
    return completarPrimerIntentoEnCubos(crudos, intentos);
  }

  /** Funde los cubos en puntos de serie y aplica la formula de la metrica. */
  private async proyectar(
    consulta: ConsultaAnalitica,
    dimension: DimensionAnalitica | undefined,
    cubos: readonly CuboRollup[],
    corteAt: Date | undefined,
  ): Promise<readonly PuntoSerie[]> {
    const metrica = consulta.metrica;
    const relevantes =
      metrica.id === "sin_gestionar"
        ? await this.soloSinGestionar(consulta, cubos)
        : cubos;

    // (fecha, dimension) -> medidas fundidas. El `Map` conserva el orden de insercion, que es
    // el del repositorio (`ORDER BY fecha ASC`), asi que la serie sale ordenada por fecha.
    const grupos = new Map<string, { fecha: string; clave: string; medidas: Medidas }>();
    for (const cubo of relevantes) {
      const clave = valorDeDimension(cubo, dimension);
      const k = `${cubo.fecha}\u001f${clave}`;
      let grupo = grupos.get(k);
      if (grupo === undefined) {
        grupo = { fecha: cubo.fecha, clave, medidas: medidasVacias() };
        grupos.set(k, grupo);
      }
      acumular(grupo.medidas, cubo);
    }

    const etiquetas = await this.etiquetasSiHaceFalta(consulta, dimension, [...grupos.values()]);
    const puntos: PuntoSerie[] = [...grupos.values()].map((g) => ({
      fecha: g.fecha,
      ...(dimension ? { dimension: this.etiquetar(dimension, g.clave, etiquetas) } : {}),
      valor: this.valorDe(metrica.id, g.medidas),
      // R18 — el punto del dia en curso viaja MARCADO, no indistinguible de un dia cerrado.
      ...(corteAt ? { parcial: true as const, corteAt: corteAt.toISOString() } : {}),
    }));

    return dimension === "mensajero"
      ? seudonimizarPuntos(puntos, consulta.politicaIdentidad)
      : puntos;
  }

  /**
   * D14/R35 — `sin_gestionar` se DERIVA del embudo: es la proyeccion de
   * `ordenes_estado_stock` sobre el estatus `sin_gestionar`. Sin migracion, sin tocar el job
   * de la 124 y sin columna propia (que `analytics_daily` no tiene).
   */
  private async soloSinGestionar(
    consulta: ConsultaAnalitica,
    cubos: readonly CuboRollup[],
  ): Promise<readonly CuboRollup[]> {
    const ids = [...new Set(cubos.map((c) => c.estatusId))];
    const etiquetas = await this.enEtapa(consulta, "etiquetas_estatus", () =>
      this.rollup.etiquetasDeEstatus(ids),
    );
    return cubos.filter((c) => etiquetas.get(String(c.estatusId))?.value === ESTATUS_SIN_GESTIONAR);
  }

  private async etiquetasSiHaceFalta(
    consulta: ConsultaAnalitica,
    dimension: DimensionAnalitica | undefined,
    grupos: readonly { clave: string }[],
  ): Promise<ReadonlyMap<string, EtiquetaEstatus>> {
    if (dimension !== "estatus") return new Map();
    return this.enEtapa(consulta, "etiquetas_estatus", () =>
      this.rollup.etiquetasDeEstatus(grupos.map((g) => g.clave)),
    );
  }

  /**
   * D8/R13 — la etiqueta de un estatus sale de la TABLA. Un estatus fuera de
   * `ORDER_STATUS_SEED` (la fila huerfana que la 155 retiro del catalogo y que 37 filas de
   * historial siguen referenciando) NO lanza y NO se descarta: conserva la suya.
   */
  private etiquetar(
    dimension: DimensionAnalitica,
    clave: string,
    etiquetas: ReadonlyMap<string, EtiquetaEstatus>,
  ): string {
    if (dimension === "estatus") return etiquetaDeEstatus(etiquetas, clave);
    return clave;
  }

  /** La formula de cada metrica. D5: se suma antes de dividir, y se divide UNA vez. */
  private valorDe(metricaId: string, m: Medidas): number | null {
    switch (metricaId) {
      // R10 — las tres tasas, con denominador de GESTIONES. Dividir entre `ordenesCreadas`
      // es la mutacion que `operativa-tasas.test.ts` mata.
      case "tasa_entrega":
        return razon(m.entregas, denominadorDeGestiones(m));
      case "tasa_devolucion":
        return razon(m.devoluciones, denominadorDeGestiones(m));
      case "tasa_rechazo":
        return razon(m.rechazos, denominadorDeGestiones(m));
      // `primer_intento_ok` es un porcentaje SOBRE ENTREGAS: el rollup lo declara subconjunto
      // de `entregas` de la MISMA fila (`db/schema.prisma`, columna `primer_intento_ok`) y la
      // 124 lo verifica con `primer_intento_ok <= entregas` antes de escribir.
      case "primer_intento_ok":
        return razon(m.primerIntentoOk, m.entregas);
      // R14 — `Σ acum / Σ n`, jamas promedio de promedios, y `null` si `n` agregado es 0.
      case "tiempo_ciclo":
        return m.segCicloN === 0 ? null : Number(m.segCicloAcum) / m.segCicloN;
      default: {
        const medida = MEDIDA_DE_METRICA[metricaId];
        // R11 — aqui NO se compone ninguna serie que sume dos metricas: cada metrica lee UNA
        // medida. No hay ningun `entregas + ordenesCreadas` que `sonSumables` prohibiria.
        return medida === undefined ? null : m[medida] === undefined ? null : Number(m[medida]);
      }
    }
  }

  /**
   * R32 — todo fallo se envuelve nombrando la ETAPA y la METRICA, y NADA MAS: ni ids de
   * orden, ni guias, ni destinatarios, ni telefonos, ni el `where` con los ids del filtro.
   */
  private async enEtapa<T>(
    consulta: ConsultaAnalitica,
    etapa: EtapaOperativa,
    fn: () => Promise<T>,
  ): Promise<T> {
    try {
      return await fn();
    } catch (causa) {
      throw new AnaliticaOperativaError(etapa, consulta.metrica.id, causa);
    }
  }
}

function denominadorDeGestiones(m: Medidas): number {
  return DENOMINADOR_GESTIONES.reduce((acc, id) => acc + Number(m[id]), 0);
}

/* -------------------------------------------------------------------------- */
/* Feature 176 — el cubeteo temporal del modo agregado                         */
/* -------------------------------------------------------------------------- */

/** Un cubo temporal en construccion: sus medidas fundidas y su marca de parcialidad. */
interface GrupoAgregado {
  fecha: string;
  desdeFecha: string;
  hastaFecha: string;
  clave: string;
  medidas: Medidas;
  /** R10 — presente si ALGUN dia componente vino del intradia; es el corte MAYOR. */
  corteAt: Date | undefined;
}

/** Las tres coordenadas que `AgingPorEstadoFila` lleva de verdad (R11). */
const DIMENSIONES_DE_AGING: ReadonlySet<DimensionAnalitica> = new Set<DimensionAnalitica>([
  "estatus",
  "zona",
  "tienda",
]);

function claveDeAging(fila: AgingPorEstadoFila, dimension: DimensionAnalitica | undefined): string {
  switch (dimension) {
    case "estatus":
      return fila.estatusId;
    case "zona":
      return fila.zonaId;
    case "tienda":
      return fila.tiendaId;
    default:
      // Sin desglose: TODAS las filas caen en el cubo unico al corte.
      return DIMENSION_AGREGADA;
  }
}

/**
 * R2 — EL PASO QUE CORRIGE LA ARITMETICA. La clave de agrupacion deja de llevar
 * `cubo.fecha` y pasa a llevar el CUBO TEMPORAL: todos los dias del periodo (o de la
 * semana) acumulan en las MISMAS `Medidas`, y la division llega despues, una sola vez.
 *
 * Aqui no se mira ni un `valor` diario: si esta funcion recibiera puntos ya divididos,
 * cualquier cosa que hiciera con ellos seria media de medias.
 */
function fundirEnGrupos(
  grupos: Map<string, GrupoAgregado>,
  cubos: readonly CuboRollup[],
  rango: RangoResuelto,
  grano: GranoAgregado,
  dimension: DimensionAnalitica | undefined,
  corteAt: Date | undefined,
): void {
  for (const cubo of cubos) {
    const ventana = ventanaDelCubo(cubo.fecha, grano, rango);
    const clave = valorDeDimension(cubo, dimension);
    const k = `${ventana.fecha}${clave}`;
    let grupo = grupos.get(k);
    if (grupo === undefined) {
      grupo = { ...ventana, clave, medidas: medidasVacias(), corteAt: undefined };
      grupos.set(k, grupo);
    }
    acumular(grupo.medidas, cubo);
    if (corteAt !== undefined && (grupo.corteAt === undefined || corteAt > grupo.corteAt)) {
      grupo.corteAt = corteAt;
    }
  }
}

/**
 * R19/D6 — la ventana del cubo al que pertenece `fecha`.
 *
 * `periodo`: un unico cubo con los extremos del rango. `semana`: la semana ISO anclada en
 * su LUNES, con los extremos RECORTADOS al rango (una semana a medias no puede anunciar
 * dias que la consulta no pidio).
 */
function ventanaDelCubo(
  fecha: string,
  grano: GranoAgregado,
  rango: RangoResuelto,
): { fecha: string; desdeFecha: string; hastaFecha: string } {
  if (grano === "periodo") {
    return { fecha: rango.desdeFecha, desdeFecha: rango.desdeFecha, hastaFecha: rango.hastaFecha };
  }
  const lunes = lunesDeLaSemanaCR(fecha);
  const domingo = sumarDiasCalendarioCR(lunes, 6);
  return {
    fecha: lunes,
    desdeFecha: lunes < rango.desdeFecha ? rango.desdeFecha : lunes,
    hastaFecha: domingo > rango.hastaFecha ? rango.hastaFecha : domingo,
  };
}

/**
 * Duracion de un dia DERIVADA de los propios helpers, como en `lib/analytics/ranges.ts`:
 * este archivo no declara ninguna constante temporal propia y CR no tiene horario de verano.
 */
const FECHA_ANCLA = "2000-01-01";
const UN_DIA_MS =
  inicioDelDiaSiguienteCREnUtc(FECHA_ANCLA).getTime() - inicioDelDiaCREnUtc(FECHA_ANCLA).getTime();

function sumarDiasCalendarioCR(fecha: string, dias: number): string {
  return fechaCalendarioCR(new Date(inicioDelDiaCREnUtc(fecha).getTime() + dias * UN_DIA_MS));
}

/**
 * R19 — el LUNES de la semana CR de `fecha`, con la MISMA convencion que el preset `semana`
 * de `lib/analytics/ranges.ts` (que no la exporta).
 *
 * `inicioDelDiaCREnUtc` da `...T06:00:00.000Z`, que cae en la misma fecha en UTC, asi que
 * `getUTCDay()` (0 = domingo) es el dia de la semana de la fecha CR sin depender del huso
 * del proceso; `(dow + 6) % 7` son los dias a retroceder hasta el lunes.
 *
 * DEUDA DECLARADA (`design.md §6.1`): esta es la SEGUNDA definicion de «lunes» del repo —la
 * otra es `lunesDeLaSemana` en `app/(app)/analitica/_components/operativo/agregacion.ts`, de
 * la 131, que `lib/` no puede importar—. La contiene `agregado-semana.test.ts`, que compara
 * contra el preset, y la salda la ficha frontend de D5 borrando aquella copia.
 */
function lunesDeLaSemanaCR(fecha: string): string {
  const diaDeLaSemana = inicioDelDiaCREnUtc(fecha).getUTCDay();
  return sumarDiasCalendarioCR(fecha, -((diaDeLaSemana + 6) % 7));
}

/**
 * R1/R3/R6/R7 — los COMPONENTES de cada metrica y su division, en el mismo sitio y con las
 * mismas constantes que `valorDe`. No hay formula nueva: `tasa_*` divide entre GESTIONES
 * (`entregas+devoluciones+rechazos+incidentes`, jamas `ordenesCreadas`), `primer_intento_ok`
 * divide entre ENTREGAS, y `tiempo_ciclo` es `Σ segCicloAcum / Σ segCicloN`.
 *
 * R4 — con denominador 0 el valor es `null` y los dos componentes viajan en 0 y PRESENTES:
 * `denominador === 0` es una afirmacion sobre la operacion («no hubo gestiones»), no una
 * ausencia de informacion. `valor: 0` sigue prohibido.
 */
function componentesYValor(
  metricaId: string,
  m: Medidas,
): { numerador: number; denominador: number; valor: number | null } {
  const { numerador, denominador } = componentesDe(metricaId, m);
  return { numerador, denominador, valor: razon(numerador, denominador) };
}

function componentesDe(
  metricaId: string,
  m: Medidas,
): { numerador: number; denominador: number } {
  switch (metricaId) {
    case "tasa_entrega":
      return { numerador: m.entregas, denominador: denominadorDeGestiones(m) };
    case "tasa_devolucion":
      return { numerador: m.devoluciones, denominador: denominadorDeGestiones(m) };
    case "tasa_rechazo":
      return { numerador: m.rechazos, denominador: denominadorDeGestiones(m) };
    case "primer_intento_ok":
      return { numerador: m.primerIntentoOk, denominador: m.entregas };
    // R5 — el `bigint` muere AQUI, al construir el cubo de salida, y no antes: sumarlo como
    // `number` perderia precision en rangos largos.
    case "tiempo_ciclo":
      return { numerador: Number(m.segCicloAcum), denominador: m.segCicloN };
    default:
      // Inalcanzable: `consultarAgregado` ya rechazo toda unidad que no sea `porcentaje` ni
      // `segundos` (R12). Se falla ruidosamente en vez de devolver ceros plausibles.
      throw new Error(`analitica operativa agregada: metrica sin componentes "${metricaId}"`);
  }
}

/** R15 — el gemelo de `seudonimizarPuntos` para los cubos agregados. Mismo helper de la 122. */
function seudonimizarCubos(
  cubos: readonly CuboAgregado[],
  politica: "real" | "seudonima",
): readonly CuboAgregado[] {
  if (politica === "real") return cubos;
  const filas = cubos.map((c) => ({ cubo: c, mensajeroId: c.dimension ?? MENSAJERO_SIN_ASIGNAR }));
  return seudonimizarMensajeros(filas, politica).map((f) => ({ ...f.cubo, dimension: f.mensajero }));
}

/** Orden estable por dimension: el resultado no depende del orden de la base. */
function ordenarCubosPorDimension(a: CuboAgregado, b: CuboAgregado): number {
  return (a.dimension ?? "").localeCompare(b.dimension ?? "");
}

function etiquetaDeEstatus(
  etiquetas: ReadonlyMap<string, EtiquetaEstatus>,
  estatusId: string,
): string {
  // Sin fila en `order_status` (imposible por FK, pero el tipo lo admite) se devuelve el id:
  // el punto SIGUE en la serie. Descartarlo dejaria el embudo sin cuadrar y sin senal.
  return etiquetas.get(estatusId)?.label ?? estatusId;
}

/** Valor de la dimension pedida en un cubo, ya normalizado. */
function valorDeDimension(cubo: CuboRollup, dimension: DimensionAnalitica | undefined): string {
  switch (dimension) {
    case "zona":
      return String(cubo.zonaId);
    case "tienda":
      return String(cubo.tiendaId);
    // D10/R8 — el `null` del rollup se normaliza a `MENSAJERO_SIN_ASIGNAR` ANTES de
    // seudonimizar: normalizarlo despues dejaria un `null` serializado en el payload, y
    // descartarlo perderia un cubo con significado de dominio.
    case "mensajero":
      return cubo.mensajeroId === null ? MENSAJERO_SIN_ASIGNAR : String(cubo.mensajeroId);
    case "estatus":
      return String(cubo.estatusId);
    // R15 — la devolucion sin causa tipificada tiene su PROPIO cubo, etiquetado. El historico
    // anterior a la feature 73 no se backfilleo: descartarlo perderia devoluciones reales.
    case "causa_devolucion":
      return cubo.causaDevolucion === null ? SIN_CAUSA_TIPIFICADA : String(cubo.causaDevolucion);
    default:
      return DIMENSION_AGREGADA;
  }
}

/**
 * R7/D10 — la seudonimizacion ocurre AQUI, en el servidor y antes de que la serie exista como
 * objeto de respuesta.
 *
 * DESVIACION DECLARADA respecto de `design.md §5.3`, que la colocaba en el paso 4 de la
 * Server Action. Hacerla en el servicio es ESTRICTAMENTE mas fuerte: el id real no llega
 * siquiera a cruzar la frontera servicio→borde, asi que ningun borde futuro (la 134, por
 * ejemplo) puede olvidarla. Se reusa `seudonimizarMensajeros` de la 122: no se reimplementa
 * el etiquetado ordinal ni se deriva la etiqueta del uuid (eso permitiria correlacionar entre
 * consultas, que es justo lo que aquella funcion evita).
 */
function seudonimizarPuntos(
  puntos: readonly PuntoSerie[],
  politica: "real" | "seudonima",
): readonly PuntoSerie[] {
  if (politica === "real") return puntos;
  const filas = puntos.map((p) => ({ punto: p, mensajeroId: p.dimension ?? MENSAJERO_SIN_ASIGNAR }));
  return seudonimizarMensajeros(filas, politica).map((f) => ({ ...f.punto, dimension: f.mensajero }));
}

/** Orden estable de la serie por dimension: el resultado no depende del orden de la base. */
function ordenarPorDimension(a: PuntoSerie, b: PuntoSerie): number {
  return (a.dimension ?? "").localeCompare(b.dimension ?? "");
}

/**
 * Reagrupa los cubos del intradia al grano pedido, para que salgan con la MISMA forma que los
 * del rollup: el repositorio vivo siempre devuelve el grano completo (lo exige R33).
 */
function agregarAlGrano(
  cubos: readonly CuboRollup[],
  granos: readonly DimensionAnalitica[],
): readonly CuboRollup[] {
  if (granos.length === 0 && cubos.length === 0) return cubos;
  const pedidas = new Set(granos);
  const salida = new Map<string, CuboRollup>();
  for (const cubo of cubos) {
    const coord = {
      zonaId: pedidas.has("zona") ? cubo.zonaId : DIMENSION_AGREGADA,
      tiendaId: pedidas.has("tienda") ? cubo.tiendaId : DIMENSION_AGREGADA,
      mensajeroId: pedidas.has("mensajero") ? cubo.mensajeroId : DIMENSION_AGREGADA,
      estatusId: pedidas.has("estatus") ? cubo.estatusId : DIMENSION_AGREGADA,
      causaDevolucion: pedidas.has("causa_devolucion") ? cubo.causaDevolucion : DIMENSION_AGREGADA,
    };
    const k = [cubo.fecha, coord.zonaId, coord.tiendaId, coord.mensajeroId, coord.estatusId, coord.causaDevolucion].join(
      "\u001f",
    );
    const previo = salida.get(k);
    if (previo === undefined) {
      salida.set(k, { ...cubo, ...coord });
      continue;
    }
    const medidas = medidasVacias();
    acumular(medidas, previo);
    acumular(medidas, cubo);
    salida.set(k, { ...previo, ...medidas });
  }
  return [...salida.values()];
}

/**
 * Las fechas calendario CR del rango, ascendentes e inclusivas en ambos extremos. Se apoya
 * SOLO en `lib/utils/fecha-cr` (D7): ni un desplazamiento horario escrito a mano, ni
 * `startOfDayCR` (la trampa 18:00-18:00 documentada de `RankingService`).
 *
 * ⚠ 2026-08-31 — LA COTA DURA YA NO ES EL LITERAL `400`, y el cambio importa. Aquel numero se
 * escribio dando por supuesto que TODO rango cabia en `RANGO_TOPE_DIAS` (366): desde que el
 * canal por API key sirve el historico completo sin tope, un `400` no habria protegido de nada
 * —seguiria siendo finito— pero SI habria TRUNCADO en silencio la cobertura de un rango
 * legitimo mas largo, publicando como comparables dias que no lo son. La cota pasa a DERIVARSE
 * del propio rango: sigue impidiendo el bucle infinito de una fecha malformada (con `NaN` el
 * tope queda en 1 y el bucle muere en la primera vuelta) sin recortar nunca un rango bueno.
 */
function fechasDelRango(consulta: ConsultaAnalitica): readonly string[] {
  const { desdeFecha, hastaFecha } = consulta.rango;
  const tope = diasDelRango(desdeFecha, hastaFecha);
  const fechas: string[] = [];
  for (let f = desdeFecha; f <= hastaFecha; f = fechaCalendarioCR(inicioDelDiaSiguienteCREnUtc(f))) {
    fechas.push(f);
    if (fechas.length >= tope) break;
  }
  return fechas;
}

/**
 * Cuantos dias calendario hay entre las dos fechas contando AMBOS extremos, al menos 1. Solo se
 * usa como COTA del bucle de arriba, asi que se resuelve sobre medianoche UTC: aqui no se fija
 * ninguna frontera de dia de Costa Rica —eso es de `ranges.ts`— y un desfase de horas no puede
 * cambiar el resultado de una resta de fechas de ancho fijo.
 */
function diasDelRango(desdeFecha: string, hastaFecha: string): number {
  const a = Date.parse(`${desdeFecha}T00:00:00.000Z`);
  const b = Date.parse(`${hastaFecha}T00:00:00.000Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 1;
  return Math.max(1, Math.round((b - a) / 86_400_000) + 1);
}

/**
 * R17 de la 124, aplicado al intradia — reparte `primer_intento_ok` sobre los cubos.
 *
 * Se exporta (y no vive inline en el servicio) porque el test de equivalencia de **R33** tiene
 * que ejecutar EXACTAMENTE este reparto para comparar contra las filas que escribio el job. Si
 * el test lo reimplementara, R33 compararia dos implementaciones distintas de la 126 en vez de
 * comparar la 126 contra la 124, que es lo unico que contiene la duplicacion de D13.
 *
 * `intentos` viene del punto UNICO del repo (feature 160): aqui no se decide que es un
 * «intento». R14 de aquella feature: las ordenes sin intentos NO vienen en el `Map`.
 *
 * -----------------------------------------------------------------------------------------
 * DERIVA DECLARADA DE `primer_intento_ok` (feature 215 / R24, R35). Esta es la version VIVA del
 * KPI (dia en curso, sin pasar por el rollup). Se escribe aqui entera para que nadie concluya
 * que la viva y el rollup «se contradicen»: miden LO MISMO, con criterios de EPOCAS distintas.
 * El mismo aviso vive, autosuficiente, en `lib/analytics/metrics.ts` (la definicion) y en
 * `AnaliticaRollupService.contarPrimerIntento` (el que PERSISTE las filas).
 *
 * (1) CAMBIO DE CRITERIO, SIN RE-BACKFILL. Con la 215 el «intento previo» ya NO se deriva de los
 *     destinos de transicion del historial: sale de las gestiones que viven dentro de un cierre
 *     APROBADO. Esta ruta viva calcula SIEMPRE con el criterio vigente hoy; el historico ya
 *     escrito en `analytics_daily` NO se re-backfillea, y la metrica tampoco se redefine para
 *     dejar de depender del contador: el escalon de la serie se ASUME, deliberadamente (D15).
 *     Re-backfillear reescribiria meses de KPI ya reportados y ademas seria FALSO, porque los
 *     cierres de entonces no estaban aprobados EN EL MOMENTO de aquel calculo.
 *
 * (2) EL CORTE ES POR `updated_at`, NO POR `fecha`. Toda fila de `analytics_daily` cuyo
 *     `updated_at` sea ANTERIOR al despliegue de la 215 esta calculada con el criterio VIEJO;
 *     toda fila con `updated_at` posterior, con el NUEVO, SEA CUAL SEA SU `fecha`. Y con estas
 *     palabras: una fila de una fecha ANTERIOR al corte que se RECALCULA despues del corte pasa
 *     a estar calculada con el criterio NUEVO. Motivo: el job recalcula dias pasados (backfill) y
 *     el upsert refresca `updated_at` en cada recalculo (`AnaliticaRollupRepository.ts:434,453`),
 *     asi que el corte es por CUANDO SE CALCULO, no por QUE DIA MIDE. `updated_at` es una columna
 *     que YA existe (`db/migrations/20260731120000_analytics_daily/migration.sql:83`): no hace
 *     falta columna, tabla ni migracion nuevas (R35/R27), ni una constante `FECHA_CORTE_*` en
 *     codigo que habria que adivinar antes de desplegar o mantener despues.
 *
 * (3) EFECTO INTRADIA: PROPIEDAD NUEVA Y PERMANENTE, NO UN TRANSITORIO. Y es esta funcion la que
 *     lo produce a la vista: una entrega cuya orden tiene cierres SIN aprobar reporta 0 intentos
 *     previos, asi que cuenta como primer intento; el KPI SUBE durante el dia y BAJA al aprobarse
 *     los cierres. NO es un artefacto de la migracion de criterio y NO desaparece con la deriva
 *     declarada: es una propiedad nueva y permanente de la metrica bajo el criterio nuevo.
 *     Corolario: el mismo dia puede dar DOS valores distintos segun cuando se recalcule.
 *
 * LO QUE NO CAMBIA (R23 / R24-e): se sigue REMITIENDO al punto unico de conteo
 * (`OrdenHistorialService.contarIntentosEnLote`), sin `COUNT` propio, sin umbral propio y sin
 * columna materializada; y `primer_intento_ok <= entregas` se mantiene.
 * -----------------------------------------------------------------------------------------
 */
export function completarPrimerIntentoEnCubos(
  crudos: CubosDelDiaEnCurso,
  intentos: ReadonlyMap<string, number>,
): readonly CuboRollup[] {
  const primeras = crudos.entregasVigentes.filter((e) => (intentos.get(e.ordenId) ?? 0) === 0);
  if (primeras.length === 0) return crudos.cubos;

  const porClave = new Map<string, number>();
  for (const e of primeras) {
    const k = [e.zonaId, e.tiendaId, e.mensajeroId, e.estatusId].join("");
    porClave.set(k, (porClave.get(k) ?? 0) + 1);
  }
  return crudos.cubos.map((c) => {
    // La coordenada de `primer_intento_ok` es la de su ENTREGA, y las entregas viven en el
    // cubo de causa nula: solo ahi se suma (misma regla que la 124).
    if (c.causaDevolucion !== null) return c;
    const n = porClave.get([c.zonaId, c.tiendaId, c.mensajeroId ?? "", c.estatusId].join(""));
    return n === undefined ? c : { ...c, primerIntentoOk: c.primerIntentoOk + n };
  });
}
