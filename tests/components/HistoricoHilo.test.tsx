// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";

import type { ChatMensajeVista } from "@/lib/types/chat-whatsapp";
import type { CursorMensaje } from "@/lib/types/historico-conversaciones";
import { HistoricoConversacionesModule } from "@/app/(app)/historico/conversaciones/_components/HistoricoConversacionesModule";

import {
  AHORA,
  AYER_ISO,
  HOY_ISO,
  MIERCOLES_ISO,
  dispararCentinela,
  hilo,
  instalarObservador,
  mensaje,
  okHilos,
  okMensajes,
  renderHistorico,
} from "./_historico-harness";

// Feature 321 / T6.2 y T6.3 (R16, R18, R21, R22, R23, R28, R40, R43) — el HILO abierto.
//
// Aquí se afirma lo que la reutilización de las burbujas del chat del mensajero NO daba hecho:
// el separador de día, la cabecera del hilo fusionado, la cronología entrelazada y —sobre
// todo— el scroll inverso que no salta. El último caso de este archivo es el que mata la
// implementación ingenua de R22: sin la corrección, `scrollTop` se queda en 0.

const CURSOR_ANTERIOR: CursorMensaje = {
  ocurridoAt: MIERCOLES_ISO,
  id: "m-borde",
};

const listarHilos = vi.fn(async () => okHilos([hilo()]));

beforeEach(() => {
  instalarObservador();
  listarHilos.mockClear();
});

afterEach(cleanup);

function renderPantalla(listarMensajes: ReturnType<typeof vi.fn>) {
  return renderHistorico(
    <HistoricoConversacionesModule
      mensajeros={[]}
      acciones={{ listarHilos, listarMensajes: listarMensajes as never }}
      ahora={AHORA}
    />,
  );
}

/** Abre el único hilo del listado y espera a que aterrice su primera página. */
async function abrirHilo() {
  fireEvent.click(await screen.findByRole("button", { name: /María González/ }));
  return screen.findByRole("list", { name: "Historial de mensajes" });
}

/** Las BURBUJAS del hilo: los `<li>` de mensaje, sin los separadores de día. */
function burbujas(): HTMLElement[] {
  const lista = screen.queryByRole("list", { name: "Historial de mensajes" });
  return lista === null ? [] : within(lista).queryAllByRole("listitem");
}

describe("T6.2 — las dos direcciones, en una sola cronología (R16/R40)", () => {
  it("pinta entrantes y salientes entrelazados, en el orden devuelto", async () => {
    const mensajes: ChatMensajeVista[] = [
      mensaje({ id: "a", direccion: "entrante", cuerpo: "uno", ocurridoAt: HOY_ISO }),
      mensaje({ id: "b", direccion: "saliente", cuerpo: "dos", ocurridoAt: HOY_ISO }),
      mensaje({ id: "c", direccion: "entrante", cuerpo: "tres", ocurridoAt: HOY_ISO }),
      mensaje({ id: "d", direccion: "saliente", cuerpo: "cuatro", ocurridoAt: HOY_ISO }),
    ];
    const listarMensajes = vi.fn(async () => okMensajes(mensajes));
    renderPantalla(listarMensajes);
    const lista = await abrirHilo();

    const direcciones = [...lista.querySelectorAll("li[data-direccion]")].map((li) =>
      li.getAttribute("data-direccion"),
    );
    expect(direcciones).toEqual(["entrante", "saliente", "entrante", "saliente"]);
    // El orden del DOM es el cronológico devuelto, no uno reagrupado por dirección.
    expect(lista.textContent?.indexOf("uno")).toBeLessThan(
      lista.textContent?.indexOf("cuatro") ?? -1,
    );
  });

  it("no hay pestañas ni secciones por dirección (R40)", async () => {
    const listarMensajes = vi.fn(async () =>
      okMensajes([mensaje({ id: "a" }), mensaje({ id: "b", direccion: "saliente" })]),
    );
    renderPantalla(listarMensajes);
    await abrirHilo();

    expect(screen.queryByRole("tablist")).toBeNull();
  });
});

