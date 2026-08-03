import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import { listarMetricas } from "@/lib/analytics/metrics";
import { monedaConfig } from "@/lib/config/moneda";
import {
  IDS_FINANCIERAS_ACUMULADAS,
  IDS_FINANCIERAS_SERVIDAS,
  type ResultadoFinanciero,
} from "@/lib/types/analitica-financiera";
import { armarServicio, consultaDe } from "./_dobles-analitica-financiera";

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
  return fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
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
/* D.3 / R6 — las OCHO, ni una de mas ni una de menos                          */
/* -------------------------------------------------------------------------- */

const IDS_DEL_CATALOGO = listarMetricas({ dominio: "financiera" })
  .map((m) => m.id)
  .sort();

describe("R6 · el servicio sirve exactamente las ocho financieras del catalogo", () => {
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

  it("las ocho responden `ok` de verdad, no solo figuran en una lista", async () => {
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
  it("el mapa de las ocho es el esperado, escrito a mano", async () => {
    const { servicio } = armarServicio();
    const esperado: Readonly<Record<string, boolean>> = {
      cod_recaudado: false,
      ingreso_flete: false,
      ingreso_comision_cod: false,
      ingreso_iva: false,
      egresos: false,
      cuenta_por_pagar_tienda: true,
      cuenta_por_pagar_mensajero: true,
      conciliacion_cierres: false,
    };

    for (const id of IDS_DEL_CATALOGO) {
      const r = await servicio.consultar(consultaDe(id));
      if (r.status !== "ok") throw new Error(`${id} no devolvio ok`);
      expect(r.datos.esAcumulado, id).toBe(esperado[id]);
    }
    // Y el esperado cubre las ocho: si el catalogo ganara una, este mapa se quedaria corto.
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

    // 100 + 400 + 250: omitir la indemnizacion daria 500.00 y seguiria pareciendo una cifra.
    expect(r.datos.vistas[0].total.bruto).toBe("750.00");
    // El neto de un egreso puro es NEGATIVO: `derivarBalance` lo firma (ingresos − egresos).
    expect(r.datos.vistas[0].total.neto).toBe("-750.00");
    expect(ingresos.sumarPorCategoria).toHaveBeenCalledTimes(1);
  });

  it("el catalogo declara las OCHO egreso_* que esa cifra tiene que sumar", () => {
    const egresos = listarMetricas({ dominio: "financiera" }).find((m) => m.id === "egresos");
    expect(egresos?.definicion.categorias).toHaveLength(8);
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
    ];
    const infractores = ARCHIVOS.filter((rel) => {
      const codigo = fs
        .readFileSync(path.join(REPO_ROOT, rel), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|\s)\/\/.*$/gm, "$1");
      return /Date\.now\s*\(|Math\.random\s*\(|new Date\s*\(\s*\)/.test(codigo);
    });
    expect(infractores).toEqual([]);
  });
});
