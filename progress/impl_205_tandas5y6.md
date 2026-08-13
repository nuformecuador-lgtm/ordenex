# Feature 205 — Bitácora de implementación, TANDAS 5 y 6

Rama `feature/205-pago-mensajero-desde-wallet`. Alcance: **T5.1 → T5.5** (la UI del pago) y
**T6.1 → T6.3** (el cierre direccionable). Contrato:
`specs/205-pago-mensajero-desde-wallet/{requirements,design,tasks}.md`.
Continúa `progress/impl_205_tanda0.md`, `impl_205_tandas1y2.md` e `impl_205_tandas3y4.md`
(incluida su **ENMIENDA**: `excluidos` es un CONTEO por estado, no una lista).

---

## Archivos creados / modificados

| Archivo | Tarea | Qué |
| --- | --- | --- |
| `components/shared/liquidacion/RegistrarPagoDialog.tsx` | T5.1 | **editado** — hueco `renderPrevisualizacion`, resultado ensanchado a los dos contratos, `mensajeSinSaldo` |
| `app/(app)/wallet/mensajeros/_components/RepartoPrevisualizacion.tsx` | T5.2/T6.2 | **creado** — previsualización + `EnlaceCierre` + clave/filtro/fetcher de SWR |
| `app/(app)/wallet/mensajeros/_components/PagoMensajeroAcciones.tsx` | T5.2/T6.2 | **creado** — botón, cableado del reparto y el reparto APLICADO |
| `app/(app)/wallet/mensajeros/_components/wallet-mensajeros-labels.ts` | T5.2 | **editado** — 5 bloques de texto nuevos + `ESTADO_CIERRE_PLURAL` |
| `app/(app)/wallet/mensajeros/_components/DesglosePagosMensajero.tsx` | T5.3/T6.2 | **editado** — monta el bloque de pago, columna «Cierre» con enlace, refresco dirigido |
| `app/(app)/cierres-admin/_components/cierre-enlace.ts` | T6.1/T6.2 | **creado** — `PARAM_CIERRE`, `RUTA_CIERRES_ADMIN`, `hrefDetalleCierre` |
| `app/(app)/cierres-admin/_components/CierresAdminModule.tsx` | T6.1 | **editado** — abre por `?cierre=` y retira el parámetro al cerrar |
| `lib/actions/liquidacion.ts` | encargo heredado | **editado** — se BORRAN las dos anotaciones `@sin-superficie` |
| `tests/unit/guards/liquidacion-money-safe.test.ts` | T5.4 | **editado** — censo +3 archivos de cliente |
| `tests/components/RepartoPrevisualizacion.test.tsx` | T5.5 | **creado** — 18 casos |
| `tests/components/PagoMensajeroAcciones.test.tsx` | T5.5 | **creado** — 12 casos |
| `tests/components/DesglosePagosMensajero.test.tsx` | T6.3 | **creado** — 4 casos |
| `tests/components/CierresAdminDeepLink.test.tsx` | T6.3 | **creado** — 10 casos |
| 8 tests que montan `CierresAdminModule` | T6.1 | **editados** — SOLO el doble de `next/navigation` (+`usePathname`, +`useSearchParams`); ni un assert |

Los ocho del arnés: `CierresAdminModule`, `CierresAdminPagoMensajero`, `CierresAdminIndemnizacion`,
`CierresAdminPage`, `descarga/CierresDescarga`, `paginacion/{BajoRiesgo,Colas,transversal}`.

**Nada de backend**: ni servicios, ni repositorios, ni schemas, ni migraciones.

---

## El encargo heredado, cerrado

Las dos `@sin-superficie` de `lib/actions/liquidacion.ts` **ya no están**. En su lugar, cada
acción dice quién la monta. Y la palabra tampoco quedó suelta en la prosa: la anotación se
detecta por regex sobre el comentario PEGADO al export, así que escribir «se borró la anotación
`@sin-superficie`» ahí habría vuelto a plantarla y el guard habría caído por **excepción
caducada** — el rojo exacto que había que evitar. Medido:
`superficie-de-uso.guardia.test.ts` verde con las dos acciones ya alcanzables desde
`/wallet/mensajeros`.

---

## Decisiones que el spec no fijaba (y por qué)

### 1. El diálogo compartido admite DOS contratos de respuesta, no uno

