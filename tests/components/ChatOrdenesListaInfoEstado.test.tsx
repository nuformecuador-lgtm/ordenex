// @vitest-environment jsdom
// FICHA 456 (T3.7, design §4.3/§8; R9, R30, R32) — la fila del chat es un `<button>` entero: el
// botón de información va como HERMANO, a su derecha. Su nombre accesible no cambia, no hay un botón
// dentro de otro, y tocar el de información no abre la conversación (tocar la fila, sí).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ChatOrdenesLista } from "@/app/(app)/mis-asignaciones/_components/chat/ChatOrdenesLista";
import { agruparContactosChat } from "@/app/(app)/mis-asignaciones/_components/chat/chat-contactos";
import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";
import { textoAprobadoDe } from "../fixtures/textos-aprobados-456";

afterEach(() => cleanup());

function orden(over: Partial<MiAsignacionDTO> = {}): MiAsignacionDTO {
  return {
    id: "o1",
    numGuia: 1001,
    numRemision: "REM-1",
    estatusValue: "en_reparto",
    destinatario: "Ana Mora",
    telefonoDest: "70001111",
    direccion: "200m sur",
    producto: "Caja",
    peso: 1,
    montoCobrar: 1000,
    latitud: null,
    longitud: null,
    notas: null,
    tiendaNombre: "Tienda",
    zonaNombre: "GAM",
    provinciaNombre: "San José",
    cantonNombre: "Escazú",
    distritoNombre: "San Rafael",
    sinpeNumero: null,
    sinpeNombre: null,
    secuenciaRuta: 1,
    marcarLuego: false,
    intentosEntrega: 0,
    ...over,
  } as MiAsignacionDTO;
}

function pintar(onSeleccionar = vi.fn()) {
  render(
    <ChatOrdenesLista
      contactos={agruparContactosChat([orden()], [], [])}
      noLeidos={new Map()}
      seleccionadaId={null}
      ordenEnDetalleId={null}
      onSeleccionar={onSeleccionar}
    />,
  );
  return onSeleccionar;
}

describe("456 · lista del chat — patrón de hermano", () => {
  it("R32 — la fila conserva su nombre accesible (incluye el estado) y no anida botones", () => {
    pintar();
    const fila = screen.getByRole("button", { name: /Ana Mora/ });
    expect(fila).toHaveAccessibleName(expect.stringContaining("En reparto"));
    expect(fila.querySelector("button")).toBeNull();
    const info = screen.getByRole("button", { name: "Qué significa «En reparto»" });
    expect(fila.contains(info)).toBe(false);
  });

  it("R30 — el botón de información no abre la conversación; la fila sí", async () => {
    const user = userEvent.setup();
    const onSeleccionar = pintar();
    await user.click(screen.getByRole("button", { name: "Qué significa «En reparto»" }));
    const dlg = await screen.findByRole("dialog");
    expect(dlg).toHaveAccessibleDescription(textoAprobadoDe("En reparto"));
    await user.click(within(dlg).getByText(textoAprobadoDe("En reparto")));
    expect(onSeleccionar).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: /Ana Mora/ }));
    expect(onSeleccionar).toHaveBeenCalledWith("o1");
  });
});
