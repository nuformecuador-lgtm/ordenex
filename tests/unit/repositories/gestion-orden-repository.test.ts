import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { GestionOrdenRepository } from "@/lib/repositories/GestionOrdenRepository";

// Feature 36 — repositorio con Prisma mockeado (sin DB). Cubre el filtrado por
// mensajero (R9/R13), la guardia origen+propiedad de recogerLote (R15) y la
// transaccion INSERT+UPDATE+limpiar puntero de crearGestionYTransicionar
// (R23/R26/R28/R30).

function fakeAsignacionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "o1",
    numGuia: 5,
    numRemision: "R-1",
    destinatario: "Ana",
    telefonoDest: "099",
    direccion: "calle 1",
    producto: "caja",
    montoCobrar: new Prisma.Decimal(100),
    // Feature 97: coords geocodificadas (feature 91) como Decimal, igual que en la DB.
    latitud: new Prisma.Decimal("9.9281244"),
    longitud: new Prisma.Decimal("-84.0907246"),
    notas: null,
    mensajeroAsignadoId: "m1",
    estatus: { value: "por_recoger" },
    tienda: { nombre: "Tienda X" },
    zona: { nombre: "Centro" },
    provincia: { nombre: "Pichincha" },
    canton: { nombre: "Quito" },
    distrito: { nombre: "Centro Historico" },
    ...overrides,
  };
}

