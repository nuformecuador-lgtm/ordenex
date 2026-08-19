import { describe, it, expect } from "vitest";

import {
  CATEGORIA_OTROS,
  agregarPorSemana,
  agruparSeriesEnOtros,
  esAgregableTemporal,
  prepararPanel,
  totalizarPuntos,
  type FuenteSerie,
} from "@/app/(app)/analitica/_components/operativo/agregacion";
import { categoriaDePunto } from "@/app/(app)/analitica/_components/operativo/textos";
import {
  MAX_CATEGORIAS_LEGIBLES,
  MAX_PUNTOS_SERIE,
  prepararSeries,
} from "@/components/private/analytics/topes";
import type { SerieDato } from "@/components/private/analytics/tipos";
import type { MetricaUnidad } from "@/lib/analytics/types";
import {
  PENUMBRA,
  type CuboAgregado,
  type PuntoSerie,
  type SerieOperativa,
} from "@/lib/types/analitica-operativa";

// Feature 131 (T1.2) — R9, R15, R16, R17, R18, R20.
//
// Los seis viven en un modulo PURO a proposito: son los que de verdad pueden equivocarse
// y ninguno necesita jsdom, ni red, ni mocks para demostrarlo.

const OPCIONES = { grafica: "lineas" as const, categoriaDePunto };

function serie(
  puntos: readonly PuntoSerie[],
  unidad: MetricaUnidad = "conteo",
  metricaId = "entregas",
): SerieOperativa {
  return {
    metricaId,
    unidad,
    unidadDeConteo: unidad === "conteo" ? "gestion" : "tiempo",
    rango: {
      preset: "personalizado",
      desde: new Date("2026-07-01T06:00:00.000Z"),
      hasta: new Date("2026-07-31T06:00:00.000Z"),
      desdeFecha: "2026-07-01",
      hastaFecha: "2026-07-30",
    },
    puntos,
    cobertura: { fechasNoComparables: [], penumbra: PENUMBRA },
  };
}

function fuente(s: SerieOperativa, etiqueta = "Entregas"): FuenteSerie {
  return { etiqueta, serie: s };
}

/** Un cubo del servidor (176) con su `valor` YA calculado: la UI no divide. */
function cubo(fecha: string, valor: number | null): CuboAgregado {
  return { fecha, desdeFecha: fecha, hastaFecha: fecha, numerador: 0, denominador: 10, valor };
}

/** `n` dias consecutivos desde `2026-01-01`, con valor 1 cada uno. */
function diasSeguidos(n: number, unidad: MetricaUnidad = "conteo"): PuntoSerie[] {
  const puntos: PuntoSerie[] = [];
  const base = Date.UTC(2026, 0, 1);
  for (let i = 0; i < n; i += 1) {
    const fecha = new Date(base + i * 86_400_000).toISOString().slice(0, 10);
    puntos.push({ fecha, valor: unidad === "porcentaje" ? 0.5 : 1 });
  }
  return puntos;
}

/* -------------------------------------------------------------------------- */
/* R9 — el total que incluye el dia en curso                                   */
/* -------------------------------------------------------------------------- */

describe("Feature 131 (R9) — un agregado que incluye el dia en curso se anuncia parcial", () => {
  it("un total que incluye el dia en curso se marca parcial", () => {
    const total = totalizarPuntos([
      { fecha: "2026-08-01", valor: 10 },
      { fecha: "2026-08-02", valor: 5 },
      { fecha: "2026-08-03", valor: 2, parcial: true, corteAt: "2026-08-03T20:35:00.000Z" },
    ]);
    expect(total.valor).toBe(17);
    // Presentar 17 como un total cerrado seria mezclar dos dias cerrados con un dia que
    // aun no ha terminado y llamarlo lo mismo.
    expect(total.parcial).toBe(true);
    expect(total.corteAt).toBe("2026-08-03T20:35:00.000Z");
  });

  it("un total de dias todos cerrados NO se marca parcial", () => {
    const total = totalizarPuntos([
      { fecha: "2026-08-01", valor: 10 },
      { fecha: "2026-08-02", valor: 5 },
    ]);
    expect(total.parcial).toBe(false);
    expect(total.corteAt).toBeUndefined();
  });

  it("con varios puntos parciales se conserva el `corteAt` MAYOR", () => {
    const total = totalizarPuntos([
      { fecha: "2026-08-03", valor: 1, parcial: true, corteAt: "2026-08-03T12:00:00.000Z" },
      { fecha: "2026-08-03", valor: 1, parcial: true, corteAt: "2026-08-03T20:00:00.000Z" },
    ]);
    expect(total.corteAt).toBe("2026-08-03T20:00:00.000Z");
  });
});

