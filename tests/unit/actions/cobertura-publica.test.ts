import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, it, expect, vi } from "vitest";

import { consultarCoberturaPublica } from "@/lib/actions/cobertura-publica";
import { CoberturaDistritoRepository } from "@/lib/repositories/CoberturaDistritoRepository";
import { CoberturaService } from "@/lib/services/CoberturaService";

import { quitarComentarios } from "../../fixtures/sin-comentarios";

const CRUDO = readFileSync(
  path.resolve(process.cwd(), "lib/actions/cobertura-publica.ts"),
  "utf8",
);
const CODIGO = quitarComentarios(CRUDO);

// Feature 248 — T4.3. Cubre R5 (validacion por campo sin tocar tarifas), R8 (un tiendaId en la
// entrada se ignora) y R40 (sin limite de intentos).
//
// El camino REAL (accion -> service -> repositorio) se ejerce contra un doble de Prisma que
// ademas lleva una trampa: `tarifa`. Si algo de esta superficie tocara la tabla de tarifas, el
// espia lo registraria. Es lo que convierte "no consulta tarifas" en una asercion y no en una
// promesa.

const PROVINCIAS = [{ id: "prov-sj", nombre: "San José" }];
const CANTONES = [{ id: "can-central", nombre: "Central", provinciaId: "prov-sj" }];
const DISTRITOS = [
  {
    id: "dist-carmen",
    nombre: "Carmen",
    cantonId: "can-central",
    zonas: [{ zonaId: "zona-gam", zona: { nombre: "GAM", esCentral: true } }],
  },
];

/** Doble de Prisma con LA TRAMPA: cualquier lectura de `tarifa` queda registrada. */
function prismaFalso() {
  const tarifaFindFirst = vi.fn(async () => null);
  const tarifaFindMany = vi.fn(async () => []);
  const prisma = {
    provincia: { findMany: vi.fn(async () => PROVINCIAS) },
    canton: { findMany: vi.fn(async () => CANTONES) },
    distrito: { findMany: vi.fn(async () => DISTRITOS) },
    tarifa: { findFirst: tarifaFindFirst, findMany: tarifaFindMany },
  };
  return { prisma, tarifaFindFirst, tarifaFindMany };
}

function servicioReal(prisma: ReturnType<typeof prismaFalso>["prisma"]) {
  return new CoberturaService(
    new CoberturaDistritoRepository(
      prisma as unknown as ConstructorParameters<typeof CoberturaDistritoRepository>[0],
    ),
  );
}

describe("R5 — entrada no resoluble devuelve validation_error por campo sin consultar tarifas", () => {
  it("el campo vacio lo caza zod, con un mensaje por campo y sin llegar a la base", async () => {
    const { prisma, tarifaFindFirst, tarifaFindMany } = prismaFalso();

    const resultado = await consultarCoberturaPublica(
      { provincia: "  ", canton: "Central", distrito: "Carmen" },
      { service: servicioReal(prisma) },
    );

    expect(resultado.estado).toBe("validation_error");
    expect(resultado).toMatchObject({ campos: { provincia: expect.any(String) } });
    expect(prisma.provincia.findMany).not.toHaveBeenCalled();
    expect(tarifaFindFirst).not.toHaveBeenCalled();
    expect(tarifaFindMany).not.toHaveBeenCalled();
  });

  it("el trio que no existe devuelve el error del campo que falla, y `tarifa` no se toca", async () => {
    const { prisma, tarifaFindFirst, tarifaFindMany } = prismaFalso();

    const resultado = await consultarCoberturaPublica(
      { provincia: "San José", canton: "Central", distrito: "Zapote" },
      { service: servicioReal(prisma) },
    );

    expect(resultado).toEqual({
      estado: "validation_error",
      campos: { distrito: "distrito no encontrado en el canton" },
    });
    // El catalogo geografico SI se consulta (es lo que hay que resolver); la tabla de tarifas NO.
    expect(prisma.distrito.findMany).toHaveBeenCalledTimes(1);
    expect(tarifaFindFirst).not.toHaveBeenCalled();
    expect(tarifaFindMany).not.toHaveBeenCalled();
  });

  it("el `select` del catalogo no nombra tarifas por ninguna via", async () => {
    const { prisma } = prismaFalso();

    await consultarCoberturaPublica(
      { provincia: "San José", canton: "Central", distrito: "Carmen" },
      { service: servicioReal(prisma) },
    );

    const argumentos = JSON.stringify([
      prisma.provincia.findMany.mock.calls,
      prisma.canton.findMany.mock.calls,
      prisma.distrito.findMany.mock.calls,
    ]);
    expect(argumentos).not.toMatch(/tarifa/i);
  });
});

