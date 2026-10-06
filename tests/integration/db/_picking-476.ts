import { randomUUID } from "node:crypto";
import type { PrismaClient, RolValue } from "@prisma/client";
import type { TxDeTest } from "./_postgres-real";
import { PickingRepository } from "@/lib/repositories/PickingRepository";

// Ficha 476 — siembras de los tests de integracion del picking. NO es un archivo de test. Todo se
// usa DENTRO de `enTransaccionRevertida`: no queda ni una fila.
//
// AISLAMIENTO: las tiendas se CREAN en el test, asi que «las ordenes de esta tienda» son solo las
// sembradas aqui, y los conjuntos se afirman EXACTOS (no `> 0`). Las lecturas que miran todas las
// tiendas (`entradasEnPreparacion`, el resumen) se filtran por las tiendas sembradas.
//
// Cada siembra COMPRUEBA lo que necesita (memoria «test de integracion verde sin datos»): si falta
// un catalogo, LANZA en vez de dejar el test verde sin afirmar nada.

export const UN_DIA = 24 * 60 * 60 * 1000;

export interface Base476 {
  readonly sufijo: string;
  readonly tipoIdentificacionId: string;
  readonly roles: ReadonlyMap<string, string>;
  readonly zonaId: string;
  readonly provinciaId: string;
  readonly cantonId: string;
  readonly distritoId: string;
  readonly estatus: ReadonlyMap<string, string>;
}

export async function sembrarBase476(tx: TxDeTest): Promise<Base476> {
  const distrito = await tx.distrito.findFirst({
    select: { id: true, canton: { select: { id: true, provinciaId: true } } },
  });
  if (distrito === null) throw new Error("476: la base no tiene catalogo geografico (distrito)");
  const zona = await tx.zona.findFirst({ select: { id: true } });
  if (zona === null) throw new Error("476: la base no tiene ninguna zona");
  const tipo = await tx.tipoIdentificacion.findFirst({ select: { id: true } });
  if (tipo === null) throw new Error("476: la base no tiene tipos de identificacion");
  const roles = new Map((await tx.rol.findMany({ select: { id: true, value: true } })).map((r) => [r.value as string, r.id]));
  for (const r of ["adminTienda", "admin"]) if (!roles.has(r)) throw new Error(`476: falta el rol ${r}`);
  const estatus = new Map((await tx.orderStatus.findMany({ select: { id: true, value: true } })).map((s) => [s.value, s.id]));
  for (const v of ["en_preparacion", "en_bodega_central"]) if (!estatus.has(v)) throw new Error(`476: falta el estado ${v}`);
  return {
    sufijo: `476-${randomUUID().slice(0, 8)}`,
    tipoIdentificacionId: tipo.id,
    roles,
    zonaId: zona.id,
    provinciaId: distrito.canton.provinciaId,
    cantonId: distrito.canton.id,
    distritoId: distrito.id,
    estatus,
  };
}

export function estatusId(base: Base476, value: string): string {
  const id = base.estatus.get(value);
  if (id === undefined) throw new Error(`476: el catalogo no tiene el estado ${value}`);
  return id;
}

/** Un usuario (por defecto una TIENDA `adminTienda`) con el fulfillment pedido. */
export async function crearTienda(
  tx: TxDeTest,
  base: Base476,
  nombre: string,
  o: { fulfillment: boolean; rol?: RolValue },
): Promise<string> {
  const slug = `${base.sufijo}-${randomUUID().slice(0, 8)}`;
  const rolId = base.roles.get(o.rol ?? "adminTienda");
  if (rolId === undefined) throw new Error(`476: falta el rol ${o.rol}`);
  const u = await tx.usuario.create({
    data: {
      nombre: `${base.sufijo} ${nombre}`,
      email: `${slug}@tienda.invalid`,
      telefono: "88880000",
      passwordHash: "x",
      cedula: `T-${slug}`,
      tipoIdentificacionId: base.tipoIdentificacionId,
      rolId,
      estado: "activo",
      fulfillment: o.fulfillment,
    },
    select: { id: true },
  });
  return u.id;
}

export interface SemillaOrden476 {
  tiendaId: string;
  remision: string;
  estado: string;
  createdAt: Date;
  producto?: string;
  deletedAt?: Date | null;
  numGuia?: number | null;
}

