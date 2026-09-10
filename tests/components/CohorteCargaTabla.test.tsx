// @vitest-environment jsdom
//
// FICHA 411 (B7/T7.3) — LA TABLA DE COHORTES, en pantalla.
//
// ⚠ QUE PERSIGUE ESTE ARCHIVO. El error de esta ficha no rompe nada visible: produce una cohorte
// con numeros PLAUSIBLES y equivocados. En la capa de datos eso ya lo cazaron los ocho archivos
// contra Postgres; aqui el riesgo equivalente es **presentar mal lo que llega bien**: rellenar un
// cubo ausente con algo que no sea 0, reordenar por cuenta propia, omitir la columna `Vivas` o
// escribir un promedio sin su `n`. Cada uno de esos produce una tabla creible y falsa, y ninguno
// rompe un tipo.
//
// Por eso TODOS los esperados de este archivo estan escritos A MANO —«40%», «2 días», «(4 órdenes
// cerradas)»— y no derivados de las funciones que los producen. Un esperado calculado con la
// misma funcion que se esta probando esta verde haga lo que haga.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import { useEffect } from "react";
import { SWRConfig } from "swr";

import { CohorteCargaTabla } from "@/app/(app)/analitica/_components/entregas/CohorteCargaTabla";
import { COHORTE_TEXTOS } from "@/app/(app)/analitica/_components/entregas/CohorteCargaTabla";
import {
  TEXTO_ERROR_PANEL,
  TEXTO_PROHIBIDO,
  TEXTO_SESION_NO_VALIDA,
  TITULO_FILTRO_INVALIDO,
} from "@/app/(app)/analitica/_components/operativo/textos";
import {
  FiltroEntregasProvider,
  useFiltroEntregas,
} from "@/app/(app)/_components/filtro-entregas";
import type { RawFiltroConteoEntregas } from "@/app/(app)/_components/entregas-filtro-analitica";
import { consultarCohorteCarga } from "@/lib/actions/cohorte-carga";
import type {
  CohorteCargaDTO,
  CohorteCubo,
  CohorteDeDia,
  CohorteDesenlace,
} from "@/lib/types/cohorte-carga";

vi.mock("@/lib/actions/cohorte-carga", () => ({
  consultarCohorteCarga: vi.fn(),
}));

const consultarMock = vi.mocked(consultarCohorteCarga);

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

const SELLO = "2026-09-10T18:30:00.000Z";

function cubo(
  desenlace: CohorteDesenlace,
  n: number,
  segundosAcum: number | null = null,
): CohorteCubo {
  return {
    desenlace,
    n,
    segundosAcum,
    promedioSegundos: segundosAcum === null ? null : segundosAcum / n,
  };
}

/**
 * Un DTO con los totales DERIVADOS de las filas, igual que hace el servicio: el componente no
 * los recalcula, los lee, y el fixture tiene que ser coherente para que la prueba mida lo que
 * dice medir.
 */
function dto(porDia: readonly CohorteDeDia[]): CohorteCargaDTO {
  const acumulado = new Map<CohorteDesenlace, number>();
  for (const dia of porDia) {
    for (const c of dia.cubos) {
      acumulado.set(c.desenlace, (acumulado.get(c.desenlace) ?? 0) + c.n);
    }
  }
  return {
    porDia,
    total: porDia.reduce((suma, dia) => suma + dia.cargadas, 0),
    totalPorDesenlace: [...acumulado.entries()].map(([desenlace, n]) => cubo(desenlace, n)),
    lastSync: SELLO,
  };
}

/** Pone el filtro del proveedor REAL: el componente lo lee de ahi y no de una prop. */
function PonerFiltro({ filtro }: { readonly filtro: RawFiltroConteoEntregas }) {
  const { setFiltro } = useFiltroEntregas();
  useEffect(() => {
    setFiltro(filtro);
  }, [setFiltro, filtro]);
  return null;
}

