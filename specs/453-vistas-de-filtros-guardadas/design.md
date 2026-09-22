# Ficha 453 — Diseño

> Todo lo que aquí se afirma del código está **verificado en el archivo**, no leído del grafo. Las
> referencias llevan archivo y línea del árbol en `dev` @ `0930087e` (2026-09-21).

---

## 1. Alcance

**Se construye:** una tabla nueva, su repositorio/servicio/acciones, un control de vistas **en la
barra compartida**, y la costura mínima que permite **imponer un filtro desde fuera** a los dos
componentes canónicos. Se enciende **solo `/ordenes`**.

**No se toca:** ninguna otra pantalla, el contrato de `listarOrdenes`, `serializarFiltro`,
`seleccionAFilter`, el codec `lib/utils/filtros-url.ts`, ni el comportamiento de la barra cuando la
superficie no declara vistas.

---

## 2. Lo que hubo que averiguar antes de diseñar

### 2.1 La ficha 328 — **se arrastra la mitad, se esquiva la otra, y queda más fácil**

La 328 declara dos huecos. **No son la misma cosa y esta ficha los trata distinto.**

**HUECO 1 — `BuscadorFiltros` es de escritura únicamente. → SE ARRASTRA. Es exactamente la pieza
que falta.**
Verificado: `components/shared/BuscadorFiltros.tsx:208` declara `const [texto, setTexto] =
useState(precarga.termino)` y `:203` congela `precarga` en un inicializador perezoso que lee la URL
**una sola vez**. El contrato de props (`:44-120`) **no tiene `value`**: solo `onChange` (`:70`).
`onLimpiarTodo` (`:97`) avisa **hacia** el consumidor, no ordena hacia la barra. Conclusión: hoy la
única vía para poner un término desde fuera es **remontar con `key`**, y eso relee la URL, no la
vista. Sin cerrar este hueco, una vista con término de búsqueda **no se puede aplicar**.

**El gemelo del hueco 1 en el orquestador, que la 328 no lista pero sí describe.**
`FilterComponent` es dueño de su selección: `components/shared/FilterComponent.tsx:444` la inicializa
desde la URL y solo la cambian `fijar` (`:645`) y `limpiarTodo` (`:653`). No hay `value` ni forma de
imponerla. El propio repo ya lo tiene escrito como bloqueo, en
`app/(app)/cierres-admin/_components/FiltrosCierresBarra.tsx:96`: *«`FilterComponent` es dueño de su
selección: desde fuera solo se puede REMONTAR entero (el truco de la `key`)»*, y en
`app/(app)/ordenes/_components/OrdenesListado.tsx:841-843`, donde vive ese mismo truco
(`resetFiltros`). Es la misma forma de hueco que el 1 y se cierra con el mismo mecanismo.

**HUECO 2 — `FilterComponent` no tiene modo «aplicar». → SE ESQUIVA.**
Ese hueco es un **submit**: las cuatro barras de wallet mantienen un borrador local y solo emiten al
pulsar «Aplicar» porque **cada lectura recalcula agregaciones de dinero**. Aquí no hace falta nada de
eso: esta ficha no necesita *retrasar* la emisión, necesita *originarla desde fuera*. Nada de lo que
se añade aquí toca el debounce ni la emisión por cambio, así que **el hueco 2 queda exactamente como
estaba** y el orden que la 328 fija (primero ella, después las cuatro de wallet) no se altera.

**Y la 328 queda MÁS FÁCIL, no peor.** El mecanismo que esta ficha añade (`§7`, prop `siembra`) es
literalmente lo que el hueco 1 pide: **poner o vaciar el término desde fuera sin remontar y sin tirar
el foco**. Con él disponible, la 328 puede retirar los tres remontes con `key` que hoy usan
`FiltrosEntregas`, `HistoricoFiltrosBar` y `SateliteOrdenesListado`, y desbloquear
`TableroDiaControles` (cuyo botón «Quitar el filtro» vive en otro componente). **Esta ficha no migra
esas cinco pantallas**: eso sigue siendo la 328. Solo deja puesta la pieza.

### 2.2 La ficha 326 — **se esquiva para entregar; condiciona el rollout**

`/ordenes` ya usa la barra canónica, así que **nada de la 326 bloquea esta entrega**. Lo que la 326
explica es **qué superficies podrán encenderse después y cuáles no** (`§10`).

Lo que el censo del diseño previo dice, **contrastado con el código de hoy**:

| Afirmación del censo | Verificado | Veredicto |
| --- | --- | --- |
| `/analitica` · Operativo «escribe la query a mano» | **Cierto.** `app/(app)/analitica/_components/operativo/FiltrosOperativos.tsx:19,136-137,199` usa `useRouter`/`useSearchParams` y `router.replace` directos, con codec propio (`filtro-tablero.ts:131,149`), **sin** `useFiltrosUrl` ni `BuscadorFiltros`/`FilterComponent`. | No se puede encender sin la 326 |
| `/cierres-admin` «no persiste en URL» | **Impreciso.** `FiltrosCierresBarra.tsx:381,397` monta los DOS canónicos **sin** `leerDeUrl={false}`, o sea con el default `true`: un enlace `/cierres-admin?zona=…` **sí** siembra la barra, igual que en `/ordenes`. | Sí es candidata |

**Y el hallazgo que de verdad importa para esta ficha:** *ninguna* superficie **escribe** sus filtros
en la URL. `BuscadorFiltros` lo dice en su propia cabecera (`:155-163`): la lee una vez al entrar y a
partir de ahí **solo la RESTA**. La única que la escribe es Analítica·Operativo, a mano. Conclusión:
**la URL no es hoy una forma persistida en ninguna pantalla**, así que no sirve de atajo para esta
ficha (ver `§12`, alternativa B).

### 2.3 El diseño previo de `design-filtros/` — **encaja en el sitio, choca en el contenido**

`design-filtros/canvas.json` describe cinco tableros. El recomendado, `Main.dc.html` («Opción C —
Vistas de trabajo»), propone **seis vistas fijas** en un `SegmentedToggle` encima de la barra, y
renombra «Filtros» a «Afinar» para que el contador cuente solo lo añadido *sobre* la vista.

- **Choca** en el contenido: esas seis son **combinaciones de estado calculadas y fijas para todos**
  —«una vista mal elegida es peso muerto en la barra para siempre», dice su propia nota—, que es
  exactamente lo que el humano descartó (decisiones 1 y 7). Y un `SegmentedToggle` no admite N vistas
  con nombre libre, renombrado y borrado.
- **Encaja** en lo demás, y se aprovecha: (a) las vistas van **antes** que el refinamiento, no
  después; (b) su medición del problema —con 4 filtros puestos la barra ocupa **3 líneas y 112 px**
  antes de la tabla, y los dos conmutadores de orden se llevan **451 px** de ~1480— es el argumento
  para **no** abrir una segunda fila (`§9`); (c) su censo confirma **«cero vistas guardadas: no
  existe ningún preset de usuario en todo el repo»**, así que no hay nada previo con lo que alinearse.

### 2.4 `serializarFiltro` **no** sirve como forma persistida

`app/(app)/ordenes/_components/serializar-filtro.ts:25-36`. Cuatro razones, cada una suficiente:

1. **No es reversible.** Produce `clave=valor,valor&clave=valor` y **no escapa nada**. `q` es texto
   libre y puede traer `&`, `=` o `,`: la cadena resultante no se puede volver a partir sin
   ambigüedad. Su hermano `lib/utils/filtros-url.ts:13-17` documenta el mismo límite y **exime a
   `text` de partirse** (`:150-156`) precisamente por eso.
2. **Serializa la capa equivocada.** Su entrada es `OrdenesFilterUI`, o sea el filtro **ya
   traducido al transporte** por `seleccionAFilter` (`created_preset` **o** `created_desde`/
   `created_hasta`, `q` escalar, `reasignables: true`…). Reponer la barra necesita el estado de la
   **UI**: qué controles están montados (`activos`) **no se puede derivar** del transporte —un
   control montado y vacío no aporta ninguna clave— y `created` es una terna posicional en la UI.
3. **Ordena los valores** (`:31-32`). Para una clave de caché eso es la virtud; para una forma
   persistida significa que el viaje de ida y vuelta no es la identidad.
4. **Su propósito declarado es otro** (`:3`, «identidad de cache/refetch del listado», R61). Confundir
   los dos formatos tiene precio en las dos direcciones: cambiar la clave de caché cambiaría lo
   guardado, y añadir un campo para persistir **fragmentaría la caché SWR** y provocaría un refetch
   de todas las combinaciones.

→ **Formato propio** (`§4`), versionado, sobre la forma que la app ya tiene como canónica y agnóstica:
`FilterSelection` (`Record<string, string[]>`).

---

## 3. Modelo de datos

### 3.1 La tabla

