# Feature 285 — Filtro por rol y buscador en el listado de usuarios · design.md

> El QUÉ está en `requirements.md`. Aquí va el CÓMO: contratos, modelo de datos, rutas,
> alternativas descartadas y verificación. Referencias: `docs/architecture.md` (capas,
> zod en el borde), `docs/conventions.md`, `docs/verification.md`.

---

## 1. Resumen de la decisión

Se añaden **dos claves opcionales al contrato del listado de usuarios** (`q` y `rol`), que
bajan por las capas ya existentes hasta un **`where` nuevo** en `UserRepository.list`, y se
monta en la pantalla **la misma barra que usa el resto de la app** con un archivo propio de
declaraciones, calcando `ordenes-filtros-def.ts`.

**Lo que NO se toca, y es deliberado:**

| No se toca | Por qué |
| --- | --- |
| `db/schema.prisma`, `db/migrations/**` | **No hay tabla, columna, índice ni RLS nuevos.** Ver §5. |
| `components/shared/BuscadorFiltros.tsx`, `components/shared/FilterComponent.tsx` | Ya son genéricos y soportan todo lo que hace falta (`kind: "multi"`, `minChars`, `placeholder`, `debounceMs`). Reusar es consumirlos, no editarlos. |
| `app/(app)/ordenes/**` (incluido `ordenes-filtros-def.ts`, `seleccion-a-filter.ts`) | Pedido explícito del humano. |
| `app/(app)/configuracion/page.tsx` | El filtro de rol **no necesita catálogo del servidor** (§4.2), así que la página sigue pre-cargando exactamente lo mismo. |
| `usuarios-descarga-columnas.ts` y la guardia de columnas de la 170 | Esta feature cambia **qué filas** salen, no **qué columnas** (R24). |
| `IUserRepository.count()` (el método suelto) | Nadie lo llama desde el listado: el `total` sale del `count` interno de `list`. Ampliarlo sería cambiar un contrato muerto. |

---

## 2. Contrato del borde (Server Actions)

### 2.1 Constantes — `lib/types/usuario.ts`

```ts
export const USUARIO_BUSQUEDA_MIN_CHARS = 2;
export const USUARIO_BUSQUEDA_MAX_CHARS = 120;
```

Viven **junto al schema que las valida** (calco de `BUSQUEDA_MIN_CHARS` en
`lib/types/orden.ts`) y el control de la barra las importa de ahí: **un solo origen** para el
mínimo, que es lo que exige R29. Los números y su razón, en §7.

### 2.2 Lista blanca de roles

```ts
// ROL_LABELS es Record<RolValue, string> y es EXHAUSTIVO sobre el enum: si el enum gana un
// valor, el compilador exige su etiqueta, y de ahí sale sola la opción del filtro.
const ROLES_FILTRO = Object.keys(ROL_LABELS) as [RolValue, ...RolValue[]];
export const usuarioRolFiltroSchema = z.enum(ROLES_FILTRO);
```

El único `as` del cambio, y está acotado a tipar una tupla no vacía. Lo que garantiza la
**exhaustividad** no es el `as`, es el test de §9 (T-U4), que compara la lista blanca contra
las claves de `ROL_LABELS`.

### 2.3 `listarUsuariosSchema` (ampliado)

```ts
export const listarUsuariosSchema = z.object({
  page: …, pageSize: …, sortBy: …, sortDir: …,          // sin cambios
  q: z.string().trim().min(USUARIO_BUSQUEDA_MIN_CHARS)
     .max(USUARIO_BUSQUEDA_MAX_CHARS).optional(),        // R8
  rol: z.array(usuarioRolFiltroSchema).nonempty().optional(), // R15
});
```

- `.trim()` **antes** de `.min()`: `"  a  "` es 1 carácter, no 5 (R6), y al servicio llega ya
  recortado.
- `.nonempty()`: una lista vacía es `validation_error`, **nunca** "sin filtro". Falla cerrado
  (misma disciplina que `idList` en `lib/types/orden.ts`): si un día el repositorio recibiera
  `[]` y lo descartara, un filtro presente degradaría a "todos" y devolvería **de más**.
