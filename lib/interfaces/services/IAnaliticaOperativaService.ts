import type { ConsultaAnalitica } from "@/lib/analytics/consulta";
import type { SerieOperativa } from "@/lib/types/analitica-operativa";

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
  /** Proyecta la metrica de `consulta` a su serie. Determinista con el reloj inyectado. */
  consultar(consulta: ConsultaAnalitica): Promise<SerieOperativa>;
}
