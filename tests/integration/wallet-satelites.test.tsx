// @vitest-environment jsdom
//
// ⭑ FICHA 431 (T21/T22, R17/R21/R22/R23/R24/R25/R27/R28) — `/wallet/satelites`: DÓNDE ESTÁ EL
// EFECTIVO QUE YA ES NUESTRO.
//
// Se montan los componentes DE VERDAD —la tabla de saldos, su desglose desplegable y las
// acciones— y no dobles suyos, por el mismo motivo que la 172 montó `SaldosTiendasTable`: casi
// todo lo que esta pantalla promete es una propiedad de la RELACIÓN entre la tabla, la fila que
// se abre y lo que se marca. Un doble de cualquiera de las tres piezas lo daría por bueno.
//
// La caché de SWR se aísla por render (`provider` nuevo + `dedupingInterval: 0`) para que cada
// caso observe SUS propias llamadas a las Server Actions, que van dobladas.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { SWRConfig } from "swr";
import type { RolValue } from "@prisma/client";

import { ToastProvider } from "@/providers/ToastProvider";
import { esAccesoTotal } from "@/lib/auth/acceso-total";
import type {
  ConsolidacionSateliteDTO,
  ResumenSatelitesDTO,
  SaldoSateliteDTO,
} from "@/lib/types/conciliacion-satelites";
import {
  LLAMADAS_PROHIBIDAS_EN_DINERO,
  codigoSinComentarios,
} from "@/tests/fixtures/money-safe";

// --- Dobles de las Server Actions ---------------------------------------

const listarSaldosMock = vi.fn();
const listarSaldosCompletoMock = vi.fn();
const listarConsolidacionesMock = vi.fn();
const listarConsolidacionesCompletoMock = vi.fn();
const marcarMock = vi.fn();
const revertirMock = vi.fn();
const corregirMock = vi.fn();
const resumenMock = vi.fn();
vi.mock("@/lib/actions/conciliacion-satelites", () => ({
  corregirConsolidacionRecibidaAction: (...a: unknown[]) => corregirMock(...a),
  listarSaldosSatelitesAction: (...a: unknown[]) => listarSaldosMock(...a),
  listarSaldosSatelitesCompletoAction: (...a: unknown[]) => listarSaldosCompletoMock(...a),
  listarConsolidacionesSateliteAction: (...a: unknown[]) => listarConsolidacionesMock(...a),
  listarConsolidacionesSateliteCompletoAction: (...a: unknown[]) =>
    listarConsolidacionesCompletoMock(...a),
  marcarConsolidacionRecibidaAction: (...a: unknown[]) => marcarMock(...a),
  revertirConciliacionAction: (...a: unknown[]) => revertirMock(...a),
  obtenerResumenSatelitesAction: (...a: unknown[]) => resumenMock(...a),
}));

class NotFoundError extends Error {
  constructor() {
    super("NEXT_NOT_FOUND");
    this.name = "NotFoundError";
  }
}
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFoundError();
  },
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("@/lib/auth/resolve-actor", () => ({ resolveActorFromSession: vi.fn() }));

vi.mock("@/app/_components/LogoutButton", () => ({
  LogoutButton: () => <button data-testid="logout-stub">Salir</button>,
}));

import { SaldosSatelitesTable } from "@/app/(app)/wallet/satelites/_components/SaldosSatelitesTable";
import { ConciliacionSatelite } from "@/app/(app)/wallet/satelites/_components/ConciliacionSatelite";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";

const resolveActorMock = vi.mocked(resolveActorFromSession);

// --- Datos ---------------------------------------------------------------
//
// Las cifras son las del diseño aprobado, y NINGUNA es redonda por casualidad: cada una existe
// para que un caso pueda distinguirla de otra.

/** Bodega CON pendiente y con una última recibida INCOMPLETA: el caso entero de la ficha. */
const PUNTARENAS: SaldoSateliteDTO = {
  zonaId: "z-punta",
  zonaNombre: "FGAM Puntarenas",
  saldoSinConciliar: "115000.00",
  totalEfectivo: "1090000.00",
  // El general es DISTINTO del efectivo a propósito: el SINPE no viaja en el bulto (Q2).
  totalConsolidado: "1250000.50",
  // La SUMA histórica. Deliberadamente distinta del monto de la última recibida.
  totalRecibido: "975000.00",
  consolidacionesSinConciliar: 1,
  diasDeLaMasAntigua: 3,
  fechaDeLaMasAntigua: "2026-09-13T10:00:00.000Z",
  ultimaRecibida: {
    fecha: "2026-09-15T17:40:00.000Z",
    monto: "485000.00",
    declarado: "500000.00",
    faltaPorRecibir: "15000.00",
  },
};

