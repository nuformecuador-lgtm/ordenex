# 425 — Revisión · worktree en `21d04880` (backend `c185800e` + frontend `21d04880`)

> Escrito por el leader a partir del informe del reviewer, que no puede escribir archivos. Al terminar,
> `git status` y `git diff HEAD` vacíos en el worktree, `.env` borrado.

## Veredicto: **RECHAZADO** — un bloqueante, y NO es de código

El código, la migración, los tests y la pantalla están bien, y **ninguna mutación de dinero
sobrevive**. El único bloqueante es el aviso para quien aprueba (`progress/aviso_425_desglose.md`):
prometía una aprobación directa que el sistema no permite.

## El rojo de `cierre-bloqueo-nv-sql-real.test.ts` en el gate: **no es de la 425**

Es una **carrera entre dos tests ajenos a la ficha**, reproducida:

- El caso R9 de `cierre-rechazado-aviso-dedupe.test.ts` (ficha 412, líneas 266-339) crea un cierre
  `rechazado` con el **cliente global**, fuera de la transacción revertida y sin el lock asesor, y lo
  borra en el `finally` (336). Es del **primer usuario de la base** (71, 91).
- El N/V de la 271 toma `usuarios = findMany({ take: 3 })` **sin orden** (67): puede ser ese mismo
  usuario. Un `rechazado` suma en N y en V → exactamente +1 en los dos, en todos los casos.
- **Reproducción:** con la ventana del cierre de la 412 alargada 8 s y el N/V retrasado 3 s, en
  paralelo, salen **los mismos 4 rojos con los mismos mensajes que el gate**. Aislado, 18/18.
- Los tests de la 425 no pueden escribir en la base: en B6 y B7 `corteDe` construye todo sobre
  `clienteConTransaccionAnidada(tx)`, dentro de `enTransaccionRevertida`.
- **Sugerencia fuera de la ficha:** que el R9 de la 412 cree su propio usuario o tome el lock, o que el
  N/V cree sus mensajeros.

Los otros 4 rojos del gate (tres `notificacion-evento-*-migration` y `orden-traspaso-migration`) eran
residuo de la prueba T25 de la 427 y un censo de migraciones; ya resueltos por el leader y el backend
(`1cc28446`).

## Mutaciones y sondas (cada una restaurada antes de la siguiente)

B5 = `…-sql-real` · B6 = `…-totales` · B7 = `…-aprobacion` · unitario = `cierre-dia-repository.test.ts` ·
337 = `cierre-excluye-gestiones-de-escritorio`.

| Mutación | Tests | Resultado |
| --- | --- | --- |
| **MA** el rechazo recibe `cierre_id` (`CierreDiaRepository.ts:983`) | B6, B7 | **ROJO, 11** (R8 apuntes, R9-R13, contaminación) |
| **MB** `total_pago_mensajero` suma 1500 por rechazo | B6 | **ROJO** (`1500.00` → `3000.00`; Arnel `4500.00`) |
| **MC (= M5)** quitar `rechazo_tienda` de la lista de exclusión (`orden-historial.ts:403`) | B6, 337, B9 | **ROJO, 13** — ingreso de bodega `328.00` en vez de `164.00`: **el doble cobro está protegido** |
| **MD** quitar `resultado: "rechazada"` (464) | B5 | **ROJO** (D2, primer cerrojo) |
| **ME** quitar el `some` del origen (465) | B5 | **ROJO** (D2, segundo cerrojo) |
| **MF (= M4)** quitar `vinculoRechazoTienda: { is: null }` (466) | B5, unitario | B5 verde 8/8; **el literal de B3 la pone ROJO** (lo declarado por el backend) |
| **MG** quitar `anuladaAt: null` (463) | B5, unitario | B5 verde; solo la caza el literal de B3 |
| **MH** quitar `cierreId: null` (462) | B5, unitario | B5 verde; solo la caza el unitario (5) |
| **MI** quitar `mensajeroId` (461) | B5, unitario | B5 verde; solo la caza el literal de B3 |
| **MJ** quitar `reprogramacion_tienda` de la lista (407) | 337 | **ROJO, 5** (incluye el caso de la semilla cambiada) |
| **MK** el predicado admite reprogramaciones | 337, B5 | **ROJO, 7** |
| **ML** el snapshot de la 69 lee la lista del servicio (1047) | unitario | **ROJO, 12** (incluye el del `lastCall`) |
| **MN** la pantalla del mensajero no pasa la prop (`CierreDiaModule.tsx:991`) | F3 | **ROJO** |
| **MO** sin la línea «documento de revisión» (`cierre-factura.tsx:1905-1907`) | F4 | **ROJO** |
| **MP** los rechazos etiquetados «paga» (1711) | F4 | **ROJO** |
| **MQ** singular roto (1733) | F4 | **ROJO** |
| **Sonda P1** el admin aprueba el `vencido` directamente | B7 | **ROJO**: `conflict`, las órdenes siguen en `rechazada` |
| **Sonda P2** el admin lo destraba (`forzarSolicitudVencido`) y lo aprueba, sin el mensajero | B7 | **VERDE**, 12/12 |
| **Control** sin mutar | B5, B6, B7, 337, unitario, F3, F4 | **VERDE**, 174/174 |

