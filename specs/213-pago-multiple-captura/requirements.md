# 213 — Pago múltiple por entrega (captura y presentación) — Requisitos

> Zona `frontend` · complexity `medium` · rama `feature/213-pago-multiple-captura`
> (de `origin/dev`, `bb4c3185`) · worktree `C:/w213b`.
> Mitad FRONTEND de la partición 212/213/214. Depende de la **212** (backend), ya mergeada en `dev`.

## Equivalencia de ids (leer antes que nada)

Todo el texto anterior al 2026-08-13 usa la numeración vieja. **Donde diga 208, leer 212**
(backend, ya en `dev`); **donde diga 209, leer 213** (esta ficha); **donde diga 210, leer 214**
(retirar la forma escalar). Los ids 208/209/210 que existen hoy en `dev` son features AJENAS sin
relación con el recaudo.

## Contexto mínimo verificado (no re-descubrir)

La 212 dejó el backend listo y esta ficha **solo consume** ese contrato. Verificado archivo por
archivo en este worktree el 2026-08-13:

| Hecho | Dónde |
| --- | --- |
| El borde acepta el desglose PURO (sin escalar): `pagos` presente + `metodoPago` ausente es válido | `lib/types/gestion-orden.ts:239-302` (`validarRecaudoEntrega`, reglas 1-5) |
| «Sin cobro» YA es válido con CERO líneas y sin escalar: con `montoRecibido === 0` la regla 3 no dispara y la 4 solo castiga un desglose NO vacío | `lib/types/gestion-orden.ts:272-290` |
| El desglose viaja por `FormData` como campos REPETIDOS `pagoMetodo` / `pagoMonto`, emparejados por índice; si no viene ninguno la clave `pagos` no se crea | `lib/actions/mis-asignaciones.ts:222-233` |
| El util PURO de la suma (céntimos enteros, sin `@prisma/client`) es **`lib/utils/pagos-recaudo.ts`** (`aCentimos`, `sumaCuadra`, `normalizarPagos`) | `lib/utils/pagos-recaudo.ts:24-59` |
| **`lib/utils/lineas-pago.ts` NO sirve en el cliente**: importa `Prisma` y `MetodoPagoValue` de `@prisma/client`. Es el serializador de las proyecciones, no el util del borde | `lib/utils/lineas-pago.ts:1` |
| El DTO que consume la presentación ya trae `pagos: { metodo, monto }[]` money-safe STRING, en orden de enum, y CONSERVA `metodoPago` | `lib/interfaces/services/ICierreDiaService.ts:39-47` |
| `SelectOption` ya admite `disabled` por opción | `components/ui/select.tsx:9-15`, `:93` |

**Los números de línea de la ficha habían corrido con el merge de la 212. Los reales son:**

| Sitio | Ficha decía | Real hoy |
| --- | --- | --- |
| `CierreDiaModule.tsx` (celda «Método») | :887 | **:883-887** (render en `:886`) |
| `cierre-detalle-shared.tsx` (celda «Método») | :888 | **:895-899** (render en `:898`) |
| `cierre-factura.tsx` (fila «Recibido · método») | :894 | **:953-962** (render en `:959`) |
| `cierre-dia-descarga-columnas.ts` (celda `metodo`) | :101 | **:101** (sin cambio) |
| `cierre-gestiones-descarga-columnas.ts` (celda `metodo`) | :115 | **:115** (sin cambio) |
| `GestionarOrdenPanel.tsx` (`<Select>` único) | :717-733 | **:717-733** (sin cambio); estado en `:260`, envío en `:342` y `:396`, «sin cobro» en `:330-331` |

**Decisiones ya tomadas en las puertas humanas del 2026-08-12 — no se reabren aquí:**

- **[D1]** Alcance = SOLO el recaudo al cliente en la entrega. `LiquidacionPago` (172) no se toca.
- **[D2]** Un método aparece como mucho UNA vez por gestión (`@@unique([gestion_id, metodo])`).
- **[D3]** La línea lleva método y monto y NADA más. Sin número de referencia.
- **[D4]** Descargas: los métodos se concatenan en la **celda escalar existente**. NO se abre una
  columna por método NI se multiplica la fila.
- **[Q2 de la 212]** El PANEL filtra sus filas vacías antes de enviar. El borde rechaza todo monto
  no positivo; una fila en blanco que llegue al servidor es un error de validación.
