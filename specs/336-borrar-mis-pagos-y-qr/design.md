# Ficha 336 — borrar `/mis-pagos` y `/qr` · design.md

> Todo lo que sigue está **verificado contra el árbol real** el 2026-08-30, no leído del grafo ni
> de un spec viejo. Donde hay una cifra, es una cifra medida y se dice cómo.

---

## §0 — Lo verificado antes de escribir nada

| Afirmación | Cómo se comprobó | Resultado |
| --- | --- | --- |
| Ningún enlace ni ítem de menú llega a `/mis-pagos` o `/qr` | `lib/auth/menu-visibility.ts`, `app/(app)/_components/Sidebar.tsx`, `middleware.ts`, `public/*.json` | **cero** menciones de ambas rutas |
| `/mis-pagos` son 6 archivos | `app/(app)/mis-pagos/**` | 6 (1 ruta + 5 componentes) |
| `/qr` es 1 archivo + 1 hook | `app/(app)/qr/**`, `hooks/useQrNavigate.ts` | 2 |
| `useQrNavigate` es exclusivo de `/qr` | grep en todo el árbol + `in_degree` del grafo | **1 importador**: `app/(app)/qr/page.tsx`. Confirmado en el archivo real |
| `QrScanner` NO se borra | importadores directos de `components/shared/QrScanner.tsx` | 3 hoy: `EscanerGuiaCard`, `VerificarGuiaGate`, `qr/page.tsx` |
| Las actions de `/mis-pagos` son 2 | `lib/actions/wallet-mensajero.ts` | **son 3** — ver §2 |
| 15 archivos de test tocan estos nombres | grep en `tests/` + `e2e/` | **18**: 17 en `tests/`, 1 en `e2e/` — ver §4 |

### Corrección al encargo, medida: `QrScanner` no tiene «cuatro consumidores» directos

El encargo nombra `CierresAdminModule`, `RecogerPaqueteCard`, `VerificarGuiaGate` y
`EscanerRecepcion`. Verificado en los archivos: **tres de esos cuatro llegan a la cámara por una
cadena**, no por import directo. La forma real es:

```
EscanerModal  (envoltorio: botón + Dialog; monta y DESMONTA para apagar la cámara)
  └── EscanerGuiaCard  (components/shared/EscanerGuiaCard.tsx)   ← importa QrScanner
        └── QrScanner  (components/shared/QrScanner.tsx)          ← html5-qrcode

VerificarGuiaGate  (app/(app)/mis-asignaciones/_components/)      ← importa QrScanner DIRECTO
app/(app)/qr/page.tsx                                             ← importa QrScanner DIRECTO (se borra)
```

**Importadores directos de `QrScanner`, hoy 3, después de la ficha 2:**
`components/shared/EscanerGuiaCard.tsx` y
`app/(app)/mis-asignaciones/_components/VerificarGuiaGate.tsx`.

**Superficies que montan `EscanerGuiaCard`, hoy 6 y después 6:**

1. `app/(app)/ordenes/_components/EscanerRecepcionOrigen.tsx`
2. `app/(app)/ordenes/_components/EscanerRecepcionBodegaCentral.tsx`
3. `app/(app)/recepcion-satelite/_components/EscanerRecepcion.tsx`
4. `app/(app)/recoleccion/_components/RecoleccionModule.tsx`
5. `app/(app)/mis-asignaciones/_components/RecogerPaqueteCard.tsx`
6. `app/(app)/cierres-admin/_components/cierre-confirmacion-fisica.tsx`

Esto importa para la guardia nueva: **si afirmara «`QrScanner` tiene cuatro importadores
directos» saldría roja el día de la implementación**, porque hoy son tres y quedarán dos. La
guardia afirma lo que es cierto: dos importadores directos nominados **y** las seis superficies
de la cadena.

---

## §1 — Censo de BORRADO (archivos enteros)

**Producción — 8 archivos:**

