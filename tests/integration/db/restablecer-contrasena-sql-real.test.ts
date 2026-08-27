import { describe, it, expect, beforeAll } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { UsuarioService } from "@/lib/services/UsuarioService";
import { UserRepository } from "@/lib/repositories/UserRepository";
import { SessionRepository } from "@/lib/repositories/SessionRepository";
import { hashPassword, verifyPassword } from "@/lib/utils/password";
import type { Actor } from "@/lib/interfaces/services/IUsuarioService";

import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  serializarEscriturasReales,
} from "./_postgres-real";

/**
 * FEATURE 287 (T11, R12/R13/R14/R16/R17/R18) — **EL RESTABLECIMIENTO, EJECUTADO CONTRA POSTGRES.**
 *
 * ⚠️ POR QUE EXISTE ESTE ARCHIVO habiendo ya un test de servicio del mismo metodo. Ese usa dobles
 * y **no ve el SQL**. Las tres mutaciones que `design.md` §10 nombra —guardar el claro en vez del
 * hash, escribir en OTRA fila (`where` mutado) y borrar TODAS las sesiones (`where: {}`)— pasan
 * en VERDE por arriba: el doble responde lo mismo se toque la fila que se toque. Este repo lo
 * midio cuatro veces. Aqui la unica forma de que un caso pase es que Postgres devuelva de verdad
 * lo que afirmamos.
 *
 * TODO corre dentro de una transaccion que SIEMPRE se revierte: si el test pasa, si falla o si el
 * proceso muere a mitad, no queda ni una fila en la base compartida.
 *
 * SIN `DATABASE_URL` se SALTA (`describe.skip`), que es la convencion del arnes y se VE en la
 * salida. CON base pero sin los catalogos que necesita, **revienta con mensaje**: un
 * `if (!datos) return;` reporta `passed` sin haber comprobado nada, y eso es peor que no tener el
 * test.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

/** Sufijo unico por corrida: `usuario.email` y `usuario.cedula` son UNIQUE. */
const SUFIJO = `287-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6)}`;

const MAESTRO: Actor = { usuarioId: "maestro-de-mentira", rol: "maestro" };

/** La contrasena que los dos usuarios tienen ANTES del restablecimiento (R13). */
const CONTRASENA_ANTERIOR = "Anterior-2026!x";

/** Las columnas de `usuario` que R14 dice que NO pueden cambiar. */
const COLUMNAS_INTOCABLES = {
  nombre: true,
  email: true,
  telefono: true,
  estado: true,
  cedula: true,
  tipoIdentificacionId: true,
  rolId: true,
  fulfillment: true,
  zonaId: true,
  vehiculoId: true,
  createdAt: true,
} as const;

