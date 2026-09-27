// @vitest-environment jsdom
// FICHA 456 (T3.6, design §4.1/§8; R9, R12, R30, R32) — las tres vistas de la tarjeta del mensajero
// llevan el botón de información junto al chip de estado, y ni el botón, ni el texto abierto, ni el
// teclado dentro de la explicación gestionan la orden. Pulsar la tarjeta sí.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PosOrderCard } from "@/app/(app)/mis-asignaciones/_components/pos-card/PosOrderCard";
import { PosOrderCardMosaico } from "@/app/(app)/mis-asignaciones/_components/pos-card/PosOrderCardMosaico";
import { PosOrderCardDetalle } from "@/app/(app)/mis-asignaciones/_components/pos-card/PosOrderCardDetalle";
import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";
import { TEXTO_APROBADO_NOTA_AYUDA, textoAprobadoDe } from "../fixtures/textos-aprobados-456";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

afterEach(() => cleanup());

function makeOrden(over: Partial<MiAsignacionDTO> = {}): MiAsignacionDTO {
  return {
    id: "o1",
    numGuia: 1001,
    numRemision: "REM-1",
    estatusValue: "en_reparto",
    destinatario: "Ana",
    telefonoDest: "70001111",
    direccion: "200m sur de la iglesia",
    producto: "Caja",
    peso: 1.2,
    montoCobrar: 25000,
    latitud: 9.93,
    longitud: -84.08,
    notas: null,
    tiendaNombre: "Tienda Norte",
    zonaNombre: "GAM",
    provinciaNombre: "San José",
    cantonNombre: "Escazú",
    distritoNombre: "San Rafael",
    sinpeNumero: "80000000",
    sinpeNombre: "Titular de Prueba",
    secuenciaRuta: 1,
    marcarLuego: false,
    intentosEntrega: 0,
    ...over,
  };
}

const VISTAS = [
  ["completa", PosOrderCard],
  ["mosaico", PosOrderCardMosaico],
  ["detalle", PosOrderCardDetalle],
] as const;

describe.each(VISTAS)("456 · tarjeta %s", (_vista, Card) => {
  it("R9/R32 — el chip dice el estado y lleva su botón; el texto es el aprobado", async () => {
    const user = userEvent.setup();
    render(<Card orden={makeOrden()} total={3} onGestionar={() => {}} />);
    const articulo = screen.getByRole("article");
    expect(within(articulo).getByText("En reparto")).toBeTruthy();
    await user.click(within(articulo).getByRole("button", { name: "Qué significa «En reparto»" }));
    expect(await screen.findByRole("dialog")).toHaveAccessibleDescription(textoAprobadoDe("En reparto"));
  });

  it("R30 — ni el botón, ni el texto abierto, ni Enter/Escape dentro gestionan la orden; la tarjeta sí", async () => {
    const user = userEvent.setup();
    const onGestionar = vi.fn();
    render(<Card orden={makeOrden()} total={3} onGestionar={onGestionar} />);
    const articulo = screen.getByRole("article");
    await user.click(within(articulo).getByRole("button", { name: "Qué significa «En reparto»" }));
    const dlg = await screen.findByRole("dialog");
    await user.click(within(dlg).getByText(textoAprobadoDe("En reparto")));
    fireEvent.click(dlg);
    fireEvent.keyDown(dlg, { key: "Enter" });
    await user.keyboard("{Enter}");
    await user.keyboard("{Escape}");
    expect(onGestionar).not.toHaveBeenCalled();
    // Pulsar la tarjeta (fuera de sus controles) sigue gestionando.
    await user.click(within(articulo).getAllByText("Ana")[0]);
    expect(onGestionar).toHaveBeenCalledTimes(1);
  });

  it("R12 — con una ayuda abierta, la nota «Ayuda solicitada a la tienda» lleva su botón", async () => {
    const user = userEvent.setup();
    render(<Card orden={makeOrden()} total={3} notaAyuda />);
    expect(screen.getByText("Ayuda solicitada a la tienda")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Qué significa «Ayuda solicitada a la tienda»" }));
    expect(await screen.findByRole("dialog")).toHaveAccessibleDescription(TEXTO_APROBADO_NOTA_AYUDA);
  });
});
