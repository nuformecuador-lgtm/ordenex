# impl 238 — FRONTEND (T4): la pantalla de confirmación física

Rama `feature/238-confirmacion-fisica-cierre`, encima del backend de T1–T3 **sin commitear**.
Alcance: **T4.1 – T4.7**, y nada más. **`lib/` no se tocó ni una línea.** Sin commit.

Bitácora del backend: `progress/impl_238.md` (no se toca desde aquí).

---

## Archivos

| Archivo | Qué |
| --- | --- |
| `app/(app)/cierres-admin/_components/cierre-confirmacion-fisica.tsx` | **NUEVO.** El cuerpo de la ventana + los textos + `interpretarLectura` (pura, R29-R32) + `retornablesDelCierre` / `gestionesDelCierre` / `agruparRetornables`. |
| `app/(app)/cierres-admin/_components/CierresAdminModule.tsx` | **MODIFICADO** (+215 / −21). La tercera rama de `pedirAprobacion`, el estado de la ventana, el reparto de `fieldErrors` y el `Modal`. |
| `tests/components/CierresAdminConfirmacionFisica.test.tsx` | **NUEVO**, 26 casos. |

Nada más. `lib/`, `db/`, `components/` y las Server Actions quedan como el backend las dejó.

---

## Qué se montó, por tarea

### T4.1 — la tercera rama de `pedirAprobacion()`

Tres caminos **de igual rango**, en este orden:

```
retornables.length > 0        -> ventana de CONFIRMACIÓN FÍSICA            (R7)
si no, incidentes.length > 0  -> sub-modal de MONTOS, como hasta hoy       (158)
si no                         -> confirmarAprobacion(), byte a byte igual  (R16)
```

`retornables` sale de `retornablesDelCierre(detalle.grupos)`, que filtra el detalle **ya
cargado** por `RESULTADOS_QUE_VUELVEN`. No hay una segunda consulta ni una segunda lista: el
conjunto que la ventana pide confirmar es **el mismo** que el servicio exige cubrir.

**El camino R16 se trató como camino, no como `else`** —medido: 3 de cada 12 cierres—. Tiene su
propio caso, que afirma que el payload sigue siendo `{ cierreId }` con **una sola clave**
(`Object.keys(...).toEqual(["cierreId"])`), y su **pareja de presencia**: el mismo cierre con una
devolución **sí** abre la ventana. Sin la pareja, el caso estaría verde también si la ventana no
existiera.

`confirmarAprobacion(indemnizaciones?, confirmacionFisica?)` construye el payload con dos spreads
condicionales, así que cada clave viaja **sólo si su rama existe**. Es lo que mantiene intacto el
contrato de la 38 (una clave) y el de la 158 (dos claves) — y lo confirma la **M15**: hacer que
`confirmacionFisica` viaje siempre pone en rojo **tres** casos de la suite de la 158.

### T4.2 — la ventana

`Modal` compartido, hermano del sub-modal de montos, con `closeOnConfirm={false}`. Dentro:

- **barra de estado pegada arriba** (progreso + motivo del bloqueo + aviso de la última lectura);
- **línea de incidentes excluidos** (R34), cuando los hay;
- **rejilla de dos columnas**: `EscanerGuiaCard` a la izquierda y la lista agrupada a la derecha.

Cada fila lleva `Nº Guía · Nº Remisión`, `destinatario · tienda`, el **resultado en singular**
(`RESULTADO_FILA_LABEL`) y su **estado** (`Pendiente` / `Confirmada`) como dos `Badge`. El
agrupado usa `RESULTADO_LABEL` («Reprogramadas», «Devueltas», «Rechazadas») en vez de los rótulos
del `design.md` («Devoluciones / Rechazos / Reprogramadas»): son los mismos que el resto de esta
pantalla y los del archivo descargado, y tener dos vocabularios para lo mismo en el mismo modal es
justo lo que `cierre-labels.ts` existe para impedir. **El orden de los grupos tampoco se elige
aquí**: se deriva de `RESULTADOS_QUE_VUELVEN`, para que un resultado retornable nuevo aparezca sin
tocar este archivo.

### T4.3 — los cuatro desenlaces de una guía leída

`interpretarLectura(texto, medio, gestionesDelCierre, yaConfirmadas)` es **pura** y devuelve o una
fila que marcar o un aviso, nunca las dos. Los cuatro mensajes:

| Desenlace | Mensaje | Req |
| --- | --- | --- |
| No se puede leer un número | «No se pudo leer un número de guía en ese código. Escaneá de nuevo o escribí el número.» | R29 |
| No casa ninguna gestión del cierre | «Esa guía no pertenece a este cierre.» | R30 |
| Casa, pero su paquete no vuelve | «Esa guía es de este cierre, pero ese paquete no vuelve a bodega. Resultado: Incidente.» | R31 |
| Ya confirmada en esta sesión | «Esa guía ya está confirmada. No se cuenta dos veces.» | R32 |

Se busca entre **las cinco secciones** del cierre y no sólo entre las retornables: con las
retornables delante, R30 y R31 serían indistinguibles. Y quién «vuelve» lo decide
`vuelveABodega()`, el punto único — la pantalla no tiene su propia lista.

Ninguno de los cuatro marca fila ni llama a la Server Action. Cada caso lo afirma **tres veces**:
el mensaje, el progreso (`Paquetes confirmados: 0 de 2.`) y `aprobarMock` sin llamar.

### T4.4 — los dos caminos de captura

Cámara → `extractNumGuiaFromScan`; tecleado → `/^\d+$/` y el número tal cual. Es la **única**
diferencia entre los dos caminos, exactamente como en `RecogerPaqueteCard`; de ahí en adelante
recorren el mismo código. Un tecleo no numérico devuelve `false` desde `onSubmit`, así que el
valor **se queda en el campo** para corregirlo (hay un caso que teclea `70O1`, con una «O» donde
va un cero — el error real del mostrador).

### T4.5 — el bloqueo con palabras y la exclusión nombrada

- **R27**: `confirmDisabled={faltanPorConfirmar > 0}` **más** el texto, que nombra la salida:
  «Faltan 3 paquetes por confirmar. Si alguno no llegó, **rechazá el cierre** indicando cuáles
  faltan.» Singular y plural son dos frases distintas, no un `paquete(s)`. Los dos casos leen el
  **texto**, no el `disabled`.