```prisma
/// FICHA 453 — UNA COMBINACION DE FILTROS GUARDADA CON NOMBRE. Grano: una fila por VISTA
/// (dueño × superficie × nombre). No es 1:1 con la persona: por eso NO cabe en
/// `usuario_preferencia`, que es 1:1 y de columnas tipadas por decisión explícita (ficha 422).
model VistaFiltro {
  id        String @id @default(uuid())
  usuarioId String @map("usuario_id")

  /// La superficie: el JUEGO DE FILTROS de una pantalla, no su ruta (ver §10).
  /// TEXT y no enum de Postgres, a propósito: la decisión 3 del humano exige que sumar una
  /// superficie sea ENCENDERLA, y un enum obliga a migración (y a la trampa del `down.sql` que
  /// recrea-con-lista). La lista cerrada vive en `lib/types/vista-filtro.ts` y la valida el borde
  /// con `z.enum`, así que una superficie desconocida da `validation_error`, NUNCA lista vacía (R33).
  superficie String

  /// Nombre visible. Obligatorio, 1..60 tras recortar (R9/R10).
  nombre String @db.VarChar(60)

  /// El filtro, en el formato de §4. JSONB validado por zod en ESCRITURA y en LECTURA:
  /// una fila ilegible se reporta ilegible (R8), nunca se aplica a medias.
  filtro Json

  /// Versión del formato de `filtro` (R7). Columna propia y no solo dentro del JSON: así se puede
  /// filtrar y contar por versión sin abrir el documento el día que haya una v2.
  version Int @default(1)

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @default(now()) @updatedAt @map("updated_at")

  usuario Usuario @relation("VistaFiltroUsuario", fields: [usuarioId], references: [id], onDelete: Cascade)

  /// R11 + R35: el nombre es único DENTRO del dueño y la superficie. Dos personas distintas
  /// pueden tener «San José arriba» a la vez — que es la propiedad que mantiene posible publicar
  /// una vista algún día (§11) sin cambiar grano ni claves.
  @@unique([usuarioId, superficie, nombre], name: "vista_filtro_dueno_superficie_nombre_key")
  @@map("vista_filtro")
}
```

### 3.2 Índices — y por qué no hay más

El único índice, además de la PK, es el **único compuesto** `(usuario_id, superficie, nombre)`. No es
solo la restricción de R11: es **el índice de la única consulta caliente**, que es
`WHERE usuario_id = ? AND superficie = ? ORDER BY nombre` —prefijo exacto del índice, y el orden sale
gratis—. Un índice más por `created_at` sería peso muerto: el listado se ordena por nombre (es lo que
la persona busca con la vista) y el conjunto está acotado por el tope (`§3.4`).

### 3.3 Migración `db/migrations/20260921120000_vista_filtro/`

**`migration.sql`** — aditiva; no altera ninguna tabla, columna, índice ni enum previo:

1. `CREATE TABLE "vista_filtro"` con PK, FK `usuario_id → usuario(id) ON DELETE CASCADE ON UPDATE
   CASCADE` (criterio de `usuario_preferencia`/`push_suscripcion`: **una vista no es evidencia**, se
   va con la persona, R4).
2. `CREATE UNIQUE INDEX "vista_filtro_dueno_superficie_nombre_key" ON "vista_filtro"("usuario_id",
   "superficie", "nombre");` — escrito a mano con el nombre que Prisma espera, para que datamodel y
   base no difieran.
3. `ALTER TABLE "vista_filtro" ENABLE ROW LEVEL SECURITY;` — **habilitada sin policies**, patrón
   `usuario_preferencia` / `push_suscripcion` / `jobs` / `notificacion`: este repo no usa Supabase
   Auth (sesión propia, sin `auth.uid()`), así que una policy no tendría a quién preguntar. Lo que la
   RLS garantiza es que a estas filas no se llega si no es por el servidor de la aplicación; la
   autorización de negocio vive en el servicio (`§6`).

**Sin backfill.** No hay nada que migrar: el censo confirma que hoy no existe ningún preset guardado
en todo el repo.

**Sin `CREATE TYPE` / `ALTER TYPE`.** Aquí no hay ningún enum, así que **no aplica** la lección de los
enums recreados con lista y **no se toca ningún `down.sql` anterior** (cada uno es una foto de su
rama y sigue siendo cierto). Queda escrito en el propio archivo.

**`down.sql`** — una sola sentencia, `DROP TABLE IF EXISTS "vista_filtro";`, que arrastra PK, índice
único, FK y la configuración de RLS. Escrito en voz alta en el archivo: **al revertir se pierden
todas las vistas de todo el mundo**, y no hay forma de recuperarlas (no hay otra copia en ningún
sitio); nadie deja de poder filtrar por ello —la barra sigue exactamente como hoy—, pero cada persona
vuelve a rearmar su combinación cada mañana, que es el estado que esta ficha vino a cambiar. No toca
`usuario` ni ninguna otra tabla: ni un `UPDATE`, ni un `DELETE`, ni un `INSERT`.

### 3.4 El tope

