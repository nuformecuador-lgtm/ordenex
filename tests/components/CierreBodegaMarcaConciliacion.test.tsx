// @vitest-environment jsdom
//
// ⭑ FICHA 431 (T17/T19, R16/R24/R26/R28) — LA MARCA DE CONCILIACIÓN EN LAS SUPERFICIES DEL
// CIERRE DE BODEGA.
//
// ── QUÉ SE MIDE AQUÍ, Y POR QUÉ ESTE ARCHIVO EXISTE
// Dos cosas que ningún test de la 431 mide en otro sitio:
//
//  1. **LO QUE VE LA BODEGA SATÉLITE (R26/Q7).** La decisión del humano fue explícita: si la
//     central recibe ₡485.000 de ₡500.000, la bodega tiene que verlo DONDE YA MIRA. Su pantalla
//     es `CierresBodegaSolicitadosLista`, acotada por zona en el servidor y **sin acción de
//     abrir detalle**: si la diferencia viviera en el modal del maestro, la satélite no la vería
//     nunca y se enteraría cuando se la reclamen. Y no puede marcar ni desmarcar: eso es de la
//     central (R25/R27).
//  2. **EL VOCABULARIO (R28) Y LO QUE SE RETIRA (R16).** `solicitado` se lee «Pendiente de
//     conciliar», `aprobado` se lee «Recibido», y una conciliada por menos se lee «Recibido
//     incompleto» —un estado que la base NO tiene y la pantalla SÍ, porque el dato existe—.
//     «Rechazado» desaparece del rótulo sin que la fila desaparezca del listado.
//
// Los importes llevan CÉNTIMOS a propósito: un juego de cifras redondas cuadra igual con una
// resta hecha en `number`, y entonces el caso no mediría nada.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import type { ReactElement } from "react";

import type { CierreBodegaResumen } from "@/lib/interfaces/services/ICierreBodegaService";
import { money } from "@/lib/config/moneda";
import {
  FALTA_POR_RECIBIR_LABEL,
  MONTO_RECIBIDO_LABEL,
  PENDIENTE_CONCILIAR_LABEL,
  RECIBIDO_INCOMPLETO_LABEL,
  RECIBIDO_LABEL,
} from "@/app/(app)/cierres-admin/_components/cierre-labels";

vi.mock("@/lib/actions/cierre-bodega", () => ({
  listarCierresBodegaSolicitadosPaginado: vi.fn(),
  listarCierresBodegaSolicitadosCompleto: vi.fn(),
  listarHistoricoCierresBodegaPaginado: vi.fn(),
  listarHistoricoCierresBodegaCompleto: vi.fn(),
}));

import { listarCierresBodegaSolicitadosPaginado } from "@/lib/actions/cierre-bodega";
import { CierreBodegaFacturaResumen } from "@/app/(app)/cierres-admin/_components/cierre-factura";
import { CierresBodegaSolicitadosLista } from "@/app/(app)/cierres-admin/_components/CierresBodegaSolicitadosLista";
import { marcaRecibida, marcaSinConciliar } from "@/tests/fixtures/marca-conciliacion";

const ZONA = "33333333-3333-4333-8333-333333333333";

function cierreBodega(over: Partial<CierreBodegaResumen> = {}): CierreBodegaResumen {
  return {
    cierreBodegaId: "b1b1b1b1-1111-4111-8111-b1b1b1b1b1b1",
    zonaId: ZONA,
    zonaNombre: "Limón",
    solicitadoPorId: "u1",
    solicitadoPorNombre: "Sara Satélite",
    estado: "solicitado",
    totales: {
      efectivo: "500000.17",
      simpe: "26089.00",
      transferencia: "0.00",
      general: "526089.17",
    },
    totalPagoMensajero: "14000.55",
    totalIngresoBodegaRechazos: "250.25",
    cantidadCierres: 3,
    solicitadoAt: "2026-09-15T10:00:00.000Z",
    resueltoAt: null,
    motivoRechazo: null,
    paraLaCentral: "511838.37",
    efectivoCubreDescuentos: true,
    ...marcaSinConciliar("500000.17"),
    ...over,
  };
}

/** Conciliada POR MENOS: llegaron ₡485.000,00 de ₡500.000,17 → faltan ₡15.000,17. */
const INCOMPLETA = cierreBodega({
  estado: "aprobado",
  resueltoAt: "2026-09-15T17:40:00.000Z",
  ...marcaRecibida("485000.00", "15000.17", { conciliadoPorNombre: "Ana Rojas" }),
});

/** Conciliada ENTERA. */
const COMPLETA = cierreBodega({
  estado: "aprobado",
  resueltoAt: "2026-09-15T17:40:00.000Z",
  ...marcaRecibida("500000.17", "0.00", { conciliadoPorNombre: "Ana Rojas" }),
});

function envolver(nodo: ReactElement) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{nodo}</SWRConfig>,
  );
}

/** Abre el desplegable de la tarjeta y devuelve la región de la marca. */
async function desplegarConciliacion() {
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: /Ver detalles del cierre de bodega de Limón/ }),
  );
  return screen.getByRole("region", { name: "Conciliación" });
}

