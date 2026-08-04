// @vitest-environment jsdom
// Feature 172 (T D.2) — la lista de COMPROBANTES de un beneficiario. Cubre R49, R50, R56, R74.
//
// Lo que esta tabla tiene que garantizar es que un pago se puede AUDITAR desde la pantalla:
// cuánto, cómo, con qué referencia, quién lo anotó y cuándo. Y, si se anuló, que siga
// estando ENTERO —anular no borra, compensa— con la marca y el porqué al lado.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ToastProvider } from "@/providers/ToastProvider";
import { PagosRegistradosTabla } from "@/components/shared/liquidacion/PagosRegistradosTabla";
import type { PagoRegistradoDTO } from "@/lib/types/liquidacion";
import {
  LLAMADAS_PROHIBIDAS_EN_DINERO,
  codigoSinComentarios,
} from "@/tests/fixtures/money-safe";

// --- Datos ---------------------------------------------------------------

const VIGENTE: PagoRegistradoDTO = {
  id: "3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c",
  monto: "4000.10",
  metodo: "SINPE",
  referencia: "SINPE-88112233",
  nota: "Liquidación de julio",
  fechaPago: "2026-07-30",
  registradoPorNombre: "Ana Maestra",
  registradoAt: "2026-08-02T15:04:05.000Z",
  anulacion: null,
};

const ANULADO: PagoRegistradoDTO = {
  id: "8c7b6a59-4d3e-4f21-9a8b-7c6d5e4f3a2b",
  monto: "1250.00",
  metodo: "efectivo",
  referencia: null,
  nota: null,
  // Los tres días son DISTINTOS a propósito: entregado el 28, anotado el 31, anulado el 1.
  // Si el componente confundiera dos de ellos, un solo día repetido lo escondería.
  fechaPago: "2026-07-28",
  registradoPorNombre: "Beto Admin",
  registradoAt: "2026-07-31T18:00:00.000Z",
  anulacion: {
    motivo: "Se tecleó el monto de otra tienda",
    anuladoPorNombre: "Ana Maestra",
    anuladoAt: "2026-08-01T09:30:00.000Z",
  },
};

const TITULO = "Pagos registrados de Tienda Norte";

function montar(pagos: PagoRegistradoDTO[], extra: Record<string, unknown> = {}) {
  return render(
    <ToastProvider>
      <PagosRegistradosTabla pagos={pagos} beneficiario="Tienda Norte" {...extra} />
    </ToastProvider>,
  );
}

const tabla = () => screen.getByRole("table", { name: TITULO });

/** Celdas de la fila de un comprobante, localizada por su fecha real. */
function filaDe(fechaPago: string): HTMLElement {
  const celda = within(tabla()).getByText(fechaPago);
  return celda.closest("tr") as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

// -------------------------------------------------------------------------

describe("R49/R50 — el comprobante trae sus siete datos", () => {
  it("lista las columnas en orden, con sus nombres de pantalla", () => {
    montar([VIGENTE]);
    expect(
      within(tabla())
        .getAllByRole("columnheader")
        .map((th) => th.textContent),
    ).toEqual([
      "Fecha del pago",
      "Monto",
      "Método",
      "Referencia",
      "Nota",
      "Registró",
      "Registrado el",
      "Estado",
    ]);
  });

  it("pinta fecha real, monto, método, referencia, nota, quién e instante de registro", () => {
    montar([VIGENTE]);
    const fila = filaDe("2026-07-30");
    expect(within(fila).getByText("₡4000.10")).toBeInTheDocument();
    expect(within(fila).getByText("SINPE")).toBeInTheDocument();
    expect(within(fila).getByText("SINPE-88112233")).toBeInTheDocument();
    expect(within(fila).getByText("Liquidación de julio")).toBeInTheDocument();
    expect(within(fila).getByText("Ana Maestra")).toBeInTheDocument();
    expect(within(fila).getByText("2026-08-02")).toBeInTheDocument();
  });

  it("la fecha REAL del pago y el instante de registro son columnas DISTINTAS", () => {
    // Un pago entregado el 30 puede anotarse el 2 del mes siguiente. Confundirlas rompería
    // la conciliación, que se hace por la fecha real.
    montar([VIGENTE]);
    const fila = filaDe("2026-07-30");
    const celdas = within(fila).getAllByRole("cell");
    expect(celdas[0]).toHaveTextContent("2026-07-30");
    expect(celdas[6]).toHaveTextContent("2026-08-02");
  });

  it("el método sale con su ETIQUETA legible, nunca el valor interno", () => {
    montar([{ ...VIGENTE, metodo: "transferencia" }]);
    expect(within(tabla()).getByText("Transferencia")).toBeInTheDocument();
    expect(within(tabla()).queryByText("transferencia")).not.toBeInTheDocument();
  });

  it("los campos opcionales ausentes se marcan con «—», no se dejan en blanco", () => {
    montar([{ ...VIGENTE, referencia: null, nota: null }]);
    expect(within(filaDe("2026-07-30")).getAllByText("—")).toHaveLength(2);
  });

  it("conserva el ORDEN que devolvió el servidor: no reordena en el cliente", () => {
    montar([VIGENTE, ANULADO]);
    const filas = within(tabla()).getAllByRole("row");
    expect(within(filas[1]).getByText("2026-07-30")).toBeInTheDocument();
    expect(within(filas[2]).getByText("2026-07-28")).toBeInTheDocument();
  });

  it("sin pagos lo DICE, en vez de dejar una tabla muda", () => {
    montar([]);
    expect(screen.getByText("Todavía no hay pagos registrados.")).toBeInTheDocument();
  });

  it("mientras carga muestra el esqueleto, y un fallo se cuenta como alerta", () => {
    const { unmount } = montar([], { isLoading: true });
    expect(within(tabla()).getByRole("status")).toHaveTextContent("Cargando");
    unmount();
    cleanup();

    montar([], { error: "No se pudieron cargar los pagos registrados." });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "No se pudieron cargar los pagos registrados.",
    );
  });
});

