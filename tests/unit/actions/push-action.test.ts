import { describe, it, expect, vi } from "vitest";
import {
  eliminarSuscripcionPush,
  obtenerClavePublicaPush,
  olvidarPreferenciaDeAvisos,
  registrarSuscripcionPush,
} from "@/lib/actions/push";
import type { IPushSuscripcionRepository } from "@/lib/interfaces/repositories/IPushSuscripcionRepository";
import type { IUsuarioPreferenciaRepository } from "@/lib/interfaces/repositories/IUsuarioPreferenciaRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// FICHA 410 (T3.9) — LAS TRES SERVER ACTIONS DEL CANAL. Cubre R50 (el usuario sale de la SESION y
// nunca de la entrada), R32 (la clave publica se sirve en tiempo de ejecucion), R15/R19 (la baja) y
// R31 (la privada no sale por aqui ni de lejos).
//
// FICHA 422 (T2.1/T2.2) — y LA PREFERENCIA DE LA PERSONA: registrar una suscripcion la deja puesta
// (R3), `olvidarPreferenciaDeAvisos` la borra (R7), y sin sesion no se escribe NINGUNA de las dos
// (R24). El doble de abajo apunta el VALOR de cada escritura, no solo que hubo una.

const ACTOR: Actor = { usuarioId: "u-real", rol: "mensajero", zonaId: null };

const ENTRADA_BUENA = {
  endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
  p256dh: "BP256DH",
  auth: "AUTH",
  etiqueta: "Chrome en Android",
};

function repoDoble(): IPushSuscripcionRepository & {
  registrados: { usuarioId: string; endpoint: string }[];
  borrados: { usuarioId: string; endpoint: string }[];
} {
  const registrados: { usuarioId: string; endpoint: string }[] = [];
  const borrados: { usuarioId: string; endpoint: string }[] = [];
  return {
    registrados,
    borrados,
    registrar: vi.fn(async (usuarioId: string, input: { endpoint: string }) => {
      registrados.push({ usuarioId, endpoint: input.endpoint });
    }),
    eliminarDeUsuario: vi.fn(async (usuarioId: string, endpoint: string) => {
      borrados.push({ usuarioId, endpoint });
      return 1;
    }),
    eliminarPorId: vi.fn(async () => undefined),
    listarPorUsuarios: vi.fn(async () => []),
    sellarEnvioOk: vi.fn(async () => undefined),
    tomarCupoDelDia: vi.fn(async () => true),
    usuariosConCupoDe: vi.fn(async () => []),
  };
}

/**
 * FICHA 422 — el doble del repositorio de LA PREFERENCIA DE LA PERSONA.
 *
 * Apunta cada escritura CON SU VALOR, no solo que hubo una llamada: la diferencia entre `true` y
 * `false` es la diferencia entre «quiero avisos» y «no», y un espia que solo contara llamadas
 * dejaria pasar una accion que escribiera el valor contrario.
 */
function preferenciaDoble(): IUsuarioPreferenciaRepository & {
  escrituras: { usuarioId: string; quiere: boolean }[];
  lecturas: string[];
} {
  const escrituras: { usuarioId: string; quiere: boolean }[] = [];
  const lecturas: string[] = [];
  return {
    escrituras,
    lecturas,
    avisosPushDe: vi.fn(async (usuarioId: string) => {
      lecturas.push(usuarioId);
      return false;
    }),
    fijarAvisosPush: vi.fn(async (usuarioId: string, quiere: boolean) => {
      escrituras.push({ usuarioId, quiere });
    }),
  };
}

const conActor = (actor: Actor | null) => ({ getActor: async () => actor });

describe("410/R50 — sin sesion NO se escribe nada", () => {
  it("⭑ registrar sin sesion: `unauthenticated` y el repositorio NI SE TOCA", async () => {
    const repo = repoDoble();
    const preferenciaRepo = preferenciaDoble();
    const r = await registrarSuscripcionPush(ENTRADA_BUENA, { repo, preferenciaRepo, ...conActor(null) });
    expect(r).toEqual({ status: "unauthenticated" });
    expect(repo.registrar).not.toHaveBeenCalled();
  });

  it("eliminar sin sesion: `unauthenticated`, sin tocar nada", async () => {
    const repo = repoDoble();
    const preferenciaRepo = preferenciaDoble();
    const r = await eliminarSuscripcionPush(
      { endpoint: ENTRADA_BUENA.endpoint },
      { repo, preferenciaRepo, ...conActor(null) },
    );
    expect(r).toEqual({ status: "unauthenticated" });
    expect(repo.eliminarDeUsuario).not.toHaveBeenCalled();
  });

  it("la clave publica tampoco se sirve sin sesion", async () => {
    const r = await obtenerClavePublicaPush({
      ...conActor(null),
      clavePublica: () => "BPUBLICA",
    });
    expect(r).toEqual({ status: "unauthenticated" });
  });
});

