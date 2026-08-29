import { describe, it, expect, afterEach, vi } from "vitest";
import { WalletService } from "@/lib/services/WalletService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  CrearMovimientoInput,
  IWalletMovimientoRepository,
  WalletTxClient,
} from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type { AgregadoCajaRow, WalletMovimientoDTO } from "@/lib/types/wallet";
import { NATURALEZA_POR_CATEGORIA } from "@/lib/utils/caja-tesoreria";

// Feature 42 — tests unit del WalletService (R1/R3/R15/R16/R19/R20/R25). Guardia de rol
// maestro; manual inmutable (no update/delete); DTOs con montos STRING.
//
// Feature 173 (T D.2, R8/R64/R65): `verBalance` —una sola cifra rotulada «balance»— pasa a
// `verResumenCaja`, con las DOS cifras. El cambio de estas aserciones es DELIBERADO y esta
// declarado en `design.md §11`; ninguna comprobacion se pierde: las tres del guardia de rol y
// la del conjunto filtrado siguen, y se les suman las de la particion por naturaleza.

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "u-admin", rol: "admin" }; // feature 94: paridad con maestro
const OTRO: Actor = { usuarioId: "u-otro", rol: "adminSatelite" };

function mov(overrides: Partial<WalletMovimientoDTO> = {}): WalletMovimientoDTO {
  const base = {
    id: "w1",
    tipo: "ingreso" as const,
    categoria: "ingreso_flete" as const,
    monto: "1000.00",
    origenTipo: "cierre_dia" as const,
    origenId: "c1",
    descripcion: null,
    registradoPor: null,
    fechaMovimiento: "2026-07-12T10:00:00.000Z",
    ...overrides,
  };
  // Feature 231 (R31): el `dueno` del fixture sale de la MISMA clasificacion que el del
  // repositorio, no de un literal a mano — si no, cambiar la categoria de un caso dejaria el
  // doble diciendo una cosa y el codigo real otra.
  return { ...base, dueno: overrides.dueno ?? NATURALEZA_POR_CATEGORIA[base.categoria] };
}

/**
 * Feature 173 (T D.2) — el agregado que devuelve el doble tiene dinero de las DOS naturalezas
 * a proposito: contra-entrega recaudado (de TERCEROS) junto a flete y gasto (de Ordenex). Con
 * un conjunto solo-propio las dos cifras coincidirian y el test no distinguiria una derivacion
 * correcta de una que ignora la naturaleza.
 *
 *   entradas = 1000 + 5000 = 6000.00 ; salidas = 300.00  ⇒ enCaja   = 5700.00
 *   propios  = 1000        − 300     ⇒ ganancia = 700.00 (los ₡5000 son de las tiendas)
 */
const AGREGADO: AgregadoCajaRow[] = [
  { categoria: "ingreso_flete", tipo: "ingreso", total: "1000.00" },
  { categoria: "ingreso_cod_recaudado", tipo: "ingreso", total: "5000.00" },
  { categoria: "egreso_gasto", tipo: "egreso", total: "300.00" },
];

/**
 * Ficha 334 (T C.1) — el instante que la BASE pone cuando la clave `fechaMovimiento` no viaja.
 *
 * El doble tiene que distinguir «lo puso el DEFAULT de la columna» de «lo puso el servicio»:
 * si las dos ramas produjeran el mismo valor, el caso de R23 pasaria igual con la rama de R22.
 */
const INSTANTE_DEL_DEFAULT = "2026-08-29T21:15:33.000Z";

/**
 * Doble del repositorio que RECUERDA lo que se inserto, para que `obtenerPorId` pueda devolver
 * la fila recien creada. Sin esta memoria no se puede probar R28 —«devuelve el que creaste, no
 * el mas reciente de su categoria»—: haria falta que el doble supiera de que fila se habla.
 */