- **R34**: sección propia y visible —no un tooltip— que dice cuántos son, **por qué** no se
  escanean («el paquete no vuelve a bodega, se indemniza») y **los nombra uno a uno** con guía,
  remisión y destinatario, para que bodega pueda contar los paquetes del estante sin buscar el
  que «falta». Con su **pareja de ausencia**: sin incidentes la sección no se pinta, y el mismo
  caso comprueba que la ventana **sí** está pintada.

**Añadido no pedido, con su motivo (R13, la mitad del cliente):** una gestión retornable cuya
orden no tiene número de guía muestra en su fila «Sin número de guía: no se puede confirmar.
Avisá a un administrador.». Medido el 2026-08-19 esa población no existe, pero si apareciera el
cierre sería **inaprobable** y sin esta línea bodega escanearía las otras trece y chocaría con un
botón apagado y mudo — que es exactamente lo que la puerta humana pidió evitar. El texto es
**propio y no importado**: los seis mensajes de `CierresAdminService` son constantes de módulo sin
exportar, y traerse un módulo de servicio a un componente de cliente arrastraría el servidor. Si
divergieran, manda el del servidor, que es el que decide.

### T4.6 — cerrar sin completar, y el orden de los dos pasos

- **R35**: cerrar la ventana no envía nada (`aprobarMock` sin llamar) y **conserva lo escaneado**
  mientras el detalle siga abierto (reabrir muestra «1 de 2», no «0 de 2»). Cerrar el **detalle**
  sí lo descarta, junto a los montos: no existe una confirmación a medias persistida.
- **R37**: con incidentes **y** retornables, la confirmación va primero; el botón dice
  «Continuar» (no «Confirmar y aprobar»), y sólo al completarla se abre el sub-modal de montos.
  El caso comprueba los dos pasos, que en el paso 1 no se aprobó nada, y que el payload final
  lleva **las dos listas**.

### T4.7 — errores del servidor por fila

`repartirErroresDelServidor` separa los `fieldErrors` por «¿es del conjunto esperado?» —los dos
conjuntos son disjuntos por construcción, porque un incidente no vuelve a bodega— y **abre la
ventana que tiene el error**: si el servidor discute la confirmación física, teclear montos no
arregla nada. Una clave que no case con ninguna rama cae en el bolsón de los montos, que es donde
caía antes de esta feature: no se pierde ni cambia de sitio. Dos casos: uno de confirmación (se
pinta en su fila, la ventana **sigue abierta**, `successMock` sin llamar) y uno de monto (**no**
reabre la ventana de escaneo).

---

## Dónde viven el progreso y el motivo del bloqueo, y por qué ahí

La medición dice que el techo de un cierre son **14 guías** y que bodega escanea **de pie**. Con
catorce filas, un progreso al final de la lista obliga a soltar el paquete, desplazar y volver:
no existe. Los dos textos —«Paquetes confirmados: 2 de 14.» y «Faltan 12 paquetes por
confirmar…»— van **arriba del todo, en una barra con dos candados independientes**:

1. **`sticky top-0` dentro del cuerpo del modal**, que es el contenedor que desplaza
   (`Modal` renderiza los `children` en un `min-h-0 flex-1 overflow-auto`).
2. **La lista tiene su propio desplazamiento acotado** (`max-h-[45vh] overflow-y-auto`), así que
   en el caso normal el cuerpo del modal **no desplaza en absoluto** y la barra ni se mueve. Es
   el candado que importa: hace que catorce filas no empujen nada fuera de la vista.

Lo que se desplaza al mirar la fila catorce es la **lista**, no la barra ni la tarjeta de captura,
que son lo que hay que tener delante mientras se escanea. Por eso la rejilla es de **dos
columnas** en `lg` (escáner | lista) y no una pila: en una pila, la lista empuja el escáner fuera
de la pantalla en cuanto pasa de cinco filas.

**Por qué el progreso NO va en la `description` del `Modal`**, que también queda fija: eso es
`Dialog.Description`, se anuncia **una vez** al abrir, y un contador que cambia con cada escaneo
no se volvería a anunciar. En la barra es una región viva (`role="status"`). La `description`
queda con lo que sí es estático: qué se pide y por qué.

**Los tres roles de la barra, y por qué son tres:** `status` (el progreso, cambia y se anuncia),
`note` (el motivo del bloqueo o el «están todos», que es consejo y no alerta) y `alert` (el aviso
de la última lectura, que es una corrección inmediata). Un solo `role="alert"` para los tres
convertiría el progreso en una interrupción cada vez que se escanea una guía.

**Y el botón nunca está apagado y mudo.** D2 está firmada y no se suavizó: no hay «confirmar de
todas formas». Lo que hay es el texto que nombra la única salida —rechazar el cierre— justo al
lado del botón bloqueado. La pantalla **no** queda inusable por D2: el gesto que falta cuando un
paquete no llegó ya existe, está a un botón de distancia («Rechazar», en el detalle) y el copy lo
señala por su nombre.

---

## Reutilizado, y lo que no

| Pieza | Qué se hizo |
| --- | --- |
| `EscanerGuiaCard` | **Reusada tal cual**, con `manual` y `submitLabel: "Confirmar"`. Sólo se le pasa `className="max-w-none"`: nace con el ancho de un teléfono y aquí vive en una columna del modal. |
| `QrScanner` | **Reusado**, sin tocar: entra dentro de `EscanerGuiaCard`. Es su sexta superficie. |
| `extractNumGuiaFromScan` | **Reusada tal cual** para el camino cámara. |
| `Modal` compartido | **Reusado**, con `closeOnConfirm={false}` como el sub-modal de la 158. |
| `RESULTADO_LABEL` / `RESULTADO_FILA_LABEL` | **Reusados** de `cierre-labels.ts` (plural para el grupo, singular para la fila). Cero literales nuevos de resultado. |
| `RETORNA_A_BODEGA` / `vuelveABodega` / `RESULTADOS_QUE_VUELVEN` | **Reusados**: la pantalla no declara ninguna lista propia. La guardia de copia única sigue verde. |
| `Badge` (`success` / `warning` / `outline`) | **Reusada** para los dos chips de la fila; cero hex, tokens semánticos (DESIGN.md). |
| **`EscanerModal`** | **NO se usa, a propósito.** Trae su propio botón disparador y su propio diálogo, y esto ya vive dentro de uno: montarlo daría un modal dentro de un modal y un segundo «Recibir paquete» que nadie pidió. Es lo que el `design.md` §5.2 ya decía. |
| **Componente de lista nuevo** | **NO se escribió.** La lista es un `<ul>` con dos `Badge`; `DataTable` es para listas de página, no para catorce filas dentro de un modal en el que se escanea. |

---

## Mapa `R<n> → test`

