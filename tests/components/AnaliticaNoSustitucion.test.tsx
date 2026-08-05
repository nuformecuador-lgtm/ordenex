// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import { SWRConfig } from "swr";

import { FiltrosOperativos } from "@/app/(app)/analitica/_components/operativo/FiltrosOperativos";
import { PanelesOperativos } from "@/app/(app)/analitica/_components/operativo/PanelesOperativos";
import {
  metricasDelTablero,
  PANELES_OPERATIVOS,
} from "@/app/(app)/analitica/_components/operativo/catalogo-paneles";
import {
  ETIQUETA_REJILLA,
  TEXTO_PROHIBIDO,
  VACIO_PANEL,
} from "@/app/(app)/analitica/_components/operativo/textos";
import type { Faceta } from "@/lib/analytics/presentacion";
import { consultarAnaliticaOperativa } from "@/lib/actions/analitica-operativa";
import { obtenerCatalogoFiltrosOrdenes } from "@/lib/actions/filtros-ordenes";
import { listarUsuariosPorRol } from "@/lib/actions/usuarios-por-rol";
import { PENUMBRA, type ResultadoOperativo } from "@/lib/types/analitica-operativa";
import { ToastProvider } from "@/providers/ToastProvider";

// Feature 133 (T6.2 / T6.3) — R21 y R19.
//
// ┌──────────────────────────────────────────────────────────────────────────────────────┐
// │ AVISO QUE LA 122 DIRIGE A ESTA FEATURE, LITERAL                                       │
// │ (`specs/122-analitica-alcance-por-rol/design.md:466-468`):                            │
// │                                                                                       │
// │   «→ 133 (recortes por rol). El recorte de PRESENTACION consulta                      │
// │    `listarMetricas({ rol })`; el de DATOS es este. Un panel que no se pinta no es un  │
// │    dato que no se filtra: no sustituyas uno por el otro.»                             │
// └──────────────────────────────────────────────────────────────────────────────────────┘
//
// Este archivo es el que impide confundir los dos recortes, y por eso su forma es la que
// es: monta LA MISMA pantalla, con EL MISMO filtro en la URL, tres veces —con el recorte
// de presentacion completo, con uno parcial y sin recorte ninguno— y compara lo que sale
// por la unica puerta que toca el dato: `consultarAnaliticaOperativa`.
//
// Lo que se afirma es una NO-DIFERENCIA: retirar el recorte de presentacion no cambia ni
// un argumento de la consulta al borde ni una fila de la respuesta. Si esta comparacion
// fallara —si al ocultar un selector cambiara lo que se pregunta—, significaria que la
// pantalla se habria puesto a recortar DATOS, y entonces el recorte real (el de la 122,
// que corre en el servidor antes de tocar la base) o no existe o esta siendo suplantado
// por una decision de pixel que cualquiera elude escribiendo la URL a mano.
//
// Y al reves, para que no se lea como un test complaciente: los tres montajes SI difieren
// en pantalla (el caso «la barra si cambia» de abajo lo afirma). La igualdad no viene de
// que el recorte no haga nada; viene de que lo que hace no toca la consulta.

vi.mock("@/lib/actions/analitica-operativa", () => ({
  consultarAnaliticaOperativa: vi.fn(),
}));
vi.mock("@/lib/actions/filtros-ordenes", () => ({
  obtenerCatalogoFiltrosOrdenes: vi.fn(),
}));
vi.mock("@/lib/actions/usuarios-por-rol", () => ({
  listarUsuariosPorRol: vi.fn(),
}));

let searchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParams,
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/analitica",
}));

const accion = vi.mocked(consultarAnaliticaOperativa);
const catalogo = vi.mocked(obtenerCatalogoFiltrosOrdenes);
const mensajeros = vi.mocked(listarUsuariosPorRol);

/**
 * El filtro que viaja en la URL. Trae LAS TRES dimensiones con valores de verdad —incluida
 * `mensajero`, que es la que ningun rol acotado ve dibujada— para que la comparacion no
 * pueda pasar por vacio: si el `raw` se quedara sin ellas, la igualdad de abajo seria la de
 * dos consultas igual de peladas.
 */
