import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect, vi } from "vitest";
import { CierreEstado, RolValue, type PrismaClient } from "@prisma/client";

import { WalletMovimientoRepository } from "@/lib/repositories/WalletMovimientoRepository";
import { CajaPagoTiendaFeedService } from "@/lib/services/CajaPagoTiendaFeedService";
import { LiquidacionService } from "@/lib/services/LiquidacionService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  BeneficiarioBloqueo,
  CierreImputableDTO,
  CrearLiquidacionPagoInput,
  ILiquidacionPagoRepository,
  LiquidacionPagoDTO,
} from "@/lib/interfaces/repositories/ILiquidacionPagoRepository";
import type { ILiquidacionRepartoRepository } from "@/lib/interfaces/repositories/ILiquidacionRepartoRepository";
import type {
  CrearPagoMensajeroInput,
  IPagoMensajeroMovimientoRepository,
} from "@/lib/interfaces/repositories/IPagoMensajeroMovimientoRepository";
import type { IWalletTiendaMovimientoRepository } from "@/lib/interfaces/repositories/IWalletTiendaMovimientoRepository";
import type {
  LiquidacionTx,
  LiquidacionTxRunner,
} from "@/lib/interfaces/services/ILiquidacionService";
import { quitarComentarios } from "../../fixtures/money-safe";

/**
 * Feature 205 / T3.4 — LA GUARDIA DE LOS CANDADOS Y DEL ALCANCE (R21, R22, R26, R52, R55).
 *
 * Por qué esto es una guardia y no «unos casos más del servicio»: lo que aquí se afirma no es un
 * resultado, es una **propiedad del camino**. Un reparto puede devolver exactamente el mismo
 * `ok`, con los mismos importes y las mismas filas, tomando los candados en otro orden, tomando
 * uno de más, tomándolos después de leer, o no tomándolos. La diferencia no se ve en la respuesta:
 * se ve en producción, un martes, cuando dos repartos se cruzan.
 *
 * El orden total de adquisición es **lo único** que separa esto de un interbloqueo (design §3.1):
 * el pago simple toma UN solo candado y nunca espera con otro en la mano, así que mientras todos
 * los repartos adquieran en el MISMO orden no puede formarse un ciclo. Reordenarlos «por
 * conveniencia» —o pedirlos en paralelo, que es pedirlos en orden indeterminado— es fabricar el
 * ciclo.
 */

const RAIZ = path.resolve(__dirname, "../../..");
const MENSAJERO = "m1";
const ACTOR: Actor = { usuarioId: "u-admin", rol: RolValue.admin };
const CLAVE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function fuente(ruta: string): string {
  return quitarComentarios(readFileSync(path.join(RAIZ, ruta), "utf8"));
}

function cierre(id: string, pendiente: string, solicitadoAt: string): CierreImputableDTO {
  return {
    id,
    mensajeroId: MENSAJERO,
    estado: CierreEstado.aprobado,
    totalPagoMensajero: pendiente,
    totalEfectivo: "0.00",
    solicitadoAt,
  };
}

/** CINCO cierres imputables, deliberadamente DESORDENADOS a la entrada. */
function cincoDesordenados(): CierreImputableDTO[] {
  return [
    cierre("c-e", "4000.00", "2026-07-13T10:00:00.000Z"),
    cierre("c-b", "8000.00", "2026-07-05T10:00:00.000Z"),
    cierre("c-d", "3000.00", "2026-07-11T10:00:00.000Z"),
    cierre("c-a", "5000.00", "2026-07-01T10:00:00.000Z"),
    cierre("c-c", "12000.00", "2026-07-09T10:00:00.000Z"),
  ];
}

/**
 * El montaje mínimo: un LOG ordenado de TODO lo que el servicio pide, con los candados marcados
 * por su grano. El log es el instrumento: sobre él se miden orden, número y posición relativa.
 */
