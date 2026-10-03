# Feature 466 — Diseño

> Requisitos: `requirements.md` (R1-R28, textos de §0). Esta ficha **solo cambia texto**: no hay modelo de
> datos, migración, ruta, endpoint ni campo de contrato nuevo.

## 1. Decisiones

| # | Decisión | Por qué |
|---|---|---|
| D1 | **Sin migración ni backfill.** | Producción, 2026-10-01: 0 filas con `rechaz` en las descripciones de los dos libros. Todo texto del libro, del origen legible y del historial de acciones se **deriva al leer** de códigos (`categoria`, `origen_tipo`, `accion`). Cambiar el diccionario arregla las filas viejas (R3). |
| D2 | **Los textos nuevos se escriben como literales** en cada diccionario, no se componen con `NOMBRE_ESTADO`. | Los conceptos usan la forma corta «devolución a origen», que no es el nombre del estado: componerlos desde él acoplaría el nombre de un cargo de dinero al de un estado, y un cambio futuro del estado renombraría cobros sin que nadie lo decidiera. Solo los textos de §0.4 (estado/resultado) usan `NOMBRE_ESTADO`/`nombreDeResultado`, igual que la 455. |
| D3 | **Los tests afirman el literal nuevo**, no el valor de la fuente. | Un literal de rótulo **es** el contrato (memorias «Literal: contrato o polizón», «Aserción contra su propia fuente»). Donde un test hoy dice `"Flete por rechazo cobrado a la tienda"`, pasa a decir `"Flete por devolución a origen cobrado a la tienda"`; nunca `CATEGORIA_LABEL.ingreso_flete_devolucion`. |
| D4 | **Identificadores intactos** (R26): categorías, `origen_tipo`, `cobro_rechazo_tienda_*`, `rechazo_tienda_cobro`, ids de métrica `rechazos`/`tasa_rechazo`, claves de columna (`rechazo`, `retorno`, `rechazadas`), nombres de archivo y de componente. | No llegan crudos a nadie; los ids de métrica son contrato publicado (`publicacion-api-key.ts:62,67`). Mismo criterio que la 455 (fuera de alcance, su design §9-F). |
| D5 | **Contrato API: solo descripciones** (R16-R19). | Cambiar un `description` no rompe a ningún cliente; se espeja a mano en `docs/api/api-key-openapi.yaml` (la guardia `openapi-nombres-455` compara ambos) y se anota en el CHANGELOG como **sin ruptura**. |
| D6 | **Una guardia nueva de dos brazos** (R20-R23) en lugar de una búsqueda de la palabra en todo el árbol (§5, alternativa A3). | |
| D7 | **Secuencia backend → frontend** (memoria «Implementar con backend_dev/frontend_dev»): la Fase 1 toca `lib/`, `docs/api/` y nace la guardia con lo pendiente contado; la Fase 2 toca `app/`, `components/`, `docs/ayuda/` y vacía lo pendiente. | `lib/constants/wallet-rotulos.ts` lo reexportan los diccionarios de `app/`: cambiar la fuente primero deja la pantalla coherente desde el primer commit. |
| D8 | **Gate completo** `./init.sh` (no `--rapido`). | La ficha toca `lib/types/historial-accion.ts` (cimientos, regla 5 de `CLAUDE.md`) y archivos con nombre de dinero. |

## 2. Inventario clasificado (medido sobre `dev` el 2026-10-01, `grep` de texto plano)

Cada línea se **reconfirma** en T0.1 antes de editar (el árbol se mueve). «Cambia» = R1-R11; «Se
conserva» = §0.6.

### 2.1 `lib/` (Fase 1)

