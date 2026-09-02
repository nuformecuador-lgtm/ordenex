// FICHA 349 — LOS CAMPOS BASE DE UNA FILA DE LA BODEGA SATELITE, EN UN SOLO SITIO.
//
// Desde la 349, `RecepcionSateliteDTO` es `FilaBodegaSatelite` = `OrdenListItemDTO` + nueve
// campos: la MISMA fila que `/ordenes`, proyectada por la MISMA `toListItemDTO`. Eso arregla el
// defecto que la ficha persigue (tres listas de campos paralelas para una sola fila), y tiene
// una consecuencia inmediata en los tests: los diez escalares de `OrdenDTO` que los fixtures no
// escribian —porque la vieja interfaz paralela no los declaraba— pasan a ser obligatorios.
//
// Escribirlos otra vez en cada uno de los catorce constructores de fila de la suite seria repetir
// el error a escala de tests. Van aqui, se ESPARCEN PRIMERO y cada fixture sigue mandando sobre
// lo suyo: ni una asercion existente cambia de valor.
//
// NO es un archivo de test (no acaba en `.test.ts`): vitest no lo recoge.

import type { FilaBodegaSatelite } from "@/lib/types/orden";

/**
 * Instante de creacion por defecto. FIJO y no `new Date()`: desde la 349 la fila lleva
 * `createdAt`, que alimenta las columnas «Fecha de creación» y «Tiempo» — un valor movil las
 * haria no deterministas.
 */
export const CREADA_EN = new Date("2026-03-01T12:00:00.000Z");

/**
 * Los campos que la vieja fila paralela no traia. Ninguno se afirma en ningun
 * caso existente: son relleno con forma correcta, no datos de prueba con significado.
 *
 * El `satisfies` los ata al tipo: si `FilaBodegaSatelite` gana un campo obligatorio, esto deja de
 * compilar aqui —en un sitio— en vez de en los catorce fixtures.
 */
export const CAMPOS_BASE_ORDEN = {
  estatusId: "st-base",
  tiendaId: "tienda-base",
  zonaId: "zona-base",
  provinciaId: "prov-base",
  cantonId: "canton-base",
  distritoId: "distrito-base",
  peso: null,
  notas: null,
  mensajeroAsignadoId: null,
  createdAt: CREADA_EN,
  updatedAt: CREADA_EN,
  // Los dos que la fila declara OBLIGATORIOS y que hasta la 349 el DTO tenia opcionales. Sus
  // valores son los NEUTROS del dominio —«no prioritaria» y «sin dia de reparto»—, no un dato
  // de prueba: los fixtures que si los afirman los sobreescriben, porque el spread va primero.
  prioridad: false,
  fechaRepartoISO: null,
} as const satisfies Partial<FilaBodegaSatelite>;