- **[Q3 de la 212]** Esta ficha **NO retira nada**: ni la forma escalar del borde, ni la columna
  `metodo_pago`, ni el campo escalar del DTO. Eso es la ficha **214**.

---

## A. Captura: el editor de líneas del panel del mensajero

**R1.** MIENTRAS el resultado elegido sea `entregada` y la orden tenga monto a cobrar mayor que
cero, el panel DEBE presentar un EDITOR DE LÍNEAS de pago —cada línea con un selector de método y
un campo de monto— en lugar del selector único de método de pago.

**R2.** CUANDO se entra al formulario de `entregada` de una orden con cobro, el editor DEBE
arrancar con EXACTAMENTE UNA línea, sin método elegido y con el monto pre-cargado con el monto a
cobrar de la orden, de modo que un cobro de un solo método siga costando un solo gesto.

**R3.** El editor NO DEBE permitir más líneas que métodos de pago existentes en el catálogo, y el
control de «añadir línea» DEBE dejar de ofrecerse cuando todos los métodos están ya usados.

**R4.** CUANDO se añade una línea, su monto DEBE pre-cargarse con la diferencia pendiente entre el
monto a cobrar y lo ya capturado en las demás líneas, y `0` si no queda diferencia.

**R5.** [D2] MIENTRAS un método esté elegido en una línea, el sistema NO DEBE permitir elegirlo en
otra línea de la misma gestión: esa opción se ofrece DESHABILITADA en los demás selectores.

**R6.** El editor DEBE permitir eliminar cualquier línea mientras quede al menos una, y al
eliminarla el método que usaba DEBE volver a estar disponible en las demás líneas.

**R7.** [D3] La línea del editor DEBE contener exclusivamente el método y el monto. El sistema NO
DEBE ofrecer campo de referencia, de nota ni ningún otro dato en la línea.

**R8.** MIENTRAS el editor esté visible, el panel DEBE mostrar de forma continua el monto a cobrar,
la suma capturada y la diferencia entre ambos, con la moneda de configuración (nunca un símbolo
incrustado en el código).

**R9.** SI la suma de las líneas no iguala EXACTAMENTE el monto a cobrar, ENTONCES el panel DEBE
mostrar el error en pantalla ANTES de enviar y NO DEBE invocar la Server Action.

**R10.** CUANDO cambia el resultado elegido, el sistema DEBE descartar las líneas capturadas y sus
errores, igual que hoy descarta el método, la causa y las fotos.

**R11.** El sistema DEBE calcular la suma y la diferencia en CÉNTIMOS ENTEROS, reusando el util
puro de la 212 (`lib/utils/pagos-recaudo.ts`), y NO DEBE usar suma de coma flotante, `parseFloat`
ni `Number` sobre montos fuera de la conversión de entrada del propio campo.

---

## B. Envío: qué sale del panel

**R12.** [Q2] CUANDO el mensajero confirma la gestión, el panel DEBE descartar del envío las líneas
COMPLETAMENTE vacías (sin método y sin monto), de modo que ninguna llegue al borde.

**R13.** SI una línea tiene método pero no un monto estrictamente positivo, o tiene monto pero no
método, ENTONCES el panel DEBE señalar el error EN ESA LÍNEA y NO DEBE enviar la gestión: una línea
a medias no se descarta en silencio, porque descartarla cambiaría el dinero sin decirlo.

**R14.** SI, tras descartar las líneas vacías, no queda ninguna línea y el monto a cobrar es mayor
que cero, ENTONCES el panel DEBE mostrar «método de pago requerido» y NO DEBE enviar la gestión.

**R15.** CUANDO la gestión es una entrega CON cobro, el panel DEBE enviar el desglose como pares
repetidos `pagoMetodo` / `pagoMonto` del `FormData`, emparejados por índice y en el orden en que se
capturaron, y NO DEBE enviar el campo escalar `metodoPago`.

**R16.** MIENTRAS la orden NO tenga monto a cobrar (orden sin cobro), el panel NO DEBE mostrar el
editor, NO DEBE enviar ninguna línea y NO DEBE enviar el método escalar `"efectivo"` que hoy fuerza
`GestionarOrdenPanel.tsx:331`: una entrega sin cobro son CERO líneas.

