import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { ZonaRepository } from "@/lib/repositories/ZonaRepository";
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
// ⭑ FICHA 429 / T7 — EL RASTRO DEL CAMBIO DE SINPE, CONTRA POSTGRES REAL (R21, R23, R24, R25).
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// POR QUE ESTE ARCHIVO ES OBLIGATORIO Y NO UN EXTRA. Lo que se prueba vive en el ESTADO DE LA
// TABLA antes y despues del `UPDATE`, y un doble de Prisma no lo ve:
//
//   · R25 («confirmar sin cambiar nada no deja fila») exige que el valor PREVIO lo devuelva la
//     base. Con un doble, el `SELECT … FOR UPDATE` devuelve lo que el test le diga, asi que la
//     comparacion «cambio / no cambio» quedaria comparando el fixture consigo mismo —«asercion
//     contra su propia fuente», leccion ya escrita en este repo— y estaria SIEMPRE verde.
//   · R24 (atomicidad) es una propiedad de Postgres: si el registro falla, el `UPDATE` no
//     persiste. Un doble se traga el `throw` sin revertir nada y el caso pasaria por accidente.
//     Por eso se usa `clienteConSavepoint`, que abre un SAVEPOINT de verdad.
//   · R23 («el titular no aparece en NINGUNA columna de la fila») solo se puede afirmar mirando
//     la fila entera que quedo escrita.
//
// ⚠️ NINGUN SINPE DE AQUI ES REAL. El repositorio es publico.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const NUM_A = "80000000";
const NUM_B = "70000001";
const NOMBRE_A = "Titular de Prueba";
const NOMBRE_B = "Otro Titular de Prueba";

const unico = () => randomUUID().slice(0, 8);

interface FilaDeRastro {
  accion: string;
  entidadTipo: string;
  entidadId: string;
  entidadEtiqueta: string;
  actorUsuarioId: string | null;
  actorNombre: string | null;
  actorRol: string | null;
  monto: unknown;
  valorAnterior: string | null;
  valorNuevo: string | null;
  loteId: string;
}

interface Escenario {
  tx: TxDeTest;
  repo: ZonaRepository;
  zona: { id: string; nombre: string };
  filas: () => Promise<FilaDeRastro[]>;
  sinpeDe: (
    zonaId: string,
  ) => Promise<{ numero: string; nombre: string; revisadoAt: Date | null }>;
}

