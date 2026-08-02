import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Feature 172 / T A.2 — cobertura ESTATICA de la migracion `*_liquidacion_pago` (molde
// `wallet-tienda-migration.test.ts`: lee migration.sql/down.sql y afirma sobre el SQL; NO
// requiere Postgres). El round-trip up->down->up y el RECHAZO REAL de una fila incoherente son
// verificacion manual del implementer (T H.3), pegada en `progress/impl_172-liquidacion.md`.
//
// Cubre R58 (CHECK del ledger de tienda), R59 (CHECK del libro del mensajero), R60 (falla
// cerrado: un concepto sin clasificar no casa ninguna rama), R62 (la caja principal NO recibe
// el CHECK, [P8]), R63 (RLS sin policies en las dos tablas nuevas), R64 (down reversible en
// orden inverso, sin tocar enums) y R75 (UNIQUE de `pago_id`: un pago se anula UNA vez).
//
// Los CHECK NO se comprueban por `toContain` de la cadena entera: se PARSEAN a un mapa
// tipo -> categorias y se compara contra los valores REALES del enum en `db/schema.prisma`.
// Asi, borrar a mano una rama (o una sola categoria de una rama) hace fallar el test que la
// afirma; un `toContain` del SQL literal no distinguiria eso de un cambio de formato.

const ROOT = path.join(__dirname, "..", "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");

function migrationDirFor(suffix: string): string {
  const dir = fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .find((name) => name.endsWith(suffix));
  if (!dir) throw new Error(`No se encontro la carpeta de migracion ${suffix}`);
  return path.join(MIGRATIONS_DIR, dir);
}

const migrationDir = migrationDirFor("_liquidacion_pago");
const upSql = fs.readFileSync(path.join(migrationDir, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(migrationDir, "down.sql"), "utf8");
const schemaPrisma = fs.readFileSync(path.join(ROOT, "db", "schema.prisma"), "utf8");

/** Valores REALES de un enum de `db/schema.prisma` (sin comentarios ni `@@map`). */
function valoresDelEnum(nombre: string): string[] {
  const m = schemaPrisma.match(new RegExp(`enum ${nombre} \\{([\\s\\S]*?)\\n\\}`));
  if (!m) throw new Error(`No se encontro el enum ${nombre} en db/schema.prisma`);
  return m[1]
    .split("\n")
    .map((linea) => linea.replace(/\/\/.*$/, "").trim())
    .filter((linea) => linea.length > 0 && !linea.startsWith("@@"));
}

/** El texto de la sentencia `ADD CONSTRAINT <nombre> CHECK (...)`, hasta su `);`. */
function sentenciaDelCheck(sql: string, constraint: string): string {
  const inicio = sql.indexOf(`ADD CONSTRAINT "${constraint}"`);
  if (inicio < 0) throw new Error(`La migracion no anade el CHECK ${constraint}`);
  const fin = sql.indexOf(");", inicio);
  if (fin < 0) throw new Error(`El CHECK ${constraint} no termina`);
  return sql.slice(inicio, fin + 2);
}

/**
 * Parsea un CHECK `tipo <-> categoria` a `tipo -> [categorias]`. Solo reconoce ramas
 * POSITIVAS de la forma `("tipo" = 'x' AND "categoria" IN (...))`: si alguien reescribiera el
 * CHECK como una negacion, no habria ramas que parsear y los tests caerian, que es lo
 * correcto (esa forma no falla cerrado, R60).
 */
function ramasDelCheck(sql: string, constraint: string): Map<string, string[]> {
  const sentencia = sentenciaDelCheck(sql, constraint);
  const ramas = new Map<string, string[]>();
  const re = /\("tipo" = '([a-z_]+)' AND "categoria" IN \(([^)]*)\)\)/g;
  for (const m of sentencia.matchAll(re)) {
    const categorias = m[2]
      .split(",")
      .map((c) => c.trim().replace(/^'|'$/g, ""))
      .filter((c) => c.length > 0);
    ramas.set(m[1], categorias);
  }
  return ramas;
}

/** ¿La restriccion ACEPTA ese par? Es la semantica del CHECK, evaluada sobre lo parseado. */
function aceptaElCheck(ramas: Map<string, string[]>, tipo: string, categoria: string): boolean {
  return ramas.get(tipo)?.includes(categoria) ?? false;
}

const CHECK_TIENDA = "wallet_tienda_movimiento_tipo_categoria_check";
const CHECK_MENSAJERO = "pago_mensajero_movimiento_tipo_categoria_check";

const ramasTienda = ramasDelCheck(upSql, CHECK_TIENDA);
const ramasMensajero = ramasDelCheck(upSql, CHECK_MENSAJERO);

describe("UP — el pago como documento propio (liquidacion_pago)", () => {
  it("crea la tabla del pago con monto DECIMAL(12,2) y sin updated_at/deleted_at", () => {
    expect(upSql).toMatch(/CREATE TABLE "liquidacion_pago"/);
    expect(upSql).toMatch(/"monto" DECIMAL\(12,2\) NOT NULL/);
    // R11: el monto es dinero POSITIVO; el signo lo da la categoria del movimiento.
    expect(upSql).toMatch(
      /ADD CONSTRAINT "liquidacion_pago_monto_check"\s*\n?\s*CHECK \("monto" > 0\);/,
    );
    // R9: fecha REAL del pago (calendario) e instante de REGISTRO son dos columnas distintas.
    expect(upSql).toMatch(/"fecha_pago" DATE NOT NULL/);
    expect(upSql).toMatch(/"created_at" TIMESTAMP\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP/);
    // R7: un pago SIEMPRE lo registra alguien (a diferencia de los libros, donde es nullable).
    expect(upSql).toMatch(/"registrado_por" TEXT NOT NULL/);
    // R44: la barrera del doble pago es de DATOS, no una comprobacion previa.
    expect(upSql).toMatch(
      /CREATE UNIQUE INDEX "liquidacion_pago_clave_idempotencia_key" ON "liquidacion_pago"\("clave_idempotencia"\);/,
    );
    // R41: fila INMUTABLE, igual que los dos libros. En NINGUNA de las dos tablas nuevas.
    expect(upSql).not.toMatch(/"updated_at"/);
    expect(upSql).not.toMatch(/"deleted_at"/);
  });

  it("exige exactamente un beneficiario y el cierre solo cuando el beneficiario es un mensajero", () => {
    // XOR: ni cero beneficiarios (fila de nadie) ni dos (ambigua).
    expect(upSql).toMatch(
      /ADD CONSTRAINT "liquidacion_pago_beneficiario_check"\s*\n?\s*CHECK \(\("mensajero_id" IS NULL\) <> \("tienda_id" IS NULL\)\);/,
    );
    // R21: el cierre acompana al mensajero y SOLO a el (el pago a tienda no admite cierre).
    expect(upSql).toMatch(
      /ADD CONSTRAINT "liquidacion_pago_cierre_check"\s*\n?\s*CHECK \(\("mensajero_id" IS NULL\) = \("cierre_id" IS NULL\)\);/,
    );
    // Las dos FK del beneficiario apuntan a `usuario` (no a un id generico sin integridad).
    expect(upSql).toMatch(
      /"liquidacion_pago_mensajero_id_fkey" FOREIGN KEY \("mensajero_id"\) REFERENCES "usuario"\("id"\) ON DELETE RESTRICT/,
    );
    expect(upSql).toMatch(
      /"liquidacion_pago_tienda_id_fkey" FOREIGN KEY \("tienda_id"\) REFERENCES "usuario"\("id"\) ON DELETE RESTRICT/,
    );
    expect(upSql).toMatch(
      /"liquidacion_pago_cierre_id_fkey" FOREIGN KEY \("cierre_id"\) REFERENCES "cierre_dia"\("id"\) ON DELETE RESTRICT/,
    );
  });

  it("un pago solo se puede anular una vez", () => {
    expect(upSql).toMatch(/CREATE TABLE "liquidacion_anulacion"/);
    // R75: la restriccion es DE DATOS. Un segundo intento choca contra el indice, no contra un `if`.
    expect(upSql).toMatch(
      /CREATE UNIQUE INDEX "liquidacion_anulacion_pago_id_key" ON "liquidacion_anulacion"\("pago_id"\);/,
    );
    expect(upSql).toMatch(
      /"liquidacion_anulacion_pago_id_fkey" FOREIGN KEY \("pago_id"\) REFERENCES "liquidacion_pago"\("id"\) ON DELETE RESTRICT/,
    );
    // R72/R73: motivo obligatorio + actor e instante de la anulacion, junto al pago.
    expect(upSql).toMatch(/"motivo" TEXT NOT NULL/);
    expect(upSql).toMatch(/"anulado_por" TEXT NOT NULL/);
    expect(upSql).toMatch(
      /"liquidacion_anulacion_anulado_por_fkey" FOREIGN KEY \("anulado_por"\) REFERENCES "usuario"\("id"\) ON DELETE RESTRICT/,
    );
  });

  it("reutiliza el enum de metodo de pago existente y no crea ningun tipo nuevo", () => {
    // §2.1: ni un `CREATE TYPE` ni un valor nuevo en un enum existente. Es LA razon por la que
    // esta migracion no obliga a tocar ningun down.sql previo.
    expect(upSql).not.toMatch(/CREATE TYPE/i);
    expect(upSql).not.toMatch(/ALTER TYPE/i);
    expect(upSql).toMatch(/"metodo" "metodo_pago_value" NOT NULL/);
    // R8: el catalogo es EXACTAMENTE el del recaudo de una entrega (feature 36), sin declarar
    // uno propio. Si la 172 hubiera necesitado un cuarto metodo, habria que crear el valor en
    // el enum y con el la cascada de down.sql previos que este repo tiene como cicatriz.
    expect(valoresDelEnum("MetodoPagoValue")).toEqual(["efectivo", "SINPE", "transferencia"]);
  });

  it("habilita RLS sin politicas anon/authenticated en las dos tablas", () => {
    expect(upSql).toMatch(/ALTER TABLE "liquidacion_pago" ENABLE ROW LEVEL SECURITY;/);
    expect(upSql).toMatch(/ALTER TABLE "liquidacion_anulacion" ENABLE ROW LEVEL SECURITY;/);
    // R63: patron "solo service role" de wallet_tienda_movimiento / pago_mensajero_movimiento.
    expect(upSql).not.toMatch(/CREATE POLICY/i);
    expect(upSql).not.toMatch(/GRANT/i);
    expect(upSql).not.toMatch(/\banon\b/i);
    expect(upSql).not.toMatch(/\bauthenticated\b/i);
  });
});

describe("UP — CHECK tipo <-> categoria de los dos libros (condicion heredada del review de la 171)", () => {
  it("ata cada concepto del ledger de tienda a su unico tipo valido", () => {
    expect([...ramasTienda.keys()].sort()).toEqual(["credito", "debito"]);
    expect(ramasTienda.get("credito")).toEqual(["cod_recaudado", "ajuste_credito"]);
    expect(ramasTienda.get("debito")).toEqual([
      "flete",
      "flete_devolucion",
      "comision_cod",
      "iva_flete",
      "iva_flete_devolucion",
      "iva_comision_cod",
      "pago_tienda",
      "ajuste_debito",
    ]);
    // Exhaustivo sobre el enum REAL y ni un valor de mas (medido en produccion, T A.0: 10/10).
    const clasificadas = [...ramasTienda.values()].flat();
    expect([...clasificadas].sort()).toEqual(valoresDelEnum("WalletTiendaMovimientoCategoria").sort());
    // "unico tipo valido": ninguna categoria aparece en las dos ramas.
    expect(new Set(clasificadas).size).toBe(clasificadas.length);
    // Los dos tipos del enum quedan cubiertos.
    expect([...ramasTienda.keys()].sort()).toEqual(valoresDelEnum("WalletTiendaMovimientoTipo").sort());
    // El `ALTER TABLE` solo puede correr si el ledger ya existe: esta migracion va DESPUES.
    expect(path.basename(migrationDir) > path.basename(migrationDirFor("_wallet_tienda_movimiento"))).toBe(true);
  });

  it("ata cada concepto del libro del mensajero a su unico tipo valido", () => {
    expect([...ramasMensajero.keys()].sort()).toEqual(["devengo", "pago"]);
    expect(ramasMensajero.get("devengo")).toEqual(["pago_devengado", "ajuste_devengo"]);
    expect(ramasMensajero.get("pago")).toEqual(["pago_efectivo", "liquidacion", "ajuste_pago"]);
    // Exhaustivo sobre el enum REAL y ni un valor de mas (medido en produccion, T A.0: 5/5).
    const clasificadas = [...ramasMensajero.values()].flat();
    expect([...clasificadas].sort()).toEqual(
      valoresDelEnum("PagoMensajeroMovimientoCategoria").sort(),
    );
    expect(new Set(clasificadas).size).toBe(clasificadas.length);
    expect([...ramasMensajero.keys()].sort()).toEqual(
      valoresDelEnum("PagoMensajeroMovimientoTipo").sort(),
    );
    // El `ALTER TABLE` solo puede correr si el libro ya existe: esta migracion va DESPUES.
    expect(path.basename(migrationDir) > path.basename(migrationDirFor("_pago_mensajero_movimiento"))).toBe(true);
  });

  it("un concepto que la restriccion no clasifica no casa ninguna rama", () => {
    // R60 — la forma importa: DISYUNCION DE LISTAS CERRADAS, sin ninguna negacion. Un CHECK
    // escrito como `NOT (...)` aceptaria por defecto lo que no supiera clasificar.
    for (const constraint of [CHECK_TIENDA, CHECK_MENSAJERO]) {
      const sentencia = sentenciaDelCheck(upSql, constraint);
      expect(sentencia).not.toMatch(/\bNOT\b/);
      expect(sentencia).not.toMatch(/<>/);
      expect(sentencia).not.toMatch(/\bNOT IN\b/);
    }
    // Un concepto futuro que nadie clasifique: NINGUNA rama lo acepta, en ningun tipo.
    const futura = "concepto_futuro_sin_clasificar";
    for (const tipo of ["credito", "debito"]) {
      expect(aceptaElCheck(ramasTienda, tipo, futura)).toBe(false);
    }
    for (const tipo of ["devengo", "pago"]) {
      expect(aceptaElCheck(ramasMensajero, tipo, futura)).toBe(false);
    }
    // Y un tipo futuro tampoco arrastra categorias validas.
    expect(aceptaElCheck(ramasTienda, "tipo_futuro", "cod_recaudado")).toBe(false);
    expect(aceptaElCheck(ramasMensajero, "tipo_futuro", "liquidacion")).toBe(false);
    // El hueco EXACTO que el review de la 171 senalo: `pago_tienda` con tipo `credito` haria
    // que la tabla de saldos y el desglose mostraran cifras distintas para la misma tienda.
    expect(aceptaElCheck(ramasTienda, "credito", "pago_tienda")).toBe(false);
    expect(aceptaElCheck(ramasTienda, "debito", "cod_recaudado")).toBe(false);
    expect(aceptaElCheck(ramasMensajero, "devengo", "liquidacion")).toBe(false);
    expect(aceptaElCheck(ramasMensajero, "pago", "pago_devengado")).toBe(false);
  });

  it("las categorias de ajuste que usa la anulacion son validas en su tipo", () => {
    // R69/§6.2: el contraasiento de un pago a tienda es credito/ajuste_credito y el de una
    // liquidacion a mensajero es devengo/ajuste_devengo. Si el CHECK no los dejara pasar, la
    // anulacion seria imposible: el CHECK y la anulacion se disenaron juntos.
    expect(aceptaElCheck(ramasTienda, "credito", "ajuste_credito")).toBe(true);
    expect(aceptaElCheck(ramasMensajero, "devengo", "ajuste_devengo")).toBe(true);
    // Y el pago original, con su signo (el que la anulacion revierte).
    expect(aceptaElCheck(ramasTienda, "debito", "pago_tienda")).toBe(true);
    expect(aceptaElCheck(ramasMensajero, "pago", "liquidacion")).toBe(true);
    // El signo contrario de cada ajuste NO vale en ese tipo.
    expect(aceptaElCheck(ramasTienda, "credito", "ajuste_debito")).toBe(false);
    expect(aceptaElCheck(ramasMensajero, "devengo", "ajuste_pago")).toBe(false);
  });

  it("no anade la restriccion a la caja principal", () => {
    // R62 [P8]: la caja tiene el mismo hueco y cuatro escritores, pero la 172 no la escribe.
    // Un `ADD CONSTRAINT ... CHECK` valida las filas existentes al aplicarse: anadirselo seria
    // importar riesgo de despliegue sin contrapartida. Queda anotado para la 173.
    expect(upSql).not.toMatch(/"wallet_movimiento"/);
    expect(downSql).not.toMatch(/"wallet_movimiento"/);
    expect(upSql).not.toMatch(/wallet_movimiento_tipo_categoria_check/);
    // Exactamente DOS CHECK de tipo<->categoria en toda la migracion: los dos libros y ninguno mas.
    expect(upSql.match(/_tipo_categoria_check/g) ?? []).toHaveLength(2);
  });
});

describe("DOWN — reversible y sin tocar enums", () => {
  it("el down revierte las dos tablas y los dos CHECK, y no toca ningun enum", () => {
    const iAnulacion = downSql.indexOf('DROP TABLE IF EXISTS "liquidacion_anulacion";');
    const iPago = downSql.indexOf('DROP TABLE IF EXISTS "liquidacion_pago";');
    expect(iAnulacion).toBeGreaterThanOrEqual(0);
    expect(iPago).toBeGreaterThan(iAnulacion); // orden inverso: la FK manda.

    expect(downSql).toMatch(
      /ALTER TABLE "wallet_tienda_movimiento" DROP CONSTRAINT IF EXISTS "wallet_tienda_movimiento_tipo_categoria_check";/,
    );
    expect(downSql).toMatch(
      /ALTER TABLE "pago_mensajero_movimiento" DROP CONSTRAINT IF EXISTS "pago_mensajero_movimiento_tipo_categoria_check";/,
    );

    // R64: la migracion no creo ningun tipo, asi que el down no borra ni recrea ninguno. Es lo
    // que evita la cascada de "enum nuevo => actualizar los down.sql previos".
    expect(downSql).not.toMatch(/DROP TYPE/i);
    expect(downSql).not.toMatch(/CREATE TYPE/i);
    expect(downSql).not.toMatch(/ALTER TYPE/i);
    // Aditiva: el down no reescribe ni una fila de los libros.
    expect(downSql).not.toMatch(/\bUPDATE\b/i);
    expect(downSql).not.toMatch(/\bDELETE\b/i);
  });
});