/** Bodega AL DÍA: sin pendiente y sin cola. El conmutador la esconde. */
const GUANACASTE: SaldoSateliteDTO = {
  zonaId: "z-guana",
  zonaNombre: "FGAM Guanacaste",
  saldoSinConciliar: "0.00",
  totalEfectivo: "92300.00",
  totalConsolidado: "92300.00",
  totalRecibido: "92300.00",
  consolidacionesSinConciliar: 0,
  diasDeLaMasAntigua: null,
  fechaDeLaMasAntigua: null,
  ultimaRecibida: {
    fecha: "2026-09-15T12:00:00.000Z",
    monto: "92300.00",
    declarado: "92300.00",
    faltaPorRecibir: "0.00",
  },
};

const RESUMEN: ResumenSatelitesDTO = {
  pendienteTotal: "742300.00",
  consolidacionesSinConciliar: 4,
  bodegasConPendiente: 3,
  recibidoEsteMes: "3454597.00",
  consolidacionesRecibidasEsteMes: 28,
  diferenciaTotal: "15000.00",
  consolidacionesConDiferencia: 1,
};

function consolidacion(over: Partial<ConsolidacionSateliteDTO> = {}): ConsolidacionSateliteDTO {
  return {
    cierreBodegaId: "cb-1",
    solicitadoAt: "2026-09-16T14:00:00.000Z",
    totales: {
      efectivo: "100000.00",
      simpe: "0.00",
      transferencia: "0.00",
      general: "100000.00",
    },
    montoRecibido: null,
    faltaPorRecibir: "100000.00",
    conciliado: false,
    conciliadoAt: null,
    conciliadoPorNombre: null,
    nota: null,
    cantidadCierres: 2,
    ...over,
  };
}

/** La que llegó INCOMPLETA: ₡485.000 de ₡500.000 declarados. */
const INCOMPLETA = consolidacion({
  cierreBodegaId: "cb-2",
  solicitadoAt: "2026-09-15T14:00:00.000Z",
  totales: { efectivo: "500000.00", simpe: "0.00", transferencia: "0.00", general: "500000.00" },
  montoRecibido: "485000.00",
  faltaPorRecibir: "15000.00",
  conciliado: true,
  conciliadoAt: "2026-09-15T17:40:00.000Z",
  conciliadoPorNombre: "Ana Rojas",
});

/** La que llegó ENTERA. */
const COMPLETA = consolidacion({
  cierreBodegaId: "cb-3",
  solicitadoAt: "2026-09-13T14:00:00.000Z",
  totales: { efectivo: "284900.00", simpe: "0.00", transferencia: "0.00", general: "284900.00" },
  montoRecibido: "284900.00",
  faltaPorRecibir: "0.00",
  conciliado: true,
  conciliadoAt: "2026-09-13T16:02:00.000Z",
  conciliadoPorNombre: "Ana Rojas",
});

// --- Montaje -------------------------------------------------------------

function renderTabla(
  items: SaldoSateliteDTO[] = [PUNTARENAS, GUANACASTE],
  { resumen = RESUMEN }: { resumen?: ResumenSatelitesDTO | null } = {},
) {
  function Wrapper({ children }: Readonly<{ children: ReactNode }>) {
    return (
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <ToastProvider>{children}</ToastProvider>
      </SWRConfig>
    );
  }
  return render(
    <SaldosSatelitesTable
      initialData={{ items, total: items.length, pageSize: 25 }}
      resumen={resumen}
    />,
    { wrapper: Wrapper },
  );
}

/**
 * FICHA 458-D (T D.4/T D.8, R31, D14) — la conciliación de UNA bodega ya no se DESPLIEGA en la fila:
 * vive en su estado de cuenta (`/wallet/satelites/[zonaId]`), debajo del extracto. Se monta aquí
 * `ConciliacionSatelite` tal como la monta esa página: la bodega, su pendiente (el saldo actual del
 * estado de cuenta, que el servidor cuadra con la MISMA resta que el listado) y el permiso.
 */
const onCambioConciliacion = vi.fn();
function montarConciliacion({ puedeConciliar = true }: { puedeConciliar?: boolean } = {}) {
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToastProvider>
        <ConciliacionSatelite
          bodega={{ zonaId: PUNTARENAS.zonaId, zonaNombre: PUNTARENAS.zonaNombre }}
          pendiente={PUNTARENAS.saldoSinConciliar}
          puedeConciliar={puedeConciliar}
          onCambio={onCambioConciliacion}
        />
      </ToastProvider>
    </SWRConfig>,
  );
  return screen.findByRole("region", { name: `Conciliación de ${PUNTARENAS.zonaNombre}` });
}

