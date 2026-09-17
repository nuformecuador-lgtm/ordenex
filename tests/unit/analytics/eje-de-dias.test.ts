import { describe, it, expect } from "vitest";

import {
  avisoDeEjeRecortado,
  ejeContinuoDeDias,
} from "@/app/(app)/analitica/_components/entregas/eje-de-dias";
import { MAX_PUNTOS_SERIE } from "@/components/private/analytics/topes";

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 445 — UN DIA SIN CARGAS VALE CERO, NO SE SALTA
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// LOS NUMEROS SON LOS MEDIDOS EN EL NAVEGADOR el 2026-09-17 (sesion de maestro, `/analitica`, sin
// filtro de fecha): la serie traia CINCO dias —2026-07-21: 5, 07-22: 8, 07-23: 32, 07-24: 22 y
// 09-04: 2— y se pintaban equidistantes. Entre el 24 de julio y el 4 de septiembre hay 42 dias
// sin ninguna carga, y en pantalla ese hueco medio lo mismo que el que hay entre el 21 y el 22.
//
// PUNTO DE MUTACION DE LA FICHA: devolver los dias tal como llegan —o sea, volver al eje
// categorico— pone rojos los tres primeros casos con esos mismos numeros.

/** Los cinco dias medidos en pantalla, en el orden en que los sirve el repositorio. */
const MEDIDOS = [
  { fecha: "2026-07-21", conteo: 5 },
  { fecha: "2026-07-22", conteo: 8 },
  { fecha: "2026-07-23", conteo: 32 },
  { fecha: "2026-07-24", conteo: 22 },
  { fecha: "2026-09-04", conteo: 2 },
] as const;

describe("445 · el eje es CONTINUO: un punto por dia calendario", () => {
  it("entre el 2026-07-24 y el 2026-09-04 hay 42 dias, y el eje los tiene todos", () => {
    const eje = ejeContinuoDeDias(MEDIDOS);

    // Del 21 de julio al 4 de septiembre, ambos incluidos.
    expect(eje.puntos).toHaveLength(46);
    expect(eje.puntos[0]).toEqual({ categoria: "2026-07-21", valor: 5 });
    expect(eje.puntos[eje.puntos.length - 1]).toEqual({ categoria: "2026-09-04", valor: 2 });

    // La distancia entre el 24 de julio y el 4 de septiembre, contada en POSICIONES del eje.
    const posicion = (fecha: string) => eje.puntos.findIndex((p) => p.categoria === fecha);
    expect(posicion("2026-09-04") - posicion("2026-07-24")).toBe(42);
    // Y la distancia entre dos dias consecutivos sigue siendo UNA posicion: el eje mide dias,
    // asi que 42 dias miden 42 veces lo que mide uno.
    expect(posicion("2026-07-22") - posicion("2026-07-21")).toBe(1);
  });

  it("los dias sin ninguna carga valen CERO, no `null` ni ausencia", () => {
    const eje = ejeContinuoDeDias(MEDIDOS);
    const hueco = eje.puntos.find((p) => p.categoria === "2026-08-15");

    // Cero es la MEDIDA —la consulta cubrio ese dia y no entro nada—, no un dato que falte.
    // Un `null` aqui lo pintaria como hueco en la linea y afirmaria que no se pudo medir.
    expect(hueco).toEqual({ categoria: "2026-08-15", valor: 0 });
    expect(eje.puntos.every((p) => p.valor !== null)).toBe(true);
  });

  it("rellenar no inventa ni pierde ni una orden: la suma es la misma", () => {
    const eje = ejeContinuoDeDias(MEDIDOS);
    const suma = eje.puntos.reduce((s, p) => s + p.valor, 0);

    expect(suma).toBe(69);
    expect(suma).toBe(MEDIDOS.reduce((s, f) => s + f.conteo, 0));
  });

  it("dos dias seguidos ya venian pegados y siguen pegados", () => {
    const eje = ejeContinuoDeDias([
      { fecha: "2026-08-15", conteo: 12 },
      { fecha: "2026-08-16", conteo: 7 },
    ]);

    expect(eje.puntos.map((p) => p.categoria)).toEqual(["2026-08-15", "2026-08-16"]);
    expect(eje.recortado).toBe(false);
  });
});