| # | Archivo | Qué es |
| --- | --- | --- |
| 1 | `app/(app)/mis-pagos/page.tsx` | Server Component role-aware (`mensajero` o `notFound`) |
| 2 | `app/(app)/mis-pagos/_components/MisPagosModule.tsx` | módulo cliente (filtros, paginación, descarga) |
| 3 | `app/(app)/mis-pagos/_components/CuentaPorPagarCard.tsx` | tarjeta de la cuenta por pagar |
| 4 | `app/(app)/mis-pagos/_components/DesglosePagos.tsx` | `<DataTable descarga=…>` del desglose |
| 5 | `app/(app)/mis-pagos/_components/mis-pagos-descarga-columnas.ts` | `COLUMNAS_DESCARGA_MIS_PAGOS` + `filaDescargaMiPago` |
| 6 | `app/(app)/mis-pagos/_components/mis-pagos-labels.ts` | `CATEGORIA_PAGO_LABEL` y compañía |
| 7 | `app/(app)/qr/page.tsx` | pantalla del escáner suelto |
| 8 | `hooks/useQrNavigate.ts` | traduce el texto del QR a una navegación — **exclusivo de (7)** |

**Tests — 2 archivos (SUYOS, se van con la pantalla):**

| # | Archivo | Por qué es suyo |
| --- | --- | --- |
| 9 | `tests/integration/mis-pagos-page.test.tsx` | 45 menciones; su sujeto entero es la página que se borra |
| 10 | `tests/unit/services/wallet-mis-pagos-descarga.test.ts` | un solo `describe`, sobre `listarMisPagosCompleto` |

**No hay ningún test de `/qr` ni de `useQrNavigate`.** `tests/components/QrScanner.test.tsx` es
del componente compartido y **no se toca**.

---

## §2 — La superficie de las Server Actions: la decisión, con argumento

`lib/actions/wallet-mensajero.ts` exporta **siete** Server Actions. Al borrar la página se quedan
sin superficie **tres**, no dos (el encargo decía dos; la tercera es la de la descarga, ficha 170):

| Acción | Superficie hoy | Tras la ficha |
| --- | --- | --- |
| `verMiCuentaPorPagarAction` | `mis-pagos/page.tsx` | **huérfana** |
| `listarMisPagosAction` | `mis-pagos/page.tsx` + `MisPagosModule` | **huérfana** |
| `listarMisPagosCompletoAction` | `MisPagosModule` (descarga) | **huérfana** |
| `listarCuentasPorPagarAction` | ninguna, **ya anotada** `@sin-superficie` (paridad de tests) | igual |
| `listarCuentasPorPagarPaginadoAction` | `wallet/mensajeros/page.tsx` | viva |
| `listarCuentasPorPagarCompletoAction` | `CuentasPorPagarTable` | viva |
| `listarPagosDeMensajeroAction` / `…CompletoAction` | `DesglosePagosMensajero` | vivas |

### Decisión: **retirar**, no anotar

**Se retiran las tres acciones**, sus tres métodos de servicio, sus tres firmas de interfaz y los
tipos/schemas que quedan **exclusivamente** suyos.

**Alternativa descartada — anotar `/** @sin-superficie … */`.** Es la salida barata y es la
incorrecta aquí, por tres razones medidas:

1. **La anotación significa otra cosa.** Su semántica, escrita en la cabecera de la guardia, es
   «esto se queda sin superficie **por un motivo real**» —el caso vivo del repo,
   `listarCuentasPorPagarAction`, se conserva porque los tests de paridad del listado paginado la
   usan como lectura sin recorte—. Aquí el motivo no existe: el humano decidió que la capacidad
   desaparece. Anotarlas escribiría una excusa falsa junto al código.
2. **La anotación caduca por diseño.** La guardia falla si una acción anotada vuelve a ser
   alcanzable. Tres anotaciones eternas sobre código que nadie va a volver a montar es
   exactamente la allowlist que la guardia vino a evitar («una excepción que sobrevive a su
   motivo es basura que crece hasta que nadie lee ninguna»).
3. **Es un camino de datos vivo sin lector.** Las tres leen el libro de dinero de un mensajero.
   Dejarlas exportadas y sin pantalla es dejar una puerta de servidor que nadie vigila porque
   nadie la usa. Retirar es más barato de auditar que anotar.