`RegistrarPagoDialog.onRegistrar` devolvía `RegistrarPagoResult`, cuyo `ok` **trae un
comprobante**. El reparto responde con `RepartoAplicadoDTO`: N imputaciones y ningún pago
único, así que su resultado no es asignable a ese tipo. T5.1 pedía reusar el diálogo (es de
donde salen gratis R27/R30/R31) y eso obligaba a elegir.

Lo hecho: el tipo del resultado pasa a `RegistrarPagoResult | RegistrarRepartoResult` y
`onRegistrado` **solo se invoca si la respuesta trae comprobante** (`"pago" in resultado`). Es
aditivo por construcción: los tres montajes de la 172 devuelven `RegistrarPagoResult`, encajan
sin cambiar una línea y `RegistrarPagoDialog.test.tsx` sigue verde **sin tocar un assert**. Los
dos contratos comparten los mismos nombres de estado (design §7.2), así que el `switch` de
`avisoDe` sigue siendo exhaustivo y no se estrenó vocabulario.

La alternativa —fabricar un `PagoRegistradoDTO` falso para que el reparto encajara— era mentir
sobre la forma de un dato de dinero.

### 2. Una SEGUNDA prop aditiva: `mensajeSinSaldo`

El aviso de `sin_saldo` del diálogo dice literalmente «Esta **tienda** no tiene saldo a favor»
(`liquidacion-labels.ts:184`), y hay un test de la 172 que fija ese texto palabra por palabra
(`RegistrarPagoDialog.test.tsx:459`), así que no se puede neutralizar sin tocar asserts ajenos.
En la pantalla del mensajero ese estado significa otra cosa —«ya no queda ningún cierre
aprobado con saldo»— y se alcanza de verdad: basta con que otro pague entre abrir el formulario
y confirmar.

Se añade una prop **opcional con el texto por defecto de siempre**. Es un rótulo, no una regla:
el estado y su semántica no cambian. **Es una desviación de T5.1**, que hablaba de UNA prop
aditiva, y va reportada como tal.

*(Nota para quien pase por ahí: `RegistrarPagoMensajeroDialog` de la 172 tiene el mismo defecto
—un cierre saldado bajo carrera enseñaría «esta tienda»— y NO se toca acá: es de otra feature y
arreglarlo sin su test es meter mano en dinero ajeno.)*

### 3. El aviso de excluidos NO deriva un total

El ejemplo del encargo era «12 cierres no aprobados quedan fuera: 9 rechazados, 3 pendientes».
Ese «12» **no viaja**: habría que sumar los `cantidad` en el cliente. Es un cardinal, no dinero,
así que ningún barrido lo cazaría — y precisamente por eso se evita: la regla de esta pantalla
es que **no se deriva nada**, y una excepción «inofensiva» es la grieta por la que entra la
siguiente. El aviso queda: «Estos cierres no pueden recibir pago porque no están aprobados: 9
rechazados, 3 solicitados.» Misma información, cero aritmética.

Los rótulos en plural salen de un `Record<CierreEstado, string>` **exhaustivo**, no de añadirle
una «s» al rótulo singular: el día que el catálogo gane un estado, el build rompe y alguien
escribe su palabra en vez de que la pantalla invente una.

### 4. El enlace: texto visible corto + identificador solo para lectores de pantalla

`EnlaceCierre` pinta «Ver el cierre» y añade `(<uuid>)` en un `<span class="sr-only">`. Con
`aria-label` el nombre accesible habría **sustituido** al texto visible, que es lo que rompe
«Label in Name» (quien dicta por voz «ver el cierre» no podría activarlo). Así el nombre
CONTIENE lo visible y además es único por cierre, que es lo que hace que veinte enlaces
idénticos en una tabla se distingan.

Detalle medido, por si alguien escribe un test nuevo: `dom-accessibility-api` **recorta** el
espacio de cada nodo, así que el nombre computado es `Ver el cierre(<uuid>)` aunque el
`textContent` tenga el espacio. Los tests casan con `\s*` a propósito.

### 5. El módulo del enlace vive aparte (`cierre-enlace.ts`)

