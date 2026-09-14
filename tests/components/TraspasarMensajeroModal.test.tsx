// @vitest-environment jsdom
// FICHA 427 — T24: la PANTALLA del traspaso entre mensajeros. Cubre R33, R35, R36, R37, más las
// mitades de R6/R7/R8 y R28 que esta capa puede afirmar. Se ejercita el componente REAL; lo único
// mockeado es el borde (la Server Action) y el toast.
//
// ⚠️ LOS LITERALES DE LO QUE SE LEE VAN ESCRITOS A MANO, nunca importados del módulo que el
// componente usa para escribirlos. Un test que compara el texto contra la constante que lo produce
// está verde por construcción: afirma «la función devuelve lo que devuelve» y deja pasar cualquier
// cambio de lo que el operador lee. Si estas cadenas dejan de casar, es que alguien cambió la
// pantalla, y eso tiene que doler. (Misma regla que `CambiarDiaRepartoModal.test.tsx`.)
//
// Lo que SÍ se importa son las CONSTANTES DE PROTOCOLO —los motivos tipados del `conflict` y del
// `validation_error`— porque ésas no son texto de usuario: son el contrato entre el service y esta
// pantalla, y duplicarlas aquí como literales sería tener dos verdades.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  TraspasarMensajeroModal,
  type TraspasarMensajeroOrdenUI,
} from "@/app/(app)/ordenes/_components/TraspasarMensajeroModal";
import { traspasarMensajero } from "@/lib/actions/traspasar-mensajero";
import {
  MSG_CARRERA_TRASPASO,
  MSG_DESTINO_NO_VALIDO,
  MSG_MENSAJERO_BLOQUEADO_POR_CIERRES,
  MSG_MENSAJERO_SIN_VEHICULO,
  MSG_ORIGEN_NO_UNICO,
  msgEstadoNoTraspasable,
} from "@/lib/services/mensajes-traspaso";

vi.mock("@/lib/actions/traspasar-mensajero", () => ({
  traspasarMensajero: vi.fn(),
}));

const traspasarMock = vi.mocked(traspasarMensajero);

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

/** El caso real de la ficha: Andy Cortés se enfermó y sus órdenes las hizo Carlos Eduardo. */
const ANDY = { id: "m-andy", nombre: "Andy Cortés" };
const CARLOS = { id: "m-carlos", nombre: "Carlos Eduardo" };
const MARTA = { id: "m-marta", nombre: "Marta Solís" };

const MENSAJEROS = [ANDY, CARLOS, MARTA];

const MOTIVO_OK = "Andy se reportó enfermo a media jornada";
const CONFIRMAR = "Traspasar";
const SELECTOR = "Mensajero que recibe el lote";

/**
 * ⚠️ EL TIPO SE ANOTA A MANO, Y ES `TraspasarMensajeroOrdenUI` — el que el componente DECLARA.
 *
 * Antes esto no llevaba anotacion y el helper se auto-tipaba, con `mensajeroAsignadoId: string` y
 * `relaciones` NO nulables: mas estrecho que el contrato real. Con eso, el caso «una orden SIN
 * mensajero» no compilaba —`null` no cabia— y el rojo aparecia en el TEST, no donde estaba la
 * causa. Anotar el contrato hace dos cosas: los casos de borde (sin mensajero, sin relacion) son
 * expresables, y si el componente cambia su prop, estos fixtures se mueven con el en vez de seguir
 * describiendo una forma que ya nadie acepta.
 *
 * `mensajeroAsignado` lleva solo `nombre` porque es lo UNICO que el contrato pide. Que la fila real
 * del listado (`OrdenListItemDTO`, con su `{ id, nombre }`) encaje en esa forma no se afirma aqui:
 * lo demuestra `pnpm typecheck` sobre `OrdenesListado.tsx`, que le pasa la seleccion entera, y lo
 * ejercita de punta a punta `TraspasarMensajeroListado.test.tsx`.
 */
function ordenDeAndy(id: string): TraspasarMensajeroOrdenUI {
  return {
    id,
    numRemision: `REM-${id}`,
    mensajeroAsignadoId: ANDY.id,
    relaciones: { mensajeroAsignado: { nombre: ANDY.nombre } },
  };
}

