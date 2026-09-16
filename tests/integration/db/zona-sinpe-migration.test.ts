import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

import { CASOS_SINPE } from "@/tests/fixtures/sinpe-casos";
import { sinpeNumeroONull } from "@/lib/utils/sinpe-cr";
import { HAY_BASE_DE_DATOS, crearPrismaDeTest } from "./_postgres-real";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// ⭑ FICHA 429 / T4 — las tres columnas de `zona`, su nulabilidad y sus dos `CHECK`.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// Cubre R1, R4, R6, R7, R8 y R10 contra POSTGRES REAL. No hay forma de medir esto con un doble:
// lo que se prueba es que la BASE rechaza, y un doble de Prisma acepta todo lo que se le da.
//
// ⚠️ LA MISMA TABLA DE CASOS (`tests/fixtures/sinpe-casos.ts`) se corre contra el validador de la
// aplicacion en `tests/unit/utils/sinpe-cr.test.ts`. Ese es el precio declarado de tener la regla
// en dos sitios —el `CHECK` y `lib/utils/sinpe-cr.ts`— y esta es la unica forma de cobrarlo: si
// alguien relaja uno de los dos, los veredictos dejan de coincidir y este archivo lo dice.
//
// ⚠️ TODAS LAS ESCRITURAS VAN EN UN ESQUEMA DESECHABLE, no en `public`. `zona` es una tabla
// pequeña, viva y referenciada por FK desde media base; insertar y borrar filas ahi —aunque sea
// dentro de una transaccion revertida— compite con los otros archivos de esta carpeta por locks de
// DDL. Aqui se clona la tabla con el DDL REAL de las migraciones y se suelta al terminar.

const ROOT = process.cwd();
const MIGRACIONES = path.join(ROOT, "db", "migrations");
const DIR_COLUMNAS = "20260918120100_zona_sinpe";
const DIR_RESTRICCIONES = "20260918120200_zona_sinpe_no_nulo";

const upColumnas = fs.readFileSync(path.join(MIGRACIONES, DIR_COLUMNAS, "migration.sql"), "utf8");
const downColumnas = fs.readFileSync(path.join(MIGRACIONES, DIR_COLUMNAS, "down.sql"), "utf8");
const upRestricciones = fs.readFileSync(
  path.join(MIGRACIONES, DIR_RESTRICCIONES, "migration.sql"),
  "utf8",
);
const downRestricciones = fs.readFileSync(
  path.join(MIGRACIONES, DIR_RESTRICCIONES, "down.sql"),
  "utf8",
);

/** Valores FICTICIOS. El repositorio es publico: aqui no se escribe ningun SINPE real. */
const SEMILLA_NUMERO = "80000000";
const SEMILLA_NOMBRE = "Titular de Prueba";

function soloEjecutable(sql: string): string {
  return sql
    .split("\n")
    .filter((linea) => !/^\s*--/.test(linea))
    .join("\n");
}

/**
 * Parte el SQL en sentencias RESPETANDO los bloques `DO $$ … $$`. Un `split(";")` a secas parte el
 * `RAISE EXCEPTION` del `up` de las restricciones por la mitad y lo que se mediria seria otra cosa.
 */
function sentencias(sql: string): string[] {
  const texto = soloEjecutable(sql);
  const salida: string[] = [];
  let actual = "";
  let enDolar = false;
  for (let i = 0; i < texto.length; i += 1) {
    if (texto.startsWith("$$", i)) {
      enDolar = !enDolar;
      actual += "$$";
      i += 1;
      continue;
    }
    if (texto[i] === ";" && !enDolar) {
      if (actual.trim()) salida.push(actual.trim());
      actual = "";
      continue;
    }
    actual += texto[i];
  }
  if (actual.trim()) salida.push(actual.trim());
  return salida;
}

function cualificar(sql: string, esquema: string): string {
  return sql.replaceAll('"zona"', `"${esquema}"."zona"`);
}

async function aplicar(admin: PrismaClient, sql: string, esquema: string): Promise<void> {
  for (const stmt of sentencias(cualificar(sql, esquema))) {
    await admin.$executeRawUnsafe(stmt);
  }
}

/** La tabla `zona` como estaba ANTES de esta ficha, con lo que el DDL necesita para existir. */
async function crearZonaPrevia(admin: PrismaClient, esquema: string): Promise<void> {
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${esquema}"`);
  await admin.$executeRawUnsafe(
    `CREATE TABLE "${esquema}"."zona" (
       "id" TEXT PRIMARY KEY,
       "nombre" TEXT NOT NULL UNIQUE,
       "cobro_vehiculo" BOOLEAN NOT NULL DEFAULT false,
       "es_central" BOOLEAN NOT NULL DEFAULT false)`,
  );
}