function montar(
  opciones: {
    cierres?: CierreImputableDTO[];
    tope?: number;
    /**
     * Feature 206 — las imputaciones que `listarPorReparto` devuelve, para medir la ANULACIÓN
     * agrupada con el mismo instrumento (el log) que la registración.
     */
    pagosDelReparto?: LiquidacionPagoDTO[];
  } = {},
) {
  const log: string[] = [];
  const bloqueos: BeneficiarioBloqueo[] = [];
  const pagos: CrearLiquidacionPagoInput[] = [];
  const movimientos: CrearPagoMensajeroInput[] = [];
  const espia = () => ({
    create: vi.fn(),
    createMany: vi.fn().mockResolvedValue({ count: 1 }),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
    upsert: vi.fn(),
  });
  const tx = {
    liquidacionPago: espia(),
    liquidacionReparto: espia(),
    walletTiendaMovimiento: espia(),
    pagoMensajeroMovimiento: espia(),
    walletMovimiento: espia(),
    cierreDia: espia(), // R26
    $queryRaw: vi.fn().mockResolvedValue([]),
  };
  let seq = 0;

  const pagoRepo: ILiquidacionPagoRepository = {
    bloquearBeneficiario: vi.fn(async (_tx, objetivo) => {
      bloqueos.push(objetivo);
      log.push(
        objetivo.tipo === "cierre"
          ? `bloquear:cierre:${objetivo.cierreId}`
          : `bloquear:tienda:${objetivo.tiendaId}`,
      );
    }),
    crear: vi.fn(async (_tx, input: CrearLiquidacionPagoInput) => {
      seq += 1;
      pagos.push(input);
      log.push(`escribir:pago:${input.cierreId}`);
      const pago: LiquidacionPagoDTO = {
        id: `pago-${seq}`,
        mensajeroId: input.mensajeroId,
        tiendaId: null,
        cierreId: input.cierreId,
        monto: input.monto,
        metodo: input.metodo,
        referencia: input.referencia,
        nota: input.nota,
        fechaPago: "2026-07-30",
        registradoPorNombre: "Ana Admin",
        registradoAt: "2026-07-30T15:04:05.000Z",
        // Feature 206: el doble devuelve el reparto que el input trae. Esta guardia vigila el
        // ORDEN de los candados de un reparto, asi que perder el campo aqui la dejaria ciega.
        repartoId: input.repartoId ?? null,
        anulacion: null,
      };
      return { status: "creado" as const, pago };
    }),
    listarCierresImputables: vi.fn(async () => {
      log.push("leer:imputables");
      return opciones.cierres ?? cincoDesordenados();
    }),
    sumarVigentesPorCierre: vi.fn(async (ids: string[]) => {
      log.push("leer:pendientes");
      return Object.fromEntries(ids.map((id) => [id, "0.00"]));
    }),
    contarCierresNoAprobadosPorEstado: vi.fn(async () => []),
    listarPorReparto: vi.fn(async () => {
      log.push("leer:pagos-del-reparto");
      return opciones.pagosDelReparto ?? [];
    }),
    obtenerCierreParaPago: vi.fn(async () => null),
    // Feature 206: `anularReparto` empieza leyendo EL PAGO para derivar su reparto. El doble
    // devuelve el primero de la lista, que es el que los casos piden por id.
    obtenerPorId: vi.fn(async () => {
      log.push("leer:pago");
      return opciones.pagosDelReparto?.[0] ?? null;
    }),
    // Feature 206: por defecto ANULA de verdad, para que la anulación agrupada tenga algo que
    // medir. Los casos que necesitan el choque de `UNIQUE(pago_id)` lo sobrescriben.
    anular: vi.fn(async (_tx, input: { pagoId: string }) => {
      log.push(`escribir:anulacion:${input.pagoId}`);
      return {
        status: "anulado" as const,
        anulacion: {
          motivo: "reparto mal imputado",
          anuladoPorNombre: "Ana Admin",
          anuladoAt: "2026-08-13T15:04:05.000Z",
        },
      };
    }),
    obtenerPorClave: vi.fn(async () => null),
    sumarVigentesPorTienda: vi.fn(async () => "0.00"),
    listarPorCierre: vi.fn(async () => []),
    listarPorTienda: vi.fn(async () => []),
  };

  const mensajeroRepo = {
    crearMovimientos: vi.fn(async (_tx, movs: CrearPagoMensajeroInput[]) => {
      movimientos.push(...movs);
      for (const mov of movs) log.push(`escribir:movimiento:${mov.origenId}`);
      return movs.length;
    }),
    agregarCuentaPorPagar: vi.fn(async () => ({ devengado: "32000.00", pagado: "0.00" })),
    obtenerNombreMensajero: vi.fn(async () => "Marco Mensajero"),
    listarPorMensajero: vi.fn(),
    listarCuentasPorPagarTodos: vi.fn(),
    listarCuentasPorPagarPaginado: vi.fn(),
    listarCuentasPorPagarCompleto: vi.fn(),
  } as unknown as IPagoMensajeroMovimientoRepository;

  const repartoRepo: ILiquidacionRepartoRepository = {
    crear: vi.fn(async () => {
      log.push("escribir:reparto");
      return {
        status: "creado" as const,
        reparto: {
          id: "rep-1",
          claveIdempotencia: CLAVE,
          mensajeroId: MENSAJERO,
          montoTotal: "13000.00",
          registradoPor: "u-admin",
          registradoAt: "2026-07-30T15:04:05.000Z",
        },
      };
    }),
    obtenerPorClave: vi.fn(async () => null),
  };

  const runTransaction: LiquidacionTxRunner = async (fn) => {
    log.push("tx:abrir");
    const r = await fn(tx as unknown as LiquidacionTx);
    log.push("tx:commit");
    return r;
  };

  const service = new LiquidacionService(
    pagoRepo,
    { crearMovimientos: vi.fn(), agregarSaldoPorTienda: vi.fn() } as unknown as IWalletTiendaMovimientoRepository,
    mensajeroRepo,
    runTransaction,
    new CajaPagoTiendaFeedService(new WalletMovimientoRepository({} as unknown as PrismaClient)),
    repartoRepo,
    () => new Date("2026-07-30T15:04:05.000Z"),
    opciones.tope ?? 50,
  );

  return { service, log, bloqueos, pagos, movimientos, tx, pagoRepo };
}

