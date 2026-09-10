// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AsignarBodegaModal } from "@/app/(app)/ordenes/_components/AsignarBodegaModal";
import { asignarDesdeBodega } from "@/lib/actions/ordenes-guia";
import { obtenerManifiesto } from "@/lib/actions/manifiesto";
import type { OrdenListItemDTO } from "@/lib/types/orden";
import type { MensajeroLiteDTO } from "@/lib/types/orden-guia";

/**
 * FICHA 407 (T10) — AUTORIZAR LA ASIGNACIÓN DE UNA ORDEN SIN UBICACIÓN, desde bodega central.
 *
 * El caso que originó la ficha: una dirección costarricense de referencias que el mapa no sabe
 * ubicar deja la orden sin coordenadas y el gate de asignabilidad (feature 92, R3) la bloquea,
 * aunque el mensajero llegue sin problema con las indicaciones. Cinco días parada en producción.
 * Lo que esta pantalla añade es poder autorizar esa asignación **a sabiendas**.
 *
 * ⚠️ LOS DOS LITERALES ESTÁN ESCRITOS A MANO EN ESTE ARCHIVO, copiados de design.md §5.1 y §5.2
 * y aprobados por el humano el 2026-09-10. NO se comparan contra la constante que los produce:
 * afirmar un texto contra su propia fuente está siempre verde y en este repo ya dejó pasar un
 * defecto (`asercion-contra-su-propia-fuente`).
 */

vi.mock("@/lib/actions/ordenes-guia", () => ({
  asignarDesdeBodega: vi.fn(),
}));
const asignarDesdeBodegaMock = vi.mocked(asignarDesdeBodega);

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

const MENSAJEROS: MensajeroLiteDTO[] = [
  { id: "m1", nombre: "Ana Mensajera" },
  { id: "m2", nombre: "Beto Mensajero" },
];

// Ids con forma de uuid a propósito: el borde valida `z.array(z.string().uuid())`, así que la
// segunda petición tiene que mandar el id REAL de la orden y no su número de remisión — y R19
// exige que ese id NO aparezca en pantalla. Con ids de juguete («o1») las dos cosas quedarían
// sin medir.
const ID_IRRESOLUBLE = "11111111-1111-4111-8111-111111111111";
const ID_EN_CURSO = "22222222-2222-4222-8222-222222222222";
const ID_ASIGNABLE = "33333333-3333-4333-8333-333333333333";

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

const FECHAS_DIA_REPARTO = { hoy: "2026-08-20", manana: "2026-08-21" };

