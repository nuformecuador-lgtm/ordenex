# Feature 318 — Tareas

> Checklist de pasos discretos y verificables. `[P]` = paralelizable con las tareas de su mismo
> bloque. Cada tarea tiene criterio de **hecho**; ningún criterio es «existe el archivo» ni «el
> comentario dice X» — se satisfacen con un `assert` de comportamiento (hay precedente en este repo
> de un criterio tipo grep que se cumplía reescribiendo un comentario).
>
> **Puerta humana:** este spec está en `spec_ready`. No se escribe código de producción hasta que el
> humano responda a las **nueve preguntas abiertas** de `requirements.md`. `T0` es la única tarea
> que se puede ejecutar antes, porque es una MEDICIÓN y no toca código.

---

## Bloque 0 — Medir antes de escribir (bloqueante de T3)

- [ ] **T0 — Medir el volumen real de las dos tablas.**
      Contar `chat_conversacion` y `chat_mensaje` en la base real, y el máximo de mensajes por
      conversación.
      **Hecho:** el número queda escrito en `progress/impl_318.md` con fecha y método. Si
      `chat_conversacion` supera el umbral de **P8** (~50.000), **se para y se consulta al humano**
      antes de continuar (la salida es A6 del design, que es una migración y manda el gate al modo
      completo).
      **Depende de:** nada. **Bloquea:** T3.1.

---

## Bloque 1 — Menú, roles y ruta (R1-R9)

- [ ] **T1.1 — Constante `ROLES_HISTORICO_CONVERSACIONES` en `lib/auth/menu-visibility.ts`.**
      Whitelist propia `["maestro","admin"] as const satisfies readonly RolValue[]` (design §3.1).
      **Hecho (R1):** `tests/unit/auth/menu-historico.test.ts` →
      `expect([...ROLES_HISTORICO_CONVERSACIONES].sort()).toEqual(["admin","maestro"])`.

- [ ] **T1.2 — `IconKey` nueva `"history"` + entrada en `ICON_BY_KEY` del Sidebar.**
      **Hecho (R6):** `tests/components/Sidebar.test.tsx` →
      (a) renderizado el Sidebar con actor `maestro`, el ítem «Histórico» monta un `<svg>`
      (`expect(item.querySelector("svg")).not.toBeNull()`);
      (b) `tests/unit/auth/menu-historico.test.ts` → para cada ítem de `SIDEBAR_ITEMS`,
      `expect(typeof item.iconKey).toBe("string")` (nada de componentes cruzando el borde RSC);
      (c) `expect(Object.keys(ICON_BY_KEY)).toContain("history")` **y** el mapa cubre todas las
      claves usadas: `for (const it of SIDEBAR_ITEMS) expect(ICON_BY_KEY[it.iconKey]).toBeTypeOf("function")`.
      **Depende de:** T1.1.

- [ ] **T1.3 — Ítem «Histórico» con subítem «Conversaciones» en `SIDEBAR_ITEMS`, en la ÚLTIMA
      posición del bloque de administración.**
      **Hecho (R2):** `tests/unit/auth/menu-historico.test.ts` →
      `expect(item.roles).toBe(ROLES_HISTORICO_CONVERSACIONES)` (**identidad de referencia**, `toBe`
      y no `toEqual`: mata la mutación «copiar el literal»).
      **Hecho (R3):** `expect(item.children).toEqual([{ label: "Conversaciones", href: "/historico/conversaciones" }])`
      y `expect("roles" in item.children[0]).toBe(false)`.
      **Hecho (R4):** para cada rol de `RolValue`,
      `expect(itemsVisibles(SIDEBAR_ITEMS, {rol}).some(i => i.label === "Histórico"))
       .toBe(["maestro","admin"].includes(rol))`.
      **Hecho (R5):** `expect(itemsVisibles(SIDEBAR_ITEMS, null).some(i => i.label === "Histórico")).toBe(false)`.
      **Hecho (R9):** `expect(primerDestino(itemsVisibles(SIDEBAR_ITEMS, {rol})))
       .toBe(<href esperado por rol>)` para los seis roles, con la tabla de destinos escrita como
      literal en el test (maestro/admin `/dashboard`, mensajero `/mis-asignaciones/reparto`,
      adminSatelite `/recepcion-satelite/por-recibir`, adminTienda `/ordenes`) — si el ítem se
      moviera arriba, este test se pone rojo.
      **Depende de:** T1.1, T1.2.

