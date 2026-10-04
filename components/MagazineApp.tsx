'use client'

import { useEffect, useMemo, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { groupedIndex, type Category, type Recipe } from '@/lib/catalog'
import { supabase } from '@/lib/supabase'

type Draft = { titel: string; ingredienten: string; bereidingswijze: string; bereidingstijd: string; bron: string; maaltijden: string[]; hoofdingredienten: string[] }
type Analysis = Draft & { foto_index: number; foto_uitsnede: { x: number; y: number; breedte: number; hoogte: number } | null }
const empty = (): Draft => ({ titel: '', ingredienten: '', bereidingswijze: '', bereidingstijd: '', bron: '', maaltijden: [], hoofdingredienten: [] })
const uploadable = (file: File) => ['image/jpeg', 'image/png', 'image/webp'].includes(file.type) && file.size <= 8_000_000

async function cropImage(file: File, box: NonNullable<Analysis['foto_uitsnede']>): Promise<File> {
  const bitmap = await createImageBitmap(file)
  const x = Math.max(0, Math.min(bitmap.width - 1, Math.round(box.x * bitmap.width)))
  const y = Math.max(0, Math.min(bitmap.height - 1, Math.round(box.y * bitmap.height)))
  const width = Math.max(1, Math.min(bitmap.width - x, Math.round(box.breedte * bitmap.width)))
  const height = Math.max(1, Math.min(bitmap.height - y, Math.round(box.hoogte * bitmap.height)))
  const canvas = document.createElement('canvas')
  const scale = Math.min(1, 2000 / Math.max(width, height))
  canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale)
  canvas.getContext('2d')?.drawImage(bitmap, x, y, width, height, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error('Uitsnede mislukt')), 'image/jpeg', .9))
  return new File([blob], 'uitgelichte-foto.jpg', { type: 'image/jpeg' })
}

async function analysisImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return new Promise((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error('Foto kon niet worden voorbereid')), 'image/jpeg', .65))
}

