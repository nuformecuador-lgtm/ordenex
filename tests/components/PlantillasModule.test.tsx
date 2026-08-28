// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  within,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import type { ReactElement } from "react";

import { ToastProvider } from "@/providers/ToastProvider";
import type { PlantillaListItemDTO } from "@/lib/types/plantilla-mensaje";

// Feature 107 — módulo cliente de plantillas. Se mockean las Server Actions; SWR y
// el Modal/Toast reales para ejercitar la composición sin DB ni sesión.
const listarPlantillasMock = vi.fn();
const eliminarPlantillaMock = vi.fn();
const cambiarEstadoPlantillaMock = vi.fn();
const crearPlantillaMock = vi.fn();
const actualizarPlantillaMock = vi.fn();
const previewPlantillaMock = vi.fn();
const marcarPlantillaBienvenidaMock = vi.fn();
vi.mock("@/lib/actions/plantillas", () => ({
  listarPlantillas: (...a: unknown[]) => listarPlantillasMock(...a),
  eliminarPlantilla: (...a: unknown[]) => eliminarPlantillaMock(...a),
  cambiarEstadoPlantilla: (...a: unknown[]) => cambiarEstadoPlantillaMock(...a),
  crearPlantilla: (...a: unknown[]) => crearPlantillaMock(...a),
  actualizarPlantilla: (...a: unknown[]) => actualizarPlantillaMock(...a),
  previewPlantilla: (...a: unknown[]) => previewPlantillaMock(...a),
  marcarPlantillaBienvenida: (...a: unknown[]) => marcarPlantillaBienvenidaMock(...a),
}));

import { PlantillasModule } from "@/app/(app)/configuracion/plantillas/_components/PlantillasModule";

const ITEM: PlantillaListItemDTO = {
  id: "p1",
  nombre: "bienvenida",
  cuerpo: "Hola {{usuario}}, tu orden {{cod}}",
  estado: "pending",
  variables: ["usuario", "cod"],
  variablesNombres: {},
  welcomeMessage: false,
  plantillaTienda: false,
  templateId: null,
  createdAt: new Date("2026-01-01T12:00:00Z"),
};

function renderModule(ui: ReactElement) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToastProvider>{ui}</ToastProvider>
    </SWRConfig>,
  );
}

let items: PlantillaListItemDTO[];

beforeEach(() => {
  vi.clearAllMocks();
  items = [ITEM];
  listarPlantillasMock.mockImplementation(
    async ({ page, pageSize }: { page: number; pageSize: number }) => ({
      status: "ok",
      items: page === 1 ? items : [],
      page,
      pageSize,
      total: items.length,
    }),
  );
  eliminarPlantillaMock.mockImplementation(async () => {
    items = []; // R27/R28: soft delete → deja de aparecer en el listado.
    return { status: "ok" };
  });
});

afterEach(() => {
  cleanup();
});

