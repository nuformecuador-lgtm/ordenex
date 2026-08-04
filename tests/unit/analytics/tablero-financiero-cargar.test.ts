import { describe, it, expect, vi, beforeEach } from "vitest";

import * as cargador from "@/app/(app)/analitica/_components/financiero/cargar";
import { FILTRO_FINANCIERO_POR_DEFECTO } from "@/app/(app)/analitica/_components/financiero/rango";
import {
  IDS_FINANCIERAS_SERVIDAS,
  type RespuestaFinanciera,
  type ResultadoFinanciero,
} from "@/lib/types/analitica-financiera";
import { importeConNeto } from "@/tests/fixtures/importe-analitico";

// Feature 132 (T3.1) — el cargador del tablero financiero.
//
// Lo que se verifica aqui es lo que ninguna pantalla puede comprobar por si sola:
// que se piden LAS DIEZ metricas del contrato (ni una escrita a mano), que se
// piden A LA VEZ, que el fallo de una no arrastra a las otras nueve y que ninguna
// respuesta que NO trajo dato acaba pintandose como un cero.
//
// Eran OCHO hasta la feature 173 ⟨P4⟩ (`progress/decision_F2_173.md`), que anadio
// `dinero_en_caja` y `ganancia_ordenex` a `IDS_FINANCIERAS_SERVIDAS`. Los enteros
// de este archivo se actualizaron a mano DESPUES de medirlos: siguen siendo anclas
// escritas, no conteos derivados de la constante — un conteo derivado pasaria en
// verde el dia que alguien anada una metrica sin querer.
//
// El Server Action se mockea entero: importarlo de verdad arrastraria Prisma y la
// sesion, que no son el sujeto de esta prueba.

const consultar = vi.hoisted(() =>
  vi.fn<(metricaId: string, filtroRaw: unknown, deps?: unknown) => Promise<RespuestaFinanciera>>(),
);

vi.mock("@/lib/actions/analitica-financiera", () => ({
  consultarMetricaFinanciera: consultar,
}));

// `vi.mock` se iza por encima de este import, asi que `cargar.ts` recibe el doble
// y no el Server Action real.
const { cargarTableroFinanciero } = cargador;

/** Un DTO minimo pero REAL: sin `as unknown as`, para que el tipo siga vigilando. */
function dtoDe(metricaId: string): ResultadoFinanciero {
  return {
    tipo: "vistas",
    metricaId,
    etiqueta: `Etiqueta de ${metricaId}`,
    unidad: "moneda",
    rango: { desdeFecha: "2026-07-05", hastaFecha: "2026-08-03" },
    esAcumulado: false,
    vistas: [
      {
        id: `${metricaId}__vista`,
        grano: "fecha",
        fuente: "wallet_tienda_movimiento",
        sumableCon: [],
        filas: [],
        // Feature 183 ⟨D12⟩: el importe lleva el discriminante `forma`, y lo pone el
        // helper compartido de `tests/fixtures/importe-analitico.ts` para que el DTO
        // siga siendo REAL (sin `as unknown as`) y el tipo siga vigilando este archivo.
        total: importeConNeto("100.00", "90.00"),
      },
    ],
  };
}

function respuestaOk(metricaId: string): RespuestaFinanciera {
  return { status: "ok", datos: dtoDe(metricaId) };
}

beforeEach(() => {
  consultar.mockReset();
});

describe("R13, R27 · se piden EXACTAMENTE las diez metricas del contrato", () => {
  it("invoca el borde una vez por metrica servida y ninguna vez de mas", async () => {
    consultar.mockImplementation((metricaId) => Promise.resolve(respuestaOk(metricaId)));

    const paneles = await cargarTableroFinanciero();

    expect(consultar).toHaveBeenCalledTimes(IDS_FINANCIERAS_SERVIDAS.length);
    expect(consultar).toHaveBeenCalledTimes(10);
    expect(paneles).toHaveLength(10);
  });

  it("los ids invocados son los de IDS_FINANCIERAS_SERVIDAS, comparados contra la constante", async () => {
    // Se compara contra la CONSTANTE IMPORTADA y no contra una lista escrita
    // aqui: una lista repetida en el test convertiria este archivo en la segunda
    // fuente de verdad que R27 prohibe, y el dia que se sirva una metrica mas esta
    // prueba seguiria pasando en verde sin cubrirla. Ya paso: la 173 sirvio la
    // novena y la decima y este caso las cubrio SOLO, sin tocar una linea.
    consultar.mockImplementation((metricaId) => Promise.resolve(respuestaOk(metricaId)));

    await cargarTableroFinanciero();

    const invocados = consultar.mock.calls.map(([metricaId]) => metricaId);
    expect(new Set(invocados)).toEqual(new Set(IDS_FINANCIERAS_SERVIDAS));
    expect(invocados).toHaveLength(new Set(invocados).size);
  });
});

