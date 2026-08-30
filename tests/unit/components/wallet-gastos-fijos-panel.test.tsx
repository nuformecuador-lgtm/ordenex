// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import type { ReactElement } from "react";

import { ToastProvider } from "@/providers/ToastProvider";
import type { GastoFijoPlantillaDTO } from "@/lib/types/gasto-fijo-plantilla";
import { paginaInicial } from "@/tests/fixtures/pagina-inicial";

// Feature 45 (T12, R22b/R24/R25/R26) — tests del panel CRUD de PLANTILLAS de gasto fijo.
// Las actions se mockean (no se toca el backend real). Verifica: lista concepto/monto STRING/
// estado; "Nueva plantilla" crea; "Editar" actualiza con id; "Desactivar"/"Activar" alternan
// `activa`; la nota deja claro que el egreso lo genera el cron.
//
// Ficha 332 (T17) — el panel gana el BORRADO. Hasta el 2026-08-29 esta cabecera decía, de
// «Desactivar»/«Activar», que alternan `activa` «(nunca borran)»: era cierto porque no había
// forma de borrar. La ficha 332 **revoca** el «sin borrado» de `45/R25` con decisión humana de
// esa fecha (motivo: la tabla acumula ruido y el histórico del libro no depende de la
// plantilla; puntero: `specs/332-eliminar-plantilla-gasto-fijo`). Lo que sigue siendo verdad
// —y tiene su caso— es que DESACTIVAR no borra: son dos intenciones distintas y las dos
// existen (R11). Los casos de esta ficha cubren R1, R12–R20.
//
// Feature 85 (T F.3/T F.6) — la tabla gana «Periodicidad» y «Próximo cobro» (R18/R19/R20), el
// encabezado del monto pasa a «Monto» y ningún texto promete ya un cobro mensual (R22). El
// instante del próximo cobro entra por props desde el servidor (R23): aquí se fija a un día
// conocido, `AHORA_ISO`, para que la fecha esperada sea un literal y no el día de la corrida.
//
// Los casos de la 45 NO se borran: se ADAPTAN. Los de crear/editar pasaban por el diálogo con
// el payload corto que esta ficha cierra, así que ahora aseveran los cinco campos; la guardia
// dura del ciclo (R3) vive en `wallet-gasto-fijo-plantilla-dialog.test.tsx`.