Todos en `tests/components/CierresAdminConfirmacionFisica.test.tsx` salvo donde se diga.

| Req | Caso |
| --- | --- |
| R7 | «abre la ventana y NO aprueba todavía» |
| R13 (cliente) | «una gestión sin número de guía se nombra como no confirmable, en su fila» |
| R16 | «no abre ninguna ventana y manda `{ cierreId }` sin campos nuevos» + su pareja «el MISMO cierre con una devolución SÍ abre la ventana» · `CierresAdminIndemnizacion.test.tsx` (payload de la 158 intacto, **M15**) |
| R27 | «dice cuántas faltan y qué hacer si un paquete no llegó» (lee el TEXTO) + «con una guía sin confirmar, forzar el botón no llama a la Server Action» |
| R28 | «por CÁMARA: el QR de la etiqueta confirma esa gestión» · «por NÚMERO TECLEADO: el mismo número confirma la misma gestión» · «un número tecleado que no son dígitos se queda en el campo» |
| R29 | «avisa, no marca ninguna fila y no manda nada al servidor» |
| R30 | «lo dice con su mensaje propio, no marca nada y no manda nada» |
| R31 | «el incidente recibe un mensaje PROPIO, distinto del de la guía ajena» · «una `entregada` del cierre recibe el mismo mensaje, con su resultado» |
| R32 | «lo dice y NO la cuenta dos veces» |
| R33 | «las tres filas del conjunto esperado, agrupadas por resultado» · «una fila confirmada cambia su estado a «Confirmada»» |
| R34 | «los nombra uno a uno y dice por qué no se escanean» + su pareja «sin incidentes, la línea de exclusión no se pinta» |
| R35 | «cancelar no llama a `aprobarCierre` y conserva lo ya escaneado al reabrir» · «cerrar el DETALLE descarta lo confirmado» |
| R36 | «con la ventana CERRADA la tarjeta de escaneo no está en el árbol; abierta, sí» · «el montaje es CONDICIONAL y no depende de lo que el diálogo haga con su contenido» |
| R37 | «primero la ventana, después el sub-modal de montos, y el payload lleva las dos listas» |
| T4.7 | «la ventana sigue abierta y el error aparece en la fila de esa gestión» · «un error de un INCIDENTE no abre la ventana» |

---

## Mutaciones — 16 aplicadas, 16 rojos, todos leídos

Arnés en el scratchpad, no en el repo. Para **cada** mutación: se comprueba que el ancla existe y
es **única**, se escribe el archivo mutado, se corre `pnpm exec vitest run <suite>`, se guarda la
salida real en un `.log`, se restaura y se compara **sha256 antes / mutado / después**. Los
`exit=1` y las citas de abajo salen de esos logs, no de mi memoria.

| # | Mutación | Suite | Rojo — **mensaje real** |
| --- | --- | --- | --- |
| M1 | `pedirAprobacion` pierde la rama de retornables | nueva | `TestingLibraryElementError: Unable to find role="dialog" and name "Confirmar los paquetes que vuelven"` (**14 casos** rojos) |
| M2 | `confirmacionFisica` viaja siempre (aunque sea `[]`) | nueva | `AssertionError: expected "vi.fn()" to be called with arguments: [ { cierreId: 'c1' } ]` |
| M3 | la tarjeta se monta incondicionalmente (`{true ? …}`) | nueva | `AssertionError: expected '"use client";\n\nimport { useEffect, …' to match /\{confirmando \? \(\s*<ConfirmacionFi…/` |
| M4 | R29 usa el mensaje de R30 | nueva | `expect(element).toHaveTextContent()` (2 casos) |
| M5 | se quita la comprobación `vuelveABodega` | nueva | `TestingLibraryElementError: Unable to find an accessible element with the role "alert"` (2 casos) |
| M6 | se quita la comprobación «ya confirmada» | nueva | `TestingLibraryElementError: Unable to find an accessible element with the role "alert"` |
| M7 | el bloqueo pasa a decir «No se puede aprobar todavía.» | nueva | `expect(element).toHaveTextContent()` |
| M8 | `confirmDisabled={false}` | nueva | `expect(element).toBeDisabled()` (3 casos) |
| M9 | no se pinta la línea de incidentes | nueva | `Unable to find an accessible element with the role "region" and name "Incidentes excluidos de la confirmación"` |
| M10 | cerrar el detalle no descarta `confirmadas` | nueva | `AssertionError: expected 'Paquetes confirmados: 1 de 2.' to be 'Paquetes confirmados: 0 de 2.'` |
| M11 | tras confirmar se aprueba directo, sin pasar por los montos | nueva | `Unable to find role="dialog" and name "Indemnizar los incidentes del cierre"` (2 casos) |
| M12 | todos los `fieldErrors` van al bolsón de montos | nueva | `AssertionError: expected null not to be null` (el `#confirmacion-g-rec-1-error` que no se pinta) |
| M13 | la fila pierde el estado pendiente/confirmada | nueva | `AssertionError: expected 'Nº Guía 7001 · REM-DEV-1DevueltaConfi…' to contain 'Pendiente'` (5 casos) |
| M14 | la cámara se parsea como si fuera tecleo | nueva | `expect(element).toHaveTextContent()` (3 casos) |
| M16 | el texto de «están todos» promete aprobar aunque queden montos | nueva | `FAIL … T4.6/R37 … primero la ventana, después el sub-modal de montos` |
| M15 | `confirmacionFisica` se manda también sin retornables | **158** | `AssertionError: expected "vi.fn()" to be called with arguments: [ { cierreId: 'c1', …(1) } ]` (3 casos) |

**sha256 (16 primeros dígitos), antes / mutado / después** — dos anclas, `CierresAdminModule.tsx`
= `6b684ae3190fffa6` y `cierre-confirmacion-fisica.tsx` = `806b15e84dc321ff`:

