// @vitest-environment jsdom
// FICHA 454 (T2.4, R31) — el rastreo público pinta la gestión PENDIENTE de confirmar.
//
// El servidor (`RastreoPublicoService`, T1.19) añade al final de la línea el resultado de la gestión
// registrada y lo marca `pendiente: true`. El modal lo lee como «<Resultado> · pendiente de
// confirmación» —formato único decidido por el humano el 2026-09-23, con PUNTO MEDIO— en la línea
// y en la cabecera (el vigente ES la última entrada, R20). Sin la marca, se pinta tal cual.
//
// Los textos esperados se escriben A MANO: compararlos con la función que los genera los dejaría
// verdes con cualquier contenido.
//
// ⏳ 2026-09-24 (FICHA 455, T1.9/T2.8; design §4; R31-R34): el rastreo deja de publicar HITOS. Cada
// entrada es el NOMBRE VISIBLE del estado (el mismo de la app interna) y la pendiente, el del
// resultado («Entregado», «Devolución a origen por rechazo»). Se suman dos casos: la línea con los
// 20 nombres y un estado retirado plegado a su equivalente, proyectados por el SERVICIO REAL (con un
// repositorio doble) y pintados por el modal — que es lo que el destinatario ve de punta a punta.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { LandingNav } from "@/app/_landing/LandingNav";
import { consultarRastreoPublico } from "@/lib/actions/rastreo-publico";
import type { TransicionRastreoFila } from "@/lib/interfaces/repositories/IRastreoPublicoRepository";
import { RastreoPublicoService } from "@/lib/services/RastreoPublicoService";
import { ORDER_STATUS_SEED } from "@/lib/types/order-status";
import type { ResultadoRastreoPublico } from "@/lib/types/rastreo-publico";

vi.mock("@/lib/actions/rastreo-publico", () => ({
  consultarRastreoPublico: vi.fn(),
}));

const consultarMock = vi.mocked(consultarRastreoPublico);

const CON_PENDIENTE: ResultadoRastreoPublico = {
  estado: "ok",
  envio: {
    numGuia: 4321,
    nombreVigente: "Entregado",
    actualizadoEn: "2026-09-23T15:00-06:00",
    linea: [
      { nombre: "En preparación", fecha: "2026-09-21T18:05-06:00" },
      { nombre: "En reparto", fecha: "2026-09-23T07:40-06:00" },
      { nombre: "Entregado", fecha: "2026-09-23T15:00-06:00", pendiente: true },
    ],
  },
};

/** Devolución a origen por rechazo pendiente: el nombre es el del resultado, entero. */
const RECHAZO_PENDIENTE: ResultadoRastreoPublico = {
  estado: "ok",
  envio: {
    numGuia: 4321,
    nombreVigente: "Devolución a origen por rechazo",
    actualizadoEn: "2026-09-23T15:00-06:00",
    linea: [
      { nombre: "En preparación", fecha: "2026-09-21T18:05-06:00" },
      { nombre: "En reparto", fecha: "2026-09-23T07:40-06:00" },
      { nombre: "Devolución a origen por rechazo", fecha: "2026-09-23T15:00-06:00", pendiente: true },
    ],
  },
};

const SIN_PENDIENTE: ResultadoRastreoPublico = {
  estado: "ok",
  envio: {
    numGuia: 4321,
    nombreVigente: "Entregado",
    actualizadoEn: "2026-09-24T09:00-06:00",
    linea: [
      { nombre: "En preparación", fecha: "2026-09-21T18:05-06:00" },
      { nombre: "En reparto", fecha: "2026-09-23T07:40-06:00" },
      { nombre: "Entregado", fecha: "2026-09-24T09:00-06:00" },
    ],
  },
};

/** Los 20 nombres visibles, escritos A MANO en el orden del catálogo (requirements 455 §0.1). */
const VEINTE_NOMBRES = [
  "Entregado",
  "Novedad",
  "Devolviendo a tienda",
  "Reprogramado",
  "En ruta a bodega central",
  "En bodega central",
  "En preparación",
  "Mensajero recogiendo en la bodega",
  "En ruta a bodega satélite",
  "En reparto",
  "Devolución a origen por rechazo",
  "En bodega satélite",
  "Devuelta a tienda",
  "Novedad interna",
  "Por devolver a bodega central",
  "Devolviendo a bodega central",
  "Por devolver a tienda",
  "Por recolectar en tienda",
  "Incidente",
  "Recolectando",
];

/** Proyecta un historial con el SERVICIO REAL (repositorio doble) y devuelve lo que publicaría. */
async function proyectarConElServicio(
  transiciones: readonly TransicionRastreoFila[],
): Promise<ResultadoRastreoPublico> {
  const servicio = new RastreoPublicoService(
    {
      buscarPorGuia: async () => ({
        id: "orden-interna",
        numGuia: 4321,
        telefonoDest: "8712-8899",
        deletedAt: null,
      }),
      listarTransiciones: async () => transiciones,
      buscarGestionPendiente: async () => null,
    },
    { RATE_MAX: 100, RATE_WINDOW_MINUTES: 10, DIGITOS_SEGUNDO_FACTOR: 4, ZONA_HORARIA: "UTC" },
  );
  return servicio.consultar(4321, "8899");
}

