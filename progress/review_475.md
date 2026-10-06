# Revisión — Ficha 475 «Informe de tránsito por WhatsApp»

- **Revisor:** reviewer (subagente), 2026-10-05.
- **HEAD revisado:** `58af7ba3` (`origin/feature/475-informe-transito-whatsapp`, «gate --rapido verde con backend, frontend y dev integrados»). Diff `origin/dev...HEAD`: 33 archivos, sin migraciones, sin `db/schema.prisma` y sin `lib/types/`.
- **Spec:** `specs/475-informe-transito-whatsapp/` (R1–R40). Decisiones aprobadas: una zona nueva toma 20/5; las 4 devoluciones en tránsito se incluyen; `incidente` entra con umbral 1. Maquetas: `design-whatsapp/ParamsTransito.dc.html`, `PdfTransito1.dc.html` y `PdfTransito2.dc.html`.
- **Búsqueda de código:** no usé el grafo MCP `codebase-memory`. Todo el diff son archivos nuevos o toques pequeños, y los leí enteros directamente. Usé `grep` para los consumidores de `DescriptorParametro`/`descriptores`, para la convención `::timestamp` de los repos y para el `onCambiar` de `EnvioForm`.

## Veredicto: **APROBADO** (para mergear a `dev`)

No hay bloqueantes de merge. Cada R1–R40 tiene un test real que lo verifica. El SQL se probó contra Postgres y M1–M14 están medidas y muertas. El dinero no pasa por `number`. La vista previa solo responde a `maestro`, y lo comprueba el servidor. El contrato de la 474 se amplía sin romperse.

Igual que en las reviews 461, 462, 465, 473 y 474, **antes de pasar a `done`** hay que cerrar M1–M3: `tasks.md` está sin marcar, falta ver la app (T6.3), falta el `EXPLAIN` de producción (T7.2) y falta la entrada en `history.md`. Estos puntos bloquean el `done`, no el merge.

## Verificación ejecutable (lo que corrí yo)

- **Gate:** no corrí `./init.sh` (regla 5, por orden del leader). Leí `progress/gate_475.log`:
  - `INIT_EXIT=0`;
  - relacionados: 209/209 archivos;
  - guardias: 274/274 archivos, 3764 tests;
  - los 5 archivos de `integration/db` de la 475 salen en verde (hitos 4, parados 1, selección 2, zonas 3, catálogo-real 1) y **no** están saltados.
- **Mis tests:** corrí en este worktree, sin `DATABASE_URL`, con vitest los 7 archivos unit/components de la 475. Añadí `catalogo-informes` (474), `envios-whatsapp-formulario` (474), la guardia `estado-con-info` y uno de integración:
  - **11 archivos pasan y 1 se salta**;
  - **149 tests pasan y 2 se saltan**;
  - código de salida 0.
  - El archivo saltado es el de integración (no hay base aquí): no lo cuento como verde y me apoyo en el gate y en la bitácora.
- **Integración:** leí los 5 archivos y la siembra `_informe-transito-475.ts`:
  - ninguno tiene un `if (!x) return` vacío;
  - sin base usan `describe.skip`;
  - la siembra **lanza** si falta catálogo;
  - las aserciones son `toEqual` exactos (por ejemplo, la forma completa de `FilaTransito` en selección, que de paso prueba R30 por construcción);
  - el de catálogo-real mide por diferencia antes/después.
- **Mutaciones:** la bitácora documenta M1–M14, una extra y F1–F3, todas muertas. Las de SQL se aplicaron con el diff confirmado antes y después y con revert verificado. No las repetí: no hay base en este worktree.

## Checklist (CHECKPOINTS.md)

### Especificación
- [x] `requirements.md` con R1–R40 en EARS.
- [x] `design.md` con 5 alternativas descartadas (§12).
- [ ] `tasks.md` con todas las tasks `[x]`: **0 de 27 marcadas** → M1.
  - Están hechas, con evidencia en la bitácora: T1–T5 (salvo T0.2 y T5.5), T6.1, T6.2, T6.4 (el gate del leader) y T7.1.
  - No están hechas: T0.2 (base clonada: el leader la sustituyó por la base local, aceptable), T6.3 (ver la app) y T7.2 (EXPLAIN).
  - T7.3 (comprobar los checks del PR) toca al abrir el PR.

