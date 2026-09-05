import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { GeoRepository } from "@/lib/repositories/GeoRepository";

// FICHA 374 (R8/R12/R20/R22/R51/R52) — las TRES escrituras del repositorio, con un doble.
//
// ⚠️ LO QUE ESTE ARCHIVO PUEDE AFIRMAR Y LO QUE NO. Con dobles se mide el ORDEN de las llamadas y
// CUANTAS son —que es justo lo que ningun test contra Postgres ve con claridad—: que el corte por
// «ya estaba asi» ocurre ANTES de cualquier escritura, que el `update` toca UNA tabla y UNA fila,
// y que ninguno de los tres metodos llama a `delete`/`deleteMany`.
//
// Lo que NO se afirma aqui es nada que dependa de un `WHERE` ni de la atomicidad real: eso vive en
// `tests/integration/db/geografia-cascada-reversible.test.ts` y
// `tests/integration/db/geografia-registro-accion.test.ts`, contra Postgres. Un doble no revierte
// nada.

interface Llamada {
  nombre: string;
  arg: unknown;
}

/**
 * Doble del cliente Prisma que APUNTA cada llamada en un log ordenado. `$transaction` ejecuta el
 * callback con el MISMO objeto, que es lo que permite ver la secuencia completa de la tx.
 */
function prismaDoble(previo: Record<string, unknown> | null) {
  const log: Llamada[] = [];
  const apunta =
    (nombre: string, resultado: unknown = undefined) =>
    (arg: unknown) => {
      log.push({ nombre, arg });
      return Promise.resolve(resultado);
    };

  const cliente = {
    provincia: {
      findUnique: vi.fn(apunta("provincia.findUnique", previo)),
      findMany: vi.fn(apunta("provincia.findMany", [])),
      update: vi.fn(apunta("provincia.update", {})),
      create: vi.fn(apunta("provincia.create", { id: "p-nueva" })),
    },
    canton: {
      findUnique: vi.fn(apunta("canton.findUnique", previo)),
      findMany: vi.fn(apunta("canton.findMany", [])),
      update: vi.fn(apunta("canton.update", {})),
      create: vi.fn(apunta("canton.create", { id: "c-nuevo" })),
    },
    distrito: {
      findUnique: vi.fn(apunta("distrito.findUnique", previo)),
      findMany: vi.fn(apunta("distrito.findMany", [])),
      update: vi.fn(apunta("distrito.update", {})),
      create: vi.fn(apunta("distrito.create", { id: "d-nuevo" })),
    },
    usuario: {
      findUnique: vi.fn(
        apunta("usuario.findUnique", {
          nombre: "Maestra",
          primerApellido: "Uno",
          rol: { value: "maestro" },
        }),
      ),
    },
    historialAccion: { createMany: vi.fn(apunta("historialAccion.createMany", { count: 1 })) },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => {
      log.push({ nombre: "$transaction", arg: undefined });
      return fn(cliente);
    }),
  };
  return { cliente, log };
}

function repoCon(previo: Record<string, unknown> | null) {
  const { cliente, log } = prismaDoble(previo);
  return { repo: new GeoRepository(cliente as unknown as PrismaClient), cliente, log };
}

/** Un distrito con su cadena de nombres, tal como lo lee `leerNodoParaActivacion`. */
function distritoPrevio(activo: boolean) {
  return {
    activo,
    nombre: "Cabagra",
    canton: { nombre: "Buenos Aires", provincia: { nombre: "Puntarenas" } },
  };
}

// =================================================================================================
// R22 — el nodo que no existe
// =================================================================================================

describe("374/R22 — `no_existe` corta antes de cualquier escritura", () => {
  it("con la lectura en `null` no hay update, ni actor congelado, ni fila de registro", async () => {
    const { repo, log } = repoCon(null);

    expect(await repo.cambiarActivacion("distrito", "fantasma", false, "u-1")).toBe("no_existe");

    expect(log.map((l) => l.nombre)).toEqual(["$transaction", "distrito.findUnique"]);
  });
});

