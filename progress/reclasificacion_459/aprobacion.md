# 459 — Aprobación humana de la reclasificación de los 203 cobros

- **Quién aprueba:** Carlos (humano del proyecto), en el chat de la sesión del 2026-09-24.
- **Qué dijo:** «Salieron de la cuenta de Ordenex, y si no estoy mal todos para Nuform. Por eso es que nos
  falta poder asociar para saber efectivamente de quién es cada cosa, pero sé que de momento todo eso creo que
  es de Nuform.»
- **Qué se aprueba:** las 203 filas `cobro_manual` del libro de tiendas (todas de la tienda
  `ecf6c289-9799-4558-be6d-ce5f8a12f5cd`, Nuform) pasan a «Pago por cuenta de una tienda», con su egreso de caja
  de terceros en la `fecha_movimiento` de la propia fila. Aprobación GLOBAL de las 203, incluidas las tres marcadas
  `revisar_a_mano` en `candidatos.csv` (abono a la tarjeta, la compra y el IVA de Facebook).
- **Lista:** `lista_aprobada.csv` (= `progress/459_reclasificacion_aprobada.csv`, idéntica byte a byte), sacada de
  producción por el leader: 203 filas, 203 ids distintos, total 25.769.034,50, una sola tienda.
- **Queda ABIERTO y dicho:** el humano no puede confirmar de quién son los servicios tecnológicos (Vercel,
  OpenAI, Atlassian, Incognition, Effisystems y Zadarma, ≈ ₡230 mil). Quedan como de Nuform. Si algún día se
  confirma que alguno era de Ordenex, se corrige con un movimiento NUEVO (nada se borra ni se edita).
- **Quién los registró originalmente:** los 203, por una sola cuenta con rol maestro, entre el 2026-09-08 y el
  2026-09-23, con fechas de movimiento del 2026-08-28 al 2026-09-22. Sin método, referencia ni comprobante:
  la app no tenía dónde anotarlos.
