# Ficha 374 — Administrar el catálogo geográfico desde la app · design

> Cubre `requirements.md` R1–R50. Todo lo que sigue se apoya en el árbol leído el 2026-09-05; las
> referencias `archivo:línea` son verificables y las tres que **no** cuadraban con el encargo están
> declaradas en `requirements.md §0.3` en vez de repetidas.

## 0. La decisión, en una frase

Las tres tablas del catálogo ganan **una columna booleana propia** (`activo`), la disponibilidad
real se calcula **al leer** como la conjunción con los ascendientes, y el catálogo pasa a
administrarse por la cadena de siempre —Server Action → `GeografiaService` → `GeoRepository`, DI
por interfaces, molde de vehículos— **sin ningún borrado físico y sin renombrado**.

```
Provincia  activo=false  ──┐
  Cantón   activo=true   ──┤ disponibilidad efectiva = AND de la cadena, EVALUADA en la query
    Distrito activo=true ──┘ (nadie escribe en los hijos: por eso reactivar es reversible)
```

---

## 1. Lo que NO se toca

| Decisión | Motivo |
| --- | --- |
| Ninguna tabla ni FK nuevas | Tres columnas y tres índices únicos; el resto del esquema queda igual |
| La RLS | `provincia`, `canton` y `distrito` ya la tienen desde `20260709130000_ordenes_catalogos_geografia/migration.sql:71-73`. No hay tabla nueva que proteger y una columna no cambia una política |
| `distrito.zona_especial` | Sigue siendo `Boolean?` **a propósito**. Ver §2.2: es lo contrario de `activo` y hay que decirlo o alguien lo homogeneiza |
| `zona_distrito` | Desactivar **no** escribe en la puente (R50). La zona se administra en Tarifas |
| `actualizarDistritosEspeciales` (`lib/actions/geografia.ts:133-166`) | Escritura viva del flujo de Tarifas, con Prisma directo. Moverla no aporta nada a esta ficha y sí arriesga algo que funciona. Queda declarado, no escondido |
| `scripts/seed-zonas.ts` | No se toca **y no hace falta**: cuando encuentra la fila por nombre devuelve su id y **no escribe** (`:110-111,121,134`), así que nunca reactiva lo desactivado ni duplica lo existente |
| Los `down.sql` anteriores | Son fotos históricas |
| `GeografiaSelector` como componente | Se **extiende** (R47), no se extrae ni se reescribe. Ver §7.3 |

---

## 2. Modelo de datos

### 2.1 La migración

`db/migrations/20260906120000_geografia_activo_y_unicidad/migration.sql` — ajustar el timestamp si
otra migración ocupa ese minuto en `origin/dev`.

```sql
-- FICHA 374 — el catalogo geografico se administra desde la app.
--
-- QUE AÑADE. (1) `activo` en los tres niveles, para poder RETIRAR un nodo sin borrarlo; (2) la
-- unicidad por padre que hasta hoy no existia y que la administracion por pantalla necesita.
--
-- POR QUE `NOT NULL DEFAULT true` Y NO NULLABLE, a diferencia de `distrito.zona_especial`. Alli
-- `NULL` significa algo — «nadie lo decidio todavia»— y por eso la columna es tri-valuada
-- (`20260824180000_distrito_zona_especial`, lineas 12-21). Aqui NO significa nada: todo nodo del
-- catalogo esta hoy operativo, `true` es el dato VERDADERO para las 494+84+7 filas y no un relleno
-- de conveniencia. Dejarla nullable obligaria a que cada lectura escribiera `activo IS NOT FALSE`
-- para no perder filas, y la primera que lo olvidara vaciaria un desplegable en silencio.
--
-- SIN INDICE SOBRE `activo`, por el MISMO razonamiento que ya escribio
-- `20260824180000_distrito_zona_especial` (lineas 28-31): un booleano casi siempre `true` tiene
-- selectividad pesima y el planificador recorreria la tabla igual. Y aqui hay un argumento mas
-- fuerte: la tabla mas grande son 494 filas y las lecturas piden el catalogo ENTERO, no un
-- subconjunto. `gasto_fijo_plantilla` SI lleva `@@index([activa])` (schema.prisma:1896) porque un
-- CRON filtra por ella sobre una tabla que crece; aqui no hay cron ni crecimiento.
--
-- LOS TRES UNIQUE. Hasta hoy no habia ninguno: lo dice la propia migracion de la DTA
-- (20260905175156, lineas 23-25), que por eso tuvo que ser idempotente con `WHERE NOT EXISTS` en
-- vez de `ON CONFLICT`. El alcance es POR PADRE y no global, porque los homonimos entre padres son
-- normales en la DTA: "Buenos Aires" es canton de Puntarenas y distrito de Palmares (Alajuela).
-- MEDIDO EN PRODUCCION el 2026-09-05: 0 duplicados en los tres niveles, asi que entran sin
-- limpieza previa. En cualquier otra base hay que medirlo ANTES (tasks A0).
ALTER TABLE "provincia" ADD COLUMN "activo" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "canton"    ADD COLUMN "activo" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "distrito"  ADD COLUMN "activo" BOOLEAN NOT NULL DEFAULT true;

CREATE UNIQUE INDEX "provincia_nombre_key"          ON "provincia" ("nombre");
CREATE UNIQUE INDEX "canton_provincia_id_nombre_key" ON "canton"   ("provincia_id", "nombre");
CREATE UNIQUE INDEX "distrito_canton_id_nombre_key"  ON "distrito" ("canton_id", "nombre");
```

