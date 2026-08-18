// El puerto de lectura del conteo de entregas.
//
// Contrato NEUTRAL: sin Prisma y sin Next. El servicio depende de ESTA interfaz y de nada
// mas, que es lo que permite ejercer la cache y el sellado de `lastSync` en un test unitario
// sin `DATABASE_URL`.

import type { ConsultaConteoEntregas } from "@/lib/analytics/entregas-conteo";

/**
 * El reparto por desenlace tal como sale del repositorio.
 *
 * `total` NO viene aqui: es la suma de `porDesenlace` y la hace el servicio, de modo que no
 * pueda discrepar de sus partes. Los buckets con CERO ordenes si vienen, con su cero: a
 * diferencia del desglose por status —que omite los vacios porque tiene hasta veinte—, aqui
 * los seis segmentos son FIJOS y el anillo tiene que poder decir «devueltas: 0», que es una
 * respuesta y no una ausencia.
 */
export interface ConteoCrudo {
  /** Clave = un valor de `DESENLACES`, o `BUCKET_OTROS`. Las SEIS claves, siempre. */
  readonly porDesenlace: Readonly<Record<string, number>>;
}

export interface IConteoEntregasRepository {
  /**
   * Cuenta sobre las tablas VIVAS (no sobre `analytics_daily`), repartiendo cada orden en su
   * desenlace.
   *
   * El desenlace de una orden es el `resultado` de su ULTIMA gestion vigente y, si nunca se
   * gestiono, el `value` de su `order_status` — la MISMA regla que el desglose por status, y
   * por el mismo camino, para que los dos graficos de la pantalla no puedan discrepar.
   */
  contar(consulta: ConsultaConteoEntregas): Promise<ConteoCrudo>;
}
