import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { HAY_BASE_DE_DATOS, crearPrismaDeTest } from "./_postgres-real";

// FICHA 410 (T1.2/T1.3, R49) — LAS DOS MIGRACIONES Y SUS `down.sql`.
//
// Dos mitades, y hacen falta las dos:
//   · lo que se puede leer del `.sql` (que el `down` revierta lo que el `up` hace, que la lista del
//     enum sea la correcta, que no se haya tocado ningun `down.sql` anterior);
//   · lo que SOLO se puede preguntarle al MOTOR (que las tablas existan con su forma, que el valor
//     `push_web` este en el enum, que los indices esten donde se dijo). Una regex sobre el `.sql`
//     demuestra lo que ALGUIEN ESCRIBIO, no lo que la base tiene.

const RAIZ = path.resolve(__dirname, "..", "..", "..");
const MIGRACIONES = path.join(RAIZ, "db", "migrations");
const TABLAS = "20260912120000_push_suscripcion";
const ENUM = "20260912120100_job_tipo_push_web";

function leer(carpeta: string, archivo: string): string {
  return fs.readFileSync(path.join(MIGRACIONES, carpeta, archivo), "utf8");
}

/**
 * El SQL sin las lineas de comentario. Hace falta para afirmar sobre el ORDEN de las sentencias: la
 * prosa de estos archivos NOMBRA las sentencias que explica («Postgres no soporta
 * `ALTER TYPE ... DROP VALUE`»), asi que un `indexOf` sobre el texto crudo encuentra el comentario
 * antes que el codigo y mide otra cosa.
 */
function sinComentarios(sql: string): string {
  return sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
}

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describe("410/R49 — las dos migraciones existen y cada una trae su `down.sql`", () => {
  it("⭑ los cuatro archivos estan, y ninguno esta vacio", () => {
    for (const carpeta of [TABLAS, ENUM]) {
      for (const archivo of ["migration.sql", "down.sql"]) {
        const contenido = leer(carpeta, archivo);
        expect(contenido.length, `${carpeta}/${archivo} vacio`).toBeGreaterThan(200);
      }
    }
  });

  it("⭑ el enum va EN CARPETA APARTE, y despues de las tablas (55P04)", () => {
    // Postgres NO deja usar un valor de enum en la misma transaccion que lo anadio, y Prisma corre
    // cada `migration.sql` en una transaccion. Mismo criterio que las ocho hermanas anteriores.
    expect(Number(ENUM.slice(0, 14))).toBeGreaterThan(Number(TABLAS.slice(0, 14)));
    const up = leer(ENUM, "migration.sql");
    expect(up).toContain(`ALTER TYPE "job_tipo" ADD VALUE IF NOT EXISTS 'push_web'`);
    // Y NADA MAS: una migracion de enum que ademas toque una tabla es la que revienta con 55P04.
    const sentencias = up
      .split("\n")
      .filter((l) => !l.trim().startsWith("--") && l.trim() !== "");
    expect(sentencias).toHaveLength(1);
  });
});

describe("410/R49 — el `down.sql` de las tablas revierte EXACTAMENTE lo que el `up` crea", () => {
  const up = leer(TABLAS, "migration.sql");
  const down = leer(TABLAS, "down.sql");

  it("⭑ el `up` crea las dos tablas, sus indices y la RLS de las dos", () => {
    expect(up).toMatch(/CREATE TABLE "push_suscripcion"/);
    expect(up).toMatch(/CREATE TABLE "push_envio_dia"/);
    expect(up).toMatch(/CREATE UNIQUE INDEX "push_suscripcion_endpoint_key"/);
    expect(up).toMatch(/CREATE UNIQUE INDEX "push_envio_dia_cupo"/);
    expect(up).toMatch(/ALTER TABLE "push_suscripcion" ENABLE ROW LEVEL SECURITY/);
    expect(up).toMatch(/ALTER TABLE "push_envio_dia" ENABLE ROW LEVEL SECURITY/);
  });

  it("⭑ el `down` suelta las dos tablas, y NADA MAS", () => {
    expect(down).toMatch(/DROP TABLE IF EXISTS "push_envio_dia"/);
    expect(down).toMatch(/DROP TABLE IF EXISTS "push_suscripcion"/);
    // El orden importa: `push_envio_dia` primero (no hay dependencia entre ellas, pero se revierte
    // en orden inverso al `up`, que es la regla del repo).
    expect(down.indexOf("push_envio_dia")).toBeLessThan(down.lastIndexOf("push_suscripcion"));
  });

  it("⭑ el `down` NO toca `notificacion` ni ninguna tabla preexistente", () => {
    // Lo que se revierte es el TRANSPORTE, no el hecho: los avisos siguen en la campana. Y aqui no
    // hay ni un `UPDATE` ni un `INSERT` para «reparar» nada.
    const codigo = down
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
    expect(codigo).not.toMatch(/\bUPDATE\b/i);
    expect(codigo).not.toMatch(/\bINSERT\b/i);
    expect(codigo).not.toMatch(/"notificacion"/);
    expect(codigo).not.toMatch(/"usuario"/);
  });

  it("⭑ el `up` es ADITIVO: no altera ninguna tabla que ya existiera", () => {
    // `ALTER TABLE` solo aparece para habilitar la RLS de las DOS tablas NUEVAS.
    const alters = [...up.matchAll(/^ALTER TABLE "(\w+)"/gm)].map((m) => m[1]);
    expect([...new Set(alters)].sort()).toEqual(["push_envio_dia", "push_suscripcion"]);
    expect(up).not.toMatch(/\bDROP\b/);
    expect(up).not.toMatch(/^\s*(UPDATE|DELETE|INSERT)\b/im);
  });
});

