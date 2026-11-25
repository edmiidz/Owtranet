import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, History, RotateCcw, FileText, GitCompare } from 'lucide-react';
import ForumContent from '../components/ForumContent';
import { postsApi } from '../utils/api';
import type { PostRevision, PostRevisionDetail } from '../types';

// Post version history: every saved version of a post, a line
// diff against the version before it, and restore. The server only returns
// history to the author, co-editors and admins.

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZoneName: 'short'
  }).replace(',', '');
}

function describeVia(via: string | null): string | null {
  if (!via) return null;
  if (via === 'web') return null;
  if (via === 'baseline') return 'Version when history started';
  if (via === 'restore') return 'Restore';
  if (via.startsWith('api:')) return `via API (${via.slice(4)})`;
  return via;
}

function errorMessage(err: unknown, fallback: string): string {
  const e = err as { response?: { data?: { error?: string } } };
  return e?.response?.data?.error || fallback;
}

const PostHistoryPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const postId = parseInt(id || '', 10);

  const [post, setPost] = useState<{ id: number; title: string; slug: string } | null>(null);
  const [revisions, setRevisions] = useState<PostRevision[]>([]);
  const [currentRevision, setCurrentRevision] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<PostRevisionDetail | null>(null);
  const [view, setView] = useState<'changes' | 'content'>('changes');
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadHistory = useCallback(async (selectNumber?: number | null) => {
    if (!Number.isInteger(postId)) {
      setError('Invalid post');
      setIsLoading(false);
      return;
    }
    try {
      const data = await postsApi.getRevisions(postId);
      setPost(data.post);
      setRevisions(data.revisions);
      setCurrentRevision(data.current_revision);
      setSelected(selectNumber ?? data.current_revision);
      setError('');
    } catch (err) {
      setError(errorMessage(err, 'Failed to load post history'));
    } finally {
      setIsLoading(false);
    }
  }, [postId]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    if (selected === null) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setIsLoadingDetail(true);
    postsApi.getRevision(postId, selected)
      .then(data => { if (!cancelled) setDetail(data.revision); })
      .catch(err => { if (!cancelled) setError(errorMessage(err, 'Failed to load revision')); })
      .finally(() => { if (!cancelled) setIsLoadingDetail(false); });
    return () => { cancelled = true; };
  }, [postId, selected]);

  const handleRestore = async () => {
    if (!detail) return;
    if (!window.confirm(
      `Restore revision ${detail.revision_number}? The post's title and content will go back to this version. ` +
      'The current version stays in the history, so this can be undone.'
    )) return;

    setIsRestoring(true);
    setNotice('');
    try {
      const result = await postsApi.restoreRevision(postId, detail.revision_number);
      setNotice(result.message);
      await loadHistory(result.revision_number);
    } catch (err) {
      setError(errorMessage(err, 'Failed to restore revision'));
    } finally {
      setIsRestoring(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error && !post) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-6">
        <Link to="/forum" className="inline-flex items-center text-blue-600 hover:text-blue-800 mb-4">
          <ArrowLeft className="h-4 w-4 mr-1" /> Back to forum
        </Link>
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-md p-4">{error}</div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <Link
        to={post ? `/forum/post/${post.slug}` : '/forum'}
        className="inline-flex items-center text-blue-600 hover:text-blue-800 mb-4"
      >
        <ArrowLeft className="h-4 w-4 mr-1" /> Back to post
      </Link>

      <div className="flex items-center mb-1">
        <History className="h-6 w-6 text-gray-500 mr-2 flex-shrink-0" />
        <h1 className="text-2xl font-bold text-gray-900 break-words">History: {post?.title}</h1>
      </div>
      <p className="text-sm text-gray-500 mb-6">
        {revisions.length} {revisions.length === 1 ? 'version' : 'versions'}. Only the author, co-editors and admins can see this page.
      </p>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-md p-3 mb-4">{error}</div>}
      {notice && <div className="bg-green-50 border border-green-200 text-green-700 rounded-md p-3 mb-4">{notice}</div>}

      {revisions.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-lg p-6 text-gray-600">
          No history has been recorded for this post yet. The next edit will start it.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Revision list */}
          <ul className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100 lg:col-span-1 self-start">
            {revisions.map(rev => {
              const isSelected = rev.revision_number === selected;
              const via = describeVia(rev.edited_via);
              return (
                <li key={rev.revision_number}>
                  <button
                    onClick={() => { setSelected(rev.revision_number); setNotice(''); setError(''); }}
                    className={`w-full text-left px-4 py-3 hover:bg-gray-50 ${isSelected ? 'bg-blue-50 border-l-4 border-blue-600' : 'border-l-4 border-transparent'}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-gray-900">Revision {rev.revision_number}</span>
                      {rev.revision_number === currentRevision && (
                        <span className="text-xs bg-green-100 text-green-800 rounded px-2 py-0.5">Current</span>
                      )}
                    </div>
                    <div className="text-sm text-gray-600 mt-0.5">
                      {rev.editor ? rev.editor.name : 'Unknown editor'}
                      {via && <span className="text-gray-400"> · {via}</span>}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">{formatDateTime(rev.created_at)}</div>
                    {rev.change_note && (
                      <div className="text-sm text-gray-700 italic mt-1 break-words">“{rev.change_note}”</div>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>

          {/* Selected revision */}
          <div className="lg:col-span-2 bg-white border border-gray-200 rounded-lg p-4 min-w-0">
            {isLoadingDetail || !detail ? (
              <div className="flex justify-center py-12">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                  <div className="inline-flex rounded-md border border-gray-300 overflow-hidden">
                    <button
                      onClick={() => setView('changes')}
                      className={`px-3 py-1.5 text-sm inline-flex items-center ${view === 'changes' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
                    >
                      <GitCompare className="h-4 w-4 mr-1" /> Changes
                    </button>
                    <button
                      onClick={() => setView('content')}
                      className={`px-3 py-1.5 text-sm inline-flex items-center border-l border-gray-300 ${view === 'content' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
                    >
                      <FileText className="h-4 w-4 mr-1" /> Content
                    </button>
                  </div>

                  {detail.revision_number !== currentRevision && (
                    <button
                      onClick={handleRestore}
                      disabled={isRestoring}
                      className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 inline-flex items-center"
                    >
                      <RotateCcw className="h-4 w-4 mr-1" />
                      {isRestoring ? 'Restoring…' : `Restore revision ${detail.revision_number}`}
                    </button>
                  )}
                </div>

                {view === 'changes' ? (
                  <>
                    <p className="text-sm text-gray-500 mb-3">
                      {detail.previous_revision_number
                        ? `Compared with revision ${detail.previous_revision_number}.`
                        : 'First recorded version: everything is shown as added.'}
                    </p>
                    {detail.diff.title_changed && (
                      <div className="mb-3 text-sm">
                        <div className="text-gray-500 mb-1">Title</div>
                        <div className="bg-red-50 text-red-800 px-2 py-1 rounded-t break-words">− {detail.diff.previous_title}</div>
                        <div className="bg-green-50 text-green-800 px-2 py-1 rounded-b break-words">+ {detail.title}</div>
                      </div>
                    )}
                    <pre className="text-xs sm:text-sm font-mono border border-gray-200 rounded overflow-x-auto">
                      {detail.diff.lines.map((line, i) => (
                        <div
                          key={i}
                          className={
                            line.type === 'added' ? 'bg-green-50 text-green-900'
                              : line.type === 'removed' ? 'bg-red-50 text-red-900'
                                : 'text-gray-700'
                          }
                        >
                          <span className="select-none inline-block w-6 text-center text-gray-400">
                            {line.type === 'added' ? '+' : line.type === 'removed' ? '−' : ' '}
                          </span>
                          <span className="whitespace-pre-wrap break-words">{line.text || ' '}</span>
                        </div>
                      ))}
                    </pre>
                  </>
                ) : (
                  <>
                    <h2 className="text-xl font-semibold text-gray-900 mb-3 break-words">{detail.title}</h2>
                    <ForumContent content={detail.content_html} />
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default PostHistoryPage;
