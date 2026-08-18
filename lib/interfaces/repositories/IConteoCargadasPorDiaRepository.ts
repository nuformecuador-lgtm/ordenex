// El puerto de lectura de las ordenes CARGADAS POR DIA. Contrato NEUTRAL: sin Prisma y sin
// Next, para que el servicio se ejercite entero sin `DATABASE_URL`.

import type { ConsultaConteoEntregas } from "@/lib/analytics/entregas-conteo";
import type { ConteoDeDia } from "@/lib/types/conteo-cargadas";

export interface IConteoCargadasPorDiaRepository {
  /**
   * Cuenta ordenes agrupadas por DIA DE CARGA sobre las tablas VIVAS (no sobre
   * `analytics_daily`).
   *
   * Recibe la MISMA `ConsultaConteoEntregas` que el anillo de desenlaces y el desglose por
   * status — y eso es el punto: las tres lecturas comparten filtro, alcance y ventana, asi que
   * la barra de filtros de la pantalla las mueve a las tres a la vez y ninguna puede quedarse
   * mirando un recorte distinto. Lo unico que cambia es COMO se agrupa lo que ya esta
   * recortado.
   *
   * Tres diferencias con las otras dos, todas deliberadas y todas consecuencia de que aqui la
   * pregunta es «cuando ENTRO la orden»:
   *
   *   1. el bucket sale de `orden.created_at`, no del `resultado` de la ultima gestion —esta
   *      consulta no necesita el `LEFT JOIN LATERAL` y no lo hace—;
   *   2. la VENTANA tambien se aplica sobre `orden.created_at`, no sobre la fecha efectiva
   *      `COALESCE(ultima gestion, created_at)`. Filtrar por fecha efectiva y agrupar por
   *      fecha de carga daria una serie con dias fuera del rango pedido, que es un grafico
   *      plausible y falso;
   *   3. **la faceta `mensajero_id` NO se aplica.** Es la unica de las seis dimensiones del
   *      filtro que esta lectura ignora, y es una decision, no un olvido: una orden no la carga
   *      un mensajero, asi que recortar por el contestaria «de las cargadas ese dia, cuantas
   *      acabo tocando este mensajero» — otra pregunta, con forma de curva de carga. La
   *      consecuencia la tiene que decir la pantalla: con un mensajero seleccionado, esta serie
   *      no se recorta y las otras dos si.
   *
   * Devuelve SOLO los dias con al menos una orden, en orden cronologico ASCENDENTE. El `total`
   * no se pide aqui: es la suma de estas filas y la hace el servicio, de modo que no pueda
   * discrepar de sus partes.
   */
  contarCargadasPorDia(consulta: ConsultaConteoEntregas): Promise<readonly ConteoDeDia[]>;
}
