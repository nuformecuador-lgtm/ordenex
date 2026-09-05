// @vitest-environment jsdom
// FICHA 374 (H6, H7, H10) — LA PANTALLA DE ADMINISTRACIÓN DEL CATÁLOGO GEOGRÁFICO.
//
// Cubre R39, R40, R41, R42, R43, R44, R45, R58, R59, R60, R62 y R63. Se ejercita el componente
// REAL con su `Modal` de producción; lo único doblado es el borde (las cuatro Server Actions) y el
// toast, para que lo verificado sea el cableado y no el backend.
//
// **LOS TEXTOS SE ESCRIBEN AQUÍ, LITERALES, y no se importan del módulo que los produce.** Comparar
// un texto contra su propia fuente está siempre verde: borrar la frase del motivo cambiaría las dos
// mitades a la vez y el test no se enteraría. Estos literales SON el contrato de pantalla, así que
// si la copia cambia, este archivo tiene que cambiar con ella.
//
// **LA DISTINCIÓN QUE GOBIERNA EL ARCHIVO:** `activo` es el flag PROPIO de la fila; lo que decide
// si un nodo se puede usar es la conjunción con sus ascendientes. Por eso el árbol de prueba tiene
// un distrito con el flag encendido bajo un cantón retirado: es un estado LEGÍTIMO (R10), y es el
// que separa «Inactivo» de «Inactivo por su cantón».
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { crearNodoGeograficoSchema, type ProvinciaArbolDTO } from "@/lib/types/geografia-nodo";

const listarArbolGeograficoMock = vi.fn();
const crearNodoGeograficoMock = vi.fn();
const cambiarActivacionGeograficaMock = vi.fn();
const contarOrdenesSinEntregarDeNodoMock = vi.fn();
vi.mock("@/lib/actions/geografia", () => ({
  listarArbolGeografico: (...a: unknown[]) => listarArbolGeograficoMock(...a),
  crearNodoGeografico: (...a: unknown[]) => crearNodoGeograficoMock(...a),
  cambiarActivacionGeografica: (...a: unknown[]) => cambiarActivacionGeograficaMock(...a),
  contarOrdenesSinEntregarDeNodo: (...a: unknown[]) =>
    contarOrdenesSinEntregarDeNodoMock(...a),
}));

const toastMock = {
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
  show: vi.fn(),
  dismiss: vi.fn(),
};
vi.mock("@/hooks/useToast", () => ({ useToast: () => toastMock }));

import { GeografiaAdminModule } from "@/app/(app)/configuracion/geografia/_components/GeografiaAdminModule";

// -------------------------------------------------------------------------------------------------
// EL ÁRBOL DE PRUEBA
// -------------------------------------------------------------------------------------------------
//
//  Puntarenas (activa)
//    Buenos Aires (activo) → Cabagra [Zona Sur]  ·  Volcán [Zona Sur, RETIRADO por su cuenta]
//    Osa (RETIRADO)        → Puerto Cortés [GAM Oeste, flag propio ENCENDIDO ⇒ heredado]
//  Alajuela (RETIRADA)
//    Palmares (activo ⇒ heredado) → Zaragoza (activo ⇒ heredado, SIN zona utilizable)
//  Limón (activa)
//    Guácimo (activo)      → Mercedes [Zona Caribe]  ·  Pocora [Zona Caribe]
//
// «Zona Caribe» tiene DOS distritos a propósito: retirar uno de los dos no la deja sin cobertura, y
// sin ese caso el aviso de zonas pasaría en verde con una función que las nombra siempre.
function distrito(
  id: string,
  nombre: string,
  zona: { id: string; nombre: string } | null,
  activo = true,
) {
  return {
    id,
    nombre,
    zonaId: zona?.id ?? null,
    zonaNombre: zona?.nombre ?? null,
    zonaEspecial: false,
    activo,
  };
}

const ZONA_SUR = { id: "z-sur", nombre: "Zona Sur" };
const ZONA_GAM = { id: "z-gam", nombre: "GAM Oeste" };
const ZONA_CARIBE = { id: "z-car", nombre: "Zona Caribe" };

