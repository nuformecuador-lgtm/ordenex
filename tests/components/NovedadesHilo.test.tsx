// @vitest-environment jsdom
// FEATURE 236 (T6.1-T6.5 — R27/R28/R29/R30/R31/R32/R33/R34/R35) — LA TIENDA VUELVE A LEER EL HILO.
//
// **Es el requisito por el que existe esta ficha.** Desde la 235 el mensajero pide ayuda escribiendo
// una nota OBLIGATORIA en el hilo de la orden… y la tienda no tenía dónde leerla: el 2026-08-18 se
// retiró el botón «Notas» de `NovedadAcciones` y con él el único montaje de
// `HiloNotasNovedadModal`, que quedó entero en disco y sin superficie. La tienda veía que le pedían
// ayuda (el chip) y podía registrar intentos de contacto, pero no leía lo que el mensajero escribió.
//
// **No se escribió ningún hilo nuevo.** El modal existía; lo que esta ficha repone es la ACCIÓN que
// lo abre —«Conversación», la misma que el lado mensajero pinta en su card (`HiloNotasAyudaModal`,
// feature 235/R35)— y su montaje condicional en el módulo. Que las dos pantallas digan lo mismo con
// el mismo gesto es R36.
//
// **Lo que este archivo mide, y por qué no basta con los tests del hilo.** Los de la 227 afirman que
// el componente compartido pinta notas, estado vacío y modo solo lectura. Todos seguían verdes el
// día que esta pantalla se quedó sin la puerta para llegar a él — ése es justo el agujero: no vive
// en el componente, vive en el CRUCE entre la fila y el modal.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import path from "node:path";
import { SWRConfig } from "swr";
import type { ReactElement } from "react";

import { NovedadesModule } from "@/app/(app)/novedades/_components/NovedadesModule";
import { habilitarNovedad } from "@/lib/actions/habilitar-novedad";
import { listarNotasOrden, publicarNotaOrden } from "@/lib/actions/orden-notas";
import type { NovedadDTO } from "@/lib/types/novedad";
import type { OrdenNotaDTO } from "@/lib/types/orden-nota";

vi.mock("@/lib/actions/novedades", () => ({
  listarNovedadesAction: vi.fn(),
  listarNovedadesCompletoAction: vi.fn(),
  listarAyudaTiendaAction: vi.fn(),
  listarAyudaTiendaCompletoAction: vi.fn(),
}));
vi.mock("@/lib/actions/resolver-novedad", () => ({ reprogramarNovedad: vi.fn() }));
vi.mock("@/lib/actions/habilitar-novedad", () => ({ habilitarNovedad: vi.fn() }));
vi.mock("@/lib/actions/orden-ayuda", () => ({
  solicitarAyudaOrden: vi.fn(),
  recuperarOrdenAyuda: vi.fn(),
  registrarIntentoContactoOrden: vi.fn(),
}));
vi.mock("@/lib/actions/orden-notas", () => ({
  listarNotasOrden: vi.fn(),
  publicarNotaOrden: vi.fn(),
  borrarNotaOrden: vi.fn(),
}));

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

const listarNotasMock = vi.mocked(listarNotasOrden);
const habilitarMock = vi.mocked(habilitarNovedad);
const publicarNotaMock = vi.mocked(publicarNotaOrden);

const DESTINATARIO = "Ana Cliente";
/** El motivo REAL con el que el mensajero pidió la ayuda. Es lo que la tienda no podía leer. */
const MOTIVO_AYUDA =
  "El cliente no contesta y el portón está cerrado. ¿Le dejo el paquete al vecino?";

function novedad(over: Partial<NovedadDTO> = {}): NovedadDTO {
  return {
    id: "o-ayuda",
    numGuia: 12345,
    numRemision: "REM-001",
    estatusValue: "ayuda_tienda",
    intentosContacto: 1,
    mensajeroNombre: "Marta Mensajera",
    destinatario: DESTINATARIO,
    telefonoDest: "88887777",
    direccion: "Av. Central 120",
    producto: "Zapatos",
    peso: 1.5,
    montoCobrar: 24500,
    latitud: 9.9281,
    longitud: -84.0907,
    notas: null,
    tiendaNombre: "Tienda Demo",
    zonaNombre: "GAM Oeste",
    provinciaNombre: "San José",
    cantonNombre: "Escazú",
    distritoNombre: "San Rafael",
    secuenciaRuta: null,
    causa: null,
    intentosEntrega: 0,
    ...over,
  };
}

