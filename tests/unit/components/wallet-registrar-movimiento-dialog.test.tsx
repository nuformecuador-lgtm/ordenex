// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { SWRConfig } from "swr";

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

// ⭑ FICHA 381 (T H.2/H.3/H.4) — el QUINTO concepto: «Cobrar un costo a una tienda». Cubre
// R1–R11. Lo que se mide aquí, y por qué cada cosa:
//
//  - **R2/R3** el campo de la tienda es CONDICIONAL, y con los otros cuatro conceptos el payload
//    no gana ni una clave. Esa segunda mitad es la que hace la aserción falsable: un diálogo que
//    mandara siempre `tiendaId` pasaría un test que solo mirase el cobro.
//  - **R7** confirmar sin tienda no llama al servidor. Se afirma sobre las TRES actions.
//  - **R6** el catálogo caído bloquea el cobro y NO los otros cuatro — la degradación es RUIDOSA,
//    al revés que la de `GenerarApiKeyForm`, y por eso hay que probarla.
//  - **R9** el aviso de éxito del cobro lleva el saldo que devolvió el servidor, con su signo. Un
//    cobro que deja a la tienda EN NEGATIVO se anuncia en negativo: no se recorta a cero ni se
//    pinta en valor absoluto (R27/R28 del spec).
//
// El payload del cobro se mide con `toEqual` literal: `tipo`, `categoria`, `registradoPor` y el
// origen NO viajan desde el cliente (el schema del borde es `.strict()`), así que una clave de
// más aquí es un `validation_error` en producción, no un atajo.
const registrarEgresoMock = vi.fn();
const registrarManualMock = vi.fn();
const registrarCobroMock = vi.fn();
const listarTiendasMock = vi.fn();