/* -------------------------------------------------------------------------- */
/* R20 — `null` no es cero                                                     */
/* -------------------------------------------------------------------------- */

describe("Feature 131 (R20) — el dato ausente se propaga", () => {
  it("`null` se propaga como `null` y no como cero", () => {
    // Un denominador 0 devuelve `null` (R10/R14 de la 126). Convertirlo en `0` afirma
    // que la medida fue cero, que es una afirmacion distinta de «no se sabe».
    const preparado = prepararPanel(
      [fuente(serie([{ fecha: "2026-08-01", valor: null }, { fecha: "2026-08-02", valor: 4 }]))],
      OPCIONES,
    );
    expect(preparado.series[0]?.puntos.map((p) => p.valor)).toEqual([null, 4]);
    expect(preparado.series[0]?.puntos).toHaveLength(2);
  });

  it("un total de puros ausentes es `null`, no `0`", () => {
    expect(totalizarPuntos([{ fecha: "2026-08-01", valor: null }]).valor).toBeNull();
  });

  it("la agregacion semanal tampoco convierte el ausente en cero", () => {
    const cubos = agregarPorSemana(
      [
        { fecha: "2026-01-05", valor: null },
        { fecha: "2026-01-06", valor: null },
      ],
      "conteo",
    );
    expect(cubos).toHaveLength(1);
    expect(cubos[0]?.valor).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* R15 — «otros»                                                               */
/* -------------------------------------------------------------------------- */

describe("Feature 131 (R15) — la cola de categorias se agrupa en «otros»", () => {
  const muchas: SerieDato[] = Array.from({ length: 9 }, (_, i) => ({
    id: `c${i}`,
    etiqueta: `c${i}`,
    puntos: [{ categoria: "2026-08-01", valor: 100 - i }],
  }));

  it("mas de 5 categorias se agrupan en otros conservando las 5 mayores", () => {
    const { items, agrupadas } = agruparSeriesEnOtros(muchas);

    // El resultado cabe en el techo de LEGIBILIDAD del tablero. Ya no es una cuestion de
    // color —la paleta tiene veinte tokens y cicla desde el 2026-08-18, y `prepararSeries` ya
    // no recorta ni lanza—: es que un donut de doce porciones no se lee.
    expect(items).toHaveLength(MAX_CATEGORIAS_LEGIBLES);
    expect(() => prepararSeries(items)).not.toThrow();

    // Las mayores por magnitud sobreviven, y la cola queda declarada en un cubo que se
    // llama por su nombre: «otros» no es una categoria del negocio.
    expect(items.slice(0, 4).map((s) => s.id)).toEqual(["c0", "c1", "c2", "c3"]);
    expect(items[4]?.id).toBe(CATEGORIA_OTROS);
    expect(agrupadas).toBe(5);
    expect(items[4]?.puntos[0]?.valor).toBe(96 + 95 + 94 + 93 + 92);
  });

  it("con 5 categorias o menos no se agrupa nada y no aparece «otros»", () => {
    const { items, agrupadas } = agruparSeriesEnOtros(muchas.slice(0, 5));
    expect(agrupadas).toBe(0);
    expect(items.map((s) => s.id)).not.toContain(CATEGORIA_OTROS);
  });

  it("una serie desagregada con 19 estados no revienta el tope del paquete", () => {
    const puntos: PuntoSerie[] = Array.from({ length: 19 }, (_, i) => ({
      fecha: "2026-08-01",
      dimension: `estado_${i}`,
      valor: 19 - i,
    }));
    const preparado = prepararPanel([fuente(serie(puntos))], OPCIONES);
    expect(preparado.categoriasAgrupadas).toBeGreaterThan(0);
    expect(() => prepararSeries(preparado.series)).not.toThrow();
  });
});

/* -------------------------------------------------------------------------- */
/* R16 / R17 / R18 — el techo de puntos                                        */
/* -------------------------------------------------------------------------- */

describe("Feature 131 (R16) — por encima del techo, los conteos se agregan", () => {
  it("mas de 62 puntos se agregan por semana y se anuncia el grano", () => {
    const preparado = prepararPanel([fuente(serie(diasSeguidos(90)))], OPCIONES);

    expect(preparado.grano).toBe("semana");
    expect(preparado.modo).toBe("serie");
    // Devolver los puntos crudos haria lanzar `PuntosExcedidosError` al paquete.
    expect(preparado.series[0]?.puntos.length).toBeLessThanOrEqual(MAX_PUNTOS_SERIE);
    expect(() => prepararSeries(preparado.series)).not.toThrow();
    // Y la suma sigue siendo exacta: 90 dias a 1 son 90.
    expect(preparado.total?.valor).toBe(90);
  });

  it("por debajo del techo no se agrega nada: el grano sigue siendo diario", () => {
    const preparado = prepararPanel([fuente(serie(diasSeguidos(30)))], OPCIONES);
    expect(preparado.grano).toBe("dia");
    expect(preparado.series[0]?.puntos).toHaveLength(30);
  });
});

describe("Feature 131 (R17) — jamas una media de medias", () => {
  // REESCRITOS POR LA FICHA 182 (T1.4, R16). Estos dos casos afirmaban el modo de aviso
  // `rango_excedido`: por encima del techo, un `porcentaje` o un `segundos` no devolvia NI
  // serie NI cifra, porque calcularlas en el cliente habria sido una media de medias.
  //
  // La propiedad que protegian SIGUE VIVA y sigue afirmada aqui —el cliente no promedia
  // cocientes—; lo que cambio es COMO se cumple: ahora hay una fuente que suma antes de
  // dividir (176), asi que la serie y la cifra vienen de sus CUBOS. Se reescriben en vez de
  // borrarse justamente por eso: borrar el caso habria dejado la propiedad sin vigilar.
  it("una metrica de porcentaje nunca se agrega promediando dias: se pinta con los cubos del servidor", () => {
    const preparado = prepararPanel(
      [fuente(serie(diasSeguidos(90, "porcentaje"), "porcentaje", "tasa_entrega"))],
      OPCIONES,
      {
        semana: [cubo("2026-01-05", 0.2), cubo("2026-01-12", 0.4)],
        periodo: [cubo("2026-01-01", 0.31)],
      },
    );

    expect(preparado.modo).toBe("serie");
    expect(preparado.desdeCubos).toBe(true);
    // Las categorias son las FECHAS DE LOS CUBOS, no 13 semanas recalculadas en el cliente.
    expect(preparado.series[0]?.puntos.map((p) => p.categoria)).toEqual([
      "2026-01-05",
      "2026-01-12",
    ]);
    expect(preparado.total?.valor).toBe(0.31);
    // Y la agregacion temporal del cliente sigue sin admitir esta unidad: la unica semana
    // que toca un `porcentaje` es la que calculo el servidor.
    expect(esAgregableTemporal("porcentaje")).toBe(false);
    expect(() => agregarPorSemana(diasSeguidos(90, "porcentaje"), "porcentaje")).toThrow();
  });

  it("lo mismo con `segundos`: `tiempo_ciclo` tampoco se promedia", () => {
    const preparado = prepararPanel(
      [fuente(serie(diasSeguidos(90, "segundos"), "segundos", "tiempo_ciclo"))],
      OPCIONES,
      { semana: [cubo("2026-01-05", 900)], periodo: [cubo("2026-01-01", 1234)] },
    );
    expect(preparado.modo).toBe("serie");
    expect(preparado.desdeCubos).toBe(true);
    expect(preparado.series[0]?.puntos.map((p) => p.valor)).toEqual([900]);
    expect(preparado.total?.valor).toBe(1234);
    expect(esAgregableTemporal("segundos")).toBe(false);
    expect(() => agregarPorSemana(diasSeguidos(90, "segundos"), "segundos")).toThrow();
  });

  it("por debajo del techo el porcentaje SI pinta serie, con su razon cruda", () => {
    const preparado = prepararPanel(
      [fuente(serie([{ fecha: "2026-08-01", valor: 0.842 }], "porcentaje", "tasa_entrega"))],
      OPCIONES,
      { periodo: [cubo("2026-08-01", 0.777)] },
    );
    expect(preparado.modo).toBe("serie");
    expect(preparado.desdeCubos).toBe(false);
    // R19 — cruda: `formato.ts` la pinta como 84,2 %. Multiplicarla aqui daria 8420 %.
    expect(preparado.series[0]?.puntos[0]?.valor).toBe(0.842);
    // Y ahora SI hay total, tambien en rango corto: el del cubo `periodo`, que NO es el
    // valor del punto diario (0,842) ni un promedio de los puntos.
    expect(preparado.total?.valor).toBe(0.777);
  });
});

describe("Feature 131 (R18) — el cubo agregado hereda la parcialidad", () => {
  it("el cubo semanal que contiene el dia en curso hereda `parcial` y el `corteAt` mayor", () => {
    const cubos = agregarPorSemana(
      [
        { fecha: "2026-08-03", valor: 4 }, // lunes, cerrado
        { fecha: "2026-08-04", valor: 3 }, // martes, cerrado
        { fecha: "2026-08-05", valor: 1, parcial: true, corteAt: "2026-08-05T20:35:00.000Z" },
      ],
      "conteo",
    );

    expect(cubos).toHaveLength(1);
    expect(cubos[0]?.fecha).toBe("2026-08-03");
    expect(cubos[0]?.valor).toBe(8);
    // Sin esto, un dia abierto se esconde dentro de una semana que se lee como cerrada.
    expect(cubos[0]?.parcial).toBe(true);
    expect(cubos[0]?.corteAt).toBe("2026-08-05T20:35:00.000Z");
  });

  it("una semana entera de dias cerrados no se marca parcial", () => {
    const cubos = agregarPorSemana(
      [
        { fecha: "2026-08-03", valor: 4 },
        { fecha: "2026-08-04", valor: 3 },
      ],
      "conteo",
    );
    expect(cubos[0]?.parcial).toBeUndefined();
  });

  it("y el total del panel agregado tambien lo hereda", () => {
    const puntos = [
      ...diasSeguidos(89),
      { fecha: "2026-03-31", valor: 1, parcial: true as const, corteAt: "2026-03-31T20:00:00.000Z" },
    ];
    const preparado = prepararPanel([fuente(serie(puntos))], OPCIONES);
    expect(preparado.grano).toBe("semana");
    expect(preparado.total?.parcial).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Multi-metrica y donut                                                       */
/* -------------------------------------------------------------------------- */

describe("Feature 131 — composicion de paneles", () => {
  it("un panel con cuatro metricas produce cuatro series con su etiqueta", () => {
    const preparado = prepararPanel(
      [
        fuente(serie([{ fecha: "2026-08-01", valor: 5 }], "conteo", "entregas"), "Entregas"),
        fuente(serie([{ fecha: "2026-08-01", valor: 2 }], "conteo", "devoluciones"), "Devoluciones"),
        fuente(serie([{ fecha: "2026-08-01", valor: 1 }], "conteo", "rechazos"), "Rechazos"),
        fuente(serie([{ fecha: "2026-08-01", valor: 3 }], "conteo", "incidentes"), "Incidentes"),
      ],
      { grafica: "barras", categoriaDePunto },
    );
    expect(preparado.series.map((s) => s.etiqueta)).toEqual([
      "Entregas",
      "Devoluciones",
      "Rechazos",
      "Incidentes",
    ]);
    expect(preparado.total?.valor).toBe(11);
  });

  it("el donut colapsa el tiempo y agrupa segmentos, sin pasar del tope", () => {
    const puntos: PuntoSerie[] = Array.from({ length: 8 }, (_, i) => ({
      fecha: "2026-08-01",
      dimension: `estado_${i}`,
      valor: 8 - i,
    })).concat(
      Array.from({ length: 8 }, (_, i) => ({
        fecha: "2026-08-02",
        dimension: `estado_${i}`,
        valor: 1,
      })),
    );
    const preparado = prepararPanel([fuente(serie(puntos, "conteo", "ordenes_por_estado"))], {
      grafica: "donut",
      categoriaDePunto,
    });
    expect(preparado.series).toHaveLength(1);
    expect(preparado.series[0]?.puntos.length).toBeLessThanOrEqual(MAX_CATEGORIAS_LEGIBLES);
    expect(preparado.series[0]?.puntos.at(-1)?.categoria).toBe(CATEGORIA_OTROS);
    expect(preparado.categoriasAgrupadas).toBeGreaterThan(0);
  });

  it("una serie sin puntos se declara vacia, no como error ni como cero", () => {
    const preparado = prepararPanel([fuente(serie([]))], OPCIONES);
    expect(preparado.vacio).toBe(true);
    expect(preparado.total?.valor).toBeNull();
  });
});