function repartir(m: ReturnType<typeof montar>, monto: string) {
  return m.service.registrarRepartoMensajero(
    {
      claveIdempotencia: CLAVE,
      mensajeroId: MENSAJERO,
      monto,
      metodo: "SINPE",
      referencia: "1234567",
      fechaPago: "2026-07-30",
    },
    ACTOR,
  );
}

describe("R21/R22 — el grano del candado y su ORDEN", () => {
  it("R21: se toma el candado del CIERRE para cada cierre que se toca, y de ningún otro grano", async () => {
    const m = montar();

    const r = await repartir(m, "17000.00"); // toca c-a, c-b, c-c

    expect(r.status).toBe("ok");
    // El grano es la fila del cierre, el MISMO que toma el pago contra un cierre único (R21).
    // Ni uno de `usuario`: bloquear al mensajero serializaría pagos que hoy no se estorban (§3.3).
    expect(m.bloqueos.every((b) => b.tipo === "cierre")).toBe(true);
    expect(m.bloqueos.map((b) => (b.tipo === "cierre" ? b.cierreId : b.tiendaId))).toEqual([
      "c-a",
      "c-b",
      "c-c",
      "c-d",
      "c-e",
    ]);
  });

  it("R22: el orden de adquisición es el FIFO del reparto, aunque la lectura llegue desordenada", async () => {
    // La lista de entrada está desordenada a propósito: si los candados se tomaran «según venga»
    // —o según cualquier otro criterio— este caso los vería en otro orden.
    const m = montar();

    await repartir(m, "17000.00");

    const orden = m.log.filter((e) => e.startsWith("bloquear:"));
    expect(orden).toEqual([
      "bloquear:cierre:c-a", // 2026-07-01
      "bloquear:cierre:c-b", // 2026-07-05
      "bloquear:cierre:c-c", // 2026-07-09
      "bloquear:cierre:c-d", // 2026-07-11
      "bloquear:cierre:c-e", // 2026-07-13
    ]);
  });

  it("R22: el orden de los candados coincide FILA A FILA con el de las imputaciones", async () => {
    const m = montar();

    await repartir(m, "17000.00");

    const bloqueados = m.log
      .filter((e) => e.startsWith("bloquear:cierre:"))
      .map((e) => e.replace("bloquear:cierre:", ""));
    const imputados = m.pagos.map((p) => p.cierreId);
    // Los imputados son un PREFIJO de los bloqueados: se bloquea la ventana entera y se escribe
    // hasta donde alcanza el importe, en el mismo orden.
    expect(bloqueados.slice(0, imputados.length)).toEqual(imputados);
  });

  it("R22: dos ejecuciones sobre los mismos datos adquieren en el MISMO orden", async () => {
    // El determinismo es lo que hace que el orden total valga: si dependiera del motor, de un
    // `Map` o de la hora, dos repartos concurrentes podrían cruzarse igualmente.
    const primero = montar();
    await repartir(primero, "17000.00");
    const segundo = montar();
    await repartir(segundo, "17000.00");

    expect(primero.log.filter((e) => e.startsWith("bloquear:"))).toEqual(
      segundo.log.filter((e) => e.startsWith("bloquear:")),
    );
  });

  it("R21/R23: los candados se toman ANTES de la lectura que DECIDE y antes de toda escritura", async () => {
    const m = montar();

    await repartir(m, "17000.00");

    const ultimoBloqueo = m.log.map((e) => e.startsWith("bloquear:")).lastIndexOf(true);
    const primeraEscrituraDeDinero = m.log.findIndex((e) => e.startsWith("escribir:pago:"));
    const lecturasDePendientes = m.log
      .map((e, i) => (e === "leer:pendientes" ? i : -1))
      .filter((i) => i >= 0);

    // (a) Ninguna fila de dinero se escribe antes de tener TODOS los candados.
    expect(primeraEscrituraDeDinero).toBeGreaterThan(ultimoBloqueo);
    // (b) La lectura que decide los importes ocurre DESPUÉS del último candado. La de antes
    //     existe para saber QUÉ bloquear —no se puede bloquear lo que no se sabe— y no decide
    //     ningún importe: R23 lo prueba en la suite del servicio cambiando el pendiente entre
    //     las dos y comprobando que gana la segunda.
    expect(lecturasDePendientes.some((i) => i > ultimoBloqueo)).toBe(true);
    // (c) Y el ACTO (la fila del reparto) va antes que todo lo demás: es la barrera de R29.
    expect(m.log.indexOf("escribir:reparto")).toBeLessThan(ultimoBloqueo);
  });
});