**`down.sql`** — revierte exactamente eso y nada más:

```sql
-- DOWN (ficha 374).
-- PERDIDA DE DATO DECLARADA: se va la marca `activo` de todo nodo retirado. Nace en el `up` y no
-- hay copia en ninguna otra tabla; revertir es soltarla. NINGUNA fila de provincia/canton/distrito
-- ni de zona_distrito se borra ni se modifica (R2).
-- Los indices se sueltan ANTES que las columnas por claridad, aunque no dependan de ellas.
DROP INDEX IF EXISTS "distrito_canton_id_nombre_key";
DROP INDEX IF EXISTS "canton_provincia_id_nombre_key";
DROP INDEX IF EXISTS "provincia_nombre_key";
ALTER TABLE "distrito"  DROP COLUMN IF EXISTS "activo";
ALTER TABLE "canton"    DROP COLUMN IF EXISTS "activo";
ALTER TABLE "provincia" DROP COLUMN IF EXISTS "activo";
```

### 2.2 `db/schema.prisma`

```prisma
model Provincia {
  id     String  @id @default(uuid())
  nombre String
  /// FICHA 374 — retirar sin borrar. `NOT NULL` con default `true`, a diferencia de
  /// `Distrito.zonaEspecial`, que es `Boolean?` porque alli `null` SIGNIFICA algo («nadie lo
  /// decidio»). Aqui no significa nada y la columna es de dos valores: NO homogeneizar las dos.
  /// La cascada NO se materializa: ver `_shared/geografia-activa.ts`.
  activo Boolean @default(true)

  cantones Canton[]
  ordenes  Orden[]

  @@unique([nombre]) // ficha 374: 0 duplicados medidos en produccion el 2026-09-05
  @@map("provincia")
}

model Canton {
  // …
  activo Boolean @default(true)
  @@unique([provinciaId, nombre]) // por PADRE: hay cantones homonimos en provincias distintas
  @@index([provinciaId])
  @@map("canton")
}

model Distrito {
  // …
  activo Boolean @default(true)
  @@unique([cantonId, nombre])
  @@index([cantonId])
  @@map("distrito")
}
```

**El nombre de la columna es `activo` en las tres, también en `provincia`.** Gramaticalmente
tocaría `activa`; se elige la uniformidad porque el predicado compartido y los fragmentos `where`
de §3 se escriben una sola vez y se leen igual en los tres niveles. Queda dicho aquí para que no
se «corrija».

### 2.3 La cascada se evalúa, no se materializa

Materializarla —un `updateMany` a los hijos al desactivar el padre— es la alternativa obvia y
**está descartada** (§8, A1) por un motivo que no es de estilo: **rompería R9**. Al reactivar un
cantón no habría forma de saber qué distritos estaban inactivos *por su cuenta* antes, así que la
reactivación los encendería todos. La reversibilidad exige que el flag de cada fila sea solo suyo.

De ahí sale la regla que hay que escribir en voz alta, porque sin ella alguien escribe un
`updateMany` de limpieza:

> **«Un distrito activo bajo un cantón inactivo» es un estado REPRESENTABLE y NO es un bug.**
> Significa «el distrito está bien; su cantón se retiró». No hay nada que reparar. (R10)

---

## 3. El predicado, en un solo sitio

`lib/repositories/_shared/geografia-activa.ts`, hermano de `_shared/zona-colapso.ts`. El argumento
de por qué vive en un solo sitio ya está escrito en el hermano (`zona-colapso.ts:12-17`): dos
copias son dos reglas que un día divergen, y la que divergiera dejaría fuera —o dentro— filas del
catálogo sin romper ningún test.

```ts
/**
 * FICHA 374 — LA DISPONIBILIDAD EFECTIVA DEL CATALOGO GEOGRAFICO, EN UN SOLO SITIO.
 *
 * El flag `activo` de cada fila es una decision SOBRE ESA FILA. Lo que decide si un nodo se puede
 * usar es la conjuncion con sus ascendientes, y se evalua AL LEER (design §2.3).
 *
 * Este modulo NO importa nada de `@prisma/client`: los fragmentos `where` son literales que Prisma
 * acepta estructuralmente. Asi lo puede importar tambien `lib/services/geo-resolucion.ts`, que es
 * logica pura y no conoce Prisma.
 */

/** Los flags PROPIOS de la cadena de un distrito. */
export interface FlagsGeograficos {
  provincia: boolean;
  canton: boolean;
  distrito?: boolean;
}

/** La conjuncion. `undefined` en un nivel = «ese nivel no participa» (un canton no tiene distrito). */
export function estaDisponible(flags: FlagsGeograficos): boolean;

/** `where` para las lecturas que SI recortan (§4, filas 3 y 6 de la tabla). */
export const WHERE_PROVINCIA_DISPONIBLE = { activo: true } as const;
export const WHERE_CANTON_DISPONIBLE = { activo: true, provincia: { activo: true } } as const;
export const WHERE_DISTRITO_DISPONIBLE = {
  activo: true,
  canton: { activo: true, provincia: { activo: true } },
} as const;

/** `select` para las lecturas que NO recortan y tienen que PROYECTAR la cadena. */
export const SELECT_CADENA_DISTRITO = {
  activo: true,
  canton: { select: { activo: true, provincia: { select: { activo: true } } } },
} as const;
```

