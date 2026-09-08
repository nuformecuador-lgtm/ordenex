import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";

import { UserRepository } from "@/lib/repositories/UserRepository";
import { WalletTiendaMovimientoRepository } from "@/lib/repositories/WalletTiendaMovimientoRepository";
import { CobroTiendaService } from "@/lib/services/CobroTiendaService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { derivarSaldoTienda } from "@/lib/utils/saldo-tienda";

import {
  HAY_BASE_DE_DATOS,
  RegistroCaido,
  clienteConSavepoint,
  crearPrismaDeTest,
  enTransaccionRevertida,
  serializarEscriturasReales,
  type TxDeTest,
} from "./_postgres-real";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// ⭑ FICHA 381 / T G.1 — EL COBRO MANUAL CONTRA POSTGRES REAL.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// POR QUE ESTE ARCHIVO EXISTE, y no es ceremonia: los tests de servicio usan DOBLES y NO VEN EL
// SQL. Esta medido cuatro veces en este repo que una mutacion del `WHERE` los pasa en verde. Todo
// lo que decide QUE FILAS SE ESCRIBEN O SE LEEN se prueba aqui:
//
//   (a) el `INSERT` de un `debito`/`cobro_manual` PASA el CHECK recreado por la migracion 2;
//   (b) un `credito`/`cobro_manual` lo RECHAZA la base (falla cerrado, R60 de la 172);
//   (c) el saldo derivado baja EXACTAMENTE el importe del cobro (R26);
//   (d) un cobro mayor que el saldo lo deja NEGATIVO y NO se rechaza (R27);
//   (e) si la escritura del historial falla, NO queda el asiento (R25/R42);
//   (f) el cobro NO aparece en el libro de otra tienda (R38);
//   (g) NO aparece ninguna fila nueva en `wallet_movimiento` — la caja de Ordenex (R24/D1).
//
// TODO corre dentro de una transaccion que SIEMPRE se revierte: si el test pasa, si falla o si el
// proceso muere, no queda ni una fila. Y `serializarEscriturasReales` va PRIMERO en cada una: son
// escrituras sobre `public."usuario"`, y sin el lock de aviso dos archivos en paralelo se dan un
// deadlock (40P01) que vitest reporta como SKIPPED.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const SUFIJO = `381-cobro-${Date.now().toString(36)}`;

