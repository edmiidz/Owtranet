import React, { useState, useEffect, useCallback } from 'react';
import {
  Plus, Trash2, RefreshCw, CheckCircle, XCircle, AlertTriangle,
  Loader, Github, Shield, Save, X,
} from 'lucide-react';
import { searchAdaptersApi } from '../utils/api';
import type { SearchAdapter, SearchAdapterRule } from '../types';

/**
 * Admin Panel → Search Adapters.
 *
 * Configures which GitHub repos the nightly doc sweep indexes into intranet
 * search, replacing what used to be a hardcoded array in
 * server/cron/sweepGithubDocs.js.
 *
 * Two things this screen deliberately does NOT do:
 *  - It never accepts a GitHub token. An adapter names a .env variable on the
 *    server; the secret only ever lives there. We show whether it is set and
 *    offer a connectivity check so you can tell a missing token from an expired
 *    one without ever seeing its value.
 *  - It does not sweep. Saving a change takes effect on the next run (nightly at
 *    4:30 AM, or a manual run on the box), so the UI says so rather than
 *    implying the index updates instantly.
 */

const COLLECTIONS: { value: SearchAdapterRule['collection']; label: string }[] = [
  { value: 'internal', label: 'Engineering Doc' },
  { value: 'help', label: 'Help Center' },
  { value: 'guide', label: 'Integration Guide' },
  { value: 'exec', label: 'Executive & Legal' },
];

const blankRule = (): SearchAdapterRule => ({
  path_prefix: 'docs/',
  collection: 'internal',
  visibility: 'member',
  access_url_mode: 'github',
  url_path: null,
});

interface DraftAdapter {
  id?: number;
  repo: string;
  branch: string;
  label: string;
  token_env_var: string;
  site_base: string;
  enabled: boolean;
  rules: SearchAdapterRule[];
}

const toDraft = (a: SearchAdapter): DraftAdapter => ({
  id: a.id,
  repo: a.repo,
  branch: a.branch || 'main',
  label: a.label || '',
  token_env_var: a.token_env_var,
  site_base: a.site_base || '',
  enabled: Boolean(a.enabled),
  rules: a.rules.length ? a.rules.map(r => ({ ...r })) : [blankRule()],
});

