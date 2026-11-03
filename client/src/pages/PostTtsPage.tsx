import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Radio, Play, Square, RefreshCw, Clock, Cpu, CheckCircle, AlertTriangle, Pencil, Save, X } from 'lucide-react';
import { radioApi, type RadioPostInfo, type RadioSegmentInfo } from '../utils/api';

/**
 * /forum/post/:slug/tts — the Corporate Radio rendering of a post:
 * the TTS-friendly summary the background worker generated, playable in the
 * browser with the Web Speech API, regenerable by admins / the author.
 */
export default function PostTtsPage() {
  const { slug } = useParams<{ slug: string }>();
  const [post, setPost] = useState<RadioPostInfo | null>(null);
  const [segment, setSegment] = useState<RadioSegmentInfo | null>(null);
  const [station, setStation] = useState('Radio');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftHeadline, setDraftHeadline] = useState('');
  const [draftText, setDraftText] = useState('');
  const [saving, setSaving] = useState(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  const load = async () => {
    if (!slug) return;
    setLoading(true); setError(null); setPending(false);
    try {
      const r = await radioApi.getForPost(slug);
      setPost(r.post); setSegment(r.segment); setStation(r.station);
    } catch (e: any) {
      const data = e?.response?.data;
      if (e?.response?.status === 404 && data?.pending) { setPending(true); setPost(data.post); setStation(data.station || 'Radio'); setSegment(null); }
      else setError(data?.error || e.message || 'Failed to load');
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); return () => { window.speechSynthesis?.cancel(); }; }, [slug]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickVoice = () => {
    const voices = window.speechSynthesis.getVoices().filter(v => v.lang.toLowerCase().startsWith('en'));
    const score = (v: SpeechSynthesisVoice) => (/premium/i.test(v.name) ? 3 : /enhanced|natural|neural/i.test(v.name) ? 2 : 0) + (v.lang.toLowerCase() === 'en-us' ? 1 : 0) + (/samantha|ava|zoe|evan|nathan|google us/i.test(v.name) ? 1 : 0);
    return voices.sort((a, b) => score(b) - score(a))[0];
  };

  const speak = () => {
    if (!segment || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(segment.tts_text);
    const v = pickVoice(); if (v) u.voice = v;
    u.lang = 'en-US';
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    utteranceRef.current = u;
    setSpeaking(true);
    window.speechSynthesis.speak(u);
  };
  const stop = () => { window.speechSynthesis?.cancel(); setSpeaking(false); };

  const regenerate = async () => {
    if (!post) return;
    setRegenerating(true);
    try { await radioApi.regenerate(post.id); await load(); }
    catch (e: any) { setError(e?.response?.data?.error || e.message); }
    finally { setRegenerating(false); }
  };

  const startEdit = () => {
    setDraftHeadline(segment?.headline || post?.title || '');
    setDraftText(segment?.tts_text || '');
    setEditing(true);
    stop();
  };
  const saveEdit = async () => {
    if (!post) return;
    setSaving(true); setError(null);
    try { await radioApi.saveSegment(post.id, { headline: draftHeadline, tts_text: draftText }); setEditing(false); await load(); }
    catch (e: any) { setError(e?.response?.data?.error || e.message); }
    finally { setSaving(false); }
  };
  const draftWords = (draftText.match(/\S+/g) || []).length;

  const mmss = (s?: number | null) => { const t = Math.max(0, Math.round(s || 0)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };

  const editorBlock = (
      <div className="space-y-3">
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Headline (at most 12 words)</span>
          <input value={draftHeadline} onChange={e => setDraftHeadline(e.target.value)} maxLength={255}
            className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
        </label>
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Spoken text — write it the way a newsreader would say it</span>
          <textarea value={draftText} onChange={e => setDraftText(e.target.value)} rows={10} maxLength={5000}
            className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-lg leading-7 focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={saveEdit} disabled={saving || draftText.trim().length < 20} className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
            <Save className="h-4 w-4 mr-2" /> {saving ? 'Saving…' : 'Save'}
          </button>
          <button onClick={() => setEditing(false)} disabled={saving} className="inline-flex items-center px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50">
            <X className="h-4 w-4 mr-2" /> Cancel
          </button>
          <span className="text-xs text-gray-500">{draftWords} words · ~{mmss(Math.round(draftWords / 160 * 60))} spoken · no URLs, markdown or emoji: it is read aloud verbatim</span>
        </div>
      </div>
  );

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <Link to={slug ? `/forum/post/${slug}` : '/forum'} className="inline-flex items-center text-sm text-gray-500 hover:text-gray-800 mb-4">
        <ArrowLeft className="h-4 w-4 mr-1" /> Back to post
      </Link>

      <div className="flex items-center space-x-2 text-blue-600 mb-1">
        <Radio className="h-5 w-5" />
        <span className="text-sm font-semibold uppercase tracking-wide">{station}</span>
      </div>

      {loading ? (
        <div className="text-gray-500 py-12">Loading…</div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-4">{error}</div>
      ) : pending && post ? (
        <div className="bg-white rounded-lg shadow p-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">{post.title}</h1>
          <div className="flex items-start space-x-3 bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-yellow-900">
            <Clock className="h-5 w-5 mt-0.5" />
            <div>
              <p className="font-medium">No radio summary yet.</p>
              <p className="text-sm mt-1">The radio worker checks for new and changed posts every 5 minutes and only covers the last 30 days by default. {post.can_regenerate ? 'You can generate it now.' : ''}</p>
            </div>
          </div>
          {post.can_regenerate && !editing && (
            <div className="mt-4 flex flex-wrap gap-3">
              <button onClick={regenerate} disabled={regenerating} className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                <RefreshCw className={`h-4 w-4 mr-2 ${regenerating ? 'animate-spin' : ''}`} /> {regenerating ? 'Generating…' : 'Generate now'}
              </button>
              <button onClick={startEdit} className="inline-flex items-center px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50">
                <Pencil className="h-4 w-4 mr-2" /> Write it by hand
              </button>
            </div>
          )}
          {editing && editorBlock}
        </div>
      ) : segment && post ? (
        <div className="bg-white rounded-lg shadow">
          <div className="p-6 border-b border-gray-100">
            <h1 className="text-2xl font-bold text-gray-900">{segment.headline}</h1>
            <p className="text-sm text-gray-500 mt-1">
              Radio version of <Link to={`/forum/post/${post.slug}`} className="text-blue-600 hover:underline">{post.title}</Link> · by {post.author.name} · posted {new Date(post.created_at).toLocaleDateString()}
            </p>
          </div>

          <div className="p-6">
            {editing ? editorBlock : segment.status === 'failed' ? (
              <div className="flex items-start space-x-3 bg-red-50 border border-red-200 rounded-lg p-4 text-red-800">
                <AlertTriangle className="h-5 w-5 mt-0.5" />
                <div><p className="font-medium">Generation failed.</p><p className="text-sm mt-1 font-mono">{segment.error}</p></div>
              </div>
            ) : (
              <p className="text-lg leading-8 text-gray-800 whitespace-pre-line">{segment.tts_text}</p>
            )}

            {!editing && <div className="flex flex-wrap items-center gap-3 mt-6">
              {segment.status === 'ready' && ('speechSynthesis' in window) && (
                speaking
                  ? <button onClick={stop} className="inline-flex items-center px-4 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-900"><Square className="h-4 w-4 mr-2" /> Stop</button>
                  : <button onClick={speak} className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"><Play className="h-4 w-4 mr-2" /> Listen in browser</button>
              )}
              {post.can_regenerate && (
                <button onClick={regenerate} disabled={regenerating} className="inline-flex items-center px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50" title={segment.is_manual ? 'Replaces your hand-edited text with a fresh AI summary' : undefined}>
                  <RefreshCw className={`h-4 w-4 mr-2 ${regenerating ? 'animate-spin' : ''}`} /> {regenerating ? 'Regenerating…' : 'Regenerate'}
                </button>
              )}
              {post.can_regenerate && (
                <button onClick={startEdit} className="inline-flex items-center px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50">
                  <Pencil className="h-4 w-4 mr-2" /> Edit
                </button>
              )}
            </div>}
          </div>

          <div className="px-6 py-4 bg-gray-50 rounded-b-lg text-xs text-gray-500 flex flex-wrap gap-x-6 gap-y-1">
            <span className="inline-flex items-center"><Clock className="h-3.5 w-3.5 mr-1" /> {segment.word_count ?? '?'} words · ~{mmss(segment.est_duration_secs)} spoken</span>
            {segment.is_manual
              ? <span className="inline-flex items-center text-amber-700"><Pencil className="h-3.5 w-3.5 mr-1" /> edited by hand{segment.edited_by_name ? ` by ${segment.edited_by_name}` : ''} · {new Date(segment.generated_at).toLocaleString()} · the worker will not overwrite this</span>
              : <span className="inline-flex items-center"><Cpu className="h-3.5 w-3.5 mr-1" /> {segment.model || 'unknown model'} · generated {new Date(segment.generated_at).toLocaleString()}</span>}
            {!segment.is_manual && <span className="inline-flex items-center" title="Replies the summary was generated from">
              {segment.comment_count ? `covers ${segment.comment_count} ${segment.comment_count === 1 ? 'reply' : 'replies'}` : 'no replies yet'}
              {(segment.current_comment_count ?? 0) !== (segment.comment_count ?? 0) && <span className="ml-1 text-amber-700">· replies changed since, will regenerate</span>}
            </span>}
            {segment.heard && <span className="inline-flex items-center text-green-700"><CheckCircle className="h-3.5 w-3.5 mr-1" /> you heard this{segment.listened_at ? ` on ${new Date(segment.listened_at).toLocaleDateString()}` : ''}</span>}
          </div>
        </div>
      ) : null}

      <p className="text-xs text-gray-400 mt-4">This text is what the mobile app reads aloud on {station}. It covers the post and its replies, and is regenerated automatically whenever the title, body or replies change (a few minutes after the last reply).</p>
    </div>
  );
}
