// @vitest-environment jsdom
// Feature 196 (T4.6) — el módulo cliente del histórico. Cubre R24, R25 y R31.
//
// El riesgo propio de este componente no es pintar: es REORDENAR. El orden lo congeló el
// cron en `puesto` y el histórico existe para que el orden de un martes no dependa del
// comparador del viernes; un `sort` «de cortesía» aquí destruiría exactamente el producto.
// Por eso las props llegan DESORDENADAS respecto de `puesto` en uno de los casos: la tabla
// tiene que pintarlas tal cual, aunque quede feo. Si algún día alguien las ordena, ese caso
// se pone rojo y dice por qué.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";

import { ToastProvider } from "@/providers/ToastProvider";
import { RankingHistoricoModule } from "@/app/(app)/ranking/historico/_components/RankingHistoricoModule";
import type { RankingSnapshotData, RankingSnapshotFilaDTO } from "@/lib/types/ranking-snapshot";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), refresh: vi.fn() }),
}));

const FECHA = "2026-08-09";

function fila(over: Partial<RankingSnapshotFilaDTO> = {}): RankingSnapshotFilaDTO {
  return {
    puesto: 1,
    posicion: 1,
    mensajeroId: "m1",
    nombre: "Ana Mensajera",
    entregadas: 5,
    asignadas: 5,
    pct: "100.0",
    premioMonto: "5000.00",
    premioDescripcion: "Bono oro",
    ...over,
  };
}

const FILAS: RankingSnapshotFilaDTO[] = [
  fila(),
  fila({
    puesto: 2,
    posicion: 2,
    mensajeroId: "m2",
    nombre: "Beto Repartidor",
    entregadas: 4,
    pct: "80.0",
    premioMonto: null,
    premioDescripcion: null,
  }),
  fila({
    puesto: 3,
    posicion: null,
    mensajeroId: "m3",
    nombre: "Caro Sin Ruta",
    entregadas: 0,
    asignadas: 0,
    pct: null,
    premioMonto: null,
    premioDescripcion: null,
  }),
];

const SNAPSHOT: RankingSnapshotData = {
  fecha: FECHA,
  generadoAt: "2026-08-10T08:00:00.000Z",
  minAsignadasPodio: 3,
  filas: FILAS,
};

function montar(snapshot: RankingSnapshotData | null = SNAPSHOT, fecha = FECHA) {
  return render(
    <ToastProvider>
      <RankingHistoricoModule fecha={fecha} snapshot={snapshot} />
    </ToastProvider>,
  );
}