/**
 * El BADGE de estado de la fila que contiene `importe`.
 *
 * Se busca por la fila y no por el texto del badge a propósito: «Recibido» es además el
 * encabezado de una columna del desglose, así que un `getByText("Recibido")` compara un `th`
 * con un `Badge` —o falla por ambigüedad— y en ninguno de los dos casos mide lo que dice medir.
 */
function badgeDeFila(region: HTMLElement, dia: string): HTMLElement {
  // `getAllByText(...)[0]`: el día de consolidación es la PRIMERA celda de su fila, y en una
  // conciliada el mismo día puede repetirse en «Conciliado por». Las dos apariciones viven en la
  // MISMA fila, así que la primera basta y no hay ambigüedad real que resolver.
  const celdas = within(region).getAllByText(dia);
  const fila = celdas[0].closest("tr");
  if (fila === null) throw new Error(`no hay fila consolidada el ${dia}`);
  return within(fila).getByText(/^(?:Pendiente de conciliar|Recibido|Recibido incompleto)$/);
}


beforeEach(() => {
  vi.clearAllMocks();
  listarSaldosMock.mockResolvedValue({
    status: "ok",
    items: [PUNTARENAS, GUANACASTE],
    total: 2,
    page: 1,
    pageSize: 25,
  });
  resumenMock.mockResolvedValue({ status: "ok", resumen: RESUMEN });
  listarConsolidacionesMock.mockResolvedValue({
    status: "ok",
    items: [consolidacion(), INCOMPLETA, COMPLETA],
    total: 3,
    page: 1,
    pageSize: 25,
  });
  marcarMock.mockResolvedValue({ status: "ok", cierreBodegaId: "cb-1" });
  revertirMock.mockResolvedValue({ status: "ok", cierreBodegaId: "cb-2" });
  corregirMock.mockResolvedValue({ status: "ok", cierreBodegaId: "cb-2" });
});

afterEach(cleanup);

