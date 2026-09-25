import { describe, it, expect } from "vitest";

import {
  CABECERA_POR_LIBRO,
  CONCEPTOS_MANUALES,
  CONCEPTO_MANUAL_IDS,
  CONCEPTO_MANUAL_OPTIONS,
  FRASE_DEL_EFECTO,
  GRUPO_CONCEPTO_LABEL,
  conceptoPorId,
  fraseDelLibro,
  libroDelConcepto,
  nombreEnElLibro,
  type ConceptoManual,
} from "@/app/(app)/wallet/_components/wallet-conceptos-manuales";
import { CATEGORIA_LABEL } from "@/app/(app)/wallet/_components/wallet-labels";
import { CATEGORIA_TIENDA_LABEL } from "@/app/(app)/wallet/tiendas/_components/desglose-tienda-labels";
import {
  WALLET_MOVIMIENTO_CATEGORIA_SEED,
  type WalletMovimientoCategoria,
} from "@/lib/types/wallet";

// Ficha 334 (T D2, design §9) — el catálogo de conceptos registrables A MANO es la única
// fuente del selector unificado, así que es el sitio donde se puede AFIRMAR la regla que la
// fusión no puede perder: el gasto FIJO no se registra a mano (R11, heredada del R19 de la 45).
//
// ⭑ FICHA 381 (T H.1) — el catálogo pasa de CUATRO a CINCO conceptos, y el quinto es el primero
// que NO escribe en la caja de Ordenex: cobrarle un costo a una tienda va al libro de esa tienda
// (R1/R19) y no produce ningún movimiento de caja (R24, decisión D1 del humano).
//
// El «son exactamente CUATRO» de la 334 ERA un contrato —decía que ningún concepto automático se
// podía registrar a mano—, así que aquí se ACTUALIZA a cinco, no se relaja: la lista sigue siendo
// una igualdad exacta, el barrido del SEED de la caja sigue siendo exhaustivo, y lo que aquella
// regla protegía (que ningún concepto abra a mano una categoría de caja que emite la máquina) se
// afirma ahora sobre los conceptos que van a la caja, que son los mismos cuatro de entonces.

const CATEGORIAS_CAJA_ESPERADAS = [
  "egreso_gasto_variable",
  "egreso_sueldo",
  "ingreso_ajuste",
  "egreso_ajuste",
] as const;

/**
 * Los cuatro conceptos de la ficha 334 (gastos administrativos y ajustes).
 *
 * FICHA 459 — antes se filtraba «todo lo que no es cobro a una tienda», que eran exactamente
 * estos cuatro. Desde la 459 hay dos conceptos más que tampoco son cobro (el pago por cuenta y
 * el saldo inicial o aporte), así que el filtro pasa a nombrar las DOS clases de la 334: la
 * regla que protegía (ningún concepto abre a mano una categoría de la máquina) se afirma igual,
 * y los dos nuevos tienen su propia lista exacta más abajo.
 */
function conceptosDeCaja(): ConceptoManual[] {
  return CONCEPTOS_MANUALES.filter(
    (c) => c.destino.clase === "egreso_administrativo" || c.destino.clase === "ajuste_manual",
  );
}

/** La categoría de caja de un concepto de caja, con el estrechamiento que el tipo exige. */
function categoriaDeCaja(concepto: ConceptoManual): WalletMovimientoCategoria {
  if (concepto.destino.clase === "cobro_tienda") {
    throw new Error(`${concepto.id} no escribe en la caja`);
  }
  return concepto.destino.categoria;
}