describe("R55 — el tope acota los candados y las filas, y los recortados no se tocan", () => {
  it("R55: con `tope: 2` y 5 imputables: 2 candados, 2 pagos, 2 movimientos", async () => {
    const m = montar({ tope: 2 });

    const r = await repartir(m, "13000.00"); // 5 000 + 8 000 = la ventana entera

    expect(r.status).toBe("ok");
    expect(m.bloqueos).toHaveLength(2);
    expect(m.pagos).toHaveLength(2);
    expect(m.movimientos).toHaveLength(2);
  });

  it("R55: los TRES cierres recortados no aparecen en NINGUNA llamada", async () => {
    const m = montar({ tope: 2 });

    await repartir(m, "13000.00");

    const todo = m.log.join("|");
    for (const recortado of ["c-c", "c-d", "c-e"]) {
      expect(todo, `el cierre recortado ${recortado} se tocó`).not.toContain(recortado);
    }
    expect(m.pagos.map((p) => p.cierreId)).toEqual(["c-a", "c-b"]);
  });

  it("R55 (control): sin tope, esos mismos tres cierres SÍ se bloquean", async () => {
    // Sin el control, el caso de arriba pasaría igual si el reparto no bloqueara nunca nada.
    const m = montar();

    await repartir(m, "13000.00");

    expect(m.bloqueos).toHaveLength(5);
  });
});