## Bloqueante

**El aviso prometía una aprobación directa que el sistema no permite** (`aviso_425_desglose.md`, commit
`9915aafc`, líneas 51 y 56). El administrador solo aprueba cierres en `solicitado`
(`CierresAdminRepository.ts:121`, `ESTADOS_RESOLUBLES = ["solicitado"]`, desde la 111). Ante un
`vencido`, la pantalla ofrece «Destrabar cierre vencido» (`CierresAdminModule.tsx:1548-1551`,
`1658-1660`) y solo después «Aprobar». Medido: P1 `conflict`, P2 verde. Un aprobador que busque
«Aprobar» en el cierre de Arnel o de Andy no lo encontraría, justo lo que D3 quería evitar.

**Verificado por el leader en el código** y corregido en el aviso (ver al final).

## Menores

1. **El camino de Andy y Arnel no tiene test.** B7 cumple R13 porque el mensajero re-solicita
   (`cierre-rechazo-tienda-aprobacion.test.ts:398`), y ninguno trabaja → fijar P2 como caso de B7.
2. **Tres condiciones de R1 solo las protege el literal de B3** (MG, MH, MI sobreviven en B5,
   `CierreDiaRepository.ts:461-463`): «no anulado», «sin `cierre_id`» (en producción hay rechazos
   anteriores a la 337 que sí lo tienen) y «atribuido a ese mensajero». Faltan tres casos en B5.
3. **Nombre que confunde:** `cierre-excluye-gestiones-de-escritorio.test.ts:290`, la variable
   `rechazo` guarda ahora una reprogramación.
4. **`lastCall`** (`cierre-dia-repository.test.ts:1700`): más robusto con `toHaveBeenCalledTimes(2)`.
5. **`tasks.md`** sin casillas `[x]`; V1, V3, V4 y V5 pendientes; el texto de B8 no recoge el
   conflicto con R5.
6. **Para V5, leído en el código:** el bloque 139 libera las `rechazada` **por `mensajeroAsignadoId`**
   (`CierresAdminRepository.ts:2120-2127`). Si se aprueba antes el cierre `solicitado` del 11/09 de
   Arnel, ese ya saca NA-947, NA-981 y NA-1103 sin esperar al de la 425: V5 no demostraría R13 en
   producción, y el aviso describía el cierre equivocado. **Verificado por el leader en el código.**

## Verificado y en regla

- **Dinero:** los nombres protegidos solo aparecen en comentarios en las líneas cambiadas; el diff no
  toca ningún archivo de dinero.
- **Migración:** `20260917120200` posterior al último del árbol; `down.sql` = `DROP TABLE`; RLS sin
  políticas; 3 FKs RESTRICT/CASCADE y `UNIQUE(gestion_id)`; ninguna migración existente editada.
- **R10:** los rechazos no entran en la confirmación física (lo demuestra MA) y la sección no tiene
  casilla.
- **Pantalla:** la guardia F3 solo se amplió; la sección sale en las tres superficies (el comprobante
  imprimible es el mismo componente); literales de F4 escritos a mano.
- **Trazabilidad R1-R21:** cada requisito con su test, ninguno vacío.
- **Los 71 dobles:** todas las líneas borradas revisadas; solo añaden `rechazosDeTienda: []` o enrutan
  por el `where`, ninguna aserción cambiada.
- **B6 y B7** lanzan si el corte no crea el cierre: no pueden quedar verdes por vacío.

## Decisiones sobre los dos puntos pedidos

- **La semilla de la 337: legítima, no debilita la red.** R5 revoca exactamente la mitad «rechazo, sin
  cierre» del caso Andy; la otra mitad (D2) sigue con sus aserciones literales y MJ y MK la ponen roja.
  Lo que protegía la mitad retirada sigue cubierto por tres casos del mismo archivo, y MC tumba cuatro.
- **El `lastCall`: legítimo.** `crearCierre` hace exactamente dos lecturas de `gestion_orden` (la de
  rechazos, 959, y la del snapshot, 1046); si se reordenaran, el test saldría rojo, no verde. ML lo pone
  rojo.

## Qué se hizo con el informe (leader)

- **Bloqueante:** aviso corregido — un `vencido` se destraba y luego se aprueba; las tres órdenes de
  Arnel salen con **cualquier** cierre suyo aprobado; para desbloquear a Arnel basta resolver el cierre
  nuevo. Y se redacta una corrección para quienes ya recibieron el aviso.
- **Menores 1, 3 y 4:** encargados al backend en este mismo ciclo.
- **Menor 2:** seguimiento (hoy lo protege el literal de B3).
- **La carrera 412/271:** anotada como modo de flake en memoria; arreglo en ficha aparte.