`PARAM_CIERRE` lo escribe la wallet y lo lee `/cierres-admin`. En dos archivos, renombrarlo en
uno dejaría el enlace apuntando a un parámetro que nadie lee: **la pantalla abriría sin detalle
y ningún test de una de las dos mitades lo vería**. Hay un caso que ata las dos puntas
(«el módulo lee la clave que escribe el constructor del enlace»). Además evita que
`/wallet/mensajeros` arrastre `CierresAdminModule` entero en su paquete.

### 6. `AbrirCierreDeLaUrl`: un componente que renderiza `null`

El efecto que abre el detalle necesita depender de `abrirDetalle`, que se declara **después**
del `return` temprano de `sinZona` y por tanto no puede ser dependencia de un hook del módulo
(un `useCallback` ahí sería un hook condicional). Con un hijo, la dependencia es explícita, no
hay `eslint-disable` y el disparo lo mide un `ref`, no la identidad de la función.

**Una vez por navegación**: el `ref` recuerda el id ya abierto (los re-renders que provoca
abrirlo no lo reabren) y se limpia cuando el parámetro desaparece, de modo que volver a navegar
al MISMO cierre sí lo abre.

### 7. `Suspense`: no hizo falta

`useSearchParams` obliga a un límite de `Suspense` **solo si la página se prerenderiza**.
`/cierres-admin` resuelve el actor por cookies, así que es dinámica; el precedente vivo en el
repo es `/monitoreo`, que usa `useSearchParams` en `TableroDiaModule` sin `Suspense` y está en
producción. `app/(app)/cierres-admin/page.tsx` **no se tocó**, que es lo que T6.1 pedía.

### 8. Refresco dirigido: cada componente refresca SUS claves

El bloque de pago invalida las previsualizaciones de ESE mensajero (filtro sobre el prefijo +
id, así alcanza la de cada monto) y **avisa** al desglose, que invalida las suyas —cualquier
página, cualquier filtro— y ninguna más. Sin cruzar claves entre módulos: el desglose importa el
bloque de pago, y el camino contrario habría sido un ciclo de imports.

---

## Qué se mide, y qué NO se mide

Los 44 casos nuevos existen por tres propiedades que ningún test de servidor puede ver:

1. **el navegador no calcula dinero.** Casi todas las respuestas de prueba tienen cifras que
   **no cuadran a propósito** (se teclean 9000 y el servidor reparte 4000 + 3000; el aplicado
   difiere del previsualizado). Si alguien metiera una suma o una resta en el cliente, esas
   cifras cambiarían y los casos caerían;
2. **la clave de idempotencia sobrevive al reintento.** Un reintento con clave nueva es un
   segundo pago y el `UNIQUE` del servidor no lo vería;
3. **el detalle se pide POR ID.** El deep link se prueba con un cierre que **no está en ninguna
   de las dos tablas**: si alguien «optimizara» buscando la fila cargada, el enlace dejaría de
   funcionar justo para el cierre viejo, que es el caso normal al pagar deuda acumulada.

---

## Mapa `R<n> → test` (lo que estas dos tandas cubren)

