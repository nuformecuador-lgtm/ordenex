import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { WalletMovimientoRepository } from "@/lib/repositories/WalletMovimientoRepository";
import { WalletMensajeroFeedService } from "@/lib/services/WalletMensajeroFeedService";
import type { WalletMensajeroFeedTxClient } from "@/lib/interfaces/services/IWalletMensajeroFeedService";
import { derivarIngresoOrden } from "@/lib/utils/ingreso-ordenex";
import { pagoPorResultado } from "@/lib/utils/pago-mensajero";
import { calcularSplitPago } from "@/lib/utils/cuenta-por-pagar";
import { codigoSinComentarios } from "../../fixtures/money-safe";

/**
 * Feature 173 / T C.5 (R31, R33) — GUARDIA DE ALCANCE: **los otros dos libros no ganan filas, y
 * las dos cifras de la caja no pueden leerlos.**
 *
 * El riesgo que este archivo persigue es el doble conteo, y tiene dos caras:
 *
 *  - **Escribir de mas** (R31). El dinero que la 173 mueve ya esta contado en el ledger por
 *    tienda (el debito `pago_tienda` de la 172) y en el libro del mensajero. Si la feature
 *    añadiera una fila mas alli, el saldo a favor de la tienda bajaria DOS veces por el mismo
 *    pago y nadie lo notaria hasta que una tienda reclamara.
 *  - **Leer de mas** (R33). Si el repositorio que sirve «dinero en caja» y «ganancia» pudiera
 *    consultar los otros dos libros, existiria una segunda fuente para un numero de dinero, que
 *    es exactamente lo que `AnaliticaFinancieraService` prohibe por escrito: «no da un error, da
 *    una discusion».
 *
 * Las dos se miden sobre el ARBOL, no sobre una llamada concreta: un test de comportamiento solo
 * dice que ESE camino no escribio de mas; un censo dice que no hay ningun otro camino.
 *
 * `T H.2` amplia este archivo con el resto de la revision de alcance (R66-R68).
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * Feature 173 / T H.2 (R66, R67, R68) — LA REVISION DE ALCANCE.
 *
 * Las tres son afirmaciones de AUSENCIA, y una ausencia solo prueba algo si lo ausente
 * EXISTE. Es la leccion de `T G.4` («47 archivos protegidos vivos en el arbol, cero en el
 * diff»): sin ese control, un `grep` mal escrito da la misma salida vacia que un alcance
 * respetado. Por eso cada bloque de aqui abajo lleva su CONTROL DE NO-VACUIDAD explicito.
 *
 * Y por que el censo va sobre el ARBOL y no sobre `git diff`: un test que preguntara a git
 * por `origin/dev...HEAD` daria VACIO —y por tanto verde— el dia despues del merge, para
 * siempre. Seria una guardia que se apaga sola justo cuando empieza a hacer falta. La
 * medicion del diff, que es punto-en-el-tiempo, va en `progress/impl_173-caja-tesoreria.md`
 * (§H2.4) con su control contra `git ls-files`; lo que vive aqui es la propiedad DURADERA.
 *
 * Y donde se puede, la ausencia se sustituye por una MEDICION: R66 y R68 no dicen «ese
 * archivo no se toco», dicen «este importe sigue siendo este», ejecutando la formula. Un
 * hash del archivo se rompe con un comentario y sobrevive a un cambio de constante; un
 * importe pinchado hace exactamente lo contrario.
 */

const RAIZ = path.resolve(__dirname, "../../..");

/** Las escrituras de Prisma. `create` incluido: el censo persigue TODA forma de insertar. */
const ESCRITURAS = ["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"];

/**
 * Los DOS libros que esta feature NO toca. Se nombran por su delegado de Prisma, que es como
 * aparecen en el codigo; el nombre de la tabla va al lado para que el fallo se lea sin traducir.
 */
