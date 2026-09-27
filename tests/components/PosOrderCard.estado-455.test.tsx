// @vitest-environment jsdom
// FICHA 455 (T2.2; design §2.1; R7, R8, R12) — el chip de la card del portal del mensajero es el
// ESTADO DE LA ORDEN, en las tres vistas (grande, mosaico y detalle).
//
// Hasta la 455 el chip era un rótulo: «En gestión» (activa), «En detalle» (abierta en el panel),
// «En reparto» por defecto, o el que el consumidor pasaba fijo («Por recoger», «En ayuda», «Por
// recolectar», «Recolectada»). Y el color se buscaba POR ESE TEXTO. Aquí se afirma:
//   R7  — el chip dice `nombreDeEstado(orden.estatusValue)`, sea cual sea la pantalla;
//   R8  — activa / abierta en detalle se anuncian con una MARCA aparte («Gestionando ahora»,
//         «Abierta en detalle»), y el chip sigue diciendo el estado;
//   R12 — el color del chip depende del CÓDIGO, no del texto.
// Los textos esperados van escritos A MANO (memoria «Aserción contra su propia fuente»).
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";

import { PosOrderCard } from "@/app/(app)/mis-asignaciones/_components/pos-card/PosOrderCard";
import { PosOrderCardMosaico } from "@/app/(app)/mis-asignaciones/_components/pos-card/PosOrderCardMosaico";
import { PosOrderCardDetalle } from "@/app/(app)/mis-asignaciones/_components/pos-card/PosOrderCardDetalle";
import {
  claseChipEstado,
  marcasDeTarjeta,
  TEXTO_MARCA_TARJETA,
} from "@/app/(app)/mis-asignaciones/_components/pos-card/pos-estado";
import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";
import { NOMBRE_ESTADO } from "@/lib/types/order-status";
import { NOMBRES_RETIRADOS } from "../fixtures/nombres-retirados-455";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

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

afterEach(() => {
  cleanup();
});

const VISTAS = [
  ["grande", PosOrderCard],
  ["mosaico", PosOrderCardMosaico],
  ["detalle", PosOrderCardDetalle],
] as const;

describe.each(VISTAS)("455/R7 · R8 — card %s: el chip es el estado de la orden", (_vista, Card) => {
  it("R7: en reparto dice «En reparto»; recogiendo en bodega dice su nombre, no «Por recoger»", () => {
    render(<Card orden={makeOrden()} total={1} />);
    expect(screen.getByText("En reparto")).toBeInTheDocument();
    cleanup();

    render(<Card orden={makeOrden({ estatusValue: "mensajero_recogiendo_en_bodega" })} total={1} mostrarRuta={false} />);
    expect(screen.getByText("Mensajero recogiendo en la bodega")).toBeInTheDocument();
    expect(screen.queryByText("Por recoger")).toBeNull();
  });

  it("R7: recolección y recolectadas: el estado de la orden, no «Por recolectar» ni «Recolectada»", () => {
    render(<Card orden={makeOrden({ estatusValue: "recolectando" })} total={1} mostrarRuta={false} />);
    expect(screen.getByText("Recolectando")).toBeInTheDocument();
    cleanup();
    render(<Card orden={makeOrden({ estatusValue: "en_ruta_bodega_central" })} total={1} mostrarRuta={false} />);
    expect(screen.getByText("En ruta a bodega central")).toBeInTheDocument();
    expect(screen.queryByText(/^Por recolectar$|^Recolectada$/)).toBeNull();
  });

  it("R8: ACTIVA — el chip sigue diciendo el estado y la marca «Gestionando ahora» va aparte", () => {
    render(<Card orden={makeOrden()} total={1} esActiva onGestionar={() => {}} />);
    expect(screen.getByText("En reparto")).toBeInTheDocument();
    expect(screen.getByText("Gestionando ahora")).toBeInTheDocument();
    expect(screen.queryByText("En gestión")).toBeNull();
  });

  it("R8: ABIERTA EN DETALLE — chip con el estado y marca «Abierta en detalle» aparte", () => {
    render(<Card orden={makeOrden()} total={1} esDetalle onGestionar={() => {}} />);
    expect(screen.getByText("En reparto")).toBeInTheDocument();
    expect(screen.getByText("Abierta en detalle")).toBeInTheDocument();
    expect(screen.queryByText("En detalle")).toBeNull();
  });

  it("la NOTA del consumidor (ayuda, causa) va junto al chip, nunca en su lugar", () => {
    render(<Card orden={makeOrden()} total={1} nota="Ayuda solicitada a la tienda" mostrarRuta={false} />);
    expect(screen.getByText("En reparto")).toBeInTheDocument();
    expect(screen.getByText("Ayuda solicitada a la tienda")).toBeInTheDocument();
    expect(screen.queryByText("En ayuda")).toBeNull();
  });

  it("un código que el catálogo no conoce se lee «Estado no reconocido», nunca crudo (R10)", () => {
    render(<Card orden={makeOrden({ estatusValue: "estado_inventado" })} total={1} />);
    expect(screen.getByText("Estado no reconocido")).toBeInTheDocument();
    expect(screen.queryByText("estado_inventado")).toBeNull();
  });
});

