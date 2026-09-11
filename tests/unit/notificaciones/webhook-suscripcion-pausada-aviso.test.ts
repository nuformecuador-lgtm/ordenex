import { describe, it, expect, vi } from "vitest";
import type {
  CrearNotificacionInput,
  INotificacionRepository,
  NotificacionDestinatario,
} from "@/lib/interfaces/repositories/INotificacionRepository";
import type { NotificacionEvento } from "@/lib/types/notificacion";
import {
  emitirWebhookSuscripcionPausada,
  textoWebhookSuscripcionPausada,
} from "@/lib/notificaciones/emitir";
import { notificarWebhookSuscripcionPausadaCon } from "@/lib/notificaciones/notificadores";

// FICHA 403 (T10/T11) — EL AVISO de «un webhook lleva fallando y sus reintentos se espaciaron»,
// contra un repositorio doble.
//
// Cubre R9 (una fila al rol `maestro`, y el texto NO dice «desactiv»), R10 (usa
// `INotificacionRepository.crear`, sin canal nuevo), R11 (un repo que revienta no propaga y queda
// REGISTRADO), R12 (una racha, un aviso; racha nueva, aviso nuevo) y R13 (ni URL ni secreto).
//
// ⚠️ LA MITAD DE R12 VIVE EN EL MOTOR. Que dos intentos de la MISMA racha produzcan UN solo aviso
// lo decide `notificacion_dedupe_key` (UNIQUE con `NULLS NOT DISTINCT`) mas la guardia de
// no-leidas, y eso se mide contra Postgres en
// `tests/integration/db/notificacion-evento-webhook-suscripcion-migration.test.ts`. Aqui se mide
// lo que SI es del emisor: que la entidad sea LA RACHA, para que la clave pueda distinguirlas.

/** Repositorio doble que registra lo creado, con una dedupe REAL sobre la clave del indice. */
class RepoDoble implements INotificacionRepository {
  creadas: CrearNotificacionInput[] = [];
  /** Emula `notificacion_dedupe_key`: (evento, entidad_id, destinatario). */
  private readonly claves = new Set<string>();
  /** Claves que su destinatario NO ha leido todavia (la guardia previa de `emitirFilas`). */
  private readonly noLeidas = new Set<string>();

  private clave(
    evento: NotificacionEvento,
    entidadId: string,
    destinatario: NotificacionDestinatario,
  ): string {
    const quien =
      destinatario.tipo === "rol"
        ? `rol:${destinatario.rol}:${destinatario.tiendaId ?? ""}:${destinatario.zonaId ?? ""}`
        : `usuario:${destinatario.usuarioId}`;
    return `${evento}|${entidadId}|${quien}`;
  }

  // FICHA 410 (design 6.1): `crear` devuelve el ID de la fila creada y `null` cuando la dedupe
  // la absorbio. `null` significa EXACTAMENTE lo que significaba `false`.
  async crear(input: CrearNotificacionInput): Promise<string | null> {
    if (input.entidadId !== null) {
      const k = this.clave(input.evento, input.entidadId, input.destinatario);
      // El repositorio REAL absorbe el `P2002` devolviendo `null`; el doble hace lo mismo.
      if (this.claves.has(k)) return null;
      this.claves.add(k);
      this.noLeidas.add(k);
    }
    this.creadas.push(input);
    return `n-${this.creadas.length}`;
  }

  async existeNoLeidaPara(
    evento: NotificacionEvento,
    entidadId: string,
    destinatario: NotificacionDestinatario,
  ): Promise<boolean> {
    return this.noLeidas.has(this.clave(evento, entidadId, destinatario));
  }

  /** Marca TODO como leido: es lo que pasa cuando el maestro abre la campana. */
  marcarTodoLeido(): void {
    this.noLeidas.clear();
  }

