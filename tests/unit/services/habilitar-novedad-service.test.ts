import { describe, it, expect, vi } from "vitest";

import type {
  IOrdenNotaRepository,
  OrdenParaHilo,
} from "@/lib/interfaces/repositories/IOrdenNotaRepository";
import type { TransicionAyudaInput } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IOrdenNotaService } from "@/lib/interfaces/services/IOrdenNotaService";
import { HabilitarNovedadService } from "@/lib/services/HabilitarNovedadService";
import type { OrdenNotaDTO } from "@/lib/types/orden-nota";

// Pedido humano 2026-08-18 — el SERVICE de «HABILITAR» una novedad, con dobles. Sin DB, sin HTTP.
//
// Lo que estos tests vigilan NO es «que funcione»: es la unica propiedad delicada de un servicio de
// composicion, que es EL ORDEN. La nota lleva la autorizacion, asi que va primero; el efecto es
// consecuencia. Si alguien invierte las dos llamadas «porque da igual», el efecto es que una orden
// ajena queda retirada de `/novedades` por quien no podia tocarla. Por eso hay un test que mira el
// rechazo Y el repositorio a la vez.
//
// FEATURE 235 (T2.2, R8) — EL EFECTO CAMBIA: de apagar una bandera (`habilitarNovedad`) a llamar al
// PUNTO UNICO DE RESCATE, el mismo que usa «Recuperar» del lado del mensajero. La cobertura del
// rescate en si (guarda de estado, idempotencia, money-safe, las dos puertas) vive en
// `rescate-ayuda-service.test.ts`, que ataca esa funcion directamente; aqui se mide LA
// COMPOSICION: que la nota sigue siendo la puerta y que el efecto es el rescate.

const ORDEN = "11111111-1111-4111-8111-111111111111";
const TIENDA = "u-tienda";
const ID_AYUDA = "s-ayuda";
const ID_EN_REPARTO = "s-en-reparto";
const actorTienda: Actor = { usuarioId: TIENDA, rol: "adminTienda" };

const NOTA: OrdenNotaDTO = {
  id: "n1",
  cuerpo: "El cliente pidio reintentar",
  autorNombre: "Tienda Uno",
  rolAutor: "adminTienda",
  createdAt: "2026-08-18T10:00:00.000Z",
  esPropia: true,
  eliminada: false,
};

function ordenParaHilo(over: Partial<OrdenParaHilo> = {}): OrdenParaHilo {
  return {
    tiendaId: TIENDA,
    mensajeroAsignadoId: "u-mensajero",
    estatusValue: "ayuda_tienda",
    deletedAt: null,
    ...over,
  };
}

function build(
  publicar: IOrdenNotaService["publicar"],
  orden: OrdenParaHilo | null = ordenParaHilo(),
) {
  const repo = {
    findEstatusIdByValue: vi.fn(async (value: string) =>
      value === "ayuda_tienda" ? ID_AYUDA : value === "en_reparto" ? ID_EN_REPARTO : null,
    ),
    transicionarAyuda: vi.fn(async (_input: TransicionAyudaInput): Promise<boolean> => true),
  };
  const notaRepo: Pick<IOrdenNotaRepository, "findOrdenParaHilo"> = {
    findOrdenParaHilo: vi.fn(async () => orden),
  };
  const service = new HabilitarNovedadService({ publicar }, repo, notaRepo);
  return { service, repo, notaRepo };
}

