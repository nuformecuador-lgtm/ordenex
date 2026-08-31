// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  MiWalletFiltros,
  type MiWalletFiltrosValue,
} from "@/app/(app)/mi-wallet/_components/MiWalletFiltros";
import type { CierresDeLaTienda } from "@/app/(app)/mi-wallet/_components/mi-wallet-cierres";

/**
 * FICHA 335 (C3, R20/R22/R25/R26/R27) — el filtro de cierre deja de pedir un UUID.
 *
 * Lo que había antes: un `<input type="text" placeholder="ID del cierre">`. El campo existía,
 * se veía y aceptaba texto, pero NADIE conoce ese identificador —no se enseña en ninguna
 * pantalla—, así que en la práctica el filtro no se podía usar. Es un fallo mudo de manual: no
 * rompía ningún test porque el componente hacía exactamente lo que decía hacer.
 *
 * Por eso el caso central de este archivo es negativo (no queda ningún campo que pida un
 * identificador) y va acompañado del positivo (el selector emite el `cierreId` correcto).
 */

const CIERRES: CierresDeLaTienda = {
  opciones: [
    { cierreId: "c-1", fecha: "2026-08-01T09:15:00.000Z", movimientos: 7 },
    { cierreId: "c-2", fecha: "2026-07-12T14:30:00.000Z", movimientos: 4 },
  ],
  hayMas: false,
  disponible: true,
};

const onAplicar = vi.fn<(v: MiWalletFiltrosValue) => void>();
const onLimpiar = vi.fn();

function montar(cierres: CierresDeLaTienda = CIERRES) {
  return render(
    <MiWalletFiltros onAplicar={onAplicar} onLimpiar={onLimpiar} cierres={cierres} />,
  );
}

/** Abre el selector de cierre y elige la opción cuyo rótulo se pide. */
async function elegirCierre(user: ReturnType<typeof userEvent.setup>, rotulo: string) {
  await user.click(screen.getByRole("combobox", { name: "Filtrar por cierre" }));
  const lista = await screen.findByRole("listbox");
  await user.click(within(lista).getByRole("option", { name: rotulo }));
}

