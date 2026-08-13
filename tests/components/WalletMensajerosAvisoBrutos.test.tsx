// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup, fireEvent } from "@testing-library/react";
import { SWRConfig } from "swr";

import type { CuentaPorPagarResumenDTO } from "@/lib/types/wallet-mensajero";
import { paginaInicial } from "@/tests/fixtures/pagina-inicial";

/**
 * Feature 172 (T H.4) — el aviso de la limitación N1 en `/wallet/mensajeros`.
 *
 * Por qué existe este archivo y no una ampliación de `CuentasPorPagarTable.test.tsx`: aquella
 * suite es de la feature 44 y se deja intacta (mismo criterio que con la 171 y la 38 en las
 * tandas D–G). Lo que se mide aquí es una propiedad NUEVA de esa pantalla.
 *
 * La regla que se aplica (decisión del leader, cerrada en la Tanda G): el aviso hace falta
 * donde se muestre un IMPORTE AGREGADO que incluya lo anulado, y NO donde solo se listen
 * movimientos. Esta pantalla tiene DOS superficies con agregados —la tabla de cuentas, cuyas
 * columnas «Devengado» y «Pagado» son sumas brutas del libro, y la cabecera del desglose— y
 * una que no lo es: la tabla de movimientos del desglose, donde el pago y su reverso se ven
 * los dos y se explican solos.
 *
 * DEUDA 203 — la regla no cambia; cambia la FORMA en la segunda superficie. Hasta hoy las dos
 * pintaban el MISMO párrafo, y en pantalla se veían A LA VEZ (medido en la app el 2026-08-12,
 * con la primera fila desplegada: uno en y=181, otro en y=457, ventana de 900 px), más una copia
 * extra por cada fila abierta. Ahora el párrafo se pinta UNA sola vez —en la tabla, la única
 * superficie que se ve sin desplegar nada— y la cabecera del desglose lleva la salvedad pegada a
 * cada importe, que es lo que sigue en pantalla cuando el párrafo de la tabla queda arriba del
 * todo (con 25 filas de 42 px, desplegar la 19.ª lo saca de la ventana).
 *
 * Los cuatro casos de abajo miden ESO: que la información no se perdió y que el párrafo no se
 * repite.
 */

/**
 * Un mensajero con un pago ANULADO en medio: 50 000 devengados + 20 000 de reverso.
 *
 * Vive en un `vi.hoisted` porque la MISMA fila tiene que salir por dos vías: la página que el
 * Server Component pasa por props y la relectura que hace SWR al montar. Cuando el mock de la
 * relectura devolvía una lista VACÍA, la fila desaparecía en cuanto la promesa resolvía, y con
 * ella el desglose desplegado: el caso de la fila abierta pasaba en verde mirando una pantalla
 * que ya no tenía desglose. Medido: con la lista vacía, ese caso pasaba incluso con el párrafo
 * duplicado puesto a mano en el componente.
 */
const { RESUMEN } = vi.hoisted(() => {
  const resumen: CuentaPorPagarResumenDTO = {
    mensajeroId: "u1",
    mensajeroNombre: "Ana Mensajera",
    devengado: "70000.00",
    pagado: "20000.00",
    cuentaPorPagar: "50000.00",
    signo: "positivo",
  };
  return { RESUMEN: resumen };
});

vi.mock("@/lib/actions/wallet-mensajero", () => ({
  listarCuentasPorPagarCompletoAction: vi.fn(async () => ({
    status: "ok",
    items: [RESUMEN],
    total: 1,
  })),
  listarCuentasPorPagarPaginadoAction: vi.fn(async () => ({
    status: "ok",
    page: 1,
    pageSize: 25,
    items: [RESUMEN],
    total: 1,
  })),
  listarPagosDeMensajeroAction: vi.fn(async () => ({
    status: "ok",
    page: 1,
    pageSize: 25,
    total: 0,
    movimientos: [],
    cuenta: {
      devengado: "70000.00",
      pagado: "20000.00",
      cuentaPorPagar: "50000.00",
      signo: "positivo",
    },
  })),
  listarPagosDeMensajeroCompletoAction: vi.fn(async () => ({
    status: "ok",
    items: [],
    total: 0,
  })),
}));

import { ToastProvider } from "@/providers/ToastProvider";
import { CuentasPorPagarTable } from "@/app/(app)/wallet/mensajeros/_components/CuentasPorPagarTable";
import { DesglosePagosMensajero } from "@/app/(app)/wallet/mensajeros/_components/DesglosePagosMensajero";

/** Vocabulario que NO puede aparecer en pantalla: es nuestro, no del maestro. */
const JERGA = [
  "contraasiento",
  "neteo",
  "netear",
  "SLA",
  "ajuste_devengo",
  "liquidacion",
  "devengo",
];

