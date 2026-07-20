import { describe, it, expect, vi } from "vitest";
import { ApiKeyRepository } from "@/lib/repositories/ApiKeyRepository";
import type { CreateApiKeyConUsuarioData } from "@/lib/interfaces/repositories/IApiKeyRepository";

// Feature 81/R19 + feature 82/R6 — guardia de irrecuperabilidad del secreto sobre la
// SUPERFICIE REAL de `ApiKeyRepository`.
//
// [82] Por que este archivo existe y que reemplaza:
// Antes, R19 se afirmaba en `api-key-service.test.ts` con
// `expect(Object.keys(repo)).toEqual(["createConUsuario"])`. Esa asercion medía la
// FORMA (la cardinalidad de la interfaz), no la INTENCION de R19, que es que "no exista
// ninguna operacion que permita RECUPERAR el secreto en claro". Dos problemas:
//   1. Prohibía cualquier metodo nuevo, aunque no leyera el secreto. La feature 82 anadio
//      `list`/`count` legitimamente (design §2.1/§2.2) y ninguno lee el secreto, asi que
//      la asercion bloqueaba trabajo valido sin proteger nada mas.
//   2. Corría sobre el MOCK (un objeto literal), no sobre la clase real: los metodos de
//      `ApiKeyRepository` viven en el prototipo, asi que `Object.keys` de una instancia
//      real habria dado `[]`. Nunca llego a mirar el codigo que importa.
// Este guard invierte ambas cosas: se ejecuta contra la clase REAL y afirma sobre lo que
// cada operacion DEVUELVE, no sobre como se llama. NO es un relajamiento: un metodo nuevo
// que filtre el secreto ahora falla aqui, cosa que la asercion vieja no podia detectar
// (solo veia nombres). Y un metodo nuevo tampoco puede entrar en silencio: si no esta en
// INVOCACIONES, el test falla pidiendo que se lo cubra.

/** El secreto y su hash, que un Postgres real SI tiene en la fila `api_key`. */
const SECRETO_EN_CLARO = "ordx_secretoenclaro0123456789abcdef";
const KEY_HASH = "b".repeat(64);

/**
 * Fila completa tal como vive en la base: CON `keyHash`. La proteccion no puede ser "el
 * dato no existe", porque en Postgres si existe: tiene que ser que el repositorio nunca
 * lo pida.
 */
const FILA_COMPLETA: Record<string, unknown> = {
  id: "key-1",
  identificador: "Tienda Uno",
  slug: "tienda-uno",
  keyPrefix: "ordx_abc1234",
  keyHash: KEY_HASH,
  usuarioId: "u-dedicado",
  createdById: "u-maestro",
  createdAt: new Date("2026-07-16T12:00:00Z"),
  usuario: {
    id: "u-dedicado",
    email: "apikey+tienda-uno@apikey.invalid",
    passwordHash: "$2b$10$x",
    // [88] `findByKeyHash` proyecta campos ANIDADOS del usuario (`estado`, `rol.value`).
    // Se agregan aqui para que el fake pueda servirselos, y con ellos el `passwordHash`
    // de al lado queda como cebo: si el metodo pidiera el usuario entero, se lo llevaria.
    estado: "activo",
    rol: { id: "rol-apikey", value: "apiKey" },
  },
};

type Select = Record<string, unknown>;

/**
 * Reproduce la semantica de `select` de Postgres/Prisma: devuelve EXACTAMENTE los campos
 * pedidos, ni uno mas. Es la pieza que da valor al test: si un metodo pidiera `keyHash`,
 * este fake se lo entregaria (como haria la base real) y la asercion lo cazaria. Un mock
 * que devolviera siempre una forma fija ya "limpia" no probaria nada.
 */
function project(row: Record<string, unknown>, select: Select | undefined): unknown {
  if (!select) return row; // sin select, Prisma devuelve la fila entera (con el hash)
  const out: Record<string, unknown> = {};
  for (const [campo, valor] of Object.entries(select)) {
    if (valor === true) out[campo] = row[campo];
    else if (valor && typeof valor === "object") {
      const anidado = (valor as { select?: Select }).select;
      out[campo] = project(row[campo] as Record<string, unknown>, anidado);
    }
  }
  return out;
}

function makePrisma() {
  const selects: unknown[] = [];
  const capturar = (args: unknown) => {
    selects.push((args as { select?: Select } | undefined)?.select);
    return project(FILA_COMPLETA, (args as { select?: Select } | undefined)?.select);
  };

  const apiKey = {
    findMany: vi.fn(async (args: unknown) => [capturar(args)]),
    findUnique: vi.fn(async (args: unknown) => capturar(args)), // [88] findByKeyHash
    create: vi.fn(async (args: unknown) => capturar(args)),
    count: vi.fn(async () => 1),
  };
  const tx = {
    usuario: { create: vi.fn(async () => ({ id: "u-dedicado" })) },
    apiKey,
  };
  const prisma = {
    apiKey,
    rol: { findUnique: vi.fn(async () => ({ id: "rol-apikey" })) },
    tipoIdentificacion: { findUnique: vi.fn(async () => ({ id: "tipo-cedula" })) },
    $transaction: vi.fn(async (cb: (t: unknown) => unknown) => cb(tx)),
  };
  return { prisma: prisma as never, selects };
}

