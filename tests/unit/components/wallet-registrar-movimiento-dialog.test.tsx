// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// =================================================================================================
// FICHA 334 (T D6, R29) — EL DIÁLOGO ÚNICO PARA MOVER DINERO EN LA CAJA
// =================================================================================================
//
// Este archivo SUSTITUYE a `tests/unit/components/wallet-registrar-egreso-dialog.test.tsx`, que se
// borra en el mismo commit porque su componente (`RegistrarEgresoAdministrativoDialog`) deja de
// existir. **La cobertura no se pierde**: en este repo borrar un componente ya se llevó su test por
// delante y costó una regresión en producción, así que los CUATRO casos de aquel archivo viajan
// aquí, con su origen anotado caso por caso:
//
// | caso del archivo borrado | dónde vive ahora | qué cambió |
// | --- | --- | --- |
// | «el selector de tipo ofrece SOLO {gasto variable, sueldo}, sin gasto fijo» | «el selector no ofrece “Gasto fijo”…» | el selector ahora ofrece CUATRO conceptos; la aserción que importa —`queryByRole("option", { name: "Gasto fijo" })` ausente— se conserva igual |
// | «registra un gasto variable con el tipo, monto y descripción enviados» | «gasto variable: envía tipoEgreso=gasto_variable…» | idéntico, mismo `toEqual({ tipoEgreso, monto: "125.50", descripcion })` |
// | «al elegir Sueldo cambia el label y envía tipoEgreso=sueldo» | «sueldo: cambia la etiqueta de la descripción…» | idéntico, mismo `toEqual` |
// | «no llama la action si el monto es 0 o la descripción está vacía» | «monto 0 y descripción vacía no llaman a ninguna action…» | idéntico, más el barrido a la SEGUNDA action |
// | (feature 85/R25) «el diálogo de egreso manual no ofrece periodicidad ni fecha de cobro» | «un movimiento no es periódico…» | **ADAPTADO, y aquí está el motivo**: aquel caso afirmaba `input[type="date"]` = 0 elementos. El diálogo unificado TIENE un campo de fecha por diseño (R19: la fecha en que ocurrió el movimiento), así que esa aserción concreta ya no puede sostenerse. Lo que el caso protegía —que un gasto variable o un sueldo NO son periódicos, que la periodicidad es de la PLANTILLA de gasto fijo y de nada más— se conserva entero: ni selector de periodicidad, ni unidad de ciclo, ni «Día del primer cobro», ni «Cada»; y el ÚNICO campo de fecha del diálogo es el del día del movimiento, comprobado por su etiqueta |
//
// El monto se mide como STRING exacto en todos los envíos (R15): ni `Number(` ni `parseFloat` en
// ningún punto del camino.

const registrarEgresoMock = vi.fn();
const registrarManualMock = vi.fn();

vi.mock("@/lib/actions/wallet-egresos", () => ({
  registrarEgresoAdministrativoAction: (...a: unknown[]) => registrarEgresoMock(...a),
}));
vi.mock("@/lib/actions/wallet", () => ({
  registrarMovimientoManualAction: (...a: unknown[]) => registrarManualMock(...a),
}));

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, push: vi.fn() }),
}));

// El toast se mockea (en vez de montar `ToastProvider`, como hacía el archivo borrado) porque R31
// exige medir el TEXTO de los avisos, y leerlo del argumento es más preciso que buscarlo en un
// portal que se auto-descarta.
const successMock = vi.fn();
const errorMock = vi.fn();
vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: successMock,
    error: errorMock,
    warning: vi.fn(),
    info: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

import { RegistrarMovimientoCajaDialog } from "@/app/(app)/wallet/_components/RegistrarMovimientoCajaDialog";

/**
 * El día calendario de Costa Rica, calculado AQUÍ y no importado de `lib/utils/fecha-cr.ts`: un
 * test que compara el componente contra la misma función que el componente usa está siempre verde
 * (precedente medido en este repo). Costa Rica es UTC−6 todo el año, sin horario de verano.
 */
