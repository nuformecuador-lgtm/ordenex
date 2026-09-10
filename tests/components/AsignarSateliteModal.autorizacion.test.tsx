// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AsignarSateliteModal } from "@/app/(app)/recepcion-satelite/_components/AsignarSateliteModal";
import { asignarDesdeSatelite } from "@/lib/actions/recepcion-satelite";
import { obtenerManifiesto } from "@/lib/actions/manifiesto";
import type { RecepcionSateliteDTO } from "@/lib/interfaces/services/IRecepcionSateliteService";
import { CAMPOS_BASE_ORDEN } from "@/tests/fixtures/fila-bodega-satelite";

/**
 * FICHA 407 (T11) — AUTORIZAR LA ASIGNACIÓN DE UNA ORDEN SIN UBICACIÓN, desde bodega satélite.
 *
 * Espejo exacto de `AsignarBodegaModal.autorizacion.test.tsx`, y la pantalla que MÁS importa:
 * la guía 76068276 del caso medido (Quesada / San Carlos) estaba `en_bodega_satelite`, así que
 * es aquí donde alguien llevaba cinco días sin poder asignarla. Que la ficha se olvidara de uno
 * de los dos lados lo caza esta pareja de archivos.
 *
 * ⚠️ LOS DOS LITERALES ESTÁN ESCRITOS A MANO, copiados de design.md §5.1 y §5.2. Nunca se
 * comparan contra la constante que los produce.
 */

vi.mock("@/lib/actions/recepcion-satelite", () => ({
  asignarDesdeSatelite: vi.fn(),
}));
const asignarDesdeSateliteMock = vi.mocked(asignarDesdeSatelite);

// El manifiesto se mockea para poder OBSERVAR con qué lote se pide (R20) sin armar un xlsx.
vi.mock("@/lib/actions/manifiesto", () => ({ obtenerManifiesto: vi.fn() }));
const obtenerManifiestoMock = vi.mocked(obtenerManifiesto);

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

// Ids con forma de uuid: el borde valida `z.array(z.string().uuid())`, así que la segunda
// petición manda el id REAL — y R19 exige que ese id no aparezca en pantalla.
const ID_IRRESOLUBLE = "44444444-4444-4444-8444-444444444444";
const ID_EN_CURSO = "55555555-5555-4555-8555-555555555555";
const ID_ASIGNABLE = "66666666-6666-4666-8666-666666666666";

/** design.md §5.1, palabra por palabra. */
const LITERAL_CONSECUENCIA =
  "El mapa no reconoce esta dirección, así que la orden no tiene un punto en el mapa. Si autorizas, se podrá asignar a un mensajero: aparecerá al final de su lista de entregas y no se tendrá en cuenta al calcular el orden del recorrido. Autoriza solo si el mensajero puede llegar con las indicaciones de la dirección.";

/** design.md §5.2, palabra por palabra. */
const LITERAL_AUTORIZADAS_UNA =
  "1 orden se asignó sin ubicación en el mapa porque se autorizó hacerlo. Aparecerá al final de la lista de entregas del mensajero.";
const LITERAL_AUTORIZADAS_DOS =
  "2 órdenes se asignaron sin ubicación en el mapa porque se autorizó hacerlo. Aparecerán al final de la lista de entregas del mensajero.";

/** El aviso de la FEATURE 400, el que aquí sería falso (R12). También a mano. */
const LITERAL_400_UNA =
  "1 orden se asignó sin ubicación en el mapa por un problema del sistema, no de la dirección. Se ubicará más tarde.";

const ETIQUETA_AUTORIZAR = "Autorizar y asignar sin ubicación";

function makeOrden(
  overrides: Partial<RecepcionSateliteDTO> & { id: string },
): RecepcionSateliteDTO {
  return {
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
    zonaNombre: "FGAM San Ramón",
    provinciaNombre: "Alajuela",
    cantonNombre: "San Carlos",
    distritoNombre: "Quesada",
    ...overrides,
  };
}

