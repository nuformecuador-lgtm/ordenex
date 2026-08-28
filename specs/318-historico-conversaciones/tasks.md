# Feature 318 — Tareas

> Checklist de pasos discretos y verificables. `[P]` = paralelizable con las tareas de su mismo
> bloque. Cada tarea tiene criterio de **hecho**; ningún criterio es «existe el archivo» ni «el
> comentario dice X» — se satisfacen con un `assert` de **comportamiento** (hay precedente en este
> repo de un criterio tipo grep que se cumplía reescribiendo un comentario).
>
> **Revisión del 2026-08-28.** Las nueve preguntas están **cerradas** por la puerta humana
> (`requirements.md` → «Decisiones cerradas»). El spec ya no tiene preguntas abiertas: se puede
> implementar. `R1..R45`, **45 requisitos**, todos mapeados abajo.
>
> **Sin migración (R27).** Si algo durante la implementación pareciera exigir una, se **para** y se
> consulta: no se mete.

---

## Bloque 0 — Medir para saber con qué números se vive (no bloquea el diseño)

- [ ] **T0 — Medir el volumen real de las dos tablas.**
      Contar `chat_conversacion`, `chat_mensaje`, el número de **grupos** `(orden_id, mensajero_id)`
      y cuántos de esos grupos fusionan **más de un teléfono** (R42/R43).
      **Qué decide ahora:** ya **no** decide si se migra —la puerta humana descartó A6 (P2)— sino
      (a) el tamaño de página por defecto del listado (`limite`, R13) y (b) si el caso de la fusión
      de teléfonos es frecuente o raro, para dimensionar los datos de prueba de T3.2.
      **Hecho:** los cuatro números quedan escritos en `progress/impl_318.md` con fecha y método.
      **Depende de:** nada. **Bloquea:** nada (T3.1 puede empezar en paralelo).

---

## Bloque 1 — Menú, roles y ruta (R1-R9)

- [ ] **T1.1 — Constante `ROLES_HISTORICO_CONVERSACIONES` en `lib/auth/menu-visibility.ts`.**
      Whitelist propia `["maestro","admin"] as const satisfies readonly RolValue[]` (design §3.1).
      **Hecho (R1):** `tests/unit/auth/menu-historico.test.ts` →
      `expect([...ROLES_HISTORICO_CONVERSACIONES].sort()).toEqual(["admin","maestro"])`.

- [ ] **T1.2 — `IconKey` nueva `"history"` + entrada en `ICON_BY_KEY` del Sidebar.**
      **Hecho (R6):** `tests/components/Sidebar.test.tsx` → renderizado con actor `maestro`, el ítem
      «Histórico» monta un `<svg>`: `expect(item.querySelector("svg")).not.toBeNull()`.
      Y en `tests/unit/auth/menu-historico.test.ts`:
      `for (const it of SIDEBAR_ITEMS) expect(typeof it.iconKey).toBe("string")` (nada de
      componentes cruzando el borde RSC) y
      `for (const it of SIDEBAR_ITEMS) expect(ICON_BY_KEY[it.iconKey]).toBeTypeOf("function")`.
      **Depende de:** T1.1.

- [ ] **T1.3 — Ítem «Histórico» con subítem «Conversaciones», en la ÚLTIMA posición del bloque de
      administración.**
      **Hecho (R2):** `expect(item.roles).toBe(ROLES_HISTORICO_CONVERSACIONES)` — **`toBe`**, no
      `toEqual`: identidad de referencia, que es lo que mata la mutación «copiar el literal».
      **Hecho (R3):** `expect(item.children).toEqual([{ label: "Conversaciones", href: "/historico/conversaciones" }])`
      y `expect("roles" in item.children[0]).toBe(false)`.
      **Hecho (R4):** para cada `RolValue`,
      `expect(itemsVisibles(SIDEBAR_ITEMS, {rol}).some(i => i.label === "Histórico"))
        .toBe(["maestro","admin"].includes(rol))`.
      **Hecho (R5):** `expect(itemsVisibles(SIDEBAR_ITEMS, null).some(i => i.label === "Histórico")).toBe(false)`.
      **Hecho (R9):** `expect(primerDestino(itemsVisibles(SIDEBAR_ITEMS, {rol})))` contra la tabla de
      destinos escrita como literal en el test (maestro/admin `/dashboard`, mensajero
      `/mis-asignaciones/reparto`, adminSatelite `/recepcion-satelite/por-recibir`, adminTienda
      `/ordenes`). Si el ítem se moviera arriba, este test se pone rojo.
      **Depende de:** T1.1, T1.2.

