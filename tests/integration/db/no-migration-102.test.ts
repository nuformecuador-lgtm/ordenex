import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { ORDEN_HISTORIAL_ORIGEN_TIPO_SEED } from "@/lib/types/orden-historial";
import { ORIGEN_TIPO_RECHAZO_SLA } from "@/lib/utils/rechazo-sla-flag";

// Feature 102 (T13) — cobertura ESTATICA del objetivo del gate F1.4: la feature NO introduce
// migracion (R3) ni infra de notificaciones (R17). La clasificacion SLA se DERIVA por join del
// historial inmutable (`origen_tipo = escalado_devuelta_sla`, feature 99) + el snapshot de 56, sin
// columna/tabla/enum nuevos. Lee schema.prisma y las carpetas de migracion por regex; sin Postgres.
//
// ACTUALIZADO POR LA FEATURE 146 (campana de notificaciones, spec aprobado). El R17 de la 102
// dice que *la 102* no introduce infra de notificaciones — no que el producto no pueda tenerla
// nunca. La 146 SI la introduce (`notificacion` + `notificacion_lectura`, migracion
// `20260727120000_notificacion`), asi que las dos aserciones que leian "no existe NINGUNA
// notificacion en el esquema" pasan a leer "la unica infra de notificaciones que existe es la de
// la 146": el invariante REAL de la 102 —que su clasificacion SLA se deriva y no se snapshotea—
// queda intacto y sigue verificado abajo.

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
] as const;

// La UNICA carpeta de migracion con concepto de notificacion admitida: la de la feature 146.
const MIGRACION_NOTIFICACIONES_146 = "_notificacion";

describe("Feature 102 · SIN migracion nueva (R3)", () => {
  it("no hay carpeta de migracion que introduzca la clasificacion SLA (por concepto)", () => {
    for (const dir of migrationDirs) {
      const lower = dir.toLowerCase();
      for (const concepto of CONCEPTOS_PROHIBIDOS) {
        expect(lower.includes(concepto)).toBe(false);
      }
    }
  });

  it("la unica migracion de notificaciones es la de la feature 146", () => {
    const conNotificacion = migrationDirs.filter((d) =>
      /notificac|notification|campana/i.test(d),
    );
    expect(conNotificacion).toEqual([
      conNotificacion.find((d) => d.endsWith(MIGRACION_NOTIFICACIONES_146)),
    ]);
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

describe("Feature 102 · SIN infra de notificaciones PROPIA (R17)", () => {
  it("la unica infra de notificaciones del esquema es la de la feature 146", () => {
    // La 102 no aporto ningun modelo; los que existen son EXACTAMENTE los dos de la 146.
    const modelos = Array.from(schemaPrisma.matchAll(/model\s+(Notificac\w*|Notification\w*)/gi)).map(
      (m) => m[1],
    );
    expect(modelos.sort()).toEqual(["Notificacion", "NotificacionLectura"]);

    const tablas = Array.from(
      schemaPrisma.matchAll(/@@map\(\s*"([^"]*(?:notificac|notification)[^"]*)"\s*\)/gi),
    ).map((m) => m[1]);
    expect(tablas.sort()).toEqual([
      "notificacion",
      "notificacion_entidad_tipo", // enum nativo de la 146
      "notificacion_evento", // enum nativo de la 146
      "notificacion_lectura",
      "notificacion_tipo", // enum nativo de la 146
    ]);
  });

  it("el aviso SLA a la tienda sigue siendo derivado: sin badge ni campana persistidos", () => {
    // El alcance de la 146 son sus dos tablas; el aviso de la 102 NO gano estado propio.
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
