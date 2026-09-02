// @vitest-environment jsdom
//
// El botón «Actualizar» de la analítica (pedido humano 2026-08-19).
//
// Lo que estos casos protegen es el ORDEN, que es lo único delicado de este control: primero se
// tira la cache del servidor y DESPUÉS se vuelve a pedir. Al revés —o sin el primer paso— el
// botón es decorativo dentro de la ventana del TTL: las cifras se sirven de una cache de 15
// minutos, así que volver a pedirlas sin invalidar devuelve el mismo valor y el mismo sello, y
// la pantalla afirma haber traído algo fresco que no trajo.
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";

import {
  ActualizarAnalitica,
  ETIQUETA_ACTUALIZAR,
  textoSello,
} from "@/app/(app)/analitica/_components/entregas/ActualizarAnalitica";
import { monedaConfig } from "@/lib/config/moneda";

import { quitarComentarios } from "../fixtures/sin-comentarios";
import { ConteoEntregasAnillo } from "@/app/(app)/analitica/_components/entregas/ConteoEntregasAnillo";
import { ProductosTabla } from "@/app/(app)/analitica/_components/entregas/ProductosTabla";
import { FiltroEntregasProvider } from "@/app/(app)/_components/filtro-entregas";
import { ToastProvider } from "@/providers/ToastProvider";
import { TEXTO_PROHIBIDO } from "@/app/(app)/analitica/_components/operativo/textos";
import { refrescarCacheAnalitica } from "@/lib/actions/analitica-refrescar";
import { consultarConteoEntregas } from "@/lib/actions/conteo-entregas";
import { consultarConteoProductos } from "@/lib/actions/conteo-productos";
import type { ConteoEntregasDTO } from "@/lib/types/conteo-entregas";

vi.mock("@/lib/actions/analitica-refrescar", () => ({
  refrescarCacheAnalitica: vi.fn(),
}));
vi.mock("@/lib/actions/conteo-entregas", () => ({
  consultarConteoEntregas: vi.fn(),
}));
// FICHA 345 (T7.5) — la septima lectura viva de la seccion. Se mockea para poder AFIRMAR sobre
// sus llamadas: el punto del caso de mas abajo es cuantas veces se consulta, no que consulte.
vi.mock("@/lib/actions/conteo-productos", () => ({
  consultarConteoProductos: vi.fn(),
}));

const refrescarMock = vi.mocked(refrescarCacheAnalitica);
const consultarMock = vi.mocked(consultarConteoEntregas);
const productosMock = vi.mocked(consultarConteoProductos);

/** Dos instantes distintos: la lectura que ya estaba y la que trae el refresco. */
const LECTURA_VIEJA = "2026-08-17T18:30:00.000Z";
const LECTURA_NUEVA = "2026-08-19T20:45:00.000Z";

function datos(lastSync: string): ConteoEntregasDTO {
  return {
    porDesenlace: {
      entregada: 3,
      devuelta: 0,
      rechazada: 0,
      reprogramada: 0,
      incidente: 0,
      otros: 0,
    },
    total: 3,
    lastSync,
  };
}

/** El botón solo, con su propia caché de SWR por test. */
function renderBoton() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ActualizarAnalitica />
    </SWRConfig>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  refrescarMock.mockResolvedValue({ status: "ok", lastSyncAt: "2026-08-19T12:00:00.000Z" });
});
afterEach(cleanup);

/**
 * La hora que el sello DEBE decir para un instante dado: la de la zona del sistema donde corre
 * (pedido humano 2026-08-19), no la de ninguna zona escrita a mano.
 *
 * Se deriva con `Intl` sin `timeZone` —igual que el componente— y no con un literal «12:30»:
 * un literal ataría la suite a la zona de la máquina que la escribió y la pondría roja en
 * cualquier otra, que es exactamente el defecto que este cambio corrige.
 */
