import type {
  GeografiaFiltrosDTO,
  OpcionGeografica,
  OpcionGeograficaConPadre,
} from "@/lib/types/filtros-ordenes";
import type { NivelGeografico, ProvinciaArbolDTO } from "@/lib/types/geografia-nodo";

// El catalogo geografico global.
//
// Tenia ademas `listProvincias()`, `listCantones(provinciaId)` y `listDistritos(cantonId)`
// (feature 24/R14), la navegacion por niveles que alimentaba a `GeoService` -> `geo.ts` ->
// `ZonaForm`. Toda esa cadena se borro el 2026-08-07 por decision humana.
//
// ⚠️ FICHA 374 — DEJA DE SER SOLO LECTURA. Hasta hoy este contrato solo leia; con la
// administracion del catalogo desde la app gana el arbol completo y las tres escrituras.
//
// ⚠️ NO DECLARA `delete` NI `deleteMany` PARA NINGUNA DE LAS TRES TABLAS, Y ESO ES UNA DECISION
// ESTRUCTURAL, NO UNA PROMESA (R5). Quitar un nodo del catalogo es DESACTIVARLO. El borrado fisico
// esta fuera de alcance en cualquier condicion: `orden` congela su terna geografica y un borrado
// dejaria ordenes historicas apuntando a la nada —o, con `ON DELETE SET NULL`, vaciaria su
// `distrito_id` en silencio—. La interfaz no lo declara, la clase no lo implementa, y
// `tests/unit/guards/geografia-sin-borrado-fisico.guardia.test.ts` recorre `lib/` para que nadie
// lo añada por otro camino.
//
// ⚠️ FICHA 375 — YA SI DECLARA EL RENOMBRADO, y solo porque la clave estable existe. La 374 lo
// dejo fuera con un motivo medido: `scripts/seed-zonas.ts` resolvia la geografia por NOMBRE y, si
// no la encontraba, CREABA, asi que renombrar habria hecho que la siguiente corrida del seed creara
// un duplicado ACTIVO con el nombre viejo —y a partir de ahi `resolveGeo` responderia «distrito
// ambiguo en el canton» a toda carga que lo mencione—. El `@@unique` no lo atrapaba: los nombres
// difieren. Con `codigo_dta` el seed cruza por CODIGO y el nombre pasa a ser una ETIQUETA MUTABLE.
// El renombrado NO se puede reactivar sin esa columna: son la misma decision.
export interface IGeoRepository {
  // --- Feature 144/B2: proyecciones PLANAS para el catalogo de filtros de ordenes ---
  //
  // No se reusa `listarArbolGeografico()` (es `maestro`-only, anida y arrastra la zona
  // del distrito): el catalogo se precarga ENTERO en una sola entrega y el encadenamiento
  // se resuelve en el cliente, asi que se necesita el catalogo COMPLETO, no el de un
  // padre. Campos minimos (R54).
  //
  // FICHA 374: las tres siguen devolviendo TODOS los nodos —activos e inactivos— y añaden
  // `disponible`, la disponibilidad EFECTIVA. NO se recorta en el `WHERE` (R28): ocultar un
  // distrito retirado dejaria infiltrables las ordenes historicas de ese distrito.

  /** Todas las provincias `{id, nombre, disponible}`, orden determinista por nombre (R48/R49). */
  listProvinciasLite(): Promise<OpcionGeografica[]>;
  /** Todos los cantones `{id, nombre, padreId=provinciaId, disponible}`, por nombre (R48/R49). */
  listCantonesLite(): Promise<OpcionGeograficaConPadre[]>;
  /** Todos los distritos `{id, nombre, padreId=cantonId, disponible}`, por nombre (R48/R49). */
  listDistritosLite(): Promise<OpcionGeograficaConPadre[]>;

  /**
   * La cadena geografica ACOTADA a una zona: los distritos que la tabla puente
   * `zona_distrito` asocia a `zonaId`, mas sus cantones y provincias ascendientes.
   *
   * No es una optimizacion del catalogo completo: es OTRO catalogo. El adminSatelite solo
   * opera su zona, y ofrecerle las 494 filas del pais le deja elegir un canton que su
   * bodega no puede tener — un filtro que siempre devuelve cero y no dice por que.
   *
   * La zona sale del ACTOR, nunca de la peticion. La asociacion se lee de la N:M (feature
   * 24), que es la unica fuente de verdad desde que `distrito.zona_id` se elimino.
   */
  listGeografiaLitePorZona(zonaId: string): Promise<GeografiaFiltrosDTO>;

  // --- FICHA 374: la administracion del catalogo ---

