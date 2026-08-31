# Ficha 335 — Tareas

> **Orden pedido por el humano y NO negociable:** A (backend) → B/C (diseño y selector) → **D (la
> puerta), al final**. El bloque D no arranca hasta que B y C estén hechos.
> `[P]` = paralelizable con las tareas de su mismo bloque marcadas igual.
> Reparto de agentes (`AGENTS.md`): bloque A → `backend_dev`; bloques B, C y D → `frontend_dev`,
> salvo D1 (gate de la ruta), que es de `frontend_dev` porque toca `page.tsx` de la pantalla.
> Ningún subagente corre la suite completa: `pnpm typecheck`, `pnpm lint` y
> `pnpm exec vitest related --run <sus archivos>`. El gate lo corre el leader.

---

## Bloque A — Backend: la lectura de los cierres de la tienda

### A1 `[P]` — Tope configurable
- Añadir `MAX_CIERRES_FILTRO` a `WalletTiendaConfig` y a `loadWalletTiendaConfig`
  (`lib/config/wallet-tienda.ts`), env `WALLET_TIENDA_MAX_CIERRES_FILTRO`, default **200**, con el
  `readPositiveInt` que ya vive en ese archivo.
- Casos nuevos en `tests/unit/config/wallet-tienda-config.test.ts` (ausente → 200; `"50"` → 50;
  `"0"`/`"abc"` → default).
- **Hecho cuando:** los casos nuevos pasan y `tests/unit/config/paginacion-dominios.test.ts` sigue
  verde sin editarlo.

### A2 `[P]` — Contratos I/O
- En `lib/types/wallet-tienda.ts`: `CierreTiendaOpcionDTO = { cierreId; fecha; movimientos }`.
- **No se toca** `listarMovimientosTiendaSchema` (el filtro sigue recibiendo `cierreId` string).
- **Hecho cuando:** `pnpm typecheck` verde y el schema del filtro queda byte a byte igual.

### A3 — Contrato del repositorio *(dep. A2)*
- En `lib/interfaces/repositories/IWalletTiendaMovimientoRepository.ts`: tipo
  `CierreDeTiendaAgregadoRow` + método `listarCierresDeTienda(tiendaId, limite)`.
- **Hecho cuando:** `pnpm typecheck` **falla** enumerando los dobles incompletos (esa es la señal de
  que la interfaz muerde) — se arreglan en A5.

### A4 — Implementación del repositorio *(dep. A3)*
- `WalletTiendaMovimientoRepository.listarCierresDeTienda`: **un** `groupBy` según design §2.2.
  `tiendaId` en el `where` escrito por el caller, `origenId: { not: null }`, `_max.fechaMovimiento`,
  `_count._all`, `orderBy` por el agregado desc con desempate, `take: limite`.
- Sin `_sum`, sin `Number(`, sin `parseFloat(`, sin `parseInt(` (el archivo está censado por
  `tests/unit/guards/liquidacion-money-safe.test.ts`).
- **Hecho cuando:** A11 pasa y `tests/unit/guards/liquidacion-money-safe.test.ts` sigue verde.

### A5 `[P con A4]` — Los dobles del repositorio *(dep. A3)*
- Añadir `listarCierresDeTienda: vi.fn(...)` a **todos** los dobles anotados
  `: IWalletTiendaMovimientoRepository` (y a los `fakeRepo(...)` que devuelven ese tipo).
  Lista de partida (design §6.1): `tests/unit/services/{wallet-tienda-service, wallet-tienda-descarga,
  wallet-tienda-desglose, mi-wallet-desglose, saldos-tiendas-paginado, saldos-tiendas-completo,
  caja-cadena-pago-anulacion, liquidacion-service, liquidacion-anulacion}.test.ts`,
  `tests/unit/repositories/{cierres-admin-repository, cierres-admin-confirmacion-fisica,
  cierres-admin-anclaje-devolucion, CierresAdminRepository.resolverCierre.devolucion}.test.ts`,
  `tests/integration/db/*` que declaren el tipo.
