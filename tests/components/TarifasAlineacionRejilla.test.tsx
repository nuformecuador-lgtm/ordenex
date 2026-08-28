// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { CobroVehiculoTarifas } from "@/app/(app)/configuracion/tarifas/_components/CobroVehiculoTarifas";
import {
  TarifaCamposGrid,
  tarifaValoresVacios,
  type TarifaValores,
} from "@/app/(app)/configuracion/tarifas/_components/TarifaCampos";
import { FormField } from "@/components/shared/FormField";
import { Input } from "@/components/ui/input";

/**
 * Feature 310 — la rejilla de «Costos por zona» tiene que aguantar rótulos de dos renglones y
 * ayudas de altura distinta SIN descuadrarse.
 *
 * LO QUE PASÓ. La 303 alargó los rótulos y añadió el aviso del cero —los dos, correctos y
 * intocables: un cero indistinguible de un olvido costó 44 rechazos sin pagar—. Apilado con
 * `flex`, cada campo empieza donde acabó su etiqueta, así que en cuanto una etiqueta ocupó dos
 * renglones y el aviso apareció sólo en unos campos, los controles de una misma fila dejaron
 * de casar. El arreglo NO acorta textos: alinea los campos por fila (`FormField rowAligned`).
 *
 * HASTA DÓNDE LLEGA ESTE ARCHIVO, dicho sin adornos. jsdom NO maqueta: no hay anchos, ni
 * saltos de línea, ni coordenadas —`getBoundingClientRect()` devuelve ceros—, así que aquí es
 * IMPOSIBLE afirmar «los dos inputs están a la misma altura». Lo que sí se puede fijar es el
 * MECANISMO por el que lo están: los campos de una fila comparten las mismas franjas y cada
 * uno ancla su control a la MISMA, de modo que la altura de cada franja la fija el más alto de
 * la fila. Si eso se rompe —o se revierte—, estos tests se caen.
 *
 * LA ALTURA SÍ SE MIDIÓ, pero fuera de esta suite: en Chromium, con el CSS compilado del
 * proyecto y este mismo HTML, sobre una columna de 420 px de ancho (la del formulario de zona
 * en un portátil). Distancia vertical entre los dos `Input` de una misma fila, antes y después
 * del arreglo:
 *
 *   | fila                                                        | antes | después |
 *   |-------------------------------------------------------------|-------|---------|
 *   | «Fulfillment» / «Comisión por cobro contra entrega (%)» en 0 | 60 px | 0 px    |
 *   | «Valor flete GAM» / «Flete de retorno GAM…» en 0             | 60 px | 0 px    |
 *   | «IVA flete (%)» / «IVA de la comisión…» (rótulo de dos)      | 14 px | 0 px    |
 *   | «Entregado» / «Rechazado por el cliente» (ayudas desiguales)  | 40 px | 0 px    |
 *
 * De ahí salen los campos que se usan abajo, que no están elegidos al azar: en esa medición
 * «Comisión por cobro contra entrega (%)» ocupa dos renglones (28 px de rótulo) y
 * «Fulfillment» uno (14 px), y el aviso del cero cuelga sólo del primero.
 */

// `CobroVehiculoTarifas` avisa a su formulario en cada cambio; nada de esto se llama.
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/**
 * La FRANJA a la que un trozo del campo está anclado (`row-start-N`). Es el número de fila de
 * la rejilla compartida, y es lo único que decide a qué altura cae ese trozo.
 *
 * Falla —a propósito— si el trozo no está anclado a ninguna: sin ancla, cada campo vuelve a
 * empezar donde acabó su etiqueta y la fila se descuadra. Un `undefined === undefined` habría
 * dado verde justo en el caso que este archivo existe para impedir.
 */
function franja(el: Element): number {
  const clases = el.className;
  const m = /(?:^|\s)row-start-(\d+)(?:\s|$)/.exec(clases);
  expect(m, `no está anclado a ninguna franja: «${clases}»`).not.toBeNull();
  return Number(m![1]);
}

/** El envoltorio del control (la franja del control) y la celda del campo. */
function trozos(control: HTMLElement) {
  const envoltorioControl = control.parentElement!;
  const celda = envoltorioControl.parentElement!;
  return { envoltorioControl, celda, rejilla: celda.parentElement! };
}

/** La ayuda («Sin configurar…», «Se le paga al mensajero.») que cuelga del control, si la hay. */
function ayudaDe(control: HTMLElement): HTMLElement | null {
  const ids = control.getAttribute("aria-describedby");
  if (!ids) return null;
  return document.getElementById(`${control.id}-hint`);
}

/**
 * Los dos campos comparten fila: misma rejilla, mismas franjas y el control de cada uno
 * anclado a la misma. Eso es lo que hace que los dos `Input` caigan a la misma altura por
 * mucho que una etiqueta ocupe dos renglones y sólo uno de los dos tenga aviso.
 */
function esperarMismaFila(a: HTMLElement, b: HTMLElement) {
  const ta = trozos(a);
  const tb = trozos(b);

  expect(ta.rejilla).toBe(tb.rejilla);
  expect(ta.rejilla.className).toContain("grid");

  for (const celda of [ta.celda, tb.celda]) {
    // `subgrid`: las franjas no son de la celda, son de la FILA; la altura de cada una la fija
    // el trozo más alto de toda la fila.
    expect(celda.className).toContain("grid-rows-subgrid");
    expect(celda.className).toContain("row-span-4");
  }

  expect(franja(ta.envoltorioControl)).toBe(franja(tb.envoltorioControl));
}