**R17.** ANTES de enviar, el panel DEBE validar el objeto crudo con el MISMO `gestionarSchema` del
borde y, si falla, DEBE pintar los errores por campo sin invocar la Server Action.

**R18.** CUANDO el servidor devuelve un `validation_error` con errores en el campo `pagos`, el
panel DEBE mostrarlos asociados al editor de líneas, no perderlos en silencio.

**R19.** El panel y todo módulo que él importe NO DEBEN importar `@prisma/client` **como VALOR**, ni
importar `lib/utils/lineas-pago.ts` de ninguna forma: el bundle del navegador no puede arrastrar
runtime de servidor. Un `import type` de `@prisma/client` SÍ está permitido.

> **R19 se relajó durante la implementación, tras medir (2026-08-13).** La redacción original
> prohibía `@prisma/client` a secas, y su motivo —«no arrastrar runtime al bundle»— no encajaba con
> la regla: un `import type` se borra al compilar, no emite `require` y no entra en el grafo del
> bundler. Medido, el árbol transitivo del panel (87 archivos) tiene **14 `import type` vivos** de
> `@prisma/client`, entre ellos `cierre-labels.ts`, por donde pasa el `METODO_LABEL` que R25 exige
> como fuente única de etiquetas: cumplir la letra original obligaría a duplicar los enums en el
> cliente, que es la forma segura de que un día dejen de coincidir con la base.
> `lib/utils/lineas-pago.ts` sigue prohibido **por su rol** —serializador de las proyecciones
> Prisma—, no por arrastrar runtime: medido, sus imports de Prisma también son de tipo. La guardia
> verifica exactamente esta regla y es MÁS estricta que el texto original en todo lo demás (árbol
> transitivo entero, cero especificadores sin resolver, corte solo en `"use server"` bajo
> `lib/actions/`, control de no-vacuidad). Aceptado por el reviewer, §5.1 de
> `progress/review_213.md`.

---

## C. Presentación por gestión

**R20.** CUANDO una gestión `entregada` tiene EXACTAMENTE UNA línea de pago, los tres sitios de
presentación DEBEN mostrar la etiqueta legible de ese método, idéntica a la que muestran hoy.

**R21.** CUANDO una gestión `entregada` tiene DOS O MÁS líneas de pago, los tres sitios DEBEN
mostrar TODOS los métodos, cada uno con su monto formateado con la moneda de configuración.

**R22.** SI una gestión no tiene ninguna línea de pago, ENTONCES los tres sitios DEBEN mostrar el
mismo marcador de ausencia que hoy (`—`), sin texto nuevo y sin caer en blanco.

**R23.** Los tres sitios —`CierreDiaModule.tsx`, `cierre-detalle-shared.tsx` y
`cierre-factura.tsx`— DEBEN derivar lo que pintan del DESGLOSE del DTO y NO de `metodoPago`.

**R24.** El sistema DEBE respetar el orden en que el DTO entrega las líneas (orden de declaración
del enum: `efectivo`, `SINPE`, `transferencia`) y NO DEBE reordenarlas en la presentación.

**R25.** Las etiquetas de método DEBEN salir de `METODO_LABEL`, nunca de una cadena duplicada ni
del valor crudo del enum.

---

## D. Descargas [D4]

**R26.** El sistema NO DEBE alterar el CENSO ni el ORDEN de las columnas de las dos descargas
afectadas: el desglose va en la celda escalar `metodo` ya existente, sin columna nueva.

**R27.** El sistema NO DEBE multiplicar las filas del archivo: una gestión sigue produciendo
EXACTAMENTE una fila, tenga las líneas de pago que tenga.

**R28.** CUANDO una gestión `entregada` tiene DOS O MÁS líneas, la celda `metodo` DEBE contener las
líneas concatenadas en una sola celda, cada una como etiqueta legible y monto, separadas por un
único separador, y en el orden del DTO.

**R29.** CUANDO una gestión tiene EXACTAMENTE UNA línea, la celda `metodo` DEBE contener solo la
etiqueta legible de ese método, exactamente igual que hoy (el importe ya viaja en la columna
contigua «Monto» / «Recibido»).

**R30.** SI una gestión no tiene líneas de pago, ENTONCES la celda `metodo` DEBE quedar VACÍA
(`null`), igual que hoy, y NO DEBE emitirse el `—` de presentación.