| Requisito | Test |
| --- | --- |
| R3 | `DesglosePagosMensajero.test.tsx` (el desglose monta el bloque y pide el imputable de ESE mensajero) + `PagoMensajeroAcciones.test.tsx` |
| R9 (mitad de cliente) | `PagoMensajeroAcciones.test.tsx` (la petición lleva `mensajeroId` y **no** `cierreId`) + `RepartoPrevisualizacion.test.tsx` (la previsualización tampoco) |
| R15 | `PagoMensajeroAcciones.test.tsx` (sin imputable: control apagado, explicación con texto y el formulario ni se monta) |
| R25 | ídem (se pinta el reparto APLICADO —₡6.500— y no el previsualizado —₡7.000—; `restanteImputable` a la vista) |
| R27, R31 | ídem (reintento tras fallo de red y tras rechazo de dominio: MISMA clave) |
| R28, R30 | ídem (`ya_registrado` enseña el reparto original y lo dice sin alarmar; reabrir el formulario acuña clave NUEVA) |
| R32 | `RepartoPrevisualizacion.test.tsx` (a qué cierres y cuánto a cada uno, tal cual) |
| R33 | ídem (la parcial marcada, una sola, con su resto) |
| R34 | ídem (se cambia un importe de la respuesta y cambia el pintado; el total tecleado no aparece por ningún lado) + barrido money-safe del archivo |
| R36 | ídem (conteo por estado con sus rótulos; sin excluidos no hay aviso; 900 rechazados siguen siendo UNA línea sin ids ni fechas) |
| R37 | ídem (aviso con su cifra ya comparada; sin deuda no imputable, sin aviso) |
| R38 | ídem (sobrante y máximo, los dos del servidor) |
| R39, R40 | `CierresAdminDeepLink.test.tsx` (`?cierre=` abre el detalle; lectura POR ID; funciona con un cierre ausente de la página; una vez por navegación) |
| R41 | ídem (`no_encontrada` ⇒ aviso y ni un dato pintado; sesión caída ⇒ aviso y pantalla en pie) |
| R42 | el guard de la página (`page.tsx`) no cambia: el enlace no amplía permisos; el módulo no decide acceso |
| R43 | `DesglosePagosMensajero.test.tsx` (dos filas con cierre ⇒ dos enlaces al mismo detalle; la fila sin cierre ⇒ sin enlace y con raya; ninguna URL lleva el id del PAGO) |
| R44 | `RepartoPrevisualizacion.test.tsx` + `PagoMensajeroAcciones.test.tsx` (cada cierre de la previsualización y del resultado lleva el mismo enlace) |
| R45 | `CierresAdminDeepLink.test.tsx` (cerrar retira el parámetro y conserva los demás; el detalle abierto desde la tabla NO toca la URL) |
| R16, R50 | `liquidacion-money-safe.test.ts` (censo +3 archivos de cliente, con las CUATRO aserciones) + un barrido por archivo en los dos tests de componente |
| R56 | `RepartoPrevisualizacion.test.tsx` (recorte con sus tres cifras y **sin** el otro aviso; con los dos activos, los dos textos, en párrafos distintos) |

R1/R2/R4-R8, R10-R14, R17-R24, R26, R29, R35, R46-R55, R57 y R58 son de las tandas 0-4.

---

## Verificación

| Comando | Resultado |
| --- | --- |
| `pnpm exec vitest run` (los 4 archivos nuevos) | `Test Files 4 passed (4) · Tests 44 passed (44)` |
| `pnpm exec vitest run tests/components tests/unit/guards` | `Test Files 203 passed (203) · Tests 2552 passed (2552)` |
| `pnpm exec tsc --noEmit` | `TSC_EXIT=0`, sin salida |
| `pnpm exec vitest run tests/integration tests/unit/actions` (extra) | `Test Files 232 passed (232) · Tests 2662 passed (2662)` |
| `pnpm exec eslint` (los 12 archivos tocados) | sin salida — 0 errores, 0 warnings |

El gate de tanda (`./init.sh --rapido`) y el completo los corre el leader.

---

## Mutaciones — 13/13 muertas

Runner en scratchpad (`mutar-205-ui.mjs`), **archivo de script, nunca `node -e`**, con las
autocomprobaciones que este repo aprendió a exigir: (1) la línea base tiene que ser LEGIBLE
—resumen con forma de conteo real— y verde, o aborta; (2) una mutación de **CONTROL** plantada
tiene que morir antes de reportar un solo veredicto; (3) el ancla de cada mutación tiene que
aparecer **exactamente una vez** o aborta; (4) el archivo se restaura siempre y se compara el
**hash**. Una corrida ilegible se marca `ILEGIBLE`, jamás «sobrevivió».

Línea base: `Tests 44 passed (44)`.

| # | Mutación | Veredicto |
| --- | --- | --- |
| CONTROL | el enlace al cierre se pinta oculto (nadie lo alcanza) | **muerta** — 4 rojos |
| a | **(a)** la clave de idempotencia se acuña EN CADA ENVÍO | **muerta** — 2 rojos |
| b | **(b)** al terminar se pinta lo PREVISUALIZADO en vez de lo aplicado | **muerta** — 3 rojos |
| c | **(c)** el aviso de cierres excluidos DESAPARECE | **muerta** — 2 rojos |
| d | **(d)** el enlace pierde el id del cierre | **muerta** — 4 rojos |
| e | los DOS avisos se funden en uno (el recorte cuelga de la deuda no imputable) | **muerta** — 2 rojos |
| f | la imputación PARCIAL deja de marcarse | **muerta** — 1 rojo |
| g | cerrar el detalle NO limpia la URL (R45) | **muerta** — 2 rojos |
| h | el detalle de la URL se reabre en CADA render (se pierde el candado del `ref`) | **muerta** — 2 rojos |
| i | la fila SIN cierre lleva enlace igual | **muerta** — 2 rojos |
| j | el botón se habilita aunque no haya nada imputable (R15) | **muerta** — 1 rojo |
| k | la petición del reparto elige el cierre (R9) | **muerta** — 1 rojo |
| l | la previsualización nunca manda el monto | **muerta** — 17 rojos |

