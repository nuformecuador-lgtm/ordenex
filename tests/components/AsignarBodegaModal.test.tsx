// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AsignarBodegaModal } from "@/app/(app)/ordenes/_components/AsignarBodegaModal";
import { asignarDesdeBodega } from "@/lib/actions/ordenes-guia";
import type { OrdenListItemDTO } from "@/lib/types/orden";
import type { MensajeroLiteDTO } from "@/lib/types/orden-guia";

// Feature 17 (T19) — Modal "Asignar mensajero" desde en_bodega_central (R26): un único
// mensajero para todo el lote seleccionado.
vi.mock("@/lib/actions/ordenes-guia", () => ({
  asignarDesdeBodega: vi.fn(),
}));

const asignarDesdeBodegaMock = vi.mocked(asignarDesdeBodega);

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

const MENSAJEROS: MensajeroLiteDTO[] = [
  { id: "m1", nombre: "Ana Mensajera" },
  { id: "m2", nombre: "Beto Mensajero" },
];

function makeOrden(
  overrides: Partial<OrdenListItemDTO> & { id: string },
): OrdenListItemDTO {
  return {
    numGuia: 100,
    numRemision: "REM-000",
    estatusId: "id-bodega",
    estatusValue: "en_bodega_central",
    destinatario: "Destino",
    telefonoDest: "0999999999",
    tiendaId: "tienda-uuid",
    tiendaNombre: "Tienda X",
    zonaId: "zona-1",
    provinciaId: "prov-1",
    cantonId: "canton-1",
    distritoId: null,
    producto: "Producto",
    peso: 1,
    notas: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

// Feature 246 (T4.2): las fechas del selector bajan de la página, resueltas en el servidor con
// el día de Costa Rica (R29). Aquí son literales fijos, para que las etiquetas que se afirman no
// dependan del día en que corra la suite.
const FECHAS_DIA_REPARTO = { hoy: "2026-08-20", manana: "2026-08-21" };

function renderModal(
  ordenes: OrdenListItemDTO[],
  onSuccess = vi.fn(),
  onOpenChange = vi.fn(),
) {
  const { rerender } = render(
    <AsignarBodegaModal
      open
      ordenes={ordenes}
      mensajeros={MENSAJEROS}
      fechasDiaReparto={FECHAS_DIA_REPARTO}
      onOpenChange={onOpenChange}
      onSuccess={onSuccess}
    />,
  );
  /** Reabre el modal SIN desmontarlo, que es como lo usa `OrdenesListado` (montado una vez). */
  function reabrir() {
    rerender(
      <AsignarBodegaModal
        open={false}
        ordenes={ordenes}
        mensajeros={MENSAJEROS}
        fechasDiaReparto={FECHAS_DIA_REPARTO}
        onOpenChange={onOpenChange}
        onSuccess={onSuccess}
      />,
    );
    rerender(
      <AsignarBodegaModal
        open
        ordenes={ordenes}
        mensajeros={MENSAJEROS}
        fechasDiaReparto={FECHAS_DIA_REPARTO}
        onOpenChange={onOpenChange}
        onSuccess={onSuccess}
      />,
    );
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

describe("AsignarBodegaModal", () => {
  it("R26: llama asignarDesdeBodega({ ordenIds, mensajeroId }) con el lote completo", async () => {
    const user = userEvent.setup();
    asignarDesdeBodegaMock.mockResolvedValue({
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

    const select = screen.getByRole("combobox", { name: "Mensajero para el lote" });
    await user.click(select);
    const listbox = await screen.findByRole("listbox");
    await user.click(within(listbox).getByRole("option", { name: "Ana Mensajera" }));

    await user.click(screen.getByRole("button", { name: "Asignar" }));

    expect(asignarDesdeBodegaMock).toHaveBeenCalledTimes(1);
    expect(asignarDesdeBodegaMock).toHaveBeenCalledWith({
      ordenIds: ["o1", "o2"],
      mensajeroId: "m1",
      // Feature 246 (R1/R27): sin tocar el selector, el lote va al reparto de HOY. El literal
      // se afirma aquí y no en un `expect.anything()`: el borde tiene `.default("hoy")`, así
      // que si el modal dejara de mandar el campo esto seguiría funcionando en producción y
      // NADIE se enteraría. Este `toHaveBeenCalledWith` es lo único que lo impide.
      dia: "hoy",
    });

    // Feature 148 (§9.7): tras el éxito el modal pasa a la fase "resultado" (con el
    // manifiesto del lote) y `onSuccess` se difiere al cierre de esa fase. La llamada
    // de negocio, su input y su toast NO cambian (R27).
    await user.click(await screen.findByRole("button", { name: "Cerrar" }));
    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(successMock).toHaveBeenCalledWith("Mensajero asignado a 2 orden(es).");
  });

  it("R26: sin mensajero seleccionado no llama a la acción y muestra el error de validación", async () => {
    const user = userEvent.setup();
    const ordenes = [makeOrden({ id: "o1", numRemision: "REM-001" })];
    renderModal(ordenes);

    await user.click(screen.getByRole("button", { name: "Asignar" }));

    expect(asignarDesdeBodegaMock).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      // Feature 156: el mapper es compartido con "Generar guía", que ya no elige
      // mensajero, así que el texto es genérico.
      expect(errorMock).toHaveBeenCalledWith("Datos inválidos: revisa la selección y vuelve a intentarlo."),
    );
  });

  // Feature 97/R9: el gate de asignabilidad por coordenadas (#98) devuelve `conflict` con el
  // `motivo` = `EstadoAsignabilidad` por orden; la UI lo traduce a un mensaje claro.
  it("R9: conflict 'direccion_no_geocodificable' muestra 'Dirección no encontrada'", async () => {
    const user = userEvent.setup();
    asignarDesdeBodegaMock.mockResolvedValue({
      status: "conflict",
      detalle: [{ ordenId: "o1", motivo: "direccion_no_geocodificable" }],
    });

    const ordenes = [makeOrden({ id: "o1", numRemision: "REM-001" })];
    const { onSuccess } = renderModal(ordenes);

    const select = screen.getByRole("combobox", { name: "Mensajero para el lote" });
    await user.click(select);
    const listbox = await screen.findByRole("listbox");
    await user.click(within(listbox).getByRole("option", { name: "Ana Mensajera" }));
    await user.click(screen.getByRole("button", { name: "Asignar" }));

    await vi.waitFor(() =>
      expect(errorMock).toHaveBeenCalledWith("Dirección no encontrada"),
    );
    expect(onSuccess).not.toHaveBeenCalled();
  });

  // FEATURE 400 (T16, R19/R23) — ESTE es el mensaje que mintió el 2026-09-08: el proveedor
  // rechazaba todas las peticiones por un fallo de configuración NUESTRO, la dirección nunca
  // llegaba a consultarse, y el modal decía «Dirección no encontrada». El operador se pasó la
  // mañana corrigiendo direcciones que estaban perfectamente bien. El modal no cambió de
  // código: hereda el texto nuevo del módulo compartido, que es lo que R23 exige. Literal
  // escrito a mano (design.md §6.2).
  it("400/R19: conflict 'geocodificacion_agotada' YA NO culpa a la dirección", async () => {
    const user = userEvent.setup();
    asignarDesdeBodegaMock.mockResolvedValue({
      status: "conflict",
      detalle: [{ ordenId: "o1", motivo: "geocodificacion_agotada" }],
    });

    renderModal([makeOrden({ id: "o1", numRemision: "REM-001" })]);

    const select = screen.getByRole("combobox", { name: "Mensajero para el lote" });
    await user.click(select);
    const listbox = await screen.findByRole("listbox");
    await user.click(within(listbox).getByRole("option", { name: "Ana Mensajera" }));
    await user.click(screen.getByRole("button", { name: "Asignar" }));

    await vi.waitFor(() =>
      expect(errorMock).toHaveBeenCalledWith(
        "No se pudo verificar la ubicación por un fallo del servicio de mapas. La dirección no es el problema; vuelve a intentarlo más tarde.",
      ),
    );
    expect(errorMock).not.toHaveBeenCalledWith("Dirección no encontrada");
  });

  it("R9: conflict 'geocodificacion_encolada' avisa que la dirección aún se valida", async () => {
    const user = userEvent.setup();
    asignarDesdeBodegaMock.mockResolvedValue({
      status: "conflict",
      detalle: [{ ordenId: "o1", motivo: "geocodificacion_encolada" }],
    });

    const ordenes = [makeOrden({ id: "o1", numRemision: "REM-001" })];
    renderModal(ordenes);

    const select = screen.getByRole("combobox", { name: "Mensajero para el lote" });
    await user.click(select);
    const listbox = await screen.findByRole("listbox");
    await user.click(within(listbox).getByRole("option", { name: "Ana Mensajera" }));
    await user.click(screen.getByRole("button", { name: "Asignar" }));

    await vi.waitFor(() =>
      expect(errorMock).toHaveBeenCalledWith(
        "La dirección aún se está validando. Vuelve a intentarlo en unos minutos.",
      ),
    );
  });
});

// Feature 368 (T5) — éxito parcial: el gate de coordenadas bloquea algunas órdenes del lote y
// las demás sí se asignan. El modal ya NO lo trata como error: pasa a la fase "resultado" con
// las asignadas Y las bloqueadas, en vez de lanzar al canal de error del Modal.
describe("AsignarBodegaModal — asignación parcial (368/R1/R10-R14)", () => {
  it("T5.1: partial (2 asignadas, 1 bloqueada) -> toast con los conteos y el detalle en el DOM", async () => {
    const user = userEvent.setup();
    asignarDesdeBodegaMock.mockResolvedValue({
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

    // El aserto no depende del literal exacto de Q1 (T5.1): solo de los números — 2 asignadas,
    // 1 bloqueada.
    await vi.waitFor(() => expect(successMock).toHaveBeenCalledTimes(1));
    const toastMsg = successMock.mock.calls[0]![0] as string;
    expect(toastMsg).toContain("2");
    expect(toastMsg).toContain("1");

    // El DOM de la fase "resultado" identifica la orden bloqueada por su `numRemision` (tomado
    // del `ordenes` prop del test) y el mensaje de SU motivo.
    //
    // FICHA 407: se acota a la lista de bloqueadas (`role="alert"`), que es DONDE R10/R11 de la
    // 368 exigen ese identificador. Antes se buscaba en todo el documento, y eso era un polizón,
    // no el contrato: desde la 407 esta misma orden —bloqueada por una dirección irresoluble—
    // aparece TAMBIÉN en el panel que ofrece autorizar su asignación, así que un `findByText`
    // sin ámbito encuentra dos. Lo que la 368 fijó es que la bloqueada se identifica por
    // remisión y con el mensaje de su motivo, y eso es exactamente lo que se sigue afirmando.
    const bloqueadas = await screen.findByRole("alert");
    expect(within(bloqueadas).getByText(/NA-138/)).toBeInTheDocument();
    expect(within(bloqueadas).getByText(/Dirección no encontrada/)).toBeInTheDocument();
  });

  it("T5.2: partial NO llama al canal de error del Modal — tuvo efecto, no es un error", async () => {
    const user = userEvent.setup();
    asignarDesdeBodegaMock.mockResolvedValue({
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

  it("T5.3: onSuccess sigue diferido al cierre del panel de resultado (feature 148, sin cambios)", async () => {
    const user = userEvent.setup();
    asignarDesdeBodegaMock.mockResolvedValue({
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

  it("T5.4: no-regresión — un 'ok' puro no menciona ninguna orden bloqueada en el DOM", async () => {
    const user = userEvent.setup();
    asignarDesdeBodegaMock.mockResolvedValue({
      status: "ok",
      resultados: [{ ordenId: "o1", estado: "por_recoger" }],
    });
    renderModal([makeOrden({ id: "o1", numRemision: "REM-001" })]);

    await elegirMensajero(user);
    await user.click(screen.getByRole("button", { name: "Asignar" }));

    await screen.findByRole("button", { name: "Cerrar" });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("T5.5: no-regresión — un 'conflict' (mensajero bloqueado por cierre) sigue lanzando al canal de error, sin tocar la fase resultado", async () => {
    const user = userEvent.setup();
    asignarDesdeBodegaMock.mockResolvedValue({
      status: "conflict",
      detalle: [{ ordenId: "o1", motivo: "mensajero bloqueado por cierre pendiente" }],
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

// Feature 246 (T4.2/T4.4) — ELEGIR PARA QUÉ DÍA ES EL LOTE, desde bodega central (R1/R27-R29).
//
// Todos los textos visibles se afirman con su literal ESCRITO A MANO, nunca contra la constante
// que los produce: comparar un texto con su propia fuente está siempre verde.
describe("AsignarBodegaModal — día de reparto (feature 246)", () => {
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

  it("R1: elegir «Mañana» hace que la acción reciba `dia: manana` — el selector NO es decorativo", async () => {
    const user = userEvent.setup();
    asignarDesdeBodegaMock.mockResolvedValue({
      status: "ok",
      resultados: [{ ordenId: "o1", estado: "por_recoger" }],
    });
    renderModal([makeOrden({ id: "o1" })]);

    await elegirMensajero(user);
    await user.click(screen.getByRole("radio", { name: "Mañana · 21 de agosto" }));
    await user.click(screen.getByRole("button", { name: "Asignar" }));

    await vi.waitFor(() =>
      expect(asignarDesdeBodegaMock).toHaveBeenCalledWith({
        ordenIds: ["o1"],
        mensajeroId: "m1",
        dia: "manana",
      }),
    );
  });

  it("R3/R6: el día viaja UNA vez para TODO el lote, y como token — nunca una fecha", async () => {
    const user = userEvent.setup();
    asignarDesdeBodegaMock.mockResolvedValue({
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

    await vi.waitFor(() => expect(asignarDesdeBodegaMock).toHaveBeenCalledTimes(1));
    const enviado = asignarDesdeBodegaMock.mock.calls[0][0] as Record<string, unknown>;
    // Una asignación, un día: el payload tiene UN `dia` para los dos ids, no uno por orden.
    expect(enviado.ordenIds).toEqual(["o1", "o2"]);
    expect(enviado.dia).toBe("manana");
    // Y ninguna fecha: el cliente manda el token y el servidor decide el día (R6).
    expect(Object.keys(enviado).sort()).toEqual(["dia", "mensajeroId", "ordenIds"]);
    expect(JSON.stringify(enviado)).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("R28: tras asignar, el modal dice CON PALABRAS para qué día quedó el lote", async () => {
    const user = userEvent.setup();
    asignarDesdeBodegaMock.mockResolvedValue({
      status: "ok",
      resultados: [{ ordenId: "o1", estado: "por_recoger" }],
    });
    renderModal([makeOrden({ id: "o1" })]);

    await elegirMensajero(user);
    await user.click(screen.getByRole("radio", { name: "Mañana · 21 de agosto" }));
    await user.click(screen.getByRole("button", { name: "Asignar" }));

    // El TEXTO, no una clase ni un `data-*`. Y con su día dentro: una confirmación que no
    // nombrara el día no confirmaría nada de lo que esta ficha añade.
    expect(
      await screen.findByText("El lote quedó para el reparto de mañana, 21 de agosto."),
    ).toBeInTheDocument();
    // Emparejada con su contraria: la frase de «hoy» NO está, y se sabe que el sitio donde
    // aparecería sí se renderizó porque la de «mañana» está justo encima.
    expect(
      screen.queryByText("El lote quedó para el reparto de hoy, 20 de agosto."),
    ).toBeNull();
  });

  it("R28: si se deja «Hoy», la confirmación nombra HOY (no un texto genérico)", async () => {
    const user = userEvent.setup();
    asignarDesdeBodegaMock.mockResolvedValue({
      status: "ok",
      resultados: [{ ordenId: "o1", estado: "por_recoger" }],
    });
    renderModal([makeOrden({ id: "o1" })]);

    await elegirMensajero(user);
    await user.click(screen.getByRole("button", { name: "Asignar" }));

    expect(
      await screen.findByText("El lote quedó para el reparto de hoy, 20 de agosto."),
    ).toBeInTheDocument();
  });

  it("R27: reabrir el modal vuelve a «Hoy» — un «Mañana» no se queda pegado al lote siguiente", async () => {
    const user = userEvent.setup();
    const { reabrir } = renderModal([makeOrden({ id: "o1" })]);

    await user.click(screen.getByRole("radio", { name: "Mañana · 21 de agosto" }));
    expect(
      screen.getByRole("radio", { name: "Mañana · 21 de agosto" }),
    ).toBeChecked();

    reabrir();

    // Es el caso que separa «el defecto es hoy» de «el defecto es lo último que tocaste». Sin
    // esto, un lote asignado para mañana convertiría en «para mañana» todos los siguientes.
    expect(
      screen.getByRole("radio", { name: "Hoy · 20 de agosto" }),
    ).toBeChecked();
    expect(
      screen.getByRole("radio", { name: "Mañana · 21 de agosto" }),
    ).not.toBeChecked();
  });
});

// Feature 160 (T17, R18/R19/R23) — el diálogo lista las órdenes en un `<ul>`: el
// conteo va como DATO ETIQUETADO en la misma línea, con el markup del resto del `<li>`.
describe("AsignarBodegaModal — intentos de entrega (feature 160)", () => {
  it("R18: cada orden listada muestra el dato etiquetado junto a su remisión", () => {
    renderModal([makeOrden({ id: "o1", numRemision: "REM-A1", intentosEntrega: 2 })]);
    const item = screen.getByRole("listitem");
    expect(item).toHaveTextContent("REM-A1");
    expect(within(item).getByText("Intentos: 2")).toBeInTheDocument();
  });

  it("R19: con 0 intentos el dato SE MUESTRA igual (no se omite)", () => {
    renderModal([makeOrden({ id: "o1", numRemision: "REM-A0", intentosEntrega: 0 })]);
    const item = screen.getByRole("listitem");
    expect(within(item).getByText("Intentos: 0")).toBeInTheDocument();
  });

  it("R19: sin el campo (DTO viejo) el dato se muestra como 0", () => {
    renderModal([makeOrden({ id: "o1", numRemision: "REM-AX" })]);
    expect(
      within(screen.getByRole("listitem")).getByText("Intentos: 0"),
    ).toBeInTheDocument();
  });

  it("R19: cada orden lleva SU número, no el de la primera", () => {
    renderModal([
      makeOrden({ id: "o1", numRemision: "REM-B1", intentosEntrega: 3 }),
      makeOrden({ id: "o2", numRemision: "REM-B2", intentosEntrega: 0 }),
    ]);
    const items = screen.getAllByRole("listitem");
    expect(within(items[0]).getByText("Intentos: 3")).toBeInTheDocument();
    expect(within(items[1]).getByText("Intentos: 0")).toBeInTheDocument();
  });

  it("R20: el dato no incluye el umbral ('de N')", () => {
    renderModal([makeOrden({ id: "o1", numRemision: "REM-U", intentosEntrega: 2 })]);
    const dato = within(screen.getByRole("listitem")).getByText("Intentos: 2");
    expect(dato.textContent).toBe("Intentos: 2");
  });
});

// Feature 400 (T16b, R31-R36) — EL AVISO QUE PIDIÓ EL HUMANO EN LA PUERTA DE APROBACIÓN.
//
// Una orden cuyo último intento de ubicación murió por un fallo de configuración NUESTRO ya
// no bloquea la asignación (400/R1): recibe mensajero y queda SIN ubicación. Eso no es un
// conflicto —la orden SÍ recibió el efecto pedido— así que el aviso viaja por un canal
// propio: una CIFRA agregada (`sinUbicacion`) concatenada al mismo `mensaje` que el modal ya
// muestra en el toast y en el bloque de resultado. Nunca una lista de órdenes (R32), nunca
// dentro del `role="alert"` de las bloqueadas (R35), nunca una pantalla nueva (R34).
//
// Los dos literales van ESCRITOS A MANO (design.md §6.5-b).
describe("AsignarBodegaModal — órdenes asignadas sin ubicación (400/R31-R36)", () => {
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
    asignarDesdeBodegaMock.mockResolvedValue({
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
    asignarDesdeBodegaMock.mockResolvedValue({
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
    asignarDesdeBodegaMock.mockResolvedValue({
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
    asignarDesdeBodegaMock.mockResolvedValue({
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
    asignarDesdeBodegaMock.mockResolvedValue({
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
    asignarDesdeBodegaMock.mockResolvedValue({
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
