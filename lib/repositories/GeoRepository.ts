import type { PrismaClient } from "@prisma/client";
import type { IGeoRepository } from "@/lib/interfaces/repositories/IGeoRepository";
import type {
  GeografiaFiltrosDTO,
  OpcionCatalogo,
  OpcionGeografica,
  OpcionGeograficaConPadre,
} from "@/lib/types/filtros-ordenes";
import type {
  CantonArbolDTO,
  DistritoArbolDTO,
  NivelGeografico,
  ProvinciaArbolDTO,
} from "@/lib/types/geografia-nodo";
import {
  SELECT_CADENA_CANTON,
  SELECT_CADENA_DISTRITO,
  SELECT_FLAG_PROPIO,
  disponibleDesdeCadena,
  disponibleDesdeCadenaCanton,
} from "@/lib/repositories/_shared/geografia-activa";
import { zonaUnicaDeDistrito } from "@/lib/repositories/_shared/zona-colapso";
import { appendAccion, resolverActorCongelado } from "@/lib/repositories/registrar-accion";
import { etiquetaDeEntidad } from "@/lib/types/historial-accion-etiquetas";

// FICHA 374: el `Pick` gana `$transaction`, `historialAccion` y `usuario` porque
// `cambiarActivacion` registra su accion en la MISMA transaccion del `update` — igual que lo hizo
// `VehiculoPrismaClient` en la ficha 362.
type GeoPrismaClient = Pick<
  PrismaClient,
  "provincia" | "canton" | "distrito" | "$transaction" | "historialAccion" | "usuario"
>;

// El catalogo geografico global. Solo queries Prisma; sin logica de negocio.
//
// ⚠️ FICHA 374 — YA NO ES «SOLO LECTURA», y por eso esta cabecera se reescribe en vez de dejarla
// mintiendo. Desde esta ficha el catalogo se administra desde la app y esta clase gana el arbol
// completo, el alta y el cambio de activacion. Se EXTIENDE la que habia en vez de crear un
// `GeoAdminRepository`: dos repositorios sobre las mismas tres tablas serian dos reglas que un dia
// divergen —el argumento textual de `_shared/zona-colapso.ts`—.
//
// ⚠️ NO EXPONE `delete` NI `deleteMany` PARA NINGUNA DE LAS TRES TABLAS (R5). Quitar un nodo es
// DESACTIVARLO. La interfaz no lo declara, esta clase no lo implementa, y
// `tests/unit/guards/geografia-sin-borrado-fisico.guardia.test.ts` recorre `lib/` para que nadie
// lo añada por otro camino.
//
// ⚠️ NINGUNA ESCRITURA TOCA A LOS DESCENDIENTES (R8). La disponibilidad efectiva se EVALUA al leer
// (`_shared/geografia-activa.ts`); materializarla romperia la reversibilidad de R9.
//
// Tenia ademas `listProvincias`/`listCantones`/`listDistritos` (feature 24/R14), la navegacion por
// niveles; se borro el 2026-08-07 con `GeoService` y `lib/actions/geo.ts`.
export class GeoRepository implements IGeoRepository {
  constructor(private readonly prisma: GeoPrismaClient) {}

  // --- Feature 144/B2 (R48/R49/R54): proyecciones planas del catalogo completo ---
  //
  // FICHA 374: las tres PROYECTAN la disponibilidad efectiva y NO recortan (R28/R31). En geografia
  // el desplegable es la UNICA via —nadie teclea un uuid—, asi que ocultar un nodo retirado
  // dejaria INFILTRABLES las ordenes historicas de ese nodo. Es al reves que en la ficha 351, y
  // por eso se razona en vez de copiarse.

  async listProvinciasLite(): Promise<OpcionGeografica[]> {
    const rows = await this.prisma.provincia.findMany({
      select: { id: true, nombre: true, ...SELECT_FLAG_PROPIO },
      orderBy: { nombre: "asc" }, // R49: orden determinista
    });
    // Una provincia no tiene ascendiente: su flag propio ES su disponibilidad efectiva.
    return rows.map((r) => ({ id: r.id, nombre: r.nombre, disponible: r.activo }));
  }

  async listCantonesLite(): Promise<OpcionGeograficaConPadre[]> {
    const rows = await this.prisma.canton.findMany({
      select: { id: true, nombre: true, provinciaId: true, ...SELECT_CADENA_CANTON },
      orderBy: { nombre: "asc" },
    });
    // `padreId` en vez de `provinciaId`: el consumidor generico no sabe de geografia,
    // solo de "padre" (R48).
    return rows.map((r) => ({
      id: r.id,
      nombre: r.nombre,
      padreId: r.provinciaId,
      disponible: disponibleDesdeCadenaCanton(r),
    }));
  }

