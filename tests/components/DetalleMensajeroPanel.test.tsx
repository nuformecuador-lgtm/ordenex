// @vitest-environment jsdom
//
// Feature 192 (F6.4/F6.5) — EL DETALLE de una tarjeta: R33, R47, R48, R49, R50, R52, R62 y R63.
//
// El detalle es la SEGUNDA puerta a las mismas filas, y este archivo mide las dos mitades:
//
//   - la mitad de USO: se abre pulsando la tarjeta y también con el teclado (R47), la selección
//     queda en la URL para que el enlace se pueda compartir (R50), y lo que se pinta son las
//     columnas del listado —con su chip de estatus, no uno nuevo (R48)—;
//
//     ⛔ FEATURE 260, 2026-08-21 — R49 («el detalle son CUATRO columnas y ninguna más») QUEDA
//     REVERTIDA por pedido humano: el detalle monta ahora el módulo de columnas del listado
//     entero. R49 no se borra —sigue legible en `specs/192-tablero-dia-mensajeros/`, con su
//     nota de reversión fechada—, y el `describe` que la medía dice en su sitio qué la
//     sustituyó y dónde vive ahora la decisión;
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
import { iniciales } from "@/app/(app)/monitoreo/_components/filtrar-mensajeros";
import { columnasDetalle } from "@/app/(app)/monitoreo/_components/detalle-columnas";
import { ordenDelDetalle } from "@/tests/fixtures/orden-detalle-dia";
import { quitarComentarios } from "../fixtures/sin-comentarios";

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
    // FEATURE 258 (B4.5) — el contrato gana `ritmoEntregas`, obligatorio. Su ULTIMO punto es
    // `totales.entregadas` (R52).
    ritmoEntregas: [{ hora: 0, acumulado: acumulado.entregadas }],
  };
}

/**
 * FEATURE 260 (F4) — la fila del detalle YA NO tiene contrato propio: ES la del listado de
 * ordenes (`OrdenListItemDTO`) mas el resultado del dia y el instante de asignacion. Por eso
 * este constructor delega en el fixture COMPARTIDO en vez de escribir siete campos a mano: un
 * fixture propio y a medias volveria a ser una segunda idea de lo que es una orden, que es
 * justo lo que esta feature retira.
 *
 * La traduccion de los cuatro campos que este archivo usaba —y que ya no existen—:
 *   `ordenId` → `id` · `estatus` → `estatusValue` · `cliente` → `destinatario` ·
 *   `destino` → `direccion`. Y `numGuia` pasa de `string` a `number | null`.
 */
const orden = (parcial: Partial<OrdenDetalleDia> = {}): OrdenDetalleDia =>
  ordenDelDetalle({
    id: "o-1",
    numGuia: 1001,
    destinatario: "Marta Solís",
    direccion: "Barrio Escalante, casa azul",
    asignadoAt: AHORA.toISOString(),
    ...parcial,
  });

function detalleCon(
  ordenes: readonly OrdenDetalleDia[],
  alcance: DetalleMensajeroDia["alcance"] = "global",
): DetalleMensajeroDia {
  return {
    mensajeroId: "m-1",
    fecha: FECHA_CR,
    ordenes,
    total: ordenes.length,
    pagina: 1,
    pageSize: 25,
    // FEATURE 260 (R12) — con QUE alcance resolvio el servidor. Decide que columnas se montan
    // (R14), y viaja en la respuesta porque la pantalla no puede —ni debe— deducirlo.
    alcance,
  };
}

const okTablero = (filas: readonly FilaTableroDia[]) =>
  ({ estado: "ok", tablero: tableroCon(filas) }) as const;
const okDetalle = (
  ordenes: readonly OrdenDetalleDia[],
  alcance: DetalleMensajeroDia["alcance"] = "global",
) => ({ estado: "ok", detalle: detalleCon(ordenes, alcance) }) as const;

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

    // FEATURE 258 — la tarjeta ya NO es el primer punto de tabulación: delante van el campo
    // de filtro y el conmutador de densidad, que es el orden correcto de la barra. Lo que R47
    // exige es que la tarjeta SEA ALCANZABLE con el teclado, no que sea la primera. Se tabula
    // hasta llegar a ella con un tope: si dejara de ser focusable, no se alcanzaría nunca y
    // este bucle terminaría sin foco en la tarjeta —que es lo que se afirma abajo—.
    const TOPE_TABULACIONES = 10;
    for (let intento = 0; intento < TOPE_TABULACIONES; intento += 1) {
      await usuario.tab();
      if (document.activeElement === tarjeta()) break;
    }
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

