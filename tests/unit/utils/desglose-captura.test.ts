import { describe, expect, it } from "vitest";

import {
  ERRORES_LINEA,
  acotarMonto,
  capturaCuadra,
  centimosNoCapturables,
  cuadreInalcanzable,
  erroresDeLinea,
  lineaNueva,
  lineasIniciales,
  lineasParaEnviar,
  opcionesPara,
  pendiente,
  puedeAnadirLinea,
  sinPendiente,
  topeDeLinea,
  totalCapturado,
  type LineaEnEdicion,
} from "@/app/(app)/mis-asignaciones/_components/desglose-captura";
import { METODO_PAGO_SEED } from "@/lib/types/metodo-pago";

// Feature 213 (T2) — modulo PURO de la captura del desglose. Cubre R3, R4, R5, R11, R12 y R13.

function linea(metodo: LineaEnEdicion["metodo"], monto: string): LineaEnEdicion {
  return { id: `l-${metodo}-${monto}`, metodo, monto };
}

describe("desglose-captura — arranque del editor (R2/R4)", () => {
  it("arranca con exactamente una linea, sin metodo y con el monto a cobrar pre-cargado", () => {
    const lineas = lineasIniciales(8000);

    expect(lineas).toHaveLength(1);
    expect(lineas[0].metodo).toBe("");
    expect(lineas[0].monto).toBe("8000");
    expect(lineas[0].id).not.toBe("");
  });

  it("la linea nueva nace con el monto pendiente pre-cargado y un id propio", () => {
    const primera = lineaNueva(3000);
    const segunda = lineaNueva(3000);

    expect(primera.monto).toBe("3000");
    expect(primera.metodo).toBe("");
    expect(primera.id).not.toBe(segunda.id);
  });
});

describe("desglose-captura — puedeAnadirLinea (R3)", () => {
  it("puedeAnadirLinea es falso con 3 lineas", () => {
    const tres = [linea("efectivo", "1000"), linea("SINPE", "1000"), linea("transferencia", "1000")];

    expect(tres).toHaveLength(METODO_PAGO_SEED.length);
    expect(puedeAnadirLinea(tres)).toBe(false);
  });

  it("puedeAnadirLinea es cierto mientras queden metodos sin usar", () => {
    expect(puedeAnadirLinea([])).toBe(true);
    expect(puedeAnadirLinea(lineasIniciales(8000))).toBe(true);
    expect(puedeAnadirLinea([linea("efectivo", "5000"), linea("SINPE", "3000")])).toBe(true);
  });
});

// Pedido humano (2026-08-14). `sinPendiente` es la OTRA mitad del control «Anadir metodo»: R3
// decide si el control EXISTE (tope de catalogo) y esto decide si se puede PULSAR. Son reglas
// distintas a proposito y por eso se prueban aparte.
describe("desglose-captura — sinPendiente (anadir con la suma ya cubierta)", () => {
  it("es falso mientras falte por capturar: partir el cobro sigue siendo posible", () => {
    expect(sinPendiente([linea("efectivo", "5000")], 8000)).toBe(false);
    expect(sinPendiente([linea("efectivo", "")], 8000)).toBe(false);
    expect(sinPendiente([], 8000)).toBe(false);
  });

  it("es cierto cuando lo capturado IGUALA el total: la linea nueva naceria en 0", () => {
    expect(sinPendiente(lineasIniciales(8000), 8000)).toBe(true);
    expect(sinPendiente([linea("efectivo", "5000"), linea("SINPE", "3000")], 8000)).toBe(true);
  });

  it("es cierto cuando lo capturado SUPERA el total: el arreglo es corregir, no anadir", () => {
    expect(sinPendiente([linea("efectivo", "9000")], 8000)).toBe(true);
  });

  it("con una orden sin cobro no hay nada que repartir", () => {
    // El editor ni se monta en ese caso (R16), pero la regla pura no depende de quien la llame.
    expect(sinPendiente([], 0)).toBe(true);
  });

  it("coincide SIEMPRE con que `pendiente` sea 0: una sola fuente de verdad", () => {
    const casos: [LineaEnEdicion[], number][] = [
      [[linea("efectivo", "5000")], 8000],
      [[linea("efectivo", "8000")], 8000],
      [[linea("efectivo", "9000")], 8000],
      [[], 8000],
    ];

    for (const [lineas, total] of casos) {
      expect(sinPendiente(lineas, total)).toBe(pendiente(lineas, total) === 0);
    }
  });
});

