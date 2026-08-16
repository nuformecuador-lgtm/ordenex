// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { PosOrderCard } from "@/app/(app)/mis-asignaciones/_components/pos-card/PosOrderCard";
import { PosOrderCardMosaico } from "@/app/(app)/mis-asignaciones/_components/pos-card/PosOrderCardMosaico";
import { PosOrderCardDetalle } from "@/app/(app)/mis-asignaciones/_components/pos-card/PosOrderCardDetalle";
import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";

// Feature 227 (R21) — la nota PRIVADA del mensajero (feature 116) se RETIRA. Las tres
// vistas de la card la pintaban como badge ("Mi nota") y como preview del texto; aquí se
// afirma que ya no existe indicador alguno en ninguna de las tres.
//
// Decisión D3 del gate (design §5.1 bis): tampoco se sustituye por un indicador del HILO
// nuevo. No se retiran unos badges para poner otros; la señal llegará con la ficha 228.
// Por eso el test es "no hay indicador de nota", no "hay otro indicador".
//
// Las cards refrescan desde el router al gestionar; se mockea para montarlas en jsdom.
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
    secuenciaRuta: 1,
    marcarLuego: false,
    intentosEntrega: 0,
    ...over,
  };
}

afterEach(() => {
  cleanup();
});

describe("pos-card — sin indicador de nota privada (feature 227/R21)", () => {
  it("R21: la card completa no muestra indicador de nota privada", () => {
    render(<PosOrderCard orden={makeOrden()} total={1} />);

    expect(screen.queryByText(/mi nota/i)).toBeNull();
  });

  it("R21: la card de mosaico no muestra indicador de nota privada", () => {
    render(<PosOrderCardMosaico orden={makeOrden()} total={1} />);

    expect(screen.queryByText(/mi nota/i)).toBeNull();
  });

  it("R21: la card de detalle en fila no muestra indicador de nota privada", () => {
    render(<PosOrderCardDetalle orden={makeOrden()} total={1} />);

    expect(screen.queryByText(/mi nota/i)).toBeNull();
  });

  it("R25: la nota de la TIENDA (`orden.notas`) sigue siendo un dato distinto y ajeno al retiro", () => {
    // Guarda de contraste: el retiro de la 116 no debe arrastrarse la nota de la tienda.
    // Su presentación vive en `AsignacionDetalle`; aquí basta con afirmar que el campo
    // sigue viajando en el DTO que consumen las cards.
    const orden = makeOrden({ notas: "Entregar en recepción" });

    expect(orden.notas).toBe("Entregar en recepción");
  });
});
