// @vitest-environment jsdom
// FICHA 373 · bloque G — LA PANTALLA de «eliminar una API key», sobre `ApiKeyAccionCell`.
//
// Cubre R1, R14, R28, R29, R30, R31, R32, R33, R34 y R36. Se ejercita el componente REAL con el
// `Modal` y el `ToastProvider` de producción; lo único mockeado es el borde (las Server Actions),
// para que lo verificado sea el cableado y no el backend.
//
// LA DECISIÓN QUE GOBIERNA ESTE ARCHIVO, y por eso se dice arriba del todo: una key solo se puede
// eliminar si está `inactiva`. Cuando no lo está, el botón sale APAGADO DICIENDO POR QUÉ y la
// acción NO se llama jamás. Un botón que se ofrece y luego falla enseña a desconfiar de todos los
// botones (design §8-A6).
//
// LOS TEXTOS SE ESCRIBEN AQUÍ, LITERALES, y no se importan del módulo que los produce. Comparar un
// texto contra su propia fuente está siempre verde: borrar la frase del motivo cambiaría las dos
// mitades a la vez y el test no se enteraría. Estos literales SON el contrato de pantalla
// (design §7.1), así que si la copia cambia, este archivo tiene que cambiar con ella.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  within,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";

import { ToastProvider } from "@/providers/ToastProvider";
import {
  MOTIVOS_NO_ELIMINABLE,
  type ApiKeyListItemDTO,
  type MotivoNoEliminable,
} from "@/lib/types/api-key";

const rotarApiKeyMock = vi.fn();
const activarApiKeyMock = vi.fn();
const desactivarApiKeyMock = vi.fn();
const eliminarApiKeyMock = vi.fn();
vi.mock("@/lib/actions/api-keys", () => ({
  rotarApiKey: (...a: unknown[]) => rotarApiKeyMock(...a),
  activarApiKey: (...a: unknown[]) => activarApiKeyMock(...a),
  desactivarApiKey: (...a: unknown[]) => desactivarApiKeyMock(...a),
  eliminarApiKey: (...a: unknown[]) => eliminarApiKeyMock(...a),
}));

import { ApiKeyAccionCell } from "@/app/(app)/configuracion/api/_components/ApiKeyAccionCell";
import { MOTIVO_NO_ELIMINABLE_TEXTO } from "@/app/(app)/configuracion/api/_components/api-key-eliminable-label";

// --- El contrato de copia, escrito a mano (design §7.1) ---------------------------------
const TEXTO: Record<MotivoNoEliminable, string> = {
  ordenes: "Tiene órdenes a su nombre. No se puede eliminar.",
  dinero: "Tiene movimientos de dinero a su nombre. No se puede eliminar.",
  tarifas:
    "Tiene tarifas configuradas. Bórralas primero desde Configuración › Tarifas.",
  activa: "Está activa. Desactívala antes de eliminarla.",
  otros_datos: "Tiene datos asociados.",
};

const IDENTIFICADOR = "integracion-erp";
const PREFIJO = "ordx_ab12cd3";

// La key ELIMINABLE: desactivada y sin rastro de datos. Es el único estado desde el que se borra.
const ROW_ELIMINABLE: ApiKeyListItemDTO = {
  id: "11111111-1111-1111-1111-111111111111",
  identificador: IDENTIFICADOR,
  keyPrefix: PREFIJO,
  estado: "inactiva",
  usuarioId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  usuarioEmail: `apikey+${IDENTIFICADOR}@apikey.invalid`,
  tiendaDestinoId: null,
  tiendaDestinoNombre: null,
  eliminable: true,
  motivoNoEliminable: null,
  createdAt: new Date("2026-01-01T12:00:00Z"),
};

/** Fila que el SERVIDOR marcó como no eliminable, con su motivo ya resuelto. */
function filaBloqueada(motivo: MotivoNoEliminable): ApiKeyListItemDTO {
  return {
    ...ROW_ELIMINABLE,
    // Solo el motivo `activa` implica ese estado; los de datos bloquean estando desactivada.
    estado: motivo === "activa" ? "activa" : "inactiva",
    eliminable: false,
    motivoNoEliminable: motivo,
  };
}

const NOMBRE_ELIMINAR = `Eliminar la API key ${IDENTIFICADOR}`;
const nombreBloqueado = (motivo: MotivoNoEliminable) =>
  `No se puede eliminar la API key ${IDENTIFICADOR}: ${TEXTO[motivo]}`;

let onMutated: ReturnType<typeof vi.fn> & (() => Promise<void>);
let onEliminada: ReturnType<typeof vi.fn> & (() => void);

