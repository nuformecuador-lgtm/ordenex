// @vitest-environment jsdom
// Feature 293 (T5.1/T5.2) — EL PANEL DE PREMIOS DEL RANKING de `/wallet/mensajeros`. Cubre R5,
// R6, R7, R8, R9, R11, R12, R16, R30, R32 y R35.
//
// Las tres cosas que se miden acá y que **ningún test de servidor puede medir**:
//
//  - **`entregadas / asignadas` se pinta, siempre y pegado al premio** (R5). El servicio ya
//    manda los dos números aunque valgan cero, pero que viajen no es que se vean: el 26/08 el
//    primer puesto fue `0 de 21` porque el podio salió por orden alfabético, y ese dato tiene
//    que estar delante de quien pulsa «Registrar». Un `render` que se lo comiera dejaría la
//    suite entera verde.
//  - **el día sin cierre NO deja registrar, y dice POR QUÉ** (R11). La diferencia entre «no hay
//    botón» y «no hay botón porque ese día no tiene cierre» es literalmente el requisito; sin
//    ella, las tres razones para que el control no esté —sin premio, sin cierre, cierre no
//    aprobado— son el mismo hueco.
//  - **sin motivo no se llama a la action** (R30): la primera de las tres barreras del motivo,
//    y la única que vive en el navegador.
//
// El PERMISO no se prueba acá y no es un olvido: `page.tsx` hace `notFound()` para todo lo que
// no sea acceso total (eso lo mide `wallet-mensajeros-page.test.tsx`) y el servicio responde
// `forbidden` con el mismo predicado. En el cliente no hay rol que decidir.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  within,
  cleanup,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";

import {
  LLAMADAS_PROHIBIDAS_EN_DINERO,
  codigoSinComentarios,
} from "@/tests/fixtures/money-safe";
import type { PremioPodioDTO } from "@/lib/types/premio-ranking-devengo";

const { listarMock, registrarMock, anularMock, successMock } = vi.hoisted(() => ({
  listarMock: vi.fn(),
  registrarMock: vi.fn(),
  anularMock: vi.fn(),
  successMock: vi.fn(),
}));

vi.mock("@/lib/actions/premio-ranking-devengo", () => ({
  listarPremiosDelDiaAction: (...args: unknown[]) => listarMock(...args),
  registrarPremioAction: (...args: unknown[]) => registrarMock(...args),
  anularPremioAction: (...args: unknown[]) => anularMock(...args),
}));

vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: successMock,
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

import { PremiosRankingPanel } from "@/app/(app)/wallet/mensajeros/_components/PremiosRankingPanel";

// --- Datos ---------------------------------------------------------------

const FECHA = "2026-08-26";
const HOY = "2026-08-27";

const RUTA_PANEL = "app/(app)/wallet/mensajeros/_components/PremiosRankingPanel.tsx";

/**
 * El podio del 26/08, que es el caso real que la ficha cita: el primer puesto con `0 de 21`.
 * Las tres filas cubren tres estados distintos a propósito.
 */
const PRIMERO: PremioPodioDTO = {
  filaId: "fila-1",
  posicion: 1,
  mensajeroNombre: "Kevin Rojas",
  entregadas: 0,
  asignadas: 21,
  premioMonto: "5000.00",
  premioDescripcion: "Bono por buen rendimiento",
  estado: "no_registrado",
  cierreEstado: "aprobado",
};

const SEGUNDO: PremioPodioDTO = {
  filaId: "fila-2",
  posicion: 2,
  mensajeroNombre: "Ana Mora",
  entregadas: 14,
  asignadas: 20,
  premioMonto: null,
  premioDescripcion: null,
  estado: "sin_premio",
  cierreEstado: null,
};

const TERCERO: PremioPodioDTO = {
  filaId: "fila-3",
  posicion: 3,
  mensajeroNombre: "Luis Vargas",
  entregadas: 11,
  asignadas: 19,
  premioMonto: "2000.00",
  premioDescripcion: "Bono de podio",
  estado: "sin_cierre",
  cierreEstado: null,
};

function podio(filas: PremioPodioDTO[]) {
  return { status: "ok" as const, fecha: FECHA, hayPodio: true, filas };
}

function montar() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <PremiosRankingPanel fechaInicial={FECHA} fechaMaxima={HOY} />
    </SWRConfig>,
  );
}

