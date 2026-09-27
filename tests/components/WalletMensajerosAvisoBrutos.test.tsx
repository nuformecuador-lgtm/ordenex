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
}));
vi.mock("@/lib/actions/estado-cuenta", () => ({ verEstadoCuentaAction: vi.fn(async () => ({ status: "forbidden" })) }));
vi.mock("@/lib/actions/como-quedo", () => ({ comoQuedoAction: vi.fn() }));
vi.mock("@/lib/actions/wallet-comprobante", () => ({ verComprobanteAction: vi.fn(), adjuntarComprobanteAction: vi.fn() }));
vi.mock("@/lib/actions/wallet-anulacion", () => ({ anularMovimientoAction: vi.fn() }));

import { ToastProvider } from "@/providers/ToastProvider";
import { CuentasPorPagarTable } from "@/app/(app)/wallet/mensajeros/_components/CuentasPorPagarTable";
import { EstadoCuentaMensajero } from "@/app/(app)/wallet/mensajeros/_components/EstadoCuentaMensajero";
import { estado } from "@/tests/fixtures/estado-cuenta";

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

  // FICHA 458-D (T D.8, D14): la CABECERA del desglose (con su salvedad pegada a «Total devengado» y
  // «Total pagado») se retiró con el desplegable. Su sustituto, el ESTADO DE CUENTA, ya no enseña
  // importes brutos: abonos y cargos del periodo son NETOS (D3 de la 458, el servidor excluye los pares
  // anulados) y el saldo es la cuenta por pagar. No hay nada que salvar: la salvedad NO aparece allí.
  it("el ESTADO DE CUENTA del mensajero no repite la salvedad: sus cifras ya son netas (D3)", () => {
    envolver(
      <EstadoCuentaMensajero
        inicial={estado({
          tipo: "mensajero",
          nombre: "Ana Mensajera",
          saldoActual: "50000.00",
          abonos: "70000.00",
          cargos: "20000.00",
          saldoFinal: "50000.00",
          filas: [],
          total: 0,
        })}
        puedeRegistrar={false}
      />,
    );
    expect(screen.queryAllByRole("note")).toHaveLength(0);
    expect(document.body.textContent ?? "").not.toMatch(/Incluye los pagos anulados|ese es el número correcto/);
    // Las cifras son las del SERVIDOR, tal cual (R22 lo afirma él).
    const tarjetas = screen.getByRole("region", { name: "Saldo de Ana Mensajera" });
    expect(within(tarjetas).getByText("₡70.000")).toBeInTheDocument();
    expect(within(tarjetas).getByText("₡20.000")).toBeInTheDocument();
  });

  it("la tabla de cuentas ya no despliega: el párrafo aparece UNA sola vez en su pantalla", () => {
    envolver(<CuentasPorPagarTable initialData={paginaInicial([RESUMEN])} />);
    expect(screen.queryByRole("button", { name: /Ver desglose/ })).toBeNull();
    expect(screen.getAllByRole("note")).toHaveLength(1);
  });

  it("el texto habla en lenguaje claro: ni jerga contable ni siglas", () => {
    envolver(<CuentasPorPagarTable initialData={paginaInicial([RESUMEN])} />);
    const deLaTabla = screen.getByRole("note").textContent ?? "";
    expect(deLaTabla.length).toBeGreaterThan(0);
    for (const palabra of JERGA) {
      expect(deLaTabla.toLowerCase()).not.toContain(palabra.toLowerCase());
    }
  });
});