`MAX_VISTAS_POR_SUPERFICIE = 20`, en `lib/types/vista-filtro.ts`. Lo impone el **servicio**
(`count` + rechazo), no la base.

**Lo que eso cuesta, dicho entero:** `count`-y-después-`insert` no es atómico, así que dos pestañas
guardando a la vez pueden dejar **21**. Se acepta a sabiendas: el daño de pasarse por una es que se
ve una vista de más en una lista, y la siguiente escritura ya se rechaza. Hacerlo estructural exigiría
un `trigger` o una columna `posicion` con único `(usuario_id, superficie, posicion)`, que es un
mecanismo entero para un problema que no duele. (Es la asimetría contraria a la de
`usuario_preferencia`, donde la unicidad **sí** tenía que ser estructural porque dos filas cambiaban
la respuesta a la lectura.)

---

## 4. El formato persistido del filtro

```ts
// lib/types/vista-filtro.ts — modulo PURO (sin React, sin Prisma, sin next/)
export const VISTA_FILTRO_VERSION = 1;

export const vistaFiltroPayloadSchema = z.object({
  v: z.literal(VISTA_FILTRO_VERSION),
  /** El término del buscador, ya recortado. `""` = sin búsqueda. */
  termino: z.string(),
  /** Claves de los controles MONTADOS, en su orden. No se deriva de `seleccion`. */
  activos: z.array(z.string()),
  /** La selección agregada, TAL CUAL la emite `FilterComponent`. */
  seleccion: z.record(z.string(), z.array(z.string())),
}).strict();
```

**Por qué esas tres piezas y no otras.** Son exactamente los tres estados que `OrdenesListado`
mantiene para la barra: `terminoBuscador` (`:832`), `filtrosActivos` (`:838`) y `seleccionFiltros`
(`:826`). Reponer esos tres es reponer la barra; no hay una cuarta.

**Por qué `FilterSelection` sin traducir.** Es la forma **agnóstica y canónica** de la app: la que
`FilterComponent` emite (`:81`), la que `seleccionDesdeUrl` produce (`filtros-url.ts:179`) y la que
cada superficie ya sabe traducir a su transporte (`seleccion-a-filter.ts` en órdenes, `aFiltros` en
cierres). Guardarla sin traducir es lo que hace el mecanismo **genérico** (decisión 2): la tabla no
conoce ni una clave de dominio.

**Por qué JSONB y no una columna por filtro.** Lo segundo mataría la genericidad: 12 claves hoy solo
en `/ordenes`, y encender otra superficie pediría una migración por clave, justo lo que la decisión 3
prohíbe. **Y no reabre el debate anti-EAV de `usuario_preferencia`**: aquel argumento era que *una
clave mal escrita no falla, devuelve «no hay preferencia»* —silencio—. Aquí no hay silencio posible:
el payload se valida con zod **al escribir y al leer**, un documento que no parsea se reporta
**ilegible** (R8) y una superficie desconocida se **rechaza** (R33).

**El ORDEN del listado NO entra** (`sortBy`/`sortDir`). Motivo: el orden no esconde filas, y el propio
`OrdenesListado.limpiarFiltros` (`:866-878`) ya lo excluye hoy de «Limpiar todo» con ese mismo
razonamiento escrito. Está en `requirements.md > P1`; el campo `v` deja añadirlo después sin romper
nada guardado.

**Relación con `serializarFiltro`: ninguna, y se vigila.** Una guardia del árbol
(`§14`) se pone roja si el módulo de persistencia importa `serializar-filtro.ts`, o si el payload se
usa como key de SWR. Son dos formatos con dos dueños; el día que se acerquen, alguien tiene que
enterarse.

---

## 5. Contratos — Server Actions

`lib/actions/vistas-filtro.ts`, `'use server'`. Mutaciones internas ⇒ **Server Actions**, no rutas API
(`docs/architecture.md`). Patrón exacto de `lib/actions/push.ts`: actor de la sesión con
`resolveActorFromSession`, zod **`.strict()`** en el borde, `withErrorHandler` + `toActionError`, y
`deps` inyectables para test sin DB ni cookies.

| Acción | Entrada (`.strict()`) | Salida `ok` | Errores |
| --- | --- | --- | --- |
| `listarVistasFiltro` | `{ superficie }` | `{ vistas: VistaFiltroDTO[] }` (orden: nombre asc) | `validation_error` (superficie no declarada), `unauthenticated` |
| `guardarVistaFiltro` | `{ superficie, nombre, filtro }` | `{ vista: VistaFiltroDTO }` | `validation_error`, `conflict` (nombre duplicado), `limit_reached` (tope), `unauthenticated` |
| `renombrarVistaFiltro` | `{ id, nombre }` | `{ vista }` | `validation_error`, `conflict`, `not_found`, `unauthenticated` |
| `actualizarVistaFiltro` | `{ id, filtro }` | `{ vista }` | `validation_error`, `not_found`, `unauthenticated` |
| `eliminarVistaFiltro` | `{ id }` | `{}` | `not_found`, `unauthenticated` |

