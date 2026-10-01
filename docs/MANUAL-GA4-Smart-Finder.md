# Manual: Ρύθμιση GA4 για τα δεδομένα του Smart Finder

**Property:** Elearning - GA4 (`G-ZL8304SEHG`)
**Ποιος το κάνει:** όποιος έχει ρόλο **Editor** ή **Administrator** στο GA4 property
**Χρόνος:** περίπου 15 λεπτά
**Πότε:** μία φορά, **όσο πιο γρήγορα γίνεται**. Ό,τι δεν έχει δηλωθεί δεν μετριέται αναδρομικά.

---

## Γιατί χρειάζεται

Το widget Smart Finder στέλνει στο GA4 τρία events:

| Event | Πότε στέλνεται | Παράμετροι |
|---|---|---|
| `search` | Ο χρήστης πληκτρολογεί αναζήτηση | `search_term` |
| `search_no_results` | Η αναζήτηση δεν βρήκε τίποτα | `search_term` |
| `select_content` | Κλικ σε αποτέλεσμα | `search_term`, `item_id` (slug προγράμματος), `content_id` (τίτλος), `content_type` |

Το GA4 **καταγράφει** πάντα τις παραμέτρους. Στις αναφορές και στα Explorations όμως **εμφανίζει** μόνο όσες έχουν δηλωθεί ως **Custom Dimensions**. Αν λείπουν:
- βλέπεις ότι έγιναν 500 αναζητήσεις, αλλά όχι **ποιες λέξεις** αναζητήθηκαν,
- και όταν τις δηλώσεις, μετράνε **μόνο από εκείνη τη στιγμή και μετά**.

---

## Βήμα 1: Έλεγχος ότι φτάνουν τα events

1. Άνοιξε το GA4 → property **Elearning - GA4**.
2. Αριστερό μενού: **Reports → Realtime**.
3. Σε άλλη καρτέλα άνοιξε το site (testing ή production) και κάνε 2–3 αναζητήσεις στο search bar, π.χ. `ψυχολογία`, `xyzxyz` (για μηδενικά αποτελέσματα). Κάνε και ένα κλικ σε αποτέλεσμα.
4. Γύρνα στο Realtime, στην κάρτα **«Event count by Event name»**.
5. Πρέπει να δεις τα `search`, `search_no_results` και `select_content`.
6. Κάνε κλικ στο `search`. Αν εμφανίζεται η παράμετρος `search_term` με τις λέξεις σου, όλα δουλεύουν.

> ⚠️ Αν βλέπεις `ekpa_search` αντί για `search`, το site δεν έχει `gtag()` και τα events πηγαίνουν στο `dataLayer` του GTM. Τότε χρειάζεται GA4 Event tag στο GTM. Σημείωσέ το και ενημέρωσε τη Brandery.

---

## Βήμα 2: Δήλωση Custom Dimensions

1. Κάτω αριστερά: **⚙️ Admin**.
2. Στη στήλη **Property**: **Data display → Custom definitions**.
3. Καρτέλα **Custom dimensions** → μπλε κουμπί **Create custom dimension**.
4. Δημιούργησε τις παρακάτω, **μία-μία**:

| Dimension name | Scope | Event parameter | Description |
|---|---|---|---|
| `SF Search term` | **Event** | `search_term` | Λέξεις αναζήτησης Smart Finder |
| `SF Program slug` | **Event** | `item_id` | Slug προγράμματος που επιλέχθηκε |
| `SF Program title` | **Event** | `content_id` | Τίτλος προγράμματος που επιλέχθηκε |
| `SF Content type` | **Event** | `content_type` | Τύπος περιεχομένου (course) |

5. Σε κάθε μία: **Save**.

**Σημειώσεις**
- Το **Event parameter** πρέπει να γραφτεί **ακριβώς** όπως στον πίνακα: πεζά, με κάτω παύλα.
- Αν το GA4 **δεν σε αφήσει** να δημιουργήσεις το `search_term` (π.χ. μήνυμα ότι υπάρχει ήδη ή ότι είναι δεσμευμένο), δεν πειράζει. Χρησιμοποίησε την ενσωματωμένη διάσταση **«Search term»** του GA4 και προχώρα στα υπόλοιπα.
- Αν υπάρχει ήδη διάσταση για κάποια από αυτές τις παραμέτρους (με άλλο όνομα), **μην** φτιάξεις δεύτερη. Σημείωσε το όνομα που έχει.

---

## Βήμα 3: Διάρκεια διατήρησης δεδομένων

Η προεπιλογή του GA4 είναι **2 μήνες**. Μετά από αυτό, τα Explorations δεν βλέπουν παλιότερα δεδομένα.

1. **⚙️ Admin** → στήλη Property → **Data collection and modification → Data retention**.
2. **Event data retention:** ορισμός σε **14 months**.
3. **Save**.

---

## Βήμα 4: Έλεγχος, 24–48 ώρες μετά

Οι νέες διαστάσεις χρειάζονται έως 48 ώρες για να εμφανιστούν.

1. **Explore → Blank** (νέο Exploration).
2. Στο **Dimensions** πρόσθεσε (με το **+**): `Event name`, `SF Search term` (ή `Search term`), `SF Program title`.
3. Στο **Metrics** πρόσθεσε: `Event count`.
4. Σύρε το `Event name` και το `SF Search term` στο **Rows** και το `Event count` στο **Values**.
5. Φίλτρο: `Event name` **exactly matches** `search_no_results`.
6. Πρέπει να δεις λίστα με τις λέξεις που δεν βρήκαν αποτέλεσμα. ✅

Αποθήκευσε το Exploration ως **«Smart Finder – Zero results»**. Από εδώ θα γίνεται το export (CSV) για την αναφορά προτάσεων λεξικού.

---

## Checklist

- [ ] Βήμα 1: τα 3 events φαίνονται στο Realtime, με `search_term`
- [ ] Βήμα 2: δηλώθηκαν `SF Search term`, `SF Program slug`, `SF Program title`, `SF Content type`
- [ ] Βήμα 3: Data retention = 14 months
- [ ] Βήμα 4: μετά από 48 ώρες, το Exploration «Smart Finder – Zero results» δείχνει λέξεις
- [ ] Ημερομηνία ολοκλήρωσης: ____________ (από εδώ και πέρα μετράνε τα δεδομένα)
