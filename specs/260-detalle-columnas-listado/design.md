# Feature 260 — Diseño

> Lee antes `requirements.md`. Aquí está el **cómo**, lo que se midió en el repo para poder
> decidirlo, y **ocho alternativas descartadas** con su motivo.
> **Puerta humana resuelta el 2026-08-21**: sin preguntas abiertas (§14).

---

## 0. Resumen en seis líneas

1. El detalle deja de tener contrato propio: su fila **es** `OrdenListItemDTO` más dos campos.
2. El *quién entra y en qué orden* lo sigue decidiendo la consulta paginada del tablero, que pasa a
   devolver sólo **identificadores + resultado del día + instante de asignación**.
3. Esa página (≤ 25 ids) se **hidrata** por el camino que ya produce el DTO del listado (mismo
   `include`, mismo mapeo, mismo derivador de intentos). No hay una segunda proyección.
4. El servicio **recorta por alcance** —flete, comisión, tarifa y contacto de la tienda no salen
   del alcance `global`— y la pantalla **no monta** las columnas que leen esos campos. Las dos
   mitades, o el cero miente.
5. Una **guardia con centinelas** se pone roja si cualquiera de las dos mitades desaparece.
6. La pantalla monta `ordenesColumns` tal cual, con su propio `DataTable` y **sin una sola acción**.

**Sin migraciones, sin tablas nuevas, sin columnas de base de datos, sin policies RLS.** Esta
feature no toca `db/`. Lo que sí toca es `lib/types/tablero-dia.ts` **y** `lib/types/orden.ts` ⇒ el
gate rápido se niega solo (§11).

---

## 1. Lo que se midió en el repo antes de diseñar

Todo lo de esta sección está verificado leyendo el código, no supuesto. Es la parte que la ficha
pedía comprobar — y §1.4 es la que **cambió la ficha**.

### 1.1 `ordenesColumns` sí está lista para reusarse — y son 19, no las que dice la ficha

`app/(app)/ordenes/_components/ordenes-columns.tsx` exporta `ordenesColumns: Column<OrdenListItemDTO>[]`
con **19** columnas, en este orden:

```
numGuia · numRemision · estatus · intentos · destinatario · producto · direccion ·
tienda · zona · provincia · canton · distrito · montoCobrar · flete · fulfillment ·
comision · mensajero · fechaCreacion · tiempo
```

La ficha enumera 19 pero incluye `liberada` y omite `intentos`. **`liberada` no está en
`ordenesColumns`**: vive en `ordenesColumnsReprogramada` (= las 19 + una), que `OrdenesListado`
sólo monta cuando el filtro está acotado exactamente al estado `reprogramada`. El detalle del día
mezcla estados, así que se monta `ordenesColumns` y «Liberada el» queda fuera (**R45**).

### 1.2 Ninguna columna trae acción, y ninguna depende de props

Se revisaron las 19 celdas. **Todas** son función pura de la fila (`row.*` / `row.relaciones?.*`) o
acceso por clave. `columnaIntentos<T>()` es una fábrica genérica sin parámetros que sólo lee
`row.intentosEntrega`. **No hay ninguna columna de acción en este módulo**: el checkbox de selección
y la columna «Acciones» (historial, etiqueta, reportar incidente) los **antepone y añade
`OrdenesModule`**, no `ordenesColumns`. Conclusión: montar el módulo de columnas **no puede** traer
acciones a `/monitoreo`. La lectura de la ficha se confirma sin excepciones, y por tanto el único
subconjunto que hay que declarar es el del **recorte por alcance** (§5), no uno para excluir
acciones.

### 1.3 `OrdenesListado` sigue siendo el contenedor que la alternativa 11 de la 192 describía

Verificado: 11 props de negocio (`puedeCargarMasiva`, `puedeEscanearQr`,
`puedeRecibirBodegaCentral`, `mostrarHistorial`, `accionesLote`, `catalogoFiltros`,
`incluirFiltroTienda`, `incluirFiltroReasignables`, `permitirDescarga`, `puedeReportarIncidente`,
`fechasDiaReparto` + `exclude`), **nueve modales de acción por lote** montados dentro, dos escáneres
de cámara, la barra de filtros y la descarga del dataset. Montarlo en `/monitoreo` traería todo eso
a una pantalla de lectura. **La razón sigue vigente y se cita tal cual.**

### 1.4 EL HALLAZGO QUE CAMBIÓ LA FICHA: `/ordenes` **no recorta dinero por rol**

La ficha pedía «confirmar que respetan **las mismas reglas por rol** que en `/ordenes`». Al medirlo,
**esa premisa es falsa: no hay tales reglas.**

- `ordenesColumns` **no tiene una sola rama por rol**. Las cuatro columnas de dinero (monto a
  cobrar, flete + IVA, fulfillment, comisión + IVA) se montan iguales para todos.
- Quien recorta es la **puerta de la página**: `app/(app)/ordenes/page.tsx:55` hace `notFound()` a
  `mensajero` y a **`adminSatelite`**. Entran maestro, admin y adminTienda; a este último
  `OrdenService.construirWhere` le fuerza `tiendaId = actor.usuarioId` — recorte de **filas**, no de
  columnas.
- `app/(app)/monitoreo/page.tsx` admite `["admin","maestro","adminSatelite"]`, y el alcance del
  `adminSatelite` resuelve a `zona`. **Hay un rol que ve el monitoreo y no ve el listado.**
