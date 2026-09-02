// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { SWRConfig } from "swr";

import { calcularEfectividad } from "@/app/(app)/analitica/_components/entregas/efectividad";
import { KpisEfectividad } from "@/app/(app)/analitica/_components/entregas/KpisEfectividad";
import {
  TEXTO_PROHIBIDO,
  TEXTO_SESION_NO_VALIDA,
} from "@/app/(app)/analitica/_components/operativo/textos";
import { consultarConteoPorStatus } from "@/lib/actions/conteo-por-status";
import type { ConteoDeStatus } from "@/lib/types/conteo-por-status";

vi.mock("@/lib/actions/conteo-por-status", () => ({
  consultarConteoPorStatus: vi.fn(),
}));

const consultarMock = vi.mocked(consultarConteoPorStatus);

function datos(porStatus: ConteoDeStatus[]) {
  return {
    porStatus,
    total: porStatus.reduce((s, f) => s + f.conteo, 0),
    lastSync: "2026-08-18T18:30:00.000Z",
  };
}

/**
 * FICHA 360 — el MISMO DTO pero con el `total` DESCUADRADO respecto a los `conteo`.
 *
 * ⚠ NO ES UN CASO REAL Y NO PRETENDE SERLO: `ConteoPorStatusDTO` promete que su `total` es la
 * suma exacta de los `conteo`, y en producción lo es. Es una SONDA, y es la única manera de
 * saber CUÁL de las dos fuentes lee el rótulo — mientras las dos coincidan, un test que las
 * compare pasa igual lea la que lea, y la mutación «toma la base de `datos.total`» sobrevive
 * en verde.
 */
function datosConTotalDescuadrado(porStatus: ConteoDeStatus[], total: number) {
  return { porStatus, total, lastSync: "2026-08-18T18:30:00.000Z" };
}

function renderKpis() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <KpisEfectividad />
    </SWRConfig>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

/* -------------------------------------------------------------------------- */
/* El reparto, sin renderizar nada                                             */
/* -------------------------------------------------------------------------- */