describe("410/R49 — el `down.sql` del enum, y la leccion de recrear con lista", () => {
  const down = leer(ENUM, "down.sql");

  it("⭑ borra las filas de `jobs` de ese tipo ANTES del `ALTER`", () => {
    // Sin el `DELETE`, el `ALTER TABLE ... USING` falla RUIDOSAMENTE (el valor ya no existe en el
    // tipo nuevo) y el rollback aborta. Criterio identico al de las ocho hermanas.
    expect(down).toMatch(/DELETE FROM "jobs" WHERE "tipo" = 'push_web'/);
    const codigo = sinComentarios(down);
    expect(codigo.indexOf('DELETE FROM "jobs"')).toBeLessThan(codigo.indexOf("ALTER TYPE"));
  });

  it("⭑ recrea el enum con los NUEVE valores previos, en su orden, y sin `push_web`", () => {
    const m = /CREATE TYPE "job_tipo" AS ENUM \(([^)]+)\);/.exec(down);
    expect(m, "no se encontro la recreacion del enum").not.toBeNull();
    const valores = m![1].split(",").map((v) => v.trim().replace(/^'|'$/g, ""));
    // LISTA LITERAL, escrita a mano y copiada de `db/schema.prisma` en `origin/dev` @ ca697141.
    // ⚠️ ES UNA FOTO DE ESTA RAMA. Si otra ficha anade un valor a `job_tipo` y entra en `dev`
    // antes que esta, revertir con esta lista LO BORRARIA EN SILENCIO: el `USING` no falla,
    // simplemente ese valor deja de existir. Hay que releerla contra `origin/dev` antes del PR.
    expect(valores).toEqual([
      "liberar_reprogramadas",
      "geocodificacion",
      "optimizacion_ruta",
      "webhook_estado",
      "whatsapp_template_sync",
      "whatsapp_chat_envio",
      "analitica_rollup_diario",
      "analitica_invalidacion_cache",
      "whatsapp_bienvenida",
    ]);
    expect(valores).not.toContain("push_web");
  });

  it("⭑ suelta y recrea el indice PARCIAL de la 401 alrededor del cambio de tipo", () => {
    // ⚠️ ESTE PASO NO ESTABA EN LAS OCHO HERMANAS, y hace falta desde el 2026-09-10. La 401 creo
    // `jobs_geocodificacion_estado_updated_idx`, cuyo predicado es `WHERE "tipo" = 'geocodificacion'`.
    // Ese literal queda tipado como `job_tipo_old` en cuanto se renombra el tipo, asi que el
    // `ALTER TABLE ... USING` —que reconstruye los indices dependientes— muere con
    // «operator does not exist: job_tipo = job_tipo_old». MEDIDO contra la base local, no deducido.
    expect(down).toMatch(/DROP INDEX IF EXISTS "jobs_geocodificacion_estado_updated_idx"/);
    expect(down).toMatch(/CREATE INDEX IF NOT EXISTS "jobs_geocodificacion_estado_updated_idx"/);
    const codigo = sinComentarios(down);
    expect(codigo.indexOf("DROP INDEX")).toBeLessThan(codigo.indexOf("ALTER TYPE"));
    expect(codigo.lastIndexOf("CREATE INDEX")).toBeGreaterThan(codigo.indexOf("DROP TYPE"));
  });

  it("⭑ ningun `down.sql` ANTERIOR menciona `push_web`: son fotos de su momento", () => {
    // La regla de este repo: un `down.sql` ya aplicado NO se toca. Cada uno describe el estado del
    // enum en SU rama, y todas siguen siendo ciertas porque el rollback va de la ultima hacia atras.
    const anteriores = fs
      .readdirSync(MIGRACIONES, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name.includes("job_tipo") && e.name !== ENUM)
      .map((e) => e.name);
    // AUTOCOMPROBACION: si el recorrido no encontrara carpetas, el barrido seria verde por vacio.
    expect(anteriores.length).toBeGreaterThanOrEqual(8);
    for (const carpeta of anteriores) {
      expect(leer(carpeta, "down.sql"), `${carpeta} fue tocado`).not.toContain("push_web");
    }
  });
});

