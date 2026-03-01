# MongoDB Atlas – Connection Checklist

If **register** or **login** returns **500** or **503** and Atlas shows **0 connections**, the app is not reaching MongoDB. Use this checklist.

---

## If you see: `querySrv ECONNREFUSED _mongodb._tcp.cluster0....`

This means **DNS SRV lookup** failed (your network or DNS server is refusing or not answering SRV queries). Try one of these:

### Option A: Use a different DNS (quick test)

Your current DNS may not support SRV records. Test with a public DNS:

- **Windows:** Control Panel → Network and Internet → Network connections → your adapter → Properties → IPv4 → Use “Preferred DNS”: `8.8.8.8` (Google) or `1.1.1.1` (Cloudflare). Save and run the connection test again.
- Or run in PowerShell (as Admin) to flush and use Google DNS for a test:
  ```powershell
  ipconfig /flushdns
  ```
  Then set your Wi‑Fi/Ethernet DNS to 8.8.8.8 temporarily and run `node scripts/test-mongo-connection.js` again.

### Option B: Use the standard connection string (no SRV)

Switch from `mongodb+srv://` to a **standard** URI so Atlas hostnames are used instead of SRV.

1. In **Atlas**: open your cluster → **Connect** → **Connect using MongoDB Compass** (or **Drivers** and look for a non-SRV option).
2. Copy the URI that looks like:
   ```text
   mongodb://USER:PASSWORD@cluster0-shard-00-00.ghjbv.mongodb.net:27017,cluster0-shard-00-01.ghjbv.mongodb.net:27017,cluster0-shard-00-02.ghjbv.mongodb.net:27017/?ssl=true&replicaSet=atlas-xxxxx-shard-0&authSource=admin
   ```
   (Your cluster may show slightly different hostnames; use what Atlas gives you.)
3. Add your **database name** and options: after the `/` that follows the host list, put your DB name, then options, e.g.:
   ```text
   mongodb://USER:PASSWORD@cluster0-shard-00-00.ghjbv.mongodb.net:27017,cluster0-shard-00-01.ghjbv.mongodb.net:27017,cluster0-shard-00-02.ghjbv.mongodb.net:27017/lms-cbt?ssl=true&replicaSet=atlas-xxxxx-shard-0&authSource=admin
   ```
4. In `backend/.env` set:
   ```env
   MONGODB_URI=<that full URI>
   ```
5. Restart the backend and run `node scripts/test-mongo-connection.js` again.

---

## 1. Test the connection from your machine

From the **backend** folder:

```bash
node scripts/test-mongo-connection.js
```

- **Success:** You’ll see `MongoDB connected successfully`.
- **Failure:** You’ll see the error (e.g. timeout, auth failed). Fix the cause below, then run the script again.

## 2. Atlas Network Access (most common cause)

Atlas only accepts connections from IP addresses you allow.

1. In Atlas: **Network Access** (left sidebar).
2. Click **Add IP Address**.
3. Either:
   - Add **your current IP** (recommended), or
   - For quick testing only: **Allow Access from Anywhere** (`0.0.0.0/0`).
4. Save. Wait 1–2 minutes for the change to apply.

If your IP wasn’t listed, connections will time out and you’ll see **0 connections** in the cluster UI.

## 3. Connection string in `.env`

Your `backend/.env` must have a valid `MONGODB_URI`.

- In Atlas: **Database** → **Connect** → **Drivers** (or **Connect your application**).
- Copy the URI and replace `<password>` with the **database user password** (not your Atlas account password).
- Optional: add your database name before the query string, e.g. `mongodb+srv://user:pass@cluster0.xxxxx.mongodb.net/lms-cbt?retryWrites=true&w=majority`.

Example (fake):

```
MONGODB_URI=mongodb+srv://cbtadmin:YOUR_PASSWORD@cluster0.ghjbv.mongodb.net/lms-cbt?retryWrites=true&w=majority
```

- No spaces around `=`.
- Password must be URL-encoded if it contains `@`, `#`, `:`, etc.

## 4. Database user

- **Database Access** → the user used in the URI must exist and have **read and write** (or **atlasAdmin**) on the database you use (e.g. `lms-cbt`).

## 5. Restart the backend

After changing `.env` or Atlas settings:

1. Stop the backend (Ctrl+C).
2. Start it again: `npm run dev`.

If MongoDB connects, you’ll see **MongoDB connected** in the terminal. If not, you’ll see **MongoDB connection failed** and register/login will return 503 (or 500 until the latest error handling is deployed).

## Quick summary

| Atlas shows      | Meaning                    | What to do                          |
|------------------|----------------------------|-------------------------------------|
| 0 connections    | App never connected        | Network Access (IP), URI, restart   |
| Connections > 0  | App is connecting           | If still 500, check logs and user  |

Running `node scripts/test-mongo-connection.js` from the backend folder is the fastest way to confirm that your machine and `.env` can reach Atlas.
