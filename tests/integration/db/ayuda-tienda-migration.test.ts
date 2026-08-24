import fs from "fs";
import path from "path";

import { describe, expect, it } from "vitest";

import {
  ORDEN_HISTORIAL_ORIGEN_TIPO_SEED,
  ORIGEN_TIPOS_CON_GESTION,
  ORIGEN_TIPOS_VISITA_REAL,
} from "@/lib/types/orden-historial";
import { ORDER_STATUS_SEED } from "@/lib/types/order-status";
import { TRANSICIONES } from "@/lib/types/order-status-transiciones";
import { quitarComentariosSql } from "@/tests/fixtures/sin-comentarios";

// Feature 235 (T1.2/T6.2/T6.3, R41/R42) — cobertura ESTATICA de las TRES migraciones de esta
// feature, por lectura de `migration.sql` / `down.sql`. Mismo patron que
// `anclaje-devolucion-migration.test.ts`: NO requiere Postgres real (no hay DB en el entorno de
// test de este repo; `tests/integration/db` son emuladores y lecturas de fichero).
//
// Lo que se afirma aqui, y por que cada cosa:
//   - las tres son IDEMPOTENTES (aplicarlas dos veces no duplica): `ADD VALUE IF NOT EXISTS`,
//     `INSERT ... WHERE NOT EXISTS` y `ADD COLUMN IF NOT EXISTS` en el down del retiro;
//   - las tres tienen DOWN, y el del enum RECREA el tipo con la lista vigente (Postgres no tiene
//     `DROP VALUE`), dejando la base LEGIBLE por el codigo anterior (R42);
//   - NINGUNA mueve ordenes entre estados desde SQL (R41): eso solo pasa por `appendCambioEstado`;
//   - el DOWN del enum FALLA RUIDOSAMENTE si quedan filas con las familias nuevas, y eso es
//     CORRECTO: borrar el rastro de que un mensajero pidio auxilio no es seguro;
//   - las dos familias nuevas NO entran en `ORIGEN_TIPOS_VISITA_REAL` — meterlas ahi subiria el
//     conteo de intentos, adelantaria el escalado del cron SLA y cobraria el rechazo antes de
//     tiempo (R11, dinero real) — ni en `ORIGEN_TIPOS_CON_GESTION`.

const MIGRATIONS_DIR = path.join(__dirname, "..", "..", "..", "db", "migrations");

function migrationDirFor(suffix: string): string {
  const dir = fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .find((name) => name.endsWith(suffix));
  if (!dir) throw new Error(`No se encontro la carpeta de migracion ${suffix}`);
  return path.join(MIGRATIONS_DIR, dir);
}

const catalogoDir = migrationDirFor("_order_status_ayuda_tienda");
const catalogoUp = fs.readFileSync(path.join(catalogoDir, "migration.sql"), "utf8");
const catalogoDown = fs.readFileSync(path.join(catalogoDir, "down.sql"), "utf8");

const enumDir = migrationDirFor("_orden_historial_origen_ayuda_tienda");
const enumUp = fs.readFileSync(path.join(enumDir, "migration.sql"), "utf8");
const enumDown = fs.readFileSync(path.join(enumDir, "down.sql"), "utf8");

const retiroDir = migrationDirFor("_orden_retiro_ayuda");
const retiroUp = fs.readFileSync(path.join(retiroDir, "migration.sql"), "utf8");
const retiroDown = fs.readFileSync(path.join(retiroDir, "down.sql"), "utf8");

const schemaPrisma = fs.readFileSync(
  path.join(__dirname, "..", "..", "..", "db", "schema.prisma"),
  "utf8",
);

const ESTATUS = "ayuda_tienda";
const IDA = "solicitud_ayuda_tienda";
const VUELTA = "rescate_ayuda_tienda";

/** Las tres, en el orden en que se aplican. El orden importa (design §9). */
const TODAS = [
  { nombre: "catalogo", up: catalogoUp, down: catalogoDown },
  { nombre: "enum", up: enumUp, down: enumDown },
  { nombre: "retiro de la columna", up: retiroUp, down: retiroDown },
];

