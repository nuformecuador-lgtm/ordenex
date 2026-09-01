// FICHA 346 — EL DESGLOSE SUMA: los cubos expuestos reparten el universo ENTERO del recorte.
//
// EL DEFECTO QUE ESTE ARCHIVO ATA, medido en producción el 2026-08-29 sobre `Crema Especial
// MLX`: la tabla de productos de `/analitica` pintaba «Órdenes 24» y, debajo, 3 entregadas + 2
// rechazadas + 13 en proceso = 18. Seis órdenes no aparecían en ninguna columna. No estaban mal
// contadas: eran órdenes con uno de los OTROS desenlaces (ni `entregada` ni `rechazada`), que no
// entraban en los dos cubos por igualdad y tampoco en `enProceso` —definido como «lo que NO
// tiene desenlace»— porque ellas sí lo tienen. Caían entre las dos reglas.
//
// ─── POR QUÉ ESTO ES UNA PROPIEDAD Y NO UN EJEMPLO ─────────────────────────────────────────
//
// Un caso escrito a mano («8 entregadas, 6 rechazadas, 2 en curso: suman 16») solo prueba ESE
// reparto, y el defecto vivía justo en el reparto que nadie escribió. Aquí la entrada se genera
// a partir de `DESENLACES` —la lista de verdad del catálogo— de tres maneras:
//
//   1. UN desenlace a la vez, recorriendo `DESENLACES` con `it.each`: si cualquiera de ellos se
//      quedara fuera de los cubos, su caso se pone rojo con su nombre en el título;
//   2. TODAS las combinaciones de conteos {0,1,2,3} sobre los cinco desenlaces y dos estados en
//      curso (4^7 = 16.384 repartos), que cubre las mezclas que nadie escribiría;
//   3. con un SEXTO desenlace inyectado en el catálogo, que es la prueba de que el cubo
//      «otros» se DERIVA de `DESENLACES` y no de una lista escrita a mano. Una lista literal en
//      la implementación pasa (1) y (2) y falla (3): ése es justo el arreglo que no queremos.
//
// Módulo PURO: no monta nada. Lo único que aquí puede equivocarse es la aritmética del reparto.
import { describe, it, expect, vi, afterEach } from "vitest";

import { calcularEfectividad } from "@/app/(app)/analitica/_components/entregas/efectividad";
import type { EfectividadEntrega } from "@/app/(app)/analitica/_components/entregas/efectividad";
import { DESENLACES } from "@/lib/types/conteo-entregas";

/**
 * DOS status que NO son desenlaces: la orden sigue su curso. Son dos y no uno para que el
 * generador de abajo mezcle varios estados en curso en la misma fila, que es como llegan de
 * verdad (una parte en bodega y otra en reparto).
 */
const EN_CURSO = ["en_reparto", "en_preparacion"] as const;

/** Los CUATRO cubos que la pantalla pinta como conteos, en el orden en que se leen. */
const CUBOS = ["entregadas", "rechazadas", "otrosDesenlaces", "enProceso"] as const;

/**
 * La suma de los cubos EXPUESTOS.
 *
 * ⚠ El `0` de respaldo cuando el campo no es un número va A PROPÓSITO, y no es un colador: si un cubo
 * desapareciera del resultado —que es exactamente el defecto que esta ficha repara— la suma
 * seguiría quedándose corta y el caso seguiría rojo, pero el mensaje diría «18 vs 24» en vez de
 * «NaN vs 24». El número es el dato accionable: dice CUÁNTAS órdenes se están perdiendo.
 */
function sumaDeCubos(r: EfectividadEntrega): number {
  return CUBOS.reduce((suma, cubo) => {
    const valor: unknown = r[cubo];
    return suma + (typeof valor === "number" ? valor : 0);
  }, 0);
}

/** Un desglose con `conteo` órdenes en cada uno de los `status` dados. */
function desglose(pares: readonly (readonly [string, number])[]) {
  return pares.map(([status, conteo]) => ({ status, conteo }));
}

afterEach(() => {
  vi.doUnmock("@/lib/types/conteo-entregas");
  vi.resetModules();
});

