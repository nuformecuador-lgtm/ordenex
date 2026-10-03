# Feature 466 — «rechazo» pasa al nombre vigente en conceptos, KPIs, ayuda y Excel

> Pedida y aprobada por el humano el 2026-10-01 (punto 6). Zona `fullstack`, `depends_on: null`. Diseño en
> `design.md`, desglose en `tasks.md`.
>
> El pedido, literal del encargo: «hubo un cambio de nombre de estados, pero en lugares (p.ej. libro de
> movimientos de la wallet y su Excel) aún aparece "rechazo", y ese estado ahora es "Devolución a origen por
> rechazo". Seguramente hay más sitios». La 455 renombró el **estado** (fuente única `NOMBRE_ESTADO`,
> `lib/types/order-status.ts:132-153`); esta ficha alinea los **conceptos, KPIs y textos derivados** de ese
> estado, que la 455 dejó fuera.
>
> Los nombres de §0 son los **por defecto** decididos por el leader y son **revisables por el humano** en la
> puerta `spec_ready` (ver «Preguntas abiertas»). Esta ficha **revierte** en parte la decisión de la 338
> («Flete por rechazo», elegido por el humano el 2026-08-31): el pedido de hoy es posterior y la sustituye.

## 0. Los textos que fija esta ficha (contrato)

### 0.1 Regla de sustitución

1. Un **concepto de dinero, KPI agregado, columna o prosa genérica** derivado del resultado
   `devolucion_a_origen_por_rechazo` usa la forma corta **«devolución a origen»** (plural «devoluciones a
   origen»), conservando el resto del rótulo tal cual (incluido «cobrado a la tienda», 461 HD3).
2. Un texto que nombra el **estado de una orden o el resultado de una gestión** usa el **nombre visible
   exacto** «Devolución a origen por rechazo» (455 R2/R4).
3. Un recuento/columna de **un único resultado** se rige por la 455 R5 (ver Pregunta abierta 1).

### 0.2 Conceptos de dinero (antes → después)