- En su propia pantalla, `app/(app)/recepcion-satelite/_components/recibidas-columns.tsx` le muestra
  al `adminSatelite` el **monto a cobrar** y **no** la tarifa. Su comentario lo dice literalmente:
  «`RecepcionSateliteDTO`, que **NO trae tarifa** (sin flete/comisión/fulfillment)».

**Consecuencia, y es la razón de ser de R13–R17:** no había regla que copiar, así que copiar
`ordenesColumns` tal cual habría abierto una puerta trasera real —el `adminSatelite` viendo por
primera vez flete, comisión, fulfillment y la tarifa completa de cada tienda—. El humano lo
verificó por su cuenta el **2026-08-21** y **dictó una regla nueva** (Q1 de `requirements.md`), que
es la que implementa §5. **Este párrafo es el porqué del requisito; no se borra.**

### 1.5 `OrdenService.listar` NO se puede reusar, y el motivo es una trampa

```ts
const KNOWN_ROLES = new Set(["maestro", "admin", "adminTienda", "mensajero"]);
```

**`adminSatelite` no está.** `OrdenService.listar` le devolvería `forbidden` — justo al rol que más
usa `/monitoreo`. Y si estuviera sería peor: `construirWhere` sólo acota por `tiendaId`
(adminTienda) y `mensajeroAsignadoId` (mensajero); **no acota por zona**, así que un
`adminSatelite` recibiría filas **globales**. Hoy eso es inofensivo porque la página le hace 404;
reusar el servicio lo convertiría en una fuga multi-tenant.

Añadido: `OrdenService` **lee `actor.rol`**, que es una segunda frontera de recorte por rol. La
feature 192 (R8) fijó que el tablero resuelve el alcance en **un solo sitio**
(`resolverAlcance` → lista blanca `global|zona`), y su guardia lo atornilla.

### 1.6 `ApiOrdenLecturaService` tampoco produce ese DTO

La ficha dice que lo consume. **No es cierto:** produce `ApiOrdenListItemDTO`
(`lib/types/api-orden.ts`), el DTO **público** del canal por API key, con `estado` en vez de
`estatusValue` y sin relaciones. Descartado como camino (§13, A4). El coordinador corrige la ficha.

### 1.7 El productor real de `OrdenListItemDTO`

Es **`OrdenRepository`**, y sólo él: la función de módulo `toListItemDTO(row)` sobre el `include`
`WITH_ESTATUS_Y_TIENDA` — que resuelve estatus, tienda + tarifa activa, zona, provincia, cantón,
distrito, mensajero asignado y la gestión de reprogramación vigente. Ahí dentro se derivan
`fleteConIva` y `comisionConIva` con `Prisma.Decimal` (feature 204). **Ése es el camino que ya
produce el DTO, y es el que se reusa.**

`intentosEntrega` **no** lo pone el repositorio: lo mergea el servicio
(`OrdenService.listar` → `this.historial.contarIntentosEnLote(ids)`). Hay precedente de hacerlo
fuera de `OrdenService`: `lib/actions/liberacion-reprogramada.ts` inyecta
`Pick<IOrdenHistorialService, "contarIntentosEnLote">` y hace exactamente el mismo merge.

### 1.8 `PriceLabel` pinta `₡0` ante `undefined` — omitir el dato **sin** desmontar la columna miente

Su contrato es explícito: «si el valor no existe o no es un número válido muestra `₡0` —no el
marcador de "sin importe"—». Por eso R13 y R14 son **dos** requisitos y no uno: retirar el dato del
payload sin retirar la columna produce un `₡0` que se lee como «esta orden no paga flete». Eso es
peor que enseñar la cifra (**R15**).

### 1.9 `DataTable` ya sabe desplazarse en horizontal

Contenedor `overflow-x-auto` + flechas que aparecen sólo si desborda + `minWidth` por columna. La
única condición documentada es que **los ancestros permitan encogerse** (`min-w-0`). El cuerpo del
`Modal` es `min-h-0 flex-1 overflow-auto` y `size="xl"` es `max-w-[1000px]`. Aquí no se toca ninguna
primitiva: se comprueba en el navegador (§10 y tarea F6).

### 1.10 El contacto de la tienda **se escribe en un sitio y no lo lee nadie**

Necesario para poder cumplir R13 sin romper la reutilización del tipo (§3.1). Medido:
`OrdenTiendaRef.email` y `.telefono` se **rellenan** en `OrdenRepository.ts:465-466` y **no se leen
en ninguna parte del repo**. (`GestionOrdenRepository.ts:272` expone `tiendaTelefono` en **otro**
DTO, el de asignación de la feature 157; no es este campo.) Ninguna columna de `ordenesColumns` los
toca.

---

## 2. Modelo de datos

**Ninguno.** Esta feature no crea ni altera tablas, columnas de base de datos, índices, enums,
migraciones ni policies RLS. No lee ni escribe nada nuevo en Postgres: sólo proyecta, sobre las
mismas filas ya autorizadas, campos que otra pantalla ya proyecta.

Se conserva la nota que ya está en el repositorio: **el tablero no escribe nunca
`orden.asignado_at`** (mover ese instante mueve el pago y el premio de un mensajero). Lo censa
`tests/unit/tablero-dia/asignado-at-solo-lectura.guardia.test.ts` (**R36**).