- [ ] **T1.4 — Ruta `app/(app)/historico/conversaciones/page.tsx` con gate `notFound()`.**
      Lee `ROLES_HISTORICO_CONVERSACIONES`; sin literales de rol (design §3.3).
      **Hecho (R7):** `tests/components/HistoricoConversacionesPage.test.tsx` → con
      `resolveActorFromSession` mockeado a cada rol NO permitido y a `null`,
      `await expect(HistoricoConversacionesPage()).rejects.toThrow()` y
      `expect(notFoundSpy).toHaveBeenCalled()`; con `maestro` y con `admin`, no lanza.
      **Hecho (R7, «antes de consultar»):** el doble del service se pasa por `deps` y
      `expect(serviceSpy).not.toHaveBeenCalled()` en los casos denegados.
      **Depende de:** T1.1.

- [ ] **T1.5 — Guardia: ítem y gate no pueden divergir.**
      `tests/unit/guards/historico-roles-una-sola-fuente.guardia.test.ts`.
      **Hecho (R8):** sobre el fuente **sin comentarios** de `app/(app)/historico/conversaciones/page.tsx`
      (`codigoSinComentarios`, el quitador del repo),
      `expect(fuente).not.toMatch(/"(maestro|admin|adminSatelite|adminTienda|mensajero|apiKey)"/)`
      **y** `expect(fuente).toContain("ROLES_HISTORICO_CONVERSACIONES")`; más una **CONTRAPRUEBA**
      que aplica la mutación en memoria (sustituir la constante por el literal) y comprueba que la
      aserción cazaría el cambio.
      **Hecho (R1, whitelist cerrada):** en el mismo archivo,
      `for (const rol of ["adminSatelite","adminTienda","mensajero","apiKey"])
       expect(ROLES_HISTORICO_CONVERSACIONES).not.toContain(rol)`.
      **Depende de:** T1.1, T1.4.

---

## Bloque 2 — Contratos y borde tipado (R38) `[P]` con el bloque 1

- [ ] **T2.1 [P] — `lib/types/historico-conversaciones.ts`:** DTOs + esquemas zod de las dos
      entradas (design §2.2, §2.3), con `.strict()`.
      **Hecho (R38):** `tests/unit/types/historico-conversaciones-schema.test.ts` →
      `expect(listarConversacionesSchema.safeParse({ filtro: { mensajero_id: [] } }).success).toBe(false)`;
      idem con `fecha_desde: "28/08/2026"`, con `limite: 0`, con `limite: 999`, con
      `cursor: { id: "x" }` (sin la marca temporal) y con una clave desconocida.

- [ ] **T2.2 [P] — Interfaces `IHistoricoConversacionesRepository` / `…Service`.**
      **Hecho:** el service se instancia en los tests con dobles que implementan la interfaz; el
      typecheck (`pnpm run typecheck`) pasa en cero errores.

- [ ] **T2.3 [P] — `lib/utils/separador-dia-cr.ts`.**
      **Hecho (R23):** `tests/unit/utils/separador-dia-cr.test.ts` →
      `expect(separadorDia("2026-08-27T18:30:00Z", { ahora: new Date("2026-08-28T12:00:00Z") }))
        .toBe("jueves 27 de agosto")`;
      año presente cuando toca:
      `expect(separadorDia("2025-08-28T18:00:00Z", { ahora: ... 2026 })).toBe("jueves 28 de agosto de 2025")`;
      **frontera de zona horaria**: `"2026-08-29T05:00:00Z"` (23:00 CR del 28) →
      `"viernes 28 de agosto"` **y no** el 29 (esto es lo que mata la mutación «formatear en UTC» o
      «en la zona del navegador»).