**R31.** Los montos que se concatenen DEBEN ser el STRING money-safe del servidor tal cual: el
sistema NO DEBE usar `parseFloat`, `Number`, `toFixed` ni un símbolo de moneda incrustado en el
código dentro de los módulos de descarga.

---

## E. Fronteras que NO se mueven

**R32.** [Q3] El sistema NO DEBE retirar la forma escalar del borde de escritura, la columna
`gestion_orden.metodo_pago` ni el campo `metodoPago` del DTO: los tres siguen existiendo y siguen
siendo válidos después de esta feature (su retiro es la ficha 214).

**R33.** Al ser una feature de zona `frontend`, el sistema NO DEBE añadir ni modificar migraciones,
`db/schema.prisma`, políticas RLS, repositorios ni servicios.

**R34.** El sistema NO DEBE modificar el comportamiento ni las fuentes de `CajaCodFeedService`,
`WalletTiendaFeedService`, `RecaudoAnaliticaRepository`, `AnaliticaFinancieraService`,
`descripcion-pago.ts` ni ningún camino de `LiquidacionPago` (172), verificados inmunes por diseño
en el censo de la 212 [D1].

> **EXCEPCIÓN ACOTADA A R34, autorizada por el humano el 2026-08-13.** Se permite corregir **un
> comentario** de `lib/utils/descripcion-pago.ts` —y nada más de ese archivo: la prohibición sigue
> viva para su lógica, sus fuentes y su comportamiento—.
>
> **De dónde sale.** Otra sesión había traspasado esta misma ficha con un segundo spec en `dev`
> (`specs/213-pago-multiple-presentacion/`, 23 requisitos, puerta sin pasar, cero código). El humano
> decidió que gana este spec y retiró el rival, pero al compararlos requisito a requisito **su R20
> marcaba un hueco real del nuestro**: corregir los comentarios que atribuyen mal el retiro de la
> forma escalar. Se adoptó.
>
> **Por qué hacía falta la excepción.** El comentario citaba
> `app/(app)/mis-asignaciones/_components/metodo-pago-options.ts`, módulo que **esta misma ficha
> borró** al quedar huérfano (§8.1 de `progress/impl_213.md`). Es decir: la referencia muerta la
> creamos nosotros, y R34 nos impedía limpiarla. El reviewer lo marcó como menor 6 y el implementer
> hizo bien en no tocarlo sin permiso; el permiso es esto. Un requisito que se incumple sin registro
> es peor que uno que se relaja a la vista.

**R35.** El sistema NO DEBE cambiar la forma ni el cálculo de los totales del cierre
(`total_efectivo` / `total_simpe` / `total_transferencia`): esta feature captura y presenta, no
recalcula. La `E` del `min(P, E)` del pago al mensajero (feature 44) se ve afectada SOLO por lo que
el mensajero capture, y por eso la captura tiene tests de descuadre y no solo de camino feliz.

---

## Trazabilidad `R<n> → test`

Archivos nuevos marcados **(nuevo)**; el resto se amplían sin relajar ninguna aserción previa.

