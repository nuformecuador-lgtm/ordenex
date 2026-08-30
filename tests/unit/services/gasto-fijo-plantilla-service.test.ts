import { describe, it, expect, vi } from "vitest";
import { GastoFijoPlantillaService } from "@/lib/services/GastoFijoPlantillaService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  ActualizarPlantillaInput,
  IGastoFijoPlantillaRepository,
} from "@/lib/interfaces/repositories/IGastoFijoPlantillaRepository";
import type {
  EliminarPlantillaTx,
  EliminarPlantillaTxRunner,
} from "@/lib/interfaces/services/IGastoFijoPlantillaService";
import type { IGastoFijoCobroService } from "@/lib/interfaces/services/IGastoFijoCobroService";
import type { GastoFijoPlantillaDTO } from "@/lib/types/gasto-fijo-plantilla";

// Feature 45 (R17/R24/R25/R26) — tests unit del GastoFijoPlantillaService. Guardia de acceso
// total en TODOS los metodos; crear/editar/activar/desactivar/listar; not_found cuando el id no
// existe. Montos STRING.
//
// Ficha 332 (2026-08-29): el servicio TAMBIEN elimina. Esa ficha revoca el «sin borrado» de
// `45/R25` con OK humano; ver `specs/332-eliminar-plantilla-gasto-fijo` y el describe del final,
// que hasta esa fecha afirmaba lo contrario y ahora esta invertido (no borrado: invertido).

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "u-admin", rol: "admin" }; // feature 94: paridad con maestro
const OTRO: Actor = { usuarioId: "u-otro", rol: "adminSatelite" };

function plantilla(overrides: Partial<GastoFijoPlantillaDTO> = {}): GastoFijoPlantillaDTO {
  return {
    id: "p-1",
    concepto: "Alquiler",
    monto: "80000.00",
    activa: true,
    periodicidadUnidad: "meses",
    periodicidadCantidad: 1,
    fechaCobro: "2026-07-13",
    requiereAprobacion: true, // ficha 333/R1
    createdAt: "2026-07-13T10:00:00.000Z",
    updatedAt: "2026-07-13T10:00:00.000Z",
    ...overrides,
  };
}

// Feature 84: la periodicidad llega SIEMPRE resuelta desde el borde (el schema zod aplica los
// defaults), asi que el service la reenvia tal cual al repo.
const PERIODICIDAD = {
  periodicidadUnidad: "meses",
  periodicidadCantidad: 1,
  fechaCobro: "2026-07-13",
} as const;