function renderCell(row: ApiKeyListItemDTO = ROW_ELIMINABLE): ReactElement {
  const ui = (
    <ToastProvider>
      <ApiKeyAccionCell
        row={row}
        onMutated={onMutated}
        onEliminada={onEliminada}
      />
    </ToastProvider>
  );
  render(ui);
  return ui;
}

/** Abre la confirmación de borrado sobre una fila eliminable. */
async function abrirConfirmacion(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: NOMBRE_ELIMINAR }));
  return screen.findByRole("dialog");
}

beforeEach(() => {
  vi.clearAllMocks();
  onMutated = vi.fn().mockResolvedValue(undefined) as typeof onMutated;
  onEliminada = vi.fn() as typeof onEliminada;
  eliminarApiKeyMock.mockResolvedValue({
    status: "ok",
    identificador: IDENTIFICADOR,
  });
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// R1 · el botón existe, y los otros dos siguen ahí (R14)
// ---------------------------------------------------------------------------
describe("R1/R14 — el tercer botón convive con el ciclo de vida que ya existía", () => {
  it("R1: la celda pinta «Eliminar» además de «Rotar» y «Activar/Desactivar»", () => {
    renderCell();

    expect(
      screen.getByRole("button", { name: `Rotar la API key ${IDENTIFICADOR}` }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: `Activar la API key ${IDENTIFICADOR}`,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: NOMBRE_ELIMINAR }),
    ).toBeInTheDocument();
  });

  it("R14: una fila NO eliminable conserva Rotar y Desactivar HABILITADOS", () => {
    // El caso literal de la key en uso: `activa`, sin datos. «Eliminar» apagado, el resto vivo.
    renderCell(filaBloqueada("activa"));

    expect(
      screen.getByRole("button", { name: `Rotar la API key ${IDENTIFICADOR}` }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", {
        name: `Desactivar la API key ${IDENTIFICADOR}`,
      }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: nombreBloqueado("activa") }),
    ).toBeDisabled();
  });

  it("R14: y sus acciones siguen funcionando (desactivar llama a su acción)", async () => {
    desactivarApiKeyMock.mockResolvedValue({ status: "ok", apiKey: {} });
    const user = userEvent.setup();
    renderCell(filaBloqueada("activa"));

    await user.click(
      screen.getByRole("button", {
        name: `Desactivar la API key ${IDENTIFICADOR}`,
      }),
    );
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Sí, desactivar",
      }),
    );

    await waitFor(() =>
      expect(desactivarApiKeyMock).toHaveBeenCalledWith({
        id: ROW_ELIMINABLE.id,
      }),
    );
    expect(eliminarApiKeyMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// R28 · el botón apagado DICE POR QUÉ, con el motivo del servidor
// ---------------------------------------------------------------------------
describe("R28 — el motivo es perceptible sin llegar a pulsar", () => {
  it.each([
    ["ordenes"],
    ["dinero"],
    ["tarifas"],
    ["activa"],
  ] as [MotivoNoEliminable][])(
    "motivo %s: el botón está deshabilitado y su nombre accesible lo dice",
    (motivo) => {
      renderCell(filaBloqueada(motivo));

      const boton = screen.getByRole("button", { name: nombreBloqueado(motivo) });
      expect(boton).toBeDisabled();
      // El `title` acompaña al nombre accesible: un botón deshabilitado NO recibe foco, así que
      // dejar el motivo solo en el tooltip lo haría invisible para media pantalla.
      expect(boton).toHaveAttribute("title", TEXTO[motivo]);
    },
  );

  it("una fila eliminable NO lleva excusa: ni `title` ni «No se puede»", () => {
    renderCell();

    const boton = screen.getByRole("button", { name: NOMBRE_ELIMINAR });
    expect(boton).toBeEnabled();
    expect(boton).not.toHaveAttribute("title");
  });

  it("⭑ desde una fila bloqueada NUNCA se llama a la acción ni se abre nada", () => {
    // La decisión del humano, medida: el botón deshabilitado no es decoración. Si alguien lo
    // habilitara, este click abriría el diálogo y el test se pondría rojo aquí.
    renderCell(filaBloqueada("ordenes"));

    fireEvent.click(
      screen.getByRole("button", { name: nombreBloqueado("ordenes") }),
    );

    expect(eliminarApiKeyMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("el vocabulario de motivos está cubierto ENTERO por la tabla de textos", () => {
    // Estructural, no de copia: un motivo nuevo en el servidor sin texto de pantalla sería un
    // botón apagado que no dice nada, que es el fallo mudo que R28 viene a impedir.
    expect(Object.keys(MOTIVO_NO_ELIMINABLE_TEXTO).sort()).toEqual(
      [...MOTIVOS_NO_ELIMINABLE].sort(),
    );
    for (const motivo of MOTIVOS_NO_ELIMINABLE) {
      expect(MOTIVO_NO_ELIMINABLE_TEXTO[motivo], `motivo ${motivo}`).toBe(
        TEXTO[motivo],
      );
    }
  });
});

// ---------------------------------------------------------------------------
// R29/R30/R31/R32 · la confirmación
// ---------------------------------------------------------------------------
describe("R29–R32 — la confirmación destructiva simple", () => {
  it("R29: pulsar «Eliminar» abre la confirmación y NO llama a la acción", async () => {
    const user = userEvent.setup();
    renderCell();

    const dialogo = await abrirConfirmacion(user);

    expect(within(dialogo).getByText("Eliminar la API key")).toBeInTheDocument();
    expect(eliminarApiKeyMock).not.toHaveBeenCalled();
    expect(onMutated).not.toHaveBeenCalled();
  });

  it("R29: y NO pide teclear el identificador (decisión del humano, 2026-09-04)", async () => {
    const user = userEvent.setup();
    renderCell();

    const dialogo = await abrirConfirmacion(user);

    expect(within(dialogo).queryByRole("textbox")).toBeNull();
    expect(
      within(dialogo).getByRole("button", { name: "Sí, eliminar" }),
    ).toBeEnabled();
  });

  it("R30: nombra la key y enuncia las TRES consecuencias", async () => {
    const user = userEvent.setup();
    renderCell();

    const dialogo = await abrirConfirmacion(user);

    expect(within(dialogo).getByText(IDENTIFICADOR)).toBeInTheDocument();
    const alerta = within(dialogo).getByRole("alert");
    expect(
      within(alerta).getByText(/Esta acción es irreversible: no se puede deshacer\./),
    ).toBeInTheDocument();
    expect(
      within(alerta).getByText(
        /El secreto deja de funcionar de forma definitiva\./,
      ),
    ).toBeInTheDocument();
    expect(
      within(alerta).getByText(
        /Desaparecen también su cuenta dedicada y su suscripción de webhook\./,
      ),
    ).toBeInTheDocument();
  });

  it("R31: recuerda que ya está desactivada y que dejarla así revoca sin borrar", async () => {
    const user = userEvent.setup();
    renderCell();

    const dialogo = await abrirConfirmacion(user);

    expect(
      within(dialogo).getByText(
        /La API key ya está desactivada: dejarla así revoca el acceso sin borrar nada\./,
      ),
    ).toBeInTheDocument();
  });

  it("R32: «Cancelar» cierra sin llamar a la acción y sin refrescar", async () => {
    const user = userEvent.setup();
    renderCell();

    const dialogo = await abrirConfirmacion(user);
    await user.click(within(dialogo).getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(eliminarApiKeyMock).not.toHaveBeenCalled();
    expect(onMutated).not.toHaveBeenCalled();
    expect(onEliminada).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// R33/R34 · los desenlaces
// ---------------------------------------------------------------------------
describe("R33 — tras el éxito: relee el listado y avisa", () => {
  it("llama a la acción con el id, refresca ANTES de cerrar y anuncia el éxito", async () => {
    const user = userEvent.setup();
    renderCell();

    const dialogo = await abrirConfirmacion(user);
    await user.click(
      within(dialogo).getByRole("button", { name: "Sí, eliminar" }),
    );

    await waitFor(() =>
      expect(eliminarApiKeyMock).toHaveBeenCalledWith({
        id: ROW_ELIMINABLE.id,
      }),
    );
    expect(onMutated).toHaveBeenCalledTimes(1);
    expect(onEliminada).toHaveBeenCalledTimes(1);
    expect(
      (await screen.findAllByText("API key eliminada")).length,
    ).toBeGreaterThan(0);
  });

  it("anti-doble-submit: un segundo click de confirmar no borra dos veces", async () => {
    let resolver!: (v: unknown) => void;
    eliminarApiKeyMock.mockImplementation(
      () => new Promise((res) => (resolver = res)),
    );
    const user = userEvent.setup();
    renderCell();

    const dialogo = await abrirConfirmacion(user);
    const confirmar = within(dialogo).getByRole("button", {
      name: "Sí, eliminar",
    });
    await user.click(confirmar);
    await user.click(confirmar);

    expect(eliminarApiKeyMock).toHaveBeenCalledTimes(1);
    resolver({ status: "ok", identificador: IDENTIFICADOR });
    await waitFor(() => expect(onMutated).toHaveBeenCalled());
  });
});

describe("R34 — cada fallo tiene SU mensaje y el listado no miente", () => {
  const FALLOS: [string, Record<string, unknown>, string][] = [
    ["sin permiso", { status: "forbidden" }, "No tienes permiso para esta acción."],
    [
      "sin sesión",
      { status: "unauthenticated" },
      "Tu sesión expiró. Vuelve a iniciar sesión.",
    ],
    [
      "no encontrada",
      { status: "not_found" },
      "Esta API key ya no existe. Actualiza el listado.",
    ],
    ["bloqueada", { status: "bloqueada", motivo: "ordenes" }, TEXTO.ordenes],
  ];

  it.each(FALLOS)("%s → %s", async (_caso, resultado, mensaje) => {
    eliminarApiKeyMock.mockResolvedValue(resultado);
    const user = userEvent.setup();
    renderCell();

    const dialogo = await abrirConfirmacion(user);
    await user.click(
      within(dialogo).getByRole("button", { name: "Sí, eliminar" }),
    );

    expect((await screen.findAllByText(mensaje)).length).toBeGreaterThan(0);
    // No se anuncia éxito ni se refresca: el listado sigue mostrando lo que dice el servidor.
    expect(screen.queryByText("API key eliminada")).toBeNull();
    expect(onMutated).not.toHaveBeenCalled();
    expect(onEliminada).not.toHaveBeenCalled();
  });

  it("`bloqueada` dice el motivo CONCRETO, no un genérico, en los cuatro casos", async () => {
    // El servidor re-evalúa el guard dentro de la transacción (R15): entre el pintado y el clic
    // la key pudo cambiar. Si eso pasa, el aviso tiene que decir la razón nueva.
    for (const motivo of ["ordenes", "dinero", "tarifas", "activa"] as const) {
      eliminarApiKeyMock.mockResolvedValue({ status: "bloqueada", motivo });
      const user = userEvent.setup();
      renderCell();

      const dialogo = await abrirConfirmacion(user);
      await user.click(
        within(dialogo).getByRole("button", { name: "Sí, eliminar" }),
      );

      expect(
        (await screen.findAllByText(TEXTO[motivo])).length,
        `motivo ${motivo}`,
      ).toBeGreaterThan(0);
      cleanup();
    }
  });

  it("los cuatro mensajes de fallo son DISTINTOS entre sí", () => {
    const mensajes = [
      "No tienes permiso para esta acción.",
      "Tu sesión expiró. Vuelve a iniciar sesión.",
      "Esta API key ya no existe. Actualiza el listado.",
      TEXTO.ordenes,
    ];
    expect(new Set(mensajes).size).toBe(mensajes.length);
  });
});

// ---------------------------------------------------------------------------
// R36 · nada del secreto sale por este camino
// ---------------------------------------------------------------------------
describe("R36 — el flujo de borrado no renderiza prefijo completo ni hash", () => {
  it("ni al confirmar ni tras el éxito aparece el prefijo ni nada con forma de hash", async () => {
    const user = userEvent.setup();
    renderCell();

    const dialogo = await abrirConfirmacion(user);

    // (1) CON LA CONFIRMACIÓN ABIERTA. Anti-vacuidad primero: el diálogo SÍ está pintado y SÍ
    // nombra la key. Sin esto, un cuerpo vacío pasaría este test con las manos en los bolsillos.
    const conModal = document.body.textContent ?? "";
    expect(conModal).toContain(IDENTIFICADOR);
    expect(conModal).not.toContain(PREFIJO);
    expect(conModal).not.toMatch(/[0-9a-f]{32,}/i);
    expect(conModal).not.toContain(ROW_ELIMINABLE.usuarioId);
    // El MARCADO entero, no solo el texto: el prefijo tampoco puede colarse por un `aria-label`,
    // un `title` ni un atributo cualquiera.
    expect(document.body.innerHTML).not.toContain(PREFIJO);
    expect(document.body.innerHTML).not.toContain(ROW_ELIMINABLE.usuarioId);

    await user.click(
      within(dialogo).getByRole("button", { name: "Sí, eliminar" }),
    );
    await screen.findAllByText("API key eliminada");

    // (2) TRAS EL ÉXITO. El aviso está pintado (anti-vacuidad de esta fase) y sigue sin haber
    // rastro del secreto: `ok` devuelve el identificador visible y nada más.
    const trasExito = document.body.textContent ?? "";
    expect(trasExito).toContain("API key eliminada");
    expect(trasExito).not.toContain(PREFIJO);
    expect(trasExito).not.toMatch(/[0-9a-f]{32,}/i);
    expect(document.body.innerHTML).not.toContain(PREFIJO);
  });
});