// FICHA 459 (T B.15) — «exactamente CINCO» pasa a «exactamente SIETE» y el orden cambia a los
// tres grupos de R59. Los dos casos de abajo son los de la 334/381 REESCRITOS (listados en
// `progress/impl_459_frontend.md`): siguen siendo igualdades exactas, con la lista nueva.
describe("catálogo de conceptos manuales — son exactamente SIETE (R3 / 381-R1 / 459-R59)", () => {
  it("el catálogo ofrece los siete conceptos del pedido y ninguno más, en los tres grupos", () => {
    expect(CONCEPTOS_MANUALES).toHaveLength(7);
    expect(CONCEPTOS_MANUALES.map((c) => c.id)).toEqual([
      "gasto_variable",
      "sueldo",
      "pago_por_cuenta_tienda",
      "ajuste_egreso",
      "aporte_capital",
      "ajuste_ingreso",
      "cobro_tienda",
    ]);
    // Las opciones del `Select` salen del catálogo, no de una segunda lista escrita a mano.
    expect(CONCEPTO_MANUAL_OPTIONS.map((o) => o.value)).toEqual([...CONCEPTO_MANUAL_IDS]);
  });

  it("el gasto variable sigue siendo el primero y los cuatro de la 334 conservan su orden relativo (R11)", () => {
    // Quien abría el diálogo y pulsaba «Registrar» sin tocar el selector registraba un gasto
    // variable, y sigue haciéndolo.
    expect(CONCEPTOS_MANUALES[0].id).toBe("gasto_variable");
    expect(conceptosDeCaja().map((c) => c.id)).toEqual([
      "gasto_variable",
      "sueldo",
      "ajuste_egreso",
      "ajuste_ingreso",
    ]);
  });
});

describe("catálogo de conceptos manuales — ningún concepto lleva al gasto FIJO (R11)", () => {
  it("el conjunto de categorías de CAJA es EXACTAMENTE las cuatro admitidas", () => {
    const destino = conceptosDeCaja().map(categoriaDeCaja).sort();
    expect(destino).toEqual([...CATEGORIAS_CAJA_ESPERADAS].sort());
    // Anti-vacuidad: si el filtro se quedara sin conceptos, la igualdad de arriba sería trivial.
    expect(conceptosDeCaja()).toHaveLength(4);
  });

  it("ninguno mapea a `egreso_gasto_fijo` ni a ninguna otra categoría del SEED", () => {
    const destino = new Set<string>(conceptosDeCaja().map(categoriaDeCaja));
    expect(destino.has("egreso_gasto_fijo")).toBe(false);

    // Y no solo el gasto fijo: se barre el SEED ENTERO, así que un concepto nuevo que abriera
    // `egreso_pago_tienda` o `ingreso_flete` a mano —cinco escrituras que hoy son automáticas—
    // cae aquí igual que caería el gasto fijo.
    const prohibidas = WALLET_MOVIMIENTO_CATEGORIA_SEED.filter(
      (c) => !CATEGORIAS_CAJA_ESPERADAS.includes(c as (typeof CATEGORIAS_CAJA_ESPERADAS)[number]),
    );
    expect(prohibidas.length, "el SEED se quedó sin categorías: no se estaría midiendo nada").
      toBeGreaterThan(4);
    for (const categoria of prohibidas) {
      expect(destino.has(categoria), `el concepto abre \`${categoria}\` a mano`).toBe(false);
    }
  });

  it("los dos ajustes van por `manual` y los dos gastos por `gasto` (design §6)", () => {
    // De este campo cuelga qué es reversable (`esEgresoAdministrativo`): el enrutado no puede
    // colapsar en una sola action sin cambiar, en silencio, qué movimientos se pueden deshacer.
    //
    // ⭑ FICHA 381: la `categoria` se mudó DENTRO del destino (design §4), así que estos cuatro
    // `toEqual` la incluyen ahora. Siguen siendo literales y siguen siendo el contrato: son el
    // payload exacto que cada concepto le manda a su Server Action.
    expect(conceptoPorId("gasto_variable")?.destino).toEqual({
      clase: "egreso_administrativo",
      tipoEgreso: "gasto_variable",
      categoria: "egreso_gasto_variable",
    });
    expect(conceptoPorId("sueldo")?.destino).toEqual({
      clase: "egreso_administrativo",
      tipoEgreso: "sueldo",
      categoria: "egreso_sueldo",
    });
    expect(conceptoPorId("ajuste_ingreso")?.destino).toEqual({
      clase: "ajuste_manual",
      tipo: "ingreso",
      categoria: "ingreso_ajuste",
    });
    expect(conceptoPorId("ajuste_egreso")?.destino).toEqual({
      clase: "ajuste_manual",
      tipo: "egreso",
      categoria: "egreso_ajuste",
    });
  });
});

