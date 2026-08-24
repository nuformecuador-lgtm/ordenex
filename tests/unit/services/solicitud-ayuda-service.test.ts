import { describe, it, expect, vi } from "vitest";

import type {
  IOrdenNotaRepository,
  OrdenParaHilo,
} from "@/lib/interfaces/repositories/IOrdenNotaRepository";
import type { TransicionAyudaInput } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IOrdenNotaService } from "@/lib/interfaces/services/IOrdenNotaService";
import { SolicitudAyudaService } from "@/lib/services/SolicitudAyudaService";
import type { OrdenNotaDTO } from "@/lib/types/orden-nota";
import { VENTANA_ESCRITURA } from "@/lib/types/ventana-hilo-notas";

// Pedido humano 2026-08-18 — el SERVICE de la SOLICITUD DE AYUDA, con dobles. Sin DB, sin HTTP.
//
// Lo que estos tests vigilan NO es «que funcione»: es la unica propiedad delicada de un servicio
// de composicion, que es EL ORDEN. La nota lleva la autorizacion, asi que va primero; el efecto es
// consecuencia. Si algun dia alguien invierte las dos llamadas «porque da igual», el efecto es que
// una orden ajena —o una fuera de reparto— se mueve igual y aparece en `/novedades` de una tienda
// que no la pidio. Por eso hay un test que mira el rechazo Y el repositorio a la vez.
//
// FEATURE 235 (T2.1, 2026-08-19) — EL EFECTO CAMBIA, LA FORMA NO. Donde habia `marcarAyuda(id)`
// —un `update` ciego a una bandera booleana— hay ahora una TRANSICION `en_reparto -> ayuda_tienda`
// GUARDADA POR EL ESTADO en el WHERE. Los casos de abajo no se reescribieron: se les cambio el
// efecto que miran, y se les sumaron los que la transicion hace posibles (la guarda de origen, el
// money-safe del `data`, el actor y la familia del historial).

const MENSAJERO = "u-mensajero";
const ORDEN = "11111111-1111-4111-8111-111111111111";
const ID_EN_REPARTO = "s-en-reparto";
const ID_AYUDA = "s-ayuda";

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
    // estos tests se mueven con ella en vez de quedarse afirmando un literal caducado. Desde la
    // 235 es una LISTA por rol; `[0]` es `en_reparto`, el estado desde el que se pide ayuda.
    estatusValue: VENTANA_ESCRITURA.mensajero[0],
    deletedAt: null,
    // Feature 261 (B15): `fechaReparto` es OBLIGATORIO en `OrdenParaHilo` (insumo de la puerta
    // A de la via de la tienda). `null` = sin reserva, el caso por defecto.
    fechaReparto: null,
    ...over,
  };
}

