// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  within,
  waitFor,
  cleanup,
  fireEvent,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { NovedadesModule } from "@/app/(app)/novedades/_components/NovedadesModule";
import { listarAyudaTiendaAction, listarNovedadesAction } from "@/lib/actions/novedades";
import { habilitarNovedad } from "@/lib/actions/habilitar-novedad";
import { registrarIntentoContactoOrden } from "@/lib/actions/orden-ayuda";
import { gestionarDesdeAyuda } from "@/lib/actions/gestion-desde-ayuda";
import { rechazarNovedad, reprogramarNovedad } from "@/lib/actions/resolver-novedad";
// Feature 261 (F7, R32): el objeto de mensajes del SERVICIO. Se importa para afirmar que la frase
// que la pantalla pinta es la MISMA que el servidor emite (una regla, un texto), nunca para
// comparar el texto consigo mismo: el literal de cada caso va escrito a mano.
import { MENSAJES_GESTION_DESDE_AYUDA } from "@/lib/services/GestionDesdeAyudaService";
import { mananaCalendarioCR } from "@/lib/utils/fecha-cr";
import type { NovedadDTO } from "@/lib/types/novedad";

// Feature 87 (T14) — modulo cliente de `/novedades`. Cubre R9 (fila con guia/destinatario/
// causa/contacto + placeholder si numGuia null), R10 (estado vacio), R11 (label ES, no slug)
// y R22 (Pagination con total/page). Se mockea la Server Action (re-fetch) y el toast.
// 2026-08-14: el módulo importa TAMBIÉN la lectura del listado completo (la que alimenta la
// descarga). Un mock de módulo que no la declare no es un mock incompleto: vitest lanza al
// resolver el import, así que el archivo entero moriría antes del primer caso.
// Feature 236 (T4.2): el módulo importa las CUATRO lecturas (una pareja por grupo) y elige la del
// suyo con `RECURSOS_POR_GRUPO`. El mock las declara todas por el mismo motivo que arriba: vitest
// lanza al resolver el import, así que una que faltara mataría el archivo entero antes del primer
// caso — no dejaría un caso rojo, dejaría cero casos.
vi.mock("@/lib/actions/novedades", () => ({
  listarNovedadesAction: vi.fn(),
  listarNovedadesCompletoAction: vi.fn(),
  listarAyudaTiendaAction: vi.fn(),
  listarAyudaTiendaCompletoAction: vi.fn(),
}));

// Feature 100 (T3.1/T3.2) — la acción "Reprogramar" ejecuta la reprogramación vía
// esta Server Action; se mockea para verificar la invocación con la fecha elegida.
// Feature 240 (T5.3): `rechazarNovedad` entra en ESTE mismo mock y no en otro. No es cosmetica:
// `RechazarNovedadModal` la importa de este modulo, y un mock que no la declare no deja un caso
// rojo — vitest lanza al resolver el import y el archivo entero muere antes del primer caso.
vi.mock("@/lib/actions/resolver-novedad", () => ({
  reprogramarNovedad: vi.fn(),
  rechazarNovedad: vi.fn(),
}));

// Pedido humano 2026-08-18 — sobre una orden con ayuda pedida el módulo monta también
// «+1 intento de contacto», que llama a su propia Server Action. Se mockea el MÓDULO ENTERO
// (las tres): un mock parcial no existe, y sin las otras dos el import moriría al resolverse.
// Pedido humano 2026-08-18 — «Habilitar» dejó de ser maqueta: publica la nota y apaga las dos
// banderas de novedad de la orden. Se mockea su Server Action para afirmar la invocación.
vi.mock("@/lib/actions/habilitar-novedad", () => ({
  habilitarNovedad: vi.fn(),
}));

vi.mock("@/lib/actions/orden-ayuda", () => ({
  solicitarAyudaOrden: vi.fn(),
  recuperarOrdenAyuda: vi.fn(),
  registrarIntentoContactoOrden: vi.fn(),
}));

// Feature 237 (T7.3) — la Server Action que dispara la ventana «Resolver la orden por tu cuenta».
// Se mockea por el mismo motivo que las otras: importarla de verdad arrastraria Prisma y Supabase
// Storage a jsdom, y el archivo entero moriria al resolver el import, no en un caso rojo.
vi.mock("@/lib/actions/gestion-desde-ayuda", () => ({
  gestionarDesdeAyuda: vi.fn(),
}));

const reprogramarMock = vi.mocked(reprogramarNovedad);
const rechazarMock = vi.mocked(rechazarNovedad);
const habilitarMock = vi.mocked(habilitarNovedad);
const intentoContactoMock = vi.mocked(registrarIntentoContactoOrden);
const gestionarDesdeAyudaMock = vi.mocked(gestionarDesdeAyuda);
/** La relectura de la PESTAÑA DE AYUDA: es la que la 237 dispara tras resolver (R27). */
const listarAyudaMock = vi.mocked(listarAyudaTiendaAction);
/** El re-fetch de página (R22). Sirve de anti-vacío: conmutar de vista NO debe invocarlo. */
const listarNovedadesMock = vi.mocked(listarNovedadesAction);