const FECHAS_DIA_REPARTO = { hoy: "2026-08-20", manana: "2026-08-21" };

function renderModal(ordenes: RecepcionSateliteDTO[], onSuccess = vi.fn()) {
  const onOpenChange = vi.fn();
  const { rerender } = render(
    <AsignarSateliteModal
      open
      ordenes={ordenes}
      mensajeros={MENSAJEROS}
      fechasDiaReparto={FECHAS_DIA_REPARTO}
      onOpenChange={onOpenChange}
      onSuccess={onSuccess}
    />,
  );
  /** Reabre SIN desmontar, que es como lo monta `RecepcionSateliteModule` (una sola vez). */
  function reabrir() {
    for (const abierto of [false, true]) {
      rerender(
        <AsignarSateliteModal
          open={abierto}
          ordenes={ordenes}
          mensajeros={MENSAJEROS}
          fechasDiaReparto={FECHAS_DIA_REPARTO}
          onOpenChange={onOpenChange}
          onSuccess={onSuccess}
        />,
      );
    }
  }
  return { onSuccess, onOpenChange, reabrir };
}

async function elegirMensajero(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("combobox", { name: "Mensajero para el lote" }));
  const listbox = await screen.findByRole("listbox");
  await user.click(within(listbox).getByRole("option", { name: "Ana Mensajera" }));
}

async function asignar(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Asignar" }));
}

