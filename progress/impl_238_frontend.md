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