function horaDelSistema(iso: string): string {
  return new Intl.DateTimeFormat(monedaConfig.locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

describe("Actualizar analítica — el sello", () => {
  it("formatea `lastSync` en la hora del sistema, con el formato del sello", () => {
    expect(textoSello("2026-08-17T18:30:00.000Z")).toBe(
      `Actualizado ${horaDelSistema("2026-08-17T18:30:00.000Z")}`,
    );
    expect(textoSello("2026-08-17T18:30:00.000Z")).toMatch(/^Actualizado \d{2}:\d{2}$/);
  });

  // El censo que de verdad protege el pedido: la aserción de arriba pasaría igual con
  // `timeZone: "America/Costa_Rica"` incrustado SI la máquina que corre la suite estuviera en
  // esa zona —y la que lo escribió lo está—. Lo que no puede pasar es que el componente vuelva
  // a fijar una zona o un idioma a mano.
  it("no fija ninguna zona horaria ni ningún locale a mano", () => {
    const fuente = quitarComentarios(
      readFileSync(
        path.join(
          process.cwd(),
          "app",
          "(app)",
          "analitica",
          "_components",
          "entregas",
          "ActualizarAnalitica.tsx",
        ),
        "utf8",
      ),
    );

    expect(fuente, "sin `timeZone`: la zona la pone el sistema").not.toMatch(/timeZone/);
    // El locale sale de `monedaConfig` (`MONEDA_LOCALE`), como en el resto del formateo del
    // repo; un literal aquí sería el mismo pecado con otro nombre.
    expect(fuente, "sin literal de idioma").not.toMatch(/["'][a-z]{2}-[A-Z]{2}["']/);
    expect(fuente).toMatch(/monedaConfig\.locale/);
  });

  // Sin lectura todavía no se inventa una hora NI se deja el hueco en blanco: un rótulo vacío
  // se lee como «esto se actualiza solo».
  it("dice que no lo sabe cuando aún no hay lectura", () => {
    expect(textoSello(null)).toBe("Actualizado —");
    expect(textoSello("no es una fecha")).toBe("Actualizado —");
  });

  it("pinta el sello del DTO, no la hora del render", async () => {
    consultarMock.mockResolvedValue({ status: "ok", datos: datos(LECTURA_VIEJA) });
    renderBoton();

    expect(await screen.findByText(textoSello(LECTURA_VIEJA))).toBeInTheDocument();
  });
});

describe("Actualizar analítica — qué hace el clic", () => {
  it("invalida la cache del servidor ANTES de volver a consultar", async () => {
    consultarMock.mockResolvedValue({ status: "ok", datos: datos(LECTURA_VIEJA) });
    renderBoton();
    await screen.findByText(textoSello(LECTURA_VIEJA));

    const consultasAntes = consultarMock.mock.calls.length;
    // El orden se comprueba con un registro compartido, no con dos `toHaveBeenCalled` sueltos:
    // aquéllos pasarían igual con las llamadas al revés.
    const orden: string[] = [];
    refrescarMock.mockImplementation(async () => {
      orden.push("invalidar");
      return { status: "ok", lastSyncAt: "2026-08-19T12:00:00.000Z" };
    });
    consultarMock.mockImplementation(async () => {
      orden.push("consultar");
      return { status: "ok", datos: datos("2026-08-19T12:00:01.000Z") };
    });

    await userEvent.click(screen.getByRole("button", { name: new RegExp(ETIQUETA_ACTUALIZAR) }));

    await waitFor(() => expect(consultarMock.mock.calls.length).toBeGreaterThan(consultasAntes));
    expect(orden[0]).toBe("invalidar");
    expect(orden).toContain("consultar");
  });

  it("el sello avanza a la lectura nueva", async () => {
    consultarMock.mockResolvedValue({ status: "ok", datos: datos(LECTURA_VIEJA) });
    renderBoton();
    await screen.findByText(textoSello(LECTURA_VIEJA));

    consultarMock.mockResolvedValue({ status: "ok", datos: datos(LECTURA_NUEVA) });
    await userEvent.click(screen.getByRole("button", { name: new RegExp(ETIQUETA_ACTUALIZAR) }));

    expect(await screen.findByText(textoSello(LECTURA_NUEVA))).toBeInTheDocument();
  });

  // Un «no puedes» NO se pinta como un refresco correcto: el usuario se quedaría con las cifras
  // viejas creyendo que son nuevas, que es justo la mentira que este botón existe para evitar.
  it("dice que no si la acción deniega, y no vuelve a consultar", async () => {
    consultarMock.mockResolvedValue({ status: "ok", datos: datos(LECTURA_VIEJA) });
    renderBoton();
    await screen.findByText(textoSello(LECTURA_VIEJA));
    const consultasAntes = consultarMock.mock.calls.length;

    refrescarMock.mockResolvedValue({ status: "forbidden" });
    await userEvent.click(screen.getByRole("button", { name: new RegExp(ETIQUETA_ACTUALIZAR) }));

    expect(await screen.findByText(TEXTO_PROHIBIDO)).toBeInTheDocument();
    expect(consultarMock.mock.calls.length).toBe(consultasAntes);
  });

  // La razón por la que la clave vive en `conteo-entregas-swr` y no escrita en cada componente:
  // el sello del botón tiene que ser el de la consulta que hay EN PANTALLA. Si las dos claves se
  // separaran, habría dos peticiones y dos frescuras para el mismo número.
  it("comparte entrada de SWR con el anillo: una sola consulta para los dos", async () => {
    consultarMock.mockResolvedValue({ status: "ok", datos: datos(LECTURA_VIEJA) });
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <ActualizarAnalitica />
        <ConteoEntregasAnillo />
      </SWRConfig>,
    );

    await screen.findByText(textoSello(LECTURA_VIEJA));
    await waitFor(() => expect(consultarMock).toHaveBeenCalledTimes(1));
  });
});

/* ==========================================================================
 * FICHA 345 (T7.5, R42) — el refresco alcanza también a la tabla de productos
 * ========================================================================== */

describe("Actualizar analítica — la séptima lectura entra sola (ficha 345)", () => {
  // R42. El botón NO conoce esta lectura y no tiene por qué: revalida por PREFIJO
  // (`mutate((clave) => clave[0] === CLAVE_TABLERO)`). El caso mide justo eso: que la clave de
  // productos comparte prefijo. Escribir el prefijo a mano en `productos-swr.ts` en vez de
  // importarlo dejaría la tabla fuera del refresco el día que la constante cambie, en silencio
  // — el usuario pulsaría «Actualizar» y esta tabla seguiría enseñando lo de hace un cuarto de
  // hora, que es exactamente la mentira que este botón existe para evitar.
  it("pulsar «Actualizar» vuelve a consultar la tabla de productos", async () => {
    consultarMock.mockResolvedValue({ status: "ok", datos: datos(LECTURA_VIEJA) });
    productosMock.mockResolvedValue({
      status: "ok",
      datos: {
        filas: [
          {
            tiendaId: "t1",
            tienda: "Tienda Uno",
            producto: "Dr Melaxin",
            unidades: 3,
            ordenes: 3,
            porStatus: [{ status: "entregada", conteo: 3 }],
            // FICHA 347 — este caso mide el REFRESCO, no el dinero: la lectura llega sin
            // concesion, que es tambien la forma que ve un rol sin dinero concedido (R6).
            ordenesAcompanadas: 0,
            dinero: null,
          },
        ],
        ordenes: 3,
        ordenesSinProducto: 0,
        dinero: { estado: "denegado" },
        lastSync: LECTURA_VIEJA,
      },
    });

    render(
      <ToastProvider>
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
          <FiltroEntregasProvider>
            <ActualizarAnalitica />
            <ProductosTabla />
          </FiltroEntregasProvider>
        </SWRConfig>
      </ToastProvider>,
    );

    await screen.findByText("Dr Melaxin");
    await waitFor(() => expect(productosMock).toHaveBeenCalledTimes(1));

    await userEvent.click(screen.getByRole("button", { name: new RegExp(ETIQUETA_ACTUALIZAR) }));

    await waitFor(() => expect(productosMock).toHaveBeenCalledTimes(2));
    // Y sigue siendo el MISMO botón que invalida la caché del servidor primero: sin eso, la
    // segunda consulta se serviría de la entrada de 15 minutos y devolvería lo mismo.
    expect(refrescarMock).toHaveBeenCalledTimes(1);
  });
});
