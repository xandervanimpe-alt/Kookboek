import { generateText, Output } from 'ai'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { INGREDIENTEN, MAALTIJDEN } from '@/lib/catalog'

const schema = z.object({
  titel: z.string(), ingredienten: z.string(), bereidingswijze: z.string(), bereidingstijd: z.string(), bron: z.string(),
  maaltijden: z.array(z.string()), hoofdingredienten: z.array(z.string()),
  foto_index: z.number().int().min(0), foto_uitsnede: z.object({ x: z.number(), y: z.number(), breedte: z.number(), hoogte: z.number() }).nullable()
})

export async function POST(request: Request) {
  try {
    const token = request.headers.get('authorization')?.replace(/^Bearer /, '')
    if (!token) return Response.json({ error: 'Log eerst in.' }, { status: 401 })
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!url || !key || !process.env.AI_GATEWAY_API_KEY) return Response.json({ error: 'Supabase of AI Gateway is nog niet ingesteld.' }, { status: 503 })
    const auth = createClient(url, key)
    const { data: { user }, error } = await auth.auth.getUser(token)
    if (error || !user) return Response.json({ error: 'Sessie verlopen. Log opnieuw in.' }, { status: 401 })
    const form = await request.formData()
    const files = form.getAll('foto').filter((item): item is File => item instanceof File)
    if (!files.length || files.length > 4 || files.some(file => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 8_000_000))
      return Response.json({ error: 'Kies maximaal vier JPG-, PNG- of WebP-foto’s van maximaal 8 MB.' }, { status: 400 })
    const parts = await Promise.all(files.map(async file => ({ type: 'file' as const, data: new Uint8Array(await file.arrayBuffer()), mediaType: file.type })))
    const { output } = await generateText({
      model: 'openai/gpt-4.1-mini',
      output: Output.object({ schema }),
      messages: [{ role: 'user', content: [
        { type: 'text', text: `Lees alle pagina's van dit recept zorgvuldig. Transcribeer alle ingrediënten inclusief hoeveelheden en eenheden, één per regel. Vul bereidingswijze alleen aan met leesbare stappen; verzin ontbrekende hoeveelheden of instructies niet. Bron alleen als zichtbaar. Kies passende categorieën uit maaltijd: ${MAALTIJDEN.join(', ')} en hoofdingrediënt: ${INGREDIENTEN.join(', ')}. Kies eventueel meerdere per groep. foto_index is de nulgebaseerde index van de beste afbeelding voor een cover. Als die afbeelding een screenshot is met een duidelijke gerechtfoto, geef een genormaliseerde uitsnede (x,y,breedte,hoogte tussen 0 en 1); anders null.` },
        ...parts
      ] }]
    })
    return Response.json(output)
  } catch (error) {
    console.error('Receptanalyse mislukt', error)
    return Response.json({ error: 'De foto kon niet worden geanalyseerd. Probeer opnieuw of vul het recept handmatig in.' }, { status: 500 })
  }
}