describe("R9 · el filtro por defecto viaja tal cual y `deps` NO se pasa", () => {
  it("cada llamada recibe dos argumentos: el id y el filtro por defecto", async () => {
    consultar.mockImplementation((metricaId) => Promise.resolve(respuestaOk(metricaId)));

    await cargarTableroFinanciero();

    for (const llamada of consultar.mock.calls) {
      // El tercer argumento (`deps`) es el punto de inyeccion PARA TESTS y
      // contiene funciones: pasarlo desde produccion convertiria al tablero en
      // una segunda autoridad sobre quien es el actor, y ademas una funcion no
      // cruza la frontera RSC.
      expect(llamada).toHaveLength(2);
      expect(llamada[1]).toBe(FILTRO_FINANCIERO_POR_DEFECTO);
    }
  });
});

describe("R12 · las diez consultas se emiten a la vez, no en fila", () => {
  it("las diez llamadas ya se emitieron antes de que se resuelva la primera", async () => {
    const resolutores: Array<(respuesta: RespuestaFinanciera) => void> = [];
    const idsPedidos: string[] = [];
    consultar.mockImplementation((metricaId) => {
      idsPedidos.push(metricaId);
      return new Promise<RespuestaFinanciera>((resolve) => {
        resolutores.push(resolve);
      });
    });

    const pendiente = cargarTableroFinanciero();

    // Ni una sola respuesta ha llegado todavia y, aun asi, las diez consultas ya
    // estan emitidas. Con un `for … await` aqui habria UNA.
    expect(resolutores).toHaveLength(10);
    expect(idsPedidos).toHaveLength(10);

    resolutores.forEach((resolver, indice) => resolver(respuestaOk(idsPedidos[indice] ?? "")));
    await expect(pendiente).resolves.toHaveLength(10);
  });
});

describe("R12, R4, R23 · una respuesta que falla no arrastra a las demas", () => {
  it("con un error y un denegado, las otras ocho llegan ok y cada fallo queda en SU panel", async () => {
    const idError = IDS_FINANCIERAS_SERVIDAS[0];
    const idDenegado = IDS_FINANCIERAS_SERVIDAS[1];

    consultar.mockImplementation((metricaId) => {
      if (metricaId === idError) {
        return Promise.resolve({ status: "error", mensaje: "No se pudo consultar la métrica." });
      }
      if (metricaId === idDenegado) {
        return Promise.resolve({ status: "forbidden", code: "FORBIDDEN" });
      }
      return Promise.resolve(respuestaOk(metricaId));
    });

    const paneles = await cargarTableroFinanciero();

    // 10 servidas − 1 error − 1 denegado.
    expect(paneles.filter((panel) => panel.estado === "ok")).toHaveLength(8);

    const fallido = paneles.find((panel) => panel.id === idError);
    expect(fallido).toEqual({
      estado: "error",
      id: idError,
      mensaje: "No se pudo consultar la métrica.",
    });

    const denegado = paneles.find((panel) => panel.id === idDenegado);
    expect(denegado).toEqual({ estado: "denegado", id: idDenegado });
    // El denegado NO lleva motivo: con un motivo se podrian enumerar los permisos
    // de cada rol preguntando.
    expect(Object.keys(denegado ?? {})).toEqual(["estado", "id"]);
  });
});

describe("R23 · un fallo de validacion es un error, nunca un panel vacio", () => {
  it("el validation_error produce estado error con un mensaje construido con las claves", async () => {
    const idInvalido = IDS_FINANCIERAS_SERVIDAS[2];
    consultar.mockImplementation((metricaId) => {
      if (metricaId === idInvalido) {
        return Promise.resolve({
          status: "validation_error",
          fieldErrors: { rango: ["obligatorio"], hasta: ["fuera de tope"] },
        });
      }
      return Promise.resolve(respuestaOk(metricaId));
    });

    const paneles = await cargarTableroFinanciero();
    const panel = paneles.find((item) => item.id === idInvalido);

    expect(panel?.estado).toBe("error");
    // Ni un panel `ok` con vistas vacias ni un cero: eso afirmaria que no hubo
    // movimiento, que es exactamente lo que no se sabe.
    expect(paneles.some((item) => item.id === idInvalido && item.estado === "ok")).toBe(false);
    const mensaje = panel?.estado === "error" ? panel.mensaje : "";
    expect(mensaje).toContain("hasta");
    expect(mensaje).toContain("rango");
    expect(mensaje.length).toBeGreaterThan(0);
  });
});