/** Nombres de los mensajeros en el orden en que la tabla los está pintando. */
function nombresPintados(): string[] {
  const tabla = screen.getByRole("table", { name: "Ranking congelado del día" });
  return within(tabla)
    .getAllByRole("row")
    .slice(1)
    .map((f) => within(f).getAllByRole("cell")[2].textContent ?? "");
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("RankingHistoricoModule — orden congelado (R25)", () => {
  it("pinta las filas en el orden de `puesto` que llegó por props", () => {
    montar();
    expect(nombresPintados()).toEqual([
      "Ana Mensajera",
      "Beto Repartidor",
      "Caro Sin Ruta",
    ]);
    const tabla = screen.getByRole("table", { name: "Ranking congelado del día" });
    const puestos = within(tabla)
      .getAllByRole("row")
      .slice(1)
      .map((f) => within(f).getAllByRole("cell")[0].textContent);
    expect(puestos).toEqual(["1", "2", "3"]);
  });

  it("NO reordena ni recalcula: unas props desordenadas se pintan tal cual", () => {
    // El congelado es el que manda. Si el componente ordenara por `puesto` «para arreglarlo»,
    // estaría recalculando historia, y el día que el comparador cambie el histórico dejaría
    // de coincidir con lo que se vio y con lo que se pagó.
    const desordenadas = [FILAS[2], FILAS[0], FILAS[1]];
    montar({ ...SNAPSHOT, filas: desordenadas });
    expect(nombresPintados()).toEqual([
      "Caro Sin Ruta",
      "Ana Mensajera",
      "Beto Repartidor",
    ]);
  });
});

describe("RankingHistoricoModule — presentación money-safe (R31)", () => {
  it("muestra el porcentaje y el premio TAL CUAL llegaron, con su símbolo y sin recalcular", () => {
    montar();
    const tabla = screen.getByRole("table", { name: "Ranking congelado del día" });
    const filaAna = within(tabla).getByText("Ana Mensajera").closest("tr") as HTMLElement;

    // `"100.0"` con el decimal intacto: un `Number` intermedio lo habría dejado en "100".
    expect(within(filaAna).getByText("100.0%")).toBeInTheDocument();
    expect(within(filaAna).getByText("₡5000.00")).toBeInTheDocument();
    expect(within(filaAna).getByText("Bono oro")).toBeInTheDocument();

    // Sin asignadas el porcentaje es INDEFINIDO, que no es cero: la celda dice «—».
    const filaCaro = within(tabla).getByText("Caro Sin Ruta").closest("tr") as HTMLElement;
    expect(within(filaCaro).getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });

  it("la fila sin podio se lista con su puesto y sin posición (R9 congelada)", () => {
    montar();
    const tabla = screen.getByRole("table", { name: "Ranking congelado del día" });
    const filaCaro = within(tabla).getByText("Caro Sin Ruta").closest("tr") as HTMLElement;
    const celdas = within(filaCaro).getAllByRole("cell");
    expect(celdas[0]).toHaveTextContent("3"); // puesto
    expect(celdas[1]).toHaveTextContent("—"); // posición de podio: ninguna
  });
});

describe("RankingHistoricoModule — cabecera y selector", () => {
  it("R24: muestra la fecha consultada y el instante de generación", () => {
    montar();
    expect(screen.getByText(`Ranking del día ${FECHA}`)).toBeInTheDocument();

    // El instante se formatea SIEMPRE en hora de Costa Rica, así que el texto no depende de
    // la zona del entorno que corre el test. El esperado se compone aquí con la misma
    // configuración, escrita a mano, en vez de importar el helper del componente.
    //
    // El `.replace(/\s+/g, " ")` no es cosmético: `Intl` separa la hora del «a. m.» con un
    // ESPACIO ESTRECHO (U+202F), y el normalizador de testing-library lo colapsa a un espacio
    // normal al leer el DOM. Sin normalizar también el esperado, los dos textos son el mismo
    // y aun así no casan.
    const esperado = new Intl.DateTimeFormat("es-CR", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "America/Costa_Rica",
    })
      .format(new Date(SNAPSHOT.generadoAt))
      .replace(/\s+/g, " ");
    expect(screen.getByText(`Generado el ${esperado}`)).toBeInTheDocument();
    // 08:00Z son las 02:00 CR: si alguien quitara el `timeZone`, esto cambiaría de hora.
    expect(esperado).toContain("2:00");
  });

  it("el selector de fecha navega por URL con la fecha elegida", () => {
    // El estado vive en la URL y no en un `useState`: así la vista es enlazable y recargar
    // no la pierde. Se usa `fireEvent.change` y no `user.type` porque un `<input type=date>`
    // no se escribe carácter a carácter: el navegador (y el date picker) emiten el valor
    // completo de una vez, que es justo lo que este handler recibe en producción.
    montar();

    const selector = screen.getByLabelText("Fecha del histórico");
    expect(selector).toHaveValue(FECHA);

    fireEvent.change(selector, { target: { value: "2026-07-01" } });

    expect(pushMock).toHaveBeenCalledWith("/ranking/historico?fecha=2026-07-01");
  });

  it("vaciar el selector no navega a ninguna parte", () => {
    // Un `<input type=date>` emite "" mientras se está editando. Navegar a
    // `?fecha=` dejaría la pantalla en un estado que la acción rechazaría por R30.
    montar();
    fireEvent.change(screen.getByLabelText("Fecha del histórico"), {
      target: { value: "" },
    });
    expect(pushMock).not.toHaveBeenCalled();
  });
});

describe("RankingHistoricoModule — los dos vacíos son distintos (R26)", () => {
  it("cabecera con cero filas: «ese día no hubo actividad», con tabla montada", () => {
    montar({ ...SNAPSHOT, filas: [] });
    expect(
      screen.getByText(
        "Ese día no hubo actividad: ningún mensajero tuvo entregas ni asignaciones.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Ranking congelado del día" })).toBeInTheDocument();
  });

  it("sin cabecera: «no se generó el snapshot», sin tabla y sin control de descarga", () => {
    montar(null);
    expect(screen.getByText("No se generó el snapshot de esta fecha.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Descargar / })).not.toBeInTheDocument();
    // Y el selector sigue ahí: es la única forma de salir de una fecha sin snapshot.
    expect(screen.getByLabelText("Fecha del histórico")).toBeInTheDocument();
  });
});