export default function MagazineApp() {
  const [user, setUser] = useState<User | null>(null)
  const [ready, setReady] = useState(false)
  const [configError, setConfigError] = useState('')
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [meals, setMeals] = useState<Category[]>([])
  const [mains, setMains] = useState<Category[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [view, setView] = useState<'library' | 'editor' | 'magazine'>('library')
  const [filterMeals, setFilterMeals] = useState<string[]>([])
  const [filterMains, setFilterMains] = useState<string[]>([])
  const [draft, setDraft] = useState<Draft>(empty)
  const [sourceFiles, setSourceFiles] = useState<File[]>([])
  const [coverFile, setCoverFile] = useState<File | null>(null)
  const [coverPreview, setCoverPreview] = useState('')
  const [sourcePreviews, setSourcePreviews] = useState<string[]>([])
  const [newMeal, setNewMeal] = useState('')
  const [newMain, setNewMain] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [page, setPage] = useState(0)

  useEffect(() => {
    try {
      const db = supabase()
      db.auth.getUser().then(({ data }) => { setUser(data.user); setReady(true) })
      const { data: listener } = db.auth.onAuthStateChange((_event, session) => { setUser(session?.user ?? null); setReady(true) })
      return () => listener.subscription.unsubscribe()
    } catch (error) { setConfigError(error instanceof Error ? error.message : 'Configuratie ontbreekt'); setReady(true) }
  }, [])

  useEffect(() => {
    if (!user) return
    void load()
  }, [user?.id])

  useEffect(() => {
    const previews = sourceFiles.map(file => URL.createObjectURL(file))
    setSourcePreviews(previews)
    return () => previews.forEach(URL.revokeObjectURL)
  }, [sourceFiles])
  useEffect(() => {
    if (!coverFile) { setCoverPreview(''); return }
    const preview = URL.createObjectURL(coverFile)
    setCoverPreview(preview)
    return () => URL.revokeObjectURL(preview)
  }, [coverFile])

  async function load() {
    const db = supabase()
    const [recipeResult, mealResult, mainResult] = await Promise.all([
      db.from('recepten').select('*, recept_maaltijden(maaltijd_id), recept_hoofdingredienten(hoofdingredient_id)').order('positie').order('aangemaakt_op'),
      db.from('maaltijden').select('id, naam, user_id').order('naam'),
      db.from('hoofdingredienten').select('id, naam, user_id').order('naam')
    ])
    const error = recipeResult.error || mealResult.error || mainResult.error
    if (error) { setMessage(error.message); return }
    const items = (recipeResult.data ?? []) as Recipe[]
    setRecipes(items); setMeals((mealResult.data ?? []) as Category[]); setMains((mainResult.data ?? []) as Category[])
    const paths = [...new Set(items.flatMap(recipe => [recipe.foto, ...recipe.originele_fotos].filter((path): path is string => Boolean(path))))]
    if (paths.length) {
      const signed = await db.storage.from('receptfotos').createSignedUrls(paths, 60 * 60)
      const next: Record<string, string> = {}
      signed.data?.forEach((item, index) => { if (item.signedUrl) next[paths[index]] = item.signedUrl })
      setUrls(next)
    } else setUrls({})
  }

  function startEditor() {
    setDraft(empty()); setSourceFiles([]); setCoverFile(null); setMessage(''); setNewMeal(''); setNewMain(''); setView('editor')
  }
  function toggle(field: 'maaltijden' | 'hoofdingredienten', id: string) {
    setDraft(current => ({ ...current, [field]: current[field].includes(id) ? current[field].filter(value => value !== id) : [...current[field], id] }))
  }
  async function addCategory(kind: 'meal' | 'main') {
    const name = (kind === 'meal' ? newMeal : newMain).trim()
    if (!name || !user) return
    const list = kind === 'meal' ? meals : mains
    const existing = list.find(item => item.naam.toLocaleLowerCase('nl') === name.toLocaleLowerCase('nl'))
    if (existing) { toggle(kind === 'meal' ? 'maaltijden' : 'hoofdingredienten', existing.id); kind === 'meal' ? setNewMeal('') : setNewMain(''); return }
    const { data, error } = await supabase().from(kind === 'meal' ? 'maaltijden' : 'hoofdingredienten').insert({ naam: name, user_id: user.id }).select('id, naam, user_id').single()
    if (error) { setMessage(error.message); return }
    if (kind === 'meal') { setMeals(current => [...current, data].sort((a, b) => a.naam.localeCompare(b.naam, 'nl'))); setNewMeal(''); toggle('maaltijden', data.id) }
    else { setMains(current => [...current, data].sort((a, b) => a.naam.localeCompare(b.naam, 'nl'))); setNewMain(''); toggle('hoofdingredienten', data.id) }
  }

  async function analyse() {
    if (!sourceFiles.length) return
    setBusy(true); setMessage('')
    try {
      const { data: { session } } = await supabase().auth.getSession()
      if (!session) throw new Error('Log opnieuw in.')
      const form = new FormData()
      for (const file of sourceFiles) form.append('foto', await analysisImage(file), 'analyse.jpg')
      const response = await fetch('/api/analyse', { method: 'POST', headers: { authorization: `Bearer ${session.access_token}` }, body: form })
      const result = await response.json() as Analysis & { error?: string }
      if (!response.ok) throw new Error(result.error || 'Analyse mislukt')
      const matching = (names: string[], list: Category[]) => list.filter(item => names.some(name => name.toLocaleLowerCase('nl') === item.naam.toLocaleLowerCase('nl'))).map(item => item.id)
      setDraft({ titel: result.titel, ingredienten: result.ingredienten, bereidingswijze: result.bereidingswijze, bereidingstijd: result.bereidingstijd, bron: result.bron, maaltijden: matching(result.maaltijden, meals), hoofdingredienten: matching(result.hoofdingredienten, mains) })
      const best = sourceFiles[Math.min(Math.max(result.foto_index, 0), sourceFiles.length - 1)]
      if (!coverFile) {
        try { setCoverFile(result.foto_uitsnede ? await cropImage(best, result.foto_uitsnede) : best) }
        catch { setCoverFile(best) }
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Analyse mislukt') }
    finally { setBusy(false) }
  }

  async function save() {
    if (!user || !draft.titel.trim() || !draft.ingredienten.trim()) { setMessage('Vul minstens een titel en ingrediënten in.'); return }
    setBusy(true); setMessage('')
    const db = supabase()
    const uploaded: string[] = []
    let recipeId: string | undefined
    try {
      async function upload(file: File) {
        const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
        const path = `${user!.id}/${crypto.randomUUID()}.${ext}`
        const { error } = await db.storage.from('receptfotos').upload(path, file, { contentType: file.type })
        if (error) throw error
        uploaded.push(path)
        return path
      }
      const originals = [] as string[]
      for (const file of sourceFiles) originals.push(await upload(file))
      const cover = coverFile ? (sourceFiles.includes(coverFile) ? originals[sourceFiles.indexOf(coverFile)] : await upload(coverFile)) : null
      const { data, error } = await db.from('recepten').insert({
        user_id: user.id, titel: draft.titel.trim(), ingredienten: draft.ingredienten.trim(), bereidingswijze: draft.bereidingswijze.trim(),
        bereidingstijd: draft.bereidingstijd.trim() || null, bron: draft.bron.trim() || null,
        foto: cover, originele_fotos: originals, positie: Date.now()
      }).select('id').single()
      if (error) throw error
      recipeId = data.id
      if (draft.maaltijden.length) {
        const { error } = await db.from('recept_maaltijden').insert(draft.maaltijden.map(maaltijd_id => ({ recept_id: recipeId, maaltijd_id })))
        if (error) throw error
      }
      if (draft.hoofdingredienten.length) {
        const { error } = await db.from('recept_hoofdingredienten').insert(draft.hoofdingredienten.map(hoofdingredient_id => ({ recept_id: recipeId, hoofdingredient_id })))
        if (error) throw error
      }
      await load(); setView('library'); setSourceFiles([]); setCoverFile(null)
    } catch (error) {
      if (recipeId) await db.from('recepten').delete().eq('id', recipeId)
      if (uploaded.length) await db.storage.from('receptfotos').remove(uploaded)
      setMessage(error instanceof Error ? error.message : 'Opslaan mislukt')
    } finally { setBusy(false) }
  }

  async function moveRecipe(index: number, direction: -1 | 1) {
    const other = index + direction
    if (other < 0 || other >= recipes.length) return
    const a = recipes[index], b = recipes[other]
    const db = supabase()
    const { error } = await db.rpc('wissel_recepten', { eerste_id: a.id, tweede_id: b.id })
    if (error) { setMessage(error.message); return }
    await load(); setPage(other + 1)
  }

  const visible = useMemo(() => recipes.filter(recipe =>
    (!filterMeals.length || recipe.recept_maaltijden.some(item => filterMeals.includes(item.maaltijd_id))) &&
    (!filterMains.length || recipe.recept_hoofdingredienten.some(item => filterMains.includes(item.hoofdingredient_id)))
  ), [recipes, filterMeals, filterMains])
  const mealName = (id: string) => meals.find(item => item.id === id)?.naam || ''
  const mainName = (id: string) => mains.find(item => item.id === id)?.naam || ''
  const theme = (recipe: Recipe) => {
    const name = recipe.recept_maaltijden.map(item => mealName(item.maaltijd_id)).join(' ')
    return /Ontbijt|Brunch/.test(name) ? 'morning' : /Dessert|Gebak/.test(name) ? 'sweet' : /Aperitief|Drank/.test(name) ? 'aperitif' : /Soep|Salade/.test(name) ? 'fresh' : 'savoury'
  }

  if (!ready) return <main className="centered">Even laden…</main>
  if (configError) return <main className="centered"><h1>Mijn Kookmagazine</h1><p>{configError}</p><p>Zie README.md voor de installatie.</p></main>
  if (!user) return <main className="login"><div className="login-art"><span>HET PERSOONLIJKE RECEPTENBOEK</span><div className="plate">✦</div><span>GERECHTEN OM TE BEWAREN</span></div><div className="login-copy"><div className="brand">MK<span>·</span></div><p className="eyebrow">JOUW KEUKEN, JOUW VERHALEN</p><h1>Mijn<br/><em>Kookmagazine</em></h1><p>Bewaar je favoriete recepten, blader door jouw culinaire verzameling en laat foto’s voor je lezen.</p><button className="primary" onClick={async () => { const { error } = await supabase().auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } }); if (error) setMessage(error.message) }}>Verder met Google <span>↗</span></button>{message && <p className="error">{message}</p>}<small>Een privéplek voor alles wat je graag kookt.</small></div></main>

  return <div className="site">
    <header className="topbar"><button className="wordmark" onClick={() => setView('library')}>MIJN <i>KOOK</i>MAGAZINE<span>✦</span></button><nav><button className={view === 'library' ? 'active' : ''} onClick={() => setView('library')}>Recepten</button><button className={view === 'magazine' ? 'active' : ''} onClick={() => { setPage(0); setView('magazine') }}>Lees magazine</button></nav><div className="header-actions"><button className="add-button" onClick={startEditor}>+ Nieuw recept</button><button className="avatar" title="Uitloggen" onClick={() => supabase().auth.signOut()}>{user.email?.[0]?.toUpperCase() || 'U'}<span>Uitloggen</span></button></div></header>
    {message && <div className="notice" role="alert">{message}<button onClick={() => setMessage('')}>×</button></div>}

    {view === 'library' && <main className="library"><section className="library-hero"><div><p className="eyebrow">PERSOONLIJKE COLLECTIE · {String(recipes.length).padStart(2, '0')} RECEPTEN</p><h1>De smaak van<br/><em>jouw verhaal.</em></h1><p>Een plek voor alle recepten die je wilt blijven maken.</p></div><div className="hero-decoration"><div className="hero-circle">BON<br/>APPÉTIT<span>✳</span></div><small>VERZAMEL · KOOK · GENIET</small></div></section><section className="shelf"><div className="section-head"><div><p className="eyebrow">BLADER DOOR JE VERZAMELING</p><h2>Alle recepten <span>({visible.length})</span></h2></div><button className="text-link" onClick={() => { setPage(0); setView('magazine') }}>Open het magazine ↗</button></div><div className="filters"><div className="filter-group"><label>TYPE MAALTIJD</label><div className="chips">{meals.map(item => <button key={item.id} className={filterMeals.includes(item.id) ? 'chip selected' : 'chip'} onClick={() => setFilterMeals(current => current.includes(item.id) ? current.filter(id => id !== item.id) : [...current, item.id])}>{item.naam}</button>)}</div></div><div className="filter-group"><label>HOOFDINGREDIËNT</label><div className="chips">{mains.map(item => <button key={item.id} className={filterMains.includes(item.id) ? 'chip selected' : 'chip'} onClick={() => setFilterMains(current => current.includes(item.id) ? current.filter(id => id !== item.id) : [...current, item.id])}>{item.naam}</button>)}</div></div></div>{visible.length ? <div className="recipe-grid">{visible.map((recipe, index) => <button key={recipe.id} className={`recipe-card ${theme(recipe)}`} onClick={() => { setPage(recipes.findIndex(item => item.id === recipe.id) + 1); setView('magazine') }}><div className="card-photo">{recipe.foto && urls[recipe.foto] ? <img src={urls[recipe.foto]} alt={recipe.titel} /> : <span className="photo-placeholder">✳</span>}<span className="card-number">{String(index + 1).padStart(2, '0')}</span></div><div className="card-body"><div className="card-label">{recipe.recept_maaltijden.map(item => mealName(item.maaltijd_id)).join(' · ') || 'RECEPT'}</div><h3>{recipe.titel}</h3><div className="card-footer"><span>{recipe.bereidingstijd || recipe.recept_hoofdingredienten.map(item => mainName(item.hoofdingredient_id)).join(' · ') || 'Uit jouw keuken'}</span><span>↗</span></div></div></button>)}</div> : <div className="empty"><span>✳</span><h3>{recipes.length ? 'Geen recepten met deze filters' : 'Je eerste recept wacht op je'}</h3><p>{recipes.length ? 'Pas je selectie aan om meer recepten te zien.' : 'Voeg een foto toe of schrijf het recept zelf op.'}</p><button className="primary" onClick={recipes.length ? () => { setFilterMeals([]); setFilterMains([]) } : startEditor}>{recipes.length ? 'Wis filters' : '+ Nieuw recept'}</button></div>}</section></main>}

    {view === 'editor' && <main className="editor"><button className="back" onClick={() => setView('library')}>← Terug naar recepten</button><div className="editor-heading"><p className="eyebrow">NIEUW IN JE VERZAMELING</p><h1>Een recept <em>bewaren.</em></h1><p>Begin met een foto of vul alles zelf in. Je kunt elk voorstel nog aanpassen.</p></div><div className="editor-layout"><div className="editor-main"><section className="form-panel"><div className="panel-heading"><span className="step">01</span><div><h2>Foto’s & screenshots</h2><p>Upload maximaal vier beelden. De originele foto’s blijven bewaard.</p></div></div><label className="upload-zone"><input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={event => { const files = Array.from(event.target.files ?? []); if (files.length > 4 || files.some(file => !uploadable(file))) { setMessage('Kies maximaal vier JPG-, PNG- of WebP-foto’s van maximaal 8 MB.'); return } setSourceFiles(files); setCoverFile(null); setMessage('') }} /><span className="upload-symbol">↥</span><strong>Kies foto’s of screenshots</strong><small>JPG, PNG of WebP · maximaal 8 MB per foto</small></label>{sourcePreviews.length > 0 && <div className="source-strip">{sourcePreviews.map((url, index) => <img key={url} src={url} alt={`Originele foto ${index + 1}`} />)}</div>}<button className="secondary" disabled={!sourceFiles.length || busy} onClick={analyse}>{busy ? 'Foto’s worden gelezen…' : '✳ Analyseer met AI'}</button><p className="help">De AI leest de volledige ingrediëntenlijst, stappen en categorieën uit de foto. Controleer de tekst hieronder.</p></section><section className="form-panel"><div className="panel-heading"><span className="step">02</span><div><h2>Het recept</h2><p>Alles blijft bewerkbaar voordat je opslaat.</p></div></div><div className="field"><label htmlFor="title">TITEL *</label><input id="title" value={draft.titel} onChange={event => setDraft({ ...draft, titel: event.target.value })} placeholder="Bijvoorbeeld: citroencake met maanzaad" /></div><div className="field"><label htmlFor="ingredients">INGREDIËNTEN * <span>één per regel, met hoeveelheden</span></label><textarea id="ingredients" rows={8} value={draft.ingredienten} onChange={event => setDraft({ ...draft, ingredienten: event.target.value })} placeholder={'200 g bloem\n2 eieren\n1 citroen'} /></div><div className="field"><label htmlFor="method">BEREIDINGSWIJZE</label><textarea id="method" rows={8} value={draft.bereidingswijze} onChange={event => setDraft({ ...draft, bereidingswijze: event.target.value })} placeholder="Beschrijf de stappen…" /></div><div className="two-fields"><div className="field"><label htmlFor="duration">BEREIDINGSTIJD</label><input id="duration" value={draft.bereidingstijd} onChange={event => setDraft({ ...draft, bereidingstijd: event.target.value })} placeholder="Bijv. 35 minuten" /></div><div className="field"><label htmlFor="source">BRON</label><input id="source" value={draft.bron} onChange={event => setDraft({ ...draft, bron: event.target.value })} placeholder="Bijv. Libelle Lekker" /></div></div></section><section className="form-panel"><div className="panel-heading"><span className="step">03</span><div><h2>Categorieën</h2><p>Meerdere keuzes per groep zijn mogelijk.</p></div></div><div className="category-group"><h3>Type maaltijd</h3><div className="category-options">{meals.map(item => <label key={item.id} className={draft.maaltijden.includes(item.id) ? 'check-pill checked' : 'check-pill'}><input type="checkbox" checked={draft.maaltijden.includes(item.id)} onChange={() => toggle('maaltijden', item.id)} />{item.naam}</label>)}</div><div className="new-category"><input aria-label="Nieuw type maaltijd" value={newMeal} onChange={event => setNewMeal(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void addCategory('meal') } }} placeholder="Nieuw type toevoegen" /><button onClick={() => addCategory('meal')}>+ Toevoegen</button></div></div><div className="category-group"><h3>Hoofdingrediënt</h3><div className="category-options">{mains.map(item => <label key={item.id} className={draft.hoofdingredienten.includes(item.id) ? 'check-pill checked' : 'check-pill'}><input type="checkbox" checked={draft.hoofdingredienten.includes(item.id)} onChange={() => toggle('hoofdingredienten', item.id)} />{item.naam}</label>)}</div><div className="new-category"><input aria-label="Nieuw hoofdingrediënt" value={newMain} onChange={event => setNewMain(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void addCategory('main') } }} placeholder="Nieuw ingrediënt toevoegen" /><button onClick={() => addCategory('main')}>+ Toevoegen</button></div></div></section></div><aside className="editor-aside"><div className="sticky"><p className="eyebrow">UITGELICHTE FOTO</p><div className="cover-preview">{coverPreview ? <img src={coverPreview} alt="Uitgelichte foto" /> : <span>✳<small>Jouw foto verschijnt hier</small></span>}</div><label className="cover-upload">Kies zelf een uitgelichte foto<input type="file" accept="image/jpeg,image/png,image/webp" onChange={event => { const file = event.target.files?.[0]; if (file && uploadable(file)) setCoverFile(file); else if (file) setMessage('Kies een JPG-, PNG- of WebP-foto van maximaal 8 MB.') }} /></label><p>Bij een screenshot kan AI automatisch een foto van het gerecht uitsnijden. Het origineel blijft behouden.</p><button className="primary save" disabled={busy} onClick={save}>{busy ? 'Even bezig…' : 'Recept opslaan ↗'}</button><small>Pas na opslaan verschijnt dit recept in je magazine.</small></div></aside></div></main>}

    {view === 'magazine' && <main className="magazine"><div className="mag-toolbar"><button className="back" onClick={() => setView('library')}>← Alle recepten</button><span>MIJN KOOKMAGAZINE · EDITIE {new Date().getFullYear()}</span><span>PAGINA {page + 1} / {recipes.length + 1}</span></div><div className="mag-sheet">{page === 0 ? <div className="index-page"><div className="index-intro"><p className="eyebrow">EEN VERZAMELING OM TE KOESTEREN</p><h1>De<br/><em>inhoud.</em></h1><p>Alle gerechten uit jouw keuken, netjes bij elkaar.</p><div className="index-flower">✳</div></div><div className="index-list"><span className="index-kicker">INHOUDSOPGAVE / {recipes.length} RECEPTEN</span>{groupedIndex(recipes, meals).map(group => <section key={group.category.id}><h2>{group.category.naam}</h2>{group.pages.map(item => <button key={`${group.category.id}-${item.page}`} onClick={() => setPage(item.page - 1)}><span>{item.title}</span><span className="dots"/><strong>{String(item.page).padStart(2, '0')}</strong></button>)}</section>)}{recipes.length === 0 && <p>Nog geen recepten. Voeg je eerste recept toe om het magazine te vullen.</p>}</div></div> : (() => { const recipe = recipes[page - 1]; if (!recipe) return null; return <article className={`mag-recipe ${theme(recipe)}`}><div className="mag-photo">{recipe.foto && urls[recipe.foto] ? <img src={urls[recipe.foto]} alt={recipe.titel} /> : <span>✳</span>}<div className="photo-caption">{recipe.bron || 'UIT JOUW KEUKEN'} <span>·</span> {String(page + 1).padStart(2, '0')}</div></div><div className="mag-content"><div className="mag-meta">{recipe.recept_maaltijden.map(item => mealName(item.maaltijd_id)).join(' · ') || 'RECEPT'} <span>{recipe.bereidingstijd || ''}</span></div><h1>{recipe.titel}</h1><div className="mag-columns"><div><h2>Ingrediënten</h2><ul>{recipe.ingredienten.split('\n').filter(Boolean).map((line, index) => <li key={index}>{line}</li>)}</ul></div><div><h2>Bereidingswijze</h2><div className="method">{recipe.bereidingswijze.split('\n').filter(Boolean).map((line, index) => <p key={index}>{line}</p>)}</div></div></div><div className="mag-bottom"><span>{recipe.recept_hoofdingredienten.map(item => mainName(item.hoofdingredient_id)).join(' · ')}</span><div><button title="Eerder in magazine" disabled={page <= 1} onClick={() => moveRecipe(page - 1, -1)}>↑</button><button title="Later in magazine" disabled={page >= recipes.length} onClick={() => moveRecipe(page - 1, 1)}>↓</button></div></div></div></article> })()}</div><div className="page-controls"><button disabled={page === 0} onClick={() => setPage(current => current - 1)}>← Vorige</button><span>{String(page + 1).padStart(2, '0')} <i>/</i> {String(recipes.length + 1).padStart(2, '0')}</span><button disabled={page >= recipes.length} onClick={() => setPage(current => current + 1)}>Volgende →</button></div></main>}
    <footer>MIJN KOOKMAGAZINE <span>✳</span> MET ZORG BEWAARD</footer>
  </div>
}