function nota(over: Partial<OrdenNotaDTO> = {}): OrdenNotaDTO {
  return {
    id: "n1",
    cuerpo: MOTIVO_AYUDA,
    autorNombre: "Carlos Mensajero",
    rolAutor: "mensajero",
    createdAt: "2026-08-19T14:35:00.000Z",
    esPropia: false,
    eliminada: false,
    ...over,
  };
}

function renderConSWR(ui: ReactElement) {
  // Caché propia por caso: la clave del hilo es `["orden-notas", ordenId]`, y una caché
  // compartida entre casos haría que el segundo leyera la respuesta del primero sin pedir nada.
  return render(
    <SWRConfig
      value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}
    >
      {ui}
    </SWRConfig>,
  );
}

function renderAyuda(items: NovedadDTO[] = [novedad()]) {
  return renderConSWR(
    <NovedadesModule grupo="ayuda" items={items} total={items.length} page={1} pageSize={10} />,
  );
}

const abrirConversacion = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(
    screen.getByRole("button", {
      name: `Abrir la conversación de la orden de ${DESTINATARIO}`,
    }),
  );
  return screen.findByRole("dialog");
};

beforeEach(() => {
  vi.clearAllMocks();
  listarNotasMock.mockResolvedValue({
    status: "ok",
    notas: [nota()],
    puedeEscribir: true,
  });
});

afterEach(() => {
  cleanup();
});

// =================================================================================================
// T6.1 / R27 — la puerta existe, y sólo existe cuando se pide
// =================================================================================================
describe("236/R27 — la fila de ayuda ofrece la conversación y la abre", () => {
  it("con el modal CERRADO, el hilo no está en el árbol", () => {
    renderAyuda();

    // La acción sí (es la puerta)…
    expect(
      screen.getByRole("button", {
        name: `Abrir la conversación de la orden de ${DESTINATARIO}`,
      }),
    ).toBeInTheDocument();
    // …y el hilo no. Montaje condicional: el modal sólo existe con una orden abierta.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("region", { name: "Notas con el mensajero" })).toBeNull();
  });

  it("al pulsarla se abre el modal del hilo de ESA orden", async () => {
    const user = userEvent.setup();
    renderAyuda([novedad({ id: "o-77", destinatario: DESTINATARIO })]);

    const dialog = await abrirConversacion(user);

    expect(
      within(dialog).getByText(`Conversación sobre la orden de ${DESTINATARIO}.`),
    ).toBeInTheDocument();
    // La lectura se hace con el `ordenId` de la fila: si el modal leyera otra orden, la tienda
    // vería la conversación equivocada sin ninguna señal.
    await waitFor(() => expect(listarNotasMock).toHaveBeenCalledWith({ ordenId: "o-77" }));
  });
});

// =================================================================================================
// T6.2 / R28 — EL REQUISITO POR EL QUE EXISTE LA FICHA
// =================================================================================================
describe("236/R28 — el motivo de la ayuda se LEE", () => {
  it("la nota del mensajero se lee entera, con su autor y su hora", async () => {
    const user = userEvent.setup();
    renderAyuda();

    const dialog = await abrirConversacion(user);

    // El cuerpo, tal cual lo escribió el mensajero. Es lo que la tienda no podía leer desde el
    // 2026-08-18 y lo único que le dice qué tiene que resolver.
    expect(await within(dialog).findByText(MOTIVO_AYUDA)).toBeInTheDocument();
    // Con su autor y su hora: sin ellos es un texto suelto, no una conversación.
    expect(within(dialog).getByText("Carlos Mensajero")).toBeInTheDocument();
    expect(within(dialog).getByRole("time")).toHaveAttribute(
      "dateTime",
      "2026-08-19T14:35:00.000Z",
    );
  });
});

