# Deploy σε δικό σας Linux server (χωρίς Railway)

Αυτός ο οδηγός καλύπτει ένα τυπικό Ubuntu/Debian VPS ή on-prem server. Το backend
είναι ένα απλό Node.js/Express app — δεν χρειάζεται database, containers, ή κάτι
εξωτικό.

---

## 1) Απαιτήσεις

| Τι | Ελάχιστη έκδοση | Έλεγχος |
|---|---|---|
| Node.js | 18 LTS ή νεότερο | `node -v` |
| npm | έρχεται με το Node | `npm -v` |
| RAM | 512MB αρκούν (το `programs.json` είναι ~5MB, φορτώνεται μία φορά στη μνήμη) | — |
| Ανοιχτή θύρα | οποιαδήποτε (π.χ. 3000) πίσω από reverse proxy | — |

Αν δεν υπάρχει Node.js εγκατεστημένο:
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

---

## 2) Πάρε τον κώδικα στο server

**Επιλογή Α — από GitHub (προτεινόμενο, επιτρέπει μελλοντικά `git pull` για updates):**
```bash
cd /opt
sudo git clone https://github.com/antoniosxiaomi8pro-source/search-ekpa.git
cd search-ekpa
```

**Επιλογή Β — upload του zip:**
Ανέβασε το zip (π.χ. με `scp` ή `sftp`) και κάνε unzip στο `/opt/search-ekpa`.

---

## 3) Εγκατάσταση + ρύθμιση

```bash
cd /opt/search-ekpa
npm install --omit=dev
cp .env.example .env
nano .env
```

Μέσα στο `.env`, βάλε πραγματικές τιμές (δες και `API-KEY-SETUP.md` για το πώς
αποκτάς το `ANTHROPIC_API_KEY`):

```
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
ALLOWED_ORIGINS=https://elearningekpa.gr,https://www.elearningekpa.gr
ADMIN_TOKEN=<κάτι-μεγάλο-και-τυχαίο, π.χ. openssl rand -hex 24>
DATA_DIR=/var/lib/ekpa-smart-finder
```

- `ALLOWED_ORIGINS`: μόνο τα **άλλα** sites που καλούν το API (το GTM widget στο
  elearningekpa.gr). Οι σελίδες του ίδιου του backend (`index.html`, admin panel)
  επιτρέπονται αυτόματα — δεν χρειάζεται να προσθέσετε το `search-api...` URL.
- `DATA_DIR`: εκεί γράφονται τα αρχεία που αλλάζουν στη λειτουργία (`concepts.json`
  από το admin panel, `analytics.json`). Είναι **εκτός** του φακέλου του κώδικα, ώστε
  το `git pull` (βήμα 9) να μη συγκρούεται ποτέ με αλλαγές του admin. Δημιούργησέ τον
  με δικαιώματα για τον χρήστη που τρέχει το app:

```bash
sudo mkdir -p /var/lib/ekpa-smart-finder
sudo chown www-data:www-data /var/lib/ekpa-smart-finder   # ή τον χρήστη του pm2
```

Στο πρώτο ξεκίνημα, το `public/concepts.json` αντιγράφεται αυτόματα εκεί.

**ΜΗΝ** ορίσεις `PORT` χειροκίνητα εκτός αν το nginx config σου (βήμα 6) περιμένει
συγκεκριμένη τιμή — απλά διάλεξε μία (π.χ. 3000) και χρησιμοποίησε την ίδια και στα
δύο σημεία.

```
PORT=3000
```

---

## 4) Δοκιμή πριν το process manager

```bash
node server/server.js
```

Πρέπει να δεις: `EKPA Smart Finder backend listening on http://localhost:3000` και
τη γραμμή `Data: concepts=/var/lib/ekpa-smart-finder/concepts.json ...`.
Σε άλλο terminal:
```bash
curl http://localhost:3000/health
# -> {"ok":true,"programs":702}
```

Αν δουλεύει, `Ctrl+C` και προχώρα στο process manager — δεν θέλουμε το app να
πεθαίνει όταν κλείσει το terminal ή όταν κάνει reboot ο server.

---

## 5) Process manager: pm2 (προτεινόμενο)

Το `pm2` κρατάει το app ζωντανό, το ξανακινάει αν κρασάρει, και το ξεκινάει
αυτόματα σε κάθε reboot.

```bash
sudo npm install -g pm2
cd /opt/search-ekpa
pm2 start server/server.js --name ekpa-smart-finder
pm2 save
pm2 startup   # εκτελεί την εντολή που θα σου τυπώσει, ώστε να ξεκινάει σε reboot
```

Χρήσιμες εντολές:
```bash
pm2 status                       # κατάσταση
pm2 logs ekpa-smart-finder       # live logs
pm2 restart ekpa-smart-finder    # restart (π.χ. μετά από αλλαγή .env)
```