describe("445 · de donde salen los extremos del eje", () => {
  // El arranque normal de `/analitica`: el filtro nace vacio y la serie abarca la historia.
  it("SIN ventana, los extremos son el primer y el ultimo dia con cargas", () => {
    const eje = ejeContinuoDeDias([
      { fecha: "2026-08-10", conteo: 3 },
      { fecha: "2026-08-14", conteo: 1 },
    ]);

    expect(eje.puntos).toHaveLength(5);
    expect(eje.puntos[0]?.categoria).toBe("2026-08-10");
    expect(eje.puntos[4]?.categoria).toBe("2026-08-14");
  });

  // Con ventana puesta el eje la cubre ENTERA: si el usuario pidio siete dias y solo hubo
  // cargas el miercoles, la grafica tiene que enseñar los otros seis a cero. Sin esto, pedir
  // una semana y ver un solo punto se lee como «la consulta no encontro el rango».
  it("CON ventana, el eje cubre toda la ventana aunque las cargas sean de un solo dia", () => {
    const eje = ejeContinuoDeDias([{ fecha: "2026-08-12", conteo: 4 }], {
      desde: "2026-08-10",
      hasta: "2026-08-16",
    });

    expect(eje.puntos).toHaveLength(7);
    expect(eje.puntos[0]).toEqual({ categoria: "2026-08-10", valor: 0 });
    expect(eje.puntos[2]).toEqual({ categoria: "2026-08-12", valor: 4 });
    expect(eje.puntos[6]).toEqual({ categoria: "2026-08-16", valor: 0 });
  });

  // Perder un dato por una discrepancia de bordes seria peor que dibujar un dia de mas.
  it("un dia con cargas FUERA de la ventana ensancha el eje, no se tira", () => {
    const eje = ejeContinuoDeDias([{ fecha: "2026-08-20", conteo: 9 }], {
      desde: "2026-08-10",
      hasta: "2026-08-16",
    });

    expect(eje.puntos[0]?.categoria).toBe("2026-08-10");
    expect(eje.puntos[eje.puntos.length - 1]).toEqual({ categoria: "2026-08-20", valor: 9 });
  });

  it("sin dias y sin ventana no hay eje que construir", () => {
    expect(ejeContinuoDeDias([])).toEqual({
      puntos: [],
      recortado: false,
      diasDelPeriodo: 0,
      diasMostrados: 0,
    });
  });

  // Una fecha que no existe no puede convertirse en un eje de miles de dias.
  it("una fecha malformada se ignora en vez de estirar el eje", () => {
    const eje = ejeContinuoDeDias([
      { fecha: "2026-02-31", conteo: 5 },
      { fecha: "no-es-una-fecha", conteo: 5 },
      { fecha: "2026-08-15", conteo: 2 },
    ]);

    expect(eje.puntos).toEqual([{ categoria: "2026-08-15", valor: 2 }]);
  });

  // El cambio de mes y el año bisiesto se cuentan solos porque la aritmetica es de calendario.
  it("cruza el fin de mes sin saltarse ni repetir dias", () => {
    const eje = ejeContinuoDeDias([
      { fecha: "2026-01-30", conteo: 1 },
      { fecha: "2026-02-02", conteo: 1 },
    ]);

    expect(eje.puntos.map((p) => p.categoria)).toEqual([
      "2026-01-30",
      "2026-01-31",
      "2026-02-01",
      "2026-02-02",
    ]);
  });
});

describe("445 · el techo de puntos, que rellenar hace alcanzable", () => {
  // Sin ventana el eje abarca toda la historia y crece un punto por dia: sin este recorte, el
  // techo del paquete (`aplicarTopePuntos`) LANZA fuera de produccion y el panel se cae solo.
  it("por encima del techo se conservan los dias MAS RECIENTES", () => {
    const dias = MAX_PUNTOS_SERIE + 10;
    const eje = ejeContinuoDeDias([
      { fecha: "2026-01-01", conteo: 1 },
      // `2026-01-01` + (dias - 1) dias.
      { fecha: new Date(Date.UTC(2026, 0, dias)).toISOString().slice(0, 10), conteo: 7 },
    ]);

    expect(eje.diasDelPeriodo).toBe(dias);
    expect(eje.diasMostrados).toBe(MAX_PUNTOS_SERIE);
    expect(eje.puntos).toHaveLength(MAX_PUNTOS_SERIE);
    expect(eje.recortado).toBe(true);
    // Lo reciente es lo que se esta mirando: el ultimo dia sobrevive y el primero no.
    expect(eje.puntos[eje.puntos.length - 1]?.valor).toBe(7);
    expect(eje.puntos.some((p) => p.categoria === "2026-01-01")).toBe(false);
  });

  // El techo se IMPORTA del paquete, no se reescribe: el dia que el paquete lo mueva, este eje
  // se mueve con el. Justo en el techo no se recorta nada.
  it("exactamente en el techo no se recorta", () => {
    const eje = ejeContinuoDeDias([
      { fecha: "2026-01-01", conteo: 1 },
      { fecha: new Date(Date.UTC(2026, 0, MAX_PUNTOS_SERIE)).toISOString().slice(0, 10), conteo: 1 },
    ]);

    expect(eje.puntos).toHaveLength(MAX_PUNTOS_SERIE);
    expect(eje.recortado).toBe(false);
    expect(eje.diasMostrados).toBe(eje.diasDelPeriodo);
  });

  // Un eje recortado en silencio es una tendencia sobre un trozo del periodo que el usuario
  // cree completo: el aviso dice los dos numeros.
  it("el aviso dice cuantos dias se ven y cuantos tenia el periodo", () => {
    const aviso = avisoDeEjeRecortado(62, 180);

    expect(aviso).toContain("62");
    expect(aviso).toContain("180");
    expect(aviso).toMatch(/últimos/);
  });
});