// =========================================================================
describe("R23 — la tabla de saldos y sus tres tarjetas", () => {
  it("las tres cifras de cabecera llegan CUADRADAS del servidor y se pintan tal cual", () => {
    renderTabla();
    // Los tres importes salen del `resumen`, no de sumar las filas. Si alguien sustituyera la
    // lectura por una suma en el cliente, el total de las DOS bodegas del doble sería
    // ₡115.000 y no los ₡742.300 que el servidor dice, y este caso lo diría.
    expect(screen.getByText("₡742.300")).toBeInTheDocument();
    expect(screen.getByText("₡3.454.597")).toBeInTheDocument();
    expect(screen.getByText("₡15.000")).toBeInTheDocument();
    // Y cada una con su CONTEO al lado: un importe sin cuántas filas lo componen no se persigue.
    expect(screen.getByText("en 4 consolidaciones de 3 bodegas")).toBeInTheDocument();
    expect(screen.getByText("28 consolidaciones conciliadas")).toBeInTheDocument();
    expect(screen.getByText("1 consolidación llegó incompleta")).toBeInTheDocument();
  });

  it("si el resumen degrada, las tarjetas enseñan «—» y LA TABLA SIGUE EN PIE", () => {
    // Una cabecera que no carga no es motivo para esconder los saldos que alguien vino a mirar.
    renderTabla([PUNTARENAS, GUANACASTE], { resumen: null });
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.getByText("FGAM Puntarenas")).toBeInTheDocument();
  });

  it("R21/Q6 — la antigüedad se dice, y NO dispara nada: no hay umbral", async () => {
    const user = userEvent.setup();
    renderTabla();
    expect(screen.getByText("hace 3 días")).toBeInTheDocument();
    // La bodega sin cola dice «al día», que NO es «0 días»: no hay nada que esperar. Vive en
    // «Todas» porque el conmutador arranca recortando a las que deben algo.
    await user.click(screen.getByRole("button", { name: /Todas\(2\)/ }));
    expect(await screen.findByText("al día")).toBeInTheDocument();
    // Y en ninguna parte se anuncia un límite, un vencimiento ni un plazo. Q6 es explícita: un
    // umbral que dispare algo es el bloqueo volviendo por la puerta de atrás.
    for (const palabra of [/vencid/i, /plazo/i, /urgente/i, /atrasad/i, /límite/i]) {
      expect(document.body.textContent ?? "").not.toMatch(palabra);
    }
  });

  it("⭑ «Última recibida» es UNA consolidación, no el acumulado de la bodega", () => {
    // LA CONFUSIÓN QUE ESTE CASO EXISTE PARA IMPEDIR. El doble tiene `totalRecibido` =
    // ₡975.000 (la suma histórica) y una última recibida de ₡485.000. Bajo un rótulo que
    // promete «la última», el acumulado es un número de seis cifras que cuenta otra cosa.
    renderTabla([PUNTARENAS]);
    const fila = screen.getByText("FGAM Puntarenas").closest("tr");
    expect(fila).not.toBeNull();
    expect(within(fila!).getByText(/15 sept.*₡485\.000/)).toBeInTheDocument();
    expect(within(fila!).queryByText(/975\.000/)).toBeNull();
    // Y si esa última llegó incompleta, se dice ahí mismo contra qué se compara.
    expect(within(fila!).getByText("de ₡500.000")).toBeInTheDocument();
  });

  it("una bodega que NUNCA recibió nada pinta «—», no un cero", async () => {
    const user = userEvent.setup();
    renderTabla([{ ...GUANACASTE, ultimaRecibida: null }]);
    // Está al día, así que vive en «Todas».
    await user.click(screen.getByRole("button", { name: /Todas\(1\)/ }));
    const fila = (await screen.findByText("FGAM Guanacaste")).closest("tr");
    expect(fila).not.toBeNull();
    // Ni un cero en la columna de la última recibida: «nunca entregó» no es «entregó ₡0».
    expect(within(fila!).queryByText("₡0")).toBeNull();
    expect(within(fila!).getAllByText("—").length).toBeGreaterThan(0);
  });

  it("el conmutador cuenta las dos pestañas y recorta la que toca", async () => {
    const user = userEvent.setup();
    renderTabla();
    // Arranca en «Con pendiente»: es la pregunta que trae a alguien a esta pantalla.
    expect(screen.getByRole("button", { name: /Con pendiente\(1\)/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Todas\(2\)/ })).toBeInTheDocument();
    expect(screen.queryByText("FGAM Guanacaste")).toBeNull();

    await user.click(screen.getByRole("button", { name: /Todas\(2\)/ }));
    expect(await screen.findByText("FGAM Guanacaste")).toBeInTheDocument();
    expect(screen.getByText("FGAM Puntarenas")).toBeInTheDocument();
  });

  it("⭑ LA NOTA que impide contar dos veces está a la vista, y sin desplegable", () => {
    // Es lo único que separa un número de siete cifras llamado «pendiente» dentro del módulo
    // Wallet de que alguien lo sume al balance y lo cuente dos veces. Si desaparece, la pantalla
    // sigue funcionando y el error se comete en una hoja de cálculo, fuera de la app.
    renderTabla();
    const nota = screen.getByRole("note");
    expect(nota).toHaveTextContent("El saldo no es un movimiento de caja.");
    expect(nota).toHaveTextContent(
      /Ese dinero ya entró a la caja de Ordenex cuando se aprobó el cierre de cada mensajero/,
    );
    expect(nota).toHaveTextContent(/dónde está físicamente/);
    expect(nota).toHaveTextContent(
      /cuánto queda en manos de cada bodega esperando llegar a la central/,
    );
  });
});

