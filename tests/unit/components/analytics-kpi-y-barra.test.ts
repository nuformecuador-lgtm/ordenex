// FICHA 364 — EL KPI Y LA BARRA DICEN EL MISMO NUMERO DEL MISMO HECHO.
//
// El defecto, reportado por el humano el 2026-09-02 sobre `/analitica` › «Detalle · Movimiento
// de las órdenes»: 259 entregadas de 877 órdenes salían escritas dos veces y con dos cifras
// distintas. El KPI «Efectividad de entrega» decía **29,5 %** —la razón exacta— y el segmento
// «Entregadas» de la barra «Detalle gestión», a un palmo, decía **30 %**, porque escribía su
// cuota del reparto por resto mayor.
//
// ─── POR QUE ESTE TEST NO RECALCULA NADA ────────────────────────────────────────────────
//
// Las dos cifras se producen aquí con las MISMAS funciones que las producen en pantalla, y a
// partir de UNA sola lista de filas:
//
//   KPI   → `calcularEfectividad(porStatus).efectividad` → `formatearValor(_, "porcentaje")`
//            (es lo que hace `KpisEfectividad` + `KpiCard`)
//   barra → `plegarEnDesenlaces(porStatus)` → `pesosDeReparto` → `textoDePeso`
//            (es lo que hace `ConteoEntregasAnillo` + `GraficaReparto`)
//
// Escribir aquí `259 / 877` y compararlo contra sí mismo sería una aserción contra su propia
// fuente: verde para siempre y ciega al defecto. Lo que se compara son las DOS CADENAS que la
// pantalla escribe, cada una por su camino real.
//
// ⚠ EL PRIMER CASO FALLABA ANTES DEL ARREGLO. Ejecutado sobre el módulo de HEAD (2026-09-02):
//
//   AssertionError: el número de la barra y el del KPI no dicen lo mismo (259 de 877):
//   expected '30%' to be '29,5%' // Object.is equality

import { describe, expect, it } from "vitest";

import { calcularEfectividad } from "@/app/(app)/analitica/_components/entregas/efectividad";
import { formatearValor } from "@/components/private/analytics/formato";
import { pesosDeReparto, textoDePeso } from "@/components/private/analytics/porcentajes";
import { plegarEnDesenlaces } from "@/lib/repositories/ConteoEntregasRepository";
import { BUCKET_OTROS, DESENLACES } from "@/lib/types/conteo-entregas";

/** Los seis segmentos de «Detalle gestión», en el orden en que `ConteoEntregasAnillo` los pinta. */
const SEGMENTOS: readonly string[] = [...DESENLACES, BUCKET_OTROS];
const ENTREGADAS = SEGMENTOS.indexOf("entregada");

type Fila = { readonly status: string; readonly conteo: number };

/** El texto del KPI «Efectividad de entrega», por su camino de verdad. */
function textoDelKpi(porStatus: readonly Fila[]): string {
  return formatearValor(calcularEfectividad(porStatus).efectividad, "porcentaje");
}

/** El texto pegado al segmento «Entregadas» de la barra, por su camino de verdad. */
function textoDeEntregadas(porStatus: readonly Fila[]): string {
  const porDesenlace = plegarEnDesenlaces(porStatus);
  const peso = pesosDeReparto(SEGMENTOS.map((clave) => porDesenlace[clave] ?? 0))[ENTREGADAS];
  if (!peso) throw new Error("no hay segmento de entregadas");
  return textoDePeso(peso, (f) => formatearValor(f, "porcentaje"));
}

/**
 * Reparte los conteos en filas de status: los cinco desenlaces y uno que NO lo es, para que
 * caiga en «otros» / «en proceso» — que es el sexto segmento y el resto del universo del KPI.
 */
function filas(conteos: readonly number[]): Fila[] {
  const status = [...SEGMENTOS.slice(0, -1), "en_reparto"];
  return conteos.map((conteo, i) => ({ status: status[i] ?? "en_reparto", conteo }));
}

/** El caso que el humano miró: 877 órdenes, 259 entregadas. */
const CASO_REAL = [259, 20, 80, 30, 8, 480];

