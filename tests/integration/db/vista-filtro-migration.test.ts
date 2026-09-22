import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  serializarEscriturasReales,
} from "./_postgres-real";
import { SUPERFICIES_VISTA, superficieVistaSchema } from "@/lib/types/vista-filtro";

// FICHA 453 (T1.4 — R1, R4, R11, R35 y la RLS) — LA MIGRACION DE `vista_filtro` Y SU `down.sql`.
//
// Dos mitades, y hacen falta las dos (molde de `usuario-preferencia-migration.test.ts`):
//
//   · lo que se puede leer del `.sql`  —que el `up` sea ADITIVO y sin backfill, que no cree ningun
//     tipo, que el `down` revierta lo que el `up` hace y DIGA lo que destruye, que no se haya
//     tocado ningun `down.sql` anterior—;
//   · lo que SOLO se le puede preguntar al MOTOR —que la tabla exista con su forma exacta, que el
//     unico indice este y sea UNICO, que `relrowsecurity` sea `true`, que la FK sea CASCADE de
//     verdad, y que el grano `(dueño, superficie, nombre)` deje a DOS personas guardar el MISMO
//     nombre—. Una regex sobre el `.sql` demuestra lo que alguien ESCRIBIO, no lo que la base hace.
//
// ⚠️ LOS CASOS DE COMPORTAMIENTO EJECUTAN EL SQL REAL DEL ARCHIVO en un ESQUEMA DESECHABLE, dentro
// de la transaccion revertida del test: si alguien vacia el `migration.sql`, la autocomprobacion de
// «se ejecutaron 3 sentencias» se pone roja en vez de dejar los casos verdes y mudos.

const RAIZ = path.resolve(__dirname, "..", "..", "..");
const MIGRACIONES = path.join(RAIZ, "db", "migrations");
const CARPETA = "20260921120000_vista_filtro";

function leer(carpeta: string, archivo: string): string {
  return fs.readFileSync(path.join(MIGRACIONES, carpeta, archivo), "utf8");
}

