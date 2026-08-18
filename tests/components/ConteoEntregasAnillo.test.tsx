// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";

import { ConteoEntregasAnillo } from "@/app/(app)/analitica/_components/entregas/ConteoEntregasAnillo";
import {
  TEXTO_PROHIBIDO,
  TEXTO_SESION_NO_VALIDA,
} from "@/app/(app)/analitica/_components/operativo/textos";
import { consultarConteoEntregas } from "@/lib/actions/conteo-entregas";
import type { ConteoEntregasDTO } from "@/lib/types/conteo-entregas";

vi.mock("@/lib/actions/conteo-entregas", () => ({
  consultarConteoEntregas: vi.fn(),
}));

const consultarMock = vi.mocked(consultarConteoEntregas);

/** Los seis buckets, con los que no se nombren en cero. */
function datos(parcial: Record<string, number>): ConteoEntregasDTO {
  const porDesenlace = {
    entregada: 0,
    devuelta: 0,
    rechazada: 0,
    reprogramada: 0,
    incidente: 0,
    otros: 0,
    ...parcial,
  };
  return {
    porDesenlace,
    total: Object.values(porDesenlace).reduce((s, n) => s + n, 0),
    lastSync: "2026-08-17T18:30:00.000Z",
  };
}

function renderAnillo() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ConteoEntregasAnillo />
    </SWRConfig>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

describe("Anillo de entregas — de dónde sale la cifra", () => {
  // UNA consulta, no dos. Y por la Server Action del conteo, no por la de la analítica del
  // rollup: son dos fuentes distintas y mezclarlas daría un total que no cuadra consigo mismo.
  it("consulta `consultarConteoEntregas` una sola vez y por ninguna otra puerta", async () => {
    consultarMock.mockResolvedValue({ status: "ok", datos: datos({ entregada: 20, otros: 80 }) });
    renderAnillo();

    await waitFor(() => expect(consultarMock).toHaveBeenCalledTimes(1));
  });

  // ⚠ ESTE CASO SE DIO LA VUELTA EL 2026-08-18. Antes exigía el preset inicial
  // (`{ rango: "semana" }`) porque el borde reclamaba `rango`. Ahora `rango` es opcional y la
  // pantalla NO arranca con ninguna ventana puesta: los filtros los manda la barra. La
  // mutación que mata es volver a un preset por defecto — la primera cifra de cada visita
  // saldría recortada a siete días mientras la barra dice «sin filtrar».
  it("la primera consulta va SIN filtro: nada preestablecido", async () => {
    consultarMock.mockResolvedValue({ status: "ok", datos: datos({ entregada: 20, otros: 80 }) });
    renderAnillo();

    await waitFor(() => expect(consultarMock).toHaveBeenCalled());
    expect(consultarMock.mock.calls[0]?.[0]).toEqual({});
  });
});

describe("Anillo de entregas — las dos cifras y su suma", () => {
  // Se afirma sobre la ALTERNATIVA TEXTUAL de la gráfica y no sobre el `<text>` del SVG:
  // recharts mide su contenedor y en jsdom mide 0×0, así que no dibuja nada.
  //
  // ⚠ ESTE CASO CRECIÓ EL 2026-08-18. Antes eran DOS segmentos (entregadas / no entregadas) y
  // ahora son SEIS: los cinco desenlaces del catálogo más «otros». El lado que se abrió es el
  // que antes era un cubo opaco.
  it("pinta los SEIS segmentos con las cifras que llegaron", async () => {
    consultarMock.mockResolvedValue({
      status: "ok",
      datos: datos({
        entregada: 20,
        devuelta: 5,
        rechazada: 3,
        reprogramada: 7,
        incidente: 1,
        otros: 64,
      }),
    });
    renderAnillo();

    expect(await screen.findByText(/Entregadas: 20/)).toBeInTheDocument();
    expect(screen.getByText(/Devueltas: 5/)).toBeInTheDocument();
    expect(screen.getByText(/Rechazadas: 3/)).toBeInTheDocument();
    expect(screen.getByText(/Reprogramadas: 7/)).toBeInTheDocument();
    expect(screen.getByText(/Incidentes: 1/)).toBeInTheDocument();
    expect(screen.getByText(/Otros: 64/)).toBeInTheDocument();
  });

  // «No entregadas» era el nombre del cubo viejo. Que no vuelva por descuido: ahora ese lado
  // está desglosado y un rótulo que lo resuma otra vez sería una cifra duplicada.
  it("ya no existe el segmento «No entregadas»", async () => {
    consultarMock.mockResolvedValue({ status: "ok", datos: datos({ entregada: 20, otros: 80 }) });
    renderAnillo();

    await screen.findByText(/Entregadas: 20/);
    expect(screen.queryByText(/No entregadas/)).toBeNull();
  });

  // Los SEIS salen siempre, también los que valen cero: un anillo al que le falta un segmento
  // según el día se lee como si esa categoría no existiera.
  it("pinta los desenlaces en cero en vez de omitirlos", async () => {
    consultarMock.mockResolvedValue({ status: "ok", datos: datos({ entregada: 20 }) });
    renderAnillo();

    expect(await screen.findByText(/Devueltas: 0/)).toBeInTheDocument();
    expect(screen.getByText(/Incidentes: 0/)).toBeInTheDocument();
  });

  // Las etiquetas YA NO llevan calificador, y eso es la mitad del cambio del 2026-08-17.
  // Mientras la cifra salía del rollup, la izquierda era un FLUJO y la derecha un STOCK: dos
  // magnitudes distintas que el anillo estaba OBLIGADO a rotular. Ahora las dos son órdenes
  // del mismo universo, así que el calificador sobraría — y una nota que ya no describe nada
  // es peor que ninguna: enseña a ignorar las notas.
  it("no arrastra los calificadores de la versión que mezclaba flujo y stock", async () => {
    consultarMock.mockResolvedValue({ status: "ok", datos: datos({ entregada: 20, otros: 80 }) });
    renderAnillo();

    await screen.findByText(/Entregadas: 20/);
    expect(screen.queryByText(/\(periodo\)/)).toBeNull();
    expect(screen.queryByText(/abiertas al corte/i)).toBeNull();
    expect(screen.queryByText(/seguían abiertas/i)).toBeNull();
  });

  // Un anillo de dos ceros dibuja una rosquilla vacía indistinguible de una operación sin
  // órdenes, y encima con un «0» al centro que se lee como una cifra medida. `total === 0` es
  // un hecho, pero no es un GRÁFICO: cae al estado vacío del marco.
  it("con el universo vacío no dibuja un anillo de ceros", async () => {
    consultarMock.mockResolvedValue({ status: "ok", datos: datos({}) });
    renderAnillo();

    await waitFor(() => expect(consultarMock).toHaveBeenCalled());
    expect(screen.queryByText(/Entregadas: 0/)).toBeNull();
  });
});

