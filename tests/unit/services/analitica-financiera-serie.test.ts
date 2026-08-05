import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";

import { trocear } from "@/lib/analytics/cubo-temporal";
import { TOPE_PUNTOS_SERIE } from "@/lib/analytics/types";
import { monedaConfig } from "@/lib/config/moneda";
import type { AgregadoCuboCategoriaCaja } from "@/lib/interfaces/repositories/IIngresosAnaliticaRepository";
import type { AgregadoCuboTipo } from "@/lib/interfaces/repositories/ICuentasPorPagarAnaliticaRepository";
import {
  esMetricaAcumulada,
  IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA,
  type FilaFinanciera,
  type ImporteAnalitico,
  type VistaFinanciera,
} from "@/lib/types/analitica-financiera";
import { derivarCuentaPorPagar } from "@/lib/utils/cuenta-por-pagar";
import { armarServicio, consultaDe, type DatosFinancieros } from "./_dobles-analitica-financiera";

// Feature 180 (T3.5 / T4.x) — LA SERIE POR FECHA DE LAS SIETE METRICAS DEL CONJUNTO CON
// DESGLOSE. Cubre R1, R6-R10, R12-R15, R19, R26, R27 y R28.
//
// Los casos se nombran POR EL COMPORTAMIENTO. Lo que este archivo sostiene, y que ningun tipo
// puede sostener:
//
//  - la serie es DENSA (una fila por cubo, tambien donde no hubo un colon) y esta ORDENADA,
//    aunque el repositorio devuelva sus filas en cualquier orden;
//  - el cero de un cubo vacio en una metrica de FLUJO es un cero de verdad; el de una metrica
//    ACUMULADA no existe: ahi se repite el saldo anterior (R9), que es una cifra distinta y
//    plausible — la peor combinacion posible si se confunden;
//  - la conservacion (Σ filas == total) se comprueba como INVARIANTE entre dos caminos
//    independientes, en decimal exacto y no en coma flotante;
//  - y el importe de cada fila sale de la MISMA funcion que el total de su vista (R27), asi que
//    total y filas son siempre la misma variante de la union `ImporteAnalitico`.

const MONEDA = monedaConfig.currency;

/* -------------------------------------------------------------------------- */
/* 0. Utilidades del archivo                                                   */
/* -------------------------------------------------------------------------- */

/** Rango de un solo dia (preset `dia`): UN cubo. */
const RANGO_CORTO = { rango: "dia" };
/** Cinco dias calendario CR: cinco cubos diarios. Fechas fijas, nunca «hoy menos N» (R26). */
const RANGO_CINCO_DIAS = { rango: "personalizado", desde: "2026-07-27", hasta: "2026-07-31" };
/** 181 dias: por encima del tope de puntos, luego cubos SEMANALES (R18). */
const RANGO_LARGO = { rango: "personalizado", desde: "2026-01-01", hasta: "2026-06-30" };

/** Los cubos que el troceo produce para esa consulta: la fuente de la verdad de R7 y R10. */
function cubosDe(metricaId: string, raw: unknown) {
  return trocear(consultaDe(metricaId, raw).rango);
}

async function vistasDe(
  datos: Partial<DatosFinancieros>,
  metricaId: string,
  raw: unknown,
): Promise<readonly VistaFinanciera[]> {
  const { servicio } = armarServicio(datos);
  const r = await servicio.consultar(consultaDe(metricaId, raw));
  if (r.status !== "ok") throw new Error(`${metricaId} no devolvio ok: ${r.status}`);
  if (r.datos.tipo !== "vistas") throw new Error(`${metricaId} no devolvio vistas`);
  return r.datos.vistas;
}

async function vistaUnicaDe(
  datos: Partial<DatosFinancieros>,
  metricaId: string,
  raw: unknown,
): Promise<VistaFinanciera> {
  const vistas = await vistasDe(datos, metricaId, raw);
  expect(vistas, `${metricaId} publica mas de una vista`).toHaveLength(1);
  return vistas[0];
}

/**
 * Recorta el material por cubo a los cubos que ese rango tiene. NO es un apaño del doble: el
 * repositorio de verdad particiona por los cubos que RECIBE y nunca puede emitir un indice fuera
 * de ellos —hacerlo significaria haber leido otra ventana—, y el servicio LANZA si lo ve. Los
 * fixtures de este archivo se escriben para el rango de cinco dias y se recortan al reusarlos.
 */
function recortarA(datos: Partial<DatosFinancieros>, cubos: number): Partial<DatosFinancieros> {
  return {
    ...datos,
    cajaPorCubo: (datos.cajaPorCubo ?? []).filter((f) => f.indiceCubo < cubos),
    cuentaMensajerosPorCubo: (datos.cuentaMensajerosPorCubo ?? []).filter(
      (f) => f.indiceCubo < cubos,
    ),
  };
}

/** Las SEIS de flujo del conjunto (todas menos la cuenta por pagar de mensajeros). */
const DE_FLUJO = IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA.filter((id) => !esMetricaAcumulada(id));
/** La unica ACUMULADA del conjunto. Se deriva del registro, no se escribe a mano. */
const ACUMULADAS = IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA.filter((id) => esMetricaAcumulada(id));

const dec = (v: string) => new Prisma.Decimal(v);

/** Σ de un campo de los importes de una serie, en decimal exacto. */
function sumaDe(filas: readonly FilaFinanciera[], leer: (i: ImporteAnalitico) => string | null) {
  return filas.reduce((acc, f) => {
    const v = leer(f.importe);
    return v === null ? acc : acc.plus(dec(v));
  }, new Prisma.Decimal(0));
}