function arbol(): ProvinciaArbolDTO[] {
  return [
    {
      id: "p-pu",
      nombre: "Puntarenas",
      activo: true,
      cantones: [
        {
          id: "c-ba",
          nombre: "Buenos Aires",
          activo: true,
          distritos: [
            distrito("d-cab", "Cabagra", ZONA_SUR),
            distrito("d-vol", "Volcán", ZONA_SUR, false),
          ],
        },
        {
          id: "c-osa",
          nombre: "Osa",
          activo: false,
          distritos: [distrito("d-cortes", "Puerto Cortés", ZONA_GAM)],
        },
      ],
    },
    {
      id: "p-al",
      nombre: "Alajuela",
      activo: false,
      cantones: [
        {
          id: "c-pal",
          nombre: "Palmares",
          activo: true,
          distritos: [distrito("d-zar", "Zaragoza", null)],
        },
      ],
    },
    {
      id: "p-li",
      nombre: "Limón",
      activo: true,
      cantones: [
        {
          id: "c-gua",
          nombre: "Guácimo",
          activo: true,
          distritos: [
            distrito("d-mer", "Mercedes", ZONA_CARIBE),
            distrito("d-poc", "Pocora", ZONA_CARIBE),
          ],
        },
      ],
    },
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  listarArbolGeograficoMock.mockResolvedValue({ status: "ok", provincias: arbol() });
  contarOrdenesSinEntregarDeNodoMock.mockResolvedValue({ status: "ok", ordenes: 0 });
});

afterEach(() => {
  cleanup();
});

function montar() {
  const user = userEvent.setup();
  render(<GeografiaAdminModule initialProvincias={arbol()} />);
  return user;
}

/** Despliega el árbol entero pulsando los expansores reales, uno a uno, hasta que no queda ninguno. */
async function expandirTodo(user: ReturnType<typeof userEvent.setup>) {
  for (let vueltas = 0; vueltas < 40; vueltas += 1) {
    const [boton] = screen.queryAllByRole("button", { name: /^Expandir / });
    if (boton === undefined) return;
    await user.click(boton);
  }
  throw new Error("expandirTodo no convergió: quedan expansores sin abrir");
}

/** La fila de un nodo, por su `data-nodo`. Devolver el contenedor permite afirmar QUÉ fila lleva
 *  cada distintivo, en vez de que el distintivo exista en algún sitio de la pantalla. */
function fila(nivel: string, id: string): HTMLElement {
  const nodo = document.querySelector(`[data-nodo="${nivel}:${id}"]`);
  if (nodo === null) throw new Error(`no está en pantalla la fila ${nivel}:${id}`);
  return nodo as HTMLElement;
}

function nodosEnPantalla(): string[] {
  return [...document.querySelectorAll("[data-nodo]")].map(
    (n) => n.getAttribute("data-nodo") ?? "",
  );
}

const dialogo = () => screen.getByRole("dialog");

// -------------------------------------------------------------------------------------------------

describe("374/R39 — el buscador de la pantalla", () => {
  it("«cabagra» deja solo el camino hasta Cabagra, ya desplegado", async () => {
    montar();
    await userEvent.type(
      screen.getByRole("searchbox", { name: "Buscar en el catálogo geográfico" }),
      "cabagra",
    );
    await waitFor(() =>
      expect(nodosEnPantalla()).toEqual(["provincia:p-pu", "canton:c-ba", "distrito:d-cab"]),
    );
  });

  it("⭑ «san  jose» con dos espacios encuentra igual (la normalización colapsa espacios)", async () => {
    render(
      <GeografiaAdminModule
        initialProvincias={[
          {
            id: "p-sj",
            nombre: "San José",
            activo: true,
            cantones: [],
          },
        ]}
      />,
    );
    await userEvent.type(
      screen.getByRole("searchbox", { name: "Buscar en el catálogo geográfico" }),
      "san  jose",
    );
    await waitFor(() => expect(nodosEnPantalla()).toEqual(["provincia:p-sj"]));
  });

  it("un texto sin coincidencias lo dice en vez de dejar el árbol vacío y mudo", async () => {
    montar();
    await userEvent.type(
      screen.getByRole("searchbox", { name: "Buscar en el catálogo geográfico" }),
      "zzzz",
    );
    expect(await screen.findByText("Sin resultados.")).toBeInTheDocument();
  });
});

