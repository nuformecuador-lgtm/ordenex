// @vitest-environment jsdom
// FICHA 456 (T3.15, design §5.2/§8; R16, R17, R30) — lo que NO lleva botón sigue sin él, y lo que
// convive con él no se estorba:
//   · contadores del tablero del día, pestañas de `/novedades` y KPI: 0 botones «Qué significa»;
//   · una tabla con casilla de selección y el chip de estado: marcar la casilla no abre la
//     explicación y abrir la explicación no marca la casilla.
// Las descargas (R17) las fijan sus propios tests de columnas, con los encabezados escritos a mano,
// que esta ficha no edita.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import { ContadoresTablero } from "@/app/(app)/monitoreo/_components/ContadoresTablero";
import { EstatusBadge } from "@/app/(app)/ordenes/_components/EstatusBadge";
import { CeldaSeleccion } from "@/components/shared/CeldaSeleccion";
import { DataTable } from "@/components/shared/DataTable";
import type { TotalesTableroDia } from "@/lib/types/tablero-dia";

afterEach(() => cleanup());

const infos = () => screen.queryAllByRole("button", { name: /^Qué significa «/ });

const CONTADORES: TotalesTableroDia = {
  asignadas: 16,
  entregadas: 5,
  reprogramadas: 2,
  devueltas: 2,
  rechazadas: 1,
  incidentes: 1,
  sinRecoger: 2,
  enReparto: 2,
  otros: 1,
};

describe("456 · R16 — los rótulos de recuento no llevan botón", () => {
  it("contadores del tablero del día (resultados y cubos): 0 botones de información", () => {
    render(<ContadoresTablero contadores={CONTADORES} etiquetaComposicion="Composición del día" />);
    expect(screen.getByText("Entregado")).toBeTruthy();
    expect(infos()).toHaveLength(0);
  });

  // Las pestañas de `/novedades`: en `NovedadesTabs.test.tsx` (necesitan sus dobles de acciones).
});

interface Fila {
  id: string;
  estatus: string;
}

function TablaConCasilla() {
  const [marcadas, setMarcadas] = useState<string[]>([]);
  return (
    <>
      <p data-testid="marcadas">{marcadas.join(",") || "ninguna"}</p>
      <DataTable<Fila>
        ariaLabel="Órdenes"
        rowKey="id"
        data={[{ id: "o1", estatus: "novedad" }]}
        columns={[
          {
            id: "sel",
            value: "Seleccionar",
            render: (f) => (
              <CeldaSeleccion
                checked={marcadas.includes(f.id)}
                onCheckedChange={(v) => setMarcadas(v ? [f.id] : [])}
                ariaLabel={`Seleccionar ${f.id}`}
              />
            ),
          },
          { id: "estado", value: "Estado", render: (f) => <EstatusBadge value={f.estatus} /> },
        ]}
      />
    </>
  );
}

describe("456 · R30 — casilla de la fila y explicación son independientes", () => {
  it("abrir la explicación no marca la casilla; marcar la casilla no abre la explicación", async () => {
    const user = userEvent.setup();
    render(<TablaConCasilla />);
    await user.click(screen.getByRole("button", { name: "Qué significa «Novedad»" }));
    await screen.findByRole("dialog", { name: "Novedad" });
    expect(screen.getByTestId("marcadas").textContent).toBe("ninguna");
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("checkbox", { name: "Seleccionar o1" }));
    expect(screen.getByTestId("marcadas").textContent).toBe("o1");
    expect(screen.queryByRole("dialog", { name: "Novedad" })).toBeNull();
    expect(within(screen.getByRole("table")).getByText("Novedad")).toBeTruthy();
  });
});
