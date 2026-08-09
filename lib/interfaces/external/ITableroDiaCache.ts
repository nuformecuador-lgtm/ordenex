// Feature 192 (B9.1, design.md §5.quater) — EL PUERTO DE CACHE DEL TABLERO.
//
// Contrato NEUTRAL: sin Next, sin Prisma y sin `process.env`. Sus adaptadores son
// `lib/cache/next-tablero-dia-cache.ts` (produccion), `lib/cache/tablero-dia-cache-nula.ts`
// (pass-through) y `lib/cache/tablero-dia-cache-memoria.ts` (tests, con reloj inyectado).
//
// ⛔ UN SOLO METODO, Y LA AUSENCIA DEL SEGUNDO ES EL REQUISITO (R71). No hay `invalidar`, no
// hay `tags` y no hay `revalidateTag`: la entrada expira UNICAMENTE por tiempo. Lo que no
// existe no se puede colgar de la escritura de una orden, de una gestion ni del historial, y
// por eso el comportamiento es auditable y los tests deterministas.
//
// Tampoco se reutiliza `IAnaliticaCache`: arrastra `tags` + `invalidar(origen, tags)`, es
// decir toda la maquinaria que R71 prohibe, y meteria las entradas de esta feature en el
// espacio de tags de la analitica, que es justo lo que R38 separa (alternativa 18).
//
// ⚠ La CLAVE que se le pasa es una frontera multi-tenant, no un detalle de rendimiento: la
// construye `claveDeTablero` en el servicio a partir del ALCANCE YA RESUELTO (R67). Una
// clave mal formada no rompe: responde rapido y con los datos de otro inquilino.

export interface ITableroDiaCache {
  /**
   * Devuelve el valor cacheado bajo `clave` o ejecuta `producir`, lo guarda y lo devuelve.
   *
   * `T` DEBE ser JSON-safe: el adaptador de produccion serializa con `JSON.stringify`. Por eso
   * el repositorio convierte los `COUNT` (`bigint`) a `number` antes de llegar aqui: un
   * `bigint` no degrada, LANZA.
   */
  envolver<T>(clave: string, producir: () => Promise<T>): Promise<T>;
}