describe("R74 — un pago anulado se ve COMPLETO y marcado", () => {
  it("conserva TODOS sus datos originales y suma la marca, el actor, el día y el motivo", () => {
    montar([ANULADO]);
    const fila = filaDe("2026-07-28");

    // Todo lo que tenía sigue ahí: anular no borra el pago.
    const celdas = within(fila).getAllByRole("cell");
    expect(celdas[0]).toHaveTextContent("2026-07-28"); // fecha real
    expect(within(fila).getByText("₡1250.00")).toBeInTheDocument();
    expect(within(fila).getByText("Efectivo")).toBeInTheDocument();
    expect(within(fila).getByText("Beto Admin")).toBeInTheDocument();
    expect(celdas[6]).toHaveTextContent("2026-07-31"); // instante de registro

    // …y encima, la anulación.
    expect(within(fila).getByText("Anulado")).toBeInTheDocument();
    expect(
      within(fila).getByText("Anulado por Ana Maestra el 2026-08-01"),
    ).toBeInTheDocument();
    expect(
      within(fila).getByText("Motivo: Se tecleó el monto de otra tienda"),
    ).toBeInTheDocument();
  });

  it("un pago VIGENTE se marca como tal y no enseña datos de anulación", () => {
    montar([VIGENTE]);
    const fila = filaDe("2026-07-30");
    expect(within(fila).getByText("Vigente")).toBeInTheDocument();
    expect(within(fila).queryByText(/Anulado por/)).not.toBeInTheDocument();
    expect(within(fila).queryByText(/^Motivo:/)).not.toBeInTheDocument();
  });

  it("vigentes y anulados conviven en la MISMA lista, distinguibles", () => {
    // Quien excluye los anulados es la SUMA del saldo (R80), no esta lista: un pago anulado
    // deja de descontar, pero no deja de verse.
    montar([VIGENTE, ANULADO]);
    expect(within(filaDe("2026-07-30")).getByText("Vigente")).toBeInTheDocument();
    expect(within(filaDe("2026-07-28")).getByText("Anulado")).toBeInTheDocument();
  });

  it("sin permiso, la tabla MUESTRA la anulación y no ofrece anular (R4/R81)", () => {
    // T F.5 actualizó este caso: la Tanda D fijaba que el control «todavía» no existía; ahora
    // existe, pero **solo con permiso**. Lo que se mide sigue siendo lo mismo por el lado que
    // importa: el default es no ofrecerlo. Ver también el bloque de T F.5, más abajo.
    montar([VIGENTE, ANULADO]);
    expect(
      within(tabla()).queryByRole("button", { name: /anular/i }),
    ).not.toBeInTheDocument();
    expect(within(filaDe("2026-07-28")).getByText("Anulado")).toBeInTheDocument();
  });
});

// =========================================================================
// T F.5 — el control de ANULAR
// =========================================================================

