import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import { GestionOrdenRepository } from "@/lib/repositories/GestionOrdenRepository";
import { idEstado, sembrarCatalogoEstados } from "@/tests/fixtures/catalogo-estados";
// Feature 239 (2026-08-19): el destino de una gestion sale del MAPA, no del nombre del
// resultado. Estas suites pasan `nuevoEstatusId` a mano, asi que lo derivan de la misma fuente
// que el servicio real: si el mapa cambia, cambian con el en vez de fijar un destino caducado.
import { estatusDestinoDeResultado } from "@/lib/types/gestion-destino";

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

beforeEach(async () => {
  await sembrarCatalogoEstados(); // feature 140: la guardia del choke point es de fallo CERRADO (catalogo real + pares legales)
});

describe("GestionOrdenRepository.findMisAsignaciones (R9/R13)", () => {
  it("R13: filtra por mensajero_asignado_id + no borradas + estados, en el WHERE", async () => {
    const findMany = vi.fn(async () => [fakeAsignacionRow()]);
    const repo = new GestionOrdenRepository({ orden: { findMany } } as never);

    const rows = await repo.findMisAsignaciones("m1", ["por_recoger", "en_reparto"]);

    expect(findMany).toHaveBeenCalledTimes(1);
    const arg = (findMany.mock.calls[0] as unknown[])[0] as { where: Record<string, unknown> };
    expect(arg.where.mensajeroAsignadoId).toBe("m1");
    expect(arg.where.deletedAt).toBeNull();
    expect(arg.where.estatus).toEqual({ value: { in: ["por_recoger", "en_reparto"] } });
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

    const rows = await repo.findMisAsignaciones("m1", ["en_reparto"]);

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

    const rows = await repo.findMisAsignaciones("m1", ["en_reparto"]);

    expect(rows[0].latitud).toBeNull();
    expect(rows[0].longitud).toBeNull();
  });
});

describe("GestionOrdenRepository.contarEntregadas (feature 61)", () => {
  // Ventana de un dia de CR: 15/07 00:00 CR = 06:00Z, cota superior EXCLUSIVA en 16/07 06:00Z.
  const DIA = {
    desde: new Date("2026-07-15T06:00:00.000Z"),
    hasta: new Date("2026-07-16T06:00:00.000Z"),
  };

  it("cuenta por mensajero + estado entregada + no borradas, en el WHERE", async () => {
    const count = vi.fn(async () => 5);
    const repo = new GestionOrdenRepository({ orden: { count } } as never);

    const total = await repo.contarEntregadas("m1", DIA);

    expect(total).toBe(5);
    expect(count).toHaveBeenCalledTimes(1);
    const arg = (count.mock.calls[0] as unknown[])[0] as { where: Record<string, unknown> };
    expect(arg.where.mensajeroAsignadoId).toBe("m1");
    expect(arg.where.deletedAt).toBeNull();
    expect(arg.where.estatus).toEqual({ value: "entregada" });
  });

  // El KPI es de JORNADA, no acumulado: el acote va sobre la GESTION vigente que entrego
  // (la orden no tiene `entregada_at`), con rango HALF-OPEN para cubrir el dia sin invadir
  // el siguiente. Si esto se rompe, el mensajero vuelve a ver su historico completo.
  it("acota al dia por la gestion VIGENTE que entrego, con rango half-open", async () => {
    const count = vi.fn(async () => 2);
    const repo = new GestionOrdenRepository({ orden: { count } } as never);

    await repo.contarEntregadas("m1", DIA);

    const arg = (count.mock.calls[0] as unknown[])[0] as { where: { gestiones: { some: unknown } } };
    expect(arg.where.gestiones.some).toEqual({
      mensajeroId: "m1", // ancla a QUIEN entrego: una reasignacion posterior no regala el KPI
      resultado: "entregada",
      anuladaAt: null, // feature 67/R11: una entrega deshecha deja de contar
      createdAt: { gte: DIA.desde, lt: DIA.hasta }, // `lt`, NO `lte`
    });
  });

});