| # | Sitio (diccionario · clave) | Antes | Después |
|---|---|---|---|
| C1 | Libro de caja · `ingreso_flete_devolucion` | Flete por rechazo cobrado a la tienda | Flete por devolución a origen cobrado a la tienda |
| C2 | Libro de caja · `ingreso_iva_flete_devolucion` | IVA del flete por rechazo cobrado a la tienda | IVA del flete por devolución a origen cobrado a la tienda |
| C3 | Libro de caja · `egreso_reverso_flete_devolucion` | Flete por rechazo cobrado a la tienda anulado | Flete por devolución a origen cobrado a la tienda anulado |
| C4 | Libro de caja · `egreso_reverso_iva_flete_devolucion` | IVA del flete por rechazo cobrado a la tienda anulado | IVA del flete por devolución a origen cobrado a la tienda anulado |
| C5 | Composición · `egreso_reverso_flete_devolucion` | Fletes por rechazo cobrados a una tienda anulados | Fletes por devolución a origen cobrados a una tienda anulados |
| C6 | Composición · `egreso_reverso_iva_flete_devolucion` | IVA de fletes por rechazo cobrados a una tienda anulados | IVA de fletes por devolución a origen cobrados a una tienda anulados |
| C7 | Libro de la tienda (oficina) · `flete_devolucion` | Flete por rechazo cobrado a la tienda | Flete por devolución a origen cobrado a la tienda |
| C8 | Libro de la tienda (oficina) · `iva_flete_devolucion` | IVA del flete por rechazo cobrado a la tienda | IVA del flete por devolución a origen cobrado a la tienda |
| C9 | Libro de la tienda (oficina) · `flete_devolucion_anulado` | Cobro por rechazo anulado | Cobro por devolución a origen anulado |
| C10 | Libro de la tienda (oficina) · `iva_flete_devolucion_anulado` | IVA del cobro por rechazo anulado | IVA del cobro por devolución a origen anulado |
| C11 | Mi wallet · `flete_devolucion` | Ordenex te cobró el flete por rechazo | Ordenex te cobró el flete por devolución a origen |
| C12 | Mi wallet · `iva_flete_devolucion` | Ordenex te cobró el IVA del flete por rechazo | Ordenex te cobró el IVA del flete por devolución a origen |
| C13 | Mi wallet · `flete_devolucion_anulado` | Ordenex anuló el flete por rechazo y te lo devolvió | Ordenex anuló el flete por devolución a origen y te lo devolvió |
| C14 | Mi wallet · `iva_flete_devolucion_anulado` | Ordenex anuló el IVA del flete por rechazo y te lo devolvió | Ordenex anuló el IVA del flete por devolución a origen y te lo devolvió |
| C15 | Origen legible (pantalla y columna «Motivo y origen» del Excel) | cobro por rechazo | cobro por devolución a origen |
| C16 | Documento de caja (título de «Anular …») · `rechazo_tienda_cobro` | el cobro por rechazo a una tienda | el cobro por devolución a origen a una tienda |
| C17 | Detalle de movimiento · acción automática `cobro_por_rechazo` | Cobro por rechazo aprobado | Cobro por devolución a origen aprobado |
| C18 | Detalle de movimiento · no anulable `no_aprobado` | el cobro por rechazo no está aprobado | el cobro por devolución a origen no está aprobado |
| C19 | Detalle de movimiento · explicación `vigente` | Es un cobro a la tienda por el flete de un rechazo: … | Es un cobro a la tienda por el flete de una devolución a origen: … (resto igual) |
| C20 | Detalle de movimiento · explicación `anulado` | Este cobro por rechazo se anuló: … | Este cobro por devolución a origen se anuló: … (resto igual) |
| C21 | Cola de cobros · sección y título | Cobros por rechazo de tienda por aprobar | Cobros por devolución a origen de tienda por aprobar |
| C22 | Cola de cobros · columna `flete` | Flete por rechazo | Flete por devolución a origen |
| C23 | Cola de cobros · columna `generadoEl` | Rechazado el | Fecha de la devolución a origen |
| C24 | Cola de cobros · `sinPermiso` / `errorCarga` | … cobros por rechazo de tienda. | … cobros por devolución a origen de tienda. |
| C25 | Historial de acciones · `cobro_rechazo_tienda_aprobado` | Aprobó un cobro por rechazo de tienda | Aprobó un cobro por devolución a origen de tienda |
| C26 | Historial de acciones · `cobro_rechazo_tienda_rechazado` | Rechazó un cobro por rechazo de tienda | Rechazó un cobro por devolución a origen de tienda |
| C27 | Historial de acciones · `cobro_rechazo_tienda_anulado` | Anuló un cobro por rechazo a una tienda | Anuló un cobro por devolución a origen a una tienda |
| C28 | Historial de acciones · entidad `rechazo_tienda_cobro` | Cobro por rechazo | Cobro por devolución a origen |
| C29 | Tarifas · `valorFleteDevuelto` | Flete por rechazo | Flete por devolución a origen |
| C30 | Tarifas · `valorFleteDevueltoGam` | Flete por rechazo GAM | Flete por devolución a origen GAM |
| C31 | Tarifas · pagos por zona `rechazado` | Rechazado por el cliente | Devolución a origen por rechazo |
| C32 | Tarifas · pagos por zona `seccionAyuda` | … el rechazo del cliente es ingreso de la bodega responsable de él. | … una Devolución a origen por rechazo es ingreso de la bodega responsable del mensajero. |
| C33 | Cierres · flete / IVA / GAM / con IVA | Flete por rechazo · IVA del flete por rechazo · Flete por rechazo GAM · Flete por rechazo + IVA | Flete por devolución a origen · IVA del flete por devolución a origen · Flete por devolución a origen GAM · Flete por devolución a origen + IVA |
| C34 | Cierres · ingreso de bodega (rótulo y nombres accesibles) | Ingreso de bodega por rechazos (… a consolidar / … del cierre) | Ingreso de bodega por devoluciones a origen (… a consolidar / … del cierre) |
| C35 | Cierres · notas de cascada y totales | «flete por rechazo», «un rechazo», «los rechazos», «ingreso de bodega por rechazos» | «flete por devolución a origen», «una devolución a origen», «las devoluciones a origen», «ingreso de bodega por devoluciones a origen» (resto de cada nota igual) |
| C36 | Novedades · aviso del modal de rechazo | Esto le cobra a tu tienda el flete por rechazo y … | Esto le cobra a tu tienda el flete por devolución a origen y … (resto igual) |
| C37 | Analítica · retorno por producto (pantalla y pista) | Flete por rechazo · «Flete por rechazo + IVA de las órdenes en …» | Flete por devolución a origen · «Flete por devolución a origen + IVA de las órdenes en …» |
| C38 | Analítica · descarga de productos, columna `retorno` | Flete por rechazo (no sumable) | Flete por devolución a origen (no sumable) |