describe("HabilitarNovedadService.habilitar", () => {
  it("235/R8: publica la nota en el hilo y RESCATA la orden por el punto unico", async () => {
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
    // Y el efecto es la MISMA transicion que produce «Recuperar», con la tienda como actor.
    expect(repo.transicionarAyuda).toHaveBeenCalledWith({
      ordenId: ORDEN,
      estatusOrigenId: ID_AYUDA,
      estatusDestinoId: ID_EN_REPARTO,
      actorUsuarioId: TIENDA,
      origenTipo: "rescate_ayuda_tienda",
    });
  });

  it("la nota va PRIMERO: es la que lleva la autorizacion", async () => {
    const orden: string[] = [];
    const publicar = vi.fn(async () => {
      orden.push("publicar");
      return { status: "ok" as const, nota: NOTA };
    });
    const { service, repo } = build(publicar);
    repo.transicionarAyuda.mockImplementation(async () => {
      orden.push("rescatar");
      return true;
    });

    await service.habilitar({ ordenId: ORDEN, nota: "ya esta" }, actorTienda);

    expect(orden).toEqual(["publicar", "rescatar"]);
  });

  it("si el hilo RECHAZA, no rescata nada y devuelve su mismo resultado", async () => {
    // La puerta es la del hilo: rol sin acceso, orden de otra tienda, orden inexistente o fuera de
    // la ventana del rol llegan aqui como el MISMO `forbidden` opaco.
    const publicar = vi.fn(async () => ({ status: "forbidden" as const }));
    const { service, repo } = build(publicar);

    const r = await service.habilitar({ ordenId: ORDEN, nota: "da igual" }, actorTienda);

    expect(r).toEqual({ status: "forbidden" });
    expect(repo.transicionarAyuda).not.toHaveBeenCalled();
  });

  it("una nota vacia tras recortar la rechaza el hilo, y tampoco rescata nada", async () => {
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
    expect(repo.transicionarAyuda).not.toHaveBeenCalled();
  });

  it("235/R9: es idempotente — el segundo «Habilitar» publica su nota y NO transiciona", async () => {
    // Idempotencia POR CONSTRUCCION: la guarda de estado del punto unico rechaza la orden que ya
    // volvio a `en_reparto`. Las dos notas quedan en el hilo, que es lo que de verdad paso.
    const publicar = vi.fn(async () => ({ status: "ok" as const, nota: NOTA }));
    const primera = build(publicar, ordenParaHilo({ estatusValue: "ayuda_tienda" }));
    const segunda = build(publicar, ordenParaHilo({ estatusValue: "en_reparto" }));

    await primera.service.habilitar({ ordenId: ORDEN, nota: "una" }, actorTienda);
    await segunda.service.habilitar({ ordenId: ORDEN, nota: "otra" }, actorTienda);

    expect(publicar).toHaveBeenCalledTimes(2);
    expect(primera.repo.transicionarAyuda).toHaveBeenCalledTimes(1);
    expect(segunda.repo.transicionarAyuda).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------------
// Feature 239 (T3.6, R23) — «HABILITAR» YA NO PUEDE ESCONDER UNA DEVOLUCION CON EL RELOJ VIVO.
//
// EL FALLO QUE CIERRA (auditoria §2.2). Hasta el 2026-08-19 este servicio apagaba DOS banderas, y
// una de ellas (`gestion_aprobada`) era la que `novedadWhere` exigia para listar una devolucion.
// Al pulsar «Habilitar», la fila desaparecia de `/novedades`... y la orden SEGUIA en `devuelta`,
// asi que seguia siendo candidata del cron de SLA. A los 5 dias se escalaba a `rechazada` y
// disparaba el ingreso de bodega por rechazo: dinero cobrado a la tienda por una orden que ella
// misma habia dado por gestionada, sin ningun aviso.
//
// COMO SE CIERRA, y es lo importante: NO con una comprobacion nueva que alguien tenga que
// recordar, sino RETIRANDO la palanca. La rama de la devolucion en `novedadWhere` es una igualdad
// de estado, asi que ninguna bandera puede sacarla de la pantalla — y desde la 235 ya NO QUEDA
// NINGUNA BANDERA que apagar.
// ---------------------------------------------------------------------------------------------
describe("239/R23 + 235 — habilitar retira la AYUDA, y NUNCA una devolucion", () => {
  it("sobre una devolucion ANCLADA (`devuelta`): publica la nota y NO mueve el estatus", async () => {
    // Es el caso que junta las dos fichas. La guarda de estado del rescate rechaza todo lo que no
    // sea `ayuda_tienda`, asi que «Habilitar» sobre una devuelta es exactamente lo que era antes:
    // una nota en el hilo y nada mas. Que la orden deba ademas MOVERSE, y adonde, lo decide la
    // ficha 240 (puerta humana del 2026-08-19), no un cambio suelto aqui.
    const publicar = vi.fn(async () => ({ status: "ok" as const, nota: NOTA }));
    const { service, repo } = build(publicar, ordenParaHilo({ estatusValue: "devuelta" }));

    const r = await service.habilitar(
      { ordenId: ORDEN, nota: "hablamos con el cliente" },
      actorTienda,
    );

    // El resultado sigue siendo el de la NOTA: la puerta es la nota, no el rescate.
    expect(r).toEqual({ status: "ok", nota: NOTA });
    expect(publicar).toHaveBeenCalledTimes(1);
    expect(repo.transicionarAyuda).not.toHaveBeenCalled();
  });

  it("235: este servicio NO tiene ninguna via para apagar una marca persistida", async () => {
    // El `Pick` del constructor es lo que lo impone. Hasta el 2026-08-19 conocia
    // `habilitarNovedad`, el `update` ciego a `ayuda = false`; hoy conoce el punto unico y el
    // resolvedor del catalogo, y nada mas. Si alguien repusiera un apagador, esto cae.
    const publicar = vi.fn(async () => ({ status: "ok" as const, nota: NOTA }));
    const { service, repo } = build(publicar);

    await service.habilitar({ ordenId: ORDEN, nota: "cerrada" }, actorTienda);

    expect(Object.keys(repo).sort()).toEqual(["findEstatusIdByValue", "transicionarAyuda"]);
  });
});