function envolver(nodo: React.ReactNode) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToastProvider>{nodo}</ToastProvider>
    </SWRConfig>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("/wallet/mensajeros — el aviso de los importes brutos (N1)", () => {
  it("la TABLA de cuentas declara que «Devengado» y «Pagado» incluyen lo anulado", () => {
    envolver(<CuentasPorPagarTable initialData={paginaInicial([RESUMEN])} />);

    const avisos = screen.getAllByRole("note");
    expect(avisos).toHaveLength(1);

    const texto = avisos[0].textContent ?? "";
    // Nombra las DOS cifras infladas y dice cuál es la correcta, con los rótulos REALES de
    // las columnas: un renombrado arrastra el aviso en vez de dejarlo hablando de otra cifra.
    expect(texto).toContain("«Pagado»");
    expect(texto).toContain("«Devengado»");
    expect(texto).toContain("«Cuenta por pagar»");
    expect(texto).toMatch(/ese es el número correcto/);
  });

  it("la CABECERA del desglose lleva la salvedad PEGADA a cada importe, sin repetir el párrafo", () => {
    envolver(<DesglosePagosMensajero resumen={RESUMEN} id="desglose-u1" />);

    // El párrafo ya no se repite acá: era el mismo de la tabla, con los rótulos cambiados.
    expect(screen.queryAllByRole("note")).toHaveLength(0);

    // Pero la información NO se perdió: cada uno de los dos importes inflados dice qué incluye,
    // y el tercero —la resta— dice que es el correcto. Es lo que antes decía el párrafo, en el
    // sitio donde no puede quedarse fuera de pantalla.
    const seccion = screen.getByRole("region", { name: "Desglose de Ana Mensajera" });
    expect(
      within(seccion).getByText(/Incluye la devolución de los pagos anulados/),
    ).toBeInTheDocument();
    expect(within(seccion).getByText(/Incluye los pagos anulados/)).toBeInTheDocument();
    expect(
      within(seccion).getByText(/Es el número correcto: ya tiene descontado lo anulado/),
    ).toBeInTheDocument();
  });

  it("con el desglose ABIERTO, el párrafo sigue apareciendo UNA sola vez en la pantalla", async () => {
    // El defecto que cierra la deuda 203, reproducido tal cual se vio en la app: expandir la
    // fila montaba el desglose DEBAJO del aviso de la tabla y los dos párrafos quedaban a la
    // vista, diciendo lo mismo. Antes de este arreglo, este caso contaba 2.
    envolver(<CuentasPorPagarTable initialData={paginaInicial([RESUMEN])} />);

    fireEvent.click(screen.getByRole("button", { name: "Ver desglose de Ana Mensajera" }));
    await screen.findByRole("region", { name: "Desglose de Ana Mensajera" });

    // La fila sigue abierta cuando se cuenta: sin esto, la relectura de SWR podría haber
    // desmontado el desglose y el conteo diría «1» por no haber nada que contar.
    const seccion = screen.getByRole("region", { name: "Desglose de Ana Mensajera" });
    expect(within(seccion).getByText("₡50.000,00")).toBeInTheDocument();

    const avisos = screen.getAllByRole("note");
    expect(avisos).toHaveLength(1);
    // Y el que queda es el de la TABLA: habla de «Pagado», no de «Total pagado».
    expect(avisos[0].textContent).toContain("«Pagado»");
    expect(avisos[0].textContent).not.toContain("«Total pagado»");
    expect(seccion.contains(avisos[0])).toBe(false);
  });

  it("la salvedad va junto a los importes agregados, NUNCA dentro de la tabla de movimientos", () => {
    // La asimetría dentro de la pantalla, afirmada: una lista de movimientos no necesita
    // aviso porque el pago y su reverso se ven los dos.
    envolver(<DesglosePagosMensajero resumen={RESUMEN} id="desglose-u1" />);

    const seccion = screen.getByRole("region", { name: "Desglose de Ana Mensajera" });
    const salvedad = within(seccion).getByText(/Incluye los pagos anulados/);
    expect(salvedad.closest("table")).toBeNull();

    // Y está en la misma sección que los tres importes, no colgando en otro sitio.
    expect(within(seccion).getByText("₡70.000,00")).toBeInTheDocument();
    expect(within(seccion).getByText("₡20.000,00")).toBeInTheDocument();
    expect(within(seccion).getByText("₡50.000,00")).toBeInTheDocument();
  });

  it("los dos textos hablan en lenguaje claro: ni jerga contable ni siglas", () => {
    envolver(<CuentasPorPagarTable initialData={paginaInicial([RESUMEN])} />);
    const deLaTabla = screen.getByRole("note").textContent ?? "";
    cleanup();

    envolver(<DesglosePagosMensajero resumen={RESUMEN} id="desglose-u1" />);
    const seccion = screen.getByRole("region", { name: "Desglose de Ana Mensajera" });
    // Las tres pistas del desglose, que son donde vive ahora la salvedad.
    const delDesglose = [
      /Incluye la devolución de los pagos anulados/,
      /Incluye los pagos anulados/,
      /Es el número correcto: ya tiene descontado lo anulado/,
    ]
      .map((patron) => within(seccion).getByText(patron).textContent ?? "")
      .join(" ");

    for (const texto of [deLaTabla, delDesglose]) {
      expect(texto.length).toBeGreaterThan(0);
      for (const palabra of JERGA) {
        expect(texto.toLowerCase()).not.toContain(palabra.toLowerCase());
      }
    }
  });
});
