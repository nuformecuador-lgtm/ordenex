import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

import {
  ordenarCierresFifo,
  repartirEntreCierres,
  type CierreImputable,
} from "@/lib/utils/reparto-liquidacion-mensajero";
import { quitarComentarios } from "../../fixtures/money-safe";

/**
 * Feature 205 (T0.2) — el calculo del reparto, ejercitado SIN base de datos (R17).
 *
 * Este archivo NO importa Prisma: entra STRING, sale STRING. Si para construir un caso hiciera
 * falta un `Decimal`, la frontera de la funcion estaria mal puesta.
 *
 * Cubre R8, R10, R11, R12, R13, R17, R53 (parcial) y R54.
 */

function cierre(cierreId: string, pendiente: string, solicitadoAt: string): CierreImputable {
  return { cierreId, pendiente, solicitadoAt };
}

/** El dia trabajado, a mediodia UTC, para que ninguna comparacion dependa del huso. */
const dia = (n: number) => `2026-07-${String(n).padStart(2, "0")}T12:00:00.000Z`;

const TOPE_AMPLIO = 50;

const ids = (r: { imputaciones: { cierreId: string }[] }) =>
  r.imputaciones.map((i) => i.cierreId);
const montos = (r: { imputaciones: { monto: string }[] }) => r.imputaciones.map((i) => i.monto);

describe("ordenarCierresFifo (R8)", () => {
  it("ordena del dia trabajado MAS ANTIGUO al mas reciente", () => {
    const entrada = [
      cierre("c-medio", "100.00", dia(15)),
      cierre("c-nuevo", "100.00", dia(20)),
      cierre("c-viejo", "100.00", dia(1)),
    ];
    expect(ordenarCierresFifo(entrada).map((c) => c.cierreId)).toEqual([
      "c-viejo",
      "c-medio",
      "c-nuevo",
    ]);
  });

  it("dos cierres con el MISMO instante desempatan por id ascendente, siempre igual", () => {
    // Sin el desempate, el orden lo decidiria el algoritmo de ordenacion y R8 exige
    // determinismo. Se prueban las DOS entradas posibles: el resultado no puede depender de
    // como venia la lista.
    const a = cierre("aaa", "100.00", dia(5));
    const b = cierre("bbb", "200.00", dia(5));

    expect(ordenarCierresFifo([a, b]).map((c) => c.cierreId)).toEqual(["aaa", "bbb"]);
    expect(ordenarCierresFifo([b, a]).map((c) => c.cierreId)).toEqual(["aaa", "bbb"]);
  });

  it("el orden es REPETIBLE: la misma entrada da la misma salida, y no muta el array recibido", () => {
    const entrada: readonly CierreImputable[] = [
      cierre("c3", "10.00", dia(9)),
      cierre("c1", "10.00", dia(3)),
      cierre("c2", "10.00", dia(3)),
    ];
    const primera = ordenarCierresFifo(entrada).map((c) => c.cierreId);
    const segunda = ordenarCierresFifo(entrada).map((c) => c.cierreId);

    expect(primera).toEqual(["c1", "c2", "c3"]);
    expect(segunda).toEqual(primera);
    // La entrada sigue en su orden original: `ordenarCierresFifo` devuelve un array NUEVO.
    expect(entrada.map((c) => c.cierreId)).toEqual(["c3", "c1", "c2"]);
  });

  it("compara INSTANTES, no texto: `Z` y `+00:00` del mismo instante EMPATAN y manda el id", () => {
    // Los ids estan elegidos para que las dos reglas NO coincidan: como TEXTO, '+' (0x2B) va
    // antes que 'Z' (0x5A) y ganaria `zzz`; como INSTANTE empatan y gana `aaa` por el desempate
    // de R8. Si los ids coincidieran con el orden textual, este test pasaria con las dos
    // implementaciones y no probaria nada.
    const zeta = cierre("aaa", "100.00", "2026-07-05T12:00:00.000Z");
    const offset = cierre("zzz", "100.00", "2026-07-05T12:00:00.000+00:00");

    expect(ordenarCierresFifo([zeta, offset]).map((c) => c.cierreId)).toEqual(["aaa", "zzz"]);
    expect(ordenarCierresFifo([offset, zeta]).map((c) => c.cierreId)).toEqual(["aaa", "zzz"]);
  });

  it("compara INSTANTES, no texto: un offset horario ordena por el momento REAL", () => {
    // Las 12:00+02:00 son las 10:00Z, o sea ANTES que las 11:00Z. Como cadenas, "…T11" < "…T12"
    // y el orden saldria invertido: quien cobra primero dependeria de como se serializo la
    // fecha, que es exactamente lo que R8 prohibe.
    const temprano = cierre("c-temprano", "100.00", "2026-07-05T12:00:00.000+02:00"); // 10:00Z
    const tarde = cierre("c-tarde", "100.00", "2026-07-05T11:00:00.000Z");

    expect(ordenarCierresFifo([tarde, temprano]).map((c) => c.cierreId)).toEqual([
      "c-temprano",
      "c-tarde",
    ]);
    // Y el reparto lo hereda: con 100 solo cobra el que trabajo antes de verdad.
    expect(ids(repartirEntreCierres("100.00", [tarde, temprano], TOPE_AMPLIO))).toEqual([
      "c-temprano",
    ]);
  });

  it("Q1: ignora cualquier OTRA fecha del cierre, aunque venga en el objeto (design §2.4)", () => {
    // `resueltoAt` (cuando el admin aprobo) daria el orden INVERSO. El reparto no cambia: la
    // antiguedad es la del dia TRABAJADO, no la de la latencia administrativa.
    const conResuelto: (CierreImputable & { resueltoAt: string })[] = [
      { ...cierre("c-lunes", "1000.00", dia(6)), resueltoAt: dia(24) },
      { ...cierre("c-jueves", "1000.00", dia(9)), resueltoAt: dia(20) },
      { ...cierre("c-sabado", "1000.00", dia(11)), resueltoAt: dia(12) },
    ];

    expect(ordenarCierresFifo(conResuelto).map((c) => c.cierreId)).toEqual([
      "c-lunes",
      "c-jueves",
      "c-sabado",
    ]);

    const r = repartirEntreCierres("1500.00", conResuelto, TOPE_AMPLIO);
    expect(ids(r)).toEqual(["c-lunes", "c-jueves"]);
    expect(montos(r)).toEqual(["1000.00", "500.00"]);
  });
});

