// FICHA 442 (F1) — «En qué terminaron»: el reparto de UNA fila en tramos y en frase.
//
// Lo que estos casos protegen es lo mismo que protegían las cuatro columnas que sustituye: que
// el desglose SUME la columna «Órdenes» y que no se escriba ninguna lista de estados a mano.
//
// El módulo es PURO, así que aquí no se monta nada: se comprueba el reparto, que es lo único
// que puede equivocarse. Que la CELDA lo pinte lo comprueban `ProductosTabla.test.tsx` y
// `ProductosTablaDinero.test.tsx` leyendo el DOM.
import { describe, it, expect } from "vitest";

import {
  ETIQUETA_EN_PROCESO,
  partesDesenlaceDeFila,
  textoDesenlacesDeFila,
  tramosDeFila,
} from "@/app/(app)/analitica/_components/entregas/desenlaces-de-fila";
import { calcularEfectividad } from "@/app/(app)/analitica/_components/entregas/efectividad";
import { textoComposicionOtrosResultados } from "@/app/(app)/analitica/_components/entregas/otros-resultados";
import { DESENLACES } from "@/lib/types/conteo-entregas";
import type { ConteoDeStatus } from "@/lib/types/conteo-por-status";

/** Un status que NO es ninguno de los desenlaces: la orden sigue su curso. */
const EN_CURSO = "en_reparto";

function desglose(pares: readonly (readonly [string, number])[]): ConteoDeStatus[] {
  return pares.map(([status, conteo]) => ({ status, conteo }));
}

/** La captura del 2026-08-29 que abrió la ficha 346, con sus cinco cubos. */
const CREMA = desglose([
  ["entregado", 3],
  ["devolucion_a_origen_por_rechazo", 2],
  ["novedad", 4],
  ["reprogramado", 2],
  [EN_CURSO, 13],
]);

describe("FICHA 442 · los tres tramos son una PARTICIÓN del universo de la fila", () => {
  it("entregadas + otro desenlace + en proceso === total, y el total es el de la fila", () => {
    const t = tramosDeFila(CREMA);
    expect(t.entregadas).toBe(3);
    // 2 rechazadas + 4 devueltas + 2 reprogramadas: el resto de lo YA resuelto.
    expect(t.otroDesenlace).toBe(8);
    expect(t.enProceso).toBe(13);
    expect(t.entregadas + t.otroDesenlace + t.enProceso).toBe(t.total);
    expect(t.total).toBe(24);
  });

  it("los tramos SALEN de `calcularEfectividad`: no hay un segundo recuento", () => {
    // ⚠ ES EL PEDIDO EXPLÍCITO DE LA FICHA («no calcules una segunda») y lo que
    // `ConteoProductosService` dice por escrito. Se compara contra la función compartida, que es
    // la misma que alimenta la tarjeta héroe de la 441 y el archivo descargable.
    const e = calcularEfectividad(CREMA);
    const t = tramosDeFila(CREMA);
    expect(t.entregadas).toBe(e.entregadas);
    expect(t.otroDesenlace).toBe(e.rechazadas + e.otrosDesenlaces);
    expect(t.enProceso).toBe(e.enProceso);
    expect(t.total).toBe(e.total);
  });

  it("un SEXTO desenlace del catálogo entra solo en «otro desenlace», no se evapora", () => {
    // ⚠ ESTE ES EL CASO QUE DISTINGUE DERIVAR DE ESCRIBIR. Una lista escrita a mano
    // (`["devuelta","reprogramada","incidente"]`) pasa todos los demás casos de este archivo y
    // cae aquí: el estado nuevo no sería ni «otro desenlace» ni «en proceso» y desaparecería de
    // la barra en silencio, que es exactamente el defecto que la ficha 346 reparó.
    const sexto = DESENLACES[DESENLACES.length - 1];
    const soloElSexto = desglose([
      ["entregado", 1],
      [sexto, 5],
      [EN_CURSO, 2],
    ]);
    const t = tramosDeFila(soloElSexto);
    expect(t.total).toBe(8);
    // `sexto` puede ser `entregada` o `rechazada` según el orden del catálogo; en los dos casos
    // la igualdad de partición tiene que sostenerse, y es lo que se afirma.
    expect(t.entregadas + t.otroDesenlace + t.enProceso).toBe(t.total);
    expect(t.enProceso).toBe(2);
  });

  it("sin ninguna orden, los tres tramos son cero y el total también", () => {
    const t = tramosDeFila([]);
    expect(t).toEqual({ entregadas: 0, otroDesenlace: 0, enProceso: 0, total: 0 });
  });
});