describe("410/R50 — el dueno sale de la SESION, y un `usuarioId` inyectado NO se ignora: revienta", () => {
  it("⭑ la suscripcion se registra a nombre del actor de sesion", async () => {
    const repo = repoDoble();
    const preferenciaRepo = preferenciaDoble();
    const r = await registrarSuscripcionPush(ENTRADA_BUENA, { repo, preferenciaRepo, ...conActor(ACTOR) });
    expect(r).toEqual({ status: "ok" });
    expect(repo.registrados).toEqual([{ usuarioId: "u-real", endpoint: ENTRADA_BUENA.endpoint }]);
  });

  it("⭑ con un `usuarioId` en el cuerpo: `validation_error`, y NADA se escribe", async () => {
    // El schema es `strict()` A PROPOSITO. Si el campo se ignorara en silencio, el codigo quedaria
    // a un `...data` de distancia de dejar que cualquiera suscriba un dispositivo a nombre de otro.
    // Asi el intento es RUIDOSO.
    const repo = repoDoble();
    const preferenciaRepo = preferenciaDoble();
    const r = await registrarSuscripcionPush(
      { ...ENTRADA_BUENA, usuarioId: "u-de-otra-persona" },
      { repo, preferenciaRepo, ...conActor(ACTOR) },
    );
    expect(r.status).toBe("validation_error");
    expect(repo.registrar).not.toHaveBeenCalled();
  });

  it("⭑ la baja tambien va acotada al actor de sesion", async () => {
    const repo = repoDoble();
    const preferenciaRepo = preferenciaDoble();
    await eliminarSuscripcionPush({ endpoint: ENTRADA_BUENA.endpoint }, { repo, preferenciaRepo, ...conActor(ACTOR) });
    expect(repo.borrados).toEqual([{ usuarioId: "u-real", endpoint: ENTRADA_BUENA.endpoint }]);
  });
});

describe("410 — la validacion del borde", () => {
  it("⭑ un endpoint que no es una URL da `validation_error` sin tocar la base", async () => {
    const repo = repoDoble();
    const preferenciaRepo = preferenciaDoble();
    const r = await registrarSuscripcionPush(
      { ...ENTRADA_BUENA, endpoint: "no-soy-una-url" },
      { repo, preferenciaRepo, ...conActor(ACTOR) },
    );
    expect(r.status).toBe("validation_error");
    expect(repo.registrar).not.toHaveBeenCalled();
  });

  it("faltan las claves: `validation_error`", async () => {
    const repo = repoDoble();
    const preferenciaRepo = preferenciaDoble();
    const r = await registrarSuscripcionPush(
      { endpoint: ENTRADA_BUENA.endpoint },
      { repo, preferenciaRepo, ...conActor(ACTOR) },
    );
    expect(r.status).toBe("validation_error");
  });

  it("la etiqueta es opcional: sin ella se registra igual", async () => {
    const repo = repoDoble();
    const preferenciaRepo = preferenciaDoble();
    const sinEtiqueta = {
      endpoint: ENTRADA_BUENA.endpoint,
      p256dh: ENTRADA_BUENA.p256dh,
      auth: ENTRADA_BUENA.auth,
    };
    const r = await registrarSuscripcionPush(sinEtiqueta, { repo, preferenciaRepo, ...conActor(ACTOR) });
    expect(r).toEqual({ status: "ok" });
  });

  it("un endpoint mal formado en la BAJA tambien se corta en el borde", async () => {
    const repo = repoDoble();
    const preferenciaRepo = preferenciaDoble();
    const r = await eliminarSuscripcionPush({ endpoint: "///" }, { repo, preferenciaRepo, ...conActor(ACTOR) });
    expect(r.status).toBe("validation_error");
    expect(repo.eliminarDeUsuario).not.toHaveBeenCalled();
  });
});