Una guardia (R11) recorre `lib/` y exige que toda referencia a `activo` sobre estas tres tablas
pase por uno de esos símbolos: un `where: { activo: true }` escrito a mano en un repositorio pone
el árbol rojo. Con **contraprueba** sobre un cuerpo mutado en memoria, que es el estilo de
`tests/unit/guards/`.

---

## 4. Hay UN catálogo, no dos — y qué hace cada lectura

Esto es lo que más importa del diseño, así que va con su porqué fila a fila. **No se parte el
catálogo en dos**: la bandera viaja en el DTO y filtra el consumidor, que es exactamente lo que ya
hace `CuentaTiendaDTO.activa` (`lib/types/filtros-ordenes.ts:42-45`, ficha 351).

| Sitio | ¿Oculta lo retirado? | Por qué |
| --- | --- | --- |
| `GeografiaService.listarArbol` (pantalla nueva) | **No** | Si escondiera lo inactivo no habría cómo reactivarlo |
| `GeoRepository.list*Lite` (catálogo de filtros) | **No; proyecta `disponible`** | En geografía el desplegable es la **única** vía: nadie teclea un uuid. Ocultarlos dejaría **infiltrables** las órdenes históricas de un distrito retirado. **Es al revés que en la ficha 351** y por eso se razona en vez de copiarse: allí el id seguía siendo un filtro legítimo por URL (`tests/integration/db/filtros-catalogo-sin-inactivos.test.ts`, T5) porque el usuario podía llegar por un enlace guardado; aquí no hay enlace guardado que valga |
| Desplegables de la corrección de ubicación | **Sí, en el cliente** | Corregir una orden hacia un distrito es un **alta encubierta**: crea futuro, no consulta pasado |
| `CorregirDatosClienteService` (el servidor de esa ventana) | **Sí, como rechazo** | La puerta real. El filtro del cliente es comodidad; sin este rechazo, cualquiera que reenvíe la petición mete la orden en un distrito retirado |
| `OrdenRepository.findDistritosByCantonIds` y `findDistritoParaCorreccion` | **No recortan; proyectan la cadena** | Ver la fila siguiente |
| `lib/services/geo-resolucion.ts` (`resolveGeo`) | **Sí, como rechazo con mensaje propio** | Recortar en el `WHERE` haría caer la fila en `"distrito no encontrado en el canton"`, un mensaje que **miente** sobre un distrito que existe. El rechazo va donde ya vive `"el distrito 'X' no tiene zona asignada"` (`geo-resolucion.ts:148-153`) |
| `ConteosPublicosRepository.contar` (landing) | **Sí** | Es una promesa comercial: contar distritos retirados infla el número (`:33-35`) |
| `OrdenRepository.list` y sus filtros | **No, jamás** | R35. Es la mitad que un arreglo mal hecho rompe, y ya está afirmada explícitamente para la 351 |

### 4.1 El DTO del catálogo de filtros

`OpcionCatalogo` y `OpcionConPadre` (`lib/types/filtros-ordenes.ts:11-23`) los comparten zonas,
tiendas y mensajeros, así que **no se les añade nada**. La geografía estrena sus dos:

```ts
/** FICHA 374: opcion geografica. `disponible` es la EFECTIVA (cascada ya aplicada), no el flag propio. */
export interface OpcionGeografica extends OpcionCatalogo {
  disponible: boolean;
}
export interface OpcionGeograficaConPadre extends OpcionConPadre {
  disponible: boolean;
}
```

`GeografiaFiltrosDTO` y las tres colecciones geográficas de `CatalogoFiltrosOrdenesDTO` pasan a
esos tipos. Como extienden los anteriores, **ningún consumidor actual deja de compilar**.

Que en el DTO plano viaje la **efectiva** y no el flag propio no es un descuido: el consumidor de
esas listas quiere saber si puede ofrecer la opción, y obligarle a recomponer la cadena desde tres
listas planas sería pedirle que reimplemente §3. La pantalla de administración, que sí necesita
distinguir propio de heredado, usa **otro** DTO —el árbol— donde el padre está literalmente encima.

### 4.2 El árbol (una sola lectura para las DOS pantallas)

`ProvinciaArbolDTO` / `CantonArbolDTO` / `DistritoArbolDTO` (`lib/actions/geografia.ts:14-39`)
ganan `activo` (el **propio**) en los tres niveles. Con eso:

- la pantalla nueva pinta el estado y deriva lo heredado mirando a su padre en el mismo árbol;
- el selector de Tarifas puede marcar visualmente lo retirado (R47) sin una segunda lectura.