describe("El reparto de la efectividad", () => {
  it("mide entregadas sobre el universo ENTERO, en proceso incluido", () => {
    const r = calcularEfectividad([
      { status: "entregada", conteo: 60 },
      { status: "devuelta", conteo: 20 },
      { status: "en_reparto", conteo: 20 },
    ]);

    expect(r).toMatchObject({ entregadas: 60, enProceso: 20, total: 100, efectividad: 0.6 });
  });

  // La efectividad de la GESTIÓN suma los rechazos al numerador: en un rechazo el mensajero
  // llegó, encontró al destinatario y resolvió la orden — lo que falló fue la venta.
  it("la efectividad de la gestión suma entregadas y rechazadas sobre el MISMO total", () => {
    const r = calcularEfectividad([
      { status: "entregada", conteo: 60 },
      { status: "rechazada", conteo: 15 },
      { status: "devuelta", conteo: 5 },
      { status: "en_reparto", conteo: 20 },
    ]);

    expect(r.efectividadGestion).toBe(0.75);
    // Mismo denominador que su hermana: su diferencia es exactamente el peso de los rechazos.
    expect(r.efectividad).toBe(0.6);
  });

  // Una devolución, una reprogramación o un incidente NO cuentan como gestión cumplida: la
  // orden se quedó sin resolver o volvió.
  it("solo los rechazos se suman: los otros desenlaces no", () => {
    const r = calcularEfectividad([
      { status: "entregada", conteo: 1 },
      { status: "devuelta", conteo: 1 },
      { status: "reprogramada", conteo: 1 },
      { status: "incidente", conteo: 1 },
    ]);

    expect(r.efectividadGestion).toBe(0.25);
  });

  // ⚠ «EN PROCESO» SE DEFINE POR NEGACIÓN —todo lo que no es uno de los cinco desenlaces— y no
  // con una lista propia de estados en curso. Con una lista, un estado nuevo del catálogo
  // desaparecería de este KPI en silencio mientras el anillo sí lo contaría en «Otros».
  it("un estado del catálogo que nadie previó cuenta como en proceso", () => {
    const r = calcularEfectividad([
      { status: "entregada", conteo: 5 },
      { status: "estado_inventado_manana", conteo: 5 },
    ]);

    expect(r.enProceso).toBe(5);
  });

  // Los cinco desenlaces YA no están en proceso, aunque no sean «entregada».
  it("los desenlaces que no son entrega no cuentan como en proceso", () => {
    const r = calcularEfectividad([
      { status: "devuelta", conteo: 1 },
      { status: "rechazada", conteo: 1 },
      { status: "reprogramada", conteo: 1 },
      { status: "incidente", conteo: 1 },
    ]);

    expect(r.enProceso).toBe(0);
    expect(r.efectividad).toBe(0);
  });

  // `null` y no `0`: sin órdenes no hay efectividad que medir, y un «0 %» afirmaría que se
  // falló cada entrega. «No hubo» y «salió mal» son dos hechos distintos.
  it("sin universo, la efectividad no es cero: es que no la hay", () => {
    expect(calcularEfectividad([])).toMatchObject({
      total: 0,
      efectividad: null,
      efectividadGestion: null,
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Las tarjetas                                                                */
/* -------------------------------------------------------------------------- */

describe("Las tarjetas de efectividad", () => {
  it("pintan el porcentaje y las dos cifras", async () => {
    consultarMock.mockResolvedValue({
      status: "ok",
      datos: datos([
        { status: "entregada", conteo: 60 },
        { status: "devuelta", conteo: 20 },
        { status: "en_reparto", conteo: 20 },
      ]),
    });
    renderKpis();

    // DOS tarjetas dicen «60 %»: sin rechazos, la efectividad de entrega y la de la gestión
    // coinciden. Por eso se busca en plural — `findByText` falla cuando hay más de una.
    expect((await screen.findAllByText(/60\s?%/)).length).toBe(2);
    // FICHA 360 — los dos rótulos de porcentaje llevan DENTRO su base. Se asertan enteros y no
    // por subcadena a propósito: `getByText("Efectividad de entrega")` con match exacto es lo
    // que puso este caso en rojo cuando la base entró, y así tenía que ser.
    expect(screen.getByText("Efectividad de entrega (100 órdenes)")).toBeInTheDocument();
    expect(
      screen.getByText("Efectividad de la gestión (entregadas y rechazadas de 100 órdenes)"),
    ).toBeInTheDocument();
    // Las dos tarjetas de CONTEO no llevan base: su cifra ya ES un conteo de órdenes, y un
    // «(100 órdenes)» junto a un «60» sería el denominador de nada.
    expect(screen.getByText("Entregadas")).toBeInTheDocument();
    expect(screen.getByText("En proceso")).toBeInTheDocument();
    // 60 entregadas y 20 en proceso, cada una en su tarjeta.
    expect(screen.getByText("60")).toBeInTheDocument();
    expect(screen.getByText("20")).toBeInTheDocument();
  });

  // ⚠ EL ENGANCHE CON EL DESGLOSE: la clave de SWR es la misma que la de la dona, así que las
  // dos piezas comparten UNA petición. Este caso lo fija sobre la llamada al borde.
  it("consulta el desglose por status una sola vez y sin filtro", async () => {
    consultarMock.mockResolvedValue({
      status: "ok",
      datos: datos([{ status: "entregada", conteo: 1 }]),
    });
    renderKpis();

    await screen.findAllByText(/100\s?%/);
    expect(consultarMock).toHaveBeenCalledTimes(1);
    expect(consultarMock.mock.calls[0]?.[0]).toEqual({});
  });

  it.each([
    ["forbidden", TEXTO_PROHIBIDO],
    ["unauthenticated", TEXTO_SESION_NO_VALIDA],
  ] as const)("%s se dice, no se pinta como cero", async (status, texto) => {
    consultarMock.mockResolvedValue({ status } as never);
    renderKpis();

    // Una tarjeta por KPI, las cuatro con su aviso: un permiso denegado pintado como «0 %»
    // afirmaría que no se entregó nada.
    expect((await screen.findAllByText(texto)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/0\s?%/)).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* FICHA 360 — la BASE de los dos porcentajes                                  */
/* -------------------------------------------------------------------------- */

/**
 * El caso REPORTADO por el humano el 2026-08-29 sobre `/analitica`, con sus cifras: los dos
 * porcentajes decían «29,5 %» y «38,7 %» y no decían de cuántas órdenes salían.
 *
 *   entregadas 259 / 877            = 29,5 %
 *   (259 + 80 rechazadas) / 877     = 38,7 %
 *
 * Se usan estas y no unas redondas a propósito: con 60/100 el porcentaje y su base se leen
 * igual lea la cifra que lea, y varios de los casos de abajo no distinguirían nada.
 */
const CASO_REPORTADO: ConteoDeStatus[] = [
  { status: "entregada", conteo: 259 },
  { status: "rechazada", conteo: 80 },
  { status: "devuelta", conteo: 138 },
  { status: "incidente", conteo: 20 },
  { status: "en_reparto", conteo: 380 },
];

/**
 * ⚠ EL SEPARADOR DE MILES DE `es-CR` ES UN ESPACIO DURO (U+00A0), no el espacio normal que se
 * escribe aquí. Los literales de abajo llevan espacio normal porque el normalizador por defecto
 * de `@testing-library` colapsa `\s+` —y U+00A0 entra en `\s`— antes de comparar. Escribir el
 * carácter duro en el fuente sería invisible y frágil; esto es deliberado, no un descuido.
 */
describe("La base de los porcentajes — de dónde sale", () => {
  // ⚠ ESTE ES EL CASO QUE DEFIENDE LA FICHA ENTERA. El DTO trae un `total` HECHO y en producción
  // vale lo mismo que la suma de los `conteo`, así que las dos fuentes son indistinguibles… hasta
  // que dejan de serlo. Si la base se leyera de `datos.total`, el rótulo diría «(999 órdenes)»
  // pegado a un 30 % que NO es 30/999 — el porcentaje y su base afirmando cosas distintas, que
  // es justo el problema que esta ficha viene a mitigar.
  it("la base sale de la misma cuenta que el porcentaje, no del `total` del DTO", async () => {
    consultarMock.mockResolvedValue({
      status: "ok",
      datos: datosConTotalDescuadrado(
        [
          { status: "entregada", conteo: 30 },
          { status: "en_reparto", conteo: 70 },
        ],
        999,
      ),
    });
    renderKpis();

    expect(await screen.findByText("Efectividad de entrega (100 órdenes)")).toBeInTheDocument();
    expect(
      screen.getByText("Efectividad de la gestión (entregadas y rechazadas de 100 órdenes)"),
    ).toBeInTheDocument();
    // 30/100. El `total` del DTO no aparece por ningún lado.
    expect(screen.getAllByText(/30\s?%/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/999/)).toBeNull();
  });

  it("los dos porcentajes dicen sobre cuántas órdenes se calculan", async () => {
    consultarMock.mockResolvedValue({ status: "ok", datos: datos(CASO_REPORTADO) });
    renderKpis();

    expect(await screen.findByText("Efectividad de entrega (877 órdenes)")).toBeInTheDocument();
    expect(screen.getByText(/29,5\s?%/)).toBeInTheDocument();
  });

  // ⚠ LA BASE SOLA CONVIERTE ESTA TARJETA EN UNA TRAMPA, y por eso su rótulo dice DOS cosas.
  // Con «38,7 %» y «(877 órdenes)» a la vista, multiplicar da 339; sin decir de qué son esos
  // 339, la lectura natural es «339 entregadas», que contradice el 259 de la tarjeta de al
  // lado. El numerador NO es el mismo que el de su vecina aunque el denominador sí lo sea.
  it("la de gestión nombra su numerador: comparte el denominador, no los sumandos", async () => {
    consultarMock.mockResolvedValue({ status: "ok", datos: datos(CASO_REPORTADO) });
    renderKpis();

    expect(
      await screen.findByText("Efectividad de la gestión (entregadas y rechazadas de 877 órdenes)"),
    ).toBeInTheDocument();
    expect(screen.getByText(/38,7\s?%/)).toBeInTheDocument();
    // Las dos bases son la MISMA cifra: si alguien le cambiara el denominador a una, su
    // diferencia dejaría de ser el peso de los rechazos y las dos tarjetas no se podrían
    // comparar — que es la razón de que compartan `total` en `efectividad.ts`.
    expect(screen.getAllByText(/\(.*877 órdenes\)/).length).toBe(2);
    // Y el numerador es comprobable de un vistazo contra la tarjeta de al lado: 29,5 % de 877.
    expect(screen.getByText("259")).toBeInTheDocument();
  });

  // La misma fila escribe «1 000» en la tarjeta «Entregadas» (pasa por `formatearValor`), así
  // que la base no puede escribir «1234». Es lo que garantiza el módulo compartido.
  it("la base lleva el separador de miles del locale, igual que las cifras de la fila", async () => {
    consultarMock.mockResolvedValue({
      status: "ok",
      datos: datos([
        { status: "entregada", conteo: 1000 },
        { status: "en_reparto", conteo: 234 },
      ]),
    });
    renderKpis();

    expect(await screen.findByText("Efectividad de entrega (1 234 órdenes)")).toBeInTheDocument();
    expect(screen.getByText("1 000")).toBeInTheDocument();
  });

  // Se lee entero como una frase, y «1 órdenes» delata que nadie la leyó.
  it("concuerda en singular con una sola orden", async () => {
    consultarMock.mockResolvedValue({
      status: "ok",
      datos: datos([{ status: "entregada", conteo: 1 }]),
    });
    renderKpis();

    expect(await screen.findByText("Efectividad de entrega (1 orden)")).toBeInTheDocument();
    expect(
      screen.getByText("Efectividad de la gestión (entregadas y rechazadas de 1 orden)"),
    ).toBeInTheDocument();
  });
});

/**
 * LOS DOS ESTADOS FRÁGILES, que son los que `CicloVidaKpi` ya cuidaba y de los que sale la
 * regla: una base es un HECHO MEDIDO, y sólo se escribe cuando se ha medido.
 */
describe("La base de los porcentajes — cuándo NO se escribe", () => {
  it("con la consulta EN VUELO no escribe ninguna base", () => {
    // Nunca resuelve: la tarjeta se queda en su estado de carga.
    consultarMock.mockReturnValue(new Promise<never>(() => {}));
    renderKpis();

    // Los rótulos están, a secas. Un «(0 órdenes)» aquí sería una afirmación de negocio que
    // nadie ha hecho: el dato todavía no ha llegado.
    expect(screen.getAllByText("Efectividad de entrega").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Efectividad de la gestión").length).toBeGreaterThan(0);
    expect(screen.queryByText(/Efectividad de entrega \(/)).toBeNull();
    expect(screen.queryByText(/Efectividad de la gestión \(/)).toBeNull();
  });

  it.each([
    ["forbidden" as const, TEXTO_PROHIBIDO],
    ["unauthenticated" as const, TEXTO_SESION_NO_VALIDA],
  ])("con «%s» no escribe ninguna base", async (status, texto) => {
    consultarMock.mockResolvedValue({ status } as never);
    renderKpis();

    await screen.findAllByText(texto);
    // Degradar un problema de permisos a «(0 órdenes)» convierte «no puedes verlo» en «no entró
    // ninguna orden», que es una afirmación de negocio que nadie hizo.
    expect(screen.queryByText(/Efectividad de entrega \(/)).toBeNull();
    expect(screen.queryByText(/Efectividad de la gestión \(/)).toBeNull();
  });

  it("un fallo de red tampoco deja una base falsa", async () => {
    consultarMock.mockRejectedValue(new Error("se cayó"));
    renderKpis();

    await screen.findAllByRole("alert");
    expect(screen.queryByText(/Efectividad de entrega \(/)).toBeNull();
    expect(screen.queryByText(/Efectividad de la gestión \(/)).toBeNull();
  });

  // ⚠ CON CERO SÍ SE ESCRIBE, y no es una excepción caprichosa: es lo que EXPLICA el guion que
  // aparece en la cifra. «(0 órdenes)» dice «no entró ninguna»; sin la base, el guion se lee
  // como «no se pudo medir», que es otra cosa.
  it("con cero órdenes SÍ escribe la base: es lo que explica el guion", async () => {
    consultarMock.mockResolvedValue({ status: "ok", datos: datos([]) });
    renderKpis();

    expect(await screen.findByText("Efectividad de entrega (0 órdenes)")).toBeInTheDocument();
    expect(
      screen.getByText("Efectividad de la gestión (entregadas y rechazadas de 0 órdenes)"),
    ).toBeInTheDocument();
    // La CIFRA sigue siendo un guion: un «0 %» afirmaría que se falló cada entrega.
    expect(screen.queryByText(/0\s?%/)).toBeNull();
  });
});
