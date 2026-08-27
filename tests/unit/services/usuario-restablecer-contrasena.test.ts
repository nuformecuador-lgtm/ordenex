import { describe, it, expect, vi, afterEach } from "vitest";

import { UsuarioService } from "@/lib/services/UsuarioService";
import type { Actor } from "@/lib/interfaces/services/IUsuarioService";
import type {
  IUserRepository,
  UsuarioPublico,
} from "@/lib/interfaces/repositories/IUserRepository";
import { strongPasswordSchema } from "@/lib/types/password-policy";
import { verifyPassword } from "@/lib/utils/password";

/**
 * FEATURE 287 (T6) — EL SERVICIO DEL RESTABLECIMIENTO, CON DOBLES.
 *
 * ⚠️ LO QUE ESTE ARCHIVO **NO** PUEDE PROBAR, Y ESTA DICHO AQUI PARA QUE NADIE LO CREA. Los
 * dobles NO ven el SQL: una mutacion del `where` del `deleteMany`, o escribir el hash en otra
 * fila, pasan por aqui en VERDE. Medido cuatro veces en este repo. Lo que sostiene R13/R16/R17
 * es `tests/integration/db/restablecer-contrasena-sql-real.test.ts`, contra Postgres.
 *
 * Lo que SI prueba, y en buena parte solo se puede probar aqui: el ORDEN de los dos escritos
 * (R11), que la contrasena la genera el sistema y es fuerte (R8/R9), que no hay ningun parametro
 * por el que entre una contrasena (R10), que ninguna rama de error viaja con secreto (R15), que
 * sin revocador inyectado la operacion FALLA en vez de degradar (R20), y que ningun canal de
 * `console` ve la contrasena (R23).
 *
 * A PROPOSITO NO SE MOCKEAN `hashPassword` NI `generateStrongPassword` (otros archivos de este
 * modulo si lo hacen): con el generador y bcrypt REALES, R9 se comprueba contra la politica de
 * verdad y R12 puede afirmar que el hash guardado VERIFICA la contrasena mostrada. Con dobles
 * deterministas eso seria una aserción contra su propia fuente.
 */

const MAESTRO: Actor = { usuarioId: "maestro-1", rol: "maestro" };
const OBJETIVO_ID = "usr-objetivo";

