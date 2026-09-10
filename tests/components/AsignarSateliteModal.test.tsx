// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AsignarSateliteModal } from "@/app/(app)/recepcion-satelite/_components/AsignarSateliteModal";
import { asignarDesdeSatelite } from "@/lib/actions/recepcion-satelite";
import type { RecepcionSateliteDTO } from "@/lib/interfaces/services/IRecepcionSateliteService";
import { CAMPOS_BASE_ORDEN } from "@/tests/fixtures/fila-bodega-satelite";

// Feature 34 (T9) — Modal "Asignar mensajero" desde `en_bodega_satelite` (R7): un
// único mensajero de la zona para todo el lote seleccionado.
vi.mock("@/lib/actions/recepcion-satelite", () => ({
  asignarDesdeSatelite: vi.fn(),
}));

const asignarDesdeSateliteMock = vi.mocked(asignarDesdeSatelite);

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

const MENSAJEROS = [
  { id: "m1", nombre: "Ana Mensajera" },
  { id: "m2", nombre: "Beto Mensajero" },
];

function makeOrden(
  overrides: Partial<RecepcionSateliteDTO> & { id: string },
): RecepcionSateliteDTO {
  return {
    // FICHA 349: los escalares de `OrdenDTO` que la fila comparte con `/ordenes`, en un solo sitio.
    ...CAMPOS_BASE_ORDEN,
    numGuia: 1001,
    numRemision: "REM-000",
    estatusValue: "en_bodega_satelite",
    destinatario: "Destino",
    telefonoDest: "88880000",
    direccion: "Calle 1",
    producto: "Caja",
    montoCobrar: 150,
    tiendaNombre: "Tienda X",
    zonaNombre: "Limón",
    provinciaNombre: "Limón",
    cantonNombre: "Central",
    distritoNombre: "Limón",
    ...overrides,
  };
}

// Feature 246 (T4.3): las fechas bajan de la pagina, resueltas en el servidor con el dia de
// Costa Rica (R29). Literales fijos, para que las etiquetas afirmadas no dependan del dia en que
// corra la suite. Son LAS MISMAS que en bodega central: D4 exige que la eleccion signifique lo
// mismo desde las dos bodegas.
const FECHAS_DIA_REPARTO = { hoy: "2026-08-20", manana: "2026-08-21" };

function renderModal(
  ordenes: RecepcionSateliteDTO[],
  mensajeros = MENSAJEROS,
  onSuccess = vi.fn(),
  onOpenChange = vi.fn(),
  // FEATURE 271 (T9.5, R32): los que el servidor va a rechazar por su cierre. Por defecto ninguno,
  // para que el resto del archivo siga midiendo lo suyo.
  mensajerosBloqueadosIds: string[] = [],
) {
  const { rerender } = render(
    <AsignarSateliteModal
      open
      ordenes={ordenes}
      mensajeros={mensajeros}
      mensajerosBloqueadosIds={mensajerosBloqueadosIds}
      fechasDiaReparto={FECHAS_DIA_REPARTO}
      onOpenChange={onOpenChange}
      onSuccess={onSuccess}
    />,
  );
  /** Reabre sin desmontar, que es como lo monta `RecepcionSateliteModule` (una sola vez). */
  function reabrir() {
    for (const abierto of [false, true]) {
      rerender(
        <AsignarSateliteModal
          open={abierto}
          ordenes={ordenes}
          mensajeros={mensajeros}
          fechasDiaReparto={FECHAS_DIA_REPARTO}
          onOpenChange={onOpenChange}
          onSuccess={onSuccess}
        />,
      );
    }
  }
  return { onSuccess, onOpenChange, reabrir };
}