describe("⭑ FICHA 381 — el quinto concepto cobra a una tienda (R1/R24)", () => {
  it("existe, se llama «Cobrar un costo a una tienda» y va al libro de la TIENDA", () => {
    const cobro = conceptoPorId("cobro_tienda");
    expect(cobro).toBeDefined();
    // Literal, y es el contrato: es el texto del selector, lo que el humano ve para decidir.
    // Es la propuesta de diseño de la pregunta Q1 del spec, que sigue SIN FIRMAR.
    expect(cobro?.label).toBe("Cobrar un costo a una tienda");
    expect(cobro?.destino).toEqual({ clase: "cobro_tienda", categoria: "cobro_manual" });
    expect(libroDelConcepto(cobro!)).toBe("tienda");
  });

  it("es el ÚNICO que no va a la caja; el pago por cuenta (459) va a los DOS libros", () => {
    // Sin la segunda mitad, un `libroDelConcepto` que devolviera siempre «tienda» pasaría.
    const porLibro = CONCEPTOS_MANUALES.map((c) => [c.id, libroDelConcepto(c)]);
    expect(porLibro).toEqual([
      ["gasto_variable", "caja"],
      ["sueldo", "caja"],
      ["pago_por_cuenta_tienda", "caja_y_tienda"],
      ["ajuste_egreso", "caja"],
      ["aporte_capital", "caja"],
      ["ajuste_ingreso", "caja"],
      ["cobro_tienda", "tienda"],
    ]);
  });

  it("trae su propia etiqueta de descripción, distinta de la de los ajustes de caja", () => {
    const cobro = conceptoPorId("cobro_tienda")!;
    expect(cobro.descripcionLabel).toBe("Motivo del cobro");
    expect(cobro.descripcionLabel).not.toBe(conceptoPorId("ajuste_egreso")?.descripcionLabel);
    expect(cobro.descripcionPlaceholder.trim().length).toBeGreaterThan(0);
  });
});

describe("catálogo de conceptos manuales — cada concepto trae su etiqueta de descripción (R9)", () => {
  it("los cinco tienen etiqueta, etiqueta de descripción y ejemplo no vacíos", () => {
    for (const concepto of CONCEPTOS_MANUALES) {
      expect(concepto.label.trim().length, concepto.id).toBeGreaterThan(0);
      expect(concepto.descripcionLabel.trim().length, concepto.id).toBeGreaterThan(0);
      expect(concepto.descripcionPlaceholder.trim().length, concepto.id).toBeGreaterThan(0);
    }
  });

  it("las DOS etiquetas que ya existían se conservan byte a byte", () => {
    expect(conceptoPorId("gasto_variable")?.descripcionLabel).toBe("Concepto del gasto");
    expect(conceptoPorId("sueldo")?.descripcionLabel).toBe("Trabajador y periodo");
    // Los dos ajustes estrenan la suya, y es la MISMA para los dos: lo que se pide es el motivo.
    expect(conceptoPorId("ajuste_ingreso")?.descripcionLabel).toBe("Motivo del ajuste");
    expect(conceptoPorId("ajuste_egreso")?.descripcionLabel).toBe("Motivo del ajuste");
  });
});

describe("catálogo de conceptos manuales — el nombre del libro se DERIVA (R4)", () => {
  it("cada concepto de caja dice el nombre con que su categoría sale en el libro", () => {
    for (const concepto of conceptosDeCaja()) {
      expect(nombreEnElLibro(concepto)).toBe(CATEGORIA_LABEL[categoriaDeCaja(concepto)]);
      expect(nombreEnElLibro(concepto).trim().length, concepto.id).toBeGreaterThan(0);
    }
    // Control de no-vacuidad: la derivación entrega los nombres REALES del libro, no cadenas
    // vacías que casarían con cualquier cosa.
    expect(nombreEnElLibro(CONCEPTOS_MANUALES[0])).toBe("Gasto variable");
    // FICHA 459: por id y no por posición —el reordenado de R59 movió el ajuste que suma—.
    expect(nombreEnElLibro(conceptoPorId("ajuste_ingreso")!)).toBe("Ajuste (ingreso)");
  });

  it("⭑ 381: el cobro se deriva del diccionario del libro de la TIENDA, no del de la caja", () => {
    const cobro = conceptoPorId("cobro_tienda")!;
    // El MISMO objeto que rotula el ledger en `/mi-wallet` y en `/wallet/tiendas`: lo que el
    // diálogo promete es literalmente lo que la tienda va a leer en su wallet (R4/R33/R34).
    expect(nombreEnElLibro(cobro)).toBe(CATEGORIA_TIENDA_LABEL.cobro_manual);
    // Y el literal, porque la derivación sola sería una aserción contra su propia fuente.
    expect(nombreEnElLibro(cobro)).toBe("Cobro de Ordenex");
    // Ese nombre NO existe en el diccionario de la caja: buscarlo allí no devolvería nada, que
    // es exactamente el defecto que la mudanza de la categoría al destino hace imposible.
    expect(Object.values(CATEGORIA_LABEL)).not.toContain("Cobro de Ordenex");
  });

  it("⭑ 381: la frase del diálogo nombra el LIBRO, y la de la caja no cambió (R4/R11)", () => {
    // Byte a byte la de la ficha 334: los cuatro conceptos previos ven la misma línea de ayuda.
    expect(fraseDelLibro(conceptoPorId("gasto_variable")!)).toBe(
      "Se registra en el libro como «Gasto variable».",
    );
    expect(fraseDelLibro(conceptoPorId("ajuste_ingreso")!)).toBe(
      "Se registra en el libro como «Ajuste (ingreso)».",
    );
    // La del cobro dice de QUÉ libro habla: para ese concepto «el libro» a secas ya no
    // identifica ninguno, y prometer la caja sería prometer el libro equivocado.
    expect(fraseDelLibro(conceptoPorId("cobro_tienda")!)).toBe(
      "Se registra en el libro de la tienda como «Cobro de Ordenex».",
    );
  });
});