### Qué se queda, y esto se comprobó, no se supuso

- **`lib/services/WalletMensajeroService.ts` se QUEDA.** Su superficie viva es
  `/wallet/mensajeros`. Solo pierde `verMiCuentaPorPagar`, `listarMisPagos` y
  `listarMisPagosCompleto`.
- **`lib/repositories/PagoMensajeroMovimientoRepository.ts` se QUEDA íntegro.** Lo usan las cinco
  lecturas de administración.
- **`listarPagosMensajeroSchema` se QUEDA. Ojo con esto:** es la **base** de la que
  `listarPagosDeMensajeroSchema` (la vista del maestro) deriva con `.extend(...)`. Borrarlo por
  parecer «el schema de mis pagos» rompe la vista del admin.
- **`CuentaPorPagarDTO` se QUEDA:** lo usan `app/(app)/wallet/mensajeros/_components/DesglosePagosMensajero.tsx`
  y `lib/utils/cuenta-por-pagar.ts`.
- **Se retiran de `lib/types/wallet-mensajero.ts`:** `listarMisPagosCompletoSchema` y
  `ListarMisPagosCompletoInput` (sin más referencias tras la retirada).
- **Se retiran de `lib/interfaces/services/IWalletMensajeroService.ts`:** las tres firmas y los
  tipos de resultado que quedan sin uso (`VerMiCuentaPorPagarServiceResult`,
  `ListarMisPagosServiceResult`, `ListarMisPagosCompletoServiceResult`, `ListarMisPagosPayload`).

> **Regla operativa, no negociable:** cada símbolo se retira **solo tras comprobar en el árbol
> real que no le queda ninguna referencia**. Si queda una, el símbolo se queda. `pnpm run typecheck`
> es el juez final; el grafo del MCP no basta —su modo de fallo conocido es devolver de más—.

---

## §3 — Rutas, contratos y datos

- **Rutas Next retiradas:** `/mis-pagos` (Server Component + módulo cliente) y `/qr` (client
  page). Ninguna es `app/api/**`: **no hay route handler afectado**, ni webhook, ni cron.
- **Contratos I/O retirados:** los tres pares acción→servicio de la vista propia del mensajero.
  Sus DTO de salida (montos como STRING) desaparecen con ellos; los DTO equivalentes del admin no
  cambian ni un campo.
- **Modelo de datos: CERO cambios.** Ni migración, ni `db/schema.prisma`, ni RLS, ni enum. La
  tabla `pago_mensajero_movimiento` y sus enums siguen exactamente igual: el maestro sigue
  leyéndolos desde `/wallet/mensajeros`. Un diff de esta ficha que toque `db/**` es un error.
- **Integraciones externas:** ninguna. Ni Supabase Storage, ni WhatsApp, ni Meta.

---

## §4 — El censo de los 18 archivos de test, uno por uno

La regla, y es el corazón de esta ficha: **lo que es SUYO se va; lo que es de OTRA feature
SOBREVIVE**, perdiendo solo la mitad que afirmaba sobre la pantalla borrada.

### 4.1 — SUYOS: se borran enteros (2)

| Archivo | Veredicto |
| --- | --- |
| `tests/integration/mis-pagos-page.test.tsx` | **BORRAR.** 45 menciones; monta la página que se va. Ojo: dispara la cita rota de la 172 (§5.6) |
| `tests/unit/services/wallet-mis-pagos-descarga.test.ts` | **BORRAR.** Un solo `describe`: `WalletMensajeroService.listarMisPagosCompleto` |

### 4.2 — AJENOS: sobreviven, se les quita SOLO su mitad (12)