const lista = () => screen.getByRole("list", { name: "Podio del día" });

/** La fila del podio de ese mensajero, buscada por su nombre congelado. */
function filaDe(nombre: string): HTMLElement {
  return within(lista()).getByText(nombre).closest("li") as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  listarMock.mockResolvedValue(podio([PRIMERO, SEGUNDO, TERCERO]));
});

afterEach(() => {
  cleanup();
});

// =========================================================================

describe("R5 — `entregadas / asignadas` está SIEMPRE, también cuando vale cero", () => {
  it("el primer puesto con 0 de 21 se pinta con sus dos números, no con un guion", async () => {
    montar();

    const fila = await waitFor(() => filaDe("Kevin Rojas"));
    // El caso del 26/08: el podio lo decidió el orden alfabético y el premio se ofrece igual.
    expect(within(fila).getByText("0 / 21 entregadas")).toBeInTheDocument();
    // Y NO se sustituye por el marcador de «sin dato» de esta pantalla.
    expect(within(fila).queryByText("—")).not.toBeInTheDocument();
    // El dato está en la MISMA fila que el premio y que el botón: no en otra pestaña ni en un
    // tooltip. Es lo que hace que se vea ANTES de pulsar.
    expect(within(fila).getByText("₡5.000")).toBeInTheDocument();
    expect(
      within(fila).getByRole("button", { name: "Registrar el premio de Kevin Rojas" }),
    ).toBeInTheDocument();
  });

  it("las tres filas del podio llevan su par, con los números que mandó el servidor", async () => {
    montar();

    await waitFor(() => filaDe("Kevin Rojas"));
    expect(within(filaDe("Kevin Rojas")).getByText("0 / 21 entregadas")).toBeInTheDocument();
    expect(within(filaDe("Ana Mora")).getByText("14 / 20 entregadas")).toBeInTheDocument();
    expect(within(filaDe("Luis Vargas")).getByText("11 / 19 entregadas")).toBeInTheDocument();
  });

  it("una fila SIN premio también lo lleva: el par no depende de que haya premio", async () => {
    montar();

    const fila = await waitFor(() => filaDe("Ana Mora"));
    expect(within(fila).getByText("14 / 20 entregadas")).toBeInTheDocument();
    expect(within(fila).getByText(/sin premio/i)).toBeInTheDocument();
  });
});

describe("R9 — los estados se dicen con TEXTO, nunca con la ausencia del control", () => {
  it("R11 — el día sin cierre no deja registrar, y explica exactamente esa causa", async () => {
    montar();

    const fila = await waitFor(() => filaDe("Luis Vargas"));
    // La causa, no un error genérico: esta feature no crea cierres (fuera de alcance 6).
    expect(within(fila).getByText(/ese día no tiene cierre/i)).toBeInTheDocument();
    // Y no hay forma de registrarlo desde acá.
    expect(within(fila).queryByRole("button", { name: /^Registrar/ })).toBeNull();
    expect(registrarMock).not.toHaveBeenCalled();
  });

  it("R12 — el cierre no aprobado nombra el ESTADO en que está", async () => {
    listarMock.mockResolvedValue(
      podio([{ ...PRIMERO, estado: "cierre_no_aprobado", cierreEstado: "rechazado" }]),
    );
    montar();

    const fila = await waitFor(() => filaDe("Kevin Rojas"));
    expect(
      within(fila).getByText(/el cierre de ese día está rechazado/i),
    ).toBeInTheDocument();
    expect(within(fila).queryByRole("button", { name: /^Registrar/ })).toBeNull();
  });

  it("R7 — la fila sin premio congelado lo dice, y no ofrece registro", async () => {
    montar();

    const fila = await waitFor(() => filaDe("Ana Mora"));
    expect(within(fila).getByText(/sin premio asignado/i)).toBeInTheDocument();
    expect(within(fila).queryByRole("button")).toBeNull();
  });

  it("R32 — el premio anulado dice que no se puede volver a registrar, y no hay control", async () => {
    listarMock.mockResolvedValue(podio([{ ...PRIMERO, estado: "anulado" }]));
    montar();

    const fila = await waitFor(() => filaDe("Kevin Rojas"));
    expect(
      within(fila).getByText(/anulado — no se puede volver a registrar/i),
    ).toBeInTheDocument();
    expect(within(fila).queryByRole("button")).toBeNull();
  });

  it("el premio ya registrado se distingue del que falta por registrar", async () => {
    listarMock.mockResolvedValue(podio([{ ...PRIMERO, estado: "registrado" }]));
    montar();

    const fila = await waitFor(() => filaDe("Kevin Rojas"));
    expect(within(fila).getByText(/^Registrado: se cobra con el cierre/)).toBeInTheDocument();
    // Ya no se puede registrar; lo que se ofrece es anularlo.
    expect(within(fila).queryByRole("button", { name: /^Registrar/ })).toBeNull();
    expect(
      within(fila).getByRole("button", { name: "Anular el premio de Kevin Rojas" }),
    ).toBeInTheDocument();
  });
});