| R | Test concreto | Qué afirma |
| --- | --- | --- |
| R1 | `tests/components/GestionarOrdenPanelPagos.test.tsx` **(nuevo)** :: «con cobro, la rama entregada monta el editor de líneas y ya no el selector único» | hay `n` combobox «Método de pago línea 1…» y NO existe el control único anterior |
| R2 | idem :: «arranca con UNA línea, sin método y con el monto a cobrar pre-cargado» | 1 línea; `value` del monto = `montoCobrar`; método vacío |
| R3 | idem :: «no se pueden añadir más líneas que métodos» + `tests/unit/utils/desglose-captura.test.ts` **(nuevo)** :: «`puedeAnadirLinea` es falso con 3 líneas» | tras 3 líneas el botón «Añadir método» desaparece |
| R4 | `desglose-captura.test.ts` :: «el monto de la línea nueva es la diferencia pendiente, nunca negativa» + componente :: «añadir línea con 5.000 de 8.000 pre-carga 3.000» | pendiente = total − suma; 0 si ya cuadra |
| R5 | componente :: «el método ya usado se ofrece DESHABILITADO en las otras líneas» + `desglose-captura.test.ts` :: «`opcionesPara(i)` deshabilita los métodos usados en otras líneas» | la opción existe pero con `disabled` |
| R6 | componente :: «quitar una línea libera su método en las demás» | tras quitar, la opción vuelve habilitada; queda `n-1` líneas; con 1 línea no se ofrece quitar |
| R7 | componente :: «la línea no ofrece referencia ni ningún otro campo» [D3] | dentro de la línea solo hay un combobox y un input numérico |
| R8 | componente :: «muestra monto a cobrar, suma capturada y diferencia, y se actualizan al teclear» | los tres valores con el formato de `money`, recalculados tras cada cambio |
| R9 | componente :: «una suma que NO cuadra pinta el error y NO llama a la action» (casos: de menos, de más, y ±0,01) | mensaje visible con `role="alert"`; `gestionar` no invocado |
| R10 | componente :: «volver atrás y elegir otro resultado descarta las líneas» | al reentrar en entregada, 1 línea limpia |
| R11 | `desglose-captura.test.ts` :: «0.1 + 0.2 contra 0.30 cuadra» / «no usa suma de floats» + guardia `tests/unit/guards/pagos-captura.guardia.test.ts` **(nuevo)** :: «el módulo de captura no contiene `parseFloat(`» | la aritmética pasa por `aCentimos`/`sumaCuadra` de la 212 |
| R12 | componente :: «una línea completamente vacía se descarta y el envío no la lleva» + `desglose-captura.test.ts` :: «`lineasParaEnviar` descarta las vacías» | el `FormData` no trae ese par |
| R13 | componente :: «método sin monto → error EN LA LÍNEA y no se envía» / «monto sin método → ídem» | `gestionar` no invocado; error asociado a esa línea |
| R14 | componente :: «con cobro y todas las líneas vacías, error de método requerido y no se envía» | mensaje visible; sin llamada |
| R15 | componente :: «el envío mixto manda dos pares `pagoMetodo`/`pagoMonto` emparejados y NINGÚN `metodoPago`» | `fd.getAll("pagoMetodo")`, `fd.getAll("pagoMonto")`, `fd.get("metodoPago") === null` |
| R16 | componente :: «orden SIN cobro: no hay editor, cero pares de pago y sin `metodoPago` escalar» | los tres `expect` a la vez; contraprueba con `montoCobrar > 0` |
| R17 | componente :: «el panel valida con `gestionarSchema` antes de enviar (sin fotos → no envía)» | error de `evidencias` sin llamada a la action |
| R18 | componente :: «un `validation_error` del servidor en `pagos` se pinta en el editor» | mock de `gestionar` devolviendo `fieldErrors.pagos` |
| R19 | guardia `pagos-captura.guardia.test.ts` :: «el árbol de imports del panel no importa `@prisma/client` COMO VALOR ni `lineas-pago` de ninguna forma» + contraprueba con un import inyectado | barrido transitivo del grafo desde `GestionarOrdenPanel.tsx`, distinguiendo `import type` de importación de valor |
| R20 | `tests/components/CierreDiaModule.test.tsx` (ampliado) + `tests/components/CierreDetallePagos.test.tsx` **(nuevo)** :: «una sola línea se ve exactamente igual que antes» | el texto de la celda es `SINPE` a secas en los tres sitios |
| R21 | mismos archivos :: «dos líneas: se ven los DOS métodos con su monto» | `Efectivo ₡5.000,00` y `Transferencia ₡3.000,00` visibles en la fila |
| R22 | mismos archivos :: «sin líneas, la celda sigue siendo `—`» | los tres sitios |
| R23 | guardia `pagos-captura.guardia.test.ts` :: «los tres sitios de presentación no leen `metodoPago` de la gestión» + contraprueba | barrido de los tres archivos |
| R24 | `CierreDetallePagos.test.tsx` :: «el orden pintado es el del DTO, no el alfabético» | DTO en orden `efectivo, SINPE, transferencia` → mismo orden en pantalla, con un caso cuyo orden alfabético diferiría |
| R25 | idem :: «las etiquetas salen de `METODO_LABEL`» | mutar `METODO_LABEL` cambia lo pintado en los tres sitios |
| R26 | `tests/unit/descarga/cierre-dia-descarga-columnas.test.ts` y `cierre-gestiones-descarga-columnas.test.ts` (los casos de censo YA existentes, sin tocar) | las listas de `clave`/`encabezado` siguen idénticas: ninguna columna nueva |
| R27 | mismos archivos (ampliados) :: «una gestión mixta produce UNA fila» | `filaDescargaDiaEntregada` devuelve un objeto, no un array |
| R28 | mismos archivos :: «dos líneas se concatenan en la celda `metodo`, en el orden del DTO, con un solo separador» | cadena exacta esperada |
| R29 | mismos archivos :: «una línea da solo la etiqueta, igual que hoy» | `"Efectivo"` |
| R30 | mismos archivos :: «sin líneas, la celda es `null`» | `null`, no `"—"` ni `""` |
| R31 | `tests/unit/descarga/columnas-sensibles.guardia.test.ts` (ampliada, ver design §5) + `pagos-captura.guardia.test.ts` :: «los dos módulos de descarga no contienen `parseFloat(`, `Number(`, `toFixed(` ni un símbolo de moneda literal» | barrido con contraprueba |
| R32 | `tests/unit/types/gestion-orden-pagos-schema.test.ts` (existente, sin tocar) + `pagos-captura.guardia.test.ts` :: «la forma escalar del borde sigue viva tras esta feature» | los casos R12/R19/R31 de la 212 siguen verdes sin editarlos |
| R33 | `tests/unit/guards/pagos-frontera.guardia.test.ts` (existente, 212) + revisión del diff | ninguna migración, schema ni RLS en el diff de la rama |
| R34 | `tests/unit/guards/pagos-frontera.guardia.test.ts` (existente, 212), verde sin editarlo | los seis módulos inmunes siguen sin nombrar el desglose |
| R35 | `tests/unit/utils/cierre-totales-pagos.test.ts` y `cierre-dia-service-totales-mixtos.test.ts` (existentes, 212), verdes sin editarlos + `e2e/mis-asignaciones.spec.ts` (ampliado) :: «entrega mixta 5.000 + 3.000 → el cierre muestra `total_efectivo` = 5.000» | el camino completo captura → totales, extremo a extremo |