- [ ] **T2.4 [P] — `lib/utils/busqueda-texto-sql.ts`** (espejo SQL de `normalizarTerminoBusqueda`).
      **Hecho (R36, paridad):** `tests/integration/db/busqueda-texto-sql-paridad.test.ts` →
      para un corpus con acentos, mayúsculas y espacios múltiples,
      `expect(await prisma.$queryRaw(sqlNormalizarTextoBusqueda("$1")))
        .toBe(normalizarTerminoBusqueda(entrada))` en **cada** caso.

---

## Bloque 3 — Repositorio y service (R10-R15, R17-R20, R25, R28, R33-R37)

- [ ] **T3.1 — `HistoricoConversacionesRepository.listarConversaciones`** (design §2.4).
      **Hecho (R10):** `tests/integration/repositories/historico-conversaciones.int.test.ts` →
      sembradas 3 conversaciones de 3 mensajeros distintos, `expect(items).toHaveLength(3)` (el repo
      NO recibe scope de mensajero).
      **Hecho (R11):** `expect(items[0]).toMatchObject({ numGuia, numRemision, destinatario, mensajeroNombre, ultimaActividadAt })`
      con los valores sembrados.
      **Hecho (R12):** tras `update orden set deleted_at = now()`,
      `expect(items.map(i => i.ordenId)).not.toContain(ordenBorradaId)`.
      **Hecho (R13):** `expect(sql).not.toMatch(/OFFSET/i)` sobre la consulta capturada **y**
      paginar dos veces con cursor devuelve el conjunto completo sin repetir.
      **Hecho (R14):** `expect(items.map(i => i.conversacionId)).toEqual([masReciente, medio, masAntiguo])`.
      **Hecho (R15):** con **tres** conversaciones de `ultima_actividad_at` **idéntica** y
      `limite: 2`, la unión de las dos páginas tiene exactamente 3 ids **distintos**.
      **Depende de:** T0, T2.1, T2.2.

- [ ] **T3.2 — Filtros del repositorio.**
      **Hecho (R33):** con `mensajero_id: [m1]`, `expect(items.every(i => i.mensajeroId === m1)).toBe(true)`
      y una conversación de `m2` queda fuera.
      **Hecho (R34):** con `fecha_desde = fecha_hasta = "2026-08-15"`, entra la conversación cuyo
      único mensaje es `2026-08-16T05:00:00Z` (= 23:00 CR del 15) y **queda fuera** la del
      `2026-08-16T06:00:00Z` (= 00:00 CR del 16). Este par de casos es el que mata el uso de
      `startOfDayCR` en vez de `inicioDelDiaCREnUtc`.
      **Hecho (R35):** con `orden: "<num_remision>"`, devuelve **las dos** conversaciones de esa
      orden (dos teléfonos) y ninguna de otra orden; con `orden: "<num_guia>"`, idem.
      **Hecho (R36):** cuatro casos, uno por dato — destinatario («maría» encuentra «MARÍA
      GONZÁLEZ»), `num_guia`, `num_remision` y **nombre del mensajero** — y un caso negativo
      (término que no casa nada → `items: []`).
      **Depende de:** T3.1, T2.4.

- [ ] **T3.3 — `listarMensajes` con cursor descendente.**
      **Hecho (R18):** sembrados 100 mensajes, `expect(res.mensajes).toHaveLength(30)`.
      **Hecho (R19):** `expect(sql).not.toMatch(/OFFSET/i)`; la consulta filtra por
      `(ocurrido_at, id) < (cursor)`.
      **Hecho (R20):** con **cinco** mensajes de `ocurrido_at` idéntico y `limite: 2`, recorrer el
      hilo entero por cursor devuelve exactamente 5 ids distintos y ninguno repetido.
      **Hecho (R21):** la primera página (sin cursor) contiene el mensaje **más reciente** y no
      contiene el más antiguo; la siguiente contiene el inmediatamente anterior.
      **Hecho (R16):** la página incluye mensajes con `direccion: "entrante"` **y** `"saliente"`.
      **Depende de:** T3.1.

- [ ] **T3.4 — Reacciones agregadas sobre la página (design §2.3).**
      **Hecho (R28):** sembrado un mensaje con `wa_message_id = W` y una reacción a `W` **fuera** de
      la ventana de la página, `expect(res.mensajes.some(m => m.tipo === "reaccion")).toBe(false)` y
      `expect(res.mensajes.find(m => m.waMessageId === W).reacciones).toHaveLength(1)`.
      **Depende de:** T3.3.

