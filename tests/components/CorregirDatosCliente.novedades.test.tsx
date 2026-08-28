// @vitest-environment jsdom
// =================================================================================================
// FICHA 312 (F3 — R23/R26/R29) — LA SEGUNDA SUPERFICIE: LAS CARDS DE `/novedades`.
// =================================================================================================
//
// **Por que este archivo existe aparte de `CorregirDatosCliente.ordenes.test.tsx`.** Aquel mide la
// ventana y el disparador de fila del modulo de ordenes (`maestro`/`admin`); este mide que la MISMA
// operacion esta al alcance del `adminTienda` **en los DOS grupos de su pantalla** —la devolucion
// anclada y la ayuda de la tienda— y que al guardar, la lista se relee del SERVIDOR.
//
// **R23 se prueba en los dos grupos y no en uno**, y no es ceremonia: hasta el 2026-08-27 el spec
// solo abria la correccion al grupo de devolucion, y P2 (2026-08-28) la abrio a los dos con este
// motivo del humano —en `ayuda_tienda` la tienda ya reprograma, rechaza y escribe en el hilo, asi
// que negarle ahi arreglar un nombre era una asimetria sin motivo—. Un caso sobre un solo grupo
// dejaria pasar justo la mitad que la decision anadio.
//
// ⚠️ Las Server Actions van MOCKEADAS (modulos `"use server"`: importarlos de verdad arrastraria
// Prisma a jsdom). El mock declara TODAS las que el modulo importa: vitest lanza al resolver el
// import, asi que una que faltara no dejaria un caso rojo — dejaria cero casos.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { NovedadesModule } from "@/app/(app)/novedades/_components/NovedadesModule";
import { CORREGIR_TITULO } from "@/app/(app)/ordenes/_components/CorregirDatosClienteModal";
import { listarAyudaTiendaAction, listarNovedadesAction } from "@/lib/actions/novedades";
import { corregirDatosCliente } from "@/lib/actions/corregir-datos-cliente";
import type { NovedadDTO } from "@/lib/types/novedad";

vi.mock("@/lib/actions/novedades", () => ({
  listarNovedadesAction: vi.fn(),
  listarNovedadesCompletoAction: vi.fn(),
  listarAyudaTiendaAction: vi.fn(),
  listarAyudaTiendaCompletoAction: vi.fn(),
}));
vi.mock("@/lib/actions/resolver-novedad", () => ({
  reprogramarNovedad: vi.fn(),
  rechazarNovedad: vi.fn(),
}));
vi.mock("@/lib/actions/habilitar-novedad", () => ({ habilitarNovedad: vi.fn() }));
vi.mock("@/lib/actions/orden-ayuda", () => ({
  solicitarAyudaOrden: vi.fn(),
  recuperarOrdenAyuda: vi.fn(),
  registrarIntentoContactoOrden: vi.fn(),
}));
vi.mock("@/lib/actions/gestion-desde-ayuda", () => ({ gestionarDesdeAyuda: vi.fn() }));
// La de ESTA ficha.
vi.mock("@/lib/actions/corregir-datos-cliente", () => ({ corregirDatosCliente: vi.fn() }));

vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

const corregirMock = vi.mocked(corregirDatosCliente);
const listarNovedadesMock = vi.mocked(listarNovedadesAction);
const listarAyudaMock = vi.mocked(listarAyudaTiendaAction);

const DESTINATARIO = "Ana Cliente";
/**
 * UUID REAL y no un `"o1"` de juguete: la ventana valida en cliente con EL MISMO schema del borde,
 * y ese schema pide `z.uuid()` para el `ordenId`. Con un id inventado el formulario se queda en su
 * propio error de validacion y NUNCA llega a la Server Action — un fixture perezoso convertiria
 * estos casos en «no se llamo a nada», que es como pasan verdes los tests que no miden.
 */
const ORDEN_ID = "0f1e2d3c-4b5a-4c7d-8e9f-0a1b2c3d4e5f";
const CORREGIR_BOTON = `Corregir los datos del cliente de la orden de ${DESTINATARIO}`;

