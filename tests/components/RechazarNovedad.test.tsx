// @vitest-environment jsdom
// =================================================================================================
// 💰 FEATURE 240 (T5.3 — R13/R27/R28/R29/R30/R31/R32) — EL BOTÓN «RECHAZAR» DEJA DE SER UNA MAQUETA.
// =================================================================================================
//
// **El defecto que este archivo cierra, con fechas.** Desde el 2026-08-12 la fila de «En devolución»
// tenía un botón —rotulado «Devolver» hasta el 2026-08-19 y «Rechazar» desde entonces— cuyo handler
// era `toast.info("Esta acción todavía no está disponible.")`. Dos semanas. Doce mil tests en verde,
// y con razón: no había ni un caso que afirmara que ese botón produjera una operación, así que no
// había nada que romper. Este archivo es ese caso.
//
// **Por qué vive aparte de `NovedadesModule.test.tsx`.** Aquél mide la pantalla —la lista, las
// cards, la paginación, los censos de botones— y ya tiene 1.900 líneas. Éste mide UNA operación de
// dinero de punta a punta: se abre la ventana desde la fila real, se lee lo que dice antes de
// confirmar, se confirma, y se comprueba qué se llamó y qué quedó en pantalla. El montaje es el
// MÓDULO ENTERO y no el modal suelto, a propósito: un test que renderiza `RechazarNovedadModal`
// directamente pasaría verde el día que alguien desconectara el botón de la card.
//
// **Lo que se mide y lo que NO.** Aquí no se comprueba qué escribe el servidor —eso vive en
// `tests/unit/repositories/gestion-orden-rechazar.test.ts` y en
// `tests/unit/services/rechazo-tienda-service.test.ts`—. Aquí se comprueba lo que la tienda ve y lo
// que la pantalla dispara.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { NovedadesModule } from "@/app/(app)/novedades/_components/NovedadesModule";
import { listarNovedadesAction } from "@/lib/actions/novedades";
import { rechazarNovedad, reprogramarNovedad } from "@/lib/actions/resolver-novedad";
import type { NovedadDTO } from "@/lib/types/novedad";

// Los cuatro listados del módulo: `RECURSOS_POR_GRUPO` los importa todos y elige el de su pestaña.
// Se declaran los cuatro porque vitest lanza al RESOLVER el import: uno que faltara no dejaría un
// caso rojo, dejaría cero casos.
vi.mock("@/lib/actions/novedades", () => ({
  listarNovedadesAction: vi.fn(),
  listarNovedadesCompletoAction: vi.fn(),
  listarAyudaTiendaAction: vi.fn(),
  listarAyudaTiendaCompletoAction: vi.fn(),
}));

// 💰 LA ACCIÓN QUE ESTA FICHA CABLEA, y su hermana de la misma card. `reprogramarNovedad` se mockea
// además para poder afirmar que rechazar NO la llama: son dos transiciones distintas desde el mismo
// estado y cruzarlas movería el dinero equivocado.
vi.mock("@/lib/actions/resolver-novedad", () => ({
  rechazarNovedad: vi.fn(),
  reprogramarNovedad: vi.fn(),
}));

vi.mock("@/lib/actions/habilitar-novedad", () => ({
  habilitarNovedad: vi.fn(),
}));

vi.mock("@/lib/actions/orden-ayuda", () => ({
  solicitarAyudaOrden: vi.fn(),
  recuperarOrdenAyuda: vi.fn(),
  registrarIntentoContactoOrden: vi.fn(),
}));

vi.mock("@/lib/actions/gestion-desde-ayuda", () => ({
  gestionarDesdeAyuda: vi.fn(),
}));

const { successMock, errorMock, infoMock, warningMock } = vi.hoisted(() => ({
  successMock: vi.fn(),
  errorMock: vi.fn(),
  // Con nombre a propósito: es el canal por el que avisaba la MAQUETA, y varios casos de abajo
  // afirman que ya no lo usa nadie. Un `vi.fn()` anónimo no dejaría afirmarlo.
  infoMock: vi.fn(),
  warningMock: vi.fn(),
}));

vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: successMock,
    error: errorMock,
    warning: warningMock,
    info: infoMock,
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

const rechazarMock = vi.mocked(rechazarNovedad);
const reprogramarMock = vi.mocked(reprogramarNovedad);
const listarMock = vi.mocked(listarNovedadesAction);

const MOTIVO = "El cliente cambió de dirección y no lo vamos a reintentar";

/**
 * ⚠️ LOS TEXTOS VISIBLES SE ESCRIBEN AQUÍ A MANO, NUNCA IMPORTADOS DE
 * `RechazarNovedadModal`.
 *
 * Compararlos contra la constante que los produce es compararlos contra su propia fuente: estaría
 * verde con cualquier contenido, incluido el día que alguien borre «no se puede deshacer» del aviso
 * o cambie el flete de devolución por el cobro de bodega —que es exactamente la confusión que la
 * 237 tuvo que corregir el 2026-08-20—. Esa forma de test ya dejó pasar dos avisos que mentían en
 * esta misma pila. El literal del test y el de producción son dos copias a propósito; que discrepen
 * es la señal.
 */
const TEXTO = {
  titulo: "Rechazar la orden",
  aviso:
    "Esto le cobra a tu tienda el flete por rechazo y no se puede deshacer. Si preferís volver a intentar la entrega, usá «Reprogramar».",
  motivoLabel: "Motivo del rechazo",
  bloqueo: "Escribí el motivo para poder rechazar.",
  exito: "Orden rechazada. El paquete vuelve a tu bodega.",
  conflicto:
    "Esta orden ya no estaba en devolución, así que no se rechazó. Actualizá la pantalla.",
  forbidden: "No tenés permiso para rechazar esta orden.",
} as const;

const novedad = (over: Partial<NovedadDTO> = {}): NovedadDTO => ({
  id: "o1",
  numGuia: 12345,
  numRemision: "REM-90210",
  estatusValue: "devuelta",
  intentosContacto: 0,
  mensajeroNombre: "Marta Mensajera",
  destinatario: "Ana Cliente",
  telefonoDest: "88887777",
  causa: "not_found",
  producto: "Zapatos",
  peso: 1.5,
  montoCobrar: 24500,
  direccion: "Av. Central 120",
  latitud: 9.9281,
  longitud: -84.0907,
  notas: null,
  tiendaNombre: "Tienda Demo",
  zonaNombre: "GAM Oeste",
  provinciaNombre: "San José",
  cantonNombre: "Escazú",
  distritoNombre: "San Rafael",
  secuenciaRuta: null,
  intentosEntrega: 2,
  ...over,
});

/**
 * La pestaña «En devolución» con DOS órdenes y total 2.
 *
 * Son dos y no una a propósito: con una sola, «la fila sale» y «la lista se vació» son
 * indistinguibles, y el total podría bajar a cero por cualquier motivo. Con dos, el caso feliz tiene
 * que dejar EXACTAMENTE la otra en pantalla y el total en 1.
 */
function montar() {
  render(
    <NovedadesModule
      grupo="devolucion"
      items={[novedad(), novedad({ id: "o2", numGuia: 777, destinatario: "Beto Cliente" })]}
      total={2}
      page={1}
      pageSize={10}
    />,
  );
}

/** Abre la ventana desde el botón de la card de Ana y devuelve el diálogo. */
async function abrir(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    screen.getByRole("button", { name: "Rechazar la orden de Ana Cliente" }),
  );
  return screen.findByRole("dialog");
}

