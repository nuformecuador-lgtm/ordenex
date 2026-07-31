# Feature 122 — analítica: resolutor de alcance por rol · tasks

**Alcance de archivos de la rama (R33):** ningún archivo fuera de `lib/analytics/**` y
`tests/unit/analytics/**`. **Única excepción autorizada (D8):** ampliar
`tests/unit/analytics/modulo-puro.guardia.test.ts`, archivo heredado de la 135. Ni migraciones, ni
`app/`, ni `components/`, ni `lib/{actions,services,repositories}/`.

**Convención:** `[P]` = paralelizable con las tareas de su mismo bloque. Cada tarea lleva su
criterio de **hecho**. Un commit por tarea lógica (`docs/conventions.md:24-26`).

---

## T0 · PUERTA F1.4 — **CERRADA** (2026-07-31)

> Las diez preguntas están respondidas. El texto íntegro de cada decisión, con su consecuencia
> asumida, está en `requirements.md > 2. Decisiones del humano`. **Nada de esto se reabre en
> implementación:** si una decisión estorba, se para y se vuelve a la puerta.

| # | Decisión del humano | Fija |
|---|---|---|
| D1 (Q1) | Filtro que nombra datos ajenos ⇒ **explícito siempre**: 403 `filtro_fuera_de_alcance`. Ni vacío ni recorte silencioso | R21, T3.2 |
| D2 (Q2) | `adminSatelite` sin `zona_id` ⇒ **explícito siempre**: 403. No ve nada; ni «todo» ni vacío mudo | R13, T2.3 |
| D3 (Q3) | «Propio» del mensajero ⇒ **`orden.mensajero_asignado_id`**, siempre. Elegido a sabiendas: en la orden reasignada A→B, **A pierde el crédito de su trabajo**. Coherencia con la 159 (`db/schema.prisma:478`) | R7, R23, R24, R28, T3.1, T5.4 |
| D4 (Q4) | `adminSatelite` ve grano `tienda` de su zona ⇒ **sí** | R37, T3.4 |
| D5 (Q5) | `adminTienda` ve grano `mensajero` ⇒ **sí, ANONIMIZADO** (etiqueta ordinal / id opaco; nunca nombre, teléfono, correo ni uuid real) | R37, R38, R39, T3.5, T3.6 |
| D6 (Q6) | `mensajero` ve grano `tienda` ⇒ **sí** | R37, T3.4 |
| D7 (Q7) | Denegado en el borde ⇒ **explícito siempre**: servicio `forbidden`, borde **403** | R41, T4.5 |
| D8 (Q8) | Pureza transitiva ⇒ **ampliar el guardia de la 135** (`modulo-puro.guardia.test.ts`), uno solo, con allowlist nominal de **una** arista para `acceso-total → @prisma/client` (la opción (c) NO se eligió) | R35, R36, T5.1 |
| D9 (Q9) | `apiKey` y analítica ⇒ **confirmado, nunca**. Si algún día sí, ficha propia | R11, T2.3, T5.2 |
| D10 (Q10) | Auditoría de denegados ⇒ **sí, canal existente**: `ErrorLogger` (`lib/errors/logger.ts:6-8`), el de crons y webhooks | R40, T4.6 |

- **T0.1** — ✅ **HECHO (2026-07-31).** Las diez decisiones están fechadas en
  `requirements.md > 2. Decisiones del humano`, cada una con su consecuencia asumida; los cuatro
  requisitos marcados `⧗Q3` (R7, R23, R24, R28) tienen criterio fijado y ya no llevan marca.
  **Hecho:** ningún requisito `R<n>` lleva ya la marca; las únicas apariciones de `⧗Q` en la spec
  son referencias históricas dentro de las decisiones, no requisitos pendientes.
- **T0.2** — ✅ **HECHO.** D4/D5/D6 **no** introducen recorte de granos: se añadió R37 (prohibición
  expresa de una segunda tabla de granos por rol) y, por D5, R38/R39 (identidad). **No** hace falta
  campo nuevo en el catálogo de la 135 ni ticket contra ella.
  **Hecho:** `requirements.md` cerrado con R1–R41 y trazabilidad 41/41.
- **T0.3** — ⚠ **Leer antes de T3.1.** En `requirements.md > D3` queda registrada una discrepancia
  entre la columna elegida (`orden.mensajero_asignado_id`) y la consecuencia tal como se enunció al
  decidir (que corresponde a la otra columna). La spec implementa **la columna elegida**. Si el
  reviewer o el humano detectan que se quería lo contrario, se para **antes** de T3.1.
  **Hecho:** el implementer deja constancia en `progress/impl_122.md` de que leyó esta nota.

---

## T1 · Preparación