// Pedido humano (2026-08-14): el monto de una linea no puede pasarse de lo que falta. El ejemplo
// que lo origino —total 1.000, primera linea 700, se teclea 2.000 en la segunda y quedan 300— es
// el primer caso, literal.
describe("desglose-captura — topeDeLinea y acotarMonto (tope por linea)", () => {
  it("el caso que lo origino: total 1.000, la primera lleva 700, la segunda admite 300", () => {
    const lineas = [linea("efectivo", "700"), linea("SINPE", "")];

    expect(topeDeLinea(lineas, 1, 1000)).toBe(300);
    expect(acotarMonto("2000", lineas, 1, 1000)).toBe("300");
  });

  it("lo que CABE se respeta tal cual: acotar no es redondear", () => {
    const lineas = [linea("efectivo", "700"), linea("SINPE", "")];

    expect(acotarMonto("250", lineas, 1, 1000)).toBe("250");
    expect(acotarMonto("300", lineas, 1, 1000)).toBe("300");
  });

  it("el tope EXCLUYE la propia linea: se puede corregir a la baja aunque la suma ya cuadre", () => {
    const lineas = [linea("efectivo", "700"), linea("SINPE", "300")];

    // La linea 1 no se cuenta a si misma, asi que su tope sigue siendo 1.000 - 300.
    expect(topeDeLinea(lineas, 0, 1000)).toBe(700);
    expect(acotarMonto("500", lineas, 0, 1000)).toBe("500");
  });

  it("la primera linea tambien se acota: sin otras lineas, su tope es el total", () => {
    const lineas = [linea("", "")];

    expect(topeDeLinea(lineas, 0, 1000)).toBe(1000);
    expect(acotarMonto("2000", lineas, 0, 1000)).toBe("1000");
  });

  it("si las OTRAS ya cubren el total, el tope es 0 y no admite ni un colon", () => {
    const lineas = [linea("efectivo", "1000"), linea("SINPE", "")];

    expect(topeDeLinea(lineas, 1, 1000)).toBe(0);
    expect(acotarMonto("500", lineas, 1, 1000)).toBe("0");
  });

  it("el campo vacio sobrevive: borrar es un estado legitimo mientras se edita (R13)", () => {
    const lineas = [linea("efectivo", "700"), linea("SINPE", "300")];

    expect(acotarMonto("", lineas, 1, 1000)).toBe("");
  });

  it("sigue filtrando a digitos antes de acotar, como hacia `soloDigitos`", () => {
    const lineas = [linea("", "")];

    expect(acotarMonto("2.5", lineas, 0, 1000)).toBe("25");
    expect(acotarMonto("-1.5", lineas, 0, 1000)).toBe("15");
    expect(acotarMonto("008", lineas, 0, 1000)).toBe("8");
  });

  it("acotado, el desglose NO puede pasarse del total por esta via", () => {
    // Se teclea de mas en las tres lineas, UNA A UNA como hace el panel (cada cambio se acota
    // contra el estado ya actualizado), y la suma no llega a superar el total ni una vez.
    const total = 1000;
    let lineas = [linea("efectivo", ""), linea("SINPE", ""), linea("transferencia", "")];

    for (let i = 0; i < lineas.length; i += 1) {
      const monto = acotarMonto("9999", lineas, i, total);
      lineas = lineas.map((l, j) => (j === i ? { ...l, monto } : l));
      expect(totalCapturado(lineas)).toBeLessThanOrEqual(total);
    }

    expect(totalCapturado(lineas)).toBe(total);
    expect(capturaCuadra(lineas, total)).toBe(true);
  });
});

