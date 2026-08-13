// @vitest-environment jsdom
// Feature 172 (T D.1) — el FORMULARIO de registro de un pago. Cubre R14, R23, R30, R43, R47.
//
// Lo que de verdad se juega este archivo es LA CLAVE DE IDEMPOTENCIA (§4.1). El backend se
// pasó una tanda entera blindando el doble pago con un `UNIQUE` de base de datos, y esa
// barrera solo se activa si el cliente manda la MISMA clave al reintentar. Si el diálogo
// acuñara una clave por envío, un doble submit —o un reintento tras un error de red que en
// realidad sí escribió— crearía DOS pagos y saldaría el saldo dos veces. Por eso aquí se mide
// la clave por sus dos mitades: la que se conserva y la que se renueva.
//
// El generador va MOCKEADO para poder contar cuántas veces se acuña y con qué valor; el
// generador real tiene su propio test al final, contra el formato que valida el borde.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useState } from "react";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { PagoRegistradoDTO, RegistrarPagoResult } from "@/lib/types/liquidacion";
import {
  LIQUIDACION_MONTO_MAX,
  LIQUIDACION_NOTA_MAX,
  LIQUIDACION_REFERENCIA_MAX,
} from "@/lib/types/liquidacion";
import {
  LLAMADAS_PROHIBIDAS_EN_DINERO,
  codigoSinComentarios,
} from "@/tests/fixtures/money-safe";

const claveMock = vi.fn<() => string>();
vi.mock("@/components/shared/liquidacion/clave-idempotencia", () => ({
  nuevaClaveIdempotencia: () => claveMock(),
}));

import {
  RegistrarPagoDialog,
  type RegistrarPagoCampos,
} from "@/components/shared/liquidacion/RegistrarPagoDialog";
import { nuevaClaveIdempotencia } from "@/components/shared/liquidacion/clave-idempotencia";

// --- Datos ---------------------------------------------------------------

/** 09:00 de Costa Rica del 2 de agosto (15:00 UTC): el día CR es el 2, no el 3. */
const AHORA = new Date("2026-08-02T15:00:00.000Z");
const HOY_CR = "2026-08-02";

const CLAVE_A = "11111111-1111-4111-8111-111111111111";
const CLAVE_B = "22222222-2222-4222-8222-222222222222";

const COMPROBANTE: PagoRegistradoDTO = {
  id: "3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c",
  monto: "9000.00",
  metodo: "efectivo",
  referencia: null,
  nota: null,
  fechaPago: HOY_CR,
  registradoPorNombre: "Ana Maestra",
  registradoAt: "2026-08-02T15:04:05.000Z",
  esDeReparto: false, // feature 206: pago SUELTO, sin reparto
  anulacion: null,
};

const OK: RegistrarPagoResult = { status: "ok", pago: COMPROBANTE, restante: "0.00" };

// --- Montaje -------------------------------------------------------------

const registrarMock = vi.fn<(campos: RegistrarPagoCampos) => Promise<RegistrarPagoResult>>();
const registradoMock = vi.fn();

/**
 * Arnés que posee el `open`, como lo hace la pantalla real. Hace falta uno de verdad —y no
 * un `open` fijo— porque la mitad del contrato de la clave se mide CERRANDO y volviendo a
 * abrir el diálogo.
 */
function Arnes({ disponible = "9000.00" }: { disponible?: string }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Abrir de nuevo
      </button>
      <RegistrarPagoDialog
        open={open}
        onOpenChange={setOpen}
        beneficiario="Tienda Norte"
        disponible={disponible}
        onRegistrar={registrarMock}
        onRegistrado={registradoMock}
        ahora={AHORA}
      />
    </>
  );
}

const confirmar = () => screen.getByRole("button", { name: "Registrar pago" });
const montoInput = () => screen.getByLabelText(/^Monto/) as HTMLInputElement;
const referenciaInput = () => screen.getByLabelText(/^Referencia/) as HTMLInputElement;
const fechaInput = () => screen.getByLabelText(/^Fecha del pago/) as HTMLInputElement;
const notaInput = () => screen.getByLabelText(/^Nota/) as HTMLTextAreaElement;

