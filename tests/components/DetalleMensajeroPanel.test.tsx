// @vitest-environment jsdom
//
// Feature 192 (F6.4/F6.5) — EL DETALLE de una tarjeta: R33, R47, R48, R49, R50, R52, R62 y R63.
//
// El detalle es la SEGUNDA puerta a las mismas filas, y este archivo mide las dos mitades:
//
//   - la mitad de USO: se abre pulsando la tarjeta y también con el teclado (R47), la selección
//     queda en la URL para que el enlace se pueda compartir (R50), y lo que se pinta son las
//     cuatro columnas del listado y NINGUNA más (R49) con el chip de estatus del listado, no
//     uno nuevo (R48);
//   - la mitad de SEGURIDAD: el parámetro de la URL **no es una autorización** (R62) —el
//     detalle se le pide siempre a la Server Action— y los tres casos malos (id inexistente,
//     mensajero de otra zona, mensajero sin órdenes hoy) muestran EXACTAMENTE el mismo aviso
//     (R63). Un mensaje distinto para "no es de tu zona" confirmaría la existencia de un
//     usuario ajeno, que es justo la fuga que R41–R42 persiguen.
//
// La URL es MUTABLE en este archivo (el doble de `next/navigation` la publica con un store): sin
// eso, `?mensajero=` no podría comprobarse de verdad y R50 pasaría por vacío.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import path from "node:path";
import { SWRConfig } from "swr";

import { TableroDiaModule } from "@/app/(app)/monitoreo/_components/TableroDiaModule";
import { EstatusBadge } from "@/app/(app)/ordenes/_components/EstatusBadge";
import { leerTableroDia, leerDetalleMensajeroDia } from "@/lib/actions/tablero-dia";
import type {
  DetalleMensajeroDia,
  FilaTableroDia,
  OrdenDetalleDia,
  TableroDia,
} from "@/lib/types/tablero-dia";

vi.mock("@/lib/actions/tablero-dia", () => ({
  leerTableroDia: vi.fn(),
  leerDetalleMensajeroDia: vi.fn(),
}));

/** La URL del navegador, con suscriptores: `router.replace` la cambia y la vista se entera. */
const estadoUrl = vi.hoisted(() => ({
  params: new URLSearchParams(),
  oyentes: new Set<() => void>(),
}));

vi.mock("next/navigation", async () => {
  const React = await import("react");
  return {
    usePathname: () => "/monitoreo",
    useRouter: () => ({
      push: vi.fn(),
      refresh: vi.fn(),
      replace: (url: string) => {
        const [, consulta = ""] = url.split("?");
        estadoUrl.params = new URLSearchParams(consulta);
        for (const oyente of estadoUrl.oyentes) oyente();
      },
    }),
    useSearchParams: () =>
      React.useSyncExternalStore(
        (oyente: () => void) => {
          estadoUrl.oyentes.add(oyente);
          return () => {
            estadoUrl.oyentes.delete(oyente);
          };
        },
        () => estadoUrl.params,
        () => estadoUrl.params,
      ),
  };
});

const leerTableroMock = vi.mocked(leerTableroDia);
const leerDetalleMock = vi.mocked(leerDetalleMensajeroDia);

const AHORA = new Date("2026-08-08T20:00:00.000Z");
const FECHA_CR = "2026-08-08";

const fila = (parcial: Partial<FilaTableroDia> = {}): FilaTableroDia => ({
  mensajeroId: "m-1",
  mensajeroNombre: "Ana Rojas",
  asignadas: 2,
  entregadas: 1,
  reprogramadas: 0,
  devueltas: 0,
  rechazadas: 0,
  incidentes: 0,
  sinRecoger: 0,
  enReparto: 1,
  otros: 0,
  ...parcial,
});

/**
 * Los totales, sumados sobre las claves del acumulador. Las claves van SIN comillas a
 * propósito: el guardia de R46 (`buckets-estatus.guardia.test.ts`) censa el árbol buscando
 * literales de bucket junto a literales de estatus, y una lista de sumas con el nombre del
 * bucket entrecomillado, en un archivo que además nombra un estatus, se lee —con razón— como
 * una segunda tabla paralela. (Este comentario tampoco los entrecomilla: el censo lee el
 * archivo entero, prosa incluida.)
 */