- **Hecho cuando:** `pnpm typecheck` vuelve a verde **sin usar `as unknown as`** para tapar el hueco.

### A6 — Contrato del servicio *(dep. A2, A3)*
- `ListarMisCierresServiceResult` + `listarMisCierres(actor)` en
  `lib/interfaces/services/IWalletTiendaService.ts`, con el docstring que diga por qué **no recibe
  entrada** (R5) y por qué el guard va antes del repositorio (R3).
- **Hecho cuando:** `pnpm typecheck` verde.

### A7 — Implementación del servicio *(dep. A1, A4, A6)*
- `WalletTiendaService.listarMisCierres`: guard `actor.rol !== ROL_TIENDA → forbidden` **antes** de
  tocar el repositorio; pide `MAX_CIERRES_FILTRO + 1`; recorta a `MAX_CIERRES_FILTRO` y responde
  `hayMas`.
- **Hecho cuando:** A9 pasa.

### A8 — Server Action *(dep. A7)*
- `listarMisCierresAction(deps)` en `lib/actions/wallet-tienda.ts`, calcada de `verMiSaldoAction`
  (sin zod, `UnauthenticatedError` antes del servicio).
- **Hecho cuando:** A10 pasa y `tests/unit/guards/superficie-de-uso.guardia.test.ts` sigue verde
  **una vez hecha B1** (hasta entonces la action no tiene consumidor: si el guard se pone rojo entre
  A8 y B1, es esperado y se cierra con B1 — no se anota `@sin-superficie`).

### A9 — Tests del servicio *(dep. A7)* — archivo nuevo `tests/unit/services/mi-wallet-cierres.test.ts`
Casos, con estos nombres:
- «R1/R6: devuelve un elemento por cierre, con su fecha más reciente y su número de movimientos, y
  nada más» (`toEqual` sobre el objeto completo).
- «R3: un rol que no es la tienda recibe forbidden sin llamar al repositorio».
- «R2: el repositorio recibe EXACTAMENTE el `usuarioId` del actor como tienda».
- «R8: con el tope N y N+1 cierres devuelve N elementos y `hayMas` en true».
- «R8: con N cierres exactos devuelve N y `hayMas` en false» (contraprueba del tope).
- «R9: ninguna clave de la respuesta es un importe» (barrido sobre las claves del DTO).
- «R5: el método no admite entrada» (`svc.listarMisCierres.length === 1`).
- **Hecho cuando:** los 7 pasan y el doble del repo es un `vi.fn` que registra sus argumentos.

### A10 — Tests de la action *(dep. A8)* — archivo nuevo `tests/unit/actions/wallet-tienda-cierres-action.test.ts`
- «R4: sin sesión responde `unauthenticated` y NO instancia el servicio».
- «R3: el `forbidden` del servicio se devuelve tal cual, sin filas».
- «R5: un objeto colado como argumento no cambia el conjunto» (la action ignora todo lo que no sea
  `deps`).
- **Hecho cuando:** los 3 pasan.

### A11 — Test del repositorio *(dep. A4)* — extiende `tests/unit/repositories/wallet-tienda-movimiento-repository.test.ts`
- «R2: el `groupBy` de cierres lleva `tiendaId`, `origenTipo: cierre_dia` y `origenId` no nulo en el
  WHERE» (aserción sobre el argumento real, como los casos vecinos).
- «R7: ordena por el movimiento más reciente, descendente».
- «R10: una sola llamada al ORM, sin consultas por elemento».
- **Hecho cuando:** los 3 pasan **y** una mutación manual del `where` (quitar `tiendaId`) los pone
  rojos — se comprueba a mano y se anota en `progress/impl_335_backend.md`.

### A12 — Test contra Postgres real *(dep. A4)* — archivo nuevo `tests/integration/db/mi-wallet-cierres-alcance.test.ts`
- Usa el arnés `tests/integration/db/_postgres-real.ts` (`HAY_BASE_DE_DATOS`, `crearPrismaDeTest`,
  `enTransaccionRevertida`). **Sin base ⇒ `describe.skip`**, que se VE en la salida: prohibido el
  `if (!x) return;` que reporta *passed* sin comprobar nada.