  async listDistritosLite(): Promise<OpcionGeograficaConPadre[]> {
    // Sin `zonas`: la zona de la ORDEN esta congelada en `orden.zona_id` y no se
    // deriva del distrito (decision (b) del spec). Traerla aqui seria peso muerto en
    // el payload de las 494 filas.
    const rows = await this.prisma.distrito.findMany({
      select: { id: true, nombre: true, cantonId: true, ...SELECT_CADENA_DISTRITO },
      orderBy: { nombre: "asc" },
    });
    return rows.map((r) => ({
      id: r.id,
      nombre: r.nombre,
      padreId: r.cantonId,
      disponible: disponibleDesdeCadena(r),
    }));
  }

  /**
   * La cadena geografica de UNA zona (contrato en `IGeoRepository`). Una sola consulta:
   * los distritos asociados a la zona por la N:M, con su canton y la provincia de ese
   * canton; provincias y cantones se DERIVAN de esas filas en vez de pedirse aparte,
   * porque «los cantones de la zona» son exactamente los de sus distritos y dos consultas
   * mas podrian dar un conjunto distinto si la puente cambiara entre medias.
   *
   * El orden por nombre lo fija la consulta para los distritos y la insercion en el `Map`
   * para los otros dos niveles; los tres se reordenan al final para no depender de eso.
   */
  async listGeografiaLitePorZona(zonaId: string): Promise<GeografiaFiltrosDTO> {
    const rows = await this.prisma.distrito.findMany({
      where: { zonas: { some: { zonaId } } },
      select: {
        id: true,
        nombre: true,
        cantonId: true,
        ...SELECT_CADENA_DISTRITO,
        canton: {
          select: {
            id: true,
            nombre: true,
            provinciaId: true,
            ...SELECT_CADENA_CANTON,
            provincia: { select: { id: true, nombre: true, ...SELECT_FLAG_PROPIO } },
          },
        },
      },
      orderBy: { nombre: "asc" },
    });

    const provincias = new Map<string, OpcionGeografica>();
    const cantones = new Map<string, OpcionGeograficaConPadre>();
    for (const row of rows) {
      provincias.set(row.canton.provincia.id, {
        id: row.canton.provincia.id,
        nombre: row.canton.provincia.nombre,
        disponible: row.canton.provincia.activo,
      });
      cantones.set(row.canton.id, {
        id: row.canton.id,
        nombre: row.canton.nombre,
        padreId: row.canton.provinciaId,
        disponible: disponibleDesdeCadenaCanton(row.canton),
      });
    }

    const porNombre = (a: OpcionCatalogo, b: OpcionCatalogo) =>
      a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" });

    return {
      provincias: [...provincias.values()].sort(porNombre),
      cantones: [...cantones.values()].sort(porNombre),
      distritos: rows
        .map((r) => ({
          id: r.id,
          nombre: r.nombre,
          padreId: r.cantonId,
          disponible: disponibleDesdeCadena(r),
        }))
        .sort(porNombre),
    };
  }

  // --- FICHA 374: la administracion del catalogo ---

