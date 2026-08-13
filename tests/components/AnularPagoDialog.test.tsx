// @vitest-environment jsdom
// Feature 172 (T F.5) — el DIÁLOGO de anulación. Cubre R72, R74, R76 y la mitad visible de R81.
//
// Lo que este diálogo tiene que garantizar es corto y duro: que **sin motivo no sale nada**,
// que lo que se manda son DOS datos —el pago y el porqué, jamás un monto (R70/R76)— y que un
// rechazo del servidor se dice en la pantalla en vez de tragarse.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AnularPagoDialog } from "@/components/shared/liquidacion/AnularPagoDialog";
import type {
  AnularPagoResult,
  AnularRepartoResult,
  PagoRegistradoDTO,
} from "@/lib/types/liquidacion";
import {
  LLAMADAS_PROHIBIDAS_EN_DINERO,
  codigoSinComentarios,
} from "@/tests/fixtures/money-safe";

// --- Datos ---------------------------------------------------------------

const PAGO: PagoRegistradoDTO = {
  id: "3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c",
  monto: "4000.10",
  metodo: "SINPE",
  referencia: "SINPE-88112233",
  nota: "Liquidación de julio",
  fechaPago: "2026-07-30",
  registradoPorNombre: "Ana Maestra",
  registradoAt: "2026-08-02T15:04:05.000Z",
  esDeReparto: false, // feature 206: pago SUELTO, sin reparto
  anulacion: null,
};

const ANULADO: PagoRegistradoDTO = {
  ...PAGO,
  anulacion: {
    motivo: "Se tecleó el monto de otra tienda",
    anuladoPorNombre: "Ana Maestra",
    anuladoAt: "2026-08-05T09:30:00.000Z",
  },
};

const OK: AnularPagoResult = { status: "ok", pago: ANULADO, restante: "9000.00" };

const anularMock = vi.fn<(motivo: string) => Promise<AnularPagoResult>>();
const anuladoMock = vi.fn();
const openChangeMock = vi.fn();

function montar(extra: Record<string, unknown> = {}) {
  return render(
    <AnularPagoDialog
      open
      onOpenChange={openChangeMock}
      pago={PAGO}
      beneficiario="Tienda Norte"
      onAnular={anularMock}
      onAnulado={anuladoMock}
      {...extra}
    />,
  );
}

const dialogo = () => screen.getByRole("dialog");
const confirmar = () => within(dialogo()).getByRole("button", { name: "Anular pago" });
const motivo = () => within(dialogo()).getByLabelText(/^Motivo de la anulación/);

beforeEach(() => {
  vi.clearAllMocks();
  anularMock.mockResolvedValue(OK);
});

afterEach(() => {
  cleanup();
});

// -------------------------------------------------------------------------

describe("R72 — sin motivo no se envía", () => {
  it("nace con el confirmar deshabilitado y el motivo en blanco", () => {
    montar();
    expect((motivo() as HTMLTextAreaElement).value).toBe("");
    expect(confirmar()).toBeDisabled();
  });

  it("un motivo de SOLO ESPACIOS tampoco lo habilita: no es un motivo", async () => {
    const user = userEvent.setup();
    montar();
    await user.type(motivo(), "   ");

    expect(confirmar()).toBeDisabled();
  });

  it("SEGUNDA BARRERA: pulsar con el motivo en blanco no manda ninguna petición", async () => {
    // Este caso NO mira el botón: mira que no salga nada. Es la barrera que sigue en pie si
    // alguien quita el `confirmDisabled` — y está aparte justo para poder medirla sola.
    const user = userEvent.setup();
    montar();
    await user.type(motivo(), "   ");
    await user.click(confirmar());

    expect(anularMock).not.toHaveBeenCalled();
  });

  it("con motivo se habilita, y lo que viaja es el motivo SIN espacios de sobra", async () => {
    const user = userEvent.setup();
    montar();
    await user.type(motivo(), "  Monto equivocado  ");

    expect(confirmar()).toBeEnabled();
    await user.click(confirmar());

    await waitFor(() => expect(anularMock).toHaveBeenCalledTimes(1));
    expect(anularMock).toHaveBeenCalledWith("Monto equivocado");
  });

  it("el campo se anuncia como obligatorio y su error se asocia al control", async () => {
    const user = userEvent.setup();
    anularMock.mockResolvedValue({
      status: "validation_error",
      fieldErrors: { motivo: ["El motivo de la anulacion es obligatorio."] },
    });
    montar();

    const campo = motivo();
    expect(campo).toHaveAttribute("aria-required", "true");

    await user.type(campo, "algo");
    await user.click(confirmar());

    const error = await within(dialogo()).findByText(
      "El motivo de la anulacion es obligatorio.",
    );
    expect(error).toHaveAttribute("role", "alert");
    // El control apunta al error: quien navega con lector de pantalla lo oye al enfocarlo.
    expect(motivo().getAttribute("aria-describedby") ?? "").toContain(
      error.getAttribute("id"),
    );
    expect(motivo()).toHaveAttribute("aria-invalid", "true");
  });
});

