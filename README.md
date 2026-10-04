# Mijn Kookmagazine

Persoonlijk receptenmagazine met Google-login, fotoanalyse, Supabase-opslag en een inhoudstafel die de receptvolgorde volgt.

## Instellen

1. Maak een Supabase-project aan. Voer [`supabase/schema.sql`](supabase/schema.sql) uit in de SQL Editor. Dit maakt de tabellen, basiscategorieën, privé-opslagbucket en RLS-regels aan.
2. Schakel in Supabase **Authentication → Providers → Google** in. Maak in Google Cloud een OAuth Web Client aan. Gebruik de callback-URL die Supabase op de Google-providerpagina toont als *Authorized redirect URI*. Voeg de lokale en productie-URL toe aan de Supabase redirect allow list.
3. Maak `.env.local` op basis van `.env.example`. Vul de Supabase Project URL en **publishable/anon key** in. Vul voor fotoanalyse ook een Vercel AI Gateway API key in. Plaats nooit de Supabase service role key in deze app.
4. Start met `npm install` en `npm run dev`. Ga naar `http://localhost:3000`.

Op Vercel horen dezelfde drie omgevingsvariabelen bij het project. De AI Gateway-aanroep gebruikt `openai/gpt-4.1-mini` voor beeld en tekst. Zonder sleutel blijft handmatig invullen werken.

## Gebruik

- **+ Nieuw recept:** upload één tot vier foto's of screenshots en klik op **Analyseer met AI**, of vul het formulier zelf in. Controleer vooral ingrediënten en hoeveelheden. Kies eventueel een eigen coverfoto. Alleen **Recept opslaan** schrijft het recept naar de database.
- **Recepten:** filter op meerdere maaltijden en hoofdingrediënten. Een recept kan meerdere categorieën per groep hebben.
- **Lees magazine:** de inhoudstafel staat op pagina 1. De pijlen onderaan bladeren per recept. Met ↑ en ↓ op een receptpagina wijzig je de volgorde; de inhoudstafel en paginanummers volgen automatisch.

De originele uploads worden zonder bewerking in de privé-opslagbucket bewaard. Voor analyse stuurt de browser een verkleinde kopie door; een voorgestelde coveruitsnede wordt apart opgeslagen. Fotoanalyse accepteert maximaal vier JPG-, PNG- of WebP-bestanden van 8 MB elk. Er is geen PDF-export.

## Controle

`npm run build` en `node scripts/check-index.mjs`.