  listarParaUsuario = vi.fn().mockResolvedValue([]);
  verificarVisible = vi.fn().mockResolvedValue("visible" as const);
  marcarTodasLeidas = vi.fn().mockResolvedValue(0);
  descartar = vi.fn().mockResolvedValue(undefined);
}

/** Repositorio que revienta al crear: modela la base caida en el camino real. */
class RepoQueFalla extends RepoDoble {
  override async crear(): Promise<string | null> {
    throw new Error("base caida");
  }
}

const OWNER = "usr-integrador-1";
/** Ancla de la racha. 18:00 UTC = 12:00 en Costa Rica, el mismo dia por los dos husos. */
const RACHA = new Date("2026-09-04T18:00:00.000Z");

describe("403/R9 — una fila `warning` al rol `maestro`, con la RACHA como entidad", () => {
  it("⭑ la forma EXACTA de la fila: es el contrato del aviso", async () => {
    const repo = new RepoDoble();

    const creadas = await emitirWebhookSuscripcionPausada(repo, {
      ownerUsuarioId: OWNER,
      sinExitoDesde: RACHA,
    });

    expect(creadas).toBe(1);
    expect(repo.creadas).toEqual([
      {
        // `warning` y NO `alert`: la suscripcion sigue viva y se recupera sola. Un `alert` teñiria
        // de rojo la campana por algo que no exige intervenir.
        tipo: "warning",
        evento: "webhook_suscripcion_pausada",
        descripcion:
          "Un webhook lleva fallando desde el 4 de septiembre y sus reintentos se espaciaron " +
          "automáticamente para no saturar la cola de trabajo. Se reanudarán solos en cuanto " +
          "vuelva a responder. Revisa Configuración > API.",
        anexo: null,
        entidadTipo: "webhook_suscripcion_pausa",
        // ⚠️ LA RACHA (`owner:ancla`), no la suscripcion. Ver el bloque de R12.
        entidadId: `${OWNER}:2026-09-04T18:00:00.000Z`,
        destinatario: { tipo: "rol", rol: "maestro" },
      },
    ]);
  });

  it("⭑ va SOLO al maestro: es el unico rol que opera Configuracion > API", async () => {
    // `lib/actions/webhooks.ts` autoriza a `maestro` y a nadie mas. El `admin` veria un aviso
    // sobre el que no puede actuar, que es ruido — mismo criterio que excluyo al admin en la 333.
    const repo = new RepoDoble();
    await emitirWebhookSuscripcionPausada(repo, { ownerUsuarioId: OWNER, sinExitoDesde: RACHA });
    expect(repo.creadas.map((c) => c.destinatario)).toEqual([{ tipo: "rol", rol: "maestro" }]);
  });

  it("⭑ EL TEXTO NUNCA DICE «DESACTIV», NI «BAJA», NI «CANCEL»", async () => {
    // R9, ultima frase, y ES EL REQUISITO. La suscripcion sigue ACTIVA y sigue reintentando: un
    // texto que dijera «se desactivo» mandaria al maestro a reactivar a mano algo que no esta
    // apagado — exactamente el mecanismo que el humano descarto para esta ficha.
    for (const fecha of [RACHA, new Date("2026-01-31T05:00:00.000Z")]) {
      const texto = textoWebhookSuscripcionPausada(fecha);
      expect(texto).not.toMatch(/desactiv/i);
      expect(texto).not.toMatch(/dad[oa] de baja|dar de baja/i);
      expect(texto).not.toMatch(/cancel/i);
      // Y SI dice lo que de verdad pasa: se espaciaron y se reanudan solos.
      expect(texto).toMatch(/espaciaron/i);
      expect(texto).toMatch(/reanudar/i);
    }
  });

  it("⭑ la fecha va en dia de COSTA RICA, no en UTC", () => {
    // Un fallo de las 19:00 CR es ya el dia siguiente en UTC. Un aviso que dice «desde el 10»
    // cuando en pantalla todavia es el 9 se lee como un error del sistema.
    // 2026-09-05T02:00:00Z = 20:00 del 4 de septiembre en CR.
    expect(textoWebhookSuscripcionPausada(new Date("2026-09-05T02:00:00.000Z"))).toContain(
      "desde el 4 de septiembre",
    );
  });
});

