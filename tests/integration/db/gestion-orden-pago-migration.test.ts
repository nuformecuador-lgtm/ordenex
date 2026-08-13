import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { HAY_BASE_DE_DATOS, crearPrismaDeTest, enTransaccionRevertida } from "./_postgres-real";

// Feature 212 — cobertura de la migracion `*_gestion_orden_pago`.
//
// DOS BLOQUES, y la diferencia es la razon de ser del segundo (molde: la feature 205,
// `liquidacion-reparto-migration.test.ts`):
//
//  A. ESTATICO (patron gestion-orden-evidencia-migration.test.ts): lee migration.sql/down.sql y
//     los contrasta por REGEX, sin Postgres. Verifica la FORMA del DDL: que las columnas esten y
//     sean NOT NULL, que el unique y la FK esten ESCRITOS, que el WHERE del backfill tenga sus
//     tres condiciones, que no haya CHECK ni trigger (R10), que no se toquen los cierres (R8) ni
//     `gestion_orden` (R5), y que el down sea SOLO el drop de la tabla nueva.
//
//  B. COMPORTAMIENTO CONTRA POSTGRES DE VERDAD. Lo que el bloque A NO puede demostrar y esta
//     migracion necesita: que el BACKFILL —que es DML que reescribe datos de produccion— escriba
//     EXACTAMENTE una fila por gestion cobrada, con el metodo y el monto AL CENTIMO y CERO filas
//     para las tres clases excluidas; que el UNIQUE RECHACE el segundo metodo repetido (y deje
//     pasar los dos casos vecinos); que el CASCADE BORRE de verdad y que un `gestion_id`
//     inexistente sea rechazado; que la RLS quede encendida en `pg_class` y sin policies; y que
//     el `down.sql` REAL deje `gestion_orden` con las MISMAS columnas y LOS MISMOS DATOS. Una
//     regex sobre el texto del `.sql` afirma que el SQL DICE esas cosas; solo el motor demuestra
//     que las HACE.
//
// EL BLOQUE B NO APLICA LA MIGRACION A NINGUNA BASE. Dentro de una transaccion que SIEMPRE se
// revierte crea un ESQUEMA temporal de nombre aleatorio, CLONA ahi `gestion_orden` con
// `LIKE public."gestion_orden" INCLUDING ALL` y ejecuta el `migration.sql` REAL (no una
// parafrasis) sentencia a sentencia. `_prisma_migrations` no se toca y en `public` no queda
// absolutamente nada: ni el esquema, ni las filas, ni la tabla nueva.
//
// POR QUE SE CLONA `gestion_orden`: el UP la nombra DOS veces —la FK apunta a ella y el backfill
// hace `SELECT ... FROM "gestion_orden"`—. Con el esquema temporal PRIMERO en el `search_path`,
// las dos resuelven contra el CLON: el backfill lee las filas que SIEMBRA EL TEST (no las 44 de
// la base de desarrollo, que ni son un oraculo ni cubren los casos limite) y la FK no toca la
// tabla real. `LIKE` copia columnas, tipos, defaults, CHECKs e indices —incluida la PK, que la FK
// necesita— pero NO las FK salientes, asi que se pueden sembrar gestiones sin inventar una orden
// ni un usuario.
//
// EL `search_path` NO ES DECORACION, Y POR ESO SE FIJA POR DDL Y NO UNA VEZ: el UP necesita
// `public` a la vista (el tipo enum `"metodo_pago_value"` y `gen_random_uuid()` viven alli), con
// el esquema temporal delante para que la tabla nueva caiga en el. El DOWN, en cambio, corre con
// el `search_path` REDUCIDO al esquema temporal, SIN `public`: su `DROP TABLE IF EXISTS
// "gestion_orden_pago"` con `public` a la vista podria alcanzar la tabla REAL en cuanto la
// migracion este desplegada.
//
// POR QUE ESTE BLOQUE NO PUEDE QUEDAR VERDE POR VACIO: no lee un solo dato preexistente como
// oraculo (siembra sus seis gestiones, tres que deben backfillearse y tres que no) y no tiene un
// solo `if (...) return;`. Cada asercion es sobre un conjunto medido o sobre el MENSAJE de error
// de una sentencia que TENIA que fallar; si faltara el unique o la FK, esa sentencia pasaria y el
// test se pondria rojo por «no fallo lo que tenia que fallar». Lo unico que lo salta es la
// ausencia de `DATABASE_URL`, y entonces vitest lo marca SKIPPED (nunca passed). Si el `beforeAll`
// revienta, vitest lista sus tests como SKIPPED y el fichero como FAILED: ese «skipped» es el
// sintoma del fallo del hook, no una guarda de entorno.

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

