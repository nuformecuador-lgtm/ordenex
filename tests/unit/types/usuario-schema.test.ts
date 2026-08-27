import { describe, it, expect } from "vitest";
import {
  USUARIO_BUSQUEDA_MAX_CHARS,
  USUARIO_BUSQUEDA_MIN_CHARS,
  actualizarUsuarioSchema,
  cambiarEstadoUsuarioSchema,
  crearUsuarioSchema,
  listarUsuariosCompletoSchema,
  listarUsuariosSchema,
  usuarioRolFiltroSchema,
} from "@/lib/types/usuario";
import { ROL_LABELS } from "@/lib/auth/rol-label";
import { usuariosConfig } from "@/lib/config/usuarios";

const baseCrear = {
  nombre: "Ana Torres",
  email: "ana@example.com",
  telefono: "0991234567",
  tipoIdentificacionId: "tipo-1",
  cedula: "1710034065",
  rolId: "rol-1",
};

describe("crearUsuarioSchema — union discriminada por passwordMode", () => {
  it("modo manual rechaza password que no cumple strongPasswordSchema (R6/R31)", () => {
    const r = crearUsuarioSchema.safeParse({
      ...baseCrear,
      passwordMode: "manual",
      password: "debil", // sin mayuscula/digito/simbolo y corta
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const fields = r.error.issues.map((i) => i.path.join("."));
      expect(fields).toContain("password");
    }
  });

  it("modo manual acepta password fuerte (R31)", () => {
    const r = crearUsuarioSchema.safeParse({
      ...baseCrear,
      passwordMode: "manual",
      password: "Abcdef1!",
    });
    expect(r.success).toBe(true);
  });

  it("modo generate no requiere password (R30/R32)", () => {
    const r = crearUsuarioSchema.safeParse({ ...baseCrear, passwordMode: "generate" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).not.toHaveProperty("password");
  });

  it("rechaza email con formato invalido (R6)", () => {
    const r = crearUsuarioSchema.safeParse({
      ...baseCrear,
      email: "no-es-email",
      passwordMode: "generate",
    });
    expect(r.success).toBe(false);
  });

  it("strict: rechaza campos desconocidos", () => {
    const r = crearUsuarioSchema.safeParse({
      ...baseCrear,
      passwordMode: "generate",
      hackeado: "x",
    });
    expect(r.success).toBe(false);
  });

  it("feature 27/R10: acepta fulfillment booleano (opcional) en ambas ramas", () => {
    const manual = crearUsuarioSchema.safeParse({
      ...baseCrear,
      passwordMode: "manual",
      password: "Abcdef1!",
      fulfillment: true,
    });
    const generate = crearUsuarioSchema.safeParse({
      ...baseCrear,
      passwordMode: "generate",
      fulfillment: false,
    });
    const sinFlag = crearUsuarioSchema.safeParse({ ...baseCrear, passwordMode: "generate" });
    expect(manual.success).toBe(true);
    expect(generate.success).toBe(true);
    expect(sinFlag.success).toBe(true); // opcional
  });

  it("feature 27/R10: rechaza fulfillment no booleano", () => {
    const r = crearUsuarioSchema.safeParse({
      ...baseCrear,
      passwordMode: "generate",
      fulfillment: "si",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const fields = r.error.issues.map((i) => i.path.join("."));
      expect(fields).toContain("fulfillment");
    }
  });
});

describe("actualizarUsuarioSchema", () => {
  it("acepta solo campos editables", () => {
    const r = actualizarUsuarioSchema.safeParse({ nombre: "Nuevo", rolId: "rol-2" });
    expect(r.success).toBe(true);
  });

  it("rechaza email/cedula/password (R16)", () => {
    for (const campo of [{ email: "x@y.com" }, { cedula: "123" }, { password: "Abcdef1!" }]) {
      const r = actualizarUsuarioSchema.safeParse(campo);
      expect(r.success).toBe(false);
    }
  });

  it("feature 27/R13: acepta fulfillment booleano y sigue rechazando email/cedula", () => {
    expect(actualizarUsuarioSchema.safeParse({ fulfillment: true }).success).toBe(true);
    expect(actualizarUsuarioSchema.safeParse({ fulfillment: false }).success).toBe(true);
    expect(actualizarUsuarioSchema.safeParse({ fulfillment: "no" }).success).toBe(false);
    // R13: `.strict()` sigue rechazando campos no editables aun con fulfillment.
    expect(
      actualizarUsuarioSchema.safeParse({ fulfillment: true, email: "x@y.com" }).success,
    ).toBe(false);
  });
});

describe("cambiarEstadoUsuarioSchema", () => {
  it("solo acepta activo|inactivo (R23)", () => {
    expect(cambiarEstadoUsuarioSchema.safeParse({ estado: "activo" }).success).toBe(true);
    expect(cambiarEstadoUsuarioSchema.safeParse({ estado: "inactivo" }).success).toBe(true);
    expect(cambiarEstadoUsuarioSchema.safeParse({ estado: "bloqueado" }).success).toBe(false);
    expect(cambiarEstadoUsuarioSchema.safeParse({ estado: "pendiente" }).success).toBe(false);
  });
});

describe("listarUsuariosSchema", () => {
  it("acota pageSize a MAX (R13)", () => {
    const r = listarUsuariosSchema.parse({ pageSize: 100000 });
    expect(r.pageSize).toBe(usuariosConfig.MAX_PAGE_SIZE);
  });

  it("aplica defaults de page/sortBy/sortDir (R15)", () => {
    const r = listarUsuariosSchema.parse({});
    expect(r.page).toBe(1);
    expect(r.sortBy).toBe("createdAt");
    expect(r.sortDir).toBe("desc");
  });

  it("rechaza sortBy fuera de la lista blanca (R15)", () => {
    expect(listarUsuariosSchema.safeParse({ sortBy: "passwordHash" }).success).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────
// FEATURE 285 — filtro por rol y buscador (design §9.2, casos T-U1…T-U5)
//
// Lo que ESTOS tests pueden demostrar y lo que NO. Aqui vive el BORDE: que entra y que se
// rechaza SIN llegar a consultar. El COMPORTAMIENTO del `WHERE` (que filas salen, que el
// total cuente lo filtrado, que `%` sea literal) NO se prueba aqui ni con dobles: vive en
// `tests/integration/db/usuarios-filtro-busqueda.test.ts`, contra Postgres real.
// ───────────────────────────────────────────────────────────────────────────────────────────

describe("285/T-U1 — listarUsuariosSchema.q: minimo y maximo (R8)", () => {
  it("por debajo del minimo falla, en el minimo pasa", () => {
    const corto = "a".repeat(USUARIO_BUSQUEDA_MIN_CHARS - 1);
    const justo = "a".repeat(USUARIO_BUSQUEDA_MIN_CHARS);

    expect(listarUsuariosSchema.safeParse({ q: corto }).success).toBe(false);
    const r = listarUsuariosSchema.safeParse({ q: justo });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.q).toBe(justo);
  });

  it("en el maximo pasa, un caracter por encima falla", () => {
    const justo = "b".repeat(USUARIO_BUSQUEDA_MAX_CHARS);
    const pasado = "b".repeat(USUARIO_BUSQUEDA_MAX_CHARS + 1);

    expect(listarUsuariosSchema.safeParse({ q: justo }).success).toBe(true);
    expect(listarUsuariosSchema.safeParse({ q: pasado }).success).toBe(false);
  });

  it("el error apunta al campo `q` y no se aplica ningun default que lo tape", () => {
    const r = listarUsuariosSchema.safeParse({ q: "a" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.map((i) => i.path.join("."))).toContain("q");
  });

  it("`q` es OPCIONAL: la llamada de siempre (`{}`) sigue validando sin termino (R1)", () => {
    const r = listarUsuariosSchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.q).toBeUndefined();
      expect(r.data.rol).toBeUndefined();
    }
  });
});

describe("285/T-U2 — el recorte va ANTES del minimo (R6)", () => {
  it("un termino que solo tiene espacios alrededor se mide YA recortado", () => {
    // «  a  » son 5 caracteres crudos y 1 recortado: debe FALLAR. Si `.trim()` se moviera
    // despues de `.min()`, los 5 pasarian el minimo y llegaria «a» al servicio.
    expect(listarUsuariosSchema.safeParse({ q: "  a  " }).success).toBe(false);
  });

  it("lo que si llega al minimo tras recortar, llega al servicio YA recortado", () => {
    const r = listarUsuariosSchema.safeParse({ q: "  ab  " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.q).toBe("ab");
  });

  it("un termino de solo espacios equivale a «sin busqueda»: no valida (R6)", () => {
    expect(listarUsuariosSchema.safeParse({ q: "     " }).success).toBe(false);
  });
});

describe("285/T-U3 — listarUsuariosSchema.rol: dominio cerrado y no vacio (R15)", () => {
  it("la lista VACIA se rechaza: `[]` nunca significa «sin filtro»", () => {
    const r = listarUsuariosSchema.safeParse({ rol: [] });
    expect(r.success).toBe(false);
  });

  it("un rol que no existe se rechaza", () => {
    expect(listarUsuariosSchema.safeParse({ rol: ["noExiste"] }).success).toBe(false);
    // Y tampoco cuela mezclado con uno valido.
    expect(listarUsuariosSchema.safeParse({ rol: ["mensajero", "noExiste"] }).success).toBe(false);
  });

  it("una seleccion MULTIPLE de roles reales pasa y conserva el orden recibido (R12/R13)", () => {
    const r = listarUsuariosSchema.safeParse({ rol: ["mensajero", "admin"] });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.rol).toEqual(["mensajero", "admin"]);
  });

  it("rechaza un escalar: el filtro es SIEMPRE lista", () => {
    expect(listarUsuariosSchema.safeParse({ rol: "mensajero" }).success).toBe(false);
  });
});

describe("285/T-U4 — la lista blanca de roles es EXHAUSTIVA sobre ROL_LABELS (R12)", () => {
  it("acepta TODAS las claves de ROL_LABELS, una por una", () => {
    const roles = Object.keys(ROL_LABELS);
    // Anti-vacuidad: si `ROL_LABELS` se vaciara, el bucle de abajo no afirmaria nada.
    expect(roles.length).toBeGreaterThanOrEqual(6);

    for (const rol of roles) {
      expect(usuarioRolFiltroSchema.safeParse(rol).success, `rol ${rol}`).toBe(true);
      expect(listarUsuariosSchema.safeParse({ rol: [rol] }).success, `rol ${rol}`).toBe(true);
    }
  });

  it("y NO acepta nada que no sea una clave de ROL_LABELS", () => {
    // El otro lado de la exhaustividad: sin esto, un `z.string()` pasaria el test de arriba.
    for (const impostor of ["Maestro", "maestro ", "", "admin_tienda", "superadmin"]) {
      expect(usuarioRolFiltroSchema.safeParse(impostor).success, `impostor ${impostor}`).toBe(
        false,
      );
    }
  });
});

describe("285/T-U5 — listarUsuariosCompletoSchema hereda el filtro por DERIVACION (R22/R23)", () => {
  it("acepta `q` y `rol` sin que se haya tocado una linea de su declaracion", () => {
    const r = listarUsuariosCompletoSchema.safeParse({ q: "ro", rol: ["mensajero", "admin"] });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.q).toBe("ro");
      expect(r.data.rol).toEqual(["mensajero", "admin"]);
    }
  });

  it("sigue rechazando `page`/`pageSize` (el modo completo NO pagina)", () => {
    expect(listarUsuariosCompletoSchema.safeParse({ page: 1 }).success).toBe(false);
    expect(listarUsuariosCompletoSchema.safeParse({ pageSize: 10 }).success).toBe(false);
  });

  it("sigue rechazando claves desconocidas y sigue aplicando los limites del listado (R8/R15)", () => {
    expect(listarUsuariosCompletoSchema.safeParse({ inventada: 1 }).success).toBe(false);
    expect(listarUsuariosCompletoSchema.safeParse({ q: "a" }).success).toBe(false); // minimo
    expect(listarUsuariosCompletoSchema.safeParse({ rol: [] }).success).toBe(false); // no vacia
  });

  it("sin filtros, la entrada de la descarga sigue siendo la de hoy: `{}` valida (R23)", () => {
    const r = listarUsuariosCompletoSchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.sortBy).toBe("createdAt");
      expect(r.data.sortDir).toBe("desc");
      expect(r.data.q).toBeUndefined();
      expect(r.data.rol).toBeUndefined();
    }
  });
});
