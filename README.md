# Rezervacije na steroidima

Sustav za online rezervacije stolova u restoranu: javna stranica za goste, admin panel za osoblje, automatske potvrde, podsjetnici i lista čekanja.

## Što radi (MVP)

- **Online rezervacija**: gost bira datum, broj osoba i slobodan termin; dobiva e-mail potvrdu s linkom za pregled i otkazivanje.
- **Pametna dodjela stolova**: sustav sam bira najmanji slobodan stol koji odgovara grupi, uz trajanje obroka (90/120 min) i vrijeme pospremanja. Provjera i upis su u jednoj transakciji, pa nema dvostrukih rezervacija.
- **Lista čekanja**: kad je dan pun, gost se upiše; čim netko otkaže, gosti s liste dobiju e-mail.
- **Podsjetnici**: e-mail, SMS i/ili WhatsApp 24 h i 2 h prije dolaska (oba vremena i kanali se mijenjaju u postavkama). Gost u podsjetniku jednim klikom potvrđuje dolazak ili otkazuje, a admin vidi tko je potvrdio.
- **AI asistent**: chat na javnoj stranici i WhatsApp. Gost napiše "stol za 4 u subotu oko 20h", asistent provjeri slobodne termine, predloži vrijeme, pita što nedostaje, ponovi detalje i nakon potvrde sam upiše rezervaciju (s e-mail potvrdom). Kad je pun dan, nudi listu čekanja. Na WhatsAppu gost vidi i otkazuje svoje rezervacije.
- **Admin panel** (`/admin`): vremenski raspored po stolovima, popis dana, statusi (stigli, otišli, nisu došli, otkazano), unos telefonskih i walk-in rezervacija, ručni odabir stola.
- **Tlocrt** (`/admin/tlocrt`): učitaš sliku tlocrta kavane i po njoj povlačiš stolove (oblik, veličina, zakret, broj mjesta, prostor npr. terasa). Pregled dana pokazuje tlocrt u odabrano vrijeme: slobodni, uskoro rezervirani, rezervirani i zauzeti stolovi s imenom gosta. Klikom na rezervaciju i stolove ručno premještaš goste.
- **Automatski raspored**: svaka rezervacija dobiva stol s najmanje praznih mjesta; ako nijedan stol nije dovoljno velik ili slobodan, sustav spaja susjedne stolove s tlocrta (do 4, isti prostor, razmak do `join_distance`). Gumb "Rasporedi dan automatski" iznova slaže cijeli dan (najveće grupe prve), a ručno odabrane stolove ne dira.
- **Vanjske rezervacije**: webhook `POST /api/uvoz` i uvoz CSV datoteke (npr. iz Excela). Vanjska rezervacija se upisuje i kad nema mjesta, označena kao "bez stola". Ponovni uvoz istog zapisa (isti izvor + id) ne stvara duplikat nego ga ažurira ili otkazuje.
- **Postavke** (`/admin/postavke`): radno vrijeme (više smjena po danu), neradni dani, stolovi (kapacitet, samo-telefonski stolovi), trajanja, pravila online rezervacija.

## Pokretanje

```bash
npm install
cp .env.example .env.local   # postavi ADMIN_PASSWORD i ostalo
npm run dev                  # http://localhost:3000
```

Baza je SQLite datoteka u `data/rezervacije.db` i stvara se sama, s primjernim stolovima i radnim vremenom (uto–ned 12–23 h).
Bez SMTP postavki e-mailovi se ispisuju u konzolu.

Podsjetnici se šalju sami dok aplikacija radi (provjera svakih 5 minuta).
SMS i WhatsApp idu preko Twilija: upiši `TWILIO_*` u `.env.local` (za WhatsApp treba odobren Twilio WhatsApp pošiljatelj).
Na platformama bez stalnog procesa (npr. Vercel) postavi `DISABLE_REMINDER_LOOP=1` i cron koji svakih 5–15 minuta poziva
`GET https://tvoja-domena/api/cron/podsjetnici?key=CRON_SECRET`.

### AI asistent

Upiši `ANTHROPIC_API_KEY` (Claude API ključ s console.anthropic.com) i na javnoj stranici se pojavi gumb "Rezerviraj u chatu".
Asistent koristi model Claude Opus 5.5; razgovori se čuvaju u bazi (`conversations`).

WhatsApp: u Twilio konzoli za WhatsApp pošiljatelja postavi "A message comes in" na
`https://tvoja-domena/api/whatsapp` (POST). Potrebni su `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM` i točan `APP_URL` (koristi se za provjeru Twilio potpisa).

## API

| Metoda | Putanja | Opis |
|---|---|---|
| GET | `/api/dostupnost?datum=YYYY-MM-DD&osobe=N` | slobodni termini |
| POST | `/api/rezervacije` | `{datum, min, osobe, ime, email, telefon, napomena}` |
| POST | `/api/lista-cekanja` | `{datum, osobe, ime, email, telefon}` |
| GET | `/api/cron/podsjetnici?key=…` | šalje podsjetnike |
| POST | `/api/asistent` | `{razgovor?, poruka}` → `{razgovor, odgovor}` (chat) |
| POST | `/api/whatsapp` | Twilio WhatsApp webhook |
| POST | `/api/uvoz?izvor=naziv` | vanjske rezervacije, `Authorization: Bearer IMPORT_KEY` |

### Uvoz vanjskih rezervacija

JSON (jedna rezervacija ili niz):

```json
{"id": "A-1042", "datum": "2026-10-03", "vrijeme": "19:30", "osobe": 6, "ime": "Ana Horvat",
 "telefon": "091 234 5678", "email": "", "napomena": "rođendan", "status": ""}
```

`datum` može biti i `3.10.2026`, `status: "otkazano"` otkazuje rezervaciju s tim `id`.
CSV (`Content-Type: text/csv` ili gumb "Uvezi" na stranici Tlocrt) prepoznaje stupce datum, vrijeme, osobe, ime, id, telefon, email, napomena, status, odvojene s `;` ili `,`.
Odgovor za svaki zapis kaže je li novo, promijenjeno, otkazano ili bez promjene i koji je stol dobio.

## Sljedeće faze

1. Widget za ugradnju na postojeću stranicu
2. Depozit ili kartica za garanciju (Stripe), naknada za no-show
3. Google Calendar sinkronizacija, Google "Reserve" integracija
4. AI asistent i za e-mail i telefonske pozive
5. Analitika: popunjenost po danima i satima, no-show stopa, stalni gosti