### 0.3 KPIs y columnas de un único resultado

| # | Sitio | Antes | Después |
|---|---|---|---|
| K1 | Métrica `rechazos` y leyenda del panel operativo | Rechazos | Devoluciones a origen |
| K2 | Métrica `tasa_rechazo` | Tasa de rechazo | Tasa de devolución a origen |
| K3 | Tabla de productos, cifra `rechazo` | % de rechazo | % de devolución a origen |
| K4 | Descarga de productos, columna `rechazo` | Rechazo (%) | Devolución a origen (%) |

Los **ids** de métrica (`rechazos`, `tasa_rechazo`) y las **claves** de columna no cambian (§G).

### 0.4 Textos que nombran el estado o el resultado (nombre exacto)

| # | Sitio | Antes | Después |
|---|---|---|---|
| E1 | Corregir resultado · aviso | La entrega pasa a ser un rechazo. Queda registrado … | La entrega pasa a ser Devolución a origen por rechazo. Queda registrado … |
| E2 | Corregir resultado · botón | Marcar como rechazada | Marcar como Devolución a origen por rechazo |
| E3 | Corregir resultado · confirmación | Resultado corregido: la entrega pasó a rechazo. | Resultado corregido: la entrega pasó a Devolución a origen por rechazo. |
| E4 | Corregir resultado · error del servidor | Solo una entrega se puede corregir a rechazo: los demás resultados no cobran nada. | Solo una entrega se puede corregir a Devolución a origen por rechazo: los demás resultados no cobran nada. |
| E5 | Panel del mensajero · nota del tope de intentos | … Registra cómo terminó ahora — entregada o rechazada. … | … Registra cómo terminó ahora — Entregado o Devolución a origen por rechazo. … |
| E6 | Error del servidor · tope de intentos | … solo se puede registrar como entregada, rechazada o como incidente | … solo se puede registrar como Entregado, Devolución a origen por rechazo o Incidente |
| E7 | Gestión desde ayuda · confirmación | La orden quedó rechazada. | La orden quedó en Devolución a origen por rechazo. |
| E8 | Cierres · nota del marcador automático | Rechazo automático por vencerse el plazo de la devolución (no lo hizo el mensajero). | Devolución a origen automática por vencerse el plazo de la novedad (no lo hizo el mensajero). |
| E9 | Cierres · nota del marcador manual | Rechazo registrado manualmente por el mensajero. | Devolución a origen registrada manualmente por el mensajero. |
| E10 | Cierres · motivo automático en la cola | lo rechazó el sistema al vencerse el plazo de la devolución | el sistema la pasó a devolución a origen al vencerse el plazo de la novedad |
| E11 | Novedades · paginación y permiso de la pestaña de plazo vencido | Paginación de rechazos por plazo vencido · No tenés permiso para ver los rechazos por plazo vencido. | Paginación de órdenes con devolución a origen por plazo vencido · No tenés permiso para ver las órdenes con devolución a origen por plazo vencido. |
| E12 | Aviso de novedades (campana y push), plazo de cinco días | A los N días se rechaza automáticamente. | A los N días pasa a Devolución a origen por rechazo automáticamente. |
| E13 | Aviso de novedades, plazo de veinticuatro horas | … el sistema la reintenta o la rechaza sin esperar tu decisión. | … el sistema la reintenta o la pasa a Devolución a origen por rechazo sin esperar tu decisión. |

### 0.5 Frases retiradas (no pueden reaparecer como texto visible)

«flete por rechazo», «fletes por rechazo», «IVA del flete por rechazo», «cobro por rechazo», «cobros por
rechazo», «cobros de rechazos», «ingreso de bodega por rechazos», «tasa de rechazo», «% de rechazo»,
«Rechazo (%)», «Rechazado por el cliente», «Rechazos» (como rótulo entero), «pasa a rechazo», «pasó a
rechazo», «corregir a rechazo», «entrega a rechazo», «Marcar como rechazada», «quedó rechazada», «rechazos
por plazo vencido» — en cualquier caja de letra.

### 0.6 Lo que se conserva (no es el estado)

«rechazar», «rechazó», «rechazo», «rechazado/a» se **conservan** cuando nombran:

- **la acción de una persona**: los botones «Rechazar» del mensajero y de la tienda (la tabla de
  `docs/ayuda/mensajero/reparto.md` ya dice «Rechazar» → «Devolución a origen por rechazo»);