// =================================================================================================
// R21/R53 — «ya estaba asi»: ni el update ni la fila
// =================================================================================================

describe("374/R21/R53 — `sin_cambio` NO escribe nada, y el corte va ANTES del update", () => {
  it("pedir desactivar lo ya inactivo no toca ni la tabla ni el registro", async () => {
    const { repo, cliente, log } = repoCon(distritoPrevio(false));

    expect(await repo.cambiarActivacion("distrito", "d1", false, "u-1")).toBe("sin_cambio");

    // El ORDEN es la afirmacion: la lectura, y nada mas. «Se pidio» y «se hizo» son cosas
    // distintas — precedente literal de `VehiculoRepository.delete`.
    expect(log.map((l) => l.nombre)).toEqual(["$transaction", "distrito.findUnique"]);
    expect(cliente.distrito.update).not.toHaveBeenCalled();
    expect(cliente.historialAccion.createMany).not.toHaveBeenCalled();
    expect(cliente.usuario.findUnique).not.toHaveBeenCalled();
  });

  it("pedir activar lo ya activo, igual", async () => {
    const { repo, cliente } = repoCon(distritoPrevio(true));
    expect(await repo.cambiarActivacion("distrito", "d1", true, "u-1")).toBe("sin_cambio");
    expect(cliente.distrito.update).not.toHaveBeenCalled();
    expect(cliente.historialAccion.createMany).not.toHaveBeenCalled();
  });
});

// =================================================================================================
// R8/R51/R52 — el cambio real: una tabla, una fila, y su registro DENTRO de la tx
// =================================================================================================