- Siembra dos tiendas y dos cierres cruzados. Casos:
  - «control de no-vacuidad: la tienda A tiene al menos un cierre en su lista».
  - «R2: la lista de la tienda A NO contiene el cierre que solo movió dinero de la tienda B».
  - «R6: el conteo de movimientos es el de ESA tienda en ESE cierre, no el del cierre entero».
- **Hecho cuando:** con base alcanzable los 3 pasan; sin base, la salida dice `skipped` y no
  `passed`.

### A13 `[P]` — Guardia de alcance de la ficha — archivo nuevo `tests/unit/guards/mi-wallet-335.guardia.test.ts`
- «R11: ninguna carpeta de `db/migrations/` corresponde a esta ficha y `db/schema.prisma` no gana
  ningún objeto nuevo» (con control de no-vacuidad sobre el censo de migraciones).
- «R17: ningún archivo de `app/(app)/mi-wallet/**` importa una action de mutación» (censo por nombre:
  todo lo importado de `lib/actions/` es `listar*`/`ver*`), con contraprueba.
- «R16: barrido `Number(`/`parseFloat(`/`parseInt(`/`.toFixed(` sobre los archivos nuevos de
  `app/(app)/mi-wallet/`» (los que el censo de la 172 no alcanza), leyendo el código **sin
  comentarios** (`tests/fixtures/sin-comentarios.ts`) y con contraprueba en las dos direcciones.
- El caso de R33 se añade en D4, en este mismo archivo.
- **Hecho cuando:** los casos pasan y cada `not.toContain`/`toEqual([])` va acompañado de su control
  de no-vacuidad.

---

## Bloque B — Frontend: la presentación *(no arranca hasta A8)*

### B1 — `page.tsx`: tercera lectura y degradación
- Añadir `listarMisCierresAction()` al `Promise.all` existente.
- Construir `CierresDeLaTienda` según design §4.2: **`ok` → datos; cualquier otro estado → lista
  vacía + `disponible: false`**. NO se añade un tercer `notFound()`.
- Pasar la prop a `MiWalletModule`.
- **Hecho cuando:** `pnpm typecheck` verde y B4 pasa. **Ojo:** no introducir literales de categoría
  del ledger en este archivo — `tests/unit/services/mi-wallet-desglose.test.ts:165-194` lo prohíbe.

### B2 — `MiWalletModule`: la gramática de `/wallet` *(dep. B1)*
- Contenedor a `gap-6`; **quitar** el envoltorio `lg:max-w-md` del saldo (tarjeta a ancho completo).
- El libro pasa a UNA `<Card>` dentro de la `<section aria-label="Desglose de movimientos">`, que se
  conserva: `CardHeader` + `CardTitle` visible, banda de filtros
  (`border-b bg-muted/30 px-(--card-spacing) py-3`), `CardContent` con `DesgloseTiendaLedger`,
  `CardFooter` con `Pagination` (`sticky={false}`,
  `className="w-full justify-between gap-3 py-0"`, `ariaLabel` **sin cambiar**).
- **`SaldoTiendaCard` no se toca por dentro.** Cards hermanas, nunca anidadas.
- **Hecho cuando:** B4 pasa, el bloque R55 de `tests/integration/mi-wallet-page.test.tsx` sigue verde
  **sin editarlo**, y `tests/unit/guards/caja-173-alcance.guardia.test.ts` sigue verde.

### B3 — `MiWalletFiltros`: de bloque a barra *(dep. B2)*
- `form` a `flex flex-wrap items-center gap-2`; rótulos de los selects a `sr-only` con `htmlFor`
  apuntando a un `id` **real** del control; rótulos cortos visibles en las dos fechas; botones en un
  contenedor con `sm:ml-auto`. Alturas `h-9` como en `WalletFiltros`.
- El contrato del componente (`onAplicar`/`onLimpiar`/`disabled`) **no cambia**; se le añade la prop
  `cierres` (requerida, sin default).