describe("el número junto al segmento y el del KPI son el mismo (ficha 364)", () => {
  it("el caso reportado suma las 877 órdenes de la pantalla", () => {
    expect(CASO_REAL.reduce((s, v) => s + v, 0)).toBe(877);
  });

  // ⚠ EL CORAZON DE LA FICHA, y el caso que fallaba: «30 %» contra «29,5 %».
  it("259 entregadas de 877 órdenes: la barra dice lo que dice el KPI", () => {
    const porStatus = filas(CASO_REAL);

    expect(
      textoDeEntregadas(porStatus),
      "el número de la barra y el del KPI no dicen lo mismo (259 de 877)",
    ).toBe(textoDelKpi(porStatus));
  });

  // Y CUAL de los dos ganó: el dato real, el del KPI, con su decimal. Sin esto, hacer que los
  // dos escribieran «30 %» también pasaría el test de arriba — y sería la decisión contraria a
  // la que tomó el humano.
  it("y el número que dicen los dos es la razón exacta, con su decimal", () => {
    const porStatus = filas(CASO_REAL);

    expect(textoDeEntregadas(porStatus)).toBe(formatearValor(259 / 877, "porcentaje"));
    expect(textoDeEntregadas(porStatus)).toContain("29,5");
  });

  // El caso de producción del 2026-08-27 (feature 290): 233 órdenes, dos categorías de valor 1.
  it("el caso de la 290 tampoco discrepa", () => {
    const porStatus = filas([1, 0, 0, 1, 0, 231]);

    expect(textoDeEntregadas(porStatus)).toBe(textoDelKpi(porStatus));
  });

  // ⚠ NO BASTA CON UN PUÑADO DE CASOS. El reparto por resto mayor desvía su cuota respecto de
  // la razón exacta en la MAYORIA de los repartos —medido: 85-94 % de las partes con puntos
  // enteros, y todavía 8-9 % con un decimal—, así que un caso suelto podría coincidir por
  // suerte. Lo que hace que estos dos textos coincidan siempre es que salen del MISMO número, y
  // eso se comprueba en masa.
  it("coinciden en las 3.059 composiciones de hasta 14 órdenes en 4 buckets", () => {
    let comprobados = 0;
    for (let total = 1; total <= 14; total += 1) {
      for (let a = 0; a <= total; a += 1) {
        for (let b = 0; b <= total - a; b += 1) {
          for (let c = 0; c <= total - a - b; c += 1) {
            const resto = total - a - b - c;
            const porStatus = filas([a, b, c, 0, 0, resto]);
            expect(
              textoDeEntregadas(porStatus),
              `discrepan en [${a}, ${b}, ${c}, ${resto}]`,
            ).toBe(textoDelKpi(porStatus));
            comprobados += 1;
          }
        }
      }
    }
    // El conteo se afirma para que un bucle que se quede sin casos no pase en verde.
    expect(comprobados).toBe(3059);
  });

  // Sin universo no hay razón que medir: el KPI escribe el guion de dato ausente (`null`, no
  // `0`) y la barra ni se pinta. Se fija para que nadie «arregle» el caso vacío escribiendo un
  // 0 % en uno de los dos lados, que afirmaría que se falló cada entrega.
  it("con el universo vacío el KPI no afirma un 0 %", () => {
    expect(textoDelKpi(filas([0, 0, 0, 0, 0, 0]))).toBe(formatearValor(null, "porcentaje"));
    expect(textoDelKpi(filas([0, 0, 0, 0, 0, 0]))).not.toBe(formatearValor(0, "porcentaje"));
  });
});

