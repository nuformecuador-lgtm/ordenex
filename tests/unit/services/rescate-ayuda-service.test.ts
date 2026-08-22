import { describe, it, expect, vi } from "vitest";

import type {
  IOrdenNotaRepository,
  OrdenParaHilo,
} from "@/lib/interfaces/repositories/IOrdenNotaRepository";
import type { TransicionAyudaInput } from "@/lib/interfaces/repositories/IOrdenRepository";
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

const MENSAJERO = "u-mensajero";
const TIENDA = "u-tienda";
const ORDEN = "11111111-1111-4111-8111-111111111111";
const ID_AYUDA = "s-ayuda";
const ID_EN_REPARTO = "s-en-reparto";

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
    estatusValue: "ayuda_tienda",
    deletedAt: null,
    // Feature 261 (B15): `fechaReparto` es OBLIGATORIO en `OrdenParaHilo` (insumo de la puerta
    // A de la via de la tienda). `null` = sin reserva, el caso por defecto.
    fechaReparto: null,
    ...over,
  };
}

function build(
  orden: OrdenParaHilo | null = ordenParaHilo(),
  catalogo: Record<string, string | null> = { ayuda_tienda: ID_AYUDA, en_reparto: ID_EN_REPARTO },
) {
  const ordenRepo = {
    findEstatusIdByValue: vi.fn(async (value: string) => catalogo[value] ?? null),
    transicionarAyuda: vi.fn(async (_input: TransicionAyudaInput): Promise<boolean> => true),
  };
  const notaRepo: Pick<IOrdenNotaRepository, "findOrdenParaHilo"> = {
    findOrdenParaHilo: vi.fn(async () => orden),
  };
  return { deps: { notaRepo, ordenRepo }, ordenRepo, notaRepo };
}

describe("rescatarOrdenAyuda — la ESCRITURA (R8/R10/R13)", () => {
  it("R8: transiciona `ayuda_tienda -> en_reparto` con la familia de la VUELTA y el actor real", async () => {
    const { deps, ordenRepo } = build();

    const r = await rescatarOrdenAyuda(deps, ORDEN, actorMensajero);

    expect(r).toEqual({ status: "ok" });
    // Igualdad EXACTA del input, no `toMatchObject`: R13 (money-safe) se sostiene sobre que el
    // service no le pida al repo nada mas que el cambio de estatus.
    expect(ordenRepo.transicionarAyuda).toHaveBeenCalledWith({
      ordenId: ORDEN,
      estatusOrigenId: ID_AYUDA,
      estatusDestinoId: ID_EN_REPARTO,
      actorUsuarioId: MENSAJERO,
      origenTipo: "rescate_ayuda_tienda",
    });
  });

  it("R10: el actor que queda en el historial es EL QUE RESCATO, no un `null` de sistema", async () => {
    // Las dos puertas escriben la MISMA familia, asi que quien lo hizo solo se puede leer del
    // actor. Si alguien lo pusiera a `null` «porque es una transicion tecnica», el historial
    // dejaria de decir si la solicitud la retiro el mensajero o la tienda.
    const { deps, ordenRepo } = build();

    await rescatarOrdenAyuda(deps, ORDEN, actorTienda);

    expect(ordenRepo.transicionarAyuda.mock.calls[0]![0].actorUsuarioId).toBe(TIENDA);
  });

  it("R13 (MONEY-SAFE): el input NO lleva montos, ni prioridad, ni mensajero", async () => {
    const { deps, ordenRepo } = build();

    await rescatarOrdenAyuda(deps, ORDEN, actorMensajero);

    const input = ordenRepo.transicionarAyuda.mock.calls[0]![0];
    expect(Object.keys(input).sort()).toEqual([
      "actorUsuarioId",
      "estatusDestinoId",
      "estatusOrigenId",
      "ordenId",
      "origenTipo",
    ]);
  });
});