- Ambas `optional()`: sin ellas la llamada de hoy (`{ page, pageSize }`) dejaría de validar.
  El schema base **no** es `.strict()` y no se le añade (su contrato no lo tiene y esta
  feature no lo cambia).

### 2.4 `listarUsuariosCompletoSchema` — no se toca una línea

Sigue siendo `listarUsuariosSchema.omit({ page: true, pageSize: true }).strict()`. Al ser
**derivado**, las dos claves nuevas aparecen solas en la entrada de la descarga. Eso es la
respuesta al punto abierto nº 1 del encargo, y se argumenta en §6.

### 2.5 Acciones — `lib/actions/usuarios.ts`

**Sin cambios.** `listarUsuarios` y `listarUsuariosCompleto` ya hacen
`schema.parse(input ?? {})` y delegan en el servicio; las claves nuevas viajan por el mismo
tubo. Que este archivo no cambie es un indicador de que el borde estaba bien puesto.

---

## 3. Contrato interno (capas)

```
UsuariosModule (cliente)                       ← barra compartida + traducción
  ↓ listarUsuarios({ page, pageSize, q?, rol? })
lib/actions/usuarios.ts                        ← zod (sin cambios de código)
  ↓ service.listar(input, actor)
lib/services/UsuarioService.ts                 ← guard de rol + construirFiltro()
  ↓ repo.list({ skip, take, sortBy, sortDir, busqueda?, roles? })
lib/repositories/UserRepository.ts             ← el WHERE, y el MISMO where en el count
  ↓
Postgres
```

### 3.1 `ListUsuariosParams` (`lib/interfaces/repositories/IUserRepository.ts`)

```ts
export interface ListUsuariosParams {
  skip: number;
  take: number;
  sortBy?: string;
  sortDir?: "asc" | "desc";
  /** Fragmento a buscar en nombre o correo. Ya recortado por el borde. */
  busqueda?: string;
  /** Roles admitidos. NUNCA lista vacía: ausente = sin filtro. */
  roles?: RolValue[];
}
```

Nombres **de dominio**, no de transporte (`busqueda`/`roles`, no `q`/`rol`): la traducción
clave-pública → concepto interno se hace en el servicio, que es donde se hace en el resto del
repo.

### 3.2 `UsuarioService.listar` / `listarCompleto`

Se extrae **un solo** método privado `construirFiltro(input): Pick<ListUsuariosParams,
"busqueda" | "roles">` y **lo llaman los dos**. Es la misma razón por la que
`OrdenService.construirWhere` es compartido: si cada camino armara el suyo, la descarga y la
pantalla podrían discrepar sin que nada lo delatara (R22).

⚠️ **Deuda documental que hay que cerrar en la misma tanda:** el comentario de
`listarCompleto` (`UsuarioService.ts:143`) afirma hoy que *«NO hay `construirWhere` que
extraer aquí, y eso es un HALLAZGO»*. Esta feature lo desmiente. **Se reescribe**; dejarlo
sería dejar escrita una afirmación falsa que la próxima sesión usaría como argumento.

El guard `ALLOWED_ROLES` sigue **antes** de tocar el repositorio en los dos métodos (R26): un
rol no autorizado no ejecuta ni la consulta filtrada.

### 3.3 `UserRepository.list` — el `WHERE`

```ts
const where: Prisma.UsuarioWhereInput = {
  ...(params.roles?.length ? { rol: { value: { in: params.roles } } } : {}),
  ...(params.busqueda
    ? {
        OR: [
          { nombre: { contains: escaparComodinesLike(params.busqueda), mode: "insensitive" } },
          { email:  { contains: escaparComodinesLike(params.busqueda), mode: "insensitive" } },
        ],
      }
    : {}),
};

const [rows, total] = await Promise.all([
  this.prisma.usuario.findMany({ select: LIST_SELECT, orderBy, skip, take, where }),
  this.prisma.usuario.count({ where }),   // ⚠️ EL MISMO objeto (R17)
]);
```

Cuatro decisiones que el reviewer debe poder señalar en el código:

1. **`count` con el MISMO `where`.** Hoy es `count()` a secas. Dejarlo así pintaría "1–25 de
   48" bajo una tabla de 3 filas y, peor, haría que el tope de la descarga se midiera contra
   el total sin filtrar (§6). La mutación que lo mata está en §9 (T-I3).
2. **`OR` de dos columnas: aquí es seguro, y hay que decir por qué.** En `/ordenes` está
   prohibido meter el término en un `OR` porque ahí convive con el **acotamiento por rol**, y
   un `OR` mal puesto lo desactivaría. En usuarios **no existe tal acotamiento**: el módulo
   entero es de `maestro` y no recorta filas por actor. El `OR` es hermano del filtro de rol
   (`AND (rol …) AND (nombre … OR email …)`), así que el rol sigue mandando (R16).
3. **Escapado de comodines.** Prisma interpola el valor de `contains` dentro de `%valor%` sin
   escaparlo: sin esto, `"%"` devuelve el listado entero — no es precisión, es una fuga de
   alcance del filtro (R5).
4. **`mode: "insensitive"`** (ILIKE) para R4. **No pliega acentos**: ver §8.

**Dónde vive el escapador.** `OrdenRepository` tiene una copia **privada de módulo**
(`escaparComodinesLike`, línea 962) que **no se exporta**. Se crea
`lib/utils/escapar-like.ts` (módulo puro, una función) y **solo `UserRepository` lo importa**.
No se toca `OrdenRepository`: unificar las dos declaraciones significaría editar el módulo de
órdenes, que es justo lo que el humano prohibió en esta ficha. Queda anotado como deuda en §8.

---

## 4. Frontend

### 4.1 Archivos nuevos (`app/(app)/configuracion/_components/`)

| Archivo | Qué es | Puro |
| --- | --- | --- |
| `usuarios-filtros-def.ts` | Claves, placeholder y `construirFiltrosUsuarios(): FilterDef[]`. Calco de `ordenes-filtros-def.ts`. | sí (sin React) |
| `seleccion-a-filtro-usuarios.ts` | `FilterSelection` + término → `{ q?, rol? }`. Calco de `seleccion-a-filter.ts`. | sí |

### 4.2 `usuarios-filtros-def.ts`

```ts
export const CLAVE_BUSQUEDA = "q";
export const CLAVE_ROL = "rol";
export const PLACEHOLDER_BUSQUEDA = "Buscar por nombre o correo";   // R11

export function construirFiltrosUsuarios(): FilterDef[] {
  return [{
    key: CLAVE_ROL, label: "Rol", kind: "multi",
    placeholder: "Todos", searchPlaceholder: "Filtrar roles…",
    emptyMessage: "Ningún rol coincide",
    options: (Object.keys(ROL_LABELS) as RolValue[])
      .map((v) => ({ value: v, label: ROL_LABELS[v] })),        // R12
  }];
}
```

Dos diferencias **deliberadas** con el archivo de órdenes, y conviene que estén escritas para
que no se lean como despistes:

- **No recibe catálogo**, porque no hay ninguno que pedir: los roles son un **enum** y sus
  etiquetas ya están en `ROL_LABELS`. De ahí se sigue que no haya `useSWR` de catálogo, ni
  prop nueva en `page.tsx`, ni estado degradado "el catálogo no cargó" (el `R64` de órdenes).
- **No declara el buscador como un `FilterDef` más.** Órdenes lo declara y luego
  `OrdenesListado` **lo descarta por su clave** para dárselo a `BuscadorFiltros`; eso es
  cicatriz de que la 169 llegó después de la 144. Aquí el buscador nace donde vive: en las
  props de `BuscadorFiltros`, alimentadas por `PLACEHOLDER_BUSQUEDA` y
  `USUARIO_BUSQUEDA_MIN_CHARS`.

### 4.3 `seleccion-a-filtro-usuarios.ts`

```ts
export type FiltroUsuariosUI = { q?: string; rol?: RolValue[] };

export function seleccionAFiltroUsuarios(sel: FilterSelection, termino: string): FiltroUsuariosUI
```