| Archivo | De qué feature es | Qué se le quita | Qué DEBE seguir cubriendo |
| --- | --- | --- | --- |
| `tests/unit/actions/wallet-mensajero-actions.test.ts` | 44 + 170-fase2 | los `describe` de `verMiCuentaPorPagarAction` y `listarMisPagosAction` | los **cuatro** `describe` de las acciones del maestro: `listarCuentasPorPagarAction`, `…Paginado`, `…Completo`, `listarPagosDeMensajeroAction` |
| `tests/unit/actions/wallet-mensajero-descarga-action.test.ts` | 170 | el `describe` de `listarMisPagosCompletoAction` + su import | el `describe` de `listarPagosDeMensajeroCompletoAction` |
| `tests/unit/services/wallet-mensajero-service.test.ts` | 44 | los `describe` de `verMiCuentaPorPagar` y `listarMisPagos` | `listarCuentasPorPagar`, `listarPagosDeMensajero` y el de **inmutabilidad (R3)** |
| `tests/unit/descarga/wallet-mensajero-descarga-columnas.test.ts` | 170 T C.3 | el `it` de `COLUMNAS_DESCARGA_MIS_PAGOS`, la entrada de `LEDGERS` y el `describe` de **paridad** | el `it` **que nombra** `COLUMNAS_DESCARGA_DESGLOSE_MENSAJERO` (línea 78 hoy) — es lo que lo mantiene fuera del censo de «constante sin aserción» |
| `tests/components/descarga/WalletDescarga.test.tsx` | 170 | el `renderMisPagos`, su caso de la tabla `LEDGERS`, los dos mocks `listarMisPagos*` y la ruta `mis-pagos/_components/DesglosePagos.tsx` de la lista de «tablas de presentación» (línea 498) | los ledgers de `/wallet`, `/mi-wallet`, `wallet/mensajeros` y la caja. **`readFileSync` sobre una ruta borrada revienta con ENOENT**: si esa ruta se olvida, el archivo entero cae |
| `tests/components/PremioRankingRotulo.test.tsx` | **293** | los 2 imports de `mis-pagos/_components/*`, el `describe` «el MENSAJERO lo ve igual en `/mis-pagos`», el `it` de `filaDescargaMiPago` y su entrada del `it.each` de rótulos | R34 sobre las superficies vivas: el desglose del maestro y su archivo. **La cabecera dice «las CUATRO superficies»: hay que actualizarla a las que queden** o el test miente sobre sí mismo |
| `tests/unit/guards/liquidacion-money-safe.test.ts` | **172** | las 2 rutas `mis-pagos/_components/{CuentaPorPagarCard.tsx,mis-pagos-labels.ts}` de `ARCHIVOS_DE_LA_FEATURE` | el resto del censo (≈45 rutas). **Su primer `it` afirma `existsSync(ruta) === true` para cada entrada**: si no se quitan, rojo seguro |
| `tests/unit/guards/caja-173-alcance.guardia.test.ts` | **173** | la carpeta `app/(app)/mis-pagos/_components` de `PANTALLAS_CONGELADAS` | R63 sobre `wallet/tiendas/_components` (7 archivos) y `mi-wallet/_components` (6). **`readdirSync` sobre una carpeta borrada lanza ENOENT**. Y hay dos umbrales: `componentes.length > 12` (quedan **13** medidos: pasa, y por poco) y `> 3` por carpeta (7 y 6: pasa) |
| `tests/unit/descarga/censo-tablas.ts` | 170 T0.5 | la entrada `app/(app)/mis-pagos/_components/DesglosePagos.tsx` | las 27 rutas restantes. Precedente idéntico: el chore del 2026-08-07 quitó la de `ZonasModule` «porque el registro no puede citar un archivo borrado» |
| `tests/unit/descarga/cobertura-tablas.guardia.test.ts` | 170 T0.5 | **bajar los dos totales duros en 1**: `TOTAL_ARCHIVOS_CON_DATATABLE` y `TOTAL_INSTANCIAS_DATATABLE`, hoy `28`/`28` | todo lo demás. Se **mide** contra el árbol (la guardia dice el número recibido); no se calcula. Y se escribe en su cabecera por qué baja, nombrando la pantalla — es la convención de ese archivo |
| `tests/integration/db/pago-mensajero-liquidacion.test.ts` | 44/172 (**R23**) | los `expect(typeof actions.verMiCuentaPorPagarAction)` y `…listarMisPagosAction` (líneas 73-74) | la afirmación NEGATIVA (`registrarLiquidacionMensajeroAction` es `undefined`) **y su control positivo**. Queda `listarCuentasPorPagarAction`; **hay que añadir una segunda acción viva** (p. ej. `listarPagosDeMensajeroAction`) o el control positivo se queda en un solo testigo (R21). Nota: este archivo NO va envuelto en `HAY_BASE_DE_DATOS` —lee `db/schema.prisma`—, así que **sí se ejecuta sin `DATABASE_URL`** |
| `tests/integration/wallet-mensajeros-page.test.tsx` | 44 + 293 | las dos claves rancias `verMiCuentaPorPagarAction` / `listarMisPagosAction` del `vi.mock` | todo. **No es bloqueante**: el factory devuelve el módulo entero y una clave de más no rompe. Se limpia por higiene, no por rojo |

