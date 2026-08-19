import { describe, it, expect, vi } from "vitest";

import type {
  IOrdenNotaRepository,
  OrdenParaHilo,
} from "@/lib/interfaces/repositories/IOrdenNotaRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IOrdenNotaService } from "@/lib/interfaces/services/IOrdenNotaService";
import { SolicitudAyudaService } from "@/lib/services/SolicitudAyudaService";
import type { OrdenNotaDTO } from "@/lib/types/orden-nota";
import { VENTANA_ESCRITURA } from "@/lib/types/ventana-hilo-notas";

// Pedido humano 2026-08-18 — el SERVICE de la SOLICITUD DE AYUDA, con dobles. Sin DB, sin HTTP.
//
// Lo que estos tests vigilan NO es «que funcione»: es la unica propiedad delicada de un servicio
// de composicion, que es EL ORDEN. La nota lleva la autorizacion, asi que va primero; la marca es
// consecuencia. Si algun dia alguien invierte las dos llamadas «porque da igual», el efecto es que
// una orden ajena —o una fuera de reparto— queda marcada igual y aparece en `/novedades` de una
// tienda que no la pidio. Por eso hay un test que mira el rechazo Y el repositorio a la vez.

const MENSAJERO = "u-mensajero";
const ORDEN = "11111111-1111-4111-8111-111111111111";

const actorMensajero: Actor = { usuarioId: MENSAJERO, rol: "mensajero" };
const actorTienda: Actor = { usuarioId: "u-tienda", rol: "adminTienda" };

const NOTA: OrdenNotaDTO = {
  id: "n1",
  cuerpo: "Nadie contesta y el porton esta cerrado",
  autorNombre: "Mensajero Uno",
  rolAutor: "mensajero",
  createdAt: "2026-08-18T10:00:00.000Z",
  esPropia: true,
  eliminada: false,
};

function ordenParaHilo(over: Partial<OrdenParaHilo> = {}): OrdenParaHilo {
  return {
    tiendaId: "u-tienda",
    mensajeroAsignadoId: MENSAJERO,
    // La ventana del mensajero, leida de la MISMA tabla que usa el codigo: si alguien la mueve,
    // estos tests se mueven con ella en vez de quedarse afirmando un literal caducado.
    estatusValue: VENTANA_ESCRITURA.mensajero,
    ayuda: false,
    deletedAt: null,
    ...over,
  };
}

function build(
  publicar: IOrdenNotaService["publicar"],
  orden: OrdenParaHilo | null = ordenParaHilo(),
) {
  const repo = {
    marcarAyuda: vi.fn(async (): Promise<void> => {}),
    desmarcarAyuda: vi.fn(async (): Promise<void> => {}),
    incrementarIntentoContacto: vi.fn(async (): Promise<number> => 3),
  };
  const notaRepo: Pick<IOrdenNotaRepository, "findOrdenParaHilo"> = {
    findOrdenParaHilo: vi.fn(async () => orden),
  };
  const gestionRepo = {
    liberarOrdenEnGestion: vi.fn(async () => true),
  };
  const service = new SolicitudAyudaService({ publicar }, repo, notaRepo, gestionRepo);
  return { service, repo, notaRepo, gestionRepo };
}

