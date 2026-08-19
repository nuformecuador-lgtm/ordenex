import { describe, it, expect, vi } from "vitest";

import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IOrdenNotaService } from "@/lib/interfaces/services/IOrdenNotaService";
import { HabilitarNovedadService } from "@/lib/services/HabilitarNovedadService";
import type { OrdenNotaDTO } from "@/lib/types/orden-nota";

// Pedido humano 2026-08-18 — el SERVICE de «HABILITAR» una novedad, con dobles. Sin DB, sin HTTP.
//
// Lo que estos tests vigilan NO es «que funcione»: es la unica propiedad delicada de un servicio de
// composicion, que es EL ORDEN. La nota lleva la autorizacion, asi que va primero; apagar las
// banderas es consecuencia. Si alguien invierte las dos llamadas «porque da igual», el efecto es
// que una orden ajena queda retirada de `/novedades` por quien no podia tocarla. Por eso hay un
// test que mira el rechazo Y el repositorio a la vez.

const ORDEN = "11111111-1111-4111-8111-111111111111";
const actorTienda: Actor = { usuarioId: "u-tienda", rol: "adminTienda" };

const NOTA: OrdenNotaDTO = {
  id: "n1",
  cuerpo: "El cliente pidio reintentar",
  autorNombre: "Tienda Uno",
  rolAutor: "adminTienda",
  createdAt: "2026-08-18T10:00:00.000Z",
  esPropia: true,
  eliminada: false,
};

function build(publicar: IOrdenNotaService["publicar"]) {
  const repo = { habilitarNovedad: vi.fn(async (): Promise<void> => {}) };
  const service = new HabilitarNovedadService({ publicar }, repo);
  return { service, repo };
}

describe("HabilitarNovedadService.habilitar", () => {
  it("publica la nota en el hilo y apaga las banderas de novedad", async () => {
    const publicar = vi.fn(async () => ({ status: "ok" as const, nota: NOTA }));
    const { service, repo } = build(publicar);

    const r = await service.habilitar(
      { ordenId: ORDEN, nota: "El cliente pidio reintentar" },
      actorTienda,
    );

    expect(r).toEqual({ status: "ok", nota: NOTA });
    // La nota viaja como CUERPO, con el actor de la sesion. El autor no viaja en el input.
    expect(publicar).toHaveBeenCalledWith(
      { ordenId: ORDEN, cuerpo: "El cliente pidio reintentar" },
      actorTienda,
    );
    expect(repo.habilitarNovedad).toHaveBeenCalledWith(ORDEN);
  });

  it("si el hilo RECHAZA, no apaga ninguna bandera y devuelve su mismo resultado", async () => {
    // La puerta es la del hilo: rol sin acceso, orden de otra tienda, orden inexistente o fuera de
    // la ventana `devuelta` llegan aqui como el MISMO `forbidden` opaco.
    const publicar = vi.fn(async () => ({ status: "forbidden" as const }));
    const { service, repo } = build(publicar);

    const r = await service.habilitar({ ordenId: ORDEN, nota: "da igual" }, actorTienda);

    expect(r).toEqual({ status: "forbidden" });
    expect(repo.habilitarNovedad).not.toHaveBeenCalled();
  });

  it("una nota vacia tras recortar la rechaza el hilo, y tampoco apaga nada", async () => {
    const publicar = vi.fn(async () => ({
      status: "validation_error" as const,
      fieldErrors: { cuerpo: ["la nota es obligatoria"] },
    }));
    const { service, repo } = build(publicar);

    const r = await service.habilitar({ ordenId: ORDEN, nota: "   " }, actorTienda);

    expect(r).toEqual({
      status: "validation_error",
      fieldErrors: { cuerpo: ["la nota es obligatoria"] },
    });
    expect(repo.habilitarNovedad).not.toHaveBeenCalled();
  });

  it("es idempotente: habilitar dos veces publica dos notas y apaga dos veces", async () => {
    const publicar = vi.fn(async () => ({ status: "ok" as const, nota: NOTA }));
    const { service, repo } = build(publicar);

    await service.habilitar({ ordenId: ORDEN, nota: "una" }, actorTienda);
    await service.habilitar({ ordenId: ORDEN, nota: "otra" }, actorTienda);

    // Las dos notas quedan en el hilo (es lo que de verdad paso); el estado final de la orden es
    // el mismo que tras la primera. Ninguna de las dos escrituras necesita saber de la otra.
    expect(publicar).toHaveBeenCalledTimes(2);
    expect(repo.habilitarNovedad).toHaveBeenCalledTimes(2);
  });
});
