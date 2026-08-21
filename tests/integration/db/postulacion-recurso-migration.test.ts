import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  serializarEscriturasReales,
} from "./_postgres-real";
import { PostulacionRecursoRepository } from "@/lib/repositories/PostulacionRecursoRepository";

// Feature 253 (T1.4, T3.3) — la migracion `*_postulacion_recurso` y el repositorio que vive encima.
// Cubre R21, R22, R23, R25, R26 y R32, mas **P2 (la purga)**.
//
// TRES BLOQUES, Y LA DIFERENCIA IMPORTA:
//
//  A. ESTATICO — lee `migration.sql`, `down.sql` y `db/schema.prisma` y los contrasta por regex.
//     No necesita Postgres. Verifica la FORMA del DDL: el CHECK escrito, la FK con RESTRICT, los
//     dos indices, `ENABLE ROW LEVEL SECURITY` y CERO `CREATE POLICY` (R22), y que el down suelte
//     la tabla ANTES que el tipo (R23).
//
//  B. LA BASE DE VERDAD — una regex no demuestra que el CHECK RECHACE, que la RLS este ENCENDIDA
//     ni que el enum tenga los dos valores. Eso son hechos del motor, y se leen de los catalogos
//     de la base ya migrada.
//
//  C. ⚠️ EL REPOSITORIO CONTRA POSTGRES DE VERDAD, Y ES LA PARTE QUE NO SE PUEDE SALTAR.
//     `tests/unit/repositories/postulacion-recurso-repository.test.ts` mide con un doble, y **un
//     doble no ve el SQL**: comprobar que el repositorio PASA `{ atendidaAt: { lt: corte } }` no
//     demuestra que Postgres deje viva una fila PENDIENTE de hace dos anos. En este repo se midio
//     cuatro veces que una mutacion del `WHERE` pasa en verde contra dobles. Por eso este bloque
//     inserta filas de verdad, ejecuta el repositorio de verdad y afirma sobre lo que la base
//     devuelve — dentro de una transaccion que SIEMPRE se revierte, asi que no queda ni una fila.
//
// Sin `DATABASE_URL` los bloques B y C se SALTAN ENTEROS y con su nombre en el reporte (nunca
// "passed"). Lo que NO hacen es saltarse por falta de DATOS: si la base no tiene un usuario para
// la FK, el bloque C FALLA con el motivo escrito. Un test que se abstiene porque la base esta
// vacia es el verde-en-falso que este archivo existe para evitar.

const ROOT = path.join(__dirname, "..", "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");
const SUFIJO = "_postulacion_recurso";

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
const schemaPrisma = fs.readFileSync(path.join(ROOT, "db", "schema.prisma"), "utf8");

/**
 * El SQL EJECUTABLE, sin lineas de comentario: la prosa de estos dos archivos nombra a proposito
 * las palabras que las aserciones NEGATIVAS buscan (`CREATE POLICY`, `DROP`, `created_at`), y sin
 * limpiar primero el test se leeria a si mismo y fallaria por su propia documentacion.
 */
function sinComentarios(sql: string): string {
  return sql
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0 && !l.trimStart().startsWith("--"))
    .join("\n");
}

const upDdl = sinComentarios(upSql);
const downDdl = sinComentarios(downSql);

// ===========================================================================================
// BLOQUE A — ESTATICO
// ===========================================================================================

