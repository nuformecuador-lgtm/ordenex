// FICHA 362 — reexports para los tests de lectura.
//
// ⚠️ `BUSQUEDA_MIN_CHARS_DEL_BORDE` se reexporta desde `lib/types/orden.ts`, que es LA MISMA
// constante que el esquema del filtro consume. Es lo que hace que el caso de R32 mida de verdad:
// si el test escribiera un `3` a mano, seguiria verde el dia que alguien cambiara la constante y
// no el control — que es exactamente la mutacion que R32 prohibe.
//
// NO es un archivo de test (no acaba en `.test.ts`): vitest no lo recoge.

export { BUSQUEDA_MIN_CHARS as BUSQUEDA_MIN_CHARS_DEL_BORDE } from "@/lib/types/orden";
export { accionesDeCategoria, filtroHistorialAccionSchema } from "@/lib/types/historial-accion";