function tableroCon(filas: readonly FilaTableroDia[]): TableroDia {
  const totales: TableroDia["totales"] = {
    asignadas: 0,
    entregadas: 0,
    reprogramadas: 0,
    devueltas: 0,
    rechazadas: 0,
    incidentes: 0,
    sinRecoger: 0,
    enReparto: 0,
    otros: 0,
  };
  const acumulado = { ...totales };
  for (const f of filas) {
    for (const clave of Object.keys(acumulado) as (keyof typeof acumulado)[]) {
      acumulado[clave] += f[clave];
    }
  }
  return {
    fecha: FECHA_CR,
    generadoAt: AHORA.toISOString(),
    alcance: "global",
    filas,
    totales: acumulado,
  };
}

const orden = (parcial: Partial<OrdenDetalleDia> = {}): OrdenDetalleDia => ({
  ordenId: "o-1",
  numGuia: "GUIA-001",
  estatus: "en_reparto",
  resultadoDelDia: null,
  cliente: "Marta Solís",
  destino: "Barrio Escalante, casa azul",
  asignadoAt: AHORA.toISOString(),
  ...parcial,
});

function detalleCon(ordenes: readonly OrdenDetalleDia[]): DetalleMensajeroDia {
  return {
    mensajeroId: "m-1",
    fecha: FECHA_CR,
    ordenes,
    total: ordenes.length,
    pagina: 1,
    pageSize: 25,
  };
}

const okTablero = (filas: readonly FilaTableroDia[]) =>
  ({ estado: "ok", tablero: tableroCon(filas) }) as const;
const okDetalle = (ordenes: readonly OrdenDetalleDia[]) =>
  ({ estado: "ok", detalle: detalleCon(ordenes) }) as const;

function renderModulo() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <TableroDiaModule />
    </SWRConfig>,
  );
}

const tarjeta = () => screen.getByRole("button", { name: /Ana Rojas/ });
const panel = () => document.querySelector('[data-slot="detalle-mensajero-panel"]');

beforeEach(() => {
  vi.clearAllMocks();
  estadoUrl.params = new URLSearchParams();
  leerTableroMock.mockResolvedValue(okTablero([fila()]));
  leerDetalleMock.mockResolvedValue(okDetalle([orden()]));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Feature 192 · R47/R50 — la tarjeta abre el detalle y la selección viaja en la URL", () => {
  it("con el ratón: abre el panel, pide el detalle de ESE mensajero y escribe `?mensajero=`", async () => {
    const usuario = userEvent.setup();
    renderModulo();
    await waitFor(() => expect(tarjeta()).toBeInTheDocument());

    // Antes del click no se ha pedido ningún detalle (R56, medido también aquí porque es la
    // precondición de todo lo demás).
    expect(leerDetalleMock).not.toHaveBeenCalled();

    await usuario.click(tarjeta());

    await waitFor(() => expect(panel()).not.toBeNull());
    expect(leerDetalleMock).toHaveBeenCalledWith(
      expect.objectContaining({ mensajeroId: "m-1" }),
    );
    // R50 — la vista es enlazable: el estado vive en el query param, no en un `useState`.
    expect(estadoUrl.params.get("mensajero")).toBe("m-1");
  });

  it("con el TECLADO: la tarjeta se alcanza con Tab y se dispara con Enter", async () => {
    const usuario = userEvent.setup();
    renderModulo();
    await waitFor(() => expect(tarjeta()).toBeInTheDocument());

    await usuario.tab();
    expect(
      document.activeElement,
      "la tarjeta no es alcanzable con Tab: un `onClick` sobre un `div` no es un botón",
    ).toBe(tarjeta());

    await usuario.keyboard("{Enter}");

    await waitFor(() => expect(panel()).not.toBeNull());
    expect(estadoUrl.params.get("mensajero")).toBe("m-1");
  });

  it("cerrar el panel limpia el parámetro y NO desmonta el tablero", async () => {
    const usuario = userEvent.setup();
    renderModulo();
    await waitFor(() => expect(tarjeta()).toBeInTheDocument());
    const consultasIniciales = leerTableroMock.mock.calls.length;

    await usuario.click(tarjeta());
    await waitFor(() => expect(panel()).not.toBeNull());

    await usuario.keyboard("{Escape}");

    await waitFor(() => expect(panel()).toBeNull());
    expect(estadoUrl.params.get("mensajero")).toBeNull();
    // El tablero sigue ahí, con sus datos, y sin haber vuelto a consultar: abrir y cerrar el
    // detalle no puede costar una recarga (R50).
    expect(screen.getByText("Ana Rojas")).toBeInTheDocument();
    expect(leerTableroMock.mock.calls.length).toBe(consultasIniciales);
  });
});