**Un cambio de comportamiento deliberado, y hay que declararlo:** hoy el árbol resuelve la zona del
distrito con `zonas: { take: 1 }` (`lib/actions/geografia.ts:74-77`), así que un distrito en DOS
zonas muestra «(zona: X)» aunque la carga lo rechace —`findDistritosByCantonIds` colapsa >1 a
`null` (`OrdenRepository.ts:2122-2128`)—. Esa etiqueta **miente**, y la marca «sin zona» de R42
heredaría la mentira. Se corrige aplicando el mismo `zonaUnicaDeDistrito` de
`_shared/zona-colapso.ts`: se piden todas las zonas del distrito y `zonaId`/`zonaNombre` pasan a
ser las de la **zona utilizable** (`null` con 0 y también con >1). El único consumidor actual de
ese campo es el texto «(zona: X)» del selector (`GeografiaSelector.tsx:309-313`), que con esto pasa
a decir la verdad.

---

## 5. Capas y contratos

`docs/architecture.md` exige Controller → Service → Repository con interfaces. El Prisma directo de
`lib/actions/geografia.ts` se toleró por ser solo lectura (su propio comentario lo dice, `:8-12`);
esa premisa muere con la primera escritura. Se copia el molde de vehículos.

### 5.1 Borde — `lib/actions/geografia.ts`

```ts
export interface GeografiaActionDeps {
  geografiaService?: IGeografiaService;
  getActor?: () => Promise<Actor | null>;
}

/** Vocabulario cerrado del nivel; se usa igual en el schema, el service y el repositorio. */
export const NIVELES_GEOGRAFICOS = ["provincia", "canton", "distrito"] as const;
export type NivelGeografico = (typeof NIVELES_GEOGRAFICOS)[number];

// --- Alta ---
export const crearNodoGeograficoSchema = z.discriminatedUnion("nivel", [
  z.object({ nivel: z.literal("provincia"), nombre: nombreGeoSchema }).strict(),
  z.object({ nivel: z.literal("canton"), nombre: nombreGeoSchema, provinciaId: z.string().min(1) }).strict(),
  z.object({ nivel: z.literal("distrito"), nombre: nombreGeoSchema, cantonId: z.string().min(1) }).strict(),
]);

export type CrearNodoGeograficoResult =
  | { status: "ok"; id: string; nivel: NivelGeografico }
  | { status: "conflict" }                                              // R17/R18
  | { status: "not_found" }                                             // R14: el padre no existe
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" }
  | { status: "forbidden" };

export async function crearNodoGeografico(
  input: unknown,
  deps: GeografiaActionDeps = {},
): Promise<CrearNodoGeograficoResult>;

// --- Activacion ---
export const cambiarActivacionGeograficaSchema = z
  .object({ nivel: z.enum(NIVELES_GEOGRAFICOS), id: z.string().min(1), activo: z.boolean() })
  .strict();

export type CambiarActivacionGeograficaResult =
  | { status: "ok"; nivel: NivelGeografico; id: string; activo: boolean }
  | { status: "not_found" }                                             // R22
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" }
  | { status: "forbidden" };

export async function cambiarActivacionGeografica(
  input: unknown,
  deps: GeografiaActionDeps = {},
): Promise<CambiarActivacionGeograficaResult>;
```

Cuerpo calcado de `crearVehiculo` (`lib/actions/vehiculos.ts:64-82`): actor → sin actor,
`unauthenticated` (R23) → `parse` (R25) → `service.…` → y el `try/catch` que convierte la violación
de UNIQUE en `conflict` (R18), con el mismo comentario que ya está escrito allí: *«El UNIQUE de la
base es la última palabra»*.

**Dos acciones y no seis.** El nivel viaja como dato en un vocabulario cerrado en vez de multiplicar
`crearProvincia`/`crearCanton`/`crearDistrito` × `activar`/`desactivar`: seis funciones con el mismo
cuerpo son cinco sitios donde olvidar la comprobación de rol. La `discriminatedUnion` mantiene el
borde igual de estricto —un `cantonId` en un alta de provincia es `validation_error`, no un campo
ignorado—.

`listarArbolGeografico()` **conserva su firma** (sin parámetros, mismo tipo de retorno salvo el
`activo` nuevo): ya lo llaman `app/(app)/configuracion/tarifas/page.tsx:29` y
`ZonasTarifasModule.tsx:74`. Lo que cambia es que por dentro delega en el service en vez de tocar
Prisma, y que gana `deps` opcional para poder probarse sin base.

### 5.2 Servicio — `lib/services/GeografiaService.ts` (+ `IGeografiaService`)

```ts
const READ_ROLES = new Set<string>(["maestro"]);
const WRITE_ROLES = new Set<string>(["maestro"]);

export class GeografiaService implements IGeografiaService {
  constructor(private readonly repo: IGeoRepository) {}

  listarArbol(actor: Actor): Promise<ListarArbolServiceResult>;
  crear(input: CrearNodoGeograficoInput, actor: Actor): Promise<CrearNodoGeograficoServiceResult>;
  cambiarActivacion(input: CambiarActivacionInput, actor: Actor): Promise<CambiarActivacionServiceResult>;
}
```

