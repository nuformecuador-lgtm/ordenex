// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AsignarBodegaModal } from "@/app/(app)/ordenes/_components/AsignarBodegaModal";
import { AsignarRecoleccionModal } from "@/app/(app)/ordenes/_components/AsignarRecoleccionModal";
import { construirFiltrosEntregas } from "@/app/(app)/_components/entregas-filtros-def";
import type { MensajeroLiteDTO } from "@/lib/types/orden-guia";
import type { OrdenListItemDTO } from "@/lib/types/orden";
import type { CatalogoFiltrosOrdenesDTO } from "@/lib/types/filtros-ordenes";

/**
 * =================================================================================================
 * FEATURE 271 (T9.4, R28/R31/R32/R33) — LOS DOS MODALES DESHABILITAN; EL FILTRO NO.
 * =================================================================================================
 *
 * LA HISTORIA, porque esta regla se dio la vuelta DOS veces en cinco días y sin ella estos casos
 * parecen arbitrarios:
 *
 *   · Hasta el 2026-08-18 los selectores de asignación deshabilitaban a quien arrastrara un cierre
 *     abierto. El humano lo retiró ese día: el servidor había dejado de rechazarlo, y una pantalla
 *     que prohíbe lo que el servidor acepta no da forma de descubrir que la regla ya no existe.
 *   · El 2026-08-23 el humano revirtió esa mitad. Acumular dos cierres sin aprobar —o arrastrar uno
 *     que espera a que el mensajero lo reenvíe— vuelve a bloquear RECIBIR TRABAJO NUEVO. Y sin
 *     distinguir reparto de recolección, con sus palabras: «un mensajero no puede hacer las dos
 *     gestiones, solo una a la vez».
 *
 * Así que la dirección del error se invirtió: hoy el fallo caro es NO marcarlos, que es dejar
 * elegir a alguien cuyo lote entero el servidor va a rechazar sin efectos. Es literalmente el
 * incidente del 18/08 visto desde el otro lado.
 *
 * ⚠️ QUÉ AFIRMAN ESTOS CASOS Y QUÉ NO. Afirman que la PANTALLA marca a quien el servidor va a
 * rechazar. NO afirman que el servidor lo rechace: eso vive en
 * `tests/unit/services/cierre-bloqueo-superficies.test.ts` (familias B1 y B3), sobre el predicado
 * real. Las dos mitades tienen que existir por separado, y su unión es R32 — «exactamente los que
 * el servidor va a rechazar, ni uno más ni uno menos».
 */

vi.mock("@/lib/actions/ordenes-guia", () => ({
  asignarDesdeBodega: vi.fn(),
  asignarRecoleccion: vi.fn(),
}));

vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

const MENSAJEROS: MensajeroLiteDTO[] = [
  { id: "m1", nombre: "Ana Mensajera" },
  { id: "m2", nombre: "Beto Mensajero" },
];

const FECHAS_DIA_REPARTO = { hoy: "2026-08-20", manana: "2026-08-21" };

/** El motivo que ven los tres selectores. En lenguaje claro y sin nombres de estado (R46). */
const MOTIVO = "tiene cierres sin resolver";

function makeOrden(id: string, estatusValue: string): OrdenListItemDTO {
  return {
    id,
    numGuia: 100,
    numRemision: `REM-${id}`,
    estatusId: "st-1",
    estatusValue,
    destinatario: "Destino",
    telefonoDest: "88880000",
    tiendaId: "t1",
    tiendaNombre: "Tienda X",
    zonaId: "z1",
    zonaEsGam: true,
    provinciaId: "p1",
    cantonId: "c1",
    distritoId: null,
    producto: "Caja",
    peso: 1,
    notas: null,
    createdAt: new Date("2026-08-20T00:00:00Z"),
    updatedAt: new Date("2026-08-20T00:00:00Z"),
  };
}

/**
 * Abre el desplegable de mensajeros y devuelve su `listbox`. El nombre accesible NO es el mismo en
 * los dos modales —«para el lote» en reparto, «para la recolección» en el otro— y eso se conserva:
 * son dos preguntas distintas para quien las lee con un lector de pantalla.
 */