vi.mock("@/lib/actions/wallet-egresos", () => ({
  registrarEgresoAdministrativoAction: (...a: unknown[]) => registrarEgresoMock(...a),
}));
vi.mock("@/lib/actions/wallet", () => ({
  registrarMovimientoManualAction: (...a: unknown[]) => registrarManualMock(...a),
}));
vi.mock("@/lib/actions/wallet-tienda", () => ({
  registrarCobroTiendaAction: (...a: unknown[]) => registrarCobroMock(...a),
}));
vi.mock("@/lib/actions/usuarios-por-rol", () => ({
  listarAdminTiendas: (...a: unknown[]) => listarTiendasMock(...a),
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

/**
 * ⭑ FICHA 381 — caché de SWR AISLADA por render: el catálogo de tiendas se lee con `useSWR` y
 * una caché compartida haría que un test heredara la respuesta (o el error) del anterior.
 */
function Envoltura({ children }: { children: ReactNode }) {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
  );
}

async function abrirDialogo(): Promise<{
  user: ReturnType<typeof userEvent.setup>;
  dialog: HTMLElement;
}> {
  const user = userEvent.setup();
  render(
    <Envoltura>
      <RegistrarMovimientoCajaDialog />
    </Envoltura>,
  );
  await user.click(screen.getByRole("button", { name: "Registrar movimiento" }));
  const dialog = await screen.findByRole("dialog");
  return { user, dialog };
}

/** Elige una opción de un `Select` de Base UI por el nombre accesible del control. */
async function elegirEnSelect(
  user: ReturnType<typeof userEvent.setup>,
  dialog: HTMLElement,
  combo: string,
  opcion: string,
): Promise<void> {
  await user.click(within(dialog).getByRole("combobox", { name: combo }));
  const lista = await screen.findByRole("listbox");
  await user.click(within(lista).getByRole("option", { name: opcion }));
}

/** Elige un concepto del `Select` unificado por su etiqueta visible. */
async function elegirConcepto(
  user: ReturnType<typeof userEvent.setup>,
  dialog: HTMLElement,
  nombre: string,
): Promise<void> {
  await elegirEnSelect(user, dialog, "Concepto del movimiento", nombre);
}

/** El nombre accesible del desplegable de tiendas, que es también su etiqueta visible. */
const COMBO_TIENDA = "Tienda a la que se le cobra";

/**
 * Elige el concepto del cobro y espera a que el catálogo de tiendas termine de cargar: mientras
 * carga, el desplegable está deshabilitado a propósito y un clic no abriría nada.
 */
async function elegirCobroYEsperarTiendas(
  user: ReturnType<typeof userEvent.setup>,
  dialog: HTMLElement,
): Promise<HTMLElement> {
  await elegirConcepto(user, dialog, "Cobrar un costo a una tienda");
  const combo = await within(dialog).findByRole("combobox", { name: COMBO_TIENDA });
  await waitFor(() => expect(combo).not.toBeDisabled());
  return combo;
}

/** El `<input type="date">` es controlado: `fireEvent.change` es la vía fiable en jsdom. */
function ponerFecha(dialog: HTMLElement, valor: string): void {
  fireEvent.change(within(dialog).getByLabelText("Fecha"), { target: { value: valor } });
}

/** Las tiendas del catálogo, EN EL ORDEN en que las devuelve el servidor (por nombre). */
const TIENDAS = [
  { id: "11111111-1111-4111-8111-111111111111", nombre: "Tienda Este" },
  { id: "22222222-2222-4222-8222-222222222222", nombre: "Tienda Norte" },
  { id: "33333333-3333-4333-8333-333333333333", nombre: "Tienda Sur" },
];

/** El resultado `ok` del cobro: el saldo vuelve NEGATIVO, con su signo derivado en el servidor. */
const COBRO_OK_NEGATIVO = {
  status: "ok",
  cobro: { id: "c1", monto: "15000.00" },
  saldo: {
    creditos: "0.00",
    debitos: "15000.00",
    saldo: "-15000.00",
    signo: "negativo",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  registrarEgresoMock.mockResolvedValue({ status: "ok", movimiento: { id: "m1" } });
  registrarManualMock.mockResolvedValue({ status: "ok", movimiento: { id: "m1" } });
  registrarCobroMock.mockResolvedValue(COBRO_OK_NEGATIVO);
  listarTiendasMock.mockResolvedValue({ status: "ok", usuarios: TIENDAS });
});

afterEach(() => {
  cleanup();
});

// ─────────────────────────────────────────────────────────────────────────────
// R3 / R11 — qué se puede elegir (y qué NO)
// ─────────────────────────────────────────────────────────────────────────────

describe("RegistrarMovimientoCajaDialog — el selector ofrece los cinco conceptos (R3 / 381-R1)", () => {
  it("ofrece gasto variable, sueldo, los dos ajustes y el cobro a una tienda, y nada más", async () => {
    const { user, dialog } = await abrirDialogo();

    await user.click(within(dialog).getByRole("combobox", { name: "Concepto del movimiento" }));
    const lista = await screen.findByRole("listbox");
    const opciones = within(lista).getAllByRole("option");

    // ⭑ FICHA 381 (R1): el quinto entra AL FINAL, y los cuatro de la 334 conservan su texto y su
    // orden (R11). La igualdad sigue siendo exacta: un sexto concepto colado la rompe.
    expect(opciones.map((o) => o.textContent?.trim())).toEqual([
      "Gasto variable",
      "Sueldo",
      "Ajuste que suma dinero",
      "Ajuste que resta dinero",
      "Cobrar un costo a una tienda",
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

    // Y con el concepto de arranque (un gasto variable) el único selector del diálogo sigue
    // siendo el del concepto: ni «Diaria» ni «Mensual» asoman por ahí, y tampoco el de la
    // tienda, que solo existe para el cobro (381-R3).
    const combos = within(dialog).getAllByRole("combobox");
    expect(combos).toHaveLength(1);
    await user.click(within(dialog).getByRole("combobox", { name: "Concepto del movimiento" }));
    const lista = await screen.findByRole("listbox");
    expect(within(lista).getAllByRole("option")).toHaveLength(5);
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
    render(
      <Envoltura>
        <RegistrarMovimientoCajaDialog onRegistrado={onRegistrado} />
      </Envoltura>,
    );

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

// ═════════════════════════════════════════════════════════════════════════════
// ⭑ FICHA 381 — el quinto concepto: cobrarle un costo a una tienda (R1–R11)
// ═════════════════════════════════════════════════════════════════════════════

describe("381 — el campo de la tienda es CONDICIONAL (R2/R3)", () => {
  it("con el cobro elegido, el diálogo pide la tienda además del monto, la fecha y el motivo (R2)", async () => {
    const { user, dialog } = await abrirDialogo();
    await elegirCobroYEsperarTiendas(user, dialog);

    expect(within(dialog).getByLabelText(COMBO_TIENDA)).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Monto")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Fecha")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Motivo del cobro")).toBeInTheDocument();
    // Ahora sí hay DOS desplegables: el del concepto y el de la tienda.
    expect(within(dialog).getAllByRole("combobox")).toHaveLength(2);
  }, 15000);

  it("con cualquiera de los otros CUATRO conceptos no hay campo de tienda (R3)", async () => {
    const { user, dialog } = await abrirDialogo();

    for (const nombre of [
      "Gasto variable",
      "Sueldo",
      "Ajuste que suma dinero",
      "Ajuste que resta dinero",
    ]) {
      await elegirConcepto(user, dialog, nombre);
      expect(
        within(dialog).queryByLabelText(COMBO_TIENDA),
        `«${nombre}» monta el campo de la tienda`,
      ).not.toBeInTheDocument();
      expect(within(dialog).getAllByRole("combobox")).toHaveLength(1);
    }

    // Y el campo VUELVE al elegir el cobro: sin esta mitad, un diálogo que nunca lo montara
    // pasaría el barrido de arriba.
    await elegirCobroYEsperarTiendas(user, dialog);
    expect(within(dialog).getByLabelText(COMBO_TIENDA)).toBeInTheDocument();
  }, 20000);

  it("elegir el cobro y volver atrás no deja ninguna clave de tienda en el payload (R3)", async () => {
    const { user, dialog } = await abrirDialogo();

    // Se elige el cobro, se elige una tienda de verdad… y luego se cambia de idea.
    await elegirCobroYEsperarTiendas(user, dialog);
    await elegirEnSelect(user, dialog, COMBO_TIENDA, "Tienda Sur");
    await elegirConcepto(user, dialog, "Ajuste que resta dinero");

    await user.type(within(dialog).getByLabelText("Monto"), "12.75");
    await user.type(within(dialog).getByLabelText("Motivo del ajuste"), "Faltante de caja");
    await user.click(within(dialog).getByRole("button", { name: "Registrar" }));

    expect(registrarCobroMock).not.toHaveBeenCalled();
    expect(registrarManualMock.mock.calls[0][0]).toEqual({
      tipo: "egreso",
      categoria: "egreso_ajuste",
      monto: "12.75",
      descripcion: "Faltante de caja",
    });
  }, 20000);
});

describe("381 — el diálogo dice a qué LIBRO va el cobro y con qué nombre (R4)", () => {
  it("la línea de ayuda y el título nombran el libro de la tienda, no la caja", async () => {
    const { user, dialog } = await abrirDialogo();

    // Arranque: los textos de la ficha 334, byte a byte (R11).
    expect(
      within(dialog).getByText("Se registra en el libro como «Gasto variable»."),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("Registrar movimiento en la caja")).toBeInTheDocument();

    await elegirCobroYEsperarTiendas(user, dialog);

    // «Cobro de Ordenex» es exactamente el rótulo con el que la tienda lo va a leer en su
    // propia wallet: el diálogo no promete un nombre distinto del que el libro usa.
    expect(
      within(dialog).getByText("Se registra en el libro de la tienda como «Cobro de Ordenex»."),
    ).toBeInTheDocument();
    // Y la cabecera deja de decir «en la caja», que para este concepto sería falso. Se busca por
    // ROL: el mismo texto aparece también dentro del selector (es el concepto elegido), y lo que
    // se mide aquí es el TÍTULO del diálogo.
    expect(
      within(dialog).getByRole("heading", { name: "Cobrar un costo a una tienda" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByText("Registrar movimiento en la caja"),
    ).not.toBeInTheDocument();
  }, 15000);
});

describe("381 — el catálogo de tiendas (R5)", () => {
  it("ofrece las tiendas que devuelve el servidor, EN SU ORDEN y sin reordenarlas", async () => {
    const { user, dialog } = await abrirDialogo();
    const combo = await elegirCobroYEsperarTiendas(user, dialog);

    await user.click(combo);
    const lista = await screen.findByRole("listbox");
    // El orden determinista lo pone el SERVIDOR (`listarAdminTiendas` ordena por nombre). Si la
    // pantalla reordenara por su cuenta, aquí se vería: el orden de `TIENDAS` es el que manda.
    expect(within(lista).getAllByRole("option").map((o) => o.textContent?.trim())).toEqual(
      TIENDAS.map((t) => t.nombre),
    );
  }, 15000);

  it("no pide el catálogo hasta que alguien abre el diálogo", async () => {
    render(
      <Envoltura>
        <RegistrarMovimientoCajaDialog />
      </Envoltura>,
    );
    // Pintar el botón de la barra no puede costar una lectura de tiendas en cada carga de
    // `/wallet`: el catálogo se pide AL ABRIR (R5).
    expect(listarTiendasMock).not.toHaveBeenCalled();

    await userEvent.setup().click(screen.getByRole("button", { name: "Registrar movimiento" }));
    await waitFor(() => expect(listarTiendasMock).toHaveBeenCalled());
  }, 15000);
});

describe("381 — el catálogo caído bloquea el COBRO y solo el cobro (R6)", () => {
  it.each([
    [
      "la action responde `forbidden`",
      () => listarTiendasMock.mockResolvedValue({ status: "forbidden" }),
    ],
    ["la action revienta", () => listarTiendasMock.mockRejectedValue(new Error("caída de red"))],
  ])(
    "%s → se dice, no se puede registrar el cobro, y los otros cuatro siguen (R6)",
    async (_caso, preparar) => {
      preparar();
      const { user, dialog } = await abrirDialogo();
      await elegirConcepto(user, dialog, "Cobrar un costo a una tienda");

      // (a) SE DICE. La degradación es RUIDOSA: al revés que la de `GenerarApiKeyForm`, aquí la
      // tienda es obligatoria y un desplegable vacío sin explicación dejaría a alguien pulsando
      // «Registrar» sin entender por qué no pasa nada.
      const aviso = await within(dialog).findByRole("alert");
      expect(aviso.textContent).toMatch(/No se pudo cargar la lista de tiendas/);

      // (b) NO se puede registrar el cobro.
      const registrar = within(dialog).getByRole("button", { name: "Registrar" });
      await waitFor(() => expect(registrar).toBeDisabled());

      // (c) …y los otros cuatro conceptos SIGUEN registrándose. Sin esta tercera parte, un
      // diálogo que se bloqueara entero pasaría las dos primeras.
      await elegirConcepto(user, dialog, "Ajuste que suma dinero");
      expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
      await user.type(within(dialog).getByLabelText("Monto"), "40.00");
      await user.type(within(dialog).getByLabelText("Motivo del ajuste"), "Sobrante de caja");
      await user.click(within(dialog).getByRole("button", { name: "Registrar" }));

      expect(registrarManualMock).toHaveBeenCalledTimes(1);
      expect(registrarCobroMock).not.toHaveBeenCalled();
    },
    20000,
  );
});

describe("381 — confirmar sin tienda no llama a nadie (R7)", () => {
  it("señala el fallo bajo el campo de la tienda y NO registra nada", async () => {
    const { user, dialog } = await abrirDialogo();
    await elegirCobroYEsperarTiendas(user, dialog);

    await user.type(within(dialog).getByLabelText("Monto"), "15000.00");
    await user.type(within(dialog).getByLabelText("Motivo del cobro"), "Material de despacho");
    await user.click(within(dialog).getByRole("button", { name: "Registrar" }));

    expect(registrarCobroMock).not.toHaveBeenCalled();
    expect(registrarEgresoMock).not.toHaveBeenCalled();
    expect(registrarManualMock).not.toHaveBeenCalled();

    const mensaje = within(dialog).getByText("Elegí la tienda a la que se le cobra.");
    expect(mensaje).toBeInTheDocument();
    // Bajo SU campo: el error lleva el id que el desplegable referencia por `aria-describedby`.
    const campo = within(dialog).getByLabelText(COMBO_TIENDA);
    expect(campo).toHaveAttribute("aria-invalid", "true");
    expect(campo.getAttribute("aria-describedby")).toContain("movimiento-tienda-error");
  }, 15000);

  it("elegir la tienda limpia el error y entonces sí registra", async () => {
    const { user, dialog } = await abrirDialogo();
    await elegirCobroYEsperarTiendas(user, dialog);
    await user.type(within(dialog).getByLabelText("Monto"), "15000.00");
    await user.type(within(dialog).getByLabelText("Motivo del cobro"), "Despacho");
    await user.click(within(dialog).getByRole("button", { name: "Registrar" }));
    expect(registrarCobroMock).not.toHaveBeenCalled();

    await elegirEnSelect(user, dialog, COMBO_TIENDA, "Tienda Sur");
    expect(
      within(dialog).queryByText("Elegí la tienda a la que se le cobra."),
    ).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Registrar" }));
    await waitFor(() => expect(registrarCobroMock).toHaveBeenCalledTimes(1));
  }, 20000);
});

describe("381 — el payload del cobro lleva SOLO lo que decide el usuario (R2/R18/R21)", () => {
  it("tienda, monto STRING y motivo; sin fecha si no se tocó, y sin tipo ni categoría", async () => {
    const { user, dialog } = await abrirDialogo();
    await elegirCobroYEsperarTiendas(user, dialog);
    await elegirEnSelect(user, dialog, COMBO_TIENDA, "Tienda Sur");

    await user.type(within(dialog).getByLabelText("Monto"), "15000.00");
    await user.type(within(dialog).getByLabelText("Motivo del cobro"), "Material de despacho");
    await user.click(within(dialog).getByRole("button", { name: "Registrar" }));

    await waitFor(() => expect(registrarCobroMock).toHaveBeenCalledTimes(1));
    const payload = registrarCobroMock.mock.calls[0][0] as Record<string, unknown>;
    // `toEqual` literal, y ES el contrato: el schema del borde es `.strict()`, así que una
    // clave de más —`tipo`, `categoria`, `registradoPor`, `origenTipo`— sería un
    // `validation_error` en producción. El monto viaja como STRING, con sus dos decimales.
    expect(payload).toEqual({
      tiendaId: TIENDAS[2].id,
      monto: "15000.00",
      descripcion: "Material de despacho",
    });
    expect(Object.keys(payload).sort()).toEqual(["descripcion", "monto", "tiendaId"]);
    expect(typeof payload.monto).toBe("string");
    // R21: sin tocar la fecha, la clave NO viaja y manda el instante del registro.
    expect("fecha" in payload).toBe(false);
    // Y no se toca ninguna de las dos actions de la CAJA (R24: el cobro no la mueve).
    expect(registrarEgresoMock).not.toHaveBeenCalled();
    expect(registrarManualMock).not.toHaveBeenCalled();
  }, 20000);

  it("si se elige un día anterior, la fecha viaja tal cual como texto YYYY-MM-DD", async () => {
    const { user, dialog } = await abrirDialogo();
    await elegirCobroYEsperarTiendas(user, dialog);
    await elegirEnSelect(user, dialog, COMBO_TIENDA, "Tienda Norte");

    const ayer = diasAntesEnCostaRica(1);
    ponerFecha(dialog, ayer);
    await user.type(within(dialog).getByLabelText("Monto"), "0.01");
    await user.type(within(dialog).getByLabelText("Motivo del cobro"), "Un céntimo de ayer");
    await user.click(within(dialog).getByRole("button", { name: "Registrar" }));

    await waitFor(() => expect(registrarCobroMock).toHaveBeenCalledTimes(1));
    expect(registrarCobroMock.mock.calls[0][0]).toEqual({
      tiendaId: TIENDAS[1].id,
      monto: "0.01",
      descripcion: "Un céntimo de ayer",
      fecha: ayer,
    });
  }, 20000);
});

describe("381 — dos clics seguidos registran UN solo cobro (R8)", () => {
  it("mientras la confirmación está en curso, el diálogo no admite una segunda", async () => {
    let liberar: (valor: unknown) => void = () => {};
    registrarCobroMock.mockReturnValue(
      new Promise((resolve) => {
        liberar = resolve;
      }),
    );

    const { user, dialog } = await abrirDialogo();
    await elegirCobroYEsperarTiendas(user, dialog);
    await elegirEnSelect(user, dialog, COMBO_TIENDA, "Tienda Este");
    await user.type(within(dialog).getByLabelText("Monto"), "100.00");
    await user.type(within(dialog).getByLabelText("Motivo del cobro"), "Doble clic");

    // `fireEvent` y no `userEvent`: el segundo clic cae sobre un botón ya deshabilitado, y lo
    // que se mide es que el manejador NO vuelve a llamar a la action.
    const boton = within(dialog).getByRole("button", { name: "Registrar" });
    fireEvent.click(boton);
    fireEvent.click(boton);

    expect(registrarCobroMock).toHaveBeenCalledTimes(1);

    liberar(COBRO_OK_NEGATIVO);
    await waitFor(() => expect(successMock).toHaveBeenCalled());
    expect(registrarCobroMock).toHaveBeenCalledTimes(1);
  }, 20000);
});

describe("381 — cuando el cobro sale bien (R9/R27)", () => {
  it("avisa con el saldo que devolvió el servidor, EN NEGATIVO y sin recortarlo", async () => {
    const onRegistrado = vi.fn();
    const user = userEvent.setup();
    render(
      <Envoltura>
        <RegistrarMovimientoCajaDialog onRegistrado={onRegistrado} />
      </Envoltura>,
    );
    await user.click(screen.getByRole("button", { name: "Registrar movimiento" }));
    const dialog = await screen.findByRole("dialog");

    await elegirCobroYEsperarTiendas(user, dialog);
    await elegirEnSelect(user, dialog, COMBO_TIENDA, "Tienda Sur");
    await user.type(within(dialog).getByLabelText("Monto"), "15000.00");
    await user.type(within(dialog).getByLabelText("Motivo del cobro"), "Despacho");
    await user.click(within(dialog).getByRole("button", { name: "Registrar" }));

    await waitFor(() => expect(successMock).toHaveBeenCalledTimes(1));
    const aviso = successMock.mock.calls[0][0] as string;
    // ⚠️ EL NEGATIVO ES LO PEDIDO. El saldo llega del servidor como el STRING `-15000.00` y se
    // pinta tal cual: con su signo, sin valor absoluto y sin recortarlo a cero. Y la marca
    // legible («En contra») es la MISMA que usan las dos pantallas de saldo.
    expect(aviso).toBe("Cobro registrado. El saldo de Tienda Sur queda en -₡15.000 · En contra.");
    expect(aviso).toContain("-₡15.000");
    expect(aviso).not.toMatch(/insuficiente|no alcanza|sin saldo/i);

    // R9: se cierra y la pantalla vuelve a leer sus datos.
    expect(onRegistrado).toHaveBeenCalledTimes(1);
    expect(refreshMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  }, 20000);

  it("un cobro que deja el saldo A FAVOR se anuncia con su signo y su marca (control positivo)", async () => {
    registrarCobroMock.mockResolvedValue({
      status: "ok",
      cobro: { id: "c2", monto: "500.00" },
      saldo: {
        creditos: "9500.00",
        debitos: "500.00",
        saldo: "9000.00",
        signo: "positivo",
      },
    });
    const { user, dialog } = await abrirDialogo();
    await elegirCobroYEsperarTiendas(user, dialog);
    await elegirEnSelect(user, dialog, COMBO_TIENDA, "Tienda Norte");
    await user.type(within(dialog).getByLabelText("Monto"), "500.00");
    await user.type(within(dialog).getByLabelText("Motivo del cobro"), "Despacho");
    await user.click(within(dialog).getByRole("button", { name: "Registrar" }));

    await waitFor(() => expect(successMock).toHaveBeenCalledTimes(1));
    // Sin este segundo caso, un aviso que dijera SIEMPRE «En contra» pasaría el anterior.
    expect(successMock.mock.calls[0][0]).toBe(
      "Cobro registrado. El saldo de Tienda Norte queda en ₡9.000 · A favor.",
    );
  }, 20000);
});

describe("381 — cuando el servidor rechaza el cobro (R10)", () => {
  it("lo tecleado sobrevive y el motivo va bajo el campo de la tienda", async () => {
    registrarCobroMock.mockResolvedValue({
      status: "validation_error",
      fieldErrors: { tiendaId: ["La tienda no esta activa"] },
    });
    const { user, dialog } = await abrirDialogo();
    await elegirCobroYEsperarTiendas(user, dialog);
    await elegirEnSelect(user, dialog, COMBO_TIENDA, "Tienda Sur");
    await user.type(within(dialog).getByLabelText("Monto"), "15000.00");
    await user.type(within(dialog).getByLabelText("Motivo del cobro"), "Material de despacho");
    await user.click(within(dialog).getByRole("button", { name: "Registrar" }));

    // El texto es el que REDACTA el borde; la pantalla no lo reescribe.
    const mensaje = await within(dialog).findByText("La tienda no esta activa");
    expect(mensaje).toBeInTheDocument();
    const campo = within(dialog).getByLabelText(COMBO_TIENDA);
    expect(campo).toHaveAttribute("aria-invalid", "true");
    expect(campo.getAttribute("aria-describedby")).toContain("movimiento-tienda-error");

    // R10: el diálogo sigue abierto y NADA de lo tecleado se ha perdido.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect((within(dialog).getByLabelText("Monto") as HTMLInputElement).value).toBe("15000.00");
    expect(
      (within(dialog).getByLabelText("Motivo del cobro") as HTMLTextAreaElement).value,
    ).toBe("Material de despacho");
  }, 20000);

  it("el rechazo por MONTO del cobro se pinta bajo el monto, no bajo la tienda", async () => {
    registrarCobroMock.mockResolvedValue({
      status: "validation_error",
      fieldErrors: { monto: ["El monto debe ser un numero con hasta 2 decimales."] },
    });
    const { user, dialog } = await abrirDialogo();
    await elegirCobroYEsperarTiendas(user, dialog);
    await elegirEnSelect(user, dialog, COMBO_TIENDA, "Tienda Sur");
    await user.type(within(dialog).getByLabelText("Monto"), "15000.00");
    await user.type(within(dialog).getByLabelText("Motivo del cobro"), "Despacho");
    await user.click(within(dialog).getByRole("button", { name: "Registrar" }));

    await within(dialog).findByText("El monto debe ser un numero con hasta 2 decimales.");
    expect(within(dialog).getByLabelText("Monto")).toHaveAttribute("aria-invalid", "true");
    // Y la tienda NO se marca: cada motivo va bajo el campo que lo produce.
    expect(within(dialog).getByLabelText(COMBO_TIENDA)).not.toHaveAttribute("aria-invalid");
  }, 20000);
});