/* ========================================================================== */
/* 1 — un desenlace a la vez, recorriendo el catálogo de verdad               */
/* ========================================================================== */

describe("FICHA 346 · ningún desenlace del catálogo se evapora", () => {
  it.each([...DESENLACES])(
    "`%s`: las 7 órdenes de ese desenlace siguen dentro de algún cubo",
    (desenlace) => {
      const r = calcularEfectividad(desglose([[desenlace, 7]]));

      expect(r.total).toBe(7);
      // LA aserción de la ficha. Antes del arreglo esto daba 0 para `devuelta`,
      // `reprogramada` e `incidente`: esas órdenes no estaban en ninguna columna.
      expect(sumaDeCubos(r)).toBe(7);
    },
  );

  it("y con las CINCO mezcladas, la suma sigue siendo el universo entero", () => {
    // Un conteo distinto por desenlace para que una permutación de cubos no pase por vacío.
    const r = calcularEfectividad(
      desglose(DESENLACES.map((d, i) => [d, i + 1] as const)),
    );

    expect(r.total).toBe(DESENLACES.length * (DESENLACES.length + 1) / 2);
    expect(sumaDeCubos(r)).toBe(r.total);
  });
});

/* ========================================================================== */
/* 2 — la propiedad, sobre todos los repartos posibles                        */
/* ========================================================================== */

describe("FICHA 346 · la suma de los cubos ES el total, para todo reparto", () => {
  it("las 16.384 combinaciones de conteos {0,1,2,3} sobre 5 desenlaces y 2 estados en curso", () => {
    const statuses = [...DESENLACES, ...EN_CURSO];
    const valores = [0, 1, 2, 3];
    const combinaciones = valores.length ** statuses.length;

    // Se recorre el espacio entero en base 4: cada `n` es un reparto distinto. Determinista, sin
    // semilla y sin biblioteca — y con 16.384 casos no hay reparto de este tamaño sin probar.
    const rotos: string[] = [];
    for (let n = 0; n < combinaciones; n++) {
      let resto = n;
      const filas = statuses.map((status) => {
        const conteo = valores[resto % valores.length];
        resto = Math.floor(resto / valores.length);
        return { status, conteo };
      });

      const r = calcularEfectividad(filas);
      const esperado = filas.reduce((s, f) => s + f.conteo, 0);
      if (r.total !== esperado || sumaDeCubos(r) !== esperado) {
        rotos.push(
          `${filas.map((f) => `${f.status}=${f.conteo}`).join(" ")} → cubos ${sumaDeCubos(r)}, total ${r.total}, órdenes ${esperado}`,
        );
      }
    }

    // Se acumulan y se afirman de una vez: un `expect` dentro del bucle pararía en el primero y
    // el informe diría «un reparto falla» en vez de «cuáles y cuántos».
    expect({ repartosRotos: rotos.length, primeros: rotos.slice(0, 3) }).toEqual({
      repartosRotos: 0,
      primeros: [],
    });
    expect(combinaciones).toBe(16384);
  });
});

/* ========================================================================== */
/* 3 — el cubo «otros» se DERIVA del catálogo, no de una lista escrita        */
/* ========================================================================== */