describe("SolicitudAyudaService.solicitar", () => {
  it("publica el motivo como nota del hilo y marca la orden", async () => {
    const publicar = vi.fn(async () => ({ status: "ok" as const, nota: NOTA }));
    const { service, repo } = build(publicar);

    const r = await service.solicitar(
      { ordenId: ORDEN, motivo: "Nadie contesta" },
      actorMensajero,
    );

    expect(r).toEqual({ status: "ok", nota: NOTA });
    // El motivo viaja como CUERPO de la nota, con el actor de la sesion. El autor no viaja.
    expect(publicar).toHaveBeenCalledWith(
      { ordenId: ORDEN, cuerpo: "Nadie contesta" },
      actorMensajero,
    );
    expect(repo.marcarAyuda).toHaveBeenCalledWith(ORDEN);
  });

  it("rechazo del hilo (`forbidden`): NO marca la orden y devuelve el mismo resultado", async () => {
    const publicar = vi.fn(async () => ({ status: "forbidden" as const }));
    const { service, repo } = build(publicar);

    const r = await service.solicitar({ ordenId: ORDEN, motivo: "algo" }, actorMensajero);

    expect(r).toEqual({ status: "forbidden" });
    // ESTA es la afirmacion que sostiene el orden de las dos escrituras.
    expect(repo.marcarAyuda).not.toHaveBeenCalled();
  });

  it("motivo que queda vacio al recortar: el hilo lo rechaza y la orden NO queda marcada", async () => {
    const publicar = vi.fn(async () => ({
      status: "validation_error" as const,
      fieldErrors: { cuerpo: ["El cuerpo no puede estar vacio."] },
    }));
    const { service, repo } = build(publicar);

    const r = await service.solicitar({ ordenId: ORDEN, motivo: "   " }, actorMensajero);

    expect(r).toMatchObject({ status: "validation_error" });
    expect(repo.marcarAyuda).not.toHaveBeenCalled();
  });

  // Pedido humano 2026-08-18 — pedir ayuda es declarar que con esta orden no se puede seguir
  // ahora. Si siguiera ocupando el puntero 1-a-1, el mensajero se quedaria sin poder escoger
  // ninguna otra hasta cancelar a mano una gestion que ya decidio no continuar.
  it("suelta el puntero 1-a-1 DEL ACTOR sobre ESTA orden, para que el panel tome la siguiente", async () => {
    const publicar = vi.fn(async () => ({ status: "ok" as const, nota: NOTA }));
    const { service, gestionRepo } = build(publicar);

    await service.solicitar({ ordenId: ORDEN, motivo: "no hay nadie" }, actorMensajero);

    // El repo exige en su WHERE que el puntero sea del actor Y apunte a esta orden: por eso
    // los DOS argumentos importan, y por eso no hace falta preguntar antes si habia gestion.
    expect(gestionRepo.liberarOrdenEnGestion).toHaveBeenCalledWith(MENSAJERO, ORDEN);
  });

  it("rechazada la solicitud, el puntero NO se toca: la gestion en curso sigue donde estaba", async () => {
    const publicar = vi.fn(async () => ({ status: "forbidden" as const }));
    const { service, gestionRepo } = build(publicar);

    await service.solicitar({ ordenId: ORDEN, motivo: "algo" }, actorMensajero);

    expect(gestionRepo.liberarOrdenEnGestion).not.toHaveBeenCalled();
  });

  it("retirar la solicitud NO devuelve la orden a la gestion en curso: eso se vuelve a escoger", async () => {
    const publicar = vi.fn(async () => ({ status: "forbidden" as const }));
    const { service, gestionRepo } = build(publicar);

    await service.recuperar({ ordenId: ORDEN }, actorMensajero);

    expect(gestionRepo.liberarOrdenEnGestion).not.toHaveBeenCalled();
  });

  it("pedir ayuda dos veces suma un motivo al hilo y deja la marca encendida (idempotente)", async () => {
    const publicar = vi.fn(async () => ({ status: "ok" as const, nota: NOTA }));
    const { service, repo } = build(publicar);

    await service.solicitar({ ordenId: ORDEN, motivo: "uno" }, actorMensajero);
    await service.solicitar({ ordenId: ORDEN, motivo: "dos" }, actorMensajero);

    expect(publicar).toHaveBeenCalledTimes(2);
    expect(repo.marcarAyuda).toHaveBeenCalledTimes(2);
    expect(repo.marcarAyuda).toHaveBeenNthCalledWith(2, ORDEN);
  });
});

describe("SolicitudAyudaService.registrarIntentoContacto", () => {
  const publicar = () => vi.fn(async () => ({ status: "forbidden" as const }));

  it("suma uno y devuelve el valor QUE ESCRIBIO LA BASE, no el que calcule quien llama", async () => {
    // El doble devuelve 3: si el service inventara su propio numero (leer+sumar en memoria), este
    // test lo cazaria, y con el se iria la unica defensa contra dos pestañas pisandose.
    const { service, repo } = build(publicar());

    const r = await service.registrarIntentoContacto({ ordenId: ORDEN }, actorTienda);

    expect(r).toEqual({ status: "ok", intentosContacto: 3 });
    expect(repo.incrementarIntentoContacto).toHaveBeenCalledWith(ORDEN);
  });

  it("el MENSAJERO no lo toca: el contador es de la tienda y diria otra cosa si el sumara", async () => {
    const { service, repo, notaRepo } = build(publicar());

    const r = await service.registrarIntentoContacto({ ordenId: ORDEN }, actorMensajero);

    expect(r).toEqual({ status: "forbidden" });
    expect(notaRepo.findOrdenParaHilo).not.toHaveBeenCalled();
    expect(repo.incrementarIntentoContacto).not.toHaveBeenCalled();
  });

  it("orden de OTRA tienda: `forbidden` opaco y sin escritura", async () => {
    const { service, repo } = build(
      publicar(),
      ordenParaHilo({ tiendaId: "u-otra-tienda" }),
    );

    const r = await service.registrarIntentoContacto({ ordenId: ORDEN }, actorTienda);

    expect(r).toEqual({ status: "forbidden" });
    expect(repo.incrementarIntentoContacto).not.toHaveBeenCalled();
  });

  // LA AFIRMACION QUE SOSTIENE QUE EL BOTON SEA EJERCITABLE. La ventana de escritura del hilo
  // para el adminTienda es `devuelta`, y este boton se pinta sobre la orden que esta en
  // `/novedades` por tener AYUDA pedida, es decir viva EN REPARTO. Si alguien "arregla" el
  // service añadiendole la comprobacion de ventana por simetria con `recuperar`, el boton pasa a
  // estar siempre visible y siempre rechazado — y esto se pone rojo antes de que llegue a la
  // pantalla de nadie.
  it("orden EN REPARTO (fuera de la ventana del hilo): se registra igual", async () => {
    const { service, repo } = build(
      publicar(),
      ordenParaHilo({ estatusValue: "en_reparto" }),
    );

    const r = await service.registrarIntentoContacto({ ordenId: ORDEN }, actorTienda);

    expect(r).toMatchObject({ status: "ok" });
    expect(repo.incrementarIntentoContacto).toHaveBeenCalledWith(ORDEN);
  });

  it("orden inexistente: `forbidden`, sin tocar el contador", async () => {
    const { service, repo } = build(publicar(), null);

    const r = await service.registrarIntentoContacto({ ordenId: ORDEN }, actorTienda);

    expect(r).toEqual({ status: "forbidden" });
    expect(repo.incrementarIntentoContacto).not.toHaveBeenCalled();
  });
});