describe("403/R12 — una racha, un aviso; una racha NUEVA, otro aviso", () => {
  it("⭑ dos intentos fallidos de la MISMA racha producen UNA sola fila", async () => {
    const repo = new RepoDoble();

    const primera = await emitirWebhookSuscripcionPausada(repo, {
      ownerUsuarioId: OWNER,
      sinExitoDesde: RACHA,
    });
    const segunda = await emitirWebhookSuscripcionPausada(repo, {
      ownerUsuarioId: OWNER,
      sinExitoDesde: RACHA,
    });

    expect(primera).toBe(1);
    expect(segunda).toBe(0);
    expect(repo.creadas).toHaveLength(1);
  });

  it("⭑ y tampoco reaparece DESPUES de leerlo: ahi lo mata el indice unico", async () => {
    // Las dos barreras son distintas y hay que ver las dos: la guardia previa
    // (`existeNoLeidaPara`) solo actua mientras el aviso siga sin leer; una vez leido, el que
    // impide el duplicado es `notificacion_dedupe_key`, cuyo `P2002` el repositorio absorbe.
    const repo = new RepoDoble();
    await emitirWebhookSuscripcionPausada(repo, { ownerUsuarioId: OWNER, sinExitoDesde: RACHA });
    repo.marcarTodoLeido();

    const tras = await emitirWebhookSuscripcionPausada(repo, {
      ownerUsuarioId: OWNER,
      sinExitoDesde: RACHA,
    });

    expect(tras).toBe(0);
    expect(repo.creadas).toHaveLength(1);
  });

  it("⭑ EL CASO QUE JUSTIFICA EL DISEÑO: una racha NUEVA tras recuperarse SI avisa", async () => {
    // Con la SUSCRIPCION (o su owner) como entidad, `notificacion_dedupe_key` admitiria UNA sola
    // fila por (evento, owner, maestro) PARA SIEMPRE: la segunda racha de ese integrador —meses
    // despues— no avisaria NUNCA, sin error, sin log y sin nada. Es el fallo que la 262 documento.
    // Con la racha, `sinExitoDesde` cambia tras el 2xx ⇒ otra entidad ⇒ aviso independiente.
    const repo = new RepoDoble();

    await emitirWebhookSuscripcionPausada(repo, { ownerUsuarioId: OWNER, sinExitoDesde: RACHA });
    repo.marcarTodoLeido();
    const nueva = await emitirWebhookSuscripcionPausada(repo, {
      ownerUsuarioId: OWNER,
      sinExitoDesde: new Date("2026-10-01T09:00:00.000Z"),
    });

    expect(nueva).toBe(1);
    expect(repo.creadas).toHaveLength(2);
    expect(repo.creadas.map((c) => c.entidadId)).toEqual([
      `${OWNER}:2026-09-04T18:00:00.000Z`,
      `${OWNER}:2026-10-01T09:00:00.000Z`,
    ]);
  });

  it("⭑ dos OWNERS distintos con la misma ancla no se pisan el aviso", async () => {
    // El `entidadId` lleva el owner por esto: el dia que haya varias suscripciones, una racha
    // simultanea de dos integradores debe producir dos avisos, no uno.
    const repo = new RepoDoble();
    await emitirWebhookSuscripcionPausada(repo, { ownerUsuarioId: "owner-A", sinExitoDesde: RACHA });
    await emitirWebhookSuscripcionPausada(repo, { ownerUsuarioId: "owner-B", sinExitoDesde: RACHA });
    expect(repo.creadas).toHaveLength(2);
  });

  it("⭑ el `entidadId` es funcion PURA de (owner, ancla): mismo par, misma clave", async () => {
    // Anti-vacuidad de los casos de arriba: si la clave llevara un `Date.now()` o un aleatorio,
    // «una racha, un aviso» seria imposible y el primer caso estaria midiendo su propio ruido.
    const uno = new RepoDoble();
    const otro = new RepoDoble();
    await emitirWebhookSuscripcionPausada(uno, { ownerUsuarioId: OWNER, sinExitoDesde: RACHA });
    await emitirWebhookSuscripcionPausada(otro, {
      ownerUsuarioId: OWNER,
      sinExitoDesde: new Date(RACHA),
    });
    expect(uno.creadas[0].entidadId).toBe(otro.creadas[0].entidadId);
  });
});