describe("253 / R21 — la tabla guarda los cinco campos y el instante de creacion", () => {
  it("la carpeta trae los DOS archivos y su timestamp es posterior a la ultima de `dev`", () => {
    expect(fs.existsSync(path.join(migrationDir, "migration.sql"))).toBe(true);
    expect(fs.existsSync(path.join(migrationDir, "down.sql"))).toBe(true);
    // `20260820190000_orden_historial_origen_rechazo_tienda` era la ultima de `origin/dev` al
    // crear esta (verificado el 2026-08-20, SHA 2d946420).
    expect(path.basename(migrationDir) > "20260820190000").toBe(true);
  });

  it("declara las columnas con su nullabilidad exacta", () => {
    const cuerpo = /CREATE TABLE "postulacion_recurso" \(([\s\S]*?)\n\);/.exec(upSql)?.[1];
    expect(cuerpo).toBeDefined();
    expect(cuerpo).toMatch(/"id"\s+TEXT NOT NULL/);
    expect(cuerpo).toMatch(/"tipo"\s+"postulacion_recurso_tipo" NOT NULL/);
    expect(cuerpo).toMatch(/"nombre"\s+TEXT NOT NULL/);
    expect(cuerpo).toMatch(/"telefono"\s+TEXT NOT NULL/);
    expect(cuerpo).toMatch(/"correo"\s+TEXT NOT NULL/);
    expect(cuerpo).toMatch(/"mensaje"\s+TEXT NOT NULL/);
    expect(cuerpo).toMatch(/"created_at"\s+TIMESTAMP\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP/);
    // Las dos de la atencion son NULLABLE: NULL = pendiente.
    expect(cuerpo).toMatch(/"atendida_at"\s+TIMESTAMP\(3\),/);
    expect(cuerpo).not.toMatch(/"atendida_at"\s+TIMESTAMP\(3\) NOT NULL/);
    expect(cuerpo).toMatch(/"atendida_por_id" TEXT,/);
  });

  it("el enum del tipo se crea con exactamente `vehiculo` y `bodega`", () => {
    const m = /CREATE TYPE "postulacion_recurso_tipo" AS ENUM \(([^)]*)\)/.exec(upDdl);
    expect(m).not.toBeNull();
    expect([...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1])).toEqual(["vehiculo", "bodega"]);
  });

  it("la FK a `usuario` es RESTRICT (quien atendio es evidencia y no se pierde)", () => {
    expect(upDdl).toMatch(
      /CONSTRAINT "postulacion_recurso_atendida_por_id_fkey" FOREIGN KEY \("atendida_por_id"\)\s*\n?\s*REFERENCES "usuario"\("id"\) ON DELETE RESTRICT ON UPDATE CASCADE/,
    );
    expect(upDdl).not.toMatch(/atendida_por_id.*ON DELETE CASCADE/);
  });

  it("el CHECK obliga a que las dos columnas de la atencion vayan JUNTAS", () => {
    expect(upDdl).toMatch(/CONSTRAINT "postulacion_recurso_atendida_completa"/);
    expect(upDdl).toMatch(
      /CHECK \(\("atendida_at" IS NULL\) = \("atendida_por_id" IS NULL\)\)/,
    );
  });

  it("R25: NO hay unicidad sobre correo ni sobre telefono", () => {
    expect(upDdl).not.toMatch(/UNIQUE[\s\S]*"correo"/);
    expect(upDdl).not.toMatch(/UNIQUE[\s\S]*"telefono"/);
  });

  it("R26: los dos indices, y el compuesto es (atendida_at, created_at)", () => {
    expect(upDdl).toMatch(
      /CREATE INDEX "postulacion_recurso_atendida_at_created_at_idx"\s*\n?\s*ON "postulacion_recurso"\("atendida_at", "created_at"\)/,
    );
    expect(upDdl).toMatch(
      /CREATE INDEX "postulacion_recurso_atendida_por_id_idx"\s*\n?\s*ON "postulacion_recurso"\("atendida_por_id"\)/,
    );
  });

  it("la migracion es ADITIVA: no altera ninguna tabla preexistente", () => {
    // Lo unico que se ALTERA es la tabla que la propia migracion acaba de crear (la RLS).
    const alteradas = [...upDdl.matchAll(/ALTER TABLE "([a-z_]+)"/g)].map((m) => m[1]);
    expect([...new Set(alteradas)]).toEqual(["postulacion_recurso"]);
    expect(upDdl).not.toMatch(/\bDROP\b/);
    // `UPDATE` como SENTENCIA. El `ON UPDATE CASCADE` de la FK es otra cosa y si esta: lo que
    // se afirma aqui es que esta migracion no reinterpreta ni una fila existente.
    expect(upDdl).not.toMatch(/^\s*UPDATE\s/m);
  });
});

describe("253 / R22 — RLS encendida y SIN policies", () => {
  it("la migracion habilita Row Level Security", () => {
    expect(upDdl).toMatch(/ALTER TABLE "postulacion_recurso" ENABLE ROW LEVEL SECURITY/);
  });

  it("y NO crea ninguna policy (acceso solo por service role)", () => {
    expect(upDdl).not.toMatch(/CREATE POLICY/i);
  });
});