/** Escribe el motivo y confirma. */
async function escribirYConfirmar(
  user: ReturnType<typeof userEvent.setup>,
  dialog: HTMLElement,
  motivo: string = MOTIVO,
) {
  await user.type(within(dialog).getByLabelText(TEXTO.motivoLabel), motivo);
  await user.click(within(dialog).getByRole("button", { name: "Rechazar" }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

// =================================================================================================
// R27 / R28 — la puerta, y lo que dice ANTES de confirmar
// =================================================================================================

describe("240/R27 — la fila de la devolución ofrece «Rechazar», y abre SU ventana", () => {
  it("con la ventana cerrada NO está en el árbol", () => {
    montar();
    // La ausencia. Su par es el caso siguiente, que la abre: sin él, esto pasaría igual con la
    // pantalla entera rota. Y montarla siempre significaría un formulario por cada orden de la
    // página, con el motivo de la anterior dentro.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText(TEXTO.aviso)).toBeNull();
    // CONTROL POSITIVO de que la pantalla SÍ se montó: el botón que la abre está en la fila (R27).
    expect(
      screen.getByRole("button", { name: "Rechazar la orden de Ana Cliente" }),
    ).toBeInTheDocument();
  });

  it("al pulsar, la ventana se abre y nombra la orden de ESA fila", async () => {
    const user = userEvent.setup();
    montar();

    const dialog = await abrir(user);

    expect(dialog).toHaveTextContent(TEXTO.titulo);
    // La orden que nombra es la de la fila pulsada, no la otra de la página: un modal que se
    // quedara con el snapshot equivocado cobraría el paquete de otra persona.
    expect(dialog).toHaveTextContent("Ana Cliente");
    expect(dialog).toHaveTextContent("guía 12345");
    expect(dialog).not.toHaveTextContent("Beto Cliente");
    // Abrir no muta nada.
    expect(rechazarMock).not.toHaveBeenCalled();
  });

  it("R32: y ya NO avisa que la acción no está disponible (la maqueta murió)", async () => {
    const user = userEvent.setup();
    montar();

    await abrir(user);

    // El aviso de la maqueta, por su literal exacto y por el canal entero. Si alguien volviera a
    // poner un `toast.info` en lugar de cablear la operación, esto cae.
    expect(infoMock).not.toHaveBeenCalled();
  });
});

describe("240/R28 — el precio y el «no se puede deshacer», ANTES de confirmar", () => {
  it("el aviso está en el árbol nada más abrir, con su literal", async () => {
    const user = userEvent.setup();
    montar();

    const dialog = await abrir(user);

    // El literal completo, escrito a mano arriba. Es lo único que la tienda no puede deducir
    // mirando la pantalla, y es lo que la deja decidir con la información delante.
    expect(within(dialog).getByText(TEXTO.aviso)).toBeInTheDocument();
  });

  it("y dice EL FLETE DE DEVOLUCIÓN, no el cobro de bodega por rechazo", async () => {
    const user = userEvent.setup();
    montar();

    const dialog = await abrir(user);

    // ⚠️ Los dos importes de un rechazo tienen DUEÑOS DISTINTOS: el «cobro por rechazo» es INGRESO
    // DE LA BODEGA (tarifa de zona + vehículo del mensajero) y NO está en el ledger de la tienda;
    // lo que la tienda paga es el flete de devolución, de su propia tarifa. Decirle que se cobra a
    // sí misma el primero sería falso — y la 237 ya tuvo que corregir esa misma frase en su diseño
    // el 2026-08-20. Este par positivo/negativo es lo que impide que se vuelva a escribir al revés.
    expect(dialog).toHaveTextContent("flete por rechazo");
    expect(dialog).not.toHaveTextContent(/cobro por rechazo/i);
    // Y la irreversibilidad, dicha con palabras y no con un icono (D6: no hay deshacer).
    expect(dialog).toHaveTextContent("no se puede deshacer");
  });

  it("el aviso NO desaparece al escribir el motivo: es fijo, no una advertencia de error", async () => {
    const user = userEvent.setup();
    montar();
    const dialog = await abrir(user);

    await user.type(within(dialog).getByLabelText(TEXTO.motivoLabel), MOTIVO);

    // Un aviso que sólo se ve mientras falta algo es un mensaje de validación, no un precio. El
    // precio se cobra igual con el formulario completo.
    expect(within(dialog).getByText(TEXTO.aviso)).toBeInTheDocument();
  });
});

// =================================================================================================
// R29 — el bloqueo se lee POR SU TEXTO, no por el `disabled`
// =================================================================================================

describe("240/R29 — sin motivo no se puede confirmar, y lo dice con palabras", () => {
  it("con el campo vacío hay un TEXTO que explica el bloqueo", async () => {
    const user = userEvent.setup();
    montar();

    const dialog = await abrir(user);

    // Lo que se lee es la FRASE. Un `toBeDisabled()` a secas afirmaría que el botón está apagado y
    // no que alguien pueda saber por qué — la regla que la ventana de la 238 y el sub-modal de la
    // 158 ya siguen. El `disabled` se comprueba también, pero como el segundo de los dos.
    expect(within(dialog).getByText(TEXTO.bloqueo)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Rechazar" })).toBeDisabled();
  });

  it("el texto del bloqueo DESAPARECE al escribir el motivo, y el botón se enciende", async () => {
    const user = userEvent.setup();
    montar();
    const dialog = await abrir(user);

    await user.type(within(dialog).getByLabelText(TEXTO.motivoLabel), MOTIVO);

    // El par del caso de arriba: sin esto, «hay un texto de bloqueo» estaría verde con un texto que
    // no se va nunca, y el usuario leería que le falta algo con el formulario completo.
    expect(within(dialog).queryByText(TEXTO.bloqueo)).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Rechazar" })).toBeEnabled();
  });

  it("un motivo de sólo ESPACIOS no cuenta como motivo", async () => {
    const user = userEvent.setup();
    montar();
    const dialog = await abrir(user);

    await user.type(within(dialog).getByLabelText(TEXTO.motivoLabel), "     ");

    // R12/D5: el motivo es la única línea que explicará el cobro el día de la primera disputa. Una
    // línea de espacios no explica nada, y el borde la rechaza igual (`motivoSchema` hace `trim`):
    // si la ventana la aceptara, el botón encendido llevaría a un `validation_error`.
    expect(within(dialog).getByText(TEXTO.bloqueo)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Rechazar" })).toBeDisabled();
  });
});

// =================================================================================================
// R13 / D5 — motivo SÍ, foto NO
// =================================================================================================

describe("240/R13 — la ventana NO pide evidencia en imagen", () => {
  it("no monta ningún selector de fotos, y sí el campo de motivo", async () => {
    const user = userEvent.setup();
    montar();

    const dialog = await abrir(user);

    // La AUSENCIA, emparejada con la presencia del campo que sí va: sin ella, «no hay input de
    // fotos» pasaría igual con la ventana vacía. La evidencia de la 237 la aporta la tienda sobre
    // un paquete que sigue en la moto; aquí el paquete YA volvió y YA se escaneó al aprobar el
    // cierre (238), así que pedir una foto sería pedir la foto de algo que no se tiene delante.
    expect(dialog.querySelector('input[type="file"]')).toBeNull();
    expect(within(dialog).queryByLabelText(/fotos/i)).toBeNull();
    expect(within(dialog).getByLabelText(TEXTO.motivoLabel)).toBeInTheDocument();
  });
});

// =================================================================================================
// R30 — se confirma: la acción se llama con lo escrito y la fila sale con su total
// =================================================================================================

describe("240/R30 — confirmar rechaza la orden y la fila sale de la lista", () => {
  it("llama a la acción con `{ordenId, motivo}` y con NADA más", async () => {
    rechazarMock.mockResolvedValue({ status: "ok" });
    const user = userEvent.setup();
    montar();
    const dialog = await abrir(user);

    await escribirYConfirmar(user, dialog);

    // `toHaveBeenCalledWith` es igualdad EXACTA del argumento: si el día de mañana la ventana
    // colara una evidencia, una fecha o el actor, esto cae. Y el `ordenId` es el de la fila
    // pulsada, no el de la otra orden de la página.
    await waitFor(() =>
      expect(rechazarMock).toHaveBeenCalledWith({ ordenId: "o1", motivo: MOTIVO }),
    );
    expect(rechazarMock).toHaveBeenCalledTimes(1);
    // Y NO se llamó a la otra transición desde el mismo estado.
    expect(reprogramarMock).not.toHaveBeenCalled();
  });

  it("avisa a dónde va el paquete, la fila sale y el total baja", async () => {
    rechazarMock.mockResolvedValue({ status: "ok" });
    const user = userEvent.setup();
    montar();
    // El total ANTES, para que el «bajó» sea una medida y no una impresión.
    expect(screen.getByText("1-2 de 2")).toBeInTheDocument();
    const dialog = await abrir(user);

    await escribirYConfirmar(user, dialog);

    // D10: el éxito dice a dónde va la mercadería. Sin esa frase, la fila desaparece de la pantalla
    // y nada explica qué pasó con el paquete.
    await waitFor(() => expect(successMock).toHaveBeenCalledWith(TEXTO.exito));
    // La fila rechazada sale…
    await waitFor(() => expect(screen.queryByText("Ana Cliente")).toBeNull());
    // …y la OTRA se queda: el par que convierte «desapareció» en «desapareció la correcta».
    expect(screen.getAllByText("Beto Cliente").length).toBeGreaterThan(0);
    // Y el total lo refleja (R30). Con dos órdenes, «1-1 de 1» sólo se puede leer si bajó de 2 a 1.
    expect(screen.getByText("1-1 de 1")).toBeInTheDocument();
    expect(errorMock).not.toHaveBeenCalled();
    expect(warningMock).not.toHaveBeenCalled();
  });

  it("la ventana se cierra tras confirmar (no invita a un segundo cobro)", async () => {
    rechazarMock.mockResolvedValue({ status: "ok" });
    const user = userEvent.setup();
    montar();
    const dialog = await abrir(user);

    await escribirYConfirmar(user, dialog);

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // El rechazo es idempotente en el servidor (la guarda del `updateMany`), pero una ventana que
    // se queda abierta invita a un segundo clic que en el mejor caso devuelve `conflict` y en el
    // peor confunde a quien lo pulsa.
    expect(rechazarMock).toHaveBeenCalledTimes(1);
  });
});

// =================================================================================================
// R31 — la carrera perdida: no se afirma que rechazó
// =================================================================================================

describe("240/R31 — con `conflict` la pantalla NO afirma que rechazó", () => {
  it("dice qué ocurrió, no lo celebra, y RELEE la página", async () => {
    // La carrera real: el cron de plazo vencido escaló la orden —o la bodega la recuperó— entre que
    // la tienda abrió la ventana y pulsó. La guarda del `updateMany` del repositorio devolvió
    // `count = 0`, así que NO se creó ninguna gestión y NO se cobró nada.
    rechazarMock.mockResolvedValue({
      status: "conflict",
      motivo: "la orden ya no esta en devuelta",
    });
    listarMock.mockResolvedValue({
      status: "ok",
      items: [novedad({ id: "o2", numGuia: 777, destinatario: "Beto Cliente" })],
      total: 1,
      page: 1,
      pageSize: 10,
    });
    const user = userEvent.setup();
    montar();
    const dialog = await abrir(user);

    await escribirYConfirmar(user, dialog);

    await waitFor(() => expect(warningMock).toHaveBeenCalledWith(TEXTO.conflicto));
    // Ni éxito ni error: el desenlace es otro y se dice por su propio canal.
    expect(successMock).not.toHaveBeenCalled();
    expect(successMock).not.toHaveBeenCalledWith(TEXTO.exito);
    // Y la lista se relee: la fila desaparece —o se queda— POR EL DATO, no por optimismo de
    // cliente. Es literalmente la lección de 236/D8 sobre esta misma card.
    await waitFor(() => expect(listarMock).toHaveBeenCalledWith({ page: 1 }));
  });

  it("el texto es el de la PANTALLA, no la cadena técnica que devuelve el servicio", async () => {
    rechazarMock.mockResolvedValue({
      status: "conflict",
      motivo: "la orden no esta en devuelta (estado actual: rechazada)",
    });
    listarMock.mockResolvedValue({
      status: "ok",
      items: [],
      total: 0,
      page: 1,
      pageSize: 10,
    });
    const user = userEvent.setup();
    montar();
    const dialog = await abrir(user);

    await escribirYConfirmar(user, dialog);

    await waitFor(() => expect(warningMock).toHaveBeenCalled());
    // El `motivo` del servicio está pensado para un registro: sin tildes y con el nombre INTERNO
    // del estado dentro. Mostrárselo a la tienda sería enseñarle el vocabulario de la base de
    // datos. (En la 237 sí se muestra el del servidor, porque allí lo redacta el servidor para la
    // pantalla; aquí no.)
    expect(warningMock).toHaveBeenCalledWith(TEXTO.conflicto);
    expect(warningMock).not.toHaveBeenCalledWith(
      "la orden no esta en devuelta (estado actual: rechazada)",
    );
  });
});

// =================================================================================================
// Los otros desenlaces, y el camino que NO dispara nada
// =================================================================================================

describe("240 — los desenlaces que no mueven nada", () => {
  it("`forbidden` avisa con un texto opaco y NO relee la página", async () => {
    rechazarMock.mockResolvedValue({ status: "forbidden" });
    const user = userEvent.setup();
    montar();
    const dialog = await abrir(user);

    await escribirYConfirmar(user, dialog);

    await waitFor(() => expect(errorMock).toHaveBeenCalledWith(TEXTO.forbidden));
    // El borde no dice si la orden existe, en qué estado está ni de quién es —es lo que impide
    // usarlo como oráculo de órdenes ajenas—, así que adivinar un motivo concreto aquí sería
    // inventarlo. Y como no cambió nada, releer la página sería ruido.
    expect(listarMock).not.toHaveBeenCalled();
    expect(successMock).not.toHaveBeenCalled();
    // La fila sigue donde estaba: no se movió nada.
    expect(screen.getAllByText("Ana Cliente").length).toBeGreaterThan(0);
  });

  it("cerrar la ventana sin confirmar NO llama a la acción y deja la lista intacta", async () => {
    const user = userEvent.setup();
    montar();
    const dialog = await abrir(user);

    // Se escribe el motivo ANTES de cancelar: así el caso también cubre el arrepentimiento con el
    // formulario ya completo, que es el que de verdad ocurre.
    await user.type(within(dialog).getByLabelText(TEXTO.motivoLabel), MOTIVO);
    await user.click(within(dialog).getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(rechazarMock).not.toHaveBeenCalled();
    // CONTROL POSITIVO: la lista sigue entera y con su total. Sin él, «no se llamó a la acción»
    // pasaría igual si la pantalla se hubiera desmontado.
    expect(screen.getAllByText("Ana Cliente").length).toBeGreaterThan(0);
    expect(screen.getByText("1-2 de 2")).toBeInTheDocument();
  });

  it("y el motivo arranca VACÍO en cada apertura (no hereda el de la orden anterior)", async () => {
    const user = userEvent.setup();
    montar();

    const primera = await abrir(user);
    await user.type(within(primera).getByLabelText(TEXTO.motivoLabel), MOTIVO);
    await user.click(within(primera).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    await user.click(
      screen.getByRole("button", { name: "Rechazar la orden de Beto Cliente" }),
    );
    const segunda = await screen.findByRole("dialog");

    // El `key={orden.id}` del montaje condicional es lo que lo garantiza. Un motivo heredado
    // acabaría en la gestión de otra orden, explicando un cobro que no le corresponde — y sería la
    // única línea que alguien leería el día de la disputa.
    expect(within(segunda).getByLabelText(TEXTO.motivoLabel)).toHaveValue("");
    expect(segunda).toHaveTextContent("Beto Cliente");
  });
});
