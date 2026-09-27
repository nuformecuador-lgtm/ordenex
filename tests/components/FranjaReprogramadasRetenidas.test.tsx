// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import type { ReactNode } from "react";

import { FranjaReprogramadasRetenidas } from "@/app/(app)/ordenes/_components/FranjaReprogramadasRetenidas";
import type {
  CierreQueRetiene,
  MensajeroSinCierre,
  ResumenRetenidas,
} from "@/lib/interfaces/services/IReprogramadasRetenidasService";

// `next/link` como `<a>` plano: aquí se afirma el `href`, no la navegación.
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

/**
 * FICHA 462 (T3.4, S4, R32-R35, R38) — LA FRANJA DE `/ordenes`.
 *
 * Los tres textos (R32/R34), singular y plural, ESCRITOS A MANO; la lista de cierres con el uuid SOLO
 * en el `href` (R33); nada con 0 o `null` (R35/R37); «cierre del día» con jornada nula (271/R60).
 * Vocabulario decidido por el leader el 2026-09-25: el PAQUETE en masculino; ni una «reprogramadas».
 *
 * MUTACIÓN OBLIGATORIA (una por superficie, `progress/impl_462_frontend.md`): contar en M también a
 * las «sin cierre» (M = cierres.length + sinCierre.length) pone ROJO «faltan 2 cierres» y «1 de ellos».
 */

const UUID_A = "6f1c2b6e-1111-4a2b-9c3d-000000000001";
const UUID_B = "6f1c2b6e-2222-4a2b-9c3d-000000000002";

function cierre(over: Partial<CierreQueRetiene> & { cierreId: string }): CierreQueRetiene {
  return {
    mensajeroId: `m-${over.cierreId}`,
    mensajeroNombre: "Ana Pérez",
    estado: "solicitado",
    jornadaCR: "2026-09-24",
    ambito: { tipo: "central" },
    cuantas: 1,
    ...over,
  };
}

function sinCierre(cuantas: number, mensajeroId = "m-sc"): MensajeroSinCierre {
  return { mensajeroId, mensajeroNombre: "Dani Soto", ambito: { tipo: "central" }, cuantas };
}

function resumen(over: Partial<ResumenRetenidas> = {}): ResumenRetenidas {
  const cierres = over.cierres ?? [];
  const sin = over.sinCierre ?? [];
  const total =
    over.total ?? cierres.reduce((a, c) => a + c.cuantas, 0) + sin.reduce((a, s) => a + s.cuantas, 0);
  return { diaCR: "2026-09-25", total, porForma: { reprogramado: total, enReparto: 0 }, cierres, sinCierre: sin, ...over };
}

const REGION = "Paquetes reprogramados para hoy que esperan un cierre";

afterEach(cleanup);

describe("462/R35/R37 — sin retenidas o sin lectura, NO hay franja", () => {
  it("`null` → nada; total 0 → nada", () => {
    const a = render(<FranjaReprogramadasRetenidas resumen={null} />);
    expect(a.container).toBeEmptyDOMElement();
    cleanup();
    const b = render(<FranjaReprogramadasRetenidas resumen={resumen()} />);
    expect(b.container).toBeEmptyDOMElement();
    expect(screen.queryByRole("region")).toBeNull();
  });
});

describe("462/R32 — la frase principal con cierres que aprobar", () => {
  it("⭑ singular: «Hay 1 paquete reprogramado para hoy que todavía no puedes asignar: falta 1 cierre por aprobar.»", () => {
    render(
      <FranjaReprogramadasRetenidas
        resumen={resumen({ cierres: [cierre({ cierreId: UUID_A, cuantas: 1 })] })}
      />,
    );
    const region = screen.getByRole("region", { name: REGION });
    expect(
      within(region).getByText(
        "Hay 1 paquete reprogramado para hoy que todavía no puedes asignar: falta 1 cierre por aprobar.",
      ),
    ).toBeInTheDocument();
    // Sin «sin cierre», la frase de las K no existe.
    expect(within(region).queryByText(/de ellos/)).toBeNull();
  });

  it("⭑ plural con K: «Hay 4 paquetes … faltan 2 cierres por aprobar.» + «1 de ellos es de un mensajero que todavía no envió su cierre.»", () => {
    render(
      <FranjaReprogramadasRetenidas
        resumen={resumen({
          cierres: [cierre({ cierreId: UUID_A, cuantas: 2 }), cierre({ cierreId: UUID_B, cuantas: 1, mensajeroNombre: "Beto Mora" })],
          sinCierre: [sinCierre(1)],
        })}
      />,
    );
    const region = screen.getByRole("region", { name: REGION });
    expect(
      within(region).getByText(
        "Hay 4 paquetes reprogramados para hoy que todavía no puedes asignar: faltan 2 cierres por aprobar.",
      ),
    ).toBeInTheDocument();
    const k = within(region).getByText("1 de ellos es de un mensajero que todavía no envió su cierre.");
    // R34: las K no llevan enlace de detalle.
    expect(k.querySelector("a")).toBeNull();
  });

  it("K plural: «3 de ellos son de mensajeros que todavía no enviaron su cierre.»", () => {
    render(
      <FranjaReprogramadasRetenidas
        resumen={resumen({ cierres: [cierre({ cierreId: UUID_A, cuantas: 2 })], sinCierre: [sinCierre(2), sinCierre(1, "m-2")] })}
      />,
    );
    expect(screen.getByText("3 de ellos son de mensajeros que todavía no enviaron su cierre.")).toBeInTheDocument();
    expect(
      screen.getByText("Hay 5 paquetes reprogramados para hoy que todavía no puedes asignar: falta 1 cierre por aprobar."),
    ).toBeInTheDocument();
  });
});