function buildRepo(overrides: Partial<IGastoFijoPlantillaRepository> = {}): IGastoFijoPlantillaRepository {
  return {
    crear: vi.fn().mockResolvedValue(plantilla()),
    actualizar: vi.fn().mockResolvedValue(plantilla({ concepto: "Alquiler oficina" })),
    setActiva: vi.fn().mockResolvedValue(plantilla({ activa: false })),
    listar: vi.fn().mockResolvedValue([plantilla(), plantilla({ id: "p-2", activa: false })]),
    listarActivas: vi.fn().mockResolvedValue([plantilla()]),
    // Feature 170 (T I.1): el listado paginado vive en su propia suite (*-paginado).
    listarPaginado: vi.fn().mockResolvedValue({ items: [plantilla()], total: 1 }),
    obtenerPorId: vi.fn().mockResolvedValue(plantilla()),
    // Ficha 332: el borrado. `true` = borro una fila; los casos de `not_found` lo sobreescriben.
    eliminar: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

/**
 * FICHA 333 (F1b) — doble del PUERTO ESTRECHO a los cobros. `cancela` es lo que
 * `cancelarPorPlantilla` devuelve: el numero REAL de pendientes cancelados dentro de la
 * transaccion del borrado (R56).
 */
function buildCobros(cancela = 0): IGastoFijoCobroService {
  return {
    listarPendientes: vi.fn(),
    aprobar: vi.fn(),
    rechazar: vi.fn(),
    cancelarPorPlantilla: vi.fn().mockResolvedValue(cancela),
    contarPendientesDePlantilla: vi.fn(),
  };
}

/**
 * FICHA 333 (F1b) — runner en memoria con la misma semantica que `prisma.$transaction`: ejecuta
 * `fn` y propaga lo que devuelva o lance.
 */
const runTx: EliminarPlantillaTxRunner = async (fn) => fn({} as EliminarPlantillaTx);

/**
 * El servicio con sus tres colaboradores. Existe para que los ~23 casos de este archivo —que no
 * tienen nada que ver con el borrado— no repitan el cableado, y para que un cuarto colaborador se
 * anada en UN sitio.
 */
function servicio(
  repo: IGastoFijoPlantillaRepository,
  cobros: IGastoFijoCobroService = buildCobros(),
): GastoFijoPlantillaService {
  return new GastoFijoPlantillaService(repo, cobros, runTx, () => AHORA);
}

/** Reloj inyectado: el `decidido_at` de los cobros cancelados no sale de un `new Date()`. */
const AHORA = new Date("2026-08-29T18:00:00.000Z");

describe("GastoFijoPlantillaService.crearPlantilla (R17/R24)", () => {
  it("R17: rol no autorizado -> forbidden, sin crear", async () => {
    const repo = buildRepo();
    const svc = servicio(repo);
    const r = await svc.crearPlantilla({ concepto: "Alquiler", monto: "80000.00", ...PERIODICIDAD, requiereAprobacion: true }, OTRO);
    expect(r).toEqual({ status: "forbidden" });
    expect(repo.crear).not.toHaveBeenCalled();
  });

  it("feature 94: admin -> crea la plantilla (paridad con maestro)", async () => {
    const repo = buildRepo();
    const svc = servicio(repo);
    const r = await svc.crearPlantilla({ concepto: "Alquiler", monto: "80000.00", ...PERIODICIDAD, requiereAprobacion: true }, ADMIN);
    expect(r.status).toBe("ok");
    expect(repo.crear).toHaveBeenCalled();
  });

  it("R24: maestro -> crea la plantilla; monto STRING", async () => {
    const repo = buildRepo();
    const svc = servicio(repo);
    const r = await svc.crearPlantilla({ concepto: "Alquiler", monto: "80000.00", ...PERIODICIDAD, requiereAprobacion: true }, MAESTRO);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("esperado ok");
    expect(typeof r.plantilla.monto).toBe("string");
    // Ficha 333 (D4): el interruptor viaja al repositorio junto con el resto. El literal se
    // amplia a mano — es el contrato de lo que el servicio le pide guardar.
    expect(repo.crear).toHaveBeenCalledWith({
      concepto: "Alquiler",
      monto: "80000.00",
      ...PERIODICIDAD,
      requiereAprobacion: true,
    });
  });
});

describe("GastoFijoPlantillaService.actualizarPlantilla (R17/R25)", () => {
  it("R17: rol no autorizado -> forbidden", async () => {
    const repo = buildRepo();
    const svc = servicio(repo);
    const r = await svc.actualizarPlantilla({ id: "p-1", concepto: "x", monto: "10.00", ...PERIODICIDAD, requiereAprobacion: true }, OTRO);
    expect(r).toEqual({ status: "forbidden" });
    expect(repo.actualizar).not.toHaveBeenCalled();
  });

  it("not_found: el id no existe -> not_found, sin actualizar", async () => {
    const repo = buildRepo({ obtenerPorId: vi.fn().mockResolvedValue(null) });
    const svc = servicio(repo);
    const r = await svc.actualizarPlantilla({ id: "no", concepto: "x", monto: "10.00", ...PERIODICIDAD, requiereAprobacion: true }, MAESTRO);
    expect(r).toEqual({ status: "not_found" });
    expect(repo.actualizar).not.toHaveBeenCalled();
  });

  it("feature 94: admin -> edita la plantilla (paridad con maestro)", async () => {
    const repo = buildRepo();
    const svc = servicio(repo);
    const r = await svc.actualizarPlantilla(
      {
        id: "p-1",
        concepto: "Alquiler oficina",
        monto: "85000.00",
        ...PERIODICIDAD,
        requiereAprobacion: true,
      },
      ADMIN,
    );
    expect(r.status).toBe("ok");
    expect(repo.actualizar).toHaveBeenCalled();
  });

  it("R25: maestro -> edita concepto/monto", async () => {
    const repo = buildRepo();
    const svc = servicio(repo);
    const r = await svc.actualizarPlantilla(
      {
        id: "p-1",
        concepto: "Alquiler oficina",
        monto: "85000.00",
        ...PERIODICIDAD,
        requiereAprobacion: true,
      },
      MAESTRO,
    );
    expect(r.status).toBe("ok");
    expect(repo.actualizar).toHaveBeenCalledWith("p-1", {
      concepto: "Alquiler oficina",
      monto: "85000.00",
      ...PERIODICIDAD,
      requiereAprobacion: true, // ficha 333 (D4)
    });
  });
});

describe("GastoFijoPlantillaService.setActivaPlantilla (R17/R25)", () => {
  it("R17: rol no autorizado -> forbidden", async () => {
    const repo = buildRepo();
    const svc = servicio(repo);
    const r = await svc.setActivaPlantilla({ id: "p-1", activa: false }, OTRO);
    expect(r).toEqual({ status: "forbidden" });
    expect(repo.setActiva).not.toHaveBeenCalled();
  });

  it("feature 94: admin -> activa/desactiva la plantilla (paridad con maestro)", async () => {
    const repo = buildRepo();
    const svc = servicio(repo);
    const r = await svc.setActivaPlantilla({ id: "p-1", activa: false }, ADMIN);
    expect(r.status).toBe("ok");
    expect(repo.setActiva).toHaveBeenCalledWith("p-1", false);
  });

  it("R25: desactivar (activa=false) -> ok (sin borrado)", async () => {
    const repo = buildRepo();
    const svc = servicio(repo);
    const r = await svc.setActivaPlantilla({ id: "p-1", activa: false }, MAESTRO);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("esperado ok");
    expect(r.plantilla.activa).toBe(false);
    expect(repo.setActiva).toHaveBeenCalledWith("p-1", false);
  });

  it("not_found: id inexistente", async () => {
    const repo = buildRepo({ obtenerPorId: vi.fn().mockResolvedValue(null) });
    const svc = servicio(repo);
    const r = await svc.setActivaPlantilla({ id: "no", activa: true }, MAESTRO);
    expect(r).toEqual({ status: "not_found" });
  });
});

describe("GastoFijoPlantillaService.listarPlantillas (R17/R26)", () => {
  it("R17: rol no autorizado -> forbidden, sin listar", async () => {
    const repo = buildRepo();
    const svc = servicio(repo);
    const r = await svc.listarPlantillas(OTRO);
    expect(r).toEqual({ status: "forbidden" });
    expect(repo.listar).not.toHaveBeenCalled();
  });

  it("feature 94: admin -> lista plantillas (paridad con maestro)", async () => {
    const repo = buildRepo();
    const svc = servicio(repo);
    const r = await svc.listarPlantillas(ADMIN);
    expect(r.status).toBe("ok");
    expect(repo.listar).toHaveBeenCalled();
  });

  it("R26: maestro -> lista activas e inactivas", async () => {
    const repo = buildRepo();
    const svc = servicio(repo);
    const r = await svc.listarPlantillas(MAESTRO);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("esperado ok");
    expect(r.plantillas).toHaveLength(2);
    expect(r.plantillas.some((p) => p.activa)).toBe(true);
    expect(r.plantillas.some((p) => !p.activa)).toBe(true);
  });
});

describe("GastoFijoPlantillaService.eliminarPlantilla (ficha 332, R2/R4/R7)", () => {
  it("R4: rol sin acceso total -> forbidden, sin llamar a repo.eliminar", async () => {
    const repo = buildRepo();
    const svc = servicio(repo);
    const r = await svc.eliminarPlantilla({ id: "p-1" }, OTRO);
    expect(r).toEqual({ status: "forbidden" });
    expect(repo.eliminar).not.toHaveBeenCalled(); // el guard va ANTES del repositorio
  });

  it("R2: maestro -> ok, y llama a eliminar con EL id pedido", async () => {
    const repo = buildRepo();
    const svc = servicio(repo);
    const r = await svc.eliminarPlantilla({ id: "p-1" }, MAESTRO);
    // Ficha 333 (R56): `ok` YA lleva payload — el numero de pendientes REALMENTE cancelados.
    expect(r).toEqual({ status: "ok", pendientesCancelados: 0 });
    expect(repo.eliminar).toHaveBeenCalledTimes(1);
    // Ficha 333 (R45): el borrado va DENTRO de la transaccion, asi que `eliminar` recibe el `tx`.
    expect(repo.eliminar).toHaveBeenCalledWith("p-1", expect.anything());
  });

  it("feature 94: admin -> elimina (paridad con maestro; borrar usa el MISMO guard que editar)", async () => {
    const repo = buildRepo();
    const svc = servicio(repo);
    const r = await svc.eliminarPlantilla({ id: "p-1" }, ADMIN);
    expect(r).toEqual({ status: "ok", pendientesCancelados: 0 });
    expect(repo.eliminar).toHaveBeenCalledWith("p-1", expect.anything());
  });

  it("R7: la fila ya no existia (eliminar -> false) -> not_found, sin lanzar", async () => {
    const repo = buildRepo({ eliminar: vi.fn().mockResolvedValue(false) });
    const svc = servicio(repo);
    await expect(svc.eliminarPlantilla({ id: "no-existe" }, MAESTRO)).resolves.toEqual({
      status: "not_found",
    });
  });

  it("no lee antes de borrar: el `count` del deleteMany ES la respuesta (sin TOCTOU)", async () => {
    // Un `obtenerPorId` previo solo añadiria una consulta y una ventana entre el SELECT y el
    // DELETE. Este caso lo fija: si alguien lo reintroduce, aqui se ve.
    const repo = buildRepo();
    const svc = servicio(repo);
    await svc.eliminarPlantilla({ id: "p-1" }, MAESTRO);
    expect(repo.obtenerPorId).not.toHaveBeenCalled();
  });
});

/**
 * ⚠️ DADO VUELTA por la ficha 332 (2026-08-29). Hasta esa fecha este bloque se llamaba
 * «GastoFijoPlantillaService — sin borrado (R25)» y afirmaba EXACTAMENTE lo contrario: que ni el
 * servicio ni el repositorio exponian `borrar`/`eliminar`/`delete`. Era el testigo de `45/R25`
 * («el sistema NO DEBE borrar plantillas»).
 *
 * La ficha 332 revoca `45/R25` con OK humano de esa fecha —la tabla acumula ruido y el historico
 * del libro no depende de la plantilla— y por eso el bloque NO se borra: se INVIERTE. Es la
 * convencion de este repo (`decision5-revertida`, `d5-revertida`, `reversion-r49`): la decision
 * vieja no se borra, se da vuelta, para que quien lea dentro de seis meses vea que hubo una
 * decision anterior y quien la cambio. Puntero: `specs/332-eliminar-plantilla-gasto-fijo`.
 */
describe("GastoFijoPlantillaService — borrado habilitado: la ficha 332 revoca 45/R25", () => {
  it("R1/R2: el service SI expone eliminarPlantilla, y el repositorio SI expone eliminar", () => {
    const repo = buildRepo();
    const svc = servicio(repo);
    expect(typeof (svc as unknown as Record<string, unknown>).eliminarPlantilla).toBe("function");
    expect(typeof (repo as unknown as Record<string, unknown>).eliminar).toBe("function");
  });

  it("R11: y desactivar NO se fue con la revocacion — pausar sigue siendo su propia intencion", () => {
    const repo = buildRepo();
    const svc = servicio(repo);
    expect(typeof (svc as unknown as Record<string, unknown>).setActivaPlantilla).toBe("function");
    expect(typeof (repo as unknown as Record<string, unknown>).setActiva).toBe("function");
  });
});

// ── Feature 85 (R2) — editar el monto NO mueve el ciclo ──
//
// El doble de repositorio de arriba solo recuerda CON QUE se le llamo. Este otro tiene ESTADO y
// escribe como escribe el repositorio real (`update` con los cinco campos, sin condicion), de
// modo que la fila que se inspecciona al final es la que habria quedado en la tabla.
//
// Los literales `semanas`/`2`/`2026-03-31` estan elegidos a proposito: ninguno coincide con los
// defaults del schema de crear (`meses`/`1`/hoy-CR), asi que este test NO puede estar verde por
// construccion —si algo reinventara el ciclo, la fila guardada no diria esto—.
describe("GastoFijoPlantillaService.actualizarPlantilla — persistencia del ciclo (R2, feature 85)", () => {
  function repoConEstado(semilla: GastoFijoPlantillaDTO) {
    const fila: GastoFijoPlantillaDTO = { ...semilla };
    const repo = buildRepo({
      obtenerPorId: vi.fn(async () => ({ ...fila })),
      actualizar: vi.fn(async (_id: string, input: ActualizarPlantillaInput) => {
        // Espejo de `GastoFijoPlantillaRepository.actualizar`: escribe los cinco campos.
        fila.concepto = input.concepto;
        fila.monto = input.monto;
        fila.periodicidadUnidad = input.periodicidadUnidad;
        fila.periodicidadCantidad = input.periodicidadCantidad;
        fila.fechaCobro = input.fechaCobro;
        return { ...fila };
      }),
    });
    return { repo, filaGuardada: () => ({ ...fila }) };
  }

  it("editar el monto no mueve el ciclo: el repositorio recibe semanas/2/2026-03-31", async () => {
    const { repo, filaGuardada } = repoConEstado(
      plantilla({
        id: "p-ciclo",
        concepto: "Alquiler",
        monto: "80000.00",
        periodicidadUnidad: "semanas",
        periodicidadCantidad: 2,
        fechaCobro: "2026-03-31",
      }),
    );
    const svc = servicio(repo);

    const r = await svc.actualizarPlantilla(
      {
        id: "p-ciclo",
        concepto: "Alquiler",
        monto: "999.00",
        periodicidadUnidad: "semanas",
        periodicidadCantidad: 2,
        fechaCobro: "2026-03-31",
        requiereAprobacion: true, // ficha 333/R1
      },
      MAESTRO,
    );

    expect(r.status).toBe("ok");

    const fila = filaGuardada();
    expect(fila.monto).toBe("999.00"); // lo unico que cambio
    expect(fila.periodicidadUnidad).toBe("semanas");
    expect(fila.periodicidadCantidad).toBe(2);
    expect(fila.fechaCobro).toBe("2026-03-31");

    // Y lo mismo en el contrato con el repositorio, con literales: nada de `...PERIODICIDAD`.
    expect(repo.actualizar).toHaveBeenCalledWith("p-ciclo", {
      concepto: "Alquiler",
      monto: "999.00",
      periodicidadUnidad: "semanas",
      periodicidadCantidad: 2,
      fechaCobro: "2026-03-31",
      requiereAprobacion: true, // ficha 333 (D4)
    });
  });

  it("cambiar el ciclo A PROPOSITO si lo mueve (la ficha no congela el ciclo, cierra el reset mudo)", async () => {
    const { repo, filaGuardada } = repoConEstado(
      plantilla({
        id: "p-ciclo",
        periodicidadUnidad: "semanas",
        periodicidadCantidad: 2,
        fechaCobro: "2026-03-31",
      }),
    );
    const svc = servicio(repo);

    await svc.actualizarPlantilla(
      {
        id: "p-ciclo",
        concepto: "Alquiler",
        monto: "80000.00",
        periodicidadUnidad: "meses",
        periodicidadCantidad: 1,
        fechaCobro: "2026-04-01",
        requiereAprobacion: true, // ficha 333/R1
      },
      MAESTRO,
    );

    const fila = filaGuardada();
    expect(fila.periodicidadUnidad).toBe("meses");
    expect(fila.periodicidadCantidad).toBe(1);
    expect(fila.fechaCobro).toBe("2026-04-01");
  });
});

// ---------------------------------------------------------------------------
// FICHA 333 — EL INTERRUPTOR (R1/R3), LA CASCADA DEL BORRADO (R45/R56) Y R48.
// ---------------------------------------------------------------------------

describe("333/R1 — el interruptor se guarda con sus dos valores", () => {
  it.each([[true], [false]])(
    "crearPlantilla pasa `requiereAprobacion = %s` al repositorio, tal cual",
    async (requiereAprobacion) => {
      const repo = buildRepo();
      const svc = servicio(repo);

      const r = await svc.crearPlantilla(
        { concepto: "Alquiler", monto: "80000.00", ...PERIODICIDAD, requiereAprobacion },
        MAESTRO,
      );

      expect(r.status).toBe("ok");
      expect(repo.crear).toHaveBeenCalledWith(
        expect.objectContaining({ requiereAprobacion }),
      );
    },
  );

  it.each([[true], [false]])(
    "actualizarPlantilla tambien lo pasa (`%s`): editar puede cambiar el interruptor",
    async (requiereAprobacion) => {
      const repo = buildRepo();
      const svc = servicio(repo);

      const r = await svc.actualizarPlantilla(
        {
          id: "p-1",
          concepto: "Alquiler",
          monto: "80000.00",
          ...PERIODICIDAD,
          requiereAprobacion,
        },
        MAESTRO,
      );

      expect(r.status).toBe("ok");
      expect(repo.actualizar).toHaveBeenCalledWith(
        "p-1",
        expect.objectContaining({ requiereAprobacion }),
      );
    },
  );

  it("el DTO que devuelve el servicio lleva el interruptor (lo que la tabla pinta, R4)", async () => {
    const repo = buildRepo({
      crear: vi.fn().mockResolvedValue(plantilla({ requiereAprobacion: false })),
    });

    const r = await servicio(repo).crearPlantilla(
      { concepto: "Internet", monto: "25000.00", ...PERIODICIDAD, requiereAprobacion: false },
      MAESTRO,
    );

    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("esperado ok");
    expect(r.plantilla.requiereAprobacion).toBe(false);
  });
});

describe("333/R3 — un rol sin acceso total no puede cambiar el interruptor", () => {
  it("crear: forbidden sin tocar el repositorio", async () => {
    const repo = buildRepo();

    const r = await servicio(repo).crearPlantilla(
      { concepto: "Alquiler", monto: "80000.00", ...PERIODICIDAD, requiereAprobacion: false },
      OTRO,
    );

    expect(r).toEqual({ status: "forbidden" });
    expect(repo.crear).not.toHaveBeenCalled();
  });

  it("editar: forbidden sin tocar el repositorio", async () => {
    const repo = buildRepo();

    const r = await servicio(repo).actualizarPlantilla(
      {
        id: "p-1",
        concepto: "Alquiler",
        monto: "80000.00",
        ...PERIODICIDAD,
        requiereAprobacion: false,
      },
      OTRO,
    );

    expect(r).toEqual({ status: "forbidden" });
    expect(repo.actualizar).not.toHaveBeenCalled();
  });

  it("R28: el `admin` SI puede — esta ficha NO estrecha el guard del CRUD de plantillas", async () => {
    // El contrapunto explicito de R24: decidir un cobro es solo del maestro, pero configurar el
    // interruptor sigue siendo de acceso total. Si alguien «unificara» los dos guards, esto cae.
    const repo = buildRepo();

    const r = await servicio(repo).actualizarPlantilla(
      {
        id: "p-1",
        concepto: "Alquiler",
        monto: "80000.00",
        ...PERIODICIDAD,
        requiereAprobacion: true,
      },
      ADMIN,
    );

    expect(r.status).toBe("ok");
    expect(repo.actualizar).toHaveBeenCalled();
  });
});

describe("333/R48 — desactivar una plantilla NO cancela sus cobros pendientes", () => {
  it("setActivaPlantilla(false) no llama a la cancelacion ni abre transaccion", async () => {
    // Desactivar es un acto sobre el FUTURO: detiene la generacion y deja lo ya generado
    // esperando decision. Si alguien colgara la cancelacion de aqui, pausar un gasto tiraria
    // aprobaciones que un humano todavia tiene que tomar.
    const repo = buildRepo();
    const cobros = buildCobros(3);

    const r = await servicio(repo, cobros).setActivaPlantilla({ id: "p-1", activa: false }, MAESTRO);

    expect(r.status).toBe("ok");
    expect(repo.setActiva).toHaveBeenCalledWith("p-1", false);
    expect(cobros.cancelarPorPlantilla).not.toHaveBeenCalled();
  });

  it("y volver a activarla tampoco toca ningun cobro", async () => {
    const cobros = buildCobros(3);

    await servicio(buildRepo(), cobros).setActivaPlantilla({ id: "p-1", activa: true }, MAESTRO);

    expect(cobros.cancelarPorPlantilla).not.toHaveBeenCalled();
  });
});

describe("333/R45+R56 — borrar una plantilla cancela sus pendientes en la MISMA transaccion", () => {
  it("R45: cancela ANTES de borrar, con el mismo `tx`, y los dos pasos van dentro del runner", async () => {
    // El ORDEN importa y por eso se mide: al reves, el `DELETE` violaria el CHECK
    // `gasto_fijo_cobro_pendiente_con_plantilla` y abortaria (R46). Y el `tx` tiene que ser EL
    // MISMO objeto en los dos pasos: dos transacciones distintas dejarian media cascada.
    const traza: string[] = [];
    const repo = buildRepo();
    const cobros = buildCobros(2);
    (cobros.cancelarPorPlantilla as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      traza.push("cancelar");
      return 2;
    });
    (repo.eliminar as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      traza.push("eliminar");
      return true;
    });
    const marca = {} as EliminarPlantillaTx;
    const runnerVigilado: EliminarPlantillaTxRunner = async (fn) => {
      traza.push("tx:abre");
      const salida = await fn(marca);
      traza.push("tx:cierra");
      return salida;
    };
    const svc = new GastoFijoPlantillaService(repo, cobros, runnerVigilado, () => AHORA);

    const r = await svc.eliminarPlantilla({ id: "p-1" }, MAESTRO);

    expect(traza).toEqual(["tx:abre", "cancelar", "eliminar", "tx:cierra"]);
    expect(cobros.cancelarPorPlantilla).toHaveBeenCalledWith(marca, "p-1", MAESTRO, AHORA);
    expect(repo.eliminar).toHaveBeenCalledWith("p-1", marca);
    expect(r).toEqual({ status: "ok", pendientesCancelados: 2 });
  });

  it("R56: reporta el numero REALMENTE cancelado, no el que la confirmacion anuncio", async () => {
    // La confirmacion pudo decir «se cancelaran 5»; si entre medias alguien aprobo tres, se
    // cancelan los 2 que quedan y ESE es el numero que sale. El borrado NO se aborta por eso.
    const svc = servicio(buildRepo(), buildCobros(2));

    await expect(svc.eliminarPlantilla({ id: "p-1" }, MAESTRO)).resolves.toEqual({
      status: "ok",
      pendientesCancelados: 2,
    });
  });

  it("si la cancelacion lanza, el fallo se propaga y NO se borra la plantilla", async () => {
    const repo = buildRepo();
    const cobros = buildCobros();
    (cobros.cancelarPorPlantilla as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("cancelacion caida"),
    );

    await expect(
      servicio(repo, cobros).eliminarPlantilla({ id: "p-1" }, MAESTRO),
    ).rejects.toThrow("cancelacion caida");
    expect(repo.eliminar).not.toHaveBeenCalled();
  });

  it("R4: sin acceso total no se cancela nada ni se abre la transaccion", async () => {
    const cobros = buildCobros(2);

    const r = await servicio(buildRepo(), cobros).eliminarPlantilla({ id: "p-1" }, OTRO);

    expect(r).toEqual({ status: "forbidden" });
    expect(cobros.cancelarPorPlantilla).not.toHaveBeenCalled();
  });
});