- [ ] **T1.4 — Ruta `app/(app)/historico/conversaciones/page.tsx` con gate `notFound()`.**
      **Hecho (R7):** `tests/components/HistoricoConversacionesPage.test.tsx` → con
      `resolveActorFromSession` mockeado a cada rol NO permitido y a `null`,
      `await expect(HistoricoConversacionesPage()).rejects.toThrow()` y
      `expect(notFoundSpy).toHaveBeenCalled()`; con `maestro` y `admin`, no lanza.
      **Hecho (R7, «antes de consultar»):** el doble del service viaja por `deps` y
      `expect(serviceSpy).not.toHaveBeenCalled()` en los casos denegados.
      **Depende de:** T1.1.

- [ ] **T1.5 — Guardia: ítem y gate no pueden divergir; la whitelist está cerrada.**
      `tests/unit/guards/historico-roles-una-sola-fuente.guardia.test.ts`.
      **Hecho (R8):** sobre el fuente **sin comentarios** de la página (`codigoSinComentarios`, el
      quitador del repo),
      `expect(fuente).not.toMatch(/"(maestro|admin|adminSatelite|adminTienda|mensajero|apiKey)"/)`
      **y** `expect(fuente).toContain("ROLES_HISTORICO_CONVERSACIONES")`; más **CONTRAPRUEBA** que
      aplica la mutación en memoria (constante → literal) y comprueba que la aserción la caza.
      **Hecho (R1 / P4 «solo admin/maestro»):**
      `for (const rol of ["adminSatelite","adminTienda","mensajero","apiKey"])
        expect(ROLES_HISTORICO_CONVERSACIONES).not.toContain(rol)`.
      **Depende de:** T1.1, T1.4.

---

## Bloque 2 — Contratos, borde tipado y helpers (R38, R23, R36) `[P]` con el bloque 1

- [ ] **T2.1 [P] — `lib/types/historico-conversaciones.ts`:** DTOs + zod de las dos entradas
      (design §2.2, §2.3), con `.strict()`.
      **Hecho (R38):** `tests/unit/types/historico-conversaciones-schema.test.ts` →
      `safeParse` **falla** con `{ filtro: { mensajero_id: [] } }`, con `fecha_desde: "28/08/2026"`,
      con `limite: 0`, con `limite: 999`, con `cursor: { ordenId: "x" }` (cursor incompleto: sin
      `ultimaActividadAt` ni `mensajeroId`), con `{ ordenId }` sin `mensajeroId` en la entrada de
      mensajes, y con una clave desconocida.
      **Hecho (R41, estructural):** `expect("mensajes" in ({} as HiloHistoricoDTO)).toBe(false)` —
      comprobado además con un test de tipos: el DTO del listado **no declara** campo de mensajes.

- [ ] **T2.2 [P] — Interfaces `IHistoricoConversacionesRepository` / `…Service`.**
      **Hecho:** los tests instancian el service con dobles que implementan la interfaz y
      `pnpm run typecheck` pasa en cero errores.

