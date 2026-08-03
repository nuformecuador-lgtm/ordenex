// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";

import { PanelesOperativos } from "@/app/(app)/analitica/_components/operativo/PanelesOperativos";
import { PANELES_OPERATIVOS } from "@/app/(app)/analitica/_components/operativo/catalogo-paneles";
import {
  TEXTO_ERROR_PANEL,
  TEXTO_PROHIBIDO,
  TEXTO_SESION_NO_VALIDA,
  TITULO_COBERTURA,
  TITULO_RANGO_EXCEDIDO,
  VACIO_PANEL,
} from "@/app/(app)/analitica/_components/operativo/textos";
import { consultarAnaliticaOperativa } from "@/lib/actions/analitica-operativa";
import { PENUMBRA, type PuntoSerie, type ResultadoOperativo } from "@/lib/types/analitica-operativa";
import type { MetricaUnidad } from "@/lib/analytics/types";

// Feature 131 (T3.1, T3.3) — R2, R3, R4, R5, R6, R8, R19, R23, R24, R27.
//
// El tablero se renderiza ENTERO (la rejilla, no un panel suelto): R24 afirma que un panel
// que lanza no tumba a los demas, y eso solo se puede ver con varios paneles vivos a la vez.

vi.mock("@/lib/actions/analitica-operativa", () => ({
  consultarAnaliticaOperativa: vi.fn(),
}));

let searchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParams,
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/analitica",
}));

const accion = vi.mocked(consultarAnaliticaOperativa);

const TITULO_TASA = "Tasa de entrega";
const TITULO_CREADAS = "Ordenes creadas";

function serieOk(
  metricaId: string,
  puntos: readonly PuntoSerie[],
  unidad: MetricaUnidad = "conteo",
  fechasNoComparables: readonly string[] = [],
): ResultadoOperativo {
  return {
    status: "ok",
    datos: {
      metricaId,
      unidad,
      unidadDeConteo: unidad === "conteo" ? "gestion" : "tiempo",
      rango: {
        preset: "semana",
        desde: new Date("2026-08-03T06:00:00.000Z"),
        hasta: new Date("2026-08-04T06:00:00.000Z"),
        desdeFecha: "2026-08-03",
        hastaFecha: "2026-08-03",
      },
      puntos,
      cobertura: { fechasNoComparables, penumbra: PENUMBRA },
    },
  };
}

/** Respuesta por defecto de cualquier metrica que el caso no personalice. */
function porDefecto(metricaId: string): ResultadoOperativo {
  return serieOk(metricaId, [{ fecha: "2026-08-03", valor: 3 }]);
}

function renderTablero() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <PanelesOperativos />
    </SWRConfig>,
  );
}

function region(nombre: string): HTMLElement {
  return screen.getByRole("region", { name: nombre });
}

/**
 * Espera a que el panel deje de estar en carga y devuelve su region YA ESTABLE.
 *
 * Hace falta porque `findByRole("region")` resuelve con el esqueleto de carga —que ya
 * declara su nombre accesible— y el nodo se REEMPLAZA al llegar la respuesta: quedarse con
 * el primero deja un nodo desconectado y las aserciones miran una pantalla que ya no existe.
 */
async function panelEstable(nombre: string, contenido: string | RegExp): Promise<HTMLElement> {
  await screen.findByText(contenido, undefined, { timeout: 4000 });
  return screen.getByRole("region", { name: nombre });
}

beforeEach(() => {
  vi.clearAllMocks();
  searchParams = new URLSearchParams();
  accion.mockImplementation(async ({ metricaId }) => porDefecto(metricaId));
});
afterEach(cleanup);

/* ========================================================================== */
/* R2 / R3 / R4 / R24 — cinco estados, cinco pixeles                          */
/* ========================================================================== */

describe("Feature 131 (R2) — `forbidden` no es «sin datos»", () => {
  it("con `forbidden` muestra acceso denegado y no pinta ninguna cifra ni el vacio de metrica", async () => {
    accion.mockImplementation(async ({ metricaId }) =>
      metricaId === "tasa_entrega" ? { status: "forbidden" } : porDefecto(metricaId),
    );
    renderTablero();

    const panel = await panelEstable(TITULO_TASA, TEXTO_PROHIBIDO);
    expect(within(panel).getByRole("alert")).toHaveTextContent(TEXTO_PROHIBIDO);

    // Ni una cifra, ni un cero, ni el estado «sin datos»: el vacio de una grafica habla de
    // LA METRICA SIN DATOS EN EL RANGO, y usarlo aqui convertiria un problema de permisos
    // en un problema de negocio que no existe.
    expect(within(panel).queryByText(VACIO_PANEL.titulo)).toBeNull();
    expect(panel.textContent ?? "").not.toMatch(/\d/);
    // Y los demas paneles siguen vivos.
    expect(screen.getByRole("region", { name: TITULO_CREADAS })).toBeInTheDocument();
  });
});

