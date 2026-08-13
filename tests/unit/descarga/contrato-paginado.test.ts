import { readFileSync, readdirSync } from "node:fs";
import { quitarComentarios } from "../../fixtures/sin-comentarios";
import path from "node:path";
import { describe, it, expect, vi } from "vitest";

import { OrdenService } from "@/lib/services/OrdenService";
import { UsuarioService } from "@/lib/services/UsuarioService";
import { PlantillaMensajeService } from "@/lib/services/PlantillaMensajeService";
import { ApiKeyService } from "@/lib/services/ApiKeyService";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IUserRepository } from "@/lib/interfaces/repositories/IUserRepository";
import type { IPlantillaMensajeRepository } from "@/lib/interfaces/repositories/IPlantillaMensajeRepository";
import type { IApiKeyRepository } from "@/lib/interfaces/repositories/IApiKeyRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { listarOrdenesSchema } from "@/lib/types/orden";
import { listarUsuariosSchema } from "@/lib/types/usuario";
import { listarPlantillasSchema } from "@/lib/types/plantilla-mensaje";
import { listarApiKeysSchema } from "@/lib/types/api-key";
import { fakeIntentosEnLote } from "@/tests/fixtures/intentos-entrega";
import type { PaginaListado } from "@/lib/types/listado-paginado";

// Feature 170 — FASE 2, T H.2 (R41): CONTRATO COMUN de listado paginado
// `{ items, page, pageSize, total }` (lib/types/listado-paginado.ts).
//
// El contrato no se inventa aqui: se EXTRAE del que ya devuelven ordenes, usuarios,
// plantillas y API keys. Por eso este archivo prueba tres cosas distintas, y las tres hacen
// falta:
//
//  1. CONDUCTA — que los cuatro listados que ya paginan devuelvan el total del CONJUNTO
//     junto a la pagina, y no la longitud del array (R41). Es la propiedad que R42 necesita
//     para que el contador de cabecera pueda dejar de contar filas.
//  2. FORMA DECLARADA — que ningun tipo de resultado del repo declare `pageSize` sin
//     declarar `total`. Es lo que caza a un listado NUEVO (tandas I-L) que devuelva la
//     pagina y se olvide del conteo.
//  3. UNA SOLA DEFINICION — que los alias de los cuatro listados esten expresados SOBRE el
//     contrato comun. Si vuelven a escribirse a mano, el molde que copian los trece
//     listados del Anexo III deja de existir y volvemos a cuatro (y luego diecisiete)
//     copias de la misma forma.

const RAIZ = path.resolve(__dirname, "../../..");
const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };

/**
 * El total del conjunto que devuelve cada repositorio doble. Deliberadamente distinto de
 * `items.length` (que es 0): si un servicio derivara el total del array, este numero no
 * podria salir por el otro lado.
 */
const TOTAL_DEL_CONJUNTO = 57;

/** Doble de repositorio: una pagina VACIA de un conjunto de 57 filas. */
function listVacio() {
  return vi.fn(async () => ({ items: [], total: TOTAL_DEL_CONJUNTO }));
}

interface ListadoYaPaginado {
  nombre: string;
  ejecutar: () => Promise<unknown>;
}

const LISTADOS_YA_PAGINADOS: ListadoYaPaginado[] = [
  {
    nombre: "Ordenes (listado principal)",
    ejecutar: () =>
      new OrdenService(
        { list: listVacio() } as unknown as IOrdenRepository,
        fakeIntentosEnLote(),
      ).listar(listarOrdenesSchema.parse({ page: 2, pageSize: 10 }), MAESTRO),
  },
  {
    nombre: "Usuarios",
    ejecutar: () =>
      new UsuarioService({ list: listVacio() } as unknown as IUserRepository).listar(
        listarUsuariosSchema.parse({ page: 2, pageSize: 10 }),
        MAESTRO,
      ),
  },
  {
    nombre: "Plantillas de mensaje",
    ejecutar: () =>
      new PlantillaMensajeService({
        list: listVacio(),
      } as unknown as IPlantillaMensajeRepository).listar(
        listarPlantillasSchema.parse({ page: 2, pageSize: 10 }),
        MAESTRO,
      ),
  },
  {
    nombre: "API keys",
    ejecutar: () =>
      new ApiKeyService({ list: listVacio() } as unknown as IApiKeyRepository).listar(
        listarApiKeysSchema.parse({ page: 2, pageSize: 10 }),
        MAESTRO,
      ),
  },
];

