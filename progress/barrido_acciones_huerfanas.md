# Barrido de Server Actions huérfanas

**Rama:** `chore/guardia-acciones-huerfanas` (desde `dev`, base `d540c8d8`) · **Fecha:** 2026-08-05
**Motivo:** el 2026-07-31 el commit `54757be4` borró la vista legacy `OrdenesRevisionMaestro` y dejó
`rutearABodegaSatelite` sin ninguna superficie de UI. Nadie se enteró en cinco días porque ningún
test afirma que alguien pueda dispararla. Este documento contesta: **¿hay más casos así?**

Es solo investigación. No se tocó código de producción.

---

## 0. Hallazgo urgente, fuera del encargo

El arreglo del botón (`dc275e87 fix(ordenes): remonta "Rutear a bodega satélite" en en_bodega_central`,
2026-08-05) vive en `hotfix/rutear-satelite-boton` y en `origin/prod`, **pero NO está en `dev`**:

```
$ git merge-base --is-ancestor dc275e87 HEAD  ->  NO
$ git branch -a --contains dc275e87
  hotfix/rutear-satelite-boton · origin/hotfix/rutear-satelite-boton · origin/prod
```

En `dev` hoy, `app/(app)/ordenes/_components/OrdenesListado.tsx:377-385` sigue diciendo que la acción
«se quedó SIN NINGUNA superficie de UI» y `RutearSateliteModal.tsx` sigue sin montarse. **El próximo
release cortado desde `dev` reintroduce el bug.** Falta el merge-back del hotfix.

---

## 1. Tabla: las 20 acciones con `in_degree = 0`

Veredicto: **A** = huérfana de verdad · **B** = viva por otra vía · **C** = falso positivo del grafo.

