// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";

import { RankingPodio } from "@/app/(app)/ranking/_components/RankingPodio";
import type { RankingRowDTO } from "@/lib/types/ranking";

// Rediseño de la sección de ranking: podio visual (2º-1º-3º) + lista del resto. Hereda la
// cobertura de presentación que vivía en la tabla de `RankingModule`.
// Trazabilidad: R3 (pct indefinido), R4/R5 (orden del servidor), R6 (conteo crudo),
// R12 (montos/pct STRING, sin recalcular), R13 (datos por mensajero), R15 (posición sin
// ocupante). Más el recorte al top del mensajero y el anclaje de su propia fila.

function fila(
  n: number,
  extra: Partial<RankingRowDTO> = {},
): RankingRowDTO {
  return {
    posicion: null,
    mensajeroId: `m${n}`,
    nombre: `Mensajero ${n}`,
    entregadasHoy: 100 - n,
    asignadasHoy: 100,
    pct: `${100 - n}.0`,
    premio: null,
    ...extra,
  };
}

// Podio con SOLO 2 ocupantes elegibles (posición 3 vacía → R15) + una fila fuera de podio.
const RANKING: RankingRowDTO[] = [
  {
    posicion: 1,
    mensajeroId: "m1",
    nombre: "Ana",
    entregadasHoy: 5,
    asignadasHoy: 5,
    pct: "100.0",
    premio: "5000",
  },
  {
    posicion: 2,
    mensajeroId: "m2",
    nombre: "Beto",
    entregadasHoy: 4,
    asignadasHoy: 5,
    pct: "80.0",
    premio: null,
  },
  {
    posicion: null,
    mensajeroId: "m3",
    nombre: "Caro",
    entregadasHoy: 0,
    asignadasHoy: 0,
    pct: null,
    premio: null,
  },
];

function podio() {
  return screen.getByRole("list", { name: "Podio del ranking diario" });
}
function lista() {
  return screen.getByRole("list", { name: "Resto del ranking diario" });
}

afterEach(() => {
  cleanup();
});

describe("RankingPodio — presentación del ranking (R13/R6/R12)", () => {
  it("R13/R12: cada escalón muestra nombre, % y conteo crudo tal cual llegan del servidor", () => {
    render(<RankingPodio ranking={RANKING} />);

    const escalones = within(podio()).getAllByRole("listitem");
    expect(escalones).toHaveLength(3);

    // Orden VISUAL 2º - 1º - 3º: el primero del DOM es el segundo lugar.
    expect(within(escalones[0]).getByText("Beto")).toBeInTheDocument();
    expect(within(escalones[0]).getByText("80.0%")).toBeInTheDocument();
    expect(within(escalones[1]).getByText("Ana")).toBeInTheDocument();
    expect(within(escalones[1]).getByText("100.0%")).toBeInTheDocument();
    expect(within(escalones[1]).getByText("5/5 entregas")).toBeInTheDocument();
  });

  it("R14: el premio del podio se muestra con su símbolo, sin recalcular el monto", () => {
    render(<RankingPodio ranking={RANKING} />);
    const primero = within(podio()).getAllByRole("listitem")[1];
    expect(within(primero).getByText("₡5.000")).toBeInTheDocument();
  });

  it("R15: la posición sin ocupante elegible NO inventa mensajero", () => {
    render(<RankingPodio ranking={RANKING} />);
    const tercero = within(podio()).getAllByRole("listitem")[2];
    expect(within(tercero).getByText("Sin ocupante")).toBeInTheDocument();
    expect(within(tercero).getByText("3º lugar")).toBeInTheDocument();
  });

  it("R6/R3: la fila fuera de podio muestra conteo crudo 0/0 y % '—' (pct indefinido)", () => {
    render(<RankingPodio ranking={RANKING} />);
    const caro = within(lista()).getAllByRole("listitem")[0];
    expect(within(caro).getByText("0/0 entregas")).toBeInTheDocument();
    expect(within(caro).getByText("—")).toBeInTheDocument();
    // La numeración del resto continúa tras los escalones OCUPADOS (2), no siempre en 4.
    expect(within(caro).getByText("3")).toBeInTheDocument();
  });

  it("R4/R5: respeta el orden del servidor en la lista, sin reordenar", () => {
    const ranking = [
      fila(1, { posicion: 1 }),
      fila(2, { posicion: 2 }),
      fila(3, { posicion: 3 }),
      fila(4),
      fila(5),
    ];
    render(<RankingPodio ranking={ranking} />);
    const filas = within(lista()).getAllByRole("listitem");
    expect(within(filas[0]).getByText("Mensajero 4")).toBeInTheDocument();
    expect(within(filas[1]).getByText("Mensajero 5")).toBeInTheDocument();
  });

  it("muestra el estado vacío cuando no hay mensajeros", () => {
    render(<RankingPodio ranking={[]} />);
    expect(
      screen.getByText("Todavía no hay mensajeros para mostrar hoy."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Podio del ranking diario" })).toBeNull();
  });
});

describe("RankingPodio — recorte al top y fila propia del mensajero", () => {
  // 20 mensajeros: 3 en el podio + 17 en la lista.
  const MUCHOS: RankingRowDTO[] = Array.from({ length: 20 }, (_, i) =>
    fila(i + 1, { posicion: i < 3 ? ((i + 1) as 1 | 2 | 3) : null }),
  );

  it("sin límite (maestro/admin) muestra la lista completa", () => {
    render(<RankingPodio ranking={MUCHOS} />);
    expect(within(lista()).getAllByRole("listitem")).toHaveLength(17);
  });

  it("con límite 10 el podio cuenta: quedan 7 filas en la lista", () => {
    render(<RankingPodio ranking={MUCHOS} mensajeroPropioId="m5" limite={10} />);
    expect(within(lista()).getAllByRole("listitem")).toHaveLength(7);
    // El último visible es el lugar 10.
    expect(screen.getByText("Mensajero 10")).toBeInTheDocument();
    expect(screen.queryByText("Mensajero 11")).toBeNull();
  });

  it("realza la fila propia cuando SÍ entra en el top, sin duplicarla", () => {
    render(<RankingPodio ranking={MUCHOS} mensajeroPropioId="m5" limite={10} />);
    expect(screen.getAllByText("Mensajero 5")).toHaveLength(1);
    expect(screen.getAllByText("Tú")).toHaveLength(1);
    expect(screen.queryByText(/fuera del top/)).toBeNull();
  });

  it("ancla la fila propia con sus datos y posición REALES si quedó fuera del top", () => {
    render(<RankingPodio ranking={MUCHOS} mensajeroPropioId="m18" limite={10} />);

    expect(screen.getByText("Tu posición, fuera del top 10")).toBeInTheDocument();
    const propia = screen.getByText("Mensajero 18").closest("li") as HTMLElement;
    // Posición real (18), no un "11" de relleno; conteo y % tal cual del servidor.
    expect(within(propia).getByText("18")).toBeInTheDocument();
    expect(within(propia).getByText("82/100 entregas")).toBeInTheDocument();
    expect(within(propia).getByText("82.0%")).toBeInTheDocument();
    expect(within(propia).getByText("Tú")).toBeInTheDocument();
  });

  it("no ancla nada para maestro/admin (sin fila propia)", () => {
    render(<RankingPodio ranking={MUCHOS} mensajeroPropioId={null} limite={null} />);
    expect(screen.queryByText(/fuera del top/)).toBeNull();
    expect(screen.queryByText("Tú")).toBeNull();
  });
});