function renderModal(
  ordenes: readonly TraspasarMensajeroOrdenUI[] = [ordenDeAndy("o1"), ordenDeAndy("o2")],
  extra: Partial<{
    mensajerosBloqueadosIds: string[];
    mensajerosNoAsignablesIds: string[];
    mensajerosConRecoleccionIds: string[];
  }> = {},
) {
  const onSuccess = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <TraspasarMensajeroModal
      open
      ordenes={ordenes}
      mensajeros={MENSAJEROS}
      onOpenChange={onOpenChange}
      onSuccess={onSuccess}
      {...extra}
    />,
  );
  return { onSuccess, onOpenChange };
}

function confirmar() {
  return screen.getByRole("button", { name: CONFIRMAR });
}

async function elegirDestino(
  user: ReturnType<typeof userEvent.setup>,
  nombre = CARLOS.nombre,
) {
  await user.click(screen.getByRole("combobox", { name: SELECTOR }));
  const listbox = await screen.findByRole("listbox");
  await user.click(within(listbox).getByRole("option", { name: nombre }));
}

async function escribirMotivo(
  user: ReturnType<typeof userEvent.setup>,
  texto = MOTIVO_OK,
) {
  await user.type(screen.getByLabelText("Motivo"), texto);
}

beforeEach(() => {
  vi.clearAllMocks();
  traspasarMock.mockResolvedValue({
    status: "ok",
    movidas: 31,
    conversaciones: 31,
    origen: { id: ANDY.id, nombre: ANDY.nombre },
    destino: { id: CARLOS.id, nombre: CARLOS.nombre },
  });
});

afterEach(() => {
  cleanup();
});

/* ============================================================================================ */
/* R35 — antes de ejecutar: cuántas, desde quién y hacia quién                                  */
/* ============================================================================================ */

describe("427/R35 — la confirmación dice cuántas órdenes, de quién y hacia quién", () => {
  it("con el destino ya elegido, nombra las DOS puntas y el tamaño del lote", async () => {
    const user = userEvent.setup();
    renderModal([ordenDeAndy("o1"), ordenDeAndy("o2"), ordenDeAndy("o3")]);

    await elegirDestino(user);

    // Literal A MANO: es lo que la persona lee antes de pulsar, no lo que una función devuelve.
    expect(
      screen.getByText("Vas a pasar 3 orden(es) de Andy Cortés a Carlos Eduardo."),
    ).toBeInTheDocument();
  });

  it("sin destino elegido todavía, dice de quién son y pide elegir a quién van", () => {
    renderModal([ordenDeAndy("o1")]);

    expect(
      screen.getByText("Vas a pasar 1 orden(es) de Andy Cortés. Elige a quién se las traspasas."),
    ).toBeInTheDocument();
  });

  it("R8: el ORIGEN se muestra y NO se elige — no hay ningún control para cambiarlo", () => {
    renderModal();

    // Un único desplegable en la pantalla, y es el del DESTINO. Si alguien añadiera un selector de
    // origen, el lote podría mandarse «como si fuera de X» y la guarda del servidor compararía
    // contra un valor elegido por quien llama.
    const combos = screen.getAllByRole("combobox");
    expect(combos).toHaveLength(1);
    expect(combos[0]).toHaveAccessibleName(SELECTOR);
  });
});

/* ============================================================================================ */
/* R7 / R6 — lo que la UI no puede ofrecer                                                      */
/* ============================================================================================ */

describe("427/R7 — el selector EXCLUYE al mensajero de origen", () => {
  it("Andy no está entre los destinos posibles, y los otros dos sí", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByRole("combobox", { name: SELECTOR }));
    const listbox = await screen.findByRole("listbox");

    // Las dos mitades: la ausencia sola estaría verde con una lista vacía.
    expect(within(listbox).queryByRole("option", { name: "Andy Cortés" })).toBeNull();
    expect(within(listbox).getByRole("option", { name: "Carlos Eduardo" })).toBeInTheDocument();
    expect(within(listbox).getByRole("option", { name: "Marta Solís" })).toBeInTheDocument();
  });
});