```ts
export interface VistaFiltroDTO {
  id: string;
  nombre: string;
  superficie: SuperficieVista;
  /** Ya parseado y validado. `null` = el documento guardado no es legible (R8). */
  filtro: VistaFiltroPayload | null;
  actualizadaEn: string; // ISO
}
```

**`usuarioId` NO existe en ninguna entrada.** Los schemas son `.strict()`, así que uno inyectado da
`validation_error` en vez de ignorarse — la misma regla, y por el mismo motivo, que `push.ts:9-12`.

**Una vista ajena responde `not_found`, no `forbidden`.** Deliberado: `forbidden` confirmaría que ese
id existe y es de otra persona. Sobre un recurso estrictamente personal eso es una filtración
gratuita, y «no lo tienes» es la respuesta verdadera desde el punto de vista de quien pregunta.

**Nada de esto revalida caché de servidor ni llama a `revalidatePath`:** la lista de vistas la lee el
cliente con SWR bajo la key `["vistas-filtro", superficie]` y las mutaciones la revalidan localmente.

---

## 6. Capas

```
components/shared/VistasFiltro.tsx        ← el control (cliente)  · §9
  ↓ Server Actions
lib/actions/vistas-filtro.ts              ← borde: sesión + zod + toActionError
  ↓
lib/services/VistaFiltroService.ts        ← reglas: propiedad, tope, nombre, legibilidad
  ↓ IVistaFiltroRepository
lib/repositories/VistaFiltroRepository.ts ← Prisma y nada más
```

- `lib/interfaces/repositories/IVistaFiltroRepository.ts`: `listar(usuarioId, superficie)`,
  `contar(usuarioId, superficie)`, `crear(...)`, `renombrar(id, usuarioId, nombre)`,
  `actualizarFiltro(id, usuarioId, payload)`, `eliminar(id, usuarioId)`.
- **`usuarioId` viaja en TODA firma del repositorio, incluidas las que ya tienen `id`.** No es
  redundancia: hace que la propiedad (R2) sea parte del **`WHERE`** y no de una comprobación previa
  que alguien pueda saltarse en la siguiente llamada. El test de ese `WHERE` corre **contra Postgres
  real**, porque un doble no ve el `WHERE`.
- `lib/utils/vista-filtro-aplicabilidad.ts`: **módulo puro** que decide qué partes de un payload son
  aplicables contra un juego de `FilterDef[]`. Sin React y sin dominio: entra `(filtros, payload)`,
  sale `{ aplicables, perdidas }`. Es el corazón de R24–R28 y es testeable sin renderizar nada.

---

## 7. La costura: imponer un filtro desde fuera (lo que arrastra de la 328)

Dos props nuevas, **aditivas y opcionales**; ausentes, los dos componentes se comportan exactamente
como hoy (R31).

```ts
// components/shared/BuscadorFiltros.tsx
siembra?: { senal: number; termino: string };

// components/shared/FilterComponent.tsx
siembra?: { senal: number; seleccion: FilterSelection };
```

**Semántica.** Cuando `senal` cambia, el componente **reemplaza** su estado interno por lo recibido y
**no emite**: quien impuso el valor es el consumidor, que ya lo sabe. Se usa el patrón de «ajustar
estado durante el render» que este árbol ya emplea en cuatro sitios (`resetSignal` de
`FilterComponent:223-227`, `resetSeleccion` y `filterKeyPrevio` de `OrdenesModule:340-376`,
`claveOrdenPrevia`): sin efecto y sin parpadeo intermedio.

Tres detalles que no son opcionales:

1. **`BuscadorFiltros` no se remonta.** `texto` es un `useState` normal: la siembra hace `setTexto` y
   además pone al día `emitido.current` (`:236`), o si no la guarda de «sin cambio» (`:298`) mentiría
   y el siguiente tecleo real se tragaría. **Esto es lo que resuelve el hueco 1 de la 328 sin tirar
   el foco**, que era su queja exacta.
2. **Dentro de `FilterComponent` hay controles NO controlados** —`TextFilter` (`:219`, inicializador
   perezoso) y `DateRangeFilter` (`defaultRange`, `:790`)— que no se pueden reponer con un `setState`.
   Se les cambia la `key` a `` `${filtro.key}:${senal}` ``: se remontan **solo esos controles**, leen
   su valor inicial de la nueva selección y el resto de la barra —incluido el campo de búsqueda— no
   se mueve. En `/ordenes` el único afectado es `created` (`dateRange`); el resto (`multi`, `single`,
   `boolean`) ya son controlados.