interface ColumnaInfo {
  column_name: string;
  is_nullable: "YES" | "NO";
  data_type: string;
  character_maximum_length: number | null;
  column_default: string | null;
}

async function columnasDeZona(admin: PrismaClient, esquema: string): Promise<ColumnaInfo[]> {
  return admin.$queryRawUnsafe<ColumnaInfo[]>(
    `SELECT column_name, is_nullable, data_type, character_maximum_length, column_default
       FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = 'zona'
        AND column_name LIKE 'sinpe%'
      ORDER BY column_name`,
    esquema,
  );
}

// ---------------------------------------------------------------------------------------------
// Estatico: corre SIEMPRE, tambien sin base.
// ---------------------------------------------------------------------------------------------

describe("429/T4 — las dos migraciones: forma en disco", () => {
  it("las dos traen migration.sql y down.sql", () => {
    for (const dir of [DIR_COLUMNAS, DIR_RESTRICCIONES]) {
      expect(fs.existsSync(path.join(MIGRACIONES, dir, "migration.sql")), dir).toBe(true);
      expect(fs.existsSync(path.join(MIGRACIONES, dir, "down.sql")), dir).toBe(true);
    }
  });

  it("⭑ la migracion de las columnas NO escribe NINGUN valor: la siembra no vive en el repo", () => {
    // ⚠️ ES EL CASO QUE DEFIENDE LA DECISION DEL LEADER. El `design.md` proponia un `UPDATE` con el
    // numero y el titular como literales; el repositorio es PUBLICO y eso los publica para siempre.
    // Si alguien «completa» la migracion con la siembra, esto se pone rojo.
    const ejecutable = soloEjecutable(upColumnas);
    expect(ejecutable).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
    // Y ningun literal de ocho digitos, que es la forma que tendria un SINPE escrito a mano.
    expect(ejecutable).not.toMatch(/'[0-9]{8}'/);
  });

  it("⭑ la migracion de las columnas NO pone `DEFAULT` en ninguna de las tres", () => {
    // Un `DEFAULT` dejaria viva PARA SIEMPRE la posibilidad de crear una bodega sin SINPE, que
    // produciria en silencio el numero de otra. Es lo que R6 y R11 cierran.
    expect(soloEjecutable(upColumnas)).not.toMatch(/DEFAULT/i);
  });

  it("⭑ la migracion de las restricciones ABORTA con un mensaje accionable si falta la siembra", () => {
    // El fallo correcto no es un `SET NOT NULL` que muere con «contains null values» —cierto pero
    // mudo sobre la salida—, sino uno que nombra el script que hay que correr.
    const ejecutable = soloEjecutable(upRestricciones);
    expect(ejecutable).toMatch(/RAISE EXCEPTION/);
    expect(ejecutable).toContain("scripts/seed-sinpe-inicial.ts");
  });

  it("el `CHECK` del numero es el formato de R7, no un «no vacio»", () => {
    expect(soloEjecutable(upRestricciones)).toContain("^[678][0-9]{7}$");
  });

  it("el `down` de las restricciones quita los dos CHECK y devuelve la nulabilidad", () => {
    const ejecutable = soloEjecutable(downRestricciones);
    expect(ejecutable).toMatch(/DROP CONSTRAINT IF EXISTS "zona_sinpe_numero_check"/);
    expect(ejecutable).toMatch(/DROP CONSTRAINT IF EXISTS "zona_sinpe_nombre_check"/);
    expect(ejecutable).toMatch(/ALTER COLUMN "sinpe_numero" DROP NOT NULL/);
  });

  it("el `down` de las columnas las quita las TRES y no toca nada mas de `zona`", () => {
    const ejecutable = soloEjecutable(downColumnas);
    for (const col of ["sinpe_numero", "sinpe_nombre", "sinpe_revisado_at"]) {
      expect(ejecutable, col).toContain(`DROP COLUMN IF EXISTS "${col}"`);
    }
    // ⚠️ `"nombre"` CON sus comillas: sin ellas, `sinpe_nombre"` casaria y el caso pasaria
    // por el motivo equivocado.
    expect(ejecutable).not.toMatch(/"nombre"|es_central|cobro_vehiculo/);
  });
});

