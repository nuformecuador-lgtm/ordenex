import { randomUUID } from "node:crypto";
import type { OrdenHistorialOrigenTipo, PrismaClient } from "@prisma/client";
import type { TxDeTest } from "./_postgres-real";
import { InformeTransitoRepository } from "@/lib/repositories/InformeTransitoRepository";

// Ficha 475 — siembras de los tests de integracion del informe de transito. NO es un archivo de
// test. Todo se usa DENTRO de `enTransaccionRevertida`: no queda ni una fila.
//
// AISLAMIENTO: las zonas se crean en el test (nunca centrales: la base ya tiene la suya y el indice
// unico parcial impide otra) y el repositorio solo devuelve ordenes de las zonas que vienen en
// `cortes`. Asi las aserciones no dependen de los datos de la base compartida.
//
// Cada siembra COMPRUEBA lo que necesita (memoria «test de integracion verde sin datos»): si falta
// el catalogo, LANZA en vez de dejar el test verde sin afirmar nada.

export interface Base475 {
  readonly sufijo: string;
  readonly tiendaId: string;
  readonly provinciaId: string;
  readonly cantonId: string;
  readonly cantonNombre: string;
  readonly distritoId: string;
  readonly distritoNombre: string;
  readonly estatus: ReadonlyMap<string, string>;
}

export async function sembrarBase475(tx: TxDeTest): Promise<Base475> {
  const distrito = await tx.distrito.findFirst({
    select: { id: true, nombre: true, canton: { select: { id: true, nombre: true, provinciaId: true } } },
  });
  if (distrito === null) throw new Error("475: la base no tiene catalogo geografico (distrito)");
  const tienda = await tx.$queryRawUnsafe<{ id: string }[]>(`SELECT "id" FROM "usuario" ORDER BY "created_at" LIMIT 1`);
  if (tienda.length === 0) throw new Error("475: no hay ningun usuario en la base de test");
  const catalogo = await tx.orderStatus.findMany({ select: { id: true, value: true } });
  const estatus = new Map(catalogo.map((s) => [s.value, s.id]));
  for (const v of ["entregado", "devuelta_a_tienda", "en_bodega_central", "en_reparto", "por_recolectar_en_tienda"]) {
    if (!estatus.has(v)) throw new Error(`475: el catalogo no tiene el estado ${v}`);
  }
  return {
    sufijo: `475-${randomUUID().slice(0, 8)}`,
    tiendaId: tienda[0].id,
    provinciaId: distrito.canton.provinciaId,
    cantonId: distrito.canton.id,
    cantonNombre: distrito.canton.nombre,
    distritoId: distrito.id,
    distritoNombre: distrito.nombre,
    estatus,
  };
}

export function estatusId(base: Base475, value: string): string {
  const id = base.estatus.get(value);
  if (id === undefined) throw new Error(`475: el catalogo no tiene el estado ${value}`);
  return id;
}

export async function crearZona(tx: TxDeTest, base: Base475, nombre: string): Promise<string> {
  const z = await tx.zona.create({
    data: { nombre: `${base.sufijo}-${nombre}`, sinpeNumero: "80000000", sinpeNombre: "Titular de Prueba" },
    select: { id: true },
  });
  return z.id;
}

let guia = 1_900_000_000 + Math.floor(Math.random() * 100_000_000);

export interface SemillaOrden475 {
  clave: string;
  zonaId: string;
  estado: string;
  createdAt: Date;
  deletedAt?: Date | null;
  /** `true` asigna un numero de guia unico; `false` lo deja NULL. Por defecto `true`. */
  conGuia?: boolean;
  montoCobrar?: string | null;
  sinDistrito?: boolean;
}

export async function crearOrden(tx: TxDeTest, base: Base475, s: SemillaOrden475): Promise<{ id: string; numGuia: number | null }> {
  const numGuia = s.conGuia === false ? null : (guia += 1);
  const o = await tx.orden.create({
    data: {
      numRemision: `${base.sufijo}-${s.clave}`,
      numGuia,
      destinatario: `Cliente ${s.clave}`,
      telefonoDest: "88887777",
      producto: "caja",
      direccion: "Calle secreta 123",
      estatusId: estatusId(base, s.estado),
      tiendaId: base.tiendaId,
      zonaId: s.zonaId,
      provinciaId: base.provinciaId,
      cantonId: base.cantonId,
      distritoId: s.sinDistrito ? null : base.distritoId,
      montoCobrar: s.montoCobrar === undefined ? "18500" : s.montoCobrar,
      createdAt: s.createdAt,
      deletedAt: s.deletedAt ?? null,
    },
    select: { id: true },
  });
  return { id: o.id, numGuia };
}

export interface SemillaTransicion475 {
  at: Date;
  /** `null` = creacion. */
  origen: string | null;
  destino: string;
  origenTipo?: OrdenHistorialOrigenTipo;
  id?: string;
}

export async function transicion(tx: TxDeTest, base: Base475, ordenId: string, t: SemillaTransicion475): Promise<void> {
  await tx.ordenHistorialEstado.create({
    data: {
      id: t.id ?? randomUUID(),
      ordenId,
      estatusOrigenId: t.origen === null ? null : estatusId(base, t.origen),
      estatusDestinoId: estatusId(base, t.destino),
      origenTipo: t.origenTipo ?? (t.origen === null ? "creacion_manual" : "ajuste_estado"),
      createdAt: t.at,
    },
  });
}

/** El repositorio REAL sobre la transaccion del test. */
export function repoDeTest(tx: TxDeTest): InformeTransitoRepository {
  return new InformeTransitoRepository(tx as unknown as PrismaClient);
}

/** Un instante a `dias` dias (y `ms` milisegundos) de `base`. */
export function mas(base: Date, dias: number, ms = 0): Date {
  return new Date(base.getTime() + dias * 86_400_000 + ms);
}

/** Corte que deja entrar TODO lo sembrado (hito anterior al año 2100). */
export const CORTE_FUTURO = new Date("2100-01-01T00:00:00.000Z");
