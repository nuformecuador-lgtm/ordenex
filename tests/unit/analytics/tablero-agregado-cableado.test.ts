import { describe, it, expect } from "vitest";

import {
  agregarPorSemana,
  prepararPanel,
  totalDelPeriodo,
  type FuenteSerie,
} from "@/app/(app)/analitica/_components/operativo/agregacion";
import { categoriaDePunto } from "@/app/(app)/analitica/_components/operativo/textos";
import type { MetricaUnidad } from "@/lib/analytics/types";
import {
  PENUMBRA,
  type CuboAgregado,
  type PuntoSerie,
  type SerieOperativa,
} from "@/lib/types/analitica-operativa";

// Feature 182 (T1.3) — R2, R3, R5 y el caso de comportamiento de R15.
//
// Modulo PURO: sin jsdom, sin red, sin mocks. Aqui vive la aritmetica, que es donde un
// verde barato es mas facil y mas caro:
//
//   R5 — con dias de volumen IGUAL, sumar-antes-de-dividir y media-de-medias dan EL MISMO
//        numero. Un fixture equilibrado pasaria con la formula mala y no probaria nada, asi
//        que el de aqui es deliberadamente DESIGUAL y el caso afirma las dos cosas: el
//        valor correcto Y que no es el de la media de medias.
//   R2 — el fixture ancla los cubos en fechas que NO son el lunes ISO de sus puntos
//        diarios. Si alguien construyese la serie cubeteando en el cliente, las etiquetas
//        y los valores serian otros y el caso caeria.

const OPCIONES = { grafica: "lineas" as const, categoriaDePunto };

function serie(
  puntos: readonly PuntoSerie[],
  unidad: MetricaUnidad,
  metricaId = "tasa_entrega",
): SerieOperativa {
  return {
    metricaId,
    unidad,
    unidadDeConteo: unidad === "conteo" ? "gestion" : "tiempo",
    rango: {
      preset: "personalizado",
      desde: new Date("2026-01-01T06:00:00.000Z"),
      hasta: new Date("2026-03-31T06:00:00.000Z"),
      desdeFecha: "2026-01-01",
      hastaFecha: "2026-03-31",
    },
    puntos,
    cobertura: { fechasNoComparables: [], penumbra: PENUMBRA },
  };
}

function fuente(s: SerieOperativa, etiqueta = "Tasa de entrega"): FuenteSerie {
  return { etiqueta, serie: s };
}

/**
 * Un cubo del servidor. `numerador` y `denominador` viajan porque el contrato los trae
 * (R7 los necesita), pero el `valor` se declara APARTE: es el que el servidor obtuvo
 * dividiendo UNA vez sobre todo el cubo, y este fixture no lo recalcula.
 */
function cubo(
  fecha: string,
  numerador: number,
  denominador: number,
  valor: number | null,
  extra: Partial<CuboAgregado> = {},
): CuboAgregado {
  return { fecha, desdeFecha: fecha, hastaFecha: fecha, numerador, denominador, valor, ...extra };
}

/** `n` dias consecutivos desde `2026-01-01`. */
function diasSeguidos(n: number, valor: number): PuntoSerie[] {
  const base = Date.UTC(2026, 0, 1);
  return Array.from({ length: n }, (_, i) => ({
    fecha: new Date(base + i * 86_400_000).toISOString().slice(0, 10),
    valor,
  }));
}

/* -------------------------------------------------------------------------- */
/* R2 — las categorias salen de los cubos, no de una semana recalculada        */
/* -------------------------------------------------------------------------- */