| # | Acción (definición) | V | Evidencia |
|---|---|---|---|
| 1 | `enviarPlantillaWhatsapp` — `lib/actions/whatsapp-envio.ts:98` | **A** | Cero referencias en TODO el repo salvo dos `specs/*/design.md`. Sin consumidor desde que nació (`eb50730f`/`2dfd7c50`, 2026-07-23). |
| 2 | `listarPlantillasEnviables` — `lib/actions/whatsapp-envio.ts:86` | **A** | Ídem: cero referencias, ni un test. Es el listado que alimentaría a la #1. |
| 3 | `marcarNotificacionLeida` — `lib/actions/notificaciones.ts:68` | **A** | `components/shared/NotificationsBell.tsx:23-26` importa solo `descartarNotificacion` y `marcarTodasLeidas`. `git log -S … -- app components` no devuelve NINGÚN commit: nunca tuvo UI. |
| 4 | `listarCatalogoEstatus` — `lib/actions/ordenes-guia.ts:253` | **A** | Perdió su único consumidor en **`54757be4` (2026-07-31)** — el MISMO commit que mató a `rutearABodegaSatelite`. Sustituta viva: `listarOrderStatus` (`lib/actions/order-status.ts:39`). |
| 5 | `consultarAgregadoOperativo` — `lib/actions/analitica-operativa.ts:155` | **A** | Nació sin superficie en `be51ad9c` (2026-08-03, feature 176). La UI agrega en cliente (`app/(app)/analitica/_components/operativo/agregacion.ts`). Solo la tocan tests. |
| 6 | `obtenerPlantilla` — `lib/actions/plantillas.ts:141` | **A** | No hay pantalla de detalle: `configuracion/plantillas/page.tsx:3` usa `listarPlantillas`; `EditarPlantillaForm.tsx:12` solo `actualizarPlantilla`. `git log -S` vacío en `app`/`components`. |
| 7 | `obtenerVehiculo` — `lib/actions/vehiculos.ts:48` | **A** | No existe UI de vehículos. Solo `listarVehiculos` se consume (`configuracion/tarifas/page.tsx:4`). Sin consumidor desde `fc64e88d` (2026-07-10). |
| 8 | `crearOrden` — `lib/actions/ordenes.ts:45` | **A** | Solo `tests/integration/actions/ordenes-action.test.ts`. Las rutas `app/api/ordenes/api-key/**` instancian servicios directamente (`BulkOrdenService`, `ApiOrdenLecturaService`…), no estas acciones. |
| 9 | `obtenerOrden` — `lib/actions/ordenes.ts:60` | **A** | Ídem #8. |
| 10 | `actualizarOrden` — `lib/actions/ordenes.ts:114` | **A** | Ídem #8. |
| 11 | `borrarOrden` — `lib/actions/ordenes.ts:135` | **A** | Ídem #8. |
| 12 | `listarSaldosTiendasAction` — `lib/actions/wallet-tienda.ts:162` | **A*** | **Deliberada y guardada.** El comentario `wallet-tienda.ts:140-160` la declara «testigo, no camino»; `tests/unit/descarga/adaptador-conjunto.guardia.test.ts` (R32) afirma que ninguna pantalla la llama. |
| 13 | `listarPlantillasAction` — `lib/actions/gasto-fijo-plantilla.ts:149` | **A*** | Ídem #12 (`gasto-fijo-plantilla.ts:140` remite «palabra por palabra» a #12). |
| 14 | `listarCuentasPorPagarAction` — `lib/actions/wallet-mensajero.ts:136` | **A*** | Sustituida por `listarCuentasPorPagarPaginadoAction` en `a0ae14e7`/`adce25ce` (2026-08-01); `app/(app)/wallet/mensajeros/page.tsx:6` usa la paginada. |
| 15 | `listarCierresBodegaAdmin` — `lib/actions/cierre-bodega.ts:149` | **A*** | `app/(app)/cierres-admin/page.tsx:89-99` documenta su salida del render (feature 170 T M.1 + 184 T E.3) y la marca «candidata a retirada de la tanda H». |
| 16 | `marcarTodasLeidas` — `lib/actions/notificaciones.ts:81` | **C** | `components/shared/NotificationsBell.tsx:25` (import **con alias**) y `:131` (llamada por el alias). El bell se monta en `components/shared/PageHeader.tsx:73`. |
| 17 | `previewPlantilla` — `lib/actions/plantillas.ts:217` | **C** | `app/(app)/configuracion/plantillas/_components/VariablesInsert.tsx:8` (import) y `:72` (**valor por defecto de prop**, `previewAction = previewPlantilla`). Montado en `CrearPlantillaForm.tsx:79` y `EditarPlantillaForm.tsx:86`. |
| 18 | `listarPlantillasActivasParaEnvio` — `lib/actions/whatsapp-envio.ts:70` | **C** | `chat-demo/ChatConversacion.tsx:21` y `:178` (**paso por referencia**) → `ChatFlotante.tsx:112` → `RepartoModule.tsx:597` → `app/(app)/mis-asignaciones/reparto/page.tsx:46`. Cadena completa hasta una ruta. |
| 19 | `leerEvidencia` — `lib/actions/mis-asignaciones.ts:284` | **C** | Doble error del grafo: **no está exportada** (`async function leerEvidencia`, sin `export`) y sí se usa en `:291` — `files.map(leerEvidencia)`, **referencia, no llamada**. |
| 20 | `setSessionCookie` — `lib/actions/auth.ts:56` | **C** | Doble error del grafo: **no está exportada** (`auth.ts:56`) y se usa en `:93` y `:134` como `deps.setCookie ?? setSessionCookie` (**referencia en un `??`**). |

`A*` = huérfana real, pero **intencionada y documentada junto al código**. No es deuda: es la
convención que dejó la feature 184 (commit `fa60b0ce`).

**Categoría B: cero casos.** Ninguna de las 20 está viva por ruta de API, cron, script, `formAction`
ni import dinámico. Se comprobó explícitamente que `app/api/ordenes/api-key/**` y `app/api/cron/**`
importan servicios y repositorios, nunca `lib/actions/*`.

---

## 2. Las (A) ordenadas por gravedad

### Funcionalidad que un usuario esperaría poder usar (mutaciones sin superficie)

