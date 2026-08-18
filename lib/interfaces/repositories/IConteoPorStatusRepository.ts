// El puerto de lectura del desglose por status. Contrato NEUTRAL: sin Prisma y sin Next.

import type { ConsultaConteoEntregas } from "@/lib/analytics/entregas-conteo";
import type { ConteoDeStatus } from "@/lib/types/conteo-por-status";

export interface IConteoPorStatusRepository {
  /**
   * Cuenta ordenes agrupadas por status sobre las tablas VIVAS.
   *
   * Devuelve SOLO los buckets con al menos una orden, de mayor a menor conteo. El `total` no
   * se pide aqui: es la suma de estas filas y la hace el servicio, de modo que no pueda
   * discrepar de sus partes.
   *
   * Recibe la MISMA `ConsultaConteoEntregas` que el conteo entregadas/no entregadas: los dos
   * endpoints comparten filtro, alcance y ventana a proposito. Lo unico que cambia es como se
   * agrupa lo que ya esta recortado.
   */
  contarPorStatus(consulta: ConsultaConteoEntregas): Promise<readonly ConteoDeStatus[]>;
}
