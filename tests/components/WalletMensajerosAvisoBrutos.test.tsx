// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
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
 */
vi.mock("@/lib/actions/wallet-mensajero", () => ({
  listarCuentasPorPagarCompletoAction: vi.fn(async () => ({
    status: "ok",
    items: [],
    total: 0,
  })),
  listarCuentasPorPagarPaginadoAction: vi.fn(async () => ({
    status: "ok",
    page: 1,
    pageSize: 25,
    items: [],
    total: 0,
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

/** Un mensajero con un pago ANULADO en medio: 50 000 devengados + 20 000 de reverso. */
const RESUMEN: CuentaPorPagarResumenDTO = {
  mensajeroId: "u1",
  mensajeroNombre: "Ana Mensajera",
  devengado: "70000.00",
  pagado: "20000.00",
  cuentaPorPagar: "50000.00",
  signo: "positivo",
};

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

  it("la CABECERA del desglose lleva el mismo aviso con SUS rótulos", () => {
    envolver(<DesglosePagosMensajero resumen={RESUMEN} id="desglose-u1" />);

    const avisos = screen.getAllByRole("note");
    expect(avisos).toHaveLength(1);

    const texto = avisos[0].textContent ?? "";
    expect(texto).toContain("«Total pagado»");
    expect(texto).toContain("«Total devengado»");
    expect(texto).toContain("«Cuenta por pagar»");
  });

  it("el aviso va junto a los importes agregados, NUNCA dentro de la tabla de movimientos", () => {
    // La asimetría dentro de la pantalla, afirmada: una lista de movimientos no necesita
    // aviso porque el pago y su reverso se ven los dos.
    envolver(<DesglosePagosMensajero resumen={RESUMEN} id="desglose-u1" />);

    const aviso = screen.getByRole("note");
    expect(aviso.closest("table")).toBeNull();

    // Y está en la misma sección que los tres importes, no colgando en otro sitio.
    const seccion = screen.getByRole("region", { name: "Desglose de Ana Mensajera" });
    expect(within(seccion).getByRole("note")).toBe(aviso);
    expect(within(seccion).getByText("₡70.000,00")).toBeInTheDocument();
    expect(within(seccion).getByText("₡20.000,00")).toBeInTheDocument();
    expect(within(seccion).getByText("₡50.000,00")).toBeInTheDocument();
  });

  it("los dos avisos hablan en lenguaje claro: ni jerga contable ni siglas", () => {
    envolver(<CuentasPorPagarTable initialData={paginaInicial([RESUMEN])} />);
    const deLaTabla = screen.getByRole("note").textContent ?? "";
    cleanup();

    envolver(<DesglosePagosMensajero resumen={RESUMEN} id="desglose-u1" />);
    const delDesglose = screen.getByRole("note").textContent ?? "";

    for (const texto of [deLaTabla, delDesglose]) {
      expect(texto.length).toBeGreaterThan(0);
      for (const palabra of JERGA) {
        expect(texto.toLowerCase()).not.toContain(palabra.toLowerCase());
      }
    }
  });
});