1. **`enviarPlantillaWhatsapp` + `listarPlantillasEnviables`** — `lib/actions/whatsapp-envio.ts:86,98`.
   El envío server-side por Meta (feature 107): resuelve actor, valida propiedad de la orden vía
   `OrdenEnvioReader`, delega en `EnvioPlantillaWhatsappService`. **Nunca tuvo botón.** La UI que sí
   existe (`app/(app)/mis-asignaciones/_components/EnviarPlantillaWhatsappButton.tsx:16,99`) usa el
   camino wa.me (`listarPlantillasParaEnvio`), que abre WhatsApp en el cliente y no manda nada por
   Meta. Es el caso más grave del barrido: es camino muerto **desde el día 1** (2026-07-23), no una
   regresión, así que ni siquiera hay un "antes" al que volver. Peor que el de rutear en un sentido:
   nadie lo ha reportado porque nadie sabe que existe.
2. **`marcarNotificacionLeida`** — `lib/actions/notificaciones.ts:68`. Marcar UNA notificación como
   leída. La campana solo ofrece "descartar" y "marcar todas". Es una capacidad de usuario completa,
   implementada y testeada, sin ningún punto de entrada.
3. **`listarCatalogoEstatus`** — `lib/actions/ordenes-guia.ts:253`. **Segunda víctima del mismo
   commit `54757be4`.** El daño real es bajo (existe `listarOrderStatus`, que hace lo mismo con
   autorización más amplia), pero confirma que aquel borrado dejó más de un cabo suelto y que nada
   lo detectó.

### Lecturas / andamiaje: inocuas, pero deuda

4. **`consultarAgregadoOperativo`** — feature 176, dos días de antigüedad. Backend del "modo agregado"
   de analítica sin ninguna pantalla que lo pida. Probablemente pendiente de cablear a propósito,
   pero **nada en el código lo dice**: es indistinguible de un olvido.
5. **`obtenerPlantilla`** — lectura de detalle para una pantalla de detalle que no se construyó.
6. **`obtenerVehiculo`** — catálogo de solo lectura (feature 50) del que solo se usa el listado.
7. **`crearOrden` / `obtenerOrden` / `actualizarOrden` / `borrarOrden`** — `lib/actions/ordenes.ts`.
   CRUD genérico que ninguna pantalla ni ninguna ruta de API usa; su único consumidor es su propio
   test. Andamiaje temprano. Cuatro exports mantenidos y tipados a cambio de nada.
8. **`listarSaldosTiendasAction` / `listarPlantillasAction` / `listarCuentasPorPagarAction` /
   `listarCierresBodegaAdmin`** — deuda **cero**. Están sin consumidor a propósito, con el motivo
   escrito al lado y una guardia (`adaptador-conjunto.guardia.test.ts`, R31/R32) que impide que
   alguien las vuelva a llamar. Son el modelo de cómo debería declararse una excepción.

---

## 3. El caso de segundo orden: lo que `in_degree` NO ve

Se calculó la **alcanzabilidad transitiva** desde las raíces de Next.js (48 ficheros
`page/layout/route/loading/error/not-found` bajo `app/` + `middleware.ts`), siguiendo imports
estáticos y dinámicos con resolución de `@/` e `index.ts`. De 959 módulos, **26 no son alcanzables**.

### Componentes que nadie monta

| Fichero | Nota |
|---|---|
| `app/(app)/ordenes/_components/RutearSateliteModal.tsx` | **El caso del bug, todavía vivo en `dev`.** Su acción `rutearABodegaSatelite` tiene `in_degree = 1` y aun así está muerta. |
| `app/(app)/configuracion/_components/ZonasModule.tsx` | Pantalla de administración de zonas. **No existe `app/(app)/configuracion/zonas/page.tsx`.** |
| `app/(app)/configuracion/_components/ZonaForm.tsx` | Formulario de alta/edición de zona (usa el mismo `ZonasModule`). |
| `app/(app)/configuracion/_components/zonas-columns.tsx` | Columnas de esa tabla. |
| `app/(app)/mis-asignaciones/_components/ChatWhatsappPanel.tsx` | Panel de chat del detalle. Sus acciones siguen vivas por el chat flotante (`ChatConversacion`), así que solo se pierde el componente. |
| `components/shared/TableFilters.tsx` | Componente genérico de filtros de `de69f7d1` (2026-07-13). Ninguna referencia en todo `app/`+`components/`+`lib/`. |

### Acciones muertas de segundo orden — **no salían en la lista de partida**