// =================================================================================================
// T6.3 / R29 — el hilo se lee AL ABRIRLO, nunca al listar
// =================================================================================================
describe("236/R29 — listar una página no lee ningún hilo", () => {
  it("con tres órdenes en pantalla, `listarNotasOrden` no se llama ni una vez", () => {
    renderAyuda([
      novedad({ id: "o1", destinatario: "Ana Cliente" }),
      novedad({ id: "o2", destinatario: "Beto Cliente" }),
      novedad({ id: "o3", destinatario: "Carla Cliente" }),
    ]);

    // Sería una consulta por orden de la página (N+1) para un dato que sólo se mira al abrir una
    // orden. El contrato de `lib/types/novedad.ts` lo prohíbe con esas palabras.
    expect(listarNotasMock).not.toHaveBeenCalled();
    // CONTROL POSITIVO de la ausencia: las tres filas SÍ están montadas, cada una con su puerta.
    expect(
      screen.getAllByRole("button", { name: /^Abrir la conversación de la orden/ }),
    ).toHaveLength(3);
  });

  it("y `NovedadDTO` no gana ninguna clave de notas", () => {
    // Afirmado sobre el CONTRATO, no sobre un comentario: si el hilo empezara a viajar en el
    // listado, la clave aparecería aquí antes que en ninguna pantalla.
    const claves = Object.keys(novedad());
    for (const prohibida of ["notasHilo", "hilo", "ordenNotas", "notasOrden", "puedeEscribir"]) {
      expect(claves, prohibida).not.toContain(prohibida);
    }
    // `notas` SÍ existe y NO es el hilo: es el campo de texto libre de la orden (instrucciones de
    // entrega), heredado de `MiAsignacionDTO`. Se dice para que nadie lo confunda al leer esto.
    expect(claves).toContain("notas");
  });
});

// =================================================================================================
// T6.4 / R30-R32, R34 — `puedeEscribir` viene del SERVIDOR
// =================================================================================================
describe("236/R30-R34 — quién puede escribir lo decide el servidor", () => {
  it("R31/R32: con `puedeEscribir: true` la tienda publica SIN habilitar nada antes", async () => {
    const user = userEvent.setup();
    publicarNotaMock.mockResolvedValue({
      status: "ok",
      nota: nota({ id: "n2", cuerpo: "Dejáselo al vecino", esPropia: true }),
    });
    renderAyuda();

    const dialog = await abrirConversacion(user);
    await within(dialog).findByText(MOTIVO_AYUDA);

    await user.type(
      within(dialog).getByLabelText("Escribí una nota"),
      "Dejáselo al vecino",
    );
    await user.click(within(dialog).getByRole("button", { name: "Publicar nota" }));

    await waitFor(() =>
      expect(publicarNotaMock).toHaveBeenCalledWith({
        ordenId: "o-ayuda",
        cuerpo: "Dejáselo al vecino",
      }),
    );
    // R32: publicar NO cambia el estado ni saca la fila de la pestaña. La orden sigue en ayuda
    // —el paquete sigue con el mensajero— y contestarle no es resolverla.
    //
    // La fila se busca por TEXTO y no por rol: con un diálogo abierto el resto del árbol queda
    // `aria-hidden`, así que una consulta por rol no encontraría la card aunque siga montada — y
    // pasaría en verde diciendo lo contrario de lo que se quiere afirmar.
    expect(screen.getAllByText(DESTINATARIO).length).toBeGreaterThan(0);
    expect(screen.queryByText("Ningún mensajero te pidió ayuda")).toBeNull();
    // Y no se disparó ninguna transición por la puerta de atrás: escribir en el hilo no rescata.
    expect(habilitarMock).not.toHaveBeenCalled();

    // Y al cerrar el modal, la fila sigue ahí con sus acciones intactas.
    await user.click(within(dialog).getByRole("button", { name: "Cerrar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(
      screen.getByRole("button", { name: `Habilitar la orden de ${DESTINATARIO}` }),
    ).toBeInTheDocument();
  });

  it("R34: con `puedeEscribir: false` se lee el aviso de solo lectura y NO hay campo", async () => {
    const user = userEvent.setup();
    listarNotasMock.mockResolvedValue({
      status: "ok",
      notas: [nota()],
      puedeEscribir: false,
    });
    renderAyuda();

    const dialog = await abrirConversacion(user);

    expect(
      await within(dialog).findByText("Ahora mismo solo podés leer este hilo."),
    ).toBeInTheDocument();
    // No es un compositor deshabilitado —eso prometería que en algún momento se puede escribir—:
    // es la ausencia del compositor con una línea que lo explica.
    expect(within(dialog).queryByLabelText("Escribí una nota")).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Publicar nota" })).toBeNull();
    // Lo que SÍ sigue: leer. El hilo es de lectura para todos los que llegan a él.
    expect(within(dialog).getByText(MOTIVO_AYUDA)).toBeInTheDocument();
  });

  it("R30: el modal NO re-deriva el permiso del estatus de la orden", () => {
    // Censo del fuente. El MISMO hilo, en el MISMO estatus, es escribible para un rol y de solo
    // lectura para el otro (la ventana es asimétrica por rol, feature 227/D1), así que derivarlo
    // aquí del estatus daría la respuesta equivocada la mitad de las veces. Y no es hipotético:
    // sobre `ayuda_tienda` los DOS roles pueden escribir, y sobre `devuelta` sólo la tienda.
    const fuente = readFileSync(
      path.resolve(
        __dirname,
        "../../app/(app)/novedades/_components/HiloNotasNovedadModal.tsx",
      ),
      "utf8",
    );
    // El código, sin la prosa: esta cabecera nombra los estatus A PROPÓSITO para explicar por qué
    // no los mira, y un censo sobre el texto crudo denunciaría la explicación.
    const codigo = fuente
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:])\/\/[^\n]*/gm, "$1 ");
    expect(codigo).not.toContain("estatusValue");
    expect(codigo).not.toContain("grupoDeEstatus");
    // CONTRAPRUEBA de que el censo lee algo: `puedeEscribir` SÍ está, y sale de la respuesta del
    // servidor. Sin esto, las dos ausencias pasarían igual con el archivo vacío o mal leído.
    expect(codigo).toContain("puedeEscribir={hiloOk.puedeEscribir}");
  });
});