// =========================================================================
describe("R22/R24 — la conciliación de una bodega (458-D: en su estado de cuenta)", () => {
  it("lista sus consolidaciones con declarado, recibido, estado y quién conciló", async () => {
    const region = await montarConciliacion();
    await waitFor(() => expect(listarConsolidacionesMock).toHaveBeenCalled());

    // El «Pendiente de llegar» de la cabecera es el saldo que el SERVIDOR cuadró.
    expect(within(region).getByText("₡115.000")).toBeInTheDocument();
    // Declarado es el EFECTIVO (Q2), recibido es lo que se contó.
    expect(within(region).getByText("₡500.000")).toBeInTheDocument();
    expect(within(region).getByText("₡485.000")).toBeInTheDocument();
    expect(within(region).getAllByText("Ana Rojas · 15 sept").length).toBeGreaterThan(0);
  });

  it("⭑ los TRES estados se nombran con el vocabulario aprobado (R28)", async () => {
    const region = await montarConciliacion();
    await within(region).findByText("Pendiente de conciliar");
    expect(badgeDeFila(region, "16 sept")).toHaveTextContent("Pendiente de conciliar");
    expect(badgeDeFila(region, "15 sept")).toHaveTextContent("Recibido incompleto");
    expect(badgeDeFila(region, "13 sept")).toHaveTextContent("Recibido");
    // Y el vocabulario de la aprobación NO aparece en ninguna parte de la pantalla (R16/R28).
    for (const retirado of [/Esperando aprobación/i, /\bAprobado\b/, /\bRechazado\b/]) {
      expect(document.body.textContent ?? "").not.toMatch(retirado);
    }
  });

  it("⭑ «Recibido incompleto» NO se pinta como «Recibido»: mientras falte, es un aviso", async () => {
    // EL CASO QUE SEPARA LAS DOS. Los tres badges conviven en la misma tabla, así que basta
    // comparar sus clases: si alguien igualara el tono, esta línea cae. Pintar de verde una
    // consolidación a la que le faltan ₡15.000 es decir en color lo contrario de lo que dice la
    // cifra de al lado — y el color es lo que se lee al pasar la vista por una lista.
    //
    // Los badges se localizan POR SU FILA (por el importe recibido, que es único en el doble) y
    // no por su texto: «Recibido» también es el encabezado de una columna, y buscarlo por texto
    // acabaría comparando un `th` con un `Badge`.
    const region = await montarConciliacion();
    await within(region).findByText("Pendiente de conciliar");

    const incompleto = badgeDeFila(region, "15 sept");
    const recibido = badgeDeFila(region, "13 sept");
    const pendiente = badgeDeFila(region, "16 sept");

    expect(incompleto.className).not.toBe(recibido.className);
    // Y va en el MISMO tono que «Pendiente de conciliar»: las dos siguen teniendo dinero fuera.
    expect(incompleto.className).toBe(pendiente.className);
    expect(recibido.className).toMatch(/success/);
    expect(incompleto.className).toMatch(/warning/);
  });

  it("⭑ Q7 — la DIFERENCIA se explica en la cabecera, no sólo en una columna", async () => {
    // La mitad que faltaba del control de seguimiento: sin este aviso la bodega descubre la
    // diferencia cuando se la reclaman semanas después.
    const region = await montarConciliacion();
    const aviso = await within(region).findByRole("status");
    expect(aviso).toHaveTextContent("Una consolidación llegó incompleta");
    expect(aviso).toHaveTextContent(
      /Se consolidaron ₡500\.000 y se recibieron ₡485\.000\. La diferencia de ₡15\.000 sigue contando como pendiente/,
    );
  });

  it("sin ninguna incompleta, el aviso de la diferencia NO se enciende", async () => {
    listarConsolidacionesMock.mockResolvedValue({
      status: "ok",
      items: [consolidacion(), COMPLETA],
      total: 2,
      page: 1,
      pageSize: 25,
    });
    const region = await montarConciliacion();
    await waitFor(() => expect(listarConsolidacionesMock).toHaveBeenCalled());
    expect(within(region).queryByRole("status")).toBeNull();
  });

  it("D6 — la nota de «Desmarcar no mueve dinero» va al pie y visible", async () => {
    const region = await montarConciliacion();
    const nota = within(region).getByRole("note");
    expect(nota).toHaveTextContent("Desmarcar no mueve dinero.");
    expect(nota).toHaveTextContent(
      /La marca es informativa: dice si el efectivo llegó, no lo contabiliza/,
    );
    expect(nota).toHaveTextContent(/queda registrado quién marcó y quién deshizo/);
  });

  it("listar las bodegas no lee ninguna conciliación; la de UNA bodega lee UNA vez, y sólo la suya", async () => {
    renderTabla([PUNTARENAS, GUANACASTE]);
    // 458-D (D14): la fila ya no despliega; enlaza al estado de cuenta de su bodega.
    expect(screen.getByRole("link", { name: "Ver estado de cuenta de FGAM Puntarenas" }).getAttribute("href")).toBe(
      "/wallet/satelites/z-punta",
    );
    expect(screen.queryByRole("button", { name: /Ver desglose/ })).toBeNull();
    expect(listarConsolidacionesMock).not.toHaveBeenCalled();
    cleanup();
    await montarConciliacion();
    await waitFor(() => expect(listarConsolidacionesMock).toHaveBeenCalledTimes(1));
    expect(listarConsolidacionesMock.mock.calls[0][0]).toMatchObject({ zonaId: "z-punta" });
  });
});