/** El último valor emitido por «Aplicar». */
function ultimoAplicado(): MiWalletFiltrosValue {
  expect(onAplicar).toHaveBeenCalled();
  return onAplicar.mock.calls[onAplicar.mock.calls.length - 1][0];
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("MiWalletFiltros — el cierre se ELIGE, no se escribe (R22) [335]", () => {
  it("R22: el filtro de cierre es un `combobox` y ningún campo de la pantalla pide un identificador", () => {
    montar();

    expect(screen.getByRole("combobox", { name: "Filtrar por cierre" })).toBeInTheDocument();

    // Lo que se fue, dicho por su nombre: el placeholder que pedía el uuid.
    expect(screen.queryByPlaceholderText("ID del cierre")).not.toBeInTheDocument();

    // Y en general: ningún campo de texto libre. Los dos `input` que quedan son fechas, que el
    // navegador pinta con su propio selector de calendario.
    //
    // Se descartan los `aria-hidden`: Base UI planta un input oculto por cada `Select` para que
    // el control participe del envío nativo del formulario. No los ve ni se pueden escribir;
    // contarlos aquí haría que este caso midiera la primitiva en vez de la pantalla.
    const visibles = Array.from(document.querySelectorAll("input")).filter(
      (i) => i.getAttribute("aria-hidden") !== "true",
    );
    expect(visibles.filter((i) => i.type === "text" || i.type === "search")).toEqual([]);
    expect(visibles.map((i) => i.type)).toEqual(["date", "date"]);
  });

  it("R22: el rótulo del selector cuelga de un `id` REAL, no de la nada", () => {
    montar();
    const rotulo = document.querySelector<HTMLLabelElement>(
      'label[for="mi-wallet-filtro-cierre"]',
    );
    expect(rotulo).not.toBeNull();
    // El defecto que `/wallet` documentó haber arreglado: `htmlFor` apuntando a un id que no
    // existía en el documento, así que la etiqueta colgaba de la nada.
    expect(document.getElementById("mi-wallet-filtro-cierre")).not.toBeNull();
    expect(rotulo!.textContent).toBe("Cierre");
  });
});

describe("MiWalletFiltros — «todos los cierres» es el estado de partida (R25) [335]", () => {
  it("R25: la primera opción es «Todos los cierres» y emite cadena vacía", async () => {
    const user = userEvent.setup();
    montar();

    // De partida no hay selección: el control muestra el placeholder, que dice lo mismo.
    const selector = screen.getByRole("combobox", { name: "Filtrar por cierre" });
    expect(selector).toHaveTextContent("Todos los cierres");

    await user.click(selector);
    const lista = await screen.findByRole("listbox");
    const opciones = within(lista).getAllByRole("option");
    expect(opciones[0]).toHaveTextContent("Todos los cierres");
    expect(opciones.map((o) => o.textContent)).toEqual([
      "Todos los cierres",
      "Cierre del 2026-08-01 · 7 movimientos",
      "Cierre del 2026-07-12 · 4 movimientos",
    ]);

    await user.click(opciones[0]);
    await user.click(screen.getByRole("button", { name: "Aplicar" }));

    // Cadena vacía = no filtrar por cierre. `buildInput` omite las claves vacías, así que el
    // input de la action no lleva `cierreId` en absoluto.
    expect(ultimoAplicado().cierreId).toBe("");
  });

  it("R25: sin tocar el selector, «Aplicar» tampoco filtra por cierre", async () => {
    const user = userEvent.setup();
    montar();
    await user.click(screen.getByRole("button", { name: "Aplicar" }));
    expect(ultimoAplicado()).toEqual({ cierreId: "", categoria: "", desde: "", hasta: "" });
  });
});

describe("MiWalletFiltros — elegir un cierre lo aplica (R26) y «Limpiar» lo deshace (R27) [335]", () => {
  it("R26: al elegir un cierre y aplicar, se emite su `cierreId`", async () => {
    const user = userEvent.setup();
    montar();

    await elegirCierre(user, "Cierre del 2026-07-12 · 4 movimientos");
    await user.click(screen.getByRole("button", { name: "Aplicar" }));

    // El IDENTIFICADOR, no la etiqueta: es lo que el filtro del backend espera como `cierreId`,
    // y es justo la confusión que un selector mal cableado produciría en silencio.
    expect(ultimoAplicado().cierreId).toBe("c-2");
    expect(ultimoAplicado().cierreId).not.toContain("Cierre del");
  });

  it("R26: cada opción emite SU identificador, no siempre el primero", async () => {
    const user = userEvent.setup();
    montar();

    await elegirCierre(user, "Cierre del 2026-08-01 · 7 movimientos");
    await user.click(screen.getByRole("button", { name: "Aplicar" }));
    expect(ultimoAplicado().cierreId).toBe("c-1");
  });

  it("R27: «Limpiar» devuelve el selector a «Todos los cierres»", async () => {
    const user = userEvent.setup();
    montar();

    await elegirCierre(user, "Cierre del 2026-07-12 · 4 movimientos");
    const selector = screen.getByRole("combobox", { name: "Filtrar por cierre" });
    expect(selector).toHaveTextContent("Cierre del 2026-07-12 · 4 movimientos");

    await user.click(screen.getByRole("button", { name: "Limpiar" }));

    // Lo que se ve vuelve al estado de partida, Y el módulo recibe la orden de recargar sin
    // filtro. Las dos mitades: un reset visual que no avisara dejaría la tabla filtrada bajo un
    // control que dice «todos».
    expect(selector).toHaveTextContent("Todos los cierres");
    expect(onLimpiar).toHaveBeenCalledTimes(1);
  });
});

describe("MiWalletFiltros — el selector degrada sin mentir (R28/R29/R30) [335]", () => {
  it("R28: sin cierres queda deshabilitado y dice que todavía no hay", () => {
    montar({ opciones: [], hayMas: false, disponible: true });

    expect(screen.getByRole("combobox", { name: "Filtrar por cierre" })).toBeDisabled();
    expect(screen.getByText("Todavía no hay cierres en tu wallet.")).toBeInTheDocument();
  });

  it("R29: si la lectura no respondió, queda deshabilitado y dice qué hacer", () => {
    montar({ opciones: [], hayMas: false, disponible: false });

    expect(screen.getByRole("combobox", { name: "Filtrar por cierre" })).toBeDisabled();
    expect(
      screen.getByText("No pudimos cargar tus cierres. Probá recargando la página."),
    ).toBeInTheDocument();
  });

  it("R30: con más cierres de los que caben, avisa de que solo ofrece los recientes", () => {
    montar({ ...CIERRES, hayMas: true });

    const aviso = screen.getByText("Mostramos los cierres más recientes.");
    expect(aviso).toBeInTheDocument();
    // Sin `role="note"`: la pantalla tiene EXACTAMENTE uno y se la busca en singular.
    expect(aviso.getAttribute("role")).toBeNull();
    expect(screen.queryAllByRole("note")).toEqual([]);
    // Y con cierres que ofrecer el control sigue usable: el tope no lo apaga.
    expect(screen.getByRole("combobox", { name: "Filtrar por cierre" })).not.toBeDisabled();
  });

  it("CONTRAPRUEBA: con cierres y sin tope, no hay ningún texto de aviso", () => {
    montar();
    for (const texto of [
      "Todavía no hay cierres en tu wallet.",
      "No pudimos cargar tus cierres. Probá recargando la página.",
      "Mostramos los cierres más recientes.",
    ]) {
      expect(screen.queryByText(texto)).not.toBeInTheDocument();
    }
  });
});

describe("MiWalletFiltros — voseo y lenguaje claro (R20) [335]", () => {
  it("R20: los textos del selector están en voseo y sin jerga", () => {
    // Los tres estados a la vez, para barrer todo lo que este componente puede llegar a decir.
    const textos: string[] = [];
    for (const cierres of [
      CIERRES,
      { ...CIERRES, hayMas: true },
      { opciones: [], hayMas: false, disponible: true },
      { opciones: [], hayMas: false, disponible: false },
    ] satisfies CierresDeLaTienda[]) {
      const { container } = montar(cierres);
      textos.push(container.textContent ?? "");
      cleanup();
    }

    expect(textos.join(" ").length).toBeGreaterThan(0); // control de no-vacuidad

    for (const texto of textos) {
      for (const prohibido of [
        "SLA",
        "acuerdo a nivel de servicio",
        "UUID",
        "cierre_dia",
        "origen_id",
        "débito",
        "crédito",
      ]) {
        expect(texto.toLowerCase(), `dice «${prohibido}»`).not.toContain(
          prohibido.toLowerCase(),
        );
      }
      // «ID» se busca como palabra suelta: `olvidés` o `válido` contienen esas letras y no son
      // el defecto que se persigue.
      expect(texto, "pide un ID").not.toMatch(/\bID\b/);
    }
  });

  it("R20: el tuteo peninsular no se cuela en los textos nuevos", () => {
    montar({ opciones: [], hayMas: false, disponible: false });
    const texto = document.body.textContent ?? "";
    // Voseo: «Probá», no «Prueba»/«Prueba tú». El repo ya corrigió esto una vez (ficha 331).
    expect(texto).toContain("Probá recargando la página.");
    expect(texto).not.toContain("Prueba recargando");
    expect(texto).not.toContain("Recarga la página");
  });
});