describe("462/R34 — todas sin cierre (M = 0)", () => {
  it("⭑ varios mensajeros: «…: sus mensajeros todavía no enviaron el cierre.», sin lista y sin frase de K", () => {
    render(<FranjaReprogramadasRetenidas resumen={resumen({ sinCierre: [sinCierre(2), sinCierre(1, "m-2")] })} />);
    const region = screen.getByRole("region", { name: REGION });
    expect(
      within(region).getByText(
        "Hay 3 paquetes reprogramados para hoy que todavía no puedes asignar: sus mensajeros todavía no enviaron el cierre.",
      ),
    ).toBeInTheDocument();
    expect(within(region).queryByRole("list")).toBeNull();
    expect(within(region).queryByText(/de ellos/)).toBeNull();
    // El único enlace es el atajo.
    expect(within(region).getAllByRole("link")).toHaveLength(1);
  });

  it("un solo mensajero: «Hay 1 paquete … : su mensajero todavía no envió el cierre.»", () => {
    render(<FranjaReprogramadasRetenidas resumen={resumen({ sinCierre: [sinCierre(1)] })} />);
    expect(
      screen.getByText(
        "Hay 1 paquete reprogramado para hoy que todavía no puedes asignar: su mensajero todavía no envió el cierre.",
      ),
    ).toBeInTheDocument();
  });
});

describe("462/R33/R16 — la lista de cierres y el atajo", () => {
  it("⭑ una línea por cierre, enlazada a su detalle con el uuid SOLO en el href; el texto lleva mensajero · jornada · estado · cuántos", () => {
    render(
      <FranjaReprogramadasRetenidas
        resumen={resumen({
          cierres: [
            cierre({ cierreId: UUID_A, cuantas: 2, jornadaCR: "2026-09-24", estado: "solicitado" }),
            cierre({ cierreId: UUID_B, cuantas: 1, jornadaCR: null, estado: "vencido", mensajeroNombre: "Beto Mora" }),
          ],
        })}
      />,
    );
    const region = screen.getByRole("region", { name: REGION });
    const items = within(region).getAllByRole("listitem");
    expect(items).toHaveLength(2);

    const a = within(items[0]).getByRole("link", { name: "Ana Pérez · 24 de septiembre · Solicitado · retiene 2 paquetes" });
    expect(a).toHaveAttribute("href", `/cierres-admin?cierre=${UUID_A}`);
    // 271/R60: sin jornada fiable, «cierre del día»; nunca una fecha inventada.
    const b = within(items[1]).getByRole("link", { name: "Beto Mora · cierre del día · Vencido · retiene 1 paquete" });
    expect(b).toHaveAttribute("href", `/cierres-admin?cierre=${UUID_B}`);

    // R33/R52: ningún identificador interno visible.
    expect(region.textContent).not.toContain(UUID_A);
    expect(region.textContent).not.toContain(UUID_B);
    expect(region.textContent).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i);

    // R16: el atajo, con la misma etiqueta que el aviso de la campana.
    expect(within(region).getByRole("link", { name: "Revisar cierres" })).toHaveAttribute("href", "/cierres-admin");
  });

  it("un `rechazado` se lista con su estado en palabras (R41)", () => {
    render(
      <FranjaReprogramadasRetenidas
        resumen={resumen({ cierres: [cierre({ cierreId: UUID_A, cuantas: 1, estado: "rechazado" })] })}
      />,
    );
    expect(screen.getByRole("link", { name: "Ana Pérez · 24 de septiembre · Rechazado · retiene 1 paquete" })).toBeInTheDocument();
  });
});

describe("462/R38/R7 — los números son los del servidor", () => {
  it("N es `total` tal como llega: el navegador no lo recalcula sumando", () => {
    // `total` deliberadamente distinto de la suma de las partes: la franja tiene que leerlo, no derivarlo.
    render(
      <FranjaReprogramadasRetenidas
        resumen={resumen({ total: 7, cierres: [cierre({ cierreId: UUID_A, cuantas: 2 })], sinCierre: [sinCierre(1)] })}
      />,
    );
    expect(screen.getByText(/^Hay 7 paquetes reprogramados para hoy/)).toBeInTheDocument();
  });
});

describe("462 — forma y vocabulario", () => {
  it("es una región con nombre (no un `role=alert` que interrumpa), en tokens `warning` sin hex, y sin «reprogramadas»", () => {
    const { container } = render(
      <FranjaReprogramadasRetenidas resumen={resumen({ cierres: [cierre({ cierreId: UUID_A, cuantas: 2 })] })} />,
    );
    const region = screen.getByRole("region", { name: REGION });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(region.className).toContain("border-warning");
    expect(region.className).toContain("bg-warning-soft");
    expect(region.className).not.toMatch(/#[0-9a-f]{3,6}|amber-|yellow-|orange-/i);
    expect(container.innerHTML).not.toMatch(/reprogramadas/i);
  });
});
