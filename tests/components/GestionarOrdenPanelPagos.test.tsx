// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { GestionarOrdenPanel } from "@/app/(app)/mis-asignaciones/_components/GestionarOrdenPanel";
import { gestionar } from "@/lib/actions/mis-asignaciones";
import { formatMonto, SIN_MONTO_RAYA } from "@/lib/config/moneda";
import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";

// Feature 213 (R1/R2/R6/R7/R8/R9/R10/R13/R14/R15/R16/R17/R18) — CAPTURA del pago múltiple en el
// panel del mensajero. Se prueba el panel AISLADO (con el puntero ya fijado, `yaActiva`), que
// arranca directo en los 4 botones de resultado. La Server Action `gestionar` (`"use server"` con
// Prisma detrás) y el toast se mockean para afirmar la UI y el FormData sin DB ni sesión — mismo
// montaje que `GestionarOrdenPanelEvidencias.test.tsx`.
//
// Lo que aquí se afirma NO es que el panel "pinte algo": es qué sale por el `FormData` y qué NO
// sale, porque ese desglose acaba siendo `cierre_dia.total_efectivo`, la `E` del `min(P, E)` con
// el que se le paga a una persona (feature 44). Por eso hay tres casos de descuadre y no uno.
vi.mock("@/lib/actions/mis-asignaciones", () => ({
  gestionar: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const { successMock, errorMock } = vi.hoisted(() => ({
  successMock: vi.fn(),
  errorMock: vi.fn(),
}));
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

const gestionarMock = vi.mocked(gestionar);

/** El importe tal como lo pinta la configuración de moneda (nunca un `₡` escrito a mano). */
function conMoneda(monto: number): string {
  return formatMonto(monto, SIN_MONTO_RAYA);
}

function makeOrden(over: Partial<MiAsignacionDTO> = {}): MiAsignacionDTO {
  return {
    id: "g1",
    numGuia: 1001,
    numRemision: "REM-001",
    estatusValue: "en_reparto",
    destinatario: "Ana Pérez",
    telefonoDest: "88880000",
    direccion: "Calle 1, casa 2",
    producto: "Caja mediana",
    peso: 1.5,
    montoCobrar: 8000,
    latitud: 9.9281244,
    longitud: -84.0907246,
    notas: "Dejar en portería",
    tiendaNombre: "Tienda X",
    zonaNombre: "GAM",
    provinciaNombre: "San José",
    cantonNombre: "Central",
    distritoNombre: "Carmen",
    secuenciaRuta: 1,
    ...over,
  };
}

function foto(nombre: string): File {
  return new File(["x"], nombre, { type: "image/jpeg" });
}

/** Monta el panel con el puntero ya fijado y abre la rama de entrega. */
async function abrirEntrega(
  user: ReturnType<typeof userEvent.setup>,
  over: Partial<MiAsignacionDTO> = {},
) {
  render(
    <GestionarOrdenPanel
      orden={makeOrden(over)}
      yaActiva
      onGestionarPedido={vi.fn().mockResolvedValue(true)}
      onCancelarGestion={vi.fn()}
      onSuccess={vi.fn()}
      onAbrirChat={vi.fn()}
      count={1}
    />,
  );
  await user.click(await screen.findByRole("button", { name: "Entregar" }));
}

function selectorMetodo(n: number) {
  return screen.getByRole("combobox", { name: `Método de pago línea ${n}` });
}

function inputMonto(n: number): HTMLInputElement {
  return screen.getByRole("spinbutton", {
    name: `Monto línea ${n}`,
  }) as HTMLInputElement;
}

/** Elige un método en la línea `n` (Select de base-ui: trigger → listbox → opción). */
async function elegirMetodo(
  user: ReturnType<typeof userEvent.setup>,
  n: number,
  etiqueta: string,
) {
  await user.click(selectorMetodo(n));
  const listbox = await screen.findByRole("listbox");
  await user.click(within(listbox).getByRole("option", { name: etiqueta }));
}

function escribirMonto(n: number, valor: string) {
  fireEvent.change(inputMonto(n), { target: { value: valor } });
}

async function subirFoto(user: ReturnType<typeof userEvent.setup>) {
  await user.upload(screen.getByLabelText("Foto de evidencia de entrega"), foto("a.jpg"));
  await vi.waitFor(() =>
    expect(
      within(screen.getByRole("list", { name: "Fotos de evidencia seleccionadas" })).getAllByRole(
        "img",
      ),
    ).toHaveLength(1),
  );
}

async function guardar(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Guardar gestión" }));
}

/** El `FormData` de la única llamada a la action. */
function formDataEnviado(): FormData {
  return gestionarMock.mock.calls[0][0] as FormData;
}

beforeEach(() => {
  vi.clearAllMocks();
  gestionarMock.mockResolvedValue({ status: "ok", ordenId: "g1", estado: "entregada" });
});

afterEach(() => {
  cleanup();
});

describe("GestionarOrdenPanel · desglose del recaudo (feature 213)", () => {
  it("R1: con cobro, la rama entregada monta el editor de líneas y ya no el selector único", async () => {
    const user = userEvent.setup();
    await abrirEntrega(user);

    expect(selectorMetodo(1)).toBeInTheDocument();
    // El control único de antes (nombre accesible «Método de pago» a secas) ya no existe.
    expect(screen.queryByRole("combobox", { name: "Método de pago" })).toBeNull();
  });

  it("R2: arranca con UNA línea, sin método y con el monto a cobrar pre-cargado", async () => {
    const user = userEvent.setup();
    await abrirEntrega(user);

    expect(screen.getAllByRole("group", { name: /^Línea de pago/ })).toHaveLength(1);
    expect(inputMonto(1).value).toBe("8000");
    // Sin método elegido: el trigger muestra el placeholder, no una etiqueta de método.
    expect(selectorMetodo(1)).toHaveTextContent("Selecciona un método");
  });

  it("R7 [D3]: la línea no ofrece referencia ni ningún otro campo", async () => {
    const user = userEvent.setup();
    await abrirEntrega(user);

    const linea = screen.getByRole("group", { name: "Línea de pago 1" });
    expect(within(linea).getAllByRole("combobox")).toHaveLength(1);
    expect(within(linea).getAllByRole("spinbutton")).toHaveLength(1);
    expect(within(linea).queryAllByRole("textbox")).toHaveLength(0);
  });

  it("R6: quitar una línea libera su método en las demás y con una sola no se ofrece quitar", async () => {
    const user = userEvent.setup();
    await abrirEntrega(user);

    // Con una sola línea no hay nada que quitar (R6).
    expect(screen.queryByRole("button", { name: /^Quitar línea/ })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Añadir método" }));
    await elegirMetodo(user, 1, "Efectivo");
    expect(screen.getAllByRole("group", { name: /^Línea de pago/ })).toHaveLength(2);

    // R5: mientras la línea 1 use «Efectivo», la línea 2 lo ve DESHABILITADO.
    await user.click(selectorMetodo(2));
    const opcionOcupada = within(await screen.findByRole("listbox")).getByRole("option", {
      name: "Efectivo",
    });
    expect(opcionOcupada).toHaveAttribute("aria-disabled", "true");
    await user.keyboard("{Escape}");

    // Al quitar la línea que lo usaba, «Efectivo» vuelve a estar disponible.
    await user.click(screen.getByRole("button", { name: "Quitar línea 1" }));
    expect(screen.getAllByRole("group", { name: /^Línea de pago/ })).toHaveLength(1);

    await user.click(selectorMetodo(1));
    const opcionLibre = within(await screen.findByRole("listbox")).getByRole("option", {
      name: "Efectivo",
    });
    expect(opcionLibre).not.toHaveAttribute("aria-disabled", "true");
  });

  it("R3: se pueden añadir líneas mientras queden métodos; con 3 el control desaparece", async () => {
    // La REGLA pura ya la fija `desglose-captura.test.ts`; lo que aquí se afirma es el CABLEADO:
    // que al pulsar el control las líneas crecen de verdad y que el tope se alcanza POR LA UI, no
    // solo en el módulo. Tres es el tamaño del catálogo (`METODO_PAGO_SEED`), no un número mágico:
    // ofrecer una cuarta línea sería ofrecer un método repetido, y el desglose es dinero.
    const user = userEvent.setup();
    await abrirEntrega(user);

    const anadir = () => screen.queryByRole("button", { name: "Añadir método" });
    const lineas = () => screen.getAllByRole("group", { name: /^Línea de pago/ }).length;

    expect(lineas()).toBe(1);
    await user.click(anadir() as HTMLElement);
    expect(lineas()).toBe(2);
    // Con 2 de 3 métodos usados el control SIGUE ofreciéndose (la mitad viva de la regla).
    expect(anadir()).toBeInTheDocument();

    await user.click(anadir() as HTMLElement);
    expect(lineas()).toBe(3);
    expect(anadir()).toBeNull();
  });

  it("R8: muestra monto a cobrar, suma capturada y diferencia, y se actualizan al teclear", async () => {
    const user = userEvent.setup();
    await abrirEntrega(user);

    const resumen = () =>
      within(screen.getByLabelText("Resumen del cobro"))
        .getAllByRole("definition")
        .map((d) => d.textContent);

    expect(resumen()).toEqual([conMoneda(8000), conMoneda(8000), conMoneda(0)]);

    escribirMonto(1, "5000");
    expect(resumen()).toEqual([conMoneda(8000), conMoneda(5000), conMoneda(3000)]);

    // R4: la línea nueva nace con lo PENDIENTE, así que el resumen vuelve a cuadrar.
    await user.click(screen.getByRole("button", { name: "Añadir método" }));
    expect(inputMonto(2).value).toBe("3000");
    expect(resumen()).toEqual([conMoneda(8000), conMoneda(8000), conMoneda(0)]);
  });

  it.each([
    ["de menos", "5000"],
    ["de más", "9000"],
    ["por un céntimo", "8000.01"],
  ])(
    "R9: una suma que NO cuadra (%s) pinta el error y NO llama a la action",
    async (_caso, monto) => {
      const user = userEvent.setup();
      await abrirEntrega(user);

      await elegirMetodo(user, 1, "Efectivo");
      escribirMonto(1, monto);
      await subirFoto(user); // lo único que falla es el cuadre
      await guardar(user);

      const alertas = screen.getAllByRole("alert").map((a) => a.textContent);
      expect(alertas).toContain("El desglose debe sumar exactamente el monto a cobrar.");
      expect(gestionarMock).not.toHaveBeenCalled();
    },
  );

  it("R13: método sin monto → error EN ESA LÍNEA y no se envía", async () => {
    const user = userEvent.setup();
    await abrirEntrega(user);

    await elegirMetodo(user, 1, "Efectivo");
    escribirMonto(1, "");
    await subirFoto(user);
    await guardar(user);

    const linea = screen.getByRole("group", { name: "Línea de pago 1" });
    expect(within(linea).getByRole("alert")).toHaveTextContent("Monto requerido");
    expect(gestionarMock).not.toHaveBeenCalled();
  });

  it("R13: monto sin método → error EN ESA LÍNEA y no se envía", async () => {
    const user = userEvent.setup();
    await abrirEntrega(user);

    // La línea 1 arranca con el monto puesto y sin método: es exactamente el caso.
    await subirFoto(user);
    await guardar(user);

    const linea = screen.getByRole("group", { name: "Línea de pago 1" });
    expect(within(linea).getByRole("alert")).toHaveTextContent("Método de pago requerido");
    expect(gestionarMock).not.toHaveBeenCalled();
  });

  it("R14: con cobro y todas las líneas vacías, error de método requerido y no se envía", async () => {
    const user = userEvent.setup();
    await abrirEntrega(user);

    escribirMonto(1, ""); // línea COMPLETAMENTE vacía: se descarta (R12) y no queda ninguna
    await subirFoto(user);
    await guardar(user);

    const alertas = screen.getAllByRole("alert").map((a) => a.textContent);
    expect(alertas).toContain("Método de pago requerido");
    expect(gestionarMock).not.toHaveBeenCalled();
  });

  it("R10: volver atrás y elegir otro resultado descarta las líneas capturadas", async () => {
    const user = userEvent.setup();
    await abrirEntrega(user);

    await elegirMetodo(user, 1, "Efectivo");
    escribirMonto(1, "5000");
    await user.click(screen.getByRole("button", { name: "Añadir método" }));
    expect(screen.getAllByRole("group", { name: /^Línea de pago/ })).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "Atrás" }));
    await user.click(screen.getByRole("button", { name: "Entregar" }));

    expect(screen.getAllByRole("group", { name: /^Línea de pago/ })).toHaveLength(1);
    expect(inputMonto(1).value).toBe("8000");
    expect(selectorMetodo(1)).toHaveTextContent("Selecciona un método");
  });

  it("R15: el envío mixto manda dos pares `pagoMetodo`/`pagoMonto` emparejados y NINGÚN `metodoPago`", async () => {
    const user = userEvent.setup();
    await abrirEntrega(user);

    await elegirMetodo(user, 1, "Efectivo");
    escribirMonto(1, "5000");
    await user.click(screen.getByRole("button", { name: "Añadir método" }));
    await elegirMetodo(user, 2, "Transferencia");
    expect(inputMonto(2).value).toBe("3000");
    await subirFoto(user);

    await guardar(user);

    await vi.waitFor(() => expect(gestionarMock).toHaveBeenCalledTimes(1));
    const fd = formDataEnviado();
    // Emparejados por índice y en el ORDEN en que se capturaron.
    expect(fd.getAll("pagoMetodo")).toEqual(["efectivo", "transferencia"]);
    expect(fd.getAll("pagoMonto")).toEqual(["5000", "3000"]);
    expect(fd.get("metodoPago")).toBeNull();
    expect(fd.get("montoRecibido")).toBe("8000");
  });

  it("R16: orden SIN cobro: no hay editor, cero pares de pago y sin `metodoPago` escalar", async () => {
    const user = userEvent.setup();
    await abrirEntrega(user, { montoCobrar: 0 });

    expect(screen.queryAllByRole("group", { name: /^Línea de pago/ })).toHaveLength(0);

    await subirFoto(user);
    await guardar(user);

    await vi.waitFor(() => expect(gestionarMock).toHaveBeenCalledTimes(1));
    const fd = formDataEnviado();
    expect(fd.getAll("pagoMetodo")).toHaveLength(0);
    expect(fd.get("metodoPago")).toBeNull();
  });

  it("R16 (contraprueba): con `montoCobrar > 0` el editor SÍ se monta", async () => {
    const user = userEvent.setup();
    await abrirEntrega(user, { montoCobrar: 8000 });

    expect(screen.getAllByRole("group", { name: /^Línea de pago/ })).toHaveLength(1);
  });

  it("R17: el panel valida con `gestionarSchema` antes de enviar (sin fotos → no envía)", async () => {
    const user = userEvent.setup();
    await abrirEntrega(user);

    // Desglose PERFECTO: lo único que falta es la evidencia, que la barrera del schema exige.
    await elegirMetodo(user, 1, "Efectivo");
    await guardar(user);

    await vi.waitFor(() =>
      expect(
        screen.getByLabelText("Foto de evidencia de entrega"),
      ).toHaveAttribute("aria-invalid", "true"),
    );
    expect(gestionarMock).not.toHaveBeenCalled();
  });

  it("R18: un `validation_error` del servidor en `pagos` se pinta en el editor", async () => {
    const user = userEvent.setup();
    gestionarMock.mockResolvedValue({
      status: "validation_error",
      fieldErrors: { pagos: ["el desglose debe sumar el monto recibido"] },
    });
    await abrirEntrega(user);

    await elegirMetodo(user, 1, "Efectivo");
    await subirFoto(user);
    await guardar(user);

    await vi.waitFor(() => expect(gestionarMock).toHaveBeenCalledTimes(1));
    // Se pinta DENTRO del editor de líneas, no en un toast ni en el limbo.
    const editor = screen.getByLabelText("Resumen del cobro").parentElement as HTMLElement;
    await vi.waitFor(() =>
      expect(
        within(editor)
          .getAllByRole("alert")
          .map((a) => a.textContent),
      ).toContain("el desglose debe sumar el monto recibido"),
    );
  });
});