describe("374/R8/R51/R52 — el cambio real, en los cinco pasos y en ese orden", () => {
  it("leer -> update -> congelar actor -> registrar, todo dentro de UNA transaccion", async () => {
    const { repo, log } = repoCon(distritoPrevio(true));

    expect(await repo.cambiarActivacion("distrito", "d1", false, "u-1")).toBe("cambiado");

    expect(log.map((l) => l.nombre)).toEqual([
      "$transaction",
      "distrito.findUnique",
      "distrito.update",
      "usuario.findUnique",
      "historialAccion.createMany",
    ]);
  });

  it("el `update` toca UNA tabla y UNA fila, por su id, y escribe SOLO el flag (R8)", async () => {
    const { repo, cliente } = repoCon(distritoPrevio(true));
    await repo.cambiarActivacion("distrito", "d1", false, "u-1");

    expect(cliente.distrito.update).toHaveBeenCalledTimes(1);
    expect(cliente.distrito.update).toHaveBeenCalledWith({
      where: { id: "d1" },
      data: { activo: false },
    });
    // NINGUNA escritura sobre los otros dos niveles: la cascada NO se materializa.
    expect(cliente.provincia.update).not.toHaveBeenCalled();
    expect(cliente.canton.update).not.toHaveBeenCalled();
  });

  it("desactivar escribe `nodo_geografico_desactivado`; reactivar, `nodo_geografico_activado`", async () => {
    const off = repoCon(distritoPrevio(true));
    await off.repo.cambiarActivacion("distrito", "d1", false, "u-1");
    const filaOff = (off.cliente.historialAccion.createMany.mock.calls[0]![0] as {
      data: Record<string, unknown>[];
    }).data;

    const on = repoCon(distritoPrevio(false));
    await on.repo.cambiarActivacion("distrito", "d1", true, "u-1");
    const filaOn = (on.cliente.historialAccion.createMany.mock.calls[0]![0] as {
      data: Record<string, unknown>[];
    }).data;

    expect(filaOff).toHaveLength(1);
    expect(filaOn).toHaveLength(1);
    expect(filaOff[0].accion).toBe("nodo_geografico_desactivado");
    expect(filaOn[0].accion).toBe("nodo_geografico_activado");
    // Son valores DISTINTOS: saber cual paso no depende de ningun campo adicional (R52).
    expect(filaOff[0].accion).not.toBe(filaOn[0].accion);
  });

  it("la fila lleva la entidad del NIVEL, la cadena de nombres, y los dos `valor_*` en NULL (R54)", async () => {
    const { repo, cliente } = repoCon(distritoPrevio(true));
    await repo.cambiarActivacion("distrito", "d1", false, "u-1");
    const [fila] = (cliente.historialAccion.createMany.mock.calls[0]![0] as {
      data: Record<string, unknown>[];
    }).data;

    expect(fila.entidadTipo).toBe("distrito");
    expect(fila.entidadId).toBe("d1");
    // Literal, y el literal ES el contrato: es lo que se lee en /historico/acciones.
    expect(fila.entidadEtiqueta).toBe("Cabagra · Buenos Aires · Puntarenas");
    expect(fila.valorAnterior).toBeNull();
    expect(fila.valorNuevo).toBeNull();
    expect(fila.monto).toBeNull();
    // El actor va CONGELADO, no resuelto al leer.
    expect(fila.actorUsuarioId).toBe("u-1");
    expect(fila.actorNombre).toBe("Maestra Uno");
    expect(fila.actorRol).toBe("maestro");
  });

  it("la etiqueta de un CANTON es su cadena de dos, y la de una PROVINCIA solo su nombre", async () => {
    const canton = repoCon({
      activo: true,
      nombre: "Buenos Aires",
      provincia: { nombre: "Puntarenas" },
    });
    await canton.repo.cambiarActivacion("canton", "c1", false, "u-1");
    const filaCanton = (canton.cliente.historialAccion.createMany.mock.calls[0]![0] as {
      data: Record<string, unknown>[];
    }).data[0];
    expect(filaCanton.entidadTipo).toBe("canton");
    expect(filaCanton.entidadEtiqueta).toBe("Buenos Aires · Puntarenas");

    const provincia = repoCon({ activo: true, nombre: "Puntarenas" });
    await provincia.repo.cambiarActivacion("provincia", "p1", false, "u-1");
    const filaProv = (provincia.cliente.historialAccion.createMany.mock.calls[0]![0] as {
      data: Record<string, unknown>[];
    }).data[0];
    expect(filaProv.entidadTipo).toBe("provincia");
    expect(filaProv.entidadEtiqueta).toBe("Puntarenas");
  });
});

// =================================================================================================
// R12 — el alta
// =================================================================================================

describe("374/R12 — `crear` escribe en el nivel pedido y devuelve el id", () => {
  it("provincia sin padre", async () => {
    const { repo, cliente } = repoCon(null);
    expect(await repo.crear("provincia", "Nueva", null)).toBe("p-nueva");
    expect(cliente.provincia.create).toHaveBeenCalledWith({
      data: { nombre: "Nueva" },
      select: { id: true },
    });
  });

  it("canton bajo su provincia", async () => {
    const { repo, cliente } = repoCon(null);
    expect(await repo.crear("canton", "Buenos Aires", "p1")).toBe("c-nuevo");
    expect(cliente.canton.create).toHaveBeenCalledWith({
      data: { nombre: "Buenos Aires", provinciaId: "p1" },
      select: { id: true },
    });
  });

  it("distrito bajo su canton", async () => {
    const { repo, cliente } = repoCon(null);
    expect(await repo.crear("distrito", "Cabagra", "c1")).toBe("d-nuevo");
    expect(cliente.distrito.create).toHaveBeenCalledWith({
      data: { nombre: "Cabagra", cantonId: "c1" },
      select: { id: true },
    });
  });

  it("⚠️ el alta NO escribe fila de registro (R53): es aditiva e inocua", async () => {
    const { repo, cliente } = repoCon(null);
    await repo.crear("distrito", "Cabagra", "c1");
    expect(cliente.historialAccion.createMany).not.toHaveBeenCalled();
  });

  it("un canton o un distrito sin padre LANZA en vez de crear una fila huerfana", async () => {
    const { repo, cliente } = repoCon(null);
    await expect(repo.crear("canton", "Sin Padre", null)).rejects.toThrow(/falta el padre/);
    expect(cliente.canton.create).not.toHaveBeenCalled();
  });
});

