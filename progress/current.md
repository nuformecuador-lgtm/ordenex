# Sesión activa

> Estado vivo de lo que se está trabajando **ahora**. El leader lo mantiene al día.
> Al cerrar una feature se limpia de aquí y se resume en `history.md`.
>
> **Dónde está el historial completo:** los PRs de GitHub, `progress/impl_*.md` / `review_*.md`
> por feature, y la narrativa de decisiones dentro de cada entrada de `feature_list.json`.
> La bitácora extensa que vivía en este archivo se puede recuperar con
> `git show <rev>:progress/current.md`.

> _Reconciliado 2026-07-21._ Se vació la tabla "Features en curso" (las 16 que figuraban estaban
> **todas mergeadas**) y se podaron ~700 líneas de notas de cierre y evaluaciones archivadas. El
> historial completo de features cerradas quedó al día en `history.md` (backfill de las 24 que
> faltaban: 61, 64, 65, 69, 72, 73, 75–78, 81–84, 86–89, 91, 93–97).

## Features en curso

**Componente de filtros parametrizable + su implementación en órdenes — feature 144 (2026-07-28) →
SPEC ESCRITO + GATE F1.4 APROBADO, en reconciliación del spec antes de implementar.** **⚠️ REDEFINIDA por el humano, en dos pasadas.** La ficha decía «`DataTable`:
búsqueda y filtros» (`frontend`/`low`); ese alcance queda **RETIRADO**. Fullstack, `high`,
`depends_on: null`. Rama `feature/144-filtros-ordenes` desde `origin/dev @ 55b0cd4`, en worktree
aislado `../ordenex-wt-144` (el árbol `ux` arrastra WIP ajeno).

- **Son DOS piezas, y el corte entre ellas es lo que decide si la feature envejece bien.**
  **(A)** un **componente de filtros genérico y parametrizable** (el `FilterComponents` del humano) en
  `components/shared/`, **sin dominio**: recibe por props qué filtros monta, de qué tipo es cada uno y
  **los datos/opciones de cada campo**, y emite por `onChange` la lista de filtros seleccionados (ids)
  en forma **agnóstica del consumidor**, para que cualquiera la mande a **cualquier endpoint o action**.
  Es el hermano un nivel arriba de `MultiSelectFilter`: aquel es **un** control, este **orquesta N** y
  es dueño del estado agregado. **(B)** su **única implementación en esta feature**: el listado de
  **órdenes**. La feature **no es específica de órdenes**; órdenes es el primer consumidor.
- **El encadenamiento es la parte que más fácil contamina (A):** provincia → cantón → distrito **no**
  se hardcodea. Se expresa como una **dependencia declarada entre filtros** («B depende de A y así se
  acotan sus opciones»), de modo que el componente nunca sepa qué es una provincia. Criterio de corte
  que se le dio al `spec_author`: **todo `R<n>` de (A) debe poder testearse con filtros de fantasía,
  sin nombrar órdenes, zonas ni distritos**; si necesita nombrarlos, pertenece a (B).

- **Decisión de transporte cerrada por el humano (la que evitaba el spec equivocado):** **no** hay
  endpoint HTTP nuevo **ni** query params en la URL del navegador. Se **extiende el comportamiento
  actual** — la Server Action `listarOrdenes` (`lib/actions/ordenes`) ya recibe `filter.status_id` como
  lista de ids con whitelist server-side, y los cinco filtros nuevos viajan **dentro de ese mismo
  `filter`**, también como ids. Se propuso URL + Server Action y el humano lo descartó: extender, no
  agregar superficie.
- **Hallazgo que forzó esa decisión:** el listado de `/ordenes` **no pasa por HTTP**. `OrdenesModule`
  llama a la Server Action vía SWR con la key `["ordenes:list", statusKey, page, pageSize]`. Un
  `?distrito=…` literal habría exigido cambiar el transporte del listado entero (auth, scoping por rol,
  paginación y sus tests). El listado **ya está paginado en servidor**, así que el filtrado es
  server-side y al cambiar el filtro se vuelve a la página 1 — comportamiento que el filtro de estado
  ya implementa (`statusKeyPrevio`, ajuste durante el render) y que los filtros nuevos deben heredar,
  no reinventar.
- **Estado del filtro en un componente propio y parametrizable:** qué filtros monta y con qué opciones
  se decide **por props**; su `onChange` se dispara **al seleccionar un valor** (no en cada tecleo del
  autocomplete) y emite la lista completa de filtros seleccionados para que el consumidor la inyecte
  en `filter`.
- **Reúso confirmado contra `origin/dev`:** `components/shared/MultiSelectFilter.tsx` ya es exactamente
  el control pedido — botón + panel con **buscador interno**, casilla por opción, `role="listbox"` /
  `role="option"` con `aria-selected`, cierre por clic fuera y `Escape`, controlado y sin dominio.
  No hay que construir el autocomplete: hay que orquestar cinco. `TableFilters.tsx` (inputs de texto
  sueltos, sin consumidores) **no** sirve acá: emite `Record<string,string>`, no ids múltiples.
- **Encadenamiento geográfico en el front:** las opciones se **precargan del backend en una sola
  entrega** y provincia → cantón → distrito se filtra sobre esos datos ya cargados, sin ida y vuelta
  por selección. Fuentes ya existentes: `GeoRepository`/`GeoService` y `ZonaRepository`.
- **Filtro de tienda:** para roles administrativos; las opciones son las cuentas tienda **incluidas las
  integradoras que cargan por API key** (feature 88, `tienda_id = actor.usuarioId`). Un `adminTienda`
  ya ve solo lo suyo por el scoping server-side.
- **Spec escrito:** `specs/144-filtros-ordenes/` — **R1–R20 bloque A** (componente genérico, testeables
  con filtros de fantasía) + **R21–R51 bloque B** (cableado en órdenes), 20 tasks con gate explícito
  A→B, 10 alternativas descartadas. **Migración: sí, una, y solo de índices** (`zona_id`,
  `provincia_id`, `canton_id`, `distrito_id` en `orden`) con su `down.sql`; sin tablas ni columnas
  nuevas, sin RLS nueva.
- **GATE F1.4 APROBADO (2026-07-28), las 14 preguntas cerradas.** Cuatro se apartaron de lo que
  recomendaba el spec y cambian el diseño:
  - **(a) Filtro de tiempo → LAS DOS FORMAS.** Presets **y** rango abierto. El bloque A gana un tipo
    `dateRange`. Bordes CR/UTC calculados **server-side**: `desde` = 06:00 UTC de ese día, `hasta`
    **inclusive** = `< 06:00 UTC del día+1`.
    - **El date-range de shadcn se descartó, y con la dependencia medida:** el humano lo pidió por
      nombre, pero traerlo arrastra `react-day-picker` **y** `@radix-ui/react-popover`. Verificado dos
      veces (`spec_author` y leader, contra `package.json` y `components/ui/`): el repo corre **solo**
      sobre `@base-ui/react ^1.6.0`, sin Radix, sin `react-day-picker`, sin `date-fns`, y **no existen**
      `calendar`/`popover`/`command`. Copiar shadcn dejaría **dos librerías de primitivas conviviendo**
      (foco, portales y accesibilidad duplicados). **Decisión del humano: dos `<Input type="date">`,
      cero dependencias nuevas**, alineado con `wallet/_components/WalletFiltros.tsx`, que ya resuelve
      un desde/hasta exactamente así (el patrón ya vive en 6 componentes).
    - **Preset y rango son MUTUAMENTE EXCLUYENTES en la UI** (decisión del humano; el spec había
      propuesto «gana el rango»): elegir uno **vacía** el otro, así que el estado inválido nunca llega
      a existir y no hay precedencia que documentar ni `validation_error` que lanzar.
  - **(c) Precargado → `Promise.all` al cargar la página**, no la Server Action + SWR que recomendaba
    el spec. Los ~70 KB en el RSC payload de cada carga de `/ordenes` son **coste aceptado a
    sabiendas**; queda margen para adelgazarlo enviando el catálogo con los campos mínimos.
  - **(h) Cuentas apiKey → SEPARADAS POR GRUPO**, no mezcladas. Ojo: `MultiSelectFilter` es propio del
    repo (no shadcn; se hizo con panel propio porque no hay `Popover`/`Command` en `components/ui/`),
    así que el agrupado se diseña en el contrato de opciones de A (`group?`), no se importa.
  - **(i) Limpiar → las dos:** «Limpiar todo» **y** limpiar individual por filtro.
  - Las otras diez van por la recomendación del spec: **(b)** `orden.zona_id`; **(d)** todas las
    tiendas; **(e)** incluidas las inactivas, marcadas; **(f)** las órdenes con `distrito_id` NULL
    quedan fuera y sin opción «sin distrito» (el humano afirma que **no deberían existir** — eso es
    una afirmación sobre los datos **a verificar**, anotada como riesgo, no un supuesto);
    **(g)** la selección se pierde al recargar, como ya pasa con el filtro de estado; **(j)** estado
    no controlado; **(k)** v1 con `multi`, `single` y `dateRange`; **(l)** salida
    `Record<string, string[]>` con claves vacías omitidas — el borde a vigilar es el `dateRange`, el
    único cuyos valores **no son ids de catálogo**; **(m)** un solo padre por filtro;
    **(n)** `components/shared/`, excepción explícita a la regla de las dos superficies de
    `docs/architecture.md` con la 145 como segundo consumidor declarado.
- **⚠️ La 145 hay que revalidarla, aunque ya no queda huérfana.** «Rollout de búsqueda/filtros/export a
  las 31 tablas» adopta *la capacidad de la 144*; con la 2.ª redefinición esa capacidad **vuelve a
  existir** en la pieza (A) — pero **solo la parte de filtros**. La **búsqueda global** y el **export**
  que la 145 da por sentados **siguen sin dueño**: la búsqueda no está en el alcance de la 144 y el
  export vive en la 151 (server-side). Su `depends_on: 144` se mantiene; falta decidir con el humano
  quién entrega la búsqueda. Anotado también en su ficha de `feature_list.json`.
- **Bookkeeping en la rama** (ficha 144 redefinida + nota en la 145 + este bloque), no como estado
  volátil en `ux` — lección de la 142.
