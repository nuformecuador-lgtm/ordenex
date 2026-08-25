import fs from "fs";
import path from "path";

import { describe, expect, it } from "vitest";

import {
  ORDEN_HISTORIAL_ORIGEN_TIPO_SEED,
  ORIGEN_TIPOS_CON_GESTION,
  ORIGEN_TIPOS_VISITA_REAL,
} from "@/lib/types/orden-historial";
import { TRANSICIONES } from "@/lib/types/order-status-transiciones";
import { quitarComentariosSql } from "@/tests/fixtures/sin-comentarios";

// Feature 240 (T1.2, D8, R6/R19/R44/R47) — cobertura ESTATICA de la UNICA migracion de esta ficha,
// por lectura de `migration.sql` / `down.sql`. Molde literal:
// `tests/integration/db/gestion-tienda-ayuda-migration.test.ts` (237). NO requiere Postgres real
// (no hay DB en el entorno de test de este repo; `tests/integration/db` son emuladores y lecturas
// de fichero). El round-trip REAL contra la base local —`prisma migrate deploy` -> `db:rollback` ->
// `deploy`— se corre a mano y su salida va en `progress/impl_240.md`.
//
// Lo que se afirma aqui, y por que cada cosa:
//   - es IDEMPOTENTE (`ADD VALUE IF NOT EXISTS`): aplicarla dos veces no duplica;
//   - va SOLA, sin ningun uso del valor en la misma transaccion que lo anade (Postgres 55P04);
//   - tiene DOWN, y el down RECREA el tipo con los 30 valores previos (Postgres no tiene
//     `DROP VALUE`), dejando la base LEGIBLE por el codigo anterior (R47);
//   - el DOWN falla RUIDOSAMENTE si quedan filas con la familia nueva, y eso es CORRECTO: esas
//     filas son la unica evidencia de QUIEN decidio un rechazo que se cobro;
//   - la familia NO entra en `ORIGEN_TIPOS_VISITA_REAL` (R19) — al reves que la de la 237 — ni en
//     `ORIGEN_TIPOS_CON_GESTION`, y produce EXACTAMENTE una arista (R7).

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

const enumDirName = path.basename(migrationDirFor("_orden_historial_origen_rechazo_tienda"));
const enumDir = migrationDirFor("_orden_historial_origen_rechazo_tienda");
const enumUp = fs.readFileSync(path.join(enumDir, "migration.sql"), "utf8");
const enumDown = fs.readFileSync(path.join(enumDir, "down.sql"), "utf8");

const schemaPrisma = fs.readFileSync(
  path.join(__dirname, "..", "..", "..", "db", "schema.prisma"),
  "utf8",
);

const FAMILIA = "rechazo_tienda";
/** La familia del CRON de plazo vencido: mismo par origen->destino, y el contraste de esta ficha. */
const FAMILIA_CRON = "escalado_devuelta_sla";
/** La de la 237, que SI es visita real: la asimetria que hay que poder leer de un vistazo. */
const FAMILIA_237 = "gestion_tienda_ayuda";

/* -------------------------------------------------------------------------- */
/* 1. El UP                                                                     */
/* -------------------------------------------------------------------------- */