### 4.3 — E2E (1)

| Archivo | Qué se le quita |
| --- | --- |
| `e2e/wallet-mensajeros.spec.ts` | los 2 `test.describe` de `/mis-pagos` (acceso del mensajero y bloqueo del maestro) + la constante del mensajero sembrado si queda sin uso. Sobreviven los 2 de `/wallet/mensajeros`. **Contabilidad, no verificación**: en este repo los E2E no se ejecutan |

### 4.4 — INTACTOS: se comprobó que NO hay que tocarlos (3 + prosa)

| Archivo | Por qué NO se toca, medido |
| --- | --- |
| `tests/components/QrScanner.test.tsx` | prueba el componente compartido, que se conserva |
| `tests/unit/descarga/columnas-asercion-de-orden.guardia.test.ts` | su suelo es `CONSTANTES_CONOCIDAS = 35`. Constantes `COLUMNAS_DESCARGA_*` en el árbol hoy: **41** (40 en `app/` + 1 en `components/`). Tras borrar una: **40 ≥ 35**. El suelo NO se toca. La mención de `_MIS_PAGOS` en su cabecera es prosa histórica |
| `tests/unit/descarga/adaptador-conjunto.guardia.test.ts` | su suelo es `conDedicado.length >= 13`. Archivos de `app/` que llaman `filasDesdeResultado` hoy: **24**. Tras la ficha: **23 ≥ 13**. No se toca |
| `tests/unit/config/paginacion-dominios.test.ts`, `tests/components/paginacion/paginacion-transversal.test.tsx`, `tests/components/descarga/ControlDescargaTransversal.test.tsx`, `tests/unit/services/wallet-cuentas-paginado.test.ts`, `tests/unit/services/wallet-desglose-mensajero-descarga.test.ts` | mencionan `mis-pagos`/`DesglosePagos` **solo en comentarios**. Ninguna referencia de ejecución |

---

## §5 — Las guardias que se disparan aunque no nombren la ficha

Éstas son las que el encargo no anticipaba y las que hacen falsa la idea de que esto es «borrar
ocho archivos».

### 5.1 · `superficie-de-uso.guardia` (R-A) — la esperada

Las tres acciones huérfanas la ponen roja. Se resuelve retirándolas (§2). **El agujero del
baseline:** ese archivo **ya está** en `tests/baseline-rojos.json` por deuda ajena
(`lib/actions/tarifas.ts:67 obtenerTarifa`, desde 2026-08-28) y **la comparación del gate es por
ARCHIVO, no por contenido**. Si esta ficha lo dejara con entradas nuevas, el gate saldría **VERDE
MINTIENDO**. Por eso R13/R27 exigen **leer la lista impresa** y pegarla en el informe, y por eso
la guardia nueva afirma que el baseline no ganó entradas de esta ficha.

### 5.2 · `cobertura-tablas.guardia` — dos totales duros

Dos cosas caen a la vez si no se tocan: `expect(archivosEnArbol.has(entrada.ruta)).toBe(true)`
(«`…/DesglosePagos.tsx` ya no monta DataTable») y los dos totales `28`/`28`. Van a `27`/`27`,
**medidos**. Las exclusiones (`excluidas.length === 8`) **no cambian**: la tabla que se va estaba
`con_descarga`, no `fuera`.

### 5.3 · `contadores-cabecera.guardia` — el suelo que roza

