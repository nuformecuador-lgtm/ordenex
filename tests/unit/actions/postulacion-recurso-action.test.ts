import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { codigoSinComentarios } from "../../fixtures/sin-comentarios";
import { postularRecurso } from "@/lib/actions/postulacion-recurso";
import { ResetRateLimiter } from "@/lib/utils/reset-rate-limit";
import type { IPostulacionRecursoService } from "@/lib/interfaces/services/IPostulacionRecursoService";
import { loadPostulacionRecursoConfig } from "@/lib/config/postulacion-recurso";

// Feature 253 (T4.1/T4.2) — el borde PUBLICO. Cubre R4, R14, R15, R16, R18, R19 y "nunca lanza".

const CTX = { ipAddress: "1.2.3.4" };
const getContext = async () => CTX;

const ENTRADA = {
  tipo: "vehiculo",
  nombre: "Ana Solis",
  telefono: "+506 8888-8888",
  correo: "Ana.Solis@Ejemplo.COM",
  mensaje: "Camion de 3 toneladas en Heredia, disponible entre semana.",
};

function serviceDoble(
  overrides: Partial<IPostulacionRecursoService> = {},
): IPostulacionRecursoService {
  return {
    registrar: vi.fn().mockResolvedValue({ status: "ok" }),
    listar: vi.fn(),
    atender: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("253 / R4 — la accion es PUBLICA: sin sesion, sin actor y sin cookies", () => {
  it("el modulo NO importa `cookies` ni resuelve actor, y esta escrito que es a proposito", () => {
    const RUTA = "lib/actions/postulacion-recurso.ts";
    // Lectura ESTATICA: la unica forma honesta de afirmar "no lee ni escribe cookies" sin montar
    // un servidor. Si alguien "arregla" la ausencia de sesion, esto se pone rojo.
    //
    // ⚠️ Se mide el CODIGO SIN COMENTARIOS (`codigoSinComentarios`, feature 209): la cabecera de
    // ese archivo NOMBRA a proposito `resolveActorFromSession` para explicar por que NO esta, y
    // un test que leyera el fuente crudo se leeria su propia documentacion y fallaria por ella.
    const codigo = codigoSinComentarios(RUTA);
    expect(codigo).not.toContain("cookies");
    expect(codigo).not.toContain("resolveActorFromSession");
    expect(codigo).not.toContain("SESSION_COOKIE_NAME");

    // Y la ausencia esta DECLARADA en la prosa, para que nadie la lea como olvido: eso SI se
    // afirma sobre el fuente crudo, que es donde vive.
    const crudo = fs.readFileSync(
      path.join(__dirname, "..", "..", "..", ...RUTA.split("/")),
      "utf8",
    );
    expect(crudo).toContain("NO RESUELVE ACTOR NI COMPRUEBA ROL, Y ES DELIBERADO");
  });

  it("el quitador de comentarios NO deja el archivo vacio (si no, la asercion de arriba no mide nada)", () => {
    const codigo = codigoSinComentarios("lib/actions/postulacion-recurso.ts");
    // Control de anti-vacuidad: un `not.toContain` sobre una cadena vacia siempre pasa.
    expect(codigo).toContain("export async function postularRecurso");
    expect(codigo).toContain("limiter.registrar(rateKey)");
    expect(codigo.length).toBeGreaterThan(500);
  });

  it("registra una postulacion sin ningun actor y devuelve `ok`", async () => {
    const service = serviceDoble();
    const r = await postularRecurso(ENTRADA, {
      service,
      getContext,
      limiter: new ResetRateLimiter(),
    });
    expect(r).toEqual({ status: "ok" });
    expect(service.registrar).toHaveBeenCalledTimes(1);
  });

  it("el resultado NO lleva token, ni sesion, ni id de usuario", async () => {
    const r = await postularRecurso(ENTRADA, {
      service: serviceDoble(),
      getContext,
      limiter: new ResetRateLimiter(),
    });
    expect(Object.keys(r)).toEqual(["status"]);
  });
});

describe("253 / R14 + R15 — se revalida en el servidor, sin pasar por el formulario", () => {
  it.each([
    ["entrada vacia", {}],
    ["entrada nula", null],
    ["una cadena", "no soy un objeto"],
    ["tipo inventado", { ...ENTRADA, tipo: "camion" }],
    ["nombre en blanco", { ...ENTRADA, nombre: "   " }],
    ["correo roto", { ...ENTRADA, correo: "ana(arroba)ejemplo" }],
    ["mensaje vacio", { ...ENTRADA, mensaje: "" }],
  ])("%s -> validation_error y CERO escrituras", async (_caso, entrada) => {
    const service = serviceDoble();
    const r = await postularRecurso(entrada, {
      service,
      getContext,
      limiter: new ResetRateLimiter(),
    });

    expect(r.status).toBe("validation_error");
    expect(service.registrar).not.toHaveBeenCalled();
  });

  it("R9: `tipo` invalido se rechaza SIN escribir ninguna fila, y el error va en su campo", async () => {
    const service = serviceDoble();
    const r = await postularRecurso({ ...ENTRADA, tipo: "avioneta" }, {
      service,
      getContext,
      limiter: new ResetRateLimiter(),
    });

    expect(r.status).toBe("validation_error");
    if (r.status !== "validation_error") return;
    expect(Object.keys(r.fieldErrors)).toEqual(["tipo"]);
    expect(service.registrar).not.toHaveBeenCalled();
  });

  it("R15: varios campos malos producen varias claves en `fieldErrors`", async () => {
    const r = await postularRecurso(
      { tipo: "bodega", nombre: "", telefono: "1", correo: "x", mensaje: "" },
      { service: serviceDoble(), getContext, limiter: new ResetRateLimiter() },
    );
    expect(r.status).toBe("validation_error");
    if (r.status !== "validation_error") return;
    expect(Object.keys(r.fieldErrors).sort()).toEqual([
      "correo",
      "mensaje",
      "nombre",
      "telefono",
    ]);
  });

  it("R20: lo que llega al servicio ya viene normalizado por el schema", async () => {
    const service = serviceDoble();
    await postularRecurso(ENTRADA, { service, getContext, limiter: new ResetRateLimiter() });
    expect(service.registrar).toHaveBeenCalledWith({
      tipo: "vehiculo",
      nombre: "Ana Solis",
      telefono: "+506 8888-8888",
      correo: "ana.solis@ejemplo.com",
      mensaje: "Camion de 3 toneladas en Heredia, disponible entre semana.",
    });
  });
});

describe("253 / R16 — el limite de tasa rechaza SIN escribir", () => {
  it("al intento RATE_MAX + 1 devuelve `rate_limited` y el servicio no se llama", async () => {
    const { RATE_MAX } = loadPostulacionRecursoConfig();
    const service = serviceDoble();
    const limiter = new ResetRateLimiter();

    for (let i = 0; i < RATE_MAX; i += 1) {
      const r = await postularRecurso(ENTRADA, { service, getContext, limiter });
      expect(r).toEqual({ status: "ok" });
    }
    expect(service.registrar).toHaveBeenCalledTimes(RATE_MAX);

    const bloqueado = await postularRecurso(ENTRADA, { service, getContext, limiter });
    expect(bloqueado).toEqual({ status: "rate_limited" });
    expect(service.registrar).toHaveBeenCalledTimes(RATE_MAX); // ni una llamada mas
  });

  it("D4: la clave es `ip|correo` — otro correo desde la MISMA IP no queda bloqueado", async () => {
    const { RATE_MAX } = loadPostulacionRecursoConfig();
    const service = serviceDoble();
    const limiter = new ResetRateLimiter();

    for (let i = 0; i <= RATE_MAX; i += 1) {
      await postularRecurso(ENTRADA, { service, getContext, limiter });
    }
    const otro = await postularRecurso(
      { ...ENTRADA, correo: "beto@ejemplo.com" },
      { service, getContext, limiter },
    );
    expect(otro).toEqual({ status: "ok" });
  });

  it("D4: el correo entra en la clave NORMALIZADO — cambiar mayusculas no estrena cubo", async () => {
    const { RATE_MAX } = loadPostulacionRecursoConfig();
    const service = serviceDoble();
    const limiter = new ResetRateLimiter();

    for (let i = 0; i < RATE_MAX; i += 1) {
      await postularRecurso(ENTRADA, { service, getContext, limiter });
    }
    const conOtraCaja = await postularRecurso(
      { ...ENTRADA, correo: "ANA.SOLIS@ejemplo.com" },
      { service, getContext, limiter },
    );
    expect(conOtraCaja).toEqual({ status: "rate_limited" });
  });

  it("la MISMA persona desde otra IP no arrastra el bloqueo", async () => {
    const { RATE_MAX } = loadPostulacionRecursoConfig();
    const service = serviceDoble();
    const limiter = new ResetRateLimiter();

    for (let i = 0; i <= RATE_MAX; i += 1) {
      await postularRecurso(ENTRADA, { service, getContext, limiter });
    }
    const otraIp = await postularRecurso(ENTRADA, {
      service,
      getContext: async () => ({ ipAddress: "9.9.9.9" }),
      limiter,
    });
    expect(otraIp).toEqual({ status: "ok" });
  });
});

describe("253 / R18 — orden de operaciones: zod -> IP -> limite -> registrar -> servicio", () => {
  it("con entrada invalida NI SIQUIERA se lee la IP (zod va primero)", async () => {
    const getContextEspia = vi.fn(async () => CTX);
    await postularRecurso(
      { ...ENTRADA, correo: "roto" },
      { service: serviceDoble(), getContext: getContextEspia, limiter: new ResetRateLimiter() },
    );
    expect(getContextEspia).not.toHaveBeenCalled();
  });

  it("el intento se REGISTRA aunque el servicio falle: provocar errores no vacia el cubo", async () => {
    const { RATE_MAX } = loadPostulacionRecursoConfig();
    // El servicio devuelve `error` SIEMPRE. Si el intento solo se contase al acertar, un bucle de
    // fallos nunca llegaria al limite.
    const service = serviceDoble({ registrar: vi.fn().mockResolvedValue({ status: "error" }) });
    const limiter = new ResetRateLimiter();

    for (let i = 0; i < RATE_MAX; i += 1) {
      expect(await postularRecurso(ENTRADA, { service, getContext, limiter })).toEqual({
        status: "error",
      });
    }
    expect(await postularRecurso(ENTRADA, { service, getContext, limiter })).toEqual({
      status: "rate_limited",
    });
  });

  it("el registro del intento ocurre ANTES de llamar al servicio", async () => {
    const orden: string[] = [];
    const limiter = new ResetRateLimiter();
    vi.spyOn(limiter, "registrar").mockImplementation(() => orden.push("registrar"));
    const service = serviceDoble({
      registrar: vi.fn(async () => {
        orden.push("servicio");
        return { status: "ok" as const };
      }),
    });

    await postularRecurso(ENTRADA, { service, getContext, limiter });

    expect(orden).toEqual(["registrar", "servicio"]);
  });
});

describe("253 — la accion NUNCA lanza: todo desenlace es un resultado", () => {
  it("un servicio que devuelve `error` sale como `{ status: 'error' }`", async () => {
    const service = serviceDoble({ registrar: vi.fn().mockResolvedValue({ status: "error" }) });
    await expect(
      postularRecurso(ENTRADA, { service, getContext, limiter: new ResetRateLimiter() }),
    ).resolves.toEqual({ status: "error" });
  });

  it("los cuatro desenlaces del contrato son alcanzables desde esta accion", async () => {
    const limiter = new ResetRateLimiter();
    const vistos = new Set<string>();

    vistos.add(
      (await postularRecurso(ENTRADA, { service: serviceDoble(), getContext, limiter })).status,
    );
    vistos.add(
      (
        await postularRecurso(
          { ...ENTRADA, nombre: "" },
          { service: serviceDoble(), getContext, limiter },
        )
      ).status,
    );
    vistos.add(
      (
        await postularRecurso(ENTRADA, {
          service: serviceDoble({ registrar: vi.fn().mockResolvedValue({ status: "error" }) }),
          getContext,
          limiter,
        })
      ).status,
    );
    const { RATE_MAX } = loadPostulacionRecursoConfig();
    for (let i = 0; i < RATE_MAX + 2; i += 1) {
      vistos.add(
        (await postularRecurso(ENTRADA, { service: serviceDoble(), getContext, limiter })).status,
      );
    }

    expect([...vistos].sort()).toEqual(["error", "ok", "rate_limited", "validation_error"]);
  });
});

describe("253 / R19 — ni la consola ni el logger reciben mensaje, correo o telefono", () => {
  const SECRETOS = [
    "ana.solis@ejemplo.com",
    "Ana.Solis@Ejemplo.COM",
    "+506 8888-8888",
    "Camion de 3 toneladas en Heredia, disponible entre semana.",
  ];

  /** Captura los cuatro canales de `console`. Si alguien anade un `console.info` con el correo
   *  "para depurar", aparece aqui — que es exactamente lo que R19 prohibe. */
  function capturarConsola(): { salida: string[]; restaurar: () => void } {
    const salida: string[] = [];
    const espias = (["log", "info", "warn", "error"] as const).map((canal) =>
      vi.spyOn(console, canal).mockImplementation((...args: unknown[]) => {
        salida.push(args.map((a) => (a instanceof Error ? `${a.message}\n${a.stack}` : String(a))).join(" "));
      }),
    );
    return { salida, restaurar: () => espias.forEach((e) => e.mockRestore()) };
  }

  it("camino feliz: la consola queda limpia de datos personales", async () => {
    const { salida, restaurar } = capturarConsola();
    try {
      await postularRecurso(ENTRADA, {
        service: serviceDoble(),
        getContext,
        limiter: new ResetRateLimiter(),
      });
    } finally {
      restaurar();
    }
    const texto = salida.join("\n");
    for (const secreto of SECRETOS) expect(texto).not.toContain(secreto);
  });

  it("camino de error: tampoco con el servicio devolviendo `error`", async () => {
    const { salida, restaurar } = capturarConsola();
    try {
      await postularRecurso(ENTRADA, {
        service: serviceDoble({ registrar: vi.fn().mockResolvedValue({ status: "error" }) }),
        getContext,
        limiter: new ResetRateLimiter(),
      });
    } finally {
      restaurar();
    }
    const texto = salida.join("\n");
    for (const secreto of SECRETOS) expect(texto).not.toContain(secreto);
  });

  it("ni con el limite de tasa disparado", async () => {
    const { RATE_MAX } = loadPostulacionRecursoConfig();
    const limiter = new ResetRateLimiter();
    const service = serviceDoble();
    for (let i = 0; i < RATE_MAX; i += 1) {
      await postularRecurso(ENTRADA, { service, getContext, limiter });
    }

    const { salida, restaurar } = capturarConsola();
    try {
      await postularRecurso(ENTRADA, { service, getContext, limiter });
    } finally {
      restaurar();
    }
    const texto = salida.join("\n");
    for (const secreto of SECRETOS) expect(texto).not.toContain(secreto);
  });
});
