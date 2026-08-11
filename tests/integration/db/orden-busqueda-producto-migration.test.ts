import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { ACENTOS_FROM, ACENTOS_TO } from "@/lib/utils/busqueda-orden";

// Cobertura ESTATICA de la migracion `*_orden_busqueda_producto`, que amplia el buscador
// de ordenes al campo PRODUCTO. Mismo patron (y mismas limitaciones) que su hermana
// `orden-busqueda-trgm-migration.test.ts`: lee los .sql y verifica su contenido por regex,
// sin Postgres real.
//
// Lo que ESTE archivo no puede demostrar —que la expresion sea admisible, que el opclass
// resuelva y que Postgres y Node normalicen igual— lo demuestran contra base real
// `busqueda-sincronizacion-columna.test.ts` y `busqueda-normalizacion-paridad.test.ts`.
//
// Lo que si protege, y es la razon de existir del archivo: que la columna se RECREE ENTERA
// (no se puede alterar la expresion de una columna generada antes de PG17), que el indice
// se vaya antes y vuelva despues con el MISMO nombre y opclass que declara schema.prisma,
// y que el DOWN restaure la definicion de CINCO segmentos en vez de dejar la tabla sin
// columna — un DOWN que solo destruyera romperia todo el buscador.

const ROOT = path.join(__dirname, "..", "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");
const SUFIJO = "_orden_busqueda_producto";

const carpeta = fs
  .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort()
  .find((n) => n.endsWith(SUFIJO));
if (!carpeta) throw new Error(`No se encontro la carpeta de migracion ${SUFIJO}`);
const migrationDir = path.join(MIGRATIONS_DIR, carpeta);