`crear`, paso a paso (es donde vive **toda** la regla):

1. rol fuera de `WRITE_ROLES` → `forbidden` **antes de tocar la base** (R24);
2. `repo.findHermanos(nivel, padreId)` → `null` significa «el padre no existe» → `not_found` (R14).
   Una sola consulta resuelve las dos preguntas: si el padre existe y qué hermanos tiene;
3. `normalizeName(nombre)` contra `normalizeName` de cada hermano → si coincide, `conflict` (R17).
   **Aquí está la diferencia con vehículos** (`requirements.md §0.3-2`): allí basta el `trim` +
   colapso porque el UNIQUE compara literales; aquí el UNIQUE literal **no basta**, porque
   `resolveGeo` indexa por `normalizeName` (`geo-resolucion.ts:28-30`) y «San José» y «San Jose»
   serían dos filas legales para la base y **una sola cosa ambigua** para la carga masiva —que es
   exactamente el fallo que el renombrado quedó fuera de alcance para no provocar—;
4. `repo.crear(nivel, nombreNormalizadoParaGuardar, padreId)` → el id.

`cambiarActivacion`: rol → `repo.cambiarActivacion(nivel, id, activo)` → `false` = `not_found`
(R22). Idempotente por construcción (R21): poner `true` sobre `true` es un `UPDATE` que afecta a una
fila y la deja igual.

### 5.3 Repositorio — `GeoRepository` (+ `IGeoRepository`)

**Se extiende el que hay, no se crea otro.** `GeoRepository` ya se declara «lectura del catálogo
geográfico global, solo queries Prisma» (`:11-16`); dos repositorios sobre las mismas tres tablas
serían dos reglas que un día divergen —el mismo argumento, literal, que ya justifica
`_shared/zona-colapso.ts`—. Lo que cambia es su cabecera: deja de ser solo lectura y hay que
decirlo ahí.

```ts
// Ya existentes; cambian de tipo de retorno para llevar `disponible` (§4.1).
listProvinciasLite(): Promise<OpcionGeografica[]>;
listCantonesLite(): Promise<OpcionGeograficaConPadre[]>;
listDistritosLite(): Promise<OpcionGeograficaConPadre[]>;
listGeografiaLitePorZona(zonaId: string): Promise<GeografiaFiltrosDTO>;

// Nuevos (ficha 374).
/** El arbol COMPLETO (R26): activos e inactivos, con el flag PROPIO de cada nivel. */
listArbol(): Promise<ProvinciaArbolDTO[]>;

/**
 * Los hermanos del nivel bajo `padreId` —TODOS, activos e inactivos—, o `null` si el padre no
 * existe. Una consulta resuelve las dos preguntas del alta (R14 y R17).
 * `padreId` es `null` solo para `provincia`, que no tiene padre.
 */
findHermanos(
  nivel: NivelGeografico,
  padreId: string | null,
): Promise<{ id: string; nombre: string }[] | null>;

/** Crea el nodo. Deja escapar la violacion de UNIQUE: la traduce el borde (R18). */
crear(nivel: NivelGeografico, nombre: string, padreId: string | null): Promise<string>;

/** `updateMany` (no lanza si no existe): `false` = ninguna fila alcanzada -> `not_found`. */
cambiarActivacion(nivel: NivelGeografico, id: string, activo: boolean): Promise<boolean>;
```

`updateMany` y no `update` es el patrón que ya usa `VehiculoRepository.update` (`:41-46`), con su
comentario: no lanza si la fila no existe, devuelve `count 0`.

**El repositorio no expone `delete` ni `deleteMany` para ninguna de las tres tablas, y eso es una
propiedad estructural, no una promesa** (R5): la interfaz no lo declara, la clase no lo implementa
y una guardia recorre `lib/` para que nadie lo añada por otro camino.

### 5.4 Los cuatro consumidores que cambian por dentro

| Archivo | Qué cambia |
| --- | --- |
| `lib/repositories/OrdenRepository.ts:2082-2137, 2264-2288` | `findAllProvincias`, `findCantonesByProvinciaIds`, `findDistritosByCantonIds` y `findDistritoParaCorreccion` **proyectan** la cadena (`SELECT_CADENA_DISTRITO`) y sus `…Row` ganan `activo`/`disponible`. **Ni un `WHERE` nuevo** (R31) |
| `lib/services/geo-resolucion.ts:91-153` | Tres comprobaciones nuevas, una por nivel, cada una justo detrás de su `lookup` (§6) |
| `lib/services/CorregirDatosClienteService.ts:260-269` | Un rechazo más, hermano de «El distrito indicado no existe», con su propio texto (R30) |
| `lib/repositories/ConteosPublicosRepository.ts:33-35` | `where: { zonas: { some: {} }, ...WHERE_DISTRITO_DISPONIBLE }` (R34) |

---

## 6. El rechazo en `resolveGeo`, y el contrato público que mueve