describe("427/R6 — un lote con DOS orígenes no se puede confirmar", () => {
  it("lo dice con palabras y deja el confirmar apagado, SIN llamar a la acción", async () => {
    const user = userEvent.setup();
    renderModal([
      ordenDeAndy("o1"),
      {
        id: "o2",
        numRemision: "REM-o2",
        mensajeroAsignadoId: CARLOS.id,
        relaciones: { mensajeroAsignado: { nombre: CARLOS.nombre } },
      },
    ]);

    expect(
      screen.getByText(
        "La selección mezcla órdenes de varios mensajeros. Filtra por un solo mensajero y vuelve a seleccionarlas.",
      ),
    ).toBeInTheDocument();
    expect(confirmar()).toBeDisabled();

    await user.click(confirmar());
    expect(traspasarMock).not.toHaveBeenCalled();
  });

  it("una orden SIN mensajero tampoco es un traspaso: es una asignación", () => {
    renderModal([
      ordenDeAndy("o1"),
      { id: "o2", numRemision: "REM-o2", mensajeroAsignadoId: null, relaciones: null },
    ]);

    expect(
      screen.getByText(
        "Alguna orden de la selección no tiene mensajero asignado: eso no es un traspaso, hay que asignarla.",
      ),
    ).toBeInTheDocument();
    expect(confirmar()).toBeDisabled();
  });

  it("un solo origen cuyo NOMBRE no se resuelve: mensaje propio, no el de «mezcla mensajeros»", () => {
    // Medido con una mutacion el 2026-09-14: las dos causas compartian rama, asi que este caso se
    // anunciaba como si alguien hubiera mezclado mensajeros —y mandaba a rehacer una seleccion que
    // estaba bien—. Aqui hay UN solo origen; lo que falta es su nombre.
    renderModal([
      {
        id: "o1",
        numRemision: "REM-o1",
        mensajeroAsignadoId: "m-fantasma",
        relaciones: null,
      },
    ]);

    expect(
      screen.getByText(
        "No se pudo identificar al mensajero de estas órdenes. Actualiza la lista y vuelve a seleccionarlas.",
      ),
    ).toBeInTheDocument();
    // Y NO el de la otra causa: es la mitad que impide que las dos vuelvan a compartir rama.
    expect(
      screen.queryByText(
        "La selección mezcla órdenes de varios mensajeros. Filtra por un solo mensajero y vuelve a seleccionarlas.",
      ),
    ).toBeNull();
    expect(confirmar()).toBeDisabled();
  });

  it("selección vacía: lo avisa y no deja confirmar", () => {
    renderModal([]);
    expect(screen.getByText("Selecciona al menos una orden.")).toBeInTheDocument();
    expect(confirmar()).toBeDisabled();
  });
});

/* ============================================================================================ */
/* R28 — el motivo es obligatorio y se valida ANTES de llamar                                   */
/* ============================================================================================ */

describe("427/R28 — sin motivo válido no se llama a la acción", () => {
  it("con destino elegido pero sin motivo, el confirmar sigue apagado", async () => {
    const user = userEvent.setup();
    renderModal();

    await elegirDestino(user);
    expect(confirmar()).toBeDisabled();

    await user.click(confirmar());
    expect(traspasarMock).not.toHaveBeenCalled();
  });

  it("con nueve caracteres tampoco: el mínimo es diez", async () => {
    const user = userEvent.setup();
    renderModal();

    await elegirDestino(user);
    await escribirMotivo(user, "123456789");

    expect(confirmar()).toBeDisabled();
  });

  it("con motivo pero SIN destino elegido, tampoco", async () => {
    const user = userEvent.setup();
    renderModal();

    await escribirMotivo(user);
    expect(confirmar()).toBeDisabled();
  });

  it("con los dos puestos, manda UNA llamada con el lote COMPLETO y el motivo recortado", async () => {
    const user = userEvent.setup();
    renderModal([ordenDeAndy("o1"), ordenDeAndy("o2")]);

    await elegirDestino(user);
    await escribirMotivo(user, `   ${MOTIVO_OK}   `);
    await user.click(confirmar());

    await waitFor(() => expect(traspasarMock).toHaveBeenCalledTimes(1));
    // UNA llamada con las DOS órdenes: el backend es todo-o-nada por lote, así que partirlo en N
    // llamadas produciría el estado parcial que el diseño evita.
    expect(traspasarMock).toHaveBeenCalledWith({
      ordenIds: ["o1", "o2"],
      mensajeroDestinoId: CARLOS.id,
      motivo: MOTIVO_OK,
    });
    // R8: el objeto enviado NO lleva ningún campo de mensajero de origen.
    const enviado = traspasarMock.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(enviado).sort()).toEqual([
      "mensajeroDestinoId",
      "motivo",
      "ordenIds",
    ]);
  });
});

