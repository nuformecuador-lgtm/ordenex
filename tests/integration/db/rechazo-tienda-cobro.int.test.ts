import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { RechazoTiendaCobroRepository } from "@/lib/repositories/RechazoTiendaCobroRepository";
import { WalletMovimientoRepository } from "@/lib/repositories/WalletMovimientoRepository";
import { WalletTiendaMovimientoRepository } from "@/lib/repositories/WalletTiendaMovimientoRepository";
import { RechazoTiendaCobroService } from "@/lib/services/RechazoTiendaCobroService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  fksDeOrden,
  serializarEscriturasReales,
} from "./_postgres-real";

/**
 * 💰 FICHA 337 (segunda mitad, 2026-08-31) — EL COBRO POR RECHAZO DESDE NOVEDADES, EJECUTADO
 * CONTRA POSTGRES.
 *
 * POR QUE CONTRA POSTGRES Y NO CON DOBLES. Las tres garantias que sostienen esta ficha son hechos
 * del MOTOR, no del codigo, y un doble no puede afirmar ninguna:
 *
 *   1. `rechazo_tienda_cobro_gestion_uq` — la UNICIDAD que impide que un mismo rechazo se cobre
 *      dos veces. Es un indice: quitarlo no rompe ni un test de servicio.
 *   2. `UPDATE ... WHERE id AND estado = 'pendiente'` — la SERIALIZACION de dos administradores
 *      que aprueban a la vez. Depende del bloqueo de fila de `READ COMMITTED`, y en un doble el
 *      `0` se elige a mano.
 *   3. Los CHECK (`montos_validos`, `decision_registrada`) — reglas que solo existen en la base.
 *
 * Este repo tiene MEDIDO cuatro veces que una mutacion de un `where` sobrevive en verde por
 * arriba, y una vez que un arnes de mutaciones reporto supervivientes sin haber ejecutado un test.
 * Por eso los tres bloques de abajo estan escritos para PONERSE ROJOS ante una mutacion concreta,
 * y la mutacion esta nombrada en cada uno.
 *
 * SIN BASE ALCANZABLE se SALTA (`describe.skip`), NO pasa en verde: un `return` silencioso dentro
 * del caso se leeria como `passed` sin haber comprobado nada, y este repo ya se comio ese verde.
 * CON base pero SIN catalogo, falla RUIDOSAMENTE.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

/** Sufijo unico por corrida: `num_remision` es UNIQUE. */
const SUFIJO = `c337${Date.now().toString(36)}`;

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