  /**
   * El arbol COMPLETO (R26). MUDADO desde `lib/actions/geografia.ts`, donde vivia contra Prisma
   * directo porque «el catalogo es de solo lectura»; esa premisa muere con la primera escritura.
   *
   * La consulta es la misma salvo DOS cambios, los dos deliberados:
   *
   *  1. proyecta `activo` en los tres niveles (el flag PROPIO, no la efectiva): la pantalla de
   *     administracion necesita distinguir «inactivo» de «inactivo POR SU CANTON», y para eso el
   *     padre tiene que estar literalmente encima en el mismo arbol;
   *
   *  2. ⚠️ las zonas del distrito YA NO son `take: 1`. Con `take: 1`, un distrito en DOS zonas
   *     mostraba «(zona: X)» aunque la carga masiva lo rechaza por ambiguo —`zonaUnicaDeDistrito`
   *     colapsa >1 a `null`—: esa etiqueta MENTIA, y la marca «sin zona» de la pantalla nueva
   *     heredaria la mentira. Ahora se piden todas y se aplica el MISMO colapso 1/0/>1 que usan la
   *     carga y la correccion. Medido en produccion el 2026-09-05: 0 distritos con mas de una
   *     zona, asi que hoy no cambia lo que nadie ve — pero la señal nueva no se construye sobre
   *     una rota.
   */
  async listArbol(): Promise<ProvinciaArbolDTO[]> {
    const provincias = await this.prisma.provincia.findMany({
      orderBy: { nombre: "asc" },
      select: {
        id: true,
        nombre: true,
        ...SELECT_FLAG_PROPIO,
        cantones: {
          orderBy: { nombre: "asc" },
          select: {
            id: true,
            nombre: true,
            ...SELECT_FLAG_PROPIO,
            distritos: {
              orderBy: { nombre: "asc" },
              select: {
                id: true,
                nombre: true,
                zonaEspecial: true,
                ...SELECT_FLAG_PROPIO,
                zonas: { select: { zona: { select: { id: true, nombre: true } } } },
              },
            },
          },
        },
      },
    });

    return provincias.map(
      (p): ProvinciaArbolDTO => ({
        id: p.id,
        nombre: p.nombre,
        activo: p.activo,
        cantones: p.cantones.map(
          (c): CantonArbolDTO => ({
            id: c.id,
            nombre: c.nombre,
            activo: c.activo,
            distritos: c.distritos.map((d): DistritoArbolDTO => {
              // El colapso 1/0/>1, compartido: `null` con 0 zonas Y TAMBIEN con mas de una.
              const zona = zonaUnicaDeDistrito(d.zonas)?.zona ?? null;
              return {
                id: d.id,
                nombre: d.nombre,
                zonaId: zona?.id ?? null,
                zonaNombre: zona?.nombre ?? null,
                // `=== true` y no `!!`: con `null` los dos dan false, pero esto deja
                // dicho que la columna es tri-valuada y que null NO es "no especial".
                zonaEspecial: d.zonaEspecial === true,
                activo: d.activo,
              };
            }),
          }),
        ),
      }),
    );
  }

  /**
   * Los hermanos del nivel bajo `padreId`, o `null` si el padre no existe. UNA consulta resuelve
   * las dos preguntas del alta (R14 y R17).
   *
   * Trae ACTIVOS E INACTIVOS: un nombre ocupado por un hermano retirado sigue ocupado, porque el
   * UNIQUE de la base no distingue estados y porque reactivarlo despues chocaria con el nuevo.
   */
  async findHermanos(
    nivel: NivelGeografico,
    padreId: string | null,
  ): Promise<{ id: string; nombre: string }[] | null> {
    if (nivel === "provincia") {
      // La provincia no tiene padre: no hay nada que comprobar y nunca devuelve `null`.
      return this.prisma.provincia.findMany({ select: { id: true, nombre: true } });
    }
    if (padreId === null) return null;

    if (nivel === "canton") {
      const padre = await this.prisma.provincia.findUnique({
        where: { id: padreId },
        select: {
          cantones: { select: { id: true, nombre: true } },
        },
      });
      return padre === null ? null : padre.cantones;
    }

    const padre = await this.prisma.canton.findUnique({
      where: { id: padreId },
      select: {
        distritos: { select: { id: true, nombre: true } },
      },
    });
    return padre === null ? null : padre.distritos;
  }

  /**
   * Crea el nodo y devuelve su id. Nace ACTIVO por el default de la columna (R13), tambien si su
   * padre esta retirado: el flag es suyo y la cascada se evalua aparte (R15).
   *
   * DEJA ESCAPAR la violacion de UNIQUE: el borde la traduce a `conflict` (R18). La base es la
   * ultima palabra ante una carrera.
   */
  async crear(nivel: NivelGeografico, nombre: string, padreId: string | null): Promise<string> {
    if (nivel === "provincia") {
      const fila = await this.prisma.provincia.create({ data: { nombre }, select: { id: true } });
      return fila.id;
    }
    if (padreId === null) {
      // No es alcanzable desde el service (comprueba el padre antes) ni desde el borde (el schema
      // lo exige). Se lanza en vez de crear una fila huerfana: un `null` aqui seria un defecto de
      // programacion, no una entrada de usuario.
      throw new Error(`falta el padre para crear un ${nivel}`);
    }
    if (nivel === "canton") {
      const fila = await this.prisma.canton.create({
        data: { nombre, provinciaId: padreId },
        select: { id: true },
      });
      return fila.id;
    }
    const fila = await this.prisma.distrito.create({
      data: { nombre, cantonId: padreId },
      select: { id: true },
    });
    return fila.id;
  }

