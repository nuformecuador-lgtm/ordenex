import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { HAY_BASE_DE_DATOS } from "../_postgres-real";
import { conEscenario, prepararMundo, type Escenario, type Mundo } from "./_escenario";

/**
 * FICHA 454 (T1.2) — M1 (`job_tipo` gana `webhook_evento`) y M2 (`orden_evento`), CONTRA POSTGRES.
 *
 * Una regex sobre el `.sql` demuestra lo que alguien ESCRIBIO; lo que la base HACE (que los CHECK
 * rechacen, que el indice unico parcial exista y muerda, que la RLS este encendida) solo lo dice el
 * motor. Todo lo que escribe corre en una transaccion que SIEMPRE se revierte (una por caso: un
 * error de Postgres aborta la transaccion entera).
 *
 * El up → down → up de M1 y M2 se ejecuto en la base local al escribirlas (registrado en
 * `progress/impl_454_backend.md`); aqui se afirma la forma que el up deja.
 */

const RAIZ = path.resolve(__dirname, "..", "..", "..", "..");
const MIGRACIONES = path.join(RAIZ, "db", "migrations");
const M1 = "20260923120000_job_tipo_webhook_evento";
const M2 = "20260923120100_orden_evento";

const leer = (carpeta: string, archivo: string) =>
  fs.readFileSync(path.join(MIGRACIONES, carpeta, archivo), "utf8");
const sinComentarios = (sql: string) =>
  sql
    .split("\n")
    .filter((l) => l.trim().length > 0 && !l.trimStart().startsWith("--"))
    .join("\n");