describe("R4/R81 — el control de anular solo existe para quien puede anular", () => {
  it("con `puedeAnular` aparece la columna y su botón en el pago vigente", () => {
    montar([VIGENTE], { puedeAnular: true, onAnular: vi.fn() });

    expect(
      within(tabla())
        .getAllByRole("columnheader")
        .map((th) => th.textContent),
    ).toEqual([
      "Fecha del pago",
      "Monto",
      "Método",
      "Referencia",
      "Nota",
      "Registró",
      "Registrado el",
      "Estado",
      "Acciones",
    ]);
    expect(
      within(filaDe("2026-07-30")).getByRole("button", { name: /^Anular el pago/ }),
    ).toBeInTheDocument();
  });

  it("FALLA CERRADO: sin declarar el permiso no hay ni columna ni botón", () => {
    // La prop es opcional a propósito y su default es `false`. Un montaje que se olvide de
    // decidir el permiso no ofrece anular a nadie, en vez de ofrecérselo a todos.
    montar([VIGENTE], { onAnular: vi.fn() });
    expect(
      within(tabla()).queryByRole("columnheader", { name: "Acciones" }),
    ).not.toBeInTheDocument();
    expect(
      within(tabla()).queryByRole("button", { name: /anular/i }),
    ).not.toBeInTheDocument();
  });

  it("con permiso pero sin acción que llamar tampoco se ofrece el control", () => {
    montar([VIGENTE], { puedeAnular: true });
    expect(
      within(tabla()).queryByRole("button", { name: /anular/i }),
    ).not.toBeInTheDocument();
  });

  it("cada botón dice de QUÉ pago es: dos filas, dos nombres accesibles", () => {
    montar([VIGENTE, { ...VIGENTE, id: "otro", monto: "10.00", fechaPago: "2026-07-29" }], {
      puedeAnular: true,
      onAnular: vi.fn(),
    });
    expect(
      screen.getByRole("button", { name: "Anular el pago de ₡4000.10 del 2026-07-30" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Anular el pago de ₡10.00 del 2026-07-29" }),
    ).toBeInTheDocument();
  });
});

describe("R82 — un pago ya anulado NO ofrece el control", () => {
  it("con la misma lista y el mismo permiso, solo el vigente tiene botón", () => {
    montar([VIGENTE, ANULADO], { puedeAnular: true, onAnular: vi.fn() });

    expect(
      within(filaDe("2026-07-30")).getByRole("button", { name: /^Anular el pago/ }),
    ).toBeInTheDocument();
    expect(
      within(filaDe("2026-07-28")).queryByRole("button", { name: /anular/i }),
    ).not.toBeInTheDocument();
    // Las dos mitades: el anulado sigue enseñando su marca y su porqué (R74).
    expect(within(filaDe("2026-07-28")).getByText("Anulado")).toBeInTheDocument();
    expect(
      within(filaDe("2026-07-28")).getByText("Motivo: Se tecleó el monto de otra tienda"),
    ).toBeInTheDocument();
  });
});

describe("T F.5 — el diálogo se abre sobre SU pago y avisa a quien montó la tabla", () => {
  const OK = {
    status: "ok" as const,
    pago: { ...VIGENTE, anulacion: ANULADO.anulacion },
    restante: "9000.00",
  };

  async function anularLaPrimeraFila(anular: ReturnType<typeof vi.fn>, anulado?: () => void) {
    const user = userEvent.setup();
    montar([VIGENTE, ANULADO], {
      puedeAnular: true,
      onAnular: anular,
      ...(anulado ? { onAnulado: anulado } : {}),
    });

    await user.click(
      within(filaDe("2026-07-30")).getByRole("button", { name: /^Anular el pago/ }),
    );
    const dialogo = await screen.findByRole("dialog");
    await user.type(within(dialogo).getByLabelText(/^Motivo de la anulación/), "Me equivoqué");
    await user.click(within(dialogo).getByRole("button", { name: "Anular pago" }));
    return dialogo;
  }

  it("manda el pago de ESA fila y el motivo, y nada más", async () => {
    const anular = vi.fn().mockResolvedValue(OK);
    await anularLaPrimeraFila(anular);

    await waitFor(() => expect(anular).toHaveBeenCalledTimes(1));
    expect(anular).toHaveBeenCalledWith(VIGENTE, "Me equivoqué");
  });

  it("tras anular, el diálogo se cierra y se avisa con el resultado del servidor", async () => {
    const anular = vi.fn().mockResolvedValue(OK);
    const anulado = vi.fn();
    await anularLaPrimeraFila(anular, anulado);

    await waitFor(() => expect(anulado).toHaveBeenCalledWith(OK));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("un rechazo del servidor deja el diálogo abierto y lo dice (la otra mitad de R81)", async () => {
    // Ocultar el botón no es control de acceso: aquí el control está a la vista y el servidor
    // sigue negando. Las dos mitades tienen que existir.
    const anular = vi.fn().mockResolvedValue({ status: "forbidden" });
    const anulado = vi.fn();
    const dialogo = await anularLaPrimeraFila(anular, anulado);

    expect(
      await within(dialogo).findByText("No tienes permiso para anular pagos."),
    ).toBeInTheDocument();
    expect(anulado).not.toHaveBeenCalled();
  });

  it("el diálogo de una fila no arrastra el motivo escrito en otra", async () => {
    const user = userEvent.setup();
    const anular = vi.fn().mockResolvedValue(OK);
    montar([VIGENTE, { ...VIGENTE, id: "otro", monto: "10.00", fechaPago: "2026-07-29" }], {
      puedeAnular: true,
      onAnular: anular,
    });

    await user.click(
      screen.getByRole("button", { name: "Anular el pago de ₡4000.10 del 2026-07-30" }),
    );
    const primero = await screen.findByRole("dialog");
    await user.type(
      within(primero).getByLabelText(/^Motivo de la anulación/),
      "borrador a medias",
    );
    await user.click(within(primero).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(
      screen.getByRole("button", { name: "Anular el pago de ₡10.00 del 2026-07-29" }),
    );
    const segundo = await screen.findByRole("dialog");
    expect(
      (within(segundo).getByLabelText(/^Motivo de la anulación/) as HTMLTextAreaElement).value,
    ).toBe("");
    // Y habla del otro pago, no del primero.
    expect(within(segundo).getByText(/₡10\.00/)).toBeInTheDocument();
  });
});

describe("R56 — ni un identificador interno en pantalla", () => {
  it("el `id` del pago viaja en el DTO pero NO se pinta", () => {
    montar([VIGENTE, ANULADO]);
    const texto = tabla().textContent ?? "";
    expect(texto).not.toContain(VIGENTE.id);
    expect(texto).not.toContain(ANULADO.id);
    expect(texto).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    );
  });

  it("no hay ninguna columna de identificador", () => {
    montar([VIGENTE]);
    const cabeceras = within(tabla())
      .getAllByRole("columnheader")
      .map((th) => (th.textContent ?? "").toLowerCase());
    for (const cabecera of cabeceras) {
      expect(cabecera).not.toMatch(/\bid\b/);
    }
  });
});

describe("R14 — money-safe", () => {
  it("el monto se pinta TAL CUAL, con sus dos decimales", () => {
    montar([{ ...VIGENTE, monto: "9999999999.99" }]);
    expect(within(tabla()).getByText("₡9999999999.99")).toBeInTheDocument();
  });

  it("el archivo de la tabla no convierte ni redondea ningún monto", () => {
    const codigo = codigoSinComentarios(
      "components/shared/liquidacion/PagosRegistradosTabla.tsx",
    );
    for (const prohibida of LLAMADAS_PROHIBIDAS_EN_DINERO) {
      expect(codigo, `la tabla llama a ${prohibida}`).not.toMatch(prohibida);
    }
  });
});

describe("descarga — Familia B, sobre lo que ya está en el cliente", () => {
  it("ofrece el control con un nombre que identifica al beneficiario", () => {
    montar([VIGENTE]);
    expect(
      screen.getByRole("button", { name: `Descargar ${TITULO}` }),
    ).toBeInTheDocument();
  });

  it("dos listas montadas a la vez no comparten nombre de tabla ni de control", () => {
    render(
      <ToastProvider>
        <PagosRegistradosTabla pagos={[VIGENTE]} beneficiario="Tienda Norte" />
        <PagosRegistradosTabla pagos={[ANULADO]} beneficiario="Tienda Sur" />
      </ToastProvider>,
    );
    for (const nombre of ["Tienda Norte", "Tienda Sur"]) {
      expect(
        screen.getByRole("table", { name: `Pagos registrados de ${nombre}` }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: `Descargar Pagos registrados de ${nombre}` }),
      ).toBeInTheDocument();
    }
  });

  it("descarga SIN releer del servidor: proyecta el mismo array que pinta", async () => {
    // Familia B: la lista llega completa y sin paginar, así que el archivo es exactamente lo
    // que se está viendo. Se comprueba por lo que NO pasa —ninguna petición— y porque el
    // control resuelve con éxito.
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    montar([VIGENTE, ANULADO]);

    const boton = screen.getByRole("button", { name: `Descargar ${TITULO}` });
    await user.click(boton);
    // Contar cuántos avisos NO hay es un ancla que el estado transitorio también cumple: cero
    // avisos es cierto también ANTES de que la descarga empiece, así que esa espera no esperaba
    // nada. La señal POSITIVA de que terminó es el botón: el control lo deshabilita mientras
    // genera (`DescargarDatasetButton`, `disabled={generando}`) y lo devuelve al pulsable al
    // resolver. El aviso de vacío se sigue exigiendo ausente, ahora ya con la descarga hecha.
    await waitFor(() => {
      expect(boton).toBeEnabled();
      expect(screen.queryByText(/No hay datos que descargar/)).not.toBeInTheDocument();
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("sin filas, el control avisa en vez de producir un archivo vacío", async () => {
    const user = userEvent.setup();
    montar([]);
    await user.click(screen.getByRole("button", { name: `Descargar ${TITULO}` }));
    // El aviso sale por partida doble: el toast visible y su región para lector de pantalla.
    expect(
      (await screen.findAllByText(/No hay datos que descargar/)).length,
    ).toBeGreaterThan(0);
  });
});