describe("R70/R76 — se anula ENTERO y sin mandar ningún monto", () => {
  it("la anulación se pide con UN solo dato: el motivo", async () => {
    const user = userEvent.setup();
    montar();
    await user.type(motivo(), "Monto equivocado");
    await user.click(confirmar());

    await waitFor(() => expect(anularMock).toHaveBeenCalledTimes(1));
    // Un solo argumento, y es texto: no hay forma de colar un importe parcial desde aquí.
    expect(anularMock.mock.calls[0]).toHaveLength(1);
    expect(typeof anularMock.mock.calls[0][0]).toBe("string");
  });

  it("no ofrece ningún campo de monto: no existe la anulación parcial", () => {
    montar();
    expect(within(dialogo()).queryByLabelText(/monto/i)).not.toBeInTheDocument();
    expect(within(dialogo()).getAllByRole("textbox")).toHaveLength(1);
  });
});

describe("R74 — el diálogo dice QUÉ pago se está anulando", () => {
  it("nombra al beneficiario y resume monto, día y método", () => {
    montar();
    expect(screen.getByRole("dialog", { name: /Tienda Norte/ })).toBeInTheDocument();
    expect(
      within(dialogo()).getByText("Pago de ₡4.000,10 del 2026-07-30, en SINPE."),
    ).toBeInTheDocument();
  });

  it("explica que anular NO borra el pago", () => {
    montar();
    expect(within(dialogo()).getByText(/El pago no se borra/)).toBeInTheDocument();
  });
});