describeSiHayBase("287/T11 — restablecer contrasena contra Postgres real", () => {
  let prisma: PrismaClient;
  let tipoIdentificacionId: string;
  let rolId: string;

  beforeAll(async () => {
    prisma = crearPrismaDeTest();

    const tipo = await prisma.tipoIdentificacion.findFirst({ select: { id: true } });
    if (!tipo) {
      throw new Error(
        "hay DATABASE_URL pero `tipo_identificacion` esta vacia: sin FK no se puede sembrar el " +
          "usuario objetivo. Corre `pnpm run db:seed`. Este archivo NO debe pasar en verde asi.",
      );
    }
    tipoIdentificacionId = tipo.id;

    const rol = await prisma.rol.findFirst({ where: { value: "mensajero" }, select: { id: true } });
    if (!rol) {
      throw new Error(
        "hay DATABASE_URL pero falta el rol `mensajero` en el catalogo `rol`. Corre " +
          "`pnpm run db:seed`: sin el no se puede sembrar el corpus y este archivo NO debe " +
          "pasar en verde.",
      );
    }
    rolId = rol.id;
  });

  /**
   * Siembra el corpus y ejecuta el restablecimiento REAL (repositorios reales sobre `tx`, sin un
   * solo doble), dentro de una transaccion revertida.
   */
  async function conCorpus<T>(
    fn: (ctx: {
      tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
      objetivoId: string;
      otroId: string;
      sesionesDelOtro: string[];
      dispositivoId: string;
      filaAntes: Record<string, unknown>;
      resultado: Awaited<ReturnType<UsuarioService["restablecerContrasena"]>>;
    }) => Promise<T>,
  ): Promise<T> {
    return enTransaccionRevertida(prisma, async (tx) => {
      // PRIMERA sentencia: serializa contra los demas archivos que escriben en `public`.
      await serializarEscriturasReales(tx);

      const passwordHash = await hashPassword(CONTRASENA_ANTERIOR);
      const crearUsuario = (marca: string) =>
        tx.usuario.create({
          data: {
            nombre: `Usuario ${marca} ${SUFIJO}`,
            email: `${marca}.${SUFIJO}@ejemplo.test`,
            telefono: "88880000",
            passwordHash,
            estado: "activo",
            cedula: `${marca}-${SUFIJO}`.slice(0, 40),
            tipoIdentificacionId,
            rolId,
          },
          select: { id: true },
        });

      const objetivo = await crearUsuario("objetivo");
      const otro = await crearUsuario("otro");

      // R16 dice «TODAS las sesiones, incluidas las que aun no han expirado». Se siembran las
      // dos clases a proposito: una caducada y dos vivas. Un borrado que filtrase por
      // `expiresAt` dejaria vivas las dos ultimas, que son justo las peligrosas.
      const ahora = Date.now();
      for (const horas of [-2, 1, 24]) {
        await tx.session.create({
          data: { userId: objetivo.id, expiresAt: new Date(ahora + horas * 3_600_000) },
        });
      }
      // El SEÑUELO de R17: las sesiones de otro usuario, que no se pueden tocar.
      const sesionesDelOtro: string[] = [];
      for (const horas of [1, 24]) {
        const s = await tx.session.create({
          data: { userId: otro.id, expiresAt: new Date(ahora + horas * 3_600_000) },
          select: { id: true },
        });
        sesionesDelOtro.push(s.id);
      }

      // R18: el dispositivo de confianza del OBJETIVO no se toca.
      const dispositivo = await tx.trustedDevice.create({
        data: {
          usuarioId: objetivo.id,
          deviceHash: `dev-${SUFIJO}`,
          ipAddress: "203.0.113.7",
        },
        select: { id: true },
      });

      const filaAntes = (await tx.usuario.findUniqueOrThrow({
        where: { id: objetivo.id },
        select: COLUMNAS_INTOCABLES,
      })) as unknown as Record<string, unknown>;

      // ── EL SISTEMA REAL, sobre la transaccion ──────────────────────────────────────────
      const service = new UsuarioService(
        new UserRepository(tx),
        undefined,
        undefined,
        new SessionRepository(tx),
      );
      const resultado = await service.restablecerContrasena(objetivo.id, MAESTRO);

      return fn({
        tx,
        objetivoId: objetivo.id,
        otroId: otro.id,
        sesionesDelOtro,
        dispositivoId: dispositivo.id,
        filaAntes,
        resultado,
      });
    });
  }

  it("R12/R13 — el hash guardado verifica la contrasena MOSTRADA, y la anterior ya no", async () => {
    const { verificaLaNueva, verificaLaAnterior, guardadoEnClaro } = await conCorpus(
      async ({ tx, objetivoId, resultado }) => {
        if (resultado.status !== "ok") throw new Error(`esperaba ok, llego ${resultado.status}`);

        const fila = await tx.usuario.findUniqueOrThrow({
          where: { id: objetivoId },
          select: { passwordHash: true },
        });

        return {
          verificaLaNueva: await verifyPassword(resultado.generatedPassword, fila.passwordHash),
          verificaLaAnterior: await verifyPassword(CONTRASENA_ANTERIOR, fila.passwordHash),
          guardadoEnClaro: fila.passwordHash === resultado.generatedPassword,
        };
      },
    );

    // ⭑ Mata «guardar el claro» y «guardar el hash de otra cosa».
    expect(verificaLaNueva, "R13: el hash de la fila DEBE verificar la contrasena mostrada").toBe(
      true,
    );
    // ⭑ Mata «escribir en otra fila»: si el UPDATE fuese a otro `id`, la fila del objetivo
    //   conservaria el hash viejo y esto seria `true`.
    expect(verificaLaAnterior, "R13: la contrasena ANTERIOR no puede seguir sirviendo").toBe(false);
    expect(guardadoEnClaro, "R12: nunca la contrasena en claro en la base").toBe(false);
  });

  it("R14 — ninguna otra columna del usuario objetivo cambia", async () => {
    const { antes, despues } = await conCorpus(async ({ tx, objetivoId, filaAntes, resultado }) => {
      if (resultado.status !== "ok") throw new Error(`esperaba ok, llego ${resultado.status}`);
      const filaDespues = (await tx.usuario.findUniqueOrThrow({
        where: { id: objetivoId },
        select: COLUMNAS_INTOCABLES,
      })) as unknown as Record<string, unknown>;
      return { antes: filaAntes, despues: filaDespues };
    });

    // `updatedAt` queda FUERA a proposito y esta dicho: es `@updatedAt`, lo mueve Prisma en
    // cualquier UPDATE de la fila, y R14 enumera los campos de negocio, no la marca de tiempo.
    expect(despues).toEqual(antes);
    // Anti-vacuidad: si el `select` se quedara sin columnas, el `toEqual` de arriba compararia
    // dos objetos vacios y estaria verde sin mirar nada.
    expect(Object.keys(antes).length).toBe(Object.keys(COLUMNAS_INTOCABLES).length);
    expect(Object.keys(antes).length).toBeGreaterThanOrEqual(11);
  });

  it("R16/R17 — el objetivo se queda con CERO sesiones y el otro usuario conserva las suyas", async () => {
    const { sesionesObjetivo, sesionesOtro, esperadasDelOtro, revocadas } = await conCorpus(
      async ({ tx, objetivoId, otroId, sesionesDelOtro, resultado }) => {
        if (resultado.status !== "ok") throw new Error(`esperaba ok, llego ${resultado.status}`);
        return {
          sesionesObjetivo: await tx.session.count({ where: { userId: objetivoId } }),
          sesionesOtro: (
            await tx.session.findMany({ where: { userId: otroId }, select: { id: true } })
          )
            .map((s) => s.id)
            .sort(),
          esperadasDelOtro: [...sesionesDelOtro].sort(),
          revocadas: resultado.sesionesRevocadas,
        };
      },
    );

    // R16: las TRES, incluidas las dos que aun no habian expirado.
    expect(sesionesObjetivo, "R16: no puede sobrevivir ninguna sesion del objetivo").toBe(0);
    expect(revocadas, "R19: el count que se le informa al maestro es el real").toBe(3);
    // ⭑ Mata `where: {}` en el `deleteMany` (borraria tambien estas) y un id fijo.
    expect(sesionesOtro, "R17: las sesiones de OTRO usuario no se tocan").toEqual(esperadasDelOtro);
    expect(esperadasDelOtro.length).toBe(2); // anti-vacuidad del señuelo
  });

  it("R18 — el dispositivo de confianza del objetivo SIGUE existiendo", async () => {
    const { sigue, delObjetivo } = await conCorpus(
      async ({ tx, objetivoId, dispositivoId, resultado }) => {
        if (resultado.status !== "ok") throw new Error(`esperaba ok, llego ${resultado.status}`);
        return {
          sigue: (await tx.trustedDevice.findUnique({ where: { id: dispositivoId } })) !== null,
          delObjetivo: await tx.trustedDevice.count({ where: { usuarioId: objetivoId } }),
        };
      },
    );

    // Se revoca lo que PORTA acceso (sesiones), no lo que solo puntua riesgo (dispositivos):
    // borrarlo empuja el siguiente ingreso a un OTP por correo que hoy no llega (design §7 D3).
    expect(sigue, "R18: borrar el dispositivo dejaria fuera a quien queriamos dejar entrar").toBe(
      true,
    );
    expect(delObjetivo).toBe(1);
  });
});