3. **La siembra CIERRA la siembra de la URL** (`cerrarSiembra()`, `:640`; `sembrado.current = true`,
   `:260`). Sin esto, un catálogo que llegue tarde reintentaría la siembra pendiente de la ficha 339
   (`:614-622`) y repondría sobre la vista aplicada un valor de la query. Es R23, y sin esto sería un
   fallo mudo de libro: el listado cambiaría solo, medio segundo después.

**Lo que esto NO hace, y por qué importa:** no añade modo submit, no toca el debounce, no cambia la
emisión por cambio. El **hueco 2** de la 328 y el orden «primero la 328, después las cuatro de
wallet» siguen intactos.

---

## 8. Aplicabilidad: la regla que aquí vale doble

### 8.1 Cómo se decide (módulo puro)

Para cada clave del payload, contra los `FilterDef[]` **declarados por la pantalla en ese momento**:

| `kind` | Aplicable cuando… | Parte perdida cuando… |
| --- | --- | --- |
| — | la clave sigue declarada | la pantalla ya no la declara (rol que cambió, filtro retirado) |
| `multi` | **todos** los valores están entre las opciones ofrecidas | uno o más valores ya no existen (tienda desactivada, mensajero de baja, estado fuera del catálogo) |
| `single` | el valor está entre las opciones | no está |
| `dateRange` | el atajo (si lo hay) está entre los declarados; las fechas siempre | el atajo ya no se ofrece |
| `boolean`, `text` | siempre | nunca (no dependen de catálogo) |

Cada parte perdida se reporta con la **etiqueta visible** del filtro (`FilterDef.label`) y, cuando se
conoce, la de la opción. Nunca un id crudo (R25, R39).

### 8.2 Qué pasa exactamente — **la decisión**

- **Aplicable entera** → se aplica sin preguntar (R18).
- **Con partes perdidas** → **no se aplica nada**. Se abre un `Modal` (el compartido) que enumera lo
  perdido y ofrece **dos** botones: **«Aplicar sin eso»** y **«Cancelar»**.
  - **Por qué no aplicar-y-avisar.** Aplicar y avisar a la vez deja el listado ya cambiado mientras
    la persona lee; quien mire para otro lado dos segundos se queda filtrando otra cosa. Exigir un
    clic convierte la pérdida en **reconocida** en vez de **anunciada**. Es un clic de más en un caso
    que, por construcción, es raro.
  - **Por qué no negarse del todo.** Una vista con un mensajero dado de baja y cinco distritos vivos
    sigue valiendo para los cinco distritos. Negarse entera tiraría trabajo bueno.
- **La vista queda marcada `incompleta`** en la lista, con el motivo alcanzable, hasta que se
  actualice o se borre (R28). **Aplicar nunca escribe** (R16): un catálogo caído no puede destruir una
  vista.

### 8.3 El caso que hay que separar, o todo esto se vuelve ruido

**«El catálogo no está» no es «el valor desapareció».** En `/ordenes` el catálogo se resuelve en el
servidor y la página ya contempla el fallo: `app/(app)/ordenes/page.tsx:40-49` devuelve `null` y
`OrdenesListado` monta los filtros **deshabilitados y sin opciones**
(`OrdenesListado.tsx:939-941`). El catálogo de estados tiene la misma forma de fallo:
`catalogoFetcher` (`:203-207`) devuelve `[]` cuando la lectura falla.

Si la aplicabilidad se calculara en ese instante, **todas** las vistas saldrían «incompletas» a la
vez. Por eso la comprobación exige que los catálogos estén **cargados**, y la pantalla lo declara:
para `/ordenes`, `catalogoFiltros !== null` **y** catálogo de estados no vacío (con 22 filas en
producción, un catálogo vacío solo puede ser un fallo de lectura; tratarlo como «no cargado» es la
dirección conservadora). Sin eso: no se clasifica, no se aplica, y se dice (R29).

---

## 9. Dónde se pinta, y por qué ahí

**Un único disparador «Vistas» dentro de `BuscadorFiltros`, al principio de la fila, antes del campo
y antes de los `children`.** Abre un `Popover` con la lista de vistas (aplicar / renombrar / borrar),
más «Guardar filtros actuales…» y, con una vista aplicada, «Guardar cambios en esta vista».

