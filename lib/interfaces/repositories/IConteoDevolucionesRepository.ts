// El puerto de lectura del desglose de devoluciones por causa.
//
// Contrato NEUTRAL: sin Prisma y sin Next.

import type { ConsultaConteoEntregas } from "@/lib/analytics/entregas-conteo";

/** Una causa CRUDA —el valor del enum, o el centinela de las que no la traen— y su conteo. */
export interface CausaCruda {
  readonly causa: string;
  readonly conteo: number;
}

export interface IConteoDevolucionesRepository {
  /**
   * Cuenta GESTIONES vigentes con `resultado = 'devuelta'`, agrupadas por `causa_devolucion`.
   *
   * Devuelve la causa SIN TRADUCIR: el repositorio lee, no rotula. La traduccion la aplica el
   * servicio con `MOTIVO_DE_CAUSA`, de modo que se pueda comprobar sin base de datos y que un
   * segundo consumidor —un CSV, un correo— no tenga que repetirla.
   *
   * Solo las causas con al menos una gestion, de mayor a menor conteo. El `total` no se pide
   * aqui: es la suma de estas filas y la hace el servicio, para que no discrepe de sus partes.
   */
  contarDevolucionesPorCausa(consulta: ConsultaConteoEntregas): Promise<readonly CausaCruda[]>;
}