const { successMock, errorMock, infoMock, warningMock } = vi.hoisted(() => ({
  successMock: vi.fn(),
  errorMock: vi.fn(),
  // ⚠️ FEATURE 240 (T5.4, 2026-08-20) — EL CANAL `info` SE QUEDÓ SIN USUARIOS EN ESTE MÓDULO.
  //
  // **Lo que decía este comentario hasta hoy:** «2026-08-12: el canal `info` deja de ser un
  // `vi.fn()` anónimo porque los dos botones de MAQUETA ("Habilitar", "Rechazar") avisan por él y
  // hay que poder afirmarlo». «Habilitar» dejó de ser maqueta el 2026-08-18 y «Rechazar» hoy, así
  // que ya no queda ni un `toast.info` en `NovedadesModule`.
  //
  // **Y por eso sigue con nombre, en vez de volver a ser anónimo:** ahora sirve para lo contrario
  // —afirmar que NADIE avisa por él—, que es la aserción que se pondría roja si alguien repusiera
  // un aviso de «esto todavía no está disponible» en lugar de cablear la operación.
  infoMock: vi.fn(),
  // Feature 236 (D8): tampoco `warning`. Es el canal por el que la pantalla dice que la nota se
  // publicó pero la orden NO volvió a la ruta, y un `vi.fn()` anónimo no deja leer ese texto.
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

// 2026-08-13 (pedido humano) — LA FÁBRICA TRAE LA ORDEN ENTERA. `NovedadDTO` pasó a EXTENDER
// `MiAsignacionDTO`, así que aquí ya no hay ocho campos sino los de una orden de verdad: es
// el mismo contrato que consume la card del mensajero. Los valores son realistas y DISTINTOS
// entre sí a propósito (provincia ≠ cantón ≠ distrito): si dos coincidieran, un test que
// afirma la línea de ubicación podría pasar midiendo el campo equivocado.
//
// `intentosEntrega` se deja FUERA a propósito: es opcional en `MiAsignacionDTO` y el caso
// "R19: sin el campo (DTO viejo) muestra 0" depende de que la fábrica no lo ponga.
//
// `numRemision` lleva un valor que NO debe verse nunca en pantalla: el identificador visible
// de esta pantalla es la GUÍA (F1.4 #1 / R9) y el adaptador sobreescribe ese slot. Que la
// remisión real esté aquí es lo que permite afirmarlo.
const novedad = (over: Partial<NovedadDTO> = {}): NovedadDTO => ({
  id: "o1",
  numGuia: 12345,
  numRemision: "REM-90210",
  estatusValue: "devuelta",
  // Pedido humano 2026-08-18: requerido en `NovedadDTO`. El default es "nadie lo ha intentado".
  intentosContacto: 0,
  mensajeroNombre: "Marta Mensajera",
  destinatario: "Ana Cliente",
  telefonoDest: "88887777",
  causa: "not_found",
  producto: PRODUCTO,
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
  // Estas órdenes no son paradas de ninguna ruta optimizada: el módulo monta la card con
  // `mostrarRuta={false}` y el DTO manda `secuenciaRuta` SIEMPRE en `null`.
  secuenciaRuta: null,
  ...over,
});

/**
 * Producto de la novedad base. Es el único cambio OBSERVABLE entre las dos cards que no
 * depende de las compuertas: sólo la MOSAICO tiene hueco para pintarlo, y en eso se apoya el
 * caso "conmutar a Detalle monta la otra card".
 *
 * 2026-08-13: dejó de ser el ancla de `conmutarA()`. Con `detalle` encendido la mosaico lo
 * pinta DOS veces —la línea compacta y el campo "Producto" del desplegable—, así que
 * afirmarlo dentro de una espera obligaba a contar apariciones, que es justo lo que no ancla
 * nada (ver el docstring de `conmutarA`). Fuera de un `waitFor` contar sigue siendo legítimo,
 * y por eso ese caso lo sigue haciendo.
 */
const PRODUCTO = "Zapatos deportivos";

/** El monto de la novedad base, tal y como `formatMonto` lo pinta (₡ + miles, sin decimales). */
const MONTO_TEXTO = "₡24.500";

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("NovedadesModule", () => {
  it("R10: lista vacia -> estado vacio, sin filas", () => {
    render(<NovedadesModule grupo="devolucion" items={[]} total={0} page={1} pageSize={10} />);

    expect(screen.getByText(/No tenés órdenes en devolución/i)).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Órdenes en devolución" })).toBeNull();
  });

  it("R9: por cada orden muestra guia, destinatario y botones de contacto", () => {
    render(
      <NovedadesModule
        grupo="devolucion"
        items={[novedad({ id: "o1", numGuia: 12345, destinatario: "Ana Cliente" })]}
        total={1}
        page={1}
        pageSize={10}
      />,
    );

    // 2026-08-13: la guía se afirma con su etiqueta completa y no con `/12345/`, porque el
    // desplegable «Ver detalle completo» pinta además el número pelado en su campo "Nº Guía".
    expect(screen.getByText("Guía 12345")).toBeInTheDocument();
    // El destinatario sale DOS veces en la mosaico (línea compacta + campo "Nombre" del
    // desplegable). Se afirma que está en las dos, que es más que lo que se afirmaba antes.
    const nombres = apariciones(cardDe("Ana Cliente"), "Ana Cliente");
    expect(nombres.compacto).toHaveLength(1);
    expect(nombres.desplegable).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "Llamar a Ana Cliente" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "WhatsApp a Ana Cliente" }),
    ).toBeInTheDocument();
  });

  it("R9: numGuia null -> placeholder legible, no rompe la fila", () => {
    render(
      <NovedadesModule
        grupo="devolucion"
        items={[novedad({ numGuia: null })]}
        total={1}
        page={1}
        pageSize={10}
      />,
    );

    expect(screen.getByText(/sin asignar/i)).toBeInTheDocument();
  });

  // 2026-08-12 (pedido humano) — la card mosaico pinta producto y peso sin compuerta. Antes
  // el adaptador los rellenaba (`""` / `null`) y se veía un icono de paquete con nada al lado
  // y un «—» de peso. Ahora el DTO trae el dato real y estas dos pruebas lo anclan.
  it("pinta el producto de la novedad junto al icono de paquete (no un hueco)", () => {
    render(
      <NovedadesModule
        grupo="devolucion"
        items={[novedad({ producto: "Licuadora Oster", peso: 2.75 })]}
        total={1}
        page={1}
        pageSize={10}
      />,
    );

    // 2026-08-13: con `detalle` encendido los dos datos salen en la línea compacta Y en el
    // desplegable. Se afirman los dos sitios en vez de uno solo.
    const card = cardDe("Ana Cliente");
    const producto = apariciones(card, "Licuadora Oster");
    expect(producto.compacto).toHaveLength(1);
    expect(producto.desplegable).toHaveLength(1);
    const peso = apariciones(card, "2.75 kg");
    expect(peso.compacto).toHaveLength(1);
    expect(peso.desplegable).toHaveLength(1);
  });

  it("peso null (orden sin peso registrado) -> raya, y el producto SIGUE visible", () => {
    render(
      <NovedadesModule
        grupo="devolucion"
        items={[novedad({ producto: "Caja sellada", peso: null })]}
        total={1}
        page={1}
        pageSize={10}
      />,
    );

    // `formatPeso(null)` pinta la raya larga: ausencia honesta, no un "0 kg" inventado.
    // El resto de campos de esta novedad SÍ tienen dato, así que la raya sale exactamente
    // dos veces —una por sitio— y no se confunde con la de otro campo vacío.
    const card = cardDe("Ana Cliente");
    const raya = apariciones(card, "—");
    expect(raya.compacto).toHaveLength(1);
    expect(raya.desplegable).toHaveLength(1);
    expect(within(card).queryByText("0 kg")).toBeNull();
    const producto = apariciones(card, "Caja sellada");
    expect(producto.compacto).toHaveLength(1);
    expect(producto.desplegable).toHaveLength(1);
  });

  it("R11: muestra la etiqueta ES de la causa, nunca el slug crudo del enum", () => {
    render(
      <NovedadesModule
        grupo="devolucion"
        items={[novedad({ causa: "not_found" })]}
        total={1}
        page={1}
        pageSize={10}
      />,
    );

    expect(screen.getByText("Cliente no localizado")).toBeInTheDocument();
    expect(screen.queryByText("not_found")).toBeNull();
  });

  it("R7: causa null -> 'Sin causa registrada'", () => {
    render(
      <NovedadesModule
        grupo="devolucion"
        items={[novedad({ causa: null })]}
        total={1}
        page={1}
        pageSize={10}
      />,
    );

    expect(screen.getByText("Sin causa registrada")).toBeInTheDocument();
  });

  // --- FICHA 296 (2026-08-27): A QUIÉN PREGUNTARLE ---
  //
  // El defecto que cierran estos casos es literal: la tienda veía una orden pidiendo ayuda y la
  // card no nombraba a NADIE. El dato es campo propio de `NovedadDTO` y el módulo lo baja por la
  // prop `mensajero` de la card, NO dentro de `orden` — el adaptador lo saca del spread a
  // propósito, porque `orden` es un `MiAsignacionDTO` y ese contrato es el del portal del
  // mensajero.
  //
  // Los textos se afirman con su literal ESCRITO A MANO y nunca contra `textoMensajero`, que es
  // la función que los produce: comparar un texto con su propia fuente está siempre verde.
  //
  // Que la MOSAICO lo pinte una vez y el desplegable ninguna no es un detalle cosmético: dice
  // que el dato vive en el bloque de campos de la card y que `AsignacionDetalle` —que es del
  // portal del mensajero— sigue sin saber nada de él.

  it("296: en el grupo de AYUDA la card dice quién lleva la orden", () => {
    render(
      <NovedadesModule
        grupo="ayuda"
        items={[
          novedad({
            estatusValue: "ayuda_tienda",
            causa: null,
            mensajeroNombre: "Marta Mensajera",
          }),
        ]}
        total={1}
        page={1}
        pageSize={10}
      />,
    );

    const card = cardDe("Ana Cliente");
    const nombre = apariciones(card, "Mensajero: Marta Mensajera");
    expect(nombre.compacto).toHaveLength(1);
    expect(nombre.desplegable).toHaveLength(0);
    // SÓLO EL NOMBRE: el teléfono del mensajero es PII de un tercero y la vía para hablar con
    // él es el hilo de notas. Ninguna acción de contacto puede apuntarle. Los botones de
    // contacto que la card SÍ tiene son los del DESTINATARIO, y siguen en su sitio (control
    // positivo: sin él esta ausencia también pasaría con la card sin montar).
    expect(screen.queryByRole("button", { name: /Marta Mensajera/ })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Llamar a Ana Cliente" }),
    ).toBeInTheDocument();
  });

  it("296: en el grupo de DEVOLUCIÓN también — es quien trae el paquete de vuelta", () => {
    render(
      <NovedadesModule
        grupo="devolucion"
        items={[
          novedad({ estatusValue: "devuelta", mensajeroNombre: "Marta Mensajera" }),
        ]}
        total={1}
        page={1}
        pageSize={10}
      />,
    );

    const nombre = apariciones(cardDe("Ana Cliente"), "Mensajero: Marta Mensajera");
    expect(nombre.compacto).toHaveLength(1);
    expect(nombre.desplegable).toHaveLength(0);
  });

  it("296: sin mensajero asignado lo dice en palabras, nunca «null» ni un hueco", () => {
    render(
      <NovedadesModule
        grupo="ayuda"
        items={[
          novedad({ estatusValue: "ayuda_tienda", causa: null, mensajeroNombre: null }),
        ]}
        total={1}
        page={1}
        pageSize={10}
      />,
    );

    const card = cardDe("Ana Cliente");
    const ausencia = apariciones(card, "Mensajero: sin asignar");
    expect(ausencia.compacto).toHaveLength(1);
    // Ni el valor crudo, ni la etiqueta sola colgando sin valor.
    expect(within(card).queryByText(/null/i)).toBeNull();
    expect(within(card).queryByText("Mensajero:")).toBeNull();
  });

  it("296: el dato viaja también a la vista de DETALLE, no sólo a la mosaico", async () => {
    const user = userEvent.setup();
    render(
      <NovedadesModule
        grupo="ayuda"
        items={[
          novedad({
            estatusValue: "ayuda_tienda",
            causa: null,
            mensajeroNombre: "Marta Mensajera",
          }),
        ]}
        total={1}
        page={1}
        pageSize={10}
      />,
    );

    // Las tres cards POS son PARALELAS, no variantes: conmutar monta OTRO componente, así que
    // un dato presente en una no está presente en la otra por herencia.
    await conmutarA(user, "Detalle");

    expect(
      within(cardDe("Ana Cliente")).getByText("Mensajero: Marta Mensajera"),
    ).toBeInTheDocument();
  });

  // --- Pedido humano 2026-08-18: la solicitud de AYUDA ---
  // Esta pantalla dejó de ser «las devueltas de mi tienda» para ser «lo que mi tienda tiene que
  // mirar»: entran también órdenes sobre las que el mensajero pidió ayuda. El badge es lo único
  // que distingue en la lista una cosa de la otra.
  //
  // FEATURE 235 (T5.4, 2026-08-19) — los fixtures pasan de `ayuda: true` a
  // `estatusValue: "ayuda_tienda"`. NO es una reescritura de los casos: el comportamiento visible
  // que afirman es EXACTAMENTE el mismo, lo que cambia es de dónde sale la verdad. La bandera se
  // retiró con su columna y el estatus la sustituye.
  //
  // ⚠️ FEATURE 236 (T5.4, R26 — D6 firmada por el humano el 2026-08-19): los DOS casos del badge
  // cambian de aserción, y hay que decir por qué en vez de tocarlos en silencio.
  //
  //   · el texto pasa de «Ayuda solicitada» a **«Esperando tu respuesta»**: dentro de una pestaña
  //     que ya se llama «Ayuda solicitada», repetirlo en cada card no informa;
  //   · y la rama «Ayuda · \<causa\>» DESAPARECE. Esa causa venía de una devolución ANTERIOR ya
  //     deshecha y no describe por qué la orden está en la pantalla — R26 prohíbe atribuírsela,
  //     mostrarla **y anunciar su ausencia**. El caso que afirmaba «dice las DOS cosas» pasa a
  //     afirmar lo contrario, que es lo que se decidió: NINGUNA causa sobre una orden en ayuda.
  //
  // Los fixtures se montan ya bajo `grupo="ayuda"`, que es la pestaña donde el servidor las lista
  // desde esta ficha. El chip NO lo decide esa prop: lo decide el grupo de la FILA (ver el caso
  // «el módulo pinta lo que recibe» más abajo, R2).

  it("en el grupo de ayuda el chip dice «Esperando tu respuesta», no «Sin causa registrada»", () => {
    render(
      <NovedadesModule
        grupo="ayuda"
        items={[novedad({ causa: null, estatusValue: "ayuda_tienda" })]}
        total={1}
        page={1}
        pageSize={10}
      />,
    );

    expect(screen.getByText("Esperando tu respuesta")).toBeInTheDocument();
    // No hay devolución de la que registrar causa: anunciar su ausencia señalaría un hueco
    // que no existe (R26).
    expect(screen.queryByText("Sin causa registrada")).toBeNull();
  });

  it("R26: con una causa ARRASTRADA, sobre una orden en ayuda no aparece ninguna causa", () => {
    render(
      <NovedadesModule
        grupo="ayuda"
        items={[novedad({ causa: "not_found", estatusValue: "ayuda_tienda" })]}
        total={1}
        page={1}
        pageSize={10}
      />,
    );

    // El chip es el suyo…
    expect(screen.getByText("Esperando tu respuesta")).toBeInTheDocument();
    // …y la causa que el DTO trae NO se pinta en ninguna parte: ni sola, ni pegada al chip.
    expect(screen.queryByText("Cliente no localizado")).toBeNull();
    expect(screen.queryByText("Ayuda · Cliente no localizado")).toBeNull();
    expect(screen.queryByText("Sin causa registrada")).toBeNull();
    // CONTROL POSITIVO de la aserción de arriba: la MISMA causa, sobre una orden del grupo de
    // devolución, SÍ se lee. Sin esto, las tres negativas pasarían igual con la card sin montar.
    cleanup();
    render(
      <NovedadesModule
        grupo="devolucion"
        items={[novedad({ causa: "not_found", estatusValue: "devuelta" })]}
        total={1}
        page={1}
        pageSize={10}
      />,
    );
    expect(screen.getByText("Cliente no localizado")).toBeInTheDocument();
  });

  // ⚠️ FEATURE 237 (T7.1, 2026-08-20) — ESTE CASO CAMBIA DE SENTIDO A PROPÓSITO. Hasta hoy decía
  // «sobre una orden que NO está devuelta no se ofrecen las acciones de devolución» y afirmaba que
  // en la ayuda NO había «Reprogramar» ni «Rechazar», porque las dos de entonces presuponían una
  // devolución que sobre una orden en la moto no existe. Lo que cambió es que la 237 declaró las
  // dos aristas que faltaban desde `ayuda_tienda` y su productor: ahora los dos botones existen,
  // pero son OTROS —claves propias, otro servicio, otra ventana— y por eso el caso se reescribe en
  // vez de borrarse. La razón vieja sigue siendo cierta de las acciones de la DEVOLUCIÓN.
  it("237: la orden en ayuda ofrece SUS dos desenlaces, que no son los de la devolución", async () => {
    const user = userEvent.setup();
    render(
      <NovedadesModule
        grupo="ayuda"
        items={[novedad({ causa: null, estatusValue: "ayuda_tienda" })]}
        total={1}
        page={1}
        pageSize={10}
      />,
    );

    // Existen los dos, con los rótulos de D7.
    expect(
      screen.getByRole("button", { name: /^Reprogramar la orden/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Rechazar la orden/ })).toBeInTheDocument();
    // «Habilitar» SÍ seguía: es el desenlace de la solicitud de ayuda del lado de la tienda
    // (pedido humano 2026-08-18), y por eso es la única que nunca estuvo atada a `devuelta`.
    expect(
      screen.getByRole("button", { name: /^Habilitar la orden/ }),
    ).toBeInTheDocument();
    // Lo que SÍ sigue: el contacto y el registro de intentos.
    expect(
      screen.getByRole("button", { name: /^Registrar un intento de contacto/ }),
    ).toBeInTheDocument();
    // Feature 236 (R27/R22): la conversación, que es por donde la tienda lee el motivo con el que
    // el mensajero pidió la ayuda. Estuvo retirada desde el 2026-08-18.
    expect(
      screen.getByRole("button", { name: /^Abrir la conversación de la orden/ }),
    ).toBeInTheDocument();

    // Y «Reprogramar» lleva a la ventana de la 237, NO al modal de reprogramación de la feature
    // 100: se distingue por el aviso del precio, que aquél no tiene y no puede tener. Se abre AL
    // FINAL porque el diálogo es modal y esconde del árbol de accesibilidad todo lo de detrás.
    await user.click(screen.getByRole("button", { name: /^Reprogramar la orden/ }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Resolver la orden por tu cuenta");
    expect(dialog).toHaveTextContent("mueve el dinero igual");
    expect(reprogramarMock).not.toHaveBeenCalled();
  });

  it("R21: sobre un estatus que no es de ningún grupo sólo quedan los de contacto", () => {
    render(
      <NovedadesModule
        grupo="ayuda"
        items={[novedad({ causa: null, estatusValue: "en_reparto" })]}
        total={1}
        page={1}
        pageSize={10}
      />,
    );

    // La excepción es el estatus de AYUDA, no «cualquier orden en reparto»: sin solicitud viva no
    // hay nada que habilitar. Es el CASO NEGATIVO de la traducción literal de la 235, y desde la
    // 236 es además R21: `grupoDeEstatus` devuelve `null` y no se ofrece NINGUNA acción que
    // resuelva la orden. Nótese que la pestaña montada es la de AYUDA: el juego de botones lo
    // decide el estado de la FILA, no la pestaña.
    expect(screen.queryByRole("button", { name: /^Habilitar la orden/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Abrir la conversación de la orden/ })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /^Registrar un intento de contacto/ }),
    ).toBeNull();
    // CONTROL POSITIVO: la card SÍ está montada, y el contacto —que no resuelve nada— sigue ahí.
    expect(screen.getByRole("button", { name: "Llamar a Ana Cliente" })).toBeInTheDocument();
  });

  it("sobre una devuelta, las acciones de devolución siguen ofreciéndose", () => {
    render(
      <NovedadesModule
        grupo="devolucion"
        items={[novedad()]}
        total={1}
        page={1}
        pageSize={10}
      />,
    );

    expect(screen.getByRole("button", { name: /^Reprogramar la orden/ })).toBeInTheDocument();
  });

  // --- Pedido humano 2026-08-18: «+1 intento de contacto» y su contador ---

  it("sobre una devolución corriente NO aparece: el contador es para las órdenes atascadas", () => {
    render(<NovedadesModule grupo="devolucion" items={[novedad()]} total={1} page={1} pageSize={10} />);

    expect(
      screen.queryByRole("button", { name: /^Registrar un intento de contacto/ }),
    ).toBeNull();
  });

  it("con ayuda pedida aparece el botón y el contador, con el `0` incluido", () => {
    render(
      <NovedadesModule
        grupo="ayuda"
        items={[novedad({ intentosContacto: 0, estatusValue: "ayuda_tienda" })]}
        total={1}
        page={1}
        pageSize={10}
      />,
    );

    expect(
      screen.getByRole("button", {
        name: "Registrar un intento de contacto con la orden de Ana Cliente",
      }),
    ).toBeInTheDocument();
    // «Todavía no lo intentó nadie» es el dato que hace falta para decidir si intentarlo ahora.
    expect(screen.getByText("Intentos de contacto:").parentElement?.textContent).toContain("0");
  });

  it("el contador arranca en el valor del servidor, no en cero", () => {
    render(
      <NovedadesModule
        grupo="ayuda"
        items={[novedad({ intentosContacto: 4, estatusValue: "ayuda_tienda" })]}
        total={1}
        page={1}
        pageSize={10}
      />,
    );

    expect(screen.getByText("Intentos de contacto:").parentElement?.textContent).toContain("4");
  });

  it("al pulsar registra el intento y pinta EL VALOR DEL SERVIDOR, no el suyo", async () => {
    const user = userEvent.setup();
    // El servidor devuelve 9 y no 3: si la UI pintara su propia suma (2+1), esto lo caza. Con dos
    // personas de la misma tienda pulsando, el número bueno es siempre el de la base.
    intentoContactoMock.mockResolvedValue({ status: "ok", intentosContacto: 9 });
    render(
      <NovedadesModule
        grupo="ayuda"
        items={[novedad({ intentosContacto: 2, estatusValue: "ayuda_tienda" })]}
        total={1}
        page={1}
        pageSize={10}
      />,
    );

    await user.click(
      screen.getByRole("button", {
        name: "Registrar un intento de contacto con la orden de Ana Cliente",
      }),
    );

    expect(intentoContactoMock).toHaveBeenCalledWith({ ordenId: "o1" });
    await waitFor(() =>
      expect(screen.getByText("Intentos de contacto:").parentElement?.textContent).toContain("9"),
    );
  });

  it("si el servidor rechaza, el número VUELVE ATRÁS y se avisa", async () => {
    const user = userEvent.setup();
    intentoContactoMock.mockResolvedValue({ status: "forbidden" });
    render(
      <NovedadesModule
        grupo="ayuda"
        items={[novedad({ intentosContacto: 2, estatusValue: "ayuda_tienda" })]}
        total={1}
        page={1}
        pageSize={10}
      />,
    );

    await user.click(
      screen.getByRole("button", {
        name: "Registrar un intento de contacto con la orden de Ana Cliente",
      }),
    );

    // El optimismo no puede dejar el contador afirmando algo que no se guardó.
    await waitFor(() => expect(errorMock).toHaveBeenCalled());
    expect(screen.getByText("Intentos de contacto:").parentElement?.textContent).toContain("2");
  });

  it("R22: renderiza la Pagination con el total y la pagina recibidos", () => {
    render(
      <NovedadesModule
        grupo="devolucion"
        items={[novedad()]}
        total={25}
        page={2}
        pageSize={10}
      />,
    );

    // total 25 / pageSize 10: la pagina 2 cubre los elementos 11 al 20.
    expect(
      screen.getByRole("navigation", { name: "Paginación de novedades" }),
    ).toBeInTheDocument();
    expect(screen.getByText("11-20 de 25")).toBeInTheDocument();
  });

  // ---------- Feature 100 (T3.1/T3.2) — Reprogramar ----------

  it("R1: cada orden ofrece la acción 'Reprogramar' junto a los botones de contacto", () => {
    render(
      <NovedadesModule
        grupo="devolucion"
        items={[novedad({ id: "o1", destinatario: "Ana Cliente" })]}
        total={1}
        page={1}
        pageSize={10}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Reprogramar la orden de Ana Cliente" }),
    ).toBeInTheDocument();
  });

  it("T3.1: al confirmar llama reprogramarNovedad con el ordenId y la fecha (mañana por default); en ok quita la fila", async () => {
    const user = userEvent.setup();
    reprogramarMock.mockResolvedValue({ status: "ok" });
    render(
      <NovedadesModule
        grupo="devolucion"
        items={[novedad({ id: "o1", destinatario: "Ana Cliente" })]}
        total={1}
        page={1}
        pageSize={10}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Reprogramar la orden de Ana Cliente" }),
    );

    // El modal abre con el input de fecha (default = mañana CR).
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Nueva fecha")).toHaveValue(
      mananaCalendarioCR(),
    );

    await user.click(
      within(dialog).getByRole("button", { name: "Reprogramar" }),
    );

    expect(reprogramarMock).toHaveBeenCalledTimes(1);
    expect(reprogramarMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ordenId: "o1",
        fechaReprogramacion: mananaCalendarioCR(),
      }),
    );

    // En ok: la fila sale de la lista (queda el estado vacío) + toast de éxito.
    await waitFor(() =>
      expect(
        screen.getByText(/No tenés órdenes en devolución/i),
      ).toBeInTheDocument(),
    );
    expect(successMock).toHaveBeenCalledWith("Orden reprogramada.");
    expect(errorMock).not.toHaveBeenCalled();
  });

  it("T3.1: el motivo escrito (opcional) viaja en el payload", async () => {
    const user = userEvent.setup();
    reprogramarMock.mockResolvedValue({ status: "ok" });
    render(
      <NovedadesModule
        grupo="devolucion"
        items={[novedad({ id: "o1", destinatario: "Ana Cliente" })]}
        total={1}
        page={1}
        pageSize={10}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Reprogramar la orden de Ana Cliente" }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/Motivo/i), "Cliente pidió otro día");
    await user.click(within(dialog).getByRole("button", { name: "Reprogramar" }));

    expect(reprogramarMock).toHaveBeenCalledWith(
      expect.objectContaining({ ordenId: "o1", motivo: "Cliente pidió otro día" }),
    );
  });

  it("T3.2: status conflict -> toast de error con su mensaje y la fila NO se quita", async () => {
    const user = userEvent.setup();
    reprogramarMock.mockResolvedValue({ status: "conflict", motivo: "estado" });
    render(
      <NovedadesModule
        grupo="devolucion"
        items={[novedad({ id: "o1", destinatario: "Ana Cliente" })]}
        total={1}
        page={1}
        pageSize={10}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Reprogramar la orden de Ana Cliente" }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Reprogramar" }));

    await waitFor(() =>
      expect(errorMock).toHaveBeenCalledWith(
        "La orden ya salió de devolución. Actualizá la lista.",
      ),
    );
    // La fila sigue presente (no hubo éxito).
    // La fila sigue en pantalla. Se cuenta en vez de usar `getByText`: desde que el
    // desplegable está encendido, el destinatario aparece dos veces en la card mosaico.
    // (Y no se usa `cardDe`: con un diálogo abierto el resto del árbol queda `aria-hidden`,
    // así que la consulta por ROL no encontraría el `<article>` aunque siga ahí.)
    expect(screen.getAllByText("Ana Cliente").length).toBeGreaterThan(0);
    expect(successMock).not.toHaveBeenCalled();
  });

  it("T3.2: status forbidden -> toast de error con su propio mensaje (no genérico)", async () => {
    const user = userEvent.setup();
    reprogramarMock.mockResolvedValue({ status: "forbidden" });
    render(
      <NovedadesModule
        grupo="devolucion"
        items={[novedad({ id: "o1", destinatario: "Ana Cliente" })]}
        total={1}
        page={1}
        pageSize={10}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Reprogramar la orden de Ana Cliente" }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Reprogramar" }));

    await waitFor(() =>
      expect(errorMock).toHaveBeenCalledWith(
        "No tenés permiso para reprogramar esta orden.",
      ),
    );
  });
});

