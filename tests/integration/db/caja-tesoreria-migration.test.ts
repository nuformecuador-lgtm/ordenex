import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  WALLET_MOVIMIENTO_CATEGORIA_SEED,
  type WalletMovimientoCategoria,
  type WalletMovimientoTipo,
} from "@/lib/types/wallet";
import { HAY_BASE_DE_DATOS, crearPrismaDeTest, enTransaccionRevertida } from "./_postgres-real";

// Feature 173 (T A.1, R49/R50 · T A.2, R45/R46) — cobertura de la migracion
// `*_caja_tesoreria`, en DOS niveles:
//
//  1) ESTATICA (patron `incidente-indemnizacion-migration.test.ts` /
//     `wallet-egreso-migration.test.ts`: lee migration.sql y down.sql por regex). Protege la
//     FORMA de los dos .sql para que un cambio posterior no los desalinee en silencio.
//  2) CONTRA POSTGRES DE VERDAD (T A.2): el `CHECK` categoria↔tipo EJERCIDO. Una regex sobre
//     el SQL demuestra que la restriccion esta ESCRITA; solo el motor demuestra que RECHAZA
//     (23514) y —lo que importa igual— que NO rechaza de mas: las 17 combinaciones legitimas
//     entran. Sin base alcanzable esa parte se SALTA (no falla).
//
// El round-trip REAL up -> down -> up contra el Postgres local esta registrado en
// `progress/impl_173-caja-tesoreria.md`.

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