describeSiHayBase("381/G.1 — cobrarle un costo a una tienda (Postgres real)", () => {
  let prisma: PrismaClient;
  let MAESTRO: Actor;
  let ROL_ADMIN_TIENDA: string;
  let ROL_MENSAJERO: string;
  let TIPO_CEDULA: string;

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    const maestro = await prisma.usuario.findFirst({
      where: { rol: { value: "maestro" } },
      select: { id: true },
    });
    const rolTienda = await prisma.rol.findUnique({
      where: { value: "adminTienda" },
      select: { id: true },
    });
    const rolMensajero = await prisma.rol.findUnique({
      where: { value: "mensajero" },
      select: { id: true },
    });
    const tipo = await prisma.tipoIdentificacion.findUnique({
      where: { value: "cedula" },
      select: { id: true },
    });
    if (maestro === null || rolTienda === null || rolMensajero === null || tipo === null) {
      throw new Error(
        "hay DATABASE_URL pero faltan el maestro o los catalogos `rol.adminTienda` / " +
          "`rol.mensajero` / `cedula`: corre `pnpm run db:seed` antes.",
      );
    }
    MAESTRO = { usuarioId: maestro.id, rol: "maestro" };
    ROL_ADMIN_TIENDA = rolTienda.id;
    ROL_MENSAJERO = rolMensajero.id;
    TIPO_CEDULA = tipo.id;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  /** Una cuenta de prueba con el rol y el estado que se pidan. Se revierte con la transaccion. */
  async function sembrarCuenta(
    tx: TxDeTest,
    marca: string,
    rolId: string = ROL_ADMIN_TIENDA,
    estado: "activo" | "inactivo" = "activo",
  ): Promise<string> {
    const slug = `${SUFIJO}-${marca}-${randomUUID().slice(0, 8)}`;
    const fila = await tx.usuario.create({
      data: {
        nombre: `Tienda ${slug}`,
        email: `${slug}@tienda.invalid`,
        telefono: "88880000",
        passwordHash: "x",
        cedula: `TIENDA-${slug}`,
        tipoIdentificacionId: TIPO_CEDULA,
        rolId,
        estado,
        fulfillment: false,
        zonaId: null,
      },
      select: { id: true },
    });
    return fila.id;
  }

  /** Un credito `cod_recaudado` a favor de la tienda: es lo que le da saldo positivo de partida. */
  async function sembrarSaldoAFavor(tx: TxDeTest, tiendaId: string, monto: string): Promise<void> {
    await tx.walletTiendaMovimiento.create({
      data: {
        tiendaId,
        tipo: "credito",
        categoria: "cod_recaudado",
        monto: new Prisma.Decimal(monto),
        origenTipo: "manual",
        origenId: null,
        descripcion: "semilla del test",
      },
    });
  }

  /** El servicio REAL, cableado contra la transaccion del test (con savepoints de verdad). */
  function servicioReal(tx: TxDeTest, romperRegistro = false) {
    const cliente = clienteConSavepoint(tx, romperRegistro);
    return new CobroTiendaService(
      new WalletTiendaMovimientoRepository(cliente),
      new UserRepository(cliente),
      (fn) => cliente.$transaction((t) => fn(t as never)),
    );
  }

  /** El saldo DERIVADO del ledger, leido con las MISMAS consultas que usa la aplicacion. */
  async function saldoDerivado(tx: TxDeTest, tiendaId: string): Promise<string> {
    const repo = new WalletTiendaMovimientoRepository(clienteConSavepoint(tx));
    const agregado = await repo.agregarSaldoPorTienda(tiendaId, {});
    return derivarSaldoTienda(agregado.creditos, agregado.debitos).saldo;
  }

  // -------------------------------------------------------------------------------------------
  // (a)(c)(g) El camino feliz, medido por lo que queda en las tablas.
  // -------------------------------------------------------------------------------------------

  it("⭑ (a)(c)(g) el cobro se escribe, baja el saldo exactamente y NO toca la caja", async () => {
    await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const tiendaId = await sembrarCuenta(tx, "feliz");
      await sembrarSaldoAFavor(tx, tiendaId, "10000.00");

      const saldoAntes = await saldoDerivado(tx, tiendaId);
      const cajaAntes = await tx.walletMovimiento.count();
      expect(saldoAntes).toBe("10000.00"); // anti-vacuidad: la semilla existe

      const r = await servicioReal(tx).registrarCobro(
        { tiendaId, monto: "1500.00", descripcion: "Reposicion de etiquetas" },
        MAESTRO,
      );
      expect(r.status).toBe("ok");
      if (r.status !== "ok") return;

      // (a) La fila esta EN LA BASE, con la categoria propia y pasando el CHECK recreado.
      const filas = await tx.walletTiendaMovimiento.findMany({
        where: { tiendaId, categoria: "cobro_manual" },
      });
      expect(filas).toHaveLength(1);
      expect(filas[0].id).toBe(r.cobro.id);
      expect(filas[0].tipo).toBe("debito");
      expect(filas[0].monto.toFixed(2)).toBe("1500.00");
      expect(filas[0].descripcion).toBe("Reposicion de etiquetas");
      expect(filas[0].registradoPor).toBe(MAESTRO.usuarioId);
      // R20: manual y sin documento de origen.
      expect(filas[0].origenTipo).toBe("manual");
      expect(filas[0].origenId).toBeNull();

      // R23: UNA fila y ni una mas en TODO el libro de esa tienda (aparte de la semilla).
      const todas = await tx.walletTiendaMovimiento.findMany({ where: { tiendaId } });
      expect(todas).toHaveLength(2);

      // (c) R26: el saldo baja EXACTAMENTE el importe del cobro.
      const saldoDespues = await saldoDerivado(tx, tiendaId);
      expect(saldoDespues).toBe("8500.00");
      expect(new Prisma.Decimal(saldoAntes).sub(saldoDespues).toFixed(2)).toBe("1500.00");
      // Y el servicio devuelve ESE saldo, con su signo derivado en el servidor.
      expect(r.saldo.saldo).toBe("8500.00");
      expect(r.saldo.signo).toBe("positivo");

      // (g) R24/D1: CERO filas nuevas en la caja de Ordenex.
      expect(await tx.walletMovimiento.count()).toBe(cajaAntes);

      // R40: y SI queda la fila del historial, con el importe y la tienda.
      const rastro = await tx.historialAccion.findMany({
        where: { accion: "cobro_tienda_registrado", entidadId: r.cobro.id },
      });
      expect(rastro).toHaveLength(1);
      expect(rastro[0].entidadTipo).toBe("wallet_tienda_movimiento");
      expect(rastro[0].monto?.toFixed(2)).toBe("1500.00");
      expect(rastro[0].actorUsuarioId).toBe(MAESTRO.usuarioId);
      expect(rastro[0].entidadEtiqueta).toContain("Tienda");
      // R43: la descripcion NO viaja al rastro.
      expect(rastro[0].entidadEtiqueta).not.toContain("Reposicion");
      expect(rastro[0].valorAnterior).toBeNull();
      expect(rastro[0].valorNuevo).toBeNull();
    });
  }, 120_000);

  // -------------------------------------------------------------------------------------------
  // (b) La base falla CERRADO: un `credito` con la categoria del cobro no entra.
  // -------------------------------------------------------------------------------------------

  it("⭑ (b) un `credito`/`cobro_manual` lo RECHAZA la base, no el codigo", async () => {
    await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const tiendaId = await sembrarCuenta(tx, "check");

      // Control positivo PRIMERO: el par correcto SI entra. Sin esto, el rechazo de abajo podria
      // deberse a cualquier otra cosa (una FK, una columna que falta) y el test mentiria.
      await tx.walletTiendaMovimiento.create({
        data: {
          tiendaId,
          tipo: "debito",
          categoria: "cobro_manual",
          monto: new Prisma.Decimal("1.00"),
          origenTipo: "manual",
          origenId: null,
        },
      });

      // Y el par invertido NO. Es la red que la 172 escribio a proposito: elegir otro par no da un
      // saldo raro, da un INSERT rechazado.
      await expect(
        tx.walletTiendaMovimiento.create({
          data: {
            tiendaId,
            tipo: "credito",
            categoria: "cobro_manual",
            monto: new Prisma.Decimal("1.00"),
            origenTipo: "manual",
            origenId: null,
          },
        }),
      ).rejects.toThrow();
    });
  }, 120_000);

  // -------------------------------------------------------------------------------------------
  // (d) El disponible en NEGATIVO. Es lo que el humano firmo, y no es un caso de error.
  // -------------------------------------------------------------------------------------------

  it("⭑ (d) un cobro mayor que el saldo se ACEPTA y lo deja NEGATIVO (R27)", async () => {
    await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const tiendaId = await sembrarCuenta(tx, "negativo");
      await sembrarSaldoAFavor(tx, tiendaId, "5000.00");

      const r = await servicioReal(tx).registrarCobro(
        { tiendaId, monto: "20000.00", descripcion: "Equipo de rotulacion" },
        MAESTRO,
      );

      // ⚠️ NO se rechaza: no hay `sin_saldo`, no hay `excede` y no hay tope contra el que comparar.
      expect(r.status).toBe("ok");
      if (r.status !== "ok") return;
      // ⚠️ LITERAL Y CON SIGNO. Recortarlo a cero, esconderlo o devolver su valor absoluto son las
      // tres formas de romper lo que el humano firmo el 2026-09-07.
      expect(await saldoDerivado(tx, tiendaId)).toBe("-15000.00");
      expect(r.saldo.saldo).toBe("-15000.00");
      expect(r.saldo.signo).toBe("negativo");
      // Y la fila esta escrita de verdad: no es un rechazo disfrazado de `ok`.
      expect(
        await tx.walletTiendaMovimiento.count({ where: { tiendaId, categoria: "cobro_manual" } }),
      ).toBe(1);
    });
  }, 120_000);

  it("un SEGUNDO cobro sobre un saldo ya negativo lo hunde mas, sin quejarse", async () => {
    await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const tiendaId = await sembrarCuenta(tx, "doble");
      const servicio = servicioReal(tx);

      await servicio.registrarCobro({ tiendaId, monto: "100.00", descripcion: "uno" }, MAESTRO);
      const segundo = await servicio.registrarCobro(
        { tiendaId, monto: "50.00", descripcion: "dos" },
        MAESTRO,
      );

      expect(segundo.status).toBe("ok");
      expect(await saldoDerivado(tx, tiendaId)).toBe("-150.00");
      // C2 (declarada en el spec): los cobros llevan `origen_id` NULL, quedan FUERA del indice
      // unico parcial y por tanto NO se deduplican. Dos cobros son DOS filas, tambien con el mismo
      // importe. Se afirma para que no aparezca como sorpresa el dia que ocurra.
      expect(
        await tx.walletTiendaMovimiento.count({ where: { tiendaId, categoria: "cobro_manual" } }),
      ).toBe(2);
    });
  }, 120_000);

  // -------------------------------------------------------------------------------------------
  // (e) La atomicidad, medida con un savepoint REAL.
  // -------------------------------------------------------------------------------------------

  it("⭑ (e) si el registro del historial falla, NO queda el asiento (R25/R42)", async () => {
    await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const tiendaId = await sembrarCuenta(tx, "atomico");
      await sembrarSaldoAFavor(tx, tiendaId, "10000.00");
      const rastroAntes = await tx.historialAccion.count({
        where: { accion: "cobro_tienda_registrado" },
      });

      // `clienteConSavepoint(tx, true)` sustituye `historialAccion.createMany` por una funcion que
      // LANZA. Nada mas se toca: el asiento, el `where` y el congelado del actor son los reales.
      await expect(
        servicioReal(tx, true).registrarCobro(
          { tiendaId, monto: "1500.00", descripcion: "no debe quedar" },
          MAESTRO,
        ),
      ).rejects.toThrow(RegistroCaido);

      // ⚠️ EL ASIENTO NO ESTA. Sin el savepoint real esto pasaria en verde por accidente: la
      // transaccion del test seguiria viva y la fila del cobro seguiria escrita.
      expect(
        await tx.walletTiendaMovimiento.count({ where: { tiendaId, categoria: "cobro_manual" } }),
      ).toBe(0);
      // Y el saldo no se movio ni un centimo.
      expect(await saldoDerivado(tx, tiendaId)).toBe("10000.00");
      // R42: tampoco queda fila de historial.
      expect(
        await tx.historialAccion.count({ where: { accion: "cobro_tienda_registrado" } }),
      ).toBe(rastroAntes);
    });
  }, 120_000);

  it("control positivo de (e): con el registro SANO, el mismo camino SI deja el asiento", async () => {
    // Sin esta mitad, el caso de arriba pasaria con un servicio que no escribiera NUNCA.
    await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const tiendaId = await sembrarCuenta(tx, "atomico-ok");
      await sembrarSaldoAFavor(tx, tiendaId, "10000.00");

      const r = await servicioReal(tx).registrarCobro(
        { tiendaId, monto: "1500.00", descripcion: "si debe quedar" },
        MAESTRO,
      );

      expect(r.status).toBe("ok");
      expect(
        await tx.walletTiendaMovimiento.count({ where: { tiendaId, categoria: "cobro_manual" } }),
      ).toBe(1);
      expect(await saldoDerivado(tx, tiendaId)).toBe("8500.00");
    });
  }, 120_000);

  // -------------------------------------------------------------------------------------------
  // (f) El alcance: el cobro es de ESA tienda y de ninguna otra.
  // -------------------------------------------------------------------------------------------

  it("⭑ (f) el cobro NO aparece en el libro de otra tienda, ni le mueve el saldo (R38)", async () => {
    await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const cobrada = await sembrarCuenta(tx, "cobrada");
      const ajena = await sembrarCuenta(tx, "ajena");
      await sembrarSaldoAFavor(tx, cobrada, "10000.00");
      await sembrarSaldoAFavor(tx, ajena, "10000.00");

      await servicioReal(tx).registrarCobro(
        { tiendaId: cobrada, monto: "1500.00", descripcion: "solo de esta" },
        MAESTRO,
      );

      // El libro de la OTRA tienda no tiene ningun cobro, y su saldo no se movio.
      expect(
        await tx.walletTiendaMovimiento.count({ where: { tiendaId: ajena, categoria: "cobro_manual" } }),
      ).toBe(0);
      expect(await saldoDerivado(tx, ajena)).toBe("10000.00");
      // Discriminador: el de la tienda cobrada SI se movio. Sin esto, dos tiendas sin cobro
      // ninguno pasarian este test.
      expect(await saldoDerivado(tx, cobrada)).toBe("8500.00");

      // Y la lectura paginada del libro ajeno tampoco lo trae (es el `WHERE` que importa).
      const repo = new WalletTiendaMovimientoRepository(clienteConSavepoint(tx));
      const pagina = await repo.listarPorTienda({ tiendaId: ajena, page: 1, pageSize: 50 });
      expect(pagina.movimientos.map((m) => m.categoria)).not.toContain("cobro_manual");
      const suyo = await repo.listarPorTienda({ tiendaId: cobrada, page: 1, pageSize: 50 });
      expect(suyo.movimientos.map((m) => m.categoria)).toContain("cobro_manual");
    });
  }, 120_000);

  // -------------------------------------------------------------------------------------------
  // R17 contra la base: la validacion de la tienda mira filas REALES, no un doble.
  // -------------------------------------------------------------------------------------------

  it("R17: una cuenta que no es tienda, o esta inactiva, se rechaza SIN escribir nada", async () => {
    await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const mensajero = await sembrarCuenta(tx, "mensajero", ROL_MENSAJERO);
      const inactiva = await sembrarCuenta(tx, "inactiva", ROL_ADMIN_TIENDA, "inactivo");
      const servicio = servicioReal(tx);

      const porRol = await servicio.registrarCobro(
        { tiendaId: mensajero, monto: "100.00", descripcion: "x" },
        MAESTRO,
      );
      expect(porRol).toEqual({
        status: "validation_error",
        fieldErrors: { tiendaId: ["La cuenta elegida no es una tienda"] },
      });

      const porEstado = await servicio.registrarCobro(
        { tiendaId: inactiva, monto: "100.00", descripcion: "x" },
        MAESTRO,
      );
      expect(porEstado).toEqual({
        status: "validation_error",
        fieldErrors: { tiendaId: ["La tienda no esta activa"] },
      });

      const inexistente = await servicio.registrarCobro(
        { tiendaId: randomUUID(), monto: "100.00", descripcion: "x" },
        MAESTRO,
      );
      expect(inexistente).toEqual({
        status: "validation_error",
        fieldErrors: { tiendaId: ["La tienda no existe"] },
      });

      // Ni una fila, para ninguna de las tres.
      expect(await tx.walletTiendaMovimiento.count({ where: { categoria: "cobro_manual" } })).toBe(0);
    });
  }, 120_000);

  // -------------------------------------------------------------------------------------------
  // R18 contra la base: el importe que queda persistido es EXACTAMENTE el que se tecleo.
  // -------------------------------------------------------------------------------------------

  it.each([
    ["1500.00", "1500.00"],
    ["1500.5", "1500.50"],
    ["0.01", "0.01"],
    ["99999999.99", "99999999.99"],
  ])("R18: el importe %s llega a la columna como %s, sin pasar por un float", async (dado, esperado) => {
    await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const tiendaId = await sembrarCuenta(tx, "monto");

      const r = await servicioReal(tx).registrarCobro(
        { tiendaId, monto: dado, descripcion: "importe" },
        MAESTRO,
      );
      expect(r.status).toBe("ok");
      if (r.status !== "ok") return;

      const fila = await tx.walletTiendaMovimiento.findFirstOrThrow({ where: { id: r.cobro.id } });
      // El `Decimal` de la columna, no un `number`: 0.01 y 99999999.99 sobreviven exactos.
      expect(fila.monto.toFixed(2)).toBe(esperado);
      expect(r.cobro.monto).toBe(esperado);
      // Y el historial lleva el MISMO importe: libro y auditoria no pueden discrepar.
      const rastro = await tx.historialAccion.findFirstOrThrow({
        where: { entidadId: r.cobro.id, accion: "cobro_tienda_registrado" },
      });
      expect(rastro.monto?.toFixed(2)).toBe(esperado);
      // Y el saldo derivado es el negativo exacto de ese importe (la tienda no tenia nada a favor).
      expect(await saldoDerivado(tx, tiendaId)).toBe(`-${esperado}`);
    });
  }, 120_000);

  // -------------------------------------------------------------------------------------------
  // R21 contra la base: sin fecha elegida manda el DEFAULT de la columna.
  // -------------------------------------------------------------------------------------------

  it("R21: sin fecha, el movimiento se fecha con el instante del registro; con una anterior, con ella", async () => {
    await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const tiendaId = await sembrarCuenta(tx, "fecha");
      const servicio = servicioReal(tx);
      const antesDeTodo = new Date(Date.now() - 60_000);

      const sinFecha = await servicio.registrarCobro(
        { tiendaId, monto: "10.00", descripcion: "hoy" },
        MAESTRO,
      );
      expect(sinFecha.status).toBe("ok");
      if (sinFecha.status !== "ok") return;
      const filaHoy = await tx.walletTiendaMovimiento.findFirstOrThrow({
        where: { id: sinFecha.cobro.id },
      });
      // El DEFAULT de la columna: un instante reciente, no una medianoche fijada a mano.
      expect(filaHoy.fechaMovimiento.getTime()).toBeGreaterThan(antesDeTodo.getTime());

      const conFecha = await servicio.registrarCobro(
        { tiendaId, monto: "10.00", descripcion: "ayer", fecha: "2026-09-01" },
        MAESTRO,
      );
      expect(conFecha.status).toBe("ok");
      if (conFecha.status !== "ok") return;
      const filaAyer = await tx.walletTiendaMovimiento.findFirstOrThrow({
        where: { id: conFecha.cobro.id },
      });
      // Medianoche de Costa Rica = 06:00Z: la frontera con la que el rollup diario decide a que dia
      // pertenece la fila.
      expect(filaAyer.fechaMovimiento.toISOString()).toBe("2026-09-01T06:00:00.000Z");
    });
  }, 120_000);
});
