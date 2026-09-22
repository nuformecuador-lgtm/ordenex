import { describe, it, expect, vi } from "vitest";
import {
  actualizarVistaFiltro,
  eliminarVistaFiltro,
  guardarVistaFiltro,
  listarVistasFiltro,
  renombrarVistaFiltro,
} from "@/lib/actions/vistas-filtro";
import type { IVistaFiltroService } from "@/lib/interfaces/services/IVistaFiltroService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { VISTA_FILTRO_VERSION, type VistaFiltroPayload } from "@/lib/types/vista-filtro";

// FICHA 453 (T2.2) — EL BORDE de las cinco Server Actions: sesion (R3), `.strict()` (R3),
// superficie declarada (R33) y la respuesta ante una vista ajena (R2).
//
// `deps` inyectados: no toca cookies reales ni Prisma. Lo que se mide aqui es el BORDE, no las
// reglas —esas viven en `tests/unit/services/vista-filtro-service.test.ts`— ni el `WHERE` —ese vive
// contra Postgres real en `tests/integration/db/vista-filtro.test.ts`—.

const ANA: Actor = { usuarioId: "usuario-ana", rol: "maestro" };
const sesionDeAna = async (): Promise<Actor> => ANA;

const PAYLOAD: VistaFiltroPayload = {
  v: VISTA_FILTRO_VERSION,
  termino: "san jose",
  activos: ["zona"],
  seleccion: { zona: ["z-1"] },
};

const VISTA = {
  id: "v-1",
  nombre: "San Jose arriba",
  superficie: "ordenes" as const,
  filtro: PAYLOAD,
  actualizadaEn: "2026-09-21T15:00:00.000Z",
};

/** Doble del servicio. Todo metodo no esperado LANZA, para delatar una invocacion de mas. */
function dobleServicio(over: Partial<IVistaFiltroService> = {}): IVistaFiltroService {
  const prohibido = (nombre: string) => async () => {
    throw new Error(`${nombre} no deberia invocarse en este caso`);
  };
  return {
    listar: vi.fn(prohibido("listar")),
    guardar: vi.fn(prohibido("guardar")),
    renombrar: vi.fn(prohibido("renombrar")),
    actualizar: vi.fn(prohibido("actualizar")),
    eliminar: vi.fn(prohibido("eliminar")),
    ...over,
  } as IVistaFiltroService;
}

describe("453/R3 · sin sesion no se lee ni se escribe NADA", () => {
  it("⭑ las cinco acciones responden `unauthenticated` y el servicio ni se toca", async () => {
    const servicio = dobleServicio();
    const deps = { servicio, getActor: async () => null };

    expect(await listarVistasFiltro({ superficie: "ordenes" }, deps)).toEqual({
      status: "unauthenticated",
    });
    expect(
      await guardarVistaFiltro({ superficie: "ordenes", nombre: "X", filtro: PAYLOAD }, deps),
    ).toEqual({ status: "unauthenticated" });
    expect(
      await renombrarVistaFiltro({ id: crypto.randomUUID(), nombre: "X" }, deps),
    ).toEqual({ status: "unauthenticated" });
    expect(
      await actualizarVistaFiltro({ id: crypto.randomUUID(), filtro: PAYLOAD }, deps),
    ).toEqual({ status: "unauthenticated" });
    expect(await eliminarVistaFiltro({ id: crypto.randomUUID() }, deps)).toEqual({
      status: "unauthenticated",
    });

    for (const metodo of [
      servicio.listar,
      servicio.guardar,
      servicio.renombrar,
      servicio.actualizar,
      servicio.eliminar,
    ]) {
      expect(metodo).not.toHaveBeenCalled();
    }
  });

  it("⭑ la sesion se comprueba ANTES que la entrada: basura sin sesion es `unauthenticated`", async () => {
    // Importa el orden: si se validara primero, un `validation_error` le diria a quien no tiene
    // sesion que su cuerpo esta mal formado, que es informacion que no le toca.
    const r = await eliminarVistaFiltro({ esto: "no es una entrada" }, {
      servicio: dobleServicio(),
      getActor: async () => null,
    });
    expect(r).toEqual({ status: "unauthenticated" });
  });
});

describe("453/R3 · el dueño sale de la sesion; inyectarlo es un error, no algo que se ignore", () => {
  it("⭑ un `usuarioId` en la entrada da `validation_error` en las cinco acciones", async () => {
    const servicio = dobleServicio();
    const deps = { servicio, getActor: sesionDeAna };
    const id = crypto.randomUUID();

    const resultados = [
      await listarVistasFiltro({ superficie: "ordenes", usuarioId: "otra-persona" }, deps),
      await guardarVistaFiltro(
        { superficie: "ordenes", nombre: "X", filtro: PAYLOAD, usuarioId: "otra-persona" },
        deps,
      ),
      await renombrarVistaFiltro({ id, nombre: "X", usuarioId: "otra-persona" }, deps),
      await actualizarVistaFiltro({ id, filtro: PAYLOAD, usuarioId: "otra-persona" }, deps),
      await eliminarVistaFiltro({ id, usuarioId: "otra-persona" }, deps),
    ];

    for (const r of resultados) expect(r.status).toBe("validation_error");
    // ⚠️ Y NO SE IGNORA EN SILENCIO: el servicio no llega a ejecutarse con el actor bueno haciendo
    // como que el campo no existia. `.strict()` es lo que convierte el intento en ruido.
    expect(servicio.listar).not.toHaveBeenCalled();
    expect(servicio.guardar).not.toHaveBeenCalled();
    expect(servicio.eliminar).not.toHaveBeenCalled();
  });

  it("⭑ el dueño que llega al servicio es SIEMPRE el de la sesion", async () => {
    const guardar = vi.fn(async () => ({ status: "ok" as const, vista: VISTA }));
    const servicio = dobleServicio({ guardar });
    await guardarVistaFiltro(
      { superficie: "ordenes", nombre: "San Jose arriba", filtro: PAYLOAD },
      { servicio, getActor: sesionDeAna },
    );
    expect(guardar).toHaveBeenCalledWith(ANA.usuarioId, {
      superficie: "ordenes",
      nombre: "San Jose arriba",
      filtro: PAYLOAD,
    });
  });
});

