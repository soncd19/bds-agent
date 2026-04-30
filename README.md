# Tin mua ban chung cu Ha Noi

Web app nay chay mot server Node.js nho, moi 1 gio quet tin ban can ho chung cu Ha Noi, luu ket qua vao `data/listings.json`, va hien thi tren dashboard.

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

Nguon mac dinh gom trang danh muc Alonhadat va Batdongsan.com.vn cho tin ban can ho chung cu Ha Noi. Batdongsan.com.vn co the tra Cloudflare `HTTP 403` voi mot so URL khi server/container goi truc tiep; khi do lan quet se ghi loi source do va tiep tuc xu ly cac URL/nguon con lai. Neu can du lieu day du/chinh xac hon, nen tich hop API/chinh sach cap phep tu cac san bat dong san, hoac them nguon co cau truc vao `SOURCES` trong `server.js`.

Nut `Quet ngay` goi `POST /api/scan`. Ngoai ra server tu dong quet khi khoi dong va sau do lap lai moi 1 gio.
