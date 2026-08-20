import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, it, expect } from "vitest";

// Feature 248 — GUARDIA DE SIN MIGRACION / SIN CAMBIO DE ESQUEMA (T7.4, cubre R39).
//
// INVARIANTE QUE FIJA: el cotizador es **100 % lectura sobre lo que ya existe**. Resuelve el trio
// geografico y la zona del distrito contra `Distrito` / `ZonaDistrito` / `Zona` —tablas de la
// feature 24— y tarifa contra lo que la carga por API ya tarifa. No necesita almacenamiento propio:
// ni tabla de cotizaciones, ni columna de cobertura, ni enum nuevo, ni una sola migracion. Si
// apareciera cualquiera de esas cosas, la feature habria dejado de ser lo que su spec aprobo.
//
// ⛔ LO QUE ESTA GUARDIA NO HACE, Y ES DELIBERADO:
//
//   · no mira `git diff` contra `origin/dev`. Una guardia que mide el diff de una rama CADUCA en
//     cuanto la rama se mergea y pasa a juzgar cualquier rama posterior (leccion ya pagada:
//     `rastreo-sin-ruta-nueva.guardia.test.ts:22-26`). Aqui se mide la PROPIEDAD —que ningun
//     objeto de esquema ni ninguna migracion NOMBRE esta feature— y ninguna asercion depende de
//     la rama en la que se ejecute;
//   · no reconcilia `schema.prisma` contra las migraciones. Eso ya lo hace, y mejor,
//     `tests/integration/db/schema-drift-saneamiento.test.ts`. Duplicarlo aqui solo produciria dos
//     rojos por el mismo hecho. Esta guardia vigila el ALCANCE de la 248, no la salud del esquema.

const RAIZ = path.resolve(__dirname, "../../..");

/**
 * Como se nombraria esta feature si alguien le diera esquema propio. Se cubren las dos familias de
 * nombre que el spec usa —«cotiza…», que cubre `cotizador` / `cotizacion` / `cotizar` de una sola
 * pasada, y «cobertura», el dominio (`CoberturaService`, `CoberturaDistritoRepository`,
 * `cobertura-publica`)— y el numero de la ficha. Los tres tokens son disjuntos a proposito: asi la
 * lista que devuelve el detector se lee sin duplicados solapados.
 */
const CONCEPTOS = ["cotiza", "cobertura", "248"];

/* -------------------------------------------------------------------------- */
/* Censo: las carpetas de `db/migrations/`                                      */
/* -------------------------------------------------------------------------- */

const MIGRACIONES = readdirSync(path.join(RAIZ, "db", "migrations"), { withFileTypes: true })
  .filter((entrada) => entrada.isDirectory())
  .map((entrada) => entrada.name);

/**
 * El SLUG de una carpeta de migracion: lo que queda tras el sello de tiempo de 14 digitos.
 *
 * Se compara contra el slug y no contra el nombre entero A PROPOSITO: el sello lleva la hora al
 * segundo, asi que un `20260812124800_lo_que_sea` contiene «248» sin tener absolutamente nada que
 * ver con esta ficha. Buscar el numero en el nombre crudo convertiria esta guardia en una ruleta
 * que se pone roja sola dentro de unos meses, contra el trabajo de otro.
 */
function slugDe(carpeta: string): string {
  return carpeta.replace(/^\d{14}_/, "").toLowerCase();
}

/** Las carpetas de migracion cuyo slug nombra esta feature. */
function migracionesDeLaFeature(carpetas: readonly string[]): string[] {
  return carpetas.filter((carpeta) =>
    CONCEPTOS.some((concepto) => slugDe(carpeta).includes(concepto)),
  );
}

/* -------------------------------------------------------------------------- */
/* Censo: `db/schema.prisma`                                                    */
/* -------------------------------------------------------------------------- */

const SCHEMA = readFileSync(path.join(RAIZ, "db", "schema.prisma"), "utf8");

/** Los conceptos de la feature que aparecen nombrados en un esquema Prisma. */
function conceptosEnEsquema(schema: string): string[] {
  const minuscula = schema.toLowerCase();
  return CONCEPTOS.filter((concepto) => concepto !== "248" && minuscula.includes(concepto));
}

/** Los `model X` / `enum X` declarados por un esquema Prisma. */
function objetosDeclarados(schema: string): string[] {
  return [...schema.matchAll(/^\s*(?:model|enum)\s+(\w+)/gm)].map((m) => m[1]);
}

