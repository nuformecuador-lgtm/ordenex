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

const novedad = (over: Partial<NovedadDTO> = {}): NovedadDTO => ({
  id: "o1",
  numGuia: 12345,
  destinatario: "Ana Cliente",
  telefonoDest: "88887777",
  causa: "not_found",
  ...over,
});

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

    expect(screen.getByText(/12345/)).toBeInTheDocument();
    expect(screen.getByText("Ana Cliente")).toBeInTheDocument();
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
    expect(screen.getByText("Ana Cliente")).toBeInTheDocument();
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

// 2026-08-12 (pedido humano) — LA FILA ES LA CARD COMPARTIDA. Cada novedad se pinta con
// `PosOrderCardDetalle` (la vista de detalle de las órdenes del mensajero) y las tres
// acciones de esta pantalla bajan por su prop `acciones`.
//
// QUÉ MIDE ESTE BLOQUE Y POR QUÉ NO SOBRA. Los casos de arriba siguen verdes tal cual —eso
// es la prueba de que lo VISIBLE no cambió— pero ninguno se pondría rojo si mañana alguien
// volviera a escribir la fila a mano en el módulo: verían la misma guía, el mismo nombre y
// los mismos botones. Lo que se afirma aquí es la ESTRUCTURA que trae la reutilización:
// que hay una card (`<article>` con su nombre accesible) dentro de cada `<li>`, que las
// acciones viven DENTRO de ella y no como hermanas sueltas, y que las secciones sin dato
// están apagadas. Sin esto, la deduplicación no tendría ningún test que la defienda.
describe("NovedadesModule — la fila es la card POS de detalle (2026-08-12)", () => {
  /** La card de una novedad: `<article>` con el nombre accesible que ella misma compone. */
  function cardDe(nombre: string): HTMLElement {
    return screen.getByRole("article", {
      name: new RegExp(`Orden .*· ${nombre}`),
    });
  }

  it("cada <li> contiene la card, y la card lleva la guía y el destinatario", () => {
    render(
      <NovedadesModule
        items={[novedad({ numGuia: 12345, destinatario: "Ana Cliente" })]}
        total={1}
        page={1}
        pageSize={10}
      />,
    );

    const card = cardDe("Ana Cliente");
    expect(card.closest("li")).not.toBeNull();
    expect(within(card).getByText("Guía 12345")).toBeInTheDocument();
    expect(within(card).getByText("Ana Cliente")).toBeInTheDocument();
    // La causa viaja por la prop `estado` de la card: es su badge, no una línea suelta.
    expect(within(card).getByText("Cliente no localizado")).toBeInTheDocument();
  });

  it("las acciones llegan por la prop `acciones` y se pintan DENTRO de la card", () => {
    render(
      <NovedadesModule
        items={[novedad({ destinatario: "Ana Cliente" })]}
        total={1}
        page={1}
        pageSize={10}
      />,
    );

    // El anti-vacío de este caso: si las acciones se hubieran quedado fuera de la card,
    // `getByRole` seguiría encontrándolas en el documento y el test pasaría diciendo nada.
    // Por eso se buscan DENTRO del `<article>`.
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
  });

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
    expect(screen.getByText("Ana Cliente")).toBeInTheDocument();
    expect(reprogramarMock).not.toHaveBeenCalled();
    expect(errorMock).not.toHaveBeenCalled();
    expect(successMock).not.toHaveBeenCalled();
  });

  it("las secciones sin dato están apagadas: ni cobro ni navegación (nada de rellenos en pantalla)", () => {
    render(
      <NovedadesModule
        items={[novedad({ destinatario: "Ana Cliente" })]}
        total={1}
        page={1}
        pageSize={10}
      />,
    );

    const card = cardDe("Ana Cliente");
    // `cobro: false` — no hay monto que cobrar en una devolución; un "₡0" sería inventado.
    expect(within(card).queryByText("Cobrar")).toBeNull();
    expect(within(card).queryByText(/₡/)).toBeNull();
    // `navegacion: false` — el DTO no trae dirección, así que la card NO puede pintar su
    // fallback "Sin dirección": eso afirmaría un hueco donde no hay dato que dar.
    expect(within(card).queryByText("Sin dirección")).toBeNull();
    expect(
      within(card).queryByRole("button", { name: /Ver en el mapa/ }),
    ).toBeNull();
    // `mostrarRuta={false}` — estas órdenes no son paradas de ninguna ruta optimizada.
    expect(within(card).queryByText("Pendiente de optimizar")).toBeNull();
    expect(within(card).queryByText(/^Parada /)).toBeNull();
  });

  it("la card es de solo-visualización: de /novedades no se gestiona nada", () => {
    render(
      <NovedadesModule
        items={[novedad({ destinatario: "Ana Cliente" })]}
        total={1}
        page={1}
        pageSize={10}
      />,
    );

    const card = cardDe("Ana Cliente");
    // Sin `onGestionar` la card no es clickeable ni enfocable, y su nombre accesible NO
    // promete una gestión que esta pantalla no ofrece (ver `pos-seleccion`).
    expect(card).not.toHaveAttribute("tabindex");
    expect(card.getAttribute("aria-label")).not.toContain("Gestionar");
  });

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
    expect(screen.getByText("Ana Cliente")).toBeInTheDocument();
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
    expect(within(item).getByText("Ana Cliente")).toBeInTheDocument();
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