**Εναλλακτικά — systemd** (αν προτιμάς το native tool του Linux αντί για pm2):
```ini
# /etc/systemd/system/ekpa-smart-finder.service
[Unit]
Description=EKPA Smart Finder backend
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/search-ekpa
ExecStart=/usr/bin/node server/server.js
Restart=on-failure
EnvironmentFile=/opt/search-ekpa/.env
User=www-data

[Install]
WantedBy=multi-user.target
```
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now ekpa-smart-finder
sudo systemctl status ekpa-smart-finder
```

---

## 6) Reverse proxy (nginx) + HTTPS

Το Node app δεν πρέπει να είναι απευθείας εκτεθειμένο στο internet — βάλε nginx
μπροστά του για HTTPS και σωστά headers. (Η συμπίεση gzip γίνεται ήδη από το ίδιο το
app — δεν χρειάζεται ρύθμιση `gzip` στο nginx.)

> ⚠️ Κράτα το `proxy_set_header Host $host;` — το app το χρησιμοποιεί για να
> αναγνωρίζει τα αιτήματα από τις δικές του σελίδες (same-origin CORS). Αν για κάποιο
> λόγο δεν μπορεί να περάσει το σωστό Host, όρισε `PUBLIC_BASE_URL=https://search-api.elearningekpa.gr`.

```nginx
# /etc/nginx/sites-available/ekpa-smart-finder
server {
    listen 80;
    server_name search-api.elearningekpa.gr;   # ή όποιο subdomain διαλέξετε

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
```bash
sudo ln -s /etc/nginx/sites-available/ekpa-smart-finder /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

**HTTPS με Let's Encrypt (δωρεάν, αυτόματη ανανέωση):**
```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d search-api.elearningekpa.gr
```
Το certbot ενημερώνει αυτόματα το nginx config για HTTPS και ρυθμίζει
αυτόματη ανανέωση πιστοποιητικού.

> ⚠️ **Σημαντικό:** ο κώδικας διαβάζει `req.ip` για rate limiting. Πίσω από nginx
> reverse proxy, πρόσθεσε στο `server.js` (αν δεν υπάρχει ήδη) `app.set("trust
> proxy", 1)` ώστε να διαβάζει το πραγματικό IP του χρήστη από το
> `X-Forwarded-For` και όχι το IP του ίδιου του nginx για όλους. Αυτό υπάρχει ήδη
> στον τρέχοντα κώδικα (προστέθηκε μαζί με το rate limiting), άρα δεν χρειάζεται
> επιπλέον αλλαγή.

---

## 7) Firewall

```bash
sudo ufw allow 'Nginx Full'   # 80 + 443
sudo ufw deny 3000            # η θύρα του Node ΔΕΝ πρέπει να είναι δημόσια προσβάσιμη απευθείας
```

---

## 8) Ενημέρωσε το GTM widget

Στο GTM Variable `EKPA Backend URL` (βλ. `GTMREADME.md`), άλλαξε την τιμή από το
Railway URL στο νέο σας URL:
```
https://search-api.elearningekpa.gr
```
Save → Publish. Καμία αλλαγή δεν χρειάζεται στο ίδιο το script.

---

## 9) Updates στο μέλλον

```bash
cd /opt/search-ekpa
git pull origin main
npm install --omit=dev      # μόνο αν άλλαξε το package.json
pm2 restart ekpa-smart-finder
```

Με `DATA_DIR` ορισμένο, το `git pull` δεν αγγίζει ποτέ το ζωντανό taxonomy ή τα
analytics. Αν αλλάξει το `public/concepts.json` στο repo και θέλετε να ισχύσει,
περάστε τις αλλαγές από το admin panel (ή σβήστε το αρχείο στο `DATA_DIR` ώστε να
ξαναγίνει αντιγραφή στο επόμενο restart — χάνονται όμως οι αλλαγές του admin).

---

## 10) Checklist πριν πεις "έτοιμο"

- [ ] `curl https://search-api.elearningekpa.gr/health` → `{"ok":true,"programs":702}`
- [ ] `curl https://search-api.elearningekpa.gr/api/search?q=ai` → JSON αποτελέσματα
- [ ] `curl -i -H "Origin: https://evil-example.com" https://search-api.elearningekpa.gr/api/search?q=ai` → **403** (CORS ενεργό)
- [ ] Από τη σελίδα `https://search-api.elearningekpa.gr/` ο 💬 βοηθός απαντάει (όχι 403)
- [ ] `DATA_DIR` ορισμένο, ο φάκελος υπάρχει και είναι εγγράψιμος (log γραμμή `Data:`)
- [ ] `pm2 status` (ή `systemctl status`) δείχνει το app ενεργό
- [ ] `pm2 startup` / `systemctl enable` έγινε, ώστε να επιβιώνει σε reboot
- [ ] HTTPS ενεργό (πράσινο λουκέτο στον browser)
- [ ] Θύρα 3000 (ή όποια διαλέξατε) **μπλοκαρισμένη** απευθείας από έξω, μόνο μέσω nginx
- [ ] `.env` έχει το πραγματικό API key — και δεν είναι committed πουθενά σε git
- [ ] GTM Variable `EKPA Backend URL` ενημερώθηκε με το νέο URL, Published