// ⚠ AQUI VIVIA EL BLOQUE DEL SELLO DE FRESCURA («Actualizado 18:30»), retirado por decision
// humana del 2026-08-18. Lo que se pierde queda dicho, para que nadie lo redescubra a ciegas:
// la cifra se sirve de una cache de 15 min, asi que la pantalla ya no declara su edad y puede
// mostrar un numero de hace un cuarto de hora como si fuera de este segundo.
//
// `lastSync` NO se quito del DTO —el servicio lo sigue sellando dentro del productor de la
// cache, y `conteo-entregas-servicio.test.ts` lo sigue cubriendo—, asi que volver a pintarlo es
// una linea. Estos casos vigilan que el rotulo se quede fuera mientras esa sea la decision.
describe("Anillo de entregas — sin sello de frescura", () => {
  it("no pinta la hora de la ultima actualizacion", async () => {
    consultarMock.mockResolvedValue({ status: "ok", datos: datos({ entregada: 20, otros: 80 }) });
    renderAnillo();

    await screen.findByText(/Entregadas: 20/);
    expect(screen.queryByText(/Actualizado/)).toBeNull();
  });

  // Y un sello ilegible tampoco puede colarse por ninguna via: antes habia codigo que lo
  // formateaba y, mal escrito, podia acabar pintando un «Invalid Date».
  it("un lastSync ilegible no pinta nada ni rompe la grafica", async () => {
    consultarMock.mockResolvedValue({
      status: "ok",
      datos: { ...datos({ entregada: 20, otros: 80 }), lastSync: "no es una fecha" },
    });
    renderAnillo();

    expect(await screen.findByText(/Entregadas: 20/)).toBeInTheDocument();
    expect(screen.queryByText(/Invalid Date/)).toBeNull();
  });
});

// El pecado que persigue este bloque: degradar un problema de PERMISOS al vacío de la
// gráfica. Un `forbidden` pintado como "sin movimiento" convierte "no puedes verlo" en
// "no hubo entregas", que es una afirmación de negocio que nadie hizo.
describe("Anillo de entregas — los estados que NO son «sin datos»", () => {
  // Se comparan contra las CONSTANTES del tablero, no contra un texto copiado: así el anillo
  // y los paneles no pueden acabar diciendo cosas distintas del mismo estado.
  it.each([
    ["forbidden" as const, TEXTO_PROHIBIDO],
    ["unauthenticated" as const, TEXTO_SESION_NO_VALIDA],
  ])("«%s» se presenta como aviso, sin cifra", async (status, texto) => {
    consultarMock.mockResolvedValue({ status } as never);
    renderAnillo();

    const aviso = await screen.findByRole("alert");
    expect(aviso.textContent ?? "").toContain(texto);
    expect(screen.queryByText(/Entregadas: \d/)).toBeNull();
    expect(screen.queryByText(/Actualizado/)).toBeNull();
  });

  it("un fallo de red se presenta como aviso, no como vacío", async () => {
    consultarMock.mockRejectedValue(new Error("se cayó"));
    renderAnillo();

    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  // Los dos textos son DISTINTOS a propósito: «no puedes» y «no sabemos quién eres» piden
  // cosas distintas del usuario, y fundirlos deja al usuario sin saber qué hacer.
  it("«prohibido» y «sesión no válida» no comparten texto", () => {
    expect(TEXTO_PROHIBIDO).not.toBe(TEXTO_SESION_NO_VALIDA);
  });
});