function usuario(overrides: Partial<UsuarioPublico> = {}): UsuarioPublico {
  return {
    id: OBJETIVO_ID,
    nombre: "Ana Torres",
    email: "ana@example.com",
    telefono: "099",
    estado: "activo",
    cedula: "1710034065",
    tipoIdentificacionId: "tipo-1",
    rolId: "rol-1",
    fulfillment: false,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

/**
 * Doble del repositorio de usuarios. TODOS los metodos son espias: asi el caso de `forbidden`
 * puede afirmar que NO se llamo a NINGUNO (R2 dice «sin leer NI modificar dato alguno»), que es
 * mas fuerte que afirmar solo que no se escribio.
 */
function repoUsuarios(overrides: Partial<IUserRepository> = {}): IUserRepository {
  return {
    findByEmailWithHash: vi.fn(),
    findById: vi.fn().mockResolvedValue(usuario()),
    findByEmail: vi.fn(),
    create: vi.fn(),
    updatePasswordHash: vi.fn().mockResolvedValue(undefined),
    listMensajeros: vi.fn(),
    listMensajerosParaFiltro: vi.fn(),
    listByRol: vi.fn(),
    listCuentasTienda: vi.fn(),
    list: vi.fn(),
    count: vi.fn(),
    update: vi.fn(),
    setEstado: vi.fn(),
    listTiposIdentificacion: vi.fn(),
    listRoles: vi.fn(),
    ...overrides,
  };
}

function revocador(count = 3) {
  return { deleteAllByUserId: vi.fn().mockResolvedValue(count) };
}

/** Cuantas veces se llamo a CUALQUIER metodo del repo, para la asercion «no se toco NADA». */
function llamadasA(repo: IUserRepository): number {
  return Object.values(repo as unknown as Record<string, unknown>)
    .filter((v): v is { mock: { calls: unknown[] } } => typeof v === "function" && "mock" in v)
    .reduce((n, espia) => n + espia.mock.calls.length, 0);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("287/R2/R3 — la autorizacion es la MISMA del modulo, y corta antes de tocar nada", () => {
  it.each(["admin", "mensajero", "adminTienda", "adminSatelite", "rol-que-no-existe"])(
    "rol `%s` -> forbidden sin llamar a NINGUN repositorio",
    async (rol) => {
      const repo = repoUsuarios();
      const sesiones = revocador();
      const service = new UsuarioService(repo, undefined, undefined, sesiones);

      const r = await service.restablecerContrasena(OBJETIVO_ID, {
        usuarioId: "otro",
        rol: rol as Actor["rol"],
      });

      expect(r).toEqual({ status: "forbidden" });
      expect(llamadasA(repo), "R2: no debe leer NI modificar dato alguno del objetivo").toBe(0);
      expect(sesiones.deleteAllByUserId).not.toHaveBeenCalled();
    },
  );

  it("R3: el guard NO es «que niegue a todos» — `maestro` si pasa", async () => {
    // La contraprueba del caso de arriba. Sin ella, un `return { status: "forbidden" }` al
    // principio del metodo dejaria los cinco roles en verde.
    const service = new UsuarioService(repoUsuarios(), undefined, undefined, revocador());
    const r = await service.restablecerContrasena(OBJETIVO_ID, MAESTRO);
    expect(r.status).toBe("ok");
  });
});

describe("287/R4 — usuario inexistente", () => {
  it("not_found sin revocar ni escribir", async () => {
    const repo = repoUsuarios({ findById: vi.fn().mockResolvedValue(null) });
    const sesiones = revocador();
    const service = new UsuarioService(repo, undefined, undefined, sesiones);

    const r = await service.restablecerContrasena("no-existe", MAESTRO);

    expect(r).toEqual({ status: "not_found" });
    expect(sesiones.deleteAllByUserId).not.toHaveBeenCalled();
    expect(repo.updatePasswordHash).not.toHaveBeenCalled();
  });
});

describe("287/R5 — el maestro no se restablece a si mismo", () => {
  it("objetivo = actor -> self_reset_forbidden, distinguible de forbidden y sin efectos", async () => {
    const repo = repoUsuarios({
      findById: vi.fn().mockResolvedValue(usuario({ id: MAESTRO.usuarioId })),
    });
    const sesiones = revocador();
    const service = new UsuarioService(repo, undefined, undefined, sesiones);

    const r = await service.restablecerContrasena(MAESTRO.usuarioId, MAESTRO);

    expect(r).toEqual({ status: "self_reset_forbidden" });
    // R5 dice «distinguible de forbidden»: si el status colapsara, la UI no podria decirle al
    // maestro POR QUE no puede, y le mostraria el mismo mensaje que a un rol sin permiso.
    expect(r.status).not.toBe("forbidden");
    expect(sesiones.deleteAllByUserId, "R5: NO debe revocar sesion alguna").not.toHaveBeenCalled();
    expect(repo.updatePasswordHash).not.toHaveBeenCalled();
  });
});

describe("287/R7/R14 — cualquier estado, y nada mas se toca", () => {
  it.each(["activo", "inactivo", "pendiente", "bloqueado"] as const)(
    "un usuario `%s` se restablece igual, y el servicio no llama a `update` ni a `setEstado`",
    async (estado) => {
      const repo = repoUsuarios({ findById: vi.fn().mockResolvedValue(usuario({ estado })) });
      const service = new UsuarioService(repo, undefined, undefined, revocador());

      const r = await service.restablecerContrasena(OBJETIVO_ID, MAESTRO);

      expect(r.status).toBe("ok");
      // R14 visto desde aqui: la UNICA escritura sobre `usuario` es la del hash. `update` es la
      // via por la que se tocarian nombre/rol/zona/vehiculo/fulfillment y `setEstado` la del
      // estado. Que ninguna otra COLUMNA cambie de verdad lo mide el test de Postgres.
      expect(repo.update).not.toHaveBeenCalled();
      expect(repo.setEstado).not.toHaveBeenCalled();
      expect(repo.updatePasswordHash).toHaveBeenCalledTimes(1);
    },
  );
});

describe("287/R8/R9/R10 — la genera el sistema, fuerte, y no entra por ningun parametro", () => {
  it("la contrasena devuelta cumple `strongPasswordSchema` (la MISMA politica del alta)", async () => {
    const service = new UsuarioService(repoUsuarios(), undefined, undefined, revocador());

    const r = await service.restablecerContrasena(OBJETIVO_ID, MAESTRO);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(strongPasswordSchema.safeParse(r.generatedPassword).success).toBe(true);
  });

  it("dos restablecimientos seguidos dan contrasenas DISTINTAS (no es un literal)", async () => {
    // ⭑ La mutacion de `design.md` §10 es «sustituir `generateStrongPassword()` por un literal
    //   debil». `strongPasswordSchema` sola no la mataria si el literal fuese fuerte; esto si.
    const service = new UsuarioService(repoUsuarios(), undefined, undefined, revocador());

    const a = await service.restablecerContrasena(OBJETIVO_ID, MAESTRO);
    const b = await service.restablecerContrasena(OBJETIVO_ID, MAESTRO);

    if (a.status !== "ok" || b.status !== "ok") throw new Error("ambas debian ser ok");
    expect(a.generatedPassword).not.toBe(b.generatedPassword);
  });

  it("R10: el metodo acepta EXACTAMENTE dos argumentos — no hay hueco para una contrasena", () => {
    // La garantia de R10 es la ARIDAD, no una validacion que alguien pueda relajar: si nadie
    // puede pasar un valor, nadie puede fijarlo. `Function.length` cuenta los parametros
    // declarados sin default ni rest, asi que un tercero se ve aqui.
    expect(UsuarioService.prototype.restablecerContrasena.length).toBe(2);
  });
});

describe("287/R12 — se persiste el hash, nunca el claro", () => {
  it("el argumento de `updatePasswordHash` NO es la contrasena, y `verifyPassword` contra el da true", async () => {
    const updatePasswordHash = vi.fn().mockResolvedValue(undefined);
    const service = new UsuarioService(
      repoUsuarios({ updatePasswordHash }),
      undefined,
      undefined,
      revocador(),
    );

    const r = await service.restablecerContrasena(OBJETIVO_ID, MAESTRO);
    if (r.status !== "ok") throw new Error("debia ser ok");

    const [idArg, hashArg] = updatePasswordHash.mock.calls[0] as [string, string];
    expect(idArg).toBe(OBJETIVO_ID);
    expect(hashArg, "R12: guardar el claro es exactamente lo prohibido").not.toBe(
      r.generatedPassword,
    );
    expect(hashArg.startsWith("$2")).toBe(true); // bcrypt
    await expect(verifyPassword(r.generatedPassword, hashArg)).resolves.toBe(true);
    // Y no es el hash de OTRA cosa: una contrasena distinta no verifica.
    await expect(verifyPassword("Otra-Cosa-9!x", hashArg)).resolves.toBe(false);
  });
});

describe("287/R11/R15 — revocar ANTES de escribir el hash", () => {
  it("si `updatePasswordHash` rechaza, `deleteAllByUserId` YA se llamo, y el error no lleva contrasena", async () => {
    const sesiones = revocador();
    const updatePasswordHash = vi.fn().mockRejectedValue(new Error("boom al escribir"));
    const service = new UsuarioService(
      repoUsuarios({ updatePasswordHash }),
      undefined,
      undefined,
      sesiones,
    );

    const error = await service
      .restablecerContrasena(OBJETIVO_ID, MAESTRO)
      .then(() => null)
      .catch((e: unknown) => e);

    expect(error, "R15: un fallo del segundo paso debe propagarse, no devolver ok").toBeInstanceOf(
      Error,
    );
    // R11: el estado que queda es el MAS restrictivo — sesiones cerradas, contrasena sin rotar.
    expect(sesiones.deleteAllByUserId).toHaveBeenCalledWith(OBJETIVO_ID);
    // ⭑ Mata «invertir el orden de las dos llamadas»: con hash → revocar, el revocador nunca
    //   se habria llamado en este escenario.
    expect(sesiones.deleteAllByUserId.mock.invocationCallOrder[0]).toBeLessThan(
      updatePasswordHash.mock.invocationCallOrder[0],
    );
    // R15: el error se propaga TAL CUAL, sin envolverlo en nada que pudiera arrastrar el secreto.
    expect((error as Error).message).toBe("boom al escribir");
  });

  it("si `deleteAllByUserId` rechaza, `updatePasswordHash` NO se llama", async () => {
    const sesiones = { deleteAllByUserId: vi.fn().mockRejectedValue(new Error("boom al revocar")) };
    const repo = repoUsuarios();
    const service = new UsuarioService(repo, undefined, undefined, sesiones);

    await expect(service.restablecerContrasena(OBJETIVO_ID, MAESTRO)).rejects.toThrow(
      "boom al revocar",
    );

    // ⭑ Mata «mover la revocacion despues del hash»: ahi la contrasena quedaria rotada con las
    //   sesiones vivas, que es el unico estado intermedio inaceptable.
    expect(
      repo.updatePasswordHash,
      "R11: nunca un estado mas permisivo (contrasena rotada con sesiones vivas)",
    ).not.toHaveBeenCalled();
  });
});

describe("287/R19 — cuantas sesiones se revocaron", () => {
  it.each([0, 1, 7])("devuelve el count que dio el repositorio (%i), no un fijo", async (count) => {
    const service = new UsuarioService(repoUsuarios(), undefined, undefined, revocador(count));

    const r = await service.restablecerContrasena(OBJETIVO_ID, MAESTRO);

    if (r.status !== "ok") throw new Error("debia ser ok");
    // Tres valores distintos: «devolver 0 fijo» muere con el segundo, y cualquier constante
    // muere con alguno de los tres.
    expect(r.sesionesRevocadas).toBe(count);
    expect(r.usuarioId).toBe(OBJETIVO_ID);
  });
});

describe("287/R20 — sin revocador inyectado, FALLA de forma visible", () => {
  it("lanza, y NO toca la contrasena", async () => {
    // ⭑ La mutacion que este caso existe para matar: «arreglarlo» con un
    //   `if (!this.sessionRepo) return { status: "ok", … }`. Un colaborador opcional que se
    //   ignora en silencio es el modo de fallo que ya dejo dos notificadores muertos en este
    //   repo con la suite entera en verde.
    const repo = repoUsuarios();
    const service = new UsuarioService(repo); // sin cuarto argumento

    await expect(service.restablecerContrasena(OBJETIVO_ID, MAESTRO)).rejects.toThrow(
      /sesiones/i,
    );
    expect(repo.updatePasswordHash).not.toHaveBeenCalled();
  });
});

describe("287/R23 — la contrasena no sale por NINGUN canal de console", () => {
  it("ningun metodo de `console` recibe un texto que la contenga, en el flujo completo", async () => {
    // Se espian TODOS los metodos de console, no solo `log`: la guardia de credenciales que ya
    // existe solo mira `console.log`, y un `console.error(plain)` seria igual de grave.
    const metodos = Object.keys(console).filter(
      (k) => typeof (console as unknown as Record<string, unknown>)[k] === "function",
    );
    const vistos: unknown[] = [];
    for (const m of metodos) {
      vi.spyOn(console, m as keyof Console).mockImplementation(((...args: unknown[]) => {
        vistos.push(...args);
      }) as never);
    }

    const service = new UsuarioService(repoUsuarios(), undefined, undefined, revocador());
    const r = await service.restablecerContrasena(OBJETIVO_ID, MAESTRO);

    vi.restoreAllMocks();
    if (r.status !== "ok") throw new Error("debia ser ok");

    // Anti-vacuidad: si el espia no cubriera nada, este caso pasaria por no haber mirado.
    expect(metodos.length).toBeGreaterThan(3);
    const texto = vistos.map((v) => (typeof v === "string" ? v : JSON.stringify(v))).join(" ");
    expect(
      texto.includes(r.generatedPassword),
      "R23: la contrasena NO puede aparecer en un log, por ningun canal ni en ninguna capa",
    ).toBe(false);
  });

  it("CONTRAPRUEBA: el espia SI veria la contrasena si alguien la imprimiera", async () => {
    // Sin esto, el caso de arriba estaria verde por no haber capturado nada nunca.
    const vistos: unknown[] = [];
    vi.spyOn(console, "log").mockImplementation(((...args: unknown[]) => {
      vistos.push(...args);
    }) as never);
    console.log("la contrasena es", "Secreta-9!x");
    vi.restoreAllMocks();
    expect(vistos.join(" ")).toContain("Secreta-9!x");
  });
});

describe("287/R37/R38 — ni correo, ni aviso, ni nada que dependa de un proveedor", () => {
  it("el flujo completo termina en `ok` sin ningun colaborador de notificacion inyectado", async () => {
    // R38: el restablecimiento debe funcionar con el SMTP caido, que es el estado de produccion
    // hoy. La forma de probarlo es que el servicio NO tenga por donde enviar nada: se construye
    // con exactamente dos colaboradores (repo + revocador) y aun asi completa.
    const service = new UsuarioService(repoUsuarios(), undefined, undefined, revocador());

    const r = await service.restablecerContrasena(OBJETIVO_ID, MAESTRO);

    expect(r.status).toBe("ok");
  });

  it("R37: el constructor de `UsuarioService` no admite ningun emisor de notificaciones", () => {
    // ⭑ Mata la mutacion «anadir un envio de aviso»: para enviar algo habria que inyectarlo, y
    //   el constructor tiene CUATRO parametros contados. Si manana alguien anade un quinto para
    //   un notificador, este caso se pone rojo y obliga a reabrir R37 en la puerta —donde el
    //   humano decidio el 2026-08-26 que al usuario NO se le avisa— en vez de colarlo.
    expect(UsuarioService.length).toBe(4);
  });
});