/** Elige un mensajero en el `Select` del lote (paso previo obligatorio de todo asignar). */
async function elegirMensajero(
  user: ReturnType<typeof userEvent.setup>,
  nombre = "Ana Mensajera",
) {
  await user.click(
    screen.getByRole("combobox", { name: "Mensajero para el lote" }),
  );
  const listbox = await screen.findByRole("listbox");
  await user.click(within(listbox).getByRole("option", { name: nombre }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("AsignarSateliteModal", () => {
  it("R7: éxito → asignarDesdeSatelite({ ordenIds, mensajeroId }), toast + onSuccess", async () => {
    const user = userEvent.setup();
    asignarDesdeSateliteMock.mockResolvedValue({
      status: "ok",
      resultados: [
        { ordenId: "o1", estado: "por_recoger" },
        { ordenId: "o2", estado: "por_recoger" },
      ],
    });

    const ordenes = [
      makeOrden({ id: "o1", numRemision: "REM-001" }),
      makeOrden({ id: "o2", numRemision: "REM-002" }),
    ];
    const { onSuccess } = renderModal(ordenes);

    const select = screen.getByRole("combobox", {
      name: "Mensajero para el lote",
    });
    await user.click(select);
    const listbox = await screen.findByRole("listbox");
    await user.click(
      within(listbox).getByRole("option", { name: "Ana Mensajera" }),
    );

    await user.click(screen.getByRole("button", { name: "Asignar" }));

    expect(asignarDesdeSateliteMock).toHaveBeenCalledTimes(1);
    expect(asignarDesdeSateliteMock).toHaveBeenCalledWith({
      ordenIds: ["o1", "o2"],
      mensajeroId: "m1",
      // Feature 246 (R2/R27): sin tocar el selector, el lote va al reparto de HOY. El literal
      // se afirma porque el borde tiene `.default("hoy")`: si el modal dejara de mandar el
      // campo, produccion seguiria funcionando y nadie se enteraria.
      dia: "hoy",
    });

    // Feature 148 (§9.7): tras el éxito el modal pasa a la fase "resultado" (con el
    // manifiesto del lote) y `onSuccess` se difiere al cierre de esa fase. La llamada
    // de negocio, su input y su toast NO cambian (R27).
    await user.click(await screen.findByRole("button", { name: "Cerrar" }));
    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(successMock).toHaveBeenCalledWith("Mensajero asignado a 2 orden(es).");
  });

  it("R9: confirmar sin mensajero no llama a la acción y muestra error de validación", async () => {
    const user = userEvent.setup();
    renderModal([makeOrden({ id: "o1", numRemision: "REM-001" })]);

    await user.click(screen.getByRole("button", { name: "Asignar" }));

    expect(asignarDesdeSateliteMock).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(errorMock).toHaveBeenCalledWith(
        "Datos inválidos: revisa la selección de mensajero.",
      ),
    );
  });

  it("R22 (41): resultado 'bodega_bloqueada' por mensajeros → toast con la causa (i)", async () => {
    const user = userEvent.setup();
    asignarDesdeSateliteMock.mockResolvedValue({
      status: "bodega_bloqueada",
      causa: { porMensajeros: true, porCierreBodega: false },
    });
    renderModal([makeOrden({ id: "o1", numRemision: "REM-001" })]);

    const select = screen.getByRole("combobox", {
      name: "Mensajero para el lote",
    });
    await user.click(select);
    const listbox = await screen.findByRole("listbox");
    await user.click(
      within(listbox).getByRole("option", { name: "Ana Mensajera" }),
    );
    await user.click(screen.getByRole("button", { name: "Asignar" }));

    await vi.waitFor(() =>
      expect(errorMock).toHaveBeenCalledWith(
        expect.stringMatching(/resuelve los cierres pendientes de tus mensajeros/i),
      ),
    );
  });

  it("R22 (41): resultado 'bodega_bloqueada' por cierre de bodega → toast con la causa (ii)", async () => {
    const user = userEvent.setup();
    asignarDesdeSateliteMock.mockResolvedValue({
      status: "bodega_bloqueada",
      causa: { porMensajeros: false, porCierreBodega: true },
    });
    renderModal([makeOrden({ id: "o1", numRemision: "REM-001" })]);

    const select = screen.getByRole("combobox", {
      name: "Mensajero para el lote",
    });
    await user.click(select);
    const listbox = await screen.findByRole("listbox");
    await user.click(
      within(listbox).getByRole("option", { name: "Ana Mensajera" }),
    );
    await user.click(screen.getByRole("button", { name: "Asignar" }));

    await vi.waitFor(() =>
      expect(errorMock).toHaveBeenCalledWith(
        expect.stringMatching(/cierre de bodega hacia la central está pendiente de aprobación/i),
      ),
    );
  });

  // ── Feature 92/R9 ───────────────────────────────────────────────────────────
  // Este modal NO usa el mapper compartido de `ordenes/`: tiene el suyo propio
  // (`asignacion-satelite-error-messages.ts`). Antes ramificaba SOLO por `status`
  // e ignoraba `detalle`, así que el `motivo` del gate de coordenadas (92) se
  // descartaba y el toast caía en el genérico de `conflict`. Estos tests fijan
  // que el SEGUNDO mapper también respeta R9.
  async function asignarConMensajero(user: ReturnType<typeof userEvent.setup>) {
    await user.click(
      screen.getByRole("combobox", { name: "Mensajero para el lote" }),
    );
    const listbox = await screen.findByRole("listbox");
    await user.click(
      within(listbox).getByRole("option", { name: "Ana Mensajera" }),
    );
    await user.click(screen.getByRole("button", { name: "Asignar" }));
  }

  // FEATURE 400 (T16, R19/R23): eran el MISMO texto y ya no lo son. `geocodificacion_agotada`
  // pasa por el mismo mapper compartido, así que este modal hereda el mensaje nuevo sin tocar
  // ni una línea de su código — que es justo lo que R23 exige. Literales a mano.
  it.each([
    ["direccion_no_geocodificable", "Dirección no encontrada"],
    [
      "geocodificacion_agotada",
      "No se pudo verificar la ubicación por un fallo del servicio de mapas. La dirección no es el problema; vuelve a intentarlo más tarde.",
    ],
  ])(
    "92/R9 + 400/R19: conflict con motivo %s → toast con SU propio mensaje",
    async (motivo, esperado) => {
      const user = userEvent.setup();
      asignarDesdeSateliteMock.mockResolvedValue({
        status: "conflict",
        detalle: [{ ordenId: "o1", motivo }],
      });
      renderModal([makeOrden({ id: "o1", numRemision: "REM-001" })]);

      await asignarConMensajero(user);

      await vi.waitFor(() =>
        expect(errorMock).toHaveBeenCalledWith(esperado),
      );
    },
  );

  it.each([
    "geocodificacion_en_curso",
    "geocodificacion_encolada",
    "geocodificacion_no_encolable",
  ])(
    "92/R9: conflict con motivo %s → mensaje DISTINTO (la dirección aún se valida)",
    async (motivo) => {
      const user = userEvent.setup();
      asignarDesdeSateliteMock.mockResolvedValue({
        status: "conflict",
        detalle: [{ ordenId: "o1", motivo }],
      });
      renderModal([makeOrden({ id: "o1", numRemision: "REM-001" })]);

      await asignarConMensajero(user);

      await vi.waitFor(() => expect(errorMock).toHaveBeenCalled());
      const msg = errorMock.mock.calls.at(-1)?.[0] as string;
      expect(msg).not.toBe("Dirección no encontrada");
      expect(msg).toMatch(/valid/i);
    },
  );

  // `estado_invalido` dejo de caer en el generico: ahora tiene su propia frase, que dice que
  // paso y que hacer. Para seguir cubriendo el generico se usa un motivo que el mapper NO
  // conoce, que es cuando de verdad toca.
  it("92/R9: un conflict con un motivo DESCONOCIDO conserva el mensaje genérico del mapper", async () => {
    const user = userEvent.setup();
    asignarDesdeSateliteMock.mockResolvedValue({
      status: "conflict",
      detalle: [{ ordenId: "o1", motivo: "motivo_que_nadie_mapea" }],
    });
    renderModal([makeOrden({ id: "o1", numRemision: "REM-001" })]);

    await asignarConMensajero(user);

    await vi.waitFor(() =>
      expect(errorMock).toHaveBeenCalledWith(
        "Alguna orden de la selección ya no se puede asignar. Actualiza la lista y vuelve a intentarlo.",
      ),
    );
  });

  // Pedido humano 2026-08-18 — el test que habia aqui afirmaba que un mensajero con cierre
  // abierto salia DESHABILITADO en el selector. La regla se retiro (el service ya no lo rechaza),
  // asi que el test se invierte: se comprueba que TODOS siguen elegibles.
  it("un mensajero con cierre abierto ya NO aparece deshabilitado", async () => {
    const user = userEvent.setup();
    render(
      <AsignarSateliteModal
        open
        ordenes={[makeOrden({ id: "o1", numRemision: "REM-001" })]}
        mensajeros={MENSAJEROS}
        fechasDiaReparto={FECHAS_DIA_REPARTO}
        onOpenChange={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    const select = screen.getByRole("combobox", {
      name: "Mensajero para el lote",
    });
    await user.click(select);
    const listbox = await screen.findByRole("listbox");

    // Ni el sufijo "(cierre abierto)" ni el deshabilitado: el nombre sale limpio.
    expect(within(listbox).queryByText(/cierre abierto/i)).toBeNull();
    for (const nombre of ["Ana Mensajera", "Beto Mensajero"]) {
      expect(
        within(listbox).getByRole("option", { name: nombre }),
      ).not.toHaveAttribute("aria-disabled", "true");
    }
  });

  it("R6: zona sin mensajeros → estado vacío accionable y 'Asignar' deshabilitado", async () => {
    const user = userEvent.setup();
    renderModal([makeOrden({ id: "o1", numRemision: "REM-001" })], []);

    expect(screen.getByRole("alert")).toHaveTextContent(
      /no hay mensajeros en tu zona/i,
    );
    // Sin mensajeros no hay Select y el confirmar está deshabilitado.
    expect(
      screen.queryByRole("combobox", { name: "Mensajero para el lote" }),
    ).toBeNull();
    const asignar = screen.getByRole("button", { name: "Asignar" });
    expect(asignar).toBeDisabled();

    await user.click(asignar);
    expect(asignarDesdeSateliteMock).not.toHaveBeenCalled();
  });
});

// Feature 368 (T6) — espejo EXACTO de T5 (`AsignarBodegaModal — asignación parcial`, R5): la
// bodega satélite se comporta igual ante el gate de coordenadas, con el mismo criterio y el
// mismo vocabulario de motivos.
describe("AsignarSateliteModal — asignación parcial (368/R2/R10-R14)", () => {
  it("T6.1: partial (2 asignadas, 1 bloqueada) -> toast con los conteos y el detalle en el DOM", async () => {
    const user = userEvent.setup();
    asignarDesdeSateliteMock.mockResolvedValue({
      status: "partial",
      resultados: [
        { ordenId: "o1", estado: "por_recoger" },
        { ordenId: "o2", estado: "por_recoger" },
      ],
      bloqueadas: [{ ordenId: "o3", motivo: "direccion_no_geocodificable" }],
    });

    const ordenes = [
      makeOrden({ id: "o1", numRemision: "REM-001" }),
      makeOrden({ id: "o2", numRemision: "REM-002" }),
      // El identificador visible viene de ESTE snapshot, nunca de un campo inventado en la
      // respuesta de `bloqueadas` (que solo trae `ordenId`/`motivo`).
      makeOrden({ id: "o3", numRemision: "NA-138" }),
    ];
    renderModal(ordenes);

    await elegirMensajero(user);
    await user.click(screen.getByRole("button", { name: "Asignar" }));

    // El aserto no depende del literal exacto de Q1: solo de los números — 2 asignadas,
    // 1 bloqueada.
    await vi.waitFor(() => expect(successMock).toHaveBeenCalledTimes(1));
    const toastMsg = successMock.mock.calls[0]![0] as string;
    expect(toastMsg).toContain("2");
    expect(toastMsg).toContain("1");

    // FICHA 407: acotado a la lista de bloqueadas (`role="alert"`), que es DONDE R10/R11 de la
    // 368 exigen el identificador. Antes se buscaba en todo el documento, y eso era un polizón,
    // no el contrato: desde la 407 esta misma orden —bloqueada por una dirección irresoluble—
    // aparece TAMBIÉN en el panel que ofrece autorizar su asignación, así que un `findByText`
    // sin ámbito encuentra dos. Lo que la 368 fijó se sigue afirmando entero.
    const bloqueadas = await screen.findByRole("alert");
    expect(within(bloqueadas).getByText(/NA-138/)).toBeInTheDocument();
    expect(within(bloqueadas).getByText(/Dirección no encontrada/)).toBeInTheDocument();
  });

  it("T6.2: partial NO llama al canal de error del Modal — tuvo efecto, no es un error", async () => {
    const user = userEvent.setup();
    asignarDesdeSateliteMock.mockResolvedValue({
      status: "partial",
      resultados: [{ ordenId: "o1", estado: "por_recoger" }],
      bloqueadas: [{ ordenId: "o2", motivo: "geocodificacion_encolada" }],
    });
    renderModal([
      makeOrden({ id: "o1", numRemision: "REM-001" }),
      makeOrden({ id: "o2", numRemision: "REM-002" }),
    ]);

    await elegirMensajero(user);
    await user.click(screen.getByRole("button", { name: "Asignar" }));

    await vi.waitFor(() => expect(successMock).toHaveBeenCalledTimes(1));
    expect(errorMock).not.toHaveBeenCalled();
  });

  it("T6.3: onSuccess sigue diferido al cierre del panel de resultado (feature 148, sin cambios)", async () => {
    const user = userEvent.setup();
    asignarDesdeSateliteMock.mockResolvedValue({
      status: "partial",
      resultados: [{ ordenId: "o1", estado: "por_recoger" }],
      bloqueadas: [{ ordenId: "o2", motivo: "geocodificacion_encolada" }],
    });
    const ordenes = [
      makeOrden({ id: "o1", numRemision: "REM-001" }),
      makeOrden({ id: "o2", numRemision: "REM-002" }),
    ];
    const { onSuccess } = renderModal(ordenes);

    await elegirMensajero(user);
    await user.click(screen.getByRole("button", { name: "Asignar" }));

    await screen.findByText(/REM-002/);
    expect(onSuccess).not.toHaveBeenCalled();
    await user.click(await screen.findByRole("button", { name: "Cerrar" }));
    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
  });

  it("T6.4: no-regresión — un 'ok' puro no menciona ninguna orden bloqueada en el DOM", async () => {
    const user = userEvent.setup();
    asignarDesdeSateliteMock.mockResolvedValue({
      status: "ok",
      resultados: [{ ordenId: "o1", estado: "por_recoger" }],
    });
    renderModal([makeOrden({ id: "o1", numRemision: "REM-001" })]);

    await elegirMensajero(user);
    await user.click(screen.getByRole("button", { name: "Asignar" }));

    await screen.findByRole("button", { name: "Cerrar" });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("T6.5: no-regresión — un 'conflict' (mensajero bloqueado por cierre) sigue lanzando al canal de error, sin tocar la fase resultado", async () => {
    const user = userEvent.setup();
    asignarDesdeSateliteMock.mockResolvedValue({
      status: "conflict",
      detalle: [{ ordenId: "o1", motivo: "mensajero_bloqueado_por_cierre" }],
    });
    renderModal([makeOrden({ id: "o1", numRemision: "REM-001" })]);

    await elegirMensajero(user);
    await user.click(screen.getByRole("button", { name: "Asignar" }));

    await vi.waitFor(() =>
      expect(errorMock).toHaveBeenCalledWith(
        "El mensajero que elegiste tiene un cierre sin resolver, así que no puede recibir órdenes nuevas. Resuelve el cierre o elige otro mensajero.",
      ),
    );
    expect(screen.queryByRole("button", { name: "Cerrar" })).toBeNull();
  });
});

// Feature 246 (T4.3/T4.4) — ELEGIR PARA QUÉ DÍA ES EL LOTE, desde bodega SATÉLITE (R2/R27-R29).
//
// Espejo del de bodega central. La decisión D4 se firmó precisamente para que estas dos suites
// puedan ser espejo: si el satélite quedara fuera, la regla del sistema dependería de desde qué
// bodega te asignaron. Los literales visibles van escritos A MANO, nunca importados.
describe("AsignarSateliteModal — día de reparto (feature 246)", () => {
  it("R27: el modal abre con «Hoy» marcada y «Mañana» sin marcar", () => {
    renderModal([makeOrden({ id: "o1" })]);

    expect(
      screen.getByRole("radiogroup", { name: "Día de reparto" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: "Hoy · 20 de agosto" }),
    ).toBeChecked();
    expect(
      screen.getByRole("radio", { name: "Mañana · 21 de agosto" }),
    ).not.toBeChecked();
  });

  it("R2: elegir «Mañana» hace que la acción reciba `dia: manana` — el selector NO es decorativo", async () => {
    const user = userEvent.setup();
    asignarDesdeSateliteMock.mockResolvedValue({
      status: "ok",
      resultados: [{ ordenId: "o1", estado: "por_recoger" }],
    });
    renderModal([makeOrden({ id: "o1" })]);

    await elegirMensajero(user);
    await user.click(screen.getByRole("radio", { name: "Mañana · 21 de agosto" }));
    await user.click(screen.getByRole("button", { name: "Asignar" }));

    await vi.waitFor(() =>
      expect(asignarDesdeSateliteMock).toHaveBeenCalledWith({
        ordenIds: ["o1"],
        mensajeroId: "m1",
        dia: "manana",
      }),
    );
  });

  it("R3/R6: el día viaja UNA vez para TODO el lote, y como token — nunca una fecha", async () => {
    const user = userEvent.setup();
    asignarDesdeSateliteMock.mockResolvedValue({
      status: "ok",
      resultados: [
        { ordenId: "o1", estado: "por_recoger" },
        { ordenId: "o2", estado: "por_recoger" },
      ],
    });
    renderModal([makeOrden({ id: "o1" }), makeOrden({ id: "o2" })]);

    await elegirMensajero(user);
    await user.click(screen.getByRole("radio", { name: "Mañana · 21 de agosto" }));
    await user.click(screen.getByRole("button", { name: "Asignar" }));

    await vi.waitFor(() =>
      expect(asignarDesdeSateliteMock).toHaveBeenCalledTimes(1),
    );
    const enviado = asignarDesdeSateliteMock.mock.calls[0][0] as Record<string, unknown>;
    expect(enviado.ordenIds).toEqual(["o1", "o2"]);
    expect(enviado.dia).toBe("manana");
    expect(Object.keys(enviado).sort()).toEqual(["dia", "mensajeroId", "ordenIds"]);
    expect(JSON.stringify(enviado)).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("R28: tras asignar, el modal dice CON PALABRAS para qué día quedó el lote", async () => {
    const user = userEvent.setup();
    asignarDesdeSateliteMock.mockResolvedValue({
      status: "ok",
      resultados: [{ ordenId: "o1", estado: "por_recoger" }],
    });
    renderModal([makeOrden({ id: "o1" })]);

    await elegirMensajero(user);
    await user.click(screen.getByRole("radio", { name: "Mañana · 21 de agosto" }));
    await user.click(screen.getByRole("button", { name: "Asignar" }));

    expect(
      await screen.findByText("El lote quedó para el reparto de mañana, 21 de agosto."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("El lote quedó para el reparto de hoy, 20 de agosto."),
    ).toBeNull();
  });

  it("R27: reabrir el modal vuelve a «Hoy» — un «Mañana» no se queda pegado al lote siguiente", async () => {
    const user = userEvent.setup();
    const { reabrir } = renderModal([makeOrden({ id: "o1" })]);

    await user.click(screen.getByRole("radio", { name: "Mañana · 21 de agosto" }));
    expect(
      screen.getByRole("radio", { name: "Mañana · 21 de agosto" }),
    ).toBeChecked();

    reabrir();

    expect(
      screen.getByRole("radio", { name: "Hoy · 20 de agosto" }),
    ).toBeChecked();
  });

  it("sin mensajeros en la zona no se ofrece elegir día: no hay acción a la que llevaría", () => {
    // La ausencia, EMPAREJADA con su presencia: el mismo lote CON mensajeros sí monta el
    // selector (caso de arriba), así que este `toBeNull` no puede pasar por «no se renderizó
    // nada».
    renderModal([makeOrden({ id: "o1" })], []);

    expect(screen.getByRole("alert")).toHaveTextContent(
      /no hay mensajeros en tu zona/i,
    );
    expect(screen.queryByRole("radiogroup", { name: "Día de reparto" })).toBeNull();
  });
});

// =================================================================================================
// FEATURE 271 (T9.5, R29/R32) — EL SELECTOR DE LA BODEGA SATELITE DESHABILITA A LOS BLOQUEADOS.
// =================================================================================================
//
// ⚠️ ESTA ES LA PANTALLA DEL INCIDENTE DEL 18/08. Dejaba elegir a un mensajero que el servidor
// rechazaba, y el mensaje que devolvia no lo explicaba. Este selector NUNCA habia tenido el dato
// —ni antes ni despues de la regla firmada el 20/08—: el de la bodega central al menos lo tuvo y
// se le retiro a proposito. Aqui era la mitad que faltaba.
//
// LO QUE ESTOS CASOS AFIRMAN Y LO QUE NO. Afirman que la PANTALLA marca exactamente a quien el
// servidor va a rechazar. NO afirman que el servidor lo rechace: eso vive en
// `tests/unit/services/cierre-bloqueo-superficies.test.ts` (familia B2) y en
// `asignacion-satelite-service.test.ts`, contra el predicado real. Las dos mitades tienen que
// existir: una pantalla que marca de mas prohibe lo que el servidor acepta, y una que marca de
// menos ofrece lo que va a negar.
describe("AsignarSateliteModal — bloqueados por cierres (271/T9.5)", () => {
  it("R32: el mensajero bloqueado sale DESHABILITADO y con el motivo a la vista", async () => {
    const user = userEvent.setup();
    renderModal([makeOrden({ id: "o1" })], MENSAJEROS, vi.fn(), vi.fn(), ["m2"]);

    await user.click(
      screen.getByRole("combobox", { name: "Mensajero para el lote" }),
    );
    const listbox = await screen.findByRole("listbox");

    // El motivo va EN la etiqueta, no solo en el atributo: un `aria-disabled` a secas deja al
    // adminSatelite preguntandose por que ese nombre esta gris.
    const bloqueado = within(listbox).getByRole("option", {
      name: "Beto Mensajero (tiene cierres sin resolver)",
    });
    expect(bloqueado).toHaveAttribute("aria-disabled", "true");
  });

  it("R34: y su companera SIN cierres sigue elegible — el bloqueo es del mensajero, no de la bodega", async () => {
    const user = userEvent.setup();
    renderModal([makeOrden({ id: "o1" })], MENSAJEROS, vi.fn(), vi.fn(), ["m2"]);

    await user.click(
      screen.getByRole("combobox", { name: "Mensajero para el lote" }),
    );
    const listbox = await screen.findByRole("listbox");

    const libre = within(listbox).getByRole("option", { name: "Ana Mensajera" });
    expect(libre).not.toHaveAttribute("aria-disabled", "true");
  });

  it("R32: sin bloqueados, ningun nombre lleva motivo (no se marca de mas)", async () => {
    const user = userEvent.setup();
    renderModal([makeOrden({ id: "o1" })]);

    await user.click(
      screen.getByRole("combobox", { name: "Mensajero para el lote" }),
    );
    const listbox = await screen.findByRole("listbox");

    expect(
      within(listbox).getByRole("option", { name: "Beto Mensajero" }),
    ).not.toHaveAttribute("aria-disabled", "true");
    expect(within(listbox).queryByText(/cierres sin resolver/i)).toBeNull();
  });
});

// Feature 400 (T16b, R31-R36) — EL MISMO AVISO, ESPEJO EXACTO DE LA BODEGA CENTRAL.
//
// Una orden cuyo último intento de ubicación murió por un fallo de configuración NUESTRO ya
// no bloquea la asignación (400/R1): recibe mensajero y queda SIN ubicación. Eso no es un
// conflicto —la orden SÍ recibió el efecto pedido— así que el aviso viaja por un canal
// propio: una CIFRA agregada (`sinUbicacion`) concatenada al mismo `mensaje` que el modal ya
// muestra en el toast y en el bloque de resultado. Nunca una lista de órdenes (R32), nunca
// dentro del `role="alert"` de las bloqueadas (R35), nunca una pantalla nueva (R34).
//
// Los dos literales van ESCRITOS A MANO (design.md §6.5-b).
describe("AsignarSateliteModal — órdenes asignadas sin ubicación (400/R31-R36)", () => {
  const AVISO_UNA =
    "1 orden se asignó sin ubicación en el mapa por un problema del sistema, no de la dirección. Se ubicará más tarde.";
  const AVISO_DOS =
    "2 órdenes se asignaron sin ubicación en el mapa por un problema del sistema, no de la dirección. Se ubicarán más tarde.";

  /** El bloque de confirmación del resultado: el que ya dice «Mensajero asignado a …». */
  function bloqueDeConfirmacion(): HTMLElement {
    const bloque = screen
      .getAllByRole("status")
      .find((el) => el.textContent?.includes("Mensajero asignado a"));
    // No-vacuidad: sin este bloque, todo lo que se afirme sobre su contenido pasaría por
    // comparar contra `undefined`.
    expect(bloque, "no se encontró el bloque de confirmación del resultado").toBeDefined();
    return bloque!;
  }

  it("R31/R34: con 2 órdenes sin ubicación, la CIFRA aparece en el MISMO bloque que confirma la asignación", async () => {
    const user = userEvent.setup();
    asignarDesdeSateliteMock.mockResolvedValue({
      status: "ok",
      resultados: [
        { ordenId: "orden-uno", estado: "por_recoger" },
        { ordenId: "orden-dos", estado: "por_recoger" },
      ],
      sinUbicacion: 2,
    });
    renderModal([
      makeOrden({ id: "orden-uno", numRemision: "NA-901" }),
      makeOrden({ id: "orden-dos", numRemision: "NA-902" }),
    ]);

    await elegirMensajero(user);
    await user.click(screen.getByRole("button", { name: "Asignar" }));

    // R34: dentro del bloque de resultado que YA existía, no en uno nuevo.
    await screen.findByRole("button", { name: "Cerrar" });
    const confirmacion = bloqueDeConfirmacion();
    expect(confirmacion.textContent).toContain("Mensajero asignado a 2 orden(es).");
    expect(confirmacion.textContent).toContain(AVISO_DOS);

    // R31: y el operador lo ve también en el toast, que es el otro sitio donde ya mira.
    await vi.waitFor(() => expect(successMock).toHaveBeenCalledTimes(1));
    expect(successMock.mock.calls[0]![0] as string).toContain(AVISO_DOS);
  });

  it("R31: con UNA sola orden sin ubicación, el aviso va en singular", async () => {
    const user = userEvent.setup();
    asignarDesdeSateliteMock.mockResolvedValue({
      status: "ok",
      resultados: [
        { ordenId: "orden-uno", estado: "por_recoger" },
        { ordenId: "orden-dos", estado: "por_recoger" },
      ],
      sinUbicacion: 1,
    });
    renderModal([
      makeOrden({ id: "orden-uno", numRemision: "NA-901" }),
      makeOrden({ id: "orden-dos", numRemision: "NA-902" }),
    ]);

    await elegirMensajero(user);
    await user.click(screen.getByRole("button", { name: "Asignar" }));

    await screen.findByRole("button", { name: "Cerrar" });
    expect(bloqueDeConfirmacion().textContent).toContain(AVISO_UNA);
  });

  it("R32: el aviso NO identifica cuál orden quedó sin ubicación — ni por guía ni por id", async () => {
    const user = userEvent.setup();
    asignarDesdeSateliteMock.mockResolvedValue({
      status: "ok",
      resultados: [
        { ordenId: "orden-sin-ubicacion-1", estado: "por_recoger" },
        { ordenId: "orden-sin-ubicacion-2", estado: "por_recoger" },
      ],
      sinUbicacion: 2,
    });
    renderModal([
      makeOrden({ id: "orden-sin-ubicacion-1", numRemision: "NA-901" }),
      makeOrden({ id: "orden-sin-ubicacion-2", numRemision: "NA-902" }),
    ]);

    await elegirMensajero(user);
    await user.click(screen.getByRole("button", { name: "Asignar" }));

    await screen.findByRole("button", { name: "Cerrar" });
    const texto = bloqueDeConfirmacion().textContent ?? "";
    // El aviso SÍ está —si no, esto pasaría por vacío— y aun así no nombra ninguna orden.
    expect(texto).toContain(AVISO_DOS);
    for (const identificador of [
      "NA-901",
      "NA-902",
      "orden-sin-ubicacion-1",
      "orden-sin-ubicacion-2",
    ]) {
      expect(texto, `el aviso no debe nombrar ${identificador}`).not.toContain(
        identificador,
      );
    }
  });

  it.each([
    ["sin el campo (respuesta de antes de la 400)", undefined],
    ["con el campo en cero", 0],
  ])("R33: %s no se renderiza ningún aviso", async (_caso, sinUbicacion) => {
    const user = userEvent.setup();
    asignarDesdeSateliteMock.mockResolvedValue({
      status: "ok",
      resultados: [{ ordenId: "orden-uno", estado: "por_recoger" }],
      ...(sinUbicacion === undefined ? {} : { sinUbicacion }),
    });
    renderModal([makeOrden({ id: "orden-uno", numRemision: "NA-901" })]);

    await elegirMensajero(user);
    await user.click(screen.getByRole("button", { name: "Asignar" }));

    await screen.findByRole("button", { name: "Cerrar" });
    const texto = bloqueDeConfirmacion().textContent ?? "";
    expect(texto).toContain("Mensajero asignado a 1 orden(es).");
    expect(texto).not.toMatch(/sin ubicación/i);
    expect(screen.queryByText(/sin ubicación/i)).toBeNull();
    // Y el toast tampoco lo lleva: es el mismo `mensaje`.
    await vi.waitFor(() => expect(successMock).toHaveBeenCalledTimes(1));
    expect(successMock.mock.calls[0]![0] as string).not.toMatch(/sin ubicación/i);
  });

  it("R35: con bloqueadas Y sin ubicación a la vez, los dos avisos no comparten contenedor ni mezclan sus números", async () => {
    const user = userEvent.setup();
    asignarDesdeSateliteMock.mockResolvedValue({
      status: "partial",
      resultados: [
        { ordenId: "orden-uno", estado: "por_recoger" },
        { ordenId: "orden-dos", estado: "por_recoger" },
      ],
      bloqueadas: [{ ordenId: "orden-tres", motivo: "direccion_no_geocodificable" }],
      sinUbicacion: 2,
    });
    renderModal([
      makeOrden({ id: "orden-uno", numRemision: "NA-901" }),
      makeOrden({ id: "orden-dos", numRemision: "NA-902" }),
      makeOrden({ id: "orden-tres", numRemision: "NA-903" }),
    ]);

    await elegirMensajero(user);
    await user.click(screen.getByRole("button", { name: "Asignar" }));

    // La lista de bloqueadas sigue siendo su propio `role="alert"`, y ahí SOLO hay bloqueadas.
    const bloqueadas = await screen.findByRole("alert");
    expect(bloqueadas.textContent).toContain("NA-903");
    expect(bloqueadas.textContent).toContain("Dirección no encontrada");
    expect(bloqueadas.textContent).not.toMatch(/sin ubicación/i);
    expect(within(bloqueadas).queryByText(AVISO_DOS)).toBeNull();

    // Y el aviso de la 400 vive en el bloque de confirmación, que NO es ese contenedor.
    const confirmacion = bloqueDeConfirmacion();
    expect(confirmacion).not.toBe(bloqueadas);
    expect(confirmacion.contains(bloqueadas)).toBe(false);
    expect(bloqueadas.contains(confirmacion)).toBe(false);
    expect(confirmacion.textContent).toContain(AVISO_DOS);
    // Los números no se mezclan: 2 asignadas de 3, 1 bloqueada, 2 sin ubicación.
    expect(confirmacion.textContent).toContain(
      "Mensajero asignado a 2 de 3 orden(es). 1 bloqueada(s).",
    );
  });

  it("R34: el aviso no abre ni una pantalla ni un diálogo nuevo — sigue habiendo un solo modal", async () => {
    const user = userEvent.setup();
    asignarDesdeSateliteMock.mockResolvedValue({
      status: "ok",
      resultados: [{ ordenId: "orden-uno", estado: "por_recoger" }],
      sinUbicacion: 1,
    });
    renderModal([makeOrden({ id: "orden-uno", numRemision: "NA-901" })]);

    await elegirMensajero(user);
    await user.click(screen.getByRole("button", { name: "Asignar" }));

    await screen.findByRole("button", { name: "Cerrar" });
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(bloqueDeConfirmacion().textContent).toContain(AVISO_UNA);
  });
});
