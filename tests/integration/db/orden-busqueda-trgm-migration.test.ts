import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { ACENTOS_FROM, ACENTOS_TO } from "@/lib/utils/busqueda-orden";

// Feature 169 / T1.7 — cobertura ESTATICA de la migracion `*_orden_busqueda_trgm`
// (patron `orden-indices-filtros-migracion.test.ts`): lee migration.sql, down.sql y
// schema.prisma y verifica su contenido por regex. NO requiere Postgres real.
//
// Lo que ESTE archivo NO puede demostrar (y por eso existen sus hermanos contra base
// real): que la expresion generada sea admisible, que el opclass resuelva y que Postgres
// y Node normalicen igual. Aqui se protege lo que si es textual: que el UP haga las cuatro
// cosas en orden, que el DOWN las deshaga en orden inverso y sea idempotente, que el DOWN
// NO se lleve por delante infraestructura compartida, y que schema.prisma no divergiera.
//
// La migracion NO crea tablas => no introduce RLS nueva: la columna hereda exactamente los
// permisos y politicas de `orden`.

const ROOT = path.join(__dirname, "..", "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");
const SUFIJO = "_orden_busqueda_trgm";

const carpetas = fs
  .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

const carpeta = carpetas.find((n) => n.endsWith(SUFIJO));
if (!carpeta) throw new Error(`No se encontro la carpeta de migracion ${SUFIJO}`);
const migrationDir = path.join(MIGRATIONS_DIR, carpeta);

const upSql = fs.readFileSync(path.join(migrationDir, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(migrationDir, "down.sql"), "utf8");
const schema = fs.readFileSync(path.join(ROOT, "db", "schema.prisma"), "utf8");

/**
 * El SQL de un archivo SIN comentarios ni lineas en blanco. Se limpia ANTES de partir por
 * `;` a proposito: los comentarios de estas dos migraciones contienen tanto puntos y coma
 * (la sentencia de reparacion de `pg_trgm`) como las palabras que este test busca
 * (`CREATE INDEX`, `DROP EXTENSION`, `CONCURRENTLY`). Sin limpiar primero, el test se
 * estaria leyendo a si mismo en la prosa en vez de en el SQL.
 */
function sinComentarios(sql: string): string {
  return sql
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("--"))
    .join("\n");
}

function sentencias(sqlLimpio: string): string[] {
  return sqlLimpio
    .split(";")
    .map((bloque) => bloque.split("\n").join(" ").trim())
    .filter((s) => s.length > 0);
}

const upLimpio = sinComentarios(upSql);
const downLimpio = sinComentarios(downSql);
const sentenciasUp = sentencias(upLimpio);
const sentenciasDown = sentencias(downLimpio);

/** La clase de espacios que el SQL debe usar, escrita sin ambiguedad de escapes. */
const CLASE_ESPACIOS = String.raw`'[ \t\n\r\f\v]+', ' ', 'g'`;