### Trazabilidad
- [x] Cada R1–R40 mapea a un test concreto que existe y afirma (tabla de abajo).
- [x] `progress/impl_475.md` tiene el mapa R→test de backend y de frontend, las mutaciones medidas y los desvíos.

### Calidad de código
- [x] typecheck y lint verdes (gate del leader).
- [x] Tests verdes: los míos sin base y la integración en el log del leader.
- [x] E2E: no aplica. No hay harness, y la ficha no toca auth, pagos, recaudo, ingesta ni webhooks.

### Datos y seguridad
- [x] Sin tablas nuevas ni migraciones: la ficha es de solo lectura.
- [x] Sin secretos. El SQL es `Prisma.sql` con parámetros, y el fragmento del hito sale de un mapa cerrado de tres `Prisma.Sql`.
- [x] Sin webhooks nuevos.
- [x] `aptoParaAdminTienda: false` (test R1). La 474 rechaza al guardar el rol o el usuario `adminTienda`.

### Patrón de capas
- [x] El repo solo tiene SQL. El cálculo, puro, vive en `calculo.ts`. La action valida la sesión y zod y delega en `seleccionarTransito`, la misma función que usa `generar`. La interfaz está en `lib/interfaces/repositories/`.

### Permisos
- [x] `previsualizarInformeTransito` devuelve `unauthenticated` o `forbidden` **antes** de tocar el repo. Hay un test por cada rol que no es maestro (admin, adminSatelite, adminTienda, mensajero, apiKey), y verifica que el repo no se llama.
- [x] El repo es de solo lectura por tipo: solo admite `queryRaw`, sin `executeRaw`.

### Multi-país / configuración
- [x] La moneda va por `formatMontoString` (símbolo configurado).
- [x] «Costa Rica», «GAM» y `fecha-cr` son el dominio del repo entero (hora CR); no es un hardcode nuevo.

### Verificación final
- [x] Gate `--rapido` verde (log del leader). El completo es obligatorio antes de la release a `prod`.
- [x] Este archivo existe.
- [ ] Entrada en `progress/history.md` → M3.

## Foco pedido por el leader

| Punto | Resultado |
| --- | --- |
| Estados / cierre logístico | `candidatas`: `deleted_at IS NULL`, `s.value IN (incluidos)` y, como cinturón, `NOT IN ('entregado','devuelta_a_tienda')` aunque zod ya los rechaza (R10, M3 muerta). `ESTADOS_OFRECIDOS` = `ORDER_STATUS_SEED` − cierre, con un test de igualdad de conjuntos. |
| Zona por `zona_id` | `JOIN cortes ON z.zona_id = c.zona_id`. Ningún texto de dirección (R8, test con un distrito asignado a OTRA zona). |
| Hitos desde `orden_historial_estado` | Central = `MIN` por **destino** `en_bodega_central`. Guía = `MIN` de `generacion_guia`, `ruteo_satelite` y la creación en `por_recolectar_en_tienda`, con `num_guia IS NOT NULL`. Creación = `orden.created_at`. Mutaciones M6–M8 y M10 muertas. |
| Cortes por zona en hora CR | `corte = inicioDelDiaSiguienteCR(hoy) − umbral·24h`, calculado en TS. `hito < corte` ⇔ `diasNaturalesCRDesde ≥ umbral`, con prueba exhaustiva hora a hora. El cast `::timestamp` sigue la convención medida de `IngresosAnaliticaRepository` y `FinanzasDiarioRepository`. La frontera exacta (−1 ms entra, = no) está probada contra Postgres (M5). |
| Frontera vencido `>` y parado `>` | `vencido = dias > plazo` (10/10 por vencer, 11/10 vencido; M11). `parado = diasEnEstado > umbral`, con umbral 0 y sin historial cubiertos (M12). La última transición es `ORDER BY created_at DESC, id DESC LIMIT 1` (M9 y empate). |
| N+1 | Exactamente 3 consultas crudas por generación (test `composicion` y test con 1 y con 500 filas). Las LATERAL son por fila dentro de UNA consulta, no viajes de ida y vuelta. |
| Montos | `monto_cobrar::text`, `sumarMontos` (`Prisma.Decimal`) y `formatMontoString`. Los únicos `Number(...)` del diff son `num_guia` y `COUNT`. Test con `99999999999.00`. |
| PDF sin datos sensibles | `FilaTransito` no trae teléfono, dirección, tienda, mensajero ni producto, y el test de integración afirma la forma exacta. El test del PDF busca uuids. El nombre del cliente sale, como pide la maqueta aprobada. |
| PDF legible sin color | «VENCIDO» y «PARADO» como texto (R27). Los recuadros llevan rótulo. |
| `aptoParaAdminTienda:false` | Sí (test R1). |
| Vista previa solo maestro en el servidor | Sí, ver Permisos. |
| Descriptor `panel` / contrato 474 | La unión gana `DescriptorPanel`, de forma aditiva. Ningún código de servidor itera `descriptores`; solo el catálogo los pasa al DTO. `ParametrosInforme` añade una rama y no toca las genéricas. `catalogo-informes` (474) se adaptó a `campos` y sigue verde, igual que `envios-whatsapp-formulario`. Para la 476, ver m1. |
| Fallos mudos | Un error de lectura se envuelve con el nombre de la operación y se propaga, nunca «vacío» (R22, M14). Una fila de una zona desconocida **lanza**. En el panel, un fallo de la vista previa se ve como «No se pudo calcular…» y un fallo al cargar zonas como aviso con «Reintentar». Un carácter que la fuente no cubre sale como «?». No encontré ningún `catch` que trague. |