describe("T6.2 — separador de día (R23)", () => {
  const MENSAJES: ChatMensajeVista[] = [
    mensaje({ id: "v1", cuerpo: "viejo uno", ocurridoAt: MIERCOLES_ISO }),
    mensaje({ id: "v2", cuerpo: "viejo dos", ocurridoAt: MIERCOLES_ISO }),
    mensaje({ id: "v3", cuerpo: "viejo tres", ocurridoAt: MIERCOLES_ISO }),
    mensaje({ id: "a1", cuerpo: "de ayer", ocurridoAt: AYER_ISO }),
    mensaje({ id: "h1", cuerpo: "de hoy", ocurridoAt: HOY_ISO }),
    mensaje({ id: "h2", cuerpo: "de hoy también", ocurridoAt: HOY_ISO }),
  ];

  it("dice «hoy», «ayer» y el día largo, y cada uno UNA sola vez", async () => {
    const listarMensajes = vi.fn(async () => okMensajes(MENSAJES));
    renderPantalla(listarMensajes);
    const lista = await abrirHilo();

    // `getByText` lanza si hay más de una coincidencia: eso es lo que afirma que el día con
    // TRES mensajes lleva un solo separador. Se busca DENTRO del hilo porque la fila del
    // listado rotula su última actividad con el mismo calendario («hoy»), y eso es correcto.
    expect(within(lista).getByText("hoy")).toBeInTheDocument();
    expect(within(lista).getByText("ayer")).toBeInTheDocument();
    expect(within(lista).getByText("miércoles 26 de agosto")).toBeInTheDocument();
  });

  it("el separador NUNCA lleva año", async () => {
    const listarMensajes = vi.fn(async () =>
      okMensajes([
        mensaje({ id: "antiguo", cuerpo: "del año pasado", ocurridoAt: "2025-08-28T18:00:00.000Z" }),
        ...MENSAJES,
      ]),
    );
    const { container } = renderPantalla(listarMensajes);
    const lista = await abrirHilo();

    expect(within(lista).getByText("jueves 28 de agosto")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\bde 20\d{2}\b/);
  });

  // Los separadores no son elementos de la lista de mensajes: son marcas estructurales. Si
  // contaran como `listitem`, cualquier conteo de burbujas mentiría.
  it("los separadores no se cuentan como burbujas", async () => {
    const listarMensajes = vi.fn(async () => okMensajes(MENSAJES));
    renderPantalla(listarMensajes);
    await abrirHilo();

    expect(burbujas()).toHaveLength(MENSAJES.length);
  });
});

describe("T6.2 — reacciones ancladas, no burbujas sueltas (R28)", () => {
  it("el emoji va en la burbuja de su mensaje y no hay burbuja de reacción", async () => {
    const listarMensajes = vi.fn(async () =>
      okMensajes([
        mensaje({ id: "objetivo", cuerpo: "Gracias", reacciones: [{ emoji: "👍", conteo: 1 }] }),
      ]),
    );
    renderPantalla(listarMensajes);
    await abrirHilo();

    const burbuja = burbujas()[0];
    expect(within(burbuja).getByRole("img", { name: /Reaccionó con 👍/ })).toBeInTheDocument();
    expect(screen.queryByText("Reacción a un mensaje")).toBeNull();
  });
});

describe("T6.2 — cabecera del hilo fusionado (R43)", () => {
  it("rotula orden, destinatario y mensajero, y avisa de los dos números", async () => {
    const listarMensajes = vi.fn(async () =>
      okMensajes([mensaje()], {
        cabecera: hilo({ telefonosCount: 2, telefonoVigente: "+50688884321" }),
      }),
    );
    renderPantalla(listarMensajes);
    await abrirHilo();

    const cabecera = screen.getByTestId("historico-hilo-cabecera");
    expect(within(cabecera).getByText("12345")).toBeInTheDocument();
    expect(within(cabecera).getByText("María González")).toBeInTheDocument();
    expect(within(cabecera).getByText("Ana Mora")).toBeInTheDocument();
    expect(within(cabecera).getByText("2 números")).toBeInTheDocument();
  });

  // El número ANTIGUO no va en la cabecera: su sitio es la burbuja de sistema, DENTRO del
  // hilo, que es donde se explica CUÁNDO cambió.
  it("el cambio de número se lee dentro del hilo, como burbuja de sistema", async () => {
    const listarMensajes = vi.fn(async () =>
      okMensajes([
        mensaje({
          id: "sis",
          tipo: "sistema",
          cuerpo: null,
          sistema: { telefonoAnterior: "+50688887777", telefonoNuevo: "+50699996666" },
        }),
      ]),
    );
    renderPantalla(listarMensajes);
    await abrirHilo();

    expect(screen.getByText(/cambió .* número/i)).toBeInTheDocument();
    expect(
      within(screen.getByTestId("historico-hilo-cabecera")).queryByText(/cambió/i),
    ).toBeNull();
  });
});