describe("PlantillasModule — eliminar (R27/R28)", () => {
  it("R27: confirmar 'Eliminar' llama a eliminarPlantilla con el id de la fila", async () => {
    const user = userEvent.setup();
    renderModule(
      <PlantillasModule initialData={{ items: [ITEM], total: 1, pageSize: 25 }} />,
    );

    const table = screen.getByRole("table", { name: "Plantillas de mensaje" });
    await within(table).findByText("bienvenida");

    await user.click(within(table).getByRole("button", { name: "Eliminar" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/se eliminará/i)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Eliminar" }));

    await waitFor(() => expect(eliminarPlantillaMock).toHaveBeenCalledWith("p1"));
  });

  it("R28: tras eliminar, revalida y la plantilla desaparece del listado", async () => {
    const user = userEvent.setup();
    renderModule(
      <PlantillasModule initialData={{ items: [ITEM], total: 1, pageSize: 25 }} />,
    );

    const table = screen.getByRole("table", { name: "Plantillas de mensaje" });
    await within(table).findByText("bienvenida");

    await user.click(within(table).getByRole("button", { name: "Eliminar" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Eliminar" }));

    // Éxito → toast + el listado revalidado ya no contiene la fila.
    expect(await screen.findByText("Plantilla eliminada.")).toBeInTheDocument();
    // Las dos condiciones en el MISMO `waitFor`, presencia primero: durante la
    // revalidación hay un instante en que la fila ya no está y el estado vacío
    // todavía no se ha pintado. Anclar solo a la ausencia se satisfacía ahí y el
    // `getByText` síncrono fallaba. Se afirma lo mismo que antes.
    await waitFor(() => {
      expect(screen.getByText("No hay plantillas")).toBeInTheDocument();
      expect(screen.queryByText("bienvenida")).toBeNull();
    });
  });

  it("not_found: informa que la plantilla ya no existe y refresca igualmente", async () => {
    eliminarPlantillaMock.mockImplementation(async () => {
      items = [];
      return { status: "not_found" };
    });
    const user = userEvent.setup();
    renderModule(
      <PlantillasModule initialData={{ items: [ITEM], total: 1, pageSize: 25 }} />,
    );

    const table = screen.getByRole("table", { name: "Plantillas de mensaje" });
    await within(table).findByText("bienvenida");

    await user.click(within(table).getByRole("button", { name: "Eliminar" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Eliminar" }));

    expect(
      (await screen.findAllByText("La plantilla ya no existe.")).length,
    ).toBeGreaterThan(0);
  });
});

// --- MENSAJE DE BIENVENIDA ---
//
// La accion NO tiene modal de confirmacion (no sale hacia Meta y se deshace marcando otra),
// asi que lo que hay que probar es que un solo click la dispara con el id correcto y que la
// fila marcada se distingue de las demas SIN pulsar nada.
describe("PlantillasModule - mensaje de bienvenida", () => {
  // 2026-08-27: solo una plantilla `activo` puede marcarse (el envio de bienvenida sale solo,
  // sin nadie que lo revise). `ITEM` esta en `pending`, asi que estos casos parten de una
  // copia ACTIVA; el `pending` original pasa a ser el testigo del boton deshabilitado.
  const ACTIVA: PlantillaListItemDTO = { ...ITEM, estado: "activo" };
  const OTRA: PlantillaListItemDTO = {
    ...ACTIVA,
    id: "p2",
    nombre: "recogida",
    welcomeMessage: true,
  };

  it("un click en 'Mensaje de bienvenida' marca la fila por id, sin confirmacion", async () => {
    marcarPlantillaBienvenidaMock.mockImplementation(async () => {
      items = [{ ...ACTIVA, welcomeMessage: true }];
      return { status: "ok", plantilla: { id: "p1" } };
    });
    items = [ACTIVA]; // el listado se revalida contra esto, no contra `initialData`
    const user = userEvent.setup();
    renderModule(<PlantillasModule initialData={{ items: [ACTIVA], total: 1, pageSize: 25 }} />);

    const table = screen.getByRole("table", { name: "Plantillas de mensaje" });
    await within(table).findByText("bienvenida");

    await user.click(within(table).getByRole("button", { name: /mensaje de bienvenida/i }));

    // Sin dialogo de por medio: la llamada sale del propio click.
    await waitFor(() => expect(marcarPlantillaBienvenidaMock).toHaveBeenCalledWith("p1"));
    expect(
      await screen.findByText('"bienvenida" es ahora el mensaje de bienvenida.'),
    ).toBeInTheDocument();
  });

  it.each([
    ["pending"],
    ["saved_not_aprobation"],
    ["refused"],
    ["inactivo"],
  ] as const)(
    "una plantilla `%s` NO puede marcarse: el boton NI SIQUIERA SE PINTA",
    async (estado) => {
      // ⚠️ 2026-08-27, PEDIDO HUMANO — ESTE CASO CAMBIA DE SENTIDO A PROPOSITO. Hasta hoy
      // afirmaba que el boton seguia VISIBLE y deshabilitado, «porque es donde cuelga el
      // tooltip que explica que falta la aprobacion de Meta». La decision nueva es que un
      // control que no se puede pulsar estorba mas de lo que informa. No es una asercion
      // ajustada para que pase: es el producto que cambio.
      //
      // El guardia de verdad sigue estando en el service; esto solo comprueba que la UI no
      // ofrece lo que el servidor va a rechazar.
      const fila = { ...ITEM, estado };
      items = [fila];
      renderModule(<PlantillasModule initialData={{ items: [fila], total: 1, pageSize: 25 }} />);

      const table = screen.getByRole("table", { name: "Plantillas de mensaje" });
      await within(table).findByText("bienvenida");

      expect(
        within(table).queryByRole("button", { name: /mensaje de bienvenida/i }),
      ).toBeNull();
      expect(marcarPlantillaBienvenidaMock).not.toHaveBeenCalled();
    },
  );

  // Una plantilla PARA ENVIO DE LA TIENDA esta `activo` desde que nace, asi que es la unica
  // que llegaria al boton por la puerta del estado. La bienvenida sale por Meta y ella no vive
  // alli: tampoco lo pinta.
  it("una plantilla para envio de la tienda tampoco pinta el boton, aunque este `activo`", async () => {
    const deTienda = { ...ITEM, estado: "activo" as const, plantillaTienda: true };
    items = [deTienda];
    renderModule(
      <PlantillasModule initialData={{ items: [deTienda], total: 1, pageSize: 25 }} />,
    );

    const table = screen.getByRole("table", { name: "Plantillas de mensaje" });
    await within(table).findByText("bienvenida");

    expect(
      within(table).queryByRole("button", { name: /mensaje de bienvenida/i }),
    ).toBeNull();
  });

  it("estado_invalido (la fila cambio bajo los pies): avisa y revalida", async () => {
    // Se llega aqui cuando el listado en pantalla esta viejo: el boton se pinto habilitado
    // porque la fila era `activo` en la ultima carga, y ya no lo es.
    marcarPlantillaBienvenidaMock.mockResolvedValue({
      status: "estado_invalido",
      estado: "pending",
    });
    items = [ACTIVA];
    const user = userEvent.setup();
    renderModule(<PlantillasModule initialData={{ items: [ACTIVA], total: 1, pageSize: 25 }} />);

    const table = screen.getByRole("table", { name: "Plantillas de mensaje" });
    await within(table).findByText("bienvenida");
    await user.click(within(table).getByRole("button", { name: /mensaje de bienvenida/i }));

    expect(
      (await screen.findAllByText("Solo una plantilla activa puede ser el mensaje de bienvenida."))
        .length,
    ).toBeGreaterThan(0);
  });

  it("resalta la fila marcada: insignia propia y su boton deshabilitado", async () => {
    items = [ACTIVA, OTRA];
    renderModule(
      <PlantillasModule initialData={{ items: [ACTIVA, OTRA], total: 2, pageSize: 25 }} />,
    );

    const table = screen.getByRole("table", { name: "Plantillas de mensaje" });
    await within(table).findByText("recogida");

    // La insignia aparece UNA sola vez: es la marca de la unica fila con `welcomeMessage`.
    const insignias = within(table).getAllByText("Bienvenida");
    expect(insignias).toHaveLength(1);

    const filas = within(table).getAllByRole("row").slice(1); // sin la cabecera
    const marcada = filas.find((f) => within(f).queryByText("recogida") !== null)!;
    const sinMarcar = filas.find((f) => within(f).queryByText("bienvenida") !== null)!;

    // La marcada no ofrece volver a marcarse; la otra si.
    expect(within(marcada).getByRole("button", { name: /mensaje de bienvenida/i })).toBeDisabled();
    expect(
      within(sinMarcar).getByRole("button", { name: /mensaje de bienvenida/i }),
    ).toBeEnabled();
  });

  it("desactivar LA bienvenida avisa, ANTES de confirmar, de que se pierde la marca", async () => {
    // La perdida es real y silenciosa: la desactivacion retira la marca y nadie designa una
    // sustituta. Si el modal no lo dice aqui, el sitio donde se nota es el cliente que no
    // recibe nada al recoger su paquete —y para entonces no hay pantalla donde avisar—.
    const marcada = { ...ACTIVA, welcomeMessage: true };
    items = [marcada];
    const user = userEvent.setup();
    renderModule(<PlantillasModule initialData={{ items: [marcada], total: 1, pageSize: 25 }} />);

    const table = screen.getByRole("table", { name: "Plantillas de mensaje" });
    await within(table).findByText("bienvenida");
    await user.click(within(table).getByRole("button", { name: /^desactivar$/i }));

    const dialogo = await screen.findByRole("dialog");
    expect(within(dialogo).getByText(/dejará de ser el mensaje de bienvenida/i)).toBeInTheDocument();
    // Y la consecuencia, no solo el hecho: que no se enviara nada hasta elegir otra.
    expect(within(dialogo).getByText(/no se enviará nada al recoger el paquete/i)).toBeInTheDocument();
  });

  it("desactivar una plantilla cualquiera NO menciona la bienvenida", async () => {
    items = [ACTIVA];
    const user = userEvent.setup();
    renderModule(<PlantillasModule initialData={{ items: [ACTIVA], total: 1, pageSize: 25 }} />);

    const table = screen.getByRole("table", { name: "Plantillas de mensaje" });
    await within(table).findByText("bienvenida");
    await user.click(within(table).getByRole("button", { name: /^desactivar$/i }));

    const dialogo = await screen.findByRole("dialog");
    expect(within(dialogo).queryByText(/mensaje de bienvenida/i)).toBeNull();
  });

  it("not_found: avisa y revalida en vez de dejar la fila marcada en pantalla", async () => {
    marcarPlantillaBienvenidaMock.mockResolvedValue({ status: "not_found" });
    items = [ACTIVA];
    const user = userEvent.setup();
    renderModule(<PlantillasModule initialData={{ items: [ACTIVA], total: 1, pageSize: 25 }} />);

    const table = screen.getByRole("table", { name: "Plantillas de mensaje" });
    await within(table).findByText("bienvenida");
    await user.click(within(table).getByRole("button", { name: /mensaje de bienvenida/i }));

    // `findAllByText`: el toast pinta el mensaje en su titulo y en su cuerpo.
    expect((await screen.findAllByText("La plantilla ya no existe.")).length).toBeGreaterThan(0);
    expect(within(table).queryByText("Bienvenida")).toBeNull();
  });
});