const OBJETOS = objetosDeclarados(SCHEMA);

/** Los modelos que el cotizador LEE. Sin ellos, «solo lee lo que ya existe» seria mentira. */
const MODELOS_QUE_LEE = ["Zona", "Distrito", "ZonaDistrito", "Canton", "Provincia"];

describe("R39 — la feature no añade migraciones", () => {
  it("CONTROL DE NO-VACUIDAD: el censo encuentra de verdad las carpetas de migracion", () => {
    // Sin esto, una ruta mal escrita o un filtro roto dejaria la lista vacia y la guardia pasaria
    // en verde sin haber mirado ni una migracion.
    expect(MIGRACIONES.length).toBeGreaterThan(100);
    expect(MIGRACIONES.every((carpeta) => /^\d{14}_/.test(carpeta))).toBe(true);
    // Y el troceador de slugs devuelve algo, no la cadena entera ni vacio.
    expect(slugDe(MIGRACIONES[0])).not.toBe("");
    expect(slugDe(MIGRACIONES[0])).not.toBe(MIGRACIONES[0]);
  });

  it("ninguna carpeta de `db/migrations/` corresponde a esta feature", () => {
    expect(
      migracionesDeLaFeature(MIGRACIONES),
      "la feature 248 añadio una migracion; R39 dice que solo lee",
    ).toEqual([]);
  });

  it("CONTRAPRUEBA: el detector caza una migracion de la feature, y no confunde el sello de tiempo", () => {
    const inventadas = [
      "20260821120000_cotizador_cache",
      "20260821130000_cobertura_distrito",
      "20260821140000_feature_248_tarifa_publica",
    ];
    expect(migracionesDeLaFeature(inventadas)).toEqual(inventadas);

    // Y el falso positivo que la acotacion por slug evita: «248» dentro de la hora.
    expect(migracionesDeLaFeature(["20260812124800_orden_retiro_ayuda"])).toEqual([]);
  });
});

describe("R39 — la feature no modifica `db/schema.prisma`", () => {
  it("CONTROL DE NO-VACUIDAD: el esquema tiene contenido y declara los modelos que el cotizador LEE", () => {
    // El cotizador es 100 % lectura: si estos modelos no estuvieran, «sin migracion» no seria una
    // virtud sino un agujero. Que existan es lo que hace cierto el requisito.
    expect(SCHEMA.length).toBeGreaterThan(1000);
    expect(OBJETOS.length).toBeGreaterThan(20);
    for (const modelo of MODELOS_QUE_LEE) {
      expect(OBJETOS, `el esquema ya no declara \`model ${modelo}\``).toContain(modelo);
    }
  });

  it("el esquema no gana ningun objeto ni columna de esta feature", () => {
    // Por NOMBRE, sobre el esquema entero: cubre a la vez el `model`/`enum` nuevo y la columna
    // suelta (`coberturaId`, `ultimaCotizacion`) que un `model` ya existente pudiera ganar.
    // El «248» se excluye de esta pasada: un numero de cuatro cifras dentro de un esquema de
    // 140 KB (una longitud `@db.VarChar(248)`, un default) no dice nada de esta feature.
    expect(
      conceptosEnEsquema(SCHEMA),
      "`db/schema.prisma` nombra la feature 248; R39 lo prohibe",
    ).toEqual([]);
  });

  it("CONTRAPRUEBA: el detector caza un modelo, un enum y una columna de la feature", () => {
    const conModelo = `${SCHEMA}\n\nmodel Cotizacion {\n  id String @id\n}\n`;
    expect(conceptosEnEsquema(conModelo)).toContain("cotiza");
    expect(objetosDeclarados(conModelo)).toContain("Cotizacion");

    const conEnum = `${SCHEMA}\n\nenum CoberturaEstado {\n  UNICA\n}\n`;
    expect(conceptosEnEsquema(conEnum)).toContain("cobertura");
    expect(objetosDeclarados(conEnum)).toContain("CoberturaEstado");

    // La columna suelta: ningun `model` nuevo, y aun asi el esquema cambia.
    const conColumna = SCHEMA.replace(
      "model Distrito {",
      "model Distrito {\n  coberturaCotizador Boolean @default(false)",
    );
    expect(objetosDeclarados(conColumna)).toEqual(OBJETOS);
    expect(conceptosEnEsquema(conColumna)).toEqual(["cotiza", "cobertura"]);
  });
});