```
M1  6b684ae3190fffa6 -> 0a3e38d7fbcc22ae -> 6b684ae3190fffa6   restaurado
M2  6b684ae3190fffa6 -> 2f56c275f95a489f -> 6b684ae3190fffa6   restaurado
M3  6b684ae3190fffa6 -> 75a8dde7e1384d00 -> 6b684ae3190fffa6   restaurado
M4  806b15e84dc321ff -> 3f05fd6ff00e1d11 -> 806b15e84dc321ff   restaurado
M5  806b15e84dc321ff -> 1eccfe255b168d97 -> 806b15e84dc321ff   restaurado
M6  806b15e84dc321ff -> 54c5443fa15bf9b6 -> 806b15e84dc321ff   restaurado
M7  806b15e84dc321ff -> 9fcf3ff46e5082ad -> 806b15e84dc321ff   restaurado
M8  6b684ae3190fffa6 -> a863ad115772e1dc -> 6b684ae3190fffa6   restaurado
M9  806b15e84dc321ff -> d498e60302865d6e -> 806b15e84dc321ff   restaurado
M10 6b684ae3190fffa6 -> a61d865892aed08d -> 6b684ae3190fffa6   restaurado
M11 6b684ae3190fffa6 -> b6fee135a9075439 -> 6b684ae3190fffa6   restaurado
M12 6b684ae3190fffa6 -> aec217707cc5f172 -> 6b684ae3190fffa6   restaurado
M13 806b15e84dc321ff -> fb470374f0967d5c -> 806b15e84dc321ff   restaurado
M14 806b15e84dc321ff -> 7c4ccb34cc8916af -> 806b15e84dc321ff   restaurado
M16 806b15e84dc321ff -> 1c9be325001aaf35 -> 806b15e84dc321ff   restaurado
M15 6b684ae3190fffa6 -> 8ebb52793d2f71d5 -> 6b684ae3190fffa6   restaurado
```

### Los dos hallazgos de la tanda de mutaciones (esto es lo que importa)

**1. M3 SOBREVIVIÓ la primera vez: `exit=0`, `Tests 25 passed (25)`.** Montar la tarjeta de
escaneo **incondicionalmente** dejaba el test de R36 en verde. Motivo: `Modal` desmonta el portal
de Base UI al cerrarse, así que la cámara desaparecía del árbol **por el mecanismo de fuera**, no
por el ternario. Mi test estaba comprobando la primitiva, no mi código — que es exactamente el
riesgo contra el que el `design.md` §5.2 pedía el montaje condicional («así la propiedad no
depende del `keepMounted` interno»).

La propiedad se cumple hoy por **dos** mecanismos independientes y desde el árbol renderizado sólo
se ve el de fuera. Se añadió un caso que vigila el de dentro **leyendo la fuente**, que es lo que
este repo ya hace con el `satisfies` de `RETORNA_A_BODEGA` (`confirmacion-incidentes-excluidos`,
último caso): una red que no se ve en runtime se vigila donde se escribe. Con ese caso, M3 muere.
Si mañana el `Modal` gana una animación de salida o un `keepMounted`, el mecanismo de fuera
desaparece y **el de dentro sigue vigilado**.

**2. Un texto mentiroso que ninguna mutación habría encontrado, porque lo encontré leyéndolo.**
Al completar la confirmación de un cierre **con incidentes**, la barra decía «Están todos. Ya se
puede aprobar el cierre.» junto a un botón que dice **«Continuar»**. Falso: quedaba el paso de los
montos. Se partió en dos frases (`textoCompleta(hayIncidentes)`) y **después** se le puso su
mutación (M16), que ahora muere. Doce mil tests dan por buenos textos que un humano lee y ve
rotos en un segundo.

---

## Verificación — salida real

```
$ pnpm exec tsc --noEmit
(sin salida; TSC_EXIT=0)

$ pnpm exec eslint app/(app)/cierres-admin/_components/CierresAdminModule.tsx \
    app/(app)/cierres-admin/_components/cierre-confirmacion-fisica.tsx \
    tests/components/CierresAdminConfirmacionFisica.test.tsx
  68:10  warning  'money' is defined but never used  @typescript-eslint/no-unused-vars
✖ 1 problem (0 errors, 1 warning)
ESLINT_EXIT=0

$ pnpm exec vitest run tests/components/CierresAdminConfirmacionFisica.test.tsx
 Test Files  1 passed (1)
      Tests  26 passed (26)

$ pnpm exec vitest related --run \
    app/(app)/cierres-admin/_components/CierresAdminModule.tsx \
    app/(app)/cierres-admin/_components/cierre-confirmacion-fisica.tsx \
    lib/types/gestion-retorno.ts components/shared/EscanerGuiaCard.tsx lib/utils/paquete-url.ts
 Test Files  104 passed (104)
      Tests  1437 passed (1437)

$ pnpm exec vitest run tests/unit/guards/confirmacion-incidentes-excluidos.guardia.test.ts \
    tests/unit/guards/confirmacion-sin-lectores.guardia.test.ts \
    tests/unit/types/gestion-retorno.test.ts tests/components/EscanerModal.test.tsx \
    tests/components/QrScanner.test.tsx tests/components/RecogerPaqueteCard.test.tsx
 Test Files  6 passed (6)
      Tests  57 passed (57)
```

**El aviso de `eslint` es PREEXISTENTE y no es mío**: medido con la versión de `origin` del
archivo (`git stash`), el mismo aviso sale en la línea 54; mis importaciones lo desplazan a la 68.
`money` lo dejó sin consumidores la 230, al irse la tira de comprobantes.

**El gate (`./init.sh`) NO se corrió aquí**: lo corre el leader con el árbol quieto — el gate y un
subagente que muta el árbol no van en paralelo. **El servidor de dev no se tocó** (T5.6 es del
humano).

---

## Lo que queda abierto

1. **T5.6 — ver la app.** Es del humano y no se hizo desde aquí. Lo que conviene mirar con los
   ojos, porque ninguna suite lo mira: el sticky de la barra de estado **con catorce filas de
   verdad** (jsdom no tiene layout, así que `sticky` y `max-h-[45vh]` están sin medir), y la
   rejilla de dos columnas en el ancho real del modal (75 % de pantalla).
2. **Los seis mensajes del servidor se pintan tal cual en la fila.** Están con tildes (addenda del
   backend), así que la ventana los enseña bien; si alguno cambia, cambia lo que se ve, sin que
   nada avise. El caso de T4.7 usa el texto real de `MSG_CONFIRMACION_GUIA_DISTINTA` escrito a
   mano, así que un cambio de tipografía en el servicio **no** rompe este test — es intencionado:
   este archivo prueba dónde se pinta el error, no qué dice el servidor.
3. **`role="note"` para el motivo del bloqueo** se heredó del sub-modal de la 158 por consistencia.
   No es un rol de región viva; si algún día se quiere que un lector de pantalla anuncie el
   bloqueo al cambiar, hay que moverlo a `status` — y entonces hay que decidir lo mismo para la
   158, no sólo para esta.

---

# Addenda (2026-08-19) — la GUÍA REPETIDA: cierres que no se podían aprobar nunca

Encontrado **conduciendo la app** (T5.6), no por la suite. Sólo frontend: `lib/` sigue sin tocarse.