const novedad = (over: Partial<NovedadDTO> = {}): NovedadDTO => ({
  id: ORDEN_ID,
  numGuia: 12345,
  numRemision: "REM-90210",
  estatusValue: "devuelta",
  intentosContacto: 0,
  mensajeroNombre: "Marta Mensajera",
  destinatario: DESTINATARIO,
  telefonoDest: "88887777",
  causa: "not_found",
  producto: "Zapatos deportivos",
  peso: 1.5,
  direccion: "Av. Central 120, portón verde",
  montoCobrar: 24500,
  latitud: 9.9281,
  longitud: -84.0907,
  notas: "Llamar antes de llegar",
  tiendaNombre: "Tienda Demo",
  zonaNombre: "GAM Oeste",
  provinciaNombre: "San José",
  cantonNombre: "Escazú",
  distritoNombre: "San Rafael",
  secuenciaRuta: null,
  ...over,
});

function montar(grupo: "devolucion" | "ayuda", over: Partial<NovedadDTO> = {}) {
  return render(
    <NovedadesModule
      grupo={grupo}
      items={[novedad(over)]}
      total={1}
      page={1}
      pageSize={10}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  corregirMock.mockResolvedValue({ status: "ok", cambios: ["destinatario"] });
});
afterEach(cleanup);

// =================================================================================================
// R23 — LA ACCION ESTA EN LOS DOS GRUPOS
// =================================================================================================

