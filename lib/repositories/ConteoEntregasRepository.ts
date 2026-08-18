// El reparto por DESENLACE del anillo: entregadas, devueltas, rechazadas, reprogramadas,
// incidentes y otros.
//
// ─── ESTE REPOSITORIO YA NO CONSULTA: PLIEGA ────────────────────────────────────────────
//
// Nacio con dos `count` sobre `orden` y `estatus.value = 'entregada'`. El 2026-08-18 el humano
// pidio abrir el lado «no entregadas» en los cuatro desenlaces reales, y eso obligo a cambiar
// la FUENTE, no solo el reparto:
//
//   una orden devuelta NO tiene `orden.estatus = "devuelta"`, tiene `devolviendo_a_tienda` o
//   `devuelta_a_tienda`.
//
// Con el estatus de la orden como discriminador, «devueltas» habria dado practicamente CERO y
// todo habria caido en «otros» — un grafico plausible y falso, que es el peor resultado
// posible. Los cinco nombres que se pidieron son los valores de `GestionResultado`, asi que
// tienen que salir de la GESTION.
//
// Y esa consulta ya existe: es la del desglose por status
// (`ConteoPorStatusRepository`, con su `LEFT JOIN LATERAL` sobre la ultima gestion vigente).
// Asi que este repositorio DELEGA en ella y pliega sus buckets en seis. Lo que se gana:
//
//   - UNA sola consulta y UNA sola semantica. Los dos graficos de la pantalla salen de la
//     misma fila de la base, asi que no pueden discrepar sobre cuantas entregadas hubo — que
//     es exactamente el defecto que tenian mientras cada uno leia su fuente;
//   - cero SQL duplicado. Todo el `where` —alcance, facetas, fecha efectiva— vive en un solo
//     sitio, y no hay dos implementaciones que puedan divergir;
//   - el anillo sigue siendo el resumen y el otro grafico el detalle: uno es literalmente el
//     pliegue del otro, y por tanto siempre suman lo mismo.

import {
  BUCKET_OTROS,
  DESENLACES,
} from "@/lib/types/conteo-entregas";
import type { ConsultaConteoEntregas } from "@/lib/analytics/entregas-conteo";
import type {
  ConteoCrudo,
  IConteoEntregasRepository,
} from "@/lib/interfaces/repositories/IConteoEntregasRepository";
import type { IConteoPorStatusRepository } from "@/lib/interfaces/repositories/IConteoPorStatusRepository";

/**
 * Los cinco desenlaces como conjunto, para clasificar en O(1). Se deriva de `DESENLACES` y no
 * se escribe otra lista: dos listas de nombres se separan la primera vez que alguien toque una.
 */
const NOMBRADOS: ReadonlySet<string> = new Set<string>(DESENLACES);

/**
 * Reparte los buckets del desglose por status en los SEIS del anillo. Funcion PURA y
 * exportada: es la unica decision de este archivo y se comprueba sin base de datos.
 *
 * Los seis buckets salen SIEMPRE, con cero donde no hubo nada. Es la diferencia con el
 * desglose por status —que omite los vacios porque tiene hasta veinte— y es deliberada: los
 * segmentos del anillo son fijos, y «devueltas: 0» es una respuesta, no una ausencia.
 *
 * Todo lo que no es uno de los cinco nombrados cae en «otros», SIN excepciones y sin lista
 * negra: un estatus nuevo del catalogo —o uno huerfano que el rollup tolere— entra ahi solo,
 * en vez de desaparecer de la cuenta y descuadrar el total.
 */
export function plegarEnDesenlaces(
  porStatus: readonly { readonly status: string; readonly conteo: number }[],
): Record<string, number> {
  const salida: Record<string, number> = { [BUCKET_OTROS]: 0 };
  for (const desenlace of DESENLACES) salida[desenlace] = 0;

  for (const fila of porStatus) {
    const clave = NOMBRADOS.has(fila.status) ? fila.status : BUCKET_OTROS;
    salida[clave] = (salida[clave] ?? 0) + fila.conteo;
  }

  return salida;
}

export class ConteoEntregasRepository implements IConteoEntregasRepository {
  constructor(private readonly porStatus: IConteoPorStatusRepository) {}

  async contar(consulta: ConsultaConteoEntregas): Promise<ConteoCrudo> {
    console.log('xyz query params', consulta);

    const filas = await this.porStatus.contarPorStatus(consulta);
    const porDesenlace = plegarEnDesenlaces(filas);

    console.log('xyz query', porDesenlace);

    return { porDesenlace };
  }
}
