import { describe, it, expect, vi } from "vitest";

import type {
  IOrdenNotaRepository,
  OrdenParaHilo,
} from "@/lib/interfaces/repositories/IOrdenNotaRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { HabilitarNovedadService } from "@/lib/services/HabilitarNovedadService";
import { SolicitudAyudaService } from "@/lib/services/SolicitudAyudaService";
import { rescatarOrdenAyuda } from "@/lib/services/rescate-ayuda";
import type { OrdenNotaDTO } from "@/lib/types/orden-nota";

// FEATURE 235 (T2.2, R8/R9) — EL PUNTO UNICO DE RESCATE, atacado DIRECTAMENTE.
//
// POR QUE ESTE ARCHIVO EXISTE Y NO BASTAN LOS DOS TESTS DE SERVICIO. El riesgo #1 del design es
// concreto: el rescate lo comparten DOS servicios con puertas distintas —la ventana del mensajero
// y la de la tienda— y basta con que alguien mueva la guarda de estado del punto unico a uno de
// los dos llamadores para que el otro se quede sin ella. Un test que entre por «Recuperar» no ve
// ese agujero, porque «Recuperar» seguiria estando bien. Este entra por la funcion.
//
// LO QUE SUSTITUYE. Hasta el 2026-08-19 habia DOS apagadores de la bandera haciendo lo mismo desde
// dos sitios: `OrdenRepository.desmarcarAyuda` («Recuperar») y `OrdenRepository.habilitarNovedad`
// («Habilitar»). R8 exige un solo punto de escritura y que sea el que usen los dos lados.
//
// ⏳ 2026-09-23 (FICHA 454, T1.15, R23): el rescate deja de ser la TRANSICION `ayuda_tienda ->
// en_reparto` y pasa a ser el evento `ayuda_rescatada` (`registrarAyudaResuelta`): la orden estaba
// y sigue `en_reparto`; lo que se cierra es la ayuda. «En ayuda» = ayuda ABIERTA (derivacion). El
// punto unico, las dos puertas, el actor real y la idempotencia por construccion no cambian. Sin
// catalogo que resolver, el fallo cerrado del catalogo (design §3.3 de la 235) desaparece.

const MENSAJERO = "u-mensajero";
const TIENDA = "u-tienda";
const ORDEN = "11111111-1111-4111-8111-111111111111";

const actorMensajero: Actor = { usuarioId: MENSAJERO, rol: "mensajero" };
const actorTienda: Actor = { usuarioId: TIENDA, rol: "adminTienda" };

const NOTA: OrdenNotaDTO = {
  id: "n1",
  cuerpo: "Ya lo resolvimos, segui con la entrega",
  autorNombre: "Tienda Uno",
  rolAutor: "adminTienda",
  createdAt: "2026-08-19T10:00:00.000Z",
  esPropia: true,
  eliminada: false,
};

function ordenParaHilo(over: Partial<OrdenParaHilo> = {}): OrdenParaHilo {
  return {
    tiendaId: TIENDA,
    mensajeroAsignadoId: MENSAJERO,
    estatusValue: "en_reparto",
    ayudaAbierta: true,
    deletedAt: null,
    // Feature 261 (B15): `fechaReparto` es OBLIGATORIO en `OrdenParaHilo` (insumo de la puerta
    // A de la via de la tienda). `null` = sin reserva, el caso por defecto.
    fechaReparto: null,
    ...over,
  };
}

interface ResueltaInput {
  ordenId: string;
  tipo: "ayuda_rescatada" | "ayuda_habilitada_api";
  actorUsuarioId: string;
  actorRol: string;
}

function build(orden: OrdenParaHilo | null = ordenParaHilo()) {
  const ordenRepo = {
    registrarAyudaResuelta: vi.fn(async (_input: ResueltaInput): Promise<boolean> => true),
  };
  const notaRepo: Pick<IOrdenNotaRepository, "findOrdenParaHilo"> = {
    findOrdenParaHilo: vi.fn(async () => orden),
  };
  return { deps: { notaRepo, ordenRepo }, ordenRepo, notaRepo };
}