- [ ] **T2.3 [P] — `lib/utils/separador-dia-cr.ts` con «hoy» / «ayer» / día largo sin año.**
      **Hecho (R23):** `tests/unit/utils/separador-dia-cr.test.ts`, con `ahora` fijo
      `2026-08-28T18:00:00Z` (12:00 CR del viernes 28):
      - `expect(separadorDia("2026-08-28T20:00:00Z", ahora)).toBe("hoy")`;
      - `expect(separadorDia("2026-08-27T20:00:00Z", ahora)).toBe("ayer")`;
      - `expect(separadorDia("2026-08-26T20:00:00Z", ahora)).toBe("miércoles 26 de agosto")`;
      - **sin año nunca (P6):** `expect(separadorDia("2025-08-28T18:00:00Z", ahora))
         .toBe("jueves 28 de agosto")` y `expect(separadorDia("2025-08-28T18:00:00Z", ahora))
         .not.toMatch(/\d{4}/)`;
      - **frontera CR de «hoy»/«ayer»:** con `ahora = 2026-08-29T04:00:00Z` (22:00 CR del **28**),
        `expect(separadorDia("2026-08-29T03:00:00Z", ahora)).toBe("hoy")` — un cálculo en UTC diría
        «ayer» y este `assert` lo caza;
      - **frontera CR del día largo:** `expect(separadorDia("2026-08-29T05:00:00Z", ahoraDeOtroDia))`
        agrupa como **28** de agosto, no 29.

- [ ] **T2.4 [P] — `lib/utils/busqueda-texto-sql.ts`** (espejo SQL de `normalizarTerminoBusqueda`).
      **Hecho (R36, paridad):** `tests/integration/db/busqueda-texto-sql-paridad.test.ts` → para un
      corpus con acentos, mayúsculas y espacios múltiples,
      `expect(await prisma.$queryRaw(sqlNormalizarTextoBusqueda("$1")))
        .toBe(normalizarTerminoBusqueda(entrada))` en **cada** caso.

---

## Bloque 3 — Repositorio y service (R10-R21, R25, R28, R33-R37, R39, R40, R42-R45)

- [ ] **T3.1 — `HistoricoConversacionesRepository.listarHilos`** con `GROUP BY (orden_id, mensajero_id)`
      (design §2.4).
      **Hecho (R10):** `tests/integration/repositories/historico-conversaciones.int.test.ts` →
      sembrados hilos de 3 mensajeros distintos, `expect(items).toHaveLength(3)` (el repo NO recibe
      scope de mensajero de sesión).
      **Hecho (R11):** `expect(items[0]).toMatchObject({ ordenId, mensajeroId, numGuia, numRemision,
      destinatario, mensajeroNombre, ultimaActividadAt })` con los valores sembrados.
      **Hecho (R12):** tras `update orden set deleted_at = now()`,
      `expect(items.map(i => i.ordenId)).not.toContain(ordenBorradaId)`.
      **Hecho (R13):** `expect(sql).not.toMatch(/OFFSET/i)` sobre la consulta capturada; con
      `limite: 2` y 5 hilos sembrados, `expect(pagina1.items).toHaveLength(2)` y paginar hasta el
      final devuelve los 5 sin repetir.
      **Hecho (R14):** `expect(items.map(i => `${i.ordenId}:${i.mensajeroId}`))
        .toEqual([masReciente, medio, masAntiguo])`.
      **Hecho (R15):** con **tres** hilos de `ultima_actividad_at` **idéntica** y `limite: 2`, la
      unión de las dos páginas tiene exactamente 3 claves `(ordenId, mensajeroId)` **distintas**.
      **Depende de:** T2.1, T2.2.