- [ ] **T3.5 — `HistoricoConversacionesService`: autorización y no-escritura.**
      **Hecho (R10/R7):** `tests/unit/services/historico-conversaciones-service.test.ts` → para cada
      rol no permitido, `expect(await service.listar(actor, {})).toEqual({ status: "forbidden" })` y
      `expect(repoDoble.listarConversaciones).not.toHaveBeenCalled()`.
      **Hecho (R25):** el doble de Prisma lanza ante `update`, `create`, `upsert`, `delete` y
      `$executeRaw`; se ejecutan las dos operaciones del histórico y
      `await expect(...).resolves.toBeDefined()` (no lanza) → **ninguna escritura**. Además
      `expect(prismaDoble.chatConversacion.update).not.toHaveBeenCalled()` cubre explícitamente
      `mensajero_leido_at`.
      **Hecho (R17):** `listarMensajes` **no acepta** parámetros de fecha: el esquema zod los
      rechaza (`safeParse({conversacionId, fecha_desde}).success === false`) y, sembrado un hilo con
      mensajes de dos meses, la paginación completa devuelve **todos** aunque el listado se hubiera
      filtrado por un solo día.
      **Depende de:** T3.1, T3.3.

- [ ] **T3.6 — Server Actions `lib/actions/historico-conversaciones.ts`.**
      **Hecho (R38):** `tests/integration/actions/historico-conversaciones-action.test.ts` →
      entradas inválidas devuelven `{ status: "validation_error" }` y
      `expect(serviceDoble.listar).not.toHaveBeenCalled()`.
      **Hecho:** sin sesión, `{ status: "unauthenticated" }` sin tocar el service.
      **Depende de:** T3.5, T2.1.

---

## Bloque 4 — Ensanche de autorización de media (R26, R29, R30)

- [ ] **T4.1 — `ChatMensajeRepository.findMediaParaLectorHistorico(mensajeId)`** (design §4).
      Misma consulta menos la condición del mensajero; conserva `o.deleted_at IS NULL` y el `m.id`
      **sin** `::uuid`.
      **Hecho (R29):** `tests/integration/repositories/chat-media-historico.int.test.ts` →
      devuelve fila para un mensaje de una orden asignada a **otro** mensajero.
      **Hecho (R12):** con la orden borrada, devuelve `null`.

- [ ] **T4.2 — Bifurcación por rol en `app/api/chat/media/[mensajeId]/route.ts`.**
      **Hecho (R29):** `tests/integration/api/chat-media-historico.test.ts` → actor `admin` que NO
      es el mensajero → `expect(res.status).toBe(200)` y `Content-Type` correcto.
      **Hecho (R30):** actor `adminSatelite`, `adminTienda` y `mensajero` ajeno →
      `expect(res.status).toBe(403)` **y** `expect(descargadorDoble.descargar).not.toHaveBeenCalled()`
      (no se toca la Graph API).
      **Hecho (R26):** el mensajero **asignado** sigue recibiendo `200`; el flujo anterior no cambia.
      **Depende de:** T4.1, T1.1.

- [ ] **T4.3 — No-regresión de la autorización del mensajero.**
      **Hecho (R26):** `tests/unit/repositories/chat-conversacion-scope-mensajero.test.ts` (o el test
      existente equivalente) sigue verde **sin modificarse**:
      `findByOrdenParaMensajero(orden, otroMensajero)` → `null`. Se corre `pnpm exec vitest related
      --run lib/repositories/ChatConversacionRepository.ts lib/repositories/ChatMensajeRepository.ts`
      y se pega la salida en `progress/impl_318.md`.
      **Depende de:** T4.1.

---

## Bloque 5 — UI: filtros (R32-R37)