`ZonaForm.tsx` es el único importador de estas cinco, y `ZonaForm` no lo monta nadie:

| Acción | `in_degree` en el grafo | Único consumidor |
|---|---|---|
| `listarProvincias` — `lib/actions/geo.ts:64` | 1 | `ZonaForm.tsx:23-27` |
| `listarCantones` — `lib/actions/geo.ts:77` | 1 | `ZonaForm.tsx:23-27` |
| `listarDistritos` — `lib/actions/geo.ts:97` | 1 | `ZonaForm.tsx:23-27` |
| `arbolZonas` — `lib/actions/zonas.ts:156` | 1 | `ZonaForm.tsx:22` |
| `rutearABodegaSatelite` — `lib/actions/ordenes-guia.ts:~235` | 1 | `RutearSateliteModal.tsx:9` (no montado en `dev`) |

`lib/actions/geo.ts` es, de hecho, **el único fichero de `lib/actions/` entero inalcanzable desde
cualquier ruta**. El grafo le da `in_degree = 1` a cada export y por eso ninguno apareció en el
punto de partida. Son exactamente el mismo tipo de muerte que la de `rutearABodegaSatelite`.

*No comprobado:* no verifiqué si `ZonasModule`/`ZonaForm` se desmontaron por decisión (la gestión de
zonas parece haberse movido a `configuracion/tarifas/_components/ZonasTarifasModule.tsx`, que sí está
montado y usa `crearZona`/`obtenerZona`/`borrarZona`) o por descuido. Es una pregunta de producto.

---

## 4. Qué señal distingue automáticamente a las (A) de las (B) y (C)

**Conclusión de fondo: `in_degree` es la primitiva equivocada.** En este barrido dio **5 falsos
positivos de 20 (25 %)** y, sobre todo, **no marcó a `rutearABodegaSatelite`** — el bug que motiva
todo esto — ni a las otras cuatro acciones de segundo orden. Una guardia construida sobre `in_degree`
habría sido ruidosa y aun así habría dejado pasar el incidente.

La señal correcta se compone de dos comprobaciones estáticas, en este orden.

### Señal 1 — existencia de una **arista de import**, no de una llamada (separa C de todo lo demás)

Los cinco falsos positivos tienen todos una cosa en común: **el símbolo se usa por referencia, nunca
en una expresión de llamada directa** en el sitio del import.

