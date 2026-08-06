# Guardia de superficie de uso

**Rama:** `chore/guardia-acciones-huerfanas` · **Fecha:** 2026-08-05
**Origen:** `progress/barrido_acciones_huerfanas.md` §4 (su sección 4 es la especificación de esto).
**Guardia:** `tests/unit/guards/superficie-de-uso.guardia.test.ts` — 18 casos, la selecciona
`pnpm exec vitest run guard` por el nombre del archivo, sin estar registrada en ninguna lista.

---

## 0. Lo primero, porque cambia el punto de partida

El hotfix `dc275e87` («remonta Rutear a bodega satélite en `en_bodega_central`») **no estaba en esta
rama**: el barrido lo dejó anotado como hallazgo urgente y, entretanto, `origin/dev` recibió el
merge-back (`5190ffd4`). Esta rama salía de `d540c8d8`, anterior. Se hizo `git merge origin/dev`
antes de escribir nada, porque sin él la guardia nacía roja justo sobre el caso que la justifica y
la única salida habría sido anotar el bug como si fuera diseño.

Efecto colateral, medido: el barrido contó **26 módulos inalcanzables**; con el hotfix dentro son
**25**, porque `RutearSateliteModal.tsx` volvió a estar montado.

---

## 1. Qué comprueba

Construye **una sola vez** el grafo de imports de los árboles de producción (`app`, `components`,
`lib`, `hooks`, `providers` + `middleware.ts`; **959 módulos**) y calcula el **cierre transitivo**
desde las **49 raíces de ruta** de Next (`page|layout|template|default|route|loading|error|
not-found|global-error` bajo `app/`, lo que incluye `app/api/**/route.ts` y los 7 crons, más
`middleware.ts`). Salen **935 alcanzables** y **24 no**.

Sobre eso, tres capas, porque la superficie se corta en tres sitios distintos:

| | Qué afirma | Hoy |
|---|---|---|
| **R-A · la acción** | ninguna Server Action de `lib/actions/**` es inalcanzable sin su anotación | 199 acciones, 19 sin superficie, 19 anotadas |
| **R-B · el componente** | ningún componente de `components/**` ni de `app/**/_components/**` es inalcanzable sin su anotación | 5 sin montador, 5 anotados |
| **R-C · dentro del módulo** | ninguna función declarada bajo `app/` o `components/` se queda sin una sola referencia en su propio módulo | 0 |

Más, en las dos direcciones, la **caducidad**: si algo lleva `@sin-superficie` y **sí** es
alcanzable, la guardia falla y exige quitar la anotación.

### Por qué no `in_degree`

El barrido lo midió: contar importadores da **5 falsos positivos de 20** (usos por *referencia*:
alias, `previewAction = previewPlantilla`, `files.map(leerEvidencia)`, `deps.setCookie ?? setSessionCookie`)
y **no marca `rutearABodegaSatelite`**, que es el bug. La alcanzabilidad resuelve los cinco sola
—hay un caso de control que lo afirma sobre el árbol real— y saca además las cinco muertes de
**segundo orden** (`geo.ts` ×3, `arbolZonas`, y el propio `rutearABodegaSatelite` cuando cae).

### Por qué R-B FALLA y no solo informa

Decisión, con su motivo: un informe es exactamente la señal que ya existía el 2026-07-31 —cualquiera
podía correr un barrido— y nadie la miró en cinco días. Y es el nivel donde **empezó** el incidente:
`RutearSateliteModal` quedó huérfano antes que su acción. Ahí el mensaje es «has borrado la vista que
montaba esto» (accionable) en vez de «esta acción ya no se usa» (que invita a borrarla, que es el
error contrario). El coste está acotado: **cinco** módulos hoy, una línea de motivo cada uno.

### Por qué existe R-C

Es la capa que caza la repetición del incidente **sin borrar ningún archivo**: quitar la entrada de
la acción del menú por lote deja el modal importado y renderizado —R-A y R-B siguen verdes, el grafo
de módulos no se entera— y el botón desaparece igual. Lo que queda colgando es el handler que abría
el modal. **No lo cubre el compilador**: este repo no tiene `noUnusedLocals` en `tsconfig.json`, así
que `pnpm run typecheck` pasa con el handler muerto dentro (comprobado: la mutación (a) type-checkea).

### Resolución de imports

Alias `@/`, relativos, extensión implícita, `index.ts` de carpeta, el `.js`→`.ts` de TS,
`export … from`, `import * as`, `import "x"` e `import()` dinámico. Lo que **no** resuelve se
reporta en rojo (`todo especificador relativo o con alias resuelve a un archivo real`), en vez de
darse por alcanzable: un detector que en la duda calla es justo el que falla. Hoy: **cero** sin
resolver.

Los imports **de tipo** (`import type {…}` y `{ type X }` en línea) no cuentan como superficie de
ejecución en R-A: se borran al compilar.

### Anti-vacuidad y control positivo

Precedente de la casa: en esta misma feature una guardia pasó **verde con su detector roto**
—encontraba cero porque no encontraba nada—. Por eso:

- **4 casos de auto-test del detector** contra respuestas conocidas, en las dos direcciones
  (resolvedor, lector de especificadores, lector de símbolos con alias/comodín, lector de anotaciones).
- **3 casos de anti-vacuidad**: ≥40 raíces de los dos tipos, >800 módulos, >850 alcanzables, >500
  módulos con aristas, **ningún archivo leído vacío**, cero especificadores sin resolver, y el censo
  de acciones con anclas concretas.
- **4 controles positivos**, incluido el que nombra el incidente: *`rutearABodegaSatelite` y su modal
  son alcanzables*. Si vuelve a caer, ese caso se pone rojo antes que el censo y lo dice por su nombre.

### Coste

**1.19 s** el archivo entero (28 ms de tests; el resto es construir el grafo una vez en el import).
El barrido estimó <1 s sobre 959 módulos y se cumple. Dentro de `pnpm exec vitest run guard`
(69 archivos, 946 casos, **6.26 s**) no se nota.

---

## 2. Anotaciones puestas: 24

Formato `/** @sin-superficie <motivo> */` **pegado al export** (una línea en blanco lo desactiva, y
hay un caso que lo afirma). La guardia **rechaza motivos de relleno**: menos de 20 caracteres, o
empezando por `TODO`/`TBD`/`FIXME`/`pendiente`/`por decidir`/`n/a`, no cuentan como motivo.

### Server Actions (19)

**Deuda de verdad — funcionalidad que un usuario esperaría poder usar (3).** Anotadas con «DEUDA, no
diseño» en mayúsculas, para que se vean al leer el archivo:

| Acción | Motivo |
|---|---|
| `whatsapp-envio.ts#enviarPlantillaWhatsapp` | el envío server-side por Meta **nunca tuvo botón** (feature 107, 2026-07-23). La UI que existe usa el camino wa.me, que no manda nada por Meta. Camino muerto desde el día 1 |
| `whatsapp-envio.ts#listarPlantillasEnviables` | es el listado que alimentaría al botón anterior, que no existe |
| `notificaciones.ts#marcarNotificacionLeida` | la campana solo ofrece «descartar» y «marcar todas»; marcar UNA no tiene punto de entrada y `git log -S` dice que nunca lo tuvo |

**Deuda inocua, pero deuda (7).**

| Acción | Motivo |
|---|---|
| `ordenes-guia.ts#listarCatalogoEstatus` | **segunda víctima de `54757be4`**, el mismo commit del bug. Daño bajo: existe la sustituta viva `listarOrderStatus` |
| `analitica-operativa.ts#consultarAgregadoOperativo` | nació sin cablear (feature 176, 2026-08-03); la UI agrega en el cliente |
| `plantillas.ts#obtenerPlantilla` | lectura de detalle para una pantalla de detalle que no se construyó |
| `vehiculos.ts#obtenerVehiculo` | no existe UI de vehículos; solo se consume el listado |
| `ordenes.ts#crearOrden` / `#obtenerOrden` / `#actualizarOrden` / `#borrarOrden` | andamiaje CRUD del arranque; su único consumidor es su propio test de integración (contado como 4) |

**Muertes de segundo orden — las que `in_degree` no veía (4).** Todas cuelgan de `ZonaForm.tsx`, que
nadie monta. Anotadas señalando que la pregunta de producto está **abierta**:

`geo.ts#listarProvincias`, `geo.ts#listarCantones`, `geo.ts#listarDistritos`, `zonas.ts#arbolZonas`.

**Decisión escrita, no deuda (4).** Las cuatro relecturas que las features 170/184 conservaron a
propósito, con su motivo ya junto al código y su guardia inversa (R31/R32). La anotación solo añade
la etiqueta legible por máquina encima de la prosa que ya estaba:
`wallet-tienda.ts#listarSaldosTiendasAction`, `gasto-fijo-plantilla.ts#listarPlantillasAction`,
`wallet-mensajero.ts#listarCuentasPorPagarAction`, `cierre-bodega.ts#listarCierresBodegaAdmin`.

### Componentes (5)

| Componente | Motivo |
|---|---|
| `configuracion/_components/ZonasModule.tsx` | **no existe** `configuracion/zonas/page.tsx`; la gestión se movió a `tarifas/_components/ZonasTarifasModule.tsx`. Si fue deliberado o descuido: **abierto** |
| `configuracion/_components/ZonaForm.tsx` | muere con `ZonasModule`; arrastra las 4 acciones de segundo orden |
| `configuracion/_components/zonas-columns.tsx` | son las columnas de esa tabla |
| `mis-asignaciones/_components/ChatWhatsappPanel.tsx` | sustituido por el chat flotante (`ChatConversacion`→`ChatFlotante`→`RepartoModule`), que sí vive; se pierde el panel, no las acciones |
| `components/shared/TableFilters.tsx` | genérico de `de69f7d1` (2026-07-13) que ninguna pantalla usó nunca |

*Nota:* `ZonaForm.tsx` es el único archivo del repo con finales de línea CRLF; su anotación se
insertó con un script para no mezclar finales de línea.

---

## 3. Verificación por mutación