describe("GestionOrdenRepository.sumMontoCobrarGestionadas (KPI 'Total a cobrar')", () => {
  const DIA = {
    desde: new Date("2026-07-15T06:00:00.000Z"),
    hasta: new Date("2026-07-16T06:00:00.000Z"),
  };

  function repoConAggregate(sum: Prisma.Decimal | null) {
    const aggregate = vi.fn(async () => ({ _sum: { montoCobrar: sum } }));
    return { repo: new GestionOrdenRepository({ orden: { aggregate } } as never), aggregate };
  }

  // NO filtra por `resultado`: el total del dia mide todo lo que paso por las manos del
  // mensajero. Si se filtrara a `entregada`, el total BAJARIA cada vez que una orden no se
  // entrega —justo cuando el mensajero necesita que el numero no se mueva—.
  it("cuenta la gestion del dia con CUALQUIER resultado, no solo entregada", async () => {
    const { repo, aggregate } = repoConAggregate(new Prisma.Decimal(750));

    const total = await repo.sumMontoCobrarGestionadas("m1", DIA);

    expect(total).toBe(750);
    const arg = (aggregate.mock.calls[0] as unknown[])[0] as {
      where: { gestiones: { some: Record<string, unknown> } };
    };
    expect(arg.where.gestiones.some).toEqual({
      mensajeroId: "m1",
      anuladaAt: null, // feature 67/R11: una gestion deshecha deja de contar
      createdAt: { gte: DIA.desde, lt: DIA.hasta }, // `lt`, NO `lte`
    });
    expect(arg.where.gestiones.some.resultado).toBeUndefined();
  });

  // La guardia del doble conteo: `totalACobrar` suma ESTE resultado + el COD de las que
  // siguen en reparto. Si la query no excluyera `en_reparto`, una orden gestionada hoy como
  // reprogramada y liberada de vuelta a reparto el mismo dia (feature 46) caeria en los DOS
  // conjuntos y su monto se sumaria dos veces.
  it("EXCLUYE lo que el mensajero LLEVA EN LA MANO, para no solaparse con la otra mitad", async () => {
    const { repo, aggregate } = repoConAggregate(null);

    const total = await repo.sumMontoCobrarGestionadas("m1", DIA);

    expect(total).toBe(0); // sin gestionadas / montos nulos -> 0, no null
    const arg = (aggregate.mock.calls[0] as unknown[])[0] as { where: Record<string, unknown> };
    // FEATURE 235 (R21, 2026-08-19): de UN value a DOS. El otro sumando (`porCobrar`) se calcula
    // sobre `porGestionar UNION conAyuda`, asi que el conjunto «en la mano» crecio y esta red
    // tenia que crecer con el. Censo CERRADO: uno de mas dejaria fuera dinero que si se gestiono.
    expect(arg.where.estatus).toEqual({ value: { notIn: ["en_reparto", "ayuda_tienda"] } });
    expect(arg.where.mensajeroAsignadoId).toBe("m1");
    expect(arg.where.deletedAt).toBeNull();
  });

  // Feature 235 (R21): el predicado, aplicado a filas, para que el caso de arriba no afirme solo
  // una forma. Los dos estados «en la mano» quedan fuera; los desenlaces, dentro.
  it("235/R21: el predicado deja fuera `en_reparto` Y `ayuda_tienda`, y deja dentro los desenlaces", async () => {
    const { repo, aggregate } = repoConAggregate(null);

    await repo.sumMontoCobrarGestionadas("m1", DIA);
    const arg = (aggregate.mock.calls[0] as unknown[])[0] as {
      where: { estatus: { value: { notIn: string[] } } };
    };
    const cuenta = (estatus: string) => !arg.where.estatus.value.notIn.includes(estatus);

    expect(cuenta("en_reparto")).toBe(false);
    expect(cuenta("ayuda_tienda")).toBe(false);
    for (const dentro of ["entregada", "reprogramada", "rechazada", "devolucion_por_confirmar"]) {
      expect(cuenta(dentro), `${dentro} SI cuenta como gestionada del dia`).toBe(true);
    }
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
        estatus: { value: "en_reparto" },
      },
    ]);
    const repo = new GestionOrdenRepository({ orden: { findMany } } as never);

    const rows = await repo.findByIdsParaGestion(["o1"]);

    // La proyeccion pide zonaId al select...
    const arg = (findMany.mock.calls[0] as unknown[])[0] as { select: Record<string, unknown> };
    expect(arg.select.zonaId).toBe(true);
    // ...y lo mapea a la fila.
    expect(rows[0].zonaId).toBe("z-satelite");
    expect(rows[0].estatusValue).toBe("en_reparto");
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
        estatus: { value: "en_reparto" },
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

    const n = await repo.recogerLote(["o1", "o2"], "m1", idEstado("por_recoger"), idEstado("en_reparto"));

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
    expect(values).toContain(idEstado("por_recoger")); // origen
    expect(values).toContain(idEstado("en_reparto")); // destino en_reparto
  });

  // Feature 49/#8 (R16/R8): 1 historial por orden recogida (actor = el mensajero); una
  // que perdio la guarda no aparece en el RETURNING -> no deja rastro.
  it("R16/R8: registra historial (recoleccion) solo de los ids retornados", async () => {
    const { repo, createMany } = buildRecogerRepo([{ id: "o1" }]); // solo 1 de 2 gano la guarda

    await repo.recogerLote(["o1", "o2"], "m1", idEstado("por_recoger"), idEstado("en_reparto"));

    const arg = (createMany.mock.calls[0] as unknown[])[0] as { data: unknown[] };
    expect(arg.data).toEqual([
      {
        ordenId: "o1",
        estatusOrigenId: idEstado("por_recoger"),
        estatusDestinoId: idEstado("en_reparto"),
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
    origenEstatusId = idEstado("en_reparto"),
    historialCreateMany: ReturnType<typeof vi.fn> = vi.fn(),
  ) {
    const gestionCreate = vi.fn(async () => ({ id: "g1" }));
    const ordenUpdate = vi.fn(async () => ({}));
    const ordenFindFirst = vi.fn(async () => ({ estatusId: origenEstatusId }));
    const usuarioUpdate = vi.fn(async () => ({}));
    // Feature 212 (R17): las lineas del desglose del recaudo se insertan por el cliente
    // TRANSACCIONAL. `dentroDeTx` registra si la llamada ocurrio mientras la tx estaba abierta:
    // un `createMany` fuera de ella dejaria lineas huerfanas si la transicion falla despues.
    let txAbierta = false;
    const dentroDeTx: boolean[] = [];
    const pagoCreateMany = vi.fn(async () => {
      dentroDeTx.push(txAbierta);
      return { count: 0 };
    });
    const tx = {
      gestionOrden: { create: gestionCreate },
      gestionOrdenPago: { createMany: pagoCreateMany },
      orden: { update: ordenUpdate, findFirst: ordenFindFirst },
      usuario: { update: usuarioUpdate },
      ordenHistorialEstado: { createMany: historialCreateMany },
    };
    const $transaction = vi.fn(async (cb: (t: typeof tx) => Promise<string>) => {
      txAbierta = true;
      try {
        return await cb(tx);
      } finally {
        txAbierta = false;
      }
    });
    const cola = colaFake();
    const repo = new GestionOrdenRepository({ $transaction } as never, cola as never);
    return {
      repo,
      gestionCreate,
      ordenUpdate,
      usuarioUpdate,
      historialCreateMany,
      pagoCreateMany,
      dentroDeTx,
      cola,
      tx,
    };
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
      nuevoEstatusId: idEstado("entregada"),
    });

    expect(id).toBe("g1");
    const gArg = (gestionCreate.mock.calls[0] as unknown[])[0] as { data: Record<string, unknown> };
    expect(gArg.data.resultado).toBe("entregada");
    expect(gArg.data.evidenciaStoragePath).toBe("o1/entregada-1.jpg");
    expect((gArg.data.montoRecibido as Prisma.Decimal).toString()).toBe("100");
    expect((ordenUpdate.mock.calls[0] as unknown[])[0]).toMatchObject({
      where: { id: "o1" },
      data: { estatusId: idEstado("entregada") },
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
      nuevoEstatusId: idEstado("reprogramada"),
    });
    const gArg = (gestionCreate.mock.calls[0] as unknown[])[0] as { data: Record<string, unknown> };
    expect(gArg.data.fechaReprogramacion).toBeInstanceOf(Date);
    expect(gArg.data.evidenciaStoragePath).toBeNull();
    expect(gArg.data.montoRecibido).toBeNull();
  });

  // Feature 49/#9 (R17/R20/R22): entregada (sin motivo) deja historial con destino,
  // gestion_orden_id, origen pre-leido y actor = el mensajero; motivo null.
  it("R17/R20: entregada deja historial con destino, gestionOrdenId y motivo null", async () => {
    const { repo, historialCreateMany } = buildTxRepo(idEstado("en_reparto"));

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
      nuevoEstatusId: idEstado("entregada"),
    });

    const arg = (historialCreateMany.mock.calls[0] as unknown[])[0] as { data: unknown[] };
    expect(arg.data).toEqual([
      {
        ordenId: "o1",
        estatusOrigenId: idEstado("en_reparto"),
        estatusDestinoId: idEstado("entregada"),
        actorUsuarioId: "m1",
        origenTipo: "gestion",
        motivo: null,
        gestionOrdenId: "g1",
      },
    ]);
  });

  // R22: una gestion con motivo (devuelta) registra ese motivo en el historial.
  it("R22: devuelta registra el motivo de la gestion en el historial", async () => {
    const { repo, historialCreateMany } = buildTxRepo(idEstado("en_reparto"));

    await repo.crearGestionYTransicionar({
      ordenId: "o1",
      mensajeroId: "m1",
      gestion: { resultado: "devuelta", motivo: "cliente ausente" },
      nuevoEstatusId: idEstado(estatusDestinoDeResultado("devuelta")),
    });

    const arg = (historialCreateMany.mock.calls[0] as unknown[])[0] as {
      data: Record<string, unknown>[];
    };
    expect(arg.data[0].estatusDestinoId).toBe(
      idEstado(estatusDestinoDeResultado("devuelta")),
    );
    expect(arg.data[0].motivo).toBe("cliente ausente");
    expect(arg.data[0].origenTipo).toBe("gestion");
    expect(arg.data[0].gestionOrdenId).toBe("g1");
  });

  // --- Feature 158 (R6/R8/R9, Q-G): el QUINTO resultado ---------------------------------
  // La 154 declaro la arista #44 y la familia `incidente` del historial, y dejo esta ultima
  // «SIN PRODUCTOR hasta la 158». Aqui esta el productor. El append escribe
  // `origen_tipo = incidente`, NO `gestion`: es lo que hace el incidente auditable como
  // familia propia, que es para lo que la 154 la dio de alta.

  it("158/R9: el INSERT de la gestion lleva la causa del incidente en su columna propia", async () => {
    const { repo, gestionCreate } = buildTxRepo(idEstado("en_reparto"));

    await repo.crearGestionYTransicionar({
      ordenId: "o1",
      mensajeroId: "m1",
      // Las N filas hijas de evidencia tienen su propia suite
      // (`gestion-orden-evidencia.test.ts`); aqui se afirma el INSERT de la gestion.
      gestion: {
        resultado: "incidente",
        causaIncidente: "robado",
        motivo: "me asaltaron en la parada",
      },
      nuevoEstatusId: idEstado("incidente"),
    });

    const gArg = (gestionCreate.mock.calls[0] as unknown[])[0] as { data: Record<string, unknown> };
    expect(gArg.data.resultado).toBe("incidente");
    expect(gArg.data.causaIncidente).toBe("robado");
    expect(gArg.data.motivo).toBe("me asaltaron en la parada");
    // R22: el monto de la indemnizacion NO se escribe al reportar (lo captura el admin al
    // aprobar el cierre). Si apareciera aqui, el mensajero fijaria su propia indemnizacion.
    expect(gArg.data).not.toHaveProperty("indemnizacion");
    // No hay recaudo en un incidente.
    expect(gArg.data.montoRecibido).toBeNull();
    expect(gArg.data.metodoPago).toBeNull();
    // Y NO se cuela la causa del OTRO enum (73).
    expect(gArg.data.causaDevolucion).toBeNull();
  });

  it("158/R8/Q-G: el historial de la transicion usa la familia `incidente`, NO `gestion`", async () => {
    const { repo, historialCreateMany } = buildTxRepo(idEstado("en_reparto"));

    await repo.crearGestionYTransicionar({
      ordenId: "o1",
      mensajeroId: "m1",
      gestion: { resultado: "incidente", causaIncidente: "danado", motivo: "caja aplastada" },
      nuevoEstatusId: idEstado("incidente"),
    });

    const arg = (historialCreateMany.mock.calls[0] as unknown[])[0] as { data: unknown[] };
    expect(arg.data).toEqual([
      {
        ordenId: "o1",
        estatusOrigenId: idEstado("en_reparto"), // R8: el origen REAL, pre-leido en la tx
        estatusDestinoId: idEstado("incidente"),
        actorUsuarioId: "m1", // R8: el actor
        origenTipo: "incidente", // Q-G: la familia PROPIA, no `gestion`
        motivo: "caja aplastada",
        gestionOrdenId: "g1", // nace CON enlace a gestion (por eso no toca ORIGEN_TIPOS_CON_GESTION)
      },
    ]);
  });

  it("158/Q-G: los CUATRO resultados previos siguen appendeando con `gestion` (R35)", async () => {
    for (const resultado of ["entregada", "reprogramada", "devuelta", "rechazada"] as const) {
      const { repo, historialCreateMany } = buildTxRepo(idEstado("en_reparto"));
      await repo.crearGestionYTransicionar({
        ordenId: "o1",
        mensajeroId: "m1",
        gestion: { resultado, motivo: "x", fechaReprogramacion: "2099-01-01" },
        nuevoEstatusId: idEstado(estatusDestinoDeResultado(resultado)),
      });
      const arg = (historialCreateMany.mock.calls[0] as unknown[])[0] as {
        data: Record<string, unknown>[];
      };
      expect(arg.data[0].origenTipo, `${resultado} deberia seguir siendo \`gestion\``).toBe(
        "gestion",
      );
    }
  });

  // --- Feature 99 (R1/R29): la rama `devuelta` DEJA la orden en `devuelta`, sin seguimiento ---
  // INVIERTE la suite de la 47: antes `crearGestionYTransicionar` aplicaba una 2.ª transicion
  // (reintento a bodega o escalado a `rechazada`) cuando el llamador pasaba `seguimiento`. Bajo
  // la 99 ese parametro se retiro y la capacidad se relocalizo al cron SLA
  // (`DevolucionSlaRepository`, verificado en devolucion-sla-repository.test.ts). Aqui se afirma
  // que la devolucion produce UNA sola transicion (a `devuelta`) y UN solo append.

  // 2026-08-19 (feature 239): el destino de la rama `devuelta` deja de ser `devuelta` y pasa a
  // ser el PRE-ESTADO. Lo que este caso mide NO cambia —UNA transicion y UN append, sin
  // seguimiento— y por eso el destino se lee del mapa en vez de escribirse a mano.
  it("R1/R29: devuelta -> UN solo orden.update (al destino del mapa) y UN solo append, sin re-ruteo", async () => {
    const historialCreateMany = vi.fn();
    const { repo, ordenUpdate } = buildTxRepo(idEstado("en_reparto"), historialCreateMany);

    await repo.crearGestionYTransicionar({
      ordenId: "o1",
      mensajeroId: "m1",
      gestion: { resultado: "devuelta", motivo: "ausente" },
      nuevoEstatusId: idEstado(estatusDestinoDeResultado("devuelta")),
    });

    // La orden REPOSA en `devuelta`: un unico update, sin 2.ª transicion a bodega/rechazada.
    expect(ordenUpdate).toHaveBeenCalledTimes(1);
    expect((ordenUpdate.mock.calls[0] as unknown[])[0]).toMatchObject({
      where: { id: "o1" },
      data: { estatusId: idEstado(estatusDestinoDeResultado("devuelta")) },
    });
    // El mensajero NO se limpia aqui (era parte del reintento de la 47, ahora en el cron).
    const updData = (ordenUpdate.mock.calls[0] as unknown[])[0] as { data: Record<string, unknown> };
    expect(updData.data).not.toHaveProperty("mensajeroAsignadoId");

    // UN solo append por el choke point: en_reparto -> devuelta (actor m1, origen_tipo gestion).
    expect(historialCreateMany).toHaveBeenCalledTimes(1);
    const arg = (historialCreateMany.mock.calls[0] as unknown[])[0] as { data: Record<string, unknown>[] };
    expect(arg.data[0]).toMatchObject({
      estatusOrigenId: idEstado("en_reparto"),
      estatusDestinoId: idEstado(estatusDestinoDeResultado("devuelta")),
      actorUsuarioId: "m1",
      origenTipo: "gestion",
      motivo: "ausente",
      gestionOrdenId: "g1",
    });
  });

  // Las otras 3 ramas: UNA sola transicion y UN solo append (igual que devuelta ahora).
  it("R19: cualquier rama -> un solo orden.update y un solo append (sin seguimiento)", async () => {
    const historialCreateMany = vi.fn();
    const { repo, ordenUpdate } = buildTxRepo(idEstado("en_reparto"), historialCreateMany);

    await repo.crearGestionYTransicionar({
      ordenId: "o1",
      mensajeroId: "m1",
      gestion: { resultado: "entregada", montoRecibido: 100, metodoPago: "efectivo" },
      nuevoEstatusId: idEstado("entregada"),
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
      nuevoEstatusId: idEstado(estatusDestinoDeResultado("devuelta")),
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
      nuevoEstatusId: idEstado(estatusDestinoDeResultado("devuelta")),
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
    const { repo } = buildTxRepo(idEstado("en_reparto"), historialCreateMany);

    // El fallo se propaga -> $transaction revierte: la causa NO queda persistida.
    await expect(
      repo.crearGestionYTransicionar({
        ordenId: "o1",
        mensajeroId: "m1",
        gestion: { resultado: "devuelta", causaDevolucion: "wrong_address", motivo: "x" },
        nuevoEstatusId: idEstado(estatusDestinoDeResultado("devuelta")),
      }),
    ).rejects.toThrow("append falla");
  });

  it("R10/R16: una rama sin causa -> la columna se escribe NULL (nunca undefined)", async () => {
    const { repo, gestionCreate } = buildTxRepo();

    await repo.crearGestionYTransicionar({
      ordenId: "o1",
      mensajeroId: "m1",
      gestion: { resultado: "rechazada", motivo: "cliente rechazo" },
      nuevoEstatusId: idEstado("rechazada"),
    });

    const gArg = (gestionCreate.mock.calls[0] as unknown[])[0] as { data: Record<string, unknown> };
    expect(gArg.data.causaDevolucion).toBeNull();
  });

  // --- Feature 212 (R17/R20): el DESGLOSE del recaudo, en la MISMA transaccion --------------
  // `monto_recibido` sobrevive como TOTAL snapshot; las lineas `(metodo, monto)` son la fuente
  // del reparto por metodo del cierre —y por tanto de la `E` del `min(P, E)` con el que se le
  // paga al mensajero (feature 44)—. Una linea escrita fuera de la tx, o un monto convertido a
  // float, no da un numero feo en pantalla: le paga de menos o de mas a una persona.

  it("212/R17: las lineas se insertan con el cliente de la MISMA tx, tras crear la gestion", async () => {
    const { repo, pagoCreateMany, dentroDeTx } = buildTxRepo();

    await repo.crearGestionYTransicionar({
      ordenId: "o1",
      mensajeroId: "m1",
      gestion: {
        resultado: "entregada",
        montoRecibido: 8000,
        metodoPago: null, // R19: mixta -> la columna deprecada va NULL
        pagos: [
          { metodo: "efectivo", monto: 5000 },
          { metodo: "transferencia", monto: 3000 },
        ],
      },
      nuevoEstatusId: idEstado("entregada"),
    });

    expect(pagoCreateMany).toHaveBeenCalledTimes(1);
    expect(dentroDeTx).toEqual([true]); // dentro de la transaccion abierta, no fuera
    const arg = (pagoCreateMany.mock.calls[0] as unknown[])[0] as { data: Record<string, unknown>[] };
    expect(arg.data).toHaveLength(2);
    expect(arg.data[0].gestionId).toBe("g1"); // enlazadas a la gestion recien creada
    expect(arg.data[1].gestionId).toBe("g1");
    expect(arg.data[0].metodo).toBe("efectivo");
    expect(arg.data[1].metodo).toBe("transferencia");
  });

  it("212/R20: el monto de cada linea entra como Prisma.Decimal, nunca como float", async () => {
    const { repo, pagoCreateMany } = buildTxRepo();

    await repo.crearGestionYTransicionar({
      ordenId: "o1",
      mensajeroId: "m1",
      gestion: {
        resultado: "entregada",
        montoRecibido: 99.99,
        metodoPago: null,
        pagos: [
          { metodo: "efectivo", monto: 66.66 },
          { metodo: "SINPE", monto: 33.33 },
        ],
      },
      nuevoEstatusId: idEstado("entregada"),
    });

    const arg = (pagoCreateMany.mock.calls[0] as unknown[])[0] as { data: Record<string, unknown>[] };
    for (const fila of arg.data) {
      expect(fila.monto).toBeInstanceOf(Prisma.Decimal);
    }
    expect((arg.data[0].monto as Prisma.Decimal).toString()).toBe("66.66");
    expect((arg.data[1].monto as Prisma.Decimal).toString()).toBe("33.33");
    // Suma exacta en Decimal: 66.66 + 33.33 = 99.99 (con floats seria 99.99000000000001).
    const suma = (arg.data[0].monto as Prisma.Decimal).plus(arg.data[1].monto as Prisma.Decimal);
    expect(suma.toString()).toBe("99.99");
  });

  it("212/R17: si el append de la transicion falla, la tx se revierte con las lineas dentro", async () => {
    const historialCreateMany = vi.fn(async () => {
      throw new Error("append falla");
    });
    const { repo, pagoCreateMany, dentroDeTx } = buildTxRepo(idEstado("en_reparto"), historialCreateMany);

    await expect(
      repo.crearGestionYTransicionar({
        ordenId: "o1",
        mensajeroId: "m1",
        gestion: {
          resultado: "entregada",
          montoRecibido: 5000,
          metodoPago: "efectivo",
          pagos: [{ metodo: "efectivo", monto: 5000 }],
        },
        nuevoEstatusId: idEstado("entregada"),
      }),
    ).rejects.toThrow("append falla");

    // El insert de las lineas ocurrio DENTRO de la misma tx que despues aborta -> no queda
    // ninguna linea huerfana (atomicidad todo-o-nada ya provista por $transaction).
    expect(dentroDeTx).toEqual([true]);
    expect(pagoCreateMany).toHaveBeenCalledTimes(1);
  });

  it("212/R14: lista de pagos VACIA -> no se inserta ninguna linea", async () => {
    const { repo, pagoCreateMany, gestionCreate } = buildTxRepo();

    await repo.crearGestionYTransicionar({
      ordenId: "o1",
      mensajeroId: "m1",
      gestion: { resultado: "entregada", montoRecibido: 0, metodoPago: null, pagos: [] },
      nuevoEstatusId: idEstado("entregada"),
    });

    expect(pagoCreateMany).not.toHaveBeenCalled();
    const gArg = (gestionCreate.mock.calls[0] as unknown[])[0] as { data: Record<string, unknown> };
    // El TOTAL snapshot se escribe igual (0), y la columna deprecada va NULL (R19).
    expect((gArg.data.montoRecibido as Prisma.Decimal).toString()).toBe("0");
    expect(gArg.data.metodoPago).toBeNull();
  });

  it("212/R5: una gestion sin `pagos` (rama sin recaudo) no toca la tabla del desglose", async () => {
    const { repo, pagoCreateMany } = buildTxRepo();

    await repo.crearGestionYTransicionar({
      ordenId: "o1",
      mensajeroId: "m1",
      gestion: { resultado: "rechazada", motivo: "cliente rechazo" },
      nuevoEstatusId: idEstado("rechazada"),
    });

    expect(pagoCreateMany).not.toHaveBeenCalled();
  });
});