/** Valores literales de un `CREATE TYPE ... AS ENUM (...)` del SQL, en orden. */
function valoresDelEnum(sql: string, tipo: string): string[] {
  const match = sql.match(new RegExp(`CREATE TYPE "${tipo}" AS ENUM \\(([\\s\\S]*?)\\);`));
  expect(match, `no hay CREATE TYPE "${tipo}" en el SQL`).not.toBeNull();
  return [...(match as RegExpMatchArray)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

const migrationDir = migrationDirFor("_caja_tesoreria");
const upSql = fs.readFileSync(path.join(migrationDir, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(migrationDir, "down.sql"), "utf8");

/** El UP sin comentarios: para las aserciones que hablan de lo que se EJECUTA, no de lo que se explica. */
const upSqlEjecutable = upSql.replace(/^\s*--.*$/gm, "");

const VALORES_NUEVOS = ["ingreso_cod_recaudado", "ingreso_reverso_pago_tienda"] as const;

const NOMBRE_CHECK = "wallet_movimiento_tipo_categoria_check";

/**
 * T A.2 — las 17 combinaciones LEGITIMAS `(categoria, tipo)`, escritas A MANO.
 *
 * A proposito NO se derivan del prefijo del nombre (`ingreso_*` / `egreso_*`): si el test
 * dedujera la clasificacion de la misma convencion de la que la dedujo quien escribio el SQL,
 * los dos se equivocarian juntos y el test seria un espejo. Aqui la clasificacion se declara,
 * y el `Record` es TOTAL sobre el catalogo: el dia que el enum gane un valor, esto deja de
 * compilar hasta que alguien diga de que tipo es —igual que `NATURALEZA_POR_CATEGORIA`—.
 */
const TIPO_LEGITIMO_POR_CATEGORIA: Record<WalletMovimientoCategoria, WalletMovimientoTipo> = {
  ingreso_flete: "ingreso",
  ingreso_flete_devolucion: "ingreso",
  ingreso_comision_cod: "ingreso",
  ingreso_iva_flete: "ingreso",
  ingreso_iva_flete_devolucion: "ingreso",
  ingreso_iva_comision_cod: "ingreso",
  ingreso_ajuste: "ingreso",
  ingreso_cod_recaudado: "ingreso",
  ingreso_reverso_pago_tienda: "ingreso",
  egreso_pago_tienda: "egreso",
  egreso_pago_mensajero: "egreso",
  egreso_gasto: "egreso",
  egreso_sueldo: "egreso",
  egreso_ajuste: "egreso",
  egreso_gasto_fijo: "egreso",
  egreso_gasto_variable: "egreso",
  egreso_indemnizacion: "egreso",
};

const COMBINACIONES_LEGITIMAS = (
  Object.entries(TIPO_LEGITIMO_POR_CATEGORIA) as [WalletMovimientoCategoria, WalletMovimientoTipo][]
).map(([categoria, tipo]) => ({ categoria, tipo }));

/** El tipo CONTRARIO: la mitad negativa del ejercicio (17 filas incoherentes). */
function tipoInvertido(tipo: WalletMovimientoTipo): WalletMovimientoTipo {
  return tipo === "ingreso" ? "egreso" : "ingreso";
}

/** Las categorias que el SQL lista dentro de la rama `("tipo" = '<tipo>' AND "categoria" IN (…))`. */
function ramaDelCheck(sql: string, tipo: WalletMovimientoTipo): string[] {
  const match = sql.match(
    new RegExp(`\\("tipo" = '${tipo}' AND "categoria" IN \\(([\\s\\S]*?)\\)\\)`),
  );
  expect(match, `no hay rama '${tipo}' en el CHECK`).not.toBeNull();
  return [...(match as RegExpMatchArray)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe("el SEED tipado incluye los dos valores nuevos (R49)", () => {
  it("WALLET_MOVIMIENTO_CATEGORIA_SEED gana los dos y conserva las 15 previas", () => {
    for (const valor of VALORES_NUEVOS) {
      expect(WALLET_MOVIMIENTO_CATEGORIA_SEED).toContain(valor);
    }
    expect(WALLET_MOVIMIENTO_CATEGORIA_SEED).toHaveLength(17);
    for (const previa of [
      "ingreso_flete",
      "ingreso_flete_devolucion",
      "ingreso_comision_cod",
      "ingreso_iva_flete",
      "ingreso_iva_flete_devolucion",
      "ingreso_iva_comision_cod",
      "ingreso_ajuste",
      "egreso_pago_tienda",
      "egreso_pago_mensajero",
      "egreso_gasto",
      "egreso_sueldo",
      "egreso_ajuste",
      "egreso_gasto_fijo",
      "egreso_gasto_variable",
      "egreso_indemnizacion",
    ]) {
      expect(WALLET_MOVIMIENTO_CATEGORIA_SEED).toContain(previa);
    }
  });

  it("`egreso_pago_tienda` YA existia: la 173 le da emisor, no lo crea", () => {
    expect(WALLET_MOVIMIENTO_CATEGORIA_SEED).toContain("egreso_pago_tienda");
    expect(upSql).not.toMatch(/ADD VALUE[^\n]*'egreso_pago_tienda'/);
  });
});

describe("UP — aditivo, sin datos y sin RLS (R49)", () => {
  it("R49: ALTER TYPE ADD VALUE IF NOT EXISTS para los DOS valores nuevos", () => {
    for (const valor of VALORES_NUEVOS) {
      expect(upSql).toMatch(
        new RegExp(
          `ALTER TYPE "wallet_movimiento_categoria" ADD VALUE IF NOT EXISTS '${valor}';`,
        ),
      );
    }
  });

  it("R49: no renombra, no reordena y no retira ningun valor previo del enum", () => {
    expect(upSql).not.toMatch(/RENAME/i);
    expect(upSql).not.toMatch(/DROP TYPE/i);
    expect(upSql).not.toMatch(/CREATE TYPE/i);
  });

  it("R49: no mueve datos (sin INSERT/UPDATE/DELETE) — seguro con ADD VALUE fuera de tx", () => {
    // `ALTER TYPE ... ADD VALUE` no puede coexistir con un USO del valor en la misma
    // transaccion; aqui solo se anaden, que es el patron de las features 41/45/67/158.
    expect(upSql).not.toMatch(/INSERT INTO/i);
    expect(upSql).not.toMatch(/\bUPDATE\s+"/i);
    expect(upSql).not.toMatch(/DELETE FROM/i);
  });

  it("R49: NO toca RLS ni policies (no hay tabla nueva)", () => {
    expect(upSql).not.toMatch(/CREATE POLICY/i);
    expect(upSql).not.toMatch(/ROW LEVEL SECURITY/i);
  });

  it("R49: NO toca indices en el UP", () => {
    expect(upSql).not.toMatch(/CREATE\s+(UNIQUE\s+)?INDEX/i);
    expect(upSql).not.toMatch(/DROP INDEX/i);
  });
});

describe("UP — T A.2: el CHECK categoria↔tipo de la caja (R45/R46, estatico)", () => {
  it("R45: la caja gana el `ADD CONSTRAINT` que la 172 dejo encargado, con su nombre", () => {
    expect(upSql).toMatch(
      new RegExp(`ALTER TABLE "wallet_movimiento" ADD CONSTRAINT "${NOMBRE_CHECK}"`),
    );
    // Mismo nombre que sus dos hermanos de la 172 sobre los otros dos libros: la forma es
    // deliberadamente la misma, para que se lean como una familia.
    expect(NOMBRE_CHECK).toBe("wallet_movimiento_tipo_categoria_check");
  });

  it("R45: la rama `ingreso` lista EXACTAMENTE las categorias de ingreso del catalogo", () => {
    const declaradas = COMBINACIONES_LEGITIMAS.filter((c) => c.tipo === "ingreso").map(
      (c) => c.categoria,
    );
    expect(ramaDelCheck(upSql, "ingreso").sort()).toEqual([...declaradas].sort());
    expect(declaradas).toHaveLength(9);
  });

  it("R45: la rama `egreso` lista EXACTAMENTE las categorias de egreso del catalogo", () => {
    const declaradas = COMBINACIONES_LEGITIMAS.filter((c) => c.tipo === "egreso").map(
      (c) => c.categoria,
    );
    expect(ramaDelCheck(upSql, "egreso").sort()).toEqual([...declaradas].sort());
    expect(declaradas).toHaveLength(8);
  });

  it("R46: FALLA CERRADO — el CHECK ENUMERA, no niega (nada de NOT IN / <> / !=)", () => {
    // Es la diferencia entre «lo que no este prohibido entra» y «solo entra lo declarado».
    // Con listas cerradas, un valor futuro del enum que nadie clasifique no casa NINGUNA rama
    // y el INSERT se rechaza; con una negacion, se colaria en silencio.
    const check = upSql.slice(upSql.indexOf(`ADD CONSTRAINT "${NOMBRE_CHECK}"`));
    expect(check).not.toMatch(/NOT IN/i);
    expect(check).not.toMatch(/<>|!=/);
    expect(check).toMatch(/\bOR\b/); // disyuncion de dos ramas, no una sola condicion
  });

  it("R46: las 17 categorias del catalogo estan en UNA sola rama — ninguna suelta, ninguna repetida", () => {
    const ingreso = ramaDelCheck(upSql, "ingreso");
    const egreso = ramaDelCheck(upSql, "egreso");
    const todas = [...ingreso, ...egreso];
    // Cobertura TOTAL contra el SEED vivo: si manana el enum gana un valor y nadie toca este
    // CHECK, esta aserción se pone roja ANTES de que la primera fila se cuele.
    expect([...todas].sort()).toEqual([...WALLET_MOVIMIENTO_CATEGORIA_SEED].sort());
    expect(new Set(todas).size).toBe(todas.length); // ninguna en las dos ramas a la vez
    expect(ingreso.filter((c) => egreso.includes(c))).toEqual([]);
  });

  it("R45: va DIRECTO — sin `NOT VALID`, porque T A.0 midio produccion y dio CERO", () => {
    // La decision no es de estilo: `NOT VALID` no revisa las filas existentes, y aqui SI se
    // quiere que las revise. Se pudo elegir eso porque hay una MEDICION (35 filas, 8
    // categorias, 0 incoherentes), no una corazonada.
    //
    // Se mide sobre el SQL SIN COMENTARIOS: lo que cuenta es lo que se EJECUTA. El encabezado
    // de la migracion habla de `NOT VALID` justamente para explicar por que NO se usa.
    expect(upSqlEjecutable).not.toMatch(/NOT VALID/i);
    expect(upSqlEjecutable).not.toMatch(/VALIDATE CONSTRAINT/i);
    // …y la decision queda escrita donde vive la migracion, con su medicion citada.
    expect(upSql).toMatch(/T A\.0/);
    expect(upSql).toMatch(/medicion_TA0_173\.md/);
  });
});

describe("DOWN — recrea el enum sin los dos valores nuevos (R49)", () => {
  it("R49: el enum vuelve a sus 15 valores previos, en el mismo orden y sin los nuevos", () => {
    const valores = valoresDelEnum(downSql, "wallet_movimiento_categoria");
    for (const valor of VALORES_NUEVOS) {
      expect(valores).not.toContain(valor);
    }
    expect(valores).toHaveLength(15);
    // El que cuadra con el SEED VIGENTE menos los dos valores que esta migracion anade es ESTE
    // (los `down.sql` previos listan 12 y 14: son su estado punto-en-el-tiempo, R50).
    expect(valores).toEqual(
      WALLET_MOVIMIENTO_CATEGORIA_SEED.filter(
        (c) => !(VALORES_NUEVOS as readonly string[]).includes(c),
      ),
    );
  });

  it("R49: suelta y recrea los 2 indices que referencian `categoria`, alrededor del cast", () => {
    expect(downSql).toMatch(/DROP INDEX IF EXISTS "wallet_movimiento_tipo_categoria_idx";/);
    expect(downSql).toMatch(/DROP INDEX IF EXISTS "wallet_movimiento_origen_categoria_uq";/);
    expect(downSql).toMatch(
      /CREATE INDEX "wallet_movimiento_tipo_categoria_idx" ON "wallet_movimiento"\("tipo", "categoria"\);/,
    );
    expect(downSql).toMatch(
      /CREATE UNIQUE INDEX "wallet_movimiento_origen_categoria_uq"[\s\S]*WHERE "origen_id" IS NOT NULL;/,
    );
    // Los DROP van ANTES del cambio de tipo y los CREATE despues: al reves, los literales de
    // los indices quedarian ligados al tipo VIEJO durante el ALTER COLUMN.
    const cast = downSql.indexOf('ALTER TABLE "wallet_movimiento" ALTER COLUMN "categoria"');
    expect(downSql.indexOf('DROP INDEX IF EXISTS "wallet_movimiento_tipo_categoria_idx"')).toBeLessThan(cast);
    expect(downSql.indexOf('CREATE INDEX "wallet_movimiento_tipo_categoria_idx"')).toBeGreaterThan(cast);
  });

  it("R49: migra la columna con USING cast y no deja ningun tipo `_old` colgando", () => {
    expect(downSql).toMatch(
      /ALTER TYPE "wallet_movimiento_categoria" RENAME TO "wallet_movimiento_categoria_old";/,
    );
    expect(downSql).toMatch(
      /ALTER TABLE "wallet_movimiento" ALTER COLUMN "categoria"\s+TYPE "wallet_movimiento_categoria" USING/,
    );
    expect(downSql).toMatch(/DROP TYPE "wallet_movimiento_categoria_old";/);
  });

  it("R49: documenta la PRECONDICION (el down ABORTA si alguna fila usa los valores nuevos)", () => {
    expect(downSql).toMatch(/PRECONDICION/i);
    expect(downSql).toMatch(/ABORTA/i);
  });

  it("R45/R49: suelta el CHECK, y lo hace ANTES que los DROP INDEX y que el cast", () => {
    // El encargo literal de la Tanda A (`progress/impl_173-caja-tesoreria.md §5`), y no es
    // cosmetico: el CHECK NOMBRA los dos valores nuevos del enum. Si se soltara despues del
    // `ALTER COLUMN ... TYPE`, el cast fallaria —la restriccion sigue ligada al tipo que se
    // esta recreando— y el rollback abortaria a medias.
    expect(downSql).toMatch(
      new RegExp(
        `ALTER TABLE "wallet_movimiento" DROP CONSTRAINT IF EXISTS "${NOMBRE_CHECK}";`,
      ),
    );
    const drop = downSql.indexOf(`DROP CONSTRAINT IF EXISTS "${NOMBRE_CHECK}"`);
    const dropIndex = downSql.indexOf('DROP INDEX IF EXISTS "wallet_movimiento_tipo_categoria_idx"');
    const cast = downSql.indexOf('ALTER TABLE "wallet_movimiento" ALTER COLUMN "categoria"');
    expect(drop).toBeGreaterThan(-1);
    expect(drop).toBeLessThan(dropIndex);
    expect(drop).toBeLessThan(cast);
  });

  it("R45: el down NO recrea el CHECK (el estado previo a esta migracion no lo tenia)", () => {
    // Espejo EXACTO del up: la caja llego a esta carpeta SIN restriccion tipo↔categoria (la
    // 172 la dejo fuera a proposito, `migration.sql:123-126` de la 172). Recrearla en el down
    // dejaria la base en un estado que nunca existio.
    expect(downSql).not.toMatch(/ADD CONSTRAINT/i);
  });

  it("R49: el down tampoco toca RLS ni policies", () => {
    expect(downSql).not.toMatch(/CREATE POLICY/i);
    expect(downSql).not.toMatch(/ROW LEVEL SECURITY/i);
  });

  it("R49: el down no borra ni una fila del libro (append-only, tambien al revertir)", () => {
    expect(downSql).not.toMatch(/DELETE FROM/i);
    expect(downSql).not.toMatch(/TRUNCATE/i);
  });
});

describe("R50 — esta migracion NO reescribe ningun down.sql previo", () => {
  it("R50: el down de la 45 sigue listando sus 12 valores punto-en-el-tiempo", () => {
    const prev = fs.readFileSync(
      path.join(migrationDirFor("_wallet_egreso_gasto_fijo_variable"), "down.sql"),
      "utf8",
    );
    expect(valoresDelEnum(prev, "wallet_movimiento_categoria")).toHaveLength(12);
    for (const valor of VALORES_NUEVOS) {
      expect(prev).not.toContain(valor);
    }
  });

  it("R50: el down de la 158 sigue listando sus 14 valores punto-en-el-tiempo", () => {
    const prev = fs.readFileSync(
      path.join(migrationDirFor("_incidente_indemnizacion"), "down.sql"),
      "utf8",
    );
    expect(valoresDelEnum(prev, "wallet_movimiento_categoria")).toHaveLength(14);
    for (const valor of VALORES_NUEVOS) {
      expect(prev).not.toContain(valor);
    }
  });

  it("R50: NINGUN down.sql anterior a esta carpeta nombra los dos valores nuevos", () => {
    const carpeta = path.basename(migrationDir);
    const previos = fs
      .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((name) => name < carpeta);

    const contaminados = previos.filter((name) => {
      const file = path.join(MIGRATIONS_DIR, name, "down.sql");
      if (!fs.existsSync(file)) return false;
      const sql = fs.readFileSync(file, "utf8");
      return VALORES_NUEVOS.some((valor) => sql.includes(valor));
    });
    expect(contaminados).toEqual([]);
  });
});

describe("estructura de la carpeta de migracion", () => {
  it("contiene migration.sql y down.sql", () => {
    expect(fs.existsSync(path.join(migrationDir, "migration.sql"))).toBe(true);
    expect(fs.existsSync(path.join(migrationDir, "down.sql"))).toBe(true);
  });

  it("el timestamp de la carpeta es POSTERIOR al maximo que existia al escribirla", () => {
    // Baseline PINNEADO (convencion del repo desde el 2026-07-29): el maximo timestamp del
    // arbol cuando esta migracion se escribio. Las posteriores son irrelevantes por
    // definicion; lo que este assert caza es RENOMBRAR esta carpeta ya aplicada, que
    // descuadraria `_prisma_migrations`.
    const BASELINE = "20260803090000";
    expect(path.basename(migrationDir)).toBe("20260803120000_caja_tesoreria");
    expect(path.basename(migrationDir).slice(0, 14) > BASELINE).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────
// T A.2 — el CHECK EJERCIDO contra Postgres de verdad (R45/R46)
//
// Por que no basta la regex de arriba: demuestra que la restriccion esta ESCRITA, no que el
// motor la aplique. Lo que esta feature se juega en este CHECK es que la clasificacion por
// naturaleza decide por CATEGORIA y el signo lo da el TIPO: una fila incoherente caeria en la
// cubeta equivocada CON EL SIGNO CONTRARIO y descuadraria una de las dos cifras sin que nada
// fallara. Eso no da un error: da un numero que miente.
//
// Y las contrapruebas pesan lo mismo que el rechazo: un CHECK que rechaza de mas tumbaria
// escrituras legitimas de las tandas B, C y E. Por eso van las 17 combinaciones legitimas
// UNA A UNA, no una muestra.
//
// Aislamiento: TODO corre dentro de transacciones que SIEMPRE se revierten (patron de la 169),
// incluidos los intentos que deben fallar —si alguien borrara el CHECK, esos INSERT tendrian
// exito y no puede quedar ni una fila de dinero inventada en la base de desarrollo—.
// ───────────────────────────────────────────────────────────────────────────────────────────

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("T A.2 — el CHECK categoria↔tipo, contra Postgres (R45/R46)", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  /** Una fila del libro sin ninguna FK: `registrado_por` es nullable y `origen_id` es texto. */
  function filaDePrueba(tipo: WalletMovimientoTipo, categoria: WalletMovimientoCategoria) {
    return {
      tipo,
      categoria,
      monto: new Prisma.Decimal("1.00"),
      origenTipo: "manual" as const,
      origenId: randomUUID(),
      descripcion: "T A.2",
      registradoPor: null,
    };
  }

  /**
   * Intenta insertar y devuelve el rechazo del MOTOR, o `null` si la base acepto la fila.
   *
   * El SQLSTATE se lee de `error.cause.code` y NO del texto: el mensaje viene en el idioma del
   * servidor (esta base responde en espanol, «viola la restriccion «check» …»), asi que casar
   * una frase seria casar una traduccion. El codigo `23514` y el NOMBRE de la restriccion, en
   * cambio, son los mismos en cualquier locale.
   */
  interface Rechazo {
    sqlstate: string | undefined;
    mensaje: string;
  }

  async function intentar(
    tipo: WalletMovimientoTipo,
    categoria: WalletMovimientoCategoria,
  ): Promise<Rechazo | null> {
    return enTransaccionRevertida(prisma, async (tx) => {
      try {
        await tx.walletMovimiento.create({ data: filaDePrueba(tipo, categoria) });
        return null; // la base la ACEPTO: no hay rechazo que devolver
      } catch (e) {
        const causa = (e as { cause?: { code?: string } }).cause;
        return {
          sqlstate: causa?.code,
          mensaje: e instanceof Error ? e.message : String(e),
        };
      }
    });
  }

  /** `true` si el rechazo es el del CHECK de esta migracion, y no otro cualquiera. */
  function esRechazoDelCheck(r: Rechazo | null): boolean {
    return r !== null && r.sqlstate === "23514" && r.mensaje.includes(NOMBRE_CHECK);
  }

  it("R45: un INSERT incoherente (ingreso con categoria de egreso) devuelve 23514", async () => {
    // El caso canonico y el mas realista: `egreso_pago_tienda` con `tipo: ingreso` es
    // exactamente la alternativa (E) que `design.md §10` descarta —«aritmeticamente funciona»,
    // dice, «y el CHECK lo rechazaria». Aqui se comprueba que en efecto lo rechaza.
    const rechazo = await intentar("ingreso", "egreso_pago_tienda");

    expect(rechazo).not.toBeNull();
    expect(rechazo?.sqlstate).toBe("23514"); // SQLSTATE check_violation
    expect(rechazo?.mensaje).toContain(NOMBRE_CHECK);
  });

  it("R45: y al reves — un egreso con categoria de ingreso, tambien 23514", async () => {
    // `ingreso_cod_recaudado` con tipo `egreso` es el fallo que mas dano haria: el
    // contra-entrega restando de la caja en vez de sumar, y ademas en la cubeta de terceros.
    const rechazo = await intentar("egreso", "ingreso_cod_recaudado");

    expect(rechazo).not.toBeNull();
    expect(rechazo?.sqlstate).toBe("23514");
    expect(rechazo?.mensaje).toContain(NOMBRE_CHECK);
  });

  it("R45: las 17 combinaciones INVERTIDAS son rechazadas, una por una", async () => {
    const supervivientes: string[] = [];
    for (const { categoria, tipo } of COMBINACIONES_LEGITIMAS) {
      const rechazo = await intentar(tipoInvertido(tipo), categoria);
      if (!esRechazoDelCheck(rechazo)) {
        supervivientes.push(
          `${tipoInvertido(tipo)}/${categoria} -> ${rechazo === null ? "ACEPTADA" : `${rechazo.sqlstate}`}`,
        );
      }
    }
    // Se acumulan y se afirman JUNTAS: si una rama del CHECK se borrara, el fallo nombra
    // exactamente las categorias que se colaron, no solo la primera.
    expect(supervivientes).toEqual([]);
  });

  it("R46: CONTRAPRUEBA — las 17 combinaciones LEGITIMAS entran todas", async () => {
    // Un CHECK que rechaza de mas es tan roto como uno que no rechaza: tumbaria las escrituras
    // de las tandas B (`ingreso_cod_recaudado`), C (`egreso_pago_tienda` /
    // `ingreso_reverso_pago_tienda`) y E (el registro retroactivo de las tres).
    const resultado = await enTransaccionRevertida(prisma, async (tx) => {
      const marca = randomUUID();
      await tx.walletMovimiento.createMany({
        data: COMBINACIONES_LEGITIMAS.map(({ categoria, tipo }) => ({
          ...filaDePrueba(tipo, categoria),
          origenId: marca,
        })),
      });
      return tx.walletMovimiento.findMany({
        where: { origenTipo: "manual", origenId: marca },
        select: { tipo: true, categoria: true },
      });
    });

    expect(resultado).toHaveLength(17);
    expect(
      resultado.map((f) => `${f.tipo}/${f.categoria}`).sort(),
    ).toEqual(COMBINACIONES_LEGITIMAS.map((c) => `${c.tipo}/${c.categoria}`).sort());
  });

  it("R46: FALLA CERRADO — el catalogo de Postgres lista el CHECK y nombra las 17, ni una mas", async () => {
    // Leido del MOTOR, no del .sql: es lo que garantiza que un valor futuro del enum que nadie
    // clasifique no case NINGUNA rama. Si manana alguien anade un valor al enum sin tocar este
    // CHECK, la comparacion contra `pg_enum` se pone roja aqui —antes de que su primera fila
    // se cuele en la cubeta equivocada—.
    const [check] = await prisma.$queryRaw<{ conname: string; convalidated: boolean; def: string }[]>`
      SELECT conname, convalidated, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid = '"wallet_movimiento"'::regclass AND contype = 'c'`;

    expect(check).toBeDefined();
    expect(check.conname).toBe(NOMBRE_CHECK);
    // `convalidated` = las filas EXISTENTES se revisaron al aplicarla (nada de `NOT VALID`).
    expect(check.convalidated).toBe(true);

    const etiquetasDelEnum = (
      await prisma.$queryRaw<{ enumlabel: string }[]>`
        SELECT e.enumlabel FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'wallet_movimiento_categoria'`
    ).map((r) => r.enumlabel);

    const nombradasEnElCheck = [
      ...new Set(
        [...check.def.matchAll(/'([^']+)'::wallet_movimiento_categoria/g)].map((m) => m[1]),
      ),
    ];
    expect(nombradasEnElCheck.sort()).toEqual([...etiquetasDelEnum].sort());
    expect(nombradasEnElCheck).toHaveLength(17);
    // Enumera, no niega: en la definicion que devuelve el motor no hay negacion alguna.
    expect(check.def).not.toMatch(/<>|NOT IN|!=/i);
  });
});