/* ============================================================================================ */
/* R36 + R33 — el éxito: las dos cifras y el aviso de la ruta                                   */
/* ============================================================================================ */

describe("427/R36 — el éxito dice cuántas órdenes y cuántas conversaciones", () => {
  it("con las cifras DEL SERVIDOR (31 y 31), no con el tamaño de la selección", async () => {
    const user = userEvent.setup();
    // La selección es de DOS órdenes y el servidor responde 31/31: si la pantalla contara la
    // selección, este caso saldría «2 orden(es)» y caería. Es la mitad que impide inventar cifras.
    const { onSuccess } = renderModal([ordenDeAndy("o1"), ordenDeAndy("o2")]);

    await elegirDestino(user);
    await escribirMotivo(user);
    await user.click(confirmar());

    await waitFor(() =>
      expect(
        screen.getByText("Se movieron 31 orden(es) y 31 conversación(es) de chat."),
      ).toBeInTheDocument(),
    );
    expect(successMock).toHaveBeenCalledWith(
      "Se movieron 31 orden(es) y 31 conversación(es) de chat.",
    );
    // R36: y se relee el listado del servidor.
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });
});

describe("427/R33 — la pantalla avisa de que la ruta del que RECIBE queda pendiente", () => {
  it("tras el éxito, el aviso se LEE, con el nombre de quien recibe", async () => {
    const user = userEvent.setup();
    renderModal();

    await elegirDestino(user);
    await escribirMotivo(user);
    await user.click(confirmar());

    // Se busca EL TEXTO DEL AVISO, no la ausencia de error: sin esta frase el mensajero que
    // recibe sigue un orden de paradas calculado para el recorrido de otra persona.
    await waitFor(() =>
      expect(
        screen.getByText(
          "La ruta de Carlos Eduardo se va a recalcular; hasta entonces las paradas nuevas aparecen al final de su recorrido.",
        ),
      ).toBeInTheDocument(),
    );
  });

  it("y ANTES de confirmar, en cuanto hay un destino elegido", async () => {
    const user = userEvent.setup();
    renderModal();

    // Antes de elegir no se promete nada de ninguna ruta.
    expect(screen.queryByText(/se va a recalcular/)).toBeNull();

    await elegirDestino(user, MARTA.nombre);

    expect(
      screen.getByText(
        "La ruta de Marta Solís se va a recalcular; hasta entonces las paradas nuevas aparecen al final de su recorrido.",
      ),
    ).toBeInTheDocument();
  });

  it("el modal NO se cierra solo tras el éxito: el desenlace se queda a la vista", async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderModal();

    await elegirDestino(user);
    await escribirMotivo(user);
    await user.click(confirmar());

    await waitFor(() => expect(successMock).toHaveBeenCalled());
    // Cerrar de golpe se llevaría las cifras y el aviso de la ruta. El botón de confirmar
    // desaparece y el de cancelar pasa a «Cerrar».
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.queryByRole("button", { name: CONFIRMAR })).toBeNull();
    expect(screen.getByRole("button", { name: "Cerrar" })).toBeInTheDocument();
  });
});

/* ============================================================================================ */
/* R37 — un mensaje accionable por causa, sin ids ni datos del destinatario                     */
/* ============================================================================================ */

