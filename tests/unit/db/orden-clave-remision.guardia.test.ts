import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * FICHA 423 — COBERTURA ESTATICA DE LA COLUMNA GENERADA `orden.clave_remision`.
 *
 * Este archivo NO demuestra que el orden funcione: eso lo hace
 * `tests/integration/db/orden-orden-remision-natural.test.ts` contra Postgres de verdad, que es
 * donde vive el riesgo. Lo que se ancla AQUI es lo que ninguna base puede contar, porque son
 * propiedades del TEXTO de la migracion y del modelo:
 *
 *   · que la columna siga siendo `GENERATED ALWAYS … STORED` y siga llevando `COLLATE "C"`;
 *   · que la expresion NO gane nunca un cast a numero ni una clase de caracteres dependiente de
 *     la collation — los dos unicos modos conocidos de romper R5 y R6;
 *   · que el indice siga siendo PARCIAL;
 *   · que revertir no toque ni una fila (R19);
 *   · que el `model Orden` siga EXPLICANDO donde vive lo que Prisma no sabe expresar.
 *
 * POR QUE ES NECESARIO, y no es paranoia. Los dos defectos que vigila son MUDOS:
 *   (a) sin `COLLATE "C"`, el orden depende de la collation por defecto de cada base — local
 *       (msvc) y Supabase (glibc) darian ordenes distintos y NADA fallaria;
 *   (b) con un `::bigint` en la expresion, la columna LANZA al evaluar una remision rara, y como
 *       se evalua en el `INSERT`, lo que se cae no es el orden: es la creacion de ordenes y el
 *       lote entero de una carga masiva.
 * Ninguno de los dos rompe el build ni un test funcional el dia que se introduce.
 *
 * Molde: `tests/unit/db/orden-num-remision-parcial.test.ts` (feature 294).
 */

const RAIZ = resolve(__dirname, "../../..");
const MIGRACIONES = resolve(RAIZ, "db/migrations");
const NOMBRE = "20260916120000_orden_clave_remision";
const DIR = resolve(MIGRACIONES, NOMBRE);
const SCHEMA = readFileSync(resolve(RAIZ, "db/schema.prisma"), "utf8");

/**
 * El SQL EJECUTABLE de un archivo de la migracion: sin comentarios ni lineas en blanco.
 *
 * Esto no es cosmetica, es la diferencia entre medir y no medir. La cabecera de `migration.sql`
 * NOMBRA A PROPOSITO lo que el codigo tiene prohibido —`::bigint`, `to_char`, `[0-9]`— para
 * explicar por que no estan. Un barrido sobre el texto crudo denunciaria la EXPLICACION y
 * obligaria a borrarla para pasar el guardia (memoria del repo, feature 209).
 */