describe("contrato de listado paginado — conducta (T H.2, R41)", () => {
  it("todo listado paginado devuelve el total junto a la pagina", async () => {
    // Anti-vacuidad: los cuatro listados que la FASE 1 dejo ya paginados y que sirven de
    // molde a los trece del Anexo III (design §11.4).
    expect(LISTADOS_YA_PAGINADOS).toHaveLength(4);

    for (const listado of LISTADOS_YA_PAGINADOS) {
      const resultado = (await listado.ejecutar()) as { status: string } & PaginaListado<unknown>;

      expect(resultado.status, listado.nombre).toBe("ok");
      // La forma, campo a campo: ni uno de mas ni uno de menos. `toEqual` sobre las claves
      // es lo que hace que un `count` o un `totalFilas` no cuele como equivalente.
      expect(Object.keys(resultado).sort(), listado.nombre).toEqual(
        ["items", "page", "pageSize", "status", "total"].sort(),
      );
      // R41: el total es el del CONJUNTO que corresponde a los filtros y al alcance del
      // actor, no el de la pagina. Aqui la pagina va vacia y el conjunto tiene 57.
      expect(resultado.total, `${listado.nombre}: el total es el del conjunto`).toBe(
        TOTAL_DEL_CONJUNTO,
      );
      expect(resultado.items, listado.nombre).toEqual([]);
      expect(resultado.total, `${listado.nombre}: el total NO puede ser items.length`).not.toBe(
        resultado.items.length,
      );
      // El recorte efectivo viaja de vuelta: sin el, el cliente no puede pintar el control
      // ni saber si su `fallbackData` sigue valiendo.
      expect(resultado.page, listado.nombre).toBe(2);
      expect(resultado.pageSize, listado.nombre).toBe(10);
    }
  });
});

// ---------------------------------------------------------------------------
// Lecturas ESTATICAS: lo que los tipos DICEN, que es lo que heredaran las tandas I-L.
// ---------------------------------------------------------------------------

/** Quita comentarios: en este repo la prosa habla de `page`/`pageSize` y falsearia el scan. */
function sinComentarios(fuente: string): string {
  return quitarComentarios(fuente);
}

function listarTs(dir: string, acc: string[] = []): string[] {
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const completo = path.join(dir, entrada.name);
    if (entrada.isDirectory()) listarTs(completo, acc);
    else if (entrada.name.endsWith(".ts")) acc.push(completo);
  }
  return acc;
}

function rutaRelativa(archivo: string): string {
  return path.relative(RAIZ, archivo).split(path.sep).join("/");
}

interface DeclaracionResultado {
  ruta: string;
  nombre: string;
  cuerpo: string;
}

/**
 * Devuelve las declaraciones `export type <algo>Result = …` de un archivo, ya sin
 * comentarios. El cuerpo llega hasta el siguiente `export` de nivel cero, que es donde
 * termina de verdad un union multilinea (partir por `;` corta dentro del objeto literal).
 */
export function declaracionesDeResultado(fuente: string, ruta: string): DeclaracionResultado[] {
  const lineas = sinComentarios(fuente).split(/\r?\n/);
  const salida: DeclaracionResultado[] = [];
  let nombre: string | null = null;
  let buffer: string[] = [];

  const cerrar = () => {
    if (nombre !== null) salida.push({ ruta, nombre, cuerpo: buffer.join("\n") });
    nombre = null;
    buffer = [];
  };

  for (const linea of lineas) {
    const encontrado = /^export type ([A-Za-z0-9_]+)\s*=/.exec(linea);
    if (encontrado) {
      cerrar();
      if (encontrado[1].endsWith("Result")) {
        nombre = encontrado[1];
        buffer = [linea];
      }
    } else if (nombre !== null) {
      if (/^export\b/.test(linea)) cerrar();
      else buffer.push(linea);
    }
  }
  cerrar();
  return salida;
}

function resultadosDelRepo(): DeclaracionResultado[] {
  return [...listarTs(path.join(RAIZ, "lib/types")), ...listarTs(path.join(RAIZ, "lib/interfaces"))]
    .sort()
    .flatMap((archivo) =>
      declaracionesDeResultado(readFileSync(archivo, "utf8"), rutaRelativa(archivo)),
    );
}