const SearchAdaptersTab: React.FC = () => {
  const [adapters, setAdapters] = useState<SearchAdapter[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [draft, setDraft] = useState<DraftAdapter | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [checking, setChecking] = useState<number | null>(null);
  const [checkResults, setCheckResults] = useState<Record<number, { ok: boolean; reason: string }>>({});

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      setAdapters(await searchAdaptersApi.list());
    } catch {
      setError('Failed to load search adapters');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const flash = (msg: string) => {
    setSuccess(msg);
    setTimeout(() => setSuccess(''), 5000);
  };

  const handleSave = async () => {
    if (!draft) return;
    setError('');

    // Turning a corpus member-visible is the one change here that can expose
    // documents to everyone, so make the admin say it out loud first.
    const newlyPublic = draft.rules.filter(r => r.visibility === 'member');
    const wasAdmin = draft.id
      ? adapters.find(a => a.id === draft.id)?.rules.some(r => r.visibility === 'admin')
      : false;
    if (wasAdmin && newlyPublic.length && !draft.rules.some(r => r.visibility === 'admin')) {
      const typed = window.prompt(
        `This makes every document in ${draft.repo} visible to ALL signed-in members ` +
        `on the next sweep — it is currently admin-only.\n\n` +
        `Type the repo name to confirm:`
      );
      if (typed !== draft.repo) {
        setError('Visibility change cancelled — repo name did not match.');
        return;
      }
    }

    setIsSaving(true);
    try {
      const payload = {
        branch: draft.branch,
        label: draft.label || null,
        token_env_var: draft.token_env_var,
        site_base: draft.site_base || null,
        enabled: draft.enabled,
        rules: draft.rules,
      };
      if (draft.id) {
        await searchAdaptersApi.update(draft.id, payload);
        flash(`Saved ${draft.repo}. Takes effect on the next sweep.`);
      } else {
        await searchAdaptersApi.create({ ...payload, repo: draft.repo });
        flash(`Added ${draft.repo}. It will be indexed on the next sweep.`);
      }
      setDraft(null);
      load();
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to save adapter');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (a: SearchAdapter) => {
    const typed = window.prompt(
      `Remove ${a.repo} and delete its ${a.last_doc_count ?? 0} indexed document(s) from search?\n\n` +
      `The documents themselves are not touched on GitHub.\n\nType the repo name to confirm:`
    );
    if (typed !== a.repo) return;
    try {
      const res = await searchAdaptersApi.remove(a.id);
      flash(`Removed ${a.repo} (${res.documents_removed} document(s) dropped from search).`);
      load();
    } catch {
      setError('Failed to remove adapter');
    }
  };

  const handleCheck = async (a: SearchAdapter) => {
    setChecking(a.id);
    try {
      const result = await searchAdaptersApi.check(a.id);
      setCheckResults(prev => ({ ...prev, [a.id]: result }));
    } catch {
      setCheckResults(prev => ({ ...prev, [a.id]: { ok: false, reason: 'Check failed' } }));
    } finally {
      setChecking(null);
    }
  };

  const updateRule = (i: number, patch: Partial<SearchAdapterRule>) => {
    if (!draft) return;
    const rules = draft.rules.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
    setDraft({ ...draft, rules });
  };

  if (isLoading) {
    return (
      <div className="card p-8 text-center">
        <Loader className="h-6 w-6 animate-spin text-blue-500 mx-auto mb-3" />
        <p className="text-gray-600">Loading search adapters…</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">{error}</div>
      )}
      {success && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg">{success}</div>
      )}

      <div className="card p-6">
        <div className="flex items-start justify-between gap-4 mb-2">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Search Adapters</h2>
            <p className="text-sm text-gray-600 mt-1">
              GitHub repositories whose markdown documents are indexed into intranet search.
              Documents stay in GitHub — search stores only a title, excerpt and body text so
              they can be found, and links members out to the real thing.
            </p>
          </div>
          {!draft && (
            <button
              onClick={() => setDraft({
                repo: '', branch: 'main', label: '', token_env_var: 'GITHUB_DOCS_TOKEN',
                site_base: '', enabled: true, rules: [blankRule()],
              })}
              className="flex-shrink-0 inline-flex items-center px-3 py-2 bg-blue-500 text-white text-sm font-medium rounded-lg hover:bg-blue-600"
            >
              <Plus className="h-4 w-4 mr-1.5" />
              Add repository
            </button>
          )}
        </div>
        <p className="text-xs text-gray-500 mt-3">
          Changes take effect on the next sweep (nightly at 4:30 AM). GitHub tokens are never
          entered here — an adapter names an environment variable set on the server.
        </p>
      </div>

      {/* Editor */}
      {draft && (
        <div className="card p-6 border-blue-200 bg-blue-50/40">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900">
              {draft.id ? `Edit ${draft.repo}` : 'Add repository'}
            </h3>
            <button onClick={() => { setDraft(null); setError(''); }} className="text-gray-400 hover:text-gray-600">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Repository</label>
              <input
                type="text"
                value={draft.repo}
                disabled={Boolean(draft.id)}
                onChange={e => setDraft({ ...draft, repo: e.target.value })}
                placeholder="owner/name"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg disabled:bg-gray-100 disabled:text-gray-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Branch</label>
              <input
                type="text"
                value={draft.branch}
                onChange={e => setDraft({ ...draft, branch: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Label (optional)</label>
              <input
                type="text"
                value={draft.label}
                onChange={e => setDraft({ ...draft, label: e.target.value })}
                placeholder="Shown in this list"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Token env var</label>
              <input
                type="text"
                value={draft.token_env_var}
                onChange={e => setDraft({ ...draft, token_env_var: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg font-mono text-sm"
              />
              <p className="text-xs text-gray-500 mt-1">
                Name of the variable in the server's <code>.env</code> — not the token itself.
              </p>
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Published site base (optional)
              </label>
              <input
                type="text"
                value={draft.site_base}
                onChange={e => setDraft({ ...draft, site_base: e.target.value })}
                placeholder="https://www.example.com"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              />
              <p className="text-xs text-gray-500 mt-1">
                Only needed if a rule below links to a published page instead of GitHub.
              </p>
            </div>
          </div>

          {/* Rules */}
          <div className="border-t border-gray-200 pt-4">
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-medium text-gray-900">Path rules</h4>
              <button
                onClick={() => setDraft({ ...draft, rules: [...draft.rules, blankRule()] })}
                className="text-sm text-blue-600 hover:text-blue-700 inline-flex items-center"
              >
                <Plus className="h-3.5 w-3.5 mr-1" /> Add rule
              </button>
            </div>
            <p className="text-xs text-gray-500 mb-3">
              Tried top to bottom; the first match wins, so put specific paths above general ones.
              Only <code>.md</code> files are indexed.
            </p>

            <div className="space-y-3">
              {draft.rules.map((rule, i) => (
                <div key={i} className="bg-white border border-gray-200 rounded-lg p-3">
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Path prefix</label>
                      <input
                        type="text"
                        value={rule.path_prefix}
                        onChange={e => updateRule(i, { path_prefix: e.target.value })}
                        placeholder="docs/"
                        className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Shows as</label>
                      <select
                        value={rule.collection}
                        onChange={e => updateRule(i, { collection: e.target.value as SearchAdapterRule['collection'] })}
                        className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                      >
                        {COLLECTIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Visible to</label>
                      <select
                        value={rule.visibility}
                        onChange={e => updateRule(i, { visibility: e.target.value as 'member' | 'admin' })}
                        className={`w-full px-2 py-1.5 border rounded text-sm ${
                          rule.visibility === 'admin'
                            ? 'border-amber-300 bg-amber-50 text-amber-900 font-medium'
                            : 'border-gray-300'
                        }`}
                      >
                        <option value="member">All members</option>
                        <option value="admin">Admins only</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Access now opens</label>
                      <select
                        value={rule.access_url_mode}
                        onChange={e => updateRule(i, {
                          access_url_mode: e.target.value as 'github' | 'site_path',
                          url_path: e.target.value === 'github' ? null : (rule.url_path || 'help'),
                        })}
                        className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                      >
                        <option value="github">GitHub</option>
                        <option value="site_path">Published page</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex items-end justify-between gap-3 mt-2">
                    {rule.access_url_mode === 'site_path' ? (
                      <div className="flex-1">
                        <label className="block text-xs font-medium text-gray-600 mb-1">
                          URL path segment
                        </label>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-500 font-mono">
                            {draft.site_base || 'https://…'}/
                          </span>
                          <input
                            type="text"
                            value={rule.url_path || ''}
                            onChange={e => updateRule(i, { url_path: e.target.value })}
                            placeholder="help"
                            className="px-2 py-1 border border-gray-300 rounded text-sm font-mono w-28"
                          />
                          <span className="text-xs text-gray-500 font-mono">/&lt;slug&gt;</span>
                        </div>
                      </div>
                    ) : <div className="flex-1" />}
                    {draft.rules.length > 1 && (
                      <button
                        onClick={() => setDraft({ ...draft, rules: draft.rules.filter((_, idx) => idx !== i) })}
                        className="text-red-500 hover:text-red-600 p-1"
                        title="Remove rule"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>

                  {rule.visibility === 'admin' && (
                    <p className="text-xs text-amber-700 mt-2 flex items-start">
                      <Shield className="h-3.5 w-3.5 mr-1 flex-shrink-0 mt-0.5" />
                      Documents matching this rule are hidden from non-admins entirely — they
                      do not appear in search results or counts.
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3 mt-5 pt-4 border-t border-gray-200">
            <button
              onClick={handleSave}
              disabled={isSaving || !draft.repo}
              className="inline-flex items-center px-4 py-2 bg-blue-500 text-white font-medium rounded-lg hover:bg-blue-600 disabled:opacity-50"
            >
              {isSaving ? <Loader className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              {draft.id ? 'Save changes' : 'Add repository'}
            </button>
            <label className="flex items-center text-sm text-gray-700">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={e => setDraft({ ...draft, enabled: e.target.checked })}
                className="mr-2"
              />
              Enabled
            </label>
          </div>
        </div>
      )}

      {/* Existing adapters */}
      <div className="space-y-4">
        {adapters.map(a => {
          const check = checkResults[a.id];
          const adminOnly = a.rules.some(r => r.visibility === 'admin');
          return (
            <div key={a.id} className="card p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <Github className="h-4 w-4 text-gray-400 flex-shrink-0" />
                    <span className="font-medium text-gray-900">{a.repo}</span>
                    <span className="text-xs text-gray-500 font-mono">@{a.branch}</span>
                    {!a.enabled && (
                      <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600">Disabled</span>
                    )}
                    {adminOnly && (
                      <span className="px-2 py-0.5 rounded-full text-xs bg-amber-100 text-amber-800 font-medium">
                        Admin only
                      </span>
                    )}
                  </div>
                  {a.label && <p className="text-sm text-gray-600">{a.label}</p>}

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500 mt-2">
                    <span>{a.rules.length} rule{a.rules.length === 1 ? '' : 's'}</span>
                    {a.last_doc_count != null && <span>{a.last_doc_count} documents indexed</span>}
                    {a.last_swept_at && (
                      <span>last swept {new Date(a.last_swept_at).toLocaleString()}</span>
                    )}
                    <span className="inline-flex items-center">
                      <code className="font-mono">{a.token_env_var}</code>
                      {a.token_present
                        ? <CheckCircle className="h-3.5 w-3.5 ml-1 text-green-600" />
                        : <XCircle className="h-3.5 w-3.5 ml-1 text-red-500" />}
                    </span>
                  </div>

                  {a.last_status === 'failed' && a.last_error && (
                    <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5 mt-2 flex items-start">
                      <AlertTriangle className="h-3.5 w-3.5 mr-1.5 flex-shrink-0 mt-0.5" />
                      Last sweep failed: {a.last_error}
                    </p>
                  )}

                  {check && (
                    <p className={`text-xs mt-2 inline-flex items-center ${check.ok ? 'text-green-700' : 'text-red-700'}`}>
                      {check.ok
                        ? <CheckCircle className="h-3.5 w-3.5 mr-1" />
                        : <XCircle className="h-3.5 w-3.5 mr-1" />}
                      {check.reason}
                    </p>
                  )}

                  <div className="mt-3 space-y-1">
                    {a.rules.map(r => (
                      <div key={r.id} className="text-xs text-gray-600 flex items-center gap-2 flex-wrap">
                        <code className="font-mono bg-gray-100 px-1.5 py-0.5 rounded">{r.path_prefix}**.md</code>
                        <span>→</span>
                        <span>{COLLECTIONS.find(c => c.value === r.collection)?.label}</span>
                        <span className={r.visibility === 'admin' ? 'text-amber-700 font-medium' : 'text-gray-500'}>
                          ({r.visibility === 'admin' ? 'admins only' : 'all members'})
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col gap-2 flex-shrink-0">
                  <button
                    onClick={() => handleCheck(a)}
                    disabled={checking === a.id}
                    className="inline-flex items-center px-3 py-1.5 border border-gray-300 text-sm rounded-lg hover:bg-gray-50 disabled:opacity-50"
                  >
                    {checking === a.id
                      ? <Loader className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                      : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
                    Test access
                  </button>
                  <button
                    onClick={() => setDraft(toDraft(a))}
                    className="px-3 py-1.5 border border-gray-300 text-sm rounded-lg hover:bg-gray-50"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(a)}
                    className="inline-flex items-center px-3 py-1.5 border border-red-200 text-red-600 text-sm rounded-lg hover:bg-red-50"
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                    Remove
                  </button>
                </div>
              </div>
            </div>
          );
        })}

        {!adapters.length && (
          <div className="card p-8 text-center text-gray-600">
            No search adapters configured. Add a repository to index its documents.
          </div>
        )}
      </div>
    </div>
  );
};

export default SearchAdaptersTab;
