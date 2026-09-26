// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { SWRConfig } from "swr";

import { elegirEnSelector } from "@/tests/fixtures/selector-buscable";

// =================================================================================================
// FICHA 458-C (T C.1–C.3, design §4.1/§4.4/§5.1) — EL DIÁLOGO ÚNICO «REGISTRAR UN MOVIMIENTO»
// =================================================================================================
//
// REESCRITO: sustituye al test de `RegistrarMovimientoCajaDialog` (334/381/459/461/457), que se borra
// con su componente. Cada bloque de aquel archivo está listado en `progress/impl_458-C.md` con el caso
// y el requisito que lo sustituyen aquí; ninguno desaparece sin reemplazo.
//
// Lo que se mide, y por qué es falsable:
//  - R37/R38: los DIEZ conceptos en los TRES grupos de la 461 y el enlace a las plantillas; el gasto
//    fijo no se ofrece.
//  - R39: cada concepto manda un `FormData` con EXACTAMENTE sus claves (se afirma la lista entera, así
//    que una clave de más o de menos cae) y su frase de efecto; las siete de la 461 byte a byte.
//  - R40/R41: la cuenta con buscador por nombre, la lista pedida AL ABRIR y solo la del tipo de cuenta
//    del concepto; con la cuenta fija no se pide nada.
//  - R42 (D5): «a quién» obligatorio en sueldo y gasto (sin él no se llama al servidor), opcional en la
//    corrección.
//  - R44–R47: «Así queda» se pide al SERVIDOR con retardo y solo con monto (y cuenta); cargando y error
//    sin cifras; «no cambia»; el aviso de saldo en contra lo decide el servidor.
//  - R48/R49/R51/R52, R74–R76.
//
// El monto se mide como STRING exacto en todos los envíos (R90): ni `Number(` ni `parseFloat`.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const registrarEgresoMock = vi.fn();
const registrarManualMock = vi.fn();
const registrarCobroMock = vi.fn();
const registrarPagoPorCuentaMock = vi.fn();
const registrarAporteMock = vi.fn();
const registrarAbonoMock = vi.fn();
const registrarPagoTiendaMock = vi.fn();
const registrarRepartoMock = vi.fn();
const listarTiendasMock = vi.fn();
const listarPorRolMock = vi.fn();
const previsualizarMock = vi.fn();

vi.mock("@/lib/actions/wallet-egresos", () => ({
  registrarEgresoAdministrativoAction: (...a: unknown[]) => registrarEgresoMock(...a),
}));
vi.mock("@/lib/actions/wallet", () => ({
  registrarMovimientoManualAction: (...a: unknown[]) => registrarManualMock(...a),
}));
vi.mock("@/lib/actions/wallet-tienda", () => ({
  registrarCobroTiendaAction: (...a: unknown[]) => registrarCobroMock(...a),
}));
vi.mock("@/lib/actions/pago-por-cuenta-tienda", () => ({
  registrarPagoPorCuentaTiendaAction: (...a: unknown[]) => registrarPagoPorCuentaMock(...a),
}));
vi.mock("@/lib/actions/aporte-capital", () => ({
  registrarAporteCapitalAction: (...a: unknown[]) => registrarAporteMock(...a),
}));
vi.mock("@/lib/actions/abono-tienda", () => ({
  registrarAbonoTiendaAction: (...a: unknown[]) => registrarAbonoMock(...a),
}));
vi.mock("@/lib/actions/liquidacion", () => ({
  registrarPagoTiendaAction: (...a: unknown[]) => registrarPagoTiendaMock(...a),
  registrarRepartoMensajeroAction: (...a: unknown[]) => registrarRepartoMock(...a),
}));
vi.mock("@/lib/actions/usuarios-por-rol", () => ({
  listarAdminTiendas: (...a: unknown[]) => listarTiendasMock(...a),
  listarUsuariosPorRol: (...a: unknown[]) => listarPorRolMock(...a),
}));
vi.mock("@/lib/actions/efecto-movimiento", () => ({
  previsualizarMovimientoAction: (...a: unknown[]) => previsualizarMock(...a),
}));

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, push: vi.fn() }),
}));

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

import { RegistrarMovimientoDialog } from "@/components/shared/wallet/RegistrarMovimientoDialog";

