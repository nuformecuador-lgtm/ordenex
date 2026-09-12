import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { HAY_BASE_DE_DATOS, crearPrismaDeTest, enTransaccionRevertida } from "./_postgres-real";

// FICHA 422 (T1.3 — R1, R2, R4, R5 y la RLS) — LA MIGRACION DE `usuario_preferencia` Y SU `down.sql`.
//
// Dos mitades, y hacen falta las dos (molde de `push-migration.test.ts`):
//
//   · lo que se puede leer del `.sql`  —que el `down` revierta lo que el `up` hace, que no se haya
//     tocado ningun `down.sql` anterior, que el `up` sea aditivo—;
//   · lo que SOLO se le puede preguntar al MOTOR —que la tabla exista con su forma exacta, que el
//     indice unico este, que `relrowsecurity` sea `true`, que la FK sea CASCADE— y, sobre todo,
//     QUE EL BACKFILL HAGA LO QUE DICE. Una regex sobre el `.sql` demuestra lo que alguien
//     ESCRIBIO, no lo que la base hace con ello.
//
// ⚠️ EL BACKFILL SE EJECUTA DE VERDAD, Y CON EL SQL LEIDO DEL ARCHIVO. Contra la base local no se
// puede medir por el camino normal: ahi `push_suscripcion` esta vacia (medido: 0 filas), asi que la
// migracion ya aplicada inserto cero y una consulta a `public` no distinguiria «el backfill
// funciona» de «no habia nada que copiar». Por eso el caso siembra SU PROPIO escenario en un
// ESQUEMA DESECHABLE y ejecuta ahi las sentencias del `migration.sql` REAL. Si alguien borra el
// `INSERT ... SELECT` del archivo (mutacion M5), este caso se pone rojo.

const RAIZ = path.resolve(__dirname, "..", "..", "..");
const MIGRACIONES = path.join(RAIZ, "db", "migrations");
const CARPETA = "20260915120000_usuario_preferencia";

function leer(carpeta: string, archivo: string): string {
  return fs.readFileSync(path.join(MIGRACIONES, carpeta, archivo), "utf8");
}

/**
 * El SQL sin las lineas de comentario. Hace falta para afirmar sobre las SENTENCIAS: la prosa de
 * estos archivos NOMBRA lo que explica —el `migration.sql` escribe los `SELECT` de medicion dentro
 * de un comentario—, asi que cualquier busqueda sobre el texto crudo mide otra cosa.
 */
function sinComentarios(sql: string): string {
  return sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
}

