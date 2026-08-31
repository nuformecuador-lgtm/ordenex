import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Chore de saneamiento (deuda de `dev`, 2026-07-31) — cobertura ESTATICA de la reconciliacion
// entre `db/schema.prisma` y lo que las migraciones REALMENTE crearon en la base.
//
// De donde viene: al generar la migracion de la feature 167, `prisma migrate dev --create-only`
// propuso DIEZ sentencias ajenas a esa feature (6 `DROP DEFAULT`, un drop+add de FK y dos
// `RENAME INDEX`). Se retiraron a mano y quedo declarado como P2 en
// `progress/impl_167-apartado-recoleccion-mensajero.md` (T1.1).
//
// Diagnostico: las DIEZ eran defecto de `schema.prisma`, no de la base. `prisma migrate diff`
// desde el DIRECTORIO DE MIGRACIONES hacia el schema devolvia las mismas diez sentencias que
// desde la base viva, o sea que la base local reproduce EXACTAMENTE lo que las migraciones
// escriben y el desacuerdo estaba en el modelo. La reconciliacion se hizo declarando en
// `schema.prisma` lo que el SQL ya habia creado — CERO DDL, cero riesgo en cualquier base.
//
// Este archivo es el guardia de esa reconciliacion: si alguien quita un `@default(now())`, un
// `map:` o el `onDelete: Restrict`, el drift vuelve y con el las diez sentencias fantasma en la
// siguiente migracion de quien pase por ahi. NO requiere Postgres (patron
// `no-migration-102.test.ts` / `orden-historial-actor-origen-index-migration.test.ts`).

const ROOT = path.join(__dirname, "..", "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");
const schemaPrisma = fs.readFileSync(path.join(ROOT, "db", "schema.prisma"), "utf8");

const migrationDirs = fs
  .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

function leerMigracion(sufijo: string, archivo: "migration.sql" | "down.sql"): string {
  const dir = migrationDirs.find((n) => n.endsWith(sufijo));
  if (!dir) throw new Error(`No se encontro la carpeta de migracion ${sufijo}`);
  return fs.readFileSync(path.join(MIGRATIONS_DIR, dir, archivo), "utf8");
}

/** El SQL ejecutable de un archivo: sin comentarios ni lineas en blanco. */
function sentencias(sql: string): string {
  return sql
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("--"))
    .join("\n");
}

/**
 * Todos los `model X { ... }` de schema.prisma, en UNA pasada. Se parsea entero en vez de
 * buscar cada modelo por su nombre: una busqueda perezosa `model\s+X\s*\{[\s\S]*?\}` arranca en
 * el PRIMER `model` del archivo y se lleva por delante a todos los de en medio.
 */
const MODELOS: ReadonlyMap<string, string> = new Map(
  [...schemaPrisma.matchAll(/^model\s+(\w+)\s*\{\n([\s\S]*?)\n\}/gm)].map((m) => [m[1], m[2]]),
);

/** Cuerpo de un `model X { ... }` de schema.prisma, sin las llaves. */
function modelo(nombre: string): string {
  const cuerpo = MODELOS.get(nombre);
  if (cuerpo === undefined) throw new Error(`No se encontro el modelo ${nombre} en schema.prisma`);
  return cuerpo;
}

/** El `@@map("tabla")` de cada modelo: la tabla real detras del nombre Prisma. */
function modeloDeTabla(tabla: string): string {
  for (const [nombre, cuerpo] of MODELOS) {
    if (new RegExp(`@@map\\(\\s*"${tabla}"\\s*\\)`).test(cuerpo)) return nombre;
  }
  throw new Error(`Ningun modelo mapea a la tabla "${tabla}"`);
}

/* -------------------------------------------------------------------------- */
/* 1 · defaults de `updated_at` (6 de las 10 sentencias)                       */
/* -------------------------------------------------------------------------- */