describe("desglose-captura — pendiente y suma (R4/R11)", () => {
  it("el monto de la linea nueva es la diferencia pendiente, nunca negativa", () => {
    const lineas = [linea("efectivo", "5000")];

    expect(pendiente(lineas, 8000)).toBe(3000);
    expect(lineaNueva(pendiente(lineas, 8000)).monto).toBe("3000");
  });

  it("pendiente es 0 cuando la captura ya cuadra", () => {
    expect(pendiente([linea("efectivo", "8000")], 8000)).toBe(0);
  });

  it("pendiente es 0 —y nunca negativo— cuando la suma se pasa del total", () => {
    const lineas = [linea("efectivo", "5000"), linea("SINPE", "4000")];

    expect(pendiente(lineas, 8000)).toBe(0);
    expect(capturaCuadra(lineas, 8000)).toBe(false);
  });

  it("0.1 + 0.2 contra 0.30 cuadra: la aritmetica es en centimos, no en floats", () => {
    const lineas = [linea("efectivo", "0.1"), linea("SINPE", "0.2")];

    expect(capturaCuadra(lineas, 0.3)).toBe(true);
    expect(pendiente(lineas, 0.3)).toBe(0);
    expect(totalCapturado(lineas)).toBe(0.3);
  });

  it("una diferencia real de un centimo NO cuadra y queda como pendiente", () => {
    const lineas = [linea("efectivo", "0.1"), linea("SINPE", "0.19")];

    expect(capturaCuadra(lineas, 0.3)).toBe(false);
    expect(pendiente(lineas, 0.3)).toBe(0.01);
  });

  it("una linea sin monto o con texto no numerico cuenta como 0 y no ensucia la suma", () => {
    expect(pendiente([linea("efectivo", ""), linea("SINPE", "3000")], 8000)).toBe(5000);
    expect(totalCapturado([linea("efectivo", "abc"), linea("SINPE", "3000")])).toBe(3000);
  });
});

// Feature 300 — un total con CENTIMOS. El editor solo teclea enteros, asi que ese total no tiene
// ninguna captura que lo iguale: lo que hay que arreglar no es la regla, es que nada de lo que se
// ofrece (el pre-cargado, el tope, el aviso) finja que si la tiene.
describe("desglose-captura — total con centimos (feature 300)", () => {
  const CON_CENTIMOS = 11898.81; // el monto de la captura que reporto el humano

  it("centimosNoCapturables devuelve la cola que el teclado no puede escribir", () => {
    expect(centimosNoCapturables(CON_CENTIMOS)).toBe(81);
    expect(centimosNoCapturables(0.05)).toBe(5);
    expect(centimosNoCapturables(-11898.81)).toBe(81); // nunca negativo
  });

  it("con un total ENTERO no hay cola ninguna: el caso de casi todas las ordenes", () => {
    for (const total of [0, 1, 320, 1000, 8000, 11898, 1234567]) {
      expect(centimosNoCapturables(total), `${total}`).toBe(0);
      expect(cuadreInalcanzable(total), `${total}`).toBe(false);
    }
  });

  it("cuadreInalcanzable coincide SIEMPRE con que no exista captura entera que cuadre", () => {
    // No se afirma sobre `cuadreInalcanzable` a solas: se compara contra la REGLA que gobierna
    // de verdad (`capturaCuadra`) barriendo todos los enteros de alrededor del total.
    for (const total of [8000, 11898.81, 0.5, 999.99, 1000]) {
      const entero = Math.floor(total);
      const alcanzable = [entero - 1, entero, entero + 1].some((intento) =>
        capturaCuadra([linea("efectivo", String(intento))], total),
      );
      expect(alcanzable, `total ${total}`).toBe(!cuadreInalcanzable(total));
    }
  });

  it("el pre-cargado y el tope NO proponen un numero que el propio tope rechaza", () => {
    // El fallo: `textoDeMonto` redondeaba, asi que con 11.898,81 la linea nacia en 11.899 —por
    // ENCIMA de `topeDeLinea`— y acotar devolvia ese mismo 11.899. El editor se contradecia solo.
    expect(topeDeLinea([linea("", "")], 0, CON_CENTIMOS)).toBe(CON_CENTIMOS);
    expect(lineasIniciales(CON_CENTIMOS)[0].monto).toBe("11898");
    expect(acotarMonto("11899", [linea("", "")], 0, CON_CENTIMOS)).toBe("11898");
    expect(lineaNueva(pendiente([linea("efectivo", "11000")], CON_CENTIMOS)).monto).toBe("898");
  });

  it("y ese pre-cargado es el MAXIMO tecleable: uno mas ya se pasa del total", () => {
    expect(totalCapturado([linea("efectivo", "11898")])).toBeLessThan(CON_CENTIMOS);
    expect(totalCapturado([linea("efectivo", "11899")])).toBeGreaterThan(CON_CENTIMOS);
  });
});

