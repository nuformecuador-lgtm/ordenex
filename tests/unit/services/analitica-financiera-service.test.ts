import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { quitarComentarios } from "../../fixtures/sin-comentarios";
import fs from "fs";
import path from "path";
import { listarMetricas } from "@/lib/analytics/metrics";
import { monedaConfig } from "@/lib/config/moneda";
import {
  IDS_FINANCIERAS_ACUMULADAS,
  IDS_FINANCIERAS_SERVIDAS,
  type ResultadoFinanciero,
} from "@/lib/types/analitica-financiera";
import { armarServicio, conNeto, consultaDe } from "./_dobles-analitica-financiera";

// Feature 127 / T D.1, D.3, D.4, D.5, D.8, D.9 — el despacho del servicio financiero.
//
// D.9 SE COMPRUEBA DE VERDAD, NO POR INSPECCION: el `beforeAll` de abajo BORRA `DATABASE_URL`
// del entorno antes de que corra un solo caso de este archivo y lo restaura al final. Si el
// servicio instanciara un repositorio concreto —o importara `@/lib/db`—, toda esta suite se
// caeria aqui mismo en vez de "parecer" testeable sin base. Leer el import y confiar es
// exactamente la comprobacion que no vale.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const SERVICIO = "lib/services/AnaliticaFinancieraService.ts";

const DATABASE_URL_ORIGINAL = process.env.DATABASE_URL;

/** El codigo sin comentarios: la PROSA que explica una prohibicion no la infringe. */
function soloCodigo(fuente: string): string {
  return quitarComentarios(fuente);
}

beforeAll(() => {
  delete process.env.DATABASE_URL;
});

