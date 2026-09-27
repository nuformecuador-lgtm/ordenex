// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { SWRConfig } from "swr";

import { ToastProvider } from "@/providers/ToastProvider";

import type { CierresDeLaTienda } from "@/app/(app)/mi-wallet/_components/mi-wallet-cierres";
import { estado } from "@/tests/fixtures/estado-cuenta";

/**
 * FICHA 335 (C3, R20/R22/R25/R26/R27) — el filtro de cierre de `/mi-wallet` deja de pedir un UUID.
 *
 * Lo que había antes: un `<input type="text" placeholder="ID del cierre">`. El campo existía, se
 * veía y aceptaba texto, pero NADIE conoce ese identificador, así que el filtro no se podía usar.
 *
 * FICHA 458-D (T D.5, R34/R10): `/mi-wallet` es ahora el ESTADO DE CUENTA de la tienda y conserva SU
 * selector de cierre (día y número de movimientos, sin el mensajero). La barra de filtros de antes
 * (`MiWalletFiltros`, con «Aplicar» y «Limpiar») se retiró con el libro: el cierre se aplica al
 * elegirlo y «Todos los cierres» lo deshace (R27); el concepto lo sustituyen los chips (R24) y las
 * fechas, el periodo del estado de cuenta. Este archivo mide lo MISMO sobre el módulo nuevo
 * (`MiEstadoCuenta`): el cierre se elige, emite SU identificador a la lectura de la tienda de la
 * sesión, y el selector degrada sin mentir.
 */

const verMiEstadoCuentaMock = vi.fn();
vi.mock("@/lib/actions/estado-cuenta", () => ({
  verEstadoCuentaAction: vi.fn(),
  verEstadoCuentaCompletoAction: vi.fn(),
  verMiEstadoCuentaAction: (...a: unknown[]) => verMiEstadoCuentaMock(...a),
  verMiEstadoCuentaCompletoAction: vi.fn(),
  verOrdenesDeFilaAction: vi.fn(),
}));
vi.mock("@/lib/actions/wallet-comprobante", () => ({ verComprobanteAction: vi.fn(), adjuntarComprobanteAction: vi.fn() }));
vi.mock("@/lib/actions/wallet-tienda", () => ({
  verDetalleDeMiMovimientoAction: vi.fn(),
  verDetalleDeMiMovimientoCompletoAction: vi.fn(),
}));

import { MiEstadoCuenta } from "@/app/(app)/mi-wallet/_components/MiEstadoCuenta";

const C1 = "11111111-1111-4111-8111-111111111111";
const C2 = "22222222-2222-4222-8222-222222222222";

const CIERRES: CierresDeLaTienda = {
  opciones: [
    { cierreId: C1, fecha: "2026-08-01T09:15:00.000Z", movimientos: 7 },
    { cierreId: C2, fecha: "2026-07-12T14:30:00.000Z", movimientos: 4 },
  ],
  hayMas: false,
  disponible: true,
};

function conSWR(ui: ReactNode) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToastProvider>{ui}</ToastProvider>
    </SWRConfig>,
  );
}

function montar(cierres: CierresDeLaTienda = CIERRES) {
  return conSWR(<MiEstadoCuenta inicial={estado()} cierres={cierres} />);
}

/** Abre el selector de cierre y elige la opción cuyo rótulo se pide. */
async function elegirCierre(user: ReturnType<typeof userEvent.setup>, rotulo: string) {
  await user.click(screen.getByRole("combobox", { name: "Filtrar por cierre" }));
  const lista = await screen.findByRole("listbox");
  await user.click(within(lista).getByRole("option", { name: rotulo }));
}

/** La última entrada con la que se leyó el estado de cuenta de la tienda. */
function ultimaLectura(): Record<string, unknown> {
  expect(verMiEstadoCuentaMock).toHaveBeenCalled();
  return verMiEstadoCuentaMock.mock.calls[verMiEstadoCuentaMock.mock.calls.length - 1][0];
}

beforeEach(() => {
  vi.clearAllMocks();
  verMiEstadoCuentaMock.mockResolvedValue({ status: "ok", estado: estado() });
});

afterEach(() => {
  cleanup();
});

describe("/mi-wallet — el cierre se ELIGE, no se escribe (R22) [335 → 458-D]", () => {
  it("R22: el filtro de cierre es un `combobox` y ningún campo de la pantalla pide un identificador", () => {
    montar();

    expect(screen.getByRole("combobox", { name: "Filtrar por cierre" })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("ID del cierre")).not.toBeInTheDocument();

    // Ningún campo de texto libre: los dos `input` que quedan son las fechas del periodo. Se
    // descartan los `aria-hidden` (Base UI planta un input oculto por cada `Select`).
    const visibles = Array.from(document.querySelectorAll("input")).filter(
      (i) => i.getAttribute("aria-hidden") !== "true",
    );
    expect(visibles.filter((i) => i.type === "text" || i.type === "search")).toEqual([]);
    expect(visibles.map((i) => i.type)).toEqual(["date", "date"]);
  });

  it("R22: el rótulo del selector cuelga de un `id` REAL, no de la nada", () => {
    montar();
    const rotulo = document.querySelector<HTMLLabelElement>('label[for="mi-wallet-filtro-cierre"]');
    expect(rotulo).not.toBeNull();
    expect(document.getElementById("mi-wallet-filtro-cierre")).not.toBeNull();
    expect(rotulo!.textContent).toBe("Cierre");
  });
});