`resolveGeo` es **compartido**: lo llaman la carga masiva por sesión (`BulkOrdenService`) y la
cotización por API key (`CotizacionOrdenService.ts:326`). Su comentario de cabecera dice, con todas
las letras, que duplicarlo habría dado dos dueños a los tres mensajes de no-cobertura. Así que el
rechazo nuevo entra **ahí dentro**, y eso significa que **cambia el contrato de una API para
terceros**.

La comprobación va **detrás de cada `lookup`**, en el orden en que la función ya resuelve, y de ahí
sale la precedencia de R33 sin ninguna regla extra:

```ts
// provincia
if (!provincia.activo) return { ok: false, fieldErrors: { provincia: [MSG_PROVINCIA_RETIRADA] } };
// canton
if (!canton.activo)    return { ok: false, fieldErrors: { canton:    [MSG_CANTON_RETIRADO] } };
// distrito — ANTES del chequeo de zona: «retirado» es mas concreto que «sin zona»
if (!distrito.activo)  return { ok: false, fieldErrors: { distrito:  [msgDistritoRetirado(raw.distrito)] } };
```

Mensajes (módulo puro, junto a los tres que ya existen):

| Caso | Mensaje |
| --- | --- |
| provincia | `la provincia esta retirada del catalogo` |
| cantón | `el canton esta retirado del catalogo` |
| distrito | `el distrito '<nombre>' esta retirado del catalogo` |

Los tres son **de fila**, no de lote (R36): salen por la misma vía que
`"distrito no encontrado en el canton"`, que el contrato ya publica dentro de `errores`
(`lib/api/openapi-spec.ts:634`, `docs/api/api-key-openapi.yaml:528`). Un lote con una fila retirada
sigue devolviendo 200 y cotizando las demás.

**El aviso a integradores es parte del despliegue, no cortesía.** El changelog del canal
(`docs/api/CHANGELOG.md`) lo dice en su cabecera y esta ficha entra por ahí: entrada fechada
**antes de la release**, en los dos artefactos, con el texto ya redactado para copiar y mandar
(R37). La descripción del campo `distrito` del schema de fila
(`api-key-openapi.yaml:1327-1329`) enumera hoy los cuatro motivos de error de fila —falta, no se
encuentra, ambiguo, sin zona— y pasa a enumerar **cinco**.

Que la comprobación quede **antes** del `if (distrito.zonaId === null)` es deliberado: un distrito
retirado suele además quedarse sin zona, y decirle al integrador «no tiene zona asignada» le manda
a pedir que le configuren una tarifa en vez de a corregir la dirección.

---

## 7. La pantalla

### 7.1 `app/(app)/configuracion/geografia/page.tsx`

Calcada de `app/(app)/configuracion/vehiculos/page.tsx` (39 líneas): Server Component, autoriza
`actor?.rol !== "maestro"` server-side, precarga el árbol y se lo pasa por props al módulo cliente,
con el `<p role="alert">` de «no se pudo cargar» cuando la lectura falla (R38).

### 7.2 `_components/GeografiaAdminModule.tsx` — árbol NUEVO

**No se extrae `GeografiaSelector`.** Ese componente es, en su totalidad, una **selección múltiple
de hojas con cascada tri-estado**: `selDist` es su fuente de verdad, `stateFor` deriva el estado de
los padres y `toggleGrupo` marca en bloque (`GeografiaSelector.tsx:56-118`). La pantalla de
administración **no tiene selección**: tiene acciones por fila. Compartir el componente obligaría a
un modo sin checkboxes dentro de un componente cuyo único tema son los checkboxes.

**Sí se extrae su filtro de texto** (`GeografiaSelector.tsx:144-168`), que es lógica pura sobre el
árbol, a `app/(app)/configuracion/_shared/filtrar-arbol-geografico.ts`; y su `norm()`
(`:18-23`) —tercera copia de una normalización que ya existe dos veces y que **no colapsa los
espacios internos** (el `trim` lo pone el llamador, `:145`), así que «san  jose» con doble espacio
no encuentra «San José»— se sustituye por `normalizeName` (`lib/utils/normalize.ts:7-14`) en los
dos sitios (R39).

Por fila:

- **Distintivo de estado**, base `GastosFijosPlantillasPanel.tsx:362-372`, con dos sabores (R40):
  *Inactivo* (flag propio) e *Inactivo por su cantón* / *…por su provincia* (heredado, nombrando al
  ascendiente). El texto sale de un módulo **puro** —`geografia-estado-label.ts`, hermano de
  `gasto-fijo-estado-label`— para que los tests lo lean sin arrastrar React.
- **Activar / Desactivar**, base `GastosFijosPlantillasPanel.tsx:386-394`. En el heredado, *Activar*
  va **deshabilitado con el motivo** en el `aria-label` **y** en el `title` (R41): un botón
  deshabilitado no recibe foco, así que dejar el motivo solo en un tooltip lo esconde a media
  pantalla.
- **Marca «sin zona»** en la fila del distrito (R42), derivada de la zona **utilizable** (§4.2).
  Hoy un distrito huérfano simplemente no muestra el sufijo «(zona: X)» y no hay forma de verlo de
  un vistazo: es la información que habría hecho evidente lo de Guácimo —cuyos cuatro distritos
  están todos sin zona, según la propia migración de la DTA (`:87-88`)—.