afterAll(() => {
  if (DATABASE_URL_ORIGINAL === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = DATABASE_URL_ORIGINAL;
});

/* -------------------------------------------------------------------------- */
/* D.9 / R31 — sin base de datos                                               */
/* -------------------------------------------------------------------------- */

describe("R31 · la suite del servicio corre sin DATABASE_URL", () => {
  it("el entorno de estos casos NO tiene DATABASE_URL, y el servicio igual responde", async () => {
    expect(process.env.DATABASE_URL).toBeUndefined();

    const { servicio } = armarServicio({
      caja: [{ categoria: "ingreso_flete", tipo: "ingreso", suma: "100.00" }],
    });
    const r = await servicio.consultar(consultaDe("ingreso_flete"));

    expect(r.status).toBe("ok");
  });

  it("y el servicio no importa el cliente de la base por ningun camino", () => {
    const codigo = fs.readFileSync(path.join(REPO_ROOT, SERVICIO), "utf8");
    // El censo complementa al caso de arriba: un import perezoso dentro de un metodo que no se
    // ejercite se le escaparia a la ejecucion.
    expect(codigo).not.toContain("@/lib/db");
    expect(codigo).not.toContain("new PrismaClient");
    expect(codigo).not.toContain("PrismaClient");
  });
});

/* -------------------------------------------------------------------------- */
/* D.1 / R5, R10 — dominio invalido: error explicito y CERO consultas          */
/* -------------------------------------------------------------------------- */

describe("R5/R10 · una metrica que no es financiera no se sirve y no consulta nada", () => {
  it("pedir `entregas` devuelve dominio_invalido", async () => {
    const { servicio } = armarServicio();
    const r = await servicio.consultar(consultaDe("entregas"));

    expect(r).toEqual({ status: "dominio_invalido", metricaId: "entregas" });
  });

  it("y NINGUN repositorio recibe una sola llamada", async () => {
    const { servicio, consultasHechas } = armarServicio();
    await servicio.consultar(consultaDe("entregas"));

    // La otra mitad del "hecho cuando". Sin ella, mover la consulta antes de la comprobacion
    // seguiria devolviendo el error correcto y la base ya se habria leido.
    expect(consultasHechas()).toBe(0);
  });

  it("el espia si cuenta cuando la metrica SI es financiera: no mide el vacio", async () => {
    const { servicio, consultasHechas } = armarServicio();
    await servicio.consultar(consultaDe("ingreso_flete"));

    expect(consultasHechas()).toBeGreaterThan(0);
  });

  it("ninguna metrica operativa del catalogo se cuela por una rama por defecto", async () => {
    const { servicio, consultasHechas } = armarServicio();
    const operativas = listarMetricas({ dominio: "operativa" });

    expect(operativas.length).toBeGreaterThan(5);
    for (const metrica of operativas) {
      const r = await servicio.consultar(consultaDe(metrica.id));
      expect(r.status, metrica.id).toBe("dominio_invalido");
    }
    expect(consultasHechas()).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* D.3 / R6 — las DIEZ, ni una de mas ni una de menos                          */
/* -------------------------------------------------------------------------- */

const IDS_DEL_CATALOGO = listarMetricas({ dominio: "financiera" })
  .map((m) => m.id)
  .sort();

describe("R6 · el servicio sirve exactamente las diez financieras del catalogo", () => {
  it("falla por DEFECTO: no queda ninguna financiera del catalogo sin despachar", () => {
    const { servicio } = armarServicio();
    const servidas = new Set(servicio.idsServidos);
    const faltantes = IDS_DEL_CATALOGO.filter((id) => !servidas.has(id));

    expect(faltantes, "el catalogo las declara y el servicio no las despacha").toEqual([]);
  });

  it("falla por EXCESO: el servicio no inventa ningun id que el catalogo no tenga", () => {
    const { servicio } = armarServicio();
    const delCatalogo = new Set(IDS_DEL_CATALOGO);
    const sobrantes = servicio.idsServidos.filter((id) => !delCatalogo.has(id));

    expect(sobrantes, "el servicio despacha ids que no existen en el catalogo").toEqual([]);
  });

  it("y los dos conjuntos son el mismo, comparados de una vez", () => {
    const { servicio } = armarServicio();
    expect([...servicio.idsServidos].sort()).toEqual(IDS_DEL_CATALOGO);
    // Tercera fuente independiente: el registro del contrato (`lib/types`).
    expect([...IDS_FINANCIERAS_SERVIDAS].sort()).toEqual(IDS_DEL_CATALOGO);
  });

  it("autocomprobacion: las dos direcciones detectan lo que dicen detectar", () => {
    const servidasFalsas = ["ingreso_flete", "margen_bruto"];
    const catalogoFalso = ["ingreso_flete", "ingreso_iva"];
    expect(catalogoFalso.filter((id) => !servidasFalsas.includes(id))).toEqual(["ingreso_iva"]);
    expect(servidasFalsas.filter((id) => !catalogoFalso.includes(id))).toEqual(["margen_bruto"]);
  });

  it("las diez responden `ok` de verdad, no solo figuran en una lista", async () => {
    const { servicio } = armarServicio();
    for (const id of IDS_DEL_CATALOGO) {
      const r = await servicio.consultar(consultaDe(id));
      expect(r.status, id).toBe("ok");
    }
  });
});

/* -------------------------------------------------------------------------- */
/* D.4 / R43, R29 — `esAcumulado`, `sumableCon` y la moneda                    */
/* -------------------------------------------------------------------------- */

/** Todos los importes que un resultado contiene, sea cual sea su forma. */
function importesDe(datos: ResultadoFinanciero): readonly { moneda: string }[] {
  if (datos.tipo === "conciliacion") return [];
  return datos.vistas.flatMap((v) => [v.total, ...v.filas.map((f) => f.importe)]);
}

describe("R43 · esAcumulado es true EXACTAMENTE en las dos cuentas por pagar", () => {
  it("el mapa de las diez es el esperado, escrito a mano", async () => {
    const { servicio } = armarServicio();
    const esperado: Readonly<Record<string, boolean>> = {
      cod_recaudado: false,
      ingreso_flete: false,
      ingreso_comision_cod: false,
      ingreso_iva: false,
      egresos: false,
      // Feature 173 (P4): flujo del periodo, no saldo al corte, las dos.
      dinero_en_caja: false,
      ganancia_ordenex: false,
      cuenta_por_pagar_tienda: true,
      cuenta_por_pagar_mensajero: true,
      conciliacion_cierres: false,
    };

    for (const id of IDS_DEL_CATALOGO) {
      const r = await servicio.consultar(consultaDe(id));
      if (r.status !== "ok") throw new Error(`${id} no devolvio ok`);
      expect(r.datos.esAcumulado, id).toBe(esperado[id]);
    }
    // Y el esperado cubre las diez: si el catalogo ganara una, este mapa se quedaria corto.
    expect(Object.keys(esperado).sort()).toEqual(IDS_DEL_CATALOGO);
    expect(Object.entries(esperado).filter(([, v]) => v).map(([k]) => k).sort()).toEqual(
      [...IDS_FINANCIERAS_ACUMULADAS].sort(),
    );
  });
});

describe("R38 · las dos vistas de cod_recaudado no suman con nada", () => {
  it("llegan con ids distintos y `sumableCon` vacio en las dos", async () => {
    const { servicio } = armarServicio({
      porMetodo: [
        { metodo: "efectivo", suma: "300.00" },
        { metodo: "simpe", suma: "100.00" },
        { metodo: "transferencia", suma: "100.00" },
      ],
      porTienda: [
        { tiendaId: "t-1", tipo: "credito", suma: "300.00" },
        { tiendaId: "t-2", tipo: "credito", suma: "200.00" },
      ],
    });
    const r = await servicio.consultar(consultaDe("cod_recaudado"));
    if (r.status !== "ok" || r.datos.tipo !== "vistas") throw new Error("no son vistas");

    expect(r.datos.vistas.map((v) => v.id)).toEqual([
      "cod_recaudado__por_metodo",
      "cod_recaudado__por_tienda",
    ]);
    for (const vista of r.datos.vistas) expect(vista.sumableCon, vista.id).toEqual([]);
    // Y cada una sale de SU tabla: la del metodo del cierre, la de tienda del ledger.
    expect(r.datos.vistas.map((v) => v.fuente)).toEqual([
      "cierre_dia",
      "wallet_tienda_movimiento",
    ]);
    // Las cifras no se funden: 500 (cierre) y 500 (ledger) siguen siendo dos totales.
    expect(r.datos.vistas[0].total.bruto).toBe("500.00");
    expect(r.datos.vistas[1].total.bruto).toBe("500.00");
  });
});

describe("R29 · la moneda sale de lib/config/moneda.ts y nunca de un literal", () => {
  it("todo importe servido lleva el codigo configurado", async () => {
    const { servicio } = armarServicio({
      caja: [{ categoria: "ingreso_flete", tipo: "ingreso", suma: "10.00" }],
      porMetodo: [{ metodo: "efectivo", suma: "1.00" }],
      porTienda: [{ tiendaId: "t-1", tipo: "credito", suma: "1.00" }],
      saldoTiendas: [{ tiendaId: "t-1", tipo: "credito", suma: "1.00" }],
      cuentaMensajeros: [{ tipo: "devengo", suma: "1.00" }],
    });

    let vistos = 0;
    for (const id of IDS_DEL_CATALOGO) {
      const r = await servicio.consultar(consultaDe(id));
      if (r.status !== "ok") throw new Error(`${id} no devolvio ok`);
      for (const imp of importesDe(r.datos)) {
        expect(imp.moneda, id).toBe(monedaConfig.currency);
        vistos += 1;
      }
    }
    expect(vistos).toBeGreaterThan(8);
  });

  it("ningun archivo de la feature escribe un simbolo o un codigo de moneda a mano", () => {
    const ARCHIVOS = [
      "lib/types/analitica-financiera.ts",
      "lib/config/analitica-financiera.ts",
      "lib/services/AnaliticaFinancieraService.ts",
      "lib/repositories/IngresosAnaliticaRepository.ts",
      "lib/repositories/RecaudoAnaliticaRepository.ts",
      "lib/repositories/CuentasPorPagarAnaliticaRepository.ts",
      "lib/repositories/ConciliacionCierresAnaliticaRepository.ts",
      // T E.1 — el borde entra al censo en cuanto existe: es el ultimo sitio por el que un
      // codigo de moneda escrito a mano podria colarse al cliente.
      "lib/actions/analitica-financiera.ts",
    ];
    // Sin `$`: en TypeScript es el prefijo de toda interpolacion. Lo que se persigue es el
    // simbolo y el codigo ISO escritos a mano, que es lo que R29 prohibe.
    const LITERALES = ["₡", "CRC", "USD", "COP", "MXN"];

    const infractores: string[] = [];
    for (const rel of ARCHIVOS) {
      const codigo = soloCodigo(fs.readFileSync(path.join(REPO_ROOT, rel), "utf8"));
      for (const literal of LITERALES) {
        if (codigo.includes(literal)) infractores.push(`${rel}: ${literal}`);
      }
    }
    expect(infractores).toEqual([]);
    // El censo mira archivos de verdad y todos existen.
    expect(ARCHIVOS.every((rel) => fs.existsSync(path.join(REPO_ROOT, rel)))).toBe(true);
    // Autocomprobacion: el detector reconoceria el literal si alguien lo escribiera.
    expect(LITERALES.some((l) => soloCodigo('const m = "CRC";').includes(l))).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* D.5 / R18 — `egresos` PRODUCIDA, con sus ocho categorias                    */
/* -------------------------------------------------------------------------- */

describe("R18 · egresos se sirve de verdad, incluida la indemnizacion", () => {
  it("una `egreso_indemnizacion` en el rango entra en la cifra", async () => {
    const { servicio, ingresos } = armarServicio({
      caja: [
        { categoria: "egreso_gasto", tipo: "egreso", suma: "100.00" },
        { categoria: "egreso_sueldo", tipo: "egreso", suma: "400.00" },
        { categoria: "egreso_indemnizacion", tipo: "egreso", suma: "250.00" },
      ],
    });
    const r = await servicio.consultar(consultaDe("egresos"));
    if (r.status !== "ok" || r.datos.tipo !== "vistas") throw new Error("no son vistas");

    const total = conNeto(r.datos.vistas[0].total, "egresos / total");
    // 100 + 400 + 250: omitir la indemnizacion daria 500.00 y seguiria pareciendo una cifra.
    expect(total.bruto).toBe("750.00");
    // R6/R8 de la 183 — `egresos` CONSERVA el neto, y es NEGATIVO: `derivarBalance` lo firma
    // (ingresos − egresos). Aplicarle la retirada de Q1 —la mutacion que R6 nombra— haria que
    // esta lectura no compilara; publicar el valor absoluto daria "750.00".
    expect(total.neto).toBe("-750.00");
    expect(ingresos.sumarPorCategoria).toHaveBeenCalledTimes(1);
  });

  it("el catalogo declara las NUEVE categorias que esa cifra tiene que sumar", () => {
    // ⚠️ DADO VUELTA por la 183 (R25): era `toHaveLength(8)`. ⟨D12⟩ (humano, 2026-08-04,
    // `progress/decision_183.md`) anadio `ingreso_ajuste` sin quitar ninguna de las ocho.
    const egresos = listarMetricas({ dominio: "financiera" }).find((m) => m.id === "egresos");
    expect(egresos?.definicion.categorias).toHaveLength(9);
    expect(egresos?.definicion.categorias).toContain("ingreso_ajuste");
    // R10/183 — y de la entrada NO cambia nada mas que la definicion y la descripcion.
    expect(egresos?.id).toBe("egresos");
    expect(egresos?.etiqueta).toBe("Egresos");
    expect(egresos?.granos).toEqual(["fecha"]);
    expect(egresos?.fuente).toEqual({ tipo: "ledger", tablas: ["wallet_movimiento"] });
    // ⟨D8⟩ / D.6: y ya no esta marcada como declarada sin productor.
    expect(egresos?.estadoProduccion).toBe("producida");
  });

  it("no existe ningun camino que devuelva `no_producida`", async () => {
    const { servicio } = armarServicio();
    const r = await servicio.consultar(consultaDe("egresos"));

    expect(r.status).toBe("ok");
    expect(JSON.stringify(r)).not.toContain("no_producida");
    // En CODIGO, no en prosa: el archivo de tipos explica por que ese estado no existe.
    expect(soloCodigo(fs.readFileSync(path.join(REPO_ROOT, SERVICIO), "utf8"))).not.toContain(
      "no_producida",
    );
  });
});

/* -------------------------------------------------------------------------- */
/* D.8 / R28 — determinismo                                                    */
/* -------------------------------------------------------------------------- */

describe("R28 · misma entrada, misma salida, con mas de una fila", () => {
  it("dos ejecuciones de cod_recaudado producen la misma secuencia exacta", async () => {
    const { servicio } = armarServicio({
      porMetodo: [
        { metodo: "efectivo", suma: "300.00" },
        { metodo: "simpe", suma: "100.00" },
        { metodo: "transferencia", suma: "50.00" },
      ],
      porTienda: [
        { tiendaId: "t-1", tipo: "credito", suma: "300.00" },
        { tiendaId: "t-1", tipo: "debito", suma: "40.00" },
        { tiendaId: "t-2", tipo: "credito", suma: "200.00" },
      ],
    });
    const consulta = consultaDe("cod_recaudado");
    const a = await servicio.consultar(consulta);
    const b = await servicio.consultar(consulta);

    if (a.status !== "ok" || a.datos.tipo !== "vistas") throw new Error("no son vistas");
    expect(a.datos.vistas[0].filas.length + a.datos.vistas[1].filas.length).toBeGreaterThan(1);
    expect(a).toEqual(b);
    // El orden de los cubos es el que llego del repositorio, no el de un `Object.keys` casual.
    expect(a.datos.vistas[1].filas.map((f) => f.cubo)).toEqual(["t-1", "t-2"]);
  });

  it("ningun archivo de la feature usa el reloj ni el azar", () => {
    const ARCHIVOS = [
      "lib/services/AnaliticaFinancieraService.ts",
      "lib/repositories/IngresosAnaliticaRepository.ts",
      "lib/repositories/RecaudoAnaliticaRepository.ts",
      "lib/repositories/CuentasPorPagarAnaliticaRepository.ts",
      "lib/repositories/ConciliacionCierresAnaliticaRepository.ts",
      // T E.1 — el borde tambien: un `new Date()` aqui haria que el rango dependiera del
      // reloj del servidor en vez de del `now` inyectable de `resolverRango` (R28).
      "lib/actions/analitica-financiera.ts",
      // Feature 180 (R26 / Q2 = (a), humano 2026-08-05) — el modulo de cubos temporales. Es
      // donde el reloj tenia mas tentacion de entrar: marcar «el cubo en curso es parcial»
      // exige saber que hora es. Se decidio NO marcarlo, y este censo es lo que impide que
      // vuelva por la puerta de atras dejando el DTO a merced del reloj del proceso.
      "lib/analytics/cubo-temporal.ts",
    ];
    const infractores = ARCHIVOS.filter((rel) => {
      const codigo = fs
        .readFileSync(path.join(REPO_ROOT, rel), "utf8")
        ;
      return /Date\.now\s*\(|Math\.random\s*\(|new Date\s*\(\s*\)/.test(codigo);
    });
    expect(infractores).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* F.3 (173) / R54 — las dos metricas nuevas, con `derivarCaja` y sin restas   */
/* -------------------------------------------------------------------------- */

/**
 * UN libro con las tres cosas a la vez: dinero propio que entra, dinero propio que sale y
 * dinero de TERCEROS en las dos direcciones. Los importes estan elegidos para que las dos
 * cifras salgan distintas y distintas del bruto: si alguien intercambiara los dos selectores
 * del despacho, o publicara el bruto por el neto, cada numero de abajo lo dice.
 *
 *   bruto    = 1000 + 130 + 400 + 5000 + 3000 + 200 = 9730.00  (volumen movido, sin signo)
 *   enCaja   = (1000 + 130 + 5000 + 200) − (400 + 3000)        = 2930.00
 *   ganancia = (1000 + 130) − 400                              =  730.00
 *
 * OJO CON EL DOBLE: `armarServicio` devuelve estas filas para CUALQUIER metrica, porque no
 * filtra por categoria — eso lo hace el repositorio de verdad con lo que el catalogo declara
 * (`financiera-ingresos-repo.test.ts` lo mide). Aqui eso es una ventaja: obliga a que la
 * separacion la haga la NATURALEZA dentro de `derivarCaja`. Un manejador que reusara
 * `derivarBalance` como `deCaja` devolveria 2930.00 tambien para la ganancia.
 */
const LIBRO_MIXTO = [
  { categoria: "ingreso_flete", tipo: "ingreso", suma: "1000.00" },
  { categoria: "ingreso_iva_flete", tipo: "ingreso", suma: "130.00" },
  { categoria: "egreso_sueldo", tipo: "egreso", suma: "400.00" },
  { categoria: "ingreso_cod_recaudado", tipo: "ingreso", suma: "5000.00" },
  { categoria: "egreso_pago_tienda", tipo: "egreso", suma: "3000.00" },
  { categoria: "ingreso_reverso_pago_tienda", tipo: "ingreso", suma: "200.00" },
] as const;

/** Lo mismo SIN las tres filas de terceros: el mismo dinero de Ordenex, nada mas. */
const LIBRO_SOLO_PROPIO = LIBRO_MIXTO.filter(
  (f) =>
    f.categoria !== "ingreso_cod_recaudado" &&
    f.categoria !== "egreso_pago_tienda" &&
    f.categoria !== "ingreso_reverso_pago_tienda",
);

async function totalDe(metricaId: string, caja: readonly (typeof LIBRO_MIXTO)[number][]) {
  // Feature 180 — el MISMO libro visto por cubo. El rango `dia` trocea en UN solo cubo, asi que
  // el desglose es el libro entero con `indiceCubo: 0` y la unica fila de la serie tiene que dar
  // exactamente el total (R12).
  const { servicio } = armarServicio({
    caja: [...caja],
    cajaPorCubo: caja.map((f) => ({ ...f, indiceCubo: 0 })),
  });
  const r = await servicio.consultar(consultaDe(metricaId));
  if (r.status !== "ok" || r.datos.tipo !== "vistas") throw new Error(`${metricaId} no dio vistas`);
  const vista = r.datos.vistas[0];
  // R14/183 — las dos de tesoreria CONSERVAN el neto: mezclan prefijos a proposito y su neto
  // significa algo real. `conNeto` lo afirma antes de dejar leerlo, asi que generalizarles la
  // retirada de Q1 revienta aqui con el nombre de la metrica, no con un `undefined` silencioso.
  return { ...vista, total: conNeto(vista.total, metricaId) };
}

describe("R54 · dinero_en_caja y ganancia_ordenex son DOS cifras, no la misma dos veces", () => {
  it("`dinero_en_caja` es entradas − salidas, con el dinero de terceros dentro", async () => {
    const vista = await totalDe("dinero_en_caja", LIBRO_MIXTO);

    expect(vista.total.neto).toBe("2930.00");
    expect(vista.total.bruto).toBe("9730.00");
    expect(vista.id).toBe("dinero_en_caja");
    expect(vista.fuente).toBe("wallet_movimiento");
    expect(vista.grano).toBe("fecha");
    // No suma con nada: contiene dinero que `ganancia_ordenex` excluye a proposito.
    expect(vista.sumableCon).toEqual([]);
    // Feature 180 — la vista ya trae serie: una fila por cubo del rango (aqui, uno), y su
    // importe es el del total porque todo el libro cae en ese cubo (R12).
    expect(vista.filas).toHaveLength(1);
    expect(vista.filas[0].cubo).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(vista.filas[0].importe).toEqual(vista.total);
  });

  it("`ganancia_ordenex` deja fuera el dinero de terceros: 730, no 2930", async () => {
    const vista = await totalDe("ganancia_ordenex", LIBRO_MIXTO);

    expect(vista.total.neto).toBe("730.00");
    // El bruto es el de lo agregado, igual que en las demas metricas de caja ⟨D1(c)⟩.
    expect(vista.total.bruto).toBe("9730.00");
    expect(vista.id).toBe("ganancia_ordenex");
  });

  it("las dos cifras son DISTINTAS sobre el mismo libro, y esa diferencia es el punto", async () => {
    const enCaja = await totalDe("dinero_en_caja", LIBRO_MIXTO);
    const ganancia = await totalDe("ganancia_ordenex", LIBRO_MIXTO);

    expect(enCaja.total.neto).not.toBe(ganancia.total.neto);
    // 2930 − 730 = 2200 = el contra-entrega que aun no se ha entregado (5000 − 3000 + 200).
    expect(
      Number(enCaja.total.neto) - Number(ganancia.total.neto),
      "solo para leer el descuadre: la aritmetica de dinero vive en Prisma.Decimal",
    ).toBeCloseTo(2200, 2);
  });

  it("R51 en el servicio: anadir contra-entrega NO mueve la ganancia y SI mueve la caja", async () => {
    const gananciaSinTerceros = await totalDe("ganancia_ordenex", LIBRO_SOLO_PROPIO);
    const gananciaConTerceros = await totalDe("ganancia_ordenex", LIBRO_MIXTO);
    const cajaSinTerceros = await totalDe("dinero_en_caja", LIBRO_SOLO_PROPIO);
    const cajaConTerceros = await totalDe("dinero_en_caja", LIBRO_MIXTO);

    expect(gananciaConTerceros.total.neto).toBe(gananciaSinTerceros.total.neto);
    expect(gananciaConTerceros.total.neto).toBe("730.00");
    // Y la otra no es insensible: si las dos se movieran igual, serian la misma cifra.
    expect(cajaConTerceros.total.neto).not.toBe(cajaSinTerceros.total.neto);
    expect(cajaSinTerceros.total.neto).toBe("730.00");
  });

  it("un libro sin dinero de terceros hace coincidir las dos, y eso es correcto (R6)", async () => {
    const enCaja = await totalDe("dinero_en_caja", LIBRO_SOLO_PROPIO);
    const ganancia = await totalDe("ganancia_ordenex", LIBRO_SOLO_PROPIO);

    expect(enCaja.total.neto).toBe(ganancia.total.neto);
  });

  it("las dos consultan el libro de la caja y NINGUN otro repositorio", async () => {
    for (const id of ["dinero_en_caja", "ganancia_ordenex"]) {
      const { servicio, ingresos, consultasHechas } = armarServicio({ caja: [...LIBRO_MIXTO] });
      await servicio.consultar(consultaDe(id));

      // Feature 180 — DOS lecturas, las dos del mismo repositorio de caja: el total sigue
      // saliendo de `sumarPorCategoria` (R15, la cifra de la 127 no se toca) y la serie de
      // `sumarPorCuboYCategoria`. Derivar el total de los cubos ahorraria esta llamada y
      // convertiria la invariante de conservacion en una tautologia.
      expect(ingresos.sumarPorCategoria, id).toHaveBeenCalledTimes(1);
      expect(ingresos.sumarPorCuboYCategoria, id).toHaveBeenCalledTimes(1);
      expect(consultasHechas(), id).toBe(2);
    }
  });

  it("el manejador REUSA `derivarCaja` y no reimplementa ninguna resta de dinero", () => {
    // Estructural, y acotado al metodo: el archivo entero SI tiene una resta legitima
    // (`totalSnapshot.sub(totalLedger)`, del cuadre de la conciliacion), asi que mirar el
    // archivo completo no probaria nada de este manejador.
    const codigo = fs.readFileSync(path.join(REPO_ROOT, SERVICIO), "utf8");
    const inicio = codigo.indexOf("private async deTesoreria(");
    expect(inicio, "el manejador de las dos metricas nuevas no existe").toBeGreaterThan(0);
    const cuerpo = soloCodigo(codigo.slice(inicio)).split(/\n  private async /)[0];

    expect(cuerpo).toContain("derivarCaja(");
    // Ninguna resta ni suma con signo escrita a mano: la particion y las tres restas viven en
    // `lib/utils/caja-tesoreria.ts`, que a su vez reusa `derivarBalance` (R9/R20).
    expect(cuerpo).not.toMatch(/\.\s*(sub|minus)\s*\(/);
    expect(cuerpo).not.toMatch(/new Prisma\.Decimal/);
    expect(cuerpo).not.toContain("derivarBalance(");
  });
});

/* -------------------------------------------------------------------------- */
/* R55 — el guardia catalogo ↔ servicio sigue mordiendo por los DOS lados      */
/* -------------------------------------------------------------------------- */

describe("R55 · la coherencia catalogo ↔ servicio falla por exceso Y por defecto", () => {
  it("con los ids REALES: quitar uno se detecta, y anadir uno inventado tambien", () => {
    const { servicio } = armarServicio();
    const servidos = [...servicio.idsServidos];
    const catalogo = new Set(IDS_DEL_CATALOGO);

    // (1) POR DEFECTO — el servicio deja de despachar `ganancia_ordenex`.
    const sinUna = servidos.filter((id) => id !== "ganancia_ordenex");
    expect(sinUna).toHaveLength(servidos.length - 1);
    expect(IDS_DEL_CATALOGO.filter((id) => !new Set(sinUna).has(id))).toEqual(["ganancia_ordenex"]);

    // (2) POR EXCESO — el servicio despacha un id que el catalogo no tiene.
    const conUnaDeMas = [...servidos, "margen_bruto"];
    expect(conUnaDeMas.filter((id) => !catalogo.has(id))).toEqual(["margen_bruto"]);

    // (3) Y sin mutar, las dos direcciones dan vacio: el detector no grita siempre.
    expect(IDS_DEL_CATALOGO.filter((id) => !new Set(servidos).has(id))).toEqual([]);
    expect(servidos.filter((id) => !catalogo.has(id))).toEqual([]);
  });

  it("las dos metricas nuevas estan en las TRES fuentes independientes", () => {
    const { servicio } = armarServicio();
    for (const id of ["dinero_en_caja", "ganancia_ordenex"]) {
      expect(IDS_DEL_CATALOGO, `catalogo: ${id}`).toContain(id);
      expect(servicio.idsServidos, `servicio: ${id}`).toContain(id);
      expect([...IDS_FINANCIERAS_SERVIDAS] as string[], `contrato: ${id}`).toContain(id);
    }
    expect(IDS_FINANCIERAS_SERVIDAS).toHaveLength(10);
  });
});