describe("rescatarOrdenAyuda — LA GUARDA DE ESTADO, atacada de frente (R9)", () => {
  it.each([
    ["en_reparto"], // la orden ya fue rescatada por el otro lado
    ["sin_gestionar"], // el corte de la noche la barrio
    ["entregada"], // otra pestaña la gestiono
    ["devuelta"], // una devolucion anclada: «Habilitar» tambien pasa por aqui
  ])(
    "R9: rescatar una orden en `%s` devuelve forbidden y NO escribe ni una fila de historial",
    async (estatusValue) => {
      const { deps, ordenRepo } = build(ordenParaHilo({ estatusValue }));

      const r = await rescatarOrdenAyuda(deps, ORDEN, actorMensajero);

      expect(r).toEqual({ status: "forbidden" });
      expect(ordenRepo.transicionarAyuda).not.toHaveBeenCalled();
      // Y ni siquiera se molesta en resolver el catalogo: la guarda corta ANTES.
      expect(ordenRepo.findEstatusIdByValue).not.toHaveBeenCalled();
    },
  );

  it("R9: un SEGUNDO rescate no produce una segunda transicion", async () => {
    // La idempotencia es POR CONSTRUCCION: no hay codigo de idempotencia. El primer rescate deja
    // la orden en `en_reparto` y el segundo encuentra un estado que la guarda rechaza.
    const primero = build(ordenParaHilo({ estatusValue: "ayuda_tienda" }));
    const segundo = build(ordenParaHilo({ estatusValue: "en_reparto" })); // tras el primero

    await expect(rescatarOrdenAyuda(primero.deps, ORDEN, actorMensajero)).resolves.toEqual({
      status: "ok",
    });
    await expect(rescatarOrdenAyuda(segundo.deps, ORDEN, actorMensajero)).resolves.toEqual({
      status: "forbidden",
    });
    expect(primero.ordenRepo.transicionarAyuda).toHaveBeenCalledTimes(1);
    expect(segundo.ordenRepo.transicionarAyuda).not.toHaveBeenCalled();
  });

  it("orden de OTRO mensajero: `forbidden` opaco y sin escritura", async () => {
    const { deps, ordenRepo } = build(ordenParaHilo({ mensajeroAsignadoId: "u-otro" }));

    const r = await rescatarOrdenAyuda(deps, ORDEN, actorMensajero);

    expect(r).toEqual({ status: "forbidden" });
    expect(ordenRepo.transicionarAyuda).not.toHaveBeenCalled();
  });

  it("orden de OTRA tienda: `forbidden` opaco y sin escritura", async () => {
    const { deps, ordenRepo } = build(ordenParaHilo({ tiendaId: "u-otra-tienda" }));

    const r = await rescatarOrdenAyuda(deps, ORDEN, actorTienda);

    expect(r).toEqual({ status: "forbidden" });
    expect(ordenRepo.transicionarAyuda).not.toHaveBeenCalled();
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
    expect(inexistente.ordenRepo.transicionarAyuda).not.toHaveBeenCalled();
    expect(borrada.ordenRepo.transicionarAyuda).not.toHaveBeenCalled();
  });

  it("un rol SIN hilo no llega ni a leer la orden", async () => {
    const { deps, ordenRepo, notaRepo } = build();

    const r = await rescatarOrdenAyuda(deps, ORDEN, {
      usuarioId: "u-maestro",
      rol: "maestro",
    });

    expect(r).toEqual({ status: "forbidden" });
    expect(notaRepo.findOrdenParaHilo).not.toHaveBeenCalled();
    expect(ordenRepo.transicionarAyuda).not.toHaveBeenCalled();
  });

  it("FALLO CERRADO: catalogo incompleto -> forbidden sin mover nada (design §3.3)", async () => {
    const { deps, ordenRepo } = build(ordenParaHilo(), {
      ayuda_tienda: ID_AYUDA,
      en_reparto: null,
    });

    const r = await rescatarOrdenAyuda(deps, ORDEN, actorMensajero);

    expect(r).toEqual({ status: "forbidden" });
    expect(ordenRepo.transicionarAyuda).not.toHaveBeenCalled();
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
  it("los dos producen la MISMA transicion, y solo cambia el actor", async () => {
    const compartido = build(ordenParaHilo({ estatusValue: "ayuda_tienda" }));
    const { deps, ordenRepo, notaRepo } = compartido;

    // El mensajero, por «Recuperar».
    const solicitud = new SolicitudAyudaService(
      { publicar: vi.fn(async () => ({ status: "forbidden" as const })) },
      { ...ordenRepo, incrementarIntentoContacto: vi.fn(async () => 0) },
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

    expect(ordenRepo.transicionarAyuda).toHaveBeenCalledTimes(2);
    const [porRecuperar] = ordenRepo.transicionarAyuda.mock.calls[0]!;
    const [porHabilitar] = ordenRepo.transicionarAyuda.mock.calls[1]!;
    // Identicos salvo el actor: mismo origen, mismo destino, MISMA familia.
    expect({ ...porRecuperar, actorUsuarioId: "X" }).toEqual({
      ...porHabilitar,
      actorUsuarioId: "X",
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
    expect(ordenRepo.transicionarAyuda).toHaveBeenCalledTimes(1);
  });
});
