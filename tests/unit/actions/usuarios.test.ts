import { describe, it, expect, vi } from "vitest";
import {
  crearUsuario,
  listarUsuarios,
  obtenerUsuario,
  actualizarUsuario,
  cambiarEstadoUsuario,
  listarTiposIdentificacion,
  listarRoles,
  restablecerContrasenaUsuario,
} from "@/lib/actions/usuarios";
import type { Actor, IUsuarioService } from "@/lib/interfaces/services/IUsuarioService";
import type { UsuarioPublico } from "@/lib/interfaces/repositories/IUserRepository";
import {
  USUARIO_BUSQUEDA_MAX_CHARS,
  USUARIO_BUSQUEDA_MIN_CHARS,
} from "@/lib/types/usuario";

const MAESTRO: Actor = { usuarioId: "m1", rol: "maestro" };

const getActor = (actor: Actor) => async (): Promise<Actor | null> => actor;
const noActor = async (): Promise<Actor | null> => null;

function usuario(overrides: Partial<UsuarioPublico> = {}): UsuarioPublico {
  return {
    id: "usr-1",
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

function fakeService(overrides: Partial<IUsuarioService> = {}): IUsuarioService {
  return {
    crear: vi.fn().mockResolvedValue({ status: "ok", usuario: usuario() }),
    listar: vi
      .fn()
      .mockResolvedValue({ status: "ok", items: [], page: 1, pageSize: 25, total: 0 }),
    // Feature 170 (T B.1): el doble implementa la interfaz COMPLETA. Este archivo no
    // ejercita el modo sin paginacion (lo hace `usuarios-descarga-action.test.ts`); el
    // stub existe para que el doble siga siendo un `IUsuarioService` valido.
    listarCompleto: vi.fn().mockResolvedValue({ status: "ok", items: [], total: 0 }),
    obtener: vi.fn().mockResolvedValue({ status: "ok", usuario: usuario() }),
    actualizar: vi.fn().mockResolvedValue({ status: "ok", usuario: usuario() }),
    cambiarEstado: vi.fn().mockResolvedValue({ status: "ok", usuario: usuario() }),
    listarTiposIdentificacion: vi
      .fn()
      .mockResolvedValue({ status: "ok", tipos: [{ id: "tipo-1", value: "cedula" }] }),
    listarRoles: vi
      .fn()
      .mockResolvedValue({ status: "ok", roles: [{ id: "rol-1", value: "maestro" }] }),
    // Feature 287 (T7): el doble implementa la interfaz COMPLETA.
    restablecerContrasena: vi.fn().mockResolvedValue({
      status: "ok",
      usuarioId: "usr-1",
      generatedPassword: "Gen3rada!X",
      sesionesRevocadas: 2,
    }),
    ...overrides,
  };
}

const validCrearManual = {
  nombre: "Ana Torres",
  email: "ana@example.com",
  telefono: "099",
  tipoIdentificacionId: "tipo-1",
  cedula: "1710034065",
  rolId: "rol-1",
  passwordMode: "manual",
  password: "Abcdef1!",
};
const validCrearGenerate = {
  nombre: "Ana Torres",
  email: "ana@example.com",
  telefono: "099",
  tipoIdentificacionId: "tipo-1",
  cedula: "1710034065",
  rolId: "rol-1",
  passwordMode: "generate",
};

describe("R2: sin sesion -> unauthenticated sin tocar el service", () => {
  it("todas las acciones rechazan sin sesion", async () => {
    const service = fakeService();
    const deps = { usuarioService: service, getActor: noActor };
    expect((await crearUsuario(validCrearManual, deps)).status).toBe("unauthenticated");
    expect((await listarUsuarios({}, deps)).status).toBe("unauthenticated");
    expect((await obtenerUsuario("usr-1", deps)).status).toBe("unauthenticated");
    expect((await actualizarUsuario("usr-1", { nombre: "N" }, deps)).status).toBe("unauthenticated");
    expect((await cambiarEstadoUsuario("usr-1", { estado: "inactivo" }, deps)).status).toBe(
      "unauthenticated",
    );
    expect((await listarTiposIdentificacion(deps)).status).toBe("unauthenticated");
    expect((await listarRoles(deps)).status).toBe("unauthenticated");
    // Feature 287/R1: el restablecimiento entra por la MISMA puerta que las demas.
    expect((await restablecerContrasenaUsuario("usr-1", deps)).status).toBe("unauthenticated");
    expect(service.crear).not.toHaveBeenCalled();
    expect(service.listar).not.toHaveBeenCalled();
    expect(service.restablecerContrasena).not.toHaveBeenCalled();
  });
});

describe("R5/R6: input invalido -> validation_error con fieldErrors sin llamar al service", () => {
  it("crear modo manual con password debil -> validation_error (R6)", async () => {
    const service = fakeService();
    const r = await crearUsuario(
      { ...validCrearManual, password: "debil" },
      { usuarioService: service, getActor: getActor(MAESTRO) },
    );
    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") expect(r.fieldErrors).toHaveProperty("password");
    expect(service.crear).not.toHaveBeenCalled();
  });

  it("crear con email invalido -> validation_error (R5)", async () => {
    const service = fakeService();
    const r = await crearUsuario(
      { ...validCrearGenerate, email: "no-email" },
      { usuarioService: service, getActor: getActor(MAESTRO) },
    );
    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") expect(r.fieldErrors).toHaveProperty("email");
    expect(service.crear).not.toHaveBeenCalled();
  });
});

describe("R33: crearUsuario modo generate propaga generatedPassword del service", () => {
  it("propaga el generatedPassword", async () => {
    const service = fakeService({
      crear: vi
        .fn()
        .mockResolvedValue({ status: "ok", usuario: usuario(), generatedPassword: "Gen3rada!X" }),
    });
    const r = await crearUsuario(validCrearGenerate, {
      usuarioService: service,
      getActor: getActor(MAESTRO),
    });
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.generatedPassword).toBe("Gen3rada!X");
  });
});

describe("R28: delega en el service y adapta resultados de dominio", () => {
  it("propaga forbidden del service", async () => {
    const service = fakeService({ listar: vi.fn().mockResolvedValue({ status: "forbidden" }) });
    const r = await listarUsuarios({}, { usuarioService: service, getActor: getActor(MAESTRO) });
    expect(r.status).toBe("forbidden");
  });

  it("propaga conflict con campo del service (R10/R11)", async () => {
    const service = fakeService({
      crear: vi.fn().mockResolvedValue({ status: "conflict", campo: "email" }),
    });
    const r = await crearUsuario(validCrearManual, {
      usuarioService: service,
      getActor: getActor(MAESTRO),
    });
    expect(r.status).toBe("conflict");
    if (r.status === "conflict") expect(r.campo).toBe("email");
  });

  it("propaga not_found del service", async () => {
    const service = fakeService({
      cambiarEstado: vi.fn().mockResolvedValue({ status: "not_found" }),
    });
    const r = await cambiarEstadoUsuario(
      "x",
      { estado: "activo" },
      { usuarioService: service, getActor: getActor(MAESTRO) },
    );
    expect(r.status).toBe("not_found");
  });

  it("listarRoles delega en el service y devuelve id/value", async () => {
    const service = fakeService();
    const r = await listarRoles({ usuarioService: service, getActor: getActor(MAESTRO) });
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.roles).toEqual([{ id: "rol-1", value: "maestro" }]);
    expect(service.listarRoles).toHaveBeenCalledWith(MAESTRO);
  });

  it("listarRoles propaga forbidden del service", async () => {
    const service = fakeService({
      listarRoles: vi.fn().mockResolvedValue({ status: "forbidden" }),
    });
    const r = await listarRoles({ usuarioService: service, getActor: getActor(MAESTRO) });
    expect(r.status).toBe("forbidden");
  });

  it("crear valido delega con actor y datos parseados", async () => {
    const service = fakeService();
    const r = await crearUsuario(validCrearManual, {
      usuarioService: service,
      getActor: getActor(MAESTRO),
    });
    expect(r.status).toBe("ok");
    expect(service.crear).toHaveBeenCalledWith(expect.objectContaining({ email: "ana@example.com" }), MAESTRO);
  });
});