describe("Feature 182 (R2) — la serie semanal es la del servidor", () => {
  it("las categorias de la serie semanal son las `fecha` de los cubos del servidor, no una semana recalculada en el cliente", () => {
    // Los 90 dias empiezan en JUEVES 2026-01-01: el lunes ISO de esa primera semana es
    // 2025-12-29. Los cubos, en cambio, vienen anclados en dias 1, 8 y 15 —fechas que NO
    // son lunes ISO de nada—, asi que si alguien cubeteara en el cliente las etiquetas
    // saldrian distintas (y serian 13, no 3).
    const puntos = diasSeguidos(90, 0.5);
    const cubos = [
      cubo("2026-01-01", 10, 20, 0.5),
      cubo("2026-01-08", 30, 100, 0.3),
      cubo("2026-01-15", 7, 10, 0.7),
    ];

    const preparado = prepararPanel([fuente(serie(puntos, "porcentaje"))], OPCIONES, {
      semana: cubos,
      periodo: [cubo("2026-01-01", 47, 130, 47 / 130)],
    });

    expect(preparado.series[0]?.puntos.map((p) => p.categoria)).toEqual([
      "2026-01-01",
      "2026-01-08",
      "2026-01-15",
    ]);
    // Ninguna etiqueta es el lunes ISO que el cliente habria calculado.
    expect(preparado.series[0]?.puntos.map((p) => p.categoria)).not.toContain("2025-12-29");
    // Y los valores son los del cubo, no una recomposicion de los puntos diarios (0,5).
    expect(preparado.series[0]?.puntos.map((p) => p.valor)).toEqual([0.5, 0.3, 0.7]);
    expect(preparado.grano).toBe("semana");
    expect(preparado.desdeCubos).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* R3 — sin cubos del servidor, se falla en voz alta                           */
/* -------------------------------------------------------------------------- */

describe("Feature 182 (R3) — el cliente no cubetea tasas ni tiempos", () => {
  it("una tasa larga sin cubos del servidor falla ruidosamente en vez de cubetearse en el cliente", () => {
    const largos = [fuente(serie(diasSeguidos(90, 0.5), "porcentaje"))];

    // Un `return` silencioso —o un cubeteo «best effort»— reintroduciria la media de
    // medias por la puerta de la UI, que es exactamente lo que el servicio evita.
    expect(() => prepararPanel(largos, OPCIONES)).toThrow(/cubos semanales del servidor/);
    expect(() => prepararPanel(largos, OPCIONES, { semana: [] })).toThrow(
      /cubos semanales del servidor/,
    );

    // Lo mismo con `segundos`, que es la otra unidad agregable.
    expect(() =>
      prepararPanel([fuente(serie(diasSeguidos(90, 600), "segundos", "tiempo_ciclo"))], OPCIONES),
    ).toThrow(/cubos semanales del servidor/);

    // Y con los cubos SI se prepara: el fallo es por su ausencia, no por el rango.
    expect(() =>
      prepararPanel(largos, OPCIONES, { semana: [cubo("2026-01-01", 1, 2, 0.5)] }),
    ).not.toThrow();
  });
});

/* -------------------------------------------------------------------------- */
/* R5 — la cifra total, con dias DESIGUALES                                    */
/* -------------------------------------------------------------------------- */

describe("Feature 182 (R5) — la cifra total la calculo el servidor sumando antes de dividir", () => {
  it("con dias de volumen desigual la cifra total es la del cubo periodo (2/11) y NO la media de los valores diarios (0,55)", () => {
    // dia 1: 1 de 1   -> valor 1,0
    // dia 2: 1 de 10  -> valor 0,1
    // sumando ANTES de dividir: 2/11 = 0,1818...   media de los dos valores: 0,55
    // Con volumenes IGUALES las dos formulas coinciden y el caso no probaria nada.
    const puntos: PuntoSerie[] = [
      { fecha: "2026-01-01", valor: 1 },
      { fecha: "2026-01-02", valor: 0.1 },
    ];
    const periodo = [cubo("2026-01-01", 2, 11, 2 / 11)];

    const preparado = prepararPanel([fuente(serie(puntos, "porcentaje"))], OPCIONES, { periodo });

    expect(preparado.total?.valor).toBeCloseTo(2 / 11, 10);
    // LA SEGUNDA ASERCION ES OBLIGATORIA: sin ella, una media de medias con el mismo
    // fixture pasaria el caso.
    expect(preparado.total?.valor).not.toBeCloseTo(0.55, 5);
    expect(preparado.total?.parcial).toBe(false);
    expect(preparado.total?.sinGestiones).toBe(false);
  });

  it("el total sale del cubo `periodo` y no de los cubos semanales", () => {
    // Mismo dato en dos formas: si alguien promediase los cubos semanales (0,9 y 0,1 -> 0,5)
    // en vez de leer el cubo del periodo, el numero cambiaria.
    const preparado = prepararPanel(
      [fuente(serie(diasSeguidos(90, 0.5), "porcentaje"))],
      OPCIONES,
      {
        semana: [cubo("2026-01-05", 9, 10, 0.9), cubo("2026-01-12", 1, 10, 0.1)],
        periodo: [cubo("2026-01-01", 10, 100, 0.1)],
      },
    );
    expect(preparado.total?.valor).toBe(0.1);
    expect(preparado.total?.valor).not.toBe(0.5);
  });

  it("un cubo con denominador cero no vale `0`: dice que no hubo gestiones", () => {
    // R7 en el modulo puro: el `null` con `denominador: 0` es «no hubo nada que dividir»,
    // y `valor ?? 0` lo convertiria en una afirmacion sobre un dato que no existe.
    const total = totalDelPeriodo([cubo("2026-01-01", 0, 0, null)]);
    expect(total?.valor).toBeNull();
    expect(total?.sinGestiones).toBe(true);
  });

  it("un cubo parcial arrastra su hora de corte al total", () => {
    const total = totalDelPeriodo([
      cubo("2026-01-01", 3, 4, 0.75, { parcial: true, corteAt: "2026-08-03T20:35:00.000Z" }),
    ]);
    expect(total?.parcial).toBe(true);
    expect(total?.corteAt).toBe("2026-08-03T20:35:00.000Z");
  });
});

/* -------------------------------------------------------------------------- */
/* R15 — la semana del cliente, acotada a los conteos                          */
/* -------------------------------------------------------------------------- */

describe("Feature 182 (R15) — la semana del cliente solo agrega conteos", () => {
  it("`agregarPorSemana` rechaza toda unidad que no sea conteo: la semana del cliente no toca tasas ni tiempos", () => {
    const dias = diasSeguidos(90, 0.5);

    // (a) La funcion RECHAZA. No devuelve algo aproximado: lanza.
    expect(() => agregarPorSemana(dias, "porcentaje")).toThrow(/solo admite conteos/);
    expect(() => agregarPorSemana(dias, "segundos")).toThrow(/solo admite conteos/);
    expect(() => agregarPorSemana(dias, "moneda")).toThrow(/solo admite conteos/);

    // (b) Y sigue viva para lo suyo: es el UNICO camino de los conteos largos, porque el
    // modo agregado del servidor los rechaza por contrato.
    expect(agregarPorSemana([{ fecha: "2026-01-06", valor: 2 }], "conteo")).toEqual([
      { fecha: "2026-01-05", valor: 2 },
    ]);

    // (c) EL ACOTAMIENTO, que es lo que de verdad se pide: la ruta de `porcentaje` por
    // encima del techo NO la invoca. Si alguien la cableara ahi, esta preparacion —que hoy
    // pasa— empezaria a lanzar.
    expect(() =>
      prepararPanel([fuente(serie(dias, "porcentaje"))], OPCIONES, {
        semana: [cubo("2026-01-05", 1, 2, 0.5)],
        periodo: [cubo("2026-01-01", 1, 2, 0.5)],
      }),
    ).not.toThrow();
    expect(() =>
      prepararPanel(
        [fuente(serie(diasSeguidos(90, 600), "segundos", "tiempo_ciclo"))],
        OPCIONES,
        { semana: [cubo("2026-01-05", 1, 2, 600)], periodo: [cubo("2026-01-01", 1, 2, 600)] },
      ),
    ).not.toThrow();

    // Y por debajo del techo tampoco hay agregacion de ninguna clase.
    const corto = prepararPanel(
      [fuente(serie([{ fecha: "2026-01-01", valor: 0.9 }], "porcentaje"))],
      OPCIONES,
      { periodo: [cubo("2026-01-01", 9, 10, 0.9)] },
    );
    expect(corto.grano).toBe("dia");
    expect(corto.desdeCubos).toBe(false);
  });
});