- [ ] **T3.2 — Fusión (orden, mensajero) y sus tres casos.** `[P]` con T3.3
      **Hecho (R42):** sembradas **dos** filas de `chat_conversacion` con la misma
      `(orden_id, mensajero_id)` y teléfonos distintos, cada una con 2 mensajes:
      `expect(items).toHaveLength(1)` y `expect(items[0].totalMensajes).toBe(4)`.
      **Hecho (R42, orden de la fusión):** los 4 mensajes leídos por `listarMensajes` salen
      ordenados por `ocurrido_at` **entrelazando ambas filas**:
      `expect(mensajes.map(m => m.id)).toEqual([mAntiguoTel1, mTel2, mTel1, mRecienteTel2])`.
      **Hecho (R43):** `expect(items[0].telefonosCount).toBe(2)` y
      `expect(items[0].telefonoVigenteMasked).toBe(<últimos 4 del teléfono con actividad más reciente>)`.
      **Hecho (R44):** sembrada una orden con hilos de **dos mensajeros distintos**,
      `expect(items).toHaveLength(2)` y
      `expect(items.map(i => i.mensajeroId).sort()).toEqual([m1, m2].sort())` — **no se deduplican**.
      **Hecho (R45, límite conocido):** sembrada UNA fila cuyo `mensajero_id` fue **reescrito** de
      `m1` a `m2` (simulando `upsertParaOrden` tras reasignación) con mensajes anteriores y
      posteriores: `expect(items).toHaveLength(1)`,
      `expect(items[0].mensajeroId).toBe(m2)` y `expect(items[0].totalMensajes).toBe(<todos>)`. El
      test lleva en su nombre «LIMITACIÓN CONOCIDA» y cita R45, para que quien venga a
      «arreglarlo» sepa que hay que reabrirlo con el humano y que exige migración.
      **Depende de:** T3.1.

- [ ] **T3.3 — Filtros del repositorio.**
      **Hecho (R33):** con `mensajero_id: [m1]`, `expect(items.every(i => i.mensajeroId === m1)).toBe(true)`
      y el hilo de `m2` queda fuera.
      **Hecho (R34):** con `fecha_desde = fecha_hasta = "2026-08-15"`, **entra** el hilo cuyo único
      mensaje es `2026-08-16T05:00:00Z` (= 23:00 CR del 15) y **queda fuera** el de
      `2026-08-16T06:00:00Z` (= 00:00 CR del 16). Este par mata el uso de `startOfDayCR` en vez de
      `inicioDelDiaCREnUtc`.
      **Hecho (R35, número EXACTO — P7):** con `orden: "REM-1001"` devuelve los hilos de esa orden;
      con `orden: "REM-100"` (prefijo) devuelve `[]`; con `orden: "1001"` casa `num_guia = 1001` y
      **no** casa `num_guia = 10011`. La ausencia de coincidencia parcial es el `assert`.
      **Hecho (R36):** cuatro casos positivos, uno por dato — destinatario («maría» encuentra «MARÍA
      GONZÁLEZ»), `num_guia`, `num_remision` y **nombre del mensajero** — y uno negativo (término
      que no casa nada → `items: []`).
      **Depende de:** T3.1, T2.4.

- [ ] **T3.4 — `listarMensajes` del hilo fusionado, con cursor descendente.**
      **Hecho (R18):** sembrados 100 mensajes, `expect(res.mensajes).toHaveLength(30)`.
      **Hecho (R19):** `expect(sql).not.toMatch(/OFFSET/i)`; la consulta filtra por
      `(ocurrido_at, id) < (cursor)`.
      **Hecho (R20):** con **cinco** mensajes de `ocurrido_at` idéntico y `limite: 2`, recorrer el
      hilo entero por cursor devuelve exactamente 5 ids distintos, ninguno repetido.
      **Hecho (R21):** la primera página (sin cursor) contiene el mensaje **más reciente** y no el
      más antiguo; la siguiente contiene el inmediatamente anterior.
      **Hecho (R16):** la página contiene mensajes `entrante` **y** `saliente`.
      **Hecho (R40):** sembrada la secuencia entrante→saliente→entrante→saliente,
      `expect(res.mensajes.map(m => m.direccion))
        .toEqual(["entrante","saliente","entrante","saliente"])` — entrelazados por tiempo, **no**
      agrupados por dirección.
      **Depende de:** T3.1.

- [ ] **T3.5 — Reacciones agregadas sobre la página, incluidas las de otra fila del grupo.**
      **Hecho (R28):** sembrado un mensaje con `wa_message_id = W` y una reacción a `W` **fuera** de
      la ventana de la página (y, en un segundo caso, en **otra** `chat_conversacion` del mismo
      grupo): `expect(res.mensajes.some(m => m.tipo === "reaccion")).toBe(false)` y
      `expect(res.mensajes.find(m => m.waMessageId === W).reacciones).toHaveLength(1)`.
      **Depende de:** T3.4, T3.2.