function build(
  publicar: IOrdenNotaService["publicar"],
  orden: OrdenParaHilo | null = ordenParaHilo(),
  /** Catalogo resuelto. `null` en alguno = seed incompleto (fallo cerrado, design §3.3). */
  catalogo: Record<string, string | null> = { en_reparto: ID_EN_REPARTO, ayuda_tienda: ID_AYUDA },
) {
  const repo = {
    findEstatusIdByValue: vi.fn(async (value: string) => catalogo[value] ?? null),
    transicionarAyuda: vi.fn(async (_input: TransicionAyudaInput): Promise<boolean> => true),
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
  it("235/R2: publica el motivo como nota del hilo y deja la orden en `ayuda_tienda`", async () => {
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
    // 235/R10: la escritura es la transicion, con el ORIGEN guardado, el destino, el actor REAL y
    // la familia propia de la IDA. Igualdad EXACTA, no `toMatchObject`: un campo de mas aqui es un
    // efecto que nadie decidio.
    expect(repo.transicionarAyuda).toHaveBeenCalledWith({
      ordenId: ORDEN,
      estatusOrigenId: ID_EN_REPARTO,
      estatusDestinoId: ID_AYUDA,
      actorUsuarioId: MENSAJERO,
      origenTipo: "solicitud_ayuda_tienda",
    });
  });

  it("235/R3: publica la nota ANTES de transicionar (la nota es la que lleva la autorizacion)", async () => {
    const orden: string[] = [];
    const publicar = vi.fn(async () => {
      orden.push("publicar");
      return { status: "ok" as const, nota: NOTA };
    });
    const { service, repo } = build(publicar);
    repo.transicionarAyuda.mockImplementation(async () => {
      orden.push("transicionar");
      return true;
    });

    await service.solicitar({ ordenId: ORDEN, motivo: "no hay nadie" }, actorMensajero);

    // El orden importa y por eso se mide: invertirlo ataria la nota a una ventana que la orden ya
    // habria abandonado.
    expect(orden).toEqual(["publicar", "transicionar"]);
  });

  it("235/R4: rechazo del hilo (`forbidden`): la orden NO se mueve y devuelve el mismo resultado", async () => {
    const publicar = vi.fn(async () => ({ status: "forbidden" as const }));
    const { service, repo } = build(publicar);

    const r = await service.solicitar({ ordenId: ORDEN, motivo: "algo" }, actorMensajero);

    expect(r).toEqual({ status: "forbidden" });
    // ESTA es la afirmacion que sostiene el orden de las dos escrituras.
    expect(repo.transicionarAyuda).not.toHaveBeenCalled();
  });

  it("235/R4/R5: motivo que queda vacio al recortar: el hilo lo rechaza y la orden NO se mueve", async () => {
    const publicar = vi.fn(async () => ({
      status: "validation_error" as const,
      fieldErrors: { cuerpo: ["El cuerpo no puede estar vacio."] },
    }));
    const { service, repo } = build(publicar);

    const r = await service.solicitar({ ordenId: ORDEN, motivo: "   " }, actorMensajero);

    expect(r).toMatchObject({ status: "validation_error" });
    expect(repo.transicionarAyuda).not.toHaveBeenCalled();
  });

  it("235/R6/R13 (MONEY-SAFE): la transicion NO lleva mensajero, ni montos, ni prioridad", async () => {
    // El `data` real del `updateMany` vive en el repo y se mide alli; lo que se mide AQUI es que
    // el service no le pide nada mas que el cambio de estatus. Las claves del input son EXACTAS:
    // si alguien anadiera `mensajeroAsignadoId: null` «para limpiar», este caso cae.
    const publicar = vi.fn(async () => ({ status: "ok" as const, nota: NOTA }));
    const { service, repo } = build(publicar);

    await service.solicitar({ ordenId: ORDEN, motivo: "x" }, actorMensajero);

    const input = repo.transicionarAyuda.mock.calls[0]![0];
    expect(Object.keys(input).sort()).toEqual([
      "actorUsuarioId",
      "estatusDestinoId",
      "estatusOrigenId",
      "ordenId",
      "origenTipo",
    ]);
  });

  // Pedido humano 2026-08-18 — pedir ayuda es declarar que con esta orden no se puede seguir
  // ahora. Si siguiera ocupando el puntero 1-a-1, el mensajero se quedaria sin poder escoger
  // ninguna otra hasta cancelar a mano una gestion que ya decidio no continuar.
  it("235/R7: suelta el puntero 1-a-1 DEL ACTOR sobre ESTA orden, para que el panel tome la siguiente", async () => {
    const publicar = vi.fn(async () => ({ status: "ok" as const, nota: NOTA }));
    const { service, gestionRepo } = build(publicar);

    await service.solicitar({ ordenId: ORDEN, motivo: "no hay nadie" }, actorMensajero);

    // El repo exige en su WHERE que el puntero sea del actor Y apunte a esta orden: por eso
    // los DOS argumentos importan, y por eso no hace falta preguntar antes si habia gestion.
    // Ni el de otro usuario, ni uno que apunte a otra orden (R7 literal).
    expect(gestionRepo.liberarOrdenEnGestion).toHaveBeenCalledWith(MENSAJERO, ORDEN);
    expect(gestionRepo.liberarOrdenEnGestion).toHaveBeenCalledTimes(1);
  });

  it("rechazada la solicitud, el puntero NO se toca: la gestion en curso sigue donde estaba", async () => {
    const publicar = vi.fn(async () => ({ status: "forbidden" as const }));
    const { service, gestionRepo } = build(publicar);

    await service.solicitar({ ordenId: ORDEN, motivo: "algo" }, actorMensajero);

    expect(gestionRepo.liberarOrdenEnGestion).not.toHaveBeenCalled();
  });

  it("235/R2: si la orden ya salio de reparto, la guarda de origen no mueve nada (0 filas, sin append)", async () => {
    // La guarda vive EN EL WHERE del repo, no en un `if` previo: el service llama igual y el repo
    // devuelve `false`. Lo que se afirma aqui es que el service NO reinterpreta ese `false` —no
    // reintenta, no publica una segunda nota, no rompe— y que el origen que pidio sigue siendo
    // `en_reparto` (nunca «el estado que tenga»).
    const publicar = vi.fn(async () => ({ status: "ok" as const, nota: NOTA }));
    const { service, repo } = build(publicar);
    repo.transicionarAyuda.mockResolvedValue(false); // el corte la barrio entre medias

    const r = await service.solicitar({ ordenId: ORDEN, motivo: "x" }, actorMensajero);

    expect(r).toEqual({ status: "ok", nota: NOTA });
    expect(repo.transicionarAyuda.mock.calls[0]![0].estatusOrigenId).toBe(ID_EN_REPARTO);
    expect(repo.transicionarAyuda).toHaveBeenCalledTimes(1);
  });

  it("235 (design §3.3) FALLO CERRADO: catalogo incompleto -> ni nota ni transicion", async () => {
    // Se resuelve el catalogo ANTES de publicar precisamente para esto: si se resolviera despues,
    // el hilo quedaria diciendo «pedi ayuda» sobre una orden que sigue en la ruta.
    const publicar = vi.fn(async () => ({ status: "ok" as const, nota: NOTA }));
    const { service, repo } = build(publicar, ordenParaHilo(), {
      en_reparto: ID_EN_REPARTO,
      ayuda_tienda: null, // el seed no tiene el value nuevo
    });

    const r = await service.solicitar({ ordenId: ORDEN, motivo: "x" }, actorMensajero);

    expect(r).toEqual({ status: "forbidden" });
    expect(publicar).not.toHaveBeenCalled();
    expect(repo.transicionarAyuda).not.toHaveBeenCalled();
  });

  it("235: pedir ayuda dos veces suma un motivo al hilo y la segunda no mueve la orden", async () => {
    // Cambia respecto de la bandera y hay que decirlo: la ventana del mensajero incluye
    // `ayuda_tienda`, asi que la SEGUNDA nota SI se acepta —lo que el mensajero suele necesitar la
    // segunda vez es AÑADIR contexto— y la transicion, guardada por `en_reparto`, no encuentra
    // nada que mover.
    const publicar = vi.fn(async () => ({ status: "ok" as const, nota: NOTA }));
    const { service, repo } = build(publicar);
    repo.transicionarAyuda.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await service.solicitar({ ordenId: ORDEN, motivo: "uno" }, actorMensajero);
    await service.solicitar({ ordenId: ORDEN, motivo: "dos" }, actorMensajero);

    expect(publicar).toHaveBeenCalledTimes(2);
    expect(repo.transicionarAyuda).toHaveBeenCalledTimes(2);
    // Y las dos veces con el MISMO origen guardado: la segunda no se "adapta" al estado actual.
    expect(repo.transicionarAyuda.mock.calls[1]![0].estatusOrigenId).toBe(ID_EN_REPARTO);
  });

  // -----------------------------------------------------------------------------------------
  // P9 (FIRMADA el 2026-08-19): SOLO EL MENSAJERO ASIGNADO PIDE AYUDA — y se resuelve en la
  // VENTANA, no con un `if` de rol. Este caso mide la composicion, no el `if` que no existe.
  // -----------------------------------------------------------------------------------------
  it("235/P9: la tienda NO puede pedir ayuda sobre una orden en reparto — la ventana la para", async () => {
    // `en_reparto` NO esta en la ventana del `adminTienda`, asi que `publicar` responde
    // `forbidden` y aqui no se mueve nada. La guarda es la MISMA que protege el hilo: no hay una
    // segunda tabla de permisos.
    expect(VENTANA_ESCRITURA.adminTienda as readonly string[]).not.toContain("en_reparto");
    const publicar = vi.fn(async () => ({ status: "forbidden" as const }));
    const { service, repo } = build(publicar);

    const r = await service.solicitar({ ordenId: ORDEN, motivo: "x" }, actorTienda);

    expect(r).toEqual({ status: "forbidden" });
    expect(repo.transicionarAyuda).not.toHaveBeenCalled();
  });

  it("235/R25: un mensajero BLOQUEADO por un cierre sin resolver PUEDE pedir ayuda", async () => {
    // No se comprueba `estaBloqueado` y es una decision, no un olvido: anadirla crearia un
    // DEADLOCK con R22 —la orden en ayuda le bloquea el cierre, y sin poder pedirla ni rescatarla
    // no podria desbloquearse nunca—. El service no conoce el bloqueo, y eso es lo que se afirma:
    // no hay ninguna dependencia de cierres en su constructor.
    const publicar = vi.fn(async () => ({ status: "ok" as const, nota: NOTA }));
    const { service, repo } = build(publicar);

    const r = await service.solicitar({ ordenId: ORDEN, motivo: "x" }, actorMensajero);

    expect(r).toEqual({ status: "ok", nota: NOTA });
    expect(repo.transicionarAyuda).toHaveBeenCalledTimes(1);
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

  // LA AFIRMACION QUE SOSTIENE QUE EL BOTON SEA EJERCITABLE. Este boton se pinta sobre la orden
  // que esta en `/novedades`, y el contador es CUMULATIVO: sobrevive deliberadamente a que la
  // solicitud se retire. Si alguien "arregla" el service añadiendole la comprobacion de ventana
  // por simetria con el rescate, el clic que llega justo despues de «Recuperar» empezaria a
  // fallar por un intento que de verdad ocurrio — y esto se pone rojo antes.
  it("235: se registra igual con la orden EN REPARTO (el contador no se ata a ningun estado)", async () => {
    const { service, repo } = build(publicar(), ordenParaHilo({ estatusValue: "en_reparto" }));

    const r = await service.registrarIntentoContacto({ ordenId: ORDEN }, actorTienda);

    expect(r).toMatchObject({ status: "ok" });
    expect(repo.incrementarIntentoContacto).toHaveBeenCalledWith(ORDEN);
  });

  it("235: y tambien con la orden en `ayuda_tienda`, que es donde vive el boton", async () => {
    const { service, repo } = build(publicar(), ordenParaHilo({ estatusValue: "ayuda_tienda" }));

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

// =================================================================================================
// «Recuperar» — 235/R8: aqui SOLO se afirma la DELEGACION en el punto unico de rescate. Toda la
// cobertura del rescate (guarda de estado, idempotencia, las dos puertas, money-safe) vive en
// `tests/unit/services/rescate-ayuda-service.test.ts`, que ataca esa funcion directamente.
// Duplicarla aqui seria escribir dos veces la misma verdad y dejar que una de las dos envejezca.
// =================================================================================================
describe("SolicitudAyudaService.recuperar — delega en el punto unico (R8)", () => {
  it("con la orden en `ayuda_tienda`, rescata: `ayuda_tienda -> en_reparto` con la familia de la VUELTA", async () => {
    const publicar = vi.fn(async () => ({ status: "forbidden" as const }));
    const { service, repo } = build(publicar, ordenParaHilo({ estatusValue: "ayuda_tienda" }), {
      ayuda_tienda: ID_AYUDA,
      en_reparto: ID_EN_REPARTO,
    });

    const r = await service.recuperar({ ordenId: ORDEN }, actorMensajero);

    expect(r).toEqual({ status: "ok" });
    expect(repo.transicionarAyuda).toHaveBeenCalledWith({
      ordenId: ORDEN,
      estatusOrigenId: ID_AYUDA,
      estatusDestinoId: ID_EN_REPARTO,
      actorUsuarioId: MENSAJERO,
      origenTipo: "rescate_ayuda_tienda",
    });
    // Y NO toca el hilo: los motivos escritos siguen donde estan. Retirar la solicitud dice «ya no
    // necesito ayuda», no «esto nunca paso».
    expect(publicar).not.toHaveBeenCalled();
  });

  it("235/R9: sobre una orden que NO esta en ayuda, `forbidden` y NINGUNA escritura", async () => {
    const publicar = vi.fn(async () => ({ status: "forbidden" as const }));
    const { service, repo } = build(publicar, ordenParaHilo({ estatusValue: "en_reparto" }));

    const r = await service.recuperar({ ordenId: ORDEN }, actorMensajero);

    expect(r).toEqual({ status: "forbidden" });
    expect(repo.transicionarAyuda).not.toHaveBeenCalled();
  });

  it("retirar la solicitud NO devuelve la orden a la gestion en curso: eso se vuelve a escoger", async () => {
    const publicar = vi.fn(async () => ({ status: "forbidden" as const }));
    const { service, gestionRepo } = build(
      publicar,
      ordenParaHilo({ estatusValue: "ayuda_tienda" }),
    );

    await service.recuperar({ ordenId: ORDEN }, actorMensajero);

    expect(gestionRepo.liberarOrdenEnGestion).not.toHaveBeenCalled();
  });
});