- **T1.1** — Medir el baseline **antes** de tocar nada: `pnpm db:generate` desde el schema limpio,
  luego typecheck y suite completa; anotar los rojos preexistentes (~20 del rediseño `ux`, PR #212)
  en `progress/impl_122.md`.
  **Hecho:** el baseline está escrito con fecha y conteo; ningún rojo ajeno se atribuye a la 122.
  *(Depende de: nada. Puede correr durante T0.)*

- **T1.2 [P]** — Verificar que la base de la rama contiene el contrato de la 135: existen los
  cuatro módulos de `lib/analytics/` y sus 10 suites en `tests/unit/analytics/`, y estas pasan.
  **Hecho:** las 10 suites de la 135 en verde sobre esta rama.

---

## T2 · El resolutor (`lib/analytics/alcance.ts`)

*(Depende de: T0.)*

- **T2.1** — Declarar `ActorAnalitica`, `AlcanceDatos`, `MotivoDenegacion` y `ResolucionAlcance`
  según `design.md §3.1-3.2`. `rol` tipado `string` (no `RolValue`) a propósito.
  **Hecho:** compila en `strict`; `tsc` no reporta `any`; el archivo no importa `interfaces/services`.

- **T2.2** — Implementar `resolverAlcance(actor, metricaId)`: guardas de fallo cerrado en el orden
  R10 → R11 → R12 → R14 → R9 → R13, y `switch` exhaustivo sobre los cinco roles cerrado con `never`.
  Consume `getMetrica()` y `metrica.alcance[rol]`; llama a `esAccesoTotal` solo para el guardia de
  consistencia de T5.2 (R3), nunca como segunda fuente de reglas.
  **Hecho:** `alcance.test.ts` cubre R2, R4, R6, R7, R9–R14; ninguna rama `default` concede alcance;
  cobertura de ramas del archivo = 100%.

- **T2.3** — Casos de fallo cerrado con datos reales del esquema: `zonaId: null`, `zonaId: ""`,
  `rol: "apiKey"`, `rol: "Admin Tienda"` (el `@map` de la DB, `db/schema.prisma:39`), actor `null`,
  `metricaId` inexistente.
  **Hecho:** los seis casos devuelven `denegado` con su motivo; ninguno devuelve `global`.

- **T2.4 [P]** — Test de asignabilidad `Actor` → `ActorAnalitica` (R30) y censo de que el módulo no
  importa `next/headers` ni la capa `services`.
  **Hecho:** el test de tipos compila; un cambio de forma en `IOrdenService.Actor` lo rompería.

---

## T3 · Adaptadores, granos e identidad

*(Depende de: T2.1. Q3 ya está resuelta por D3.)*

- **T3.1** — `whereOrden`, `whereGestionOrden`, `whereRollup` en `lib/analytics/alcance-columnas.ts`
  según `design.md §3.3`, con `import type { Prisma }` (única concesión, autorizada por
  `modulo-puro.guardia.test.ts:138-147`). Los **tres** recortes de `gestion_orden` —zona, tienda y
  mensajero— pasan **por la relación `orden`** (R24, D3); `gestion_orden.mensajeroId` no se usa.
  **Hecho:** `alcance-adaptadores.test.ts` fija el fragmento esperado para los 4 tipos de alcance ×
  3 tablas; el fragmento de `global` es `{}`; hay una aserción explícita de que ningún fragmento
  contiene `mensajeroId` fuera de `orden`.

- **T3.2** — Intersección alcance ∩ filtro del cliente (R20/R21) y escritura del filtro **ya
  recortado** en la consulta preparada.
  **Hecho:** `adminTienda` con `tienda_id:[propia, ajena]` conserva solo la propia;
  `tienda_id:[ajena]` ⇒ `forbidden/filtro_fuera_de_alcance` (D1), nunca `ok` con vacío.

- **T3.3 [P]** — Comprobar que **no** existe adaptador para las cinco tablas de dinero y que
  ninguna métrica financiera declara `acotado` (R25).
  **Hecho:** `alcance-dinero.guardia.test.ts` en verde; el guardia falla si se le inyecta una
  métrica financiera `acotada` de prueba (autocomprobación).

- **T3.4 [P]** — Granos por rol (R37, D4/D5/D6): comprobar que todo rol con la métrica `total` o
  `acotado` puede pedir **todos** los `metrica.granos`, con los tres casos nombrados de la puerta
  (`adminSatelite`+`tienda`, `adminTienda`+`mensajero`, `mensajero`+`tienda`).
  **Hecho:** `alcance-granos.test.ts` en verde y censo = 0 tablas de granos por rol en
  `lib/analytics/**` (el guardia falla si se inyecta una).

- **T3.5** — `lib/analytics/identidad.ts` (D5, R38): `politicaIdentidadMensajero(rol)` —
  `adminTienda` ⇒ `seudonima`, los otros cuatro ⇒ `real`— y `seudonimizarMensajeros(filas, politica)`
  con etiqueta **ordinal por orden de primera aparición**, determinista, sin hash del uuid
  (`design.md §3.6`). La consulta preparada expone la política resuelta.
  **Hecho:** `identidad.test.ts` cubre los cinco roles; dos invocaciones con la misma entrada dan
  las mismas etiquetas; ninguna etiqueta se deriva del uuid (test que cambia el uuid y comprueba que
  la etiqueta **no** cambia si la posición no cambia).

- **T3.6** — Requisito NEGATIVO de identidad (R39): el payload seudonimizado no lleva el id real.
  **Hecho:** el test serializa el resultado completo con `JSON.stringify` y afirma que **ninguno** de
  los uuid de la fixture aparece en la cadena, ni el mapa inverso, ni nombre/teléfono/correo; la
  función **no devuelve** la correspondencia seudónimo → real (no hay forma de pedirla).

---

## T4 · Punto de entrada y garantía estructural (`lib/analytics/consulta.ts`)

*(Depende de: T2, T3.)*

- **T4.1** — `prepararConsultaAnalitica(raw, actor, metricaId, now?)` con el tipo opaco
  `ConsultaAnalitica` marcado por `unique symbol` no exportado (`design.md §3.4`). Orden fijo:
  parsear → rango → alcance.
  **Hecho:** `consulta.test.ts` prueba con espías que el parseo ocurre antes que la resolución de
  alcance y que, si el parseo falla, el resolutor **no se llama** (R19).

- **T4.2** — Tests de tipos de la garantía (R16/R17): un literal casteado a `ConsultaAnalitica`
  **no compila**; una firma simulada que acepte `AnaliticaFiltroInput` en vez del tipo opaco falla
  el `@ts-expect-error`.
  **Hecho:** los dos `@ts-expect-error` son necesarios (quitarlos rompe el typecheck).

- **T4.3** — `alcance-obligatorio.guardia.test.ts` (R18): censo sobre
  `lib/{repositories,services,actions}` de consultas a tablas de analítica sin `ConsultaAnalitica`,
  **con autocomprobación por fixtures** (uno legítimo, dos infractores, incluido un `$queryRaw`).
  **Hecho:** el guardia falla contra los fixtures infractores y pasa contra el legítimo; deja
  escrito en su cabecera que hoy el censo real está vacío porque 126/127 no existen.

- **T4.4** — Determinismo (R32): `now` inyectable, sin `Date.now()` oculto.
  **Hecho:** dos invocaciones con el mismo `now` dan resultado idéntico; censo de `new Date()` sin
  parámetro en el módulo = 0.

- **T4.5** — Contrato de denegado hacia el borde (D7, R41): la unión `PreparacionAnalitica` expone
  `forbidden` con motivo, y el guardia de bordes (fixtures sintéticos, 126/127/134 aún no existen)
  falla si un borde traduce `forbidden` a 200 / lista vacía.
  **Hecho:** el guardia sale rojo contra el fixture «borde que devuelve `{data: []}`» y verde contra
  el fixture «borde que devuelve 403».
  *(Depende de: T4.1.)*

- **T4.6** — Auditoría del denegado (D10, R40): `lib/analytics/auditoria.ts` con `describirDenegado()`
  **puro** (construye `RegistroDenegado`, no emite) + guardia de que el borde llama **explícitamente**
  a `ErrorLogger.logError`.
  **Hecho:** (a) `auditoria.test.ts` afirma los campos exactos del registro y que no contiene
  nombre/teléfono/correo ni contenido de sesión; (b) test de la trampa: `normalizeError(new
  ForbiddenError(), spy)` **no** invoca `spy` (`lib/errors/normalize.ts:22`), documentando por qué no
  vale delegar en `withErrorHandler`; (c) el guardia de bordes sale rojo contra un fixture que solo
  lanza `ForbiddenError`; (d) el módulo puro sigue con 0 llamadas a `console.*` (R34).
  *(Depende de: T4.1. `[P]` con T4.5.)*

---

## T5 · Guardias transversales

*(Depende de: T2–T4.)*

- **T5.1** — Pureza **transitiva** (R35/R36, D8): **ampliar** —no duplicar—
  `tests/unit/analytics/modulo-puro.guardia.test.ts` para que recorra la clausura de imports de
  `lib/analytics/**` hasta punto fijo (con visitados, sin colgarse en ciclos) y aplique a **cada
  arista** las reglas existentes; añadir la `ARISTAS_PERMITIDAS` de una sola entrada
  (`lib/auth/acceso-total.ts → @prisma/client`, solo `RolValue`, con motivo escrito) según
  `design.md §3.8`.
  **Hecho:** (a) el guardia detecta un import transitivo prohibido inyectado a mano; (b) sale rojo si
  la arista permitida importa `PrismaClient`, un default o un namespace; (c) afirma
  `ARISTAS_PERMITIDAS.length === 1`; (d) los cuatro módulos de la 135 más los cinco nuevos se
  importan **sin `DATABASE_URL`** y sin efectos; (e) censo: no existe un segundo guardia de pureza en
  `tests/unit/analytics/`; (f) las 10 suites de la 135 siguen verdes tras tocar su archivo.
  ⚠ Es la **única** escritura autorizada fuera de los archivos nuevos (R33 + D8): commit propio y
  aislado, para que el reviewer lo vea de un vistazo.

- **T5.2 [P]** — Fuente única (R3/R8) y `apiKey` (R11/D9): `{rol : alcance[rol]==="total"}` ≡
  `ROLES_ACCESO_TOTAL` para las 23 métricas; censo repo-wide de segundas tablas de alcance por rol
  = 0; `ROLES_ANALITICA` **no contiene** `apiKey` y ninguna métrica le declara alcance.
  **Hecho:** `alcance-fuente-unica.guardia.test.ts` en verde y con autocomprobación; el guardia sale
  rojo si se inyecta `apiKey` en `ROLES_ANALITICA`.

- **T5.3 [P]** — Columnas (R5/R7): censo de que la zona recortada es `orden.zona_id`, de que
  `lib/analytics/**` no nombra la zona del usuario, y de que **`gestion_orden.mensajeroId` no
  aparece como columna de recorte** en ningún adaptador (D3).
  **Hecho:** `alcance-columnas.guardia.test.ts` en verde; falla si se inyecta un adaptador que use
  `usuario.zonaId` y si se inyecta uno que recorte por `gestion_orden.mensajeroId`.

- **T5.4** — Aislamiento multi-tenant (R26–R29) + matriz exhaustiva (R22): 5 roles × 23 métricas ×
  {sin filtro, propio, ajeno, mixto}, afirmando que el resultado siempre es subconjunto del
  alcance; incluye el caso D9 («mensajero de zona A gestiona orden de zona B») y el cubo
  `MENSAJERO_SIN_ASIGNAR` fuera del alcance del mensajero, **y el caso nombrado «orden reasignada de
  A a B»** de D3 (tras la reasignación B alcanza la fila y la gestión de A; A ya no).
  **Hecho:** `alcance-matriz.test.ts` y `aislamiento.guardia.test.ts` en verde; ningún caso de la
  matriz queda sin aserción (conteo de casos afirmado explícitamente); el test de la reasignación
  lleva en su nombre que es comportamiento **esperado** por D3, no un defecto.

- **T5.5 [P]** — Frontera de la rama (R33): `frontera-122.guardia.test.ts` sobre el diff real
  contra la base `origin/dev @ 79056b24`, patrón `frontera.guardia.test.ts` (incluida la
  distinción «no hay git» vs «hay git y ninguna base resuelve»). La allowlist del guardia incluye
  **exactamente una** excepción heredada: `tests/unit/analytics/modulo-puro.guardia.test.ts` (D8).
  **Hecho:** 0 infractores; el guardia se autocomprueba con rutas prohibidas escritas a mano y sale
  rojo si se le añade una segunda excepción.

---

## T6 · Cierre

- **T6.1** — Trazabilidad fina `R1..R41 → test` (nombre exacto del `it`) en `progress/impl_122.md`.
  **Hecho:** los **41** requisitos tienen test nombrado; ninguno dice «cubierto por» sin `it`
  concreto. Atención especial a los siete nacidos en la puerta (R35–R41).

- **T6.2** — `./init.sh` + suite completa; comparar contra el baseline de T1.1.
  **Hecho:** verde, o delta 0 respecto de los rojos preexistentes de `ux` documentados en T1.1.

- **T6.3** — Avisos dirigidos: propagar `design.md §7` a los `status_note` de 123, 126, 127, 133 y
  134 en `feature_list.json`.
  **Hecho:** las cinco fichas citan `specs/122-analitica-alcance-por-rol/design.md §7`.
  ⚠ `feature_list.json` lo edita el **leader**, no el implementer (el archivo lo comparten varias
  sesiones vivas; ver `progress/history.md`).

- **T6.4** — Corregir el defecto de redacción de la ficha 122: la descripción dice «Depende de
  120» y el `depends_on` real es 135 (`feature_list.json:1394,1400`).
  **Hecho:** anotado en `status_note`; **no** se replica el id viejo en ningún documento nuevo.