- [ ] **T3.6 — `HistoricoConversacionesService`: autorización, no-escritura y hilo completo.**
      **Hecho (R10/R7):** `tests/unit/services/historico-conversaciones-service.test.ts` → para cada
      rol no permitido, `expect(await service.listar(actor, {})).toEqual({ status: "forbidden" })` y
      `expect(repoDoble.listarHilos).not.toHaveBeenCalled()`.
      **Hecho (R25):** el doble de Prisma **lanza** ante `update`, `create`, `upsert`, `delete` y
      `$executeRaw`; se ejecutan las dos operaciones del histórico y ninguna lanza →
      **ninguna escritura**. Además `expect(prismaDoble.chatConversacion.update).not.toHaveBeenCalled()`
      cubre explícitamente `mensajero_leido_at`.
      **Hecho (R17):** `listarMensajes` **no acepta** parámetros de fecha (el zod los rechaza:
      `safeParse({ordenId, mensajeroId, fecha_desde}).success === false`) y, sembrado un hilo con
      mensajes de dos meses, la paginación completa devuelve **todos** aunque el listado se hubiera
      filtrado por un solo día.
      **Hecho (R41):** `expect(Object.keys(res.items[0])).not.toContain("mensajes")` y
      `expect(repoDoble.listarMensajes).not.toHaveBeenCalled()` tras invocar **sólo** el listado.
      **Depende de:** T3.1, T3.4.

- [ ] **T3.7 — Server Actions `lib/actions/historico-conversaciones.ts`.**
      **Hecho (R38):** `tests/integration/actions/historico-conversaciones-action.test.ts` → entradas
      inválidas devuelven `{ status: "validation_error" }` y
      `expect(serviceDoble.listar).not.toHaveBeenCalled()`.
      **Hecho:** sin sesión, `{ status: "unauthenticated" }` sin tocar el service.
      **Depende de:** T3.6, T2.1.

---

## Bloque 4 — Ensanche de autorización de media (R26, R29, R30) — P5

- [ ] **T4.1 — `ChatMensajeRepository.findMediaParaLectorHistorico(mensajeId)`** (design §4).
      Misma consulta menos la condición del mensajero; conserva `o.deleted_at IS NULL` y el `m.id`
      **sin** `::uuid`.
      **Hecho (R29):** `tests/integration/repositories/chat-media-historico.int.test.ts` → devuelve
      fila para un mensaje de una orden asignada a **otro** mensajero.
      **Hecho (R12):** con la orden borrada, devuelve `null`.

- [ ] **T4.2 — Bifurcación por rol en `app/api/chat/media/[mensajeId]/route.ts`.**
      **Hecho (R29):** `tests/integration/api/chat-media-historico.test.ts` → actor `admin` que NO es
      el mensajero → `expect(res.status).toBe(200)` con el `Content-Type` correcto.
      **Hecho (R30):** actor `adminSatelite`, `adminTienda` y `mensajero` ajeno →
      `expect(res.status).toBe(403)` **y** `expect(descargadorDoble.descargar).not.toHaveBeenCalled()`.
      **Hecho (R26):** el mensajero **asignado** sigue recibiendo `200`.
      **Depende de:** T4.1, T1.1.

- [ ] **T4.3 — No-regresión de la autorización del mensajero.**
      **Hecho (R26):** los tests existentes del scope del mensajero siguen verdes **sin
      modificarse**: `findByOrdenParaMensajero(orden, otroMensajero)` → `null`. Se corre
      `pnpm exec vitest related --run lib/repositories/ChatConversacionRepository.ts
      lib/repositories/ChatMensajeRepository.ts` y se pega la salida en `progress/impl_318.md`.
      **Depende de:** T4.1.

---

## Bloque 5 — UI: filtros (R32-R37, R39)