- alias: `import { marcarTodasLeidas as marcarTodasLeidasAction }` (#16)
- valor por defecto de prop: `previewAction = previewPlantilla` (#17)
- paso como argumento/prop: `listarPlantillasActivasParaEnvio,` (#18)
- referencia a función: `files.map(leerEvidencia)` (#19)
- fallback en `??`: `deps.setCookie ?? setSessionCookie` (#20)

Comprobable por estático: parsear los `import`/`export` de cada módulo y registrar el símbolo
importado **sin exigir un call site**. Hay que soportar: alias (`a as b`), `import()` dinámico,
`export … from` (re-exports), alias `@/`, rutas relativas y `index.ts`. Esta sola señal elimina el
100 % de los C de este barrido.

### Señal 2 — **alcanzabilidad desde una raíz de ruta** (es la que faltaba, y la que atrapa el bug)

Que algo te importe no basta: `RutearSateliteModal` importa `rutearABodegaSatelite` y las dos están
muertas. Hay que calcular el cierre transitivo del grafo de imports desde el conjunto de raíces:

```
app/**/{page,layout,template,default,route,loading,error,not-found,global-error}.{ts,tsx}
app/api/**/route.ts          (incluye los 7 crons)
middleware.ts                (+ instrumentation.ts si aparece)
```

Una acción está **viva** solo si **alguno** de sus importadores cae dentro de ese cierre. Con esto:

- las (C) pasan a verde por sí solas — la cadena `ChatConversacion → ChatFlotante → RepartoModule →
  reparto/page.tsx` se resuelve sin ayuda;
- las (A) quedan aisladas;
- las de segundo orden (`geo.ts`, `arbolZonas`, `rutearABodegaSatelite`) **salen marcadas**, que es
  justo lo que `in_degree` no consigue;
- y la misma pasada, sin código extra, reporta **componentes** inalcanzables bajo `components/` y
  `app/**/_components/` — que es donde de verdad empezó el incidente. Detectarlo un nivel antes
  («has borrado la vista que montaba este modal») es más útil que detectarlo en la acción.

El script exploratorio que usé para este informe hace exactamente esto en ~70 líneas de Node sobre
959 módulos, en menos de un segundo. No hace falta un analizador de tipos.

### Señal 3 — separar (A) de (B): las vías legítimas que un import-graph no ve

En este repo **no encontré ni un solo caso B**, pero la guardia tiene que contemplarlos o dará
falsos rojos en cuanto aparezcan:

| Vía | ¿La cubre la señal 2? |
|---|---|
| Ruta de API / cron (`app/api/**/route.ts`) | **Sí**, ya son raíces. |
| `<form action={accion}>` / `formAction={accion}` | **Sí**: sigue siendo un import estático. |
| `next/dynamic(() => import("…"))` | **Sí** si el escáner reconoce `import(` además de `from`. |
| Script / seed (`scripts/**`) | **No** por defecto. Añadir `scripts/**` como raíz de una clase aparte y reportar «viva solo por script, sin UI» — no es lo mismo que estar viva. |
| Invocación por string / registro (dispatcher por nombre) | **No.** Requiere buscar el nombre del export en literales de string. *No verifiqué el mecanismo de despacho de `app/api/cron/procesar-jobs/route.ts`*; es el único sitio de este repo con esa forma y hay que mirarlo antes de escribir la guardia. |

### La lista de excepciones legítimas que hará falta

Sin ella la guardia nace roja: **9 de las 20** son huérfanas reales que hoy nadie quiere borrar.

1. **Las cuatro relecturas conservadas a propósito** (170/184): `listarSaldosTiendasAction`,
   `listarPlantillasAction`, `listarCuentasPorPagarAction`, `listarCierresBodegaAdmin`. Ya tienen
   motivo escrito junto al código y su propia guardia inversa (R31/R32).
2. **Acciones recién nacidas aún sin cablear**: `consultarAgregadoOperativo` (feature 176, 2026-08-03).
3. **Andamiaje CRUD sin superficie**: los cuatro de `lib/actions/ordenes.ts`.

**Forma recomendada de la excepción: una anotación en el código, no un fichero de allowlist.** Algo
como `/** @sin-superficie <feature/motivo> */` inmediatamente encima del export, porque:

- es la convención que este repo ya adoptó (`fa60b0ce`, «el motivo … junto al código»);
- una allowlist central se desincroniza y nadie la poda;
- y sobre todo **invierte la carga de la prueba en el momento correcto**: quien borre la vista que
  monta una acción se encuentra la suite roja y tiene que elegir entre volver a montarla o escribir
  por qué se queda sin superficie. Eso es exactamente lo que no ocurrió el 2026-07-31.

La guardia debe además exigir que la anotación **no** esté sobre algo que sí tiene superficie
(excepción caducada), o en un año habrá 40 tags y ninguna señal.

### Bonus casi gratis: ordenar la gravedad por estático

Una mutación sin superficie es una capacidad de usuario perdida; una lectura sin superficie suele ser
un loader superado. Proxy estático barato: **¿la acción llama a `revalidatePath`/`revalidateTag`, o
delega en un método de servicio que escribe?** Con eso la guardia puede fallar en rojo para las
mutaciones (`enviarPlantillaWhatsapp`, `marcarNotificacionLeida`, `rutearABodegaSatelite`) y limitarse
a avisar en las lecturas.

---

## 5. Qué no pude comprobar

- **El mecanismo de despacho de `app/api/cron/procesar-jobs/route.ts`.** Si despacha por nombre en
  string, es la única forma de "vía B" plausible del repo y la guardia necesita saberlo. No lo abrí.
- **Si `ZonasModule`/`ZonaForm` se desmontaron a propósito** al mover la gestión de zonas a
  `configuracion/tarifas`. Es decisión de producto, no la deduzco del árbol.
- **Si `consultarAgregadoOperativo` está pendiente de cablear** o se quedó sin UI. El código no lo
  dice, que es precisamente el problema.
- No corrí `./init.sh` ni la suite (instrucción explícita del encargo).