const crearMock = vi.fn();
const actualizarMock = vi.fn();
const setActivaMock = vi.fn();
/** Ficha 332: el borrado. Se programa por caso; sin `mockResolvedValue` no devuelve nada. */
const eliminarMock = vi.fn();
// Feature 170 - FASE 2 (T I.2): el panel pide su PAGINA al servidor (SWR revalida al montar)
// y relee el conjunto completo al descargar. Las dos se programan en `renderPanel`.
const listarPaginaMock = vi.fn();
const listarCompletoMock = vi.fn();
vi.mock("@/lib/actions/gasto-fijo-plantilla", () => ({
  crearPlantillaAction: (...a: unknown[]) => crearMock(...a),
  actualizarPlantillaAction: (...a: unknown[]) => actualizarMock(...a),
  setActivaPlantillaAction: (...a: unknown[]) => setActivaMock(...a),
  eliminarPlantillaAction: (...a: unknown[]) => eliminarMock(...a),
  listarPlantillasPaginadoAction: (...a: unknown[]) => listarPaginaMock(...a),
  listarPlantillasAction: (...a: unknown[]) => listarCompletoMock(...a),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { GastosFijosPlantillasPanel } from "@/app/(app)/wallet/_components/GastosFijosPlantillasPanel";

const ACTIVA: GastoFijoPlantillaDTO = {
  id: "11111111-1111-1111-1111-111111111111",
  concepto: "Alquiler de bodega",
  monto: "300.00",
  activa: true,
  periodicidadUnidad: "meses",
  periodicidadCantidad: 1,
  fechaCobro: "2026-07-01",
  requiereAprobacion: true, // ficha 333/R1
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
};

const INACTIVA: GastoFijoPlantillaDTO = {
  id: "22222222-2222-2222-2222-222222222222",
  concepto: "Internet",
  monto: "45.00",
  activa: false,
  periodicidadUnidad: "meses",
  periodicidadCantidad: 1,
  fechaCobro: "2026-07-01",
  requiereAprobacion: true, // ficha 333/R1
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
};

/**
 * El instante que el SERVIDOR resuelve y baja por props (R23): 2026-07-15 a las 12:00 de Costa
 * Rica. Con `ACTIVA` (mensual, anclada el 1 de julio) el próximo cobro cae el 1 de agosto.
 */
const AHORA_ISO = "2026-07-15T18:00:00.000Z";

/** Una plantilla con un ciclo que NO es mensual, para que la columna diga algo distinto. */
const QUINCENAL: GastoFijoPlantillaDTO = {
  ...ACTIVA,
  id: "33333333-3333-3333-3333-333333333333",
  concepto: "Combustible",
  periodicidadUnidad: "semanas",
  periodicidadCantidad: 2,
  fechaCobro: "2026-07-06",
};

function renderPanel(ui: ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

/**
 * Feature 170 - FASE 2 (T I.2): monta el panel con su PAGINA y deja las dos lecturas
 * devolviendo el MISMO conjunto, para que la revalidacion de SWR no vacie la tabla.
 */
function montarPanel(plantillas: GastoFijoPlantillaDTO[], ahoraIso: string = AHORA_ISO) {
  listarPaginaMock.mockResolvedValue({
    status: "ok",
    page: 1,
    ...paginaInicial(plantillas),
  });
  listarCompletoMock.mockResolvedValue({ status: "ok", plantillas });
  return renderPanel(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <GastosFijosPlantillasPanel
        initialData={paginaInicial(plantillas)}
        ahoraIso={ahoraIso}
      />
    </SWRConfig>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("GastosFijosPlantillasPanel — listado (R26)", () => {
  it("lista concepto, monto STRING y estado; muestra la nota del cron", () => {
    montarPanel([ACTIVA, INACTIVA]);

    expect(screen.getByText("Alquiler de bodega")).toBeInTheDocument();
    // El `"300.00"` del servidor se pinta sin la cola de céntimos (feature 230).
    // El formulario de edición sigue viéndola: es dato, no presentación (§1/Q2).
    expect(screen.getByText("₡300")).toBeInTheDocument();
    expect(screen.getByText("Activa")).toBeInTheDocument();
    expect(screen.getByText("Internet")).toBeInTheDocument();
    expect(screen.getByText("Inactiva")).toBeInTheDocument();
    // Deja explícito que el egreso lo emite el cron, no este panel. Feature 85 (R22): la
    // nota decía «automáticamente cada mes», que dejó de ser cierto cuando el ciclo se abrió a
    // días y semanas; ahora nombra la periodicidad de cada plantilla.
    expect(
      screen.getByText(/según la periodicidad que tenga cada una/i),
    ).toBeInTheDocument();
  });
});

describe("GastosFijosPlantillasPanel — el ciclo en la tabla (feature 85, R18/R19/R20)", () => {
  it("la tabla muestra la periodicidad en palabras y la fecha del próximo cobro", () => {
    montarPanel([ACTIVA, QUINCENAL]);

    // Las dos columnas nuevas existen, con su encabezado.
    expect(screen.getByRole("columnheader", { name: "Periodicidad" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Próximo cobro" })).toBeInTheDocument();

    // `ACTIVA` es mensual anclada el 1 de julio; con el instante del 15 de julio, el próximo
    // cobro es el 1 de AGOSTO (el de julio ya pasó).
    const filaMensual = screen.getByRole("row", { name: /Alquiler de bodega/ });
    expect(within(filaMensual).getByText("Mensual")).toBeInTheDocument();
    expect(within(filaMensual).getByText("1 de agosto de 2026")).toBeInTheDocument();

    // `QUINCENAL` está anclada el 6 de julio: 6 + 14 días = 20 de julio.
    const filaQuincenal = screen.getByRole("row", { name: /Combustible/ });
    expect(within(filaQuincenal).getByText("Quincenal")).toBeInTheDocument();
    expect(within(filaQuincenal).getByText("20 de julio de 2026")).toBeInTheDocument();
  });

  it("una plantilla inactiva dice que no se cobra en vez de una fecha", () => {
    montarPanel([INACTIVA]);

    const fila = screen.getByRole("row", { name: /Internet/ });
    expect(within(fila).getByText("No se cobra")).toBeInTheDocument();
    // La celda no lleva NINGUNA fecha: una plantilla apagada no tiene próximo cobro.
    expect(within(fila).queryByText(/de agosto de/)).not.toBeInTheDocument();
    // Y su periodicidad se sigue viendo: el ciclo existe aunque esté desactivada.
    expect(within(fila).getByText("Mensual")).toBeInTheDocument();
  });

  it("el próximo cobro se calcula con el instante recibido por props, no con el reloj del navegador", () => {
    // El reloj del proceso se pone en 2030 a propósito: si el panel lo leyera, la fecha
    // pintada sería de 2030 y no la que corresponde al instante que llegó por props.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2030-11-20T18:00:00.000Z"));
    montarPanel([ACTIVA], "2026-07-15T18:00:00.000Z");

    const fila = screen.getByRole("row", { name: /Alquiler de bodega/ });
    expect(within(fila).getByText("1 de agosto de 2026")).toBeInTheDocument();
    expect(within(fila).queryByText(/2030/)).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it("con otro instante por props, la misma plantilla anuncia otro cobro", () => {
    // La contraparte del caso anterior: la fecha SIGUE a la prop. Un panel que ignorara
    // `ahoraIso` pintaría lo mismo en los dos montajes.
    montarPanel([ACTIVA], "2026-09-15T18:00:00.000Z");

    const fila = screen.getByRole("row", { name: /Alquiler de bodega/ });
    expect(within(fila).getByText("1 de octubre de 2026")).toBeInTheDocument();
  });
});

describe("GastosFijosPlantillasPanel — textos sin promesa mensual (feature 85, R22)", () => {
  it("ningún texto del panel ni del diálogo dice «cada mes»", async () => {
    const user = userEvent.setup();
    montarPanel([ACTIVA]);

    const textoDelPanel = document.body.textContent ?? "";
    expect(textoDelPanel).not.toMatch(/cada mes/i);
    expect(textoDelPanel).not.toMatch(/monto mensual/i);
    expect(textoDelPanel).not.toMatch(/próximos meses/i);

    // El encabezado del monto es «Monto» a secas: con la periodicidad al lado, «Monto
    // mensual» era falso para toda plantilla que no fuera mensual.
    expect(screen.getByRole("columnheader", { name: "Monto" })).toBeInTheDocument();
    expect(
      screen.queryByRole("columnheader", { name: "Monto mensual" }),
    ).not.toBeInTheDocument();

    // Y tampoco lo dice el diálogo que se abre desde aquí.
    await user.click(screen.getByRole("button", { name: "Nueva plantilla" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent ?? "").not.toMatch(/cada mes/i);
    expect(dialog.textContent ?? "").not.toMatch(/monto mensual/i);
  }, 15000);

  it("el aviso de desactivar tampoco promete un ciclo mensual", async () => {
    const user = userEvent.setup();
    setActivaMock.mockResolvedValue({ status: "ok", plantilla: { ...ACTIVA, activa: false } });
    montarPanel([ACTIVA]);

    const fila = screen.getByRole("row", { name: /Alquiler de bodega/ });
    await user.click(within(fila).getByRole("button", { name: "Desactivar" }));

    const aviso = await screen.findByText(/Plantilla desactivada/);
    expect(aviso.textContent ?? "").not.toMatch(/meses/i);
    expect(aviso.textContent ?? "").not.toMatch(/cada mes/i);
  }, 15000);
});

describe("GastosFijosPlantillasPanel — crear (R24)", () => {
  it("Nueva plantilla abre el diálogo y crea con concepto + monto", async () => {
    const user = userEvent.setup();
    crearMock.mockResolvedValue({ status: "ok", plantilla: { ...ACTIVA } });
    montarPanel([]);

    await user.click(screen.getByRole("button", { name: "Nueva plantilla" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Nueva plantilla de gasto fijo")).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText("Concepto"), "Luz");
    await user.type(within(dialog).getByLabelText("Monto"), "60.00");
    // Feature 85 (R15): la fecha del primer cobro se fija a mano para que el valor esperado
    // sea un literal y no «lo que devuelva hoy `fechaCalendarioCR()`» — una aserción contra la
    // propia fuente del componente. `fireEvent.change` porque `type` no es fiable sobre un
    // `<input type="date">` en jsdom.
    fireEvent.change(within(dialog).getByLabelText("Día del primer cobro"), {
      target: { value: "2026-09-01" },
    });
    await user.click(within(dialog).getByRole("button", { name: "Guardar" }));

    expect(crearMock).toHaveBeenCalledTimes(1);
    // Los CINCO campos: crear también manda el ciclo (R15), con el preset mensual por defecto.
    expect(crearMock.mock.calls[0][0]).toEqual({
      concepto: "Luz",
      monto: "60.00",
      periodicidadUnidad: "meses",
      periodicidadCantidad: 1,
      fechaCobro: "2026-09-01",
    });
    expect(actualizarMock).not.toHaveBeenCalled();
  }, 15000);

  it("no crea si el concepto está vacío o el monto es inválido", async () => {
    const user = userEvent.setup();
    montarPanel([]);

    await user.click(screen.getByRole("button", { name: "Nueva plantilla" }));
    const dialog = await screen.findByRole("dialog");

    await user.type(within(dialog).getByLabelText("Monto"), "0");
    await user.click(within(dialog).getByRole("button", { name: "Guardar" }));

    expect(crearMock).not.toHaveBeenCalled();
    expect(within(dialog).getByText("El concepto es obligatorio.")).toBeInTheDocument();
    expect(
      within(dialog).getByText("El monto debe ser un número mayor que 0."),
    ).toBeInTheDocument();
  }, 15000);
});

describe("GastosFijosPlantillasPanel — editar (R25)", () => {
  it("Editar prefila los campos y actualiza con el id de la plantilla", async () => {
    const user = userEvent.setup();
    actualizarMock.mockResolvedValue({ status: "ok", plantilla: { ...ACTIVA } });
    montarPanel([ACTIVA]);

    const fila = screen.getByRole("row", { name: /Alquiler de bodega/ });
    await user.click(within(fila).getByRole("button", { name: "Editar" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Editar plantilla de gasto fijo")).toBeInTheDocument();
    // Prefill desde la plantilla, ciclo incluido (feature 85, R14).
    expect(within(dialog).getByLabelText("Concepto")).toHaveValue("Alquiler de bodega");
    expect(within(dialog).getByLabelText("Monto")).toHaveValue("300.00");
    expect(within(dialog).getByLabelText("Día del primer cobro")).toHaveValue("2026-07-01");

    await user.clear(within(dialog).getByLabelText("Monto"));
    await user.type(within(dialog).getByLabelText("Monto"), "350.00");
    await user.click(within(dialog).getByRole("button", { name: "Guardar" }));

    expect(actualizarMock).toHaveBeenCalledTimes(1);
    // Feature 85 (R3): cambiar el monto reenvía el ciclo VIGENTE tal cual, en literales. Antes
    // de esta ficha aquí viajaban solo tres campos y el borde reescribía el ciclo en silencio.
    expect(actualizarMock.mock.calls[0][0]).toEqual({
      id: ACTIVA.id,
      concepto: "Alquiler de bodega",
      monto: "350.00",
      periodicidadUnidad: "meses",
      periodicidadCantidad: 1,
      fechaCobro: "2026-07-01",
    });
  }, 15000);
});

describe("GastosFijosPlantillasPanel — activar/desactivar (R25)", () => {
  it("Desactivar una plantilla activa llama setActiva con activa=false", async () => {
    const user = userEvent.setup();
    setActivaMock.mockResolvedValue({ status: "ok", plantilla: { ...ACTIVA, activa: false } });
    montarPanel([ACTIVA]);

    const fila = screen.getByRole("row", { name: /Alquiler de bodega/ });
    await user.click(within(fila).getByRole("button", { name: "Desactivar" }));

    await waitFor(() => expect(setActivaMock).toHaveBeenCalledTimes(1));
    expect(setActivaMock.mock.calls[0][0]).toEqual({ id: ACTIVA.id, activa: false });
    // Ficha 332 (R11): desactivar NO se fue con la revocación del «sin borrado», y sobre todo
    // NO se convirtió en un borrado encubierto. La fila se pausa; sigue en la tabla.
    expect(eliminarMock).not.toHaveBeenCalled();
    expect(screen.getByRole("row", { name: /Alquiler de bodega/ })).toBeInTheDocument();
  }, 15000);

  it("Activar una plantilla inactiva llama setActiva con activa=true", async () => {
    const user = userEvent.setup();
    setActivaMock.mockResolvedValue({ status: "ok", plantilla: { ...INACTIVA, activa: true } });
    montarPanel([INACTIVA]);

    const fila = screen.getByRole("row", { name: /Internet/ });
    await user.click(within(fila).getByRole("button", { name: "Activar" }));

    await waitFor(() => expect(setActivaMock).toHaveBeenCalledTimes(1));
    expect(setActivaMock.mock.calls[0][0]).toEqual({ id: INACTIVA.id, activa: true });
  }, 15000);
});

/* -------------------------------------------------------------------------- */
/* Ficha 332 — el borrado: botón, confirmación y lo que se ve después          */
/* (R1, R12–R20). El backend está mockeado: aquí sólo se prueba la pantalla.   */
/* -------------------------------------------------------------------------- */

type Usuario = ReturnType<typeof userEvent.setup>;

/**
 * Pide eliminar la fila de `concepto` y devuelve la confirmación YA abierta.
 *
 * Devuelve el diálogo —y no se usa `screen`— a propósito: con la confirmación abierta hay DOS
 * botones «Eliminar» en el documento (el de la fila y el de confirmar), así que todo lo de la
 * confirmación se busca DENTRO de ella o la consulta es ambigua.
 */
async function pedirEliminar(user: Usuario, concepto: RegExp): Promise<HTMLElement> {
  const fila = screen.getByRole("row", { name: concepto });
  await user.click(within(fila).getByRole("button", { name: "Eliminar" }));
  return screen.findByRole("dialog");
}

/** El texto del diálogo con los saltos de línea del JSX colapsados. */
function texto(nodo: HTMLElement): string {
  return (nodo.textContent ?? "").replace(/\s+/g, " ").trim();
}

describe("GastosFijosPlantillasPanel — el botón Eliminar (ficha 332, R1)", () => {
  it("cada fila ofrece Eliminar, junto a Editar y al toggle de su estado", () => {
    montarPanel([ACTIVA, INACTIVA]);

    for (const [concepto, toggle] of [
      ["Alquiler de bodega", "Desactivar"],
      ["Internet", "Activar"],
    ]) {
      const fila = screen.getByRole("row", { name: new RegExp(concepto) });
      expect(within(fila).getByRole("button", { name: "Eliminar" })).toBeInTheDocument();
      // Y las dos acciones que ya existían siguen ahí: la ficha AÑADE una tercera (R11).
      expect(within(fila).getByRole("button", { name: "Editar" })).toBeInTheDocument();
      expect(within(fila).getByRole("button", { name: toggle })).toBeInTheDocument();
    }
  });
});

describe("GastosFijosPlantillasPanel — la confirmación (ficha 332, R12–R17)", () => {
  it("Eliminar abre la confirmación y NO llama a la acción (R12/R13)", async () => {
    const user = userEvent.setup();
    montarPanel([ACTIVA]);

    const dialog = await pedirEliminar(user, /Alquiler de bodega/);

    expect(within(dialog).getByText("Eliminar plantilla de gasto fijo")).toBeInTheDocument();
    // R13: mientras la confirmación no se acepta, no se borra nada. Es LA aserción de la
    // ficha: sin ella, un botón que llamara a la acción y ADEMÁS abriera el diálogo pasaría.
    expect(eliminarMock).not.toHaveBeenCalled();
  }, 15000);

  it("la confirmación identifica la plantilla por concepto y monto (R14)", async () => {
    const user = userEvent.setup();
    montarPanel([ACTIVA]);

    const dialog = await pedirEliminar(user, /Alquiler de bodega/);

    // El `"300.00"` del servidor se pinta con `money` —STRING, sin parseFloat/Number—, igual
    // que la columna «Monto» de la tabla: sin la cola de céntimos (feature 230).
    expect(within(dialog).getByText("«Alquiler de bodega» — ₡300")).toBeInTheDocument();
  }, 15000);

  it("el monto pasa por `money`: agrupa miles y no se pega crudo (R14)", async () => {
    // ⭑ El caso que DISCRIMINA. Con `300.00` un `${p.monto}` a pelo se vería casi igual; con
    //   un monto de siete cifras, pegar el STRING crudo daría «1500000.00» y una conversión a
    //   número daría «1500000». Sólo el camino money-safe da «₡1.500.000».
    const user = userEvent.setup();
    const CARA: GastoFijoPlantillaDTO = { ...ACTIVA, monto: "1500000.00" };
    montarPanel([CARA]);

    const dialog = await pedirEliminar(user, /Alquiler de bodega/);

    expect(within(dialog).getByText("«Alquiler de bodega» — ₡1.500.000")).toBeInTheDocument();
    expect(texto(dialog)).not.toContain("1500000.00");
  }, 15000);

  it("enuncia las TRES consecuencias del borrado (R15)", async () => {
    const user = userEvent.setup();
    montarPanel([ACTIVA]);

    const cuerpo = texto(await pedirEliminar(user, /Alquiler de bodega/));

    expect(cuerpo).toContain("La plantilla desaparece de esta tabla.");
    expect(cuerpo).toContain("Deja de generar cobros automáticos.");
    // La tercera es la que más importa y la que un resumen se comería: el histórico del libro
    // NO se toca (R8/R9), y el usuario tiene que leerlo ANTES de aceptar.
    expect(cuerpo).toContain(
      "Los cobros ya hechos siguen en el libro de movimientos: no se borran ni se modifican.",
    );
  }, 15000);

  it("ofrece Desactivar como alternativa, con lo que la pausa conserva (R16)", async () => {
    const user = userEvent.setup();
    montarPanel([ACTIVA]);

    const cuerpo = texto(await pedirEliminar(user, /Alquiler de bodega/));

    expect(cuerpo).toContain("usá Desactivar");
    expect(cuerpo).toContain("la plantilla se queda y podés reactivarla cuando quieras");
  }, 15000);

  it("Cancelar cierra la confirmación sin llamar a la acción (R17)", async () => {
    const user = userEvent.setup();
    montarPanel([ACTIVA]);

    const dialog = await pedirEliminar(user, /Alquiler de bodega/);
    await user.click(within(dialog).getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(eliminarMock).not.toHaveBeenCalled();
    // Y la fila sigue en la tabla: cancelar no deja el listado a medias.
    expect(screen.getByRole("row", { name: /Alquiler de bodega/ })).toBeInTheDocument();
  }, 15000);
});

describe("GastosFijosPlantillasPanel — después de confirmar (ficha 332, R2/R18/R19)", () => {
  it("confirmar llama a la acción con { id } y, tras ok, avisa y relee la página", async () => {
    const user = userEvent.setup();
    eliminarMock.mockResolvedValue({ status: "ok" });
    montarPanel([ACTIVA]);
    await waitFor(() => expect(listarPaginaMock).toHaveBeenCalled());
    const lecturasAntes = listarPaginaMock.mock.calls.length;

    const dialog = await pedirEliminar(user, /Alquiler de bodega/);
    await user.click(within(dialog).getByRole("button", { name: "Eliminar" }));

    await waitFor(() => expect(eliminarMock).toHaveBeenCalledTimes(1));
    // R2: el id EXACTO y nada más. El schema del borde es `.strict()`: una clave de sobra
    // moriría allí, así que mandar de más se rompería en producción y no aquí.
    expect(eliminarMock.mock.calls[0][0]).toEqual({ id: ACTIVA.id });

    // R18: el aviso y la RELECTURA. La acción devuelve `{ status: "ok" }` sin payload, así que
    // la tabla no se puede reconstruir en el cliente: hay que volver a pedirla al servidor.
    expect(await screen.findByText("Plantilla eliminada.")).toBeInTheDocument();
    await waitFor(() =>
      expect(listarPaginaMock.mock.calls.length).toBeGreaterThan(lecturasAntes),
    );
  }, 15000);

  /**
   * R19 — los cuatro fallos, cada uno con SU mensaje.
   *
   * Cada caso afirma además que los mensajes de los otros tres NO están: sin eso, un panel que
   * mostrara siempre el mismo texto pasaría los cuatro casos y el usuario no podría distinguir
   * «no tenés permiso» de «tu sesión expiró», que piden cosas distintas.
   */
  const FALLOS: ReadonlyArray<{ resultado: Record<string, unknown>; mensaje: string }> = [
    {
      resultado: { status: "forbidden" },
      mensaje: "No tenés permiso para administrar plantillas.",
    },
    {
      resultado: { status: "unauthenticated" },
      mensaje: "Tu sesión expiró. Iniciá sesión de nuevo.",
    },
    { resultado: { status: "not_found" }, mensaje: "La plantilla ya no existe." },
    {
      resultado: { status: "validation_error", fieldErrors: {} },
      mensaje: "No se pudo eliminar la plantilla.",
    },
  ];

  for (const { resultado, mensaje } of FALLOS) {
    it(`${String(resultado.status)} muestra su propio mensaje y ningún otro (R19)`, async () => {
      const user = userEvent.setup();
      eliminarMock.mockResolvedValue(resultado);
      montarPanel([ACTIVA]);

      const dialog = await pedirEliminar(user, /Alquiler de bodega/);
      await user.click(within(dialog).getByRole("button", { name: "Eliminar" }));

      await waitFor(() => expect(eliminarMock).toHaveBeenCalledTimes(1));
      // `findAllByText`: un aviso de error se anuncia con prioridad alta, así que el texto
      // aparece además en la región `aria-live` del proveedor de toasts. Son dos nodos con el
      // mismo texto y `findByText` reventaría por ambigüedad — que es ruido, no un fallo.
      expect((await screen.findAllByText(mensaje)).length).toBeGreaterThan(0);
      for (const otro of FALLOS.filter((f) => f.mensaje !== mensaje)) {
        expect(screen.queryAllByText(otro.mensaje)).toHaveLength(0);
      }
      // Y no se anuncia un éxito que no hubo.
      expect(screen.queryAllByText("Plantilla eliminada.")).toHaveLength(0);
    }, 15000);
  }

  it("los cuatro estados de error tienen mensajes distintos entre sí (R19)", () => {
    // Anti-vacuidad de la tabla de arriba: si dos filas compartieran mensaje, los casos
    // «ningún otro» se anularían entre sí y quedarían verdes sin probar nada.
    expect(new Set(FALLOS.map((f) => f.mensaje)).size).toBe(FALLOS.length);
  });
});

describe("GastosFijosPlantillasPanel — la página que se queda vacía (ficha 332, R20)", () => {
  /** Una plantilla que sólo vive en la página 2, para no confundirla con las de la 1. */
  const SOLA_EN_LA_2: GastoFijoPlantillaDTO = {
    ...ACTIVA,
    id: "44444444-4444-4444-4444-444444444444",
    concepto: "Bodega satélite",
  };

  /**
   * Monta el panel con DOS páginas de verdad: 26 filas en total y 25 por página, con la lectura
   * respondiendo distinto según la página pedida. Sin esto, `page` nunca pasa de 1 y R20 no se
   * puede ejercitar.
   */
  function montarDosPaginas(pagina2: GastoFijoPlantillaDTO[]) {
    const PAGINA_1 = [ACTIVA, INACTIVA];
    listarPaginaMock.mockImplementation(async (input: unknown) => {
      const { page } = input as { page: number };
      return {
        status: "ok",
        items: page === 1 ? PAGINA_1 : pagina2,
        total: 26,
        pageSize: 25,
      };
    });
    listarCompletoMock.mockResolvedValue({ status: "ok", plantillas: [] });
    return renderPanel(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <GastosFijosPlantillasPanel
          initialData={paginaInicial(PAGINA_1, { total: 26 })}
          ahoraIso={AHORA_ISO}
        />
      </SWRConfig>,
    );
  }

  it("borrada la ÚNICA fila de la página 2, el panel muestra la página 1", async () => {
    const user = userEvent.setup();
    eliminarMock.mockResolvedValue({ status: "ok" });
    montarDosPaginas([SOLA_EN_LA_2]);

    await user.click(screen.getByRole("button", { name: "Página siguiente" }));
    await screen.findByRole("row", { name: /Bodega satélite/ });

    const dialog = await pedirEliminar(user, /Bodega satélite/);
    await user.click(within(dialog).getByRole("button", { name: "Eliminar" }));
    await waitFor(() => expect(eliminarMock).toHaveBeenCalledTimes(1));

    // Sin R20 la tabla se quedaría vacía diciendo «Todavía no hay plantillas de gasto fijo»,
    // que sería FALSO: las hay, en la página 1. Se comprueba por lo que se VE.
    expect(await screen.findByRole("row", { name: /Alquiler de bodega/ })).toBeInTheDocument();
    expect(
      screen.queryByText("Todavía no hay plantillas de gasto fijo."),
    ).not.toBeInTheDocument();
  }, 15000);

  it("si la página 2 tenía DOS filas, no se mueve de página (R20)", async () => {
    // ⭑ La contraparte que mata la mutación «volver siempre a la página anterior»: la regla es
    //   «la página se quedó vacía», no «se borró algo estando en la página 2».
    const user = userEvent.setup();
    eliminarMock.mockResolvedValue({ status: "ok" });
    const ACOMPANANTE: GastoFijoPlantillaDTO = {
      ...ACTIVA,
      id: "55555555-5555-5555-5555-555555555555",
      concepto: "Vigilancia",
    };
    montarDosPaginas([SOLA_EN_LA_2, ACOMPANANTE]);

    await user.click(screen.getByRole("button", { name: "Página siguiente" }));
    await screen.findByRole("row", { name: /Bodega satélite/ });

    const dialog = await pedirEliminar(user, /Bodega satélite/);
    await user.click(within(dialog).getByRole("button", { name: "Eliminar" }));
    await waitFor(() => expect(eliminarMock).toHaveBeenCalledTimes(1));
    await screen.findByText("Plantilla eliminada.");

    // Sigue en la página 2: las filas de la 1 no aparecen.
    expect(screen.queryByRole("row", { name: /Alquiler de bodega/ })).not.toBeInTheDocument();
    expect(screen.getByRole("row", { name: /Vigilancia/ })).toBeInTheDocument();
  }, 15000);
});