- **Hecho cuando:** C3 pasa y el borrador local y los cuatro campos siguen comportándose igual.

### B4 — Test de la pantalla *(dep. B1, B2)* — modifica `tests/integration/mi-wallet-page.test.tsx`
- Añadir `listarMisCierresAction: vi.fn()` al `vi.mock` de `@/lib/actions/wallet-tienda` (`:32-37`)
  y sembrarla en `beforeEach`. **Sin esto el import de `page.tsx` revienta.**
- Casos nuevos:
  - «R12: el saldo y el libro son dos tarjetas hermanas, ninguna dentro de la otra».
  - «R13: la tarjeta del libro lleva un título visible».
  - «R14: los filtros se renderizan dentro de la tarjeta del libro».
  - «R15: la paginación está en el pie de la tarjeta y conserva su nombre accesible».
  - «R29: si la lectura de cierres no responde ok, el saldo y el libro siguen en pantalla y NO hay
    notFound».
  - «R28: sin cierres, el selector queda deshabilitado y la pantalla lo dice».
  - «R30: con `hayMas`, la pantalla avisa de que solo ofrece los más recientes» — y el aviso **no**
    lleva `role="note"` (se afirma que sigue habiendo exactamente uno).
- **Hecho cuando:** los casos nuevos pasan y los 9 existentes siguen verdes **sin tocar una
  aserción**.

---

## Bloque C — Frontend: el selector *(no arranca hasta B3)*

### C1 `[P]` — Módulo puro de opciones — archivo nuevo `app/(app)/mi-wallet/_components/mi-wallet-cierres.ts`
- `CIERRE_TODOS_OPTION` + `opcionesDeCierre(cierres)` según design §4.3. Sin React, sin dinero, sin
  literales de categoría del ledger.
- **No se añade a `mi-wallet-labels.ts`** (ese módulo lo reexporta entero `/wallet/tiendas`).
- **Hecho cuando:** C2 lo consume y `tests/unit/components/desglose-tienda-labels.test.ts` sigue
  verde sin editarlo.

### C2 — El control *(dep. C1, B3)*
- Sustituir el `<Input type="text" placeholder="ID del cierre">` por el `Select` con
  `options={opcionesDeCierre(...)}`, `placeholder="Todos los cierres"`,
  `aria-label="Filtrar por cierre"`, `disabled = disabled || opciones.length === 0`.
- Texto auxiliar bajo el control según design §4.4 (sin cierres / no disponible / hay más), en
  **voseo** y sin siglas ni jerga.
- **Hecho cuando:** C3 pasa y **no queda en la pantalla ningún campo de texto que pida un
  identificador**.

### C3 `[P]` — Test del filtro — archivo nuevo `tests/components/MiWalletFiltros.test.tsx`
- «R22: el filtro de cierre es un `combobox` y ningún campo de la pantalla pide un identificador»
  (se afirma además que ya no existe el placeholder «ID del cierre»).
- «R25: la primera opción es “Todos los cierres” y emite cadena vacía».
- «R26: al elegir un cierre y aplicar, se emite su `cierreId`».
- «R27: “Limpiar” devuelve el selector a “Todos los cierres”».
- «R20: los textos del selector están en voseo y sin jerga» (lista de prohibidos: `SLA`, `UUID`,
  `ID`, `cierre_dia`, `origen_id`, `débito`, `crédito`, «acuerdo a nivel de servicio»).
- **Hecho cuando:** los 5 pasan.

### C4 `[P]` — Test del etiquetado — archivo nuevo `tests/unit/components/mi-wallet-cierres-opciones.test.ts`
- «R23: la etiqueta lleva el día y el número de movimientos, y NO lleva el identificador» (se afirma
  que ninguna etiqueta contiene la forma de un uuid).
- «R23: el día es el MISMO que pinta la columna Fecha de la tabla» (se compara contra `fechaDiaISO`
  del mismo instante, no contra un literal escrito a mano).
- «R24: dos cierres del MISMO día con el MISMO número de movimientos producen etiquetas distintas».
- «R24: cuando no hay colisión, la etiqueta NO lleva hora» (contraprueba: la hora solo aparece donde
  hace falta).