---

## 3. Contrato

### 3.1 Un ajuste mínimo en `lib/types/orden.ts`, y por qué es la opción correcta

R13 exige que el contacto de la tienda **no viaje** en alcance `zona`. Pero
`OrdenTiendaRef.email` y `.telefono` son `string` **obligatorios**, así que hoy «no viajar» no es
representable.

Hay dos formas de resolverlo y **sólo una conserva la reutilización de columnas**:

| Forma | Qué pasa |
| --- | --- |
| Derivar el tipo del detalle con `Omit`/`Partial<Pick<…>>` | `OrdenDetalleDia` **deja de ser asignable** a `OrdenListItemDTO`. Bajo `strictFunctionTypes`, `render: (row: OrdenListItemDTO) => ReactNode` ya no acepta una fila del detalle ⇒ montar `ordenesColumns` exige un **cast**. Un cast en esa costura es exactamente el sitio por el que las dos pantallas pueden divergir en silencio. **Descartada** (§13, A8). |
| Marcar `email` y `telefono` como **opcionales** en `OrdenTiendaRef` | `OrdenDetalleDia` sigue siendo **subtipo estricto** de `OrdenListItemDTO`, las columnas se montan sin cast, y «no viaja» pasa a ser representable. **Elegida.** |

Es un cambio de **dos caracteres** en la **única** declaración del tipo, y sigue el patrón aditivo
que ese mismo archivo ya documenta media docena de veces («Opcionales (`?`) […] el repositorio
SIEMPRE los envía»). No rompe a nadie: §1.10 midió que **no hay un solo lector** de esos dos campos.
`/ordenes` los sigue recibiendo igual (**R46**: en `global` no se recorta nada).

`tarifa` no necesita nada: ya es `TarifaDTO | null`, y `null` es el valor que ya tiene una tienda sin
tarifa activa. `fleteConIva` y `comisionConIva` ya son opcionales.

> Se descartó **borrar** `email`/`telefono` del DTO (nadie los lee): eso recortaría también para
> `global`, que R46 prohíbe, y sería un cambio al contrato de `/ordenes`, fuera de alcance. Queda
> anotado como deuda posible, no como parte de esta ficha.

### 3.2 `lib/types/tablero-dia.ts`

```ts
import type { OrdenListItemDTO, OrdenTiendaRef } from "@/lib/types/orden";  // import TYPE: se borra al compilar

/**
 * FEATURE 260 — la fila del detalle ES la del listado.
 * Sustituye a los 7 campos propios de la feature 192 (R47-R51). Revierte R49 (§9).
 */
export type OrdenDetalleDia = OrdenListItemDTO & {
  /** Última gestión vigente del día de esa orden; `null` si no gestionó hoy. */
  readonly resultadoDelDia: GestionResultado | null;
  /** ISO-8601 UTC. Ordena la página; no se pinta en ninguna columna. */
  readonly asignadoAt: string;
};

export interface DetalleMensajeroDia {
  readonly mensajeroId: string;
  readonly fecha: string;
  readonly ordenes: readonly OrdenDetalleDia[];
  readonly total: number;
  readonly pagina: number;
  readonly pageSize: number;
  /** FEATURE 260 (R12) — con qué alcance se resolvió. Decide qué columnas se montan. */
  readonly alcance: "global" | "zona";
}
```

Tres decisiones y su porqué:

- **Se conserva el nombre `OrdenDetalleDia`** aunque su contenido cambie por completo: renombrarlo
  obliga a tocar el repositorio, la interfaz, la acción, cuatro tests de integración y el guardia,
  sin mover un byte de comportamiento.
- **Se conserva `asignadoAt`** aunque ninguna columna lo pinte: es el campo por el que ordena la
  consulta del día, y los tests de integración ya afirman ese orden contra él.
- **`alcance` viaja en el detalle, no se deduce en el cliente.** Un componente de cliente no puede
  leer el rol —lo prohíbe la cláusula (c) del guardia de frontera— y tampoco debe: el alcance ya lo
  resolvió el servidor y aquí sólo se **consume su respuesta**, exactamente como manda R8 de la 192.

`import type` de `@/lib/types/orden` no rompe la cabecera de este módulo («no importa
`repositories/`, `services/`, `@/lib/db` ni `next/headers`»): es una importación de **tipo**, se
borra al compilar y no arrastra un byte al navegador.

---

## 4. El camino de datos: dos pasos, un solo dueño de cada decisión

```
leerDetalleMensajeroDia (Server Action, borde)
  └─ TableroDiaService.detalle(actor, now, mensajeroId, pagina)
       1. autorizar(actor)                    ← resolverAlcance + lista blanca global|zona   (R10)
       2. TableroDiaRepository.listarOrdenesDelDia(ventana, filtro, mensajeroId, pagina)
            → { filas: [{ ordenId, resultadoDelDia, asignadoAt }], total }   ← QUIÉN y en qué ORDEN
       3. filas.length === 0 ? detalle vacío (0 consultas más)                                (R5)
       4. Promise.all([
            OrdenRepository.findListItemsByIds(ids, filtro)  → OrdenListItemDTO[]   ← QUÉ trae cada una
            OrdenHistorialService.contarIntentosEnLote(ids)  → Map<id, number>                (R6)
          ])
       5. reordenar por `ids` · anexar resultadoDelDia + asignadoAt · descartar ids sin fila   (R4/R7)
       6. recortarPorAlcance(orden, alcance)  ← LA FRONTERA DE DATOS                       (R13/R46)
```