describe("R26 — los datos del cierre son de SOLO LECTURA", () => {
  it("ninguna escritura llega al delegado de `cierreDia` durante un reparto", async () => {
    const m = montar();

    await repartir(m, "17000.00");

    for (const metodo of ["create", "createMany", "update", "updateMany", "delete", "deleteMany", "upsert"] as const) {
      expect(m.tx.cierreDia[metodo], `cierreDia.${metodo}`).not.toHaveBeenCalled();
    }
  });

  it("ESTRUCTURAL: el servicio no nombra ninguna escritura sobre `cierreDia`", async () => {
    const codigo = fuente("lib/services/LiquidacionService.ts");
    for (const metodo of ["update", "updateMany", "create", "createMany", "delete", "deleteMany", "upsert"]) {
      expect(codigo, `el servicio nombra cierreDia.${metodo}`).not.toContain(`cierreDia.${metodo}`);
    }
    // Y el repositorio del pago tampoco: `cierre_dia` es una tabla ajena a esta feature.
    const repo = fuente("lib/repositories/LiquidacionPagoRepository.ts");
    expect(repo).not.toMatch(/cierreDia\.(update|create|delete|upsert)/);
  });
});

/**
 * Feature 206 — LOS CANDADOS DE LA ANULACIÓN AGRUPADA.
 *
 * Aquí está la razón de ser de este bloque, y no es un resultado: **`bloquearBeneficiario` de un
 * pago a mensajero bloquea la fila de SU `cierre_dia`**, y la interfaz del repositorio razonaba
 * con UNO solo — «al no haber dos recursos que ordenar, no existe orden de adquisición capaz de
 * producir un interbloqueo». Un reparto imputa a N cierres distintos, así que anularlo entero
 * toma **N candados** y esa premisa deja de valer.
 *
 * La respuesta de `anularReparto` es IDÉNTICA con cualquier orden de adquisición. Lo que cambia es
 * si dos anulaciones simultáneas con cierres compartidos se trban o no. Por eso se mide el log.
 */