describe("desglose-captura — opcionesPara (R5, D2)", () => {
  it("opcionesPara(i) deshabilita los metodos usados en OTRAS lineas, no el de la propia linea", () => {
    const lineas = [linea("efectivo", "5000"), linea("", "3000")];

    const opcionesDeLa0 = opcionesPara(lineas, 0);
    const opcionesDeLa1 = opcionesPara(lineas, 1);

    expect(opcionesDeLa0.find((o) => o.value === "efectivo")?.disabled).toBe(false);
    expect(opcionesDeLa1.find((o) => o.value === "efectivo")?.disabled).toBe(true);
    expect(opcionesDeLa1.find((o) => o.value === "SINPE")?.disabled).toBe(false);
    expect(opcionesDeLa1.find((o) => o.value === "transferencia")?.disabled).toBe(false);
  });

  it("nunca oculta una opcion: siempre devuelve el catalogo completo con su etiqueta legible", () => {
    const lineas = [linea("efectivo", "5000"), linea("SINPE", "3000")];

    const opciones = opcionesPara(lineas, 1);

    expect(opciones.map((o) => o.value)).toEqual([...METODO_PAGO_SEED]);
    expect(opciones.map((o) => o.label)).toEqual(["Efectivo", "SINPE", "Transferencia"]);
  });
});

describe("desglose-captura — lineasParaEnviar (R12)", () => {
  it("lineasParaEnviar descarta las lineas completamente vacias", () => {
    const lineas = [linea("efectivo", "8000"), linea("", ""), linea("", "   ")];

    expect(lineasParaEnviar(lineas)).toEqual([{ metodo: "efectivo", monto: 8000 }]);
  });

  it("lineasParaEnviar NO descarta la linea a medias: metodo sin monto y monto sin metodo sobreviven", () => {
    const soloMetodo = lineasParaEnviar([linea("efectivo", "5000"), linea("SINPE", "")]);
    const soloMonto = lineasParaEnviar([linea("efectivo", "5000"), linea("", "3000")]);

    expect(soloMetodo).toHaveLength(2);
    expect(soloMetodo[1]).toEqual({ metodo: "SINPE", monto: 0 });
    expect(soloMonto).toHaveLength(2);
    expect(soloMonto[1]).toEqual({ metodo: "", monto: 3000 });
  });

  it("conserva el orden de captura de las lineas que si se envian", () => {
    const lineas = [linea("SINPE", "3000"), linea("", ""), linea("efectivo", "5000")];

    expect(lineasParaEnviar(lineas).map((l) => l.metodo)).toEqual(["SINPE", "efectivo"]);
  });
});

describe("desglose-captura — erroresDeLinea (R13, lectura estricta [Q6])", () => {
  it("marca metodo-sin-monto en la linea que lo provoca y deja limpias las demas", () => {
    const errores = erroresDeLinea([linea("efectivo", "5000"), linea("SINPE", "")]);

    expect(errores[0]).toBeUndefined();
    expect(errores[1]).toBe(ERRORES_LINEA.montoRequerido);
  });

  it("marca monto-sin-metodo en la linea que lo provoca", () => {
    const errores = erroresDeLinea([linea("efectivo", "5000"), linea("", "3000")]);

    expect(errores[0]).toBeUndefined();
    expect(errores[1]).toBe(ERRORES_LINEA.metodoRequerido);
  });

  it("un monto no estrictamente positivo con metodo elegido es error, no un cobro de cero", () => {
    const errores = erroresDeLinea([linea("efectivo", "0"), linea("SINPE", "-100")]);

    expect(errores[0]).toBe(ERRORES_LINEA.montoRequerido);
    expect(errores[1]).toBe(ERRORES_LINEA.montoRequerido);
  });

  it("la linea completamente vacia NO da error, porque se descarta", () => {
    expect(erroresDeLinea([linea("efectivo", "8000"), linea("", "")])).toEqual([undefined, undefined]);
  });
});