## El defecto

`interpretarLectura` resolvía la guía leída con `find`, que devuelve **siempre la primera** fila que
casa:

```ts
const gestion = gestionesDelCierre.find((g) => g.numGuia === numGuia);
```

Si el cierre trae **dos gestiones vivas de la misma orden** —y por tanto con la misma guía—, pasaba
esto:

1. Se escanea la guía → confirma la **primera** fila. Contador 1.
2. Se vuelve a escanear la misma guía → `find` devuelve **otra vez la primera**, que ya está
   confirmada → «Esa guía ya está confirmada. No se cuenta dos veces.»
3. La **segunda** fila se queda `Pendiente` **para siempre**: el contador clavado en `N-1 de N`, el
   botón apagado y **el cierre imposible de aprobar por ninguna vía**, sin un solo mensaje que lo
   explicara. Visto en pantalla: «Paquetes confirmados: **11 de 12**» con «Continuar» deshabilitado.

El mismo `find` mirado desde el otro lado tenía una segunda cara: si la primera fila que casa **no**
vuelve a bodega (una `entregada` que comparte guía con una `devuelta`), la lectura contestaba «ese
paquete no vuelve a bodega» y la `devuelta` quedaba igual de imposible.

**El servidor NO tiene este candado**, así que el arreglo es sólo del cliente:
`CierresAdminService.validarConfirmacionFisica` deduplica por `vistos.has(gestionId)` —**por
gestión, no por guía**— y R12 compara `esperada.numGuia !== numGuia` **contra la guía de CADA
gestión**, que se cumple para las dos. Dos entradas con la misma `numGuia` y distinto `gestionId`
son perfectamente válidas para el servicio.

## La medición de producción (2026-08-19, MCP, sólo lectura)

| medida | valor |
| --- | --- |
| pares (cierre, orden) con **más de una** gestión viva | **1** |
| de esos, con la gestión **que vuelve** repetida | **1** |
| universo de pares (cierre, orden) vivos | 48 |

**1 de 48**, y justo del tipo que dispara el bloqueo. Hoy no hace daño porque ese cierre ya está
aprobado; el siguiente que ocurra deja a bodega con un cierre que no puede cerrar.

## La decisión: una lectura confirma TODAS las filas pendientes de esa guía

Hay **un solo paquete físico**. Pedirle a bodega que escanee la misma caja dos veces es pedirle que
atestigüe dos veces un único acto, y encima sin decirle por qué la primera no bastó. Una lectura =
«tengo este paquete delante» = todas las filas de ese bulto quedan cubiertas.

**R32 sigue vivo y corregido, no ablandado:** el aviso «ya está confirmada» salta cuando esa guía
**ya no cubre nada** (todas sus filas confirmadas). Antes saltaba con una fila todavía pendiente, y
ahí era donde mentía.

**R31 se decide sobre el conjunto:** el aviso «ese paquete no vuelve a bodega» sale sólo si
**ninguna** de las filas de esa guía vuelve. Basta con que una vuelva para que haya un bulto delante
que confirmar.

El contrato `LecturaInterpretada` pasa de `{ gestionId }` a `{ gestionIds: readonly string[] }`, y
`CierresAdminModule.leerGuia` —su único consumidor— marca todas. `listaConfirmacionFisica()` no
cambia: sigue mandando **una entrada por gestión**, con la guía repetida, que es exactamente lo que
el servicio exige.

## El copy: qué se decidió y por qué

El contador decía **«Paquetes confirmados: X de N»** con `N` = **filas** (gestiones). En el cierre
medido eran **12 filas para 11 bultos**: **el rótulo ya mentía antes de este arreglo**. Y con el
arreglo, contar filas haría además que una sola lectura moviera el contador **de dos en dos**, que a
los ojos de quien está escaneando es un error de la app.

Se barajaron tres salidas: (a) que el rótulo deje de decir «paquetes»; (b) que la lista agrupe por
paquete; (c) dejarlo con una razón escrita.

**Se eligió que el contador cuente PAQUETES de verdad**, dejando el rótulo como está —porque el
rótulo no era el que estaba mal, era el número—:

- **`progresoDePaquetes`** agrupa las filas del conjunto esperado por bulto (`clavePaquete`) y cuenta
  bultos. Una guía repetida en dos filas cuenta **uno**. Así `textoProgreso` y `textoFaltan` dicen
  «paquetes» y son ciertos, y una lectura mueve el contador **exactamente uno**.
- **Sin guía, cada fila cuenta por su cuenta**: no hay forma de saber si dos filas sin guía son el
  mismo bulto, y colapsarlas rebajaría el número de paquetes que bodega tiene que poner delante —
  además esas filas no se pueden confirmar nunca (R13), así que el bloqueo tiene que seguir
  contándolas.
- **La lista NO cambia de forma** (R33 intacto: una fila por gestión, con sus cinco datos). Lo que
  gana es **una línea dentro de la fila** cuando ese bulto aparece más de una vez: «Este paquete
  aparece en N filas de esta lista: una sola lectura las confirma todas.» Sin ella, ver la misma
  guía dos veces y que las dos cambien de golpe se lee como un error de la app, o manda a bodega a
  buscar un segundo paquete que no existe. Va **sin `role`**: es contenido de la fila, y el
  `role="note"` de la barra de estado tiene que seguir siendo el del **bloqueo** (R27) o dejaría de
  poder señalarse.

**El candado no se ablanda.** Un paquete cuenta como hecho sólo si **todas** sus filas están
confirmadas, y una lectura confirma todas las pendientes de esa guía a la vez; por eso «faltan 0
paquetes» y «no queda ninguna fila pendiente» son la misma condición. `faltanPorConfirmar` (el que
apaga el botón) sale ahora del **mismo** cálculo que pinta la ventana, para que no haya dos cuentas
que puedan divergir.

## Los casos nuevos (`tests/components/CierresAdminConfirmacionFisica.test.tsx`, 26 → 31)