- [ ] **T5.1 [P] — `historico-filtros-def.ts`** (función pura → `FilterDef[]`, design §5.3).
      **Hecho (R32):** `tests/unit/components/historico-filtros-def.test.ts` →
      `expect(defs.map(d => d.key)).toEqual(["q","mensajero_id","fecha","orden"])`;
      `expect(defs.map(d => d.kind)).toEqual(["text","multi","dateRange","text"])`.
      **Hecho (R37):** `expect(defs[0].minChars).toBe(BUSQUEDA_MIN_CHARS)` **importando la
      constante**, no el número 3 (si el borde sube el mínimo, el control lo sigue solo).
      **Hecho (R33):** con catálogo de 2 mensajeros,
      `expect(defs[1].options).toEqual([{value:m1,label:"…"},{value:m2,label:"…"}])`;
      con catálogo vacío, la barra se declara igual con `options: []` (no revienta).

- [ ] **T5.2 [P] — `seleccion-a-filtro.ts`.**
      **Hecho (R32/R38):** `tests/unit/components/historico-seleccion-a-filtro.test.ts` →
      `expect(seleccionAFiltro({ mensajero_id: [] })).toEqual({})` (lista vacía **omitida**, jamás
      `[]`); `expect(seleccionAFiltro({ q: ["ma"] }).q).toBeUndefined()` por debajo del mínimo;
      `seleccionAFiltro({ fecha: ["7d","",""] })` produce el rango del atajo y **no** manda atajo y
      rango a la vez.

- [ ] **T5.3 — Barra montada en la pantalla.**
      **Hecho (R32):** `tests/components/HistoricoFiltros.test.tsx` → `getByRole("searchbox")`
      existe con el `aria-label` de `BuscadorFiltros`, y abrir «Filtros» muestra un
      `role="listbox"` con las opciones «Mensajero», «Fecha» y «Orden».
      **Hecho (R37):** escribiendo `"ma"`, `expect(onBuscar).not.toHaveBeenCalled()` y aparece el
      aviso de caracteres restantes; escribiendo `"mar"`, tras el debounce
      `expect(onBuscar).toHaveBeenCalledWith("mar")`.
      **Depende de:** T5.1, T5.2.

---

## Bloque 6 — UI: listado e hilo (R16, R18, R21-R24, R28, R31)

- [ ] **T6.1 — `ConversacionesLista` con scroll infinito.**
      **Hecho (R13/R11):** `tests/components/HistoricoConversacionesLista.test.tsx` → con la primera
      página servida por el doble de la acción, se ven las filas con guía, destinatario y mensajero;
      al disparar el `IntersectionObserver` del centinela,
      `expect(accionDoble).toHaveBeenCalledWith(expect.objectContaining({ cursor: <el devuelto> }))`
      y la lista pasa a tener las filas de las dos páginas, **sin duplicados**.
      **Depende de:** T3.6.

- [ ] **T6.2 — `HistoricoHilo`: burbujas reutilizadas + separador de día.**
      **Hecho (R16):** `tests/components/HistoricoHilo.test.tsx` → hay `li[data-direccion="entrante"]`
      y `li[data-direccion="saliente"]`.
      **Hecho (R23):** `expect(getByText("jueves 27 de agosto")).toBeInTheDocument()` y aparece
      **una sola vez** aunque el día tenga tres mensajes; con mensajes de dos días, hay dos
      separadores en el orden correcto.
      **Hecho (R28):** un mensaje con reacción muestra el emoji anclado a su burbuja y
      `expect(queryByText("Reacción a un mensaje")).toBeNull()`.
      **Depende de:** T2.3, T3.6.

- [ ] **T6.3 — Scroll inverso que no salta.**
      **Hecho (R18):** en el primer render se pide **una** página:
      `expect(accionDoble).toHaveBeenCalledTimes(1)` y hay 30 burbujas, no 100.
      **Hecho (R21):** la burbuja del mensaje más reciente está en el DOM en el primer render.
      **Hecho (R22):** con `scrollHeight` simulado (2000 → 4000 al insertar la página anterior) y
      `scrollTop = 0` al disparar el centinela superior,
      `expect(contenedor.scrollTop).toBe(2000)` tras la inserción — es decir, el desplazamiento se
      corrige por el alto añadido y el mensaje que se leía sigue a la vista. Este `assert` es el que
      mata la implementación ingenua.
      **Depende de:** T6.2.

