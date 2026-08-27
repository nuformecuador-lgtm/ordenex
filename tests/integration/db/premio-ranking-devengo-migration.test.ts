import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import { randomUUID } from "node:crypto";
import { Prisma, RolValue, type PrismaClient } from "@prisma/client";
import {
  PAGO_MENSAJERO_MOVIMIENTO_CATEGORIA_SEED,
  type PagoMensajeroMovimientoCategoria,
  type PagoMensajeroMovimientoTipo,
} from "@/lib/types/wallet-mensajero";
import { WALLET_ORIGEN_TIPO_SEED } from "@/lib/types/wallet";
import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  serializarEscriturasReales,
} from "./_postgres-real";

// Feature 293 (T1.4, design §10) — cobertura de la migracion `*_premio_ranking_devengo`, en DOS
// niveles:
//
//  1) ESTATICA (patron `caja-tesoreria-migration.test.ts`): lee `migration.sql` y `down.sql` por
//     regex. Protege la FORMA de los dos .sql para que un cambio posterior no los desalinee.
//  2) CONTRA POSTGRES DE VERDAD: los DOS CHECK y los DOS unicos parciales, EJERCIDOS. Una regex
//     demuestra que la restriccion esta ESCRITA; solo el motor demuestra que RECHAZA (23514 /
//     23505) y —lo que importa igual— que NO rechaza de mas: las 6 combinaciones legitimas del
//     libro siguen entrando. Sin base alcanzable esa parte se SALTA (no falla en verde).
//
// ⚠️ NO se usa el patron de `ranking-snapshot-migration.test.ts` (ejecutar el `migration.sql`
// dentro de una transaccion en un esquema temporal). Ahi un `ALTER TYPE ... ADD VALUE` seguido
// del USO del valor en la misma transaccion falla SIEMPRE («unsafe use of new value»), asi que ese
// arnes no puede probar esta migracion. Se prueba contra la base YA migrada, como la 173.
//
// El round-trip REAL up -> down -> up contra el Postgres local esta ejecutado y anotado en el
// informe de implementacion.

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

