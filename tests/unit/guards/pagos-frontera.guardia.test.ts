import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

import { codigoSinComentarios } from "../../fixtures/money-safe";

/**
 * Feature 212 / T16 (R32, R33) — GUARDIA DE FRONTERA: **el desglose del recaudo se queda dentro
 * del cierre. Ni la caja, ni el ledger por tienda, ni la analítica, ni la liquidación se enteran
 * de que existe una tabla nueva.**
 *
 * R33 no es una lista de archivos que «no se tocaron»: es una propiedad DURADERA. Un test de diff
 * daría vacío —y por tanto verde— el día después del merge, para siempre. Lo que se afirma aquí
 * es que ninguno de esos módulos NOMBRA `gestion_orden_pago`, hoy ni dentro de tres features. Y
 * cada afirmación de ausencia lleva su CONTROL DE NO-VACUIDAD: una ausencia solo prueba algo si
 * el archivo existe, tiene contenido y es el que se cree que es.
 *
 * Por qué cada uno es inmune (design §6):
 *
 *  - `CajaCodFeedService` lee el LEDGER, no las gestiones, por diseño explícito: recalcular el
 *    importe desde el recaudo crearía dos fórmulas para el mismo dinero.
 *  - `WalletTiendaFeedService` proyecta de la gestión SOLO el total (`montoRecibido`); el método
 *    nunca le hizo falta y el desglose tampoco.
 *  - `RecaudoAnaliticaRepository` / `AnaliticaFinancieraService` leen los tres `cierre_dia.total_*`;
 *    bajar a `gestion_orden` les está PROHIBIDO y hay guardias anteriores que lo atornillan.
 *  - `AnaliticaOperativaRollupRepository`: el método de pago no existe en el rollup.
 *  - `descripcion-pago.ts` y todo `LiquidacionPago` son OTRO dominio [D1]: el pago AL MENSAJERO
 *    y A LA TIENDA, no el recaudo AL CLIENTE.
 *
 * R32 se mide sobre el esquema: los totales por método siguen siendo TRES columnas. Lo que esta
 * feature cambia es CÓMO se llenan, y ni una sola columna de dónde se guardan.
 */

const RAIZ = path.resolve(__dirname, "../../..");

/** Las tres formas de nombrar la tabla nueva: el delegado, la tabla y el modelo. */
const NOMBRES_DEL_DESGLOSE = ["gestionOrdenPago", "gestion_orden_pago", "GestionOrdenPago"];

/**
 * Los módulos que R33 declara inmunes, con el ancla que prueba que se está leyendo el archivo
 * correcto (y no uno vacío, movido o renombrado).
 */
const MODULOS_INMUNES: { ruta: string; ancla: string }[] = [
  { ruta: "lib/services/CajaCodFeedService.ts", ancla: "construirIngresoCod" },
  { ruta: "lib/services/WalletTiendaFeedService.ts", ancla: "construirMovimientosPorTienda" },
  { ruta: "lib/repositories/RecaudoAnaliticaRepository.ts", ancla: "porMetodoDeCierresResueltos" },
  { ruta: "lib/services/AnaliticaFinancieraService.ts", ancla: "AnaliticaFinancieraService" },
  {
    ruta: "lib/repositories/AnaliticaOperativaRollupRepository.ts",
    ancla: "AnaliticaOperativaRollupRepository",
  },
  { ruta: "lib/utils/descripcion-pago.ts", ancla: "descripcionDePago" },
];

/** Todos los `.ts`/`.tsx` de una carpeta del repo, recursivamente. */
function fuentesDe(carpeta: string): string[] {
  const abs = path.join(RAIZ, carpeta);
  const salida: string[] = [];
  for (const entrada of readdirSync(abs)) {
    const rel = `${carpeta}/${entrada}`;
    if (statSync(path.join(RAIZ, rel)).isDirectory()) salida.push(...fuentesDe(rel));
    else if (entrada.endsWith(".ts") || entrada.endsWith(".tsx")) salida.push(rel);
  }
  return salida;
}

const FUENTES_DE_LIB = fuentesDe("lib");

/**
 * Los caminos de `LiquidacionPago` [D1]. NO se escriben a mano: se descubren del árbol, así que
 * un archivo nuevo de ese dominio entra solo en el barrido en vez de quedarse fuera en silencio
 * —que es exactamente cómo envejece un censo declarado—.
 */
const CAMINOS_DE_LIQUIDACION_PAGO = FUENTES_DE_LIB.filter((ruta) =>
  codigoSinComentarios(ruta).includes("LiquidacionPago"),
);