- [ ] **T6.4 — Media dentro del histórico.**
      **Hecho (R31):** `tests/components/HistoricoMediaExpirada.test.tsx` → con `fetch` devolviendo
      `410`, `expect(getByText("Este archivo ya no está disponible.")).toBeInTheDocument()` y las
      demás burbujas del hilo **siguen renderizadas** (`expect(getAllByRole("listitem").length).toBe(n)`).
      **Hecho (trampa (d)):** un adjunto `saliente` expone el nombre accesible «que enviaste» y
      **no** «enviada por el cliente» (`expect(getByLabelText(/que enviaste/i)).toBeInTheDocument()`).
      **Depende de:** T6.2, T4.2.

- [ ] **T6.5 — Solo lectura.**
      **Hecho (R24):** `tests/components/HistoricoSoloLectura.test.tsx` → renderizado el hilo con
      mensajes, `expect(queryByRole("textbox")).toBeNull()`,
      `expect(queryByRole("button", { name: /enviar/i })).toBeNull()`,
      `expect(queryByRole("button", { name: /adjuntar/i })).toBeNull()` y
      `expect(queryByRole("group", { name: /plantillas/i })).toBeNull()`.
      **Hecho (R25, complemento del T3.5):** el módulo se renderiza con un doble de las acciones de
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
      (b) `expect(git.diff("db/schema.prisma")).toBe("")` no sirve (mide la rama y caduca al
      mergear — lección ya pagada aquí), así que se afirma **la propiedad**: el esquema **sigue
      teniendo** exactamente los objetos que la feature usa y **ninguno nuevo de histórico** —
      `expect(SCHEMA).toContain("@@index([conversacionId, ocurridoAt])")`,
      `expect(SCHEMA).toMatch(/@@unique\(\[ordenId, telefonoE164\]\)/)`,
      y `expect(SCHEMA.toLowerCase()).not.toContain("historicoconversacion")`.
      **Depende de:** todo el bloque 3.

- [ ] **T7.3 — Mapa `R<n> → test` completo en `progress/impl_318.md`.**
      **Hecho:** los **38** requisitos aparecen con su archivo de test y el nombre del `it(...)` que
      los cubre; ninguno vacío. El reviewer rechaza si falta uno (`docs/verification.md`).

- [ ] **T7.4 — Gate.**
      `./init.sh --rapido` en verde antes del PR. El diff no toca `db/`, `lib/types/**`,
      `middleware.ts`, configuración de build ni nombres de dinero, así que el modo rápido **no se
      niega**; si se negara, es señal de que el alcance creció y hay que correr `./init.sh` completo.
      **Hecho:** salida real pegada en `progress/impl_318.md`, con el baseline de `dev` **medido en
      la misma sesión** (los rojos ajenos de `dev` no se cuentan como propios, pero tampoco se
      esconden).
      **Depende de:** todo.

- [ ] **T7.5 — Deuda declarada.**
      Registrar en `progress/impl_318.md` la promoción pendiente de las burbujas del chat a
      `components/shared/chat/` (A1 del design), con el coste medido (13 tests + `ChatConversacion.tsx`)
      y la razón de aplazarla.
      **Hecho:** la entrada existe y cita los archivos por nombre.

---

## Orden sugerido y paralelismo

```
T0
 └─ Bloque 1 (T1.1 → T1.2 → T1.3 / T1.4 → T1.5)      ┐
    Bloque 2 (T2.1 [P] T2.2 [P] T2.3 [P] T2.4)       ├─ pueden ir a la vez
 └─ Bloque 3 (T3.1 → T3.2 / T3.3 → T3.4 → T3.5 → T3.6)
 └─ Bloque 4 (T4.1 → T4.2 → T4.3)   [P] con el bloque 5
 └─ Bloque 5 (T5.1 [P] T5.2 → T5.3)
 └─ Bloque 6 (T6.1 / T6.2 → T6.3 / T6.4 / T6.5)
 └─ Bloque 7 (T7.1 [P] T7.2 → T7.3 → T7.4 → T7.5)
```

Un commit por tarea lógica completada (`docs/conventions.md`), con mensaje
`feat(318): …` / `test(318): …`.
