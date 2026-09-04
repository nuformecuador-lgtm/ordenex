// @vitest-environment jsdom
// FICHA 371 (UI) — la PANTALLA que corrige la fecha de una reprogramación ya registrada. Se
// ejercita el componente REAL; lo único mockeado es el borde (la Server Action).
//
// ⚠️ LOS LITERALES DE LO QUE SE LEE VAN ESCRITOS A MANO, nunca importados del módulo de textos que
// el componente usa. Un test que compara el texto contra la constante que lo produce está verde
// por construcción: afirma «la función devuelve lo que devuelve» y deja pasar cualquier cambio de
// lo que el coordinador lee. Si estas cadenas dejan de casar, es que alguien cambió la pantalla, y
// eso tiene que doler. (Misma regla que `CambiarDiaRepartoModal.test.tsx`.)
//
// Lo que SÍ se importa son las CONSTANTES DE PROTOCOLO —los motivos tipados del `conflict`—:
// ésas no son texto de usuario, son el contrato entre el service y esta pantalla.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CorregirFechaReprogramacionModal } from "@/app/(app)/ordenes/_components/CorregirFechaReprogramacionModal";
import { corregirFechaReprogramacion } from "@/lib/actions/corregir-fecha-reprogramacion";
import {
  MSG_CARRERA,
  MSG_YA_ES_ESA_FECHA,
  msgEstadoNoReprogramada,
} from "@/lib/services/mensajes-correccion-fecha-reprogramacion";

vi.mock("@/lib/actions/corregir-fecha-reprogramacion", () => ({
  corregirFechaReprogramacion: vi.fn(),
}));

const corregirMock = vi.mocked(corregirFechaReprogramacion);

/**
 * El «hoy» baja de la PÁGINA, resuelto en el servidor con el día de Costa Rica. Aquí es un
 * literal fijo y deliberadamente lejano al día en que corre la suite: si el componente leyera el
 * reloj del navegador, el `min` del campo no sería éste.
 */
const HOY = "2026-09-03";
/** El caso REAL que origina la ficha: reprogramada al 4 cuando el motivo decía «para mañana». */
const FECHA_ACTUAL = "2026-09-04";

const CONFIRMAR = "Corregir fecha";
const MOTIVO_OK = "el mensajero marcó el 4 y el motivo decía mañana";

const ORDEN = {
  id: "11111111-1111-4111-8111-111111111111",
  numRemision: "REM-1",
  fechaReprogramacion: FECHA_ACTUAL,
};

function renderModal(
  ordenes: readonly {
    id: string;
    numRemision: string;
    fechaReprogramacion?: string | null;
  }[] = [ORDEN],
  hoyISO = HOY,
) {
  const onSuccess = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <CorregirFechaReprogramacionModal
      open
      ordenes={ordenes}
      hoyISO={hoyISO}
      onOpenChange={onOpenChange}
      onSuccess={onSuccess}
    />,
  );
  return { onSuccess, onOpenChange };
}

/** El botón que escribe (el `Modal` lo pinta en un portal al final del body). */
function confirmar() {
  return screen.getByRole("button", { name: CONFIRMAR });
}

function campoFecha(): HTMLInputElement {
  return screen.getByLabelText("Nueva fecha") as HTMLInputElement;
}

function campoMotivo(): HTMLTextAreaElement {
  return screen.getByLabelText("Motivo") as HTMLTextAreaElement;
}

/** Rellena el formulario entero, listo para confirmar. */
async function llenar(
  user: ReturnType<typeof userEvent.setup>,
  fecha: string,
  motivo: string,
) {
  fireEvent.change(campoFecha(), { target: { value: fecha } });
  if (motivo !== "") await user.type(campoMotivo(), motivo);
}