describe("Feature 260 · R20/R21/R29 — el panel monta el módulo de columnas del listado", () => {
  // ⛔ REVERSIÓN DE R49 DE LA FEATURE 192 — 2026-08-21.
  //
  // Aquí vivía «muestra CUATRO columnas y ninguna más», que medía la decisión de R49: el
  // alcance del detalle cerrado en Nº Guía · Estado · Resultado del día · Cliente / destino.
  // Esa decisión QUEDA REVERTIDA por pedido humano —el detalle debe mostrar todos los datos de
  // la orden— y la sustituye la feature 260, que monta `ordenesColumns`. R49 no se borra: sigue
  // legible, con su nota de reversión fechada, en `specs/192-tablero-dia-mensajeros/`.
  //
  // QUÉ columnas son y en qué orden lo mide `tests/unit/components/detalle-columnas.test.tsx`,
  // que es donde vive esa decisión. Lo que se mide AQUÍ es lo que sólo se ve con el panel
  // montado: que la tabla del modal es exactamente la que ese módulo produce, y que montarlo no
  // trajo ni una acción a una pantalla de lectura.

  it("las cabeceras de la tabla son las del módulo de columnas, para el alcance del servidor", async () => {
    const usuario = userEvent.setup();
    renderModulo();
    await waitFor(() => expect(tarjeta()).toBeInTheDocument());
    await usuario.click(tarjeta());

    const tabla = await screen.findByRole("table");
    const cabeceras = within(tabla)
      .getAllByRole("columnheader")
      .map((th) => th.textContent?.trim());

    // Derivado del módulo, nunca de una lista literal: el día que `/ordenes` gane o pierda una
    // columna, el detalle la gana o la pierde sin tocar nada (R26).
    expect(cabeceras).toEqual(columnasDetalle("global").map((columna) => columna.value));
    expect(cabeceras.length).toBeGreaterThan(15);
  });

  it("R14 — con alcance `zona` el servidor manda menos columnas y el panel monta ESAS", async () => {
    // La otra mitad del recorte, vista desde el panel: el alcance no se deduce aquí, llega en
    // la respuesta y decide qué se monta.
    leerDetalleMock.mockResolvedValue(okDetalle([orden()], "zona"));
    const usuario = userEvent.setup();
    renderModulo();
    await waitFor(() => expect(tarjeta()).toBeInTheDocument());
    await usuario.click(tarjeta());

    const tabla = await screen.findByRole("table");
    const cabeceras = within(tabla)
      .getAllByRole("columnheader")
      .map((th) => th.textContent?.trim());

    expect(cabeceras).toEqual(columnasDetalle("zona").map((columna) => columna.value));
    expect(cabeceras.length).toBeLessThan(columnasDetalle("global").length);
  });

  it("R21 — montar el módulo NO trajo ninguna acción: ni selección, ni acciones, ni descarga", async () => {
    const usuario = userEvent.setup();
    renderModulo();
    await waitFor(() => expect(tarjeta()).toBeInTheDocument());
    await usuario.click(tarjeta());

    const tabla = await screen.findByRole("table");
    const dialogo = screen.getByRole("dialog");

    // El checkbox de selección por lote y la columna «Acciones» los antepone `OrdenesModule`,
    // no el módulo de columnas: si aparecieran aquí, es que se montó el contenedor.
    expect(within(tabla).queryAllByRole("checkbox")).toEqual([]);
    const cabeceras = within(tabla)
      .getAllByRole("columnheader")
      .map((th) => th.textContent?.trim() ?? "");
    for (const prohibida of [/acciones/i, /desglose/i, /seleccionar/i]) {
      expect(cabeceras.some((c) => prohibida.test(c)), `cabecera prohibida: ${prohibida}`).toBe(
        false,
      );
    }
    // Ni descarga del dataset, ni barra de filtros, ni escáner, ni carga masiva.
    for (const prohibido of [/descargar/i, /carga masiva/i, /escane/i, /filtrar/i]) {
      expect(within(dialogo).queryAllByRole("button", { name: prohibido })).toEqual([]);
    }
    // Y una sola tabla en el diálogo: el detalle no monta un segundo listado dentro.
    expect(within(dialogo).getAllByRole("table")).toHaveLength(1);
  });

  it("R21/R29 — el panel no monta el contenedor del listado y la fila se identifica por la orden", () => {
    // Censo de fuente. `rowKey` no es observable desde el DOM —`DataTable` cae a `row.id`
    // igualmente—, así que se mide donde se declara; y `OrdenesListado` no aparece por ningún
    // lado, que es lo que impide que las nueve acciones por lote entren por esta puerta.
    const fuente = quitarComentarios(
      readFileSync(
        path.join(process.cwd(), "app/(app)/monitoreo/_components/DetalleMensajeroPanel.tsx"),
        "utf8",
      ),
    );
    expect(fuente).toMatch(/rowKey="id"/);
    expect(fuente).not.toContain("OrdenesListado");
    for (const prop of ["renderExpanded", "descarga=", "filtros="]) {
      expect(fuente, `el detalle ofrece ${prop}`).not.toContain(prop);
    }
  });
});