describe("repartirEntreCierres — troceo FIFO (R10, R11, R13)", () => {
  const TRES = [
    cierre("c1", "1000.00", dia(1)),
    cierre("c2", "2000.00", dia(2)),
    cierre("c3", "3000.00", dia(3)),
  ];

  it("importe menor que el primer pendiente: UNA sola imputacion, parcial", () => {
    const r = repartirEntreCierres("400.00", TRES, TOPE_AMPLIO);

    expect(r.imputaciones).toHaveLength(1);
    expect(r.imputaciones[0]).toEqual({
      cierreId: "c1",
      monto: "400.00",
      pendienteAntes: "1000.00",
      pendienteDespues: "600.00",
      parcial: true,
    });
    expect(r.totalImputado).toBe("400.00");
    expect(r.sobrante).toBe("0.00");
  });

  it("importe que cruza tres cierres: dos completas y SOLO la ultima parcial (R11)", () => {
    const r = repartirEntreCierres("3500.00", TRES, TOPE_AMPLIO);

    expect(ids(r)).toEqual(["c1", "c2", "c3"]);
    expect(montos(r)).toEqual(["1000.00", "2000.00", "500.00"]);
    expect(r.imputaciones.map((i) => i.parcial)).toEqual([false, false, true]);
    expect(r.imputaciones.map((i) => i.pendienteDespues)).toEqual(["0.00", "0.00", "2500.00"]);
    expect(r.totalImputado).toBe("3500.00");
    expect(r.sobrante).toBe("0.00");
  });

  it("importe que AGOTA exacto un cierre: ninguna imputacion es parcial", () => {
    const r = repartirEntreCierres("3000.00", TRES, TOPE_AMPLIO);

    expect(ids(r)).toEqual(["c1", "c2"]);
    expect(montos(r)).toEqual(["1000.00", "2000.00"]);
    expect(r.imputaciones.map((i) => i.parcial)).toEqual([false, false]);
    expect(r.imputaciones.map((i) => i.pendienteDespues)).toEqual(["0.00", "0.00"]);
    // c3 no recibe nada, asi que NO aparece (R12).
    expect(ids(r)).not.toContain("c3");
    expect(r.totalImputado).toBe("3000.00");
  });

  it("importe que agota TODO el imputable: sobrante 0 y ningun cierre sin saldar", () => {
    const r = repartirEntreCierres("6000.00", TRES, TOPE_AMPLIO);

    expect(montos(r)).toEqual(["1000.00", "2000.00", "3000.00"]);
    expect(r.imputaciones.every((i) => i.parcial)).toBe(false);
    expect(r.totalImputado).toBe("6000.00");
    expect(r.imputable).toBe("6000.00");
    expect(r.sobrante).toBe("0.00");
  });

  it("R14: importe MAYOR que el imputable ⇒ sobrante > 0 y totalImputado = imputable", () => {
    const r = repartirEntreCierres("10000.00", TRES, TOPE_AMPLIO);

    expect(r.totalImputado).toBe("6000.00");
    expect(r.imputable).toBe("6000.00");
    expect(r.sobrante).toBe("4000.00");
    // Aqui la funcion no rechaza: informa. El `excede` lo decide el servicio con este sobrante.
    expect(r.imputaciones).toHaveLength(3);
  });

  it("R11: en ningun reparto hay mas de UNA imputacion parcial, y es la ULTIMA", () => {
    // Barrido sobre muchos importes: la propiedad tiene que valer siempre, no en el caso que
    // se me ocurrio.
    for (const importe of ["0.01", "1.00", "999.99", "1000.00", "1000.01", "2999.99", "5999.99"]) {
      const r = repartirEntreCierres(importe, TRES, TOPE_AMPLIO);
      const parciales = r.imputaciones.filter((i) => i.parcial);
      expect(parciales.length, `importe ${importe}`).toBeLessThanOrEqual(1);
      if (parciales.length === 1) {
        expect(r.imputaciones.at(-1)?.parcial, `importe ${importe}`).toBe(true);
      }
    }
  });
});

