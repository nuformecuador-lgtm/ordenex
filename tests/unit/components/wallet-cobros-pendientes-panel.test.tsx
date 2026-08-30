// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import type { ReactElement } from "react";

import { ToastProvider } from "@/providers/ToastProvider";
import type { GastoFijoCobroDTO } from "@/lib/types/gasto-fijo-cobro";

// FICHA 333 (G5, R37/R38/R39/R40/R41/R42) — LA SECCIÓN DE COBROS DE GASTO FIJO POR APROBAR.
//
// Las tres Server Actions se mockean: aquí se mide LA PANTALLA, no el backend (que tiene sus
// propios tests de servicio y sus casos contra Postgres). Lo que estos casos afirman es lo que
// una persona ve y puede hacer: que la sección se note cuando hay algo, que no exista cuando no
// lo hay, que el número de la insignia sea el del SERVIDOR, que los botones de decidir sólo
// aparezcan para quien puede decidir, y que aprobar o rechazar refresque sin recargar la página.

const listarMock = vi.fn();
const aprobarMock = vi.fn();
const rechazarMock = vi.fn();
vi.mock("@/lib/actions/gasto-fijo-cobro", () => ({
  listarCobrosPendientesAction: (...a: unknown[]) => listarMock(...a),
  aprobarCobroGastoFijoAction: (...a: unknown[]) => aprobarMock(...a),
  rechazarCobroGastoFijoAction: (...a: unknown[]) => rechazarMock(...a),
  contarCobrosPendientesDePlantillaAction: vi.fn(),
}));

import { CobrosGastoFijoPendientesPanel } from "@/app/(app)/wallet/_components/CobrosGastoFijoPendientesPanel";
import {
  COBROS_PENDIENTES_DESCRIPCION,
  COBROS_PENDIENTES_SECCION,
  COBRO_MENSAJE,
} from "@/app/(app)/wallet/_components/cobro-gasto-fijo-labels";

/** El más antiguo de los tres: se generó el 27 de agosto. */
const VIEJO: GastoFijoCobroDTO = {
  id: "11111111-1111-1111-1111-111111111111",
  concepto: "Alquiler de bodega",
  monto: "300000.00",
  periodo: "2026-08",
  generadoEl: "2026-08-27",
  estado: "pendiente",
};

/** El del día siguiente, con período de DÍA (plantilla semanal): otra forma del mismo campo. */
const MEDIO: GastoFijoCobroDTO = {
  id: "22222222-2222-2222-2222-222222222222",
  concepto: "Combustible",
  monto: "45500.00",
  periodo: "2026-08-28",
  generadoEl: "2026-08-28",
  estado: "pendiente",
};

/** El más reciente. */
const NUEVO: GastoFijoCobroDTO = {
  id: "33333333-3333-3333-3333-333333333333",
  concepto: "Internet",
  monto: "45.00",
  periodo: "2026-08",
  generadoEl: "2026-08-29",
  estado: "pendiente",
};

function envolver(ui: ReactElement) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToastProvider>{ui}</ToastProvider>
    </SWRConfig>,
  );
}

/**
 * Monta la sección con su cola pre-obtenida. La lectura del servidor devuelve LO MISMO que las
 * props, para que la revalidación de SWR al montar no vacíe la tabla (mismo patrón que el panel
 * de plantillas). `total` va aparte de `items` a propósito: es el número del servidor.
 */
function montar(
  items: GastoFijoCobroDTO[],
  opciones: { total?: number; puedeDecidir?: boolean; onCambio?: () => void } = {},
) {
  const total = opciones.total ?? items.length;
  listarMock.mockResolvedValue({ status: "ok", items, total });
  return envolver(
    <CobrosGastoFijoPendientesPanel
      initialData={{ items, total }}
      puedeDecidir={opciones.puedeDecidir ?? true}
      onCambio={opciones.onCambio}
    />,
  );
}

/** La sección, por su nombre accesible: es como llega quien navega por regiones. */
function seccion(): HTMLElement {
  return screen.getByRole("region", { name: COBROS_PENDIENTES_SECCION });
}