describe("rescatarOrdenAyuda — la ESCRITURA (R8/R10/R13)", () => {
  it("R8 → 454/R23: registra `ayuda_rescatada` con el actor real (la orden no se mueve)", async () => {
    const { deps, ordenRepo } = build();

    const r = await rescatarOrdenAyuda(deps, ORDEN, actorMensajero);

    expect(r).toEqual({ status: "ok" });
    // Igualdad EXACTA del input, no `toMatchObject`: R13 (money-safe) se sostiene sobre que el
    // service no le pida al repo nada mas que el cambio de estatus.
    expect(ordenRepo.registrarAyudaResuelta).toHaveBeenCalledWith({
      ordenId: ORDEN,
      tipo: "ayuda_rescatada",
      actorUsuarioId: MENSAJERO,
      actorRol: "mensajero",
    });
  });

  it("R10: el actor que queda en el historial es EL QUE RESCATO, no un `null` de sistema", async () => {
    // Las dos puertas escriben la MISMA familia, asi que quien lo hizo solo se puede leer del
    // actor. Si alguien lo pusiera a `null` «porque es una transicion tecnica», el historial
    // dejaria de decir si la solicitud la retiro el mensajero o la tienda.
    const { deps, ordenRepo } = build();

    await rescatarOrdenAyuda(deps, ORDEN, actorTienda);

    expect(ordenRepo.registrarAyudaResuelta.mock.calls[0]![0].actorUsuarioId).toBe(TIENDA);
  });

  it("R13 (MONEY-SAFE): el input NO lleva montos, ni prioridad, ni mensajero", async () => {
    const { deps, ordenRepo } = build();

    await rescatarOrdenAyuda(deps, ORDEN, actorMensajero);

    const input = ordenRepo.registrarAyudaResuelta.mock.calls[0]![0];
    expect(Object.keys(input).sort()).toEqual(["actorRol", "actorUsuarioId", "ordenId", "tipo"]);
  });
});

describe("rescatarOrdenAyuda — LA GUARDA DE ESTADO, atacada de frente (R9)", () => {
  it.each([
    ["en_reparto"], // la orden ya fue rescatada por el otro lado
    ["novedad_interna"], // el corte de la noche la barrio
    ["entregado"], // otra pestaña la gestiono
    ["novedad"], // una devolucion anclada: «Habilitar» tambien pasa por aqui
  ])(
    "R9: rescatar una orden en `%s` SIN ayuda abierta devuelve forbidden y NO escribe nada",
    async (estatusValue) => {
      const { deps, ordenRepo } = build(ordenParaHilo({ estatusValue, ayudaAbierta: false }));

      const r = await rescatarOrdenAyuda(deps, ORDEN, actorMensajero);

      expect(r).toEqual({ status: "forbidden" });
      expect(ordenRepo.registrarAyudaResuelta).not.toHaveBeenCalled();
    },
  );

  it("R9: un SEGUNDO rescate no produce una segunda transicion", async () => {
    // La idempotencia es POR CONSTRUCCION: no hay codigo de idempotencia. El primer rescate deja
    // la orden en `en_reparto` y el segundo encuentra un estado que la guarda rechaza.
    const primero = build(ordenParaHilo({ ayudaAbierta: true }));
    const segundo = build(ordenParaHilo({ ayudaAbierta: false })); // tras el primero

    await expect(rescatarOrdenAyuda(primero.deps, ORDEN, actorMensajero)).resolves.toEqual({
      status: "ok",
    });
    await expect(rescatarOrdenAyuda(segundo.deps, ORDEN, actorMensajero)).resolves.toEqual({
      status: "forbidden",
    });
    expect(primero.ordenRepo.registrarAyudaResuelta).toHaveBeenCalledTimes(1);
    expect(segundo.ordenRepo.registrarAyudaResuelta).not.toHaveBeenCalled();
  });

  it("orden de OTRO mensajero: `forbidden` opaco y sin escritura", async () => {
    const { deps, ordenRepo } = build(ordenParaHilo({ mensajeroAsignadoId: "u-otro" }));

    const r = await rescatarOrdenAyuda(deps, ORDEN, actorMensajero);

    expect(r).toEqual({ status: "forbidden" });
    expect(ordenRepo.registrarAyudaResuelta).not.toHaveBeenCalled();
  });

  it("orden de OTRA tienda: `forbidden` opaco y sin escritura", async () => {
    const { deps, ordenRepo } = build(ordenParaHilo({ tiendaId: "u-otra-tienda" }));

    const r = await rescatarOrdenAyuda(deps, ORDEN, actorTienda);

    expect(r).toEqual({ status: "forbidden" });
    expect(ordenRepo.registrarAyudaResuelta).not.toHaveBeenCalled();
  });

  it("orden inexistente y orden borrada dan el MISMO `forbidden` (el borde no es un oraculo)", async () => {
    const inexistente = build(null);
    const borrada = build(ordenParaHilo({ deletedAt: new Date() }));

    await expect(rescatarOrdenAyuda(inexistente.deps, ORDEN, actorMensajero)).resolves.toEqual({
      status: "forbidden",
    });
    await expect(rescatarOrdenAyuda(borrada.deps, ORDEN, actorMensajero)).resolves.toEqual({
      status: "forbidden",
    });
    expect(inexistente.ordenRepo.registrarAyudaResuelta).not.toHaveBeenCalled();
    expect(borrada.ordenRepo.registrarAyudaResuelta).not.toHaveBeenCalled();
  });

  it("un rol SIN hilo no llega ni a leer la orden", async () => {
    const { deps, ordenRepo, notaRepo } = build();

    const r = await rescatarOrdenAyuda(deps, ORDEN, {
      usuarioId: "u-maestro",
      rol: "maestro",
    });

    expect(r).toEqual({ status: "forbidden" });
    expect(notaRepo.findOrdenParaHilo).not.toHaveBeenCalled();
    expect(ordenRepo.registrarAyudaResuelta).not.toHaveBeenCalled();
  });

});