describe("⭑ FICHA 381 — la cabecera del diálogo, por libro (R4/R11)", () => {
  it("la de la caja se conserva byte a byte", () => {
    expect(CABECERA_POR_LIBRO.caja.titulo).toBe("Registrar movimiento en la caja");
    expect(CABECERA_POR_LIBRO.caja.descripcion).toBe(
      "Elegí el concepto, el monto y la fecha. El movimiento es inmutable una vez registrado.",
    );
  });

  it("la de la tienda no habla de la caja y avisa de que el cobro no se deshace (C1)", () => {
    expect(CABECERA_POR_LIBRO.tienda.titulo).toBe("Cobrar un costo a una tienda");
    expect(CABECERA_POR_LIBRO.tienda.titulo).not.toMatch(/caja/i);
    expect(CABECERA_POR_LIBRO.tienda.descripcion).not.toMatch(/caja/i);
    expect(CABECERA_POR_LIBRO.tienda.descripcion).toMatch(/no se puede editar ni deshacer/);
    // Y no promete ninguna comprobación de saldo, que es justo lo que el cobro NO hace (R27).
    expect(CABECERA_POR_LIBRO.tienda.descripcion).not.toMatch(/suficiente|insuficiente/i);
  });
});

// ─── FICHA 459 (T B.15, design §9) — dos conceptos nuevos, agrupados por lo que le pasa a la caja ───

describe("⭑ FICHA 459 — los tres grupos del selector (R59)", () => {
  it("cada opción lleva su grupo, y los grupos son tres tramos consecutivos con estos nombres", () => {
    // Literales: son los encabezados que ve la persona (design §9.1).
    expect(CONCEPTO_MANUAL_OPTIONS.map((o) => [o.value, o.group])).toEqual([
      ["gasto_variable", "Sale dinero de la caja"],
      ["sueldo", "Sale dinero de la caja"],
      ["pago_por_cuenta_tienda", "Sale dinero de la caja"],
      ["ajuste_egreso", "Sale dinero de la caja"],
      ["aporte_capital", "Entra dinero a la caja"],
      ["ajuste_ingreso", "Entra dinero a la caja"],
      ["cobro_tienda", "No mueve la caja"],
    ]);
    expect(Object.values(GRUPO_CONCEPTO_LABEL)).toEqual([
      "Sale dinero de la caja",
      "Entra dinero a la caja",
      "No mueve la caja",
    ]);
  });

  it("los dos conceptos nuevos se llaman como dice el diseño y van a su clase de destino", () => {
    expect(conceptoPorId("pago_por_cuenta_tienda")?.label).toBe("Pago por cuenta de una tienda");
    expect(conceptoPorId("pago_por_cuenta_tienda")?.destino).toEqual({
      clase: "pago_por_cuenta_tienda",
      categoria: "egreso_pago_por_cuenta_tienda",
      categoriaTienda: "pago_por_cuenta",
    });
    expect(conceptoPorId("aporte_capital")?.label).toBe("Saldo inicial o aporte de capital");
    expect(conceptoPorId("aporte_capital")?.destino).toEqual({
      clase: "aporte_capital",
      categoria: "ingreso_aporte_capital",
    });
  });

  it("ningún concepto abre a mano una categoría de la máquina (lista exacta de la caja, 459)", () => {
    const caja = CONCEPTOS_MANUALES.filter((c) => c.destino.clase !== "cobro_tienda").map(
      (c) => (c.destino as { categoria: WalletMovimientoCategoria }).categoria,
    );
    expect([...caja].sort()).toEqual(
      [...CATEGORIAS_CAJA_ESPERADAS, "egreso_pago_por_cuenta_tienda", "ingreso_aporte_capital"].sort(),
    );
    expect(caja).not.toContain("egreso_gasto_fijo");
    expect(caja).not.toContain("egreso_pago_tienda");
    expect(caja).not.toContain("ingreso_reverso_pago_por_cuenta_tienda");
    expect(caja).not.toContain("egreso_reverso_aporte_capital");
  });
});

