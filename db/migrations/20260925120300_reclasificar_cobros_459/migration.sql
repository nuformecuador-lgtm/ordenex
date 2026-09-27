-- FICHA 459 / T C.4 — RECLASIFICACION DE LOS 203 COBROS QUE ERAN PAGOS POR CUENTA DE NUFORM.
--
-- Aprobada por el humano (Carlos Restrepo) el 2026-09-24: «Salieron de la cuenta de Ordenex, y si no
-- estoy mal todos para Nuform». 203 filas, 25.769.034,50. Constancia en `progress/medicion_457.md`
-- (seccion «Decision del humano sobre los 203») y lista en
-- `progress/reclasificacion_459/lista_aprobada.csv` (copia byte a byte de
-- `progress/459_reclasificacion_aprobada.csv`, commit 6973d3ca de dev). La guardia
-- `tests/unit/guards/reclasificacion-459-lista.guardia.test.ts` exige que la lista de abajo sea
-- EXACTAMENTE esa (ids, montos, numero y suma) y que el down borre esa misma lista (R80, R88).
--
-- QUE HACE: por cada cobro de un costo aprobado, UNA salida de dinero de las tiendas en la caja
-- (`egreso_pago_por_cuenta_tienda`, origen `cobro_manual_reclasificado` -> id del cobro), por el
-- MISMO monto. No modifica ni borra NINGUNA fila: el libro de la tienda queda como esta (R81, R87).
--
-- COMO CASA LAS FILAS: SOLO por id, y cada una se COMPRUEBA contra la base (R82):
--   · el id existe en `wallet_tienda_movimiento`;
--   · es un cobro de un costo: tipo `debito`, categoria `cobro_manual`;
--   · su monto es EXACTAMENTE el de la lista;
--   · es de la tienda aprobada, UNA sola para las 203 (constante `tienda_aprobada`: Nuform en
--     produccion).
-- Si UNA fila no cuadra, la migracion FALLA y no escribe nada.
--
-- FECHAS: la fecha de la lista NO se usa para casar filas. Es solo informativa (el
-- `to_char(fecha_movimiento, 'YYYY-MM-DD')` en UTC con que se saco de produccion) y va como
-- comentario de cada fila. La salida de caja copia el `fecha_movimiento` de la PROPIA fila del
-- cobro en la base: el mismo instante, al microsegundo (R81).
--
-- DONDE NO HAY NADA QUE HACER: en local y en preview ningun id existe -> termina sin escribir nada
-- (R83). Si existen ALGUNOS pero no todos -> falla sin escribir nada (R83).
--
-- IDEMPOTENTE: `ON CONFLICT` sobre `wallet_movimiento_origen_categoria_uq`; aplicada dos veces
-- deja una sola salida por cobro (R85). Al final se cuentan y suman las salidas: si no son 203 por
-- 25.769.034,50, falla (R84). Todo va en UN solo bloque `DO`: o se escribe todo, o nada.
--
-- SIN HISTORIAL: una migracion no tiene actor. El rastro es el origen de cada fila, esta cabecera
-- y la constancia de la aprobacion. Si el humano aprueba mas filas despues: una migracion NUEVA,
-- nunca editar esta (memoria «migracion editada en sitio = drift»).
DO $$
DECLARE
  -- CONTROL-INICIO
  n_esperados CONSTANT integer := 203;
  suma_esperada CONSTANT numeric(14,2) := 25769034.50;
  tienda_aprobada CONSTANT text := 'ecf6c289-9799-4558-be6d-ce5f8a12f5cd';
  -- CONTROL-FIN
  n_lista integer;
  suma_lista numeric(14,2);
  n_presentes integer;
  n_escritas integer;
  suma_escrita numeric(14,2);