describe("R33 — los módulos inmunes no nombran la tabla del desglose", () => {
  it("CONTROL DE NO-VACUIDAD: los seis existen vivos y son los que dicen ser", () => {
    // Sin esto, los `not.toContain` de abajo pasarían igual sobre un archivo borrado o movido.
    for (const { ruta, ancla } of MODULOS_INMUNES) {
      const fuente = readFileSync(path.join(RAIZ, ruta), "utf8");
      expect(fuente.length, `${ruta} está vacío`).toBeGreaterThan(300);
      expect(fuente, `${ruta} ya no contiene \`${ancla}\``).toContain(ancla);
    }
  });

  for (const { ruta } of MODULOS_INMUNES) {
    it(`\`${ruta}\` no menciona el desglose del recaudo`, () => {
      const codigo = codigoSinComentarios(ruta);
      for (const nombre of NOMBRES_DEL_DESGLOSE) {
        expect(codigo, `${ruta} nombra ${nombre}`).not.toContain(nombre);
      }
    });
  }

  it("MEDIDO: el ledger por tienda sigue proyectando de la gestión SOLO el total", () => {
    // R33 dicho como estructura y no como ausencia: su `select` de `gestion_orden` es
    // exactamente `{ordenId, resultado, montoRecibido}`. Añadirle `pagos` —o `metodoPago`—
    // partiría el crédito de la tienda por método, que es una cifra que a la tienda no le
    // corresponde y que nadie pidió.
    const codigo = codigoSinComentarios("lib/services/WalletTiendaFeedService.ts");
    const selects = [...codigo.matchAll(/gestionOrden\.findMany\(\{[\s\S]*?\}\)/g)];

    expect(selects, "el feed ya no consulta `gestionOrden`").toHaveLength(1);
    expect(selects[0][0]).toContain(
      "select: { ordenId: true, resultado: true, montoRecibido: true }",
    );
    expect(selects[0][0]).not.toContain("metodoPago");
    expect(selects[0][0]).not.toContain("pagos");
  });

  it("MEDIDO: el repositorio del COD analítico sigue acotado a sus DOS tablas legales", () => {
    // Su cliente Prisma es un `Pick` de dos tablas. El desglose vive en una tercera, así que
    // mientras el `Pick` sea éste no hay por dónde alcanzarlo — y si alguien lo ampliara, esto
    // nombra la ampliación antes de que llegue a producción.
    const codigo = codigoSinComentarios("lib/repositories/RecaudoAnaliticaRepository.ts");

    expect(codigo).toMatch(
      /Pick<PrismaClient,\s*"cierreDia"\s*\|\s*"walletTiendaMovimiento">/,
    );
    expect(codigo).not.toContain("gestionOrden");
  });

  it("ningún camino de `LiquidacionPago` nombra el desglose [D1]", () => {
    // Control de no-vacuidad: el censo se descubre del árbol, así que primero se comprueba que
    // encontró los caminos que se sabe que existen (repositorio, contrato y servicio).
    expect(CAMINOS_DE_LIQUIDACION_PAGO.length).toBeGreaterThan(4);
    for (const esperado of [
      "lib/repositories/LiquidacionPagoRepository.ts",
      "lib/interfaces/repositories/ILiquidacionPagoRepository.ts",
      "lib/services/LiquidacionService.ts",
    ]) {
      expect(CAMINOS_DE_LIQUIDACION_PAGO, `falta ${esperado} en el censo`).toContain(esperado);
    }

    const contaminados: string[] = [];
    for (const ruta of CAMINOS_DE_LIQUIDACION_PAGO) {
      const codigo = codigoSinComentarios(ruta);
      for (const nombre of NOMBRES_DEL_DESGLOSE) {
        if (codigo.includes(nombre)) contaminados.push(`${ruta}: ${nombre}`);
      }
    }
    expect(contaminados, "la liquidación (172) leyó el recaudo al cliente (212)").toEqual([]);
  });

  it("CIERRE: los ÚNICOS módulos de `lib/` que nombran el desglose son los del recaudo", () => {
    // La afirmación fuerte, y la que no envejece: en vez de vigilar una lista de inocentes, se
    // fija la lista de CULPABLES. Cualquier módulo nuevo que lea la tabla —de la analítica, del
    // wallet o de donde sea— aparece aquí por su nombre.
    const conDesglose = FUENTES_DE_LIB.filter((ruta) => {
      const codigo = codigoSinComentarios(ruta);
      return NOMBRES_DEL_DESGLOSE.some((n) => codigo.includes(n));
    });

    // El repositorio que INSERTA las líneas dentro de la transacción de la gestión, y nadie más.
    // Los tres caminos de LECTURA no nombran la tabla: llegan a ella por la relación `pagos` de
    // `gestion_orden`, que es una proyección y no un acceso directo.
    expect(conDesglose.sort()).toEqual(["lib/repositories/GestionOrdenRepository.ts"]);
  });

  it("CONTRAPRUEBA: el barrido caza una lectura del desglose inyectada en un inmune", () => {
    // Sin esto, todo lo anterior podría estar pasando por no mirar nada.
    const real = codigoSinComentarios("lib/services/WalletTiendaFeedService.ts");
    const mutado = `${real}\nconst fuga = await tx.gestionOrdenPago.findMany({});`;

    const caza = (fuente: string) => NOMBRES_DEL_DESGLOSE.filter((n) => fuente.includes(n));

    expect(caza(real)).toEqual([]);
    expect(caza(mutado)).toEqual(["gestionOrdenPago"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// R32 — los totales por método siguen siendo TRES columnas. Solo cambia CÓMO se llenan.
// ─────────────────────────────────────────────────────────────────────────────────────────────

const SCHEMA = readFileSync(path.join(RAIZ, "db/schema.prisma"), "utf8");

/** Los bloques `model X { … }` del schema, por nombre. */
function modelosDelSchema(): { nombre: string; cuerpo: string }[] {
  return [...SCHEMA.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)].map((m) => ({
    nombre: m[1],
    cuerpo: m[2],
  }));
}

/**
 * Los DOS modelos que snapshotean el recaudo por método.
 *
 * `requirements.md` los llama «`cierre_dia` y `cierre_maestro`». En el esquema real el segundo
 * NO existe con ese nombre: el agregado que el maestro aprueba es `cierre_bodega` (feature 40),
 * y es el único otro modelo del árbol con los tres `total_*`. Eso no se supone: lo comprueba el
 * censo de abajo, que recorre TODOS los modelos y exige que el conjunto sea exactamente éste.
 */
const MODELOS_CON_TOTALES = ["CierreDia", "CierreBodega"];

/** Las tres columnas del reparto por método, y ninguna más. */
const COLUMNAS_POR_METODO = ["total_efectivo", "total_simpe", "total_transferencia"];

describe("R32 — `total_efectivo` / `total_simpe` / `total_transferencia`: tres columnas, sin tocar", () => {
  it("el censo de modelos con totales por método está CERRADO", () => {
    const conTotales = modelosDelSchema()
      .filter((m) => m.cuerpo.includes("total_efectivo"))
      .map((m) => m.nombre);

    // Ni uno menos (nadie los borró) ni uno más (la 212 no creó un cuarto sitio donde vivan los
    // totales por método: los sigue habiendo donde los había).
    expect(conTotales.sort()).toEqual([...MODELOS_CON_TOTALES].sort());
  });

  for (const nombre of MODELOS_CON_TOTALES) {
    it(`\`${nombre}\` declara las TRES columnas, cada una \`Decimal(12,2)\``, () => {
      const modelo = modelosDelSchema().find((m) => m.nombre === nombre);
      expect(modelo, `el modelo ${nombre} no existe`).toBeDefined();
      const cuerpo = modelo!.cuerpo;

      for (const columna of COLUMNAS_POR_METODO) {
        expect(cuerpo, `${nombre} perdió ${columna}`).toMatch(
          new RegExp(`@map\\("${columna}"\\)\\s+@db\\.Decimal\\(12,\\s*2\\)`),
        );
      }
      // Y el total general, que es la suma de los tres.
      expect(cuerpo).toMatch(/@map\("total_general"\)\s+@db\.Decimal\(12,\s*2\)/);

      // Ni una columna de total por método DE MÁS: el error natural al partir un cobro sería
      // «añado una columna para el caso mixto». Esto lo caza.
      const porMetodo = [...cuerpo.matchAll(/@map\("(total_\w+)"\)/g)].map((m) => m[1]).sort();
      expect(porMetodo).toEqual(
        [
          ...COLUMNAS_POR_METODO,
          "total_general",
          "total_ingreso_bodega_rechazos",
          "total_pago_mensajero",
        ].sort(),
      );
    });
  }

  it("la migración de la 212 no altera NINGUNA tabla de cierre", () => {
    // R32 en el SQL: la migración es aditiva (crea una tabla nueva). Si tocara `cierre_dia`
    // —aunque fuera para «recalcular»— los snapshots ya cerrados dejarían de ser snapshots.
    const up = readFileSync(
      path.join(RAIZ, "db/migrations/20260812120000_gestion_orden_pago/migration.sql"),
      "utf8",
    );
    // Sin los comentarios `--`: este SQL EXPLICA por escrito que no toca `cierre_dia` /
    // `cierre_maestro` (R8), y un barrido literal fallaría por CITARLO.
    const sql = up.replace(/--[^\n]*/g, " ");

    for (const tabla of ["cierre_dia", "cierre_bodega", "cierre_maestro", "cierre_detail"]) {
      expect(sql, `la migración toca ${tabla}`).not.toMatch(
        new RegExp(`(ALTER|DROP|UPDATE)[\\s\\S]{0,40}"${tabla}"`, "i"),
      );
    }
    expect(sql).not.toContain("total_efectivo");

    // Control de no-vacuidad: el SQL leído SÍ es el de la 212 y SÍ hace algo.
    expect(sql).toContain('CREATE TABLE "gestion_orden_pago"');
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
  });
});
