// El DTO del conteo de ORDENES CARGADAS POR DIA y el resultado de su Server Action.
//
// Tipos PUROS: sin Prisma, sin zod, sin React. Los consumen el servicio, la accion y el
// componente, y por eso no viven en ninguno de los tres. Gemelos de
// `lib/types/conteo-por-status.ts`, con la unica diferencia que importa: aqui el eje es el
// TIEMPO, no el desenlace.

/** Un dia calendario de Costa Rica y cuantas ordenes se cargaron en el. */
export interface ConteoDeDia {
  /**
   * Fecha calendario de Costa Rica, `YYYY-MM-DD`.
   *
   * CALENDARIO y no instante, igual que las fechas que acepta el filtro: el consumidor pinta
   * un eje de dias, y un `Date` obligaria a cada uno a volver a decidir en que huso se lee —
   * que es exactamente como se reintroduce el off-by-one de seis horas del que avisa
   * `lib/analytics/ranges.ts`.
   */
  readonly fecha: string;
  /** Ordenes cargadas ese dia. Siempre >= 1: los dias sin ninguna NO viajan (ver el DTO). */
  readonly conteo: number;
}

/**
 * La serie completa, con su sello de frescura.
 *
 * ⚠ QUE SIGNIFICA «CARGADA», que es la unica decision semantica de esta vertical: la orden
 * entra en el dia de su `orden.created_at`, o sea el dia en que se CARGO en el sistema. NO es
 * la «fecha efectiva» de las otras dos lecturas de esta vertical —aquellas usan
 * `COALESCE(ultima gestion vigente, orden.created_at)`, es decir el dia en que PASO algo con
 * la orden—. Son dos preguntas distintas y dan cifras distintas a proposito: una orden cargada
 * el lunes y entregada el viernes cuenta aqui el lunes y alli el viernes.
 *
 * ⚠ Y POR LA MISMA RAZON, ESTA SERIE NO ADMITE EL FILTRO POR MENSAJERO. Acepta la misma
 * `ConsultaConteoEntregas` que las otras dos —mismo filtro, misma barra— pero de sus seis
 * dimensiones ignora `mensajero_id`: una orden no la carga un mensajero. Con un mensajero
 * seleccionado, esta serie sigue contando TODAS las cargas del recorte mientras las otras dos
 * se recortan, asi que la pantalla tiene que decirlo — si no, se leen tres graficos suponiendo
 * que los tres responden a lo mismo.
 *
 * **Los dias con CERO ordenes NO aparecen**, mismo criterio que `ConteoPorStatusDTO`. Quien
 * consuma esto tiene que saberlo: un hueco significa cero, no «no se pudo medir». No se
 * rellenan aqui porque la consulta puede venir SIN ventana (`rango: null`, decision del
 * 2026-08-18), y entonces no existe el conjunto de dias que habria que rellenar: rellenar solo
 * a veces seria peor que no rellenar nunca, porque el consumidor no podria confiar en ninguno
 * de los dos casos. Si la grafica necesita el eje continuo, lo construye a partir de la
 * ventana que ELLA pidio, que es la unica que lo conoce siempre.
 *
 * Orden CRONOLOGICO ASCENDENTE, y eso es contrato: una serie temporal desordenada se pinta
 * mal sin que nada falle.
 */
export interface ConteoCargadasPorDiaDTO {
  /** Un elemento por dia CON ordenes, de la fecha mas antigua a la mas reciente. */
  readonly porDia: readonly ConteoDeDia[];
  /** Suma de todos los `conteo`. El universo entero del recorte. */
  readonly total: number;
  /**
   * Instante ISO-8601 UTC en que estas cifras se leyeron DE LA BASE — no en que se sirvieron.
   * Con la cache caliente dos peticiones separadas por diez minutos devuelven el MISMO
   * `lastSync`. Ver `ConteoEntregasDTO`.
   */
  readonly lastSync: string;
}

/** Lo que devuelve la Server Action. Discriminado, como el resto del repo: nunca `ok` con una
 *  serie vacia ante un denegado — «prohibido» y «no se cargo nada» son dos hechos distintos. */
export type ResultadoConteoCargadasPorDia =
  | { readonly status: "ok"; readonly datos: ConteoCargadasPorDiaDTO }
  | { readonly status: "unauthenticated" }
  | { readonly status: "forbidden" }
  | { readonly status: "validation_error"; readonly fieldErrors: Record<string, string[]> };
