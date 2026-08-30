// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";

import { ToastProvider } from "@/providers/ToastProvider";
import type { GastoFijoPlantillaDTO } from "@/lib/types/gasto-fijo-plantilla";

// Feature 85 (T F.2) — tests del diálogo de la PLANTILLA de gasto fijo: el ciclo se pide, se
// siembra al editar y VIAJA SIEMPRE (R3, R13-R17, R24). Las actions se mockean.
//
// LA GUARDIA PRINCIPAL DE LA FICHA es «editar solo el monto reenvía semanas/2/2026-03-31 sin
// moverlos». Hasta esta ficha el diálogo mandaba `{ id, concepto, monto }` y los tres campos
// del ciclo se rellenaban con los defaults del schema, así que **cambiar el monto reescribía la
// periodicidad a meses/1 y movía la fecha de cobro al día de la edición, en silencio**. Los
// tres valores esperados van escritos como LITERALES en la aserción, y ninguno coincide con
// esos defaults: comparar contra ellos —o contra la propia plantilla de entrada por spread—
// sería una aserción contra su propia fuente, verde por construcción, y en este repo esa
// familia ya dejó pasar un fallo real.

const crearMock = vi.fn();
const actualizarMock = vi.fn();
vi.mock("@/lib/actions/gasto-fijo-plantilla", () => ({
  crearPlantillaAction: (...a: unknown[]) => crearMock(...a),
  actualizarPlantillaAction: (...a: unknown[]) => actualizarMock(...a),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { GastoFijoPlantillaDialog } from "@/app/(app)/wallet/_components/GastoFijoPlantillaDialog";

/**
 * La plantilla de la guardia: QUINCENAL (`semanas`/`2`) y anclada el 31 de marzo. Ninguno de
 * los tres valores es el default del schema de crear (`meses`/`1`/hoy).
 */
const QUINCENAL: GastoFijoPlantillaDTO = {
  id: "3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
  concepto: "Alquiler de bodega",
  monto: "300.00",
  activa: true,
  periodicidadUnidad: "semanas",
  periodicidadCantidad: 2,
  fechaCobro: "2026-03-31",
  requiereAprobacion: true, // ficha 333/R1
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

/** Una plantilla con un ciclo que NO es preset: cada 3 días. */
const CADA_3_DIAS: GastoFijoPlantillaDTO = {
  ...QUINCENAL,
  id: "9a8b7c6d-5e4f-4321-8abc-def012345678",
  concepto: "Peaje",
  periodicidadUnidad: "dias",
  periodicidadCantidad: 3,
  fechaCobro: "2026-05-04",
};

function renderDialog(ui: ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

/** Abre el diálogo ya montado en el modo pedido y devuelve el `dialog` del DOM. */
async function abrir(plantilla: GastoFijoPlantillaDTO | null) {
  renderDialog(
    <GastoFijoPlantillaDialog open onOpenChange={() => {}} plantilla={plantilla} />,
  );
  return screen.findByRole("dialog");
}

/**
 * Escribe en el `<input type="date">`. `userEvent.type` no es fiable sobre un control de
 * fecha en jsdom (sanea el valor carácter a carácter); el evento `change` sí, y es lo que
 * emite el navegador cuando alguien elige un día en el calendario nativo.
 */
function ponerFecha(dialog: HTMLElement, valor: string) {
  fireEvent.change(within(dialog).getByLabelText("Día del primer cobro"), {
    target: { value: valor },
  });
}

/** Los textos que el control anuncia por `aria-describedby` (la ayuda y el error del campo). */
function textoDescriptivoDe(control: HTMLElement): string {
  const ids = (control.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean);
  return ids.map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("GastoFijoPlantillaDialog — editar sin tocar el ciclo (R3) · GUARDIA DE LA FICHA", () => {
  it("editar solo el monto reenvía semanas/2/2026-03-31 sin moverlos", async () => {
    const user = userEvent.setup();
    actualizarMock.mockResolvedValue({ status: "ok", plantilla: QUINCENAL });
    const dialog = await abrir(QUINCENAL);

    // Se toca EL MONTO Y NADA MÁS: ni el selector de periodicidad ni la fecha.
    await user.clear(within(dialog).getByLabelText("Monto"));
    await user.type(within(dialog).getByLabelText("Monto"), "999.00");
    await user.click(within(dialog).getByRole("button", { name: "Guardar" }));

    expect(actualizarMock).toHaveBeenCalledTimes(1);
    // Los CINCO campos, exactos. `toEqual` y no `objectContaining`: que no sobre ninguno
    // tampoco es negociable, y los tres del ciclo van como literales a propósito.
    expect(actualizarMock.mock.calls[0][0]).toEqual({
      id: "3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
      concepto: "Alquiler de bodega",
      monto: "999.00",
      periodicidadUnidad: "semanas",
      periodicidadCantidad: 2,
      fechaCobro: "2026-03-31",
    });
    // Y explícitamente: NO son los defaults que el schema aplicaba antes de esta ficha.
    const enviado = actualizarMock.mock.calls[0][0] as Record<string, unknown>;
    expect(enviado.periodicidadUnidad).not.toBe("meses");
    expect(enviado.periodicidadCantidad).not.toBe(1);
  }, 15000);
});

describe("GastoFijoPlantillaDialog — crear (R13)", () => {
  it("crear ofrece diaria/semanal/quincenal/mensual y un ciclo propio, con mensual y hoy preseleccionados", async () => {
    // Reloj CONGELADO: el «hoy» esperado es el literal `2026-03-15`, nunca el resultado de
    // `fechaCalendarioCR()` (esa comparación sería contra la propia fuente del componente).
    // 18:00Z = mediodía en Costa Rica del 15 de marzo.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-03-15T18:00:00.000Z"));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const dialog = await abrir(null);

    // Preseleccionados: mensual y hoy en Costa Rica.
    expect(
      within(dialog).getByRole("combobox", { name: "Cada cuánto se cobra" }),
    ).toHaveTextContent("Mensual");
    expect(within(dialog).getByLabelText("Día del primer cobro")).toHaveValue("2026-03-15");

    // Las cuatro del pedido + el ciclo propio.
    await user.click(within(dialog).getByRole("combobox", { name: "Cada cuánto se cobra" }));
    const lista = await screen.findByRole("listbox");
    for (const nombre of ["Diaria", "Semanal", "Quincenal", "Mensual", "Personalizada"]) {
      expect(within(lista).getByRole("option", { name: nombre })).toBeInTheDocument();
    }
  }, 15000);

  it("«Personalizada» revela «Cada N» y la unidad; los presets no los muestran", async () => {
    const user = userEvent.setup();
    const dialog = await abrir(null);

    expect(within(dialog).queryByLabelText("Cada")).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole("combobox", { name: "Unidad del ciclo" }),
    ).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole("combobox", { name: "Cada cuánto se cobra" }));
    await user.click(
      within(await screen.findByRole("listbox")).getByRole("option", {
        name: "Personalizada",
      }),
    );

    expect(within(dialog).getByLabelText("Cada")).toBeInTheDocument();
    expect(
      within(dialog).getByRole("combobox", { name: "Unidad del ciclo" }),
    ).toBeInTheDocument();
  }, 15000);
});

describe("GastoFijoPlantillaDialog — editar siembra el ciclo vigente (R14)", () => {
  it("editar siembra la periodicidad y la fecha de cobro vigentes", async () => {
    const dialog = await abrir(QUINCENAL);

    expect(
      within(dialog).getByRole("combobox", { name: "Cada cuánto se cobra" }),
    ).toHaveTextContent("Quincenal");
    expect(within(dialog).getByLabelText("Día del primer cobro")).toHaveValue("2026-03-31");
    expect(within(dialog).getByLabelText("Concepto")).toHaveValue("Alquiler de bodega");
    expect(within(dialog).getByLabelText("Monto")).toHaveValue("300.00");
  }, 15000);

  it("un ciclo que no es preset se siembra como «Personalizada» con su cantidad y su unidad", async () => {
    const dialog = await abrir(CADA_3_DIAS);

    expect(
      within(dialog).getByRole("combobox", { name: "Cada cuánto se cobra" }),
    ).toHaveTextContent("Personalizada");
    expect(within(dialog).getByLabelText("Cada")).toHaveValue("3");
    expect(
      within(dialog).getByRole("combobox", { name: "Unidad del ciclo" }),
    ).toHaveTextContent("Días");
    expect(within(dialog).getByLabelText("Día del primer cobro")).toHaveValue("2026-05-04");
  }, 15000);
});

describe("GastoFijoPlantillaDialog — crear envía los cinco campos (R15/R24)", () => {
  it("crear envía los cinco campos: quincenal viaja como semanas/2 con su fecha", async () => {
    const user = userEvent.setup();
    crearMock.mockResolvedValue({ status: "ok", plantilla: QUINCENAL });
    const dialog = await abrir(null);

    await user.type(within(dialog).getByLabelText("Concepto"), "Luz");
    await user.type(within(dialog).getByLabelText("Monto"), "60.00");
    await user.click(within(dialog).getByRole("combobox", { name: "Cada cuánto se cobra" }));
    await user.click(
      within(await screen.findByRole("listbox")).getByRole("option", { name: "Quincenal" }),
    );
    ponerFecha(dialog, "2026-09-14");
    await user.click(within(dialog).getByRole("button", { name: "Guardar" }));

    expect(crearMock).toHaveBeenCalledTimes(1);
    // «Quincenal» es un nombre de pantalla: lo que viaja es el par del modelo, en literales.
    expect(crearMock.mock.calls[0][0]).toEqual({
      concepto: "Luz",
      monto: "60.00",
      periodicidadUnidad: "semanas",
      periodicidadCantidad: 2,
      fechaCobro: "2026-09-14",
    });
    expect(actualizarMock).not.toHaveBeenCalled();
  }, 15000);

  it("el monto «1234.56» viaja como cadena tal cual (R24)", async () => {
    const user = userEvent.setup();
    crearMock.mockResolvedValue({ status: "ok", plantilla: QUINCENAL });
    const dialog = await abrir(null);

    await user.type(within(dialog).getByLabelText("Concepto"), "Internet");
    await user.type(within(dialog).getByLabelText("Monto"), "1234.56");
    ponerFecha(dialog, "2026-09-01");
    await user.click(within(dialog).getByRole("button", { name: "Guardar" }));

    const enviado = crearMock.mock.calls[0][0] as Record<string, unknown>;
    expect(enviado.monto).toBe("1234.56"); // STRING, sin redondeo ni `Number`
    expect(typeof enviado.monto).toBe("string");
    // El contador del ciclo SÍ es un número: no es dinero.
    expect(enviado.periodicidadCantidad).toBe(1);
    expect(typeof enviado.periodicidadCantidad).toBe("number");
  }, 15000);

  it("un ciclo propio viaja como «cada N unidad»: 3 días", async () => {
    const user = userEvent.setup();
    crearMock.mockResolvedValue({ status: "ok", plantilla: CADA_3_DIAS });
    const dialog = await abrir(null);

    await user.type(within(dialog).getByLabelText("Concepto"), "Peaje");
    await user.type(within(dialog).getByLabelText("Monto"), "5.00");
    await user.click(within(dialog).getByRole("combobox", { name: "Cada cuánto se cobra" }));
    await user.click(
      within(await screen.findByRole("listbox")).getByRole("option", {
        name: "Personalizada",
      }),
    );
    await user.clear(within(dialog).getByLabelText("Cada"));
    await user.type(within(dialog).getByLabelText("Cada"), "3");
    await user.click(within(dialog).getByRole("combobox", { name: "Unidad del ciclo" }));
    await user.click(
      within(await screen.findByRole("listbox")).getByRole("option", { name: "Días" }),
    );
    ponerFecha(dialog, "2026-05-04");
    await user.click(within(dialog).getByRole("button", { name: "Guardar" }));

    expect(crearMock.mock.calls[0][0]).toEqual({
      concepto: "Peaje",
      monto: "5.00",
      periodicidadUnidad: "dias",
      periodicidadCantidad: 3,
      fechaCobro: "2026-05-04",
    });
  }, 15000);
});

describe("GastoFijoPlantillaDialog — validación de cliente (R16)", () => {
  it("cantidad 0 y fecha vacía muestran error y no llaman a la acción", async () => {
    const user = userEvent.setup();
    const dialog = await abrir(QUINCENAL);

    await user.click(within(dialog).getByRole("combobox", { name: "Cada cuánto se cobra" }));
    await user.click(
      within(await screen.findByRole("listbox")).getByRole("option", {
        name: "Personalizada",
      }),
    );
    await user.clear(within(dialog).getByLabelText("Cada"));
    await user.type(within(dialog).getByLabelText("Cada"), "0");
    ponerFecha(dialog, "");
    await user.click(within(dialog).getByRole("button", { name: "Guardar" }));

    expect(actualizarMock).not.toHaveBeenCalled();
    expect(crearMock).not.toHaveBeenCalled();

    // Cada mensaje, JUNTO A SU CAMPO: el control lo anuncia por `aria-describedby`.
    expect(textoDescriptivoDe(within(dialog).getByLabelText("Cada"))).toContain(
      "La cantidad debe ser al menos 1.",
    );
    expect(
      textoDescriptivoDe(within(dialog).getByLabelText("Día del primer cobro")),
    ).toContain("La fecha de cobro es obligatoria.");
  }, 15000);

  it("una cantidad decimal tampoco pasa: el ciclo se cuenta en enteros", async () => {
    const user = userEvent.setup();
    const dialog = await abrir(QUINCENAL);

    await user.click(within(dialog).getByRole("combobox", { name: "Cada cuánto se cobra" }));
    await user.click(
      within(await screen.findByRole("listbox")).getByRole("option", {
        name: "Personalizada",
      }),
    );
    await user.clear(within(dialog).getByLabelText("Cada"));
    await user.type(within(dialog).getByLabelText("Cada"), "1.5");
    await user.click(within(dialog).getByRole("button", { name: "Guardar" }));

    expect(actualizarMock).not.toHaveBeenCalled();
    expect(
      within(dialog).getByText("La cantidad debe ser al menos 1."),
    ).toBeInTheDocument();
  }, 15000);
});

describe("GastoFijoPlantillaDialog — errores del servidor (R17)", () => {
  it("un validation_error de fechaCobro se pinta junto al campo de la fecha", async () => {
    const user = userEvent.setup();
    actualizarMock.mockResolvedValue({
      status: "validation_error",
      fieldErrors: { fechaCobro: ["La fecha de cobro no existe en el calendario."] },
    });
    const dialog = await abrir(QUINCENAL);

    await user.click(within(dialog).getByRole("button", { name: "Guardar" }));

    expect(actualizarMock).toHaveBeenCalledTimes(1);
    expect(
      textoDescriptivoDe(within(dialog).getByLabelText("Día del primer cobro")),
    ).toContain("La fecha de cobro no existe en el calendario.");
  }, 15000);

  it("un validation_error de periodicidadCantidad no se descarta en silencio", async () => {
    const user = userEvent.setup();
    actualizarMock.mockResolvedValue({
      status: "validation_error",
      fieldErrors: { periodicidadCantidad: ["La cantidad debe ser al menos 1."] },
    });
    const dialog = await abrir(QUINCENAL);

    await user.click(within(dialog).getByRole("button", { name: "Guardar" }));

    // El ciclo está elegido por preset, así que el único campo corregible —y por tanto el
    // sitio donde el mensaje sirve de algo— es el selector.
    expect(
      textoDescriptivoDe(
        within(dialog).getByRole("combobox", { name: "Cada cuánto se cobra" }),
      ),
    ).toContain("La cantidad debe ser al menos 1.");
  }, 15000);
});

describe("GastoFijoPlantillaDialog — textos (R22)", () => {
  it("ningún texto del diálogo dice que el cobro es mensual", async () => {
    const dialog = await abrir(QUINCENAL);
    const texto = dialog.textContent ?? "";

    expect(texto).not.toMatch(/cada mes/i);
    expect(texto).not.toMatch(/monto mensual/i);
    expect(texto).not.toMatch(/próximos meses/i);
    // El rótulo del monto es «Monto» a secas: la periodicidad la dice su propio campo.
    expect(within(dialog).getByLabelText("Monto")).toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Monto mensual")).not.toBeInTheDocument();
  }, 15000);

  it("avisa —sin bloquear— cuando la fecha de cobro ya pasó", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-06-10T18:00:00.000Z"));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    actualizarMock.mockResolvedValue({ status: "ok", plantilla: QUINCENAL });
    // Ancla 2026-03-31, o sea tres meses antes del reloj congelado.
    const dialog = await abrir(QUINCENAL);

    expect(within(dialog).getByRole("status")).toHaveTextContent(/ya pasó/i);

    // Y NO bloquea: corregir un ancla mal puesta tiene que seguir siendo posible.
    await user.click(within(dialog).getByRole("button", { name: "Guardar" }));
    expect(actualizarMock).toHaveBeenCalledTimes(1);
  }, 15000);
});