## Desvíos declarados: dictamen

| Desvío | Dictamen |
| --- | --- |
| `montoCobrar` como `string` | **Aceptable, y mejor que el design**: el DTO no arrastra Prisma y la suma sigue en `Decimal`. |
| `zonaId` sin `uuid()` estricto (texto de 1 a 64) | **Aceptable**. R4 no pide uuid; una zona inexistente se ignora (R7). |
| Sin rama `{tipo:"error"}` | **Aceptable**. R22 pide propagar, y el motor de la 474 convierte la excepción en error del job. |
| PDF sin negrita (una sola fuente embebida) | **Aceptable**. La jerarquía va por tamaño y color, y el texto es legible. Es la misma limitación que la fuente de etiquetas (282). |
| «Por vencer» en vez de «En alerta» en el 2.º recuadro | **Aceptable**. Lo manda R23 y el spec aprobado prevalece sobre la maqueta. |
| «?» por carácter no soportado | **Aceptable**: evita un borrado mudo. Hay test. |
| Rejilla en vez de `<table>` en el panel | **Aceptable en código**: cada número tiene `<Label>` con su zona y hay cabecera a partir de 640 px. Pero **no se ha visto en el navegador** → M2. |
| Excepción de la guardia 456 para `ParamsTransito.tsx` | **Aceptable**. Clase «control con hermano» legítima: `InfoEstado` se pinta como hermano de la etiqueta de cada estado. |
| `contarSinHito` limitado a las zonas de `cortes` | **Aceptable**: en producción `cortes` lleva todas las zonas. |
| Pie `05/10/2026 05:00` frente a `5 oct 2026 05:00` | Aceptable (cosmético). |

## Hallazgos

### Bloqueantes (de merge)
Ninguno.

### Mayores (bloquean `done`, no el merge)
- **M1 — `tasks.md` sin marcar (0/27).** Hay que marcar las hechas y dejar anotadas como abiertas T6.3, T7.2 y T7.3.
- **M2 — T6.3 no hecha: nadie ha visto el panel ni el PDF real.** La bitácora del frontend lo reconoce: «No verificado en navegador», y el PDF solo se verificó por texto extraído. Falta:
  - crear un envío con el informe en local y comparar el panel con `ParamsTransito.dc.html`, a 390 px y en escritorio;
  - hacer «Probar ahora» con una plantilla con documento y abrir el PDF del historial frente a `PdfTransito1/2`.

  La memoria «ver la app encuentra lo que la suite no» lo hace obligatorio.
- **M3 — T7.2 (`EXPLAIN` de `filasEnAlerta` en producción, solo lectura por MCP) y la entrada en `progress/history.md`** sin hacer.

