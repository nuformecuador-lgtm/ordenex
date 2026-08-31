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

/**
 * Carpetas de migracion con concepto de notificacion que SI estan admitidas, ademas de la 146.
 *
 * ⚠️ ESTA LISTA NO RELAJA LA GUARDIA: sigue siendo cerrada, y cada entrada tiene que decir de que
 * feature es y por que. Lo que la 102 afirma es que ELLA no introdujo infra de notificaciones
 * (R3/R17); no que ninguna feature posterior pueda volver a tocar la de la 146. Anadida el
 * 2026-08-20 por la feature 253 (D6), que suma UN valor a `notificacion_evento` y otro a
 * `notificacion_entidad_tipo` — sin tablas, sin columnas y sin modelos nuevos, que es lo que el
 * resto de este archivo sigue comprobando.
 *
 * Segunda entrada anadida el 2026-08-22 por la feature 262 (D7, P2 respondida SI por la puerta
 * humana): suma `dia_reparto_corregido` a `notificacion_evento` y `orden_dia_reparto_cambio` a
 * `notificacion_entidad_tipo` para avisar al mensajero cuando le corrigen el dia de reparto. Igual
 * que la de la 253: DOS `ALTER TYPE` y nada mas — sin tablas de notificacion nuevas, sin columnas y
 * sin modelos nuevos, asi que el resto de este archivo sigue afirmando lo mismo y sigue siendo
 * cierto. (La tabla que SI crea la 262, `orden_dia_reparto_cambio`, vive en OTRA migracion que no
 * lleva la palabra «notificacion» y no es infra de campana: es el rastro de la correccion.)
 *
 * Cuarta entrada anadida el 2026-08-29 por la ficha 333 (design 4.1/4.2, R29/R30/R36): suma
 * `gasto_fijo_cobro_pendiente` a `notificacion_evento` y `gasto_fijo_cobro_dia` a
 * `notificacion_entidad_tipo` para avisar al maestro de que quedan cobros de gasto fijo esperando
 * decision. Igual que las tres anteriores: DOS `ALTER TYPE` y nada mas. La 333 SI crea una tabla
 * —`gasto_fijo_cobro`—, pero vive en OTRA migracion (`20260829120000_gasto_fijo_cobro`) que no
 * lleva la palabra «notificacion» y no es infra de campana: es la cola de cobros, no el aviso.
 * Por eso las dos aserciones de abajo sobre `schema.prisma` (los DOS modelos de la 146 y las CINCO
 * tablas/enums con nombre de notificacion) siguen siendo EXACTAMENTE las mismas y siguen verdes.
 */
const MIGRACIONES_NOTIFICACIONES_POSTERIORES = [
  "_notificacion_evento_postulacion_recurso", // feature 253 / D6
  "_notificacion_evento_dia_reparto_corregido", // feature 262 / D7
  "_notificacion_evento_bloqueo_cierre", // feature 271 / §9.2 (Q4, 2026-08-23)
  // Ficha 333 / design 4.1-4.2 (2026-08-29): el aviso «hay cobros de gasto fijo por decidir».
  // Los DOS enums de la campana ganan un valor; la tabla `gasto_fijo_cobro` va en su propia
  // migracion, que no cae en este filtro.
  "_notificacion_evento_gasto_fijo_cobro",
] as const;

describe("Feature 102 · SIN migracion nueva (R3)", () => {
  it("no hay carpeta de migracion que introduzca la clasificacion SLA (por concepto)", () => {
    for (const dir of migrationDirs) {
      const lower = dir.toLowerCase();
      for (const concepto of CONCEPTOS_PROHIBIDOS) {
        expect(lower.includes(concepto)).toBe(false);
      }
    }
  });

  it("la unica migracion de notificaciones es la de la 146, salvo las declaradas arriba", () => {
    const conNotificacion = migrationDirs.filter((d) =>
      /notificac|notification|campana/i.test(d),
    );
    const noDeclaradas = conNotificacion.filter(
      (d) =>
        !d.endsWith(MIGRACION_NOTIFICACIONES_146) &&
        !MIGRACIONES_NOTIFICACIONES_POSTERIORES.some((s) => d.endsWith(s)),
    );
    expect(
      noDeclaradas,
      "hay una migracion con concepto de notificacion que nadie declaro en " +
        "`MIGRACIONES_NOTIFICACIONES_POSTERIORES`: o es de la 102 (y entonces R3/R17 se rompio) o " +
        "es de otra feature y hay que nombrarla ahi con su motivo",
    ).toEqual([]);
    // Anti-vacuidad: la de la 146 tiene que seguir estando (si el filtro dejara de encontrar
    // nada, este test estaria verde sin haber comprobado nada).
    expect(conNotificacion.some((d) => d.endsWith(MIGRACION_NOTIFICACIONES_146))).toBe(true);
    // Y cada carpeta declarada como posterior tiene que EXISTIR: una excepcion que sobrevive a su
    // motivo es basura.
    for (const sufijo of MIGRACIONES_NOTIFICACIONES_POSTERIORES) {
      expect(conNotificacion.some((d) => d.endsWith(sufijo)), `sobra ${sufijo}`).toBe(true);
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
