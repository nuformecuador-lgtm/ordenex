// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

import { HistoricoConversacionesModule } from "@/app/(app)/historico/conversaciones/_components/HistoricoConversacionesModule";

import {
  AHORA,
  HOY_ISO,
  hilo,
  instalarObservador,
  mensaje,
  okHilos,
  okMensajes,
  renderHistorico,
} from "./_historico-harness";

// Feature 318 / T6.4 (R31 + trampa (d)) — la MEDIA dentro del histórico.
//
// El binario no viaja en la respuesta: la burbuja se lo pide al proxy propio
// (`/api/chat/media/<id-interno>`), que es quien autoriza y quien distingue «caducado» (410) de
// «falló». El histórico HEREDA ese comportamiento de la 311 al reutilizar `MediaAdjunto`, y
// estos casos son los que afirman que sigue siendo verdad AQUÍ:
//
//   R31 — un adjunto que Meta ya no entrega se DICE dentro de su burbuja y el resto del hilo
//     sigue legible. Con 30 días de retención en Meta y un histórico sin límite de antigüedad
//     (P9), éste no es el caso raro: es el caso NORMAL de una conversación vieja.
//
//   Trampa (d) — el nombre accesible de un adjunto SALIENTE dice «que enviaste», no «enviada
//     por el cliente». En una vista con las dos direcciones, el texto cableado de la 311
//     mentiría en la mitad de las burbujas; la 316 lo indexó por dirección y aquí se comprueba
//     que el histórico se beneficia de ello.

const fetchMock = vi.fn();

/** El proxy responde 410 cuando Meta ya no tiene el binario. */
function respuestaExpirada(): unknown {
  return {
    ok: false,
    status: 410,
    json: async () => ({ error: "expirado" }),
    blob: async () => new Blob([]),
  };
}

function respuestaOk(mime: string): unknown {
  return {
    ok: true,
    status: 200,
    blob: async () => new Blob(["binario"], { type: mime }),
  };
}

const listarHilos = vi.fn(async () => okHilos([hilo()]));

beforeEach(() => {
  instalarObservador();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  listarHilos.mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderPantalla(listarMensajes: ReturnType<typeof vi.fn>) {
  return renderHistorico(
    <HistoricoConversacionesModule
      mensajeros={[]}
      acciones={{ listarHilos, listarMensajes: listarMensajes as never }}
      ahora={AHORA}
    />,
  );
}

async function abrirHilo() {
  fireEvent.click(await screen.findByRole("button", { name: /María González/ }));
  return screen.findByRole("list", { name: "Historial de mensajes" });
}

describe("T6.4 — media expirada: se dice y no rompe (R31)", () => {
  it("pinta el aviso en su burbuja y el RESTO del hilo sigue renderizado", async () => {
    fetchMock.mockResolvedValue(respuestaExpirada());
    const listarMensajes = vi.fn(async () =>
      okMensajes([
        mensaje({ id: "t1", cuerpo: "antes de la foto", ocurridoAt: HOY_ISO }),
        mensaje({
          id: "foto",
          tipo: "imagen",
          cuerpo: null,
          media: { mime: "image/jpeg", nombre: null, tamanoBytes: null },
          ocurridoAt: HOY_ISO,
        }),
        mensaje({ id: "t2", cuerpo: "después de la foto", ocurridoAt: HOY_ISO }),
      ]),
    );
    renderPantalla(listarMensajes);
    const lista = await abrirHilo();

    expect(
      await screen.findByText("Este archivo ya no está disponible."),
    ).toBeInTheDocument();
    // Las TRES burbujas siguen ahí: el adjunto caducado no se lleva por delante el hilo.
    expect(within(lista).getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText("antes de la foto")).toBeInTheDocument();
    expect(screen.getByText("después de la foto")).toBeInTheDocument();
  });

  // Un callejón sin salida sería peor que el fallo: la burbuja ofrece reintentar (R31 de la
  // 311, heredado). Con dos adjuntos fallidos, los nombres accesibles los distinguen.
  it("ofrece reintentar la descarga del adjunto caducado", async () => {
    fetchMock.mockResolvedValue(respuestaExpirada());
    const listarMensajes = vi.fn(async () =>
      okMensajes([
        mensaje({
          id: "foto",
          tipo: "imagen",
          cuerpo: null,
          media: { mime: "image/jpeg", nombre: null, tamanoBytes: null },
        }),
      ]),
    );
    renderPantalla(listarMensajes);
    await abrirHilo();

    expect(
      await screen.findByRole("button", { name: "Reintentar la descarga de la imagen" }),
    ).toBeInTheDocument();
  });
});

describe("T6.4 — trampa (d): el adjunto saliente no se atribuye al cliente", () => {
  it("un adjunto SALIENTE expone «que enviaste», no «enviada por el cliente»", async () => {
    fetchMock.mockResolvedValue(respuestaOk("audio/ogg"));
    const listarMensajes = vi.fn(async () =>
      okMensajes([
        mensaje({
          id: "nota",
          direccion: "saliente",
          tipo: "audio",
          cuerpo: null,
          media: { mime: "audio/ogg", nombre: null, tamanoBytes: null },
        }),
      ]),
    );
    renderPantalla(listarMensajes);
    await abrirHilo();

    // Audio y vídeo no se bajan solos (design §7 de la 311): se piden.
    fireEvent.click(await screen.findByRole("button", { name: /reproducir nota de voz/i }));

    await waitFor(() => {
      expect(screen.getByLabelText(/que enviaste/i)).toBeInTheDocument();
    });
    expect(screen.queryByLabelText(/del cliente/i)).toBeNull();
  });

  it("el mismo adjunto ENTRANTE sí se atribuye al cliente", async () => {
    fetchMock.mockResolvedValue(respuestaOk("audio/ogg"));
    const listarMensajes = vi.fn(async () =>
      okMensajes([
        mensaje({
          id: "nota",
          direccion: "entrante",
          tipo: "audio",
          cuerpo: null,
          media: { mime: "audio/ogg", nombre: null, tamanoBytes: null },
        }),
      ]),
    );
    renderPantalla(listarMensajes);
    await abrirHilo();

    fireEvent.click(await screen.findByRole("button", { name: /reproducir nota de voz/i }));

    await waitFor(() => {
      expect(screen.getByLabelText("Nota de voz del cliente")).toBeInTheDocument();
    });
    expect(screen.queryByLabelText(/que enviaste/i)).toBeNull();
  });
});