const UUID_MENSAJERO = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const ZONA = "z-9f1";
const TIENDA = "t-4b7";
const QUERY = `rango=mes&zona=${ZONA}&tienda=${TIENDA}&mensajero=${UUID_MENSAJERO}`;

/**
 * Valor reconocible de la fixture: es «la fila» cuya presencia se compara. De tres cifras a
 * proposito, para que el formateador de `Intl` no le meta separador de millares y el texto
 * pintado se pueda buscar tal cual.
 */
const VALOR_FILA = 731;

function serieOk(metricaId: string): ResultadoOperativo {
  return {
    status: "ok",
    datos: {
      metricaId,
      unidad: "conteo",
      unidadDeConteo: "gestion",
      rango: {
        preset: "mes",
        desde: new Date("2026-07-05T06:00:00.000Z"),
        hasta: new Date("2026-08-04T06:00:00.000Z"),
        desdeFecha: "2026-07-05",
        hastaFecha: "2026-08-03",
      },
      puntos: [{ fecha: "2026-08-03", valor: VALOR_FILA }],
      cobertura: { fechasNoComparables: [], penumbra: PENUMBRA },
    },
  };
}

const FACETAS_TODAS: readonly Faceta[] = ["zona", "tienda", "mensajero"];

/**
 * Los tres recortes que esta feature produce, escritos POR VALOR (misma tabla que
 * `tests/components/FiltrosOperativos.test.tsx:258-269` y
 * `tests/unit/analytics/presentacion.test.ts`). No se derivan de `recorteDePresentacion`
 * a proposito: derivarlos de la funcion que produce la prop haria tautologico el caso, y
 * ademas arrastraria el catalogo de servidor a un test de jsdom.
 */
const RECORTES = [
  { nombre: "maestro/admin — SIN recorte: las tres facetas y alcance global", facetas: FACETAS_TODAS, alcance: "global" },
  { nombre: "adminTienda — recorte parcial: solo «Zona», alcance tienda", facetas: ["zona"] as const, alcance: "tienda" },
  { nombre: "mensajero — recorte total: cero facetas, alcance mensajero", facetas: [] as const, alcance: "mensajero" },
] as const;

type Recorte = (typeof RECORTES)[number];

/** Una llamada al borde, normalizada y COMPLETA: nada de la entrada se descarta. */
function llamadasAlBorde(): string[] {
  return accion.mock.calls
    .map(([entrada]) =>
      JSON.stringify({
        metricaId: entrada.metricaId,
        raw: entrada.raw,
        desagregacion: entrada.desagregacion ?? null,
      }),
    )
    .sort();
}

/** Monta la pantalla con un recorte y espera a que TODAS las metricas hayan consultado. */
async function montar(recorte: {
  readonly facetas: readonly Faceta[];
  readonly alcance: "global" | "zona" | "tienda" | "mensajero" | "denegado";
}) {
  render(
    // Feature 134 (T4.2): montar el tablero arrastra `ExportarOperativoPanel` →
    // `DescargarDatasetButton` → `useToast()`, asi que el `ToastProvider` es obligatorio;
    // sin el, el render lanza y el body queda vacio. Mismo envoltorio que `renderTablero()`
    // en `tests/components/TableroOperativo.test.tsx`.
    <ToastProvider>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <FiltrosOperativos facetas={recorte.facetas} />
        <PanelesOperativos alcance={recorte.alcance} />
      </SWRConfig>
    </ToastProvider>,
  );
  await waitFor(() =>
    expect(new Set(accion.mock.calls.map(([e]) => e.metricaId)).size).toBe(
      metricasDelTablero().length,
    ),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  searchParams = new URLSearchParams(QUERY);
  accion.mockImplementation(async ({ metricaId }) => serieOk(metricaId));
  catalogo.mockResolvedValue({
    status: "ok",
    catalogo: {
      zonas: [{ id: ZONA, nombre: "Zona Central" }],
      tiendas: [{ id: TIENDA, nombre: "Tienda Uno", esApiKey: false, activa: true }],
      provincias: [],
      cantones: [],
      distritos: [],
    },
  });
  mensajeros.mockResolvedValue({
    status: "ok",
    usuarios: [{ id: UUID_MENSAJERO, nombre: "Beto Repartidor" }],
  });
});
afterEach(cleanup);