describe("repartirEntreCierres — money-safe al centimo (R13, R16)", () => {
  it("Σ montos es EXACTAMENTE el importe: ni se crea ni se pierde un centimo", () => {
    const cierres = [
      cierre("c1", "0.10", dia(1)),
      cierre("c2", "0.20", dia(2)),
      cierre("c3", "0.30", dia(3)),
    ];
    // 0.10 + 0.20 en coma flotante da 0.30000000000000004: aqui tiene que dar 0.30 clavado.
    const r = repartirEntreCierres("0.30", cierres, TOPE_AMPLIO);

    expect(montos(r)).toEqual(["0.10", "0.20"]);
    expect(r.totalImputado).toBe("0.30");
    expect(r.sobrante).toBe("0.00");
  });

  it("un centimo suelto se imputa al cierre MAS ANTIGUO y no se pierde", () => {
    const cierres = [cierre("c1", "1000.00", dia(1)), cierre("c2", "2000.00", dia(2))];
    const r = repartirEntreCierres("0.01", cierres, TOPE_AMPLIO);

    expect(r.imputaciones).toHaveLength(1);
    expect(r.imputaciones[0].cierreId).toBe("c1");
    expect(r.imputaciones[0].monto).toBe("0.01");
    expect(r.imputaciones[0].pendienteDespues).toBe("999.99");
    expect(r.totalImputado).toBe("0.01");
  });

  it("decimales que rompen un float: los tercios de 8000.01 cuadran al centimo", () => {
    const cierres = [
      cierre("c1", "2666.67", dia(1)),
      cierre("c2", "2666.67", dia(2)),
      cierre("c3", "2666.67", dia(3)),
    ];
    const r = repartirEntreCierres("8000.01", cierres, TOPE_AMPLIO);

    expect(montos(r)).toEqual(["2666.67", "2666.67", "2666.67"]);
    expect(r.totalImputado).toBe("8000.01");
    expect(r.imputable).toBe("8000.01");
    expect(r.sobrante).toBe("0.00");
  });

  it("importes grandes (DECIMAL(12,2) casi lleno) no pierden precision", () => {
    // 9 999 999 999.99 no cabe exacto en un `number`: si algo convirtiera a coma flotante por
    // el camino, esto se veria aqui.
    const cierres = [
      cierre("c1", "9999999999.99", dia(1)),
      cierre("c2", "0.01", dia(2)),
    ];
    const r = repartirEntreCierres("10000000000.00", cierres, TOPE_AMPLIO);

    expect(montos(r)).toEqual(["9999999999.99", "0.01"]);
    expect(r.totalImputado).toBe("10000000000.00");
    expect(r.sobrante).toBe("0.00");
  });

  it("TODOS los importes que salen son STRING de escala 2", () => {
    const cierres = [cierre("c1", "5.5", dia(1)), cierre("c2", "3", dia(2))];
    const r = repartirEntreCierres("7", cierres, 1);

    const escala2 = /^-?\d+\.\d{2}$/;
    for (const valor of [r.totalImputado, r.imputable, r.imputableTotal, r.sobrante, r.recorte.montoFuera]) {
      expect(valor, valor).toMatch(escala2);
    }
    for (const i of r.imputaciones) {
      for (const valor of [i.monto, i.pendienteAntes, i.pendienteDespues]) {
        expect(valor, valor).toMatch(escala2);
      }
    }
  });
});

