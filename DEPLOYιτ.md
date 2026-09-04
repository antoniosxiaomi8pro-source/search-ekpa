# Πώς να "ανεβάσεις" το backend δημόσια (ώστε να έχει https URL)

Δύο δρόμοι. Ο πρώτος (VPS) ταιριάζει με το "self-hosted" που είχαμε αποφασίσει και
δίνει πλήρη έλεγχο. Ο δεύτερος (PaaS) είναι πιο γρήγορος αν η ΙΤ δεν θέλει να
διαχειρίζεται server.

---

## Δρόμος Α — Δικός σας VPS (Ubuntu/Debian) — προτεινόμενο

Χρειάζεσαι: ένα μικρό VPS (1-2 vCPU, 2GB RAM αρκούν άνετα σε αυτή την κλίμακα) και ένα
subdomain, π.χ. `search-api.elearningekpa.gr`, που να δείχνει (DNS A record) στο IP του
VPS.

### 1) Εγκατάσταση Node.js στον server
```bash
ssh user@your-server-ip
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version   # επιβεβαίωσε ότι είναι v18+ (ιδανικά v22)
```

### 2) Ανέβασμα του κώδικα
Από τον δικό σου υπολογιστή:
```bash
scp ekpa-smart-finder-backend.zip user@your-server-ip:/home/user/
ssh user@your-server-ip
unzip ekpa-smart-finder-backend.zip
cd finder-backend
```

### 3) Εξαρτήσεις + API key
```bash
npm install --production
cp .env.example .env
nano .env
# βάλε: LLM_PROVIDER=anthropic (ή openai/gemini) και το αντίστοιχο API key
```

### 4) Να μένει ζωντανό (process manager)
Το `npm start` σταματάει αν κλείσεις το SSH. Το `pm2` το κρατάει ζωντανό μόνιμα και το
ξανασηκώνει αν γίνει reboot ο server:
```bash
sudo npm install -g pm2
pm2 start server/server.js --name ekpa-search
pm2 save
pm2 startup    # εκτέλεσε την εντολή που θα σου εμφανίσει
```

### 5) Nginx reverse proxy + δωρεάν HTTPS (Let's Encrypt)
```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```
Δημιούργησε `/etc/nginx/sites-available/ekpa-search`:
```nginx
server {
    listen 80;
    server_name search-api.elearningekpa.gr;
    location / {
        proxy_pass http://localhost:8787;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```
```bash
sudo ln -s /etc/nginx/sites-available/ekpa-search /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d search-api.elearningekpa.gr   # δωρεάν HTTPS πιστοποιητικό
```

### 6) Firewall (αν χρησιμοποιείς ufw)
```bash
sudo ufw allow 'Nginx Full'
sudo ufw allow OpenSSH
```

### 7) Επιβεβαίωση ότι δουλεύει δημόσια
```bash
curl "https://search-api.elearningekpa.gr/api/search?q=ai"
```
Αν επιστρέψει JSON με προγράμματα, είναι έτοιμο.

### 8) Ενημέρωσε το widget
Στο `ekpa-search-widget.js`, άλλαξε:
```js
const BACKEND_URL = "https://search-api.elearningekpa.gr";
```

---

## Δρόμος Β — Γρήγορη εναλλακτική (PaaS, χωρίς διαχείριση server)

 υπηρεσίες όπως Railway.app ή Render.com
κάνουν deploy απευθείας από τον φάκελο του project με λίγα κλικ, δίνουν αυτόματα ένα
δημόσιο https URL, και το "μόνιμα ζωντανό" + HTTPS το αναλαμβάνουν αυτές. Πιο γρήγορο
για δοκιμή, αλλά δεν είναι self-hosted (τα δεδομένα/logs περνάνε από τρίτο πάροχο) —
αν αυτό έχει σημασία για σας (π.χ. λόγω πολιτικής δημόσιου φορέα), προτίμησε τον Δρόμο Α.

---