describe("Feature 192 · R48 — el lenguaje visual es el del listado", () => {
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
        orden({ id: "o-1", resultadoDelDia: null }),
        orden({ id: "o-2", numGuia: 1002, resultadoDelDia: "reprogramada" }),
      ]),
    );
    const usuario = userEvent.setup();
    renderModulo();
    await waitFor(() => expect(tarjeta()).toBeInTheDocument());
    await usuario.click(tarjeta());

    const tabla = await screen.findByRole("table");
    const filaSinResultado = within(tabla).getByText("1001").closest("tr") as HTMLElement;
    const filaConResultado = within(tabla).getByText("1002").closest("tr") as HTMLElement;

    expect(within(filaSinResultado).getByText("—")).toBeInTheDocument();
    expect(within(filaConResultado).getByText("Reprogramada")).toBeInTheDocument();
  });

  it("el vocabulario del listado se CONSUME, y ni el panel ni sus columnas declaran otro (censo)", () => {
    // Donde una segunda declaración haría daño de verdad es aquí: el mismo estatus leído
    // distinto en dos pantallas. El censo mira el CÓDIGO, no lo renderizado.
    //
    // FEATURE 260 — el import del chip CAMBIÓ DE ARCHIVO, no desapareció: el panel ya no pinta
    // ninguna celda, monta el módulo de columnas y es ÉSE el que consume el vocabulario del
    // listado (`ordenes-columns` trae `EstatusBadge`; `estatus-label` etiqueta el resultado del
    // día). Exigirlo en el panel después de esta feature sería exigir que el panel volviera a
    // declarar columnas.
    const fuenteDe = (ruta: string) =>
      readFileSync(path.join(process.cwd(), ruta), "utf8");

    const panel = fuenteDe("app/(app)/monitoreo/_components/DetalleMensajeroPanel.tsx");
    const columnas = fuenteDe("app/(app)/monitoreo/_components/detalle-columnas.ts");

    expect(panel).toContain("./detalle-columnas");
    expect(columnas).toContain("app/(app)/ordenes/_components/ordenes-columns");
    expect(columnas).toContain("app/(app)/ordenes/_components/estatus-label");

    for (const senal of ["ORDER_STATUS_LABELS =", "bg-success-soft", "bg-danger-soft", "badgeVariants"]) {
      expect(panel, `el panel declara ${senal} por su cuenta`).not.toContain(senal);
      expect(columnas, `el módulo de columnas declara ${senal} por su cuenta`).not.toContain(senal);
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

/* ══════════════════════════════════════════════════════════════════════════════════════════
   FEATURE 258 (F3.2) — el detalle pasa de `Sheet` a `Modal` + `DataTable` + `Pagination`.
   Mapea: R31, R32, R33, R34, R35, R36, R62, R75.

   Lo que sigue arriba, sin tocar: apertura con ratón y teclado, `?mensajero=` en la URL,
   cierre con Escape que limpia el parámetro sin re-consultar, las columnas (que la feature 260
   pasó de cuatro propias al módulo del listado), la comparación de clases con `EstatusBadge`,
   el «—» del resultado vacío, los tres casos malos con el mismo texto y sin tabla, el censo de
   fuente y el cierre con aviso.

   Lo que cambia es el CONTENEDOR, y cambia a propósito. El `data-slot` del panel se movió del
   `SheetContent` a un `div` dentro de `children` del `Modal` porque `Modal` tiene props
   tipadas y no acepta `data-*` arbitrarios — el SELECTOR de los tests no cambia, y eso es
   justo lo que R62 pide.
   ══════════════════════════════════════════════════════════════════════════════════════════ */

describe("Feature 258 · R31/R34 — el detalle es un diálogo MODAL de lectura", () => {
  it("el contenedor lleva `aria-modal` y se titula con el nombre del mensajero", async () => {
    const usuario = userEvent.setup();
    renderModulo();
    await waitFor(() => expect(tarjeta()).toBeInTheDocument());
    await usuario.click(tarjeta());

    await waitFor(() => expect(panel()).not.toBeNull());

    // Es un diálogo de verdad: la primitiva pone el rol y `aria-modal`.
    const dialogo = screen.getByRole("dialog");
    expect(dialogo.getAttribute("aria-modal")).toBe("true");
    expect(dialogo.contains(panel())).toBe(true);
    // Y su título es el nombre de la tarjeta desde la que se abrió.
    expect(within(dialogo).getByText("Ana Rojas")).toBeInTheDocument();
  });

  it("cuando el id llegó por la URL y no hay tarjeta, se titula en GENÉRICO", async () => {
    // Sin nombre no se inventa uno ni se hace eco del id: el título genérico no revela nada.
    estadoUrl.params = new URLSearchParams("mensajero=m-desconocido");
    leerDetalleMock.mockResolvedValue(okDetalle([]));
    renderModulo();

    await waitFor(() => expect(panel()).not.toBeNull());
    const dialogo = screen.getByRole("dialog");
    expect(dialogo).toHaveTextContent(/Órdenes del día/i);
    expect(dialogo.textContent).not.toContain("m-desconocido");
  });

  it("R34: NO hay botón «Confirmar»; la única salida visible es «Cerrar»", async () => {
    const usuario = userEvent.setup();
    renderModulo();
    await waitFor(() => expect(tarjeta()).toBeInTheDocument());
    await usuario.click(tarjeta());
    await waitFor(() => expect(panel()).not.toBeNull());

    const dialogo = screen.getByRole("dialog");
    expect(
      within(dialogo).queryByRole("button", { name: /confirmar/i }),
      "el detalle ofrece una confirmación: es una vista de lectura, no una decisión",
    ).toBeNull();
    expect(within(dialogo).getByRole("button", { name: /^Cerrar$/ })).toBeInTheDocument();
  });

  it("el botón «Cerrar» limpia el parámetro igual que Escape (R32)", async () => {
    const usuario = userEvent.setup();
    renderModulo();
    await waitFor(() => expect(tarjeta()).toBeInTheDocument());
    await usuario.click(tarjeta());
    await waitFor(() => expect(panel()).not.toBeNull());

    await usuario.click(screen.getByRole("button", { name: /^Cerrar$/ }));

    await waitFor(() => expect(panel()).toBeNull());
    expect(estadoUrl.params.get("mensajero")).toBeNull();
  });
});

describe("Feature 258 · R62 — el ancla aparece al abrir y DESAPARECE al cerrar", () => {
  it("`data-slot=\"detalle-mensajero-panel\"` no se queda en el DOM con el modal cerrado", async () => {
    const usuario = userEvent.setup();
    renderModulo();
    await waitFor(() => expect(tarjeta()).toBeInTheDocument());

    // Antes de abrir no está: el `Dialog.Portal` no monta nada.
    expect(panel()).toBeNull();

    await usuario.click(tarjeta());
    await waitFor(() => expect(panel()).not.toBeNull());

    await usuario.keyboard("{Escape}");
    await waitFor(() => expect(panel()).toBeNull());
  });
});

describe("Feature 258 · R33 — abrir y cerrar el detalle NO consulta el tablero de más", () => {
  it("el tablero sigue montado y con el mismo número de consultas", async () => {
    const usuario = userEvent.setup();
    renderModulo();
    await waitFor(() => expect(tarjeta()).toBeInTheDocument());
    const consultas = leerTableroMock.mock.calls.length;

    await usuario.click(tarjeta());
    await waitFor(() => expect(panel()).not.toBeNull());
    // Con el modal abierto, el tablero sigue ahí detrás.
    expect(document.querySelector('[data-slot="tablero-dia-rejilla"]')).not.toBeNull();

    await usuario.keyboard("{Escape}");
    await waitFor(() => expect(panel()).toBeNull());

    expect(leerTableroMock.mock.calls.length).toBe(consultas);
  });
});

describe("Feature 258 · R35/R75 — la tabla es `DataTable` y la paginación viene del servidor", () => {
  it("el `pageSize` que se pinta es el que vino del servidor, no un literal de la pantalla", async () => {
    // El servidor lo toma de `ordenesConfig.DEFAULT_PAGE_SIZE`. Aquí se prueba con un valor
    // DISTINTO del de por defecto a propósito: si la pantalla escribiera 25 a mano, el rango
    // de la paginación seguiría diciendo 25 y este test no se enteraría.
    const PAGE_SIZE_DEL_SERVIDOR = 7;
    const muchas = Array.from({ length: PAGE_SIZE_DEL_SERVIDOR }, (_, i) =>
      orden({ id: `o-${i}`, numGuia: 1000 + i }),
    );
    leerDetalleMock.mockResolvedValue({
      estado: "ok",
      detalle: {
        mensajeroId: "m-1",
        fecha: FECHA_CR,
        ordenes: muchas,
        total: 20,
        pagina: 1,
        pageSize: PAGE_SIZE_DEL_SERVIDOR,
        alcance: "global",
      },
    });

    const usuario = userEvent.setup();
    renderModulo();
    await waitFor(() => expect(tarjeta()).toBeInTheDocument());
    await usuario.click(tarjeta());

    await screen.findByRole("table");
    const paginacion = screen.getByRole("navigation", { name: /paginaci/i });
    // El rango por defecto de `Pagination` es «1-7 de 20»: sale del `pageSize` del servidor.
    expect(paginacion).toHaveTextContent(`1-${PAGE_SIZE_DEL_SERVIDOR} de 20`);
  });

  it("la fuente del panel no escribe ningún literal de tamaño de página (R75)", () => {
    const fuente = quitarComentarios(
      readFileSync(
        path.join(process.cwd(), "app/(app)/monitoreo/_components/DetalleMensajeroPanel.tsx"),
        "utf8",
      ),
    );
    expect(fuente).not.toMatch(/pageSize\s*[:=]\s*\d+/);
    expect(fuente).not.toMatch(/PAGE_SIZE\s*=\s*\d+/);
    // Y monta las tres primitivas que R23 exige.
    for (const primitiva of [
      "@/components/shared/Modal",
      "@/components/shared/DataTable",
      "@/components/shared/Pagination",
    ]) {
      expect(fuente, `el panel no monta ${primitiva}`).toContain(primitiva);
    }
  });
});

describe("Feature 258 · M-2 — cerrar el detalle CONSERVA el resto de parámetros de la URL", () => {
  it("quita `mensajero` y deja intacto todo lo demás que traiga el enlace", async () => {
    // El hueco que esto tapa: `cerrarDetalle` reconstruye la URL filtrando SÓLO `mensajero`,
    // pero hasta ahora ningún test lo afirmaba. Un `router.replace(pathname)` a secas pasaba
    // la suite entera — y con él se perdería cualquier otro parámetro de un enlace compartido,
    // en silencio y sin que nada se pusiera rojo.
    estadoUrl.params = new URLSearchParams("mensajero=m-1&zona=cartago&vista=compacta");
    const usuario = userEvent.setup();
    renderModulo();
    await waitFor(() => expect(panel()).not.toBeNull());

    await usuario.keyboard("{Escape}");
    await waitFor(() => expect(panel()).toBeNull());

    expect(estadoUrl.params.get("mensajero")).toBeNull();
    expect(
      estadoUrl.params.get("zona"),
      "cerrar el detalle se llevó por delante el resto de la URL",
    ).toBe("cartago");
    expect(estadoUrl.params.get("vista")).toBe("compacta");
  });

  it("y abrir otra tarjeta tampoco los pierde", async () => {
    // La otra mitad del mismo contrato: `seleccionar` parte de los parámetros actuales y sólo
    // AÑADE el suyo.
    estadoUrl.params = new URLSearchParams("zona=cartago");
    const usuario = userEvent.setup();
    renderModulo();
    await waitFor(() => expect(tarjeta()).toBeInTheDocument());

    await usuario.click(tarjeta());
    await waitFor(() => expect(panel()).not.toBeNull());

    expect(estadoUrl.params.get("mensajero")).toBe("m-1");
    expect(estadoUrl.params.get("zona")).toBe("cartago");
  });

  it("sin más parámetros, cerrar deja la URL limpia (no un `?` colgando)", async () => {
    estadoUrl.params = new URLSearchParams("mensajero=m-1");
    const usuario = userEvent.setup();
    renderModulo();
    await waitFor(() => expect(panel()).not.toBeNull());

    await usuario.keyboard("{Escape}");
    await waitFor(() => expect(panel()).toBeNull());

    expect([...estadoUrl.params.keys()]).toEqual([]);
  });
});

describe("Feature 258 · M-1/R71 — el avatar de iniciales en la CABECERA del detalle", () => {
  it("la cabecera del modal muestra las iniciales, decorativas, con el nombre completo al lado", async () => {
    // R71 pide el avatar en los DOS sitios: la tarjeta y la cabecera del detalle. Hasta ahora
    // sólo estaba probado en la tarjeta.
    const usuario = userEvent.setup();
    renderModulo();
    await waitFor(() => expect(tarjeta()).toBeInTheDocument());
    await usuario.click(tarjeta());
    await waitFor(() => expect(panel()).not.toBeNull());

    const dialogo = screen.getByRole("dialog");
    // El nombre completo sigue presente como texto: dos iniciales no identifican a nadie.
    expect(within(dialogo).getByText("Ana Rojas")).toBeInTheDocument();

    const avatar = [...dialogo.querySelectorAll('[aria-hidden="true"]')].find(
      (nodo) => nodo.textContent === iniciales("Ana Rojas"),
    );
    expect(avatar, "la cabecera del detalle no monta el avatar de iniciales (R71)").toBeDefined();
    expect(iniciales("Ana Rojas")).toBe("AR");
  });

  it("si el id llegó por la URL y no hay tarjeta, NO se inventa un avatar", async () => {
    // Sin nombre no hay iniciales que mostrar, y fabricarlas desde el id sería un eco del
    // identificador recibido (R13).
    estadoUrl.params = new URLSearchParams("mensajero=m-desconocido");
    leerDetalleMock.mockResolvedValue(okDetalle([]));
    renderModulo();
    await waitFor(() => expect(panel()).not.toBeNull());

    const dialogo = screen.getByRole("dialog");
    expect(dialogo).toHaveTextContent(/Órdenes del día/i);
    expect(dialogo.textContent).not.toContain("m-desconocido");
  });
});

describe("Feature 259 · R24/R25 — la cabecera del detalle dice «para hoy»", () => {
  // Esta cifra y la de la tarjeta son la MISMA (R14 de la 259): describirlas con criterios
  // distintos —«asignadas hoy» aquí, «asignadas para hoy» allá— haría que la pantalla dijera
  // dos cosas del mismo número. El texto viejo, además, dejó de ser cierto: el tablero cuenta
  // por el día PARA EL QUE se asignó la orden, no por el día en que se asignó.
  it("en plural: «N órdenes asignadas para hoy»", async () => {
    const usuario = userEvent.setup();
    leerDetalleMock.mockResolvedValue(
      okDetalle([orden(), orden({ id: "o-2", numGuia: 1002 })]),
    );
    renderModulo();
    await waitFor(() => expect(tarjeta()).toBeInTheDocument());
    await usuario.click(tarjeta());

    expect(await screen.findByText("2 órdenes asignadas para hoy")).toBeInTheDocument();
    expect(
      screen.queryByText(/órdenes asignadas hoy/i),
      "volvió el texto anterior: la cabecera describe el día en que se asignó",
    ).toBeNull();
  });

  it("en singular también: «1 orden asignada para hoy»", async () => {
    const usuario = userEvent.setup();
    leerDetalleMock.mockResolvedValue(okDetalle([orden()]));
    renderModulo();
    await waitFor(() => expect(tarjeta()).toBeInTheDocument());
    await usuario.click(tarjeta());

    expect(await screen.findByText("1 orden asignada para hoy")).toBeInTheDocument();
  });
});