describe("/mi-wallet — «todos los cierres» es el estado de partida (R25) [335 → 458-D]", () => {
  it("R25: la primera opción es «Todos los cierres»; las demás, día y número de movimientos (sin mensajero, R10)", async () => {
    const user = userEvent.setup();
    montar();

    const selector = screen.getByRole("combobox", { name: "Filtrar por cierre" });
    expect(selector).toHaveTextContent("Todos los cierres");

    await user.click(selector);
    const lista = await screen.findByRole("listbox");
    expect(within(lista).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Todos los cierres",
      "Cierre del 2026-08-01 · 7 movimientos",
      "Cierre del 2026-07-12 · 4 movimientos",
    ]);
  });

  it("R25: sin tocar el selector no se lee nada más: la primera página ya vino del servidor", () => {
    montar();
    expect(verMiEstadoCuentaMock).not.toHaveBeenCalled();
  });
});

describe("/mi-wallet — elegir un cierre lo aplica (R26) y «Todos los cierres» lo deshace (R27) [335 → 458-D]", () => {
  it("R26: al elegir un cierre se lee el estado de cuenta con SU `cierreId`, sin ninguna clave de cuenta (R36)", async () => {
    const user = userEvent.setup();
    montar();

    await elegirCierre(user, "Cierre del 2026-07-12 · 4 movimientos");
    await waitFor(() => expect(ultimaLectura()).toEqual({ cierreId: C2, page: 1, pageSize: 20 }));
    // El IDENTIFICADOR, no la etiqueta; y ni `cuenta` ni `tiendaId`: la tienda es la de la sesión.
    expect(ultimaLectura().cierreId).not.toContain("Cierre del");
    expect(ultimaLectura()).not.toHaveProperty("cuenta");
    expect(ultimaLectura()).not.toHaveProperty("tiendaId");
  });

  it("R26: cada opción emite SU identificador, no siempre el primero", async () => {
    const user = userEvent.setup();
    montar();
    await elegirCierre(user, "Cierre del 2026-08-01 · 7 movimientos");
    await waitFor(() => expect(ultimaLectura().cierreId).toBe(C1));
  });

  it("R27: «Todos los cierres» devuelve el selector al estado de partida y la lectura deja de filtrar", async () => {
    const user = userEvent.setup();
    montar();

    await elegirCierre(user, "Cierre del 2026-07-12 · 4 movimientos");
    const selector = screen.getByRole("combobox", { name: "Filtrar por cierre" });
    await waitFor(() => expect(selector).toHaveTextContent("Cierre del 2026-07-12 · 4 movimientos"));

    await elegirCierre(user, "Todos los cierres");
    await waitFor(() => expect(selector).toHaveTextContent("Todos los cierres"));
    // Vuelve a la clave inicial (la del servidor): lo que se pinta es la cuenta SIN filtro de cierre.
    for (const [entrada] of verMiEstadoCuentaMock.mock.calls) {
      if ((entrada as { cierreId?: string }).cierreId === undefined) expect(entrada).toEqual({ page: 1, pageSize: 20 });
    }
    expect(screen.getByRole("table", { name: "Estado de cuenta de Tania Tienda" })).toBeInTheDocument();
  });
});

describe("/mi-wallet — el selector degrada sin mentir (R28/R29/R30) [335]", () => {
  it("R28: sin cierres queda deshabilitado y dice que todavía no hay", () => {
    montar({ opciones: [], hayMas: false, disponible: true });
    expect(screen.getByRole("combobox", { name: "Filtrar por cierre" })).toBeDisabled();
    expect(screen.getByText("Todavía no hay cierres en tu wallet.")).toBeInTheDocument();
  });

  it("R29: si la lectura no respondió, queda deshabilitado y dice qué hacer", () => {
    montar({ opciones: [], hayMas: false, disponible: false });
    expect(screen.getByRole("combobox", { name: "Filtrar por cierre" })).toBeDisabled();
    expect(screen.getByText("No pudimos cargar tus cierres. Probá recargando la página.")).toBeInTheDocument();
  });

  it("R30: con más cierres de los que caben, avisa de que solo ofrece los recientes", () => {
    montar({ ...CIERRES, hayMas: true });
    const aviso = screen.getByText("Mostramos los cierres más recientes.");
    expect(aviso.getAttribute("role")).toBeNull();
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

describe("/mi-wallet — voseo y lenguaje claro (R20) [335]", () => {
  it("R20: los textos de la pantalla están en voseo y sin jerga", () => {
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
      for (const prohibido of ["SLA", "acuerdo a nivel de servicio", "UUID", "cierre_dia", "origen_id", "débito", "crédito"]) {
        expect(texto.toLowerCase(), `dice «${prohibido}»`).not.toContain(prohibido.toLowerCase());
      }
      expect(texto, "pide un ID").not.toMatch(/\bID\b/);
    }
  });

  it("R20: el tuteo peninsular no se cuela en los textos nuevos", () => {
    montar({ opciones: [], hayMas: false, disponible: false });
    const texto = document.body.textContent ?? "";
    expect(texto).toContain("Probá recargando la página.");
    expect(texto).not.toContain("Prueba recargando");
    expect(texto).not.toContain("Recarga la página");
  });
});