/* ========================================================================== */
/* T6.2 — R21: EL RECORTE DE PRESENTACION NO SUSTITUYE AL DE DATOS            */
/* ========================================================================== */

describe("Feature 133 (R21) — retirar el recorte de presentacion no cambia la consulta al borde", () => {
  it("la fixture trae de verdad las tres dimensiones: la comparacion no puede pasar por vacio", async () => {
    await montar(RECORTES[0]);
    const raws = accion.mock.calls.map(([e]) => JSON.stringify(e.raw));
    expect(raws.length).toBeGreaterThan(0);
    for (const raw of raws) {
      expect(raw).toContain(`"zona_id":["${ZONA}"]`);
      expect(raw).toContain(`"tienda_id":["${TIENDA}"]`);
      expect(raw).toContain(`"mensajero_id":["${UUID_MENSAJERO}"]`);
      expect(raw).toContain('"rango":"mes"');
    }
  });

  it("los argumentos enviados a `consultarAnaliticaOperativa` son IDENTICOS con y sin recorte", async () => {
    const porRecorte = new Map<string, string[]>();

    for (const recorte of RECORTES as readonly Recorte[]) {
      vi.clearAllMocks();
      accion.mockImplementation(async ({ metricaId }) => serieOk(metricaId));
      await montar(recorte);
      porRecorte.set(recorte.nombre, llamadasAlBorde());
      cleanup();
    }

    const [referencia, ...resto] = [...porRecorte.entries()];
    // Nueve metricas distintas, no una: la igualdad se afirma sobre el tablero entero.
    expect(referencia[1]).toHaveLength(metricasDelTablero().length);
    for (const [nombre, llamadas] of resto) {
      expect(llamadas, `«${nombre}» consulta distinto que «${referencia[0]}»`).toEqual(
        referencia[1],
      );
    }
  });

  it("ni una fila de la respuesta cambia: los seis paneles pintan lo mismo", async () => {
    const pintado = new Map<string, string>();

    for (const recorte of RECORTES as readonly Recorte[]) {
      vi.clearAllMocks();
      accion.mockImplementation(async ({ metricaId }) => serieOk(metricaId));
      await montar(recorte);
      // La rejilla, no la pantalla entera: el rotulo de alcance SI cambia con el recorte
      // (es su trabajo, R24) y compararlo aqui mezclaria dos cosas distintas.
      const rejilla = await screen.findByRole("group", { name: ETIQUETA_REJILLA });
      await within(rejilla).findAllByText(new RegExp(String(VALOR_FILA)));
      pintado.set(recorte.nombre, rejilla.textContent ?? "");
      cleanup();
    }

    const [referencia, ...resto] = [...pintado.entries()];
    // Que la fila este DE VERDAD en el texto comparado, y los seis paneles con ella.
    expect(referencia[1]).toContain(String(VALOR_FILA));
    for (const panel of PANELES_OPERATIVOS) expect(referencia[1]).toContain(panel.titulo);
    for (const [nombre, texto] of resto) {
      expect(texto, `«${nombre}» pinta filas distintas que «${referencia[0]}»`).toBe(
        referencia[1],
      );
    }
  });

  it("y la barra SI cambia: la igualdad de arriba no viene de que el recorte no haga nada", async () => {
    await montar(RECORTES[0]);
    expect(await screen.findByRole("button", { name: /^Zona:/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Tienda:/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Mensajero:/ })).toBeInTheDocument();
    cleanup();

    vi.clearAllMocks();
    accion.mockImplementation(async ({ metricaId }) => serieOk(metricaId));
    await montar(RECORTES[1]);
    expect(await screen.findByRole("button", { name: /^Zona:/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Tienda:/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Mensajero:/ })).toBeNull();
    cleanup();

    vi.clearAllMocks();
    accion.mockImplementation(async ({ metricaId }) => serieOk(metricaId));
    await montar(RECORTES[2]);
    expect(screen.queryByRole("button", { name: /^(Zona|Tienda|Mensajero):/ })).toBeNull();
  });
});