describe("Feature 192 · R48/R49 — el lenguaje visual y las columnas son las del listado", () => {
  it("muestra CUATRO columnas y ninguna más", async () => {
    const usuario = userEvent.setup();
    renderModulo();
    await waitFor(() => expect(tarjeta()).toBeInTheDocument());
    await usuario.click(tarjeta());

    const tabla = await screen.findByRole("table");
    const cabeceras = within(tabla)
      .getAllByRole("columnheader")
      .map((th) => th.textContent?.trim());

    expect(cabeceras).toEqual([
      "Nº Guía",
      "Estado",
      "Resultado del día",
      "Cliente / destino",
    ]);
    // R49 lo dice por escrito: nada de hora de la última gestión, monto recaudado ni motivo de
    // reprogramación. Ampliarlo después es aditivo; colarlo ahora, no.
    for (const prohibida of [/hora/i, /monto/i, /motivo/i]) {
      expect(cabeceras.some((c) => c && prohibida.test(c))).toBe(false);
    }
  });

  it("el chip de estatus es EL del listado (mismas clases), no un segundo juego de colores", async () => {
    const usuario = userEvent.setup();
    renderModulo();
    await waitFor(() => expect(tarjeta()).toBeInTheDocument());
    await usuario.click(tarjeta());

    const tabla = await screen.findByRole("table");
    const chip = within(tabla).getByText("En reparto");

    // Se compara contra el componente compartido renderizado aparte: si alguien reescribiera el
    // chip aquí (aunque acertara con el texto), las clases divergirían y esto se pondría rojo.
    const { container } = render(<EstatusBadge value="en_reparto" />);
    const referencia = container.firstElementChild as HTMLElement;
    expect(chip.className.split(/\s+/).filter(Boolean)).toEqual(
      referencia.className.split(/\s+/).filter(Boolean),
    );
  });

  it("el resultado del día se etiqueta con el mapa compartido, y el vacío es «—»", async () => {
    leerDetalleMock.mockResolvedValue(
      okDetalle([
        orden({ ordenId: "o-1", resultadoDelDia: null }),
        orden({ ordenId: "o-2", numGuia: "GUIA-002", resultadoDelDia: "reprogramada" }),
      ]),
    );
    const usuario = userEvent.setup();
    renderModulo();
    await waitFor(() => expect(tarjeta()).toBeInTheDocument());
    await usuario.click(tarjeta());

    const tabla = await screen.findByRole("table");
    const filaSinResultado = within(tabla).getByText("GUIA-001").closest("tr") as HTMLElement;
    const filaConResultado = within(tabla).getByText("GUIA-002").closest("tr") as HTMLElement;

    expect(within(filaSinResultado).getByText("—")).toBeInTheDocument();
    expect(within(filaConResultado).getByText("Reprogramada")).toBeInTheDocument();
  });

  it("el panel no declara un segundo mapa de estatus → etiqueta ni colores propios (censo)", () => {
    // Donde una segunda declaración haría daño de verdad es aquí: el mismo estatus leído
    // distinto en dos pantallas. El censo mira el CÓDIGO, no lo renderizado.
    const fuente = readFileSync(
      path.join(process.cwd(), "app/(app)/monitoreo/_components/DetalleMensajeroPanel.tsx"),
      "utf8",
    );
    expect(fuente).toContain("app/(app)/ordenes/_components/EstatusBadge");
    for (const senal of ["ORDER_STATUS_LABELS =", "bg-success-soft", "bg-danger-soft", "badgeVariants"]) {
      expect(fuente, `el panel declara ${senal} por su cuenta`).not.toContain(senal);
    }
  });
});