/** Las sentencias ejecutables del `.sql`, en orden. */
function sentenciasDe(sql: string): string[] {
  return sinComentarios(sql)
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const UP = leer(CARPETA, "migration.sql");
const DOWN = leer(CARPETA, "down.sql");

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describe("422 · autocomprobacion: los archivos se leen y tienen contenido", () => {
  it("⭑ los dos archivos estan y ninguno esta vacio", () => {
    // Sin esto, un `leer` roto dejaria TODAS las aserciones de abajo verdes y mudas: una regex que
    // no encuentra nada sobre una cadena vacia no falla, salvo que alguien lo exija aqui.
    expect(UP.length, `${CARPETA}/migration.sql vacio`).toBeGreaterThan(2000);
    expect(DOWN.length, `${CARPETA}/down.sql vacio`).toBeGreaterThan(500);
    expect(sentenciasDe(UP).length, "no se reconocio ninguna sentencia en el `up`").toBe(4);
    expect(sentenciasDe(DOWN).length).toBe(1);
  });
});

describe("422/R1 · el `up` crea la tabla, su indice unico, su FK CASCADE y la RLS", () => {
  it("⭑ las cuatro sentencias son las que se dijeron, y en ese orden", () => {
    const sentencias = sentenciasDe(UP);
    expect(sentencias[0]).toMatch(/^CREATE TABLE "usuario_preferencia"/);
    expect(sentencias[1]).toMatch(
      /^CREATE UNIQUE INDEX "usuario_preferencia_usuario_id_key" ON "usuario_preferencia"\("usuario_id"\)$/,
    );
    expect(sentencias[2]).toMatch(/^INSERT INTO "usuario_preferencia"/);
    expect(sentencias[3]).toMatch(/^ALTER TABLE "usuario_preferencia" ENABLE ROW LEVEL SECURITY$/);
  });

  it("⭑ la FK a `usuario` es CASCADE (R4: una preferencia no es evidencia)", () => {
    expect(sinComentarios(UP)).toMatch(
      /FOREIGN KEY \("usuario_id"\)\s*REFERENCES "usuario"\("id"\) ON DELETE CASCADE/,
    );
  });

  it("⭑ el `up` es ADITIVO: no altera ninguna tabla que ya existiera", () => {
    const codigo = sinComentarios(UP);
    // El unico `ALTER TABLE` es el de la RLS de la tabla NUEVA.
    const alters = [...codigo.matchAll(/ALTER TABLE "(\w+)"/g)].map((m) => m[1]);
    expect([...new Set(alters)]).toEqual(["usuario_preferencia"]);
    // Se mira el VERBO DE CADA SENTENCIA y no el texto entero: `ON UPDATE CASCADE` y
    // `"updated_at"` llevan la palabra «update» dentro y no son escrituras de nada.
    const verbos = sentenciasDe(UP).map((s) => /^[A-Z]+/.exec(s)?.[0] ?? "");
    expect(verbos).toEqual(["CREATE", "CREATE", "INSERT", "ALTER"]);
    expect(verbos).not.toContain("UPDATE");
    expect(verbos).not.toContain("DELETE");
    expect(verbos).not.toContain("DROP");
    // El unico `INSERT` es el backfill, y escribe SOLO en la tabla que acaba de crear.
    const inserts = [...codigo.matchAll(/INSERT INTO "(\w+)"/g)].map((m) => m[1]);
    expect(inserts).toEqual(["usuario_preferencia"]);
  });

  it("⭑ NO crea ningun tipo: la leccion de los enums recreados con lista no aplica aqui", () => {
    const codigo = sinComentarios(UP);
    expect(codigo).not.toMatch(/CREATE TYPE/);
    expect(codigo).not.toMatch(/ALTER TYPE/);
    // Y el `down` tampoco tiene nada que recrear, que es por lo que basta con una sentencia.
    expect(sinComentarios(DOWN)).not.toMatch(/CREATE TYPE|DROP TYPE/);
  });
});

describe("422 · el `down.sql` revierte EXACTAMENTE lo que el `up` crea", () => {
  it("⭑ suelta la tabla, y NADA MAS", () => {
    const codigo = sinComentarios(DOWN);
    expect(codigo).toMatch(/DROP TABLE IF EXISTS "usuario_preferencia"/);
    // El `DROP TABLE` arrastra el indice, la FK y la RLS: soltarlos aparte seria ruido que puede
    // desincronizarse del `up`.
    expect(codigo).not.toMatch(/DROP INDEX/);
    expect(codigo).not.toMatch(/ALTER TABLE/);
  });

  it("⭑ NO toca `usuario` ni `push_suscripcion`: revertir no da de baja a nadie", () => {
    const codigo = sinComentarios(DOWN);
    expect(codigo).not.toMatch(/\bUPDATE\b/i);
    expect(codigo).not.toMatch(/\bINSERT\b/i);
    expect(codigo).not.toMatch(/\bDELETE\b/i);
    expect(codigo).not.toContain('"usuario"');
    expect(codigo).not.toContain('"push_suscripcion"');
  });

  it("⭑ dice EN VOZ ALTA que se pierde la preferencia de todo el mundo", () => {
    // Un `down.sql` que no dice lo que destruye es el que se ejecuta sin pensarlo.
    expect(DOWN).toMatch(/QUE SE PIERDE AL REVERTIR/i);
    expect(DOWN).toMatch(/LA PREFERENCIA DE TODO EL MUNDO/i);
  });

  it("⭑ ningun `down.sql` ANTERIOR fue tocado: son fotos de su rama", () => {
    // La regla del repo. Y aqui es ademas trivialmente cierto porque esta migracion no crea ningun
    // tipo, que es lo unico que obliga a los `down` a llevar listas.
    const anteriores = fs
      .readdirSync(MIGRACIONES, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== CARPETA)
      .map((e) => e.name);
    // AUTOCOMPROBACION: si el recorrido no encontrara carpetas, el barrido seria verde por vacio.
    expect(anteriores.length).toBeGreaterThan(150);
    for (const carpeta of anteriores) {
      const archivo = path.join(MIGRACIONES, carpeta, "down.sql");
      if (!fs.existsSync(archivo)) continue;
      expect(fs.readFileSync(archivo, "utf8"), `${carpeta} fue tocado`).not.toContain(
        "usuario_preferencia",
      );
    }
  });
});

describeSiHayBase("422 · y lo que SOLO sabe el motor: la base tiene lo que la migracion dice", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("⭑ R1: la tabla existe, con su forma EXACTA", async () => {
    const columnas = await prisma.$queryRawUnsafe<
      { column_name: string; data_type: string; is_nullable: string }[]
    >(
      `SELECT column_name, data_type, is_nullable FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'usuario_preferencia'
        ORDER BY ordinal_position`,
    );
    // Lista LITERAL: la forma de la tabla es el contrato, y una columna de mas o de menos tiene que
    // ponerse roja aqui antes que en produccion.
    expect(columnas.map((c) => c.column_name)).toEqual([
      "id",
      "usuario_id",
      "avisos_push",
      "created_at",
      "updated_at",
    ]);
    const avisos = columnas.find((c) => c.column_name === "avisos_push")!;
    // COLUMNA TIPADA, no clave/valor: un `text` aqui seria el EAV que el diseno descarto.
    expect(avisos.data_type).toBe("boolean");
    expect(avisos.is_nullable).toBe("NO");
    // R1: la tabla NO tiene ninguna columna de dispositivo. La preferencia es de la PERSONA.
    const nombres = columnas.map((c) => c.column_name);
    for (const deDispositivo of ["endpoint", "dispositivo", "navegador", "p256dh", "auth"]) {
      expect(nombres, `la preferencia no puede depender de ${deDispositivo}`).not.toContain(
        deDispositivo,
      );
    }
  });

  it("⭑ el indice de `usuario_id` es UNICO, y es el unico indice ademas de la PK", async () => {
    const indices = await prisma.$queryRawUnsafe<{ indexname: string; indexdef: string }[]>(
      `SELECT indexname, indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'usuario_preferencia'
        ORDER BY indexname`,
    );
    expect(indices.map((i) => i.indexname).sort()).toEqual([
      "usuario_preferencia_pkey",
      "usuario_preferencia_usuario_id_key",
    ]);
    const unico = indices.find((i) => i.indexname === "usuario_preferencia_usuario_id_key")!;
    // ⚠️ MUTACION M10: con un indice normal en vez de unico, esto se pone rojo — y con el, el
    // upsert por `usuario_id` deja de ser atomico.
    expect(unico.indexdef).toContain("UNIQUE");
    expect(unico.indexdef).toMatch(/\(usuario_id\)/);
  });

  it("⭑ R4: la FK a `usuario` es CASCADE en la base, no solo en el `.sql`", async () => {
    const filas = await prisma.$queryRawUnsafe<{ delete_rule: string }[]>(
      `SELECT rc.delete_rule
         FROM information_schema.table_constraints tc
         JOIN information_schema.referential_constraints rc
           ON rc.constraint_name = tc.constraint_name
          AND rc.constraint_schema = tc.constraint_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_schema = 'public'
          AND tc.table_name = 'usuario_preferencia'`,
    );
    expect(filas).toHaveLength(1);
    expect(filas[0].delete_rule).toBe("CASCADE");
  });

  it("⭑ la RLS esta habilitada, y sin policies (patron `push_suscripcion` / `jobs`)", async () => {
    // La RLS es una propiedad del CATALOGO: ninguna regex sobre el `.sql` demuestra que este
    // aplicada. Sin policies porque este repo no usa Supabase Auth y una policy no tendria a quien
    // preguntar; lo que garantiza es que a estas filas no se llega salvo por el servidor.
    const filas = await prisma.$queryRawUnsafe<{ relname: string; relrowsecurity: boolean }[]>(
      `SELECT c.relname, c.relrowsecurity
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = 'usuario_preferencia'`,
    );
    // AUTOCOMPROBACION: si la tabla no existiera, la lista saldria vacia y el bucle seria verde.
    expect(filas.map((f) => f.relname)).toEqual(["usuario_preferencia"]);
    expect(filas[0].relrowsecurity).toBe(true);

    const policies = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT COUNT(*)::bigint AS n FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'usuario_preferencia'`,
    );
    expect(Number(policies[0].n)).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R5 — EL BACKFILL, EJECUTADO DE VERDAD SOBRE UN ESCENARIO SEMBRADO
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Ejecuta las sentencias REALES de `migration.sql` en un esquema desechable, sobre el escenario que
 * el caso siembra. Todo dentro de la transaccion revertida del test: el esquema y sus tablas
 * desaparecen al hacer rollback, pase lo que pase.
 *
 * El `search_path` apunta al esquema temporal, asi que las referencias SIN CUALIFICAR del `.sql`
 * —`"usuario_preferencia"`, `"push_suscripcion"`, `"usuario"`— resuelven ahi. El SQL NO SE TOCA: lo
 * que se ejecuta es, caracter por caracter, lo que el archivo dice.
 */
describeSiHayBase("422/R5 · el BACKFILL pone la preferencia a quien tenia suscripcion, y a nadie mas", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  interface Resultado {
    filas: { usuario_id: string; avisos_push: boolean; intacta: boolean }[];
    sentenciasEjecutadas: number;
  }

  async function ejecutarLaMigracionSobre(personasConSuscripcion: string[][]): Promise<Resultado> {
    const esquema = `t422_${Date.now().toString(36)}_${randomUUID().slice(0, 8).replace(/-/g, "")}`;
    return enTransaccionRevertida(prisma, async (tx) => {
      await tx.$executeRawUnsafe(`CREATE SCHEMA "${esquema}"`);
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${esquema}"`);

      // El escenario minimo que la migracion necesita: `usuario` (por la FK) y `push_suscripcion`.
      await tx.$executeRawUnsafe(`CREATE TABLE "usuario" ("id" TEXT PRIMARY KEY)`);
      await tx.$executeRawUnsafe(
        `CREATE TABLE "push_suscripcion" (
           "id" TEXT PRIMARY KEY,
           "usuario_id" TEXT NOT NULL REFERENCES "usuario"("id") ON DELETE CASCADE,
           "endpoint" TEXT NOT NULL UNIQUE)`,
      );

      // Todas las personas existen; SOLO algunas tienen suscripcion.
      const todas = new Set<string>();
      for (const dispositivos of personasConSuscripcion) for (const p of dispositivos) todas.add(p);
      todas.add("carla-sin-dispositivo");
      for (const id of todas) {
        await tx.$executeRawUnsafe(`INSERT INTO "usuario" ("id") VALUES ($1)`, id);
      }
      let n = 0;
      for (const dispositivos of personasConSuscripcion) {
        for (const duena of dispositivos) {
          n += 1;
          await tx.$executeRawUnsafe(
            `INSERT INTO "push_suscripcion" ("id","usuario_id","endpoint") VALUES ($1,$2,$3)`,
            randomUUID(),
            duena,
            `https://fcm.googleapis.com/fcm/send/422-${n}`,
          );
        }
      }

      // ⚠️ Y AHORA EL SQL DEL ARCHIVO, TAL CUAL.
      const sentencias = sentenciasDe(UP);
      for (const s of sentencias) await tx.$executeRawUnsafe(s);

      const filas = await tx.$queryRawUnsafe<
        { usuario_id: string; avisos_push: boolean; intacta: boolean }[]
      >(
        `SELECT "usuario_id", "avisos_push", ("updated_at" = "created_at") AS intacta
           FROM "usuario_preferencia" ORDER BY "usuario_id"`,
      );
      return { filas, sentenciasEjecutadas: sentencias.length };
    });
  }

  it("⭑ quien ya tenia suscripcion queda con la preferencia puesta", async () => {
    // ⚠️ ESTE ES EL CASO QUE MUERE CON LA MUTACION M5 (borrar el `INSERT ... SELECT` del archivo).
    // Ana tiene DOS dispositivos —el `SELECT DISTINCT` tiene que dejar UNA fila—, Beto uno, y
    // Carla ninguno.
    const r = await ejecutarLaMigracionSobre([["ana", "ana"], ["beto"]]);

    // AUTOCOMPROBACION: se ejecutaron las cuatro sentencias del archivo, no una lista vacia.
    expect(r.sentenciasEjecutadas).toBe(4);
    expect(r.filas.map((f) => f.usuario_id)).toEqual(["ana", "beto"]);
    for (const fila of r.filas) expect(fila.avisos_push).toBe(true);
  });

  it("⭑ y NO crea fila para quien no tenia ninguna (R5 + R2)", async () => {
    const r = await ejecutarLaMigracionSobre([["beto"]]);

    // Carla existe como usuaria y NO aparece: su ausencia de fila es «no puesta», que a efectos de
    // comportamiento es «no». Si el backfill pusiera a todo el mundo, esto se pone rojo.
    expect(r.filas.map((f) => f.usuario_id)).not.toContain("carla-sin-dispositivo");
    expect(r.filas).toHaveLength(1);
  });

  it("⭑ dos dispositivos de la MISMA persona dejan UNA sola fila", async () => {
    // Es el `SELECT DISTINCT` del backfill contra el indice unico. Sin el `DISTINCT`, el segundo
    // `INSERT` chocaria y el `ON CONFLICT DO NOTHING` lo absorberia — sale igual, pero esto deja
    // escrito que la unicidad la da la base y no la suerte.
    const r = await ejecutarLaMigracionSobre([["ana", "ana", "ana"]]);

    expect(r.filas).toHaveLength(1);
    expect(r.filas[0].usuario_id).toBe("ana");
  });

  it("⭑ `updated_at = created_at`: el backfill escribio esas filas y NADA MAS las toco", async () => {
    // Es la comprobacion que se corre contra produccion despues de desplegar. Aqui se demuestra que
    // la propiedad se cumple por construccion, para que alla el numero signifique algo.
    const r = await ejecutarLaMigracionSobre([["ana"], ["beto"]]);

    expect(r.filas).toHaveLength(2);
    for (const fila of r.filas) expect(fila.intacta).toBe(true);
  });

  it("⭑ control positivo: sin suscripciones, el backfill no inserta NADA", async () => {
    // Sin este caso, los de arriba pasarian en verde con un backfill que insertara siempre. Y es
    // ademas el estado REAL de la base local (0 suscripciones), asi que deja dicho por que la
    // medicion sobre `public` no puede demostrar nada por si sola.
    const r = await ejecutarLaMigracionSobre([]);

    expect(r.filas).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R4 — EL CASCADE, EJERCITADO CONTRA EL MOTOR
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describeSiHayBase("422/R4 · borrar un usuario se lleva su preferencia", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("⭑ CASCADE de verdad, en un esquema desechable con la tabla REAL clonada", async () => {
    const esquema = `t422c_${Date.now().toString(36)}_${randomUUID().slice(0, 8).replace(/-/g, "")}`;
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await tx.$executeRawUnsafe(`CREATE SCHEMA "${esquema}"`);
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${esquema}"`);
      await tx.$executeRawUnsafe(`CREATE TABLE "usuario" ("id" TEXT PRIMARY KEY)`);
      // El backfill del `up` LEE `push_suscripcion`, asi que tiene que existir. Vacia: aqui lo que
      // se mide es el CASCADE, y sembrarla mezclaria dos cosas en el mismo caso.
      await tx.$executeRawUnsafe(
        `CREATE TABLE "push_suscripcion" ("id" TEXT PRIMARY KEY, "usuario_id" TEXT NOT NULL)`,
      );
      for (const s of sentenciasDe(UP)) await tx.$executeRawUnsafe(s);

      await tx.$executeRawUnsafe(`INSERT INTO "usuario" ("id") VALUES ('ana')`);
      await tx.$executeRawUnsafe(
        `INSERT INTO "usuario_preferencia" ("id","usuario_id","avisos_push") VALUES ($1,'ana',TRUE)`,
        randomUUID(),
      );
      const contar = async () => {
        const f = await tx.$queryRawUnsafe<{ n: bigint }[]>(
          `SELECT COUNT(*)::bigint AS n FROM "usuario_preferencia"`,
        );
        return Number(f[0].n);
      };
      const antes = await contar();
      await tx.$executeRawUnsafe(`DELETE FROM "usuario" WHERE "id" = 'ana'`);
      return { antes, despues: await contar() };
    });

    // CONTROL POSITIVO: sin el `antes`, un `DELETE` que fallara en silencio dejaria el caso verde
    // comparando dos ceros.
    expect(r.antes).toBe(1);
    expect(r.despues).toBe(0);
  });
});