Reglas duras del borde que esta función no puede violar:

- **una lista vacía se OMITE**, jamás se manda `[]` (§2.3 la rechaza);
- el término se **recorta** y se descarta si queda por debajo del mínimo (defensa en
  profundidad: el control ya lo hace);
- el término se **trunca** a `USUARIO_BUSQUEDA_MAX_CHARS` (R9): pegar 500 caracteres no puede
  acabar en un listado en estado de error.

### 4.4 `UsuariosModule.tsx` — cableado

Calcado de `OrdenesModule`/`FiltrosCierresBarra`:

- estado: `termino` (del `BuscadorFiltros`), `seleccion` (`FilterSelection` de
  `FilterComponent`), `filtrosActivos` (claves puestas desde el selector), `reset` (contador
  para remontar `FilterComponent` al limpiar). El término vive **aparte** de la selección:
  `FilterComponent` emite su selección completa en cada cambio y, si el término estuviera
  dentro, marcar un rol lo borraría.
- `filtro = seleccionAFiltroUsuarios(seleccion, termino)`, con `useMemo`.
- **Key de SWR:** `["usuarios:list", page, pageSize, filtro.q ?? "", [...(filtro.rol ?? [])].sort().join(",")]`.
  El `sort()` es lo que hace que dos selecciones equivalentes compartan caché en vez de
  refetchear en cada render. No se importa `serializarFiltro` de órdenes (§10, alternativa D).
- **Vuelta a página 1 (R18):** patrón "ajustar estado durante el render" con la clave previa,
  igual que `OrdenesModule:276`. Sin efecto y sin parpadeo de un fetch a la página vieja.
- **`fallbackData` (trampa que hay que evitar):** hoy se aplica cuando `page === 1 &&
  pageSize === initialData.pageSize`. Debe exigir **además** que no haya filtros activos; si
  no, el primer render filtrado pintaría el listado **sin filtrar** que trajo el servidor.
- **Estado vacío (R20):** el `emptyState` pasa a depender de si hay filtros activos. Con
  filtros: título "Ningún usuario coincide con los filtros", sin CTA de crear. Sin filtros:
  el de hoy, intacto.
- **La barra va en `DataTable.filtros`**, en la misma línea que el control de descarga, como
  en órdenes. `onLimpiarTodo` vacía término, selección y claves activas (R21).
- **Descarga (R22/R23):** el closure se construye **en el render** (ya lo hace hoy) y pasa
  `filtro`: `listarUsuariosCompleto(hayFiltro ? filtro : {})`. Sin filtros la entrada sigue
  siendo `{}` literal — la petición de hoy, byte a byte.

---

## 5. Modelo de datos, migraciones y RLS

**No hay migración.** Ni tabla, ni columna, ni enum, ni índice, ni cambio de RLS. En
consecuencia no hay `migration.sql` ni `down.sql` que escribir, y `db/schema.prisma` no se
toca.

- **Filtro de rol:** `usuario.rol_id` ya tiene `@@index([rolId])`; la condición se expresa
  contra `rol.value` y Postgres la resuelve con la tabla de catálogo (6 filas).
- **Búsqueda:** `ILIKE '%…%'` sobre `nombre`/`email` es **Seq Scan**, y se acepta a
  conciencia: `usuario` es una tabla de decenas de filas (una fracción de una página de
  disco) y el listado lo consulta **un solo rol** desde una pantalla de configuración. Poner
  aquí el aparato de `/ordenes` (columna generada + `pg_trgm` + migración) sería pagar el
  precio de una tabla de decenas de miles para una de decenas (§10, alternativa C).
- **Cuándo hay que revisar esta decisión:** si `usuario` llegara a órdenes de magnitud
  superiores (miles), o si el buscador se reusara sobre una tabla grande. El disparador se
  escribe aquí para que la próxima sesión no tenga que redescubrirlo.

---

## 6. Punto abierto nº 1 — La descarga queda acotada a los filtros activos

**Decisión: SÍ. La descarga entrega exactamente lo filtrado** (R22), que es lo mismo que la
feature 151 decidió para órdenes.