/** Un resultado `ok` del borde, con el desenlace que se quiera probar. */
function resultadoOk(
  liberacion: "liberada" | "espera_cierre" | "espera_fecha",
  fechaNueva = HOY,
) {
  return {
    status: "ok" as const,
    ordenId: ORDEN.id,
    gestionId: "22222222-2222-4222-8222-222222222222",
    fechaAnterior: FECHA_ACTUAL,
    fechaNueva,
    liberacion,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  corregirMock.mockResolvedValue(resultadoOk("liberada"));
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// 1. La fecha ACTUAL, antes de corregir
// ---------------------------------------------------------------------------
describe("el modal enseña la fecha para la que la orden está reprogramada HOY", () => {
  it("la nombra junto al nº de remisión y EN PALABRAS, sin `YYYY-MM-DD` a la vista", () => {
    renderModal();

    // Sin esto se corrige a ciegas, que es exactamente cómo se llega a la SEGUNDA fecha
    // equivocada. La fecha llega ya resuelta del servidor: aquí no se interpreta nada.
    expect(
      screen.getByText("REM-1 · Ahora está reprogramada para el 4 de septiembre."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/2026-09-04/)).not.toBeInTheDocument();
  });

  it("una orden SIN fecha no deja el hueco en blanco: lo dice", () => {
    renderModal([{ id: "o2", numRemision: "REM-2", fechaReprogramacion: null }]);

    expect(
      screen.getByText("REM-2 · Esta orden no tiene una fecha de reprogramación registrada."),
    ).toBeInTheDocument();
  });

  it("con más de una orden marcada no corrige a medias: dice que es de una en una", async () => {
    const user = userEvent.setup();
    renderModal([ORDEN, { id: "o2", numRemision: "REM-2", fechaReprogramacion: HOY }]);

    expect(
      screen.getByText(
        "Esta corrección se hace de una orden a la vez. Deja marcada solo la que quieres corregir.",
      ),
    ).toBeInTheDocument();
    // Y el botón que escribe está apagado: corregir una de las dos en silencio sería el fallo
    // mudo que este repo ya conoce.
    expect(confirmar()).toBeDisabled();
    await user.click(confirmar());
    expect(corregirMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 2. El mínimo es HOY, no mañana
// ---------------------------------------------------------------------------
describe("el mínimo del campo de fecha es HOY", () => {
  it("el campo declara `min` = hoy, y hoy baja del servidor (no de ningún reloj del navegador)", () => {
    renderModal();

    // Con `min` = mañana la UI sería MÁS ESTRICTA que el borde (`fechaCorreccionSchema` admite
    // hoy) y volvería a bloquear justo el caso que esta ficha viene a resolver.
    expect(campoFecha()).toHaveAttribute("min", HOY);
  });

  it("⭑ corregir del 4 al 3 ESTANDO A DÍA 3 llega a la acción: es el caso real de la ficha", async () => {
    const user = userEvent.setup();
    renderModal();

    await llenar(user, HOY, MOTIVO_OK);
    await user.click(confirmar());

    await waitFor(() => expect(corregirMock).toHaveBeenCalledTimes(1));
    expect(corregirMock).toHaveBeenCalledWith({
      ordenId: ORDEN.id,
      fecha: HOY,
      motivo: MOTIVO_OK,
    });
  });

  it("una fecha ANTERIOR a hoy no llega a la acción y se marca el campo", async () => {
    const user = userEvent.setup();
    renderModal();

    await llenar(user, "2026-09-02", MOTIVO_OK);
    await user.click(confirmar());

    expect(corregirMock).not.toHaveBeenCalled();
    expect(screen.getByText("La fecha debe ser hoy o posterior.")).toBeInTheDocument();
    expect(campoFecha()).toHaveAttribute("aria-invalid", "true");
  });
});

// ---------------------------------------------------------------------------
// 3. El motivo es obligatorio
// ---------------------------------------------------------------------------
describe("el motivo es obligatorio, con la misma regla que reprogramar (no vacío)", () => {
  it("confirmar SIN motivo no llama a la acción y marca EL CAMPO", async () => {
    const user = userEvent.setup();
    renderModal();

    await llenar(user, HOY, "");
    await user.click(confirmar());

    expect(corregirMock).not.toHaveBeenCalled();
    // El error va JUNTO AL CAMPO, no en un aviso genérico: es lo que dice qué falta.
    expect(screen.getByText("Escribe el motivo de la corrección.")).toBeInTheDocument();
    expect(campoMotivo()).toHaveAttribute("aria-invalid", "true");
  });

  it("un motivo de solo espacios cuenta como vacío (el borde lo recorta antes de medir)", async () => {
    const user = userEvent.setup();
    renderModal();

    await llenar(user, HOY, "   ");
    await user.click(confirmar());

    expect(corregirMock).not.toHaveBeenCalled();
    expect(screen.getByText("Escribe el motivo de la corrección.")).toBeInTheDocument();
  });

  it("el motivo viaja RECORTADO cuando sí es válido", async () => {
    const user = userEvent.setup();
    renderModal();

    await llenar(user, HOY, `  ${MOTIVO_OK}  `);
    await user.click(confirmar());

    await waitFor(() => expect(corregirMock).toHaveBeenCalledTimes(1));
    expect(corregirMock.mock.calls[0][0]).toMatchObject({ motivo: MOTIVO_OK });
  });
});

// ---------------------------------------------------------------------------
// 4. ⭑ LOS TRES DESENLACES
// ---------------------------------------------------------------------------

/** Los tres textos, ESCRITOS A MANO: es lo que el coordinador lee. */
const TEXTO_LIBERADA =
  "Fecha corregida: del 4 de septiembre al 3 de septiembre. La orden ya volvió a la bodega y se le puede asignar mensajero.";
const TEXTO_ESPERA_CIERRE =
  "Fecha corregida: del 4 de septiembre al 3 de septiembre. La orden todavía NO vuelve a la bodega: falta que se apruebe el cierre donde el mensajero reportó esa reprogramación. En cuanto se apruebe, la orden vuelve sola.";
const TEXTO_ESPERA_FECHA =
  "Fecha corregida: del 4 de septiembre al 6 de septiembre. La orden espera a ese día: vuelve sola a la bodega cuando llegue.";

async function corregirCon(
  liberacion: "liberada" | "espera_cierre" | "espera_fecha",
  fechaNueva = HOY,
) {
  const user = userEvent.setup();
  corregirMock.mockResolvedValue(resultadoOk(liberacion, fechaNueva));
  const handles = renderModal();
  await llenar(user, fechaNueva, MOTIVO_OK);
  await user.click(confirmar());
  await waitFor(() => expect(corregirMock).toHaveBeenCalledTimes(1));
  return handles;
}

describe("⭑ el desenlace se CUENTA, y los tres dicen cosas distintas", () => {
  it("`liberada`: la orden volvió a la bodega y ya se le puede asignar", async () => {
    await corregirCon("liberada");

    expect(await screen.findByText(TEXTO_LIBERADA)).toBeInTheDocument();
    // Y no dice ninguna de las otras dos cosas: colapsar dos desenlaces en un mismo mensaje es
    // volver a la confusión que esta ficha vino a quitar.
    expect(screen.queryByText(TEXTO_ESPERA_CIERRE)).not.toBeInTheDocument();
    expect(screen.queryByText(TEXTO_ESPERA_FECHA)).not.toBeInTheDocument();
  });

  it("⭑ `espera_cierre`: dice que la orden SIGUE RETENIDA y QUÉ FALTA para que salga", async () => {
    await corregirCon("espera_cierre");

    // Le pasa a 7 de las 31 que esperan hoy. Si la pantalla sólo dijera «listo», el coordinador
    // miraría el listado, vería la orden igual de bloqueada y no entendería nada.
    expect(await screen.findByText(TEXTO_ESPERA_CIERRE)).toBeInTheDocument();
    expect(screen.queryByText(TEXTO_LIBERADA)).not.toBeInTheDocument();
    expect(screen.queryByText(TEXTO_ESPERA_FECHA)).not.toBeInTheDocument();
  });

  it("`espera_fecha`: se corrigió a un día futuro y espera al calendario", async () => {
    await corregirCon("espera_fecha", "2026-09-06");

    expect(await screen.findByText(TEXTO_ESPERA_FECHA)).toBeInTheDocument();
    expect(screen.queryByText(TEXTO_LIBERADA)).not.toBeInTheDocument();
    expect(screen.queryByText(TEXTO_ESPERA_CIERRE)).not.toBeInTheDocument();
  });

  it("el modal NO se cierra al corregir: el desenlace se queda a la vista, y el listado se relee", async () => {
    const { onSuccess, onOpenChange } = await corregirCon("espera_cierre");

    await screen.findByText(TEXTO_ESPERA_CIERRE);
    // Cerrar aquí se llevaría por delante el único sitio donde se dice qué pasó con la orden.
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(onSuccess).toHaveBeenCalledTimes(1);
    // Ya no hay nada que confirmar: queda el botón de cerrar.
    expect(screen.queryByRole("button", { name: CONFIRMAR })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cerrar" })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 5. Los rechazos del servidor, con su causa real
// ---------------------------------------------------------------------------
describe("un rechazo dice POR QUÉ, dentro del modal", () => {
  it("`conflict` con «ya es esa fecha» se traduce a una salida concreta", async () => {
    const user = userEvent.setup();
    corregirMock.mockResolvedValue({ status: "conflict", motivo: MSG_YA_ES_ESA_FECHA });
    renderModal();

    await llenar(user, HOY, MOTIVO_OK);
    await user.click(confirmar());

    expect(
      await screen.findByText("La orden ya está reprogramada para esa fecha. Elige otra."),
    ).toBeInTheDocument();
  });

  it("`conflict` de carrera es el ÚNICO que invita a reintentar", async () => {
    const user = userEvent.setup();
    corregirMock.mockResolvedValue({ status: "conflict", motivo: MSG_CARRERA });
    renderModal();

    await llenar(user, HOY, MOTIVO_OK);
    await user.click(confirmar());

    expect(
      await screen.findByText(
        "Esta orden cambió mientras confirmabas. Actualiza la lista e inténtalo de nuevo.",
      ),
    ).toBeInTheDocument();
  });

  it("`conflict` por estado nombra el estado con su etiqueta legible, no con su `value`", async () => {
    const user = userEvent.setup();
    corregirMock.mockResolvedValue({
      status: "conflict",
      motivo: msgEstadoNoReprogramada("entregada"),
    });
    renderModal();

    await llenar(user, HOY, MOTIVO_OK);
    await user.click(confirmar());

    expect(
      await screen.findByText(
        "Esta orden ya no está esperando una reprogramación (Entregada), así que su fecha ya no decide nada. Actualiza la lista.",
      ),
    ).toBeInTheDocument();
  });

  it("`forbidden` no se disfraza de error genérico", async () => {
    const user = userEvent.setup();
    corregirMock.mockResolvedValue({ status: "forbidden" });
    renderModal();

    await llenar(user, HOY, MOTIVO_OK);
    await user.click(confirmar());

    expect(
      await screen.findByText("No tienes permiso para corregir la fecha de una reprogramación."),
    ).toBeInTheDocument();
  });

  it("tras un rechazo el modal sigue abierto y sin desenlace que contar", async () => {
    const user = userEvent.setup();
    corregirMock.mockResolvedValue({ status: "conflict", motivo: MSG_YA_ES_ESA_FECHA });
    const { onSuccess } = renderModal();

    await llenar(user, HOY, MOTIVO_OK);
    await user.click(confirmar());

    await screen.findByText("La orden ya está reprogramada para esa fecha. Elige otra.");
    expect(onSuccess).not.toHaveBeenCalled();
    expect(screen.queryByText(TEXTO_LIBERADA)).not.toBeInTheDocument();
    expect(confirmar()).toBeInTheDocument();
  });
});
