// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { RepartoModule } from "@/app/(app)/mis-asignaciones/_components/RepartoModule";
import {
  recuperarOrdenAyuda,
  solicitarAyudaOrden,
} from "@/lib/actions/orden-ayuda";
import type {
  MiAsignacionDTO,
  RutaResumenDTO,
} from "@/lib/interfaces/services/IMisAsignacionesService";

// Pedido humano 2026-08-18 — SOLICITUD DE AYUDA en la pantalla de reparto del mensajero, en sus
// dos mitades: el cuarto botón del panel («Ayuda») y la SECCIÓN de abajo, que es donde van a
// parar las órdenes con ayuda pedida.
//
// FEATURE 235 (T3.3/T3.5/T5.2, 2026-08-19) — EL CORTE DEJA DE SER DE CLIENTE. Hasta hoy este
// módulo recibía UNA lista y la partía con un `useMemo` sobre `orden.ayuda`: la orden marcada
// seguía dentro de `porGestionar`, o sea seguía siendo parada del mapa, candidata del panel y
// GESTIONABLE. Ahora llega ya partida en dos props (`porGestionar` y `conAyuda`, R18) y el módulo
// pinta lo que le dan. Los casos de abajo no se reescribieron: se les cambió el fixture (de la
// bandera a la segunda lista) y se les sumó lo que la separación real hace posible — que la orden
// salga del mapa y del contador de paradas (R15) y que su card tenga dónde abrir el hilo (R35).
//
// Archivo aparte de `RepartoModule.test.tsx` a propósito: aquel mide la composición de la
// pantalla y ya es largo; esto mide una regla de reparto entre dos listas. El andamiaje de mocks
// es el mismo porque el módulo bajo prueba es el mismo — sin ellos, importar las Server Actions
// reales arrastraría Prisma a jsdom.

vi.mock("@/lib/actions/mis-asignaciones", () => ({
  recogerAsignaciones: vi.fn(),
  escogerParaGestion: vi.fn(),
  gestionar: vi.fn(),
  liberarGestion: vi.fn(),
}));

vi.mock("@/lib/actions/orden-ayuda", () => ({
  solicitarAyudaOrden: vi.fn(),
  recuperarOrdenAyuda: vi.fn(),
}));

vi.mock("@/lib/actions/orden-notas", () => ({
  listarNotasOrden: vi
    .fn()
    .mockResolvedValue({ status: "ok", notas: [], puedeEscribir: false }),
  publicarNotaOrden: vi.fn(),
  borrarNotaOrden: vi.fn(),
}));

// Feature 235 (R15): el mock CAPTURA las paradas, como hace `RepartoModule.test.tsx`. Sin eso no
// se puede afirmar que la orden en ayuda sale del mapa — solo que no se ve su card, que es otra
// cosa y era justamente lo que la separación de cliente conseguía sin sacarla de la ruta.
const { rutaMapaMock } = vi.hoisted(() => ({ rutaMapaMock: vi.fn() }));
vi.mock("@/app/(app)/mis-asignaciones/_components/RutaMapa", () => ({
  RutaMapa: (props: { paradas: unknown[] }) => {
    rutaMapaMock(props);
    return <div data-testid="ruta-mapa" />;
  },
}));

vi.mock("@/lib/actions/ruta-mensajero", () => ({
  sincronizarRuta: vi.fn().mockResolvedValue({ status: "ok", omitida: false }),
}));

vi.mock("@/lib/actions/orden-mensajero-meta", () => ({
  marcarGestionarLuego: vi.fn(),
}));

const { successMock, errorMock, refreshMock } = vi.hoisted(() => ({
  successMock: vi.fn(),
  errorMock: vi.fn(),
  refreshMock: vi.fn(),
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

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, push: vi.fn() }),
}));

const solicitarMock = vi.mocked(solicitarAyudaOrden);
const recuperarMock = vi.mocked(recuperarOrdenAyuda);

function makeAsignacion(
  over: Partial<MiAsignacionDTO> & { id: string },
): MiAsignacionDTO {
  return {
    numGuia: 1001,
    numRemision: "REM-001",
    estatusValue: "en_reparto",
    destinatario: "Ana Perez",
    telefonoDest: "88880000",
    direccion: "Calle 1, casa 2",
    producto: "Caja mediana",
    peso: 1.5,
    montoCobrar: 150,
    latitud: 9.9281244,
    longitud: -84.0907246,
    notas: "Dejar en porteria",
    tiendaNombre: "Tienda X",
    zonaNombre: "GAM",
    provinciaNombre: "San Jose",
    cantonNombre: "Central",
    distritoNombre: "Carmen",
    secuenciaRuta: null,
    ...over,
  };
}

