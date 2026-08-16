import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, it, expect, vi, afterEach } from "vitest";

import { consultarRastreoPublico } from "@/lib/actions/rastreo-publico";
import type {
  IRastreoPublicoService,
  ResultadoConsultaRastreo,
} from "@/lib/interfaces/services/IRastreoPublicoService";
import type { RastreoPublicoDTO } from "@/lib/types/rastreo-publico";
import { ResetRateLimiter } from "@/lib/utils/reset-rate-limit";

// Feature 229 — T2.6: el borde publico. Cubre R2, R9, R10 y R32.
//
// Todo va con dobles inyectados (`deps`): la accion no toca la base en ningun test, que es
// justamente lo que permite afirmar "el limite rechaza SIN consultar datos".

const ENVIO: RastreoPublicoDTO = {
  numGuia: 4321,
  hitoVigente: "entregado",
  actualizadoEn: "2026-08-13T11:00-06:00",
  linea: [{ hito: "entregado", fecha: "2026-08-13T11:00-06:00" }],
};

function buildService(resultado: ResultadoConsultaRastreo = { estado: "ok", envio: ENVIO }) {
  const consultar = vi.fn(async (_numGuia: number, _factor: string) => resultado);
  const service: IRastreoPublicoService = { consultar };
  return { service, consultar };
}

/** Reloj congelado e inyectable: la ventana del limitador se mueve a mano, no con el reloj real. */
function relojFalso(inicio = 1_700_000_000_000) {
  let ahora = inicio;
  return {
    limiter: new ResetRateLimiter(() => ahora),
    avanzarMinutos: (minutos: number) => {
      ahora += minutos * 60_000;
    },
  };
}

function contexto(ipAddress = "203.0.113.7") {
  return async () => ({ ipAddress });
}

const ENV_ORIGINAL = { ...process.env };

afterEach(() => {
  process.env = { ...ENV_ORIGINAL };
});

describe("R2 — funciona sin sesion", () => {
  it("devuelve resultado sin cookie de sesion y sin resolver actor", async () => {
    const { service, consultar } = buildService();
    const { limiter } = relojFalso();

    const resultado = await consultarRastreoPublico(
      { numGuia: "4321", factor: "7766" },
      { service, limiter, getContext: contexto() },
    );

    expect(resultado).toEqual({ estado: "ok", envio: ENVIO });
    expect(consultar).toHaveBeenCalledWith(4321, "7766");
  });

  it("el modulo no importa la resolucion de actor ni las cookies de sesion", () => {
    const fuente = readFileSync(
      path.resolve(process.cwd(), "lib/actions/rastreo-publico.ts"),
      "utf8",
    );
    const imports = fuente.match(/^import[\s\S]*?;$/gm)?.join("\n") ?? "";
    const codigo = fuente
      .split("\n")
      .filter((linea) => {
        const limpia = linea.trimStart();
        return !limpia.startsWith("//") && !limpia.startsWith("*") && !limpia.startsWith("/*");
      })
      .join("\n");

    expect(imports).not.toContain("resolveActorFromSession");
    expect(imports).not.toContain("next/navigation");
    expect(codigo).not.toContain("resolveActorFromSession");
    expect(codigo).not.toContain("cookies(");
    expect(codigo).not.toContain("redirect(");
    // R24/R35 — ni el service interno del historial ni la etiqueta del paquete.
    expect(codigo).not.toContain("OrdenHistorial");
    expect(codigo).not.toContain("obtenerEtiquetaPorGuia");
    expect(codigo).not.toContain("paquete-url");
  });

  it("propaga tal cual el rechazo del service, sin enriquecerlo (R7)", async () => {
    const { service } = buildService({ estado: "no_encontrado" });
    const { limiter } = relojFalso();
    const resultado = await consultarRastreoPublico(
      { numGuia: 1, factor: "7766" },
      { service, limiter, getContext: contexto() },
    );
    expect(resultado).toEqual({ estado: "no_encontrado" });
  });
});

