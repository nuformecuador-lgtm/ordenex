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
import { listarNovedadesAction } from "@/lib/actions/novedades";
import { reprogramarNovedad } from "@/lib/actions/resolver-novedad";
import { mananaCalendarioCR } from "@/lib/utils/fecha-cr";
import type { NovedadDTO } from "@/lib/types/novedad";

// Feature 87 (T14) — modulo cliente de `/novedades`. Cubre R9 (fila con guia/destinatario/
// causa/contacto + placeholder si numGuia null), R10 (estado vacio), R11 (label ES, no slug)
// y R22 (Pagination con total/page). Se mockea la Server Action (re-fetch) y el toast.
vi.mock("@/lib/actions/novedades", () => ({
  listarNovedadesAction: vi.fn(),
}));

// Feature 100 (T3.1/T3.2) — la acción "Reprogramar" ejecuta la reprogramación vía
// esta Server Action; se mockea para verificar la invocación con la fecha elegida.
vi.mock("@/lib/actions/resolver-novedad", () => ({
  reprogramarNovedad: vi.fn(),
}));

const reprogramarMock = vi.mocked(reprogramarNovedad);
/** El re-fetch de página (R22). Sirve de anti-vacío: conmutar de vista NO debe invocarlo. */
const listarNovedadesMock = vi.mocked(listarNovedadesAction);

const { successMock, errorMock, infoMock } = vi.hoisted(() => ({
  successMock: vi.fn(),
  errorMock: vi.fn(),
  // 2026-08-12: el canal `info` deja de ser un `vi.fn()` anónimo porque los dos botones de
  // MAQUETA ("Habilitar", "Devolver") avisan por él y hay que poder afirmarlo.
  infoMock: vi.fn(),
}));

vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: successMock,
    error: errorMock,
    warning: vi.fn(),
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

