import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Feature 146 — B5. Cobertura ESTATICA de la migracion `*_notificacion` (patron
// `zonas-migration` / `chat-mensaje-ubicacion-migration`): lee migration.sql y down.sql por
// regex y los contrasta con `db/schema.prisma`. NO requiere Postgres real: el `.env` de este
// repo apunta a una base COMPARTIDA con produccion, asi que `db:migrate` es un paso de
// despliegue humano y la migracion se valida por FORMA, no ejecutandola.
//
// Cubre R1, R2, R4, R5, R6, R7, R8, R9, R10 y R11.

const ROOT = path.join(__dirname, "..", "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");

function migrationDirFor(suffix: string): string {
  const dir = fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .find((name) => name.endsWith(suffix));
  if (!dir) throw new Error(`No se encontro la carpeta de migracion ${suffix}`);
  return path.join(MIGRATIONS_DIR, dir);
}

const migrationDir = migrationDirFor("_notificacion");
const upSql = fs.readFileSync(path.join(migrationDir, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(migrationDir, "down.sql"), "utf8");
const schemaPrisma = fs.readFileSync(path.join(ROOT, "db", "schema.prisma"), "utf8");

describe("R1 — la tabla `notificacion` persiste todo lo que la campana necesita", () => {
  it("crea la tabla con id, tipo de presentacion, evento, descripcion, anexo, entidad y fecha", () => {
    expect(upSql).toMatch(/CREATE TABLE "notificacion"/);
    expect(upSql).toMatch(/"id" TEXT NOT NULL/);
    expect(upSql).toMatch(/"tipo" "notificacion_tipo" NOT NULL/);
    expect(upSql).toMatch(/"evento" "notificacion_evento" NOT NULL/);
    expect(upSql).toMatch(/"descripcion" TEXT NOT NULL/);
    expect(upSql).toMatch(/"anexo" TEXT,/); // opcional
    expect(upSql).toMatch(/"entidad_tipo" "notificacion_entidad_tipo" NOT NULL/);
    expect(upSql).toMatch(/"entidad_id" TEXT,/);
    expect(upSql).toMatch(
      /"created_at" TIMESTAMP\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP/,
    );
    expect(upSql).toMatch(/CONSTRAINT "notificacion_pkey" PRIMARY KEY \("id"\)/);
  });

  it("declara los tres enums nativos con los valores del inventario cerrado de D1", () => {
    expect(upSql).toMatch(
      /CREATE TYPE "notificacion_tipo" AS ENUM \('alert', 'box', 'warning'\)/,
    );
    const evento = /CREATE TYPE "notificacion_evento" AS ENUM \(([\s\S]*?)\)/.exec(upSql);
    expect(evento).not.toBeNull();
    for (const valor of [
      "orden_rechazada",
      "carga_masiva_terminada",
      "postulacion_mensajero_pendiente",
      "cierre_dia_por_aprobar",
    ]) {
      expect(evento![1]).toContain(`'${valor}'`);
    }
    expect(upSql).toMatch(
      /CREATE TYPE "notificacion_entidad_tipo" AS ENUM \('orden', 'usuario', 'cierre_dia', 'carga'\)/,
    );
  });

  it("el modelo Prisma `Notificacion` mapea a la tabla y a las columnas snake_case", () => {
    expect(schemaPrisma).toMatch(/model Notificacion \{[\s\S]*?@@map\("notificacion"\)/);
    expect(schemaPrisma).toMatch(/entidadTipo\s+NotificacionEntidadTipo\s+@map\("entidad_tipo"\)/);
    expect(schemaPrisma).toMatch(/destinatarioRol\s+RolValue\?\s+@map\("destinatario_rol"\)/);
    expect(schemaPrisma).toMatch(
      /destinatarioUsuarioId\s+String\?\s+@map\("destinatario_usuario_id"\)/,
    );
  });
});

describe("R2/R3 — la lectura y el descarte se registran POR USUARIO en una tabla aparte", () => {
  it("crea `notificacion_lectura` con leida_at y descartada_at nullable", () => {
    expect(upSql).toMatch(/CREATE TABLE "notificacion_lectura"/);
    expect(upSql).toMatch(/"notificacion_id" TEXT NOT NULL/);
    expect(upSql).toMatch(/"usuario_id" TEXT NOT NULL/);
    expect(upSql).toMatch(/"leida_at" TIMESTAMP\(3\),/);
    expect(upSql).toMatch(/"descartada_at" TIMESTAMP\(3\),/);
  });

  it("admite a lo sumo UNA fila por (notificacion, usuario)", () => {
    expect(upSql).toMatch(
      /CREATE UNIQUE INDEX "notificacion_lectura_notificacion_id_usuario_id_key"\s*\n?\s*ON "notificacion_lectura"\("notificacion_id", "usuario_id"\)/,
    );
    expect(schemaPrisma).toMatch(/@@unique\(\[notificacionId, usuarioId\]\)/);
  });

  it("rechaza una fila de lectura sin ninguna marca (equivaldria a no tener fila)", () => {
    expect(upSql).toMatch(
      /ADD CONSTRAINT "notificacion_lectura_marca_presente"\s*\n?\s*CHECK \("leida_at" IS NOT NULL OR "descartada_at" IS NOT NULL\)/,
    );
  });

  it("`notificacion` NO lleva columna de lectura: el estado no es compartido por el rol", () => {
    expect(/CREATE TABLE "notificacion" \(([\s\S]*?)\n\);/.exec(upSql)![1]).not.toMatch(
      /leida_at|descartada_at/,
    );
  });
});

describe("R4 — el esquema exige EXACTAMENTE un destinatario", () => {
  it("declara el CHECK XOR entre destinatario_rol y destinatario_usuario_id", () => {
    expect(upSql).toMatch(
      /ADD CONSTRAINT "notificacion_destinatario_xor"\s*\n?\s*CHECK \(\("destinatario_rol" IS NULL\) <> \("destinatario_usuario_id" IS NULL\)\)/,
    );
  });

  it("ambas columnas de destinatario son nullable (es el CHECK quien decide, no el NOT NULL)", () => {
    const tabla = /CREATE TABLE "notificacion" \(([\s\S]*?)\n\);/.exec(upSql)![1];
    expect(tabla).toMatch(/"destinatario_rol" "rol_value",/);
    expect(tabla).toMatch(/"destinatario_usuario_id" TEXT,/);
  });
});

describe("R5 — dos columnas de alcance opcionales e independientes", () => {
  it("crea tienda_id y zona_id nullable y sin default", () => {
    const tabla = /CREATE TABLE "notificacion" \(([\s\S]*?)\n\);/.exec(upSql)![1];
    expect(tabla).toMatch(/"tienda_id" TEXT,/);
    expect(tabla).toMatch(/"zona_id" TEXT,/);
    expect(tabla).not.toMatch(/"tienda_id" TEXT NOT NULL/);
    expect(tabla).not.toMatch(/"zona_id" TEXT NOT NULL/);
  });

  it("no acopla los dos alcances entre si ni al rol destinatario con un CHECK extra", () => {
    const checks =
      upSql.match(/ALTER TABLE "notificacion" ADD CONSTRAINT "[a-z_]+"\s*\n?\s*CHECK/g) ?? [];
    expect(checks).toHaveLength(1); // solo el XOR de destinatario
    expect(checks[0]).toContain("notificacion_destinatario_xor");
  });

  it("el modelo Prisma declara ambos alcances como opcionales", () => {
    expect(schemaPrisma).toMatch(/tiendaId\s+String\?\s+@map\("tienda_id"\)/);
    expect(schemaPrisma).toMatch(/zonaId\s+String\?\s+@map\("zona_id"\)/);
  });
});

describe("R6 — una fila por rol destinatario", () => {
  it("destinatario_rol es ESCALAR (no un array), lo que obliga a una fila por rol", () => {
    const tabla = /CREATE TABLE "notificacion" \(([\s\S]*?)\n\);/.exec(upSql)![1];
    expect(tabla).toMatch(/"destinatario_rol" "rol_value",/);
    expect(tabla).not.toMatch(/"destinatario_rol" "rol_value"\[\]/);
    expect(schemaPrisma).not.toMatch(/destinatarioRol\s+RolValue\[\]/);
  });

  it("la clave de dedupe incluye el destinatario, para que N filas del mismo evento convivan", () => {
    expect(upSql).toMatch(
      /CREATE UNIQUE INDEX "notificacion_dedupe_key"\s*\n?\s*ON "notificacion"\("evento", "entidad_id", "destinatario_rol", "destinatario_usuario_id"\)/,
    );
    // NULLS NOT DISTINCT (Postgres 15+): una de las dos columnas de destinatario es SIEMPRE
    // NULL por el XOR; sin esto el indice no deduplicaria nada.
    expect(upSql).toMatch(/NULLS NOT DISTINCT/);
    expect(upSql).toMatch(/WHERE "entidad_id" IS NOT NULL/);
  });
});

describe("R7 — la migracion es ADITIVA", () => {
  it("no altera ni elimina ninguna tabla, columna o enum preexistente", () => {
    expect(upSql).not.toMatch(/DROP TABLE/);
    expect(upSql).not.toMatch(/DROP COLUMN/);
    expect(upSql).not.toMatch(/DROP TYPE/);
    expect(upSql).not.toMatch(/ALTER TYPE/);
    expect(upSql).not.toMatch(/ALTER COLUMN/);
    expect(upSql).not.toMatch(/DISABLE ROW LEVEL SECURITY/);
  });

  it("solo toca las dos tablas nuevas (ningun ALTER TABLE sobre una preexistente)", () => {
    const tablasAlteradas = new Set(
      Array.from(upSql.matchAll(/ALTER TABLE "([a-z_]+)"/g)).map((m) => m[1]),
    );
    expect([...tablasAlteradas].sort()).toEqual(["notificacion", "notificacion_lectura"]);
  });

  it("solo crea las dos tablas nuevas", () => {
    const creadas = Array.from(upSql.matchAll(/CREATE TABLE "([a-z_]+)"/g)).map((m) => m[1]);
    expect(creadas.sort()).toEqual(["notificacion", "notificacion_lectura"]);
  });
});

describe("R8 — el down revierte exactamente lo que el up crea", () => {
  it("la carpeta trae migration.sql y down.sql", () => {
    expect(fs.existsSync(path.join(migrationDir, "migration.sql"))).toBe(true);
    expect(fs.existsSync(path.join(migrationDir, "down.sql"))).toBe(true);
  });

  it("borra las dos tablas en orden inverso al de las FKs", () => {
    const posLectura = downSql.indexOf('DROP TABLE IF EXISTS "notificacion_lectura"');
    const posNotificacion = downSql.indexOf('DROP TABLE IF EXISTS "notificacion"');
    expect(posLectura).toBeGreaterThanOrEqual(0);
    expect(posNotificacion).toBeGreaterThan(posLectura); // la hija muere primero
  });

  it("borra los tres enums despues de las tablas que los referencian", () => {
    for (const enumName of [
      "notificacion_entidad_tipo",
      "notificacion_evento",
      "notificacion_tipo",
    ]) {
      expect(downSql).toMatch(new RegExp(`DROP TYPE IF EXISTS "${enumName}"`));
      expect(downSql.indexOf(`DROP TYPE IF EXISTS "${enumName}"`)).toBeGreaterThan(
        downSql.indexOf('DROP TABLE IF EXISTS "notificacion"'),
      );
    }
  });

  it("no toca ninguna tabla preexistente al revertir", () => {
    const tocadas = Array.from(downSql.matchAll(/DROP TABLE IF EXISTS "([a-z_]+)"/g)).map(
      (m) => m[1],
    );
    expect(tocadas.sort()).toEqual(["notificacion", "notificacion_lectura"]);
    expect(downSql).not.toMatch(/ALTER TABLE "(?!notificacion)/);
  });
});

describe("R9 — RLS habilitada en ambas tablas, sin policies", () => {
  it("habilita Row Level Security en notificacion y en notificacion_lectura", () => {
    expect(upSql).toMatch(/ALTER TABLE "notificacion" ENABLE ROW LEVEL SECURITY/);
    expect(upSql).toMatch(/ALTER TABLE "notificacion_lectura" ENABLE ROW LEVEL SECURITY/);
  });

  it("no crea ninguna policy: solo el service role accede (patron del repo)", () => {
    expect(upSql).not.toMatch(/CREATE POLICY/);
  });
});

describe("R10 — indices del listado y del alcance", () => {
  it("indexa el listado por destinatario ordenado por fecha descendente", () => {
    expect(upSql).toMatch(
      /CREATE INDEX "notificacion_rol_created_at_idx"\s*\n?\s*ON "notificacion"\("destinatario_rol", "created_at" DESC\)\s*\n?\s*WHERE "destinatario_rol" IS NOT NULL/,
    );
    expect(upSql).toMatch(
      /CREATE INDEX "notificacion_usuario_created_at_idx"\s*\n?\s*ON "notificacion"\("destinatario_usuario_id", "created_at" DESC\)\s*\n?\s*WHERE "destinatario_usuario_id" IS NOT NULL/,
    );
  });

  it("indexa los dos alcances, para que adminTienda/adminSatelite no hagan recorrido secuencial", () => {
    expect(upSql).toMatch(
      /CREATE INDEX "notificacion_tienda_id_created_at_idx"\s*\n?\s*ON "notificacion"\("tienda_id", "created_at" DESC\)\s*\n?\s*WHERE "tienda_id" IS NOT NULL/,
    );
    expect(upSql).toMatch(
      /CREATE INDEX "notificacion_zona_id_created_at_idx"\s*\n?\s*ON "notificacion"\("zona_id", "created_at" DESC\)\s*\n?\s*WHERE "zona_id" IS NOT NULL/,
    );
  });

  it("indexa la entidad de origen y la lectura por usuario", () => {
    expect(upSql).toMatch(
      /CREATE INDEX "notificacion_entidad_idx" ON "notificacion"\("entidad_tipo", "entidad_id"\)/,
    );
    expect(upSql).toMatch(
      /CREATE INDEX "notificacion_lectura_usuario_id_idx" ON "notificacion_lectura"\("usuario_id"\)/,
    );
  });
});

describe("R11 — borrar un usuario, una tienda o una zona no deja filas huerfanas", () => {
  it("las tres FK de notificacion cascadean el borrado", () => {
    expect(upSql).toMatch(
      /ADD CONSTRAINT "notificacion_destinatario_usuario_id_fkey"\s*\n?\s*FOREIGN KEY \("destinatario_usuario_id"\) REFERENCES "usuario"\("id"\) ON DELETE CASCADE/,
    );
    expect(upSql).toMatch(
      /ADD CONSTRAINT "notificacion_tienda_id_fkey"\s*\n?\s*FOREIGN KEY \("tienda_id"\) REFERENCES "usuario"\("id"\) ON DELETE CASCADE/,
    );
    expect(upSql).toMatch(
      /ADD CONSTRAINT "notificacion_zona_id_fkey"\s*\n?\s*FOREIGN KEY \("zona_id"\) REFERENCES "zona"\("id"\) ON DELETE CASCADE/,
    );
  });

  it("las dos FK de notificacion_lectura cascadean el borrado", () => {
    expect(upSql).toMatch(
      /ADD CONSTRAINT "notificacion_lectura_notificacion_id_fkey"\s*\n?\s*FOREIGN KEY \("notificacion_id"\) REFERENCES "notificacion"\("id"\) ON DELETE CASCADE/,
    );
    expect(upSql).toMatch(
      /ADD CONSTRAINT "notificacion_lectura_usuario_id_fkey"\s*\n?\s*FOREIGN KEY \("usuario_id"\) REFERENCES "usuario"\("id"\) ON DELETE CASCADE/,
    );
  });

  it("`entidad_id` NO lleva FK (referencia polimorfica, deuda aceptada en design Riesgo 4)", () => {
    expect(upSql).not.toMatch(/FOREIGN KEY \("entidad_id"\)/);
  });

  it("el modelo Prisma declara onDelete: Cascade en las cinco relaciones", () => {
    const modelo = /model Notificacion \{[\s\S]*?\n\}/.exec(schemaPrisma)![0];
    expect(modelo.match(/onDelete: Cascade/g)).toHaveLength(3);
    const lectura = /model NotificacionLectura \{[\s\S]*?\n\}/.exec(schemaPrisma)![0];
    expect(lectura.match(/onDelete: Cascade/g)).toHaveLength(2);
  });
});

describe("R12 — la migracion queda registrada en el invariante de orden", () => {
  it("`zonas-migration.test.ts` excluye la carpeta `_notificacion`", () => {
    const zonasTest = fs.readFileSync(
      path.join(ROOT, "tests", "integration", "db", "zonas-migration.test.ts"),
      "utf8",
    );
    expect(zonasTest).toMatch(/!d\.endsWith\("_notificacion"\)/);
  });

  it("la carpeta tiene timestamp posterior a la ultima migracion previa", () => {
    const dirs = fs
      .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    const esta = dirs.find((d) => d.endsWith("_notificacion"))!;
    const previas = dirs.filter(
      (d) =>
        !d.endsWith("_notificacion") &&
        !d.endsWith("_order_status_en_reparto") && // feature 153 (rename del value): apendida despues
        // feature 159 (retiro de la sugerencia de mensajero): apendida despues.
        !d.endsWith("_drop_orden_mensajero_sugerido") &&
        // feature 154 (catalogo de estados v2): las dos apendidas despues.
        !d.endsWith("_order_status_v2_por_recolectar_incidente") &&
        !d.endsWith("_orden_historial_origen_recoleccion_tienda_incidente"),
    );
    expect(esta > previas[previas.length - 1]).toBe(true);
  });
});
