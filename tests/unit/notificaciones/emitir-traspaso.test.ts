import { describe, it, expect, vi } from "vitest";
import type {
  CrearNotificacionInput,
  INotificacionRepository,
} from "@/lib/interfaces/repositories/INotificacionRepository";
import {
  emitirTraspasoCedido,
  emitirTraspasoRecibido,
  textoTraspasoCedido,
  textoTraspasoRecibido,
} from "@/lib/notificaciones/emitir";
import {
  notificarTraspasoCedidoCon,
  notificarTraspasoRecibidoCon,
} from "@/lib/notificaciones/notificadores";

// FICHA 427 (T13, R38/R39/R40/R42) — LOS DOS AVISOS DEL TRASPASO.
//
// Lo que se prueba aqui es la FORMA de las filas que se crean: cuantas, a quien, con que entidad y
// con que texto. La decision de push vive en `push-elegibles.test.ts`; el cableado, en
// `traspasar-mensajero.test.ts`; y la emision dentro del flujo, en el test del servicio.
//
// ⚠️ LOS TEXTOS SE AFIRMAN CON LITERALES ESCRITOS A MANO, nunca llamando a la funcion que los
// genera: comparar una asercion contra su propia fuente esta SIEMPRE VERDE, y este repo ya tiene la
// leccion medida.

const LOTE_A = "6fd0f9b0-0000-4000-8000-00000000000a";
const LOTE_B = "6fd0f9b0-0000-4000-8000-00000000000b";
const DESTINO = "usuario-carlos";
const ORIGEN = "usuario-andy";

/** Repositorio doble: registra lo creado. Sin dedupe previa salvo que el test la active. */
class RepoDoble implements INotificacionRepository {
  creadas: CrearNotificacionInput[] = [];
  /** Claves `(evento|entidadId|usuario)` ya emitidas: modela el indice unico de la base. */
  private vistas = new Set<string>();

  async crear(input: CrearNotificacionInput): Promise<string | null> {
    const usuario =
      input.destinatario.tipo === "usuario" ? input.destinatario.usuarioId : input.destinatario.rol;
    const clave = `${input.evento}|${input.entidadId}|${usuario}`;
    // La base ABSORBE el choque devolviendo `null` (`NotificacionRepository.crear`). Se modela aqui
    // porque es EXACTAMENTE la propiedad que R42 pone a prueba.
    if (this.vistas.has(clave)) return null;
    this.vistas.add(clave);
    this.creadas.push(input);
    return `n-${this.creadas.length}`;
  }
  existeNoLeidaPara = vi.fn().mockResolvedValue(false);
  listarParaUsuario = vi.fn().mockResolvedValue([]);
  verificarVisible = vi.fn().mockResolvedValue("visible" as const);
  marcarTodasLeidas = vi.fn().mockResolvedValue(0);
  descartar = vi.fn().mockResolvedValue(undefined);
}

describe("427/R38 — UN aviso por acto al mensajero DESTINO, con cuantas y de quien", () => {
  it("⭑ crea EXACTAMENTE UNA fila aunque el acto mueva 31 ordenes", async () => {
    // El numero del caso real. Un aviso por orden serian 31 campanadas y 31 interrupciones de push;
    // la accion que el aviso pide no es sobre un paquete concreto sino sobre la lista entera.
    const repo = new RepoDoble();

    const creadas = await emitirTraspasoRecibido(repo, {
      loteId: LOTE_A,
      mensajeroUsuarioId: DESTINO,
      cuantas: 31,
      otroMensajeroNombre: "Andy Cortés",
    });

    expect(creadas).toBe(1);
    expect(repo.creadas).toHaveLength(1);
    expect(repo.creadas[0].destinatario).toEqual({ tipo: "usuario", usuarioId: DESTINO });
    expect(repo.creadas[0].evento).toBe("traspaso_ordenes_recibido");
    expect(repo.creadas[0].tipo).toBe("box");
    // El NUMERO va DENTRO del texto (R38), no en una columna aparte.
    expect(repo.creadas[0].descripcion).toBe("Recibiste 31 órdenes de otro mensajero.");
    // DE QUIEN: el nombre del OTRO mensajero, en el anexo.
    expect(repo.creadas[0].anexo).toBe("Andy Cortés");
  });

  it("singular y plural explicitos: «Recibiste 1 orden», nunca «1 órdenes»", () => {
    expect(textoTraspasoRecibido(1)).toBe("Recibiste 1 orden de otro mensajero.");
    expect(textoTraspasoRecibido(2)).toBe("Recibiste 2 órdenes de otro mensajero.");
    expect(textoTraspasoRecibido(31)).toBe("Recibiste 31 órdenes de otro mensajero.");
  });
});