**Por qué:**

1. **Es lo que ya significa el control.** El botón vive **dentro** de la tabla, en la misma
   línea que la barra de filtros. Un control ahí que ignorara los filtros entregaría un
   archivo que **no es lo que la pantalla muestra**, y eso no se descubre mirando el botón:
   se descubre abriendo el archivo.
2. **Sale del contrato, no de código nuevo.** `listarUsuariosCompletoSchema` **se deriva** del
   schema del listado, y `listarCompleto` llama al **mismo** `repo.list` con los mismos
   parámetros. Acotar la descarga **es no hacer nada**; lo que costaría trabajo es lo
   contrario: habría que `.omit()` explícitamente las claves nuevas para *impedir* que la
   descarga las acepte. Escribir código para desactivar la coherencia es la peor de las dos.
3. **Coherencia entre las dos superficies de descarga del repo.** Órdenes ya se comporta así.

**Qué implica para su guardia y su tope:**

- **La guardia de columnas de la 170 no se toca** y no tiene por qué: vigila **qué columnas**
  emite la descarga, y esta feature no cambia ninguna (R24). Lo que cambia es **el conjunto
  de filas**, que esa guardia no vigila.
- **El tope (`descargaConfig.MAX_FILAS`) pasa a medirse sobre el total FILTRADO** (R25). Es
  una consecuencia directa de §3.3-1 (el `count` con el mismo `where`) y es la que se quiere:
  un `limite_excedido` sobre el total sin filtrar rechazaría la descarga de **8 mensajeros**
  porque la tabla entera es grande. La dirección del cambio solo puede ser a mejor: filtrar
  nunca sube el total.
- **`limite_excedido` sigue sin devolver ni una fila** y sigue llevando solo conteos (sin
  PII). Esa parte del contrato de la 170 no la toca esta feature.
- **Sin filtros, la entrada sigue siendo `{}`** (R23): la descarga de hoy no cambia de forma.

---

## 7. Punto abierto nº 2 — Mínimo de caracteres y espera

| Ajuste | Órdenes | **Usuarios (285)** |
| --- | --- | --- |
| Mínimo | `3` | **`2`** |
| Máximo | `80` | **`120`** |
| Espera | `DEBOUNCE_MS_DEFAULT` (500 ms) | **`DEBOUNCE_MS_DEFAULT` (500 ms), sin sobrescribir** |

**Mínimo = 2, y no 3.** El `3` de órdenes **no es una preferencia de UX, es de rendimiento**:
`pg_trgm` no genera trigramas útiles por debajo de 3 caracteres, así que un término de 1–2
sería un Seq Scan garantizado sobre la tabla más grande del sistema, dos veces (página y
conteo). **Aquí no existe esa razón**: no hay trigramas, el plan es Seq Scan con término o
sin él, y la tabla es diminuta. Copiar el `3` sería importar el número sin su motivo. Se pone
`2` porque **sí** hay una razón que sobrevive al cambio de tabla: con **1** carácter la
consulta devuelve casi todo el listado —un "filtro" que no filtra, y una consulta por cada
letra tecleada—, mientras que 2 caracteres ya acotan de forma útil un listado de este tamaño.

**Máximo = 120.** No protege al motor (cuanto más largo el término, más selectivo). Existe
para acotar el peso de la **clave de caché** del listado y para que el campo no se use como
canal de datos. 120 está muy por encima de lo que alguien teclea para **encontrar** a una
persona —se busca un fragmento, nunca el valor entero— y por encima queda la **truncación en
la superficie** (R9), de modo que un pegado largo nunca acaba en error.

**Espera: la de la casa, sin sobrescribir.** Se evaluó bajarla (250 ms) razonando que la
tabla es pequeña; se descarta porque **lo que cuesta no es la consulta, es el viaje**: una
Server Action de ida y vuelta cuesta lo mismo aquí que en órdenes, así que el tamaño de la
tabla no compra nada. Y un segundo número para la misma interacción es exactamente cómo dos
barras que deben comportarse igual empiezan a separarse.

---

## 8. Riesgos y deuda conocida

