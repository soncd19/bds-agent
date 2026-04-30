# Tin mua ban bat dong san toan quoc

Web app nay chay mot server Node.js nho, moi 1 gio quet tin ban nha dat, chung cu toan quoc, luu ket qua vao `data/listings.json`, va hien thi tren dashboard.

## Chay ung dung

```powershell
& "C:\Users\caodi\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" server.js
```

Mo trinh duyet tai:

```text
http://localhost:5173
```

## Chay bang Docker Compose

```powershell
docker compose up -d --build
```

Mo trinh duyet tai:

```text
http://localhost:5173
```

Dung container:

```powershell
docker compose down
```

Xem log:

```powershell
docker compose logs -f
```

## Build image Docker thu cong

```powershell
docker build -t bds-agent:latest .
docker run -d --name bds-agent -p 5173:5173 -v ${PWD}\data:/app/data bds-agent:latest
```

## Ghi chu ve nguon du lieu

Nguon mac dinh gom trang danh muc Alonhadat, Mogi.vn va Nha Tot (Chotot) cho tin ban nha dat toan quoc.

Nut `Quet ngay` goi `POST /api/scan`. Ngoai ra server tu dong quet khi khoi dong va sau do lap lai moi 1 gio.