**Por qué dos pasos y no uno.** El paso 2 responde una pregunta que el listado de órdenes no sabe
responder: «asignada hoy» es la **unión** de dos caminos (`asignado_at` en la ventana **∪** una
transición de recolección del día en `orden_historial_estado`), y «resultado del día» es la última
gestión no anulada de la ventana, resuelta con `LEFT JOIN LATERAL ... LIMIT 1`. Nada de eso es
expresable como `where` de Prisma sobre `orden` sin materializar gestiones. El paso 4 responde la
otra pregunta —«¿qué se pinta de una orden?»— y ésa **ya está respondida** en un sitio.

Que sean dos pasos **no reabre la posibilidad de divergir**, que es lo que la ficha pide evitar: el
paso 4 no tiene criterio propio, no filtra por fecha, no ordena y no proyecta a mano — recibe una
lista de ids y devuelve el DTO **con el mismo `include` y el mismo mapeo** que el listado. Si
mañana el listado añade un campo, el detalle lo trae solo (**R26**).

### 4.1 Cambios en el repositorio del tablero

`listarOrdenesDelDia` **conserva su consulta** (misma `WITH ids_del_dia`, mismo `LATERAL`, mismo
`COUNT(*) OVER ()`, mismo `LIMIT/OFFSET`, mismo `ORDER BY`) y sólo **adelgaza el `SELECT`**: deja de
proyectar `num_guia`, `s."value"`, `destinatario` y `direccion`, y con ellos se va el
`JOIN "order_status"` (sólo servía al `SELECT`).

⚠️ **La consulta sigue siendo la segunda del archivo y sigue siendo la paginada.**
`frontera.guardia.test.ts` afirma `consultas.toHaveLength(3)` y
`["agregada","paginada","agregada"]` **por posición en el texto**, y afirma que `consultas[1]`
contiene `OFFSET`. Adelgazar el `SELECT` no mueve nada de eso. **Añadir una cuarta consulta sí lo
rompería, y por eso no se añade ninguna** (R38).

Nueva forma del puerto:

```ts
// lib/interfaces/repositories/ITableroDiaRepository.ts
export interface FilaDelDia {
  readonly ordenId: string;
  readonly resultadoDelDia: GestionResultado | null;
  readonly asignadoAt: string;
}
export interface PaginaOrdenesDelDia {
  /** En el ORDEN de la página. La hidratación lo respeta (R4). */
  readonly filas: readonly FilaDelDia[];
  readonly total: number;
}
```

### 4.2 El método nuevo del repositorio de órdenes

```ts
// lib/interfaces/repositories/IOrdenRepository.ts
import type { FiltroAlcanceTablero } from "./ITableroDiaRepository";   // import type, sin runtime

/**
 * FEATURE 260 — los elementos de listado de una lista ACOTADA de ids.
 * Reusa `WITH_ESTATUS_Y_TIENDA` y `toListItemDTO`: misma proyección y mismo mapeo que `list()`.
 * El `filtro` es la MISMA frontera multi-tenant que ya aplicó quien produjo los ids: se aplica
 * DOS VECES a propósito (R11).
 */
findListItemsByIds(
  ids: readonly string[],
  filtro: FiltroAlcanceTablero,
): Promise<OrdenListItemDTO[]>;
```

Implementación en `OrdenRepository` (patrón idéntico a `findEtiquetasByIds`,
`findManifiestoByIds` y, sobre todo, `findRecepcionSateliteByIds(ids, zonaId)`, que ya combina ids
+ zona + `deletedAt: null`):

```ts
if (ids.length === 0) return [];                               // R5: cero consultas
const rows = await this.prisma.orden.findMany({
  where: {
    id: { in: [...ids] },
    deletedAt: null,                                           // R19
    ...(filtro.tipo === "zona" ? { zonaId: filtro.zonaId } : {}),   // R11
  },
  ...WITH_ESTATUS_Y_TIENDA,                                    // R2: el MISMO include
});
return rows.map(toListItemDTO);                                // R2: el MISMO mapeo
```

**Por qué el parámetro es la unión `FiltroAlcanceTablero` y no un `zonaId?: string`.** Un
`string | undefined` suelto convierte «no sé» en «sin recorte»: es exactamente la forma fail-open
que la 192 se negó a escribir («`zonaId: null` NO es representable: el filtro es una unión de dos
variantes»). Se importa el **tipo** desde `ITableroDiaRepository` en vez de declararlo otra vez: una
segunda unión es una segunda definición que puede quedarse atrás. El coste es una arista
`import type` entre dos archivos de `lib/interfaces/repositories/`, sin runtime (§13, A7).

### 4.3 El servicio gana dos colaboradores

```ts
export class TableroDiaService implements ITableroDiaService {
  constructor(
    private readonly repositorio: ITableroDiaRepository,
    private readonly ordenes: Pick<IOrdenRepository, "findListItemsByIds">,
    private readonly historial: Pick<IOrdenHistorialService, "contarIntentosEnLote">,
    private readonly cache: ITableroDiaCache = tableroDiaCacheNula(),
  ) {}
```