const DATA: CreateApiKeyConUsuarioData = {
  identificador: "Tienda Uno",
  slug: "tienda-uno",
  email: "apikey+tienda-uno@apikey.invalid",
  cedula: "APIKEY-tienda-uno",
  passwordHash: "$2b$10$hashbcrypt000000000000000000000000000000000000000000000000",
  keyPrefix: "ordx_abc1234",
  keyHash: KEY_HASH,
  createdById: "u-maestro",
};

/**
 * Como invocar cada operacion del repositorio. Deliberadamente NO es una lista de nombres
 * permitidos: es el conjunto de invocaciones sobre las que se comprueba la fuga. El test
 * de cobertura de abajo obliga a que todo metodo del prototipo tenga su entrada aqui.
 */
const INVOCACIONES: Record<string, (r: ApiKeyRepository) => Promise<unknown>> = {
  createConUsuario: (r) => r.createConUsuario(DATA),
  list: (r) => r.list({ skip: 0, take: 25 }),
  count: (r) => r.count(),
  // [88] Lectura por hash. Es la operacion que MAS cerca pasa del secreto —recibe el
  // `key_hash` como argumento y lee la fila que lo contiene— asi que es justamente la que
  // tiene que demostrar aqui que no devuelve ni el hash ni el secreto en claro.
  findByKeyHash: (r) => r.findByKeyHash(KEY_HASH),
};

function metodosDelRepositorio(): string[] {
  return Object.getOwnPropertyNames(ApiKeyRepository.prototype).filter(
    (n) => n !== "constructor" && typeof (ApiKeyRepository.prototype as never)[n] === "function",
  );
}

describe("ApiKeyRepository — irrecuperabilidad del secreto (81/R19, 82/R6)", () => {
  it("R19: toda operacion del repositorio esta cubierta por este guard", () => {
    // Robustez a futuro: si alguien agrega un metodo, no puede entrar en silencio. Debe
    // registrarlo aqui, y al hacerlo queda automaticamente sujeto a la asercion de fuga.
    // (La asercion vieja lo bloqueaba de plano; esta lo obliga a demostrar que no filtra.)
    expect(metodosDelRepositorio().sort()).toEqual(Object.keys(INVOCACIONES).sort());
  });

  it.each(Object.keys(INVOCACIONES))(
    "R19: `%s` no devuelve el secreto en claro ni el hash, ni siquiera con la base sirviendoselos",
    async (metodo) => {
      const { prisma } = makePrisma();
      const resultado = await INVOCACIONES[metodo](new ApiKeyRepository(prisma));

      // Se afirma sobre el objeto SERIALIZADO: es la forma en que esto cruza al cliente
      // y donde una fuga seria real (no basta con que la propiedad no sea enumerable).
      const serializado = JSON.stringify(resultado) ?? "";
      expect(serializado).not.toContain(KEY_HASH);
      expect(serializado).not.toContain(SECRETO_EN_CLARO);
      expect(serializado).not.toContain("keyHash");
      expect(serializado).not.toContain("passwordHash");
    },
  );

  it("R19: ninguna query del repositorio le pide `keyHash` a Postgres", async () => {
    // La garantia por construccion (82/R6): el hash no se filtra de la respuesta, es que
    // nunca sale de la base. Se verifica sobre TODOS los `select` emitidos por TODAS las
    // operaciones, no solo las del listado.
    for (const metodo of Object.keys(INVOCACIONES)) {
      const { prisma, selects } = makePrisma();
      await INVOCACIONES[metodo](new ApiKeyRepository(prisma));
      for (const select of selects) {
        expect(JSON.stringify(select) ?? "").not.toContain("keyHash");
      }
    }
  });

  it("el guard es capaz de detectar una fuga real (control negativo)", async () => {
    // Un test de no-fuga que no puede fallar no vale nada. Se comprueba que el fake SI
    // entrega el hash cuando se lo piden: es decir, que si un metodo del repositorio
    // pidiera `keyHash`, las aserciones de arriba lo cazarian de verdad.
    const { prisma } = makePrisma();
    const fugado = await (prisma as unknown as {
      apiKey: { findMany: (a: unknown) => Promise<unknown[]> };
    }).apiKey.findMany({ select: { id: true, keyHash: true } });

    expect(JSON.stringify(fugado)).toContain(KEY_HASH);
  });
});