describe("455/R12 · R8 — presentación indexada por código y marcas que no son nombres de estado", () => {
  it("R12: el color del chip lo decide el CÓDIGO (dos estados, dos colores; el desconocido, el de defecto)", () => {
    expect(claseChipEstado("en_reparto")).toBe("bg-warning text-navy");
    expect(claseChipEstado("mensajero_recogiendo_en_bodega")).toBe("bg-secondary text-secondary-foreground");
    expect(claseChipEstado("otro_codigo")).toBe("bg-warning text-navy");
  });

  it("R12: en la vista de mosaico el chip lleva la clase de su código", () => {
    render(<PosOrderCardMosaico orden={makeOrden({ estatusValue: "mensajero_recogiendo_en_bodega" })} total={1} />);
    expect(screen.getByText("Mensajero recogiendo en la bodega").className).toContain("bg-secondary");
  });

  it("R8/R6: las marcas de la interfaz no son nombres de ningún estado, vigente ni retirado", () => {
    const prohibidos = new Set<string>([...Object.values(NOMBRE_ESTADO), ...NOMBRES_RETIRADOS]);
    for (const texto of Object.values(TEXTO_MARCA_TARJETA)) expect(prohibidos.has(texto), texto).toBe(false);
    expect(TEXTO_MARCA_TARJETA).toEqual({ activa: "Gestionando ahora", detalle: "Abierta en detalle" });
  });

  it("orden de las marcas: la de la interfaz primero, luego la nota; activa gana a detalle", () => {
    expect(marcasDeTarjeta(true, true, "Nota").map((m) => m.texto)).toEqual(["Gestionando ahora", "Nota"]);
    expect(marcasDeTarjeta(false, true, undefined).map((m) => m.texto)).toEqual(["Abierta en detalle"]);
    expect(marcasDeTarjeta(false, false, undefined)).toEqual([]);
  });

  it("la cabecera de la card grande pinta chip y marcas en el mismo bloque", () => {
    render(<PosOrderCard orden={makeOrden()} total={1} esActiva onGestionar={() => {}} nota="Esperando tu respuesta" />);
    const chip = screen.getByText("En reparto");
    // FICHA 456 (2026-09-24, T3.6): el chip va dentro de `EstadoConInfo` (junto a su botón de
    // información); el bloque de la cabecera es el padre de ese envoltorio.
    const bloque = chip.parentElement?.parentElement as HTMLElement;
    expect(within(bloque).getByText("Gestionando ahora")).toBeInTheDocument();
    expect(within(bloque).getByText("Esperando tu respuesta")).toBeInTheDocument();
  });
});