- **Obligatorios, no opcionales.** Opcionales dejarían que una implementación los olvidara y el
  detalle saliera vacío o sin intentos **sin que nada se pusiera rojo** — la familia de fallo mudo
  que este repo persigue. Mismo criterio que `ritmoEntregas` en la 258.
- `cache` se va al final porque es el único con valor por defecto. **Consecuencia declarada:** cambia
  la posición de `cache` y todas las construcciones existentes hay que tocarlas (tarea B6).
- Se inyectan **estrechados con `Pick`**, patrón ya usado por `ApiOrdenLecturaService` (`LecturaRepo`)
  y por `liberacion-reprogramada.ts`: el servicio no recibe la superficie entera de `IOrdenRepository`.

El cableado de producción vive en `lib/actions/tablero-dia.ts` (`construirServicio`), que ya
instancia el repositorio y la caché.

---

## 5. El recorte por alcance — dos mitades y una guardia que las ata

### 5.1 La lista, declarada UNA vez (R43)

```ts
// lib/types/tablero-dia.ts
/**
 * FEATURE 260 (R13/R43) — LO QUE NO SALE DEL ALCANCE GLOBAL. Una sola declaración.
 *
 * POR QUÉ EXISTE, y no es cosmética: `/ordenes` NO admite al adminSatelite (page.tsx:55), así que
 * estas cifras y estos datos de contacto son cosas que ese rol NUNCA ha podido ver. Monitoreo sí
 * lo admite, y no puede ser la puerta de atrás. El monto a cobrar SÍ se conserva: ya lo ve en
 * /recepcion-satelite.
 *
 * El `satisfies` ata cada nombre a su tipo: un rename en `lib/types/orden.ts` deja de COMPILAR
 * aquí, en vez de filtrar el campo en silencio.
 */
export const CAMPOS_SOLO_ALCANCE_GLOBAL = {
  orden:  ["fleteConIva", "comisionConIva"],
  tienda: ["email", "telefono", "tarifa"],
} as const satisfies {
  orden: readonly (keyof OrdenListItemDTO)[];
  tienda: readonly (keyof OrdenTiendaRef)[];
};

/** R13/R46 — pura. Con `global` devuelve la orden intacta; con `zona`, sin los campos de arriba. */
export function recortarPorAlcance(
  orden: OrdenDetalleDia,
  alcance: "global" | "zona",
): OrdenDetalleDia;
```

Cómo se retira cada uno (§3.1 lo hace representable): `fleteConIva`, `comisionConIva`,
`tienda.email` y `tienda.telefono` **se borran** (los cuatro son opcionales); `tienda.tarifa` **se
pone a `null`**, que es un valor legítimo del tipo y el que ya tiene una tienda sin tarifa activa.
Ninguna columna montada en `zona` lo lee, así que no puede leerse como una afirmación falsa.

### 5.2 La otra mitad, en la pantalla (R14)

```ts
// app/(app)/monitoreo/_components/detalle-columnas.ts
/** Ids de `ordenesColumns` que leen un campo de `CAMPOS_SOLO_ALCANCE_GLOBAL`. */
export const COLUMNAS_SOLO_ALCANCE_GLOBAL = ["flete", "fulfillment", "comision"] as const;
```

**Por qué hacen falta las dos.** Sin la mitad servidor, el dato viaja al navegador aunque no se
pinte, y se lee con un `View source`: «que un campo no se pinte no basta». Sin la mitad pantalla,
`PriceLabel` convierte el hueco en `₡0` y afirma algo falso (§1.8, R15).

### 5.3 La guardia que impide volver atrás (R44)

Las dos mitades hablan vocabularios distintos —campos del DTO frente a ids de columna— y una lista
no puede validar a la otra por comparación directa. Se atan por **salida observable**, con
**centinelas**: valores irrepetibles (`"FLETE-CENTINELA"`, `"correo@centinela"`, un importe
`9999999`) que se meten en un DTO completamente poblado.

`tests/unit/tablero-dia/recorte-por-alcance.guardia.test.ts`, cuatro cláusulas:

| # | Qué afirma |
| --- | --- |
| (a) **dato, unitario** | `recortarPorAlcance(dto, "zona")` no deja **ningún** centinela; con `"global"` los deja **todos** (si no, la cláusula sería verde por vacío). |
| (b) **dato, de extremo a extremo** | El detalle que devuelve el **servicio real** para un actor de alcance `zona`, **serializado a JSON**, no contiene ninguno de los centinelas. Serializar es lo que caza un campo anidado que nadie listó. |
| (c) **columna** | `columnasDetalle("zona")` renderizada sobre el DTO **sin recortar** —como si el servidor se hubiera olvidado— no pinta ningún centinela; con `"global"` los pinta. |
| (d) **no vacía** | Cada detector se demuestra rojo con **su** mutación. |

**Las tres mutaciones que la ponen roja, y hay que ejecutarlas y dejarlo escrito** (tarea V1):

1. `recortarPorAlcance` devuelve la orden sin tocar ⇒ (a) y (b) rojas.
2. El servicio deja de llamarla para `zona` ⇒ (b) roja.
3. `columnasDetalle` deja de filtrar `COLUMNAS_SOLO_ALCANCE_GLOBAL` ⇒ (c) roja.