describe("contrato de listado paginado — forma declarada (T H.2, R41)", () => {
  it("ningun resultado del repo declara la pagina sin declarar el total", () => {
    // Vale para las TRES formas paginadas que conviven hoy: la del contrato
    // (`items`), la de los ledgers de dinero (`movimientos`, features 41/43) y la anidada
    // (`{ status, data }`, wallet). Ninguna de ellas es del Anexo III, y por eso no se
    // reescriben; lo que si se exige a todas es el invariante de R41: si hay pagina, hay
    // total. Un listado nuevo que devuelva `{ items, page, pageSize }` a secas se para aqui.
    const resultados = resultadosDelRepo();
    const paginados = resultados.filter((d) => /\bpageSize\b/.test(d.cuerpo));

    // Anti-vacuidad: 13 son las formas paginadas que hay HOY en el repo. Si el parser deja
    // de reconocer declaraciones, esta cuenta lo delata en vez de dejar pasar una lista
    // vacia; y como la FASE 2 solo SUMA listados, el numero nunca deberia bajar sin que
    // alguien haya borrado un listado a conciencia.
    expect(paginados.length, "no se reconocio ningun resultado paginado").toBeGreaterThanOrEqual(
      13,
    );

    const sinTotal = paginados
      .filter((d) => !/\btotal\s*:/.test(d.cuerpo) && !/ListarPaginado/.test(d.cuerpo))
      .map((d) => `${d.ruta} :: ${d.nombre}`);
    expect(sinTotal, "un listado paginado debe devolver el total junto a la pagina (R41)").toEqual(
      [],
    );
  });

  it("los listados que ya paginaban se expresan sobre el contrato comun, no a mano", () => {
    // T H.2 dice «reusando lo que ya devuelven ordenes/usuarios/plantillas/API keys». Que
    // esos cuatro esten expresados sobre el tipo comun es lo que convierte al contrato en
    // el MOLDE de las tandas I-L: quien escriba el listado numero cinco copia una linea,
    // no una forma de cinco campos.
    const esperado: Array<{ ruta: string; alias: string; sobre: string }> = [
      { ruta: "lib/types/orden.ts", alias: "ListarOrdenesResult", sobre: "ListarPaginadoResult" },
      { ruta: "lib/types/usuario.ts", alias: "ListarUsuariosResult", sobre: "ListarPaginadoResult" },
      {
        ruta: "lib/types/plantilla-mensaje.ts",
        alias: "ListarPlantillasResult",
        sobre: "ListarPaginadoResult",
      },
      { ruta: "lib/types/api-key.ts", alias: "ListarApiKeysResult", sobre: "ListarPaginadoResult" },
      {
        ruta: "lib/interfaces/services/IOrdenService.ts",
        alias: "ListarOrdenesServiceResult",
        sobre: "ListarPaginadoServiceResult",
      },
      {
        ruta: "lib/interfaces/services/IUsuarioService.ts",
        alias: "ListarUsuariosServiceResult",
        sobre: "ListarPaginadoServiceResult",
      },
      {
        ruta: "lib/interfaces/services/IPlantillaMensajeService.ts",
        alias: "ListarPlantillasServiceResult",
        sobre: "ListarPaginadoServiceResult",
      },
    ];

    const porClave = new Map(resultadosDelRepo().map((d) => [`${d.ruta}::${d.nombre}`, d]));

    for (const entrada of esperado) {
      const clave = `${entrada.ruta}::${entrada.alias}`;
      const declaracion = porClave.get(clave);
      expect(declaracion, `${clave}: no se encontro la declaracion`).toBeDefined();
      expect(declaracion!.cuerpo, `${clave}: debe expresarse sobre ${entrada.sobre}`).toContain(
        entrada.sobre,
      );
    }

    // Las API keys son el caso que justifica el parametro de error del contrato: su union
    // de error es mas estrecho que `ActionError` y NO se ensancha al unificar la forma.
    expect(porClave.get("lib/types/api-key.ts::ListarApiKeysResult")!.cuerpo).toContain(
      "ApiKeyActionErrorResult",
    );
  });
});