const RUTA_VIGENTE: RutaResumenDTO = {
  estado: "vigente",
  calculadaAt: null,
  origenFuente: "gps",
  paradasSinOptimizar: 0,
  trazado: null,
  tramoSiguiente: null,
};

function renderModule(
  porGestionar: MiAsignacionDTO[],
  // Feature 235 (R18): la SEGUNDA lista, ya separada por el servidor. Que sea un parámetro y no
  // una derivación es el cambio: el módulo no vuelve a decidir el corte.
  conAyuda: MiAsignacionDTO[] = [],
  // Feature 235 (R25): el bloqueo por cierre sin resolver. Parametrizado porque el rescate es la
  // ÚNICA acción de esta pantalla que debe sobrevivirle, y sin poder encenderlo no se puede afirmar.
  bloqueado = false,
) {
  return render(
    <RepartoModule
      porGestionar={porGestionar}
      conAyuda={conAyuda}
      ordenEnGestionId={null}
      ruta={RUTA_VIGENTE}
      bloqueado={bloqueado}
    />,
  );
}

/** Una orden en el estatus de ayuda, tal como llega hoy: en la SEGUNDA lista y con su estado. */
function enAyuda(over: Partial<MiAsignacionDTO> & { id: string }): MiAsignacionDTO {
  return makeAsignacion({ estatusValue: "ayuda_tienda", ...over });
}

/** La sección de abajo, por su nombre accesible. `query` para poder afirmar que NO está. */
const seccionAyuda = () =>
  screen.queryByRole("region", { name: "Con ayuda solicitada" });

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

describe("Reparto · el cuarto botón «Ayuda» del panel", () => {
  it("está junto a los otros tres gestos de la puerta y arranca sin marcar", () => {
    renderModule([makeAsignacion({ id: "g1" })]);

    const panel = screen.getByRole("region", { name: "Detalle de la orden" });
    // Los otros tres siguen ahí: este botón se AÑADE, no sustituye a ninguno.
    expect(within(panel).getByRole("link", { name: /^Llamar a / })).toBeTruthy();
    expect(within(panel).getByRole("button", { name: /^Abrir el chat con / })).toBeTruthy();

    const ayuda = within(panel).getByRole("button", {
      name: "Solicitar ayuda con la orden de Ana Perez",
    });
    expect(ayuda.textContent).toContain("Ayuda");
    expect(ayuda.textContent).not.toContain("Ayuda pedida");
  });

  it("235/R16: el panel NO se abre sobre una orden en ayuda, así que su rótulo es FIJO", () => {
    // El rótulo alternaba «Ayuda» / «Ayuda pedida» según la bandera, y podía hacerlo porque la
    // orden marcada seguía en `porGestionar` y por tanto en el panel. Desde la 235 esas órdenes
    // llegan en `conAyuda` y el panel no las alcanza —`cargarOrdenGestionable` exige
    // `en_reparto`—, así que el estado «pedida» lo cuenta la sección de abajo, que es donde el
    // mensajero lo mira.
    renderModule([], [enAyuda({ id: "g1" })]);

    expect(screen.queryByRole("region", { name: "Detalle de la orden" })).toBeNull();
    expect(seccionAyuda()).not.toBeNull();
  });

  it("no se puede confirmar sin motivo, y con motivo envía la orden y el texto recortado", async () => {
    const user = userEvent.setup();
    solicitarMock.mockResolvedValue({
      status: "ok",
      nota: {
        id: "n1",
        cuerpo: "Direccion no existe",
        autorNombre: "Mensajero",
        rolAutor: "mensajero",
        createdAt: "2026-08-18T10:00:00.000Z",
        esPropia: true,
        eliminada: false,
      },
    });
    renderModule([makeAsignacion({ id: "g1" })]);

    const panel = screen.getByRole("region", { name: "Detalle de la orden" });
    await user.click(
      within(panel).getByRole("button", {
        name: "Solicitar ayuda con la orden de Ana Perez",
      }),
    );

    const confirmar = screen.getByRole("button", { name: "Solicitar ayuda" });
    // El motivo es obligatorio: la regla se comunica deshabilitando, no regañando.
    expect((confirmar as HTMLButtonElement).disabled).toBe(true);

    await user.type(screen.getByLabelText(/Motivo/), "  Direccion no existe  ");
    expect((confirmar as HTMLButtonElement).disabled).toBe(false);
    await user.click(confirmar);

    expect(solicitarMock).toHaveBeenCalledWith({
      ordenId: "g1",
      motivo: "Direccion no existe", // recortado antes de salir
    });
  });
});

