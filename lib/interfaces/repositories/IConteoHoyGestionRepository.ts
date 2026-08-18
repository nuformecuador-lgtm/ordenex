// El puerto de lectura del CONTADOR DE HOY. Contrato NEUTRAL: sin Prisma y sin Next, para que
// el servicio se ejercite entero sin `DATABASE_URL`.

import type { ConsultaConteoEntregas } from "@/lib/analytics/entregas-conteo";
import type { RangoResuelto } from "@/lib/analytics/types";

/** El reparto del dia tal como sale del repositorio. `total` NO viene aqui: es la suma de las
 *  dos cifras y la hace el servicio, de modo que no pueda discrepar de sus partes. */
export interface ConteoHoyCrudo {
  /** Cargadas del dia SIN ninguna gestion vigente. */
  readonly sinGestion: number;
  /** Cargadas del dia con AL MENOS UNA gestion vigente, del tipo que sea. */
  readonly conGestion: number;
}

export interface IConteoHoyGestionRepository {
  /**
   * Cuenta las ordenes CARGADAS en `dia` (por `orden.created_at`) y las reparte en dos: las que
   * ya tienen alguna gestion vigente y las que no.
   *
   * DOS PARAMETROS, y la separacion es el contrato:
   *
   *   - `consulta` aporta el ALCANCE y las facetas de recorte. Es la MISMA
   *     `ConsultaConteoEntregas` que las otras lecturas de la vertical —el filtro es identico a
   *     proposito— pero de ella se ignoran la VENTANA (`rango`) y el MENSAJERO;
   *   - `dia` es la ventana real, y viene YA RESUELTA desde el servicio
   *     (`resolverRango({ preset: "dia" }, now)`). Se pasa aparte en vez de leerla de la
   *     consulta porque no es un filtro del usuario: es el dia CR en curso, decidido por el
   *     reloj del servidor. Recibirlo como parametro es lo que mantiene al repositorio sin
   *     reloj propio y al servicio como unico dueno del «ahora».
   *
   * Las dos cifras salen de UNA sola consulta: es lo que hace que `total = suma` sea cierto por
   * construccion, y no una invariante que alguien tenga que recordar.
   */
  contarDeHoy(consulta: ConsultaConteoEntregas, dia: RangoResuelto): Promise<ConteoHoyCrudo>;
}