describe("Feature 131 (R3) — `validation_error` no es «sin datos»", () => {
  it("con `validation_error` muestra el mensaje del campo que fallo", async () => {
    accion.mockImplementation(async ({ metricaId }) =>
      metricaId === "tasa_entrega"
        ? {
            status: "validation_error",
            fieldErrors: { zona_id: ["La lista no puede estar vacia"] },
          }
        : porDefecto(metricaId),
    );
    renderTablero();

    const panel = await panelEstable(TITULO_TASA, "Zona: La lista no puede estar vacia");
    // El mensaje va COLGADO DE SU CAMPO: «Zona: …», no un error anonimo.
    expect(within(panel).getByText("Zona: La lista no puede estar vacia")).toBeInTheDocument();
    expect(within(panel).queryByText(VACIO_PANEL.titulo)).toBeNull();
  });
});

describe("Feature 131 (R4) — `unauthenticated` se distingue de `forbidden`", () => {
  it("con `unauthenticated` avisa de sesion no valida, con texto distinto al de prohibido", async () => {
    accion.mockImplementation(async ({ metricaId }) =>
      metricaId === "tasa_entrega" ? { status: "unauthenticated" } : porDefecto(metricaId),
    );
    renderTablero();

    const panel = await panelEstable(TITULO_TASA, TEXTO_SESION_NO_VALIDA);
    expect(within(panel).getByRole("alert")).toHaveTextContent(TEXTO_SESION_NO_VALIDA);
    // «No puedes verlo» y «no sabemos quien eres» piden cosas distintas del usuario.
    expect(TEXTO_SESION_NO_VALIDA).not.toBe(TEXTO_PROHIBIDO);
    expect(within(panel).queryByText(TEXTO_PROHIBIDO)).toBeNull();
    expect(within(panel).queryByText(VACIO_PANEL.titulo)).toBeNull();
  });
});

describe("Feature 131 (R24) — un panel roto no tumba el tablero", () => {
  it("un panel que lanza no tumba los demas y su mensaje no filtra ids", async () => {
    const GUIA = "ORD-99887766";
    accion.mockImplementation(async ({ metricaId }) => {
      if (metricaId === "tasa_entrega") {
        throw new Error(`fallo consultando la orden ${GUIA} del mensajero 8f21-uuid`);
      }
      return porDefecto(metricaId);
    });
    renderTablero();

    const panel = await panelEstable(TITULO_TASA, TEXTO_ERROR_PANEL);
    expect(within(panel).getByRole("alert")).toHaveTextContent(TEXTO_ERROR_PANEL);

    // El mensaje esta SANEADO: ni la guia, ni el uuid, ni el texto crudo de la excepcion.
    const texto = panel.textContent ?? "";
    expect(texto).not.toContain(GUIA);
    expect(texto).not.toContain("8f21-uuid");
    // Y el resto del tablero sigue en pie.
    expect(await screen.findByRole("region", { name: TITULO_CREADAS })).toBeInTheDocument();
  });
});

/* ========================================================================== */
/* R5 / R6 — la ventana ciega, en UN aviso                                     */
/* ========================================================================== */