describe("repartirEntreCierres — nada de ceros (R12)", () => {
  it("un cierre con pendiente 0.00 NO aparece y NO ocupa plaza de la ventana", () => {
    const cierres = [
      cierre("c-saldado", "0.00", dia(1)),
      cierre("c1", "500.00", dia(2)),
      cierre("c2", "500.00", dia(3)),
    ];
    const r = repartirEntreCierres("800.00", cierres, TOPE_AMPLIO);

    expect(ids(r)).toEqual(["c1", "c2"]);
    expect(r.imputable).toBe("1000.00");
    expect(r.imputableTotal).toBe("1000.00");
    expect(r.recorte.enVentana).toBe(2);
  });

  it("un pendiente negativo (dato historico raro) se descarta igual que el cero", () => {
    const cierres = [cierre("c-raro", "-10.00", dia(1)), cierre("c1", "100.00", dia(2))];
    const r = repartirEntreCierres("50.00", cierres, TOPE_AMPLIO);

    expect(ids(r)).toEqual(["c1"]);
    expect(r.imputable).toBe("100.00");
  });

  it("sin ningun cierre imputable no hay imputaciones y el sobrante es el importe entero", () => {
    const r = repartirEntreCierres("500.00", [], TOPE_AMPLIO);

    expect(r.imputaciones).toEqual([]);
    expect(r.totalImputado).toBe("0.00");
    expect(r.imputable).toBe("0.00");
    expect(r.imputableTotal).toBe("0.00");
    expect(r.sobrante).toBe("500.00");
    expect(r.recorte).toEqual({ tope: TOPE_AMPLIO, enVentana: 0, fuera: 0, montoFuera: "0.00" });
  });

  it("importe 0: ninguna imputacion, ni siquiera de 0.00", () => {
    const r = repartirEntreCierres("0.00", [cierre("c1", "100.00", dia(1))], TOPE_AMPLIO);

    expect(r.imputaciones).toEqual([]);
    expect(r.totalImputado).toBe("0.00");
    // El imputable de la ventana SI se informa: es el disponible que la pantalla ensena.
    expect(r.imputable).toBe("100.00");
  });
});