/** El badge de estado de la tarjeta (el que va junto al folio). */
function badgeDeEstado(): HTMLElement {
  return screen.getByText(
    new RegExp(
      `^(?:${PENDIENTE_CONCILIAR_LABEL}|${RECIBIDO_LABEL}|${RECIBIDO_INCOMPLETO_LABEL})$`,
    ),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

// =========================================================================
describe("⭑ 431/R28 — el vocabulario del estado en la tarjeta del cierre de bodega", () => {
  it("`solicitado` se lee «Pendiente de conciliar», NO «Solicitado»", () => {
    envolver(<CierreBodegaFacturaResumen cierre={cierreBodega()} />);
    expect(badgeDeEstado()).toHaveTextContent(PENDIENTE_CONCILIAR_LABEL);
    expect(document.body.textContent ?? "").not.toMatch(/\bSolicitado\b/);
  });

  it("`aprobado` sin nada que falte se lee «Recibido», NO «Aprobado»", () => {
    envolver(<CierreBodegaFacturaResumen cierre={COMPLETA} />);
    expect(badgeDeEstado()).toHaveTextContent(RECIBIDO_LABEL);
    expect(document.body.textContent ?? "").not.toMatch(/\bAprobado\b/);
  });

  it("⭑ `aprobado` CON diferencia se lee «Recibido incompleto» — el estado que la base no tiene", () => {
    // Sin este tercer rótulo, una consolidación de la que llegaron ₡485.000 de ₡500.000 se
    // leería «Recibido» a secas y la diferencia sólo existiría en una columna que hay que saber
    // mirar. Es exactamente el caso que Q7 obliga a que la satélite VEA.
    envolver(<CierreBodegaFacturaResumen cierre={INCOMPLETA} />);
    expect(badgeDeEstado()).toHaveTextContent(RECIBIDO_INCOMPLETO_LABEL);
  });

  it("⭑ «Recibido incompleto» NO se pinta como «Recibido»: los dos tonos son distintos", async () => {
    // Se montan por separado y se comparan las clases del badge. Si alguien igualara el tono,
    // una consolidación a la que le faltan ₡15.000 se leería de un vistazo como una que llegó
    // entera — decir en color lo contrario de lo que dice la cifra de al lado.
    const incompleta = envolver(<CierreBodegaFacturaResumen cierre={INCOMPLETA} />);
    const claseIncompleto = badgeDeEstado().className;
    incompleta.unmount();

    const completa = envolver(<CierreBodegaFacturaResumen cierre={COMPLETA} />);
    const claseRecibido = badgeDeEstado().className;
    completa.unmount();

    const pendiente = envolver(<CierreBodegaFacturaResumen cierre={cierreBodega()} />);
    const clasePendiente = badgeDeEstado().className;
    pendiente.unmount();

    expect(claseIncompleto).not.toBe(claseRecibido);
    // Y va en el MISMO tono que «Pendiente de conciliar»: las dos siguen teniendo dinero fuera.
    expect(claseIncompleto).toBe(clasePendiente);
    expect(claseRecibido).toMatch(/success/);
    expect(claseIncompleto).toMatch(/warning/);
  });

  it("⭑ R16 — una `rechazado` NO anuncia ese estado, y su fila SIGUE en pie", () => {
    // La mitad que importa: no se retira el DATO, se retira el RÓTULO. En producción hay cero
    // rechazadas en dos semanas; las históricas se quedan en la base y siguen siendo legibles.
    envolver(
      <CierreBodegaFacturaResumen
        cierre={cierreBodega({ estado: "rechazado", motivoRechazo: "Faltaba el detalle" })}
      />,
    );
    expect(document.body.textContent ?? "").not.toMatch(/\bRechazado\b/);
    // Sin marca se lee por lo que es hoy: pendiente de que alguien diga si el efectivo llegó.
    expect(badgeDeEstado()).toHaveTextContent(PENDIENTE_CONCILIAR_LABEL);
    // Y la tarjeta sigue enseñando su dinero y su motivo.
    expect(screen.getByText(money("526089.17"))).toBeInTheDocument();
    expect(screen.getByText(/Faltaba el detalle/)).toBeInTheDocument();
  });
});

// =========================================================================
describe("⭑ 431/R24 — la marca en el desplegable de la tarjeta", () => {
  it("una conciliada enseña monto recibido, lo que falta y quién la marcó", async () => {
    envolver(<CierreBodegaFacturaResumen cierre={INCOMPLETA} />);
    const marca = await desplegarConciliacion();

    expect(within(marca).getByText(MONTO_RECIBIDO_LABEL)).toBeInTheDocument();
    expect(within(marca).getByText(money("485000.00"))).toBeInTheDocument();
    expect(within(marca).getByText(FALTA_POR_RECIBIR_LABEL)).toBeInTheDocument();
    expect(within(marca).getByText(money("15000.17"))).toBeInTheDocument();
    expect(within(marca).getByText("Ana Rojas")).toBeInTheDocument();
  });

  it("SIN MARCAR no hay línea de monto recibido, y falta el EFECTIVO íntegro", async () => {
    // Un «₡0» ahí diría «alguien contó y no había nada», que es otra cosa — y es la combinación
    // que el `CHECK` de la base declara imposible.
    envolver(<CierreBodegaFacturaResumen cierre={cierreBodega()} />);
    const marca = await desplegarConciliacion();

    expect(within(marca).queryByText(MONTO_RECIBIDO_LABEL)).toBeNull();
    expect(within(marca).getByText(money("500000.17"))).toBeInTheDocument();
  });

  it("⭑ `faltaPorRecibir` LLEGA del servidor: la tarjeta no lo resta (R20)", async () => {
    // El canario: un faltante que NO es `efectivo − recibido`. Si la tarjeta lo recalculara,
    // pintaría ₡15.000,17 en vez de los ₡9.999,99 que el servidor dice.
    envolver(
      <CierreBodegaFacturaResumen
        cierre={cierreBodega({
          estado: "aprobado",
          ...marcaRecibida("485000.00", "9999.99"),
        })}
      />,
    );
    const marca = await desplegarConciliacion();
    expect(within(marca).getByText(money("9999.99"))).toBeInTheDocument();
    expect(marca.textContent ?? "").not.toContain(money("15000.17"));
  });

  it("⭑ la NOTA se ve: es lo que distingue el backfill retroactivo de una conciliación real (R30)", async () => {
    // Los 32 históricos se dieron por recibidos con la fecha de su aprobación original. Sin la
    // nota parecerían contados uno a uno, que es una afirmación sobre dinero que nadie hizo.
    envolver(
      <CierreBodegaFacturaResumen
        cierre={cierreBodega({
          estado: "aprobado",
          ...marcaRecibida("500000.17", "0.00", {
            conciliadoNota: "Conciliación retroactiva de la migración",
          }),
        })}
      />,
    );
    const marca = await desplegarConciliacion();
    expect(
      within(marca).getByText("Conciliación retroactiva de la migración"),
    ).toBeInTheDocument();
  });
});

// =========================================================================
describe("⭑ 431/R26 — lo que ve la BODEGA SATÉLITE en su pestaña", () => {
  function montarSatelite(items: CierreBodegaResumen[]) {
    vi.mocked(listarCierresBodegaSolicitadosPaginado).mockResolvedValue({
      status: "ok",
      page: 1,
      items,
      total: items.length,
      pageSize: 10,
    });
    return envolver(
      <CierresBodegaSolicitadosLista
        initialData={{ items, total: items.length, pageSize: 10 }}
      />,
    );
  }

  it("⭑ ve el estado, el monto recibido y la diferencia de SU consolidación (Q7)", async () => {
    // La decisión del humano, medida: la bodega tiene que ver la diferencia donde ya mira. Ésta
    // es su pantalla —la satélite NO entra a `/wallet/satelites`, que enseña el dinero de todas
    // las bodegas (R27)—.
    montarSatelite([INCOMPLETA]);
    expect(badgeDeEstado()).toHaveTextContent(RECIBIDO_INCOMPLETO_LABEL);

    const marca = await desplegarConciliacion();
    expect(within(marca).getByText(money("485000.00"))).toBeInTheDocument();
    expect(within(marca).getByText(money("15000.17"))).toBeInTheDocument();
  });

  it("⭑ y NO puede marcar ni desmarcar: ni un solo botón de conciliar (R25/R27)", async () => {
    montarSatelite([INCOMPLETA]);
    await desplegarConciliacion();

    for (const prohibido of [/Marcar recibido/i, /Desmarcar/i, /Corregir/i, /Aprobar/i, /Rechazar/i]) {
      expect(
        screen.queryByRole("button", { name: prohibido }),
        `la satélite no puede ${prohibido.source}`,
      ).toBeNull();
    }
    // Y tampoco por texto suelto: un botón mal rotulado seguiría siendo un botón.
    expect(document.body.textContent ?? "").not.toMatch(/Marcar recibido|Desmarcar/);
  });

  it("la satélite y la central leen la MISMA tarjeta, así que no pueden discrepar", async () => {
    // Las dos montan `CierreBodegaFacturaResumen` con el mismo DTO y el mismo mapper detrás. Se
    // mide en vez de razonarse: es la propiedad que impide que la bodega lea «te faltan
    // ₡15.000» y la central «ya llegó completa».
    const satelite = montarSatelite([INCOMPLETA]);
    const marcaSatelite = await desplegarConciliacion();
    const estadoSatelite = badgeDeEstado().textContent;
    const textoSatelite = marcaSatelite.textContent;
    satelite.unmount();

    envolver(<CierreBodegaFacturaResumen cierre={INCOMPLETA} />);
    const marcaCentral = await desplegarConciliacion();

    expect(badgeDeEstado().textContent).toBe(estadoSatelite);
    expect(marcaCentral.textContent).toBe(textoSatelite);
  });
});
