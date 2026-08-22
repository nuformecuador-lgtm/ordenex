import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  AHORA,
  FECHA_CR,
  IMPORTE_CENTINELA_TARIFA,
  VENTANA,
  crearGestion,
  crearOrden,
  crearTarifaActiva,
  instanteCR,
  repositorio,
  sembrarBase,
  servicioReal,
  transicionDeRecoleccion,
} from "./_semilla-tablero-dia";
import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
} from "./db/_postgres-real";

// Feature 192 (B7.7) — R41, R42.
//
// El detalle es la SEGUNDA puerta a las mismas filas. Un adminSatelite que pida el detalle de
// un mensajero con ordenes en dos zonas tiene que recibir SOLO las de la suya, y las demas no
// pueden asomar "ni por conteo, ni por paginacion, ni por mensaje de error": si el `total`
// dijera 3 y las filas fueran 1, el conteo seria el oraculo que R41 prohibe.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const PAGINA = { pagina: 1, pageSize: 25 };

describeSiHayBase("detalle del mensajero — aislamiento (Postgres real)", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("un satelite recibe SOLO las ordenes de su zona, y el total tampoco delata las otras (R41)", async () => {
    const resultado = await enTransaccionRevertida(prisma, async (tx) => {
      const base = await sembrarBase(tx);
      for (const [clave, zonaId] of [
        ["a1", base.zonaA],
        ["a2", base.zonaA],
        ["b1", base.zonaB],
        ["b2", base.zonaB],
        ["b3", base.zonaB],
      ] as const) {
        await crearOrden(tx, base, {
          clave,
          estatus: "en_reparto",
          zonaId,
          mensajeroId: base.mensajero1,
          asignadoAt: instanteCR(FECHA_CR, "07:00"),
        });
      }

      const repo = repositorio(tx);
      return {
        deA: await repo.listarOrdenesDelDia(
          VENTANA,
          { tipo: "zona", zonaId: base.zonaA },
          base.mensajero1,
          PAGINA,
        ),
        deB: await repo.listarOrdenesDelDia(
          VENTANA,
          { tipo: "zona", zonaId: base.zonaB },
          base.mensajero1,
          PAGINA,
        ),
        global: await repo.listarOrdenesDelDia(VENTANA, { tipo: "global" }, base.mensajero1, PAGINA),
      };
    });

    expect(resultado.deA.filas).toHaveLength(2);
    expect(resultado.deA.total).toBe(2);
    expect(resultado.deB.filas).toHaveLength(3);
    expect(resultado.deB.total).toBe(3);
    expect(resultado.global.total).toBe(5);
  });

  it("un mensajero inexistente y uno fuera de alcance devuelven exactamente lo mismo: vacio (R42)", async () => {
    const resultado = await enTransaccionRevertida(prisma, async (tx) => {
      const base = await sembrarBase(tx);
      // `mensajero2` SI existe y tiene ordenes, pero de la zona B.
      await crearOrden(tx, base, {
        clave: "de-b",
        estatus: "en_reparto",
        zonaId: base.zonaB,
        mensajeroId: base.mensajero2,
        asignadoAt: instanteCR(FECHA_CR, "07:00"),
      });

      const repo = repositorio(tx);
      const alcanceA = { tipo: "zona", zonaId: base.zonaA } as const;
      return {
        inexistente: await repo.listarOrdenesDelDia(
          VENTANA,
          alcanceA,
          "no-existe-este-id",
          PAGINA,
        ),
        fueraDeAlcance: await repo.listarOrdenesDelDia(
          VENTANA,
          alcanceA,
          base.mensajero2,
          PAGINA,
        ),
        sinOrdenesHoy: await repo.listarOrdenesDelDia(
          VENTANA,
          alcanceA,
          base.mensajero1,
          PAGINA,
        ),
      };
    });

    const vacio = { filas: [], total: 0 };
    expect(resultado.inexistente).toEqual(vacio);
    expect(resultado.fueraDeAlcance).toEqual(vacio);
    expect(resultado.sinOrdenesHoy).toEqual(vacio);
  });

  it("el detalle no muestra las ordenes de OTRO mensajero de la misma zona (R47)", async () => {
    const resultado = await enTransaccionRevertida(prisma, async (tx) => {
      const base = await sembrarBase(tx);
      const deAna = await crearOrden(tx, base, {
        clave: "de-ana",
        estatus: "en_reparto",
        mensajeroId: base.mensajero1,
        asignadoAt: instanteCR(FECHA_CR, "07:00"),
      });
      await crearOrden(tx, base, {
        clave: "de-beto",
        estatus: "en_reparto",
        mensajeroId: base.mensajero2,
        asignadoAt: instanteCR(FECHA_CR, "07:00"),
      });

      return {
        deAna,
        pagina: await repositorio(tx).listarOrdenesDelDia(
          VENTANA,
          { tipo: "global" },
          base.mensajero1,
          PAGINA,
        ),
      };
    });

    expect(resultado.pagina.total).toBe(1);
    // FEATURE 260 — esta consulta ya no proyecta el destinatario: identifica la fila por su id,
    // que es lo unico que decide (quien entra). El nombre lo trae despues la hidratacion.
    expect(resultado.pagina.filas.map((f) => f.ordenId)).toEqual([resultado.deAna]);
  });

  it("las ordenes del dia ANTERIOR no aparecen en el detalle de hoy (R47)", async () => {
    const resultado = await enTransaccionRevertida(prisma, async (tx) => {
      const base = await sembrarBase(tx);
      await crearOrden(tx, base, {
        clave: "de-ayer",
        estatus: "en_reparto",
        mensajeroId: base.mensajero1,
        asignadoAt: instanteCR("2001-06-14", "23:00"),
      });
      return repositorio(tx).listarOrdenesDelDia(
        VENTANA,
        { tipo: "global" },
        base.mensajero1,
        PAGINA,
      );
    });

    expect(resultado).toEqual({ filas: [], total: 0 });
  });

  it("trae el resultado del dia de cada orden y el estatus crudo, sin inventar etiquetas (R49)", async () => {
    const resultado = await enTransaccionRevertida(prisma, async (tx) => {
      const base = await sembrarBase(tx);
      const entregada = await crearOrden(tx, base, {
        clave: "entregada",
        estatus: "entregada",
        mensajeroId: base.mensajero1,
        asignadoAt: instanteCR(FECHA_CR, "07:00"),
      });
      // Dos gestiones: gana la ULTIMA vigente, igual que en la tarjeta.
      await crearGestion(tx, {
        ordenId: entregada,
        mensajeroId: base.mensajero1,
        resultado: "reprogramada",
        at: instanteCR(FECHA_CR, "09:00"),
      });
      await crearGestion(tx, {
        ordenId: entregada,
        mensajeroId: base.mensajero1,
        resultado: "entregada",
        at: instanteCR(FECHA_CR, "13:00"),
      });
      const pendiente = await crearOrden(tx, base, {
        clave: "pendiente",
        estatus: "por_recoger",
        mensajeroId: base.mensajero1,
        asignadoAt: instanteCR(FECHA_CR, "08:00"),
      });

      return {
        entregada,
        pendiente,
        pagina: await repositorio(tx).listarOrdenesDelDia(
          VENTANA,
          { tipo: "global" },
          base.mensajero1,
          PAGINA,
        ),
      };
    });

    expect(resultado.pagina.total).toBe(2);
    // Orden determinista: `asignado_at` DESC. La de las 08:00 (la pendiente) va primero.
    expect(resultado.pagina.filas.map((f) => f.ordenId)).toEqual([
      resultado.pendiente,
      resultado.entregada,
    ]);
    // FEATURE 260 — el ESTATUS ya no sale de aqui (lo trae la hidratacion, con el mismo mapeo
    // que el listado). Lo que esta consulta sigue decidiendo, y por eso se sigue afirmando, es
    // el RESULTADO DEL DIA: la ultima gestion vigente de la ventana, con dos gestiones de por
    // medio y ganando la mas reciente.
    expect(resultado.pagina.filas.map((f) => f.resultadoDelDia)).toEqual([null, "entregada"]);
  });

  it("una orden del camino de RECOLECCION aparece en el detalle con un asignadoAt util (R57)", async () => {
    const resultado = await enTransaccionRevertida(prisma, async (tx) => {
      const base = await sembrarBase(tx);
      const orden = await crearOrden(tx, base, {
        clave: "recolectada",
        estatus: "recolectando",
        mensajeroId: base.mensajero1,
        asignadoAt: null,
      });
      await transicionDeRecoleccion(tx, base, orden, instanteCR(FECHA_CR, "08:00"));

      return repositorio(tx).listarOrdenesDelDia(
        VENTANA,
        { tipo: "global" },
        base.mensajero1,
        PAGINA,
      );
    });

    expect(resultado.total).toBe(1);
    // `asignado_at` es NULL en la base (R59: no se estampa). El detalle cae al instante de la
    // transicion, que es cuando la orden paso de verdad a manos del mensajero.
    expect(resultado.filas[0].asignadoAt).toBe(instanteCR(FECHA_CR, "08:00").toISOString());
  });

  it("la paginacion recorta la pagina pero no el total (R55)", async () => {
    const resultado = await enTransaccionRevertida(prisma, async (tx) => {
      const base = await sembrarBase(tx);
      for (let i = 0; i < 5; i += 1) {
        await crearOrden(tx, base, {
          clave: `p${i}`,
          estatus: "en_reparto",
          mensajeroId: base.mensajero1,
          asignadoAt: instanteCR(FECHA_CR, `0${7 + i}:00`),
        });
      }
      const repo = repositorio(tx);
      return {
        primera: await repo.listarOrdenesDelDia(VENTANA, { tipo: "global" }, base.mensajero1, {
          pagina: 1,
          pageSize: 2,
        }),
        tercera: await repo.listarOrdenesDelDia(VENTANA, { tipo: "global" }, base.mensajero1, {
          pagina: 3,
          pageSize: 2,
        }),
      };
    });

    expect(resultado.primera.filas).toHaveLength(2);
    expect(resultado.primera.total).toBe(5);
    expect(resultado.tercera.filas).toHaveLength(1);
    expect(resultado.tercera.total).toBe(5);
  });
});