describe("la respuesta del servidor se traduce, no se traga", () => {
  it("`ok`: avisa a quien lo montó con el resultado y cierra", async () => {
    const user = userEvent.setup();
    montar();
    await user.type(motivo(), "Monto equivocado");
    await user.click(confirmar());

    await waitFor(() => expect(anuladoMock).toHaveBeenCalledTimes(1));
    expect(anuladoMock).toHaveBeenCalledWith(OK);
    expect(openChangeMock).toHaveBeenCalledWith(false);
  });

  it("`ya_anulado`: también cierra — el pago está como se quería (R75)", async () => {
    const user = userEvent.setup();
    const yaAnulado: AnularPagoResult = { status: "ya_anulado", pago: ANULADO };
    anularMock.mockResolvedValue(yaAnulado);
    montar();
    await user.type(motivo(), "Monto equivocado");
    await user.click(confirmar());

    await waitFor(() => expect(anuladoMock).toHaveBeenCalledWith(yaAnulado));
    expect(openChangeMock).toHaveBeenCalledWith(false);
  });

  it.each([
    ["forbidden", "No tienes permiso para anular pagos."],
    ["unauthenticated", "Tu sesión expiró. Inicia sesión de nuevo."],
    [
      "no_encontrado",
      "No se encontró el pago. Vuelve a abrir la pantalla e inténtalo de nuevo.",
    ],
  ])("`%s`: lo dice y NO cierra el diálogo", async (status, mensaje) => {
    const user = userEvent.setup();
    anularMock.mockResolvedValue({ status } as AnularPagoResult);
    montar();
    await user.type(motivo(), "Monto equivocado");
    await user.click(confirmar());

    expect(await within(dialogo()).findByText(mensaje)).toBeInTheDocument();
    expect(anuladoMock).not.toHaveBeenCalled();
    expect(openChangeMock).not.toHaveBeenCalledWith(false);
    // Y lo escrito sigue ahí para reintentar sin volver a teclearlo.
    expect((motivo() as HTMLTextAreaElement).value).toBe("Monto equivocado");
  });

  it("un fallo de RED se cuenta y el diálogo sigue en pie", async () => {
    const user = userEvent.setup();
    anularMock.mockRejectedValue(new Error("network"));
    montar();
    await user.type(motivo(), "Monto equivocado");
    await user.click(confirmar());

    expect(
      await within(dialogo()).findByText("No se pudo anular el pago. Vuelve a intentarlo."),
    ).toBeInTheDocument();
    expect(anuladoMock).not.toHaveBeenCalled();
    expect(openChangeMock).not.toHaveBeenCalledWith(false);
  });

  it("cancelar cierra sin llamar a nada", async () => {
    const user = userEvent.setup();
    montar();
    await user.type(motivo(), "Monto equivocado");
    await user.click(within(dialogo()).getByRole("button", { name: "Cancelar" }));

    expect(anularMock).not.toHaveBeenCalled();
    expect(openChangeMock).toHaveBeenCalledWith(false);
  });
});

describe("R14 — money-safe", () => {
  it("el diálogo no convierte ni redondea ningún monto", () => {
    const codigo = codigoSinComentarios(
      "components/shared/liquidacion/AnularPagoDialog.tsx",
    );
    for (const prohibida of LLAMADAS_PROHIBIDAS_EN_DINERO) {
      expect(codigo, `el diálogo llama a ${prohibida}`).not.toMatch(prohibida);
    }
  });

  it("el monto del pago se pinta TAL CUAL, hasta el tope de la columna", () => {
    montar({ pago: { ...PAGO, monto: "9999999999.99" } });
    expect(
      within(dialogo()).getByText(/₡9\.999\.999\.999,99/),
    ).toBeInTheDocument();
  });
});

/**
 * Feature 206 — EL ALCANCE.
 *
 * La opción agrupada existe si y solo si se cumplen LAS DOS condiciones: el pago pertenece a un
 * reparto y quien monta ofrece el acto. Se prueban las dos por separado, porque una sola de ellas
 * pasando por «la condición» dejaría que la otra se rompiera sin que nada lo dijera.
 */