describe("Rejilla de tarifas — el caso feo que reportó el humano", () => {
  /** La rejilla completa; `overrides` decide qué campos quedan en cero (y avisan). */
  function renderGrid(overrides: Partial<TarifaValores> = {}) {
    const valores: TarifaValores = { ...tarifaValoresVacios(), ...overrides };
    return render(
      <TarifaCamposGrid
        idPrefix="test"
        valores={valores}
        errors={{}}
        onChange={() => {}}
      />,
    );
  }

  const campo = (nombre: string) =>
    screen.getByRole("spinbutton", { name: nombre });

  it("un rótulo de dos renglones CON aviso, junto a uno de uno SIN aviso, casan", () => {
    // Quinta y sexta posición de la rejilla: comparten fila en dos columnas. «Fulfillment»
    // ocupa un renglón; «Comisión por cobro contra entrega (%)», dos. Y el cero deja el aviso
    // en uno solo. Es exactamente la fila de la captura.
    renderGrid({ fulfillment: "1500", comisionCod: "0" });

    const corto = campo("Fulfillment");
    const largo = campo("Comisión por cobro contra entrega (%)");

    // El caso ES el feo: sólo uno de los dos tiene ayuda debajo del rótulo.
    expect(ayudaDe(largo)).toHaveTextContent("Sin configurar");
    expect(ayudaDe(corto)).toBeNull();

    esperarMismaFila(corto, largo);
  });

  it("el aviso no empuja hacia abajo el control de SU campo: vive en su propia franja", () => {
    renderGrid({ comisionCod: "0" });

    const largo = campo("Comisión por cobro contra entrega (%)");
    const aviso = ayudaDe(largo)!;
    const { envoltorioControl, celda } = trozos(largo);
    const etiqueta = celda.querySelector("label")!;

    // Etiqueta, aviso y control ocupan franjas distintas y en ese orden. La del aviso existe
    // en TODA la fila: en el vecino sin aviso queda vacía, y por eso su control no sube.
    expect(franja(etiqueta)).toBeLessThan(franja(aviso));
    expect(franja(aviso)).toBeLessThan(franja(envoltorioControl));
  });

  it("el error de validación tampoco descuadra la fila: tiene su propia franja", () => {
    render(
      <TarifaCamposGrid
        idPrefix="test"
        valores={tarifaValoresVacios()}
        errors={{ comisionCod: ["Este campo es obligatorio."] }}
        onChange={() => {}}
      />,
    );

    const conError = campo("Comisión por cobro contra entrega (%)");
    const sinError = campo("Fulfillment");
    esperarMismaFila(sinError, conError);

    const alerta = screen.getByRole("alert");
    expect(franja(alerta.parentElement!)).toBeGreaterThan(
      franja(trozos(conError).envoltorioControl),
    );
  });
});

describe("Los dos montos del pago — ayudas de uno y de dos renglones", () => {
  it("casan aunque una ayuda ocupe el doble que la otra y sólo una avise", () => {
    // «Se le paga al mensajero.» ocupa un renglón y «Es ingreso de la bodega, no del
    // mensajero.» dos; encima, sólo el rechazo está en cero y arrastra el aviso.
    render(
      <CobroVehiculoTarifas
        vehiculos={[{ id: "v-moto", name: "Moto" }]}
        initial={{
          cobroVehiculo: false,
          tarifas: [{ cobroEntregado: 1700, cobroRechazado: 0 }],
        }}
      />,
    );

    const entregado = screen.getByLabelText("Entregado");
    const rechazado = screen.getByLabelText("Rechazado por el cliente");

    expect(ayudaDe(rechazado)).toHaveTextContent("Sin configurar");
    expect(ayudaDe(entregado)).not.toHaveTextContent("Sin configurar");

    esperarMismaFila(entregado, rechazado);
  });
});

describe("FormField — la alineación es opt-in y no toca al resto de formularios", () => {
  it("sin `rowAligned` el campo sigue apilado, sin envoltorios ni franjas", () => {
    render(
      <FormField id="suelto" label="Nombre" hint="Como aparece en la factura">
        <Input defaultValue="" />
      </FormField>,
    );

    const input = screen.getByLabelText("Nombre");
    const contenedor = input.parentElement!;
    // El control cuelga DIRECTAMENTE del campo: nada se ha interpuesto en los formularios
    // que no piden alineación.
    expect(contenedor.className).toContain("flex flex-col");
    expect(contenedor.className).not.toContain("subgrid");
    expect(contenedor.querySelector("label")!.className).not.toMatch(/row-start-/);
  });

  it("con `rowAligned` cada trozo va a una franja distinta, y en orden", () => {
    render(
      <FormField
        id="alineado"
        label="Nombre"
        hint="Como aparece en la factura"
        error="Este campo es obligatorio."
        rowAligned
      >
        <Input defaultValue="" />
      </FormField>,
    );

    const input = screen.getByLabelText("Nombre");
    const { envoltorioControl, celda } = trozos(input);
    const etiqueta = celda.querySelector("label")!;
    const ayuda = document.getElementById("alineado-hint")!;
    const alerta = screen.getByRole("alert").parentElement!;

    expect(celda.className).toContain("grid-rows-subgrid");
    expect([
      franja(etiqueta),
      franja(ayuda),
      franja(envoltorioControl),
      franja(alerta),
    ]).toEqual([1, 2, 3, 4]);
    // Las cuatro franjas son las que la celda declara ocupar: ni sobra ni falta ninguna.
    expect(celda.className).toContain("row-span-4");
  });
});
