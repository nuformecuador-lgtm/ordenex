// @vitest-environment jsdom
// FICHA 456 (T3.5, design §5.1 fila 7/§8; R9, R30) — la tarjeta «por recibir» de la bodega satélite:
// cabecera y detalle desplegable con el botón de información; el desplegable abre SOLO con su
// disparador (el botón de información no lo abre).
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SateliteOrderCard } from "@/app/(app)/recepcion-satelite/_components/SateliteOrderCard";
import type { RecepcionSateliteDTO } from "@/lib/interfaces/services/IRecepcionSateliteService";
import { CAMPOS_BASE_ORDEN } from "@/tests/fixtures/fila-bodega-satelite";
import { textoAprobadoDe } from "../fixtures/textos-aprobados-456";

afterEach(() => cleanup());

const ORDEN: RecepcionSateliteDTO = {
  ...CAMPOS_BASE_ORDEN,
  id: "r1",
  numGuia: 1001,
  numRemision: "REM-R1",
  estatusValue: "en_ruta_bodega_satelite",
  destinatario: "Ana Pérez",
  telefonoDest: "88880000",
  direccion: "Calle 1",
  producto: "Caja",
  montoCobrar: 150,
  tiendaNombre: "Tienda X",
  zonaNombre: "Limón",
  provinciaNombre: "Limón",
  cantonNombre: "Central",
  distritoNombre: "Limón",
} as RecepcionSateliteDTO;

describe("456 · tarjeta de la bodega satélite", () => {
  it("R9 — la cabecera lleva el estado con su botón y la explicación aprobada", async () => {
    const user = userEvent.setup();
    render(<SateliteOrderCard orden={ORDEN} />);
    const cabecera = screen.getByRole("article").querySelector("header") as HTMLElement;
    expect(within(cabecera).getByText("En ruta a bodega satélite")).toBeTruthy();
    await user.click(within(cabecera).getByRole("button", { name: "Qué significa «En ruta a bodega satélite»" }));
    expect(await screen.findByRole("dialog")).toHaveAccessibleDescription(textoAprobadoDe("En ruta a bodega satélite"));
  });

  it("R30 — el botón de información no abre el desplegable; su disparador sí, y dentro también hay botón", async () => {
    const user = userEvent.setup();
    render(<SateliteOrderCard orden={ORDEN} />);
    const disparador = screen.getByRole("button", { name: /Ver detalle completo/i });
    expect(disparador).toHaveAttribute("aria-expanded", "false");
    await user.click(screen.getAllByRole("button", { name: "Qué significa «En ruta a bodega satélite»" })[0]);
    expect(disparador).toHaveAttribute("aria-expanded", "false");
    await user.keyboard("{Escape}");
    await user.click(disparador);
    expect(disparador).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("button", { name: "Qué significa «En ruta a bodega satélite»" })).toHaveLength(2);
  });
});