describe("454/T1.2 — M1 y M2, leidas del archivo", () => {
  it("M1 es SOLO el `ADD VALUE` (Postgres prohibe usarlo en la misma transaccion, 55P04)", () => {
    const sentencias = sinComentarios(leer(M1, "migration.sql"))
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    expect(sentencias).toEqual([`ALTER TYPE "job_tipo" ADD VALUE IF NOT EXISTS 'webhook_evento'`]);
  });

  it("el down de M1 borra los jobs del tipo ANTES de recrear el enum con los DIEZ previos, en su orden", () => {
    const down = sinComentarios(leer(M1, "down.sql"));
    expect(down.indexOf(`DELETE FROM "jobs" WHERE "tipo" = 'webhook_evento'`)).toBeGreaterThanOrEqual(0);
    expect(down.indexOf('DELETE FROM "jobs"')).toBeLessThan(down.indexOf("ALTER TYPE"));
    const m = /CREATE TYPE "job_tipo" AS ENUM \(([^)]+)\);/.exec(down);
    expect(m).not.toBeNull();
    const valores = (m as RegExpExecArray)[1].split(",").map((v) => v.trim().replace(/^'|'$/g, ""));
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
      "push_web",
    ]);
    // El indice parcial de la 401 se suelta antes y se recrea despues (medido el 2026-09-10).
    expect(down.indexOf("DROP INDEX IF EXISTS \"jobs_geocodificacion_estado_updated_idx\"")).toBeLessThan(
      down.indexOf("ALTER TYPE"),
    );
    expect(down.lastIndexOf("CREATE INDEX")).toBeGreaterThan(down.indexOf("DROP TYPE"));
  });

  it("M2 es ADITIVA: no altera ni escribe en ninguna tabla preexistente", () => {
    const up = sinComentarios(leer(M2, "migration.sql"));
    expect(up).toMatch(/CREATE TABLE "orden_evento"/);
    expect(up).not.toMatch(/ALTER TABLE "(?!orden_evento")/);
    expect(up).not.toMatch(/^\s*(UPDATE|DELETE|INSERT)\s/im);
    expect(up).not.toMatch(/ALTER TYPE/);
  });

  it("el down de M2 es exactamente el DROP de lo que el up creo", () => {
    const down = sinComentarios(leer(M2, "down.sql"));
    expect(down.split(";").map((s) => s.trim()).filter(Boolean)).toEqual([
      'DROP TABLE IF EXISTS "orden_evento"',
      'DROP TYPE IF EXISTS "orden_evento_tipo"',
    ]);
  });

  it("ningun down.sql ANTERIOR menciona `webhook_evento` ni `orden_evento`: son fotos de su momento", () => {
    const anteriores = fs
      .readdirSync(MIGRACIONES, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name < M1)
      .map((e) => e.name);
    expect(anteriores.length).toBeGreaterThan(200);
    for (const c of anteriores) {
      const p = path.join(MIGRACIONES, c, "down.sql");
      if (!fs.existsSync(p)) continue;
      const down = fs.readFileSync(p, "utf8");
      expect(down, c).not.toContain("webhook_evento");
      expect(down, c).not.toContain("orden_evento");
    }
  });
});

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("454/T1.2 — la forma de `orden_evento` y de `job_tipo`, tal como Postgres las tiene", () => {
  let mundo: Mundo;

  beforeAll(async () => {
    mundo = await prepararMundo();
  }, 60_000);

  afterAll(async () => {
    await mundo?.prisma.$disconnect();
  });

  it("`job_tipo` tiene `webhook_evento` (y siguen los diez de antes)", async () => {
    const filas = await mundo.prisma.$queryRaw<{ v: string }[]>`
      SELECT e.enumlabel AS v FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
        JOIN pg_namespace n ON n.oid = t.typnamespace
       WHERE n.nspname = 'public' AND t.typname = 'job_tipo' ORDER BY e.enumsortorder`;
    const valores = filas.map((f) => f.v);
    expect(valores).toContain("webhook_evento");
    expect(valores).toContain("push_web");
    expect(valores.length).toBeGreaterThanOrEqual(11);
  });

  it("`orden_evento_tipo` tiene los SEIS tipos, en su orden", async () => {
    const filas = await mundo.prisma.$queryRaw<{ v: string }[]>`
      SELECT e.enumlabel AS v FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
        JOIN pg_namespace n ON n.oid = t.typnamespace
       WHERE n.nspname = 'public' AND t.typname = 'orden_evento_tipo' ORDER BY e.enumsortorder`;
    expect(filas.map((f) => f.v)).toEqual([
      "gestion_registrada",
      "gestion_anulada",
      "gestion_corregida",
      "ayuda_solicitada",
      "ayuda_rescatada",
      "ayuda_habilitada_api",
    ]);
  });

  it("append-only: sin `updated_at` ni `deleted_at`; NOT NULL donde el diseño lo dice", async () => {
    const cols = await mundo.prisma.$queryRaw<{ c: string; n: string }[]>`
      SELECT column_name AS c, is_nullable AS n FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'orden_evento' ORDER BY column_name`;
    expect(cols.length).toBeGreaterThan(0);
    const nulos = Object.fromEntries(cols.map((x) => [x.c, x.n]));
    expect(Object.keys(nulos).sort()).toEqual([
      "actor_rol",
      "actor_usuario_id",
      "created_at",
      "familia_aplicacion",
      "gestion_orden_id",
      "id",
      "mensajero_id",
      "motivo",
      "orden_id",
      "resultado",
      "resultado_anterior",
      "tipo",
    ]);
    for (const c of ["id", "orden_id", "tipo", "actor_usuario_id", "actor_rol", "created_at"]) {
      expect(nulos[c], c).toBe("NO");
    }
  });

  it("la RLS esta encendida", async () => {
    const f = await mundo.prisma.$queryRaw<{ rls: boolean }[]>`
      SELECT c.relrowsecurity AS rls FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = 'orden_evento'`;
    expect(f).toEqual([{ rls: true }]);
  });

  it("los indices existen por nombre, y el unico PARCIAL es sobre `gestion_registrada`", async () => {
    const f = await mundo.prisma.$queryRaw<{ indexname: string; indexdef: string }[]>`
      SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'orden_evento'`;
    const porNombre = Object.fromEntries(f.map((x) => [x.indexname, x.indexdef]));
    for (const n of [
      "orden_evento_pkey",
      "orden_evento_orden_id_created_at_idx",
      "orden_evento_gestion_orden_id_idx",
      "orden_evento_mensajero_id_idx",
      "orden_evento_actor_usuario_id_idx",
      "orden_evento_gestion_registrada_uq",
    ]) {
      expect(porNombre[n], n).toBeDefined();
    }
    expect(porNombre.orden_evento_gestion_registrada_uq).toMatch(/UNIQUE/);
    expect(porNombre.orden_evento_gestion_registrada_uq).toMatch(/WHERE \(tipo = 'gestion_registrada'/);
  });

  // ── Los CHECK y el unico parcial, MORDIENDO ────────────────────────────────────────────────

  type Fila = {
    tipo: string;
    gestion?: boolean;
    familia?: string | null;
    resultado?: string | null;
    resultadoAnterior?: string | null;
  };

  /** Inserta UNA fila (y opcionalmente una segunda) y devuelve el error de Postgres, o `null`. */
  async function insertar(filas: Fila[]): Promise<string | null> {
    return conEscenario(mundo, async (e: Escenario) => {
      const o = await e.sembrarOrden({ estatus: "en_reparto" });
      const g = await e.tx.gestionOrden.create({
        data: { ordenId: o.ordenId, mensajeroId: e.mensajeroId, resultado: "entregada" },
        select: { id: true },
      });
      try {
        for (const f of filas) {
          await e.tx.$executeRawUnsafe(
            `INSERT INTO "orden_evento"
               ("id","orden_id","tipo","gestion_orden_id","familia_aplicacion","resultado",
                "resultado_anterior","actor_usuario_id","actor_rol")
             VALUES ($1,$2,$3::"orden_evento_tipo",$4,$5::"orden_historial_origen_tipo",
                     $6::"gestion_resultado",$7::"gestion_resultado",$8,'mensajero'::"rol_value")`,
            randomUUID(),
            o.ordenId,
            f.tipo,
            f.gestion === false ? null : g.id,
            f.familia ?? null,
            f.resultado ?? null,
            f.resultadoAnterior ?? null,
            e.mensajeroId,
          );
        }
        return null;
      } catch (err) {
        return String(err);
      }
    });
  }

  const registrada: Fila = { tipo: "gestion_registrada", familia: "gestion", resultado: "entregada" };

  it("CONTROL: un `gestion_registrada` bien formado entra", async () => {
    expect(await insertar([registrada])).toBeNull();
  }, 60_000);

  it("un `gestion_*` SIN gestion no es escribible", async () => {
    expect(await insertar([{ ...registrada, gestion: false }])).toContain("orden_evento_gestion_obligatoria_check");
    expect(await insertar([{ tipo: "gestion_anulada", gestion: false }])).toContain(
      "orden_evento_gestion_obligatoria_check",
    );
  }, 60_000);

  it("la familia de aplicacion: obligatoria en `gestion_registrada`, solo de calle, y prohibida en el resto", async () => {
    expect(await insertar([{ ...registrada, familia: null }])).toContain("orden_evento_familia_aplicacion_check");
    expect(await insertar([{ ...registrada, familia: "anclaje_devolucion" }])).toContain(
      "orden_evento_familia_aplicacion_check",
    );
    expect(await insertar([{ tipo: "ayuda_solicitada", gestion: false, familia: "gestion" }])).toContain(
      "orden_evento_familia_aplicacion_check",
    );
    // CONTROL: las tres familias de calle entran.
    expect(await insertar([{ ...registrada, familia: "incidente" }])).toBeNull();
    expect(await insertar([{ ...registrada, familia: "gestion_tienda_ayuda" }])).toBeNull();
  }, 120_000);

  it("resultado y resultado anterior segun el tipo", async () => {
    expect(await insertar([{ ...registrada, resultado: null }])).toContain("orden_evento_resultado_check");
    expect(await insertar([{ tipo: "gestion_corregida", resultado: "rechazada" }])).toContain(
      "orden_evento_resultado_anterior_check",
    );
    expect(await insertar([{ tipo: "ayuda_solicitada", gestion: false, resultadoAnterior: "entregada" }])).toContain(
      "orden_evento_resultado_anterior_check",
    );
    // CONTROL
    expect(
      await insertar([{ tipo: "gestion_corregida", resultado: "rechazada", resultadoAnterior: "entregada" }]),
    ).toBeNull();
  }, 120_000);

  it("UN solo `gestion_registrada` por gestion (el unico parcial muerde); los otros tipos se repiten", async () => {
    expect(await insertar([registrada, registrada])).toContain("orden_evento_gestion_registrada_uq");
    expect(await insertar([{ tipo: "gestion_anulada" }, { tipo: "gestion_anulada" }])).toBeNull();
  }, 60_000);
});