describe("374/R40 — el distintivo de estado tiene DOS sabores", () => {
  it("el flag propio apagado dice «Inactivo»; el heredado NOMBRA al ascendiente", async () => {
    const user = montar();
    await expandirTodo(user);

    // Volcán: su propio flag está apagado.
    expect(within(fila("distrito", "d-vol")).getByText("Inactivo")).toBeInTheDocument();
    // Puerto Cortés: su flag está ENCENDIDO; lo que está retirado es su cantón.
    expect(
      within(fila("distrito", "d-cortes")).getByText("Inactivo por su cantón"),
    ).toBeInTheDocument();
    // Palmares y Zaragoza cuelgan de una provincia retirada.
    expect(
      within(fila("canton", "c-pal")).getByText("Inactivo por su provincia"),
    ).toBeInTheDocument();
    expect(
      within(fila("distrito", "d-zar")).getByText("Inactivo por su provincia"),
    ).toBeInTheDocument();
  });

  it("un nodo disponible no lleva ningún distintivo de estado", async () => {
    const user = montar();
    await expandirTodo(user);

    const cabagra = within(fila("distrito", "d-cab"));
    expect(cabagra.queryByText("Inactivo")).toBeNull();
    expect(cabagra.queryByText("Inactivo por su cantón")).toBeNull();
    expect(cabagra.queryByText("Inactivo por su provincia")).toBeNull();
  });
});