/**
 * El SQL sin las lineas de comentario. Hace falta para afirmar sobre las SENTENCIAS: la prosa de
 * estos archivos NOMBRA lo que explica —el `migration.sql` habla de `INSERT`, de `enum` y de
 * `usuario_preferencia` dentro de comentarios—, asi que una busqueda sobre el texto crudo mediria
 * otra cosa.
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

describe("453 · autocomprobacion: los archivos se leen y tienen contenido", () => {
  it("⭑ los dos archivos estan y ninguno esta vacio", () => {
    // Sin esto, un `leer` roto dejaria TODAS las aserciones de abajo verdes y mudas: una regex que
    // no encuentra nada sobre una cadena vacia no falla, salvo que alguien lo exija aqui.
    expect(UP.length, `${CARPETA}/migration.sql vacio`).toBeGreaterThan(2000);
    expect(DOWN.length, `${CARPETA}/down.sql vacio`).toBeGreaterThan(500);
    expect(sentenciasDe(UP).length, "no se reconocio ninguna sentencia en el `up`").toBe(3);
    expect(sentenciasDe(DOWN).length).toBe(1);
  });
});

describe("453/R1 · el `up` crea la tabla, su indice unico, su FK CASCADE y la RLS", () => {
  it("⭑ las tres sentencias son las que se dijeron, y en ese orden", () => {
    const sentencias = sentenciasDe(UP);
    expect(sentencias[0]).toMatch(/^CREATE TABLE "vista_filtro"/);
    expect(sentencias[1]).toMatch(
      /^CREATE UNIQUE INDEX "vista_filtro_dueno_superficie_nombre_key" ON "vista_filtro"\("usuario_id", "superficie", "nombre"\)$/,
    );
    expect(sentencias[2]).toMatch(/^ALTER TABLE "vista_filtro" ENABLE ROW LEVEL SECURITY$/);
  });

  it("⭑ la FK a `usuario` es CASCADE (R4: una vista no es evidencia)", () => {
    expect(sinComentarios(UP)).toMatch(
      /FOREIGN KEY \("usuario_id"\)\s*REFERENCES "usuario"\("id"\) ON DELETE CASCADE/,
    );
  });

  it("⭑ el `up` es ADITIVO y SIN BACKFILL: no toca ninguna tabla que ya existiera", () => {
    const codigo = sinComentarios(UP);
    // El unico `ALTER TABLE` es el de la RLS de la tabla NUEVA.
    const alters = [...codigo.matchAll(/ALTER TABLE "(\w+)"/g)].map((m) => m[1]);
    expect([...new Set(alters)]).toEqual(["vista_filtro"]);
    // Se mira el VERBO DE CADA SENTENCIA y no el texto entero: `ON UPDATE CASCADE` y
    // `"updated_at"` llevan la palabra «update» dentro y no son escrituras de nada.
    const verbos = sentenciasDe(UP).map((s) => /^[A-Z]+/.exec(s)?.[0] ?? "");
    expect(verbos).toEqual(["CREATE", "CREATE", "ALTER"]);
    expect(verbos).not.toContain("INSERT");
    expect(verbos).not.toContain("UPDATE");
    expect(verbos).not.toContain("DELETE");
    expect(verbos).not.toContain("DROP");
    // Y no hay NADA que migrar: el censo confirmo que hoy no existe ningun preset guardado.
    expect(codigo).not.toMatch(/INSERT INTO/);
  });

  it("⭑ NO crea ningun tipo: la leccion de los enums recreados con lista no aplica aqui", () => {
    const codigo = sinComentarios(UP);
    expect(codigo).not.toMatch(/CREATE TYPE/);
    expect(codigo).not.toMatch(/ALTER TYPE/);
    // Y el `down` tampoco tiene nada que recrear, que es por lo que basta con una sentencia.
    expect(sinComentarios(DOWN)).not.toMatch(/CREATE TYPE|DROP TYPE/);
  });

  it("⭑ la RLS se habilita en el propio `up`, no «despues» (docs/architecture: tabla nueva con RLS)", () => {
    expect(sinComentarios(UP)).toMatch(
      /ALTER TABLE "vista_filtro" ENABLE ROW LEVEL SECURITY/,
    );
  });
});

describe("453 · el `down.sql` revierte EXACTAMENTE lo que el `up` crea", () => {
  it("⭑ suelta la tabla, y NADA MAS", () => {
    const codigo = sinComentarios(DOWN);
    expect(codigo).toMatch(/DROP TABLE IF EXISTS "vista_filtro"/);
    // El `DROP TABLE` arrastra el indice, la FK y la RLS: soltarlos aparte seria ruido que puede
    // desincronizarse del `up`.
    expect(codigo).not.toMatch(/DROP INDEX/);
    expect(codigo).not.toMatch(/ALTER TABLE/);
  });

  it("⭑ NO toca `usuario` ni ninguna otra tabla: revertir no borra a nadie ni cambia una orden", () => {
    const codigo = sinComentarios(DOWN);
    expect(codigo).not.toMatch(/\bUPDATE\b/i);
    expect(codigo).not.toMatch(/\bINSERT\b/i);
    expect(codigo).not.toMatch(/\bDELETE\b/i);
    expect(codigo).not.toContain('"usuario"');
    expect(codigo).not.toContain('"orden"');
  });

  it("⭑ dice EN VOZ ALTA que se pierden TODAS las vistas de todo el mundo", () => {
    // Un `down.sql` que no dice lo que destruye es el que se ejecuta sin pensarlo. En este repo un
    // `down` mal entendido ya borro datos en silencio.
    expect(DOWN).toMatch(/QUE SE PIERDE AL REVERTIR/i);
    expect(DOWN).toMatch(/TODAS LAS VISTAS DE TODO EL MUNDO/i);
  });

  it("⭑ ningun `down.sql` ANTERIOR fue tocado: son fotos de su rama", () => {
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
        "vista_filtro",
      );
    }
  });
});

describeSiHayBase("453 · y lo que SOLO sabe el motor: la base tiene lo que la migracion dice", () => {
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
        WHERE table_schema = 'public' AND table_name = 'vista_filtro'
        ORDER BY ordinal_position`,
    );
    // Lista LITERAL: la forma de la tabla es el contrato, y una columna de mas o de menos tiene que
    // ponerse roja aqui antes que en produccion.
    expect(columnas.map((c) => c.column_name)).toEqual([
      "id",
      "usuario_id",
      "superficie",
      "nombre",
      "filtro",
      "version",
      "created_at",
      "updated_at",
    ]);
    const porNombre = new Map(columnas.map((c) => [c.column_name, c]));
    // R6/R8: el filtro es un DOCUMENTO jsonb, no un texto serializado a mano. Un `text` aqui seria
    // la puerta de vuelta a la forma «clave=valor,valor» que el diseño descarto (design §2.4).
    expect(porNombre.get("filtro")!.data_type).toBe("jsonb");
    // R7: la version es una columna propia, y entera.
    expect(porNombre.get("version")!.data_type).toBe("integer");
    // R9/R10: el nombre es obligatorio y acotado en la base, no solo en el codigo.
    expect(porNombre.get("nombre")!.is_nullable).toBe("NO");
    for (const c of columnas) expect(c.is_nullable, `${c.column_name} deberia ser NOT NULL`).toBe("NO");

    const largoNombre = await prisma.$queryRawUnsafe<{ character_maximum_length: number }[]>(
      `SELECT character_maximum_length FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'vista_filtro' AND column_name = 'nombre'`,
    );
    expect(largoNombre[0].character_maximum_length).toBe(60);
  });

  it("⭑ R11/R35: el indice del grano es UNICO, y es el unico ademas de la PK", async () => {
    const indices = await prisma.$queryRawUnsafe<{ indexname: string; indexdef: string }[]>(
      `SELECT indexname, indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'vista_filtro'
        ORDER BY indexname`,
    );
    expect(indices.map((i) => i.indexname).sort()).toEqual([
      "vista_filtro_dueno_superficie_nombre_key",
      "vista_filtro_pkey",
    ]);
    const unico = indices.find(
      (i) => i.indexname === "vista_filtro_dueno_superficie_nombre_key",
    )!;
    // ⚠️ MUTACION: con un indice normal en vez de unico, esto se pone rojo — y con el, R11 pasaria
    // a depender de una comprobacion de codigo que dos pestañas a la vez se saltan.
    expect(unico.indexdef).toContain("UNIQUE");
    // El ORDEN de las columnas importa: `(usuario_id, superficie, nombre)` es prefijo exacto de la
    // consulta caliente. Con otro orden, el indice seguiria siendo unico y dejaria de servir para
    // la lectura, sin que nada lo delatara.
    expect(unico.indexdef).toMatch(/\(usuario_id, superficie, nombre\)/);
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
          AND tc.table_name = 'vista_filtro'`,
    );
    expect(filas).toHaveLength(1);
    expect(filas[0].delete_rule).toBe("CASCADE");
  });

  it("⭑ la RLS esta habilitada, y sin policies (patron `usuario_preferencia` / `jobs`)", async () => {
    // La RLS es una propiedad del CATALOGO: ninguna regex sobre el `.sql` demuestra que este
    // aplicada. Sin policies porque este repo no usa Supabase Auth y una policy no tendria a quien
    // preguntar; lo que garantiza es que a estas filas no se llega salvo por el servidor.
    const filas = await prisma.$queryRawUnsafe<{ relname: string; relrowsecurity: boolean }[]>(
      `SELECT c.relname, c.relrowsecurity
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = 'vista_filtro'`,
    );
    // AUTOCOMPROBACION: si la tabla no existiera, la lista saldria vacia y el bucle seria verde.
    expect(filas.map((f) => f.relname)).toEqual(["vista_filtro"]);
    expect(filas[0].relrowsecurity).toBe(true);

    const policies = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT COUNT(*)::bigint AS n FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'vista_filtro'`,
    );
    expect(Number(policies[0].n)).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// EL COMPORTAMIENTO DEL GRANO Y DEL CASCADE, EJECUTANDO EL SQL REAL EN UN ESQUEMA DESECHABLE
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describeSiHayBase("453 · el grano y el CASCADE, contra el motor", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  interface Escenario {
    tx: {
      $executeRawUnsafe: (sql: string, ...args: unknown[]) => Promise<number>;
      $queryRawUnsafe: <T = unknown>(sql: string, ...args: unknown[]) => Promise<T>;
    };
    sentenciasEjecutadas: number;
    insertarVista: (usuarioId: string, superficie: string, nombre: string) => Promise<void>;
    /**
     * Intenta insertar y dice si LA BASE lo rechazo, sin llevarse por delante la transaccion.
     *
     * ⚠️ EL SAVEPOINT NO ES ADORNO. Un error dentro de una transaccion de Postgres la deja ABORTADA
     * (`25P02`) y todo lo que venga despues falla con otro mensaje; sin el, el caso siguiente
     * reventaria por una causa que no es la suya y el rojo diria otra cosa.
     */
    rechazaVista: (usuarioId: string, superficie: string, nombre: string) => Promise<boolean>;
    contar: () => Promise<number>;
  }

  /**
   * Monta un esquema desechable con un `usuario` minimo, ejecuta ahi las sentencias REALES del
   * `migration.sql` y entrega los ayudantes al caso. Todo dentro de la transaccion revertida: el
   * esquema desaparece al hacer rollback, pase lo que pase.
   */
  async function conLaTablaRecienCreada<T>(fn: (e: Escenario) => Promise<T>): Promise<T> {
    const esquema = `t453_${Date.now().toString(36)}_${randomUUID().slice(0, 8).replace(/-/g, "")}`;
    return enTransaccionRevertida(prisma, async (tx) => {
      await tx.$executeRawUnsafe(`CREATE SCHEMA "${esquema}"`);
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${esquema}"`);
      await tx.$executeRawUnsafe(`CREATE TABLE "usuario" ("id" TEXT PRIMARY KEY)`);
      for (const id of ["ana", "beto"]) {
        await tx.$executeRawUnsafe(`INSERT INTO "usuario" ("id") VALUES ($1)`, id);
      }

      // ⚠️ Y AHORA EL SQL DEL ARCHIVO, TAL CUAL.
      const sentencias = sentenciasDe(UP);
      for (const s of sentencias) await tx.$executeRawUnsafe(s);

      const insertarVista = async (usuarioId: string, superficie: string, nombre: string) => {
        await tx.$executeRawUnsafe(
          `INSERT INTO "vista_filtro" ("id","usuario_id","superficie","nombre","filtro")
             VALUES ($1,$2,$3,$4,$5::jsonb)`,
          randomUUID(),
          usuarioId,
          superficie,
          nombre,
          JSON.stringify({ v: 1, termino: "", activos: ["zona"], seleccion: { zona: ["z-1"] } }),
        );
      };

      return fn({
        tx,
        sentenciasEjecutadas: sentencias.length,
        insertarVista,
        rechazaVista: async (usuarioId, superficie, nombre) => {
          const punto = `sp_${randomUUID().replace(/-/g, "")}`;
          await tx.$executeRawUnsafe(`SAVEPOINT ${punto}`);
          try {
            await insertarVista(usuarioId, superficie, nombre);
            await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${punto}`);
            return false;
          } catch {
            await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${punto}`);
            return true;
          }
        },
        contar: async () => {
          const f = await tx.$queryRawUnsafe<{ n: bigint }[]>(
            `SELECT COUNT(*)::bigint AS n FROM "vista_filtro"`,
          );
          return Number(f[0].n);
        },
      });
    });
  }

  it("⭑ R11: la MISMA persona no puede repetir nombre en la MISMA superficie", async () => {
    const r = await conLaTablaRecienCreada(async (e) => {
      // AUTOCOMPROBACION: se ejecutaron las tres sentencias del archivo, no una lista vacia.
      expect(e.sentenciasEjecutadas).toBe(3);
      await e.insertarVista("ana", "ordenes", "San Jose arriba");
      const choco = await e.rechazaVista("ana", "ordenes", "San Jose arriba");
      return { choco, filas: await e.contar() };
    });
    // Lo impide LA BASE, no una comprobacion de codigo que dos pestañas se saltan.
    expect(r.choco).toBe(true);
    expect(r.filas).toBe(1);
  });

  it("⭑ R35: DOS personas SI pueden tener el mismo nombre en la misma superficie", async () => {
    const r = await conLaTablaRecienCreada(async (e) => {
      await e.insertarVista("ana", "ordenes", "San Jose arriba");
      await e.insertarVista("beto", "ordenes", "San Jose arriba");
      return e.contar();
    });
    // Es la propiedad que mantiene posible publicar una vista algun dia (design §11) sin cambiar el
    // grano: si el unico fuera `(superficie, nombre)`, la primera persona le bloquearia el nombre a
    // todas las demas.
    expect(r).toBe(2);
  });

  it("⭑ el grano incluye la superficie: el mismo nombre en otra pantalla convive", async () => {
    const r = await conLaTablaRecienCreada(async (e) => {
      await e.insertarVista("ana", "ordenes", "San Jose arriba");
      await e.insertarVista("ana", "cierres-bodega", "San Jose arriba");
      return e.contar();
    });
    expect(r).toBe(2);
  });

  it("⭑ P3 (limite asumido): dos nombres que solo difieren en mayusculas CONVIVEN", async () => {
    const r = await conLaTablaRecienCreada(async (e) => {
      await e.insertarVista("ana", "ordenes", "San Jose arriba");
      await e.insertarVista("ana", "ordenes", "san jose arriba");
      return e.contar();
    });
    // Documentado y aceptado por el humano (requirements.md > P3). El dia que se quiera cambiar,
    // este caso es el que hay que dar la vuelta, y avisa de que exige un indice funcional.
    expect(r).toBe(2);
  });

  it("⭑ R4: borrar a la persona se lleva TODAS sus vistas, y solo las suyas", async () => {
    const r = await conLaTablaRecienCreada(async (e) => {
      await e.insertarVista("ana", "ordenes", "San Jose arriba");
      await e.insertarVista("ana", "ordenes", "San Jose abajo");
      await e.insertarVista("beto", "ordenes", "Cartago");
      const antes = await e.contar();
      await e.tx.$executeRawUnsafe(`DELETE FROM "usuario" WHERE "id" = 'ana'`);
      const quedan = await e.tx.$queryRawUnsafe<{ usuario_id: string }[]>(
        `SELECT "usuario_id" FROM "vista_filtro"`,
      );
      return { antes, quedan: quedan.map((f) => f.usuario_id) };
    });
    // CONTROL POSITIVO: sin el `antes`, un `DELETE` que fallara en silencio dejaria el caso verde
    // comparando dos listas vacias.
    expect(r.antes).toBe(3);
    expect(r.quedan).toEqual(["beto"]);
  });

  it("⭑ el nombre no cabe por encima de 60: lo impide la columna, no el codigo", async () => {
    const r = await conLaTablaRecienCreada(async (e) => {
      const choco = await e.rechazaVista("ana", "ordenes", "x".repeat(61));
      // Y 60 justos SI entra: sin esto, el caso pasaria igual con una columna de 10.
      await e.insertarVista("ana", "ordenes", "y".repeat(60));
      return { choco, filas: await e.contar() };
    });
    expect(r.choco).toBe(true);
    expect(r.filas).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R32 — ENCENDER UNA SUPERFICIE NUEVA NO PIDE MIGRACION, Y ESO SE MIDE EN EL MOTOR
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// ⚠️ POR QUE ESTO NO ESTABA Y HACIA FALTA (revision del 2026-09-21). El caso «NO crea ningun tipo»
// de mas arriba lee el `.sql` de ESTA migracion: es una FOTO de esta rama y no dice nada del
// futuro. Si mañana alguien convierte `superficie` en un enum de Postgres —con otra migracion—
// aquel caso seguiria verde, y sin embargo la decision 3 del humano quedaria rota: encender una
// pantalla nueva volveria a costar una migracion, y con ella la trampa del `down.sql` que recrea el
// tipo con lista, que en este repo ya borro valores en silencio.
//
// Lo que se afirma aqui se le pregunta AL MOTOR, que es lo unico que refleja TODAS las migraciones
// aplicadas y no solo la de esta carpeta.

/** El tipo real de una columna, preguntado al catalogo: `data_type`, `udt_name` y su `typtype`. */
interface TipoDeColumna {
  dataType: string;
  udtName: string;
  /** `b` = tipo base (text, int4...), `e` = ENUM, `d` = dominio, `c` = compuesto. */
  typtype: string;
}

async function tipoDeColumna(
  cliente: { $queryRawUnsafe: <T = unknown>(sql: string, ...a: unknown[]) => Promise<T> },
  esquema: string,
  tabla: string,
  columna: string,
): Promise<TipoDeColumna | null> {
  const filas = await cliente.$queryRawUnsafe<
    { data_type: string; udt_name: string; typtype: string }[]
  >(
    // `typtype` es un `"char"` de Postgres y el cliente no sabe deserializarlo: se pide como texto.
    `SELECT c.data_type, c.udt_name, t.typtype::text AS typtype
       FROM information_schema.columns c
       JOIN pg_type t ON t.typname = c.udt_name
       JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE c.table_schema = $1 AND c.table_name = $2 AND c.column_name = $3
        AND n.nspname IN ('pg_catalog', $1)`,
    esquema,
    tabla,
    columna,
  );
  if (filas.length === 0) return null;
  return { dataType: filas[0].data_type, udtName: filas[0].udt_name, typtype: filas[0].typtype };
}

describeSiHayBase("453/R32 · `superficie` es TEXT en la base, y la lista vive SOLO en el codigo", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("⭑ AUTOCOMPROBACION: el detector distingue un TEXT de un ENUM (si no, todo esto seria mudo)", async () => {
    // Se monta un enum de verdad en un esquema desechable y se le pregunta lo MISMO que se le
    // pregunta a la tabla real. Sin esta contraprueba, un detector roto —uno que devolviera siempre
    // `text`, o `null`— dejaria verde el caso de abajo sin haber medido nada.
    const esquema = `t453e_${Date.now().toString(36)}_${randomUUID().slice(0, 8).replace(/-/g, "")}`;
    const medido = await enTransaccionRevertida(prisma, async (tx) => {
      await tx.$executeRawUnsafe(`CREATE SCHEMA "${esquema}"`);
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${esquema}"`);
      await tx.$executeRawUnsafe(`CREATE TYPE "superficie_vista" AS ENUM ('ordenes')`);
      await tx.$executeRawUnsafe(
        `CREATE TABLE "vista_filtro_enum" (
           "superficie_texto" TEXT NOT NULL,
           "superficie_enum"  "superficie_vista" NOT NULL)`,
      );
      return {
        texto: await tipoDeColumna(tx, esquema, "vista_filtro_enum", "superficie_texto"),
        enumerado: await tipoDeColumna(tx, esquema, "vista_filtro_enum", "superficie_enum"),
        inexistente: await tipoDeColumna(tx, esquema, "vista_filtro_enum", "no_existe"),
      };
    });

    expect(medido.texto).toEqual({ dataType: "text", udtName: "text", typtype: "b" });
    // ⚠️ ESTA ES LA MUTACION, HECHA DENTRO DEL PROPIO TEST: asi queda demostrado que la asercion de
    // abajo TIENE forma de ponerse roja. Un enum se delata en las tres lecturas a la vez.
    expect(medido.enumerado?.dataType).toBe("USER-DEFINED");
    expect(medido.enumerado?.udtName).toBe("superficie_vista");
    expect(medido.enumerado?.typtype).toBe("e");
    // Y una columna que no existe devuelve `null`, no un falso «text».
    expect(medido.inexistente).toBeNull();
  });

  it("⭑ la columna `superficie` de la tabla REAL es `text`, no un enum ni un dominio", async () => {
    const tipo = await tipoDeColumna(prisma, "public", "vista_filtro", "superficie");

    // AUTOCOMPROBACION: si la tabla o la columna no existieran, esto seria `null` y las tres
    // aserciones de abajo no medirian nada.
    expect(tipo, "no se encontro `public.vista_filtro.superficie`").not.toBeNull();
    expect(tipo!.dataType).toBe("text");
    expect(tipo!.udtName).toBe("text");
    // El `typtype` es lo que de verdad cierra la puerta: un enum es `e` y un dominio es `d`.
    expect(tipo!.typtype).toBe("b");
  });

  it("⭑ y no hay ningun CHECK que ate los valores que `superficie` admite", async () => {
    // Un `CHECK (superficie IN ('ordenes'))` costaria lo mismo que el enum: una migracion por
    // pantalla. La tabla solo puede llevar su PK, su unico y su FK.
    const restricciones = await prisma.$queryRawUnsafe<
      { conname: string; contype: string; def: string }[]
    >(
      `SELECT c.conname, c.contype::text AS contype, pg_get_constraintdef(c.oid) AS def
         FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public' AND t.relname = 'vista_filtro'
        ORDER BY c.conname`,
    );
    // AUTOCOMPROBACION: la tabla TIENE restricciones (PK, unico y FK); una lista vacia significaria
    // que la consulta no encontro la tabla, y el barrido de abajo seria verde por vacio.
    expect(restricciones.length).toBeGreaterThanOrEqual(3);
    expect(restricciones.filter((r) => r.contype === "c")).toEqual([]);
    for (const r of restricciones) {
      expect(r.def, `${r.conname} ata los valores de superficie`).not.toMatch(
        /superficie\s*(=|IN)/i,
      );
    }
  });

  it("⭑ la BASE acepta una superficie que el codigo NO declara: la unica fuente es `SUPERFICIES_VISTA`", async () => {
    // Es la otra mitad, y es de COMPORTAMIENTO sobre la tabla REAL: encender una pantalla nueva es
    // añadir una cadena a `SUPERFICIES_VISTA` y nada mas. Si alguien convirtiera la columna en enum
    // —o le pusiera un CHECK— este `INSERT` reventaria y el caso se pondria rojo.
    const nueva = "una-superficie-que-nadie-ha-declarado-todavia";
    // Control: de verdad NO esta declarada (si alguien la añadiera, el caso dejaria de medir).
    expect(SUPERFICIES_VISTA as readonly string[]).not.toContain(nueva);

    const guardada = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const modelo = await tx.$queryRawUnsafe<{ id: string }[]>(
        `SELECT "id" FROM "usuario" LIMIT 1`,
      );
      // ⚠️ FALLA RUIDOSAMENTE con la base vacia: un `if (!modelo) return` reportaria `passed`.
      expect(modelo.length, "la tabla `usuario` esta vacia: el caso no se puede medir").toBe(1);
      const usuarioId = randomUUID();
      await tx.$executeRawUnsafe(
        `INSERT INTO "usuario"
           ("id","nombre","email","telefono","password_hash","cedula","tipo_identificacion_id","rol_id","updated_at")
         SELECT $1, '453 R32', $2, '00000000', 'x', $3,
                u."tipo_identificacion_id", u."rol_id", CURRENT_TIMESTAMP
           FROM "usuario" u WHERE u."id" = $4`,
        usuarioId,
        `453-r32-${usuarioId}@test.local`,
        `453r32-${usuarioId.slice(0, 10)}`,
        modelo[0].id,
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO "vista_filtro" ("id","usuario_id","superficie","nombre","filtro")
           VALUES ($1,$2,$3,'La de la pantalla nueva',$4::jsonb)`,
        randomUUID(),
        usuarioId,
        nueva,
        JSON.stringify({ v: 1, termino: "", activos: ["zona"], seleccion: { zona: ["z-1"] } }),
      );
      const filas = await tx.$queryRawUnsafe<{ superficie: string }[]>(
        `SELECT "superficie" FROM "vista_filtro" WHERE "usuario_id" = $1`,
        usuarioId,
      );
      return filas.map((f) => f.superficie);
    });

    expect(guardada).toEqual([nueva]);
    // Y quien la rechaza HOY es el codigo, no la base: esa es la definicion de «unica fuente».
    expect(superficieVistaSchema.safeParse(nueva).success).toBe(false);
    expect(superficieVistaSchema.safeParse("ordenes").success).toBe(true);
  });
});

describe("453/R32 · el datamodel tampoco ata la superficie (esta mitad corre sin base)", () => {
  const SCHEMA = fs.readFileSync(path.join(RAIZ, "db", "schema.prisma"), "utf8");

  it("⭑ `VistaFiltro.superficie` se declara `String`, y no hay enum de superficies en el datamodel", () => {
    const modelo = /model VistaFiltro \{([\s\S]*?)\n\}/.exec(SCHEMA);
    // AUTOCOMPROBACION: el modelo se encontro y tiene cuerpo.
    expect(modelo, "no se encontro `model VistaFiltro` en db/schema.prisma").not.toBeNull();
    expect(modelo![1].length).toBeGreaterThan(200);

    const linea = modelo![1]
      .split("\n")
      .find((l) => /^\s*superficie\s+/.test(l) && !l.trim().startsWith("//"));
    expect(linea, "el modelo ya no declara `superficie`").toBeDefined();
    expect(linea!.trim()).toMatch(/^superficie\s+String\s*$/);
    // Y ningun enum del datamodel se llama de eso: si alguien lo escribe, cae aqui.
    expect(SCHEMA).not.toMatch(/enum\s+\w*[Ss]uperficie\w*\s*\{/);
  });

  it("⭑ ninguna migracion del arbol crea un tipo para las superficies ni retipa la columna", () => {
    // El caso de mas arriba mira SOLO esta carpeta. Este barre TODAS: es la mitad que cubre el
    // futuro sin necesitar base, y la que se pone roja el dia que alguien escriba el enum.
    const carpetas = fs
      .readdirSync(MIGRACIONES, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    expect(carpetas.length).toBeGreaterThan(150);

    for (const carpeta of carpetas) {
      for (const archivo of ["migration.sql", "down.sql"]) {
        const ruta = path.join(MIGRACIONES, carpeta, archivo);
        if (!fs.existsSync(ruta)) continue;
        const sql = sinComentarios(fs.readFileSync(ruta, "utf8"));
        for (const m of sql.matchAll(/CREATE TYPE "?(\w+)"?/gi)) {
          expect(
            m[1].toLowerCase(),
            `${carpeta}/${archivo} crea un tipo de superficies`,
          ).not.toMatch(/superficie|vista_filtro/);
        }
        expect(sql, `${carpeta}/${archivo} retipa la columna superficie`).not.toMatch(
          /ALTER COLUMN "superficie" TYPE/i,
        );
      }
    }
  });
});
