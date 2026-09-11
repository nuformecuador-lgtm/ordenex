// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, cleanup } from "@testing-library/react";

import { usePushEnVentana, VENTANA_SUPRESION_TONO_MS } from "@/hooks/usePushEnVentana";
import { useTonoAlIncrementar } from "@/hooks/useTonoAlIncrementar";

/**
 * FICHA 410 (tanda 5, T5.4 — R43) — UN HECHO, UN SONIDO.
 *
 * Con la ventana visible el navegador OBLIGA a mostrar la notificación del sistema, así que el tono
 * propio de la campana sería el segundo aviso de la misma cosa. Aquí se ejercitan los dos hooks
 * JUNTOS —el que escucha al service worker y el que decide si suena— porque la propiedad que
 * importa no vive en ninguno de los dos por separado.
 */

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

/**
 * El literal se escribe A MANO y no se importa de `lib/pwa/actualizacion.ts`: es el contrato con
 * `public/sw.js`, que no puede importar del bundle. Compararlo con su propia fuente estaría siempre
 * verde. (Que los dos archivos no divergen lo vigila `pwa-push.guardia.test.ts`.)
 */
const MENSAJE_DEL_SERVICE_WORKER = "ordenex:push-recibido";

const revalidar = vi.fn();

let contenedor: EventTarget;
let ahora = 1_700_000_000_000;

function Sonda({ contador }: { contador: number | null }) {
  const { suprimirTonoDeEsteIncremento } = usePushEnVentana(revalidar);
  useTonoAlIncrementar(contador, suprimirTonoDeEsteIncremento);
  return null;
}

function llegaUnPush(tipo: string = MENSAJE_DEL_SERVICE_WORKER) {
  act(() => {
    contenedor.dispatchEvent(
      new MessageEvent("message", { data: { tipo, destino: "/cierre-dia" } }),
    );
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  leerPreferenciaMock.mockReturnValue(true);
  ahora = 1_700_000_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => ahora);
  contenedor = new EventTarget();
  Object.defineProperty(navigator, "serviceWorker", {
    value: contenedor,
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, "serviceWorker");
  vi.restoreAllMocks();
});

describe("R43 — llega un push con la ventana visible", () => {
  it("la campana REVALIDA en el acto, sin esperar los 60 s del sondeo", () => {
    render(<Sonda contador={1} />);

    llegaUnPush();

    expect(revalidar).toHaveBeenCalledTimes(1);
  });

  it("y el tono propio NO suena para ese incremento: el sistema ya sonó", () => {
    const { rerender } = render(<Sonda contador={1} />);

    llegaUnPush();
    rerender(<Sonda contador={2} />);

    expect(reproducirMock).not.toHaveBeenCalled();
  });

  it("MUTACIÓN: sin la supresión, ese mismo incremento SÍ sonaría (control positivo)", () => {
    // El mismo incremento, sin haber recibido push. Si este caso no sonara, el de arriba estaría
    // verde por vacío y no probaría nada.
    const { rerender } = render(<Sonda contador={1} />);

    rerender(<Sonda contador={2} />);

    expect(reproducirMock).toHaveBeenCalledTimes(1);
  });
});

describe("R43 — la supresión es de UN incremento, no un interruptor", () => {
  it("el incremento siguiente vuelve a sonar", () => {
    const { rerender } = render(<Sonda contador={1} />);

    llegaUnPush();
    rerender(<Sonda contador={2} />);
    expect(reproducirMock).not.toHaveBeenCalled();

    rerender(<Sonda contador={3} />);
    expect(reproducirMock).toHaveBeenCalledTimes(1);
  });

  it("dos push seguidos callan dos incrementos, uno por cada uno", () => {
    const { rerender } = render(<Sonda contador={1} />);

    llegaUnPush();
    rerender(<Sonda contador={2} />);
    llegaUnPush();
    rerender(<Sonda contador={3} />);

    expect(revalidar).toHaveBeenCalledTimes(2);
    expect(reproducirMock).not.toHaveBeenCalled();
  });

  it("una marca que NUNCA se consume CADUCA, y no se come el tono de otra cosa", () => {
    // El caso que hace falta porque existe de verdad: llega el push de un aviso que no es
    // accionable, así que el contador no se mueve. Sin caducidad, la marca se quedaría encendida y
    // el siguiente tono —de otro hecho, horas después— desaparecería sin que nadie supiera por qué.
    const { rerender } = render(<Sonda contador={1} />);

    llegaUnPush();
    ahora += VENTANA_SUPRESION_TONO_MS + 1;
    rerender(<Sonda contador={2} />);

    expect(reproducirMock).toHaveBeenCalledTimes(1);
  });

  it("la ventana de supresión son diez segundos, escritos a mano", () => {
    expect(VENTANA_SUPRESION_TONO_MS).toBe(10_000);
  });
});

describe("el mensaje que se escucha es el del canal, y solo ése", () => {
  it("otro mensaje del service worker (el relevo de versión) no revalida ni silencia nada", () => {
    const { rerender } = render(<Sonda contador={1} />);

    llegaUnPush("ordenex:relevo-ahora");
    rerender(<Sonda contador={2} />);

    expect(revalidar).not.toHaveBeenCalled();
    expect(reproducirMock).toHaveBeenCalledTimes(1);
  });

  it("un mensaje sin forma de objeto no rompe nada", () => {
    render(<Sonda contador={1} />);

    act(() => {
      contenedor.dispatchEvent(new MessageEvent("message", { data: "hola" }));
      contenedor.dispatchEvent(new MessageEvent("message", { data: null }));
    });

    expect(revalidar).not.toHaveBeenCalled();
  });

  it("sin service worker en el navegador, la campana sigue funcionando igual (R46)", () => {
    Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, "serviceWorker");
    const { rerender } = render(<Sonda contador={1} />);

    rerender(<Sonda contador={2} />);

    expect(reproducirMock).toHaveBeenCalledTimes(1);
    expect(revalidar).not.toHaveBeenCalled();
  });
});

describe("lo que la ficha 161 ya decidía sigue decidiéndolo", () => {
  it("con el sonido apagado no suena, con push o sin él", () => {
    leerPreferenciaMock.mockReturnValue(false);
    const { rerender } = render(<Sonda contador={1} />);

    rerender(<Sonda contador={2} />);

    expect(reproducirMock).not.toHaveBeenCalled();
  });

  it("una BAJADA del contador no suena ni consume la marca del push", () => {
    const { rerender } = render(<Sonda contador={5} />);

    llegaUnPush();
    rerender(<Sonda contador={2} />);
    expect(reproducirMock).not.toHaveBeenCalled();

    // La marca seguía viva: el incremento de verdad que llega después es el que se calla.
    rerender(<Sonda contador={6} />);
    expect(reproducirMock).not.toHaveBeenCalled();
  });
});
