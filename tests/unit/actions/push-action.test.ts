import { describe, it, expect, vi } from "vitest";
import {
  eliminarSuscripcionPush,
  obtenerClavePublicaPush,
  registrarSuscripcionPush,
} from "@/lib/actions/push";
import type { IPushSuscripcionRepository } from "@/lib/interfaces/repositories/IPushSuscripcionRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// FICHA 410 (T3.9) — LAS TRES SERVER ACTIONS DEL CANAL. Cubre R50 (el usuario sale de la SESION y
// nunca de la entrada), R32 (la clave publica se sirve en tiempo de ejecucion), R15/R19 (la baja) y
// R31 (la privada no sale por aqui ni de lejos).

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

const conActor = (actor: Actor | null) => ({ getActor: async () => actor });

describe("410/R50 — sin sesion NO se escribe nada", () => {
  it("⭑ registrar sin sesion: `unauthenticated` y el repositorio NI SE TOCA", async () => {
    const repo = repoDoble();
    const r = await registrarSuscripcionPush(ENTRADA_BUENA, { repo, ...conActor(null) });
    expect(r).toEqual({ status: "unauthenticated" });
    expect(repo.registrar).not.toHaveBeenCalled();
  });

  it("eliminar sin sesion: `unauthenticated`, sin tocar nada", async () => {
    const repo = repoDoble();
    const r = await eliminarSuscripcionPush(
      { endpoint: ENTRADA_BUENA.endpoint },
      { repo, ...conActor(null) },
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
    const r = await registrarSuscripcionPush(ENTRADA_BUENA, { repo, ...conActor(ACTOR) });
    expect(r).toEqual({ status: "ok" });
    expect(repo.registrados).toEqual([{ usuarioId: "u-real", endpoint: ENTRADA_BUENA.endpoint }]);
  });

  it("⭑ con un `usuarioId` en el cuerpo: `validation_error`, y NADA se escribe", async () => {
    // El schema es `strict()` A PROPOSITO. Si el campo se ignorara en silencio, el codigo quedaria
    // a un `...data` de distancia de dejar que cualquiera suscriba un dispositivo a nombre de otro.
    // Asi el intento es RUIDOSO.
    const repo = repoDoble();
    const r = await registrarSuscripcionPush(
      { ...ENTRADA_BUENA, usuarioId: "u-de-otra-persona" },
      { repo, ...conActor(ACTOR) },
    );
    expect(r.status).toBe("validation_error");
    expect(repo.registrar).not.toHaveBeenCalled();
  });

  it("⭑ la baja tambien va acotada al actor de sesion", async () => {
    const repo = repoDoble();
    await eliminarSuscripcionPush({ endpoint: ENTRADA_BUENA.endpoint }, { repo, ...conActor(ACTOR) });
    expect(repo.borrados).toEqual([{ usuarioId: "u-real", endpoint: ENTRADA_BUENA.endpoint }]);
  });
});

describe("410 — la validacion del borde", () => {
  it("⭑ un endpoint que no es una URL da `validation_error` sin tocar la base", async () => {
    const repo = repoDoble();
    const r = await registrarSuscripcionPush(
      { ...ENTRADA_BUENA, endpoint: "no-soy-una-url" },
      { repo, ...conActor(ACTOR) },
    );
    expect(r.status).toBe("validation_error");
    expect(repo.registrar).not.toHaveBeenCalled();
  });

  it("faltan las claves: `validation_error`", async () => {
    const repo = repoDoble();
    const r = await registrarSuscripcionPush(
      { endpoint: ENTRADA_BUENA.endpoint },
      { repo, ...conActor(ACTOR) },
    );
    expect(r.status).toBe("validation_error");
  });

  it("la etiqueta es opcional: sin ella se registra igual", async () => {
    const repo = repoDoble();
    const sinEtiqueta = {
      endpoint: ENTRADA_BUENA.endpoint,
      p256dh: ENTRADA_BUENA.p256dh,
      auth: ENTRADA_BUENA.auth,
    };
    const r = await registrarSuscripcionPush(sinEtiqueta, { repo, ...conActor(ACTOR) });
    expect(r).toEqual({ status: "ok" });
  });

  it("un endpoint mal formado en la BAJA tambien se corta en el borde", async () => {
    const repo = repoDoble();
    const r = await eliminarSuscripcionPush({ endpoint: "///" }, { repo, ...conActor(ACTOR) });
    expect(r.status).toBe("validation_error");
    expect(repo.eliminarDeUsuario).not.toHaveBeenCalled();
  });
});

describe("410/R19+R20 — desactivar dos veces no es un error", () => {
  it("⭑ sin fila que borrar, la accion devuelve `ok`", async () => {
    const repo = repoDoble();
    repo.eliminarDeUsuario = vi.fn(async () => 0);
    const r = await eliminarSuscripcionPush(
      { endpoint: ENTRADA_BUENA.endpoint },
      { repo, ...conActor(ACTOR) },
    );
    // Un `not_found` aqui obligaria al cierre de sesion a decidir que hacer con el, y la respuesta
    // correcta es «seguir saliendo» (R20).
    expect(r).toEqual({ status: "ok" });
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