/** El panel de autorización, o `null` si no está ofrecido. */
function panel(): HTMLElement | null {
  return screen.queryByRole("region", {
    name: "Autorizar asignación sin ubicación en el mapa",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // El manifiesto no se llega a armar: solo interesa CON QUÉ LOTE se pide (R20). Con `ok` y
  // cero filas el botón se detiene antes de construir el xlsx.
  obtenerManifiestoMock.mockResolvedValue({ status: "ok", filas: [], omitidas: [] });
});

afterEach(() => {
  cleanup();
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// R16 — CUÁNDO SE OFRECE AUTORIZAR
// ─────────────────────────────────────────────────────────────────────────────────────────
describe("AsignarSateliteModal — 407/R16: el modal ofrece autorizar en las DOS rutas", () => {
  it("R16-a: `conflict` (nada asignado) pinta el panel Y el toast de error sigue saliendo", async () => {
    const user = userEvent.setup();
    // La forma EXACTA del caso de producción: una sola orden en bodega satélite, bloqueada por
    // una dirección de referencias que el mapa no resuelve.
    asignarDesdeSateliteMock.mockResolvedValue({
      status: "conflict",
      detalle: [{ ordenId: ID_IRRESOLUBLE, motivo: "direccion_no_geocodificable" }],
    });
    renderModal([makeOrden({ id: ID_IRRESOLUBLE, numRemision: "NA-138" })]);

    await elegirMensajero(user);
    await asignar(user);

    await vi.waitFor(() =>
      expect(errorMock).toHaveBeenCalledWith("Dirección no encontrada"),
    );
    const bloque = await screen.findByRole("region", {
      name: "Autorizar asignación sin ubicación en el mapa",
    });
    expect(within(bloque).getByRole("button", { name: ETIQUETA_AUTORIZAR })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cerrar" })).toBeNull();
  });

  it("R16-b: `partial` pinta el panel JUNTO a la lista de bloqueadas, sin pisarla", async () => {
    const user = userEvent.setup();
    asignarDesdeSateliteMock.mockResolvedValue({
      status: "partial",
      resultados: [{ ordenId: ID_ASIGNABLE, estado: "por_recoger" }],
      bloqueadas: [{ ordenId: ID_IRRESOLUBLE, motivo: "direccion_no_geocodificable" }],
    });
    renderModal([
      makeOrden({ id: ID_ASIGNABLE, numRemision: "NA-900" }),
      makeOrden({ id: ID_IRRESOLUBLE, numRemision: "NA-138" }),
    ]);

    await elegirMensajero(user);
    await asignar(user);

    const bloque = await screen.findByRole("region", {
      name: "Autorizar asignación sin ubicación en el mapa",
    });
    expect(within(bloque).getByText("NA-138")).toBeInTheDocument();
    const bloqueadas = screen.getByRole("alert");
    expect(bloqueadas.textContent).toContain("Dirección no encontrada");
    expect(bloqueadas.contains(bloque)).toBe(false);
    expect(bloque.contains(bloqueadas)).toBe(false);
  });

  it("R16-c (contraste): `conflict` con una geocodificación EN CURSO no ofrece autorizar nada", async () => {
    const user = userEvent.setup();
    asignarDesdeSateliteMock.mockResolvedValue({
      status: "conflict",
      detalle: [{ ordenId: ID_EN_CURSO, motivo: "geocodificacion_en_curso" }],
    });
    renderModal([makeOrden({ id: ID_EN_CURSO, numRemision: "NA-200" })]);

    await elegirMensajero(user);
    await asignar(user);

    await vi.waitFor(() => expect(errorMock).toHaveBeenCalledTimes(1));
    expect(panel()).toBeNull();
    expect(screen.queryByRole("button", { name: ETIQUETA_AUTORIZAR })).toBeNull();
  });

  it.each([
    "geocodificacion_encolada",
    "geocodificacion_no_encolable",
    "geocodificacion_agotada",
  ])("R16-c: %s tampoco se ofrece — ninguno es un veredicto definitivo sobre la dirección", async (motivo) => {
    const user = userEvent.setup();
    asignarDesdeSateliteMock.mockResolvedValue({
      status: "conflict",
      detalle: [{ ordenId: ID_EN_CURSO, motivo }],
    });
    renderModal([makeOrden({ id: ID_EN_CURSO, numRemision: "NA-200" })]);

    await elegirMensajero(user);
    await asignar(user);

    await vi.waitFor(() => expect(errorMock).toHaveBeenCalledTimes(1));
    expect(panel()).toBeNull();
  });

  it("no-regresión: un `ok` limpio no ofrece autorizar nada", async () => {
    const user = userEvent.setup();
    asignarDesdeSateliteMock.mockResolvedValue({
      status: "ok",
      resultados: [{ ordenId: ID_ASIGNABLE, estado: "por_recoger" }],
    });
    renderModal([makeOrden({ id: ID_ASIGNABLE, numRemision: "NA-900" })]);

    await elegirMensajero(user);
    await asignar(user);

    await screen.findByRole("button", { name: "Cerrar" });
    expect(panel()).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// R14 / R15 / R19 — QUÉ SE LEE Y QUÉ NO SE FILTRA
// ─────────────────────────────────────────────────────────────────────────────────────────
describe("AsignarSateliteModal — 407/R14-R15-R19: lo que el panel dice, y lo que jamás enseña", () => {
  const DIRECCION_DEL_CASO =
    "DE LA CLINICA VETERINARIA MASCOTICAS, 75 METROS HACIA EL SUR";

  async function abrirPanel() {
    const user = userEvent.setup();
    asignarDesdeSateliteMock.mockResolvedValue({
      status: "conflict",
      detalle: [{ ordenId: ID_IRRESOLUBLE, motivo: "direccion_no_geocodificable" }],
    });
    renderModal([
      makeOrden({
        id: ID_IRRESOLUBLE,
        numRemision: "NA-138",
        destinatario: "ÓSCAR ELIZONDO SOLIS",
        telefonoDest: "88887777",
        direccion: DIRECCION_DEL_CASO,
      }),
    ]);
    await elegirMensajero(user);
    await asignar(user);
    await screen.findByRole("region", {
      name: "Autorizar asignación sin ubicación en el mapa",
    });
    return user;
  }

  it("R14: el literal de la consecuencia está en el documento ANTES de pulsar el control", async () => {
    await abrirPanel();

    expect(screen.getByText(LITERAL_CONSECUENCIA)).toBeInTheDocument();
    expect(asignarDesdeSateliteMock).toHaveBeenCalledTimes(1);
  });

  it("R19: el panel identifica la orden por su número de remisión", async () => {
    await abrirPanel();

    expect(within(panel()!).getByText("NA-138")).toBeInTheDocument();
  });

  it("R19/R15: ni el id interno, ni la dirección, ni el teléfono aparecen en el DOM", async () => {
    await abrirPanel();

    expect(document.body.textContent).not.toContain(ID_IRRESOLUBLE);
    expect(document.body.textContent).not.toContain(DIRECCION_DEL_CASO);
    expect(document.body.textContent).not.toContain("88887777");
  });

  it("R15: el texto de la consecuencia no lleva ni un dígito — no puede arrastrar guía ni teléfono", async () => {
    await abrirPanel();

    expect(screen.getByText(LITERAL_CONSECUENCIA).textContent).not.toMatch(/\d/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// R18 — LA SEGUNDA PETICIÓN: UNA SOLA, CON LA MARCA, Y ACOTADA
// ─────────────────────────────────────────────────────────────────────────────────────────
describe("AsignarSateliteModal — 407/R18: la segunda petición va acotada a las autorizables", () => {
  it("R5: la PRIMERA petición no lleva ninguna marca — nadie autoriza sin pedirlo", async () => {
    const user = userEvent.setup();
    asignarDesdeSateliteMock.mockResolvedValue({
      status: "conflict",
      detalle: [{ ordenId: ID_IRRESOLUBLE, motivo: "direccion_no_geocodificable" }],
    });
    renderModal([makeOrden({ id: ID_IRRESOLUBLE, numRemision: "NA-138" })]);

    await elegirMensajero(user);
    await asignar(user);

    const primera = asignarDesdeSateliteMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(primera).not.toHaveProperty("autorizarSinUbicacionIds");
  });

  it("R18: tras confirmar, se lanza UNA sola petición más, con la marca y el MISMO conjunto", async () => {
    const user = userEvent.setup();
    asignarDesdeSateliteMock
      .mockResolvedValueOnce({
        status: "conflict",
        detalle: [{ ordenId: ID_IRRESOLUBLE, motivo: "direccion_no_geocodificable" }],
      })
      .mockResolvedValueOnce({
        status: "ok",
        resultados: [{ ordenId: ID_IRRESOLUBLE, estado: "por_recoger" }],
        sinUbicacionAutorizada: 1,
      });
    renderModal([makeOrden({ id: ID_IRRESOLUBLE, numRemision: "NA-138" })]);

    await elegirMensajero(user);
    await asignar(user);
    await user.click(await screen.findByRole("button", { name: ETIQUETA_AUTORIZAR }));

    await vi.waitFor(() => expect(asignarDesdeSateliteMock).toHaveBeenCalledTimes(2));
    expect(asignarDesdeSateliteMock.mock.calls[1]![0]).toEqual({
      ordenIds: [ID_IRRESOLUBLE],
      mensajeroId: "m1",
      dia: "hoy",
      autorizarSinUbicacionIds: [ID_IRRESOLUBLE],
    });
  });

  it("R18/R3: en la ruta `partial` la segunda petición NO reenvía el lote entero, solo las autorizables", async () => {
    const user = userEvent.setup();
    asignarDesdeSateliteMock
      .mockResolvedValueOnce({
        status: "partial",
        resultados: [{ ordenId: ID_ASIGNABLE, estado: "por_recoger" }],
        bloqueadas: [
          { ordenId: ID_IRRESOLUBLE, motivo: "direccion_no_geocodificable" },
          { ordenId: ID_EN_CURSO, motivo: "geocodificacion_en_curso" },
        ],
      })
      .mockResolvedValueOnce({
        status: "ok",
        resultados: [{ ordenId: ID_IRRESOLUBLE, estado: "por_recoger" }],
        sinUbicacionAutorizada: 1,
      });
    renderModal([
      makeOrden({ id: ID_ASIGNABLE, numRemision: "NA-900" }),
      makeOrden({ id: ID_IRRESOLUBLE, numRemision: "NA-138" }),
      makeOrden({ id: ID_EN_CURSO, numRemision: "NA-200" }),
    ]);

    await elegirMensajero(user);
    await asignar(user);
    await user.click(await screen.findByRole("button", { name: ETIQUETA_AUTORIZAR }));

    await vi.waitFor(() => expect(asignarDesdeSateliteMock).toHaveBeenCalledTimes(2));
    const segunda = asignarDesdeSateliteMock.mock.calls[1]![0] as {
      ordenIds: string[];
      autorizarSinUbicacionIds: string[];
    };
    expect(segunda.ordenIds).toEqual([ID_IRRESOLUBLE]);
    expect(segunda.ordenIds).not.toContain(ID_ASIGNABLE);
    expect(segunda.ordenIds).not.toContain(ID_EN_CURSO);
  });

  it("R3 (hostil): la marca NO se contagia a la orden del lote que no es autorizable", async () => {
    const user = userEvent.setup();
    asignarDesdeSateliteMock
      .mockResolvedValueOnce({
        status: "conflict",
        detalle: [
          { ordenId: ID_IRRESOLUBLE, motivo: "direccion_no_geocodificable" },
          { ordenId: ID_EN_CURSO, motivo: "geocodificacion_en_curso" },
        ],
      })
      .mockResolvedValueOnce({
        status: "ok",
        resultados: [{ ordenId: ID_IRRESOLUBLE, estado: "por_recoger" }],
        sinUbicacionAutorizada: 1,
      });
    renderModal([
      makeOrden({ id: ID_IRRESOLUBLE, numRemision: "NA-138" }),
      makeOrden({ id: ID_EN_CURSO, numRemision: "NA-200" }),
    ]);

    await elegirMensajero(user);
    await asignar(user);

    const bloque = await screen.findByRole("region", {
      name: "Autorizar asignación sin ubicación en el mapa",
    });
    expect(within(bloque).getByText("NA-138")).toBeInTheDocument();
    expect(within(bloque).queryByText("NA-200")).toBeNull();

    await user.click(within(bloque).getByRole("button", { name: ETIQUETA_AUTORIZAR }));
    await vi.waitFor(() => expect(asignarDesdeSateliteMock).toHaveBeenCalledTimes(2));
    const segunda = asignarDesdeSateliteMock.mock.calls[1]![0] as {
      autorizarSinUbicacionIds: string[];
    };
    expect(segunda.autorizarSinUbicacionIds).toEqual([ID_IRRESOLUBLE]);
  });

  it("R18: pulsar dos veces seguidas no dispara dos peticiones — el control se bloquea", async () => {
    const user = userEvent.setup();
    let resolver!: (v: { status: "ok"; resultados: { ordenId: string; estado: string }[] }) => void;
    asignarDesdeSateliteMock
      .mockResolvedValueOnce({
        status: "conflict",
        detalle: [{ ordenId: ID_IRRESOLUBLE, motivo: "direccion_no_geocodificable" }],
      })
      .mockReturnValueOnce(
        new Promise((r) => {
          resolver = r as typeof resolver;
        }),
      );
    renderModal([makeOrden({ id: ID_IRRESOLUBLE, numRemision: "NA-138" })]);

    await elegirMensajero(user);
    await asignar(user);
    const boton = await screen.findByRole("button", { name: ETIQUETA_AUTORIZAR });
    await user.click(boton);
    await vi.waitFor(() => expect(boton).toBeDisabled());
    await user.click(boton);

    expect(asignarDesdeSateliteMock).toHaveBeenCalledTimes(2);
    resolver({ status: "ok", resultados: [{ ordenId: ID_IRRESOLUBLE, estado: "por_recoger" }] });
  });

  it("R9: al reabrir el modal la autorización NO sobrevive — el panel desaparece", async () => {
    const user = userEvent.setup();
    asignarDesdeSateliteMock.mockResolvedValue({
      status: "conflict",
      detalle: [{ ordenId: ID_IRRESOLUBLE, motivo: "direccion_no_geocodificable" }],
    });
    const { reabrir } = renderModal([
      makeOrden({ id: ID_IRRESOLUBLE, numRemision: "NA-138" }),
    ]);

    await elegirMensajero(user);
    await asignar(user);
    await screen.findByRole("region", {
      name: "Autorizar asignación sin ubicación en el mapa",
    });

    reabrir();

    expect(panel()).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// R20 — EL MANIFIESTO ACUMULA LAS DOS PETICIONES
// ─────────────────────────────────────────────────────────────────────────────────────────
describe("AsignarSateliteModal — 407/R20: el manifiesto lleva TODO lo asignado en la apertura", () => {
  it("R20: una asignada en la primera petición y otra en la segunda → el manifiesto pide las DOS", async () => {
    const user = userEvent.setup();
    asignarDesdeSateliteMock
      .mockResolvedValueOnce({
        status: "partial",
        resultados: [{ ordenId: ID_ASIGNABLE, estado: "por_recoger" }],
        bloqueadas: [{ ordenId: ID_IRRESOLUBLE, motivo: "direccion_no_geocodificable" }],
      })
      .mockResolvedValueOnce({
        status: "ok",
        resultados: [{ ordenId: ID_IRRESOLUBLE, estado: "por_recoger" }],
        sinUbicacionAutorizada: 1,
      });
    renderModal([
      makeOrden({ id: ID_ASIGNABLE, numRemision: "NA-900" }),
      makeOrden({ id: ID_IRRESOLUBLE, numRemision: "NA-138" }),
    ]);

    await elegirMensajero(user);
    await asignar(user);
    await user.click(await screen.findByRole("button", { name: ETIQUETA_AUTORIZAR }));
    await vi.waitFor(() => expect(asignarDesdeSateliteMock).toHaveBeenCalledTimes(2));

    await user.click(await screen.findByRole("button", { name: /descargar manifiesto/i }));
    await vi.waitFor(() => expect(obtenerManifiestoMock).toHaveBeenCalledTimes(1));
    expect(obtenerManifiestoMock).toHaveBeenCalledWith({
      flujo: "asignacion_satelite",
      ordenIds: [ID_ASIGNABLE, ID_IRRESOLUBLE],
    });
  });

  it("R20: la orden recién autorizada deja de figurar como bloqueada", async () => {
    const user = userEvent.setup();
    asignarDesdeSateliteMock
      .mockResolvedValueOnce({
        status: "partial",
        resultados: [{ ordenId: ID_ASIGNABLE, estado: "por_recoger" }],
        bloqueadas: [
          { ordenId: ID_IRRESOLUBLE, motivo: "direccion_no_geocodificable" },
          { ordenId: ID_EN_CURSO, motivo: "geocodificacion_en_curso" },
        ],
      })
      .mockResolvedValueOnce({
        status: "ok",
        resultados: [{ ordenId: ID_IRRESOLUBLE, estado: "por_recoger" }],
        sinUbicacionAutorizada: 1,
      });
    renderModal([
      makeOrden({ id: ID_ASIGNABLE, numRemision: "NA-900" }),
      makeOrden({ id: ID_IRRESOLUBLE, numRemision: "NA-138" }),
      makeOrden({ id: ID_EN_CURSO, numRemision: "NA-200" }),
    ]);

    await elegirMensajero(user);
    await asignar(user);
    await user.click(await screen.findByRole("button", { name: ETIQUETA_AUTORIZAR }));
    await vi.waitFor(() => expect(asignarDesdeSateliteMock).toHaveBeenCalledTimes(2));

    const bloqueadas = await screen.findByRole("alert");
    expect(bloqueadas.textContent).toContain("NA-200");
    expect(bloqueadas.textContent).not.toContain("NA-138");
    expect(panel()).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// R10 / R12 — EL AVISO AGREGADO, Y EL TEXTO QUE AQUÍ SERÍA FALSO
// ─────────────────────────────────────────────────────────────────────────────────────────
describe("AsignarSateliteModal — 407/R10-R12: el aviso de la autorización no es el de la 400", () => {
  it("R10/R12: con `sinUbicacionAutorizada: 2`, el aviso de la 407 y NO el de la 400", async () => {
    const user = userEvent.setup();
    asignarDesdeSateliteMock
      .mockResolvedValueOnce({
        status: "conflict",
        detalle: [
          { ordenId: ID_IRRESOLUBLE, motivo: "direccion_no_geocodificable" },
          { ordenId: ID_EN_CURSO, motivo: "direccion_no_geocodificable" },
        ],
      })
      .mockResolvedValueOnce({
        status: "ok",
        resultados: [
          { ordenId: ID_IRRESOLUBLE, estado: "por_recoger" },
          { ordenId: ID_EN_CURSO, estado: "por_recoger" },
        ],
        sinUbicacionAutorizada: 2,
      });
    renderModal([
      makeOrden({ id: ID_IRRESOLUBLE, numRemision: "NA-138" }),
      makeOrden({ id: ID_EN_CURSO, numRemision: "NA-200" }),
    ]);

    await elegirMensajero(user);
    await asignar(user);
    await user.click(await screen.findByRole("button", { name: ETIQUETA_AUTORIZAR }));

    await vi.waitFor(() => expect(successMock).toHaveBeenCalledTimes(1));
    const toastMsg = successMock.mock.calls[0]![0] as string;
    expect(toastMsg).toContain(LITERAL_AUTORIZADAS_DOS);
    expect(toastMsg).not.toContain("no de la dirección");
    expect(toastMsg).not.toContain("problema del sistema");
    expect(
      await screen.findByText(new RegExp(LITERAL_AUTORIZADAS_DOS.slice(0, 40))),
    ).toBeInTheDocument();
  });

  it("R11: las dos cifras conviven sin mezclarse — una de la 400 y una de la 407", async () => {
    const user = userEvent.setup();
    asignarDesdeSateliteMock.mockResolvedValue({
      status: "ok",
      resultados: [
        { ordenId: ID_ASIGNABLE, estado: "por_recoger" },
        { ordenId: ID_IRRESOLUBLE, estado: "por_recoger" },
      ],
      sinUbicacion: 1,
      sinUbicacionAutorizada: 1,
    });
    renderModal([
      makeOrden({ id: ID_ASIGNABLE, numRemision: "NA-900" }),
      makeOrden({ id: ID_IRRESOLUBLE, numRemision: "NA-138" }),
    ]);

    await elegirMensajero(user);
    await asignar(user);

    await vi.waitFor(() => expect(successMock).toHaveBeenCalledTimes(1));
    const toastMsg = successMock.mock.calls[0]![0] as string;
    expect(toastMsg).toContain(LITERAL_400_UNA);
    expect(toastMsg).toContain(LITERAL_AUTORIZADAS_UNA);
  });

  it("R10: sin ninguna autorizada, el aviso de la 407 no aparece por ningún lado", async () => {
    const user = userEvent.setup();
    asignarDesdeSateliteMock.mockResolvedValue({
      status: "ok",
      resultados: [{ ordenId: ID_ASIGNABLE, estado: "por_recoger" }],
    });
    renderModal([makeOrden({ id: ID_ASIGNABLE, numRemision: "NA-900" })]);

    await elegirMensajero(user);
    await asignar(user);

    await vi.waitFor(() => expect(successMock).toHaveBeenCalledTimes(1));
    const toastMsg = successMock.mock.calls[0]![0] as string;
    expect(toastMsg).toBe("Mensajero asignado a 1 orden(es).");
    expect(toastMsg).not.toContain("porque se autorizó hacerlo");
  });
});