function hoyEnCostaRica(): string {
  return new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Un día calendario N días ANTES de hoy en Costa Rica, con la misma aritmética independiente. */
function diasAntesEnCostaRica(dias: number): string {
  const ms = Date.now() - 6 * 60 * 60 * 1000 - dias * 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** Un día calendario N días DESPUÉS de hoy en Costa Rica. */
function diasDespuesEnCostaRica(dias: number): string {
  const ms = Date.now() - 6 * 60 * 60 * 1000 + dias * 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

async function abrirDialogo(): Promise<{
  user: ReturnType<typeof userEvent.setup>;
  dialog: HTMLElement;
}> {
  const user = userEvent.setup();
  render(<RegistrarMovimientoCajaDialog />);
  await user.click(screen.getByRole("button", { name: "Registrar movimiento" }));
  const dialog = await screen.findByRole("dialog");
  return { user, dialog };
}

/** Elige un concepto del `Select` unificado por su etiqueta visible. */
async function elegirConcepto(
  user: ReturnType<typeof userEvent.setup>,
  dialog: HTMLElement,
  nombre: string,
): Promise<void> {
  await user.click(within(dialog).getByRole("combobox", { name: "Concepto del movimiento" }));
  const lista = await screen.findByRole("listbox");
  await user.click(within(lista).getByRole("option", { name: nombre }));
}

/** El `<input type="date">` es controlado: `fireEvent.change` es la vía fiable en jsdom. */
function ponerFecha(dialog: HTMLElement, valor: string): void {
  fireEvent.change(within(dialog).getByLabelText("Fecha"), { target: { value: valor } });
}

beforeEach(() => {
  vi.clearAllMocks();
  registrarEgresoMock.mockResolvedValue({ status: "ok", movimiento: { id: "m1" } });
  registrarManualMock.mockResolvedValue({ status: "ok", movimiento: { id: "m1" } });
});

afterEach(() => {
  cleanup();
});

// ─────────────────────────────────────────────────────────────────────────────
// R3 / R11 — qué se puede elegir (y qué NO)
// ─────────────────────────────────────────────────────────────────────────────

describe("RegistrarMovimientoCajaDialog — el selector ofrece los cuatro conceptos (R3)", () => {
  it("ofrece gasto variable, sueldo y los dos ajustes, y nada más", async () => {
    const { user, dialog } = await abrirDialogo();

    await user.click(within(dialog).getByRole("combobox", { name: "Concepto del movimiento" }));
    const lista = await screen.findByRole("listbox");
    const opciones = within(lista).getAllByRole("option");

    expect(opciones.map((o) => o.textContent?.trim())).toEqual([
      "Gasto variable",
      "Sueldo",
      "Ajuste que suma dinero",
      "Ajuste que resta dinero",
    ]);
  }, 15000);

  // MIGRADO de `wallet-registrar-egreso-dialog.test.tsx` (feature 45, R19/R22a).
  it("el selector no ofrece «Gasto fijo»: ese lo emite el cron desde su plantilla (R11)", async () => {
    const { user, dialog } = await abrirDialogo();

    await user.click(within(dialog).getByRole("combobox", { name: "Concepto del movimiento" }));
    const lista = await screen.findByRole("listbox");
    expect(within(lista).getByRole("option", { name: "Gasto variable" })).toBeInTheDocument();
    expect(within(lista).getByRole("option", { name: "Sueldo" })).toBeInTheDocument();
    // "Gasto fijo" NO se ofrece a mano: lo emite el cron.
    expect(within(lista).queryByRole("option", { name: "Gasto fijo" })).not.toBeInTheDocument();
  }, 15000);

  // MIGRADO y ADAPTADO de `wallet-registrar-egreso-dialog.test.tsx` (feature 85, R25). El motivo
  // del cambio está en la tabla de la cabecera: el diálogo unificado SÍ tiene un campo de fecha.
  it("un movimiento no es periódico: no hay ciclo, ni unidad, ni día de primer cobro (85/R25)", async () => {
    const { user, dialog } = await abrirDialogo();

    expect(
      within(dialog).queryByRole("combobox", { name: "Cada cuánto se cobra" }),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole("combobox", { name: "Unidad del ciclo" }),
    ).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Día del primer cobro")).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Cada")).not.toBeInTheDocument();

    // El ÚNICO campo de fecha del diálogo es el día DEL MOVIMIENTO, y se alcanza por su etiqueta:
    // ningún control de fecha se cuela por la puerta de atrás.
    const fechas = dialog.querySelectorAll('input[type="date"]');
    expect(fechas).toHaveLength(1);
    expect(within(dialog).getByLabelText("Fecha")).toBe(fechas[0]);

    // Y el único selector del diálogo sigue siendo el del concepto: ni «Diaria» ni «Mensual»
    // asoman por ahí.
    const combos = within(dialog).getAllByRole("combobox");
    expect(combos).toHaveLength(1);
    await user.click(within(dialog).getByRole("combobox", { name: "Concepto del movimiento" }));
    const lista = await screen.findByRole("listbox");
    expect(within(lista).getAllByRole("option")).toHaveLength(4);
    for (const nombre of ["Diaria", "Semanal", "Quincenal", "Mensual", "Personalizada"]) {
      expect(within(lista).queryByRole("option", { name: nombre })).not.toBeInTheDocument();
    }
  }, 15000);
});

describe("RegistrarMovimientoCajaDialog — dice con qué nombre saldrá en el libro (R4)", () => {
  it("la línea de ayuda sigue al concepto elegido", async () => {
    const { user, dialog } = await abrirDialogo();

    expect(
      within(dialog).getByText("Se registra en el libro como «Gasto variable»."),
    ).toBeInTheDocument();

    await elegirConcepto(user, dialog, "Ajuste que suma dinero");
    expect(
      within(dialog).getByText("Se registra en el libro como «Ajuste (ingreso)»."),
    ).toBeInTheDocument();

    await elegirConcepto(user, dialog, "Ajuste que resta dinero");
    expect(
      within(dialog).getByText("Se registra en el libro como «Ajuste (egreso)»."),
    ).toBeInTheDocument();
  }, 15000);
});

// ─────────────────────────────────────────────────────────────────────────────
// R5–R8 / R15 — qué se envía por cada concepto
// ─────────────────────────────────────────────────────────────────────────────

describe("RegistrarMovimientoCajaDialog — el enrutado por concepto (R5/R6/R7/R8)", () => {
  // MIGRADO de `wallet-registrar-egreso-dialog.test.tsx` (feature 45, R2/R22a), con su `toEqual`
  // intacto: el `monto: "125.50"` es el contrato money-safe (R15), no una muestra.
  it("gasto variable: envía tipoEgreso=gasto_variable con el monto STRING exacto (R5/R15)", async () => {
    const { user, dialog } = await abrirDialogo();

    await user.type(within(dialog).getByLabelText("Monto"), "125.50");
    await user.type(within(dialog).getByLabelText("Concepto del gasto"), "Suministros");
    await user.click(within(dialog).getByRole("button", { name: "Registrar" }));

    expect(registrarEgresoMock).toHaveBeenCalledTimes(1);
    expect(registrarEgresoMock.mock.calls[0][0]).toEqual({
      tipoEgreso: "gasto_variable",
      monto: "125.50",
      descripcion: "Suministros",
    });
    // Un gasto no es un ajuste: la otra action no se toca (design §6, `origen_tipo`).
    expect(registrarManualMock).not.toHaveBeenCalled();
  }, 15000);

  // MIGRADO de `wallet-registrar-egreso-dialog.test.tsx` (feature 45, R5/F1.4-c).
  it("sueldo: cambia la etiqueta de la descripción y envía tipoEgreso=sueldo (R6/R9)", async () => {
    const { user, dialog } = await abrirDialogo();

    await elegirConcepto(user, dialog, "Sueldo");

    // El label de la descripción se adapta al sueldo (trabajador + periodo, texto libre).
    const descripcion = within(dialog).getByLabelText("Trabajador y periodo");
    await user.type(within(dialog).getByLabelText("Monto"), "800.00");
    await user.type(descripcion, "Juan Pérez — julio 2026");
    await user.click(within(dialog).getByRole("button", { name: "Registrar" }));

    expect(registrarEgresoMock).toHaveBeenCalledTimes(1);
    expect(registrarEgresoMock.mock.calls[0][0]).toEqual({
      tipoEgreso: "sueldo",
      monto: "800.00",
      descripcion: "Juan Pérez — julio 2026",
    });
  }, 15000);

  it("ajuste que suma: envía tipo=ingreso y categoria=ingreso_ajuste (R7)", async () => {
    const { user, dialog } = await abrirDialogo();

    await elegirConcepto(user, dialog, "Ajuste que suma dinero");
    await user.type(within(dialog).getByLabelText("Monto"), "40.00");
    await user.type(within(dialog).getByLabelText("Motivo del ajuste"), "Sobrante de caja");
    await user.click(within(dialog).getByRole("button", { name: "Registrar" }));

    expect(registrarManualMock).toHaveBeenCalledTimes(1);
    expect(registrarManualMock.mock.calls[0][0]).toEqual({
      tipo: "ingreso",
      categoria: "ingreso_ajuste",
      monto: "40.00",
      descripcion: "Sobrante de caja",
    });
    expect(registrarEgresoMock).not.toHaveBeenCalled();
  }, 15000);

  it("ajuste que resta: envía tipo=egreso y categoria=egreso_ajuste (R8)", async () => {
    const { user, dialog } = await abrirDialogo();

    await elegirConcepto(user, dialog, "Ajuste que resta dinero");
    await user.type(within(dialog).getByLabelText("Monto"), "12.75");
    await user.type(within(dialog).getByLabelText("Motivo del ajuste"), "Faltante de caja");
    await user.click(within(dialog).getByRole("button", { name: "Registrar" }));

    expect(registrarManualMock).toHaveBeenCalledTimes(1);
    expect(registrarManualMock.mock.calls[0][0]).toEqual({
      tipo: "egreso",
      categoria: "egreso_ajuste",
      monto: "12.75",
      descripcion: "Faltante de caja",
    });
  }, 15000);
});

// ─────────────────────────────────────────────────────────────────────────────
// R13 / R14 — la validación de cliente
// ─────────────────────────────────────────────────────────────────────────────

describe("RegistrarMovimientoCajaDialog — validación de cliente (R13/R14)", () => {
  // MIGRADO de `wallet-registrar-egreso-dialog.test.tsx` (feature 45, R4/R5).
  it("monto 0 y descripción vacía no llaman a ninguna action y pintan los dos mensajes", async () => {
    const { user, dialog } = await abrirDialogo();

    // Monto 0 y descripción vacía → bloqueado en cliente.
    await user.type(within(dialog).getByLabelText("Monto"), "0");
    await user.click(within(dialog).getByRole("button", { name: "Registrar" }));

    expect(registrarEgresoMock).not.toHaveBeenCalled();
    expect(registrarManualMock).not.toHaveBeenCalled();
    expect(
      within(dialog).getByText("El monto debe ser un número mayor que 0."),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("La descripción es obligatoria.")).toBeInTheDocument();
  }, 15000);
});

// ─────────────────────────────────────────────────────────────────────────────
// R19 / R20 / R23 — la fecha
// ─────────────────────────────────────────────────────────────────────────────

describe("RegistrarMovimientoCajaDialog — la fecha del movimiento (R19/R20/R23)", () => {
  it("la fecha arranca en el día de hoy de Costa Rica, y no admite ni el futuro ni más de un mes atrás (R19)", async () => {
    const { dialog } = await abrirDialogo();

    const campo = within(dialog).getByLabelText("Fecha") as HTMLInputElement;
    expect(campo.value).toBe(hoyEnCostaRica());
    // El tope de arriba es hoy (R20) y el de abajo, la ventana de 30 días de la config.
    expect(campo.max).toBe(hoyEnCostaRica());
    expect(campo.min).toBe(diasAntesEnCostaRica(30));
  }, 15000);

  it("si NO se toca la fecha, la clave `fecha` no viaja: el movimiento se fecha con el instante del registro (R23)", async () => {
    const { user, dialog } = await abrirDialogo();

    await user.type(within(dialog).getByLabelText("Monto"), "10.00");
    await user.type(within(dialog).getByLabelText("Concepto del gasto"), "Café");
    await user.click(within(dialog).getByRole("button", { name: "Registrar" }));

    const payload = registrarEgresoMock.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(["descripcion", "monto", "tipoEgreso"]);
    expect("fecha" in payload).toBe(false);
  }, 15000);

  it("si se elige un día anterior, la fecha viaja tal cual, como texto YYYY-MM-DD (R22)", async () => {
    const { user, dialog } = await abrirDialogo();

    const ayer = diasAntesEnCostaRica(1);
    ponerFecha(dialog, ayer);
    await user.type(within(dialog).getByLabelText("Monto"), "55.00");
    await user.type(within(dialog).getByLabelText("Concepto del gasto"), "Gasolina de ayer");
    await user.click(within(dialog).getByRole("button", { name: "Registrar" }));

    expect(registrarEgresoMock.mock.calls[0][0]).toEqual({
      tipoEgreso: "gasto_variable",
      monto: "55.00",
      descripcion: "Gasolina de ayer",
      fecha: ayer,
    });
  }, 15000);

  it("una fecha del futuro se rechaza en el cliente, sin llamar a la action (R20)", async () => {
    const { user, dialog } = await abrirDialogo();

    ponerFecha(dialog, diasDespuesEnCostaRica(1));
    await user.type(within(dialog).getByLabelText("Monto"), "20.00");
    await user.type(within(dialog).getByLabelText("Concepto del gasto"), "Algo de mañana");
    await user.click(within(dialog).getByRole("button", { name: "Registrar" }));

    expect(registrarEgresoMock).not.toHaveBeenCalled();
    expect(
      within(dialog).getByText("La fecha no puede ser posterior a hoy."),
    ).toBeInTheDocument();
  }, 15000);

  it("un día que no existe en el calendario se rechaza en el cliente (R21)", async () => {
    const { user, dialog } = await abrirDialogo();

    // `2026-02-31` no da `Invalid Date`: RUEDA al 3 de marzo. Solo el round-trip lo caza.
    ponerFecha(dialog, "2026-02-31");
    await user.type(within(dialog).getByLabelText("Monto"), "20.00");
    await user.type(within(dialog).getByLabelText("Concepto del gasto"), "Día imposible");
    await user.click(within(dialog).getByRole("button", { name: "Registrar" }));

    expect(registrarEgresoMock).not.toHaveBeenCalled();
    expect(
      within(dialog).getByText("Esa fecha no existe en el calendario."),
    ).toBeInTheDocument();
  }, 15000);

  it("el `validation_error` del borde con clave `fecha` se pinta bajo el campo de la fecha (R32)", async () => {
    registrarEgresoMock.mockResolvedValue({
      status: "validation_error",
      fieldErrors: { fecha: ["No se admiten movimientos anteriores al 2026-07-30."] },
    });
    const { user, dialog } = await abrirDialogo();

    await user.type(within(dialog).getByLabelText("Monto"), "30.00");
    await user.type(within(dialog).getByLabelText("Concepto del gasto"), "Un gasto viejo");
    await user.click(within(dialog).getByRole("button", { name: "Registrar" }));

    const mensaje = await within(dialog).findByText(
      "No se admiten movimientos anteriores al 2026-07-30.",
    );
    expect(mensaje).toBeInTheDocument();
    // Asociado a SU campo: el error lleva el id que el campo referencia por `aria-describedby`.
    const campo = within(dialog).getByLabelText("Fecha");
    expect(campo).toHaveAttribute("aria-invalid", "true");
    expect(campo.getAttribute("aria-describedby")).toContain("movimiento-fecha-error");
  }, 15000);
});

// ─────────────────────────────────────────────────────────────────────────────
// R18 / R31 / R32 — después del registro, los avisos y la accesibilidad
// ─────────────────────────────────────────────────────────────────────────────

describe("RegistrarMovimientoCajaDialog — tras registrar avisa al módulo y refresca (R18)", () => {
  it("llama a `onRegistrado`, refresca la ruta y cierra el diálogo", async () => {
    const onRegistrado = vi.fn();
    const user = userEvent.setup();
    render(<RegistrarMovimientoCajaDialog onRegistrado={onRegistrado} />);

    await user.click(screen.getByRole("button", { name: "Registrar movimiento" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Monto"), "15.00");
    await user.type(within(dialog).getByLabelText("Concepto del gasto"), "Parqueo");
    await user.click(within(dialog).getByRole("button", { name: "Registrar" }));

    await waitFor(() => expect(onRegistrado).toHaveBeenCalledTimes(1));
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(successMock).toHaveBeenCalledWith("Movimiento registrado correctamente.");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  }, 15000);
});

describe("RegistrarMovimientoCajaDialog — los avisos hablan de vos (R31)", () => {
  it.each([
    ["forbidden", "No tenés permiso para registrar movimientos."],
    ["unauthenticated", "Tu sesión expiró. Iniciá sesión de nuevo."],
  ])("`%s` → el aviso en voseo, sin siglas ni tecnicismos", async (status, mensaje) => {
    registrarEgresoMock.mockResolvedValue({ status });
    const { user, dialog } = await abrirDialogo();

    await user.type(within(dialog).getByLabelText("Monto"), "10.00");
    await user.type(within(dialog).getByLabelText("Concepto del gasto"), "Algo");
    await user.click(within(dialog).getByRole("button", { name: "Registrar" }));

    await waitFor(() => expect(errorMock).toHaveBeenCalledWith(mensaje));
    // Y el diálogo NO se cierra: el usuario conserva lo que había escrito.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  }, 15000);

  it("el título y la descripción del diálogo también hablan de vos", async () => {
    const { dialog } = await abrirDialogo();

    expect(
      within(dialog).getByText("Registrar movimiento en la caja"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "Elegí el concepto, el monto y la fecha. El movimiento es inmutable una vez registrado.",
      ),
    ).toBeInTheDocument();
  }, 15000);
});

describe("RegistrarMovimientoCajaDialog — los cuatro campos se alcanzan por su etiqueta (R32)", () => {
  it("concepto, monto, fecha y descripción tienen nombre accesible", async () => {
    const { user, dialog } = await abrirDialogo();

    expect(within(dialog).getByLabelText("Concepto del movimiento")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Monto")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Fecha")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Concepto del gasto")).toBeInTheDocument();

    // La etiqueta de la descripción sigue al concepto, así que el nombre accesible del cuarto
    // campo cambia con él (R9) y nunca se queda hablando del concepto anterior.
    await elegirConcepto(user, dialog, "Ajuste que resta dinero");
    expect(within(dialog).queryByLabelText("Concepto del gasto")).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText("Motivo del ajuste")).toBeInTheDocument();
  }, 15000);
});