describe("253 / R23 — el down revierte EXACTAMENTE lo que el up crea", () => {
  it("suelta la tabla y DESPUES el tipo (el orden importa: la columna lo referencia)", () => {
    const posTabla = downDdl.indexOf('DROP TABLE IF EXISTS "postulacion_recurso"');
    const posTipo = downDdl.indexOf('DROP TYPE IF EXISTS "postulacion_recurso_tipo"');
    expect(posTabla).toBeGreaterThanOrEqual(0);
    expect(posTipo).toBeGreaterThan(posTabla);
  });

  it("SI suelta el tipo, al reves que el down de `orden_nota`: este enum lo crea esta migracion", () => {
    // `orden_nota` reusaba `rol_value`, preexistente, y por eso su down NO lleva DROP TYPE. Aqui
    // no soltarlo dejaria un tipo huerfano que impediria volver a aplicar el up.
    expect(downDdl).toMatch(/DROP TYPE IF EXISTS "postulacion_recurso_tipo"/);
  });

  it("no toca ninguna tabla ajena al revertir", () => {
    const tocadas = [...downDdl.matchAll(/DROP TABLE IF EXISTS "([a-z_]+)"/g)].map((m) => m[1]);
    expect(tocadas).toEqual(["postulacion_recurso"]);
    expect(downDdl).not.toMatch(/ALTER TABLE "(?!postulacion_recurso)/);
  });
});

describe("253 — el modelo Prisma refleja la migracion, sin drift", () => {
  it("mapea a la tabla y a las columnas snake_case", () => {
    const modelo = /model PostulacionRecurso \{[\s\S]*?\n\}/.exec(schemaPrisma)?.[0];
    expect(modelo).toBeDefined();
    expect(modelo).toMatch(/@@map\("postulacion_recurso"\)/);
    expect(modelo).toMatch(/createdAt\s+DateTime\s+@default\(now\(\)\) @map\("created_at"\)/);
    expect(modelo).toMatch(/atendidaAt\s+DateTime\?\s+@map\("atendida_at"\)/);
    expect(modelo).toMatch(/atendidaPorId\s+String\?\s+@map\("atendida_por_id"\)/);
    expect(modelo).toMatch(/onDelete: Restrict/);
    expect(modelo).toMatch(/@@index\(\[atendidaAt, createdAt\]\)/);
    expect(modelo).toMatch(/@@index\(\[atendidaPorId\]\)/);
  });

  it("`Usuario` gana la relacion inversa (sin ella Prisma no valida el esquema)", () => {
    expect(schemaPrisma).toMatch(
      /postulacionesRecursoAtendidas\s+PostulacionRecurso\[\]\s+@relation\("PostulacionRecursoAtendidaPor"\)/,
    );
  });

  it("el enum Prisma tiene los mismos dos valores que el nativo", () => {
    const bloque = /enum PostulacionRecursoTipo \{([\s\S]*?)\n\}/.exec(schemaPrisma)?.[1];
    expect(bloque).toBeDefined();
    const valores = bloque!
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("//") && !l.startsWith("@@"));
    expect(valores).toEqual(["vehiculo", "bodega"]);
  });

  it("el CHECK NO se declara en Prisma (no lo expresa) — por eso lo afirma el bloque B", () => {
    const modelo = /model PostulacionRecurso \{[\s\S]*?\n\}/.exec(schemaPrisma)![0];
    expect(modelo).not.toMatch(/atendida_completa/);
  });
});

// ===========================================================================================
// BLOQUE B — LA BASE DE VERDAD
// ===========================================================================================

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

interface ColumnaReal {
  column_name: string;
  is_nullable: string;
  data_type: string;
}