describe("Reparto · las órdenes con ayuda se van abajo, a su propia sección", () => {
  it("sin ninguna marcada no aparece la sección: no se añade un encabezado vacío", () => {
    renderModule([makeAsignacion({ id: "g1" })]);
    expect(seccionAyuda()).toBeNull();
  });

  it("la marcada sale del listado principal y aparece abajo, una sola vez", () => {
    renderModule(
      [makeAsignacion({ id: "g1", numRemision: "REM-001" })],
      [enAyuda({ id: "g2", numRemision: "REM-002" })],
    );

    const principal = screen.getByRole("region", {
      name: "En reparto / por gestionar",
    });
    const seccion = seccionAyuda();
    expect(seccion).not.toBeNull();

    // La marcada vive DENTRO de la sección de abajo...
    expect(
      within(seccion as HTMLElement).getByRole("article", { name: /REM-002/ }),
    ).toBeTruthy();
    // ...y la otra NO: cada orden aparece en una sola de las dos listas.
    expect(
      within(seccion as HTMLElement).queryByRole("article", { name: /REM-001/ }),
    ).toBeNull();
    // El listado principal sigue mostrando la que avanza sola.
    expect(
      within(principal).getAllByRole("article", { name: /REM-001/ }).length,
    ).toBe(1);
  });

  it("con TODAS marcadas el listado principal lo dice, en vez de quedarse en blanco", () => {
    renderModule([], [enAyuda({ id: "g1" })]);

    expect(
      screen.getByText(
        "Todas tus órdenes en reparto tienen ayuda solicitada; están abajo.",
      ),
    ).toBeTruthy();
    expect(seccionAyuda()).not.toBeNull();
  });

  it("«Recuperar» retira la solicitud y hace releer el listado", async () => {
    const user = userEvent.setup();
    recuperarMock.mockResolvedValue({ status: "ok" });
    renderModule(
      [makeAsignacion({ id: "g1", numRemision: "REM-001" })],
      [enAyuda({ id: "g2", numRemision: "REM-002" })],
    );

    await user.click(
      screen.getByRole("button", {
        name: "Retirar la solicitud de ayuda de la orden REM-002",
      }),
    );

    expect(recuperarMock).toHaveBeenCalledWith({ ordenId: "g2" });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("un rechazo del borde NO se traga: se avisa y no se refresca por las dudas", async () => {
    const user = userEvent.setup();
    recuperarMock.mockResolvedValue({ status: "forbidden" });
    renderModule([], [enAyuda({ id: "g2", numRemision: "REM-002" })]);

    await user.click(
      screen.getByRole("button", {
        name: "Retirar la solicitud de ayuda de la orden REM-002",
      }),
    );

    expect(errorMock).toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  // ⚰️ FEATURE 235 (T3.5, R16/R19) — AQUI VIVIA «la orden con ayuda SIGUE siendo gestionable desde
  // su card». Aquel botón llamaba a `escogerParaGestion`, que desde la 235 devuelve `conflict`
  // sobre una orden en `ayuda_tienda` (`cargarOrdenGestionable` exige `en_reparto`): dejarlo sería
  // un botón que siempre falla. Las gestiones DESDE ayuda son la ficha 237, con su productor.
  //
  // Lo que aquel caso protegía —que la orden no quede ATRAPADA— lo protegen los dos de abajo:
  // «Recuperar» la devuelve arriba y «Conversación» le da al mensajero dónde ejercer su ventana.
  it("235/R16: la card de ayuda YA NO ofrece «Gestionar» (llamaría a una acción que rechaza)", () => {
    renderModule([], [enAyuda({ id: "g2", numRemision: "REM-002" })]);

    const seccion = seccionAyuda() as HTMLElement;
    expect(within(seccion).queryByRole("button", { name: /Gestionar/ })).toBeNull();
  });

  it("235/R19: la card conserva «Recuperar», que es la salida de vuelta", () => {
    renderModule([], [enAyuda({ id: "g2", numRemision: "REM-002" })]);

    const seccion = seccionAyuda() as HTMLElement;
    expect(
      within(seccion).getByRole("button", {
        name: "Retirar la solicitud de ayuda de la orden REM-002",
      }),
    ).toBeTruthy();
  });

  it("235/R25: bloqueado por cierre, «Recuperar» sigue pulsable y llega hasta la Server Action", async () => {
    // POR QUÉ ES LA EXCEPCIÓN Y NO UN DESCUIDO: `rescate-ayuda.ts` NO comprueba el bloqueo total, a
    // propósito, porque comprobarlo crearía un DEADLOCK con R22 — un mensajero con un cierre
    // `vencido` y una orden en ayuda no podría ni rescatarla (bloqueado) ni cerrar (esa misma orden
    // le bloquea el cierre). Hasta hoy la card le pasaba `disabled={bloqueado}` al botón: el
    // permiso vivía en el servidor y moría en la pantalla, que es el permiso inejercitable que R35
    // prohíbe. No se apoya en que el resto de la card siga bloqueada: no lo está —sin `onGestionar`
    // el gate de selección ya está apagado, ver el comentario de la prop `bloqueado` en
    // `RepartoModule`—. El `alert` de abajo es lo que prueba que el bloqueo llegó al módulo.
    const user = userEvent.setup();
    recuperarMock.mockResolvedValue({ status: "ok" });
    renderModule([], [enAyuda({ id: "g2", numRemision: "REM-002" })], true);

    // Antes de nada: que el bloqueo REALMENTE llegó al módulo. Sin esto el caso quedaría verde
    // aunque la prop se ignorara, y no probaría nada del bloqueo.
    expect(screen.getByRole("alert")).toBeInTheDocument();

    const recuperar = screen.getByRole("button", {
      name: "Retirar la solicitud de ayuda de la orden REM-002",
    });
    expect(recuperar).not.toBeDisabled();

    // Y que el permiso es EJERCITABLE de verdad, no solo un atributo ausente: el click tiene que
    // llegar al borde y devolver la orden a la calle.
    await user.click(recuperar);
    expect(recuperarMock).toHaveBeenCalledWith({ ordenId: "g2" });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("235/R37: el chip de la card NO dice «En reparto», que es lo que la orden dejó de ser", () => {
    // Medido en el navegador (T8.1), no en la suite: la card montaba `esActiva`/`esDetalle` en
    // `false` y sin `estado`, así que `estadoPorDefecto` devolvía el literal «En reparto». Para los
    // otros tres valores el chip DESCRIBE la situación de la orden; aquí afirmaba justo la que esta
    // ficha volvió falsa, y a un palmo del encabezado que dice lo contrario.
    renderModule([], [enAyuda({ id: "g2", numRemision: "REM-002" })]);

    const seccion = seccionAyuda() as HTMLElement;
    expect(within(seccion).queryByText("En reparto")).toBeNull();
    expect(within(seccion).getByText("En ayuda")).toBeInTheDocument();
  });

  it("235/R37: y el COLOR de ese chip es el de `warning` sólido, fijado y no heredado", () => {
    // N1/N2 de la re-revisión. «En ayuda» es texto libre para `estadoBadgeClass`, así que hasta
    // ahora su color llegaba por el FALLBACK — la rama que existe para no romper con un rótulo
    // desconocido, no para expresar una decisión — y coincidía con el de «En reparto». Nadie lo
    // fijaba: retocar esa otra entrada movía este chip en silencio. Ahora `ESTADO_CLASSNAME` tiene
    // su entrada propia y este caso la clava en la SUPERFICIE, que es donde se ve: `warning` es la
    // familia de los estados de espera con acción pendiente (la de `EstatusBadge.ayuda_tienda` y la
    // del encabezado de la sección) y `bg-warning`/`text-navy` son tokens fijos, o sea el par
    // fijo-sobre-fijo que DESIGN.md exige para un chip sólido.
    renderModule([], [enAyuda({ id: "g2", numRemision: "REM-002" })]);

    const seccion = seccionAyuda() as HTMLElement;
    expect(within(seccion).getByText("En ayuda")).toHaveClass(
      "bg-warning",
      "text-navy",
    );
  });

  it("235/R35: desde la card se abre el HILO, que es donde el mensajero ejerce su ventana", async () => {
    // Sin esta acción el mensajero tendría la ventana de escritura abierta sobre esta orden
    // (`ayuda_tienda` está en `VENTANA_ESCRITURA.mensajero`) y NINGÚN sitio donde ejercerla: su
    // hilo vivía dentro de `GestionarOrdenPanel`, que ya no alcanza a estas órdenes. Es el permiso
    // inejercitable que R35 prohíbe — y en la práctica, la tienda hablándole a un hilo mudo.
    const user = userEvent.setup();
    renderModule([], [enAyuda({ id: "g2", numRemision: "REM-002" })]);

    const seccion = seccionAyuda() as HTMLElement;
    await user.click(within(seccion).getByRole("button", { name: "Conversación" }));

    expect(await screen.findByRole("region", { name: "Notas con la tienda" })).toBeTruthy();
  });
});

// =================================================================================================
// FEATURE 235 (T3.3, R15/P8) — LO QUE LA SEPARACIÓN REAL HACE POSIBLE, y que con la bandera era
// imposible de afirmar: la orden en ayuda SALE de la ruta y del mapa, pero SIGUE en el chat.
// =================================================================================================
describe("Reparto · la orden en ayuda sale de la ruta, pero no del chat", () => {
  it("235/R15: NO llega al mapa de ruta — la parada desaparece, no solo su card", () => {
    renderModule(
      [makeAsignacion({ id: "g1", numRemision: "REM-001", secuenciaRuta: 1 })],
      [enAyuda({ id: "g2", numRemision: "REM-002" })],
    );

    // ⭑ LA AFIRMACIÓN QUE LA SEPARACIÓN DE CLIENTE NO PODÍA HACER. Antes la orden con la bandera
    // seguía dentro de `porGestionar`, así que llegaba al mapa igual: se le ocultaba la card y se
    // le dejaba la chincheta. Hoy ni siquiera está en la lista de la que salen las paradas.
    const props = rutaMapaMock.mock.calls.at(-1)?.[0] as { paradas: { id: string }[] };
    expect(props.paradas.map((p) => p.id)).toEqual(["g1"]);
  });

  it("235/R15: y su card aparece UNA sola vez, en la sección de abajo", () => {
    renderModule(
      [makeAsignacion({ id: "g1", numRemision: "REM-001" })],
      [enAyuda({ id: "g2", numRemision: "REM-002" })],
    );

    const seccion = seccionAyuda() as HTMLElement;
    expect(within(seccion).getAllByRole("article", { name: /REM-002/ })).toHaveLength(1);
    // Y en NINGÚN otro sitio: si el módulo volviera a partir en cliente una lista que ya viene
    // partida, la orden saldría dos veces.
    expect(screen.getAllByRole("article", { name: /REM-002/ })).toHaveLength(1);
  });

  it("235/R15: su card NO lleva la marca «Pendiente de optimizar», que sí sigue en el listado de arriba", () => {
    // La otra mitad de R15, la que el número ya cumplía y la superficie no: el servicio deja estas
    // órdenes fuera de `paradasSinOptimizar`, pero la card seguía luciendo la marca. El contraste
    // con la orden de arriba es lo que hace al caso decir algo: si se apagara la marca en TODAS
    // partes (o si nunca se pintara) este test seguiría verde con solo la primera aserción.
    renderModule(
      [makeAsignacion({ id: "g1", numRemision: "REM-001", secuenciaRuta: null })],
      [enAyuda({ id: "g2", numRemision: "REM-002", secuenciaRuta: null })],
    );

    const seccion = seccionAyuda() as HTMLElement;
    expect(within(seccion).queryByText("Pendiente de optimizar")).toBeNull();
    // Y la posición en la ruta tampoco se anuncia: sin ruta no hay «sin posición» que declarar.
    expect(within(seccion).queryByText("Sin posición en la ruta")).toBeNull();

    const listado = screen.getByRole("region", { name: "En reparto / por gestionar" });
    expect(within(listado).getByText("Pendiente de optimizar")).toBeInTheDocument();
  });

  it("235/P8: SÍ sigue entre los contactos del chat — el paquete sigue en su moto", () => {
    // Es una línea del módulo y sin ella el mensajero pierde EN SILENCIO la única entrada al chat
    // que le queda sobre un paquete que sigue llevando encima. Nadie pidió quitarlo.
    renderModule([], [enAyuda({ id: "g2", numRemision: "REM-002", destinatario: "Beto Ruiz" })]);

    // El botón flotante del chat solo se pinta si hay contactos; su nombre accesible los cuenta.
    expect(screen.getByRole("button", { name: /chat/i })).toBeTruthy();
  });
});