**Cobertura: 35/35.** Ningún requisito queda sin test.

---

## Preguntas abiertas — TODAS CERRADAS EN LA PUERTA F1.4 (2026-08-13)

> El humano aprobó el spec el 2026-08-13 y cerró las seis preguntas de abajo con la propuesta que
> cada una traía. **No las reabras.** Las respuestas, en una línea cada una:
>
> - **[Q1] Monto CRUDO en la celda del CSV**, sin `₡` ni separador de miles: `Efectivo 5000.00 +
>   Transferencia 3000.00`. El módulo de descarga se declara money-safe y `docs/architecture.md`
>   prohíbe hardcodear moneda; [D4] fijaba la FORMA de la celda, no su formato.
> - **[Q2] Una sola línea = solo la etiqueta**, idéntico a hoy. El importe ya viaja en la columna
>   contigua y así el archivo del 99 % de las filas no cambia.
> - **[Q3] SÍ se autoriza ampliar la sonda de `columnas-sensibles.guardia.test.ts`** para campos de
>   lista, **midiendo sus totales antes y después** y con la contraprueba del design §5. Si el
>   total de columnas vigiladas baja, es un defecto bloqueante.
> - **[Q4] SÍ se pre-carga el monto**: primera línea = total a cobrar, línea nueva = pendiente. El
>   caso de un solo método tiene que seguir siendo un gesto.
> - **[Q5] El e2e roto es DEUDA APARTE.** `e2e/mis-asignaciones.spec.ts` ya estaba desactualizado
>   antes de esta ficha (espera un `dialog` que el rediseño ux retiró). Aquí se arregla SOLO lo que
>   este cambio rompe —la parte del recaudo—; el resto se da de alta como ficha propia y NO entra
>   en este PR.
> - **[Q6] Lectura ESTRICTA**: se descarta solo la fila totalmente vacía. Una fila con método y sin
>   monto —o al revés— es un ERROR VISIBLE antes de enviar, nunca un descarte silencioso.
>
> **[Q7] AÑADIDA Y CERRADA EN LA MISMA PUERTA — el total cuadra EXACTO, no «igual o superior».**
> El humano preguntó si el desglose debía validarse contra `valor_cobrar` admitiendo recaudar de
> más. Se comprobó que hoy la regla es EXACTA en tres capas y se decidió **conservarla**:
> `MisAsignacionesService.ts:349-363` (R22-h) exige `montoRecibido == montoCobrar` en
> `Prisma.Decimal`; la 212 exige `SUM(pagos) = montoRecibido`; y el panel **ni siquiera deja
> teclear el monto recibido** —lo fija a `orden.montoCobrar ?? 0` (`GestionarOrdenPanel.tsx:341`,
> `:395`)—, así que el mensajero elige CÓMO le pagaron, nunca CUÁNTO. Por eso «cuadrar con el monto
> recibido» y «cuadrar con el valor a cobrar» son hoy la misma frase. **Esta ficha NO añade input
> de monto recibido ni relaja R22(h).** Admitir sobrepago mueve `cierre_dia.total_efectivo`, que es
> la E del `min(P, E)` del pago al mensajero (44) —cambiaría lo que cobra una persona— y exige
> decidir qué es el excedente (vuelto, propina, abono). Si algún día se quiere, es ficha backend
> aparte.

