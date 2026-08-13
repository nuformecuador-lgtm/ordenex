import { describe, it, expect } from "vitest";
import { quitarComentarios } from "../../fixtures/sin-comentarios";
import fs from "fs";
import path from "path";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { ActorAnalitica } from "@/lib/analytics/alcance";
import { resolverAlcance } from "@/lib/analytics/alcance";

// Feature 122 / T2.4 — R30: el actor entra POR PARAMETRO y en forma ESTRUCTURAL.
//
// El `Actor` del repo vive en `lib/interfaces/services/IOrdenService.ts`, y el segmento
// `services` esta prohibido por el guardia de pureza de la 135. La solucion no es aflojar
// el guardia ni copiar el tipo y olvidarse: es declarar la forma MINIMA que el resolutor
// necesita y ATARLA con un test de asignabilidad. Si manana el `Actor` del repo cambia de
// forma (pierde `zonaId`, `rol` deja de ser una cadena), este archivo deja de compilar y el
// aviso llega en el build, no en produccion.
//
// El borde obtiene el actor con `resolveActorFromSession()` (`lib/auth/resolve-actor.ts`) y
// NO lee la cookie por su cuenta: `lib/analytics/` no importa `next/headers` y este test lo
// censa.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const DIR_ANALYTICS = path.join(REPO_ROOT, "lib", "analytics");

function soloCodigo(fuente: string): string {
  return quitarComentarios(fuente);
}

function archivosDeAnalytics(): string[] {
  return fs
    .readdirSync(DIR_ANALYTICS)
    .filter((n) => n.endsWith(".ts"))
    .map((n) => path.join(DIR_ANALYTICS, n));
}

describe("R30 · el Actor del repo es asignable a la forma estructural del modulo", () => {
  it("un Actor completo (con zonaId) vale como ActorAnalitica sin conversion", () => {
    const actorDelRepo: Actor = { usuarioId: "u1", rol: "adminSatelite", zonaId: "z1" };
    const paraAnalitica: ActorAnalitica = actorDelRepo;
    expect(resolverAlcance(paraAnalitica, "entregas")).toEqual({
      estado: "ok",
      alcance: { tipo: "zona", zonaId: "z1" },
    });
  });

  it("un Actor sin zonaId (el campo es opcional en el repo) tambien vale", () => {
    const actorDelRepo: Actor = { usuarioId: "u1", rol: "adminTienda" };
    const paraAnalitica: ActorAnalitica = actorDelRepo;
    expect(resolverAlcance(paraAnalitica, "entregas")).toEqual({
      estado: "ok",
      alcance: { tipo: "tienda", tiendaId: "u1" },
    });
  });

  it("un Actor con zonaId null (lo que devuelve resolveActorFromSession) tambien vale", () => {
    const actorDelRepo: Actor = { usuarioId: "u1", rol: "adminSatelite", zonaId: null };
    const paraAnalitica: ActorAnalitica = actorDelRepo;
    expect(resolverAlcance(paraAnalitica, "entregas")).toEqual({
      estado: "denegado",
      motivo: "sin_zona_asignada",
    });
  });

  it("la asignacion inversa NO se permite: `rol: string` no es un RolValue", () => {
    const cualquiera: ActorAnalitica = { usuarioId: "u1", rol: "lo-que-sea" };
    // @ts-expect-error — R30 solo promete una direccion: el Actor del repo encaja aqui, no
    // al reves. Si compilara, cualquier cadena entraria como rol en el resto del repo.
    const alReves: Actor = cualquiera;
    expect(alReves.usuarioId).toBe("u1");
  });
});

describe("R30 · lib/analytics no lee la sesion ni importa la capa services", () => {
  it("ningun archivo de lib/analytics importa interfaces/services ni next/headers", () => {
    const hallazgos: string[] = [];
    for (const archivo of archivosDeAnalytics()) {
      const codigo = soloCodigo(fs.readFileSync(archivo, "utf8"));
      for (const prohibido of ["interfaces/services", "next/headers", "cookies("]) {
        if (codigo.includes(prohibido)) {
          hallazgos.push(`${path.basename(archivo)}: ${prohibido}`);
        }
      }
    }
    expect(hallazgos).toEqual([]);
  });

  it("el censo mira los nueve modulos del lote y no una lista vacia", () => {
    expect(archivosDeAnalytics().length).toBeGreaterThanOrEqual(9);
  });
});