Las cuatro que el encargo exigía —(a), (b), (c) y (d)— están arriba y las cuatro mueren.

---

## Dos guardias ajenas que hablaron, y qué se hizo

1. **`ancla-de-carga.guardia`** — un `waitFor` anclado SOLO a un conteo de elementos no es un
   ancla: durante la carga la tabla también tiene cabecera y fila de estado, así que el conteo
   se cumple a media carga. Dos esperas de `CierresAdminDeepLink.test.tsx` caían ahí. **No se
   tocó la guardia**: se cambiaron por `findAllByRole`, que espera a que el control ESTÉ y no a
   cuántos hay.
2. **`superficie-de-uso.guardia`** — ver arriba: las dos anotaciones borradas, y la palabra
   fuera también de la prosa pegada al export.

---

## Lo que queda para quien siga

1. **La migración de la tanda 1 sigue sin aplicarse a ninguna base.** Nada de estas tandas la
   necesita para correr en verde, pero el reparto no funciona en runtime hasta que se aplique:
   la pantalla pediría la previsualización y el servidor fallaría al escribir el acto.
2. **El `sin_saldo` de `RegistrarPagoMensajeroDialog` (172) sigue diciendo «esta tienda»** en la
   carrera equivalente de `/cierres-admin`. Es deuda ajena, se deja anotada y no se toca.
3. **T7.1 (mapa completo de los 58) y T7.2 (gate completo) no son de estas tandas.**

---

## Veredicto

Tandas 5 y 6 cerradas: se paga a un mensajero desde el desglose de `/wallet/mensajeros` con el
formulario compartido —que aporta gratis la clave de idempotencia acuñada al abrirlo—, la
previsualización pinta lo que deriva el servidor sin sumar ni comparar un solo importe, los dos
avisos de deuda siguen siendo dos, el aviso de excluidos es el conteo por estado que decidió el
humano, al terminar se enseña el reparto REALMENTE aplicado y cada cierre nombrado —en la
tabla, en la previsualización y en el resultado— abre su detalle por una dirección compartible
que se limpia al cerrarla. Las 13 mutaciones plantadas mueren, incluidas las cuatro que el
encargo exigía.

---
---

# ADENDA — el hueco de los TRES IMPUTABLES y el `= 50` del constructor

Encargo: cerrar, **medido**, las dos coincidencias que `impl_205_tandas3y4.md` dejó *reportadas
pero sin arreglar* al final de su propia adenda. **Solo archivos de test**: ni `specs/`, ni
`tasks.md`, ni `feature_list.json`, ni un fuente de producción. El código estaba bien; lo que
fallaba es que los tests no lo distinguían.

## Archivos modificados (4, los cuatro de test)

| Archivo | Qué cambió |
| --- | --- |
| `tests/components/PagoMensajeroAcciones.test.tsx` | fixture: los tres imputables separados + `RESUMEN` y `APLICADO` recuadrados; 3 casos acotados al bloque del resultado |
| `tests/components/RepartoPrevisualizacion.test.tsx` | fixture: ídem; 4 casos con su escenario explícito en vez de heredado |
| `tests/components/DesglosePagosMensajero.test.tsx` | fixture: ídem (la MISMA coincidencia, no reportada, encontrada al mirar) |
| `tests/unit/config/reparto-mensajero-config.test.ts` | +1 caso estructural: el default del constructor del servicio |

## 1. Los tres imputables: por qué valían lo mismo y qué valen ahora

`imputable`, `imputableTotal` y `cuentaPorPagar` son **tres cosas distintas** y los tres fixtures
los tenían a `"7000.00"`. Con eso, poner uno donde va otro no cambia ni un píxel.