describe("427/R39 — UN aviso por acto al mensajero de ORIGEN, con cuantas y hacia quien", () => {
  it("⭑ crea EXACTAMENTE UNA fila, dirigida al origen y con evento PROPIO", async () => {
    const repo = new RepoDoble();

    const creadas = await emitirTraspasoCedido(repo, {
      loteId: LOTE_A,
      mensajeroUsuarioId: ORIGEN,
      cuantas: 31,
      otroMensajeroNombre: "Carlos Eduardo",
    });

    expect(creadas).toBe(1);
    expect(repo.creadas).toHaveLength(1);
    expect(repo.creadas[0].destinatario).toEqual({ tipo: "usuario", usuarioId: ORIGEN });
    // EVENTO DISTINTO del de su hermano, y no es cosmetica: es lo que permite que el catalogo de
    // push le diga «no» a este y «si» al otro, y que la campana los agrupe por separado.
    expect(repo.creadas[0].evento).toBe("traspaso_ordenes_cedido");
    expect(repo.creadas[0].descripcion).toBe("31 órdenes tuyas pasaron a otro mensajero.");
    expect(repo.creadas[0].anexo).toBe("Carlos Eduardo");
  });

  it("singular y plural explicitos", () => {
    expect(textoTraspasoCedido(1)).toBe("1 orden tuya pasó a otro mensajero.");
    expect(textoTraspasoCedido(4)).toBe("4 órdenes tuyas pasaron a otro mensajero.");
  });

  it("los DOS avisos del MISMO acto conviven: son dos usuarios y dos eventos", async () => {
    // El riesgo que esto descarta: que la clave unica se los comiera entre si. No puede pasar —
    // `destinatario_usuario_id` ES una columna de la clave, y ademas el evento difiere—, pero es la
    // familia de fallo que ya pagaron cuatro fichas y se mide en vez de razonarse.
    const repo = new RepoDoble();
    const ctxComun = { loteId: LOTE_A, cuantas: 3 };

    await emitirTraspasoRecibido(repo, {
      ...ctxComun,
      mensajeroUsuarioId: DESTINO,
      otroMensajeroNombre: "Andy",
    });
    await emitirTraspasoCedido(repo, {
      ...ctxComun,
      mensajeroUsuarioId: ORIGEN,
      otroMensajeroNombre: "Carlos",
    });

    expect(repo.creadas).toHaveLength(2);
    expect(repo.creadas.map((c) => c.destinatario)).toEqual([
      { tipo: "usuario", usuarioId: DESTINO },
      { tipo: "usuario", usuarioId: ORIGEN },
    ]);
  });
});