describe("403/R13 — ni la URL ni el secreto entran en el aviso", () => {
  it("⭑ la fila entera es opaca: sin URL, sin secreto, sin anexo", async () => {
    // El `anexo` es el hueco por el que se cuela un dato de mas —es donde otros avisos ponen un
    // nombre o una guia—. Aqui va vacio A PROPOSITO: no hay nada mas que enseñar sin arriesgar R13.
    const repo = new RepoDoble();

    await emitirWebhookSuscripcionPausada(repo, { ownerUsuarioId: OWNER, sinExitoDesde: RACHA });

    const fila = repo.creadas[0];
    expect(fila.anexo).toBeNull();
    const serializada = JSON.stringify(fila);
    expect(serializada).not.toMatch(/https?:\/\//); // ninguna URL, ni la del webhook ni otra
    expect(serializada).not.toMatch(/ordx_whsec_/); // ningun secreto de firma
    expect(serializada).not.toMatch(/secret/i);
    // La descripcion no nombra a nadie ni a nada: solo el hecho y la fecha.
    expect(fila.descripcion).not.toContain(OWNER);
  });
});

describe("403/R10/R11 — el camino REAL: `crear`, y un fallo que no propaga", () => {
  it("⭑ R10: emite por `INotificacionRepository.crear`, sin ningun canal nuevo", async () => {
    const repo = new RepoDoble();
    const crear = vi.spyOn(repo, "crear");

    await notificarWebhookSuscripcionPausadaCon(repo)({
      ownerUsuarioId: OWNER,
      sinExitoDesde: RACHA,
    });

    expect(crear).toHaveBeenCalledTimes(1);
    expect(repo.creadas).toHaveLength(1);
    expect(repo.creadas[0].evento).toBe("webhook_suscripcion_pausada");
  });

  it("⭑ R11: un repositorio que revienta NO propaga, y el fallo queda REGISTRADO", async () => {
    // LA CORRIDA MANDA, EL AVISO ES CORTESIA. Lo llama el drenador, que procesa un lote de 10
    // jobs: un aviso caido no puede llevarse por delante los otros nueve. Y no es un `catch`
    // vacio (`docs/conventions.md`): el error sale con la operacion y su causa.
    const logError = vi.fn();

    await expect(
      notificarWebhookSuscripcionPausadaCon(new RepoQueFalla(), { logError })({
        ownerUsuarioId: OWNER,
        sinExitoDesde: RACHA,
      }),
    ).resolves.toBeUndefined();

    expect(logError).toHaveBeenCalledTimes(1);
    const registrado = logError.mock.calls[0][0] as Error;
    expect(registrado.message).toContain("webhook_suscripcion_pausada");
    expect((registrado.cause as Error).message).toBe("base caida");
    // R13 tambien en el log del fallo: ni la URL ni el secreto pasan por aqui.
    expect(registrado.message).not.toMatch(/https?:\/\//);
  });

  it("el absorbedor no se traga los avisos buenos: con un repo sano SI emite", async () => {
    const repo = new RepoDoble();
    await notificarWebhookSuscripcionPausadaCon(repo)({
      ownerUsuarioId: OWNER,
      sinExitoDesde: RACHA,
    });
    expect(repo.creadas).toHaveLength(1);
    expect(repo.creadas[0].tipo).toBe("warning");
  });
});