/**
 * Tablas cuyo `CREATE TABLE` dio a `updated_at` un DEFAULT. El censo es GENERICO (recorre
 * todas las migraciones) a proposito: el invariante no es "estas siete tablas", es "toda tabla
 * cuyo SQL puso un default en `updated_at` lo declara tambien en el modelo". Una tabla nueva
 * escrita con el mismo patron cae sola en el censo, y el unico sitio que hay que tocar es la
 * lista literal de la anti-vacuidad — a mano y a sabiendas, que es el punto.
 *
 * Es correcto mirar SOLO el `CREATE TABLE`: ninguna migracion del repo hace `ALTER COLUMN
 * "updated_at" ... DROP DEFAULT` (verificado sobre `db/migrations/**`), asi que el default con
 * el que nace la columna es el que la columna tiene hoy.
 */
function tablasConDefaultEnUpdatedAt(): string[] {
  const tablas = new Set<string>();
  for (const dir of migrationDirs) {
    const archivo = path.join(MIGRATIONS_DIR, dir, "migration.sql");
    if (!fs.existsSync(archivo)) continue;
    const sql = sentencias(fs.readFileSync(archivo, "utf8"));
    for (const bloque of sql.matchAll(/CREATE TABLE\s+"(\w+)"\s*\(([\s\S]*?)\n\);/g)) {
      const columnas = bloque[2];
      if (/"updated_at"[^,\n]*DEFAULT/i.test(columnas)) tablas.add(bloque[1]);
    }
  }
  return [...tablas].sort();
}

