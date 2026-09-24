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
// de composicion, que es EL ORDEN. La nota lleva la autorizacion, asi que va primero; el efecto es
// consecuencia. Si algun dia alguien invierte las dos llamadas «porque da igual», el efecto es que
// una orden ajena —o una fuera de reparto— se marca igual y aparece en `/novedades` de una tienda
// que no la pidio. Por eso hay un test que mira el rechazo Y el repositorio a la vez.
//
// FEATURE 235 (2026-08-19): el efecto era una TRANSICION `en_reparto -> ayuda_tienda` guardada por
// el estado en el WHERE.
//
// ⏳ 2026-09-23 (FICHA 454, T1.15, design §4) — EL EFECTO CAMBIA OTRA VEZ, LA FORMA NO. La ayuda deja
// de ser estatus y pasa a ser un HECHO: `registrarAyudaSolicitada` escribe el evento
// `ayuda_solicitada` (guardado por «en mano y sin ayuda abierta» bajo candado, en el repo) y la
// orden SIGUE `en_reparto`. Ya no hay catalogo que resolver, asi que el fallo cerrado del catalogo
// (235, design §3.3) desaparece con el. El orden nota -> efecto, el puntero 1-a-1 y P9 siguen igual.

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
    // La ventana del mensajero, leida de la MISMA tabla que usa el codigo. `[0]` es `en_reparto`,
    // el estado desde el que se pide ayuda.
    estatusValue: VENTANA_ESCRITURA.mensajero[0],
    ayudaAbierta: false,
    deletedAt: null,
    // Feature 261 (B15): `fechaReparto` es OBLIGATORIO en `OrdenParaHilo`.
    fechaReparto: null,
    ...over,
  };
}

function build(
  publicar: IOrdenNotaService["publicar"],
  orden: OrdenParaHilo | null = ordenParaHilo(),
) {
  const repo = {
    registrarAyudaSolicitada: vi.fn(
      async (_input: { ordenId: string; mensajeroId: string; actorRol: string }) => true,
    ),
    registrarAyudaResuelta: vi.fn(
      async (_input: {
        ordenId: string;
        tipo: "ayuda_rescatada" | "ayuda_habilitada_api";
        actorUsuarioId: string;
        actorRol: string;
      }) => true,
    ),
    incrementarIntentoContacto: vi.fn(async (): Promise<number> => 3),
  };
  const notaRepo: Pick<IOrdenNotaRepository, "findOrdenParaHilo"> = {
    findOrdenParaHilo: vi.fn(async () => orden),
  };
  const gestionRepo = {
    liberarOrdenEnGestion: vi.fn(async () => true),
  };
  const service = new SolicitudAyudaService({ publicar }, repo as never, notaRepo, gestionRepo);
  return { service, repo, notaRepo, gestionRepo };
}