Si alguna mutación **no** pone roja su cláusula, la cláusula es decorado y hay que arreglarla antes
de seguir. Este repo ya pagó por un arnés de mutaciones que reportó supervivientes sin haber
ejecutado un solo test: el resultado se pega en `progress/impl_260.md`, no se afirma.

---

## 6. Las columnas del detalle

Módulo nuevo: `app/(app)/monitoreo/_components/detalle-columnas.ts`.

```ts
export const COLUMNA_RESULTADO_ID = "resultadoDelDia";

/** R23/R24 — el orden, declarado UNA vez y por ID. No es una segunda lista de columnas. */
const PRIMERAS: readonly string[] = [
  "numGuia", "estatus", COLUMNA_RESULTADO_ID, "destinatario", "direccion",
];

export function columnasDetalle(alcance: "global" | "zona"): Column<OrdenDetalleDia>[] {
  // 1. las 19 de `ordenesColumns`, tal cual, sin copiar ni una definición     (R20/R26/R45)
  // 2. + la única propia: «Resultado del día», etiquetada con `estatusLabel`  (R22/R27)
  // 3. − COLUMNAS_SOLO_ALCANCE_GLOBAL si alcance !== "global"                 (R14)
  // 4. reordenadas: las de PRIMERAS delante, el resto en su orden nativo      (R23)
}
```

Cinco puntos finos:

- **`Column<OrdenListItemDTO>[]` es asignable a `Column<OrdenDetalleDia>[]`** sin cast:
  `OrdenDetalleDia` es **subtipo estricto** de `OrdenListItemDTO` (§3.1 es lo que lo mantiene así), y
  `render: (row: T) => ReactNode` es contravariante en el parámetro bajo `strictFunctionTypes`. Sin
  `any`, sin `as`.
- **Se parte de `ordenesColumns`, no de `ordenesColumnsReprogramada`** (**R45**): «Liberada el» es
  de la variante acotada al estado `reprogramada` y el detalle mezcla estados. Un test afirma que
  `liberada` no está entre los ids montados.
- **Se derivan, no se enumeran.** El paso 3 filtra por id y el 4 reordena por id; el conjunto base
  se lee de `ordenesColumns`. Un test compara el resultado contra `ordenesColumns.map(c => c.id)`
  calculado en el propio test — **nunca contra una lista literal**, que sería la aserción-contra-su-
  propia-fuente que este repo ya pagó. Con eso R26 es cierto por construcción.
- **`PRIMERAS` falla ruidoso** (R25): un test afirma que cada id de `PRIMERAS` existe entre las
  columnas montadas, en los dos alcances. Sin él, un rename en `/ordenes` dejaría la columna al
  final en silencio.
- **Este módulo cae dentro de los dos guardias del árbol** (`app/(app)/monitoreo/**` se censa
  entero). Restricciones que respeta: ni hex, ni paleta cruda de Tailwind, ni `badgeVariants`, ni
  par `-soft`/`-strong` a mano, ni literal de tamaño de página, ningún identificador que empiece por
  `sumar`, ningún mapa clavado por value de estatus, y ninguna lectura de `.rol`.

El panel (`DetalleMensajeroPanel.tsx`) sigue montando **él** `Modal` + `DataTable` + `Pagination`
—la cláusula (g) de `primitivas.guardia.test.ts` lo exige por nombre de archivo— y pasa
`columnasDetalle(detalle.alcance)` y `rowKey="id"` (R29).

---

## 7. Contratos de entrada/salida

**Ruta:** no hay ruta nueva. Sigue siendo la Server Action `leerDetalleMensajeroDia`
(`lib/actions/tablero-dia.ts`), con el mismo `entradaDetalleSchema` de zod
(`{ mensajeroId: uuid, pagina?: int 1..MAX_PAGE_SIZE }`) y la misma degradación: una entrada
malformada recorre el mismo camino y devuelve el mismo detalle vacío, sin eco del valor recibido
(R31/R32).

**Salida:** `ResultadoDetalleDia` = `{ estado: "ok", detalle }` | `{ estado: "denegado", motivo }`.
Sin cambios en el union; `detalle` gana `alcance` y sus `ordenes` cambian de forma.

**Integraciones externas:** ninguna. Ni Supabase Storage, ni Meta, ni WhatsApp, ni webhooks.

---

## 8. Dependencia con la feature 259 (declarada, no asumida)

La **259** —que **ya tiene spec**— cambia el `WHERE` del tablero para contar por **día de reparto**
en vez de por día de asignación (revierte D10). Esta feature **no toca ese predicado, no lo replica
y no lo asume**: consume `cteIdsDelDia` tal como esté el día que se implemente. Si la 259 entra
antes, el detalle de la 260 hereda su criterio sin cambiar una línea; si entra después, lo hereda
igual.

Punto de contacto único: las dos tocan `lib/repositories/TableroDiaRepository.ts` —la 259 en el CTE,
la 260 en la lista de columnas del `SELECT` de la segunda consulta—. Son zonas distintas del mismo
archivo, pero el arnés bloquea por **intersección de archivos** (`AGENTS.md > Paralelismo`): si la
259 está `in_progress`, la 260 espera. Se registra aquí para que el leader no lo descubra en un
conflicto de merge.

---

## 9. La reversión de R49 (192), por escrito