async function consultarCon(resultado: ResultadoRastreoPublico) {
  consultarMock.mockResolvedValue(resultado);
  const user = userEvent.setup();
  render(<LandingNav />);
  await user.click(screen.getByRole("button", { name: /Rastrear envío/ }));
  const modal = await screen.findByRole("dialog");
  await user.type(within(modal).getByLabelText("Número de guía"), "4321");
  await user.type(within(modal).getByLabelText("Últimos 4 dígitos del teléfono"), "8899");
  await user.click(within(modal).getByRole("button", { name: /Consultar/ }));
  await within(modal).findByText(/Guía 4321/);
  return modal;
}

beforeEach(() => {
  vi.clearAllMocks();
  document.documentElement.className = "";
});

afterEach(() => {
  cleanup();
  document.documentElement.className = "";
  window.history.replaceState(null, "", "/");
});

describe("454/R31 · 455/R33 — el rastreo público muestra la gestión pendiente de confirmar", () => {
  it("con gestión pendiente: la última entrada y la cabecera dicen «… · pendiente de confirmación»", async () => {
    const modal = await consultarCon(CON_PENDIENTE);

    expect(
      within(modal)
        .getAllByRole("listitem")
        .map((fila) => fila.textContent),
    ).toEqual([
      "En preparación2026-09-21 · 18:05",
      "En reparto2026-09-23 · 07:40",
      "Entregado · pendiente de confirmación2026-09-23 · 15:00",
    ]);
    // La cabecera (el vigente) lo dice igual: es la misma entrada (R20).
    expect(within(modal).getAllByText("Entregado · pendiente de confirmación")).toHaveLength(2);
  });

  it("rechazo pendiente: dice «Devolución a origen por rechazo · pendiente de confirmación»", async () => {
    const modal = await consultarCon(RECHAZO_PENDIENTE);

    expect(within(modal).getAllByRole("listitem").at(-1)?.textContent).toBe(
      "Devolución a origen por rechazo · pendiente de confirmación2026-09-23 · 15:00",
    );
    expect(
      within(modal).getAllByText("Devolución a origen por rechazo · pendiente de confirmación"),
    ).toHaveLength(2);
    // Ningún nombre retirado del resultado (§0.3 de la 455).
    expect(within(modal).queryByText(/Rechazada|No entregado/)).toBeNull();
  });

  it("sin gestión pendiente (ya aprobada): el nombre se lee tal cual, sin la coletilla", async () => {
    const modal = await consultarCon(SIN_PENDIENTE);

    expect(within(modal).queryByText(/pendiente de confirmación/)).toBeNull();
    expect(within(modal).getAllByText("Entregado")).toHaveLength(2);
  });

  it("no expone nada del mensajero ni del motivo: solo el nombre y la fecha", async () => {
    const modal = await consultarCon(CON_PENDIENTE);
    const ultima = within(modal).getAllByRole("listitem").at(-1) as HTMLElement;
    expect(ultima.textContent).toBe("Entregado · pendiente de confirmación2026-09-23 · 15:00");
  });
});

describe("455/R31 · R34 · T2.8 — el destinatario ve los mismos nombres que la app interna", () => {
  it("un historial por los 20 estados se pinta con los 20 nombres, en orden, sin ningún código", async () => {
    const transiciones = ORDER_STATUS_SEED.map((estatusValue, i) => ({
      createdAt: new Date(Date.UTC(2026, 0, 1 + i, 15, 0, 0)),
      estatusValue,
    }));
    const modal = await consultarCon(await proyectarConElServicio(transiciones));

    const filas = within(modal).getAllByRole("listitem");
    expect(filas).toHaveLength(20);
    expect(filas.map((f) => f.textContent?.replace(/\d{4}-\d{2}-\d{2} · \d{2}:\d{2}$/, ""))).toEqual(
      VEINTE_NOMBRES,
    );
    // La cabecera es el último estado.
    expect(within(modal).getAllByText("Recolectando")).toHaveLength(2);
    // Ningún código (vigente) cruza a la pantalla.
    for (const codigo of ORDER_STATUS_SEED) expect(modal.textContent).not.toContain(codigo);
  });

  it("una fila histórica de un estado RETIRADO se pinta con el nombre de su equivalente, fundida", async () => {
    const modal = await consultarCon(
      await proyectarConElServicio([
        { createdAt: new Date(Date.UTC(2026, 0, 1, 15)), estatusValue: "en_bodega_central" },
        { createdAt: new Date(Date.UTC(2026, 0, 2, 15)), estatusValue: "en_reparto" },
        { createdAt: new Date(Date.UTC(2026, 0, 2, 17)), estatusValue: "ayuda_tienda" },
        { createdAt: new Date(Date.UTC(2026, 0, 3, 15)), estatusValue: "devolucion_por_confirmar" },
      ]),
    );

    expect(
      within(modal)
        .getAllByRole("listitem")
        .map((fila) => fila.textContent),
    ).toEqual([
      "En bodega central2026-01-01 · 15:00",
      "En reparto2026-01-02 · 15:00",
      "Novedad2026-01-03 · 15:00",
    ]);
    expect(modal.textContent).not.toMatch(/ayuda_tienda|devolucion_por_confirmar|estado retirado/);
  });
});