- **el acto del destinatario o de la tienda**: «El destinatario rechazó el paquete» (texto aprobado de la 456),
  «Foto de evidencia del rechazo», «Motivo del rechazo», «Fecha del rechazo», «Rechazados por la tienda»,
  «La tienda rechazó estas devoluciones desde novedades»;
- **la decisión sobre otra entidad**: cierres, cierres de bodega, incidentes, cobros de gasto fijo, la
  decisión «No cobrar» de un cobro, postulaciones, plantillas de WhatsApp, credenciales, fotos, conciliaciones
  (`wallet-mensajeros-labels.ts:301,320`, `cobro-gasto-fijo-labels.ts:57,165`, `cierre-labels.ts:79`…);
- **identificadores**: códigos, enums, categorías, `origen_tipo`, nombres de tabla, de archivo, de función,
  ids de métrica y claves de columna;
- la **historia**: `docs/api/CHANGELOG.md`, comentarios de código, notificaciones y WhatsApp ya emitidos.

## 1. Glosario

- **Nombre vigente**: «Devolución a origen por rechazo» (`NOMBRE_ESTADO.devolucion_a_origen_por_rechazo`).
- **Superficie visible**: la de la 455 (pantallas de todo rol, descargas, mensajes, notificaciones,
  `docs/ayuda/**`, respuestas del asistente) más la documentación de integradores (`docs/api/**` salvo el
  CHANGELOG) y las descripciones del contrato OpenAPI.
- **Diccionario de rótulos**: los archivos de etiquetas enumerados en `design.md` §3.1.

---

## A. Conceptos de dinero

- **R1** — CUANDO una superficie visible muestre un concepto de §0.2, el sistema DEBE mostrar exactamente el
  texto de su columna «Después».
- **R2** — CUANDO el libro de caja, el libro de la tienda, Mi wallet o el detalle de un movimiento se
  descarguen a Excel, el sistema DEBE escribir en las columnas de concepto y de «Motivo y origen» los mismos
  textos de §0.2 que muestra la pantalla para esa fila.
- **R3** — CUANDO se muestre o descargue un movimiento registrado antes del despliegue, el sistema DEBE
  mostrar el texto de §0.2, sin reescribir ninguna fila de la base.
- **R4** — CUANDO el detalle de un cierre, la consolidación de bodega o su comprobante impreso muestren el
  ingreso de bodega por gestiones en Devolución a origen por rechazo, el sistema DEBE rotularlo con el texto
  C34, también en su nombre accesible.
- **R5** — CUANDO `/configuracion/tarifas` muestre el monto que se paga por gestión en Devolución a origen por
  rechazo, el sistema DEBE rotularlo «Devolución a origen por rechazo» (C31) junto a su hermano «Entregado».

## B. KPIs y columnas

- **R6** — CUANDO la analítica muestre la métrica `rechazos`, el sistema DEBE rotularla «Devoluciones a
  origen» en la métrica y en la leyenda del panel, con el mismo texto en ambos.
- **R7** — CUANDO la analítica muestre la métrica `tasa_rechazo`, el sistema DEBE rotularla «Tasa de
  devolución a origen».
- **R8** — CUANDO la tabla de productos de la analítica o su descarga muestren la proporción de órdenes en
  Devolución a origen por rechazo, el sistema DEBE rotularla con K3 en pantalla y K4 en el archivo.

## C. Estado y resultado

- **R9** — CUANDO una superficie visible nombre el estado de una orden o el resultado de una gestión de código
  `devolucion_a_origen_por_rechazo`, el sistema DEBE usar el nombre vigente exacto y NO DEBE usar «rechazo»,
  «rechazada» ni «rechazadas» como nombre de ese estado o resultado (textos E1-E11 de §0.4).
- **R10** — CUANDO se emita el aviso de novedades sin gestionar (campana o push) con plazo de cinco días o de
  veinticuatro horas, su texto DEBE ser el de E12 o E13 respectivamente, con la cifra de configuración
  interpolada igual que hoy.
- **R11** — CUANDO el servidor rechace una gestión por el tope de intentos o una corrección de resultado que no
  parte de una entrega, el mensaje que llega a la persona DEBE ser E6 o E4 respectivamente.
- **R12** — El nombre vigente «Devolución a origen por rechazo» NO DEBE cambiar, ni en la fuente única ni en
  `specs/456-tooltip-estados/textos-aprobados.md`.
- **R13** — El sistema DEBE conservar sin cambios los textos de §0.6 (acción de una persona, acto del
  destinatario o de la tienda, decisión sobre otra entidad).

