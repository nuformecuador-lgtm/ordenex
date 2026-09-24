// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";

import {
  HoyGestionBarras,
  tituloConFecha,
} from "@/app/(app)/analitica/_components/entregas/HoyGestionBarras";
import {
  DESCRIPCION_VACIO_DE_HOY,
  NOTA_NO_SIGUE_LA_FECHA,
  tituloVacioDeHoy,
  vacioDeHoy,
} from "@/app/(app)/analitica/_components/entregas/hoy-gestion-textos";
import {
  TEXTO_PROHIBIDO,
  TEXTO_SESION_NO_VALIDA,
  VACIO_PANEL,
} from "@/app/(app)/analitica/_components/operativo/textos";
import { consultarConteoHoyGestion } from "@/lib/actions/conteo-hoy-gestion";
import type { ConteoHoyGestionDTO } from "@/lib/types/conteo-hoy-gestion";

vi.mock("@/lib/actions/conteo-hoy-gestion", () => ({
  consultarConteoHoyGestion: vi.fn(),
}));

const consultarMock = vi.mocked(consultarConteoHoyGestion);

function datos(sinGestion: number, conGestion: number): ConteoHoyGestionDTO {
  return {
    sinGestion,
    conGestion,
    total: sinGestion + conGestion,
    fecha: "2026-08-18",
    lastSync: "2026-08-18T18:30:00.000Z",
  };
}

function renderBarras() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <HoyGestionBarras />
    </SWRConfig>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

describe("Cargadas hoy — de dónde sale la cifra", () => {
  it("consulta `consultarConteoHoyGestion` y por ninguna otra puerta", async () => {
    consultarMock.mockResolvedValue({ status: "ok", datos: datos(12, 30) });
    renderBarras();

    await waitFor(() => expect(consultarMock).toHaveBeenCalledTimes(1));
  });

  // Manda el filtro entero aunque el backend ignore la ventana y el mensajero: recortarlo aquí
  // haría que la misma barra produjera un `raw` distinto según la gráfica, y un
  // `validation_error` aparecería en tres y no en la cuarta.
  it("la primera consulta va SIN filtro, igual que las otras tres", async () => {
    consultarMock.mockResolvedValue({ status: "ok", datos: datos(12, 30) });
    renderBarras();

    await waitFor(() => expect(consultarMock).toHaveBeenCalled());
    expect(consultarMock.mock.calls[0]?.[0]).toEqual({});
  });
});