/** Las filas de DATOS de la tabla (sin la de encabezados). */
function filas(): HTMLElement[] {
  const tabla = within(seccion()).getByRole("table");
  return within(tabla).getAllByRole("row").slice(1);
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("CobrosGastoFijoPendientesPanel — la sección se nota, con las primitivas del módulo (R37)", () => {
  it("es una región con título, descripción, insignia de aviso y tabla", () => {
    montar([VIEJO, NUEVO]);

    const region = seccion();
    // Título VISIBLE (hasta ahora el nombre de la sección sólo existía en el árbol de
    // accesibilidad en otras tarjetas de esta página; aquí se lee en la pantalla).
    expect(within(region).getByText(COBROS_PENDIENTES_SECCION)).toBeInTheDocument();
    // La descripción dice lo que importa: ese dinero NO ha salido de la caja.
    expect(within(region).getByText(COBROS_PENDIENTES_DESCRIPCION)).toBeInTheDocument();
    // Y la tabla es la primitiva del repo, no una lista inventada.
    expect(within(region).getByRole("table")).toBeInTheDocument();
  });

  it("lo que llama la atención es un `Badge` del tema, no un color inventado", () => {
    // R37: «llama la atención pero se ve bien». El acento es una insignia con la variante
    // `warning` del sistema (`bg-warning-soft`/`text-warning-strong`), que es la única forma de
    // que el contraste siga siendo correcto en los DOS temas. Un estilo a mano se rompería en
    // uno de ellos y ninguna prueba lo diría.
    montar([VIEJO, NUEVO]);

    const insignia = seccion().querySelector('[data-slot="badge"]');
    expect(insignia, "la cabecera no tiene insignia").not.toBeNull();
    expect(insignia?.getAttribute("data-variant")).toBe("warning");
    expect(insignia?.textContent).toContain("2 por aprobar");
  });

  it("la sección NO ofrece descarga: es una cola de decisión, no un libro", () => {
    // design §7 y su entrada en el censo de tablas: lo que se aprueba aterriza en el libro de la
    // caja, que sí descarga. Si alguien le cablea `descarga` aquí, este caso lo dice — y el
    // censo, que se actualizó con el motivo, deja de ser cierto.
    montar([VIEJO, NUEVO]);

    expect(
      within(seccion()).queryByRole("button", { name: /descargar/i }),
    ).not.toBeInTheDocument();
  });
});

describe("CobrosGastoFijoPendientesPanel — sin cobros no hay sección (R38)", () => {
  it("con el total del servidor en cero no se renderiza NADA", () => {
    const { container } = montar([], { total: 0 });

    expect(
      screen.queryByRole("region", { name: COBROS_PENDIENTES_SECCION }),
    ).not.toBeInTheDocument();
    expect(container.textContent).toBe("");
  });

  it("y tampoco queda una tarjeta vacía cuando la cola se vacía mirándola", async () => {
    // El otro camino de R38: se aprueba el ÚLTIMO cobro sin recargar la ruta. La relectura
    // devuelve la cola vacía y la sección desaparece sola, sin dejar una tarjeta con una tabla
    // sin filas, que sería ruido permanente en la pantalla del dinero.
    const user = userEvent.setup();
    montar([VIEJO], { total: 1 });
    aprobarMock.mockResolvedValue({ status: "ok", yaEstabaEnElLibro: false });
    listarMock.mockResolvedValue({ status: "ok", items: [], total: 0 });

    await user.click(within(filas()[0]).getByRole("button", { name: "Aprobar" }));

    await waitFor(() =>
      expect(
        screen.queryByRole("region", { name: COBROS_PENDIENTES_SECCION }),
      ).not.toBeInTheDocument(),
    );
  }, 15000);
});

describe("CobrosGastoFijoPendientesPanel — qué enseña cada fila y en qué orden (R39)", () => {
  it("concepto, período, monto y fecha de generación, en ese orden y en palabras", () => {
    montar([MEDIO], { puedeDecidir: false });

    // Por ÍNDICE de celda y no por texto suelto: es lo único que distingue la columna del
    // período de la de la fecha de generación, que en una plantilla semanal valen lo mismo.
    const encabezados = within(seccion())
      .getAllByRole("columnheader")
      .map((c) => c.textContent);
    expect(encabezados).toEqual(["Concepto", "Período", "Monto", "Generado el"]);

    const celdas = within(filas()[0]).getAllByRole("cell");
    expect(celdas[0].textContent).toBe("Combustible");
    // Período de DÍA (plantilla semanal/diaria): «28 de agosto de 2026».
    expect(celdas[1].textContent).toBe("28 de agosto de 2026");
    // El monto, por `money`: con separador de miles y sin la cola de céntimos.
    expect(celdas[2].textContent).toBe("₡45.500");
    expect(celdas[3].textContent).toBe("28 de agosto de 2026");
  });

  it("un período MENSUAL se lee «agosto de 2026», no `2026-08`", () => {
    // La otra forma del mismo campo. Enseñar la cadena cruda dejaría en pantalla un dato con
    // formato de clave; y sin el año, dos períodos de agosto de años distintos serían iguales.
    montar([VIEJO]);

    const fila = filas()[0];
    expect(within(fila).getByText("agosto de 2026")).toBeInTheDocument();
    expect(fila.textContent).not.toContain("2026-08");
  });

  it("⭑ los ordena del MÁS ANTIGUO al más reciente, aunque lleguen al revés", () => {
    // El caso que DISCRIMINA: si la sección se limitara a pintar lo que recibe, este montaje
    // —deliberadamente desordenado— saldría al revés. R39 es una promesa de la sección.
    montar([NUEVO, VIEJO, MEDIO]);

    const conceptos = filas().map((f) => within(f).getAllByRole("cell")[0].textContent);
    expect(conceptos).toEqual(["Alquiler de bodega", "Combustible", "Internet"]);
  });

  it("⭑ el monto se pinta con `money` y NUNCA como número (R43)", () => {
    // Con siete cifras la diferencia se ve: el STRING crudo daría «300000.00» y una conversión
    // a número daría «300000». Sólo el camino money-safe da «₡300.000».
    montar([VIEJO]);

    const fila = filas()[0];
    expect(within(fila).getByText("₡300.000")).toBeInTheDocument();
    expect(fila.textContent).not.toContain("300000");
  });
});

describe("CobrosGastoFijoPendientesPanel — el número de la cabecera (R41)", () => {
  it("⭑ sale del `total` del SERVIDOR, no del largo de lo pintado", () => {
    // El caso que DISCRIMINA: el servidor recorta `items` por el tope del dominio y manda el
    // `total` real aparte. Con dos filas pintadas y siete pendientes, `items.length` diría «2».
    montar([VIEJO, NUEVO], { total: 7 });

    expect(within(seccion()).getByText("7 por aprobar")).toBeInTheDocument();
    expect(filas()).toHaveLength(2);
    expect(within(seccion()).queryByText("2 por aprobar")).not.toBeInTheDocument();
  });

  it("con un solo cobro el texto va en singular", () => {
    montar([VIEJO], { total: 1 });

    expect(within(seccion()).getByText("1 por aprobar")).toBeInTheDocument();
  });
});

describe("CobrosGastoFijoPendientesPanel — quién ve los botones (R40)", () => {
  it("el maestro ve Aprobar y Rechazar en cada fila", () => {
    montar([VIEJO, NUEVO], { puedeDecidir: true });

    expect(
      within(seccion()).getByRole("columnheader", { name: "Acciones" }),
    ).toBeInTheDocument();
    for (const fila of filas()) {
      expect(within(fila).getByRole("button", { name: "Aprobar" })).toBeInTheDocument();
      expect(within(fila).getByRole("button", { name: "Rechazar" })).toBeInTheDocument();
    }
  });

  it("⭑ el admin ve la tabla ENTERA y ningún botón de decisión", () => {
    // El admin tiene acceso total y VE la cola (R25), pero no puede decidirla (R24). Los datos
    // siguen ahí —esconderlos sería otra cosa distinta de la que la ficha pide—; lo que no está
    // es la columna de acciones.
    montar([VIEJO, NUEVO], { puedeDecidir: false });

    expect(filas()).toHaveLength(2);
    expect(within(seccion()).getByText("Alquiler de bodega")).toBeInTheDocument();
    expect(
      within(seccion()).queryByRole("columnheader", { name: "Acciones" }),
    ).not.toBeInTheDocument();
    expect(
      within(seccion()).queryByRole("button", { name: "Aprobar" }),
    ).not.toBeInTheDocument();
    expect(
      within(seccion()).queryByRole("button", { name: "Rechazar" }),
    ).not.toBeInTheDocument();
  });
});

describe("CobrosGastoFijoPendientesPanel — decidir refresca y avisa (R42)", () => {
  it("Aprobar manda SÓLO el id, avisa, relee la cola y avisa al módulo", async () => {
    const user = userEvent.setup();
    const onCambio = vi.fn();
    montar([VIEJO, NUEVO], { onCambio });
    await waitFor(() => expect(listarMock).toHaveBeenCalled());
    const lecturasAntes = listarMock.mock.calls.length;
    aprobarMock.mockResolvedValue({ status: "ok", yaEstabaEnElLibro: false });

    await user.click(within(filas()[0]).getByRole("button", { name: "Aprobar" }));

    await waitFor(() => expect(aprobarMock).toHaveBeenCalledTimes(1));
    // El monto NO viaja: lo pone el servidor desde la copia del cobro (R16). El schema del borde
    // es `.strict()`, así que mandar de más se rompería en producción y no aquí.
    expect(aprobarMock.mock.calls[0][0]).toEqual({ id: VIEJO.id });
    expect((await screen.findAllByText(COBRO_MENSAJE.aprobado)).length).toBeGreaterThan(0);
    // R42: la sección relee LO SUYO y el módulo refresca las cifras de la caja.
    await waitFor(() =>
      expect(listarMock.mock.calls.length).toBeGreaterThan(lecturasAntes),
    );
    expect(onCambio).toHaveBeenCalled();
  }, 15000);

  it("Rechazar manda sólo el id y dice que no salió nada de la caja", async () => {
    const user = userEvent.setup();
    const onCambio = vi.fn();
    montar([VIEJO], { onCambio });
    rechazarMock.mockResolvedValue({ status: "ok" });

    await user.click(within(filas()[0]).getByRole("button", { name: "Rechazar" }));

    await waitFor(() => expect(rechazarMock).toHaveBeenCalledTimes(1));
    expect(rechazarMock.mock.calls[0][0]).toEqual({ id: VIEJO.id });
    expect((await screen.findAllByText(COBRO_MENSAJE.rechazado)).length).toBeGreaterThan(0);
    expect(aprobarMock).not.toHaveBeenCalled();
    expect(onCambio).toHaveBeenCalled();
  }, 15000);

  it("⭑ «ya estaba en el libro» NO se anuncia como un cobro nuevo (R19)", async () => {
    // Si alguien cambió el interruptor de la plantilla a mitad de período, el movimiento ya
    // existía: el cobro se marca aprobado, se enlaza al que había y NO se cobra dos veces. Decir
    // «cobro aprobado» a secas escondería que el dinero salió antes.
    const user = userEvent.setup();
    montar([VIEJO]);
    aprobarMock.mockResolvedValue({ status: "ok", yaEstabaEnElLibro: true });

    await user.click(within(filas()[0]).getByRole("button", { name: "Aprobar" }));

    expect(
      (await screen.findAllByText(COBRO_MENSAJE.yaEstabaEnElLibro)).length,
    ).toBeGreaterThan(0);
    expect(screen.queryAllByText(COBRO_MENSAJE.aprobado)).toHaveLength(0);
  }, 15000);

  it("⭑ `ya_decidido` se cuenta como información, no como un error del usuario", async () => {
    // R17/R18: alguien decidió antes, o dos decisiones llegaron a la vez y el motor serializó.
    // El aviso lo dice con calma y la lista se relee, porque lo que se está viendo es viejo.
    const user = userEvent.setup();
    montar([VIEJO]);
    aprobarMock.mockResolvedValue({ status: "ya_decidido" });
    const lecturasAntes = listarMock.mock.calls.length;

    await user.click(within(filas()[0]).getByRole("button", { name: "Aprobar" }));

    const avisos = await screen.findAllByText(COBRO_MENSAJE.yaDecidido);
    expect(avisos.length).toBeGreaterThan(0);
    // El tono: el aviso sale como `info`, no como `error`. Los toasts exponen su variante.
    expect(
      document.querySelectorAll('[data-variant="error"]').length,
      "un cobro ya decidido se anunció como error",
    ).toBe(0);
    await waitFor(() =>
      expect(listarMock.mock.calls.length).toBeGreaterThan(lecturasAntes),
    );
  }, 15000);

  const FALLOS: ReadonlyArray<{ resultado: Record<string, unknown>; mensaje: string }> = [
    { resultado: { status: "forbidden" }, mensaje: COBRO_MENSAJE.sinPermiso },
    { resultado: { status: "unauthenticated" }, mensaje: COBRO_MENSAJE.sesionExpirada },
    { resultado: { status: "not_found" }, mensaje: COBRO_MENSAJE.noExiste },
    {
      resultado: { status: "validation_error", fieldErrors: {} },
      mensaje: COBRO_MENSAJE.noSePudo,
    },
  ];

  for (const { resultado, mensaje } of FALLOS) {
    it(`${String(resultado.status)} muestra su propio mensaje y ningún otro`, async () => {
      const user = userEvent.setup();
      montar([VIEJO]);
      aprobarMock.mockResolvedValue(resultado);

      await user.click(within(filas()[0]).getByRole("button", { name: "Aprobar" }));

      expect((await screen.findAllByText(mensaje)).length).toBeGreaterThan(0);
      for (const otro of FALLOS.filter((f) => f.mensaje !== mensaje)) {
        expect(screen.queryAllByText(otro.mensaje)).toHaveLength(0);
      }
      // Y no se anuncia un cobro que no ocurrió.
      expect(screen.queryAllByText(COBRO_MENSAJE.aprobado)).toHaveLength(0);
    }, 15000);
  }

  it("los cuatro mensajes de fallo son distintos entre sí", () => {
    // Anti-vacuidad de la tabla de arriba: con dos mensajes iguales, los «ningún otro» se
    // anularían entre sí y los casos quedarían verdes sin probar nada.
    expect(new Set(FALLOS.map((f) => f.mensaje)).size).toBe(FALLOS.length);
  });
});
