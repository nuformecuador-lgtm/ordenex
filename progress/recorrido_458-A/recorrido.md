# 458-A — Recorrido por rol (design §10: pasos 1, 8, 12 y accesibilidad) · 2026-09-26

Playwright ad hoc (`chromium` de `@playwright/test`) contra UN dev server (`next dev -p 3458`, `.next`
borrado antes) sobre la base propia `ordenex_458af` (clon de la local, 225 migraciones). Usuarios:
`maestro.qa`, `admin.qa`, `tienda.qa` (seeds idempotentes corridos SOLO contra el clon). El modal
«Confirmá el SINPE de GAM» (ficha 429, no es de la wallet) se descartó con «Ahora no». Salida cruda:
`recorrido.json`; capturas `*.png`; árbol de accesibilidad `*-12-arbol-accesibilidad-mensajeros.txt`.

Datos del clon: caja 36 movimientos, libro de la tienda «Tania Tienda» 27, libro del mensajero 12
(Marco 10, Rita 2), 10 cierres.

## Resultado

| Rol | Paso | Resultado | Números |
| --- | --- | --- | --- |
| maestro | 1 `/wallet`: filtro de concepto solo con conceptos del periodo y su cuenta; sin «Otro gasto de Ordenex» | OK | 11 conceptos + «Todas»; Σ de las cuentas = 5+1+5+5+1+5+2+4+1+2+5 = **36** = filas de `wallet_movimiento` del clon; `egreso_gasto` ausente |
| maestro | 1 `/wallet` sin uuid ni código crudo (texto, aria-label, placeholder, title, value, describedby) | OK | 0 hallazgos |
| maestro | 8 `/wallet/tiendas`: ningún control pide un ID | OK (ver nota 1) | 0 campos de texto (los 2 `input` visibles son las fechas); 0 marcadores con «ID»/«identificador» |
| maestro | 8 selector de cierre: día CR + mensajero; búsqueda por nombre y por día | OK | 5 cierres de Tania; «Marco» → 3 (todas de Marco); «2026-09-24» → 2 (las dos de ese día); dos del 2026-08-13 desambiguadas con la hora (14:22 / 08:59) |
| maestro | 8 elegir con teclado (↓ + Intro) y aplicar | OK | «Cierre del 2026-09-24 · Quino QUEPOS · 7 movimientos» → **7** filas en la tabla (= el número del rótulo) |
| maestro | 8 `/wallet/tiendas` sin uuid ni código crudo | OK | 0 hallazgos; la columna Origen dice «Cierre del día · 2026-09-24 · Quino QUEPOS» + «Ver» |
| maestro | 8 `/wallet/mensajeros`: sin «Pegá el identificador» ni la ayuda de copiar la dirección | OK | 0 textos; 0 campos de texto |
| maestro | 8 selector por día y filtro aplicado | OK | 3 cierres de Marco; «2026-08-13» → 2; elegido → 3 filas |
| maestro | 12 árbol de accesibilidad de «Ver el cierre» | OK | nombres: «Ver el cierre de Marco Mensajero: Pago devengado del 2026-08-13», «… Liquidación del 2026-08-13»…; **0** líneas de nombre con uuid; 4 `/url:` con id (solo la dirección, D1) |
| maestro | 8 `/wallet/mensajeros` sin uuid ni código crudo | OK | 0 hallazgos |
| maestro | 12 `/analitica`: panel mensual «Movimiento neto del periodo» | **NO VISIBLE** (nota 2) | la región «Tablero financiero» no se pinta (0 regiones); ningún «Dinero en caja»/«Flujo de dinero registrado» en pantalla |
| maestro | accesibilidad del selector | OK | foco del disparador con anillo OPACO `rgb(212, 83, 13) 0 0 0 3px`; al abrir el foco va a «Buscar un cierre» (`role=combobox`); ↓ anuncia la opción por `aria-activedescendant`; Escape cierra y devuelve el foco al disparador |
| admin | 1, 8, 12 y accesibilidad | los mismos OK que el maestro | mismos números (36; 5/3/2 cierres; 7 filas; 3/2/3; 0 uuid) |
| admin | 12 `/analitica` | **NO VISIBLE** (nota 2) | ídem |
| tienda | 1 `/mi-wallet`: concepto con su número, desde la tienda | OK | 7 conceptos: 5+5+1+5+5+1+5 = **27** = filas de su libro |
| tienda | `/mi-wallet` origen con entidad (sin mensajero) | OK | «Cierre del día · 2026-09-24» |
| tienda | `/mi-wallet` sin uuid ni código crudo | OK | 0 hallazgos |
| tienda | `/wallet` → no encontrado | OK | HTTP 404 |

