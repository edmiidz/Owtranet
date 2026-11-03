import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, BookOpen, ExternalLink, Github, Loader, AlertCircle } from 'lucide-react';
import { githubDocsApi } from '../utils/api';
import type { GithubDoc } from '../types';

/**
 * Container page for a document that lives outside the intranet.
 *
 * This page deliberately shows very little. The document itself is in GitHub (or
 * on the public help site), which stays the single source of truth — mirroring
 * its content into the intranet would immediately go stale and would duplicate
 * access control we do not own. So this page exists only to confirm "yes, this
 * is the thing you searched for" and hand the member a big Access now button.
 */

const COLLECTION_LABELS: Record<GithubDoc['collection'], string> = {
  help: 'Help Center',
  guide: 'Integration Guide',
  internal: 'Engineering Doc',
  exec: 'Executive & Legal',
};

const COLLECTION_STYLES: Record<GithubDoc['collection'], string> = {
  help: 'bg-green-100 text-green-800',
  guide: 'bg-blue-100 text-blue-800',
  internal: 'bg-purple-100 text-purple-800',
  exec: 'bg-amber-100 text-amber-800',
};

// What the member should expect on the other side of the button.
const COLLECTION_DESTINATIONS: Record<GithubDoc['collection'], string> = {
  help: 'Opens the published help article on the published website.',
  guide: 'Opens the published integration guide on the published website.',
  internal: 'Opens the document on GitHub. You will need access to the private repository.',
  exec: 'Opens the document on GitHub. You will need access to the private repository.',
};

const GithubDocPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [doc, setDoc] = useState<GithubDoc | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setIsLoading(true);
      setError('');
      try {
        const data = await githubDocsApi.get(id!);
        if (!cancelled) setDoc(data);
      } catch (err: any) {
        if (!cancelled) {
          // The API 404s admin-only docs for non-admins rather than 403ing, so
          // this message must read the same either way.
          setError(
            err?.response?.status === 404
              ? 'This document could not be found.'
              : 'Failed to load this document.'
          );
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [id]);

  if (isLoading) {
    return (
      <div className="card p-12 text-center">
        <Loader className="h-8 w-8 text-blue-500 mx-auto mb-4 animate-spin" />
        <p className="text-gray-600">Loading document…</p>
      </div>
    );
  }

  if (error || !doc) {
    return (
      <div className="max-w-3xl mx-auto space-y-4">
        <Link to="/search" className="inline-flex items-center text-sm text-gray-600 hover:text-gray-900">
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to search
        </Link>
        <div className="card p-8 text-center">
          <AlertCircle className="h-10 w-10 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-700">{error || 'This document could not be found.'}</p>
        </div>
      </div>
    );
  }

  const updated = doc.doc_updated_at || doc.updated_at;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <Link to="/search" className="inline-flex items-center text-sm text-gray-600 hover:text-gray-900">
        <ArrowLeft className="h-4 w-4 mr-1" />
        Back to search
      </Link>

      <div className="card p-8">
        <div className="flex items-center gap-3 mb-4">
          <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${COLLECTION_STYLES[doc.collection]}`}>
            {COLLECTION_LABELS[doc.collection]}
          </span>
          {doc.visibility === 'admin' && (
            <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
              Admin only
            </span>
          )}
        </div>

        <h1 className="text-3xl font-bold text-gray-900 mb-4 flex items-start gap-3">
          <BookOpen className="h-7 w-7 text-gray-400 flex-shrink-0 mt-1" />
          <span>{doc.title}</span>
        </h1>

        {doc.summary && (
          <p className="text-gray-600 mb-6 leading-relaxed">{doc.summary}</p>
        )}

        {/* The whole point of the page. */}
        <a
          href={doc.access_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center w-full sm:w-auto px-8 py-4 bg-blue-500 text-white text-lg font-semibold rounded-lg hover:bg-blue-600 transition-colors"
        >
          Access now
          <ExternalLink className="h-5 w-5 ml-2" />
        </a>
        <p className="text-sm text-gray-500 mt-3">{COLLECTION_DESTINATIONS[doc.collection]}</p>

        <div className="mt-8 pt-6 border-t border-gray-200 space-y-2 text-sm text-gray-500">
          <p className="font-medium text-gray-700">This document is not stored in the intranet.</p>
          <p>
            It is indexed here so you can find it, but it is maintained in its own
            repository and read there. Nothing on this page is editable.
          </p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-2">
            <a
              href={doc.github_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center hover:text-gray-900"
            >
              <Github className="h-4 w-4 mr-1.5" />
              {doc.repo}
            </a>
            <span className="font-mono text-xs break-all">{doc.path}</span>
            {doc.word_count ? <span>{doc.word_count.toLocaleString()} words</span> : null}
            {updated && <span>indexed {new Date(updated).toLocaleDateString()}</span>}
          </div>
        </div>
      </div>
    </div>
  );
};

export default GithubDocPage;