function escribir(input: HTMLElement, valor: string) {
  fireEvent.change(input, { target: { value: valor } });
}

/** Elige un método en el `Select` de Base UI (abre el listbox y pulsa la opción). */
async function elegirMetodo(nombre: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox", { name: "Método" }));
  await user.click(await screen.findByRole("option", { name: nombre }));
}

/** Las claves de idempotencia que se han enviado, en orden. */
function clavesEnviadas(): string[] {
  return registrarMock.mock.calls.map(([campos]) => campos.claveIdempotencia);
}

beforeEach(() => {
  vi.clearAllMocks();
  claveMock.mockReturnValueOnce(CLAVE_A).mockReturnValue(CLAVE_B);
  registrarMock.mockResolvedValue(OK);
});

afterEach(() => {
  cleanup();
});

// -------------------------------------------------------------------------

describe("R30/R23 — el monto se propone y se puede bajar", () => {
  it("prefija el monto con el disponible que devolvió el servidor, TAL CUAL", () => {
    render(<Arnes disponible="9000.00" />);
    expect(montoInput().value).toBe("9000.00");
    // Y el disponible se enseña con su símbolo, sin recalcularlo.
    expect(screen.getByText("₡9.000,00")).toBeInTheDocument();
  });

  it("un monto MENOR se acepta y viaja tal cual: es el pago parcial (R23/R30)", async () => {
    render(<Arnes disponible="9000.00" />);
    escribir(montoInput(), "0.01");
    expect(confirmar()).toBeEnabled();

    fireEvent.click(confirmar());
    await waitFor(() => expect(registrarMock).toHaveBeenCalledTimes(1));
    expect(registrarMock.mock.calls[0][0].monto).toBe("0.01");
  });

  it("el diálogo NO compara el monto con el disponible: eso lo decide el servidor", async () => {
    // Comparar aquí sería aritmética de dinero en el navegador (R14) y además una decisión
    // tomada sobre una cifra que puede haber cambiado: quien sabe cuánto queda es el
    // servidor, bajo candado (R31/R46). El formulario deja pasar y pinta lo que le responden.
    registrarMock.mockResolvedValue({ status: "excede", disponible: "9000.00" });
    render(<Arnes disponible="9000.00" />);
    escribir(montoInput(), "9999.99");
    expect(confirmar()).toBeEnabled();

    fireEvent.click(confirmar());
    await waitFor(() => expect(registrarMock).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "El monto supera lo que se puede pagar. Disponible: ₡9.000,00.",
    );
  });
});