const brutoDe = (i: ImporteAnalitico) => i.bruto;
const netoDe = (i: ImporteAnalitico) => (i.forma === "bruto_y_neto" ? i.neto : null);

/* -------------------------------------------------------------------------- */
/* 1. Un generador DETERMINISTA de movimientos (R12 como propiedad, R26)       */
/* -------------------------------------------------------------------------- */

/**
 * PRNG con semilla (LCG de Numerical Recipes). NO se usa `Math.random`: el resultado de estos
 * casos tiene que ser el mismo en cada corrida, igual que el DTO (R26). Un test de propiedad con
 * azar real es un test que un dia falla y nadie puede reproducir.
 */
function azarConSemilla(semilla: number): () => number {
  let estado = semilla >>> 0;
  return () => {
    estado = (Math.imul(estado, 1664525) + 1013904223) >>> 0;
    return estado / 0x100000000;
  };
}

/** Pares `(categoria, tipo)` COHERENTES con el CHECK de la 173. Nunca cruzados (§7 del design). */
const CATEGORIAS = [
  { categoria: "ingreso_flete", tipo: "ingreso" },
  { categoria: "ingreso_iva_flete", tipo: "ingreso" },
  { categoria: "ingreso_cod_recaudado", tipo: "ingreso" },
  { categoria: "ingreso_ajuste", tipo: "ingreso" },
  { categoria: "egreso_gasto", tipo: "egreso" },
  { categoria: "egreso_sueldo", tipo: "egreso" },
  { categoria: "egreso_pago_tienda", tipo: "egreso" },
] as const;

interface LibroGenerado {
  readonly caja: DatosFinancieros["caja"];
  readonly cajaPorCubo: DatosFinancieros["cajaPorCubo"];
  /** Cubos que quedaron SIN movimiento: la mitad del R7/R8 que hay que poder nombrar. */
  readonly cubosVacios: readonly number[];
}

/**
 * Genera movimientos repartidos por cubo y devuelve las DOS agregaciones que los dos metodos del
 * repositorio producirian sobre el mismo libro: la de la ventana entera (el `total`) y la
 * particionada por cubo (las `filas`). Que las dos salgan del MISMO libro es lo que convierte
 * «Σ filas == total» en una invariante y no en una tautologia.
 */
function generarLibro(cubos: number, movimientos: number, semilla: number): LibroGenerado {
  const azar = azarConSemilla(semilla);
  const porCubo = new Map<string, Prisma.Decimal>();
  const total = new Map<string, Prisma.Decimal>();
  const conMovimiento = new Set<number>();

  for (let n = 0; n < movimientos; n += 1) {
    const indiceCubo = Math.floor(azar() * cubos);
    const { categoria, tipo } = CATEGORIAS[Math.floor(azar() * CATEGORIAS.length)];
    const monto = new Prisma.Decimal(Math.floor(azar() * 1_000_000)).dividedBy(100);
    conMovimiento.add(indiceCubo);
    const claveCubo = `${indiceCubo}|${categoria}|${tipo}`;
    const claveTotal = `${categoria}|${tipo}`;
    porCubo.set(claveCubo, (porCubo.get(claveCubo) ?? new Prisma.Decimal(0)).plus(monto));
    total.set(claveTotal, (total.get(claveTotal) ?? new Prisma.Decimal(0)).plus(monto));
  }

  const caja = [...total.entries()].map(([clave, suma]) => {
    const [categoria, tipo] = clave.split("|");
    return { categoria, tipo, suma: suma.toFixed(2) };
  }) as DatosFinancieros["caja"];

  const cajaPorCubo = [...porCubo.entries()].map(([clave, suma]) => {
    const [indiceCubo, categoria, tipo] = clave.split("|");
    return { indiceCubo: Number(indiceCubo), categoria, tipo, suma: suma.toFixed(2) };
  }) as DatosFinancieros["cajaPorCubo"];

  const cubosVacios = Array.from({ length: cubos }, (_, i) => i).filter(
    (i) => !conMovimiento.has(i),
  );
  return { caja, cajaPorCubo, cubosVacios };
}

/* -------------------------------------------------------------------------- */
/* 2. R1 — cada metrica del conjunto publica una fila POR CUBO                 */
/* -------------------------------------------------------------------------- */

describe("cada metrica con desglose publica una fila por cubo del rango", () => {
  it("R1 · las SIETE del conjunto traen tantas filas como cubos, en las dos granularidades", async () => {
    // Se recorre la CONSTANTE, no una lista escrita aqui (R2): si el conjunto creciera, el caso
    // pasa a exigirle la serie a la metrica nueva sin que nadie se acuerde de venir.
    expect(IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA.length).toBe(7);

    for (const raw of [RANGO_CORTO, RANGO_CINCO_DIAS, RANGO_LARGO]) {
      for (const id of IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA) {
        const cubos = cubosDe(id, raw);
        const vista = await vistaUnicaDe({}, id, raw);
        expect(vista.grano, id).toBe("fecha");
        expect(vista.filas.length, `${id}: filas != cubos del troceo`).toBe(cubos.length);
      }
    }
  });

  it("R1 · y no pasa por vacio: el troceo de los tres rangos trae 1, 5 y varias decenas de cubos", () => {
    expect(cubosDe("egresos", RANGO_CORTO)).toHaveLength(1);
    expect(cubosDe("egresos", RANGO_CINCO_DIAS)).toHaveLength(5);
    expect(cubosDe("egresos", RANGO_LARGO).length).toBeGreaterThan(20);
  });
});