describe("repartirEntreCierres — la ventana y su recorte (R53, R54, R56)", () => {
  const CINCO = [
    cierre("c1", "1000.00", dia(1)),
    cierre("c2", "1000.00", dia(2)),
    cierre("c3", "1000.00", dia(3)),
    cierre("c4", "2000.00", dia(4)),
    cierre("c5", "3000.00", dia(5)),
  ];

  it("R54: con tope 2 y 5 imputables, solo los DOS mas antiguos reciben — y NO hay rechazo", () => {
    const r = repartirEntreCierres("2000.00", CINCO, 2);

    expect(ids(r)).toEqual(["c1", "c2"]);
    expect(montos(r)).toEqual(["1000.00", "1000.00"]);
    expect(r.totalImputado).toBe("2000.00");
    expect(r.sobrante).toBe("0.00");
    expect(r.recorte).toEqual({
      tope: 2,
      enVentana: 2,
      fuera: 3,
      montoFuera: "6000.00", // 1000 + 2000 + 3000, los tres recortados
    });
    expect(r.imputable).toBe("2000.00"); // el de la VENTANA
    expect(r.imputableTotal).toBe("8000.00"); // el de los CINCO
    expect(r.imputable).not.toBe(r.imputableTotal);
  });

  it("R55: ningun cierre fuera de la ventana aparece en las imputaciones, ni con importe de sobra", () => {
    const r = repartirEntreCierres("8000.00", CINCO, 2);

    expect(ids(r)).toEqual(["c1", "c2"]);
    for (const recortado of ["c3", "c4", "c5"]) {
      expect(ids(r)).not.toContain(recortado);
    }
    expect(r.totalImputado).toBe("2000.00");
  });

  it("R14/R38: importe por encima de la VENTANA pero por debajo del total ⇒ sobrante > 0", () => {
    // 5000 cabe de sobra en los 8000 imputables del mensajero, pero NO en los 2000 de la
    // ventana. Es exactamente el `excede` que el servicio informa con el disponible de la
    // ventana, no con el total.
    const r = repartirEntreCierres("5000.00", CINCO, 2);

    expect(r.totalImputado).toBe("2000.00");
    expect(r.imputable).toBe("2000.00");
    expect(r.sobrante).toBe("3000.00");
    expect(r.imputableTotal).toBe("8000.00");
  });

  it("imputable + montoFuera == imputableTotal para CADA tope (coherencia por construccion)", () => {
    // Sin aritmetica en el test: la particion esperada se escribe a mano tope por tope. Hacer
    // la suma aqui obligaria a operar con dinero en el sitio donde justamente se prueba que no
    // hace falta — y con `parseFloat`, que es lo que este modulo existe para no usar.
    const esperado: Record<number, { imputable: string; montoFuera: string; enVentana: number }> = {
      1: { imputable: "1000.00", montoFuera: "7000.00", enVentana: 1 },
      2: { imputable: "2000.00", montoFuera: "6000.00", enVentana: 2 },
      3: { imputable: "3000.00", montoFuera: "5000.00", enVentana: 3 },
      4: { imputable: "5000.00", montoFuera: "3000.00", enVentana: 4 },
      5: { imputable: "8000.00", montoFuera: "0.00", enVentana: 5 },
      6: { imputable: "8000.00", montoFuera: "0.00", enVentana: 5 },
      50: { imputable: "8000.00", montoFuera: "0.00", enVentana: 5 },
    };

    for (const [tope, e] of Object.entries(esperado)) {
      const r = repartirEntreCierres("100.00", CINCO, Number.parseInt(tope, 10));
      expect(r.imputable, `tope ${tope}`).toBe(e.imputable);
      expect(r.recorte.montoFuera, `tope ${tope}`).toBe(e.montoFuera);
      expect(r.imputableTotal, `tope ${tope}`).toBe("8000.00");
      expect(r.recorte.enVentana, `tope ${tope}`).toBe(e.enVentana);
      expect(r.recorte.enVentana + r.recorte.fuera, `tope ${tope}`).toBe(5);
    }
  });

  it("con recorte, la ventana esta LLENA: `fuera > 0` obliga a `enVentana === tope`", () => {
    // El invariante que hace INDISTINGUIBLES los dos cardinales en la pantalla. `recorte.aplicado`
    // del DTO es `fuera > 0` (LiquidacionService), y quedar alguien fuera exige haber llenado la
    // ventana, asi que ninguna previsualizacion REALISTA puede decir «alcanza a 49 de 50». Por eso
    // el caso que fija de que campo sale la cifra del aviso —`tests/components/
    // RepartoPrevisualizacion.test.tsx`— tiene que usar un `tope` centinela, y lo dice.
    //
    // El dia que esto deje de valer (por ejemplo, si la ventana ENCOGIDA de §2.5.5 llegara a
    // asomarse a la previsualizacion), aquel centinela pasa a ser un dato posible: esta es la
    // asercion que lo avisa.
    const conRecorte = [0, 1, 2, 3, 4].map((tope) => repartirEntreCierres("100.00", CINCO, tope));
    // Autocomprobacion: los cinco topes recortan de verdad. Sin ella el bucle de abajo podria no
    // comprobar nada y seguir en verde.
    expect(conRecorte.map((r) => r.recorte.fuera)).toEqual([5, 4, 3, 2, 1]);
    for (const r of conRecorte) {
      expect(r.recorte.enVentana, `tope ${r.recorte.tope}`).toBe(r.recorte.tope);
    }

    // El contraste: `enVentana < tope` SOLO se da sin nadie fuera, y entonces no hay aviso que
    // pintar. Es la otra mitad de por que los dos campos no se distinguen en pantalla.
    const holgado = repartirEntreCierres("100.00", CINCO, 8);
    expect(holgado.recorte.fuera).toBe(0);
    expect(holgado.recorte.enVentana).toBe(5);
    expect(holgado.recorte.enVentana).not.toBe(holgado.recorte.tope);
  });

  it("BORDE tope = 1: ventana de uno, los otros cuatro recortados", () => {
    const r = repartirEntreCierres("5000.00", CINCO, 1);

    expect(ids(r)).toEqual(["c1"]);
    expect(r.recorte).toEqual({ tope: 1, enVentana: 1, fuera: 4, montoFuera: "7000.00" });
    expect(r.imputable).toBe("1000.00");
    expect(r.sobrante).toBe("4000.00");
  });

  it("BORDE tope = numero exacto de cierres: nada recortado", () => {
    const r = repartirEntreCierres("8000.00", CINCO, 5);

    expect(ids(r)).toEqual(["c1", "c2", "c3", "c4", "c5"]);
    expect(r.recorte).toEqual({ tope: 5, enVentana: 5, fuera: 0, montoFuera: "0.00" });
    expect(r.imputable).toBe("8000.00");
    expect(r.imputable).toBe(r.imputableTotal);
  });

  it("BORDE tope MAYOR que el numero de cierres: recorte inerte, todo igual que sin tope", () => {
    const conTope = repartirEntreCierres("8000.00", CINCO, 500);
    const sinRecorte = repartirEntreCierres("8000.00", CINCO, 5);

    expect(conTope.imputaciones).toEqual(sinRecorte.imputaciones);
    expect(conTope.recorte.fuera).toBe(0);
    expect(conTope.recorte.montoFuera).toBe("0.00");
    expect(conTope.imputable).toBe(conTope.imputableTotal);
  });

  it("BORDE tope = 0: la ventana queda vacia y nada se imputa (defensivo, la config da >= 1)", () => {
    const r = repartirEntreCierres("1000.00", CINCO, 0);

    expect(r.imputaciones).toEqual([]);
    expect(r.imputable).toBe("0.00");
    expect(r.imputableTotal).toBe("8000.00");
    expect(r.recorte).toEqual({ tope: 0, enVentana: 0, fuera: 5, montoFuera: "8000.00" });
  });

  it("BORDE tope negativo: se trata como 0, NUNCA como 'los ultimos N' de un slice al reves", () => {
    const r = repartirEntreCierres("1000.00", CINCO, -2);

    expect(r.imputaciones).toEqual([]);
    expect(r.recorte.enVentana).toBe(0);
    expect(r.recorte.fuera).toBe(5);
  });
});

