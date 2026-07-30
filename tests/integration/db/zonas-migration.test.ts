import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Feature 24 — cobertura ESTATICA de la migracion `*_zonas_catalogo_global_pagos`
// (patron usuario-fulfillment-migration): lee migration.sql/down.sql/schema.prisma
// y verifica su contenido por regex. NO requiere Postgres real.

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

const migrationDir = migrationDirFor("_zonas_catalogo_global_pagos");
const upSql = fs.readFileSync(path.join(migrationDir, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(migrationDir, "down.sql"), "utf8");
const schema = fs.readFileSync(path.join(ROOT, "db", "schema.prisma"), "utf8");
const geoMigration = fs.readFileSync(
  path.join(migrationDirFor("_ordenes_catalogos_geografia"), "migration.sql"),
  "utf8",
);

describe("UP — columnas de zona (R1/R2/R3)", () => {
  it("R1: agrega pago_entrega/pago_rechazo (DECIMAL 12,2 NOT NULL DEFAULT 0) y es_gam (BOOLEAN DEFAULT false)", () => {
    expect(upSql).toMatch(/ADD COLUMN "pago_entrega" DECIMAL\(12,2\) NOT NULL DEFAULT 0/);
    expect(upSql).toMatch(/ADD COLUMN "pago_rechazo" DECIMAL\(12,2\) NOT NULL DEFAULT 0/);
    expect(upSql).toMatch(/ADD COLUMN "es_gam" BOOLEAN NOT NULL DEFAULT false/);
  });

  it("R2: crea el indice unico zona_nombre_key", () => {
    expect(upSql).toMatch(/CREATE UNIQUE INDEX "zona_nombre_key" ON "zona"\("nombre"\)/);
  });

  it("R3: crea el indice unico parcial zona_es_gam_unico WHERE es_gam = true", () => {
    expect(upSql).toMatch(
      /CREATE UNIQUE INDEX "zona_es_gam_unico" ON "zona"\("es_gam"\) WHERE "es_gam" = true/,
    );
  });
});

describe("UP — distrito.zona_id y usuario.zona_id (R5/R6/R7/R8)", () => {
  it("R5: agrega distrito.zona_id (nullable) + indice + FK RESTRICT", () => {
    expect(upSql).toMatch(/ALTER TABLE "distrito" ADD COLUMN "zona_id" TEXT;/);
    expect(upSql).toMatch(/CREATE INDEX "distrito_zona_id_idx" ON "distrito"\("zona_id"\)/);
    expect(upSql).toMatch(
      /ALTER TABLE "distrito" ADD CONSTRAINT "distrito_zona_id_fkey"[\s\S]*REFERENCES "zona"\("id"\)[\s\S]*ON DELETE RESTRICT/,
    );
  });

  it("R6: agrega usuario.zona_id (nullable) + indice + FK RESTRICT", () => {
    expect(upSql).toMatch(/ALTER TABLE "usuario" ADD COLUMN "zona_id" TEXT;/);
    expect(upSql).toMatch(/CREATE INDEX "usuario_zona_id_idx" ON "usuario"\("zona_id"\)/);
    expect(upSql).toMatch(
      /ALTER TABLE "usuario" ADD CONSTRAINT "usuario_zona_id_fkey"[\s\S]*REFERENCES "zona"\("id"\)[\s\S]*ON DELETE RESTRICT/,
    );
  });

  it("R7/R8: ambas FK usan ON DELETE RESTRICT (impide referenciar/borrar zona inexistente/en uso)", () => {
    const restrictCount = (upSql.match(/ON DELETE RESTRICT/g) ?? []).length;
    expect(restrictCount).toBeGreaterThanOrEqual(2);
    // nullable: las columnas se agregan como TEXT sin NOT NULL
    expect(upSql).not.toMatch(/ADD COLUMN "zona_id" TEXT NOT NULL/);
  });
});

describe("UP — provincia.zona_id: R4 DROP ejecutado", () => {
  it("elimina provincia.zona_id (columna + FK + indice); la zona se deriva del distrito", () => {
    expect(upSql).toMatch(
      /ALTER TABLE "provincia" DROP CONSTRAINT IF EXISTS "provincia_zona_id_fkey"/,
    );
    expect(upSql).toMatch(/DROP INDEX IF EXISTS "provincia_zona_id_idx"/);
    expect(upSql).toMatch(/ALTER TABLE "provincia" DROP COLUMN "zona_id"/);
    // ya NO se relaja a nullable: se elimina del todo
    expect(upSql).not.toMatch(/ALTER COLUMN "zona_id" DROP NOT NULL/);
  });
});

describe("R9/R10 — jerarquia geografica y orden intactas", () => {
  it("R9: la migracion NO altera las FK canton.provincia_id ni distrito.canton_id", () => {
    expect(upSql).not.toMatch(/canton_provincia_id_fkey/);
    expect(upSql).not.toMatch(/distrito_canton_id_fkey/);
  });

  it("R10: ni el UP ni el DOWN tocan la tabla orden", () => {
    expect(upSql).not.toMatch(/ALTER TABLE "orden"/);
    expect(downSql).not.toMatch(/ALTER TABLE "orden"/);
    expect(upSql).not.toMatch(/DROP TABLE/i);
  });
});

describe("DOWN — revierte lo aditivo (R11)", () => {
  it("elimina usuario.zona_id y distrito.zona_id (FK + indice + columna)", () => {
    expect(downSql).toMatch(/ALTER TABLE "usuario" DROP CONSTRAINT IF EXISTS "usuario_zona_id_fkey"/);
    expect(downSql).toMatch(/ALTER TABLE "usuario" DROP COLUMN IF EXISTS "zona_id"/);
    expect(downSql).toMatch(/ALTER TABLE "distrito" DROP CONSTRAINT IF EXISTS "distrito_zona_id_fkey"/);
    expect(downSql).toMatch(/ALTER TABLE "distrito" DROP COLUMN IF EXISTS "zona_id"/);
  });

  it("elimina indices y columnas nuevas de zona y restaura provincia.zona_id (columna + FK)", () => {
    expect(downSql).toMatch(/DROP INDEX IF EXISTS "zona_es_gam_unico"/);
    expect(downSql).toMatch(/DROP INDEX IF EXISTS "zona_nombre_key"/);
    expect(downSql).toMatch(/ALTER TABLE "zona" DROP COLUMN IF EXISTS "es_gam"/);
    expect(downSql).toMatch(/ALTER TABLE "provincia" ADD COLUMN "zona_id" TEXT NOT NULL/);
    expect(downSql).toMatch(/ADD CONSTRAINT "provincia_zona_id_fkey"/);
  });

  it("la carpeta contiene migration.sql y down.sql, con timestamp posterior a las previas", () => {
    expect(fs.existsSync(path.join(migrationDir, "migration.sql"))).toBe(true);
    expect(fs.existsSync(path.join(migrationDir, "down.sql"))).toBe(true);
    const dirs = fs
      .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    const thisDir = dirs.find((d) => d.endsWith("_zonas_catalogo_global_pagos"))!;
    const previas = dirs.filter(
      (d) =>
        !d.endsWith("_zonas_catalogo_global_pagos") &&
        !d.endsWith("_orden_num_guia_deferred_mensajero_asignado_espera_aceptacion") && // feature 17: apendida despues
        !d.endsWith("_order_status_en_ruta_bodega_satelite") && // feature 30: apendida despues
        !d.endsWith("_gestion_orden_estados_metodo_pago") && // feature 36: apendida despues
        !d.endsWith("_order_status_en_bodega_satelite") && // feature 33: apendida despues
        !d.endsWith("_rename_cobro_tarifas") && // PR #40: apendida despues
        !d.endsWith("_tarifa_zona_mensajero_zona_vehiculo_unique") && // PR #40: apendida despues
        !d.endsWith("_provincia_zona_id_nullable") && // PR #40: apendida despues
        !d.endsWith("_zona_distrito_nm") && // PR #40: apendida despues
        !d.endsWith("_zona_es_central_rename") && // feature 54: apendida despues
        !d.endsWith("_cierre_dia") && // feature 37: apendida despues
        !d.endsWith("_cierre_dia_resolucion") && // feature 38: apendida despues
        !d.endsWith("_cierre_bodega") && // feature 40: apendida despues
        !d.endsWith("_pago_mensajero_cierre") && // feature 39: apendida despues
        !d.endsWith("_ingreso_bodega_rechazos") && // feature 56: apendida despues
        !d.endsWith("_cierre_estado_vencido") && // feature 41: apendida despues
        !d.endsWith("_wallet_movimiento") && // feature 42: apendida despues
        !d.endsWith("_wallet_tienda_movimiento") && // feature 43: apendida despues
        !d.endsWith("_pago_mensajero_movimiento") && // feature 44: apendida despues
        !d.endsWith("_orden_liberada_reprogramada_at") && // feature 46: apendida despues
        !d.endsWith("_orden_historial_estado") && // feature 49: apendida despues
        !d.endsWith("_wallet_egreso_gasto_fijo_variable") && // feature 45: apendida despues
        !d.endsWith("_gasto_fijo_plantilla") && // feature 45: apendida despues
        // PR #64: apendidas despues. `_tarifa_tienda_status` comparte el timestamp
        // 20260712100000 con `_cierre_dia` (nacio con fecha del 12, se escribio el 14).
        // Deuda conocida ACEPTADA: no se renombra la carpeta porque la migracion ya
        // esta aplicada y registrada POR NOMBRE en `_prisma_migrations`; renombrarla
        // la haria ver como pendiente (y a la vieja como desaparecida) en toda base
        // existente. El empate no altera el orden efectivo ni este invariante.
        !d.endsWith("_tarifa_tienda_status") &&
        !d.endsWith("_drop_distrito_zona_id") &&
        !d.endsWith("_seed_geografia_cr") &&
        !d.endsWith("_seed_zonas_pago_distrito") &&
        !d.endsWith("_reconcile_fks_drop_order_status_value") &&
        !d.endsWith("_order_status_pendiente") && // PR #64 (fix asignaciones)
        !d.endsWith("_seed_order_status_completo") && // PR #64 (fix asignaciones)
        !d.endsWith("_gestion_orden_anulacion") && // feature 67: apendida despues
        !d.endsWith("_orden_historial_gestion_fk_restrict") && // feature 67 (F1.4-i): apendida despues
        !d.endsWith("_order_status_recibido_origen") && // PR #75: apendida despues
        !d.endsWith("_cierre_detail") && // feature 69: apendida despues
        !d.endsWith("_gestion_orden_causa_devolucion") && // feature 73: apendida despues
        !d.endsWith("_orden_asignado_at") && // feature 76: apendida despues
        !d.endsWith("_premio_ranking") && // feature 76: apendida despues
        // feature 81: apendidas despues. Este `endsWith` cubre las DOS carpetas
        // (`..._api_key` y `..._rol_api_key`, que tambien termina en "_api_key").
        !d.endsWith("_api_key") &&
        !d.endsWith("_orden_historial_origen_tipo_carga_api") && // feature 88: apendida despues
        !d.endsWith("_gasto_fijo_periodicidad") && // feature 84 (wallet periodicidad): apendida despues
        !d.endsWith("_jobs_cola") && // feature 90: apendida despues
        // feature 91: apendidas despues (enum de job_tipo + columnas de geocodificacion).
        !d.endsWith("_job_tipo_geocodificacion") &&
        !d.endsWith("_orden_geocode") &&
        // feature 92: apendidas despues (enum de job_tipo + tablas de la ruta optimizada).
        !d.endsWith("_job_tipo_optimizacion_ruta") &&
        !d.endsWith("_ruta_optimizada") &&
        // despliegue: apendida despues. Neutraliza el usuario maestro sembrado
        // con hash hardcodeado por `20260709120000_seed_maestro_user`.
        !d.endsWith("_drop_default_maestro_user") &&
        // num_guia no secuencial: apendidas despues. La segunda reemplaza la
        // permutacion de la primera (dejaba delta constante entre consecutivas).
        !d.endsWith("_num_guia_no_secuencial") &&
        !d.endsWith("_num_guia_feistel") &&
        // feature 104 (rama feature/99): apendidas despues (enum de job_tipo + tabla de suscripcion de webhook).
        !d.endsWith("_job_tipo_webhook_estado") &&
        !d.endsWith("_webhook_suscripcion") &&
        !d.endsWith("_orden_historial_origen_tipo_sla_devuelta") && // feature 99: apendida despues
        !d.endsWith("_orden_historial_origen_tipo_resolver_novedad") && // feature 100: apendida despues
        !d.endsWith("_orden_prioridad") && // feature 101: apendida despues
        !d.endsWith("_cancelacion_api_por_key") && // feature 106: apendida despues
        !d.endsWith("_api_key_estado") && // merge origin/dev: apendida despues
        !d.endsWith("_plantilla_mensaje") && // feature 107: apendida despues
        !d.endsWith("_order_status_sin_gestionar") && // feature 109: apendida despues
        !d.endsWith("_orden_historial_origen_sin_gestionar") && // feature 109: apendida despues
        !d.endsWith("_orden_mensajero_meta") && // feature 115: apendida despues
        !d.endsWith("_metodo_pago_rename_simpe_to_sinpe") && // feature 118: apendida despues
        !d.endsWith("_gestion_orden_evidencia") && // feature 119: apendida despues
        !d.endsWith("_job_tipo_whatsapp_template_sync") && // integracion WhatsApp: apendida despues
        !d.endsWith("_plantilla_template_id") && // integracion WhatsApp: apendida despues
        !d.endsWith("_chat_whatsapp") && // feature 120: apendida despues
        !d.endsWith("_job_tipo_whatsapp_chat_envio") && // feature 120: apendida despues
        !d.endsWith("_chat_mensaje_ubicacion") && // feature 121: apendida despues
        !d.endsWith("_order_status_rename_nomenclatura") && // feature 137 (rename order_status): apendida despues
        !d.endsWith("_orden_historial_origen_recepcion_bodega_central") && // feature 138 (recepcion bodega central): apendida despues
        !d.endsWith("_order_status_devolucion_rechazadas") && // feature 139 (devolucion rechazadas): apendida despues
        !d.endsWith("_orden_historial_origen_devolucion_rechazada") && // feature 139 (origen_tipo devolucion): apendida despues
        !d.endsWith("_notificacion") && // feature 146 (campana de notificaciones): apendida despues
        !d.endsWith("_orden_indices_filtros") && // feature 144 (indices de filtros de orden): apendida despues
        !d.endsWith("_order_status_en_reparto") && // feature 153 (rename del value a en_reparto): apendida despues
        !d.endsWith("_drop_orden_mensajero_sugerido") && // feature 159 (retiro de la sugerencia): apendida despues
        !d.endsWith("_order_status_v2_por_recolectar_incidente") && // feature 154 (catalogo v2): apendida despues
        !d.endsWith("_order_status_retiro_en_fulfillment") && // feature 155 (retiro del value): apendida despues
        !d.endsWith("_orden_historial_origen_recoleccion_tienda_incidente") && // feature 154 (familias v2): apendida despues
        !d.endsWith("_carga_orden_carga_id"), // feature 141 (tabla carga + orden.carga_id): apendida despues
    );
    // `>=`, no `>`: el invariante es que zonas NO sea ANTERIOR a las previas. Empatar
    // en timestamp con otra carpeta es tolerable (ver deuda de 20260712100000 arriba);
    // nacer con un timestamp anterior a las previas NO lo es, y sigue fallando.
    expect(thisDir >= previas[previas.length - 1]).toBe(true);
  });
});

describe("R12 — RLS de la geografia permanece habilitado", () => {
  it("la migracion previa habilito RLS en zona/provincia/canton/distrito", () => {
    expect(geoMigration).toMatch(/ALTER TABLE "zona" ENABLE ROW LEVEL SECURITY/);
    expect(geoMigration).toMatch(/ALTER TABLE "provincia" ENABLE ROW LEVEL SECURITY/);
    expect(geoMigration).toMatch(/ALTER TABLE "canton" ENABLE ROW LEVEL SECURITY/);
    expect(geoMigration).toMatch(/ALTER TABLE "distrito" ENABLE ROW LEVEL SECURITY/);
  });

  it("esta migracion NO deshabilita RLS", () => {
    expect(upSql).not.toMatch(/DISABLE ROW LEVEL SECURITY/);
  });
});

describe("schema.prisma refleja el modelo (feature 54)", () => {
  it("Zona lleva esCentral (es_central) y nombre unico; ya no lleva pagos", () => {
    expect(schema).toMatch(/esCentral\s+Boolean .*@map\("es_central"\)/);
    expect(schema).not.toMatch(/@map\("pago_entrega"\)/);
    expect(schema).not.toMatch(/@map\("pago_rechazo"\)/);
    expect(schema).toMatch(/nombre\s+String\s+@unique/);
  });

  it("Distrito y Usuario tienen zonaId nullable con relacion e indice", () => {
    expect(schema).toMatch(/zonaId\s+String\?\s+@map\("zona_id"\)/);
  });
});

// Feature 54 (reconciliacion PR #40): migracion que renombra es_gam -> es_central
// y elimina las columnas muertas pago_entrega/pago_rechazo de zona.
describe("feature 54 — migracion zona_es_central_rename", () => {
  const renameDir = migrationDirFor("_zona_es_central_rename");
  const renameUp = fs.readFileSync(path.join(renameDir, "migration.sql"), "utf8");
  const renameDown = fs.readFileSync(path.join(renameDir, "down.sql"), "utf8");

  it("UP renombra la columna es_gam -> es_central y el indice unico parcial", () => {
    expect(renameUp).toMatch(/ALTER TABLE "zona" RENAME COLUMN "es_gam" TO "es_central"/);
    expect(renameUp).toMatch(/ALTER INDEX "zona_es_gam_unico" RENAME TO "zona_es_central_unico"/);
  });

  it("UP elimina las columnas muertas pago_entrega/pago_rechazo", () => {
    expect(renameUp).toMatch(/ALTER TABLE "zona" DROP COLUMN "pago_entrega"/);
    expect(renameUp).toMatch(/ALTER TABLE "zona" DROP COLUMN "pago_rechazo"/);
  });

  it("DOWN revierte el rename y restaura los pagos", () => {
    expect(renameDown).toMatch(/ALTER TABLE "zona" RENAME COLUMN "es_central" TO "es_gam"/);
    expect(renameDown).toMatch(/ALTER INDEX "zona_es_central_unico" RENAME TO "zona_es_gam_unico"/);
    expect(renameDown).toMatch(/ADD COLUMN "pago_entrega"/);
    expect(renameDown).toMatch(/ADD COLUMN "pago_rechazo"/);
  });
});
