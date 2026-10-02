import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

import { listarMovimientosAction, listarMovimientosCompletoAction } from "@/lib/actions/wallet";
import { OrigenLegibleRepository } from "@/lib/repositories/OrigenLegibleRepository";
import { OrigenLegibleService } from "@/lib/services/OrigenLegibleService";

import { HAY_BASE_DE_DATOS, crearPrismaDeTest } from "./_postgres-real";
import { cargarCatalogo459, enTransaccionRevertida459, montarServicios459 } from "./_fixtures/caja-459";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 463 / T2 — el BUSCADOR y el ORDEN del libro de la caja, contra Postgres (no dobles).
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// El `WHERE` del termino y el `ORDER BY` viven en SQL (y en el `orderBy` de Prisma): un test con
// dobles los pasaria en verde aunque estuvieran mal (memoria del repo «probar el WHERE donde vive»).
// Aqui se siembra un libro propio en un DIA LEJANO (2031-05-10/11 CR), dentro de una transaccion
// revertida, y toda lectura se acota a ese periodo: el resultado esperado es EXACTO, no «contiene».
//
// Siembra (todas las descripciones llevan `<T>comun`; `T` es aleatorio por corrida):
//
//   fila  fecha  created_at  id     lo buscable propio
//   d1    F1     F1+1s       …001   descripcion «Pago <T>DESC alfa» (en MAYUSCULAS en la base)
//   d2    F1     F1+1s       …002   anotacion: nombre «Cartonera <T>nomb»          (manual, original)
//   d3    F1     F1+1s       …003   anotacion: referencia «REF-<T>refe»            (gasto)
//   d4    F2     F2+1s       …004   registrado por «Registrador <T>regi Mora»
//   d5    F2     F2+2s       …000   contra-asiento de d2 (sin anotacion propia: hereda la de d2)
//   d6    F3     F3+1s       …006   descripcion «Cuota 100%dto»
//   d7    F3     F3+1s       …007   descripcion «Cuota 100 dto»   (casaria «100%dto» sin escapar)
//   d8    F3     F3+1s       …008   descripcion «clave a_b»
//   d9    F3     F3+1s       …009   descripcion «clave axb»       (casaria «e a_b» sin escapar)
//
//   d1/d2/d3 comparten instante Y `created_at`: solo el id los ordena. d4/d5 comparten instante con
//   `created_at` distinto y el id AL REVES: solo `created_at` los ordena. Asi una mutacion del
//   desempate se ve.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const F1 = new Date("2031-05-10T16:00:00.000Z"); // 10 may 10:00 CR
const F2 = new Date("2031-05-10T20:00:00.000Z"); // 10 may 14:00 CR
const F3 = new Date("2031-05-11T16:00:00.000Z"); // 11 may 10:00 CR
const PERIODO = { desde: "2031-05-10", hasta: "2031-05-11" } as const;
const mas = (d: Date, s: number) => new Date(d.getTime() + s * 1000);

type Clave = "d1" | "d2" | "d3" | "d4" | "d5" | "d6" | "d7" | "d8" | "d9";

interface Medida {
  ids: Record<Clave, string>;
  /** Id → clave, para leer los resultados en el idioma de la siembra. */
  nombre: Map<string, Clave>;
  T: string;
  busquedas: Record<string, Clave[]>;
  totales: Record<string, number>;
  paginado: Record<"prismaAsc" | "prismaDesc" | "sqlAsc" | "sqlDesc", Clave[]>;
  completo: Record<"asc" | "desc", Clave[]>;
  sinOrden: Clave[];
  bordes: Record<string, string>;
}

