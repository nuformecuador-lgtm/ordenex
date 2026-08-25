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

// Feature 237 (T1.1, R5/R47) — cobertura ESTATICA de la UNICA migracion de esta ficha, por
// lectura de `migration.sql` / `down.sql`. Molde literal:
// `tests/integration/db/ayuda-tienda-migration.test.ts` (235). NO requiere Postgres real (no hay
// DB en el entorno de test de este repo; `tests/integration/db` son emuladores y lecturas de
// fichero). El round-trip REAL contra `localhost:5432` —`prisma migrate deploy` -> `db:rollback`
// -> `deploy`— se corrio a mano y su salida esta pegada en `progress/impl_237.md`.
//
// Lo que se afirma aqui, y por que cada cosa:
//   - es IDEMPOTENTE (`ADD VALUE IF NOT EXISTS`): aplicarla dos veces no duplica;
//   - va SOLA, sin ningun uso del valor en la misma transaccion que lo anade (Postgres 55P04);
//   - tiene DOWN, y el down RECREA el tipo con los 29 valores previos (Postgres no tiene
//     `DROP VALUE`), dejando la base LEGIBLE por el codigo anterior (R47);
//   - el DOWN falla RUIDOSAMENTE si quedan filas con la familia nueva, y eso es CORRECTO: esas
//     filas son la unica evidencia de que decidio LA TIENDA y no el mensajero;
//   - la familia SI entra en `ORIGEN_TIPOS_VISITA_REAL` (R6) — al reves que las dos de la 235 — y
//     NO entra en `ORIGEN_TIPOS_CON_GESTION` (R43).

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

const enumDirName = path.basename(migrationDirFor("_orden_historial_origen_gestion_tienda_ayuda"));
const enumDir = migrationDirFor("_orden_historial_origen_gestion_tienda_ayuda");
const enumUp = fs.readFileSync(path.join(enumDir, "migration.sql"), "utf8");
const enumDown = fs.readFileSync(path.join(enumDir, "down.sql"), "utf8");

const schemaPrisma = fs.readFileSync(
  path.join(__dirname, "..", "..", "..", "db", "schema.prisma"),
  "utf8",
);

const FAMILIA = "gestion_tienda_ayuda";
/** Las dos familias de la 235, que esta migracion NO toca y que son su contraste (design §7.3). */
const IDA = "solicitud_ayuda_tienda";
const VUELTA = "rescate_ayuda_tienda";

/* -------------------------------------------------------------------------- */
/* 1. El UP                                                                     */
/* -------------------------------------------------------------------------- */