function buildRepo(): IWalletMovimientoRepository {
  const creados = new Map<string, WalletMovimientoDTO>();
  return {
    crearMovimientos: vi.fn(async (_tx: WalletTxClient, movs: CrearMovimientoInput[]) => {
      for (const m of movs) {
        if (m.id === undefined) continue; // los escritores automaticos no pasan id
        creados.set(
          m.id,
          mov({
            id: m.id,
            tipo: m.tipo,
            categoria: m.categoria,
            monto: m.monto,
            origenTipo: m.origenTipo,
            origenId: m.origenId,
            descripcion: m.descripcion ?? null,
            registradoPor: m.registradoPor ?? null,
            fechaMovimiento: (m.fechaMovimiento ?? new Date(INSTANTE_DEL_DEFAULT)).toISOString(),
          }),
        );
      }
      return movs.length;
    }),
    listar: vi.fn().mockResolvedValue({ movimientos: [mov()], total: 1 }),
    agregarPorCategoriaYTipo: vi.fn().mockResolvedValue(AGREGADO),
    obtenerPorId: vi.fn(async (id: string) => creados.get(id) ?? null),
    agregarPorCategoria: vi
      .fn()
      .mockResolvedValue({ gastoFijo: "0.00", gastoVariable: "0.00", sueldo: "0.00" }),
  };
}

const writeClient = {} as WalletTxClient;

describe("WalletService.listarMovimientos (R19/R20)", () => {
  it("R19: rol no autorizado -> forbidden, sin tocar el repo", async () => {
    const repo = buildRepo();
    const svc = new WalletService(repo, writeClient);
    const r = await svc.listarMovimientos({ page: 1, pageSize: 20 }, OTRO);
    expect(r).toEqual({ status: "forbidden" });
    expect(repo.listar).not.toHaveBeenCalled();
  });

  it("feature 94: admin -> ok (paridad con maestro)", async () => {
    const repo = buildRepo();
    const svc = new WalletService(repo, writeClient);
    const r = await svc.listarMovimientos({ page: 1, pageSize: 20 }, ADMIN);
    expect(r.status).toBe("ok");
    expect(repo.listar).toHaveBeenCalled();
  });

  it("R20: maestro -> ok; pasa filtros al repo; DTO con monto STRING", async () => {
    const repo = buildRepo();
    const svc = new WalletService(repo, writeClient);
    const desde = new Date("2026-07-01T00:00:00.000Z");
    const r = await svc.listarMovimientos(
      { page: 2, pageSize: 10, tipo: "ingreso", categoria: "ingreso_flete", desde },
      MAESTRO,
    );
    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("esperado ok");
    expect(r.data.page).toBe(2);
    expect(r.data.pageSize).toBe(10);
    expect(typeof r.data.movimientos[0].monto).toBe("string");
    expect(repo.listar).toHaveBeenCalledWith({
      page: 2,
      pageSize: 10,
      tipo: "ingreso",
      categoria: "ingreso_flete",
      desde,
      hasta: undefined,
    });
  });
});