| Caso | Qué afirma |
| --- | --- |
| «las dos filas quedan confirmadas, el botón se habilita y el cierre se aprueba» | **Reproduce el bloqueo**: dos `devuelta` con la misma guía + un rechazo; una lectura confirma las dos filas, el contador va `0→1→2 de 2`, el botón se habilita y el payload lleva **una entrada por gestión** con la guía repetida. |
| «R32 SIGUE VIVO: con las dos filas ya confirmadas, otra lectura avisa y no cuenta de más» | El aviso literal, el contador que no avanza y el botón que sigue apagado. |
| «una `entregada` que comparte guía con una `devuelta` no roba la lectura» | La otra cara del `find`: la `devuelta` se confirma y NO sale el mensaje de R31. |
| «dos filas de la misma guía son UN bulto, y la fila lo explica» | El contador en paquetes (`0 de 2` con 3 filas), «Faltan 2 paquetes…», las tres filas presentes y la línea de bulto compartido en las dos filas y **no** en la tercera. |
| «dos filas SIN guía no se funden en un bulto» | `0 de 3` con una guía + dos filas sin guía; tras confirmar la única guía, `1 de 3` y el botón apagado. |

Los textos esperados siguen escritos **a mano**, no importados de quien los produce.

Ningún test existente se tocó: los 26 anteriores no tienen guías repetidas, así que sus números no
cambian. El literal del payload de T4.4/T4.6 **es** el contrato con el servidor y se dejó intacto.

## Mutaciones — una a una, `vitest` corrido, salida real

Base: `cierre-confirmacion-fisica.tsx` `sha256 f03e14a4c210e63a…`, `CierresAdminModule.tsx`
`sha256 8e1f0e7815d4d305…`. Tras **cada** mutación el archivo se restauró de una copia pristina y se
volvió a medir el sha (columna «después»).

| # | Mutación | sha mutado | Resultado |
| --- | --- | --- | --- |
| M1 | **el `find` de hoy restaurado** (una gestión por lectura) | `1bc32f86d06c06c0…` | **3 rojos** |
| M2 | el aviso de R32 desactivado (`pendientes.length === 0 && false`) | `886e3bbb033a1625…` | **2 rojos** |
| M3 | `clavePaquete` sin guía colapsa (`guia:null` para todas) | `caf0f0c1d17a5f4c…` | **1 rojo** |
| M4 | el progreso cuenta **filas** en vez de bultos | `48bcd8399abfb8e1…` | **3 rojos** |
| M5 | la línea de bulto compartido nunca se pinta (`{false ? (`) | `45fb0ea5cf673d59…` | **1 rojo** |
| M6 | R31 decidido sólo por la **primera** fila (`conEsaGuia.slice(0, 1)`) | `8b2fa52a5268dc78…` | **3 rojos** |
| M7 | el **módulo** marca sólo el primer id (`lectura.gestionIds.slice(0, 1)`) | `e5f176085e041741…` | **2 rojos** |
| M8 | `filas.every(...)` → `filas.some(...)` en «bulto hecho» | `dc7f1a268373cd83…` | **SUPERVIVIENTE** (equivalente, ver abajo) |

Sha «después» de las ocho: `f03e14a4c210e63a…` / `8e1f0e7815d4d305…` (los de base).

Después de la tanda de mutaciones, `cierre-confirmacion-fisica.tsx` recibió **una edición de sólo
comentario** (dos bloques `{/* … */}` de la fila fundidos en uno), y por eso el sha final es
`3e7cc03697deea77…` y no el de base. Ni una línea de código cambió; `tsc --noEmit` y los 31 casos
se volvieron a correr después, en verde.

**M1 — el `find` de hoy** (`Tests 3 failed | 28 passed (31)`):

```
× las dos filas quedan confirmadas, el botón se habilita y el cierre se aprueba
× R32 SIGUE VIVO: con las dos filas ya confirmadas, otra lectura avisa y no cuenta de más
× una `entregada` que comparte guía con una `devuelta` no roba la lectura (R31 sigue siendo suyo)
AssertionError: expected 'Nº Guía 7010 · REM-DUPDevueltaPendien…' to contain 'Confirmada'
AssertionError: expected 'Paquetes confirmados: 0 de 2.' to be 'Paquetes confirmados: 1 de 2.'
AssertionError: expected 'Nº Guía 7020 · REM-MIXDevueltaPendien…' to contain 'Confirmada'
```

**M2 — R32 desactivado** (`Tests 2 failed | 29 passed (31)`). Cae también el caso T4.3/R32 que ya
existía, así que el aviso viejo sigue protegido:

```
× lo dice y NO la cuenta dos veces
× R32 SIGUE VIVO: con las dos filas ya confirmadas, otra lectura avisa y no cuenta de más
TestingLibraryElementError: Unable to find an accessible element with the role "alert"
```

**M3 — las filas sin guía colapsadas** (`Tests 1 failed | 30 passed (31)`):

```
× dos filas SIN guía no se funden en un bulto: cada una cuenta, y siguen bloqueando
AssertionError: expected 'Paquetes confirmados: 0 de 2.' to be 'Paquetes confirmados: 0 de 3.'
```

**M4 — contar filas en vez de bultos** (`Tests 3 failed | 28 passed (31)`). El segundo rojo es
literalmente el síntoma que se quería evitar, el contador moviéndose de dos en dos:

```
× las dos filas quedan confirmadas, el botón se habilita y el cierre se aprueba
× R32 SIGUE VIVO: con las dos filas ya confirmadas, otra lectura avisa y no cuenta de más
× dos filas de la misma guía son UN bulto, y la fila lo explica
AssertionError: expected 'Paquetes confirmados: 0 de 3.' to be 'Paquetes confirmados: 0 de 2.'
AssertionError: expected 'Paquetes confirmados: 2 de 3.' to be 'Paquetes confirmados: 1 de 2.'
```

**M5 — la línea de bulto compartido callada** (`Tests 1 failed | 30 passed (31)`):

```
× dos filas de la misma guía son UN bulto, y la fila lo explica
AssertionError: expected 'Nº Guía 7010 · REM-DUPDevueltaPendien…' to contain 'Este paquete aparece en 2 filas de es…'
Received: "Nº Guía 7010 · REM-DUPDevueltaPendienteDora Quesada · Tienda X"
```

**M6 — R31 por la primera fila** (`Tests 3 failed | 28 passed (31)`):

```
× las dos filas quedan confirmadas, el botón se habilita y el cierre se aprueba
× R32 SIGUE VIVO: con las dos filas ya confirmadas, otra lectura avisa y no cuenta de más
× una `entregada` que comparte guía con una `devuelta` no roba la lectura (R31 sigue siendo suyo)
AssertionError: expected 'Nº Guía 7020 · REM-MIXDevueltaPendien…' to contain 'Confirmada'
```

**M7 — el módulo marca sólo el primer id** (`Tests 2 failed | 29 passed (31)`). Es el que prueba que
la cobertura no se queda en la función pura, sino que llega al estado de la pantalla:

```
× las dos filas quedan confirmadas, el botón se habilita y el cierre se aprueba
× R32 SIGUE VIVO: con las dos filas ya confirmadas, otra lectura avisa y no cuenta de más
AssertionError: expected 'Paquetes confirmados: 0 de 2.' to be 'Paquetes confirmados: 1 de 2.'
```

**M8 — `every` → `some`: SUPERVIVIENTE, y se declara.** `Tests 31 passed (31)`, corrido y leído. Es
un **mutante equivalente** hoy: una lectura confirma **todas** las filas pendientes de ese bulto a
la vez, así que un paquete nunca está a medias y «alguna fila confirmada» y «todas confirmadas»
valen lo mismo. Se deja `every` porque es el que sigue siendo correcto si mañana aparece una vía de
confirmar fila a fila (un botón por fila, una confirmación parcial persistida); con `some`, esa vía
daría un paquete por hecho con una fila pendiente y **desbloquearía el botón**. No hay test que lo
distinga porque hoy no hay forma de llegar a ese estado desde la UI.

## Verificación — salida real

```
$ pnpm exec tsc --noEmit
(sin salida; TSC_EXIT=0)

$ pnpm exec eslint app/(app)/cierres-admin/_components/CierresAdminModule.tsx \
    app/(app)/cierres-admin/_components/cierre-confirmacion-fisica.tsx \
    tests/components/CierresAdminConfirmacionFisica.test.tsx
  69:10  warning  'money' is defined but never used  @typescript-eslint/no-unused-vars
✖ 1 problem (0 errors, 1 warning)
ESLINT_EXIT=0

$ pnpm exec vitest run tests/components/CierresAdminConfirmacionFisica.test.tsx
 Test Files  1 passed (1)
      Tests  31 passed (31)

$ pnpm exec vitest related --run \
    app/(app)/cierres-admin/_components/CierresAdminModule.tsx \
    app/(app)/cierres-admin/_components/cierre-confirmacion-fisica.tsx
 Test Files  12 passed (12)
      Tests  215 passed (215)

$ pnpm exec vitest run tests/unit/guards/confirmacion-incidentes-excluidos.guardia.test.ts \
    tests/unit/guards/confirmacion-sin-lectores.guardia.test.ts tests/unit/types/gestion-retorno.test.ts
 Test Files  3 passed (3)
      Tests  23 passed (23)
```

El aviso de `eslint` es el **preexistente** (`money`, sin consumidores desde la 230); antes estaba en
la línea 68 y ahora en la 69 porque el `import` de `progresoDePaquetes` lo desplaza una línea.

**Sin commit.** El gate (`./init.sh`) no se corrió desde aquí: lo corre el leader con el árbol
quieto. **El servidor de dev de `localhost:3000` no se tocó**: el recorrido lo repite el humano.

## Lo que esta addenda deja abierto

1. **`design.md` §5.3 sigue describiendo la resolución como «casa UNA gestión»** (la tabla de los
   cuatro desenlaces). El comportamiento ya no es ése: una lectura puede casar varias filas del
   mismo bulto. No se editó el spec desde aquí —es de otro rol—, pero la tabla está desalineada con
   el código y conviene arreglarla antes de cerrar la ficha.
2. **Que dos gestiones vivas de la misma orden convivan en un cierre es un dato del backend**, no de
   esta pantalla. El cliente lo trata bien; queda sin responder si esa duplicidad *debería* existir
   (1 de 48 pares medidos). Si algún día se elimina en origen, este arreglo pasa a ser una red que
   no se dispara — que es como debe quedar.

---

# Addenda 2 — acabado de la revisión: m4 y m7 (2026-08-19)

Dos hallazgos **menores** de `progress/review_238.md`, sobre `0a0df331`. El veredicto ya era **OK**:
esto no cambia comportamiento. **Sin commit.** Sólo dos archivos, los dos de la capa de
presentación; `lib/`, los tests de backend y el servidor de dev de `localhost:3000` no se tocaron.

## m4 — la premisa que sostiene el arreglo, escrita donde se toma la decisión

`app/(app)/cierres-admin/_components/cierre-confirmacion-fisica.tsx`, en **los dos** sitios donde la
decisión se toma:

- **`interpretarLectura`** — un bloque marcado ⚠️ **PREMISA**: «una lectura confirma todas las filas
  de esa guía» es correcto *porque* `orden.numGuia` es `@unique` (`db/schema.prisma`, modelo
  `Orden`). Una guía identifica UNA orden; una orden es UN paquete físico. Se nombra explícitamente
  qué pasa si esa unicidad cae: **deja de ser una corrección y pasa a ser un agujero** —una lectura
  daría por confirmados paquetes distintos y bodega firmaría tener delante algo que no tiene— y que
  **nada del código lo avisaría**.
- **`clavePaquete`** — el mismo agujero por el otro lado: sin unicidad, `guia:<numGuia>` fundiría
  bultos distintos en una entrada del contador y el total saldría **corto**, o sea bodega pondría
  delante menos paquetes de los que debe.

Los dos comentarios apuntan al caso que vigila la premisa, para que no se quede en prosa.

## m4 (segunda mitad) — la guardia: **sí**, y por qué

La revisión la dejaba a criterio. Se hizo, y con argumentos medidos, no por precaución:

1. **El patrón ya existe en este repo**, dos veces y una de ellas *en este mismo archivo de test*:
   el caso del montaje condicional de la cámara lee `CierresAdminModule.tsx` con `readFileSync`; y
   `tests/unit/guards/rastreo-sin-ruta-nueva.guardia.test.ts:215` lee `db/schema.prisma` y fija
   **este mismo** `@unique`. No hay nada que improvisar: se imita.
2. **No se delega en la de la 229.** Fija lo mismo, pero por un motivo suyo (su R34, «esta feature
   no necesita migración») y **vive dentro de esa feature**: el día que la 229 se retire o se
   reescriba, el pin se va con ella y la 238 se queda sin red sin que nadie lo note. Es exactamente
   la lección de «el test que vive dentro de lo que borras», ya pagada aquí con una regresión en
   producción.
3. **El coste es un `it` de nueve líneas**, no un archivo de guardia nuevo. Desproporcionado habría
   sido montar un censo; esto es una aserción.

Vive en `tests/components/CierresAdminConfirmacionFisica.test.tsx`, en un `describe("PREMISA — …")`
al final, junto al bloque de la guía repetida que es lo que protege. Se acota al bloque
`model Orden { … }` **a propósito**: hay un segundo `numGuia` en el esquema que es una copia y
**no** lleva `@unique` (ni debe), y un barrido del archivo entero los confundiría. La extracción se
comprueba a sí misma (`@@map("orden")`), para que un renombrado del modelo no la deje muda.