describe("SolicitudAyudaService.solicitar", () => {
  it("235/R2 → 454/R21: publica el motivo como nota del hilo y registra la ayuda SOLICITADA", async () => {
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
    // Igualdad EXACTA, no `toMatchObject`: un campo de mas aqui es un efecto que nadie decidio.
    // El mensajero de la ayuda es el ACTOR (solo el asignado pasa la ventana, P9).
    expect(repo.registrarAyudaSolicitada).toHaveBeenCalledWith({
      ordenId: ORDEN,
      mensajeroId: MENSAJERO,
      actorRol: "mensajero",
    });
  });

  it("235/R3: publica la nota ANTES de registrar la ayuda (la nota es la que lleva la autorizacion)", async () => {
    const orden: string[] = [];
    const publicar = vi.fn(async () => {
      orden.push("publicar");
      return { status: "ok" as const, nota: NOTA };
    });
    const { service, repo } = build(publicar);
    repo.registrarAyudaSolicitada.mockImplementation(async () => {
      orden.push("registrar");
      return true;
    });

    await service.solicitar({ ordenId: ORDEN, motivo: "no hay nadie" }, actorMensajero);

    expect(orden).toEqual(["publicar", "registrar"]);
  });

  it("235/R4: rechazo del hilo (`forbidden`): no se registra nada y devuelve el mismo resultado", async () => {
    const publicar = vi.fn(async () => ({ status: "forbidden" as const }));
    const { service, repo } = build(publicar);

    const r = await service.solicitar({ ordenId: ORDEN, motivo: "algo" }, actorMensajero);

    expect(r).toEqual({ status: "forbidden" });
    // ESTA es la afirmacion que sostiene el orden de las dos escrituras.
    expect(repo.registrarAyudaSolicitada).not.toHaveBeenCalled();
  });

  it("235/R4/R5: motivo que queda vacio al recortar: el hilo lo rechaza y no se registra nada", async () => {
    const publicar = vi.fn(async () => ({
      status: "validation_error" as const,
      fieldErrors: { cuerpo: ["El cuerpo no puede estar vacio."] },
    }));
    const { service, repo } = build(publicar);

    const r = await service.solicitar({ ordenId: ORDEN, motivo: "   " }, actorMensajero);

    expect(r).toMatchObject({ status: "validation_error" });
    expect(repo.registrarAyudaSolicitada).not.toHaveBeenCalled();
  });

  it("235/R6/R13 (MONEY-SAFE): el registro NO lleva montos, ni prioridad, ni estatus", async () => {
    // Las claves del input son EXACTAS: si alguien anadiera un estatus destino o
    // `mensajeroAsignadoId: null` «para limpiar», este caso cae.
    const publicar = vi.fn(async () => ({ status: "ok" as const, nota: NOTA }));
    const { service, repo } = build(publicar);

    await service.solicitar({ ordenId: ORDEN, motivo: "x" }, actorMensajero);

    const input = repo.registrarAyudaSolicitada.mock.calls[0]![0];
    expect(Object.keys(input).sort()).toEqual(["actorRol", "mensajeroId", "ordenId"]);
  });

  // Pedido humano 2026-08-18 — pedir ayuda es declarar que con esta orden no se puede seguir
  // ahora. Si siguiera ocupando el puntero 1-a-1, el mensajero se quedaria sin poder escoger
  // ninguna otra hasta cancelar a mano una gestion que ya decidio no continuar.
  it("235/R7: suelta el puntero 1-a-1 DEL ACTOR sobre ESTA orden, para que el panel tome la siguiente", async () => {
    const publicar = vi.fn(async () => ({ status: "ok" as const, nota: NOTA }));
    const { service, gestionRepo } = build(publicar);

    await service.solicitar({ ordenId: ORDEN, motivo: "no hay nadie" }, actorMensajero);

    expect(gestionRepo.liberarOrdenEnGestion).toHaveBeenCalledWith(MENSAJERO, ORDEN);
    expect(gestionRepo.liberarOrdenEnGestion).toHaveBeenCalledTimes(1);
  });

  it("rechazada la solicitud, el puntero NO se toca: la gestion en curso sigue donde estaba", async () => {
    const publicar = vi.fn(async () => ({ status: "forbidden" as const }));
    const { service, gestionRepo } = build(publicar);

    await service.solicitar({ ordenId: ORDEN, motivo: "algo" }, actorMensajero);

    expect(gestionRepo.liberarOrdenEnGestion).not.toHaveBeenCalled();
  });

  it("454/R21: si la orden ya no admite ayuda, el repo devuelve `false` y el service NO lo reinterpreta", async () => {
    // La guarda vive EN EL REPO (candado + re-lectura: en mano y sin ayuda abierta), no en un `if`
    // previo. Lo que se afirma aqui es que el service no reintenta, no publica una segunda nota y
    // no rompe. La guarda misma la mide `tests/integration/db/454/ayuda-evento-sql-real.test.ts`.
    const publicar = vi.fn(async () => ({ status: "ok" as const, nota: NOTA }));
    const { service, repo } = build(publicar);
    repo.registrarAyudaSolicitada.mockResolvedValue(false); // el corte la barrio entre medias

    const r = await service.solicitar({ ordenId: ORDEN, motivo: "x" }, actorMensajero);

    expect(r).toEqual({ status: "ok", nota: NOTA });
    expect(repo.registrarAyudaSolicitada).toHaveBeenCalledTimes(1);
    expect(publicar).toHaveBeenCalledTimes(1);
  });

  it("454: pedir ayuda dos veces suma un motivo al hilo y la segunda no abre otra ayuda", async () => {
    // La ventana del mensajero sigue abierta en `en_reparto`, asi que la SEGUNDA nota SI se acepta
    // —lo que el mensajero suele necesitar la segunda vez es AÑADIR contexto— y el registro,
    // guardado por «sin ayuda abierta», no escribe un segundo evento (`false`).
    const publicar = vi.fn(async () => ({ status: "ok" as const, nota: NOTA }));
    const { service, repo } = build(publicar);
    repo.registrarAyudaSolicitada.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await service.solicitar({ ordenId: ORDEN, motivo: "uno" }, actorMensajero);
    await service.solicitar({ ordenId: ORDEN, motivo: "dos" }, actorMensajero);

    expect(publicar).toHaveBeenCalledTimes(2);
    expect(repo.registrarAyudaSolicitada).toHaveBeenCalledTimes(2);
  });

  // -----------------------------------------------------------------------------------------
  // P9 (FIRMADA el 2026-08-19): SOLO EL MENSAJERO ASIGNADO PIDE AYUDA — y se resuelve en la
  // VENTANA, no con un `if` de rol. Este caso mide la composicion, no el `if` que no existe.
  // -----------------------------------------------------------------------------------------
  it("235/P9: la tienda NO puede pedir ayuda sobre una orden en reparto — la ventana la para", async () => {
    expect(VENTANA_ESCRITURA.adminTienda as readonly string[]).not.toContain("en_reparto");
    const publicar = vi.fn(async () => ({ status: "forbidden" as const }));
    const { service, repo } = build(publicar);

    const r = await service.solicitar({ ordenId: ORDEN, motivo: "x" }, actorTienda);

    expect(r).toEqual({ status: "forbidden" });
    expect(repo.registrarAyudaSolicitada).not.toHaveBeenCalled();
  });

  it("235/R25: un mensajero BLOQUEADO por un cierre sin resolver PUEDE pedir ayuda", async () => {
    // No se comprueba `estaBloqueado` y es una decision, no un olvido (deadlock con R22). El service
    // no conoce el bloqueo: no hay ninguna dependencia de cierres en su constructor.
    const publicar = vi.fn(async () => ({ status: "ok" as const, nota: NOTA }));
    const { service, repo } = build(publicar);

    const r = await service.solicitar({ ordenId: ORDEN, motivo: "x" }, actorMensajero);

    expect(r).toEqual({ status: "ok", nota: NOTA });
    expect(repo.registrarAyudaSolicitada).toHaveBeenCalledTimes(1);
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

  // ⏳ 2026-09-23 (FICHA 454): «en `ayuda_tienda`» pasa a ser `en_reparto` con la ayuda ABIERTA.
  it("235: y tambien con la ayuda ABIERTA, que es donde vive el boton", async () => {
    const { service, repo } = build(
      publicar(),
      ordenParaHilo({ estatusValue: "en_reparto", ayudaAbierta: true }),
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

// =================================================================================================
// «Recuperar» — 235/R8: aqui SOLO se afirma la DELEGACION en el punto unico de rescate. Toda la
// cobertura del rescate vive en `tests/unit/services/rescate-ayuda-service.test.ts`.
// =================================================================================================
describe("SolicitudAyudaService.recuperar — delega en el punto unico (R8)", () => {
  it("454/R23: con la ayuda ABIERTA, rescata: evento `ayuda_rescatada` con el actor de la sesion", async () => {
    const publicar = vi.fn(async () => ({ status: "forbidden" as const }));
    const { service, repo } = build(publicar, ordenParaHilo({ ayudaAbierta: true }));

    const r = await service.recuperar({ ordenId: ORDEN }, actorMensajero);

    expect(r).toEqual({ status: "ok" });
    expect(repo.registrarAyudaResuelta).toHaveBeenCalledWith({
      ordenId: ORDEN,
      tipo: "ayuda_rescatada",
      actorUsuarioId: MENSAJERO,
      actorRol: "mensajero",
    });
    // Y NO toca el hilo: los motivos escritos siguen donde estan. Retirar la solicitud dice «ya no
    // necesito ayuda», no «esto nunca paso».
    expect(publicar).not.toHaveBeenCalled();
  });

  it("235/R9: sobre una orden SIN ayuda abierta, `forbidden` y NINGUNA escritura", async () => {
    const publicar = vi.fn(async () => ({ status: "forbidden" as const }));
    const { service, repo } = build(publicar, ordenParaHilo({ ayudaAbierta: false }));

    const r = await service.recuperar({ ordenId: ORDEN }, actorMensajero);

    expect(r).toEqual({ status: "forbidden" });
    expect(repo.registrarAyudaResuelta).not.toHaveBeenCalled();
  });

  it("retirar la solicitud NO devuelve la orden a la gestion en curso: eso se vuelve a escoger", async () => {
    const publicar = vi.fn(async () => ({ status: "forbidden" as const }));
    const { service, gestionRepo } = build(publicar, ordenParaHilo({ ayudaAbierta: true }));

    await service.recuperar({ ordenId: ORDEN }, actorMensajero);

    expect(gestionRepo.liberarOrdenEnGestion).not.toHaveBeenCalled();
  });
});