function sql(archivo: "migration.sql" | "down.sql"): string {
  return readFileSync(resolve(DIR, archivo), "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("--"))
    .join("\n");
}

/** Cuerpo del `model Orden { ... }` de schema.prisma, comentarios incluidos. */
function modeloOrden(): string {
  const m = SCHEMA.match(/^model\s+Orden\s*\{\n([\s\S]*?)\n\}/m);
  if (!m) throw new Error("No se encontro el model Orden en schema.prisma");
  return m[1];
}

describe("migration.sql — la columna generada", () => {
  it("el archivo existe y tiene SQL ejecutable (si no, todo lo de abajo pasaria por vacio)", () => {
    // Contrapeso. Sin este caso, un `migration.sql` borrado o vaciado dejaria verdes los `not
    // toMatch` de mas abajo, que es la forma en que una guardia negativa miente.
    expect(sql("migration.sql").length).toBeGreaterThan(200);
    expect(sql("down.sql").length).toBeGreaterThan(20);
  });

  it("declara `clave_remision` como GENERATED ALWAYS … STORED", () => {
    const s = sql("migration.sql");
    expect(s).toMatch(/ADD COLUMN\s+"clave_remision"\s+text/);
    expect(s).toMatch(/GENERATED ALWAYS AS\s*\(/);
    expect(s).toMatch(/\)\s*STORED;/);
  });

  it("la columna lleva `COLLATE \"C\"` — el candado de R6", () => {
    // Sin el, la comparacion la decide la collation por defecto de CADA base. Local y Supabase
    // no son el mismo build de Postgres: el orden podria diferir y nada se pondria rojo.
    expect(sql("migration.sql")).toMatch(/"clave_remision"\s+text\s+COLLATE\s+"C"/);
  });

  it("NO contiene ningun cast a numero (R5: la expresion no puede lanzar)", () => {
    // `'NA-'::bigint` lanza «invalid input syntax for type bigint», y como la columna se evalua
    // en el `INSERT`, eso BLOQUEA la creacion de ordenes. `to_char` ademas es STABLE y Postgres
    // ni siquiera aceptaria la columna.
    const s = sql("migration.sql");
    for (const prohibido of [
      /::\s*int/i,
      /::\s*bigint/i,
      /::\s*numeric/i,
      /::\s*decimal/i,
      /::\s*float/i,
      /\bto_number\s*\(/i,
      /\bto_char\s*\(/i,
      /\bcast\s*\(/i,
    ]) {
      expect(s, `la expresion gano ${String(prohibido)}`).not.toMatch(prohibido);
    }
  });

  it("NO usa rangos ni clases dependientes de la collation (R6)", () => {
    // La documentacion de Postgres advierte de que un RANGO dentro de una expresion regular es
    // sensible a la collation. Misma desviacion deliberada que `20260731160000` escribio para
    // `[ \t\n\r\f\v]` en vez de `\s`. Las clases van ENUMERADAS: `[0123456789]`, no `[0-9]`.
    const s = sql("migration.sql");
    for (const prohibido of [/\[0-9\]/, /\[a-z\]/i, /\[A-Z\]/, /\\d/, /\[\[:alnum:\]\]/, /\\s/]) {
      expect(s, `la expresion gano ${String(prohibido)}`).not.toMatch(prohibido);
    }
    // Y lo que SI tiene que estar: las dos clases escritas a mano.
    expect(s).toContain("[0123456789]");
    expect(s).toContain("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789");
  });

  it("rellena con `lpad` a 18 y no declara la columna NOT NULL", () => {
    const s = sql("migration.sql");
    expect(s).toMatch(/lpad\(/);
    expect(s).toMatch(/18,\s*'0'\)/);
    // NOT NULL seria drift: Prisma la declara `String?` (no sabe expresar columnas generadas).
    expect(s).not.toMatch(/"clave_remision"[\s\S]*?NOT NULL/);
  });

  it("crea el indice PARCIAL, con el prefijo exacto del `ORDER BY` del listado", () => {
    const s = sql("migration.sql");
    expect(s).toMatch(
      /CREATE INDEX\s+"orden_prioridad_clave_remision_idx"\s+ON "orden" \("prioridad" DESC, "clave_remision" ASC, "id" ASC\)\s+WHERE "deleted_at" IS NULL;/,
    );
  });

  it("no mueve ni una fila: cero INSERT/UPDATE/DELETE", () => {
    // La clave es DERIVADA. Una migracion que "resuelva" remisiones a mano es justo lo que este
    // repo no hace: el arreglo es la columna, no reescribir el dato de la tienda.
    expect(sql("migration.sql")).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
  });

  it("no toca `num_remision` ni `busqueda_texto`", () => {
    const s = sql("migration.sql");
    // `num_remision` SI se nombra (es la fuente de la expresion), pero nunca como objetivo de un
    // ALTER COLUMN ni de un DROP.
    expect(s).not.toMatch(/ALTER COLUMN\s+"num_remision"/i);
    expect(s).not.toMatch(/DROP COLUMN\s+"num_remision"/i);
    expect(s).not.toMatch(/busqueda_texto/i);
  });
});

describe("down.sql — reversible sin perder dato de negocio (R19)", () => {
  it("suelta el INDICE antes que la COLUMNA", () => {
    // Al reves, `DROP COLUMN` arrastraria el indice por dependencia y la primera sentencia
    // estaria mintiendo sobre lo que hace.
    const s = sql("down.sql");
    expect(s).toContain('DROP INDEX IF EXISTS "orden_prioridad_clave_remision_idx";');
    expect(s).toContain('ALTER TABLE "orden" DROP COLUMN IF EXISTS "clave_remision";');
    expect(s.indexOf("DROP INDEX")).toBeLessThan(s.indexOf("DROP COLUMN"));
  });

  it("no toca ni una fila de `num_remision`: cero INSERT/UPDATE/DELETE", () => {
    const s = sql("down.sql");
    expect(s).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
    expect(s).not.toMatch(/num_remision/i);
  });
});

describe("schema.prisma — el modelo declara la columna y EXPLICA lo que no puede expresar", () => {
  it("declara `claveRemision` con `@default(dbgenerated())` y su `@map`", () => {
    // Sin `@default(dbgenerated())`, Prisma lee la expresion GENERATED como un default de columna
    // y cada `migrate dev` futuro propone un `ALTER COLUMN … DROP DEFAULT` imposible de aplicar
    // (medido en la ficha 169, T1.5).
    const linea = modeloOrden()
      .split("\n")
      .find((l) => /@map\(\s*"clave_remision"\s*\)/.test(l));
    expect(linea, "el model Orden no declara la columna").toBeDefined();
    const codigo = (linea as string).split("//")[0];
    expect(codigo).toMatch(/claveRemision\s+String\?/);
    expect(codigo).toContain("@default(dbgenerated())");
  });

  it("declara el indice con el `map:` del nombre real", () => {
    expect(modeloOrden()).toMatch(
      /@@index\(\[prioridad\(sort: Desc\), claveRemision, id\], map: "orden_prioridad_clave_remision_idx"\)/,
    );
  });

  it("el modelo EXPLICA donde viven el predicado y la collation (si no, el proximo los 'restaura')", () => {
    // El hueco es real y esta medido en la feature 294: `migrate diff --from-config-datasource`
    // no ve el predicado parcial, pero `db push` escribiria el indice SIN el `WHERE` y la columna
    // SIN la collation. Lo unico que evita que alguien lo "arregle" en el modelo es que el
    // modelo lo cuente.
    const cuerpo = modeloOrden();
    expect(cuerpo).toContain('WHERE "deleted_at" IS NULL');
    expect(cuerpo).toContain('COLLATE "C"');
    expect(cuerpo).toContain(NOMBRE);
  });
});

describe("censo: ninguna migracion POSTERIOR degrada la columna ni el indice", () => {
  it("nadie recrea el indice sin su `WHERE`, ni altera/suelta la columna", () => {
    // El modo de fallo que esto vigila es concreto: un `migrate dev` de otra feature arrastra un
    // `CREATE INDEX "orden_prioridad_clave_remision_idx" …` sin `WHERE` (Prisma lo rinde asi
    // desde el datamodel) y nadie lo mira al revisar el diff. Como la collation la HEREDA el
    // indice de la columna, se vigila tambien cualquier `ALTER COLUMN`/`DROP COLUMN` sobre ella:
    // recrearla sin `COLLATE "C"` rompe R6 exactamente igual y sin ruido.
    const indiceSinWhere: string[] = [];
    const tocanLaColumna: string[] = [];
    for (const dir of readdirSync(MIGRACIONES, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      if (dir.name <= NOMBRE) continue;
      let contenido: string;
      try {
        contenido = readFileSync(resolve(MIGRACIONES, dir.name, "migration.sql"), "utf8");
      } catch {
        continue;
      }
      const ejecutable = contenido
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith("--"))
        .join(" ");
      for (const m of ejecutable.matchAll(
        /CREATE\s+(?:UNIQUE\s+)?INDEX[^;]*"orden_prioridad_clave_remision_idx"[^;]*;/gi,
      )) {
        if (!/WHERE/i.test(m[0])) indiceSinWhere.push(dir.name);
      }
      if (/(ALTER|DROP)\s+COLUMN\s+(IF\s+EXISTS\s+)?"clave_remision"/i.test(ejecutable)) {
        tocanLaColumna.push(dir.name);
      }
    }
    expect(
      indiceSinWhere,
      "estas migraciones recrean el indice del orden por remision SIN el predicado " +
        "`deleted_at IS NULL`",
    ).toEqual([]);
    expect(
      tocanLaColumna,
      "estas migraciones alteran o sueltan `clave_remision`: si la recrean sin `COLLATE \"C\"`, " +
        "el orden pasa a depender del locale de cada base y nada falla",
    ).toEqual([]);
  });

  it("la migracion entra DESPUES de la ultima que ya estaba aplicada", () => {
    // La numeracion de este repo va ADELANTADA respecto al calendario: el 2026-09-14
    // `20260914120000` ya estaba tomado y la ultima del arbol era `20260915120000`. Una
    // migracion con timestamp ANTERIOR a otra ya aplicada entra FUERA DE ORDEN en las bases que
    // ya la tienen, y eso no lo detecta nadie hasta que falla en despliegue.
    const dirs = readdirSync(MIGRACIONES, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    expect(dirs).toContain(NOMBRE);
    expect(NOMBRE > "20260915120000_usuario_preferencia").toBe(true);
    // Y el nombre es UNICO: dos carpetas con el mismo timestamp es drift garantizado.
    expect(dirs.filter((d) => d.startsWith("20260916120000"))).toEqual([NOMBRE]);
  });
});