**[Q1] Formato del monto dentro de la celda concatenada de las descargas.** El ejemplo de [D4] dice
`Efectivo ₡5.000 + Transferencia ₡3.000`, pero los dos módulos de descarga declaran en su cabecera
que son MONEY-SAFE: los montos viajan como el STRING del servidor, *«sin `parseFloat`/`Number` y sin
el símbolo de colón de `money`»* (`cierre-dia-descarga-columnas.ts:17-18`), y `docs/architecture.md`
prohíbe hardcodear moneda. Este spec propone `Efectivo 5000.00 + Transferencia 3000.00` (etiqueta +
string crudo). ¿Se confirma, o [D4] exige literalmente el símbolo y el separador de miles —lo que
obligaría a meter formateo de moneda en un módulo declarado puro y money-safe?

**[Q2] Gestión de UNA sola línea en las descargas (R29).** Se propone que siga siendo solo la
etiqueta (`Efectivo`), idéntico a hoy, porque el importe ya está en la columna contigua y así el
archivo del 99 % de las filas no cambia. La alternativa es que TODA fila lleve etiqueta+monto, más
uniforme pero cambia la salida de todas las entregas existentes. ¿Cuál?

**[Q3] Tocar `tests/unit/descarga/columnas-sensibles.guardia.test.ts`.** Esa guardia ejecuta cada
`fila*()` con una SONDA (`Proxy`) que responde a cualquier lectura con otra sonda. Leer
`gestion.pagos.map(...)` la hace REVENTAR (`map` devuelve un objeto, no una función), así que la
guardia se pondrá roja en cuanto la proyección use el desglose. El design §5 propone AMPLIAR la
sonda para que un campo de lista se comporte como array de una sonda —conservando el rastro y por
tanto todo su poder de detección—, con contraprueba. ¿Se autoriza tocar una guardia de datos
sensibles, midiendo sus totales antes y después como hizo la 209?

**[Q4] Pre-carga del monto (R2/R4).** El editor arranca con el total a cobrar puesto en la primera
línea, y una línea nueva nace con la diferencia pendiente. Es lo que mantiene el caso de un solo
método en un gesto, pero significa que el panel «propone» dinero. La alternativa es arrancar en
blanco y obligar a teclear siempre el importe. ¿Se confirma la pre-carga?

**[Q5] `e2e/mis-asignaciones.spec.ts` ya estaba desactualizado ANTES de esta ficha.** Su helper
`abrirGestionPrimeraOrden` espera un `dialog` llamado «Gestionar orden» (`:98`) que el rediseño ux
retiró: hoy el panel es INLINE. Su línea 128 (`elegirEnSelect(page, "Método de pago", "Efectivo")`)
además muere con este cambio. ¿Se arregla el spec entero dentro de esta ficha (arrastra trabajo
ajeno) o se limita a la parte del recaudo y el resto se registra como deuda aparte?

**[Q6] Línea a medias (R13).** [Q2 de la 212] mandó filtrar «las filas vacías». Este spec la
interpreta de forma ESTRICTA: se descarta solo la fila totalmente vacía; una fila con método
elegido y sin monto (o al revés) es un ERROR visible, no un descarte. Descartarla en silencio
cambiaría el reparto del dinero sin decírselo a nadie. ¿Se confirma esa lectura?