  /**
   * FICHA 374 (R8/R21/R22/R51/R52/R53/R55) — cambia el flag `activo` de UNA fila y registra la
   * accion en la MISMA transaccion.
   *
   * LOS CINCO PASOS, EN ESTE ORDEN Y POR ESTE MOTIVO:
   *   1. leer el nodo -> `null` es «no existe» (R22), y de paso captura el estado previo Y las
   *      piezas de la etiqueta en una sola consulta;
   *   2. si el flag YA estaba asi, `sin_cambio` SIN ESCRIBIR NADA (R21/R53). «Se pidio» y «se
   *      hizo» son cosas distintas: es el precedente literal de `VehiculoRepository.delete`;
   *   3. el `update` — la UNICA escritura, y solo de ESTA fila (R8);
   *   4. congelar el actor dentro de la tx;
   *   5. `appendAccion` DENTRO del callback. Escrito fuera, el test no lo ve fallar (leccion de la
   *      ficha 373).
   *
   * R55 SALE GRATIS Y SIN NINGUN `try` DE RESCATE: dentro de una transaccion de Postgres un error
   * de sentencia aborta la transaccion entera, asi que no hay orden posible que deje el flag
   * cambiado y el registro sin escribir.
   *
   * `valorAnterior`/`valorNuevo` van en NULL a proposito: el PAR de tipos ya dice la transicion.
   */
  async cambiarActivacion(
    nivel: NivelGeografico,
    id: string,
    activo: boolean,
    actorUsuarioId: string | null,
  ): Promise<"no_existe" | "sin_cambio" | "cambiado"> {
    return this.prisma.$transaction(async (tx) => {
      const previo = await leerNodoParaActivacion(tx, nivel, id);
      if (previo === null) return "no_existe";
      if (previo.activo === activo) return "sin_cambio";

      if (nivel === "provincia") {
        await tx.provincia.update({ where: { id }, data: { activo } });
      } else if (nivel === "canton") {
        await tx.canton.update({ where: { id }, data: { activo } });
      } else {
        await tx.distrito.update({ where: { id }, data: { activo } });
      }

      const actor = await resolverActorCongelado(tx, actorUsuarioId);
      await appendAccion(tx, [
        {
          accion: activo ? "nodo_geografico_activado" : "nodo_geografico_desactivado",
          entidadTipo: nivel,
          entidadId: id,
          entidadEtiqueta: etiquetaDelNodo(nivel, previo),
          ...actor,
          monto: null,
          valorAnterior: null,
          valorNuevo: null,
        },
      ]);
      return "cambiado";
    });
  }
}

/** El estado previo del nodo mas las piezas de su etiqueta, leidas de una vez. */
interface NodoPrevio {
  activo: boolean;
  nombre: string;
  cantonNombre: string | null;
  provinciaNombre: string | null;
}

type GeoTx = Pick<GeoPrismaClient, "provincia" | "canton" | "distrito">;

async function leerNodoParaActivacion(
  tx: GeoTx,
  nivel: NivelGeografico,
  id: string,
): Promise<NodoPrevio | null> {
  if (nivel === "provincia") {
    const fila = await tx.provincia.findUnique({
      where: { id },
      select: { ...SELECT_FLAG_PROPIO, nombre: true },
    });
    return fila === null
      ? null
      : { ...fila, cantonNombre: null, provinciaNombre: null };
  }
  if (nivel === "canton") {
    const fila = await tx.canton.findUnique({
      where: { id },
      select: { ...SELECT_FLAG_PROPIO, nombre: true, provincia: { select: { nombre: true } } },
    });
    return fila === null
      ? null
      : {
          activo: fila.activo,
          nombre: fila.nombre,
          cantonNombre: null,
          provinciaNombre: fila.provincia.nombre,
        };
  }
  const fila = await tx.distrito.findUnique({
    where: { id },
    select: {
      ...SELECT_FLAG_PROPIO,
      nombre: true,
      canton: { select: { nombre: true, provincia: { select: { nombre: true } } } },
    },
  });
  return fila === null
    ? null
    : {
        activo: fila.activo,
        nombre: fila.nombre,
        cantonNombre: fila.canton.nombre,
        provinciaNombre: fila.canton.provincia.nombre,
      };
}

/**
 * La etiqueta CONGELADA del nodo: la cadena de nombres hasta la raiz.
 *
 * Se llama a `etiquetaDeEntidad` con el literal del nivel y no con la variable para que el tipo
 * de la fuente sea el de ESE nivel; un `etiquetaDeEntidad(nivel, …)` generico aceptaria una fuente
 * que no le corresponde.
 */
function etiquetaDelNodo(nivel: NivelGeografico, fila: NodoPrevio): string {
  if (nivel === "provincia") return etiquetaDeEntidad("provincia", { nombre: fila.nombre });
  if (nivel === "canton") {
    return etiquetaDeEntidad("canton", {
      nombre: fila.nombre,
      provinciaNombre: fila.provinciaNombre,
    });
  }
  return etiquetaDeEntidad("distrito", {
    nombre: fila.nombre,
    cantonNombre: fila.cantonNombre,
    provinciaNombre: fila.provinciaNombre,
  });
}