describe("374/R41 — «Activar» apagado, con el motivo perceptible sin pulsarlo", () => {
  it("⭑ en el inactivo HEREDADO va deshabilitado y su nombre accesible dice por qué", async () => {
    const user = montar();
    await expandirTodo(user);

    const boton = screen.getByRole("button", {
      name: "Activar Puerto Cortés. Su cantón está retirado: primero hay que devolverlo al catálogo.",
    });
    expect(boton).toBeDisabled();
    // El motivo va TAMBIÉN en el `title`: un botón deshabilitado no recibe foco, así que dejarlo
    // solo en el nombre accesible lo escondería a quien navega con el ratón.
    expect(boton).toHaveAttribute(
      "title",
      "Su cantón está retirado: primero hay que devolverlo al catálogo.",
    );

    await user.click(boton);
    expect(cambiarActivacionGeograficaMock).not.toHaveBeenCalled();
  });

  it("en el inactivo PROPIO, en cambio, «Activar» funciona aunque su padre siga retirado", async () => {
    const user = montar();
    await expandirTodo(user);

    const boton = screen.getByRole("button", { name: "Activar Volcán" });
    expect(boton).toBeEnabled();
    expect(boton).not.toHaveAttribute("title");

    cambiarActivacionGeograficaMock.mockResolvedValue({
      status: "ok",
      nivel: "distrito",
      id: "d-vol",
      activo: true,
    });
    await user.click(boton);

    expect(cambiarActivacionGeograficaMock).toHaveBeenCalledWith({
      nivel: "distrito",
      id: "d-vol",
      activo: true,
    });
    // Activar es ADITIVO: no pide confirmación.
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("el cantón heredado también lo dice, nombrando a su PROVINCIA", async () => {
    const user = montar();
    await expandirTodo(user);

    const boton = screen.getByRole("button", {
      name: "Activar Palmares. Su provincia está retirada: primero hay que devolverla al catálogo.",
    });
    expect(boton).toBeDisabled();
  });
});

describe("374/R42 — la marca «sin zona» del distrito", () => {
  it("⭑ el distrito sin zona utilizable la lleva; el que tiene zona, no", async () => {
    const user = montar();
    await expandirTodo(user);

    expect(within(fila("distrito", "d-zar")).getByText("Sin zona")).toBeInTheDocument();
    expect(within(fila("distrito", "d-cab")).queryByText("Sin zona")).toBeNull();
    // Y el que tiene zona la nombra, que es lo que hace evidente el contraste.
    expect(within(fila("distrito", "d-cab")).getByText("(zona: Zona Sur)")).toBeInTheDocument();
  });

  it("la marca lleva su ayuda: dónde se administra la zona", async () => {
    const user = montar();
    await expandirTodo(user);

    expect(within(fila("distrito", "d-zar")).getByText("Sin zona")).toHaveAttribute(
      "title",
      "Este distrito no tiene una zona utilizable. Las zonas se administran en Tarifas.",
    );
  });
});

describe("374/R43 — el alta, con el padre que cada nivel exige", () => {
  beforeEach(() => {
    crearNodoGeograficoMock.mockResolvedValue({ status: "ok", id: "nuevo", nivel: "provincia" });
  });

  /** Rellena y envía el formulario de alta que esté abierto. */
  async function guardarConNombre(
    user: ReturnType<typeof userEvent.setup>,
    valor: string,
  ) {
    await user.type(screen.getByLabelText(/Nombre/), valor);
    await user.click(screen.getByRole("button", { name: "Guardar" }));
  }

  it("la de PROVINCIA no exige padre y no manda ninguna clave de más", async () => {
    const user = montar();
    await user.click(screen.getByRole("button", { name: "Crear provincia" }));
    await guardarConNombre(user, "Cartago");

    const [cuerpo] = crearNodoGeograficoMock.mock.calls[0];
    expect(cuerpo).toEqual({ nivel: "provincia", nombre: "Cartago" });
    // El schema del borde es `.strict()`: una clave de más sería `validation_error`, no un campo
    // ignorado en silencio. Se valida contra el schema REAL, que es el contrato.
    expect(crearNodoGeograficoSchema.safeParse(cuerpo).success).toBe(true);
  });

  it("la de CANTÓN exige la provincia desde la que se abrió", async () => {
    const user = montar();
    await expandirTodo(user);
    await user.click(screen.getByRole("button", { name: "Añadir cantón a Puntarenas" }));
    expect(screen.getByText("Dentro de Puntarenas.")).toBeInTheDocument();
    await guardarConNombre(user, "Golfito");

    const [cuerpo] = crearNodoGeograficoMock.mock.calls[0];
    expect(cuerpo).toEqual({ nivel: "canton", nombre: "Golfito", provinciaId: "p-pu" });
    expect(crearNodoGeograficoSchema.safeParse(cuerpo).success).toBe(true);
  });

  it("la de DISTRITO exige el cantón desde el que se abrió", async () => {
    const user = montar();
    await expandirTodo(user);
    await user.click(screen.getByRole("button", { name: "Añadir distrito a Buenos Aires" }));
    expect(screen.getByText("Dentro de Buenos Aires.")).toBeInTheDocument();
    await guardarConNombre(user, "Chánguena");

    const [cuerpo] = crearNodoGeograficoMock.mock.calls[0];
    expect(cuerpo).toEqual({ nivel: "distrito", nombre: "Chánguena", cantonId: "c-ba" });
    expect(crearNodoGeograficoSchema.safeParse(cuerpo).success).toBe(true);
  });

  it("un nombre en blanco no llega al servidor: lo corta la misma normalización que él aplica", async () => {
    const user = montar();
    await user.click(screen.getByRole("button", { name: "Crear provincia" }));
    await user.type(screen.getByLabelText(/Nombre/), "    ");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(crearNodoGeograficoMock).not.toHaveBeenCalled();
    expect(screen.getByText("Este campo es obligatorio.")).toBeInTheDocument();
  });

  it("los espacios sobrantes se colapsan ANTES de enviar, igual que hace el servidor", async () => {
    const user = montar();
    await user.click(screen.getByRole("button", { name: "Crear provincia" }));
    await guardarConNombre(user, "  San   José  ");

    expect(crearNodoGeograficoMock.mock.calls[0][0]).toEqual({
      nivel: "provincia",
      nombre: "San José",
    });
  });
});

describe("374/R44 y R63 — la confirmación de retirar", () => {
  async function abrirConfirmacion(
    user: ReturnType<typeof userEvent.setup>,
    nombre: string,
  ) {
    await expandirTodo(user);
    await user.click(screen.getByRole("button", { name: `Desactivar ${nombre}` }));
    return await screen.findByRole("dialog");
  }

  it("⭑ abrir la confirmación NO llama a la acción, y Cancelar tampoco", async () => {
    const user = montar();
    await abrirConfirmacion(user, "Cabagra");
    expect(cambiarActivacionGeograficaMock).not.toHaveBeenCalled();

    await user.click(within(dialogo()).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(cambiarActivacionGeograficaMock).not.toHaveBeenCalled();
  });

  it("nombra las zonas que se quedarían sin distritos disponibles Y deja confirmar", async () => {
    const user = montar();
    // Zona Sur solo se sostiene con Cabagra: Volcán ya está retirado.
    await abrirConfirmacion(user, "Cabagra");

    expect(
      within(dialogo()).getByText(
        "Estas zonas se quedarían sin ningún distrito disponible: Zona Sur.",
      ),
    ).toBeInTheDocument();
    // AVISA; NO BLOQUEA (design §9, A4).
    await waitFor(() =>
      expect(within(dialogo()).getByRole("button", { name: "Retirar" })).toBeEnabled(),
    );
  });

  it("cuando la zona sigue teniendo distritos, no se nombra ninguna", async () => {
    const user = montar();
    // Zona Caribe tiene Mercedes Y Pocora: retirar uno no la deja sin cobertura.
    await abrirConfirmacion(user, "Mercedes");

    expect(within(dialogo()).queryByText(/se quedarían sin ningún distrito/)).toBeNull();
  });

  it("⭑ R63 — el cuerpo tiene el nodo, las zonas y el conteo, y NI UNA línea más", async () => {
    const user = montar();
    contarOrdenesSinEntregarDeNodoMock.mockResolvedValue({ status: "ok", ordenes: 7 });
    await abrirConfirmacion(user, "Cabagra");

    await waitFor(() =>
      expect(
        within(dialogo()).getByText("Órdenes sin entregar en este nodo: 7."),
      ).toBeInTheDocument(),
    );
    expect(within(dialogo()).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Vas a retirar «Cabagra» (Distrito).",
      "Estas zonas se quedarían sin ningún distrito disponible: Zona Sur.",
      "Órdenes sin entregar en este nodo: 7.",
    ]);
  });

  it("sin zonas en riesgo el cuerpo baja a DOS líneas: el nodo y el conteo", async () => {
    const user = montar();
    contarOrdenesSinEntregarDeNodoMock.mockResolvedValue({ status: "ok", ordenes: 0 });
    await abrirConfirmacion(user, "Mercedes");

    await waitFor(() =>
      expect(within(dialogo()).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
        "Vas a retirar «Mercedes» (Distrito).",
        "Órdenes sin entregar en este nodo: 0.",
      ]),
    );
  });

  it("confirmar manda el estado DESEADO (`activo: false`), no un toggle", async () => {
    const user = montar();
    cambiarActivacionGeograficaMock.mockResolvedValue({
      status: "ok",
      nivel: "canton",
      id: "c-ba",
      activo: false,
    });
    await abrirConfirmacion(user, "Buenos Aires");
    await waitFor(() =>
      expect(within(dialogo()).getByRole("button", { name: "Retirar" })).toBeEnabled(),
    );
    await user.click(within(dialogo()).getByRole("button", { name: "Retirar" }));

    await waitFor(() =>
      expect(cambiarActivacionGeograficaMock).toHaveBeenCalledWith({
        nivel: "canton",
        id: "c-ba",
        activo: false,
      }),
    );
  });
});

describe("374/R60 y R62 — el conteo de órdenes sin entregar", () => {
  it("⭑ se pide al abrirse, y hasta que llega no se puede confirmar", async () => {
    let resolver: (valor: unknown) => void = () => {};
    contarOrdenesSinEntregarDeNodoMock.mockImplementation(
      () =>
        new Promise((cumplir) => {
          resolver = cumplir;
        }),
    );

    const user = montar();
    await expandirTodo(user);
    await user.click(screen.getByRole("button", { name: "Desactivar Cabagra" }));
    await screen.findByRole("dialog");

    expect(contarOrdenesSinEntregarDeNodoMock).toHaveBeenCalledWith({
      nivel: "distrito",
      id: "d-cab",
    });
    expect(
      within(dialogo()).getByText("Contando las órdenes sin entregar de este nodo…"),
    ).toBeInTheDocument();
    expect(within(dialogo()).getByRole("button", { name: "Retirar" })).toBeDisabled();

    resolver({ status: "ok", ordenes: 40 });

    await waitFor(() =>
      expect(
        within(dialogo()).getByText("Órdenes sin entregar en este nodo: 40."),
      ).toBeInTheDocument(),
    );
    expect(within(dialogo()).getByRole("button", { name: "Retirar" })).toBeEnabled();
  });

  it("⭑ R62 — si el conteo falla, la confirmación lo dice y NO bloquea", async () => {
    contarOrdenesSinEntregarDeNodoMock.mockRejectedValue(new Error("caída"));

    const user = montar();
    await expandirTodo(user);
    await user.click(screen.getByRole("button", { name: "Desactivar Cabagra" }));
    await screen.findByRole("dialog");

    await waitFor(() =>
      expect(
        within(dialogo()).getByText(
          "No se pudo contar las órdenes sin entregar de este nodo. Puedes retirarlo igual.",
        ),
      ).toBeInTheDocument(),
    );
    expect(within(dialogo()).getByRole("button", { name: "Retirar" })).toBeEnabled();
  });

  it("un desenlace que no es `ok` cuenta como «no se pudo», no como cero", async () => {
    // Un `forbidden` pintado como «0 órdenes sin entregar» sería una mentira tranquilizadora.
    contarOrdenesSinEntregarDeNodoMock.mockResolvedValue({ status: "forbidden" });

    const user = montar();
    await expandirTodo(user);
    await user.click(screen.getByRole("button", { name: "Desactivar Cabagra" }));
    await screen.findByRole("dialog");

    await waitFor(() =>
      expect(
        within(dialogo()).getByText(
          "No se pudo contar las órdenes sin entregar de este nodo. Puedes retirarlo igual.",
        ),
      ).toBeInTheDocument(),
    );
    expect(within(dialogo()).queryByText(/Órdenes sin entregar en este nodo/)).toBeNull();
  });
});

describe("374/R45 — un mensaje distinto por desenlace, y relectura del árbol", () => {
  it("éxito: lo dice y relee", async () => {
    const user = montar();
    cambiarActivacionGeograficaMock.mockResolvedValue({
      status: "ok",
      nivel: "distrito",
      id: "d-vol",
      activo: true,
    });
    await expandirTodo(user);
    await user.click(screen.getByRole("button", { name: "Activar Volcán" }));

    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith("Distrito «Volcán» devuelto al catálogo."),
    );
    expect(listarArbolGeograficoMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["not_found", "Ese nodo ya no está en el catálogo."],
    ["forbidden", "No tienes permiso para esta acción."],
    ["unauthenticated", "Tu sesión expiró."],
    ["validation_error", "Revisa los campos: el formulario está incompleto."],
  ])("%s muestra su propio mensaje y relee el árbol", async (status, mensaje) => {
    const user = montar();
    cambiarActivacionGeograficaMock.mockResolvedValue({ status, fieldErrors: {} });
    await expandirTodo(user);
    await user.click(screen.getByRole("button", { name: "Activar Volcán" }));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith(mensaje));
    expect(listarArbolGeograficoMock).toHaveBeenCalledTimes(1);
  });

  it("conflicto: el alta lo dice en el toast Y en el campo del nombre", async () => {
    const user = montar();
    crearNodoGeograficoMock.mockResolvedValue({ status: "conflict" });
    await user.click(screen.getByRole("button", { name: "Crear provincia" }));
    await user.type(screen.getByLabelText(/Nombre/), "Puntarenas");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        "Ya existe un nodo con ese nombre bajo el mismo padre.",
      ),
    );
    expect(
      screen.getByText("Ya existe un nodo con ese nombre bajo el mismo padre."),
    ).toBeInTheDocument();
    expect(listarArbolGeograficoMock).toHaveBeenCalledTimes(1);
  });

  it("los seis mensajes son SEIS textos distintos", () => {
    const mensajes = [
      "Distrito «Volcán» devuelto al catálogo.",
      "Ese nodo ya no está en el catálogo.",
      "No tienes permiso para esta acción.",
      "Tu sesión expiró.",
      "Revisa los campos: el formulario está incompleto.",
      "Ya existe un nodo con ese nombre bajo el mismo padre.",
    ];
    expect(new Set(mensajes).size).toBe(6);
  });

  it("si la relectura falla, la pantalla lo avisa en vez de quedarse con datos viejos", async () => {
    const user = montar();
    cambiarActivacionGeograficaMock.mockResolvedValue({
      status: "ok",
      nivel: "distrito",
      id: "d-vol",
      activo: true,
    });
    listarArbolGeograficoMock.mockResolvedValue({ status: "unauthenticated" });
    await expandirTodo(user);
    await user.click(screen.getByRole("button", { name: "Activar Volcán" }));

    expect(
      await screen.findByText("No se pudo cargar el catálogo geográfico."),
    ).toBeInTheDocument();
  });
});