/** El monto de la novedad base, tal y como `formatMonto` lo pinta (₡ + miles + 2 decimales). */
const MONTO_TEXTO = "₡24.500,00";

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("NovedadesModule", () => {
  it("R10: lista vacia -> estado vacio, sin filas", () => {
    render(<NovedadesModule items={[]} total={0} page={1} pageSize={10} />);

    expect(screen.getByText(/No tenés órdenes en devolución/i)).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Órdenes en devolución" })).toBeNull();
  });

  it("R9: por cada orden muestra guia, destinatario y botones de contacto", () => {
    render(
      <NovedadesModule
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
        items={[novedad({ causa: null })]}
        total={1}
        page={1}
        pageSize={10}
      />,
    );

    expect(screen.getByText("Sin causa registrada")).toBeInTheDocument();
  });

  it("R22: renderiza la Pagination con el total y la pagina recibidos", () => {
    render(
      <NovedadesModule
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
      const card = cardDe("Ana Cliente");
      for (const nombre of [
        "Llamar a Ana Cliente",
        "WhatsApp a Ana Cliente",
        "Reprogramar la orden de Ana Cliente",
        "Habilitar la orden de Ana Cliente",
        "Devolver la orden de Ana Cliente",
      ]) {
        expect(within(card).getByRole("button", { name: nombre })).toBeInTheDocument();
      }
    },
  );

  // MAQUETA DECLARADA (2026-08-12): "Habilitar" y "Devolver" existen en la fila pero su
  // comportamiento NO está decidido y no hay backend detrás. Estos dos casos son lo que
  // impide que la maqueta se confunda con una función terminada: afirman que los botones
  // están (para que el layout no se rompa sin avisar) y que NO mutan nada.
  //
  // El día que se cableen, este bloque se pone rojo — y eso es exactamente lo que tiene que
  // pasar: obligará a escribir el test de la transición real en vez de heredar el silencio.
  // 2026-08-12 (pedido humano): las tres acciones son ICONO + TOOLTIP, ya no texto.
  //
  // Lo que estos dos casos protegen es la parte que se rompe callando: al quitar el texto
  // visible, el ÚNICO nombre que le queda al botón es su `aria-label`. Si alguien lo borra
  // "porque ya está el tooltip", el control se queda sin nombre para un lector de pantalla
  // y sin nombre para una pantalla táctil (donde no hay hover que revele nada) — y ningún
  // test de los de arriba se daría cuenta, porque todos buscan por ese mismo `aria-label`
  // y fallarían por "no encuentro el botón", no por "el botón no se puede nombrar".
  it("las tres acciones son botones de ICONO: sin texto visible, con su nombre accesible intacto", () => {
    render(
      <NovedadesModule
        items={[novedad({ destinatario: "Ana Cliente" })]}
        total={1}
        page={1}
        pageSize={10}
      />,
    );

    for (const verbo of ["Reprogramar", "Habilitar", "Devolver"]) {
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
    fireEvent.focus(
      screen.getByRole("button", { name: "Habilitar la orden de Ana Cliente" }),
    );

    // El tooltip trae la palabra que antes estaba impresa en el botón. Que sea la MISMA no
    // es casual: es lo que hace que quitar el texto no pierda información.
    expect(await screen.findByText("Habilitar")).toBeInTheDocument();
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

  it("MAQUETA: 'Devolver' avisa que no está disponible y no toca la lista", async () => {
    const user = userEvent.setup();
    render(
      <NovedadesModule
        items={[novedad({ destinatario: "Ana Cliente" })]}
        total={1}
        page={1}
        pageSize={10}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Devolver la orden de Ana Cliente" }),
    );

    expect(infoMock).toHaveBeenCalledWith("Esta acción todavía no está disponible.");
    // No resuelve la novedad: la fila sigue ahí y no se llamó a la única mutación que esta
    // pantalla tiene cableada.
    // La fila sigue en pantalla. Se cuenta en vez de usar `getByText`: desde que el
    // desplegable está encendido, el destinatario aparece dos veces en la card mosaico.
    // (Y no se usa `cardDe`: con un diálogo abierto el resto del árbol queda `aria-hidden`,
    // así que la consulta por ROL no encontraría el `<article>` aunque siga ahí.)
    expect(screen.getAllByText("Ana Cliente").length).toBeGreaterThan(0);
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
        <NovedadesModule items={[novedad(NOVEDAD_NULA)]} total={1} page={1} pageSize={10} />,
      );
      await conmutarA(user, vista);

      const card = cardDe("Ana Cliente");
      // La sección de cobro SIGUE encendida (no se esconde por no tener importe) y su valor
      // es la raya larga: sin monto no hay cifra, y un "₡0,00" sería una cifra inventada.
      const filaCobro = within(card).getByText("Cobrar").parentElement as HTMLElement;
      expect(filaCobro).toHaveTextContent("—");
      expect(within(card).queryByText(/₡/)).toBeNull();
      expect(within(card).queryByText("0 kg")).toBeNull();
      // Sin coordenadas `UbicacionTrigger` cae al ENLACE a Maps por texto (`mapsNavUrl`), que
      // sigue teniendo con qué resolver: dirección vacía, pero cantón y provincia no. El
      // acceso al mapa no se queda muerto.
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
      <NovedadesModule items={[novedad(NOVEDAD_NULA)]} total={1} page={1} pageSize={10} />,
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
    render(<NovedadesModule items={[]} total={0} page={1} pageSize={10} />);

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
      <NovedadesModule items={[novedad()]} total={25} page={2} pageSize={10} />,
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
  /** Abre el modal de habilitar de la orden de Ana y lo devuelve. */
  async function abrirHabilitar(user: ReturnType<typeof userEvent.setup>) {
    render(
      <NovedadesModule
        items={[novedad({ destinatario: "Ana Cliente" })]}
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

  it("MAQUETA: confirmar con nota todavía no ejecuta ninguna transición (sólo avisa)", async () => {
    const user = userEvent.setup();
    const dialog = await abrirHabilitar(user);

    await user.type(
      within(dialog).getByLabelText(/^Nota/),
      "El cliente pidió reintentar",
    );
    await user.click(within(dialog).getByRole("button", { name: "Habilitar" }));

    await waitFor(() =>
      expect(infoMock).toHaveBeenCalledWith(
        "Esta acción todavía no está disponible.",
      ),
    );
    // La orden NO sale de la lista y no se llamó a la mutación de la pantalla hermana.
    // La fila sigue en pantalla. Se cuenta en vez de usar `getByText`: desde que el
    // desplegable está encendido, el destinatario aparece dos veces en la card mosaico.
    // (Y no se usa `cardDe`: con un diálogo abierto el resto del árbol queda `aria-hidden`,
    // así que la consulta por ROL no encontraría el `<article>` aunque siga ahí.)
    expect(screen.getAllByText("Ana Cliente").length).toBeGreaterThan(0);
    expect(reprogramarMock).not.toHaveBeenCalled();
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
      <NovedadesModule items={[novedad({ id: "o1" })]} total={1} page={1} pageSize={10} />,
    );
    expect(
      within(screen.getByRole("listitem")).getByText("Intentos: 0"),
    ).toBeInTheDocument();
  });

  it("R26: cada novedad lleva SU número", () => {
    render(
      <NovedadesModule
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

    render(<NovedadesModule items={[]} total={0} page={1} pageSize={10} />);
    expect(screen.queryByText(/Intentos/)).toBeNull();
  });
});