describe("UP — extension, columna generada e indice GIN, en ese orden", () => {
  it("son EXACTAMENTE cuatro sentencias y ninguna mas", () => {
    // Una migracion que hace UNA sola cosa. Si aparece una quinta sentencia, o es drift
    // que se colo al generar, o es otra feature viajando de polizon.
    expect(sentenciasUp).toHaveLength(4);
  });

  it("1) crea el esquema `extensions` si no existe", () => {
    expect(sentenciasUp[0]).toMatch(/^CREATE SCHEMA IF NOT EXISTS extensions$/i);
  });

  it("2) crea pg_trgm EN ese esquema (nunca en public)", () => {
    expect(sentenciasUp[1]).toMatch(
      /^CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions$/i,
    );
  });

  it("3) añade `busqueda_texto` como columna GENERADA STORED y NULLable", () => {
    const columna = sentenciasUp[2];
    expect(columna).toMatch(/ALTER TABLE "orden"/);
    expect(columna).toMatch(/ADD COLUMN "busqueda_texto" text/);
    expect(columna).toMatch(/GENERATED ALWAYS AS \(/);
    expect(columna).toMatch(/\) STORED$/);
    // NULLable a proposito (design §2.1): declararla NOT NULL en SQL y `String?` en Prisma
    // seria drift en la siguiente migracion que alguien generase.
    expect(columna).not.toMatch(/NOT NULL/);
  });

  it("la expresion concatena los CUATRO campos buscables y NADA mas (R2)", () => {
    const columna = sentenciasUp[2];
    for (const campo of ["num_guia", "num_remision", "telefono_dest", "destinatario"]) {
      expect(columna).toContain(`"${campo}"`);
    }
    // Los que el humano dejo FUERA del alcance. Que aparecieran aqui seria ampliar la
    // busqueda por la puerta de atras, sin pasar por el spec.
    for (const fuera of ["direccion", "producto", "notas"]) {
      expect(columna).not.toContain(`"${fuera}"`);
    }
    // Y ningun JOIN encubierto: la tienda se filtra por su propio filtro de catalogo.
    expect(columna).not.toMatch(/SELECT/i);
  });

  it("indexa el telefono DOS veces: tal cual y en forma solo-digitos (R13)", () => {
    expect(sentenciasUp[2]).toMatch(
      /regexp_replace\(coalesce\("telefono_dest", ''\), '\[\^0-9\]', '', 'g'\)/,
    );
  });

  it("usa `||` y no concat(): concat es STABLE y Postgres rechazaria la columna", () => {
    expect(sentenciasUp[2]).toContain("||");
    expect(sentenciasUp[2]).not.toMatch(/\bconcat(_ws)?\s*\(/i);
  });

  it("pliega acentos con translate() y NUNCA con unaccent()", () => {
    // `unaccent(text)` es STABLE (resuelve su diccionario por search_path): Postgres la
    // rechaza en una columna generada, y ademas su paridad con Node seria indemostrable.
    expect(sentenciasUp[2]).toMatch(/translate\(/);
    expect(sentenciasUp[2]).not.toMatch(/unaccent/i);
  });

  it("el mapa del translate() es copia LITERAL de ACENTOS_FROM/ACENTOS_TO (T1.2)", () => {
    expect(sentenciasUp[2]).toContain(`'${ACENTOS_FROM}'`);
    expect(sentenciasUp[2]).toContain(`'${ACENTOS_TO}'`);
  });

  it("aplica translate ANTES de lower (el orden importa con collations raras)", () => {
    const columna = sentenciasUp[2];
    expect(columna.indexOf("lower(translate(")).toBeGreaterThan(-1);
    expect(columna).not.toMatch(/translate\(\s*lower\(/);
  });

  it("colapsa espacios con una clase EXPLICITA, no con `\\s` (dependiente del ctype)", () => {
    // Verificado empiricamente: el `\s` de Postgres SI colapsa el NBSP en el build local
    // (msvc) y NO en un build glibc como el de Supabase. Con `\s`, la columna se
    // calcularia distinto en local y en produccion y la paridad con Node dejaria de ser
    // demostrable — que es justo lo que este diseño evita.
    expect(sentenciasUp[2]).toContain(CLASE_ESPACIOS);
    expect(sentenciasUp[2]).not.toMatch(/'\\s\+'/);
    expect(sentenciasUp[2]).toMatch(/btrim\(/);
  });

  it("4) crea el indice GIN con el opclass CUALIFICADO por esquema", () => {
    // Sin cualificar, el indice depende del `search_path` del rol que ejecuta la
    // migracion: se crearia en una base y no en otra, con la busqueda lenta solo en
    // produccion y sin ninguna señal.
    expect(sentenciasUp[3]).toMatch(
      /CREATE INDEX "orden_busqueda_texto_trgm_idx"\s+ON "orden" USING gin \("busqueda_texto" extensions\.gin_trgm_ops\)/,
    );
  });

  it("NO usa CREATE INDEX CONCURRENTLY (Prisma corre cada migracion en una transaccion)", () => {
    expect(upLimpio).not.toMatch(/CONCURRENTLY/i);
  });

  it("no crea tablas ni toca RLS", () => {
    expect(upLimpio).not.toMatch(/CREATE TABLE/i);
    expect(upLimpio).not.toMatch(/ROW LEVEL SECURITY/i);
    expect(downLimpio).not.toMatch(/ROW LEVEL SECURITY/i);
  });

  it("no toca ninguna otra tabla (una migracion, una cosa)", () => {
    const tablas = [...upLimpio.matchAll(/ALTER TABLE "(\w+)"/g)].map((m) => m[1]);
    expect(new Set(tablas)).toEqual(new Set(["orden"]));
  });
});

describe("DOWN — revierte en orden INVERSO y es idempotente (R29)", () => {
  it("son exactamente dos sentencias", () => {
    expect(sentenciasDown).toHaveLength(2);
  });

  it("1) borra primero el INDICE, con IF EXISTS", () => {
    expect(sentenciasDown[0]).toMatch(
      /^DROP INDEX IF EXISTS "orden_busqueda_texto_trgm_idx"$/i,
    );
  });

  it("2) borra despues la COLUMNA, con IF EXISTS", () => {
    // Al reves, el DROP COLUMN arrastraria el indice por dependencia y la primera
    // sentencia estaria mintiendo sobre lo que hace.
    expect(sentenciasDown[1]).toMatch(
      /^ALTER TABLE "orden" DROP COLUMN IF EXISTS "busqueda_texto"$/i,
    );
  });

  it("las dos sentencias llevan IF EXISTS: `db:rollback` puede re-ejecutarse", () => {
    expect(sentenciasDown.every((s) => /IF EXISTS/i.test(s))).toBe(true);
  });

  it("NO elimina la extension ni el esquema `extensions`", () => {
    // El UP la crea con IF NOT EXISTS: en una base que ya la tenia, el UP NO la creo. Un
    // DOWN que la eliminase borraria algo que no era suyo y que otra feature podria estar
    // usando. Y el esquema `extensions` es infraestructura compartida de Supabase.
    expect(downLimpio).not.toMatch(/DROP EXTENSION/i);
    expect(downLimpio).not.toMatch(/DROP SCHEMA/i);
  });

  it("hay un DROP por cada objeto que el UP crea sobre `orden`", () => {
    expect((upLimpio.match(/CREATE INDEX/g) ?? []).length).toBe(1);
    expect((downLimpio.match(/DROP INDEX/g) ?? []).length).toBe(1);
    expect((upLimpio.match(/ADD COLUMN/g) ?? []).length).toBe(1);
    expect((downLimpio.match(/DROP COLUMN/g) ?? []).length).toBe(1);
  });
});

describe("carpeta y schema.prisma (R30)", () => {
  it("la carpeta contiene migration.sql y down.sql", () => {
    expect(fs.existsSync(path.join(migrationDir, "migration.sql"))).toBe(true);
    expect(fs.existsSync(path.join(migrationDir, "down.sql"))).toBe(true);
  });

  it("su timestamp no es anterior al de ninguna migracion que ya existiera", () => {
    // BASELINE PINNEADO (patron `orden-indices-filtros-migracion.test.ts`): cuando esta
    // migracion se escribio, la carpeta mas reciente del arbol era `20260731140000_*`.
    // Comparar contra el arbol VIVO daria un falso rojo con cada migracion posterior.
    expect(carpeta.slice(0, 14) >= "20260731140000").toBe(true);
    // Y tiene que seguir siendo EXACTAMENTE la carpeta aplicada: renombrar una migracion
    // ya aplicada descuadra `_prisma_migrations`.
    expect(carpeta.slice(0, 14)).toBe("20260731160000");
  });

  const modelo = (() => {
    const desde = schema.slice(schema.indexOf("model Orden {"));
    return desde.slice(0, desde.indexOf('@@map("orden")'));
  })();

  it("el modelo declara la columna como `String?` mapeada a busqueda_texto", () => {
    expect(modelo).toMatch(/busquedaTexto\s+String\?[^\n]*@map\("busqueda_texto"\)/);
  });

  it("el modelo declara @default(dbgenerated()) (sin el, cada migrate dev propone DROP DEFAULT)", () => {
    // Medido en T1.5: Prisma lee la expresion GENERATED como si fuera un DEFAULT de
    // columna. Sin esta declaracion, el diff NO sale vacio.
    expect(modelo).toMatch(/busquedaTexto[^\n]*@default\(dbgenerated\(\)\)/);
  });

  it("el modelo declara el indice GIN con el nombre EXACTO que crea el SQL", () => {
    expect(modelo).toMatch(
      /@@index\(\[busquedaTexto\(ops: raw\("gin_trgm_ops"\)\)\], type: Gin, map: "orden_busqueda_texto_trgm_idx"\)/,
    );
  });

  it("el opclass del modelo va SIN cualificar (es lo que Prisma lee de pg_opclass)", () => {
    // Cualificarlo aqui reintroduce drift: `pg_opclass` guarda nombre y esquema por
    // separado, asi que Prisma siempre lo lee como `gin_trgm_ops` a secas. El SQL
    // aplicado SI lo cualifica, que es donde importa.
    expect(modelo).not.toContain('raw("extensions.gin_trgm_ops")');
  });
});
