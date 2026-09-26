import { describe, it, expect } from "vitest";

import {
  CABECERA_CAJA,
  CONCEPTOS_MANUALES,
  CONCEPTO_MANUAL_IDS,
  CONCEPTO_MANUAL_OPTIONS,
  FRASE_DEL_EFECTO,
  GRUPO_CONCEPTO_LABEL,
  cabeceraDelConcepto,
  conceptoPorId,
  fraseDelLibro,
  libroDelConcepto,
  nombreEnElLibro,
  nombreEnElLibroDeLaTienda,
  type ConceptoManual,
} from "@/app/(app)/wallet/_components/wallet-conceptos-manuales";
import { CATEGORIA_LABEL } from "@/app/(app)/wallet/_components/wallet-labels";
import { CATEGORIA_TIENDA_LABEL } from "@/app/(app)/wallet/tiendas/_components/desglose-tienda-labels";
import { CATEGORIA_MI_WALLET_LABEL } from "@/app/(app)/mi-wallet/_components/mi-wallet-labels";
import {
  WALLET_MOVIMIENTO_CATEGORIA_SEED,
  type WalletMovimientoCategoria,
} from "@/lib/types/wallet";

// Ficha 334 (T D2, design §9) — el catálogo de conceptos registrables A MANO es la única
// fuente del selector unificado, así que es el sitio donde se puede AFIRMAR la regla que la
// fusión no puede perder: el gasto FIJO no se registra a mano (R11, heredada del R19 de la 45).
//
// ⭑ FICHA 381 (T H.1) — entró el quinto concepto, el cobro a una tienda. ⭑ FICHA 459 (T B.15) —
// siete conceptos en tres grupos. ⭑ FICHA 461 (T C.4, design §7.1/§7.6, HD1/HD3) — REESCRITO
// (listado en `progress/impl_461_frontend.md`): los siete nombres se dicen desde Ordenex y
// diciendo quién le paga a quién (R39), los tres grupos se llaman por lo que le pasa al dinero
// (R40), cada concepto lleva su frase de efecto de UNA línea (R41), y el cobro DEJA de ser el que
// «no mueve la caja»: escribe su cargo en la caja y cae en los DOS libros, como el pago de un gasto
// (R46). Los literales van escritos a mano: derivarlos de la fuente estaría siempre verde.

const CATEGORIAS_CAJA_ESPERADAS = [
  "egreso_gasto_variable",
  "egreso_sueldo",
  "ingreso_ajuste",
  "egreso_ajuste",
] as const;

/** Los cuatro conceptos de la ficha 334 (gastos administrativos y correcciones). */
function conceptosDeCaja(): ConceptoManual[] {
  return CONCEPTOS_MANUALES.filter(
    (c) => c.destino.clase === "egreso_administrativo" || c.destino.clase === "ajuste_manual",
  );
}

/** La categoría de caja de un concepto. Desde la 461 TODOS tienen una (el cobro, su cargo). */
function categoriaDeCaja(concepto: ConceptoManual): WalletMovimientoCategoria {
  return concepto.destino.categoria;
}