**Nota 1 — FALLO de la sonda, no de la app.** La primera pasada contó 1 `input` «no fecha» en el
desglose de la tienda: es el `input` oculto que Base UI pone al `Select` de concepto
(`aria-hidden="true"`, `tabindex=-1`, 1×1 px recortado). Medido con la sonda corregida
(`:not([aria-hidden=true])`): 0. La guardia R96 ya excluye esos `input`.

**Nota 2 — `/analitica`.** `AnaliticaShell` tiene la región `financiero` COMENTADA (solo pinta el
bloque de entregas), así que el panel mensual no se ve hoy en ningún rol. El rótulo está cambiado en
el cargador (`cargarTableroFinanciero`, que la página sigue llamando) y lo fija
`tests/unit/analitica/panel-mensual-rotulo.test.ts` (R62); cuando la región vuelva, dirá «Movimiento
neto del periodo».

## Asistente — cuatro preguntas reales en local (R103)

| Rol / pantalla | Pregunta | Respuesta (resumen literal) |
| --- | --- | --- |
| maestro · `/wallet/tiendas` | ¿Cómo filtro el desglose de una tienda por un cierre? ¿Tengo que pegar algún identificador? | «No, no hace falta que pegués nada. […] el filtro Cierre se elige de una lista de los cierres de esa tienda que tienen movimientos […] Podés buscar dentro de esa lista por día (por ejemplo 2026-09-12) o por el nombre del mensajero […] Si la lista te dice «Mostramos los cierres más recientes» […] usá la búsqueda por día» |
| maestro · `/wallet/tiendas` | ¿Por qué el filtro de concepto no me muestra todas las categorías y qué es el número entre paréntesis? | «solo aparecen los que tienen movimientos de esa tienda en el periodo (y el cierre, si elegiste uno) […] El número entre paréntesis […] es cuántos movimientos de ese concepto hay dentro del periodo filtrado. […] se queda seleccionado pero marcado con (0), hasta que vos mismo lo quites.» |
| admin · `/wallet/mensajeros` | ¿Qué significa «Ver» al lado del origen de un movimiento y cómo busco un cierre de hace dos semanas? | «Cuando ese origen tiene una pantalla propia —un cierre, una orden, el ranking—, el botón Ver te lleva directo ahí […] usá el filtro Cierre […] podés buscar por día (por ejemplo 2026-09-12) o por nombre. Si la lista te muestra solo los más recientes, buscá por la fecha» (la captura cortó el final de la respuesta, que seguía hablando de la pantalla Cierres) |
| tienda · `/mi-wallet` | ¿Qué significa el número entre paréntesis en el filtro de concepto? | «cada concepto aparece con un número entre paréntesis que indica cuántos movimientos tuyos hay de ese concepto en el periodo (y cierre) que elegiste. Por ejemplo, «Ordenex te cobró el flete (8)» […] si cambiás el periodo y el concepto que tenías elegido se queda sin movimientos […] sigue apareciendo, pero con (0)» |

Las cuatro citan su documento («Wallet · Tiendas», «Mi wallet») y ninguna menciona un identificador.