/** El día calendario de Costa Rica, calculado AQUÍ (UTC−6 todo el año), no con la función del componente. */
function hoyEnCostaRica(): string {
  return new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
function diasAntesEnCostaRica(dias: number): string {
  return new Date(Date.now() - 6 * 60 * 60 * 1000 - dias * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
function diasDespuesEnCostaRica(dias: number): string {
  return new Date(Date.now() - 6 * 60 * 60 * 1000 + dias * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function Envoltura({ children }: { children: ReactNode }) {
  return <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>;
}

type Props = Parameters<typeof RegistrarMovimientoDialog>[0];

async function abrir(props: Props = {}, boton = "Registrar un movimiento") {
  const user = userEvent.setup();
  render(
    <Envoltura>
      <RegistrarMovimientoDialog {...props} />
    </Envoltura>,
  );
  await user.click(screen.getByRole("button", { name: boton }));
  const dialog = await screen.findByRole("dialog");
  return { user, dialog };
}

async function elegirConcepto(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, nombre: string) {
  await user.click(within(dialog).getByRole("radio", { name: nombre }));
}

function escribir(dialog: HTMLElement, etiqueta: RegExp, valor: string) {
  fireEvent.change(within(dialog).getByLabelText(etiqueta), { target: { value: valor } });
}

/** Elige la cuenta en su buscador, por el NOMBRE (nunca por el id), esperando a que la lista cargue. */
async function elegirCuenta(dialog: HTMLElement, etiqueta: string, nombre: string) {
  const disparador = within(dialog).getByRole("button", { name: new RegExp(`^${etiqueta}:`) });
  await waitFor(() => expect(disparador).not.toBeDisabled());
  await elegirEnSelector(disparador, nombre);
}

async function elegirMetodo(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, metodo: string) {
  await user.click(within(dialog).getByRole("combobox", { name: "Método de pago" }));
  const lista = await screen.findByRole("listbox");
  await user.click(within(lista).getByRole("option", { name: metodo }));
}

async function confirmar(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) {
  await user.click(within(dialog).getByRole("button", { name: "Registrar" }));
}

/** Las claves y valores del `FormData` enviado (el archivo, por su nombre). */
function entradas(fd: unknown): Record<string, string> {
  expect(fd).toBeInstanceOf(FormData);
  const salida: Record<string, string> = {};
  for (const [k, v] of (fd as FormData).entries()) salida[k] = typeof v === "string" ? v : `archivo:${v.name}`;
  return salida;
}

const TIENDAS = [
  { id: "11111111-1111-4111-8111-111111111111", nombre: "Tienda Este" },
  { id: "22222222-2222-4222-8222-222222222222", nombre: "Tienda Norte" },
];
const NORTE = TIENDAS[1].id;
const MENSAJEROS = [{ id: "33333333-3333-4333-8333-333333333333", nombre: "Juan Pérez Mora" }];
const JUAN = MENSAJEROS[0].id;

const SALDO_NEGATIVO = { creditos: "0.00", debitos: "15000.00", saldo: "-15000.00", signo: "negativo" };

function linea(antes: string, despues: string) {
  return { antes, despues, cambia: antes !== despues };
}

/** Un efecto de ejemplo: un sueldo de 25 000 sobre una caja de 100 000 (cifras escritas a mano). */
const EFECTO_SUELDO = {
  status: "ok",
  efecto: {
    lineas: {
      cuenta: null,
      cifraPrincipal: { ...linea("100000.00", "75000.00"), rotulo: "flujo" },
      ganancia: linea("40000.00", "15000.00"),
      deTiendas: linea("60000.00", "60000.00"),
      capital: linea("0.00", "0.00"),
    },
    saldoEnContra: false,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  registrarEgresoMock.mockResolvedValue({ status: "ok", movimiento: { id: "m1" } });
  registrarManualMock.mockResolvedValue({ status: "ok", movimiento: { id: "m1" } });
  registrarCobroMock.mockResolvedValue({ status: "ok", cobro: { id: "c1" }, saldo: SALDO_NEGATIVO });
  registrarPagoPorCuentaMock.mockResolvedValue({
    status: "ok",
    pago: { id: "p1", tiendaNombre: "Tienda Norte", monto: "10000.00" },
    saldo: { ...SALDO_NEGATIVO, saldo: "-10000.00" },
  });
  registrarAporteMock.mockResolvedValue({ status: "ok", aporte: { id: "a1", clase: "aporte", monto: "5000.00" } });
  registrarAbonoMock.mockResolvedValue({
    status: "ok",
    abono: { id: "ab1", tiendaNombre: "Tienda Norte", monto: "4000.00" },
    saldo: { creditos: "4000.00", debitos: "10000.00", saldo: "-6000.00", signo: "negativo" },
  });
  registrarPagoTiendaMock.mockResolvedValue({
    status: "ok",
    pago: { id: "lp1", monto: "3000.00" },
    restante: "7000.00",
  });
  registrarRepartoMock.mockResolvedValue({
    status: "ok",
    reparto: { totalImputado: "8000.00", restanteImputable: "2000.00", imputaciones: [] },
  });
  listarTiendasMock.mockResolvedValue({ status: "ok", usuarios: TIENDAS });
  listarPorRolMock.mockResolvedValue({ status: "ok", usuarios: MENSAJEROS });
  previsualizarMock.mockResolvedValue(EFECTO_SUELDO);
});

afterEach(() => cleanup());

// ─── R37 / R38 — el catálogo ─────────────────────────────────────────────────────────────────────

describe("458-C R37/R38 — el catálogo: diez conceptos en tres grupos y el enlace a las plantillas", () => {
  it("cada grupo es un grupo de opciones con su nombre, y dentro están sus conceptos en orden", async () => {
    const { dialog } = await abrir();
    const nombres = (grupo: string) =>
      within(within(dialog).getByRole("radiogroup", { name: grupo }))
        .getAllByRole("radio")
        .map((r) => r.closest("label")?.textContent);
    expect(nombres("Sale dinero de Ordenex")).toEqual([
      "Gasto de Ordenex",
      "Sueldo",
      "Ordenex paga un gasto de una tienda",
      "Corrección de caja (resta)",
      "Ordenex le paga a una tienda",
      "Ordenex le paga a un mensajero",
    ]);
    expect(nombres("Llega dinero a la caja")).toEqual([
      "Aporte de dinero a la caja",
      "Una tienda le paga a Ordenex",
      "Corrección de caja (suma)",
    ]);
    expect(nombres("Se descuenta del saldo de una tienda")).toEqual(["Ordenex le cobra a una tienda"]);
    expect(within(dialog).getAllByRole("radio")).toHaveLength(10);
  });

  it("R38: no se ofrece «Gasto fijo»; el enlace lleva a las plantillas", async () => {
    const { dialog } = await abrir();
    expect(within(dialog).queryByRole("radio", { name: /gasto fijo/i })).toBeNull();
    const enlace = within(dialog).getByRole("link", { name: "Ver las plantillas de gasto fijo" });
    expect(enlace.getAttribute("href")).toBe("/wallet#gastos-fijos");
  });

  it("abre con el gasto de Ordenex elegido (el primero) y sin pedir ninguna lista", async () => {
    const { dialog } = await abrir();
    expect(within(dialog).getByRole("radio", { name: "Gasto de Ordenex" })).toBeChecked();
    expect(listarTiendasMock).not.toHaveBeenCalled();
    expect(listarPorRolMock).not.toHaveBeenCalled();
  });
});

// ─── R39 / R52 — frase de efecto y frase del libro ───────────────────────────────────────────────

describe("458-C R39/R52 — la frase del efecto y la del libro siguen al concepto", () => {
  it("las siete frases de la 461 salen byte a byte y las nuevas con la suya", async () => {
    const { user, dialog } = await abrir();
    const casos: Array<[string, string]> = [
      ["Gasto de Ordenex", "Sale dinero de Ordenex y baja su ganancia."],
      ["Sueldo", "Sale dinero de Ordenex para pagar un sueldo y baja su ganancia."],
      [
        "Ordenex paga un gasto de una tienda",
        "Sale dinero de Ordenex hacia un tercero (Facebook, Jet Cargo…) y se descuenta del saldo de la tienda; la ganancia no cambia.",
      ],
      ["Corrección de caja (resta)", "Sale dinero de la caja para corregir un descuadre y baja la ganancia de Ordenex."],
      ["Aporte de dinero a la caja", "Llega dinero de Ordenex a la caja; no es ganancia, la ganancia no cambia."],
      ["Corrección de caja (suma)", "Llega dinero a la caja para corregir un descuadre y sube la ganancia de Ordenex."],
      [
        "Ordenex le cobra a una tienda",
        "No llega dinero nuevo: se descuenta del saldo a favor de la tienda y pasa a ser ganancia de Ordenex; si la tienda no tiene saldo, queda en contra.",
      ],
      [
        "Una tienda le paga a Ordenex",
        "Llega dinero de la tienda a la caja: paga lo que debe y su saldo sube; la ganancia de Ordenex no cambia.",
      ],
      [
        "Ordenex le paga a una tienda",
        "Sale dinero de Ordenex hacia la tienda y baja lo que Ordenex le debe; la ganancia no cambia.",
      ],
      [
        "Ordenex le paga a un mensajero",
        "Ordenex le paga al mensajero lo que le debe por sus cierres y baja su cuenta por pagar; la ganancia no cambia.",
      ],
    ];
    for (const [concepto, frase] of casos) {
      await elegirConcepto(user, dialog, concepto);
      expect(dialog.querySelector("#movimiento-concepto-efecto")?.textContent, concepto).toBe(frase);
    }
  });

  it("R52: dice en qué libro cae y con qué nombre, también en los dos pagos nuevos", async () => {
    const { user, dialog } = await abrir();
    const libro = () => dialog.querySelector("#movimiento-concepto-libro")?.textContent;
    expect(libro()).toBe("Se registra en el libro como «Gasto de Ordenex».");
    await elegirConcepto(user, dialog, "Ordenex le paga a una tienda");
    expect(libro()).toBe(
      "Se registra en la caja como «Ordenex le paga a una tienda» y en el libro de la tienda como «Ordenex le paga a la tienda».",
    );
    await elegirConcepto(user, dialog, "Ordenex le paga a un mensajero");
    expect(libro()).toBe("Se registra en el libro del mensajero como «Liquidación».");
  });

  it("la cabecera: la de la caja para los que van solo a la caja; el nombre del concepto para los demás", async () => {
    const { user, dialog } = await abrir();
    expect(within(dialog).getByText("Registrar movimiento en la caja")).toBeTruthy();
    await elegirConcepto(user, dialog, "Ordenex le cobra a una tienda");
    expect(within(dialog).getByRole("heading", { name: "Ordenex le cobra a una tienda" })).toBeTruthy();
  });
});

// ─── R39 / R42 / R43 / R51 — los campos y el FormData de cada concepto ───────────────────────────

describe("458-C R39/R42/R43/R51 — cada concepto pide sus campos y manda SOLO sus claves", () => {
  it("sueldo: a quién (obligatorio), monto, fecha, motivo, referencia y comprobante opcionales", async () => {
    const { user, dialog } = await abrir();
    await elegirConcepto(user, dialog, "Sueldo");
    escribir(dialog, /^A quién se le pagó/, "  María Solano  ");
    escribir(dialog, /^Monto/, "125000.50");
    escribir(dialog, /^Trabajador y periodo/, "Sueldo de septiembre");
    escribir(dialog, /^Referencia \(opcional\)/, "SINPE 8899");
    await confirmar(user, dialog);
    await waitFor(() => expect(registrarEgresoMock).toHaveBeenCalledTimes(1));
    const fd = entradas(registrarEgresoMock.mock.calls[0][0]);
    expect(Object.keys(fd).sort()).toEqual(
      ["claveIdempotencia", "contraparteNombre", "descripcion", "monto", "referencia", "tipoEgreso"].sort(),
    );
    expect(fd).toMatchObject({
      tipoEgreso: "sueldo",
      monto: "125000.50",
      descripcion: "Sueldo de septiembre",
      contraparteNombre: "María Solano",
      referencia: "SINPE 8899",
    });
    expect(fd.claveIdempotencia).toMatch(UUID);
  });

  it("R42 (D5): sin «a quién» el sueldo y el gasto NO llaman al servidor y el motivo va bajo el campo", async () => {
    const { user, dialog } = await abrir();
    escribir(dialog, /^Monto/, "100");
    escribir(dialog, /^Concepto del gasto/, "Papelería");
    await confirmar(user, dialog);
    expect(await within(dialog).findByText("Escribí a quién se le pagó.")).toBeTruthy();
    await elegirConcepto(user, dialog, "Sueldo");
    await confirmar(user, dialog);
    expect(registrarEgresoMock).not.toHaveBeenCalled();
    expect(within(dialog).getByLabelText(/^A quién se le pagó/).getAttribute("aria-invalid")).toBe("true");
  });

  it("R42: en la corrección «a quién» es opcional; sin él no viaja la clave", async () => {
    const { user, dialog } = await abrir();
    await elegirConcepto(user, dialog, "Corrección de caja (suma)");
    expect(within(dialog).getByLabelText(/^A quién \(opcional\)/)).toBeTruthy();
    escribir(dialog, /^Monto/, "50");
    escribir(dialog, /^Motivo de la corrección/, "Sobrante al cuadrar");
    await confirmar(user, dialog);
    await waitFor(() => expect(registrarManualMock).toHaveBeenCalledTimes(1));
    const fd = entradas(registrarManualMock.mock.calls[0][0]);
    expect(Object.keys(fd).sort()).toEqual(["categoria", "claveIdempotencia", "descripcion", "monto", "tipo"].sort());
    expect(fd).toMatchObject({ tipo: "ingreso", categoria: "ingreso_ajuste", monto: "50" });
  });

  it("cobro a una tienda: tienda, monto, motivo; el FormData sin tipo ni categoría", async () => {
    const { user, dialog } = await abrir();
    await elegirConcepto(user, dialog, "Ordenex le cobra a una tienda");
    await elegirCuenta(dialog, "Tienda a la que se le cobra", "Tienda Norte");
    escribir(dialog, /^Monto/, "15000");
    escribir(dialog, /^Motivo del cobro/, "Material de despacho");
    await confirmar(user, dialog);
    await waitFor(() => expect(registrarCobroMock).toHaveBeenCalledTimes(1));
    const fd = entradas(registrarCobroMock.mock.calls[0][0]);
    expect(Object.keys(fd).sort()).toEqual(["claveIdempotencia", "descripcion", "monto", "tiendaId"].sort());
    expect(fd.tiendaId).toBe(NORTE);
    // R48: el aviso lleva el saldo del SERVIDOR, en negativo, y dice que la tienda le debe a Ordenex.
    expect(successMock).toHaveBeenCalledWith(
      "Cobro registrado. El saldo de Tienda Norte queda en -₡15.000 · En contra. La tienda le debe ese dinero a Ordenex.",
    );
  });

  it("pago de un gasto de una tienda: tienda, beneficiario, método, referencia con SINPE y motivo", async () => {
    const { user, dialog } = await abrir();
    await elegirConcepto(user, dialog, "Ordenex paga un gasto de una tienda");
    await elegirCuenta(dialog, "Tienda por la que se paga", "Tienda Norte");
    escribir(dialog, /^A quién se le pagó/, "Facebook");
    escribir(dialog, /^Monto/, "10000");
    escribir(dialog, /^Motivo del pago/, "Pauta");
    await elegirMetodo(user, dialog, "SINPE");
    escribir(dialog, /^Referencia/, "REF-1");
    await confirmar(user, dialog);
    await waitFor(() => expect(registrarPagoPorCuentaMock).toHaveBeenCalledTimes(1));
    const fd = entradas(registrarPagoPorCuentaMock.mock.calls[0][0]);
    expect(Object.keys(fd).sort()).toEqual(
      ["beneficiario", "claveIdempotencia", "metodo", "monto", "motivo", "referencia", "tiendaId"].sort(),
    );
    expect(fd).toMatchObject({ beneficiario: "Facebook", metodo: "SINPE", referencia: "REF-1", tiendaId: NORTE });
  });

  it("aporte: clase, monto (vacío al abrir, sin ejemplo), fecha SIEMPRE y motivo", async () => {
    const { user, dialog } = await abrir();
    await elegirConcepto(user, dialog, "Aporte de dinero a la caja");
    const monto = within(dialog).getByLabelText(/^Monto/) as HTMLInputElement;
    expect(monto.value).toBe("");
    expect(monto.getAttribute("placeholder")).toBeNull();
    await user.click(within(dialog).getByRole("radio", { name: /^Aporte de capital/ }));
    escribir(dialog, /^Monto/, "5000");
    escribir(dialog, /^Motivo/, "Aporte del socio");
    await confirmar(user, dialog);
    await waitFor(() => expect(registrarAporteMock).toHaveBeenCalledTimes(1));
    const fd = entradas(registrarAporteMock.mock.calls[0][0]);
    expect(Object.keys(fd).sort()).toEqual(["clase", "claveIdempotencia", "fecha", "monto", "motivo"].sort());
    expect(fd.fecha).toBe(hoyEnCostaRica());
  });

  it("una tienda le paga a Ordenex: tienda, método y la fecha como `fechaPago`, siempre", async () => {
    const { user, dialog } = await abrir();
    await elegirConcepto(user, dialog, "Una tienda le paga a Ordenex");
    await elegirCuenta(dialog, "Tienda que paga", "Tienda Norte");
    escribir(dialog, /^Monto/, "4000");
    escribir(dialog, /^Motivo del pago/, "Fletes");
    await elegirMetodo(user, dialog, "Efectivo");
    await confirmar(user, dialog);
    await waitFor(() => expect(registrarAbonoMock).toHaveBeenCalledTimes(1));
    const fd = entradas(registrarAbonoMock.mock.calls[0][0]);
    expect(Object.keys(fd).sort()).toEqual(
      ["claveIdempotencia", "fechaPago", "metodo", "monto", "motivo", "tiendaId"].sort(),
    );
    expect(fd.fechaPago).toBe(hoyEnCostaRica());
  });

  it("⭑ Ordenex le paga a una tienda: tienda, método, motivo como `nota` y `fechaPago`; avisa con lo que le sigue debiendo", async () => {
    const { user, dialog } = await abrir();
    await elegirConcepto(user, dialog, "Ordenex le paga a una tienda");
    await elegirCuenta(dialog, "Tienda a la que se le paga", "Tienda Norte");
    escribir(dialog, /^Monto/, "3000");
    escribir(dialog, /^Motivo del pago/, "Entrega quincenal");
    await elegirMetodo(user, dialog, "Transferencia");
    escribir(dialog, /^Referencia/, "TR-77");
    await confirmar(user, dialog);
    await waitFor(() => expect(registrarPagoTiendaMock).toHaveBeenCalledTimes(1));
    const fd = entradas(registrarPagoTiendaMock.mock.calls[0][0]);
    expect(Object.keys(fd).sort()).toEqual(
      ["claveIdempotencia", "fechaPago", "metodo", "monto", "nota", "referencia", "tiendaId"].sort(),
    );
    expect(fd).toMatchObject({ tiendaId: NORTE, nota: "Entrega quincenal", metodo: "transferencia", monto: "3000" });
    expect(successMock).toHaveBeenCalledWith(
      "Pago de ₡3.000 a Tienda Norte registrado. Ordenex le sigue debiendo ₡7.000.",
    );
  });

  it("⭑ Ordenex le paga a un mensajero: el buscador ofrece mensajeros (no tiendas) y manda `mensajeroId`", async () => {
    const { user, dialog } = await abrir();
    await elegirConcepto(user, dialog, "Ordenex le paga a un mensajero");
    await elegirCuenta(dialog, "Mensajero al que se le paga", "Juan Pérez Mora");
    expect(listarPorRolMock).toHaveBeenCalledWith("mensajero");
    expect(listarTiendasMock).not.toHaveBeenCalled();
    escribir(dialog, /^Monto/, "8000");
    escribir(dialog, /^Motivo del pago/, "Semana 38");
    await elegirMetodo(user, dialog, "Efectivo");
    await confirmar(user, dialog);
    await waitFor(() => expect(registrarRepartoMock).toHaveBeenCalledTimes(1));
    const fd = entradas(registrarRepartoMock.mock.calls[0][0]);
    expect(Object.keys(fd).sort()).toEqual(
      ["claveIdempotencia", "fechaPago", "mensajeroId", "metodo", "monto", "nota"].sort(),
    );
    expect(fd.mensajeroId).toBe(JUAN);
    expect(successMock).toHaveBeenCalledWith(
      "Pago de ₡8.000 a Juan Pérez Mora registrado. Ordenex le sigue debiendo ₡2.000 por sus cierres.",
    );
  });

  it("R43: la referencia de los pagos solo aparece —y se exige— con SINPE o transferencia", async () => {
    const { user, dialog } = await abrir();
    await elegirConcepto(user, dialog, "Ordenex le paga a una tienda");
    expect(within(dialog).queryByLabelText(/^Referencia/)).toBeNull();
    await elegirMetodo(user, dialog, "SINPE");
    expect(within(dialog).getByLabelText(/^Referencia/)).toBeTruthy();
    await elegirCuenta(dialog, "Tienda a la que se le paga", "Tienda Norte");
    escribir(dialog, /^Monto/, "10");
    escribir(dialog, /^Motivo del pago/, "x");
    await confirmar(user, dialog);
    expect(await within(dialog).findByText("La referencia es obligatoria en SINPE y transferencia.")).toBeTruthy();
    expect(registrarPagoTiendaMock).not.toHaveBeenCalled();
  });

  it("R43: monto, fecha y motivo en los diez; sin monto válido ni motivo no se llama a nadie", async () => {
    const { user, dialog } = await abrir();
    for (const r of within(dialog).getAllByRole("radio").slice(0, 10)) {
      await user.click(r);
      expect(within(dialog).getByLabelText(/^Monto/)).toBeTruthy();
      expect(within(dialog).getByLabelText(/^Fecha/)).toBeTruthy();
      expect(dialog.querySelector("#movimiento-descripcion")).not.toBeNull();
      // R74: el comprobante, opcional, en TODOS.
      expect(within(dialog).getByLabelText(/^Comprobante \(opcional\)/)).toBeTruthy();
    }
    escribir(dialog, /^Monto/, "0");
    await confirmar(user, dialog);
    expect(await within(dialog).findByText("El monto debe ser un número mayor que 0.")).toBeTruthy();
    for (const m of [registrarEgresoMock, registrarManualMock, registrarCobroMock, registrarPagoTiendaMock]) {
      expect(m).not.toHaveBeenCalled();
    }
  });

  it("R51: la clave es la MISMA en los reintentos de una apertura y OTRA en la siguiente apertura", async () => {
    registrarManualMock.mockResolvedValueOnce({ status: "validation_error", fieldErrors: { monto: ["x"] } });
    const { user, dialog } = await abrir();
    await elegirConcepto(user, dialog, "Corrección de caja (resta)");
    escribir(dialog, /^Monto/, "10");
    escribir(dialog, /^Motivo de la corrección/, "Faltante");
    await confirmar(user, dialog);
    await confirmar(user, dialog);
    await waitFor(() => expect(registrarManualMock).toHaveBeenCalledTimes(2));
    const primera = entradas(registrarManualMock.mock.calls[0][0]).claveIdempotencia;
    expect(entradas(registrarManualMock.mock.calls[1][0]).claveIdempotencia).toBe(primera);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await user.click(screen.getByRole("button", { name: "Registrar un movimiento" }));
    const otro = await screen.findByRole("dialog");
    await elegirConcepto(user, otro, "Corrección de caja (resta)");
    escribir(otro, /^Monto/, "10");
    escribir(otro, /^Motivo de la corrección/, "Faltante");
    await confirmar(user, otro);
    await waitFor(() => expect(registrarManualMock).toHaveBeenCalledTimes(3));
    const tercera = entradas(registrarManualMock.mock.calls[2][0]).claveIdempotencia;
    expect(tercera).toMatch(UUID);
    expect(tercera).not.toBe(primera);
  });
});

// ─── La fecha ───────────────────────────────────────────────────────────────────────────────────

describe("458-C — la fecha del movimiento", () => {
  it("arranca en hoy de Costa Rica; sin tocarla no viaja en los registros de caja; elegida, viaja tal cual", async () => {
    const { user, dialog } = await abrir();
    const fecha = within(dialog).getByLabelText(/^Fecha/) as HTMLInputElement;
    expect(fecha.value).toBe(hoyEnCostaRica());
    expect(fecha.max).toBe(hoyEnCostaRica());
    escribir(dialog, /^A quién se le pagó/, "Proveedor");
    escribir(dialog, /^Monto/, "10");
    escribir(dialog, /^Concepto del gasto/, "Tinta");
    fireEvent.change(fecha, { target: { value: diasAntesEnCostaRica(3) } });
    await confirmar(user, dialog);
    await waitFor(() => expect(registrarEgresoMock).toHaveBeenCalled());
    expect(entradas(registrarEgresoMock.mock.calls[0][0]).fecha).toBe(diasAntesEnCostaRica(3));
  });

  it("una fecha futura se rechaza en el cliente; los pagos no tienen ventana hacia atrás", async () => {
    const { user, dialog } = await abrir();
    await elegirConcepto(user, dialog, "Ordenex le paga a un mensajero");
    const fecha = within(dialog).getByLabelText(/^Fecha/) as HTMLInputElement;
    expect(fecha.min).toBe("");
    fireEvent.change(fecha, { target: { value: diasDespuesEnCostaRica(2) } });
    await confirmar(user, dialog);
    expect(await within(dialog).findByText("La fecha no puede ser posterior a hoy.")).toBeTruthy();
    expect(registrarRepartoMock).not.toHaveBeenCalled();
  });
});

// ─── R40 / R41 — la cuenta ───────────────────────────────────────────────────────────────────────

describe("458-C R40/R41 — la cuenta: buscador por nombre, al abrir, y fija desde un estado de cuenta", () => {
  it("R41: ofrece las tiendas activas que devuelve el servidor, por nombre; filtra al escribir", async () => {
    const { user, dialog } = await abrir();
    await elegirConcepto(user, dialog, "Ordenex le cobra a una tienda");
    const disparador = within(dialog).getByRole("button", { name: /^Tienda a la que se le cobra:/ });
    await waitFor(() => expect(disparador).not.toBeDisabled());
    fireEvent.click(disparador);
    const lista = await screen.findByRole("listbox");
    expect(within(lista).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Elegí la tienda",
      "Tienda Este",
      "Tienda Norte",
    ]);
    fireEvent.change(screen.getByRole("combobox", { name: "Buscar la tienda" }), { target: { value: "norte" } });
    expect(within(screen.getByRole("listbox")).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Elegí la tienda",
      "Tienda Norte",
    ]);
    expect(listarTiendasMock).toHaveBeenCalledTimes(1);
  });

  it("con la lista caída el concepto que la usa se bloquea y lo dice; los demás siguen", async () => {
    listarTiendasMock.mockResolvedValue({ status: "forbidden" });
    const { user, dialog } = await abrir();
    await elegirConcepto(user, dialog, "Ordenex le cobra a una tienda");
    expect(await within(dialog).findByText(/No se pudo cargar la lista de tiendas/)).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Registrar" })).toBeDisabled();
    await elegirConcepto(user, dialog, "Gasto de Ordenex");
    expect(within(dialog).getByRole("button", { name: "Registrar" })).not.toBeDisabled();
  });

  it("R40: con concepto y cuenta fijos, los dos vienen elegidos y deshabilitados, y no se pide ninguna lista", async () => {
    const { user, dialog } = await abrir(
      {
        conceptoInicial: "abono_tienda",
        cuentaFija: { id: NORTE, nombre: "Tienda Norte" },
        etiquetaBoton: "Registrar pago de la tienda a Ordenex",
      },
      "Registrar pago de la tienda a Ordenex",
    );
    expect(within(dialog).getByRole("radio", { name: "Una tienda le paga a Ordenex" })).toBeChecked();
    expect(within(dialog).getByRole("radio", { name: "Sueldo" })).toHaveAttribute("aria-disabled", "true");
    const cuenta = within(dialog).getByLabelText(/^Tienda que paga/) as HTMLInputElement;
    expect(cuenta.value).toBe("Tienda Norte");
    expect(cuenta).toBeDisabled();
    escribir(dialog, /^Monto/, "4000");
    escribir(dialog, /^Motivo del pago/, "Fletes");
    await elegirMetodo(user, dialog, "Efectivo");
    await confirmar(user, dialog);
    await waitFor(() => expect(registrarAbonoMock).toHaveBeenCalled());
    expect(entradas(registrarAbonoMock.mock.calls[0][0]).tiendaId).toBe(NORTE);
    expect(listarTiendasMock).not.toHaveBeenCalled();
  });

  it("sin cuenta elegida no se llama al servidor y el motivo va bajo la cuenta", async () => {
    const { user, dialog } = await abrir();
    await elegirConcepto(user, dialog, "Ordenex le cobra a una tienda");
    escribir(dialog, /^Monto/, "10");
    escribir(dialog, /^Motivo del cobro/, "x");
    await confirmar(user, dialog);
    expect(await within(dialog).findByText("Elegí la tienda.")).toBeTruthy();
    expect(registrarCobroMock).not.toHaveBeenCalled();
  });
});

// ─── R48 / R49 / R76 — lo que responde el servidor ───────────────────────────────────────────────

describe("458-C R48/R49/R76 — lo que responde el servidor", () => {
  it("R48: tras registrar avisa, cierra, avisa al módulo y refresca", async () => {
    const onRegistrado = vi.fn();
    const { user, dialog } = await abrir({ onRegistrado });
    await elegirConcepto(user, dialog, "Corrección de caja (resta)");
    escribir(dialog, /^Monto/, "10");
    escribir(dialog, /^Motivo de la corrección/, "Faltante");
    await confirmar(user, dialog);
    await waitFor(() => expect(onRegistrado).toHaveBeenCalledTimes(1));
    expect(successMock).toHaveBeenCalledWith("Movimiento registrado correctamente.");
    expect(refreshMock).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("R49: el rechazo del borde conserva lo escrito y pinta cada motivo bajo SU campo", async () => {
    registrarEgresoMock.mockResolvedValue({
      status: "validation_error",
      fieldErrors: { contraparteNombre: ["«A quién» no puede superar 120 caracteres."], fecha: ["Fecha inválida."] },
    });
    const { user, dialog } = await abrir();
    escribir(dialog, /^A quién se le pagó/, "Proveedor");
    escribir(dialog, /^Monto/, "99.90");
    escribir(dialog, /^Concepto del gasto/, "Tinta");
    await confirmar(user, dialog);
    expect(await within(dialog).findByText("«A quién» no puede superar 120 caracteres.")).toBeTruthy();
    expect(within(dialog).getByText("Fecha inválida.")).toBeTruthy();
    expect((within(dialog).getByLabelText(/^Monto/) as HTMLInputElement).value).toBe("99.90");
    expect((within(dialog).getByLabelText(/^A quién se le pagó/) as HTMLInputElement).value).toBe("Proveedor");
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("el pago a una tienda que excede: el tope del SERVIDOR bajo el monto; sin saldo: bajo la tienda", async () => {
    registrarPagoTiendaMock.mockResolvedValueOnce({ status: "excede", disponible: "2500.00" });
    registrarPagoTiendaMock.mockResolvedValueOnce({ status: "sin_saldo" });
    const { user, dialog } = await abrir();
    await elegirConcepto(user, dialog, "Ordenex le paga a una tienda");
    await elegirCuenta(dialog, "Tienda a la que se le paga", "Tienda Norte");
    escribir(dialog, /^Monto/, "3000");
    escribir(dialog, /^Motivo del pago/, "x");
    await elegirMetodo(user, dialog, "Efectivo");
    await confirmar(user, dialog);
    expect(
      await within(dialog).findByText("Ordenex le debe ₡2.500 a esta tienda: el pago no puede superar ese importe."),
    ).toBeTruthy();
    await confirmar(user, dialog);
    expect(await within(dialog).findByText("Esta tienda no tiene saldo a favor: no hay nada que pagar.")).toBeTruthy();
  });

  it("R76: si el comprobante no se guardó, lo dice y el diálogo sigue abierto", async () => {
    registrarEgresoMock.mockResolvedValue({ status: "comprobante_no_guardado" });
    const { user, dialog } = await abrir();
    escribir(dialog, /^A quién se le pagó/, "Proveedor");
    escribir(dialog, /^Monto/, "10");
    escribir(dialog, /^Concepto del gasto/, "Tinta");
    await confirmar(user, dialog);
    expect(
      await within(dialog).findByText("No se pudo guardar el comprobante, así que no se registró nada. Probá de nuevo."),
    ).toBeTruthy();
    expect(successMock).not.toHaveBeenCalled();
  });

  it("R74: el comprobante elegido viaja en el FormData de un concepto de la caja", async () => {
    const { user, dialog } = await abrir();
    escribir(dialog, /^A quién se le pagó/, "Proveedor");
    escribir(dialog, /^Monto/, "10");
    escribir(dialog, /^Concepto del gasto/, "Tinta");
    const archivo = new File(["%PDF-1.4"], "recibo.pdf", { type: "application/pdf" });
    fireEvent.change(within(dialog).getByLabelText(/^Comprobante \(opcional\)/), { target: { files: [archivo] } });
    await confirmar(user, dialog);
    await waitFor(() => expect(registrarEgresoMock).toHaveBeenCalled());
    expect(entradas(registrarEgresoMock.mock.calls[0][0]).comprobante).toBe("archivo:recibo.pdf");
  });

  it("forbidden se avisa sin cerrar", async () => {
    registrarManualMock.mockResolvedValue({ status: "forbidden" });
    const { user, dialog } = await abrir();
    await elegirConcepto(user, dialog, "Corrección de caja (suma)");
    escribir(dialog, /^Monto/, "10");
    escribir(dialog, /^Motivo de la corrección/, "x");
    await confirmar(user, dialog);
    await waitFor(() => expect(errorMock).toHaveBeenCalledWith("No tenés permiso para registrar movimientos."));
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});

// ─── R44–R47 — «Así queda» ───────────────────────────────────────────────────────────────────────

describe("458-C R44–R47 — «Así queda», calculado en el servidor", () => {
  function recuadro(): HTMLElement {
    return screen.getByRole("region", { name: "Así queda" });
  }

  it("sin monto no pide nada y dice qué falta; con monto pide al servidor el concepto y el monto", async () => {
    const { user, dialog } = await abrir();
    await elegirConcepto(user, dialog, "Sueldo");
    expect(within(recuadro()).getByText("Escribí el monto para ver cómo queda.")).toBeTruthy();
    expect(previsualizarMock).not.toHaveBeenCalled();
    escribir(dialog, /^Monto/, "25000");
    await waitFor(() => expect(previsualizarMock).toHaveBeenCalledTimes(1));
    expect(previsualizarMock).toHaveBeenCalledWith({ concepto: "sueldo", monto: "25000" });
    // R44/R45: las cinco líneas del servidor; las que no se mueven dicen «no cambia».
    expect(await within(recuadro()).findByText("Flujo de dinero registrado")).toBeTruthy();
    expect(within(recuadro()).getByText("₡100.000")).toBeTruthy();
    expect(within(recuadro()).getByText("₡75.000")).toBeTruthy();
    expect(within(recuadro()).getByText("Ganancia de Ordenex")).toBeTruthy();
    expect(within(recuadro()).getByText("₡60.000 · no cambia")).toBeTruthy();
    expect(within(recuadro()).getByText("₡0 · no cambia")).toBeTruthy();
  });

  it("con cuenta: no pide sin la cuenta; al elegirla manda su id y rotula la línea por su NOMBRE", async () => {
    previsualizarMock.mockResolvedValue({
      status: "ok",
      efecto: {
        lineas: {
          cuenta: { ...linea("2000.00", "-3000.00"), tipo: "tienda" },
          cifraPrincipal: { ...linea("100000.00", "100000.00"), rotulo: "saldo" },
          ganancia: linea("40000.00", "45000.00"),
          deTiendas: linea("60000.00", "55000.00"),
          capital: linea("0.00", "0.00"),
        },
        saldoEnContra: true,
      },
    });
    const { user, dialog } = await abrir();
    await elegirConcepto(user, dialog, "Ordenex le cobra a una tienda");
    escribir(dialog, /^Monto/, "5000");
    expect(within(recuadro()).getByText("Elegí la cuenta y escribí el monto para ver cómo queda.")).toBeTruthy();
    await elegirCuenta(dialog, "Tienda a la que se le cobra", "Tienda Norte");
    await waitFor(() =>
      expect(previsualizarMock).toHaveBeenCalledWith({ concepto: "cobro_a_tienda", monto: "5000", cuentaId: NORTE }),
    );
    expect(await within(recuadro()).findByText("Saldo de Tienda Norte")).toBeTruthy();
    // R47: el aviso de saldo en contra, con el saldo del servidor y su signo.
    expect(within(recuadro()).getByRole("alert").textContent).toBe(
      "Así, Tienda Norte queda con el saldo en contra: -₡3.000. Le deberá ese dinero a Ordenex.",
    );
    // La cifra principal en estado «saldo» se llama por su estado, y no cambia.
    expect(within(recuadro()).getByText("Dinero en caja")).toBeTruthy();
    expect(within(recuadro()).getByText("₡100.000 · no cambia")).toBeTruthy();
    // Ningún id en pantalla.
    expect(recuadro().textContent).not.toContain(NORTE);
  });

  it("R46: si el servidor no responde, lo dice y NO pinta cifras", async () => {
    previsualizarMock.mockRejectedValue(new Error("caído"));
    const { dialog } = await abrir();
    escribir(dialog, /^Monto/, "25000");
    expect(
      await within(recuadro()).findByText(
        "No se pudo calcular cómo queda. Podés registrar igual: el servidor revisa el movimiento antes de guardarlo.",
      ),
    ).toBeTruthy();
    expect(recuadro().textContent).not.toMatch(/₡/);
  });

  it("R46: una respuesta que no es `ok` (forbidden) también es error sin cifras", async () => {
    previsualizarMock.mockResolvedValue({ status: "forbidden" });
    const { dialog } = await abrir();
    escribir(dialog, /^Monto/, "25000");
    expect(await within(recuadro()).findByRole("alert")).toBeTruthy();
    expect(recuadro().textContent).not.toMatch(/₡/);
  });

  it("mientras calcula lo dice", async () => {
    previsualizarMock.mockReturnValue(new Promise(() => {}));
    const { dialog } = await abrir();
    escribir(dialog, /^Monto/, "25000");
    expect(await within(recuadro()).findByText("Calculando cómo queda…")).toBeTruthy();
  });

  it("el tope del pago a una tienda lo decide el servidor (`superaDisponible`)", async () => {
    previsualizarMock.mockResolvedValue({
      status: "ok",
      efecto: {
        lineas: {
          cuenta: { ...linea("1000.00", "-500.00"), tipo: "tienda" },
          cifraPrincipal: { ...linea("100000.00", "98500.00"), rotulo: "flujo" },
          ganancia: linea("40000.00", "40000.00"),
          deTiendas: linea("60000.00", "58500.00"),
          capital: linea("0.00", "0.00"),
        },
        saldoEnContra: true,
        superaDisponible: true,
      },
    });
    const { user, dialog } = await abrir();
    await elegirConcepto(user, dialog, "Ordenex le paga a una tienda");
    await elegirCuenta(dialog, "Tienda a la que se le paga", "Tienda Norte");
    escribir(dialog, /^Monto/, "1500");
    expect(
      await within(recuadro()).findByText("El monto supera lo que Ordenex le debe a esta tienda: no se va a poder registrar."),
    ).toBeTruthy();
  });
});