describe("R8 — un tiendaId en la entrada se ignora y no amplia la respuesta", () => {
  it("la respuesta es identica con y sin claves de tienda en la entrada", async () => {
    const { prisma, tarifaFindFirst } = prismaFalso();
    const destino = { provincia: "San José", canton: "Central", distrito: "Carmen" };

    const limpia = await consultarCoberturaPublica(destino, { service: servicioReal(prisma) });
    const contaminada = await consultarCoberturaPublica(
      {
        ...destino,
        tiendaId: "11111111-1111-1111-1111-111111111111",
        tienda_id: "otra",
        email: "tienda@ejemplo.test",
        apiKey: "ordx_deadbeef",
      },
      { service: servicioReal(prisma) },
    );

    expect(limpia).toEqual({ estado: "cubierto", zonaNombre: "GAM" });
    // Ni un campo mas, ni un valor distinto: el schema declara TRES claves y zod descarta el resto.
    expect(contaminada).toEqual(limpia);
    expect(Object.keys(contaminada).sort()).toEqual(["estado", "zonaNombre"]);
    expect(JSON.stringify(contaminada)).not.toContain("11111111");
    expect(JSON.stringify(contaminada)).not.toContain("ordx_");
    expect(tarifaFindFirst).not.toHaveBeenCalled();
  });

  it("el schema de la superficie publica no declara ninguna clave de tienda", () => {
    // R8 se cumple POR CONSTRUCCION: lo que no esta declarado no puede llegar al service.
    const fuente = readFileSync(path.resolve(process.cwd(), "lib/types/cotizador.ts"), "utf8");
    const schema = fuente.slice(
      fuente.indexOf("export const consultaCoberturaSchema"),
      fuente.indexOf("export type ConsultaCobertura"),
    );

    expect(schema).toContain("provincia:");
    expect(schema).toContain("canton:");
    expect(schema).toContain("distrito:");
    expect(schema).not.toMatch(/tienda/i);
    expect(schema).not.toMatch(/apiKey|api_key/i);
  });
});

describe("R40 — no aplica limite de intentos", () => {
  it("N consultas seguidas desde la misma IP responden igual", async () => {
    const { prisma } = prismaFalso();
    const destino = { provincia: "San José", canton: "Central", distrito: "Carmen" };
    const service = servicioReal(prisma);

    // 50 consultas consecutivas: mas del triple del umbral que aplica la feature 229 al rastreo.
    // Ninguna se degrada, ninguna cambia de forma y no existe el estado `demasiados_intentos`.
    const respuestas = [];
    for (let i = 0; i < 50; i += 1) {
      respuestas.push(await consultarCoberturaPublica(destino, { service }));
    }

    expect(respuestas).toHaveLength(50);
    for (const respuesta of respuestas) {
      expect(respuesta).toEqual({ estado: "cubierto", zonaNombre: "GAM" });
    }
    expect(new Set(respuestas.map((r) => JSON.stringify(r))).size).toBe(1);
  });

  it("la accion no usa limitador ni lee la IP de la peticion, y lo dice por escrito", () => {
    // El CODIGO se lee sin comentarios (la prosa de este archivo nombra a proposito lo que
    // tiene prohibido); el texto CRUDO se lee aparte, porque lo que R40 exige es justamente
    // que la ausencia este explicada y no se lea como un olvido frente a la feature 229.
    expect(CODIGO).not.toContain("ResetRateLimiter");
    expect(CODIGO).not.toContain("x-forwarded-for");
    expect(CODIGO).not.toContain("next/headers");

    expect(CRUDO).toMatch(/R40/);
    expect(CRUDO.toLowerCase()).toContain("limite de intentos");
  });

  it("la accion tampoco resuelve actor ni lee la cookie de sesion (R1), y es deliberado", () => {
    expect(CODIGO).not.toContain("resolveActorFromSession");
    expect(CODIGO).not.toContain("SESSION_COOKIE_NAME");
    expect(CRUDO).toMatch(/deliberad/i);
  });
});