`expect(paginadas.size).toBeGreaterThanOrEqual(30)`. Hoy hay **28 archivos de `app/` con
`<Pagination`** más los hijos con `<DataTable>` que esos archivos importan (`MisPagosModule →
DesglosePagos`, `MiWalletModule → DesgloseTiendaLedger`, `WalletModule → WalletLedger`,
`RecepcionSateliteModule → SateliteOrdenesListado`). Esta ficha **quita dos de ese conjunto**
(`MisPagosModule` y `DesglosePagos`).

**Esto hay que MEDIRLO, no estimarlo.** Se corre la guardia y se lee `paginadas.size` antes y
después. Si queda `>= 30`, no se toca nada. Si baja de 30, se baja el suelo **nombrando la
pantalla que desapareció** — es literalmente lo que su propio comentario autoriza: «bajar el piso
solo es legítimo cuando se puede nombrar la pantalla que desapareció; si vuelve a bajar sin
nombre, el detector se rompió».

### 5.4 · `caja-173-alcance.guardia` — ENOENT, no un `toEqual` fallido

`fuentesDe(carpeta)` hace `readdirSync` sin comprobar existencia: la carpeta borrada **lanza**, no
falla con mensaje. El síntoma será un archivo entero en rojo con un stack de `node:fs`, no un
diagnóstico. Está dicho aquí para que nadie pierda media hora buscando la causa.

### 5.5 · `liquidacion-money-safe` — `existsSync` explícito

Su primer `it` recorre `ARCHIVOS_DE_LA_FEATURE` y exige que cada ruta exista. Dos entradas de
`mis-pagos` la ponen roja. Su cláusula de auto-captura solo mira `components/shared/liquidacion/`
y `lib/**` con `liquidacion` en la ruta, así que **quitar las dos entradas no reabre ningún
hueco**.

### 5.6 · `test-citado-desaparecido.guardia` — la que nadie vio venir, y es LA guardia de esta ficha

Esta guardia existe **por este incidente exacto**: el 2026-08-07 se borró un componente y con él
el test que probaba los R21–R23 de una feature ajena; el mensajero dejó de oír el tono del chat y
llegó a producción.

Lee los mapas `R<n> → test` de `specs/*/tasks.md` y `specs/*/design.md` (solo filas de tabla cuya
primera celda es `| R<n> |`, y solo lo que va entre backticks) y **falla** si una cita apunta a un
test que la historia de git vio borrarse.

**Medido — hay exactamente UNA cita que esta ficha rompe:**

En **`specs/172-liquidacion/tasks.md`, línea 768**: la fila de trazabilidad de **R54** apunta al
test de integración de la página de mis-pagos, con la descripción «el mensajero ve el pago y su
reverso».

> ⚠️ **Esa fila NO se reproduce aquí tal cual, a propósito** —y es la segunda vez que esta ficha
> tropieza con lo mismo—. `test-citado-desaparecido.guardia` **no distingue una cita reproducida
> como documentación de una cita viva**: copiarla con su formato de tabla hace que la guardia la
> lea como un mapeo de ESTA ficha a un test ya borrado, y el gate se pone rojo. Pasó el
> 2026-08-31, primero con el marcador de la anotación y después con esta fila. Es una limitación
> de la guardia, no de este spec: quien documente citas ajenas, que las describa en prosa.

Y **dos falsos vecinos que NO son citas** (verificados contra el detector):

- `specs/172-liquidacion/tasks.md:565` — prosa de una task, no fila `| R<n> |`.
- `specs/44-wallet-pago-mensajeros/tasks.md:151` — lista de archivos con viñeta, no fila de tabla.
- `specs/230-dinero-sin-centimos/tasks.md:227` — dice `tests/integration/mis-pagos-page` **sin
  extensión**: no casa `CITA_PLAUSIBLE`.

**Salida:** anotar en el propio `specs/172-liquidacion/tasks.md`, en un comentario HTML propio y
con motivo de **≥30 caracteres**:

> ⚠️ **El ejemplo NO se escribe aquí con el marcador literal, a propósito.**
> `test-citado-desaparecido.guardia` busca el marcador en todo `specs/**` y **no distingue un
> ejemplo dentro de un bloque de código de una anotación viva**: escribirlo aquí, con el test
> todavía en el árbol, pone el gate ROJO — y así pasó el 2026-08-31. Es una limitación de la
> guardia, no de este spec.
>
> La anotación va **en `specs/172-liquidacion/tasks.md`**, en un comentario HTML propio, y sólo
> **cuando el borrado ya ocurrió**. Su forma: el marcador de test desaparecido, el nombre del
> archivo, y a continuación este motivo (≥30 caracteres):
>
> «la ficha 336 borró /mis-pagos por decisión humana del 2026-08-30; R54 se observaba sólo en esa
> pantalla y no hay superficie sustituta donde el mensajero vea el pago y su reverso»

Repuntar la cita a otro test **no es opción**: se buscó sustituto y no existe. Inventarlo sería
justo lo que la guardia prohíbe.

### 5.7 · Lo que se comprobó que NO se dispara

`columnas-asercion-de-orden` (41→40 sobre suelo 35), `adaptador-conjunto` (24→23 sobre suelo 13),
`pwa-manifiesto-atajos` (no nombra ninguna de las dos rutas), `menu-visibility` /
`destino-post-login` (no hay censo de rutas del sistema de archivos), `test-citado-desaparecido`
en su anti-vacuidad (`TESTS_DE_HOY >= 800`; se borran 2).

---

## §6 — La guardia nueva: `tests/unit/guards/rutas-336-retiradas.guardia.test.ts`

Afirma el **estado final**, no el proceso. Lectura estática del árbol; la selecciona
`vitest run guard` por el nombre, sin registrarse en ninguna lista.

**0 · Autocomprobación del detector (R25).**
- El quitador de comentarios (`tests/fixtures/sin-comentarios.ts`, el compartido del repo) se
  prueba en las dos direcciones sobre texto sintético: una `import … "@/hooks/useQrNavigate"`
  se ve; la misma línea dentro de `//` o `/* */` **no**.
- Anti-vacuidad: se leyeron `> 800` módulos de producción y ninguno vacío.

**1 · Las rutas no existen (R1, R2).**
- `app/(app)/mis-pagos` y `app/(app)/qr` no existen como directorios.
- `hooks/useQrNavigate.ts` no existe.
- Control de no-vacuidad del `not`: `app/(app)/mi-wallet` **sí** existe (si el resolvedor de
  rutas se rompiera, este par de aserciones lo delata).

**2 · Cero referencias de ejecución (R3).**
Sobre `app/`, `components/`, `lib/`, `hooks/`, `providers/` y `middleware.ts`, **sin comentarios**:
ninguna aparición de `mis-pagos`, `useQrNavigate`, `MisPagosModule`, `CuentaPorPagarCard`,
`DesglosePagos` (palabra exacta; **no** `DesglosePagosMensajero`), `COLUMNAS_DESCARGA_MIS_PAGOS`,
`filaDescargaMiPago`, `verMiCuentaPorPagarAction`, `listarMisPagosAction`,
`listarMisPagosCompletoAction`, ni un `href`/`push` a `"/qr"`.

**3 · La cámara sigue viva (R6, R7).**
- `components/shared/QrScanner.tsx` existe y exporta `QrScanner`.
- Sus importadores directos incluyen `components/shared/EscanerGuiaCard.tsx` **y**
  `app/(app)/mis-asignaciones/_components/VerificarGuiaGate.tsx`, y son **≥ 2**.
- Las **seis** superficies de §0 existen y montan `<EscanerGuiaCard`.
- `components/shared/EscanerModal.tsx` sigue existiendo (es lo que desmonta la cámara).

**4 · Las acciones se retiraron, no se taparon (R4, R12).**
- `lib/actions/wallet-mensajero.ts` **no** exporta las tres.
- **Sí** exporta las cuatro de administración (control positivo: si alguien borrara el archivo
  entero, esto lo caza).