describe("lo que NO se puede perder: la barra sigue midiendo 100 % exacto", () => {
  const suma = (valores: readonly number[]) =>
    pesosDeReparto(valores).reduce((s, peso) => s + peso.ancho, 0);

  /** Lo que daría redondear cada parte por su cuenta, en puntos. Es lo que NO suma 100. */
  const ingenuo = (valores: readonly number[]) => {
    const total = valores.reduce((s, v) => s + v, 0);
    return valores.map((v) => Math.round((v / total) * 100)).reduce((s, p) => s + p, 0);
  };

  // Los casos que la cabecera del módulo cita como motivo del resto mayor: redondeando cada
  // parte por su cuenta dan 99 o 101, y una barra que mide 101 % hace que `flex` encoja en
  // silencio todas las franjas para hacer caber el sobrante.
  it("los repartos que redondeados ingenuamente NO dan 100 siguen midiendo 100", () => {
    for (const valores of [
      [1, 1, 1], //             33 x 3      = 99
      [7, 7, 1], //             47 + 47 + 7 = 101
      [1, 1, 1, 1, 1, 1, 1], // 14 x 7      = 98
      [2, 3, 3, 3, 3], //       14 + 21 x 4 = 98
      [1, 1, 1, 1, 1, 1], //    17 x 6      = 102
    ]) {
      // Que el caso ES de los incómodos no se da por supuesto: se afirma.
      expect(ingenuo(valores), `${JSON.stringify(valores)} no es un caso incómodo`).not.toBe(100);
      expect(suma(valores), `${JSON.stringify(valores)}`).toBeCloseTo(1, 10);
    }
  });

  // El caso real de la 290, donde además entra la astilla: se la paga el mayor, así que la
  // suma no se mueve. Y la astilla sigue siendo visible (medio punto de la barra).
  it("con astillas de por medio la barra sigue midiendo 100 % y la astilla se ve", () => {
    const pesos = pesosDeReparto([1, 0, 0, 1, 0, 231]);

    expect(pesos.reduce((s, peso) => s + peso.ancho, 0)).toBeCloseTo(1, 10);
    for (const i of [0, 3]) expect(pesos[i]?.ancho).toBeGreaterThanOrEqual(0.005);
    // Y el mayor lo paga de su ANCHO, nunca de lo que escribe.
    expect(pesos[5]?.ancho).toBeLessThan(pesos[5]?.cuota ?? 0);
  });

  it("y sigue midiendo 100 % en los 39.710 repartos de tres partes hasta 60 órdenes", () => {
    let comprobados = 0;
    for (let total = 1; total <= 60; total += 1) {
      for (let a = 0; a <= total; a += 1) {
        for (let b = 0; b <= total - a; b += 1) {
          expect(suma([a, b, total - a - b]), `[${a}, ${b}, ${total - a - b}]`).toBeCloseTo(1, 10);
          comprobados += 1;
        }
      }
    }
    expect(comprobados).toBe(39710);
  });
});

// ─── EL PRECIO DEL ARREGLO, ESCRITO Y ACOTADO ─────────────────────────────────────────────
//
// Antes los textos sumaban 100 clavado y mentían sobre el valor de cada parte. Ahora cada parte
// dice la verdad y la SUMA DE LOS TEXTOS puede decir 99,9 o 100,1. Es un intercambio consciente
// —decisión del humano del 2026-09-03, «elijo el dato real»— y aquí se fija su MAGNITUD: si
// alguien vuelve a tocar el redondeo, este bloque dice cuánto se podía desviar y cuánto no.
describe("el precio: la suma de los textos ya no da siempre 100 (ficha 364)", () => {
  /** Lo que un lector SUMA al leer la columna: cada texto es la razón redondeada a un decimal. */
  const sumaDeLoEscrito = (valores: readonly number[]) =>
    pesosDeReparto(valores).reduce((s, peso) => s + Math.round(peso.exacta * 1000) / 10, 0);

  // El número que se va a ver en la pantalla del caso reportado. No es un tope teórico: es
  // 29,5 + 2,3 + 9,1 + 3,4 + 0,9 + 54,7.
  it("el caso real escribe seis pesos que suman 99,9 — no 100", () => {
    expect(sumaDeLoEscrito(CASO_REAL)).toBeCloseTo(99.9, 6);
  });

  // El tope no es una impresión: cada parte redondeada a un decimal se desvía como mucho medio
  // décimo de punto, así que con seis segmentos la columna no puede irse de 6 x 0,05 = 0,3 pp.
  it("con seis segmentos la desviación nunca pasa de 0,3 pp", () => {
    let comprobados = 0;
    for (let total = 6; total <= 400; total += 7) {
      for (let a = 1; a < total; a += 13) {
        for (let b = 1; b < total - a; b += 17) {
          const resto = total - a - b;
          const valores = [a, b, Math.ceil(resto / 4), Math.ceil(resto / 8), 1, resto];
          expect(
            Math.abs(sumaDeLoEscrito(valores) - 100),
            `${JSON.stringify(valores)}`,
          ).toBeLessThanOrEqual(0.3 + 1e-9);
          comprobados += 1;
        }
      }
    }
    expect(comprobados).toBeGreaterThan(1000);
  });
});