1. **Acentos (P1 de `requirements.md`).** `mode: "insensitive"` es ILIKE: pliega mayúsculas,
   **no** acentos. `jose` no encuentra a `José`; `jos` sí. Mitiga que se busca por
   **fragmento** y que el correo —la otra columna buscable— no lleva acentos. Queda escrito
   como limitación, no como olvido.
2. **`escaparComodinesLike` queda declarado dos veces** (la copia privada de
   `OrdenRepository` y el nuevo `lib/utils/escapar-like.ts`). Es una **decisión forzada** por
   el "no toques órdenes" de esta ficha. Deuda de una línea: cuando alguien pueda tocar
   `OrdenRepository`, que importe el util y borre su copia.
3. **El gate rápido se NEGARÁ.** El diff toca `lib/types/usuario.ts`, y `lib/types/**` está
   en la lista de `docs/verification.md` que obliga a `./init.sh` **completo**. No es un
   aviso: es un `fail`. Está previsto en `tasks.md` (T5.1) para que nadie lo descubra al
   final.
4. **Comentario mentiroso en `UsuarioService.ts:143`** (§3.2). Si no se reescribe, queda en
   el repo una afirmación falsa con aire de hallazgo verificado.
5. **Base local compartida entre worktrees.** Esta feature no migra nada, así que no rompe el
   gate de features vecinas; pero si se corre el test de integración a la vez que otro que
   escribe en `public."usuario"`, hay que respetar `serializarEscriturasReales` (§9).
6. **El test de integración escribe en las tablas REALES** dentro de una transacción
   revertida. Si el proceso muere a mitad, Postgres revierte igual: no quedan filas. Aun así,
   emails y cédulas de la semilla llevan sufijo único (son `@unique`).

---

## 9. Verificación — qué prueba qué, y qué mutación lo mata

> Regla de la casa, medida cuatro veces: **un test de servicio con dobles no ve el SQL**. Los
> requisitos de comportamiento del `WHERE` (R2, R4, R5, R13, R16, R17) **solo** cuentan como
> cubiertos por el test de integración.

### 9.1 Integración contra Postgres real — `tests/integration/db/usuarios-filtro-busqueda.test.ts`

Herramientas ya existentes (`tests/integration/db/_postgres-real.ts`): `HAY_BASE_DE_DATOS`
(→ `describe.skip` declarado, nunca un `return` mudo), `crearPrismaDeTest`,
`enTransaccionRevertida` y **`serializarEscriturasReales` como PRIMERA sentencia de la
transacción** (obligatorio: se escribe en `public."usuario"`).

**Semilla** (dentro de la transacción, con sufijo único en email/cédula, tomando `rolId` de
la tabla `rol` y `tipoIdentificacionId` del catálogo; **si esos catálogos faltan, el test
falla con un `expect`, no se salta en silencio**):

| clave | nombre | email | rol |
| --- | --- | --- | --- |
| `ana` | `Ana Rojas` | `ana.<sufijo>@ejemplo.cr` | `mensajero` |
| `beto` | `Beto Mora` | `beto.<sufijo>@ejemplo.cr` | `admin` |
| `carla` | `Carla Sanz` | `MAYUS.<sufijo>@EJEMPLO.CR` | `mensajero` |
| `dimas` | `Dimas Vega` | `dimas.<sufijo>@otra.cr` | `adminTienda` |

Todas las aserciones se acotan al corpus por `createdAt >= marca`, y **el primer caso
comprueba ese acotamiento** (sin él, los conteos no afirmarían nada).