describe("453/R33 · una superficie no declarada es un error, NO una lista vacia", () => {
  it("⭑ `cierres-admin` todavia no esta declarada: `validation_error`, y no se consulta nada", async () => {
    const servicio = dobleServicio();
    const r = await listarVistasFiltro(
      { superficie: "cierres-admin" },
      { servicio, getActor: sesionDeAna },
    );
    expect(r.status).toBe("validation_error");
    // ⚠️ La mutacion que este caso mata: responder `{status:"ok", vistas: []}`. Una lista vacia es
    // indistinguible de «esta persona no ha guardado nada aqui» (R38), que es un estado normal: el
    // fallo se veria como una pantalla corriente y nadie se enteraria.
    expect(r).not.toEqual({ status: "ok", vistas: [] });
    expect(servicio.listar).not.toHaveBeenCalled();
  });

  it("⭑ `ordenes` SI esta declarada y llega al servicio (control positivo)", async () => {
    const listar = vi.fn(async () => ({ status: "ok" as const, vistas: [VISTA] }));
    const r = await listarVistasFiltro(
      { superficie: "ordenes" },
      { servicio: dobleServicio({ listar }), getActor: sesionDeAna },
    );
    expect(r).toEqual({ status: "ok", vistas: [VISTA] });
    expect(listar).toHaveBeenCalledWith(ANA.usuarioId, "ordenes");
  });

  it("⭑ guardar en una superficie no declarada tampoco escribe", async () => {
    const servicio = dobleServicio();
    const r = await guardarVistaFiltro(
      { superficie: "analitica-operativo", nombre: "X", filtro: PAYLOAD },
      { servicio, getActor: sesionDeAna },
    );
    expect(r.status).toBe("validation_error");
    expect(servicio.guardar).not.toHaveBeenCalled();
  });
});

describe("453/R2 · una vista ajena responde `not_found`, no `forbidden`", () => {
  it("⭑ las tres escrituras propagan el `not_found` del servicio", async () => {
    const noEncontrada = async () => ({ status: "not_found" as const });
    const servicio = dobleServicio({
      renombrar: vi.fn(noEncontrada),
      actualizar: vi.fn(noEncontrada),
      eliminar: vi.fn(noEncontrada),
    });
    const deps = { servicio, getActor: sesionDeAna };
    const id = crypto.randomUUID();

    expect(await renombrarVistaFiltro({ id, nombre: "Mia ahora" }, deps)).toEqual({
      status: "not_found",
    });
    expect(await actualizarVistaFiltro({ id, filtro: PAYLOAD }, deps)).toEqual({
      status: "not_found",
    });
    expect(await eliminarVistaFiltro({ id }, deps)).toEqual({ status: "not_found" });
    // `forbidden` confirmaria que ese id existe y es de otra persona: sobre un recurso
    // estrictamente personal, eso es una filtracion gratuita.
    for (const r of [
      await renombrarVistaFiltro({ id, nombre: "Mia ahora" }, deps),
      await eliminarVistaFiltro({ id }, deps),
    ]) {
      expect(r.status).not.toBe("forbidden");
    }
  });
});

describe("453 · el borde valida la forma, y el tope viaja con sus numeros", () => {
  it("⭑ un `id` que no es un uuid no llega al servicio", async () => {
    const servicio = dobleServicio();
    const r = await eliminarVistaFiltro({ id: "v-1" }, { servicio, getActor: sesionDeAna });
    expect(r.status).toBe("validation_error");
    expect(servicio.eliminar).not.toHaveBeenCalled();
  });

  it("⭑ un `filtro` con una clave de mas no llega al servicio (formato cerrado)", async () => {
    const servicio = dobleServicio();
    const r = await guardarVistaFiltro(
      {
        superficie: "ordenes",
        nombre: "Con orden",
        filtro: { ...PAYLOAD, sortBy: "num_remision" },
      },
      { servicio, getActor: sesionDeAna },
    );
    expect(r.status).toBe("validation_error");
    expect(servicio.guardar).not.toHaveBeenCalled();
  });

  it("⭑ R13: el `limite_excedido` del servicio llega entero a quien llama", async () => {
    const guardar = vi.fn(async () => ({
      status: "limite_excedido" as const,
      maximo: 20,
      actuales: 20,
    }));
    const r = await guardarVistaFiltro(
      { superficie: "ordenes", nombre: "La 21", filtro: PAYLOAD },
      { servicio: dobleServicio({ guardar }), getActor: sesionDeAna },
    );
    // Sin los dos numeros, el aviso seria «no puedes guardar mas», que no dice cuantas hay ni
    // cual es el tope.
    expect(r).toEqual({ status: "limite_excedido", maximo: 20, actuales: 20 });
  });
});