const upSql = fs.readFileSync(path.join(migrationDir, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(migrationDir, "down.sql"), "utf8");

/** El SQL sin comentarios ni lineas en blanco: la prosa de estos archivos contiene tanto
 *  `;` como las palabras que el test busca, y sin limpiar primero se leeria a si mismo. */
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

/** Los SEIS segmentos de la expresion nueva, en el orden en que deben concatenarse. */
const SEGMENTOS = [
  `coalesce("num_guia"::text, '')`,
  `coalesce("num_remision", '')`,
  `coalesce("telefono_dest", '')`,
  `regexp_replace(coalesce("telefono_dest", ''), '[^0-9]', '', 'g')`,
  `coalesce("destinatario", '')`,
  `coalesce("producto", '')`,
];

describe("UP — recrea la columna con el sexto segmento y devuelve el indice", () => {
  it("son EXACTAMENTE cuatro sentencias: fuera indice, fuera columna, columna, indice", () => {
    // Una migracion que hace UNA sola cosa. Una quinta sentencia es drift que se colo al
    // generar, u otra feature viajando de polizon.
    expect(sentenciasUp).toHaveLength(4);
  });

  it("1) borra el INDICE antes que la columna (al reves, el DROP COLUMN lo arrastraria)", () => {
    expect(sentenciasUp[0]).toMatch(
      /^DROP INDEX IF EXISTS "orden_busqueda_texto_trgm_idx"$/i,
    );
  });

  it("2) recrea la columna: no existe ALTER de la expresion generada antes de PG17", () => {
    expect(sentenciasUp[1]).toMatch(
      /^ALTER TABLE "orden" DROP COLUMN IF EXISTS "busqueda_texto"$/i,
    );
    const columna = sentenciasUp[2];
    expect(columna).toMatch(/^ALTER TABLE "orden"/);
    expect(columna).toMatch(/ADD COLUMN "busqueda_texto" text/);
    expect(columna).toMatch(/GENERATED ALWAYS AS \(/);
    expect(columna).toMatch(/\) STORED$/);
    // Un `SET EXPRESSION` aqui aplicaria en el Postgres local (18) y reventaria en un
    // servidor 15/16, que es justo el modo de fallo que esta migracion evita.
    expect(columna).not.toMatch(/SET EXPRESSION/i);
    // NULLable a proposito: en Prisma se declara `String?`, y NOT NULL aqui seria drift.
    expect(columna).not.toMatch(/NOT NULL/);
  });

  it("la expresion concatena los SEIS segmentos, en orden, y NADA mas (producto incluido)", () => {
    const columna = sentenciasUp[2];
    let cursor = -1;
    for (const segmento of SEGMENTOS) {
      const pos = columna.indexOf(segmento);
      expect(pos, `falta o esta fuera de orden: ${segmento}`).toBeGreaterThan(cursor);
      cursor = pos;
    }
    // Lo que sigue FUERA del alcance. Que apareciera aqui seria ampliar la busqueda por la
    // puerta de atras, sin pasar por una decision explicita.
    for (const fuera of ["direccion", "notas"]) {
      expect(columna).not.toContain(`"${fuera}"`);
    }
    // Y ningun JOIN encubierto: la tienda se filtra por su propio filtro de catalogo.
    expect(columna).not.toMatch(/SELECT/i);
  });

  it("mantiene intactas las decisiones de la expresion original", () => {
    const columna = sentenciasUp[2];
    // `||` y no concat()/concat_ws(): esas son STABLE y Postgres rechazaria la columna.
    expect(columna).toContain("||");
    expect(columna).not.toMatch(/\bconcat(_ws)?\s*\(/i);
    // translate() y NUNCA unaccent() (STABLE: rechazada en una columna generada).
    expect(columna).toMatch(/translate\(/);
    expect(columna).not.toMatch(/unaccent/i);
    // translate ANTES de lower: lower() depende de la collation de la base.
    expect(columna.indexOf("lower(translate(")).toBeGreaterThan(-1);
    expect(columna).not.toMatch(/translate\(\s*lower\(/);
    // Clase de espacios EXPLICITA, no `\s` (que depende del ctype del build de Postgres).
    expect(columna).toContain(CLASE_ESPACIOS);
    expect(columna).not.toMatch(/'\\s\+'/);
    expect(columna).toMatch(/btrim\(/);
  });

  it("el mapa del translate() sigue siendo copia LITERAL de ACENTOS_FROM/ACENTOS_TO", () => {
    // Si los dos lados dejan de plegar igual, la busqueda "no encuentra" y nada peta: es
    // el fallo mas dificil de diagnosticar de esta feature.
    expect(sentenciasUp[2]).toContain(`'${ACENTOS_FROM}'`);
    expect(sentenciasUp[2]).toContain(`'${ACENTOS_TO}'`);
  });

  it("3) devuelve el indice GIN con el MISMO nombre y el opclass CUALIFICADO", () => {
    // El nombre lo declara schema.prisma con `map:`; cambiarlo aqui seria drift. El
    // opclass va cualificado para no depender del `search_path` del rol que ejecuta.
    expect(sentenciasUp[3]).toMatch(
      /CREATE INDEX "orden_busqueda_texto_trgm_idx"\s+ON "orden" USING gin \("busqueda_texto" extensions\.gin_trgm_ops\)/,
    );
  });

  it("NO usa CREATE INDEX CONCURRENTLY (Prisma corre cada migracion en una transaccion)", () => {
    expect(upLimpio).not.toMatch(/CONCURRENTLY/i);
  });

  it("no crea la extension ni el esquema: no son suyos, ya los puso la 20260731160000", () => {
    expect(upLimpio).not.toMatch(/CREATE EXTENSION/i);
    expect(upLimpio).not.toMatch(/CREATE SCHEMA/i);
  });

  it("no crea tablas, no toca RLS y no toca ninguna otra tabla", () => {
    expect(upLimpio).not.toMatch(/CREATE TABLE/i);
    expect(upLimpio).not.toMatch(/ROW LEVEL SECURITY/i);
    expect(downLimpio).not.toMatch(/ROW LEVEL SECURITY/i);
    const tablas = [...upLimpio.matchAll(/ALTER TABLE "(\w+)"/g)].map((m) => m[1]);
    expect(new Set(tablas)).toEqual(new Set(["orden"]));
  });
});

describe("DOWN — RESTAURA la definicion de cinco segmentos (no solo destruye)", () => {
  it("son cuatro sentencias: fuera indice, fuera columna, columna vieja, indice", () => {
    expect(sentenciasDown).toHaveLength(4);
  });

  it("vuelve a crear la columna SIN `producto` y con los otros cinco segmentos", () => {
    const columna = sentenciasDown[2];
    expect(columna).toMatch(/ADD COLUMN IF NOT EXISTS "busqueda_texto" text/);
    expect(columna).toMatch(/GENERATED ALWAYS AS \(/);
    expect(columna).toMatch(/\) STORED$/);
    expect(columna).not.toContain(`"producto"`);
    for (const segmento of SEGMENTOS.slice(0, 5)) {
      expect(columna).toContain(segmento);
    }
  });

  it("vuelve a crear el INDICE: un rollback que lo dejara fuera degrada la busqueda en silencio", () => {
    expect(sentenciasDown[3]).toMatch(
      /CREATE INDEX IF NOT EXISTS "orden_busqueda_texto_trgm_idx"\s+ON "orden" USING gin \("busqueda_texto" extensions\.gin_trgm_ops\)/,
    );
  });

  it("todas las sentencias son re-ejecutables: `db:rollback` puede correr dos veces", () => {
    expect(sentenciasDown.every((s) => /IF (NOT )?EXISTS/i.test(s))).toBe(true);
  });

  it("NO elimina la extension ni el esquema `extensions`", () => {
    // No son de esta migracion, y el esquema es infraestructura compartida de Supabase.
    expect(downLimpio).not.toMatch(/DROP EXTENSION/i);
    expect(downLimpio).not.toMatch(/DROP SCHEMA/i);
  });
});

describe("carpeta y orden en el arbol", () => {
  it("contiene migration.sql y down.sql", () => {
    expect(fs.existsSync(path.join(migrationDir, "migration.sql"))).toBe(true);
    expect(fs.existsSync(path.join(migrationDir, "down.sql"))).toBe(true);
  });

  it("va DESPUES de la migracion que creo la columna (si no, aplicaria sobre la nada)", () => {
    expect(carpeta.slice(0, 14) > "20260731160000").toBe(true);
    // Y tiene que seguir siendo EXACTAMENTE la carpeta aplicada: renombrar una migracion
    // ya aplicada descuadra `_prisma_migrations`.
    expect(carpeta.slice(0, 14)).toBe("20260808120000");
  });
});