describe("repartirEntreCierres — la ventana ENCOGE, no se rellena (design §2.5.5)", () => {
  // El servicio congela la ventana al tomar los bloqueos y vuelve a llamar a esta funcion con
  // ESOS cierres y sus pendientes releidos. Si uno se cayo, el reparto toca uno menos: no sube
  // el cierre 51 a rellenar el hueco, porque eso exigiria bloquear un cierre fuera del orden
  // acordado. Aqui se comprueba lo que la funcion pura puede garantizar de eso.

  const CINCO = [
    cierre("c1", "1000.00", dia(1)),
    cierre("c2", "1000.00", dia(2)),
    cierre("c3", "1000.00", dia(3)),
    cierre("c4", "1000.00", dia(4)),
    cierre("c5", "1000.00", dia(5)),
  ];

  it("la ventana congelada de 2 en la que uno se salda produce UNA imputacion y enVentana 1", () => {
    const ventanaCongelada = repartirEntreCierres("2000.00", CINCO, 2).imputaciones.map(
      (i) => i.cierreId,
    );
    expect(ventanaCongelada).toEqual(["c1", "c2"]);

    // Bajo bloqueo, c1 resulto ya saldado (alguien pago por otra via). Se relee la MISMA
    // ventana, no el conjunto entero.
    const releidos = [cierre("c1", "0.00", dia(1)), cierre("c2", "1000.00", dia(2))];
    const r = repartirEntreCierres("2000.00", releidos, 2);

    expect(ids(r)).toEqual(["c2"]);
    expect(r.recorte.enVentana).toBe(1); // ENCOGIO: no dice 2
    expect(r.recorte.fuera).toBe(0);
    expect(r.imputable).toBe("1000.00");
    // Y el importe ya no cabe: es el `excede` con el disponible recalculado (R23).
    expect(r.sobrante).toBe("1000.00");
  });

  it("NO se rellena: c3 es imputable pero no estaba en la ventana congelada, y no entra", () => {
    const releidos = [cierre("c1", "0.00", dia(1)), cierre("c2", "1000.00", dia(2))];
    const r = repartirEntreCierres("2000.00", releidos, 2);

    expect(ids(r)).not.toContain("c3");
    expect(r.imputaciones).toHaveLength(1);
    // El imputable informado es el de la ventana ENCOGIDA, no el que tenia antes.
    expect(r.imputable).toBe("1000.00");
  });

  it("enVentana cuenta la ventana REAL, no min(tope, entrada)", () => {
    // Tres entradas, tope 3, pero dos ya saldadas: la ventana es de UNO. Un `min(tope, largo)`
    // diria 3 y mentiria sobre cuantos cierres toca este reparto.
    const releidos = [
      cierre("c1", "0.00", dia(1)),
      cierre("c2", "0.00", dia(2)),
      cierre("c3", "700.00", dia(3)),
    ];
    const r = repartirEntreCierres("700.00", releidos, 3);

    expect(r.recorte.enVentana).toBe(1);
    expect(r.recorte.fuera).toBe(0);
    expect(r.imputable).toBe("700.00");
    expect(r.imputableTotal).toBe("700.00");
  });
});

