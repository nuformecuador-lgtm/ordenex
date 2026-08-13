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
function montar(opciones: { cierres?: CierreImputableDTO[]; tope?: number } = {}) {
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
    listarPorReparto: vi.fn(async () => []),
    obtenerCierreParaPago: vi.fn(async () => null),
    anular: vi.fn(async () => ({ status: "ya_anulado" as const })),
    obtenerPorClave: vi.fn(async () => null),
    obtenerPorId: vi.fn(async () => null),
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

describe("R52 — no existe forma de editar ni de borrar un reparto", () => {
  it("ni el servicio ni el repositorio del acto exponen un método que lo deshaga", async () => {
    const metodosServicio = Object.getOwnPropertyNames(LiquidacionService.prototype);
    for (const nombre of metodosServicio) {
      expect(nombre, `método sospechoso: ${nombre}`).not.toMatch(
        /editarReparto|actualizarReparto|borrarReparto|eliminarReparto|anularReparto|deshacerReparto/i,
      );
    }

    // El repositorio del acto tiene DOS métodos y ninguno más (design §1.1: la fila es inmutable).
    const repo = fuente("lib/repositories/LiquidacionRepartoRepository.ts");
    const metodos = [...repo.matchAll(/^\s{2}async\s+(\w+)\(/gm)].map((m) => m[1]);
    expect(metodos.sort()).toEqual(["crear", "obtenerPorClave"]);
    expect(repo).not.toMatch(/liquidacionReparto\.(update|delete|upsert|updateMany|deleteMany)/);
  });

  it("las Server Actions del reparto son DOS y ninguna corrige nada", async () => {
    const acciones = fuente("lib/actions/liquidacion.ts");
    const exportadas = [...acciones.matchAll(/export async function (\w+)\(/g)].map((m) => m[1]);
    const delReparto = exportadas.filter((n) => /Reparto/i.test(n));
    expect(delReparto.sort()).toEqual([
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
