// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import type { ReactElement } from "react";

// FICHA 430 (SF-001, punto 3) — EL MENSAJERO LE ESCRIBE AL CLIENTE ANTES DE RECOGER.
//
// Lo que se fija aqui, sobre la superficie VIVA:
//
//   1. Una orden ASIGNADA y todavia sin recoger tiene conversacion en el chat, desde Reparto y
//      desde «Por recoger». Antes de esta ficha no tenia fila donde abrirse.
//   2. Desde ahi se ve el DETALLE COMPLETO de la orden.
//   3. La de OTRO DIA se distingue de la de hoy: lleva la marca «Para mañana» y, con palabras y
//      con su fecha, lo que el sistema le va a impedir. Es el punto que mas importa: si el
//      mensajero escribe el dia antes, el cliente le va a pedir que se la lleve hoy.
//   4. Y sigue sin parecer trabajable: el chat no ofrece ninguna accion sobre la orden.
//
// ⛔ LO QUE ESTE ARCHIVO NO TOCA, Y ES DELIBERADO: la puerta de recoger/escoger/gestionar. Esa la
// guardan cinco tests de la ficha 261 y una guardia de arbol, y esta ficha no la roza.
//
// Las Server Actions del chat van mockeadas: la UI se ejercita sin DB ni sesion.

const resumenNoLeidosChatMock = vi.fn();
const listarHiloChatMock = vi.fn();
vi.mock("@/lib/actions/chat-whatsapp", () => ({
  resumenNoLeidosChat: (...a: unknown[]) => resumenNoLeidosChatMock(...a),
  marcarChatLeido: vi.fn().mockResolvedValue({ status: "ok" }),
  listarHiloChat: (...a: unknown[]) => listarHiloChatMock(...a),
  enviarMensajeChat: vi.fn(),
  enviarMediaChat: vi.fn(),
  enviarPlantillaChat: vi.fn(),
}));

vi.mock("@/lib/actions/whatsapp-envio", () => ({
  listarPlantillasActivasParaEnvio: vi
    .fn()
    .mockResolvedValue({ status: "ok", items: [] }),
}));

vi.mock("@/lib/audio/tono-notificacion", () => ({
  reproducirTono: vi.fn(),
  prepararAudio: vi.fn(),
  reiniciarAudioParaTests: vi.fn(),
}));

// El minimapa de ubicacion arrastra Leaflet via `next/dynamic`; irrelevante aqui.
vi.mock("@/app/(app)/mis-asignaciones/_components/UbicacionMapa", () => ({
  UbicacionMapa: () => null,
}));

// --- Lo que `RepartoModule` arrastra y no es de esta ficha -----------------------------------
vi.mock("@/lib/actions/mis-asignaciones", () => ({
  recogerAsignaciones: vi.fn(),
  escogerParaGestion: vi.fn(),
  gestionar: vi.fn(),
  liberarGestion: vi.fn(),
}));

vi.mock("@/lib/actions/orden-notas", () => ({
  listarNotasOrden: vi
    .fn()
    .mockResolvedValue({ status: "ok", notas: [], puedeEscribir: false }),
  publicarNotaOrden: vi.fn(),
  borrarNotaOrden: vi.fn(),
}));

vi.mock("@/lib/actions/ruta-mensajero", () => ({
  sincronizarRuta: vi.fn().mockResolvedValue({ status: "ok", omitida: false }),
}));

vi.mock("@/lib/actions/orden-mensajero-meta", () => ({
  marcarGestionarLuego: vi.fn().mockResolvedValue({ status: "ok" }),
}));