Las cuatro con restauración desde copia **en memoria** y verificación por **hash SHA-256** (con
reintento: en esta feature un `writeFileSync` falló por lock de Windows y dejó la mutación puesta).
Las cuatro restauraciones: `OK, hash idéntico`. Control final tras las mutaciones: **verde**, y
`git status` sin rastro de los archivos mutados.

| # | Mutación | Resultado | Caso que la caza |
|---|---|---|---|
| **(a)** | **reproduce el incidente**: se quita la acción `rutear-satelite` del `case "en_bodega_central"` de `OrdenesListado.tsx` (el modal queda importado y renderizado, pero sin quien lo abra) | **ROJA** | R-C › `ninguna función declarada bajo app/ o components/ se queda sin una sola referencia` |
| **(b)** | anotación **caducada**: se pone `@sin-superficie` a `rutearABodegaSatelite`, que sí tiene superficie | **ROJA** | R-A › `ninguna anotación @sin-superficie de acción sobrevive a su motivo` |
| **(c)** | se **borra** una anotación legítima (`enviarPlantillaWhatsapp`) | **ROJA** | R-A › `ninguna Server Action de lib/actions/** es inalcanzable sin su anotación @sin-superficie` |
| **(d)** | réplica **literal** de `54757be4`: la vista deja de montar el modal (fuera el import y el JSX) | **ROJA**, 3 casos | control positivo `rutearABodegaSatelite y su modal son alcanzables` + R-A + R-B |

La (a) es la que importa: es la forma **barata** del mismo fallo, la que no borra ningún archivo, y
la única de las cuatro que el grafo de módulos no ve. La (d) es la forma cara, la que ocurrió.

---

## 4. Qué NO cubre — los límites, que son parte del entregable

Es una guardia **estática sobre imports**. No ejecuta nada y no sabe de renderizado. En concreto:

1. **No sabe si el botón se ve.** Una acción montada tras un `if (rol === "maestro")` que nadie
   cumple, un `hidden`, un `disabled` permanente o una ruta sin enlace en el menú **pasan verdes**.
   La guardia afirma «hay un camino de import desde una ruta», no «un usuario puede llegar».
2. **R-C solo mira `function nombre(…)`.** Un handler declarado como `const abrirX = () => {…}` que
   se quede sin referencia **no lo caza**. Es la mitad barata; ampliarlo a `const` exige distinguir
   la asignación de la referencia y ahí el regex empieza a mentir. Deuda consciente.
3. **Alcance por módulo, no por símbolo, en R-B.** Un componente cuyo módulo alguien importa por
   OTRA cosa (un tipo, una constante) cuenta como alcanzable aunque el componente en sí no se monte.
4. **Los imports de tipo cuentan para la alcanzabilidad de MÓDULO** (no para R-A). Un módulo que solo
   se importa con `import type` sale alcanzable aunque en runtime no exista.
5. **Despacho por string.** Si algún día se invoca una acción por nombre en un literal, la guardia la
   dará por muerta. Se verificó que hoy no ocurre: `app/api/cron/procesar-jobs/route.ts` —el único
   candidato, y la duda que el barrido dejó abierta en su §5— registra handlers con imports
   estáticos de factorías (`buildHandlers`), no por nombre. **Punto cerrado.**
6. **`scripts/**` no es raíz.** Una acción usada solo por un seed saldrá huérfana. Es a propósito
   («viva por script» no es «tiene superficie»), pero hoy no hay ningún caso y por tanto **no está
   probado** contra uno real.
7. **`tests/**` tampoco es raíz**, y eso es el punto: cuatro de las anotadas están vivas *solo* en su
   test, que es exactamente el estado que hay que hacer visible.
8. **No ordena por gravedad.** El barrido proponía separar mutaciones de lecturas por si llaman a
   `revalidatePath`. No se implementó: la anotación ya obliga a escribir la gravedad en prosa, y un
   proxy estático que se equivoque en esa clasificación es peor que no tenerla. Queda abierto.
9. **No dice si una excepción es *correcta*.** Solo que existe y tiene motivo escrito. Nadie impide
   anotar en vez de arreglar; lo que impide es hacerlo **en silencio**.

---

## 5. Salidas reales

```
$ pnpm exec vitest run tests/unit/guards/superficie-de-uso.guardia.test.ts
 Test Files  1 passed (1)
      Tests  18 passed (18)
   Duration  1.19s

$ pnpm exec vitest run guard
 Test Files  69 passed (69)
      Tests  946 passed (946)
   Duration  6.26s

$ pnpm run typecheck
> tsc --noEmit
(sin salida)

$ pnpm run lint
✖ 48 problems (0 errors, 48 warnings)     <- las 48 son preexistentes, ninguna en lo tocado

$ pnpm run test:cambiados
 Test Files  114 passed (114)
      Tests  1359 passed (1359)
   Duration  98.24s
```

**No se corrió `./init.sh`** (instrucción explícita del encargo: el gate lo corre el leader).

---

## 6. Veredicto

La guardia se pone roja ante las cuatro mutaciones, incluida la forma barata del incidente que
ningún grafo de módulos ve, y las 24 excepciones de hoy tienen motivo escrito y caducan solas.