/** La card de una novedad: `<article>` con el nombre accesible que ella misma compone. */
function cardDe(nombre: string): HTMLElement {
  return screen.getByRole("article", {
    name: new RegExp(`Orden .*· ${nombre}`),
  });
}

/**
 * El desplegable «Ver detalle completo» de una card, o `null` si esa vista NO lo tiene.
 *
 * Se ancla al `data-slot` del `Collapsible` (mismo patrón que `RecogerModule.test.tsx`), y
 * devolver `null` no es un descuido: es el hecho central de este archivo desde el 2026-08-13.
 * Sólo `PosOrderCardMosaico` monta el desplegable; en `PosOrderCardDetalle` la compuerta
 * `detalle` es INERTE (esa card ni siquiera la desestructura), así que ahí no hay nada que
 * abrir por mucho que `SECCIONES_NOVEDAD` la encienda.
 */
function desplegableDe(card: HTMLElement): HTMLElement | null {
  const trigger = within(card).queryByText("Ver detalle completo");
  return trigger === null
    ? null
    : (trigger.closest("[data-slot='collapsible']") as HTMLElement);
}

/**
 * Reparte las apariciones de un texto dentro de la card entre la parte SIEMPRE VISIBLE y el
 * desplegable.
 *
 * 2026-08-13: desde que `detalle` está encendido, la mosaico repite varios datos —producto,
 * destinatario, peso, monto— en los dos sitios, y un `getByText` pelado fallaría por
 * "multiple elements", midiendo la duplicación en vez de la presencia. Separarlos permite
 * además afirmar EN CUÁL de los dos vive cada dato, que es lo que de verdad interesa.
 */