async function abrirSelector(
  user: ReturnType<typeof userEvent.setup>,
  nombre = "Mensajero para el lote",
) {
  await user.click(screen.getByRole("combobox", { name: nombre }));
  return screen.findByRole("listbox");
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("271/T9.4 · el modal de REPARTO desde bodega central (R28/R32)", () => {
  it("el bloqueado sale deshabilitado y con el motivo EN la etiqueta", async () => {
    const user = userEvent.setup();
    render(
      <AsignarBodegaModal
        open
        ordenes={[makeOrden("o1", "en_bodega_central")]}
        mensajeros={MENSAJEROS}
        mensajerosBloqueadosIds={["m2"]}
        fechasDiaReparto={FECHAS_DIA_REPARTO}
        onOpenChange={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    const listbox = await abrirSelector(user);
    // El motivo va EN el nombre accesible y no sólo en un atributo: un nombre gris sin explicación
    // deja a quien asigna preguntándose si es un fallo de la pantalla.
    const bloqueado = within(listbox).getByRole("option", {
      name: `Beto Mensajero (${MOTIVO})`,
    });
    expect(bloqueado).toHaveAttribute("aria-disabled", "true");
  });

  it("R34: su compañero sin cierres sigue elegible — no se bloquea la bodega entera", async () => {
    const user = userEvent.setup();
    render(
      <AsignarBodegaModal
        open
        ordenes={[makeOrden("o1", "en_bodega_central")]}
        mensajeros={MENSAJEROS}
        mensajerosBloqueadosIds={["m2"]}
        fechasDiaReparto={FECHAS_DIA_REPARTO}
        onOpenChange={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    const listbox = await abrirSelector(user);
    expect(
      within(listbox).getByRole("option", { name: "Ana Mensajera" }),
    ).not.toHaveAttribute("aria-disabled", "true");
  });

  it("con la lista vacía no se marca a nadie (no se prohíbe de más)", async () => {
    const user = userEvent.setup();
    render(
      <AsignarBodegaModal
        open
        ordenes={[makeOrden("o1", "en_bodega_central")]}
        mensajeros={MENSAJEROS}
        mensajerosBloqueadosIds={[]}
        fechasDiaReparto={FECHAS_DIA_REPARTO}
        onOpenChange={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    const listbox = await abrirSelector(user);
    expect(
      within(listbox).getByRole("option", { name: "Beto Mensajero" }),
    ).not.toHaveAttribute("aria-disabled", "true");
    expect(within(listbox).queryByText(new RegExp(MOTIVO, "i"))).toBeNull();
  });

  it("el bloqueo por cierre GANA sobre la regla de dedicación cuando concurren", async () => {
    // Los dos motivos son ciertos, pero sólo uno es accionable POR EL MENSAJERO: cerrar. Decirle a
    // quien asigna «tiene recolección pendiente» le hace esperar a que termine un viaje; decirle
    // «tiene cierres sin resolver» le dice que ese mensajero no va a volver hasta que cierre.
    const user = userEvent.setup();
    render(
      <AsignarBodegaModal
        open
        ordenes={[makeOrden("o1", "en_bodega_central")]}
        mensajeros={MENSAJEROS}
        mensajerosConRecoleccionIds={["m2"]}
        mensajerosBloqueadosIds={["m2"]}
        fechasDiaReparto={FECHAS_DIA_REPARTO}
        onOpenChange={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    const listbox = await abrirSelector(user);
    expect(
      within(listbox).getByRole("option", { name: `Beto Mensajero (${MOTIVO})` }),
    ).toHaveAttribute("aria-disabled", "true");
  });
});

describe("271/T9.4 · el modal de RECOLECCIÓN en tienda (R31/R32)", () => {
  // ⚠️ ESTE ES EL QUE SE DIO LA VUELTA EL 2026-08-23. El spec llegó a decir «el de recolección NO»,
  // y el humano lo revirtió: recolectar en tienda es COBRAR, y el dinero que cobre no tendría
  // cierre al que ir. Si alguien encuentra un resto de aquella excepción, es basura de la versión
  // anterior, no una decisión.
  it("el bloqueado sale deshabilitado, igual que en reparto", async () => {
    const user = userEvent.setup();
    render(
      <AsignarRecoleccionModal
        open
        ordenes={[makeOrden("o1", "por_recolectar_en_tienda")]}
        mensajeros={MENSAJEROS}
        mensajerosBloqueadosIds={["m2"]}
        onOpenChange={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    const listbox = await abrirSelector(user, "Mensajero para la recolección");
    expect(
      within(listbox).getByRole("option", { name: `Beto Mensajero (${MOTIVO})` }),
    ).toHaveAttribute("aria-disabled", "true");
  });

  it("y el que no arrastra cierres sigue elegible para recolectar", async () => {
    const user = userEvent.setup();
    render(
      <AsignarRecoleccionModal
        open
        ordenes={[makeOrden("o1", "por_recolectar_en_tienda")]}
        mensajeros={MENSAJEROS}
        mensajerosBloqueadosIds={["m2"]}
        onOpenChange={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    const listbox = await abrirSelector(user, "Mensajero para la recolección");
    expect(
      within(listbox).getByRole("option", { name: "Ana Mensajera" }),
    ).not.toHaveAttribute("aria-disabled", "true");
  });

  it("R32: la MISMA lista alimenta los dos modales — el campo no es «para reparto»", () => {
    // Se afirma sobre el nombre del contrato, que es donde vivía la asimetría: el campo se llama
    // `bloqueadosIds` y NO `bloqueadosParaRepartoIds` porque desde el 2026-08-23 no hay dos
    // conjuntos. Si alguien vuelve a partirlo en dos, este caso se cae al compilar.
    const fuente = readFileSync("app/(app)/ordenes/_components/OrdenesListado.tsx", "utf8");
    const ocurrencias = fuente.match(/mensajerosBloqueadosIds=\{mensajerosBloqueadosIds\}/g) ?? [];
    expect(ocurrencias).toHaveLength(2);
  });
});

/**
 * =================================================================================================
 * R33 — EL FILTRO DEL LISTADO NO DESHABILITA. ES DELIBERADO.
 * =================================================================================================
 *
 * `FiltrosEntregas` llama a la MISMA acción que los dos modales (misma clave de caché, para no
 * montar una segunda lista que pueda discrepar), así que `bloqueadosIds` le llega. Y no lo lee.
 *
 * POR QUÉ, y por qué hace falta un test que lo fije: filtrar no es asignar. Esconder o apagar a un
 * mensajero bloqueado en el FILTRO volvería inalcanzables las órdenes que ya tiene en la mano —que
 * son justamente las que hay que mirar cuando está bloqueado—. El bloqueo prohíbe DARLE trabajo
 * nuevo, no VER el que lleva.
 *
 * Sin estos dos casos, el próximo lector ve que los dos modales sí lo aplican, concluye que aquí
 * falta y lo «arregla». Es la clase de arreglo que no rompe ningún test y no da ningún síntoma.
 */
describe("271/R33 · el filtro de mensajero del listado NO lo aplica", () => {
  const CATALOGO: CatalogoFiltrosOrdenesDTO = {
    mensajeros: [],
    zonas: [],
    tiendas: [],
    provincias: [],
    cantones: [],
    distritos: [],
  };

  it("ofrece a TODOS los mensajeros servidos, y ninguno deshabilitado", () => {
    const defs = construirFiltrosEntregas(CATALOGO, MENSAJEROS);
    const mensajero = defs.find((f) => f.label === "Mensajero");

    // El bloqueado sigue en la lista, con su nombre limpio: ni motivo entre paréntesis ni marca.
    expect(mensajero?.options).toEqual([
      { value: "m1", label: "Ana Mensajera" },
      { value: "m2", label: "Beto Mensajero" },
    ]);
  });

  it("guardia: `FiltrosEntregas.tsx` no LEE `bloqueadosIds` en ninguna línea de código", () => {
    // La aserción de arriba se quedaría verde si alguien añadiera el recorte dentro del fetcher,
    // que es por donde entraría de verdad. Ésta mira el archivo: la palabra sólo puede aparecer en
    // comentarios —donde está escrito POR QUÉ no se lee—, nunca en código.
    const fuente = readFileSync("app/(app)/_components/FiltrosEntregas.tsx", "utf8");
    const codigo = fuente
      .split("\n")
      .filter((linea) => {
        const t = linea.trim();
        return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
      })
      .join("\n");

    expect(codigo).not.toMatch(/bloqueadosIds/);
    // Anti-vacuidad: si el archivo se renombrara o se vaciara, esto lo delata.
    expect(codigo).toMatch(/listarMensajerosParaAsignacion/);
  });
});