  /**
   * El arbol COMPLETO (R26): provincia -> canton -> distrito, activos E INACTIVOS, con el flag
   * PROPIO de cada nivel y la zona UTILIZABLE de cada distrito (colapso 1/0/>1).
   *
   * NO recorta por disponibilidad, y no puede: si escondiera lo inactivo no habria forma de
   * reactivarlo desde la pantalla que existe para eso.
   */
  listArbol(): Promise<ProvinciaArbolDTO[]>;

  /**
   * Los hermanos del nivel bajo `padreId` —TODOS, activos e inactivos—, o `null` si el padre NO
   * EXISTE. Una sola consulta resuelve las DOS preguntas del alta: si el padre existe (R14) y si
   * el nombre ya esta cogido (R17).
   *
   * `padreId` es `null` solo para `provincia`, que no tiene padre; en ese caso nunca devuelve
   * `null`.
   *
   * Devuelve el nombre CRUDO: la comparacion por `normalizeName` es del service, no del `WHERE`.
   * Un `findFirst({ where: { nombre } })` compararia LITERALES y dejaria entrar «San Jose» junto a
   * «San José», que para `resolveGeo` son una sola cosa AMBIGUA (design §9, A8).
   */
  findHermanos(
    nivel: NivelGeografico,
    padreId: string | null,
  ): Promise<{ id: string; nombre: string }[] | null>;

  /**
   * Crea el nodo y devuelve su id. Nace ACTIVO (R13) por el default de la columna.
   *
   * DEJA ESCAPAR la violacion de UNIQUE a proposito: la traduce el borde a `conflict` (R18). La
   * base es la ultima palabra ante una carrera; la regla de normalizacion es del service.
   */
  crear(nivel: NivelGeografico, nombre: string, padreId: string | null): Promise<string>;

  /**
   * Cambia el flag `activo` de UNA fila Y registra la accion en la MISMA transaccion.
   *
   * TRES desenlaces, y son tres a proposito: «no existe» != «ya estaba asi» != «cambio», porque
   * SOLO EL TERCERO audita. Pedir desactivar lo ya inactivo no escribe ni el `update` ni la fila
   * de registro (R21/R53): «se pidio» y «se hizo» son cosas distintas, que es el precedente
   * literal de `VehiculoRepository.delete`.
   *
   * NO TOCA NINGUNA FILA DE LOS DESCENDIENTES (R8). Es lo que hace que reactivar sea reversible.
   */
  cambiarActivacion(
    nivel: NivelGeografico,
    id: string,
    activo: boolean,
    actorUsuarioId: string | null,
  ): Promise<"no_existe" | "sin_cambio" | "cambiado">;

  // --- FICHA 375: el renombrado ---

  /**
   * Los hermanos del nodo `id` —TODOS, activos e inactivos, INCLUIDO EL PROPIO NODO—, o `null` si
   * el nodo NO EXISTE.
   *
   * ES DISTINTO DE `findHermanos`, y por eso son dos metodos y no uno: aquel parte del PADRE (lo
   * que sabe un alta) y este del PROPIO NODO (lo que sabe un renombrado, que no recibe el padre).
   * Con una sola consulta se resuelven las dos preguntas del renombrado: si el nodo existe (R22) y
   * si el nombre nuevo ya esta cogido por un hermano.
   *
   * SE DEVUELVE EL NODO DENTRO de la lista a proposito: quien compara necesita poder EXCLUIRLO por
   * su `id` —renombrar un nodo a su propio nombre no es un conflicto—, y filtrarlo aqui dejaria al
   * service sin forma de distinguir «choca consigo mismo» de «choca con otro».
   */
  findHermanosDeNodo(
    nivel: NivelGeografico,
    id: string,
  ): Promise<{ id: string; nombre: string }[] | null>;

  /**
   * Cambia el `nombre` de UNA fila Y registra la accion en la MISMA transaccion.
   *
   * ⚠️ NO TOCA `codigo_dta`: es la clave estable y renombrar es justo la operacion que existe
   * PORQUE el nombre no lo es. Si esta escritura tocara el codigo, la siguiente corrida del seed
   * volveria a duplicar el nodo y la ficha entera no serviria para nada.
   *
   * TRES desenlaces, por el mismo motivo que `cambiarActivacion`: «no existe» != «ya se llamaba
   * asi» != «cambio», porque SOLO EL TERCERO audita. Guardar sin cambios devuelve `sin_cambio` y no
   * escribe ni el `update` ni la fila de registro.
   *
   * DEJA ESCAPAR la violacion de UNIQUE: la traduce el borde a `conflict`. La comprobacion por
   * clave NORMALIZADA es del service; la base es la ultima palabra ante una carrera.
   */
  renombrar(
    nivel: NivelGeografico,
    id: string,
    nombre: string,
    actorUsuarioId: string | null,
  ): Promise<"no_existe" | "sin_cambio" | "renombrado">;
}