describe("R6 — la fecha sin podio congelado se dice, y no ofrece ninguna acción", () => {
  it("pinta el aviso propio y NO monta la lista del podio", async () => {
    listarMock.mockResolvedValue({
      status: "ok",
      fecha: FECHA,
      hayPodio: false,
      filas: [],
    });
    montar();

    expect(
      await screen.findByText(/ese día no tiene ranking congelado/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Podio del día" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Registrar/ })).toBeNull();
  });
});

describe("el selector de día (R8)", () => {
  it("abre en el día que le dio el SERVIDOR y no deja elegir uno posterior a hoy", async () => {
    montar();

    const selector = screen.getByLabelText("Día del podio");
    expect(selector).toHaveValue(FECHA);
    // R8: la cota superior es hoy en Costa Rica. El borde de la action lo revalida igual.
    expect(selector).toHaveAttribute("max", HOY);
    await waitFor(() => expect(listarMock).toHaveBeenCalledWith({ fecha: FECHA }));
  });

  it("cambiar de día vuelve a pedir el podio de ESE día", async () => {
    montar();
    await waitFor(() => expect(listarMock).toHaveBeenCalledTimes(1));

    // `fireEvent.change` y no `user.type`: un `<input type="date">` se teclea por segmentos y
    // emitiría fechas a medio escribir. Acá interesa el día elegido, no cómo se teclea.
    fireEvent.change(screen.getByLabelText("Día del podio"), {
      target: { value: "2026-08-25" },
    });

    await waitFor(() => expect(listarMock).toHaveBeenLastCalledWith({ fecha: "2026-08-25" }));
  });

  it("vaciar el selector NO consulta un día que no existe", async () => {
    montar();
    await waitFor(() => expect(listarMock).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText("Día del podio"), { target: { value: "" } });

    // El `<input type="date">` emite "" al vaciarse; el panel se queda en el día que tenía.
    await waitFor(() => expect(listarMock).toHaveBeenLastCalledWith({ fecha: FECHA }));
    expect(listarMock).toHaveBeenCalledTimes(1);
  });
});

describe("R16 — el registro manda `filaId` y NADA más", () => {
  it("registra, avisa con el importe del SERVIDOR y vuelve a leer el podio", async () => {
    const user = userEvent.setup();
    registrarMock.mockResolvedValue({
      status: "ok",
      monto: "5000.00",
      cierreId: "c-1",
    });
    // La relectura tras escribir devuelve la fila YA registrada: es lo que el usuario ve.
    listarMock
      .mockResolvedValueOnce(podio([PRIMERO]))
      .mockResolvedValue(podio([{ ...PRIMERO, estado: "registrado" }]));
    montar();

    await waitFor(() => filaDe("Kevin Rojas"));
    await user.click(
      screen.getByRole("button", { name: "Registrar el premio de Kevin Rojas" }),
    );

    // Ni monto, ni mensajero, ni cierre, ni fecha: el servidor los resuelve del podio congelado.
    await waitFor(() => expect(registrarMock).toHaveBeenCalledTimes(1));
    expect(registrarMock).toHaveBeenCalledWith({ filaId: "fila-1" });

    // El importe del aviso es el que devolvió la ESCRITURA, no el que se pintaba antes.
    expect(
      await within(filaDe("Kevin Rojas")).findByText(/premio de ₡5\.000 registrado/i),
    ).toBeInTheDocument();
    expect(successMock).toHaveBeenCalledTimes(1);

    // Refresco dirigido: la fila pasa a «Registrado» porque se releyó, no porque el cliente lo
    // dedujera. Si el panel no releyera, seguiría ofreciendo «Registrar» sobre algo ya escrito.
    await waitFor(() =>
      expect(
        // Anclado al principio: el aviso del desenlace («Premio de ₡5.000 registrado: …»)
        // termina en la misma frase, y sin el ancla una cosa pasaría por la otra.
        within(filaDe("Kevin Rojas")).getByText(/^Registrado: se cobra con el cierre/),
      ).toBeInTheDocument(),
    );
    expect(listarMock.mock.calls.length).toBeGreaterThan(1);
  });

  it("R18 — el reintento responde «ya registrado» y no se pinta como un fallo", async () => {
    const user = userEvent.setup();
    registrarMock.mockResolvedValue({ status: "ya_registrado" });
    listarMock.mockResolvedValue(podio([PRIMERO]));
    montar();

    await waitFor(() => filaDe("Kevin Rojas"));
    await user.click(
      screen.getByRole("button", { name: "Registrar el premio de Kevin Rojas" }),
    );

    const aviso = await within(filaDe("Kevin Rojas")).findByText(/ya estaba registrado/i);
    // No es un error: no se anuncia como alerta.
    expect(aviso).toHaveAttribute("role", "status");
  });

  it("R32 — pedir el registro de uno ANULADO se explica con su causa propia", async () => {
    const user = userEvent.setup();
    registrarMock.mockResolvedValue({ status: "anulado" });
    listarMock.mockResolvedValue(podio([PRIMERO]));
    montar();

    await waitFor(() => filaDe("Kevin Rojas"));
    await user.click(
      screen.getByRole("button", { name: "Registrar el premio de Kevin Rojas" }),
    );

    expect(
      await within(filaDe("Kevin Rojas")).findByText(
        /está anulado: no se puede volver a registrar/i,
      ),
    ).toBeInTheDocument();
  });

  it("feature 297 — «no entregó nada ese día» se explica con su causa propia, no con un fallo", async () => {
    // PRIMERO es la fila del 26/08: 0 de 21, con su premio congelado. La fila es historia y se
    // sigue pintando con su botón; lo que el maestro tiene que leer al pulsarlo es POR QUÉ.
    const user = userEvent.setup();
    registrarMock.mockResolvedValue({ status: "sin_entregas" });
    listarMock.mockResolvedValue(podio([PRIMERO]));
    montar();

    await waitFor(() => filaDe("Kevin Rojas"));
    await user.click(
      screen.getByRole("button", { name: "Registrar el premio de Kevin Rojas" }),
    );

    const aviso = await within(filaDe("Kevin Rojas")).findByText(
      /no entregó ninguna orden: el premio no se puede cobrar/i,
    );
    expect(aviso).toHaveAttribute("role", "alert");
    // Y no se releen los datos: no se escribió nada.
    expect(listarMock.mock.calls.length).toBe(1);
  });

  it("R11 — un rechazo por «sin cierre» del servidor tampoco es un error genérico", async () => {
    const user = userEvent.setup();
    registrarMock.mockResolvedValue({ status: "sin_cierre" });
    listarMock.mockResolvedValue(podio([PRIMERO]));
    montar();

    await waitFor(() => filaDe("Kevin Rojas"));
    await user.click(
      screen.getByRole("button", { name: "Registrar el premio de Kevin Rojas" }),
    );

    const aviso = await within(filaDe("Kevin Rojas")).findByText(
      /ese día no tiene cierre/i,
    );
    expect(aviso).toHaveAttribute("role", "alert");
  });

  it("un fallo de red se dice, y no deja el botón girando para siempre", async () => {
    const user = userEvent.setup();
    registrarMock.mockRejectedValue(new Error("network"));
    listarMock.mockResolvedValue(podio([PRIMERO]));
    montar();

    await waitFor(() => filaDe("Kevin Rojas"));
    const boton = screen.getByRole("button", { name: "Registrar el premio de Kevin Rojas" });
    await user.click(boton);

    expect(
      await within(filaDe("Kevin Rojas")).findByText(/no se pudo completar la operación/i),
    ).toBeInTheDocument();
    await waitFor(() => expect(boton).toBeEnabled());
  });
});

describe("T5.2/R30 — la anulación pide MOTIVO antes de enviar", () => {
  async function abrirDialogo(user: ReturnType<typeof userEvent.setup>) {
    listarMock.mockResolvedValue(podio([{ ...PRIMERO, estado: "registrado" }]));
    montar();
    await waitFor(() => filaDe("Kevin Rojas"));
    await user.click(screen.getByRole("button", { name: "Anular el premio de Kevin Rojas" }));
    return screen.getByRole("dialog");
  }

  it("con el motivo vacío NO se llama a la action", async () => {
    const user = userEvent.setup();
    const dialogo = await abrirDialogo(user);

    const confirmar = within(dialogo).getByRole("button", { name: "Anular el premio" });
    expect(confirmar).toBeDisabled();
    await user.click(confirmar);
    expect(anularMock).not.toHaveBeenCalled();
  });

  it("un motivo de sólo espacios tampoco vale: no es un motivo", async () => {
    const user = userEvent.setup();
    const dialogo = await abrirDialogo(user);

    await user.type(within(dialogo).getByLabelText(/^Motivo de la anulación/), "    ");
    expect(within(dialogo).getByRole("button", { name: "Anular el premio" })).toBeDisabled();
    expect(anularMock).not.toHaveBeenCalled();
  });

  it("con motivo, manda `filaId` y el motivo RECORTADO, y nada más", async () => {
    const user = userEvent.setup();
    anularMock.mockResolvedValue({ status: "ok" });
    const dialogo = await abrirDialogo(user);

    await user.type(
      within(dialogo).getByLabelText(/^Motivo de la anulación/),
      "  Se registró el día equivocado  ",
    );
    await user.click(within(dialogo).getByRole("button", { name: "Anular el premio" }));

    await waitFor(() => expect(anularMock).toHaveBeenCalledTimes(1));
    expect(anularMock).toHaveBeenCalledWith({
      filaId: "fila-1",
      motivo: "Se registró el día equivocado",
    });
  });

  it("el diálogo dice el importe y el día de lo que se va a anular", async () => {
    const user = userEvent.setup();
    const dialogo = await abrirDialogo(user);

    expect(
      within(dialogo).getByText(`Premio de ₡5.000 del podio del ${FECHA}.`),
    ).toBeInTheDocument();
    // Y avisa de que el cupo se consume (R32/Q2), antes de confirmar y no después.
    expect(
      within(dialogo).getByText(/no se podrá volver a registrar/i),
    ).toBeInTheDocument();
  });
});

describe("el refresco dirigido apunta a claves que EXISTEN", () => {
  // El panel refresca por PREFIJO de clave SWR, y esos prefijos viven en otros tres módulos.
  // Es la forma de fallo muda que este repo persigue: alguien renombra su clave, el refresco
  // deja de alcanzarla y la pantalla sigue enseñando la cifra vieja sin que nada se ponga
  // rojo. Acá se emparejan las dos mitades: la que el panel escribe y la que su dueño usa.
  it.each([
    ["wallet-mensajeros:premios", RUTA_PANEL],
    [
      "wallet-mensajeros:cuentas",
      "app/(app)/wallet/mensajeros/_components/CuentasPorPagarTable.tsx",
    ],
    [
      "wallet-mensajeros:desglose",
      "app/(app)/wallet/mensajeros/_components/DesglosePagosMensajero.tsx",
    ],
    [
      "liquidacion:reparto-previsualizacion",
      "app/(app)/wallet/mensajeros/_components/RepartoPrevisualizacion.tsx",
    ],
  ])("«%s» la usa como clave %s, y el panel la refresca", (prefijo, duenio) => {
    expect(codigoSinComentarios(duenio)).toContain(`"${prefijo}"`);
    expect(codigoSinComentarios(RUTA_PANEL)).toContain(`"${prefijo}"`);
  });
});

describe("R35 — money-safe: el dinero es TEXTO de punta a punta", () => {
  it("el panel no convierte ningún importe a número", () => {
    const codigo = codigoSinComentarios(RUTA_PANEL);
    for (const prohibida of LLAMADAS_PROHIBIDAS_EN_DINERO) {
      expect(codigo).not.toMatch(prohibida);
    }
  });

  it("CONTRAPRUEBA: el barrido detecta de verdad una conversión colada", () => {
    const mutado = `${codigoSinComentarios(RUTA_PANEL)}\nconst x = Number(fila.premioMonto);`;
    expect(LLAMADAS_PROHIBIDAS_EN_DINERO.some((p) => p.test(mutado))).toBe(true);
  });
});