describe("id invalido -> validation_error con clave id", () => {
  it("obtenerUsuario con id vacio", async () => {
    const service = fakeService();
    const r = await obtenerUsuario("", { usuarioService: service, getActor: getActor(MAESTRO) });
    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") expect(Object.keys(r.fieldErrors)).toEqual(["id"]);
    expect(service.obtener).not.toHaveBeenCalled();
  });
});

/* ========================================================================== */
/* FEATURE 287 (T7) — el borde del restablecimiento de contrasena              */
/* ========================================================================== */

describe("287/R6/R10: la accion NO tiene por donde recibir una contrasena", () => {
  it("la firma admite exactamente `(id, deps)` — no hay un tercer parametro de entrada", () => {
    // ⭑ LA MUTACION QUE ESTE CASO MATA: «ampliar la firma con un segundo parametro de entrada»
    //   (`restablecerContrasenaUsuario(id, input, deps)`). Eso abriria la puerta a que el maestro
    //   FIJE una contrasena que conoce de antemano, que es justo lo que la Decision 5 de la
    //   feature 25 protegia y lo que esta ficha NO revierte. La ausencia del parametro es la
    //   garantia (R10), no una validacion que alguien pueda relajar.
    //
    //   `Function.length` cuenta los parametros sin default: `deps` lo tiene, asi que 1 es lo
    //   correcto y un `input` intermedio subiria la cuenta a 2.
    expect(restablecerContrasenaUsuario.length).toBe(1);
  });

  it.each([
    { id: "", que: "vacio" },
    { id: null, que: "null" },
    { id: 123, que: "numerico" },
    // ⭑ El caso que dice el requisito con todas las letras: si alguien intentara colar una
    //   contrasena por el unico parametro que hay, el borde la rechaza sin efectos.
    { id: { password: "Elegida-1!" }, que: "un objeto con una contrasena dentro" },
  ])("id $que -> validation_error sin llamar al service (R6)", async ({ id }) => {
    const service = fakeService();
    const r = await restablecerContrasenaUsuario(id, {
      usuarioService: service,
      getActor: getActor(MAESTRO),
    });
    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") expect(Object.keys(r.fieldErrors)).toEqual(["id"]);
    expect(service.restablecerContrasena, "R6: sin efectos de ningun tipo").not.toHaveBeenCalled();
  });
});