- [ ] **T5.1 [P] — `historico-filtros-def.ts`** (función pura → `FilterDef[]`, design §5.3).
      **Hecho (R32):** `tests/unit/components/historico-filtros-def.test.ts` →
      `expect(defs.map(d => d.key)).toEqual(["q","mensajero_id","fecha","orden"])` y
      `expect(defs.map(d => d.kind)).toEqual(["text","multi","dateRange","text"])`.
      **Hecho (R37):** `expect(defs[0].minChars).toBe(BUSQUEDA_MIN_CHARS)` **importando la
      constante**, no el número 3.
      **Hecho (R33):** con catálogo de 2 mensajeros, `expect(defs[1].options)` los lista; con
      catálogo vacío, la barra se declara igual con `options: []` (no revienta).

- [ ] **T5.2 [P] — `seleccion-a-filtro.ts`.**
      **Hecho (R32/R38):** `tests/unit/components/historico-seleccion-a-filtro.test.ts` →
      `expect(seleccionAFiltro({ mensajero_id: [] })).toEqual({})` (lista vacía **omitida**, jamás
      `[]`); `expect(seleccionAFiltro({ q: ["ma"] }).q).toBeUndefined()` por debajo del mínimo;
      `seleccionAFiltro({ fecha: ["7d","",""] })` produce el rango del atajo y **no** manda atajo y
      rango a la vez; `expect(seleccionAFiltro({ orden: ["1001"] }).orden).toBe("1001")` (escalar,
      no lista).

- [ ] **T5.3 — Barra montada en la pantalla.**
      **Hecho (R32):** `tests/components/HistoricoFiltros.test.tsx` → `getByRole("searchbox")` con el
      `aria-label` de `BuscadorFiltros`, y abrir «Filtros» muestra un `role="listbox"` con
      «Mensajero», «Fecha» y «Orden».
      **Hecho (R37):** escribiendo `"ma"`, `expect(onBuscar).not.toHaveBeenCalled()` y aparece el
      aviso de caracteres restantes; escribiendo `"mar"`, tras el debounce
      `expect(onBuscar).toHaveBeenCalledWith("mar")`.
      **Depende de:** T5.1, T5.2.

- [ ] **T5.4 — Aviso de fecha diferenciada al abrir un hilo. [NUEVO — P2]**
      **Hecho (R39):** `tests/components/HistoricoFechaDiferenciada.test.tsx` →
      (a) con rango aplicado y un hilo abierto,
      `expect(getByText(/se muestra la conversación completa/i)).toBeInTheDocument()`;
      (b) **sin** rango aplicado, `expect(queryByText(/conversación completa/i)).toBeNull()`;
      (c) el hilo abierto con rango aplicado sigue mostrando mensajes **fuera** del rango
      (`expect(getByText("mensaje de otro mes")).toBeInTheDocument()`), que es la mitad de R17 que se
      ve en pantalla.
      **Depende de:** T5.3, T6.2.

---

## Bloque 6 — UI: listado e hilo (R11, R13, R16, R18, R21-R24, R28, R31, R40-R43)

- [ ] **T6.1 — `HilosLista` con scroll infinito y sin mensajes.**
      **Hecho (R13/R11):** `tests/components/HistoricoHilosLista.test.tsx` → con la primera página
      servida por el doble de la acción se ven las filas con guía, destinatario y mensajero; al
      disparar el `IntersectionObserver` del centinela,
      `expect(accionDoble).toHaveBeenCalledWith(expect.objectContaining({ cursor: <el devuelto> }))`
      y la lista pasa a tener las filas de las dos páginas **sin duplicados**.
      **Hecho (R41):** al renderizar el listado **sin abrir ningún hilo**,
      `expect(accionMensajesDoble).not.toHaveBeenCalled()`; al hacer clic en una fila, se llama
      **una** vez con `{ ordenId, mensajeroId }`.
      **Hecho (R43):** una fila cuyo hilo fusiona dos números muestra el distintivo «2 números» y el
      número vigente enmascarado; una fila de un solo número **no** muestra el distintivo.
      **Hecho (R44):** dos filas de la misma orden con mensajeros distintos se renderizan como dos
      elementos de lista con nombres de mensajero distintos.
      **Depende de:** T3.7.