describe("Feature 192 · R33/R62/R63 — el parámetro de la URL no es una autorización", () => {
  it("al cargar `/monitoreo?mensajero=<id>` el detalle SE PIDE al servidor", async () => {
    // Un enlace compartido se abre con otra sesión: el panel no puede dar por buena la
    // selección que trae la URL, tiene que preguntar (y el servidor vuelve a resolver el
    // alcance del actor).
    estadoUrl.params = new URLSearchParams("mensajero=m-1");
    renderModulo();

    await waitFor(() =>
      expect(leerDetalleMock).toHaveBeenCalledWith(expect.objectContaining({ mensajeroId: "m-1" })),
    );
    await waitFor(() => expect(panel()).not.toBeNull());
  });

  it("los TRES casos malos dan el MISMO aviso genérico y un panel vacío", async () => {
    // Inexistente, de otra zona, y sin órdenes hoy. El servidor ya responde lo mismo en los
    // tres; lo que se mide aquí es que la interfaz tampoco los distinga —ni por texto, ni
    // porque uno de ellos cierre el panel y otro no—.
    const respuestas = [
      okDetalle([]), // sin órdenes hoy
      okDetalle([]), // fuera del alcance (el servidor devuelve exactamente esto)
      { estado: "denegado", motivo: "rol_no_autorizado" } as const, // id que ni siquiera es uuid
    ];
    const textos: string[] = [];

    for (const respuesta of respuestas) {
      leerDetalleMock.mockResolvedValue(respuesta);
      estadoUrl.params = new URLSearchParams("mensajero=m-desconocido");
      renderModulo();

      const vacio = await waitFor(() => {
        const nodo = document.querySelector('[data-slot="detalle-mensajero-vacio"]');
        expect(nodo).not.toBeNull();
        return nodo as HTMLElement;
      });
      expect(panel(), "el panel se cerró en uno de los tres casos y en otros no").not.toBeNull();
      expect(document.querySelector("table"), "un caso vacío pintó una tabla").toBeNull();
      textos.push(vacio.textContent?.trim() ?? "");
      cleanup();
    }

    expect(new Set(textos).size, `los avisos difieren: ${textos.join(" | ")}`).toBe(1);
    // Y el aviso no puede llevar el id recibido de vuelta: sería un eco explotable.
    expect(textos[0]).not.toContain("m-desconocido");
  });
});

describe("Feature 192 · R52 — el detalle no sobrevive a la tarjeta que lo abrió", () => {
  it("si la tarjeta desaparece en un refresco, el panel se cierra CON aviso", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(AHORA);

    // Se entra con el panel ya abierto sobre una tarjeta que SÍ está: así el módulo la registra
    // como vista, que es lo que distingue este caso (R52) del enlace a un id que nunca existió
    // (R63, arriba), donde el panel debe quedarse abierto y vacío.
    estadoUrl.params = new URLSearchParams("mensajero=m-1");
    leerTableroMock.mockResolvedValueOnce(okTablero([fila({ mensajeroId: "m-1" })]));
    leerTableroMock.mockResolvedValue(
      okTablero([fila({ mensajeroId: "m-2", mensajeroNombre: "Beto Mora" })]),
    );

    const { container } = renderModulo();
    await waitFor(() => expect(panel()).not.toBeNull());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000);
    });

    await waitFor(() => expect(panel()).toBeNull());
    expect(estadoUrl.params.get("mensajero")).toBeNull();
    // Cerrarlo sin decir nada dejaría al supervisor creyendo que fue un fallo suyo.
    expect(
      container.querySelector('[data-slot="tablero-dia-aviso-desaparecido"]'),
      "el panel se cerró en silencio",
    ).not.toBeNull();
    // Y el tablero sigue vivo con la tarjeta que sí queda.
    expect(screen.getByText("Beto Mora")).toBeInTheDocument();
  });
});
