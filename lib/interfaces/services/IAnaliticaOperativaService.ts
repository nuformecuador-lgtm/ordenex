import type { ConsultaAnalitica } from "@/lib/analytics/consulta";
import type { DimensionAnalitica } from "@/lib/analytics/types";
import type {
  AgregadoOperativo,
  GranoAgregado,
  SerieOperativa,
} from "@/lib/types/analitica-operativa";

// Feature 126 (T1.4, design §D2) — contrato del servicio de analitica operativa.
//
// D2 — FIRMA CANONICA: `consultar(consulta: ConsultaAnalitica)`. Y **solo** eso. Ninguna
// firma acepta `AnaliticaFiltroInput` ni `AlcanceDatos` sueltos (R4).
//
// El servicio NO conoce Next.js: ni `Request`, ni `Response`, ni `next/headers`, ni
// `cookies()`. Tampoco habla Prisma. Recibe los dos repositorios y el RELOJ por constructor
// (R31: mismo `now` inyectado => misma salida; ningun `new Date()` implicito dentro).

/**
 * Error de consulta operativa. R32 — nombra la ETAPA y la METRICA y NADA MAS: ni ids de
 * orden, ni guias, ni destinatarios, ni telefonos, ni el `where` con los ids del filtro y
 * del alcance. El `cause` conserva el error original para el log del servidor.
 */
export class AnaliticaOperativaError extends Error {
  constructor(
    readonly etapa: EtapaOperativa,
    readonly metricaId: string,
    cause?: unknown,
  ) {
    super(`analitica operativa: fallo en la etapa "${etapa}" de la metrica "${metricaId}"`);
    this.name = "AnaliticaOperativaError";
    this.cause = cause;
  }
}

/** Las etapas que un error puede nombrar. Dominio CERRADO: nada de texto libre. */
export const ETAPAS_OPERATIVAS = [
  "cubos_rollup",
  "cubos_intradia",
  "etiquetas_estatus",
  "primer_intento",
  "aging",
] as const;

export type EtapaOperativa = (typeof ETAPAS_OPERATIVAS)[number];

export interface IAnaliticaOperativaService {
  /**
   * Proyecta la metrica de `consulta` a su serie. Determinista con el reloj inyectado.
   *
   * `desagregacion` es OPCIONAL y solo elige la dimension del desglose (la 131 la elegira en
   * el tablero); sin ella se usa la del catalogo o ninguna. NO es un canal de alcance: el
   * recorte de filas viaja entero dentro de `consulta`, y por eso R24 puede denegar el
   * FILTRO por mensajero sin quitarle a nadie la VISTA desagregada por mensajero.
   */
  consultar(
    consulta: ConsultaAnalitica,
    desagregacion?: DimensionAnalitica,
  ): Promise<SerieOperativa>;

  /**
   * Feature 176 (D1) — LECTURA AGREGADA. Devuelve, por cubo temporal, el numerador y el
   * denominador ANTES de dividir, y el valor dividido UNA sola vez.
   *
   * No sustituye a `consultar` ni cambia su firma: son dos modos de lectura sobre los
   * MISMOS cubos del rollup, pedidos al MISMO metodo del repositorio con los MISMOS
   * granos. Esa identidad es lo que hace ESTRUCTURALMENTE cierto R8 (sobre un unico dia
   * cerrado los dos caminos coinciden) en vez de una coincidencia que haya que vigilar.
   *
   * Sigue sin haber canal de alcance: el recorte viaja entero dentro de `consulta`, igual
   * que en `consultar` (R13). `OpcionesAgregado` NO lleva filtro, ni rango, ni alcance.
   */
  consultarAgregado(
    consulta: ConsultaAnalitica,
    opciones?: OpcionesAgregado,
  ): Promise<AgregadoOperativo>;
}

/** Lo unico que el modo agregado admite ADEMAS de la consulta. Ni filtro, ni alcance. */
export interface OpcionesAgregado {
  /** R19/D6 — default `"periodo"`. */
  readonly grano?: GranoAgregado;
  /** Misma semantica que en `consultar`: elige el desglose, no el recorte. */
  readonly desagregacion?: DimensionAnalitica;
}