describe("410/R19+R20 — desactivar dos veces no es un error", () => {
  it("⭑ sin fila que borrar, la accion devuelve `ok`", async () => {
    const repo = repoDoble();
    const preferenciaRepo = preferenciaDoble();
    repo.eliminarDeUsuario = vi.fn(async () => 0);
    const r = await eliminarSuscripcionPush(
      { endpoint: ENTRADA_BUENA.endpoint },
      { repo, preferenciaRepo, ...conActor(ACTOR) },
    );
    // Un `not_found` aqui obligaria al cierre de sesion a decidir que hacer con el, y la respuesta
    // correcta es «seguir saliendo» (R20).
    expect(r).toEqual({ status: "ok" });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 422 — LA PREFERENCIA DE LA PERSONA
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe("422/R3 — registrar una suscripcion deja la preferencia PUESTA", () => {
  it("⭑ registrar deja la preferencia puesta", async () => {
    // ⚠️ ES LA INVARIANTE DE LA FICHA: registrar una suscripcion es, POR DEFINICION, decir que si.
    // No hay ningun otro camino en el arbol que cree una suscripcion, y llegar aqui exige el gesto
    // de la persona y el permiso del navegador. La mutacion M8 —quitar esta escritura— muere aqui.
    const repo = repoDoble();
    const preferenciaRepo = preferenciaDoble();

    const r = await registrarSuscripcionPush(ENTRADA_BUENA, {
      repo,
      preferenciaRepo,
      ...conActor(ACTOR),
    });

    expect(r).toEqual({ status: "ok" });
    // A nombre del actor de la SESION, nunca de un identificador de la entrada (410/R50).
    expect(preferenciaRepo.escrituras).toEqual([{ usuarioId: "u-real", quiere: true }]);
  });

  it("⭑ la suscripcion se escribe ANTES que la preferencia", async () => {
    // El orden importa y es el mismo criterio que la baja: primero lo que de verdad decide a donde
    // sale un push, despues lo que solo lo recuerda.
    const orden: string[] = [];
    const repo = repoDoble();
    repo.registrar = vi.fn(async () => {
      orden.push("suscripcion");
    });
    const preferenciaRepo = preferenciaDoble();
    preferenciaRepo.fijarAvisosPush = vi.fn(async () => {
      orden.push("preferencia");
    });

    await registrarSuscripcionPush(ENTRADA_BUENA, { repo, preferenciaRepo, ...conActor(ACTOR) });

    expect(orden).toEqual(["suscripcion", "preferencia"]);
  });

  it("⭑ si ANOTAR la preferencia falla, el registro sigue siendo `ok` y queda el fallo escrito", async () => {
    // POR QUE NO SE PROPAGA, medido sobre el llamante: `lib/pwa/alta-push.ts` DESHACE la suscripcion
    // del navegador cuando el registro no sale `ok`. Si un fallo al anotar la preferencia devolviera
    // error, un dispositivo perfectamente registrado se quedaria sin avisos por una columna que no
    // decide a donde sale un push (R6). El fallo no se absorbe: se registra con su causa.
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const repo = repoDoble();
    const preferenciaRepo = preferenciaDoble();
    preferenciaRepo.fijarAvisosPush = vi.fn(async () => {
      throw new Error("la base no contesto");
    });

    const r = await registrarSuscripcionPush(ENTRADA_BUENA, {
      repo,
      preferenciaRepo,
      ...conActor(ACTOR),
    });

    expect(r).toEqual({ status: "ok" });
    expect(repo.registrados).toHaveLength(1);
    const registrado = error.mock.calls.map((c) => c.map(String).join(" ")).join(" | ");
    expect(registrado).toContain("anotar la preferencia de avisos");
    error.mockRestore();
  });

  it("⭑ una entrada INVALIDA no escribe la preferencia tampoco", async () => {
    // El borde corta antes de tocar nada: ni suscripcion ni preferencia.
    const repo = repoDoble();
    const preferenciaRepo = preferenciaDoble();

    const r = await registrarSuscripcionPush(
      { ...ENTRADA_BUENA, endpoint: "no-soy-una-url" },
      { repo, preferenciaRepo, ...conActor(ACTOR) },
    );

    expect(r.status).toBe("validation_error");
    expect(preferenciaRepo.escrituras).toEqual([]);
  });
});

describe("422/R7 + R24 — `olvidarPreferenciaDeAvisos`", () => {
  it("⭑ con sesion: escribe `false` para el actor y devuelve `ok`", async () => {
    const preferenciaRepo = preferenciaDoble();

    const r = await olvidarPreferenciaDeAvisos({ preferenciaRepo, ...conActor(ACTOR) });

    expect(r).toEqual({ status: "ok" });
    expect(preferenciaRepo.escrituras).toEqual([{ usuarioId: "u-real", quiere: false }]);
  });

  it("⭑ SIN sesion: `unauthenticated` y CERO escrituras", async () => {
    // R24 — mientras no haya sesion valida no se lee ni se escribe ninguna preferencia. El actor
    // sale de la cookie y nunca de la entrada: esta accion NI SIQUIERA TIENE entrada.
    const preferenciaRepo = preferenciaDoble();

    const r = await olvidarPreferenciaDeAvisos({ preferenciaRepo, ...conActor(null) });

    expect(r).toEqual({ status: "unauthenticated" });
    expect(preferenciaRepo.fijarAvisosPush).not.toHaveBeenCalled();
    expect(preferenciaRepo.avisosPushDe).not.toHaveBeenCalled();
  });

  it("⭑ y NO toca ninguna suscripcion: 410/R19 intacto", async () => {
    // Apagar el interruptor en el telefono no puede retirar la suscripcion de la computadora. Esta
    // accion no recibe el repositorio de suscripciones NI LO NECESITA: no hay por donde.
    const repo = repoDoble();
    const preferenciaRepo = preferenciaDoble();

    await olvidarPreferenciaDeAvisos({ repo, preferenciaRepo, ...conActor(ACTOR) });

    expect(repo.eliminarDeUsuario).not.toHaveBeenCalled();
    expect(repo.eliminarPorId).not.toHaveBeenCalled();
    expect(repo.borrados).toEqual([]);
  });
});

describe("422/R24 — sin sesion no se escribe NI la suscripcion NI la preferencia", () => {
  it("⭑ registrar sin sesion deja las dos tablas intactas", async () => {
    const repo = repoDoble();
    const preferenciaRepo = preferenciaDoble();

    const r = await registrarSuscripcionPush(ENTRADA_BUENA, {
      repo,
      preferenciaRepo,
      ...conActor(null),
    });

    expect(r).toEqual({ status: "unauthenticated" });
    expect(repo.registrar).not.toHaveBeenCalled();
    expect(preferenciaRepo.fijarAvisosPush).not.toHaveBeenCalled();
  });

  it("control positivo: el MISMO escenario con sesion escribe las dos", async () => {
    // Sin esto, el caso de arriba pasaria en verde con unas acciones que no escribieran nunca.
    const repo = repoDoble();
    const preferenciaRepo = preferenciaDoble();

    await registrarSuscripcionPush(ENTRADA_BUENA, { repo, preferenciaRepo, ...conActor(ACTOR) });

    expect(repo.registrar).toHaveBeenCalledTimes(1);
    expect(preferenciaRepo.fijarAvisosPush).toHaveBeenCalledTimes(1);
  });
});

describe("410/R32 — la clave publica, en tiempo de ejecucion", () => {
  it("⭑ se sirve la que haya en ese momento", async () => {
    const r = await obtenerClavePublicaPush({
      ...conActor(ACTOR),
      clavePublica: () => "BPUBLICA-vigente",
    });
    expect(r).toEqual({ status: "ok", clavePublica: "BPUBLICA-vigente" });
  });

  it("⭑ R13/R30: sin canal configurado devuelve `null`, que NO es un error", async () => {
    const r = await obtenerClavePublicaPush({ ...conActor(ACTOR), clavePublica: () => null });
    expect(r).toEqual({ status: "ok", clavePublica: null });
  });

  it("⭑ R31: el fuente de la accion no nombra la clave PRIVADA por ningun lado", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const fuente = fs.readFileSync(
      path.resolve(__dirname, "..", "..", "..", "lib", "actions", "push.ts"),
      "utf8",
    );
    expect(fuente.length).toBeGreaterThan(500); // autocomprobacion: se leyo algo
    expect(fuente).not.toContain("VAPID_PRIVATE_KEY");
    expect(fuente).not.toContain("privateKey");
    expect(fuente).not.toContain("loadPushConfig");
  });
});