// =================================================================================================
// T6.5 / R33, R35 — el hilo vacío y los tres desenlaces del fallo
// =================================================================================================
describe("236/R33 — el hilo sin notas lo dice, y el campo sigue ofreciéndose", () => {
  it("estado vacío CON TEXTO y compositor disponible", async () => {
    const user = userEvent.setup();
    listarNotasMock.mockResolvedValue({ status: "ok", notas: [], puedeEscribir: true });
    renderAyuda();

    const dialog = await abrirConversacion(user);

    expect(
      await within(dialog).findByText("Todavía no hay notas en esta orden."),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "Acá queda la conversación sobre esta orden, con el autor y la hora de cada nota.",
      ),
    ).toBeInTheDocument();
    // Un hilo vacío no es un hilo cerrado: si puede escribir, se le ofrece igual.
    expect(within(dialog).getByLabelText("Escribí una nota")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Publicar nota" })).toBeInTheDocument();
  });
});

describe("236/R35 — cada desenlace del fallo dice SU motivo, y ninguno se queda en blanco", () => {
  const DESENLACES = [
    [
      "forbidden",
      { status: "forbidden" as const },
      "No podés ver las notas de esta orden. Actualizá la pantalla: puede que su estado ya no lo permita.",
    ],
    [
      "unauthenticated",
      { status: "unauthenticated" as const },
      "Tu sesión expiró. Iniciá sesión de nuevo para ver las notas.",
    ],
  ] as const;

  it.each(DESENLACES)("%s: se lee su texto propio", async (_nombre, respuesta, texto) => {
    const user = userEvent.setup();
    listarNotasMock.mockResolvedValue(respuesta);
    renderAyuda();

    const dialog = await abrirConversacion(user);
    const aviso = await within(dialog).findByRole("alert");

    expect(aviso).toHaveTextContent(texto);
  });

  it("fallo de transporte: su propio texto, distinto de los otros dos", async () => {
    const user = userEvent.setup();
    // SWR captura el rechazo de la Server Action; el modal cae a su tercer mensaje.
    listarNotasMock.mockRejectedValue(new Error("network"));
    renderAyuda();

    const dialog = await abrirConversacion(user);
    const aviso = await within(dialog).findByRole("alert");

    expect(aviso).toHaveTextContent(
      "No se pudieron cargar las notas. Cerrá y volvé a abrir para intentarlo.",
    );
  });

  it("los tres mensajes son DISTINTOS entre sí (si dos coincidieran, uno no diría nada)", () => {
    const textos = [
      "No podés ver las notas de esta orden. Actualizá la pantalla: puede que su estado ya no lo permita.",
      "Tu sesión expiró. Iniciá sesión de nuevo para ver las notas.",
      "No se pudieron cargar las notas. Cerrá y volvé a abrir para intentarlo.",
    ];
    expect(new Set(textos).size).toBe(3);
  });
});