describe("Feature 240 · enum — la familia `rechazo_tienda` (T1.1, D8/R6)", () => {
  it("el UP anade el valor con `IF NOT EXISTS` (aplicarlo dos veces no duplica)", () => {
    expect(enumUp).toMatch(
      new RegExp(`ALTER TYPE "orden_historial_origen_tipo" ADD VALUE IF NOT EXISTS '${FAMILIA}';`),
    );
  });

  it("la carpeta va DESPUES de todas las migraciones que ya existian (timestamp posterior)", () => {
    // Un timestamp anterior al ultimo aplicado deja la migracion fuera del orden de `deploy` en
    // cualquier base que ya estuviera al dia: se marcaria como pendiente y se aplicaria «en el
    // pasado». Se comprueba contra el arbol real, no contra un numero copiado.
    //
    // ⚠️ NO se afirma «es la ultima carpeta del arbol», y es deliberado: esa forma es la que la
    // 237 uso y la que se puso roja el mismo dia, cuando esta ficha anadio la suya. Lo que hace
    // falta es que sea posterior a la ULTIMA APLICADA cuando se escribio, que es la de la 237.
    const todas = fs
      .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    const anteriores = todas.slice(0, todas.indexOf(enumDirName));
    expect(anteriores.length).toBeGreaterThan(0); // el censo mira algo de verdad
    expect(anteriores).toContain("20260820120000_orden_historial_origen_gestion_tienda_ayuda");
    for (const previa of anteriores) expect(previa < enumDirName).toBe(true);
  });

  it("el UP es ADITIVO: ni tablas, ni columnas, ni RLS, ni backfill, ni movimientos de orden (R47)", () => {
    const sql = quitarComentariosSql(enumUp);
    expect(sql).not.toMatch(/CREATE TABLE/i);
    expect(sql).not.toMatch(/ALTER COLUMN/i);
    expect(sql).not.toMatch(/DROP COLUMN/i);
    expect(sql).not.toMatch(/CREATE POLICY/i);
    expect(sql).not.toMatch(/ROW LEVEL SECURITY/i);
    expect(sql).not.toMatch(/UPDATE\s+"orden"\b/i);
    expect(sql).not.toMatch(/estatus_id/i);
    expect(sql).not.toMatch(/INSERT INTO "orden_historial_estado"/i);
  });

  it("no USA el valor nuevo en la misma transaccion que lo anade (Postgres 55P04)", () => {
    // Prisma Migrate corre cada `migration.sql` en UNA transaccion y Postgres no deja usar un
    // valor de enum recien anadido dentro de ella. Por eso esta migracion va sola: su primer uso
    // ocurre en runtime, en `GestionOrdenRepository.rechazarDesdeDevuelta`.
    const sql = quitarComentariosSql(enumUp);
    expect(sql).not.toMatch(new RegExp(`'${FAMILIA}'::orden_historial_origen_tipo`));
    expect(sql.match(/ALTER TYPE/g) ?? []).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
/* 2. El DOWN                                                                   */
/* -------------------------------------------------------------------------- */

describe("Feature 240 · el DOWN deja la base legible por el codigo anterior (R47)", () => {
  it("recrea el tipo con los 30 valores previos, SIN la familia nueva", () => {
    expect(enumDown).toMatch(
      /ALTER TYPE "orden_historial_origen_tipo" RENAME TO "orden_historial_origen_tipo_old";/,
    );
    const match = enumDown.match(
      /CREATE TYPE "orden_historial_origen_tipo" AS ENUM \(([\s\S]*?)\);/,
    );
    expect(match).not.toBeNull();
    const valores = [...(match as RegExpMatchArray)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(valores).toHaveLength(30);
    expect(valores).not.toContain(FAMILIA);
    // La de la 237 SI esta: este down revierte SOLO lo que su up anadio, no la cadena entera.
    expect(valores).toContain(FAMILIA_237);
    // La lista del down es EXACTAMENTE el SEED de hoy menos el valor que esta migracion anade.
    // Mientras esta sea la ULTIMA migracion del enum, la igualdad es la asercion correcta; el dia
    // que otra ficha anada un valor mas, este caso se pone rojo y lo que hay que hacer NO es
    // editar este `down.sql` —seria una foto historica— sino nombrar el valor nuevo en una lista
    // de POSTERIORES aqui, como esta ficha hizo con el test de la 237.
    //
    // ⏳ 2026-08-23 (feature 266) — EL DIA LLEGO. Este caso decia arriba: «el dia que otra ficha
    // anada un valor mas, este caso se pone rojo y lo que hay que hacer NO es editar este
    // `down.sql` sino nombrar el valor nuevo en una lista de POSTERIORES aqui». Eso es
    // exactamente lo que se hace: `habilitacion_api` (266) entra en POSTERIORES y la foto
    // historica de la 240 no se toca ni una linea.
    // ⏳ 2026-08-24 (feature 276) — tercera vez, mismo remedio: `rechazo_tope_intentos` se suma
    // a POSTERIORES y el `down.sql` de la 240 sigue intacto.
    const POSTERIORES = ["habilitacion_api", "rechazo_tope_intentos"]; // 266 (2026-08-23) · 276 (2026-08-24)
    expect(new Set(valores)).toEqual(
      new Set(
        (ORDEN_HISTORIAL_ORIGEN_TIPO_SEED as readonly string[]).filter(
          (v) => v !== FAMILIA && !POSTERIORES.includes(v),
        ),
      ),
    );
  });

  it("migra la columna con USING y suelta el tipo viejo", () => {
    expect(enumDown).toMatch(
      /ALTER TABLE "orden_historial_estado"\s+ALTER COLUMN "origen_tipo" TYPE "orden_historial_origen_tipo"\s+USING \("origen_tipo"::text::"orden_historial_origen_tipo"\);/,
    );
    expect(enumDown).toMatch(/DROP TYPE "orden_historial_origen_tipo_old";/);
  });

  it("FALLA RUIDOSAMENTE si quedan filas con la familia nueva, y lo dice (R47)", () => {
    // Es el comportamiento CORRECTO y por eso se afirma: el `USING` no puede castear un valor que
    // el tipo recreado no tiene, asi que el rollback aborta. Esas filas son la UNICA evidencia de
    // QUIEN decidio el rechazo —la persona de la tienda, en `actor_usuario_id`— y lo unico que lo
    // distingue de un vencimiento del cron.
    expect(enumDown).toMatch(/Precondicion/i);
    expect(enumDown).toContain(FAMILIA);
    expect(enumDown).toMatch(/RUIDOSAMENTE/i);
    expect(enumDown).toMatch(/ROLLBACK ENCADENADO/i);
  });

  it("el DOWN no toca policies RLS ni mueve ordenes de estado", () => {
    const sql = quitarComentariosSql(enumDown);
    expect(sql).not.toMatch(/CREATE POLICY/i);
    expect(sql).not.toMatch(/ROW LEVEL SECURITY/i);
    expect(sql).not.toMatch(/UPDATE\s+"orden"\b/i);
    expect(sql).not.toMatch(/INSERT INTO "orden_historial_estado"/i);
  });

  it("no tiene que rehacer indices a mano: ninguno es PARCIAL sobre `origen_tipo`", () => {
    // ⭑ RE-VERIFICADO el 2026-08-20 sobre el arbol, no citado de la 237. `ALTER COLUMN ... TYPE`
    // reconstruye por si solo los indices que dependen de la columna, PERO solo si puede reparsear
    // su expresion. El caso problematico seria un indice PARCIAL cuyo `WHERE` comparase
    // `origen_tipo` con un literal del tipo viejo. Se censa el arbol para demostrar que no existe.
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
      expect(stmt).not.toMatch(/\bWHERE\b/i);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* 3. Sin drift entre el codigo y la base                                       */
/* -------------------------------------------------------------------------- */

describe("Feature 240 · el codigo y la base dicen lo mismo (R6/R7/R19/R44)", () => {
  it("R6: la familia esta en el enum Prisma y en el SEED de TS", () => {
    expect(schemaPrisma).toMatch(new RegExp(`enum OrdenHistorialOrigenTipo[\\s\\S]*?${FAMILIA}`));
    expect([...ORDEN_HISTORIAL_ORIGEN_TIPO_SEED]).toContain(FAMILIA);
  });

  // 💰 R19 — EL CASO QUE PROTEGE EL DINERO. Sin esta ausencia, el rechazo manual sumaria un
  // intento de entrega sobre una orden que YA cuenta su gestion `devuelta` real: el doble conteo
  // de 160/R2. Ese +1 adelanta el umbral del cron del SLA (99) y con el el `cobroRechazado` (56)
  // sobre OTRAS ordenes. Es la mutacion T7.3.
  it("R19: la familia NO esta en `ORIGEN_TIPOS_VISITA_REAL` — al reves que la de la 237", () => {
    expect([...ORIGEN_TIPOS_VISITA_REAL]).not.toContain(FAMILIA);
    // Y la asimetria se afirma en el mismo caso, porque es lo que hace falta entender: la de la
    // 237 se hace sobre una orden en la que el mensajero NO registro ningun desenlace (sin ella
    // esa visita no la cuenta nadie); esta, sobre una que YA tiene su `devuelta` contada.
    expect([...ORIGEN_TIPOS_VISITA_REAL]).toContain(FAMILIA_237);
    // Mismo trato que su hermana de forma, `reprogramacion_tienda` (100).
    expect([...ORIGEN_TIPOS_VISITA_REAL]).not.toContain("reprogramacion_tienda");
  });

  it("R6: NO entra en `ORIGEN_TIPOS_CON_GESTION`, aunque su fila SI enlace gestion", () => {
    // Esa lista solo desambigua la NULIDAD del enlace `gestion_orden_id` (67/R25-R26). Nuestras
    // filas nacen CON el enlace poblado, igual que `escalado_devuelta_sla` y `anclaje_devolucion`.
    expect([...ORIGEN_TIPOS_CON_GESTION]).not.toContain(FAMILIA);
    expect([...ORIGEN_TIPOS_CON_GESTION]).toEqual(["gestion", "deshacer_gestion"]);
  });

  it("R7: la familia produce EXACTAMENTE una arista, y sale de `devuelta`", () => {
    // El valor de enum y el grafo tienen que decir lo mismo: si alguien declarara una segunda
    // arista con este `via` (entregar, devolver otra vez o mandar a bodega desde `devuelta`), aqui
    // se veria. R7 concede UNA salida nueva y ninguna mas.
    const conEstaVia = Object.entries(TRANSICIONES).flatMap(([origen, destinos]) =>
      destinos.filter((d) => d.via === FAMILIA).map((d) => `${origen} -> ${d.to}`),
    );
    expect(conEstaVia).toEqual(["devuelta -> rechazada"]);
  });

  it("R26: comparte par con el cron pero NO su familia — es el tercer duplicado del inventario", () => {
    // Las dos llegan a `rechazada` desde `devuelta` y cobran lo mismo (D1). Lo unico que las
    // distingue es la familia, y de ella cuelgan la pestaña «Rechazadas por plazo vencido» (102) y
    // `esRechazoSla`. Fusionarlas haria que esa pestaña afirmara un plazo que aqui no vencio.
    const aRechazada = TRANSICIONES.devuelta.filter((d) => d.to === "rechazada");
    expect(aRechazada.map((d) => d.via).sort()).toEqual([FAMILIA_CRON, FAMILIA].sort());
  });
});