const migrationDir = migrationDirFor("_gestion_orden_pago");
const upSql = fs.readFileSync(path.join(migrationDir, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(migrationDir, "down.sql"), "utf8");

/**
 * El SQL EJECUTABLE, sin comentarios. Hace DOS cosas, y las dos hacen falta:
 *
 *  1. tira las lineas que son ENTERAS un comentario. Una de ellas cita `'efectivo'` al explicar
 *     el WHERE del backfill, asi que la prosa de este `.sql` tiene comillas aunque el DDL no;
 *  2. recorta el comentario al FINAL de una linea de codigo (`... ("gestion_id", "metodo");
 *     -- R2 [D2]`), que si no acabaria pegado al principio del trozo siguiente al partir por `;`.
 *     Ese recorte se salta las lineas con comilla simple, donde un `--` podria vivir DENTRO de un
 *     literal; hoy, una vez fuera los comentarios enteros, no queda ninguna (lo mide el test de
 *     la invariante del split).
 */
function sinComentarios(sql: string): string {
  return sql
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .map((l) => (l.includes("'") ? l : l.replace(/--.*$/, "")).trimEnd())
    .filter((l) => l.trim().length > 0)
    .join("\n");
}

/** Sentencias sueltas del DDL. Ver el test que fija la invariante que hace valido el split. */
function sentenciasDe(ddl: string): string[] {
  return ddl
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

describe("UP — tabla gestion_orden_pago (R1/R2/R3)", () => {
  it("R1: CREATE TABLE con id, gestion_id, metodo, monto, created_at, todas NOT NULL", () => {
    expect(upSql).toMatch(/CREATE TABLE "gestion_orden_pago"/);
    expect(upSql).toContain('"id"         TEXT NOT NULL');
    expect(upSql).toContain('"gestion_id" TEXT NOT NULL');
    expect(upSql).toContain('"metodo"     "metodo_pago_value" NOT NULL');
    expect(upSql).toContain('"monto"      DECIMAL(12,2) NOT NULL');
    expect(upSql).toMatch(/"created_at"\s+TIMESTAMP\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP/);
  });

  it("R1: PRIMARY KEY en id", () => {
    expect(upSql).toMatch(/CONSTRAINT "gestion_orden_pago_pkey" PRIMARY KEY \("id"\)/);
  });

  it("R20: el monto usa la MISMA escala monetaria que monto_recibido — DECIMAL(12,2), nunca float", () => {
    expect(upSql).toMatch(/"monto"\s+DECIMAL\(12,2\) NOT NULL/);
    expect(upSql).not.toMatch(/"monto"\s+(DOUBLE PRECISION|REAL|FLOAT|NUMERIC\s*\)|MONEY)/i);
  });

  it("R3: la linea NO almacena una referencia de pago ni un indice de orden", () => {
    expect(upSql).not.toMatch(/"referencia"/i);
    expect(upSql).not.toMatch(/"indice"/i);
  });

  it("R1: FK gestion_id -> gestion_orden(id) ON DELETE CASCADE ON UPDATE CASCADE", () => {
    expect(upSql).toMatch(
      /ADD CONSTRAINT "gestion_orden_pago_gestion_id_fkey"\s+FOREIGN KEY \("gestion_id"\) REFERENCES "gestion_orden"\("id"\) ON DELETE CASCADE ON UPDATE CASCADE/,
    );
  });

  it("R2: UNIQUE (gestion_id, metodo) — un metodo, como mucho una vez por gestion [D2]", () => {
    expect(upSql).toMatch(
      /CREATE UNIQUE INDEX "gestion_orden_pago_gestion_id_metodo_key"\s+ON "gestion_orden_pago" \("gestion_id", "metodo"\)/,
    );
  });

  it("R1: indice de lectura por gestion_id", () => {
    expect(upSql).toMatch(
      /CREATE INDEX "gestion_orden_pago_gestion_id_idx"\s+ON "gestion_orden_pago" \("gestion_id"\)/,
    );
  });
});

describe("UP — RLS habilitada sin policies (R4)", () => {
  it("R4: ENABLE ROW LEVEL SECURITY sin CREATE POLICY (solo service role)", () => {
    expect(upSql).toContain('ALTER TABLE "gestion_orden_pago" ENABLE ROW LEVEL SECURITY;');
    expect(upSql).not.toMatch(/CREATE POLICY/i);
  });
});

describe("UP — backfill del recaudo escalar (R6/R7)", () => {
  it("R6: inserta UNA linea (metodo_pago, monto_recibido) por gestion cobrada", () => {
    expect(upSql).toMatch(
      /INSERT INTO "gestion_orden_pago" \("id", "gestion_id", "metodo", "monto", "created_at"\)/,
    );
    expect(upSql).toMatch(
      /SELECT gen_random_uuid\(\), "id", "metodo_pago", "monto_recibido", "created_at"/,
    );
    expect(upSql).toMatch(/FROM "gestion_orden"/);
  });

  it("R7: el WHERE tiene las TRES condiciones — sin monto nulo, sin monto 0 y sin metodo nulo", () => {
    expect(upSql).toMatch(
      /WHERE "monto_recibido" IS NOT NULL\s+AND "monto_recibido" > 0\s+AND "metodo_pago" IS NOT NULL;/,
    );
  });

  it("R7: el backfill NO inventa filas para gestiones sin cobro (no hay INSERT incondicional)", () => {
    expect(upSql).not.toMatch(/INSERT INTO "gestion_orden_pago"[\s\S]*FROM "gestion_orden";/);
  });
});

describe("UP — lo que la migracion NO hace (R5/R8/R10)", () => {
  it("R10: la invariante SUM(monto) = monto_recibido NO se expresa como CHECK ni trigger", () => {
    expect(upSql).not.toMatch(/CHECK\s*\(/i);
    expect(upSql).not.toMatch(/CREATE\s+(OR REPLACE\s+)?(TRIGGER|FUNCTION)/i);
  });

  it("R8: no altera cierre_dia, cierre_bodega, cierre_maestro ni cierre_detail", () => {
    for (const tabla of ["cierre_dia", "cierre_bodega", "cierre_maestro", "cierre_detail"]) {
      expect(upSql).not.toMatch(new RegExp(`ALTER TABLE "${tabla}"`));
      expect(upSql).not.toMatch(new RegExp(`UPDATE "${tabla}"`));
    }
  });

  it("R5: no elimina, renombra ni cambia el tipo de monto_recibido / metodo_pago", () => {
    expect(upSql).not.toMatch(/ALTER TABLE "gestion_orden"/);
    expect(upSql).not.toMatch(/DROP COLUMN/i);
    expect(upSql).not.toMatch(/RENAME COLUMN/i);
  });
});

describe("DOWN — reversible sin tocar gestion_orden (R9)", () => {
  it("R9: DROP TABLE de la tabla nueva (arrastra backfill, unique, index y FK)", () => {
    expect(downSql).toMatch(/DROP TABLE IF EXISTS "gestion_orden_pago";/);
  });

  it("R9: el down NO altera ni borra columnas/datos de gestion_orden (el par escalar queda intacto)", () => {
    expect(downSql).not.toMatch(/ALTER TABLE "gestion_orden"/);
    expect(downSql).not.toMatch(/DROP COLUMN/i);
    expect(downSql).not.toMatch(/UPDATE "gestion_orden"/);
    expect(downSql).not.toMatch(/DELETE FROM "gestion_orden"/);
  });

  it("R9: el down es SOLO el drop de la tabla nueva — ninguna otra sentencia ejecutable", () => {
    const sentencias = downSql
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("--"));
    expect(sentencias).toEqual(['DROP TABLE IF EXISTS "gestion_orden_pago";']);
  });

  it("R9: documenta que revertir pierde los desgloses MIXTOS posteriores a la migracion", () => {
    expect(downSql).toMatch(/MIXTOS/);
  });
});

describe("la invariante que hace valido partir el DDL por `;` (la usa el bloque B)", () => {
  it("ninguna cadena `'...'` del SQL contiene un `;`", () => {
    // El bloque B ejecuta el `migration.sql` y el `down.sql` REALES partiendolos por `;`. Si
    // algun dia un literal llevara un `;` dentro, ese split partiria una sentencia por la mitad
    // y el bloque B fallaria por un motivo que NO es el suyo. La invariante se fija aqui, donde
    // el mensaje de error dice exactamente que pasa.
    //
    // Se mide sobre el SQL EJECUTABLE, no sobre el archivo crudo: la prosa del `.sql` cita
    // `'efectivo'` al explicar el WHERE del backfill, y un barrido literal se leeria a si mismo.
    // Los comentarios no llegan al motor, asi que un `;` ahi dentro no parte nada.
    //
    // HONESTIDAD SOBRE SU ALCANCE HOY: el DDL ejecutable no tiene NI UN literal (el backfill
    // copia columnas, no escribe valores), asi que el bucle pasa por VACIO. Se deja puesto
    // porque el dia que se anada uno sera la unica red, y por eso se mide ademas el numero: si
    // manana aparecen literales, este conteo cambia y quien lo lea sabra que el bucle de arriba
    // dejo de ser vacio.
    const literalesUp = sinComentarios(upSql).match(/'[^']*'/g) ?? [];
    const literalesDown = sinComentarios(downSql).match(/'[^']*'/g) ?? [];
    for (const literal of [...literalesUp, ...literalesDown]) {
      expect(literal, `este literal del .sql contiene un ';': ${literal}`).not.toContain(";");
    }
    expect({ up: literalesUp.length, down: literalesDown.length }).toEqual({ up: 0, down: 0 });
  });

  it("el troceado del DDL real produce las SEIS sentencias del UP y la UNICA del DOWN", () => {
    // Control de no-vacuidad del helper que usa el bloque B: si `sinComentarios` se comiera una
    // sentencia (o dejara un trozo que es solo comentario), el UP se aplicaria a medias y los
    // fallos aparecerian lejos de su causa.
    const sentenciasUp = sentenciasDe(sinComentarios(upSql));
    expect(sentenciasUp).toHaveLength(6);
    expect(sentenciasUp.map((s) => s.split(/\s+/).slice(0, 3).join(" "))).toEqual([
      'CREATE TABLE "gestion_orden_pago"',
      "CREATE UNIQUE INDEX",
      'CREATE INDEX "gestion_orden_pago_gestion_id_idx"',
      'ALTER TABLE "gestion_orden_pago"',
      'ALTER TABLE "gestion_orden_pago"',
      'INSERT INTO "gestion_orden_pago"',
    ]);
    expect(sentenciasDe(sinComentarios(downSql))).toEqual([
      'DROP TABLE IF EXISTS "gestion_orden_pago"',
    ]);
  });
});

describe("estructura de la carpeta de migracion", () => {
  it("contiene migration.sql y down.sql, con timestamp posterior a la feature 119", () => {
    expect(fs.existsSync(path.join(migrationDir, "migration.sql"))).toBe(true);
    expect(fs.existsSync(path.join(migrationDir, "down.sql"))).toBe(true);
    const dirName = path.basename(migrationDir);
    const feature119Dir = fs
      .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .find((name) => name.endsWith("_gestion_orden_evidencia"));
    expect(feature119Dir).toBeDefined();
    expect(dirName > (feature119Dir as string)).toBe(true);
  });
});

// ===========================================================================================
// BLOQUE B — COMPORTAMIENTO CONTRA POSTGRES DE VERDAD
// ===========================================================================================

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

/** Columna tal como Postgres la creo de verdad (el `udt_name` distingue el enum del texto). */
interface ColumnaReal {
  column_name: string;
  data_type: string;
  udt_name: string;
  is_nullable: string;
  numeric_precision: number | null;
  numeric_scale: number | null;
}

/** Una fila de `gestion_orden` en el clon, con todo lo que el backfill lee, como TEXTO. */
interface FilaGestion {
  id: string;
  resultado: string;
  monto_recibido: string | null;
  metodo_pago: string | null;
  created_at: string;
}

/**
 * Una linea del desglose tal como el backfill la escribio. Los montos viajan a TEXTO a
 * proposito: `12345.67` se compara AL CENTIMO, sin pasar por el `number` de JS.
 */
interface LineaReal {
  gestion_id: string;
  metodo: string;
  monto: string;
  created_at: string;
}

/** Un indice tal como vive en `pg_index`, con las columnas que cubre. */
interface IndiceReal {
  indice: string;
  columnas: string;
  unico: boolean;
}

/** Una FK tal como vive en `pg_constraint`: a donde apunta y con que regla de borrado. */
interface FkReal {
  constraint: string;
  columna: string;
  tabla_destino: string;
  columna_destino: string;
  on_delete: string;
}

/** Las seis gestiones que SIEMBRA el test: tres que deben backfillearse y tres que no. */
const SEMILLAS = [
  // DEBEN producir linea (R6): tres metodos distintos, con montos con decimales.
  {
    clave: "cobrada_efectivo",
    monto: "12345.67",
    metodo: "efectivo",
    createdAt: "2026-01-02 03:04:05.678",
  },
  { clave: "cobrada_sinpe", monto: "0.01", metodo: "SINPE", createdAt: "2026-02-03 04:05:06.789" },
  {
    clave: "cobrada_transferencia",
    monto: "99.99",
    metodo: "transferencia",
    createdAt: "2026-03-04 05:06:07.001",
  },
  // NO deben producir NINGUNA linea (R7).
  { clave: "sin_monto", monto: null, metodo: "efectivo", createdAt: "2026-04-05 06:07:08.002" },
  { clave: "monto_cero", monto: "0.00", metodo: "efectivo", createdAt: "2026-05-06 07:08:09.003" },
  { clave: "sin_metodo", monto: "55.55", metodo: null, createdAt: "2026-06-07 08:09:10.004" },
] as const;

type ClaveSemilla = (typeof SEMILLAS)[number]["clave"];

interface Medicion {
  ids: Record<ClaveSemilla, string>;
  /** El conjunto COMPLETO de lineas que dejo el backfill. */
  backfill: LineaReal[];
  lineasDeLasExcluidas: number;
  indices: IndiceReal[];
  fk: FkReal[];
  rls: { relname: string; relrowsecurity: boolean }[];
  policies: string[];
  errores: Record<string, string>;
  cascada: {
    errorAlBorrarLaGestion: string;
    lineasDeLaBorrada: number;
    lineasVivas: number;
    lineasTrasDeshacer: number;
  };
  columnasGestionAntes: ColumnaReal[];
  columnasGestionDespues: ColumnaReal[];
  filasGestionAntes: FilaGestion[];
  filasGestionDespues: FilaGestion[];
  tablasTrasElDown: string[];
}

describeSiHayBase("212 / bloque B — la migracion HACE lo que dice (Postgres real)", () => {
  let prisma: PrismaClient;
  let medicion: Medicion;

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    medicion = await enTransaccionRevertida(prisma, async (tx) => medir(tx));
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  /**
   * Corre el `migration.sql` REAL en un esquema temporal y lo ejercita entero. Todo lo que pasa
   * aqui vive dentro de la transaccion que `enTransaccionRevertida` deshace: ni el esquema, ni el
   * clon, ni las filas sobreviven al test.
   */
  async function medir(tx: Tx): Promise<Medicion> {
    const esquema = `t212_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    await tx.$executeRawUnsafe(`CREATE SCHEMA "${esquema}"`);

    // El CLON de `gestion_orden`. `INCLUDING ALL` trae columnas, tipos, defaults, CHECKs e
    // indices —la PK incluida, que es lo que la FK del UP necesita para poder crearse—; las FK
    // SALIENTES no se copian, y por eso se pueden sembrar gestiones sin inventar una orden ni un
    // usuario. El UP resolvera contra esta tabla, no contra la real.
    await tx.$executeRawUnsafe(
      `CREATE TABLE "${esquema}"."gestion_orden" (LIKE public."gestion_orden" INCLUDING ALL)`,
    );

    // --- LA SIEMBRA: datos PROPIOS del test, nada preexistente -----------------------------
    const ids = Object.fromEntries(SEMILLAS.map((s) => [s.clave, randomUUID()])) as Record<
      ClaveSemilla,
      string
    >;
    for (const s of SEMILLAS) {
      await tx.$executeRawUnsafe(
        `INSERT INTO "${esquema}"."gestion_orden"
           ("id","orden_id","mensajero_id","resultado","monto_recibido","metodo_pago","created_at")
         VALUES ('${ids[s.clave]}', '${randomUUID()}', '${randomUUID()}',
                 'entregada'::public.gestion_resultado,
                 ${s.monto === null ? "NULL" : s.monto},
                 ${s.metodo === null ? "NULL" : `'${s.metodo}'::public.metodo_pago_value`},
                 TIMESTAMP '${s.createdAt}')`,
      );
    }
    const columnasGestionAntes = await columnasDe(tx, esquema, "gestion_orden");
    const filasGestionAntes = await filasDe(tx, esquema);

    // El UP REAL, sentencia a sentencia. `public` va en el search_path porque el tipo enum
    // `"metodo_pago_value"` y `gen_random_uuid()` viven alli; el esquema temporal va PRIMERO, asi
    // que la tabla nueva, su FK y el `SELECT ... FROM "gestion_orden"` del backfill caen en el.
    await aplicarDdl(tx, sinComentarios(upSql), [esquema, "public"]);

    // --- R6/R7: lo que el backfill escribio, al centimo ------------------------------------
    const backfill = await tx.$queryRawUnsafe<LineaReal[]>(
      `SELECT "gestion_id", "metodo"::text AS metodo, "monto"::text AS monto,
              to_char("created_at", 'YYYY-MM-DD HH24:MI:SS.MS') AS created_at
         FROM "${esquema}"."gestion_orden_pago"
        ORDER BY "monto"`,
    );
    const [{ n: lineasDeLasExcluidas }] = await tx.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM "${esquema}"."gestion_orden_pago"
        WHERE "gestion_id" IN ('${ids.sin_monto}', '${ids.monto_cero}', '${ids.sin_metodo}')`,
    );

    // --- estructura REAL: indices, FK, RLS --------------------------------------------------
    const indices = await indicesDe(tx, esquema, "gestion_orden_pago");
    const fk = await fksDe(tx, esquema, "gestion_orden_pago", "gestion_id");
    const rls = await tx.$queryRawUnsafe<{ relname: string; relrowsecurity: boolean }[]>(
      `SELECT c.relname, c.relrowsecurity
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relkind = 'r' AND c.relname = 'gestion_orden_pago'`,
      esquema,
    );
    const policies = (
      await tx.$queryRawUnsafe<{ policyname: string }[]>(
        `SELECT policyname FROM pg_policies
          WHERE schemaname = $1 AND tablename = 'gestion_orden_pago'`,
        esquema,
      )
    ).map((p) => p.policyname);

    // --- R2 y R1: lo que la BASE rechaza, y lo que deja pasar --------------------------------
    const errores: Record<string, string> = {
      // R2: el MISMO (gestion, metodo) por segunda vez. El backfill ya dejo (cobrada_efectivo,
      // efectivo): este INSERT es el duplicado exacto.
      metodo_repetido_en_la_misma_gestion: await resultadoDe(
        tx,
        sqlDeLinea(esquema, ids.cobrada_efectivo, "efectivo", "1.00"),
      ),
      // Los DOS controles que le dan valor al de arriba: si el unico estuviera sobre `metodo`
      // solo, o sobre `gestion_id` solo, uno de estos dos fallaria y lo delataria.
      mismo_metodo_en_otra_gestion: await resultadoDe(
        tx,
        sqlDeLinea(esquema, ids.cobrada_sinpe, "efectivo", "1.00"),
      ),
      otro_metodo_en_la_misma_gestion: await resultadoDe(
        tx,
        sqlDeLinea(esquema, ids.cobrada_efectivo, "SINPE", "1.00"),
      ),
      // R1: la linea EXIGE una gestion que exista.
      gestion_inexistente: await resultadoDe(
        tx,
        sqlDeLinea(esquema, randomUUID(), "efectivo", "1.00"),
      ),
    };

    // --- R1: el CASCADE, ejercido de verdad -------------------------------------------------
    // Va dentro de un SAVEPOINT por dos motivos: porque borra una gestion sembrada (al volver, la
    // comparacion de datos de R9 sigue midiendo la siembra COMPLETA) y porque el borrado PUEDE
    // fallar —si la FK no fuera CASCADE, seria un RESTRICT—. Ese fallo se captura como MENSAJE en
    // vez de dejarlo reventar: un error suelto aborta la transaccion entera y se llevaria por
    // delante el resto de mediciones, convirtiendo un fallo concreto y legible («la FK no borra
    // en cascada») en un hook roto que no dice de que hablaba.
    await tx.$executeRawUnsafe("SAVEPOINT s208_cascada");
    let errorAlBorrarLaGestion = "";
    try {
      await tx.$executeRawUnsafe(
        `DELETE FROM "${esquema}"."gestion_orden" WHERE "id" = '${ids.cobrada_efectivo}'`,
      );
    } catch (error) {
      errorAlBorrarLaGestion = error instanceof Error ? error.message : String(error);
      await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT s208_cascada");
    }
    const [{ n: lineasDeLaBorrada }] = await tx.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM "${esquema}"."gestion_orden_pago"
        WHERE "gestion_id" = '${ids.cobrada_efectivo}'`,
    );
    const [{ n: lineasVivas }] = await tx.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM "${esquema}"."gestion_orden_pago"`,
    );
    await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT s208_cascada");
    const [{ n: lineasTrasDeshacer }] = await tx.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM "${esquema}"."gestion_orden_pago"`,
    );

    // --- R9: el `down.sql` REAL, con el search_path SIN `public` ----------------------------
    await aplicarDdl(tx, sinComentarios(downSql), [esquema]);
    const columnasGestionDespues = await columnasDe(tx, esquema, "gestion_orden");
    const filasGestionDespues = await filasDe(tx, esquema);
    const tablasTrasElDown = (
      await tx.$queryRawUnsafe<{ table_name: string }[]>(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema = $1 ORDER BY table_name`,
        esquema,
      )
    ).map((r) => r.table_name);

    return {
      ids,
      backfill,
      lineasDeLasExcluidas,
      indices,
      fk,
      rls,
      policies,
      errores,
      cascada: { errorAlBorrarLaGestion, lineasDeLaBorrada, lineasVivas, lineasTrasDeshacer },
      columnasGestionAntes,
      columnasGestionDespues,
      filasGestionAntes,
      filasGestionDespues,
      tablasTrasElDown,
    };
  }

  /**
   * Ejecuta un DDL REAL (el `migration.sql` o el `down.sql`) sentencia a sentencia, con el
   * `search_path` fijado a `esquemas` para todas ellas.
   *
   * QUE EL search_path SE FIJE AQUI, Y NO UNA VEZ AL PRINCIPIO, ES EL PUNTO: el UP necesita
   * `public` a la vista (el enum `metodo_pago_value` y `gen_random_uuid()`), y el DOWN necesita
   * NO tenerla, porque su `DROP TABLE IF EXISTS "gestion_orden_pago"` alcanzaria la tabla REAL en
   * cuanto la migracion este desplegada en esta base.
   *
   * `SET LOCAL` vale para la transaccion en curso, y una transaccion interactiva de Prisma fija
   * UNA conexion del pool, asi que las sentencias siguientes lo ven.
   */
  async function aplicarDdl(tx: Tx, ddl: string, esquemas: string[]): Promise<void> {
    await tx.$executeRawUnsafe(
      `SET LOCAL search_path TO ${esquemas.map((e) => `"${e}"`).join(", ")}`,
    );
    for (const sentencia of sentenciasDe(ddl)) await tx.$executeRawUnsafe(sentencia);
  }

  /** El INSERT de una linea del desglose, CUALIFICADO (no depende del search_path que quedo). */
  function sqlDeLinea(esquema: string, gestionId: string, metodo: string, monto: string): string {
    return `INSERT INTO "${esquema}"."gestion_orden_pago" ("id","gestion_id","metodo","monto")
            VALUES ('${randomUUID()}', '${gestionId}', '${metodo}'::public.metodo_pago_value, ${monto})`;
  }

  async function columnasDe(tx: Tx, esquema: string, tabla: string): Promise<ColumnaReal[]> {
    return tx.$queryRawUnsafe<ColumnaReal[]>(
      `SELECT column_name, data_type, udt_name, is_nullable, numeric_precision, numeric_scale
         FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2
        ORDER BY ordinal_position`,
      esquema,
      tabla,
    );
  }

  /** Las filas del clon de `gestion_orden`, como TEXTO, para compararlas antes y despues. */
  async function filasDe(tx: Tx, esquema: string): Promise<FilaGestion[]> {
    return tx.$queryRawUnsafe<FilaGestion[]>(
      `SELECT "id", "resultado"::text AS resultado, "monto_recibido"::text AS monto_recibido,
              "metodo_pago"::text AS metodo_pago,
              to_char("created_at", 'YYYY-MM-DD HH24:MI:SS.MS') AS created_at
         FROM "${esquema}"."gestion_orden" ORDER BY "id"`,
    );
  }

  /** Los indices reales de una tabla, con sus columnas y si son unicos. */
  async function indicesDe(tx: Tx, esquema: string, tabla: string): Promise<IndiceReal[]> {
    return tx.$queryRawUnsafe<IndiceReal[]>(
      `SELECT ci.relname AS indice,
              array_to_string(ARRAY(
                SELECT a.attname
                  FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
                  JOIN pg_attribute a ON a.attrelid = ct.oid AND a.attnum = k.attnum
                 ORDER BY k.ord
              ), ',') AS columnas,
              i.indisunique AS unico
         FROM pg_index i
         JOIN pg_class ct ON ct.oid = i.indrelid
         JOIN pg_class ci ON ci.oid = i.indexrelid
         JOIN pg_namespace n ON n.oid = ct.relnamespace
        WHERE n.nspname = $1 AND ct.relname = $2
        ORDER BY ci.relname`,
      esquema,
      tabla,
    );
  }

  /** Las FK de una columna concreta: a donde apuntan y con que regla de borrado. */
  async function fksDe(tx: Tx, esquema: string, tabla: string, columna: string): Promise<FkReal[]> {
    return tx.$queryRawUnsafe<FkReal[]>(
      `SELECT con.conname AS constraint,
              att.attname AS columna,
              destino.relname AS tabla_destino,
              attd.attname AS columna_destino,
              con.confdeltype::text AS on_delete
         FROM pg_constraint con
         JOIN pg_class ct ON ct.oid = con.conrelid
         JOIN pg_namespace n ON n.oid = ct.relnamespace
         JOIN pg_class destino ON destino.oid = con.confrelid
         JOIN pg_attribute att ON att.attrelid = ct.oid AND att.attnum = con.conkey[1]
         JOIN pg_attribute attd ON attd.attrelid = destino.oid AND attd.attnum = con.confkey[1]
        WHERE n.nspname = $1 AND ct.relname = $2 AND con.contype = 'f' AND att.attname = $3`,
      esquema,
      tabla,
      columna,
    );
  }

  /**
   * Ejecuta `sql` dentro de un SAVEPOINT y devuelve el MENSAJE de error, o `""` si paso. El
   * savepoint es OBLIGATORIO: en Postgres un error aborta la transaccion entera y sin el, la
   * primera violacion esperada dejaria muerto todo el resto del test. En los dos casos se vuelve
   * al savepoint, asi que el estado queda igual y las mediciones no dependen del orden.
   */
  async function resultadoDe(tx: Tx, sql: string): Promise<string> {
    await tx.$executeRawUnsafe("SAVEPOINT s208");
    try {
      await tx.$executeRawUnsafe(sql);
      await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT s208");
      return "";
    } catch (error) {
      await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT s208");
      return error instanceof Error ? error.message : String(error);
    }
  }

  it("CONTROL DE NO-VACUIDAD: la siembra existe y es la del test (seis gestiones propias)", () => {
    // Sin esto, un backfill vacio podria pasar por «correcto» simplemente porque no habia nada
    // que backfillear. El clon lleva las SEIS gestiones sembradas y ni una mas: no lee las de
    // `public`, que ni son un oraculo ni cubren los casos limite.
    expect(medicion.filasGestionAntes).toHaveLength(6);
    expect(
      medicion.filasGestionAntes.map((f) => [f.monto_recibido, f.metodo_pago]).sort(),
    ).toEqual(
      [
        ["12345.67", "efectivo"],
        ["0.01", "SINPE"],
        ["99.99", "transferencia"],
        [null, "efectivo"],
        ["0.00", "efectivo"],
        ["55.55", null],
      ].sort(),
    );
  });

  it("R6: el backfill escribe UNA linea por gestion cobrada, con metodo y monto AL CENTIMO", () => {
    // El conjunto COMPLETO, no un conteo: un backfill que escribiera el monto de otra gestion, o
    // el metodo cambiado, daria el mismo numero de filas.
    const porMonto = (a: { monto: string }, b: { monto: string }) => a.monto.localeCompare(b.monto);
    expect(
      medicion.backfill
        .map((l) => ({ gestion: l.gestion_id, metodo: l.metodo, monto: l.monto }))
        .sort(porMonto),
    ).toEqual(
      [
        { gestion: medicion.ids.cobrada_efectivo, metodo: "efectivo", monto: "12345.67" },
        { gestion: medicion.ids.cobrada_sinpe, metodo: "SINPE", monto: "0.01" },
        { gestion: medicion.ids.cobrada_transferencia, metodo: "transferencia", monto: "99.99" },
      ].sort(porMonto),
    );
    // UNA, no dos: el `INSERT ... SELECT` no puede duplicar por un join mal escrito.
    for (const clave of ["cobrada_efectivo", "cobrada_sinpe", "cobrada_transferencia"] as const) {
      expect(
        medicion.backfill.filter((l) => l.gestion_id === medicion.ids[clave]),
        clave,
      ).toHaveLength(1);
    }
  });

  it("R6: la linea hereda el `created_at` de la gestion, no el de la migracion", () => {
    // Es lo que hace que el desglose historico caiga en el DIA en que se cobro. Si el backfill
    // dejara que el DEFAULT `CURRENT_TIMESTAMP` pusiera la fecha, estas tres fallarian —y los
    // totales por dia se irian enteros al dia del despliegue—.
    const porGestion = Object.fromEntries(medicion.backfill.map((l) => [l.gestion_id, l]));
    expect(porGestion[medicion.ids.cobrada_efectivo].created_at).toBe("2026-01-02 03:04:05.678");
    expect(porGestion[medicion.ids.cobrada_sinpe].created_at).toBe("2026-02-03 04:05:06.789");
    expect(porGestion[medicion.ids.cobrada_transferencia].created_at).toBe(
      "2026-03-04 05:06:07.001",
    );
  });

  it("R7: CERO lineas para monto NULL, para monto 0 y para metodo NULL", () => {
    // El caso del medio es el que hoy el panel disfraza de `efectivo`/0: tras la migracion queda
    // con CERO lineas, que es la semantica nueva (R14). Y sumar 0.00 a un balde no cambia ningun
    // total, asi que la paridad al centavo (R27) se conserva exacta.
    expect(medicion.lineasDeLasExcluidas).toBe(0);
    expect(medicion.backfill).toHaveLength(3);
  });

  it("R2: el mismo metodo dos veces en la MISMA gestion lo rechaza la BASE", () => {
    expect(medicion.errores.metodo_repetido_en_la_misma_gestion).toMatch(
      /gestion_orden_pago_gestion_id_metodo_key/,
    );
    // LOS DOS CONTROLES. Sin ellos, un unico sobre `metodo` solo —o sobre `gestion_id` solo—
    // haria pasar la asercion de arriba mientras rompe el caso legitimo: una entrega cobrada con
    // DOS metodos es exactamente lo que esta feature existe para permitir.
    expect(medicion.errores.mismo_metodo_en_otra_gestion).toBe("");
    expect(medicion.errores.otro_metodo_en_la_misma_gestion).toBe("");
    // Y el unico existe con ese nombre y sobre ESAS dos columnas, en ese orden.
    expect(medicion.indices).toEqual(
      expect.arrayContaining([
        {
          indice: "gestion_orden_pago_gestion_id_metodo_key",
          columnas: "gestion_id,metodo",
          unico: true,
        },
      ]),
    );
  });

  it("R1: la FK apunta a `gestion_orden(id)` con CASCADE, y el indice por gestion existe", () => {
    // «Apunta a donde dice» medido en `pg_constraint`, no en el texto del .sql: es la unica forma
    // de que una FK dirigida a otra tabla (o a otra columna) ponga el test en rojo.
    expect(medicion.fk).toEqual([
      {
        constraint: "gestion_orden_pago_gestion_id_fkey",
        columna: "gestion_id",
        tabla_destino: "gestion_orden",
        columna_destino: "id",
        on_delete: "c", // 'c' = CASCADE en pg_constraint.confdeltype
      },
    ]);
    expect(medicion.errores.gestion_inexistente).toMatch(/gestion_orden_pago_gestion_id_fkey/);
    expect(medicion.indices).toEqual(
      expect.arrayContaining([
        { indice: "gestion_orden_pago_gestion_id_idx", columnas: "gestion_id", unico: false },
      ]),
    );
  });

  it("R1: el CASCADE ejercido — borrar la gestion se lleva SUS lineas y solo las suyas", () => {
    // Lo PRIMERO: que el borrado del padre se pudiera hacer. Si la FK fuera RESTRICT (o NO
    // ACTION), Postgres lo rechazaria y este mensaje lo dice con el nombre de la restriccion, en
    // vez de dejar el fallo escondido detras de un conteo que no cuadra.
    expect(
      medicion.cascada.errorAlBorrarLaGestion,
      "borrar la gestion padre FALLO: la FK no borra en cascada",
    ).toBe("");
    expect(medicion.cascada.lineasDeLaBorrada).toBe(0);
    expect(medicion.cascada.lineasVivas).toBe(2); // las de las otras dos gestiones cobradas
    // Y el savepoint devolvio el estado: lo que mide R9 despues es la siembra completa.
    expect(medicion.cascada.lineasTrasDeshacer).toBe(3);
  });

  it("R4: RLS habilitada (relrowsecurity = true) y CERO policies", () => {
    expect(medicion.rls).toEqual([{ relname: "gestion_orden_pago", relrowsecurity: true }]);
    expect(medicion.policies).toEqual([]);
  });

  it("R9: tras el `down.sql` REAL, `gestion_orden` queda IDENTICA (columnas y DATOS)", () => {
    // No «parecido»: la lista entera de columnas con su tipo y su nullabilidad, y el conjunto
    // entero de filas sembradas. Un down que se llevara por delante `monto_recibido` o
    // `metodo_pago` —o sus datos— seria irreversible sobre el recaudo historico.
    expect(medicion.columnasGestionDespues).toEqual(medicion.columnasGestionAntes);
    expect(medicion.filasGestionDespues).toEqual(medicion.filasGestionAntes);
    expect(medicion.filasGestionDespues).toHaveLength(6);
    // Y el par escalar sigue ahi, con su tipo exacto.
    expect(
      medicion.columnasGestionDespues
        .filter((c) => c.column_name === "monto_recibido" || c.column_name === "metodo_pago")
        .map((c) => [c.column_name, c.udt_name, c.is_nullable]),
    ).toEqual([
      ["monto_recibido", "numeric", "YES"],
      ["metodo_pago", "metodo_pago_value", "YES"],
    ]);
  });

  it("R9: la tabla `gestion_orden_pago` ya no existe, y el clon sobrevive", () => {
    expect(medicion.tablasTrasElDown).toEqual(["gestion_orden"]);
  });
});