describe("FICHA 442 · la frase enumera TODOS los cubos y suma la columna «Órdenes»", () => {
  it("la captura de la 346: «3 entregadas · 2 rechazadas · 4 devueltas · 2 reprogramadas · 13 en proceso»", () => {
    expect(textoDesenlacesDeFila(CREMA)).toBe(
      "3 entregadas · 2 rechazadas · 4 devueltas · 2 reprogramadas · 13 en proceso",
    );
  });

  it("los números de la frase suman el universo de la fila — la igualdad de la 346", () => {
    // ⚠ SE SUMA LO QUE LA FRASE DICE, no lo que la función sabe: se extraen los números del
    // texto. Antes del arreglo de la 346 la cuenta daba 18 sobre un universo de 24, y ése es
    // exactamente el defecto que esta forma nueva NO puede reintroducir.
    const numeros = [...textoDesenlacesDeFila(CREMA).matchAll(/(\d+)\s/g)].map((m) =>
      Number(m[1]),
    );
    expect(numeros).toEqual([3, 2, 4, 2, 13]);
    expect(numeros.reduce((a, b) => a + b, 0)).toBe(tramosDeFila(CREMA).total);
  });

  it("FICHA 442 — concuerda en número: «1 rechazada», no «1 rechazadas»", () => {
    // ⚠ EL SINGULAR NO SE CALCULA, ES EL `value` DEL CATÁLOGO. `order_status` guarda
    // `rechazada` y `devuelta` en singular; lo que hace `etiquetaDeDesenlace` es pluralizarlos.
    // Por eso aquí no hay ninguna regla de morfología del español que pueda equivocarse con un
    // desenlace nuevo: con cantidad 1 se usa el value tal cual.
    const una = desglose([
      ["entregado", 4],
      ["devolucion_a_origen_por_rechazo", 1],
      ["novedad", 1],
      [EN_CURSO, 1],
    ]);
    expect(textoDesenlacesDeFila(una)).toBe("4 entregadas · 1 rechazada · 1 devuelta · 1 en proceso");
    // Y el plural sigue intacto con dos.
    expect(textoDesenlacesDeFila(desglose([["devolucion_a_origen_por_rechazo", 2]]))).toBe("2 rechazadas");
    // «en proceso» es invariante: no es un value del catálogo y no se pluralizaba nunca.
    expect(textoDesenlacesDeFila(desglose([[EN_CURSO, 1]]))).toBe("1 en proceso");
  });

  it("y el archivo descargable dice lo MISMO: una sola redacción para los dos", () => {
    // La composición de «Otros resultados» viaja al `.xlsx` y se lee al lado de la tabla. Si la
    // concordancia viviera sólo en la pantalla, la misma fila diría «1 devuelta» en una y
    // «1 devueltas» en el otro — que es el tipo de diferencia que nadie mira dos veces.
    const una = desglose([
      ["entregado", 4],
      ["novedad", 1],
    ]);
    expect(textoComposicionOtrosResultados(una)).toBe("1 devuelta");
    expect(textoDesenlacesDeFila(una)).toContain("1 devuelta");
  });

  it("un cubo en CERO no se nombra: «0 rechazadas» es ruido, no información", () => {
    const sinRechazos = desglose([
      ["entregado", 4],
      [EN_CURSO, 2],
    ]);
    expect(textoDesenlacesDeFila(sinRechazos)).toBe("4 entregadas · 2 en proceso");
    expect(textoDesenlacesDeFila(sinRechazos)).not.toContain("0 ");
  });

  it("y sin ninguna orden la frase es VACÍA: una línea en blanco hace la fila más alta y no dice nada", () => {
    expect(textoDesenlacesDeFila([])).toBe("");
    expect(partesDesenlaceDeFila([])).toEqual([]);
  });

  it("«en proceso» se escribe UNA vez y no es un `value` del catálogo", () => {
    // Se define por NEGACIÓN («lo que no tiene desenlace»), así que no hay ninguna fila de
    // `order_status` de la que sacarlo: es el único rótulo escrito a mano del módulo.
    expect(ETIQUETA_EN_PROCESO).toBe("en proceso");
    expect(DESENLACES).not.toContain(ETIQUETA_EN_PROCESO);
    const partes = partesDesenlaceDeFila(CREMA);
    expect(partes[partes.length - 1]).toEqual({
      clave: "en_proceso",
      etiqueta: ETIQUETA_EN_PROCESO,
      conteo: 13,
    });
  });

  it("las etiquetas SALEN del catálogo, no de una tabla escrita aquí", () => {
    // El mismo mecanismo que usa la composición de «Otros resultados» desde la 347
    // (`etiquetaDeDesenlace`), que es lo que hace que un renombre del catálogo llegue solo.
    const claves = partesDesenlaceDeFila(CREMA).map((p) => p.clave);
    for (const clave of claves.slice(0, -1)) {
      expect(DESENLACES, clave).toContain(clave);
    }
  });

  it("el orden es DETERMINISTA: entregadas, rechazadas, el resto y lo que sigue vivo", () => {
    // El bloque del medio hereda el orden de `composicionOtrosResultados` (cantidad desc y
    // `status` asc por unidades de código, sin `localeCompare`), así que dos máquinas producen
    // la misma frase — que importa porque este texto se lee al lado del archivo descargable.
    const mezclado = desglose([
      [EN_CURSO, 1],
      ["reprogramado", 2],
      ["entregado", 9],
      ["novedad", 2],
      ["devolucion_a_origen_por_rechazo", 3],
    ]);
    expect(partesDesenlaceDeFila(mezclado).map((p) => p.clave)).toEqual([
      "entregado",
      "devolucion_a_origen_por_rechazo",
      "novedad",
      "reprogramado",
      "en_proceso",
    ]);
  });
});
