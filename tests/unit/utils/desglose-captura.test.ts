import { describe, expect, it } from "vitest";

import {
  ERRORES_LINEA,
  capturaCuadra,
  erroresDeLinea,
  lineaNueva,
  lineasIniciales,
  lineasParaEnviar,
  opcionesPara,
  pendiente,
  puedeAnadirLinea,
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
