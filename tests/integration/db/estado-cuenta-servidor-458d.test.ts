import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

import {
  verEstadoCuentaAction,
  verEstadoCuentaCompletoAction,
  verMiEstadoCuentaAction,
  verMiEstadoCuentaCompletoAction,
} from "@/lib/actions/estado-cuenta";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { METODO_LABEL } from "@/lib/constants/metodo-pago-label";
import type {
  EstadoCuentaDTO,
  FilaEstadoCuentaDTO,
  VerEstadoCuentaCompletoResult,
  VerEstadoCuentaResult,
} from "@/lib/types/estado-cuenta";
import { derivarSaldoTienda } from "@/lib/utils/saldo-tienda";

import { HAY_BASE_DE_DATOS, crearPrismaDeTest } from "./_postgres-real";
import { cargarCatalogo459, enTransaccionRevertida459, montarServicios459 } from "./_fixtures/caja-459";
import { T4, leerEstadoCuenta, montarEstadoCuenta, sembrarEscenario458 } from "./_fixtures/wallet-458";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 458-D (servidor) — el ESTADO DE CUENTA ampliado, contra Postgres (lección «probar el WHERE
// donde vive»: cada filtro nuevo se mide sobre la base, no sobre un doble).
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
//  · R10/R12 — el filtro por cierre: solo las filas que nacen de ESE cierre y de ESTA cuenta. Un
//    cierre compartido por dos tiendas (el cierre mezcla tiendas) no cruza filas; un cierre de otra
//    cuenta da 0 filas; en una bodega o sin forma de id, `validation_error`. El corrido de las filas
//    filtradas es el de la cuenta ENTERA (R21).
//  · R6–R8 — el origen con entidad: el cierre con su mensajero y el enlace (oficina); la tienda, sin
//    el mensajero ni el enlace al cierre.
//  · Método y referencia de los documentos de pago; `null` en el contra-asiento.
//  · R34/R36 — `/mi-wallet`: el MISMO extracto que la oficina, acotado a la sesión; lo ajeno responde
//    igual que lo inexistente (cero filas), y ninguna clave de cuenta pasa el borde.
//  · R22 — el saldo corrido de la última fila = la tarjeta = `derivarSaldoTienda` sobre la base = el
//    saldo de la tienda por `verMiSaldo`.
//  · TD.6/R32 — el periodo entero con el tope en el servidor (se baja a 5 para medirlo).

const tope = vi.hoisted(() => ({ valor: 0 }));
vi.mock("@/lib/config/descarga", async (original) => {
  const real = await original<typeof import("@/lib/config/descarga")>();
  tope.valor = real.descargaConfig.MAX_FILAS;
  return {
    ...real,
    descargaConfig: new Proxy(real.descargaConfig, {
      get: (objetivo, prop, receptor) => (prop === "MAX_FILAS" ? tope.valor : Reflect.get(objetivo, prop, receptor)),
    }),
  };
});

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;
const FORMA_UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

interface Medida {
  ids: {
    c: Record<"c1" | "c2" | "c3" | "c4" | "c5" | "c6" | "c7", string>;
    m: Record<"m1" | "m2", string>;
    d1: string;
    pagoPorCuentaMov: string;
  };
  cierreReal: string;
  mensajeroNombre: string;
  oficina: {
    enteroC: EstadoCuentaDTO;
    cierreCompartidoC: EstadoCuentaDTO;
    cierreRealC: EstadoCuentaDTO;
    cierreAjenoC: EstadoCuentaDTO;
    cierreM1: EstadoCuentaDTO;
    bodegaConCierre: VerEstadoCuentaResult;
    cierreSinForma: VerEstadoCuentaResult;
  };
  tienda: {
    enteroC: EstadoCuentaDTO;
    enteroD: EstadoCuentaDTO;
    cierreRealD: EstadoCuentaDTO;
    cierreCompartidoD: EstadoCuentaDTO;
    respuestas: Record<string, VerEstadoCuentaResult>;
  };
  cuadre: { creditos: string; debitos: string; verMiSaldo: string };
  completo: Record<string, VerEstadoCuentaCompletoResult>;
}

describeSiHayBase("458-D servidor — el estado de cuenta ampliado contra Postgres (R10/R12, R6–R8, R22, R32, R34/R36)", () => {
  let prisma: PrismaClient;
  let medida: Medida | undefined;
  let fallo: unknown;

  function m(): Medida {
    if (fallo !== undefined) throw fallo;
    if (medida === undefined) throw new Error("la medida no llego a tomarse");
    return medida;
  }

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    const cat = await cargarCatalogo459(prisma);
    try {
      medida = await enTransaccionRevertida459(prisma, async (tx) => {
        const s = montarServicios459(tx);
        const esc = await sembrarEscenario458(tx, cat);
        const ec = montarEstadoCuenta(s);
        const sufijo = randomUUID().slice(0, 8);

        // ── Lo que añade esta medida al escenario de la 458 ─────────────────────────────────
        // Un cierre REAL del mensajero M, compartido por la tienda C (c7) y una tienda D nueva (d1):
        // el cierre mezcla tiendas, y el filtro no puede cruzarlas.
        const cierreReal = randomUUID();
        await tx.cierreDia.create({
          data: {
            id: cierreReal,
            mensajeroId: esc.mensajeroM,
            estado: "aprobado",
            destinoTipo: "bodega_central",
            destinoZonaId: cat.centralZonaId,
            solicitadoAt: T4,
          },
        });
        const tiendaD = (
          await tx.usuario.create({
            data: {
              nombre: `TiendaD 458d ${sufijo}`,
              email: `tiendad-458d-${sufijo}@example.test`,
              telefono: "88880000",
              passwordHash: "no-se-usa",
              cedula: `458d-D-${sufijo}`,
              tipoIdentificacionId: cat.tipoIdentificacionId,
              rolId: cat.rolId.adminTienda,
              estado: "activo",
              fulfillment: false,
            },
            select: { id: true },
          })
        ).id;
        const c7 = randomUUID();
        const d1 = randomUUID();
        for (const [id, tiendaId, monto] of [
          [c7, esc.tiendaC, "700.00"],
          [d1, tiendaD, "900.00"],
        ] as const) {
          await tx.walletTiendaMovimiento.create({
            data: {
              id,
              tiendaId,
              tipo: "credito",
              categoria: "cod_recaudado",
              monto,
              origenTipo: "cierre_dia",
              origenId: cierreReal,
              descripcion: "458d cod del cierre real",
              registradoPor: null,
              fechaMovimiento: new Date(T4.getTime() + 10_000),
              createdAt: new Date(T4.getTime() + 10_000),
            },
          });
        }
        const pagoPorCuentaMov = await tx.walletTiendaMovimiento.findFirstOrThrow({
          where: { tiendaId: esc.tiendaC, categoria: "pago_por_cuenta" },
          select: { id: true },
        });
        const mensajero = await tx.usuario.findUniqueOrThrow({ where: { id: esc.mensajeroM }, select: { nombre: true } });
        // El cierre de M del escenario de la 458 (origen de m1/m2): no tiene NINGUNA fila de la tienda C.
        const cierreM1 = (
          await tx.pagoMensajeroMovimiento.findUniqueOrThrow({ where: { id: esc.filasM.m1 }, select: { origenId: true } })
        ).origenId as string;
        // El cierre de la tienda C del escenario (origen de c1/c2/c4; sin fila en `cierre_dia`).
        const cierreC = (
          await tx.walletTiendaMovimiento.findUniqueOrThrow({ where: { id: esc.filasC.c1 }, select: { origenId: true } })
        ).origenId as string;
        await tx.walletTiendaMovimiento.create({
          data: {
            id: randomUUID(),
            tiendaId: tiendaD,
            tipo: "credito",
            categoria: "cod_recaudado",
            monto: "50.00",
            origenTipo: "cierre_dia",
            origenId: cierreC, // la tienda D tambien sale en el cierre de la C
            descripcion: "458d cod de D en el cierre de C",
            registradoPor: null,
            fechaMovimiento: T4,
            createdAt: T4,
          },
        });

        const tiendaC: Actor = { usuarioId: esc.tiendaC, rol: "adminTienda" };
        const tiendaDActor: Actor = { usuarioId: tiendaD, rol: "adminTienda" };
        const cuentaC = { tipo: "tienda" as const, id: esc.tiendaC };
        const oficina = (input: Parameters<typeof leerEstadoCuenta>[2]) => leerEstadoCuenta(ec, esc.maestro, input);
        const deLaTienda = async (actor: Actor, input: Record<string, unknown> = {}) => {
          const r = await ec.leerMiTienda({ page: 1, pageSize: 50, ...input }, actor);
          if (r.status !== "ok") throw new Error(`mi estado de cuenta: ${JSON.stringify(r)}`);
          return r.estado;
        };
        const accionTienda = (input: unknown, actor: Actor | null) =>
          verMiEstadoCuentaAction(input, { getActor: async () => actor, service: ec });

        // El saldo de la tienda C por un camino INDEPENDIENTE del estado de cuenta.
        const grupos = await tx.walletTiendaMovimiento.groupBy({
          by: ["tipo"],
          where: { tiendaId: esc.tiendaC },
          _sum: { monto: true },
        });
        const suma = (tipo: string) => (grupos.find((g) => g.tipo === tipo)?._sum.monto ?? 0).toString();
        const miSaldo = await s.walletTienda.verMiSaldo(tiendaC);
        if (miSaldo.status !== "ok") throw new Error("verMiSaldo no respondio ok");

        const medidaParcial = {
          ids: {
            c: { ...esc.filasC, c7 },
            m: { m1: esc.filasM.m1, m2: esc.filasM.m2 },
            d1,
            pagoPorCuentaMov: pagoPorCuentaMov.id,
          },
          cierreReal,
          mensajeroNombre: mensajero.nombre,
          oficina: {
            enteroC: await oficina({ cuenta: cuentaC }),
            cierreCompartidoC: await oficina({ cuenta: cuentaC, cierreId: cierreC }),
            cierreRealC: await oficina({ cuenta: cuentaC, cierreId: cierreReal }),
            cierreAjenoC: await oficina({ cuenta: cuentaC, cierreId: cierreM1 }),
            cierreM1: await oficina({ cuenta: { tipo: "mensajero", id: esc.mensajeroM }, cierreId: cierreM1 }),
            bodegaConCierre: await verEstadoCuentaAction(
              { cuenta: { tipo: "bodega", id: esc.zonaZ }, cierreId: cierreReal },
              { getActor: async () => esc.maestro, service: ec },
            ),
            cierreSinForma: await verEstadoCuentaAction(
              { cuenta: cuentaC, cierreId: "' OR 1=1 --" },
              { getActor: async () => esc.maestro, service: ec },
            ),
          },
          tienda: {
            enteroC: await deLaTienda(tiendaC),
            enteroD: await deLaTienda(tiendaDActor),
            cierreRealD: await deLaTienda(tiendaDActor, { cierreId: cierreReal }),
            cierreCompartidoD: await deLaTienda(tiendaDActor, { cierreId: cierreC }),
            respuestas: {
              propia: await accionTienda({}, tiendaC),
              conCuenta: await accionTienda({ cuenta: cuentaC }, tiendaDActor),
              conTiendaId: await accionTienda({ tiendaId: esc.tiendaC }, tiendaDActor),
              maestro: await accionTienda({}, esc.maestro),
              mensajero: await accionTienda({}, { usuarioId: esc.mensajeroM, rol: "mensajero" }),
              sinSesion: await accionTienda({}, null),
            },
          },
          cuadre: { creditos: suma("credito"), debitos: suma("debito"), verMiSaldo: miSaldo.saldo.saldo },
        };

        // TD.6/R32 — el tope del archivo, bajado a 5 SOLO para estas lecturas.
        const topeReal = tope.valor;
        tope.valor = 5;
        const completoOficina = (input: unknown) =>
          verEstadoCuentaCompletoAction(input, { getActor: async () => esc.maestro, service: ec });
        const completoTienda = (input: unknown) =>
          verMiEstadoCuentaCompletoAction(input, { getActor: async () => tiendaC, service: ec });
        const completo = {
          oficinaEntero: await completoOficina({ cuenta: cuentaC }),
          oficinaCierres: await completoOficina({ cuenta: cuentaC, chip: "cierres" }),
          oficinaConPagina: await completoOficina({ cuenta: cuentaC, page: 1 }),
          tiendaEntero: await completoTienda({}),
          tiendaCierreReal: await completoTienda({ cierreId: cierreReal }),
          tiendaConCuenta: await completoTienda({ cuenta: cuentaC }),
        };
        tope.valor = topeReal;

        return { ...medidaParcial, completo };
      });
    } catch (error) {
      fallo = error;
    }
  }, 300_000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  const idDe = (f: FilaEstadoCuentaDTO) => (f.ref !== null && "movimientoId" in f.ref ? f.ref.movimientoId : "");

  it("R10/R12: el cierre compartido por dos tiendas trae SOLO las filas de ESTA tienda que nacen de ese cierre", () => {
    const { ids, oficina } = m();
    expect(oficina.cierreCompartidoC.filas.map(idDe)).toEqual([ids.c.c1, ids.c.c2, ids.c.c4]);
    expect(oficina.cierreCompartidoC.total).toBe(3);
    expect(oficina.cierreRealC.filas.map(idDe)).toEqual([ids.c.c7]);
    // No-vacuidad: la fila de D en ese cierre EXISTE y la ve D.
    expect(m().tienda.cierreRealD.filas.map(idDe)).toEqual([ids.d1]);
  });

  it("R12: un cierre de otra cuenta no devuelve ninguna fila; en el mensajero, su cierre trae sus dos filas", () => {
    const { ids, oficina } = m();
    expect(oficina.cierreAjenoC.filas).toEqual([]);
    expect(oficina.cierreAjenoC.total).toBe(0);
    expect(oficina.cierreM1.filas.map(idDe)).toEqual([ids.m.m1, ids.m.m2]);
  });

  it("R21: el corrido de las filas filtradas por cierre es el de la cuenta ENTERA", () => {
    const { oficina } = m();
    const corridoEntero = new Map(oficina.enteroC.filas.map((f) => [idDe(f), f.saldoCorrido]));
    for (const f of [...oficina.cierreCompartidoC.filas, ...oficina.cierreRealC.filas]) {
      expect(f.saldoCorrido).toBe(corridoEntero.get(idDe(f)));
    }
    // Y las tarjetas no cambian con el filtro: son del periodo.
    expect(oficina.cierreCompartidoC.saldoActual).toBe(oficina.enteroC.saldoActual);
    expect(oficina.cierreCompartidoC.abonos).toBe(oficina.enteroC.abonos);
  });

  it("R10/R12: cierre en una bodega o sin forma de id → validation_error sin filas", () => {
    const { oficina } = m();
    expect(oficina.bodegaConCierre.status).toBe("validation_error");
    expect(oficina.cierreSinForma.status).toBe("validation_error");
    expect("estado" in oficina.bodegaConCierre).toBe(false);
  });

  it("R6/R7: en la oficina, la fila del cierre real nombra al mensajero y enlaza al cierre con el id SOLO en la direccion", () => {
    const { ids, oficina, cierreReal, mensajeroNombre } = m();
    const c7 = oficina.enteroC.filas.find((f) => idDe(f) === ids.c.c7);
    expect(c7?.origen?.texto).toContain(mensajeroNombre);
    expect(c7?.origen?.texto).not.toMatch(FORMA_UUID);
    expect(c7?.origen?.enlace?.href).toContain(cierreReal);
    expect(c7?.origen?.enlace?.etiqueta).not.toMatch(FORMA_UUID);
    // Toda fila de la tienda lleva origen (ninguna cae a `null`).
    expect(oficina.enteroC.filas.every((f) => f.origen !== null && f.origen.texto.trim() !== "")).toBe(true);
  });

  it("R8: la tienda ve el mismo origen SIN el mensajero y SIN enlace al cierre (no accede a esa pantalla)", () => {
    const { ids, tienda, mensajeroNombre } = m();
    const c7 = tienda.enteroC.filas.find((f) => idDe(f) === ids.c.c7);
    expect(c7?.origen).not.toBeNull();
    expect(c7?.origen?.texto).not.toContain(mensajeroNombre);
    expect(c7?.origen?.enlace).toBeNull();
  });

  it("metodo y referencia del documento de pago en su fila; `null` en el contra-asiento y en el cierre", () => {
    const { ids, oficina } = m();
    const fila = (id: string) => oficina.enteroC.filas.find((f) => idDe(f) === id);
    expect(fila(ids.pagoPorCuentaMov)?.pago).toEqual({ metodo: "SINPE", referencia: "INV-458" });
    expect(fila(ids.c.c5)?.pago).toEqual({ metodo: "efectivo", referencia: null });
    expect(fila(ids.c.c5)?.origen?.texto).toContain(METODO_LABEL.efectivo);
    expect(fila(ids.c.c6)?.pago).toBeNull();
    expect(fila(ids.c.c1)?.pago).toBeNull();
  });

  it("R34: /mi-wallet lee el MISMO extracto que la oficina (mismas filas, mismo corrido, mismas tarjetas)", () => {
    const { tienda, oficina } = m();
    expect(tienda.enteroC.filas.map((f) => `${idDe(f)}|${f.saldoCorrido}|${f.cargo}|${f.abono}|${f.chip}`)).toEqual(
      oficina.enteroC.filas.map((f) => `${idDe(f)}|${f.saldoCorrido}|${f.cargo}|${f.abono}|${f.chip}`),
    );
    expect([tienda.enteroC.saldoActual, tienda.enteroC.saldoInicial, tienda.enteroC.abonos, tienda.enteroC.cargos]).toEqual([
      oficina.enteroC.saldoActual,
      oficina.enteroC.saldoInicial,
      oficina.enteroC.abonos,
      oficina.enteroC.cargos,
    ]);
    expect(tienda.enteroC.filas.length).toBe(8);
  });

  it("R22: corrido de la ultima fila = tarjeta = derivarSaldoTienda sobre la base = verMiSaldo", () => {
    const { tienda, cuadre } = m();
    const ultima = tienda.enteroC.filas[tienda.enteroC.filas.length - 1];
    const derivado = derivarSaldoTienda(cuadre.creditos, cuadre.debitos).saldo;
    expect(ultima.saldoCorrido).toBe(tienda.enteroC.saldoActual);
    expect(tienda.enteroC.saldoActual).toBe(derivado);
    expect(tienda.enteroC.saldoActual).toBe(cuadre.verMiSaldo);
    expect(tienda.enteroC.saldoFinal).toBe(derivado);
  });

  it("R35/D2: la tienda no ve nombres de la gente de Ordenex ni «Anular…»; conserva el motivo y el dia de la anulacion", () => {
    const { tienda, ids } = m();
    for (const f of tienda.enteroC.filas) {
      expect(f.registro).toEqual({ nombre: null, automatico: null });
      expect(f.anulable).toBe(false);
    }
    const c5 = tienda.enteroC.filas.find((f) => idDe(f) === ids.c.c5);
    expect(c5?.anulacion).toMatchObject({ motivo: "Pago a la cuenta equivocada 458", por: null });
    expect(c5?.anulacion?.fecha).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // R25 en /mi-wallet (decision del leader, revision m3): tambien la HORA de Costa Rica, sin el nombre.
    expect(c5?.anulacion?.hora).toMatch(/^\d{2}:\d{2}$/);
  });

  it("R36: lo ajeno responde igual que lo inexistente — la tienda D no ve una sola fila de la C, ni por el cierre compartido", () => {
    const { tienda, ids } = m();
    const deC = new Set(Object.values(ids.c));
    expect(tienda.enteroD.filas.some((f) => deC.has(idDe(f)))).toBe(false);
    expect(tienda.enteroD.total).toBe(2);
    expect(tienda.cierreCompartidoD.filas.length).toBe(1);
    expect(tienda.cierreCompartidoD.filas.some((f) => deC.has(idDe(f)))).toBe(false);
  });

  it("R36: ninguna clave de cuenta pasa el borde; solo adminTienda lee; sin sesion unauthenticated", () => {
    const r = m().tienda.respuestas;
    expect(r.propia.status).toBe("ok");
    expect(r.conCuenta.status).toBe("validation_error");
    expect(r.conTiendaId.status).toBe("validation_error");
    expect(r.maestro).toEqual({ status: "forbidden" });
    expect(r.mensajero).toEqual({ status: "forbidden" });
    expect(r.sinSesion).toEqual({ status: "unauthenticated" });
  });

  it("TD.6/R32: por encima del tope, limite_excedido con SOLO los conteos; por debajo, el periodo ENTERO", () => {
    const { completo, oficina, ids } = m();
    expect(completo.oficinaEntero).toEqual({ status: "limite_excedido", total: 8, limite: 5 });
    expect(completo.tiendaEntero).toEqual({ status: "limite_excedido", total: 8, limite: 5 });
    const cierres = completo.oficinaCierres;
    if (cierres.status !== "ok") throw new Error(`se esperaba ok: ${JSON.stringify(cierres)}`);
    expect(cierres.estado.filas.map(idDe)).toEqual(
      oficina.enteroC.filas.filter((f) => f.chip === "cierres").map(idDe),
    );
    expect(cierres.estado.total).toBe(4);
    expect(cierres.estado.pageSize).toBe(4);
    const real = completo.tiendaCierreReal;
    if (real.status !== "ok") throw new Error("se esperaba ok");
    expect(real.estado.filas.map(idDe)).toEqual([ids.c.c7]);
    // El modo completo no pagina ni nombra una cuenta desde la tienda.
    expect(completo.oficinaConPagina.status).toBe("validation_error");
    expect(completo.tiendaConCuenta.status).toBe("validation_error");
  });
});