const LIBROS_AJENOS: { delegado: string; tabla: string; escritor: string }[] = [
  {
    delegado: "walletTiendaMovimiento",
    tabla: "wallet_tienda_movimiento",
    escritor: "lib/repositories/WalletTiendaMovimientoRepository.ts",
  },
  {
    delegado: "pagoMensajeroMovimiento",
    tabla: "pago_mensajero_movimiento",
    escritor: "lib/repositories/PagoMensajeroMovimientoRepository.ts",
  },
];

/** Todos los `.ts` de una carpeta del repo, recursivamente. */
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

const FUENTES = [...fuentesDe("lib"), ...fuentesDe("scripts")];

describe("R31 — ninguna escritura NUEVA en el ledger por tienda ni en el libro del mensajero", () => {
  for (const libro of LIBROS_AJENOS) {
    it(`el unico modulo del arbol que escribe en \`${libro.tabla}\` sigue siendo su repositorio`, () => {
      const escritores = FUENTES.filter((ruta) => {
        const codigo = codigoSinComentarios(ruta);
        return ESCRITURAS.some((m) =>
          new RegExp(`${libro.delegado}\\.${m}\\s*\\(`).test(codigo),
        );
      });

      // Uno, y exactamente uno. Si la 173 —o cualquier feature futura— abriera un segundo camino
      // de escritura, este censo lo nombra en el mensaje del fallo.
      expect(escritores).toEqual([libro.escritor]);
    });
  }

  it("los tres modulos NUEVOS de la 173 no escriben en ningun libro que no sea la caja", () => {
    const nuevos = [
      "lib/services/CajaCodFeedService.ts",
      "lib/services/CajaPagoTiendaFeedService.ts",
      "lib/utils/caja-tesoreria.ts",
    ];

    for (const ruta of nuevos) {
      const codigo = codigoSinComentarios(ruta);
      for (const libro of LIBROS_AJENOS) {
        for (const metodo of ESCRITURAS) {
          expect(codigo, `${ruta} escribe en ${libro.tabla}`).not.toMatch(
            new RegExp(`${libro.delegado}\\.${metodo}\\s*\\(`),
          );
        }
      }
    }
  });

  it("el feed del contra-entrega solo LEE el ledger por tienda (`findMany`), nunca escribe", () => {
    const codigo = codigoSinComentarios("lib/services/CajaCodFeedService.ts");

    // Es el unico modulo de la 173 que toca el ledger, y lo toca de una sola forma.
    const usos = [...codigo.matchAll(/walletTiendaMovimiento\.(\w+)/g)].map((m) => m[1]);
    expect(usos).toEqual(["findMany"]);
  });
});

