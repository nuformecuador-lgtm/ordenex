import { describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";

import { consultarMetricaFinanciera } from "@/lib/actions/analitica-financiera";
import { trocear } from "@/lib/analytics/cubo-temporal";
import type { CuboTemporal } from "@/lib/analytics/cubo-temporal";
import type { ErrorLogger } from "@/lib/errors/logger";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { AgregadoCuboCategoriaCaja } from "@/lib/interfaces/repositories/IIngresosAnaliticaRepository";
import type { AgregadoCuboTipo } from "@/lib/interfaces/repositories/ICuentasPorPagarAnaliticaRepository";
import {
  IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA,
  type VistaFinanciera,
} from "@/lib/types/analitica-financiera";
import { AHORA, armarServicio, consultaDe, type DatosFinancieros } from "./_dobles-analitica-financiera";

// Feature 180 (T4.1 / T4.3 / T3.5) — LA FRONTERA DEL DESGLOSE: R16, R17, R22, R24, R25.
//
// Lo que se mide aqui no es la cifra sino QUE se toca y QUE no:
//
//  - los cubos que el servicio pasa al repositorio son EXACTAMENTE `trocear(consulta.rango)`, no
//    una ventana propia (R22). Los `cubos` son el unico parametro nuevo que atraviesa la puerta
//    del alcance, y sin este caso serian el sitio ideal para colar otra ventana sin que nada
//    fallara;
//  - un rol prohibido no llega a los metodos nuevos (R24 / alcance de la 122);
//  - ni un id de persona sembrado en las filas del repositorio cruza al DTO;
//  - un fallo de cualquiera de los tres metodos SUBE; no se convierte en una serie de ceros, que
//    es la peor mentira posible en dinero (R25);
//  - y en el servicio no hay ni una conversion a `number` ni una resta de dinero nueva.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const SERVICIO = "lib/services/AnaliticaFinancieraService.ts";
const REPOSITORIOS = [
  "lib/repositories/IngresosAnaliticaRepository.ts",
  "lib/repositories/RecaudoAnaliticaRepository.ts",
  "lib/repositories/CuentasPorPagarAnaliticaRepository.ts",
  "lib/repositories/ConciliacionCierresAnaliticaRepository.ts",
];

const RANGO_CINCO_DIAS = { rango: "personalizado", desde: "2026-07-27", hasta: "2026-07-31" };
const RANGO_LARGO = { rango: "personalizado", desde: "2026-01-01", hasta: "2026-06-30" };

const leer = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");

/** El codigo sin comentarios: la PROSA que explica una prohibicion no la infringe. */
function soloCodigo(fuente: string): string {
  return fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}

/** El cuerpo de un metodo privado del servicio, hasta el siguiente. Misma tecnica que la 173. */
function cuerpoDelManejador(nombre: string): string {
  const codigo = leer(SERVICIO);
  const inicio = codigo.indexOf(`private async ${nombre}(`);
  expect(inicio, `el manejador ${nombre} no existe`).toBeGreaterThan(0);
  return soloCodigo(codigo.slice(inicio)).split(/\n {2}private async /)[0];
}

/* -------------------------------------------------------------------------- */
/* 1. R22 / T4.3 — los cubos son los del troceo de ESA consulta                */
/* -------------------------------------------------------------------------- */

describe("los cubos que el servicio pasa al repositorio son los del troceo de la consulta", () => {
  /** Los `cubos` con los que se llamo al espia, con su forma comparable. */
  function comparable(cubos: readonly CuboTemporal[]) {
    return cubos.map((c) => ({ clave: c.clave, desde: c.desde.getTime(), hasta: c.hasta.getTime() }));
  }

  it("R22 · caja: clave a clave y frontera a frontera, iguales a `trocear(consulta.rango)`", async () => {
    for (const raw of [RANGO_CINCO_DIAS, RANGO_LARGO]) {
      for (const id of ["ingreso_flete", "egresos", "dinero_en_caja", "ganancia_ordenex"]) {
        const { servicio, ingresos } = armarServicio({});
        const consulta = consultaDe(id, raw);
        await servicio.consultar(consulta);

        expect(ingresos.sumarPorCuboYCategoria, id).toHaveBeenCalledTimes(1);
        const [consultaPasada, cubosPasados] = ingresos.sumarPorCuboYCategoria.mock.calls[0];
        // La consulta entra ENTERA y es LA MISMA instancia: ni reconstruida ni forjada.
        expect(consultaPasada, id).toBe(consulta);
        expect(comparable(cubosPasados), `${id} / ${raw.desde}`).toEqual(
          comparable(trocear(consulta.rango)),
        );
      }
    }
  });

  it("R22 · mensajeros: los mismos cubos, y la consulta entera en los tres metodos", async () => {
    const { servicio, cuentasPorPagar } = armarServicio({});
    const consulta = consultaDe("cuenta_por_pagar_mensajero", RANGO_CINCO_DIAS);
    await servicio.consultar(consulta);

    const [consultaPorCubo, cubosPasados] =
      cuentasPorPagar.cuentaPorPagarMensajerosPorCubo.mock.calls[0];
    expect(consultaPorCubo).toBe(consulta);
    expect(comparable(cubosPasados)).toEqual(comparable(trocear(consulta.rango)));
    // El arrastre y el corte reciben la consulta entera y NADA MAS: ni un `desde` suelto.
    expect(cuentasPorPagar.cuentaPorPagarMensajerosAntesDe.mock.calls[0]).toEqual([consulta]);
    expect(cuentasPorPagar.cuentaPorPagarMensajerosAlCorte.mock.calls[0]).toEqual([consulta]);
  });

  it("R22 · el detector discrimina: el troceo de OTRO rango no coincide", () => {
    // Sin esto, comparar dos veces lo mismo podria pasar por casualidad si `trocear` devolviera
    // siempre lo mismo. Aqui se demuestra que dos rangos dan cubos distintos.
    const propios = trocear(consultaDe("egresos", RANGO_CINCO_DIAS).rango);
    const ajenos = trocear(consultaDe("egresos", { rango: "dia" }).rango);
    expect(comparable(propios)).not.toEqual(comparable(ajenos));
  });
});

/* -------------------------------------------------------------------------- */
/* 2. T4.1 / R24 — el rol prohibido, y el barrido de identidad                 */
/* -------------------------------------------------------------------------- */

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro", zonaId: null };
const TIENDA: Actor = { usuarioId: "t-propia", rol: "adminTienda", zonaId: null };

describe("un rol prohibido no llega a los metodos del desglose", () => {
  it("R24 · `adminTienda` recibe forbidden y NINGUN metodo nuevo se invoca", async () => {
    for (const id of IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA) {
      const armado = armarServicio({});
      const logError = vi.fn();
      const logger: ErrorLogger = { logError };

      const respuesta = await consultarMetricaFinanciera(
        id,
        { rango: "dia" },
        { now: AHORA, logger, getActor: async () => TIENDA, service: armado.servicio },
      );

      expect(respuesta, id).toEqual({ status: "forbidden", code: "FORBIDDEN" });
      // Los TRES metodos del desglose, uno a uno: el desglose no abre una via nueva a la tabla.
      expect(armado.ingresos.sumarPorCuboYCategoria, id).not.toHaveBeenCalled();
      expect(armado.cuentasPorPagar.cuentaPorPagarMensajerosPorCubo, id).not.toHaveBeenCalled();
      expect(armado.cuentasPorPagar.cuentaPorPagarMensajerosAntesDe, id).not.toHaveBeenCalled();
      // Y ningun otro tampoco: no se consulto absolutamente nada.
      expect(armado.consultasHechas(), id).toBe(0);
    }
  });

  it("R24 · el mismo camino con un maestro SI consulta: el caso de arriba no pasa por vacio", async () => {
    const armado = armarServicio({});
    const respuesta = await consultarMetricaFinanciera(
      "egresos",
      { rango: "dia" },
      { now: AHORA, logger: { logError: vi.fn() }, getActor: async () => MAESTRO, service: armado.servicio },
    );
    expect(respuesta.status).toBe("ok");
    expect(armado.ingresos.sumarPorCuboYCategoria).toHaveBeenCalledTimes(1);
  });
});

/** Un uuid sembrado en las filas que devuelven los repositorios NUEVOS (patron de la tarea E.4). */
const MENSAJERO_UUID = "3f1c9a52-0d84-4a7e-9b21-6c5f0e2d7a11";
const TIENDA_UUID = "9a2b7c14-55d6-4e08-8f31-2b7c9d0e4a63";

describe("ningun id sembrado en el material del desglose cruza al DTO", () => {
  /** Filas con columnas de MAS, como las devolveria un `select` que alguien amplia. */
  const SEMBRADO: Partial<DatosFinancieros> = {
    cajaPorCubo: [
      {
        indiceCubo: 0,
        categoria: "ingreso_flete",
        tipo: "ingreso",
        suma: "100.00",
        mensajeroId: MENSAJERO_UUID,
        tiendaId: TIENDA_UUID,
      },
      {
        indiceCubo: 2,
        categoria: "egreso_gasto",
        tipo: "egreso",
        suma: "40.00",
        mensajeroId: MENSAJERO_UUID,
      },
    ] as unknown as readonly AgregadoCuboCategoriaCaja[],
    cuentaMensajerosPorCubo: [
      { indiceCubo: 1, tipo: "devengo", suma: "70.00", mensajeroId: MENSAJERO_UUID },
    ] as unknown as readonly AgregadoCuboTipo[],
    cuentaMensajerosAntes: [
      { tipo: "devengo", suma: "10.00", mensajeroId: MENSAJERO_UUID },
    ] as unknown as DatosFinancieros["cuentaMensajerosAntes"],
  };

  it("R24 · el uuid sembrado no aparece en ninguna parte del DTO serializado", async () => {
    let vistas = 0;
    for (const id of IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA) {
      const { servicio } = armarServicio(SEMBRADO);
      const r = await servicio.consultar(consultaDe(id, RANGO_CINCO_DIAS));
      if (r.status !== "ok" || r.datos.tipo !== "vistas") throw new Error(`${id}: sin vistas`);
      vistas += r.datos.vistas.length;

      const serializada = JSON.stringify(r.datos);
      expect(serializada, id).not.toContain(MENSAJERO_UUID);
      expect(serializada, id).not.toContain(TIENDA_UUID);
      expect(serializada.toLowerCase(), id).not.toContain("mensajeroid");
      expect(serializada.toLowerCase(), id).not.toContain("tiendaid");
      // La fila del DTO se CONSTRUYE, no se reenvia: dos claves y ni una mas.
      for (const vista of r.datos.vistas) {
        for (const fila of vista.filas) expect(Object.keys(fila).sort(), id).toEqual([
          "cubo",
          "importe",
        ]);
      }
    }
    expect(vistas, "el barrido no llego a ninguna vista").toBe(7);
  });

  it("R24 · y el material sembrado SI llevaba el uuid: el barrido no es vacio", () => {
    expect(JSON.stringify(SEMBRADO)).toContain(MENSAJERO_UUID);
  });
});

/* -------------------------------------------------------------------------- */
/* 3. R25 — un fallo de cualquiera de los tres metodos SUBE                    */
/* -------------------------------------------------------------------------- */

describe("un fallo del repositorio se propaga; nunca se convierte en una serie de ceros", () => {
  const caida = new Error("could not connect to server: Connection refused");

  const CASOS = [
    {
      nombre: "IngresosAnaliticaRepository.sumarPorCuboYCategoria",
      metricaId: "egresos",
      romper: (a: ReturnType<typeof armarServicio>) =>
        a.ingresos.sumarPorCuboYCategoria.mockRejectedValue(caida),
    },
    {
      nombre: "CuentasPorPagarAnaliticaRepository.cuentaPorPagarMensajerosPorCubo",
      metricaId: "cuenta_por_pagar_mensajero",
      romper: (a: ReturnType<typeof armarServicio>) =>
        a.cuentasPorPagar.cuentaPorPagarMensajerosPorCubo.mockRejectedValue(caida),
    },
    {
      nombre: "CuentasPorPagarAnaliticaRepository.cuentaPorPagarMensajerosAntesDe",
      metricaId: "cuenta_por_pagar_mensajero",
      romper: (a: ReturnType<typeof armarServicio>) =>
        a.cuentasPorPagar.cuentaPorPagarMensajerosAntesDe.mockRejectedValue(caida),
    },
  ];

  for (const caso of CASOS) {
    it(`R25 · ${caso.nombre}: el error sube tal cual`, async () => {
      const armado = armarServicio({});
      caso.romper(armado);
      await expect(armado.servicio.consultar(consultaDe(caso.metricaId, RANGO_CINCO_DIAS))).rejects.toBe(
        caida,
      );
    });
  }

  it("R25 · y sin romper nada la misma consulta responde: el caso de arriba discrimina", async () => {
    const armado = armarServicio({});
    const r = await armado.servicio.consultar(consultaDe("egresos", RANGO_CINCO_DIAS));
    expect(r.status).toBe("ok");
  });
});

/* -------------------------------------------------------------------------- */
/* 4. R16 — ni una conversion de dinero a `number`                             */
/* -------------------------------------------------------------------------- */

describe("la aritmetica del desglose es decimal exacta de punta a punta", () => {
  it("R16 · ni el servicio ni los cuatro repositorios convierten dinero a number", () => {
    const CONVERSIONES = /\bparseFloat\s*\(|\.\s*toNumber\s*\(|\bNumber\s*\(/;
    const infractores = [SERVICIO, ...REPOSITORIOS].filter((rel) =>
      CONVERSIONES.test(soloCodigo(leer(rel))),
    );
    expect(infractores, "convierten dinero a number, que R16 prohibe").toEqual([]);
  });

  it("R16 · el censo mira archivos de verdad y su detector discrimina", () => {
    for (const rel of [SERVICIO, ...REPOSITORIOS]) {
      expect(leer(rel).length, rel).toBeGreaterThan(500);
    }
    const CONVERSIONES = /\bparseFloat\s*\(|\.\s*toNumber\s*\(|\bNumber\s*\(/;
    expect(CONVERSIONES.test('const v = Number(fila.suma).toFixed(2);')).toBe(true);
    expect(CONVERSIONES.test("const v = suma.toNumber();")).toBe(true);
    expect(CONVERSIONES.test("const v = new Prisma.Decimal(fila.suma).toFixed(2);")).toBe(false);
  });

  it("R16 · todo importe emitido es una cadena de escala 2, tambien en la serie", async () => {
    let importes = 0;
    for (const raw of [RANGO_CINCO_DIAS, RANGO_LARGO]) {
      for (const id of IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA) {
        const { servicio } = armarServicio({
          caja: [{ categoria: "ingreso_flete", tipo: "ingreso", suma: "0.10" }],
          cajaPorCubo: [
            { indiceCubo: 0, categoria: "ingreso_flete", tipo: "ingreso", suma: "0.10" },
            { indiceCubo: 0, categoria: "egreso_gasto", tipo: "egreso", suma: "0.20" },
          ],
          cuentaMensajerosPorCubo: [{ indiceCubo: 0, tipo: "devengo", suma: "0.10" }],
        });
        const r = await servicio.consultar(consultaDe(id, raw));
        if (r.status !== "ok" || r.datos.tipo !== "vistas") throw new Error(`${id}: sin vistas`);
        for (const vista of r.datos.vistas) {
          for (const imp of [vista.total, ...vista.filas.map((f) => f.importe)]) {
            importes += 1;
            expect(typeof imp.bruto, id).toBe("string");
            expect(imp.bruto, `${id}: ${imp.bruto}`).toMatch(/^-?\d+\.\d{2}$/);
            if (imp.forma === "bruto_y_neto") {
              expect(imp.neto, `${id}: ${imp.neto}`).toMatch(/^-?\d+\.\d{2}$/);
            }
          }
        }
      }
    }
    expect(importes, "el censo de importes no miro nada").toBeGreaterThan(100);
  });
});

/* -------------------------------------------------------------------------- */
/* 5. R17 — ni una resta de dinero nueva en el servicio                        */
/* -------------------------------------------------------------------------- */

describe("la resta con signo la siguen haciendo las funciones compartidas", () => {
  const RESTA = /\.\s*(sub|minus|negated)\s*\(/;

  for (const manejador of ["deCaja", "deTesoreria", "deCuentaDeMensajeros"]) {
    it(`R17 · ${manejador} no escribe ninguna resta de dinero`, () => {
      const cuerpo = cuerpoDelManejador(manejador);
      expect(RESTA.test(cuerpo), `${manejador} resta a mano`).toBe(false);
    });
  }

  it("R17 · y cada manejador LLAMA a la funcion derivadora que le toca", () => {
    expect(cuerpoDelManejador("deCaja")).toContain("derivarBalance(");
    expect(cuerpoDelManejador("deTesoreria")).toContain("derivarCaja(");
    expect(cuerpoDelManejador("deCuentaDeMensajeros")).toContain("derivarCuentaPorPagar(");
  });

  it("R17 · el detector discrimina: la unica resta del archivo es la del cuadre", () => {
    // El servicio SI tiene una resta legitima (`totalSnapshot.sub(totalLedger)`, la conciliacion,
    // que no es dinero de una vista sino la diferencia que se reporta). Si el detector no la
    // viera, los tres casos de arriba serian decorativos.
    const codigo = soloCodigo(leer(SERVICIO));
    const restas = codigo.match(/\.\s*(sub|minus|negated)\s*\(/g) ?? [];
    expect(restas).toHaveLength(1);
    expect(cuerpoDelManejador("deConciliacion")).toMatch(RESTA);
  });
});

/* -------------------------------------------------------------------------- */
/* 6. La vista sigue siendo UNA, y el desglose no le anadio claves             */
/* -------------------------------------------------------------------------- */

describe("el desglose no anade ninguna clave a la vista", () => {
  const CLAVES_DE_VISTA = ["filas", "fuente", "grano", "granularidad", "id", "sumableCon", "total"];

  it("R5 · cada vista del conjunto declara exactamente las siete claves de siempre", async () => {
    for (const id of IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA) {
      const { servicio } = armarServicio({});
      const r = await servicio.consultar(consultaDe(id, RANGO_CINCO_DIAS));
      if (r.status !== "ok" || r.datos.tipo !== "vistas") throw new Error(`${id}: sin vistas`);
      for (const vista of r.datos.vistas as readonly VistaFinanciera[]) {
        expect(Object.keys(vista).sort(), id).toEqual(CLAVES_DE_VISTA);
      }
    }
  });
});