| id | Caso | Requisito | **Mutación que debe matarlo** |
| --- | --- | --- | --- |
| T-I0 | sin filtros salen **exactamente** las 4 filas sembradas | R1 | acotar mal el corpus |
| T-I1 | `"rojas"` devuelve solo `ana`; `"ejemplo"` devuelve las que casan **por correo** | R2 | quitar la rama `email` del `OR`; cambiar `contains` por `startsWith` |
| T-I2 | `"mayus"` (minúsculas) encuentra a `carla` (correo en mayúsculas) | R4 | quitar `mode: "insensitive"` |
| T-I3 | con `roles: ["mensajero"]`, `total === 2` **y** `dimas` no aparece | R13, R17 | `count()` **sin** `where` (el `total` diría 4); ignorar `roles` |
| T-I4 | `"a%"` devuelve **0 filas** (no a `Ana`) | R5 | quitar el escapado de comodines |
| T-I5 | `busqueda: "a"` + `roles: ["admin"]` devuelve solo `beto`, no `ana` | R16 | cambiar el `AND` implícito por un `OR` |
| T-I6 | con `take: 1` la primera página del filtrado sale en el mismo orden que sin filtrar | R19 | perder el `orderBy` al añadir el `where` |

### 9.2 Unidad — schemas (`tests/unit/types/usuario-schema.test.ts`, se amplía)

| id | Caso | Requisito | Mutación |
| --- | --- | --- | --- |
| T-U1 | `q` de 1 carácter → falla; de 2 → pasa; de `MAX+1` → falla | R8 | subir/bajar el `min`; quitar el `max` |
| T-U2 | `q: "  a  "` → falla (1 carácter tras recortar); `q: "  ab  "` → pasa con `"ab"` | R6 | mover `.trim()` después de `.min()` |
| T-U3 | `rol: []` → falla; `rol: ["noExiste"]` → falla; `rol: ["mensajero","admin"]` → pasa | R15 | quitar `.nonempty()`; cambiar `z.enum` por `z.string()` |
| T-U4 | la lista blanca de roles **contiene todas** las claves de `ROL_LABELS` | R12 | quitar un rol de la lista blanca |
| T-U5 | `listarUsuariosCompletoSchema` **acepta** `q` y `rol` y **sigue rechazando** `page`/`pageSize` | R22, R23 | dejar de derivarlo del schema base |

### 9.3 Unidad — servicio (`tests/unit/services/usuario-service.test.ts` y `usuario-descarga.test.ts`)

| id | Caso | Requisito | Mutación |
| --- | --- | --- | --- |
| T-S1 | con un actor no `maestro`, listar **con filtros** devuelve `forbidden` y el doble del repo **no recibe ninguna llamada** | R26 | mover el guard después de la consulta |
| T-S2 | `listar` y `listarCompleto` pasan al repo **los mismos** `busqueda`/`roles` para la misma entrada | R22 | que cada uno construya su filtro por su cuenta |
| T-S3 | con `total` filtrado ≤ tope se devuelve `ok` aunque el conjunto sin filtrar lo excediera | R25 | comparar el tope contra un total sin filtrar |
| T-S4 | la fila devuelta tiene **exactamente** las claves de `UsuarioListItem` | R27 | ampliar `LIST_SELECT` |

### 9.4 Unidad — superficie pura (`tests/unit/components/usuarios-filtros-def.test.ts`, nuevo)

| id | Caso | Requisito | Mutación |
| --- | --- | --- | --- |
| T-P1 | `construirFiltrosUsuarios()` declara el filtro `rol` como `kind: "multi"` con **una opción por rol** y su etiqueta legible | R12 | pasar a `single`; perder una opción |
| T-P2 | selección vacía → la clave `rol` **se omite** (no viaja `[]`) | R14 | emitir `[]` |
| T-P3 | término por debajo del mínimo → `q` se omite; término de `MAX+50` → se trunca a `MAX` | R7, R9 | quitar la truncación |
| T-P4 | el `placeholder` menciona nombre y correo | R11 | cambiarlo por "Buscar…" |

### 9.5 Componente (`tests/unit/components/usuarios-module.test.tsx`, se amplía)