// =================================================================================================
// R8 — LOS DOS LLAMADORES ACABAN EN LA MISMA ESCRITURA.
//
// Este bloque es el que convierte «hay un punto unico» en un hecho comprobable: se construyen los
// DOS servicios sobre el MISMO doble de repositorio y se comprueba que producen el MISMO input de
// escritura, con lo unico que debe diferenciarlos —el actor— cambiado.
// =================================================================================================
describe("R8 — «Recuperar» (mensajero) y «Habilitar» (tienda) escriben por el MISMO punto", () => {
  it("los dos producen el MISMO registro, y solo cambia el actor", async () => {
    const compartido = build(ordenParaHilo({ ayudaAbierta: true }));
    const { deps, ordenRepo, notaRepo } = compartido;

    // El mensajero, por «Recuperar».
    const solicitud = new SolicitudAyudaService(
      { publicar: vi.fn(async () => ({ status: "forbidden" as const })) },
      {
        ...ordenRepo,
        registrarAyudaSolicitada: vi.fn(async () => true),
        incrementarIntentoContacto: vi.fn(async () => 0),
      } as never,
      notaRepo,
      { liberarOrdenEnGestion: vi.fn(async () => true) },
    );
    // La tienda, por «Habilitar», que ademas publica su nota obligatoria ANTES.
    const publicarTienda = vi.fn(async () => ({ status: "ok" as const, nota: NOTA }));
    const habilitar = new HabilitarNovedadService(
      { publicar: publicarTienda },
      ordenRepo,
      notaRepo,
    );

    await solicitud.recuperar({ ordenId: ORDEN }, actorMensajero);
    await habilitar.habilitar({ ordenId: ORDEN, nota: "ya lo resolvimos" }, actorTienda);

    expect(ordenRepo.registrarAyudaResuelta).toHaveBeenCalledTimes(2);
    const [porRecuperar] = ordenRepo.registrarAyudaResuelta.mock.calls[0]!;
    const [porHabilitar] = ordenRepo.registrarAyudaResuelta.mock.calls[1]!;
    // Identicos salvo el actor (persona y rol): mismo tipo de evento.
    expect({ ...porRecuperar, actorUsuarioId: "X", actorRol: "Y" }).toEqual({
      ...porHabilitar,
      actorUsuarioId: "X",
      actorRol: "Y",
    });
    expect(porRecuperar.actorUsuarioId).toBe(MENSAJERO);
    expect(porHabilitar.actorUsuarioId).toBe(TIENDA);
    // Y el rescate NO publica: la nota de «Habilitar» es de su propio servicio.
    expect(publicarTienda).toHaveBeenCalledTimes(1);
    void deps;
  });

  it("R25: un mensajero BLOQUEADO por un cierre sin resolver PUEDE rescatar", async () => {
    // Igual que al pedir ayuda: anadir la guarda de bloqueo aqui crearia el DEADLOCK con R22 —la
    // orden en ayuda le bloquea el cierre, y sin poder rescatarla no podria desbloquearse nunca—.
    // Lo que se afirma es la AUSENCIA de esa dependencia: el rescate no conoce los cierres.
    const { deps, ordenRepo } = build();

    const r = await rescatarOrdenAyuda(deps, ORDEN, actorMensajero);

    expect(r).toEqual({ status: "ok" });
    expect(ordenRepo.registrarAyudaResuelta).toHaveBeenCalledTimes(1);
  });
});