## m7 — el texto visible que no tenía aserción

`CONFIRMACION_DETALLE` ya tiene su caso, con el **literal escrito a mano** (con tildes) y **sin
importar la constante**: compararlo contra la fuente que lo produce está siempre verde. El caso
afirma además que ese texto es la **descripción accesible** del diálogo (`aria-describedby`), no un
párrafo cualquiera: si mañana se mudara al cuerpo seguiría viéndose, pero dejaría de anunciarse a
quien no ve, y ésa es una regresión muda.

**El barrido encontró más, y también se cubrieron.** La revisión decía «el único string sin
literal»; no lo era. Los cuatro textos con los que esta feature configura `EscanerGuiaCard` —el
nombre accesible de la tarjeta, su título, su descripción y la etiqueta del botón— tampoco tenían
aserción, y son tan visibles como el resto. Tienen ya un caso propio, que además comprueba que el
acierto **nombra la guía** (`Guía 7001 confirmada.`) y no dice sólo «confirmada».

**Lo que queda sin literal, y por qué:** `ESCANER_ERROR_CAMARA` («No se pudo abrir la cámara.»). Sólo
aparece si `Html5Qrcode.start` **rechaza**, y el doble de este archivo resuelve siempre; forzarlo
pide reprogramar el doble para todo el archivo. Queda anotado, no tapado.

**Fuera del alcance de la 238 — confirmado que sigue igual:** `MSG_INDEMNIZACION_AJENA` («Este monto
no corresponde a un incidente de este cierre.») y `MSG_INDEMNIZACION_DUPLICADA` («Hay dos montos
para el mismo incidente.»), los dos de la **158**, siguen **sin literal en ningún test** (grep sobre
`tests/`: cero). Esta ficha no los tocó; no es regresión suya y no se arreglan desde aquí.

## Que mueren: medido, no supuesto

Tres mutaciones, **una a la vez**, cada una aplicada con un script escrito **a archivo** (nunca
`node -e`) con guardia de coincidencia única, restaurada y verificada por `sha256` antes de la
siguiente. Los scripts se borraron al terminar.

**Mutación A — el texto de `CONFIRMACION_DETALLE` sin tildes** (`cierre-confirmacion-fisica.tsx`):

| | sha256 |
| --- | --- |
| antes | `a727045340ce1025cdb6324e368b971400ade8b31e04458f411d01f1878dc185` |
| mutado | `a1d1c93ef5a88415b7d885dc8b4890e63f259c68d843b86251ff9d4901b629bc` |
| después | `a727045340ce1025cdb6324e368b971400ade8b31e04458f411d01f1878dc185` |

```
 × la ventana explica CON PALABRAS qué hay que hacer antes de aprobar 170ms
 FAIL  tests/components/CierresAdminConfirmacionFisica.test.tsx
TestingLibraryElementError: Unable to find an element with the text: Antes de aprobar, tené
delante cada paquete que vuelve a bodega y confirmá su guía: escaneá el código o escribí el número.
 Tests  1 failed | 32 passed (33)
```

**Mutación B — quitar el `@unique` de `numGuia`** (`db/schema.prisma`, restaurado):

| | sha256 |
| --- | --- |
| antes | `d34dfd09057f3a412656b1a588ba3155f0d13e7f0cd3e08c0328018b13b5893d` |
| mutado | `75c7720d736ac88f63354db137a3b12e47565dcc2c57a88f1ac8f713d788de1b` |
| después | `d34dfd09057f3a412656b1a588ba3155f0d13e7f0cd3e08c0328018b13b5893d` |

```
 × `db/schema.prisma` declara `numGuia` como `@unique` en el modelo `Orden` 6ms
AssertionError: expected '\n  id                     String    …' to match /numGuia\s+Int\?\s+@unique\s+@map\("nu…/
 Tests  1 failed | 32 passed (33)
```

Y el rojo **fue exactamente uno**: los otros 32 casos siguieron verdes con la unicidad caída. Ésa es
la medición que justifica el hallazgo entero — la premisa es invisible al comportamiento, y sin esta
aserción nadie se enteraría.

**Mutación C — `ESCANER_DESCRIPCION` sin tildes** (`cierre-confirmacion-fisica.tsx`):

| | sha256 |
| --- | --- |
| antes | `a727045340ce1025cdb6324e368b971400ade8b31e04458f411d01f1878dc185` |
| mutado | `30a6ec4a7b5a0fbdc5883996a9b31db0448e23db820357916a3049bee9bb754d` |
| después | `a727045340ce1025cdb6324e368b971400ade8b31e04458f411d01f1878dc185` |

```
 × la tarjeta de captura se presenta con SUS textos, y el acierto nombra la guía 190ms
 FAIL  … > T4.2 — la ventana dice, con palabras, qué acto físico se está pidiendo
Expected element to have text content: …
 Tests  1 failed | 33 passed (34)
```

## Verificación, con el árbol restaurado

```
$ pnpm run typecheck
> tsc --noEmit
(sin salida)

$ pnpm exec eslint app/(app)/cierres-admin/_components/cierre-confirmacion-fisica.tsx \
    tests/components/CierresAdminConfirmacionFisica.test.tsx
LINT_EXIT=0   (0 errores, 0 avisos)

$ pnpm exec vitest run tests/components/CierresAdminConfirmacionFisica.test.tsx
 Test Files  1 passed (1)
      Tests  34 passed (34)          <- 31 antes + 3 casos nuevos

$ pnpm exec vitest run tests/components/CierresAdmin
 Test Files  7 passed (7)
      Tests  158 passed (158)        <- 157 antes de esta addenda
```

`sha256` final de los archivos tocados y del esquema (para probar que quedó como estaba):

| archivo | sha256 |
| --- | --- |
| `cierre-confirmacion-fisica.tsx` | `a727045340ce1025cdb6324e368b971400ade8b31e04458f411d01f1878dc185` |
| `CierresAdminConfirmacionFisica.test.tsx` | `181b76891aa0ccb7fb43ed1dcfa6c52a64f17255b9f46d93c57194fbcc7f4b1b` |
| `db/schema.prisma` | `d34dfd09057f3a412656b1a588ba3155f0d13e7f0cd3e08c0328018b13b5893d` (= original) |

El gate (`./init.sh`) **no** se corrió desde aquí: lo corre el humano con el árbol quieto. Los otros
menores de la revisión (m1, m2, m3, m5, m6, m8) son de spec/documentación y **no** son de este rol.