### Menores
- **m1 — `PanelDeInforme` (`ParametrosInforme.tsx`) hace `switch (d.panel)` sin `default`, y `tsconfig` no tiene `noImplicitReturns`.** Si la 476 añade `"picking"` a `PanelParametros` y olvida la rama, el panel **no pinta nada, y no da ni error de tipos ni aviso**: un fallo mudo. Recomendación: un `default` con `assertNever` o el mensaje genérico «todavía no se puede editar».
- **m2 — `catalogo.ts` pasa de `as InformeWhatsapp<unknown>[]` a `as unknown as …`.** Afloja el tipado de todo el arreglo del catálogo. Es inevitable por la varianza de `generar(ctx: ContextoInforme<P>)`, pero conviene dejar un comentario o un helper `registrar<P>()` para que el siguiente informe no herede el doble cast a ciegas.
- **m3 — En `clasificar`, `porZona.set(id, [...(porZona.get(id) ?? []), p])` copia el arreglo en cada inserción: O(n²) por zona.** Irrelevante con decenas de alertas. Basta con `push`.
- **m4 — Al montar, el panel rellena `zonas` vía `onCambiar` cuando faltan entradas.** Abrir un envío guardado antes de que existiera una zona lo deja con cambios sin que el maestro toque nada. Así lo pide R35 y no está mal, pero conviene saberlo si la 474 añade un aviso de «cambios sin guardar».
- **m5 — Diferencias de PDF con la maqueta, que no exige ningún R:**
  - falta la leyenda de `PdfTransito1` («"Días" = días desde … / plazo de la zona. En rojo y con la marca VENCIDO…», «"—" en Por cobrar: el paquete ya está pagado»);
  - las marcas VENCIDO y PARADO van en una columna propia y no junto al estado.

  Se puede decidir en T6.3.
- **m6 — No usé el grafo MCP** (lo declaro, como pide la regla 7). La revisión se hizo leyendo los archivos del diff enteros.

## Mapa R → test (comprobado en el árbol)

| R | Test | ¿Verifica de verdad? |
| --- | --- | --- |
| R1 | unit `informe-transito-informe` «metadatos» | Sí: clave, nombre, documento, `aptoParaAdminTienda:false`, eventos `[]`, `soloPorEvento:false`. |
| R2 | unit `informe-transito-informe` «variables», «destinatario_nombre llega por el motor» | Sí. |
| R3, R4, R5, R6 | unit `informe-transito-parametros` | Sí: los rechazos de R4 con su ruta; la partida literal de R5; la igualdad de conjuntos contra el seed. |
| R7 | unit `informe-transito-calculo` «R6/R7» | Sí. |
| R8, R9 | int `informe-transito-zonas`, int `informe-transito-seleccion` | Sí (M1, M2, M4). |
| R10 | int `informe-transito-seleccion` (la consulta pide los de cierre) | Sí (M3). |
| R11, R12, R13, R14 | int `informe-transito-hitos`; unit `informe-transito-pdf` (línea de los que no tienen hito); components `ParamsTransito` | Sí (M6, M7, M8, M10). |
| R15, R16, R17 | unit `informe-transito-calculo`; int `parados` y `zonas` | Sí (M5, M9, M11, M12). |
| R18, R19, R20, R21, R22 | unit `informe-transito-informe`, unit `informe-transito-calculo`, unit `informe-transito-pdf` R19, int `catalogo-real` | Sí (M13, M14). |
| R23–R32 | unit `informe-transito-pdf` (un `describe` por R, sobre el texto extraído de `/ToUnicode`; 200 filas para R31) | Sí. |
| R33 | unit `informe-transito-informe` «R33» (23:30 CR) | Sí. |
| R34, R35, R36, R37, R38 | components `ParamsTransito` (21 tests; F1–F3 muertas); unit `informe-transito-actions` (R38 del servidor) | Sí, con un harness que usa el mismo `setV(p => …)` funcional que `EnvioForm`. |
| R39 | unit `informe-transito-actions` | Sí: cada rol que no es maestro recibe `forbidden` sin tocar el repo; el doble no tiene escrituras; la misma selección que `generar`. |
| R40 | unit `informe-transito-repo-consultas` (1 y 500), unit `informe-transito-composicion` (3 consultas crudas), int `seleccion` | Sí. |