describe("Feature 237 · enum — la familia `gestion_tienda_ayuda` (T1.1, R5)", () => {
  it("el UP anade el valor con `IF NOT EXISTS` (aplicarlo dos veces no duplica)", () => {
    expect(enumUp).toMatch(
      new RegExp(`ALTER TYPE "orden_historial_origen_tipo" ADD VALUE IF NOT EXISTS '${FAMILIA}';`),
    );
  });

  it("la carpeta va DESPUES de la ultima migracion aplicada (timestamp posterior)", () => {
    // Un timestamp anterior al ultimo aplicado deja la migracion fuera del orden de `deploy` en
    // cualquier base que ya estuviera al dia: se marcaria como pendiente y se aplicaria «en el
    // pasado». Se comprueba contra el arbol real, no contra un numero copiado.
    //
    // ⏳ 2026-08-20 (feature 240) — ESTE CASO AFIRMABA `todas[todas.length - 1] === enumDirName`,
    // es decir «esta es la ULTIMA carpeta del arbol». Era cierto mientras la 237 fue la migracion
    // mas reciente, y dejo de serlo en cuanto la 240 anadio la suya. Pero «ser la ultima para
    // siempre» NUNCA fue el requisito —lo habria roto la siguiente ficha, fuera cual fuera—: el
    // requisito es que su timestamp sea POSTERIOR al de todas las que ya existian cuando se
    // escribio. Eso es lo que se afirma ahora, contra el arbol y sin numeros copiados.
    //
    // Es la correccion de una asercion demasiado fuerte, no un aflojamiento: sigue poniendose roja
    // ante el fallo real que vigilaba —una carpeta con timestamp «en el pasado»—.
    const todas = fs
      .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    const anteriores = todas.slice(0, todas.indexOf(enumDirName));
    expect(anteriores.length).toBeGreaterThan(0); // el censo mira algo de verdad
    // La ULTIMA que existia antes de esta, medida en el arbol: la 238 (confirmacion fisica).
    expect(anteriores[anteriores.length - 1]).toBe(
      "20260819170000_gestion_orden_confirmacion_fisica",
    );
    for (const previa of anteriores) expect(previa < enumDirName).toBe(true);
  });

  it("el UP es ADITIVO: ni tablas, ni columnas, ni RLS, ni movimientos de orden (R47)", () => {
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
    // ocurre en runtime, en `GestionOrdenRepository.crearGestionDesdeAyuda`.
    const sql = quitarComentariosSql(enumUp);
    expect(sql).not.toMatch(new RegExp(`'${FAMILIA}'::orden_historial_origen_tipo`));
    expect(sql.match(/ALTER TYPE/g) ?? []).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
/* 2. El DOWN                                                                   */
/* -------------------------------------------------------------------------- */

describe("Feature 237 · el DOWN deja la base legible por el codigo anterior (R47)", () => {
  it("recrea el tipo con los 29 valores previos, SIN la familia nueva", () => {
    expect(enumDown).toMatch(
      /ALTER TYPE "orden_historial_origen_tipo" RENAME TO "orden_historial_origen_tipo_old";/,
    );
    const match = enumDown.match(
      /CREATE TYPE "orden_historial_origen_tipo" AS ENUM \(([\s\S]*?)\);/,
    );
    expect(match).not.toBeNull();
    const valores = [...(match as RegExpMatchArray)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(valores).toHaveLength(29);
    expect(valores).not.toContain(FAMILIA);
    // Las dos de la 235 SI estan: este down revierte SOLO lo que su up anadio.
    expect(valores).toContain(IDA);
    expect(valores).toContain(VUELTA);
    // La lista del down es EXACTAMENTE el SEED de hoy menos el valor que esta migracion anade y
    // menos los que anadieron las migraciones POSTERIORES a ella.
    //
    // ⏳ 2026-08-20 (feature 240) — EL DIA LLEGO, y llego el mismo dia. Este caso decia: «mientras
    // esta sea la ULTIMA migracion del enum, la igualdad es la asercion correcta; el dia que otra
    // ficha anada un valor mas, este caso se pone rojo y lo que hay que hacer NO es editar este
    // `down.sql` —seria una foto historica— sino nombrar el valor nuevo aqui». Eso es exactamente
    // lo que se hace: `rechazo_tienda` (240) entra en la lista de POSTERIORES y el `down.sql` de
    // la 237 no se toca ni una linea.
    // ⏳ 2026-08-23 (feature 266) y 2026-08-24 (feature 276) — segunda y tercera vez que pasa
    // lo mismo, y se resuelve igual: los valores nuevos entran en POSTERIORES y el `down.sql`
    // de la 237 sigue sin tocarse. Lo que crece es el conjunto que se descuenta del SEED vigente.
    const POSTERIORES = ["rechazo_tienda", "habilitacion_api", "rechazo_tope_intentos"]; // 240 (2026-08-20) · 266 (2026-08-23) · 276 (2026-08-24)
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

  it("FALLA RUIDOSAMENTE si quedan filas con la familia nueva, y lo dice", () => {
    // Es el comportamiento CORRECTO y por eso se afirma: el `USING` no puede castear un valor que
    // el tipo recreado no tiene, asi que el rollback aborta. Esas filas son la UNICA evidencia de
    // que el rechazo lo decidio la TIENDA —y se lo cobro a si misma— y no el mensajero.
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
    // ⭑ RE-VERIFICADO el 2026-08-20 sobre el arbol, no citado de la 235. `ALTER COLUMN ... TYPE`
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

describe("Feature 237 · el codigo y la base dicen lo mismo (R5/R6/R43)", () => {
  it("R5: la familia esta en el enum Prisma y en el SEED de TS", () => {
    expect(schemaPrisma).toMatch(new RegExp(`enum OrdenHistorialOrigenTipo[\\s\\S]*?${FAMILIA}`));
    expect([...ORDEN_HISTORIAL_ORIGEN_TIPO_SEED]).toContain(FAMILIA);
  });

  // R6 — EL CASO QUE SOSTIENE LA PROMESA CENTRAL DE LA FICHA. Sin la familia en la lista de
  // visita real, la gestion de la tienda NO contaria como intento de entrega y la ficha
  // incumpliria en silencio lo que promete («suma un intento»). Es la mutacion T8.2.
  it("R6: la familia SI esta en `ORIGEN_TIPOS_VISITA_REAL` — al reves que las dos de la 235", () => {
    expect([...ORIGEN_TIPOS_VISITA_REAL]).toContain(FAMILIA);
    // Y la asimetria con la 235 se afirma en el mismo caso, porque es lo que hace falta entender:
    // pedir auxilio y retirarlo NO son intentos (el mensajero sigue en la calle con el paquete);
    // el DESENLACE de esa visita si lo es, y lo cuenta UNA vez.
    expect([...ORIGEN_TIPOS_VISITA_REAL]).not.toContain(IDA);
    expect([...ORIGEN_TIPOS_VISITA_REAL]).not.toContain(VUELTA);
  });

  it("R43: NO entra en `ORIGEN_TIPOS_CON_GESTION`, aunque su fila SI enlace gestion", () => {
    // Esa lista solo desambigua la NULIDAD del enlace `gestion_orden_id` (67/R25-R26). Nuestras
    // filas nacen CON el enlace poblado, igual que `escalado_devuelta_sla` y `anclaje_devolucion`.
    expect([...ORIGEN_TIPOS_CON_GESTION]).not.toContain(FAMILIA);
    expect([...ORIGEN_TIPOS_CON_GESTION]).toEqual(["gestion", "deshacer_gestion"]);
  });

  it("R1/R45: la familia produce EXACTAMENTE dos aristas, y las dos salen de `ayuda_tienda`", () => {
    // El valor de enum y el grafo tienen que decir lo mismo: si alguien declarara una tercera
    // arista con este `via` (entregar, devolver o reportar incidente desde ayuda), aqui se veria.
    const conEstaVia = Object.entries(TRANSICIONES).flatMap(([origen, destinos]) =>
      destinos.filter((d) => d.via === FAMILIA).map((d) => `${origen} -> ${d.to}`),
    );
    expect(conEstaVia.sort()).toEqual([
      "ayuda_tienda -> rechazada",
      "ayuda_tienda -> reprogramada",
    ]);
  });
});