- «singular/plural: 1 movimiento / 4 movimientos».
- **Hecho cuando:** los 5 pasan.

---

## Bloque D — La puerta *(NO arranca hasta que B y C estén hechos; es el orden que pidió el humano)*

### D1 — Constante única de roles *(dep. bloques B y C)*
- `ROLES_MI_WALLET = ["adminTienda"] as const satisfies readonly RolValue[]` en
  `lib/auth/menu-visibility.ts`, con su docstring (precedentes: R10 de la 129, R1 de la 321).
- `app/(app)/mi-wallet/page.tsx` sustituye `actor.rol !== "adminTienda"` por la lectura de esa
  constante, con el ensanchado puntual de tipo. **Cero literales de rol en ese archivo.**
- **Hecho cuando:** el caso de acceso existente sigue verde y D6 pasa.

### D2 — El ítem de menú *(dep. D1)*
- Entrada en `SIDEBAR_ITEMS` **después** del ítem «Wallet»:
  `{ label: "Mi wallet", href: "/mi-wallet", iconKey: "wallet", roles: ROLES_MI_WALLET }`.
- `roles` apunta a la **constante**, nunca a un literal copiado.
- **NO** se le pone `destinoInicial: false`: la posición ya protege el aterrizaje, y
  `tests/unit/auth/destino-post-login.test.ts:113-118` afirma que los marcados son exactamente
  `["/analitica","/monitoreo"]`.
- **Hecho cuando:** D3 y D4 pasan y `tests/unit/auth/destino-post-login.test.ts` sigue verde **sin
  editarlo**.

### D3 — Los dos contratos literales que se actualizan A MANO *(dep. D2)*
- `tests/unit/auth/menu-visibility.test.ts:186`: la lista del `adminTienda` pasa a
  `["Analítica","Órdenes","Novedades","Mi wallet"]`. Se **conserva** la comparación por igualdad; no
  se relaja a `toContain`.
- `tests/unit/guards/pwa-manifiesto-atajos.guardia.test.ts:182-188`: `adminTienda: 3` → `4`, con un
  comentario que diga qué destino entró y por qué la conclusión («cero atajos») no cambia.
- **Hecho cuando:** los dos pasan y el cambio va acompañado de su motivo escrito, no de un número
  suelto.

### D4 — Casos nuevos del ítem *(dep. D2)* — amplía `tests/unit/auth/menu-visibility.test.ts`
- «R31: existe exactamente UN ítem con href `/mi-wallet` y su `roles` es la CONSTANTE» (`toBe`, no
  `toEqual`: se afirma la identidad de la tupla).
- «R32: ningún rol distinto de `adminTienda` lo ve, ni el actor ausente» (barrido sobre todos los
  `RolValue`, incluido `apiKey`).
- **Hecho cuando:** los 2 pasan.

### D5 — Gate de la ruta, derivado de la constante *(dep. D1)* — amplía `tests/integration/mi-wallet-page.test.tsx`
- «R34: todo `RolValue` fuera de `ROLES_MI_WALLET` recibe `notFound()` y no dispara ningún
  pre-fetch», con la lista de denegados **derivada** de la constante (patrón de
  `tests/components/HistoricoConversacionesPage.test.tsx:69-70`). Cubre además `apiKey`, que hoy no
  se afirma.
- **Hecho cuando:** pasa y el caso existente `roles != adminTienda…` sigue verde.

### D6 — Guardia de fuente única *(dep. D1, D2)* — amplía `tests/unit/guards/mi-wallet-335.guardia.test.ts`
- «R33: `app/(app)/mi-wallet/page.tsx` no contiene NINGÚN literal de rol» (código sin comentarios,
  barrido sobre todos los `RolValue`), con **contraprueba** (una línea inventada con el literal SÍ
  se caza).
- «R33: el `roles` del ítem `/mi-wallet` es la MISMA referencia que `ROLES_MI_WALLET`».
- **Hecho cuando:** los 2 pasan.