describe("374/R58 y R59 — el filtro de estado, en la pantalla", () => {
  it("«Retirados» deja solo los no disponibles (y sus padres como camino)", async () => {
    const user = montar();
    await user.click(screen.getByRole("button", { name: "Retirados" }));

    await waitFor(() =>
      expect(nodosEnPantalla()).toEqual([
        "provincia:p-pu",
        "canton:c-ba",
        "distrito:d-vol",
        "canton:c-osa",
        "distrito:d-cortes",
        "provincia:p-al",
        "canton:c-pal",
        "distrito:d-zar",
      ]),
    );
  });

  it("«Activos» deja solo los disponibles", async () => {
    const user = montar();
    await user.click(screen.getByRole("button", { name: "Activos" }));

    await waitFor(() =>
      expect(nodosEnPantalla()).toEqual([
        "provincia:p-pu",
        "canton:c-ba",
        "distrito:d-cab",
        "provincia:p-li",
        "canton:c-gua",
        "distrito:d-mer",
        "distrito:d-poc",
      ]),
    );
  });

  it("R59 — texto y estado se componen: «volcan» + «Activos» no devuelve nada", async () => {
    const user = montar();
    await user.type(
      screen.getByRole("searchbox", { name: "Buscar en el catálogo geográfico" }),
      "volcan",
    );
    await user.click(screen.getByRole("button", { name: "Activos" }));

    expect(await screen.findByText("Sin resultados.")).toBeInTheDocument();
  });

  it("⭑ mover el conmutador NO dispara ninguna llamada al servidor", async () => {
    const user = montar();
    for (const opcion of ["Retirados", "Activos", "Todos"]) {
      await user.click(screen.getByRole("button", { name: opcion }));
    }

    expect(listarArbolGeograficoMock).not.toHaveBeenCalled();
    expect(crearNodoGeograficoMock).not.toHaveBeenCalled();
    expect(cambiarActivacionGeograficaMock).not.toHaveBeenCalled();
    expect(contarOrdenesSinEntregarDeNodoMock).not.toHaveBeenCalled();
  });

  it("el conmutador anuncia cuál está elegido", async () => {
    const user = montar();
    expect(screen.getByRole("button", { name: "Todos" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.click(screen.getByRole("button", { name: "Retirados" }));
    expect(screen.getByRole("button", { name: "Retirados" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Todos" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
});
