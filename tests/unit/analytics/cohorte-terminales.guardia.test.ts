import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

import { quitarComentarios } from "../../fixtures/sin-comentarios";
import { ESTADOS_TERMINALES } from "@/lib/types/order-status-transiciones";

// Ficha 411 / T2.4 — GUARDIA de R8: LA COHORTE NO DECLARA UNA SEGUNDA LISTA DE TERMINALES.
//
// POR QUE ESTE CENSO Y NO OTRA COSA. `TERMINALES` ya esta rendido a SQL dos veces en el repo
// —`AnaliticaOperativaVivaRepository` y `CicloVidaRepository`, las dos con la MISMA linea
// `Prisma.join([...ESTADOS_TERMINALES])`— y las dos son PRIVADAS de su modulo. El repositorio de
// esta ficha rinde la misma constante con la misma linea en vez de importar la de un vecino,
// porque cruzar hacia aquellos modulos lo metería en censos de otra vertical.
//
// Lo que impide que ese parecido degenere en una TERCERA lista NO es la disciplina de quien
// escriba manana: es este censo. Si alguien escribe los `value` a mano —«total, son tres»— el
// dia que el dominio de de alta un cuarto estado terminal la cohorte se quedaria clasificandolo
// como `viva` mientras las otras dos lecturas ya lo cuentan como cerrado. Nadie lo veria: la
// tabla seguiria sumando y los porcentajes seguirian pareciendo razonables.
//
// El censo mira SOLO EL CODIGO (se retiran comentarios antes de buscar): la cabecera del
// repositorio esta obligada a explicar de donde salen los terminales, y censar el texto crudo
// convertiria esa explicacion en una violacion. Nombrar la lista es obligatorio; escribirla a
// mano es lo prohibido.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const REPOSITORIO = "lib/repositories/CohorteCargaRepository.ts";

function leer(rel: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, ...rel.split("/")), "utf8");
}

/**
 * Los `value` terminales escritos a mano en el codigo (fuera de comentarios).
 *
 * La lista contra la que se busca se DERIVA de `ESTADOS_TERMINALES`: si manana entra un cuarto,
 * el censo lo vigila solo, sin que nadie tenga que acordarse de anadirlo aqui.
 */
export function literalesTerminalesEscritos(fuente: string): string[] {
  const codigo = quitarComentarios(fuente);
  return ESTADOS_TERMINALES.filter((valor) =>
    new RegExp(`["'\`]${valor}["'\`]`).test(codigo),
  );
}

/** `true` si el archivo IMPORTA la fuente de verdad del dominio. */
export function importaLosTerminales(fuente: string): boolean {
  const codigo = quitarComentarios(fuente);
  return /import\s+\{[^}]*\bESTADOS_TERMINALES\b[^}]*\}\s+from\s+["']@\/lib\/types\/order-status-transiciones["']/.test(
    codigo,
  );
}

describe("R8 · el repositorio de la cohorte no escribe los terminales, los importa", () => {
  it("el archivo censado existe (si no, el guardia estaria verde por vacio)", () => {
    expect(
      fs.existsSync(path.join(REPO_ROOT, ...REPOSITORIO.split("/"))),
      `${REPOSITORIO} no existe: el censo no estaria mirando nada`,
    ).toBe(true);
  });

  it("no contiene ninguno de los `value` terminales como literal", () => {
    const escritos = literalesTerminalesEscritos(leer(REPOSITORIO));

    expect(
      escritos,
      "el repositorio de la cohorte escribe a mano " +
        escritos.join(", ") +
        ": eso es una SEGUNDA lista de terminales. Importa `ESTADOS_TERMINALES` y rindela con " +
        "`Prisma.join([...ESTADOS_TERMINALES])`, como los otros dos repositorios.",
    ).toEqual([]);
  });

  it("SI importa `ESTADOS_TERMINALES` del dominio", () => {
    // La otra mitad, y sin ella el caso de arriba se pasaria con un repositorio que no
    // clasificara por terminales en absoluto.
    expect(importaLosTerminales(leer(REPOSITORIO))).toBe(true);
  });

  it("la lista que se vigila no esta vacia y son los tres terminales de hoy", () => {
    // ANTI-VACIO. Si `ESTADOS_TERMINALES` quedara vacia —o el import de este test se rompiera—
    // el censo de arriba pasaria sin buscar nada. Este literal escrito A MANO es el contrato del
    // dominio hoy; si entra un cuarto terminal, este caso obliga a mirarlo a conciencia.
    expect([...ESTADOS_TERMINALES]).toEqual(["entregada", "devuelta_a_tienda", "incidente"]);
  });
});

describe("R8 · autocomprobacion: el detector muerde", () => {
  // Sin estos dos, el censo estaria verde por construccion y nadie sabria si funciona.
  const INFRACTOR = `
import { Prisma } from "@prisma/client";
const TERMINALES = Prisma.join(["entregada", "devuelta_a_tienda", "incidente"]);
export const x = TERMINALES;
`;

  const LEGITIMO = `
import { Prisma } from "@prisma/client";
import { ESTADOS_TERMINALES } from "@/lib/types/order-status-transiciones";
const TERMINALES = Prisma.join([...ESTADOS_TERMINALES]);
export const x = TERMINALES;
`;

  it("cae el que escribe la lista a mano", () => {
    expect(literalesTerminalesEscritos(INFRACTOR)).toEqual([
      "entregada",
      "devuelta_a_tienda",
      "incidente",
    ]);
    expect(importaLosTerminales(INFRACTOR)).toBe(false);
  });

  it("pasa el que la deriva del dominio", () => {
    expect(literalesTerminalesEscritos(LEGITIMO)).toEqual([]);
    expect(importaLosTerminales(LEGITIMO)).toBe(true);
  });

  it("basta UNO de los tres para caer: no hace falta escribirlos todos", () => {
    const uno = `const TERMINALES = ["incidente"];`;
    expect(literalesTerminalesEscritos(uno)).toEqual(["incidente"]);
  });

  it("no se deja enganar por una mencion en un comentario", () => {
    // La direccion que impide que el guardia sea ruido: la cabecera del repositorio TIENE que
    // poder explicar que clasifica por `entregada` / `devuelta_a_tienda` / `incidente`.
    const comentado = `
// los cubos son "entregada", "devuelta_a_tienda" e "incidente", mas las vivas
import { ESTADOS_TERMINALES } from "@/lib/types/order-status-transiciones";
const TERMINALES = [...ESTADOS_TERMINALES];
export const x = TERMINALES;
`;
    expect(literalesTerminalesEscritos(comentado)).toEqual([]);
    expect(importaLosTerminales(comentado)).toBe(true);
  });
});