- **Alta** (R43): formulario oculto que se muestra al pulsar, patrón `VehiculosModule.tsx:41-109`,
  con el padre fijado por el nodo desde el que se abre.

### 7.3 La confirmación de desactivar (R44)

`Modal` compartido con `closeOnConfirm={false}`, patrón de la casa. El cuerpo nombra el nodo y, si
la desactivación dejaría **alguna zona sin ningún distrito disponible**, las nombra:

```ts
// modulo PURO, sin React ni Prisma: se prueba con un arbol literal
export function zonasQueQuedarianSinDistritos(
  arbol: readonly ProvinciaArbolDTO[],
  objetivo: { nivel: NivelGeografico; id: string },
): string[];
```

**Avisa; no bloquea.** Vetar la desactivación del único distrito de una zona **está descartado**
(§8, A4) y la decisión se deja escrita para que no vuelva: una zona sin distritos **ya es
representable** —`ZonaRepository.update` acepta `distritoIds: []` (`:231`)—, desactivar no toca
`zona_distrito` (R50), y el veto acoplaría una regla de Tarifas dentro de Geografía.

### 7.4 El menú

Un `children` más al **final** del array de Configuración (`lib/auth/menu-visibility.ts:497-507`),
detrás de «Vehículos»:

```ts
{ label: "Geografía", href: "/configuracion/geografia" },
```

**Al final y no en otro sitio**, verificado: `primerDestino` devuelve el `href` del **primer** hijo
del **primer** ítem visible (`:665-669`), así que un hijo añadido al final no puede mover el
aterrizaje de nadie. Y hay que actualizar **a mano** el `toEqual` literal de
`tests/unit/auth/menu-visibility.test.ts:305-317`: ese literal **es el contrato** —no un polizón—,
así que se le añade el `href` nuevo; sustituirlo por la propia fuente lo dejaría siempre verde.

---

## 8. El riesgo más caro, y cómo se blinda

`ZonaRepository.update` hace `deleteMany({ zonaId })` + `createMany(distritoIds)`
(`:230-235`): **reemplazo total** de `zona_distrito` a partir de lo que mande el formulario. Si
alguien «mejora» `GeografiaSelector` ocultando los distritos retirados, `initialSelected`
(`CrearZonaForm.tsx:333`) los pierde y **el siguiente guardado de esa zona borra sus filas**. A
partir de ahí el distrito resuelve 0 zonas y toda alta futura muere con «no tiene zona asignada»…
y **no se pone rojo nada**: el bucle de la reconciliación hace `continue` cuando la zona resuelta
es `null` (`ZonaRepository.ts:266-267`).

Por eso R47 y R48 son requisitos y no una nota:

- el selector **renderiza** los retirados, marcados si venían marcados, con la casilla **operable**
  (se les añade el distintivo visual y nada más);
- un test de componente lo afirma, y un test de integración afirma que guardar una zona sin tocar
  el selector deja `zona_distrito` con **exactamente** las mismas filas.

---

## 9. Alternativas descartadas

**A1 · Materializar la cascada con `updateMany` a los hijos.** Desactivar un cantón apagaría sus
distritos en la base; las lecturas quedarían con un `WHERE activo = true` plano, sin joins.
**Descartada** porque **no puede cumplir R9**: al reactivar el cantón no habría forma de saber qué
distritos estaban ya inactivos por su cuenta, así que la reactivación encendería territorio que
alguien retiró a propósito —una pérdida de dato silenciosa, del tipo que no rompe ningún test—.
Además convertiría cada clic en una escritura de hasta 123 filas (San José) en vez de una.

**A2 · Un catálogo aparte para la administración.** Dejar `obtenerCatalogoFiltrosOrdenes` intacto y
crear una lectura nueva solo para la pantalla. **Descartada**: la corrección de ubicación llama a
ese **mismo** catálogo (`CorregirDatosClienteModal.tsx:240`), igual que `/ordenes`, `/analitica`,
`/historico/conversaciones` y `/recepcion-satelite` —seis consumidores de **una** lectura—. Partirlo
crearía dos verdades sobre las mismas tres tablas, y la que se quedara atrás ofrecería opciones que
la otra ya no acepta. El precedente vivo de la casa es el contrario: `CuentaTiendaDTO.activa` viaja
en el DTO y filtra el consumidor.

**A3 · Ocultar los retirados en `list*Lite`, como hizo la ficha 351 con las cuentas de baja.** Es
la analogía tentadora y **está descartada**: en la 351 el desplegable no era la única vía —el id
seguía siendo un filtro legítimo por URL, por descarga o por enlace guardado, y su test lo afirma
explícitamente (`filtros-catalogo-sin-inactivos.test.ts`, T5)—. En geografía **nadie teclea un
uuid**: si el distrito desaparece del desplegable, las órdenes históricas de ese distrito dejan de
poder filtrarse, punto. La bandera viaja y filtra quien debe filtrar.