| id | Caso | Requisito | Mutación |
| --- | --- | --- | --- |
| T-C1 | la barra compartida está montada (campo "Buscar" + botón "Filtros") | R28 | sustituirla por un `<input>` propio |
| T-C2 | teclear un término dispara **una** llamada a `listarUsuarios` con `q` | R10 | quitar el debounce |
| T-C3 | estando en la página 3, cambiar el filtro llama con `page: 1` | R18 | no resetear |
| T-C4 | con filtros activos, el primer render **no** pinta `initialData` | R2 | dejar el `fallbackData` como está hoy |
| T-C5 | filtro activo + 0 filas → texto de "ninguno coincide" y **sin** botón "Crear usuario" en el vacío; sin filtros → el vacío de hoy | R20 | dejar el `emptyState` fijo |
| T-C6 | "Limpiar todo" deja el listado sin filtros y vuelve a pedir todo | R21 | no limpiar las claves activas |
| T-C7 | con filtros activos, la descarga llama a `listarUsuariosCompleto` **con** `q`/`rol`; sin filtros, con `{}` | R22, R23 | dejar el `{}` fijo |
| T-C8 | el `minChars` del campo **es** `USUARIO_BUSQUEDA_MIN_CHARS` (leído de la constante, no un literal) | R29 | escribir `2` a mano en el componente |

> Ojo con T-C8: la aserción compara el prop contra la **constante importada**, no contra un
> `2` escrito en el test; y contra el prop, no contra la función que lo genera.

---

## 10. Alternativas descartadas

**A) Filtrar y buscar en el cliente, sobre lo ya cargado.** Es lo que hace el buscador del
mensajero (feature 114) y es tentador porque no toca el backend. **Descartada:** esta tabla
está **paginada server-side** (`pageSize` 25 por defecto), así que filtraría solo la página
visible y R3 sería imposible: buscar a alguien que está en la página 3 no lo encontraría. El
usuario leería "no existe" cuando existe.

**B) Filtrar por `rol_id` (UUID) con catálogo precargado — el calco literal de órdenes.**
Órdenes transporta **ids** porque sus catálogos son filas de la base (tiendas, zonas,
provincias) y no hay enum que valga. **Descartada aquí** porque el rol **sí** es un enum
(`RolValue`) y `ROL_LABELS` ya es exhaustivo sobre él: con ids habría que (1) precargar el
catálogo en `page.tsx` y pasarlo por props, o pagar un `useSWR` extra; (2) manejar el estado
degradado "el catálogo no cargó" que órdenes tuvo que inventar; (3) mover UUIDs distintos por
entorno; y (4) el borde solo podría validar "es un string no vacío", no "es un rol". Con
valores del enum, la lista blanca del borde es exacta y **no se toca `page.tsx`**.

**C) Columna generada `usuario.busqueda_texto` + `pg_trgm` + migración (calco de la 169).**
Resolvería los acentos y daría índice. **Descartada:** exigiría migración con `down.sql`,
duplicar el mapa de plegado de 48 caracteres en SQL y en TypeScript, y con él **el fallo más
difícil de diagnosticar del repo** —que las dos normalizaciones se separen y la búsqueda "no
encuentre" sin que nada pete—, todo para una tabla de decenas de filas que se lee desde una
pantalla de configuración. Es rediseñar en vez de arreglar lo pedido. La deuda que deja
(acentos) está escrita en §8 y preguntada en P1.

**D) Importar `seleccionAFilter` y `serializarFiltro` de `/ordenes`.** Son casi lo que hace
falta. **Descartada:** están tipados sobre `OrdenFilterField`/`OrdenesFilterUI`, conocen
claves que aquí no existen (`created_preset`, `reasignables`) y acoplarían la configuración
de usuarios al contrato de órdenes — justo lo que el humano pidió no hacer. Lo que **sí** se
reutiliza es lo que es genérico de verdad: `BuscadorFiltros` y `FilterComponent`.

**E) Anidar los filtros en un `filter: { … }` como órdenes.** **Descartada:** el contrato de
usuarios es **plano** (`page`, `pageSize`, `sortBy`, `sortDir`) y anidar obligaría a cambiar
las llamadas existentes (`page.tsx`, `UsuariosModule`, tests) a cambio de nada. Además
rompería la derivación limpia del schema del modo completo.

**F) Un endpoint nuevo (`app/api/usuarios/buscar`) consumido con SWR.** **Descartada:**
`docs/architecture.md` es explícito — las rutas API son para webhooks, terceros y crons. Este
listado es interno, sensible y ya se sirve por Server Action.