// =========================================================================
describe("R25 — marcar recibido, corregir y desmarcar", () => {
  it("⭑ el diálogo PRECARGA el monto con lo declarado, y lo dice", async () => {
    const user = userEvent.setup();
    const region = await montarConciliacion();
    await user.click(
      await within(region).findByRole("button", {
        name: /Marcar recibido la consolidación de FGAM Puntarenas/,
      }),
    );
    const dialogo = await screen.findByRole("dialog");
    // El campo nace con el EFECTIVO declarado: la conciliación normal es un clic.
    expect(within(dialogo).getByLabelText(/Monto recibido/)).toHaveValue("100000.00");
    // Lo declarado, a la vista, para comparar mentalmente.
    expect(within(dialogo).getByText("₡100.000")).toBeInTheDocument();
    // Y la pista dice las dos cosas que hay que saber.
    expect(dialogo).toHaveTextContent(
      "Viene con lo declarado. Cambialo solo si contaste una cantidad distinta.",
    );
  });

  it("marcar por MENOS envía el monto tecleado y refresca ESTA bodega", async () => {
    const user = userEvent.setup();
    const region = await montarConciliacion();
    await user.click(
      await within(region).findByRole("button", {
        name: /Marcar recibido la consolidación de FGAM Puntarenas/,
      }),
    );
    const dialogo = await screen.findByRole("dialog");
    const campo = within(dialogo).getByLabelText(/Monto recibido/);
    await user.clear(campo);
    await user.type(campo, "85000.00");
    await user.click(within(dialogo).getByRole("button", { name: "Marcar recibido" }));

    await waitFor(() => expect(marcarMock).toHaveBeenCalledTimes(1));
    expect(marcarMock.mock.calls[0][0]).toEqual({
      cierreBodegaId: "cb-1",
      montoRecibido: "85000.00",
      // La nota vacía NO se manda: el schema del borde es `.strict()` y una cadena vacía sería
      // una nota en blanco guardada como si alguien la hubiera escrito.
    });
    // 473 (R14) — la otra mitad: marcar NUNCA pasa por la action de corregir.
    expect(corregirMock).not.toHaveBeenCalled();
    // 458-D (R30): tras marcar se relee el estado de cuenta de ESTA bodega.
    await waitFor(() => expect(onCambioConciliacion).toHaveBeenCalled());
  });

  it("sobre una INCOMPLETA se ofrece «Corregir» y «Desmarcar», nunca «Marcar recibido»", async () => {
    const region = await montarConciliacion();
    expect(
      await within(region).findByRole("button", { name: /Corregir el monto recibido/ }),
    ).toBeInTheDocument();
    expect(
      within(region).getAllByRole("button", { name: /Desmarcar la consolidación/ }).length,
    ).toBe(2);
  });

  it("⭑ «Desmarcar» dice el importe que va a borrar ANTES de borrarlo", async () => {
    const user = userEvent.setup();
    const region = await montarConciliacion();
    const botones = await within(region).findAllByRole("button", {
      name: /Desmarcar la consolidación/,
    });
    await user.click(botones[0]);
    const dialogo = await screen.findByRole("dialog");
    // Tras revertir, ese importe sólo sobrevive en el registro de acciones: es el dato que
    // falta para decidir, y por eso se dice aquí.
    expect(dialogo).toHaveTextContent(/Ahora mismo consta recibida por/);
    expect(within(dialogo).getByText("₡485.000")).toBeInTheDocument();
    expect(dialogo).toHaveTextContent("Desmarcar no mueve dinero.");
  });

  it("R27 — sin permiso NO se monta ningún botón de conciliar", async () => {
    const region = await montarConciliacion({ puedeConciliar: false });
    await waitFor(() => expect(listarConsolidacionesMock).toHaveBeenCalled());
    expect(within(region).queryByRole("button", { name: /Marcar recibido/ })).toBeNull();
    expect(within(region).queryByRole("button", { name: /Desmarcar/ })).toBeNull();
    expect(within(region).queryByRole("button", { name: /Corregir/ })).toBeNull();
    // Pero SÍ ve los datos: la mitad de mirar no se le quita a nadie que llegue a la pantalla.
    expect(within(region).getByText("Recibido incompleto")).toBeInTheDocument();
  });
});

// =========================================================================
// FICHA 473 (T5, R14-R17) — «Corregir» corrige de verdad, y el conflicto refresca de verdad.
//
// Antes de la 473, «Corregir» abría el diálogo de marcar y llamaba a la action de MARCAR, cuyo
// `WHERE` exige una consolidación SIN marcar: `conflict` el 100 % de las veces, sin escribir, y
// un aviso que prometía «Actualizando la lista» sin refrescar nada.

