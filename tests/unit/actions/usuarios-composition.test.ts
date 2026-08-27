import { describe, expect, it, vi } from "vitest";

import { SessionRepository } from "@/lib/repositories/SessionRepository";
import type { Actor } from "@/lib/interfaces/services/IUsuarioService";

/**
 * FEATURE 287 (T8, R20) — **EL COMPOSITION ROOT *PASA* EL REVOCADOR DE SESIONES.**
 *
 * ⚠️ POR QUE ESTE ARCHIVO EXISTE, y por que NO vale un `expect(fuente).toContain("SessionRepository")`.
 * En este repo ya paso: dos notificadores quedaron MUERTOS con la suite entera en verde porque el
 * composition root los IMPORTABA y no los INYECTABA. Aqui el riesgo es identico y ademas
 * ESTRUCTURAL: el cuarto parametro de `UsuarioService` es OPCIONAL —tiene que serlo, o rompe las
 * decenas de `new UsuarioService(repo)` de los tests existentes—, asi que olvidarlo NO rompe el
 * typecheck. Lo unico que lo detecta es ejecutar la Server Action SIN inyectar servicio y mirar
 * QUE construyo `buildUsuarioService()`.
 *
 * El servicio se mockea para capturar sus argumentos de constructor; Prisma se mockea para no
 * abrir ninguna conexion. Lo que se mide es el CABLEADO, no la base.
 */

const argumentosCapturados: unknown[][] = [];

vi.mock("@/lib/db/prisma-client", () => ({
  // Los repositorios solo lo guardan en su constructor; ninguno consulta al construirse.
  getPrismaClient: () => ({}) as never,
  PRISMA_OMIT: { orden: { busquedaTexto: true } },
}));

vi.mock("@/lib/services/UsuarioService", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/services/UsuarioService")>();
  return {
    ...real,
    UsuarioService: class {
      constructor(...args: unknown[]) {
        argumentosCapturados.push(args);
      }
      async restablecerContrasena() {
        return {
          status: "ok" as const,
          usuarioId: "usr-1",
          generatedPassword: "no-importa",
          sesionesRevocadas: 0,
        };
      }
    },
  };
});

const MAESTRO: Actor = { usuarioId: "maestro-1", rol: "maestro" };

describe("287/T8 · `buildUsuarioService` cablea el revocador de sesiones (R20)", () => {
  it("ejecutada SIN inyectar servicio, el objeto construido trae un `SessionRepository` usable", async () => {
    const { restablecerContrasenaUsuario } = await import("@/lib/actions/usuarios");

    // SIN `deps.usuarioService`: la accion tiene que pasar por `buildUsuarioService()`.
    const r = await restablecerContrasenaUsuario("usr-1", { getActor: async () => MAESTRO });

    expect(r.status).toBe("ok");
    expect(argumentosCapturados).toHaveLength(1);
    const args = argumentosCapturados[0];

    // 1. El cuarto argumento EXISTE. Un cableado olvidado con la dep opcional habria llegado
    //    aqui como `undefined` sin romper absolutamente nada.
    expect(
      args.length,
      "R20: el composition root no paso el cuarto argumento. El servicio se habria construido " +
        "sin revocador y `restablecerContrasena` lanzaria en produccion — con la suite en verde.",
    ).toBeGreaterThanOrEqual(4);
    expect(args[3]).toBeDefined();

    // 2. Es EL repositorio real, no un objeto cualquiera con un metodo del mismo nombre. Eso es
    //    lo que garantiza que el `DELETE` que corre sea el que los tests de Postgres midieron.
    expect(args[3]).toBeInstanceOf(SessionRepository);

    // 3. Y expone el metodo que el servicio llama. Si alguien cableara un `Pick` recortado o un
    //    doble de conveniencia, esto lo delata.
    expect(typeof (args[3] as SessionRepository).deleteAllByUserId).toBe("function");

    // 4. Los otros tres cables siguen ahi: este caso no puede quedar verde porque el servicio se
    //    construya «a medias» y el cuarto acabe ocupando el sitio de otro.
    for (const i of [0, 1, 2]) {
      expect(args[i], `el argumento ${i} de UsuarioService se perdio`).toBeDefined();
    }
  });
});