BEGIN
  DROP TABLE IF EXISTS pg_temp.aprobados_459;
  CREATE TEMP TABLE aprobados_459 (id text PRIMARY KEY, monto numeric(12,2) NOT NULL) ON COMMIT DROP;

  INSERT INTO aprobados_459 (id, monto) VALUES
  -- LISTA-INICIO
    ('c83dc79f-4867-436d-aff7-3f7bb09d6e70', 86415.60),  -- 2026-08-28
    ('486bbd94-6732-470a-8ab3-6fe4f9bdc1ea', 11233.20),  -- 2026-08-28
    ('1ff6cff3-cadb-4799-b30d-8982efdcc5d7', 56900.00),  -- 2026-08-28
    ('102c95a4-d4a0-4f51-bddf-25a2f7880a99', 402766.80),  -- 2026-08-28
    ('2fb79720-3fee-44bd-95d7-29c373e49a00', 52361.80),  -- 2026-08-28
    ('3ec83fcd-23c1-4882-93dc-ac3ede815a47', 368800.40),  -- 2026-08-28
    ('aa4bb2b6-75b8-4cb4-811e-361794e40c4e', 47945.80),  -- 2026-08-28
    ('cbe52441-a78c-4b31-99c8-c4a63b927916', 141670.00),  -- 2026-08-28
    ('48d387f4-c128-4d2e-8056-b12e0d846ef7', 400000.00),  -- 2026-08-28
    ('5a145856-effe-445b-94d2-b3a446f2c333', 143486.00),  -- 2026-08-28
    ('7c3e0a83-d660-471b-9788-efb1e82b5389', 1000000.00),  -- 2026-08-28
    ('b5450990-6608-4df4-ad0a-d0d750c3e4dc', 1000000.00),  -- 2026-08-28
    ('80f31c20-c2bc-42bd-969c-e62b0c4844b0', 251100.00),  -- 2026-08-28
    ('2f702d02-a6ed-447e-a8e3-b46a37ba8c26', 224468.00),  -- 2026-08-28
    ('1c9a4189-3948-47d6-87f6-39ee9d90a502', 113894.00),  -- 2026-08-28
    ('70cb39d0-34ad-4b93-b6b8-f9beeaeef7a2', 80808.00),  -- 2026-08-28
    ('b658ed9e-d518-4585-bda4-6ca176d4a90c', 113864.00),  -- 2026-08-28
    ('e72a31e2-cf52-496c-8386-aaba1dd777ac', 409390.80),  -- 2026-08-28
    ('cd076ac3-2e11-4195-b1c0-7d41936e3fef', 53222.00),  -- 2026-08-28
    ('dd57da9f-4787-46d6-8547-21b041669dbc', 8280.00),  -- 2026-08-29
    ('d455bb83-9a89-4f77-b3a1-0d1be4d8c84d', 14628.00),  -- 2026-08-29
    ('58c81a0f-38ae-4e84-a654-0acbf2fb829d', 1899.80),  -- 2026-08-29
    ('e02b71ca-3808-4842-a58f-ff9c56c6355f', 11500.00),  -- 2026-08-30
    ('5c938400-8feb-42f7-bfbb-3cebc87bda10', 58544.20),  -- 2026-08-30
    ('4aae4731-2d04-4f56-ac5f-08af3f882273', 256634.00),  -- 2026-08-30
    ('39415571-0206-4b43-af34-0068ee4b6849', 33363.80),  -- 2026-08-30
    ('c1597e67-34a2-4145-9bf3-27cc35823c76', 106145.00),  -- 2026-08-31
    ('c50f8473-f388-40c9-a84b-4b9b7b6b4a09', 13800.00),  -- 2026-08-31
    ('c9199ab1-f1d9-436c-9423-4417918a706d', 4885.20),  -- 2026-08-31
    ('03976c33-3883-48fe-9ad1-d88e8f413813', 634.80),  -- 2026-08-31
    ('14af224f-ac86-4323-94a5-d3a711cb45c0', 2571.40),  -- 2026-08-31
    ('a9c52417-d895-4cda-8f26-e36d3bd58026', 340.40),  -- 2026-08-31
    ('bd9e6971-ecd8-4486-bec6-7ea09beed446', 19191.20),  -- 2026-08-31
    ('9ec4194f-5869-47ba-8aaa-0e185590e954', 2493.20),  -- 2026-08-31
    ('e5df1910-c9fa-4e91-8b2e-c6a1fbfee305', 814029.80),  -- 2026-08-31
    ('3644b56d-4177-466c-9877-d0f531eab7b9', 553288.00),  -- 2026-08-31
    ('cdb140c6-23de-46cf-85d6-6cfeba95fbe9', 58544.20),  -- 2026-08-31
    ('6ac95be1-c672-4657-a1ff-9bd7a7427e38', 26946.80),  -- 2026-08-31
    ('457b2f70-5a89-4729-a573-cf71339f9c8e', 3505.20),  -- 2026-08-31
    ('51848bf5-d54b-480d-87aa-646defae3bc0', 29440.00),  -- 2026-08-31
    ('c2b6780f-115d-43d6-ab7f-c1dba459cad1', 1371.00),  -- 2026-08-31
    ('c73c822d-c4a6-4b90-9c34-19edd4f5c69b', 185000.00),  -- 2026-08-31
    ('c129bb57-44d3-4757-b939-b934d0835f60', 1371.00),  -- 2026-08-31
    ('655b2434-971b-4179-9c90-7d4a71d02732', 146698.60),  -- 2026-09-01
    ('8bb8327c-3a0d-4ec3-8d16-f4f20e16373a', 19071.60),  -- 2026-09-01
    ('a92e1c5f-cd0a-4fd3-805d-88582723e527', 1964.20),  -- 2026-09-01
    ('2e56ccb1-e932-48c2-bfc7-bf12dfe89e53', 2042.20),  -- 2026-09-01
    ('f90e6067-fce4-4bfc-9417-123105ae642c', 330234.00),  -- 2026-09-01
    ('b1522a17-2f2a-4b3e-ae50-ca631e3e582d', 496.80),  -- 2026-09-01
    ('bb891b27-809f-4b29-a583-dfd45aa8c620', 13041.00),  -- 2026-09-01
    ('b0ab31b9-b461-4564-82ed-bf3d7b40807c', 15916.00),  -- 2026-09-01
    ('870a4b55-ff63-4a02-a29b-14895fc76ef5', 132130.40),  -- 2026-09-01
    ('e6414e6c-d14a-4b66-aa7d-782c7c577ff6', 87294.20),  -- 2026-09-01
    ('92413ab8-2445-408e-94fb-4c88c1b86bbc', 143202.60),  -- 2026-09-01
    ('df5970cd-1fee-4638-a452-cb6c029f19ea', 27393.00),  -- 2026-09-02
    ('e67feac7-778d-46fd-90bc-1fac593e4a21', 18616.20),  -- 2026-09-02
    ('3bf6c794-23e6-4bda-9081-7fd1b84bc2c2', 37232.40),  -- 2026-09-02
    ('72164fe1-9307-487d-b45f-60142d6e7fda', 5078.40),  -- 2026-09-02
    ('190e1a4d-1635-4dab-ba9d-e75691f2486a', 7272.60),  -- 2026-09-02
    ('68a75409-0099-474c-a28d-c10674267be4', 39081.60),  -- 2026-09-02
    ('77060165-c309-4930-8a12-31e0dbda0938', 55949.80),  -- 2026-09-02
    ('b6a34072-c289-405f-9470-cd63f11ef0ad', 210721.40),  -- 2026-09-02
    ('e83a2039-94f2-47d9-935e-55deb008c7e2', 286414.40),  -- 2026-09-02
    ('dcc7f181-2eed-4a09-8ec5-7c1d863d548f', 40505.00),  -- 2026-09-02
    ('f37674a1-c76c-482d-9aff-59981677e1ea', 56520.00),  -- 2026-09-02
    ('ea08befe-ab61-4233-915e-0cc89670d05a', 108000.00),  -- 2026-09-02
    ('e2c5fa16-491e-4ebd-b2c1-8a08bed5d7d4', 200000.00),  -- 2026-09-02
    ('c0419465-b9f6-4dfb-bbe1-cba8da197675', 131987.80),  -- 2026-09-03
    ('26c80456-a42e-449d-9169-fe06cfd17f5c', 17158.00),  -- 2026-09-03
    ('8ed273f2-e704-4922-b91c-7c0824ab4f0f', 6624.00),  -- 2026-09-03
    ('da60362a-b40e-471b-9d2c-5f231fb8c09a', 860.20),  -- 2026-09-03
    ('d2945159-de9e-4437-a6ca-52ca37034c1d', 13353.80),  -- 2026-09-04
    ('abfe034c-6ca2-49ce-9a83-310468f3f3cf', 1734.20),  -- 2026-09-04
    ('1eb92e4c-6e78-44d9-84ca-74acf7c19878', 25295.40),  -- 2026-09-04
    ('87795951-a9ea-4fd4-821f-be0fac6217d1', 167637.80),  -- 2026-09-04
    ('598b1427-1fc8-4b38-9653-5843bd4311d0', 200000.00),  -- 2026-09-04
    ('dc2e5e82-bf46-40d4-a2ac-6eeb6d7c4d1d', 61460.60),  -- 2026-09-05
    ('b66e0d9b-02e1-4ccd-9359-c486ee084367', 637813.00),  -- 2026-09-06
    ('08a40821-b8da-4b4d-859d-94374e65fe47', 82915.00),  -- 2026-09-06
    ('5d16b8f9-b41f-4d2b-8e53-8d8f3f647d46', 17075.20),  -- 2026-09-06
    ('14d1a005-1614-4300-b8fd-f78c133c597b', 2221.80),  -- 2026-09-06
    ('14f34e0e-8b34-48fc-8302-eae9263eb9bd', 235989.20),  -- 2026-09-07
    ('d925ca7d-f5d7-4f2e-aed9-6071c6121da9', 30677.40),  -- 2026-09-07
    ('bee15d85-4e16-4b82-9e7f-ac7ffe7a58f7', 17797.40),  -- 2026-09-07
    ('dd8d6ccc-bacd-4543-badb-ef20b8a3f4e3', 2589.80),  -- 2026-09-07
    ('c6ec8e02-b3e2-4394-8433-ce8070c949af', 4600.00),  -- 2026-09-07
    ('945d8613-52ac-4a4e-b524-67c01332c66d', 23000.00),  -- 2026-09-07
    ('d034f20e-1a3f-4a71-aa75-cb451181eca1', 41602.40),  -- 2026-09-08
    ('6edbef46-c38d-4375-8805-7fa7e0a2b158', 5408.31),  -- 2026-09-08
    ('7ef1529b-c0ab-471d-8611-dd3795da3bcc', 3313.25),  -- 2026-09-08
    ('acea62ac-770d-4cba-ac48-d0ac1e8f4886', 263000.00),  -- 2026-09-08
    ('44cf93fc-5184-4c49-9ea2-95e633592d53', 110279.57),  -- 2026-09-09
    ('ce1c36bf-695e-46c9-92f5-64840b82c32c', 143406.52),  -- 2026-09-09
    ('378bbe27-0aec-41fd-a556-68bac056dbcd', 18642.84),  -- 2026-09-09
    ('a60f02ba-f6b4-4e49-bac0-0cb791a4863e', 53189.80),  -- 2026-09-09
    ('8ae254a8-9a7b-4ce5-8597-d97f910deba4', 6913.80),  -- 2026-09-09
    ('e5295e10-262e-4ecd-8190-0735fe55c9aa', 10943.40),  -- 2026-09-09
    ('e474aa86-47a4-47f0-a391-f15684415bc6', 392700.00),  -- 2026-09-10
    ('0961dd8a-13aa-40c6-9972-aa23e2eecc5f', 26827.20),  -- 2026-09-10
    ('4f3e6924-6800-4a5d-8f69-a14446c3be23', 3486.80),  -- 2026-09-10
    ('3d3a7333-9fb7-4921-a0da-150efeac9ad4', 20644.80),  -- 2026-09-10
    ('759adaf7-d35e-46af-a0af-47488447aa44', 2683.82),  -- 2026-09-10
    ('fb86190a-44e1-4886-b622-bcacf90c238c', 147550.00),  -- 2026-09-11
    ('2e314158-031c-4128-86ea-0616076ccc8e', 330652.60),  -- 2026-09-11
    ('c1df29a6-9286-4690-9a9b-02a9772ff63f', 330652.60),  -- 2026-09-11
    ('7f416d96-832a-4203-9c1a-2027f49b23c6', 810409.60),  -- 2026-09-11
    ('51b5393b-fd70-4b79-bcad-f0fc14f4c752', 105353.48),  -- 2026-09-11
    ('25651952-b35c-4d6d-8f71-4e9ce771c6b0', 370042.40),  -- 2026-09-11
    ('c6c4af51-d5dd-4629-b410-84e5b6535f74', 48105.51),  -- 2026-09-11
    ('bc706904-0edd-41cd-8efa-71704e074e4a', 453000.00),  -- 2026-09-12
    ('f93d2af1-f380-4567-8430-7c109eb35ae6', 2840.25),  -- 2026-09-12
    ('3130da62-b3c6-4306-bc98-bc16dec9b2fd', 31684.80),  -- 2026-09-12
    ('95e56435-f443-4627-826d-844fd796f630', 4117.00),  -- 2026-09-12
    ('83ae1b12-92af-4c1b-b374-ca8ea2fd3b97', 158755.20),  -- 2026-09-12
    ('1d7fd419-2085-4ffe-99e1-cfe1d9414a7d', 20640.20),  -- 2026-09-12
    ('01da864c-4d64-4e80-ae08-ca943ef9be07', 24683.60),  -- 2026-09-12
    ('091ce6f3-30c2-4ec5-980c-c406aa187d3d', 11500.00),  -- 2026-09-12
    ('7823d0af-35f8-4839-b036-c196db1d76f4', 825391.80),  -- 2026-09-12
    ('73bf0e13-ad4a-460d-b611-b417f48baebd', 107300.93),  -- 2026-09-12
    ('1b4e9c52-cbc1-491c-a9eb-fa43800f6007', 14835.00),  -- 2026-09-12
    ('e2f5d9f6-7b66-469a-a537-44c7e9277075', 1927.40),  -- 2026-09-12
    ('a150750e-1457-498b-86f7-7958f69a993b', 151565.40),  -- 2026-09-12
    ('875b4550-9243-4d48-b493-e2d5c05027bf', 19701.80),  -- 2026-09-12
    ('b7f55a7f-afa2-4a34-9917-adb8d72c3490', 111784.60),  -- 2026-09-12
    ('8f792b0c-88b8-4e4f-a01b-24f367deb625', 14531.40),  -- 2026-09-12
    ('cb236d5a-10ff-42e0-99ed-d2298c085574', 370847.40),  -- 2026-09-13
    ('7b787749-eeee-43ea-bb8b-55bb8e26afa6', 48210.16),  -- 2026-09-13
    ('33ff1806-5a01-45f3-9c98-9f294f828c8c', 208472.00),  -- 2026-09-13
    ('989a027c-b3aa-48ce-882c-3b1d9f763ae7', 27101.36),  -- 2026-09-13
    ('12123ed4-571f-4766-9c71-c32883e82c87', 33511.00),  -- 2026-09-13
    ('aa5a027a-93c3-4aeb-a4ff-d78bfad1005c', 4356.20),  -- 2026-09-13
    ('114b27a7-96d7-4374-9bd6-7f88eb8b7a99', 139209.80),  -- 2026-09-13
    ('320b54c6-1b29-4e86-9dc1-94089cf572ce', 18096.40),  -- 2026-09-13
    ('432bc8c0-9364-4c32-86ce-293feb9d7270', 143486.00),  -- 2026-09-14
    ('240893a8-bef4-4ee7-8232-b63c063b5b20', 983485.00),  -- 2026-09-14
    ('ece9947f-37f1-4a01-b73e-a4bd4bec086b', 983485.00),  -- 2026-09-14
    ('f48e637a-b0ee-4765-ab6e-4c9efc00130e', 251100.00),  -- 2026-09-14
    ('314e9a59-20ca-4c0b-98c2-898c9924b2f4', 224468.00),  -- 2026-09-14
    ('0d5b89c1-8cdf-4b26-ab14-e1fe7708739b', 113894.00),  -- 2026-09-14
    ('754e0c14-6525-44b8-bf72-33ba95166ecf', 80808.00),  -- 2026-09-14
    ('6c705a4d-2f1c-4ef5-957a-c17c26a61d06', 85800.05),  -- 2026-09-14
    ('d736c476-2de1-47a4-ab94-e07d8e6d2d0d', 46000.00),  -- 2026-09-14
    ('2f1a820f-17a3-4a98-afb1-810eff33c662', 5980.00),  -- 2026-09-14
    ('21adf984-6604-4eec-8ffe-3b0dd10ca7e1', 3192.40),  -- 2026-09-14
    ('f4c13355-f7d0-43a7-b2a8-d6c091c28201', 414.00),  -- 2026-09-14
    ('14f1c71b-916f-4435-8b20-cba2a0400451', 13358.40),  -- 2026-09-14
    ('f509f387-b449-4436-b24a-d3c262c04c16', 1738.80),  -- 2026-09-14
    ('97eb168c-acae-4ba5-afe8-7c144270e270', 220765.57),  -- 2026-09-14
    ('a228a139-b837-4e59-b61c-4edba6a52839', 28699.52),  -- 2026-09-14
    ('fdbb8b1b-abc3-49ea-ac17-1822bba36fce', 53550.00),  -- 2026-09-16
    ('0d002063-48b8-404d-8af6-911a694133a4', 1359.00),  -- 2026-09-16
    ('7aa4c5f8-0151-451d-b53d-51d088dca38f', 35200.00),  -- 2026-09-16
    ('f5b8bde2-7bd4-4ff8-963b-deed4179ba90', 1359.00),  -- 2026-09-16
    ('3cf16b6d-afea-4067-a8b7-6ab747ed9717', 185000.00),  -- 2026-09-16
    ('a9c24cc7-bedf-4dde-9f8c-eb0b13d3f869', 1359.00),  -- 2026-09-16
    ('5a7eee86-70e0-4c22-ada9-2a26705f2bf8', 19932.00),  -- 2026-09-16
    ('873894a5-7d8f-4d24-90c9-fe95405d466f', 1359.00),  -- 2026-09-16
    ('7aa88e7d-3ee5-4d8a-9891-3f077bb6fa8f', 218371.20),  -- 2026-09-16
    ('e7aeb8bb-67b1-48ab-8d3f-1e12512cfb5f', 212391.20),  -- 2026-09-16
    ('5fa7d43f-3fac-49f3-a928-9f6e23d6e91a', 44886.80),  -- 2026-09-16
    ('cd345a06-3341-4927-8b69-ec008c49f7da', 5837.40),  -- 2026-09-16
    ('1ba0a171-004b-4e96-aaec-cf5adbe15335', 41032.00),  -- 2026-09-16
    ('6fd6be34-b689-47b3-9791-59bfd2b08f20', 5336.00),  -- 2026-09-16
    ('1f18228c-9364-48c6-9f8b-ee33d0c037de', 13585.47),  -- 2026-09-17
    ('488a08f6-7b01-4840-8002-094556a86163', 30618.27),  -- 2026-09-17
    ('534cacee-c130-4826-b333-93946a6715c7', 3980.38),  -- 2026-09-17
    ('3aac44e7-86dc-43e1-af9b-29111a39f477', 11325.00),  -- 2026-09-17
    ('330db68b-582d-406a-9f50-3275c498b10c', 1472.25),  -- 2026-09-17
    ('71de2dd2-4af3-4124-87da-3e9f9c1622ff', 147107.22),  -- 2026-09-17
    ('c331e35c-5cf8-4a56-ba78-f59f40b66bf2', 19123.94),  -- 2026-09-17
    ('639c9700-6a39-4817-acb4-b3463834f227', 146935.08),  -- 2026-09-17
    ('d9679684-9bb1-41a3-8807-858833131136', 634.20),  -- 2026-09-17
    ('31a27a09-cf5a-49a7-aa71-8bddb5b5f60f', 82.45),  -- 2026-09-17
    ('19860b9e-b837-4aac-ae0b-1417c067ff44', 147904.50),  -- 2026-09-17
    ('6e0c292e-3bc1-4de0-a08b-964fd18c5d20', 19227.59),  -- 2026-09-17
    ('3aec6320-99f4-468a-882f-d8c2147296b4', 555010.46),  -- 2026-09-17
    ('f07f42d2-5394-45dc-b4f5-64d71900fdb2', 149311.40),  -- 2026-09-19
    ('df22779f-fd54-4fc2-bbcf-1ee8ee37caed', 223477.20),  -- 2026-09-19
    ('56361e79-913f-453c-ab15-c2f95336292d', 148708.80),  -- 2026-09-19
    ('00422c60-4d61-416a-8b6c-e9a1492b66bb', 19412.00),  -- 2026-09-19
    ('480f0c9d-8cb1-4977-b1b1-bc7d314b8078', 29053.60),  -- 2026-09-19
    ('eff07e9d-f2ba-433b-aac1-de2ffd21639f', 19033.80),  -- 2026-09-19
    ('dbf3c80d-839c-471f-a4f7-214ee52ca1f6', 237560.04),  -- 2026-09-19
    ('ad611431-8d75-4694-bc7e-52abcbfc2ffd', 29364.00),  -- 2026-09-19
    ('8eec9148-9dfa-459e-a751-daac7b1a9751', 216140.32),  -- 2026-09-19
    ('4567bdaa-27f7-4f9a-98f3-196388a2211a', 216140.31),  -- 2026-09-19
    ('e84f3f32-bc0a-459d-949e-d4547e5d0e29', 28098.24),  -- 2026-09-19
    ('79ef5393-be86-4bf7-83c8-2fe03d64e6b4', 219130.54),  -- 2026-09-19
    ('9e235b5e-4a09-4144-abd2-789f3d5089cf', 19358.56),  -- 2026-09-19
    ('8d8fbc5d-38e8-41c3-978c-99579c3b6f3b', 145447.98),  -- 2026-09-19
    ('b2c22f81-c358-409c-bc17-505d616378ca', 11527.06),  -- 2026-09-19
    ('585789e4-d2e0-4034-b748-a4945d6fa740', 185000.00),  -- 2026-09-20
    ('672a58d7-4ddc-4e41-a05e-df532db183f0', 1362.00),  -- 2026-09-20
    ('2b612995-06fe-4cc8-8a34-fc5bbc6cc57c', 64014.00),  -- 2026-09-20
    ('d924edc5-5256-48f0-8e5e-d561d5e83a72', 59269.70),  -- 2026-09-20
    ('741cadaa-1926-4498-af6b-f1d49202efbe', 4031.52),  -- 2026-09-20
    ('c16234f2-1753-4f21-954f-ce4c51b0fa57', 4580.86),  -- 2026-09-20
    ('2adfb340-b083-4243-bb1c-d7a30405f8e4', 81.72),  -- 2026-09-20
    ('7d9b1f68-14b3-4a50-9896-e393358b1f47', 560558.34),  -- 2026-09-20
    ('e3ab6569-923c-4337-bf5e-e39deeae527d', 72871.54),  -- 2026-09-20
    ('3ce5c253-7b74-493d-90b6-cf0848b3f027', 149711.04),  -- 2026-09-20
    ('bdaf7117-bc44-4372-9c4e-0fc2785e3b84', 19462.98),  -- 2026-09-20
    ('5690721a-7584-4f3e-ace1-a5097414e63d', 943400.00)  -- 2026-09-22
  -- LISTA-FIN
  ;

  -- La lista misma, contra su suma de control: una fila tocada a mano aqui no pasa.
  SELECT count(*), COALESCE(sum(monto), 0) INTO n_lista, suma_lista FROM aprobados_459;
  IF n_lista <> n_esperados OR suma_lista <> suma_esperada THEN
    RAISE EXCEPTION 'reclasificacion 459: la lista tiene % filas por %, se esperaban % por %',
      n_lista, suma_lista, n_esperados, suma_esperada;
  END IF;

  SELECT count(*) INTO n_presentes
  FROM aprobados_459 a JOIN wallet_tienda_movimiento m ON m.id = a.id;

  IF n_presentes = 0 THEN
    RAISE NOTICE 'reclasificacion 459: ningun cobro de la lista existe en esta base; no se escribe nada';
    RETURN;                                                                              -- R83
  END IF;
  IF n_presentes <> n_esperados THEN
    RAISE EXCEPTION 'reclasificacion 459: existen % de % cobros aprobados', n_presentes, n_esperados;  -- R83
  END IF;
  IF EXISTS (
    SELECT 1 FROM aprobados_459 a JOIN wallet_tienda_movimiento m ON m.id = a.id
    WHERE m.categoria::text <> 'cobro_manual'
       OR m.tipo::text <> 'debito'
       OR m.tienda_id <> tienda_aprobada
       OR m.monto <> a.monto
  ) THEN
    RAISE EXCEPTION 'reclasificacion 459: algun cobro no coincide en tipo, categoria, tienda o monto';  -- R82
  END IF;

  INSERT INTO wallet_movimiento
    (id, tipo, categoria, monto, origen_tipo, origen_id, descripcion, registrado_por, fecha_movimiento, created_at)
  SELECT gen_random_uuid()::text,
         'egreso',
         'egreso_pago_por_cuenta_tienda',
         m.monto,
         'cobro_manual_reclasificado',
         m.id,
         -- «{Tienda} · {descripcion del cobro}»: el nombre como lo compone el resto de la caja
         -- (nombre + primer apellido, `etiquetaDePersona`), sin ningun id (R100).
         concat_ws(' · ', NULLIF(btrim(concat_ws(' ', u.nombre, u.primer_apellido)), ''), m.descripcion),
         m.registrado_por,
         m.fecha_movimiento,                                                             -- R81
         CURRENT_TIMESTAMP
  FROM aprobados_459 a
  JOIN wallet_tienda_movimiento m ON m.id = a.id
  JOIN usuario u ON u.id = m.tienda_id
  ON CONFLICT ("origen_tipo", "origen_id", "categoria") WHERE "origen_id" IS NOT NULL DO NOTHING;  -- R85

  SELECT count(*), COALESCE(sum(w.monto), 0) INTO n_escritas, suma_escrita
  FROM wallet_movimiento w JOIN aprobados_459 a ON a.id = w.origen_id
  WHERE w.origen_tipo::text = 'cobro_manual_reclasificado'
    AND w.categoria::text = 'egreso_pago_por_cuenta_tienda';
  IF n_escritas <> n_esperados OR suma_escrita <> suma_esperada THEN
    RAISE EXCEPTION 'reclasificacion 459: escritas % por %, esperadas % por %',
      n_escritas, suma_escrita, n_esperados, suma_esperada;                              -- R84
  END IF;
END $$;