La historia de Ana Mensajera, ahora idéntica en los tres archivos y **con las dos restas
cuadrando**:

| Campo | Valor | Qué es |
| --- | --- | --- |
| `devengado` − `pagado` | 96.000,00 − 74.850,00 | la fila del mensajero |
| `cuentaPorPagar` | **21.150,00** | lo que la pantalla enseña como deuda (R37) |
| `deudaNoImputable.monto` | **2.300,00** | ajustes manuales: no cuelgan de ningún cierre |
| `imputableTotal` | **18.850,00** | sus cinco cierres aprobados con saldo |
| `recorte.montoFuera` (`fuera: 2`) | **6.450,00** | los que el tope deja fuera (R56) |
| `imputable` | **12.400,00** | lo que UN pago puede saldar ahora (4.000 + 5.000 + 3.400) |

`21.150 = 18.850 + 2.300` y `18.850 = 12.400 + 6.450`. **Hay más deuda de la que cuelga de
cierres, y más cierres imputables de los que caben en la ventana**, que es justo el escenario en
el que confundir los tres campos cuesta dinero: el imputable de la ventana es la cifra que la
pantalla PROPONE como monto, y proponer el total sería proponer un importe que el servidor
rechaza con `excede`.

Tres decisiones que el fixture explica en su propio docstring:

- **el `tope` va a 3, no a 50.** El recorte solo existe con la ventana LLENA (`enVentana ===
  tope`), así que contarlo con 50 exigiría cincuenta cierres en el fixture. El tope es
  inyectable exactamente para esto —el docstring del constructor de `LiquidacionService` lo dice
  con esas palabras— y es lo que ya hacen los tests del servicio. **El caso de R56 sí ejercita el
  tope de producción**: 50 en ventana, 3 fuera por ₡18.500, con sus cifras cuadrando.
- **la lista de imputaciones no es la ventana**: es lo que el monto tecleado alcanza a cubrir. En
  `RepartoPrevisualizacion` la ventana tiene tres cierres y se listan dos, porque los ₡9.000
  tecleados se acaban en el segundo.
- **`APLICADO` sigue sin coincidir con lo previsualizado —que es su razón de ser— pero ahora la
  historia es posible**: el total SÍ es el tecleado, porque un reparto que aplicara menos de lo
  pedido no responde `ok`, responde `excede` (R14). Lo que cambia bajo bloqueo es a QUIÉN le toca:
  se anuló un pago de ₡3.400 sobre el cierre más antiguo, su pendiente subió de 4.000 a 7.400 y los
  mismos ₡12.400 se repartieron entre DOS cierres en vez de tres. `restanteImputable` = 18.850 +
  3.400 − 12.400 = **9.850**, y es del imputable TOTAL, no del de la ventana.

Efecto colateral buscado: **cuatro casos dejan de heredar su escenario del fixture**. «Sin recorte
no hay aviso de recorte» y «sin deuda no imputable no hay aviso» ahora FIJAN los dos
interruptores, no solo el suyo; heredar el otro es lo que dejaba pasar una confusión entre los dos
avisos de R56.

## 2. La prueba por mutación — 3/3 muertas (+2 controles y una variante)

Runner en scratchpad con las autocomprobaciones obligatorias: **(1)** línea base LEGIBLE
(`N passed (T)`) y verde o aborta; **(2)** una mutación de CONTROL tiene que morir antes de
reportar un veredicto; **(3)** el ancla de cada mutación aparece **exactamente una vez** (lo
comprueba el reemplazador, que recibe ancla y sustituto **por archivo** para que ninguna capa de
shell se coma un escapado); **(4)** cada archivo se restaura y se compara por **hash**.

Líneas base: `Tests 34 passed (34)` (los tres archivos de componente) y `Tests 131 passed (131)`
(`tests/unit/config`). Controles: `money(imputable)` → `money("1.00")` muere con 2 rojos; el
defecto de la config 50 → 7 muere con 3 rojos.