- [ ] **T6.2 — `HistoricoHilo`: burbujas reutilizadas + separador de día.**
      **Hecho (R16/R40):** hay `li[data-direccion="entrante"]` y `li[data-direccion="saliente"]`, y
      el orden del DOM coincide con el orden cronológico devuelto (no hay pestañas ni secciones por
      dirección: `expect(queryByRole("tablist")).toBeNull()`).
      **Hecho (R23):** `expect(getByText("hoy")).toBeInTheDocument()` para los mensajes del día en
      curso, `getByText("ayer")` para los del anterior y `getByText("miércoles 26 de agosto")` para
      uno más antiguo; cada separador aparece **una sola vez** aunque el día tenga tres mensajes; y
      `expect(container.textContent).not.toMatch(/\bde 20\d{2}\b/)` (nunca año).
      **Hecho (R28):** un mensaje con reacción muestra el emoji anclado a su burbuja y
      `expect(queryByText("Reacción a un mensaje")).toBeNull()`.
      **Hecho (R43):** la cabecera rotula orden, destinatario y mensajero; y el cambio de número se
      lee **dentro** del hilo como burbuja de sistema
      (`expect(getByText(/cambió .* número/i)).toBeInTheDocument()`), no en la cabecera.
      **Depende de:** T2.3, T3.7.

- [ ] **T6.3 — Scroll inverso que no salta.**
      **Hecho (R18):** en el primer render se pide **una** página:
      `expect(accionDoble).toHaveBeenCalledTimes(1)` y hay 30 burbujas, no 100.
      **Hecho (R21):** la burbuja del mensaje más reciente está en el DOM en el primer render.
      **Hecho (R22):** con `scrollHeight` simulado (2000 → 4000 al insertar la página anterior) y
      `scrollTop = 0` al disparar el centinela superior, `expect(contenedor.scrollTop).toBe(2000)`
      tras la inserción. Este `assert` mata la implementación ingenua.
      **Depende de:** T6.2.

- [ ] **T6.4 — Media dentro del histórico.**
      **Hecho (R31):** `tests/components/HistoricoMediaExpirada.test.tsx` → con `fetch` devolviendo
      `410`, `expect(getByText("Este archivo ya no está disponible.")).toBeInTheDocument()` y las
      demás burbujas **siguen renderizadas** (`expect(getAllByRole("listitem")).toHaveLength(n)`).
      **Hecho (trampa (d)):** un adjunto `saliente` expone el nombre accesible «que enviaste» y no
      «enviada por el cliente» (`expect(getByLabelText(/que enviaste/i)).toBeInTheDocument()`).
      **Depende de:** T6.2, T4.2.

- [ ] **T6.5 — Solo lectura.**
      **Hecho (R24):** `tests/components/HistoricoSoloLectura.test.tsx` → renderizado el hilo con
      mensajes, `expect(queryByRole("textbox")).toBeNull()`,
      `expect(queryByRole("button", { name: /enviar/i })).toBeNull()`,
      `expect(queryByRole("button", { name: /adjuntar/i })).toBeNull()` y
      `expect(queryByRole("group", { name: /plantillas/i })).toBeNull()`.
      **Hecho (R25, complemento de T3.6):** el módulo se renderiza con dobles de las acciones de
      envío y `expect(enviarMensajeChatDoble).not.toHaveBeenCalled()` tras interactuar con el hilo.
      **Depende de:** T6.2.

---

## Bloque 7 — Invariantes, guardias y cierre

- [ ] **T7.1 — Guardia de la 229 y del middleware.**
      Correr `pnpm exec vitest run tests/unit/guards/rastreo-sin-ruta-nueva.guardia.test.ts`.
      **Hecho:** verde **sin haber modificado** ese archivo ni `middleware.ts`. El design §3.4
      argumenta por qué una ruta nueva bajo `app/(app)/` no lo enrojece; **este comando es la
      prueba**. Si saliera rojo, se para y se reabre §3.4 con el humano (no se «ajusta» la lista
      firmada de `PUBLIC_ROUTES`).
      **Depende de:** T1.4.

