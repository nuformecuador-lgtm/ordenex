import { describe, it, expect } from "vitest";

import {
  evaluarMadurezDeCohorte,
  MINIMO_BASE_PORCENTAJE,
} from "@/lib/analytics/madurez-cohorte";
import { efectividadCohorteConfig } from "@/lib/config/efectividad-cohorte";

// FICHA 441 — LOS DOS ESTADOS EN QUE UN PORCENTAJE NO SE PUEDE ESCRIBIR, y la madurez que va al
// lado del número cuando sí se puede.
//
// Las MUTACIONES que este archivo tiene que poner en rojo, y cada una tiene su caso nombrado:
//
//   M1 · quitar el guardia de CERO CERRADAS (devolver `entregadas / cargadas` siempre)
//        → «cero cerradas: no hay porcentaje, ni siquiera sobre las cargadas»
//   M2 · quitar el guardia de BASE CHICA (soltar la cifra con 3 cerradas)
//        → «base por debajo del suelo: no se escribe»
//   M3 · aplicar el suelo sobre las CARGADAS en vez de sobre la base de cada cifra
//        → «cada cifra se mide contra SU denominador»
//   M4 · escribir 20 a mano en vez de derivarlo de la tolerancia
//        → «el suelo se DERIVA de la tolerancia»
//   M5 · devolver `0` en vez de `null` cuando no hay dato
//        → los casos comprueban `valor === null` y además el MOTIVO
//
// Todos los números de los casos reales son MEDIDOS en producción el 2026-09-17, no inventados:
// zona Puntarenas 0 de 27 cerradas, zona El Coco 3 de 64, zona GAM 389 de 637, y el período del
// diseño 424 entregadas de 790 cargadas con 265 vivas.

/** Atajo: el reparto tal como lo produce `calcularEfectividad`. */
function reparto(total: number, entregadas: number, enProceso: number) {
  return { total, entregadas, enProceso };
}

describe("R1 · el reparto de la madurez: cerradas, vivas y el tramo del medio", () => {
  // El período del diseño aprobado: 790 cargadas, 424 entregadas, 265 vivas. La barra pide
  // 424 / 101 / 265, y los tres tramos tienen que sumar las cargadas.
  it("deriva cerradas, vivas y «otro desenlace», y los tres suman las cargadas", () => {
    const m = evaluarMadurezDeCohorte(reparto(790, 424, 265));

    expect(m.cargadas).toBe(790);
    expect(m.cerradas).toBe(525);
    expect(m.vivas).toBe(265);
    expect(m.otroDesenlace).toBe(101);
    expect(m.entregadas + m.otroDesenlace + m.vivas).toBe(m.cargadas);
  });

  it("«en curso» es exactamente «quedan vivas»", () => {
    expect(evaluarMadurezDeCohorte(reparto(790, 424, 265)).enCurso).toBe(true);
    // Todo cerrado: el período ya no se mueve y la pantalla no tiene que avisar de nada.
    expect(evaluarMadurezDeCohorte(reparto(100, 80, 0)).enCurso).toBe(false);
  });

  // Las dos cifras del diseño, con sus valores esperados: 53,7 % sobre cargadas y 80,8 % sobre
  // cerradas. Son FRACCIONES, que es lo que consume `formatearValor(_, "porcentaje")`.
  it("las dos cifras salen del mismo numerador y de denominadores distintos", () => {
    const m = evaluarMadurezDeCohorte(reparto(790, 424, 265));

    expect(m.sobreCargadas.valor).toBeCloseTo(424 / 790, 10);
    expect(m.sobreCargadas.base).toBe(790);
    expect(m.sobreCerradas.valor).toBeCloseTo(424 / 525, 10);
    expect(m.sobreCerradas.base).toBe(525);
    // Y con los números del diseño: 53,7 % y 80,8 %.
    expect(Number(((m.sobreCargadas.valor ?? 0) * 100).toFixed(1))).toBe(53.7);
    expect(Number(((m.sobreCerradas.valor ?? 0) * 100).toFixed(1))).toBe(80.8);
  });
});

