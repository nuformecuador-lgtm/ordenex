import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { ORDEN_HISTORIAL_ORIGEN_TIPO_SEED } from "@/lib/types/orden-historial";
import { ORIGEN_TIPO_RECHAZO_SLA } from "@/lib/utils/rechazo-sla-flag";

// Feature 102 (T13) — cobertura ESTATICA del objetivo del gate F1.4: la feature NO introduce
// migracion (R3) ni infra de notificaciones (R17). La clasificacion SLA se DERIVA por join del
// historial inmutable (`origen_tipo = escalado_devuelta_sla`, feature 99) + el snapshot de 56, sin
// columna/tabla/enum nuevos. Lee schema.prisma y las carpetas de migracion por regex; sin Postgres.

const ROOT = path.join(__dirname, "..", "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");
const schemaPrisma = fs.readFileSync(path.join(ROOT, "db", "schema.prisma"), "utf8");

const migrationDirs = fs
  .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name);

// Conceptos que una implementacion "con migracion" o "con notificaciones" habria introducido.
// Ninguno debe aparecer como carpeta de migracion ni como objeto de schema (R3/R17).
const CONCEPTOS_PROHIBIDOS = [
  "es_rechazo_sla", // columna snapshot de la clasificacion (descartada, design §7.1)
  "esrechazosla",
  "total_ingreso_bodega_rechazos_sla", // subtotal SLA snapshoteado (descartado, design §7.1)
  "rechazo_sla_visible",
  "notificac", // tabla/feed de notificaciones (descartado por el gate)
  "notification",
  "campana",
] as const;

describe("Feature 102 · SIN migracion nueva (R3)", () => {
  it("no hay carpeta de migracion que introduzca la clasificacion/notificacion (por concepto)", () => {
    for (const dir of migrationDirs) {
      const lower = dir.toLowerCase();
      for (const concepto of CONCEPTOS_PROHIBIDOS) {
        expect(lower.includes(concepto)).toBe(false);
      }
    }
  });

  it("schema.prisma NO tiene columna snapshot de la clasificacion SLA (ni en gestion ni en cierre)", () => {
    const lower = schemaPrisma.toLowerCase();
    // La clasificacion se DERIVA; no se congela en una columna nueva.
    expect(lower).not.toContain("es_rechazo_sla");
    expect(lower).not.toContain("esrechazosla");
    // El subtotal SLA no se snapshotea por cierre.
    expect(lower).not.toContain("total_ingreso_bodega_rechazos_sla");
  });
});

describe("Feature 102 · SIN infra de notificaciones (R17)", () => {
  it("schema.prisma NO declara modelo/enum/tabla de notificacion, feed, campana ni badge", () => {
    expect(schemaPrisma).not.toMatch(/model\s+Notificac\w*/i);
    expect(schemaPrisma).not.toMatch(/model\s+Notification\w*/i);
    expect(schemaPrisma).not.toMatch(/@@map\(\s*"[^"]*notificac[^"]*"\s*\)/i);
    expect(schemaPrisma).not.toMatch(/@@map\(\s*"[^"]*notification[^"]*"\s*\)/i);
    // El aviso a la tienda es una superficie derivada de solo-lectura, sin badge/campana persistido.
    expect(schemaPrisma.toLowerCase()).not.toContain("campana");
    expect(schemaPrisma.toLowerCase()).not.toContain("badge");
  });
});

describe("Feature 102 · la derivacion REUSA infra existente (no requiere migracion)", () => {
  it("el `origen_tipo` que marca SLA ya existe (feature 99), no lo agrega esta feature", () => {
    expect(ORIGEN_TIPO_RECHAZO_SLA).toBe("escalado_devuelta_sla");
    expect(ORDEN_HISTORIAL_ORIGEN_TIPO_SEED).toContain("escalado_devuelta_sla");
    // Reflejado en el enum Prisma (sin drift): lo introdujo la feature 99, no la 102.
    const enumBloque = schemaPrisma.match(/enum OrdenHistorialOrigenTipo \{([\s\S]*?)\n\}/);
    expect(enumBloque).not.toBeNull();
    expect((enumBloque as RegExpMatchArray)[1]).toMatch(/\bescalado_devuelta_sla\b/);
    // La migracion que lo añadio pertenece a la feature 99 (no una carpeta nueva de la 102).
    expect(migrationDirs.some((d) => d.endsWith("_orden_historial_origen_tipo_sla_devuelta"))).toBe(
      true,
    );
  });

  it("la gestion ya expone las DOS entradas inmutables del desglose (historial + snapshot de 56)", () => {
    const gestionModel = schemaPrisma.match(/model GestionOrden \{([\s\S]*?)\n\}/);
    expect(gestionModel).not.toBeNull();
    const cuerpo = (gestionModel as RegExpMatchArray)[1];
    // Relacion al historial (fuente de la clasificacion) + snapshot del monto de 56.
    expect(cuerpo).toMatch(/historialEstados\s+OrdenHistorialEstado\[\]/);
    expect(cuerpo).toMatch(/ingresoBodegaRechazo\s+Decimal\?/);
  });
});