// ---------------------------------------------------------------------------------------------
// Contra Postgres real.
// ---------------------------------------------------------------------------------------------

describe.skipIf(!HAY_BASE_DE_DATOS)("429/T4 — el DDL contra Postgres real", () => {
  const esquema = `t_429_zona_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let admin: PrismaClient;
  let columnasTrasColumnas: ColumnaInfo[] = [];
  let columnasTrasRestricciones: ColumnaInfo[] = [];

  beforeAll(async () => {
    admin = crearPrismaDeTest();
    await crearZonaPrevia(admin, esquema);

    // PASO 1 — las columnas, nullables.
    await aplicar(admin, upColumnas, esquema);
    columnasTrasColumnas = await columnasDeZona(admin, esquema);

    // Ocho bodegas, como en produccion, TODAS sin SINPE todavia.
    for (let i = 0; i < 8; i += 1) {
      await admin.$executeRawUnsafe(
        `INSERT INTO "${esquema}"."zona" ("id","nombre","es_central")
         VALUES ($1, $2, $3)`,
        `z-${i}`,
        `Bodega ${i}`,
        i === 0,
      );
    }
  }, 120_000);

  afterAll(async () => {
    await admin?.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${esquema}" CASCADE`);
    await admin?.$disconnect();
  });

  it("R1/R4 — las tres columnas existen, con su tipo y su ancho", () => {
    const porNombre = new Map(columnasTrasColumnas.map((c) => [c.column_name, c]));
    expect([...porNombre.keys()].sort()).toEqual([
      "sinpe_nombre",
      "sinpe_numero",
      "sinpe_revisado_at",
    ]);
    expect(porNombre.get("sinpe_numero")?.character_maximum_length).toBe(8);
    expect(porNombre.get("sinpe_nombre")?.character_maximum_length).toBe(60);
    expect(porNombre.get("sinpe_revisado_at")?.data_type).toMatch(/timestamp/);
  });

  it("⭑ NINGUNA de las tres tiene `DEFAULT` en la base (no solo en el archivo)", () => {
    for (const c of columnasTrasColumnas) {
      expect(c.column_default, `${c.column_name} tiene default`).toBeNull();
    }
  });

  it("⭑ el paso 3 ABORTA mientras haya bodegas sin sembrar, y no deja nada a medias", async () => {
    // Es el orden de despliegue hecho medida: sin la siembra, el `NOT NULL` no se puede poner.
    await expect(aplicar(admin, upRestricciones, esquema)).rejects.toThrow(/FICHA 429/);
    // Y las columnas siguen NULLABLES: el `DO` aborta ANTES de tocar nada.
    const ahora = await columnasDeZona(admin, esquema);
    expect(ahora.every((c) => c.is_nullable === "YES")).toBe(true);
  });

  it("R10 — tras la siembra, CERO bodegas con otro numero y CERO revisadas", async () => {
    // La siembra la hace `scripts/seed-sinpe-inicial.ts` con el MISMO `WHERE` de los NULL; aqui se
    // reproduce esa sentencia contra el clon. Lo que se afirma es su RESULTADO.
    await admin.$executeRawUnsafe(
      `UPDATE "${esquema}"."zona" SET "sinpe_numero" = $1, "sinpe_nombre" = $2
        WHERE "sinpe_numero" IS NULL OR "sinpe_nombre" IS NULL`,
      SEMILLA_NUMERO,
      SEMILLA_NOMBRE,
    );
    const [fila] = await admin.$queryRawUnsafe<
      { total: number; distintas: number; revisadas: number }[]
    >(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE "sinpe_numero" <> $1)::int AS distintas,
              COUNT(*) FILTER (WHERE "sinpe_revisado_at" IS NOT NULL)::int AS revisadas
         FROM "${esquema}"."zona"`,
      SEMILLA_NUMERO,
    );
    expect(fila.total).toBe(8); // anti-vacuidad: si no hubiera filas, los ceros no dirian nada
    expect(fila.distintas).toBe(0);
    // R5/R10: la marca de revision se queda VACIA a proposito. Nadie lo ha mirado.
    expect(fila.revisadas).toBe(0);
  });

  it("el paso 3 ya se aplica, una vez lleno", async () => {
    await aplicar(admin, upRestricciones, esquema);
    columnasTrasRestricciones = await columnasDeZona(admin, esquema);
    const porNombre = new Map(columnasTrasRestricciones.map((c) => [c.column_name, c]));
    expect(porNombre.get("sinpe_numero")?.is_nullable).toBe("NO");
    expect(porNombre.get("sinpe_nombre")?.is_nullable).toBe("NO");
    // R5: la marca de revision SIGUE siendo nullable, y eso no es un olvido.
    expect(porNombre.get("sinpe_revisado_at")?.is_nullable).toBe("YES");
    // Y sin default, tampoco despues.
    for (const c of columnasTrasRestricciones) expect(c.column_default).toBeNull();
  });

  it("R6 — un INSERT sin SINPE lo rechaza POSTGRES, no el formulario", async () => {
    await expect(
      admin.$executeRawUnsafe(
        `INSERT INTO "${esquema}"."zona" ("id","nombre") VALUES ('z-sin','Sin SINPE')`,
      ),
    ).rejects.toThrow();
    // Y un UPDATE que lo deje en NULL, tambien.
    await expect(
      admin.$executeRawUnsafe(`UPDATE "${esquema}"."zona" SET "sinpe_numero" = NULL`),
    ).rejects.toThrow();
    await expect(
      admin.$executeRawUnsafe(`UPDATE "${esquema}"."zona" SET "sinpe_nombre" = NULL`),
    ).rejects.toThrow();
  });

  it("⭑ R8 — un titular vacio, o espacio en blanco de CUALQUIER clase, lo rechaza la base", async () => {
    // ⚠️ EL TABULADOR ES EL CASO QUE IMPORTA, y cazo un defecto REAL: con el `btrim(...) <> ''` que
    // proponia el `design.md`, un titular de un unico TAB pasaba el `CHECK` —`btrim` sin segundo
    // argumento recorta SOLO el espacio 0x20— mientras `sinpeNombreSchema` lo rechazaba. Dos
    // fuentes del mismo formato, dos veredictos: exactamente el precio que esta suite cobra.
    for (const malo of ["", "   ", "\t", "\n", " \t \n "]) {
      await expect(
        admin.$executeRawUnsafe(
          `UPDATE "${esquema}"."zona" SET "sinpe_nombre" = $1 WHERE "id" = 'z-1'`,
          malo,
        ),
        JSON.stringify(malo),
      ).rejects.toThrow();
    }
  });

  it.each(CASOS_SINPE.map((c) => [c.entrada, c.normalizado !== null, c.motivo] as const))(
    "⭑ R7 — la base y el validador dan el MISMO veredicto sobre %j (aceptado=%s)",
    async (entrada, aceptable) => {
      // ⚠️ EL CASO QUE CIERRA LA DIVERGENCIA. El `CHECK` juzga lo que se le da TAL CUAL (la base no
      // normaliza: normalizar es del borde, R9), asi que se compara contra el predicado aplicado a
      // la MISMA entrada cruda.
      const esperadoPorLaApp = sinpeNumeroONull(entrada) === entrada;
      const intento = admin.$executeRawUnsafe(
        `UPDATE "${esquema}"."zona" SET "sinpe_numero" = $1 WHERE "id" = 'z-2'`,
        entrada,
      );
      if (esperadoPorLaApp) {
        await expect(intento, `${entrada}: la app lo acepta y la base no`).resolves.toBeDefined();
      } else {
        await expect(intento, `${entrada}: la app lo rechaza y la base no`).rejects.toThrow();
      }
      // Y la tabla de casos no se contradice a si misma: un valor «aceptable» que el validador
      // rechace tal cual solo puede ser un caso de NORMALIZACION.
      if (aceptable && !esperadoPorLaApp) {
        expect(sinpeNumeroONull(entrada), `${entrada}`).not.toBeNull();
      }
    },
  );

  it("⭑ el `down` revierte las restricciones y luego las columnas, y `zona` queda como estaba", async () => {
    await aplicar(admin, downRestricciones, esquema);
    const trasDown = await columnasDeZona(admin, esquema);
    expect(trasDown.every((c) => c.is_nullable === "YES")).toBe(true);

    await aplicar(admin, downColumnas, esquema);
    expect(await columnasDeZona(admin, esquema)).toHaveLength(0);
    // Las columnas de siempre siguen ahi: el `down` no se lleva por delante la tabla.
    const [fila] = await admin.$queryRawUnsafe<{ n: number }[]>(
      `SELECT COUNT(*)::int AS n FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = 'zona'`,
      esquema,
    );
    expect(fila.n).toBe(4);
  });
});
