import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { HAY_BASE_DE_DATOS, crearPrismaDeTest, enTransaccionRevertida, serializarEscriturasReales } from "./_postgres-real";
import { crearEnvio, crearPlantilla } from "./_whatsapp-envios-474";

// Ficha 474 (T1.5) — las tres migraciones, leidas del archivo Y medidas en la base: RLS en las
// cuatro tablas, los indices PARCIALES con SU predicado (la idempotencia de R23/R27 y la consulta
// del puente viven ahi), las columnas de la enmienda y el `down.sql` de cada una.

const MIGRACIONES = path.resolve(__dirname, "..", "..", "..", "db", "migrations");
const DIRS = [
  "20261005120000_job_tipo_whatsapp_envios",
  "20261005120100_whatsapp_envios",
  "20261005120200_seed_whatsapp_envio_mantenimiento",
];
const TABLAS = ["whatsapp_envio", "whatsapp_envio_destinatario", "whatsapp_envio_ejecucion", "whatsapp_envio_entrega"];

describe("474/T1.5 — los archivos", () => {
  it("cada migracion tiene migration.sql y down.sql", () => {
    for (const d of DIRS) {
      expect(fs.existsSync(path.join(MIGRACIONES, d, "migration.sql")), d).toBe(true);
      expect(fs.existsSync(path.join(MIGRACIONES, d, "down.sql")), d).toBe(true);
    }
  });

  it("el down del enum recrea job_tipo con los ONCE valores previos, en orden", () => {
    const down = fs.readFileSync(path.join(MIGRACIONES, DIRS[0], "down.sql"), "utf8");
    expect(down).toContain(
      `CREATE TYPE "job_tipo" AS ENUM ('liberar_reprogramadas', 'geocodificacion', 'optimizacion_ruta', 'webhook_estado', 'whatsapp_template_sync', 'whatsapp_chat_envio', 'analitica_rollup_diario', 'analitica_invalidacion_cache', 'whatsapp_bienvenida', 'push_web', 'webhook_evento');`,
    );
    expect(down).toContain(`DROP INDEX IF EXISTS "jobs_geocodificacion_estado_updated_idx";`);
  });
});

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("474/T1.5 — la base", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("job_tipo tiene los cinco valores nuevos", async () => {
    const filas = await prisma.$queryRawUnsafe<{ etiqueta: string }[]>(
      `SELECT e.enumlabel AS etiqueta FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
         JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'job_tipo' AND n.nspname = 'public'`,
    );
    const valores = filas.map((f) => f.etiqueta);
    for (const v of [
      "whatsapp_envio_programado",
      "whatsapp_envio_evento",
      "whatsapp_envio_ejecucion",
      "whatsapp_envio_reintento",
      "whatsapp_envio_mantenimiento",
    ]) {
      expect(valores).toContain(v);
    }
  });

  it("RLS habilitada en las cuatro tablas", async () => {
    const filas = await prisma.$queryRawUnsafe<{ relname: string; relrowsecurity: boolean }[]>(
      `SELECT c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])`,
      TABLAS,
    );
    expect(filas).toHaveLength(4);
    for (const f of filas) expect(f.relrowsecurity, f.relname).toBe(true);
  });

  it("⭑ los indices parciales existen CON su predicado", async () => {
    const filas = await prisma.$queryRawUnsafe<{ indexname: string; indexdef: string }[]>(
      `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = ANY($1::text[])`,
      TABLAS,
    );
    const def = new Map(filas.map((f) => [f.indexname, f.indexdef]));
    const esperado: Record<string, RegExp> = {
      whatsapp_envio_nombre_vigente_key: /UNIQUE INDEX .*\(nombre\) WHERE \(deleted_at IS NULL\)/,
      whatsapp_envio_evento_encendido_idx: /\(evento_clave\) WHERE \(activo AND \(deleted_at IS NULL\) AND \(disparo = 'evento'/,
      whatsapp_envio_destinatario_rol_key: /UNIQUE INDEX .*\(envio_id, rol\) WHERE \(rol IS NOT NULL\)/,
      whatsapp_envio_destinatario_usuario_key: /UNIQUE INDEX .*\(envio_id, usuario_id\) WHERE \(usuario_id IS NOT NULL\)/,
      whatsapp_envio_ejecucion_programado_key: /UNIQUE INDEX .*\(envio_id, fecha_cr\) WHERE \(origen = 'programado'/,
      whatsapp_envio_ejecucion_evento_key: /UNIQUE INDEX .*\(envio_id, evento_clave, evento_referencia\) WHERE \(origen = 'evento'/,
      whatsapp_envio_ejecucion_purga_idx: /\(pdf_caduca_at\) WHERE \(\(pdf_ruta IS NOT NULL\) AND \(pdf_purgado_at IS NULL\)\)/,
      whatsapp_envio_ejecucion_prueba_idx: /\(solicitada_por, envio_id, created_at DESC\) WHERE \(origen = 'prueba'/,
      whatsapp_envio_entrega_wa_message_id_key: /UNIQUE INDEX .*\(wa_message_id\) WHERE \(wa_message_id IS NOT NULL\)/,
      whatsapp_envio_entrega_ejecucion_usuario_key: /UNIQUE INDEX .*\(ejecucion_id, usuario_id\)$/,
    };
    for (const [nombre, re] of Object.entries(esperado)) {
      expect(def.get(nombre), `falta ${nombre}`).toBeDefined();
      expect(def.get(nombre), nombre).toMatch(re);
    }
  });

  it("columnas de la enmienda: evento_datos jsonb y notificacion_id SIN FK", async () => {
    const cols = await prisma.$queryRawUnsafe<{ column_name: string; data_type: string }[]>(
      `SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'whatsapp_envio_ejecucion'
          AND column_name IN ('evento_datos','notificacion_id')`,
    );
    expect(Object.fromEntries(cols.map((c) => [c.column_name, c.data_type]))).toEqual({
      evento_datos: "jsonb",
      notificacion_id: "text",
    });
    const fks = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*) AS n FROM information_schema.key_column_usage k
         JOIN information_schema.table_constraints t ON t.constraint_name = k.constraint_name
        WHERE t.constraint_type = 'FOREIGN KEY' AND k.table_name = 'whatsapp_envio_ejecucion'
          AND k.table_schema = 'public' AND t.table_schema = 'public'
          AND k.column_name = 'notificacion_id'`,
    );
    expect(Number(fks[0].n)).toBe(0);
  });

  it("la siembra dejo un job de mantenimiento pendiente", async () => {
    const filas = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*) AS n FROM "jobs" WHERE "tipo" = 'whatsapp_envio_mantenimiento' AND "estado" IN ('pending','processing')`,
    );
    expect(Number(filas[0].n)).toBeGreaterThanOrEqual(1);
  });

  it("R15: un envio insertado sin `activo` nace APAGADO", async () => {
    await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const p = await crearPlantilla(tx);
      const id = await crearEnvio(tx, { plantillaId: p.id });
      const f = await tx.$queryRawUnsafe<{ activo: boolean }[]>(`SELECT "activo" FROM "whatsapp_envio" WHERE "id" = $1`, id);
      expect(f[0].activo).toBe(false);
    });
  });

  it("CHECK de forma del disparo: hora_fija sin dias -> rechazo", async () => {
    await expect(
      enTransaccionRevertida(prisma, async (tx) => {
        await serializarEscriturasReales(tx);
        const p = await crearPlantilla(tx);
        await crearEnvio(tx, { plantillaId: p.id, dias: [] });
      }),
    ).rejects.toThrow(/whatsapp_envio_disparo_forma_check/);
  });

  it("CHECK de forma del disparo: hora invalida -> rechazo", async () => {
    await expect(
      enTransaccionRevertida(prisma, async (tx) => {
        await serializarEscriturasReales(tx);
        const p = await crearPlantilla(tx);
        await crearEnvio(tx, { plantillaId: p.id, hora: "25:00" });
      }),
    ).rejects.toThrow(/whatsapp_envio_disparo_forma_check/);
  });
});