describe("SolicitudAyudaService.recuperar", () => {
  it("retira la solicitud y NO toca el hilo: los motivos escritos siguen ahi", async () => {
    const publicar = vi.fn(async () => ({ status: "forbidden" as const }));
    const { service, repo } = build(publicar);

    const r = await service.recuperar({ ordenId: ORDEN }, actorMensajero);

    expect(r).toEqual({ status: "ok" });
    expect(repo.desmarcarAyuda).toHaveBeenCalledWith(ORDEN);
    expect(publicar).not.toHaveBeenCalled();
  });

  it("orden de OTRO mensajero: `forbidden` opaco y sin escritura", async () => {
    const publicar = vi.fn(async () => ({ status: "forbidden" as const }));
    const { service, repo } = build(
      publicar,
      ordenParaHilo({ mensajeroAsignadoId: "u-otro" }),
    );

    const r = await service.recuperar({ ordenId: ORDEN }, actorMensajero);

    expect(r).toEqual({ status: "forbidden" });
    expect(repo.desmarcarAyuda).not.toHaveBeenCalled();
  });

  it("orden inexistente y orden borrada dan el MISMO `forbidden` (el borde no es un oraculo)", async () => {
    const publicar = vi.fn(async () => ({ status: "forbidden" as const }));
    const inexistente = build(publicar, null);
    const borrada = build(publicar, ordenParaHilo({ deletedAt: new Date() }));

    await expect(
      inexistente.service.recuperar({ ordenId: ORDEN }, actorMensajero),
    ).resolves.toEqual({ status: "forbidden" });
    await expect(
      borrada.service.recuperar({ ordenId: ORDEN }, actorMensajero),
    ).resolves.toEqual({ status: "forbidden" });
    expect(inexistente.repo.desmarcarAyuda).not.toHaveBeenCalled();
    expect(borrada.repo.desmarcarAyuda).not.toHaveBeenCalled();
  });

  it("fuera de la ventana de escritura del rol: `forbidden` y sin escritura", async () => {
    // La orden es suya, pero ya salio de reparto: quien no puede decir nada sobre la orden
    // tampoco puede declarar que la ayuda ya no hace falta.
    const publicar = vi.fn(async () => ({ status: "forbidden" as const }));
    const { service, repo } = build(publicar, ordenParaHilo({ estatusValue: "entregada" }));

    const r = await service.recuperar({ ordenId: ORDEN }, actorMensajero);

    expect(r).toEqual({ status: "forbidden" });
    expect(repo.desmarcarAyuda).not.toHaveBeenCalled();
  });

  it("un rol SIN hilo no llega ni a leer la orden", async () => {
    const publicar = vi.fn(async () => ({ status: "forbidden" as const }));
    const { service, repo, notaRepo } = build(publicar);

    const r = await service.recuperar(
      { ordenId: ORDEN },
      { usuarioId: "u-maestro", rol: "maestro" },
    );

    expect(r).toEqual({ status: "forbidden" });
    expect(notaRepo.findOrdenParaHilo).not.toHaveBeenCalled();
    expect(repo.desmarcarAyuda).not.toHaveBeenCalled();
  });

  it("la tienda duena retira la solicitud dentro de SU ventana (`devuelta`)", async () => {
    const publicar = vi.fn(async () => ({ status: "forbidden" as const }));
    const { service, repo } = build(
      publicar,
      ordenParaHilo({ estatusValue: VENTANA_ESCRITURA.adminTienda }),
    );

    const r = await service.recuperar({ ordenId: ORDEN }, actorTienda);

    expect(r).toEqual({ status: "ok" });
    expect(repo.desmarcarAyuda).toHaveBeenCalledWith(ORDEN);
  });
});