// FEATURE 260 (B8) — EL AISLAMIENTO, YA HIDRATADO Y DE EXTREMO A EXTREMO.
//
// Los casos de arriba miden el repositorio. Estos miden el SERVICIO REAL contra Postgres: la
// consulta del dia, la hidratacion por el camino del listado de ordenes, los intentos y el
// recorte por alcance, todo junto. Es el unico sitio donde se puede afirmar a la vez que el
// satelite ve SOLO lo suyo y que lo que ve NO TRAE el dinero que su rol no puede ver.
//
// Por que hace falta ademas de los tests de servicio con dobles: un doble no ve el SQL, y las
// dos mitades de esta feature que pueden fallar en silencio son dos `WHERE`.
describeSiHayBase("detalle del mensajero — hidratado y recortado (Postgres real)", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Siembra un mensajero con ordenes en las DOS zonas y una tarifa activa en su tienda. */
  async function sembrarDosZonas(tx: Parameters<typeof sembrarBase>[0]) {
    const base = await sembrarBase(tx);
    await crearTarifaActiva(tx, base);
    for (const [clave, zonaId] of [
      ["a1", base.zonaA],
      ["a2", base.zonaA],
      ["b1", base.zonaB],
    ] as const) {
      await crearOrden(tx, base, {
        clave,
        estatus: "en_reparto",
        zonaId,
        mensajeroId: base.mensajero1,
        montoCobrar: "54321.00",
        asignadoAt: instanteCR(FECHA_CR, "07:00"),
      });
    }
    return base;
  }

  it("un satelite de la zona A recibe SOLO las ordenes de A, ya hidratadas (R11)", async () => {
    const detalle = await enTransaccionRevertida(prisma, async (tx) => {
      const base = await sembrarDosZonas(tx);
      const resultado = await servicioReal(tx).detalle(
        { usuarioId: base.maestro, rol: "adminSatelite", zonaId: base.zonaA },
        AHORA,
        base.mensajero1,
      );
      if (resultado.estado !== "ok") throw new Error(`se esperaba ok, llego ${resultado.motivo}`);
      return resultado.detalle;
    });

    expect(detalle.alcance).toBe("zona");
    expect(detalle.total).toBe(2);
    expect(detalle.ordenes).toHaveLength(2);
    // HIDRATADAS: traen los campos del elemento del listado, que la consulta del dia ya no
    // proyecta. Si la hidratacion no se hubiera ejecutado, esto vendria `undefined`.
    expect(detalle.ordenes.map((o) => o.destinatario).sort()).toEqual([
      "Cliente a1",
      "Cliente a2",
    ]);
    expect(detalle.ordenes.every((o) => o.relaciones?.tienda?.nombre === "Tienda")).toBe(true);
    expect(detalle.ordenes.every((o) => o.intentosEntrega === 0)).toBe(true);
  });

  it("y lo que recibe NO TRAE ninguno de los cinco campos restringidos (R13)", async () => {
    const payloads = await enTransaccionRevertida(prisma, async (tx) => {
      const base = await sembrarDosZonas(tx);
      const servicio = servicioReal(tx);
      const leer = async (rol: string, zonaId: string | null) => {
        const resultado = await servicio.detalle(
          { usuarioId: base.maestro, rol, zonaId },
          AHORA,
          base.mensajero1,
        );
        if (resultado.estado !== "ok") throw new Error(`se esperaba ok, llego ${resultado.motivo}`);
        return resultado.detalle;
      };
      return {
        deZona: await leer("adminSatelite", base.zonaA),
        global: await leer("maestro", null),
      };
    });

    const jsonZona = JSON.stringify(payloads.deZona);
    // El importe de la tarifa es irrepetible: si viaja la tarifa, viaja el.
    expect(jsonZona).not.toContain(IMPORTE_CENTINELA_TARIFA);
    expect(jsonZona).not.toContain("@f192.local"); // el correo de la tienda sembrada
    expect(jsonZona).not.toContain("88880000"); // su telefono
    for (const orden of payloads.deZona.ordenes) {
      expect(orden.fleteConIva).toBeUndefined();
      expect(orden.comisionConIva).toBeUndefined();
      expect(orden.relaciones?.tienda?.tarifa).toBeNull();
      expect(orden.relaciones?.tienda?.email).toBeUndefined();
      expect(orden.relaciones?.tienda?.telefono).toBeUndefined();
      // R17 — el monto a cobrar SI, en los dos alcances.
      expect(orden.montoCobrar).toBe(54321);
    }

    // ⛔ Y LA MITAD QUE IMPIDE QUE ESTO SEA VERDE POR VACIO: en alcance `global` los cinco SI
    // viajan. Sin esta comprobacion, una hidratacion que no trajera nunca la tarifa —o una
    // siembra sin tarifa activa— dejaria el bloque de arriba verde sin haber retirado nada.
    const jsonGlobal = JSON.stringify(payloads.global);
    expect(jsonGlobal).toContain(IMPORTE_CENTINELA_TARIFA);
    expect(jsonGlobal).toContain("@f192.local");
    expect(jsonGlobal).toContain("88880000");
    expect(payloads.global.ordenes.every((o) => o.fleteConIva !== undefined)).toBe(true);
    expect(payloads.global.ordenes.every((o) => o.comisionConIva !== undefined)).toBe(true);
    expect(payloads.global.total).toBe(3);
  });
});