describe("⭑ FICHA 459 — la frase del efecto (R60)", () => {
  it("cada concepto tiene su frase, con el texto literal del diseño", () => {
    expect(FRASE_DEL_EFECTO).toEqual({
      gasto_variable: "Sale dinero de la caja y baja la ganancia de Ordenex.",
      sueldo: "Sale dinero de la caja y baja la ganancia de Ordenex.",
      ajuste_egreso: "Sale dinero de la caja y baja la ganancia de Ordenex.",
      pago_por_cuenta_tienda:
        "Sale dinero de la caja: Ordenex le paga a otro en nombre de la tienda y se lo descuenta de su saldo. La ganancia de Ordenex no cambia.",
      aporte_capital: "Entra dinero de Ordenex a la caja. No es ganancia: la ganancia no cambia.",
      ajuste_ingreso: "Entra dinero a la caja y sube la ganancia de Ordenex.",
      cobro_tienda:
        "No sale ni entra dinero: es un cobro de Ordenex a la tienda que baja su saldo. La caja y la ganancia no cambian.",
    });
  });

  it("el pago por cuenta dice que SALE dinero de la caja y el cobro de un costo dice que NO", () => {
    // Es la confusión que la ficha existe para matar (HF1/HF6): los 203 cobros de Nuform eran
    // pagos por cuenta registrados como cobro porque no había otro tipo.
    expect(FRASE_DEL_EFECTO.pago_por_cuenta_tienda).toMatch(/^Sale dinero de la caja/);
    expect(FRASE_DEL_EFECTO.cobro_tienda).toMatch(/^No sale ni entra dinero/);
    expect(FRASE_DEL_EFECTO.cobro_tienda).toMatch(/La caja y la ganancia no cambian/);
    // Y los dos nombran a la tienda: los dos bajan su saldo.
    expect(FRASE_DEL_EFECTO.pago_por_cuenta_tienda).toMatch(/su saldo/);
    expect(FRASE_DEL_EFECTO.cobro_tienda).toMatch(/su saldo/);
  });

  it("el saldo inicial o aporte dice que no es ganancia", () => {
    expect(FRASE_DEL_EFECTO.aporte_capital).toMatch(/No es ganancia/);
  });
});

describe("⭑ FICHA 459 — en qué libro cae el pago por cuenta (design §9.1)", () => {
  it("la frase nombra los DOS libros con el nombre de cada diccionario", () => {
    expect(fraseDelLibro(conceptoPorId("pago_por_cuenta_tienda")!)).toBe(
      "Se registra en la caja como «Pago por cuenta de una tienda» y en el libro de la tienda como «Pago por cuenta de la tienda».",
    );
    expect(fraseDelLibro(conceptoPorId("aporte_capital")!)).toBe(
      "Se registra en el libro como «Saldo inicial o aporte de capital».",
    );
  });

  it("la cabecera del pago por cuenta lleva su título y dice que no se edita", () => {
    expect(CABECERA_POR_LIBRO.caja_y_tienda.titulo).toBe("Pago por cuenta de una tienda");
    expect(CABECERA_POR_LIBRO.caja_y_tienda.descripcion).toMatch(/no se puede editar/);
  });
});