| Archivo:línea | Texto | Clase | Destino |
|---|---|---|---|
| `lib/constants/wallet-rotulos.ts:31,34,40,41` | 4 conceptos del libro de caja | Cambia | C1-C4. Lo reexportan `wallet-labels`, `mi-wallet-labels`, `wallet-mensajeros-labels`, `detalle-movimiento-labels` (mismo objeto). |
| `lib/constants/origen-legible-rotulos.ts:21` | `cobroPorRechazo: "cobro por rechazo"` | Cambia | C15. Lo usa `OrigenLegibleService.ts:197-199` → pantalla y columna «Motivo y origen» del Excel. La **clave** `cobroPorRechazo` no cambia. |
| `lib/types/historial-accion.ts:511,512,535,587` | 3 acciones + 1 entidad | Cambia | C25-C28 |
| `lib/types/historial-accion.ts:493,496,508,510,556` | «Rechazó un cierre…», «…un incidente», «…una postulación» | Se conserva | otra entidad |
| `lib/analytics/metrics.ts:258,393` | «Rechazos», «Tasa de rechazo» | Cambia | K1, K2. Las `descripcion` citan ids y se conservan. |
| `lib/notificaciones/emitir.ts:1104,1107` | aviso de novedades sin gestionar | Cambia | E12, E13 |
| `lib/notificaciones/emitir.ts:63,719` | `TEXTO_ORDEN_RECHAZADA` (ya usa `NOMBRE_ESTADO`), «… fue rechazado» (cierre) | Se conserva | ya correcto / otra entidad |
| `lib/services/mensajes-bloqueo.ts:106-108` | `MSG_TOPE_INTENTOS_GESTION` | Cambia | E6 |
| `lib/services/CierresAdminService.ts:115` | «Solo una entrega se puede corregir a rechazo…» | Cambia | E4 |
| `lib/services/CierresAdminService.ts:98`, `CierresBodegaAdminService.ts:47`, `mensajes-incidente-admin.ts:35,54` | motivo de rechazo de cierre/incidente | Se conserva | otra entidad |
| `lib/api/openapi-spec.ts:1424,2062,2068,2073` | `costoEstimado` y escenario devuelto: «RECHAZADA», «Flete por rechazo», «IVA del flete por rechazo» | Cambia | R16 |
| `lib/api/openapi-spec.ts:1513,1656` | «evidencia de entrega, rechazo o incidente», «un rechazo manual de la tienda» | Se conserva | acto |
| `lib/types/order-status.ts:143,316` | nombre vigente y texto aprobado 456 | Se conserva | R12 |

### 2.2 `app/` y `components/` (Fase 2)

| Archivo:línea | Clase | Destino |
|---|---|---|
| `app/(app)/wallet/_components/wallet-labels.ts:301` (`DOCUMENTO_CAJA_NOMBRE.rechazo_tienda_cobro`) | Cambia | C16 |
| `app/(app)/wallet/_components/composicion-detalle-labels.ts:78-79` | Cambia | C5-C6 |
| `app/(app)/wallet/tiendas/_components/desglose-tienda-labels.ts:46,49,62,63` | Cambia | C7-C10 |
| `app/(app)/mi-wallet/_components/mi-wallet-labels.ts:107,110,124,125` | Cambia | C11-C14 |
| `components/shared/wallet/detalle-movimiento-panel-labels.ts:64,144,155,157` | Cambia | C17-C20 |
| `app/(app)/wallet/_components/cobro-rechazo-tienda-labels.ts:20,38,40,104,107` | Cambia | C21-C24 |
| `app/(app)/wallet/_components/cobro-rechazo-tienda-labels.ts:31` («La tienda rechazó…») | Se conserva | acto de la tienda |
| `app/(app)/wallet/mensajeros/_components/wallet-mensajeros-labels.ts:301,320`; `cobro-gasto-fijo-labels.ts:57,165` | Se conserva | cierre / cobro rechazado |
| `app/(app)/configuracion/tarifas/_components/tarifas-labels.ts:41,44,86,90` | Cambia | C29-C32. `rechazado` (C31) pasa a `nombreDeResultado("devolucion_a_origen_por_rechazo")` (es el nombre del resultado, D2). |
| `app/(app)/cierres-admin/_components/cierre-detalle-shared.tsx:326,336,338,380,469,470,481` | Cambia | C33-C35, E8, E9 |
| `app/(app)/cierres-admin/_components/cierre-detalle-shared.tsx:221` («Un cierre rechazado…») | Se conserva | cierre |
| `app/(app)/cierres-admin/_components/cierre-labels.ts:173,248,272,276,315,319,335,453,465,522` | Cambia | C33, C35, E10 |
| `app/(app)/cierres-admin/_components/cierre-labels.ts:79,362` | Se conserva | estado del cierre |
| `app/(app)/cierres-admin/_components/ConsolidacionBodegaModule.tsx:351`; `cierre-factura.tsx:2389` (aria) | Cambia | C34 |
| `app/(app)/cierres-admin/_components/cierre-factura.tsx:244,1895,1901,1921` | Se conserva | motivo del cierre / acto de la tienda (Pregunta 7) |
| `app/(app)/cierres-admin/_components/CorregirResultadoDialog.tsx:63,71,74` | Cambia | E1-E3 |
| `app/(app)/mis-asignaciones/_components/GestionarOrdenPanel.tsx:277` | Cambia | E5 |
| `app/(app)/mis-asignaciones/_components/GestionarOrdenPanel.tsx:222,1216` («Rechazar», «Foto de evidencia del rechazo») | Se conserva | acción / acto |
| `app/(app)/novedades/_components/GestionarDesdeAyudaModal.tsx:168` | Cambia | E7 |
| `app/(app)/novedades/_components/GestionarDesdeAyudaModal.tsx:162,208` | Se conserva | acción «Rechazar» |
| `app/(app)/novedades/_components/RechazarNovedadModal.tsx:109` | Cambia | C36 |
| `app/(app)/novedades/_components/RechazarNovedadModal.tsx:77,112,125,148,256` | Se conserva | acción de la tienda / motivo de su acto |
| `app/(app)/novedades/_components/RechazosSlaModule.tsx:47,76` | Cambia | E11 (se alinea con la pestaña «Devolución a origen por plazo vencido» y con sus líneas 40-41) |
| `app/(app)/analitica/_components/operativo/catalogo-paneles.ts:104` | Cambia | K1 (misma cadena que la métrica: la guardia `etiquetas-visibles` lo exige) |
| `app/(app)/analitica/_components/entregas/ProductosTabla.tsx:267` | Cambia | K3 |
| `app/(app)/analitica/_components/entregas/analitica-productos-descarga-columnas.ts:96,160` | Cambia | K4, C38 |
| `app/(app)/analitica/_components/entregas/DineroProductoDetalle.tsx:100,102,135` | Cambia | C37 |

