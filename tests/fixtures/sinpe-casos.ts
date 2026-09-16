/**
 * ⭑ FICHA 429 (T1/T4, R7/R9) — LA TABLA DE CASOS DEL FORMATO DEL SINPE, ESCRITA UNA SOLA VEZ.
 *
 * ⚠️ POR QUE VIVE AQUI Y NO DENTRO DE UN `.test.ts`. La misma tabla se corre contra DOS jueces
 * distintos que tienen que dar el MISMO veredicto:
 *   · el validador de la aplicacion (`lib/utils/sinpe-cr.ts`) → `tests/unit/utils/sinpe-cr.test.ts`
 *   · el `CHECK` de Postgres (`zona_sinpe_numero_check`) → `tests/integration/db/zona-sinpe-migration.test.ts`
 *
 * Esa es la unica defensa contra la divergencia de las dos fuentes del formato, que es el precio
 * declarado de tener la regla en la base Y en zod. Si la tabla se escribiera dos veces, relajar
 * una de las dos pasaria en verde — y la mitad de las escrituras de este repo (seeds, `scripts/`,
 * el MCP de Supabase contra produccion) entra por debajo de zod.
 *
 * ⚠️ NINGUN NUMERO DE AQUI ES REAL. El repositorio es PUBLICO y `git` conserva la historia: un
 * SINPE de verdad escrito en un archivo versionado queda publicado para siempre. Los validos son
 * de las series `6…`/`7…`/`8…` con relleno obvio.
 */

/** Un caso de la tabla: la entrada tal cual la teclea una persona, y su veredicto. */
export interface CasoSinpe {
  /** Lo que llega. Puede traer separadores o prefijo de pais (R9). */
  entrada: string;
  /**
   * `null` = se rechaza. Si no, los OCHO digitos con los que tiene que quedarse guardado.
   * Un caso valido cuyo `normalizado` no sea `entrada` es un caso de NORMALIZACION (R9).
   */
  normalizado: string | null;
  /** Por que esta en la tabla. Un caso sin motivo escrito no se puede revisar. */
  motivo: string;
}

/**
 * LOS CASOS. La primera mitad sale literal de R7; la segunda, de R9.
 *
 * ⚠️ `812345678` y `9123456` no son erratas: son el digito de mas y el de menos, que son los dos
 * errores que de verdad comete una persona tecleando un telefono.
 */
export const CASOS_SINPE: readonly CasoSinpe[] = [
  // --- validos (R7) ---
  { entrada: "61234567", normalizado: "61234567", motivo: "movil valido, serie 6" },
  { entrada: "71234567", normalizado: "71234567", motivo: "movil valido, serie 7" },
  { entrada: "81234567", normalizado: "81234567", motivo: "movil valido, serie 8" },
  {
    entrada: "80000000",
    normalizado: "80000000",
    motivo: "el valor ficticio que usan los tests de esta ficha: tiene que ser valido",
  },
  // --- invalidos (R7/R8) ---
  {
    entrada: "12345678",
    normalizado: null,
    motivo: "ocho digitos pero empieza por 1: no es una linea movil de Costa Rica",
  },
  {
    entrada: "22345678",
    normalizado: null,
    motivo: "un FIJO (serie 2): SINPE Movil no funciona sobre un fijo",
  },
  { entrada: "9123456", normalizado: null, motivo: "siete digitos: falta uno" },
  { entrada: "812345678", normalizado: null, motivo: "nueve digitos: sobra uno" },
  { entrada: "8123456a", normalizado: null, motivo: "una letra: no son ocho digitos" },
  { entrada: "", normalizado: null, motivo: "vacio" },
  { entrada: "   ", normalizado: null, motivo: "solo espacios: vacio con disfraz" },
  // --- normalizacion (R9) ---
  { entrada: "8888 1111", normalizado: "88881111", motivo: "espacio de separacion" },
  { entrada: "8888-1111", normalizado: "88881111", motivo: "guion de separacion" },
  { entrada: "+506 88881111", normalizado: "88881111", motivo: "prefijo de pais con +" },
  { entrada: "50688881111", normalizado: "88881111", motivo: "prefijo de pais pegado" },
  {
    entrada: "50612345",
    normalizado: null,
    motivo:
      "⚠️ OCHO DIGITOS QUE EMPIEZAN POR `506`. Se rechaza por el PRIMER digito (5 no es serie " +
      "movil), y eso es lo correcto. Lo que NO puede pasar es que la normalizacion le quite el " +
      "prefijo y lo convierta en `12345` en silencio: entonces el motivo del rechazo seria la " +
      "longitud y el dato original habria desaparecido. Se comprueba aparte, en `sinpe-cr.test.ts`.",
  },
];

/** Los que la base y el validador tienen que ACEPTAR, ya normalizados. */
export const SINPE_VALIDOS: readonly string[] = CASOS_SINPE.filter(
  (c) => c.normalizado !== null,
).map((c) => c.normalizado as string);

/** Los que la base tiene que RECHAZAR tal cual llegan (no hay normalizacion que los salve). */
export const SINPE_INVALIDOS: readonly string[] = CASOS_SINPE.filter(
  (c) => c.normalizado === null,
).map((c) => c.entrada);
