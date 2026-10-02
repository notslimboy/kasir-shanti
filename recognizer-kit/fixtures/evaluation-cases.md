# Evaluation Cases

Use these synthetic cases to compare a target AI before it processes real
orders. The menu names below are treated as today's menu. Chat input and CSV
values stay Indonesian; the expectations are written in English.

## Case 1: Separate Kitchen Note From Send Note

**Input**

```text
Kirana 4, 20/07/2026 05.20
Tahu Kocek 1 pedas sedang
Tahu Kocek 1 pedas dikit tanpa kubis
Kirim ke Direktorat ITS
```

**Key expectation**

```csv
customer,chatDate,payment,ongkir,item,quantity,harga,note,sendNote
Kirana 4,20/07/2026 05.20.00,,0,Tahu Kocek,1,,pedas sedang,kirim ke Direktorat ITS
Kirana 4,20/07/2026 05.20.00,,0,Tahu Kocek,1,,pedas dikit tanpa kubis,kirim ke Direktorat ITS
```

The two variations must not be merged. `Kirim ke Direktorat ITS` must not enter
`note`.

## Case 2: Pickup Is a Send Note

**Input**

```text
Raka 22, 20/07/2026 06.10
Buntil 2
Kolak 1
Diambil gojek
```

**Key expectation**

```csv
customer,chatDate,payment,ongkir,item,quantity,harga,note,sendNote
Raka 22,20/07/2026 06.10.00,,0,Buntil,2,,,diambil gojek
Raka 22,20/07/2026 06.10.00,,0,Kolak,1,,,diambil gojek
```

## Case 3: A Package Suffix Is Not a Quantity

**Today's menu**: `Sate Usus / 3`

**Input**

```text
Sari 8, 20/07/2026 06.30
Sate usus 2
```

**Key expectation**

```csv
customer,chatDate,payment,ongkir,item,quantity,harga,note,sendNote
Sari 8,20/07/2026 06.30.00,,0,Sate Usus / 3,2,,,
```

Quantity stays `2`, not `6`; the `/ 3` suffix must be preserved in the item
name.

## Case 4: An Addition Is Not a Duplicate

**Input**

```text
Nara 11, 20/07/2026 05.40
Kolak 1

Nara 11, 20/07/2026 06.00
Tambah kolak 2
```

**Key expectation**

```csv
customer,chatDate,payment,ongkir,item,quantity,harga,note,sendNote
Nara 11,20/07/2026 06.00.00,,0,Kolak,3,,,
```

The merged order timestamp uses the latest addition message.

## Case 5: A Resend Must Not Double

**Input**

```text
Reni 5, 20/07/2026 05.40
Pepes Bandeng 1

Reni 5, 20/07/2026 06.00
Pepes Bandeng 1
```

**Key expectation**: exactly one `Pepes Bandeng` row with quantity `1`, using
timestamp `20/07/2026 06.00.00`.

## Case 6: CSV Ordering

An order at `20/07/2026 19.10` must sit above an order at
`21/07/2026 05.30`. Never sort by customer name or by screenshot position.
