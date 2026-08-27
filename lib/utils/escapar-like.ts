/**
 * Feature 285 (design §3.3) — escapa lo que `LIKE`/`ILIKE` interpreta como comodin.
 *
 * QUE HACE Y POR QUE IMPORTA. Prisma interpola el valor de `contains` dentro de `%valor%` sin
 * escaparlo. Sin esta funcion, buscar `"100%"` devolveria todo lo que empieza por `100`, `"_"`
 * casaria con cualquier caracter y —lo grave— `"%"` devolveria el LISTADO ENTERO. No es una
 * cuestion de precision: es una fuga del alcance del filtro.
 *
 * Se escapa con `\` porque es el caracter de escape POR DEFECTO de `LIKE` en Postgres, y el `\`
 * va PRIMERO en la clase de caracteres para que el propio backslash se duplique en la misma
 * pasada (si fuera el ultimo, se re-escaparia lo ya escapado).
 *
 * ⚠️ HAY DOS DECLARACIONES DE ESTO EN EL REPO, Y ES DELIBERADO, NO UN DESPISTE.
 * `lib/repositories/OrdenRepository.ts` conserva su copia PRIVADA de modulo (la de la feature
 * 169, que ademas sirve al SQL crudo de la bodega satelite y no se exporta). Unificarlas exigiria
 * editar el modulo de ordenes, y la ficha 285 lo prohibe explicitamente. La deuda es de una
 * linea y queda anotada aqui para quien pueda pagarla: cuando alguien tenga permiso para tocar
 * `OrdenRepository`, que importe esta funcion y borre su copia.
 *
 * Modulo PURO: sin React, sin Prisma, sin Next. Solo texto -> texto.
 */
export function escaparComodinesLike(valor: string): string {
  return valor.replace(/[\\%_]/g, (caracter) => `\\${caracter}`);
}