describeSiHayBase("463/T2 — buscador y orden del libro de la caja (Postgres real)", () => {
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
        const T = `q${randomUUID().replace(/-/g, "").slice(0, 7)}`;
        const prefijo = randomUUID().slice(0, 8);
        const id = (n: number) => `${prefijo}-0000-4000-8000-${String(n).padStart(12, "0")}`;
        const ids: Record<Clave, string> = {
          d1: id(1), d2: id(2), d3: id(3), d4: id(4), d5: id(0), d6: id(6), d7: id(7), d8: id(8), d9: id(9),
        };

        const crearUsuario = async (nombre: string, primerApellido: string | null, rolId: string) =>
          (
            await tx.usuario.create({
              data: {
                nombre,
                primerApellido,
                email: `u463-${randomUUID().slice(0, 8)}@example.test`,
                telefono: "88880000",
                passwordHash: "no-se-usa",
                cedula: `463-${randomUUID().slice(0, 12)}`,
                tipoIdentificacionId: cat.tipoIdentificacionId,
                rolId,
                zonaId: null,
                estado: "activo",
                fulfillment: false,
              },
              select: { id: true },
            })
          ).id;
        const maestroId = await crearUsuario(`Maestro ${T}`, null, cat.rolId.maestro);
        const registrador = await crearUsuario(`Registrador ${T}regi`, "Mora", cat.rolId.maestro);
        const actor = { usuarioId: maestroId, rol: "maestro" as const };

        const comun = `${T}comun`;
        const fila = (
          k: Clave,
          fecha: Date,
          creada: Date,
          datos: {
            tipo: "ingreso" | "egreso";
            categoria: "ingreso_ajuste" | "egreso_ajuste" | "egreso_gasto_variable" | "ingreso_flete";
            origenTipo: "manual" | "gasto" | "cierre_dia";
            origenId: string | null;
            descripcion: string;
            registradoPor?: string;
          },
        ) =>
          tx.walletMovimiento.create({
            data: {
              id: ids[k],
              monto: "100.00",
              fechaMovimiento: fecha,
              createdAt: creada,
              registradoPor: datos.registradoPor ?? null,
              ...datos,
              descripcion: `${datos.descripcion} ${comun}`,
            },
          });

        await fila("d1", F1, mas(F1, 1), { tipo: "ingreso", categoria: "ingreso_flete", origenTipo: "cierre_dia", origenId: randomUUID(), descripcion: `PAGO ${T.toUpperCase()}DESC ALFA` });
        await fila("d2", F1, mas(F1, 1), { tipo: "ingreso", categoria: "ingreso_ajuste", origenTipo: "manual", origenId: null, descripcion: "Correccion" });
        await tx.walletAnotacion.create({ data: { movimientoId: ids.d2, contraparteNombre: `Cartonera ${T}nomb`, referencia: null } });
        await fila("d3", F1, mas(F1, 1), { tipo: "egreso", categoria: "egreso_gasto_variable", origenTipo: "gasto", origenId: randomUUID(), descripcion: "Gasto" });
        await tx.walletAnotacion.create({ data: { movimientoId: ids.d3, contraparteNombre: null, referencia: `REF-${T}refe` } });
        await fila("d4", F2, mas(F2, 1), { tipo: "ingreso", categoria: "ingreso_ajuste", origenTipo: "manual", origenId: null, descripcion: "Otra", registradoPor: registrador });
        await fila("d5", F2, mas(F2, 2), { tipo: "egreso", categoria: "egreso_ajuste", origenTipo: "manual", origenId: ids.d2, descripcion: "Anulacion" });
        await fila("d6", F3, mas(F3, 1), { tipo: "ingreso", categoria: "ingreso_flete", origenTipo: "cierre_dia", origenId: randomUUID(), descripcion: "Cuota 100%dto" });
        await fila("d7", F3, mas(F3, 1), { tipo: "ingreso", categoria: "ingreso_flete", origenTipo: "cierre_dia", origenId: randomUUID(), descripcion: "Cuota 100 dto" });
        await fila("d8", F3, mas(F3, 1), { tipo: "ingreso", categoria: "ingreso_flete", origenTipo: "cierre_dia", origenId: randomUUID(), descripcion: "clave a_b" });
        await fila("d9", F3, mas(F3, 1), { tipo: "ingreso", categoria: "ingreso_flete", origenTipo: "cierre_dia", origenId: randomUUID(), descripcion: "clave axb" });

        const nombre = new Map<string, Clave>(Object.entries(ids).map(([k, v]) => [v, k as Clave]));
        const deps = {
          getActor: async () => actor,
          service: s.wallet,
          origenes: new OrigenLegibleService(new OrigenLegibleRepository(s.cliente)),
        };
        const claves = (movs: { id: string }[]) =>
          movs.map((x) => nombre.get(x.id) ?? (`AJENA:${x.id}` as Clave));

        const totales: Record<string, number> = {};
        async function buscar(etiqueta: string, input: Record<string, unknown>): Promise<Clave[]> {
          const r = await listarMovimientosAction({ ...PERIODO, page: 1, pageSize: 100, sortDir: "asc", ...input }, deps);
          if (r.status !== "ok") throw new Error(`${etiqueta}: ${JSON.stringify(r)}`);
          totales[etiqueta] = r.data.total;
          return claves(r.data.movimientos);
        }

        const busquedas: Record<string, Clave[]> = {
          minusculas: await buscar("minusculas", { q: `${T}desc` }),
          nombreAnotado: await buscar("nombreAnotado", { q: `${T}NOMB` }),
          referencia: await buscar("referencia", { q: `${T}refe` }),
          registrador: await buscar("registrador", { q: `${T}regi mora` }),
          porciento: await buscar("porciento", { q: "100%dto" }),
          guionBajo: await buscar("guionBajo", { q: "e a_b" }),
          soloPorciento: await buscar("soloPorciento", { q: "%%%" }),
          ausente: await buscar("ausente", { q: `${T}nadie` }),
          comun: await buscar("comun", { q: comun }),
          conAQuien: await buscar("conAQuien", { q: comun, aQuien: { nombre: `Cartonera ${T}nomb` } }),
          conAQuienYOtroTermino: await buscar("conAQuienYOtroTermino", { q: `${T}refe`, aQuien: { nombre: `Cartonera ${T}nomb` } }),
          conTipo: await buscar("conTipo", { q: comun, tipo: "egreso" }),
        };

        // R36 — recorrer TODAS las paginas (de 2) en los dos sentidos y por los dos caminos: el de
        // Prisma (sin termino) y el SQL (con el termino comun, que casa las nueve filas).
        async function recorrer(input: Record<string, unknown>): Promise<Clave[]> {
          const todas: Clave[] = [];
          for (let page = 1; page <= 10; page += 1) {
            const r = await listarMovimientosAction({ ...PERIODO, pageSize: 2, page, ...input }, deps);
            if (r.status !== "ok") throw new Error(`recorrer: ${JSON.stringify(r)}`);
            if (r.data.movimientos.length === 0) break;
            todas.push(...claves(r.data.movimientos));
          }
          return todas;
        }
        const paginado = {
          prismaAsc: await recorrer({ sortDir: "asc" }),
          prismaDesc: await recorrer({ sortDir: "desc" }),
          sqlAsc: await recorrer({ sortDir: "asc", q: comun }),
          sqlDesc: await recorrer({ sortDir: "desc", q: comun }),
        };

        // R46 — sin orden ni termino: lo de siempre (lo mas nuevo primero).
        const sinOrdenR = await listarMovimientosAction({ ...PERIODO, page: 1, pageSize: 100 }, deps);
        if (sinOrdenR.status !== "ok") throw new Error(`sin orden: ${JSON.stringify(sinOrdenR)}`);

        // R42 — la descarga con termino y orden: el conjunto filtrado completo, en ese orden.
        const completo = { asc: [] as Clave[], desc: [] as Clave[] };
        for (const dir of ["asc", "desc"] as const) {
          const r = await listarMovimientosCompletoAction({ ...PERIODO, q: comun, sortDir: dir, tipo: "ingreso" }, deps);
          if (r.status !== "ok") throw new Error(`completo ${dir}: ${JSON.stringify(r)}`);
          completo[dir] = claves(r.items);
        }

        // R40 / R24 — el borde.
        const estado = async (input: Record<string, unknown>) => (await listarMovimientosAction(input, deps)).status;
        const bordes = {
          direccionInvalida: await estado({ ...PERIODO, sortDir: "arriba" }),
          campoInvalido: await estado({ ...PERIODO, sortBy: "monto" }),
          terminoCorto: await estado({ ...PERIODO, q: "ab" }),
          terminoCortoConEspacios: await estado({ ...PERIODO, q: "  ab  " }),
          completoDireccionInvalida: (await listarMovimientosCompletoAction({ ...PERIODO, sortDir: "x" }, deps)).status,
        };

        return {
          ids,
          nombre,
          T,
          busquedas,
          totales,
          paginado,
          completo,
          sinOrden: claves(sinOrdenR.data.movimientos),
          bordes,
        };
      });
    } catch (error) {
      fallo = error;
    }
  }, 300_000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("no-vacuidad: el termino comun casa las NUEVE filas sembradas y ninguna ajena", () => {
    expect(m().busquedas.comun).toEqual(["d1", "d2", "d3", "d4", "d5", "d6", "d7", "d8", "d9"]);
    expect(m().totales.comun).toBe(9);
  });

  it("R24: sin distinguir mayusculas (la descripcion esta en MAYUSCULAS y se busca en minusculas, y al reves)", () => {
    expect(m().busquedas.minusculas).toEqual(["d1"]);
    expect(m().busquedas.nombreAnotado).toEqual(["d2", "d5"]);
  });

  it("R25: cada campo encuentra su fila — descripcion, nombre anotado (y su contra-asiento), referencia anotada y quien registro", () => {
    const b = m().busquedas;
    expect(b.minusculas).toEqual(["d1"]); // descripcion
    expect(b.nombreAnotado).toEqual(["d2", "d5"]); // nombre anotado; d5 lo hereda de d2 (regla M2 de la 458-E)
    expect(b.referencia).toEqual(["d3"]); // referencia anotada
    expect(b.registrador).toEqual(["d4"]); // nombre COMPLETO de quien registro (nombre + apellido)
    expect(b.ausente).toEqual([]);
    expect(m().totales.ausente).toBe(0);
  });

  it("R28: `%` y `_` se buscan como texto literal", () => {
    expect(m().busquedas.porciento).toEqual(["d6"]); // sin escapar casaria tambien d7
    expect(m().busquedas.guionBajo).toEqual(["d8"]); // sin escapar casaria tambien d9
    expect(m().busquedas.soloPorciento).toEqual([]); // sin escapar devolveria el periodo entero
  });

  it("el termino convive con «A quién» y con Entra/Sale (mismo WHERE, mismo conteo)", () => {
    const b = m().busquedas;
    expect(b.conAQuien).toEqual(["d2", "d5"]);
    expect(b.conAQuienYOtroTermino).toEqual([]);
    expect(b.conTipo).toEqual(["d3", "d5"]);
    expect(m().totales.conTipo).toBe(2);
  });

  it("R36: recorrer todas las paginas da cada fila UNA vez, en los dos sentidos y por los dos caminos (Prisma y SQL)", () => {
    const cronologico: string[] = ["d1", "d2", "d3", "d4", "d5", "d6", "d7", "d8", "d9"];
    const p = m().paginado;
    expect(p.prismaAsc).toEqual(cronologico);
    expect(p.sqlAsc).toEqual(cronologico);
    // «Mas recientes» es el reverso EXACTO de «Mas antiguas»: el desempate va en el mismo sentido.
    expect(p.prismaDesc).toEqual([...cronologico].reverse());
    expect(p.sqlDesc).toEqual([...cronologico].reverse());
    for (const recorrido of Object.values(p)) expect(new Set(recorrido).size).toBe(9);
  });

  it("R34/R46: sin orden en la entrada, el libro llega en «Mas recientes» (el orden de siempre)", () => {
    expect(m().sinOrden).toEqual(["d9", "d8", "d7", "d6", "d5", "d4", "d3", "d2", "d1"]);
  });

  it("R42: la descarga trae el conjunto filtrado completo (termino + Entra/Sale) en el orden pedido", () => {
    expect(m().completo.asc).toEqual(["d1", "d2", "d4", "d6", "d7", "d8", "d9"]);
    expect(m().completo.desc).toEqual(["d9", "d8", "d7", "d6", "d4", "d2", "d1"]);
  });

  it("R40/R24: direccion o campo de orden no admitidos y termino por debajo del minimo ⇒ validation_error", () => {
    expect(m().bordes).toEqual({
      direccionInvalida: "validation_error",
      campoInvalido: "validation_error",
      terminoCorto: "validation_error",
      terminoCortoConEspacios: "validation_error",
      completoDireccionInvalida: "validation_error",
    });
  });
});