describe("R33 — el repositorio que sirve las dos cifras NO puede leer los otros libros", () => {
  it("su cliente Prisma es MINIMO: `walletMovimiento` y nada mas (comprobado compilando)", () => {
    // Este objeto tiene UNA sola tabla. Que la linea de abajo compile es la prueba: si el
    // repositorio necesitara `walletTiendaMovimiento` o `pagoMensajeroMovimiento`, `tsc` la
    // rechazaria y el gate caeria antes que este test.
    const clienteDeUnaSolaTabla = {
      walletMovimiento: {} as PrismaClient["walletMovimiento"],
    };
    const repo = new WalletMovimientoRepository(clienteDeUnaSolaTabla);

    expect(repo).toBeInstanceOf(WalletMovimientoRepository);
  });

  it("y su fuente lo declara asi, sin nombrar ninguna otra tabla de dinero", () => {
    const codigo = codigoSinComentarios("lib/repositories/WalletMovimientoRepository.ts");

    expect(codigo).toMatch(/Pick<PrismaClient,\s*"walletMovimiento">/);
    for (const ajena of ["walletTiendaMovimiento", "pagoMensajeroMovimiento", "gestionOrden", "cierreDia"]) {
      expect(codigo, `WalletMovimientoRepository nombra ${ajena}`).not.toContain(ajena);
    }
  });

  it("la derivacion de las dos cifras es PURA: no conoce ningun cliente ni ningun repositorio", () => {
    const codigo = codigoSinComentarios("lib/utils/caja-tesoreria.ts");

    for (const prohibido of ["PrismaClient", "Repository", "findMany", "groupBy", "await"]) {
      expect(codigo, `caja-tesoreria.ts nombra ${prohibido}`).not.toContain(prohibido);
    }
  });

  it("el puerto de la liquidacion tambien esta acotado a la caja", () => {
    const contrato = codigoSinComentarios("lib/interfaces/services/ICajaPagoTiendaFeedService.ts");

    expect(contrato).toMatch(/Pick<PrismaClient,\s*"walletMovimiento">/);
    for (const libro of LIBROS_AJENOS) {
      expect(contrato, `el puerto alcanza ${libro.tabla}`).not.toContain(libro.delegado);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// T H.2 (R66, R67, R68) — LA REVISION DE ALCANCE
// ═══════════════════════════════════════════════════════════════════════════════════════════

/**
 * Los CUATRO modulos de la 173 que escriben o derivan dinero, mas sus tres contratos y su
 * ejecutable. Es la lista contra la que se barren las formulas ajenas (R68).
 *
 * La lista es declarada, asi que puede quedarse corta: el ultimo `it` del bloque R68 la CIERRA
 * contra el arbol —toda fuente de `lib/` o `scripts/` que nombre una de las dos categorias
 * nuevas tiene que estar aqui o en `CATALOGOS_PREEXISTENTES`—. Una feature futura que abra un
 * quinto modulo de la caja no puede olvidarse de anadirlo: el censo la nombra.
 */
const MODULOS_DE_LA_173 = [
  "lib/utils/caja-tesoreria.ts",
  "lib/services/CajaCodFeedService.ts",
  "lib/services/CajaPagoTiendaFeedService.ts",
  "lib/services/CajaBackfillTesoreriaService.ts",
  "lib/interfaces/services/ICajaCodFeedService.ts",
  "lib/interfaces/services/ICajaPagoTiendaFeedService.ts",
  "lib/interfaces/services/ICajaBackfillTesoreriaService.ts",
  "scripts/backfill-caja-tesoreria.ts",
];

/** Modulos ANTERIORES a la 173 que nombran las categorias nuevas por ser catalogos. */
const CATALOGOS_PREEXISTENTES = ["lib/types/wallet.ts", "lib/analytics/metrics.ts"];

// ─────────────────────────────────────────────────────────────────────────────────────────
// R66 — el pago al mensajero entra en la caja EXACTAMENTE como antes. `[P2]` = (a).
// ─────────────────────────────────────────────────────────────────────────────────────────

/** Los dos archivos que la respuesta `[P2] = (a)` protege, literalmente, de ser editados. */
const ARCHIVOS_DEL_FEED_DEL_MENSAJERO = [
  "lib/services/WalletMensajeroFeedService.ts",
  "tests/unit/services/wallet-mensajero-feed-service.test.ts",
];

describe("R66 [P2]=(a) — el pago al mensajero se carga en la caja como siempre", () => {
  it("CONTROL DE NO-VACUIDAD: los dos archivos del feed del mensajero existen vivos y con contenido", () => {
    // Sin esto, todo lo de abajo podria estar afirmando cosas sobre archivos borrados.
    for (const ruta of ARCHIVOS_DEL_FEED_DEL_MENSAJERO) {
      const fuente = readFileSync(path.join(RAIZ, ruta), "utf8");
      expect(fuente.length, `${ruta} esta vacio`).toBeGreaterThan(500);
    }
    // Y la suite protegida sigue siendo la suite de ESTO: nombra al servicio y a su egreso.
    const suite = readFileSync(path.join(RAIZ, ARCHIVOS_DEL_FEED_DEL_MENSAJERO[1]), "utf8");
    expect(suite).toContain("WalletMensajeroFeedService");
    expect(suite).toContain("egreso_pago_mensajero");
  });

  it("MEDIDO: el egreso de la caja sigue siendo el COSTO TOTAL `P`, no `min(P, E)`", async () => {
    // `P` y `E` distintos A PROPOSITO (15 000 debidos, 9 000 de efectivo en mano): si fueran
    // iguales, la asercion pasaria igual con las dos reglas y no distinguiria nada. Es la
    // MISMA razon por la que `T C.4` sembro un libro con las dos cifras separadas.
    const P = "15000.00";
    const E = "9000.00";
    const tx = {
      cierreDia: {
        findUnique: async () => ({
          mensajeroId: "m-1",
          totalPagoMensajero: new Prisma.Decimal(P),
          totalEfectivo: new Prisma.Decimal(E),
        }),
      },
    } as unknown as WalletMensajeroFeedTxClient;

    const { libro, egresoCaja } = await new WalletMensajeroFeedService().construirMovimientosDePago(
      "c-1",
      tx,
    );

    // La caja: UN egreso, por P entero. Mover esto a `min(P, E)` —la opcion (b) de `[P2]`, la
    // que el humano descarto— pone rojo aqui con el delta de 6 000 a la vista.
    expect(egresoCaja).toHaveLength(1);
    expect(egresoCaja[0].categoria).toBe("egreso_pago_mensajero");
    expect(egresoCaja[0].monto).toBe(P);
    expect(egresoCaja[0].monto).not.toBe(E);
    expect(egresoCaja[0].origenTipo).toBe("cierre_dia"); // el «cuando»: al aprobar el cierre
    expect(egresoCaja[0].origenId).toBe("c-1");
    // Y el libro por mensajero tampoco se movio: devengo = P, pago = min(P, E).
    expect(libro.map((f) => [f.categoria, f.monto])).toEqual([
      ["pago_devengado", P],
      ["pago_efectivo", E],
    ]);
  });

  it("la fuente del feed del mensajero no sabe nada de la 173", () => {
    const codigo = codigoSinComentarios(ARCHIVOS_DEL_FEED_DEL_MENSAJERO[0]);

    // Ni las categorias nuevas, ni la derivacion de las dos cifras, ni el puerto de la tienda.
    for (const ajeno of [
      "ingreso_cod_recaudado",
      "ingreso_reverso_pago_tienda",
      "egreso_pago_tienda",
      "caja-tesoreria",
      "derivarCaja",
      "CajaPagoTiendaFeedService",
    ]) {
      expect(codigo, `WalletMensajeroFeedService nombra ${ajeno}`).not.toContain(ajeno);
    }
    // Y sigue tomando `min(P, E)` de su fuente unica, no de una copia propia.
    expect(codigo).toContain("calcularSplitPago");
  });

  it("el egreso del mensajero se emite en el CIERRE y no en la liquidacion (el «cuando» de R66)", () => {
    // La 173 le dio al servicio de liquidacion una puerta a la caja (T C.2/T C.3). R66 exige
    // que esa puerta NO se haya usado tambien para adelantar o repetir el pago al mensajero.
    const liquidacion = codigoSinComentarios("lib/services/LiquidacionService.ts");
    expect(liquidacion).not.toContain("egreso_pago_mensajero");

    // Control de no-vacuidad del `not`: ese mismo archivo SI nombra el camino de la tienda,
    // que es lo que la 173 le anadio. Si el barrido leyera un archivo equivocado, caeria aqui.
    expect(liquidacion).toContain("registrarPagoTienda");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// R67 — ni arqueo, ni corte de caja, ni conciliacion de caja nueva.
// ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Las formas de nombrar un ciclo de arqueo/corte de caja. `corte` a secas NO entra: el repo
 * tiene el CORTE DIARIO de la feature 41 (`CorteDiarioService`, `corte_sin_gestionar`), que es
 * el cierre de la jornada del mensajero y no tiene nada que ver con contar el dinero de la
 * caja. Perseguir la palabra suelta seria un falso positivo garantizado.
 */
const CICLOS_PROHIBIDOS = [
  /\barqueo/i,
  /corte[_\s-]*de[_\s-]*caja/i,
  /caja[_\s-]*chica/i,
  /cierre[_\s-]*de[_\s-]*caja/i,
  /conciliaci[oó]n[_\s-]*de[_\s-]*caja/i,
];

/**
 * El codigo de PRODUCTO. `tests/` queda fuera a proposito y por la misma razon por la que el
 * barrido money-safe quita los comentarios: este archivo nombra «arqueo» en cada `it` para
 * perseguirlo, y un censo que se leyera a si mismo fallaria por CITAR lo que prohibe. Ademas,
 * R67 habla de tablas, estados y pantallas: ninguna de las tres vive en `tests/`.
 */
const CODIGO_DE_PRODUCTO = [
  ...fuentesDe("lib"),
  ...fuentesDe("app"),
  ...fuentesDe("components"),
  ...fuentesDe("scripts"),
];

describe("R67 — no nace ningun ciclo de corte, arqueo ni conciliacion de caja", () => {
  it("ni una sola fuente del producto nombra un arqueo o un corte de caja", () => {
    const culpables: string[] = [];
    for (const ruta of CODIGO_DE_PRODUCTO) {
      const texto = readFileSync(path.join(RAIZ, ruta), "utf8");
      if (CICLOS_PROHIBIDOS.some((re) => re.test(texto))) culpables.push(ruta);
    }
    expect(culpables).toEqual([]);
  });

  it("tampoco el esquema: ni tabla, ni columna, ni valor de enum de arqueo", () => {
    const schema = readFileSync(path.join(RAIZ, "db/schema.prisma"), "utf8");
    for (const re of CICLOS_PROHIBIDOS) {
      expect(schema, `db/schema.prisma casa ${re}`).not.toMatch(re);
    }
  });

  it("tampoco una PANTALLA: ningun segmento de ruta de arqueo o corte de caja", () => {
    const rutas = fuentesDe("app").filter((r) => /\/(page|layout|route)\.tsx?$/.test(r));
    // Control de no-vacuidad: el arbol TIENE paginas; si el filtro estuviera roto, cero rutas
    // pasarian la comprobacion de abajo por vacio.
    expect(rutas.length).toBeGreaterThan(20);
    for (const ruta of rutas) {
      for (const re of CICLOS_PROHIBIDOS) {
        expect(ruta, `la ruta ${ruta} casa ${re}`).not.toMatch(re);
      }
    }
  });

  it("la migracion de la 173 no crea NINGUNA tabla ni NINGUN tipo: solo anade valores y el CHECK", () => {
    const up = readFileSync(
      path.join(RAIZ, "db/migrations/20260803120000_caja_tesoreria/migration.sql"),
      "utf8",
    ).toUpperCase();

    expect(up).not.toMatch(/CREATE\s+TABLE/);
    expect(up).not.toMatch(/CREATE\s+TYPE/);
    // Control de no-vacuidad: el archivo SI trae lo que la feature declara — dos valores de
    // enum y la restriccion. Si se leyera un archivo vacio, los dos `not` de arriba pasarian.
    expect((up.match(/ADD VALUE IF NOT EXISTS/g) ?? []).length).toBe(2);
    expect(up).toMatch(/ADD CONSTRAINT/);
  });

  it("CONTROL DE NO-VACUIDAD: el mismo censo SI encuentra lo que si existe", () => {
    // Las cuatro afirmaciones de arriba son negaciones sobre el mismo lector de archivos. Si
    // `fuentesDe` devolviera basura o `readFileSync` leyera vacio, todas pasarian por vacio.
    // Este caso obliga al censo a ENCONTRAR: el corte DIARIO de la 41 —que si existe y que a
    // proposito NO esta en la lista de prohibidos— y el libro de la caja en el esquema.
    const conCorteDiario = CODIGO_DE_PRODUCTO.filter((ruta) =>
      /CorteDiario/.test(readFileSync(path.join(RAIZ, ruta), "utf8")),
    );
    expect(conCorteDiario.length).toBeGreaterThan(0);

    const schema = readFileSync(path.join(RAIZ, "db/schema.prisma"), "utf8");
    expect(schema).toContain("wallet_movimiento");
    expect(schema).toContain("ingreso_cod_recaudado");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// R68 — los importes y las formulas de flete, comision, IVA y pago al mensajero no se mueven.
// ─────────────────────────────────────────────────────────────────────────────────────────

/** Donde vive cada formula que R68 protege. Se comprueba que las NUEVE existen (no-vacuidad). */
const MODULOS_DE_FORMULA = [
  "lib/utils/ingreso-ordenex.ts", // flete, flete de devolucion, comision COD y sus IVA
  "lib/utils/pago-mensajero.ts", // pago al mensajero por gestion
  "lib/utils/cuenta-por-pagar.ts", // `min(P, E)` y la cuenta por pagar
  "lib/utils/ingreso-bodega.ts", // ingreso de bodega por resultado
  "lib/utils/cierre-totales.ts", // los snapshots del cierre
  "lib/utils/mapeo-concepto-tienda.ts", // el 1:1 concepto de ingreso -> debito de tienda
  "lib/utils/saldo-tienda.ts", // el saldo a favor de la tienda
  "lib/services/WalletMensajeroFeedService.ts",
  "lib/services/WalletTiendaFeedService.ts",
];

/** Los insumos y los nombres de esas formulas: lo que un modulo de la 173 no puede nombrar. */
const INSUMOS_DE_FORMULA = [
  "valorFlete",
  "valorFleteGam",
  "valorFleteDevuelto",
  "comisionCod",
  "ivaFlete",
  "ivaComisionCod",
  "cobroEntregado",
  "cobroRechazado",
  "montoCobrar",
  "derivarIngresoOrden",
  "pagoPorResultado",
  "calcularSplitPago",
  "totalPagoMensajero",
  "totalEfectivo",
];

/** Tarifa de prueba con los SIETE campos distintos entre si: ningun par puede confundirse. */
const TARIFA = {
  valorFlete: "2500.00",
  valorFleteGam: "2000.00",
  valorFleteDevuelto: "1500.00",
  valorFleteDevueltoGam: "1200.00",
  comisionCod: "5.00",
  ivaFlete: "13.00",
  ivaComisionCod: "10.00",
};

describe("R68 — las formulas de flete, comision, IVA y pago al mensajero no se alteran", () => {
  it("CONTROL DE NO-VACUIDAD: los nueve modulos de formula existen vivos en el arbol", () => {
    for (const ruta of MODULOS_DE_FORMULA) {
      const fuente = readFileSync(path.join(RAIZ, ruta), "utf8");
      expect(fuente.length, `${ruta} esta vacio`).toBeGreaterThan(200);
    }
  });

  it("MEDIDO: flete, IVA del flete, comision COD e IVA de la comision, importe a importe", () => {
    // Entregada, zona CENTRAL, 20 000 de contra-entrega, con comision.
    const r = derivarIngresoOrden(
      { resultado: "entregada", esCentral: true, montoCobrar: "20000.00", cobraComision: true },
      TARIFA,
    );

    // esCentral -> `valorFleteGam` (2 000) y NO `valorFlete` (2 500): la eleccion de columna
    // tambien es formula.
    expect(r.ingreso_flete?.toFixed(2)).toBe("2000.00");
    expect(r.ingreso_iva_flete?.toFixed(2)).toBe("260.00"); // 13 % de 2 000
    expect(r.ingreso_comision_cod?.toFixed(2)).toBe("1000.00"); // 5 % de 20 000
    expect(r.ingreso_iva_comision_cod?.toFixed(2)).toBe("100.00"); // 10 % de la comision
    // La devolucion no aporta en una entrega.
    expect(r.ingreso_flete_devolucion).toBeUndefined();
  });

  it("MEDIDO: el flete de DEVOLUCION y su IVA, y que una devolucion NO cobra comision", () => {
    const r = derivarIngresoOrden(
      { resultado: "devuelta", esCentral: false, montoCobrar: "20000.00", cobraComision: true },
      TARIFA,
    );

    expect(r.ingreso_flete_devolucion?.toFixed(2)).toBe("1500.00"); // no central
    expect(r.ingreso_iva_flete_devolucion?.toFixed(2)).toBe("195.00"); // 13 % de 1 500
    expect(r.ingreso_comision_cod).toBeUndefined(); // no hubo recaudo
    expect(r.ingreso_flete).toBeUndefined();
  });

  it("MEDIDO: el pago al mensajero por gestion — solo `entregada` paga, y paga `cobroEntregado`", () => {
    const tarifa = { cobroEntregado: "1200.00", cobroRechazado: "600.00" };
    expect(pagoPorResultado("entregada", tarifa)).toBe("1200.00");
    // El `cobroRechazado` NUNCA se paga al mensajero, y es distinto a proposito.
    expect(pagoPorResultado("rechazada", tarifa)).toBe("0.00");
    expect(pagoPorResultado("devuelta", tarifa)).toBe("0.00");
    expect(pagoPorResultado("reprogramada", tarifa)).toBe("0.00");
    expect(pagoPorResultado("entregada", null)).toBe("0.00");
  });

  it("MEDIDO: `min(P, E)` sigue neteando por cierre, con los tres importes", () => {
    // P > E: el caso que discrimina. Con P = E los tres numeros saldrian iguales y la
    // asercion no distinguiria `min(P, E)` de `P`.
    expect(calcularSplitPago("15000.00", "9000.00")).toEqual({
      devengado: "15000.00",
      pagado: "9000.00",
      pendiente: "6000.00",
    });
    // E > P: el efectivo no paga de mas.
    expect(calcularSplitPago("15000.00", "40000.00")).toEqual({
      devengado: "15000.00",
      pagado: "15000.00",
      pendiente: "0.00",
    });
  });

  it("ningun modulo de la 173 nombra un insumo de esas formulas", () => {
    for (const ruta of MODULOS_DE_LA_173) {
      const codigo = codigoSinComentarios(ruta);
      for (const insumo of INSUMOS_DE_FORMULA) {
        expect(codigo, `${ruta} nombra ${insumo}`).not.toContain(insumo);
      }
    }
  });

  it("CIERRE de la lista: toda fuente que nombre las categorias nuevas esta declarada", () => {
    const nuevas = ["ingreso_cod_recaudado", "ingreso_reverso_pago_tienda"];
    const conCategoriasNuevas = FUENTES.filter((ruta) => {
      const codigo = codigoSinComentarios(ruta);
      return nuevas.some((c) => codigo.includes(c));
    });

    // Control de no-vacuidad: el censo encuentra algo. Si `FUENTES` viniera vacio, el
    // `toEqual([])` de abajo pasaria sin haber mirado nada.
    expect(conCategoriasNuevas.length).toBeGreaterThan(0);

    const declarados = new Set([...MODULOS_DE_LA_173, ...CATALOGOS_PREEXISTENTES]);
    const sinDeclarar = conCategoriasNuevas.filter((ruta) => !declarados.has(ruta));
    expect(sinDeclarar).toEqual([]);
  });
});