function renderModal(ordenes: OrdenListItemDTO[], onSuccess = vi.fn()) {
  const onOpenChange = vi.fn();
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
  /** Reabre SIN desmontar, que es como lo usa `OrdenesListado` (montado una sola vez). */
  function reabrir() {
    for (const abierto of [false, true]) {
      rerender(
        <AsignarBodegaModal
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
  // cero filas el botón se detiene antes de construir el xlsx, así que no hace falta simular
  // `URL.createObjectURL` ni el `<a>` de descarga.
  obtenerManifiestoMock.mockResolvedValue({ status: "ok", filas: [], omitidas: [] });
});

afterEach(() => {
  cleanup();
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// R16 — CUÁNDO SE OFRECE AUTORIZAR
// ─────────────────────────────────────────────────────────────────────────────────────────
describe("AsignarBodegaModal — 407/R16: el modal ofrece autorizar en las DOS rutas", () => {
  it("R16-a: `conflict` (nada asignado) pinta el panel Y el toast de error sigue saliendo", async () => {
    const user = userEvent.setup();
    // Es EXACTAMENTE la forma del caso de producción: una sola orden seleccionada, el gate la
    // bloquea, no se asigna nada. Si el panel viviera solo en la fase «resultado», este caso
    // —el que originó la ficha— no lo vería nunca.
    asignarDesdeBodegaMock.mockResolvedValue({
      status: "conflict",
      detalle: [{ ordenId: ID_IRRESOLUBLE, motivo: "direccion_no_geocodificable" }],
    });
    renderModal([makeOrden({ id: ID_IRRESOLUBLE, numRemision: "NA-138" })]);

    await elegirMensajero(user);
    await asignar(user);

    // El comportamiento viejo NO se rompe: el conflict sigue yendo al canal de error del Modal.
    await vi.waitFor(() =>
      expect(errorMock).toHaveBeenCalledWith("Dirección no encontrada"),
    );
    // Y ahora, además, se ofrece autorizar.
    const bloque = await screen.findByRole("region", {
      name: "Autorizar asignación sin ubicación en el mapa",
    });
    expect(within(bloque).getByRole("button", { name: ETIQUETA_AUTORIZAR })).toBeInTheDocument();
    // Nada se asignó, así que el modal sigue en su fase de formulario.
    expect(screen.queryByRole("button", { name: "Cerrar" })).toBeNull();
  });

  it("R16-b: `partial` pinta el panel JUNTO a la lista de bloqueadas, sin pisarla", async () => {
    const user = userEvent.setup();
    asignarDesdeBodegaMock.mockResolvedValue({
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
    // La lista de bloqueadas de la 368 sigue siendo su propio `role="alert"` y sigue diciendo
    // lo suyo: el panel no la sustituye ni se mete dentro.
    const bloqueadas = screen.getByRole("alert");
    expect(bloqueadas.textContent).toContain("Dirección no encontrada");
    expect(bloqueadas.contains(bloque)).toBe(false);
    expect(bloque.contains(bloqueadas)).toBe(false);
  });

  it("R16-c (contraste): `conflict` con una geocodificación EN CURSO no ofrece autorizar nada", async () => {
    const user = userEvent.setup();
    // No es un veredicto definitivo: esa orden todavía puede resolverse sola en un minuto.
    // Ofrecer autorizarla sería empujar al operador a saltarse una espera.
    asignarDesdeBodegaMock.mockResolvedValue({
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
    asignarDesdeBodegaMock.mockResolvedValue({
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
    asignarDesdeBodegaMock.mockResolvedValue({
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
describe("AsignarBodegaModal — 407/R14-R15-R19: lo que el panel dice, y lo que jamás enseña", () => {
  async function abrirPanel() {
    const user = userEvent.setup();
    asignarDesdeBodegaMock.mockResolvedValue({
      status: "conflict",
      detalle: [{ ordenId: ID_IRRESOLUBLE, motivo: "direccion_no_geocodificable" }],
    });
    renderModal([
      makeOrden({
        id: ID_IRRESOLUBLE,
        numRemision: "NA-138",
        destinatario: "ÓSCAR ELIZONDO SOLIS",
        telefonoDest: "88887777",
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

    // Escrito a mano, copiado de design.md §5.1.
    expect(screen.getByText(LITERAL_CONSECUENCIA)).toBeInTheDocument();
    // Y está ANTES: la segunda petición todavía no se ha lanzado.
    expect(asignarDesdeBodegaMock).toHaveBeenCalledTimes(1);
  });

  it("R19: el panel identifica la orden por su número de remisión", async () => {
    await abrirPanel();

    const bloque = panel()!;
    expect(within(bloque).getByText("NA-138")).toBeInTheDocument();
  });

  it("R19/R15: el id interno de la orden NO aparece en el DOM, ni el teléfono del destinatario", async () => {
    await abrirPanel();

    // El uuid viaja al servidor y se queda ahí; en pantalla solo hay número de remisión.
    expect(document.body.textContent).not.toContain(ID_IRRESOLUBLE);
    expect(document.body.textContent).not.toContain("88887777");
  });

  it("R15: el texto de la consecuencia no lleva ni un dígito — no puede arrastrar guía ni teléfono", async () => {
    await abrirPanel();

    const consecuencia = screen.getByText(LITERAL_CONSECUENCIA);
    expect(consecuencia.textContent).not.toMatch(/\d/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// R18 — LA SEGUNDA PETICIÓN: UNA SOLA, CON LA MARCA, Y ACOTADA
// ─────────────────────────────────────────────────────────────────────────────────────────
describe("AsignarBodegaModal — 407/R18: la segunda petición va acotada a las autorizables", () => {
  it("R5: la PRIMERA petición no lleva ninguna marca — nadie autoriza sin pedirlo", async () => {
    const user = userEvent.setup();
    asignarDesdeBodegaMock.mockResolvedValue({
      status: "conflict",
      detalle: [{ ordenId: ID_IRRESOLUBLE, motivo: "direccion_no_geocodificable" }],
    });
    renderModal([makeOrden({ id: ID_IRRESOLUBLE, numRemision: "NA-138" })]);

    await elegirMensajero(user);
    await asignar(user);

    const primera = asignarDesdeBodegaMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(primera).not.toHaveProperty("autorizarSinUbicacionIds");
  });

  it("R18: tras confirmar, se lanza UNA sola petición más, con la marca y el MISMO conjunto", async () => {
    const user = userEvent.setup();
    asignarDesdeBodegaMock
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

    await vi.waitFor(() => expect(asignarDesdeBodegaMock).toHaveBeenCalledTimes(2));
    // Se afirma sobre el ARGUMENTO capturado, no sobre el número de llamadas a secas.
    expect(asignarDesdeBodegaMock.mock.calls[1]![0]).toEqual({
      ordenIds: [ID_IRRESOLUBLE],
      mensajeroId: "m1",
      dia: "hoy",
      autorizarSinUbicacionIds: [ID_IRRESOLUBLE],
    });
  });

  it("R18/R3: en la ruta `partial` la segunda petición NO reenvía el lote entero, solo las autorizables", async () => {
    const user = userEvent.setup();
    // Esto es lo que se rompe fácil: parte del lote YA está asignada. Reenviarla la encontraría
    // en `por_recoger` y el writer abortaría todo con «estado de origen no permitido».
    asignarDesdeBodegaMock
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

    await vi.waitFor(() => expect(asignarDesdeBodegaMock).toHaveBeenCalledTimes(2));
    const segunda = asignarDesdeBodegaMock.mock.calls[1]![0] as {
      ordenIds: string[];
      autorizarSinUbicacionIds: string[];
    };
    // Ni la ya asignada, ni la que sigue en cola: SOLO la autorizable.
    expect(segunda.ordenIds).toEqual([ID_IRRESOLUBLE]);
    expect(segunda.ordenIds).not.toContain(ID_ASIGNABLE);
    expect(segunda.ordenIds).not.toContain(ID_EN_CURSO);
  });

  it("R3 (hostil): la marca NO se contagia a la orden del lote que no es autorizable", async () => {
    const user = userEvent.setup();
    asignarDesdeBodegaMock
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

    // El panel solo enseña la autorizable: la otra no se ofrece ni por error.
    const bloque = await screen.findByRole("region", {
      name: "Autorizar asignación sin ubicación en el mapa",
    });
    expect(within(bloque).getByText("NA-138")).toBeInTheDocument();
    expect(within(bloque).queryByText("NA-200")).toBeNull();

    await user.click(within(bloque).getByRole("button", { name: ETIQUETA_AUTORIZAR }));
    await vi.waitFor(() => expect(asignarDesdeBodegaMock).toHaveBeenCalledTimes(2));
    const segunda = asignarDesdeBodegaMock.mock.calls[1]![0] as {
      autorizarSinUbicacionIds: string[];
    };
    expect(segunda.autorizarSinUbicacionIds).toEqual([ID_IRRESOLUBLE]);
  });

  it("R18: pulsar dos veces seguidas no dispara dos peticiones — el control se bloquea", async () => {
    const user = userEvent.setup();
    let resolver!: (v: { status: "ok"; resultados: { ordenId: string; estado: string }[] }) => void;
    asignarDesdeBodegaMock
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

    expect(asignarDesdeBodegaMock).toHaveBeenCalledTimes(2);
    resolver({ status: "ok", resultados: [{ ordenId: ID_IRRESOLUBLE, estado: "por_recoger" }] });
  });

  it("R9: al reabrir el modal la autorización NO sobrevive — el panel desaparece", async () => {
    const user = userEvent.setup();
    asignarDesdeBodegaMock.mockResolvedValue({
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

    // Nada se persiste, ni en el servidor ni aquí: hay que volver a intentar y volver a autorizar.
    expect(panel()).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// R20 — EL MANIFIESTO ACUMULA LAS DOS PETICIONES
// ─────────────────────────────────────────────────────────────────────────────────────────
describe("AsignarBodegaModal — 407/R20: el manifiesto lleva TODO lo asignado en la apertura", () => {
  it("R20: una asignada en la primera petición y otra en la segunda → el manifiesto pide las DOS", async () => {
    const user = userEvent.setup();
    asignarDesdeBodegaMock
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
    await vi.waitFor(() => expect(asignarDesdeBodegaMock).toHaveBeenCalledTimes(2));

    // Se observa por donde importa: el lote que el botón de descarga le pide al servidor. Si el
    // modal se hubiera quedado con la última respuesta, aquí faltaría la orden de la primera —
    // un fallo mudo, sin ningún test rojo que lo dijera.
    await user.click(await screen.findByRole("button", { name: /descargar manifiesto/i }));
    await vi.waitFor(() => expect(obtenerManifiestoMock).toHaveBeenCalledTimes(1));
    expect(obtenerManifiestoMock).toHaveBeenCalledWith({
      flujo: "generacion_guia",
      ordenIds: [ID_ASIGNABLE, ID_IRRESOLUBLE],
    });
  });

  it("R20: la orden recién autorizada deja de figurar como bloqueada", async () => {
    const user = userEvent.setup();
    asignarDesdeBodegaMock
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
    await vi.waitFor(() => expect(asignarDesdeBodegaMock).toHaveBeenCalledTimes(2));

    const bloqueadas = await screen.findByRole("alert");
    // La que sigue en cola sí; la autorizada, no: ya tiene mensajero.
    expect(bloqueadas.textContent).toContain("NA-200");
    expect(bloqueadas.textContent).not.toContain("NA-138");
    // Y el panel se apaga solo: no queda nada que autorizar.
    expect(panel()).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// R10 / R12 — EL AVISO AGREGADO, Y EL TEXTO QUE AQUÍ SERÍA FALSO
// ─────────────────────────────────────────────────────────────────────────────────────────
describe("AsignarBodegaModal — 407/R10-R12: el aviso de la autorización no es el de la 400", () => {
  it("R10/R12: con `sinUbicacionAutorizada: 2`, el aviso de la 407 y NO el de la 400", async () => {
    const user = userEvent.setup();
    asignarDesdeBodegaMock
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
    // R12: aquí la dirección SÍ es el problema, así que el texto de la 400 sería falso.
    expect(toastMsg).not.toContain("no de la dirección");
    expect(toastMsg).not.toContain("problema del sistema");
    // Y el operador lo ve donde ya mira: el bloque de confirmación del resultado.
    expect(await screen.findByText(new RegExp(LITERAL_AUTORIZADAS_DOS.slice(0, 40)))).toBeInTheDocument();
  });

  it("R11: las dos cifras conviven sin mezclarse — una de la 400 y una de la 407", async () => {
    const user = userEvent.setup();
    asignarDesdeBodegaMock.mockResolvedValue({
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
    // Los DOS avisos, enteros, uno de cada causa. Ninguno sustituye al otro.
    expect(toastMsg).toContain(LITERAL_400_UNA);
    expect(toastMsg).toContain(LITERAL_AUTORIZADAS_UNA);
  });

  it("R10: sin ninguna autorizada, el aviso de la 407 no aparece por ningún lado", async () => {
    const user = userEvent.setup();
    asignarDesdeBodegaMock.mockResolvedValue({
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