### D7 — Los que tienen que seguir verdes SIN tocarlos *(dep. D2)*
Comprobación explícita, anotada en `progress/impl_335*.md` con la salida:
`tests/unit/auth/destino-post-login.test.ts` (R35), `tests/unit/auth/menu-historico.test.ts` (R35),
`tests/unit/guards/rastreo-sin-ruta-nueva.guardia.test.ts` (R36),
`tests/unit/descarga/wallet-tienda-descarga-columnas.test.ts` (R18),
`tests/unit/components/desglose-tienda-labels.test.ts` (R21),
`tests/unit/guards/caja-173-alcance.guardia.test.ts`,
`tests/unit/services/mi-wallet-desglose.test.ts`,
`tests/unit/guards/liquidacion-money-safe.test.ts` (R16).
- **Hecho cuando:** los 8 corren en verde y **ninguno aparece en el diff**. Si alguno exige una
  edición para pasar, **se para y se pregunta**: es señal de que la implementación se desvió, no de
  que el test esté viejo.

---

## Bloque E — Cierre

### E1 — Trazabilidad
- `progress/impl_335_backend.md` y `progress/impl_335_frontend.md` con archivos tocados, el mapa
  `R<n> → test` de abajo con la salida real, y las desviaciones declaradas (design §2.2).
- **Hecho cuando:** los 36 requisitos tienen su test nombrado y ejecutado.

### E2 — Gate y PR
- `./init.sh --rapido` (lo corre el **leader**, nunca en paralelo con un subagente que esté mutando
  el árbol). La ficha no toca migraciones ni `db/schema.prisma`, así que el modo rápido es válido
  para su PR.
- **Hecho cuando:** el gate termina en verde con `INIT_EXIT=0` leído **dentro** del log, y el PR
  apunta a `dev`.

---

## Trazabilidad `R<n> → test`