### 2.3 Documentos (Fase 1: `docs/api/`; Fase 2: `docs/ayuda/`)

| Archivo:línea | Clase | Destino |
|---|---|---|
| `docs/api/api-key-openapi.yaml:1284,2008,2018,2021` (3 «RECHAZADA» + 2 «flete por rechazo»; T1.5 los reconfirma) | Cambia | espejo de R16 |
| `docs/api/manual-metricas-por-mensajero.md:283` («flete de devolución y su IVA», además nombre retirado por la 338) | Cambia | R18 |
| `docs/api/manual-metricas-por-mensajero.md:157`; `guia-integracion.html:671,700` («rechazo manual», «reprogramación o rechazo») | Se conserva | acto |
| `docs/api/guia-integracion/guia-integracion.html:758` (ids `rechazos`, `tasa_rechazo`) | Se conserva | ids de contrato |
| `docs/api/CHANGELOG.md` | Entrada nueva | R19 |
| `docs/ayuda/oficina/wallet-caja.md:95,207,335,342,361,365,442` | Cambia | C1-C4, C21, «cobro por devolución a origen» |
| `docs/ayuda/tienda/mi-wallet.md:94,104` | Cambia | C11, C15 |
| `docs/ayuda/oficina/cierres.md:73,107` | Cambia | «…pasa a **Devolución a origen por rechazo**», «…una entrega a Devolución a origen por rechazo» |
| `docs/ayuda/mensajero/cierre-del-dia.md:42`, `reparto.md:94,114,132`, `tienda/novedades.md:54`, `oficina/incidentes.md` | Se conserva | acto / acción / otra entidad |

## 3. La guardia nueva: `tests/unit/guards/rechazo-nombre-466.guardia.test.ts`

Lectura por AST de TypeScript (literales de cadena, plantillas y texto JSX; **los comentarios no cuentan**),
como la G2 de la 455. Documentos por líneas, quitando el código entre backticks.

### 3.1 Brazo 1 — diccionarios de rótulos (R20, R22)