const migrationDir = migrationDirFor("_premio_ranking_devengo");
const upSql = fs.readFileSync(path.join(migrationDir, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(migrationDir, "down.sql"), "utf8");

/** El UP sin comentarios: las aserciones hablan de lo que se EJECUTA, no de lo que se explica. */
const upSqlEjecutable = upSql.replace(/^\s*--.*$/gm, "");
const downSqlEjecutable = downSql.replace(/^\s*--.*$/gm, "");

const NOMBRE_CHECK_TIPO = "pago_mensajero_movimiento_tipo_categoria_check";
const NOMBRE_CHECK_PREMIO_DIA = "pago_mensajero_movimiento_premio_dia_check";
const UQ_PREMIO = "pago_mensajero_movimiento_premio_dia_uq";
const UQ_REVERSO = "pago_mensajero_movimiento_premio_reverso_uq";
const UQ_ORIGEN = "pago_mensajero_movimiento_origen_uq";

/** Las categorias que el SQL lista dentro de la rama `("tipo" = '<tipo>' AND "categoria" IN (…))`. */
function ramaDelCheck(sql: string, tipo: PagoMensajeroMovimientoTipo): string[] {
  const match = sql.match(
    new RegExp(`\\("tipo" = '${tipo}' AND "categoria" IN \\(([\\s\\S]*?)\\)\\)`),
  );
  expect(match, `no hay rama '${tipo}' en el CHECK`).not.toBeNull();
  return [...(match as RegExpMatchArray)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

// ── El vocabulario tipado ───────────────────────────────────────────────────────────────────

describe("T1.5 — los dos SEED tipados ganan su valor y conservan los previos", () => {
  it("`premio_ranking` entra en el catalogo del libro del mensajero, sin perder los 5 previos", () => {
    expect(PAGO_MENSAJERO_MOVIMIENTO_CATEGORIA_SEED).toContain("premio_ranking");
    expect(PAGO_MENSAJERO_MOVIMIENTO_CATEGORIA_SEED).toHaveLength(6);
    for (const previa of [
      "pago_devengado",
      "pago_efectivo",
      "liquidacion",
      "ajuste_devengo",
      "ajuste_pago",
    ]) {
      expect(PAGO_MENSAJERO_MOVIMIENTO_CATEGORIA_SEED).toContain(previa);
    }
  });

  it("`ranking_snapshot_fila` entra en los origenes, sin perder los 7 previos", () => {
    expect(WALLET_ORIGEN_TIPO_SEED).toContain("ranking_snapshot_fila");
    expect(WALLET_ORIGEN_TIPO_SEED).toHaveLength(8);
    for (const previo of [
      "cierre_dia",
      "gestion_orden",
      "manual",
      "pago_tienda",
      "pago_mensajero",
      "gasto",
      "orden_incidente",
    ]) {
      expect(WALLET_ORIGEN_TIPO_SEED).toContain(previo);
    }
  });
});

// ── UP, estatico ────────────────────────────────────────────────────────────────────────────

describe("UP — los siete pasos de design §10, en su orden", () => {
  it("los DOS `ALTER TYPE ... ADD VALUE IF NOT EXISTS`, y con el `IF NOT EXISTS` puesto", () => {
    expect(upSqlEjecutable).toMatch(
      /ALTER TYPE "pago_mensajero_movimiento_categoria" ADD VALUE IF NOT EXISTS 'premio_ranking';/,
    );
    expect(upSqlEjecutable).toMatch(
      /ALTER TYPE "wallet_origen_tipo" ADD VALUE IF NOT EXISTS 'ranking_snapshot_fila';/,
    );
  });

  it("no renombra, no reordena y no retira ningun valor previo de ningun enum", () => {
    expect(upSqlEjecutable).not.toMatch(/RENAME/i);
    expect(upSqlEjecutable).not.toMatch(/DROP TYPE/i);
    expect(upSqlEjecutable).not.toMatch(/CREATE TYPE/i);
  });

  it("`premio_dia` se añade como DATE nullable y SIN backfill", () => {
    const addColumn = upSqlEjecutable.match(/ALTER TABLE "pago_mensajero_movimiento" ADD COLUMN[^;]*;/);
    expect(addColumn).not.toBeNull();
    expect((addColumn as RegExpMatchArray)[0]).toBe(
      'ALTER TABLE "pago_mensajero_movimiento" ADD COLUMN "premio_dia" DATE;',
    );
    // Ni `NOT NULL` ni `DEFAULT` EN LA COLUMNA: con cualquiera de los dos, la migracion tendria
    // que reescribir todas las filas existentes del libro — que es justo lo que no hace.
    expect((addColumn as RegExpMatchArray)[0]).not.toMatch(/NOT NULL/);
    expect((addColumn as RegExpMatchArray)[0]).not.toMatch(/DEFAULT/);
  });

  it("EL PASO QUE NADIE VE VENIR: el CHECK tipo↔categoria se DROPEA y se RECREA", () => {
    // Si se olvidara, el sintoma no seria un saldo torcido: seria que NINGUN premio se puede
    // registrar jamas, con un 23514 en produccion.
    expect(upSqlEjecutable).toMatch(
      new RegExp(`DROP CONSTRAINT "${NOMBRE_CHECK_TIPO}"`),
    );
    expect(upSqlEjecutable).toMatch(new RegExp(`ADD CONSTRAINT "${NOMBRE_CHECK_TIPO}"`));
  });

  it("`premio_ranking` va en la rama `devengo` y NO en la de `pago`", () => {
    // El premio SUBE la cuenta por pagar. En la rama `pago` la bajaria: no daria un error, daria
    // un numero que miente.
    expect(ramaDelCheck(upSql, "devengo")).toEqual([
      "pago_devengado",
      "ajuste_devengo",
      "premio_ranking",
    ]);
    expect(ramaDelCheck(upSql, "pago")).toEqual(["pago_efectivo", "liquidacion", "ajuste_pago"]);
  });

  it("FALLA CERRADO: el CHECK ENUMERA, no niega (nada de NOT IN / <> / != en sus ramas)", () => {
    const cuerpo = upSql.slice(upSql.indexOf(`ADD CONSTRAINT "${NOMBRE_CHECK_TIPO}"`));
    const check = cuerpo.slice(0, cuerpo.indexOf(");") + 2);
    expect(check).not.toMatch(/NOT IN/);
    expect(check).not.toMatch(/<>/);
    expect(check).not.toMatch(/!=/);
  });

  it("las 6 categorias del catalogo estan en UNA sola rama: ninguna suelta, ninguna repetida", () => {
    const todas = [...ramaDelCheck(upSql, "devengo"), ...ramaDelCheck(upSql, "pago")];
    expect(new Set(todas).size).toBe(todas.length);
    expect([...todas].sort()).toEqual([...PAGO_MENSAJERO_MOVIMIENTO_CATEGORIA_SEED].sort());
  });

  it("el CHECK de `premio_dia` ata la columna a las DOS categorias del premio", () => {
    expect(upSqlEjecutable).toMatch(new RegExp(`ADD CONSTRAINT "${NOMBRE_CHECK_PREMIO_DIA}"`));
    expect(upSqlEjecutable).toMatch(/"premio_dia" IS NULL\s+AND "categoria" <> 'premio_ranking'/);
    expect(upSqlEjecutable).toMatch(
      /"premio_dia" IS NOT NULL AND "categoria" IN \('premio_ranking','ajuste_pago'\)/,
    );
  });

  it("`origen_uq` se recrea con la EXCLUSION de las dos categorias del premio", () => {
    expect(upSqlEjecutable).toMatch(new RegExp(`DROP INDEX "${UQ_ORIGEN}";`));
    expect(upSqlEjecutable).toMatch(
      new RegExp(
        `CREATE UNIQUE INDEX "${UQ_ORIGEN}"[\\s\\S]*?WHERE "origen_id" IS NOT NULL AND "categoria" NOT IN \\('premio_ranking','ajuste_pago'\\);`,
      ),
    );
    // Las categorias del FEED del cierre siguen DENTRO del predicado: su idempotencia no se toca.
    const predicado = upSqlEjecutable.slice(upSqlEjecutable.indexOf(`CREATE UNIQUE INDEX "${UQ_ORIGEN}"`));
    expect(predicado).not.toMatch(/pago_devengado/);
    expect(predicado).not.toMatch(/pago_efectivo/);
  });

  it("R17: el unico parcial `(mensajero_id, premio_dia) WHERE categoria = 'premio_ranking'`", () => {
    expect(upSqlEjecutable).toMatch(
      new RegExp(
        `CREATE UNIQUE INDEX "${UQ_PREMIO}"\\s+ON "pago_mensajero_movimiento"\\("mensajero_id", "premio_dia"\\)\\s+WHERE "categoria" = 'premio_ranking';`,
      ),
    );
  });

  it("R31: el unico parcial del REVERSO, con su `premio_dia IS NOT NULL`", () => {
    expect(upSqlEjecutable).toMatch(
      new RegExp(
        `CREATE UNIQUE INDEX "${UQ_REVERSO}"\\s+ON "pago_mensajero_movimiento"\\("mensajero_id", "premio_dia"\\)\\s+WHERE "categoria" = 'ajuste_pago' AND "premio_dia" IS NOT NULL;`,
      ),
    );
  });

  it("no mueve datos (sin INSERT/UPDATE/DELETE) y no toca RLS ni policies", () => {
    expect(upSqlEjecutable).not.toMatch(/\bINSERT\b/i);
    expect(upSqlEjecutable).not.toMatch(/\bUPDATE\b/i);
    expect(upSqlEjecutable).not.toMatch(/\bDELETE\b/i);
    expect(upSqlEjecutable).not.toMatch(/ROW LEVEL SECURITY/i);
    expect(upSqlEjecutable).not.toMatch(/POLICY/i);
  });
});

// ── DOWN, estatico ──────────────────────────────────────────────────────────────────────────

describe("DOWN — revierte exactamente, con la coreografia de los SEIS indices", () => {
  it("suelta los SEIS indices que referencian `origen_tipo`, uno por uno y por nombre", () => {
    // Olvidar cualquiera deja el tipo `_old` con dependientes y el `DROP TYPE` ABORTA el rollback
    // a mitad. Esta escrito en el down de la 158 y aqui se comprueba que no se olvido ninguno.
    for (const indice of [
      "wallet_movimiento_origen_tipo_origen_id_idx",
      "wallet_movimiento_origen_categoria_uq",
      "wallet_tienda_movimiento_origen_tipo_origen_id_idx",
      "wallet_tienda_movimiento_origen_uq",
      "pago_mensajero_movimiento_origen_tipo_origen_id_idx",
      "pago_mensajero_movimiento_origen_uq",
    ]) {
      expect(downSqlEjecutable).toMatch(new RegExp(`DROP INDEX IF EXISTS "${indice}";`));
      expect(downSqlEjecutable).toMatch(new RegExp(`CREATE (UNIQUE )?INDEX "${indice}"`));
    }
  });

  it("los DOS enums se recrean con sus valores previos, sin los nuevos", () => {
    const origen = downSql.match(/CREATE TYPE "wallet_origen_tipo" AS ENUM \(([\s\S]*?)\);/);
    expect(origen).not.toBeNull();
    const valoresOrigen = [...(origen as RegExpMatchArray)[1].matchAll(/'([^']+)'/g)].map(
      (m) => m[1],
    );
    expect(valoresOrigen).toEqual([
      "cierre_dia",
      "gestion_orden",
      "manual",
      "pago_tienda",
      "pago_mensajero",
      "gasto",
      "orden_incidente",
    ]);

    const cat = downSql.match(
      /CREATE TYPE "pago_mensajero_movimiento_categoria" AS ENUM \(([\s\S]*?)\);/,
    );
    expect(cat).not.toBeNull();
    const valoresCat = [...(cat as RegExpMatchArray)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(valoresCat).toEqual([
      "pago_devengado",
      "pago_efectivo",
      "liquidacion",
      "ajuste_devengo",
      "ajuste_pago",
    ]);
  });

  it("`origen_uq` vuelve con su PREDICADO ORIGINAL (sin la exclusion de categorias)", () => {
    const bloque = downSql.slice(downSql.lastIndexOf(`CREATE UNIQUE INDEX "${UQ_ORIGEN}"`));
    expect(bloque).toMatch(/WHERE "origen_id" IS NOT NULL;/);
    expect(bloque).not.toMatch(/NOT IN/);
  });

  it("suelta los dos unicos del premio y los DOS CHECK antes de recrear los tipos", () => {
    const posReverso = downSqlEjecutable.indexOf(`DROP INDEX IF EXISTS "${UQ_REVERSO}"`);
    const posPremio = downSqlEjecutable.indexOf(`DROP INDEX IF EXISTS "${UQ_PREMIO}"`);
    const posCheckDia = downSqlEjecutable.indexOf(NOMBRE_CHECK_PREMIO_DIA);
    const posCheckTipo = downSqlEjecutable.indexOf(`DROP CONSTRAINT IF EXISTS "${NOMBRE_CHECK_TIPO}"`);
    const posCreateTipo = downSqlEjecutable.indexOf('CREATE TYPE "pago_mensajero_movimiento_categoria"');
    for (const pos of [posReverso, posPremio, posCheckDia, posCheckTipo]) {
      expect(pos).toBeGreaterThan(-1);
      expect(pos).toBeLessThan(posCreateTipo);
    }
  });

  it("suelta la columna ANTES de recrear el enum de categoria", () => {
    const posDropColumna = downSqlEjecutable.indexOf('DROP COLUMN IF EXISTS "premio_dia"');
    const posCreateTipo = downSqlEjecutable.indexOf('CREATE TYPE "pago_mensajero_movimiento_categoria"');
    expect(posDropColumna).toBeGreaterThan(-1);
    expect(posDropColumna).toBeLessThan(posCreateTipo);
  });

  it("vuelve a poner el CHECK con la LISTA ORIGINAL de cinco (sin `premio_ranking`)", () => {
    const bloque = downSql.slice(downSql.lastIndexOf(`ADD CONSTRAINT "${NOMBRE_CHECK_TIPO}"`));
    expect(bloque).not.toMatch(/premio_ranking/);
    expect(ramaDelCheck(bloque, "devengo")).toEqual(["pago_devengado", "ajuste_devengo"]);
  });

  it("documenta la PRECONDICION y no borra ni una fila del libro", () => {
    expect(downSql).toMatch(/PRECONDICION/);
    expect(downSql).toMatch(/premio_ranking/); // la nombra en la precondicion
    expect(downSqlEjecutable).not.toMatch(/\bDELETE\b/i);
    expect(downSqlEjecutable).not.toMatch(/DROP TABLE/i);
    expect(downSqlEjecutable).not.toMatch(/ROW LEVEL SECURITY/i);
  });
});

describe("R50 — esta migracion NO reescribe ningun down.sql previo", () => {
  it("ningun down.sql ANTERIOR menciona los dos valores nuevos", () => {
    const carpetas = fs
      .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((n) => n < path.basename(migrationDir));
    let revisados = 0;
    for (const carpeta of carpetas) {
      const ruta = path.join(MIGRATIONS_DIR, carpeta, "down.sql");
      if (!fs.existsSync(ruta)) continue;
      revisados += 1;
      const sql = fs.readFileSync(ruta, "utf8");
      // Se buscan los LITERALES de enum (comilla simple), no los identificadores: la tabla
      // `"premio_ranking"` de la feature 76 y la tabla `"ranking_snapshot_fila"` de la 196 son
      // otra cosa y sus down.sql las nombran con comillas dobles, legitimamente.
      expect(sql, `${carpeta}/down.sql menciona un valor de enum de la 293`).not.toMatch(
        /'premio_ranking'|'ranking_snapshot_fila'/,
      );
    }
    // Control de NO-VACUIDAD: si el listado quedara vacio, el bucle pasaria sin comprobar nada.
    expect(revisados).toBeGreaterThan(100);
  });

  it("el down de la 158 sigue listando sus 6 valores punto-en-el-tiempo", () => {
    const sql = fs.readFileSync(
      path.join(migrationDirFor("_orden_incidente"), "down.sql"),
      "utf8",
    );
    const m = sql.match(/CREATE TYPE "wallet_origen_tipo" AS ENUM \(([\s\S]*?)\);/);
    expect(m).not.toBeNull();
    expect([...(m as RegExpMatchArray)[1].matchAll(/'([^']+)'/g)].map((x) => x[1])).toHaveLength(6);
  });
});

describe("estructura de la carpeta de migracion", () => {
  it("contiene migration.sql y down.sql", () => {
    expect(fs.existsSync(path.join(migrationDir, "migration.sql"))).toBe(true);
    expect(fs.existsSync(path.join(migrationDir, "down.sql"))).toBe(true);
  });

  it("su timestamp es estrictamente MAYOR que el de todas las demas carpetas", () => {
    const nombres = fs
      .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    const mio = path.basename(migrationDir);
    const otras = nombres.filter((n) => n !== mio);
    expect(otras.length).toBeGreaterThan(100); // control de no-vacuidad
    for (const otra of otras) {
      expect(otra.slice(0, 14) <= mio.slice(0, 14)).toBe(true);
    }
  });
});

// ── CONTRA POSTGRES DE VERDAD ───────────────────────────────────────────────────────────────

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("T1.4 [PG] — los dos CHECK, ejercidos contra Postgres", () => {
  let prisma: PrismaClient;
  let catalogo: { tipoIdentificacionId: string; rolId: string } | null = null;

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    const u = await prisma.usuario.findFirst({
      where: { rol: { value: RolValue.mensajero } },
      select: { tipoIdentificacionId: true, rolId: true },
    });
    if (u === null) {
      throw new Error(
        "hay DATABASE_URL pero no hay ningun usuario `mensajero`: sin catalogo no se puede " +
          "sembrar el mensajero de prueba. Corre `pnpm run db:seed` y `db:seed:usuarios`.",
      );
    }
    catalogo = u;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  const DIA = new Date("2026-08-26T00:00:00.000Z");

  interface Rechazo {
    sqlstate: string | undefined;
    mensaje: string;
  }

  /**
   * Siembra su PROPIO mensajero (nunca uno preexistente) e intenta el INSERT. Devuelve el rechazo
   * del MOTOR, o `null` si la base acepto la fila. Todo dentro de una transaccion REVERTIDA.
   *
   * El SQLSTATE se lee de `error.cause.code` y NO del texto: el mensaje viene en el idioma del
   * servidor. El codigo y el NOMBRE de la restriccion son iguales en cualquier locale.
   */
  async function intentar(fila: {
    tipo: PagoMensajeroMovimientoTipo;
    categoria: PagoMensajeroMovimientoCategoria;
    premioDia: Date | null;
  }): Promise<Rechazo | null> {
    const cat = catalogo as { tipoIdentificacionId: string; rolId: string };
    return enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const sufijo = randomUUID();
      const mensajero = await tx.usuario.create({
        data: {
          nombre: "T1.4",
          email: `t14-${sufijo}@example.test`,
          telefono: "88880000",
          passwordHash: "x",
          cedula: `t14-${sufijo}`,
          tipoIdentificacionId: cat.tipoIdentificacionId,
          rolId: cat.rolId,
        },
        select: { id: true },
      });
      try {
        await tx.pagoMensajeroMovimiento.create({
          data: {
            mensajeroId: mensajero.id,
            tipo: fila.tipo,
            categoria: fila.categoria,
            monto: new Prisma.Decimal("1.00"),
            origenTipo: "cierre_dia",
            origenId: randomUUID(),
            premioDia: fila.premioDia,
          },
        });
        return null; // la base la ACEPTO
      } catch (e) {
        const causa = (e as { cause?: { code?: string } }).cause;
        return { sqlstate: causa?.code, mensaje: e instanceof Error ? e.message : String(e) };
      }
    });
  }

  it("R14: `devengo` + `premio_ranking` (con su `premio_dia`) ENTRA", async () => {
    // Si esta se pusiera roja con 23514, la feature entera seria inaplicable: ningun premio se
    // podria registrar jamas. Es el paso 4 de §10, medido.
    expect(await intentar({ tipo: "devengo", categoria: "premio_ranking", premioDia: DIA })).toBeNull();
  });

  it("`pago` + `premio_ranking` es RECHAZADO por el CHECK tipo↔categoria (23514)", async () => {
    // En la rama `pago`, el premio BAJARIA la cuenta por pagar en vez de subirla.
    const r = await intentar({ tipo: "pago", categoria: "premio_ranking", premioDia: DIA });
    expect(r?.sqlstate).toBe("23514");
    expect(r?.mensaje).toContain(NOMBRE_CHECK_TIPO);
  });

  it("`premio_ranking` SIN `premio_dia` es RECHAZADO (23514)", async () => {
    // Sin la columna, el unico parcial de R17 no separaria nada y la guarda «un premio por
    // (mensajero, dia)» se evaporaria en silencio.
    const r = await intentar({ tipo: "devengo", categoria: "premio_ranking", premioDia: null });
    expect(r?.sqlstate).toBe("23514");
    expect(r?.mensaje).toContain(NOMBRE_CHECK_PREMIO_DIA);
  });

  it("`pago_devengado` CON `premio_dia` es RECHAZADO (23514)", async () => {
    const r = await intentar({ tipo: "devengo", categoria: "pago_devengado", premioDia: DIA });
    expect(r?.sqlstate).toBe("23514");
    expect(r?.mensaje).toContain(NOMBRE_CHECK_PREMIO_DIA);
  });

  it("CONTRAPRUEBA: las 6 combinaciones LEGITIMAS del libro entran todas", async () => {
    // Un CHECK que rechaza de mas tambien esta roto. `ajuste_pago` va DOS veces —con y sin
    // `premio_dia`— porque las dos formas son legitimas: es el reverso de un premio y es un
    // ajuste manual cualquiera.
    const legitimas: Array<{
      tipo: PagoMensajeroMovimientoTipo;
      categoria: PagoMensajeroMovimientoCategoria;
      premioDia: Date | null;
    }> = [
      { tipo: "devengo", categoria: "pago_devengado", premioDia: null },
      { tipo: "devengo", categoria: "ajuste_devengo", premioDia: null },
      { tipo: "devengo", categoria: "premio_ranking", premioDia: DIA },
      { tipo: "pago", categoria: "pago_efectivo", premioDia: null },
      { tipo: "pago", categoria: "liquidacion", premioDia: null },
      { tipo: "pago", categoria: "ajuste_pago", premioDia: null },
      { tipo: "pago", categoria: "ajuste_pago", premioDia: DIA },
    ];
    for (const fila of legitimas) {
      expect(
        await intentar(fila),
        `${fila.tipo}/${fila.categoria}/${fila.premioDia === null ? "sin dia" : "con dia"} deberia entrar`,
      ).toBeNull();
    }
  });

  it("el catalogo de Postgres tiene los DOS unicos parciales, con su predicado", async () => {
    const filas = (await prisma.$queryRawUnsafe(
      `SELECT indexname, indexdef FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'pago_mensajero_movimiento'`,
    )) as Array<{ indexname: string; indexdef: string }>;
    const porNombre = new Map(filas.map((f) => [f.indexname, f.indexdef]));

    expect(porNombre.get(UQ_PREMIO)).toMatch(/UNIQUE/);
    expect(porNombre.get(UQ_PREMIO)).toMatch(/mensajero_id, premio_dia/);
    expect(porNombre.get(UQ_PREMIO)).toMatch(/WHERE \(categoria = 'premio_ranking'/);

    expect(porNombre.get(UQ_REVERSO)).toMatch(/UNIQUE/);
    expect(porNombre.get(UQ_REVERSO)).toMatch(/premio_dia IS NOT NULL/);

    // Y el de origen, con la exclusion aplicada de verdad en la base.
    expect(porNombre.get(UQ_ORIGEN)).toMatch(/premio_ranking/);
    expect(porNombre.get(UQ_ORIGEN)).toMatch(/ajuste_pago/);
  });
});