describe("GestionOrdenRepository.findMisAsignaciones (R9/R13)", () => {
  it("R13: filtra por mensajero_asignado_id + no borradas + estados, en el WHERE", async () => {
    const findMany = vi.fn(async () => [fakeAsignacionRow()]);
    const repo = new GestionOrdenRepository({ orden: { findMany } } as never);

    const rows = await repo.findMisAsignaciones("m1", ["por_recoger", "en_ruta"]);

    expect(findMany).toHaveBeenCalledTimes(1);
    const arg = (findMany.mock.calls[0] as unknown[])[0] as { where: Record<string, unknown> };
    expect(arg.where.mensajeroAsignadoId).toBe("m1");
    expect(arg.where.deletedAt).toBeNull();
    expect(arg.where.estatus).toEqual({ value: { in: ["por_recoger", "en_ruta"] } });
    // Proyeccion: nombres legibles + montoCobrar como number.
    expect(rows[0].tiendaNombre).toBe("Tienda X");
    expect(rows[0].montoCobrar).toBe(100);
    expect(rows[0].estatusValue).toBe("por_recoger");
  });

  it("R9: estados vacios -> no consulta y devuelve []", async () => {
    const findMany = vi.fn();
    const repo = new GestionOrdenRepository({ orden: { findMany } } as never);
    expect(await repo.findMisAsignaciones("m1", [])).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  // Feature 97: las coords de la parada (feature 91) viajan en el DTO. La query las PIDE
  // (select) y las SERIALIZA Decimal -> number (mismo patron que montoCobrar).
  it("F97: proyecta latitud/longitud en el select y las serializa Decimal -> number", async () => {
    const findMany = vi.fn(async () => [fakeAsignacionRow()]);
    const repo = new GestionOrdenRepository({ orden: { findMany } } as never);

    const rows = await repo.findMisAsignaciones("m1", ["en_ruta"]);

    const arg = (findMany.mock.calls[0] as unknown[])[0] as { select: Record<string, unknown> };
    expect(arg.select.latitud).toBe(true);
    expect(arg.select.longitud).toBe(true);
    expect(rows[0].latitud).toBe(9.9281244);
    expect(rows[0].longitud).toBe(-84.0907246);
    // Y son numbers puros, no Decimal (serializacion aplicada).
    expect(typeof rows[0].latitud).toBe("number");
    expect(typeof rows[0].longitud).toBe("number");
  });

  // Feature 97: orden aun sin geocodificar -> coords null; null -> null (no revienta el .toNumber()).
  it("F97: orden sin geocodificar (latitud/longitud null) -> null", async () => {
    const findMany = vi.fn(async () => [
      fakeAsignacionRow({ latitud: null, longitud: null }),
    ]);
    const repo = new GestionOrdenRepository({ orden: { findMany } } as never);

    const rows = await repo.findMisAsignaciones("m1", ["en_ruta"]);

    expect(rows[0].latitud).toBeNull();
    expect(rows[0].longitud).toBeNull();
  });
});

describe("GestionOrdenRepository.contarEntregadas (feature 61)", () => {
  it("cuenta por mensajero + estado entregada + no borradas, en el WHERE", async () => {
    const count = vi.fn(async () => 5);
    const repo = new GestionOrdenRepository({ orden: { count } } as never);

    const total = await repo.contarEntregadas("m1");

    expect(total).toBe(5);
    expect(count).toHaveBeenCalledTimes(1);
    const arg = (count.mock.calls[0] as unknown[])[0] as { where: Record<string, unknown> };
    expect(arg.where.mensajeroAsignadoId).toBe("m1");
    expect(arg.where.deletedAt).toBeNull();
    expect(arg.where.estatus).toEqual({ value: "entregada" });
  });
});

describe("GestionOrdenRepository.findByIdsParaGestion (feature 47/R5 · zonaId)", () => {
  it("proyecta y devuelve zonaId (insumo del ruteo a bodega en un reintento)", async () => {
    const findMany = vi.fn(async () => [
      {
        id: "o1",
        deletedAt: null,
        mensajeroAsignadoId: "m1",
        montoCobrar: new Prisma.Decimal(100),
        zonaId: "z-satelite",
        estatus: { value: "en_ruta" },
      },
    ]);
    const repo = new GestionOrdenRepository({ orden: { findMany } } as never);

    const rows = await repo.findByIdsParaGestion(["o1"]);

    // La proyeccion pide zonaId al select...
    const arg = (findMany.mock.calls[0] as unknown[])[0] as { select: Record<string, unknown> };
    expect(arg.select.zonaId).toBe(true);
    // ...y lo mapea a la fila.
    expect(rows[0].zonaId).toBe("z-satelite");
    expect(rows[0].estatusValue).toBe("en_ruta");
    expect(rows[0].montoCobrar).toBe(100);
  });

  it("zonaId null (orden sin zona) se preserva", async () => {
    const findMany = vi.fn(async () => [
      {
        id: "o1",
        deletedAt: null,
        mensajeroAsignadoId: "m1",
        montoCobrar: null,
        zonaId: null,
        estatus: { value: "en_ruta" },
      },
    ]);
    const repo = new GestionOrdenRepository({ orden: { findMany } } as never);
    const rows = await repo.findByIdsParaGestion(["o1"]);
    expect(rows[0].zonaId).toBeNull();
  });

  it("ids vacios -> no consulta y devuelve []", async () => {
    const findMany = vi.fn();
    const repo = new GestionOrdenRepository({ orden: { findMany } } as never);
    expect(await repo.findByIdsParaGestion([])).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});


/**
 * Feature 92 (R16/R19): `GestionOrdenRepository` inyecta ahora un `IJobRepository` para el
 * encolado TRANSACTIONAL OUTBOX de la reoptimizacion de ruta. Este doble registra las
 * llamadas para que los tests de la 36/47/49 sigan midiendo lo suyo Y ADEMAS puedan
 * afirmar que el encolado va DENTRO de la transaccion del writer (4.º argumento).
 * El comportamiento del debounce y del namespace disjunto se prueba aparte, en
 * `tests/integration/repositories/optimizacion-ruta-enqueue.test.ts`.
 */
function colaFake() {
  const enqueue = vi.fn(async () => null);
  return {
    enqueue,
    claimBatch: vi.fn(async () => []),
    complete: vi.fn(async () => {}),
    fail: vi.fn(async () => {}),
    findByDedupeKeys: vi.fn(async () => []),
  };
}

describe("GestionOrdenRepository.recogerLote (R15 · feature 49/#8)", () => {
  // Feature 49/#8: recogerLote pasa a `$queryRaw ... RETURNING "id"` en un `$transaction`;
  // el count = rows.length y el append cubre EXACTAMENTE los ids retornados (R8).
  function buildRecogerRepo(queryResult: { id: string }[]) {
    const $queryRaw = vi.fn(async () => queryResult);
    const createMany = vi.fn();
    const tx = { $queryRaw, ordenHistorialEstado: { createMany } };
    const $transaction = vi.fn(async (cb: (t: typeof tx) => Promise<number>) => cb(tx));
    const cola = colaFake();
    const repo = new GestionOrdenRepository({ $transaction } as never, cola as never);
    return { repo, $queryRaw, createMany, $transaction, cola, tx };
  }

  it("guardia propiedad + origen en el SQL; devuelve filas afectadas (rows.length)", async () => {
    const { repo, $queryRaw } = buildRecogerRepo([{ id: "o1" }, { id: "o2" }]);

    const n = await repo.recogerLote(["o1", "o2"], "m1", "os-espera", "os-reparto");

    expect(n).toBe(2);
    const call = $queryRaw.mock.calls[0] as unknown[];
    const strings = (call[0] as string[]).join(" ");
    const values = call.slice(1);
    // Guardia por propiedad + origen + no borrada en el propio UPDATE.
    expect(strings).toMatch(/mensajero_asignado_id/);
    expect(strings).toMatch(/estatus_id/);
    expect(strings).toMatch(/deleted_at" IS NULL/);
    expect(strings).toMatch(/RETURNING "id"/);
    expect(values).toContain("m1"); // propiedad
    expect(values).toContain("os-espera"); // origen
    expect(values).toContain("os-reparto"); // destino en_ruta
  });

  // Feature 49/#8 (R16/R8): 1 historial por orden recogida (actor = el mensajero); una
  // que perdio la guarda no aparece en el RETURNING -> no deja rastro.
  it("R16/R8: registra historial (recoleccion) solo de los ids retornados", async () => {
    const { repo, createMany } = buildRecogerRepo([{ id: "o1" }]); // solo 1 de 2 gano la guarda

    await repo.recogerLote(["o1", "o2"], "m1", "os-espera", "os-reparto");

    const arg = (createMany.mock.calls[0] as unknown[])[0] as { data: unknown[] };
    expect(arg.data).toEqual([
      {
        ordenId: "o1",
        estatusOrigenId: "os-espera",
        estatusDestinoId: "os-reparto",
        actorUsuarioId: "m1", // el mensajero que recoge
        origenTipo: "recoleccion",
        motivo: null,
        gestionOrdenId: null,
      },
    ]);
  });

  it("lista vacia -> no abre transaccion y devuelve 0", async () => {
    const { repo, $transaction } = buildRecogerRepo([]);
    expect(await repo.recogerLote([], "m1", "a", "b")).toBe(0);
    expect($transaction).not.toHaveBeenCalled();
  });
});

describe("GestionOrdenRepository.setOrdenEnGestion (R19-R21)", () => {
  it("fija el puntero cuando estaba libre (count>0 -> true)", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const findUnique = vi.fn();
    const repo = new GestionOrdenRepository({
      usuario: { updateMany, findUnique },
    } as never);

    expect(await repo.setOrdenEnGestion("m1", "o1")).toBe(true);
    const arg = (updateMany.mock.calls[0] as unknown[])[0] as { where: { OR: unknown } };
    expect(arg.where.OR).toEqual([{ ordenEnGestionId: null }, { ordenEnGestionId: "o1" }]);
  });

  it("R21: con OTRA orden activa (count 0 y puntero distinto) -> false", async () => {
    const updateMany = vi.fn(async () => ({ count: 0 }));
    const findUnique = vi.fn(async () => ({ ordenEnGestionId: "o-otra" }));
    const repo = new GestionOrdenRepository({
      usuario: { updateMany, findUnique },
    } as never);

    expect(await repo.setOrdenEnGestion("m1", "o1")).toBe(false);
  });

  it("idempotente: count 0 pero ya apuntaba a la misma orden -> true", async () => {
    const updateMany = vi.fn(async () => ({ count: 0 }));
    const findUnique = vi.fn(async () => ({ ordenEnGestionId: "o1" }));
    const repo = new GestionOrdenRepository({
      usuario: { updateMany, findUnique },
    } as never);

    expect(await repo.setOrdenEnGestion("m1", "o1")).toBe(true);
  });
});

describe("GestionOrdenRepository.liberarOrdenEnGestion (R35)", () => {
  it("limpia SOLO si el puntero del mismo mensajero apunta a esa orden (count>0 -> true)", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const repo = new GestionOrdenRepository({ usuario: { updateMany } } as never);

    expect(await repo.liberarOrdenEnGestion("m1", "o1")).toBe(true);
    const arg = (updateMany.mock.calls[0] as unknown[])[0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    // WHERE guardado: solo el propio actor + puntero apuntando a ESA orden.
    expect(arg.where.id).toBe("m1");
    expect(arg.where.ordenEnGestionId).toBe("o1");
    expect(arg.data.ordenEnGestionId).toBeNull();
  });

  it("no limpia si el puntero apunta a otra orden / es de otro actor (count 0 -> false)", async () => {
    const updateMany = vi.fn(async () => ({ count: 0 }));
    const repo = new GestionOrdenRepository({ usuario: { updateMany } } as never);

    expect(await repo.liberarOrdenEnGestion("m1", "o1")).toBe(false);
    // El WHERE nunca permite tocar el puntero de otro actor u otra orden.
    const arg = (updateMany.mock.calls[0] as unknown[])[0] as { where: Record<string, unknown> };
    expect(arg.where.id).toBe("m1");
    expect(arg.where.ordenEnGestionId).toBe("o1");
  });
});

describe("GestionOrdenRepository.crearGestionYTransicionar (R23/R26/R28/R30 · feature 49/#9)", () => {
  function buildTxRepo(
    origenEstatusId = "os-reparto",
    historialCreateMany: ReturnType<typeof vi.fn> = vi.fn(),
  ) {
    const gestionCreate = vi.fn(async () => ({ id: "g1" }));
    const ordenUpdate = vi.fn(async () => ({}));
    const ordenFindFirst = vi.fn(async () => ({ estatusId: origenEstatusId }));
    const usuarioUpdate = vi.fn(async () => ({}));
    const tx = {
      gestionOrden: { create: gestionCreate },
      orden: { update: ordenUpdate, findFirst: ordenFindFirst },
      usuario: { update: usuarioUpdate },
      ordenHistorialEstado: { createMany: historialCreateMany },
    };
    const $transaction = vi.fn(async (cb: (t: typeof tx) => Promise<string>) => cb(tx));
    const cola = colaFake();
    const repo = new GestionOrdenRepository({ $transaction } as never, cola as never);
    return { repo, gestionCreate, ordenUpdate, usuarioUpdate, historialCreateMany, cola, tx };
  }

  it("INSERT gestion + UPDATE estatus + limpiar puntero, todo bajo la misma tx", async () => {
    const { repo, gestionCreate, ordenUpdate, usuarioUpdate } = buildTxRepo();

    const id = await repo.crearGestionYTransicionar({
      ordenId: "o1",
      mensajeroId: "m1",
      gestion: {
        resultado: "entregada",
        montoRecibido: 100,
        metodoPago: "efectivo",
        evidenciaStoragePath: "o1/entregada-1.jpg",
        evidenciaContentType: "image/jpeg",
      },
      nuevoEstatusId: "os-entregada",
    });

    expect(id).toBe("g1");
    const gArg = (gestionCreate.mock.calls[0] as unknown[])[0] as { data: Record<string, unknown> };
    expect(gArg.data.resultado).toBe("entregada");
    expect(gArg.data.evidenciaStoragePath).toBe("o1/entregada-1.jpg");
    expect((gArg.data.montoRecibido as Prisma.Decimal).toString()).toBe("100");
    expect((ordenUpdate.mock.calls[0] as unknown[])[0]).toMatchObject({
      where: { id: "o1" },
      data: { estatusId: "os-entregada" },
    });
    // R19: libera el puntero de bloqueo dentro de la transaccion.
    expect((usuarioUpdate.mock.calls[0] as unknown[])[0]).toMatchObject({
      where: { id: "m1" },
      data: { ordenEnGestionId: null },
    });
  });

  it("R26: reprogramada persiste fecha (DATE) y motivo, sin evidencia", async () => {
    const { repo, gestionCreate } = buildTxRepo();
    await repo.crearGestionYTransicionar({
      ordenId: "o1",
      mensajeroId: "m1",
      gestion: { resultado: "reprogramada", fechaReprogramacion: "2027-01-01", motivo: "x" },
      nuevoEstatusId: "os-reprogramada",
    });
    const gArg = (gestionCreate.mock.calls[0] as unknown[])[0] as { data: Record<string, unknown> };
    expect(gArg.data.fechaReprogramacion).toBeInstanceOf(Date);
    expect(gArg.data.evidenciaStoragePath).toBeNull();
    expect(gArg.data.montoRecibido).toBeNull();
  });

  // Feature 49/#9 (R17/R20/R22): entregada (sin motivo) deja historial con destino,
  // gestion_orden_id, origen pre-leido y actor = el mensajero; motivo null.
  it("R17/R20: entregada deja historial con destino, gestionOrdenId y motivo null", async () => {
    const { repo, historialCreateMany } = buildTxRepo("os-reparto");

    await repo.crearGestionYTransicionar({
      ordenId: "o1",
      mensajeroId: "m1",
      gestion: {
        resultado: "entregada",
        montoRecibido: 100,
        metodoPago: "efectivo",
        evidenciaStoragePath: "o1/entregada-1.jpg",
        evidenciaContentType: "image/jpeg",
      },
      nuevoEstatusId: "os-entregada",
    });

    const arg = (historialCreateMany.mock.calls[0] as unknown[])[0] as { data: unknown[] };
    expect(arg.data).toEqual([
      {
        ordenId: "o1",
        estatusOrigenId: "os-reparto",
        estatusDestinoId: "os-entregada",
        actorUsuarioId: "m1",
        origenTipo: "gestion",
        motivo: null,
        gestionOrdenId: "g1",
      },
    ]);
  });

  // R22: una gestion con motivo (devuelta) registra ese motivo en el historial.
  it("R22: devuelta registra el motivo de la gestion en el historial", async () => {
    const { repo, historialCreateMany } = buildTxRepo("os-reparto");

    await repo.crearGestionYTransicionar({
      ordenId: "o1",
      mensajeroId: "m1",
      gestion: { resultado: "devuelta", motivo: "cliente ausente" },
      nuevoEstatusId: "os-devuelta",
    });

    const arg = (historialCreateMany.mock.calls[0] as unknown[])[0] as {
      data: Record<string, unknown>[];
    };
    expect(arg.data[0].estatusDestinoId).toBe("os-devuelta");
    expect(arg.data[0].motivo).toBe("cliente ausente");
    expect(arg.data[0].origenTipo).toBe("gestion");
    expect(arg.data[0].gestionOrdenId).toBe("g1");
  });

  // --- Feature 99 (R1/R29): la rama `devuelta` DEJA la orden en `devuelta`, sin seguimiento ---
  // INVIERTE la suite de la 47: antes `crearGestionYTransicionar` aplicaba una 2.ª transicion
  // (reintento a bodega o escalado a `rechazada`) cuando el llamador pasaba `seguimiento`. Bajo
  // la 99 ese parametro se retiro y la capacidad se relocalizo al cron SLA
  // (`DevolucionSlaRepository`, verificado en devolucion-sla-repository.test.ts). Aqui se afirma
  // que la devolucion produce UNA sola transicion (a `devuelta`) y UN solo append.

  it("R1/R29: devuelta -> UN solo orden.update (a `devuelta`) y UN solo append, sin re-ruteo", async () => {
    const historialCreateMany = vi.fn();
    const { repo, ordenUpdate } = buildTxRepo("os-reparto", historialCreateMany);

    await repo.crearGestionYTransicionar({
      ordenId: "o1",
      mensajeroId: "m1",
      gestion: { resultado: "devuelta", motivo: "ausente" },
      nuevoEstatusId: "os-devuelta",
    });

    // La orden REPOSA en `devuelta`: un unico update, sin 2.ª transicion a bodega/rechazada.
    expect(ordenUpdate).toHaveBeenCalledTimes(1);
    expect((ordenUpdate.mock.calls[0] as unknown[])[0]).toMatchObject({
      where: { id: "o1" },
      data: { estatusId: "os-devuelta" },
    });
    // El mensajero NO se limpia aqui (era parte del reintento de la 47, ahora en el cron).
    const updData = (ordenUpdate.mock.calls[0] as unknown[])[0] as { data: Record<string, unknown> };
    expect(updData.data).not.toHaveProperty("mensajeroAsignadoId");

    // UN solo append por el choke point: en_ruta -> devuelta (actor m1, origen_tipo gestion).
    expect(historialCreateMany).toHaveBeenCalledTimes(1);
    const arg = (historialCreateMany.mock.calls[0] as unknown[])[0] as { data: Record<string, unknown>[] };
    expect(arg.data[0]).toMatchObject({
      estatusOrigenId: "os-reparto",
      estatusDestinoId: "os-devuelta",
      actorUsuarioId: "m1",
      origenTipo: "gestion",
      motivo: "ausente",
      gestionOrdenId: "g1",
    });
  });

  // Las otras 3 ramas: UNA sola transicion y UN solo append (igual que devuelta ahora).
  it("R19: cualquier rama -> un solo orden.update y un solo append (sin seguimiento)", async () => {
    const historialCreateMany = vi.fn();
    const { repo, ordenUpdate } = buildTxRepo("os-reparto", historialCreateMany);

    await repo.crearGestionYTransicionar({
      ordenId: "o1",
      mensajeroId: "m1",
      gestion: { resultado: "entregada", montoRecibido: 100, metodoPago: "efectivo" },
      nuevoEstatusId: "os-entregada",
    });

    expect(ordenUpdate).toHaveBeenCalledTimes(1);
    expect(historialCreateMany).toHaveBeenCalledTimes(1);
  });

  // --- Feature 73 (R11/R12/R13): la causa llega al INSERT, dentro de la MISMA tx ---

  it("R11: devuelta con causa -> el INSERT lleva `causaDevolucion` en su columna propia", async () => {
    const { repo, gestionCreate } = buildTxRepo();

    await repo.crearGestionYTransicionar({
      ordenId: "o1",
      mensajeroId: "m1",
      gestion: { resultado: "devuelta", causaDevolucion: "wrong_number", motivo: "telefono errado" },
      nuevoEstatusId: "os-devuelta",
    });

    const gArg = (gestionCreate.mock.calls[0] as unknown[])[0] as { data: Record<string, unknown> };
    expect(gArg.data.causaDevolucion).toBe("wrong_number");
    // R12: el texto libre se persiste tal cual, sin decorarlo con la causa.
    expect(gArg.data.motivo).toBe("telefono errado");
  });

  it("R13: la causa entra en el MISMO create que la gestion (una sola tx, sin firma nueva)", async () => {
    const { repo, gestionCreate, ordenUpdate } = buildTxRepo();

    await repo.crearGestionYTransicionar({
      ordenId: "o1",
      mensajeroId: "m1",
      gestion: { resultado: "devuelta", causaDevolucion: "not_found", motivo: "ausente" },
      nuevoEstatusId: "os-devuelta",
    });

    // Un unico INSERT de gestion (con la causa dentro) + el UPDATE del estado: si la tx aborta,
    // no queda ni gestion ni causa (atomicidad todo-o-nada ya provista por $transaction).
    expect(gestionCreate).toHaveBeenCalledTimes(1);
    expect(ordenUpdate).toHaveBeenCalledTimes(1);
  });

  it("R13: si el append de la transicion falla, el INSERT con causa no se confirma (atomicidad)", async () => {
    const historialCreateMany = vi.fn(async () => {
      throw new Error("append falla");
    });
    const { repo } = buildTxRepo("os-reparto", historialCreateMany);

    // El fallo se propaga -> $transaction revierte: la causa NO queda persistida.
    await expect(
      repo.crearGestionYTransicionar({
        ordenId: "o1",
        mensajeroId: "m1",
        gestion: { resultado: "devuelta", causaDevolucion: "wrong_address", motivo: "x" },
        nuevoEstatusId: "os-devuelta",
      }),
    ).rejects.toThrow("append falla");
  });

  it("R10/R16: una rama sin causa -> la columna se escribe NULL (nunca undefined)", async () => {
    const { repo, gestionCreate } = buildTxRepo();

    await repo.crearGestionYTransicionar({
      ordenId: "o1",
      mensajeroId: "m1",
      gestion: { resultado: "rechazada", motivo: "cliente rechazo" },
      nuevoEstatusId: "os-rechazada",
    });

    const gArg = (gestionCreate.mock.calls[0] as unknown[])[0] as { data: Record<string, unknown> };
    expect(gArg.data.causaDevolucion).toBeNull();
  });
});