## D. Ayuda, asistente y contrato

- **R14** — Los documentos de `docs/ayuda/**` DEBEN nombrar los conceptos de §0.2 y §0.3 con su texto
  «Después», y NO DEBEN contener ninguna frase de §0.5.
- **R15** — CUANDO el asistente construya su contexto para cualquier rol, ese contexto NO DEBE contener
  ninguna frase de §0.5.
- **R16** — CUANDO el contrato publicado (OpenAPI y su espejo `.yaml`) describa el flete y el IVA del escenario
  de devolución de la cotización, sus descripciones DEBEN llamarlos «Flete por devolución a origen» e «IVA del
  flete por devolución a origen» y DEBEN nombrar el resultado con su código vigente o su nombre vigente, no
  como «RECHAZADA».
- **R17** — El contrato publicado NO DEBE cambiar ningún nombre de campo, valor enumerado, id de métrica,
  ruta, código de respuesta ni forma de cuerpo por esta ficha.
- **R18** — `docs/api/manual-metricas-por-mensajero.md` DEBE llamar al flete de una orden en
  `devolucion_a_origen_por_rechazo` «flete por devolución a origen y su IVA».
- **R19** — `docs/api/CHANGELOG.md` DEBE tener, antes de la release, una entrada fechada, marcada como **sin
  ruptura**, que diga qué descripciones cambiaron y que ningún campo ni valor cambió.

## E. Guardias que rompen el build

- **R20** — SI un diccionario de rótulos (`design.md` §3.1) contiene, como texto visible y una vez borrado el
  nombre vigente, la palabra «rechazo», «rechazos», «rechazado», «rechazados», «rechazada» o «rechazadas» en
  cualquier caja, fuera de la lista cerrada de excepciones (archivo + texto exacto + motivo), ENTONCES la
  suite DEBE fallar nombrando archivo, línea y texto.
- **R21** — SI un archivo de `app/`, `lib/`, `components/`, `hooks/`, `docs/ayuda/**` o `docs/api/**` (salvo
  `docs/api/CHANGELOG.md`) contiene una frase de §0.5 como texto visible, ENTONCES la suite DEBE fallar
  nombrando archivo y línea. Los comentarios de código no cuentan.
- **R22** — SI una excepción de R20 deja de hacer falta o su texto cambia, ENTONCES la suite DEBE fallar
  pidiendo retirarla o ajustarla.
- **R23** — Cada brazo de R20-R21 DEBE ponerse rojo ante una mutación que reintroduce el defecto (probado en
  su propio archivo) y DEBE afirmar que leyó un número mínimo de archivos y que encuentra el texto nuevo.
- **R24** — La guardia de la 338 DEBE seguir prohibiendo «flete de devolución» y «flete devuelto», y su
  autocomprobación DEBE buscar el nombre vigente «Flete por devolución a origen».

## F. No-regresión

- **R25** — Para un mismo conjunto de datos, todo importe, saldo, total, KPI y fila de descarga DEBE dar el
  mismo valor antes y después de la ficha; solo cambian los rótulos.
- **R26** — Ningún código, categoría de movimiento, `origen_tipo`, tipo de acción del historial, tabla,
  columna, migración, ruta de pantalla, id de métrica ni clave de columna de descarga DEBE cambiar.
- **R27** — Las guardias de la 455 (nombres retirados, fuente única, catálogo) y de la 461 (nombres
  retirados y tomados de la wallet) DEBEN seguir en verde sin añadir ninguna excepción.
- **R28** — Ningún rol DEBE ganar ni perder acceso a pantallas, acciones o datos por esta ficha.

---

## Supuestos medidos

- **Producción, 2026-10-01 (dato del encargo):** 0 filas con `rechaz` en `wallet_movimiento.descripcion` y en
  `wallet_tienda_movimiento.descripcion`. El texto del libro es **derivado** de la categoría y del origen
  (`lib/constants/wallet-rotulos.ts`, `lib/services/OrigenLegibleService.ts:195-201`): cambiar el rótulo
  arregla las filas viejas sin migración.
- Los textos del historial de acciones se derivan del código `accion` (`ACCION_LABELS`) al leer; la etiqueta
  de entidad persistida del cobro es la guía (`lib/types/historial-accion-etiquetas.ts:224`), sin «rechazo».
- El Excel del libro de caja toma concepto y origen de los mismos diccionarios que la pantalla
  (`app/(app)/wallet/_components/wallet-ledger-descarga-columnas.ts:34,58,75`).