- **Tiene que renderizarlo la barra, no la pantalla.** La decisión 2 dice que el mecanismo vive en la
  barra compartida. Además el sitio pedido está **antes de los `children`**, y una pantalla solo puede
  inyectar `children` —que se pintan después—. Se enciende con una prop `vistas`; **ausente, no se
  monta nada**, exactamente la misma regla que `filtros` (`:75`) y `onLimpiarTodo` (`:97`) ya siguen,
  así que los otros 15 consumidores no cambian un píxel (R31).
- **Al principio y no al final.** La lectura de la fila es *qué estoy mirando → afinarlo → limpiarlo*.
  Y el extremo derecho ya lo ocupa «Limpiar todo», que **aparece y desaparece** (`:492`): un control
  al lado de otro que baila es un control que hay que buscar. Es el mismo argumento que
  `OrdenesListado:1237` escribe para los conmutadores de orden («un sitio fijo, que no baila según
  qué filtros haya puestos»), y R36 lo exige.
- **Un botón, no una fila nueva ni un `SegmentedToggle`.** Con el diseño previo a la vista: la barra
  ya ocupa **3 líneas y 112 px** con 4 filtros puestos, y los conmutadores de orden se llevan 451 px
  de ~1480. Una segunda fila de vistas es otra banda encima de la tabla más usada de la app; un
  disparador cuesta ~100 px en la fila que ya existe. Y un `SegmentedToggle` (lo que propone la Opción
  C) no admite N nombres libres con renombrado y borrado.
- **Las confirmaciones y los formularios van en `Modal`** (el compartido), no inline: el nombre pide
  un campo y un botón, y meterlos en el popover de la barra empuja la tabla.

---

## 10. Rollout por superficie: cuáles se pueden encender y con qué coste

La superficie es **el juego de filtros declarados**, no la ruta (`requirements.md > P4`).

**Se enciende ahora:** `/ordenes` (`OrdenesListado`) — 12 controles, la barra canónica, los tres
estados de barra ya viven en el consumidor.

**Listas para encender después** (montan `BuscadorFiltros` + `FilterComponent`; coste = declarar la
superficie + pasar dos props):

| Superficie | Componente | Nota |
| --- | --- | --- |
| `/recepcion-satelite/en-bodega` | `SateliteOrdenesListado` | hoy remonta la barra con `key`; con `§7` puede dejar de hacerlo |
| `/novedades` | `NovedadesFiltrosBarra` | ídem (`key={filtro.reset}`) |
| `/historico/acciones` | `HistorialAccionesFiltrosBar` | |
| `/historico/conversaciones` | `HistoricoFiltrosBar` | ídem |
| `/cierres-admin` ×3 | `FiltrosCierresBarra` | **tres superficies, no una** (`sinMensajero`, `conEstado`) |
| `/configuracion` · usuarios | `UsuariosModule` | |
| `/analitica` · Entregas | `FiltrosEntregas` | ídem remonte con `key` |

**No se pueden encender sin la ficha 326:**

| Superficie | Por qué | Coste |
| --- | --- | --- |
| `/analitica` · Operativo | no usa los canónicos; filtro tipado propio (`FiltroTablero`) y query escrita a mano (`FiltrosOperativos.tsx:199`) | migrarla a la barra canónica, o un segundo formato de payload |
| `/mis-asignaciones/reparto`, `/mis-asignaciones/recoger`, `/monitoreo` | barras a mano, filtrado **en cliente** | la 326 decide si merecen migrarse |
| las 4 barras de `wallet` | esperan a la **328 hueco 2** por su propio censo (submit deliberado sobre cifras de dinero) | no se tocan aquí |

---

## 11. Extensión prevista: publicar una vista para la oficina (**no se implementa**)

La decisión 7 exige que el modelo lo permita sin rehacerse. Lo que haría falta, y **nada de lo de
arriba lo bloquea**:

- una columna `publicada BOOLEAN NOT NULL DEFAULT FALSE` (más, si se quiere, `publicada_at`);
- la lectura pasa de `WHERE usuario_id = :actor` a `WHERE usuario_id = :actor OR publicada`;
- el grano, la PK, la FK y el índice único **no cambian**: la vista conserva su dueño, y como el
  único es `(usuario_id, superficie, nombre)`, dos personas pueden tener el mismo nombre (R35), así
  que una vista publicada no puede chocar con la personal de nadie.

Lo que **habría que decidir entonces**, y no se decide ahora: quién puede publicar; qué pasa cuando
el dueño edita una vista ya publicada; si alguien puede «copiarla» a una personal suya; y si el tope
(`§3.4`) cuenta las publicadas.

---

## 12. Alternativas descartadas