describe("Cargadas hoy — las dos barras", () => {
  it("pinta las dos con sus cifras", async () => {
    consultarMock.mockResolvedValue({ status: "ok", datos: datos(12, 30) });
    renderBarras();

    expect(await screen.findByText(/Sin gestión en el día: 12/)).toBeInTheDocument();
    expect(screen.getByText(/Gestionadas: 30/)).toBeInTheDocument();
  });

  // Si el bucket en cero desapareciera, «todo gestionado» y «todo pendiente» dibujarían la
  // misma gráfica de una sola barra y sólo la etiqueta las distinguiría.
  it("la barra en cero NO desaparece", async () => {
    consultarMock.mockResolvedValue({ status: "ok", datos: datos(0, 30) });
    renderBarras();

    expect(await screen.findByText(/Sin gestión en el día: 0/)).toBeInTheDocument();
    expect(screen.getByText(/Gestionadas: 30/)).toBeInTheDocument();
  });

  // Dos barras de altura cero con sus ejes dibujados se leen como una pantalla a medio cargar,
  // no como «hoy no ha entrado nada».
  it("sin ninguna orden cargada hoy cae al estado vacío", async () => {
    consultarMock.mockResolvedValue({ status: "ok", datos: datos(0, 0) });
    renderBarras();

    await waitFor(() => expect(consultarMock).toHaveBeenCalled());
    expect(screen.queryByText(/Sin gestión en el día: 0/)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// FICHA 444 — EL TÍTULO PROMETE «HOY» Y EL CUERPO HABLABA «DEL RANGO»
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// Medido en el navegador el 2026-09-17 (sesión de maestro, `/analitica`, base local con CERO
// órdenes cargadas ese día): el panel decía, literalmente,
//
//   «Cargadas hoy (2026-09-17) | Sin datos en el rango | Esta metrica no registro ningun
//    movimiento con el filtro seleccionado.»
//
// La CIFRA era correcta —la consulta no mira el rango del filtro en ninguna de sus tres capas—,
// así que lo que se arregla es lo que se lee. Estos casos son el punto de mutación: devolver
// `VACIO_PANEL` al `vacio` de este panel los pone rojos.
describe("Cargadas hoy — el vacío habla del DÍA, no del rango", () => {
  it("sin cargas, el cuerpo nombra el MISMO día que el título", async () => {
    consultarMock.mockResolvedValue({ status: "ok", datos: datos(0, 0) });
    renderBarras();

    // El título ya llevaba la fecha del servidor; ahora el cuerpo la lleva también, y es la
    // misma: dos frases sobre el mismo día en vez de una sobre el día y otra sobre el rango.
    expect(await screen.findByText(tituloVacioDeHoy("2026-08-18"))).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Cargadas hoy (2026-08-18)" })).toBeInTheDocument();
  });

  it("el cuerpo del vacío NO menciona el rango ni «el filtro seleccionado»", async () => {
    consultarMock.mockResolvedValue({ status: "ok", datos: datos(0, 0) });
    const { container } = renderBarras();

    // Se espera por la NOTA y no por el texto nuevo del vacío, y es deliberado: la nota se
    // pinta igual con el defecto puesto, así que al mutar este caso muere por lo que de verdad
    // importa —que en pantalla vuelve a poner «Sin datos en el rango»— y no por no encontrar
    // una frase que la mutación acaba de quitar.
    await screen.findByText(NOTA_NO_SIGUE_LA_FECHA);
    const texto = container.textContent ?? "";
    // Las dos frases prestadas, cada una por su cuenta: son las que producía `VACIO_PANEL`.
    expect(texto, `el panel volvió a decir «${VACIO_PANEL.titulo}» bajo un título que promete hoy`)
      .not.toContain(VACIO_PANEL.titulo);
    expect(texto).not.toContain(VACIO_PANEL.descripcion);
    expect(screen.getByText(DESCRIPCION_VACIO_DE_HOY)).toBeInTheDocument();
  });

  // Inventar una fecha mientras no se sabe cuál es sería escribir un día que nadie ha medido,
  // exactamente igual que en el título.
  it("sin fecha del servidor, la frase va desnuda y sin dígitos", () => {
    expect(vacioDeHoy(null).titulo).toBe("Hoy todavía no ha entrado ninguna orden");
    expect(vacioDeHoy(null).titulo).not.toMatch(/\d/);
    expect(vacioDeHoy("2026-08-18").titulo).toContain("2026-08-18");
  });
});

// `ConteoHoyGestionDTO` lo exige por escrito («la pantalla tiene que decirlo porque la barra es
// una sola») y hasta la 444 no se decía en ningún sitio: con cifras en pantalla, quien mueve el
// selector de fechas y ve estas dos barras quietas concluye que el panel está roto.
describe("Cargadas hoy — la nota de qué filtros obedece", () => {
  it("se pinta TAMBIÉN con cifras, no sólo en el vacío", async () => {
    consultarMock.mockResolvedValue({ status: "ok", datos: datos(12, 30) });
    renderBarras();

    expect(await screen.findByText(/Sin gestión en el día: 12/)).toBeInTheDocument();
    expect(screen.getByText(NOTA_NO_SIGUE_LA_FECHA)).toBeInTheDocument();
  });

  it("se pinta también sin ninguna carga", async () => {
    consultarMock.mockResolvedValue({ status: "ok", datos: datos(0, 0) });
    renderBarras();

    expect(await screen.findByText(NOTA_NO_SIGUE_LA_FECHA)).toBeInTheDocument();
  });

  // Una nota sobre qué cuenta el panel debajo de «no tienes acceso» se lee como si algo se
  // hubiera contado igualmente.
  it("NO se pinta cuando lo que hay es un aviso de permisos", async () => {
    consultarMock.mockResolvedValue({ status: "forbidden" } as never);
    renderBarras();

    await screen.findByRole("alert");
    expect(screen.queryByText(NOTA_NO_SIGUE_LA_FECHA)).toBeNull();
  });
});

describe("Cargadas hoy — el título lleva la fecha del SERVIDOR", () => {
  // `hoy` en el navegador y `hoy` en Costa Rica no son el mismo día para todo el mundo, y una
  // pestaña abierta desde ayer seguiría diciendo «hoy» sobre un contador de ayer.
  it("pone la fecha que devolvió el servidor", () => {
    expect(tituloConFecha("2026-08-18")).toBe("Cargadas hoy (2026-08-18)");
  });

  // Inventar una fecha mientras carga sería escribir un día que nadie ha medido.
  it("sin datos todavía, el título va desnudo", () => {
    expect(tituloConFecha(null)).toBe("Cargadas hoy");
    expect(tituloConFecha(null)).not.toMatch(/\d/);
  });

  it("la fecha llega hasta el nombre accesible de la gráfica", async () => {
    consultarMock.mockResolvedValue({ status: "ok", datos: datos(12, 30) });
    renderBarras();

    expect(await screen.findByRole("region", { name: /2026-08-18/ })).toBeInTheDocument();
  });
});

// Degradar un problema de PERMISOS al vacío de la gráfica convierte «no puedes verlo» en «hoy
// no entró nada», que es una afirmación de negocio que nadie hizo.
describe("Cargadas hoy — los estados que NO son «sin datos»", () => {
  it.each([
    ["forbidden" as const, TEXTO_PROHIBIDO],
    ["unauthenticated" as const, TEXTO_SESION_NO_VALIDA],
  ])("«%s» se presenta como aviso, sin cifras", async (status, texto) => {
    consultarMock.mockResolvedValue({ status } as never);
    renderBarras();

    const aviso = await screen.findByRole("alert");
    expect(aviso.textContent ?? "").toContain(texto);
    expect(screen.queryByText(/Sin gestión en el día: \d/)).toBeNull();
  });

  it("un fallo de red se presenta como aviso, no como vacío", async () => {
    consultarMock.mockRejectedValue(new Error("se cayó"));
    renderBarras();

    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});