describe("el modulo del reparto es PURO (R17, R53)", () => {
  const RAIZ = path.resolve(__dirname, "../../..");
  const RUTA = "lib/utils/reparto-liquidacion-mensajero.ts";
  // Sobre el CODIGO, no sobre el texto crudo: la cabecera CITA a proposito lo que no hace.
  const codigo = quitarComentarios(readFileSync(path.join(RAIZ, RUTA), "utf8"));

  it("no lee el entorno: el tope entra por parametro (R53, design §2.5.2)", () => {
    expect(codigo).not.toMatch(/process\.env/);
  });

  it("no lee el reloj: ningun `new Date(...)` en todo el modulo", () => {
    expect(codigo).not.toMatch(/new\s+Date\s*\(/);
  });

  it("no conoce Next, ni repositorios, ni servicios, ni el cliente de Prisma", () => {
    for (const prohibido of [
      /from\s+"next\//,
      /from\s+"@\/lib\/repositories\//,
      /from\s+"@\/lib\/services\//,
      /\bPrismaClient\b/,
    ]) {
      expect(codigo, String(prohibido)).not.toMatch(prohibido);
    }
    // Lo unico que importa de Prisma es el DECIMAL, que es la aritmetica exacta.
    expect(codigo).toMatch(/import\s*\{\s*Prisma\s*\}\s*from\s*"@prisma\/client"/);
  });

  it("R16: ni una conversion de monto a numero — solo `toFixed(2)` de serializacion", () => {
    expect(codigo).not.toMatch(/\bNumber\s*\(/);
    expect(codigo).not.toMatch(/\bparseFloat\s*\(/);
    expect(codigo).not.toMatch(/\bparseInt\s*\(/);
    for (const uso of codigo.matchAll(/\.toFixed\(([^)]*)\)/g)) {
      expect(uso[1].trim()).toBe("2");
    }
  });

  it("el archivo de test no importa Prisma: entra STRING, sale STRING", () => {
    const propio = readFileSync(path.join(RAIZ, "tests/unit/utils/reparto-liquidacion-mensajero.test.ts"), "utf8");
    expect(propio).not.toMatch(/from\s+"@prisma\/client"/);
  });
});