- El archivo **no gana** ninguna anotación `@sin-superficie` nueva: la única admitida es la que ya
  vive sobre `listarCuentasPorPagarAction`, y se afirma que sigue siendo **exactamente una**.

**5 · El baseline no ganó entradas de esta ficha (R13).**
- Ninguna clave ni motivo de `tests/baseline-rojos.json` menciona `mis-pagos`, `qr`,
  `wallet-mensajero` ni `useQrNavigate`.
- Si la entrada de `superficie-de-uso.guardia.test.ts` sigue existiendo, su motivo sigue
  nombrando `tarifas` / `obtenerTarifa` — es decir, sigue siendo **la deuda ajena y solo ella**.

**6 · La cobertura ajena sobrevivió (R15, R20, R21, R22).**
Lectura estática de los archivos de test que tienen que seguir vivos:
- los 12 de §4.2 existen;
- `pago-mensajero-liquidacion.test.ts` conserva **≥ 2** controles positivos `typeof actions.X`;
- `caja-173-alcance.guardia.test.ts` conserva **≥ 2** carpetas en `PANTALLAS_CONGELADAS`;
- `liquidacion-money-safe.test.ts` conserva un censo **no vacío**;
- `wallet-mensajero-descarga-columnas.test.ts` conserva un `expect(` que **nombra**
  `COLUMNAS_DESCARGA_DESGLOSE_MENSAJERO`;
- `WalletDescarga.test.tsx` conserva **≥ 3** ledgers en su tabla de casos.

---

## §7 — Alternativas descartadas

1. **Anotar las tres acciones con `@sin-superficie` en vez de retirarlas.** Descartada en §2, con
   tres argumentos: falsea la semántica de la anotación, crea tres excepciones eternas que la
   propia guardia declara basura, y deja un camino de servidor al dinero de un mensajero sin
   ningún lector.

2. **Borrar la página y dejar `_components/` para «no romper tests».** Descartada: `R-B` de la
   guardia de superficie se pone roja al instante (componente que nadie monta) y, sobre todo, es
   **la forma exacta del incidente del 2026-07-31**: la vista desapareció y lo que quedó colgando
   fue el nivel de abajo. Además no evita ni uno de los rojos de §5.

3. **Conservar `/mis-pagos` y darle puerta en el menú, como se hizo con `/mi-wallet`.**
   Técnicamente es la opción barata —la pantalla funciona, acota bien y es de solo lectura— y se
   le puso al humano delante junto al dato de que es el **único** sitio donde un mensajero ve lo
   que se le debe. **Descartada por decisión humana explícita**, reafirmada tras verlo. Queda
   aquí para que la asimetría con `/mi-wallet` no parezca un descuido.

4. **Borrar también `WalletMensajeroService` y `PagoMensajeroMovimientoRepository`.** Descartada
   por medición: los usan las cinco lecturas de administración de `/wallet/mensajeros`. Se
   comprobó en el archivo, no en el grafo.

5. **Borrar enteros los archivos de test que nombran `mis-pagos` (18 archivos).** Descartada, y es
   la razón de existir de este spec: **12 de esos 18 cubren otras features** (44, 170, 172, 173,
   293). Borrarlos en bloque es exactamente la regresión que ya costó producción una vez.

6. **Correr el gate rápido y abrir el PR.** No es una opción: `./init.sh --rapido` **se niega**
   ante este diff (`lib/types/**` y nombres de dinero bajo `lib/` y `app/`). Es un `fail`, no un
   aviso.

---

## §8 — Riesgos y lo que esta ficha NO hace

- **NO** toca `db/**`, `middleware.ts`, `package.json` ni la configuración de build.
- **NO** reescribe los `specs/` ni los `progress/` de otras fichas, salvo **una** anotación
  obligada en `specs/172-liquidacion/tasks.md` (§5.6) que la guardia exige y que es la única
  forma honesta de cerrar la cita.
- **NO** añade nada a `tests/baseline-rojos.json`. Si hiciera falta, la ficha se detiene (R14).
- **Riesgo residual aceptado y escrito:** tras esta ficha ningún mensajero puede consultar en la
  app lo que Ordenex le debe. Es la decisión, no un efecto colateral.
