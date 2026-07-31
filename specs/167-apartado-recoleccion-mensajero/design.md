# Feature 167 (Apartado propio de recolección para el mensajero) · design.md

> Referencias obligatorias: `docs/architecture.md` (Controller → Service → Repository, Server Actions
> para mutaciones internas, datos sensibles por props desde el Server Component, migraciones up/down,
> sin sobre-ingeniería en componentes) y `docs/conventions.md`.
> Todo el "estado del arte" de este documento se verificó leyendo el worktree `lote-135` sobre `dev`.

---

## 1. Resumen de la decisión de diseño

Cuatro piezas. **Ninguna toca la lógica de confirmación de la 157**, que se conserva intacta (R16).

| Pieza | Superficie | Naturaleza |
| --- | --- | --- |
| A. Página y menú propios | `/recoleccion` + `SIDEBAR_ITEMS` | Ruta nueva, `notFound()` server-side, `IconKey` nueva |
| B. Lectura propia del apartado | `RecoleccionTiendaService.listarRecoleccion` | Método de lectura nuevo en el service que YA es dueño de este dominio |
| C. «Recolectadas hoy» | `orden_historial_estado` | Lectura derivada del HISTORIAL + índice nuevo (única migración) |
| D. Corte limpio en Entregas | `MisAsignacionesService` / `MisAsignacionesModule` | **Retirada** del tercer bucket y del panel |

El eje del diseño es la inversión de una regla: hoy el escáner **depende** de que haya lista
(`RecoleccionTiendaPanel.tsx:121`); a partir de aquí el escáner es el contenido principal del apartado
y la lista es su contexto. Lo único que lo apaga es el bloqueo por cierre (111/157-R24).

---

## 2. Estado del arte verificado

### 2.1 Lo que se reusa TAL CUAL (sin diff)

| Artefacto | Ruta | Papel en 167 |
| --- | --- | --- |
| `recolectarEnTiendaPorQr` | `lib/actions/recoleccion-tienda.ts:60` | Confirmación; el apartado nuevo la llama igual |
| `RecoleccionTiendaService.recolectarEnTienda` | `lib/services/RecoleccionTiendaService.ts:47` | Transición + guardias + idempotencia + carrera |
| `OrdenRepository.recolectarEnTienda` | `lib/repositories/OrdenRepository.ts` | UPDATE guardado + `appendCambioEstado` en la misma tx |
| `EscanerGuiaCard` | `components/shared/EscanerGuiaCard.tsx` | Cámara (`QrScanner`) + entrada manual, ya con `procesando` y slot de éxito |
| `ContactoButtons` | `components/shared/ContactoButtons.tsx` | Contacto de la tienda (R19/R20) |
| `extractNumGuiaFromScan` | `lib/utils/paquete-url.ts` | El QR codifica `/paquete/<numGuia>` |
| `estadoBloqueoMensajero` | `lib/actions/cierre-dia.ts` | Deriva `bloqueado` server-side (mismo patrón que `/mis-asignaciones`) |
| `resolveActorFromSession` + `AppPage` | `lib/auth/`, `components/shared/` | Patrón de página autenticada del repo |
| `GestionOrdenRepository.findMisAsignaciones` | `lib/repositories/GestionOrdenRepository.ts:108` | La consulta "órdenes de este mensajero en estos estados", ya acotada por `mensajero_asignado_id` y `deleted_at IS NULL` |
| `inicioDelDiaCREnUtc` / `inicioDelDiaSiguienteCREnUtc` / `fechaCalendarioCR` | `lib/utils/fecha-cr.ts:82,93,35` | Ventana "hoy" (§6) |

### 2.2 Lo que se MUEVE (git mv + adaptación)

| Hoy | Mañana |
| --- | --- |
| `app/(app)/mis-asignaciones/_components/RecoleccionTiendaPanel.tsx` | `app/(app)/recoleccion/_components/RecoleccionModule.tsx` |
| `app/(app)/mis-asignaciones/_components/useRecolectarPorGuia.ts` | `app/(app)/recoleccion/_components/useRecolectarPorGuia.ts` |