describe("427/R37 — cada causa tiene su mensaje, y ninguno filtra nada", () => {
  async function fallarCon(result: unknown) {
    const user = userEvent.setup();
    traspasarMock.mockResolvedValue(result as never);
    const { onSuccess } = renderModal([ordenDeAndy("o1")]);
    await elegirDestino(user);
    await escribirMotivo(user);
    await user.click(confirmar());
    await waitFor(() => expect(errorMock).toHaveBeenCalled());
    return { onSuccess, mensaje: errorMock.mock.calls[0][0] as string };
  }

  it("estado no traspasable: NOMBRA el estado con su etiqueta legible, no con el value crudo", async () => {
    const { mensaje, onSuccess } = await fallarCon({
      status: "conflict",
      detalle: [{ ordenId: "o1", motivo: msgEstadoNoTraspasable("devolviendo_a_tienda") }],
    });

    expect(mensaje).toBe(
      "Alguna orden está en Devolviendo a tienda y no se puede traspasar: solo se traspasa lo que el mensajero lleva encima. Quítala de la selección.",
    );
    // El `value` crudo del catálogo no se pinta, y el id de la orden tampoco.
    expect(mensaje).not.toContain("devolviendo_a_tienda");
    expect(mensaje).not.toContain("o1");
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("dos orígenes en el lote: manda a filtrar por un solo mensajero", async () => {
    const { mensaje } = await fallarCon({
      status: "conflict",
      detalle: [{ ordenId: "o1", motivo: MSG_ORIGEN_NO_UNICO }],
    });
    expect(mensaje).toBe(
      "La selección mezcla órdenes de varios mensajeros. Filtra por un solo mensajero y vuelve a seleccionarlas.",
    );
  });

  it("destino bloqueado por cierres: dice qué pasa y qué se puede hacer", async () => {
    const { mensaje } = await fallarCon({
      status: "conflict",
      detalle: [{ ordenId: "o1", motivo: MSG_MENSAJERO_BLOQUEADO_POR_CIERRES }],
    });
    expect(mensaje).toBe(
      "Ese mensajero tiene cierres sin resolver y no puede recibir trabajo nuevo. Elige a otro o espera a que los cierre.",
    );
  });

  it("la carrera: actualizar la lista y reintentar", async () => {
    const { mensaje } = await fallarCon({
      status: "conflict",
      detalle: [{ ordenId: "o1", motivo: MSG_CARRERA_TRASPASO }],
    });
    expect(mensaje).toBe(
      "Alguna orden cambió mientras confirmabas. Actualiza la lista e inténtalo de nuevo.",
    );
  });

  it("destino sin vehículo: manda a la pantalla donde SÍ se arregla", async () => {
    const { mensaje } = await fallarCon({
      status: "validation_error",
      fieldErrors: { mensajeroDestinoId: [MSG_MENSAJERO_SIN_VEHICULO] },
    });
    expect(mensaje).toBe(
      "Ese mensajero no tiene vehículo asociado. Asígnaselo en Configuración > Usuarios y vuelve a intentarlo.",
    );
  });

  it("destino que no es mensajero o no es de la zona: un solo motivo para las dos causas", async () => {
    const { mensaje } = await fallarCon({
      status: "validation_error",
      fieldErrors: { mensajeroDestinoId: [MSG_DESTINO_NO_VALIDO] },
    });
    expect(mensaje).toBe(
      "Ese mensajero no puede recibir estas órdenes: revisa que sea mensajero de la zona de las órdenes.",
    );
  });

  it("`forbidden`: no nombra a nadie ni dice qué órdenes existen", async () => {
    const { mensaje } = await fallarCon({ status: "forbidden" });
    expect(mensaje).toBe(
      "No tienes permiso para traspasar órdenes entre mensajeros. Pídeselo a un administrador de la bodega central.",
    );
  });

  it("sesión caída: se dice, y no como un fallo del traspaso", async () => {
    const { mensaje } = await fallarCon({ status: "unauthenticated" });
    expect(mensaje).toBe("Tu sesión expiró. Inicia sesión de nuevo.");
  });

  it("CONTROL: ninguno de los mensajes de esta pantalla lleva un uuid", async () => {
    // Anti-vacuidad del bloque entero: si los mensajes vinieran vacíos, las aserciones de arriba
    // habrían fallado; ésta cierra la otra mitad, que es que nada de lo que se pinta es un id.
    const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    const { mensaje } = await fallarCon({
      status: "conflict",
      detalle: [
        { ordenId: "3f1c9b2e-0a11-4b8e-9c2d-77aa19bb3c41", motivo: MSG_CARRERA_TRASPASO },
      ],
    });
    expect(mensaje).not.toMatch(uuid);
  });
});