**Archivos** (lista cerrada; los mismos que §2 marca «Cambia» y sus vecinos de rótulos):
`lib/constants/wallet-rotulos.ts`, `lib/constants/origen-legible-rotulos.ts`, `lib/types/historial-accion.ts`,
`lib/analytics/metrics.ts`, `lib/services/mensajes-bloqueo.ts`,
`app/(app)/wallet/_components/{wallet-labels,composicion-detalle-labels,cobro-rechazo-tienda-labels}.ts`,
`app/(app)/wallet/tiendas/_components/desglose-tienda-labels.ts`, `app/(app)/mi-wallet/_components/mi-wallet-labels.ts`,
`components/shared/wallet/detalle-movimiento-panel-labels.ts`, `app/(app)/configuracion/tarifas/_components/tarifas-labels.ts`,
`app/(app)/cierres-admin/_components/{cierre-labels.ts,cierre-detalle-shared.tsx,CorregirResultadoDialog.tsx}`,
`app/(app)/analitica/_components/operativo/catalogo-paneles.ts`,
`app/(app)/analitica/_components/entregas/{ProductosTabla.tsx,DineroProductoDetalle.tsx,analitica-productos-descarga-columnas.ts}`,
`app/(app)/novedades/_components/{GestionarDesdeAyudaModal.tsx,RechazosSlaModule.tsx}`.

**Detector:** sobre cada texto, se borra primero el nombre vigente «Devolución a origen por rechazo»; luego
`(?<![\p{L}_])rechaz(?:o|os|ado|ados|ada|adas)(?![\p{L}_])` con `iu`. «rechazó», «rechazar», «rechaza» no
casan (son verbos de una acción, §0.6). Un texto que parece identificador (`^[a-z0-9_.:/@#-]*$`) o SQL no se
mira (mismo filtro que la G2 de la 455).

**Excepciones** cerradas, por **archivo + texto exacto + motivo** (no por número: memoria m1 de la 455).
Las esperadas hoy (T1.3 las reconfirma en modo informe):

| Archivo | Texto | Motivo |
|---|---|---|
| `lib/types/historial-accion.ts` | (ninguna esperada: sus textos usan «Rechazó») | — |
| `app/(app)/cierres-admin/_components/cierre-labels.ts` | «Rechazado» (`ESTADO_LABEL.rechazado`, `CierreEstado`) | estado de un cierre |
| `app/(app)/cierres-admin/_components/cierre-detalle-shared.tsx` | «Un cierre rechazado no es terminal: …» | cierre |
| `lib/services/mensajes-bloqueo.ts` | los que T1.3 encuentre sobre cierres | cierre |

Toda excepción no usada o con texto distinto pone la suite roja (R22).

### 3.2 Brazo 2 — frases retiradas en todo el árbol (R21)

Recorre `app/`, `lib/`, `components/`, `hooks/` (AST) y `docs/ayuda/**`, `docs/api/**` salvo
`docs/api/CHANGELOG.md` (líneas). Busca las frases de §0.5 en cualquier caja tras borrar el nombre vigente.
**Sin excepciones.** Es el brazo que caza un archivo nuevo que no está en la lista del brazo 1. «Rechazos»
como rótulo se mira por **igualdad** del texto recortado (no por «contiene»: «Rechazos» dentro de un
identificador o en `rechazos-sla` no es un rótulo).

### 3.3 Brazo 3 — el contexto del asistente (R15)

Para cada rol de `contextoPara` (los mismos seis de la G2 de la 455), ningún documento contiene una frase
de §0.5.

### 3.4 Autocomprobación (R23)

1. no-vacuidad: el brazo 1 lee **todos** los archivos de su lista (falla si falta uno); el brazo 2 lee más de
   300 archivos de `app/` y más de 10 de `docs/ayuda`;
2. el mismo extractor encuentra «devolución a origen» en el brazo 1 (más de 15 textos) — prueba que lee
   texto visible y que el cambio está puesto;
3. mutaciones sintéticas: `"Flete por rechazo cobrado a la tienda"`, `<span>Tasa de rechazo</span>`,
   `` `quedó rechazada` ``, `**Cobro por rechazo**` en un documento → rojo; `"Devolución a origen por
   rechazo"`, `"Rechazar"`, `"El destinatario rechazó el paquete."`, `// flete por rechazo` → verde;
4. una excepción con texto cambiado → rojo (R22).

### 3.5 La guardia de la 338 (R24)