/* ========================================================================== */
/* T6.3 — scroll inverso                                                      */
/* ========================================================================== */

/** 30 mensajes de HOY, del más antiguo al más reciente. */
function pagina(prefijo: string, cuantos: number): ChatMensajeVista[] {
  return Array.from({ length: cuantos }, (_, i) =>
    mensaje({ id: `${prefijo}-${i}`, cuerpo: `${prefijo} ${i}`, ocurridoAt: HOY_ISO }),
  );
}

describe("T6.3 — el hilo se abre en lo más reciente y NO se carga de golpe (R18/R21)", () => {
  it("pide UNA sola página y pinta 30 burbujas, no las 100 del hilo", async () => {
    const listarMensajes = vi.fn(async () =>
      okMensajes(pagina("reciente", 30), { anterior: CURSOR_ANTERIOR }),
    );
    renderPantalla(listarMensajes);
    await abrirHilo();

    expect(listarMensajes).toHaveBeenCalledTimes(1);
    expect(burbujas()).toHaveLength(30);
  });

  it("el mensaje MÁS RECIENTE está en el DOM en el primer render", async () => {
    const listarMensajes = vi.fn(async () =>
      okMensajes(pagina("reciente", 30), { anterior: CURSOR_ANTERIOR }),
    );
    renderPantalla(listarMensajes);
    await abrirHilo();

    expect(screen.getByText("reciente 29")).toBeInTheDocument();
    expect(screen.queryByText("antigua 0")).toBeNull();
  });
});

describe("T6.3 — al cargar la página anterior, el scroll NO salta (R22)", () => {
  it("conserva la posición de lectura: `scrollTop` se corrige con lo que creció el contenido", async () => {
    const listarMensajes = vi
      .fn()
      .mockResolvedValueOnce(okMensajes(pagina("reciente", 30), { anterior: CURSOR_ANTERIOR }))
      .mockResolvedValueOnce(okMensajes(pagina("antigua", 30), { anterior: null }));

    renderPantalla(listarMensajes);
    await abrirHilo();

    const contenedor = screen.getByTestId("historico-hilo-scroll");
    // El alto del contenido CRECE al insertar la página anterior: 2000 -> 4000. jsdom no hace
    // layout, así que se simula en función de cuántas burbujas hay en el DOM — que es
    // exactamente la relación real entre contenido y altura.
    Object.defineProperty(contenedor, "scrollHeight", {
      configurable: true,
      get: () =>
        contenedor.querySelectorAll("li[data-direccion]").length > 30 ? 4000 : 2000,
    });
    let posicion = 0;
    Object.defineProperty(contenedor, "scrollTop", {
      configurable: true,
      get: () => posicion,
      set: (valor: number) => {
        posicion = valor;
      },
    });

    // El lector está arriba del todo: es lo que dispara la carga hacia atrás.
    contenedor.scrollTop = 0;

    await act(async () => {
      expect(dispararCentinela(screen.getByTestId("hilo-centinela"))).toBe(true);
    });

    expect(listarMensajes).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: CURSOR_ANTERIOR }),
    );
    expect(burbujas()).toHaveLength(60);
    // SIN la corrección, la implementación ingenua deja esto en 0 y el lector pierde el sitio.
    expect(contenedor.scrollTop).toBe(2000);
  });

  it("la página anterior se inserta DELANTE: la cronología no se altera", async () => {
    const listarMensajes = vi
      .fn()
      .mockResolvedValueOnce(okMensajes(pagina("reciente", 2), { anterior: CURSOR_ANTERIOR }))
      .mockResolvedValueOnce(okMensajes(pagina("antigua", 2), { anterior: null }));

    renderPantalla(listarMensajes);
    const lista = await abrirHilo();

    await act(async () => {
      dispararCentinela(screen.getByTestId("hilo-centinela"));
    });

    const cuerpos = burbujas().map((li) => li.textContent ?? "");
    expect(cuerpos[0]).toContain("antigua 0");
    expect(cuerpos[3]).toContain("reciente 1");
    expect(lista).toBeInTheDocument();
  });

  it("sin cursor hacia atrás, el centinela no pide nada: el hilo está entero", async () => {
    const listarMensajes = vi.fn(async () => okMensajes(pagina("reciente", 3), { anterior: null }));
    renderPantalla(listarMensajes);
    await abrirHilo();

    await act(async () => {
      dispararCentinela(screen.getByTestId("hilo-centinela"));
    });

    expect(listarMensajes).toHaveBeenCalledTimes(1);
  });
});
