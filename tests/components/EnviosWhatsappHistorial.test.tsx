// @vitest-environment jsdom
//
// Ficha 474 (R42–R44, R37) — el HISTORIAL de envíos automáticos (maqueta `Historial.dc.html`).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";

import { ToastProvider } from "@/providers/ToastProvider";
import type { EjecucionItemDTO } from "@/lib/types/envios-whatsapp";

const router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const a = { listarEjecuciones: vi.fn(), obtenerEjecucion: vi.fn(), firmarPdfEjecucion: vi.fn() };
vi.mock("@/lib/actions/envios-whatsapp", () => ({
  listarEjecuciones: (...x: unknown[]) => a.listarEjecuciones(...x),
  obtenerEjecucion: (...x: unknown[]) => a.obtenerEjecucion(...x),
  firmarPdfEjecucion: (...x: unknown[]) => a.firmarPdfEjecucion(...x),
}));

import { HistorialEnvios } from "@/app/(app)/configuracion/envios-whatsapp/_components/HistorialEnvios";

function ej(o: Partial<EjecucionItemDTO>): EjecucionItemDTO {
  return {
    id: "x",
    envioId: "e1",
    envioNombre: "Paquetes por vencer",
    origen: "programado",
    instante: new Date("2026-10-05T11:00:00Z"),
    estado: "completada",
    motivo: null,
    plantillaNombre: "aviso_prueba",
    conteos: {},
    pdf: null,
    ...o,
  };
}

// El servidor ya las da de la más reciente a la más antigua (R42); la pantalla respeta ese orden.
const ITEMS: EjecucionItemDTO[] = [
  ej({ id: "a", conteos: { recibida: 4, rechazo_permanente: 1 }, pdf: { nombre: "prueba-2026-10-05.pdf", caducado: false } }),
  ej({ id: "b", origen: "prueba", instante: new Date("2026-10-05T09:22:00Z"), conteos: { en_curso: 1 } }),
  ej({ id: "c", instante: new Date("2026-10-03T11:00:00Z"), estado: "vacia", motivo: "No había nada que informar" }),
  ej({ id: "d", instante: new Date("2026-08-01T11:00:00Z"), conteos: { leida: 2 }, pdf: { nombre: "viejo.pdf", caducado: true } }),
];

function montar(envioId: string | null = null) {
  a.listarEjecuciones.mockResolvedValue({ status: "ok", items: ITEMS, page: 1, pageSize: 20, total: ITEMS.length });
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToastProvider>
        <HistorialEnvios
          inicial={{ items: ITEMS, total: ITEMS.length, page: 1, pageSize: 20 }}
          envios={[
            { id: "e1", nombre: "Paquetes por vencer" },
            { id: "e2", nombre: "Aviso de mapas" },
          ]}
          envioId={envioId}
        />
      </ToastProvider>
    </SWRConfig>,
  );
}

/** Las secciones de día (el visor de avisos flotantes también es una `region`). */
const diasDelHistorial = () => screen.getAllByRole("region").filter((r) => r.tagName === "SECTION");

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe("R42 — historial de ejecuciones", () => {
  it("agrupa por día de Costa Rica en el orden del servidor, con origen, estado, conteos y motivo", () => {
    montar();
    const dias = diasDelHistorial();
    expect(dias).toHaveLength(3);
    const primero = within(dias[0]).getAllByRole("listitem");
    expect(primero).toHaveLength(2);
    expect(primero[0]).toHaveTextContent("05:00");
    expect(primero[0]).toHaveTextContent("A hora fija");
    expect(primero[0]).toHaveTextContent("Enviado");
    expect(primero[0]).toHaveTextContent("4 entregados · 1 rechazado");
    expect(primero[1]).toHaveTextContent("03:22");
    expect(primero[1]).toHaveTextContent("Prueba");
    // «Sin novedades» es una FILA con su motivo, no un hueco.
    const vacia = within(dias[1]).getByRole("listitem");
    expect(vacia).toHaveTextContent("Sin novedades");
    expect(vacia).toHaveTextContent("No había nada que informar");
  });

  it("filtra por envío: pide ese envío al servidor y lo deja en la dirección", async () => {
    const user = userEvent.setup();
    montar();
    await user.click(screen.getByRole("combobox", { name: "Envío" }));
    await user.click(within(await screen.findByRole("listbox")).getByRole("option", { name: "Aviso de mapas" }));
    await waitFor(() => expect(a.listarEjecuciones).toHaveBeenCalledWith({ envioId: "e2", page: 1, pageSize: 20 }));
    expect(router.replace).toHaveBeenCalledWith("/configuracion/envios-whatsapp/historial?envio=e2", { scroll: false });
  });

  it("el detalle enseña a cada destinatario con el teléfono enmascarado; «en curso» es «Resultado desconocido» (R37)", async () => {
    const user = userEvent.setup();
    a.obtenerEjecucion.mockResolvedValue({
      status: "ok",
      ejecucion: ITEMS[1],
      entregas: [
        { id: "en1", destinatarioNombre: "Carlos Restrepo", telefonoEnmascarado: "•••• 7781", estado: "en_curso", motivo: null, instante: new Date("2026-10-05T09:22:05Z") },
      ],
    });
    montar();
    const fila = within(diasDelHistorial()[0]).getAllByRole("listitem")[1];
    await user.click(within(fila).getByRole("button", { name: "Ver destinatarios" }));
    await waitFor(() => expect(a.obtenerEjecucion).toHaveBeenCalledWith("b"));
    const tabla = await within(fila).findByRole("table");
    expect(tabla).toHaveTextContent("Carlos Restrepo");
    expect(tabla).toHaveTextContent("•••• 7781");
    expect(tabla).toHaveTextContent("Resultado desconocido");
    expect(tabla).toHaveTextContent("No se sabe si WhatsApp lo recibió; no se reenvía.");
  });
});

describe("R43/R44 — el PDF", () => {
  it("R43: pide el enlace firmado al pulsar y lo abre", async () => {
    const user = userEvent.setup();
    const abrir = vi.spyOn(window, "open").mockReturnValue(null);
    a.firmarPdfEjecucion.mockResolvedValue({ status: "ok", url: "https://almacen.example/firmado?t=1" });
    montar();
    await user.click(screen.getByRole("button", { name: "prueba-2026-10-05.pdf" }));
    await waitFor(() => expect(a.firmarPdfEjecucion).toHaveBeenCalledWith("a"));
    expect(abrir).toHaveBeenCalledWith("https://almacen.example/firmado?t=1", "_blank", "noopener,noreferrer");
    abrir.mockRestore();
  });

  it("R44: un PDF purgado se ve «caducado» y no tiene botón", () => {
    montar();
    const dias = diasDelHistorial();
    const vieja = within(dias[2]).getByRole("listitem");
    expect(vieja).toHaveTextContent("PDF caducado");
    expect(within(vieja).queryByRole("button", { name: "viejo.pdf" })).not.toBeInTheDocument();
  });

  it("R44: si caduca entre la carga y el clic, lo dice y quita el botón", async () => {
    const user = userEvent.setup();
    a.firmarPdfEjecucion.mockResolvedValue({ status: "caducado" });
    montar();
    await user.click(screen.getByRole("button", { name: "prueba-2026-10-05.pdf" }));
    expect(await screen.findAllByText("PDF caducado")).toHaveLength(2);
  });
});