/* -------------------------------------------------------------------------- */
/* 3. R6 / R10 — orden, claves unicas y de donde sale la clave                 */
/* -------------------------------------------------------------------------- */

describe("la serie llega ordenada y con una clave de fecha por cubo", () => {
  /** El mismo libro, DESORDENADO a proposito: el repositorio no manda el orden de la salida. */
  const DESORDENADO: Partial<DatosFinancieros> = {
    cajaPorCubo: [
      { indiceCubo: 4, categoria: "ingreso_flete", tipo: "ingreso", suma: "50.00" },
      { indiceCubo: 0, categoria: "ingreso_flete", tipo: "ingreso", suma: "10.00" },
      { indiceCubo: 3, categoria: "egreso_gasto", tipo: "egreso", suma: "40.00" },
      { indiceCubo: 1, categoria: "ingreso_flete", tipo: "ingreso", suma: "20.00" },
    ] as readonly AgregadoCuboCategoriaCaja[],
    cuentaMensajerosPorCubo: [
      { indiceCubo: 4, tipo: "devengo", suma: "50.00" },
      { indiceCubo: 1, tipo: "pago", suma: "20.00" },
      { indiceCubo: 0, tipo: "devengo", suma: "10.00" },
    ] as readonly AgregadoCuboTipo[],
  };

  it("R6 · aunque el repositorio devuelva los cubos revueltos, las filas salen en orden ascendente", async () => {
    for (const id of IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA) {
      const vista = await vistaUnicaDe(DESORDENADO, id, RANGO_CINCO_DIAS);
      const claves = vista.filas.map((f) => f.cubo);
      // Ascendente de verdad: `YYYY-MM-DD` ordena lexicograficamente igual que en el tiempo.
      expect(claves, `${id}: la serie no esta ordenada`).toEqual([...claves].sort());
      // Y estrictamente creciente, que es lo que dice «sin dos filas con la misma clave».
      for (let i = 1; i < claves.length; i += 1) {
        expect(claves[i] > claves[i - 1], `${id}: ${claves[i - 1]} >= ${claves[i]}`).toBe(true);
      }
    }
  });

  it("R6 · ninguna clave se repite, con ninguno de los tres rangos", async () => {
    for (const raw of [RANGO_CORTO, RANGO_CINCO_DIAS, RANGO_LARGO]) {
      for (const id of IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA) {
        const datos = recortarA(DESORDENADO, cubosDe(id, raw).length);
        const claves = (await vistaUnicaDe(datos, id, raw)).filas.map((f) => f.cubo);
        expect(new Set(claves).size, `${id}: hay claves repetidas`).toBe(claves.length);
      }
    }
  });

  it("R10 · la clave de cada fila es la del cubo de `trocear`, y es una fecha CR", async () => {
    for (const raw of [RANGO_CORTO, RANGO_CINCO_DIAS, RANGO_LARGO]) {
      for (const id of IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA) {
        const cubos = cubosDe(id, raw);
        const vista = await vistaUnicaDe(recortarA(DESORDENADO, cubos.length), id, raw);
        expect(vista.filas.map((f) => f.cubo), id).toEqual(cubos.map((c) => c.clave));
        for (const fila of vista.filas) expect(fila.cubo, id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });

  it("R10 · el primer cubo del rango de cinco dias es su primer dia, escrito", async () => {
    // El esperado se escribe: derivarlo de `trocear` otra vez no distinguiria un troceo corrido
    // un dia de uno correcto.
    const vista = await vistaUnicaDe(DESORDENADO, "egresos", RANGO_CINCO_DIAS);
    expect(vista.filas.map((f) => f.cubo)).toEqual([
      "2026-07-27",
      "2026-07-28",
      "2026-07-29",
      "2026-07-30",
      "2026-07-31",
    ]);
  });
});

/* -------------------------------------------------------------------------- */
/* 4. R7 / R8 — la serie es DENSA, y el cubo vacio de una metrica de FLUJO     */
/*    vale cero con escala 2 en TODOS sus campos                               */
/* -------------------------------------------------------------------------- */

describe("un cubo sin movimiento sigue teniendo su fila", () => {
  /** Cinco dias y movimiento SOLO en el tercero: cuatro cubos vacios que hay que emitir igual. */
  const SOLO_UN_DIA_CON_MOVIMIENTO: Partial<DatosFinancieros> = {
    caja: [
      { categoria: "ingreso_flete", tipo: "ingreso", suma: "1000.00" },
      { categoria: "egreso_gasto", tipo: "egreso", suma: "400.00" },
    ],
    cajaPorCubo: [
      { indiceCubo: 2, categoria: "ingreso_flete", tipo: "ingreso", suma: "1000.00" },
      { indiceCubo: 2, categoria: "egreso_gasto", tipo: "egreso", suma: "400.00" },
    ] as readonly AgregadoCuboCategoriaCaja[],
  };

  it("R7 · con movimiento en un solo dia de cinco, la serie sigue trayendo CINCO filas", async () => {
    for (const id of DE_FLUJO) {
      const vista = await vistaUnicaDe(SOLO_UN_DIA_CON_MOVIMIENTO, id, RANGO_CINCO_DIAS);
      expect(vista.filas, id).toHaveLength(5);
      expect(vista.filas.map((f) => f.cubo), id).toEqual(
        cubosDe(id, RANGO_CINCO_DIAS).map((c) => c.clave),
      );
    }
  });

  it("R8 · los cuatro cubos sin movimiento valen cero con escala 2 en TODOS sus campos", async () => {
    let vacias = 0;
    for (const id of DE_FLUJO) {
      const vista = await vistaUnicaDe(SOLO_UN_DIA_CON_MOVIMIENTO, id, RANGO_CINCO_DIAS);
      for (const [i, fila] of vista.filas.entries()) {
        if (i === 2) continue; // el unico cubo con movimiento
        vacias += 1;
        expect(fila.importe.bruto, `${id} / ${fila.cubo}`).toBe("0.00");
        if (fila.importe.forma === "bruto_y_neto") {
          // Tambien el neto: un cubo vacio con `neto: "0"` o `"-0.00"` no es «cero con escala 2».
          expect(fila.importe.neto, `${id} / ${fila.cubo}`).toBe("0.00");
        }
        expect(fila.importe.moneda, `${id} / ${fila.cubo}`).toBe(MONEDA);
      }
    }
    expect(vacias, "el caso no llego a ningun cubo vacio").toBe(DE_FLUJO.length * 4);
  });

  it("R8 · y el cubo que SI tuvo movimiento no vale cero: el caso de arriba discrimina", async () => {
    const vista = await vistaUnicaDe(SOLO_UN_DIA_CON_MOVIMIENTO, "egresos", RANGO_CINCO_DIAS);
    expect(vista.filas[2].importe.bruto).toBe("1400.00");
    expect(vista.filas[2].importe).toEqual(vista.total);
  });
});

/* -------------------------------------------------------------------------- */
/* 5. R9 / R13 / R14 — la ACUMULADA: saldo al cierre, no movimiento del cubo   */
/* -------------------------------------------------------------------------- */

/**
 * El libro de la cuenta por pagar de mensajeros, en las TRES lecturas que ⟨D5⟩ necesita:
 *
 *   - arrastre (`< rango.desde`)      : devengo 4000, pago 1000  → saldo 3000
 *   - cubo 0                          : devengo  500            → saldo 3500
 *   - cubo 1                          : (nada)                  → saldo 3500  (R9)
 *   - cubo 2                          : pago     200            → saldo 3300
 *   - cubo 3                          : devengo  100            → saldo 3400
 *   - cubo 4                          : (nada)                  → saldo 3400  (R9)
 *
 * Y el saldo al corte (`< rango.hasta`) es la suma de todo: devengo 4700, pago 1200. La identidad
 * arrastre + Σ cubos = al corte es la que hace que la ultima fila coincida con el total (R13).
 */
const ARRASTRE_MENSAJEROS = [
  { tipo: "devengo" as const, suma: "4000.00" },
  { tipo: "pago" as const, suma: "1000.00" },
];

const MOVIMIENTOS_MENSAJEROS: readonly AgregadoCuboTipo[] = [
  { indiceCubo: 0, tipo: "devengo", suma: "500.00" },
  { indiceCubo: 2, tipo: "pago", suma: "200.00" },
  { indiceCubo: 3, tipo: "devengo", suma: "100.00" },
];

/**
 * El libro de mensajeros COHERENTE para un rango de `cubos` cubos: el saldo al corte se calcula
 * como arrastre + Σ de los movimientos que caen dentro, que es exactamente la identidad que ⟨D5⟩
 * sostiene (`< desde` + `[desde, hasta)` = `< hasta`). Escribir el corte a mano y recortar los
 * movimientos por otro lado romperia esa identidad y R13 fallaria por culpa del fixture.
 */
function mensajerosPara(cubos: number): Partial<DatosFinancieros> {
  const dentro = MOVIMIENTOS_MENSAJEROS.filter((m) => m.indiceCubo < cubos);
  const alCorte = (tipo: "devengo" | "pago") =>
    dentro
      .filter((m) => m.tipo === tipo)
      .reduce(
        (acc, m) => acc.plus(dec(m.suma)),
        dec(ARRASTRE_MENSAJEROS.find((a) => a.tipo === tipo)?.suma ?? "0.00"),
      )
      .toFixed(2);

  return {
    cuentaMensajerosAntes: ARRASTRE_MENSAJEROS,
    cuentaMensajerosPorCubo: dentro,
    cuentaMensajeros: [
      { tipo: "devengo", suma: alCorte("devengo") },
      { tipo: "pago", suma: alCorte("pago") },
    ],
  };
}

/** El caso de referencia: el rango de cinco dias, con sus cinco cubos. */
const MENSAJEROS = mensajerosPara(5);

/** Los saldos (`neto`) que ⟨D5⟩ obliga a publicar, escritos a mano cubo a cubo. */
const SALDOS_ESPERADOS = ["3500.00", "3500.00", "3300.00", "3400.00", "3400.00"];
/** Y el `bruto` ACUMULADO (devengo + pago del libro entero hasta el cierre de ese cubo). */
const BRUTOS_ESPERADOS = ["5500.00", "5500.00", "5700.00", "5800.00", "5800.00"];

describe("la cuenta por pagar de mensajeros publica un SALDO por cubo, no el movimiento", () => {
  it("R14 · cada fila es el saldo al cierre del cubo sobre TODO el libro anterior", async () => {
    for (const id of ACUMULADAS) {
      const vista = await vistaUnicaDe(MENSAJEROS, id, RANGO_CINCO_DIAS);
      const netos = vista.filas.map((f) =>
        f.importe.forma === "bruto_y_neto" ? f.importe.neto : "SIN NETO",
      );
      // Escritos a mano: el movimiento de cada cubo seria 500 / 0 / -200 / 100 / 0, que no se
      // parece en nada a esto. Publicar el movimiento mata este caso en las CINCO filas.
      expect(netos, id).toEqual(SALDOS_ESPERADOS);
      expect(vista.filas.map((f) => f.importe.bruto), id).toEqual(BRUTOS_ESPERADOS);
    }
  });

  it("R14 · el arrastre anterior al rango entra: sin el, la serie arrancaria en 500", async () => {
    const sinArrastre = { ...MENSAJEROS, cuentaMensajerosAntes: [] };
    const vista = await vistaUnicaDe(sinArrastre, "cuenta_por_pagar_mensajero", RANGO_CINCO_DIAS);
    const primera = vista.filas[0].importe;
    expect(primera.forma === "bruto_y_neto" && primera.neto).toBe("500.00");
    // Y CON arrastre da otra cosa: el metodo del arrastre no es decorativo.
    expect(SALDOS_ESPERADOS[0]).not.toBe("500.00");
  });

  it("R9 · un cubo sin movimiento REPITE el saldo anterior y no vale cero", async () => {
    const vista = await vistaUnicaDe(MENSAJEROS, "cuenta_por_pagar_mensajero", RANGO_CINCO_DIAS);
    const netoDeFila = (i: number) => {
      const imp = vista.filas[i].importe;
      return imp.forma === "bruto_y_neto" ? imp.neto : "SIN NETO";
    };

    // Los cubos 1 y 4 no tuvieron ni un movimiento.
    expect(netoDeFila(1)).toBe(netoDeFila(0));
    expect(netoDeFila(4)).toBe(netoDeFila(3));
    // Y NO son cero: un cero aqui seria «no se le debe nada a nadie ese dia», que es falso.
    expect(netoDeFila(1)).not.toBe("0.00");
    expect(netoDeFila(4)).not.toBe("0.00");
    expect(vista.filas[1].importe.bruto).not.toBe("0.00");
    expect(vista.filas[4].importe.bruto).not.toBe("0.00");
  });

  it("R9 · y con el libro entero vacio si valen cero: el caso de arriba no pasa por construccion", async () => {
    const vista = await vistaUnicaDe({}, "cuenta_por_pagar_mensajero", RANGO_CINCO_DIAS);
    expect(vista.filas.map((f) => f.importe.bruto)).toEqual(["0.00", "0.00", "0.00", "0.00", "0.00"]);
  });

  it("R13 · la ULTIMA fila es el total de la vista, campo a campo", async () => {
    for (const raw of [RANGO_CORTO, RANGO_CINCO_DIAS, RANGO_LARGO]) {
      for (const id of ACUMULADAS) {
        const vista = await vistaUnicaDe(mensajerosPara(cubosDe(id, raw).length), id, raw);
        const ultima = vista.filas[vista.filas.length - 1].importe;
        // Igualdad PROFUNDA del objeto entero: `forma`, `bruto`, `neto` y `moneda`. Publicar el
        // bruto DEL CUBO y el neto acumulado —que es la mutacion barata— muere aqui por `bruto`.
        expect(ultima, `${id} / ${raw}`).toEqual(vista.total);
        expect(ultima.bruto, `${id}: el bruto de la ultima fila no es el ACUMULADO`).toBe(
          vista.total.bruto,
        );
      }
    }
  });

  it("R13 · el bruto acumulado NO es el del ultimo cubo, asi que el caso de arriba muerde", async () => {
    const vista = await vistaUnicaDe(MENSAJEROS, "cuenta_por_pagar_mensajero", RANGO_CINCO_DIAS);
    // El ultimo cubo no tuvo movimiento: su bruto propio seria "0.00" y el acumulado es 5800.
    expect(vista.filas[4].importe.bruto).toBe("5800.00");
    expect(vista.total.bruto).toBe("5800.00");
  });

  it("R17 · el saldo de cada cubo es EXACTAMENTE el de `derivarCuentaPorPagar`", async () => {
    // La funcion compartida con `/mi-wallet`, llamada aqui directamente con los componentes
    // acumulados. Si el servicio reimplementara la resta, este caso seguiria verde solo mientras
    // las dos implementaciones coincidieran — por eso ademas se espia en
    // `analitica-financiera-derivacion.test.ts`.
    const vista = await vistaUnicaDe(MENSAJEROS, "cuenta_por_pagar_mensajero", RANGO_CINCO_DIAS);
    const esperado = [
      derivarCuentaPorPagar("4500.00", "1000.00").cuentaPorPagar,
      derivarCuentaPorPagar("4500.00", "1000.00").cuentaPorPagar,
      derivarCuentaPorPagar("4500.00", "1200.00").cuentaPorPagar,
      derivarCuentaPorPagar("4600.00", "1200.00").cuentaPorPagar,
      derivarCuentaPorPagar("4600.00", "1200.00").cuentaPorPagar,
    ];
    expect(
      vista.filas.map((f) => (f.importe.forma === "bruto_y_neto" ? f.importe.neto : null)),
    ).toEqual(esperado);
  });
});

/* -------------------------------------------------------------------------- */
/* 6. R12 — conservacion: Σ filas == total, en DECIMAL y como propiedad        */
/* -------------------------------------------------------------------------- */

describe("la suma de la serie es el total de la vista", () => {
  const CASOS = [
    { nombre: "rango corto (grano dia)", raw: RANGO_CORTO, semilla: 7 },
    { nombre: "cinco dias (grano dia)", raw: RANGO_CINCO_DIAS, semilla: 20260805 },
    { nombre: "181 dias (grano semana)", raw: RANGO_LARGO, semilla: 42 },
  ];

  for (const caso of CASOS) {
    it(`R12 · ${caso.nombre}: Σ de las filas == total, campo a campo y en decimal exacto`, async () => {
      const cubos = cubosDe("egresos", caso.raw).length;
      const libro = generarLibro(cubos, 400, caso.semilla);
      // El generador reparte de verdad: hay filas por cubo y hay cubos sin movimiento cuando el
      // rango es largo. Sin esto, un generador roto dejaria la propiedad verde por vacio.
      expect(libro.cajaPorCubo.length).toBeGreaterThan(0);
      expect(libro.caja.length).toBeGreaterThan(0);

      for (const id of DE_FLUJO) {
        const vista = await vistaUnicaDe(libro, id, caso.raw);
        expect(vista.filas, id).toHaveLength(cubos);

        // COMPARACION DECIMAL, no de coma flotante: con 400 movimientos de dos decimales, un
        // `Number(a) === Number(b)` empieza a mentir por el ultimo centimo.
        const sumaBruto = sumaDe(vista.filas, brutoDe);
        expect(
          sumaBruto.eq(dec(vista.total.bruto)),
          `${id}: Σ bruto de las filas ${sumaBruto.toFixed(2)} != total ${vista.total.bruto}`,
        ).toBe(true);

        if (vista.total.forma === "bruto_y_neto") {
          const sumaNeto = sumaDe(vista.filas, netoDe);
          expect(
            sumaNeto.eq(dec(vista.total.neto)),
            `${id}: Σ neto de las filas ${sumaNeto.toFixed(2)} != total ${vista.total.neto}`,
          ).toBe(true);
        }
      }
    });
  }

  it("R12 · el detector discrimina: perder un cubo rompe la igualdad", async () => {
    // Sin esto, un `Σ == total` sobre una serie de un solo cubo seria cierto por casualidad. Se
    // comprueba que la propiedad SI distingue una serie a la que le falta una fila.
    const libro = generarLibro(5, 200, 99);
    const vista = await vistaUnicaDe(libro, "egresos", RANGO_CINCO_DIAS);
    const mutilada = vista.filas.slice(0, -1);
    expect(sumaDe(mutilada, brutoDe).eq(dec(vista.total.bruto))).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* 7. R15 — el `total` NO se mueve: es el que la 127 publica hoy               */
/* -------------------------------------------------------------------------- */

/**
 * El libro de la regresion. Los `*PorCubo` traen numeros DISTINTOS del agregado a proposito: si
 * alguien derivara el total de los cubos —el atajo que ahorra una consulta— los esperados de
 * abajo cambiarian, y ese es justo el punto.
 */
const LIBRO_R15: Partial<DatosFinancieros> = {
  caja: [
    { categoria: "ingreso_flete", tipo: "ingreso", suma: "1000.00" },
    { categoria: "ingreso_iva_flete", tipo: "ingreso", suma: "130.00" },
    { categoria: "egreso_sueldo", tipo: "egreso", suma: "400.00" },
    { categoria: "ingreso_cod_recaudado", tipo: "ingreso", suma: "5000.00" },
    { categoria: "egreso_pago_tienda", tipo: "egreso", suma: "3000.00" },
    { categoria: "ingreso_reverso_pago_tienda", tipo: "ingreso", suma: "200.00" },
  ],
  cajaPorCubo: [
    { indiceCubo: 0, categoria: "ingreso_flete", tipo: "ingreso", suma: "1.00" },
    { indiceCubo: 0, categoria: "egreso_gasto", tipo: "egreso", suma: "2.00" },
  ] as readonly AgregadoCuboCategoriaCaja[],
  porMetodo: [
    { metodo: "efectivo", suma: "300.00" },
    { metodo: "simpe", suma: "100.00" },
  ],
  porTienda: [
    { tiendaId: "t-1", tipo: "credito", suma: "300.00" },
    { tiendaId: "t-1", tipo: "debito", suma: "40.00" },
    { tiendaId: "t-2", tipo: "credito", suma: "100.00" },
  ],
  saldoTiendas: [
    { tiendaId: "t-1", tipo: "credito", suma: "800.00" },
    { tiendaId: "t-1", tipo: "debito", suma: "300.00" },
    { tiendaId: "t-2", tipo: "credito", suma: "100.00" },
  ],
  cuentaMensajeros: [
    { tipo: "devengo", suma: "5000.00" },
    { tipo: "pago", suma: "2000.00" },
  ],
  cuentaMensajerosAntes: [{ tipo: "devengo", suma: "7.00" }],
  cuentaMensajerosPorCubo: [
    { indiceCubo: 0, tipo: "pago", suma: "3.00" },
  ] as readonly AgregadoCuboTipo[],
};

/**
 * LOS TOTALES ESCRITOS A MANO sobre `LIBRO_R15`, con la misma aritmetica que la 127:
 *   bruto    = Σ de todo lo agregado, SIN signo ⟨D1(c)⟩ = 9730.00 para las seis de caja;
 *   egresos  = Σ ingreso (1000+130+5000+200) − Σ egreso (400+3000) = 2930.00;
 *   enCaja   = lo mismo, por `derivarCaja`                          = 2930.00;
 *   ganancia = (1000+130) − 400, sin el dinero de terceros          =  730.00.
 */
const TOTALES_ESPERADOS: Readonly<Record<string, ImporteAnalitico>> = {
  ingreso_flete: { forma: "solo_bruto", bruto: "9730.00", moneda: MONEDA },
  ingreso_comision_cod: { forma: "solo_bruto", bruto: "9730.00", moneda: MONEDA },
  ingreso_iva: { forma: "solo_bruto", bruto: "9730.00", moneda: MONEDA },
  egresos: { forma: "bruto_y_neto", bruto: "9730.00", neto: "2930.00", moneda: MONEDA },
  dinero_en_caja: { forma: "bruto_y_neto", bruto: "9730.00", neto: "2930.00", moneda: MONEDA },
  ganancia_ordenex: { forma: "bruto_y_neto", bruto: "9730.00", neto: "730.00", moneda: MONEDA },
  cod_recaudado__por_metodo: {
    forma: "bruto_y_neto",
    bruto: "400.00",
    neto: "400.00",
    moneda: MONEDA,
  },
  cod_recaudado__por_tienda: {
    forma: "bruto_y_neto",
    bruto: "440.00",
    neto: "360.00",
    moneda: MONEDA,
  },
  cuenta_por_pagar_tienda: {
    forma: "bruto_y_neto",
    bruto: "1200.00",
    neto: "600.00",
    moneda: MONEDA,
  },
  cuenta_por_pagar_mensajero: {
    forma: "bruto_y_neto",
    bruto: "7000.00",
    neto: "3000.00",
    moneda: MONEDA,
  },
};

describe("anadir el desglose por fecha no mueve ni un total", () => {
  it("R15 · las ONCE vistas publican EXACTAMENTE el total escrito, con serie de por medio", async () => {
    const obtenido: Record<string, ImporteAnalitico> = {};
    for (const id of Object.keys(TOTALES_ESPERADOS)) {
      // Los ids de vista de `cod_recaudado` se resuelven consultando su metrica una vez.
      if (id.includes("__")) continue;
      for (const vista of await vistasDe(LIBRO_R15, id, RANGO_CINCO_DIAS)) {
        obtenido[vista.id] = vista.total;
      }
    }
    for (const vista of await vistasDe(LIBRO_R15, "cod_recaudado", RANGO_CINCO_DIAS)) {
      obtenido[vista.id] = vista.total;
    }
    expect(obtenido).toEqual(TOTALES_ESPERADOS);
  });

  it("R15 · y tampoco se mueve al cambiar de granularidad: el total no depende del troceo", async () => {
    for (const raw of [RANGO_CORTO, RANGO_LARGO]) {
      for (const id of IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA) {
        const vista = await vistaUnicaDe(LIBRO_R15, id, raw);
        expect(vista.total, `${id}`).toEqual(TOTALES_ESPERADOS[id]);
      }
    }
  });
});

/* -------------------------------------------------------------------------- */
/* 8. R19 — el techo de puntos, a nivel de SERVICIO                            */
/* -------------------------------------------------------------------------- */

describe("ningun rango admisible produce mas puntos de los que el tablero puede pintar", () => {
  /** Rangos escritos con fechas fijas, con su numero de dias calendario CR inclusivos. */
  const RANGOS = [
    { dias: 1, raw: { rango: "personalizado", desde: "2026-06-30", hasta: "2026-06-30" } },
    { dias: 62, raw: { rango: "personalizado", desde: "2026-04-30", hasta: "2026-06-30" } },
    { dias: 63, raw: { rango: "personalizado", desde: "2026-04-29", hasta: "2026-06-30" } },
    { dias: 365, raw: { rango: "personalizado", desde: "2025-07-01", hasta: "2026-06-30" } },
    { dias: 366, raw: { rango: "personalizado", desde: "2025-06-30", hasta: "2026-06-30" } },
  ];

  for (const { dias, raw } of RANGOS) {
    it(`R19 · un rango de ${dias} dias no pasa de ${TOPE_PUNTOS_SERIE} filas en ninguna metrica`, async () => {
      for (const id of IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA) {
        const vista = await vistaUnicaDe(mensajerosPara(cubosDe(id, raw).length), id, raw);
        expect(vista.filas.length, `${id}: ${vista.filas.length} filas con ${dias} dias`)
          .toBeLessThanOrEqual(TOPE_PUNTOS_SERIE);
        // Y no por vacio: la serie es densa, asi que siempre hay al menos una fila.
        expect(vista.filas.length, id).toBeGreaterThan(0);
      }
    });
  }

  it("R19 · el caso limite se mide de verdad: 62 dias dan 62 filas y 63 pasan a semana", async () => {
    const de62 = await vistaUnicaDe({}, "egresos", RANGOS[1].raw);
    const de63 = await vistaUnicaDe({}, "egresos", RANGOS[2].raw);
    expect(de62.filas).toHaveLength(TOPE_PUNTOS_SERIE);
    expect(de62.granularidad).toBe("dia");
    expect(de63.granularidad).toBe("semana");
    expect(de63.filas.length).toBeLessThan(de62.filas.length);
  });
});

/* -------------------------------------------------------------------------- */
/* 9. R27 — total y filas, SIEMPRE la misma variante de la union               */
/* -------------------------------------------------------------------------- */

describe("el importe de cada fila sale de la misma funcion que el total de su vista", () => {
  /** Un libro con filas en TODOS los cubos: el centinela de abajo no puede pasar por vacio. */
  function libroDenso(cubos: number): Partial<DatosFinancieros> {
    return {
      ...LIBRO_R15,
      cajaPorCubo: Array.from({ length: cubos }, (_, indiceCubo) => [
        { indiceCubo, categoria: "ingreso_flete", tipo: "ingreso", suma: "10.00" },
        { indiceCubo, categoria: "egreso_gasto", tipo: "egreso", suma: "4.00" },
      ]).flat() as readonly AgregadoCuboCategoriaCaja[],
      cuentaMensajerosPorCubo: Array.from({ length: cubos }, (_, indiceCubo) => ({
        indiceCubo,
        tipo: "devengo" as const,
        suma: "3.00",
      })) as readonly AgregadoCuboTipo[],
    };
  }

  it("R27 · en cada vista, el total y TODAS sus filas comparten variante de la union", async () => {
    let filasVistas = 0;
    let vistasVistas = 0;

    for (const raw of [RANGO_CINCO_DIAS, RANGO_LARGO]) {
      const cubos = cubosDe("egresos", raw).length;
      const datos = libroDenso(cubos);
      for (const id of IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA) {
        const vista = await vistaUnicaDe(datos, id, raw);
        vistasVistas += 1;
        for (const fila of vista.filas) {
          filasVistas += 1;
          expect(
            fila.importe.forma,
            `${id} / ${fila.cubo}: la fila no tiene la forma del total (${vista.total.forma})`,
          ).toBe(vista.total.forma);
          // Y la clave `neto` existe si y solo si la forma lo dice, en el objeto SERIALIZADO:
          // una fila con `neto` de mas en una vista `solo_bruto` compila perfectamente.
          const claves = Object.keys(JSON.parse(JSON.stringify(fila.importe))).sort();
          expect(claves, `${id} / ${fila.cubo}`).toEqual(
            vista.total.forma === "solo_bruto"
              ? ["bruto", "forma", "moneda"]
              : ["bruto", "forma", "moneda", "neto"],
          );
        }
      }
    }

    // CENTINELA: el recorrido tiene que haber visto MUCHAS filas. Hasta esta feature el guardia
    // de la 183 comprobaba esto sobre vistas casi sin filas, y por eso pasaba por vacio.
    expect(vistasVistas).toBe(14);
    expect(filasVistas, "el recorrido de R27 vio pocas filas: podria estar pasando por vacio")
      .toBeGreaterThan(50);
  });

  it("R27 · `ingreso_flete` publica TODA su serie como solo_bruto", async () => {
    const cubos = cubosDe("ingreso_flete", RANGO_CINCO_DIAS).length;
    const vista = await vistaUnicaDe(libroDenso(cubos), "ingreso_flete", RANGO_CINCO_DIAS);
    expect(vista.total.forma).toBe("solo_bruto");
    expect(vista.filas.map((f) => f.importe.forma)).toEqual(Array(cubos).fill("solo_bruto"));
    // Y ni una fila lleva `neto` escondido en el objeto serializado.
    expect(JSON.stringify(vista)).not.toContain('"neto"');
  });

  it("R27 · `egresos` publica TODA su serie como bruto_y_neto", async () => {
    const cubos = cubosDe("egresos", RANGO_CINCO_DIAS).length;
    const vista = await vistaUnicaDe(libroDenso(cubos), "egresos", RANGO_CINCO_DIAS);
    expect(vista.total.forma).toBe("bruto_y_neto");
    expect(vista.filas.map((f) => f.importe.forma)).toEqual(Array(cubos).fill("bruto_y_neto"));
    // Con neto de verdad: el fixture tiene las dos direcciones en cada cubo.
    for (const fila of vista.filas) {
      expect(fila.importe.forma === "bruto_y_neto" && fila.importe.neto).toBe("6.00");
    }
  });
});

/* -------------------------------------------------------------------------- */
/* 10. R28 — ni un cubo compuesto                                              */
/* -------------------------------------------------------------------------- */

describe("la vista por fecha no gana ninguna dimension", () => {
  it("R28 · toda clave de una vista temporal es SOLO una fecha, sin separador de dimensiones", async () => {
    let claves = 0;
    for (const raw of [RANGO_CORTO, RANGO_CINCO_DIAS, RANGO_LARGO]) {
      for (const id of IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA) {
        const vista = await vistaUnicaDe(mensajerosPara(cubosDe(id, raw).length), id, raw);
        for (const fila of vista.filas) {
          claves += 1;
          expect(fila.cubo, `${id}: cubo compuesto`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
          for (const separador of ["|", "::", "__", "#", "/", " "]) {
            expect(fila.cubo.includes(separador), `${id}: ${fila.cubo} lleva "${separador}"`).toBe(
              false,
            );
          }
          expect(Object.keys(fila).sort(), id).toEqual(["cubo", "importe"]);
        }
      }
    }
    expect(claves, "el censo de claves no miro nada").toBeGreaterThan(50);
  });
});

/* -------------------------------------------------------------------------- */
/* 11. R26 — determinismo                                                      */
/* -------------------------------------------------------------------------- */

describe("dos ejecuciones con los mismos datos producen el mismo DTO", () => {
  it("R26 · el DTO entero es identico entre dos corridas, en las dos granularidades", async () => {
    for (const raw of [RANGO_CINCO_DIAS, RANGO_LARGO]) {
      for (const id of IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA) {
        const primera = await vistasDe(LIBRO_R15, id, raw);
        const segunda = await vistasDe(LIBRO_R15, id, raw);
        // Igualdad PROFUNDA del objeto entero, no de un campo: un `Date.now()` colado en
        // cualquier rincon del DTO se ve aqui.
        expect(segunda, id).toEqual(primera);
        expect(JSON.stringify(segunda), id).toBe(JSON.stringify(primera));
      }
    }
  });

  it("R26 · y el mismo servicio consultado dos veces tampoco acumula estado", async () => {
    const { servicio } = armarServicio(MENSAJEROS);
    const consulta = consultaDe("cuenta_por_pagar_mensajero", RANGO_CINCO_DIAS);
    const a = await servicio.consultar(consulta);
    const b = await servicio.consultar(consulta);
    expect(b).toEqual(a);
    // El acumulado corrido vive en variables locales del manejador: si se hubiera escrito como
    // estado de la instancia, la segunda corrida arrancaria desde el saldo de la primera.
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});