**A. Guardar las vistas en el navegador (`localStorage`), como las columnas de descarga.**
Hay precedente vivo: `usePreferenciaColumnas` / `claveDeAmbitoDescarga` (ficha 314) guardan por ámbito
en el navegador. **Descartada:** una vista es justo lo que se rearma cada mañana **en bodega**, donde
se cambia de máquina; en el navegador se pierde en el siguiente equipo y no se puede auditar ni
publicar jamás (decisión 7). Y `usuario_preferencia` tampoco vale: es **1:1 con la persona y de
columnas tipadas por decisión explícita** (ficha 422); N filas con nombre solo caben ahí
convirtiéndola en el cajón EAV contra el que ese mismo archivo argumenta.

**B. Guardar la query string y aplicar navegando.**
Tentadora porque `filtros-url.ts` ya **decodifica** y Analítica ya tiene un codificador. **Descartada,
por cuatro cosas medidas:** (1) el codec compartido **no tiene codificador** —solo `queryTrasLimpiar`,
que resta—, así que habría que escribirlo igual; (2) **no escapa el separador** (`:13-17`) y exime a
`text` de partirse, así que un `q` con una coma es expresable en JSONB y no ahí; (3) un
`router.replace` **no vuelve a sembrar** la barra montada —los dos componentes congelan los params en
un `useState` perezoso (`BuscadorFiltros:203`, `FilterComponent:401`)—, así que seguiría haciendo
falta la costura de `§7`, o un remonte completo que tira la tabla entera; (4) acoplaría el formato de
la base al de la URL, y el siguiente cambio de gramática de query (328/339) cambiaría **en silencio**
el significado de filas ya guardadas.

**C. Reusar `serializarFiltro` como forma persistida.** Descartada por las cuatro razones de `§2.4`.

**D. Una columna por filtro, en vez de JSONB.** Descartada: mata la genericidad que exige la decisión
2 y obliga a una migración por clave para encender cada superficie, contra la decisión 3.

**E. Vistas fijas calculadas (Opción C de `design-filtros/`).** Descartada **por el humano**
(decisión 1) y confirmada por la medición: ningún atajo automático por volumen sirve, y «San José
arriba» no es derivable de los datos.

---

## 13. Riesgos y límites aceptados

- **Cada quien tendrá su idea de «San José arriba», y quien entra nuevo empieza de cero.** Riesgo
  aceptado y firmado (decisión 7). La salida futura es publicar (`§11`).
- **El tope puede pasarse por uno** en una carrera entre pestañas (`§3.4`).
- **Nombres que solo difieren en mayúsculas** conviven (`requirements.md > P3`).
- **La vista aplicada no es compartible por enlace**: la barra sigue sin escribir la URL (R18 de la
  339, intacto). Se mitiga el efecto peor —que recargar reponga el filtro viejo— retirando los params
  propios al aplicar (R21), con la maquinaria que ya existe (`borrarParams`, que solo resta).
- **El contador «Filtros (N)» sigue mintiendo** (cuenta controles pedidos, no valores). Medido en el
  censo previo; no lo toca esta ficha.

---

## 14. Verificación

**El gate de esta ficha es `./init.sh` COMPLETO.** El diff toca `db/schema.prisma`,
`db/migrations/**` y `lib/types/**`: `--rapido` **se niega solo** (`docs/verification.md`). No se
pierda tiempo intentándolo.

Piezas de verificación que el diseño exige (el mapa `R<n> → test` completo está en `tasks.md`):

- **El `WHERE` se prueba donde vive**: la propiedad (R2) y el CASCADE (R4) contra **Postgres real**
  (`tests/integration/db/vista-filtro.test.ts`). Un doble de repositorio no ve el `WHERE`, y en este
  repo eso ya dejó pasar una mutación cuatro veces seguidas.
- **La migración se prueba en sus dos mitades** (molde de `usuario-preferencia-migration.test.ts`): lo
  que se lee del `.sql` y lo que **solo** sabe el motor (que la tabla existe con su forma, que el
  único índice está, que `relrowsecurity` es `true`, que la FK es CASCADE). Con su
  **autocomprobación** al principio: si los archivos no se leyeran, todas las aserciones quedarían
  verdes y mudas.
- **Dos guardias nuevas**, que se seleccionan solas por nombre (`vitest run guard`):
  - `vistas-superficies-declaradas.guardia.test.ts` — toda superficie de `SUPERFICIES_VISTA` tiene
    control montado en el árbol (R34). Es la lección de `superficie-de-uso`: un mecanismo que nadie
    puede disparar no rompe ningún test.
  - `vista-filtro-formato-propio.guardia.test.ts` — el módulo de persistencia **no** importa
    `serializar-filtro.ts`, y el payload no se usa como key de SWR (R6).
- **Sin `DATABASE_URL` la capa de datos se SALTA**, no falla. Mirar los `skipped` del gate, no solo el
  `INIT_EXIT`.
