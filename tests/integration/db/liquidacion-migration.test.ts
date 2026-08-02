import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Feature 172 / T A.2 — cobertura ESTATICA de la migracion `*_liquidacion_pago` (molde
// `wallet-tienda-migration.test.ts`: lee migration.sql/down.sql y afirma sobre el SQL; NO
// requiere Postgres). El round-trip up->down->up y el RECHAZO REAL de una fila incoherente son
// verificacion manual del implementer (T H.3), pegada en `progress/impl_172-liquidacion.md`.
//
// Cubre R58 (CHECK del ledger de tienda), R59 (CHECK del libro del mensajero), R60 (falla
// cerrado: un concepto sin clasificar no casa ninguna rama), R61 (los dos CHECK VALIDAN las
// filas existentes: ninguno lleva `NOT VALID` — ver nota abajo), R62 (la caja principal NO
// recibe el CHECK, [P8]), R63 (RLS sin policies en las dos tablas nuevas), R64 (down reversible
// en orden inverso, sin tocar enums) y R75 (UNIQUE de `pago_id`: un pago se anula UNA vez).
//
// R61 tiene DOS mitades y este archivo cubre UNA. La que vive en el repo —«la restriccion NO
// DEBE poder anadirse si algun dato existente la incumple»— es una propiedad del SQL y se
// afirma aqui. La otra —«su aplicacion DEBE verificarse contra CADA base antes de desplegar»—
// esta hecha contra produccion (T A.0, evidencia en `progress/impl_172-liquidacion.md`) y
// **ABIERTA contra preview**: ningun test del repo puede cerrarla.
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

/** El SQL sin comentarios: la prosa que EXPLICA `NOT VALID` no es `NOT VALID` ejecutable. */
function sinComentarios(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
}

/**
 * `NOT VALID` tal y como Postgres lo acepta de verdad: sin distinguir mayusculas y con
 * CUALQUIER espacio en medio, saltos de linea incluidos. Un `toContain("NOT VALID")` daria
 * verde ante `not valid` o ante un `NOT\nVALID`, que es justo el caso a impedir.
 */
const RE_NOT_VALID = /\bNOT\s+VALID\b/i;

/**
 * La sentencia COMPLETA `ALTER TABLE ... ADD CONSTRAINT <nombre> CHECK (...);` — de `;` a `;`,
 * sobre el SQL sin comentarios.
 *
 * Termina en el `;` de la SENTENCIA y no en el primer `);`, que es como se leia antes. La regla
 * vieja daba por hecho que la sentencia acaba donde acaba el parentesis del CHECK, y eso es
 * exactamente lo que `NOT VALID` rompe: va DESPUES de ese parentesis. Con la regla vieja,
 * anadir `NOT VALID` al ULTIMO CHECK del fichero dejaba a este helper sin `);` que encontrar y
 * reventaba el modulo al importarlo — CERO tests corridos y un mensaje que no nombra la causa.
 * De `;` a `;` el SQL se sigue parseando y el fallo lo da el caso que toca decirlo.
 */
function sentenciaDelCheck(sql: string, constraint: string): string {
  const limpio = sinComentarios(sql);
  const ancla = limpio.indexOf(`ADD CONSTRAINT "${constraint}"`);
  if (ancla < 0) throw new Error(`La migracion no anade el CHECK ${constraint}`);
  const fin = limpio.indexOf(";", ancla);
  if (fin < 0) throw new Error(`La sentencia del CHECK ${constraint} no termina en ';'`);
  return limpio.slice(limpio.lastIndexOf(";", ancla) + 1, fin + 1).trim();
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

  it("los dos CHECK VALIDAN las filas existentes: ninguno se anade con NOT VALID", () => {
    // R61 (primera mitad, la que vive en el repo). `ADD CONSTRAINT ... CHECK` recorre la tabla
    // al aplicarse: si hubiera UNA fila incoherente, la migracion FALLA. Esa propiedad es lo
    // que la feature compro con la verificacion previa contra produccion (T A.0) y es la razon
    // de que el despliegue sea seguro, no un acto de fe.
    //
    // Con `NOT VALID`, la restriccion se anadiria aceptando el pasado incoherente: se quedaria
    // el NOMBRE del CHECK y se perderia la PROPIEDAD, sin que nadie se entere. Es una linea
    // que alguien puede anadir de buena fe «para que el deploy no falle», y es exactamente lo
    // que R61 prohibe. Este caso es lo unico que hoy lo impide.
    //
    // NO se acepta tampoco el rodeo `NOT VALID` + `VALIDATE CONSTRAINT`: valida, si, pero es
    // otra forma de migracion (la restriccion existe un rato sin validar) y cambiarla a eso
    // debe VERSE. Quien la necesite tendra que tocar este test, que es el objetivo.
    const librosConCheck: ReadonlyArray<readonly [string, string]> = [
      [CHECK_TIENDA, "wallet_tienda_movimiento"],
      [CHECK_MENSAJERO, "pago_mensajero_movimiento"],
    ];
    // La lista es EXHAUSTIVA sobre la migracion, no una eleccion de dos: si manana entrara un
    // tercer libro con su CHECK, este caso se entera en vez de seguir mirando solo estos dos.
    expect(
      sinComentarios(upSql).match(/ADD CONSTRAINT "[a-z_]*_tipo_categoria_check"/g) ?? [],
    ).toHaveLength(librosConCheck.length);

    for (const [constraint, tabla] of librosConCheck) {
      const sentencia = sentenciaDelCheck(upSql, constraint);
      // Primero: que lo mirado sea la sentencia entera del libro que toca. Si el recorte se
      // quedara corto, el `NOT VALID` podria caer fuera y el test daria un verde falso.
      expect(sentencia.startsWith(`ALTER TABLE "${tabla}" ADD CONSTRAINT "${constraint}"`)).toBe(
        true,
      );
      expect(sentencia.endsWith(";")).toBe(true);
      expect(sentencia).toMatch(/\bCHECK\s*\(/i);
      // Y el corazon del caso.
      expect(RE_NOT_VALID.test(sentencia)).toBe(false);
      expect(sentencia).not.toMatch(/\bVALIDATE\s+CONSTRAINT\b/i);
    }

    // Red secundaria: ni una aparicion en TODO el SQL EJECUTABLE de la migracion (comentarios
    // fuera: la cabecera nombra `NOT VALID` en prosa, justo para explicar por que no esta).
    expect(RE_NOT_VALID.test(sinComentarios(upSql))).toBe(false);
  });

  it("el detector de NOT VALID no se deja enganar por mayusculas, espacios ni saltos de linea", () => {
    // Contraprueba del caso de arriba: sin esto, un `RE_NOT_VALID` roto lo dejaria en verde
    // para siempre y nadie lo notaria. Cada variante es SQL que Postgres acepta igual.
    const variantes = [
      'ALTER TABLE "t" ADD CONSTRAINT "c" CHECK (x) NOT VALID;',
      'ALTER TABLE "t" ADD CONSTRAINT "c" CHECK (x) not valid;',
      'ALTER TABLE "t" ADD CONSTRAINT "c" CHECK (x) Not Valid;',
      'ALTER TABLE "t" ADD CONSTRAINT "c" CHECK (x) NOT   VALID;',
      'ALTER TABLE "t" ADD CONSTRAINT "c" CHECK (x) NOT\tVALID;',
      'ALTER TABLE "t" ADD CONSTRAINT "c" CHECK (\n  x\n)\nNOT\nVALID;',
    ];
    for (const sql of variantes) {
      expect(RE_NOT_VALID.test(sql)).toBe(true);
    }
    // Y no salta con lo que solo se le parece (si saltara, el test de arriba seria inutil por
    // ruidoso y alguien acabaria relajandolo).
    const inocentes = [
      'ALTER TABLE "t" ADD CONSTRAINT "c" CHECK ("monto" > 0);',
      '"categoria" IS NOT NULL',
      "-- el estado NOT VALIDO no existe",
      'CHECK ("tipo" = \'validado\')',
    ];
    for (const sql of inocentes) {
      expect(RE_NOT_VALID.test(sql)).toBe(false);
    }
    // El recorte tambien se mide: la sentencia real llega hasta su `;`, no hasta el primer `)`
    // interno (donde `NOT VALID` ya no se veria). Estas dos aserciones se cumplen HAYA O NO
    // `NOT VALID`, a proposito: este caso es el control del detector y debe seguir en verde
    // cuando el de arriba caiga, o no seria un control.
    const sentencia = sentenciaDelCheck(upSql, CHECK_TIENDA);
    expect(sentencia).toMatch(/;$/);
    expect(sentencia).toContain("'ajuste_debito'"); // pasa de largo del primer `)` interno.
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