function renderTabla(filtro?: RawFiltroConteoEntregas) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <FiltroEntregasProvider>
        {filtro ? <PonerFiltro filtro={filtro} /> : null}
        <CohorteCargaTabla />
      </FiltroEntregasProvider>
    </SWRConfig>,
  );
}

/** Las filas de DATOS: la primera `<tr>` es la de cabeceras. */
async function filasDeDatos(): Promise<HTMLElement[]> {
  const tabla = await screen.findByRole("table");
  const filas = within(tabla).getAllByRole("row");
  return filas.slice(1);
}

async function cabeceras(): Promise<string[]> {
  const tabla = await screen.findByRole("table");
  const cabecera = within(tabla).getAllByRole("row")[0];
  return within(cabecera!)
    .getAllByRole("columnheader")
    .map((th) => th.textContent ?? "");
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

/* ========================================================================== */
/* R35 — la unica puerta                                                       */
/* ========================================================================== */

describe("Cohorte de carga — de donde salen los datos", () => {
  it("consulta `consultarCohorteCarga` y por ninguna otra puerta", async () => {
    consultarMock.mockResolvedValue({ status: "ok", datos: dto([]) });
    renderTabla();

    await waitFor(() => expect(consultarMock).toHaveBeenCalledTimes(1));
  });

  // ⚠ EL CASO QUE IMPIDE UNA SONDA DE PERMISOS. Con el filtro vacio la pantalla NO decide sola
  // que «falta el rango»: pregunta igual. Cortocircuitar aqui le ensenaria la invitacion a un
  // `mensajero` —que no puede leer esta seccion— y le diria, por el texto, que existe y que solo
  // le falta un filtro. La denegacion PRECEDE a la invitacion, y eso se decide en el borde.
  it("con el filtro vacio TAMBIEN pregunta a la Server Action", async () => {
    consultarMock.mockResolvedValue({ status: "sin_rango" });
    renderTabla();

    await waitFor(() => expect(consultarMock).toHaveBeenCalled());
    expect(consultarMock.mock.calls[0]?.[0]).toEqual({});
  });

  it("el filtro de la barra viaja tal cual a la accion", async () => {
    consultarMock.mockResolvedValue({ status: "ok", datos: dto([]) });
    renderTabla({ rango: "personalizado", desde: "2026-09-01", hasta: "2026-09-08" });

    await waitFor(() =>
      expect(consultarMock).toHaveBeenCalledWith({
        rango: "personalizado",
        desde: "2026-09-01",
        hasta: "2026-09-08",
      }),
    );
  });
});

/* ========================================================================== */
/* R39 — sin rango se INVITA, no se pinta una tabla vacia ni un cero            */
/* ========================================================================== */

describe("Cohorte de carga (R39) — sin rango es una invitacion, no un error ni un vacio", () => {
  beforeEach(() => {
    consultarMock.mockResolvedValue({ status: "sin_rango" });
  });

  it("invita a elegir un periodo", async () => {
    renderTabla();

    expect(await screen.findByText(COHORTE_TEXTOS.invitacionTitulo)).toBeInTheDocument();
    expect(screen.getByText(COHORTE_TEXTOS.invitacionDescripcion)).toBeInTheDocument();
  });

  it("NO pinta la tabla", async () => {
    renderTabla();

    await screen.findByText(COHORTE_TEXTOS.invitacionTitulo);
    // Ni con filas ni con cabeceras: una tabla con sus columnas dibujadas y sin filas YA es una
    // respuesta, y aqui no hay ninguna que dar.
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("NO pinta ningun cero, ni un universo, ni un sello", async () => {
    renderTabla();

    await screen.findByText(COHORTE_TEXTOS.invitacionTitulo);
    const cuerpo = document.body.textContent ?? "";
    // Ni una cifra en toda la seccion: sin rango no hay nada medido, y un «0 órdenes» seria una
    // afirmacion de negocio que nadie ha hecho.
    expect(cuerpo).not.toMatch(/\d/);
    // Y ninguna de las tres lineas de resumen, que solo tienen sentido con datos detras.
    expect(screen.queryByText(/Cargadas en el periodo/)).toBeNull();
    expect(screen.queryByText(/Entregadas/)).toBeNull();
    expect(screen.queryByText(/Actualizado/)).toBeNull();
  });

  it("NO se presenta como un error", async () => {
    renderTabla();

    await screen.findByText(COHORTE_TEXTOS.invitacionTitulo);
    expect(screen.queryByRole("alert")).toBeNull();
    const cuerpo = document.body.textContent ?? "";
    expect(cuerpo).not.toContain(TITULO_FILTRO_INVALIDO);
    expect(cuerpo).not.toContain(TEXTO_PROHIBIDO);
  });
});

/* ========================================================================== */
/* R32 — las columnas, y la que no puede faltar                                */
/* ========================================================================== */

describe("Cohorte de carga (R32) — las siete columnas, con `Vivas` entre ellas", () => {
  const UN_DIA = dto([
    {
      fecha: "2026-09-08",
      cargadas: 10,
      cubos: [
        cubo("entregada", 4, 691_200),
        cubo("devuelta_a_tienda", 2, 259_200),
        cubo("incidente", 1, 86_400),
        cubo("viva", 3),
      ],
    },
  ]);

  it("las cabeceras son estas siete y en este orden", async () => {
    consultarMock.mockResolvedValue({ status: "ok", datos: UN_DIA });
    renderTabla();

    // LITERAL escrito a mano: es el contrato de la pantalla. Derivarlo de `COHORTE_TEXTOS` o de
    // `ESTADOS_TERMINALES` dejaria el caso verde aunque alguien quitara una columna entera.
    expect(await cabeceras()).toEqual([
      "Fecha de carga",
      "Cargadas",
      "Entregadas",
      "Devueltas",
      "Incidentes",
      "Vivas",
      "Días hasta entregar",
    ]);
  });

  it("cada cubo cae en SU columna", async () => {
    consultarMock.mockResolvedValue({ status: "ok", datos: UN_DIA });
    renderTabla();

    const celdas = within((await filasDeDatos())[0]!)
      .getAllByRole("cell")
      .map((td) => td.textContent ?? "");
    expect(celdas[0]).toBe("2026-09-08");
    expect(celdas[1]).toBe("10");
    expect(celdas[2]).toBe("4");
    expect(celdas[3]).toBe("2");
    expect(celdas[4]).toBe("1");
    expect(celdas[5]).toBe("3");
  });

  // ⚠ EL CASO QUE IMPIDE QUE LA TABLA MIENTA POR OMISION. Sin la columna `Vivas`, una cohorte
  // diria «4 entregadas de 10» y callaria que 3 siguen en la calle. Y el cubo con `n = 0` NO
  // VIAJA en el DTO —un hueco significa cero—, asi que si la pantalla no lo rellena la columna
  // sale en blanco, que se lee como «no se sabe».
  it("la columna `Vivas` se pinta tambien cuando vale 0", async () => {
    consultarMock.mockResolvedValue({
      status: "ok",
      datos: dto([
        {
          fecha: "2026-09-08",
          cargadas: 4,
          // `viva` NO viene: todas cerraron. La columna tiene que decir 0, no quedarse vacia.
          cubos: [cubo("entregada", 4, 345_600)],
        },
      ]),
    });
    renderTabla();

    const columnas = await cabeceras();
    const iVivas = columnas.indexOf("Vivas");
    expect(iVivas, "la columna `Vivas` no está en la tabla").toBeGreaterThan(-1);

    const celdas = within((await filasDeDatos())[0]!).getAllByRole("cell");
    expect(celdas[iVivas]?.textContent).toBe("0");
  });

  it("los cubos que no vienen valen CERO, no la cifra de al lado", async () => {
    consultarMock.mockResolvedValue({
      status: "ok",
      datos: dto([
        { fecha: "2026-09-08", cargadas: 7, cubos: [cubo("viva", 7)] },
      ]),
    });
    renderTabla();

    const celdas = within((await filasDeDatos())[0]!)
      .getAllByRole("cell")
      .map((td) => td.textContent ?? "");
    // Cargadas 7, y los tres terminales a 0: rellenar un cubo ausente con las cargadas —o con
    // cualquier otra cosa— produce una cohorte plausible y falsa.
    expect(celdas[1]).toBe("7");
    expect(celdas[2]).toBe("0");
    expect(celdas[3]).toBe("0");
    expect(celdas[4]).toBe("0");
    expect(celdas[5]).toBe("7");
  });
});

/* ========================================================================== */
/* R6 en pantalla — el orden llega decidido y NO se toca                       */
/* ========================================================================== */

describe("Cohorte de carga — el orden lo decide el repositorio, no la pantalla", () => {
  it("la primera fila es la cohorte mas reciente", async () => {
    consultarMock.mockResolvedValue({
      status: "ok",
      datos: dto([
        { fecha: "2026-09-08", cargadas: 3, cubos: [cubo("viva", 3)] },
        { fecha: "2026-09-07", cargadas: 2, cubos: [cubo("viva", 2)] },
        { fecha: "2026-09-05", cargadas: 1, cubos: [cubo("viva", 1)] },
      ]),
    });
    renderTabla();

    const fechas = (await filasDeDatos()).map(
      (fila) => within(fila).getAllByRole("cell")[0]?.textContent,
    );
    expect(fechas).toEqual(["2026-09-08", "2026-09-07", "2026-09-05"]);
  });

  // EL CASO QUE MATA EL `.sort()`. Si la pantalla reordenara, este desorden deliberado saldria
  // ordenado y el caso caeria. Con el de arriba solo no se distingue «no reordena» de «reordena
  // igual que ya venia».
  it("no reordena: un orden distinto al cronologico sale TAL CUAL llego", async () => {
    consultarMock.mockResolvedValue({
      status: "ok",
      datos: dto([
        { fecha: "2026-09-03", cargadas: 3, cubos: [cubo("viva", 3)] },
        { fecha: "2026-09-08", cargadas: 2, cubos: [cubo("viva", 2)] },
        { fecha: "2026-09-01", cargadas: 1, cubos: [cubo("viva", 1)] },
      ]),
    });
    renderTabla();

    const fechas = (await filasDeDatos()).map(
      (fila) => within(fila).getAllByRole("cell")[0]?.textContent,
    );
    expect(fechas).toEqual(["2026-09-03", "2026-09-08", "2026-09-01"]);
  });

  it("los dias sin ordenes no viajan y la pantalla no se los inventa", async () => {
    consultarMock.mockResolvedValue({
      status: "ok",
      datos: dto([
        { fecha: "2026-09-08", cargadas: 3, cubos: [cubo("viva", 3)] },
        { fecha: "2026-09-05", cargadas: 1, cubos: [cubo("viva", 1)] },
      ]),
    });
    renderTabla();

    expect(await screen.findByText("2026-09-08")).toBeInTheDocument();
    expect(screen.queryByText("2026-09-06")).toBeNull();
    expect(screen.queryByText("2026-09-07")).toBeNull();
  });
});

/* ========================================================================== */
/* R33 — ningun promedio ni porcentaje sin su base                             */
/* ========================================================================== */

describe("Cohorte de carga (R33) — la cifra va con su denominador", () => {
  it("los dias hasta entregar llevan su `n` al lado", async () => {
    consultarMock.mockResolvedValue({
      status: "ok",
      datos: dto([
        {
          fecha: "2026-09-08",
          cargadas: 10,
          // 4 entregadas que acumulan 8 dias: dos dias de media.
          cubos: [cubo("entregada", 4, 691_200), cubo("viva", 6)],
        },
      ]),
    });
    renderTabla();

    const columnas = await cabeceras();
    const iDias = columnas.indexOf("Días hasta entregar");
    const celdas = within((await filasDeDatos())[0]!).getAllByRole("cell");
    // Literales a mano: 691.200 s / 4 = 172.800 s = 2 días exactos, sobre 4 órdenes cerradas.
    expect(celdas[iDias]?.textContent).toBe("2 días (4 órdenes cerradas)");
  });

  it("el sustantivo concuerda con su cifra", async () => {
    consultarMock.mockResolvedValue({
      status: "ok",
      datos: dto([
        {
          fecha: "2026-09-08",
          cargadas: 2,
          cubos: [cubo("entregada", 1, 86_400), cubo("viva", 1)],
        },
      ]),
    });
    renderTabla();

    const columnas = await cabeceras();
    const iDias = columnas.indexOf("Días hasta entregar");
    const celdas = within((await filasDeDatos())[0]!).getAllByRole("cell");
    // «1 día» y «1 orden cerrada»: un rotulo se lee entero como una frase, y «1 órdenes» delata
    // que nadie la leyo.
    expect(celdas[iDias]?.textContent).toBe("1 día (1 orden cerrada)");
  });

  // R17 en pantalla: sin cerradas el promedio es AUSENTE y no cero. Cero dias afirmaria que se
  // cerraron al instante; lo que pasa es que no hubo ninguna que cerrar. Y la base SI se escribe,
  // porque es justo lo que explica el guion de al lado.
  it("sin ninguna entregada el promedio es un guion, no un cero, y conserva su base", async () => {
    consultarMock.mockResolvedValue({
      status: "ok",
      datos: dto([
        { fecha: "2026-09-10", cargadas: 5, cubos: [cubo("viva", 5)] },
      ]),
    });
    renderTabla();

    const columnas = await cabeceras();
    const iDias = columnas.indexOf("Días hasta entregar");
    const celdas = within((await filasDeDatos())[0]!).getAllByRole("cell");
    expect(celdas[iDias]?.textContent).toBe("- (0 órdenes cerradas)");
  });

  // ⚠ EL DENOMINADOR SON LAS CARGADAS, NO LAS CERRADAS. Sobre cerradas, una cohorte de hoy con
  // una sola entrega y nueve en la calle saldria al 100 %.
  it("el porcentaje se escribe sobre la cohorte ENTERA y con su base", async () => {
    consultarMock.mockResolvedValue({
      status: "ok",
      datos: dto([
        {
          fecha: "2026-09-08",
          cargadas: 10,
          cubos: [
            cubo("entregada", 4, 691_200),
            cubo("devuelta_a_tienda", 2, 259_200),
            cubo("viva", 4),
          ],
        },
      ]),
    });
    renderTabla();

    // 4 de 10 cargadas = 40%. Sobre las 6 CERRADAS saldria 66,7%, que es la cifra que este caso
    // impide. Los dos literales van escritos a mano.
    const resumen = await screen.findByText(/Entregadas 40%/);
    expect(resumen.textContent).toContain("(10 órdenes)");
    expect(document.body.textContent ?? "").not.toContain("66,7%");
  });

  it("el universo del periodo se escribe con el modulo unico de base", async () => {
    consultarMock.mockResolvedValue({
      status: "ok",
      datos: dto([
        { fecha: "2026-09-08", cargadas: 1234, cubos: [cubo("viva", 1234)] },
      ]),
    });
    renderTabla();

    // Pasa por el formateador de la analitica, que separa los miles: «1 234 órdenes» y no
    // «1234 órdenes». El separador de `Intl` en este locale es un espacio no separable, asi que
    // se normalizan los espacios ANTES de comparar; los digitos van escritos a mano.
    const linea = await screen.findByText(/Cargadas en el periodo/);
    const texto = (linea.textContent ?? "").replace(/\s/g, " ");
    expect(texto).toContain("1 234 órdenes");
    expect(texto).not.toContain("1234");
  });
});

/* ========================================================================== */
/* R24 — la faceta que esta seccion NO aplica                                  */
/* ========================================================================== */

describe("Cohorte de carga (R24) — la advertencia del filtro de mensajero", () => {
  const DATOS = dto([{ fecha: "2026-09-08", cargadas: 3, cubos: [cubo("viva", 3)] }]);

  it("con un mensajero seleccionado, la pantalla avisa de que no recorta", async () => {
    consultarMock.mockResolvedValue({ status: "ok", datos: DATOS });
    renderTabla({ mensajero_id: ["m-1"] });

    expect(await screen.findByText(COHORTE_TEXTOS.avisoMensajero)).toBeInTheDocument();
  });

  it("sin mensajero no hay advertencia que dar", async () => {
    consultarMock.mockResolvedValue({ status: "ok", datos: DATOS });
    renderTabla();

    await screen.findByRole("table");
    expect(screen.queryByText(COHORTE_TEXTOS.avisoMensajero)).toBeNull();
  });
});

/* ========================================================================== */
/* R34 — los cuatro estados que NO son «sin datos»                             */
/* ========================================================================== */

describe("Cohorte de carga (R34) — permisos y fallos no se degradan al vacio", () => {
  it.each([
    ["forbidden" as const, TEXTO_PROHIBIDO],
    ["unauthenticated" as const, TEXTO_SESION_NO_VALIDA],
  ])("«%s» se presenta como aviso, sin filas y sin estado vacio", async (status, texto) => {
    consultarMock.mockResolvedValue({ status });
    renderTabla();

    const aviso = await screen.findByRole("alert");
    expect(aviso.textContent ?? "").toContain(texto);
    // El cuerpo de la tabla es EL AVISO y nada mas: ni una fila de datos debajo. (La tabla
    // conserva sus cabeceras; lo que no puede haber es una cifra.)
    const filas = await filasDeDatos();
    expect(filas).toHaveLength(1);
    expect(within(filas[0]!).getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText(COHORTE_TEXTOS.vacioTitulo)).toBeNull();
    // Y tampoco se cuela por la puerta de al lado: un problema de permisos NO es una invitacion.
    expect(screen.queryByText(COHORTE_TEXTOS.invitacionTitulo)).toBeNull();
  });

  it("«validation_error» se presenta como aviso, no como vacio", async () => {
    consultarMock.mockResolvedValue({
      status: "validation_error",
      fieldErrors: { desde: ["Formato invalido"] },
    });
    renderTabla();

    const aviso = await screen.findByRole("alert");
    expect(aviso.textContent ?? "").toContain(TITULO_FILTRO_INVALIDO);
    expect(screen.queryByText(COHORTE_TEXTOS.vacioTitulo)).toBeNull();
    expect(screen.queryByText(COHORTE_TEXTOS.invitacionTitulo)).toBeNull();
  });

  it("un fallo de red se presenta como aviso, no como vacio", async () => {
    consultarMock.mockRejectedValue(new Error("se cayó"));
    renderTabla();

    const aviso = await screen.findByRole("alert");
    expect(aviso.textContent ?? "").toContain(TEXTO_ERROR_PANEL);
    expect(screen.queryByText(COHORTE_TEXTOS.vacioTitulo)).toBeNull();
  });

  // Con un error NO se escribe ningun universo: un «0 órdenes» ahi es una afirmacion de negocio
  // que nadie ha hecho.
  it("con error no se escribe el universo ni el sello", async () => {
    consultarMock.mockResolvedValue({ status: "forbidden" });
    renderTabla();

    await screen.findByRole("alert");
    expect(screen.queryByText(/Cargadas en el periodo/)).toBeNull();
    expect(screen.queryByText(/Entregadas \d/)).toBeNull();
  });

  // El vacio SIGUE existiendo y habla de LO QUE NO PASO en el rango, que es otra cosa que un
  // permiso denegado. Sin este caso, «no cae al vacio» estaria verde con un componente que no
  // supiera pintar el vacio en absoluto.
  it("un periodo elegido y sin ninguna carga SI cae al estado vacio", async () => {
    consultarMock.mockResolvedValue({ status: "ok", datos: dto([]) });
    renderTabla();

    expect(await screen.findByText(COHORTE_TEXTOS.vacioTitulo)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(COHORTE_TEXTOS.invitacionTitulo)).toBeNull();
  });
});