Van al directorio de su página por la regla de `docs/architecture.md` ("si un componente se usa en UN
SOLO lugar, vive junto a la página que lo usa"). No se promueven a `components/shared/`.

### 2.3 Lo que se RETIRA

- `MisAsignacionesModule.tsx:28` (import) y `:423-433` (el bloque montado) — R33.
- `MisAsignacionesModuleProps.porRecolectar` (`:62-69`).
- `porRecolectar` de `ListarMisAsignacionesServiceResult`
  (`lib/interfaces/services/IMisAsignacionesService.ts:144-149`) y de `ListarMisAsignacionesResult`
  (`lib/types/gestion-orden.ts:209-210`).
- `ORIGEN_RECOLECCION` y el tercer bucket de `MisAsignacionesService`
  (`lib/services/MisAsignacionesService.ts:42,139-143,163-189,216-224`): la llamada queda
  `findMisAsignaciones(actor.usuarioId, [ORIGEN_RECOGER, ESTADO_EN_REPARTO])` — R34.
- `porRecolectar` de `app/(app)/mis-asignaciones/page.tsx:46`.

### 2.4 Lo que NO se toca

`GestionarOrdenPanel`, el modo foco (113), el buscador (114), el filtro cantón/distrito (117), los
KPIs (61), la ruta/mapa (92/97), `CierreDiaService`, `CorteDiarioService`, `RankingService`,
`GuiaAsignacionService.asignarRecoleccion` y `OrdenRepository.asignarRecoleccionLote`.

---

## 3. Ruta, navegación y permisos

### 3.1 Ruta

```
app/(app)/recoleccion/page.tsx                 ← Server Component
app/(app)/recoleccion/_components/RecoleccionModule.tsx      ← "use client"
app/(app)/recoleccion/_components/RecolectadasHoyLista.tsx   ← "use client" (presentación)
app/(app)/recoleccion/_components/useRecolectarPorGuia.ts    ← movido desde mis-asignaciones
```

`page.tsx`, calcado de `app/(app)/mis-asignaciones/page.tsx`:

```ts
const actor = await resolveActorFromSession();
if (actor?.rol !== "mensajero") notFound();          // R3: defensa REAL, server-side
const result = await listarRecoleccion();
if (result.status !== "ok") notFound();
const bloqueo = await estadoBloqueoMensajero();      // R9 (111/R12)
const bloqueado = bloqueo.status === "ok" && bloqueo.bloqueado;
```

**Middleware:** no se toca. `middleware.ts` es deny-by-default (todo lo que no está en
`PUBLIC_ROUTES`/`SELF_AUTH_ROUTES` exige cookie de sesión validada contra la DB), así que
`/recoleccion` queda protegida sin añadir nada.

### 3.2 Ítem de menú

En `lib/auth/menu-visibility.ts`, inmediatamente **después** de "Entregas" (son hermanos del mismo
portal):

```ts
{
  label: "Recolección",
  href: "/recoleccion",
  iconKey: "store",
  roles: ["mensajero"],
},
```

`IconKey` gana `"store"` (R5). La unión es CERRADA y `ICON_BY_KEY` en `Sidebar.tsx:139` está tipado
`Record<IconKey, SidebarIcon>`: añadir la clave sin darle icono rompe el typecheck, que es la
garantía que la 129 (R12) y la 158 dejaron montada. El icono es `Store` de lucide — el MISMO que ya
identifica la recolección en `RecoleccionTiendaPanel.tsx:138`, así que el lenguaje visual no cambia
para el mensajero. **No se comparte** clave con ningún otro ítem (precedente comentado de
`shieldAlert` y `chartColumn`).

Efecto colateral obligatorio: `tests/unit/auth/menu-visibility.test.ts:180` afirma la lista EXACTA del
mensajero (`["Entregas","Ranking","Cierre del día","Perfil"]`) y `tests/components/Sidebar.test.tsx`
tiene un array `TODAS_LAS_CLAVES` con `satisfies readonly IconKey[]`. Los dos se actualizan en el
mismo commit (§9).

---

## 4. Modelo de datos

### 4.1 Tablas nuevas: NINGUNA

No hay entidad nueva. «Recolectadas hoy» es una LECTURA de filas que ya se escriben: cada
confirmación efectiva de la 157 deja una fila en `orden_historial_estado` con
`origen_tipo = 'recoleccion_tienda'` y `actor_usuario_id = <mensajero>`
(`RecoleccionTiendaService.ts:96`, verificado).

### 4.2 Migración única: un ÍNDICE

`db/schema.prisma`, modelo `OrdenHistorialEstado` (línea 1281), gana:

```prisma
@@index([actorUsuarioId, origenTipo, createdAt], map: "orden_historial_actor_origen_created_idx")
```

- **Por qué hace falta.** Los dos índices existentes son `(orden_id, created_at)` y
  `(orden_id, estatus_destino_id)`: los dos empiezan por `orden_id`, y esta consulta no filtra por
  orden. Sin índice, «Recolectadas hoy» sería un *seq scan* sobre una tabla append-only que crece con
  cada transición de cada orden del sistema, en una pantalla que el mensajero abre decenas de veces al
  día desde el móvil. R32 existe por eso.
- **Por qué ese orden de columnas.** Igualdad (`actor_usuario_id`) → igualdad (`origen_tipo`) → rango
  (`created_at`). Es el orden que un btree puede recorrer sin filtro residual.
- **Por qué `map:` explícito.** El nombre por defecto de Prisma
  (`orden_historial_estado_actor_usuario_id_origen_tipo_created_at_idx`, 66 caracteres) **excede el
  límite de 63 de Postgres** y quedaría truncado de forma no evidente. Se nombra a mano.
- **Sin `CONCURRENTLY`:** Prisma ejecuta cada migración dentro de una transacción y
  `CREATE INDEX CONCURRENTLY` no puede correr ahí. La tabla no tiene hoy un volumen que lo justifique;
  si alguna vez lo tuviera, se aplica fuera de Prisma y se registra.

```
db/migrations/<ts>_orden_historial_idx_actor_origen_created/
  migration.sql   CREATE INDEX "orden_historial_actor_origen_created_idx"
                    ON "orden_historial_estado" ("actor_usuario_id", "origen_tipo", "created_at");
  down.sql        DROP INDEX IF EXISTS "orden_historial_actor_origen_created_idx";
```

**No hay valor de enum nuevo**, así que NO hay que tocar los `down.sql` previos (la trampa que dejó
escrita la 154). El `down.sql` de esta migración es un `DROP INDEX` idempotente y `pnpm run db:rollback`
la revierte sin pérdida de datos.

### 4.3 RLS

No hay tabla nueva → no hay política nueva. `orden_historial_estado` ya está bajo el régimen de RLS
del repo (RLS habilitada sin policies; el acceso es de aplicación vía Prisma con service role). El
aislamiento REAL de esta feature es el `WHERE`: la lectura de pendientes va acotada por
`mensajero_asignado_id = :actor` (repo existente) y la de recolectadas por
`actor_usuario_id = :actor` (repo nuevo). Ninguna de las dos acepta un id de usuario por parámetro
externo: sale del actor de sesión.

---

## 5. Contratos de entrada/salida

### 5.1 Tipos (`lib/types/recoleccion-tienda.ts`, se amplía)

```ts
/** Una orden que el mensajero tiene que ir a recoger a la tienda. DELIBERADAMENTE POBRE (R38). */
export interface RecoleccionOrdenDTO {
  id: string;
  numGuia: number | null;
  numRemision: string;
  producto: string;
  destinatario: string;
  tiendaNombre: string;
  tiendaTelefono: string | null;
}

/** Una recolección YA hecha hoy por el actor. Deriva del historial, no del estado (R25). */
export interface RecolectadaHoyDTO {
  ordenId: string;
  numGuia: number | null;
  numRemision: string;
  tiendaNombre: string;
  recolectadaAt: Date;
}

export type ListarRecoleccionResult =
  | {
      status: "ok";
      porRecolectar: RecoleccionOrdenDTO[];
      recolectadasHoy: RecolectadaHoyDTO[];
      /** R31: hay más recolecciones hoy de las que se devuelven. */
      recolectadasHoyRecortada: boolean;
    }
  | { status: "forbidden" }
  | { status: "unauthenticated" };
```

`RecoleccionOrdenDTO` es un DTO **nuevo y flaco**, no `MiAsignacionDTO`. Motivo: `MiAsignacionDTO`
arrastra `montoCobrar`, `latitud`, `longitud`, `secuenciaRuta`, `marcarLuego`, `notaPrivada` e
`intentosEntrega`; una superficie que por requisito NO muestra cobro (R18) tampoco debe **transportar**
cobro hasta el navegador. R38 se vuelve así verificable con un test de contrato y no con una revisión
visual.

### 5.2 Service (`lib/services/RecoleccionTiendaService.ts`, se amplía)

```ts
listarRecoleccion(actor: Actor): Promise<ListarRecoleccionServiceResult>;
```

- `actor.rol !== "mensajero"` → `{ status: "forbidden" }` (misma guardia que `recolectarEnTienda`).
- Pendientes: `repoGestion.findMisAsignaciones(actor.usuarioId, ["recolectando"])` → map a
  `RecoleccionOrdenDTO` (R21, R38).
- Recolectadas hoy: `repoHistorial.findRecoleccionesDeActor(actor.usuarioId, desde, hasta, TOPE + 1)`;
  si vuelven `TOPE + 1` filas, se recortan a `TOPE` y `recolectadasHoyRecortada = true` (R31).
- Constructor: se añaden `Pick<IGestionOrdenRepository, "findMisAsignaciones">`,
  `Pick<IOrdenHistorialRepository, "findRecoleccionesDeActor">` y un **reloj inyectable**
  `now: () => Date = () => new Date()` (patrón `GestionOrdenRepository`), para que los tests de la
  ventana de "hoy" no falseen el reloj global.
- `TOPE_RECOLECTADAS_HOY = 100`, constante del módulo del service (pregunta abierta 2).

El bloqueo por cierre **no** se calcula aquí: la página lo obtiene de `estadoBloqueoMensajero()`,
exactamente como `/mis-asignaciones`. Una sola derivación del bloqueo en todo el portal.

### 5.3 Repositorio (`IOrdenHistorialRepository` / `OrdenHistorialRepository`)

```ts
findRecoleccionesDeActor(
  actorUsuarioId: string,
  desde: Date,     // inclusivo
  hasta: Date,     // EXCLUSIVO
  limite: number,
): Promise<RecoleccionHistorialRow[]>;   // { ordenId, numGuia, numRemision, tiendaNombre, recolectadaAt }
```

Query Prisma pura, sin lógica de negocio (la ventana la calcula el service, R27):

```
where: {
  actorUsuarioId,
  origenTipo: "recoleccion_tienda",
  createdAt: { gte: desde, lt: hasta },
  orden: { deletedAt: null },            // R29
}
orderBy: { createdAt: "desc" }           // R28
take: limite
include: orden -> { numGuia, numRemision, tienda: { nombre } }
```

Nota deliberada: **no** filtra por `estatus_destino_id`. La familia `recoleccion_tienda` tiene una
sola arista (#43) y el estado ACTUAL de la orden es irrelevante — eso es justo lo que R26 exige.

### 5.4 Server Action (`lib/actions/recoleccion-tienda.ts`, se amplía)

```ts
export async function listarRecoleccion(deps: RecoleccionTiendaDeps = {}): Promise<ListarRecoleccionResult>
```

Mismo molde que `recolectarEnTiendaPorQr` y que `listarMisAsignaciones`: `withErrorHandler` +
`resolveActorFromSession` + `UnauthenticatedError` → `{ status: "unauthenticated" }`. Sin zod: no
recibe entrada externa. `deps` inyectable (service / getActor) para los tests del borde.

Va en el MISMO archivo de acciones que la confirmación porque es el mismo dominio y el mismo service;
un `lib/actions/recoleccion.ts` aparte solo repartiría el dominio en dos ficheros.

### 5.5 Flujo completo

```
/recoleccion (Server Component)
  ├─ resolveActorFromSession()  → notFound si no es mensajero        (R3)
  ├─ listarRecoleccion()        → Action → Service → 2 repos          (R6)
  └─ estadoBloqueoMensajero()   → bloqueado: boolean                  (R9)
        ↓ props (datos sensibles pre-fetch, sin fetch de cliente)
   RecoleccionModule ("use client")
      ├─ EscanerGuiaCard   ← SIEMPRE montado, salvo `bloqueado`       (R7/R9)
      ├─ grupos por tienda + ContactoButtons                          (R17/R19/R20)
      └─ RecolectadasHoyLista                                         (R24)
            ↑ onRecolectada → router.refresh()                        (R14)
```

---

## 6. La ventana de "hoy" — decisión y por qué

**Se adopta la convención de la feature 144**, la misma que usa la analítica (135):

```ts
const hoyCR = fechaCalendarioCR(this.now());               // "YYYY-MM-DD" en hora de pared CR
const desde = inicioDelDiaCREnUtc(hoyCR);                  // `${hoyCR}T06:00:00.000Z`
const hasta = inicioDelDiaSiguienteCREnUtc(hoyCR);         // +24 h, EXCLUSIVO
```

Es el **día natural de Costa Rica 00:00–24:00** (R27). Costa Rica es UTC-6 fijo, sin horario de
verano, así que todo borde cae en `...T06:00:00.000Z` y no hay aritmética de zona propia en este
código: sale entera de `lib/utils/fecha-cr.ts` (R14 de la 135: reutilizar, no reimplementar).

**No se replica la ventana de `RankingService`.** `lib/services/RankingService.ts:60-61` usa la OTRA
convención del repo (medianoche UTC de la fecha CR + 24 h), que produce una ventana
**18:00–18:00 hora CR**. Es una divergencia CONOCIDA y ACEPTADA (decisión D6 de la 135, escrita en la
cabecera de `lib/analytics/ranges.ts:40-51`) con un ticket de saneamiento propio (feature 166) que
esta feature **no** abre ni resuelve. Copiar aquí la ventana del ranking "para que cuadren" propagaría
el defecto a una superficie más; usar la convención de 144 alinea esta lista con la analítica, que es
el sitio donde el humano lee las cifras del día.

**Consecuencia visible y aceptada:** una recolección hecha a las 19:00 hora CR aparece en
«Recolectadas hoy» del día correcto (el que el mensajero llama "hoy"), aunque el ranking del mismo
instante la contabilice en su día siguiente. El ranking, además, **no cuenta recolecciones en
absoluto** (157/R38), así que no hay ningún número que el mensajero pueda ver en dos sitios con dos
valores distintos.

---

## 7. Frontend

### 7.1 `RecoleccionModule.tsx`

Sale de `RecoleccionTiendaPanel.tsx` con cuatro cambios y ni uno más:

1. **Se borra `if (porRecolectar.length === 0) return null` (`:121`)** — es la causa raíz de la
   feature (R7).
2. **Estado vacío explícito** cuando no hay pendientes (R8): un mensaje que dice qué pasa y que se
   puede escanear igual, en vez de una pantalla muda.
3. **Aviso de bloqueo propio** (R9): el texto accionable de la 111 vivía en `MisAsignacionesModule`
   (`BLOQUEO_AVISO`, `:85`) y el panel solo recibía el booleano. Al salir de Entregas, el apartado
   debe decir por sí mismo por qué no hay escáner. El texto se comparte extrayéndolo a
   `lib/constants/` o se duplica textualmente: **decisión — se extrae** a un módulo de constantes para
   que los dos portales no puedan divergir en el mensaje que el humano ya declaró como preciso
   (commit `8428498a`, "cada rechazo dice su causa real y qué hacer").
4. **`RecolectadasHoyLista`** debajo de los grupos.

Se conservan sin cambios: agrupación por tienda (`agruparPorTienda`), `textoConteo`, el contacto de
la tienda, la confirmación persistente de la última guía (`ultima`, R15) y la ausencia total de
controles de gestión (R22).

### 7.2 `useRecolectarPorGuia.ts` — el cambio de fondo

Hoy el hook **rechaza en cliente** cualquier guía que no esté en `porRecolectar` (`:42-48`) sin llamar
a la action. Con el escáner siempre montado eso se vuelve una trampa: con lista vacía **ningún**
escaneo podría tener éxito jamás, y el mensajero vería un escáner que no sirve para nada — es decir,
volveríamos al problema que la feature vino a resolver, disfrazado.

**Decisión: se retira la comprobación local; el servidor es la autoridad** (R12). Las guardias reales
ya existen y están probadas: rol, propiedad, estado, bloqueo, carrera
(`RecoleccionTiendaService.ts:52-107`), y la opacidad de R30 de la 157 hace que una guía ajena
responda `no_encontrada` sin filtrar nada. El mensaje al mensajero no empeora: el toast de
`no_encontrada` dice lo mismo que decía el corte local.

Lo que **sí** se conserva en el cliente es el corte de código mal formado (R11): `extractNumGuiaFromScan`
para la cámara y `/^\d+$/` para el teclado. Eso no consulta datos, solo evita mandar basura.

Coste aceptado: un viaje de servidor por escaneo equivocado. Beneficio: el escáner funciona también
cuando la página se abrió antes de que el maestro asignara la recolección (hoy fallaría contra una
lista obsoleta, y el mensajero no tendría forma de saber por qué).

### 7.3 `RecolectadasHoyLista.tsx`

Lista simple, más reciente primero (R28): guía, remisión, tienda y hora local. Vacía → mensaje
explícito (R30). Recortada → nota "Se muestran las 100 más recientes" (R31). Sigue visible con el
mensajero bloqueado (R23/R27): es historial, no una acción.

---

## 8. Corte limpio en Entregas

Además de las retiradas de §2.3, se añade un **guard de no-reintroducción**
`tests/unit/guards/entregas-sin-recoleccion.test.ts`, con el patrón de censo que ya usan
`recoleccion-no-contamina.test.ts` y `no-embalaje.test.ts`: lee el fuente de
`MisAsignacionesModule.tsx`, `mis-asignaciones/page.tsx` y `MisAsignacionesService.ts` (ignorando
comentarios) y falla si reaparecen `RecoleccionTiendaPanel`, `porRecolectar` o `recolectando`.

El porqué: R33/R34 son **ausencias**, y las ausencias se rompen sin que nadie se entere. Cualquier
merge futuro que reintroduzca el panel "porque estaba antes" falla aquí en vez de en la pantalla del
mensajero.

---

## 9. Tests existentes que este cambio invalida o desplaza

| Archivo | Qué pasa |
| --- | --- |
| `tests/components/RecoleccionTiendaPanel.test.tsx` | **Se renombra** a `tests/components/RecoleccionModule.test.tsx`. Sobreviven R14/R15×2/R16/R17/R20/R23/R24 (agrupación, contacto, sin gestión, vía manual, código inválido, idempotencia, bloqueo). **Se invalidan DOS casos:** "sin nada que recolectar el apartado no se muestra" (`:136`) contradice R7 → se sustituye por "con la lista vacía el escáner sigue montado y se explica el vacío"; "R21: una guía que NO es suya se rechaza en cliente, sin llamar a la action" (`:163`) contradice R12 → se sustituye por "una guía que no está en la lista SÍ llega al servidor y el toast sale de su `no_encontrada`". Se añaden los casos de «Recolectadas hoy» (R28/R30/R31) y del aviso de bloqueo (R9). |
| `tests/components/MisAsignacionesModule.test.tsx` | Se retira el `describe` "apartado por recolectar en tienda (feature 157)" (`:2448-2514`, 4 casos): R11 (tres apartados coexisten) deja de ser cierto por diseño; R39/R40 a ese nivel quedan sin sujeto; R25 (foco) se vuelve trivial. **Se sustituye por UN caso nuevo**: "Entregas no monta ninguna superficie de recolección" (sin región, sin aviso, sin conteo, sin enlace) — R33. Y `renderModule` pierde la prop `porRecolectar` (`:185`). El resto del archivo (≈2.400 líneas de gestión, foco, buscador, filtro) queda **intacto** — R35. |
| `tests/unit/services/mis-asignaciones-service.test.ts` | Se retira el `describe` "tercer grupo por recolectar (feature 157)" (`:975+`, 7 casos). Su cobertura de R11/R12/R15 **migra** a `recoleccion-tienda-service.test.ts` (bloque `listarRecoleccion`). La aserción de `:223` pasa a exigir la lista EXACTA `["por_recoger", "en_reparto"]`, que es la forma fuerte de R34 y sustituye a los dos casos de KPIs de la 157/R39: si el estado no se lee, no puede contaminar nada. |
| `tests/unit/guards/recoleccion-no-contamina.test.ts` | **No se toca y debe seguir verde tal cual.** Guarda `CierreDiaService`, `CorteDiarioService` y `asignarRecoleccionLote`, ninguno de los cuales entra en esta feature. Es la prueba de R37/R39. |
| `tests/components/MisAsignacionesPage.test.tsx`, `tests/unit/actions/mis-asignaciones-action.test.ts`, `…-causa-devolucion.test.ts`, `…-evidencias.test.ts` | Ajuste **mecánico**: los fixtures dejan de declarar `porRecolectar`. Ningún assert cambia. |
| `tests/unit/auth/menu-visibility.test.ts` | La lista exacta del mensajero (`:180`) gana "Recolección"; se añade el caso de clave de icono única (molde del R11 de la 129, `:294`). |
| `tests/components/Sidebar.test.tsx` | `TODAS_LAS_CLAVES` (`satisfies readonly IconKey[]`) gana `"store"`; se añade el caso de icono propio (compara la clase `lucide-store`, molde del caso de `chartColumn`). |

---

## 10. Alternativas descartadas

**A1. Dejar la recolección en Entregas y limitarse a quitar el `return null`.**
Es el cambio de una línea. Se descarta porque no resuelve el problema reportado: el mensajero sigue
sin encontrar la recolección (queda enterrada entre el filtro de zona, "Por recoger", el mapa y las
cards de reparto), el MODO FOCO la sigue ocultando por completo, y el escáner de recolección
convivería en la misma pantalla con el de recogida (`RecogerPaqueteCard`) — dos cajas de escaneo
idénticas con significados distintos es una fábrica de errores en la calle. Además, el humano decidió
lo contrario de forma explícita (decisión 2).

**A2. Derivar «Recolectadas hoy» del estado actual de la orden** (`en_ruta_bodega_central` con
`mensajero_asignado_id = actor`). Sería una query más simple y sin índice nuevo. **Se descarta porque
es incorrecta**: en cuanto la bodega central recibe el paquete (feature 138) la orden pasa a
`en_bodega_central` y desaparecería de la lista — el mensajero vería evaporarse su trabajo del día
justo cuando llega a la central, que es cuando lo quiere ver. Contradice R26 de frente. El historial
es append-only e inmutable (49/R2) y es la única fuente que no miente sobre lo ya hecho.

**A3. Reutilizar `listarMisAsignaciones` y que la página nueva consuma su `porRecolectar`.**
Cero código de backend nuevo. Se descarta porque obliga a Entregas a seguir cargando el estado
`recolectando` para servir a otra página — es decir, **impide el corte limpio** (decisión 2 del humano)
y deja el aislamiento 157/R39-R40 dependiendo otra vez de que nadie sume ese bucket a los KPIs o al
filtro. Además arrastraría a `/recoleccion` un payload con COD, coordenadas, secuencia de ruta, ruta
optimizada, KPIs y el puntero de gestión: todo lo que R38 prohíbe transportar a esta superficie.

**A4. Un service nuevo (`RecoleccionMensajeroService`) para la lectura.**
Se descarta por partición artificial del dominio: `RecoleccionTiendaService` ya es el dueño de la
recolección en tienda y ya tiene la guardia de rol `mensajero`. Dos services para un mismo concepto
obligan a mantener dos veces la definición de "qué es una recolección" (el estado `recolectando`, la
familia `recoleccion_tienda`), que es exactamente el tipo de duplicación que produce divergencias
silenciosas. En este repo `MisAsignacionesService` ya combina lecturas y transiciones del mismo
dominio; se sigue ese precedente.

**A5. Duplicar la consulta de pendientes en `OrdenRepository`** en vez de reusar
`GestionOrdenRepository.findMisAsignaciones`. Se descarta: sería una segunda copia de "las órdenes de
este mensajero en estos estados", con su propio `WHERE` de propiedad y de `deleted_at`, que es
precisamente el filtro que no puede divergir. Se inyecta el método existente con `Pick<>`, el patrón
de DI del repo. (Coste conocido y aceptado: `GestionOrdenRepository` se construye con su cableado por
defecto de encolado de rutas, inerte en una lectura.)

**A6. Mantener el rechazo local de guías ajenas en `useRecolectarPorGuia`.**
Ahorra un viaje al servidor por escaneo equivocado. Se descarta por lo dicho en §7.2: con lista vacía
convertiría el escáner siempre montado en un botón que nunca funciona, y con la página abierta desde
hace rato rechazaría guías que el mensajero SÍ tiene asignadas.

**A7. Replicar la ventana 18:00–18:00 de `RankingService` para «hoy»**, para que "hoy" signifique lo
mismo en las dos pantallas del mensajero. Se descarta por la decisión D6 de la 135: esa ventana es
deuda con ticket propio (166), el ranking no cuenta recolecciones y copiarla propagaría el defecto a
una superficie más. Ver §6.

---

## 11. Riesgos y reversibilidad

| Riesgo | Mitigación |
| --- | --- |
| El corte limpio deja al mensajero sin ninguna pista de dónde está ahora la recolección | El ítem de menú propio es la pista, y es permanente (R4). Verificación humana en pantalla antes de cerrar. |
| Retirar el pre-chequeo local aumenta los viajes al servidor | Acotado: una llamada por escaneo equivocado, con la action ya existente y sin efectos de datos en el rechazo. |
| El índice nuevo se olvida en alguna base | `tests/integration/db/*-migration.test.ts` cubre UP/DOWN, y `prisma migrate deploy` es parte del build. Recordatorio operativo: migrar la base local tras el merge. |
| Un merge futuro reintroduce el panel en Entregas | Guard de §8. |

**Rollback:** `pnpm run db:rollback` retira el índice (no hay datos que perder); el resto es código.

---

## 12. Preguntas abiertas

Las cinco de `requirements.md > Preguntas abiertas`. Las decisiones provisionales que este diseño
toma para poder avanzar —sin buscador, tope 100, borradas excluidas, etiqueta "Recolección"— son
revocables en la puerta de aprobación y ninguna de ellas cambia el modelo de datos.
