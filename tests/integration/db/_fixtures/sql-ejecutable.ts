/**
 * FICHA 461 — el texto EJECUTABLE de un `.sql`: sin las lineas de comentario (`-- …`).
 *
 * Los tests que afirman «este archivo NO hace X» (ni `DELETE`, ni `CHECK`, ni toca `monto`) tienen que
 * mirar las sentencias y no la prosa: los comentarios de estas migraciones nombran a proposito lo que
 * no hacen. Mismo criterio que `soloEjecutable` en `wallet-tienda-cobro-migration.test.ts`.
 */
export function soloEjecutable(sql: string): string {
  return sql
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((linea) => !/^\s*--/.test(linea))
    .join("\n");
}