describe("R2 · CERO CERRADAS: no hay porcentaje, ni siquiera sobre las cargadas", () => {
  // ⭑ MUTACIÓN M1. El caso es real: la zona Puntarenas tiene 0 de 27 cerradas. `0 / 27` es una
  // división perfectamente definida y una afirmación perfectamente falsa: nadie falló 27
  // entregas, es que ninguna ha terminado.
  it("con 0 de 27 cerradas, NINGUNA de las dos cifras se escribe", () => {
    const m = evaluarMadurezDeCohorte(reparto(27, 0, 27));

    expect(m.cerradas).toBe(0);
    // ⚠ EL ORDEN DE ESTAS ASERCIONES NO ES LIBRE, y se corrigió después de ejecutar la mutación.
    // La de `sobreCargadas` va PRIMERA porque es la única que muere de verdad: con el guardia
    // quitado, `sobreCerradas` sigue saliendo `null` de rebote —su base es 0 y el suelo la tapa
    // igual, sólo que con el motivo equivocado—, así que empezar por ella haría fallar el test
    // por un matiz de etiqueta y escondería que la pantalla acaba de pintar «0,0 % de
    // efectividad» sobre 27 órdenes que nadie ha fallado.
    expect(m.sobreCargadas.valor, "0/27 se pintó como 0 %").toBeNull();
    expect(m.sobreCargadas.motivo).toBe("sin_cerradas");
    expect(m.sobreCerradas.valor).toBeNull();
    expect(m.sobreCerradas.motivo).toBe("sin_cerradas");
  });

  // El denominador sigue viajando aunque no haya cifra (ficha 360): la pantalla tiene que poder
  // escribir «0 de 27 cerradas», que es un diagnóstico, no un reproche.
  it("la base viaja igual, para que la pantalla pueda decir «0 de 27 cerradas»", () => {
    const m = evaluarMadurezDeCohorte(reparto(27, 0, 27));

    expect(m.sobreCargadas.base).toBe(27);
    expect(m.sobreCerradas.base).toBe(0);
    expect(m.cargadas).toBe(27);
  });

  // Universo vacío: no es «salió mal», es «no hubo». Cae por el mismo camino.
  it("sin ninguna orden tampoco hay porcentaje", () => {
    const m = evaluarMadurezDeCohorte(reparto(0, 0, 0));

    expect(m.sobreCargadas).toEqual({ valor: null, base: 0, motivo: "sin_cerradas" });
    expect(m.enCurso).toBe(false);
  });
});