describe("FICHA 346 · un desenlace NUEVO del catálogo entra solo", () => {
  it("un SEXTO desenlace cae en «otros» y la suma sigue cuadrando", async () => {
    // El catálogo gana un desenlace. Es el escenario que ya ocurrió tres veces en este repo
    // (features 135, 153 y 154) y el motivo por el que la cabecera de `efectividad.ts` prohíbe
    // escribir listas de estados: con `["devuelta","reprogramada","incidente"]` en la
    // implementación, estas órdenes volverían a evaporarse y este caso se pondría rojo.
    const SEXTO = "custodiada_en_puerto";

    vi.resetModules();
    vi.doMock("@/lib/types/conteo-entregas", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/lib/types/conteo-entregas")>();
      return { ...actual, DESENLACES: [...actual.DESENLACES, SEXTO] };
    });

    const modulo = await import("@/app/(app)/analitica/_components/entregas/efectividad");
    const r = modulo.calcularEfectividad(
      desglose([
        ["entregada", 3],
        [SEXTO, 5],
        [EN_CURSO[0], 2],
      ]),
    );

    expect(r.total).toBe(10);
    // Ni entrega ni rechazo, pero YA tiene desenlace: no es trabajo vivo.
    expect(r.enProceso).toBe(2);
    expect(r.otrosDesenlaces).toBe(5);
    expect(sumaDeCubos(r)).toBe(10);
  });

  it("y sin tocar el catálogo ese mismo status es trabajo VIVO, no un desenlace", () => {
    // La contraparte del caso anterior, para que no se lea como que cualquier cosa cae en
    // «otros»: mientras el catálogo no lo nombre, un status desconocido está en proceso.
    const r = calcularEfectividad(
      desglose([
        ["entregada", 3],
        ["custodiada_en_puerto", 5],
        [EN_CURSO[0], 2],
      ]),
    );

    expect(r.otrosDesenlaces).toBe(0);
    expect(r.enProceso).toBe(7);
    expect(sumaDeCubos(r)).toBe(10);
  });
});

/* ========================================================================== */
/* El caso MEDIDO por el humano                                               */
/* ========================================================================== */

describe("FICHA 346 · `Crema Especial MLX`, la captura del 2026-08-29", () => {
  /**
   * Lo MEDIDO en la pantalla: Órdenes 24, Entregadas 3, Rechazadas 2, En proceso 13,
   * Efectividad 12,5 % y % de rechazo 8,3 %. De ahí salen las seis órdenes que faltaban
   * (24 − 3 − 2 − 13) y también el total, dos veces: 3/24 = 0,125 y 2/24 = 0,0833.
   *
   * ⚠ EL REPARTO DE ESAS SEIS ENTRE `devuelta` y `reprogramada` NO ES DATO MEDIDO y no se
   * afirma: la captura no desglosa el cubo, solo dice que faltan seis. Aquí van 4 y 2 porque
   * hacen falta dos números para escribir la entrada, y lo único que este caso comprueba es
   * que las seis APAREZCAN. Si mañana se mide el desglose real, se cambian los dos números y
   * ninguna aserción se mueve.
   */
  const CREMA_ESPECIAL_MLX = desglose([
    ["entregada", 3],
    ["rechazada", 2],
    ["devuelta", 4],
    ["reprogramada", 2],
    ["en_reparto", 13],
  ]);

  it("las seis órdenes que faltaban ya están, y el desglose suma 24", () => {
    const r = calcularEfectividad(CREMA_ESPECIAL_MLX);

    // LA aserción de la captura, y va la PRIMERA a propósito: 3 + 2 + 6 + 13 = 24, que es la
    // columna «Órdenes» que el humano vio. Antes del arreglo este renglón decía «expected 18 to
    // be 24», que son exactamente las seis órdenes perdidas.
    expect(sumaDeCubos(r)).toBe(24);
    expect(r.total).toBe(24);
    expect(r.entregadas).toBe(3);
    expect(r.rechazadas).toBe(2);
    expect(r.enProceso).toBe(13);
    // Las que se evaporaban.
    expect(r.otrosDesenlaces).toBe(6);
  });

  it("y los TRES porcentajes de la captura no se han movido ni un decimal", () => {
    const r = calcularEfectividad(CREMA_ESPECIAL_MLX);

    // 3/24 = 12,5 %: la efectividad ya usaba el denominador correcto, y por eso el defecto
    // nunca estuvo en ella. Esta ficha es ADITIVA (misma forma que la 345 con `rechazadas`).
    expect(r.efectividad).toBe(0.125);
    // 2/24 = 8,33 %.
    expect(r.tasaRechazo).toBe(2 / 24);
    // (3 + 2)/24: la efectividad de la GESTIÓN sigue sumando solo los rechazos al numerador.
    // Si `otrosDesenlaces` se hubiera colado en algún numerador, esto lo diría.
    expect(r.efectividadGestion).toBe(5 / 24);
  });
});