describe("feature 206 — anular el reparto completo", () => {
  const DEL_REPARTO: PagoRegistradoDTO = { ...PAGO, esDeReparto: true };
  const repartoMock = vi.fn<(motivo: string) => Promise<AnularRepartoResult>>();
  const repartoAnuladoMock = vi.fn();

  function montarConReparto(extra: Record<string, unknown> = {}) {
    return montar({
      pago: DEL_REPARTO,
      onAnularReparto: repartoMock,
      onRepartoAnulado: repartoAnuladoMock,
      ...extra,
    });
  }

  const opcionGrupo = () =>
    within(dialogo()).getByRole("radio", { name: /Todas las imputaciones/ });

  beforeEach(() => {
    repartoMock.mockResolvedValue({ status: "ok", anuladas: 3, yaEstaban: 0 });
  });

  it("un pago SUELTO no ofrece el alcance, aunque se pase la función", () => {
    montar({ onAnularReparto: repartoMock, onRepartoAnulado: repartoAnuladoMock });
    expect(within(dialogo()).queryByRole("radio")).not.toBeInTheDocument();
  });

  it("un pago DE UN REPARTO sin la función tampoco lo ofrece", () => {
    montar({ pago: DEL_REPARTO });
    expect(within(dialogo()).queryByRole("radio")).not.toBeInTheDocument();
  });

  it("con las dos condiciones ofrece el alcance, y viene marcado «solo este pago»", () => {
    montarConReparto();
    expect(
      within(dialogo()).getByRole("radio", { name: /Solo este pago/ }),
    ).toBeChecked();
    expect(opcionGrupo()).not.toBeChecked();
  });

  it("POR DEFECTO anula solo el pago: el acto agrupado hay que pedirlo", async () => {
    const user = userEvent.setup();
    montarConReparto();
    await user.type(motivo(), "Reparto mal imputado");
    await user.click(confirmar());

    await waitFor(() => expect(anularMock).toHaveBeenCalledTimes(1));
    expect(repartoMock).not.toHaveBeenCalled();
  });

  it("al elegir el grupo manda el motivo por el camino agrupado y NO por el individual", async () => {
    const user = userEvent.setup();
    montarConReparto();
    await user.click(opcionGrupo());
    await user.type(motivo(), "Reparto mal imputado");
    await within(dialogo()).getByRole("button", { name: "Anular el reparto" }).click();

    await waitFor(() => expect(repartoMock).toHaveBeenCalledWith("Reparto mal imputado"));
    expect(anularMock).not.toHaveBeenCalled();
  });

  it("el botón cambia de etiqueta con el alcance: dice QUÉ va a pasar", async () => {
    const user = userEvent.setup();
    montarConReparto();
    expect(confirmar()).toBeInTheDocument(); // «Anular pago»
    await user.click(opcionGrupo());
    expect(
      within(dialogo()).getByRole("button", { name: "Anular el reparto" }),
    ).toBeInTheDocument();
  });

  it("el reparto A MEDIAS informa de las DOS cifras", async () => {
    const user = userEvent.setup();
    repartoMock.mockResolvedValue({ status: "ok", anuladas: 2, yaEstaban: 1 });
    montarConReparto();
    await user.click(opcionGrupo());
    await user.type(motivo(), "Reparto mal imputado");
    await within(dialogo()).getByRole("button", { name: "Anular el reparto" }).click();

    await waitFor(() =>
      expect(repartoAnuladoMock).toHaveBeenCalledWith({
        status: "ok",
        anuladas: 2,
        yaEstaban: 1,
      }),
    );
  });

  it("un reparto ya anulado por completo también cierra, y avisa", async () => {
    const user = userEvent.setup();
    repartoMock.mockResolvedValue({ status: "sin_vigentes", yaEstaban: 3 });
    montarConReparto();
    await user.click(opcionGrupo());
    await user.type(motivo(), "Reparto mal imputado");
    await within(dialogo()).getByRole("button", { name: "Anular el reparto" }).click();

    await waitFor(() =>
      expect(repartoAnuladoMock).toHaveBeenCalledWith({ status: "sin_vigentes", yaEstaban: 3 }),
    );
    expect(openChangeMock).toHaveBeenCalledWith(false);
  });

  it("SIN MOTIVO no sale nada por el camino agrupado tampoco", async () => {
    const user = userEvent.setup();
    montarConReparto();
    await user.click(opcionGrupo());
    // El confirmar sigue deshabilitado: la barrera del motivo no depende del alcance.
    expect(within(dialogo()).getByRole("button", { name: "Anular el reparto" })).toBeDisabled();
    expect(repartoMock).not.toHaveBeenCalled();
  });

  it("un fallo del servidor deja el diálogo ABIERTO y lo dice", async () => {
    const user = userEvent.setup();
    repartoMock.mockRejectedValue(new Error("red"));
    montarConReparto();
    await user.click(opcionGrupo());
    await user.type(motivo(), "Reparto mal imputado");
    await within(dialogo()).getByRole("button", { name: "Anular el reparto" }).click();

    await waitFor(() =>
      expect(within(dialogo()).getByRole("alert")).toHaveTextContent(
        /No se pudo anular el reparto/,
      ),
    );
    expect(openChangeMock).not.toHaveBeenCalledWith(false);
  });
});