**A4 · Vetar la desactivación del último distrito de una zona.** Sonaba a protección barata.
**Descartada**: una zona sin distritos ya es representable hoy (`ZonaRepository.update` acepta
`distritoIds: []`), desactivar no toca `zona_distrito`, y meter un veto de Tarifas dentro de
Geografía acopla dos dominios por una regla que nadie pidió. Se **avisa** en la confirmación (R44),
que informa sin decidir por el maestro.

**A5 · Un `GeoAdminRepository` nuevo, para no ensuciar `GeoRepository` con escrituras.**
**Descartada**: serían dos repositorios sobre las mismas tres tablas —«dos reglas que un día
divergen», el argumento textual de `_shared/zona-colapso.ts:12-17`—. Lo que sí cambia es la
cabecera de `GeoRepository`, que hoy dice «solo lectura» y dejará de ser verdad.

**A6 · Seis Server Actions (`crearProvincia`, `activarCanton`…).** Más explícitas de leer.
**Descartada**: seis cuerpos idénticos son cinco sitios donde olvidar el `forbidden`. El nivel viaja
como dato de un vocabulario cerrado y la `discriminatedUnion` mantiene el borde igual de estricto.

**A7 · Confiar la unicidad solo al `@@unique` de la base.** Una migración y a correr.
**Descartada**: el UNIQUE compara **literales**, y `resolveGeo` compara **normalizado**
(`geo-resolucion.ts:28-30,42-51`). «San José» y «San Jose» pasarían el UNIQUE y serían **una sola
cosa ambigua** para la carga masiva: a partir de ahí toda fila que nombre ese distrito muere con
`"distrito ambiguo en el canton"`. La base es la última palabra ante una carrera (R18); la regla es
del service (R17).

**A8 · Comprobar el duplicado con `findFirst({ where: { nombre } })`, como vehículos.**
**Descartada** por lo mismo: ese `where` es literal. Se leen los hermanos —como mucho 123 filas, el
cantón más grande del país— y se comparan por `normalizeName` en memoria, que es la MISMA función
con la que se indexa la carga.

**A9 · Añadir `codigo_dta` ahora y usarlo como clave estable.** Es lo que hace falta para el
renombrado y llegará en la ficha siguiente. **Descartada aquí** porque el renombrado está fuera de
alcance por decisión del humano: sin renombrado, `codigo_dta` no resuelve ningún problema de esta
ficha y obligaría a un backfill de 585 filas contra el PDF del IGN.

---

## 10. Riesgos

| Riesgo | Mitigación |
| --- | --- |
| El `CREATE UNIQUE INDEX` falla en una base que sí tenga duplicados | Producción medida (0 el 2026-09-05); tarea **A0** obliga a medir con un `GROUP BY … HAVING count(*) > 1` en cada base antes de aplicar |
| Alguien «limpia» los distritos activos bajo cantones inactivos con un `updateMany` | R10 escrito como regla explícita, en el schema y en el helper |
| Alguien homogeneiza `activo` con `zona_especial` y lo hace nullable | El contraste está comentado en la migración y en el `schema.prisma` |
| El selector de Tarifas oculta los retirados y el siguiente guardado borra sus filas de `zona_distrito` | R47 + R48, con test de componente **y** de integración (§8) |
| Un `where: { activo: true }` escrito a mano que divergerá del predicado | Guardia de R11 con contraprueba |
| Los tests de `WHERE` se escriben con dobles y pasan en verde con el filtro mutado | Todo lo que es `WHERE` va a `tests/integration/db/**` (matriz de `requirements.md §3`), y cada uno se mata con una mutación antes de creerlo |
| Un test de integración que reporta `passed` sin datos | Ningún `if (!fila) return;`: el molde es `filtros-catalogo-sin-inactivos.test.ts`, que **revienta con mensaje** si falta el corpus |
| El cambio del contrato público sale sin avisar | R37: entrada fechada en `docs/api/CHANGELOG.md` **antes** de la release, con su test |
| Producción vacía desde el 2026-08-25 | Un cero medido hoy significa «aún no ha pasado». El diseño no se justifica en los números de hoy sino en el esquema |

---

## 11. Verificación

- Gate: la migración toca `db/schema.prisma`, así que **el modo rápido se negará** y mandará al
  completo. `./init.sh` entero antes de la release, y eso es lo esperado.
- Los tests de `tests/integration/db/**` **necesitan `.env`**: si salen `skipped`, el veredicto no
  vale. Mirar los `skipped`, no solo el `INIT_EXIT` —y escribir `INIT_EXIT=$?` **dentro** del log—.
- Aplicar la migración en local (`pnpm exec prisma migrate deploy`) antes de correr nada, y
  **reiniciar el dev server** tras regenerar el cliente Prisma: un cliente rancio da 404 con el
  armazón pintado.
- Verificación manual en la pantalla real, con sesión `maestro` (ver la app encuentra lo que la
  suite no): dar de alta un distrito de prueba; desactivar su cantón y comprobar que el distrito
  aparece como *inactivo por su cantón* con *Activar* deshabilitado; reactivar el cantón y
  comprobar que el distrito vuelve como estaba; abrir Tarifas y ver que el distrito retirado sigue
  ahí, marcado y con su casilla; guardar la zona sin tocar nada y volver a mirar sus distritos.