describe("updated_at · el modelo declara el DEFAULT que el SQL creo", () => {
  it("el censo encuentra las OCHO tablas cuyo CREATE TABLE le puso default a updated_at", () => {
    // Contrapeso: si el parser se rompiera y devolviera [], el caso de abajo pasaria por vacio
    // en vez de por limpio. Esta lista es la que devuelve la BASE viva consultando
    // `information_schema.columns` (evidencia en progress/chore_saneamiento-deudas.md).
    //
    // ⚠️ SE ACTUALIZA A MANO, y esa es toda la gracia: la lista de la izquierda la DERIVA
    // `tablasConDefaultEnUpdatedAt()` de las migraciones, y la de la derecha la escribe una
    // persona. Si se derivaran las dos de la misma fuente, el caso quedaria verde por
    // construccion y una tabla nueva con default en `updated_at` entraria sin que nadie lo
    // decidiera — que es justo lo contrario de para lo que existe este archivo.
    expect(tablasConDefaultEnUpdatedAt()).toEqual([
      "api_key",
      // FICHA 333 (2026-08-29) - la cola de cobros de gasto fijo por autorizar. Su
      // `CREATE TABLE` (`20260829120000_gasto_fijo_cobro/migration.sql`) escribe
      // `"updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`, asi que cae sola en el
      // censo; el modelo `GastoFijoCobro` lo declara con `@default(now())` y por eso el caso de
      // abajo sigue en verde y `migrate dev` no propondra un `DROP DEFAULT` sobre ella.
      "gasto_fijo_cobro",
      "gasto_fijo_plantilla",
      "jobs",
      "premio_ranking",
      // FICHA 337 (segunda mitad, 2026-08-31) - la cola de cobros por rechazo de tienda. Su
      // `CREATE TABLE` (`20260831120000_rechazo_tienda_cobro/migration.sql`) escribe
      // `"updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP` -- copiado del de la 333,
      // que es su molde--, asi que cae sola en el censo; el modelo `RechazoTiendaCobro` lo declara
      // con `@default(now())` y por eso el caso de abajo sigue en verde y `migrate dev` no
      // propondra un `DROP DEFAULT` sobre ella.
      "rechazo_tienda_cobro",
      "ruta_optimizada",
      "webhook_suscripcion",
    ]);
  });

  it("cada una de esas tablas declara @default(now()) en su updatedAt", () => {
    const sinDeclarar = tablasConDefaultEnUpdatedAt().filter((tabla) => {
      const cuerpo = modelo(modeloDeTabla(tabla));
      const campo = cuerpo
        .split("\n")
        .find((l) => /@map\(\s*"updated_at"\s*\)/.test(l) && !l.trim().startsWith("//"));
      return campo === undefined || !/@default\(now\(\)\)/.test(campo);
    });
    expect(
      sinDeclarar,
      "el SQL les dio DEFAULT a updated_at pero el modelo no lo declara: cada migrate dev " +
        "futuro propondra DROP DEFAULT sobre estas tablas",
    ).toEqual([]);
  });

  it("no se declara @default(now()) donde el SQL NO lo puso (el guardia no va al reves)", () => {
    // `plantilla_mensaje.updated_at` nacio SIN default (su CREATE TABLE lo escribe
    // `TIMESTAMP(3) NOT NULL`, sin DEFAULT). Declararlo aqui inventaria drift en el otro
    // sentido: Prisma propondria un `SET DEFAULT`.
    expect(tablasConDefaultEnUpdatedAt()).not.toContain("plantilla_mensaje");
    const campo = modelo("PlantillaMensaje")
      .split("\n")
      .find((l) => /@map\(\s*"updated_at"\s*\)/.test(l));
    expect(campo).toBeDefined();
    expect(campo).not.toMatch(/@default\(/);
  });
});

/* -------------------------------------------------------------------------- */
/* 2 · plantilla_mensaje.variables (1 de las 10)                               */
/* -------------------------------------------------------------------------- */

describe("plantilla_mensaje.variables · el default '{}' es un REQUISITO, no un adorno", () => {
  it("la migracion crea la columna text[] NOT NULL DEFAULT '{}'", () => {
    const up = sentencias(leerMigracion("_plantilla_mensaje", "migration.sql"));
    expect(up).toMatch(/"variables"\s+TEXT\[\]\s+NOT NULL\s+DEFAULT\s+'\{\}'/i);
  });

  it("el modelo lo declara con @default([])", () => {
    // R12/R15/R27 de la feature 107: "nunca null". El `DROP DEFAULT` que Prisma proponia
    // habria retirado en silencio la garantia que ese requisito pide.
    const campo = modelo("PlantillaMensaje")
      .split("\n")
      .find((l) => /^\s*variables\s/.test(l));
    expect(campo).toBeDefined();
    expect(campo).toMatch(/@default\(\[\]\)/);
  });
});

/* -------------------------------------------------------------------------- */
/* 3 · la FK de cierre_detail (2 de las 10: drop + add)                        */
/* -------------------------------------------------------------------------- */

describe("cierre_detail.tarifa_id · la FK es RESTRICT y el modelo lo dice", () => {
  it("la migracion la creo con ON DELETE RESTRICT, igual que sus cuatro hermanas", () => {
    const up = sentencias(leerMigracion("_cierre_detail", "migration.sql"));
    expect(up).toMatch(
      /ADD CONSTRAINT "cierre_detail_tarifa_id_fkey"\s*\n?\s*FOREIGN KEY \("tarifa_id"\) REFERENCES "tarifas"\("id"\) ON DELETE RESTRICT/,
    );
    const restrictivas = (up.match(/cierre_detail_\w+_fkey/g) ?? []).length;
    expect(restrictivas).toBe(5);
    expect(up).not.toMatch(/cierre_detail_\w+_fkey[\s\S]{0,200}?ON DELETE SET NULL/);
  });

  it("el modelo declara onDelete: Restrict (el default de Prisma seria SetNull)", () => {
    // La fila de `cierre_detail` es INMUTABLE (R10) y `tarifa_id` es la traza auditable de la
    // tarifa congelada. Un SET NULL la borraria al borrarse una tarifa. Ademas, aplicar el
    // drop+add que Prisma proponia obliga a revalidar la FK contra TODAS las filas de
    // `cierre_detail` en produccion: no es una sentencia de metadatos.
    expect(modelo("CierreDetail")).toMatch(
      /tarifa\s+Tarifa\?\s+@relation\(fields:\s*\[tarifaId\],\s*references:\s*\[id\],\s*onDelete:\s*Restrict\)/,
    );
  });
});

/* -------------------------------------------------------------------------- */
/* 4 · los dos nombres de indice (2 de las 10: RENAME INDEX)                   */
/* -------------------------------------------------------------------------- */

const INDICES_A_MANO = [
  {
    indice: "chat_mensaje_error_codigo_idx",
    sufijo: "_chat_mensaje_error_meta",
    modelo: "ChatMensaje",
    campos: /@@index\(\[errorCodigo,\s*ocurridoAt\(sort:\s*Desc\)\],\s*map:\s*"chat_mensaje_error_codigo_idx"\)/,
  },
  {
    indice: "notificacion_entidad_idx",
    sufijo: "_notificacion",
    modelo: "Notificacion",
    campos: /@@index\(\[entidadTipo,\s*entidadId\],\s*map:\s*"notificacion_entidad_idx"\)/,
  },
] as const;

describe("indices escritos a mano · el modelo reproduce su nombre con map:", () => {
  for (const caso of INDICES_A_MANO) {
    it(`${caso.indice} lo crea su migracion con ese nombre exacto`, () => {
      const up = sentencias(leerMigracion(caso.sufijo, "migration.sql"));
      expect(up).toMatch(new RegExp(`CREATE INDEX "${caso.indice}"`));
    });

    it(`${caso.modelo} lo declara con map: "${caso.indice}"`, () => {
      expect(modelo(caso.modelo)).toMatch(caso.campos);
    });
  }

  it("el down.sql de chat_mensaje_error_meta borra EXACTAMENTE ese nombre", () => {
    // Este es el dano concreto que habria hecho aceptar el `RENAME INDEX` de Prisma: el DOWN de
    // esa migracion quedaria mudo (`IF EXISTS` sobre un nombre inexistente) y el rollback
    // dejaria el indice vivo. Renombrar obliga a tocar los down.sql previos, igual que anadir
    // un valor de enum.
    const down = sentencias(leerMigracion("_chat_mensaje_error_meta", "down.sql"));
    expect(down).toMatch(/DROP INDEX IF EXISTS "chat_mensaje_error_codigo_idx"/);
  });

  it("ningun nombre por defecto de Prisma se cuela en el schema para estos dos indices", () => {
    // Los nombres que Prisma queria imponer. Si aparecieran, es que alguien acepto el rename.
    expect(schemaPrisma).not.toContain("chat_mensaje_error_codigo_ocurrido_at_idx");
    expect(schemaPrisma).not.toContain("notificacion_entidad_tipo_entidad_id_idx");
  });
});

/* -------------------------------------------------------------------------- */
/* 5 · el saneamiento NO introdujo DDL                                          */
/* -------------------------------------------------------------------------- */

describe("el saneamiento se hizo SIN migracion, y las fuentes de verdad siguen en su sitio", () => {
  it("las cinco migraciones de origen del drift existen y son anteriores a este chore", () => {
    // Todas las bases (local, preview, produccion) se construyen con `migrate deploy` sobre
    // ESTAS carpetas: si el estado que el schema ahora declara lo crearon ellas, ninguna base
    // necesita DDL nuevo. Ese es el argumento entero para no haber escrito migracion.
    for (const sufijo of [
      "_plantilla_mensaje",
      "_cierre_detail",
      "_chat_mensaje_error_meta",
      "_notificacion",
      "_premio_ranking",
    ]) {
      const dir = migrationDirs.find((n) => n.endsWith(sufijo));
      expect(dir, `falta la migracion ${sufijo}`).toBeDefined();
      expect((dir as string).slice(0, 14) < "20260731150000").toBe(true);
    }
  });

  it("no se creo ninguna carpeta de migracion de saneamiento de drift", () => {
    expect(migrationDirs.filter((d) => /saneamiento|drift/i.test(d))).toEqual([]);
  });

  it("la semilla de premio_ranking sigue apoyandose en el default de updated_at", () => {
    // Prueba de que el default NO era decorativo: el INSERT de esa misma migracion no nombra
    // `updated_at` ni `created_at`. Haber aceptado el `DROP DEFAULT` habria dejado esa sentencia
    // sin poder re-ejecutarse.
    const up = sentencias(leerMigracion("_premio_ranking", "migration.sql"));
    const insert = up.match(/INSERT INTO "premio_ranking" \(([^)]*)\)/);
    expect(insert).not.toBeNull();
    expect((insert as RegExpMatchArray)[1]).not.toContain("updated_at");
    expect((insert as RegExpMatchArray)[1]).not.toContain("created_at");
  });
});