R49 de la feature 192 cerró el alcance del detalle en cuatro columnas por decisión humana. **Se
revierte, no se borra.** Se anota, con fecha y motivo, en los **dos** sitios donde esa decisión está
escrita hoy:

1. `specs/192-tablero-dia-mensajeros/requirements.md`, junto a R49: nota de reversión fechada
   `2026-08-21`, motivo «pedido humano: el detalle debe mostrar todos los datos de la orden;
   sustituido por la feature 260, que reusa `ordenesColumns`».
2. El docstring de `COLUMNAS` en `DetalleMensajeroPanel.tsx` («las columnas del detalle, y NINGUNA
   más»), que desaparece con la constante: **su texto se sustituye** por la nota de reversión, no se
   suprime en silencio. Si el criterio cambia y el comentario se queda, el código miente.

---

## 10. Ancho, scroll y la lección de la 258

20 columnas (17 en alcance `zona`) no caben en 1000 px. El desbordamiento lo resuelve `DataTable`
**dentro de su caja** (§1.9), y las cinco que importan quedan delante (R23).

La 258 dejó medido que la suite **no ve** un número recortado: `toHaveTextContent` pasa sobre un
`13` que se lee `1`, porque el nodo está en el DOM. Y la causa real fue un `min-w-0` que faltaba en
un ancestro, no en la pieza tocada. Por eso aquí:

- se comprueba en el **navegador**, con el modal abierto, a 1280 / 1024 / 830 / 768 px y en las dos
  densidades, que (a) la tabla desborda **dentro** de su caja y no empuja el diálogo, (b) aparecen
  las flechas de scroll, (c) ninguna cabecera ni celda queda recortada, (d) el diálogo no gana una
  barra de scroll horizontal propia;
- la comprobación se hace sobre **la caja que contiene**, no sobre la pieza recién tocada;
- si hace falta, se añade `min-w-0` al envoltorio del panel — **nunca** al `Modal` ni al
  `DataTable`: la cláusula (h) del guardia de primitivas prohíbe que una primitiva compartida sepa
  de esta pantalla.

---

## 11. Guardias: qué se pone rojo y qué no

| Guardia | Efecto | Acción |
| --- | --- | --- |
| `frontera.guardia` (d) · 3 consultas `["agregada","paginada","agregada"]` | **verde** si sólo se adelgaza el `SELECT` de la 2ª | no añadir una 4ª consulta |
| `frontera.guardia` (d) · `findMany` en el árbol | **verde**: el `findMany` vive en `OrdenRepository`, que no está en el censo | ver §12, límite conocido nº 1 |
| `frontera.guardia` (c) · nadie lee `.rol` ni declara 2 roles | **verde**: se consume `alcance`, no el rol | no nombrar roles en los archivos nuevos |
| `frontera.guardia` (f) · no-vacuidad «la feature consume el vocabulario del listado» | **verde**: `contadores.ts` y el módulo de columnas importan `estatus-label` | mantener ese import |
| `primitivas.guardia` (g) · el panel importa Modal/DataTable/Pagination | **verde** si el `DataTable` sigue montándose en `DetalleMensajeroPanel.tsx` | no moverlo a un hijo |
| `primitivas.guardia` (f) · sólo `tablero-dia.ts` declara un `sumar*` | **verde** | no llamar `sumar…` a nada nuevo |
| `ordenes-columnas-money-safe.guardia` | **verde por omisión**, y eso es el problema (§12 nº 2) | **ampliar su censo** (R41) |
| **`recorte-por-alcance.guardia`** (nueva) | roja si desaparece cualquiera de las dos mitades | §5.3, R44 |
| `./init.sh --rapido` | **ROJO a propósito**: se tocan `lib/types/tablero-dia.ts` **y** `lib/types/orden.ts` | correr **`./init.sh` completo** |

---

## 12. Límites conocidos, dichos y no rodeados

1. **El `findMany` de la hidratación queda fuera del censo del guardia.** `frontera.guardia`
   prohíbe `findMany` sobre el árbol de la feature, y el árbol es `ARCHIVOS_BACKEND` +
   `app/(app)/monitoreo/**`. `lib/repositories/OrdenRepository.ts` no está ahí, así que su
   `findMany` **no** pone el guardia rojo. Se dice claro: **está verde porque el guardia no llega,
   no porque la regla se cumpla por sí sola.** Lo que sí se cumple es el **fondo** de la regla —«no
   traer el día a memoria»—: la consulta va por `id IN (≤ 25)`. Añadir `OrdenRepository.ts` al censo
   no es opción (tiene 51 `findMany` legítimos). Lo que se hace en su lugar (R40): un test de
   servicio que afirma que `findListItemsByIds` recibe **exactamente los ids de la página** y nunca
   una lista sin acotar, y un test de **integración** que prueba el `WHERE` contra Postgres.
2. **La guardia del dinero no vigilaba `/monitoreo`.** `ordenes-columnas-money-safe.guardia.test.ts`
   censa `app/(app)/ordenes/_components` y `app/(app)/recepcion-satelite/_components`. Con esta
   feature nace una **tercera** superficie con importes. Se amplía su censo (R41), que además es la
   forma de que nadie vuelva a derivar dinero en el navegador desde aquí.