// Leaflet no pinta en jsdom.
vi.mock("@/app/(app)/mis-asignaciones/_components/RutaMapa", () => ({
  RutaMapa: () => <div data-testid="ruta-mapa" />,
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

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { ChatDelMensajero } from "@/app/(app)/mis-asignaciones/_components/chat/ChatDelMensajero";
import { RepartoModule } from "@/app/(app)/mis-asignaciones/_components/RepartoModule";
import type {
  MiAsignacionDTO,
  RutaResumenDTO,
} from "@/lib/interfaces/services/IMisAsignacionesService";
import { SIN_BLOQUEO } from "@/lib/utils/bloqueo-cierre";
import { ToastProvider } from "@/providers/ToastProvider";

function orden(
  id: string,
  estatusValue: string,
  extra: Partial<MiAsignacionDTO> = {},
): MiAsignacionDTO {
  return {
    id,
    numGuia: 90000,
    numRemision: `R-${id}`,
    estatusValue,
    destinatario: `Cliente ${id}`,
    telefonoDest: "88887777",
    direccion: "Calle 1",
    producto: "Caja",
    peso: 1,
    montoCobrar: 5000,
    latitud: null,
    longitud: null,
    notas: null,
    tiendaNombre: "Tienda",
    zonaNombre: "Zona",
    provinciaNombre: "San José",
    cantonNombre: "Central",
    distritoNombre: "Carmen",
    sinpeNumero: "80000000",
    sinpeNombre: "Titular de Prueba",
    secuenciaRuta: null,
    ...extra,
  };
}

/** La que ya lleva encima. */
const EN_REPARTO = orden("a", "en_reparto", {
  destinatario: "Ana Ya Recogida",
  secuenciaRuta: 1,
});

/** Asignada, sin recoger, para HOY. */
const POR_RECOGER_HOY = orden("c", "mensajero_recogiendo_en_bodega", {
  numGuia: 17001,
  destinatario: "Carlos Sin Recoger",
  direccion: "Avenida Escazú 100, casa azul",
  producto: "Licuadora",
});

/** Asignada, sin recoger, RESERVADA para el día siguiente. */
const POR_RECOGER_MANANA = orden("d", "mensajero_recogiendo_en_bodega", {
  numGuia: 17002,
  destinatario: "Diana Para Mañana",
  esParaManana: true,
  fechaRepartoISO: "2026-09-16",
});

const RUTA_VIGENTE: RutaResumenDTO = {
  estado: "vigente",
  calculadaAt: null,
  origenFuente: "gps",
  secuenciaFuente: null,
  paradasSinOptimizar: 0,
  trazado: null,
  tramoSiguiente: null,
};

// jsdom no implementa `Element.scrollTo` y la conversación ancla el hilo abajo al montar.
if (typeof Element.prototype.scrollTo !== "function") {
  Element.prototype.scrollTo = function scrollToStub() {};
}

function renderConSwr(ui: ReactElement) {
  return render(
    <SWRConfig
      value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}
    >
      <ToastProvider>{ui}</ToastProvider>
    </SWRConfig>,
  );
}

/**
 * El modal del chat, ya abierto. Todas las aserciones se acotan DENTRO de él.
 *
 * El nombre se casa por prefijo porque con pendientes sin leer el boton anuncia tambien la cifra
 * («Abrir chat con clientes, 2 sin leer»). Que la cifra este EN ese nombre lo fija
 * `ChatNoLeidos.test.tsx`; aqui solo hace falta entrar.
 */
async function abrirChat(): Promise<HTMLElement> {
  await userEvent.click(
    screen.getByRole("button", { name: /^Abrir chat con clientes/ }),
  );
  return screen.getByRole("dialog");
}

/** Monta Reparto con una orden ya recogida y las dos por recoger. Sin abrir el chat. */
async function montarReparto(): Promise<void> {
  renderConSwr(
    <RepartoModule
      porGestionar={[EN_REPARTO]}
      conAyuda={[]}
      porRecoger={[POR_RECOGER_HOY, POR_RECOGER_MANANA]}
      ordenEnGestionId={null}
      ruta={RUTA_VIGENTE}
      bloqueo={SIN_BLOQUEO}
    />,
  );
  await act(async () => {
    await Promise.resolve();
  });
}

/** Lo mismo, y con el chat ya abierto. */
async function chatDesdeReparto(): Promise<HTMLElement> {
  await montarReparto();
  return abrirChat();
}

/** La fila de un contacto dentro del modal, por el nombre de su destinatario. */
function fila(modal: HTMLElement, destinatario: string): HTMLElement {
  return within(modal).getByRole("button", { name: new RegExp(destinatario) });
}

beforeEach(() => {
  resumenNoLeidosChatMock.mockReset();
  resumenNoLeidosChatMock.mockResolvedValue({ status: "ok", conversaciones: [] });
  listarHiloChatMock.mockReset();
  listarHiloChatMock.mockResolvedValue({
    status: "ok",
    ventanaAbierta: true,
    ultimoEntranteAt: null,
    plantillaBloqueada: false,
    textoLibreHabilitado: true,
    mensajes: [],
  });
});

afterEach(cleanup);

describe("(1) la orden asignada y sin recoger YA tiene conversación", () => {
  it("desde Reparto, el cliente de un paquete que aún no lleva encima está en la lista", async () => {
    const modal = await chatDesdeReparto();

    expect(fila(modal, "Carlos Sin Recoger")).toBeInTheDocument();
    expect(fila(modal, "Diana Para Mañana")).toBeInTheDocument();
  });

  it("y la que ya lleva encima sigue estando: esta ficha suma, no sustituye", async () => {
    const modal = await chatDesdeReparto();

    expect(fila(modal, "Ana Ya Recogida")).toBeInTheDocument();
  });

  it("la cabecera cuenta TODAS las asignadas, no solo las de reparto", async () => {
    const modal = await chatDesdeReparto();

    expect(within(modal).getByText("3 asignados")).toBeInTheDocument();
  });

  it("cada grupo tiene su sección, así lo de hoy no se mezcla con lo de otro día", async () => {
    const modal = await chatDesdeReparto();

    const hoy = within(modal).getByRole("region", { name: "Para recoger hoy" });
    expect(within(hoy).getByRole("button", { name: /Carlos Sin Recoger/ })).toBeInTheDocument();

    const otroDia = within(modal).getByRole("region", { name: "Para otro día" });
    expect(
      within(otroDia).getByRole("button", { name: /Diana Para Mañana/ }),
    ).toBeInTheDocument();
    // Y no al revés: la de hoy no cae en el grupo de la que el servidor va a rechazar.
    expect(
      within(otroDia).queryByRole("button", { name: /Carlos Sin Recoger/ }),
    ).toBeNull();
  });

  it("sin ninguna asignada, el vacío ya no habla de «reparto»", async () => {
    renderConSwr(
      <RepartoModule
        porGestionar={[]}
        conAyuda={[]}
        porRecoger={[]}
        ordenEnGestionId={null}
        ruta={RUTA_VIGENTE}
        bloqueo={SIN_BLOQUEO}
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    const modal = await abrirChat();

    expect(
      within(modal).getByText("No tienes órdenes asignadas."),
    ).toBeInTheDocument();
  });
});

describe("(3) la de OTRO DÍA se distingue de la de hoy", () => {
  it("la fila de la reservada lleva la marca «Para mañana»", async () => {
    const modal = await chatDesdeReparto();

    expect(fila(modal, "Diana Para Mañana")).toHaveTextContent("Para mañana");
  });

  it("y dice con palabras, y con SU FECHA, lo que el sistema le va a impedir", async () => {
    const modal = await chatDesdeReparto();

    // La frase sale de la fuente única (`avisoReservaParaOtroDia`), con la fecha que la orden
    // trae ya resuelta del servidor. Sin ella, el mensajero promete una entrega de hoy sobre un
    // paquete que no va a poder recoger hasta mañana.
    expect(fila(modal, "Diana Para Mañana")).toHaveTextContent(
      "Esta orden es para el reparto del 16 de septiembre. Ese día podrás recogerla y gestionarla.",
    );
  });

  it("⭑ y la de HOY no lleva ninguna de las dos: la marca DISTINGUE, no adorna", async () => {
    // El caso que hace que los dos de arriba midan algo. Si la marca se pintara en todas las
    // filas, o en ninguna, seguirían pasando y el mensajero no sabría cuál es cuál.
    const modal = await chatDesdeReparto();
    const deHoy = fila(modal, "Carlos Sin Recoger");

    expect(deHoy).not.toHaveTextContent("Para mañana");
    expect(deHoy).not.toHaveTextContent("Ese día podrás recogerla");
  });

  it("la conversación abierta también lo dice: es donde se escribe la promesa", async () => {
    const modal = await chatDesdeReparto();
    await userEvent.click(fila(modal, "Diana Para Mañana"));

    const aviso = within(modal).getByRole("note");
    expect(aviso).toHaveTextContent(
      "Esta orden es para el reparto del 16 de septiembre. Ese día podrás recogerla y gestionarla.",
    );
  });

  it("y con la de hoy delante, esa nota no existe", async () => {
    const modal = await chatDesdeReparto();
    await userEvent.click(fila(modal, "Carlos Sin Recoger"));

    // La fila de Diana sigue en la lista con su texto; lo que NO puede haber es la nota de la
    // conversación, que es del encabezado de la orden abierta.
    expect(within(modal).queryByRole("note")).toBeNull();
  });
});

describe("(2) el detalle completo de la orden, desde el chat", () => {
  it("«Ver detalle» despliega dirección y producto de la orden abierta", async () => {
    const modal = await chatDesdeReparto();
    await userEvent.click(fila(modal, "Carlos Sin Recoger"));

    const ver = within(modal).getByRole("button", { name: "Ver detalle" });
    expect(ver).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(ver);

    expect(
      within(modal).getByText("Avenida Escazú 100, casa azul"),
    ).toBeInTheDocument();
    expect(within(modal).getByText("Licuadora")).toBeInTheDocument();
    // Las tres secciones del detalle («Pedido / Entrega / Cobro»), por una etiqueta de cada una:
    // lo que se despliega es el detalle COMPLETO, no un resumen nuevo.
    expect(within(modal).getByText("Nº Guía")).toBeInTheDocument();
    expect(within(modal).getByText("Provincia")).toBeInTheDocument();
  });

  it("arranca plegado: lo que se abre es un chat, y el hilo va primero", async () => {
    const modal = await chatDesdeReparto();
    await userEvent.click(fila(modal, "Carlos Sin Recoger"));

    expect(within(modal).queryByText("Avenida Escazú 100, casa azul")).toBeNull();
    expect(within(modal).getByRole("button", { name: "Ver detalle" })).toBeInTheDocument();
  });
});

describe("(4) conversar no es aceptar: el chat no ofrece trabajar la orden", () => {
  it("ninguna fila del chat lleva «Gestionar» ni «Recoger», tampoco dentro de «Ver detalle»", async () => {
    const modal = await chatDesdeReparto();

    // ⭑ EL DESPLEGABLE VA ABIERTO, y sin esto la guardia no medía la mitad de su superficie:
    // con el detalle plegado su contenido ni siquiera está montado, así que una acción metida ahí
    // dentro —que es justo donde caería, al lado del detalle de la orden— quedaba fuera de alcance.
    // Medido el 2026-09-16: un `<button>Gestionar esta orden</button>` junto a `<AsignacionDetalle>`
    // dejaba los 16 tests de este archivo en verde.
    await userEvent.click(within(modal).getByRole("button", { name: "Ver detalle" }));
    expect(
      within(modal).getByRole("button", { name: "Ocultar detalle" }),
    ).toBeInTheDocument();

    // OJO con el patron: la fila ES un boton y su nombre accesible contiene el chip «Por
    // recoger», asi que un /Recoger/i cazaria la propia fila. Lo que no puede existir son las
    // acciones de la card del portal.
    expect(within(modal).queryByRole("button", { name: /Gestionar/ })).toBeNull();
    expect(within(modal).queryByRole("button", { name: /más tarde/i })).toBeNull();
  });

  // ⏳ 2026-09-24 (FICHA 455, R7): el chip dice el NOMBRE del estado de la orden, no «Por recoger».
  it("la fila de la asignada se anuncia con su estado, «Mensajero recogiendo en la bodega», no como en reparto", async () => {
    const modal = await chatDesdeReparto();

    expect(fila(modal, "Carlos Sin Recoger")).toHaveTextContent("Mensajero recogiendo en la bodega");
  });
});

describe("(5) «Por recoger» monta el MISMO chat, con la MISMA lista", () => {
  it("el botón flotante está, y lista las tres órdenes asignadas", async () => {
    renderConSwr(
      <ChatDelMensajero
        porGestionar={[EN_REPARTO]}
        conAyuda={[]}
        porRecoger={[POR_RECOGER_HOY, POR_RECOGER_MANANA]}
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    const modal = await abrirChat();

    // Las mismas tres que en Reparto. Si esta pantalla compusiera una lista propia, su
    // distintivo de sin leer contaría distinto y cada pantalla escondería lo de la otra.
    expect(fila(modal, "Ana Ya Recogida")).toBeInTheDocument();
    expect(fila(modal, "Carlos Sin Recoger")).toBeInTheDocument();
    expect(fila(modal, "Diana Para Mañana")).toBeInTheDocument();
    expect(within(modal).getByText("3 asignados")).toBeInTheDocument();
  });

  it("y la marca del día viaja con ella: no depende de desde qué pantalla se abra", async () => {
    renderConSwr(
      <ChatDelMensajero
        porGestionar={[]}
        conAyuda={[]}
        porRecoger={[POR_RECOGER_HOY, POR_RECOGER_MANANA]}
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    const modal = await abrirChat();

    expect(fila(modal, "Diana Para Mañana")).toHaveTextContent("Para mañana");
    expect(fila(modal, "Carlos Sin Recoger")).not.toHaveTextContent("Para mañana");
  });
});

describe("(6) el distintivo de sin leer YA cuenta las asignadas sin recoger", () => {
  // ⭑ ESTE ES EL EFECTO COLATERAL QUE SOSTIENE LA DECISION DE UNA SOLA LISTA, y hasta hoy no lo
  // fijaba nada. `ChatFlotante` filtra el resumen del servidor contra las ordenes que la pantalla
  // lista (`enChat`), porque un pendiente sin fila donde abrirse deja un distintivo que no se puede
  // vaciar. Antes de esta ficha las `por_recoger` no estaban en esa lista, asi que sus entrantes
  // —que el servidor SI devuelve: `contarNoLeidosPorMensajero` filtra solo por mensajero, ni estatus
  // ni fecha— se caian del contador en silencio. Al entrar a la lista, dejan de caerse.
  //
  // Medido el 2026-09-16: reponer el filtro anterior a la ficha
  // (`ordenes.filter((o) => o.estatusValue !== "por_recoger")` en `ChatFlotante`) dejaba 149 tests
  // en verde, y los 65 de los dos archivos dedicados a los no leidos tambien.

  it("los pendientes de una orden POR RECOGER suman al distintivo del botón flotante", async () => {
    resumenNoLeidosChatMock.mockResolvedValue({
      status: "ok",
      conversaciones: [
        { ordenId: "c", noLeidos: 2 }, // Carlos: asignada, sin recoger, para hoy
        // La contraprueba de que el filtro SIGUE filtrando: un pendiente de una orden que ya no
        // está asignada a este mensajero no tiene fila donde abrirse y no puede sumar. Sin esta
        // línea, borrar el filtro entero también pasaría este test.
        { ordenId: "z-entregada-hace-un-mes", noLeidos: 7 },
      ],
    });
    await montarReparto();

    // Con el chat CERRADO no hay conversación delante, así que no se descuenta ninguna: el total
    // es exactamente lo que el filtro deja pasar.
    expect(await screen.findByTestId("chat-no-leidos-total")).toHaveTextContent("2");
  });

  it("y esa orden luce SU número en la lista, que es donde el mensajero la abre", async () => {
    resumenNoLeidosChatMock.mockResolvedValue({
      status: "ok",
      conversaciones: [{ ordenId: "c", noLeidos: 2 }],
    });
    const modal = await chatDesdeReparto();

    // La cifra sobre el avatar de SU fila, y la fila donde abrir la conversación: sin las dos, el
    // mensajero ve un número en el botón y no encuentra de quién es.
    expect(await within(modal).findByTestId("chat-no-leidos-c")).toHaveTextContent("2");
    expect(fila(modal, "Carlos Sin Recoger")).toBeInTheDocument();
    // La cifra no puede vivir solo en el color ni solo en el tamaño.
    expect(within(modal).getByText("2 mensajes sin leer")).toBeInTheDocument();
  });
});