- [ ] **T7.2 — Guardia: sin migración ni cambio de esquema.**
      `tests/unit/guards/historico-sin-migracion.guardia.test.ts`.
      **Hecho (R27):**
      (a) `expect(readdirSync("db/migrations").filter(d => /historic|conversacion_histor/i.test(d))).toEqual([])`;
      (b) **no** se mide el diff de la rama (una guardia que mide el diff caduca al mergear —
      lección ya pagada aquí), sino la **propiedad**: el esquema sigue teniendo exactamente los
      objetos que la feature usa y **ninguno nuevo** —
      `expect(SCHEMA).toContain("@@index([conversacionId, ocurridoAt])")`,
      `expect(SCHEMA).toMatch(/@@unique\(\[ordenId, telefonoE164\]\)/)`,
      `expect(SCHEMA.toLowerCase()).not.toContain("historicoconversacion")`;
      (c) **el límite de R45 sigue siendo real**: `expect(SCHEMA_MODELO_CHAT_MENSAJE)
      .not.toMatch(/mensajeroId/)` — si alguien añadiera esa columna, esta guardia se pone roja y
      obliga a reabrir R45 con el humano en vez de colar la migración de refilón.
      **Depende de:** todo el bloque 3.

- [ ] **T7.3 — Mapa `R<n> → test` completo en `progress/impl_318.md`.**
      **Hecho:** los **45** requisitos aparecen con su archivo de test y el nombre del `it(...)` que
      los cubre; ninguno vacío. El reviewer rechaza si falta uno (`docs/verification.md`).

- [ ] **T7.4 — Gate.**
      `./init.sh --rapido` en verde antes del PR. El diff no toca `db/`, `lib/types/**`,
      `middleware.ts`, configuración de build ni nombres de dinero, así que el modo rápido **no se
      niega**; si se negara, es señal de que el alcance creció y hay que **parar**, no correr el
      completo por inercia.
      **Hecho:** salida real pegada en `progress/impl_318.md`, con el baseline de `dev` **medido en
      la misma sesión** (los rojos ajenos no se cuentan como propios, pero tampoco se esconden).
      **Depende de:** todo.

- [ ] **T7.5 — Deuda y límites declarados.**
      Registrar en `progress/impl_318.md`: (a) la promoción pendiente de las burbujas del chat a
      `components/shared/chat/` (A1), con el coste medido (13 tests + `ChatConversacion.tsx`);
      (b) el **límite de atribución tras reasignación** (R45/A10) y qué haría falta para levantarlo
      (columna `mensajero_id` en `chat_mensaje` = migración = decisión humana); (c) que la **purga
      del histórico es un cron futuro** (P9), fuera de esta feature.
      **Hecho:** las tres entradas existen y citan archivos y requisitos por nombre.

---

## Orden sugerido y paralelismo

```
T0  (medición, no bloquea)
 ├─ Bloque 1 (T1.1 → T1.2 → T1.3 / T1.4 → T1.5)     ┐
 └─ Bloque 2 (T2.1 [P] T2.2 [P] T2.3 [P] T2.4)      ├─ a la vez
    └─ Bloque 3 (T3.1 → T3.2 [P] T3.3 [P] T3.4 → T3.5 → T3.6 → T3.7)
       ├─ Bloque 4 (T4.1 → T4.2 → T4.3)     [P] con el bloque 5
       └─ Bloque 5 (T5.1 [P] T5.2 → T5.3 → T5.4)
          └─ Bloque 6 (T6.1 / T6.2 → T6.3 / T6.4 / T6.5)
             └─ Bloque 7 (T7.1 [P] T7.2 → T7.3 → T7.4 → T7.5)
```

Un commit por tarea lógica completada (`docs/conventions.md`), con mensaje
`feat(318): …` / `test(318): …`.