| R | Test |
| --- | --- |
| R1 | `tests/unit/services/mi-wallet-cierres.test.ts` «R1/R6: devuelve un elemento por cierre…» |
| R2 | `tests/unit/repositories/wallet-tienda-movimiento-repository.test.ts` «R2: el groupBy de cierres lleva tiendaId…» **+** `tests/integration/db/mi-wallet-cierres-alcance.test.ts` «R2: la lista de la tienda A NO contiene el cierre de la tienda B» |
| R3 | `tests/unit/services/mi-wallet-cierres.test.ts` «R3: un rol que no es la tienda recibe forbidden sin llamar al repositorio» |
| R4 | `tests/unit/actions/wallet-tienda-cierres-action.test.ts` «R4: sin sesión responde unauthenticated y NO instancia el servicio» |
| R5 | `tests/unit/services/mi-wallet-cierres.test.ts` «R5: el método no admite entrada» + `…cierres-action.test.ts` «R5: un objeto colado no cambia el conjunto» |
| R6 | `tests/unit/services/mi-wallet-cierres.test.ts` «R1/R6…» + `tests/integration/db/mi-wallet-cierres-alcance.test.ts` «R6: el conteo es el de ESA tienda» |
| R7 | `tests/unit/repositories/wallet-tienda-movimiento-repository.test.ts` «R7: ordena por el movimiento más reciente, descendente» |
| R8 | `tests/unit/services/mi-wallet-cierres.test.ts` «R8: con el tope N y N+1 cierres…» y «R8: con N exactos…» |
| R9 | `tests/unit/services/mi-wallet-cierres.test.ts` «R9: ninguna clave de la respuesta es un importe» |
| R10 | `tests/unit/repositories/wallet-tienda-movimiento-repository.test.ts` «R10: una sola llamada al ORM» |
| R11 | `tests/unit/guards/mi-wallet-335.guardia.test.ts` «R11: ninguna carpeta de db/migrations…» |
| R12 | `tests/integration/mi-wallet-page.test.tsx` «R12: el saldo y el libro son dos tarjetas hermanas» |
| R13 | `tests/integration/mi-wallet-page.test.tsx` «R13: la tarjeta del libro lleva un título visible» |
| R14 | `tests/integration/mi-wallet-page.test.tsx` «R14: los filtros se renderizan dentro de la tarjeta» |
| R15 | `tests/integration/mi-wallet-page.test.tsx` «R15: la paginación está en el pie…» |
| R16 | `tests/unit/guards/liquidacion-money-safe.test.ts` (existente, **sin editar**) + `tests/unit/guards/mi-wallet-335.guardia.test.ts` «R16: barrido sobre los archivos nuevos» |
| R17 | `tests/unit/guards/mi-wallet-335.guardia.test.ts` «R17: ningún archivo de mi-wallet importa una action de mutación» |
| R18 | `tests/unit/descarga/wallet-tienda-descarga-columnas.test.ts` (existente, **sin editar**) |
| R19 | `tests/integration/mi-wallet-page.test.tsx`, bloque «la tienda distingue el pago del cargo (R55)» (existente, **sin editar**) |
| R20 | `tests/components/MiWalletFiltros.test.tsx` «R20: los textos del selector están en voseo y sin jerga» |
| R21 | `tests/unit/components/desglose-tienda-labels.test.ts` (existente, **sin editar**) |
| R22 | `tests/components/MiWalletFiltros.test.tsx` «R22: el filtro de cierre es un combobox…» |
| R23 | `tests/unit/components/mi-wallet-cierres-opciones.test.ts` «R23: la etiqueta lleva el día y el número…» y «R23: el día es el MISMO que la columna Fecha» |
| R24 | `tests/unit/components/mi-wallet-cierres-opciones.test.ts` «R24: dos cierres del MISMO día…» y su contraprueba |
| R25 | `tests/components/MiWalletFiltros.test.tsx` «R25: la primera opción es “Todos los cierres”…» |
| R26 | `tests/components/MiWalletFiltros.test.tsx` «R26: al elegir un cierre y aplicar, se emite su cierreId» |
| R27 | `tests/components/MiWalletFiltros.test.tsx` «R27: “Limpiar” devuelve el selector a “Todos los cierres”» |
| R28 | `tests/integration/mi-wallet-page.test.tsx` «R28: sin cierres, el selector queda deshabilitado y lo dice» |
| R29 | `tests/integration/mi-wallet-page.test.tsx` «R29: si la lectura de cierres no responde ok…» |
| R30 | `tests/integration/mi-wallet-page.test.tsx` «R30: con hayMas, la pantalla avisa…» |
| R31 | `tests/unit/auth/menu-visibility.test.ts` «R31: existe exactamente UN ítem con href /mi-wallet…» |
| R32 | `tests/unit/auth/menu-visibility.test.ts` «R32: ningún rol distinto de adminTienda lo ve…» |
| R33 | `tests/unit/guards/mi-wallet-335.guardia.test.ts` «R33: page.tsx no contiene NINGÚN literal de rol» y «R33: el roles del ítem es la MISMA referencia» |
| R34 | `tests/integration/mi-wallet-page.test.tsx` «R34: todo RolValue fuera de ROLES_MI_WALLET recibe notFound()» |
| R35 | `tests/unit/auth/destino-post-login.test.ts` (existente, **sin editar**) |
| R36 | `tests/unit/guards/rastreo-sin-ruta-nueva.guardia.test.ts` (existente, **sin editar**) |

---

## Grafo de dependencias (resumen)

```
A1 [P] ─┐
A2 [P] ─┼─► A3 ─► A4 ─► A7 ─► A8 ─► B1 ─► B2 ─► B3 ─► C2 ─► D1 ─► D2 ─► D3, D4, D6, D7
A13[P] ─┘      └─► A5 [P]        │       └─► B4        └─► C1 [P], C3 [P], C4 [P]
               A6 ──────────────►┘                              D1 ─► D5
               A4 ─► A11, A12
               A7 ─► A9
               A8 ─► A10
```

**Restricción dura:** ninguna tarea del bloque D empieza antes de que B4, C3 y C4 estén en verde. Es
el orden que pidió el humano: primero el diseño, después el enlace.