/** Abre el diálogo de «Corregir» sobre la INCOMPLETA (₡485.000 de ₡500.000). */
async function abrirCorregir(user: ReturnType<typeof userEvent.setup>) {
  const region = await montarConciliacion();
  await user.click(
    await within(region).findByRole("button", {
      name: /Corregir el monto recibido de FGAM Puntarenas/,
    }),
  );
  return screen.findByRole("dialog");
}

/**
 * El título del aviso en el VISOR de notificaciones. Se acota al visor porque un aviso de error
 * se anuncia además en un nodo vivo aparte (dos nodos con el mismo texto), y porque el aviso que
 * importa es el que sobrevive al diálogo, no el que se pintaba dentro de él.
 */
async function avisoEnVisor(texto: string): Promise<HTMLElement> {
  const visor = await screen.findByRole("region", { name: "Notificaciones", hidden: true });
  return within(visor).findByText(texto, { selector: "h2" });
}

describe("473 — corregir el monto recibido (R14-R17)", () => {
  it("R14 — Corregir llama a la action de corregir y nunca a la de marcar", async () => {
    const user = userEvent.setup();
    const dialogo = await abrirCorregir(user);
    const campo = within(dialogo).getByLabelText(/Monto recibido/);
    await user.clear(campo);
    await user.type(campo, "500000.00");
    await user.click(within(dialogo).getByRole("button", { name: "Corregir" }));

    await waitFor(() => expect(corregirMock).toHaveBeenCalledTimes(1));
    expect(corregirMock.mock.calls[0][0]).toEqual({
      cierreBodegaId: "cb-2",
      montoRecibido: "500000.00",
    });
    expect(marcarMock).not.toHaveBeenCalled();
  });

  it("R15 — el diálogo de Corregir arranca con el monto registrado y su botón dice Corregir", async () => {
    const user = userEvent.setup();
    const dialogo = await abrirCorregir(user);
    // Lo ya registrado (485.000), NO lo declarado (500.000): corregir parte de lo que se dijo.
    expect(within(dialogo).getByLabelText(/Monto recibido/)).toHaveValue("485000.00");
    expect(within(dialogo).getByRole("button", { name: "Corregir" })).toBeInTheDocument();
    expect(within(dialogo).queryByRole("button", { name: "Marcar recibido" })).toBeNull();
  });

  it("R16 — corrección ok: cierra el diálogo, avisa el monto corregido y refresca", async () => {
    const user = userEvent.setup();
    const dialogo = await abrirCorregir(user);
    const lecturasAntes = listarConsolidacionesMock.mock.calls.length;
    const campo = within(dialogo).getByLabelText(/Monto recibido/);
    await user.clear(campo);
    await user.type(campo, "500000.00");
    await user.click(within(dialogo).getByRole("button", { name: "Corregir" }));

    expect(await avisoEnVisor("Monto recibido corregido a ₡500.000.")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(onCambioConciliacion).toHaveBeenCalled());
    // Y la lista se RELEE: no basta con avisar al padre.
    await waitFor(() =>
      expect(listarConsolidacionesMock.mock.calls.length).toBeGreaterThan(lecturasAntes),
    );
  });

  it.each([
    {
      caso: "al corregir",
      boton: /Corregir el monto recibido de FGAM Puntarenas/,
      confirmar: "Corregir",
      action: () => corregirMock,
    },
    {
      caso: "al marcar",
      boton: /Marcar recibido la consolidación de FGAM Puntarenas/,
      confirmar: "Marcar recibido",
      action: () => marcarMock,
    },
  ])(
    "R17 — conflict $caso: cierra el diálogo, muestra el aviso y refresca",
    async ({ boton, confirmar, action }) => {
      action().mockResolvedValue({ status: "conflict" });
      const user = userEvent.setup();
      const region = await montarConciliacion();
      await user.click(await within(region).findByRole("button", { name: boton }));
      const dialogo = await screen.findByRole("dialog");
      const lecturasAntes = listarConsolidacionesMock.mock.calls.length;
      await user.click(within(dialogo).getByRole("button", { name: confirmar }));

      // En el VISOR de avisos, no dentro del diálogo: el aviso en línea moría con el diálogo.
      expect(
        await avisoEnVisor("Esta consolidación ya cambió de estado. Actualizando la lista."),
      ).toBeInTheDocument();
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      await waitFor(() => expect(onCambioConciliacion).toHaveBeenCalled());
      await waitFor(() =>
        expect(listarConsolidacionesMock.mock.calls.length).toBeGreaterThan(lecturasAntes),
      );
    },
  );
});