// =================================================================================================
// R14/R17 — `findHermanos`: el padre y los hermanos, de una vez
// =================================================================================================

describe("374/R14 — `findHermanos` devuelve `null` cuando el padre NO existe", () => {
  it("canton bajo una provincia inexistente", async () => {
    const { repo } = repoCon(null); // `provincia.findUnique` devuelve null
    expect(await repo.findHermanos("canton", "no-existe")).toBeNull();
  });

  it("distrito bajo un canton inexistente", async () => {
    const { repo } = repoCon(null);
    expect(await repo.findHermanos("distrito", "no-existe")).toBeNull();
  });

  it("la provincia no tiene padre: NUNCA devuelve `null`, devuelve la lista", async () => {
    const { repo, cliente } = repoCon(null);
    expect(await repo.findHermanos("provincia", null)).toEqual([]);
    expect(cliente.provincia.findMany).toHaveBeenCalledWith({
      select: { id: true, nombre: true },
    });
  });

  it("un canton sin `padreId` es `null` sin consultar nada", async () => {
    const { repo, cliente } = repoCon(null);
    expect(await repo.findHermanos("canton", null)).toBeNull();
    expect(cliente.provincia.findUnique).not.toHaveBeenCalled();
  });

  it("trae los hermanos por su nombre CRUDO: la normalizacion es del service, no del `WHERE`", async () => {
    const { repo, cliente } = repoCon({ cantones: [{ id: "c1", nombre: "San José" }] });
    expect(await repo.findHermanos("canton", "p1")).toEqual([{ id: "c1", nombre: "San José" }]);
    const arg = cliente.provincia.findUnique.mock.calls[0]![0] as { select: unknown };
    // Sin `where` sobre el nombre: si se filtrara aqui, se compararian LITERALES y «San Jose»
    // entraria junto a «San José» — que para `resolveGeo` son una sola cosa AMBIGUA.
    expect(arg.select).toEqual({ cantones: { select: { id: true, nombre: true } } });
  });
});

// =================================================================================================
// R5 — sin borrado fisico, en la clase
// =================================================================================================

describe("374/R5 — ninguna escritura del repositorio borra en fisico", () => {
  it("ninguno de los tres metodos llama a `delete` ni a `deleteMany` en las tres tablas", async () => {
    const { repo, cliente } = repoCon(distritoPrevio(true));
    await repo.crear("distrito", "Cabagra", "c1");
    await repo.cambiarActivacion("distrito", "d1", false, "u-1");
    await repo.findHermanos("distrito", "c1");

    // El doble NO declara `delete`/`deleteMany`: si el codigo los llamara, esto reventaria. Se
    // afirma ademas explicitamente que no existen en el doble, para que quede dicho que la
    // ausencia es la prueba y no un descuido del fixture.
    for (const tabla of ["provincia", "canton", "distrito"] as const) {
      const delegado = cliente[tabla] as unknown as Record<string, unknown>;
      expect(delegado.delete, `el doble no declara ${tabla}.delete`).toBeUndefined();
      expect(delegado.deleteMany, `el doble no declara ${tabla}.deleteMany`).toBeUndefined();
    }
  });

  it("la clase no expone ningun metodo cuyo nombre hable de borrar", () => {
    const metodos = Object.getOwnPropertyNames(GeoRepository.prototype);
    expect(metodos.filter((m) => /delete|borrar|eliminar|remove/i.test(m))).toEqual([]);
    // Anti-vacuidad: la clase SI tiene metodos.
    expect(metodos.length).toBeGreaterThan(5);
  });
});
