# Rezervacije na steroidima

Sustav za online rezervacije stolova u restoranu: javna stranica za goste, admin panel za osoblje, automatske potvrde, podsjetnici i lista čekanja.

## Što radi (MVP)

- **Online rezervacija**: gost bira datum, broj osoba i slobodan termin; dobiva e-mail potvrdu s linkom za pregled i otkazivanje.
- **Pametna dodjela stolova**: sustav sam bira najmanji slobodan stol koji odgovara grupi, uz trajanje obroka (90/120 min) i vrijeme pospremanja. Provjera i upis su u jednoj transakciji, pa nema dvostrukih rezervacija.
- **Lista čekanja**: kad je dan pun, gost se upiše; čim netko otkaže, gosti s liste dobiju e-mail.
- **Podsjetnici**: e-mail 24 h prije dolaska (`/api/cron/podsjetnici`).
- **Admin panel** (`/admin`): vremenski raspored po stolovima, popis dana, statusi (stigli, otišli, nisu došli, otkazano), unos telefonskih i walk-in rezervacija, ručni odabir stola.
- **Postavke** (`/admin/postavke`): radno vrijeme (više smjena po danu), neradni dani, stolovi (kapacitet, samo-telefonski stolovi), trajanja, pravila online rezervacija.

## Pokretanje

```bash
npm install
cp .env.example .env.local   # postavi ADMIN_PASSWORD i ostalo
npm run dev                  # http://localhost:3000
```

Baza je SQLite datoteka u `data/rezervacije.db` i stvara se sama, s primjernim stolovima i radnim vremenom (uto–ned 12–23 h).
Bez SMTP postavki e-mailovi se ispisuju u konzolu.

Podsjetnici: postavi cron koji svakih 15 minuta poziva
`GET https://tvoja-domena/api/cron/podsjetnici?key=CRON_SECRET`.

## API

| Metoda | Putanja | Opis |
|---|---|---|
| GET | `/api/dostupnost?datum=YYYY-MM-DD&osobe=N` | slobodni termini |
| POST | `/api/rezervacije` | `{datum, min, osobe, ime, email, telefon, napomena}` |
| POST | `/api/lista-cekanja` | `{datum, osobe, ime, email, telefon}` |
| GET | `/api/cron/podsjetnici?key=…` | šalje podsjetnike |

## Sljedeće faze

1. SMS/WhatsApp podsjetnici (Twilio), widget za ugradnju na postojeću stranicu
2. Depozit ili kartica za garanciju (Stripe), naknada za no-show
3. Google Calendar sinkronizacija, Google "Reserve" integracija
4. AI asistent koji prima rezervacije putem chata, e-maila i telefona
5. Analitika: popunjenost po danima i satima, no-show stopa, stalni gosti