describe("catálogo de conceptos manuales — son exactamente SIETE (R3 / 381-R1 / 459-R59 / 461-R39)", () => {
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

  it("⭑ 461 R39: los siete se llaman EXACTAMENTE así, desde Ordenex y diciendo quién le paga a quién", () => {
    expect(CONCEPTOS_MANUALES.map((c) => c.label)).toEqual([
      "Gasto de Ordenex",
      "Sueldo",
      "Ordenex paga un gasto de una tienda",
      "Corrección de caja (resta)",
      "Aporte de dinero a la caja",
      "Corrección de caja (suma)",
      "Ordenex le cobra a una tienda",
    ]);
  });

  it("el gasto de Ordenex sigue siendo el primero y los cuatro de la 334 conservan su orden relativo (R11)", () => {
    // Quien abría el diálogo y pulsaba «Registrar» sin tocar el selector registraba un gasto
    // variable, y sigue haciéndolo (con su nombre nuevo).
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
  it("el conjunto de categorías de CAJA de los cuatro de la 334 es EXACTAMENTE las cuatro admitidas", () => {
    const destino = conceptosDeCaja().map(categoriaDeCaja).sort();
    expect(destino).toEqual([...CATEGORIAS_CAJA_ESPERADAS].sort());
    // Anti-vacuidad: si el filtro se quedara sin conceptos, la igualdad de arriba sería trivial.
    expect(conceptosDeCaja()).toHaveLength(4);
  });

  it("ninguno mapea a `egreso_gasto_fijo` ni a ninguna otra categoría de la máquina", () => {
    const destino = new Set<string>(conceptosDeCaja().map(categoriaDeCaja));
    expect(destino.has("egreso_gasto_fijo")).toBe(false);

    // Y no solo el gasto fijo: se barre el SEED ENTERO, así que un concepto nuevo que abriera
    // `egreso_pago_tienda` o `ingreso_flete` a mano —escrituras que hoy son automáticas— cae aquí
    // igual que caería el gasto fijo.
    const prohibidas = WALLET_MOVIMIENTO_CATEGORIA_SEED.filter(
      (c) => !CATEGORIAS_CAJA_ESPERADAS.includes(c as (typeof CATEGORIAS_CAJA_ESPERADAS)[number]),
    );
    expect(prohibidas.length, "el SEED se quedó sin categorías: no se estaría midiendo nada").
      toBeGreaterThan(4);
    for (const categoria of prohibidas) {
      expect(destino.has(categoria), `el concepto abre \`${categoria}\` a mano`).toBe(false);
    }
  });

  it("las dos correcciones van por `manual` y los dos gastos por `gasto` (design §6)", () => {
    // De este campo cuelga qué es reversable (`esEgresoAdministrativo`): el enrutado no puede
    // colapsar en una sola action sin cambiar, en silencio, qué movimientos se pueden deshacer.
    // Literales y ES el contrato: son el payload exacto que cada concepto le manda a su action.
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

describe("⭑ FICHA 381/461 — el cobro de Ordenex a una tienda cae en los DOS libros (R1 / 461-HD1/R46)", () => {
  it("existe, se llama «Ordenex le cobra a una tienda» y declara su cargo en la caja y su débito en la tienda", () => {
    const cobro = conceptoPorId("cobro_tienda");
    expect(cobro).toBeDefined();
    // Literal, y es el contrato: es el texto del selector, lo que el humano ve para decidir (HD3).
    expect(cobro?.label).toBe("Ordenex le cobra a una tienda");
    expect(cobro?.destino).toEqual({
      clase: "cobro_tienda",
      categoria: "ingreso_cobro_tienda",
      categoriaTienda: "cobro_manual",
    });
    expect(libroDelConcepto(cobro!)).toBe("caja_y_tienda");
  });

  it("dos conceptos van a los DOS libros (el pago de un gasto y el cobro); los otros cinco, a la caja", () => {
    // Sin la segunda mitad, un `libroDelConcepto` que devolviera siempre lo mismo pasaría.
    const porLibro = CONCEPTOS_MANUALES.map((c) => [c.id, libroDelConcepto(c)]);
    expect(porLibro).toEqual([
      ["gasto_variable", "caja"],
      ["sueldo", "caja"],
      ["pago_por_cuenta_tienda", "caja_y_tienda"],
      ["ajuste_egreso", "caja"],
      ["aporte_capital", "caja"],
      ["ajuste_ingreso", "caja"],
      ["cobro_tienda", "caja_y_tienda"],
    ]);
  });

  it("trae su propia etiqueta de descripción, distinta de la de las correcciones de caja", () => {
    const cobro = conceptoPorId("cobro_tienda")!;
    expect(cobro.descripcionLabel).toBe("Motivo del cobro");
    expect(cobro.descripcionLabel).not.toBe(conceptoPorId("ajuste_egreso")?.descripcionLabel);
    expect(cobro.descripcionPlaceholder.trim().length).toBeGreaterThan(0);
  });

  it("las categorías de caja que los siete conceptos abren son exactamente siete: las de la 334, el pago de un gasto, el aporte y el cargo del cobro", () => {
    const caja = CONCEPTOS_MANUALES.map(categoriaDeCaja);
    expect([...caja].sort()).toEqual(
      [
        ...CATEGORIAS_CAJA_ESPERADAS,
        "egreso_pago_por_cuenta_tienda",
        "ingreso_aporte_capital",
        "ingreso_cobro_tienda",
      ].sort(),
    );
    // Y ninguna de las que solo escribe la máquina o un contra-asiento.
    expect(caja).not.toContain("egreso_gasto_fijo");
    expect(caja).not.toContain("egreso_pago_tienda");
    expect(caja).not.toContain("ingreso_reverso_pago_por_cuenta_tienda");
    expect(caja).not.toContain("egreso_reverso_aporte_capital");
    expect(caja).not.toContain("egreso_reverso_cobro_tienda");
  });
});

describe("catálogo de conceptos manuales — cada concepto trae su etiqueta de descripción (R9)", () => {
  it("los siete tienen etiqueta, etiqueta de descripción y ejemplo no vacíos", () => {
    for (const concepto of CONCEPTOS_MANUALES) {
      expect(concepto.label.trim().length, concepto.id).toBeGreaterThan(0);
      expect(concepto.descripcionLabel.trim().length, concepto.id).toBeGreaterThan(0);
      expect(concepto.descripcionPlaceholder.trim().length, concepto.id).toBeGreaterThan(0);
    }
  });

  it("las DOS etiquetas de la ficha 45 se conservan byte a byte; las correcciones piden su motivo", () => {
    expect(conceptoPorId("gasto_variable")?.descripcionLabel).toBe("Concepto del gasto");
    expect(conceptoPorId("sueldo")?.descripcionLabel).toBe("Trabajador y periodo");
    // Las dos correcciones comparten la suya: lo que se pide es el motivo (461: «corrección»).
    expect(conceptoPorId("ajuste_ingreso")?.descripcionLabel).toBe("Motivo de la corrección");
    expect(conceptoPorId("ajuste_egreso")?.descripcionLabel).toBe("Motivo de la corrección");
  });
});

describe("catálogo de conceptos manuales — el nombre del libro se DERIVA (R4 / 461-R46)", () => {
  it("cada concepto dice el nombre con que su categoría sale en el libro de la caja", () => {
    for (const concepto of CONCEPTOS_MANUALES) {
      expect(nombreEnElLibro(concepto)).toBe(CATEGORIA_LABEL[categoriaDeCaja(concepto)]);
      expect(nombreEnElLibro(concepto).trim().length, concepto.id).toBeGreaterThan(0);
    }
    // Control de no-vacuidad: la derivación entrega los nombres REALES del libro, escritos a mano.
    expect(nombreEnElLibro(CONCEPTOS_MANUALES[0])).toBe("Gasto de Ordenex");
    expect(nombreEnElLibro(conceptoPorId("ajuste_ingreso")!)).toBe("Corrección de caja (suma)");
    expect(nombreEnElLibro(conceptoPorId("cobro_tienda")!)).toBe("Ordenex le cobra a una tienda");
  });

  it("⭑ 461: el nombre en el libro de la TIENDA sale del diccionario DESDE ORDENEX de /wallet/tiendas, no del de /mi-wallet", () => {
    const cobro = conceptoPorId("cobro_tienda")!;
    const pago = conceptoPorId("pago_por_cuenta_tienda")!;
    // El MISMO objeto que rotula el desglose en `/wallet/tiendas`: lo que el diálogo promete es
    // literalmente lo que la oficina va a leer allí (R46).
    expect(nombreEnElLibroDeLaTienda(cobro)).toBe(CATEGORIA_TIENDA_LABEL.cobro_manual);
    expect(nombreEnElLibroDeLaTienda(pago)).toBe(CATEGORIA_TIENDA_LABEL.pago_por_cuenta);
    // Y los literales, porque la derivación sola sería una aserción contra su propia fuente.
    expect(nombreEnElLibroDeLaTienda(cobro)).toBe("Ordenex le cobra a la tienda");
    expect(nombreEnElLibroDeLaTienda(pago)).toBe("Ordenex paga un gasto de la tienda");
    // NO la lectura desde la tienda (P4): el diálogo lo lee la oficina.
    expect(nombreEnElLibroDeLaTienda(cobro)).not.toBe(CATEGORIA_MI_WALLET_LABEL.cobro_manual);
    // Los que no escriben en la tienda no prometen nada allí.
    for (const id of ["gasto_variable", "sueldo", "ajuste_egreso", "aporte_capital", "ajuste_ingreso"]) {
      expect(nombreEnElLibroDeLaTienda(conceptoPorId(id)!), id).toBe("");
    }
  });

  it("⭑ 381/461: la frase del diálogo nombra los libros, y la forma de la caja no cambió (R4/R11)", () => {
    // La FORMA de la ficha 334 («Se registra en el libro como «…».»), con el nombre nuevo dentro.
    expect(fraseDelLibro(conceptoPorId("gasto_variable")!)).toBe(
      "Se registra en el libro como «Gasto de Ordenex».",
    );
    expect(fraseDelLibro(conceptoPorId("ajuste_ingreso")!)).toBe(
      "Se registra en el libro como «Corrección de caja (suma)».",
    );
    expect(fraseDelLibro(conceptoPorId("aporte_capital")!)).toBe(
      "Se registra en el libro como «Aporte de dinero a la caja».",
    );
    // Los dos que escriben en los DOS libros nombran los dos, cada uno con el nombre de su diccionario.
    expect(fraseDelLibro(conceptoPorId("cobro_tienda")!)).toBe(
      "Se registra en la caja como «Ordenex le cobra a una tienda» y en el libro de la tienda como «Ordenex le cobra a la tienda».",
    );
    expect(fraseDelLibro(conceptoPorId("pago_por_cuenta_tienda")!)).toBe(
      "Se registra en la caja como «Ordenex paga un gasto de una tienda» y en el libro de la tienda como «Ordenex paga un gasto de la tienda».",
    );
  });
});

describe("⭑ FICHA 381/459/461 — la cabecera del diálogo, por concepto (R4/R11 / 461-R46)", () => {
  it("la de la caja se conserva byte a byte para los cinco conceptos que escriben solo ahí", () => {
    expect(CABECERA_CAJA.titulo).toBe("Registrar movimiento en la caja");
    expect(CABECERA_CAJA.descripcion).toBe(
      "Elegí el concepto, el monto y la fecha. El movimiento es inmutable una vez registrado.",
    );
    for (const id of ["gasto_variable", "sueldo", "ajuste_egreso", "aporte_capital", "ajuste_ingreso"]) {
      expect(cabeceraDelConcepto(conceptoPorId(id)!), id).toBe(CABECERA_CAJA);
    }
  });

  it("la del cobro lleva el nombre del concepto y dice que se anula desde la caja, no que no se deshace", () => {
    const cabecera = cabeceraDelConcepto(conceptoPorId("cobro_tienda")!);
    expect(cabecera.titulo).toBe("Ordenex le cobra a una tienda");
    expect(cabecera.descripcion).toBe(
      "Elegí la tienda, el monto y la fecha. El cobro se descuenta de lo que Ordenex le debe a esa tienda y no se edita: si hay un error, se anula desde el libro de la caja con un motivo.",
    );
    // La consecuencia C1 de la 381 («no se puede editar ni deshacer») queda superada por HD1.
    expect(cabecera.descripcion).not.toMatch(/ni deshacer|inmutable/);
    // Y no promete ninguna comprobación de saldo, que es justo lo que el cobro NO hace (R5).
    expect(cabecera.descripcion).not.toMatch(/suficiente|insuficiente/i);
  });

  it("la del pago de un gasto lleva su título y dice que no se edita", () => {
    const cabecera = cabeceraDelConcepto(conceptoPorId("pago_por_cuenta_tienda")!);
    expect(cabecera.titulo).toBe("Ordenex paga un gasto de una tienda");
    expect(cabecera.descripcion).toMatch(/no se puede editar/);
    expect(cabecera.descripcion).toMatch(/se anula desde el libro de la caja con un motivo/);
  });
});

// ─── FICHA 459/461 — los tres grupos y la frase del efecto ───

describe("⭑ FICHA 459/461 — los tres grupos del selector (R59 / 461-R40)", () => {
  it("cada opción lleva su grupo, y los grupos son tres tramos consecutivos con estos nombres", () => {
    // Literales: son los encabezados que ve la persona (design §7.1).
    expect(CONCEPTO_MANUAL_OPTIONS.map((o) => [o.value, o.group])).toEqual([
      ["gasto_variable", "Sale dinero de Ordenex"],
      ["sueldo", "Sale dinero de Ordenex"],
      ["pago_por_cuenta_tienda", "Sale dinero de Ordenex"],
      ["ajuste_egreso", "Sale dinero de Ordenex"],
      ["aporte_capital", "Llega dinero a la caja"],
      ["ajuste_ingreso", "Llega dinero a la caja"],
      ["cobro_tienda", "Se descuenta del saldo de una tienda"],
    ]);
    expect(GRUPO_CONCEPTO_LABEL).toEqual({
      sale: "Sale dinero de Ordenex",
      entra: "Llega dinero a la caja",
      descuenta: "Se descuenta del saldo de una tienda",
    });
    // El grupo del cobro ya no dice que «no mueve la caja»: la mueve (HD1).
    for (const texto of Object.values(GRUPO_CONCEPTO_LABEL)) expect(texto).not.toMatch(/no mueve/i);
  });

  it("los dos conceptos de la 459 se llaman como dice la 461 y van a su clase de destino", () => {
    expect(conceptoPorId("pago_por_cuenta_tienda")?.label).toBe("Ordenex paga un gasto de una tienda");
    expect(conceptoPorId("pago_por_cuenta_tienda")?.destino).toEqual({
      clase: "pago_por_cuenta_tienda",
      categoria: "egreso_pago_por_cuenta_tienda",
      categoriaTienda: "pago_por_cuenta",
    });
    expect(conceptoPorId("aporte_capital")?.label).toBe("Aporte de dinero a la caja");
    expect(conceptoPorId("aporte_capital")?.destino).toEqual({
      clase: "aporte_capital",
      categoria: "ingreso_aporte_capital",
    });
  });
});

describe("⭑ FICHA 459/461 — la frase del efecto, una línea por concepto (R60 / 461-R41)", () => {
  it("cada concepto tiene su frase, con el texto literal del diseño (design §7.6)", () => {
    expect(FRASE_DEL_EFECTO).toEqual({
      gasto_variable: "Sale dinero de Ordenex y baja su ganancia.",
      sueldo: "Sale dinero de Ordenex para pagar un sueldo y baja su ganancia.",
      pago_por_cuenta_tienda:
        "Sale dinero de Ordenex hacia un tercero (Facebook, Jet Cargo…) y se descuenta del saldo de la tienda; la ganancia no cambia.",
      ajuste_egreso: "Sale dinero de la caja para corregir un descuadre y baja la ganancia de Ordenex.",
      aporte_capital: "Llega dinero de Ordenex a la caja; no es ganancia, la ganancia no cambia.",
      ajuste_ingreso: "Llega dinero a la caja para corregir un descuadre y sube la ganancia de Ordenex.",
      cobro_tienda:
        "No llega dinero nuevo: se descuenta del saldo a favor de la tienda y pasa a ser ganancia de Ordenex; si la tienda no tiene saldo, queda en contra.",
    });
  });

  it("son de UNA línea: sin saltos y sin dos oraciones separadas por punto y espacio", () => {
    for (const [id, frase] of Object.entries(FRASE_DEL_EFECTO)) {
      expect(frase, id).not.toMatch(/\n/);
      expect(frase, id).toMatch(/\.$/);
      expect(frase.slice(0, -1), id).not.toMatch(/\. /);
    }
  });

  it("⭑ 461 R41: la del cobro dice que NO llega dinero nuevo, que se toma del saldo a favor y que es ganancia", () => {
    // Es lo que la ficha existe para arreglar (HD1): la frase de la 459 decía que la caja y la
    // ganancia no cambiaban, y eso es lo que se retira (mutación 13; la guardia de nombres también
    // la caza).
    expect(FRASE_DEL_EFECTO.cobro_tienda).toMatch(/^No llega dinero nuevo/);
    expect(FRASE_DEL_EFECTO.cobro_tienda).toMatch(/saldo a favor de la tienda/);
    expect(FRASE_DEL_EFECTO.cobro_tienda).toMatch(/ganancia de Ordenex/);
    expect(FRASE_DEL_EFECTO.cobro_tienda).not.toMatch(/La caja y la ganancia no cambian/);
    // El pago de un gasto sigue diciendo que SALE dinero hacia un tercero y que la ganancia no cambia.
    expect(FRASE_DEL_EFECTO.pago_por_cuenta_tienda).toMatch(/^Sale dinero de Ordenex hacia un tercero/);
    expect(FRASE_DEL_EFECTO.pago_por_cuenta_tienda).toMatch(/la ganancia no cambia/);
    // Y los dos nombran el saldo de la tienda: los dos lo bajan.
    expect(FRASE_DEL_EFECTO.pago_por_cuenta_tienda).toMatch(/saldo de la tienda/);
  });

  it("el aporte dice que no es ganancia; las correcciones dicen que corrigen un descuadre", () => {
    expect(FRASE_DEL_EFECTO.aporte_capital).toMatch(/no es ganancia/);
    expect(FRASE_DEL_EFECTO.ajuste_ingreso).toMatch(/corregir un descuadre/);
    expect(FRASE_DEL_EFECTO.ajuste_egreso).toMatch(/corregir un descuadre/);
  });
});