describe("Feature 131 (R5, R6) — el aviso de cobertura", () => {
  beforeEach(() => {
    accion.mockImplementation(async ({ metricaId }) =>
      serieOk(metricaId, [{ fecha: "2026-08-03", valor: 3 }], "conteo", [
        "2026-07-10",
        "2026-07-11",
      ]),
    );
  });

  it("con fechas no comparables muestra el aviso de cobertura con su recuento y sus extremos", async () => {
    renderTablero();
    const aviso = await screen.findByText(/no son comparables/);
    // El RECUENTO...
    expect(aviso).toHaveTextContent("2 fechas del rango no son comparables");
    // ...y los EXTREMOS. Sin esto, los ceros de esos dias se leen como una caida de la
    // operacion que nunca ocurrio.
    expect(aviso).toHaveTextContent("2026-07-10");
    expect(aviso).toHaveTextContent("2026-07-11");
    expect(screen.getByText(TITULO_COBERTURA)).toBeInTheDocument();
  });

  it("el aviso de cobertura declara la penumbra", async () => {
    renderTablero();
    // R6 — la limitacion PERMANENTE: ordenes vivas al horizonte sin transicion posterior.
    // No se estima, no se rellena, no se convierte en un numero: se declara.
    expect(await screen.findByText(/nunca volvieron a cambiar de estado/)).toBeInTheDocument();
    expect(screen.getByText(/no se estima ni se rellena/)).toBeInTheDocument();
  });

  it("es UN aviso para todo el tablero, no uno por grafica (D1)", async () => {
    renderTablero();
    await screen.findByText(TITULO_COBERTURA);
    expect(screen.getAllByText(TITULO_COBERTURA)).toHaveLength(1);
  });

  it("sin fechas no comparables no hay aviso", async () => {
    accion.mockImplementation(async ({ metricaId }) => porDefecto(metricaId));
    renderTablero();
    await screen.findByRole("region", { name: TITULO_CREADAS });
    expect(screen.queryByText(TITULO_COBERTURA)).toBeNull();
  });
});

/* ========================================================================== */
/* R8 — el dia en curso                                                        */
/* ========================================================================== */