**Tamaño de hoja seleccionable en las etiquetas — feature 150 (2026-07-28) → IMPLEMENTADA + reviewer
APROBADO (0 bloqueantes, 4 menores), `PR #179` → `dev` (falta merge humano).** Fullstack, `medium`,
`depends_on: null`. Spec en `specs/150-tamano-hoja-etiquetas/` (**R1–R21**, 11 tasks, 3 con `[P]`). Rama
`feature/150-tamano-hoja-etiquetas` desde `origin/dev @ 55b0cd4`, en worktree aislado `../ordenex-wt-150`.
Gate F1.4 aprobado por el humano con las 5 decisiones del spec tal cual.

> **La bitácora completa de la feature (cifras medidas, mutaciones, desvíos y notas menores) viaja
> commiteada en el PR #179**, en la copia de `progress/current.md` de la rama — no aquí, para que no sea
> estado volátil del árbol `ux` (lección de la 142). **Delta medido: +41 tests, 0 rotos**
> (baseline 518/5308 → 522/5349), typecheck 0, lint 0 errores, `./init.sh` verde, 21/21 R con test real.
> **Buena noticia colateral:** el typecheck de `dev` volvió a verde en `55b0cd4` (PR #175) — la deuda que
> figuraba abajo como «`typecheck` roto en `dev` desde el merge de `ux`» está **saldada**.

- **Decisiones cerradas PRE-SPEC (AskUserQuestion):** **D1** en hojas grandes, **una etiqueta por página
  escalada** — NO mosaico/N-up; **D2** el tamaño se elige **en cada descarga**, default 100x100 mm, **sin
  persistencia** (ni `localStorage` ni DB); **D3** alcance = **solo el generador de cliente**. El
  server-side `lib/pdf/etiquetas-pdf-lote.ts` (feature 136, PDF consolidado de la carga por API key)
  **queda en 100x100 mm y fuera de alcance** → la feature **no tiene backend, ni migración, ni `down.sql`,
  ni RLS**, y **no toca el contrato público de integradores** (feature 88). D3 nació de un matiz que la
  ficha no contemplaba: ese PDF lo genera el servidor solo, **sin humano delante**, así que un selector
  ahí habría exigido preferencia persistida en Configuración > API (migración + UI) o un campo nuevo en
  el payload público. El humano eligió no pagar ninguna de las dos.
- **Riesgo aceptado por D3:** los dos generadores quedan **divergentes** — el de cliente parametrizable,
  el de servidor fijo en 100x100. El spec lo blinda con un test de **no-regresión** sobre el builder de
  lote (T3) para que la divergencia sea deliberada y no un olvido.
- **Las 5 decisiones que tomó el propio spec** (§9 declaró **ninguna abierta**; el humano las **ratificó
  todas tal cual** en la puerta F1.4): (1) el catálogo vive en **`lib/config/etiquetas-hoja.ts`**, NO en `lib/config/etiquetas.ts`
  como decía la ficha — ese archivo es config server-side por `process.env` (feature 136) y un componente
  cliente no puede importarlo sin arrastrarla; (2) escalado por **factor único `s = lado_menor / 100`**
  con centrado en ambos ejes, que preserva la relación de aspecto cuadrada en hojas alargadas;
  (3) **carta = 215.9 × 279.4 mm** exactos, no el `216 × 279` redondeado de la ficha; (4) el nombre del
  archivo descargado lleva **sufijo del tamaño** (única de las cinco que reescribe un requisito, R19, si
  el humano discrepa); (5) el ráster del código de barras se escala **hacia arriba** y el QR de la vista
  previa se queda intacto en 512 px.
- **Superficie verificada:** `SIZE_MM = 100` / `MARGIN = 6` hardcodeados en
  `app/(app)/ordenes/_components/etiquetas-pdf.ts`; el selector va en `EtiquetasGuiaModal.tsx`.
  Tests que roza: `EtiquetasGuiaModal.test.tsx`, `OrdenesListadoEtiquetasChain.test.tsx`.
  Precedente que se revisa: la decisión F1.4 (c) de la feature 32 fue la que fijó los 100x100 cuadrados.

**Deshacer asignación a mensajero o bodega antes de la recogida — feature 149 (2026-07-28) →
gate F1.4 APROBADO, EN IMPLEMENTACIÓN.** Fullstack, `high`, `depends_on: null`. Spec en
`specs/149-deshacer-asignacion/` (**R1–R41**, 33 tasks en 7 bloques). Rama
`feature/149-deshacer-asignacion` desde `origin/dev @ 55b0cd4`, en worktree aislado
`../ordenex-wt-149`. Backend (F0–F5) y UI (F6 salvo T6.3) hechos; T6.3 devuelta al `backend_dev`.

> ### ✅ `dev` YA NO está en rojo — MEDIDO en worktree limpio de `origin/dev @ 55b0cd4`
>
> `pnpm typecheck` **0 errores** y `pnpm test` **518 archivos / 5308 tests, 0 fallos**. El **PR #175**
> (`fix/tests-rediseno-ux`) saldó la deuda que arrastraba `dev`: los 2 errores TS2741 por la prop
> `count` de `GestionarOrdenPanelProps` y los 14 tests rojos del rework de `mis-asignaciones`/
> `DataTable`. **Las notas de la 142/143/148 que dan `dev` por rojo quedaron obsoletas.**
> Ojo: el script de la suite es `pnpm test` — **`test:run` no existe** en `package.json`.

- **Decisiones cerradas PRE-SPEC (AskUserQuestion):** **D1 roles** = `maestro`/`admin` (`esAccesoTotal`)
  sobre cualquier orden + `adminSatelite` **acotado a SU zona** (patrón de `AsignacionSateliteService`);
  **D2** el `num_guia` se **CONSERVA** intacto (ya impreso en etiquetas, `generarGuiaLote` es idempotente
  sobre él); **D3** el estado destino se **DERIVA del historial** (último `estatus_origen`), no de una
  regla de zona, y **falla CERRADO** si no hay fila; **D4 motivo OBLIGATORIO** en texto libre, persistido
  en la bitácora (columna `motivo` que ya expone `OrdenHistorialEntradaDTO`); **D5** valor de enum
  **NUEVO** `deshacer_asignacion` en `orden_historial_origen_tipo` → migración `ALTER TYPE ADD VALUE`
  + `down.sql`, patrón `cancelacion_api` (106).
- **Por qué D3 y no la regla de zona:** una orden en `por_recoger` pudo llegar desde `en_bodega_central`
  (#8), `en_bodega_satelite` (#9) **o** `en_fulfillment`/`en_preparacion` (#1/#4); una en
  `en_ruta_bodega_satelite`, desde `en_bodega_central` (#7) o `en_fulfillment`/`en_preparacion`
  (#6/#7b/#7c). **D3' del spec:** esos dos orígenes pre-guía **sí se soportan pero se normalizan a
  `en_bodega_central`** (con guardas de coherencia zona↔destino) — nunca se vuelve a un estado pre-guía,
  porque eso reabriría «Generar guía» sobre una orden ya etiquetada y con `num_guia`.
- **⚠️ Toca la guardia central de la 140 — 3 aristas nuevas**, todas `via: "deshacer_asignacion"`:
  **#43** `por_recoger → en_bodega_central`, **#44** `por_recoger → en_bodega_satelite`, **#45**
  `en_ruta_bodega_satelite → en_bodega_central`. Recuento del inventario: **43 → 46 aristas, 39 → 42
  pares**. **Rompe a propósito** `guardia.test.ts:30-34` (conteo) y `:51` (que consagraba
  `por_recoger → en_bodega_satelite` como **ilegal**); el invariante de conectividad NO rompe.
- **Migración:** `db/migrations/20260728120000_orden_historial_origen_deshacer_asignacion/` — up con
  `ALTER TYPE ... ADD VALUE IF NOT EXISTS` **sola en su transacción** (55P04); down por recreación del
  enum con los 22 valores previos + `ALTER COLUMN ... USING`. Suma el valor a
  `ORDEN_HISTORIAL_ORIGEN_TIPO_SEED` (el `satisfies` rompería el build si no) y **queda fuera** de
  `ORIGEN_TIPOS_CON_GESTION` (destino ≠ `devuelta` y nunca enlaza gestión → no altera `contarIntentos`).
- **7 decisiones abiertas del gate F1.4** en `design.md §8`, pendientes del humano: Q1 bloquear o no por
  cierre pendiente del mensajero; Q2 qué hacer con `prioridad` (los writers la apagan al asignar y el
  flag no se historifica); Q3 desempate del historial (UUID v4 no es cronológico); Q4 tope de lote;
  Q5 avisar al mensajero desasignado; Q6 confirmar que no hace falta marca de «ya revertida»;
  Q7 si el webhook debe distinguirse de la liberación por SLA (mismo destino).

**Manifiesto Excel al crear o mover órdenes — feature 148 (2026-07-28) → IMPLEMENTADA + reviewer
APROBADO-CON-NOTAS (0 bloqueantes), `PR #178` → `dev` (falta merge humano).** El registro completo
—con el cambio de UX, las 10 mutaciones del review, los números medidos y la deuda viva— viaja
commiteado en la propia rama; acá queda el resumen. Fullstack, `high`, `depends_on: null`. Spec en
`specs/148-manifiesto-excel-lotes/` (**R1–R30**, 22 tasks, 12 con `[P]`). Sin rama todavía: la Fase 2
va a worktree aislado desde `origin/dev` (el árbol `ux` arrastra WIP ajeno y typecheck en rojo).

- **Decisiones cerradas PRE-SPEC (AskUserQuestion):** **D1** generación en **CLIENTE** sobre el
  resultado de la acción (`exceljs` con import dinámico + Blob/anchor, patrón de las features 31/32/143)
  — sin Storage, sin bucket nuevo, **asumiendo explícitamente que el manifiesto NO es reimprimible**;
  **D2** alcance = **los 5 puntos de enganche** en esta misma feature; **D3** **sin modelo nuevo en DB**
  (sin migración, sin `down.sql`, sin RLS) y **sin** reusar `carga.download_url` de la 141 (su PR #168
  sigue sin mergear, y la dependencia bloquearía la 148).
- **Hallazgo estructural del spec (D4, lo que evita tocar 5 servicios de negocio):** **ningún flujo
  devuelve hoy las 11 columnas** del manifiesto — la carga masiva ni siquiera trae `ordenId`, y **dos
  de los cinco no tienen lote en el service**: `EnvioDevolucionCentralService.enviarACentral` y
  `DevolucionOrigenService.devolverATienda` son **por orden**, el lote lo hace la UI en un loop
  (`RecepcionSateliteModule.tsx:345-365`, `DevolverATiendaModal.tsx:49-52`). Solución: el manifiesto se
  arma con una **Server Action de LECTURA aparte** (`obtenerManifiesto`, unión discriminada `ordenIds`
  vs `numRemisiones`) en vez de ampliar los 5 retornos → los services de negocio quedan **intactos**
  (R27). Precedente idéntico en el repo: `generarEtiquetas({ ordenIds })`.
- **Módulos nuevos:** `lib/types/manifiesto.ts`, `IManifiestoService` + `ManifiestoService`,
  `lib/actions/manifiesto.ts`, `lib/utils/manifiesto-xlsx.ts`, `components/shared/descargar-blob.ts` y
  `DescargarManifiestoButton.tsx` (reusado por los 5 flujos). Modificados: `xlsx-template.ts`,
  `IOrdenRepository`/`OrdenRepository`.
- **⚠️ Conflicto de merge previsible con la 143:** ambas agregan `buildXlsxRows` + `XLSX_MIME` a
  `lib/utils/xlsx-template.ts`. Hoy ese archivo solo exporta `XlsxTemplateField` y `buildXlsxTemplate`;
  el MIME es constante privada en `components/shared/BulkUpload.tsx:102`.
- **Gate F1.4 APROBADO (2026-07-28)** con **las 8 propuestas del spec tal cual** (registradas en
  `design.md §9`): (1) enganche al **lote de la UI sin tocar los services** — R27 intacto, sin
  métodos de lote nuevos en el dominio; (2) bodega central = `zona.nombre` de la zona `esCentral`,
  con **literal de respaldo `"Bodega central"`** si no hay ninguna configurada (la descarga nunca
  falla por un dato de catálogo); (3) `monto` = `monto_cobrar` (COD, no flete+IVA); (4) `telefono` =
  del destinatario; (5) `fecha` = de la **operación** (calendario CR), no `created_at`; (6) carga
  masiva = **archivo completo**, no chunk por chunk; (7) **fase "resultado" con botón explícito** en
  los 4 modales (hoy cierran al confirmar) — sin descarga automática ni acción en el toast, único
  cambio de UX no trivial; (8) `responsable` = mensajero asignado si lo hay, si no el **nombre del
  usuario que ejecutó**; se conservan las 11 columnas.
- **Fase 2 en curso** en `../ordenex-wt-148` (rama `feature/148-manifiesto-excel-lotes` desde
  `origin/dev` @ `55b0cd4`, `.env` copiado y cliente Prisma generado). Orquestación directa
  `backend_dev` → `frontend_dev` → `reviewer` con `model: opus` (precedente 121/142). Reparto:
  backend T1–T6 + T15/T16/T18; frontend T7–T14 + T17/T19/T20/T21.
- **Baseline propio medido en el worktree ANTES de tocar nada** (regla: los números de la bitácora
  caducan): `origin/dev` @ `55b0cd4` → **typecheck 0 errores, 518 archivos / 5308 tests, 0 fallos**.
  Verde de punta a punta, así que el delta 0 de esta feature se mide contra eso.

### Campana de notificaciones — feature 146 (2026-07-27) → IMPLEMENTADA + reviewer **APROBADO-CON-NOTAS** (0 bloqueantes), **PR #176** → `dev` (falta merge humano)

Fullstack, high, `depends_on: null`. Ciclo SDD completo en worktree aislado `../ordenex-wt-146`
(rama `feature/146-campana-notificaciones` desde `origin/dev` @ `56ff0aa`), 16 commits.
Spec en `specs/146-campana-notificaciones/` (R1–R50, 24 tasks).

- **Decisiones cerradas pre-spec (AskUserQuestion):** los 4 eventos que notifican (rechazo, carga
  masiva terminada, postulación pendiente, cierre por aprobar); refresco por **polling SWR**, no
  Realtime; direccionamiento **por rol con lectura por usuario**.
- **⚠️ El humano OMITIÓ el aviso de "órdenes con más de 1 día sin asignación"**, que era el único
  que exigía barrido periódico → **cayeron el cron, el `JobTipo` y el env de umbral** que la ficha
  original daba por hechos. La respuesta sobre el reloj del umbral ("desde la creación") quedó
  archivada por si ese aviso se retoma como feature aparte.
- **Gate F1.4 APROBADO** con 4 decisiones más, una de ellas resolviendo una **contradicción** en las
  respuestas del humano (pidió que el rechazo llegara al `adminSatelite` y a la vez excluirlo del
  v1 → desempató por incluir ambos): rechazo → maestro + admin + `adminTienda` dueño +
  `adminSatelite` de la zona, lo que obligó a **dos columnas de alcance** (`tienda_id`, `zona_id`);
  productor de rechazo **transaccional**; carga masiva por UI vía Server Action explícita de
  "carga terminada". Otras 5 menores las cerró el leader (una fila por rol, ventana de 30 días sin
  purga, dedupe por `(evento, entidad_id)`, `PAGE_SIZE=50` / 60 s, `NotificationItem` como alias).
- **Modelo:** `notificacion` + `notificacion_lectura` (estado leída/descartada POR usuario), RLS
  habilitada **sin policies** (patrón del repo: sesión propia, sin `auth.uid()`), toda la
  autorización en un único `predicadoVisibilidad(actor)` compartido por las 5 acciones.
  `Actor` gana `zonaId` (aditivo). Migración `20260727120000_notificacion` (up + down).
- **Corrección bloqueante que atajó el leader:** la 1.ª entrega del backend metía
  `if (enTest()) return` en producción — el mismo anti-patrón de guardia-apagada-bajo-test que hizo
  rechazar la feature 140. Recableado: el default de los services es un **no-op** y el real se
  inyecta en los composition roots; hay un test de barrido que falla si alguien reintroduce un
  apagado por entorno. El reviewer confirmó un **4.º** sitio que construye `BulkOrdenService`
  (`app/api/ordenes/carga-masiva/chunk/route.ts`) y se queda con el no-op: es correcto, esa ruta no
  sabe cuál es el último chunk.
- **Guardia ajena editada (aprobada por el leader):** `tests/integration/db/no-migration-102.test.ts`
  afirmaba que el esquema no tiene NINGUNA infra de notificaciones. Ese R17 acotaba a la 102, no
  prohibía el concepto para siempre; la edición pasa a una allowlist de una entrada (más estricta
  que borrar los conceptos) y deja intactos los invariantes propios de la 102.
- **Verificación:** typecheck **2 errores, los 2 preexistentes de `dev`** (prop `count` en
  `GestionarOrdenPanelEvidencias.test.tsx:84` y `NotaPrivadaMensajero.test.tsx:253`) → **delta 0**;
  lint 0 errores; suite 528 archivos / 5426 tests con los mismos rojos ajenos → delta 0; los 14
  archivos de la feature en aislado **213/213**. `./init.sh` queda rojo **solo** por esos 2 errores
  heredados. Detalle en `progress/impl_146_backend.md`, `impl_146_frontend.md`, `review_146.md`.
- **⚠️ Al desplegar:** `prisma migrate deploy` para `20260727120000_notificacion` (aditiva, 2 tablas
  + 3 enums). **No se aplicó** desde el agente (el `.env` apunta a la base compartida con prod) y el
  `down.sql` se revisó por lectura, **sin round-trip real**.
- **Deudas conocidas:** sin purga (los 30 días son solo ventana de consulta); sin paginación
  (`PAGE_SIZE=50` trunca en silencio); `marcarNotificacionLeida` sin control por elemento en la UI
  (solo "marcar todas" o descartar); la campana arranca vacía en cada página y cada una abre su
  propio polling.

**Descargar en Excel las filas con error de la carga masiva — feature 143 (2026-07-27) → IMPLEMENTADA
+ reviewer APROBADO (0 bloqueantes), `PR #177` → `dev` (falta merge humano).** Frontend, `medium`,
`depends_on: 142` (**satisfecha**: la 142 se mergeó a `dev` en `c3e6954`, PR #174). Rama
`feature/143-descargar-errores-carga-masiva` desde `origin/dev @ c3e6954`, en worktree aislado
`../ordenex-wt-143` (el árbol `ux` sigue arrastrando WIP ajeno y typecheck en rojo).
Spec en `specs/143-descargar-errores-carga-masiva/` (**R1–R22**, 15 tasks). El bookkeeping viaja
commiteado en el PR (no se queda como estado volátil en `ux`, lección de la 142).

- **Decisiones cerradas PRE-SPEC (AskUserQuestion):** (a) el motivo del error viaja en una **columna
  extra `motivo_error`** al final (tras `notas`), una sola hoja — NO hoja aparte; (b) las celdas llevan
  los **valores CRUDOS** del archivo original (`FilaParseada.row`), no los normalizados, para que el
  usuario reconozca su fila tal como la escribió.
- **El ABIERTO del backlog quedó desactivado, pero por diseño permisivo, no por contrato.** El item
  advertía que "una columna extra rompe el round-trip". Verificado que NO: `findMissingHeaders`
  (`lib/types/carga-masiva.ts`) solo comprueba **presencia** de `REQUIRED_HEADERS` sin lista blanca,
  ambos parsers (navegador y `lib/parsers/spreadsheet.ts`) indexan **por nombre de cabecera** y no por
  posición, y `filaCargaSchema` es un `z.object` **sin `.strict()`** → zod descarta `motivo_error` en
  silencio. Como hoy funciona por accidente afortunado, se **fijó con R14/R15/R16 + test de round-trip
  + comentarios-ancla en el schema**, para que un futuro `.strict()` rompa un test y no la feature en
  producción.
- **Hallazgo del spec (el que evita un export desalineado en silencio):** el cruce `fila` ↔ `linea`
  solo es válido porque `procesarEnChunks` **remapea** la fila del lote a la línea original
  (`carga-masiva-chunks.ts:99`, `fila: lote[i]?.linea ?? rr.fila`). Sin ese remapeo el archivo saldría
  con los datos de otras filas y el usuario corregiría la fila equivocada. Blindado con test dedicado.
- **Colocación del botón:** `OrdenesCargaPreview` es la **única superficie viva** que lista errores —
  `OrdenesCargaResumenPaso` está definido y testeado pero **no lo importa nadie**. El único dueño de la
  clasificación + las `FilaParseada` es `OrdenesCargaMasivaButton`, así que bastó una prop (`filas`).
- **Gate F1.4 APROBADO (2026-07-27):** (1) alcance **solo vista previa** — los errores de la carga real
  post-confirmación (paso `asignacion`, hoy solo un toast) quedan fuera de alcance explícito (R20);
  (2) el `motivo_error` lleva **prefijo de línea** (`Fila 7 — telefono: debe tener 8 dígitos`), una sola
  vez aunque haya varios campos, y **sin prefijo** cuando no hay línea conocida — no se inventa número
  (R22); (3) **sin CSV** (R21), decidido por el leader con el default: solo xlsx.
- **Sin backend nuevo, sin migración, sin endpoint.** Descarga cliente puro (Blob + anchor). Módulos
  nuevos: `carga-masiva-errores-formato.ts`, `carga-masiva-export-errores.ts` y `buildXlsxRows` +
  `XLSX_MIME` en `lib/utils/xlsx-template.ts` (`buildXlsxTemplate` intacto). `exceljs` sigue entrando
  **solo** por import dinámico dentro de `buildXlsxRows`, con test que lo blinda desde el componente.
- **Review por MUTACIÓN, no por lectura** (lo que da confianza real en el mapa R1–R22): `.strict()` en
  `filaCargaSchema` mata 2 tests; lista blanca en `findMissingHeaders` mata los 2 de R14; quitar el
  remapeo de `chunks` mata el test del cruce; sufijo `" *"` en la cabecera mata 9; un prefijo
  `Fila ${fila ?? 0}` inventado mata los 2 de R22. **0 bloqueantes, 8 menores**; se cerraron los 3
  accionables (casillas de `tasks.md`; el round-trip del navegador pasó a usar `parseArchivo` real en
  vez de reimplementar la lectura de celdas; fuera el import dinámico redundante). Los 5 restantes son
  deuda preexistente de `dev` (typecheck en rojo, sin E2E de ingesta) o verificación fuera de alcance.
- **⚠️ T13 (paseo manual en Excel/Sheets) NO se ejecutó** — queda para la puerta de aceptación humana.
  Se sustituyó por verificación ejecutable en `tests/integration/carga-masiva-errores-roundtrip.test.ts`,
  que genera el `.xlsx` real y lo re-parsea con **ambos** parsers.
- **Baseline de `dev` medido en worktree limpio ANTES de implementar** (no es de esta feature):
  `pnpm typecheck` 2 errores (`count` en `GestionarOrdenPanelProps`), `pnpm test` 14 fallando / 5294
  pasando en `DataTable`, `LoginForm`, `MarcarLuegoToggle`, `MisAsignacionesModule`,
  `NotaPrivadaMensajero`. **Delta 0** verificado por implementer y reviewer por separado.
- **Delta 0** verificado por implementer y reviewer por separado: **+47 tests nuevos**, `pnpm lint` 0 errores.

**Plantilla de carga masiva v2 — feature 142 (2026-07-27) → IMPLEMENTADA + reviewer APROBADO
(0 bloqueantes), `PR #174` → `dev` (falta merge humano).** Pedido del humano:
rehacer la plantilla de carga masiva de órdenes con (1) un orden de columnas nuevo — `destinatario`,
`telefono`, `direccion_destinatario`, `monto_cobrar`, `producto`, `num_remision`, `peso`, `notas` — y
(2) las 4 columnas `provincia`/`canton`/`distrito`/`direccion` **reemplazadas por una sola**,
`direccion_destinatario`, con formato `'País / Provincia / Cantón (Distrito) / Dirección literal'`.
Fullstack, `high`, `depends_on: null`. Rama `feature/142-plantilla-carga-masiva-v2` desde `origin/dev`
@ `97f6e91`, en worktree aislado `../ordenex-wt-142` (el árbol `ux` arrastra WIP ajeno y su typecheck
está en rojo por `count` en `GestionarOrdenPanelProps`).

- **Decisiones cerradas PRE-SPEC (AskUserQuestion):** (a) **CORTE DURO** — no hay modo compatibilidad
  con la plantilla vieja de 4 columnas; un archivo viejo falla en `findMissingHeaders` con un mensaje
  que apunta a descargar la plantilla nueva. Un solo camino de código, sin deuda de retiro.
  (b) **DISTRITO OBLIGATORIO** — sin el paréntesis del distrito la fila es `fieldError` en
  `direccion_destinatario` y no se crea, porque `zona_id` se deriva del distrito y decide tarifa y ruteo.
- **Superficie confirmada contra `origin/dev`:** `ORDENES_BULK_FIELDS`
  (`app/(app)/ordenes/_components/carga-masiva-fields.ts`, hoy 11 campos con las 4 geográficas),
  `REQUIRED_HEADERS` + `filaCargaSchema` (`lib/types/carga-masiva.ts`, hoy exige
  `num_remision`/`destinatario`/`telefono`/`provincia`/`canton` en cabecera),
  `carga-masiva-parser.ts`, `carga-masiva-chunks.ts` y `resolverGeografia` de `BulkOrdenService`
  (sigue resolviendo provincia→cantón→distrito por nombre contra el catálogo). **Sin migración.**
  Ojo al round-trip: `tests/integration/carga-masiva-plantilla-roundtrip.test.ts` genera la plantilla
  y la vuelve a parsear — el corte duro lo toca de lleno.
- **Renumeración 141–149 → 142–150 aterrizando en esta rama:** la traía el árbol de trabajo de `ux`
  **sin commitear** (`dev` sigue con los ids viejos del PR #170). Viaja commiteada en este PR para que
  deje de ser estado volátil. `141` conserva `tabla carga + carga_id en orden` (PR #168).
- **Orquestación:** feature `fullstack` que NO se parte en dos — `lib/types/carga-masiva.ts` y el
  parser son el mismo contrato compartido por cliente y servidor, y partirlo serializaría un cambio
  atómico. Se aplica el precedente de la 121: directo `spec_author` → `backend_dev` → `frontend_dev`
  → `reviewer` con `model: opus`, sin el `implementer` monolítico.
- **Gate F1.4 APROBADO (2026-07-27)** con las 6 propuestas del spec tal cual: (1) texto tras el `)`
  del distrito → error de fila; (2) dirección literal vacía → se acepta (`null`); (3) copy literal del
  corte duro; (4) ejemplo canónico sustituible si el guard del seed lo rechaza; (5) columna `peso`
  fuera de alcance; (6) no hay doc pública de la plantilla que actualizar.
- **Hallazgo estructural del spec (lo que salvó el contrato público):** `filaCargaSchema`/`resolveFila`
  los comparte `cargarViaApi` (feature 88, **API key de integradores**, con `provincia`/`canton`/
  `distrito` SEPARADOS). Meter el parser en `filaCargaSchema` habría roto ese contrato en silencio.
  Solución: **extractor de geografía inyectado por vía** (`geoInputDesdeDireccionUnificada` para la UI,
  `geoInputDesdeColumnasSeparadas` para la API) con `resolveGeo` **sin tocar una línea**.
- **Implementada** en el worktree `../ordenex-wt-142` (`backend_dev` B1–B8 → `frontend_dev` F1–F4 +
  C1–C2 + T2 → `reviewer`, todos `model: opus`, 8 commits). Parser puro nuevo en
  `lib/utils/direccion-destinatario.ts`. **Sin migración**, sin cambios en `db/`, un solo `.tsx` tocado.
- **⚠️ El ejemplo canónico de la plantilla se SUSTITUYÓ:** `Cartago / Jimenez (Juan Vinas)` existe en
  `public/geografia-cr-completa.xlsx` pero **no recibe zona** al cruzarlo con
  `public/mapa-geografico-costa-rica.xlsx` → la fila de ejemplo habría fallado con «distrito sin zona».
  Quedó `Costa Rica / Cartago / Cartago (Occidental) / Frente gasolinera JSM, 200m sur` (zona GAM).
  El guard `tests/unit/scripts/carga-masiva-ejemplos-geo.test.ts` **no se relajó** — hizo su trabajo.
  Deuda de datos preexistente detrás: solo **198 ternas** del catálogo reciben zona en el seed.
- **Reviewer APROBADO, 0 bloqueantes** (7 notas menores). No se fio de los números: corrida propia
  con **typecheck 0**, **lint 0 errores / 144 warnings**, **517 archivos / 5280 tests, 0 fallos**,
  `./init.sh` verde. Además **prueba de mutación** (rompiendo R19 y R22 caen 5 tests en 2 archivos →
  los tests son sensibles, no decorativos) y **fuzz de 50.000 entradas** contra el parser → 0
  excepciones y 0 aceptaciones con geografía vacía. Verificó que **falla cerrado**: con el parser
  mutado devolviendo distrito vacío, la fila igual sale a error por `resolveGeo`; `zona_id` nunca
  queda nulo. Detalle en `progress/impl_142_backend.md`, `impl_142-plantilla-carga-masiva-v2.md`
  y `review_142.md` (viajan en la rama).
- **Notas menores diferidas:** falta un test extremo a extremo cliente→ruta chunk→service con la
  columna nueva; el mensaje de «paréntesis no cerrado» confunde cuando hay una `/` dentro del
  paréntesis; R32 se apoya en la genericidad de los chips sin caso propio.
- **Renumeración 141–149 → 142–150 commiteada por fin en esta rama** (venía suelta en el árbol de `ux`).
- **Aviso a otras sesiones:** el corte es duro. Cualquier archivo de carga masiva con las 4 columnas
  viejas deja de funcionar al mergear; hay que redescargar la plantilla.
- **Sincronizado con `dev` @ `56ff0aa`** (merge `c08f60b`). Conflicto único en `feature_list.json`:
  `dev` **ya había hecho la misma renumeración** por su cuenta y además refinó la 144/145 (el export
  a Excel salió de la 144 y pasó a **server-side en una feature 151** nueva; la 145 pasó a `fullstack`).
  Se resolvió conservando **la 142 nuestra** y **la versión de `dev` para 144/145**, que estaba más al día.

> ### ✅ SALDADA (2026-07-28) — `dev` volvió a verde. Lo de abajo queda como histórico.
>
> Lo arregló el **PR #175** (`fix/tests-rediseno-ux`, merge `55b0cd4`), que entró después de la 142.
> **Medido, no supuesto**, en el worktree limpio `../ordenex-wt-144` sobre `origin/dev @ 55b0cd4` y con
> `pnpm db:generate` corrido antes de medir (un worktree nuevo no trae cliente de Prisma y sin él el
> typecheck escupe ~30 falsos `TS2305` de `@prisma/client`): **`./init.sh` VERDE de punta a punta** —
> typecheck **0 errores**, lint **0 errores / 145 warnings**, **518 archivos / 5308 tests, 0 fallos**,
> todas las migraciones con `down.sql`. Ese es el **baseline de la 144**: cualquier rojo que aparezca
> durante su implementación es suyo, no heredado.
>
> <details><summary>Histórico: el diagnóstico de cuando estaba en rojo</summary>
>

> Tras el merge quedan **2 errores de typecheck** (`count` falta en `GestionarOrdenPanelProps`, en
> `GestionarOrdenPanelEvidencias.test.tsx` y `NotaPrivadaMensajero.test.tsx`) y **14 tests rojos** en
> 4 archivos: `DataTable.test.tsx` (2), `MarcarLuegoToggle.test.tsx` (2), `MisAsignacionesModule.test.tsx`
> (9), `NotaPrivadaMensajero.test.tsx` (1).
>
> Se levantó un **worktree limpio de `origin/dev` @ `56ff0aa`** y se corrieron ahí: **los mismos 2
> errores y los mismos 14 tests fallan sin la 142**. Delta de la feature = **0**; ninguno de esos 4
> archivos aparece en su diff. Es deuda del **rework de `mis-asignaciones`/`pos-card` + `DataTable`**
> que entró a `dev`. **Alguien tiene que saldarla**: hoy `./init.sh` no puede pasar en `dev` ni en
> ninguna rama que salga de él, así que el arnés está sin red para todas las features en vuelo.
>
> Corolario para la 141 (`../ordenex-wt-141`, PR #168 abierto): en `dev` solo aterrizó su **spec**;
> la migración `20260727120000_carga_orden_carga_id` y su código **NO** están en `dev` todavía.
> Por eso sigue legítimamente `in_progress`.
>
> </details>

### Lote 137–140 (flujo de estados) — ✅ **COMPLETO, 4/4 MERGEADAS a `dev`** (2026-07-25)

> Detalle de las 4 en `history.md`. PRs #157 (137) · #159 (138) · #160 (139) · #161 (140).
> **✅ DESPLEGADO A PROD 2026-07-25 (PR #163 `dev → prod`).** Deployment `ordenex-qzzgvlmhq` **Ready**;
> build verde en 29 s; runtime sin errores (cron `/api/cron/procesar-jobs` cada minuto, 200).
> **Migraciones APLICADAS** en la base de producción: el build corrió `prisma migrate deploy` y reportó
> `No pending migrations to apply` sobre **86 migraciones** = las 86 del repo (incluidas las 4 del lote).
> Deuda de migraciones **saldada**; también aplicadas y verificadas en la DB local.
>
> ⚠️ **Hallazgo operativo del deploy (importante para el futuro):** los **previews de Vercel usan la
> MISMA base de Supabase que producción**. Como el `build` es `prisma generate && prisma migrate deploy
> && next build`, **el build de un preview migra la base de producción**. Por eso las migraciones ya
> estaban aplicadas antes del merge a `prod`. Consecuencia: la ventana de riesgo de una migración
> no-aditiva empieza **al abrir el PR**, no al mergear — con el rename de la 137 esa ventana estuvo
> abierta desde el preview del PR #157. Para renames/destructivas futuras: patrón expand-contract o
> mergear inmediatamente tras abrir el PR.
>
> Cierre de deuda en `chore/cierre-lote-137-140`: T4.1 de la 139 saldada (test de integración del
> recorrido completo), los 2 `down.sql` que faltaban en el repo (deuda ajena de WhatsApp) escritos y
> respaldados por tests → `./init.sh` ya no avisa `migraciones sin down.sql`.

<details>
<summary>Bitácora del lote (histórico de la sesión)</summary>

#### Estado durante la sesión — 137/138/139 mergeadas; 140 en implementación
**Tabla `carga` + `carga_id` en orden — feature 141 (2026-07-27) → IMPLEMENTADA + reviewer APROBADO,
`PR #168` → `dev` (falta merge humano).** Pedido del humano: "genera una tabla cargas, agrega un campo en orden (carga_id) y
download_url (nullable)… cada que se realice una carga masiva se debe generar una entrada nueva en
cargas, las órdenes que se registran desde ahora deben tener este id". Backend, `medium`,
`depends_on: null`. Rama `feature/141-tabla-cargas-orden` **aún no creada** (se difiere a Fase 2, en
worktree desde `origin/dev`).
- **Decisiones cerradas pre-spec (AskUserQuestion):** D1 `download_url` en AMBAS tablas (`cargas` y
  `orden`); D2 se **omite `batch_url`**; D3 se **remueve `status`**; D4 `total_files` = archivos
  cargados en esa carga masiva; D5 disparan **ambos** caminos (`cargarMasiva` UI/chunks y
  `cargarViaApi` API key), el alta manual NO; D6 `num_guia` intacto (`carga_id` es un identificador
  de lote nuevo, insumo de una feature posterior); D7 `orden.carga_id` nullable, sin backfill.
- **Spec escrito:** `specs/141-tabla-cargas-orden/` (R1–R30 EARS, design con `cargaId` generado en
  cliente e idempotente por chunk + 6 alternativas descartadas, 15 tasks con `[P]`).
- **Gate F1.4 APROBADO** con 5 decisiones más: tabla `carga` **singular**; `total_files` = total del
  lote (API = objetos del array del payload; sesión = total declarado, no acumulado por chunk); FK
  `ON DELETE RESTRICT`; `download_url` **NULL** en todo el alcance (nadie la escribe); solo persistir
  y devolver `carga_id`, **sin UI**.
- **Implementada** en worktree aislado `../ordenex-wt-141` (rama `feature/141-tabla-cargas-orden`
  desde `origin/dev` @ 1cfb2ed; `backend_dev` model opus, 6 commits). Migración
  `db/migrations/20260727120000_carga_orden_carga_id` (up+down) + denylist de `zonas-migration.test.ts`.
- **Reviewer APROBADO-CON-NOTAS, 0 bloqueantes** (8 notas menores): typecheck 0, lint 0 errores
  (144 warnings = baseline), **519 archivos / 5275 tests verdes** (+66), `./init.sh` verde,
  R1–R30 con test real, cero `.tsx` en el diff. Detalle en `progress/impl_141.md` / `review_141.md`
  (viajan en la rama).
- **PR #168 → `dev`** (spec + alta en `feature_list` + bitácoras viajan en el propio PR, self-contained).
- **⚠️ Al desplegar:** correr `prisma migrate deploy` (migración `20260727120000_carga_orden_carga_id`).
  El `down.sql` se revisó por lectura, **sin round-trip real** contra la DB compartida.
- **Nota:** el solape con la 136 se disolvió — `dev` avanzó y las features 136–140 quedaron `done`
  antes de arrancar la implementación.

### Lote 137–140 (flujo de estados) — 137 implementada + reviewer APROBADO, PR #157; mergeando `dev`

> Renumerado desde **135–138** por colisión de IDs: `dev` (merge de #155 `flow`) reclamó
> **135 = analítica-KPIs** y **136 = etiquetas-PDF**. El lote se desplazó al bloque libre 137–140.

**137 rename nomenclatura (PR #157) · 138 recepción central (PR #159) · 139 devolución de rechazadas
(PR #160) — las tres `done` y mergeadas.** Detalle de cada una en `history.md`. La 139 se reconcilió a
`done` el 2026-07-25 (figuraba `in_progress` con su PR ya mergeado).

**140 — guardia central de transiciones de `order_status` (backend, high) — EN IMPLEMENTACIÓN.**
Rama `feature/140-flujo-estados-guardia-central` desde `origin/dev`. Cierra la deuda de fondo del lote:
hoy NO existe máquina de estados central — cada service declara sus orígenes/destinos y la única guardia
real es el `WHERE estatus_id = <origen>` de cada UPDATE. El choke point `appendCambioEstado` (feature 49,
~18 call-sites) registra historial + encola webhook pero **no valida legalidad**. La 140 centraliza el
mapa (`lib/types/order-status-transiciones.ts`) y lo valida ahí.

- **Gate F1.4 APROBADO (2026-07-25), 4 decisiones:** (Q3) TODO pasa por la guardia, **sin override
  `ANY→ANY`** ni para maestro/admin — rescatar una orden atascada exigirá declarar la arista y desplegar;
  (activación) **estricta desde el día 1**, sin shadow/flag/env; (Q5) se valida también la creación
  `null→X` contra `ESTADOS_CREACION = {en_preparacion, en_fulfillment, en_ruta_bodega_central}`;
  (Q6) `throw` tipado `TransicionIlegalError` sin PII, firma intacta para los ~18 call-sites.
- **Q1/Q2/Q4 se cerraron CONTRA CÓDIGO al aterrizar 138/139** (ya no eran preguntas): terminales
  `entregada`/`devuelta_a_tienda`; `en_ruta_bodega_central` dejó de ser vestigial (entrada por `carga_api`,
  salida por la recepción central de la 138) → **allowlist vestigial VACÍA**; y el catálogo pasó a **18
  values** (la 139 sumó 3, no 1: `por_devolver`, `devolviendo_a_bodega_central`, `por_devolver_a_tienda`).
- **Spec reconciliado (`spec_author`):** estaba escrito con la numeración vieja (se titulaba "138";
  135/136/137 = hoy 137/138/139) y con `TODO(136)/TODO(137)` sin resolver. Inventario re-derivado del
  código: **41 aristas de flujo → 39 pares únicos + 3 de creación**, 22/22 familias `origen_tipo`,
  conectividad 18/18 sin callejones ni cuellos de botella. **La 139 RETIRÓ `rechazada →
  devolviendo_a_tienda`** (su R9): declararla reabriría un camino cerrado a propósito.
- **Reviewer RECHAZÓ la 1.ª entrega (`progress/review_140.md`), 2 bloqueantes.** Inventario R8
  CONFIRMADO correcto y R1–R17 trazados, pero **BLOQ-1: la guardia falla ABIERTA** — `esOrderStatusValue`
  descarta las filas de `order_status` cuyo `value` no esté en el `ORDER_STATUS_SEED` del build y esa
  transición pasa **sin validar** (drift DB↔build, justo donde la guardia hace falta); agravante: de 26
  suites que mockean el `tx` la guardia queda **OFF** en los ~25 archivos que modelan los call-sites
  reales, y un test consagraba el fail-open como contrato. **BLOQ-2:** `tasks.md` con las 11 tareas sin
  marcar. En corrección por `backend_dev` (fail-CLOSED + inyectar catálogo explícito en las suites, sin
  relajar la guardia para que pasen).
- **Sin migraciones, sin `down.sql`, sin RLS, sin endpoints nuevos** (es dominio puro + choke point).
- **Cierre:** re-review APROBADO 0 bloqueantes tras el fix a fallo cerrado, verificado por mutación.
  PR #161 mergeado a `dev`.

</details>

**Reconciliación de estado stale (pre-merge):** 107/108/110/120 estaban `in_progress` pese a estar
mergeadas a `dev` (PRs #135/#136/#140/#149) → reconciliadas a `done`.

**Ubicación compartida en el chat de WhatsApp — feature 121 → ✅ CERRADA 2026-07-25 (`done`).**
Reviewer APROBADO 0 bloqueantes; código y migración ya en `dev` y desplegados. Resumen en `history.md`.
El bloque de abajo se conserva como bitácora de la sesión en que se hizo.

<details>
<summary>Bitácora de la 121 (histórico)</summary>

Pedido del humano: "en el webhook que consume las respuestas de
WhatsApp agregar soporte para ubicación (mensajes `type=location`); almacenar la ubicación enviada;
y en el front un icono en el chat que al dar click despliegue, en modal/popup dentro de la misma
ventana, un minimapa con la ubicación actual del repartidor y el punto compartido por el usuario".
Fullstack, high, `depends_on: 120`.
- **Decisiones cerradas pre-spec (AskUserQuestion):** D1 = la posición del repartidor es el **GPS del
  navegador EN VIVO** (`useUbicacionActual`, feature 93), con degradación (solo punto del cliente +
  aviso) si se deniega/expira; no hay rastreo server-side. D2 = v1 **solo visualizar** (no adoptar la
  ubicación como coordenadas de entrega de la orden).
- **Reúso clave:** borde tipado del webhook `lib/types/whatsapp-webhook.ts` (`metaMessageSchema` +
  `parseWebhookEventos`, hoy `type=location`→`otro` sin coords), `ChatWhatsappService.ingerirEventos`
  + insert idempotente por `wa_message_id` (dedupe R8 de la 120), stack Leaflet+react-leaflet+OSM de la
  feature 97 (`RutaMapa`/`RutaMapaInner`/`ruta-mapa-tipos`, patrón anti-SSR `next/dynamic({ssr:false})`),
  `Dialog` de shadcn, `useUbicacionActual` (93).
- **Cambio de esquema:** enum `ChatMensajeTipo` += `ubicacion` + columnas `latitud`/`longitud` nullable
  en `chat_mensaje` (migración + `down.sql`, patrón `ALTER TYPE ADD VALUE` como `cancelacion_api` de la
  106).
- **Gate F1.4 APROBADO** con P1=solo lat/lng, P2=pin + texto "Ubicación compartida" en `text-xs`,
  P3=GPS al abrir el modal (lazy).
- **IMPLEMENTADA + reviewer APROBADO 0 bloqueantes** (orquestación directa `backend_dev` →
  `frontend_dev` → `reviewer`, model opus, sobre el árbol `flow`). Backend: enum
  `ChatMensajeTipo.ubicacion` + columnas `latitud/longitud` (migración up/down
  `20260724_chat_mensaje_ubicacion`), normalización `type=location` en `whatsapp-webhook.ts`,
  propagación service/repo/DTO/vista. Frontend: burbuja con `MapPin`, **`components/ui/dialog.tsx`
  nuevo** (sobre `@base-ui/react`, modelado en `sheet.tsx`), `UbicacionMapa/UbicacionMapaInner`
  (Leaflet+OSM anti-SSR, patrón feature 97), GPS lazy vía `useUbicacionActual` con degradación no
  bloqueante. **16/16 R con test, 156/156 verdes, typecheck 0 en archivos 121.** Detalle en
  `progress/impl_121_backend.md`, `impl_121_frontend.md`, `review_121.md`.
- **Deuda menor:** la migración se validó solo por forma estática (falta `apply`/`db:rollback` real);
  G2 quedó como dos archivos `impl_121_*` en vez de un `impl_121.md`.
- ~~**PENDIENTE (leader) — aterrizaje diferido**~~ → **RESUELTO.** Dependía de que la feature 120 (chat)
  saliera de `flow` a `dev`; ya ocurrió, y con ella aterrizó la 121. La migración
  `20260724120000_chat_mensaje_ubicacion` está **aplicada en producción** (verificado 2026-07-25).

</details>


**Etiquetas PDF en la carga por API — feature 136 (2026-07-23; renumerada de 112 en el merge dev→flow por colisión con `112-webhook-payload-data`) → EN ESPECIFICACIÓN.** Pedido del
humano: "generar las etiquetas de las órdenes cuando se realice la carga masiva, un único PDF
almacenado en el storage de Supabase" + "retorna la url donde están los PDF del bucket en la
respuesta de la carga". Backend, `medium`, `depends_on: 88` (done).
- **Decisiones ya cerradas con el humano** (antes del spec, vía AskUserQuestion): (a) momento = la
  **carga vía API** (`cargarViaApi`, que ya asigna `num_guia` en el acto; la carga masiva por sesión
  NO numera, no aplica); (b) generación **server-side**; (c) **un PDF consolidado por lote**;
  (d) devolver la **URL firmada** en la respuesta del endpoint.
- **Reúso clave:** `EtiquetaGuiaService.generarEtiquetas` (arma los `EtiquetaGuiaDTO`),
  `SupabaseFileStorage`/`SupabaseSignedUrlProvider` (`lib/storage/`), `buildPaqueteUrl`. Layout de
  etiqueta 100×100 mm de `app/(app)/ordenes/_components/etiquetas-pdf.ts` (cliente, feature 32).
- **Deps nuevas ya instaladas** durante la exploración: `qrcode` + `bwip-js` (pure-JS server-side; el
  generador de cliente `jspdf`+`jsbarcode`+`qrcode.react` depende del DOM/canvas y no corre en Node).
- **Fase 1 en curso:** feature 136 en `feature_list.json`; `spec_author` (`model: opus`)
  lanzado para `specs/136-etiquetas-pdf-carga-api/` (requirements EARS + design + tasks).
- **Próximo:** al terminar el spec → `spec_ready` + **PARAR en la puerta humana F1.4**. Rama/impl se
  difieren a Fase 2 en worktree aislado desde `origin/dev` (el `flow` actual arrastra WIP ajeno).
- **⚠️ Tarea humana al desplegar:** crear el bucket **privado** `etiquetas-guia` en Supabase.

**Chat mensajero↔cliente vía WhatsApp — feature 109 (2026-07-23) → EN ESPECIFICACIÓN.** Pedido del
humano: "chat que tiene acceso el mensajero, que usa la implementación de WhatsApp como intermediario
y que a través del webhook registra las respuestas del cliente". Fullstack, high, `depends_on: null`.
- **Fase 1 en curso:** feature registrada en `feature_list.json` (id 109, `pending`); `spec_author`
  lanzado (`model: opus`) para `specs/109-chat-mensajero-whatsapp/` (requirements EARS + design + tasks).
- **Infra WhatsApp ya existente (WIP en `flow`, reutilizable):** `lib/clients/whatsapp-cloud.ts`
  (`WhatsappCloudClient.enviarTexto`/`enviarPlantilla`, saliente), `lib/config/whatsapp.ts`
  (credenciales por env), plantillas sincronizadas a Meta (feature 107), `EnviarPlantillaWhatsappButton`
  en `mis-asignaciones`. **NO existe** webhook de ENTRADA ni tablas de chat → es el núcleo nuevo.
- **Alcance nuevo:** webhook `app/api/webhooks/whatsapp/route.ts` (GET handshake + POST firmado
  X-Hub-Signature-256), tablas conversación/mensaje (migración + RLS por asignación), UI de hilo en
  `mis-asignaciones` respetando la ventana de 24 h de WhatsApp (texto libre dentro, plantilla fuera).
- **Próximo:** al terminar el spec → `spec_ready` + **PARAR en la puerta humana F1.4** (revisar los 3
  archivos y resolver las decisiones abiertas). Rama/impl se difieren a Fase 2 en worktree aislado
  desde `origin/dev` (el `flow` actual arrastra WIP ajeno de WhatsApp).

**Plantillas de mensajes — feature 107 (2026-07-22) → PR #135, falta merge humano.** Subitem
"Plantillas" en Configuración (rol maestro, `/configuracion/plantillas`): CRUD completo (crear/editar/
eliminar) + editor que inserta campos variables `{{clave}}` + preview + estado
(activo/inactivo/pending/refused). Fullstack, sin dependencias (se saltó el id 106 por colisión con
`specs/106-api-lectura-ordenes/` de sesión paralela; ver también worktree `ordenex-wt-106`).

- **Gate humano APROBADO** con 4 decisiones: (D1) nace `pending`; (D2) el front SOLO desactiva
  (destino `inactivo`, `z.literal("inactivo")`) — ACTIVAR `pending→activo` NO existe aún; `refused`
  reservado sin productor; (D3) SOFT DELETE con `deletedAt`; (D4) catálogo de variables ABIERTO/
  data-driven, `variables text[]` derivadas del cuerpo.
- **Flujo:** spec_author (31 req EARS) → backend_dev (T1–T7) → frontend_dev (T8–T11 + eliminar) →
  reviewer. Orquestación directa, `model: opus`. Implementado en worktree aislado **`ordenex-wt-107`**
  desde `origin/dev` (rama `feature/107-plantillas-mensajes`), 14 commits.
- **Reviewer APROBADO** (`progress/review_107.md`, viaja en la rama): 31/31 R con test tras cerrar el
  único bloqueante (R3, test de autorización de la página). typecheck/lint verdes; **82 tests de la
  feature verdes** (9 archivos).
- **PR #135 → dev** (spec + review + alta 107 en feature_list viajan en la misma rama). Falta merge
  humano. ⚠️ Al desplegar: correr la migración `20260722130000_plantilla_mensaje`.
- Deuda menor diferida: `progress/impl_107.md` no se escribió (M1 del review); tasks.md sin marcas `[x]`.

_Ninguna del lote mensajero en curso._

**Lote mensajero 113–119 — COMPLETO (7/7 mergeadas a `dev`, 2026-07-23).** Detalle en `history.md`.
113 card detalle+foco (PR #147) · 114 buscador (#150) · 115 marcar-luego (#146) · 116 notas privadas
(#152) · 117 filtro cantón/distrito (#153) · 118 SINPE (#145) · 119 evidencias 1..N (#148). Nació como
112–118 y se **renumeró a 113–119** (colisión del ID 112 con `webhook-payload`). Migraciones nuevas:
115 `orden_mensajero_meta`, 119 `gestion_orden_evidencia`; rename del enum SINPE (118). Se saldó de paso
un error de lint ajeno de la 120-chat con el PR #151. Despliegue: `prisma migrate deploy`.

**Renumeración del backlog de analítica (2026-07-23, reajustada en el merge dev→flow 2026-07-24).** La
cadena de analítica (puro registro, sin specs/ramas/código) usaba `120`, que colisionaba con
`120 = chat-whatsapp`; se desplazó +1 → 121–134. Al mergear `dev` en `flow` el `121` volvió a colisionar,
ahora con `121 = ubicación-chat-whatsapp` (feature real, con spec + código en disco). Se movió el
**catálogo de KPIs a `135`** (era 121), y sus dependientes (`122`, `123`) apuntan ahora a `135`; el resto
de la cadena (122–134) queda intacto. Estado final: `120` = chat-whatsapp, `121` = ubicación,
`122–134` + `135` = analítica.

_Cierres previos mergeados a `dev`:_ **109** (PR #141), **110** (PR #140), **111** (PR #139), **102** (PR #131).


**Flujo de API key — verificación + huecos (2026-07-21).** A pedido del humano se verificó el flujo
de carga por API key (features 81/82/88, `done`): valida la key por hash SHA-256, carga por endpoint
expuesto (`POST /api/ordenes/api-key/carga`), genera `num_guia` y devuelve errores por fila. Dos
huecos → tres features nuevas. **Gate F1.4 APROBADO por el humano.**

> ⚠️ **Colisión de IDs por sesiones paralelas.** Se registraron primero como 98/99/100, pero durante
> la sesión otras sesiones commitearon a `origin/dev` las features **98–102**. Se **renumeraron a
> 103/104/105**. Las **ramas de código conservan su slug original** (`feature/98-api-carga-valor-pagar`,
> `feature/99-webhooks-cambios-estado`) porque ya estaban pusheadas y el classifier bloquea el borrado
> de ramas remotas. Los specs se movieron a `specs/103-*` y `specs/104-*`.

| # | Feature | Rama | Zona | Estado |
|---|---------|------|------|--------|
| 103 | api - `costoEnvio` (flete+IVA) en la carga por API | `feature/98-api-carga-valor-pagar` | backend | reviewer **APROBADO** · **PR #125** → dev (falta merge humano) |
| 104 | webhooks de cambios de estado (API key) | `feature/99-webhooks-cambios-estado` | backend | reviewer **OK** · **PR #127** → dev (falta merge humano) |
| 105 | webhooks - UI de registro (Config > API) | `feature/105-webhooks-ui-registro` | frontend | pending (bloqueada por 104; spec sin autoría) |

**Feature 106 — API de lectura/detalle/cancelación de órdenes por API key (2026-07-22).** Ciclo SDD
completo, backend, high, `depends_on: 88`. Exposición a integradores por API key: GET listado scopeado
al dueño de la key (`tienda_id = actor.usuarioId`, forzado en el repo), GET detalle por `num_guia` con
evidencias de entrega/rechazo firmadas (signed URL 5 min, sin PII), y **PUT** cancelar (solo desde
`en_bodega`/`en_ruta_bodega_principal` → `devuelta_origen`, si no 409) vía `appendCambioEstado`
(bitácora + webhook 104). Gate F1.4 aprobado por el humano; única migración = `ADD VALUE
'cancelacion_api'` en el enum `orden_historial_origen_tipo`. Implementada en worktree aislado
(`ordenex-wt-106`, `backend_dev` model opus): typecheck verde, lint 0, 55 tests nuevos + 68 ripple
verdes. Reviewer **APROBADO 0 bloqueantes**. Rama `feature/106-api-lectura-ordenes` sincronizada con
`dev`, pusheada, **PR #132 → dev (falta merge humano)**. Todo el registro (feature_list 106 + spec +
`impl_106` + `review_106`) viaja commiteado en el propio PR #132 (self-contained). **⚠️ Al desplegar:
correr `db:migrate` (agrega el valor de enum; no se aplicó pre-merge porque el `.env` apunta a DB
compartida).**

**Bookkeeping en PR #124** (`chore/registro-features-webhooks-103-105`): feature_list 103/104/105 +
specs/103 + specs/104 + `review_103` + `review_104`. Los tres PRs (#124, #125, #127) → `dev`, merge humano.

**Decisiones del gate F1.4 (cerradas por el humano):** F103 → `costoEnvio` = flete+IVA, `"0.00"` si la
tienda no tiene tarifa, campo `costoEnvio`. F104 → registro por **UI en Config>API** (Server Action,
rol maestro; nace 105), secreto **cifrado AES-256-GCM** (`WEBHOOK_SECRET_ENC_KEY` en env), emite **solo
órdenes cargadas por API key**, **5 reintentos**, persiste el error de entrega vía `jobs.last_error`.

- **F103:** `feature/98-api-carga-valor-pagar` @ `ae651b7`, pusheada; typecheck 0, suite 3935/3935.
  `impl_98.md` vive en esa rama. Pendiente: PR hacia `dev`.
- **F104:** en implementación en worktree aislado (`backend_dev`, `model: opus`). Al mergear:
  **configurar `WEBHOOK_SECRET_ENC_KEY` en Vercel** o los webhooks no pueden firmar.

> Este registro (feature_list 103/104/105 + specs/103 + specs/104 + esta bitácora) viaja en
> `chore/registro-features-webhooks-103-105` → PR a `dev` (sin commits directos a `dev`).

El último trabajo previo mergeado fue la **feature 97** (optimización de ruta — frontend): PR #110 a
`dev`, prod PR #117.

## Backlog pendiente

> **Auditado contra el código el 2026-07-26.** El registro estaba desactualizado: **3 features
> figuraban pendientes pero YA ESTABAN IMPLEMENTADAS** (112, 105, 79 → `done`) y **2 estaban a medias
> en la mitad contraria** a la que decía su ficha (85 y 74). Evidencia por feature en su `status_note`
> de `feature_list.json`. **No queda ninguna feature `in_progress` ni `spec_ready`.**

**Cerradas por la auditoría (ya estaban hechas):**

| # | Evidencia |
|---|-----------|
| 112 | `WebhookEstadoService.ts:89` ya usa el sobre `data:`; test en `webhook-estado-service.test.ts:94`. Figuraba `spec_ready`. |
| 105 | UI cableada: `page.tsx` → `ApiKeysModule` → `api-keys-columns` → `WebhookAccionCell` → `RegistrarWebhookForm` (+ `RevelarWebhookSecretoModal`), con 3 tests de componente. |
| 79 | Decisión tomada e implementada (opción **b**: exige sesión). `middleware.ts` con `REDIRECT_TO_ROOT = ["/paquete"]` manda a `/` en vez de a `/login`; tests en `middleware.test.ts:116-127`. |

**Pendientes reales — 5 sueltas + 15 de analítica:**

| # | Feature | Zona | Estado real |
|---|---------|------|-------------|
| 80 | proveedor de correo real + sacar el OTP de los logs | backend | **Sin empezar.** `StubEmailProvider` vivo y OTP en `console.log` (`OtpChallengeIssuer.ts:39`) → **ningún email sale hoy en producción**. |
| 85 | wallet - periodicidad de gastos fijos | frontend | **Backend YA HECHO** (migración `gasto_fijo_periodicidad` + `GastoFijoPlantillaService` + `GeneracionGastosFijosService`). Falta **solo la UI**. |
| 74 | explotar la causa de devolución | fullstack | **Captura YA HECHA** (`causa-devolucion-options.ts` + `GestionarOrdenPanel`). Falta **mostrarla y agruparla** en los listados. |
| 70 | regla de selección de tarifa vigente | backend | Sin empezar. ⚠️ **Requiere gate humano**: lo dice el propio código (`TarifaVigentePorTiendaRepository.ts:56`, decisión (g) de la 69 sin cerrar). |
| 71 | bloquear checkbox de órdenes con cierre sin resolver | fullstack | Sin empezar, sin rastro en `app/(app)/ordenes`. |
| 66 | qr - detalle (switch por rol) | — | Sin empezar; solo existe el escáner de la 65 (`app/(app)/qr/page.tsx` navega a la ruta del QR). |
| 135 + 122–134 | **analítica** (15 encadenadas) | backend/frontend | Sin empezar: sin ruta `/analitica`, sin migración `analytics_daily`, sin servicios. |

### Lote 142–150 — registrado el 2026-07-27 (solo alta en `feature_list.json`)

> **Renumerado 141–149 → 142–150 el 2026-07-27** al resolver el conflicto de `feature_list.json` con
> el pull de `dev`: el id **141 lo conserva `tabla carga + carga_id en orden`** (spec, rama
> `feature/141-tabla-cargas-orden`, PR #168 abierto e `impl_141`/`review_141` ya escritos con ese id).
> El lote no tiene specs, ramas ni código, así que mover sus ids fue el cambio barato. `depends_on`
> internos reajustados (143→142, 145→144). ⚠️ Los ids viejos ya viajaron a `dev` en el PR #170:
> cualquier sesión que haya tomado uno del rango 141–149 debe releer `feature_list.json`.

Nueve funcionalidades pedidas por el humano, **sin spec, sin rama y sin código**. Boceto aprobado en
chat antes de escribir. Dos ajustes sobre lo pedido: (a) "reordenar la plantilla" y "unificar
provincia/cantón/distrito en una columna" se **fusionaron en la 142** — tocan los mismos 4 archivos y
la segunda borra las columnas que la primera ordena; (b) "filtros + búsqueda + export en todas las
tablas" se **partió en 144 (capacidad en `DataTable`) + 145 (rollout a los 31 consumidores)**.

| # | Feature | Zona | Cplx | Depende |
|---|---------|------|------|---------|
| 142 | plantilla v2: nuevo orden + `direccion_destinatario` unificada | fullstack | high | — |
| 143 | descargar en Excel las filas con error de la carga masiva | frontend | medium | 142 |
| 144 | `DataTable`: búsqueda, filtros y export a Excel (capacidad) | frontend | medium | — |
| 145 | rollout de búsqueda/filtros/export a las 31 tablas | frontend | high | 144 |
| 146 | campana de notificaciones funcional | fullstack | high | — |
| 147 | filtro por bodega de las órdenes asignables | fullstack | medium | — |
| 148 | manifiesto Excel al crear o mover órdenes | fullstack | high | — |
| 149 | deshacer asignación a mensajero o bodega antes de la recogida | fullstack | high | — |
| 150 | tamaño de hoja seleccionable en las etiquetas | fullstack | medium | — |

Cada ficha lleva sus decisiones `ABIERTO:` marcadas; se cierran en la puerta F1.4 de su spec, no antes.
Dos con acoplamiento a trabajo ya cerrado: la **149** debe **declarar las aristas inversas en el mapa de
la guardia central (feature 140)** o `appendCambioEstado` lanzará `TransicionIlegalError`; la **150**
toca los **dos** generadores de PDF (cliente feature 32 + servidor feature 136).

## Deudas de arnés vivas

- **✅ MITIGADO (2026-07-27, `chore/migraciones-solo-en-produccion`):** el `build` ya no corre
  `prisma migrate deploy` en todos los entornos. Ahora pasa por `scripts/migrate-deploy.ts`, que
  **solo migra en producción**, y en preview únicamente si el entorno declara
  `MIGRATE_ON_PREVIEW=true` (= "esta base es de pruebas"). Corta el efecto secundario de que
  **abrir un PR migrara la base de producción**. Suma dos guardas nacidas del incidente del día:
  aborta si la URL de migraciones apunta al pooler **transaccional** (`:6543` / `pgbouncer=true`) y
  pone un **timeout de 120 s**, para que un cuelgue sea un build rojo con mensaje y no 2 h de slot
  ocupado en silencio. **No es la cura**: mientras Preview apunte a la base de producción, una
  migración nueva sigue teniendo que aplicarse a mano. La cura es la base por preview (en curso,
  tarea humana).
  > ⚠️ **Al conectar la base de pruebas:** poner `DATABASE_URL` (`:6543`) y `DIRECT_URL` (`:5432`)
  > de esa base **solo en el entorno Preview**, y recién entonces `MIGRATE_ON_PREVIEW=true`. Sin
  > apuntar primero las URLs, el flag haría que cada preview migre producción — justo lo que se
  > acaba de cerrar.
- **Incidente del 2026-07-27 (resuelto, PR #172):** el fix del pooler (`d60df35`) se mergeó a `prod`
  pero **no a `dev`** → todo build salido de `dev` se colgaba en `migrate deploy` contra `:6543`.
  Dos deployments muertos (`dev` ~1 h 40 min en BUILDING, PR #170 en ERROR) y la rama `ux`
  bloqueada. **Lección:** un hotfix ramificado desde `origin/prod` hay que portarlo a `dev`
  con cherry-pick el mismo día; si toca el build, `prod` se ve sano mientras todo lo demás arde.
- **✅ RESUELTO (2026-07-28, PR #175 `fix/tests-rediseno-ux`, `dev` @ `55b0cd4`):** la deuda de abajo
  está saldada. **Medido en worktree limpio de `origin/dev` @ `55b0cd4`**: `pnpm typecheck` **0
  errores** y **518 archivos / 5308 tests, 0 fallos**. Ya no hay que trabajar sin red: cualquier rama
  que salga de `dev` desde ahora arranca en verde, y un rojo al final es de quien lo introdujo.
  Ojo: el árbol principal `ux` (checkout de esta sesión) **sigue en rojo** con los 2 TS2741, porque
  está en `c3e6954` y arrastra WIP ajeno sin commitear — es el árbol el que está atrasado, no `dev`.
- ~~**`typecheck` roto en `dev` desde el merge de `ux` (PR #171)**~~ — 2 errores TS2741 en
  `tests/components/GestionarOrdenPanelEvidencias.test.tsx:84` y `NotaPrivadaMensajero.test.tsx:253`
  (falta la prop `count` de `GestionarOrdenPanelProps`). Verificado sobre `origin/dev` limpio: es
  ajeno a los PRs de hoy. No rompe el deploy (Next no type-checkea los tests), pero deja `pnpm
  typecheck` en rojo para todos.
- **No hay regla `no-console` en el lint** (verificado 2026-07-21) → **17 llamadas `console.*` en
  producción** (`app/` + `lib/`, sin tests). Por ahí se coló el `console.log('xyz')` del PR #75.
  El de `OtpChallengeIssuer` es un **secreto en logs** → lo cubre la feature 80. Algunas pueden
  ser logging de error legítimo: revisar una por una + instalar `no-console` con allowlist.
- **✅ RESUELTO (2026-07-22, `chore/fix-init-sh-rule4`):** la suite flaky que volvía `./init.sh` no
  determinista se salda subiendo `testTimeout`/`hookTimeout` de vitest de 5000ms (default) a
  **20000ms** en `vitest.config.ts`. Los timeouts por contención bajo carga (`HomePage`,
  `HomePageRol`, `OrdenesModuleReuse`, `CierreDiaPage`, que pasaban en aislado) desaparecieron;
  `./init.sh` corre la suite verde de forma determinista (verificado 4075/4075). Un test
  genuinamente colgado sigue fallando a los 20s.
- **`zonas-migration.test.ts` usa una denylist de migraciones apendida a mano** → se pone rojo con
  cada migración nueva (ya rompió ≥3 veces). Patrón frágil: un test que lista archivos del repo en
  vez de leer código.
- **Fakes de repositorio a mano y duplicados** (`IUserRepository` triplicado, `IOrdenRepository`
  con ~30 métodos listados a mano) → cada método nuevo del contrato rompe N archivos de test. Un
  builder en `tests/helpers/` lo mataría de raíz.
- **✅ RESUELTO (2026-07-22, `chore/fix-init-sh-rule4`):** regla 4 de `init.sh` corregida — resuelve
  la carpeta de spec por `spec_path` explícito o glob `specs/<id>-*` (antes usaba `.name`, que no
  matchea el slug), y solo la exige a features **en vuelo** (`spec_ready`/`in_progress`), no a las
  `done` tempranas (1–16) sin spec. Regla 3 subida a **máx 2 `in_progress` por zona** (decisión del
  humano), consistente con CLAUDE.md regla 1 y AGENTS.md. `init.sh` verde de punta a punta. Nota:
  ambas reglas siguen dependiendo de `jq`; si falta, se saltan sin fallar (degradación aceptada).
- **No hay harness de E2E** (seed + login por rol). Los `e2e/*.spec.ts` están escritos pero usan
  emails placeholder → no se ejecutan. Candidato a feature propia.
- **`app/(app)/ordenes/_components/ordenes-columns.tsx` es un imán de drift** (ya lo revirtieron 2
  veces) → mirarlo con lupa en todo PR que lo toque.

## Tareas humanas pendientes

> **✅ VERIFICADO CONTRA SUPABASE PROD el 2026-07-25** (proyecto `ordenex-db` / `scfnwxqbsgkzwsdntdvd`,
> vía MCP). Ya no hay que suponer: se consultó `storage.buckets` directamente.

- ~~**Bucket `gestion-evidencias`**~~ → **EXISTE**, privado, creado 2026-07-15. Nada que hacer.
- ~~**Bucket `mensajero-docs`**~~ → **EXISTE**, privado, creado 2026-07-15. Nada que hacer.
- ⚠️ **Bucket `etiquetas-guia` (privado) — NO EXISTE. ÚNICO BLOQUEO DE INFRA VIVO.** Lo necesita la
  feature 136 (`ETIQUETAS_BUCKET`, default `etiquetas-guia` en `lib/config/etiquetas.ts`). Es la tarea
  T0.1 del spec de la 136, la única sin marcar.
  **Impacto matizado (corregido por el review de la 136):** el endpoint trata la etiqueta como
  best-effort — `try/catch` (`route.ts:152-158`) que NO revierte la carga, responde **200** con las
  órdenes y su `num_guia` y expone el fallo como `etiquetasPdf: { error }`. Eso **cubre las excepciones
  JS** (bucket ausente incluido), así que en lotes normales los integradores reciben sus órdenes bien,
  sólo sin PDF.
  ⚠️ **PERO NO cubre OOM/timeout** (BLOQ-1 del review): el PDF no tiene cota (hasta `MAX_CHUNK_ROWS`
  = 5000, ~279 KB y ~13 ms por etiqueta → ~1.4 GB / ~65 s) y el fallo ocurre **después** del commit de
  las órdenes. Un OOM no es excepción JS → 500/504 en vez de 200 y el integrador **pierde los
  `num_guia`** (al reintentar salen `duplicada`). En corrección; ver `progress/review_136.md`.
  Crear desde el dashboard de Supabase (Storage → New bucket → nombre `etiquetas-guia`, **Private**),
  o por SQL:
  `INSERT INTO storage.buckets (id, name, public) VALUES ('etiquetas-guia','etiquetas-guia',false) ON CONFLICT (id) DO NOTHING;`
  (los buckets existentes solo se crearon; el service role bypassa RLS, así que no hacen falta policies).
- **Proveedor de correo real** — hoy `StubEmailProvider` solo hace `console.info`; **ningún email
  sale** y el OTP se lee de los logs del servidor. Lo salda la feature 80 (`pending`).

**Estado del catálogo en PROD (verificado el 2026-07-25):** migraciones del lote 4/4 aplicadas,
0 nombres viejos residuales, 6/6 nombres nuevos, `orden_historial_origen_tipo` con 22 values.
`order_status` tiene **19 filas**: las 18 del código + `pendiente`, huérfano (**0 órdenes en prod y 0 en
local**, sembrado por `20260714140000_order_status_pendiente` y nunca añadido a `ORDER_STATUS_SEED`).
Inofensivo hoy; con la guardia de la 140 cualquier transición que lo tocara se rechaza explícitamente.
Limpiarlo requiere una migración propia — decisión de datos, no urgente.

## Notas de proceso (vigentes)

- Todos los subagentes corren con `model: opus` (decisión del humano 2026-07-09), ignorando la
  gradación por complexity.
- **Workaround del bug opus-4.8[1m]:** orquestar directo (`spec_author` → `backend_dev`/
  `frontend_dev` → `reviewer`) en vez del `implementer` monolítico, pasando `model: opus`
  explícito; el `implementer` muere en el 1er intento.
- Ramas desde `origin/dev`, PRs hacia `dev`; el bookkeeping (cierres, reconciliaciones) viaja en
  una rama `chore/` + PR, **sin commits directos a `dev`**. Cuando `flow` tiene WIP ajeno, se
  trabaja en worktree aislado desde `origin/dev` para evitar el drift de sesiones paralelas.