describe("R9 — limite de intentos por IP", () => {
  it("al noveno intento en diez minutos responde demasiados_intentos sin llamar al servicio, con guias existentes e inexistentes por igual, y la clave del limitador no incorpora la guia", async () => {
    const { service, consultar } = buildService();
    const { limiter } = relojFalso();
    const deps = { service, limiter, getContext: contexto() };

    // Ocho intentos entran (el defecto firmado, G4). Cada uno con una guia DISTINTA: si la
    // clave incorporase la guia, el atacante estrenaria cubo y nunca llegaria al limite.
    for (let i = 1; i <= 8; i++) {
      const resultado = await consultarRastreoPublico({ numGuia: i, factor: "7766" }, deps);
      expect(resultado.estado).not.toBe("demasiados_intentos");
    }
    expect(consultar).toHaveBeenCalledTimes(8);

    const noveno = await consultarRastreoPublico({ numGuia: 99, factor: "7766" }, deps);
    expect(noveno).toEqual({ estado: "demasiados_intentos" });
    expect(consultar).toHaveBeenCalledTimes(8); // el service NO recibio la novena
  });

  it("la secuencia de rechazos es la misma con una guia que existe y con una que no", async () => {
    const secuenciaDe = async (resultado: ResultadoConsultaRastreo) => {
      const { service } = buildService(resultado);
      const { limiter } = relojFalso();
      const deps = { service, limiter, getContext: contexto() };
      const estados: string[] = [];
      for (let i = 1; i <= 10; i++) {
        estados.push(
          (await consultarRastreoPublico({ numGuia: i, factor: "7766" }, deps)).estado,
        );
      }
      return estados;
    };

    const conGuiaExistente = await secuenciaDe({ estado: "ok", envio: ENVIO });
    const conGuiaInexistente = await secuenciaDe({ estado: "no_encontrado" });

    // Lo que se compara es DONDE cae el corte, no el resultado de cada consulta.
    const corte = (estados: string[]) => estados.map((e) => e === "demasiados_intentos");
    expect(corte(conGuiaExistente)).toEqual(corte(conGuiaInexistente));
    expect(corte(conGuiaExistente)).toEqual([...Array(8).fill(false), true, true]);
  });

  it("la clave es solo la IP: otra IP tiene su propio cubo", async () => {
    const { service } = buildService();
    const { limiter } = relojFalso();
    for (let i = 1; i <= 9; i++) {
      await consultarRastreoPublico(
        { numGuia: i, factor: "7766" },
        { service, limiter, getContext: contexto("203.0.113.7") },
      );
    }
    const otraIp = await consultarRastreoPublico(
      { numGuia: 1, factor: "7766" },
      { service, limiter, getContext: contexto("198.51.100.4") },
    );
    expect(otraIp.estado).toBe("ok");
  });

  it("la guia NO entra en la clave del limitador", () => {
    const fuente = readFileSync(
      path.resolve(process.cwd(), "lib/actions/rastreo-publico.ts"),
      "utf8",
    );
    const clave = fuente.slice(fuente.indexOf("function buildRateKey"));
    const cuerpo = clave.slice(0, clave.indexOf("}"));
    expect(cuerpo).toContain("rastreo:");
    expect(cuerpo).not.toContain("numGuia");
    expect(cuerpo).not.toContain("guia");
    expect(cuerpo).not.toContain("factor");
  });

  it("pasada la ventana, la misma IP vuelve a poder consultar", async () => {
    const { service } = buildService();
    const { limiter, avanzarMinutos } = relojFalso();
    const deps = { service, limiter, getContext: contexto() };
    for (let i = 1; i <= 8; i++) {
      await consultarRastreoPublico({ numGuia: i, factor: "7766" }, deps);
    }
    expect((await consultarRastreoPublico({ numGuia: 9, factor: "7766" }, deps)).estado).toBe(
      "demasiados_intentos",
    );
    avanzarMinutos(11);
    expect((await consultarRastreoPublico({ numGuia: 9, factor: "7766" }, deps)).estado).toBe("ok");
  });
});