// =========================================================================
describe("R27 — las dos mitades del control", () => {
  it("un rol sin acceso total ni siquiera llega a la pantalla", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "adminSatelite" });
    const { default: WalletSatelitesPage } = await import("@/app/(app)/wallet/satelites/page");
    await expect(WalletSatelitesPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("sin sesión tampoco", async () => {
    resolveActorMock.mockResolvedValue(null);
    const { default: WalletSatelitesPage } = await import("@/app/(app)/wallet/satelites/page");
    await expect(WalletSatelitesPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("el permiso se deriva de `esAccesoTotal`, NO de un `true` escrito a mano", () => {
    // QUÉ PROTEGE ESTO Y QUÉ NO, dicho sin adornos: hoy el valor es SIEMPRE `true` en esta
    // pantalla, porque el `notFound` de arriba ya echó a todo rol sin acceso total. Esta
    // aserción NO mide el eslabón rol → prop: mide la FORMA de una línea que hoy es redundante.
    // Se conserva por lo mismo que en `/wallet/tiendas`: el día que esta vista admita un rol que
    // mira y no concilia, la línea deja de ser redundante de golpe y un `true` hardcodeado que
    // hubiera entrado mientras tanto sería un botón de marcar para quien no puede marcar.
    // 458-D: el permiso viaja desde la página del estado de cuenta de la bodega, donde vive ahora la
    // conciliación.
    const fuente = codigoSinComentarios("app/(app)/wallet/satelites/[zonaId]/page.tsx");
    expect(fuente).toMatch(/puedeConciliar=\{esAccesoTotal\(actor\.rol\)\}/);
    expect(fuente).not.toMatch(/puedeConciliar=\{true\}/);

    // Y el predicado es el MISMO con el que el servicio responde `forbidden`.
    for (const rol of ["mensajero", "adminTienda", "adminSatelite"] as RolValue[]) {
      expect(esAccesoTotal(rol), `${rol} no concilia`).toBe(false);
    }
    for (const rol of ["maestro", "admin"] as RolValue[]) {
      expect(esAccesoTotal(rol), `${rol} sí concilia`).toBe(true);
    }
  });
});

// =========================================================================
describe("R20 — money-safe: el navegador no hace aritmética de dinero", () => {
  it.each([
    "app/(app)/wallet/satelites/_components/SaldosSatelitesTable.tsx",
    "app/(app)/wallet/satelites/_components/ConciliacionSatelite.tsx",
    "app/(app)/wallet/satelites/_components/EstadoCuentaSatelite.tsx",
    "app/(app)/wallet/satelites/[zonaId]/page.tsx",
    "app/(app)/wallet/satelites/_components/satelites-labels.ts",
    "app/(app)/wallet/satelites/_components/saldos-satelites-descarga-columnas.ts",
    "app/(app)/wallet/satelites/_components/consolidaciones-satelite-descarga-columnas.ts",
    "components/shared/conciliacion/ConciliacionAcciones.tsx",
    "components/shared/conciliacion/MarcarRecibidoDialog.tsx",
    "components/shared/conciliacion/conciliacion-labels.ts",
    "app/(app)/wallet/satelites/page.tsx",
  ])("%s no convierte un importe a número", (ruta) => {
    const codigo = codigoSinComentarios(ruta);
    // Autocomprobación: si el lector devolviera vacío, el barrido pasaría sin haber leído nada.
    expect(codigo.length, `${ruta} se leyó vacío`).toBeGreaterThan(200);
    for (const prohibida of LLAMADAS_PROHIBIDAS_EN_DINERO) {
      expect(codigo, `${ruta} :: ${prohibida.source}`).not.toMatch(prohibida);
    }
  });

  it("ningún componente de la pantalla RESTA importes: la diferencia llega del servidor", () => {
    // `faltaPorRecibir` es la identidad que la ficha 359 encontró rota en 13 pantallas. Aquí no
    // se calcula: se lee. Una resta escrita en el cliente se vería como un `-` entre dos
    // expresiones de dinero, y estos archivos no tienen ninguna.
    for (const ruta of [
      "app/(app)/wallet/satelites/_components/ConciliacionSatelite.tsx",
      "app/(app)/wallet/satelites/_components/EstadoCuentaSatelite.tsx",
      "app/(app)/wallet/satelites/_components/SaldosSatelitesTable.tsx",
    ]) {
      const codigo = codigoSinComentarios(ruta);
      expect(codigo, ruta).not.toMatch(/\.(?:minus|plus|sub|add)\(/);
      expect(codigo, ruta).not.toMatch(/(?:efectivo|declarado|general|monto\w*)\s*-\s*\w/);
    }
  });
});
