import { describe, it, expect, vi } from "vitest";
import {
  crearZona,
  obtenerZona,
  listarZonas,
  actualizarZona,
  borrarZona,
  impactoZonaCentral,
} from "@/lib/actions/zonas";
import { ZonaService } from "@/lib/services/ZonaService";
import type {
  IZonaRepository,
  UpdateZonaData,
} from "@/lib/interfaces/repositories/IZonaRepository";
import type { Actor, IZonaService } from "@/lib/interfaces/services/IZonaService";
import type { ZonaDTO } from "@/lib/types/zona";

// Feature 54 (reconciliacion PR #40): prueba las Server Actions VIGENTES de zonas
// contra el ZonaDTO nuevo { id, nombre, cobroVehiculo, distritosCount, esCentral,
// tarifas? } y el ZonaActionError (conflict SIN payload). Las actions/DTO viejos
// (marcarZonaGam, listarZonasLight, listarProvincias, pagoEntrega/esGam) ya no existen.

const MAESTRO: Actor = { usuarioId: "m1", rol: "maestro" };
const getActor = (a: Actor) => async (): Promise<Actor | null> => a;
const noActor = async (): Promise<Actor | null> => null;

function dto(over: Partial<ZonaDTO> = {}): ZonaDTO {
  return {
    id: "z1",
    nombre: "Zona Sur",
    cobroVehiculo: false,
    distritosCount: 2,
    esCentral: false,
    ...over,
  };
}

function fakeService(over: Partial<IZonaService> = {}): IZonaService {
  return {
    crear: vi.fn().mockResolvedValue({ status: "ok", zona: dto() }),
    obtener: vi.fn().mockResolvedValue({ status: "ok", zona: dto() }),
    listar: vi.fn().mockResolvedValue({ status: "ok", items: [dto()], page: 1, pageSize: 25, total: 1 }),
    // FICHA 366 (R12): la rama "ok" de actualizar lleva ademas el conteo de reconciliadas.
    // FICHA 377 (R8): y el de las retenidas en bodega satelite, que es un numero aparte.
    actualizar: vi.fn().mockResolvedValue({
      status: "ok",
      zona: dto(),
      ordenesReconciliadas: 0,
      ordenesRetenidasEnBodegaSatelite: 0,
    }),
    borrar: vi.fn().mockResolvedValue({ status: "ok" }),
    // FICHA 376 (Q4): la lectura de impacto que la confirmacion consulta antes de enviar.
    impactoZonaCentral: vi.fn().mockResolvedValue({ status: "ok", impacto: [] }),
    ...over,
  };
}

const validCrear = {
  nombre: "Zona Sur",
  cobroVehiculo: false,
  esCentral: false,
  distritoIds: ["d1"],
  tarifas: [],
  // ⭑ FICHA 429 (R11): crear una bodega EXIGE el numero y el titular. Valores FICTICIOS: el
  // repositorio es publico y aqui no se escribe ningun SINPE real.
  sinpeNumero: "80000000",
  sinpeNombre: "Titular de Prueba",
};

/**
 * ⭑ FICHA 429 — EL PAYLOAD DE ACTUALIZAR, QUE YA NO ES EL DE CREAR.
 *
 * Los dos esquemas se separaron en la 376 por `esCentral`; la 429 añade la segunda diferencia: el
 * SINPE va SOLO al crear. Un guardado de distritos no puede tocar el numero de cobro de una bodega,
 * y como los dos esquemas son `.strict()`, mandarlo aqui es un rechazo explicito —no un descarte
 * mudo—. Por eso este payload existe en vez de reusar `validCrear`.
 */
const validActualizar = {
  nombre: "Zona Sur",
  cobroVehiculo: false,
  esCentral: false,
  distritoIds: ["d1"],
  tarifas: [],
};