describe("Feature 131 (R8) — el dia en curso viaja marcado", () => {
  it("el punto del dia en curso se anuncia como parcial con su hora de corte", async () => {
    // Solo UNA metrica trae el dia en curso, para que la asercion apunte a un panel
    // concreto y no a las siete copias del mismo texto.
    accion.mockImplementation(async ({ metricaId }) =>
      metricaId === "ordenes_creadas"
        ? serieOk(metricaId, [
            { fecha: "2026-08-02", valor: 7 },
            // 20:35 UTC = 14:35 en Costa Rica (UTC-6, sin horario de verano).
            { fecha: "2026-08-03", valor: 2, parcial: true, corteAt: "2026-08-03T20:35:00.000Z" },
          ])
        : porDefecto(metricaId),
    );
    renderTablero();

    const panel = await panelEstable(TITULO_CREADAS, /2026-08-03 \(dia en curso, parcial/);
    // POR TEXTO, no solo por color: en la alternativa textual de la 130 no hay color que
    // leer, y un dia abierto pintado como cerrado es una cifra falsa.
    expect(within(panel).getByText(/2026-08-03 \(dia en curso, parcial/)).toBeInTheDocument();
    expect(within(panel).getByText(/14:35/)).toBeInTheDocument();
    // El dia cerrado NO lleva la marca.
    expect(within(panel).queryByText(/2026-08-02 \(dia en curso/)).toBeNull();
  });

  it("un total que incluye el dia en curso se anuncia parcial en pantalla (R9)", async () => {
    accion.mockImplementation(async ({ metricaId }) =>
      metricaId === "ordenes_creadas"
        ? serieOk(metricaId, [
            { fecha: "2026-08-02", valor: 7 },
            { fecha: "2026-08-03", valor: 2, parcial: true, corteAt: "2026-08-03T20:35:00.000Z" },
          ])
        : porDefecto(metricaId),
    );
    renderTablero();
    const panel = await panelEstable(TITULO_CREADAS, /Total parcial/);
    expect(within(panel.parentElement as HTMLElement).getByText(/Total parcial/)).toBeInTheDocument();
  });
});

/* ========================================================================== */
/* R19 — el porcentaje es una fraccion                                         */
/* ========================================================================== */

describe("Feature 131 (R19) — el porcentaje viaja como razon cruda", () => {
  it("un 0,842 de tasa se pinta como 84,2 %", async () => {
    accion.mockImplementation(async ({ metricaId }) =>
      metricaId === "tasa_entrega"
        ? serieOk(metricaId, [{ fecha: "2026-08-03", valor: 0.842 }], "porcentaje")
        : porDefecto(metricaId),
    );
    renderTablero();

    const panel = await panelEstable(TITULO_TASA, /84,2\s*%/);
    // `formato.ts` usa `Intl` con `style: "percent"`, que YA multiplica por 100.
    // Premultiplicar aqui daria «8420 %».
    expect(within(panel).getByText(/84,2\s*%/)).toBeInTheDocument();
    expect(within(panel).queryByText(/8420/)).toBeNull();
  });
});

/* ========================================================================== */
/* R27 / D3 — el hueco declarado                                               */
/* ========================================================================== */

describe("Feature 131 (R27) — por encima del techo, ni serie ni cifra", () => {
  it("un panel de tasa por encima del techo no muestra ninguna cifra total, solo el aviso de reducir el rango", async () => {
    const noventaDias: PuntoSerie[] = Array.from({ length: 90 }, (_, i) => ({
      fecha: new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString().slice(0, 10),
      valor: 0.5 + i / 1000,
    }));
    accion.mockImplementation(async ({ metricaId }) =>
      metricaId === "tasa_entrega"
        ? serieOk(metricaId, noventaDias, "porcentaje")
        : porDefecto(metricaId),
    );
    renderTablero();

    const panel = await panelEstable(TITULO_TASA, TITULO_RANGO_EXCEDIDO);
    expect(within(panel).getByText(TITULO_RANGO_EXCEDIDO)).toBeInTheDocument();
    expect(within(panel).getByText(/Reduce el rango/)).toBeInTheDocument();

    // CERO NUMEROS. Ni la media de los puntos diarios (media de medias, que D3 prohibe),
    // ni la razon recompuesta a mano: hasta que exista una fuente que sume ANTES de
    // dividir, el hueco se DECLARA en pantalla en vez de rellenarse.
    expect(panel.textContent ?? "").not.toMatch(/\d/);
  });

  it("un conteo por encima del techo SI se pinta, agregado por semana y anunciandolo", async () => {
    const noventaDias: PuntoSerie[] = Array.from({ length: 90 }, (_, i) => ({
      fecha: new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString().slice(0, 10),
      valor: 1,
    }));
    accion.mockImplementation(async ({ metricaId }) =>
      metricaId === "ordenes_creadas" ? serieOk(metricaId, noventaDias) : porDefecto(metricaId),
    );
    renderTablero();

    const panel = await panelEstable(TITULO_CREADAS, /sumados por semana/);
    expect(within(panel).queryByText(TITULO_RANGO_EXCEDIDO)).toBeNull();
    expect(
      within(panel.parentElement as HTMLElement).getByText(/sumados por semana/),
    ).toBeInTheDocument();
  });
});

/* ========================================================================== */
/* R23 — el control explicito de actualizacion                                 */
/* ========================================================================== */

describe("Feature 131 (R23) — actualizar sin cambiar el filtro", () => {
  it("el boton de actualizar vuelve a consultar todos los paneles con el mismo filtro", async () => {
    renderTablero();
    await screen.findByRole("region", { name: TITULO_CREADAS });

    const antes = accion.mock.calls.length;
    expect(antes).toBeGreaterThan(0);
    const filtroAntes = accion.mock.calls.map(([entrada]) => JSON.stringify(entrada.raw));

    await userEvent.click(screen.getByRole("button", { name: /Actualizar/ }));

    // TODOS los paneles vuelven a consultar...
    await waitFor(() => expect(accion.mock.calls.length).toBeGreaterThan(antes));
    const invocaciones = new Set(
      accion.mock.calls.slice(antes).map(([entrada]) => entrada.metricaId),
    );
    const esperadas = new Set(PANELES_OPERATIVOS.flatMap((p) => p.metricas.map((m) => m.metricaId)));
    expect(invocaciones).toEqual(esperadas);

    // ...y con EL MISMO filtro: el boton actualiza, no cambia lo que el usuario pidio.
    const filtroDespues = accion.mock.calls.slice(antes).map(([e]) => JSON.stringify(e.raw));
    expect(new Set(filtroDespues)).toEqual(new Set(filtroAntes));
  });
});

/* ========================================================================== */
/* R21 — incidentes y sin_gestionar llegan al pixel                            */
/* ========================================================================== */

describe("Feature 131 (R21) — las dos metricas `declarada` se pintan", () => {
  it("el tablero consulta `incidentes` y `sin_gestionar`", async () => {
    renderTablero();
    await screen.findByRole("region", { name: TITULO_CREADAS });
    await waitFor(() => {
      const consultadas = accion.mock.calls.map(([e]) => e.metricaId);
      expect(consultadas).toContain("incidentes");
      expect(consultadas).toContain("sin_gestionar");
    });
    expect(region("Ordenes sin gestionar")).toBeInTheDocument();
    expect(region("Resultado de las gestiones")).toBeInTheDocument();
  });
});
