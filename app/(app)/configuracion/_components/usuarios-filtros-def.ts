import type { RolValue } from "@prisma/client";

import type { FilterDef } from "@/components/shared/FilterComponent";
import { ROL_LABELS } from "@/lib/auth/rol-label";

// Feature 285 (design §4.2) — TODO lo especifico de usuarios vive aqui, igual que
// `ordenes-filtros-def.ts` hace con lo de ordenes. Funcion PURA: catalogo ->
// declaraciones. Sin React, sin fetch, sin estado.
//
// Este archivo NO importa NADA de `app/(app)/ordenes/`: reusar la barra es consumir
// `BuscadorFiltros`/`FilterComponent` —que son genericos de verdad—, no acoplarse al
// contrato de otro modulo (design §10, alternativa D).

/**
 * Clave del BUSCADOR. Es la misma que espera `listarUsuariosSchema`, y NO viaja como
 * lista: es un termino, no un conjunto. Vive aqui —y no como un `FilterDef` mas—
 * porque el campo lo posee `BuscadorFiltros`, que es la barra permanente.
 */
export const CLAVE_BUSQUEDA = "q";

/**
 * Clave del filtro de ROL. Es la misma que espera `listarUsuariosSchema`, asi que
 * `seleccionAFiltroUsuarios` la deja pasar tal cual salvo por la regla del vacio.
 */
export const CLAVE_ROL = "rol";

/**
 * R11: el texto de ayuda del campo DECLARA contra que se busca. Sin el, quien llega al
 * listado no tiene forma de saber si el campo alcanza el correo o solo el nombre —y un
 * buscador cuyo alcance hay que adivinar se usa mal o no se usa—. Se busca por nombre
 * O por correo, y eso es exactamente lo que dice.
 */
export const PLACEHOLDER_BUSQUEDA = "Buscar por nombre o correo";

/** Nombre accesible y etiqueta visible del filtro de rol. */
export const ETIQUETA_ROL = "Rol";

/**
 * Declara el UNICO filtro de la barra de usuarios: el rol, en seleccion MULTIPLE (R12).
 *
 * Dos diferencias DELIBERADAS con `construirFiltrosOrdenes`, escritas para que no se
 * lean como despistes:
 *
 * 1. **No recibe catalogo**, porque no hay ninguno que pedir: el rol es un ENUM de
 *    Postgres y sus etiquetas ya estan en `ROL_LABELS`, que es `Record<RolValue,string>`
 *    y por tanto EXHAUSTIVO —si el enum gana un valor, el compilador exige su etiqueta y
 *    la opcion nueva del filtro sale sola—. De ahi se sigue que no haya `useSWR` de
 *    catalogo, ni prop nueva en `page.tsx`, ni el estado degradado "el catalogo no
 *    cargo" que ordenes tuvo que inventar (R64 de alla).
 * 2. **No declara el buscador como un `FilterDef` mas.** Ordenes lo declara y luego
 *    `OrdenesListado` lo descarta por su clave para dárselo a `BuscadorFiltros`; eso es
 *    cicatriz de que la 169 llego despues de la 144. Aqui el buscador nace donde vive.
 *
 * Se filtra por el VALOR del enum y no por `rol_id`: no hay UUIDs distintos por entorno
 * que mover, y el borde puede validar "es un rol", no solo "es un string no vacio".
 */
export function construirFiltrosUsuarios(): FilterDef[] {
  return [
    {
      key: CLAVE_ROL,
      label: ETIQUETA_ROL,
      // R12: MULTIPLE. Un `single` obligaria a elegir entre ver mensajeros o ver
      // admins, cuando la pregunta habitual es "quien NO es tienda".
      kind: "multi",
      // Nada marcado = sin filtro, y el control lo dice con su propio resumen.
      placeholder: "Todos",
      searchPlaceholder: "Filtrar roles…",
      emptyMessage: "Ningún rol coincide",
      // Los SEIS roles, cada uno con su etiqueta legible en español. Se ofrece tambien
      // `apiKey` —que no es una persona— porque esas cuentas SI aparecen como filas del
      // listado, y un filtro que oculta lo que la tabla muestra es un filtro que miente.
      options: (Object.keys(ROL_LABELS) as RolValue[]).map((value) => ({
        value,
        label: ROL_LABELS[value],
      })),
    },
  ];
}
