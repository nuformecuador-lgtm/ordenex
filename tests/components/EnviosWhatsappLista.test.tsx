// @vitest-environment jsdom
//
// Ficha 474 (T10.3) — la LISTA de envíos automáticos (maqueta `Main` / `ListaMovil` / `Vacio`).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";

import { ToastProvider } from "@/providers/ToastProvider";
import type { EnvioListItemDTO } from "@/lib/types/envios-whatsapp";

const a = {
  listarEnvios: vi.fn(),
  encenderEnvio: vi.fn(),
  apagarEnvio: vi.fn(),
  reprogramarEnvio: vi.fn(),
};
vi.mock("@/lib/actions/envios-whatsapp", () => ({
  listarEnvios: (...x: unknown[]) => a.listarEnvios(...x),
  encenderEnvio: (...x: unknown[]) => a.encenderEnvio(...x),
  apagarEnvio: (...x: unknown[]) => a.apagarEnvio(...x),
  reprogramarEnvio: (...x: unknown[]) => a.reprogramarEnvio(...x),
}));

import { EnviosModule } from "@/app/(app)/configuracion/envios-whatsapp/_components/EnviosModule";

function envio(o: Partial<EnvioListItemDTO> = {}): EnvioListItemDTO {
  return {
    id: "e1",
    nombre: "Paquetes por vencer",
    informeClave: "prueba_envio",
    informeNombre: "Prueba de envío",
    plantillaId: "p1",
    plantillaNombre: "aviso_prueba",
    disparo: "hora_fija",
    diasSemana: [1, 2, 3, 4, 5, 6],
    hora: "05:00",
    eventoClave: null,
    eventoNombre: null,
    activo: false,
    proximaEjecucion: null,
    avisoSinProxima: false,
    ultimaEjecucion: null,
    ...o,
  };
}

function montar(items: EnvioListItemDTO[]) {
  a.listarEnvios.mockResolvedValue({ status: "ok", items });
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToastProvider>
        <EnviosModule initialItems={items} />
      </ToastProvider>
    </SWRConfig>,
  );
}

const tabla = () => screen.getByRole("table", { name: "Envíos automáticos" });

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe("lista de envíos", () => {
  it("sin envíos: el estado vacío de la maqueta, con el enlace a crear el primero y a Plantillas", () => {
    montar([]);
    expect(screen.getByText("Todavía no hay envíos automáticos")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "+ Crear el primero" })).toHaveAttribute("href", "/configuracion/envios-whatsapp/nuevo");
    expect(screen.getByRole("link", { name: "Plantillas" })).toHaveAttribute("href", "/configuracion/plantillas");
  });

  it("botón de crear: con envíos hay UNO solo («+ Nuevo envío»); vacía, solo «+ Crear el primero»", () => {
    const enlacesCrear = () =>
      screen.queryAllByRole("link").filter((l) => l.getAttribute("href") === "/configuracion/envios-whatsapp/nuevo");

    montar([envio(), envio({ id: "e2", nombre: "Otro" })]);
    expect(enlacesCrear()).toHaveLength(1);
    expect(enlacesCrear()[0]).toHaveTextContent("+ Nuevo envío");
    cleanup();

    montar([]);
    expect(enlacesCrear()).toHaveLength(1);
    expect(enlacesCrear()[0]).toHaveTextContent("+ Crear el primero");
    expect(screen.queryByRole("link", { name: "+ Nuevo envío" })).toBeNull();
  });

  it("pinta nombre, plantilla, informe, «Cuándo» (hora fija y evento por su nombre) y el último envío", () => {
    montar([
      envio({ ultimaEjecucion: { instante: new Date("2026-10-03T11:00:00Z"), estado: "vacia" } }),
      envio({
        id: "e2",
        nombre: "Aviso de mapas",
        informeNombre: "Aviso de la app",
        disparo: "evento",
        diasSemana: [],
        hora: null,
        eventoClave: "geocodificacion_caida",
        eventoNombre: "El servicio de mapas rechaza las peticiones",
      }),
    ]);
    const filas = within(tabla()).getAllByRole("row").slice(1);
    expect(filas[0]).toHaveTextContent("Paquetes por vencer");
    expect(filas[0]).toHaveTextContent("Plantilla aviso_prueba");
    expect(filas[0]).toHaveTextContent("Lun–Sáb 05:00");
    // R42 / design §7: `vacia` se enseña como «Sin novedades».
    expect(filas[0]).toHaveTextContent("Sin novedades");
    expect(filas[1]).toHaveTextContent("El servicio de mapas rechaza las peticiones");
    expect(filas[1]).toHaveTextContent("Nunca se ha enviado");
    expect(screen.getByText("Un envío nuevo se guarda", { exact: false })).toHaveTextContent("apagado");
  });

  it("R25: un encendido a hora fija enseña su próximo envío", () => {
    montar([envio({ activo: true, proximaEjecucion: new Date("2026-10-06T11:00:00Z") })]);
    expect(within(tabla()).getByText(/^Próximo: /)).toHaveTextContent("05:00");
  });

  it("R25: encendido SIN próximo envío: aviso visible y «Reprogramar»", async () => {
    const user = userEvent.setup();
    a.reprogramarEnvio.mockResolvedValue({ status: "ok", envio: {} });
    montar([envio({ activo: true, avisoSinProxima: true })]);
    const fila = within(tabla()).getAllByRole("row")[1];
    expect(fila).toHaveTextContent("Encendido pero sin próximo envío programado.");
    await user.click(within(fila).getByRole("button", { name: "Reprogramar" }));
    await waitFor(() => expect(a.reprogramarEnvio).toHaveBeenCalledWith("e1"));
  });

  it("R18: si el servidor no deja encender, dice por qué y sigue apagado", async () => {
    const user = userEvent.setup();
    a.encenderEnvio.mockResolvedValue({ status: "no_encendible", motivos: ["Ningún destinatario activo tiene un teléfono válido"] });
    montar([envio()]);
    const sw = within(tabla()).getByRole("switch", { name: "Encender «Paquetes por vencer»" });
    await user.click(sw);
    await waitFor(() => expect(a.encenderEnvio).toHaveBeenCalledWith("e1"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Ningún destinatario activo tiene un teléfono válido");
    expect(within(tabla()).getByRole("switch", { name: "Encender «Paquetes por vencer»" })).not.toBeChecked();
  });

  it("R19: apagar un envío encendido llama a apagarlo", async () => {
    const user = userEvent.setup();
    a.apagarEnvio.mockResolvedValue({ status: "ok", envio: {} });
    montar([envio({ activo: true, proximaEjecucion: new Date("2026-10-06T11:00:00Z") })]);
    await user.click(within(tabla()).getByRole("switch", { name: "Encender «Paquetes por vencer»" }));
    await waitFor(() => expect(a.apagarEnvio).toHaveBeenCalledWith("e1"));
    expect(a.encenderEnvio).not.toHaveBeenCalled();
  });

  it("cada fila lleva a su historial y a su edición", () => {
    montar([envio()]);
    const fila = within(tabla()).getAllByRole("row")[1];
    expect(within(fila).getByRole("link", { name: "Historial" })).toHaveAttribute("href", "/configuracion/envios-whatsapp/historial?envio=e1");
    expect(within(fila).getByRole("link", { name: "Editar" })).toHaveAttribute("href", "/configuracion/envios-whatsapp/e1");
  });
});