3. **`total` y la página pueden desalinearse en un caso extremo.** El `total` sale de la consulta 1
   y las filas de la 2. Si una orden se borra **entre** las dos, la página trae una fila menos que
   el total. Se acepta: la ventana es de milisegundos, y la alternativa (recontar) rompería R8.
4. **`telefonoDest` sigue viajando en los dos alcances.** El teléfono del **destinatario** es un
   escalar obligatorio de `OrdenDTO`, no del bloque de tienda, y no entró en el recorte de Q1. Queda
   dentro del techo de R18 (`/ordenes` ya lo envía) y ninguna columna lo pinta. Si algún día debe
   recortarse, es ficha propia: tocaría el DTO base del CRUD, no sólo el bloque `relaciones`.
5. **La suite no ve un recorte visual.** §10.

---

## 13. Alternativas descartadas

**A1 — Montar `OrdenesListado` en el modal.** Descartada, y es la razón que la feature 192 dejó
escrita en su alternativa 11, **verificada hoy y todavía cierta** (§1.3): es un contenedor de 11
props de negocio con nueve modales de acción por lote, dos escáneres, filtros y descarga, atado a
`/ordenes`. Montarlo traería **acciones a una pantalla de lectura**. Reusar el módulo de columnas da
todos los datos sin ninguna acción, y como el módulo es **uno solo**, las dos pantallas no pueden
divergir — que es lo que «reusar» significa aquí.

**A2 — Que la consulta del tablero traiga ella misma las 19 columnas.** Un `SELECT` gordo en
`listarOrdenesDelDia`, sin hidratación. Descartada por dos motivos, cualquiera de ellos bastante:
sería una **segunda proyección** de orden a fila de listado, que es exactamente lo que la ficha
prohíbe («no una segunda consulta que pueda desviarse»); y tendría que **re-derivar el flete y la
comisión en SQL**, cuando la feature 204 midió que recalcular ese dinero por un camino distinto
desvía un céntimo en 14 de 66 órdenes reales. El dinero se deriva en **un** sitio
(`costosListadoOrden` → `derivarIngresoOrden`) y ese sitio ya es el del listado.

**A3 — Llamar a `OrdenService.listar` con un filtro por mensajero y fecha.** Descartada por medida
(§1.5): `KNOWN_ROLES` no incluye `adminSatelite`, así que el rol que más usa `/monitoreo` recibiría
`forbidden`; y si se le añadiera, `construirWhere` **no acota por zona** y le devolvería filas
globales. Además leería `actor.rol`, abriendo una **segunda** frontera multi-tenant en una feature
cuya regla R8 es tener **una**.

**A4 — Reusar `ApiOrdenLecturaService`.** Descartada: no produce `OrdenListItemDTO` sino
`ApiOrdenListItemDTO`, el DTO **público** del canal por API key, sin relaciones y con otros nombres
(§1.6). Reusarlo obligaría a mapear entre dos DTO, que es una tercera forma que puede divergir.

**A5 — Recortar sólo en el navegador (no montar la columna y dejar el dato viajar).** Descartada por
decisión humana explícita: «que un campo no se pinte no basta — si llega en el payload, se puede
leer». El `adminSatelite` recibiría la tarifa completa de cada tienda a un `View source` de
distancia. (La simétrica —recortar sólo el dato y dejar la columna— está descartada en §1.8:
produce `₡0`, que miente.)

**A6 — Declarar en `/monitoreo` la lista de columnas que sí se quieren.** Es la solución obvia y es
la trampa: dos listas paralelas que divergen en cuanto `/ordenes` cambie, sin que nada se ponga
rojo. Se descarta a favor de **derivar** de `ordenesColumns` (§6): sólo se declara lo que no se
puede derivar —el **orden** de cinco ids y la **exclusión** de tres— y las dos declaraciones tienen
un test que falla si un id deja de existir.

**A7 — Un `zonaId?: string` en la firma del método nuevo del repositorio.** Descartada: convierte
«no sé» en «sin recorte». Se usa la unión de dos variantes que la 192 ya declaró (§4.2).

**A8 — Derivar el tipo del detalle con `Omit`/`Partial<Pick<…>>` en vez de aflojar `OrdenTiendaRef`.**
Descartada, y es la alternativa más tentadora: parece «más limpia» porque no toca el tipo del
listado. El problema es de **varianza**: con `email`/`telefono` omitidos o hechos opcionales sólo en
el tipo derivado, `OrdenDetalleDia` **deja de ser asignable** a `OrdenListItemDTO`, y bajo
`strictFunctionTypes` el `render: (row: OrdenListItemDTO) => ReactNode` de cada columna ya no acepta
la fila del detalle. Montar `ordenesColumns` exigiría un **cast**, y ese cast es precisamente la
costura por la que las dos pantallas pueden divergir sin que el compilador diga nada — es decir,
rompería lo que la ficha viene a conseguir. La alternativa elegida cuesta **dos caracteres** en la
única declaración del tipo y §1.10 midió que no rompe a ningún lector.

---

## 14. Preguntas abiertas

**Ninguna.** Las cuatro que tenía este documento se resolvieron en la puerta humana del
**2026-08-21** y están escritas como requisitos: R13–R17 y R43/R46 (Q1 y Q2), R23–R25 (Q3), R45
(Q4). La tabla con las respuestas literales está en `requirements.md > Decisiones cerradas`.