`tests/unit/guards/flete-por-rechazo-censo.guardia.test.ts`: `NOMBRE_RETIRADO` **no cambia** (sigue
prohibiendo «flete de devolución»/«flete devuelto»); `NOMBRE_VIGENTE` pasa a
`/flete\s+por\s+devoluci[oó]n\s+a\s+origen/iu` y el mensaje de error nombra el nombre nuevo. Se añade a
su autocomprobación que «Flete por devolución a origen» **no** casa `NOMBRE_RETIRADO` (si casara, la 338
prohibiría el nombre que fija la 466).

### 3.6 Cuidados con las guardias existentes

- **455 G2 (`nombres-estado-retirados`)**: su brazo CONTENIDO busca «En devolución» con mayúscula como
  palabra (nombre retirado §0.3 de la 455). Ningún texto nuevo puede **empezar** por «En devolución a
  origen…». Los de §0 no lo hacen.
- **455 G3 (`fuente-unica-nombre-estado`)**: `PAGO_ZONA_TEXTO` tiene una sola clave que es código
  (`entregado`); usar `nombreDeResultado` en C31 evita además un literal del nombre del estado fuera de la
  fuente.
- **461 (`nombres-wallet-461`)**: ningún texto nuevo coincide con un nombre retirado o tomado de la 461.
- **`etiquetas-visibles`** (analítica): métrica y leyenda del panel cambian en el mismo commit.

## 4. Contratos de entrada/salida

No cambian. Únicamente:

- `lib/api/openapi-spec.ts` → la descripción de `costoEstimado` (línea 1424), `CotizacionEscenarioDevuelto.description`
  y `properties.flete/iva.description` (texto). Espejo idéntico en `docs/api/api-key-openapi.yaml`.
- Textos de error que ya viajan en `detalle`/`message` (E4, E6): mismo campo, mismo código de estado.
- Excel: mismas columnas y claves; cambian los encabezados K4/C38 y el contenido textual de concepto y origen.

## 5. Alternativas descartadas

- **A1 — Renombrar también los identificadores** (`ingreso_flete_devolucion`, `rechazo_tienda_cobro`,
  `cobro_rechazo_tienda_*`, ids de métrica, `RechazosSlaModule`…). Descartada: exige migraciones de enums y
  de datos, rompe los ids publicados por API key a integradores con tráfico, y no cambia nada que lea una
  persona. Es el mismo criterio que la 455 fijó en su fuera de alcance.
- **A2 — Componer los conceptos desde `NOMBRE_ESTADO`** (`` `Flete por ${…}` ``). Descartada (D2): el concepto
  usa la forma corta y no el nombre del estado; acoplarlos haría que renombrar un estado renombrara un cargo
  de dinero sin decisión, y los tests acabarían comparando el texto contra su propia fuente.
- **A3 — Una guardia que prohíba «rechaz» en todo el árbol con lista de excepciones.** Descartada: ~3 700
  apariciones en ~600 archivos, casi todas legítimas (cierres, incidentes, credenciales, fotos, Meta,
  postulaciones); la lista de excepciones sería inmanejable y crecería con cada pantalla. Se elige un brazo
  amplio sobre una lista cerrada de diccionarios más un brazo de frases exactas en todo el árbol.
- **A4 — Usar el nombre completo del estado en los conceptos** («Flete por Devolución a origen por
  rechazo»). Descartada: redundante y largo en celdas y encabezados de Excel; el leader eligió la forma corta.
- **A5 — Migración que reescriba descripciones persistidas.** Descartada: medido 0 filas (D1); una migración
  sin filas que tocar solo añade riesgo y un `down.sql` sin propósito.

## 6. Riesgos

- **Tests que fijan los literales viejos** (~380 apariciones de «por rechazo» en ~144 archivos de `tests/`,
  muchas del propio nombre vigente). Se cambian al literal nuevo (D3), nunca a la fuente; un test que
  afirmaba un texto conservado (§0.6) **no** se toca.
- **Lectura ambigua en analítica** junto a «Devoluciones»/«Tasa de devolución» (Pregunta abierta 2).
- **Integradores**: solo cambian descripciones; ningún campo ni valor (R17). Riesgo bajo, anotado en el
  CHANGELOG.
- **Fallo mudo de pantalla**: un rótulo puede salir de un sitio no inventariado. Mitigación: brazo 2 de la
  guardia y el recorrido con Playwright de T3.2 (memoria «Ver la app encuentra lo que la suite no»).
