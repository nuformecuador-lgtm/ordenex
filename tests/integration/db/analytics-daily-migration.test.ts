import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Feature 123 / T6 — cobertura ESTATICA de la migracion `*_analytics_daily` (patron
// `notificacion-migration` / `zonas-migration`): lee `migration.sql`, `down.sql` y
// `db/schema.prisma` y los contrasta por regex. NO requiere Postgres.
//
// Que este archivo NO demuestra, dicho aqui para que nadie lo confunda: que la migracion
// se aplique y se revierta de verdad. Eso es el round-trip real de R43 (T8), medido contra
// `localhost:5432/ordenex` y escrito en `progress/roundtrip_123_analytics_daily.md`. Este
// archivo verifica la FORMA del DDL; el round-trip verifica su EFECTO.
//
// Cubre R1, R5, R6, R7, R8, R9, R10, R11, R12, R13, R14, R15, R16, R20, R21, R22, R23,
// R24, R25, R26, R27, R28, R30, R31, R32, R33, R36, R37, R38, R39, R40, R41 y R42.

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

const migrationDir = migrationDirFor("_analytics_daily");
const upSql = fs.readFileSync(path.join(migrationDir, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(migrationDir, "down.sql"), "utf8");
const schemaPrisma = fs.readFileSync(path.join(ROOT, "db", "schema.prisma"), "utf8");

/**
 * SQL sin las lineas de comentario. Las aserciones NEGATIVAS se hacen sobre esto y no
 * sobre el archivo entero: la cabecera EXPLICA por que no hay dinero y por que no hay
 * policies, y una negativa ingenua sobre el texto crudo se rompería con su propia
 * justificacion escrita.
 */
const upDdl = upSql.replace(/^\s*--.*$/gm, "");
const downDdl = downSql.replace(/^\s*--.*$/gm, "");

/** Cuerpo del CREATE TABLE, para distinguir columnas de todo lo demas. */
const cuerpoTabla = /CREATE TABLE "analytics_daily" \(([\s\S]*?)\n\);/.exec(upSql)![1];

const MODELO = /model AnalyticsDaily \{[\s\S]*?\n\}/.exec(schemaPrisma)![0];

/** Bloque de comentario que precede al modelo (patron `gestion_orden` / `orden_incidente`). */
const MODELO_DOC = /((?:^\/\/.*\n)+)model AnalyticsDaily \{/m.exec(schemaPrisma)![1];

/** Las diez medidas de R16, en el orden de `design.md §3.1`. */
const MEDIDAS = [
  "ordenes_creadas",
  "ordenes_estado_stock",
  "entregas",
  "devoluciones",
  "rechazos",
  "reprogramaciones",
  "incidentes",
  "primer_intento_ok",
  "seg_ciclo_acum",
  "seg_ciclo_n",
] as const;

/** Las seis columnas del grano de R2, en el orden del indice unico. */
const GRANO = [
  "fecha",
  "zona_id",
  "tienda_id",
  "mensajero_id",
  "estatus_id",
  "causa_devolucion",
] as const;

/** Comentario de columna del UP, ya desescapado de comillas SQL. */
function comentarioDe(columna: string): string {
  const m = new RegExp(
    `COMMENT ON COLUMN "analytics_daily"\\."${columna}" IS\\s*\\n?\\s*'([\\s\\S]*?)';`,
  ).exec(upSql);
  if (!m) throw new Error(`Falta el COMMENT ON COLUMN de ${columna}`);
  return m[1];
}

describe("R1/R9 — la tabla y el modelo existen, con el nombre del contrato de la 135", () => {
  it("la migracion crea `analytics_daily` con PK sustituta", () => {
    expect(upSql).toMatch(/CREATE TABLE "analytics_daily"/);
    expect(upSql).toMatch(/CONSTRAINT "analytics_daily_pkey" PRIMARY KEY \("id"\)/);
  });

  it("el modelo Prisma mapea a la tabla y todas sus columnas son snake_case", () => {
    expect(MODELO).toMatch(/@@map\("analytics_daily"\)/);
    const columnas = Array.from(cuerpoTabla.matchAll(/^\s{2}"([a-z_0-9]+)"/gm)).map((m) => m[1]);
    expect(columnas.length).toBe(19); // 6 de grano + 10 medidas + id/created_at/updated_at
    for (const c of columnas) expect(c).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  it("la carpeta de la migracion conserva su nombre y trae los dos archivos", () => {
    expect(path.basename(migrationDir)).toBe("20260731120000_analytics_daily");
    expect(fs.existsSync(path.join(migrationDir, "migration.sql"))).toBe(true);
    expect(fs.existsSync(path.join(migrationDir, "down.sql"))).toBe(true);
  });
});

describe("R6/R7/R8 — fecha calendario, PK uuid y rastro de recomputacion", () => {
  it("`fecha` es DATE NOT NULL, nunca un instante", () => {
    expect(cuerpoTabla).toMatch(/"fecha" DATE NOT NULL/);
    expect(cuerpoTabla).not.toMatch(/"fecha" TIMESTAMP/);
    expect(MODELO).toMatch(/fecha\s+DateTime\s+@db\.Date/);
  });

  it("`id` es TEXT con uuid generado por Prisma", () => {
    expect(cuerpoTabla).toMatch(/"id" TEXT NOT NULL/);
    expect(MODELO).toMatch(/id\s+String\s+@id @default\(uuid\(\)\)/);
  });

  it("lleva created_at por defecto y updated_at con @updatedAt", () => {
    expect(cuerpoTabla).toMatch(/"created_at" TIMESTAMP\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP/);
    expect(cuerpoTabla).toMatch(/"updated_at" TIMESTAMP\(3\) NOT NULL/);
    expect(MODELO).toMatch(/createdAt\s+DateTime\s+@default\(now\(\)\) @map\("created_at"\)/);
    expect(MODELO).toMatch(/updatedAt\s+DateTime\s+@updatedAt @map\("updated_at"\)/);
  });
});

describe("R10/R11/R12 — nulabilidad del grano: solo dos columnas pueden faltar", () => {
  it("zona_id, tienda_id y estatus_id son NOT NULL", () => {
    expect(cuerpoTabla).toMatch(/"zona_id" TEXT NOT NULL/);
    expect(cuerpoTabla).toMatch(/"tienda_id" TEXT NOT NULL/);
    expect(cuerpoTabla).toMatch(/"estatus_id" TEXT NOT NULL/);
  });

  it("mensajero_id es nullable y su NULL significa `sin asignar`, no `todos`", () => {
    expect(cuerpoTabla).toMatch(/"mensajero_id" TEXT,/);
    expect(cuerpoTabla).not.toMatch(/"mensajero_id" TEXT NOT NULL/);
    expect(MODELO).toMatch(/mensajeroId\s+String\?\s+@map\("mensajero_id"\)/);
    const comentario = comentarioDe("mensajero_id");
    expect(comentario).toContain("sin mensajero asignado");
    expect(comentario).toContain("sin_asignar");
    expect(comentario).toMatch(/NUNCA significa "todos los mensajeros"/);
  });

  it("causa_devolucion es nullable, del enum PREEXISTENTE, y la migracion no crea enums", () => {
    expect(cuerpoTabla).toMatch(/"causa_devolucion" "gestion_causa_devolucion",/);
    expect(upDdl).not.toMatch(/CREATE TYPE/);
    expect(MODELO).toMatch(/causaDevolucion GestionCausaDevolucion\? @map\("causa_devolucion"\)/);
    expect(schemaPrisma).toMatch(
      /enum GestionCausaDevolucion \{[\s\S]*?not_found[\s\S]*?wrong_number[\s\S]*?wrong_address[\s\S]*?@@map\("gestion_causa_devolucion"\)/,
    );
    expect(comentarioDe("causa_devolucion")).toContain("no tiene causa de devolucion tipificada");
  });
});

describe("R13 — solo grano fino: ninguna fila de totalizacion", () => {
  it("no hay columna centinela de subtotal ni GROUPING SETS materializados", () => {
    expect(upDdl).not.toMatch(/GROUPING/i);
    expect(cuerpoTabla).not.toMatch(/"(es_)?(total|subtotal|todas|todos|agregado)[a-z_]*"/);
  });

  it("las seis columnas del grano son escalares, sin valor `todas` posible", () => {
    // zona/tienda/mensajero/estatus son FK a filas reales; no existe fila "todas".
    expect(upDdl.match(/FOREIGN KEY/g)).toHaveLength(4);
  });
});

describe("R14/R15 — el unico del grano deduplica los NULL, o la migracion falla", () => {
  it("declara el unico sobre las seis columnas del grano, empezando por fecha", () => {
    expect(upSql).toMatch(
      /CREATE UNIQUE INDEX "analytics_daily_grano_key"\s*\n?\s*ON "analytics_daily"\("fecha", "zona_id", "tienda_id", "mensajero_id", "estatus_id", "causa_devolucion"\)/,
    );
    const orden = /ON "analytics_daily"\(([^)]*)\)\s*\n\s*NULLS NOT DISTINCT/.exec(upSql)![1];
    expect(orden.split(",").map((s) => s.trim().replace(/"/g, ""))).toEqual([...GRANO]);
  });

  it("el unico lleva NULLS NOT DISTINCT literal", () => {
    expect(upSql).toMatch(
      /CREATE UNIQUE INDEX "analytics_daily_grano_key"[\s\S]{0,300}?NULLS NOT DISTINCT;/,
    );
  });

  it("R15: sin fallback ni IF NOT EXISTS — si el motor no lo soporta, el apply falla", () => {
    expect(upDdl).not.toMatch(/IF NOT EXISTS/i);
    expect(upDdl).not.toMatch(/DO \$\$/);
    expect(upDdl).not.toMatch(/EXCEPTION/i);
    expect(upDdl).not.toMatch(/current_setting|server_version/i);
  });

  it("el modelo Prisma NO declara el unico del grano: vive en el SQL y lo dice", () => {
    expect(MODELO).not.toMatch(/@@unique/);
    expect(MODELO_DOC).toContain("NULLS NOT DISTINCT");
    expect(MODELO_DOC).toContain("analytics_daily_grano_key");
    // Y apunta tambien a que los tres CHECK viven en el SQL.
    expect(MODELO_DOC).toContain("analytics_daily_pio_lte_entregas");
  });
});

describe("R16/R20/R21/R23 — las diez medidas, todas conteos aditivos", () => {
  it.each(MEDIDAS)("`%s` es NOT NULL DEFAULT 0", (medida) => {
    expect(cuerpoTabla).toMatch(new RegExp(`"${medida}" (INTEGER|BIGINT) NOT NULL DEFAULT 0`));
  });

  it("no hay ninguna medida de mas ni de menos", () => {
    const columnas = Array.from(cuerpoTabla.matchAll(/^\s{2}"([a-z_0-9]+)"/gm)).map((m) => m[1]);
    const medidas = columnas.filter(
      (c) => !GRANO.includes(c as (typeof GRANO)[number]) && !["id", "created_at", "updated_at"].includes(c),
    );
    expect(medidas.sort()).toEqual([...MEDIDAS].sort());
  });

  it("seg_ciclo_acum es BIGINT (R21) y seg_ciclo_n INTEGER (R20)", () => {
    expect(cuerpoTabla).toMatch(/"seg_ciclo_acum" BIGINT NOT NULL DEFAULT 0/);
    expect(cuerpoTabla).not.toMatch(/"seg_ciclo_acum" INTEGER/);
    expect(cuerpoTabla).toMatch(/"seg_ciclo_n" INTEGER NOT NULL DEFAULT 0/);
    expect(MODELO).toMatch(/segCicloAcum\s+BigInt\s+@default\(0\) @map\("seg_ciclo_acum"\)/);
    expect(MODELO).toMatch(/segCicloN\s+Int\s+@default\(0\) @map\("seg_ciclo_n"\)/);
  });

  it("primer_intento_ok es un conteo entero, no un porcentaje (R23)", () => {
    expect(cuerpoTabla).toMatch(/"primer_intento_ok" INTEGER NOT NULL DEFAULT 0/);
    expect(MODELO).toMatch(/primerIntentoOk\s+Int\s+@default\(0\) @map\("primer_intento_ok"\)/);
    // D1: no se anade denominador propio.
    expect(cuerpoTabla).not.toMatch(/primer_intento_n/);
  });
});

describe("R22/R25/R26 — los tres CHECK estructurales, con nombre explicito", () => {
  it("R25: primer_intento_ok <= entregas, para que la tasa no pase de 1", () => {
    expect(upSql).toMatch(
      /ADD CONSTRAINT "analytics_daily_pio_lte_entregas"\s*\n?\s*CHECK \("primer_intento_ok" <= "entregas"\)/,
    );
  });

  it("R22: seg_ciclo_n = 0 implica seg_ciclo_acum = 0 (nunca un promedio sobre cero)", () => {
    expect(upSql).toMatch(
      /ADD CONSTRAINT "analytics_daily_ciclo_coherente"\s*\n?\s*CHECK \("seg_ciclo_n" > 0 OR "seg_ciclo_acum" = 0\)/,
    );
  });

  it("R26: las DIEZ medidas son no negativas, ninguna se queda fuera", () => {
    const check = /ADD CONSTRAINT "analytics_daily_medidas_no_negativas"\s*\n?\s*CHECK \(([\s\S]*?)\n\s*\);/.exec(
      upSql,
    );
    expect(check).not.toBeNull();
    for (const medida of MEDIDAS) {
      expect(check![1]).toMatch(new RegExp(`"${medida}" >= 0`));
    }
  });

  it("son exactamente tres CHECK, ni uno mas (las reglas de negocio van en zod)", () => {
    const checks = Array.from(
      upDdl.matchAll(/ADD CONSTRAINT "([a-z_]+)"\s*\n?\s*CHECK/g),
    ).map((m) => m[1]);
    expect(checks.sort()).toEqual([
      "analytics_daily_ciclo_coherente",
      "analytics_daily_medidas_no_negativas",
      "analytics_daily_pio_lte_entregas",
    ]);
  });
});

describe("R30 — la semantica viaja en la base: 1 comentario de tabla y 9 de columna", () => {
  it("hay exactamente diez sentencias de comentario", () => {
    expect(upSql.match(/COMMENT ON TABLE/g)).toHaveLength(1);
    expect(upSql.match(/COMMENT ON COLUMN/g)).toHaveLength(9);
  });

  it("comenta las cuatro medidas delicadas y las cinco columnas de grano con semantica", () => {
    const comentadas = Array.from(
      upSql.matchAll(/COMMENT ON COLUMN "analytics_daily"\."([a-z_]+)"/g),
    ).map((m) => m[1]);
    expect(comentadas.sort()).toEqual(
      [
        "causa_devolucion",
        "estatus_id",
        "mensajero_id",
        "ordenes_estado_stock",
        "primer_intento_ok",
        "seg_ciclo_acum",
        "seg_ciclo_n",
        "tienda_id",
        "zona_id",
      ].sort(),
    );
  });

  it("R35: el comentario de TABLA lleva el invariante de inmutabilidad hacia atras", () => {
    const tabla = /COMMENT ON TABLE "analytics_daily" IS\s*\n?\s*'([\s\S]*?)';/.exec(upSql)![1];
    expect(tabla).toMatch(/INMUTABILIDAD HACIA ATRAS/);
    expect(tabla).toMatch(/NUNCA reescribe filas de fechas anteriores/);
    expect(tabla).toMatch(/backfill/);
  });
});

describe("R24/R27/R28/R31/R32/R33/R34 — lo que dice cada comentario", () => {
  it("R28: la columna del embudo se llama ordenes_estado_stock y prohibe sumarla por fecha", () => {
    expect(cuerpoTabla).toMatch(/"ordenes_estado_stock" INTEGER/);
    expect(cuerpoTabla).not.toMatch(/"ordenes_por_estado"/);
    const comentario = comentarioDe("ordenes_estado_stock");
    expect(comentario).toContain("STOCK al corte del dia");
    expect(comentario).toContain("NO SUMAR POR FECHA");
  });

  it("R27: el mismo comentario distingue el FLUJO `ordenes_creadas`, que si es aditivo por fecha", () => {
    expect(cuerpoTabla).toMatch(/"ordenes_creadas" INTEGER/);
    const comentario = comentarioDe("ordenes_estado_stock");
    expect(comentario).toContain("ordenes_creadas");
    expect(comentario).toMatch(/FLUJO/);
  });

  it("R24: el universo de primer_intento_ok es subconjunto del de entregas de la misma fila", () => {
    const comentario = comentarioDe("primer_intento_ok");
    expect(comentario).toContain("SUBCONJUNTO");
    expect(comentario).toContain("entregas");
    expect(comentario).toContain("mismas seis coordenadas");
    expect(comentario).toContain("analytics_daily_pio_lte_entregas");
  });

  it("R34: el ciclo se atribuye a la fecha del EVENTO TERMINAL, no a la de creacion", () => {
    const comentario = comentarioDe("seg_ciclo_acum");
    expect(comentario).toContain("EVENTO TERMINAL");
    expect(comentario).toMatch(/nunca en la de su creacion/);
    expect(comentarioDe("seg_ciclo_n")).toContain("seg_ciclo_acum");
  });

  it("R31: zona y tienda vienen DE LA ORDEN, jamas del usuario que gestiono", () => {
    expect(comentarioDe("zona_id")).toContain("DE LA ORDEN");
    expect(comentarioDe("zona_id")).toMatch(/jamas la zona del usuario que gestiono/);
    expect(comentarioDe("tienda_id")).toContain("DE LA ORDEN");
  });

  it("R32: el origen de mensajero_id depende del tipo de hecho", () => {
    const comentario = comentarioDe("mensajero_id");
    expect(comentario).toContain("orden.mensajero_asignado_id");
    expect(comentario).toContain("gestion_orden.mensajero_id");
  });

  it("R33: estatus_id es el estado de la orden EN EL CORTE del dia", () => {
    expect(comentarioDe("estatus_id")).toContain("EN EL CORTE DEL DIA");
  });
});

describe("R36/R37 — integridad referencial", () => {
  it("las cuatro FK apuntan a zona, usuario x2 y order_status con RESTRICT/CASCADE", () => {
    expect(upSql).toMatch(
      /ADD CONSTRAINT "analytics_daily_zona_id_fkey"\s*\n?\s*FOREIGN KEY \("zona_id"\) REFERENCES "zona"\("id"\) ON DELETE RESTRICT ON UPDATE CASCADE/,
    );
    expect(upSql).toMatch(
      /ADD CONSTRAINT "analytics_daily_tienda_id_fkey"\s*\n?\s*FOREIGN KEY \("tienda_id"\) REFERENCES "usuario"\("id"\) ON DELETE RESTRICT ON UPDATE CASCADE/,
    );
    expect(upSql).toMatch(
      /ADD CONSTRAINT "analytics_daily_mensajero_id_fkey"\s*\n?\s*FOREIGN KEY \("mensajero_id"\) REFERENCES "usuario"\("id"\) ON DELETE RESTRICT ON UPDATE CASCADE/,
    );
    expect(upSql).toMatch(
      /ADD CONSTRAINT "analytics_daily_estatus_id_fkey"\s*\n?\s*FOREIGN KEY \("estatus_id"\) REFERENCES "order_status"\("id"\) ON DELETE RESTRICT ON UPDATE CASCADE/,
    );
  });

  it("ninguna FK borra ni anula en cascada el historico agregado", () => {
    expect(upDdl.match(/FOREIGN KEY/g)).toHaveLength(4);
    expect(upDdl.match(/ON DELETE RESTRICT/g)).toHaveLength(4);
    expect(upDdl).not.toMatch(/ON DELETE CASCADE/);
    expect(upDdl).not.toMatch(/ON DELETE SET NULL/);
    expect(MODELO.match(/onDelete: Restrict/g)).toHaveLength(4);
  });

  it("R36: el estatus huerfano cabe — hay FK pero ninguna lista cerrada de values", () => {
    expect(upDdl).toMatch(/REFERENCES "order_status"\("id"\)/);
    expect(upDdl).not.toMatch(/"estatus_id" IN \(/);
    expect(upDdl).not.toMatch(/estatus.*CHECK/);
  });
});

describe("R38 — RLS habilitada y sin policies", () => {
  it("habilita Row Level Security sobre la tabla nueva", () => {
    expect(upSql).toMatch(/ALTER TABLE "analytics_daily" ENABLE ROW LEVEL SECURITY;/);
  });

  it("no crea ninguna policy: solo el service role accede", () => {
    expect(upDdl).not.toMatch(/CREATE POLICY/i);
    expect(upDdl).not.toMatch(/DISABLE ROW LEVEL SECURITY/);
  });
});

describe("R39/R40 — exactamente cuatro indices, y ninguno de mas", () => {
  it("crea los cuatro declarados y nada mas", () => {
    const indices = Array.from(upDdl.matchAll(/CREATE (?:UNIQUE )?INDEX "([a-z_]+)"/g)).map(
      (m) => m[1],
    );
    expect(indices).toHaveLength(4);
    expect(indices.sort()).toEqual([
      "analytics_daily_grano_key",
      "analytics_daily_mensajero_fecha_idx",
      "analytics_daily_tienda_fecha_idx",
      "analytics_daily_zona_fecha_idx",
    ]);
  });

  it("los tres de recorte llevan la igualdad antes que el rango", () => {
    expect(upSql).toMatch(
      /CREATE INDEX "analytics_daily_tienda_fecha_idx" ON "analytics_daily"\("tienda_id", "fecha"\);/,
    );
    expect(upSql).toMatch(
      /CREATE INDEX "analytics_daily_mensajero_fecha_idx" ON "analytics_daily"\("mensajero_id", "fecha"\);/,
    );
    expect(upSql).toMatch(
      /CREATE INDEX "analytics_daily_zona_fecha_idx" ON "analytics_daily"\("zona_id", "fecha"\);/,
    );
    expect(MODELO).toMatch(/@@index\(\[tiendaId, fecha\]\)/);
    expect(MODELO).toMatch(/@@index\(\[mensajeroId, fecha\]\)/);
    expect(MODELO).toMatch(/@@index\(\[zonaId, fecha\]\)/);
  });

  it("R40: ningun indice sobre estatus_id ni causa_devolucion sueltos, ni sobre fecha sola", () => {
    const definiciones = Array.from(
      upDdl.matchAll(/CREATE (?:UNIQUE )?INDEX "[a-z_]+"\s*\n?\s*ON "analytics_daily"\(([^)]*)\)/g),
    ).map((m) => m[1].replace(/\s|"/g, ""));
    expect(definiciones).not.toContain("estatus_id");
    expect(definiciones).not.toContain("causa_devolucion");
    expect(definiciones).not.toContain("fecha");
  });
});

describe("R5/R41 — sin dinero, sin flotantes y puramente aditiva", () => {
  it("R5: ninguna columna monetaria ni de coma flotante", () => {
    expect(upDdl).not.toMatch(/\bDECIMAL\b/i);
    expect(upDdl).not.toMatch(/\bNUMERIC\b/i);
    expect(upDdl).not.toMatch(/\bREAL\b/i);
    expect(upDdl).not.toMatch(/\bDOUBLE\b/i);
    expect(upDdl).not.toMatch(/\bFLOAT\b/i);
    expect(upDdl).not.toMatch(/\bMONEY\b/i);
    expect(cuerpoTabla).not.toMatch(/monto|total_|precio|cobro|pago|iva|comision/i);
    expect(MODELO).not.toMatch(/\s(Float|Decimal)\s/);
  });

  it("no altera ni elimina nada preexistente", () => {
    expect(upDdl).not.toMatch(/DROP TABLE/);
    expect(upDdl).not.toMatch(/DROP COLUMN/);
    expect(upDdl).not.toMatch(/DROP TYPE/);
    expect(upDdl).not.toMatch(/DROP INDEX/);
    expect(upDdl).not.toMatch(/DROP CONSTRAINT/);
    expect(upDdl).not.toMatch(/ALTER TYPE/);
    expect(upDdl).not.toMatch(/ALTER COLUMN/);
    expect(upDdl).not.toMatch(/RENAME/i);
  });

  it("solo toca la tabla nueva: ningun ALTER TABLE ni CREATE TABLE sobre una preexistente", () => {
    const alteradas = new Set(
      Array.from(upDdl.matchAll(/ALTER TABLE "([a-z_]+)"/g)).map((m) => m[1]),
    );
    expect([...alteradas]).toEqual(["analytics_daily"]);
    const creadas = Array.from(upDdl.matchAll(/CREATE TABLE "([a-z_]+)"/g)).map((m) => m[1]);
    expect(creadas).toEqual(["analytics_daily"]);
  });

  it("no mueve un solo dato de negocio", () => {
    expect(upDdl).not.toMatch(/INSERT\s+INTO/i);
    expect(upDdl).not.toMatch(/^\s*UPDATE\s+"/im);
    expect(upDdl).not.toMatch(/DELETE\s+FROM/i);
    expect(upDdl).not.toMatch(/TRUNCATE/i);
    expect(upDdl).not.toMatch(/\bSELECT\b/i);
  });
});

describe("R42 — el down revierte exactamente lo que el up crea", () => {
  it("borra la tabla y nada mas", () => {
    expect(downSql).toMatch(/DROP TABLE IF EXISTS "analytics_daily";/);
    const sentencias = downDdl
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    expect(sentencias).toEqual(['DROP TABLE IF EXISTS "analytics_daily"']);
  });

  it("no toca ninguna tabla ni enum preexistente al revertir", () => {
    expect(downDdl).not.toMatch(/DROP TYPE/);
    expect(downDdl).not.toMatch(/ALTER TABLE/);
    expect(downDdl).not.toMatch(/gestion_causa_devolucion/);
    const borradas = Array.from(downDdl.matchAll(/DROP TABLE IF EXISTS "([a-z_]+)"/g)).map(
      (m) => m[1],
    );
    expect(borradas).toEqual(["analytics_daily"]);
  });

  it("la cabecera explica que el DROP arrastra PK, indices, FKs, CHECKs, comentarios y RLS", () => {
    expect(downSql).toMatch(/indices/i);
    expect(downSql).toMatch(/CHECK/);
    expect(downSql).toMatch(/RLS/);
    expect(downSql).toMatch(/ADITIVA/i);
  });
});