describeSiHayBase("⭑ 429/T7 — guardar el SINPE de una bodega deja rastro (Postgres real)", () => {
  let prisma: PrismaClient;
  let USUARIO: string;
  let NOMBRE_ACTOR: string;
  let ROL_ACTOR: string;

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    const usuario = await prisma.usuario.findFirst({
      select: { id: true, nombre: true, primerApellido: true, rol: { select: { value: true } } },
    });
    if (usuario === null) {
      throw new Error(
        "hacen falta usuarios en la base: el actor congelado de R21 cuelga de uno. Corre " +
          "`pnpm run db:seed:maestro`.",
      );
    }
    USUARIO = usuario.id;
    NOMBRE_ACTOR = [usuario.nombre, usuario.primerApellido].filter((p) => p).join(" ");
    ROL_ACTOR = usuario.rol.value;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function conEscenario<T>(fn: (e: Escenario) => Promise<T>): Promise<T> {
    return enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const nombre = `429 Bodega ${unico()}`;
      const zona = await tx.zona.create({
        data: { nombre, sinpeNumero: NUM_A, sinpeNombre: NOMBRE_A },
        select: { id: true },
      });
      // ⚠️ La bodega nace REVISADA (R12: la creo una persona). Para medir el guardado hay que
      // devolverla al estado de la SIEMBRA —sin revisar—, que es de donde parte la ficha.
      await tx.zona.update({ where: { id: zona.id }, data: { sinpeRevisadoAt: null } });

      return fn({
        tx,
        // `guardarSinpe` abre su propia `$transaction`; el savepoint la traduce a uno REAL, asi
        // que el SQL medido es el de produccion y un fallo revierte de verdad.
        repo: new ZonaRepository(clienteConSavepoint(tx)),
        zona: { id: zona.id, nombre },
        filas: async () =>
          (await tx.historialAccion.findMany({
            where: { entidadId: zona.id },
            orderBy: { createdAt: "asc" },
          })) as unknown as FilaDeRastro[],
        sinpeDe: async (zonaId) => {
          const f = await tx.zona.findUniqueOrThrow({
            where: { id: zonaId },
            select: { sinpeNumero: true, sinpeNombre: true, sinpeRevisadoAt: true },
          });
          return { numero: f.sinpeNumero, nombre: f.sinpeNombre, revisadoAt: f.sinpeRevisadoAt };
        },
      });
    });
  }

  it("⭑ R21 — un numero distinto escribe UNA fila, con el actor congelado y los DOS numeros", async () => {
    await conEscenario(async (e) => {
      await e.repo.guardarSinpe(e.zona.id, { numero: NUM_B, nombre: NOMBRE_A }, USUARIO);

      const filas = await e.filas();
      expect(filas).toHaveLength(1);
      const fila = filas[0];
      expect(fila.accion).toBe("zona_sinpe_cambiado");
      expect(fila.entidadTipo).toBe("zona");
      expect(fila.entidadId).toBe(e.zona.id);
      // La etiqueta sale de `etiquetaDeEntidad`, nunca de una interpolacion a mano.
      expect(fila.entidadEtiqueta).toBe(e.zona.nombre);
      // El actor se congela: uno de los eventos que este modulo registra ES el cambio de rol.
      expect(fila.actorUsuarioId).toBe(USUARIO);
      expect(fila.actorNombre).toBe(NOMBRE_ACTOR);
      expect(fila.actorRol).toBe(ROL_ACTOR);
      // Los dos numeros. Es lo unico que contesta «¿a que numero transfirio el cliente el martes?».
      expect(fila.valorAnterior).toBe(NUM_A);
      expect(fila.valorNuevo).toBe(NUM_B);
      expect(fila.loteId).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  it("⭑ R23 — el TITULAR no aparece en NINGUNA columna de la fila, y `monto` va NULL", async () => {
    await conEscenario(async (e) => {
      // Se cambian los DOS a la vez: si el titular se colara en alguna columna, aqui se ve.
      await e.repo.guardarSinpe(e.zona.id, { numero: NUM_B, nombre: NOMBRE_B }, USUARIO);

      const [fila] = await e.filas();
      expect(fila.monto).toBeNull();
      // Barrido sobre la fila ENTERA, no sobre las columnas que uno se acuerde de mirar.
      const serializada = JSON.stringify(fila);
      expect(serializada).not.toContain(NOMBRE_B);
      expect(serializada).not.toContain(NOMBRE_A);
    });
  });

  it("⭑ R25 — guardar los MISMOS dos valores NO escribe fila, pero SI marca la revision", async () => {
    await conEscenario(async (e) => {
      const antes = await e.sinpeDe(e.zona.id);
      expect(antes.revisadoAt).toBeNull(); // anti-vacuidad: se parte de «sin revisar»

      await e.repo.guardarSinpe(e.zona.id, { numero: NUM_A, nombre: NOMBRE_A }, USUARIO);

      expect(await e.filas()).toHaveLength(0);
      const despues = await e.sinpeDe(e.zona.id);
      expect(despues.revisadoAt).not.toBeNull();
      expect(despues.numero).toBe(NUM_A);
    });
  });

  it("⭑ el LIMITE DECLARADO: cambiar SOLO el titular deja fila con el MISMO numero dos veces", async () => {
    // Es la consecuencia aceptada de R23, con el precedente de la Q2 de la 380. Se afirma para que
    // nadie la descubra el dia del reclamo: el historial dira que el SINPE de esa bodega cambio,
    // quien y cuando — y no de que titular a que titular.
    await conEscenario(async (e) => {
      await e.repo.guardarSinpe(e.zona.id, { numero: NUM_A, nombre: NOMBRE_B }, USUARIO);

      const filas = await e.filas();
      expect(filas).toHaveLength(1);
      expect(filas[0].valorAnterior).toBe(NUM_A);
      expect(filas[0].valorNuevo).toBe(NUM_A);
    });
  });

  it("⭑ R24 — si el registro revienta, el SINPE NO cambia y no queda ni una fila", async () => {
    await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const zona = await tx.zona.create({
        data: { nombre: `429 Atomica ${unico()}`, sinpeNumero: NUM_A, sinpeNombre: NOMBRE_A },
        select: { id: true },
      });
      await tx.zona.update({ where: { id: zona.id }, data: { sinpeRevisadoAt: null } });

      // `romperRegistro` sustituye `historialAccion.createMany` por una funcion que LANZA. Nada
      // mas se toca: el `UPDATE`, el `FOR UPDATE` y el congelado del actor son los reales.
      const repo = new ZonaRepository(clienteConSavepoint(tx, true));
      await expect(
        repo.guardarSinpe(zona.id, { numero: NUM_B, nombre: NOMBRE_B }, USUARIO),
      ).rejects.toBeInstanceOf(RegistroCaido);

      const despues = await tx.zona.findUniqueOrThrow({
        where: { id: zona.id },
        select: { sinpeNumero: true, sinpeNombre: true, sinpeRevisadoAt: true },
      });
      // El `UPDATE` ya se habia ejecutado cuando el registro cayo: si no fuera atomico, el numero
      // seria el nuevo. Esto es lo que mide que `appendAccion` recibe `tx` y no `this.prisma`.
      expect(despues.sinpeNumero).toBe(NUM_A);
      expect(despues.sinpeNombre).toBe(NOMBRE_A);
      expect(despues.sinpeRevisadoAt).toBeNull();
      expect(await tx.historialAccion.count({ where: { entidadId: zona.id } })).toBe(0);
    });
  });

  it("guardar sobre una zona que no existe devuelve `null` y no escribe nada", async () => {
    await conEscenario(async (e) => {
      const r = await e.repo.guardarSinpe(
        `no-existe-${unico()}`,
        { numero: NUM_B, nombre: NOMBRE_B },
        USUARIO,
      );
      expect(r).toBeNull();
      expect(await e.tx.historialAccion.count({ where: { accion: "zona_sinpe_cambiado" } })).toBe(
        0,
      );
    });
  });
});