describeSiHayBase("410 — y lo que SOLO sabe el motor: la base tiene lo que la migracion dice", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("⭑ `push_web` esta en el enum `job_tipo`, y al final", async () => {
    const valores = await prisma.$queryRawUnsafe<{ enumlabel: string }[]>(
      `SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'job_tipo' ORDER BY e.enumsortorder`,
    );
    const lista = valores.map((v) => v.enumlabel);
    expect(lista.length).toBeGreaterThanOrEqual(10);
    expect(lista).toContain("push_web");
    // «Al final»: los valores previos conservan su orden de comparacion.
    expect(lista[lista.length - 1]).toBe("push_web");
  });

  it("⭑ las dos tablas existen con sus columnas", async () => {
    const columnas = await prisma.$queryRawUnsafe<{ table_name: string; column_name: string }[]>(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name IN ('push_suscripcion','push_envio_dia')
        ORDER BY table_name, ordinal_position`,
    );
    const por = (t: string) =>
      columnas.filter((c) => c.table_name === t).map((c) => c.column_name);
    // Listas LITERALES: la forma de la tabla es el contrato, y una columna de mas o de menos
    // tiene que ponerse roja aqui antes que en produccion.
    expect(por("push_suscripcion")).toEqual([
      "id",
      "usuario_id",
      "endpoint",
      "p256dh",
      "auth",
      "etiqueta",
      "ultimo_envio_ok_at",
      "created_at",
      "updated_at",
    ]);
    expect(por("push_envio_dia")).toEqual([
      "id",
      "usuario_id",
      "evento",
      "dia_cr",
      "notificacion_id",
      "created_at",
    ]);
  });

  it("⭑ los dos indices unicos existen de verdad", async () => {
    const indices = await prisma.$queryRawUnsafe<{ indexname: string; indexdef: string }[]>(
      `SELECT indexname, indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND tablename IN ('push_suscripcion','push_envio_dia')
        ORDER BY indexname`,
    );
    const nombres = indices.map((i) => i.indexname);
    expect(nombres).toContain("push_suscripcion_endpoint_key");
    expect(nombres).toContain("push_envio_dia_cupo");
    expect(nombres).toContain("push_suscripcion_usuario_id_idx");
    const cupo = indices.find((i) => i.indexname === "push_envio_dia_cupo")!;
    expect(cupo.indexdef).toContain("UNIQUE");
    expect(cupo.indexdef).toMatch(/usuario_id.*evento.*dia_cr/);
  });

  it("⭑ las dos FK a `usuario` son CASCADE", async () => {
    const filas = await prisma.$queryRawUnsafe<{ table_name: string; delete_rule: string }[]>(
      `SELECT tc.table_name, rc.delete_rule
         FROM information_schema.table_constraints tc
         JOIN information_schema.referential_constraints rc
           ON rc.constraint_name = tc.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_name IN ('push_suscripcion','push_envio_dia')
        ORDER BY tc.table_name`,
    );
    expect(filas.map((f) => f.table_name)).toEqual(["push_envio_dia", "push_suscripcion"]);
    for (const f of filas) expect(f.delete_rule, `${f.table_name}`).toBe("CASCADE");
  });

  it("⭑ `push_envio_dia.notificacion_id` NO tiene FK, y es deliberado", async () => {
    // La fila del aviso puede borrarse y el cupo del dia tiene que seguir gastado. Es el mismo
    // criterio polimorfico de `notificacion.entidad_id`.
    const filas = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT COUNT(*)::bigint AS n
         FROM information_schema.key_column_usage k
         JOIN information_schema.table_constraints tc
           ON tc.constraint_name = k.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND k.table_name = 'push_envio_dia' AND k.column_name = 'notificacion_id'`,
    );
    expect(Number(filas[0].n)).toBe(0);
  });
});