/* -------------------------------------------------------------------------- */
/* 1. El value del catalogo `order_status`                                      */
/* -------------------------------------------------------------------------- */

describe("Feature 235 · catalogo — `ayuda_tienda` (R1)", () => {
  it("el UP inserta con `WHERE NOT EXISTS` (aplicarlo dos veces no duplica)", () => {
    expect(catalogoUp).toMatch(/INSERT INTO "order_status" \("id", "value"\)/);
    expect(catalogoUp).toMatch(
      new RegExp(
        `WHERE NOT EXISTS \\(SELECT 1 FROM "order_status" WHERE "value" = '${ESTATUS}'\\);`,
      ),
    );
  });

  it("R41 — el UP NO mueve ninguna orden de estado desde SQL (sin backfill)", () => {
    const sql = quitarComentariosSql(catalogoUp);
    expect(sql).not.toMatch(/UPDATE\s+"orden"/i);
    expect(sql).not.toMatch(/SET\s+"?estatus_id"?/i);
    expect(sql).not.toMatch(/INSERT INTO "orden_historial_estado"/i);
  });

  it("el UP es ADITIVO: ni tablas, ni columnas, ni RLS", () => {
    expect(catalogoUp).not.toMatch(/CREATE TABLE/i);
    expect(catalogoUp).not.toMatch(/DROP COLUMN/i);
    expect(catalogoUp).not.toMatch(/ALTER COLUMN/i);
    expect(catalogoUp).not.toMatch(/CREATE POLICY/i);
    expect(catalogoUp).not.toMatch(/ROW LEVEL SECURITY/i);
  });

  it("R42 — el DOWN borra la fila SOLO si nadie la referencia (orden ni historial)", () => {
    expect(catalogoDown).toMatch(/DELETE FROM "order_status" os/);
    expect(catalogoDown).toMatch(
      /NOT EXISTS \(SELECT 1 FROM "orden" o WHERE o\."estatus_id" = os\."id"\)/,
    );
    expect(catalogoDown).toMatch(/NOT EXISTS \(SELECT 1 FROM "orden_historial_estado" h/);
    expect(catalogoDown).toMatch(
      /h\."estatus_destino_id" = os\."id" OR h\."estatus_origen_id" = os\."id"/,
    );
  });

  it("R41/R42 — el DOWN tampoco mueve ordenes: deja la base legible, no reescrita", () => {
    // A diferencia del down de la 157, este NO reasigna las ordenes que quedaran en el estatus de
    // ayuda: la fila del catalogo sobrevive huerfana y el codigo anterior las lee como un estatus
    // desconocido (chip neutro), en vez de romper.
    const sql = quitarComentariosSql(catalogoDown);
    expect(sql).not.toMatch(/UPDATE\s+"orden"/i);
    expect(sql).not.toMatch(/INSERT INTO "orden_historial_estado"/i);
  });
});

/* -------------------------------------------------------------------------- */
/* 2. Las dos familias del enum `orden_historial_origen_tipo`                   */
/* -------------------------------------------------------------------------- */

describe("Feature 235 · enum — las DOS familias del viaje (R10/P2)", () => {
  it("el UP anade los DOS valores con `IF NOT EXISTS` (aplicarlo dos veces no duplica)", () => {
    for (const familia of [IDA, VUELTA]) {
      expect(enumUp).toMatch(
        new RegExp(
          `ALTER TYPE "orden_historial_origen_tipo" ADD VALUE IF NOT EXISTS '${familia}';`,
        ),
      );
    }
  });

  it("P2 — ESTA migracion no declara `gestion_tienda_ayuda`: nacio con su productor (ficha 237)", () => {
    // La convencion del repo, con precedente costoso: `incidente` (154) se declaro sin productor y
    // «costo el tren 154+155+156».
    //
    // ⏳ 2026-08-20: la segunda mitad de este caso afirmaba que el valor tampoco estaba en el SEED
    // de TS. La ficha 237 trajo su productor
    // (`GestionOrdenRepository.crearGestionDesdeAyuda`) y su propia migracion
    // (`20260820120000_orden_historial_origen_gestion_tienda_ayuda`), asi que esa mitad cumplio su
    // funcion y se INVIERTE: lo que sigue siendo cierto —y es lo que este archivo vigila— es que
    // el `migration.sql` DE LA 235 no lo menciona. Que el valor exista hoy es asunto del test de
    // la migracion de la 237, no de esta.
    expect(quitarComentariosSql(enumUp)).not.toContain("gestion_tienda_ayuda");
    expect([...ORDEN_HISTORIAL_ORIGEN_TIPO_SEED]).toContain("gestion_tienda_ayuda");
  });

  it("el UP es ADITIVO: ni tablas, ni columnas, ni RLS, ni movimientos de orden (R41)", () => {
    const sql = quitarComentariosSql(enumUp);
    expect(sql).not.toMatch(/CREATE TABLE/i);
    expect(sql).not.toMatch(/ALTER COLUMN/i);
    expect(sql).not.toMatch(/DROP COLUMN/i);
    expect(sql).not.toMatch(/CREATE POLICY/i);
    expect(sql).not.toMatch(/ROW LEVEL SECURITY/i);
    expect(sql).not.toMatch(/UPDATE\s+"orden"/i);
    expect(sql).not.toMatch(/estatus_id/i);
  });

  it("no USA los valores nuevos en la misma transaccion que los anade (Postgres 55P04)", () => {
    const sql = quitarComentariosSql(enumUp);
    for (const familia of [IDA, VUELTA]) {
      expect(sql).not.toMatch(new RegExp(`'${familia}'::orden_historial_origen_tipo`));
    }
    expect(sql).not.toMatch(/INSERT INTO "orden_historial_estado"/i);
  });

  it("R42 — el DOWN recrea el tipo con los 27 valores previos, SIN los dos nuevos", () => {
    expect(enumDown).toMatch(
      /ALTER TYPE "orden_historial_origen_tipo" RENAME TO "orden_historial_origen_tipo_old";/,
    );
    const match = enumDown.match(
      /CREATE TYPE "orden_historial_origen_tipo" AS ENUM \(([\s\S]*?)\);/,
    );
    expect(match).not.toBeNull();
    const valores = [...(match as RegExpMatchArray)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(valores).toHaveLength(27);
    expect(valores).not.toContain(IDA);
    expect(valores).not.toContain(VUELTA);

    // Los 27 previos = el SEED actual menos los valores AÑADIDOS EN O DESPUES de la 235. Este
    // `down.sql` recrea el enum a su estado PRE-235 (fijo, historico) y NO SE TOCA nunca; lo que
    // se ajusta cuando el enum crece es el conjunto que se le descuenta al SEED vigente. Mismo
    // patron que los downs del 67, 99, 100, 106, 138, 149, 154 y 239.
    const AÑADIDOS_EN_O_DESPUES_DEL_235 = new Set<string>([
      IDA,
      VUELTA,
      // Feature 237 (2026-08-20): la TERCERA familia del viaje de la ayuda, posterior a esta foto.
      "gestion_tienda_ayuda",
      // Feature 240 (2026-08-20): el rechazo manual de la tienda desde la devolucion anclada.
      // Tambien posterior a esta foto, asi que se descuenta igual. El `down.sql` de la 235 NO se
      // toca: aplicarlo despues de la 240 deja el enum sin este valor, y ese es el comportamiento
      // ESPERADO de una cadena de rollbacks — cada down devuelve la base al estado de SU momento.
      "rechazo_tienda",
      // Feature 266 (2026-08-23): idem con `habilitacion_api`, la habilitacion pedida por el
      // integrador desde el canal por API key. La foto historica de ESTA migracion sigue intacta.
      "habilitacion_api",
      // Feature 276 (2026-08-24): idem con `rechazo_tope_intentos`, el rechazo por
      // agotamiento de intentos al aprobar el cierre. La foto historica de ESTE `down.sql`
      // sigue SIN TOCARSE; lo que crece es el conjunto que se le descuenta al SEED vigente.
      "rechazo_tope_intentos",
    ]);
    expect(new Set(valores)).toEqual(
      new Set(
        ORDEN_HISTORIAL_ORIGEN_TIPO_SEED.filter((v) => !AÑADIDOS_EN_O_DESPUES_DEL_235.has(v)),
      ),
    );
  });

  it("R42 — el DOWN migra la columna con USING y suelta el tipo viejo", () => {
    expect(enumDown).toMatch(
      /ALTER TABLE "orden_historial_estado"\s+ALTER COLUMN "origen_tipo" TYPE "orden_historial_origen_tipo"\s+USING \("origen_tipo"::text::"orden_historial_origen_tipo"\);/,
    );
    expect(enumDown).toMatch(/DROP TYPE "orden_historial_origen_tipo_old";/);
  });

  it("el DOWN FALLA RUIDOSAMENTE si quedan filas con las familias nuevas, y lo dice", () => {
    // Es el comportamiento CORRECTO y por eso se afirma: el `USING` no puede castear un valor que
    // el tipo recreado no tiene, asi que el rollback aborta. Borrar el rastro de que un mensajero
    // pidio auxilio en la calle no es seguro; primero se borran o reasignan esas filas, a mano.
    expect(enumDown).toMatch(/Precondicion/i);
    expect(enumDown).toContain(IDA);
    expect(enumDown).toContain(VUELTA);
    expect(enumDown).toMatch(/RUIDOSAMENTE/i);
    expect(enumDown).toMatch(/ROLLBACK ENCADENADO/i);
  });

  it("el DOWN NO tiene que rehacer indices a mano: ninguno es PARCIAL sobre `origen_tipo`", () => {
    // ⭑ RE-VERIFICADO, no citado de la 239 (T1.2 lo pide con esas palabras). `ALTER COLUMN ... TYPE`
    // reconstruye por si solo los indices que dependen de la columna, PERO solo si puede reparsear
    // su expresion. El caso problematico seria un indice PARCIAL cuyo `WHERE` comparase
    // `origen_tipo` con un literal del tipo viejo. Se censa el arbol de migraciones para demostrar
    // que no existe.
    const indices = fs
      .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .flatMap((e) => {
        const file = path.join(MIGRATIONS_DIR, e.name, "migration.sql");
        if (!fs.existsSync(file)) return [];
        return fs
          .readFileSync(file, "utf8")
          .split(/;\s*\n/)
          .filter((stmt) => /CREATE\s+(UNIQUE\s+)?INDEX/i.test(stmt))
          .filter((stmt) => /"orden_historial_estado"/.test(stmt));
      });
    expect(indices.length).toBeGreaterThan(0); // el censo mira algo de verdad
    for (const stmt of indices) {
      expect(stmt).not.toMatch(/\bWHERE\b/i); // ninguno es parcial
    }
  });

  it("y la UNICA columna del arbol que usa este enum sigue siendo `orden_historial_estado.origen_tipo`", () => {
    // La otra mitad de la re-verificacion: si otra tabla adoptara el enum, el `ALTER COLUMN` del
    // down solo migraria una de las dos y la otra quedaria apuntando al tipo `_old` que se dropea.
    const columnas = fs
      .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .flatMap((e) => {
        const file = path.join(MIGRATIONS_DIR, e.name, "migration.sql");
        if (!fs.existsSync(file)) return [];
        return fs
          .readFileSync(file, "utf8")
          .split("\n")
          .filter((l) => /"orden_historial_origen_tipo"\s+NOT NULL|"orden_historial_origen_tipo",?$/.test(l))
          .map((l) => `${e.name}: ${l.trim()}`);
      });
    // Exactamente una declaracion de columna, la de `20260713120000_orden_historial_estado`.
    expect(columnas).toHaveLength(1);
    expect(columnas[0]).toContain('"origen_tipo"');
  });

  it("el DOWN tampoco toca policies RLS", () => {
    expect(enumDown).not.toMatch(/CREATE POLICY/i);
    expect(enumDown).not.toMatch(/ROW LEVEL SECURITY/i);
  });
});

/* -------------------------------------------------------------------------- */
/* 3. El retiro de la columna `orden.ayuda`                                     */
/* -------------------------------------------------------------------------- */

describe("Feature 235 · retiro de `orden.ayuda` (T6.1, R40/R42)", () => {
  it("el UP hace el DROP COLUMN, y solo eso", () => {
    expect(quitarComentariosSql(retiroUp)).toMatch(/ALTER TABLE "orden" DROP COLUMN "ayuda";/);
  });

  it("R42 — el DOWN la repone con el MISMO tipo, nulabilidad y default, e idempotente", () => {
    expect(retiroDown).toMatch(
      /ALTER TABLE "orden" ADD COLUMN IF NOT EXISTS "ayuda" boolean NOT NULL DEFAULT false;/,
    );
    // La PERDIDA DE DATO se declara en el propio archivo: repone la columna, no sus valores.
    expect(retiroDown).toMatch(/PERDIDA DE DATO DECLARADA/i);
  });

  it("NO se retira `intentos_contacto`: es historial de la tienda, no estado de la solicitud", () => {
    const sql = quitarComentariosSql(retiroUp);
    expect(sql).not.toMatch(/DROP COLUMN "intentos_contacto"/);
    expect(schemaPrisma).toMatch(/intentos_contacto/);
  });
});

/* -------------------------------------------------------------------------- */
/* 4. R41 — NINGUNA de las tres mueve estado desde SQL                          */
/* -------------------------------------------------------------------------- */

describe("Feature 235 · R41 — ninguna migracion mueve una orden entre estados", () => {
  it.each(TODAS)("`$nombre`: ni el up ni el down escriben `estatus_id`", ({ up, down }) => {
    // Se mira el SQL SIN COMENTARIOS: los tres EXPLICAN por que no lo hacen, y censar la
    // explicacion obligaria a borrarla para pasar el test.
    for (const sql of [quitarComentariosSql(up), quitarComentariosSql(down)]) {
      expect(sql).not.toMatch(/UPDATE\s+"orden"\b/i);
      expect(sql).not.toMatch(/SET\s+"?estatus_id"?/i);
      expect(sql).not.toMatch(/INSERT INTO "orden_historial_estado"/i);
    }
  });

  it("las tres existen con su par up/down (R42): ninguna se queda sin reversion", () => {
    for (const { nombre, up, down } of TODAS) {
      expect(up.trim().length, `${nombre}: el up esta vacio`).toBeGreaterThan(0);
      expect(down.trim().length, `${nombre}: falta el down`).toBeGreaterThan(0);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* 5. Sin drift entre el codigo y las migraciones                               */
/* -------------------------------------------------------------------------- */

describe("Feature 235 · el codigo y la base dicen lo mismo (sin drift)", () => {
  it("el enum Prisma tiene las dos familias y el SEED de TS tambien", () => {
    for (const familia of [IDA, VUELTA]) {
      expect(schemaPrisma).toMatch(
        new RegExp(`enum OrdenHistorialOrigenTipo[\\s\\S]*?${familia}`),
      );
      expect([...ORDEN_HISTORIAL_ORIGEN_TIPO_SEED]).toContain(familia);
    }
  });

  it("`ORDER_STATUS_SEED` incluye el estatus, y como APENDICE (no reordena)", () => {
    expect(ORDER_STATUS_SEED as readonly string[]).toContain(ESTATUS);
    expect(ORDER_STATUS_SEED[ORDER_STATUS_SEED.length - 1]).toBe(ESTATUS);
  });

  it("el schema de Prisma YA NO declara la columna `ayuda`", () => {
    expect(schemaPrisma).not.toMatch(/^\s*ayuda\s+Boolean/m);
  });

  // R11 — EL CASO QUE PROTEGE EL DINERO. Si alguna de las dos familias entrara en la lista de
  // visita real, cada solicitud de ayuda sumaria un intento de entrega de mas: el cron SLA (99)
  // alcanzaria antes el umbral, escalaria antes a `rechazada` y dispararia el `cobroRechazado`
  // (56) — dinero real cobrado a la tienda antes de tiempo, en silencio, y castigando justamente a
  // la orden sobre la que se pidio auxilio.
  it("R11: NINGUNA de las dos esta en `ORIGEN_TIPOS_VISITA_REAL`", () => {
    expect([...ORIGEN_TIPOS_VISITA_REAL]).not.toContain(IDA);
    expect([...ORIGEN_TIPOS_VISITA_REAL]).not.toContain(VUELTA);
    // ⚠️ 2026-08-20 (feature 237, T2.1/R6): el censo pasa de UNO a DOS miembros, a mano. La
    // TERCERA familia del viaje (`gestion_tienda_ayuda`, la gestion que registra la tienda) SI es
    // visita real —es el desenlace de la visita que el mensajero si hizo—, y esa asimetria con
    // las dos de esta migracion es deliberada: pedir auxilio y retirarlo no son intentos.
    expect([...ORIGEN_TIPOS_VISITA_REAL]).toEqual(["gestion", "gestion_tienda_ayuda"]);
  });

  // R43 — NADIE SE QUEDA ATRAPADO AL DESPLEGAR. La medicion de P6 (0 ordenes con la bandera
  // encendida en produccion, 2026-08-19) hace que el conjunto en vuelo sea VACIO y por eso NO hay
  // script de datos. Pero la medicion CADUCA, asi que lo que se afirma aqui es la propiedad
  // ESTRUCTURAL, que no caduca: una orden que acabe en el estatus de ayuda —por el despliegue o
  // por el uso normal— (i) LA VE su tienda y (ii) TIENE salida.
  it("235/R43: una orden en el estatus de ayuda ni queda invisible ni queda sin salida", () => {
    // (i) visible: es una de las dos ramas del predicado de `/novedades` (se fija por texto en
    // `orden-repository.novedades.test.ts`; aqui se afirma que el value existe para poder serlo).
    expect(ORDER_STATUS_SEED as readonly string[]).toContain(ESTATUS);
    // (ii) con salida, y todas con productor. Sin ninguna seria un pozo y R43 caeria.
    // ⏳ 2026-08-20 (feature 237): eran DOS (`en_reparto`, `sin_gestionar`) y ahora son CUATRO. Las
    // dos altas son los desenlaces que la tienda puede registrar desde la pestaña de ayuda, y
    // llegan con su productor (`crearGestionDesdeAyuda`). Lo que R43 exige —que la orden no quede
    // atrapada— se cumple con mas holgura, no con menos.
    const salidas = TRANSICIONES.ayuda_tienda.map((d) => d.to).sort();
    expect(salidas).toEqual(["en_reparto", "rechazada", "reprogramada", "sin_gestionar"]);
  });

  it("ninguna de las dos esta en `ORIGEN_TIPOS_CON_GESTION`", () => {
    // Esa lista solo desambigua la NULIDAD del enlace `gestion_orden_id`. Las filas de estas dos
    // familias nacen SIN gestion: no vienen de ninguna.
    expect([...ORIGEN_TIPOS_CON_GESTION]).not.toContain(IDA);
    expect([...ORIGEN_TIPOS_CON_GESTION]).not.toContain(VUELTA);
    expect([...ORIGEN_TIPOS_CON_GESTION]).toEqual(["gestion", "deshacer_gestion"]);
  });
});