function apariciones(
  card: HTMLElement,
  texto: string | RegExp,
): { compacto: HTMLElement[]; desplegable: HTMLElement[] } {
  const panel = desplegableDe(card);
  const nodos = within(card).queryAllByText(texto);
  return {
    compacto: nodos.filter((n) => panel === null || !panel.contains(n)),
    desplegable: panel === null ? [] : nodos.filter((n) => panel.contains(n)),
  };
}

/**
 * Conmuta a la vista pedida y ESPERA a que esté montada.
 *
 * No basta con esperar al `aria-pressed` del conmutador: ése se marca al instante
 * (`vistaPedida`, para que el control no parezca muerto) mientras `useTransicionVista`
 * sostiene la card VIEJA durante el tramo de salida. Si se afirmara justo después, la mitad
 * de los casos medirían la vista anterior y pasarían por el motivo equivocado.
 *
 * EL ANCLA ES EL DESPLEGABLE «Ver detalle completo», y desde el 2026-08-13 ya no el
 * producto. El producto servía mientras la mosaico lo pintaba UNA vez; con `detalle`
 * encendido lo repite (línea compacta + campo del desplegable), así que afirmarlo obligaba a
 * esperar por un NÚMERO de apariciones. Un `waitFor` anclado sólo a un conteo no dice QUÉ
 * hay en pantalla, sólo CUÁNTAS cosas hay — y el estado transitorio también tiene un número,
 * de modo que la espera se satisface a media conmutación y sale antes de tiempo. Es lo que
 * prohíbe `tests/unit/guards/ancla-de-carga.guardia.test.ts`, y con razón.
 *
 * El desplegable, en cambio, se afirma con una consulta SINGULAR y sirve en las DOS
 * direcciones: sólo `PosOrderCardMosaico` lo monta —`PosOrderCardDetalle` ni siquiera
 * desestructura la compuerta `detalle`, ver el caso "la compuerta `detalle` es INERTE"—, así
 * que su PRESENCIA dice «ya está montada la mosaico» y su AUSENCIA «ya está la de fila».
 * Ninguna de las dos ramas cuenta nada.
 *
 * Con varias órdenes en pantalla la ausencia se afirma con `queryByRole`, que lanza
 * «multiple elements» mientras siga montada la card vieja con sus N desplegables; dentro de
 * un `waitFor` eso reintenta, así que la espera NO se resuelve a media transición.
 */
async function conmutarA(
  user: ReturnType<typeof userEvent.setup>,
  vista: "Mosaico" | "Detalle",
) {
  await user.click(screen.getByRole("button", { name: vista }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: vista })).toHaveAttribute(
      "aria-pressed",
      "true",
    ),
  );
  const desplegable = { name: /Ver detalle completo/ };
  await waitFor(() => {
    if (vista === "Mosaico") {
      // `getAllByRole` lanza mientras no haya NINGUNO: la espera sigue en pie hasta que la
      // mosaico está montada de verdad.
      expect(screen.getAllByRole("button", desplegable)[0]).toBeInTheDocument();
    } else {
      expect(screen.queryByRole("button", desplegable)).not.toBeInTheDocument();
    }
  });
}