describe("427/R42 — DOS actos al MISMO mensajero ⇒ DOS avisos, aunque el primero no se lea", () => {
  it("⭑⭑ la ENTIDAD es el `lote_id`, y por eso dos actos no se pisan", async () => {
    // ⚠️ ESTE ES EL CASO QUE MATA LA MUTACION 10 (usar el `ordenId` o el `mensajeroId` como
    // entidad). Se afirma sobre el `entidadId`, NO sobre el numero de llamadas: contar llamadas
    // pasaria igual con la entidad equivocada, porque la que descarta la segunda es la BASE.
    //
    // El caso real: alguien se enferma y su carga se reparte en DOS tandas al mismo companero. Con
    // el mensajero como entidad, la segunda tanda no avisaria NUNCA — sin error y sin log.
    const repo = new RepoDoble();

    await emitirTraspasoRecibido(repo, {
      loteId: LOTE_A,
      mensajeroUsuarioId: DESTINO,
      cuantas: 15,
      otroMensajeroNombre: "Andy",
    });
    await emitirTraspasoRecibido(repo, {
      loteId: LOTE_B,
      mensajeroUsuarioId: DESTINO,
      cuantas: 16,
      otroMensajeroNombre: "Andy",
    });

    expect(repo.creadas).toHaveLength(2);
    expect(repo.creadas.map((c) => c.entidadTipo)).toEqual([
      "orden_traspaso_lote",
      "orden_traspaso_lote",
    ]);
    // LOS DOS `entidadId` SON DISTINTOS y son los `lote_id`. Si alguien pusiera el `mensajeroId`,
    // aqui saldrian dos valores IGUALES y la segunda fila no existiria.
    expect(repo.creadas.map((c) => c.entidadId)).toEqual([LOTE_A, LOTE_B]);
    expect(new Set(repo.creadas.map((c) => c.entidadId)).size).toBe(2);
    expect(repo.creadas[1].descripcion).toBe("Recibiste 16 órdenes de otro mensajero.");
  });

  it("⭑ el MISMO acto emitido dos veces ⇒ UN solo aviso (lo decide el indice, no un `if`)", async () => {
    const repo = new RepoDoble();
    const ctx = {
      loteId: LOTE_A,
      mensajeroUsuarioId: DESTINO,
      cuantas: 5,
      otroMensajeroNombre: "Andy",
    };

    const primera = await emitirTraspasoRecibido(repo, ctx);
    const segunda = await emitirTraspasoRecibido(repo, ctx);

    expect(primera).toBe(1);
    expect(segunda).toBe(0);
    expect(repo.creadas).toHaveLength(1);
  });

  it("CONTROL: el doble SI distingue entidades (si no, lo de arriba seria verde por vacio)", async () => {
    // Sin este control, un `crear` que devolviera siempre `null` dejaria el caso anterior en verde.
    const repo = new RepoDoble();
    expect(await repo.crear({
      tipo: "box",
      evento: "traspaso_ordenes_recibido",
      descripcion: "x",
      anexo: null,
      entidadTipo: "orden_traspaso_lote",
      entidadId: LOTE_A,
      destinatario: { tipo: "usuario", usuarioId: DESTINO },
    })).not.toBeNull();
    expect(await repo.crear({
      tipo: "box",
      evento: "traspaso_ordenes_recibido",
      descripcion: "x",
      anexo: null,
      entidadTipo: "orden_traspaso_lote",
      entidadId: LOTE_B,
      destinatario: { tipo: "usuario", usuarioId: DESTINO },
    })).not.toBeNull();
  });
});