/* ========================================================================== */
/* T6.3 — R19: EL PARAMETRO DE UNA FACETA OCULTA, PRESENTE EN LA URL         */
/* ========================================================================== */

// R19 pide que, con el parametro de una dimension que NO se ofrece presente en la URL, la
// UI no se rompa y no lo silencie: lo que se pinte debe ser EXACTAMENTE lo que devuelva el
// borde para esa consulta, nunca un dato ajeno ni un vacio que lo simule.
//
// El caso es real, no hipotetico: la URL es compartible (`filtro-tablero.ts:5-10`), asi que
// un enlace copiado de la pantalla de un maestro llega a un adminTienda con `mensajero=…`
// dentro aunque su barra no dibuje ese selector.
//
// Ojo con la lectura: que el parametro siga viajando NO es un descuido, es el requisito.
// Silenciarlo en el cliente seria recortar datos en la UI (R20) y dejaria al usuario
// mirando una cifra que no corresponde al filtro que su URL dice tener.

describe("Feature 133 (R19) — un parametro de faceta oculta no se silencia ni rompe la pantalla", () => {
  /** El recorte de un `adminTienda`: su barra NO dibuja «Mensajero» (R15). */
  const ADMIN_TIENDA = RECORTES[1];

  it("el `raw` que viaja al borde es el mismo que con la barra completa", async () => {
    await montar(ADMIN_TIENDA);
    const conRecorte = llamadasAlBorde();
    // El selector no esta dibujado...
    expect(screen.queryByRole("button", { name: /^Mensajero:/ })).toBeNull();
    // ...y aun asi el filtro que el actor lleva en la URL viaja INTACTO.
    for (const [entrada] of accion.mock.calls) {
      expect(JSON.stringify(entrada.raw)).toContain(`"mensajero_id":["${UUID_MENSAJERO}"]`);
    }
    cleanup();

    vi.clearAllMocks();
    accion.mockImplementation(async ({ metricaId }) => serieOk(metricaId));
    await montar(RECORTES[0]);
    expect(conRecorte).toEqual(llamadasAlBorde());
  });

  it("la pantalla no se rompe: los seis paneles siguen en pie con el parametro oculto puesto", async () => {
    await montar(ADMIN_TIENDA);
    for (const panel of PANELES_OPERATIVOS) {
      expect(
        await screen.findByRole("region", { name: panel.titulo }),
        `falta el panel «${panel.titulo}»`,
      ).toBeInTheDocument();
    }
  });

  it("lo que se pinta es lo que devolvio el borde, no un dato ajeno", async () => {
    const AJENO = 908;
    accion.mockImplementation(async ({ metricaId }) => serieOk(metricaId));
    await montar(ADMIN_TIENDA);
    const rejilla = await screen.findByRole("group", { name: ETIQUETA_REJILLA });
    await within(rejilla).findAllByText(new RegExp(String(VALOR_FILA)));
    expect(rejilla.textContent ?? "").toContain(String(VALOR_FILA));
    expect(rejilla.textContent ?? "").not.toContain(String(AJENO));
  });

  it("si el borde deniega esa consulta, la UI pinta el denegado del borde y no un vacio que lo simule", async () => {
    // La decision de que hacer con el `mensajero_id` inyectado es DEL BORDE (T6.6). Aqui se
    // comprueba lo unico que le toca a la pantalla: transcribir esa respuesta sin
    // convertirla en «sin datos» ni en una serie vacia que parezca una respuesta normal.
    accion.mockImplementation(async ({ metricaId }) =>
      metricaId === "tasa_entrega" ? { status: "forbidden" } : serieOk(metricaId),
    );
    await montar(ADMIN_TIENDA);

    await screen.findByText(TEXTO_PROHIBIDO);
    const panel = screen.getByRole("region", { name: "Tasa de entrega" });
    expect(within(panel).getByRole("alert")).toHaveTextContent(TEXTO_PROHIBIDO);
    expect(within(panel).queryByText(VACIO_PANEL.titulo)).toBeNull();
    expect(panel.textContent ?? "").not.toMatch(/\d/);
  });
});
