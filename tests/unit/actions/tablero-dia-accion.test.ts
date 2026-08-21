import { describe, expect, it, vi } from "vitest";

import { leerTableroDia } from "@/lib/actions/tablero-dia";
import type { ITableroDiaService } from "@/lib/interfaces/services/ITableroDiaService";
import type { ResultadoDetalleDia, ResultadoTableroDia } from "@/lib/types/tablero-dia";

// Feature 192 (B4.2) — R2, R16.
//
// El borde no decide nada: lee el actor de la sesion, pone el reloj y delega. Lo que se
// comprueba aqui es que SIN SESION la respuesta es denegada y sin filas —nunca un tablero de
// ceros que la pantalla no pueda distinguir de "hoy no hubo trabajo"— y que el instante de
// referencia es inyectable.

const TABLERO: ResultadoTableroDia = {
  estado: "ok",
  tablero: {
    fecha: "2026-08-08",
    generadoAt: "2026-08-08T19:00:00.000Z",
    alcance: "global",
    filas: [],
    totales: {
      asignadas: 0,
      entregadas: 0,
      reprogramadas: 0,
      devueltas: 0,
      rechazadas: 0,
      incidentes: 0,
      sinRecoger: 0,
      enReparto: 0,
      otros: 0,
    },
    // FEATURE 258 (B4.5) — el literal ES el contrato y se EXTIENDE con el campo nuevo, no se
    // afloja a `expect.objectContaining` ni se deriva de la funcion que lo produce. Que este
    // fixture rompiera al añadir `ritmoEntregas` es justamente lo que hace que el contrato se
    // propague a todos los sitios que construyen un `TableroDia`.
    //
    // Serie coherente con estos totales: un dia sin ninguna entrega trae sus puntos `0..H` con
    // acumulado 0 (no una lista vacia: la lista vacia es cosa del adaptador de la grafica).
    ritmoEntregas: [
      { hora: 0, acumulado: 0 },
      { hora: 1, acumulado: 0 },
    ],
  },
};

function servicioDoble(): ITableroDiaService & {
  obtener: ReturnType<typeof vi.fn>;
  detalle: ReturnType<typeof vi.fn>;
} {
  return {
    obtener: vi.fn(
      async (actor: unknown): Promise<ResultadoTableroDia> =>
        actor === null ? { estado: "denegado", motivo: "sin_sesion" } : TABLERO,
    ),
    detalle: vi.fn(
      async (): Promise<ResultadoDetalleDia> => ({ estado: "denegado", motivo: "sin_sesion" }),
    ),
  } as unknown as ITableroDiaService & {
    obtener: ReturnType<typeof vi.fn>;
    detalle: ReturnType<typeof vi.fn>;
  };
}

describe("leerTableroDia", () => {
  it("sin cookie de sesion responde denegado, sin filas y sin conteos (R2)", async () => {
    const service = servicioDoble();
    const resultado = await leerTableroDia({ service, getActor: async () => null });

    expect(resultado).toEqual({ estado: "denegado", motivo: "sin_sesion" });
    expect(resultado).not.toHaveProperty("tablero");
  });

  it("con sesion valida de admin responde ok", async () => {
    const service = servicioDoble();
    const resultado = await leerTableroDia({
      service,
      getActor: async () => ({ usuarioId: "u1", rol: "admin", zonaId: null }),
    });

    expect(resultado.estado).toBe("ok");
  });

  it("no acepta parametros de zona ni de fecha: el actor y el dia los pone el servidor", async () => {
    const service = servicioDoble();
    await leerTableroDia({
      service,
      getActor: async () => ({ usuarioId: "u1", rol: "admin", zonaId: null }),
      now: () => new Date("2026-08-08T19:00:00.000Z"),
    });

    // La firma publica no tiene ningun canal por el que colar un alcance: lo unico que
    // recibe el servicio es el actor de la sesion y el instante.
    expect(service.obtener).toHaveBeenCalledWith(
      { usuarioId: "u1", rol: "admin", zonaId: null },
      new Date("2026-08-08T19:00:00.000Z"),
    );
    expect(leerTableroDia.length).toBeLessThanOrEqual(1);
  });

  it("la serie de entregas por hora viaja DENTRO del tablero y el borde no la toca (R57)", async () => {
    const service = servicioDoble();
    const resultado = await leerTableroDia({
      service,
      getActor: async () => ({ usuarioId: "u1", rol: "admin", zonaId: null }),
    });

    if (resultado.estado !== "ok") throw new Error("se esperaba ok");
    // Identidad, no igualdad: demuestra que el borde DEVUELVE lo del servicio sin recomponerlo.
    // Una Server Action que rearmara el objeto podria perder el campo sin que nadie lo notara.
    expect(resultado.tablero.ritmoEntregas).toBe(
      (TABLERO as { tablero: { ritmoEntregas: unknown } }).tablero.ritmoEntregas,
    );
    expect(resultado.tablero.generadoAt).toBe("2026-08-08T19:00:00.000Z");
  });

  it("el instante de referencia es inyectable: un test puede fijar el reloj (R16)", async () => {
    const service = servicioDoble();
    const congelado = new Date("2026-01-01T12:00:00.000Z");
    await leerTableroDia({
      service,
      getActor: async () => ({ usuarioId: "u1", rol: "admin", zonaId: null }),
      now: () => congelado,
    });

    expect(service.obtener.mock.calls[0][1]).toBe(congelado);
  });
});
