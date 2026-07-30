// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

import { useTonoAlIncrementar } from "@/hooks/useTonoAlIncrementar";

// Feature 161 — R10-R14. El generador del tono se mockea: aqui se verifica CUANDO se pide el
// tono, no como suena (eso es `tono-notificacion.test.ts`).

const { reproducirMock, prepararMock, leerPreferenciaMock } = vi.hoisted(() => ({
  reproducirMock: vi.fn(),
  prepararMock: vi.fn(),
  leerPreferenciaMock: vi.fn(() => true),
}));

vi.mock("@/lib/audio/tono-notificacion", () => ({
  reproducirTono: reproducirMock,
  prepararAudio: prepararMock,
  reiniciarAudioParaTests: vi.fn(),
}));

vi.mock("@/lib/audio/preferencia-sonido", () => ({
  leerPreferenciaSonido: leerPreferenciaMock,
  guardarPreferenciaSonido: vi.fn(),
  CLAVE_SONIDO: "ordenex:sonido-notificaciones",
}));

function Sonda({ contador }: { contador: number | null }) {
  useTonoAlIncrementar(contador);
  return null;
}

function montar(contador: number | null) {
  return render(<Sonda contador={contador} />);
}

beforeEach(() => {
  reproducirMock.mockClear();
  prepararMock.mockClear();
  leerPreferenciaMock.mockReturnValue(true);
});

afterEach(cleanup);

describe("useTonoAlIncrementar", () => {
  it("R11: no suena en el primer render, aunque el contador ya sea mayor que cero", () => {
    montar(7);

    expect(reproducirMock).not.toHaveBeenCalled();
  });

  it("R10: suena cuando el contador sube", () => {
    const { rerender } = montar(0);
    rerender(<Sonda contador={1} />);

    expect(reproducirMock).toHaveBeenCalledTimes(1);
  });

  it("R10: cada subida posterior vuelve a sonar", () => {
    const { rerender } = montar(0);
    rerender(<Sonda contador={1} />);
    rerender(<Sonda contador={2} />);

    expect(reproducirMock).toHaveBeenCalledTimes(2);
  });

  it("R12: no suena cuando el contador baja", () => {
    const { rerender } = montar(3);
    rerender(<Sonda contador={0} />);

    expect(reproducirMock).not.toHaveBeenCalled();
  });

  it("R12: no suena cuando el contador se repite", () => {
    const { rerender } = montar(2);
    rerender(<Sonda contador={2} />);
    rerender(<Sonda contador={2} />);

    expect(reproducirMock).not.toHaveBeenCalled();
  });

  it("R12: tras una bajada, la siguiente subida se mide contra el valor bajo", () => {
    const { rerender } = montar(5);
    rerender(<Sonda contador={0} />);
    expect(reproducirMock).not.toHaveBeenCalled();

    rerender(<Sonda contador={1} />);
    expect(reproducirMock).toHaveBeenCalledTimes(1);
  });

  it("R13: un salto de varias unidades suena una sola vez", () => {
    const { rerender } = montar(0);
    rerender(<Sonda contador={3} />);

    expect(reproducirMock).toHaveBeenCalledTimes(1);
  });

  it("R14: con el sonido silenciado no suena aunque el contador suba", () => {
    leerPreferenciaMock.mockReturnValue(false);

    const { rerender } = montar(0);
    rerender(<Sonda contador={1} />);

    expect(reproducirMock).not.toHaveBeenCalled();
  });

  it("R14: la preferencia se consulta al emitir, no al montar", () => {
    const { rerender } = montar(0);

    // El usuario silencia despues de montar: la siguiente subida ya no suena, sin remontar.
    leerPreferenciaMock.mockReturnValue(false);
    rerender(<Sonda contador={1} />);
    expect(reproducirMock).not.toHaveBeenCalled();

    // Y al reactivarlo vuelve a sonar.
    leerPreferenciaMock.mockReturnValue(true);
    rerender(<Sonda contador={2} />);
    expect(reproducirMock).toHaveBeenCalledTimes(1);
  });

  it("R24: el primer dato cargado tras el estado 'sin dato' no suena", () => {
    // Es el caso real: el primer render no tiene dato (null) y el fetch trae 3 avisos.
    const { rerender } = montar(null);
    rerender(<Sonda contador={3} />);

    expect(reproducirMock).not.toHaveBeenCalled();
  });

  it("R24: tras el primer dato, la subida siguiente sí suena", () => {
    const { rerender } = montar(null);
    rerender(<Sonda contador={3} />);
    rerender(<Sonda contador={4} />);

    expect(reproducirMock).toHaveBeenCalledTimes(1);
  });

  it("R24: una lectura fallida en medio no borra la referencia, y la subida real suena", () => {
    const { rerender } = montar(2);

    rerender(<Sonda contador={null} />); // la lectura falla: contador desconocido
    expect(reproducirMock).not.toHaveBeenCalled();

    // Se recupera CON UN AVISO MÁS. La referencia sigue siendo 2, así que esto es una
    // subida real y suena. Si el estado "sin dato" hubiera sobrescrito la referencia, este
    // aviso se perdería en silencio.
    rerender(<Sonda contador={3} />);
    expect(reproducirMock).toHaveBeenCalledTimes(1);
  });

  it("R24: recuperarse con el mismo valor no suena", () => {
    const { rerender } = montar(2);
    rerender(<Sonda contador={null} />);
    rerender(<Sonda contador={2} />);

    expect(reproducirMock).not.toHaveBeenCalled();
  });

  it("R7: prepara el desbloqueo por gesto al montar", () => {
    montar(0);

    expect(prepararMock).toHaveBeenCalled();
  });
});