describe("feature 206 — la anulación agrupada adquiere N candados en orden total", () => {
  /** Tres imputaciones a tres cierres, devueltas DESORDENADAS a propósito. */
  function tresImputaciones(): LiquidacionPagoDTO[] {
    const base = {
      mensajeroId: MENSAJERO,
      tiendaId: null,
      metodo: "SINPE" as const,
      referencia: "1234567",
      nota: null,
      fechaPago: "2026-07-30",
      registradoPorNombre: "Ana Admin",
      registradoAt: "2026-07-30T15:04:05.000Z",
      repartoId: "rep-1",
      anulacion: null,
    };
    return [
      { ...base, id: "pago-3", cierreId: "c-c", monto: "3000.00" },
      { ...base, id: "pago-1", cierreId: "c-a", monto: "5000.00" },
      { ...base, id: "pago-2", cierreId: "c-b", monto: "8000.00" },
    ];
  }

  /**
   * Se pide por el PAGO, no por el reparto: el servidor deriva el grupo (R56 prohíbe que el uuid
   * del reparto cruce la frontera, y tres guardias de la 172 lo hicieron cumplir).
   */
  function anular(m: ReturnType<typeof montar>) {
    return m.service.anularReparto(
      { pagoId: "pago-1", motivo: "reparto mal imputado" },
      ACTOR,
    );
  }

  it("toma UN candado por cierre y NINGUNO de otro grano", async () => {
    const m = montar({ pagosDelReparto: tresImputaciones() });
    await anular(m);

    expect(m.bloqueos.map((b) => b.tipo)).toEqual(["cierre", "cierre", "cierre"]);
    expect(m.bloqueos.map((b) => (b.tipo === "cierre" ? b.cierreId : b.tiendaId))).toEqual([
      "c-a",
      "c-b",
      "c-c",
    ]);
  });

  it("el orden de adquisición es DETERMINISTA aunque la lista llegue desordenada", async () => {
    const m = montar({ pagosDelReparto: tresImputaciones() });
    await anular(m);

    // La lista entró c-c, c-a, c-b. Los candados salen ordenados: eso es el orden total.
    expect(m.log.filter((e) => e.startsWith("bloquear:"))).toEqual([
      "bloquear:cierre:c-a",
      "bloquear:cierre:c-b",
      "bloquear:cierre:c-c",
    ]);
  });

  it("dos ejecuciones sobre los mismos datos adquieren en el MISMO orden", async () => {
    const primero = montar({ pagosDelReparto: tresImputaciones() });
    await anular(primero);
    // La segunda recibe la lista en OTRO orden: si el servicio siguiera la lista, divergiría.
    const revuelto = tresImputaciones().reverse();
    const segundo = montar({ pagosDelReparto: revuelto });
    await anular(segundo);

    expect(primero.log.filter((e) => e.startsWith("bloquear:"))).toEqual(
      segundo.log.filter((e) => e.startsWith("bloquear:")),
    );
  });

  it("TODOS los candados se toman antes de la primera escritura", async () => {
    const m = montar({ pagosDelReparto: tresImputaciones() });
    await anular(m);

    const ultimoCandado = m.log.map((e) => e.startsWith("bloquear:")).lastIndexOf(true);
    const primeraEscritura = m.log.findIndex((e) => e.startsWith("escribir:"));
    expect(ultimoCandado).toBeGreaterThanOrEqual(0);
    expect(primeraEscritura).toBeGreaterThan(ultimoCandado);
  });

  it("dos imputaciones al MISMO cierre toman UN solo candado", async () => {
    const dosAlMismo = tresImputaciones().slice(0, 2).map((p) => ({ ...p, cierreId: "c-a" }));
    const m = montar({ pagosDelReparto: dosAlMismo });
    await anular(m);

    expect(m.log.filter((e) => e.startsWith("bloquear:"))).toEqual(["bloquear:cierre:c-a"]);
    // Pero SÍ se anulan las dos: el candado se deduplica, la anulación no.
    expect(m.log.filter((e) => e.startsWith("escribir:anulacion:"))).toHaveLength(2);
  });

  it("el reparto A MEDIAS anula las que quedan e informa de las DOS cifras", async () => {
    const [uno, dos, tres] = tresImputaciones();
    const yaAnulada = {
      ...uno,
      anulacion: {
        motivo: "a mano",
        anuladoPorNombre: "Beto Admin",
        anuladoAt: "2026-08-12T10:00:00.000Z",
      },
    };
    const m = montar({ pagosDelReparto: [yaAnulada, dos, tres] });
    const r = await anular(m);

    expect(r).toEqual({ status: "ok", anuladas: 2, yaEstaban: 1 });
    // Y la ya anulada NO se vuelve a tocar ni se bloquea su cierre.
    expect(m.log).not.toContain(`escribir:anulacion:${uno.id}`);
    expect(m.log.filter((e) => e.startsWith("bloquear:"))).not.toContain(
      `bloquear:cierre:${uno.cierreId}`,
    );
  });

  it("un reparto ENTERO anulado no toma candados ni escribe nada", async () => {
    const anuladas = tresImputaciones().map((p) => ({
      ...p,
      anulacion: {
        motivo: "a mano",
        anuladoPorNombre: "Beto Admin",
        anuladoAt: "2026-08-12T10:00:00.000Z",
      },
    }));
    const m = montar({ pagosDelReparto: anuladas });
    const r = await anular(m);

    expect(r).toEqual({ status: "sin_vigentes", yaEstaban: 3 });
    expect(m.log.filter((e) => e.startsWith("bloquear:"))).toEqual([]);
    expect(m.log.filter((e) => e.startsWith("escribir:"))).toEqual([]);
    expect(m.log).not.toContain("tx:abrir"); // ni se abre transacción
  });

  it("una CARRERA (el `UNIQUE` responde `ya_anulado`) suma al conteo y no revienta el acto", async () => {
    const m = montar({ pagosDelReparto: tresImputaciones() });
    let llamada = 0;
    (m.pagoRepo.anular as unknown as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      llamada += 1;
      // La segunda imputación la anuló otra sesión entre la lectura y el candado.
      if (llamada === 2) return { status: "ya_anulado" as const };
      return {
        status: "anulado" as const,
        anulacion: {
          motivo: "reparto mal imputado",
          anuladoPorNombre: "Ana Admin",
          anuladoAt: "2026-08-13T15:04:05.000Z",
        },
      };
    });

    const r = await anular(m);
    expect(r).toEqual({ status: "ok", anuladas: 2, yaEstaban: 1 });
  });

  it("el motivo es UNO para todo el acto: llega idéntico a las tres anulaciones", async () => {
    const m = montar({ pagosDelReparto: tresImputaciones() });
    await anular(m);

    const motivos = (m.pagoRepo.anular as unknown as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => (c[1] as { motivo: string }).motivo,
    );
    expect(motivos).toEqual([
      "reparto mal imputado",
      "reparto mal imputado",
      "reparto mal imputado",
    ]);
  });
});