describe("427/R40 — los avisos NO llevan el motivo ni ningun dato del destinatario", () => {
  const MOTIVO_REAL =
    "Andy se enfermó, llamar al 8888-8888 y avisar a María en Av. Central 123 por los ₡45.000";

  it("⭑ ni el texto ni el anexo contienen el motivo escrito por quien traspaso", async () => {
    // El motivo es texto libre de hasta 300 caracteres tecleado por una PERSONA: puede llevar un
    // telefono, una direccion, un nombre o un monto. Por eso NI SIQUIERA ENTRA en el contexto del
    // aviso — no hay campo donde ponerlo. Se lee en el historial de la orden, que si autoriza por
    // orden. Argumento literal de 262/A24.
    const repo = new RepoDoble();

    await emitirTraspasoRecibido(repo, {
      loteId: LOTE_A,
      mensajeroUsuarioId: DESTINO,
      cuantas: 31,
      otroMensajeroNombre: "Andy Cortés",
    });
    await emitirTraspasoCedido(repo, {
      loteId: LOTE_A,
      mensajeroUsuarioId: ORIGEN,
      cuantas: 31,
      otroMensajeroNombre: "Carlos Eduardo",
    });

    expect(repo.creadas).toHaveLength(2);
    for (const fila of repo.creadas) {
      const todo = `${fila.descripcion} ${fila.anexo ?? ""}`;
      expect(todo).not.toContain(MOTIVO_REAL);
      expect(todo).not.toContain("enfermó");
      expect(todo).not.toMatch(/8888/); // telefono
      expect(todo).not.toMatch(/Av\. Central/i); // direccion
      expect(todo).not.toMatch(/₡|\d{2}\.\d{3}/); // monto
      expect(todo).not.toMatch(/María/); // destinatario de la orden
      // Ni guia ni remision: el aviso habla de la LISTA, no de un paquete.
      expect(todo).not.toMatch(/REM-|guía|guia/i);
    }
  });

  it("CONTRAPRUEBA: la comprobacion de arriba SI detecta un texto contaminado", () => {
    // Sin esto, los `not.toContain` pasarian aunque el detector mirara la cadena equivocada.
    const contaminado = `Recibiste 31 órdenes de otro mensajero. ${MOTIVO_REAL}`;
    expect(contaminado).toContain(MOTIVO_REAL);
    expect(contaminado).toMatch(/8888/);
  });
});

describe("427/R41 — el camino REAL absorbe el fallo del repositorio y lo registra", () => {
  class RepoQueFalla extends RepoDoble {
    override async crear(): Promise<string | null> {
      throw new Error("base caida");
    }
  }

  it("⭑ `notificarTraspasoRecibidoCon` no propaga: el traspaso ya esta escrito", async () => {
    const logError = vi.fn();

    await expect(
      notificarTraspasoRecibidoCon(new RepoQueFalla(), { logError })({
        loteId: LOTE_A,
        mensajeroUsuarioId: DESTINO,
        cuantas: 31,
        otroMensajeroNombre: "Andy",
      }),
    ).resolves.toBeUndefined();

    // Y no es un `catch` vacio: queda registrado con la operacion y su causa.
    expect(logError).toHaveBeenCalledTimes(1);
    const registrado = logError.mock.calls[0][0] as Error;
    expect(registrado.message).toContain("traspaso_ordenes_recibido");
    expect((registrado.cause as Error).message).toBe("base caida");
  });

  it("⭑ `notificarTraspasoCedidoCon` igual, con su propio nombre de operacion", async () => {
    const logError = vi.fn();

    await expect(
      notificarTraspasoCedidoCon(new RepoQueFalla(), { logError })({
        loteId: LOTE_A,
        mensajeroUsuarioId: ORIGEN,
        cuantas: 31,
        otroMensajeroNombre: "Carlos",
      }),
    ).resolves.toBeUndefined();

    expect(logError).toHaveBeenCalledTimes(1);
    expect((logError.mock.calls[0][0] as Error).message).toContain("traspaso_ordenes_cedido");
  });

  it("el camino REAL con un repositorio sano SI emite (control positivo)", async () => {
    // Sin esto, los dos casos de arriba pasarian aunque `notificar*Con` no llamara nunca al emisor.
    const repo = new RepoDoble();
    await notificarTraspasoRecibidoCon(repo)({
      loteId: LOTE_A,
      mensajeroUsuarioId: DESTINO,
      cuantas: 2,
      otroMensajeroNombre: "Andy",
    });
    expect(repo.creadas).toHaveLength(1);
    expect(repo.creadas[0].evento).toBe("traspaso_ordenes_recibido");
  });
});