describeSiHayBase("💰 337 — el cobro por rechazo desde novedades, contra Postgres", () => {
  let prisma: PrismaClient;
  let fks: NonNullable<Awaited<ReturnType<typeof fksDeOrden>>>;
  /** Un usuario cualquiera de la base: sirve de mensajero de la gestion y de actor que decide. */
  let usuarioId: string;
  let n = 0;

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    const encontradas = await fksDeOrden(prisma);
    if (encontradas === null) {
      throw new Error(
        "hay DATABASE_URL pero la tabla `orden` esta vacia: sin FKs no se puede sembrar. " +
          "Corre `pnpm run db:seed` antes de esta suite.",
      );
    }
    fks = encontradas;
    const u = await prisma.usuario.findFirst({ select: { id: true } });
    if (u === null) throw new Error("hace falta al menos UN usuario en la base");
    usuarioId = u.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Una orden + su gestion sintetica `rechazada`, tal como las deja el rechazo de la tienda. */
  async function sembrarRechazo(tx: Tx): Promise<{ ordenId: string; gestionId: string }> {
    const clave = `${SUFIJO}${(n += 1)}`;
    const orden = await tx.orden.create({
      data: {
        numRemision: `R-${clave}`,
        destinatario: "Dest",
        telefonoDest: "88880000",
        producto: "Prod",
        estatusId: fks.estatusId,
        tiendaId: fks.tiendaId,
        zonaId: fks.zonaId,
        provinciaId: fks.provinciaId,
        cantonId: fks.cantonId,
      },
      select: { id: true },
    });
    const gestion = await tx.gestionOrden.create({
      data: {
        ordenId: orden.id,
        mensajeroId: usuarioId,
        resultado: "rechazada",
        cierreId: null, // desde la 337 ningun cierre la recoge: por eso existe esta via
      },
      select: { id: true },
    });
    return { ordenId: orden.id, gestionId: gestion.id };
  }

  /** El input del cobro, con los importes ya derivados (aqui NO se calcula dinero). */
  function inputCobro(
    ids: { ordenId: string; gestionId: string },
    overrides: Partial<{ montoFlete: string; montoIva: string }> = {},
  ) {
    return {
      gestionId: ids.gestionId,
      ordenId: ids.ordenId,
      tiendaId: fks.tiendaId,
      montoFlete: overrides.montoFlete ?? "500.00",
      montoIva: overrides.montoIva ?? "65.00",
      tarifaId: null,
      generadoEl: "2026-08-31",
    };
  }

  // ==========================================================================================
  // BLOQUE 1 — LA CLAVE UNICA: un rechazo, un cobro.
  //
  // ⭑ MUTACION QUE ESTE BLOQUE MATA: borrar
  //   `CREATE UNIQUE INDEX "rechazo_tienda_cobro_gestion_uq"` de la migracion.
  //   Sin ella, `skipDuplicates` no tiene contra que chocar, el segundo alta inserta una SEGUNDA
  //   fila `pendiente` de la misma gestion, y aprobar las dos cobra dos veces a la tienda.
  // ==========================================================================================

  describe("la clave unica por gestion", () => {
    it("⭑ dos altas del MISMO rechazo dejan UNA sola fila (la segunda inserta 0)", async () => {
      const medido = await enTransaccionRevertida(prisma, async (tx) => {
        await serializarEscriturasReales(tx);
        const ids = await sembrarRechazo(tx);
        const repo = new RechazoTiendaCobroRepository(tx as unknown as PrismaClient);

        const primera = await repo.crearPendiente(tx, inputCobro(ids));
        const segunda = await repo.crearPendiente(tx, inputCobro(ids));

        const filas = await tx.rechazoTiendaCobro.findMany({
          where: { gestionId: ids.gestionId },
          select: { id: true, montoFlete: true },
        });
        return {
          primera,
          segunda,
          cuantas: filas.length,
          montos: filas.map((f) => f.montoFlete.toFixed(2)),
        };
      });

      expect(medido.primera).toBe(1);
      expect(medido.segunda).toBe(0); // ON CONFLICT DO NOTHING: sin TOCTOU, lo decide el motor
      expect(medido.cuantas).toBe(1); // ⭑ LA AFIRMACION: una sola fila, un solo cobro
      expect(medido.montos).toEqual(["500.00"]);
    });

    it("⭑ el segundo intento NO pisa los importes del primero", async () => {
      // `skipDuplicates` no es un `upsert`. Si alguien lo cambiara por uno, un reintento con otra
      // tarifa reescribiria un importe ya congelado -- justo lo que el congelado existe para
      // impedir.
      const medido = await enTransaccionRevertida(prisma, async (tx) => {
        await serializarEscriturasReales(tx);
        const ids = await sembrarRechazo(tx);
        const repo = new RechazoTiendaCobroRepository(tx as unknown as PrismaClient);

        await repo.crearPendiente(tx, inputCobro(ids, { montoFlete: "500.00", montoIva: "65.00" }));
        await repo.crearPendiente(tx, inputCobro(ids, { montoFlete: "999.99", montoIva: "130.00" }));

        const fila = await tx.rechazoTiendaCobro.findFirstOrThrow({
          where: { gestionId: ids.gestionId },
          select: { montoFlete: true, montoIva: true },
        });
        return { flete: fila.montoFlete.toFixed(2), iva: fila.montoIva.toFixed(2) };
      });

      expect(medido).toEqual({ flete: "500.00", iva: "65.00" });
    });

    it("⭑ un cobro ya RECHAZADO no se puede volver a dar de alta (el «no» es durable)", async () => {
      // La razon de que el indice sea TOTAL y no parcial (`WHERE estado = 'pendiente'`). Con uno
      // parcial, lo rechazado reaparecia al siguiente intento y el «no» del administrador no
      // significaba nada -- exactamente la alternativa A9 que la 333 descarto por escrito.
      const medido = await enTransaccionRevertida(prisma, async (tx) => {
        await serializarEscriturasReales(tx);
        const ids = await sembrarRechazo(tx);
        const repo = new RechazoTiendaCobroRepository(tx as unknown as PrismaClient);

        await repo.crearPendiente(tx, inputCobro(ids));
        const fila = await tx.rechazoTiendaCobro.findFirstOrThrow({
          where: { gestionId: ids.gestionId },
          select: { id: true },
        });
        await repo.marcarDecidido(tx, fila.id, "rechazado", usuarioId, new Date());

        const reintento = await repo.crearPendiente(tx, inputCobro(ids));
        const filas = await tx.rechazoTiendaCobro.findMany({
          where: { gestionId: ids.gestionId },
          select: { estado: true },
        });
        return { reintento, estados: filas.map((f) => f.estado) };
      });

      expect(medido.reintento).toBe(0);
      expect(medido.estados).toEqual(["rechazado"]);
    });
  });

  // ==========================================================================================
  // BLOQUE 2 — LOS CHECK. Reglas que solo existen en la base.
  //
  // Cada caso abre su PROPIA transaccion: en Postgres una sentencia que falla ABORTA la
  // transaccion entera, asi que dos violaciones seguidas no caben en la misma.
  // ==========================================================================================

  describe("los CHECK de la tabla", () => {
    it("⭑ un cobro con `monto_flete = 0` NO entra (un cobro de cero no es un cobro)", async () => {
      const error = await enTransaccionRevertida(prisma, async (tx) => {
        await serializarEscriturasReales(tx);
        const ids = await sembrarRechazo(tx);
        const repo = new RechazoTiendaCobroRepository(tx as unknown as PrismaClient);
        try {
          await repo.crearPendiente(tx, inputCobro(ids, { montoFlete: "0.00" }));
          return "NO FALLO";
        } catch (e) {
          return String((e as Error).message);
        }
      });

      expect(error).not.toBe("NO FALLO");
      expect(error).toContain("rechazo_tienda_cobro_montos_validos");
    });

    it("un cobro con `monto_iva = 0` SI entra: el cero del IVA es un valor real", async () => {
      // El contraste obligatorio del caso anterior, y la razon de que el CHECK sea
      // `monto_flete > 0 AND monto_iva >= 0` y no `> 0` en las dos columnas.
      const estado = await enTransaccionRevertida(prisma, async (tx) => {
        await serializarEscriturasReales(tx);
        const ids = await sembrarRechazo(tx);
        const repo = new RechazoTiendaCobroRepository(tx as unknown as PrismaClient);
        await repo.crearPendiente(tx, inputCobro(ids, { montoIva: "0.00" }));
        const fila = await tx.rechazoTiendaCobro.findFirstOrThrow({
          where: { gestionId: ids.gestionId },
          select: { estado: true, montoIva: true },
        });
        return { estado: fila.estado, iva: fila.montoIva.toFixed(2) };
      });

      expect(estado).toEqual({ estado: "pendiente", iva: "0.00" });
    });

    it("⭑ una decision SIN `decidido_at` no es escribible ni a mano", async () => {
      // La red de abajo del `marcarDecidido`: si alguien escribiera el estado por otra via y se
      // olvidara del cuando, la fila quedaria diciendo que alguien decidio sin decir cuando.
      const error = await enTransaccionRevertida(prisma, async (tx) => {
        await serializarEscriturasReales(tx);
        const ids = await sembrarRechazo(tx);
        const repo = new RechazoTiendaCobroRepository(tx as unknown as PrismaClient);
        await repo.crearPendiente(tx, inputCobro(ids));
        const fila = await tx.rechazoTiendaCobro.findFirstOrThrow({
          where: { gestionId: ids.gestionId },
          select: { id: true },
        });
        try {
          await tx.rechazoTiendaCobro.update({
            where: { id: fila.id },
            data: { estado: "aprobado" }, // sin `decididoAt`
          });
          return "NO FALLO";
        } catch (e) {
          return String((e as Error).message);
        }
      });

      expect(error).not.toBe("NO FALLO");
      expect(error).toContain("rechazo_tienda_cobro_decision_registrada");
    });
  });

  // ==========================================================================================
  // BLOQUE 3 — LA APROBACION, con CONCURRENCIA REAL.
  //
  // ⭑ MUTACION QUE ESTE BLOQUE MATA: quitar `estado: "pendiente"` del `where` de
  //   `RechazoTiendaCobroRepository.marcarDecidido`. Con el fuera, las cuatro aprobaciones
  //   simultaneas afectan una fila cada una, las cuatro creen haber ganado y ninguna responde
  //   `ya_decidido`; ademas `decidido_por` queda con el ultimo que paso.
  //
  // Este bloque NO usa `enTransaccionRevertida`: la concurrencia solo es real si las
  // transacciones COMMITEAN. Limpia lo suyo en un `finally`.
  // ==========================================================================================

  describe("la aprobacion, con cuatro administradores a la vez", () => {
    const PARALELAS = 4;

    function servicioCon(cliente: PrismaClient) {
      return new RechazoTiendaCobroService(
        new RechazoTiendaCobroRepository(cliente),
        new WalletMovimientoRepository(cliente),
        new WalletTiendaMovimientoRepository(cliente),
        cliente,
        (fn) => cliente.$transaction((tx) => fn(tx)),
        { TIENDA_DEBITA_FLETE_DEVOLUCION: true },
      );
    }

    it("⭑ UNA gana, TRES leen `ya_decidido`, y el dinero se escribe UNA sola vez", async () => {
      const actor: Actor = { usuarioId, rol: "maestro" };
      // Clientes INDEPENDIENTES: cada uno con su pool, que es lo que hace que las cuatro
      // transacciones sean de verdad simultaneas y no cuatro turnos de la misma conexion.
      const clientes = Array.from({ length: PARALELAS }, () => crearPrismaDeTest());

      let ordenId = "";
      let gestionId = "";
      try {
        // ── siembra COMMITEADA ───────────────────────────────────────────────────────────
        const orden = await prisma.orden.create({
          data: {
            numRemision: `R-${SUFIJO}par`,
            destinatario: "Dest",
            telefonoDest: "88880000",
            producto: "Prod",
            estatusId: fks.estatusId,
            tiendaId: fks.tiendaId,
            zonaId: fks.zonaId,
            provinciaId: fks.provinciaId,
            cantonId: fks.cantonId,
          },
          select: { id: true },
        });
        ordenId = orden.id;
        const gestion = await prisma.gestionOrden.create({
          data: { ordenId, mensajeroId: usuarioId, resultado: "rechazada", cierreId: null },
          select: { id: true },
        });
        gestionId = gestion.id;

        await new RechazoTiendaCobroRepository(prisma).crearPendiente(
          prisma,
          inputCobro({ ordenId, gestionId }),
        );
        const cobro = await prisma.rechazoTiendaCobro.findFirstOrThrow({
          where: { gestionId },
          select: { id: true },
        });

        // ── las cuatro aprobaciones, a la vez ────────────────────────────────────────────
        const resultados = await Promise.all(
          clientes.map((c) => servicioCon(c).aprobar({ id: cobro.id }, actor, new Date())),
        );

        const oks = resultados.filter((r) => r.status === "ok");
        const yaDecididos = resultados.filter((r) => r.status === "ya_decidido");

        // ⭑ EXACTAMENTE UNA gana. Con la mutacion puesta, `oks.length` vale 4.
        expect(oks).toHaveLength(1);
        expect(yaDecididos).toHaveLength(PARALELAS - 1);

        // ⭑ Y EL DINERO, que es lo que de verdad importa: dos ingresos en la caja y dos debitos
        // en el libro de la tienda. Ni uno mas.
        const caja = await prisma.walletMovimiento.findMany({
          where: { origenTipo: "gestion_orden", origenId: gestionId },
          select: { tipo: true, categoria: true, monto: true, registradoPor: true },
          orderBy: { categoria: "asc" },
        });
        expect(
          caja.map((m) => ({ ...m, monto: m.monto.toFixed(2) })),
        ).toEqual([
          {
            tipo: "ingreso",
            categoria: "ingreso_flete_devolucion",
            monto: "500.00",
            registradoPor: usuarioId,
          },
          {
            tipo: "ingreso",
            categoria: "ingreso_iva_flete_devolucion",
            monto: "65.00",
            registradoPor: usuarioId,
          },
        ]);

        const libroTienda = await prisma.walletTiendaMovimiento.findMany({
          where: { origenTipo: "gestion_orden", origenId: gestionId },
          select: { tiendaId: true, tipo: true, categoria: true, monto: true },
          orderBy: { categoria: "asc" },
        });
        expect(
          libroTienda.map((m) => ({ ...m, monto: m.monto.toFixed(2) })),
        ).toEqual([
          {
            tiendaId: fks.tiendaId,
            tipo: "debito",
            categoria: "flete_devolucion",
            monto: "500.00",
          },
          {
            tiendaId: fks.tiendaId,
            tipo: "debito",
            categoria: "iva_flete_devolucion",
            monto: "65.00",
          },
        ]);

        // Y la fila del cobro: aprobada, con quien y cuando, una sola vez.
        const final = await prisma.rechazoTiendaCobro.findUniqueOrThrow({
          where: { id: cobro.id },
          select: { estado: true, decididoPor: true, decididoAt: true },
        });
        expect(final.estado).toBe("aprobado");
        expect(final.decididoPor).toBe(usuarioId);
        expect(final.decididoAt).not.toBeNull();
      } finally {
        await Promise.all(clientes.map((c) => c.$disconnect()));
        if (gestionId !== "") {
          await prisma.walletTiendaMovimiento.deleteMany({
            where: { origenTipo: "gestion_orden", origenId: gestionId },
          });
          await prisma.walletMovimiento.deleteMany({
            where: { origenTipo: "gestion_orden", origenId: gestionId },
          });
          await prisma.rechazoTiendaCobro.deleteMany({ where: { gestionId } });
          await prisma.gestionOrden.deleteMany({ where: { id: gestionId } });
        }
        if (ordenId !== "") await prisma.orden.deleteMany({ where: { id: ordenId } });
      }
    }, 60_000);
  });

  // ==========================================================================================
  // BLOQUE 4 — LA FORMA DE LA TABLA EN LA BASE (no en el `.sql`, en la base).
  // ==========================================================================================

  describe("la tabla, tal como quedo aplicada", () => {
    it("tiene RLS habilitada (a estas filas solo se llega por el servidor)", async () => {
      const filas = await prisma.$queryRawUnsafe<Array<{ relrowsecurity: boolean }>>(
        "SELECT relrowsecurity FROM pg_class WHERE relname = 'rechazo_tienda_cobro'",
      );
      expect(filas).toHaveLength(1);
      expect(filas[0].relrowsecurity).toBe(true);
    });

    it("el enum del estado tiene EXACTAMENTE tres valores", async () => {
      // Postgres no permite `DROP VALUE`: un enum de dinero solo se amplia cuando alguien lo
      // escribe. Este `toEqual` es el inventario cerrado.
      const filas = await prisma.$queryRawUnsafe<Array<{ enumlabel: string }>>(
        "SELECT enumlabel FROM pg_enum WHERE enumtypid = 'rechazo_tienda_cobro_estado'::regtype ORDER BY enumsortorder",
      );
      expect(filas.map((f) => f.enumlabel)).toEqual(["pendiente", "aprobado", "rechazado"]);
    });

    it("⭑ el indice unico de la idempotencia existe y es TOTAL (sin `WHERE`)", async () => {
      // El caso que detecta a la vez que alguien lo borra y que alguien lo vuelve PARCIAL. Un
      // indice parcial `WHERE estado = 'pendiente'` dejaria pasar el alta de un rechazo ya
      // decidido, que es la alternativa A9 descartada por escrito.
      const filas = await prisma.$queryRawUnsafe<Array<{ indexdef: string }>>(
        "SELECT indexdef FROM pg_indexes WHERE indexname = 'rechazo_tienda_cobro_gestion_uq'",
      );
      expect(filas).toHaveLength(1);
      expect(filas[0].indexdef).toContain("UNIQUE");
      expect(filas[0].indexdef).toContain("gestion_id");
      expect(filas[0].indexdef).not.toContain("WHERE");
    });
  });
});
