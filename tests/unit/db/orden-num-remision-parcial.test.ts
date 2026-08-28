import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * FEATURE 294 — cobertura ESTATICA del indice unico PARCIAL de `num_remision`.
 *
 * Este archivo NO demuestra que el indice funcione: eso lo hace
 * `tests/integration/db/orden-remision-borrada-libera-numero.test.ts` contra Postgres de
 * verdad, que es donde vive el riesgo. Lo que se ancla AQUI es lo que una base no puede
 * contar: que la restriccion siga estando escrita a mano en la migracion, que NO haya vuelto al
 * `schema.prisma` (donde Prisma solo puede rendirla SIN predicado) y que el `down.sql` la
 * devuelva exactamente a como estaba.
 *
 * POR QUE ES NECESARIO. El defecto de la ficha 294 fue MUDO: tres ordenes "cargadas" que nunca
 * existieron, sin un error. Si alguien "restaurase" el `@@unique` en el modelo, nada del build
 * se pondria rojo — y el proximo `db push` volveria a escribir el indice sin `WHERE`. Este
 * guardia es la unica cosa que se entera.
 */

const RAIZ = resolve(__dirname, "../../..");
const MIGRACIONES = resolve(RAIZ, "db/migrations");
const DIR = resolve(MIGRACIONES, "20260827160000_orden_num_remision_unico_parcial");
const SCHEMA = readFileSync(resolve(RAIZ, "db/schema.prisma"), "utf8");

/** El SQL ejecutable de un archivo de la migracion: sin comentarios ni lineas en blanco. */
function sql(archivo: "migration.sql" | "down.sql"): string {
  return readFileSync(resolve(DIR, archivo), "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("--"))
    .join("\n");
}

/** Cuerpo del `model Orden { ... }` de schema.prisma. */
function modeloOrden(): string {
  const m = SCHEMA.match(/^model\s+Orden\s*\{\n([\s\S]*?)\n\}/m);
  if (!m) throw new Error("No se encontro el model Orden en schema.prisma");
  return m[1];
}

describe("migration.sql — el unico de (tienda, remision) pasa a PARCIAL", () => {
  it("recrea `orden_tienda_id_num_remision_key` con el predicado `deleted_at IS NULL`", () => {
    expect(sql("migration.sql")).toMatch(
      /CREATE UNIQUE INDEX\s+"orden_tienda_id_num_remision_key"\s+ON "orden"\("tienda_id", "num_remision"\)\s+WHERE "deleted_at" IS NULL;/,
    );
  });

  it("suelta el indice viejo ANTES de crear el nuevo (comparten nombre: no hay otro orden)", () => {
    const s = sql("migration.sql");
    expect(s).toContain('DROP INDEX "orden_tienda_id_num_remision_key";');
    expect(s.indexOf("DROP INDEX")).toBeLessThan(s.indexOf("CREATE UNIQUE INDEX"));
  });

  it("no mueve ni una fila: cero INSERT/UPDATE/DELETE", () => {
    // El desbloqueo manual de produccion (renombrar la remision de las borradas con sufijo
    // `-BORRADA-<fecha>`) fue un parche operativo. Una migracion que "resuelva" datos a mano es
    // justo lo que este repo no hace: el arreglo es la constraint, no reescribir remisiones.
    expect(sql("migration.sql")).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
  });

  it("no toca num_guia: ese numero lo genera Ordenex y su unico sigue siendo total", () => {
    expect(sql("migration.sql")).not.toMatch(/num_guia/i);
  });
});

describe("down.sql — vuelve al unico SIN predicado, y solo a eso", () => {
  it("recrea el indice sin `WHERE`", () => {
    const s = sql("down.sql");
    expect(s).toContain('DROP INDEX "orden_tienda_id_num_remision_key";');
    expect(s).toMatch(
      /CREATE UNIQUE INDEX\s+"orden_tienda_id_num_remision_key"\s+ON "orden"\("tienda_id", "num_remision"\);/,
    );
    expect(s).not.toMatch(/WHERE/i);
  });

  it("no intenta 'resolver' los duplicados que el rollback puede encontrarse", () => {
    // El `up` RELAJA la constraint, asi que el `down` puede abortar con 23505. Declararlo es
    // correcto; taparlo con un DELETE o un renombrado destruiria dato real de una tienda.
    expect(sql("down.sql")).not.toMatch(/\b(DELETE|UPDATE|INSERT)\b/i);
  });
});

describe("schema.prisma — la restriccion NO vuelve al modelo", () => {
  it("el model Orden ya no declara @@unique([tiendaId, numRemision])", () => {
    // Con el `@@unique` puesto, `prisma migrate diff --from-empty --to-schema` (o sea, lo que
    // hace `db push`) escribe el indice SIN el `WHERE`, y el cliente generado ofrece
    // `tiendaId_numRemision` en `OrdenWhereUniqueInput` — un `findUnique` por un par que la
    // base ya no garantiza unico. Las dos cosas medidas el 2026-08-27.
    expect(modeloOrden()).not.toMatch(/@@unique\(\[\s*tiendaId\s*,\s*numRemision\s*\]/);
  });

  it("tampoco vuelve como `@unique` de columna sobre numRemision", () => {
    const linea = modeloOrden()
      .split("\n")
      .find((l) => /@map\(\s*"num_remision"\s*\)/.test(l));
    expect(linea).toBeDefined();
    // Se mira SOLO el codigo: el comentario de esa misma linea nombra `@unique` para explicar
    // por que NO esta, y buscarlo en el texto crudo daria un falso rojo.
    const codigo = (linea as string).split("//")[0];
    expect(codigo).not.toMatch(/@unique/);
  });

  it("el modelo EXPLICA donde vive la restriccion (si no, el proximo la 'restaura')", () => {
    const cuerpo = modeloOrden();
    expect(cuerpo).toContain("orden_tienda_id_num_remision_key");
    expect(cuerpo).toContain('WHERE "deleted_at" IS NULL');
    expect(cuerpo).toContain("20260827160000_orden_num_remision_unico_parcial");
  });
});

describe("ninguna migracion POSTERIOR recrea el indice sin predicado", () => {
  it("censo: si alguien lo vuelve a crear, lo hace con su WHERE", () => {
    // El modo de fallo que este caso vigila es concreto: un `migrate dev` de otra feature
    // arrastra un `CREATE UNIQUE INDEX "orden_tienda_id_num_remision_key" ...` sin `WHERE`
    // (Prisma lo rinde asi desde el datamodel) y nadie lo mira al revisar el diff.
    const infractoras: string[] = [];
    for (const dir of readdirSync(MIGRACIONES, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      if (dir.name <= "20260827160000_orden_num_remision_unico_parcial") continue;
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
        /CREATE\s+UNIQUE\s+INDEX[^;]*"orden_tienda_id_num_remision_key"[^;]*;/gi,
      )) {
        if (!/WHERE/i.test(m[0])) infractoras.push(dir.name);
      }
    }
    expect(
      infractoras,
      "estas migraciones recrean el unico de (tienda, remision) SIN el predicado " +
        "`deleted_at IS NULL`: una orden borrada volveria a quemar su numero de remision",
    ).toEqual([]);
  });
});