export async function crearOrden(tx: TxDeTest, base: Base476, s: SemillaOrden476): Promise<string> {
  const o = await tx.orden.create({
    data: {
      numRemision: s.remision,
      numGuia: s.numGuia ?? null,
      destinatario: "Cliente de prueba",
      telefonoDest: "88887777",
      producto: s.producto ?? "1 * Producto de prueba",
      direccion: "Calle 1",
      estatusId: estatusId(base, s.estado),
      tiendaId: s.tiendaId,
      zonaId: base.zonaId,
      provinciaId: base.provinciaId,
      cantonId: base.cantonId,
      distritoId: base.distritoId,
      createdAt: s.createdAt,
      deletedAt: s.deletedAt ?? null,
    },
    select: { id: true },
  });
  return o.id;
}

/** Una transicion del historial hacia `destino` en el instante `at`. */
export async function transicion(tx: TxDeTest, base: Base476, ordenId: string, destino: string, at: Date, origen: string | null = null): Promise<void> {
  await tx.ordenHistorialEstado.create({
    data: {
      id: randomUUID(),
      ordenId,
      estatusOrigenId: origen === null ? null : estatusId(base, origen),
      estatusDestinoId: estatusId(base, destino),
      origenTipo: origen === null ? "creacion_manual" : "ajuste_estado",
      createdAt: at,
    },
  });
}

/** El repositorio REAL sobre la transaccion del test. */
export function repoDeTest(tx: TxDeTest): PickingRepository {
  return new PickingRepository(tx as unknown as PrismaClient);
}

/**
 * El escenario comun (design §7, R6):
 *   - tienda A (fulfillment): a1 `NA-1069` sin historial (creada hace 3 dias), a2 `NA-107` creada
 *     hace 10 dias con DOS entradas a preparacion (hace 8 y hace 1 dia), a3 `BS-3` creada hace 6
 *     dias; mas una en `en_bodega_central` y una BORRADA en preparacion, que NO deben salir;
 *   - tienda B (fulfillment): b1 en preparacion;
 *   - tienda C (SIN fulfillment): c1 en preparacion;
 *   - tienda D (fulfillment) sin ordenes;
 *   - usuario E `admin` con `fulfillment = true` (no es tienda) y una orden en preparacion.
 */
export async function sembrarEscenario(tx: TxDeTest, ahora: Date) {
  const base = await sembrarBase476(tx);
  const hace = (dias: number) => new Date(ahora.getTime() - dias * UN_DIA);
  const A = await crearTienda(tx, base, "Alfa", { fulfillment: true });
  const B = await crearTienda(tx, base, "Beta", { fulfillment: true });
  const C = await crearTienda(tx, base, "Gamma sin fulfillment", { fulfillment: false });
  const D = await crearTienda(tx, base, "Delta vacia", { fulfillment: true });
  const E = await crearTienda(tx, base, "Epsilon admin", { fulfillment: true, rol: "admin" });

  const a1 = await crearOrden(tx, base, { tiendaId: A, remision: "NA-1069", estado: "en_preparacion", createdAt: hace(3), producto: "2 * Crema X" });
  const a2 = await crearOrden(tx, base, { tiendaId: A, remision: "NA-107", estado: "en_preparacion", createdAt: hace(10), producto: "1 * Base C." });
  await transicion(tx, base, a2, "en_preparacion", hace(8));
  await transicion(tx, base, a2, "en_preparacion", hace(1), "en_preparacion");
  const a3 = await crearOrden(tx, base, { tiendaId: A, remision: "BS-3", estado: "en_preparacion", createdAt: hace(6), producto: "1 * Crema X" });
  const aOtroEstado = await crearOrden(tx, base, { tiendaId: A, remision: "NA-1", estado: "en_bodega_central", createdAt: hace(2) });
  const aBorrada = await crearOrden(tx, base, { tiendaId: A, remision: "NA-2", estado: "en_preparacion", createdAt: hace(2), deletedAt: hace(1) });
  const b1 = await crearOrden(tx, base, { tiendaId: B, remision: "GM-1", estado: "en_preparacion", createdAt: hace(0) });
  const c1 = await crearOrden(tx, base, { tiendaId: C, remision: "SC-1", estado: "en_preparacion", createdAt: hace(4) });
  const e1 = await crearOrden(tx, base, { tiendaId: E, remision: "EP-1", estado: "en_preparacion", createdAt: hace(4) });

  return { base, hace, tiendas: { A, B, C, D, E }, ordenes: { a1, a2, a3, aOtroEstado, aBorrada, b1, c1, e1 } };
}