describe("287/R19/R21: propaga la contrasena y el numero de sesiones del service", () => {
  it("delega con el id parseado y el actor, y devuelve lo que el service dio", async () => {
    const service = fakeService();
    const r = await restablecerContrasenaUsuario("usr-1", {
      usuarioService: service,
      getActor: getActor(MAESTRO),
    });

    expect(service.restablecerContrasena).toHaveBeenCalledWith("usr-1", MAESTRO);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.generatedPassword).toBe("Gen3rada!X"); // R21: una vez, aqui
    expect(r.sesionesRevocadas).toBe(2); // R19
    expect(r.usuarioId).toBe("usr-1");
  });
});

describe("287/R15: ninguna rama de error viaja con contrasena", () => {
  it.each(["forbidden", "not_found", "self_reset_forbidden"] as const)(
    "`%s` del service llega al borde sin `generatedPassword`",
    async (status) => {
      const service = fakeService({
        restablecerContrasena: vi.fn().mockResolvedValue({ status }),
      });
      const r = await restablecerContrasenaUsuario("usr-1", {
        usuarioService: service,
        getActor: getActor(MAESTRO),
      });

      expect(r.status).toBe(status);
      // R15 comprobado sobre el objeto REAL, no sobre el tipo: el tipo ya lo impide, pero un
      // `...resultado` descuidado en el borde podria arrastrar el campo en tiempo de ejecucion.
      expect(Object.keys(r)).toEqual(["status"]);
      expect(JSON.stringify(r)).not.toContain("generatedPassword");
    },
  );

  it("un fallo INESPERADO del service tampoco devuelve contrasena", async () => {
    const service = fakeService({
      restablecerContrasena: vi.fn().mockRejectedValue(new Error("boom")),
    });
    // El manejador global convierte un error no mapeado en INTERNAL, y `toActionError` lo
    // re-lanza: lo que NO puede pasar es que salga un `ok` con secreto.
    await expect(
      restablecerContrasenaUsuario("usr-1", {
        usuarioService: service,
        getActor: getActor(MAESTRO),
      }),
    ).rejects.toThrow();
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────
// FEATURE 285 — el BORDE del filtro: fuera de contrato, `validation_error` SIN CONSULTAR.
//
// R8 y R15 no dicen solo «responde validation_error»: dicen «sin ejecutar ninguna consulta».
// Esa mitad NO la puede afirmar un test de schema —zod no sabe si alguien consulto despues—,
// asi que se afirma aqui, que es donde se ve que el servicio no recibe la llamada.
// ───────────────────────────────────────────────────────────────────────────────────────────
describe("285/R8/R15 — filtro fuera de contrato: validation_error sin llamar al service", () => {
  const casos: { que: string; input: Record<string, unknown>; campo: string }[] = [
    {
      que: "termino por DEBAJO del minimo",
      input: { q: "a".repeat(USUARIO_BUSQUEDA_MIN_CHARS - 1) },
      campo: "q",
    },
    {
      que: "termino por ENCIMA del maximo",
      input: { q: "b".repeat(USUARIO_BUSQUEDA_MAX_CHARS + 1) },
      campo: "q",
    },
    { que: "termino de solo espacios (1 caracter al recortar)", input: { q: "  a  " }, campo: "q" },
    { que: "lista de roles VACIA", input: { rol: [] }, campo: "rol" },
    { que: "rol que no existe", input: { rol: ["superadmin"] }, campo: "rol" },
  ];

  it.each(casos)("$que -> validation_error y el service NO se llama", async ({ input, campo }) => {
    const service = fakeService();
    const r = await listarUsuarios(input, {
      usuarioService: service,
      getActor: getActor(MAESTRO),
    });

    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") expect(Object.keys(r.fieldErrors)).toContain(campo);
    // La mitad que el schema no puede afirmar: no se ejecuto ninguna consulta.
    expect(service.listar).not.toHaveBeenCalled();
  });

  it("CONTRAPRUEBA: un filtro VALIDO si llega al service, ya recortado (R6)", async () => {
    // Sin este lado, los casos de arriba pasarian con una accion que no llamara NUNCA al
    // servicio: la ausencia de llamada dejaria de significar «rechazado» para significar «roto».
    const service = fakeService();
    const r = await listarUsuarios(
      { q: "  ro  ", rol: ["mensajero", "admin"] },
      { usuarioService: service, getActor: getActor(MAESTRO) },
    );

    expect(r.status).toBe("ok");
    expect(service.listar).toHaveBeenCalledTimes(1);
    const [entrada] = (service.listar as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(entrada.q).toBe("ro"); // R6: el borde recorta antes de dejarlo pasar
    expect(entrada.rol).toEqual(["mensajero", "admin"]);
  });
});