| # | Mutación | Antes (medido en `tandas3y4`) | Ahora |
| --- | --- | --- | --- |
| M1 | `PagoMensajeroAcciones.tsx:88` propone `imputableTotal` en vez de `imputable` | **sobrevive**, 43 verdes | **muerta** — 3 rojos |
| M2 | `RepartoPrevisualizacion.tsx:266`: «como máximo se pueden aplicar» dice el TOTAL | **sobrevive**, 30 verdes | **muerta** — 1 rojo |
| M3 | el default del tope del constructor pasa a `= 50` literal | **sobrevive**, 3141 verdes + `tsc` limpio | **muerta** — 1 rojo |
| M3b | el mismo default a `= 12` (no es «el número 50», es de DÓNDE sale) | — | **muerta** — 1 rojo |

**M1 — los tres rojos, en dos archivos:**

```
× el desglose monta el bloque de pago, con lo que dice el servidor que se puede pagar
  Unable to find an element with the text: ₡12.400,00        (DesglosePagosMensajero)
× ofrece registrar el pago con lo que el servidor dice que se puede pagar
  Unable to find an element with the text: ₡12.400,00        (PagoMensajeroAcciones)
× la petición lleva el mensajero y NUNCA un cierre: contra cuáles se imputa lo decide el servidor
  AssertionError: expected { …(5) } to match object { …(3) }  ← manda monto "18850.00"
```

Los dos primeros son la cifra en pantalla; el tercero es **el importe que de verdad viaja**, que
es el que el servidor habría rechazado.

**M2 — el rojo:**

```
× avisa con el sobrante y el máximo, los dos del servidor
  Unable to find an element with the text: /supera lo que se puede pagar ahora: sobran
  ₡2\.000,00\. Como máximo se pueden aplicar ₡12\.400,00/
```

**M3 — el rojo, y la contraprueba de que nadie más lo veía:**

```
× R53: el SERVICIO tampoco lo escribe — su tope por defecto sale de aqui
  AssertionError: expected 'constructor(\n    private readonly pa…' to match
  /maxCierresPorReparto:\s*number\s*=\s*repartoMensajeroConfig\.MAX_CIERRES_POR_REPARTO\b/
```

Con el `= 50` plantado, **`tests/unit/services` entero sigue verde: `Test Files 164 passed ·
Tests 2721 passed (2721)`**. La aserción nueva es lo único que lo caza, que es exactamente lo que
el encargo pedía demostrar.

### El caso nuevo, y por qué no afirma el VALOR

Vive en `tests/unit/config/reparto-mensajero-config.test.ts`, junto al «nadie más escribe el 50»
que solo barría el módulo puro. Afirma **de dónde sale** el default, no cuánto vale —afirmar el
valor sería la misma coincidencia otra vez, porque el 50 del literal y el 50 de la config valen
lo mismo HOY— y añade que **ningún parámetro del constructor trae un número por defecto**: más
ancho que el tope a propósito, porque cualquier cota de negocio escrita ahí es una segunda copia,
se llame como se llame. El reloj (`= () => new Date()`) no es un número y pasa.

**Un hallazgo del propio ejercicio:** la primera versión cortaba el constructor con
`indexOf("constructor(")`, y el mensaje de error del mutante lo delató —
`expected 'constructor() {\n    super("liquidaci…'`—: por delante hay **cuatro clases de error
con su propio constructor**, así que el corte empezaba en la línea 64 y no en la 236. Pasaba en
verde y moría con la mutación por accidente, barriendo doscientas líneas ajenas. Ahora arranca en
`export class LiquidacionService` y lleva cuatro autocomprobaciones sobre el propio corte
(contiene `private readonly pagoRepo`, no contiene `class `), para que un corte vacío no sea un
verde que no comprueba nada. **Ese mismo corte impreciso vive en
`tests/unit/services/liquidacion-caja-puerto.test.ts:105`** — pasa por el mismo accidente y
queda REPORTADO, no tocado: no es de este encargo.

## 3. El tercer archivo, no reportado, con la misma coincidencia

`tests/components/DesglosePagosMensajero.test.tsx` tenía los tres imputables a `"7000.00"`
igual que los dos nombrados en el encargo, y su único assert de dinero
(`within(bloque).getByText("₡7.000,00")`) tampoco distinguía. Es uno de los cuatro archivos de la
medición original. Se le da la misma historia y **entra en los rojos de M1**.

## Verificación