describe("R43/R47 — LA CLAVE DE IDEMPOTENCIA", () => {
  it("se acuña AL ABRIRSE, una sola vez, y antes de que nadie envíe nada", () => {
    render(<Arnes />);
    // Ya está acuñada con el diálogo recién abierto y sin haber pulsado Registrar.
    expect(claveMock).toHaveBeenCalledTimes(1);
    expect(registrarMock).not.toHaveBeenCalled();
  });

  it("REINTENTO tras un error de red: se manda LA MISMA clave", async () => {
    // Es el caso que impide el pago doble: la petición pudo llegar y escribirse aunque la
    // respuesta se perdiera. Con la misma clave, el servidor responde `ya_registrado`; con
    // una clave nueva, crearía un SEGUNDO pago y saldaría el saldo dos veces.
    registrarMock.mockRejectedValueOnce(new Error("Failed to fetch"));
    render(<Arnes />);

    fireEvent.click(confirmar());
    await waitFor(() => expect(registrarMock).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudo registrar el pago.",
    );

    fireEvent.click(confirmar());
    await waitFor(() => expect(registrarMock).toHaveBeenCalledTimes(2));

    expect(clavesEnviadas()).toEqual([CLAVE_A, CLAVE_A]);
    // Y no se acuñó ninguna clave nueva por el camino.
    expect(claveMock).toHaveBeenCalledTimes(1);
  });

  it("también conserva la clave si el diálogo se CIERRA y se vuelve a abrir tras fallar", async () => {
    // El reintento no siempre es un segundo clic: a veces el usuario cierra, respira y vuelve.
    // La solicitud sigue siendo la misma, así que la clave también.
    registrarMock.mockRejectedValueOnce(new Error("Failed to fetch"));
    render(<Arnes />);

    fireEvent.click(confirmar());
    await waitFor(() => expect(registrarMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(confirmar).toThrow());
    fireEvent.click(screen.getByRole("button", { name: "Abrir de nuevo" }));

    fireEvent.click(await screen.findByRole("button", { name: "Registrar pago" }));
    await waitFor(() => expect(registrarMock).toHaveBeenCalledTimes(2));
    expect(clavesEnviadas()).toEqual([CLAVE_A, CLAVE_A]);
    expect(claveMock).toHaveBeenCalledTimes(1);
  });

  it("un rechazo de DOMINIO tampoco renueva la clave (nada se escribió, es el mismo intento)", async () => {
    registrarMock.mockResolvedValueOnce({ status: "excede", disponible: "9000.00" });
    render(<Arnes />);

    fireEvent.click(confirmar());
    await waitFor(() => expect(registrarMock).toHaveBeenCalledTimes(1));
    escribir(montoInput(), "500.00");
    fireEvent.click(confirmar());
    await waitFor(() => expect(registrarMock).toHaveBeenCalledTimes(2));

    expect(clavesEnviadas()).toEqual([CLAVE_A, CLAVE_A]);
  });

  it("tras un registro EXITOSO, la siguiente apertura manda una clave DISTINTA", async () => {
    // La otra mitad: dos pagos legítimos al mismo beneficiario, por el mismo importe y el
    // mismo día, son DOS pagos (R45). Si la clave no se renovara, el segundo desaparecería
    // en silencio como «ya registrado» — el peor fallo posible en dinero, porque el saldo
    // quedaría alto y nadie vería el error.
    render(<Arnes />);

    fireEvent.click(confirmar());
    await waitFor(() => expect(registrarMock).toHaveBeenCalledTimes(1));
    // El diálogo se cerró solo al registrar.
    await waitFor(() => expect(confirmar).toThrow());

    fireEvent.click(screen.getByRole("button", { name: "Abrir de nuevo" }));
    fireEvent.click(await screen.findByRole("button", { name: "Registrar pago" }));
    await waitFor(() => expect(registrarMock).toHaveBeenCalledTimes(2));

    expect(clavesEnviadas()).toEqual([CLAVE_A, CLAVE_B]);
    expect(clavesEnviadas()[0]).not.toBe(clavesEnviadas()[1]);
    expect(claveMock).toHaveBeenCalledTimes(2);
  });

  it("R47: `ya_registrado` se trata como registrado — se informa y la clave se renueva", async () => {
    registrarMock.mockResolvedValueOnce({
      status: "ya_registrado",
      pago: COMPROBANTE,
      restante: "0.00",
    });
    render(<Arnes />);

    fireEvent.click(confirmar());
    await waitFor(() => expect(registradoMock).toHaveBeenCalledTimes(1));
    // Se avisa con el comprobante ORIGINAL, no con uno nuevo.
    expect(registradoMock.mock.calls[0][0]).toEqual(COMPROBANTE);

    fireEvent.click(screen.getByRole("button", { name: "Abrir de nuevo" }));
    fireEvent.click(await screen.findByRole("button", { name: "Registrar pago" }));
    await waitFor(() => expect(registrarMock).toHaveBeenCalledTimes(2));
    expect(clavesEnviadas()).toEqual([CLAVE_A, CLAVE_B]);
  });

  it("la clave viaja en CADA envío, y con el formato que valida el borde", async () => {
    render(<Arnes />);
    fireEvent.click(confirmar());
    await waitFor(() => expect(registrarMock).toHaveBeenCalledTimes(1));
    expect(registrarMock.mock.calls[0][0].claveIdempotencia).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});

describe("R14 — money-safe: el dinero es TEXTO de punta a punta", () => {
  it("el archivo del diálogo no convierte ni redondea ningún monto", () => {
    const codigo = codigoSinComentarios(
      "components/shared/liquidacion/RegistrarPagoDialog.tsx",
    );
    for (const prohibida of LLAMADAS_PROHIBIDAS_EN_DINERO) {
      expect(codigo, `el diálogo llama a ${prohibida}`).not.toMatch(prohibida);
    }
  });

  it("ningún campo del envío es un `number`, y el monto llega intacto al céntimo", async () => {
    // `1000.10` es el caso que delata un parseo: `Number("1000.10")` vale 1000.1 y al volver
    // a texto pierde el cero final. Con el monto como STRING de punta a punta, no pasa.
    render(<Arnes disponible="1000.10" />);
    escribir(notaInput(), "Con nota");
    fireEvent.click(confirmar());
    await waitFor(() => expect(registrarMock).toHaveBeenCalledTimes(1));

    const campos = registrarMock.mock.calls[0][0];
    for (const [clave, valor] of Object.entries(campos)) {
      expect(typeof valor, `campo ${clave}`).toBe("string");
    }
    expect(campos.monto).toBe("1000.10");
    expect(String(Number("1000.10"))).not.toBe("1000.10");
  });

  it("el monto MÁS GRANDE que la columna admite viaja entero, sin notación científica", async () => {
    render(<Arnes disponible={LIQUIDACION_MONTO_MAX} />);
    fireEvent.click(confirmar());
    await waitFor(() => expect(registrarMock).toHaveBeenCalledTimes(1));
    expect(registrarMock.mock.calls[0][0].monto).toBe("9999999999.99");
  });
});

describe("confirmar deshabilitado mientras el formulario no sea válido", () => {
  it.each([
    ["vacío", ""],
    ["cero", "0"],
    ["cero con decimales", "0.00"],
    ["tres decimales", "10.005"],
    ["con coma", "10,50"],
    ["negativo", "-5.00"],
    ["no numérico", "mucho"],
    ["un céntimo por encima del tope de la columna", "10000000000.00"],
  ])("monto %s → no se puede confirmar", (_caso, valor) => {
    render(<Arnes />);
    escribir(montoInput(), valor);
    expect(confirmar()).toBeDisabled();
  });

  it("el tope es el MISMO que revalida el borde, y su frontera es exacta", () => {
    render(<Arnes />);
    escribir(montoInput(), LIQUIDACION_MONTO_MAX);
    expect(confirmar()).toBeEnabled();
    escribir(montoInput(), "10000000000.00");
    expect(confirmar()).toBeDisabled();
  });

  it("SINPE sin referencia no se puede confirmar; con referencia, sí (R12)", async () => {
    render(<Arnes />);
    await elegirMetodo("SINPE");
    expect(confirmar()).toBeDisabled();

    escribir(referenciaInput(), "SINPE-8811");
    expect(confirmar()).toBeEnabled();
  });

  it("en efectivo la referencia es opcional: sin ella se puede confirmar", () => {
    render(<Arnes />);
    expect(referenciaInput().value).toBe("");
    expect(confirmar()).toBeEnabled();
  });

  it("una referencia por encima del tope no se puede confirmar, y su frontera es exacta", () => {
    render(<Arnes />);
    escribir(referenciaInput(), "R".repeat(LIQUIDACION_REFERENCIA_MAX));
    expect(confirmar()).toBeEnabled();
    escribir(referenciaInput(), "R".repeat(LIQUIDACION_REFERENCIA_MAX + 1));
    expect(confirmar()).toBeDisabled();
  });

  it("una nota por encima del tope no se puede confirmar, y su frontera es exacta", () => {
    render(<Arnes />);
    escribir(notaInput(), "n".repeat(LIQUIDACION_NOTA_MAX));
    expect(confirmar()).toBeEnabled();
    escribir(notaInput(), "n".repeat(LIQUIDACION_NOTA_MAX + 1));
    expect(confirmar()).toBeDisabled();
  });

  it("los topes de referencia y de nota son distintos y no se confunden", () => {
    render(<Arnes />);
    const texto = "x".repeat(LIQUIDACION_REFERENCIA_MAX + 1);
    escribir(notaInput(), texto); // válido como nota…
    expect(confirmar()).toBeEnabled();
    escribir(referenciaInput(), texto); // …e inválido como referencia
    expect(confirmar()).toBeDisabled();
  });

  it("R10: la fecha de MAÑANA en hora de Costa Rica no se puede confirmar", () => {
    render(<Arnes />);
    expect(fechaInput().value).toBe(HOY_CR);
    expect(confirmar()).toBeEnabled();

    escribir(fechaInput(), "2026-08-03");
    expect(confirmar()).toBeDisabled();
    // Ayer sí: un pago se puede anotar al día siguiente.
    escribir(fechaInput(), "2026-08-01");
    expect(confirmar()).toBeEnabled();
  });

  it("el día por defecto es el de COSTA RICA, no el de UTC", () => {
    // A las 20:00 de CR el día UTC ya es el siguiente. Si el default saliera de `toISOString`,
    // el formulario nacería con una fecha FUTURA y el borde lo rechazaría.
    cleanup();
    render(
      <RegistrarPagoDialog
        open
        onOpenChange={() => {}}
        beneficiario="Tienda Norte"
        disponible="9000.00"
        onRegistrar={registrarMock}
        ahora={new Date("2026-08-03T02:00:00.000Z")}
      />,
    );
    expect((screen.getByLabelText(/^Fecha del pago/) as HTMLInputElement).value).toBe(
      "2026-08-02",
    );
    expect(screen.getByRole("button", { name: "Registrar pago" })).toBeEnabled();
  });

  it("un formulario inválido no llama al servidor aunque se fuerce el clic", () => {
    render(<Arnes />);
    escribir(montoInput(), "0");
    fireEvent.click(confirmar());
    expect(registrarMock).not.toHaveBeenCalled();
  });
});

describe("lo que se manda y lo que responde el servidor", () => {
  it("los campos opcionales vacíos NO se mandan (el schema del borde es `.strict()`)", async () => {
    render(<Arnes />);
    fireEvent.click(confirmar());
    await waitFor(() => expect(registrarMock).toHaveBeenCalledTimes(1));

    expect(registrarMock.mock.calls[0][0]).toEqual({
      claveIdempotencia: CLAVE_A,
      monto: "9000.00",
      metodo: "efectivo",
      fechaPago: HOY_CR,
    });
  });

  it("con referencia y nota, van recortadas y en su campo", async () => {
    render(<Arnes />);
    await elegirMetodo("Transferencia");
    escribir(referenciaInput(), "  TRF-99  ");
    escribir(notaInput(), "  pago de julio  ");
    fireEvent.click(confirmar());
    await waitFor(() => expect(registrarMock).toHaveBeenCalledTimes(1));

    expect(registrarMock.mock.calls[0][0]).toMatchObject({
      metodo: "transferencia",
      referencia: "TRF-99",
      nota: "pago de julio",
    });
  });

  it("un `validation_error` del borde se pinta EN SU CAMPO", async () => {
    registrarMock.mockResolvedValueOnce({
      status: "validation_error",
      fieldErrors: { referencia: ["La referencia es obligatoria en SINPE y transferencia."] },
    });
    render(<Arnes />);
    fireEvent.click(confirmar());

    const error = await screen.findByText(
      "La referencia es obligatoria en SINPE y transferencia.",
    );
    expect(error).toHaveAttribute("role", "alert");
    // Y el campo queda marcado como inválido y enlazado con su mensaje.
    expect(referenciaInput()).toHaveAttribute("aria-invalid", "true");
    expect(referenciaInput().getAttribute("aria-describedby")).toContain(error.id);
  });

  it.each([
    ["forbidden", "No tienes permiso para registrar pagos."],
    ["sin_saldo", "Esta tienda no tiene saldo a favor, así que no hay nada que pagar."],
    ["cierre_no_aprobado", "El cierre no está aprobado, así que todavía no se puede pagar."],
    ["unauthenticated", "Tu sesión expiró. Inicia sesión de nuevo."],
  ])("el estado `%s` se explica y deja el diálogo abierto", async (status, mensaje) => {
    registrarMock.mockResolvedValueOnce({ status } as RegistrarPagoResult);
    render(<Arnes />);
    fireEvent.click(confirmar());

    expect(await screen.findByRole("alert")).toHaveTextContent(mensaje);
    // No se cerró, así que lo escrito no se pierde.
    expect(confirmar()).toBeInTheDocument();
    expect(registradoMock).not.toHaveBeenCalled();
  });

  it("tras registrar, el diálogo se cierra y avisa con el comprobante del servidor", async () => {
    render(<Arnes />);
    fireEvent.click(confirmar());

    await waitFor(() => expect(registradoMock).toHaveBeenCalledTimes(1));
    expect(registradoMock.mock.calls[0][0]).toEqual(COMPROBANTE);
    await waitFor(() => expect(confirmar).toThrow());
  });
});

describe("accesibilidad", () => {
  it("el diálogo se nombra por su beneficiario y sus campos tienen etiqueta", () => {
    render(<Arnes />);
    expect(
      screen.getByRole("dialog", { name: /Registrar pago a Tienda Norte/ }),
    ).toBeInTheDocument();
    for (const etiqueta of [/^Monto/, /^Referencia/, /^Fecha del pago/, /^Nota/]) {
      expect(screen.getByLabelText(etiqueta)).toBeInTheDocument();
    }
    expect(screen.getByRole("combobox", { name: "Método" })).toBeInTheDocument();
  });

  it("los campos obligatorios se anuncian como tales", () => {
    render(<Arnes />);
    expect(montoInput()).toHaveAttribute("aria-required", "true");
    expect(fechaInput()).toHaveAttribute("aria-required", "true");
    // La nota es opcional y no lo finge.
    expect(notaInput()).not.toHaveAttribute("aria-required");
  });

  it("dos diálogos montados a la vez no comparten los ids de sus campos", () => {
    render(
      <>
        <RegistrarPagoDialog
          open
          onOpenChange={() => {}}
          beneficiario="Tienda Norte"
          disponible="1.00"
          onRegistrar={registrarMock}
          ahora={AHORA}
        />
        <RegistrarPagoDialog
          open
          onOpenChange={() => {}}
          beneficiario="Tienda Sur"
          disponible="2.00"
          onRegistrar={registrarMock}
          ahora={AHORA}
        />
      </>,
    );
    const montos = screen.getAllByLabelText(/^Monto/);
    expect(montos).toHaveLength(2);
    expect(montos[0].id).not.toBe(montos[1].id);
  });
});

describe("el generador REAL de la clave", () => {
  it("produce un uuid v4, que es lo que valida el borde", async () => {
    const { nuevaClaveIdempotencia: real } = await vi.importActual<
      typeof import("@/components/shared/liquidacion/clave-idempotencia")
    >("@/components/shared/liquidacion/clave-idempotencia");
    const clave = real();
    expect(clave).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("dos llamadas nunca devuelven la misma clave", async () => {
    const { nuevaClaveIdempotencia: real } = await vi.importActual<
      typeof import("@/components/shared/liquidacion/clave-idempotencia")
    >("@/components/shared/liquidacion/clave-idempotencia");
    const claves = new Set(Array.from({ length: 200 }, () => real()));
    expect(claves.size).toBe(200);
  });

  it("el diálogo usa este generador y no uno propio", () => {
    // El mock de arriba solo prueba algo si el componente importa de aquí.
    expect(typeof nuevaClaveIdempotencia).toBe("function");
    render(<Arnes />);
    expect(claveMock).toHaveBeenCalled();
  });
});