describe("R3 · BASE DEMASIADO CHICA: la cifra que salta sola no se escribe", () => {
  // ⭑ MUTACIÓN M2. El caso que nombró el humano: «con 3 órdenes cada una vale 33 puntos». Es la
  // zona El Coco, medida: 3 cerradas de 64 cargadas.
  it("con 3 cerradas de 64, la cifra sobre cerradas se calla", () => {
    const m = evaluarMadurezDeCohorte(reparto(64, 2, 61));

    expect(m.cerradas).toBe(3);
    expect(m.sobreCerradas.valor, "se pintó un 67 % sobre 3 órdenes").toBeNull();
    expect(m.sobreCerradas.motivo).toBe("base_insuficiente");
    expect(m.sobreCerradas.base).toBe(3);
  });

  // ⭑ MUTACIÓN M3. Las dos cifras comparten numerador y NO comparten denominador, así que el
  // suelo se mide contra el suyo. Si alguien aplicara el suelo sobre las cargadas, este caso
  // publicaría un 67 % sobre 3 órdenes porque las cargadas (64) sí pasan el suelo.
  it("cada cifra se mide contra SU denominador, no contra las cargadas", () => {
    const m = evaluarMadurezDeCohorte(reparto(64, 2, 61));

    expect(m.sobreCargadas.valor, "64 cargadas pasan el suelo").not.toBeNull();
    expect(m.sobreCargadas.motivo).toBeNull();
    expect(m.sobreCerradas.valor, "3 cerradas no pasan el suelo").toBeNull();
  });

  // La zona GAM, medida: 389 cerradas de 637 cargadas (248 vivas). Las dos bases sobran del
  // suelo, así que se escriben las dos cifras. El numerador aquí da igual y por eso no se afirma
  // nada sobre él: lo que este caso mide son las BASES.
  it("con 389 cerradas de 637 cargadas se escriben las dos", () => {
    const m = evaluarMadurezDeCohorte(reparto(637, 300, 248));

    expect(m.cerradas).toBe(389);
    expect(m.sobreCargadas.motivo).toBeNull();
    expect(m.sobreCerradas.motivo).toBeNull();
  });

  // El borde exacto, en las dos direcciones. Un `<=` en vez de `<` mueve el suelo una orden y
  // este par de casos es lo único que lo dice.
  it("justo en el suelo se escribe; una orden por debajo, no", () => {
    const enElSuelo = evaluarMadurezDeCohorte(
      reparto(MINIMO_BASE_PORCENTAJE, 1, 0),
    );
    const unaMenos = evaluarMadurezDeCohorte(
      reparto(MINIMO_BASE_PORCENTAJE - 1, 1, 0),
    );

    expect(enElSuelo.sobreCerradas.valor).toBeCloseTo(1 / MINIMO_BASE_PORCENTAJE, 10);
    expect(enElSuelo.sobreCerradas.motivo).toBeNull();
    expect(unaMenos.sobreCerradas.valor).toBeNull();
    expect(unaMenos.sobreCerradas.motivo).toBe("base_insuficiente");
  });
});

describe("R4 · el suelo se DERIVA de la tolerancia, no se escribe", () => {
  // ⭑ MUTACIÓN M4. Lo que se comprueba es la DERIVACIÓN, no el número: así, ajustar la
  // tolerancia en `lib/config/efectividad-cohorte.ts` no obliga a reescribir ningún caso, y
  // escribir el suelo a mano deja de cuadrar en cuanto alguien mueva la tolerancia.
  it("en el suelo, una orden mueve la cifra EXACTAMENTE la tolerancia; una menos, más", () => {
    const tolerancia = efectividadCohorteConfig.MAXIMO_SALTO_POR_ORDEN;

    expect(1 / MINIMO_BASE_PORCENTAJE).toBeLessThanOrEqual(tolerancia);
    expect(1 / (MINIMO_BASE_PORCENTAJE - 1)).toBeGreaterThan(tolerancia);
  });

  it("la tolerancia es una fracción utilizable, no un porcentaje ni un cero", () => {
    const tolerancia = efectividadCohorteConfig.MAXIMO_SALTO_POR_ORDEN;

    expect(tolerancia).toBeGreaterThan(0);
    expect(tolerancia).toBeLessThan(1);
    expect(Number.isInteger(MINIMO_BASE_PORCENTAJE)).toBe(true);
  });
});

describe("R5 · un reparto imposible se dice en voz alta", () => {
  // No devuelve una cifra plausible: un 120 % —o peor, un 40 % creíble— saldría de aquí sin que
  // nadie pudiera rastrear de dónde. La única fuente legítima de esta entrada es
  // `calcularEfectividad`, cuya partición ya está medida.
  it.each([
    ["más entregadas que cerradas", reparto(10, 9, 5)],
    ["más vivas que órdenes", reparto(10, 0, 11)],
    ["conteos negativos", reparto(10, -1, 0)],
  ])("%s → lanza", (_nombre, entrada) => {
    expect(() => evaluarMadurezDeCohorte(entrada)).toThrow(/incoherente/);
  });

  // Y el caso de al lado NO lanza: todas las entregadas y ninguna viva es perfectamente posible.
  it("todo entregado y nada vivo es válido, no un error", () => {
    const m = evaluarMadurezDeCohorte(reparto(30, 30, 0));

    expect(m.sobreCargadas.valor).toBe(1);
    expect(m.sobreCerradas.valor).toBe(1);
  });
});