describeSiHayBase("253 / bloque B — el DDL aplicado, leido de los catalogos", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("la tabla EXISTE en la base conectada (si no, la base no esta migrada)", async () => {
    const filas = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*) AS n FROM pg_class
        WHERE relname = 'postulacion_recurso' AND relnamespace = 'public'::regnamespace`,
    );
    expect(
      Number(filas[0].n),
      "La base conectada no tiene `postulacion_recurso`. Corre `pnpm exec prisma migrate deploy`. " +
        "Este test NO se salta en este caso a proposito: si lo hiciera, R21/R22 quedarian verdes " +
        "sin haberse comprobado contra Postgres.",
    ).toBe(1);
  });

  it("R22: la RLS esta ENCENDIDA y hay CERO policies", async () => {
    const filas = await prisma.$queryRawUnsafe<
      { relrowsecurity: boolean; policies: bigint }[]
    >(
      `SELECT c.relrowsecurity,
              (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
         FROM pg_class c
        WHERE c.relname = 'postulacion_recurso' AND c.relnamespace = 'public'::regnamespace`,
    );
    expect(filas[0].relrowsecurity).toBe(true);
    expect(Number(filas[0].policies)).toBe(0);
  });

  it("el enum nativo tiene exactamente `vehiculo` y `bodega`, en ese orden", async () => {
    const filas = await prisma.$queryRawUnsafe<{ valores: string }[]>(
      `SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) AS valores
         FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
        WHERE t.typname = 'postulacion_recurso_tipo'`,
    );
    expect(filas[0].valores).toBe("vehiculo,bodega");
  });

  it("las columnas y su nullabilidad son las de la migracion", async () => {
    const columnas = await prisma.$queryRawUnsafe<ColumnaReal[]>(
      `SELECT column_name, is_nullable, data_type
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'postulacion_recurso'
        ORDER BY column_name`,
    );
    const porNombre = Object.fromEntries(columnas.map((c) => [c.column_name, c.is_nullable]));
    expect(porNombre).toEqual({
      id: "NO",
      tipo: "NO",
      nombre: "NO",
      telefono: "NO",
      correo: "NO",
      mensaje: "NO",
      created_at: "NO",
      atendida_at: "YES",
      atendida_por_id: "YES",
    });
  });

  it("el CHECK `atendida_completa` EXISTE en la base, no solo en el .sql", async () => {
    const filas = await prisma.$queryRawUnsafe<{ conname: string; def: string }[]>(
      `SELECT con.conname, pg_get_constraintdef(con.oid) AS def
         FROM pg_constraint con
         JOIN pg_class c ON c.oid = con.conrelid
        WHERE c.relname = 'postulacion_recurso' AND con.contype = 'c'`,
    );
    const check = filas.find((f) => f.conname === "postulacion_recurso_atendida_completa");
    expect(check, "falta el CHECK que empareja atendida_at con atendida_por_id").toBeDefined();
    expect(check!.def).toMatch(/atendida_at IS NULL/);
    expect(check!.def).toMatch(/atendida_por_id IS NULL/);
  });

  it("la FK a `usuario` esta aplicada con RESTRICT (`r`), no con CASCADE", async () => {
    const filas = await prisma.$queryRawUnsafe<{ confdeltype: string }[]>(
      // `confdeltype` es `"char"`, que el driver adapter no sabe deserializar: se castea a texto.
      `SELECT con.confdeltype::text AS confdeltype
         FROM pg_constraint con
         JOIN pg_class c ON c.oid = con.conrelid
        WHERE c.relname = 'postulacion_recurso'
          AND con.conname = 'postulacion_recurso_atendida_por_id_fkey'`,
    );
    expect(filas).toHaveLength(1);
    expect(filas[0].confdeltype).toBe("r"); // r = RESTRICT; c seria CASCADE
  });

  it("R26: los dos indices existen con la forma que sirve al panel y al cron", async () => {
    const filas = await prisma.$queryRawUnsafe<{ indexname: string; indexdef: string }[]>(
      `SELECT indexname, indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'postulacion_recurso'
        ORDER BY indexname`,
    );
    const porNombre = Object.fromEntries(filas.map((f) => [f.indexname, f.indexdef]));
    expect(Object.keys(porNombre).sort()).toEqual([
      "postulacion_recurso_atendida_at_created_at_idx",
      "postulacion_recurso_atendida_por_id_idx",
      "postulacion_recurso_pkey",
    ]);
    expect(porNombre["postulacion_recurso_atendida_at_created_at_idx"]).toMatch(
      /\(atendida_at, created_at\)/,
    );
  });

  it("el CHECK RECHAZA de verdad una atencion a medias (esto no lo prueba ninguna regex)", async () => {
    const prisma2 = crearPrismaDeTest();
    try {
      const error = await enTransaccionRevertida(prisma2, async (tx) => {
        await serializarEscriturasReales(tx);
        try {
          await tx.$executeRawUnsafe(
            `INSERT INTO "postulacion_recurso"
               ("id","tipo","nombre","telefono","correo","mensaje","atendida_at","atendida_por_id")
             VALUES ($1, 'vehiculo', 'X', '88888888', 'x@y.z', 'm', NOW(), NULL)`,
            randomUUID(),
          );
          return null;
        } catch (e) {
          return e instanceof Error ? e.message : String(e);
        }
      });
      expect(error, "la fila con `atendida_at` y sin responsable NO fue rechazada").not.toBeNull();
      expect(error).toContain("postulacion_recurso_atendida_completa");
    } finally {
      await prisma2.$disconnect();
    }
  }, 60_000);
});

// ===========================================================================================
// BLOQUE C — EL REPOSITORIO CONTRA POSTGRES DE VERDAD
// ===========================================================================================

/** Fechas del escenario, fijas para que el test no dependa del dia en que se corre. */
const HACE_DOS_ANIOS = new Date("2024-08-20T10:00:00.000Z");
const HACE_UN_ANIO = new Date("2025-08-20T10:00:00.000Z");
const AYER = new Date("2026-08-19T10:00:00.000Z");
/** Corte de la purga en el escenario: 6 meses antes del 2026-08-20. */
const CORTE = new Date("2026-02-20T00:00:00.000Z");

describeSiHayBase("253 / bloque C — el repositorio REAL contra la base REAL", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  /**
   * Un usuario existente para la FK de `atendida_por_id`. Se LEE, no se crea: este bloque no
   * escribe una sola fila en `usuario`. Si no hay ninguno, FALLA con el motivo — no se salta.
   */
  async function unUsuario(tx: {
    $queryRawUnsafe: <T>(sql: string) => Promise<T>;
  }): Promise<string> {
    const filas = await tx.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM public."usuario" ORDER BY id LIMIT 1`,
    );
    if (filas.length === 0) {
      throw new Error(
        "La base de pruebas no tiene ni un usuario en `public.usuario`: sin el, la FK " +
          "`postulacion_recurso_atendida_por_id_fkey` no deja marcar nada como atendido. Corre " +
          "`pnpm db:seed:maestro`. Este bloque NO se salta en este caso (si lo hiciera, R32 y la " +
          "purga quedarian verdes sin haberse comprobado contra Postgres).",
      );
    }
    return filas[0].id;
  }

  /** Inserta una postulacion con instantes controlados. Devuelve su id. */
  async function sembrar(
    tx: { $executeRawUnsafe: (sql: string, ...args: unknown[]) => Promise<number> },
    datos: {
      tipo: "vehiculo" | "bodega";
      correo: string;
      createdAt: Date;
      atendidaAt?: Date;
      atendidaPorId?: string;
    },
  ): Promise<string> {
    const id = randomUUID();
    await tx.$executeRawUnsafe(
      `INSERT INTO "postulacion_recurso"
         ("id","tipo","nombre","telefono","correo","mensaje","created_at","atendida_at","atendida_por_id")
       VALUES ($1, $2::"postulacion_recurso_tipo", $3, $4, $5, $6, $7, $8, $9)`,
      id,
      datos.tipo,
      "Persona de prueba 253",
      "88888888",
      datos.correo,
      "mensaje de prueba 253",
      datos.createdAt,
      datos.atendidaAt ?? null,
      datos.atendidaPorId ?? null,
    );
    return id;
  }

  it("R25: dos postulaciones con el MISMO correo conviven como dos filas", async () => {
    const resultado = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const repo = new PostulacionRecursoRepository(tx as unknown as PrismaClient);

      const uno = await repo.crear({
        tipo: "vehiculo",
        nombre: "Ana",
        telefono: "88888888",
        correo: "misma@persona.com",
        mensaje: "tengo un camion",
      });
      const dos = await repo.crear({
        tipo: "bodega",
        nombre: "Ana",
        telefono: "88888888",
        correo: "misma@persona.com",
        mensaje: "y tambien una bodega",
      });

      const filas = await tx.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT count(*) AS n FROM "postulacion_recurso" WHERE correo = 'misma@persona.com'`,
      );
      return { uno: uno.id, dos: dos.id, n: Number(filas[0].n) };
    });

    expect(resultado.uno).not.toBe(resultado.dos);
    expect(resultado.n).toBe(2);
  }, 60_000);

  it("R26: `listar` trae SOLO las pendientes, de la mas reciente a la mas antigua", async () => {
    const resultado = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const usuarioId = await unUsuario(tx);
      // La transaccion se revierte, pero la tabla puede tener filas de otras corridas: se acota
      // por un correo propio de este caso para que la asercion no dependa del estado previo.
      const marca = `r26-${randomUUID()}@prueba.local`;

      const vieja = await sembrar(tx, { tipo: "vehiculo", correo: marca, createdAt: HACE_UN_ANIO });
      const nueva = await sembrar(tx, { tipo: "bodega", correo: marca, createdAt: AYER });
      const atendida = await sembrar(tx, {
        tipo: "vehiculo",
        correo: marca,
        createdAt: HACE_DOS_ANIOS,
        atendidaAt: AYER,
        atendidaPorId: usuarioId,
      });

      const repo = new PostulacionRecursoRepository(tx as unknown as PrismaClient);
      const pendientes = await repo.listar({ atendidas: false, skip: 0, take: 100 });
      const atendidas = await repo.listar({ atendidas: true, skip: 0, take: 100 });

      return {
        vieja,
        nueva,
        atendida,
        idsPendientes: pendientes.items.filter((i) => i.correo === marca).map((i) => i.id),
        idsAtendidas: atendidas.items.filter((i) => i.correo === marca).map((i) => i.id),
        nombreDeQuienAtendio: atendidas.items.find((i) => i.id === atendida)?.atendidaPorNombre,
      };
    });

    // Orden: la de ayer antes que la del ano pasado (`created_at DESC`).
    expect(resultado.idsPendientes).toEqual([resultado.nueva, resultado.vieja]);
    // Y la atendida NO aparece entre las pendientes.
    expect(resultado.idsPendientes).not.toContain(resultado.atendida);
    // R33: la segunda pestana si la trae, con el NOMBRE de quien la atendio (JOIN real).
    expect(resultado.idsAtendidas).toEqual([resultado.atendida]);
    expect(resultado.nombreDeQuienAtendio).toBeTruthy();
  }, 60_000);

  it("R32: `marcarAtendida` devuelve 1 la primera vez y 0 la segunda, sin sobrescribir", async () => {
    const resultado = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const usuarioId = await unUsuario(tx);
      const repo = new PostulacionRecursoRepository(tx as unknown as PrismaClient);

      const { id } = await repo.crear({
        tipo: "vehiculo",
        nombre: "Ana",
        telefono: "88888888",
        correo: `r32-${randomUUID()}@prueba.local`,
        mensaje: "camion",
      });

      const primero = new Date("2026-08-20T08:00:00.000Z");
      const segundo = new Date("2026-08-20T18:00:00.000Z");
      const count1 = await repo.marcarAtendida(id, usuarioId, primero);
      const count2 = await repo.marcarAtendida(id, usuarioId, segundo);

      const fila = await repo.findById(id);
      return { count1, count2, atendidaAt: fila?.atendidaAt?.toISOString() ?? null };
    });

    expect(resultado.count1).toBe(1);
    // ⚠️ ESTE `0` es la anti-carrera. Sin `atendidaAt: null` en el `where` seria `1`, y el segundo
    // administrador borraria el rastro del primero.
    expect(resultado.count2).toBe(0);
    // Y el instante conservado es el del PRIMERO.
    expect(resultado.atendidaAt).toBe("2026-08-20T08:00:00.000Z");
  }, 60_000);

  it("`marcarAtendida` sobre un id inexistente devuelve 0 y `findById` devuelve null", async () => {
    const resultado = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const usuarioId = await unUsuario(tx);
      const repo = new PostulacionRecursoRepository(tx as unknown as PrismaClient);
      const inexistente = randomUUID();
      return {
        count: await repo.marcarAtendida(inexistente, usuarioId, new Date()),
        fila: await repo.findById(inexistente),
      };
    });

    expect(resultado.count).toBe(0);
    expect(resultado.fila).toBeNull();
  }, 60_000);

  // -----------------------------------------------------------------------------------------
  // P2 — LA PURGA. Aqui esta la unica garantia que de verdad importa.
  // -----------------------------------------------------------------------------------------

  it("⛔ P2: una postulacion PENDIENTE de hace DOS ANOS **SOBREVIVE** a la purga", async () => {
    const resultado = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const usuarioId = await unUsuario(tx);
      const marca = `p2-${randomUUID()}@prueba.local`;

      // (a) PENDIENTE de hace dos anos. NUNCA se borra, por antigua que sea.
      const pendienteAntigua = await sembrar(tx, {
        tipo: "vehiculo",
        correo: marca,
        createdAt: HACE_DOS_ANIOS,
      });
      // (b) ATENDIDA hace dos anos: esta SI se borra (esta por detras del corte).
      const atendidaAntigua = await sembrar(tx, {
        tipo: "bodega",
        correo: marca,
        createdAt: HACE_DOS_ANIOS,
        atendidaAt: HACE_DOS_ANIOS,
        atendidaPorId: usuarioId,
      });
      // (c) CREADA hace dos anos pero ATENDIDA AYER: NO se borra. Es el caso que distingue
      //     `atendida_at` de `created_at`: por `created_at` seria la mas vieja de todas.
      const viejaAtendidaAyer = await sembrar(tx, {
        tipo: "vehiculo",
        correo: marca,
        createdAt: HACE_DOS_ANIOS,
        atendidaAt: AYER,
        atendidaPorId: usuarioId,
      });

      const repo = new PostulacionRecursoRepository(tx as unknown as PrismaClient);
      const borradas = await repo.purgarAtendidasAnterioresA(CORTE, 500);

      const vivas = await tx.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id FROM "postulacion_recurso" WHERE correo = $1 ORDER BY created_at`,
        marca,
      );

      return {
        borradas,
        pendienteAntigua,
        atendidaAntigua,
        viejaAtendidaAyer,
        vivas: vivas.map((v) => v.id),
      };
    });

    // ⛔ LA ASERCION DE LA FICHA: lo pendiente sigue ahi.
    expect(
      resultado.vivas,
      "una postulacion PENDIENTE de hace dos anos fue borrada por la purga",
    ).toContain(resultado.pendienteAntigua);
    // Lo creado hace dos anos pero atendido AYER tambien sigue ahi: el corte es sobre la ATENCION.
    expect(
      resultado.vivas,
      "se borro una postulacion atendida AYER: el corte esta mirando `created_at`",
    ).toContain(resultado.viejaAtendidaAyer);
    // Y lo atendido hace dos anos se fue, que es para lo que existe el cron.
    expect(resultado.vivas).not.toContain(resultado.atendidaAntigua);
    expect(resultado.borradas).toBe(1);
  }, 60_000);

  it("P2: sin nada por detras del corte, la purga no borra NADA (y no es un error)", async () => {
    const resultado = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const usuarioId = await unUsuario(tx);
      const marca = `p2b-${randomUUID()}@prueba.local`;
      const id = await sembrar(tx, {
        tipo: "bodega",
        correo: marca,
        createdAt: HACE_DOS_ANIOS,
        atendidaAt: AYER,
        atendidaPorId: usuarioId,
      });

      const repo = new PostulacionRecursoRepository(tx as unknown as PrismaClient);
      // Corte MUY antiguo: nada cae por detras.
      const borradas = await repo.purgarAtendidasAnterioresA(new Date("2020-01-01T00:00:00Z"), 500);
      const vivas = await tx.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id FROM "postulacion_recurso" WHERE correo = $1`,
        marca,
      );
      return { borradas, id, vivas: vivas.map((v) => v.id) };
    });

    expect(resultado.borradas).toBe(0);
    expect(resultado.vivas).toEqual([resultado.id]);
  }, 60_000);

  it("P2: el tope por corrida se respeta, y lo que no entra SIGUE VIVO para manana", async () => {
    const resultado = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const usuarioId = await unUsuario(tx);
      const marca = `p2c-${randomUUID()}@prueba.local`;

      for (let i = 0; i < 5; i += 1) {
        await sembrar(tx, {
          tipo: "vehiculo",
          correo: marca,
          createdAt: HACE_DOS_ANIOS,
          // Instantes crecientes: el orden ASC del repositorio elige los DOS mas viejos.
          atendidaAt: new Date(HACE_DOS_ANIOS.getTime() + i * 86_400_000),
          atendidaPorId: usuarioId,
        });
      }

      const repo = new PostulacionRecursoRepository(tx as unknown as PrismaClient);
      const borradas = await repo.purgarAtendidasAnterioresA(CORTE, 2);
      const vivas = await tx.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT count(*) AS n FROM "postulacion_recurso" WHERE correo = $1`,
        marca,
      );
      return { borradas, vivas: Number(vivas[0].n) };
    });

    expect(resultado.borradas).toBe(2);
    expect(resultado.vivas).toBe(3);
  }, 60_000);
});