| Comando | Resultado |
| --- | --- |
| `pnpm exec vitest run tests/components` | `Test Files 177 passed (177) · Tests 2262 passed (2262)` |
| `pnpm exec vitest run tests/unit/config tests/unit/services` | `Test Files 185 passed (185) · Tests 2852 passed (2852)` |
| `pnpm exec tsc --noEmit` | `TSC_EXIT=0`, sin salida |
| `pnpm exec eslint` (los 4 archivos tocados) | `EXIT=0`, sin salida |

El comando del encargo se corrió primero de una pieza y salió `4 failed | 354 passed` con **5
rojos que no son rojos**: `Timeout waiting for worker to respond` y `Failed to start forks worker`
en `SatelitePaginacion`, `SateliteSeleccionOtrasPaginas`, `RankingHistoricoDescarga` y
`OrdenesRutearSatelite` —cuatro archivos que esta rama no toca—, con duraciones de siete horas
por archivo: la máquina se quedó sin workers. **Los cuatro, corridos aparte: `Test Files 4 passed
· Tests 33 passed (33)`.** De ahí que la tabla parta el comando en dos.

Los tres fuentes de producción mutados quedaron restaurados y comprobados por hash, uno a uno, y
los tres coinciden con los que ya constaban en `impl_205_tandas3y4.md`: `PagoMensajeroAcciones.tsx`
(`ea5f00d5559ea752de5bd710cc69f135`), `RepartoPrevisualizacion.tsx`
(`1ec772546f00990d0c360a0cd800b01e`), `LiquidacionService.ts`
(`8256cdbe4c4579e4af0376fce9ad3c1e`); más el de los controles, `reparto-mensajero.ts`
(`65ad11db3d339929af11d6671393c0e4`). Gate y mutaciones nunca en paralelo.

## Veredicto de la adenda

Los tres imputables valen tres cifras que cuentan una historia con las restas cuadrando, así que
las dos mutaciones que sobrevivían con 43 y 30 tests en verde ahora mueren con 3 y 1 rojos que
nombran el importe equivocado; y el default del tope, que sobrevivía con 3141 verdes y `tsc`
limpio, muere con una aserción estructural que afirma su ORIGEN y no su valor —comprobado también
con un `= 12`— mientras `tests/unit/services` sigue sin enterarse, que es la medida de que el
agujero era ese y no otro.

## Adenda 2 — n1 (`tope` vs `enVentana`): cerrado con un centinela, no con un `tope: 4`

`recorte.tope` y `recorte.enVentana` **no se pueden separar con una respuesta realista**: el DTO
pone `aplicado = fuera > 0`, y que alguien quede fuera exige la ventana llena
(`ventana = imputables.slice(0, tope)`), así que `aplicado: true ⟹ enVentana === tope` en TODA
previsualización — un `tope: 4` con `enVentana: 3` sería un dato que el servidor no emite. Los
cuatro fixtures quedan intactos y el caso nuevo de `RepartoPrevisualizacion.test.tsx` usa
`tope: 7` como CENTINELA (el componente no pinta el tope en ningún sitio, así que solo puede
salir por leer el campo equivocado), con autocomprobación de que el 7 no vive en la frase buena;
el invariante que obliga al centinela queda fijado en `reparto-liquidacion-mensajero.test.ts`
(«con recorte, la ventana esta LLENA», con autocomprobación `fuera === [5,4,3,2,1]` y el
contraste `enVentana < tope` solo con `fuera === 0`). **O1 medida antes y después con el mismo
árbol: sobrevive con 34 verdes / muere con 1 rojo** que nombra el 7 frente al 3.
`RepartoPrevisualizacion.tsx` restaurado y comprobado por hash
(`c0ebc713b69e30960926e045b5c3d5b2b2ad7582ba961b5447f991f571cc1d29`); gate y mutaciones nunca en
paralelo. `vitest run tests/components`: 177 archivos · 2263 tests, sin caídas de worker;
`tsc --noEmit`: exit 0.
**Ojo con la consecuencia que el informe le atribuye a n1** («la pantalla diría 50 donde el pago
alcanzó a 49»): la ventana encogida de §2.5.5 vive en la ESCRITURA, y `RegistrarRepartoResult` no
lleva `recorte`, así que ese texto no se pinta nunca desde ese camino. Lo que el caso protege es
otra cosa, y sigue valiendo: que el rótulo lea el campo que le toca el día que el tope se
nombre en pantalla o que la previsualización cambie.