- Los ids `rechazos` y `tasa_rechazo` se publican por API key (`lib/analytics/publicacion-api-key.ts:62,67`,
  `docs/api/api-key-openapi.yaml:593,597`): son contrato y no se tocan (R17).
- La guardia de la 338 (`tests/unit/guards/flete-por-rechazo-censo.guardia.test.ts:51`) no casa «flete por
  devolución a origen» (exige «flete [de] devolución» sin «por»), pero su autocomprobación exige hoy más de 5
  apariciones de «Flete por rechazo» en `app/` y se pondrá roja (R24).
- `docs/ayuda/**` no menciona ningún nombre retirado de la 455 con «rechaz»; sí las frases de §0.5 en
  `oficina/wallet-caja.md`, `tienda/mi-wallet.md` y `oficina/cierres.md`.
- Barrido con `grep` (texto plano; regla 7 de `CLAUDE.md`): «rechaz» aparece en ~600 archivos de código, la
  inmensa mayoría con significado legítimo (§0.6). El inventario clasificado está en `design.md` §2.

## Fuera de alcance

- Renombrar identificadores: categorías (`ingreso_flete_devolucion`…), `origen_tipo`, tipos de acción
  (`cobro_rechazo_tienda_*`), tablas (`rechazo_tienda_cobro`), ids de métrica, claves de columna, nombres de
  archivo y de componente (`RechazosSlaModule`, `cobro-rechazo-tienda-labels.ts`).
- Las métricas «Devoluciones» y «Tasa de devolución», que cuentan el resultado `novedad` (no es «rechazo»).
- La prosa singular «entregada»/«reprogramada» fuera de las frases que esta ficha reescribe (la 455 la
  permite), y «devolver»/«devoluciones» referidos a Novedad (`COBROS_RECHAZO_DESCRIPCION`,
  `GestionarOrdenPanel` «ni devolver»).
- La landing pública (`app/_landing/LandingPoliticas.tsx:31`, «Un paquete rechazado suma el flete de
  retorno»): describe el acto (ver Pregunta abierta 9).
- Las descripciones internas de `lib/analytics/metrics.ts`, que citan los ids de métrica.
- Notificaciones, pushes y WhatsApp ya emitidos; plantillas de WhatsApp creadas por usuarios.

## Preguntas abiertas

Ninguna bloquea: cada una tiene un valor por defecto, ya escrito arriba, que se aplica si el humano no dice
otra cosa en la puerta `spec_ready`.

1. **KPI de recuento (K1).** La 455 R5 pide el nombre exacto del estado para un recuento de un único
   resultado («Devolución a origen por rechazo»), pero sus hermanos son «Entregas», «Devoluciones» y
   «Reprogramaciones». Por defecto: «Devoluciones a origen». ¿O el nombre exacto?
2. **Choque con «Devoluciones» / «Tasa de devolución»**, que cuentan **Novedad**: junto a «Devoluciones a
   origen» / «Tasa de devolución a origen» pueden leerse como lo mismo. ¿Se acepta, o se abre ficha para
   renombrar las de Novedad?
3. **Reversión de la 338.** El humano eligió «Flete por rechazo» para que «devolución» no sugiriera que una
   Novedad cobra. ¿Confirma «Flete por devolución a origen»?
4. **Sufijo «cobrado a la tienda»** (461 HD3) en C1-C4: el leader dio «Flete por devolución a origen» a secas.
   Por defecto se conserva el sufijo (sustitución mínima).
5. **«Ingreso de bodega por rechazos»** (C34-C35) no estaba en la lista del leader. Por defecto: «Ingreso de
   bodega por devoluciones a origen».
6. **Cola de cobros (C21, C23).** Por defecto «Cobros por devolución a origen de tienda por aprobar» y
   «Fecha de la devolución a origen» (hoy «Rechazado el» se lee, en una fila de cobro, como si el cobro se
   hubiera rechazado).
7. **Textos del acto de la tienda en cierres** («Rechazados por la tienda», «Fecha del rechazo», «Lista de
   paquetes rechazados por la tienda»): se conservan (§0.6). ¿O pasan a «Devolución a origen decidida por la
   tienda»?
8. **Pago por zona (C31)**: «Rechazado por el cliente» → «Devolución a origen por rechazo». ¿OK?
9. **Landing pública**: fuera de alcance por defecto. ¿Se incluye?
10. **CHANGELOG (R19)**: por defecto se escribe una entrada sin ruptura aunque solo cambien descripciones.