describe("WalletService.verResumenCaja (R8/R64/R65)", () => {
  it("R65: rol no autorizado -> forbidden, y CERO llamadas al repositorio", async () => {
    // La contraprueba literal que pide la task: el guardia se evalua ANTES de tocar la base.
    // No es estilo — un `forbidden` decidido despues del `groupBy` ya habria LEIDO las cifras
    // de la caja para tirarlas a la basura. Se miden los CINCO metodos, no solo el que usa
    // este camino: ninguno puede haberse rozado.
    const repo = buildRepo();
    const svc = new WalletService(repo, writeClient);

    const r = await svc.verResumenCaja({ page: 1, pageSize: 20 }, OTRO);

    expect(r).toEqual({ status: "forbidden" });
    expect(repo.agregarPorCategoriaYTipo).not.toHaveBeenCalled();
    expect(repo.listar).not.toHaveBeenCalled();
    expect(repo.agregarPorCategoria).not.toHaveBeenCalled();
    expect(repo.obtenerPorId).not.toHaveBeenCalled();
    expect(repo.crearMovimientos).not.toHaveBeenCalled();
    // …y `forbidden` viaja SOLO: ni una cifra colgando de la respuesta.
    expect(Object.keys(r)).toEqual(["status"]);
  });

  it("feature 94: admin -> ok (paridad con maestro)", async () => {
    const repo = buildRepo();
    const svc = new WalletService(repo, writeClient);
    const r = await svc.verResumenCaja({ page: 1, pageSize: 20 }, ADMIN);
    expect(r.status).toBe("ok");
    expect(repo.agregarPorCategoriaYTipo).toHaveBeenCalled();
  });

  it("R1/R4/R5: maestro -> las DOS cifras, distintas, derivadas del conjunto agregado", async () => {
    const repo = buildRepo();
    const svc = new WalletService(repo, writeClient);

    const r = await svc.verResumenCaja({ page: 1, pageSize: 20 }, MAESTRO);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("esperado ok");
    expect(r.resumen).toEqual({
      entradas: "6000.00",
      salidas: "300.00",
      enCaja: "5700.00",
      signoEnCaja: "positivo",
      ingresosPropios: "1000.00",
      egresosPropios: "300.00",
      ganancia: "700.00",
      signoGanancia: "positivo",
      deTerceros: "5000.00",
      periodoFiltrado: false,
      // Feature 231 (R9/R10/R14): 5 000 / 5 700 x 100 = 87.719… -> "87.72".
      porcentajeTiendas: "87.72",
      modoComposicion: "dos_bolsillos",
    });
    // Lo que la feature existe para conseguir: los ₡5000 de contra-entrega estan en la caja y
    // NO estan en la ganancia. Si `verResumenCaja` ignorara la naturaleza, serian iguales.
    expect(r.resumen.enCaja).not.toBe(r.resumen.ganancia);
  });

  it("R64: TODOS los importes cruzan como STRING — cero `number` en el DTO", async () => {
    const repo = buildRepo();
    const svc = new WalletService(repo, writeClient);
    const r = await svc.verResumenCaja({ page: 1, pageSize: 20 }, MAESTRO);
    if (r.status !== "ok") throw new Error("esperado ok");

    const importes = [
      r.resumen.entradas,
      r.resumen.salidas,
      r.resumen.enCaja,
      r.resumen.ingresosPropios,
      r.resumen.egresosPropios,
      r.resumen.ganancia,
      r.resumen.deTerceros,
    ];
    for (const v of importes) {
      expect(typeof v).toBe("string");
      expect(v).toMatch(/^-?\d+\.\d{2}$/); // escala 2 SIEMPRE, tambien en el cero
    }
    expect(typeof r.resumen.periodoFiltrado).toBe("boolean"); // el unico no-STRING, y no es dinero
  });

  it("R8: los filtros del resumen son LOS MISMOS del listado, resueltos por el mismo metodo", async () => {
    // Se compara llamada contra llamada, sobre la misma entrada: si alguien copiara la
    // construccion de filtros en vez de reusar `construirFiltros`, los dos objetos dejarian de
    // ser iguales y la cabecera podria dejar de cuadrar con su propio listado.
    const repo = buildRepo();
    const svc = new WalletService(repo, writeClient);
    const desde = new Date("2026-07-01T00:00:00.000Z");
    const hasta = new Date("2026-07-31T00:00:00.000Z");
    const input = {
      page: 3,
      pageSize: 10,
      tipo: "ingreso" as const,
      categoria: "ingreso_cod_recaudado" as const,
      desde,
      hasta,
    };

    await svc.listarMovimientos(input, MAESTRO);
    await svc.verResumenCaja(input, MAESTRO);

    const delListado = (repo.listar as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<
      string,
      unknown
    >;
    const delResumen = (repo.agregarPorCategoriaYTipo as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as Record<string, unknown>;

    expect(delResumen).toEqual({ tipo: "ingreso", categoria: "ingreso_cod_recaudado", desde, hasta });
    // Identicos salvo el RECORTE, que es del listado y no del conjunto: las claves del listado
    // son las del resumen MAS `page`/`pageSize`, y cada valor comun coincide uno a uno.
    expect(Object.keys(delListado).sort()).toEqual(
      [...Object.keys(delResumen), "page", "pageSize"].sort(),
    );
    for (const clave of Object.keys(delResumen)) {
      expect(delListado[clave]).toEqual(delResumen[clave]);
    }
  });

  it("[P7]: sin filtros `periodoFiltrado` es false; con CUALQUIERA de los cuatro, true", async () => {
    const svc = () => new WalletService(buildRepo(), writeClient);
    const bandera = async (extra: Record<string, unknown>) => {
      const r = await svc().verResumenCaja({ page: 1, pageSize: 20, ...extra }, MAESTRO);
      if (r.status !== "ok") throw new Error("esperado ok");
      return r.resumen.periodoFiltrado;
    };

    // `page`/`pageSize` NO son filtros: recortan la pagina, no el conjunto. Paginar no puede
    // cambiar el rotulo de la cifra.
    expect(await bandera({})).toBe(false);
    expect(await bandera({ page: 7, pageSize: 100 })).toBe(false);

    expect(await bandera({ tipo: "egreso" })).toBe(true);
    expect(await bandera({ categoria: "egreso_pago_tienda" })).toBe(true);
    expect(await bandera({ desde: new Date("2026-07-01T00:00:00.000Z") })).toBe(true);
    expect(await bandera({ hasta: new Date("2026-07-31T00:00:00.000Z") })).toBe(true);
  });

  it("[P7]: el servidor NO pinta texto — el DTO lleva el HECHO, no el rotulo", async () => {
    // R60/R58 son de la pantalla (T G.1). Aqui lo unico que se comprueba es que el servidor no
    // se mete a redactar: ningun campo del DTO es una frase.
    const svc = new WalletService(buildRepo(), writeClient);
    const r = await svc.verResumenCaja(
      { page: 1, pageSize: 20, tipo: "ingreso" },
      MAESTRO,
    );
    if (r.status !== "ok") throw new Error("esperado ok");

    expect(r.resumen.periodoFiltrado).toBe(true);
    // Ningun VALOR del DTO es prosa: o es un importe, o es un signo, o es el booleano. Se mide
    // sobre los valores y no sobre el JSON entero a proposito —las CLAVES si pueden llamarse
    // `ganancia`, faltaria mas—. Lo que no puede aparecer es una frase que la pantalla deba
    // limitarse a repetir: eso convertiria al servidor en el que redacta, y el rotulo
    // condicional de [P7] dejaria de ser una decision de la UI.
    for (const [clave, valor] of Object.entries(r.resumen)) {
      if (clave === "periodoFiltrado") continue;
      if (clave.startsWith("signo")) {
        expect(["positivo", "negativo", "cero"]).toContain(valor);
        continue;
      }
      // Feature 231: `modoComposicion` es el TERCER enum del DTO y se mide igual que los dos
      // signos — un valor de una lista cerrada, no una frase. La afirmacion de este caso («el
      // servidor no redacta») se conserva entera: sigue sin haber ni un texto que la pantalla
      // deba limitarse a repetir.
      if (clave === "modoComposicion") {
        expect(["dos_bolsillos", "solo_tiendas", "solo_ordenex", "sin_reparto"]).toContain(valor);
        continue;
      }
      expect(valor).toMatch(/^-?\d+\.\d{2}$/);
    }
  });

  it("libro vacio -> las dos cifras en 0.00 y signo `cero` (nunca `null` ni cadena vacia)", async () => {
    const repo = buildRepo();
    (repo.agregarPorCategoriaYTipo as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const svc = new WalletService(repo, writeClient);

    const r = await svc.verResumenCaja({ page: 1, pageSize: 20 }, MAESTRO);
    if (r.status !== "ok") throw new Error("esperado ok");

    expect(r.resumen.enCaja).toBe("0.00");
    expect(r.resumen.ganancia).toBe("0.00");
    expect(r.resumen.signoEnCaja).toBe("cero");
    expect(r.resumen.signoGanancia).toBe("cero");
    expect(r.resumen.deTerceros).toBe("0.00");
  });

  // ── Feature 231 (T2.4, design §3.2) — la composicion viaja con el resumen ──

  it("R24: una sola lectura: las dos derivaciones salen del mismo array", async () => {
    // La contraprueba tiene que distinguir «una lectura» de «dos lecturas que dieron lo mismo».
    // Por eso el doble devuelve un agregado DISTINTO a partir de la segunda llamada: si el
    // servicio consultara la base dos veces —una por derivacion—, la composicion hablaria del
    // segundo instante y las aserciones de abajo caerian con el importe a la vista.
    const repo = buildRepo();
    (repo.agregarPorCategoriaYTipo as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(AGREGADO)
      .mockResolvedValue([
        { categoria: "ingreso_flete", tipo: "ingreso", total: "9999.00" },
        { categoria: "egreso_sueldo", tipo: "egreso", total: "4444.00" },
      ] satisfies AgregadoCajaRow[]);
    const svc = new WalletService(repo, writeClient);

    const r = await svc.verResumenCaja({ page: 1, pageSize: 20 }, MAESTRO);
    if (r.status !== "ok") throw new Error("esperado ok");

    // (a) UNA sola lectura de la base por consulta de pantalla.
    expect(repo.agregarPorCategoriaYTipo).toHaveBeenCalledTimes(1);
    // (b) la composicion habla del PRIMER agregado, no del segundo.
    expect(r.composicion.ingresos.ingreso_flete).toBe("1000.00");
    expect(r.composicion.ingresos.ingreso_flete).not.toBe("9999.00");
    expect(r.composicion.totalEgresos).toBe("300.00");
    // (c) y las dos derivaciones cuadran entre si, que es lo que R24 existe para garantizar:
    //     la tarjeta de la ganancia y la cifra de la caja no pueden discrepar.
    expect(r.composicion.totalIngresos).toBe(r.resumen.ingresosPropios);
    expect(r.composicion.totalEgresos).toBe(r.resumen.egresosPropios);
    // (d) el dinero de las tiendas (5 000) no se coló en la ganancia por ningún lado.
    expect(r.composicion.totalIngresos).not.toBe(r.resumen.entradas);
  });

  it("R30: `forbidden` no viaja con composición", async () => {
    const repo = buildRepo();
    const svc = new WalletService(repo, writeClient);

    const r = await svc.verResumenCaja({ page: 1, pageSize: 20 }, OTRO);

    expect(r).toEqual({ status: "forbidden" });
    expect("composicion" in r).toBe(false);
    expect("resumen" in r).toBe(false);
    expect(Object.keys(r)).toEqual(["status"]);
    // Control de no-vacuidad del `not`: con un rol autorizado, el MISMO camino SI trae las dos.
    const permitido = await svc.verResumenCaja({ page: 1, pageSize: 20 }, MAESTRO);
    expect("composicion" in permitido).toBe(true);
    expect("resumen" in permitido).toBe(true);
  });

  it("R23/R26: la composición cruza la frontera con TODOS sus importes como STRING", async () => {
    const svc = new WalletService(buildRepo(), writeClient);
    const r = await svc.verResumenCaja({ page: 1, pageSize: 20 }, MAESTRO);
    if (r.status !== "ok") throw new Error("esperado ok");

    const importes = [
      ...Object.values(r.composicion.ingresos),
      r.composicion.totalIngresos,
      r.composicion.otrosEgresos,
      r.composicion.totalEgresos,
    ];
    expect(importes.length).toBe(10); // 7 conceptos + 3 totales: ninguno se pierde
    for (const v of importes) {
      expect(typeof v).toBe("string");
      expect(v).toMatch(/^-?\d+\.\d{2}$/); // escala 2 SIEMPRE, tambien en el cero
    }
  });
});

describe("WalletService.registrarMovimientoManual (R1/R3/R15/R19)", () => {
  it("R19: rol no autorizado -> forbidden, sin crear nada", async () => {
    const repo = buildRepo();
    const svc = new WalletService(repo, writeClient);
    const r = await svc.registrarMovimientoManual(
      { tipo: "ingreso", categoria: "ingreso_ajuste", monto: "50.00", descripcion: "x" },
      OTRO,
    );
    expect(r).toEqual({ status: "forbidden" });
    expect(repo.crearMovimientos).not.toHaveBeenCalled();
  });

  it("feature 94: admin -> crea manual (paridad con maestro)", async () => {
    const repo = buildRepo();
    const svc = new WalletService(repo, writeClient);
    const r = await svc.registrarMovimientoManual(
      { tipo: "ingreso", categoria: "ingreso_ajuste", monto: "50.00", descripcion: "x" },
      ADMIN,
    );
    expect(r.status).toBe("ok");
    const arg = (repo.crearMovimientos as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(arg[0]).toMatchObject({ registradoPor: "u-admin", origenTipo: "manual" });
  });

  it("R15: maestro -> crea manual con origen_tipo manual, origen_id null, registrado_por actor", async () => {
    const repo = buildRepo();
    (repo.listar as ReturnType<typeof vi.fn>).mockResolvedValue({
      movimientos: [mov({ id: "w-manual", tipo: "egreso", categoria: "egreso_ajuste", monto: "50.00", origenTipo: "manual", origenId: null, descripcion: "correccion", registradoPor: "u-maestro" })],
      total: 1,
    });
    const svc = new WalletService(repo, writeClient);
    const r = await svc.registrarMovimientoManual(
      { tipo: "egreso", categoria: "egreso_ajuste", monto: "50.00", descripcion: "correccion" },
      MAESTRO,
    );
    expect(r.status).toBe("ok");
    const arg = (repo.crearMovimientos as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(arg[0]).toMatchObject({
      tipo: "egreso",
      categoria: "egreso_ajuste",
      monto: "50.00",
      origenTipo: "manual",
      origenId: null,
      descripcion: "correccion",
      registradoPor: "u-maestro",
    });
  });

  it("R3: el servicio NO expone update ni delete (solo listar/verResumenCaja/registrarManual)", () => {
    const repo = buildRepo();
    const svc = new WalletService(repo, writeClient);
    expect((svc as unknown as Record<string, unknown>).actualizar).toBeUndefined();
    expect((svc as unknown as Record<string, unknown>).eliminar).toBeUndefined();
    expect((svc as unknown as Record<string, unknown>).update).toBeUndefined();
    expect((svc as unknown as Record<string, unknown>).delete).toBeUndefined();
    // R3: el repo tampoco expone update/delete de movimientos.
    expect((repo as unknown as Record<string, unknown>).actualizar).toBeUndefined();
    expect((repo as unknown as Record<string, unknown>).eliminar).toBeUndefined();
  });
});


// ── Ficha 334 (T C.1) — la FECHA elegida y el movimiento que se devuelve ──
//
// Dos defectos que la fecha vuelve DETERMINISTAS y que por eso entran aqui:
//
//  1. Con la fecha de hoy, el movimiento tiene que seguir fechandose con el instante del
//     registro (R23). Es el caso normal, y su coste tiene que ser CERO.
//  2. La relectura «el mas reciente de esta categoria» funcionaba por accidente. Con un
//     movimiento fechado en el pasado devuelve OTRA fila, y el servicio afirma «este es el que
//     registraste» sobre dinero ajeno (R28).

describe("WalletService.registrarMovimientoManual — la fecha elegida (R22/R23/R28)", () => {
  /** 09:00 CR del 29 de agosto: el reloj de pared con el que se teclea. */
  const AHORA = "2026-08-29T15:00:00.000Z";
  const HOY_CR = "2026-08-29";
  const AYER_CR = "2026-08-28";

  afterEach(() => {
    vi.useRealTimers();
  });

  function conRelojEnAhora(): void {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(AHORA));
  }

  function ajuste(fecha?: string) {
    return {
      tipo: "egreso" as const,
      categoria: "egreso_ajuste" as const,
      monto: "50.00",
      descripcion: "correccion",
      ...(fecha !== undefined ? { fecha } : {}),
    };
  }

  function filaInsertada(repo: IWalletMovimientoRepository): CrearMovimientoInput {
    return (repo.crearMovimientos as ReturnType<typeof vi.fn>).mock.calls[0][1][0];
  }

  it("R23: con la fecha de HOY, la clave fechaMovimiento NO viaja (manda el DEFAULT de la columna)", async () => {
    conRelojEnAhora();
    const repo = buildRepo();
    const svc = new WalletService(repo, writeClient);

    const r = await svc.registrarMovimientoManual(ajuste(HOY_CR), MAESTRO);

    expect(r.status).toBe("ok");
    // La clave AUSENTE, no `undefined`: es lo que deja que la columna caiga en su
    // `DEFAULT CURRENT_TIMESTAMP` y que el movimiento siga encabezando el libro.
    expect(Object.keys(filaInsertada(repo))).not.toContain("fechaMovimiento");
    if (r.status !== "ok") throw new Error("esperado ok");
    expect(r.movimiento.fechaMovimiento).toBe(INSTANTE_DEL_DEFAULT);
  });

  it("sin fecha, tampoco viaja — el camino de siempre no cambia ni un byte", async () => {
    conRelojEnAhora();
    const repo = buildRepo();
    const svc = new WalletService(repo, writeClient);

    await svc.registrarMovimientoManual(ajuste(), MAESTRO);

    expect(Object.keys(filaInsertada(repo))).not.toContain("fechaMovimiento");
  });

  it("R22: con la fecha de AYER, viaja el instante en que ese dia EMPIEZA en Costa Rica (06:00Z)", async () => {
    conRelojEnAhora();
    const repo = buildRepo();
    const svc = new WalletService(repo, writeClient);

    const r = await svc.registrarMovimientoManual(ajuste(AYER_CR), MAESTRO);

    expect(r.status).toBe("ok");
    // `${ayer}T06:00:00.000Z` y NO `T00:00:00.000Z`: con medianoche UTC, el rollup diario
    // —que agrupa por `(fecha_movimiento − 6h)::date`— contaria el gasto de ayer como de
    // ANTEAYER. El literal es el contrato de esa frontera.
    expect(filaInsertada(repo).fechaMovimiento).toEqual(new Date("2026-08-28T06:00:00.000Z"));
    if (r.status !== "ok") throw new Error("esperado ok");
    expect(r.movimiento.fechaMovimiento).toBe("2026-08-28T06:00:00.000Z");
  });

  it("R28: devuelve el movimiento que CREO, aunque exista uno mas reciente de su misma categoria", async () => {
    conRelojEnAhora();
    const repo = buildRepo();
    // El senuelo: otro ajuste de la MISMA categoria y mas reciente. Es exactamente lo que la
    // relectura vieja (`listar({ page: 1, pageSize: 1, tipo, categoria })`) habria devuelto.
    (repo.listar as ReturnType<typeof vi.fn>).mockResolvedValue({
      movimientos: [
        mov({
          id: "w-otro-ajuste-mas-reciente",
          tipo: "egreso",
          categoria: "egreso_ajuste",
          monto: "999.99",
          origenTipo: "manual",
          origenId: null,
          fechaMovimiento: "2026-08-29T20:00:00.000Z",
        }),
      ],
      total: 1,
    });
    const svc = new WalletService(repo, writeClient);

    const r = await svc.registrarMovimientoManual(ajuste(AYER_CR), MAESTRO);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("esperado ok");
    const idInsertado = filaInsertada(repo).id;
    // CONTROL DE NO-VACUIDAD: el servicio genero un id y lo mando en la insercion.
    expect(idInsertado).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(r.movimiento.id).toBe(idInsertado);
    expect(r.movimiento.id).not.toBe("w-otro-ajuste-mas-reciente");
    expect(r.movimiento.monto).toBe("50.00"); // el suyo, no los 999.99 del senuelo
    // Y ni siquiera pregunta por el listado: la relectura es por ID.
    expect(repo.listar).not.toHaveBeenCalled();
    expect(repo.obtenerPorId).toHaveBeenCalledWith(idInsertado);
  });

  it("un solo INSERT: la fila lleva su id dentro, no se parte el createMany en dos", async () => {
    conRelojEnAhora();
    const repo = buildRepo();
    const svc = new WalletService(repo, writeClient);

    await svc.registrarMovimientoManual(ajuste(AYER_CR), MAESTRO);

    expect(repo.crearMovimientos).toHaveBeenCalledTimes(1);
    expect((repo.crearMovimientos as ReturnType<typeof vi.fn>).mock.calls[0][1]).toHaveLength(1);
  });
});