// 2026-08-12 (pedido humano) — LA FILA ES LA CARD COMPARTIDA. Cada novedad se pinta con las
// cards POS de las órdenes del mensajero y las cinco acciones de esta pantalla bajan por su
// prop `acciones`.
//
// QUÉ MIDE ESTE BLOQUE Y POR QUÉ NO SOBRA. Los casos de arriba siguen verdes tal cual —eso
// es la prueba de que lo VISIBLE no cambió— pero ninguno se pondría rojo si mañana alguien
// volviera a escribir la fila a mano en el módulo: verían la misma guía, el mismo nombre y
// los mismos botones. Lo que se afirma aquí es la ESTRUCTURA que trae la reutilización:
// que hay una card (`<article>` con su nombre accesible) dentro de cada `<li>`, que las
// acciones viven DENTRO de ella y no como hermanas sueltas, y que las secciones encendidas
// pintan el dato REAL. Sin esto, la deduplicación no tendría ningún test que la defienda.
//
// ⚠️ 2026-08-13: DESDE QUE HAY CONMUTADOR, LOS CASOS DE COMPUERTA SE EJERCEN EN LAS DOS
// VISTAS (`it.each`), y no es celo: las cards POS son implementaciones PARALELAS que sólo
// comparten props, así que una compuerta puede estar aplicada en una y no en la otra. Es el
// error exacto que documentó la feature 199 —el apartado se queda VERDE porque la única
// vista que el test ejerce sí la respeta—. Medir sólo la vista por defecto es no medir el
// conmutador.
describe("NovedadesModule — las filas son las cards POS, conmutables (2026-08-12/13)", () => {

  it.each(["Mosaico", "Detalle"] as const)(
    "vista %s: cada <li> contiene la card, y la card lleva la guía, el destinatario y la causa",
    async (vista) => {
      const user = userEvent.setup();
      render(
        <NovedadesModule
        grupo="devolucion"
          items={[novedad({ numGuia: 12345, destinatario: "Ana Cliente" })]}
          total={1}
          page={1}
          pageSize={10}
        />,
      );
      await conmutarA(user, vista);

      const card = cardDe("Ana Cliente");
      // `<ul>/<li>` en LAS DOS vistas (feature 160/R26). Las pantallas hermanas meten el
      // mosaico en un carrusel de `<div>`s; aquí no, y este `closest("li")` es lo que lo
      // impide en silencio.
      expect(card.closest("li")).not.toBeNull();
      expect(within(card).getByText("Guía 12345")).toBeInTheDocument();
      // Por cantidad: en mosaico el destinatario sale además dentro del desplegable.
      expect(apariciones(card, "Ana Cliente").compacto).toHaveLength(1);
      // La causa viaja por la prop `estado` de la card: es su badge, no una línea suelta.
      expect(within(card).getByText("Cliente no localizado")).toBeInTheDocument();
    },
  );

  it.each(["Mosaico", "Detalle"] as const)(
    "vista %s: las acciones llegan por la prop `acciones` y se pintan DENTRO de la card",
    async (vista) => {
      const user = userEvent.setup();
      render(
        <NovedadesModule
        grupo="devolucion"
          items={[novedad({ destinatario: "Ana Cliente" })]}
          total={1}
          page={1}
          pageSize={10}
        />,
      );
      await conmutarA(user, vista);

      // El anti-vacío de este caso: si las acciones se hubieran quedado fuera de la card,
      // `getByRole` seguiría encontrándolas en el documento y el test pasaría diciendo nada.
      // Por eso se buscan DENTRO del `<article>`.
      //
      // Y por eso se ejerce en las DOS vistas: el panel viaja a la card elegida, y las dos
      // aceptan `acciones` por su cuenta (no hay herencia entre ellas). Si una dejara de
      // renderizar la prop, la otra seguiría verde.
      // ⚠️ FEATURE 240 (T5.5, 2026-08-20): este censo tenía «Habilitar la orden de Ana Cliente»
      // dentro y pasa a CUATRO nombres. Es el punto 12, cerrado (R33). Actualizado a mano.
      const card = cardDe("Ana Cliente");
      for (const nombre of [
        "Llamar a Ana Cliente",
        "WhatsApp a Ana Cliente",
        "Reprogramar la orden de Ana Cliente",
        "Rechazar la orden de Ana Cliente",
      ]) {
        expect(within(card).getByRole("button", { name: nombre })).toBeInTheDocument();
      }
      // La AUSENCIA, emparejada con las cuatro presencias de arriba y DENTRO de la misma card: sin
      // ellas, «no está Habilitar» pasaría igual si la card no hubiera renderizado el panel.
      expect(
        within(card).queryByRole("button", { name: "Habilitar la orden de Ana Cliente" }),
      ).toBeNull();
    },
  );

  // ⚠️ 2026-08-20 (FEATURE 240) — LA MAQUETA SE ACABÓ, Y ESTE BLOQUE SE PUSO ROJO COMO SE PREVIÓ.
  //
  // **Lo que decía esta nota hasta hoy:** «MAQUETA DECLARADA (2026-08-12): "Habilitar" y "Rechazar"
  // (antes "Devolver") existen en la fila pero su comportamiento NO está decidido y no hay backend
  // detrás… El día que se cableen, este bloque se pone rojo — y eso es exactamente lo que tiene que
  // pasar: obligará a escribir el test de la transición real en vez de heredar el silencio».
  //
  // Eso es lo que pasó: «Habilitar» se cableó el 2026-08-18 y «Rechazar» hoy. El test de la
  // transición real vive en `tests/components/RechazarNovedad.test.tsx`; aquí queda lo que sigue
  // siendo de este archivo —que los controles son icono + nombre accesible— y el caso que afirma
  // que el aviso de «todavía no está disponible» YA NO EXISTE.
  //
  // 2026-08-12 (pedido humano): las acciones son ICONO + TOOLTIP, ya no texto.
  //
  // Lo que estos dos casos protegen es la parte que se rompe callando: al quitar el texto
  // visible, el ÚNICO nombre que le queda al botón es su `aria-label`. Si alguien lo borra
  // "porque ya está el tooltip", el control se queda sin nombre para un lector de pantalla
  // y sin nombre para una pantalla táctil (donde no hay hover que revele nada) — y ningún
  // test de los de arriba se daría cuenta, porque todos buscan por ese mismo `aria-label`
  // y fallarían por "no encuentro el botón", no por "el botón no se puede nombrar".
  it("las acciones son botones de ICONO: sin texto visible, con su nombre accesible intacto", () => {
    render(
      <NovedadesModule
        grupo="devolucion"
        items={[novedad({ destinatario: "Ana Cliente" })]}
        total={1}
        page={1}
        pageSize={10}
      />,
    );

    // 2026-08-20 (240/R33): eran tres verbos; «Habilitar» salió del grupo de devolución.
    for (const verbo of ["Reprogramar", "Rechazar"]) {
      const boton = screen.getByRole("button", {
        name: `${verbo} la orden de Ana Cliente`,
      });
      // Sin texto: lo que hay dentro es el icono.
      expect(boton.textContent).toBe("");
      expect(boton.querySelector("svg")).not.toBeNull();
      // El icono es decorativo: quien lo anuncia es el `aria-label` del botón, no el svg.
      expect(boton.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("al enfocar una acción, su tooltip revela la etiqueta que antes estaba escrita", async () => {
    render(
      <NovedadesModule
        grupo="devolucion"
        items={[novedad({ destinatario: "Ana Cliente" })]}
        total={1}
        page={1}
        pageSize={10}
      />,
    );

    // Se dispara por FOCO y no por hover, y no es una preferencia: el hover de base-ui pasa
    // por su lógica de puntero, que en jsdom no se activa con los eventos que emite
    // `userEvent.hover` (se comprobó: el popup no llega a montarse ni esperando 3 s). El
    // foco ejerce el MISMO camino de apertura del componente, y de paso cubre al usuario de
    // teclado, que es quien más lo necesita: con el ratón siempre queda el hover real.
    // 2026-08-20 (240/R33): este caso enfocaba «Habilitar», que ya no está en la devolución. Se
    // mueve a «Reprogramar», que sigue en la misma fila y ejerce EL MISMO camino de apertura del
    // tooltip; lo que se mide es el patrón `TooltipTrigger render={<Button …/>}`, no ese botón.
    fireEvent.focus(
      screen.getByRole("button", { name: "Reprogramar la orden de Ana Cliente" }),
    );

    // El tooltip trae la palabra que antes estaba impresa en el botón. Que sea la MISMA no
    // es casual: es lo que hace que quitar el texto no pierda información.
    expect(await screen.findByText("Reprogramar")).toBeInTheDocument();
  });

  // 2026-08-12 (pedido humano) — "Llamar" y "WhatsApp" eran los DOS únicos botones de la
  // fila sin tooltip: solo-icono y sin ayuda visual, al lado de tres que sí la tenían.
  //
  // El arreglo NO se hizo envolviéndolos desde aquí sino DENTRO de `ContactoButtons`, que es
  // donde estaba la incoherencia (son solo-icono en sus cuatro consumidores). Este caso mide
  // el efecto en la pantalla que lo pidió; `ContactoButtons.test.tsx` mide el componente.
  it.each([
    ["Llamar a Ana Cliente", "Llamar"],
    ["WhatsApp a Ana Cliente", "WhatsApp"],
  ])(
    "al enfocar %s su tooltip revela la ayuda corta, sin tocar el nombre accesible",
    async (nombreAccesible, textoTooltip) => {
      render(
        <NovedadesModule
        grupo="devolucion"
          items={[novedad({ destinatario: "Ana Cliente" })]}
          total={1}
          page={1}
          pageSize={10}
        />,
      );

      const boton = screen.getByRole("button", { name: nombreAccesible });
      // El disparador ES el botón (`TooltipTrigger render={<Button …/>}`), no un `<span>`
      // envolvente: si alguien cambiara el patrón, el nodo enfocable dejaría de ser este.
      expect(boton.textContent).toBe("");

      // Por FOCO y no por hover, por lo mismo que el caso de arriba (jsdom + base-ui).
      fireEvent.focus(boton);

      expect(await screen.findByText(textoTooltip)).toBeInTheDocument();
      // EL TOOLTIP NO ES EL NOMBRE DEL BOTÓN: el `aria-label` sigue nombrando a Ana, que es
      // lo único que oye un lector de pantalla y lo único que hay en una pantalla táctil.
      expect(boton).toHaveAttribute("aria-label", nombreAccesible);
    },
  );

  // ⚠️ FEATURE 240 (T5.3/T5.4) — ESTE CASO CAMBIA DE SENTIDO A PROPÓSITO.
  //
  // **Lo que afirmaba hasta el 2026-08-20:** «MAQUETA: 'Rechazar' avisa que no está disponible y no
  // toca la lista», con `expect(infoMock).toHaveBeenCalledWith("Esta acción todavía no está
  // disponible.")` dentro. Ése era el aviso de la maqueta, y estuvo verde las dos semanas en que el
  // botón no hizo nada. Ahora afirma **lo contrario**: pulsar abre la ventana y **nadie avisa por
  // el canal `info`**.
  it("240/R27: 'Rechazar' abre la ventana en vez de avisar que no está disponible", async () => {
    const user = userEvent.setup();
    render(
      <NovedadesModule
        grupo="devolucion"
        items={[novedad({ destinatario: "Ana Cliente" })]}
        total={1}
        page={1}
        pageSize={10}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Rechazar la orden de Ana Cliente" }),
    );

    // La ventana está: es la presencia que empareja con la ausencia de abajo. Sin ella, «no se
    // avisó por `info`» pasaría igual si el botón se hubiera quedado sin handler.
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Rechazar la orden");
    // Y el aviso de la maqueta NO vuelve por ningún canal.
    expect(infoMock).not.toHaveBeenCalled();

    // Abrir no muta: la operación se dispara al confirmar, y eso se mide en
    // `tests/components/RechazarNovedad.test.tsx`.
    // La fila sigue en pantalla. Se cuenta en vez de usar `getByText`: desde que el
    // desplegable está encendido, el destinatario aparece dos veces en la card mosaico.
    // (Y no se usa `cardDe`: con un diálogo abierto el resto del árbol queda `aria-hidden`,
    // así que la consulta por ROL no encontraría el `<article>` aunque siga ahí.)
    expect(screen.getAllByText("Ana Cliente").length).toBeGreaterThan(0);
    expect(rechazarMock).not.toHaveBeenCalled();
    expect(reprogramarMock).not.toHaveBeenCalled();
    expect(errorMock).not.toHaveBeenCalled();
    expect(successMock).not.toHaveBeenCalled();
  });

  // LA COMPUERTA, EN LAS DOS CARDS. Es el caso que la feature 199 enseñó a no escribir a
  // media máquina: `SECCIONES_NOVEDAD` es UN objeto, pero quien lo obedece son DOS
  // componentes independientes, así que ejercerlo sólo en la vista por defecto deja la otra
  // mitad sin vigilancia y el apartado verde.
  //
  // 2026-08-13 (pedido humano): este caso medía que las secciones sin dato estuvieran
  // APAGADAS. Ya no hay secciones sin dato —`NovedadDTO` extiende `MiAsignacionDTO`— así que
  // mide lo simétrico: que las encendidas pintan el dato REAL, no un relleno. Lo que NO se
  // relaja es `mostrarRuta={false}`, que sigue igual y sigue afirmado abajo.
  it.each(["Mosaico", "Detalle"] as const)(
    "vista %s: las secciones encendidas pintan el dato REAL (cobro y ubicación)",
    async (vista) => {
      const user = userEvent.setup();
      render(
        <NovedadesModule
        grupo="devolucion"
          items={[novedad({ destinatario: "Ana Cliente" })]}
          total={1}
          page={1}
          pageSize={10}
        />,
      );
      await conmutarA(user, vista);

      const card = cardDe("Ana Cliente");
      // `cobro: true` — el monto que se IBA a cobrar, con el formato de `lib/config/moneda`.
      // Las dos cards pintan la fila "Cobrar" + importe, así que se afirma en las dos.
      const filaCobro = within(card).getByText("Cobrar").parentElement as HTMLElement;
      expect(filaCobro).toHaveTextContent(MONTO_TEXTO);
      // `navegacion: true` — el acceso al mapa vuelve, y con destino de verdad.
      //
      // Se busca por NOMBRE ACCESIBLE y no por rol: `UbicacionTrigger` es un `<button>` con
      // coordenadas y un `<a>` sin ellas. Buscar por rol ataría el caso a que la novedad
      // tenga o no `latitud`/`longitud`, que no es lo que se está midiendo.
      expect(within(card).getByLabelText(/Ver en el mapa/)).toBeInTheDocument();
      // El cantón sale en el bloque/línea de ubicación de las dos cards.
      expect(apariciones(card, /Escazú/).compacto.length).toBeGreaterThan(0);
      // `mostrarRuta={false}` — estas órdenes no son paradas de ninguna ruta optimizada.
      // Esto NO cambió y sigue siendo lo mismo que se afirmaba antes.
      expect(within(card).queryByText("Pendiente de optimizar")).toBeNull();
      expect(within(card).queryByText(/^Parada /)).toBeNull();
      expect(within(card).queryByText("Sin posición")).toBeNull();
      // El identificador visible sigue siendo la GUÍA (F1.4 #1 / R9): la remisión REAL viaja
      // en el DTO desde el 2026-08-13 y aun así NO se pinta.
      expect(within(card).queryByText("REM-90210")).toBeNull();
    },
  );

  // Las compuertas cuyo EFECTO VISIBLE sólo existe en UNA de las dos cards. Van aparte y no
  // dentro del `it.each` de arriba porque afirmarlas en la card que nunca las escribe sería
  // una aserción que no puede fallar — el vacío que este archivo ya se había cazado a sí
  // mismo con "Sin dirección".
  it("vista Detalle: `navegacion: true` enciende la LÍNEA de ubicación entera, no sólo el botón", async () => {
    const user = userEvent.setup();
    render(
      <NovedadesModule
        grupo="devolucion"
        items={[novedad({ destinatario: "Ana Cliente" })]}
        total={1}
        page={1}
        pageSize={10}
      />,
    );
    await conmutarA(user, "Detalle");

    // La compuerta envuelve la línea completa además del botón (decisión de la feature 199).
    // Encendida, esa línea existe y trae "cantón · distrito — dirección" armado por la card;
    // la mosaico no la escribe jamás, así que este caso es el único que puede vigilarla.
    const card = cardDe("Ana Cliente");
    expect(
      within(card).getByText("Escazú · San Rafael — Av. Central 120, portón verde"),
    ).toBeInTheDocument();
    // El botón de navegar es el OTRO efecto de la misma compuerta, con su propio nombre
    // accesible (distinto del de la mosaico): si alguien la partiera en dos, esto lo caza.
    expect(
      within(card).getByLabelText("Ver en el mapa la ubicación de Ana Cliente"),
    ).toBeInTheDocument();
    // "Sin dirección" es el fallback EXCLUSIVO de esta card y sigue sin aparecer, pero por el
    // motivo CONTRARIO al de antes: no porque la línea esté apagada, sino porque hay dato.
    expect(within(card).queryByText("Sin dirección")).toBeNull();
  });

  it("vista Mosaico: `detalle: true` despliega «Ver detalle completo» con los datos reales", async () => {
    const user = userEvent.setup();
    render(
      <NovedadesModule
        grupo="devolucion"
        items={[novedad({ destinatario: "Ana Cliente" })]}
        total={1}
        page={1}
        pageSize={10}
      />,
    );
    await conmutarA(user, "Mosaico");

    const card = cardDe("Ana Cliente");
    // El desplegable se EJERCE, no se da por bueno porque el texto esté en el DOM: el panel
    // va con `keepMounted`, así que su contenido está montado aunque esté plegado y una
    // aserción de texto a secas pasaría sin haber abierto nada.
    const toggle = within(card).getByRole("button", { name: /Ver detalle completo/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute("aria-expanded", "true"));

    // Y dentro está `AsignacionDetalle` con sus TRES secciones, todas con dato de verdad.
    // Antes este caso afirmaba que el desplegable NO existía, porque seis de estos campos
    // eran rellenos (`""`/`null`) que se habrían leído como "—" y como un "Valor a cobrar"
    // en cero. Hoy llegan del DTO, así que se afirma lo contrario, campo por campo.
    const panel = desplegableDe(card) as HTMLElement;
    for (const titulo of ["Pedido", "Entrega", "Cobro"]) {
      expect(within(panel).getByText(titulo)).toBeInTheDocument();
    }
    expect(within(panel).getByText("Av. Central 120, portón verde")).toBeInTheDocument();
    expect(within(panel).getByText("San José")).toBeInTheDocument();
    expect(within(panel).getByText("Escazú")).toBeInTheDocument();
    expect(within(panel).getByText("San Rafael")).toBeInTheDocument();
    expect(within(panel).getByText("Llamar antes de llegar")).toBeInTheDocument();
    expect(within(panel).getByText("Valor a cobrar")).toBeInTheDocument();
    expect(within(panel).getByText(MONTO_TEXTO)).toBeInTheDocument();
    expect(within(panel).getByText("88887777")).toBeInTheDocument();
  });

  it("vista Detalle: la compuerta `detalle` es INERTE ahí: esa card NO tiene desplegable", async () => {
    const user = userEvent.setup();
    render(
      <NovedadesModule
        grupo="devolucion"
        items={[novedad({ destinatario: "Ana Cliente" })]}
        total={1}
        page={1}
        pageSize={10}
      />,
    );
    await conmutarA(user, "Detalle");

    // LA TRAMPA de este archivo, verificada en el código: `PosOrderCardDetalle` ni siquiera
    // desestructura `detalle` de `seccionesVisibles()`. Es una FILA y nunca tuvo desplegable,
    // así que encender la compuerta no le añade nada. Este caso y el de arriba son las dos
    // mitades del mismo hecho: la vista que lo tiene lo abre, la que no lo tiene no lo pinta.
    const card = cardDe("Ana Cliente");
    expect(desplegableDe(card)).toBeNull();
    expect(within(card).queryByText("Valor a cobrar")).toBeNull();
    // Y no es que la card esté muda: la fila de cobro SÍ está, con el mismo importe.
    expect(within(card).getByText(MONTO_TEXTO)).toBeInTheDocument();
  });

  // EL CASO NULO. `montoCobrar`, `direccion`, `notas`, `distritoNombre`, `peso` y las
  // coordenadas son `null`-ables en el schema y el DTO los pasa TAL CUAL: nulabilidad
  // honesta, sin `""` ni `0` de relleno. Lo que la card pinta entonces es el hueco que ya
  // sabe pintar (la raya larga de `formatMonto`/`formatPeso`, la omisión de lo que falta en
  // la línea de ubicación), y eso es lo que se afirma aquí — no lo que uno supondría.
  const NOVEDAD_NULA = {
    destinatario: "Ana Cliente",
    direccion: null,
    montoCobrar: null,
    notas: null,
    distritoNombre: null,
    peso: null,
    latitud: null,
    longitud: null,
  } as const;

  it.each(["Mosaico", "Detalle"] as const)(
    "vista %s: con los campos nulos pinta el HUECO, nunca un «» ni un 0",
    async (vista) => {
      const user = userEvent.setup();
      render(
        <NovedadesModule grupo="devolucion" items={[novedad(NOVEDAD_NULA)]} total={1} page={1} pageSize={10} />,
      );
      await conmutarA(user, vista);

      const card = cardDe("Ana Cliente");
      // La sección de cobro SIGUE encendida (no se esconde por no tener importe) y su valor
      // es la raya larga: sin monto no hay cifra, y un "₡0" sería una cifra inventada.
      const filaCobro = within(card).getByText("Cobrar").parentElement as HTMLElement;
      expect(filaCobro).toHaveTextContent("—");
      expect(within(card).queryByText(/₡/)).toBeNull();
      expect(within(card).queryByText("0 kg")).toBeNull();
      // Sin coordenadas no hay minimapa que pintar, pero `UbicacionTrigger` abre igualmente su
      // modal (feature 289) para ofrecer las apps de navegación, que resuelven por texto:
      // dirección vacía, pero cantón y provincia no. El acceso al mapa no se queda muerto.
      expect(within(card).getByLabelText(/Ver en el mapa/)).toBeInTheDocument();
      // Sin dirección y sin distrito la línea/bloque de ubicación se queda con el cantón, que
      // es NOT NULL: por eso "Sin dirección" (fallback de la card de fila) no se alcanza ni
      // en el peor caso.
      expect(apariciones(card, /Escazú/).compacto.length).toBeGreaterThan(0);
      expect(within(card).queryByText("Sin dirección")).toBeNull();
    },
  );

  it("vista Mosaico: en el detalle desplegado los campos nulos se leen como «—», no vacíos", async () => {
    const user = userEvent.setup();
    render(
      <NovedadesModule grupo="devolucion" items={[novedad(NOVEDAD_NULA)]} total={1} page={1} pageSize={10} />,
    );

    const card = cardDe("Ana Cliente");
    await user.click(within(card).getByRole("button", { name: /Ver detalle completo/ }));

    // `AsignacionDetalle` pinta "—" en los CINCO campos nulos de esta novedad: dirección,
    // distrito, notas, valor a cobrar y peso. Se cuentan para que el caso no pase por tener
    // una sola raya suelta en cualquier sitio.
    const panel = desplegableDe(card) as HTMLElement;
    expect(within(panel).getAllByText("—")).toHaveLength(5);
    // Los que SÍ tienen dato siguen ahí: el hueco es del campo nulo, no de la sección. El
    // cantón sale DOS veces porque, sin distrito, es también el subtítulo del bloque de
    // dirección (`distritoNombre === null ? cantonNombre : "distrito, cantón"`).
    expect(within(panel).getByText("San José")).toBeInTheDocument();
    expect(within(panel).getAllByText("Escazú")).toHaveLength(2);
    expect(within(panel).queryByText(/₡/)).toBeNull();
  });

  it.each(["Mosaico", "Detalle"] as const)(
    "vista %s: la card es de solo-visualización: de /novedades no se gestiona nada",
    async (vista) => {
      const user = userEvent.setup();
      render(
        <NovedadesModule
        grupo="devolucion"
          items={[novedad({ destinatario: "Ana Cliente" })]}
          total={1}
          page={1}
          pageSize={10}
        />,
      );
      await conmutarA(user, vista);

      const card = cardDe("Ana Cliente");
      // Sin `onGestionar` la card no es clickeable ni enfocable, y su nombre accesible NO
      // promete una gestión que esta pantalla no ofrece (ver `pos-seleccion`).
      expect(card).not.toHaveAttribute("tabindex");
      expect(card.getAttribute("aria-label")).not.toContain("Gestionar");
    },
  );

  it("guía null: el placeholder legible de R9 sigue siendo el identificador de la card", () => {
    render(
      <NovedadesModule
        grupo="devolucion"
        items={[novedad({ numGuia: null, destinatario: "Ana Cliente" })]}
        total={1}
        page={1}
        pageSize={10}
      />,
    );

    expect(
      within(cardDe("Ana Cliente")).getByText("Guía sin asignar"),
    ).toBeInTheDocument();
  });
});

// 2026-08-13 (pedido humano) — EL CONMUTADOR DE VISTA. El mismo `VistaCardsToggle` de
// `RepartoModule`, `RecogerModule`, `RecoleccionModule` y `RecolectadasHoyLista`, con su
// mismo nombre accesible ("Vista de las órdenes"), de modo que quien conoce una pantalla
// conoce las cinco.
describe("NovedadesModule — conmutador de vista (2026-08-13)", () => {
  function renderUna() {
    render(
      <NovedadesModule
        grupo="devolucion"
        items={[novedad({ destinatario: "Ana Cliente" })]}
        total={1}
        page={1}
        pageSize={10}
      />,
    );
  }

  it("la vista de entrada es MOSAICO y el conmutador lo dice", () => {
    renderUna();

    expect(
      screen.getByRole("group", { name: "Vista de las órdenes" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mosaico" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Detalle" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("sin órdenes no hay conmutador: no hay cards que conmutar", () => {
    render(<NovedadesModule grupo="devolucion" items={[]} total={0} page={1} pageSize={10} />);

    expect(
      screen.queryByRole("group", { name: "Vista de las órdenes" }),
    ).toBeNull();
  });

  // LO QUE HACE EL CONMUTADOR, VISTO POR EL ÚNICO CAMBIO OBSERVABLE ENTRE LAS DOS CARDS.
  // Con las secciones apagadas, mosaico y detalle coinciden en casi todo (identificador,
  // destinatario, badge de causa, intentos, acciones); lo que las separa es el PRODUCTO, que
  // sólo la mosaico tiene hueco para pintar. Ese es el hecho que este caso fija: no es un
  // detalle de implementación, es lo que el usuario gana o pierde al elegir vista.
  it("conmutar a Detalle monta la otra card (el producto deja de verse) y volver lo restituye", async () => {
    const user = userEvent.setup();
    renderUna();

    expect(screen.getAllByText(PRODUCTO).length).toBeGreaterThan(0);

    await conmutarA(user, "Detalle");
    expect(screen.queryByText(PRODUCTO)).toBeNull();
    // Lo que NO se pierde al conmutar: la orden sigue ahí, con su identificador y su causa.
    expect(within(cardDe("Ana Cliente")).getByText("Guía 12345")).toBeInTheDocument();
    expect(
      within(cardDe("Ana Cliente")).getByText("Cliente no localizado"),
    ).toBeInTheDocument();

    await conmutarA(user, "Mosaico");
    expect(screen.getAllByText(PRODUCTO).length).toBeGreaterThan(0);
  });

  // Los intentos (feature 160/R18/R19) son el único dato que `SECCIONES_NOVEDAD` deja
  // ENCENDIDO, así que son la contraprueba de que el `it.each` de compuertas no está
  // midiendo una card muda: si conmutar apagara la sección de rebote, esto se pone rojo.
  it.each(["Mosaico", "Detalle"] as const)(
    "vista %s: los intentos siguen encendidos (la compuerta que SÍ está en true)",
    async (vista) => {
      const user = userEvent.setup();
      render(
        <NovedadesModule
        grupo="devolucion"
          items={[novedad({ destinatario: "Ana Cliente", intentosEntrega: 2 })]}
          total={1}
          page={1}
          pageSize={10}
        />,
      );
      await conmutarA(user, vista);

      expect(
        within(cardDe("Ana Cliente")).getByText("Intentos: 2"),
      ).toBeInTheDocument();
    },
  );

  it("la lista es <ul>/<li> en las DOS vistas (feature 160/R26: no es un carrusel de divs)", async () => {
    const user = userEvent.setup();
    render(
      <NovedadesModule
        grupo="devolucion"
        items={[
          novedad({ id: "o1", destinatario: "Uno" }),
          novedad({ id: "o2", destinatario: "Dos" }),
        ]}
        total={2}
        page={1}
        pageSize={10}
      />,
    );

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    await conmutarA(user, "Detalle");
    // Las pantallas hermanas envuelven el mosaico en `CarruselCards`, que pinta `<div>`s: si
    // alguien copiara ESE envoltorio aquí, esta cuenta se rompería en una de las dos vistas.
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(
      screen.getByRole("list", { name: "Órdenes en devolución" }),
    ).toBeInTheDocument();
  });

  it("la paginación convive con el conmutador: cambiar de vista no la toca", async () => {
    const user = userEvent.setup();
    render(
      <NovedadesModule grupo="devolucion" items={[novedad()]} total={25} page={2} pageSize={10} />,
    );

    await conmutarA(user, "Detalle");

    // R22: el conmutador es presentación pura — ni filtra, ni reordena, ni re-pagina. Si
    // alguien lo cableara a un re-fetch, este contador se movería.
    expect(screen.getByText("11-20 de 25")).toBeInTheDocument();
    expect(listarNovedadesMock).not.toHaveBeenCalled();
  });
});

// 2026-08-12 (pedido humano) — "Habilitar" abre un modal con NOTA OBLIGATORIA.
//
// Esta parte NO es maqueta y por eso tiene sus propios casos: el modal se abre, y sin nota
// no hay forma de confirmar. Lo único que sigue pendiente es qué ocurre DESPUÉS del
// confirmar, que hoy es un aviso (el último caso lo fija, y se pondrá rojo el día que se
// cablee la transición real — que es lo que se quiere).
describe("NovedadesModule — modal de Habilitar (nota obligatoria)", () => {
  /**
   * Abre el modal de habilitar de la orden de Ana y lo devuelve.
   *
   * Feature 236 (T5.5): se abre desde la PESTAÑA DE AYUDA, sobre una orden en `ayuda_tienda`, que
   * es donde «Habilitar» significa lo que dice —devolver la orden a la ruta por el punto único de
   * rescate de la 235—. Sobre una devolución anclada el rescate es un no-op deliberado y su dueño
   * es la ficha 240.
   */
  async function abrirHabilitar(user: ReturnType<typeof userEvent.setup>) {
    render(
      <NovedadesModule
        grupo="ayuda"
        items={[novedad({ destinatario: "Ana Cliente", estatusValue: "ayuda_tienda" })]}
        total={1}
        page={1}
        pageSize={10}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Habilitar la orden de Ana Cliente" }),
    );
    return screen.findByRole("dialog");
  }

  it("al pulsar 'Habilitar' abre el modal, con la nota vacía y el confirmar bloqueado", async () => {
    const user = userEvent.setup();
    const dialog = await abrirHabilitar(user);

    expect(within(dialog).getByLabelText(/^Nota/)).toHaveValue("");
    expect(within(dialog).getByRole("button", { name: "Habilitar" })).toBeDisabled();
    // La regla se comunica con el botón bloqueado, no con un error rojo de bienvenida: el
    // campo todavía no se ha tocado.
    expect(within(dialog).queryByRole("alert")).toBeNull();
  });

  it("la nota es OBLIGATORIA: espacios en blanco no cuentan y el error aparece al tocar el campo", async () => {
    const user = userEvent.setup();
    const dialog = await abrirHabilitar(user);
    const nota = within(dialog).getByLabelText(/^Nota/);
    const confirmar = within(dialog).getByRole("button", { name: "Habilitar" });

    // Sólo espacios: sigue sin ser una nota. Es la mutación que un `!== ""` a secas dejaría
    // pasar, y la que convierte el requisito en un trámite.
    await user.type(nota, "   ");
    expect(confirmar).toBeDisabled();

    await user.tab(); // blur -> el campo ya fue tocado
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "La nota es obligatoria.",
    );
    expect(nota).toHaveAttribute("aria-invalid", "true");
  });

  it("con nota escrita el confirmar se habilita y el error desaparece", async () => {
    const user = userEvent.setup();
    const dialog = await abrirHabilitar(user);
    const nota = within(dialog).getByLabelText(/^Nota/);

    await user.type(nota, "El cliente pidió reintentar");

    expect(within(dialog).getByRole("button", { name: "Habilitar" })).toBeEnabled();
    expect(within(dialog).queryByRole("alert")).toBeNull();
  });

  // Pedido humano 2026-08-18 — los desenlaces de «Habilitar», que desde entonces SÍ ejecuta una
  // transición. La nota viaja con la orden; el estatus lo mueve el servidor (y se afirma en su
  // propio test) — aquí se afirma lo que la PANTALLA hace con la respuesta.
  //
  // ⚠️ FEATURE 236 (T5.5 — D8, firmada por el humano el 2026-08-19, R24/R25): los desenlaces pasan
  // de DOS a TRES, y el caso feliz cambia de aserción. Hasta hoy este test fijaba «Orden
  // habilitada» + fila fuera para CUALQUIER `ok`, incluido el `ok` de una orden que nadie movió —
  // la carrera con «Recuperar» del mensajero—. La fila desaparecía por optimismo de cliente y
  // reaparecía al recargar, sin que nada lo explicara. Ahora el resultado trae `rescatada` y la
  // pantalla distingue «se devolvió a la ruta» de «no se movió». El fixture gana esa clave: sin
  // ella, este caso mediría un desenlace que el servidor ya no produce.
  it("R24: rescatada -> avisa que volvió a la ruta, la fila sale y el total baja", async () => {
    habilitarMock.mockResolvedValue({
      status: "ok",
      nota: { id: "n1" },
      rescatada: true,
    } as unknown as Awaited<ReturnType<typeof habilitarNovedad>>);
    const user = userEvent.setup();
    const dialog = await abrirHabilitar(user);

    await user.type(
      within(dialog).getByLabelText(/^Nota/),
      "El cliente pidió reintentar",
    );
    await user.click(within(dialog).getByRole("button", { name: "Habilitar" }));

    await waitFor(() =>
      expect(habilitarMock).toHaveBeenCalledWith({
        ordenId: "o1",
        nota: "El cliente pidió reintentar",
      }),
    );
    await waitFor(() =>
      expect(successMock).toHaveBeenCalledWith("La orden volvió a la ruta."),
    );
    // La fila sale de la lista y el total lo refleja: de «1 de 1» a la lista vacía (R24).
    await waitFor(() => expect(screen.queryByText("Ana Cliente")).toBeNull());
    expect(screen.getByText("Ningún mensajero te pidió ayuda")).toBeInTheDocument();
    // No se tocó la mutación de la pantalla hermana.
    expect(reprogramarMock).not.toHaveBeenCalled();
  });

  it("R25: si el rescate NO se aplicó, la pantalla no afirma que la devolvió y la fila se queda", async () => {
    // El caso real: el mensajero pulsó «Recuperar» un segundo antes. La nota SÍ se publicó —quedó
    // en el hilo, no se perdió— pero la orden no se movió.
    habilitarMock.mockResolvedValue({
      status: "ok",
      nota: { id: "n1" },
      rescatada: false,
    } as unknown as Awaited<ReturnType<typeof habilitarNovedad>>);
    const user = userEvent.setup();
    const dialog = await abrirHabilitar(user);

    await user.type(within(dialog).getByLabelText(/^Nota/), "Ya podés seguir");
    await user.click(within(dialog).getByRole("button", { name: "Habilitar" }));

    // El aviso es SUYO y dice las dos mitades: la nota se publicó, la orden no se movió.
    await waitFor(() => expect(warningMock).toHaveBeenCalledTimes(1));
    const aviso = warningMock.mock.calls[0][0] as string;
    expect(aviso).toContain("Tu nota se publicó");
    expect(aviso).toContain("no volvió a la ruta");
    // Y NO se afirma lo contrario por ningún otro canal.
    expect(successMock).not.toHaveBeenCalled();
    expect(errorMock).not.toHaveBeenCalled();
    // La fila SIGUE ahí: quitarla mientras se dice que no se movió sería cambiar una mentira por
    // otra —y es literalmente lo que pasaba antes de D8, con reaparición al recargar—.
    expect(screen.getAllByText("Ana Cliente").length).toBeGreaterThan(0);
    expect(screen.queryByText("Ningún mensajero te pidió ayuda")).toBeNull();
  });

  it("si la acción rechaza, avisa y la orden SIGUE en la lista", async () => {
    habilitarMock.mockResolvedValue({ status: "forbidden" });
    const user = userEvent.setup();
    const dialog = await abrirHabilitar(user);

    await user.type(within(dialog).getByLabelText(/^Nota/), "Nota cualquiera");
    await user.click(within(dialog).getByRole("button", { name: "Habilitar" }));

    await waitFor(() =>
      expect(errorMock).toHaveBeenCalledWith("No se pudo habilitar la orden."),
    );
    // La fila sigue en pantalla. Se cuenta en vez de usar `getByText`: desde que el
    // desplegable está encendido, el destinatario aparece dos veces en la card mosaico.
    expect(screen.getAllByText("Ana Cliente").length).toBeGreaterThan(0);
    expect(successMock).not.toHaveBeenCalled();
  });
});

// Feature 160 (T20, R18/R19/R26) — `/novedades` es una lista de cards (<ul>/<li>), NO
// un `DataTable` (verificado contra el componente), así que el conteo va como DATO
// ETIQUETADO con el mismo markup que las líneas hermanas (guía, destinatario, causa).
describe("NovedadesModule — intentos de entrega (feature 160)", () => {
  it("R18: cada novedad muestra el dato etiquetado junto a sus otros campos", () => {
    render(
      <NovedadesModule
        grupo="devolucion"
        items={[novedad({ id: "o1", destinatario: "Ana Cliente", intentosEntrega: 2 })]}
        total={1}
        page={1}
        pageSize={10}
      />,
    );
    const item = screen.getByRole("listitem");
    // Por cantidad: el desplegable «Ver detalle completo» repite el destinatario.
    expect(within(item).getAllByText("Ana Cliente").length).toBeGreaterThan(0);
    const dato = within(item).getByText("Intentos: 2");
    expect(dato).toBeInTheDocument();
    // Mismo markup que sus hermanas: el dato vive dentro de un <p> como los demás.
    expect(dato.closest("p")).not.toBeNull();
  });

  it("R19: con 0 intentos el dato SE MUESTRA (no se omite ni se deja vacío)", () => {
    render(
      <NovedadesModule
        grupo="devolucion"
        items={[novedad({ id: "o1", intentosEntrega: 0 })]}
        total={1}
        page={1}
        pageSize={10}
      />,
    );
    expect(
      within(screen.getByRole("listitem")).getByText("Intentos: 0"),
    ).toBeInTheDocument();
  });

  it("R19: sin el campo (DTO viejo) muestra 0", () => {
    render(
      <NovedadesModule grupo="devolucion" items={[novedad({ id: "o1" })]} total={1} page={1} pageSize={10} />,
    );
    expect(
      within(screen.getByRole("listitem")).getByText("Intentos: 0"),
    ).toBeInTheDocument();
  });

  it("R26: cada novedad lleva SU número", () => {
    render(
      <NovedadesModule
        grupo="devolucion"
        items={[
          novedad({ id: "o1", destinatario: "Uno", intentosEntrega: 3 }),
          novedad({ id: "o2", destinatario: "Dos", intentosEntrega: 0 }),
        ]}
        total={2}
        page={1}
        pageSize={10}
      />,
    );
    const items = screen.getAllByRole("listitem");
    expect(within(items[0]).getByText("Intentos: 3")).toBeInTheDocument();
    expect(within(items[1]).getByText("Intentos: 0")).toBeInTheDocument();
  });

  it("R20/R32: el dato no trae umbral y el estado vacío sigue sin lista", () => {
    render(
      <NovedadesModule
        grupo="devolucion"
        items={[novedad({ id: "o1", intentosEntrega: 2 })]}
        total={1}
        page={1}
        pageSize={10}
      />,
    );
    expect(
      within(screen.getByRole("listitem")).getByText("Intentos: 2").textContent,
    ).toBe("Intentos: 2");
    cleanup();

    render(<NovedadesModule grupo="devolucion" items={[]} total={0} page={1} pageSize={10} />);
    expect(screen.queryByText(/Intentos/)).toBeNull();
  });
});

// =================================================================================================
// FEATURE 237 (T7.3/T7.4 — R25/R27) — LA VENTANA CON LA QUE LA TIENDA RESUELVE, CABLEADA.
// =================================================================================================
//
// Lo que estos casos protegen es el TRAMO entre el botón y la lista, que es donde 236/D8 encontró
// el defecto sobre esta misma card: «Habilitar» quitaba la fila por optimismo y afirmaba haber
// habilitado aunque la carrera dejara la orden quieta. Aquí hay más en juego: un `ok` significa que
// se creó una gestión en el cierre de OTRA persona, con un intento y con dinero detrás.
describe("NovedadesModule — 237: resolver desde la pestaña de ayuda", () => {
  function montarAyuda(over: Partial<NovedadDTO> = {}) {
    render(
      <NovedadesModule
        grupo="ayuda"
        items={[
          novedad({
            id: "o1",
            destinatario: "Ana Cliente",
            estatusValue: "ayuda_tienda",
            ...over,
          }),
        ]}
        total={1}
        page={1}
        pageSize={10}
      />,
    );
  }

  /** Abre la ventana por el botón de la card y devuelve el diálogo. */
  async function abrir(
    user: ReturnType<typeof userEvent.setup>,
    boton: "Reprogramar" | "Rechazar",
  ) {
    await user.click(
      screen.getByRole("button", { name: boton + " la orden de Ana Cliente" }),
    );
    return screen.findByRole("dialog");
  }

  /** Rellena motivo y una foto (D2: obligatoria en los dos desenlaces) y confirma. */
  async function completarYEnviar(
    user: ReturnType<typeof userEvent.setup>,
    dialog: HTMLElement,
    confirmar: "Reprogramar" | "Rechazar",
  ) {
    await user.upload(
      within(dialog).getByLabelText("Fotos de evidencia"),
      new File(["x"], "f0.jpg", { type: "image/jpeg" }),
    );
    await waitFor(() =>
      expect(
        within(dialog).getByRole("list", { name: "Fotos de evidencia seleccionadas" }),
      ).toBeInTheDocument(),
    );
    fireEvent.change(within(dialog).getByLabelText("Motivo"), {
      target: { value: "El cliente ya no quiere el pedido" },
    });
    await user.click(within(dialog).getByRole("button", { name: confirmar }));
  }

  it("T7.3: con la ventana cerrada NO está en el árbol", () => {
    montarAyuda();
    // La ausencia. Su par es el caso siguiente, que la abre: sin él, esto pasaría igual con la
    // pantalla entera rota. Importa porque, montada siempre, la ventana traería un selector de
    // fotos y una fecha por cada orden de la página.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText(/Esto cuenta como una gestión del mensajero/)).toBeNull();
  });

  it("T7.3: «Rechazar» de la card abre la ventana, con su aviso del precio", async () => {
    const user = userEvent.setup();
    montarAyuda();

    const dialog = await abrir(user, "Rechazar");

    expect(dialog).toHaveTextContent("Resolver la orden por tu cuenta");
    // El literal, a mano: es el que le dice a la tienda que está a punto de cobrarse a sí misma.
    expect(
      within(dialog).getByText(
        "Esto cuenta como una gestión del mensajero: entra en su cierre del día, suma un intento de entrega y mueve el dinero igual. Por eso pide foto y motivo.",
      ),
    ).toBeInTheDocument();
    // Y la orden que nombra es la de la fila, no otra de la página.
    expect(dialog).toHaveTextContent("Ana Cliente");
  });

  it("T7.3: «Reprogramar» de la card abre la MISMA ventana, con el campo de fecha", async () => {
    const user = userEvent.setup();
    montarAyuda();

    const dialog = await abrir(user, "Reprogramar");

    expect(within(dialog).getByLabelText("Nueva fecha")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Reprogramar" })).toBeInTheDocument();
  });

  it("R27: tras el éxito lo dice, RELEE la pestaña y la fila sale de la lista", async () => {
    gestionarDesdeAyudaMock.mockResolvedValue({
      status: "ok",
      ordenId: "o1",
      resultado: "rechazada",
    });
    // La relectura es la que quita la fila: el servidor ya no la lista y el total baja a 0. No se
    // filtra en el cliente — es la lección de 236/D8 sobre esta misma card.
    listarAyudaMock.mockResolvedValue({
      status: "ok",
      items: [],
      total: 0,
      page: 1,
      pageSize: 10,
    });
    const user = userEvent.setup();
    montarAyuda();
    const dialog = await abrir(user, "Rechazar");

    await completarYEnviar(user, dialog, "Rechazar");

    await waitFor(() =>
      expect(successMock).toHaveBeenCalledWith("La orden quedó rechazada."),
    );
    await waitFor(() => expect(listarAyudaMock).toHaveBeenCalledWith({ page: 1 }));
    // La fila desaparece POR EL DATO: la lista de la pestaña ya no está y en su sitio queda el
    // estado vacío. Con un `filter` de cliente esto pasaría igual, y por eso se afirma además la
    // llamada de arriba: lo que se mide es que se releyó.
    await waitFor(() =>
      expect(screen.queryByRole("list", { name: "Órdenes con ayuda solicitada" })).toBeNull(),
    );
  });

  it("R27: y al reprogramar el aviso nombra ESE desenlace, no el otro", async () => {
    gestionarDesdeAyudaMock.mockResolvedValue({
      status: "ok",
      ordenId: "o1",
      resultado: "reprogramada",
    });
    listarAyudaMock.mockResolvedValue({
      status: "ok",
      items: [],
      total: 0,
      page: 1,
      pageSize: 10,
    });
    const user = userEvent.setup();
    montarAyuda();
    const dialog = await abrir(user, "Reprogramar");

    await completarYEnviar(user, dialog, "Reprogramar");

    // El par del caso anterior: si el aviso fuera uno solo («Listo»), los dos pasarían y la tienda
    // no sabría cuál de las dos cosas acaba de hacer.
    await waitFor(() =>
      expect(successMock).toHaveBeenCalledWith("La orden quedó reprogramada."),
    );
    expect(successMock).not.toHaveBeenCalledWith("La orden quedó rechazada.");
  });

  it("R25: con `conflict` NO afirma que resolvió, dice el texto del servidor y RECARGA", async () => {
    // La carrera: el mensajero recuperó la orden —o la cortó la noche— entre que la tienda abrió la
    // ventana y pulsó. NO se creó ninguna gestión, así que no hay intento ni cobro, y la pantalla
    // no puede decir «La orden quedó rechazada». Es literalmente el defecto que 236/D8 arregló
    // sobre esta misma card, con dinero detrás esta vez.
    gestionarDesdeAyudaMock.mockResolvedValue({
      status: "conflict",
      motivo: "Esta orden ya no está esperando tu respuesta.",
    });
    listarAyudaMock.mockResolvedValue({
      status: "ok",
      items: [],
      total: 0,
      page: 1,
      pageSize: 10,
    });
    const user = userEvent.setup();
    montarAyuda();
    const dialog = await abrir(user, "Rechazar");

    await completarYEnviar(user, dialog, "Rechazar");

    await waitFor(() =>
      expect(warningMock).toHaveBeenCalledWith(
        "Esta orden ya no está esperando tu respuesta.",
      ),
    );
    // Ni éxito ni error: el desenlace es otro, y se dice por su propio canal.
    expect(successMock).not.toHaveBeenCalled();
    // Y se RECARGA igual: la fila que ya no corresponde desaparece POR EL DATO, no por optimismo.
    await waitFor(() => expect(listarAyudaMock).toHaveBeenCalledWith({ page: 1 }));
  });

  it("R22: un `forbidden` avisa con un texto opaco y NO recarga (no se movió nada)", async () => {
    gestionarDesdeAyudaMock.mockResolvedValue({ status: "forbidden" });
    const user = userEvent.setup();
    montarAyuda();
    const dialog = await abrir(user, "Rechazar");

    await completarYEnviar(user, dialog, "Rechazar");

    await waitFor(() =>
      expect(errorMock).toHaveBeenCalledWith("No tenés permiso para resolver esta orden."),
    );
    // El borde no dice si la orden existe, en qué estado está ni de quién es; adivinar un motivo
    // concreto aquí sería inventarlo. Y como no cambió nada, releer la página sería ruido.
    expect(listarAyudaMock).not.toHaveBeenCalled();
    expect(successMock).not.toHaveBeenCalled();
  });

  // ===============================================================================================
  // FEATURE 261 (F7, R32) — LA TIENDA TAMPOCO PUEDE RESOLVER EL DÍA QUE NO ES.
  // ===============================================================================================
  //
  // Decisión humana P2 (2026-08-22): *si el problema es que se registre un resultado en un día que
  // no es, da igual quién lo registre*. El servidor bloquea esta vía en DOS capas (R28-R31) y
  // devuelve `conflict` con la MISMA frase que lee el mensajero, nombrando el día.
  //
  // ⚠️ AQUÍ EL CONTROL **NO** SE DESHABILITA, y es una decisión firmada (design §5.4, A13), no un
  // olvido: el mensajero está en la calle con el paquete en la mano —enterarse al intentarlo le
  // cuesta un viaje— y la tienda está en un escritorio, donde el rechazo es un clic y la respuesta
  // inmediata. Deshabilitarlo exigiría meter el día en `NovedadDTO` y derivarlo con un reloj en el
  // servicio de novedades, para una población que se midió en 2 órdenes. Este caso fija esa
  // asimetría para que nadie la «arregle» sin reabrir la decisión.
  //
  // El literal va escrito A MANO; que sea EL MISMO que emite el servidor lo comprueba la aserción
  // contra `MENSAJES_GESTION_DESDE_AYUDA`, que es de donde sale la frase de verdad.
  it("261/R32: la reserva se rechaza con palabras y con SU DÍA, y el botón NO estaba apagado", async () => {
    const AVISO_22 =
      "Esta orden es para el reparto del 22 de agosto. Ese día podrás recogerla y gestionarla.";
    // La frase del servidor y la que se pinta son la MISMA, y no por coincidencia: la fuente es
    // una (261/R15). Si alguien reescribiera una de las dos, esta línea lo delata.
    expect(MENSAJES_GESTION_DESDE_AYUDA.reservadaParaOtroDia("2026-08-22")).toBe(AVISO_22);

    gestionarDesdeAyudaMock.mockResolvedValue({ status: "conflict", motivo: AVISO_22 });
    listarAyudaMock.mockResolvedValue({
      status: "ok",
      items: [],
      total: 0,
      page: 1,
      pageSize: 10,
    });
    const user = userEvent.setup();
    montarAyuda();

    // La asimetría, medida donde vive: el control está OFRECIDO, no apagado.
    const boton = screen.getByRole("button", { name: "Rechazar la orden de Ana Cliente" });
    expect(boton).toBeEnabled();

    const dialog = await abrir(user, "Rechazar");
    await completarYEnviar(user, dialog, "Rechazar");

    await waitFor(() => expect(warningMock).toHaveBeenCalledWith(AVISO_22));
    // Ni éxito ni error opaco: no se creó ninguna gestión, así que la pantalla no puede afirmar
    // que resolvió — y el motivo que da es el REAL, no «la orden ya no está esperando».
    expect(successMock).not.toHaveBeenCalled();
    expect(warningMock).not.toHaveBeenCalledWith(
      "Esta orden ya no está esperando tu respuesta.",
    );
  });

  it("la ventana se cierra tras el desenlace, sea cual sea", async () => {
    gestionarDesdeAyudaMock.mockResolvedValue({
      status: "conflict",
      motivo: "Esta orden ya no está esperando tu respuesta.",
    });
    listarAyudaMock.mockResolvedValue({
      status: "ok",
      items: [],
      total: 0,
      page: 1,
      pageSize: 10,
    });
    const user = userEvent.setup();
    montarAyuda();
    const dialog = await abrir(user, "Rechazar");

    await completarYEnviar(user, dialog, "Rechazar");

    // Dejarla abierta invitaría a un segundo envío sobre una orden que ya no está en ayuda.
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