/**
 * R52 — la fila del reparto es INMUTABLE.
 *
 * ⚠️ **Este bloque cambió con la feature 206, y el cambio es deliberado.** Tal como lo dejó la 205,
 * prohibía por nombre cualquier método que sonara a deshacer un reparto, `anularReparto` incluido.
 * La 206 añade exactamente ese método por decisión humana, así que la invariante hay que
 * REEXPRESARLA en vez de relajarla — si no, la guardia solo diría «el código es el que era».
 *
 * **Anular no es editar ni borrar, y esa es toda la diferencia:** la anulación es APPEND-ONLY —
 * inserta una fila en `liquidacion_anulacion` y su contraasiento en el libro— y deja el reparto y
 * sus N imputaciones intactos y visibles. Lo que sigue prohibido, y es lo que R52 protegía de
 * verdad, es que alguien EDITE el acto o lo haga desaparecer: eso reescribiría la historia del
 * dinero en vez de compensarla.
 */
describe("R52 — la fila del reparto es inmutable (anular NO es editar ni borrar)", () => {
  it("no existe método que EDITE ni que BORRE un reparto", async () => {
    const metodosServicio = Object.getOwnPropertyNames(LiquidacionService.prototype);
    for (const nombre of metodosServicio) {
      // `anularReparto` YA NO está en la lista: es la feature 206. Los otros cinco siguen, y
      // `deshacer` entre ellos, porque deshacer implicaría revertir sin dejar rastro.
      expect(nombre, `método sospechoso: ${nombre}`).not.toMatch(
        /editarReparto|actualizarReparto|borrarReparto|eliminarReparto|deshacerReparto/i,
      );
    }

    // El repositorio del acto tiene DOS métodos y ninguno más (design §1.1: la fila es inmutable).
    // La 206 NO lo toca: la anulación escribe en `liquidacion_anulacion` y en los libros, nunca
    // sobre `liquidacion_reparto`. Que este conteo siga en dos es lo que lo demuestra.
    const repo = fuente("lib/repositories/LiquidacionRepartoRepository.ts");
    const metodos = [...repo.matchAll(/^\s{2}async\s+(\w+)\(/gm)].map((m) => m[1]);
    expect(metodos.sort()).toEqual(["crear", "obtenerPorClave"]);
    expect(repo).not.toMatch(/liquidacionReparto\.(update|delete|upsert|updateMany|deleteMany)/);
  });

  it("las Server Actions del reparto son TRES: dos que lo crean y UNA que lo anula", async () => {
    const acciones = fuente("lib/actions/liquidacion.ts");
    const exportadas = [...acciones.matchAll(/export async function (\w+)\(/g)].map((m) => m[1]);
    const delReparto = exportadas.filter((n) => /Reparto/i.test(n));
    // Enumeradas a mano y no contadas: si mañana aparece una cuarta —«corregirReparto»,
    // «reimputarReparto»— este test la ve, que es justo lo que R52 vigila.
    expect(delReparto.sort()).toEqual([
      "anularRepartoAction", // feature 206
      "previsualizarRepartoMensajeroAction",
      "registrarRepartoMensajeroAction",
    ]);
  });
});

describe("R29 — el composition root cablea la barrera de idempotencia de verdad", () => {
  it("`buildService` le da al servicio el repositorio del ACTO, construido sobre prisma", async () => {
    // Ningún test de comportamiento pasa por aquí —todos inyectan el servicio por `deps`—, así
    // que el cableado real es exactamente el sitio donde una omisión no la nota nadie hasta
    // producción: sin `LiquidacionRepartoRepository`, el reparto se queda sin su `UNIQUE` y el
    // doble envío paga dos veces. Se mide sobre el código, que es lo único que hay.
    const codigo = fuente("lib/actions/liquidacion.ts");
    const build = codigo.slice(
      codigo.indexOf("function buildService"),
      codigo.indexOf("export interface LiquidacionDeps"),
    );

    expect(build.length).toBeGreaterThan(100);
    expect(build).toMatch(/new LiquidacionRepartoRepository\(prisma\)/);
    // Y va en la posición del repositorio del acto: DESPUÉS del puerto de la caja (el orden del
    // constructor), no en el hueco del reloj ni en el del tope.
    expect(build).toMatch(
      /new CajaPagoTiendaFeedService\([\s\S]*?\),\s*(\/\/[^\n]*\n\s*)*new LiquidacionRepartoRepository\(prisma\),/,
    );
    // El TOPE no se pasa aquí: lo pone el único punto de configuración (R53). Un número escrito
    // en el composition root sería la segunda copia que R57 prohíbe.
    expect(build).not.toMatch(/\b\d{2,}\b/);
  });
});

describe("ESTRUCTURAL — la defensa anti-interbloqueo, medida sobre el código", () => {
  it("los candados se piden EN SERIE, nunca en paralelo", async () => {
    // `Promise.all` sobre los bloqueos los pediría en orden INDETERMINADO: el orden total —que es
    // toda la defensa— se perdería sin que ningún test de resultado lo notara.
    const codigo = fuente("lib/services/LiquidacionService.ts");
    const bloque = codigo.slice(
      codigo.indexOf("async registrarRepartoMensajero"),
      codigo.indexOf("async registrarPagoTienda"),
    );
    expect(bloque.length).toBeGreaterThan(200); // el corte encontró el método de verdad
    expect(bloque).toMatch(/for\s*\(const\s+\w+\s+of\s+ventana\)/);
    expect(bloque).not.toMatch(/Promise\.(all|allSettled|race)/);
  });

  it("el orden lo fija `ordenarCierresFifo`, no un comparador propio del servicio", async () => {
    // Dos comparadores del mismo orden son dos sitios que pueden divergir; y el del módulo puro es
    // el que está probado sin base de datos (R8/R17).
    const codigo = fuente("lib/services/LiquidacionService.ts");
    expect(codigo).toContain("ordenarCierresFifo(");
    expect(codigo).not.toMatch(/\.sort\(\s*\(a,\s*b\)\s*=>[^)]*solicitadoAt/);
  });

  it("la ventana se recorre a sí misma bajo bloqueo: no se rellena desde la lectura fresca", async () => {
    // §2.5.5 en el código: el bucle de la relectura itera `ventana` (lo que SE BLOQUEÓ) y usa la
    // lectura fresca como consulta. Al revés —iterar lo fresco— rellenaría el hueco con un cierre
    // sin candado.
    const codigo = fuente("lib/services/LiquidacionService.ts");
    const bloque = codigo.slice(
      codigo.indexOf("private async ventanaBajoBloqueo"),
      codigo.indexOf("private async responderRepartoYaRegistrado"),
    );
    expect(bloque.length).toBeGreaterThan(100);
    expect(bloque).toMatch(/for\s*\(const\s+\w+\s+of\s+ventana\)/);
    expect(bloque).not.toMatch(/for\s*\(const\s+\w+\s+of\s+frescos\)/);
  });
});