describe("R10 — umbrales por variable de entorno", () => {
  it("el limite efectivo cambia con la variable de entorno y cae a 8 en 10 minutos sin ella", async () => {
    process.env.RASTREO_PUBLICO_RATE_MAX = "2";
    const { service } = buildService();
    const { limiter } = relojFalso();
    const deps = { service, limiter, getContext: contexto() };

    expect((await consultarRastreoPublico({ numGuia: 1, factor: "7766" }, deps)).estado).toBe("ok");
    expect((await consultarRastreoPublico({ numGuia: 2, factor: "7766" }, deps)).estado).toBe("ok");
    expect((await consultarRastreoPublico({ numGuia: 3, factor: "7766" }, deps)).estado).toBe(
      "demasiados_intentos",
    );

    // Sin variable, el defecto en codigo: el noveno es el primero rechazado.
    delete process.env.RASTREO_PUBLICO_RATE_MAX;
    const limpio = relojFalso();
    const depsLimpio = { service, limiter: limpio.limiter, getContext: contexto("198.51.100.9") };
    for (let i = 1; i <= 8; i++) {
      expect(
        (await consultarRastreoPublico({ numGuia: i, factor: "7766" }, depsLimpio)).estado,
      ).toBe("ok");
    }
    expect((await consultarRastreoPublico({ numGuia: 9, factor: "7766" }, depsLimpio)).estado).toBe(
      "demasiados_intentos",
    );
  });

  it("la ventana tambien sale del entorno", async () => {
    process.env.RASTREO_PUBLICO_RATE_MAX = "1";
    process.env.RASTREO_PUBLICO_RATE_WINDOW_MINUTES = "30";
    const { service } = buildService();
    const { limiter, avanzarMinutos } = relojFalso();
    const deps = { service, limiter, getContext: contexto() };

    await consultarRastreoPublico({ numGuia: 1, factor: "7766" }, deps);
    avanzarMinutos(15); // dentro de la ventana ampliada
    expect((await consultarRastreoPublico({ numGuia: 2, factor: "7766" }, deps)).estado).toBe(
      "demasiados_intentos",
    );
    avanzarMinutos(20); // fuera de los 30 minutos
    expect((await consultarRastreoPublico({ numGuia: 3, factor: "7766" }, deps)).estado).toBe("ok");
  });

  it("los umbrales no estan escritos en el modulo que los aplica", () => {
    const fuente = readFileSync(
      path.resolve(process.cwd(), "lib/actions/rastreo-publico.ts"),
      "utf8",
    );
    const codigo = fuente
      .split("\n")
      .filter((linea) => !linea.trimStart().startsWith("//") && !linea.trimStart().startsWith("*"))
      .join("\n");
    expect(codigo).toContain("loadRastreoPublicoConfig");
    expect(codigo).toContain("RATE_MAX");
    expect(codigo).not.toMatch(/superaLimite\([^)]*\b8\b/);
  });
});

describe("R32 — zod en el borde, resultado tipado, sin excepciones", () => {
  it("devuelve validation_error ante guia no numerica, negativa o campos vacios, sin lanzar", async () => {
    const { service, consultar } = buildService();
    const { limiter } = relojFalso();
    const deps = { service, limiter, getContext: contexto() };

    const entradasMalas: unknown[] = [
      { numGuia: "abc", factor: "7766" },
      { numGuia: -5, factor: "7766" },
      { numGuia: 0, factor: "7766" },
      { numGuia: 4.5, factor: "7766" },
      { numGuia: 4321, factor: "" },
      { numGuia: 4321, factor: "   " },
      { numGuia: 4321 },
      { factor: "7766" },
      {},
      { numGuia: 4321, factor: 7766 },
      { numGuia: [4321], factor: "7766" },
      null,
      undefined,
      "4321",
    ];

    for (const entrada of entradasMalas) {
      const resultado = await consultarRastreoPublico(entrada, deps);
      expect(resultado.estado).toBe("validation_error");
      if (resultado.estado !== "validation_error") throw new Error("imposible");
      expect(typeof resultado.campos).toBe("object");
    }

    // Ninguna entrada mal formada llega a datos ni gasta cubo del limitador.
    expect(consultar).not.toHaveBeenCalled();
  });

  it("los mensajes de rechazo son literales fijos y NO repiten la entrada (R12)", async () => {
    const { service } = buildService();
    const { limiter } = relojFalso();
    const resultado = await consultarRastreoPublico(
      { numGuia: "guia-secreta-123", factor: "" },
      { service, limiter, getContext: contexto() },
    );
    if (resultado.estado !== "validation_error") throw new Error("se esperaba validation_error");
    const serializado = JSON.stringify(resultado.campos);
    expect(serializado).not.toContain("guia-secreta-123");
    expect(resultado.campos.numGuia).toBe("Número de guía no válido.");
    expect(resultado.campos.factor).toBe("Dato requerido.");
  });

  it("acepta la guia como texto (lo que teclea el destinatario) y la coerce a entero", async () => {
    const { service, consultar } = buildService();
    const { limiter } = relojFalso();
    await consultarRastreoPublico(
      { numGuia: " 4321 ", factor: " 77 66 " },
      { service, limiter, getContext: contexto() },
    );
    expect(consultar).toHaveBeenCalledWith(4321, "77 66");
  });
});