describe("sin sesion -> unauthenticated sin tocar el service", () => {
  it("todas las acciones rechazan sin sesion", async () => {
    const service = fakeService();
    const deps = { zonaService: service, getActor: noActor };
    expect((await crearZona(validCrear, deps)).status).toBe("unauthenticated");
    expect((await obtenerZona("z1", deps)).status).toBe("unauthenticated");
    expect((await listarZonas({}, deps)).status).toBe("unauthenticated");
    expect((await actualizarZona("z1", validActualizar, deps)).status).toBe("unauthenticated");
    expect((await borrarZona("z1", deps)).status).toBe("unauthenticated");
    expect(service.crear).not.toHaveBeenCalled();
    expect(service.listar).not.toHaveBeenCalled();
    expect(service.borrar).not.toHaveBeenCalled();
  });
});

describe("validation_error del schema sin llamar al service", () => {
  it("crear con nombre vacio -> validation_error", async () => {
    const service = fakeService();
    const r = await crearZona(
      { ...validCrear, nombre: "" },
      { zonaService: service, getActor: getActor(MAESTRO) },
    );
    expect(r.status).toBe("validation_error");
    expect(service.crear).not.toHaveBeenCalled();
  });

  it("crear con distritoIds vacio -> validation_error", async () => {
    const service = fakeService();
    const r = await crearZona(
      { ...validCrear, distritoIds: [] },
      { zonaService: service, getActor: getActor(MAESTRO) },
    );
    expect(r.status).toBe("validation_error");
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ⭑ FICHA 429 (R11) — UNA BODEGA NUEVA NO PUEDE NACER SIN SINPE.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // Es la SEGUNDA capa de D3. La primera (la siembra) cubre las ocho que ya existian; sin esta, la
  // novena nace con un hueco y el primer cliente de esa bodega lee un mensaje sin numero.

  it.each(["sinpeNumero", "sinpeNombre"] as const)(
    "⭑ crear SIN `%s` -> `validation_error`, y el service NO se llama",
    async (campo) => {
      const service = fakeService();
      const payload: Record<string, unknown> = { ...validCrear };
      delete payload[campo];
      const r = await crearZona(payload, { zonaService: service, getActor: getActor(MAESTRO) });
      expect(r.status).toBe("validation_error");
      // Colgado de SU campo, para que la pantalla lo pinte al lado y no como un toast generico.
      if (r.status === "validation_error") expect(Object.keys(r.fieldErrors)).toContain(campo);
      expect(service.crear).not.toHaveBeenCalled();
    },
  );

  it("⭑ crear con un numero que no es un movil de Costa Rica -> error EN EL CAMPO DEL NUMERO", async () => {
    const service = fakeService();
    const r = await crearZona(
      { ...validCrear, sinpeNumero: "12345678" }, // ocho digitos, pero empieza por 1
      { zonaService: service, getActor: getActor(MAESTRO) },
    );
    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") {
      expect(Object.keys(r.fieldErrors)).toContain("sinpeNumero");
      expect(r.fieldErrors.sinpeNumero?.[0]).toMatch(/6, 7 u 8/);
    }
    expect(service.crear).not.toHaveBeenCalled();
  });

  it("⭑ crear con un titular en blanco -> error EN EL CAMPO DEL TITULAR", async () => {
    const service = fakeService();
    const r = await crearZona(
      { ...validCrear, sinpeNombre: "   " },
      { zonaService: service, getActor: getActor(MAESTRO) },
    );
    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") expect(Object.keys(r.fieldErrors)).toContain("sinpeNombre");
  });

  it("⭑ ACTUALIZAR una zona NO acepta el SINPE: se edita por su propia accion", async () => {
    // Si viajara en el reemplazo completo de `actualizarZona` —que es `maestro`-only— un guardado
    // de distritos pisaria en silencio la correccion que un `adminSatelite` acaba de hacer sobre su
    // bodega. El `.strict()` lo convierte en un rechazo explicito en vez de un descarte mudo.
    const service = fakeService();
    const r = await actualizarZona(
      "z1",
      { ...validActualizar, sinpeNumero: "70000001" },
      { zonaService: service, getActor: getActor(MAESTRO) },
    );
    expect(r.status).toBe("validation_error");
    expect(service.actualizar).not.toHaveBeenCalled();
  });
});

describe("contrato discriminado por status (pass-through del service)", () => {
  it("forbidden se propaga", async () => {
    const service = fakeService({ crear: vi.fn().mockResolvedValue({ status: "forbidden" }) });
    const r = await crearZona(validCrear, { zonaService: service, getActor: getActor(MAESTRO) });
    expect(r.status).toBe("forbidden");
  });

  // ⭑ FICHA 376 (R11): el `conflict` ya no viaja pelado — lleva el MOTIVO, y los dos motivos
  // llegan hasta la accion sin mezclarse.
  it("conflict `en_uso` al borrar se propaga con su motivo", async () => {
    const service = fakeService({
      borrar: vi.fn().mockResolvedValue({ status: "conflict", motivo: "en_uso" }),
    });
    const r = await borrarZona("z1", { zonaService: service, getActor: getActor(MAESTRO) });
    expect(r.status).toBe("conflict");
    if (r.status === "conflict") expect(r.motivo).toBe("en_uso");
    expect(Object.keys(r).sort()).toEqual(["motivo", "status"]);
  });

  it("⭑ R11: conflict `es_central` al borrar llega DISTINGUIBLE del de «en uso»", async () => {
    const service = fakeService({
      borrar: vi.fn().mockResolvedValue({ status: "conflict", motivo: "es_central" }),
    });
    const r = await borrarZona("z1", { zonaService: service, getActor: getActor(MAESTRO) });
    expect(r.status).toBe("conflict");
    if (r.status === "conflict") expect(r.motivo).toBe("es_central");
  });

  it("not_found en actualizar se propaga", async () => {
    const service = fakeService({ actualizar: vi.fn().mockResolvedValue({ status: "not_found" }) });
    const r = await actualizarZona("zX", validActualizar, {
      zonaService: service,
      getActor: getActor(MAESTRO),
    });
    expect(r.status).toBe("not_found");
  });

  it("not_found en obtener se propaga", async () => {
    const service = fakeService({ obtener: vi.fn().mockResolvedValue({ status: "not_found" }) });
    const r = await obtenerZona("zX", { zonaService: service, getActor: getActor(MAESTRO) });
    expect(r.status).toBe("not_found");
  });
});

describe("DTO nuevo (esCentral, sin campos internos)", () => {
  it("crear ok expone solo status/zona con esCentral y sin deletedAt", async () => {
    const service = fakeService({ crear: vi.fn().mockResolvedValue({ status: "ok", zona: dto({ esCentral: true }) }) });
    const r = await crearZona(validCrear, { zonaService: service, getActor: getActor(MAESTRO) });
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(Object.keys(r)).toEqual(["status", "zona"]);
      expect(r.zona.esCentral).toBe(true);
      expect(typeof r.zona.cobroVehiculo).toBe("boolean");
      expect(r.zona).not.toHaveProperty("deletedAt");
      expect(r.zona).not.toHaveProperty("pagoEntrega");
    }
  });

  it("⭑ 366/R12 + 377/R8: actualizar ok reenvia LOS DOS conteos hasta la Server Action", async () => {
    // La accion no los calcula ni los toca: solo tiene que NO perderlos. Si perdiera el primero,
    // la pantalla no podria decir cuantas ordenes se movieron; si perdiera el segundo, el
    // guardado volveria a ser mudo sobre las que dejo atras a proposito (377/R8).
    //
    // 12 y 3 son numeros DISTINTOS: con dos iguales, una accion que devolviera dos veces el mismo
    // campo pasaria en verde.
    const service = fakeService({
      actualizar: vi.fn().mockResolvedValue({
        status: "ok",
        zona: dto(),
        ordenesReconciliadas: 12,
        ordenesRetenidasEnBodegaSatelite: 3,
      }),
    });
    const r = await actualizarZona("z1", validActualizar, {
      zonaService: service,
      getActor: getActor(MAESTRO),
    });
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.ordenesReconciliadas).toBe(12);
      expect(r.ordenesRetenidasEnBodegaSatelite).toBe(3);
      expect(Object.keys(r).sort()).toEqual([
        "ordenesReconciliadas",
        "ordenesRetenidasEnBodegaSatelite",
        "status",
        "zona",
      ]);
    }
  });

  it("listar ok devuelve items con distritosCount y esCentral", async () => {
    const service = fakeService();
    const r = await listarZonas({}, { zonaService: service, getActor: getActor(MAESTRO) });
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.items[0].distritosCount).toBe(2);
      expect(r.items[0].esCentral).toBe(false);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ⭑ FICHA 376 / R7 — LA REGLA VIVE EN EL SERVIDOR, Y SE PRUEBA SIN PASAR POR EL FORMULARIO
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// Aqui NO se usa `fakeService`: se monta el `ZonaService` REAL sobre un repositorio doble, para que
// el camino medido sea el de verdad —borde zod -> Server Action -> servicio— y el unico doble sea
// la base. Es lo que R7 pide: un guardado que llega por la Server Action, sin `CrearZonaForm` de
// por medio, recibe EXACTAMENTE el mismo rechazo.
//
// ⚠️ LO QUE ESTE BLOQUE NO MIDE: que la guarda del repositorio detecte de verdad la condicion. Eso
// vive en una transaccion contra Postgres y esta en
// `tests/integration/db/zona-central-guarda-y-rastro.test.ts`. Aqui se mide el CAMINO.

/** La zona central de este bloque. `update` se comporta como el repositorio real. */
const ZONA_CENTRAL = "z-central";

function repoConGuarda(): IZonaRepository {
  return {
    create: vi.fn().mockResolvedValue(dto()),
    findById: vi.fn().mockResolvedValue(dto()),
    list: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    listLite: vi.fn().mockResolvedValue([]),
    // El desenlace REAL: `false` explicito sobre la zona central se rechaza; ausente (undefined) o
    // `true` siguen adelante.
    update: vi.fn(async (id: string, data: UpdateZonaData) =>
      data.esCentral === false && id === ZONA_CENTRAL
        ? { estado: "sin_zona_central" as const }
        : {
            estado: "ok" as const,
            zona: dto({ id, esCentral: true }),
            ordenesReconciliadas: 0,
            ordenesRetenidasEnBodegaSatelite: 0,
          },
    ),
    hardDelete: vi.fn().mockResolvedValue("ok"),
    countExistingDistritos: vi.fn(async (ids: string[]) => ids.length),
    countExistingVehiculos: vi.fn(async (ids: string[]) => ids.length),
    findCentralZonaId: vi.fn().mockResolvedValue(ZONA_CENTRAL),
    contarOrdenesVivasPorZona: vi.fn(async (ids: string[]) =>
      ids.map((zonaId) => ({ zonaId, ordenesVivas: zonaId === ZONA_CENTRAL ? 850 : 0 })),
    ),
    // FICHA 429: los metodos de la superficie del SINPE por bodega. El doble los declara
    // para seguir cumpliendo `IZonaRepository`; esta suite no los ejercita.
    listarSinpe: vi.fn().mockResolvedValue([]),
    findSinpeByZona: vi.fn().mockResolvedValue(null),
    zonaIdDeUsuario: vi.fn().mockResolvedValue(null),
    guardarSinpe: vi.fn().mockResolvedValue(null),
    confirmarSinpe: vi.fn().mockResolvedValue(null),
  };
}

describe("376/R7 — la Server Action rechaza sola, sin formulario de por medio", () => {
  const sinMarca = { nombre: "GAM", cobroVehiculo: false, distritoIds: ["d1"], tarifas: [] };

  it("⭑ R5/R6/R7: `esCentral: false` sobre la zona central -> validation_error en `esCentral`", async () => {
    const repo = repoConGuarda();
    const r = await actualizarZona(
      ZONA_CENTRAL,
      { ...sinMarca, esCentral: false },
      { zonaService: new ZonaService(repo), getActor: getActor(MAESTRO) },
    );

    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") {
      expect(Object.keys(r.fieldErrors)).toEqual(["esCentral"]);
      // El texto ES el contrato: es lo que la pantalla pinta junto a la casilla (R23).
      expect(r.fieldErrors.esCentral).toEqual([
        "Tiene que haber una zona central. Para quitarle la marca a ésta, márcala en otra zona.",
      ]);
    }
  });

  it("⭑ R1: el MISMO guardado SIN el campo devuelve ok, y el repo lo recibe como `undefined`", async () => {
    // Las dos mitades del defecto que abre la ficha, en una sola aserción: el borde NO materializa
    // un `false` a partir de un campo ausente, y por eso este guardado no choca con la guarda.
    // Con `actualizarZonaSchema = crearZonaSchema` (lo de antes), este caso seria un rechazo.
    const repo = repoConGuarda();
    const r = await actualizarZona(ZONA_CENTRAL, sinMarca, {
      zonaService: new ZonaService(repo),
      getActor: getActor(MAESTRO),
    });

    expect(r.status).toBe("ok");
    const datos = (repo.update as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(datos.esCentral).toBeUndefined();
    // Y el resto del guardado sigue siendo un REEMPLAZO COMPLETO (R4): no se volvio un PATCH.
    expect(datos.nombre).toBe("GAM");
    expect(datos.distritoIds).toEqual(["d1"]);
  });

  it("R3: `esCentral: null` NO cuela por el borde (seria un NULL en una columna NOT NULL)", async () => {
    const service = fakeService();
    const r = await actualizarZona(
      ZONA_CENTRAL,
      { ...sinMarca, esCentral: null },
      { zonaService: service, getActor: getActor(MAESTRO) },
    );
    expect(r.status).toBe("validation_error");
    expect(service.actualizar).not.toHaveBeenCalled();
  });

  it("R8: `esCentral: false` sobre una zona que NO es la central se acepta", async () => {
    // La guarda es «no quedarse sin», no «la marca no se apaga nunca».
    const repo = repoConGuarda();
    const r = await actualizarZona(
      "z-otra",
      { ...sinMarca, esCentral: false },
      { zonaService: new ZonaService(repo), getActor: getActor(MAESTRO) },
    );
    expect(r.status).toBe("ok");
  });
});

describe("376/Q4 — la accion de impacto", () => {
  it("devuelve el conteo por zona para que la confirmacion diga el impacto", async () => {
    const repo = repoConGuarda();
    const r = await impactoZonaCentral([ZONA_CENTRAL, "z-otra"], {
      zonaService: new ZonaService(repo),
      getActor: getActor(MAESTRO),
    });
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.impacto).toEqual([
        { zonaId: ZONA_CENTRAL, ordenesVivas: 850 },
        { zonaId: "z-otra", ordenesVivas: 0 },
      ]);
    }
  });

  it("sin sesion -> unauthenticated sin tocar el service", async () => {
    const service = fakeService();
    const r = await impactoZonaCentral(["z1"], { zonaService: service, getActor: noActor });
    expect(r.status).toBe("unauthenticated");
    expect(service.impactoZonaCentral).not.toHaveBeenCalled();
  });

  it("una entrada que no es una lista de ids -> validation_error sin consultar", async () => {
    const service = fakeService();
    const r = await impactoZonaCentral("z1", {
      zonaService: service,
      getActor: getActor(MAESTRO),
    });
    expect(r.status).toBe("validation_error");
    expect(service.impactoZonaCentral).not.toHaveBeenCalled();
  });
});