describe("312/R23 — «Corregir datos» se ofrece en las dos pestañas de `/novedades`", () => {
  it("en una card del grupo DEVOLUCIÓN", () => {
    montar("devolucion", { estatusValue: "devuelta" });
    expect(screen.getByRole("button", { name: CORREGIR_BOTON })).toBeInTheDocument();
  });

  it("y TAMBIÉN en una card del grupo AYUDA (P2, 2026-08-28)", () => {
    // La mitad que la decisión del humano añadió. Si alguien quitara la celda de `ayuda` de
    // `ACCIONES_POR_GRUPO`, el caso de arriba seguiría verde y esta pantalla perdería la mitad de
    // su alcance sin que nada lo dijera.
    montar("ayuda", { estatusValue: "ayuda_tienda" });
    expect(screen.getByRole("button", { name: CORREGIR_BOTON })).toBeInTheDocument();
  });

  it("el botón es icono + nombre accesible en el propio control", () => {
    // El tooltip NO es el nombre: aparece al pasar el puntero o al enfocar, y quien navega con
    // lector de pantalla —o desde un móvil, donde no hay hover— necesita el nombre EN el control.
    montar("devolucion");
    const boton = screen.getByRole("button", { name: CORREGIR_BOTON });
    expect(boton.textContent).toBe("");
    expect(boton.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
});

// =================================================================================================
// R26 — LA VENTANA ES LA MISMA, Y ABRE SOBRE LA ORDEN DE ESA CARD
// =================================================================================================

describe("312/R26 — la ventana abre precargada con los datos de esa orden", () => {
  it.each(["devolucion", "ayuda"] as const)(
    "desde el grupo %s, con los cuatro valores dentro",
    async (grupo) => {
      const user = userEvent.setup();
      montar(grupo, { estatusValue: grupo === "ayuda" ? "ayuda_tienda" : "devuelta" });

      expect(screen.queryByText(CORREGIR_TITULO)).toBeNull();
      await user.click(screen.getByRole("button", { name: CORREGIR_BOTON }));

      expect(await screen.findByText(CORREGIR_TITULO)).toBeInTheDocument();
      expect((screen.getByLabelText(/^Destinatario$/) as HTMLInputElement).value).toBe(
        DESTINATARIO,
      );
      expect((screen.getByLabelText(/Teléfono/) as HTMLInputElement).value).toBe("88887777");
      expect((screen.getByLabelText(/^Producto$/) as HTMLInputElement).value).toBe(
        "Zapatos deportivos",
      );
      expect((screen.getByLabelText(/^Notas$/) as HTMLTextAreaElement).value).toBe(
        "Llamar antes de llegar",
      );
    },
  );
});

// =================================================================================================
// R27 — EL AVISO DE LA ETIQUETA, TAMBIEN AQUI
// =================================================================================================

describe("312/R27 — la etiqueta ya impresa se avisa (o no) según la guía", () => {
  it("con guía, la ventana avisa de que el papel seguirá diciendo lo viejo", async () => {
    const user = userEvent.setup();
    montar("devolucion", { numGuia: 12345 });
    await user.click(screen.getByRole("button", { name: CORREGIR_BOTON }));
    await screen.findByText(CORREGIR_TITULO);

    expect(
      screen.getByText(/la etiqueta pegada al paquete seguirá mostrando los datos anteriores/i),
    ).toBeInTheDocument();
  });

  it("SIN guía NO avisa: no hay papel impreso que pueda quedarse viejo", async () => {
    // El par de la presencia de arriba, y en ESTA superficie: una orden en devolución puede no
    // tener guía (la pantalla ya pinta un placeholder por eso). Si el aviso saliera siempre, este
    // caso lo dice; sin él, «pintarlo siempre» pasaría en verde en las cards.
    const user = userEvent.setup();
    montar("devolucion", { numGuia: null });
    await user.click(screen.getByRole("button", { name: CORREGIR_BOTON }));
    await screen.findByText(CORREGIR_TITULO);

    expect(screen.queryByText(/etiqueta/i)).toBeNull();
  });
});

// =================================================================================================
// R29 — EL EXITO RELEE DEL SERVIDOR
// =================================================================================================

describe("312/R29 — al guardar, la lista se relee del servidor", () => {
  it("dispara la corrección de ESA orden y vuelve a pedir la página", async () => {
    listarNovedadesMock.mockResolvedValue({
      status: "ok",
      items: [novedad({ destinatario: "Ana Mora" })],
      total: 1,
      page: 1,
      pageSize: 10,
    });
    const user = userEvent.setup();
    montar("devolucion");

    await user.click(screen.getByRole("button", { name: CORREGIR_BOTON }));
    await screen.findByText(CORREGIR_TITULO);
    const destinatario = screen.getByLabelText(/^Destinatario$/);
    await user.clear(destinatario);
    await user.type(destinatario, "Ana Mora");
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => expect(corregirMock).toHaveBeenCalledTimes(1));
    expect(corregirMock.mock.calls[0][0]).toMatchObject({
      ordenId: ORDEN_ID,
      destinatario: "Ana Mora",
    });

    // R29 — los valores nuevos salen de la RELECTURA, no de lo tecleado: se vuelve a pedir la
    // misma página al servidor y la ventana se cierra.
    await waitFor(() => expect(listarNovedadesMock).toHaveBeenCalledTimes(1));
    expect(listarNovedadesMock.mock.calls[0][0]).toMatchObject({ page: 1 });
    await waitFor(() => expect(screen.queryByText(CORREGIR_TITULO)).toBeNull());
    // Y la fila NO desaparece: corregir un nombre no cambia el estado, así que la orden sigue en
    // su grupo. Quitarla sería afirmar una transición que no ocurrió.
    expect(screen.getByRole("button", { name: /Corregir los datos del cliente/ })).toBeInTheDocument();
  });

  it("desde la pestaña de AYUDA relee SU propia lectura, no la de la devolución", async () => {
    // Cada pestaña tiene su Server Action de lectura (`RECURSOS_POR_GRUPO`). Si la relectura fuera
    // siempre la de la devolución, la tienda vería su lista de ayuda sustituida por la otra.
    listarAyudaMock.mockResolvedValue({
      status: "ok",
      items: [novedad({ estatusValue: "ayuda_tienda" })],
      total: 1,
      page: 1,
      pageSize: 10,
    });
    const user = userEvent.setup();
    montar("ayuda", { estatusValue: "ayuda_tienda" });

    await user.click(screen.getByRole("button", { name: CORREGIR_BOTON }));
    await screen.findByText(CORREGIR_TITULO);
    const producto = screen.getByLabelText(/^Producto$/);
    await user.clear(producto);
    await user.type(producto, "Zapatos azules");
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => expect(listarAyudaMock).toHaveBeenCalledTimes(1));
    expect(listarNovedadesMock).not.toHaveBeenCalled();
  });

  it("un rechazo NO relee nada y deja la ventana abierta con lo tecleado (R30)", async () => {
    corregirMock.mockResolvedValue({ status: "forbidden" });
    const user = userEvent.setup();
    montar("devolucion");

    await user.click(screen.getByRole("button", { name: CORREGIR_BOTON }));
    await screen.findByText(CORREGIR_TITULO);
    const destinatario = screen.getByLabelText(/^Destinatario$/);
    await user.clear(destinatario);
    await user.type(destinatario, "Ana Mora");
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/actualiza la lista/i);
    expect((destinatario as HTMLInputElement).value).toBe("Ana Mora");
    expect(listarNovedadesMock).not.toHaveBeenCalled();
  });
});
